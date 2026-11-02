// ── Portal del cliente: lectura de Meta para el reporte de anuncios — SOLO servidor, SOLO lectura ───────────────────────────
// Lee únicamente las cuentas guardadas en el portal de ESE cliente (datos.reporte.cuentas, que carga el equipo): no hay ruta
// ni parámetro por el que el cliente pueda pedir otra cuenta. Por cuenta: la moneda y los insights por campaña y por mes desde
// siempre (date_preset=maximum, time_increment=monthly). Mensajes = la misma acción que el tablero /anuncios. Si un token no ve
// la cuenta (permisos), se prueba el siguiente (lib/anuncios/token.ts). Nada de escritura. Fetch inyectable para las pruebas.
import { ACCION_MENSAJE } from '@/lib/anuncios/meta'
import { esErrorPermisos, sinTokens, tokensMeta } from '@/lib/anuncios/token'
import { ID_CUENTA_META } from './modelo'
import type { FilaAnuncios } from './reporte'

const GRAPH = 'https://graph.facebook.com/v23.0'
const TOPE_MS = 15_000
const PAGINAS = 10

type Fetch = (url: string) => Promise<{ json(): Promise<unknown> }>
let fetchInyectado: Fetch | null = null
/** Solo para pruebas: un Graph falso. */
export function usarFetchMetaDePrueba(f: Fetch | null) { fetchInyectado = f }
const pedir: Fetch = url => (fetchInyectado ?? ((u: string) => fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(TOPE_MS) })))(url)

type ErrGraph = { message?: string; code?: number; error_subcode?: number }
type FilaGraph = { date_start?: string; campaign_name?: string; spend?: string; actions?: { action_type?: string; value?: string }[] }

export interface LecturaMeta {
  filas: FilaAnuncios[]
  /** Cuentas leídas bien */
  leidas: number
  /** Qué falló, para el EQUIPO (sin tokens ni URLs). Al cliente no se le muestra. */
  errores: string[]
}

async function leerCuenta(cuenta: string, token: string): Promise<{ ok: true; filas: FilaAnuncios[] } | { ok: false; error: ErrGraph }> {
  const info = (await (await pedir(`${GRAPH}/${cuenta}?fields=currency&access_token=${encodeURIComponent(token)}`)).json()) as { currency?: string; error?: ErrGraph }
  if (info.error) return { ok: false, error: info.error }
  if (info.currency && info.currency !== 'USD') return { ok: false, error: { message: `la cuenta está en ${info.currency}, el reporte suma en USD` } }
  const filas: FilaAnuncios[] = []
  const q = new URLSearchParams({ level: 'campaign', fields: 'campaign_name,spend,actions', time_increment: 'monthly', date_preset: 'maximum', limit: '500', access_token: token })
  let url: string | null = `${GRAPH}/${cuenta}/insights?${q}`
  for (let i = 0; url && i < PAGINAS; i++) {
    const r = (await (await pedir(url)).json()) as { data?: FilaGraph[]; paging?: { next?: string }; error?: ErrGraph }
    if (r.error) return { ok: false, error: r.error }
    for (const f of r.data ?? []) {
      if (!f.date_start) continue
      const m = (f.actions ?? []).find(a => a.action_type === ACCION_MENSAJE)
      filas.push({ mes: f.date_start.slice(0, 7), campana: String(f.campaign_name ?? ''), gasto: parseFloat(f.spend ?? '0') || 0, mensajes: parseInt(m?.value ?? '0', 10) || 0 })
    }
    url = r.paging?.next ?? null
  }
  return { ok: true, filas }
}

/**
 * Lee las cuentas del portal. Lanza si falló ALGUNA (revisión 2/11/2026): una suma parcial le mostraría al cliente menos
 * inversión y más profit del real, y quedaría en caché una hora. Así el cliente ve «lo estamos actualizando», el equipo ve qué
 * cuenta falló y la caché no guarda nada.
 */
export async function leerAnunciosPortal(cuentas: readonly string[]): Promise<LecturaMeta> {
  const validas = cuentas.filter(c => ID_CUENTA_META.test(c))
  if (!validas.length) return { filas: [], leidas: 0, errores: [] }
  const tokens = tokensMeta()
  if (!tokens.length) throw new Error('Falta configurar META_CLIENTES_TOKEN (o META_ANUNCIOS_TOKEN)')
  const filas: FilaAnuncios[] = []
  const errores: string[] = []
  let leidas = 0
  for (const cuenta of validas) {
    let ultimo: ErrGraph = { message: 'sin respuesta' }
    let ok = false
    for (const t of tokens) {
      try {
        const r = await leerCuenta(cuenta, t.token)
        if (r.ok) { filas.push(...r.filas); ok = true; break }
        ultimo = r.error
        if (!esErrorPermisos(r.error.code, r.error.error_subcode)) break
      } catch (e) {
        ultimo = { message: (e as Error)?.message ?? String(e) }
        break
      }
    }
    if (ok) leidas++
    else errores.push(`Cuenta …${cuenta.slice(-4)}: ${sinTokens(ultimo.message ?? 'error')}${ultimo.code ? ` (#${ultimo.code})` : ''}`.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
  }
  if (errores.length || !leidas) throw new Error(errores.join(' · ') || 'No se pudo leer Meta')
  return { filas, leidas, errores }
}
