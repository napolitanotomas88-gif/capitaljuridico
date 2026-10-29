// ── Orquestador: una grabación de Fathom → ficha de kickoff → ideas de guiones → aviso a Tomi y Gero M ───
// procesarKickoff() hace el recorrido completo con las dependencias INYECTADAS (base, CRM, Claude, Meta, Discord, reloj),
// igual que lib/fathomAnuncios/procesar.ts: los tests lo prueban con fakes y la ruta le pasa las reales (servidor.ts).
//   1. valida el payload (el mismo formato de Fathom que /api/fathom-anuncios);
//   2. con dry no toca la base ni Discord (sí lee el CRM y Meta, y llama a Claude: es para probar de verdad);
//   3. reclama la grabación en cj_kickoffs y guarda el payload (si otra ejecución la tiene o ya terminó → "duplicada");
//   4. sin transcripción → "error" con un aviso a Tomás (una sola vez): falta activar Transcript en el webhook. Menos de
//      MIN_RENGLONES renglones o menos de 3 minutos → "omitida", sin Claude;
//   5. mientras Claude lee la llamada, ya se piden en paralelo los ganadores de la rama PROBABLE (clasificarRama sobre el
//      resumen de Fathom o la transcripción): así casi nunca hay que esperar a Meta después;
//   6. CRM (best effort) + extracción con Claude (esfuerzo high) → ficha base, que se guarda APENAS sale;
//   7. si no es un kickoff (seguimiento, venta, equipo, otra) → "no_kickoff": sin ideas, ni portfolio, ni aviso;
//   8. en paralelo: el PORTFOLIO del cliente en Meta (portfolio.ts, solo GET: busca su cuenta y chequea los 7 ítems; tope
//      topePortfolioMs, 15 s, con race; también en dry, porque es lectura) y los ganadores de la rama de la ficha
//      (topeGanadoresMs, 8 s), primero los del país del cliente y SIN las cuentas del cliente: las del CRM y las que encontró
//      la búsqueda del portfolio (a Laura, A157, su cuenta solo aparece por el descubrimiento). Si Meta falla o tarda, se
//      sigue sin ganadores y con el portfolio "no se pudo leer" (lo de la llamada queda), anotado en los ajustes. Nunca
//      frena la ficha. El descubrimiento de cuentas (lo lento del portfolio, ~9 s en frío) se precalienta con
//      prepararPortfolio() mientras Claude lee la llamada;
//   9. ideas con Claude (esfuerzo medium) con la ficha + ganadores + base de la rama (kb/), que se guardan apenas salen;
//  10. ficha final (portfolio_final = Meta cruzado con la llamada, ver ficha.ts), aviso de Discord a Tomi y Gero M (una vez:
//      el id queda anotado) y "lista". El payload se borra;
//  11. (27/10) con un kickoff con ideas, arranca sola la tanda de guiones (deps.dispararGuiones, disparo-guiones.ts): las
//      ideas ya no esperan la aprobación de Tomi y Gero M; quedan en la ficha para comentar.
// La misma kickoff grabada por los dos (24/10): al reclamar se guarda la clave de la reunión (dedupe.ts: horario, título del
// evento, huellas de los mails de los invitados externos y de los nombres de quienes hablan, y si la grabación se va a
// procesar) y se busca una fila ANTERIOR de la misma reunión (deps.gemela, registro.buscarGemela). Si la hay, esta queda
// "duplicada" con referencia a la primera, sin Claude ni aviso (aunque la primera siga "procesando": gana la primera). Con
// forzar no se busca, y tampoco si esta no se va a procesar (sin transcripción o cortada): queda con su estado (error u
// omitida) y nunca le gana a la otra.
// Quién grabó (24/10): op.grabador es la cuenta de Fathom que firmó el webhook (tomas | gero_m); se guarda en la fila y sirve
// para la API key del video y para el "Kickoff de Tomás / de Gero M" si recorded_by no alcanza.
// Zona desde el video (24/10, tarea c03): si es un kickoff con zona.mapa_en_pantalla y se sabe con qué cuenta se grabó, el
// video se le pide a Fathom APENAS sale la ficha (deps.pedirVideo, solo el POST /download, que no lanza: Fathom lo genera
// mientras siguen Meta y las ideas) y el download_id se guarda (columna zona_video, estado "pedido"). Con la ficha "lista",
// se dispara /api/bot/kickoff/mapa (deps.dispararMapa: Bearer CRON_SECRET, espera solo el 202, tope corto), que retoma esa
// descarga, mira los cuadros con Claude y guarda el bloque. Si el disparo falla, queda anotado en zona_video (error, para
// reintentar) y la ficha sigue "lista". Sin FATHOM_API_KEY_<QUIEN> no se pide nada: zona_video "sin_key" y el faltante del
// mapa dice "conectar la API key de Fathom de <quien> para leer el mapa". En dry NO se pide el video (no se crean descargas
// en Fathom). Al retomar, si el mapa ya está leído con la misma VERSION_MAPA (o se está leyendo), no se repite; si quedó
// "pedido", se retoma esa descarga. Sin el minuto de la zona (timestamp mal formado o fuera de la llamada) no se pide nada:
// queda anotado el porqué. Si la ruta del mapa responde que no y ya anotó la causa (sin ffmpeg, sin la clave de Claude),
// no se pisa con un "no se pudo disparar". Los tiempos del disparo se acotan al deadline (se reservan 12 s para escribir).
// Sin deps.hayApiKey (los fakes viejos de los tests) no se mira el mapa.
// Aviso a Valentino «🚀 Para lanzar» (24/10, aviso-ads.ts; solo con deps.avisoAds: prendido y con canal): al marcar la ficha
// "lista" queda la marca "pendiente" (mismo UPDATE). Si la lectura del mapa quedó en marcha (la ruta la aceptó, o el
// disparo no respondió y puede haberla aceptado), lo manda la ruta del mapa cuando termina (o el barrido, si se cuelga);
// si no, sale acá enseguida. Una sola vez por grabación: retomar o forzar el kickoff no lo repite, y una ficha de antes del
// aviso (marca NULL) no lo manda ni forzándola (se manda a mano). En dry no se manda nada: la respuesta trae el texto
// (mensaje_ads). Lo que corre en after() del webhook (procesar, purgar y el barrido de los avisos pendientes) es
// trasWebhook, al final de este archivo.
// Retomar sin repetir: si la fila ya tiene la ficha de la MISMA versión del prompt, se reusa (no se vuelve a pagar Claude);
// las ideas, solo si además se reusó la ficha (unas ideas viejas sobre una ficha re-extraída podrían ser de otra rama) y son
// de la misma versión; el portfolio se vuelve a chequear siempre (es barato y puede haber cambiado); y el aviso, si ya salió,
// no se repite. Si Discord publicó pero la base no anotó el id, la fila queda
// en error con el prefijo PREFIJO_AVISO_ENVIADO y el id: un reintento lo toma como salido. Con forzar se rehace todo y se
// avisa de nuevo.
// Tiempo: un deadline único (t0 + PLAZO_MS). La extracción deja lugar para los ganadores, las ideas y el aviso; si un paso
// falla con un error transitorio (Claude 429/5xx/529/red, Neon de red) y queda tiempo, se espera ESPERA_REINTENTO_MS y se
// reintenta ese paso UNA vez. Discord NO se reintenta acá: enviarDiscord ya reintenta 429 y 5xx, y un timeout puede haber
// publicado igual (un segundo POST duplicaría el aviso); ese caso se le avisa a Tomás como dudoso.
// Ante un error: "error" en el registro con el motivo (lo que ya salió queda guardado) y UN aviso corto a Tomás en el mismo
// canal. Los motivos se limpian (sin URLs ni claves) antes de guardarlos o mandarlos.
import type { Rama } from '@/lib/anuncios/ramas'
import { validarReunion } from '@/lib/fathomAnuncios/tipos'
import { LARGO_AVISO, duracionGrabacionS, formatearTranscripcion } from '@/lib/fathomAnuncios/transcripcion'
import { ErrorTransitorio, esTransitorio } from '@/lib/fathomAnuncios/errores'
import { motivoDe } from '@/lib/fathomAnuncios/procesar'
import type { EntradaExtraccion } from './extraer'
import type { EntradaIdeas } from './ideas'
import { VERSION_PROMPT } from './prompt'
import { VERSION_IDEAS } from './prompt-ideas'
import { claveDeReunion, type ClaveReunion } from './dedupe'
import { armarFicha, cuentaDeGrabacion, fichaMarkdown } from './ficha'
import { elegirGanadores, paisDeTexto, ramaProbable, type CandidatosRama } from './ganadores'
import { armarAviso, linkFicha, textoAvisoSinAnotar, textoErrorKickoff, textoSinTranscripcionKickoff, usuariosMencionados, type Menciones } from './mensaje'
import { idCuenta, paraFicha, portfolioSinLectura, type BusquedaCuenta, type ClienteParaCuenta, type PortfolioMeta } from './portfolio'
import { GRABADORES, type Quien } from './grabadores'
import { momentosMapa, type PedidoVideo } from './mapa'
import type { ErrorDisparoMapa } from './mapa-api'
import { VERSION_MAPA } from './mapa-prompt'
import { ESTADOS_MAPA_HECHO, MOTIVO_SIN_MOMENTO, leerZonaVideo, textoSinKeyMapa, type EstadoZonaVideoFicha, type ZonaVideoFicha } from './mapa-zona'
import type { DatosReclamo, FichaGuardada, GemelaKickoff, IdeasGuardadas, MarcaKickoff, OpcionesReclamo, ReclamoKickoff } from './registro'
import { barrerAvisosAds, filaParaAviso, intentarAvisoAds, textoAvisoAds, type DepsAvisoAds, type ResultadoAvisoAds } from './aviso-ads'
import {
  ITEMS_PORTFOLIO, PREFIJO_SIN_TRANSCRIPCION, REVISORES, TIPOS_REUNION,
  type ContextoKickoff, type ExtraccionKickoff, type FichaKickoff, type GanadoresFicha, type IdeasFicha, type LecturaPortfolioMeta,
  type ResultadoExtraccionKickoff, type ResultadoIdeas, type ReunionFathom, type Uso,
} from './tipos'

