// ── Notas del cliente: lo que el cliente dice de sus anuncios en su grupo de WhatsApp → Despacho → Valen ─────────────────
// Pedido de Hub + Tomás (1/11/2026). El bot SOLO LEE (nunca escribe en un grupo: el número ya fue suspendido una vez).
//   · Del mismo envío del webhook de Whapi que lee la etapa Éxito (lib/bot/exito/filtro.ts), con sus mismas exclusiones:
//     textos (o el pie de una imagen / video) de un CLIENTE en un grupo que no es del equipo, con menos de 48 h. El filtro
//     barato (pareceDeAnuncios) deja pasar lo que puede hablar de la campaña: consultas, zona, presupuesto, pagos, videos,
//     pausas, tipo de caso… La charla corta («gracias», «dale») no pasa.
//   · De qué cliente es el grupo lo dice el directorio de Éxito (General / Ventas / Contenido - <cliente>). En Contenido
//     también se habla de la campaña («ese video no me trae nada»): Claude separa lo que es de grabación o guiones.
//   · Clientes de prueba (esPrueba: nombre que empieza con «PRUEBA BOT» o los de BOT_CLIENTES_PRUEBA): se leen también
//     los mensajes del equipo (el que prueba escribe desde su teléfono) y el aviso a Valen sale marcado «🧪 PRUEBA».
//   · Claude (esfuerzo bajo) decide si es de los anuncios y lo resume: qué dijo, qué pide y si hay que avisarle a Valen.
//   · Se guarda en Neon (cj_anuncios_notas, notasNeon.ts) y se ve en Anuncios → «Notas del cliente». Si hay que cambiar o
//     tener en cuenta algo de la campaña, va un aviso a #📣-ads mencionando a Valen con el pedido y el link a la nota.
// Dedupe por id del mensaje (se reclama antes de llamar a Claude): un mensaje, una nota, aunque Whapi lo mande dos veces.
// Los audios no se leen (no hay transcripción en el webhook). ANUNCIOS_NOTAS=0 lo apaga. Puro salvo el orquestador.
import type { AutorWhapi, ConfigGrupos } from '@/lib/bot/alta/motor/tipos'
import { PATRON_GRUPO } from '@/lib/bot/whapi/comun'
import { ANTIGUEDAD_MAX_MS, cortar, leerEnvoltura, normalizarMensaje } from '@/lib/bot/whapi/webhook'
import { escaparDiscord } from '@/lib/fathomAnuncios/mensaje'

export const MAX_TEXTO_NOTA = 1_500
export const MAX_NOTAS_POR_ENVIO = 20

export interface MensajeNota { mensajeId: string; chatId: string; texto: string; autor: AutorWhapi; enviadoEn: string; delEquipo?: boolean }

/** ¿Es un cliente de prueba? «PRUEBA BOT…» siempre; además los nombres de BOT_CLIENTES_PRUEBA (separados por coma). */
export function esPrueba(cliente: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const n = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
  const c = n(cliente)
  return c.startsWith('prueba bot') || (env.BOT_CLIENTES_PRUEBA ?? '').split(',').map(n).filter(Boolean).includes(c)
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Lo que puede ser de la campaña. Amplio a propósito: el que decide es Claude; esto solo ahorra llamadas con la charla. */
const ANUNCIOS = /\b(anuncio\w*|publicidad\w*|campana\w*|pauta\w*|meta|facebook|face|instagram|insta|ads?|consulta\w*|mensaje\w*|me (escribe|escriben|escribio|escribieron|llama|llaman|llamo|llamaron|contacta\w*)|lead\w*|gente|personas?|zona\w*|barrio\w*|ciudad\w*|localidad\w*|provincia\w*|partido\w*|presupuesto\w*|tarjeta\w*|pag(o|ar|ue|ando|amos)|cobr\w*|gast\w*|invert\w*|inversion\w*|video\w*|caso\w*|clientes?|calidad|sirve\w*|curiosos?|preguntan|precio\w*|horario\w*|atender|vacacion\w*|paus\w*|apag\w*|prend\w*|fren\w*|cort\w*|sub(i|ir|amos)|baj(a|ar|en|amos)|cambi\w*|whatsapp|wpp|numero|telefono)\b/
const CORTESIA = /^(ok(ey|a)?|dale|gracias( (a vos|a ustedes|chicos|equipo))?|perfecto|listo|buenisimo|genial|joya|si|no|👍|🙏|❤️)[\s!.,🙌👏😊🙏❤️]*$/

/** ¿Vale la pena preguntarle a Claude? Al menos 4 palabras, no solo cortesía y alguna palabra de la campaña. */
export function pareceDeAnuncios(texto: string): boolean {
  const t = norm(texto.trim())
  if (CORTESIA.test(t) || t.split(/\s+/).filter(Boolean).length < 4) return false
  return ANUNCIOS.test(t)
}

const TIPOS_TEXTO = new Set(['text', 'link_preview'])
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null)
const pieDe = (x: unknown): string | null => {
  const m = obj(x), tipo = typeof m?.type === 'string' ? m.type : ''
  const medio = obj(m?.[tipo === 'documentWithCaption' ? 'document' : tipo])
  return typeof medio?.caption === 'string' && medio.caption.trim() ? medio.caption : null
}
const esDelEquipo = (a: AutorWhapi, equipo: ReadonlySet<string>) => (!!a.telefono && equipo.has(a.telefono)) || (!!a.lid && equipo.has(a.lid))

