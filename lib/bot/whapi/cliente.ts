// ── Bot "Capital Jurídico": cliente REAL de Whapi.Cloud (BLOQUE W) ───────────────────────────────────────────────────────
// SOLO SERVIDOR (usa WHAPI_TOKEN). `fetch` contra https://gate.whapi.cloud con "Authorization: Bearer <token>" y un corte por
// pedido. Nunca se arma con otra base: el token no viaja a otro host. Referencia: OpenAPI 1.8.7 de whapi.readme.io.
// Reglas:
//   · Las ESCRITURAS (mandar, crear, agregar, foto, info, agendar) nunca se reintentan: un 5xx, un 524, un corte o un error
//     de red sale como 'dudoso' (aplicado: null) y decide el orquestador. Las LECTURAS (media, subgrupos, invitación,
//     comunidades, verificar números) se reintentan una vez ante un 5xx o un error de red.
//   · Los ids "seco-…" y "jg-…" (de la compuerta en seco y del juguete) se rechazan con 'config' antes de salir: tercera
//     barrera del modo seco.
//   · Las menciones exigen "@<número>" en el texto (lo arma quien llama): si falta, 'config' y no sale nada.
//   · Video (revisión 6): primero se SUBE con POST /media (una vez por URL y por proceso, se reusa 24 h) y se manda con el
//     MediaID. Si falla la subida no se mandó nada (aplicado: false) y el envío en sí es corto, así casi no hay 524.
//   · `SentMessage.message` (con el id) es opcional en la referencia: si no viene, EnvioWhapi.id queda en null y lo recupera
//     el eco del webhook (EventoEco).
//   · Crear un grupo devuelve un Group SIN `failed`: los fallidos se calculan comparando los pedidos con los `participants`
//     que vuelven (revisión 33). Un participante que vuelve solo como @lid no se puede emparejar y cuenta como fallido (el
//     aviso a Aylu lo revisa con los links de invitación).
//   · WhatsApp seguro (26/10/2026, salud.ts): antes de CADA escritura se mira GET /health (caché de 60 s); si el número no
//     está en AUTH no sale nada (ErrorWhapi 'sin_numero', aplicado: false) y se avisa una vez a Discord. Un 401, un 403 o un
//     "banned" en cualquier respuesta pasa por la misma guardia. Los tests del mapeo HTTP la apagan con `salud: null`.
//   · buscarComunidades: GET /communities paginado (100 por página, hasta 5 páginas) filtrando por nombre exacto y fecha
//     (GET /groups no filtra por nombre: revisión 5).
// El registro guarda lo que salió, con los textos recortados a 120 caracteres; nunca el token ni los archivos.
import type {
  ClienteWhapi, EnvioWhapi, FotoGrupo, GrupoWhapi, LlamadaWhapi, MedioDescargado, ParticipanteGrupo, RefMedio, ResultadoParticipantes,
  ResultadoQuitar,
} from '@/lib/bot/alta/motor/tipos'
import {
  BASE_WHAPI, ESCRITURAS, PATRON_DESTINO, PATRON_GRUPO, PATRON_ID_MENSAJE, PATRON_INVITACION, PATRON_MEDIA_ID, PATRON_MENCION,
  URL_INVITACION, describir, esIdSimulado, faltanMenciones, isoDeMarca, lidDe, llamada, telefonoDe, type MetodoWhapi,
} from './comun'
import { tokenValido } from './config'
import { ErrorWhapi, errorDeRed, errorPorStatus, esErrorWhapi, limpiarDetalle } from './errores'
import { MAX_BYTES_MEDIO, MAX_REDIRECCIONES_MEDIO, armarMedio, destinoMedioPermitido, leerConTope } from './medios'
import { guardiaWhapi, type GuardiaSalud } from './salud'

export const CORTE_PEDIDO_MS = 30_000
/** Whapi espera hasta 110 s a WhatsApp en un envío o subida de media y después responde 524. */
export const CORTE_VIDEO_MS = 115_000
export const CORTE_MEDIO_MS = 60_000
export const ESPERA_REINTENTO_MS = 1_500
/** Sin 2 s libres hasta el plazo no se llama (seguro no se hizo). */
export const MARGEN_MIN_MS = 2_000
export const VIGENCIA_VIDEO_SUBIDO_MS = 24 * 3600_000
export const PAGINA_COMUNIDADES = 100
export const MAX_PAGINAS_COMUNIDADES = 5
const MAX_TEXTO = 60_000

