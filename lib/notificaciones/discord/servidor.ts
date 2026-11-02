// ── Bandeja central → Discord: el despachador real (lo corre el vigía cada 15 min). Solo servidor ──────────────────────────
// 1. Reconciliar la bandeja (un aviso no depende de que alguien abra la campanita).
// 2. Candidatas: sin hacer, de menos de 48 h y con canal (modelo.ts). Hasta 20 por corrida, las más viejas primero.
// 3. Regla de Tomás: se revalida cada una justo antes (vigenciaReal: el estado de origen sigue igual, cliente vigente).
// 4. alertar() con clave `notif:<id>`: la misma notificación nunca sale dos veces.
import { neon } from '@neondatabase/serverless'
import { SECCIONES, type Seccion } from '../../auth/roles'
import { leerArchivados } from '../../clientes/archivados'
import { alertar } from '../../alertas'
import { reconciliarNotificaciones } from '../reconciliar'
import { vigenciaReal } from '../whatsapp/servidor'
import type { FilaPendiente } from '../whatsapp/despacho'
import { MAX_ANTIGUEDAD_MS, MAX_POR_CORRIDA, mapearDiscord, modoNotifDiscord } from './modelo'

type Fila = Record<string, unknown>
const iso = (x: unknown): string => (x instanceof Date ? x.toISOString() : String(x ?? ''))
const limpio = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\d{8,}/g, '[número]').slice(0, 160)

export interface ResultadoNotifDiscord { estado: 'apagado' | 'sin_base' | 'ok' | 'error'; enviadas: number; omitidas: number; motivo?: string }

export async function despacharNotifDiscordReal(env: Record<string, string | undefined> = process.env): Promise<ResultadoNotifDiscord> {
  if (modoNotifDiscord(env) === 'apagado') return { estado: 'apagado', enviadas: 0, omitidas: 0 }
  const db = env.DATABASE_URL?.trim()
  if (!db) return { estado: 'sin_base', enviadas: 0, omitidas: 0 }
  const q = neon(db, { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
  let arch: Promise<ReadonlySet<string>> | null = null
  const archivados = () => (arch ??= leerArchivados({ forzar: true }))
  const r: ResultadoNotifDiscord = { estado: 'ok', enviadas: 0, omitidas: 0 }
  try {
    try { await reconciliarNotificaciones(SECCIONES as readonly Seccion[], await archivados()) } catch (e) { console.error('[notif-discord] no se pudo reconciliar:', limpio(e)) }
    const desde = new Date(Date.now() - MAX_ANTIGUEDAD_MS).toISOString()
    let filas: Fila[] = []
    try {
      filas = (await q`SELECT n.id, n.clave, n.tipo, n.titulo, n.cuerpo, n.url, n.urgente, n.creada_en, n.hecha_en FROM cj_notificaciones n
        WHERE n.creada_en >= ${desde}::timestamptz AND n.hecha_en IS NULL
          AND NOT EXISTS (SELECT 1 FROM cj_alertas_discord a WHERE a.clave = 'notif:' || n.id::text AND a.estado IN ('enviado', 'dudoso', 'tope'))
        ORDER BY n.id LIMIT 200`) as Fila[]
    } catch (e) {
      if (!['42P01'].includes((e as { code?: string })?.code ?? '')) throw e
      // Sin cj_alertas_discord todavía: se crea con la primera alerta
      filas = (await q`SELECT n.id, n.clave, n.tipo, n.titulo, n.cuerpo, n.url, n.urgente, n.creada_en, n.hecha_en FROM cj_notificaciones n
        WHERE n.creada_en >= ${desde}::timestamptz AND n.hecha_en IS NULL ORDER BY n.id LIMIT 200`) as Fila[]
    }
    for (const f of filas) {
      if (r.enviadas >= MAX_POR_CORRIDA) break
      const tipo = String(f.tipo)
      const m = mapearDiscord(tipo)
      if (!m.ok) continue
      const pend: FilaPendiente = {
        id: Number(f.id), notificacionId: Number(f.id), tipo, grupo: 'OPERACIONES', destino: { grupo: 'OPERACIONES', roles: [], persona: null },
        creadaEn: iso(f.creada_en), hechaEn: f.hecha_en ? iso(f.hecha_en) : null, titulo: String(f.titulo ?? ''), url: f.url ? String(f.url) : null, clave: f.clave ? String(f.clave) : null,
      }
      const v = await vigenciaReal(pend, q, archivados)
      if (!v.ok) { r.omitidas++; continue }
      const a = await alertar({
        canal: m.canal, tipo: `notif_${tipo}`, clave: `notif:${pend.id}`, emoji: m.emoji, titulo: pend.titulo, lineas: [String(f.cuerpo ?? '').slice(0, 280), ...(v.detalle ? [v.detalle] : [])].filter(Boolean),
        link: pend.url ?? '/', menciones: m.menciones, urgente: f.urgente === true,
      })
      if (a.estado === 'enviado') r.enviadas++
    }
    return r
  } catch (e) {
    return { ...r, estado: 'error', motivo: limpio(e) }
  }
}
