// ── Continuidad: la corrida diaria de la llamada de proyección (dependencias inyectables: los tests no tocan red ni base) ──
// La llama el cron de /api/bot/proyeccion (10:40 y 18:00 AR). Nada va directo al cliente:
//   · invitar (−14 a −8): el texto queda en 📤 para pegar a mano (pieza i01, con el Calendly de Tomi).
//   · agendar (−7) y recordatorios (−5, −3): tarea en 🛠️ a Tomás, Aylu y Gero M con el link a la tarjeta (y el texto de la
//     invitación para pegar si todavía no figura avisado).
//   · Calendly: si el cliente agendó (la kickoff por segunda vez en el Calendly de Tomi), queda «Agendada» con la fecha y
//     avisa en ✅-verificaciones «X agendó la llamada de proyección para el …».
// En seco (dry) solo devuelve lo que haría. Nunca tira: los errores van al resumen.
import type { ClienteBaja } from '@/lib/bot/bajas/fin'
import type { Ymd } from '@/lib/clientes/fechas'
import {
  candidatosProyeccion, fechaCorta, planDelDia, textoDeteccion, textoInvitacion, textoTarea,
  type AccionProyeccion, type EventoCalendly, type Exclusiones, type MarcaProyeccion,
} from './reglas'

export interface DepsProyeccion {
  hoy: Ymd
  dry: boolean
  calendlyUrl: string
  exclusiones: Exclusiones
  leerClientes(): Promise<ClienteBaja[]>
  leerMarcas(): Promise<MarcaProyeccion[]>
  /** Eventos próximos de proyección en Calendly (solo se piden si hay a quién mirar). */
  eventosCalendly(): Promise<EventoCalendly[]>
  /** Avisos de fin de Bajas (i01 con OK, de antes de esta etapa) ya resueltos a mano para ese cliente y fin: enviado o
   *  descartado. Con eso la invitación de −14 no vuelve a salir (no se duplica). Claves `ID:fin`. Opcional. */
  avisosFinResueltos?(): Promise<Set<string>>
  /** ¿El cliente sigue operativo (no archivado)? Opcional. */
  clienteOperativo?(idCrm: string, nombre: string): Promise<boolean>
  paraEnviar(p: { idCrm: string; cliente: string; clave: string; texto: string; fin: Ymd }): Promise<{ estado: string }>
  tarea(p: { idCrm: string; cliente: string; clave: string; titulo: string; lineas: string[]; copiar: string | null }): Promise<{ estado: string }>
  anotarAgendada(p: { idCrm: string; fin: Ymd; fecha: Ymd }): Promise<void>
  verificaciones(p: { idCrm: string; cliente: string; clave: string; titulo: string; lineas: string[] }): Promise<{ estado: string }>
}

export interface FilaResumen { id: string; cliente: string; fin: Ymd; dias: number; paso: string; estado: string }
export interface ResumenProyeccion {
  dry: boolean; hoy: Ymd
  invitar: FilaResumen[]; agendar: FilaResumen[]; agendadas: FilaResumen[]
  cortados: { id: string; cliente: string; fin: Ymd; dias: number; motivo: string }[]
  errores: string[]
}

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)

