// ── Continuidad: la llamada de PROYECCIÓN antes del fin del programa (pedido de Tomás, 2/11/2026). PURO, sin red ni base ──
// «Cuando le queden 14 días se hace el aviso para la llamada de proyección, que va a ser para dentro de una semana; cuando
// le queden 7 días, ahí se tiene que agendar. Es para que tengan continuidad en el servicio y no piensen que se tienen que
// bajar.» Reglas:
//   · Quiénes: Agencia, ACTIVO, con ID, con fin real (el de Bajas: pausas y extensiones incluidas, lib/bot/bajas/fin.ts).
//     Fuera: sin fecha de fin (BOT_CLIENTES_SIN_FIN), pausados, finalizados, no clientes y clientes de prueba.
//   · Día −14 a −8 → «invitar»: el texto para el cliente queda en 📤 (para pegar a mano; el bot no le escribe a nadie).
//     Reemplaza al pedido de OK del aviso de fin de Bajas (i01): es la misma pieza, sin el OK previo (no se duplica).
//   · Día −7 a 0 → «agendar»: tarea en 🛠️ a Tomás, Aylu y Gero M. Recordatorio a −5 y a −3 si sigue sin agendar.
//     Un solo aviso por paso: si el cron se salteó días, sale el último que corresponde (no los atrasados juntos).
//   · Una sola fuente para la tarjeta, el panel «Pendientes de llamada de proyección» y el cron: la marca del cliente para ese
//     fin (Avisado · Agendada · Hecha / No se dio, tabla cj_proyeccion) + las acciones «Llamada de proyección» de la tarjeta
//     (cj_cliente_acciones) + el Calendly (un evento con el cliente en el Calendly de Tomi = la kickoff agendada por segunda
//     vez, o «Análisis y Proyecciones» en la cuenta de ventas). «Agendada» o «Hecha» cortan los avisos.
import { finReal, normNombre, type ClienteBaja } from '@/lib/bot/bajas/fin'
import { diasEntre, type Ymd } from '@/lib/clientes/fechas'

/** ¿Está prendida? (BOT_PROYECCION=no la apaga; por defecto, prendida). */
export const proyeccionPrendida = (env: Record<string, string | undefined> = process.env): boolean =>
  !/^(no|0|false|apagado|off)$/i.test((env.BOT_PROYECCION ?? '').trim())

export const INVITAR_DIAS = 14
export const AGENDAR_DIAS = 7
export const RECORDATORIOS_DIAS = [5, 3] as const
/** El panel sigue mostrando a los ACTIVOS con el fin vencido hasta esto (nadie los pasó a FINALIZADO ni renovó). */
export const ATRASO_MAX_DIAS = 30
/** Una marca de otro fin cuenta si está a menos de esto (una extensión corta mueve el fin, la llamada sigue siendo la misma). */
export const TOLERANCIA_MARCA_DIAS = 30

export type PasoProyeccion = 'invitar' | 'agendar' | 'rec5' | 'rec3'
export type Resultado = 'hecha' | 'no_se_dio'
export type FuenteAgenda = 'manual' | 'calendly' | 'accion'

/** Lo anotado de la llamada para un fin (o, si `fin` es null, una acción de la tarjeta: cuenta por cercanía de `ref`). */
export interface MarcaProyeccion {
  idCrm: string
  fin: Ymd | null
  ref?: Ymd | null
  avisado: Ymd | null
  agendada: Ymd | null
  agendadaFuente: FuenteAgenda | null
  resultado: Resultado | null
  resultadoFecha: Ymd | null
  quien: string
  cuando: string
}
export interface EventoCalendly { invitado: string; email?: string; inicio: Ymd; evento: string }

export interface CandidatoProyeccion { cliente: ClienteBaja; fin: Ymd; dias: number }
export interface Exclusiones { sinFin?: readonly string[]; prueba?: readonly string[] }

const PRUEBA = /^\s*PRUEBA BOT\b/i
const up = (s: string) => s.trim().toUpperCase()

/** ¿Este cliente entra en la regla? (motivo si no). */
export function motivoFuera(c: ClienteBaja, ex: Exclusiones = {}): string | null {
  if (c.linea !== 'agencia') return 'no es de Agencia'
  if (!c.id) return 'sin ID'
  if (c.esNoCliente) return 'no cliente'
  if (c.sinFin || (ex.sinFin ?? []).includes(up(c.id))) return 'sin fecha de fin'
  if ((ex.prueba ?? []).includes(up(c.id)) || PRUEBA.test(c.nombre)) return 'cliente de prueba'
  if (c.estado !== 'ACTIVO') return c.estado === 'PAUSADO' ? 'pausado' : `estado ${c.estado || 'vacío'}`
  return null
}

