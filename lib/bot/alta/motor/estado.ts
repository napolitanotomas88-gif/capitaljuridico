// ── Bot "Capital Jurídico": máquina de estados del alta (puro) ────────────────────────────────────────────────────────
// Diseño del motor, sección 3.2, con los cambios de la revisión. Puro y sin red: es el corazón de los tests.
//   · siguienteAccion(alta, pasos, ahora, plazo): el primer paso listo, en el orden de PASOS. Un paso que espera solo frena
//     a los que dependen de él (todos dependen de validar; la bienvenida, además, de la comunidad con el OK de Aylu).
//   · Skool depende del pago (validar lista), no de la bienvenida (punto 26).
//   · Fee: solo validar y Finanzas; después el alta queda 'fee'. DFY+R aprobada: solo Finanzas (que avisa para cargarla a
//     mano: punto 23) y el resto se omite.
//   · Reglas del 26/10/2026 (#ALTA y formato libre, altaLibre.ts): un Fee aprobado corre Finanzas y la comunidad
//     (pasosFeeLibre); el pago de un cliente que ya está en el CRM ('pago_cliente') corre solo Finanzas y termina 'lista'.
//   · Un paso 'corriendo' es de una invocación que murió (quien tiene el candado no lo dejó así): se trata como dudoso y no
//     se repite antes de COLA_DUDOSA_MS desde que empezó (300 s de la función + 6 min de Apps Script, como finanzasEscribir).
//   · Un paso que no entra en lo que queda del plazo → otra_invocacion (con los 300 s completos).
// También: recordatorios (24 h y 72 h, solo de 9 a 21 de Argentina) y vencimiento de las esperas (14 días, punto 20).
import type { CambiosAlta, EstadoAlta, EstadoPaso, FilaAlta, FilaPaso, MotivoEspera, Quien, Requisito, TipoEspera, Espera } from './almacen'
import { PASO_TERMINADO } from './almacen'
import type { GrupoBot, PasoId } from './tipos'
import { PASOS } from './tipos'
import { pasosFeeLibre } from '../altaLibre'

// Bienvenida: subir el video (POST /media, hasta 115 s) + mandarlo (hasta 115 s) + el texto aparte (30 s) = 260 s en el peor
// caso (CORTE_VIDEO_MS y CORTE_PEDIDO_MS de lib/bot/whapi/cliente.ts). Con menos, Vercel podía cortar la función entre el envío
// y la confirmación y la bienvenida quedaba dudosa (revisión del 24/10). Solo arranca con una invocación casi entera.
export const DURACION_MAX_MS: Record<PasoId, number> = {
  validar: 75_000, finanzas: 160_000, crm: 70_000, drive: 200_000, comunidad: 120_000, bienvenida: 265_000, skool: 20_000, contrato: 50_000,
}

/** Desde que empezó una corrida que no guardó su resultado hasta que se puede repetir el paso. */
export const COLA_DUDOSA_MS: Record<PasoId, number> = {
  validar: 60_000, skool: 60_000,
  finanzas: 660_000, crm: 660_000, drive: 660_000, comunidad: 660_000, bienvenida: 660_000, contrato: 660_000,
}

export const RECORDATORIOS_MS = [24 * 3600_000, 72 * 3600_000] as const
export const VENCE_ESPERA_MS = 14 * 86_400_000
export const VENCE_FEE_MS = 60 * 86_400_000
const OFFSET_AR_MS = -3 * 3600_000   // Argentina: UTC−3 todo el año

export interface EsperaNueva {
  paso: PasoId
  motivo: MotivoEspera
  tipos: TipoEspera[]
  grupo: GrupoBot
  quien: Quien
  pedido: string[]
  requiere: Requisito[]
  texto: string
  datos?: Record<string, unknown> | null
}

export interface MensajeDirecto {
  proposito: string
  destino: GrupoBot | 'general_cliente'
  texto: string
  citarAlta?: boolean         // cita el #ALTA (al closer)
  menciones?: string[]
}

/** Lo que devuelve cada paso. */
export interface SalidaPaso {
  estado: EstadoPaso
  resultado?: unknown
  noAntesDe?: string | null
  error?: string | null
  dudoso?: boolean
  parcial?: Record<string, unknown> | null
  esperas?: EsperaNueva[]
  avisos?: string[]            // informativos: se juntan en un solo mensaje a Verificaciones por invocación
  registro?: string[]          // lo que haría (seco/ensayo) o hizo
  cambiosAlta?: CambiosAlta
  terminarAlta?: EstadoAlta    // rechazada | duplicada
  mensajes?: MensajeDirecto[]  // al closer o al grupo del cliente (con su propósito, para no repetir)
  otraInvocacion?: boolean     // el paso quedó a medias por el plazo (comunidad): seguir en otra invocación
}

