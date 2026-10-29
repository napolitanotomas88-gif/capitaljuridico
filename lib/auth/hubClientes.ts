// ── Clientes como hub (25/10/2026) ──────────────────────────────────────────────────────────────────────────
// Guiones, Edición, Anuncios y Referidos dejaron de ser entradas sueltas del menú: viven como PESTAÑAS dentro de Clientes.
// Los permisos NO cambiaron: cada pestaña pide exactamente la sección de siempre (las mismas claves de lib/auth/roles.ts y de
// la planilla de Accesos: 'clientes', 'guiones', 'edicion', 'anuncios', 'referidos'). La pestaña Cartera es la sección
// 'clientes' (muestra cobros): tener otra pestaña NUNCA la habilita.
//   · Alguien con solo [edicion] (René) ve Clientes en el menú, entra directo a Edición y no ve Cartera ni las demás.
//   · Alguien sin ninguna de las cinco no ve Clientes.
// Rutas: Cartera, Edición y Referidos viven bajo /clientes. Guiones sigue en /guiones (la verificación por cliente,
// /guiones/[id], es de la sección Guiones sola, sin Clientes) y Anuncios en /anuncios (se abre con su propia clave, sin
// Google: Valentino). Las dos se muestran igual como pestañas del hub. Redirecciones de las rutas viejas: next.config.ts.
// Sin imports de Next: se prueba con node:test (scripts/test-nav.mjs).
import { puedeVer, type Quien, type Seccion } from './roles'

export type PestanaClientes = { clave: Seccion; etiqueta: string; href: string; icono: string }

/** Las pestañas del hub, en el orden en que se muestran. */
export const PESTANAS_CLIENTES: readonly PestanaClientes[] = [
  { clave: 'clientes', etiqueta: 'Cartera', href: '/clientes', icono: 'cartera' },
  { clave: 'guiones', etiqueta: 'Guiones', href: '/guiones', icono: 'guiones' },
  { clave: 'edicion', etiqueta: 'Edición', href: '/clientes/edicion', icono: 'edicion' },
  { clave: 'anuncios', etiqueta: 'Anuncios', href: '/anuncios', icono: 'anuncios' },
  { clave: 'referidos', etiqueta: 'Referidos', href: '/clientes/referidos', icono: 'referidos' },
  // «Cargar alta» (26/10/2026): el bot de altas sin WhatsApp. Sección propia 'altas' (closers y quien la tenga asignada)
  { clave: 'altas', etiqueta: 'Cargar alta', href: '/clientes/altas', icono: 'tarea' },
]

/** Secciones que forman el hub (las que ya no van sueltas en el menú). */
export const SECCIONES_HUB: readonly Seccion[] = PESTANAS_CLIENTES.map((p) => p.clave)

/** Pestañas que ve quien pide: solo las de sus secciones. */
export function pestanasVisibles(quien: Quien): PestanaClientes[] {
  return PESTANAS_CLIENTES.filter((p) => puedeVer(quien, p.clave))
}

/** Si ve Clientes en el menú: con al menos una pestaña. */
export function veClientes(quien: Quien): boolean {
  return pestanasVisibles(quien).length > 0
}

/** Adónde lleva "Clientes" del menú: la primera pestaña permitida (nunca Cartera para quien no la tiene). Null sin ninguna. */
export function rutaClientes(quien: Quien): string | null {
  return pestanasVisibles(quien)[0]?.href ?? null
}

function bajo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Pestaña activa para una ruta. Edición y Referidos se miran antes que Cartera (están bajo /clientes); /clientes/<id> y su
 * kickoff son la ficha: Cartera.
 */
export function pestanaActiva(pathname: string): Seccion | null {
  const ruta = pathname.replace(/\/+$/, '') || '/'
  const especificas = PESTANAS_CLIENTES.filter((p) => p.clave !== 'clientes')
  const hit = especificas.find((p) => bajo(ruta, p.href))
  if (hit) return hit.clave
  return bajo(ruta, '/clientes') ? 'clientes' : null
}

/** Prefijos de ruta en los que "Clientes" del menú figura como activo. */
export const PREFIJOS_HUB: readonly string[] = ['/clientes', '/guiones', '/anuncios']

/**
 * Adónde mandar a quien pidió una sección que no puede ver. Si era una pestaña del hub (por ejemplo René abriendo /clientes,
 * la Cartera), a su primera pestaña permitida: se queda dentro de Clientes. Si no tiene ninguna, a su sección inicial.
 * Nunca devuelve una ruta del hub que no pueda ver (rutaClientes solo mira sus pestañas), así que no hay bucle.
 */
export function destinoSinPermiso(quien: Quien, seccion: Seccion | undefined, rutaInicial: (q: Quien) => string): string {
  if (seccion && SECCIONES_HUB.includes(seccion)) {
    const enHub = rutaClientes(quien)
    if (enHub) return enHub
  }
  return rutaInicial(quien)
}
