import { NextResponse, after } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { validarReunion } from '@/lib/fathomAnuncios/tipos'
import { idDiscord } from '@/lib/fathomAnuncios/discord'
import { PLAZO_MS, motivoDe, procesarKickoff, trasWebhook } from '@/lib/bot/kickoff/procesar'
import { ESTADOS_FINALES, baseConfigurada, leerKickoff, leerPayload, purgarPayloadsViejos, ultimas } from '@/lib/bot/kickoff/registro'
import { claveClaude } from '@/lib/bot/kickoff/claude'
import { FIN_INVOCACION_MS, depsReales, webhookKickoff } from '@/lib/bot/kickoff/servidor'
import { avisoAdsManual, barrerAvisosAds, comprobarCanalAds, configAvisoAds, depsAvisoAdsReales, revisarAvisosAds, type ResultadoAvisoAds } from '@/lib/bot/kickoff/aviso-ads'
import { avisoAdsEncendido, idValentino, varCanalAds, webhookKickoffAds } from '@/lib/bot/kickoff/entorno'
import { MIN_BYTES_SECRETO, estadoGrabadores, quienDe, secretosWebhook, variablesIgnoradas, verificarFirmaVarios, type Quien } from '@/lib/bot/kickoff/grabadores'
import { ErrorFathomApi, estadoHttpDe, traerReunion } from '@/lib/bot/kickoff/fathomApi'
import { PLAZO_BAJAS_MS, procesarLlamadaBajasReal } from '@/lib/bot/bajas/servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Fathom → ficha de kickoff → ideas de guiones → Discord (Tomi y Gero M). Detalle en docs/BOT-KICKOFF-CJ.md.
// Es un webhook APARTE del de /api/fathom-anuncios (otro secreto, otra tabla), sobre las mismas grabaciones: cada uno decide
// solo qué le toca (este, si la llamada es un kickoff). Las kickoffs las graban Tomás Y Gero M, cada uno con su cuenta de
// Fathom y su propio webhook hacia acá (lib/bot/kickoff/grabadores.ts). Formas de entrar, todas fallan cerrado:
//   · POST con cabeceras webhook-id / webhook-timestamp / webhook-signature → webhook de Fathom ("new meeting content
//     ready"). Firma Standard Webhooks contra TODOS los secretos configurados: FATHOM_KICKOFF_WEBHOOK_SECRET_<QUIEN>
//     (_TOMAS, _GERO_M) y FATHOM_KICKOFF_WEBHOOK_SECRET (el de Tomás de antes, compatibilidad). Vale si verifica con alguno
//     (todos se prueban, en tiempo constante); sin ninguno usable: 503, nunca se acepta sin firma. Un secreto de menos de
//     24 bytes cuenta como mal configurado y otra variable con el mismo prefijo no autentica (se loguea). El log dice el
//     NOMBRE de la variable que verificó, nunca el valor. Se valida el payload (solo grabaciones con url de fathom.video) y se
//     responde 200 ENSEGUIDA; el trabajo (CRM, Claude, Meta, Discord) corre en after() con hasta maxDuration.
//   · POST con "Authorization: Bearer <CRON_SECRET>" y sin cabeceras de webhook → modo manual, sincrónico:
//       - ?recording_id=123 (sin cuerpo): reprocesa con el payload GUARDADO y retoma (reusa ficha e ideas, no repite el aviso);
//       - ?recording_id=123&quien=tomas|gero_m: si no hay payload guardado (la grabación no llegó por el webhook, o ya se
//         borró), la trae de la API de Fathom con FATHOM_API_KEY_<QUIEN> (fathomApi.ts) y la procesa. &desde= / &hasta=
//         (fechas ISO) acotan la búsqueda. Si la fila ya terminó (lista, no_kickoff, omitida), sin forzar → "duplicada"
//         sin pedirle nada a Fathom;
//       - si la fila quedó "duplicada" (la misma reunión llegó antes en otra grabación), con o sin quien y sin forzar: la
//         respuesta nombra la grabación que ganó (duplicada_de) para reintentar ESA; forzar arma otra ficha y otro aviso;
//       - sin recording_id: el cuerpo es el payload de Fathom;
//       - &forzar=1 rehace todo y avisa de nuevo (duplica el aviso);
//       - &dry=1 devuelve la ficha, el markdown y el mensaje sin escribir en la base ni en Discord (con recording_id, la base
//         solo se LEE para traer el payload: las lecturas no crean la tabla; con quien y dry, anda aun sin base). Sí llama a
//         Claude y lee el CRM, Meta y Fathom.
//     Solo por cabecera, nunca ?key= (queda en los logs). La respuesta dice de dónde salió el payload (origen).
//   · GET con Bearer CRON_SECRET → qué variables están configuradas (y, si hay alguna, los NOMBRES de los secretos de
//     webhook y de quién hay API key de Fathom) y las últimas 10 grabaciones; con ?recording_id=123, esa fila con su ficha,
//     sus ideas y la revisión.
// Después de cada grabación del webhook se borra el payload de las filas en error de más de 14 días (privacidad: no hay cron
// propio). Otro método: 405 (Next). Los secretos se comparan en tiempo constante (firma.ts y lib/auth/acceso.ts).
// Quién firmó (24/10): la cuenta de Fathom cuyo secreto verificó (tomas | gero_m) va a procesarKickoff como `grabador` y
// queda en cj_kickoffs (columna grabador): con esa API key se baja el video del mapa. En el modo manual, ?quien= hace lo
// mismo (y si no viene, el de la fila). Publicada el 24/10 (deploy ovc3cbtre): declarada en lib/auth/rutas.ts y fuera del
// matcher de proxy.ts.
// Aviso a Valentino «🚀 Para lanzar» (24/10, lib/bot/kickoff/aviso-ads.ts): sale una vez por grabación, cuando la ficha queda
// lista (o, si se lee el mapa del video, cuando la lectura termina). Si quedó colgado, lo manda el BARRIDO que corre acá
// después de cada grabación del webhook (como la purga de payloads: trasWebhook de procesar.ts), al final de cada lectura
// del mapa y en el modo manual con ?recording_id= de una ficha lista (sin quien: responde 200 con lo que hizo el aviso, no
// el 409 de "sin payload"). A mano: ?recording_id=123&aviso_ads=1 manda el que nunca salió (las fichas de antes, como la de
// Laura) y &aviso_ads=forzar lo vuelve a mandar; con &dry=1 solo devuelve el texto. ?forzar=1 (rehacer el kickoff) no lo
// repite ni manda el de una ficha de antes. Si falla para siempre, a Tomás le llega un aviso corto en #📝-kickoff. El GET
// de estado dice si el webhook del canal existe (canal_ok, sin publicar nada) y qué avisos hay que revisar.
const MAX_CUERPO = 5_000_000   // una llamada de 2 h con transcripción ronda los 300 KB
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

