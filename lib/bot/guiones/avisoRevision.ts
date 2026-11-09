// ── Guiones para revisar: aviso + recordatorios en ✍️-guiones (Tomás, 3/11/2026). Puro, sin red ──────────────────────────
// Pedido: «enviá siempre que estén para revisar la notificación al grupo de guiones; agregá a Gero M para que esté atento
// por si Faus se tarda mucho». Caso real: una tanda quedó «a_revisar» desde el 31/10 sin que nadie se
// enterara (el aviso salió por WhatsApp, que ya no existe).
//   · Toda tanda que pasa a «a_revisar» (nueva, corregida con las notas del cliente, rearmada con la API, retomada…) avisa
//     en ✍️-guiones mencionando a Faus (revisa y da el check final) y Gero M (atento), con cliente, tanda y link /guiones/<ID>.
//     Tomás (3/11/2026): «Faus es el que da el check final». 9/11/2026: igual se lo menciona en el aviso (corto, con link),
//     pero el check sigue siendo de Faus.
//   · Cada vuelta en «a_revisar» es una RONDA (tabla cj_guiones_revision: desde cuándo, qué aviso salió). El vigía (cada 15
//     min) y el cron diario corren correrRecordatoriosRevision: a las 24 h sale UN recordatorio «🚨 URGENTE» con el mismo
//     texto y menciones (9/11/2026; antes había otro a las 48 h). Solo de 9 a 20 h (Argentina). Cada recordatorio tiene su clave en cj_alertas_discord: nunca sale dos veces.
//     Cortan solos cuando la tanda sale de «a_revisar» (la ronda se borra).
//   · Si una tanda está en «a_revisar» sin ronda (el aviso no salió, un camino viejo), el vigía manda el aviso inicial.
import type { Alerta } from '@/lib/alertas/alerta'
import type { Mencion } from '@/lib/alertas/personas'
import type { FilaTanda } from './registro'

export type TipoRevision = 'revisar' | 'corregida'
// 9/11/2026 (Tomás): un solo recordatorio por tanda, a las 24 h, con «🚨 URGENTE» adelante (el de 48 h se sacó)
export type EtapaRecordatorio = 'rec24'

/** Quiénes se mencionan en el aviso de «para revisar»: Faus (revisa y da el check final), Tomás (9/11/2026: va siempre en el
 *  aviso; su ID sale de DISCORD_ID_TOMAS) y Gero M (atento por si Faus tarda). */
export const MENCIONES_REVISION: readonly Mencion[] = ['faus', 'tomas', 'gero_m']
export const MENCIONES_REC: Record<EtapaRecordatorio, readonly Mencion[]> = { rec24: MENCIONES_REVISION }
export const HORAS_REC: Record<EtapaRecordatorio, number> = { rec24: 24 }
export const HORA_DESDE = 9
export const HORA_HASTA = 20
/** Estados del aviso inicial que NO se reintentan (salió o pudo haber salido). */
const AVISO_OK = new Set(['enviado', 'ya_estaba', 'dudoso', 'whatsapp', 'barrido'])
/** Una ronda reservada por el vigía («enviando», sin clave) que no se completó se reintenta pasado este margen. */
export const REINTENTO_RESERVA_MS = 10 * 60_000

/** Desde cuándo está para revisar, según el aviso anotado: el id de Discord (snowflake) trae la fecha; si no, `actualizado`. */
export function desdeAviso(fila: Pick<FilaTanda, 'aviso_discord' | 'actualizado'>): string {
  const m = /^dc:(\d{15,20})$/.exec(fila.aviso_discord ?? '')
  if (m) { const ms = Number(BigInt(m[1]) >> BigInt(22)) + 1_420_070_400_000; if (Number.isFinite(ms)) return new Date(ms).toISOString() }
  return fila.actualizado
}

export interface Ronda { tanda_id: number; desde: string; tipo: TipoRevision; clave: string | null; estado: string }

const linkDe = (fila: FilaTanda) => (fila.id_crm ? `/guiones/${encodeURIComponent(fila.id_crm)}` : '/guiones')
const nombreDe = (fila: FilaTanda) => fila.cliente?.trim() || fila.id_crm || 'cliente sin nombre'

/** La clave del aviso inicial de una ronda (la misma de siempre: tanda, tipo y el momento en que pasó a revisión). */
export const claveAviso = (fila: FilaTanda, tipo: TipoRevision) => `guiones:${fila.id}:${tipo}:${fila.actualizado}`

