// ── Registro de las fichas de kickoff (Neon, tabla cj_kickoffs) ─────────────────────────────────
// Una fila por recording_id de Fathom. Hace de candado (Fathom puede mandar la misma grabación más de una vez y cada pasada
// cuesta dos llamadas a Claude y un aviso a Tomi y Gero M) y guarda lo necesario para RETOMAR sin repetir, con el mismo
// estilo que lib/fathomAnuncios/registro.ts:
//   · reclamar(): INSERT … ON CONFLICT DO NOTHING; si ya existía, solo se re-reclama si quedó en "error", si quedó colgada
//     en "procesando" más de 10 minutos o si se pide forzar. Si no → duplicada. Guarda el payload (la reunión ya validada)
//     para poder reintentar sin que Fathom la reenvíe; se borra (NULL) cuando la fila llega a un estado final.
//   · guardarFicha() / guardarIdeas(): cada salida de Claude se guarda APENAS sale; un reintento con la misma versión del
//     prompt las reusa (no se vuelve a pagar Claude).
//   · anotarAviso(): el id del mensaje de Discord, apenas sale: un reintento no vuelve a avisar.
//   · marcar(): estado final o error. Lo que no se pasa queda como estaba (COALESCE); el error se pisa siempre.
//   · buscarGemela() (24/10): la misma kickoff grabada por los dos (Tomás y Gero M) llega con otro recording_id. Al reclamar
//     se guarda la clave de la reunión (columnas agendado y dedupe: horario, título del evento, HUELLAS de los mails de los
//     invitados externos y de los nombres de quienes hablan, y si se va a procesar; ver dedupe.ts) y se busca una fila
//     ANTERIOR de la misma reunión, grabada con OTRA cuenta; si la hay, esta queda "duplicada" (marcar con duplicada_de),
//     sin Claude ni aviso;
//   · grabador (24/10): qué cuenta de Fathom firmó el webhook (tomas | gero_m), para la API key del video y para decir quién
//     hizo la kickoff cuando recorded_by no alcanza;
//   · guardarZonaVideo() (24/10): la lectura del mapa desde el video (columna zona_video, ver mapa-zona.ts). La escriben
//     procesar.ts (pedido del video, sin key) y /api/bot/kickoff/mapa (leyendo, resultado). Con `libre`, solo si nadie la
//     está leyendo (candado de "leyendo" con vencimiento) y no hay una lectura terminada de la misma versión.
//   · aviso_ads (24/10): la marca del aviso a Valentino «🚀 Para lanzar» (aviso-ads.ts): reclamar() inserta la fila nueva
//     con '' (todavía sin aviso), marcar() con lista la deja "pendiente:<ms>" (en el mismo UPDATE) y ponerAvisoAdsPendiente
//     / tomarAvisoAds / anotarAvisoAds la mueven SIEMPRE con condición sobre la marca que se leyó, así sale una sola vez
//     aunque lo intenten a la vez la ruta del mapa y el barrido (pendientesAvisoAds). Una fila de antes (la de Laura) queda
//     en NULL: no sale sola, ni reprocesándola con forzar (se manda a mano).
// Columnas de la pantalla del Despacho (/clientes/<id>/kickoff): revision {tomi, gero_m} (quién aprobó las ideas y cuándo),
// portfolio_checks (lo que se tilda a mano de los ítems que ni Meta ni la llamada resolvieron) y faltantes_checks (faltantes
// marcados como hechos y los datos de lanzamiento cargados a mano; nueva del 24/10: se suma con ADD COLUMN IF NOT EXISTS al
// crear la tabla). Nacen vacías y el bot no las pisa nunca: las escriben SOLO guardarCheckPortfolio, guardarMarcaFaltante y
// guardarRevision (bloque del final), siempre con condición.
//   · purgarPayloadsViejos(): las filas que quedan en error (o colgadas) guardarían para siempre la transcripción y los mails
//     de los invitados; pasados 14 días sin cambios se les borra el payload (la llama la ruta después de cada grabación).
// Cada consulta tiene un tope de TOPE_CONSULTA_MS: sin conexión, 5xx o timeout → ErrorTransitorio. Misma base que Cuotas
// (DATABASE_URL). La tabla la crean las escrituras la primera vez; las lecturas (leerPayload, ultimas, leerKickoff) NO
// crean nada: si la tabla no existe, devuelven vacío; listarFichasCliente tampoco. Solo servidor.
// Migraciones: SOLO aditivas (ADD COLUMN IF NOT EXISTS, sin default que reescriba filas salvo faltantes_checks), mirando antes
// information_schema para no pedir el lock en cada arranque. Las filas de antes (la de Laura, A157) quedan con las columnas
// nuevas en NULL y todo las tolera: las lecturas piden las columnas nuevas con to_jsonb(cj_kickoffs) -> '…' (andan aunque la
// columna todavía no exista) y una fila sin clave de reunión no entra en la búsqueda de gemelas.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import {
  CLAVES_REVISOR, ErrorEntradaKickoff, LARGO_COMENTARIO, LARGO_NOTA, MAX_HISTORIAL, MIN_COMENTARIO_CAMBIOS, RE_HUELLA, esClaveDato, esClaveMarca,
  esClaveRevisor, esCuando, esItemPortfolio, esRecordingId, esValorCheck, leerChecks, leerMarcas, leerRevision, textoLimpio, valorDato,
  type CheckPortfolio, type ChecksPortfolio, type ClaveMarca, type ClaveRevisor, type EstadoPedidoRevision, type MarcaFaltante, type MarcasFaltantes,
  type PasoRevision, type Revision, type RevisionIdeas, type ValorCheck,
} from './revision'
import { VENTANA_BUSQUEDA_MS, leerClave, mismaReunion, type ClaveReunion, type PorQueMisma } from './dedupe'
import { quienDe, type Quien } from './grabadores'
import { VERSION_MAPA } from './mapa-prompt'
import type { ZonaVideoFicha } from './mapa-zona'
import { PREFIJO_SIN_TRANSCRIPCION, type EstadoRegistro, type ItemPortfolio } from './tipos'

export const baseConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()

export const TOPE_CONSULTA_MS = 10_000
export const ESTADOS_FINALES = ['lista', 'no_kickoff', 'omitida', 'duplicada'] as const

type Sql = NeonQueryFunction<false, false>

