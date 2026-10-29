// ── Notificaciones del Despacho en Neon (SOLO servidor) ───────────────────────────────────────────────────────────────
// Las reglas puras están en modelo.ts. Tablas (se crean solas con la primera notificación; sin tabla, la lectura da []):
//   · cj_notificaciones: una fila por notificación (a una persona, a una sección o a todos). clave única opcional para no
//     duplicar lo que crean los bots y los crons.
//   · cj_notificaciones_vistas: quién vio qué (por persona, aunque la notificación vaya a una sección).
// crearNotificacion() la llaman los bots, crons y webhooks directo, sin pasar por HTTP. Lo que se lee y marca desde el
// navegador pasa por app/api/notificaciones (sesión de Google). Contrato acordado con DASHBOARD PWA VERCEL (27/10/2026).
import { neon } from '@neondatabase/serverless'
import type { Seccion } from '../auth/roles'
import { limpiarNueva, MAX_LISTA, type Notificacion, type NuevaNotificacion } from './modelo'

const TOPE_LECTURA_MS = 4_000
const TOPE_ESCRITURA_MS = 10_000
export const baseNotificacionesConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()
// Un tope por consulta (con Neon despertando, uno compartido entre varias consultas no alcanza)
const sql = (tope: number) => {
  const url = process.env.DATABASE_URL!.trim()
  return ((partes: TemplateStringsArray, ...valores: unknown[]) => neon(url, { fetchOptions: { signal: AbortSignal.timeout(tope) } })(partes, ...valores)) as ReturnType<typeof neon>
}
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01'
const yaExiste = (e: unknown) => ['23505', '42P07'].includes((e as { code?: string })?.code ?? '')

async function crearTablas(): Promise<void> {
  const q = sql(TOPE_ESCRITURA_MS)
  for (const crear of [
    () => q`CREATE TABLE IF NOT EXISTS cj_notificaciones (
      id bigserial PRIMARY KEY, creada_en timestamptz NOT NULL DEFAULT now(),
      para_email text, para_seccion text, tipo text NOT NULL, titulo text NOT NULL, cuerpo text NOT NULL DEFAULT '',
      url text, urgente boolean NOT NULL DEFAULT false, hecha_en timestamptz, hecha_por text,
      origen text NOT NULL, clave text UNIQUE)`,
    () => q`CREATE INDEX IF NOT EXISTS cj_notificaciones_pendientes ON cj_notificaciones (hecha_en, urgente, creada_en)`,
    () => q`CREATE TABLE IF NOT EXISTS cj_notificaciones_vistas (
      notificacion_id bigint NOT NULL, email text NOT NULL, vista_en timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (notificacion_id, email))`,
  ]) {
    try { await crear() } catch (e) { if (!yaExiste(e)) throw e }
  }
}

const iso = (x: unknown): string | null => (x instanceof Date ? x.toISOString() : x ? String(x) : null)
const aNotificacion = (f: Record<string, unknown>): Notificacion => ({
  id: Number(f.id), creadaEn: iso(f.creada_en) ?? '', paraEmail: f.para_email ? String(f.para_email) : null,
  paraSeccion: f.para_seccion ? (String(f.para_seccion) as Seccion) : null, tipo: String(f.tipo), titulo: String(f.titulo),
  cuerpo: String(f.cuerpo ?? ''), url: f.url ? String(f.url) : null, urgente: f.urgente === true,
  hechaEn: iso(f.hecha_en), hechaPor: f.hecha_por ? String(f.hecha_por) : null, origen: String(f.origen), vista: f.vista === true,
})

/**
 * Crea una notificación (bots, crons, webhooks, acciones del Hub). Con `clave`, no se duplica: si ya existe, devuelve null.
 * Nunca rompe a quien la llama por un problema de la base: devuelve null y lo deja en el log.
 */
