// ── Bot "Capital Jurídico": piezas comunes del BLOQUE W (cliente real, compuerta, juguete y webhook) ─────────────────────
// Puro, sin red. Patrones tomados de la referencia de Whapi (OpenAPI 1.8.7, 30/06/2026).
import type { LlamadaWhapi } from '@/lib/bot/alta/motor/tipos'

export const BASE_WHAPI = 'https://gate.whapi.cloud'

/** Chat de grupo o comunidad. La referencia (GroupID) dice ^[\d-]{10,31}@g\.us$; acá además empieza con un dígito. */
export const PATRON_GRUPO = /^\d[\d-]{9,30}@g\.us$/
/** Destino de un envío (Sender.to de la referencia): número o chat ID. */
export const PATRON_DESTINO = /^[\d-]{9,31}(@[\w.]{1,40})?$/
/** MediaID de la referencia: "pdf-b4876688…-804713c2…". Va en la ruta de GET /media/{id}. */
export const PATRON_MEDIA_ID = /^[a-zA-Z0-9]+-[0-9a-fA-F-]+$/
/** Id de mensaje para `quoted`: sin espacios ni barras (la forma exacta la valida Whapi). */
export const PATRON_ID_MENSAJE = /^[A-Za-z0-9._-]{4,128}$/
/** invite_code de un grupo. */
export const PATRON_INVITACION = /^[A-Za-z0-9_-]{6,64}$/
export const URL_INVITACION = 'https://chat.whatsapp.com/'

/** Ids que inventan la compuerta (modo seco) y el juguete: el cliente real los rechaza (tercera barrera del modo seco). */
export const esIdSimulado = (id: unknown): boolean => typeof id === 'string' && /^(seco|jg)-/i.test(id.trim())

export function recortar(t: string, n = 120): string {
  const limpio = t.replace(/\s+/g, ' ').trim()
  return limpio.length > n ? `${limpio.slice(0, n - 1)}…` : limpio
}

/** Teléfono (solo dígitos, 7 a 15) de "5491122334455", "…@s.whatsapp.net", "…@c.us" o { id, phone } (data_mode extend).
 *  Un "…@lid" sin phone no es un teléfono: null. */
export function telefonoDe(x: unknown): string | null {
  if (typeof x === 'object' && x !== null) {
    const o = x as { phone?: unknown; id?: unknown }
    return telefonoDe(o.phone) ?? telefonoDe(o.id)
  }
  if (typeof x !== 'string') return null
  const t = x.trim()
  const m = /^\+?(\d{7,15})(?:@(?:s\.whatsapp\.net|c\.us))?$/.exec(t)
  return m ? m[1] : null
}

/** "…@lid" tal cual (de un texto o de { id }), o null. */
export function lidDe(x: unknown): string | null {
  if (typeof x === 'object' && x !== null) return lidDe((x as { id?: unknown }).id)
  if (typeof x !== 'string') return null
  const t = x.trim()
  return /^\d{5,30}@lid$/.test(t) ? t : null
}

/** Identificador legible de un autor citado / mencionado: el teléfono si lo hay, si no el lid o el texto tal cual. */
export function identidadDe(x: unknown): string | null {
  const tel = telefonoDe(x)
  if (tel) return tel
  const lid = lidDe(x)
  if (lid) return lid
  if (typeof x === 'string' && x.trim()) return x.trim().slice(0, 80)
  return null
}

/** Whapi pide que el texto tenga "@<número>" por cada mención, además del campo `mentions`. Devuelve las que faltan. */
export function faltanMenciones(texto: string, menciones: readonly string[]): string[] {
  return menciones.filter((n) => !new RegExp(`@${n.replace(/\D/g, '')}(?!\\d)`).test(texto))
}

/** Número de una mención: dígitos (7 a 15) con o sin "@s.whatsapp.net" / "@lid", como pide la referencia. */
export const PATRON_MENCION = /^\d{7,15}(@(s\.whatsapp\.net|lid))?$/

/** Fecha ISO desde el `timestamp` de Whapi (segundos; si vino en milisegundos también se entiende). */
export function isoDeMarca(ts: unknown): string | null {
  const n = typeof ts === 'string' && /^\d+(\.\d+)?$/.test(ts.trim()) ? Number(ts) : ts
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  const ms = n > 1e12 ? n : n * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Una línea de registro (lo que hizo o haría el cliente). */
export function llamada(metodo: LlamadaWhapi['metodo'], ruta: string, resumen: string, simulada: boolean, ahora: number): LlamadaWhapi {
  return { metodo, ruta, resumen: recortar(resumen, 200), simulada, en: new Date(ahora).toISOString() }
}

/** Cómo queda un texto en el registro: recortado a 120 caracteres (nunca el cuerpo completo). */
export const enRegistro = (texto: string | null | undefined): string => (texto ? `"${recortar(texto, 120)}"` : '(sin texto)')

// ── Las operaciones del cliente: verbo, ruta y resumen (lo comparten el cliente real, la compuerta y el juguete) ──
export type MetodoWhapi =
  | 'enviarTexto' | 'enviarVideo' | 'descargarMedio' | 'crearComunidad' | 'subgruposComunidad' | 'crearGrupoEnComunidad'
  | 'agregarParticipantes' | 'ponerFoto' | 'cambiarInfoGrupo' | 'linkInvitacion' | 'verificarNumeros' | 'agendarContacto'
  | 'buscarComunidades' | 'subirMedio' | 'participantesGrupo' | 'quitarParticipantes' | 'eliminarComunidad'

/** Las que cambian algo en WhatsApp. Un 5xx o un corte en una de estas es dudoso (pudo haberse hecho). */
export const ESCRITURAS: ReadonlySet<MetodoWhapi> = new Set<MetodoWhapi>([
  'enviarTexto', 'enviarVideo', 'crearComunidad', 'crearGrupoEnComunidad', 'agregarParticipantes', 'ponerFoto', 'cambiarInfoGrupo', 'agendarContacto',
  'quitarParticipantes', 'eliminarComunidad',
])

type Args = Record<string, unknown>
const s = (x: unknown): string => (typeof x === 'string' ? x : '')
const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [])
const seg = (x: unknown): string => encodeURIComponent(s(x))