/** Todo el envío → los mensajes de clientes que pueden ser una nota de anuncios. Mismas exclusiones que Éxito. PURO. */
export function candidatosNotas(json: unknown, grupos: ConfigGrupos, ahora: number, equipo: ReadonlySet<string>, gruposEquipo: readonly string[] = []): MensajeNota[] {
  const env = leerEnvoltura(json)
  if (!env) return []
  const out: MensajeNota[] = [], vistos = new Set<string>()
  for (const x of env.mensajes) {
    if (out.length >= MAX_NOTAS_POR_ENVIO) break
    const m = normalizarMensaje(x)
    if (!m || vistos.has(m.id)) continue
    vistos.add(m.id)
    if (ahora - Date.parse(m.enviadoEn) > ANTIGUEDAD_MAX_MS) continue
    if (!PATRON_GRUPO.test(m.chatId) || m.chatId === grupos.ventas || m.chatId === grupos.verificaciones || gruposEquipo.includes(m.chatId)) continue
    if (m.deMi) continue
    const delEquipo = esDelEquipo(m.autor, equipo)   // se descarta en procesarNotas, salvo en un cliente de prueba
    const texto = TIPOS_TEXTO.has(m.tipo) ? m.texto : pieDe(x)
    if (!texto || !pareceDeAnuncios(texto)) continue
    out.push({ mensajeId: m.id, chatId: m.chatId, texto: cortar(texto.trim(), MAX_TEXTO_NOTA), autor: m.autor, enviadoEn: m.enviadoEn, ...(delEquipo ? { delEquipo: true } : {}) })
  }
  return out
}

// ── Lo que devuelve Claude ──
export const TIPOS_NOTA = ['zona', 'presupuesto', 'pausa', 'calidad_consultas', 'tipo_de_caso', 'horario', 'copy_o_video', 'pago', 'otro'] as const
export type TipoNota = (typeof TIPOS_NOTA)[number]
export interface Lectura { esDeAnuncios: boolean; dijo: string; pide: string; avisar: boolean; tipo: TipoNota }

export const SISTEMA_NOTAS = `Leés un mensaje que un cliente (un abogado argentino) escribió en su grupo de WhatsApp con la agencia que le maneja los anuncios de Meta.
Decidí si habla de sus anuncios o de lo que le llega por ellos: consultas (cantidad o calidad), zona, presupuesto o pagos de la publicidad, pausar o prender, tipo de casos que quiere o no quiere, horarios en que atiende, los videos o los textos de los anuncios, su número de WhatsApp.
NO es de anuncios: saludos, agradecimientos sin pedido, temas de grabación o guiones, facturación de la agencia, temas personales.
Si es de anuncios devolvé:
· "dijo": lo que dijo, fiel y en tercera persona, en una o dos frases (máx. 220 caracteres). Sin teléfonos ni datos de sus clientes.
· "pide": el pedido concreto para el media buyer (ej.: "Sumar Lanús a la zona", "Bajar a USD 200 por mes", "Pausar del 20 al 31/12"), o "" si no pide nada.
· "avisar": true si hay que cambiar algo de la campaña o tenerlo en cuenta al armarla (aunque no lo pida explícito: "me llegan muchas consultas de otra provincia" → avisar). false si es solo un comentario (ej.: "vienen bien las consultas").
· "tipo": el tema principal.
Si no es de anuncios: es_de_anuncios false y el resto vacío.`
export const SCHEMA_NOTAS = {
  type: 'object', additionalProperties: false, required: ['es_de_anuncios', 'dijo', 'pide', 'avisar', 'tipo'],
  properties: { es_de_anuncios: { type: 'boolean' }, dijo: { type: 'string' }, pide: { type: 'string' }, avisar: { type: 'boolean' }, tipo: { type: 'string', enum: [...TIPOS_NOTA] } },
}

