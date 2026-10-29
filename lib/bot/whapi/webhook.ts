// ── Bot "Capital Jurídico": lectura y clasificación del webhook de Whapi (BLOQUE W) ──────────────────────────────────────
// PURO: sin red, sin base y sin reloj propio (la hora entra como parámetro). Convierte la envoltura de Whapi
// ({ messages: [...], messages_updates: [...], event, channel_id }) en EventoBot (lib/bot/alta/motor/tipos.ts).
// Formas tomadas de la referencia (Message, MessageContext, MessageAction, MessageUpdate) y de los ejemplos de soporte.
//
// Qué se queda (lo demás se descarta con un motivo, y no se guarda: revisión 35):
//   · Ventas C.J.:
//       - texto con #ALTA (también como pie de una imagen o un PDF) → EventoAlta (con el medio si lo hay);
//       - texto SIN #ALTA y sin citar que es un alta en formato libre (nombre, contacto y señal de pago: altaLibre.ts,
//         26/10/2026) → EventoAlta con `libre: true` (también como pie). El orquestador pide el OK antes de hacer nada;
//       - imagen, o documento PDF / imagen, sin #ALTA → EventoAdjunto (comprobante suelto); un álbum → EventoAdjunto sin medios
//         con `albumEsperado` (las fotos llegan después, cada una como su propio mensaje);
//       - texto sin #ALTA que cita un mensaje o trae una línea "Clave: valor" → EventoRespuesta (lo demás es charla);
//       - edición de un mensaje con #ALTA o "Clave: valor" → EventoEdicion, por type 'action' (edit / edited) o por
//         messages.patch (after_update). Clave `ed:<id editado>:<sha256 del texto nuevo>`: la misma edición que llega por los
//         dos caminos se guarda una sola vez (revisión 8).
//   · Verificaciones C.J: solo un texto que CITA un mensaje y empieza con OK o NO → EventoRespuesta con el veredicto
//     ("OK Nombre Apellido" sirve para confirmar un nombre: el resto va en `resto`). Imágenes y charla se descartan.
//   · Eco del propio bot (from_me: true y source 'api') en esos dos grupos → EventoEco, para confirmar un envío dudoso y
//     recuperar su id (revisión 6). Desde el 24/10 también en cualquier otro grupo (…@g.us) con `grupo: null`: es el eco de
//     la bienvenida en el General del cliente. Lo que manda una persona desde el teléfono del bot (source 'mobile') se descarta.
//   · Más de 48 h de atraso (una sincronización al reconectar): se descarta.
//   · WhatsApp seguro (26/10/2026): groups_participants (evento groups.patch) con acción add / join en un grupo que no es
//     Ventas ni Verificaciones → EventoIngreso (alguien entró, por ejemplo el cliente al General por el link). La forma
//     ({ group_id, participants, action, timestamp }) sale de la referencia de Whapi y está A CONFIRMAR con un envío real.
import { createHash } from 'node:crypto'
import { igualesSeguro } from '@/lib/auth/cookie'
import type { AutorWhapi, Citado, ConfigGrupos, EventoBot, GrupoBot, RefMedio, Veredicto } from '@/lib/bot/alta/motor/tipos'
import { PATRON_GRUPO, identidadDe, isoDeMarca, lidDe, telefonoDe } from './comun'
import { esAltaLibre } from '@/lib/bot/alta/altaLibre'
import { HEADER_SECRETO } from './config'

/** La misma etiqueta que usa el parser del #ALTA (lib/bot/alta/parsear.ts). */
export const ETIQUETA_ALTA = /#\s*alta\b/i
export const ANTIGUEDAD_MAX_MS = 48 * 3600_000
export const MAX_MENSAJES_POR_ENVIO = 200
export const MAX_TEXTO = 20_000

export type MotivoDescarte =
  | 'forma'       // no tiene id, chat, timestamp o from_me (o no se entiende)
  | 'viejo'       // más de 48 h de atraso
  | 'propio'      // lo mandó el número del bot y no es un eco de la API en los dos grupos
  | 'otro_chat'   // ni Ventas C.J. ni Verificaciones C.J
  | 'tipo'        // audio, sticker, reacción, encuesta, un documento que no es PDF ni imagen…
  | 'charla'      // texto sin #ALTA, sin cita y sin "Clave: valor" (o en Verificaciones, sin OK/NO)
  | 'sin_cita'    // OK / NO en Verificaciones sin citar un mensaje
  | 'accion'      // un messages.patch o una acción que no es una edición
  | 'exceso'      // más de MAX_MENSAJES_POR_ENVIO en un solo envío
  | 'repetido'    // el mismo evento dos veces en el mismo envío