export interface OpcionesClienteWhapi {
  token: string
  /** Para los tests. Por defecto el fetch global (se lee en cada llamada). */
  fetch?: typeof fetch
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
  /** Corta cada pedido (por defecto AbortSignal.timeout). */
  senal?: (ms: number) => AbortSignal
  /** Guardia de salud del número (salud.ts). Por defecto la del proceso; null la apaga (SOLO los tests del mapeo HTTP). */
  salud?: GuardiaSalud | null
}

export type ClienteWhapiReal = ClienteWhapi & {
  readonly modo: 'real'
  buscarComunidades(p: { nombre: string; desde: string }): Promise<GrupoWhapi[]>
  participantesGrupo(grupoId: string): Promise<ParticipanteGrupo[]>
  quitarParticipantes(p: { grupoId: string; participantes: string[] }): Promise<ResultadoQuitar>
  eliminarComunidad(comunidadId: string): Promise<void>
}

type Verbo = 'GET' | 'POST' | 'PUT' | 'DELETE'
interface Pedido {
  metodo: MetodoWhapi
  args: Record<string, unknown>
  verbo: Verbo
  ruta: string
  cuerpo?: unknown
  corteMs?: number
  hasta?: number
}

type Obj = Record<string, unknown>
const obj = (x: unknown): Obj | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : null)
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const esCorte = (e: unknown) => ['TimeoutError', 'AbortError'].includes((e as Error)?.name)
const normalNombre = (t: unknown) => (typeof t === 'string' ? t.normalize('NFC').replace(/\s+/g, ' ').trim() : '')
const esUrlHttps = (u: string) => {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' && !x.username && !x.password
  } catch {
    return false
  }
}

function parsearJson(texto: string): unknown {
  if (!texto.trim()) return {}
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}
const mensajeDeError = (json: unknown): string | null => str(obj(obj(json)?.error)?.message) ?? str(obj(json)?.message)

