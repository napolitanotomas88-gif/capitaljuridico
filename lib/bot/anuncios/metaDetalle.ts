// ── Detalle por anuncio de las campañas que tienen aviso hoy (solo LECTURA de Meta) ─────────────────
// Un batch con los tokens de lectura del tablero (batchConRespaldo: META_ANUNCIOS_TOKEN y después META_CLIENTES_TOKEN;
// nunca META_ADS_WRITE_TOKEN), por campaña: los anuncios (activos o no, con su conjunto), el gasto y los mensajes por
// anuncio desde el inicio del ciclo (en pedidos SEPARADOS: juntos, Meta devuelve spend "0" en muchas cuentas, ver
// insightsDiarios de lib/anuncios/meta.ts) y, por cuenta, el historial (activities) desde el día 3 para ver si alguien ya
// optimizó. Los anuncios se piden con TODOS los estados (también eliminados y archivados: si no, apagar o borrar algo no
// se podría cruzar con el historial) y con su fecha de creación (la tanda del ciclo). Si falla el gasto o los mensajes,
// no se arman métricas (con uno solo, un anuncio bueno saldría "sin mensajes → apagar"). Lo que falla queda vacío: el
// aviso sale igual, diciendo que no hay detalle.
import { ACCION_MENSAJE, batchConRespaldo } from '@/lib/anuncios/meta'
import { desdeDeteccion, type Candidato, type DetalleCampana, type EventoMeta } from './seguimiento'

const fechaHoraAR = (iso: string): string => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {})
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
const unixAR = (ymd: string) => Math.floor(new Date(`${ymd}T00:00:00-03:00`).getTime() / 1000)
const TEXTO_ESTADO: Record<string, number> = { activo: 1, activa: 1, inactivo: 7, inactiva: 15, eliminado: 3, eliminada: 3 }

type Actividad = { event_type?: string; event_time?: string; object_id?: string | number; object_name?: string; actor_name?: string; extra_data?: string }
/** Un evento de activities → EventoMeta (estado viejo/nuevo numérico; si solo viene el texto, se traduce). */
export function aEvento(a: Actividad): EventoMeta | null {
  if (!a.event_type || !a.event_time || a.object_id == null) return null
  let x: { run_status?: { old_value?: unknown; new_value?: unknown }; old_value?: unknown; new_value?: unknown } = {}
  try { x = JSON.parse(a.extra_data ?? '{}') } catch { /* extra_data raro: sin estados */ }
  const num = (v: unknown, texto: unknown) => (typeof v === 'number' ? v : typeof texto === 'string' ? TEXTO_ESTADO[texto.trim().toLowerCase()] ?? null : null)
  return {
    tipo: a.event_type, objeto: String(a.object_id), nombre: a.object_name ?? '', quien: a.actor_name ?? '', fecha: fechaHoraAR(a.event_time),
    viejo: num(x.run_status?.old_value, x.old_value), nuevo: num(x.run_status?.new_value, x.new_value),
  }
}

type Fila = { ad_id?: string; spend?: string; actions?: { action_type: string; value: string }[] }
type Anuncio = { id: string; name?: string; adset_id?: string; effective_status?: string; created_time?: string }
const TODOS_LOS_ESTADOS = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES']
const FILTRO_ADS = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: TODOS_LOS_ESTADOS }]))

export async function leerDetalles(cands: Candidato[], hoy: string): Promise<Map<string, DetalleCampana>> {
  const out = new Map<string, DetalleCampana>()
  if (!cands.length) return out
  const rango = (c: Candidato) => encodeURIComponent(JSON.stringify({ since: c.desde, until: hoy }))
  const pedidos: { id: string; url: string }[] = []
  for (const c of cands) {
    const id = c.l.campanaId
    pedidos.push({ id: `ads:${id}`, url: `${id}/ads?fields=id,name,adset_id,effective_status,created_time&filtering=${FILTRO_ADS}&limit=200` })
    pedidos.push({ id: `g:${id}`, url: `${id}/insights?level=ad&fields=ad_id,spend&time_range=${rango(c)}&limit=200` })
    pedidos.push({ id: `m:${id}`, url: `${id}/insights?level=ad&fields=ad_id,actions&time_range=${rango(c)}&limit=200` })
  }
  // El historial, una vez por cuenta, desde el más temprano de sus avisos
  const desdeCuenta = new Map<string, string>()
  for (const c of cands) { const d = desdeDeteccion(c); if (!desdeCuenta.has(c.fila.id) || d < desdeCuenta.get(c.fila.id)!) desdeCuenta.set(c.fila.id, d) }
  for (const [cuenta, desde] of desdeCuenta) {
    pedidos.push({ id: `act:${cuenta}`, url: `${cuenta}/activities?fields=event_type,event_time,object_id,object_name,actor_name,extra_data&since=${unixAR(desde)}&limit=500` })
  }
  const r = await batchConRespaldo(pedidos)
  const cuerpo = <T>(k: string): T[] | null => { const b = r.ok[k]?.body as { data?: T[] } | undefined; return b?.data ?? null }
  const eventosCuenta = new Map<string, EventoMeta[] | null>()
  for (const cuenta of desdeCuenta.keys()) {
    const d = cuerpo<Actividad>(`act:${cuenta}`)
    eventosCuenta.set(cuenta, d ? d.map(aEvento).filter((e): e is EventoMeta => !!e) : null)
  }
  for (const c of cands) {
    const id = c.l.campanaId
    const ads = cuerpo<Anuncio>(`ads:${id}`) ?? []
    const metricas: DetalleCampana['metricas'] = {}
    const gastos = cuerpo<Fila>(`g:${id}`), mensajes = cuerpo<Fila>(`m:${id}`)
    if (gastos && mensajes) {
      for (const f of gastos) if (f.ad_id) metricas[f.ad_id] = { gasto: Number(f.spend ?? 0) || 0, mensajes: 0 }
      for (const f of mensajes) {
        if (!f.ad_id) continue
        const n = Number(f.actions?.find(a => a.action_type === ACCION_MENSAJE)?.value ?? 0) || 0
        metricas[f.ad_id] = { gasto: metricas[f.ad_id]?.gasto ?? 0, mensajes: n }
      }
    }
    out.set(id, {
      anuncios: ads.map(a => ({ id: a.id, nombre: a.name ?? a.id, conjunto: a.adset_id ?? '', activo: a.effective_status === 'ACTIVE', creado: a.created_time ? fechaHoraAR(a.created_time).slice(0, 10) : null })),
      metricas,
      metricasOk: !!(gastos && mensajes),
      eventos: eventosCuenta.get(c.fila.id) ?? null,
    })
  }
  return out
}
