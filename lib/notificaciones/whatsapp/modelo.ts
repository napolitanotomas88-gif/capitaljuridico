// ── Salida única de WhatsApp de la bandeja central: reglas puras (sin red ni base; lo prueba scripts/test-notif-whatsapp.mjs) ──
// Pedido de Tomás (1/11/2026): «Tenés mi ok ya para avisar todas las notificaciones del equipo por WhatsApp», armando la
// salida UNA sola vez, en la bandeja central (cj_notificaciones), y no en cada bot. Detalle en docs/NOTIF-WHATSAPP.md.
//   · Interruptor NOTIF_WHATSAPP: sin variable (o cualquier otro valor) = apagado. 'prueba' = todo va SOLO al chat de Tomás
//     (NOTIF_WHATSAPP_PRUEBA_CHAT), con «🧪 PRUEBA → iría a …». 'real' = al grupo del equipo de cada área (WHAPI_GRUPO_*).
//   · Solo grupos del EQUIPO que ya existen (lista blanca de WHAPI_GRUPO_*). Nunca a un cliente, nunca crea grupos.
//   · Los tipos que HOY ya salen por WhatsApp (Guiones a COPYWRITING, altas/éxito/bajas en Verificaciones, Anuncios al
//     grupo ADS) están EXCLUIDOS: no se duplican.
//   · Sin teléfonos ni nombres de clientes en el código: las personas salen de variables de Vercel (NOTIF_PERSONAS_JSON,
//     BOT_ALTA_EQUIPO_TELEFONOS y los mails de rol que ya existen).
import type { Seccion } from '../../auth/roles'

export type ModoNotifWa = 'apagado' | 'prueba' | 'real'
export type GrupoEquipo = 'EDICION' | 'ADS' | 'OPERACIONES' | 'COPYWRITING' | 'CSM'
export type Rol = 'tomas' | 'aylu' | 'rene' | 'gero_m' | 'valen' | 'faus'   // «Tomi» es Tomás (KICKOFF_REVISOR_TOMI)
type Entorno = Record<string, string | undefined>

export const GRUPOS_EQUIPO: readonly GrupoEquipo[] = ['EDICION', 'ADS', 'OPERACIONES', 'COPYWRITING', 'CSM']
export const NOMBRE_GRUPO: Record<GrupoEquipo, string> = { EDICION: 'Edición', ADS: 'Ads', OPERACIONES: 'Operaciones', COPYWRITING: 'Copywriting', CSM: 'CSM' }
export const NOMBRE_ROL: Record<Rol, string> = { tomas: 'Tomás', aylu: 'Aylu', rene: 'René', gero_m: 'Gero M', valen: 'Valen', faus: 'Faus' }

export const ESPACIO_MIN_MS = 5 * 60_000          // entre dos mensajes (de cualquier grupo)
export const MAX_DIA_POR_DEFECTO = 8              // NOTIF_WHATSAPP_MAX_DIA
export const VENTANA_MS = 10 * 60_000             // se junta lo pendiente de un grupo: sale cuando lo más viejo tiene 10 min
export const MAX_ANTIGUEDAD_MS = 48 * 3600_000    // un aviso de más de 48 h no sale por WhatsApp
export const ENVIANDO_VENCE_MS = 10 * 60_000      // «enviando» por más de esto → dudoso (no se reintenta solo)
export const MAX_LINEAS = 5                       // con más avisos, solo la cuenta y el link
export const HORA_DESDE = 9, HORA_HASTA = 20      // horario hábil de Argentina