const corto = (x: unknown, n: number) => { const t = String(x ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

/** La respuesta de Claude → Lectura, o null si no tiene la forma. Sin "dijo" no hay nota; sin pedido ni avisar, es un comentario. */
export function lecturaValida(x: unknown): Lectura | null {
  const r = obj(x)
  if (!r || typeof r.es_de_anuncios !== 'boolean') return null
  if (!r.es_de_anuncios) return { esDeAnuncios: false, dijo: '', pide: '', avisar: false, tipo: 'otro' }
  const dijo = corto(r.dijo, 240), pide = corto(r.pide, 200)
  if (!dijo) return null
  const tipo = (TIPOS_NOTA as readonly string[]).includes(String(r.tipo)) ? r.tipo as TipoNota : 'otro'
  return { esDeAnuncios: true, dijo, pide, avisar: r.avisar === true || !!pide, tipo }
}

const ETIQUETA: Record<TipoNota, string> = { zona: 'Zona', presupuesto: 'Presupuesto', pausa: 'Pausa', calidad_consultas: 'Calidad de consultas', tipo_de_caso: 'Tipo de caso', horario: 'Horario', copy_o_video: 'Copy o video', pago: 'Pago', otro: 'Otro' }
export const etiquetaTipo = (t: TipoNota) => ETIQUETA[t] ?? 'Otro'

/** El aviso a #📣-ads: a Valen, con el pedido concreto y el link a la nota. */
export function textoAvisoNota(n: { cliente: string; dijo: string; pide: string; tipo: TipoNota; enviadoEn: string; prueba?: boolean }, link: string, valentino: string | null): string {
  const fecha = new Date(n.enviadoEn).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })
  return [
    `${valentino ? `<@${valentino}> ` : ''}${n.prueba ? '🧪 **PRUEBA** · ' : ''}🗣️ **Nota del cliente** · ${escaparDiscord(n.cliente)} (${etiquetaTipo(n.tipo)}, ${fecha})`,
    `💬 ${escaparDiscord(n.dijo)}`,
    n.pide ? `👉 **Pide:** ${escaparDiscord(n.pide)}` : '👉 **Tenelo en cuenta** para la campaña.',
    `🔗 [Ver la nota en el Despacho](<${link}>)`,
  ].join('\n').slice(0, 1900)
}

// ── Orquestador (sin red propia: todo por deps) ──
export interface NotaGuardada { id: number }
export interface DepsNotas {
  /** De qué cliente es el grupo (directorio de Éxito). null = no es el grupo de un cliente. */
  deChat(chatId: string): Promise<{ idCrm: string | null; cliente: string; grupo: 'general' | 'ventas' | 'contenido' } | null>
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  /** Para los tests (por defecto esPrueba con process.env). */
  esPrueba?(cliente: string): boolean
  /** Reclama el mensaje (INSERT … ON CONFLICT DO NOTHING). null = ya estaba (otro envío lo tomó). */
  reclamar(m: MensajeNota, c: { idCrm: string | null; cliente: string; grupo: string }): Promise<NotaGuardada | null>
  leer(texto: string): Promise<Lectura | null>
  guardar(id: number, l: Lectura | null): Promise<void>
  enviar(texto: string): Promise<string>
  marcarAviso(id: number, idMensaje: string | null, estado: 'avisada' | 'aviso_fallido'): Promise<void>
  link(id: number): string
  valentino: string | null
}
export interface ResultadoNotas { leidos: number; notas: number; avisos: number; errores: string[] }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 160)

export async function procesarNotas(cands: readonly MensajeNota[], deps: DepsNotas): Promise<ResultadoNotas> {
  const r: ResultadoNotas = { leidos: 0, notas: 0, avisos: 0, errores: [] }
  for (const m of cands) {
    let c: Awaited<ReturnType<DepsNotas['deChat']>>
    try { c = await deps.deChat(m.chatId) } catch (e) { r.errores.push(`directorio: ${motivo(e)}`); continue }
    if (!c) continue
    const prueba = (deps.esPrueba ?? esPrueba)(c.cliente)
    if (m.delEquipo && !prueba) continue
    if (!prueba && deps.clienteOperativo && !await deps.clienteOperativo(c.idCrm, c.cliente).catch(() => true)) continue
    let nota: NotaGuardada | null
    try { nota = await deps.reclamar(m, c) } catch (e) { r.errores.push(`base: ${motivo(e)}`); continue }
    if (!nota) continue
    r.leidos++
    let l: Lectura | null = null
    try { l = await deps.leer(m.texto) } catch (e) { r.errores.push(`claude: ${motivo(e)}`) }
    try { await deps.guardar(nota.id, l) } catch (e) { r.errores.push(`base: ${motivo(e)}`); continue }
    if (!l?.esDeAnuncios) continue
    r.notas++
    if (!l.avisar) continue
    try {
      const id = await deps.enviar(textoAvisoNota({ cliente: c.cliente, dijo: l.dijo, pide: l.pide, tipo: l.tipo, enviadoEn: m.enviadoEn, prueba }, deps.link(nota.id), deps.valentino))
      r.avisos++
      await deps.marcarAviso(nota.id, id || null, 'avisada').catch(e => { r.errores.push(`base: ${motivo(e)}`) })
    } catch (e) {
      r.errores.push(`discord: ${motivo(e)}`)
      await deps.marcarAviso(nota.id, null, 'aviso_fallido').catch(() => {})
    }
  }
  return r
}
