import { fechaDeCelda, hoyArgentina, diasEntre } from '../clientes/fechas'

// Closer 4 y Closer 5: pestañas nuevas del 18/10/2026 (copias vacías de Closer 2), para dos closers más
export const PESTANAS_VENTAS = ['Closer 1', 'Closer 2', 'Closer 3', 'Closer 4', 'Closer 5', 'Gero-Xavi Rejunte'] as const
export type PestanaVentas = typeof PESTANAS_VENTAS[number]
export type PendienteVenta = { id: string; pestana: string; fila: number; nombre: string; telefono: string; fecha: string; accion: string; atrasado: boolean; revision: boolean }
const texto = (v: unknown) => String(v ?? '').trim()
const normal = (v: unknown) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** La asignación se resuelve en servidor. Un closer/setter sin asignación no recibe leads. */
export function pestanasPermitidas(rol: string, email: string, crudo: string | undefined): PestanaVentas[] {
  if (rol === 'socio') return [...PESTANAS_VENTAS]
  if (rol !== 'closer' && rol !== 'setter') return []
  try {
    const datos: unknown = JSON.parse(crudo ?? '{}')
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return []
    const valor = (datos as Record<string, unknown>)[email.trim().toLowerCase()]
    if (!Array.isArray(valor) || !valor.length || !valor.every(p => PESTANAS_VENTAS.includes(p))) return []
    return [...new Set(valor)] as PestanaVentas[]
  } catch { return [] }
}

/** Vista de revisión: no supone fechas de último envío que la hoja no registra. */
export function pendientesDeFilas(pestana: string, filas: unknown[][], hoy = hoyArgentina()): PendienteVenta[] {
  const pendientes: PendienteVenta[] = []
  filas.forEach((r, i) => {
    const fecha = fechaDeCelda(r[3])
    const nombre = texto(r[0])
    if (!nombre || !fecha || diasEntre(fecha, hoy) > 60) return
    const precall = normal(r[5]), asistencia = normal(r[17]), noShow = normal(r[18])
    const reagenda = fechaDeCelda(r[28]), asistenciaReagenda = normal(r[19])
    const resultado = normal(r[21]), post = normal(r[22])
    if (precall === 'olvidar' || resultado.startsWith('cerrado')) return
    let accion = '', revision = false
    const fechaActiva = reagenda && reagenda > fecha ? reagenda : fecha
    const comparece = reagenda && reagenda > fecha ? asistenciaReagenda : asistencia
    if (fechaActiva >= hoy && precall !== 'hecho - link a call') {
      accion = 'Completar precall'; revision = true
    } else if (fechaActiva <= hoy && !comparece) {
      accion = 'Confirmar asistencia'; revision = fechaActiva === hoy
    } else if (fechaActiva <= hoy && comparece === 'no' && !['no hacer', 's5', 'olvidar'].includes(noShow)) {
      accion = `Revisar seguimiento de ausencia${noShow ? ` · ${texto(r[18])}` : ''}`; revision = true
    } else if (fechaActiva <= hoy && comparece === 'si' && !resultado) {
      accion = 'Registrar resultado de la llamada'
    } else if (fechaActiva <= hoy && ['hacer', 's1', 's2', 's3', 's4'].includes(post)) {
      accion = `Revisar seguimiento postcall · ${texto(r[22])}`; revision = true
    } else if (/^s[1-5]$/.test(asistencia)) {
      accion = 'Revisar columnas heredadas'; revision = true
    }
    if (accion) pendientes.push({ id: `${pestana}:${i + 2}`, pestana, fila: i + 2, nombre, telefono: texto(r[1]), fecha: fechaActiva, accion, atrasado: fechaActiva < hoy, revision })
  })
  return pendientes.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))
}
