// ── Roles y acceso por sección del dashboard unificado ──────────────────────────────────────
// BORRADOR A CONFIRMAR CON EL USUARIO (6/10/2026). La matriz vive acá, en un solo lugar:
//   socio  → todo.
//   closer → solo Ventas.      setter → solo Ventas.
//   csm    → Clientes y Referidos.
//   Finanzas → solo socio.
//   Cobro de cuotas (/cuotas, 10/10/2026: sección propia, ya no dentro de Ventas) → socio y closer.
//   Backend: retirado el 10/10/2026 (ver SECCIONES más abajo).
//   Trazabilidad (21/10/2026: cierres → setting, llamada y ángulos de contenido) → solo socio (o asignada en Configuración).
//   Edición (24/10/2026: tablero de grabación y edición de videos, reemplaza ClickUp) → solo socio (o asignada en
//   Configuración: René entra con un acceso [edicion], sin Clientes). Qué hace cada uno adentro: lib/edicion/permisos.ts.
// Resumen (/) también queda solo para socio, porque mezcla caja y ventas.
// Cómo se llega a tener un rol (login con Google y lista AUTH_USUARIOS): docs/ACCESO-Y-ROLES.md.
// Qué URL protege cada quién (Google, clave propia, cron) está en lib/auth/rutas.ts: ahí se usa esta matriz.
// Ojo: Finanzas y Anuncios además tienen su propia clave (cookies skwd_finanzas y skwd_anuncios): la sesión de Google
// no las reemplaza, y la matriz solo decide quién ve el enlace en la navegación.

// 'acceso' = persona con secciones elegidas a mano en Configuración (su matriz base está VACÍA: sin sus secciones no ve nada).
// 'socio' = administrador. closer, csm y setter son los roles de la lista fija AUTH_USUARIOS de Vercel.
export const ROLES = ['socio', 'closer', 'csm', 'setter', 'acceso'] as const
export type Rol = (typeof ROLES)[number]

// 'configuracion' (alta de accesos) es solo de administradores y no se puede asignar a mano.
// 'backend' se retiró el 10/10/2026 (sus cobros pasaron a Cobro de cuotas; sus marcas, a Clientes). Si la planilla de
// Accesos todavía la tiene asignada a alguien, se ignora (accesosModelo filtra las secciones desconocidas).
// 'altas' (26/10/2026): «Cargar alta», pestaña de Clientes del bot de altas sin WhatsApp. La ven los socios y quien la tenga en
// Configuración; quién carga y aprueba lo decide la página por mail (lib/bot/alta/despacho/aprobadores.ts). Decisión de Tomás:
// los closers NO cargan altas (mandan el cierre al grupo de Ventas), así que el rol closer no la tiene.
export const SECCIONES = ['resumen', 'guiones', 'edicion', 'ventas', 'cuotas', 'trazabilidad', 'clientes', 'referidos', 'altas', 'finanzas', 'anuncios', 'configuracion'] as const
export type Seccion = (typeof SECCIONES)[number]

/** Qué secciones ve cada rol: la única fuente de verdad (la usan el shell, las páginas y los tests) */
export const MATRIZ_ROLES: Record<Rol, readonly Seccion[]> = {
  socio: SECCIONES,
  closer: ['ventas', 'cuotas'],
  setter: ['ventas'],
  csm: ['clientes', 'referidos'],
  acceso: [],
}

export const ETIQUETA_ROL: Record<Rol, string> = {
  socio: 'Socio',
  closer: 'Closer',
  csm: 'CSM',
  setter: 'Setter',
  acceso: 'Acceso',
}

/** Ruta de cada sección (la usa la navegación y las redirecciones) */
export const RUTA_SECCION: Record<Seccion, string> = {
  resumen: '/',
  guiones: '/guiones',
  edicion: '/clientes/edicion',
  ventas: '/ventas',
  cuotas: '/cuotas',
  trazabilidad: '/trazabilidad',
  clientes: '/clientes',
  referidos: '/clientes/referidos',
  altas: '/clientes/altas',
  finanzas: '/finanzas',
  anuncios: '/anuncios',
  configuracion: '/configuracion',
}

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}

