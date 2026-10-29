// ── Quién está conectado al Despacho (27/10/2026, pedido de Tomás vía el Hub de Clientes) ──────────────────────
// Cada pestaña abierta y a la vista avisa cada 45 s (POST /api/presencia, components/shell/Latido.tsx). Se guarda una fila
// por persona en Neon (cj_presencia: mail, nombre, sección y ruta de la última vez, y cuándo). "Conectado" = avisó en los
// últimos 2 minutos. La lista la ve todo el equipo (decisión de Tomás, 27/10/2026). No se guarda historial: cada aviso pisa
// el anterior de esa persona.
import { neon } from '@neondatabase/serverless'

export { INTERVALO_LATIDO_MS } from './intervalo'
export const VENTANA_CONECTADO_MS = 120_000
const TOPE_CONSULTA_MS = 8_000
const LARGO_RUTA = 120

export const baseConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()

export type Conectado = { email: string; nombre: string; seccion: string; ruta: string; ultima: string }

/** Solo la ruta, sin query ni fragmento, con largo acotado (la query puede traer datos de un lead). */
export function rutaLimpia(crudo: unknown): string {
  const s = typeof crudo === 'string' ? crudo : ''
  const ruta = s.split(/[?#]/)[0].replace(/[^\w\-./%~]/g, '')
  return (ruta.startsWith('/') ? ruta : '/').slice(0, LARGO_RUTA)
}

const SECCION_POR_PREFIJO: readonly [string, string][] = [
  ['/ventas', 'Ventas'],
  ['/cuotas', 'Cobro de cuotas'],
  ['/clientes/edicion', 'Edición'],
  ['/clientes/referidos', 'Referidos'],
  ['/clientes/altas', 'Cargar alta'],
  ['/clientes', 'Clientes'],
  ['/guiones', 'Guiones'],
  ['/anuncios', 'Anuncios'],
  ['/finanzas', 'Finanzas'],
  ['/trazabilidad', 'Trazabilidad'],
  ['/configuracion', 'Configuración'],
]

/** Nombre de la sección en la que está, a partir de la ruta ("/" = Resumen). */
export function seccionDeRuta(ruta: string): string {
  if (ruta === '/' || ruta === '') return 'Resumen'
  return SECCION_POR_PREFIJO.find(([p]) => ruta === p || ruta.startsWith(`${p}/`))?.[1] ?? 'Despacho'
}

/** Los que avisaron dentro de la ventana, el más reciente primero. Función pura (se prueba sin base). */
export function filtrarConectados(filas: readonly Conectado[], ahora: number, ventanaMs = VENTANA_CONECTADO_MS): Conectado[] {
  return filas
    .filter((f) => ahora - new Date(f.ultima).getTime() <= ventanaMs)
    .sort((a, b) => new Date(b.ultima).getTime() - new Date(a.ultima).getTime())
}

function sql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
}

let tablaLista: Promise<unknown> | null = null
function asegurarTabla() {
  tablaLista ??= sql()`CREATE TABLE IF NOT EXISTS cj_presencia (
      email text PRIMARY KEY,
      nombre text NOT NULL,
      seccion text NOT NULL,
      ruta text NOT NULL,
      ultima timestamptz NOT NULL DEFAULT now()
    )`.catch((e) => {
    tablaLista = null
    throw e
  })
  return tablaLista
}

/** Registra que esa persona sigue conectada (pisa su aviso anterior). */
export async function latido(p: { email: string; nombre: string; ruta: string }): Promise<void> {
  await asegurarTabla()
  const ruta = rutaLimpia(p.ruta)
  await sql()`INSERT INTO cj_presencia (email, nombre, seccion, ruta, ultima)
    VALUES (${p.email}, ${p.nombre.slice(0, 80)}, ${seccionDeRuta(ruta)}, ${ruta}, now())
    ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, seccion = EXCLUDED.seccion, ruta = EXCLUDED.ruta, ultima = now()`
}

/** Los conectados ahora (avisaron en los últimos 2 minutos). */
export async function conectados(): Promise<Conectado[]> {
  await asegurarTabla()
  const filas = (await sql()`SELECT email, nombre, seccion, ruta, ultima FROM cj_presencia
    WHERE ultima > now() - make_interval(secs => ${VENTANA_CONECTADO_MS / 1000})
    ORDER BY ultima DESC LIMIT 100`) as { email: string; nombre: string; seccion: string; ruta: string; ultima: Date | string }[]
  return filtrarConectados(
    filas.map((f) => ({ ...f, ultima: new Date(f.ultima).toISOString() })),
    Date.now(),
  )
}