export { motivoDe, PREFIJO_SIN_TRANSCRIPCION }

export const MIN_RENGLONES = 6
export const MIN_DURACION_S = 3 * 60

// ── Tiempos (maxDuration de la ruta: 300 s) ──
export const PLAZO_MS = 280_000                 // deadline desde que arranca el procesamiento
// Lo que se guarda, después de Claude, para guardar las ideas (hasta TOPE_CONSULTA_MS de registro.ts, 10 s), mandar a
// Discord (que corta RESERVA_ESCRITURAS_MS antes del deadline) y registrar: 20 + 10 + unos 15 s de envío → 50 s. Con 25 s,
// unas ideas lentas dejaban a Discord entre 0 y 5 s y la fila quedaba en error sin aviso.
export const MARGEN_ENVIO_MS = 50_000
export const RESERVA_IDEAS_MS = 80_000          // lo que la extracción le deja a las ideas
export const TOPE_GANADORES_MS = 8_000          // lo máximo que se espera a Meta después de la extracción
// El portfolio: búsqueda de la cuenta (con la caché del tablero caliente, ~0 s; en frío ~9 s, por eso se precalienta) + el
// chequeo (2–4 s). Corre en paralelo con los ganadores, así que la extracción reserva el mayor de los dos topes.
export const TOPE_PORTFOLIO_MS = 15_000
export const MIN_CLAUDE_MS = 45_000             // con menos que esto no vale la pena arrancar una llamada a Claude
export const ESPERA_REINTENTO_MS = 6_000
export const RESERVA_ESCRITURAS_MS = 20_000     // Discord termina 20 s antes del deadline: quedan anotarAviso y marcar
const MIN_RESTANTE = { base: 15_000, claude: MARGEN_ENVIO_MS + MIN_CLAUDE_MS }
export const PREFIJO_AVISO_ENVIADO = 'aviso_enviado:'
// Zona desde el video: lo que se espera, con la ficha lista, el POST /download que se largó temprano (casi siempre ya
// respondió hace rato) y el disparo de /api/bot/kickoff/mapa (solo hasta su 202)
export const TOPE_PEDIDO_VIDEO_MS = 12_000
export const TOPE_DISPARO_MAPA_MS = 8_000
// Lo que se reserva antes del deadline para escribir zona_video (TOPE_CONSULTA_MS de registro.ts, 10 s, y un margen): con
// menos, no se dispara ni se escribe (queda "pedido" y la pantalla lo da por cortado a los 20 minutos, para reintentar)
export const RESERVA_ZONA_MS = 12_000
// Con el mapa por leer, las ideas dejan además esto para el disparo (esperar el POST /download temprano y el 202)
export const MARGEN_MAPA_MS = 10_000

/**
 * El payload que se guarda para reintentar: la reunión validada más el inicio y el fin agendados (validarReunion no los
 * conserva; el inicio hace falta para reconocer la misma reunión grabada por el otro, también al reintentar).
 */
export type PayloadGuardado = ReunionFathom & { scheduled_end_time: string | null; scheduled_start_time?: string | null }

/** Lo que devuelve el chequeo del portfolio (portfolioDelCliente de portfolio.ts). */
export type ResultadoPortfolio = PortfolioMeta & { busqueda?: BusquedaCuenta | null }

