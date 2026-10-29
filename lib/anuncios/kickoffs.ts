// ── Fichas de kickoff para "Por lanzar" (Neon, tabla cj_kickoffs): SOLO lectura ──────────────────────────────────────
// La tabla es del bot de kickoff (lib/bot/kickoff/registro.ts la crea y la escribe). Acá solo un SELECT, con las mismas
// reglas que sus lecturas, pero con un tope corto: el tablero no espera a la base.
//   · Sin DATABASE_URL → null ("no se sabe"): "Por lanzar" queda como antes, sin la marca "sin ficha de kickoff".
//   · La tabla no existe todavía (42P01) → [] (no hay fichas): no es una falla.
//   · Dos topes: el tablero espera ESPERA_KICKOFFS_MS (conTope en tablero.ts: no suma latencia aunque la caché esté
//     calculando) y la consulta se corta a los TOPE_CONSULTA_KICKOFFS_MS. Con Neon "dormido" (arranque en frío) la primera
//     lectura puede pasar los 3 s: el tablero sale sin la ficha, la consulta sigue y su resultado queda en la caché para la
//     próxima carga. tablero.ts lo pasa por conCache (refresco cada REFRESCO.kickoffsSeg, con el último dato bueno si la
//     base falla). Si falla, lanza.
//   · Pausa tras una falla (crearLecturaConPausa): sin un último dato bueno (por ejemplo, después de un deploy) conCache
//     vuelve a la base en cada pedido, y lo piden la pantalla (cada 15 s), los crons, el PDF y /clientes. Si la lectura
//     falla, durante PAUSA_KICKOFFS_MS ni se consulta la base ni se espera: sale el mismo motivo. Un tope vencido no pausa
//     (la consulta sigue y, si termina bien, queda en la caché).
//   · El aviso (avisoLecturaFichas) va a los avisos de "Por lanzar", no a los del tablero: el reporte semanal de Discord no
//     lo arrastra.
//   · Solo las filas "lista" que son kickoff, sin payload (la transcripción y los mails de los invitados) ni la columna
//     ideas (las de la ficha alcanzan: con "lista", armarVista no la usa) y SIN los ganadores de la ficha (anuncios de OTROS
//     clientes, con su nombre y su copy): no salen de la base. Las columnas nuevas del 24/10 (faltantes_checks, zona_video)
//     van por to_jsonb(): andan aunque la tabla sea de antes y no las tenga.
//   · Lo que se cachea es el resumen de cada ficha (porLanzar.ts), no la fila: chico y sin nada que no se muestre.
// El motivo de un error pasa sin URLs (el de conexión puede traer el host) y recortado: termina en los avisos del tablero.
import { neon } from '@neondatabase/serverless'
import type { FilaFichaCliente } from '@/lib/bot/kickoff/registro'
import { resumirKickoffs, type KickoffPorLanzar } from './porLanzar'

export const ESPERA_KICKOFFS_MS = 3_000
export const TOPE_CONSULTA_KICKOFFS_MS = 8_000
export const PAUSA_KICKOFFS_MS = 60_000
export const QUE_KICKOFFS = 'fichas de kickoff'
const MAX_FILAS = 300
// El dominio del Despacho para el link a la ficha: mismo criterio que urlDespacho() de lib/bot/kickoff/entorno.ts (no se
// importa: arrastra lib/fathomAnuncios/procesar). DESPACHO_URL si es https; si no, el de producción.
export const URL_DESPACHO = 'https://despacho-capital-juridico.vercel.app'
export function baseDespacho(env: Record<string, string | undefined> = process.env): string {
  const b = env.DESPACHO_URL?.trim() ?? ''
  try {
    if (new URL(b).protocol === 'https:') return b.replace(/\/+$/, '')
  } catch { /* sin DESPACHO_URL o mal formada */ }
  return URL_DESPACHO
}

/** Sin URLs (el error de conexión puede traer el host de la base) y corto: va a los avisos de la pantalla. */
export const motivoCorto = (e: unknown): string => String((e as Error)?.message ?? e ?? 'error').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 140)