// ── Secreto del webhook ──
type Cabeceras = { get(nombre: string): string | null }

/** El header x-cj-bot-secreto contra el secreto, en tiempo constante. Sin header o sin secreto: false. */
export function verificarSecreto(headers: Cabeceras, secreto: string): boolean {
  const recibido = headers.get(HEADER_SECRETO)
  if (!recibido || !secreto) return false
  return igualesSeguro(recibido, secreto)
}

// ── Lectura defensiva ──
type Obj = Record<string, unknown>
const obj = (x: unknown): Obj | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : null)

/** Recorta sin partir un emoji (un par de surrogates) y deja el texto bien formado: un surrogate suelto (un recorte en el
 *  medio de un emoji, o un texto que ya venía roto) pasa a U+FFFD. Revisión del 24/10 (ronda 2): JSON.stringify lo escribe
 *  como "\ud83d" suelto, Postgres rechaza ese jsonb (22P02, permanente) y la ruta respondía 503 → Whapi reintentaba 24 h. */
export function cortar(t: string, max: number): string {
  const partido = t.length > max && /[\ud800-\udbff]/.test(t[max - 1] ?? '') && /[\udc00-\udfff]/.test(t[max] ?? '')
  const x = t.length > max ? t.slice(0, partido ? max - 1 : max) : t
  return x.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
}

const str = (x: unknown, max = 500): string | null => {
  if (typeof x !== 'string') return null
  const t = x.trim()
  return t ? cortar(t, max) : null
}
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : null)
const texto = (x: unknown): string | null => {
  if (typeof x !== 'string') return null
  const t = x.replace(/\r\n?/g, '\n').trim()
  return t ? cortar(t, MAX_TEXTO) : null
}

export interface Envoltura {
  mensajes: unknown[]
  actualizaciones: unknown[]
  /** groups_participants (WhatsApp seguro): quién entró o salió de un grupo. */
  participantes: unknown[]
  canalId: string | null
  evento: { tipo: string | null; metodo: string | null } | null
}

/** La envoltura del webhook, o null si el cuerpo no es un objeto. */
export function leerEnvoltura(json: unknown): Envoltura | null {
  const o = obj(json)
  if (!o) return null
  const ev = obj(o.event)
  return {
    mensajes: Array.isArray(o.messages) ? o.messages : [],
    actualizaciones: Array.isArray(o.messages_updates) ? o.messages_updates : [],
    participantes: Array.isArray(o.groups_participants) ? o.groups_participants : [],
    canalId: str(o.channel_id, 100),
    evento: ev ? { tipo: str(ev.type, 40), metodo: str(ev.event, 40) ?? str(ev.method, 40) } : null,
  }
}

export interface MensajeWhapi {
  id: string
  tipo: string
  chatId: string
  deMi: boolean
  fuente: string | null
  enviadoEn: string
  autor: AutorWhapi
  /** text.body, link_preview.body o el pie (caption) de la imagen / documento / video. */
  texto: string | null
  medio: RefMedio | null
  citado: Citado | null
  /** expectedImageCount de un álbum. */
  album: number | null
  accion: { tipo: string; objetivo: string | null; textoEditado: string | null } | null
}

/** Texto de un MessageContent (edited_content, quoted_content): body o caption. */
const textoDeContenido = (c: unknown): string | null => {
  const o = obj(c)
  if (!o) return null
  return texto(o.body) ?? texto(o.caption) ?? texto(obj(o.text)?.body) ?? texto(obj(o.image)?.caption) ?? texto(obj(o.document)?.caption)
}

function autorDe(m: Obj): AutorWhapi {
  const from = m.from
  const telefono = telefonoDe(m.phone) ?? telefonoDe(from)
  const lid = lidDe(from)
  const nombre = str(m.from_name, 80)
  return { telefono, lid, nombre }
}