export interface DepsKickoff {
  reclamar(id: number, op: OpcionesReclamo, datos: DatosReclamo & { payload: PayloadGuardado }): Promise<ReclamoKickoff | null>
  /** La grabación de la MISMA reunión (grabada por el otro) registrada antes que esta, o null (registro.buscarGemela). */
  gemela?(id: number, clave: ClaveReunion): Promise<GemelaKickoff | null>
  guardarFicha(id: number, x: FichaGuardada): Promise<void>
  guardarIdeas(id: number, x: IdeasGuardadas): Promise<void>
  anotarAviso(id: number, mensajeId: string): Promise<void>
  marcar(id: number, m: MarcaKickoff): Promise<void>
  contexto(): Promise<ContextoKickoff>
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  /** topeMs: lo máximo que puede tardar este intento (claude.ts además lo recorta a 240 s). */
  extraer(e: EntradaExtraccion, topeMs: number): Promise<ResultadoExtraccionKickoff>
  /** Los anuncios ganadores (crudos, cacheados) de una rama. Puede tardar o fallar: procesar.ts lo acota. */
  candidatos(rama: Rama): Promise<CandidatosRama>
  /** El portfolio del cliente en Meta (solo GET): busca su cuenta y chequea los 7 ítems. procesar.ts además lo corta a topeMs. */
  portfolio(cliente: ClienteParaCuenta, topeMs: number): Promise<ResultadoPortfolio>
  /** Precalienta lo lento del portfolio (el descubrimiento de cuentas del tablero) mientras Claude lee la llamada. No lanza. */
  prepararPortfolio?(): void
  kb(rama: Rama | null): { texto: string; version: string } | null
  ideas(e: EntradaIdeas, topeMs: number): Promise<ResultadoIdeas>
  /** Manda UN mensaje (mencionando solo a `menciones`) sin pasarse del deadline y devuelve su id. */
  enviar(texto: string, menciones: string[], deadline: number): Promise<string>
  /** Aviso de error a Tomás (mismo canal). */
  avisar(texto: string): Promise<void>
  esperar(ms: number): Promise<void>
  ahora(): number
  menciones: Menciones
  tomas: string | null
  urlBase: string
  /** ¿El aviso lleva link a la pantalla de la ficha en el Despacho? Por defecto sí (KICKOFF_PANTALLA=0 lo apaga); sin id_crm, nunca. */
  pantallaFicha?: boolean
  discordListo: boolean
  topeGanadoresMs?: number
  topePortfolioMs?: number
  // ── Zona desde el video. Sin hayApiKey no se mira el mapa (así los fakes viejos de los tests no cambian). ──
  /** ¿Hay FATHOM_API_KEY_<QUIEN>? (solo el nombre de la variable: el valor no sale de servidor.ts) */
  hayApiKey?(quien: Quien): boolean
  /** El POST /download temprano (pedirVideoSeguro de mapa.ts): nunca lanza. */
  pedirVideo?(id: number, quien: Quien): Promise<PedidoVideo>
  /** Guarda la lectura del mapa (columna zona_video); con libre, solo si nadie la está leyendo. */
  guardarZonaVideo?(id: number, zv: ZonaVideoFicha, op?: { libre?: boolean }): Promise<boolean>
  /** Dispara /api/bot/kickoff/mapa (Bearer CRON_SECRET) y espera SOLO la respuesta (202), con tope. Lanza si no la aceptó. */
  dispararMapa?(datos: { recording_id: number; quien: Quien; descarga_id: string | null }, topeMs: number): Promise<void>
  // ── Aviso a Valentino (aviso-ads.ts). Sin avisoAds (apagado, sin canal o los fakes viejos) no se deja la marca ni se manda. ──
  avisoAds?: DepsAvisoAds | null
  /** ID de Discord de Valentino para el texto en seco (con avisoAds manda el suyo). */
  valentino?: string | null
  // ── Tanda de guiones (27/10): arranca sola con la ficha «lista» y con ideas. Sin esto (apagado o fakes viejos), no. ──
  /** POST /api/bot/guiones {recording_id} (disparo-guiones.ts): espera solo el 202, nunca lanza. */
  dispararGuiones?(recordingId: number): Promise<string>
}

export type EstadoKickoff = 'invalida' | 'duplicada' | 'omitida' | 'no_kickoff' | 'lista' | 'error' | 'dry'

/** Qué se hizo con la zona desde el video (para el log y la respuesta del modo manual). */
export interface ResultadoMapaKickoff {
  plan: PlanMapa['tipo']
  quien: Quien | null
  estado: EstadoZonaVideoFicha | 'disparado' | null
  download_id?: string | null
  motivo?: string
}

export interface ResultadoKickoff {
  estado: EstadoKickoff
  recording_id?: number
  motivo?: string
  duplicada_de?: number           // con duplicada: la grabación de la misma reunión que ganó
  grabador?: Quien | null
  mapa?: ResultadoMapaKickoff
  ficha?: FichaKickoff
  markdown?: string
  mensaje?: string | null       // el aviso tal cual sale (o saldría, con dry)
  aviso_id?: string | null
  ads?: ResultadoAvisoAds       // el aviso a Valentino (con lista)
  guiones?: string              // con lista: qué pasó con el disparo de la tanda de guiones (disparado, apagado, error…)
  mensaje_ads?: string | null   // con dry: el aviso a Valentino tal cual saldría
  modelo?: string | null
  usage?: { extraccion: Uso | null; ideas: Uso | null }
  reutilizado?: { ficha: boolean; ideas: boolean }
  intentos?: number
  duracion_ms?: number
}

export interface OpcionesProceso {
  dry?: boolean
  forzar?: boolean
  /** Hora límite (ms epoch). Por defecto, t0 + PLAZO_MS. */
  deadline?: number
  /** La cuenta de Fathom que firmó el webhook (o la del modo manual con ?quien=). Si no viene, la que ya tenía la fila. */
  grabador?: Quien | null
}

// ── Zona desde el video: qué hacer en esta pasada ──
// nada: no hubo mapa en pantalla, ya está leído con esta versión (o se está leyendo), o no hay cómo saber de keys (fakes);
// sin_momento: la ficha no tiene el minuto de la zona (se guarda el porqué: no se le pide a Fathom un video que nadie mira);
// sin_key: no se sabe la cuenta o falta su API key (se guarda y queda el faltante); dry: se pediría, pero en seco no;
// pedir: pedir el video (o retomar `descarga`) y, con la ficha lista, disparar la lectura.
export type PlanMapa =
  | { tipo: 'nada'; zv: ZonaVideoFicha | null }
  | { tipo: 'sin_momento'; zv: ZonaVideoFicha }
  | { tipo: 'sin_key'; zv: ZonaVideoFicha }
  | { tipo: 'dry'; quien: Quien; zv: null }
  | { tipo: 'pedir'; quien: Quien; descarga: string | null; zv: null }

/** Una lectura del mapa armada acá (pedido, sin_key, error del disparo). */
export function zvMapa(estado: EstadoZonaVideoFicha, quien: Quien | null, generado: string, extra: Partial<ZonaVideoFicha> = {}): ZonaVideoFicha {
  return { estado, version: VERSION_MAPA, quien, download_id: null, motivo: null, transitorio: false, mapa: null, momentos: null, tokens: null, modelo: null, generado, ...extra }
}

/**
 * Puro: qué hacer con el mapa de esta kickoff (ver PlanMapa). `previo`: lo guardado de un intento anterior (null con forzar).
 * `hayMomento`: la ficha tiene el minuto en que se habló de la zona dentro de la grabación (momentosMapa); sin pasar, sí.
 */
export function planMapa(x: {
  mapaEnPantalla: boolean; previo: ZonaVideoFicha | null; quien: Quien | null; hayApiKey?: (q: Quien) => boolean; dry: boolean; ahoraMs: number
  hayMomento?: boolean
}): PlanMapa {
  const { previo, quien } = x
  if (!x.mapaEnPantalla || !x.hayApiKey) return { tipo: 'nada', zv: previo }
  const generado = new Date(x.ahoraMs).toISOString()
  const mismaVersion = previo?.version === VERSION_MAPA
  if (previo && mismaVersion && ESTADOS_MAPA_HECHO.includes(previo.estado)) return { tipo: 'nada', zv: previo }
  if (previo && mismaVersion && previo.estado === 'leyendo' && (previo.vence_ms ?? 0) > x.ahoraMs) return { tipo: 'nada', zv: previo }
  if (x.hayMomento === false) return { tipo: 'sin_momento', zv: zvMapa('error', quien, generado, { motivo: MOTIVO_SIN_MOMENTO }) }
  if (!quien) {
    return { tipo: 'sin_key', zv: zvMapa('sin_key', null, generado, { motivo: 'no se sabe con qué cuenta de Fathom se grabó la kickoff: el mapa no se lee solo' }) }
  }
  if (!x.hayApiKey(quien)) return { tipo: 'sin_key', zv: zvMapa('sin_key', quien, generado, { motivo: textoSinKeyMapa(GRABADORES[quien].nombre) }) }
  if (x.dry) return { tipo: 'dry', quien, zv: null }
  // Una descarga ya pedida (por un intento anterior) se retoma en vez de pedirle a Fathom otro MP4
  const retomable = previo && mismaVersion && previo.quien === quien && (previo.estado === 'pedido' || previo.estado === 'leyendo' || (previo.estado === 'error' && previo.transitorio))
  return { tipo: 'pedir', quien, descarga: retomable ? previo.download_id : null, zv: null }
}