/** Los clientes con el fin entre `-atraso` y +14 días (hoy incluido), del más urgente al menos. El cron usa atraso 0. */
export function candidatosProyeccion(clientes: readonly ClienteBaja[], hoy: Ymd, ex: Exclusiones = {}, atraso = 0): CandidatoProyeccion[] {
  const out: CandidatoProyeccion[] = []
  for (const c of clientes) {
    if (motivoFuera(c, ex)) continue
    const fin = finReal(c)
    if (!fin) continue
    const dias = diasEntre(hoy, fin)
    if (dias >= -atraso && dias <= INVITAR_DIAS) out.push({ cliente: c, fin, dias })
  }
  return out.sort((a, b) => a.dias - b.dias || a.cliente.id.localeCompare(b.cliente.id))
}

/** El paso que toca con esos días al fin (null fuera de la ventana). */
export function pasoDelDia(dias: number): PasoProyeccion | null {
  if (dias < 0 || dias > INVITAR_DIAS) return null
  if (dias > AGENDAR_DIAS) return 'invitar'
  if (dias > RECORDATORIOS_DIAS[0]) return 'agendar'
  if (dias > RECORDATORIOS_DIAS[1]) return 'rec5'
  return 'rec3'
}

const masNuevo = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b)

/** Junta las marcas que valen para ese cliente y ese fin: cada dato, el más nuevo (por `cuando`). null si no hay ninguna. */
export function marcaVigente(marcas: readonly MarcaProyeccion[] | undefined, idCrm: string, fin: Ymd): MarcaProyeccion | null {
  const xs = (marcas ?? []).filter((m) => {
    if (up(m.idCrm) !== up(idCrm)) return false
    const base = m.fin ?? m.ref ?? null
    if (!base) return false
    // Una acción de la tarjeta (sin fin) cuenta si es de los 45 días antes del fin o de los 30 después
    if (!m.fin) { const d = diasEntre(base, fin); return d >= -TOLERANCIA_MARCA_DIAS && d <= 45 }
    return Math.abs(diasEntre(base, fin)) <= TOLERANCIA_MARCA_DIAS
  }).sort((a, b) => a.cuando.localeCompare(b.cuando))
  if (!xs.length) return null
  const out: MarcaProyeccion = { idCrm: up(idCrm), fin, avisado: null, agendada: null, agendadaFuente: null, resultado: null, resultadoFecha: null, quien: '', cuando: '' }
  for (const m of xs) {   // de la más vieja a la más nueva: lo último anotado pisa
    if (m.avisado) out.avisado = m.avisado
    if (m.agendada) { out.agendada = m.agendada; out.agendadaFuente = m.agendadaFuente ?? 'manual' }
    if (m.resultado) { out.resultado = m.resultado; out.resultadoFecha = m.resultadoFecha }
    out.quien = m.quien || out.quien
    out.cuando = masNuevo(out.cuando, m.cuando) ?? ''
  }
  // Una marca nueva de una tabla que no la trae (null) no borra lo anotado antes: el borrado lo hace la tabla misma
  return out
}

// ── Calendly ──
// Palabras de un nombre que sirven para cruzar (sin títulos ni palabras de relleno)
const GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'abogado', 'abogada', 'abogados', 'dra', 'dr', 'del', 'los', 'las', 'con', 'and', 'de', 'la', 'el', 'capital', 'skyward', 'tomas', 'napolitano'])
const palabras = (s: string) => new Set(normNombre(s).split(' ').filter((w) => w.length >= 3 && !GENERICAS.has(w)))

/** Los eventos que cuentan como llamada de proyección. En el Calendly de Tomi: la KickOff (agendarla por SEGUNDA vez es la
 *  proyección: el cliente ya hizo la primera hace meses) y cualquier evento de proyección o renovación; en la cuenta de
 *  ventas, solo «Análisis y Proyecciones». Nunca las reuniones consultivas ni el coaching grupal. */
export function esEventoProyeccion(nombre: string, cuenta: 'tomi' | 'ventas'): boolean {
  const n = normNombre(nombre)
  if (/consultiva|coaching/.test(n)) return false
  if (cuenta === 'ventas') return /proyecc/.test(n)
  return /kick ?off|proyecc|renovac|analisis/.test(n)
}

