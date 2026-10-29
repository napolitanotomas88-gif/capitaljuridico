// ── Quién es quién en Edición (puro: sin imports de Next ni de la base) ──────────────────────────────────────────
// La sección `edicion` (lib/auth/roles.ts) decide quién ENTRA a /clientes/edicion. Adentro, el rol de edición decide qué puede
// hacer cada uno. El rol sale SIEMPRE de la sesión de Google, nunca del cuerpo de un pedido:
//   · aylu  → EDICION_REVISOR_AYLU: revisa crudos (e04), deja notas (f03), manda al cliente, carga la marca, vínculos…
//   · tomas → EDICION_REVISOR_TOMAS (si falta, KICKOFF_REVISOR_TOMI): todo lo de Aylu, más la 3.ª ronda del cliente (P6),
//             la decisión del día 9 (e01), reabrir y quitar el bloqueo del tope;
//   · rene  → EDICION_EDITOR_RENE: ve su cola, marca listo y corregido, tilda notas y acepta el editado que propone el bot;
//   · lector → cualquier otra persona con la sección: ve el tablero y no mueve nada.
// En producción el rol sale solo del mail EXACTO (cada variable admite varios, separados por coma). Sin la variable, o con
// un mail que figura en dos listas, el rol es `lector`: falla cerrado, igual que KICKOFF_REVISOR_*. Fuera de producción,
// si la variable de un rol no está, vale el nombre o el apellido como palabra entera en el nombre de la sesión (aylén o
// cuenca, napolitano, rené), nunca el mail. El usuario de prueba de desarrollo (CRM_DEV_ROL) siempre es `lector`.
// René entra con una fila de tipo "acceso" con [edicion] en Configuración: sin Clientes. Por eso la vista nunca le arma
// links a /clientes (solo los ve quien cumple puedeVer(sesion, 'clientes')) y en Edición no aparece ningún cobro.
import { puedeVer, type Quien } from '@/lib/auth/roles'
import type { Persona, RolEdicion } from './tipos'

type Entorno = Record<string, string | undefined>
export type RolActivo = Exclude<RolEdicion, 'lector'>

export const VARIABLES_ROL = {
  aylu: ['EDICION_REVISOR_AYLU'],
  tomas: ['EDICION_REVISOR_TOMAS', 'KICKOFF_REVISOR_TOMI'],
  rene: ['EDICION_EDITOR_RENE'],
} as const satisfies Record<RolActivo, readonly string[]>

export const ROLES_ACTIVOS: readonly RolActivo[] = ['aylu', 'tomas', 'rene']
export const NOMBRE_ROL: Record<RolEdicion, string> = { aylu: 'Aylu', tomas: 'Tomás', rene: 'René', lector: 'Solo lectura' }

// Respaldo SOLO fuera de producción: nombre o apellido como palabra entera (sin acentos, en minúscula)
const NOMBRE_EN_DESARROLLO: Record<RolActivo, RegExp> = { aylu: /\b(aylen|cuenca)\b/, tomas: /\bnapolitano\b/, rene: /\brene\b/ }

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailLimpio = (x: unknown): string | null => {
  if (typeof x !== 'string') return null
  const e = x.trim().toLowerCase()
  return e.length <= 254 && /^[\x21-\x7e]+$/.test(e) && RE_EMAIL.test(e) ? e : null
}
const mailsDe = (v: string | undefined): string[] => (v ?? '').split(/[,;\s]+/).map(emailLimpio).filter((e): e is string => !!e)
const normNombre = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
/** Next pone NODE_ENV=production en el build y en cualquier deploy de Vercel (también los previews). */
export const enProduccion = (env: Entorno) => env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production'

/** Los mails de un rol: los de la primera variable que tenga alguno (Tomás: EDICION_REVISOR_TOMAS y, si no, la del kickoff). */
export function mailsDelRol(rol: RolActivo, env: Entorno = process.env): string[] {
  for (const v of VARIABLES_ROL[rol]) {
    const lista = mailsDe(env[v])
    if (lista.length) return lista
  }
  return []
}

export interface SesionRol { email: string; nombre: string; esDePrueba?: boolean }