async function leerCuerpo(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CUERPO) return null
  const texto = await req.text()
  return texto.length > MAX_CUERPO ? null : texto
}

function parsear(texto: string): { ok: true; datos: unknown } | { ok: false } {
  try {
    return { ok: true, datos: JSON.parse(texto) }
  } catch {
    return { ok: false }
  }
}

async function webhookFathom(req: Request): Promise<NextResponse> {
  // La hora de llegada: el tope duro de las dependencias (FIN_INVOCACION_MS) cuenta desde acá, no desde after()
  const t0 = Date.now()
  const secretos = secretosWebhook()
  const ignoradas = variablesIgnoradas()
  if (ignoradas.length) console.warn(`bot-kickoff: ${ignoradas.join(', ')} no autentica${ignoradas.length > 1 ? 'n' : ''} (solo valen las de cada persona y la de compatibilidad): sacala${ignoradas.length > 1 ? 's' : ''} del entorno`)
  if (!secretos.length) {
    console.error('bot-kickoff: no hay ningún FATHOM_KICKOFF_WEBHOOK_SECRET[_<QUIEN>] — se rechazan todos los envíos de Fathom')
    return json({ error: 'no configurado' }, 503)
  }
  // El cuerpo CRUDO: la firma se calcula sobre el texto tal cual llegó (se parsea después)
  const cuerpo = await leerCuerpo(req)
  if (cuerpo === null) return json({ error: 'cuerpo demasiado grande' }, 413)
  const h = req.headers
  const firma = verificarFirmaVarios(secretos, { id: h.get('webhook-id'), timestamp: h.get('webhook-timestamp'), firma: h.get('webhook-signature') }, cuerpo)
  if (firma.malConfigurados.length) {
    console.error(`bot-kickoff: ${firma.malConfigurados.join(', ')} no es un secreto whsec_<base64> válido (de ${MIN_BYTES_SECRETO} bytes o más) — los envíos de esa cuenta de Fathom se rechazan`)
  }
  if (!firma.ok && !firma.configurado) return json({ error: 'no configurado' }, 503)
  if (!firma.ok) return json({ error: 'firma inválida' }, 401)
  const p = parsear(cuerpo)
  if (!p.ok) return json({ error: 'JSON inválido' }, 400)
  const v = validarReunion(p.datos)
  if (!v.ok) return json({ error: v.error }, 400)
  const id = v.reunion.recording_id
  // Qué cuenta de Fathom mandó la grabación: el NOMBRE de la variable que verificó la firma (nunca el valor)
  const firmo = `${firma.variable} (${firma.quien})`
  console.log(`bot-kickoff: grabación ${id} recibida, firmada con ${firmo}`)
  // Procesar, purgar los payloads viejos y barrer los avisos a Valentino pendientes (trasWebhook de procesar.ts: nunca lanza)
  after(() => trasWebhook(id, firmo, {
    procesar: () => procesarKickoff(p.datos, depsReales(t0), { deadline: t0 + PLAZO_MS, grabador: firma.quien }),
    purgar: () => purgarPayloadsViejos(),
    ads: depsAvisoAdsReales(),
    deadline: t0 + FIN_INVOCACION_MS - 2_000,
  }))
  // Etapa Bajas (lib/bot/bajas/*, docs/BOT-BAJAS-CJ.md): la MISMA grabación, sin otro webhook, en su PROPIO after() y con su
  // PROPIO tope (t0 + 275 s, antes de los ~280 s del kickoff). Lo que no es de renovación (una kickoff, una reunión interna)
  // se descarta barato: sin Claude, sin Meta, sin escrituras. Idempotente por recording_id. Nace en seco y nunca tira.
  after(() => procesarLlamadaBajasReal(p.datos, { deadline: t0 + PLAZO_BAJAS_MS }).then(() => undefined, () => undefined))
  return json({ recibido: true })
}