/** ¿El evento de Calendly es con este cliente? Por mail igual o por 2 palabras del nombre. */
export function eventoEsDe(c: Pick<ClienteBaja, 'nombre' | 'mail'>, e: EventoCalendly): boolean {
  const m = c.mail?.trim().toLowerCase()
  if (m && e.email && e.email.trim().toLowerCase() === m) return true
  const inv = palabras(e.invitado)
  return [...palabras(c.nombre)].filter((w) => inv.has(w)).length >= 2
}

/** El evento de Calendly del cliente (el más próximo), si hay uno. */
export function eventoDe(c: Pick<ClienteBaja, 'nombre' | 'mail'>, eventos: readonly EventoCalendly[]): EventoCalendly | null {
  return [...eventos].filter((e) => eventoEsDe(c, e)).sort((a, b) => a.inicio.localeCompare(b.inicio))[0] ?? null
}

// ── Estado (lo que muestran el panel y la tarjeta, y lo que decide el cron) ──
export type Fase = 'invitar' | 'agendar' | 'agendada' | 'hecha' | 'atrasado'
export interface EstadoProyeccion {
  fase: Fase
  avisado: Ymd | null
  agendada: { fecha: Ymd | null; fuente: FuenteAgenda } | null
  resultado: Resultado | null
  resultadoFecha: Ymd | null
  /** Hay un evento en Calendly que todavía no quedó anotado (el cron lo anota y avisa en ✅). */
  calendlySinAnotar: EventoCalendly | null
}

export function estadoProyeccion(cand: CandidatoProyeccion, marca: MarcaProyeccion | null, evento: EventoCalendly | null): EstadoProyeccion {
  const resultado = marca?.resultado ?? null
  const resultadoFecha = marca?.resultadoFecha ?? null
  // «No se dio»: la agenda anterior ya no vale (hay que volver a agendar), salvo un evento posterior
  const vale = (f: Ymd | null) => resultado !== 'no_se_dio' || (!!f && !!resultadoFecha && f > resultadoFecha)
  let agendada: EstadoProyeccion['agendada'] = null
  if (marca?.agendada && vale(marca.agendada)) agendada = { fecha: marca.agendada, fuente: marca.agendadaFuente ?? 'manual' }
  const eventoVale = evento && vale(evento.inicio) ? evento : null
  const calendlySinAnotar = eventoVale && (!agendada || agendada.fecha !== eventoVale.inicio) && !(agendada && agendada.fuente !== 'calendly') ? eventoVale : null
  if (!agendada && eventoVale) agendada = { fecha: eventoVale.inicio, fuente: 'calendly' }
  const base = { avisado: marca?.avisado ?? null, agendada, resultado, resultadoFecha, calendlySinAnotar: resultado === 'hecha' ? null : calendlySinAnotar }
  if (resultado === 'hecha') return { fase: 'hecha', ...base }
  if (agendada) return { fase: 'agendada', ...base }
  if (cand.dias < 0) return { fase: 'atrasado', ...base }
  return { fase: cand.dias > AGENDAR_DIAS ? 'invitar' : 'agendar', ...base }
}

export interface AccionProyeccion { paso: PasoProyeccion; cliente: ClienteBaja; fin: Ymd; dias: number; clave: string; avisado: boolean }
export interface DeteccionCalendly { cliente: ClienteBaja; fin: Ymd; dias: number; evento: EventoCalendly; clave: string }