/** El rol de edición de la sesión (ver arriba). Nunca lanza. */
export function rolEdicion(s: SesionRol | null | undefined, env: Entorno = process.env): RolEdicion {
  if (!s || s.esDePrueba) return 'lector'
  const email = emailLimpio(s.email)
  if (!email) return 'lector'
  const n = normNombre(s.nombre ?? '')
  const prod = enProduccion(env)
  const encontrados = ROLES_ACTIVOS.filter(rol => {
    const lista = mailsDelRol(rol, env)
    if (lista.length) return lista.includes(email)
    return !prod && NOMBRE_EN_DESARROLLO[rol].test(n)
  })
  return encontrados.length === 1 ? encontrados[0] : 'lector'
}

/** La persona que firma lo que se escribe (null = lector: no escribe). El nombre es el de la sesión; el mail solo audita. */
export function personaDeSesion(s: SesionRol | null | undefined, env: Entorno = process.env): Persona | null {
  const rol = rolEdicion(s, env)
  if (rol === 'lector' || !s) return null
  const nombre = (s.nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || NOMBRE_ROL[rol]
  return { rol, nombre, email: emailLimpio(s.email) ?? '' }
}

/** Qué variable falta para que un rol funcione en producción (para decírselo a quien entra como lector). */
export function variablesFaltantes(env: Entorno = process.env): string[] {
  return ROLES_ACTIVOS.filter(r => !mailsDelRol(r, env).length).map(r => VARIABLES_ROL[r][0])
}

// ── Qué pantalla ve cada uno ──
export type Pestana = 'cola' | 'estado' | 'pendientes' | 'vinculos' | 'avisos'
export const NOMBRE_PESTANA: Record<Pestana, string> = {
  cola: 'Mi cola', estado: 'Por estado', pendientes: 'Grabaciones pendientes', vinculos: 'Vínculos', avisos: 'Avisos',
}
export const RUTA_PESTANA: Record<Pestana, string> = {
  cola: '/clientes/edicion', estado: '/clientes/edicion?vista=estado', pendientes: '/clientes/edicion/pendientes', vinculos: '/clientes/edicion/vinculos', avisos: '/clientes/edicion/avisos',
}

/** ¿Es socio (o administrador)? Los lectores socios pueden ver las grabaciones pendientes; René y otros lectores, no. */
export const esSocio = (s: { rol?: string; admin?: boolean } | null | undefined): boolean => !!s && (s.admin === true || s.rol === 'socio')

/** Las pestañas que ve el rol (René: su cola y el tablero; Aylu y Tomás, todas; un lector socio suma las pendientes). */
export function pestanasDe(rol: RolEdicion, socio: boolean): Pestana[] {
  if (rol === 'aylu' || rol === 'tomas') return ['cola', 'estado', 'pendientes', 'vinculos', 'avisos']
  if (rol === 'rene') return ['cola', 'estado']
  return socio ? ['estado', 'pendientes'] : ['estado']
}
export const puedePestana = (rol: RolEdicion, socio: boolean, p: Pestana): boolean => pestanasDe(rol, socio).includes(p)

/** ¿Le armamos links a la ficha del cliente (/clientes/…)? Solo a quien ve la sección Clientes (René no). */
export const veClientes = (s: Quien | null | undefined): boolean => !!s && puedeVer(s, 'clientes')

// ── Qué puede hacer cada rol fuera de la máquina de estados (la de estados vive en estados.ts) ──
export type Permiso =
  | 'vincular' | 'aceptar_editado' | 'nota' | 'tildar' | 'envio' | 'prioridad' | 'bloqueo' | 'bloqueo_otro'
  | 'guiones_enviados' | 'paso' | 'decidir_paso' | 'pedido' | 'autorizar_ronda' | 'marca' | 'vinculo_carpeta' | 'tope'

const PERMISOS: Record<RolEdicion, readonly Permiso[]> = {
  tomas: ['vincular', 'aceptar_editado', 'nota', 'tildar', 'envio', 'prioridad', 'bloqueo', 'bloqueo_otro', 'guiones_enviados', 'paso', 'decidir_paso', 'pedido', 'autorizar_ronda', 'marca', 'vinculo_carpeta', 'tope'],
  aylu: ['vincular', 'aceptar_editado', 'nota', 'tildar', 'envio', 'prioridad', 'bloqueo', 'bloqueo_otro', 'guiones_enviados', 'paso', 'pedido', 'marca', 'vinculo_carpeta'],
  rene: ['aceptar_editado', 'tildar', 'bloqueo_otro'],
  lector: [],
}
export const tienePermiso = (rol: RolEdicion, p: Permiso): boolean => PERMISOS[rol].includes(p)
