// ── Preferencias de pantalla de Finanzas, POR CUENTA (1/11/2026, pedido de Tomás: «me gusta más el modo nocturno, así que
// ponelo predeterminado, pero guardá por cuenta la configuración de cada uno») ──────────────────────────────────────────
// Una fila por correo en Neon (cj_preferencias_usuario: correo, prefs jsonb, actualizado). Hoy guarda el modo nocturno y si
// la barra de cristal queda abierta o cerrada. No toca datos de Finanzas: es una tabla aparte, chica, solo de presentación.
// La cookie del navegador (fin_cristal_noche_v2 / fin_cristal_nav) queda como caché para que la página salga bien de entrada.
import { neon } from '@neondatabase/serverless'

export type PreferenciasCristal = { noche?: boolean; nav?: 'panel' | 'riel' }
/** Sin nada guardado: nocturno y barra abierta. */
export const PREFERENCIAS_POR_DEFECTO: Required<PreferenciasCristal> = { noche: true, nav: 'panel' }

const TOPE_CONSULTA_MS = 4_000
const LARGO_CORREO = 254

/** Solo las claves conocidas y con el tipo correcto (lo que llega del navegador o de la base no se usa tal cual). */
export function normalizarPreferencias(crudo: unknown): PreferenciasCristal {
  const p: PreferenciasCristal = {}
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return p
  const o = crudo as Record<string, unknown>
  if (typeof o.noche === 'boolean') p.noche = o.noche
  if (o.nav === 'panel' || o.nav === 'riel') p.nav = o.nav
  return p
}

/** Correo normalizado para usar de clave (minúsculas, sin espacios); null si no parece un correo. */
export function claveCorreo(correo: unknown): string | null {
  if (typeof correo !== 'string') return null
  const c = correo.trim().toLowerCase()
  return c.length > 2 && c.length <= LARGO_CORREO && c.includes('@') ? c : null
}

/** Lo que se muestra: lo guardado en la cuenta manda; si falta, la cookie de este navegador; si tampoco, lo predeterminado. */
export function resolverPreferencias(cuenta: PreferenciasCristal | null, cookie: { noche?: string; nav?: string }): Required<PreferenciasCristal> {
  const deCookie: PreferenciasCristal = {}
  if (cookie.noche === '1') deCookie.noche = true
  else if (cookie.noche === '0') deCookie.noche = false
  if (cookie.nav === 'panel' || cookie.nav === 'riel') deCookie.nav = cookie.nav
  return { ...PREFERENCIAS_POR_DEFECTO, ...deCookie, ...(cuenta ?? {}) }
}

type Sql = ReturnType<typeof neon>
let sqlInyectado: Sql | null = null
/** Solo para pruebas: un Neon falso. */
export function usarSqlDePrueba(s: Sql | null) { sqlInyectado = s; tablaLista = null }

export const baseConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()

function sql(): Sql {
  if (sqlInyectado) return sqlInyectado
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
}

let tablaLista: Promise<unknown> | null = null
function asegurarTabla() {
  tablaLista ??= sql()`CREATE TABLE IF NOT EXISTS cj_preferencias_usuario (
      correo text PRIMARY KEY,
      prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
      actualizado timestamptz NOT NULL DEFAULT now()
    )`.catch((e) => {
    tablaLista = null
    throw e
  })
  return tablaLista
}

/** Las preferencias guardadas de esa cuenta (null si no guardó nada todavía). */
export async function leerPreferencias(correo: string): Promise<PreferenciasCristal | null> {
  const clave = claveCorreo(correo)
  if (!clave) return null
  await asegurarTabla()
  const filas = (await sql()`SELECT prefs FROM cj_preferencias_usuario WHERE correo = ${clave}`) as { prefs: unknown }[]
  return filas.length ? normalizarPreferencias(filas[0].prefs) : null
}

/** Suma los cambios a lo que ya tenía esa cuenta (no pisa las otras claves) y devuelve cómo quedó. */
export async function guardarPreferencias(correo: string, cambios: PreferenciasCristal): Promise<PreferenciasCristal> {
  const clave = claveCorreo(correo)
  if (!clave) throw new Error('Correo no válido')
  const limpio = normalizarPreferencias(cambios)
  await asegurarTabla()
  const filas = (await sql()`INSERT INTO cj_preferencias_usuario (correo, prefs, actualizado)
    VALUES (${clave}, ${JSON.stringify(limpio)}::jsonb, now())
    ON CONFLICT (correo) DO UPDATE SET prefs = cj_preferencias_usuario.prefs || EXCLUDED.prefs, actualizado = now()
    RETURNING prefs`) as { prefs: unknown }[]
  return normalizarPreferencias(filas[0]?.prefs)
}

/** Como leerPreferencias, pero sin hacer esperar a la página: ante error o demora, null (se usa la cookie). */
export async function leerPreferenciasSinDemora(correo: string | null, topeMs = 1_500): Promise<PreferenciasCristal | null> {
  if (!correo || (!sqlInyectado && !baseConfigurada())) return null
  let reloj: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      leerPreferencias(correo),
      new Promise<null>((r) => { reloj = setTimeout(() => r(null), topeMs) }),
    ])
  } catch {
    return null
  } finally {
    if (reloj) clearTimeout(reloj)
  }
}