const sqlReal = (url: string): Sql => neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
let crearSql: (url: string) => Sql = sqlReal

/** Solo para los tests: reemplaza el cliente de Neon por uno falso (null vuelve al real) y olvida la tabla creada. */
export function sqlParaPruebas(f: ((url: string) => Sql) | null): void {
  crearSql = f ?? sqlReal
  tablaLista = null
}

/** El error de Postgres de una tabla que no existe (42P01): en las lecturas es "no hay nada", no una falla. */
const faltaTabla = (e: unknown): boolean =>
  (e as { code?: string })?.code === '42P01' || /relation "cj_kickoffs" does not exist/i.test((e as Error)?.message ?? '')
/** La columna faltantes_checks todavía no existe (42703): la tabla es de antes del 24/10 y el bot no escribió desde el deploy. */
const faltaColumna = (e: unknown): boolean =>
  (e as { code?: string })?.code === '42703' || /column "faltantes_checks" (of relation "cj_kickoffs" )?does not exist/i.test((e as Error)?.message ?? '')

async function consulta<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = crearSql(url)
  let t: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, rechazar) => {
    t = setTimeout(() => rechazar(new ErrorTransitorio(`la base no respondió en ${TOPE_CONSULTA_MS / 1000} s (${que})`)), TOPE_CONSULTA_MS)
  })
  try {
    return await Promise.race([fn(q), tope])
  } catch (e) {
    if (e instanceof ErrorTransitorio) throw e
    const m = (e as Error)?.message ?? ''
    if (/^Error connecting to database|^Server error \(HTTP status 5\d\d|TimeoutError|AbortError|aborted/i.test(m)) {
      throw new ErrorTransitorio(`la base no respondió (${que}): ${m.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 120)}`)
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

let tablaLista: Promise<void> | null = null
function asegurarTabla(): Promise<void> {
  tablaLista ??= consulta('crear tabla', async q => {
    await q`CREATE TABLE IF NOT EXISTS cj_kickoffs (
      recording_id bigint PRIMARY KEY,
      estado text NOT NULL,
      titulo text,
      url text,
      intentos int NOT NULL DEFAULT 1,
      cliente_crm text,
      id_crm text,
      ficha jsonb,
      ideas jsonb,
      revision jsonb NOT NULL DEFAULT '{"tomi": null, "gero_m": null}'::jsonb,
      portfolio_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
      faltantes_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
      grabador text,
      agendado timestamptz,
      dedupe jsonb,
      duplicada_de bigint,
      zona_video jsonb,
      version_prompt text,
      version_ideas text,
      modelo text,
      tokens_in int,
      tokens_out int,
      payload jsonb,
      aviso_discord text,
      aviso_ads text,
      error text,
      duracion_ms int,
      creado timestamptz NOT NULL DEFAULT now(),
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE INDEX IF NOT EXISTS cj_kickoffs_id_crm ON cj_kickoffs (id_crm)`
    // Una tabla creada antes no tiene las columnas nuevas: se suman acá, SOLO aditivas (las filas viejas quedan en NULL, o
    // con el default vacío en faltantes_checks). Se mira antes para no pedir el lock del ALTER en cada arranque en frío
    // (en el schema de la conexión: una copia de respaldo en otro schema no cuenta como "ya están")
    const hay = new Set((await q`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'cj_kickoffs'
      AND column_name IN ('faltantes_checks', 'grabador', 'agendado', 'dedupe', 'duplicada_de', 'zona_video', 'aviso_ads')`).map(c => String(c.column_name)))
    if (!hay.has('faltantes_checks')) await q`ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS faltantes_checks jsonb NOT NULL DEFAULT '{}'::jsonb`
    if (!hay.has('grabador')) await q`ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS grabador text`
    if (!hay.has('agendado')) await q`ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS agendado timestamptz`
    if (!hay.has('dedupe')) await q`ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS dedupe jsonb`
    if (!hay.has('duplicada_de')) await q`ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS duplicada_de bigint`
    if (!hay.has('zona_video')) await q`ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS zona_video jsonb`
    if (!hay.has('aviso_ads')) await q`ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS aviso_ads text`
  }).catch(e => { tablaLista = null; throw e })
  return tablaLista
}

/** Lo que ya había en la fila al reclamarla (para retomar). En una fila nueva, todo vacío. */
export interface ReclamoKickoff {
  intentos: number
  error_previo: string | null
  ficha: unknown
  ideas: unknown
  version_prompt: string | null
  version_ideas: string | null
  modelo: string | null
  tokens_in: number | null
  tokens_out: number | null
  aviso_discord: string | null
  grabador: Quien | null          // la cuenta de Fathom que firmó (la de este envío o la que ya estaba)
  zona_video: unknown             // la lectura del mapa de un intento anterior (leerZonaVideo de mapa-zona.ts)
}

const num = (x: unknown): number | null => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x))
const texto = (x: unknown): string | null => (typeof x === 'string' ? x : null)

function aReclamo(f: Record<string, unknown>): ReclamoKickoff {
  return {
    intentos: num(f.intentos) ?? 1,
    error_previo: texto(f.error),
    ficha: f.ficha ?? null,
    ideas: f.ideas ?? null,
    version_prompt: texto(f.version_prompt),
    version_ideas: texto(f.version_ideas),
    modelo: texto(f.modelo),
    tokens_in: num(f.tokens_in),
    tokens_out: num(f.tokens_out),
    aviso_discord: texto(f.aviso_discord),
    grabador: quienDe(f.grabador),
    zona_video: f.zona_video ?? null,
  }
}

export interface OpcionesReclamo { forzar: boolean }
/** Lo que se guarda al reclamar: además del payload, quién firmó y la clave de la reunión (para reconocer la gemela). */
export interface DatosReclamo { titulo: string; url: string; payload: unknown; grabador?: Quien | null; clave?: ClaveReunion | null }

/**
 * Se queda con la grabación (y guarda el payload) o devuelve null si otra ejecución la tiene o ya terminó (duplicada).
 * Con forzar se descartan la ficha, las ideas, el aviso y la lectura del mapa anteriores: se re-extrae y se avisa de nuevo.
 * El grabador y la clave de la reunión se guardan si vienen (un reintento sin ellos conserva los que ya estaban).
 */
export async function reclamar(id: number, op: OpcionesReclamo, datos: DatosReclamo): Promise<ReclamoKickoff | null> {
  await asegurarTabla()
  const payload = JSON.stringify(datos.payload)
  const grabador = datos.grabador ?? null
  const hora = datos.clave?.hora ?? null
  const dedupe = datos.clave ? JSON.stringify(datos.clave) : null
  return consulta('reclamar', async q => {
    // aviso_ads '' = fila nueva, todavía sin aviso a Valentino (NULL queda para las de antes del aviso: no salen solas)
    const nueva = await q`INSERT INTO cj_kickoffs (recording_id, estado, titulo, url, payload, grabador, agendado, dedupe, aviso_ads)
      VALUES (${id}, 'procesando', ${datos.titulo}, ${datos.url}, ${payload}::jsonb, ${grabador}, ${hora}::timestamptz, ${dedupe}::jsonb, '')
      ON CONFLICT (recording_id) DO NOTHING
      RETURNING intentos, error, ficha, ideas, version_prompt, version_ideas, modelo, tokens_in, tokens_out, aviso_discord, grabador, zona_video`
    if (nueva.length) return aReclamo(nueva[0] as Record<string, unknown>)
    const otra = await q`UPDATE cj_kickoffs SET
        estado = 'procesando', intentos = intentos + 1, titulo = ${datos.titulo}, url = ${datos.url},
        payload = ${payload}::jsonb, actualizado = now(),
        grabador = COALESCE(${grabador}, grabador), agendado = COALESCE(${hora}::timestamptz, agendado), dedupe = COALESCE(${dedupe}::jsonb, dedupe),
        ficha = CASE WHEN ${op.forzar}::boolean THEN NULL ELSE ficha END,
        ideas = CASE WHEN ${op.forzar}::boolean THEN NULL ELSE ideas END,
        aviso_discord = CASE WHEN ${op.forzar}::boolean THEN NULL ELSE aviso_discord END,
        zona_video = CASE WHEN ${op.forzar}::boolean THEN NULL ELSE zona_video END,
        duplicada_de = CASE WHEN ${op.forzar}::boolean THEN NULL ELSE duplicada_de END
      WHERE recording_id = ${id}
        AND (${op.forzar}::boolean OR estado = 'error' OR (estado = 'procesando' AND actualizado < now() - interval '10 minutes'))
      RETURNING intentos, error, ficha, ideas, version_prompt, version_ideas, modelo, tokens_in, tokens_out, aviso_discord, grabador, zona_video`
    return otra.length ? aReclamo(otra[0] as Record<string, unknown>) : null
  })
}

/** Una fila anterior de la MISMA reunión (la gemela de esta), según la clave guardada al reclamarla. */
export interface GemelaKickoff { recording_id: number; estado: string; grabador: Quien | null; por: PorQueMisma }

/**
 * La fila de la misma reunión (grabada por el otro) que se registró ANTES que esta, o null. Se buscan las filas con el
 * horario cerca (columna agendado, ±VENTANA_BUSQUEDA_MS) y anteriores por (creado, recording_id): así, si las dos llegan
 * juntas, solo la segunda queda duplicada. No cuentan las omitidas (otra grabación, cortada, puede ser la completa), las
 * duplicadas (se compara con la primera), las que quedaron en error por llegar sin transcripción (el webhook de esa
 * cuenta no tiene Transcript: la otra sí), las que según su clave no se van a procesar (`procesable: false`: así no gana
 * una que todavía dice "procesando" pero va a quedar en error u omitida) ni las de la MISMA cuenta de Fathom (dos partes de
 * una llamada cortada y retomada). La comparación fina es mismaReunion (dedupe.ts). Se llama después de reclamar.
 */
export async function buscarGemela(id: number, clave: ClaveReunion): Promise<GemelaKickoff | null> {
  const t = clave.hora ? Date.parse(clave.hora) : NaN
  if (!Number.isFinite(t)) return null
  await asegurarTabla()
  const desde = new Date(t - VENTANA_BUSQUEDA_MS).toISOString(), hasta = new Date(t + VENTANA_BUSQUEDA_MS).toISOString()
  const filas = await consulta('buscar gemela', q => q`SELECT c.recording_id, c.estado, c.grabador, c.dedupe
    FROM cj_kickoffs c JOIN cj_kickoffs yo ON yo.recording_id = ${id}
    WHERE c.recording_id <> ${id} AND c.agendado BETWEEN ${desde}::timestamptz AND ${hasta}::timestamptz
      AND c.estado NOT IN ('omitida', 'duplicada')
      AND NOT (c.estado = 'error' AND starts_with(COALESCE(c.error, ''), ${PREFIJO_SIN_TRANSCRIPCION}))
      AND NOT (c.grabador IS NOT NULL AND yo.grabador IS NOT NULL AND c.grabador = yo.grabador)
      AND (c.creado, c.recording_id) < (yo.creado, yo.recording_id)
    ORDER BY c.creado, c.recording_id LIMIT 10`)
  for (const f of filas as Record<string, unknown>[]) {
    const otra = leerClave(f.dedupe)
    const por = otra && otra.procesable !== false ? mismaReunion(clave, otra) : null
    if (por) return { recording_id: Number(f.recording_id), estado: String(f.estado), grabador: quienDe(f.grabador), por }
  }
  return null
}

export interface FichaGuardada {
  ficha: unknown
  cliente_crm: string | null
  id_crm: string | null
  modelo: string
  version_prompt: string
  tokens_in: number
  tokens_out: number
}

/** La ficha apenas sale de Claude (antes de pedir las ideas y de avisar). También renueva "actualizado". */
export async function guardarFicha(id: number, x: FichaGuardada): Promise<void> {
  await asegurarTabla()
  await consulta('guardar ficha', q => q`UPDATE cj_kickoffs SET
      ficha = ${JSON.stringify(x.ficha)}::jsonb, cliente_crm = ${x.cliente_crm}, id_crm = ${x.id_crm},
      modelo = ${x.modelo}, version_prompt = ${x.version_prompt}, tokens_in = ${x.tokens_in}, tokens_out = ${x.tokens_out}, actualizado = now()
    WHERE recording_id = ${id}`)
}

export interface IdeasGuardadas { ideas: unknown; version_ideas: string; tokens_in: number; tokens_out: number }

/** Las ideas apenas salen (los tokens se SUMAN a los de la ficha). */
export async function guardarIdeas(id: number, x: IdeasGuardadas): Promise<void> {
  await asegurarTabla()
  await consulta('guardar ideas', q => q`UPDATE cj_kickoffs SET
      ideas = ${JSON.stringify(x.ideas)}::jsonb, version_ideas = ${x.version_ideas},
      tokens_in = COALESCE(tokens_in, 0) + ${x.tokens_in}::int, tokens_out = COALESCE(tokens_out, 0) + ${x.tokens_out}::int, actualizado = now()
    WHERE recording_id = ${id}`)
}

/** El id del mensaje de Discord, apenas sale: un reintento ya no avisa. */
export async function anotarAviso(id: number, mensajeId: string): Promise<void> {
  await asegurarTabla()
  await consulta('anotar aviso', q => q`UPDATE cj_kickoffs SET aviso_discord = ${mensajeId}, actualizado = now() WHERE recording_id = ${id}`)
}

export interface MarcaKickoff {
  estado: Exclude<EstadoRegistro, 'procesando'>
  ficha?: unknown
  error?: string | null
  duracion_ms?: number | null
  duplicada_de?: number | null    // con estado duplicada: la grabación que ganó
  // Con lista y el aviso a Valentino prendido (aviso-ads.ts): deja la marca "pendiente:<ms>" si la fila es nueva y todavía
  // no tiene aviso ('', como la inserta reclamar) o si ya estaba pendiente (se renueva la hora). Un aviso que ya salió (o
  // que quedó dudoso, rechazado o tomado) no se toca, y una fila de antes del aviso (NULL, la de Laura) tampoco: retomar o
  // forzar el kickoff no lo repite ni manda el de una ficha vieja (ese se manda a mano, con aviso_ads=1)
  aviso_ads_desde?: number | null
}

/** Estado final (lista, no_kickoff, omitida, duplicada: además borra el payload) o error. Lo que no se pasa queda como estaba. */
export async function marcar(id: number, m: MarcaKickoff): Promise<void> {
  await asegurarTabla()
  const ficha = m.ficha === undefined || m.ficha === null ? null : JSON.stringify(m.ficha)
  const final = (ESTADOS_FINALES as readonly string[]).includes(m.estado)
  const ads = m.estado === 'lista' && typeof m.aviso_ads_desde === 'number' && Number.isSafeInteger(m.aviso_ads_desde) ? m.aviso_ads_desde : null
  await consulta('marcar', q => q`UPDATE cj_kickoffs SET
      estado = ${m.estado}, error = ${m.error ?? null},
      ficha = COALESCE(${ficha}::jsonb, ficha),
      duracion_ms = COALESCE(${m.duracion_ms ?? null}::int, duracion_ms),
      duplicada_de = COALESCE(${m.duplicada_de ?? null}::bigint, duplicada_de),
      aviso_ads = CASE WHEN ${ads}::bigint IS NOT NULL AND (aviso_ads = '' OR aviso_ads LIKE 'pendiente:%') THEN 'pendiente:' || ${ads}::bigint ELSE aviso_ads END,
      payload = CASE WHEN ${final}::boolean THEN NULL ELSE payload END,
      actualizado = now()
    WHERE recording_id = ${id}`)
}

// ── Aviso a Valentino (aviso-ads.ts): la marca de la columna aviso_ads, siempre con condición sobre lo que se leyó ──
// Solo fichas "lista". Las columnas que devuelve tomarAvisoAds son las de la pantalla (las mismas de listarFichasCliente):
// el aviso se arma con armarVista, con los tildes y las marcas que haya en ese momento.

/** Una marca "<tipo>:<ms>" (pendiente, enviando, dudoso, error) con su hora. */
const RE_MARCA_ADS = /^(pendiente|enviando|dudoso|error):[0-9]{1,15}$/

/**
 * Deja el aviso "pendiente:<desdeMs>" a mano (POST …?aviso_ads=1 o =forzar). Sin forzar, solo si nunca salió (NULL, una
 * ficha de antes; '', una nueva con el aviso apagado al quedar lista) o si se había rechazado (error); una marca pendiente
 * queda como está (no se le renueva la espera). Con forzar, sobre cualquier marca menos un envío en curso de los últimos
 * `recienteMs`. true = escribió.
 */
export async function ponerAvisoAdsPendiente(id: number, desdeMs: number, op: { forzar: boolean; ahoraMs: number; recienteMs?: number }): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(desdeMs)) return false
  await asegurarTabla()
  const reciente = op.ahoraMs - (op.recienteMs ?? 120_000)
  const filas = await consulta('aviso a Valentino: pendiente', q => q`UPDATE cj_kickoffs SET aviso_ads = 'pendiente:' || ${desdeMs}::bigint
    WHERE recording_id = ${id} AND estado = 'lista' AND (aviso_ads IS NULL OR aviso_ads = '' OR aviso_ads LIKE 'error:%'
      OR (${op.forzar}::boolean AND NOT (CASE WHEN aviso_ads ~ '^enviando:[0-9]{1,15}$' THEN split_part(aviso_ads, ':', 2)::bigint ELSE 0 END > ${reciente})))
    RETURNING recording_id`)
  return filas.length > 0
}