export function crearClienteWhapi(op: OpcionesClienteWhapi): ClienteWhapiReal {
  const token = typeof op.token === 'string' ? op.token.trim() : ''
  if (!tokenValido(token)) throw new ErrorWhapi('config', 'Whapi: falta WHAPI_TOKEN o tiene una forma imposible', null, false)
  const f: typeof fetch = op.fetch ?? ((entrada, init) => globalThis.fetch(entrada, init))
  const ahora = op.ahora ?? Date.now
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const senal = op.senal ?? ((ms: number) => AbortSignal.timeout(ms))
  const registro: LlamadaWhapi[] = []
  const videosSubidos = new Map<string, { id: string; en: number }>()
  const salud = op.salud === undefined ? guardiaWhapi() : op.salud
  const ctxSalud = { token, fetch: f, ahora }

  const config = (m: string) => new ErrorWhapi('config', `Whapi: ${m}`, null, false)

  // ── Validaciones (antes de salir: un 'config' nunca llega a Whapi) ──
  const sinSimulado = (id: string, campo: string) => {
    if (esIdSimulado(id)) throw config(`${campo} "${id.slice(0, 40)}" es un id simulado (seco-/jg-): no se manda a WhatsApp`)
  }
  const chat = (id: unknown, campo = 'el chat'): string => {
    if (typeof id !== 'string' || !id.trim()) throw config(`falta ${campo}`)
    const t = id.trim()
    sinSimulado(t, campo)
    if (!PATRON_DESTINO.test(t)) throw config(`${campo} no tiene una forma que Whapi acepte`)
    return t
  }
  const grupo = (id: unknown, campo = 'el grupo'): string => {
    const t = chat(id, campo)
    if (!PATRON_GRUPO.test(t)) throw config(`${campo} tiene que ser un chat de grupo ("…@g.us")`)
    return t
  }
  const idMensaje = (id: unknown): string => {
    if (typeof id !== 'string' || !id.trim()) throw config('el mensaje a citar no tiene id')
    const t = id.trim()
    sinSimulado(t, 'el mensaje a citar')
    if (!PATRON_ID_MENSAJE.test(t)) throw config('el id del mensaje a citar no tiene una forma válida')
    return t
  }
  const participante = (p: unknown): string => {
    const tel = telefonoDe(p)
    if (tel) return tel
    const lid = lidDe(p)
    if (lid) return lid
    throw config('un participante no es un teléfono (7 a 15 dígitos) ni un @lid')
  }
  const participantes = (lista: unknown): string[] => {
    if (!Array.isArray(lista) || !lista.length) throw config('no hay participantes')
    return [...new Set(lista.map(participante))]
  }

  // ── El pedido ──
  async function pedirJson(p: Pedido): Promise<unknown> {
    const escritura = ESCRITURAS.has(p.metodo)
    const inicio = ahora()
    const limite = Math.min(inicio + (p.corteMs ?? CORTE_PEDIDO_MS), p.hasta ?? Infinity)
    const restante = Math.floor(limite - inicio)
    if (!(restante >= MARGEN_MIN_MS)) throw new ErrorWhapi('pasajero', `Whapi ${p.metodo}: no queda tiempo para llamar (no se mandó nada)`, null, false)
    // WhatsApp seguro: con el número caído o suspendido no sale nada que no sea un GET: ni las escrituras, ni la subida de
    // un video (POST /media) ni la verificación de números (POST /contacts, que también toca WhatsApp). Tira 'sin_numero'
    if (p.verbo !== 'GET' && salud) await salud.antesDeEscribir(ctxSalud)
    const d = describir(p.metodo, p.args)
    registro.push(llamada(p.verbo, p.ruta, d.resumen, false, inicio))
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    if (p.cuerpo !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await f(BASE_WHAPI + p.ruta, {
        method: p.verbo, headers, body: p.cuerpo === undefined ? undefined : JSON.stringify(p.cuerpo), signal: senal(restante), redirect: 'error',
      })
    } catch (e) {
      throw errorDeRed(escritura, p.metodo, esCorte(e) ? 'corte' : 'red')
    }
    let texto: string
    try {
      texto = await res.text()
    } catch (e) {
      throw errorDeRed(escritura, p.metodo, esCorte(e) ? 'corte' : 'red')
    }
    const json = parsearJson(texto)
    if (!res.ok && salud) await salud.alResponder(ctxSalud, res.status, json ?? texto).catch(() => {})
    if (!res.ok) throw errorPorStatus(res.status, escritura, p.metodo, limpiarDetalle(mensajeDeError(json) ?? (json === undefined ? texto : ''), token))
    if (json === undefined) {
      throw escritura
        ? new ErrorWhapi('dudoso', `Whapi ${p.metodo}: respondió ${res.status} sin JSON. No se sabe si se hizo.`, res.status, null)
        : new ErrorWhapi('pasajero', `Whapi ${p.metodo}: respondió ${res.status} sin JSON.`, res.status, false)
    }
    return json
  }

  /** Lectura: un reintento ante un 5xx o un error de red, si queda tiempo. */
  async function leer<T>(p: Pedido, usar: (json: unknown) => T): Promise<T> {
    try {
      return usar(await pedirJson(p))
    } catch (e) {
      const reintentable = esErrorWhapi(e) && e.tipo === 'pasajero' && (e.status === null || e.status >= 500) && !/no queda tiempo/.test(e.message)
      if (!reintentable || (p.hasta !== undefined && p.hasta - ahora() < ESPERA_REINTENTO_MS + MARGEN_MIN_MS)) throw e
      await esperar(ESPERA_REINTENTO_MS)
      return usar(await pedirJson(p))
    }
  }

  /** Escritura: nunca se reintenta. */
  const escribir = async <T>(p: Pedido, usar: (json: unknown) => T): Promise<T> => usar(await pedirJson(p))

  const sinIdDudoso = (accion: string) =>
    new ErrorWhapi('dudoso', `Whapi ${accion}: respondió sin el id. No se sabe si se creó: no se reintenta solo.`, 200, null)
  const exito = (accion: string) => (json: unknown): void => {
    if (obj(json)?.success === false) throw new ErrorWhapi('rechazo', `Whapi ${accion}: respondió success: false`, 200, false)
  }
  const grupoDe = (json: unknown, accion: string): GrupoWhapi => {
    const o = obj(json)
    const id = str(o?.id)
    if (!o || !id || !PATRON_GRUPO.test(id)) throw sinIdDudoso(accion)
    return { id, nombre: str(o.name) ?? str(o.subject), codigoInvitacion: str(o.invite_code), creadoEn: isoDeMarca(o.created_at) }
  }
  const envioDe = (accion: string) => (json: unknown): EnvioWhapi => {
    const o = obj(json)
    if (o?.sent === false) throw new ErrorWhapi('rechazo', `Whapi ${accion}: respondió sent: false (no salió)`, 200, false)
    return { id: str(obj(o?.message)?.id), simulado: false }
  }
  /** Para emparejar lo que pedimos con lo que devuelve Whapi (DataModeIdentity: texto o { id, phone }). */
  const clave = (x: unknown): string | null => telefonoDe(x) ?? lidDe(x)

  async function bajar(ruta: string, m: RefMedio, maxBytes: number, hasta: number | undefined): Promise<MedioDescargado> {
    const inicio = ahora()
    const limite = Math.min(inicio + CORTE_MEDIO_MS, hasta ?? Infinity)
    const restante = Math.floor(limite - inicio)
    if (!(restante >= MARGEN_MIN_MS)) throw new ErrorWhapi('pasajero', 'Whapi descargarMedio: no queda tiempo para bajar el comprobante', null, false)
    registro.push(llamada('GET', ruta, describir('descargarMedio', { id: m.id, tipo: m.tipo, mime: m.mime }).resumen, false, inicio))
    const s = senal(restante)
    let url = new URL(BASE_WHAPI + ruta)
    for (let salto = 0; ; salto++) {
      const conToken = destinoMedioPermitido(url) === 'whapi'
      let res: Response
      try {
        res = await f(url.href, { method: 'GET', headers: conToken ? { Authorization: `Bearer ${token}` } : {}, signal: s, redirect: 'manual' })
      } catch (e) {
        throw errorDeRed(false, 'descargarMedio', esCorte(e) ? 'corte' : 'red')
      }
      if (res.status >= 300 && res.status < 400) {
        const destino = res.headers.get('location')
        let siguiente: URL | null = null
        try {
          siguiente = destino ? new URL(destino, url) : null
        } catch {
          siguiente = null
        }
        try { await res.body?.cancel() } catch { /* nada */ }
        if (!siguiente || !destinoMedioPermitido(siguiente) || salto >= MAX_REDIRECCIONES_MEDIO) {
          throw new ErrorWhapi('rechazo', 'Whapi descargarMedio: redirigió a un destino no permitido (solo gate.whapi.cloud o wasabisys.com por https)', res.status, false)
        }
        url = siguiente
        continue
      }
      if (!res.ok) {
        let detalle = ''
        try { detalle = limpiarDetalle(mensajeDeError(parsearJson(await res.text())), token) } catch { /* nada */ }
        throw errorPorStatus(res.status, false, 'descargarMedio', detalle)
      }
      let bytes: Buffer
      try {
        bytes = await leerConTope(res, maxBytes)
      } catch (e) {
        if (esErrorWhapi(e)) throw e
        throw errorDeRed(false, 'descargarMedio', esCorte(e) ? 'corte' : 'red')
      }
      return armarMedio(bytes, m, res.headers.get('content-type'))
    }
  }

  /** MediaID del video: lo sube una vez por URL (POST /media) y lo reusa 24 h dentro del proceso. */
  async function medioDeVideo(url: string, hasta?: number): Promise<string> {
    const previo = videosSubidos.get(url)
    if (previo && ahora() - previo.en < VIGENCIA_VIDEO_SUBIDO_MS) return previo.id
    const id = await escribir({ metodo: 'subirMedio', args: {}, verbo: 'POST', ruta: '/media', cuerpo: { media: url, no_encode: true }, corteMs: CORTE_VIDEO_MS, ...(hasta !== undefined ? { hasta } : {}) }, (json) => {
      const lista = obj(json)?.media
      const primero = Array.isArray(lista) ? str(obj(lista[0])?.id) : null
      if (!primero || !PATRON_MEDIA_ID.test(primero)) throw new ErrorWhapi('pasajero', 'Whapi subirMedio: subió el video sin devolver el MediaID (no se mandó nada)', 200, false)
      return primero
    })
    videosSubidos.set(url, { id, en: ahora() })
    return id
  }

  const cliente: ClienteWhapiReal = {
    modo: 'real',

    async enviarTexto(p) {
      const to = chat(p.chatId)
      if (typeof p.texto !== 'string' || !p.texto.trim()) throw config('el texto está vacío')
      if (p.texto.length > MAX_TEXTO) throw config(`el texto tiene más de ${MAX_TEXTO} caracteres`)
      const quoted = p.citar ? idMensaje(p.citar) : null
      const menciones = p.menciones ?? []
      if (menciones.some((m) => typeof m !== 'string' || !PATRON_MENCION.test(m))) throw config('una mención no tiene la forma que pide Whapi (7 a 15 dígitos)')
      const faltan = faltanMenciones(p.texto, menciones)
      if (faltan.length) throw config(`el texto no trae "@<número>" de ${faltan.length} mención(es): Whapi lo exige`)
      const cuerpo: Obj = { to, body: p.texto }
      if (quoted) cuerpo.quoted = quoted
      if (menciones.length) cuerpo.mentions = menciones
      return escribir({ metodo: 'enviarTexto', args: p, verbo: 'POST', ruta: '/messages/text', cuerpo }, envioDe('enviarTexto'))
    },

    async enviarVideo(p) {
      const to = chat(p.chatId)
      const quoted = p.citar ? idMensaje(p.citar) : null
      const u = typeof p.url === 'string' ? p.url.trim() : ''
      if (!u) throw config('falta la URL del video')
      sinSimulado(u, 'el video')
      let media: string
      if (PATRON_MEDIA_ID.test(u)) media = u
      else if (esUrlHttps(u)) media = await medioDeVideo(u, p.hasta)
      else throw config('el video tiene que ser una URL https o un MediaID')
      const cuerpo: Obj = { to, media, no_encode: true }
      if (p.pie) cuerpo.caption = p.pie
      if (quoted) cuerpo.quoted = quoted
      // `hasta`: el plazo de la invocación cubre la subida y el envío juntos (revisión del 24/10)
      return escribir({ metodo: 'enviarVideo', args: p, verbo: 'POST', ruta: '/messages/video', cuerpo, corteMs: CORTE_VIDEO_MS, ...(p.hasta !== undefined ? { hasta: p.hasta } : {}) }, envioDe('enviarVideo'))
    },

    async descargarMedio(m, o) {
      if (!m || typeof m.id !== 'string') throw config('el medio no tiene id')
      const id = m.id.trim()
      sinSimulado(id, 'el medio')
      if (!PATRON_MEDIA_ID.test(id)) throw config('el id del medio no tiene la forma de un MediaID')
      const max = Math.min(o?.maxBytes ?? MAX_BYTES_MEDIO, MAX_BYTES_MEDIO)
      const ruta = `/media/${encodeURIComponent(id)}`
      try {
        return await bajar(ruta, m, max, o?.hasta)
      } catch (e) {
        const reintentable = esErrorWhapi(e) && e.tipo === 'pasajero' && (e.status === null || e.status >= 500) && !/no queda tiempo/.test(e.message)
        if (!reintentable || (o?.hasta !== undefined && o.hasta - ahora() < ESPERA_REINTENTO_MS + MARGEN_MIN_MS)) throw e
        await esperar(ESPERA_REINTENTO_MS)
        return bajar(ruta, m, max, o?.hasta)
      }
    },

    async crearComunidad(p) {
      const nombre = typeof p.nombre === 'string' ? p.nombre.trim() : ''
      if (!nombre || nombre.length > 100) throw config('el nombre de la comunidad tiene que tener de 1 a 100 caracteres')
      if (typeof p.descripcion !== 'string') throw config('Whapi pide la descripción de la comunidad')
      return escribir({ metodo: 'crearComunidad', args: p, verbo: 'POST', ruta: '/communities', cuerpo: { subject: nombre, description: p.descripcion } }, (j) => grupoDe(j, 'crearComunidad'))
    },

    async subgruposComunidad(comunidadId) {
      const id = grupo(comunidadId, 'la comunidad')
      return leer({ metodo: 'subgruposComunidad', args: { comunidadId: id }, verbo: 'GET', ruta: `/communities/${encodeURIComponent(id)}/subgroups` }, (json) => {
        const o = obj(json) ?? {}
        const a = obj(o.announceGroupInfo)
        const aGrupo = (g: Obj | null): GrupoWhapi | null => {
          const gid = str(g?.id)
          if (!g || !gid) return null
          return {
            id: gid, nombre: str(g.title), codigoInvitacion: str(g.inviteCode), creadoEn: isoDeMarca(g.creationTime),
            generalChat: obj(g.properties)?.general_chat === true,
          }
        }
        const otros = (Array.isArray(o.otherGroups) ? o.otherGroups : []).map((g) => aGrupo(obj(g))).filter((g): g is GrupoWhapi => g !== null)
        const avisos = aGrupo(a)
        return { avisos: avisos ? { ...avisos, generalChat: false } : null, otros }
      })
    },

    async crearGrupoEnComunidad(p) {
      const comunidadId = grupo(p.comunidadId, 'la comunidad')
      const nombre = typeof p.nombre === 'string' ? p.nombre.trim() : ''
      if (!nombre || nombre.length > 100) throw config('el nombre del grupo tiene que tener de 1 a 100 caracteres')
      const pedidos = participantes(p.participantes)
      return escribir({
        metodo: 'crearGrupoEnComunidad', args: p, verbo: 'POST', ruta: `/communities/${encodeURIComponent(comunidadId)}`, cuerpo: { subject: nombre, participants: pedidos },
      }, (json) => {
        const g = grupoDe(json, 'crearGrupoEnComunidad')
        const o = obj(json) ?? {}
        const volvieron = new Set((Array.isArray(o.participants) ? o.participants : []).map((x) => clave(obj(x)?.id ?? x)).filter((x): x is string => !!x))
        const sinProcesar = new Set((Array.isArray(o.unprocessed_participants) ? o.unprocessed_participants : []).map((x) => clave(obj(x)?.id ?? x)).filter((x): x is string => !!x))
        const agregados = pedidos.filter((x) => volvieron.has(x) && !sinProcesar.has(x))
        const fallidos = pedidos.filter((x) => !agregados.includes(x))
        return { ...g, agregados, fallidos }
      })
    },

    async agregarParticipantes(p) {
      const grupoId = grupo(p.grupoId)
      const pedidos = participantes(p.participantes)
      const base = p.esComunidad ? 'communities' : 'groups'
      return escribir({
        metodo: 'agregarParticipantes', args: p, verbo: 'POST', ruta: `/${base}/${encodeURIComponent(grupoId)}/participants`, cuerpo: { participants: pedidos },
      }, (json): ResultadoParticipantes => {
        const o = obj(json) ?? {}
        const conjunto = (x: unknown) => (Array.isArray(x) ? new Set(x.map(clave).filter((v): v is string => !!v)) : null)
        const fallaron = conjunto(o.failed), procesados = conjunto(o.processed)
        if (!fallaron && !procesados) return o.success === false ? { agregados: [], fallidos: pedidos } : { agregados: pedidos, fallidos: [] }
        const fallidos = pedidos.filter((x) => fallaron?.has(x) || (procesados !== null && !procesados.has(x)))
        return { agregados: pedidos.filter((x) => !fallidos.includes(x)), fallidos }
      })
    },

    async ponerFoto(p: { grupoId: string; foto: FotoGrupo }) {
      const grupoId = grupo(p.grupoId)
      const foto = obj(p.foto) ?? {}
      let cuerpo: Obj
      if (typeof foto.url === 'string') {
        if (!esUrlHttps(foto.url)) throw config('la foto tiene que ser una URL https')
        cuerpo = { media: foto.url }
      } else if (typeof foto.base64 === 'string' && (foto.mime === 'image/jpeg' || foto.mime === 'image/png')) {
        if (!/^[A-Za-z0-9+/=\s]+$/.test(foto.base64)) throw config('la foto en base64 no es base64')
        cuerpo = { media: `data:${foto.mime};base64,${foto.base64.replace(/\s+/g, '')}`, mime_type: foto.mime }
      } else throw config('la foto tiene que ser una URL https o base64 jpeg/png')
      return escribir({ metodo: 'ponerFoto', args: p, verbo: 'PUT', ruta: `/groups/${encodeURIComponent(grupoId)}/icon`, cuerpo }, exito('ponerFoto'))
    },

    async cambiarInfoGrupo(p) {
      const grupoId = grupo(p.grupoId)
      const cuerpo: Obj = {}
      if (p.nombre !== undefined) {
        const n = String(p.nombre).trim()
        if (!n || n.length > 100) throw config('el nombre del grupo tiene que tener de 1 a 100 caracteres')
        cuerpo.subject = n
      }
      if (p.descripcion !== undefined) cuerpo.description = String(p.descripcion)
      if (!Object.keys(cuerpo).length) throw config('no hay nada para cambiar en el grupo')
      return escribir({ metodo: 'cambiarInfoGrupo', args: p, verbo: 'PUT', ruta: `/groups/${encodeURIComponent(grupoId)}`, cuerpo }, exito('cambiarInfoGrupo'))
    },

    async linkInvitacion(grupoId) {
      const id = grupo(grupoId)
      return leer({ metodo: 'linkInvitacion', args: { grupoId: id }, verbo: 'GET', ruta: `/groups/${encodeURIComponent(id)}/invite` }, (json) => {
        const codigo = str(obj(json)?.invite_code)
        if (!codigo || !PATRON_INVITACION.test(codigo)) throw new ErrorWhapi('pasajero', 'Whapi linkInvitacion: respondió sin un invite_code válido', 200, false)
        return `${URL_INVITACION}${codigo}`
      })
    },

    async verificarNumeros(numeros) {
      if (!Array.isArray(numeros) || !numeros.length) return {}
      const contactos = [...new Set(numeros.map((x) => String(x).trim()).filter(Boolean))]
      return leer({ metodo: 'verificarNumeros', args: { numeros: contactos }, verbo: 'POST', ruta: '/contacts', cuerpo: { blocking: 'wait', contacts: contactos, force_check: false } }, (json) => {
        const salida: Record<string, 'valido' | 'invalido'> = {}
        for (const c of Array.isArray(obj(json)?.contacts) ? (obj(json)!.contacts as unknown[]) : []) {
          const o = obj(c)
          const entrada = str(o?.input)
          if (entrada && (o?.status === 'valid' || o?.status === 'invalid')) salida[entrada] = o.status === 'valid' ? 'valido' : 'invalido'
        }
        return salida
      })
    },

    async agendarContacto(p) {
      const telefono = telefonoDe(p.telefono)
      if (!telefono) throw config('el teléfono del contacto tiene que ser de 7 a 15 dígitos')
      const nombre = typeof p.nombre === 'string' ? p.nombre.trim() : ''
      if (!nombre) throw config('el contacto necesita nombre')
      return escribir({ metodo: 'agendarContacto', args: p, verbo: 'PUT', ruta: '/contacts', cuerpo: { phone: telefono, name: nombre } }, () => undefined)
    },

    async buscarComunidades(p) {
      const objetivo = normalNombre(p.nombre)
      const desdeMs = Date.parse(p.desde)
      if (!objetivo || !Number.isFinite(desdeMs)) throw config('buscarComunidades pide el nombre y una fecha ISO')
      const halladas: GrupoWhapi[] = []
      for (let pagina = 0; pagina < MAX_PAGINAS_COMUNIDADES; pagina++) {
        const ruta = `/communities?count=${PAGINA_COMUNIDADES}&offset=${pagina * PAGINA_COMUNIDADES}`
        const { lista, total } = await leer({ metodo: 'buscarComunidades', args: p, verbo: 'GET', ruta }, (json) => ({
          lista: Array.isArray(obj(json)?.groups) ? (obj(json)!.groups as unknown[]) : [],
          total: num(obj(json)?.total),
        }))
        for (const x of lista) {
          const g = obj(x)
          const id = str(g?.id)
          if (!g || !id || normalNombre(g.name) !== objetivo) continue
          const creadoEn = isoDeMarca(g.created_at)
          // Sin fecha no se puede descartar: queda, con creadoEn null, y decide el orquestador
          if (creadoEn && Date.parse(creadoEn) < desdeMs) continue
          halladas.push({ id, nombre: str(g.name), codigoInvitacion: str(g.invite_code), creadoEn })
        }
        if (lista.length < PAGINA_COMUNIDADES || (total !== null && (pagina + 1) * PAGINA_COMUNIDADES >= total)) break
      }
      return halladas
    },

    // Etapa Bajas (25/10/2026): leer los participantes de un grupo y quitar al cliente. GET /groups/{id} devuelve
    // participants [{ id, rank: 'creator' | 'admin' | 'member' }]; DELETE /groups/{id}/participants con { participants }
    // responde como el POST de agregar ({ success } o { processed, failed }). Quitar es una ESCRITURA: no se reintenta.
    async participantesGrupo(grupoId) {
      const id = grupo(grupoId)
      return leer({ metodo: 'participantesGrupo', args: { grupoId: id }, verbo: 'GET', ruta: `/groups/${encodeURIComponent(id)}` }, (json) => {
        const lista = obj(json)?.participants
        if (!Array.isArray(lista)) throw new ErrorWhapi('pasajero', 'Whapi participantesGrupo: respondió sin la lista de participantes', 200, false)
        const out: ParticipanteGrupo[] = []
        for (const x of lista) {
          const o = obj(x)
          const pid = clave(o?.id ?? x)
          if (!pid) continue
          const r = str(o?.rank)
          out.push({ id: pid, rango: r === 'creator' ? 'creador' : r === 'admin' ? 'admin' : 'miembro' })
        }
        return out
      })
    },

    async quitarParticipantes(p) {
      const grupoId = grupo(p.grupoId)
      const pedidos = participantes(p.participantes)
      return escribir({
        metodo: 'quitarParticipantes', args: p, verbo: 'DELETE', ruta: `/groups/${encodeURIComponent(grupoId)}/participants`, cuerpo: { participants: pedidos },
      }, (json): ResultadoQuitar => {
        const o = obj(json) ?? {}
        const conjunto = (x: unknown) => (Array.isArray(x) ? new Set(x.map(clave).filter((v): v is string => !!v)) : null)
        const fallaron = conjunto(o.failed), procesados = conjunto(o.processed)
        if (!fallaron && !procesados) return o.success === false ? { quitados: [], fallidos: pedidos } : { quitados: pedidos, fallidos: [] }
        const fallidos = pedidos.filter((x) => fallaron?.has(x) || (procesados !== null && !procesados.has(x)))
        return { quitados: pedidos.filter((x) => !fallidos.includes(x)), fallidos }
      })
    },

    // Etapa Bajas, ronda 2 (25/10/2026): eliminar la comunidad del cliente. Whapi la documenta como "Deactivate community"
    // (DELETE /communities/{CommunityID}, operationId deactivateCommunity; responde { success }; 403 "Not permission",
    // 404 si no existe). En WhatsApp, desactivar una comunidad la borra con su grupo de Avisos y deja los grupos sueltos
    // (desvinculados, no borrados); solo puede hacerlo quien la administra: si el bot no es admin, Whapi responde 403 y
    // queda para hacerlo a mano. Escritura: nunca se reintenta (un 5xx o un corte salen como 'dudoso').
    async eliminarComunidad(comunidadId) {
      const id = grupo(comunidadId, 'la comunidad')
      return escribir({ metodo: 'eliminarComunidad', args: { comunidadId: id }, verbo: 'DELETE', ruta: `/communities/${encodeURIComponent(id)}` }, exito('eliminarComunidad'))
    },

    registro: () => [...registro],
  }
  return cliente
}