function medioDe(tipo: 'image' | 'document', c: unknown): RefMedio | null {
  const o = obj(c)
  const id = str(o?.id, 200)
  if (!o || !id) return null
  const tamano = num(o.file_size)
  const paginas = num(o.page_count)
  return {
    id,
    tipo,
    mime: (str(o.mime_type, 100) ?? (tipo === 'image' ? 'image/jpeg' : 'application/octet-stream')).toLowerCase(),
    tamano,
    sha256Whapi: str(o.sha256, 120),
    nombreArchivo: str(o.file_name, 200) ?? str(o.filename, 200),
    // Siempre null: auto_download queda apagado (revisión 29) y el archivo se baja por GET /media/{id}
    link: null,
    paginas,
    pie: texto(o.caption),
  }
}

/** Un mensaje de Whapi con lo que importa, o null si no tiene la forma mínima (id, type, chat_id, from_me, timestamp). */
export function normalizarMensaje(x: unknown): MensajeWhapi | null {
  const m = obj(x)
  if (!m) return null
  const id = str(m.id, 200), tipo = str(m.type, 40), chatId = str(m.chat_id, 120)
  const enviadoEn = isoDeMarca(m.timestamp)
  if (!id || !tipo || !chatId || typeof m.from_me !== 'boolean' || !enviadoEn) return null
  const ctx = obj(m.context)
  const quotedId = str(ctx?.quoted_id, 200)
  const citado: Citado | null = quotedId ? { id: quotedId, autor: identidadDe(ctx?.quoted_author) } : null
  const medio = tipo === 'image' ? medioDe('image', m.image)
    : tipo === 'document' || tipo === 'documentWithCaption' ? medioDe('document', m.document)
      : null
  const textoMsj = texto(obj(m.text)?.body) ?? texto(obj(m.link_preview)?.body)
    ?? (medio ? medio.pie : null) ?? texto(obj(m.video)?.caption) ?? texto(obj(m.short)?.caption) ?? texto(obj(m.gif)?.caption)
  const al = obj(m.album)
  const a = obj(m.action)
  return {
    id, tipo, chatId, deMi: m.from_me, fuente: str(m.source, 30), enviadoEn,
    autor: autorDe(m),
    texto: textoMsj,
    medio,
    citado,
    album: tipo === 'album' ? num(al?.expectedImageCount) ?? 0 : null,
    accion: tipo === 'action' && a ? { tipo: str(a.type, 40) ?? '', objetivo: str(a.target, 200), textoEditado: textoDeContenido(a.edited_content) } : null,
  }
}

// ── Veredictos y respuestas ──
const OK = /^\s*ok\b[\s.!,:;-]*([\s\S]*)$/i
const NO = /^\s*no\b[\s.!,:;-]*([\s\S]*)$/i
const limpiarResto = (t: string) => cortar(t.replace(/\s+/g, ' ').trim(), 500)

/** "OK", "ok!!", "OK Tomi", "OK Juan Pérez" → ok (con el resto) · "NO", "No, falta el DNI", "no sé" → no (con el motivo). */
export function veredicto(t: string | null | undefined): Veredicto | null {
  if (typeof t !== 'string') return null
  const ok = OK.exec(t)
  if (ok) return { tipo: 'ok', resto: limpiarResto(ok[1]) }
  const no = NO.exec(t)
  if (no) return { tipo: 'no', motivo: limpiarResto(no[1]) }
  return null
}

/** ¿Alguna línea tiene la forma "Clave: valor"? (Setter: Mai, Teléfono: +54…). Las URLs no cuentan. Qué claves sirven lo
 *  decide el orquestador: acá solo se separa la charla de lo que puede ser un dato. */
export function tieneClaveValor(t: string | null | undefined): boolean {
  if (!t) return false
  return t.split('\n').some((l) => /^\s*[\p{L}][\p{L}\p{M} .º°/()-]{0,40}:\s*\S/u.test(l) && !/^\s*https?\s*:/i.test(l))
}

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

/** Clave de repetido de una edición: igual por type 'action' o por messages.patch. */
export const claveEdicion = (objetivo: string, textoNuevo: string) => `ed:${objetivo}:${sha256(textoNuevo.trim())}`