/** Lo que hay que avisar hoy. La clave es la idempotencia (la misma nunca sale dos veces: alertar / para enviar). */
export function planDelDia(cands: readonly CandidatoProyeccion[], marcas: readonly MarcaProyeccion[], eventos: readonly EventoCalendly[]): {
  acciones: AccionProyeccion[]; detecciones: DeteccionCalendly[]; cortados: { cliente: ClienteBaja; motivo: string }[]
} {
  const acciones: AccionProyeccion[] = []
  const detecciones: DeteccionCalendly[] = []
  const cortados: { cliente: ClienteBaja; motivo: string }[] = []
  for (const cand of cands) {
    const k = cand.cliente
    const s = estadoProyeccion(cand, marcaVigente(marcas, k.id, cand.fin), eventoDe(k, eventos))
    if (s.calendlySinAnotar) detecciones.push({ cliente: k, fin: cand.fin, dias: cand.dias, evento: s.calendlySinAnotar, clave: `proyeccion:${up(k.id)}:${cand.fin}:calendly:${s.calendlySinAnotar.inicio}` })
    if (s.fase === 'hecha' || s.fase === 'agendada') {
      cortados.push({ cliente: k, motivo: s.fase === 'hecha' ? 'llamada hecha' : s.agendada?.fuente === 'calendly' ? 'agendada en Calendly' : 'llamada agendada' })
      continue
    }
    const paso = pasoDelDia(cand.dias)
    if (!paso) continue
    // Ya se le avisó (a mano, antes del día −14): la invitación no vuelve a salir
    if (paso === 'invitar' && s.avisado) { cortados.push({ cliente: k, motivo: 'ya avisado' }); continue }
    acciones.push({ paso, cliente: k, fin: cand.fin, dias: cand.dias, clave: claveProyeccion(k.id, cand.fin, paso), avisado: !!s.avisado })
  }
  return { acciones, detecciones, cortados }
}

export const claveProyeccion = (idCrm: string, fin: Ymd, paso: PasoProyeccion): string => `proyeccion:${up(idCrm)}:${fin}:${paso}`

// ── Textos ──
const TITULOS = new Set(['dr', 'dra', 'dr.', 'dra.', 'doctor', 'doctora', 'lic', 'lic.', 'estudio', 'sr', 'sra'])
const capital = (w: string) => (w ? w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es') : w)
export function primerNombre(nombre: string): string {
  const w = nombre.replace(/[|·,;()]/g, ' ').split(/\s+/).find((x) => x && !TITULOS.has(x.toLowerCase()) && /\p{L}/u.test(x)) ?? ''
  return w.split('-').map(capital).join('-')
}

/** El texto para el cliente (−14): tono de continuidad, nunca «se te termina». */
export function textoInvitacion(nombre: string, calendly: string): string {
  const n = primerNombre(nombre)
  return `${n ? `Hola ${n}` : 'Hola'}, ¿cómo estás? Queremos seguir acompañándote en lo que viene: en una semana hacemos la llamada de proyección con Tomi para repasar los resultados de estos meses y planificar juntos los próximos pasos.

Te dejo su calendario para que elijas el horario que mejor te quede, de acá a una semana:

${calendly || '[link del Calendly de Tomi]'}`
}

export const fechaCorta = (ymd: string): string => ymd.split('-').reverse().join('/')

export const textoQuedan = (dias: number): string =>
  dias < 0 ? `su fin fue hace ${-dias === 1 ? '1 día' : `${-dias} días`}` : dias === 0 ? 'hoy es su último día' : `le ${dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}`

/** Título y líneas de la tarea en 🛠️ (−7, −5, −3). */
export function textoTarea(a: Pick<AccionProyeccion, 'paso' | 'cliente' | 'fin' | 'dias' | 'avisado'>, calendly: string): { titulo: string; lineas: string[] } {
  const quedan = textoQuedan(a.dias)
  const titulo = a.paso === 'agendar'
    ? `Agendar la llamada de proyección con ${a.cliente.nombre} (${quedan})`
    : `Sigue sin agendar la llamada de proyección con ${a.cliente.nombre} (${quedan})`
  return {
    titulo,
    lineas: [
      `Fin del programa: ${fechaCorta(a.fin)}.`,
      'Es para que tenga continuidad y no piense que se tiene que bajar.',
      a.avisado ? 'Ya se le avisó de la llamada.' : 'Todavía no figura avisado: abajo va el texto para pegarle en su grupo.',
      ...(calendly ? [`Calendly de Tomi: ${calendly}`] : []),
      'Cuando quede agendada, marcá «Agendada» en su tarjeta o en Clientes → Pendientes de llamada de proyección: se cortan los avisos.',
    ],
  }
}

/** El aviso en ✅-verificaciones cuando aparece en Calendly. */
export const textoDeteccion = (d: Pick<DeteccionCalendly, 'cliente' | 'evento' | 'fin'>): { titulo: string; lineas: string[] } => ({
  titulo: `${d.cliente.nombre} agendó la llamada de proyección para el ${fechaCorta(d.evento.inicio)}`,
  lineas: [`Evento de Calendly: ${d.evento.evento}.`, `Fin del programa: ${fechaCorta(d.fin)}.`, 'Quedó marcada «Agendada» y se cortan los avisos. Si no es la proyección, quitá la marca en su tarjeta.'],
})