/** Una promesa con tope: null si no llegó a tiempo (la promesa sigue, pero ya no se la espera). */
function conTope<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<null>(res => { t = setTimeout(() => res(null), Math.max(0, ms)) })]).finally(() => clearTimeout(t))
}

const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

// Los ajustes del portfolio llevan este prefijo: se recalculan en cada pasada, así que al reusar una ficha no se arrastran
export const PREFIJO_AJUSTE_PORTFOLIO = 'portfolio en Meta:'

/** La ficha guardada, si se puede reusar: misma versión del prompt, sin forzar y con la forma esperada. */
export function fichaGuardada(reclamo: ReclamoKickoff | null, forzar: boolean): { extraccion: ExtraccionKickoff; ajustes: string[] } | null {
  if (!reclamo || forzar || reclamo.version_prompt !== VERSION_PROMPT) return null
  return extraccionDeFicha(reclamo.ficha)
}

/** Lo de Claude de una ficha guardada (la extracción y sus ajustes), si tiene la forma esperada. También lo usa probar-kickoff --rearmar. */
export function extraccionDeFicha(f: unknown): { extraccion: ExtraccionKickoff; ajustes: string[] } | null {
  if (!esObj(f) || !(TIPOS_REUNION as readonly unknown[]).includes(f.tipo_reunion)) return null
  const partes = ['cliente', 'rama', 'avatar', 'zona', 'presupuesto', 'portfolio'] as const
  if (!partes.every(k => esObj(f[k])) || !Array.isArray(f.acuerdos) || !Array.isArray(f.pendientes)) return null
  if (!ITEMS_PORTFOLIO.every(k => esObj((f.portfolio as Record<string, unknown>)[k]))) return null
  const x = f as unknown as FichaKickoff
  return {
    extraccion: {
      tipo_reunion: x.tipo_reunion, resumen_corto: x.resumen_corto, cliente: x.cliente, rama: x.rama, avatar: x.avatar, zona: x.zona,
      presupuesto: x.presupuesto, portfolio: x.portfolio, acuerdos: x.acuerdos, pendientes: x.pendientes,
    },
    ajustes: Array.isArray(x.ajustes) ? x.ajustes.filter(a => typeof a === 'string' && !a.startsWith(PREFIJO_AJUSTE_PORTFOLIO)) : [],
  }
}

/** El portfolio ya listo para la ficha, las cuentas del cliente que encontró la búsqueda y lo que va a los ajustes. */
export interface PortfolioKickoff { lectura: LecturaPortfolioMeta; cuentas: string[]; ajustes: string[] }

/**
 * Corre el chequeo del portfolio con tope (race): nunca lanza ni tarda más de topePortfolioMs. Si falla o tarda, la lectura
 * queda "no se pudo leer" (portfolioSinLectura: todo sin dato, con el aviso de reintentar) y lo de la llamada sigue mandando.
 * Lo exporta también para scripts/probar-kickoff.mjs (--rearmar).
 */
export async function chequeoPortfolio(deps: Pick<DepsKickoff, 'portfolio' | 'topePortfolioMs'>, f: Pick<ExtraccionKickoff, 'cliente'>): Promise<PortfolioKickoff> {
  const tope = deps.topePortfolioMs ?? TOPE_PORTFOLIO_MS
  let t: ReturnType<typeof setTimeout> | undefined
  const tarde = new Promise<null>(res => { t = setTimeout(() => res(null), tope) })
  const lectura = Promise.resolve()
    .then(() => deps.portfolio({ cliente_crm: f.cliente.cliente_crm, cuentas: f.cliente.cuentas }, tope))
    .then(p => ({ ok: true as const, p }), e => ({ ok: false as const, motivo: motivoDe(e) }))
  const r = await Promise.race([lectura, tarde]).finally(() => clearTimeout(t))
  if (r?.ok) {
    const cuentas = [...new Set([r.p.cuenta, ...(r.p.busqueda?.cuentas ?? []).map(c => c.id)].map(idCuenta).filter((x): x is string => !!x))]
    // El porqué técnico de cada ítem (código de Graph, permiso que falta) va a los ajustes: en la pantalla, el texto llano
    const tecnicos = ITEMS_PORTFOLIO.map(k => r.p.items[k]?.tecnico).filter((x): x is string => !!x)
    return { lectura: paraFicha(r.p), cuentas, ajustes: [...(r.p.busqueda?.avisos ?? []), ...tecnicos].map(a => `${PREFIJO_AJUSTE_PORTFOLIO} ${a}`) }
  }
  const motivo = r ? r.motivo : `Meta tardó más de ${Math.round(tope / 1000)} s`
  console.warn(`bot-kickoff: portfolio sin chequear — ${motivo}`)
  const sin = portfolioSinLectura(null, r ? 'error' : 'timeout', r ? motivo : null, { topeMs: tope })
  return { lectura: paraFicha(sin), cuentas: [], ajustes: [`${PREFIJO_AJUSTE_PORTFOLIO} el chequeo no salió (${motivo}): queda lo de la llamada`] }
}

interface IdeasConGanadores { ideas: IdeasFicha; ganadores: GanadoresFicha; ajustes: string[] }

/** Las ideas guardadas (con los ganadores con que salieron), si se pueden reusar. */
export function ideasGuardadas(reclamo: ReclamoKickoff | null, forzar: boolean): IdeasConGanadores | null {
  if (!reclamo || forzar || reclamo.version_ideas !== VERSION_IDEAS) return null
  const x = reclamo.ideas
  if (!esObj(x) || !esObj(x.ideas) || !esObj(x.ganadores) || !Array.isArray((x.ideas as Record<string, unknown>).ideas)) return null
  return { ideas: x.ideas as unknown as IdeasFicha, ganadores: x.ganadores as unknown as GanadoresFicha, ajustes: Array.isArray(x.ajustes) ? (x.ajustes as string[]) : [] }
}

class ErrorSinTranscripcion extends Error {
  constructor() {
    super(`${PREFIJO_SIN_TRANSCRIPCION} el webhook de Fathom llegó sin transcripción (activar Transcript en el webhook de kickoff)`)
  }
}

/** Discord publicó (avisoId) pero la base no lo anotó: el motivo lleva el prefijo y el id para que un reintento no repita. */
class ErrorAvisoSinAnotar extends Error {
  readonly avisoId: string
  readonly causa: string
  constructor(avisoId: string, causa: string) {
    super(`${PREFIJO_AVISO_ENVIADO}${avisoId} · no se pudo anotar el aviso: ${causa}`)
    this.avisoId = avisoId
    this.causa = causa
  }
}
/** Discord no confirmó el envío (timeout o red a mitad del pedido): el aviso pudo haber salido. */
class ErrorAvisoDudoso extends Error {
  constructor(causa: string) { super(`Discord no confirmó el aviso: ${causa}`) }
}