export type Accion =
  | { tipo: 'correr'; paso: PasoId; hasta: number }
  | { tipo: 'esperar_humano' }
  | { tipo: 'esperar_hasta'; cuando: string }
  | { tipo: 'otra_invocacion'; paso: PasoId }
  | { tipo: 'terminar'; estado: 'lista' | 'fee' }
  | { tipo: 'nada' }

export type Listo = { tipo: 'listo'; dudoso: boolean } | { tipo: 'terminado' } | { tipo: 'espera' } | { tipo: 'revisar' } | { tipo: 'hasta'; cuando: number }

/** En qué está un paso, mirando la hora. */
export function estadoListo(p: FilaPaso, ahora: number): Listo {
  switch (p.estado) {
    case 'hecho': case 'simulado': case 'omitido': return { tipo: 'terminado' }
    case 'espera': return { tipo: 'espera' }
    case 'revisar': return { tipo: 'revisar' }
    case 'pendiente': return { tipo: 'listo', dudoso: p.dudoso }
    case 'reintento': {
      const t = p.noAntesDe ? Date.parse(p.noAntesDe) : NaN
      return Number.isFinite(t) && t > ahora ? { tipo: 'hasta', cuando: t } : { tipo: 'listo', dudoso: p.dudoso }
    }
    case 'corriendo': {
      const t = (p.iniciado ? Date.parse(p.iniciado) : ahora) + COLA_DUDOSA_MS[p.paso]
      return t > ahora ? { tipo: 'hasta', cuando: t } : { tipo: 'listo', dudoso: true }
    }
  }
}

export interface ContextoAccion {
  /** El alta corre en seco o ensayo: las esperas no frenan y el resto corre como vista previa. */
  simulada: boolean
  /** Pasos frenados por el entorno (capacidad del alta que el entorno sacó): se reintentan en 1 h. */
  pausados?: ReadonlySet<PasoId>
}

const plan = (a: FilaAlta, simulada: boolean) => {
  const p = a.validacion?.estadoPlan ?? null
  if (p === 'fee' || p === 'renovacion' || p === 'pago_cliente') return p
  return simulada ? 'lista' : p
}

/** Dependencias de cada paso (además de validar). */
function dependeDe(paso: PasoId): PasoId[] {
  return paso === 'bienvenida' ? ['comunidad'] : []
}

export function siguienteAccion(alta: FilaAlta, pasos: Record<PasoId, FilaPaso>, ahora: number, plazo: number, ctx: ContextoAccion): Accion {
  if (['lista', 'rechazada', 'reemplazada', 'duplicada', 'simulada', 'vencida'].includes(alta.estado)) return { tipo: 'nada' }
  const pausados = ctx.pausados ?? new Set<PasoId>()
  const correr = (paso: PasoId): Accion => (ahora + DURACION_MAX_MS[paso] > plazo
    ? { tipo: 'otra_invocacion', paso }
    : { tipo: 'correr', paso, hasta: Math.min(plazo, ahora + DURACION_MAX_MS[paso]) })

  // Validar primero: todo depende de él
  const v = estadoListo(pasos.validar, ahora)
  if (v.tipo === 'listo') return correr('validar')
  if (v.tipo === 'espera' || v.tipo === 'revisar') return { tipo: 'esperar_humano' }
  if (v.tipo === 'hasta') return { tipo: 'esperar_hasta', cuando: new Date(v.cuando).toISOString() }

  const p = plan(alta, ctx.simulada)
  const candidatos: PasoId[] = p === 'fee' ? PASOS.filter((x) => pasosFeeLibre().includes(x))
    : p === 'renovacion' || p === 'pago_cliente' ? ['finanzas'] : p === 'lista' ? PASOS.filter((x) => x !== 'validar') : []
  if (!candidatos.length) return { tipo: 'esperar_humano' }   // validar terminó sin plan (no debería pasar)

  let humano = false
  let cuando = Infinity
  for (const paso of candidatos) {
    const l = estadoListo(pasos[paso], ahora)
    if (l.tipo === 'terminado') continue
    if (l.tipo === 'espera' || l.tipo === 'revisar') { humano = true; continue }
    if (l.tipo === 'hasta') { cuando = Math.min(cuando, l.cuando); continue }
    // listo: ¿sus dependencias terminaron?
    const deps = dependeDe(paso).map((d) => estadoListo(pasos[d], ahora))
    if (deps.some((d) => d.tipo === 'espera' || d.tipo === 'revisar')) { humano = true; continue }
    if (deps.some((d) => d.tipo !== 'terminado')) continue
    if (pausados.has(paso)) { cuando = Math.min(cuando, ahora + 3600_000); continue }
    return correr(paso)
  }
  if (candidatos.every((x) => estadoListo(pasos[x], ahora).tipo === 'terminado')) return { tipo: 'terminar', estado: p === 'fee' ? 'fee' : 'lista' }
  if (Number.isFinite(cuando)) return { tipo: 'esperar_hasta', cuando: new Date(cuando).toISOString() }
  if (humano) return { tipo: 'esperar_humano' }
  return { tipo: 'esperar_humano' }
}

