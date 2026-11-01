// Reglas puras del ALTA de líneas de Pagos del equipo y del CIERRE DE MES. No consulta la base: recibe las filas ya leídas.
// - Una línea nueva (creada en la web) guarda: persona, puesto (rol), departamento (área), honorarios, bonus, comisión, total, estado y "pagado por".
// - El "tipo de remuneración" se deduce de qué importes se completan (honorarios, bonus y/o comisión); no se guarda aparte.
// - total_usd = honorarios + bonus + comisión (igual que en las líneas importadas).
// - Evita duplicar: no admite una segunda comisión para la misma persona y mes, y pide confirmar cualquier otra línea adicional del mismo mes.
// - Las personas inactivas no se pueden elegir para cargar líneas nuevas (su historial se conserva).
// Nada de esto toca las líneas importadas ni recalcula Payroll histórico.

export const OPCIONES_PAGADO_POR = ['Financiera', 'Tomi', 'Gero', 'Otro']
export const MONEDA_NUEVAS = 'USD'

// Importes siempre en centavos enteros para no arrastrar errores de coma flotante
const aC = (v) => {
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  if (!Number.isFinite(n)) return NaN
  const r = Math.round(Math.abs(n) * 100 + 1e-7)
  return n < 0 ? -r : r
}
const deC = (c) => c / 100
const usd = (c) => '$' + deC(c).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** '2026-10' -> '2026-10-01' (la columna mes guarda el primer día del mes). null si el formato no es válido. */
export const mesAFecha = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) ? `${m}-01` : null)
export const mesDe = (fecha) => String(fecha ?? '').slice(0, 7)
export const mesAnterior = (m) => {
  let y = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7)) - 1
  if (mm < 1) { mm = 12; y-- }
  return `${y}-${String(mm).padStart(2, '0')}`
}

export const totalCentavos = (f) => aC(f.honorarios_base) + aC(f.bonuses) + aC(f.comision)
export const totalDe = (f) => deC(totalCentavos(f))

/** Tipo de remuneración según los importes completados. */
export function tipoRemuneracion(f) {
  const partes = []
  if (aC(f.honorarios_base) > 0) partes.push('Honorarios')
  if (aC(f.bonuses) > 0) partes.push('Bonus')
  if (aC(f.comision) > 0) partes.push('Comisión')
  return partes.length ? partes.join(' + ') : '—'
}

/**
 * Valida una línea nueva o editada.
 * `f`: { persona_id, mes:'YYYY-MM', puesto, departamento, honorarios_base, bonuses, comision, pagado, pagado_por, nota, confirmaAdicional }
 * `ctx`: { personas, lineas (pagos_equipo_vigentes), editandoId }
 * Devuelve { errores, existentes, total }. Si `errores` no está vacío, NO se debe guardar.
 */
export function validarLinea(f, { personas = [], lineas = [], editandoId = null } = {}) {
  const errores = []
  const persona = personas.find((p) => String(p.id) === String(f.persona_id))
  if (!persona) errores.push('Elegí una persona.')
  else if (!persona.activo && !f.permitirInactiva) errores.push(`${persona.nombre} está inactiva: no se pueden cargar pagos nuevos para una persona inactiva.`)
  if (!mesAFecha(f.mes)) errores.push('Elegí el mes (período) de la línea.')
  const importes = [['honorarios', f.honorarios_base], ['bonus', f.bonuses], ['comisión', f.comision]]
  for (const [nombre, v] of importes) {
    const c = aC(v)
    if (Number.isNaN(c)) errores.push(`El importe de ${nombre} no es un número válido.`)
    else if (c < 0) errores.push(`El importe de ${nombre} no puede ser negativo.`)
  }
  const total = totalCentavos(f)
  if (!Number.isNaN(total) && total <= 0) errores.push('El total debe ser mayor que 0: completá honorarios, bonus o comisión.')
  if (f.pagado_por && !OPCIONES_PAGADO_POR.includes(f.pagado_por)) errores.push('«Pagado por» no es una opción válida.')

  let existentes = []
  if (persona && mesAFecha(f.mes)) {
    existentes = lineas.filter((l) => String(l.persona_id) === String(persona.id) && mesDe(l.mes) === f.mes && l.id !== editandoId)
    if (aC(f.comision) > 0 && existentes.some((l) => Number(l.comision) > 0)) {
      errores.push(`Ya hay una comisión registrada para ${persona.nombre} en ${f.mes}: no se carga otra para no duplicarla. Si hay que ajustarla, usá «Corregir» sobre esa línea.`)
    } else if (existentes.length && !f.confirmaAdicional) {
      const t = existentes.reduce((s, l) => s + aC(l.total_usd), 0)
      errores.push(`Ya existe ${existentes.length === 1 ? 'una línea' : `${existentes.length} líneas`} de ${persona.nombre} en ${f.mes} (total ${usd(t)}). Si querés cargar otra igualmente (por ejemplo un ajuste), marcá «Es una línea adicional».`)
    }
  }
  return { errores, existentes, total: Number.isNaN(total) ? 0 : deC(total) }
}