export type FilaAvisoAds = FilaFichaCliente & { aviso_ads?: string | null }

/**
 * Toma el aviso para mandarlo: `previo` (la marca pendiente que se leyó) → `marca` ("enviando:<ms>"), solo en una ficha
 * lista. Devuelve la fila (con lo de la pantalla) o null si otro la tomó antes o la marca cambió.
 */
export async function tomarAvisoAds(id: number, previo: string, marca: string): Promise<FilaAvisoAds | null> {
  if (!RE_MARCA_ADS.test(previo) || !RE_MARCA_ADS.test(marca)) return null
  await asegurarTabla()
  const filas = await consulta('aviso a Valentino: tomar', q => q`UPDATE cj_kickoffs SET aviso_ads = ${marca}
    WHERE recording_id = ${id} AND estado = 'lista' AND aviso_ads = ${previo}
    RETURNING recording_id, estado, titulo, url, cliente_crm, id_crm, error, ficha, ideas, revision, portfolio_checks, faltantes_checks,
      zona_video, aviso_ads, creado, actualizado`)
  if (!filas.length) return null
  const f = filas[0] as Record<string, unknown>
  return { ...aFilaCliente(f), aviso_ads: texto(f.aviso_ads) }
}

/** Anota cómo terminó (el id del mensaje, "dudoso:…", "error:…" o la marca pendiente de vuelta), solo si sigue `si`. */
export async function anotarAvisoAds(id: number, valor: string, si: string): Promise<boolean> {
  if (!valor || valor.length > 60) return false
  await asegurarTabla()
  const filas = await consulta('aviso a Valentino: anotar', q => q`UPDATE cj_kickoffs SET aviso_ads = ${valor}
    WHERE recording_id = ${id} AND aviso_ads = ${si} RETURNING recording_id`)
  return filas.length > 0
}