// ── Clasificación ──
export type Clasificacion = { evento: EventoBot } | { descarte: MotivoDescarte }

const grupoDe = (chatId: string, g: ConfigGrupos): GrupoBot | null => (chatId === g.ventas ? 'ventas' : chatId === g.verificaciones ? 'verificaciones' : null)
const TIPOS_TEXTO = new Set(['text', 'link_preview'])
const TIPOS_ECO = new Set(['text', 'link_preview', 'video', 'short', 'gif', 'image', 'document', 'documentWithCaption'])
const esDocumentoComprobante = (m: RefMedio) => m.tipo === 'image' || m.mime === 'application/pdf' || m.mime.startsWith('image/')

/** Un mensaje (messages[]) → evento o motivo de descarte. `ahora` en ms; `recibidoEn` ISO de la llegada del webhook. */
export function clasificar(m: MensajeWhapi, grupos: ConfigGrupos, ahora: number, recibidoEn = new Date(ahora).toISOString()): Clasificacion {
  if (ahora - Date.parse(m.enviadoEn) > ANTIGUEDAD_MAX_MS) return { descarte: 'viejo' }
  const grupo = grupoDe(m.chatId, grupos)
  const base = { clave: m.id, mensajeId: m.id, chatId: m.chatId, autor: m.autor, enviadoEn: m.enviadoEn, recibidoEn, citado: m.citado }

  if (m.deMi) {
    // Eco de la API: en los dos grupos y también en cualquier otro grupo (el General de un cliente, con grupo null), así una
    // bienvenida que volvió dudosa se confirma sola (revisión del 24/10: antes ese eco se descartaba como 'propio')
    if (m.fuente === 'api' && TIPOS_ECO.has(m.tipo) && (grupo || m.chatId.endsWith('@g.us'))) return { evento: { ...base, tipo: 'eco', grupo, texto: m.texto ?? '' } }
    return { descarte: 'propio' }
  }
  if (!grupo) return { descarte: 'otro_chat' }

  if (grupo === 'verificaciones') {
    if (!TIPOS_TEXTO.has(m.tipo) || !m.texto) return { descarte: 'tipo' }
    const v = veredicto(m.texto)
    if (!v) return { descarte: 'charla' }
    if (!m.citado) return { descarte: 'sin_cita' }
    return { evento: { ...base, tipo: 'respuesta', grupo, texto: m.texto, veredicto: v } }
  }

  // Ventas C.J.
  if (m.tipo === 'action') {
    const a = m.accion
    if (!a || (a.tipo !== 'edit' && a.tipo !== 'edited') || !a.objetivo || !a.textoEditado) return { descarte: 'accion' }
    if (!ETIQUETA_ALTA.test(a.textoEditado) && !tieneClaveValor(a.textoEditado)) return { descarte: 'charla' }
    return {
      evento: { ...base, tipo: 'edicion', grupo: 'ventas', clave: claveEdicion(a.objetivo, a.textoEditado), mensajeId: a.objetivo, citado: null, texto: a.textoEditado },
    }
  }
  if (TIPOS_TEXTO.has(m.tipo)) {
    if (!m.texto) return { descarte: 'forma' }
    if (ETIQUETA_ALTA.test(m.texto)) return { evento: { ...base, tipo: 'alta', grupo: 'ventas', texto: m.texto, medios: [] } }
    // Alta en formato libre (sin citar: citando, es una respuesta a un pedido del bot)
    if (!m.citado && esAltaLibre(m.texto)) return { evento: { ...base, tipo: 'alta', grupo: 'ventas', texto: m.texto, medios: [], libre: true } }
    if (m.citado || tieneClaveValor(m.texto)) return { evento: { ...base, tipo: 'respuesta', grupo: 'ventas', texto: m.texto, veredicto: veredicto(m.texto) } }
    return { descarte: 'charla' }
  }
  if (m.tipo === 'image' || m.tipo === 'document' || m.tipo === 'documentWithCaption') {
    if (!m.medio) return { descarte: 'forma' }
    if (m.medio.pie && ETIQUETA_ALTA.test(m.medio.pie)) return { evento: { ...base, tipo: 'alta', grupo: 'ventas', texto: m.medio.pie, medios: [m.medio] } }
    if (m.medio.pie && !m.citado && esDocumentoComprobante(m.medio) && esAltaLibre(m.medio.pie)) return { evento: { ...base, tipo: 'alta', grupo: 'ventas', texto: m.medio.pie, medios: [m.medio], libre: true } }
    if (!esDocumentoComprobante(m.medio)) return { descarte: 'tipo' }
    return { evento: { ...base, tipo: 'adjunto', grupo: 'ventas', medios: [m.medio], albumEsperado: null } }
  }
  if (m.tipo === 'album') {
    if (!m.album || m.album <= 0) return { descarte: 'tipo' }
    return { evento: { ...base, tipo: 'adjunto', grupo: 'ventas', medios: [], albumEsperado: m.album } }
  }
  return { descarte: 'tipo' }
}