/** El id del aviso que ya salió según un error anterior con PREFIJO_AVISO_ENVIADO, o null. */
export function avisoDeErrorPrevio(error: string | null | undefined): string | null {
  if (!error?.startsWith(PREFIJO_AVISO_ENVIADO)) return null
  return error.slice(PREFIJO_AVISO_ENVIADO.length).split(/\s/)[0] || null
}

const isoONull = (x: unknown): string | null => (typeof x === 'string' && x.length <= 40 && Number.isFinite(Date.parse(x)) ? x : null)

type LecturaGanadores = { ok: true; c: CandidatosRama } | { ok: false; motivo: string }

export async function procesarKickoff(payload: unknown, deps: DepsKickoff, op: OpcionesProceso = {}): Promise<ResultadoKickoff> {
  const t0 = deps.ahora()
  const deadline = op.deadline ?? t0 + PLAZO_MS
  const v = validarReunion(payload)
  if (!v.ok) return { estado: 'invalida', motivo: v.error }
  const r = v.reunion, id = r.recording_id, dry = !!op.dry, forzar = !!op.forzar
  // validarReunion no conserva el inicio ni el fin agendados: se toman del payload crudo (y se guardan con la reunión para un
  // reintento)
  const finAgendado = isoONull((payload as Record<string, unknown>).scheduled_end_time)
  const inicioAgendado = isoONull((payload as Record<string, unknown>).scheduled_start_time)
  const reunionFicha = { ...r, scheduled_end_time: finAgendado, scheduled_start_time: inicioAgendado }
  const duracion = () => Math.max(0, Math.round(deps.ahora() - t0))
  const tr = formatearTranscripcion(r.transcript)
  // Lo de la transcripción es puro: se sabe ANTES de reclamar si esta grabación se va a procesar (sin transcripción → error;
  // corta → omitida). Va en la clave, así una que va a quedar en error u omitida no le gana a la otra grabación
  const durS = duracionGrabacionS(r, tr)
  const motivoOmitida = r.transcript === null ? null : tr.renglones < MIN_RENGLONES
    ? `transcripción con ${tr.renglones} renglones (mínimo ${MIN_RENGLONES})`
    : durS !== null && durS < MIN_DURACION_S ? `grabación de ${durS} s (mínimo ${MIN_DURACION_S / 60} min)` : null
  const procesable = r.transcript !== null && !motivoOmitida
  // La clave de la reunión para reconocer la misma kickoff grabada por el otro (dedupe.ts: con scheduled_start_time del crudo)
  const clave: ClaveReunion = { ...claveDeReunion(r, payload), procesable }
  let reclamo: ReclamoKickoff | null = null
  const usage: { extraccion: Uso | null; ideas: Uso | null } = { extraccion: null, ideas: null }
  let modelo: string | null = null

  /** Corre un paso; si falla con un error transitorio y queda tiempo, espera y lo reintenta UNA vez. */
  const paso = async <T>(que: keyof typeof MIN_RESTANTE, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (!esTransitorio(e) || deadline - deps.ahora() - ESPERA_REINTENTO_MS < MIN_RESTANTE[que]) throw e
      console.warn(`bot-kickoff: grabación ${id}, ${que}: ${motivoDe(e)} — reintento en ${ESPERA_REINTENTO_MS / 1000} s`)
      await deps.esperar(ESPERA_REINTENTO_MS)
      return await fn()
    }
  }

  // Ganadores: un pedido por rama, que arranca apenas se sabe (o se adivina) la rama y nunca rechaza
  const pedidos = new Map<Rama, Promise<LecturaGanadores>>()
  const pedirGanadores = (rama: Rama): Promise<LecturaGanadores> => {
    let p = pedidos.get(rama)
    if (!p) {
      p = deps.candidatos(rama).then(c => ({ ok: true as const, c }), e => ({ ok: false as const, motivo: motivoDe(e) }))
      pedidos.set(rama, p)
    }
    return p
  }
  // País del cliente: el que dijo Claude o, si no, el que se lee en la zona ("San Juan" → AR)
  const paisDe = (f: ExtraccionKickoff): string | null => f.zona.pais ?? paisDeTexto([f.zona.descripcion, ...f.zona.lugares].join(' '))
  /** Los ganadores de la rama de la ficha, sin las cuentas del cliente (las del CRM y las que encontró el portfolio). */
  const ganadoresDe = async (f: ExtraccionKickoff, portfolio: Promise<PortfolioKickoff>): Promise<GanadoresFicha> => {
    const rama = f.rama.principal
    if (!rama) return { estado: 'sin_rama', nota: 'sin rama principal: no se buscan ganadores', lista: [], ventana: null }
    const tope = deps.topeGanadoresMs ?? TOPE_GANADORES_MS
    let t: ReturnType<typeof setTimeout> | undefined
    const tarde = new Promise<LecturaGanadores>(res => { t = setTimeout(() => res({ ok: false, motivo: `Meta tardó más de ${Math.round(tope / 1000)} s` }), tope) })
    const [l, p] = await Promise.all([Promise.race([pedirGanadores(rama), tarde]).finally(() => clearTimeout(t)), portfolio])
    if (!l.ok) return { estado: 'error', nota: `sin ganadores: ${l.motivo}`, lista: [], ventana: null }
    return elegirGanadores(l.c, { excluirCuentas: [...new Set([...f.cliente.cuentas, ...p.cuentas])], excluirCliente: f.cliente.cliente_crm, pais: paisDe(f) })
  }

  try {
    if (!dry) {
      reclamo = await paso('base', () => deps.reclamar(id, { forzar }, { titulo: r.title, url: r.url, payload: reunionFicha, grabador: op.grabador ?? null, clave }))
      if (!reclamo) return { estado: 'duplicada', recording_id: id }
      // La misma reunión grabada por el otro (cada uno con su Fathom): gana la primera que se registró, aunque siga procesando.
      // Si la búsqueda falla, se sigue: mejor dos fichas que ninguna. Una que no se va a procesar no busca: queda con su estado
      if (!forzar && deps.gemela && procesable) {
        let g: GemelaKickoff | null = null
        try {
          g = await deps.gemela(id, clave)
        } catch (e) {
          console.warn(`bot-kickoff: grabación ${id}, no se pudo buscar si ya llegó la misma reunión — se sigue:`, motivoDe(e))
        }
        if (g) {
          const de = g.recording_id
          const motivo = `la misma reunión ya llegó en la grabación ${de}${g.grabador ? ` (Fathom de ${GRABADORES[g.grabador].nombre})` : ''}: esta no se procesa`
          await paso('base', () => deps.marcar(id, { estado: 'duplicada', duplicada_de: de, error: motivo, duracion_ms: duracion() }))
          console.log(`bot-kickoff: grabación ${id} duplicada de ${de} (por ${g.por})`)
          return { estado: 'duplicada', recording_id: id, duplicada_de: de, motivo, intentos: reclamo.intentos, duracion_ms: duracion() }
        }
      }
      if (!deps.discordListo) throw new Error('falta DISCORD_WEBHOOK_KICKOFF')
    }
    // La cuenta de Fathom que firmó (la de este envío o la que ya tenía la fila)
    const grabador: Quien | null = op.grabador ?? reclamo?.grabador ?? null

    // 4. Sin transcripción es la configuración del webhook; prueba o cortada → omitida, sin Claude
    if (r.transcript === null) throw new ErrorSinTranscripcion()
    if (motivoOmitida) {
      if (!dry) await paso('base', () => deps.marcar(id, { estado: 'omitida', error: motivoOmitida, duracion_ms: duracion() }))
      return { estado: 'omitida', recording_id: id, motivo: motivoOmitida, mensaje: null }
    }
    if (tr.largo > LARGO_AVISO) console.warn(`bot-kickoff: transcripción larga (${tr.largo} caracteres) en la grabación ${id}: se procesa igual`)

    // 5–6. Ficha guardada de un intento anterior, o CRM + Claude (y se guarda antes de seguir)
    let guardada = fichaGuardada(reclamo, forzar)
    const reutilizado = { ficha: !!guardada, ideas: false }
    if (guardada) modelo = reclamo?.modelo ?? null
    const probable = guardada ? guardada.extraccion.rama.principal : ramaProbable(r.default_summary?.markdown_formatted ?? null, tr.texto)
    if (!guardada || guardada.extraccion.tipo_reunion === 'kickoff') {
      if (probable) void pedirGanadores(probable)
      // Lo lento del portfolio (el descubrimiento de cuentas, ~9 s en frío) se calienta mientras Claude lee la llamada
      try { deps.prepararPortfolio?.() } catch (e) { console.warn(`bot-kickoff: grabación ${id}, no se pudo precalentar el portfolio —`, motivoDe(e)) }
    }
    if (!guardada) {
      const ctx: ContextoKickoff = await deps.contexto().catch(e => ({ clientes: [], estado: 'sin_crm' as const, aviso: motivoDe(e) }))
      const ex = await paso('claude', () => {
        // Después de la extracción se espera a Meta (ganadores y portfolio, en paralelo): se reserva el mayor de los topes
        const esperaMeta = Math.max(deps.topeGanadoresMs ?? TOPE_GANADORES_MS, deps.topePortfolioMs ?? TOPE_PORTFOLIO_MS)
        const tope = deadline - deps.ahora() - MARGEN_ENVIO_MS - RESERVA_IDEAS_MS - esperaMeta
        if (tope < MIN_CLAUDE_MS) throw new ErrorTransitorio(`no queda tiempo para leer la llamada con Claude (${Math.max(0, Math.round(tope / 1000))} s)`)
        return deps.extraer({ reunion: r, transcripcion: tr, clientes: ctx.clientes }, tope)
      })
      usage.extraccion = ex.usage
      modelo = ex.modelo
      guardada = { extraccion: ex.extraccion, ajustes: [...ex.ajustes, ...(ctx.estado === 'sin_crm' ? [`sin lista del CRM (${ctx.aviso ?? 'sin detalle'}): el cliente queda sin verificar`] : [])] }
      // La ficha base, sin el portfolio de Meta (todavía no se chequeó): la final, con él, se guarda al marcar "lista"
      const base = armarFicha({ reunion: reunionFicha, extraccion: guardada.extraccion, ajustes: guardada.ajustes, ideas: null, ganadores: null, grabador })
      if (!dry) {
        await paso('base', () => deps.guardarFicha(id, {
          ficha: base, cliente_crm: base.cliente.cliente_crm, id_crm: base.cliente.id_crm, modelo: ex.modelo, version_prompt: VERSION_PROMPT,
          tokens_in: ex.usage.input_tokens, tokens_out: ex.usage.output_tokens,
        }))
      }
    }
    const { extraccion } = guardada
    const ajustes = [...guardada.ajustes]
    const comun = { recording_id: id, modelo, usage, reutilizado, grabador, ...(reclamo ? { intentos: reclamo.intentos } : {}) }

    // 7. No es un kickoff: la ficha queda registrada, sin ideas ni aviso
    if (extraccion.tipo_reunion !== 'kickoff') {
      const ficha = armarFicha({ reunion: reunionFicha, extraccion, ajustes, ideas: null, ganadores: null, grabador })
      if (!dry) await paso('base', () => deps.marcar(id, { estado: 'no_kickoff', ficha, duracion_ms: duracion() }))
      return { estado: 'no_kickoff', ...comun, ficha, markdown: fichaMarkdown(ficha), mensaje: null, duracion_ms: duracion() }
    }

    if (deps.clienteOperativo && !await deps.clienteOperativo(extraccion.cliente.id_crm, extraccion.cliente.cliente_crm ?? extraccion.cliente.nombre_escuchado)) {
      if (!dry) await paso('base', () => deps.marcar(id, { estado: 'omitida', error: 'Cliente archivado: no se genera trabajo nuevo', duracion_ms: duracion() }))
      return { estado: 'omitida', ...comun, motivo: 'Cliente archivado: restauralo antes de generar trabajo nuevo.' }
    }
    // 8. El portfolio en Meta arranca ya (siempre, también al reusar la ficha: es barato y puede haber cambiado)
    const portfolio = chequeoPortfolio(deps, extraccion)

    // 8 bis. Zona desde el video: con mapa en pantalla, el video se pide YA (Fathom lo genera mientras siguen Meta y las ideas)
    const plan = planMapa({
      mapaEnPantalla: extraccion.zona.mapa_en_pantalla, previo: forzar ? null : leerZonaVideo(reclamo?.zona_video),
      quien: cuentaDeGrabacion(grabador, r.recorded_by), hayApiKey: deps.hayApiKey ? q => deps.hayApiKey!(q) : undefined, dry, ahoraMs: deps.ahora(),
      hayMomento: !!momentosMapa({ zona: extraccion.zona, fecha: r.recording_start_time ?? r.created_at, fin_grabacion: r.recording_end_time })?.length,
    })
    const generado = () => new Date(deps.ahora()).toISOString()
    const guardarMapa = async (zv: ZonaVideoFicha): Promise<void> => {
      if (dry || !deps.guardarZonaVideo) return
      try {
        await deps.guardarZonaVideo(id, zv, { libre: true })
      } catch (e) {
        console.warn(`bot-kickoff: grabación ${id}, no se pudo guardar la zona del video (${zv.estado}) —`, motivoDe(e))
      }
    }
    // Lo que se conoce del mapa para la ficha y el aviso (la columna zona_video manda después, en la pantalla)
    let zonaVideo: ZonaVideoFicha | null = plan.tipo === 'pedir' ? zvMapa('pedido', plan.quien, generado(), { download_id: plan.descarga }) : plan.zv
    if (plan.tipo === 'sin_key' || plan.tipo === 'sin_momento') await guardarMapa(plan.zv)
    let pedidoVideo: Promise<PedidoVideo> | null = null
    if (plan.tipo === 'pedir' && !plan.descarga && deps.pedirVideo) {
      const q = plan.quien
      pedidoVideo = deps.pedirVideo(id, q)
        .catch((e): PedidoVideo => ({ ok: false, estado: 'error', motivo: motivoDe(e), transitorio: true }))
        .then(async p => {
          zonaVideo = p.ok ? zvMapa('pedido', q, generado(), { download_id: p.download_id }) : zvMapa(p.estado, q, generado(), { motivo: p.motivo, transitorio: p.transitorio })
          await guardarMapa(zonaVideo)
          return p
        })
    }
    /** Con la ficha lista: retoma la descarga pedida y dispara la lectura en /api/bot/kickoff/mapa (nunca lanza). */
    const dispararLectura = async (): Promise<ResultadoMapaKickoff> => {
      const base = { plan: plan.tipo, quien: plan.tipo === 'pedir' || plan.tipo === 'dry' ? plan.quien : plan.zv?.quien ?? null }
      if (plan.tipo !== 'pedir') return { ...base, estado: plan.zv?.estado ?? null, ...(plan.zv?.motivo ? { motivo: plan.zv.motivo } : {}) }
      const q = plan.quien
      let descarga = plan.descarga
      // Lo que queda antes del deadline, menos lo de escribir zona_video (el guardado puede tardar hasta 10 s)
      const queda = () => deadline - deps.ahora() - RESERVA_ZONA_MS
      if (!descarga && pedidoVideo) {
        const p = await conTope(pedidoVideo, Math.min(TOPE_PEDIDO_VIDEO_MS, queda()))
        // Sin video, sin key o un error definitivo (key revocada): ya quedó guardado y no vale la pena mirar
        if (p && !p.ok && !(p.estado === 'error' && p.transitorio)) return { ...base, estado: p.estado, motivo: p.motivo }
        if (p?.ok) descarga = p.download_id
      }
      if (!deps.dispararMapa) return { ...base, estado: 'pedido', download_id: descarga }
      const fallo = async (motivo: string): Promise<ResultadoMapaKickoff> => {
        console.warn(`bot-kickoff: grabación ${id}, ${motivo}`)
        // Sin tiempo ni para escribir, no se escribe: queda "pedido" y la pantalla lo da por cortado (para reintentar)
        if (deadline - deps.ahora() >= RESERVA_ZONA_MS) await guardarMapa(zvMapa('error', q, generado(), { download_id: descarga, transitorio: true, motivo }))
        return { ...base, estado: 'error', download_id: descarga, motivo }
      }
      const tope = Math.min(TOPE_DISPARO_MAPA_MS, queda())
      // (cómo reintentarla lo agrega la pantalla: textoEstadoMapa, con el recording_id)
      if (tope < 1_000) return fallo('no quedó tiempo para disparar la lectura del mapa')
      try {
        await deps.dispararMapa({ recording_id: id, quien: q, descarga_id: descarga }, tope)
        return { ...base, estado: 'disparado', download_id: descarga }
      } catch (e) {
        // La ruta respondió que no y ya anotó la causa (sin ffmpeg, sin la clave de Claude, sin la API key): no se pisa
        const d = e as Partial<ErrorDisparoMapa>
        if (d?.guardado === true) {
          console.warn(`bot-kickoff: grabación ${id}, la lectura del mapa no arrancó — ${motivoDe(e)}`)
          return { ...base, estado: (d.estado as EstadoZonaVideoFicha | undefined) ?? 'error', download_id: descarga, motivo: motivoDe(e) }
        }
        return fallo(`no se pudo disparar la lectura del mapa (${motivoDe(e)})`)
      }
    }

    // 8–9. Ganadores + ideas (o las guardadas, con los ganadores con que salieron)
    let ideas: IdeasFicha, ganadores: GanadoresFicha
    // Solo si también se reusó la ficha: si se re-extrajo (otra versión del prompt), las ideas guardadas son de la ficha vieja
    const yaIdeas = reutilizado.ficha ? ideasGuardadas(reclamo, forzar) : null
    if (yaIdeas) {
      ({ ideas, ganadores } = yaIdeas)
      ajustes.push(...yaIdeas.ajustes)
      reutilizado.ideas = true
    } else {
      ganadores = await ganadoresDe(extraccion, portfolio)
      const kb = deps.kb(extraccion.rama.principal)
      const ri = await paso('claude', () => {
        const tope = deadline - deps.ahora() - MARGEN_ENVIO_MS - (plan.tipo === 'pedir' ? MARGEN_MAPA_MS : 0)
        if (tope < MIN_CLAUDE_MS) throw new ErrorTransitorio(`no queda tiempo para pedir las ideas a Claude (${Math.max(0, Math.round(tope / 1000))} s)`)
        return deps.ideas({ ficha: extraccion, ganadores: ganadores.lista, kb: kb?.texto ?? null, notaGanadores: ganadores.nota, paisCliente: paisDe(extraccion) }, tope)
      })
      usage.ideas = ri.usage
      modelo ??= ri.modelo
      const propios = [
        ...ri.ajustes.map(a => `ideas: ${a}`),
        ...(kb ? [] : [`ideas: sin base de conocimiento para la rama ${extraccion.rama.principal ?? '(sin rama)'}: salen de la ficha y los ganadores`]),
      ]
      ajustes.push(...propios)
      ideas = {
        estado: ri.ideas.length ? 'a_revisar' : 'sin_ideas',
        revisores: [...REVISORES],
        ideas: ri.ideas,
        notas: ri.notas,
        ...(ri.ideas.length ? {} : { motivo: 'Claude no devolvió ideas válidas' }),
      }
      if (!dry) {
        await paso('base', () => deps.guardarIdeas(id, {
          ideas: { ideas, ganadores, ajustes: propios, kb: kb?.version ?? null }, version_ideas: VERSION_IDEAS,
          tokens_in: ri.usage.input_tokens, tokens_out: ri.usage.output_tokens,
        }))
      }
    }

    // 10. Ficha final (con el portfolio de Meta cruzado con la llamada), aviso (una vez) y listo
    const port = await portfolio
    ajustes.push(...port.ajustes)
    const ficha = armarFicha({ reunion: reunionFicha, extraccion, ajustes, ideas, ganadores, portfolioMeta: port.lectura, grabador, zonaVideo })
    const mensaje = armarAviso(ficha, deps.menciones, linkFicha(deps.urlBase, ficha, deps.pantallaFicha !== false))
    const markdown = fichaMarkdown(ficha)
    if (dry) {
      // El aviso a Valentino tal cual saldría (sin tildes ni marcas: la ficha recién armada), sin mandar nada
      const mensajeAds = textoAvisoAds(filaParaAviso(ficha, zonaVideo), {
        valentino: deps.avisoAds?.valentino ?? deps.valentino ?? null, urlBase: deps.urlBase, pantalla: deps.pantallaFicha !== false,
      }, deps.ahora())
      return { estado: 'dry', ...comun, ficha, markdown, mensaje, mensaje_ads: mensajeAds, mapa: await dispararLectura(), duracion_ms: duracion() }
    }
    let avisoId = reclamo?.aviso_discord ?? null
    // Un intento anterior publicó pero no pudo anotar el id: se anota ahora, sin volver a mandar
    const yaSalio = forzar ? null : avisoDeErrorPrevio(reclamo?.error_previo)
    if (!avisoId && yaSalio) {
      avisoId = yaSalio
      await paso('base', () => deps.anotarAviso(id, yaSalio))
    }
    if (!avisoId) {
      if (deps.clienteOperativo && !await deps.clienteOperativo(ficha.cliente.id_crm, ficha.cliente.cliente_crm ?? ficha.cliente.nombre_escuchado)) throw new Error('Cliente archivado: envío detenido')
      let nuevo: string
      try {
        nuevo = await deps.enviar(mensaje, usuariosMencionados(deps.menciones), deadline - RESERVA_ESCRITURAS_MS)
      } catch (e) {
        // Timeout o red a mitad del pedido: Discord pudo haberlo publicado (lo demás —400, 404, 5xx o 429 agotados— no salió)
        const m = motivoDe(e)
        throw /no respondió|no se pudo conectar/i.test(m) ? new ErrorAvisoDudoso(m) : e
      }
      avisoId = nuevo || 'sin-id'
      // Si no se puede anotar, se corta con el id en el motivo: un reintento lo toma como salido y no lo repite
      try {
        await paso('base', () => deps.anotarAviso(id, avisoId!))
      } catch (e) {
        throw new ErrorAvisoSinAnotar(avisoId, motivoDe(e))
      }
    }
    try {
      // Con el aviso a Valentino prendido, la marca "pendiente" va en el mismo UPDATE (si esto se corta después, el barrido
      // la encuentra; si la ficha no queda lista, no hay aviso). Solo en una fila nueva sin aviso (''): la de antes (NULL)
      // o una que ya avisó no cambian
      await paso('base', () => deps.marcar(id, { estado: 'lista', ficha, duracion_ms: duracion(), ...(deps.avisoAds ? { aviso_ads_desde: deps.ahora() } : {}) }))
    } catch (e) {
      console.error(`bot-kickoff: grabación ${id} lista pero no se pudo registrar el final —`, motivoDe(e))
    }
    // 11. Zona desde el video: con la ficha lista, la lectura del mapa (en otra invocación: /api/bot/kickoff/mapa)
    const mapa = await dispararLectura()
    // 12. Aviso a Valentino: si la lectura quedó en marcha (la ruta la aceptó, o no respondió a tiempo y puede haberla
    // aceptado), lo manda la ruta del mapa al terminar (o el barrido, si se cuelga); si no, sale ya
    let ads: ResultadoAvisoAds | undefined
    if (deps.avisoAds) {
      const enMarcha = mapa.estado === 'disparado' || (mapa.estado === 'error' && /no respondió/i.test(mapa.motivo ?? ''))
      ads = enMarcha ? { estado: 'esperando_mapa' } : await intentarAvisoAds(id, deps.avisoAds, { deadline, listo: true })
    }
    // 13. La tanda de guiones arranca sola (27/10, Tomás): las ideas no esperan la aprobación; la revisión humana es sobre
    // los guiones. Solo en un kickoff con ideas; la ruta de guiones es idempotente (un reintento o un forzar no arma otra)
    let guiones: string | undefined
    if (deps.dispararGuiones && ficha.tipo_reunion === 'kickoff' && ficha.ideas_guiones.ideas.length) {
      if (deps.clienteOperativo && !await deps.clienteOperativo(ficha.cliente.id_crm, ficha.cliente.cliente_crm ?? ficha.cliente.nombre_escuchado)) throw new Error('Cliente archivado: no se inicia una tanda de guiones')
      guiones = await deps.dispararGuiones(id).catch(e => `error: ${motivoDe(e)}`)
    }
    return { estado: 'lista', ...comun, ficha, markdown, mensaje, aviso_id: avisoId, mapa, ...(ads ? { ads } : {}), ...(guiones ? { guiones } : {}), duracion_ms: duracion() }
  } catch (e) {
    const sinTranscripcion = e instanceof ErrorSinTranscripcion
    const motivo = motivoDe(e)
    console.error(`bot-kickoff: grabación ${id} con error —`, motivo)
    if (dry) return { estado: 'error', recording_id: id, motivo, usage, duracion_ms: duracion() }
    if (reclamo) {
      try {
        await deps.marcar(id, { estado: 'error', error: motivo, duracion_ms: duracion() })
      } catch (e2) {
        console.error(`bot-kickoff: no se pudo marcar el error de la grabación ${id} —`, motivoDe(e2))
      }
    }
    try {
      if (e instanceof ErrorAvisoSinAnotar) await deps.avisar(textoAvisoSinAnotar(r.title, id, e.causa, deps.tomas))
      else if (!sinTranscripcion) await deps.avisar(textoErrorKickoff(r.title, id, motivo, deps.tomas, { registrada: reclamo !== null, avisoDudoso: e instanceof ErrorAvisoDudoso }))
      else if (!reclamo?.error_previo?.startsWith(PREFIJO_SIN_TRANSCRIPCION)) await deps.avisar(textoSinTranscripcionKickoff(r.title, id, deps.tomas))
    } catch (e3) {
      console.error(`bot-kickoff: tampoco salió el aviso de la grabación ${id} —`, motivoDe(e3))
    }
    return { estado: 'error', recording_id: id, motivo, usage, ...(reclamo ? { intentos: reclamo.intentos } : {}), duracion_ms: duracion() }
  }
}

