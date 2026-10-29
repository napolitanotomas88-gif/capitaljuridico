// ── /api/bot/kickoff/mapa: la lógica de la ruta (zona desde el video), con dependencias inyectables ─────────────
// Está acá y no en el route.ts porque un route.ts de Next solo puede exportar GET/POST/runtime/…, y así los tests la prueban
// con fakes (sin base, Fathom, ffmpeg ni Claude). La ruta solo arma las dependencias reales (after() de Next, leerKickoff,
// guardarZonaVideo, zonaDesdeVideo).
// POST con "Authorization: Bearer <CRON_SECRET>" (nunca ?key=), cuerpo JSON:
//   { recording_id, quien?, dry?, forzar?, esperar?, descarga_id?, reintento?, timestamp_zona?, duracion_s?, lugares?, radio_km? }
//   · la ficha sale de cj_kickoffs (leerKickoff, solo lectura; no crea la tabla). Sin ficha guardada alcanzan timestamp_zona
//     y duracion_s (más lugares y radio_km para comparar): en ese caso no hay dónde guardar y responde en el acto;
//   · quien: el que grabó (tomas | gero_m), su API key de Fathom. Si no viene: la columna grabador (la cuenta que firmó el
//     webhook), después ficha.grabo.cuenta_fathom y por último ficha.grabo.quien;
//   · descarga_id: retoma una descarga ya pedida a Fathom. Si no viene, la de zona_video (la que pidió procesar.ts al llegar
//     el webhook, o la de un intento cortado), si es de la misma versión y de la misma cuenta;
//   · ASINCRÓNICA (24/10) cuando hay ficha guardada y no es dry: primero verifica sin costo (los momentos, la key de Fathom,
//     la clave de Claude y ffmpeg: zonaDesdeVideo con dry), toma el candado "leyendo" en zona_video (si otra lectura está en
//     curso, 409) y responde 202; en after() mira el video (Fathom, ffmpeg, Claude) y guarda el resultado con
//     guardarZonaVideo. Así procesar.ts la dispara y no espera los 1 a 4 minutos de Fathom;
//   · con la misma VERSION_MAPA ya leída (ok, sin mapa o sin video) y sin forzar: 200 "ya_leido", sin hacer nada;
//   · esperar: true → lo mismo pero en el acto (para probar a mano: responde con el resultado y lo guarda);
//   · dry: solo verifica y corta ANTES de Fathom (estado "listo"): no genera un video, no llama a Claude y NO escribe.
//   · lo que corta la verificación queda ANOTADO en zona_video (con libre: no pisa una lectura en curso), en palabras y sin
//     nombres de variables: sin la API key (qué conectar), sin el minuto de la zona, o el servidor sin ffmpeg o sin la clave
//     de Claude. Antes solo se anotaba sin_key y lo demás quedaba en el log: la pantalla decía "se está leyendo" 20 minutos;
//   · un error PASAJERO con una descarga ya pedida (Fathom tardó en generar el MP4, 429/5xx) se reintenta UNA vez solo: la
//     ruta se vuelve a disparar a sí misma con esa descarga (reintento: true). Si vuelve a fallar, queda el error con cómo
//     reintentarlo a mano;
//   · aviso del mapa (KICKOFF_AVISO_MAPA=1, apagado por defecto: decisión pendiente de Tomás): cuando la lectura termina y
//     el mapa no coincide con lo dicho, no se lee o no aparece, un renglón a #📝-kickoff sin menciones (deps.avisarMapa; el
//     texto lo arma textoAvisoMapa de mensaje.ts).
//   · aviso a Valentino «🚀 Para lanzar» (24/10, aviso-ads.ts; deps.avisarAds, solo si está prendido y con canal): cuando la
//     lectura TERMINA, en cualquier estado final (ok, sin mapa, sin video, sin key, error), se manda el aviso que quedó
//     pendiente al marcar la ficha lista, con la zona leída. Si queda en camino el reintento solo (o el redisparo no
//     respondió a tiempo: puede haber arrancado), lo manda el reintento al terminar o, si no arrancó, el barrido. También al
//     responder "ya_leido" y cuando la verificación corta la lectura (queda anotado el porqué). Solo manda si la marca está
//     pendiente: una relectura a mano de una ficha vieja, o de una que ya avisó, no manda nada. Al final de la lectura en
//     segundo plano corre además el barrido (deps.barrerAds) de los pendientes de otras grabaciones.
// Respuesta en el acto: el resultado de zonaDesdeVideo (sin cuadros ni la URL del video) y `guardado`. ok / sin_mapa /
// sin_video / listo / ya_leido → 200; sin_key → 503; error → 503 si es pasajero (con video.download_id si ya había una
// descarga), 502 si no.
import { NextResponse } from 'next/server'
import { RE_TIMESTAMP } from '@/lib/fathomAnuncios/tipos'
import { motivoDe } from '@/lib/fathomAnuncios/procesar'
import { urlDespacho } from './entorno'
import { quienDe, type Quien } from './grabadores'
import { VERSION_MAPA, aZonaVideo, fichaConMomento, type DepsZonaVideo, type FichaParaMapa, type ResultadoZonaVideo } from './mapa'
import { ESTADOS_MAPA_HECHO, leerZonaVideo, type ZonaVideoFicha } from './mapa-zona'