/** Un messages_updates[] (messages.patch): solo las ediciones de texto en Ventas C.J. con #ALTA o "Clave: valor". */
export function clasificarActualizacion(u: unknown, grupos: ConfigGrupos, ahora: number, recibidoEn = new Date(ahora).toISOString()): Clasificacion {
  const o = obj(u)
  const despues = normalizarMensaje(o?.after_update)
  if (!o || !despues) return { descarte: 'forma' }
  const disparo = normalizarMensaje(o.trigger)
  const cambios = Array.isArray(o.changes) ? o.changes.filter((c): c is string => typeof c === 'string') : []
  const esEdicion = (disparo?.accion && (disparo.accion.tipo === 'edit' || disparo.accion.tipo === 'edited'))
    || cambios.some((c) => ['text', 'caption', 'body', 'edited', 'edit'].includes(c))
  if (!esEdicion) return { descarte: 'accion' }
  if (despues.deMi) return { descarte: 'propio' }
  const grupo = grupoDe(despues.chatId, grupos)
  if (!grupo) return { descarte: 'otro_chat' }
  if (grupo !== 'ventas') return { descarte: 'tipo' }
  const nuevo = despues.texto
  if (!nuevo) return { descarte: 'forma' }
  const antes = normalizarMensaje(o.before_update)
  if (antes?.texto && antes.texto === nuevo) return { descarte: 'charla' }
  if (!ETIQUETA_ALTA.test(nuevo) && !tieneClaveValor(nuevo)) return { descarte: 'charla' }
  const enviadoEn = disparo?.enviadoEn ?? recibidoEn
  if (ahora - Date.parse(enviadoEn) > ANTIGUEDAD_MAX_MS) return { descarte: 'viejo' }
  const objetivo = str(o.id, 200) ?? despues.id
  return {
    evento: {
      tipo: 'edicion', grupo: 'ventas', clave: claveEdicion(objetivo, nuevo), mensajeId: objetivo, chatId: despues.chatId,
      autor: disparo?.autor ?? despues.autor, enviadoEn, recibidoEn, citado: null, texto: nuevo,
    },
  }
}

/** Acciones de groups_participants que cuentan como "entró al grupo". */
export const ACCIONES_INGRESO = new Set(['add', 'join', 'invite', 'approve'])

/** Un groups_participants[]: alguien entró a un grupo de un cliente (no a Ventas ni a Verificaciones). */
export function clasificarIngreso(x: unknown, grupos: ConfigGrupos, ahora: number, recibidoEn = new Date(ahora).toISOString()): Clasificacion {
  const o = obj(x)
  const chatId = str(o?.group_id, 100) ?? str(o?.chat_id, 100) ?? str(o?.id, 100)
  const accion = str(o?.action, 40)?.toLowerCase() ?? null
  if (!o || !chatId || !accion || !PATRON_GRUPO.test(chatId)) return { descarte: 'forma' }
  if (grupoDe(chatId, grupos)) return { descarte: 'otro_chat' }
  if (!ACCIONES_INGRESO.has(accion)) return { descarte: 'accion' }
  const lista = Array.isArray(o.participants) ? o.participants : []
  const participantes = [...new Set(lista.map((p) => telefonoDe(p) ?? lidDe(p)).filter((p): p is string => !!p))]
  if (!participantes.length) return { descarte: 'forma' }
  const enviadoEn = isoDeMarca(o.timestamp) ?? recibidoEn
  if (ahora - Date.parse(enviadoEn) > ANTIGUEDAD_MAX_MS) return { descarte: 'viejo' }
  const clave = `in:${createHash('sha256').update(`${chatId}|${accion}|${[...participantes].sort().join(',')}|${enviadoEn}`).digest('hex').slice(0, 40)}`
  return {
    evento: {
      tipo: 'ingreso', grupo: null, clave, mensajeId: clave, chatId, autor: { telefono: null, lid: null, nombre: null },
      enviadoEn, recibidoEn, citado: null, participantes, accion,
    },
  }
}

