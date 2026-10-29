// ── Bot "Capital Jurídico": etapa ÉXITO — qué mensajes del webhook de Whapi le importan (PURO: sin red, sin base, sin reloj) ──
// Del mismo envío que procesa el motor de altas (y el reenvío a Guiones) salen, sin tocar a esos dos:
//   · mensajes: textos (o el pie de una imagen / video) de un CLIENTE en cualquier grupo que no sea del equipo, que pasan el
//     filtro barato (pareceResultado). Si el grupo es de un cliente (General, Ventas o Contenido) lo decide después el
//     directorio (directorio.ts). El reenvío a Guiones sigue igual: los dos leen el mismo mensaje del grupo Contenido y cada
//     uno guarda su propio dedupe (cj_guiones_reenvios y cj_exito_senales), así no se pisan ni se duplican.
//   · videos: un video (o un documento video/*) de un cliente en cualquier grupo: candidato a testimonio.
//   · respuestas: en Verificaciones C.J, un texto que CITA un mensaje y empieza con OK o NO (mismo veredicto() del webhook).
//     A qué pedido responde y si el autor es aprobador se mira después.
//   · ecos: lo que el propio bot mandó por la API a Verificaciones (recupera el id de un pedido que volvió sin id).
// Nunca: lo del número del bot (salvo los ecos de la API), lo de una persona del equipo, los grupos del equipo (Ventas C.J.,
// los WHAPI_GRUPO_*) ni lo que llega con más de 48 h de atraso.
import type { AutorWhapi, ConfigGrupos } from '@/lib/bot/alta/motor/tipos'
import { PATRON_GRUPO } from '@/lib/bot/whapi/comun'
import { ANTIGUEDAD_MAX_MS, cortar, leerEnvoltura, normalizarMensaje, veredicto } from '@/lib/bot/whapi/webhook'

export const MAX_TEXTO_EXITO = 2_000
export const MAX_CANDIDATOS = 50

export interface MensajeCliente { mensajeId: string; chatId: string; texto: string; autor: AutorWhapi; enviadoEn: string }
export interface VideoCliente {
  mensajeId: string; chatId: string; autor: AutorWhapi; enviadoEn: string
  medio: { id: string | null; mime: string; segundos: number | null; bytes: number | null; pie: string | null }
}
export interface RespuestaVerificaciones { mensajeId: string; citado: string; veredicto: 'ok' | 'no'; resto: string; autor: AutorWhapi; enviadoEn: string }
export interface EcoVerificaciones { mensajeId: string; texto: string; enviadoEn: string }
export interface CandidatosExito {
  mensajes: MensajeCliente[]; videos: VideoCliente[]; respuestas: RespuestaVerificaciones[]; ecos: EcoVerificaciones[]
  descartes: Record<string, number>
}
export const sinCandidatos = (c: CandidatosExito) => !c.mensajes.length && !c.videos.length && !c.respuestas.length && !c.ecos.length

// ── Filtro barato: ¿vale la pena preguntarle a Claude? ──
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Palabras de RESULTADOS (casos, consultas, clientes, cierres, plata, llamadas…). */
const RESULTADO = /\b(cerr(e|amos|aron|o|ando)|caso(s)?|consulta(s)?|cliente(s)?|contrat(e|amos|aron|o|aron)|firm(e|amos|aron|o)|honorario(s)?|factur\w*|venta(s)?|vend(i|imos|iendo)|lead(s)?|llamad[ao]s?|me (llamaron|escribieron|contactaron|consultaron)|entr(aron|o|an)|lleg(aron|an)|agend\w*|reunion(es)?|turnos?|resultado(s)?|funcion(a|ando|o)|explot\w*|record|ingres\w*|cobr(e|amos|ando)|captad\w*|nuevos?|mensajes|whatsapps?|demanda(s)?|juicio(s)?|expediente(s)?)\b/
/** Palabras de satisfacción que por sí solas pueden ser un "gracias": pasan solo con un texto de 4 palabras o más, o con números. */
const POSITIVO = /\b(excelente(s)?|buenisim[oa]s?|genial(es)?|increible(s)?|espectacular(es)?|impresionante|muy bien|re bien|joya|barbaro|contento|contenta|contentos|feliz|felices|tremendo|una locura|mil gracias|crack(s)?|maquinas?|lo mejor)\b/
const SOLO_CORTESIA = /^(ok(ey|a)?|dale|gracias( (a vos|a ustedes|chicos|equipo))?|perfecto|listo|buenisimo|genial|joya|si|no|👍|🙏|❤️)[\s!.,🙌👏😊🙏❤️]*$/

/** true = puede hablar de resultados (Claude decide). Sin red. */
export function pareceResultado(texto: string): boolean {
  const t = norm(texto).replace(/\s+/g, ' ').trim()
  if (t.length < 4 || SOLO_CORTESIA.test(t)) return false
  if (RESULTADO.test(t)) return true
  const palabras = t.split(' ').filter(Boolean).length
  return POSITIVO.test(t) && (palabras >= 4 || /\d/.test(t))
}