/**
 * Las fichas lista con el aviso pendiente desde `desdeMs` o después (las más viejas primero), para el barrido. Lectura: no
 * crea la tabla; la columna va por to_jsonb (anda aunque todavía no exista).
 */
export async function pendientesAvisoAds(limite: number, desdeMs: number): Promise<number[]> {
  const filas = await leer('aviso a Valentino: pendientes', [], q => q`SELECT recording_id FROM cj_kickoffs
    WHERE estado = 'lista' AND COALESCE(to_jsonb(cj_kickoffs) ->> 'aviso_ads', '') ~ '^pendiente:[0-9]{1,15}$'
      AND CASE WHEN COALESCE(to_jsonb(cj_kickoffs) ->> 'aviso_ads', '') ~ '^pendiente:[0-9]{1,15}$'
        THEN split_part(to_jsonb(cj_kickoffs) ->> 'aviso_ads', ':', 2)::bigint ELSE 0 END >= ${desdeMs}
    ORDER BY actualizado LIMIT ${Math.max(1, Math.min(10, Math.trunc(limite)))}`)
  return (filas as Record<string, unknown>[]).map(f => Number(f.recording_id)).filter(n => Number.isSafeInteger(n) && n > 0)
}

export interface OpcionesZonaVideo {
  /** Solo si nadie la está leyendo (un "leyendo" vigente) y no hay una lectura terminada de esta versión del mapa. */
  libre?: boolean
  /** No escribe nada (la prueba en seco): devuelve true como si hubiera escrito. */
  dry?: boolean
  /** Reloj (ms epoch) para el vencimiento del candado de "leyendo". */
  ahoraMs?: number
}

