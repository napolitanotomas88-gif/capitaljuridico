/** Destinos reales del Hub. La Cartera interpreta `accion` después de elegir al cliente. */
export interface AccesoRapido { href: string; etiqueta: string }
export function atajosDelHub(accesos: readonly AccesoRapido[], p: { puedeEditarCliente?: boolean; puedeFinanzas?: boolean; puedeEntregarGuiones?: boolean } = {}): AccesoRapido[] {
  const rutas = new Set(accesos.map(a => a.href))
  const out: AccesoRapido[] = []
  if (rutas.has('/clientes/altas')) out.push({ href: '/clientes/altas', etiqueta: 'Dar de alta un cliente' })
  if (rutas.has('/clientes')) {
    out.push({ href: '/clientes#lista-clientes', etiqueta: 'Buscar un cliente' })
    if (p.puedeEditarCliente) {
      if (p.puedeFinanzas) out.push({ href: '/clientes?accion=pago', etiqueta: 'Registrar un pago' })
      for (const [accion, etiqueta] of [['servicio', 'Sumar servicio'], ['pausa', 'Pausar un servicio'], ['reanudar', 'Reanudar un servicio'], ['renovacion', 'Registrar renovación'], ['proyeccion', 'Llamada de proyección'], ['archivar', 'Archivar un cliente']] as const) {
        if (accion === 'renovacion' && !p.puedeFinanzas) continue
        out.push({ href: `/clientes?accion=${accion}`, etiqueta })
      }
    }
  }
  if (rutas.has('/clientes') && p.puedeEntregarGuiones) out.push({ href: '/clientes/entregas', etiqueta: 'Entregar guiones listos' })
  if (rutas.has('/guiones')) out.push({ href: '/guiones', etiqueta: 'Revisar guiones' })
  if (rutas.has('/clientes/edicion')) out.push({ href: '/clientes/edicion', etiqueta: 'Revisar edición' })
  if (rutas.has('/clientes/referidos')) out.push({ href: '/clientes/referidos', etiqueta: 'Gestionar referidos' })
  return out
}