/**
 * ¿Se puede guardar la comisión que figura en el formulario? Devuelve el motivo (texto) si NO se puede, o null si sí.
 * Regla: una comisión mayor que 0 solo se guarda si la propuesta automática está calculada y NO está bloqueada (ni por ambigüedad de alias,
 * ni por exclusión de Gero/Tomi, ni por datos dudosos). Una línea sin comisión (por ejemplo solo honorarios) nunca depende de la propuesta.
 * `estado`: 'inactivo' (falta persona o mes) | 'cargando' | 'error' | 'listo'.
 */
export function motivoBloqueoComision({ comision, propuesta, estado }) {
  const c = aC(comision)
  if (!(c > 0)) return null // sin comisión no hay nada que comprobar
  if (estado === 'inactivo') return null // lo informa la validación de persona / mes
  if (estado === 'cargando') return 'Esperá a que termine el cálculo de la comisión con los pagos del mes antes de guardar.'
  if (estado !== 'listo' || !propuesta) return 'No se pudo calcular la propuesta de comisión con los pagos del mes, así que no se puede guardar una comisión sin comprobarla. Probá «Actualizar pagos» o dejá la comisión en 0.'
  if (propuesta.bloqueada) return `La propuesta de comisión está bloqueada: ${propuesta.motivoBloqueo} No se puede guardar una comisión hasta resolverlo; podés guardar la línea con la comisión en 0.`
  return null
}

/** Arma las columnas a insertar/actualizar en pagos_equipo para una línea nueva. No lleva marca de importación: son líneas creadas en la web. */
export function armarLinea(f, persona) {
  const texto = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())
  return {
    persona_id: persona.id,
    mes: mesAFecha(f.mes),
    nombre_original: persona.nombre,
    puesto: texto(f.puesto),
    departamento: texto(f.departamento),
    honorarios_base: deC(aC(f.honorarios_base)),
    bonuses: deC(aC(f.bonuses)),
    comision: deC(aC(f.comision)),
    total_usd: deC(totalCentavos(f)),
    moneda: MONEDA_NUEVAS,
    pagado: !!f.pagado,
    pagado_por: texto(f.pagado_por),
    nota: texto(f.nota),
  }
}

/**
 * Cierre de mes: cuánto corresponde pagar a cada persona en `mes` ('YYYY-MM'), sumando todas sus líneas del mes.
 * Incluye a las personas activas SIN línea en ese mes (para que se vea quién falta cargar).
 */
export function cierreDeMes(lineas, personas, mes) {
  const delMes = lineas.filter((l) => mesDe(l.mes) === mes)
  const porPersona = new Map()
  for (const l of delMes) {
    const clave = l.persona_id ?? `nombre:${l.nombre_original}`
    const p = personas.find((x) => x.id === l.persona_id)
    if (!porPersona.has(clave)) porPersona.set(clave, { persona_id: l.persona_id ?? null, nombre: p?.nombre ?? l.nombre_original, activo: p ? p.activo : null, puesto: l.puesto ?? p?.puesto ?? null, departamento: l.departamento ?? p?.departamento ?? null, lineas: 0, h: 0, b: 0, c: 0, t: 0, pagado: 0, pendiente: 0 })
    const f = porPersona.get(clave)
    f.lineas++
    f.h += aC(l.honorarios_base); f.b += aC(l.bonuses); f.c += aC(l.comision)
    const t = aC(l.total_usd)
    f.t += t
    if (l.pagado) f.pagado += t; else f.pendiente += t
  }
  const filas = [...porPersona.values()].map((f) => ({ persona_id: f.persona_id, nombre: f.nombre, activo: f.activo, puesto: f.puesto, departamento: f.departamento, lineas: f.lineas, honorarios: deC(f.h), bonus: deC(f.b), comision: deC(f.c), total: deC(f.t), pagado: deC(f.pagado), pendiente: deC(f.pendiente) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  const conLinea = new Set(filas.map((f) => f.persona_id).filter((x) => x !== null))
  const sinLinea = personas.filter((p) => p.activo && !conLinea.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre))
  const suma = (k) => deC(filas.reduce((s, f) => s + aC(f[k]), 0))
  return { mes, filas, sinLinea, totales: { lineas: delMes.length, honorarios: suma('honorarios'), bonus: suma('bonus'), comision: suma('comision'), total: suma('total'), pagado: suma('pagado'), pendiente: suma('pendiente') } }
}
