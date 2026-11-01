// Reglas puras del PERFIL de una persona del equipo (alta y edición). No consulta la base: recibe las filas ya leídas.
// - Nombre y apellido obligatorio y único (la base tiene una restricción de nombre único).
// - Rol (puesto), área (departamento), otros nombres (apodos) y notas son editables en cualquier momento.
// - Los apodos son los nombres con los que la persona figura en Pagos (closer / setter): se usan para asignarle comisiones sin adivinar.
//   Por eso un alias no puede repetirse entre dos personas, y Gero / Tomi no pueden usarse como alias (están excluidos de las comisiones).
// - Una persona nunca se borra: se la marca Inactiva y su historial de pagos se conserva.
import { aliasDe, norm, REGLAS_COMISION } from './calculoComisiones.js'

export const textoONulo = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())

/** Normaliza el formulario a las columnas de `personas` (sin tocar `activo`). */
export function armarPersona(f) {
  const apodos = String(f.apodos ?? '').split(/[;,\n]/).map((x) => x.trim()).filter(Boolean)
  return {
    nombre: String(f.nombre ?? '').trim().replace(/\s+/g, ' '),
    puesto: textoONulo(f.puesto),
    departamento: textoONulo(f.departamento),
    apodos: apodos.length ? [...new Set(apodos)].join(', ') : null,
    notas: textoONulo(f.notas),
  }
}

/** Devuelve { errores } para un alta (editandoId = null) o una edición. `personas` son todas las personas actuales. */
export function validarPersona(f, personas = [], editandoId = null) {
  const errores = []
  const d = armarPersona(f)
  if (!d.nombre) errores.push('El nombre y apellido es obligatorio.')
  const otras = personas.filter((p) => p.id !== editandoId)
  if (d.nombre && otras.some((p) => norm(p.nombre) === norm(d.nombre))) errores.push(`Ya existe una persona llamada «${d.nombre}».`)
  const propios = aliasDe({ nombre: d.nombre, apodos: d.apodos })
  const excluidos = propios.filter((a) => REGLAS_COMISION.excluidos.includes(a))
  if (excluidos.length) errores.push(`«${excluidos.join('», «')}» no se puede usar como nombre ni como alias: Gero y Tomi están excluidos de las comisiones.`)
  const nombreRepetido = d.nombre && otras.some((p) => norm(p.nombre) === norm(d.nombre))
  const choques = propios.filter((a) => !(nombreRepetido && a === norm(d.nombre)) && otras.some((p) => aliasDe(p).includes(a))) // el nombre repetido ya se informó arriba
  if (choques.length) errores.push(`El alias «${choques.join('», «')}» ya lo usa otra persona: cada nombre de Pagos debe pertenecer a una sola persona.`)
  return { errores, datos: d }
}

// ==================================================================================================================
// DATOS SENSIBLES CONSOLIDADOS POR PERSONA (solo para MOSTRAR; no escribe nada y no elige ningún valor por su cuenta)
// Hoy el dato sensible vive por línea mensual (pagos_equipo_sensibles, una fila por línea). Para la ficha de la persona se juntan todos los
// valores de cada campo:
//   - un único valor (comparado sin mayúsculas, espacios, guiones ni signos)  -> se muestra una sola vez, con los meses donde figura;
//   - valores distintos                                                       -> se muestran TODOS con sus meses y se marca «revisar»;
//   - ningún valor                                                            -> sin datos.
// Nunca se descarta un valor ni se decide cuál es el correcto. El detalle mes por mes sigue disponible en la pantalla.
// ==================================================================================================================
export const CAMPOS_SENSIBLES = [
  ['cuil_cuit', 'CUIL/CUIT'],
  ['telefono', 'Teléfono'],
  ['direccion_pago_ars', 'Dirección de pago ARS'],
  ['direccion_pago_usd', 'Dirección de pago USD'],
]
// Clave de comparación: minúsculas y solo letras y números (si no queda nada, se usa el texto tal cual para no mezclar valores distintos)
const claveSensible = (v) => {
  const t = String(v).trim().toLowerCase()
  const k = t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^0-9a-z]/g, '')
  return k || t
}
const mesCorto = (m) => String(m ?? '').slice(0, 7)

/**
 * @param {{id:number, mes:string}[]} lineas  líneas mensuales de UNA persona
 * @param {object[]} sens                     filas de pagos_equipo_sensibles (pago_equipo_id + 4 campos)
 * @returns {{campo:string, etiqueta:string, estado:'sin_datos'|'unico'|'varios', mesesConDato:string[], valores:object[]}[]}
 *   valores: [{ valor, meses (más reciente primero), variantes (escrituras distintas del mismo valor), masReciente }] ordenados con el más reciente primero.
 */