export const modoNotifWa = (env: Entorno = process.env): ModoNotifWa => {
  const v = env.NOTIF_WHATSAPP?.trim().toLowerCase()
  return v === 'prueba' || v === 'real' ? v : 'apagado'
}
export const maxPorDia = (env: Entorno = process.env): number => {
  const n = Number(env.NOTIF_WHATSAPP_MAX_DIA)
  return Number.isInteger(n) && n > 0 && n <= 50 ? n : MAX_DIA_POR_DEFECTO
}
const digitos = (v: unknown): string | null => {
  const t = String(v ?? '').replace(/\D/g, '')
  return t.length >= 7 && t.length <= 15 ? t : null
}
/** El chat de prueba (Tomás): un teléfono (→ "<dígitos>@s.whatsapp.net") o un chat id de Whapi tal cual. */
export function chatPrueba(env: Entorno = process.env): string | null {
  const v = env.NOTIF_WHATSAPP_PRUEBA_CHAT?.trim() ?? ''
  if (/^\d{7,15}@(s\.whatsapp\.net|c\.us)$/.test(v)) return v
  const d = /^[+\d\s()-]+$/.test(v) ? digitos(v) : null
  return d ? `${d}@s.whatsapp.net` : null
}
/** El chat del grupo del equipo (WHAPI_GRUPO_<GRUPO>), solo si tiene forma de grupo. */
export function chatGrupo(grupo: GrupoEquipo, env: Entorno = process.env): string | null {
  const v = env[`WHAPI_GRUPO_${grupo}`]?.trim() ?? ''
  return /^[\w.-]+@g\.us$/.test(v) ? v : null
}
/** Lista blanca: los únicos chats a los que esta salida puede escribir (según el modo). */
export function chatsPermitidos(modo: ModoNotifWa, env: Entorno = process.env): Set<string> {
  if (modo === 'prueba') { const c = chatPrueba(env); return new Set(c ? [c] : []) }
  if (modo === 'real') return new Set(GRUPOS_EQUIPO.flatMap(g => { const c = chatGrupo(g, env); return c ? [c] : [] }))
  return new Set()
}

// ── Qué tipo va a qué grupo ───────────────────────────────────────────────────────────────────────────────────────────
/** Tipos que HOY ya salen por WhatsApp por su propio bot: nunca se encolan (no duplicar). */
export const TIPOS_EXCLUIDOS: ReadonlySet<string> = new Set([
  'guiones_a_revisar', 'guiones_con_notas',                  // Guiones → grupo COPYWRITING (bot de guiones)
  'altas_esperando_humano', 'altas_revisar',                 // motor de altas → Verificaciones C.J
  'exito_abierto', 'bajas_abierto',                          // pedidos de OK de Éxito y Bajas → Verificaciones C.J
])
/** Prefijos excluidos: todo lo de altas (Verificaciones) y lo de Anuncios que ya entra en el resumen del grupo ADS. */
const PREFIJOS_EXCLUIDOS = ['altas_', 'alta_', 'anuncios_g', 'anuncios_resumen']

export interface NotifParaMapa { tipo: string; paraEmail: string | null; paraSeccion: Seccion | null }
export interface Destino { grupo: GrupoEquipo; roles: Rol[]; persona: string | null }   // persona = mail a mencionar
export type Mapeo = { ok: true; destino: Destino } | { ok: false; motivo: string }

/** NOTIF_MAPA: tipo de aviso → grupo del área y a quién mencionar. Sin datos personales (los teléfonos van por variable). */
export function mapear(n: NotifParaMapa): Mapeo {
  const t = n.tipo
  if (TIPOS_EXCLUIDOS.has(t) || PREFIJOS_EXCLUIDOS.some(p => t.startsWith(p))) return { ok: false, motivo: 'ya sale por WhatsApp desde su bot' }
  const conPersona = (grupo: GrupoEquipo, roles: Rol[] = []): Mapeo => ({ ok: true, destino: { grupo, roles, persona: n.paraEmail } })
  switch (t) {
    case 'edicion_tarjetas':
      return n.paraSeccion === 'anuncios' && !n.paraEmail ? conPersona('ADS', ['valen']) : conPersona('EDICION')
    case 'edicion_entrega_revisar': return conPersona('EDICION')
    case 'edicion_crudo_a_revisar': case 'edicion_editado': case 'edicion_corregido': return conPersona('EDICION', ['aylu'])
    case 'edicion_correccion': return conPersona('EDICION', ['rene'])
    case 'edicion_bloqueado': return conPersona('EDICION', ['tomas', 'aylu'])
    case 'guiones_entrega': return conPersona('OPERACIONES')
    case 'guiones_error': return conPersona('COPYWRITING', ['tomas', 'faus'])
    case 'kickoff_error': return conPersona('OPERACIONES', ['tomas'])
    case 'cliente_sin_respuesta': case 'beneficio_referido': return conPersona('CSM')
    case 'anuncios_dudoso': return conPersona('ADS', ['valen'])
    case 'exito_error': case 'exito_dudoso': case 'bajas_error': case 'bajas_dudoso': return conPersona('CSM', ['tomas'])
    default: return { ok: false, motivo: 'tipo sin grupo de WhatsApp' }
  }
}