export const MAX_CUERPO_MAPA = 10_000
export const PLAZO_MAPA_MS = 285_000            // de los 300 s de maxDuration, con margen para responder
/** Lo que vale el candado de "leyendo": la invocación dura hasta 300 s; pasado esto, otra lectura puede tomarlo. */
export const CANDADO_LEYENDO_MS = 6 * 60_000
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })
const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

const QUIEN_DE_GRABO: Record<string, Quien> = { 'Tomás': 'tomas', 'Gero M': 'gero_m' }

export type FilaMapa = { ficha: unknown; zona_video?: unknown; grabador?: unknown }
export type ZonaDesdeVideo = (id: number, quien: Quien, ficha: FichaParaMapa, deps: DepsZonaVideo) => Promise<ResultadoZonaVideo>

export interface DepsMapaApi {
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  autorizado(req: Request): boolean
  baseConfigurada(): boolean
  leerKickoff(id: number): Promise<FilaMapa | undefined>
  guardarZonaVideo(id: number, zv: ZonaVideoFicha, op?: { libre?: boolean; ahoraMs?: number }): Promise<boolean>
  zonaDesdeVideo: ZonaDesdeVideo
  /** after() de Next: corre después de responder, dentro de maxDuration. */
  enSegundoPlano(fn: () => Promise<void>): void
  ahora(): number
  /** Vuelve a disparar esta ruta (dispararMapaReal) para el único reintento solo de un error pasajero. */
  redisparar?(datos: DatosDisparoMapa, topeMs: number): Promise<void>
  /** El aviso del mapa a #📝-kickoff (solo con KICKOFF_AVISO_MAPA=1): la ficha guardada, lo que se guardó y hasta cuándo. */
  avisarMapa?(ficha: unknown, zv: ZonaVideoFicha, deadline: number): Promise<void>
  /** El aviso a Valentino que quedó pendiente (intentarAvisoAds con listo: la lectura terminó): la lectura que manda y hasta cuándo. Nunca lanza. */
  avisarAds?(id: number, zv: ZonaVideoFicha | null, deadline: number): Promise<unknown>
  /** Al final de la lectura en segundo plano: el barrido de los avisos a Valentino pendientes (barrerAvisosAds), hasta `deadline`. */
  barrerAds?(deadline: number): Promise<unknown>
}

/** Lo que se le manda a la ruta del mapa al dispararla (procesar.ts, o ella misma para el reintento). */
export interface DatosDisparoMapa { recording_id: number; quien: string; descarga_id: string | null; reintento?: boolean }

/** La ruta del mapa respondió y no la aceptó. `guardado`: la ruta ya anotó el porqué en zona_video (no hay que pisarlo). */
export class ErrorDisparoMapa extends Error {
  readonly status: number
  readonly guardado: boolean
  readonly estado: string | null
  constructor(status: number, motivo: string | null, guardado: boolean, estado: string | null) {
    super(`la ruta del mapa respondió ${status}${motivo ? `: ${motivoDe(motivo).slice(0, 200)}` : ''}`)
    this.status = status
    this.guardado = guardado
    this.estado = estado
  }
}

/**
 * Dispara la lectura del mapa en la ruta propia y espera solo su respuesta (202 = aceptada; 200 = ya estaba leído o terminó
 * en el acto; 409 = ya se está leyendo). Si no la aceptó, lanza ErrorDisparoMapa con lo que dijo la ruta (y si ya lo
 * anotó). Está acá (y servidor.ts lo re-exporta) para que la ruta del mapa la use en su reintento sin cargar todo el bot.
 */