export async function crearNotificacion(n: NuevaNotificacion): Promise<number | null> {
  const v = limpiarNueva(n)
  if (typeof v === 'string') { console.error('[notificaciones] no se creó:', v); return null }
  if (!baseNotificacionesConfigurada()) return null
  const insertar = async () => {
    const filas = (await sql(TOPE_ESCRITURA_MS)`INSERT INTO cj_notificaciones (para_email, para_seccion, tipo, titulo, cuerpo, url, urgente, origen, clave)
      VALUES (${v.paraEmail}, ${v.paraSeccion}, ${v.tipo}, ${v.titulo}, ${v.cuerpo}, ${v.url}, ${v.urgente}, ${v.origen}, ${v.clave})
      ON CONFLICT (clave) DO NOTHING RETURNING id`) as Record<string, unknown>[]
    return filas.length ? Number(filas[0].id) : null
  }
  try {
    try { return await insertar() } catch (e) {
      if (!faltaTabla(e)) throw e
      await crearTablas()
      return await insertar()
    }
  } catch (e) {
    console.error('[notificaciones] error al crear:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    return null
  }
}

/**
 * Las notificaciones que ve esta persona (por mail, por sus secciones o para todos).
 *   · desde: solo las de id mayor (para el sondeo del cartel cada 30 s).
 *   · pendientes: solo las sin hacer (para el menú rápido), urgentes primero y de la más vieja a la más nueva.
 */
export async function listarNotificaciones(p: { email: string; secciones: readonly Seccion[]; desde?: number; pendientes?: boolean; historial?: boolean }): Promise<Notificacion[]> {
  if (!baseNotificacionesConfigurada()) return []
  const email = p.email.toLowerCase()
  const desde = Number.isSafeInteger(p.desde) && (p.desde ?? 0) > 0 ? p.desde! : 0
  const secciones = [...p.secciones]
  try {
    const filas = (p.historial
      ? await sql(TOPE_LECTURA_MS)`SELECT n.*, (v.email IS NOT NULL) AS vista FROM cj_notificaciones n
          LEFT JOIN cj_notificaciones_vistas v ON v.notificacion_id = n.id AND v.email = ${email}
          WHERE (lower(n.para_email) = ${email} OR (n.para_email IS NULL AND (n.para_seccion IS NULL OR n.para_seccion = ANY(${secciones}::text[]))))
          ORDER BY n.id DESC LIMIT ${MAX_LISTA}`
      : p.pendientes
      ? await sql(TOPE_LECTURA_MS)`SELECT n.*, (v.email IS NOT NULL) AS vista FROM cj_notificaciones n
          LEFT JOIN cj_notificaciones_vistas v ON v.notificacion_id = n.id AND v.email = ${email}
          WHERE n.hecha_en IS NULL AND (lower(n.para_email) = ${email} OR (n.para_email IS NULL AND (n.para_seccion IS NULL OR n.para_seccion = ANY(${secciones}::text[]))))
          ORDER BY n.urgente DESC, n.creada_en ASC LIMIT ${MAX_LISTA}`
      : await sql(TOPE_LECTURA_MS)`SELECT n.*, (v.email IS NOT NULL) AS vista FROM cj_notificaciones n
          LEFT JOIN cj_notificaciones_vistas v ON v.notificacion_id = n.id AND v.email = ${email}
          WHERE n.id > ${desde} AND (lower(n.para_email) = ${email} OR (n.para_email IS NULL AND (n.para_seccion IS NULL OR n.para_seccion = ANY(${secciones}::text[]))))
          ORDER BY n.id ASC LIMIT ${MAX_LISTA}`) as Record<string, unknown>[]
    return filas.map(aNotificacion)
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

/** Marca una notificación como vista (por esta persona) o hecha (para todos). Solo si esta persona la puede ver. */
export async function marcarNotificacion(id: number, accion: 'vista' | 'hecha', quien: { email: string; nombre: string; secciones: readonly Seccion[] }): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) return false
  const email = quien.email.toLowerCase()
  const secciones = [...quien.secciones]
  const q = sql(TOPE_ESCRITURA_MS)
  try {
    const visible = (await q`SELECT id FROM cj_notificaciones WHERE id = ${id}
      AND (lower(para_email) = ${email} OR (para_email IS NULL AND (para_seccion IS NULL OR para_seccion = ANY(${secciones}::text[]))))`) as unknown[]
    if (!visible.length) return false
    if (accion === 'vista') await q`INSERT INTO cj_notificaciones_vistas (notificacion_id, email) VALUES (${id}, ${email}) ON CONFLICT DO NOTHING`
    else await q`UPDATE cj_notificaciones SET hecha_en = COALESCE(hecha_en, now()), hecha_por = COALESCE(hecha_por, ${quien.nombre || email}) WHERE id = ${id}`
    return true
  } catch (e) {
    if (faltaTabla(e)) return false
    throw e
  }
}

/** Cierra exclusivamente avisos derivados cuyo estado de origen ya fue resuelto. No toca avisos humanos ni de bots. */
export async function cerrarNotificacionesDeOrigen(origen: string, clavesVigentes: string[]): Promise<void> {
  if (!baseNotificacionesConfigurada() || (!origen.startsWith('reconciliar-') && origen !== 'seguimiento-inactivos')) return
  try {
    await sql(TOPE_ESCRITURA_MS)`UPDATE cj_notificaciones SET hecha_en = now(), hecha_por = 'Sistema (estado actualizado)'
      WHERE origen = ${origen} AND hecha_en IS NULL AND NOT (clave = ANY(${clavesVigentes}::text[]))`
  } catch (e) { if (!faltaTabla(e)) throw e }
}

/** Sólo claves: permite limitar escrituras NUEVAS sin que los avisos ya existentes consuman siempre el cupo. */
export async function clavesNotificadas(claves: readonly string[]): Promise<Set<string>> {
  if (!baseNotificacionesConfigurada() || !claves.length) return new Set()
  try {
    const filas = await sql(TOPE_LECTURA_MS)`SELECT clave FROM cj_notificaciones WHERE clave = ANY(${[...claves]}::text[])` as { clave: string }[]
    return new Set(filas.map(f => f.clave))
  } catch (e) { if (faltaTabla(e)) return new Set(); throw e }
}