// ── Personas (teléfonos por variable) ──────────────────────────────────────────────────────────────────────────────────
export interface Persona { nombre: string; tel: string | null }
const mails = (s?: string) => (s ?? '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
/** Los mails de cada rol: las mismas variables que ya usan Edición (lib/edicion/permisos.ts), Kickoff y Guiones. */
export function mailsDeRol(rol: Rol, env: Entorno = process.env): string[] {
  const vars: Record<Rol, string[]> = {
    tomas: ['EDICION_REVISOR_TOMAS', 'KICKOFF_REVISOR_TOMI'], aylu: ['EDICION_REVISOR_AYLU'], rene: ['EDICION_EDITOR_RENE'],
    gero_m: ['KICKOFF_REVISOR_GERO_M'], valen: [], faus: ['GUIONES_REVISOR_FAUS'],
  }
  for (const v of vars[rol]) { const l = mails(env[v]); if (l.length) return l }
  return []
}
type MapaPersonas = Record<string, { nombre?: unknown; tel?: unknown; rol?: unknown }>
/** NOTIF_PERSONAS_JSON: { "<mail o rol>": { "nombre": "Aylu", "tel": "549…", "rol": "aylu" } }. Lo roto se ignora. */
export function personasDesdeEntorno(env: Entorno = process.env): MapaPersonas {
  try {
    const o = JSON.parse(env.NOTIF_PERSONAS_JSON || '{}') as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    return Object.fromEntries(Object.entries(o as MapaPersonas).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k.trim().toLowerCase(), v]))
  } catch { return {} }
}
/** Respaldo: BOT_ALTA_EQUIPO_TELEFONOS ({ "Gero M": "549…", "Aylu": "549…" }), buscado por nombre. */
function telPorNombre(nombre: string, env: Entorno): string | null {
  try {
    const o = JSON.parse(env.BOT_ALTA_EQUIPO_TELEFONOS || '{}') as Record<string, unknown>
    const clave = Object.keys(o).find(k => k.trim().toLowerCase() === nombre.trim().toLowerCase())
    return clave ? digitos(o[clave]) : null
  } catch { return null }
}
const deMapa = (v: MapaPersonas[string] | undefined, nombre: string): Persona | null =>
  v ? { nombre: typeof v.nombre === 'string' && v.nombre.trim() ? v.nombre.trim().slice(0, 40) : nombre, tel: digitos(v.tel) } : null
