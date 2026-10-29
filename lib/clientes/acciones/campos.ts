// ── Campos del CRM editables desde la tarjeta (acción 'datos') — puro, sin red ───────────────────────────────────────────
// Pedido de Tomás (27/10/2026): "en la tarjeta poder modificar todo del cliente". Lista blanca sobre la fila de Agencia:
// quedan afuera las columnas que son fórmula (Fin período, Renovó, LTV, Duración), el ID y el Estado (el Estado cambia solo
// por acciones con reglas: pausar/reanudar y, más adelante, archivar). Los precios viven en Renovaciones (acción aparte).
import { esYmdValido, type Ymd } from '../fechas'
import type { Cliente } from '../tipos'
import type { CambioPlan, CampoEditable, ClaveCampo, CuerpoDatos } from './tipos'
import { leerCatalogoCsm } from './csmConfig'

interface Definicion { etiqueta: string; tipo: CampoEditable['tipo']; columna: string; opciones?: string[]; max?: number; soloFinanzas?: boolean }

/** Clave → cómo se edita. `columna` es el encabezado de la planilla (la escritura resuelve la letra por encabezado). */
export const CAMPOS: Record<ClaveCampo, Definicion> = {
  nombre:          { etiqueta: 'Nombre', tipo: 'texto', columna: 'Nombre (columna B)', max: 120 },
  estudio:         { etiqueta: 'Estudio', tipo: 'texto', columna: 'Estudio', max: 160 },
  csm:             { etiqueta: 'CSM', tipo: 'opcion', columna: 'CSM', opciones: [''], max: 80 },
  ciudad:          { etiqueta: 'Ciudad', tipo: 'texto', columna: 'Ciudad', max: 120 },
  celular:         { etiqueta: 'Celular', tipo: 'texto', columna: 'Celular', max: 40 },
  mail:            { etiqueta: 'Mail', tipo: 'texto', columna: 'Mail', max: 120 },
  closer:          { etiqueta: 'Closer', tipo: 'texto', columna: 'Closer', max: 60 },
  fuente:          { etiqueta: 'Fuente', tipo: 'texto', columna: 'Fuente', max: 60 },
  contrato:        { etiqueta: 'Contrato', tipo: 'texto', columna: 'Contrato', max: 300 },
  dia1:            { etiqueta: 'Día 1', tipo: 'fecha', columna: 'Día 1' },
  promesa:         { etiqueta: 'Promesa cumplida', tipo: 'opcion', columna: 'Promesa', opciones: ['Sí', 'Parcial', 'No', ''] },
  satisfaccion:    { etiqueta: 'Satisfacción (1–10)', tipo: 'numero', columna: 'Satisfacción' },
  testimonio:      { etiqueta: 'Testimonio', tipo: 'texto', columna: 'Testimonio', max: 300 },
  gameplan:        { etiqueta: 'Gameplan', tipo: 'textoLargo', columna: 'Gameplan', max: 2000 },
  notasRenov:      { etiqueta: 'Notas de renovación', tipo: 'textoLargo', columna: 'Notas renovación', max: 2000 },
  anotaciones:     { etiqueta: 'Anotaciones', tipo: 'textoLargo', columna: 'Anotaciones', max: 2000 },
  llamadaAgendada: { etiqueta: 'Llamada agendada', tipo: 'texto', columna: 'Llamada agendada', max: 120 },
  proximoCobro:    { etiqueta: 'Próximo cobro', tipo: 'fecha', columna: 'Próximo cobro', soloFinanzas: true },
  fechaBaja:       { etiqueta: 'Fecha de baja', tipo: 'fecha', columna: 'Fecha de baja' },
}
export const CLAVES_CAMPO = Object.keys(CAMPOS) as ClaveCampo[]
export const esClaveCampo = (v: unknown): v is ClaveCampo => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CAMPOS, v)
export const MAX_CAMBIOS = 20

const valorActual = (c: Cliente, k: ClaveCampo): string => {
  const v = c[k]
  return v === null || v === undefined ? '' : String(v)
}