export async function dispararMapaReal(datos: DatosDisparoMapa, topeMs: number,
  op: { fetch?: typeof fetch; base?: string; cron?: string } = {}): Promise<void> {
  const cron = op.cron ?? process.env.CRON_SECRET?.trim()
  if (!cron) throw new Error('falta CRON_SECRET')
  let res: Response
  try {
    res = await (op.fetch ?? fetch)(`${op.base ?? urlDespacho()}/api/bot/kickoff/mapa`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cron}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        recording_id: datos.recording_id, quien: datos.quien, ...(datos.descarga_id ? { descarga_id: datos.descarga_id } : {}), ...(datos.reintento ? { reintento: true } : {}),
      }),
      signal: AbortSignal.timeout(Math.max(1_000, topeMs)),
      cache: 'no-store',
    })
  } catch (e) {
    const n = (e as Error)?.name
    throw new Error(n === 'TimeoutError' || n === 'AbortError' ? `la ruta del mapa no respondió en ${Math.round(topeMs / 1000)} s` : 'no se pudo conectar con la ruta del mapa')
  }
  if (res.status === 202 || res.status === 200 || res.status === 409) {
    await res.body?.cancel().catch(() => {})
    return
  }
  let j: Record<string, unknown> | null = null
  try {
    const t = (await res.text()).slice(0, MAX_CUERPO_MAPA)
    const x: unknown = t ? JSON.parse(t) : null
    j = esObj(x) ? x : null
  } catch { /* sin cuerpo legible: queda el status */ }
  const motivo = typeof j?.motivo === 'string' ? j.motivo : typeof j?.error === 'string' ? j.error : null
  throw new ErrorDisparoMapa(res.status, motivo, j?.guardado === true, typeof j?.estado === 'string' ? j.estado : null)
}

// Lo de configuración del servidor, en palabras para la ficha (sin nombres de variables): lo arregla quien maneja Vercel
function motivoLlano(r: Pick<ResultadoZonaVideo, 'estado' | 'motivo'>): string | undefined {
  if (r.estado !== 'error' || !r.motivo) return r.motivo
  if (/ffmpeg/i.test(r.motivo)) return 'el servidor no tiene ffmpeg para sacar los cuadros del video: avisale a Tomás'
  if (/ANTHROPIC|clave de Claude/i.test(r.motivo)) return 'el servidor no tiene la clave de Claude: avisale a Tomás'
  return r.motivo
}
/** Lo que queda del plazo para el reintento solo (el disparo espera hasta 8 s el 202). */
const MIN_PARA_REINTENTO_MS = 15_000
/** Hasta cuándo puede ir el aviso del mapa (maxDuration 300 s, con margen) y lo mínimo que tiene que quedar para mandarlo. */
const FIN_AVISO_MAPA_MS = 293_000
const MIN_PARA_AVISO_MS = 3_000
const TOPE_REDISPARO_MS = 8_000

type FichaConGrabo = FichaParaMapa & { grabo?: { quien?: unknown; cuenta_fathom?: unknown } | null }

/** La parte de la ficha guardada que hace falta (zona, fecha, fin), o null si no tiene esa forma. */
export function fichaDeFila(x: unknown): FichaConGrabo | null {
  if (!esObj(x) || !esObj(x.zona) || !Array.isArray(x.zona.lugares)) return null
  return x as unknown as FichaConGrabo
}

/** quien: el pedido → la columna grabador → ficha.grabo.cuenta_fathom → ficha.grabo.quien (Tomás / Gero M). */
export function quienDelMapa(pedido: Quien | undefined, fila: FilaMapa | undefined, ficha: FichaConGrabo | null): Quien | null {
  return pedido ?? quienDe(fila?.grabador) ?? quienDe(ficha?.grabo?.cuenta_fathom)
    ?? (typeof ficha?.grabo?.quien === 'string' ? QUIEN_DE_GRABO[ficha.grabo.quien] ?? null : null)
}

const estadoHttp = (r: Pick<ResultadoZonaVideo, 'estado' | 'transitorio'>): number =>
  r.estado === 'sin_key' ? 503 : r.estado === 'error' ? (r.transitorio ? 503 : 502) : 200