/** recording_id de la query: entero positivo, o null si no vino; undefined si vino mal. */
function idDeQuery(u: URL): number | null | undefined {
  const crudo = u.searchParams.get('recording_id')
  if (crudo === null) return null
  const n = Number(crudo.trim())
  return /^\d{1,16}$/.test(crudo.trim()) && Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/** ?quien= : undefined si no vino; null si vino algo que no es tomas ni gero_m. */
function quienDeQuery(u: URL): Quien | null | undefined {
  const crudo = u.searchParams.get('quien')
  return crudo === null ? undefined : quienDe(crudo)
}

/** ?desde= / ?hasta= (fecha ISO): undefined si no vino; null si vino mal. */
function fechaDeQuery(u: URL, k: 'desde' | 'hasta'): string | null | undefined {
  const crudo = u.searchParams.get(k)?.trim()
  if (!crudo) return undefined
  return crudo.length <= 40 && Number.isFinite(Date.parse(crudo)) ? crudo : null
}

// Lo que se le da a Fathom (lista + transcripción + resumen) antes de procesar: el resto del plazo queda para procesarKickoff
const TOPE_FATHOM_MS = 40_000

type Origen = 'registro' | 'fathom' | 'cuerpo'

async function manual(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  const u = new URL(req.url)
  const dry = u.searchParams.get('dry') === '1', forzar = u.searchParams.get('forzar') === '1'
  const id = idDeQuery(u)
  if (id === undefined) return json({ error: 'recording_id inválido (tiene que ser un entero positivo)' }, 400)
  const quien = quienDeQuery(u)
  if (quien === null) return json({ error: 'quien inválido (tomas o gero_m: el que grabó la kickoff con su Fathom)' }, 400)
  if (quien && id === null) return json({ error: 'quien va con recording_id: ?recording_id=123&quien=gero_m' }, 400)
  const desde = fechaDeQuery(u, 'desde'), hasta = fechaDeQuery(u, 'hasta')
  if (desde === null || hasta === null) return json({ error: 'desde / hasta inválidos (fecha ISO, por ejemplo 2026-10-23)' }, 400)
  // Solo el aviso a Valentino de una ficha ya lista (no rehace nada): 1 = el que nunca salió; forzar = de nuevo
  const avisoAds = u.searchParams.get('aviso_ads')
  if (avisoAds !== null) {
    if (avisoAds !== '1' && avisoAds !== 'forzar') return json({ error: 'aviso_ads inválido (1: manda el que nunca salió · forzar: lo vuelve a mandar)' }, 400)
    if (id === null) return json({ error: 'aviso_ads va con recording_id: ?recording_id=123&aviso_ads=1' }, 400)
    if (!baseConfigurada()) return json({ error: 'falta DATABASE_URL' }, 503)
    const r = await avisoAdsManual(id, avisoAds === '1' ? 'uno' : 'forzar', {
      dry, deps: depsAvisoAdsReales(), leer: leerKickoff, config: configAvisoAds(), deadline: t0 + FIN_INVOCACION_MS - 2_000,
    })
    return json({ recording_id: id, aviso_ads: r }, r.estado === 'error' ? 502 : 200)
  }
  let payload: unknown
  let origen: Origen
  let fathom: { quien: Quien; paginas: number; notas: string[] } | undefined
  let grabador: Quien | null = quien ?? null
  if (id !== null) {
    let fila: Awaited<ReturnType<typeof leerPayload>>
    if (baseConfigurada()) {
      try {
        fila = await leerPayload(id)
      } catch (e) {
        return json({ error: `no se pudo leer el registro: ${motivoDe(e)}` }, 503)
      }
    } else if (!(quien && dry)) {
      return json({ error: 'falta DATABASE_URL' }, 503)
    }
    grabador ??= fila?.grabador ?? null
    // El próximo reproceso de una ficha lista también manda el aviso a Valentino si quedó pendiente (sin rehacer nada)
    let adsLista: ResultadoAvisoAds | undefined
    const adsDeps = fila?.estado === 'lista' && !dry && !forzar ? depsAvisoAdsReales() : null
    if (adsDeps) adsLista = (await barrerAvisosAds(adsDeps, { id, deadline: t0 + FIN_INVOCACION_MS - 2_000 }))[0]?.ads
    const conAds = (x: Record<string, unknown>) => (adsLista ? { ...x, aviso_ads: adsLista } : x)
    // Una duplicada (la misma reunión llegó antes en otra grabación): se nombra la que ganó, que es la que tiene la ficha y
    // el aviso. Forzar acá arma OTRA ficha de la misma reunión y vuelve a avisar: se dice, en vez de sugerirlo
    if (fila?.estado === 'duplicada' && !forzar && !dry) {
      const de = fila.duplicada_de
      return json({
        estado: 'duplicada', recording_id: id, duplicada_de: de,
        motivo: de
          ? `es la misma reunión que la grabación ${de}: la ficha y el aviso son de esa (para reintentar, usá recording_id=${de}). Con &forzar=1 se arma OTRA ficha de la misma reunión y sale otro aviso.`
          : 'quedó como duplicada de otra grabación de la misma reunión: la ficha y el aviso son de esa. Con &forzar=1 se arma OTRA ficha de la misma reunión y sale otro aviso.',
      })
    }
    if (fila?.payload) {
      payload = fila.payload
      origen = 'registro'
    } else if (!quien) {
      if (!fila) return json({ error: `la grabación ${id} no está en el registro: para traerla de Fathom, sumá &quien=tomas o &quien=gero_m (el que la grabó)` }, 404)
      // Una ficha lista (sin payload: se borra al terminar) que corrió el barrido: no es un error, es lo que se pidió
      if (fila.estado === 'lista' && adsLista) {
        return json({ estado: 'lista', recording_id: id, aviso_ads: adsLista, motivo: 'la ficha ya está lista: no hay nada que reprocesar (para rehacerla, sumá &quien=tomas o &quien=gero_m y &forzar=1)' })
      }
      return json(conAds({ error: `la grabación ${id} no tiene el payload guardado (estado ${fila.estado}): si hay que reprocesarla, sumá &quien=tomas o &quien=gero_m para traerla de Fathom, o mandá el payload en el cuerpo, sin recording_id` }), 409)
    } else if (fila && !dry && !forzar && (ESTADOS_FINALES as readonly string[]).includes(fila.estado)) {
      // procesarKickoff daría "duplicada" igual: no vale la pena gastar pedidos de Fathom (los pesados son 30 por minuto)
      return json(conAds({ estado: 'duplicada', recording_id: id, motivo: `ya está en el registro como ${fila.estado}: con &forzar=1 se rehace y se avisa de nuevo` }))
    } else {
      try {
        const t = await traerReunion(id, quien, { deadline: t0 + TOPE_FATHOM_MS, creadoDesde: desde, creadoHasta: hasta })
        payload = t.payload
        origen = 'fathom'
        fathom = { quien, paginas: t.paginas, notas: t.notas }
      } catch (e) {
        const m = motivoDe(e)
        console.error(`bot-kickoff: grabación ${id}, no se pudo traer de Fathom (${quien}) —`, m)
        if (!(e instanceof ErrorFathomApi)) return json({ error: `no se pudo traer la grabación de Fathom: ${m}` }, 502)
        const reintentar = e.reintentarEnS !== null ? { 'Retry-After': String(e.reintentarEnS) } : null
        return NextResponse.json({ error: m, fathom: e.codigo }, { status: estadoHttpDe(e), headers: { ...SIN_CACHE, ...reintentar } })
      }
    }
  } else {
    const cuerpo = await leerCuerpo(req)
    if (cuerpo === null) return json({ error: 'cuerpo demasiado grande' }, 413)
    const p = parsear(cuerpo)
    if (!p.ok) return json({ error: 'JSON inválido' }, 400)
    payload = p.datos
    origen = 'cuerpo'
  }
  // El plazo y el tope duro de las dependencias cuentan desde que entró el pedido (incluyen lo que tardaron la base y
  // Fathom, hasta 50 s), no desde que arranca el proceso: si no, el aviso de error podía quedar después de los 300 s
  const r = await procesarKickoff(payload, depsReales(t0), { dry, forzar, deadline: t0 + PLAZO_MS, grabador })
  if (r.estado === 'invalida') return json({ error: r.motivo, origen }, 400)
  return json({ ...r, origen, ...(fathom ? { fathom } : {}) }, r.estado === 'error' ? 500 : 200)
}

export async function POST(req: Request) {
  const h = req.headers
  if (h.has('webhook-id') || h.has('webhook-timestamp') || h.has('webhook-signature')) return webhookFathom(req)
  if (accesoMaquina(h)) return manual(req)
  return json({ error: 'no autorizado' }, 401)
}

export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return json({ error: 'no autorizado' }, 401)
  const u = new URL(req.url)
  const id = idDeQuery(u)
  if (id === undefined) return json({ error: 'recording_id inválido (tiene que ser un entero positivo)' }, 400)
  // Los nombres de los secretos de webhook y de quién hay API key de Fathom: solo si hay alguno (nunca los valores)
  const grabadores = estadoGrabadores()
  const conGrabadores = grabadores.firmas.length || grabadores.firmas_invalidas.length || grabadores.ignoradas.length || grabadores.api.length ? { fathom: grabadores } : {}
  const configurado = {
    anthropic: !!claveClaude(),
    firma_fathom: grabadores.firmas.length > 0,
    discord: !!webhookKickoff(),
    tomi: !!idDiscord(process.env.DISCORD_ID_TOMAS),
    gero_m: !!idDiscord(process.env.DISCORD_ID_GERO_M),
    meta: !!(process.env.META_ANUNCIOS_TOKEN?.trim() || process.env.META_CLIENTES_TOKEN?.trim()),
    base: baseConfigurada(),
  }
  if (id !== null) {
    if (!configurado.base) return json({ error: 'falta DATABASE_URL' }, 503)
    try {
      const fila = await leerKickoff(id)
      return fila ? json(fila) : json({ error: `la grabación ${id} no está en el registro` }, 404)
    } catch (e) {
      return json({ error: `no se pudo leer el registro: ${motivoDe(e)}` }, 503)
    }
  }
  let filas: Awaited<ReturnType<typeof ultimas>> = []
  let errorBase: string | null = null
  if (configurado.base) {
    try {
      filas = await ultimas(10)
    } catch (e) {
      errorBase = motivoDe(e)
    }
  }
  // El aviso a Valentino: solo si hay canal (el NOMBRE de la variable, nunca el valor). canal_ok: el webhook existe (un GET
  // a Discord que no publica nada; false = se borró o se regeneró y cada aviso terminaría rechazado). revisar: de las
  // últimas filas, los avisos rechazados, dudosos, colgados a mitad o pendientes viejos, con cómo reintentarlos
  const canalAds = varCanalAds()
  let conAds = {}
  if (canalAds) {
    const canal = await comprobarCanalAds(webhookKickoffAds())
    const revisar = revisarAvisosAds(filas, Date.now())
    conAds = {
      aviso_ads: {
        encendido: avisoAdsEncendido(), canal: canalAds, canal_ok: canal.ok, ...(canal.motivo ? { canal_motivo: canal.motivo } : {}),
        valentino: !!idValentino(), ...(revisar.length ? { revisar } : {}),
      },
    }
  }
  return json({ configurado, ...conGrabadores, ...conAds, ultimas: filas, ...(errorBase ? { error_base: errorBase } : {}) })
}