/** El texto del aviso (Tomás, 9/11/2026): corto, sin reglas ni detalle de cambios, con las menciones y SIEMPRE el link.
 *  «Guiones de Daniel Álvarez Toscano listos para revisar. @Faus revisalos, verificá cada uno y dale al check al final. @Tomás»
 *  El recordatorio de 24 h es el mismo texto con «🚨 URGENTE» adelante. */
export function plantillaRevision(fila: FilaTanda, tipo: TipoRevision, urgente = false): string {
  const que = tipo === 'revisar' ? 'listos para revisar' : 'corregidos con lo que pidió el cliente, listos para revisar'
  return `${urgente ? '🚨 URGENTE ' : ''}Guiones de ${nombreDe(fila)} ${que}. {@faus} revisalos, verificá cada uno y dale al check al final. {@tomas} {@gero_m}\n{link}`
}

/** El aviso de «lista para revisar» (o «corregida con lo que pidió el cliente»). */
export function alertaRevision(fila: FilaTanda, tipo: TipoRevision, clave: string = claveAviso(fila, tipo)): Alerta {
  return {
    canal: 'guiones', tipo: tipo === 'revisar' ? 'guiones_revisar' : 'guiones_correcciones', clave, idCrm: fila.id_crm,
    titulo: `Guiones ${tipo === 'revisar' ? 'listos para revisar' : 'corregidos'} (tanda ${fila.tanda})`, cliente: nombreDe(fila),
    plantilla: plantillaRevision(fila, tipo), link: linkDe(fila), menciones: MENCIONES_REVISION,
  }
}

/** Horas (enteras hacia abajo) desde que la tanda quedó para revisar. */
export const horasDesde = (desde: string, ahora: Date) => Math.floor((ahora.getTime() - Date.parse(desde)) / 3_600_000)

/** Qué recordatorio toca: el de 24 h (uno solo por ronda: su clave en cj_alertas_discord no lo deja repetir). null = todavía no. */
export function etapaQueToca(desde: string, ahora: Date): EtapaRecordatorio | null {
  if (Number.isNaN(Date.parse(desde))) return null
  return horasDesde(desde, ahora) >= HORAS_REC.rec24 ? 'rec24' : null
}

export const claveRecordatorio = (r: Pick<Ronda, 'tanda_id' | 'desde'>, etapa: EtapaRecordatorio) => `guiones_revision:${r.tanda_id}:${new Date(r.desde).toISOString()}:${etapa}`

/** El recordatorio de 24 h: el mismo aviso con «🚨 URGENTE» adelante y las mismas menciones (Tomás, 9/11/2026). */
export function alertaRecordatorio(fila: FilaTanda, r: Pick<Ronda, 'tanda_id' | 'desde'>, etapa: EtapaRecordatorio, ahora: Date): Alerta {
  return {
    canal: 'guiones', tipo: `guiones_revision_${etapa}`, clave: claveRecordatorio(r, etapa), idCrm: fila.id_crm, urgente: true,
    titulo: `Guiones sin revisar hace ${horasDesde(r.desde, ahora)} h (tanda ${fila.tanda})`, cliente: nombreDe(fila),
    plantilla: plantillaRevision(fila, 'revisar', true), link: linkDe(fila), menciones: MENCIONES_REC[etapa],
  }
}

/** Hora de Argentina (0–23). */
export const horaArgentina = (d: Date) => Number(d.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false })) % 24
export const enHorario = (d: Date) => { const h = horaArgentina(d); return h >= HORA_DESDE && h < HORA_HASTA }

const fechaAR = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** UN mensaje con todas las tandas para revisar (barrido). Cada línea: cliente, tanda, desde cuándo y link. */
export function alertaBarrido(items: { fila: FilaTanda; desde: string }[], base: string, dia: string): Alerta {
  const b = base.replace(/\/+$/, '')
  return {
    canal: 'guiones', tipo: 'guiones_revision_barrido', clave: `guiones_revision_barrido:${dia}`, emoji: '📋',
    titulo: `${items.length} tanda${items.length === 1 ? '' : 's'} de guiones esperando revisión`,
    // Discord: hasta 6 viñetas por alerta (formato.ts) → 5 tandas y, si hay más, «y N más»
    lineas: [
      ...items.slice(0, items.length > 5 ? 4 : 5).map(({ fila, desde }) => `${nombreDe(fila)} (${fila.id_crm ?? 's/ID'}) · tanda ${fila.tanda} · desde el ${fechaAR(desde)} → <${b}${linkDe(fila)}>`),
      ...(items.length > 5 ? [`y ${items.length - 4} más en <${b}/guiones>`] : []),
      'Faus: revisalas, verificalas y da el check final. Gero M: atento.',
    ],
    menciones: ['faus', 'gero_m'],
  }
}