export async function atenderMapa(req: Request, deps: DepsMapaApi): Promise<Response> {
  const t0 = deps.ahora()
  if (!deps.autorizado(req)) return json({ error: 'no autorizado' }, 401)
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CUERPO_MAPA) return json({ error: 'cuerpo demasiado grande' }, 413)
  const texto = await req.text()
  if (texto.length > MAX_CUERPO_MAPA) return json({ error: 'cuerpo demasiado grande' }, 413)
  let b: unknown
  try {
    b = JSON.parse(texto || '{}')
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }
  if (!esObj(b)) return json({ error: 'el cuerpo tiene que ser un objeto JSON' }, 400)

  const crudo = typeof b.recording_id === 'string' ? b.recording_id.trim() : b.recording_id
  const id = typeof crudo === 'number' ? crudo : typeof crudo === 'string' && /^\d{1,16}$/.test(crudo) ? Number(crudo) : NaN
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: 'recording_id inválido (tiene que ser un entero positivo)' }, 400)
  const quienPedido = b.quien === undefined || b.quien === null ? undefined : quienDe(b.quien)
  if (quienPedido === null) return json({ error: 'quien inválido (tomas o gero_m: el que grabó la kickoff con su Fathom)' }, 400)
  const si = (x: unknown) => x === true || x === 1 || x === '1'
  const dry = si(b.dry), forzar = si(b.forzar), esperar = si(b.esperar), reintento = si(b.reintento)
  const ts = typeof b.timestamp_zona === 'string' ? b.timestamp_zona.trim() : null
  if (b.timestamp_zona !== undefined && !(ts && RE_TIMESTAMP.test(ts))) return json({ error: 'timestamp_zona inválido (HH:MM:SS)' }, 400)
  const duracion = b.duracion_s === undefined ? null : Number(b.duracion_s)
  if (duracion !== null && !(Number.isFinite(duracion) && duracion > 0 && duracion <= 6 * 3600)) return json({ error: 'duracion_s inválida (segundos, hasta 6 horas)' }, 400)
  const lugares = Array.isArray(b.lugares) ? b.lugares.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, 80)).slice(0, 30) : []
  const radio = typeof b.radio_km === 'number' && Number.isFinite(b.radio_km) && b.radio_km > 0 && b.radio_km <= 1000 ? b.radio_km : null
  const descargaPedida = typeof b.descarga_id === 'string' ? b.descarga_id.trim() : null
  if (b.descarga_id !== undefined && !(descargaPedida && /^[A-Za-z0-9_-]{1,120}$/.test(descargaPedida))) return json({ error: 'descarga_id inválido' }, 400)

  // La ficha guardada (solo lectura). Si la base no responde y vino timestamp_zona, se sigue con eso (sin guardar).
  let fila: FilaMapa | undefined
  let ficha: FichaConGrabo | null = null
  if (deps.baseConfigurada()) {
    try {
      fila = await deps.leerKickoff(id)
      ficha = fichaDeFila(fila?.ficha)
    } catch (e) {
      if (!ts) return json({ error: `no se pudo leer el registro: ${motivoDe(e)}` }, 503)
    }
  }
  if (!ficha && !ts) {
    return json({ error: `la grabación ${id} no tiene ficha en el registro: mandá timestamp_zona (HH:MM:SS) y duracion_s (y lugares y radio_km para comparar)` }, 404)
  }
  const cliente = esObj(fila?.ficha) && esObj(fila.ficha.cliente) ? fila.ficha.cliente : null
  const idCliente = cliente && typeof cliente.id_crm === 'string' ? cliente.id_crm : null
  const nombreCliente = cliente ? String(cliente.cliente_crm ?? cliente.nombre_escuchado ?? '') : ''
  if (cliente && deps.clienteOperativo) {
    try {
      if (!await deps.clienteOperativo(idCliente, nombreCliente)) return json({ error: 'El cliente está archivado; no se inicia la lectura del mapa.' }, 409)
    } catch { return json({ error: 'No se pudo confirmar el estado actual del cliente; no se inició la lectura.' }, 503) }
  }
  const quien = quienDelMapa(quienPedido, fila, ficha)
  if (!quien) return json({ error: 'falta quien (tomas o gero_m): la ficha no dice quién grabó la kickoff' }, 400)

  // Con timestamp_zona manda lo del cuerpo (el momento y, si no hay ficha, lo dicho para comparar); la duración es duracion_s
  // o, si no vino, la de la ficha guardada
  const conMomento = ts ? fichaConMomento(ficha, ts, { duracion, lugares, radio_km: radio }) : null
  if (ts && !conMomento) return json({ error: 'timestamp_zona cae después del final de la grabación (duracion_s o la duración de la ficha)' }, 400)
  const fichaUsada: FichaParaMapa = conMomento ? conMomento.ficha : ficha!

  const previo = leerZonaVideo(fila?.zona_video)
  const escribe = !!fila && !!ficha && !dry          // hay dónde guardar (y no es la prueba en seco)
  const comun = { recording_id: id, quien, dry, origen_ficha: ficha ? 'registro' : 'cuerpo' }
  /** El aviso a Valentino pendiente, en segundo plano (la lectura terminó o no va a arrancar). */
  const avisarAdsAtras = (zv: ZonaVideoFicha | null): void => {
    if (!deps.avisarAds || !escribe) return
    const avisar = deps.avisarAds
    deps.enSegundoPlano(async () => {
      try {
        await avisar(id, zv, t0 + FIN_AVISO_MAPA_MS)
      } catch (e) {
        console.warn(`bot-kickoff-mapa: grabación ${id}, no salió el aviso a Valentino —`, motivoDe(e))
      }
    })
  }
  // Ya leído con esta versión: no se repite (con forzar, sí)
  if (escribe && !forzar && previo && previo.version === VERSION_MAPA && ESTADOS_MAPA_HECHO.includes(previo.estado)) {
    avisarAdsAtras(previo)
    return json({ ...comun, estado: 'ya_leido', guardado: false, zona_video: previo })
  }
  // La descarga a retomar: la pedida o la que quedó guardada (misma versión y misma cuenta: la URL solo la da a quien la pidió)
  const descargaId = descargaPedida ?? (previo && previo.version === VERSION_MAPA && previo.quien === quien ? previo.download_id : null)
  const opciones: DepsZonaVideo = {
    deadline: t0 + PLAZO_MAPA_MS, soloSiMapaEnPantalla: !forzar, descargaId,
    ...(conMomento ? { segundos: conMomento.segundos } : {}),
  }
  const generado = () => new Date(deps.ahora()).toISOString()
  const guardarZv = async (r: ResultadoZonaVideo, libre: boolean): Promise<{ guardado: boolean; zv: ZonaVideoFicha | null }> => {
    const zv = aZonaVideo(r, quien, { generado: generado(), descargaPrevia: descargaId })
    if (!zv) return { guardado: false, zv: null }
    try {
      return { guardado: await deps.guardarZonaVideo(id, zv, { libre, ahoraMs: deps.ahora() }), zv }
    } catch (e) {
      console.error(`bot-kickoff-mapa: grabación ${id}, no se pudo guardar el resultado (${r.estado}) —`, motivoDe(e))
      return { guardado: false, zv }
    }
  }

  // En el acto: dry, sin fila donde guardar, o esperar
  if (!escribe || esperar) {
    const r = await deps.zonaDesdeVideo(id, quien, fichaUsada, { ...opciones, dry })
    const g = escribe ? await guardarZv(r, !forzar) : { guardado: false, zv: null }
    console.log(`bot-kickoff-mapa: grabación ${id} (${quien}) → ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}`)
    if (g.zv) avisarAdsAtras(g.zv)
    return json({ ...comun, guardado: g.guardado, ...r }, estadoHttp(r))
  }

  // Asincrónica: primero se verifica sin costo (ni Fathom ni Claude)
  const pre = await deps.zonaDesdeVideo(id, quien, fichaUsada, { ...opciones, dry: true })
  if (pre.estado !== 'listo') {
    // Queda anotado (con libre: no pisa una lectura en curso), en palabras: sin la API key, sin el minuto de la zona, el
    // servidor sin ffmpeg o sin la clave de Claude. La respuesta trae el motivo técnico (para el log de quien la disparó)
    console.log(`bot-kickoff-mapa: grabación ${id} (${quien}) → ${pre.estado}${pre.motivo ? ` (${pre.motivo})` : ''}`)
    const g = await guardarZv({ ...pre, motivo: motivoLlano(pre) }, true)
    // La lectura no va a arrancar: el aviso a Valentino pendiente sale ya (con el porqué anotado)
    avisarAdsAtras(g.zv)
    return json({ ...comun, guardado: g.guardado, ...pre }, estadoHttp(pre))
  }
  // El candado: "leyendo" (con vencimiento). Si otra lectura está en curso o ya terminó con esta versión → 409
  const leyendo: ZonaVideoFicha = {
    estado: 'leyendo', version: VERSION_MAPA, quien, download_id: descargaId, motivo: null, transitorio: false, mapa: null,
    momentos: pre.momentos, tokens: null, modelo: null, generado: generado(), vence_ms: t0 + CANDADO_LEYENDO_MS,
  }
  let tomado: boolean
  try {
    tomado = await deps.guardarZonaVideo(id, leyendo, { libre: !forzar, ahoraMs: t0 })
  } catch (e) {
    return json({ error: `no se pudo anotar la lectura en el registro: ${motivoDe(e)}` }, 503)
  }
  if (!tomado) return json({ ...comun, estado: 'leyendo', motivo: 'ya se está leyendo el mapa de esta grabación (o ya está leído)' }, 409)
  deps.enSegundoPlano(async () => {
    if (cliente && deps.clienteOperativo && !await deps.clienteOperativo(idCliente, nombreCliente)) return
    const r = await deps.zonaDesdeVideo(id, quien, fichaUsada, opciones)
    const { guardado, zv } = await guardarZv(r, false)
    console.log(`bot-kickoff-mapa: grabación ${id} (${quien}) → ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}${guardado ? '' : ' (sin guardar)'}`)
    // Un error pasajero con la descarga ya pedida (Fathom todavía genera el MP4): UN reintento solo, con esa descarga
    const descarga = r.video?.download_id ?? descargaId
    let reintentando = false
    if (guardado && r.estado === 'error' && r.transitorio && descarga && !reintento && deps.redisparar
      && t0 + PLAZO_MAPA_MS - deps.ahora() >= MIN_PARA_REINTENTO_MS) {
      try {
        await deps.redisparar({ recording_id: id, quien, descarga_id: descarga, reintento: true }, TOPE_REDISPARO_MS)
        reintentando = true
        console.log(`bot-kickoff-mapa: grabación ${id}, se reintenta una vez con la descarga ${descarga}`)
      } catch (e) {
        // Sin respuesta a tiempo (un arranque en frío) la otra invocación puede haber tomado el candado: se la da por
        // reintentando, como procesar.ts con el disparo. Si no arrancó, el aviso a Valentino lo manda el barrido (la lectura
        // queda en error pasajero y a los 12 minutos ya no se espera)
        const m = motivoDe(e)
        if (/no respondió/i.test(m)) reintentando = true
        console.warn(`bot-kickoff-mapa: grabación ${id}, ${reintentando ? 'el reintento solo no respondió a tiempo (puede estar en curso)' : 'no se pudo reintentar solo'} —`, m)
      }
    }
    // El aviso a Valentino: la lectura terminó (si el reintento solo quedó en camino, lo manda el reintento al terminar)
    if (!reintentando && deps.avisarAds && t0 + FIN_AVISO_MAPA_MS - deps.ahora() >= MIN_PARA_AVISO_MS) {
      try {
        await deps.avisarAds(id, zv, t0 + FIN_AVISO_MAPA_MS)
      } catch (e) {
        console.warn(`bot-kickoff-mapa: grabación ${id}, no salió el aviso a Valentino —`, motivoDe(e))
      }
    }
    // El aviso del mapa (si está prendido): la ficha guardada y lo que quedó
    if (guardado && zv && deps.avisarMapa && fila && t0 + FIN_AVISO_MAPA_MS - deps.ahora() >= MIN_PARA_AVISO_MS) {
      try {
        if (!cliente || !deps.clienteOperativo || await deps.clienteOperativo(idCliente, nombreCliente)) await deps.avisarMapa(fila.ficha, zv, t0 + FIN_AVISO_MAPA_MS)
      } catch (e) {
        console.warn(`bot-kickoff-mapa: grabación ${id}, no salió el aviso del mapa —`, motivoDe(e))
      }
    }
    // Y el barrido de los avisos a Valentino pendientes de otras grabaciones (una lectura que se colgó, un error pasajero):
    // así no dependen solo de que llegue otro webhook. Sin tiempo, el barrido ni busca
    if (deps.barrerAds) {
      try {
        await deps.barrerAds(t0 + FIN_AVISO_MAPA_MS)
      } catch (e) {
        console.warn(`bot-kickoff-mapa: grabación ${id}, falló el barrido de los avisos a Valentino —`, motivoDe(e))
      }
    }
  })
  return json({ ...comun, aceptado: true, estado: 'leyendo', momentos: pre.momentos, descarga_id: descargaId }, 202)
}
