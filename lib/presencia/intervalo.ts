// Cada cuánto avisa una pestaña abierta que sigue conectada (y cada cuánto se relee la lista). Aparte de registro.ts para
// que los componentes del navegador no importen el cliente de la base.
export const INTERVALO_LATIDO_MS = 45_000
/** Evento del navegador con la lista de conectados que devuelve el latido (Latido.tsx → Conectados.tsx, 3/11/2026). */
export const EVENTO_CONECTADOS = 'cj:conectados'

const SECCION_POR_PREFIJO: readonly [string, string][] = [
  ['/ventas', 'Ventas'],
  ['/cuotas', 'Cobro de cuotas'],
  ['/clientes/edicion', 'Edición'],
  ['/clientes/referidos', 'Referidos'],
  ['/clientes/altas', 'Altas'],
  ['/clientes', 'Clientes'],
  ['/guiones', 'Guiones'],
  ['/anuncios', 'Anuncios'],
  ['/finanzas', 'Finanzas'],
  ['/trazabilidad', 'Trazabilidad'],
  ['/configuracion', 'Configuración'],
]

/** Nombre de la sección en la que está, a partir de la ruta ("/" = Resumen). La usan el registro y el latido (Latido.tsx). */
export function seccionDeRuta(ruta: string): string {
  if (ruta === '/' || ruta === '') return 'Resumen'
  return SECCION_POR_PREFIJO.find(([p]) => ruta === p || ruta.startsWith(`${p}/`))?.[1] ?? 'Despacho'
}