/** Verbo, ruta de Whapi y una línea legible (textos recortados a 120 caracteres; nunca el token ni el archivo). */
export function describir(metodo: MetodoWhapi, a: Args): { verbo: LlamadaWhapi['metodo']; ruta: string; resumen: string } {
  switch (metodo) {
    case 'enviarTexto': {
      const extra = [a.citar ? 'citando' : '', lista(a.menciones).length ? `${lista(a.menciones).length} mención(es)` : ''].filter(Boolean).join(', ')
      return { verbo: 'POST', ruta: '/messages/text', resumen: `texto a ${s(a.chatId)}${extra ? ` (${extra})` : ''}: ${enRegistro(s(a.texto))}` }
    }
    case 'enviarVideo':
      return { verbo: 'POST', ruta: '/messages/video', resumen: `video a ${s(a.chatId)}${a.citar ? ' (citando)' : ''} con pie ${enRegistro(s(a.pie))}` }
    case 'descargarMedio':
      return { verbo: 'GET', ruta: `/media/${seg(a.id)}`, resumen: `bajar ${s(a.tipo) || 'archivo'} ${s(a.mime)}`.trim() }
    case 'crearComunidad':
      return { verbo: 'POST', ruta: '/communities', resumen: `crear comunidad ${enRegistro(s(a.nombre))}` }
    case 'subgruposComunidad':
      return { verbo: 'GET', ruta: `/communities/${seg(a.comunidadId)}/subgroups`, resumen: 'leer los subgrupos de la comunidad' }
    case 'crearGrupoEnComunidad':
      return { verbo: 'POST', ruta: `/communities/${seg(a.comunidadId)}`, resumen: `crear grupo ${enRegistro(s(a.nombre))} con ${lista(a.participantes).length} participante(s)` }
    case 'agregarParticipantes':
      return { verbo: 'POST', ruta: `/${a.esComunidad ? 'communities' : 'groups'}/${seg(a.grupoId)}/participants`, resumen: `agregar ${lista(a.participantes).length} participante(s)` }
    case 'ponerFoto':
      return { verbo: 'PUT', ruta: `/groups/${seg(a.grupoId)}/icon`, resumen: `poner foto ${typeof (a.foto as Args | undefined)?.url === 'string' ? (a.foto as Args).url : '(base64)'}` }
    case 'cambiarInfoGrupo':
      return { verbo: 'PUT', ruta: `/groups/${seg(a.grupoId)}`, resumen: `cambiar ${[a.nombre !== undefined ? `nombre ${enRegistro(s(a.nombre))}` : '', a.descripcion !== undefined ? 'descripción' : ''].filter(Boolean).join(' y ') || 'nada'}` }
    case 'linkInvitacion':
      return { verbo: 'GET', ruta: `/groups/${seg(a.grupoId)}/invite`, resumen: 'leer el link de invitación' }
    case 'verificarNumeros':
      return { verbo: 'POST', ruta: '/contacts', resumen: `verificar ${lista(a.numeros).length} número(s)` }
    case 'agendarContacto':
      return { verbo: 'PUT', ruta: '/contacts', resumen: `agendar contacto ${enRegistro(s(a.nombre))}` }
    case 'buscarComunidades':
      return { verbo: 'GET', ruta: '/communities', resumen: `buscar comunidades ${enRegistro(s(a.nombre))} desde ${s(a.desde)}` }
    case 'subirMedio':
      return { verbo: 'POST', ruta: '/media', resumen: 'subir el video a Whapi (una vez, para mandarlo por MediaID)' }
    case 'participantesGrupo':
      return { verbo: 'GET', ruta: `/groups/${seg(a.grupoId)}`, resumen: 'leer los participantes del grupo' }
    case 'eliminarComunidad':
      return { verbo: 'DELETE', ruta: `/communities/${seg(a.comunidadId)}`, resumen: 'eliminar (desactivar) la comunidad' }
    case 'quitarParticipantes':
      return { verbo: 'DELETE', ruta: `/groups/${seg(a.grupoId)}/participants`, resumen: `quitar ${lista(a.participantes).length} participante(s) del grupo` }
  }
}