export interface ResultadoEnvoltura {
  eventos: EventoBot[]
  descartes: Partial<Record<MotivoDescarte, number>>
  canalId: string | null
  /** Cuántos mensajes y actualizaciones traía el envío. */
  total: number
}

/** Todo el envío de Whapi → eventos (sin repetir clave) y conteo de descartes. null si el cuerpo no es un objeto. */
export function clasificarEnvoltura(json: unknown, grupos: ConfigGrupos, ahora: number): ResultadoEnvoltura | null {
  const env = leerEnvoltura(json)
  if (!env) return null
  const recibidoEn = new Date(ahora).toISOString()
  const descartes: Partial<Record<MotivoDescarte, number>> = {}
  const descartar = (motivo: MotivoDescarte) => { descartes[motivo] = (descartes[motivo] ?? 0) + 1 }
  const eventos: EventoBot[] = []
  const vistas = new Set<string>()
  const sumar = (c: Clasificacion) => {
    if ('descarte' in c) return descartar(c.descarte)
    if (vistas.has(c.evento.clave)) return descartar('repetido')
    vistas.add(c.evento.clave)
    eventos.push(c.evento)
  }
  const todos = [...env.mensajes.map((m) => ['m', m] as const), ...env.actualizaciones.map((u) => ['u', u] as const), ...env.participantes.map((g) => ['g', g] as const)]
  todos.forEach(([tipo, x], i) => {
    if (i >= MAX_MENSAJES_POR_ENVIO) return descartar('exceso')
    if (tipo === 'u') return sumar(clasificarActualizacion(x, grupos, ahora, recibidoEn))
    if (tipo === 'g') return sumar(clasificarIngreso(x, grupos, ahora, recibidoEn))
    const m = normalizarMensaje(x)
    sumar(m ? clasificar(m, grupos, ahora, recibidoEn) : { descarte: 'forma' })
  })
  return { eventos, descartes, canalId: env.canalId, total: todos.length }
}

/** Estado de la sesión del número (eventos 'channel' y 'users' de PATCH /settings: revisión del 24/10, ronda 2). Con
 *  messages solamente, un número desvinculado (teléfono sin batería o sin datos mucho tiempo, cierre de sesión, ban) dejaba
 *  al bot sordo sin ningún rastro. `caido`: hay que volver a vincular el número (QR, error, cierre de sesión). null si el
 *  envío no es de esos eventos. Sin datos personales: solo el tipo y el estado. */
export function estadoDelCanal(json: unknown): { tipo: 'channel' | 'users'; metodo: string | null; estado: string | null; caido: boolean } | null {
  const env = leerEnvoltura(json)
  const tipo = env?.evento?.tipo
  if (tipo !== 'channel' && tipo !== 'users') return null
  const o = obj(json) ?? {}
  const metodo = env?.evento?.metodo ?? null
  if (tipo === 'users') return { tipo, metodo, estado: metodo === 'delete' ? 'LOGOUT' : 'LOGIN', caido: metodo === 'delete' }
  const estado = str(obj(obj(o.health)?.status)?.text, 40) ?? (obj(o.qr) ? 'QR' : null)
  return { tipo, metodo, estado, caido: !!estado && ['QR', 'ERROR', 'SYNC_ERROR', 'NOT_INIT'].includes(estado) }
}

/** Resumen para el log: cuántos eventos de cada tipo (nunca textos, teléfonos ni nombres). */
export function resumenEventos(eventos: readonly EventoBot[]): string {
  const c: Record<string, number> = {}
  for (const e of eventos) c[e.tipo] = (c[e.tipo] ?? 0) + 1
  return Object.entries(c).map(([k, v]) => `${k}:${v}`).join(' ') || 'ninguno'
}
