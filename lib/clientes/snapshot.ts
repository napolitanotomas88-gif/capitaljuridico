// ── Snapshot en archivo de la lectura del CRM de clientes ────────────────────────────────
// Por qué existe: la service account tiene 60 lecturas por minuto COMPARTIDAS con el dashboard de
// producción; si se pasa, producción muestra las métricas en 0. Por eso esta capa lee Sheets con UNA
// llamada por carga en frío, guarda el resultado crudo acá y lo reutiliza 10 minutos (TTL). Ante un
// 429 (o cualquier error) se usa el último snapshot aunque esté vencido, y no se vuelve a insistir
// hasta pasada una espera. Jamás se lee en bucle ni por polling.
//
// Dónde vive: `.cache/` en la raíz del proyecto (ignorada por git). En Vercel el disco es de solo
// lectura salvo /tmp, así que ahí se usa os.tmpdir(). Se puede pisar con CLIENTES_CACHE_DIR.
// El archivo contiene DATOS PERSONALES de clientes (teléfonos, mails, pagos): se crea con permisos 600
// y nunca se copia ni se sube a ningún servicio.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HojasCrudas } from './tipos'

export const TTL_SNAPSHOT_MS = 10 * 60_000          // un snapshot más nuevo que esto se usa sin leer Sheets
export const MIN_ENTRE_LECTURAS_MS = 30_000         // ni forzando se lee más seguido que esto
export const ESPERA_TRAS_FALLO_MS = 60_000          // tras un error (429…) no se vuelve a intentar antes
export const TTL_PESTANA_AUSENTE_MS = 60 * 60_000   // cuánto se recuerda que una pestaña opcional no existe

export interface Snapshot {
  version: 1
  guardadoEn: number                                // epoch ms de la lectura real a Sheets
  invalidado: boolean                               // marcado como viejo a propósito (sigue sirviendo de respaldo)
  hojas: HojasCrudas
  ausentes: Record<string, number>                  // pestaña opcional → momento en que se vio que no existe
  formulasAgencia: Record<string, string> | null    // encabezado → fórmula de la fila 2 (solo fórmulas, sin datos)
  formulasRenovaciones: Record<string, string> | null  // ídem para la fila 2 de Renovaciones
  reintentarDesde: number                           // epoch ms: antes de esto no se llama a Sheets
}

const NOMBRE = 'clientes-snapshot.json'
let memoria: { mtimeMs: number; snap: Snapshot } | null = null

export function dirCache(): string {
  if (process.env.CLIENTES_CACHE_DIR) return process.env.CLIENTES_CACHE_DIR
  return process.env.VERCEL ? join(tmpdir(), 'dashboard-cache') : join(process.cwd(), '.cache')
}
export const rutaSnapshot = (): string => join(dirCache(), NOMBRE)

const esSnapshot = (x: unknown): x is Snapshot => {
  const s = x as Snapshot
  return !!s && s.version === 1 && typeof s.guardadoEn === 'number' && !!s.hojas && Array.isArray(s.hojas.agencia)
    && Array.isArray(s.hojas.consultora) && Array.isArray(s.hojas.renovaciones)
}

// Lee el snapshot (memoria del proceso mientras el archivo no cambie; si no, del disco). Un archivo
// ausente, ilegible o de otra versión es simplemente "no hay snapshot".
export function leerSnapshot(): Snapshot | null {
  try {
    const ruta = rutaSnapshot()
    if (!existsSync(ruta)) return null
    const mtimeMs = statSync(ruta).mtimeMs
    if (memoria && memoria.mtimeMs === mtimeMs) return memoria.snap
    const snap = JSON.parse(readFileSync(ruta, 'utf8')) as unknown
    if (!esSnapshot(snap)) return null
    memoria = { mtimeMs, snap }
    return snap
  } catch {
    return null
  }
}

// Escritura atómica (archivo temporal + rename) con permisos 600. Si el disco no se puede escribir
// no es un error: la carga sigue funcionando sin snapshot.
export function guardarSnapshot(snap: Snapshot): boolean {
  try {
    const dir = dirCache()
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const ruta = rutaSnapshot(), tmp = `${ruta}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(snap), { mode: 0o600 })
    renameSync(tmp, ruta)
    try { chmodSync(ruta, 0o600) } catch { /* en algunos discos no aplica */ }
    memoria = { mtimeMs: statSync(ruta).mtimeMs, snap }
    return true
  } catch (e) {
    console.error(`Snapshot de clientes: no se pudo guardar (${(e as Error).message.slice(0, 120)})`)
    return false
  }
}

export const edadSnapshot = (snap: Snapshot, ahora = Date.now()): number => Math.max(0, ahora - snap.guardadoEn)

// ¿Se puede usar tal cual, sin leer Sheets?
export const snapshotFresco = (snap: Snapshot, ttlMs = TTL_SNAPSHOT_MS, ahora = Date.now()): boolean =>
  !snap.invalidado && edadSnapshot(snap, ahora) < ttlMs

// Descarta la caché SIN borrar los datos: la próxima carga vuelve a leer Sheets, pero si esa lectura
// falla (429) todavía hay con qué responder. También olvida las pestañas "que no existen" para
// detectar las que se acaban de crear. El mínimo entre lecturas sigue valiendo.
export function invalidarSnapshot(): boolean {
  const snap = leerSnapshot()
  if (!snap) return false
  return guardarSnapshot({ ...snap, invalidado: true, ausentes: {}, reintentarDesde: 0 })
}