export interface DepsRecordatorios {
  /** Tandas en a_revisar (sin archivados). */
  leer(): Promise<FilaTanda[]>
  rondas(): Promise<Ronda[]>
  /** Reserva una ronda nueva (sin pisar una existente). true si la reservó. */
  reservar(r: Ronda): Promise<boolean>
  marcar(tandaId: number, estado: string): Promise<void>
  /** Borra las rondas de las tandas que ya no están para revisar. */
  limpiar(vigentes: number[]): Promise<number>
  /** El aviso inicial completo (Hub + Discord + ronda). */
  avisar(fila: FilaTanda, tipo: TipoRevision): Promise<string | null>
  alertar(a: Alerta): Promise<{ estado: string }>
}

/** Una vuelta: limpia rondas viejas, manda el aviso que falte y los recordatorios de 24/48 h (en horario). Nunca tira. */
export async function correrRecordatoriosRevision(deps: DepsRecordatorios, op: { ahora?: Date; dry?: boolean } = {}) {
  const ahora = op.ahora ?? new Date()
  const out = { avisos: [] as string[], recordatorios: [] as string[], limpiadas: 0, fueraDeHorario: !enHorario(ahora), errores: [] as string[] }
  const filas = await deps.leer()
  const rondas = new Map((await deps.rondas()).map(r => [r.tanda_id, r]))
  if (!op.dry) out.limpiadas = await deps.limpiar(filas.map(f => f.id)).catch(e => { out.errores.push(`limpiar: ${(e as Error)?.name}`); return 0 })
  for (const fila of filas) {
    const r = rondas.get(fila.id)
    try {
      if (!r) {
        // En a_revisar sin ronda: el aviso no quedó registrado → se manda ahora (reservando primero: dos vigías no duplican)
        out.avisos.push(`${fila.id_crm}: aviso inicial`)
        if (op.dry) continue
        if (!(await deps.reservar({ tanda_id: fila.id, desde: ahora.toISOString(), tipo: 'revisar', clave: null, estado: 'enviando' }))) continue
        await deps.avisar(fila, 'revisar')
        continue
      }
      if (r.estado === 'enviando' && !r.clave) {
        // Reservada por un vigía cuyo aviso tiró antes de quedar anotado (p. ej. no se pudo leer la lista de archivados): sin
        // esto la tanda quedaba sin aviso hasta el recordatorio de 24 h. Se reintenta pasados 10 min (la clave del aviso no
        // cambia mientras siga en a_revisar: alertar no lo duplica).
        if (ahora.getTime() - Date.parse(r.desde) < REINTENTO_RESERVA_MS) continue
        out.avisos.push(`${fila.id_crm}: reintento del aviso inicial`)
        if (op.dry) continue
        await deps.avisar(fila, 'revisar')
        continue
      }
      if (!AVISO_OK.has(r.estado) && r.clave) {
        // El aviso inicial falló (sin webhook, 429…): se reintenta con la MISMA clave (alertar corta a los 5 intentos)
        out.avisos.push(`${fila.id_crm}: reintento del aviso`)
        if (op.dry) continue
        const a = await deps.alertar(alertaRevision(fila, r.tipo, r.clave))
        await deps.marcar(fila.id, a.estado)
        continue
      }
      const etapa = etapaQueToca(r.desde, ahora)
      if (!etapa || out.fueraDeHorario) continue
      out.recordatorios.push(`${fila.id_crm}: ${etapa}`)
      if (op.dry) continue
      const a = await deps.alertar(alertaRecordatorio(fila, r, etapa, ahora))
      out.recordatorios[out.recordatorios.length - 1] += ` (${a.estado})`
    } catch (e) { out.errores.push(`${fila.id_crm}: ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 120)}`) }
  }
  return out
}