/** Espera la promesa hasta `ms`; después rechaza (la promesa sigue: si termina, su resultado queda en la caché). */
export function conTope<T>(p: Promise<T>, ms: number, que: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${que}: tardó más de ${(ms / 1000).toLocaleString('es-AR')} s`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}
/** ¿El error es el del tope de conTope (y no una falla de la base)? */
export const esTopeVencido = (mensaje: string, que: string = QUE_KICKOFFS): boolean => mensaje.startsWith(`${que}: tardó más de `)

/**
 * `leer` con tope y con pausa tras una falla: si `leer` rechaza (también después de vencido el tope), los pedidos de los
 * próximos `pausaMs` rechazan al toque con el mismo motivo, sin llamarla. El estado vive en la memoria de la instancia.
 */
export function crearLecturaConPausa<T>(leer: () => Promise<T>, op: { esperaMs: number; pausaMs: number; que: string; ahora?: () => number }): () => Promise<T> {
  const ahora = op.ahora ?? Date.now
  let pausa = { hasta: 0, motivo: '' }
  return () => {
    if (ahora() < pausa.hasta) return Promise.reject(new Error(pausa.motivo))
    const p = leer().catch((e: unknown) => {
      pausa = { hasta: ahora() + op.pausaMs, motivo: (e as Error)?.message ?? String(e) }
      throw e
    })
    return conTope(p, op.esperaMs, op.que)
  }
}

/** El aviso de "Por lanzar" por la lectura de las fichas (null = se leyeron bien). `haceTiempo`: el de formato.ts. */
export function avisoLecturaFichas(r: { ok: true; v: { viejo?: boolean; at: number } } | { ok: false; error: string }, haceTiempo: (t: number) => string): string | null {
  if (!r.ok) return esTopeVencido(r.error)
    ? 'Las fichas de kickoff tardaron en llegar de la base del Despacho: «Por lanzar» sale sin la ficha por ahora (se suman solas en la próxima actualización).'
    : `No se pudieron leer las fichas de kickoff (${motivoCorto(r.error)}): «Por lanzar» sale sin la ficha, con ClickUp.`
  return r.v.viejo ? `La base del Despacho no respondió: fichas de kickoff de ${haceTiempo(r.v.at)}.` : null
}

const faltaTabla = (e: unknown): boolean =>
  (e as { code?: string })?.code === '42P01' || /relation "cj_kickoffs" does not exist/i.test((e as Error)?.message ?? '')
const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x ?? ''))
const texto = (x: unknown): string | null => (typeof x === 'string' ? x : null)

/** Una fila de la consulta → la forma que lee armarVista (la de listarFichasCliente de registro.ts). */
export const aFila = (f: Record<string, unknown>): FilaFichaCliente => ({
  recording_id: Number(f.recording_id), estado: String(f.estado), titulo: texto(f.titulo), url: texto(f.url),
  cliente_crm: texto(f.cliente_crm), id_crm: texto(f.id_crm), error: texto(f.error),
  ficha: f.ficha ?? null, ideas: null, revision: f.revision ?? null, portfolio_checks: f.portfolio_checks ?? null,
  faltantes_checks: f.faltantes_checks ?? null, zona_video: f.zona_video ?? null,
  creado: iso(f.creado), actualizado: iso(f.actualizado),
})

/** Las tarjetas de "Por lanzar" (la última kickoff lista de cada cliente). null = no hay base configurada. */
export async function leerFichasKickoff(ahoraMs: number = Date.now()): Promise<KickoffPorLanzar[] | null> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) return null
  const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_KICKOFFS_MS) } })
  let filas: Record<string, unknown>[]
  try {
    filas = await q`SELECT recording_id, estado, titulo, url, cliente_crm, id_crm, error, (ficha - 'ganadores') AS ficha, revision, portfolio_checks,
        to_jsonb(cj_kickoffs) -> 'faltantes_checks' AS faltantes_checks, to_jsonb(cj_kickoffs) -> 'zona_video' AS zona_video, creado, actualizado
      FROM cj_kickoffs
      WHERE estado = 'lista' AND ficha IS NOT NULL AND ficha ->> 'tipo_reunion' = 'kickoff'
      ORDER BY creado DESC LIMIT ${MAX_FILAS}` as Record<string, unknown>[]
  } catch (e) {
    if (faltaTabla(e)) return []
    throw new Error(`la base del Despacho no respondió: ${motivoCorto(e)}`)
  }
  return resumirKickoffs(filas.map(aFila), { base: baseDespacho(), ahoraMs })
}
