// ── Continuidad: la corrida diaria de la llamada de proyección (dependencias inyectables: los tests no tocan red ni base) ──
// La llama el cron de /api/bot/proyeccion (10:40 y 18:00 AR). Nada va directo al cliente:
//   · invitar (−14 a −8): el texto queda en 📤 para pegar a mano (pieza i01, con el Calendly de Tomi).
//   · agendar (−7) y recordatorios (−5, −3): tarea en 🛠️ a Tomás, Aylu y Gero M con el link a la tarjeta (y el texto de la
//     invitación para pegar si todavía no figura avisado).
//   · Calendly: si el cliente agendó (la kickoff por segunda vez en el Calendly de Tomi), queda «Agendada» con la fecha y
//     avisa en ✅-verificaciones «X agendó la llamada de proyección para el …».
//   · Bandeja del Despacho (bandeja.ts, pedido del 3/11): cada paso (−14, −7, −5, −3) también queda como notificación para
//     Tomás, Aylu y Gero M con link a la tarjeta; las que ya no corresponden se resuelven solas al final de la corrida.
// En seco (dry) solo devuelve lo que haría. Nunca tira: los errores van al resumen.
import type { ClienteBaja } from '@/lib/bot/bajas/fin'
import type { Ymd } from '@/lib/clientes/fechas'
import type { NuevaNotificacion } from '@/lib/notificaciones/modelo'
import { aCerrarEnCorrida, avisosBandeja, cicloProyeccion, type DestinoBandeja } from './bandeja'
import {
  ATRASO_MAX_DIAS, candidatosProyeccion, estadoProyeccion, eventoDe, fechaCorta, marcaVigente, planDelDia, textoDeteccion, textoInvitacion, textoTarea,
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
  /** Bandeja del Despacho (opcional: sin esto, solo Discord). */
  bandeja?: {
    destinos: DestinoBandeja[]
    /** Crea la notificación (con clave: no duplica). Devuelve el id o null si ya estaba. */
    crear(n: NuevaNotificacion): Promise<number | null>
    abiertas(): Promise<{ id: number; clave: string }[]>
    cerrar(ids: number[]): Promise<number>
  }
}

export interface FilaBandeja { id: string; cliente: string; paso: string; titulo: string; para: string[]; urgente: boolean; estado: string }

export interface FilaResumen { id: string; cliente: string; fin: Ymd; dias: number; paso: string; estado: string }
export interface ResumenProyeccion {
  dry: boolean; hoy: Ymd
  invitar: FilaResumen[]; agendar: FilaResumen[]; agendadas: FilaResumen[]
  cortados: { id: string; cliente: string; fin: Ymd; dias: number; motivo: string }[]
  /** Notificaciones de la bandeja del Despacho: las de hoy y cuántas se resolvieron solas. */
  bandeja: FilaBandeja[]
  bandejaResueltas: number
  errores: string[]
}

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)