export function consolidarSensibles(lineas = [], sens = []) {
  const mesDeLinea = new Map(lineas.map((l) => [l.id, mesCorto(l.mes)]))
  return CAMPOS_SENSIBLES.map(([campo, etiqueta]) => {
    const grupos = new Map() // clave -> { escrituras: Map(texto -> mesesDondeSeEscribioAsi), meses:Set }
    const mesesConDato = new Set()
    for (const s of sens) {
      const mes = mesDeLinea.get(s.pago_equipo_id)
      const v = s[campo]
      if (!mes || v === null || v === undefined || String(v).trim() === '') continue
      const texto = String(v).trim()
      const k = claveSensible(texto)
      if (!grupos.has(k)) grupos.set(k, { escrituras: new Map(), meses: new Set() })
      const g = grupos.get(k)
      g.meses.add(mes)
      g.escrituras.set(texto, [...(g.escrituras.get(texto) || []), mes])
      mesesConDato.add(mes)
    }
    const valores = [...grupos.values()].map((g) => {
      const meses = [...g.meses].sort().reverse()
      // Se muestra la escritura del mes más reciente; las demás escrituras del mismo valor quedan en `variantes`
      const escrituras = [...g.escrituras.entries()].map(([texto, ms]) => ({ texto, ultimo: [...ms].sort().reverse()[0] })).sort((a, b) => (a.ultimo < b.ultimo ? 1 : a.ultimo > b.ultimo ? -1 : a.texto.localeCompare(b.texto)))
      return { valor: escrituras[0].texto, meses, variantes: escrituras.map((e) => e.texto), masReciente: false }
    }).sort((a, b) => (a.meses[0] < b.meses[0] ? 1 : a.meses[0] > b.meses[0] ? -1 : a.valor.localeCompare(b.valor)))
    if (valores.length > 1) valores[0].masReciente = true
    return { campo, etiqueta, estado: valores.length === 0 ? 'sin_datos' : valores.length === 1 ? 'unico' : 'varios', mesesConDato: [...mesesConDato].sort(), valores }
  })
}

/** Texto de una lista de meses 'YYYY-MM': «2026-03», «2026-01, 2026-03» o, si son 4 o más SEGUIDOS, «2026-01 a 2026-06 (6 meses)». Con huecos lista todos. */
export function textoMeses(meses = []) {
  const m = [...new Set(meses)].sort()
  if (m.length === 0) return ''
  const idx = (s) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7))
  const seguidos = m.every((x, i) => i === 0 || idx(x) === idx(m[i - 1]) + 1)
  if (m.length <= 3 || !seguidos) return m.join(', ')
  return `${m[0]} a ${m[m.length - 1]} (${m.length} meses)`
}

// ==================================================================================================================
// DATOS SENSIBLES PERMANENTES (tabla personas_sensibles). Solo para MOSTRAR: no escribe nada ni resuelve ningún pendiente.
//   - La base entrega estos datos únicamente a los correos de la lista de autorizados (RLS). A cualquier otro usuario le devuelve
//     0 filas SIN error; por eso la autorización se deduce del sondeo y, ante cualquier duda, se considera NO autorizado.
//   - Un campo con valor permanente se muestra tal cual (enmascarado en la pantalla).
//   - Un campo pendiente se muestra como «Pendiente de revisión» con su motivo, y se listan como referencia los valores históricos
//     candidatos. No se elige ninguno y no hay ninguna acción que los resuelva (las discrepancias de direcciones siguen abiertas).
// ==================================================================================================================

/** true SOLO si el sondeo de personas_sensibles no falló y devolvió al menos una fila. Cualquier otra cosa: false (no autorizado). */
export function autorizacionDesdeSondeo(filas, error) {
  if (error) return false
  return Array.isArray(filas) && filas.length > 0
}

export const ETIQUETA_ORIGEN = {
  migracion: 'Migrado de los pagos históricos (solo valores sin discrepancias)',
  web: 'Cargado o editado desde la aplicación',
}
export const etiquetaOrigen = (o) => ETIQUETA_ORIGEN[o] ?? (o ? String(o) : '—')

/**
 * @param {{ autorizado: boolean|null, registro: object|null, consolidadoHistorico: object[] }} p
 *   autorizado: null = comprobando · true = confirmado · false = no autorizado o no confirmado
 *   registro: fila de personas_sensibles de la persona (o null si no tiene)
 *   consolidadoHistorico: resultado de consolidarSensibles() de esa persona
 * @returns {{ estado: 'comprobando'|'no_autorizado'|'sin_registro'|'con_registro', campos: object[], origen, nota, actualizadoPor, actualizadoEn }}
 *   campos[i].estado: 'completo' | 'pendiente' | 'vacio' | 'sin_registro'. Sin autorización confirmada NO se devuelve ningún valor.
 */
export function fichaPermanente({ autorizado = null, registro = null, consolidadoHistorico = [] } = {}) {
  if (autorizado !== true) {
    return { estado: autorizado === null ? 'comprobando' : 'no_autorizado', campos: [], origen: null, nota: null, actualizadoPor: null, actualizadoEn: null }
  }
  const pend = registro && registro.pendientes && typeof registro.pendientes === 'object' && !Array.isArray(registro.pendientes) ? registro.pendientes : {}
  const campos = CAMPOS_SENSIBLES.map(([campo, etiqueta]) => {
    if (!registro) return { campo, etiqueta, estado: 'sin_registro', valor: null, motivo: null, candidatos: [] }
    const valor = textoONulo(registro[campo])
    if (valor !== null) return { campo, etiqueta, estado: 'completo', valor, motivo: null, candidatos: [] }
    if (Object.prototype.hasOwnProperty.call(pend, campo)) {
      const h = consolidadoHistorico.find((x) => x.campo === campo)
      return { campo, etiqueta, estado: 'pendiente', valor: null, motivo: textoONulo(pend[campo]) ?? 'pendiente de revisión', candidatos: h ? h.valores : [] }
    }
    return { campo, etiqueta, estado: 'vacio', valor: null, motivo: null, candidatos: [] }
  })
  return {
    estado: registro ? 'con_registro' : 'sin_registro',
    campos,
    origen: registro?.origen ?? null,
    nota: registro?.nota_origen ?? null,
    actualizadoPor: registro?.actualizado_por ?? null,
    actualizadoEn: registro?.actualizado_en ?? null,
  }
}
