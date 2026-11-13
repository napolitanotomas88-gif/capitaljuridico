// Secciones de la navegación unificada, en el orden en que se muestran.
// Qué ve cada rol está en lib/auth/roles.ts (puedeVer).
// 25/10/2026: Guiones, Edición, Anuncios y Referidos dejaron el menú y pasaron a ser pestañas de Clientes
// (lib/auth/hubClientes.ts). Las secciones y sus permisos siguen siendo los mismos: solo cambió dónde se muestran.
import { RUTA_SECCION, puedeVer, type Quien, type Seccion } from '@/lib/auth/roles'
import { PREFIJOS_HUB, rutaClientes } from '@/lib/auth/hubClientes'
import { correoPermitido } from '@/lib/auth/correos'

export type ItemNavegacion = { clave: string; etiqueta: string; href: string; prefijos?: readonly string[] }

export const ETIQUETA_SECCION: Record<Seccion, string> = {
  resumen: 'Resumen',
  guiones: 'Guiones',
  edicion: 'Edición',
  ventas: 'Ventas',
  cuotas: 'Cobro de cuotas',
  trazabilidad: 'Trazabilidad',
  clientes: 'Clientes',
  referidos: 'Referidos',
  altas: 'Altas',
  finanzas: 'Finanzas',
  anuncios: 'Anuncios',
  configuracion: 'Configuración',
}

/** Cómo se nombra cada sección al dar accesos en Configuración: las pestañas de Clientes llevan "Clientes ·" adelante. */
export const ETIQUETA_ACCESO: Record<Seccion, string> = {
  ...ETIQUETA_SECCION,
  clientes: 'Clientes · Cartera',
  guiones: 'Clientes · Guiones',
  edicion: 'Clientes · Edición',
  anuncios: 'Clientes · Anuncios',
  referidos: 'Clientes · Referidos',
  altas: 'Clientes · Altas',
}

/** Entradas del menú. "Clientes" agrupa las cinco pestañas del hub. */
export const SECCIONES_MENU = ['resumen', 'clientes', 'ventas', 'cuotas', 'trazabilidad', 'finanzas', 'configuracion'] as const

export const SECCIONES_NAV: (ItemNavegacion & { clave: Seccion })[] = SECCIONES_MENU.map((s) => ({
  clave: s,
  etiqueta: ETIQUETA_SECCION[s],
  href: RUTA_SECCION[s],
  ...(s === 'clientes' ? { prefijos: PREFIJOS_HUB } : {}),
}))

/**
 * El menú de quien pide. "Clientes" aparece si tiene al menos una pestaña del hub y lleva a la primera que puede ver
 * (René, con solo Edición, va directo a /clientes/edicion; nunca a la Cartera si no la tiene).
 */
export function menuDe(quien: Quien, env: Record<string, string | undefined> = process.env): ItemNavegacion[] {
  const items: ItemNavegacion[] = SECCIONES_NAV.flatMap((it) => {
    if (it.clave !== 'clientes') return puedeVer(quien, it.clave) ? [it] : []
    const href = rutaClientes(quien)
    return href ? [{ ...it, href }] : []
  })
  // EOW (13/11/2026): solo para los mails de EOW_CORREOS (ningún rol lo abre). Va después de Finanzas, antes de Configuración.
  const email = typeof quien === 'string' ? null : ((quien as { email?: string | null }).email ?? null)
  if (!correoPermitido('eow', email, env)) return items
  const conf = items.findIndex((it) => it.clave === 'configuracion')
  items.splice(conf >= 0 ? conf : items.length, 0, ITEM_EOW)
  return items
}

/** Reporte EOW (End of Week): por mail, no por rol (lib/auth/correos.ts). */
export const ITEM_EOW: ItemNavegacion = { clave: 'eow', etiqueta: 'EOW', href: '/eow' }