/**
 * La lectura del mapa desde el video (columna zona_video, sin tocar la ficha, el estado ni `actualizado`: esa columna es
 * del procesamiento del bot). Devuelve si escribió (con `libre`, false = otro la está leyendo o ya está leída con esta
 * versión). No crea la fila: sin fila, false.
 */
export async function guardarZonaVideo(id: number, zv: ZonaVideoFicha, op: OpcionesZonaVideo = {}): Promise<boolean> {
  if (op.dry) return true
  await asegurarTabla()
  const libre = !!op.libre, ahora = op.ahoraMs ?? Date.now()
  const filas = await consulta('guardar zona del video', q => q`UPDATE cj_kickoffs SET zona_video = ${JSON.stringify(zv)}::jsonb
    WHERE recording_id = ${id} AND (NOT ${libre}::boolean OR zona_video IS NULL
      OR COALESCE(zona_video ->> 'version', '') <> ${VERSION_MAPA}
      OR COALESCE(zona_video ->> 'estado', '') IN ('pedido', 'error', 'sin_key')
      OR (zona_video ->> 'estado' = 'leyendo' AND CASE WHEN zona_video ->> 'vence_ms' ~ '^[0-9]{1,15}$' THEN (zona_video ->> 'vence_ms')::bigint ELSE 0 END < ${ahora}))
    RETURNING recording_id`)
  return filas.length > 0
}

/** Una lectura: si la tabla todavía no existe, `vacio` (no se crea nada desde un camino de solo lectura). */
async function leer<T>(que: string, vacio: T, fn: (q: Sql) => Promise<T>): Promise<T> {
  try {
    return await consulta(que, fn)
  } catch (e) {
    if (faltaTabla(e)) return vacio
    throw e
  }
}

/**
 * El payload guardado. undefined = no hay fila (o no hay tabla); null = la fila no tiene payload. Con estado duplicada,
 * `duplicada_de` es la grabación de la misma reunión que ganó (el modo manual la nombra en vez de empujar a forzar).
 */
export async function leerPayload(id: number): Promise<{ payload: unknown; estado: string; intentos: number; grabador: Quien | null; duplicada_de: number | null } | undefined> {
  const filas = await leer('leer payload', [], q => q`SELECT payload, estado, intentos, to_jsonb(cj_kickoffs) ->> 'grabador' AS grabador,
    to_jsonb(cj_kickoffs) ->> 'duplicada_de' AS duplicada_de FROM cj_kickoffs WHERE recording_id = ${id}`)
  if (!filas.length) return undefined
  const f = filas[0] as Record<string, unknown>
  return { payload: f.payload ?? null, estado: String(f.estado), intentos: num(f.intentos) ?? 1, grabador: quienDe(f.grabador), duplicada_de: num(f.duplicada_de) }
}

export interface FilaKickoff {
  recording_id: number; estado: string; titulo: string | null; url: string | null; intentos: number
  cliente_crm: string | null; id_crm: string | null; aviso_discord: string | null; tiene_payload: boolean
  error: string | null; modelo: string | null; version_prompt: string | null; version_ideas: string | null
  tokens_in: number | null; tokens_out: number | null; duracion_ms: number | null; creado: string; actualizado: string
  grabador?: string | null; duplicada_de?: number | null
  aviso_ads?: string | null       // la marca del aviso a Valentino (aviso-ads.ts)
}

const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x))

/** Las últimas n filas, sin ficha ni payload (para el GET de estado). */
export async function ultimas(n = 10): Promise<FilaKickoff[]> {
  const filas = await leer('últimas', [], q => q`SELECT recording_id, estado, titulo, url, intentos, cliente_crm, id_crm, aviso_discord,
      (payload IS NOT NULL) AS tiene_payload, error, modelo, version_prompt, version_ideas, tokens_in, tokens_out, duracion_ms, creado, actualizado,
      to_jsonb(cj_kickoffs) ->> 'grabador' AS grabador, to_jsonb(cj_kickoffs) ->> 'duplicada_de' AS duplicada_de,
      to_jsonb(cj_kickoffs) ->> 'aviso_ads' AS aviso_ads
    FROM cj_kickoffs ORDER BY creado DESC LIMIT ${Math.max(1, Math.min(50, n))}`)
  return filas.map(f => ({
    ...(f as FilaKickoff), recording_id: Number(f.recording_id), creado: iso(f.creado), actualizado: iso(f.actualizado), duplicada_de: num(f.duplicada_de),
  }))
}