/** Los campos con su valor actual, para la pantalla. Sin Finanzas no aparecen los de montos o cobros. */
export function camposDe(c: Cliente, conFinanzas: boolean, opcionesCsm: readonly string[] = []): CampoEditable[] {
  const catalogo = leerCatalogoCsm()
  return CLAVES_CAMPO.filter(k => conFinanzas || !CAMPOS[k].soloFinanzas).map(k => {
    const d = CAMPOS[k]
    const actual = valorActual(c, k)
    const opciones = k === 'csm' ? [...new Set(['', ...opcionesCsm, ...(actual ? [actual] : [])])] : d.opciones
    const aviso = k === 'csm' && !opcionesCsm.length ? 'No hay responsables CSM activos en el catálogo de equipo. Podés conservar o quitar la asignación actual.' : k === 'csm' && actual && !opcionesCsm.includes(actual) ? 'La asignación actual ya no está en el roster CSM; podés conservarla, quitarla o elegir una vigente.' : undefined
    return { campo: k, etiqueta: d.etiqueta, tipo: d.tipo, valor: actual, hoja: c.linea === 'agencia' ? 'Agencia' : 'Consultora', columna: d.columna, ...(opciones ? { opciones } : {}), ...(d.max ? { max: d.max } : {}), soloFinanzas: !!d.soloFinanzas, ...(aviso ? { aviso } : {}), ...(k === 'csm' ? { fuenteOpciones: { fuente: catalogo.fuente, version: catalogo.version } } : {}) }
  })
}

/** Normaliza y valida un valor según el tipo del campo. Devuelve el valor limpio o { error }. */
export function validarValor(k: ClaveCampo, crudo: unknown, opcionesCsm: readonly string[] = []): string | { error: string } {
  const d = CAMPOS[k]
  if (typeof crudo !== 'string') return { error: `${d.etiqueta}: el valor tiene que ser texto.` }
  const v = d.tipo === 'textoLargo' ? crudo.trim() : crudo.replace(/\s+/g, ' ').trim()
  if (d.max && v.length > d.max) return { error: `${d.etiqueta}: máximo ${d.max} caracteres.` }
  // Un "=" adelante la planilla lo toma como fórmula (los textos se escribirán en RAW, pero esto se rechaza igual)
  if (v.startsWith('=')) return { error: `${d.etiqueta}: no puede empezar con "=".` }
  switch (d.tipo) {
    case 'fecha':
      if (v === '' || esYmdValido(v)) return v
      return { error: `${d.etiqueta}: tiene que ser una fecha real (AAAA-MM-DD) o vacío.` }
    case 'numero': {
      if (v === '') return v
      const n = Number(v.replace(',', '.'))
      if (!Number.isFinite(n) || n < 1 || n > 10) return { error: `${d.etiqueta}: un número del 1 al 10 o vacío.` }
      return String(n)
    }
    case 'opcion':
      if (k === 'csm') return v === '' || opcionesCsm.includes(v) ? v : { error: 'CSM: elegí un responsable vigente del roster o dejalo sin asignar.' }
      return d.opciones!.includes(v) ? v : { error: `${d.etiqueta}: tiene que ser una de ${d.opciones!.filter(Boolean).join(', ')} o vacío.` }
    default:
      if (k === 'nombre' && !v) return { error: 'El nombre no puede quedar vacío.' }
      return v
  }
}

export interface PlanDatos { plan: CambioPlan[]; resumen: string; cambios: { campo: ClaveCampo; antes: string; despues: string }[] }

/** Plan de la acción 'datos'. Ignora los campos que no cambian; si ninguno cambia, rechaza. */
export function planDatos(c: Cliente, b: CuerpoDatos, conFinanzas: boolean, opcionesCsm: readonly string[] = []): PlanDatos | string {
  if (!Array.isArray(b.cambios) || !b.cambios.length) return 'No hay cambios.'
  if (b.cambios.length > MAX_CAMBIOS) return `Como máximo ${MAX_CAMBIOS} campos por vez.`
  const vistos = new Set<string>()
  const cambios: PlanDatos['cambios'] = []
  for (const x of b.cambios) {
    if (!esClaveCampo(x?.campo)) return `Campo no editable: ${String(x?.campo).slice(0, 40)}.`
    if (vistos.has(x.campo)) return `${CAMPOS[x.campo].etiqueta} aparece dos veces.`
    vistos.add(x.campo)
    if (CAMPOS[x.campo].soloFinanzas && !conFinanzas) return `${CAMPOS[x.campo].etiqueta} solo lo cambia quien tiene Finanzas.`
    const antes = valorActual(c, x.campo)
    if (x.campo === 'csm' && x.valor === antes) continue
    const v = validarValor(x.campo, x.valor, opcionesCsm)
    if (typeof v !== 'string') return v.error
    if (antes !== v) cambios.push({ campo: x.campo, antes, despues: v as Ymd | string })
  }
  if (!cambios.length) return 'Ningún campo cambia.'
  const hoja = `${c.linea === 'agencia' ? 'Agencia' : 'Consultora'} · fila ${c.fila}`
  return {
    cambios,
    plan: cambios.map(x => ({ hoja, celda: CAMPOS[x.campo].columna, antes: x.antes, despues: x.despues })),
    resumen: `Editar ${cambios.map(x => CAMPOS[x.campo].etiqueta).join(', ')}`,
  }
}