/** Secciones que un administrador puede darle a una persona de tipo "Acceso" */
export const SECCIONES_ASIGNABLES: readonly Seccion[] = SECCIONES.filter((s) => s !== 'configuracion')

/**
 * Quién pide: un rol suelto (matriz fija) o una sesión/persona con `secciones` propias (las de Configuración o, para los
 * de la lista fija, las de su rol). Con `secciones` manda esa lista; sin ella, la matriz del rol. Un rol 'acceso' sin
 * `secciones` no ve nada (falla cerrado).
 */
export type Quien = Rol | { rol: Rol; secciones?: readonly Seccion[] | null }

export function puedeVer(quien: Quien, seccion: Seccion): boolean {
  if (typeof quien === 'string') return MATRIZ_ROLES[quien].includes(seccion)
  if (quien.secciones) return quien.secciones.includes(seccion)
  return MATRIZ_ROLES[quien.rol].includes(seccion)
}

/** Primera sección que el rol puede ver: adonde se lo manda al entrar o si pide algo que no puede ver */
export function rutaInicial(quien: Quien): string {
  const lista = typeof quien === 'string' ? MATRIZ_ROLES[quien] : (quien.secciones ?? MATRIZ_ROLES[quien.rol])
  // La primera que puede ver, en el orden del menú (no en el que se cargó)
  const primera = SECCIONES.find((s) => lista.includes(s))
  return primera ? RUTA_SECCION[primera] : RUTA_SIN_SECCIONES
}
/**
 * Adónde mandar a quien entró con Google pero no tiene sesión del CRM en `seccion` (no es administrador ni tiene una pestaña
 * de closer asignada). Con Ventas, a /ventas: esa página explica el "sin CRM asignado" y no redirige. Sin Ventas, a su
 * sección inicial, como antes (con Guiones y Cobro de cuotas, a /guiones; con Resumen, a /). La única excepción es cuando
 * esa sección inicial es justo la que pidió: ahí redirigir era un bucle infinito, así que devuelve null y requerirSesion corta
 * con un error en lugar de redirigir. Para Cobro de cuotas sin Ventas ya no llega acá: desde el 10/10/2026 esa persona ve los
 * planes de Administración (sesionActual en lib/crm/auth.ts).
 */
export function rutaSinCRM(quien: Quien, seccion: 'ventas' | 'cuotas'): string | null {
  if (puedeVer(quien, 'ventas')) return RUTA_SECCION.ventas
  const inicial = rutaInicial(quien)
  return inicial === RUTA_SECCION[seccion] ? null : inicial
}

/** Destino de quien no tiene ninguna sección (no debería pasar: Configuración no deja guardar un acceso vacío). La página de acceso lo explica en vez de redirigir en bucle. */
export const RUTA_SIN_SECCIONES = '/entrar?error=sin_secciones'

// Secciones con barra de navegación fija, en orden de preferencia para "volver al menú" (rutaMenu). El Resumen (/) vive
// dentro del shell (app/page.tsx lo envuelve) y es el hogar del socio. Finanzas y Anuncios también se muestran dentro del
// marco cuando hay sesión de Google (components/shell/MarcoOpcional.tsx), pero se abren con su propia contraseña y quien
// entra solo con ella no tiene marco: por eso no cuentan como destino de "volver".
const SECCIONES_CON_MENU: readonly Seccion[] = ['resumen', 'clientes', 'ventas', 'cuotas', 'referidos']

/** Página del shell a la que vuelve el rol: la primera con barra de navegación fija que puede ver */
export function rutaMenu(quien: Quien): string {
  const seccion = SECCIONES_CON_MENU.find((s) => puedeVer(quien, s))
  return seccion ? RUTA_SECCION[seccion] : rutaInicial(quien)
}