type ColumnasPantalla = { ficha: unknown; ideas: unknown; revision: unknown; portfolio_checks: unknown; faltantes_checks: unknown; zona_video?: unknown }

/** Una fila con su ficha, sus ideas, la revisión y las marcas (para el GET de estado por recording_id y la pantalla). */
export async function leerKickoff(id: number): Promise<(FilaKickoff & ColumnasPantalla) | undefined> {
  // Las columnas nuevas por to_jsonb: andan aunque todavía no existan (tabla de antes) → null
  const filas = await leer('leer kickoff', [], q => q`SELECT recording_id, estado, titulo, url, intentos, cliente_crm, id_crm, aviso_discord,
      (payload IS NOT NULL) AS tiene_payload, error, modelo, version_prompt, version_ideas, tokens_in, tokens_out, duracion_ms, creado, actualizado,
      ficha, ideas, revision, portfolio_checks, to_jsonb(cj_kickoffs) -> 'faltantes_checks' AS faltantes_checks,
      to_jsonb(cj_kickoffs) -> 'zona_video' AS zona_video, to_jsonb(cj_kickoffs) ->> 'grabador' AS grabador,
      to_jsonb(cj_kickoffs) ->> 'duplicada_de' AS duplicada_de, to_jsonb(cj_kickoffs) ->> 'aviso_ads' AS aviso_ads
    FROM cj_kickoffs WHERE recording_id = ${id}`)
  if (!filas.length) return undefined
  const f = filas[0] as Record<string, unknown>
  return {
    ...(f as unknown as FilaKickoff & ColumnasPantalla), recording_id: Number(f.recording_id), creado: iso(f.creado), actualizado: iso(f.actualizado),
    duplicada_de: num(f.duplicada_de),
  }
}

/**
 * Privacidad: las filas en error (o colgadas en "procesando") que nadie reintenta guardarían para siempre la transcripción
 * y los mails de los invitados. Pasados `dias` sin cambios se les borra el payload. Igual que fathom-anuncios.
 */
export async function purgarPayloadsViejos(dias = 14): Promise<number> {
  await asegurarTabla()
  const filas = await consulta('purgar payloads', q => q`UPDATE cj_kickoffs SET payload = NULL
    WHERE estado IN ('error', 'procesando') AND payload IS NOT NULL AND actualizado < now() - make_interval(days => ${Math.max(1, Math.trunc(dias))}::int)
    RETURNING recording_id`)
  return filas.length
}

// ── Pantalla del Despacho: fichas de un cliente, tildes del portfolio, faltantes hechos y revisión de las ideas ────────
// La lee y escribe /clientes/<id>/kickoff (página y POST /api/clientes/<id>/kickoff). Mismas reglas que el resto del archivo:
//   · listarFichasCliente: lectura, NO crea la tabla (si no existe, []), sin payload (trae la transcripción y los mails).
//     gemelasDe: las grabaciones que quedaron duplicadas de una ficha (la misma reunión, con el otro Fathom), también lectura.
//     Por id_crm sin distinguir mayúsculas (upper(id_crm): con unas pocas filas por semana el índice no hace falta).
//     faltantes_checks va por to_jsonb(): si la columna todavía no existe (tabla de antes del 24/10), sale null y no rompe.
//   · guardarCheckPortfolio / guardarMarcaFaltante / guardarRevision: UPDATE con condición sobre el `cuando` que vio la
//     persona (`previo`; null = no había nada) Y sobre el cliente (upper(id_crm) = el de la URL): si otro lo cambió en el
//     medio, o el bot rehízo la ficha y la cruzó con otro cliente, no se escribe. Después se distingue conflicto (vuelve lo
//     que hay ahora) de no_existe (no hay fila, o ya es de otro cliente). Escriben SOLO su columna (jsonb_set sobre una
//     clave), nunca la ficha ni el estado. NO crean la tabla (sin tabla no hay ficha que tildar: no_existe) y NO tocan
//     `actualizado`: esa columna es del bot (reclamar() la usa para la fila colgada a los 10 minutos y purgarPayloadsViejos
//     para los 14 días): un tilde no tiene que demorar ni lo uno ni lo otro. Única excepción: si falta la columna
//     faltantes_checks, guardarMarcaFaltante corre asegurarTabla() (que la suma con ADD COLUMN IF NOT EXISTS) y reintenta.
//   · Validan todo ANTES de tocar la base (ErrorEntradaKickoff): la API ya validó, esto es la segunda barrera.

/** Misma forma que ID_CLIENTE_VALIDO de lib/clientes/ficha.ts (A157, C003). */
export const ID_CRM_VALIDO = /^[A-Za-z]\d{1,6}$/
export const MAX_FICHAS_CLIENTE = 20

export type FilaFichaCliente = Pick<FilaKickoff, 'recording_id' | 'estado' | 'titulo' | 'url' | 'cliente_crm' | 'id_crm' | 'error' | 'creado' | 'actualizado'>
  & ColumnasPantalla

const aFilaCliente = (f: Record<string, unknown>): FilaFichaCliente => ({
  recording_id: Number(f.recording_id), estado: String(f.estado), titulo: texto(f.titulo), url: texto(f.url),
  cliente_crm: texto(f.cliente_crm), id_crm: texto(f.id_crm), error: texto(f.error),
  ficha: f.ficha ?? null, ideas: f.ideas ?? null, revision: f.revision ?? null, portfolio_checks: f.portfolio_checks ?? null,
  faltantes_checks: f.faltantes_checks ?? null, zona_video: f.zona_video ?? null,
  creado: iso(f.creado), actualizado: iso(f.actualizado),
})