/** Estado del alta que corresponde a una acción que frena. */
export function estadoDeEspera(alta: FilaAlta, pasos: Record<PasoId, FilaPaso>, accion: Accion): EstadoAlta {
  if (accion.tipo === 'terminar') return accion.estado
  if (accion.tipo === 'esperar_hasta') return pasos.validar.estado === 'reintento' && !alta.medios.length ? 'esperando_comprobante' : 'esperando_reintento'
  if (accion.tipo === 'otra_invocacion' || accion.tipo === 'correr') return 'en_curso'
  if (accion.tipo === 'esperar_humano') {
    if (Object.values(pasos).some((p) => p.estado === 'revisar')) return 'revisar'
    if (alta.esperas.some((e) => e.estado === 'abierta' && e.tipos.includes('comprobante'))) return 'esperando_comprobante'
    return 'esperando_humano'
  }
  return alta.estado
}

/** ¿Ya se escribió algo afuera? (revisión, punto 3): un paso más allá de validar hecho, corriendo, a revisar, en
 *  reintento después de un intento dudoso, o esperando un OK por algo que pudo haber quedado hecho. */
export function algoEscritoAfuera(pasos: Record<PasoId, FilaPaso>, esperas: readonly Espera[]): boolean {
  const escritos = PASOS.filter((p) => p !== 'validar').some((p) => {
    const x = pasos[p]
    return (x.estado === 'hecho' && p !== 'skool') || x.estado === 'corriendo' || x.estado === 'revisar' || (x.estado === 'reintento' && x.dudoso)
  })
  return escritos || esperas.some((e) => e.estado === 'abierta' && e.tipos.includes('ok_dudoso'))
}

export const pasoTerminado = (p: FilaPaso) => PASO_TERMINADO.includes(p.estado)

// ── Recordatorios y vencimientos ─────────────────────────────────────────────────────────────────────────────────

/** Primer momento desde `t` dentro de 9 a 21 h de Argentina. */
export function enHorario(t: number): number {
  const local = t + OFFSET_AR_MS
  const d = new Date(local)
  const h = d.getUTCHours()
  if (h >= 9 && h < 21) return t
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9) - OFFSET_AR_MS
  return h < 9 ? base : base + 86_400_000
}

/** Cuándo toca el próximo recordatorio de una espera abierta (null si ya no hay más). */
export function proximoRecordatorio(e: Pick<Espera, 'desde' | 'recordatorios' | 'estado'>): number | null {
  if (e.estado !== 'abierta' || e.recordatorios >= RECORDATORIOS_MS.length) return null
  return enHorario(Date.parse(e.desde) + RECORDATORIOS_MS[e.recordatorios])
}

export const venceEspera = (e: Pick<Espera, 'desde'>) => Date.parse(e.desde) + VENCE_ESPERA_MS

/** La próxima hora en que el alta tiene algo que hacer sola (recordatorio, vencimiento, reintento, Fee vencido). */
export function proximaHora(alta: FilaAlta, pasos: Record<PasoId, FilaPaso>, ahora: number): string | null {
  const ts: number[] = []
  for (const e of alta.esperas) {
    if (e.estado !== 'abierta') continue
    // Un pedido que todavía no salió (dudoso, error o pausa): se vuelve a intentar a su hora (revisión del 24/10)
    if (!e.mensajes.length && !e.enviado) ts.push(e.proximoEnvio ? Date.parse(e.proximoEnvio) : ahora)
    const r = proximoRecordatorio(e)
    if (r !== null) ts.push(r)
    ts.push(venceEspera(e))
  }
  for (const p of Object.values(pasos)) {
    const l = estadoListo(p, ahora)
    if (l.tipo === 'hasta') ts.push(l.cuando)
    if (l.tipo === 'listo' && p.estado !== 'pendiente') ts.push(ahora)
  }
  if (alta.estado === 'fee') ts.push(Date.parse(alta.creado) + VENCE_FEE_MS)
  const min = Math.min(...ts)
  return Number.isFinite(min) ? new Date(Math.max(min, ahora)).toISOString() : null
}

/** Espera antes de volver a mandar un pedido que no salió: 5 min, 30 min, 2 h y después cada 6 h (hasta que la espera
 *  vence a los 14 días). */
export function esperaReenvio(intentos: number): number {
  return [300_000, 1_800_000, 7_200_000][intentos - 1] ?? 21_600_000
}

/** Backoff de reintentos de lectura: 1, 5 y 30 min; null = ya no se reintenta (al cuarto fallo, a revisar). */
export function esperaReintento(intento: number): number | null {
  return [60_000, 300_000, 1_800_000][intento] ?? null
}
