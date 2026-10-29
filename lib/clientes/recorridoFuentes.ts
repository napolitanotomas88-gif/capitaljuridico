// ── Recorrido: lecturas del Despacho (Neon) para la línea de tiempo de la cartera (SOLO servidor, SOLO lectura) ──────────
// La regla de qué etapa le toca a cada cliente está en recorrido.ts (pura). Acá se leen, en paralelo y con tope corto, las
// tres tablas del Despacho que la alimentan; Meta y ClickUp ya los lee la página (lib/clientes/produccion.ts) y se reusan.
//   · Fichas de kickoff: la MISMA caché que "Por lanzar" del tablero de anuncios (clave kickoffs-lanzar-v2 y leerFichasKickoff
//     de lib/anuncios/kickoffs.ts): no suma consultas a la base.
//   · Guiones: la última tanda de cada cliente (cj_guiones, la escribe lib/bot/guiones/registro.ts), sin los guiones ni las notas.
//   · Videos: cuántos tiene cada cliente en grabación, en edición, aprobados y pausados, y su último movimiento (cj_videos).
// Lo que se cachea son ARRAYS de pares: conCache guarda en JSON (unstable_cache) y un Map volvería como {}.
// Si una lectura falla o tarda, la línea de tiempo sale igual sin ese dato (lecturas.despacho = false) y avisa arriba.
import { neon } from '@neondatabase/serverless'
import { conCache } from '../anuncios/cache'
import { crearLecturaConPausa, leerFichasKickoff, motivoCorto, PAUSA_KICKOFFS_MS } from '../anuncios/kickoffs'
import type { KickoffPorLanzar } from '../anuncios/porLanzar'
import { claveNombre, type CampanaMeta } from './prioridad'
import { campanasMeta } from './produccion'
import type { EstadoTandaResumen, KickoffResumen, TandaResumen, VideosResumen } from './recorrido'

const TOPE_MS = 4_000
const CACHE_SEG = 120
const GRABACION = ['esperando_crudos', 'crudo_a_revisar', 'regrabar']
const EDICION = ['para_editar', 'editado', 'correccion', 'corregido', 'con_cliente']
// Solo "la tabla no existe" (42P01): un error de columna (42703) tiene que verse como falla, no como "sin datos"
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "[^"]+" does not exist/i.test((e as Error)?.message ?? '')
const dia = (x: unknown): string | null => {
  if (!x) return null
  const d = x instanceof Date ? x : new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}
const entero = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)


export interface DespachoRecorrido {
  kickoffDe: (id: string, nombre: string) => (KickoffResumen & { tarjeta: KickoffPorLanzar }) | null
  tandaDe: (id: string) => TandaResumen | null
  videosDe: (id: string) => VideosResumen | null
  ok: boolean
  aviso: string | null
}