/** Las fichas de un cliente, de la más nueva a la más vieja (hasta MAX_FICHAS_CLIENTE), solo las que ya tienen ficha. */
export async function listarFichasCliente(idCrm: string): Promise<FilaFichaCliente[]> {
  if (typeof idCrm !== 'string' || !ID_CRM_VALIDO.test(idCrm)) throw new ErrorEntradaKickoff('id_crm', 'ID del CRM inválido')
  const filas = await leer('fichas del cliente', [], q => q`SELECT recording_id, estado, titulo, url, cliente_crm, id_crm, error,
      ficha, ideas, revision, portfolio_checks, to_jsonb(cj_kickoffs) -> 'faltantes_checks' AS faltantes_checks,
      to_jsonb(cj_kickoffs) -> 'zona_video' AS zona_video, creado, actualizado
    FROM cj_kickoffs WHERE upper(id_crm) = ${idCrm.toUpperCase()} AND ficha IS NOT NULL
    ORDER BY creado DESC LIMIT ${MAX_FICHAS_CLIENTE}`)
  return filas.map(f => aFilaCliente(f as Record<string, unknown>))
}

/** Otra grabación de la misma reunión que quedó "duplicada" de una ficha (no tiene ficha propia: no sale en la lista). */
export interface GemelaDuplicada { recording_id: number; url: string | null; grabador: Quien | null }

/**
 * Las grabaciones que quedaron duplicadas de `id` (la misma reunión, grabada con el otro Fathom), para que la pantalla diga
 * "también la grabó Tomás" con su link. Lectura: no crea la tabla; sin la columna duplicada_de (tabla de antes), [].
 */
export async function gemelasDe(id: number): Promise<GemelaDuplicada[]> {
  if (!Number.isSafeInteger(id) || id <= 0) return []
  const filas = await leer('gemelas', [], q => q`SELECT recording_id, url, to_jsonb(cj_kickoffs) ->> 'grabador' AS grabador
    FROM cj_kickoffs WHERE estado = 'duplicada' AND to_jsonb(cj_kickoffs) ->> 'duplicada_de' = ${String(id)}
    ORDER BY creado LIMIT 5`)
  return (filas as Record<string, unknown>[]).map(f => ({ recording_id: Number(f.recording_id), url: texto(f.url), grabador: quienDe(f.grabador) }))
}

/** Quién escribe (de la sesión de Google): nombre para mostrar y mail para el registro. */
export interface QuienEscribe { nombre: string; email: string }
export type ResultadoEscritura<T> = { ok: true; actual: T } | { ok: false; motivo: 'conflicto' | 'no_existe'; actual: T | null }