export async function correrProyeccion(d: DepsProyeccion): Promise<ResumenProyeccion> {
  const r: ResumenProyeccion = { dry: d.dry, hoy: d.hoy, invitar: [], agendar: [], agendadas: [], cortados: [], errores: [] }
  let clientes: ClienteBaja[]
  try { clientes = await d.leerClientes() } catch (e) { r.errores.push(`CRM: ${motivo(e)}`); return r }
  const cands = candidatosProyeccion(clientes, d.hoy, d.exclusiones)
  if (!cands.length) return r
  let marcas: MarcaProyeccion[] = []
  try { marcas = await d.leerMarcas() } catch (e) { r.errores.push(`marcas: ${motivo(e)}`); return r }   // sin marcas no se avisa (podría avisar de más)
  let eventos: EventoCalendly[] = []
  try { eventos = await d.eventosCalendly() } catch (e) { r.errores.push(`Calendly: ${motivo(e)}`) }       // sin Calendly igual corta la marca manual
  let resueltos = new Set<string>()
  if (d.avisosFinResueltos) try { resueltos = await d.avisosFinResueltos() } catch (e) { r.errores.push(`avisos de Bajas: ${motivo(e)}`); return r }   // sin eso podría duplicar
  const plan = planDelDia(cands, marcas, eventos)
  plan.acciones = plan.acciones.filter((a) => {
    if (a.paso !== 'invitar' || !resueltos.has(`${a.cliente.id.toUpperCase()}:${a.fin}`)) return true
    plan.cortados.push({ cliente: a.cliente, motivo: 'aviso de fin ya resuelto en Bajas' })
    return false
  })
  const finDe = new Map(cands.map((c) => [c.cliente.id, c]))
  r.cortados = plan.cortados.map((x) => ({ id: x.cliente.id, cliente: x.cliente.nombre, fin: finDe.get(x.cliente.id)!.fin, dias: finDe.get(x.cliente.id)!.dias, motivo: x.motivo }))

  for (const det of plan.detecciones) {
    const fila = (estado: string): FilaResumen => ({ id: det.cliente.id, cliente: det.cliente.nombre, fin: det.fin, dias: det.dias, paso: `agendada ${fechaCorta(det.evento.inicio)}`, estado })
    if (d.dry) { r.agendadas.push(fila('anotaría y avisaría en ✅')); continue }
    try {
      await d.anotarAgendada({ idCrm: det.cliente.id.toUpperCase(), fin: det.fin, fecha: det.evento.inicio })
      const t = textoDeteccion(det, d.hoy)
      const s = await d.verificaciones({ idCrm: det.cliente.id.toUpperCase(), cliente: det.cliente.nombre, clave: det.clave, ...t })
      r.agendadas.push(fila(s.estado))
    } catch (e) {
      r.errores.push(`${det.cliente.nombre} (Calendly): ${motivo(e)}`)
    }
  }

  for (const a of plan.acciones) {
    const fila = (estado: string): FilaResumen => ({ id: a.cliente.id, cliente: a.cliente.nombre, fin: a.fin, dias: a.dias, paso: a.paso, estado })
    const lista = a.paso === 'invitar' ? r.invitar : r.agendar
    if (d.dry) { lista.push(fila('haría')); continue }
    try {
      if (d.clienteOperativo && !(await d.clienteOperativo(a.cliente.id, a.cliente.nombre))) { r.cortados.push({ id: a.cliente.id, cliente: a.cliente.nombre, fin: a.fin, dias: a.dias, motivo: 'archivado' }); continue }
      lista.push(fila(await ejecutar(d, a)))
    } catch (e) {
      r.errores.push(`${a.cliente.nombre}: ${motivo(e)}`)
    }
  }
  return r
}

async function ejecutar(d: DepsProyeccion, a: AccionProyeccion): Promise<string> {
  const id = a.cliente.id.toUpperCase()
  const invitacion = textoInvitacion(a.cliente.nombre, d.calendlyUrl, a.dias)
  if (a.paso === 'invitar') return (await d.paraEnviar({ idCrm: id, cliente: a.cliente.nombre, clave: a.clave, texto: invitacion, fin: a.fin })).estado
  const t = textoTarea(a, d.calendlyUrl)
  return (await d.tarea({ idCrm: id, cliente: a.cliente.nombre, clave: a.clave, ...t, copiar: a.avisado ? null : invitacion })).estado
}

/** Para el registro: una línea por acción. */
export const lineaResumen = (f: FilaResumen): string => `${f.cliente} (${f.id}) · fin ${fechaCorta(f.fin)} · ${f.dias} días · ${f.paso} · ${f.estado}`