function completar(p: Persona, env: Entorno): Persona {
  return p.tel ? p : { ...p, tel: telPorNombre(p.nombre, env) }
}
export function personaPorRol(rol: Rol, env: Entorno = process.env): Persona {
  const m = personasDesdeEntorno(env)
  const directo = deMapa(m[rol] ?? Object.values(m).find(v => v.rol === rol), NOMBRE_ROL[rol])
  if (directo) return completar(directo, env)
  for (const email of mailsDeRol(rol, env)) { const p = deMapa(m[email], NOMBRE_ROL[rol]); if (p) return completar(p, env) }
  const p = completar({ nombre: NOMBRE_ROL[rol], tel: null }, env)
  return rol === 'valen' && !p.tel ? { ...p, tel: digitos(env.ANUNCIOS_WHATSAPP_TEL_VALENTINO) } : p
}
export function personaPorEmail(email: string, env: Entorno = process.env): Persona {
  const e = email.trim().toLowerCase()
  const m = personasDesdeEntorno(env)
  const directo = deMapa(m[e], '')
  if (directo?.nombre) return completar(directo, env)
  const rol = (Object.keys(NOMBRE_ROL) as Rol[]).find(r => mailsDeRol(r, env).includes(e))
  if (rol) return { ...personaPorRol(rol, env), ...(directo?.tel ? { tel: directo.tel } : {}) }
  return completar({ nombre: e.split('@')[0].slice(0, 40), tel: directo?.tel ?? null }, env)
}
export function personasDe(d: Destino, env: Entorno = process.env): Persona[] {
  const todas = [...d.roles.map(r => personaPorRol(r, env)), ...(d.persona ? [personaPorEmail(d.persona, env)] : [])]
  const vistas = new Set<string>()
  return todas.filter(p => { const k = p.tel ?? `n:${p.nombre.toLowerCase()}`; if (vistas.has(k)) return false; vistas.add(k); return true })
}

// ── Horario y texto ────────────────────────────────────────────────────────────────────────────────────────────────────
export function enHorario(ahora: number): boolean {
  const h = Number(new Date(ahora).toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false })) % 24
  return h >= HORA_DESDE && h < HORA_HASTA
}

export interface ItemMensaje { titulo: string; url: string | null; detalle?: string | null; personas: Persona[] }
const linea = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim()
/** Junta los avisos repetidos (el mismo aviso a varias personas por mail) en una sola línea. */
export function juntarItems(items: readonly ItemMensaje[]): ItemMensaje[] {
  const por = new Map<string, ItemMensaje>()
  for (const i of items) {
    const k = `${linea(i.titulo)}|${i.url ?? ''}`
    const previo = por.get(k)
    if (!previo) por.set(k, { ...i, personas: [...i.personas] })
    else for (const p of i.personas) if (!previo.personas.some(x => (x.tel && x.tel === p.tel) || x.nombre === p.nombre)) previo.personas.push(p)
  }
  return [...por.values()]
}

/** El único mensaje para un grupo: «N avisos para Edición» con las menciones y el link a la pantalla. */
export function armarMensaje(p: { modo: Exclude<ModoNotifWa, 'apagado'>; grupo: GrupoEquipo; items: readonly ItemMensaje[]; base: string }): { texto: string; menciones: string[] } {
  const items = juntarItems(p.items)
  const personas: Persona[] = []
  for (const i of items) for (const x of i.personas) if (!personas.some(y => (y.tel && y.tel === x.tel) || y.nombre === x.nombre)) personas.push(x)
  const real = p.modo === 'real'
  const menciones = real ? [...new Set(personas.flatMap(x => (x.tel ? [x.tel] : [])))] : []
  const quienes = personas.map(x => (real && x.tel ? `@${x.tel}` : x.nombre)).join(' ')
  const n = items.length
  const url = (u: string | null) => (u ? `${p.base}${u}` : p.base)
  const cabeza = `🔔 *${n} aviso${n === 1 ? '' : 's'} para ${NOMBRE_GRUPO[p.grupo]}*${quienes ? ` · ${quienes}` : ''}`
  const cuerpo = n > MAX_LINEAS
    ? [`Están en la campanita del Despacho: ${p.base}`]
    : [...items.map(i => `• ${linea(i.titulo)}${i.detalle ? ` · ${linea(i.detalle)}` : ''}\n  ${url(i.url)}`)]
  const prueba = real ? [] : [`🧪 PRUEBA → iría a ${NOMBRE_GRUPO[p.grupo]} mencionando ${personas.map(x => x.nombre).join(', ') || 'a nadie'}`]
  return { texto: [...prueba, cabeza, ...cuerpo].join('\n').slice(0, 3500), menciones }
}
