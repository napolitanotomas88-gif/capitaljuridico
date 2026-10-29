// ── Modelo de la planilla de Accesos (parte pura: se prueba sin red) ────────────────────────────────────────
// Hoja "Accesos", fila 1 = encabezados. Columnas:
//   A Email · B Nombre · C Tipo (admin | acceso) · D Secciones (separadas por coma) · E Pestañas del CRM (por coma) ·
//   F Activo (sí | no) · G Agregó · H Fecha
// Se borra "quitando" (Activo = no): queda el rastro. La hoja "Historial" registra cada alta, cambio y baja.
import { normalizarEmail } from './usuarios'
import { SECCIONES_ASIGNABLES, type Seccion } from './roles'
import { PESTANAS_VENTAS } from '../ventas/pendientes'

export const ENCABEZADOS = ['Email', 'Nombre', 'Tipo', 'Secciones', 'Pestañas CRM', 'Activo', 'Agregó', 'Fecha'] as const
export const ENCABEZADOS_HISTORIAL = ['Fecha', 'Quién', 'Acción', 'Mail', 'Detalle'] as const

export type TipoAcceso = 'admin' | 'acceso'
export type FilaAcceso = {
  email: string
  nombre: string
  tipo: TipoAcceso
  secciones: Seccion[]
  pestanas: string[]
  activo: boolean
  agrego: string
  fecha: string
}

const lista = (v: unknown) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/** Lee una fila de la planilla. Devuelve null si no sirve (mail inválido, tipo desconocido…): esa fila no da acceso a nadie. */
export function leerFila(celdas: readonly unknown[]): FilaAcceso | null {
  const email = normalizarEmail(celdas[0])
  const nombre = String(celdas[1] ?? '').trim()
  const tipo = String(celdas[2] ?? '').trim().toLowerCase()
  if (!email || !nombre || nombre.length > 80 || (tipo !== 'admin' && tipo !== 'acceso')) return null
  const secciones = lista(celdas[3]).filter((s): s is Seccion => (SECCIONES_ASIGNABLES as readonly string[]).includes(s))
  const pestanas = lista(celdas[4]).filter((p) => (PESTANAS_VENTAS as readonly string[]).includes(p))
  const activo = String(celdas[5] ?? '').trim().toLowerCase() === 'sí' || String(celdas[5] ?? '').trim().toLowerCase() === 'si'
  return { email, nombre, tipo, secciones, pestanas, activo, agrego: String(celdas[6] ?? ''), fecha: String(celdas[7] ?? '') }
}

/** Fila válida con su número real en la planilla (fila 1 = encabezados) */
export type FilaNumerada = FilaAcceso & { fila: number }

/**
 * Lee el rango A2:H. Las filas que no sirven (vacías, mail inválido, tipo mal escrito…) se descartan, pero cada una
 * conserva su número real: guardar y quitar escriben en esa fila, no en la posición dentro de la lista ya filtrada
 * (si no, con una fila vacía arriba la baja caía en otra fila, decía "Acceso quitado" y la persona seguía entrando).
 */
export function leerFilasNumeradas(valores: readonly (readonly unknown[])[]): FilaNumerada[] {
  return valores.flatMap((celdas, i) => {
    const f = leerFila(celdas)
    return f ? [{ ...f, fila: i + 2 }] : []
  })
}

/** La fila que manda para un mail (si está repetido, la última válida), o null si no está */
export const ultimaFilaDe = (filas: readonly FilaNumerada[], email: string): FilaNumerada | null =>
  filas.findLast((f) => f.email === email) ?? null

export function aCeldas(f: FilaAcceso): string[] {
  return [f.email, f.nombre, f.tipo, f.secciones.join(', '), f.pestanas.join(', '), f.activo ? 'sí' : 'no', f.agrego, f.fecha]
}

export type EntradaAcceso = { email?: unknown; nombre?: unknown; tipo?: unknown; secciones?: unknown; pestanas?: unknown }

/**
 * Valida lo que manda el formulario de Configuración. "acceso" necesita al menos una sección; si incluye Ventas puede
 * llevar pestañas del CRM (sin ellas ve el aviso de "sin CRM asignado"). "admin" ignora secciones y pestañas (ve todo).
 */
export function validarEntrada(e: EntradaAcceso): { ok: true; datos: Pick<FilaAcceso, 'email' | 'nombre' | 'tipo' | 'secciones' | 'pestanas'> } | { ok: false; error: string } {
  const email = normalizarEmail(e.email)
  if (!email) return { ok: false, error: 'El mail no es válido (usá el de Google de la persona, sin espacios).' }
  const nombre = String(e.nombre ?? '').trim().replace(/\s+/g, ' ')
  if (!nombre) return { ok: false, error: 'Falta el nombre.' }
  if (nombre.length > 80) return { ok: false, error: 'El nombre es demasiado largo.' }
  if (e.tipo !== 'admin' && e.tipo !== 'acceso') return { ok: false, error: 'Elegí el tipo de acceso.' }
  if (e.tipo === 'admin') return { ok: true, datos: { email, nombre, tipo: 'admin', secciones: [], pestanas: [] } }
  const pedidas = Array.isArray(e.secciones) ? e.secciones.map(String) : []
  const secciones = SECCIONES_ASIGNABLES.filter((s) => pedidas.includes(s))
  if (!secciones.length) return { ok: false, error: 'Marcá al menos una sección para que pueda ver.' }
  const pestanasPedidas = Array.isArray(e.pestanas) ? e.pestanas.map(String) : []
  const pestanas = secciones.includes('ventas') ? (PESTANAS_VENTAS as readonly string[]).filter((p) => pestanasPedidas.includes(p)) : []
  return { ok: true, datos: { email, nombre, tipo: 'acceso', secciones, pestanas } }
}