export async function correrProyeccion(d: DepsProyeccion): Promise<ResumenProyeccion> {
  const r: ResumenProyeccion = { dry: d.dry, hoy: d.hoy, invitar: [], agendar: [], agendadas: [], cortados: [], bandeja: [], bandejaResueltas: 0, errores: [] }
  let clientes: ClienteBaja[]
  try { clientes = await d.leerClientes() } catch (e) { r.errores.push(`CRM: ${motivo(e)}`); return r }
  // Con atraso solo para la bandeja: las de un fin vencido sin agendar no se cierran solas
  const conAtraso = candidatosProyeccion(clientes, d.hoy, d.exclusiones, ATRASO_MAX_DIAS)
  const cands = conAtraso.filter((c) => c.dias >= 0)
  if (!conAtraso.length) { await resolverBandeja(d, r, new Set(), new Set()); return r }
  let marcas: MarcaProyeccion[] = []
  try { marcas = await d.leerMarcas() } catch (e) { r.errores.push(`marcas: ${motivo(e)}`); return r }   // sin marcas no se avisa (podría avisar de más)
  let eventos: EventoCalendly[] = []
  try { eventos = await d.eventosCalendly() } catch (e) { r.errores.push(`Calendly: ${motivo(e)}`) }       // sin Calendly igual corta la marca manual
  let resueltos = new Set<string>()
  if (d.avisosFinResueltos) try { resueltos = await d.avisosFinResueltos() } catch (e) { r.errores.push(`avisos de Bajas: ${motivo(e)}`); return r }   // sin eso podría duplicar
  const mantener = new Set(conAtraso.filter((c) => c.dias < 0 && estadoProyeccion(c, marcaVigente(marcas, c.cliente.id, c.fin), eventoDe(c.cliente, eventos, c.fin)).fase === 'atrasado').map((c) => cicloProyeccion(c.cliente.id, c.fin)))
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

  const vigentes = new Set<string>()
  for (const a of plan.acciones) {
    const fila = (estado: string): FilaResumen => ({ id: a.cliente.id, cliente: a.cliente.nombre, fin: a.fin, dias: a.dias, paso: a.paso, estado })
    const lista = a.paso === 'invitar' ? r.invitar : r.agendar
    vigentes.add(a.clave)
    if (d.dry) { lista.push(fila('haría')); await bandejaDe(d, r, a); continue }
    try {
      if (d.clienteOperativo && !(await d.clienteOperativo(a.cliente.id, a.cliente.nombre))) {
        vigentes.delete(a.clave)
        r.cortados.push({ id: a.cliente.id, cliente: a.cliente.nombre, fin: a.fin, dias: a.dias, motivo: 'archivado' }); continue
      }
    } catch (e) { r.errores.push(`${a.cliente.nombre}: ${motivo(e)}`); continue }
    await bandejaDe(d, r, a)   // antes de Discord: si Discord falla, la notificación igual queda
    try {
      lista.push(fila(await ejecutar(d, a)))
    } catch (e) {
      r.errores.push(`${a.cliente.nombre}: ${motivo(e)}`)
    }
  }
  await resolverBandeja(d, r, vigentes, mantener)
  return r
}

/** Las notificaciones de la bandeja de una acción (en seco, solo cuáles serían). Nunca tira. */
async function bandejaDe(d: DepsProyeccion, r: ResumenProyeccion, a: AccionProyeccion): Promise<void> {
  if (!d.bandeja) return
  const avisos = avisosBandeja(a, d.bandeja.destinos)
  const para = d.bandeja.destinos.length ? [...new Set(d.bandeja.destinos.map((x) => x.nombre))] : ['sección Clientes']
  const fila = (estado: string): FilaBandeja => ({ id: a.cliente.id.toUpperCase(), cliente: a.cliente.nombre, paso: a.paso, titulo: avisos[0].titulo, para, urgente: !!avisos[0].urgente, estado })
  if (d.dry) { r.bandeja.push(fila('crearía (si no estaba)')); return }
  try {
    const ids = await Promise.all(avisos.map((n) => d.bandeja!.crear(n)))
    const nuevas = ids.filter((x) => x !== null).length
    r.bandeja.push(fila(nuevas ? `creada (${nuevas})` : 'ya estaba'))
  } catch (e) { r.errores.push(`${a.cliente.nombre} (bandeja): ${motivo(e)}`) }
}

/** Resuelve las notificaciones abiertas que ya no corresponden (paso anterior, agendada, avisado, archivado…). Nunca tira. */
async function resolverBandeja(d: DepsProyeccion, r: ResumenProyeccion, vigentes: ReadonlySet<string>, mantener: ReadonlySet<string>): Promise<void> {
  if (!d.bandeja || d.dry) return
  try {
    const ids = aCerrarEnCorrida(await d.bandeja.abiertas(), vigentes, mantener)
    if (ids.length) r.bandejaResueltas = await d.bandeja.cerrar(ids)
  } catch (e) { r.errores.push(`bandeja: ${motivo(e)}`) }
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