// ── Lectura cruda del video (normalizarMensaje solo guarda imágenes y documentos) ──
type Obj = Record<string, unknown>
const obj = (x: unknown): Obj | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : null)
const numero = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const cadena = (x: unknown, max = 200): string | null => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null)

function videoCrudo(x: unknown): VideoCliente['medio'] | null {
  const m = obj(x)
  if (!m) return null
  const tipo = cadena(m.type, 40)
  const v = tipo === 'video' || tipo === 'short' || tipo === 'gif' ? obj(m[tipo]) : tipo === 'document' || tipo === 'documentWithCaption' ? obj(m.document) : null
  if (!v) return null
  const mime = (cadena(v.mime_type, 100) ?? (tipo === 'document' || tipo === 'documentWithCaption' ? '' : 'video/mp4')).toLowerCase()
  if (!mime.startsWith('video/')) return null
  return { id: cadena(v.id), mime, segundos: numero(v.seconds), bytes: numero(v.file_size), pie: cadena(v.caption, MAX_TEXTO_EXITO) }
}

const esDelEquipo = (a: AutorWhapi, equipo: ReadonlySet<string>) => (!!a.telefono && equipo.has(a.telefono)) || (!!a.lid && equipo.has(a.lid))
const TIPOS_TEXTO = new Set(['text', 'link_preview'])

/** Todo el envío → candidatos de la etapa Éxito. `gruposEquipo`: los WHAPI_GRUPO_* del equipo (nunca son de un cliente). */
export function candidatosExito(json: unknown, grupos: ConfigGrupos, ahora: number, equipo: ReadonlySet<string>, gruposEquipo: readonly string[] = []): CandidatosExito {
  const r: CandidatosExito = { mensajes: [], videos: [], respuestas: [], ecos: [], descartes: {} }
  const descartar = (k: string) => { r.descartes[k] = (r.descartes[k] ?? 0) + 1 }
  const env = leerEnvoltura(json)
  if (!env) return r
  const vistos = new Set<string>()
  for (const x of env.mensajes) {
    const m = normalizarMensaje(x)
    if (!m) { descartar('forma'); continue }
    if (vistos.has(m.id)) { descartar('repetido'); continue }
    vistos.add(m.id)
    if (ahora - Date.parse(m.enviadoEn) > ANTIGUEDAD_MAX_MS) { descartar('viejo'); continue }
    if (r.mensajes.length + r.videos.length + r.respuestas.length + r.ecos.length >= MAX_CANDIDATOS) { descartar('exceso'); continue }
    // Verificaciones C.J: respuestas citando con OK/NO y ecos del propio bot
    if (m.chatId === grupos.verificaciones) {
      if (m.deMi) {
        if (m.fuente === 'api' && TIPOS_TEXTO.has(m.tipo) && m.texto) r.ecos.push({ mensajeId: m.id, texto: m.texto, enviadoEn: m.enviadoEn })
        else descartar('propio')
        continue
      }
      const v = TIPOS_TEXTO.has(m.tipo) ? veredicto(m.texto) : null
      if (!v || !m.citado) { descartar('verificaciones'); continue }
      r.respuestas.push({ mensajeId: m.id, citado: m.citado.id, veredicto: v.tipo, resto: v.tipo === 'ok' ? v.resto : v.motivo, autor: m.autor, enviadoEn: m.enviadoEn })
      continue
    }
    if (!PATRON_GRUPO.test(m.chatId)) { descartar('no_grupo'); continue }
    if (m.chatId === grupos.ventas || gruposEquipo.includes(m.chatId)) { descartar('grupo_equipo'); continue }
    if (m.deMi) { descartar('propio'); continue }
    if (esDelEquipo(m.autor, equipo)) { descartar('equipo'); continue }
    const video = videoCrudo(x)
    if (video) {
      r.videos.push({ mensajeId: m.id, chatId: m.chatId, autor: m.autor, enviadoEn: m.enviadoEn, medio: video })
      if (video.pie && pareceResultado(video.pie)) r.mensajes.push({ mensajeId: m.id, chatId: m.chatId, texto: cortar(video.pie, MAX_TEXTO_EXITO), autor: m.autor, enviadoEn: m.enviadoEn })
      continue
    }
    const texto = TIPOS_TEXTO.has(m.tipo) ? m.texto : m.tipo === 'image' ? m.medio?.pie ?? null : null
    if (!texto) { descartar('tipo'); continue }
    if (!pareceResultado(texto)) { descartar('filtro'); continue }
    r.mensajes.push({ mensajeId: m.id, chatId: m.chatId, texto: cortar(texto.trim(), MAX_TEXTO_EXITO), autor: m.autor, enviadoEn: m.enviadoEn })
  }
  return r
}

/** Los grupos del equipo que nunca son de un cliente: WHAPI_GRUPO_ADS, CSM, EDICION, OPERACIONES y COPYWRITING. */
export function gruposEquipoExito(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['WHAPI_GRUPO_ADS', 'WHAPI_GRUPO_CSM', 'WHAPI_GRUPO_EDICION', 'WHAPI_GRUPO_OPERACIONES', 'WHAPI_GRUPO_COPYWRITING']
    .map((k) => env[k]?.trim() ?? '').filter((g) => PATRON_GRUPO.test(g))
}