function validarComun(recordingId: unknown, previo: unknown, cuando: unknown, idCrm: unknown): string {
  if (!esRecordingId(recordingId)) throw new ErrorEntradaKickoff('recording_id', 'recording_id inválido')
  if (previo !== null && !esCuando(previo)) throw new ErrorEntradaKickoff('previo', 'previo inválido')
  if (!esCuando(cuando)) throw new ErrorEntradaKickoff('cuando', 'cuando inválido')
  if (typeof idCrm !== 'string' || !ID_CRM_VALIDO.test(idCrm)) throw new ErrorEntradaKickoff('id_crm', 'ID del CRM inválido')
  return idCrm.toUpperCase()
}
function emailValido(x: unknown): string {
  const e = typeof x === 'string' ? x.trim().toLowerCase() : ''
  if (!/^[\x21-\x7e]{3,254}$/.test(e) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ErrorEntradaKickoff('email', 'mail de la sesión inválido')
  return e
}

type ColumnaPantalla = 'portfolio_checks' | 'faltantes_checks' | 'revision'

/**
 * Una escritura con condición: si no prendió, distingue "otro lo cambió" (la fila sigue siendo de ese cliente: vuelve lo
 * actual) de "no hay fila" o "ya es de otro cliente" (no_existe, sin devolver nada de la otra ficha).
 */
async function escribirConCondicion<T>(que: string, id: number, idCrm: string, leerValor: (x: unknown) => T, columna: ColumnaPantalla,
  actualizar: (q: Sql) => Promise<Record<string, unknown>[]>): Promise<ResultadoEscritura<T>> {
  try {
    return await consulta(que, async q => {
      const filas = await actualizar(q)
      if (filas.length) return { ok: true, actual: leerValor(filas[0][columna]) }
      const hay = columna === 'revision'
        ? await q`SELECT id_crm, revision FROM cj_kickoffs WHERE recording_id = ${id}`
        : columna === 'portfolio_checks'
          ? await q`SELECT id_crm, portfolio_checks FROM cj_kickoffs WHERE recording_id = ${id}`
          : await q`SELECT id_crm, faltantes_checks FROM cj_kickoffs WHERE recording_id = ${id}`
      const f = hay[0] as Record<string, unknown> | undefined
      return f && String(f.id_crm ?? '').toUpperCase() === idCrm
        ? { ok: false, motivo: 'conflicto', actual: leerValor(f[columna]) }
        : { ok: false, motivo: 'no_existe', actual: null }
    })
  } catch (e) {
    if (faltaTabla(e)) return { ok: false, motivo: 'no_existe', actual: null }
    throw e
  }
}

export interface OpcionesCheck { previo: string | null; idCrm: string; nota?: string; cuando?: string }

/**
 * Tilda a mano un ítem del portfolio (valor null = quitar el tilde). Devuelve los tildes de la fila después de escribir o,
 * si otro lo cambió desde `previo`, los de ahora sin escribir nada.
 */
export async function guardarCheckPortfolio(recordingId: number, item: ItemPortfolio, valor: ValorCheck | null, quien: QuienEscribe, op: OpcionesCheck): Promise<ResultadoEscritura<ChecksPortfolio>> {
  const previo = op.previo ?? null, cuando = op.cuando ?? new Date().toISOString()
  const idCrm = validarComun(recordingId, previo, cuando, op.idCrm)
  if (!esItemPortfolio(item)) throw new ErrorEntradaKickoff('item', 'ítem del portfolio inválido')
  if (valor !== null && !esValorCheck(valor)) throw new ErrorEntradaKickoff('valor', 'valor del tilde inválido')
  const nota = textoLimpio(op.nota ?? '', LARGO_NOTA)
  if (nota === null) throw new ErrorEntradaKickoff('nota', `nota de más de ${LARGO_NOTA} caracteres`)
  const email = emailValido(quien?.email)
  const nombre = textoLimpio(quien?.nombre ?? '', 80) || email
  const check: CheckPortfolio | null = valor === null ? null : { valor, nota, quien: nombre, email, cuando }
  return escribirConCondicion('tildar portfolio', recordingId, idCrm, leerChecks, 'portfolio_checks', q => q`UPDATE cj_kickoffs SET
      portfolio_checks = CASE WHEN ${check === null}::boolean
        THEN COALESCE(portfolio_checks, '{}'::jsonb) - ${item}::text
        ELSE jsonb_set(COALESCE(portfolio_checks, '{}'::jsonb), ARRAY[${item}::text], ${check === null ? null : JSON.stringify(check)}::jsonb, true) END
    WHERE recording_id = ${recordingId} AND upper(id_crm) = ${idCrm} AND COALESCE(portfolio_checks -> ${item}::text ->> 'cuando', '') = ${previo ?? ''}
    RETURNING portfolio_checks` as Promise<Record<string, unknown>[]>)
}

export interface OpcionesMarca { previo: string | null; idCrm: string; nota?: string; cuando?: string }

/**
 * Marca como hecho un faltante (con una nota opcional) o carga un dato de lanzamiento (la nota es el dato); hecho false lo
 * desmarca / borra. Misma condición que los tildes.
 */
export async function guardarMarcaFaltante(recordingId: number, clave: ClaveMarca, hecho: boolean, quien: QuienEscribe, op: OpcionesMarca): Promise<ResultadoEscritura<MarcasFaltantes>> {
  const previo = op.previo ?? null, cuando = op.cuando ?? new Date().toISOString()
  const idCrm = validarComun(recordingId, previo, cuando, op.idCrm)
  if (!esClaveMarca(clave)) throw new ErrorEntradaKickoff('clave', 'faltante inválido')
  if (typeof hecho !== 'boolean') throw new ErrorEntradaKickoff('hecho', 'hecho tiene que ser true o false')
  const nota = esClaveDato(clave) && hecho ? valorDato(clave, op.nota) : textoLimpio(op.nota ?? '', LARGO_NOTA)
  if (nota === null) throw new ErrorEntradaKickoff('nota', esClaveDato(clave) ? 'dato de lanzamiento inválido' : `nota de más de ${LARGO_NOTA} caracteres`)
  const email = emailValido(quien?.email)
  const nombre = textoLimpio(quien?.nombre ?? '', 80) || email
  const marca: MarcaFaltante | null = hecho ? { nota, quien: nombre, email, cuando } : null
  const escribir = () => escribirConCondicion('marcar faltante', recordingId, idCrm, leerMarcas, 'faltantes_checks', q => q`UPDATE cj_kickoffs SET
      faltantes_checks = CASE WHEN ${marca === null}::boolean
        THEN COALESCE(faltantes_checks, '{}'::jsonb) - ${clave}::text
        ELSE jsonb_set(COALESCE(faltantes_checks, '{}'::jsonb), ARRAY[${clave}::text], ${marca === null ? null : JSON.stringify(marca)}::jsonb, true) END
    WHERE recording_id = ${recordingId} AND upper(id_crm) = ${idCrm} AND COALESCE(faltantes_checks -> ${clave}::text ->> 'cuando', '') = ${previo ?? ''}
    RETURNING faltantes_checks` as Promise<Record<string, unknown>[]>)
  try {
    return await escribir()
  } catch (e) {
    if (!faltaColumna(e)) throw e
    await asegurarTabla()
    return escribir()
  }
}

export interface OpcionesRevision { previo: string | null; idCrm: string; email: string; huella: string; cuando?: string; historial?: PasoRevision[] }

/**
 * La revisión de las ideas de UNO de los revisores (la clave sale de la sesión): aprobada, cambios (con comentario) o
 * pendiente (deshace lo suyo, sin borrar el historial). Solo toca su clave de `revision`. Misma condición que los tildes.
 * `historial`: los pasos anteriores (historialNuevo() de revision.ts sobre lo que se leyó con la misma marca `previo`).
 */
export async function guardarRevision(recordingId: number, quien: ClaveRevisor, estado: EstadoPedidoRevision, comentario: string, op: OpcionesRevision): Promise<ResultadoEscritura<Revision>> {
  const previo = op.previo ?? null, cuando = op.cuando ?? new Date().toISOString()
  const idCrm = validarComun(recordingId, previo, cuando, op.idCrm)
  if (!esClaveRevisor(quien)) throw new ErrorEntradaKickoff('quien', `revisor inválido (${CLAVES_REVISOR.join(' o ')})`)
  if (estado !== 'aprobada' && estado !== 'cambios' && estado !== 'pendiente') throw new ErrorEntradaKickoff('estado', 'estado de la revisión inválido')
  const texto = textoLimpio(comentario, LARGO_COMENTARIO, true)
  if (texto === null) throw new ErrorEntradaKickoff('comentario', `comentario de más de ${LARGO_COMENTARIO} caracteres`)
  if (estado === 'cambios' && texto.length < MIN_COMENTARIO_CAMBIOS) throw new ErrorEntradaKickoff('comentario', 'pedir cambios lleva comentario')
  if (estado === 'pendiente' && texto) throw new ErrorEntradaKickoff('comentario', 'deshacer no lleva comentario')
  const email = emailValido(op.email)
  if (estado !== 'pendiente' && !RE_HUELLA.test(op.huella ?? '')) throw new ErrorEntradaKickoff('huella', 'falta la huella de las ideas')
  const historial = op.historial ?? []
  if (!Array.isArray(historial) || historial.length > MAX_HISTORIAL || !historial.every(h => (h?.estado === 'aprobada' || h?.estado === 'cambios') && esCuando(h.cuando)
    && textoLimpio(h.comentario ?? '', LARGO_COMENTARIO, true) !== null && (h.huella === '' || RE_HUELLA.test(h.huella ?? '')))) {
    throw new ErrorEntradaKickoff('historial', 'historial de la revisión inválido')
  }
  const valor: RevisionIdeas = { estado, comentario: texto, cuando, email, huella: estado === 'pendiente' ? '' : op.huella, historial }
  return escribirConCondicion('revisión de ideas', recordingId, idCrm, leerRevision, 'revision', q => q`UPDATE cj_kickoffs SET
      revision = jsonb_set(COALESCE(revision, '{"tomi": null, "gero_m": null}'::jsonb), ARRAY[${quien}::text], ${JSON.stringify(valor)}::jsonb, true)
    WHERE recording_id = ${recordingId} AND upper(id_crm) = ${idCrm} AND COALESCE(revision -> ${quien}::text ->> 'cuando', '') = ${previo ?? ''}
    RETURNING revision` as Promise<Record<string, unknown>[]>)
}