// ── Lo que corre en after() después de cada grabación del webhook (la ruta solo arma las dependencias reales) ──
export interface TareasTrasWebhook {
  /** procesarKickoff con las dependencias reales y el plazo de la ruta. */
  procesar(): Promise<ResultadoKickoff>
  /** purgarPayloadsViejos de registro.ts (las filas en error de más de 14 días: no hay cron propio). */
  purgar(): Promise<number>
  /** Las del aviso a Valentino (depsAvisoAdsReales), o null si está apagado o sin canal: entonces no hay barrido. */
  ads: DepsAvisoAds | null
  /** Hasta cuándo puede ir el barrido (t0 + FIN_INVOCACION_MS, con margen). */
  deadline: number
}

/**
 * Procesa la grabación, purga los payloads viejos y barre los avisos a Valentino que quedaron pendientes (la lectura del
 * mapa terminó sin mandarlo, o se colgó). Cada paso por su lado: si uno falla, los demás corren igual. Nunca lanza. Está
 * acá (y no en el route.ts) para probarla con fakes.
 */
export async function trasWebhook(id: number, firmo: string, t: TareasTrasWebhook): Promise<void> {
  try {
    const r = await t.procesar()
    const mapa = r.mapa && r.mapa.plan !== 'nada' ? ` · mapa: ${r.mapa.estado ?? r.mapa.plan}` : ''
    const ads = r.ads ? ` · aviso a Valentino: ${r.ads.estado}` : ''
    console.log(`bot-kickoff: grabación ${id} [${firmo}] → ${r.estado}${r.duplicada_de ? ` de ${r.duplicada_de}` : ''}${r.motivo ? ` (${r.motivo})` : ''}${mapa}${ads}`)
  } catch (e) {
    console.error(`bot-kickoff: grabación ${id} [${firmo}] — falla inesperada:`, motivoDe(e))
  }
  try {
    const purgadas = await t.purgar()
    if (purgadas) console.log(`bot-kickoff: se borró el payload de ${purgadas} fila(s) en error de más de 14 días`)
  } catch (e) {
    console.error('bot-kickoff: no se pudieron purgar payloads viejos —', motivoDe(e))
  }
  if (!t.ads) return
  try {
    for (const x of await barrerAvisosAds(t.ads, { deadline: t.deadline })) {
      if (x.ads.estado !== 'esperando_mapa') console.log(`bot-kickoff: barrido, grabación ${x.recording_id} → aviso a Valentino: ${x.ads.estado}${x.ads.motivo ? ` (${x.ads.motivo})` : ''}`)
    }
  } catch (e) {
    console.error('bot-kickoff: falló el barrido de los avisos a Valentino —', motivoDe(e))
  }
}