async function leerTandas(): Promise<[string, TandaResumen][]> {
  const q = neon(process.env.DATABASE_URL!.trim())
  try {
    // La última tanda de cada cliente (para la etapa) y, de TODAS sus tandas, las primeras fechas para el registro: al corregir
    // una tanda se borran su aprobación y su envío, así que el primer envío también se toma de la primera nota del cliente
    const filas = (await q`WITH t AS (
        SELECT upper(id_crm) AS id, tanda, estado, actualizado, creado, aprobacion, whatsapp, notas, guiones FROM cj_guiones WHERE id_crm IS NOT NULL
      ), ultima AS (
        SELECT DISTINCT ON (id) id, tanda, estado, actualizado, (SELECT count(*) FROM jsonb_object_keys(COALESCE(guiones, '{}'::jsonb))) AS n FROM t ORDER BY id, creado DESC
      ), primeras AS (
        SELECT id,
          min(creado) FILTER (WHERE estado IN ('aprobada', 'enviada', 'con_notas', 'corrigiendo') OR aprobacion IS NOT NULL OR whatsapp IS NOT NULL) AS hechos,
          min((aprobacion ->> 'cuando')::timestamptz) AS aprobada,
          min((whatsapp ->> 'cuando')::timestamptz) AS enviada,
          min((SELECT min((x ->> 'cuando')::timestamptz) FROM jsonb_array_elements(COALESCE(notas, '[]'::jsonb)) x)) AS nota
        FROM t GROUP BY id
      )
      SELECT u.id, u.tanda, u.estado, u.actualizado, u.n, p.hechos, p.aprobada, p.enviada, p.nota FROM ultima u JOIN primeras p USING (id)`) as Record<string, unknown>[]
    return filas.map(f => [String(f.id), {
      tanda: entero(f.tanda), estado: String(f.estado) as EstadoTandaResumen, actualizado: dia(f.actualizado), guiones: entero(f.n),
      creado: dia(f.hechos), aprobada: dia(f.aprobada), enviada: dia(f.enviada), notaCliente: dia(f.nota),
    }])
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

async function leerVideos(): Promise<[string, VideosResumen][]> {
  const q = neon(process.env.DATABASE_URL!.trim())
  try {
    const filas = (await q`SELECT upper(id_crm) AS id,
        count(*) FILTER (WHERE estado = ANY(${GRABACION}::text[])) AS g, max(estado_desde) FILTER (WHERE estado = ANY(${GRABACION}::text[])) AS ug,
        count(*) FILTER (WHERE estado = ANY(${EDICION}::text[])) AS e, max(estado_desde) FILTER (WHERE estado = ANY(${EDICION}::text[])) AS ue,
        count(*) FILTER (WHERE estado = 'aprobado') AS a, max(estado_desde) FILTER (WHERE estado = 'aprobado') AS ua,
        count(*) FILTER (WHERE estado = 'pausado') AS p
      FROM cj_videos GROUP BY upper(id_crm)`) as Record<string, unknown>[]
    // Para el registro: cuándo llegó el PRIMER crudo y el primer editado (fecha de creación en Drive de los archivos vinculados)
    let archivos: Record<string, unknown>[] = []
    try {
      archivos = (await q`SELECT upper(id_crm) AS id, min(creado_drive) FILTER (WHERE tipo = 'crudo') AS cr, min(creado_drive) FILTER (WHERE tipo = 'editado') AS ed
        FROM cj_grab_archivos WHERE borrado IS NULL GROUP BY upper(id_crm)`) as Record<string, unknown>[]
    } catch (e) { if (!faltaTabla(e)) throw e }
    const porArchivo = new Map(archivos.map(a => [String(a.id), a]))
    return filas.map(f => [String(f.id), {
      grabacion: entero(f.g), edicion: entero(f.e), aprobados: entero(f.a), pausados: entero(f.p),
      ultimoGrabacion: dia(f.ug), ultimoEdicion: dia(f.ue), ultimoAprobado: dia(f.ua),
      crudoRecibido: dia(porArchivo.get(String(f.id))?.cr), editado: dia(porArchivo.get(String(f.id))?.ed),
    }])
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

// Fichas: la misma caché de "Por lanzar", con pausa tras una falla (con Neon caído no se espera el tope en cada carga)
const leerKickoffs = crearLecturaConPausa(() => conCache('kickoffs-lanzar-v2', 300, () => leerFichasKickoff()), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'fichas de kickoff' })
const leerTandasPausa = crearLecturaConPausa(() => conCache('recorrido-tandas-v4', CACHE_SEG, leerTandas), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'guiones' })
const leerVideosPausa = crearLecturaConPausa(() => conCache('recorrido-videos-v4', CACHE_SEG, leerVideos), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'videos' })

const VACIO: DespachoRecorrido = { kickoffDe: () => null, tandaDe: () => null, videosDe: () => null, ok: false, aviso: null }

/** Las tres lecturas del Despacho para la línea de tiempo. Nunca rechaza: lo que falla queda vacío y con aviso. */
export async function leerDespachoRecorrido(): Promise<DespachoRecorrido> {
  if (!process.env.DATABASE_URL?.trim()) return { ...VACIO, aviso: 'La base del Despacho no está configurada: las etapas salen de Meta y ClickUp.' }
  const [k, t, v] = await Promise.allSettled([leerKickoffs(), leerTandasPausa(), leerVideosPausa()])
  const fallas = [k, t, v].filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  for (const f of fallas) console.error('[recorrido] Despacho:', motivoCorto(f.reason))
  const fichas = k.status === 'fulfilled' ? k.value.data ?? [] : []
  const porId = new Map<string, KickoffPorLanzar>(), porNombre = new Map<string, KickoffPorLanzar>()
  // leerFichasKickoff viene de la más nueva a la más vieja: se queda la primera de cada cliente
  for (const x of fichas) {
    if (x.idCrm && !porId.has(x.idCrm.toUpperCase())) porId.set(x.idCrm.toUpperCase(), x)
    if (x.clienteCRM && !porNombre.has(claveNombre(x.clienteCRM))) porNombre.set(claveNombre(x.clienteCRM), x)
  }
  const tandas = new Map(t.status === 'fulfilled' && Array.isArray(t.value.data) ? t.value.data : [])
  const videos = new Map(v.status === 'fulfilled' && Array.isArray(v.value.data) ? v.value.data : [])
  return {
    kickoffDe: (id, nombre) => {
      const x = porId.get(id.toUpperCase()) ?? porNombre.get(claveNombre(nombre))
      return x ? { fecha: dia(x.fechaIso), frenos: x.frenos.filter(f => f.frena).length, ideas: x.ideas, tarjeta: x } : null
    },
    tandaDe: id => tandas.get(id.toUpperCase()) ?? null,
    videosDe: id => videos.get(id.toUpperCase()) ?? null,
    ok: fallas.length === 0,
    aviso: fallas.length ? 'La base del Despacho tardó en responder: algunas etapas pueden salir de ClickUp (recargá en un minuto).' : null,
  }
}

// ── Campañas de Meta para la cartera, con caché propia (optimización 25/10/2026) ──
// campanasMeta (produccion.ts) arma el tablero de anuncios entero en cada pedido (~0,7 s aunque Meta esté en caché), y la
// cartera vuelve a armarse cada vez que se abre o cierra la tarjeta de un cliente. Acá se guarda solo lo que usa la cartera
// (un par nombre → campaña por cliente, JSON) con stale-while-revalidate de 2 min: se sirve al toque y se refresca de fondo.
// Si Meta tardó (aviso), no se cachea la respuesta vacía: se tira para que conCache devuelva el último dato bueno.
const META_CARTERA_SEG = 120
const META_VIEJO_MS = 10 * 60_000
// La página no espera más de ESPERA_META_MS, pero la lectura de fondo sí (hasta 25 s): así el refresco de la caché no se corta
// por el mismo tope cuando el tablero tarda (Meta frío), y la próxima carga ya lo tiene.
const ESPERA_META_MS = 4_000
export async function campanasMetaCartera(): Promise<{ porCliente: Map<string, CampanaMeta>; aviso: string | null }> {
  try {
    const lectura = conCache('cartera-meta-v2', META_CARTERA_SEG, async () => {
      const m = await campanasMeta(25_000)
      if (m.aviso) throw new Error(m.aviso)
      // Un tablero incompleto (cuentas o planillas caídas) devuelve cero campañas sin aviso: no se guarda sobre el último bueno
      if (m.porCliente.size === 0) throw new Error('Meta devolvió el tablero sin campañas: se muestra sin el dato de campañas.')
      return [...m.porCliente]
    })
    lectura.catch(() => { /* si vence el tope, la lectura sigue de fondo y su error no queda suelto */ })
    const r = await Promise.race([lectura, new Promise<null>(res => setTimeout(() => res(null), ESPERA_META_MS))])
    if (!r) return { porCliente: new Map(), aviso: 'Meta tardó en responder: se muestra sin el dato de campañas (recargá en un minuto).' }
    // La caché compartida sirve el dato anterior si el refresco de fondo falla sin marcarlo: se avisa también por edad
    const viejo = r.viejo || Date.now() - r.at > META_VIEJO_MS
    return {
      porCliente: new Map(Array.isArray(r.data) ? r.data : []),
      aviso: viejo ? `Meta no respondió: las campañas son de una lectura de hace ${Math.round((Date.now() - r.at) / 60_000)} min.` : null,
    }
  } catch (e) {
    return { porCliente: new Map(), aviso: String((e as Error)?.message ?? 'No se pudo leer Meta: se muestra sin el dato de campañas.') }
  }
}

// ── Éxito confirmado por el bot (CONSULTOR, lib/bot/exito): tabla cj_exito_pedidos, SOLO lectura ──
// Cuenta como éxito con OK: aprobado, enviado y dudoso (aprobado_simulado es el ensayo: no cuenta). id_crm puede ser null: ahí
// se cruza por el nombre del cliente. La tabla se crea con la primera escritura del bot: sin tabla, vacío.
export interface ExitoBot { fecha: string | null; testimonio: string | null; por: string | null }
async function leerExitosBot(): Promise<{ porId: [string, ExitoBot][]; porNombre: [string, ExitoBot][] }> {
  const q = neon(process.env.DATABASE_URL!.trim())
  let filas: Record<string, unknown>[] = []
  try {
    filas = (await q`SELECT id_crm, cliente, por, resuelto, creado, testimonio_en FROM cj_exito_pedidos
      WHERE estado IN ('aprobado', 'enviado', 'dudoso') ORDER BY COALESCE(resuelto, creado)`) as Record<string, unknown>[]
  } catch (e) {
    if (faltaTabla(e)) return { porId: [], porNombre: [] }
    throw e
  }
  const porId = new Map<string, ExitoBot>(), porNombre = new Map<string, ExitoBot>()
  for (const f of filas) {
    const e: ExitoBot = { fecha: dia(f.resuelto ?? f.creado), testimonio: dia(f.testimonio_en), por: f.por ? String(f.por) : null }
    const id = f.id_crm ? String(f.id_crm).toUpperCase() : null
    // el primer OK de cada cliente (vienen ordenados del más viejo al más nuevo); el testimonio, si llegó en cualquiera
    const guardar = (m: Map<string, ExitoBot>, k: string) => { const p = m.get(k); m.set(k, p ? { ...p, testimonio: p.testimonio ?? e.testimonio } : e) }
    if (id) guardar(porId, id)
    else if (f.cliente) guardar(porNombre, claveNombre(String(f.cliente)))
  }
  return { porId: [...porId], porNombre: [...porNombre] }
}
const leerExitosPausa = crearLecturaConPausa(() => conCache('cartera-exito-bot-v1', 120, leerExitosBot), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'éxitos del bot' })

/** El éxito confirmado por el bot de cada cliente (por ID del CRM o, si el pedido no lo tiene, por el nombre). Nunca rechaza. */
export async function exitosDelBot(): Promise<(id: string, nombre: string) => ExitoBot | null> {
  if (!process.env.DATABASE_URL?.trim()) return () => null
  try {
    const r = await leerExitosPausa()
    const porId = new Map(Array.isArray(r.data?.porId) ? r.data.porId : []), porNombre = new Map(Array.isArray(r.data?.porNombre) ? r.data.porNombre : [])
    return (id, nombre) => porId.get(id.toUpperCase()) ?? porNombre.get(claveNombre(nombre)) ?? null
  } catch (e) {
    console.error('[recorrido] éxitos del bot:', motivoCorto(e))
    return () => null
  }
}
