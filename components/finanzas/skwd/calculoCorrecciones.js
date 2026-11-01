// Motor de las Correcciones de datos originales. Funciones puras (no escriben nada).
// Reglas aprobadas (ver docs/correcciones.md):
//  - El original NUNCA se sobrescribe: las correcciones son registros aparte en la tabla `correcciones` (solo se agrega).
//  - Motivo obligatorio. Quién y cuándo los pone la base de datos. Todo se puede revertir al original.
//  - La base de datos es la autoridad de las validaciones; acá se replican para avisar antes de guardar.

export const MIN_MOTIVO = 5

// Campos corregibles (lista aprobada). tipo: fecha | mes | numero | texto | vocab. min: positivo | noNegativo | noCero
export const CATALOGO = {
  pagos: {
    nombre: 'Pagos',
    campos: {
      fecha: { label: 'Fecha', tipo: 'fecha' },
      monto_usd: { label: 'Monto USD (efectivo recaudado)', tipo: 'numero', min: 'positivo', dinero: true },
      pesos_ars: { label: 'Pesos ARS', tipo: 'numero', min: 'positivo' },
      cliente: { label: 'Cliente', tipo: 'texto' },
      programa: { label: 'Programa', tipo: 'texto' },
      closer: { label: 'Closer', tipo: 'texto' },
      setter: { label: 'Setter', tipo: 'texto' },
      concepto: { label: 'Concepto', tipo: 'texto' },
      fuente: { label: 'Fuente', tipo: 'texto' },
      tipo_venta: { label: 'Tipo de venta', tipo: 'vocab' },
      tipo_pago: { label: 'Tipo de pago', tipo: 'vocab' },
      comprobante: { label: 'Comprobante', tipo: 'texto' },
      comision: { label: 'Comisión (pasarela)', tipo: 'numero', min: 'noNegativo', dinero: true },
    },
  },
  gastos: {
    nombre: 'Gastos',
    campos: {
      fecha: { label: 'Fecha', tipo: 'fecha' },
      concepto: { label: 'Concepto', tipo: 'texto' },
      monto_usd: { label: 'Monto USD', tipo: 'numero', min: 'positivo', dinero: true },
      tipo: { label: 'Tipo de gasto', tipo: 'texto' },
      departamento: { label: 'Departamento', tipo: 'texto' },
      cuenta: { label: 'Banco / Cuenta', tipo: 'texto' },
    },
  },
  movimientos_cuenta: {
    nombre: 'Cuentas',
    campos: {
      fecha: { label: 'Fecha', tipo: 'fecha' },
      descripcion: { label: 'Descripción', tipo: 'texto' },
      monto: { label: 'Monto USD (con signo)', tipo: 'numero', min: 'noCero', dinero: true },
      tipo: { label: 'Tipo de movimiento', tipo: 'vocab' },
      de_quien_para_quien: { label: 'De quién / para quién', tipo: 'texto' },
    },
  },
  pagos_equipo: {
    nombre: 'Payroll (pagos del equipo)',
    campos: {
      mes: { label: 'Mes de liquidación', tipo: 'mes' },
      puesto: { label: 'Puesto', tipo: 'texto' },
      departamento: { label: 'Departamento', tipo: 'texto' },
      honorarios_base: { label: 'Honorarios base', tipo: 'numero', min: 'noNegativo', dinero: true },
      bonuses: { label: 'Bonuses', tipo: 'numero', min: 'noNegativo', dinero: true },
      comision: { label: 'Comisión', tipo: 'numero', min: 'noNegativo', dinero: true },
      total_usd: { label: 'Total USD', tipo: 'numero', min: 'noNegativo', dinero: true },
      moneda: { label: 'Moneda', tipo: 'vocab' },
    },
  },
}
export const TABLAS = Object.keys(CATALOGO)
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const vacio = (v) => v === null || v === undefined || String(v).trim() === ''
const fmt = (n) => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Texto legible de un valor según su campo. */
export function formatearValor(tabla, campo, v) {
  const def = CATALOGO[tabla]?.campos[campo]
  if (v === null || v === undefined) return '(vacío)'
  if (!def) return String(v)
  if (def.tipo === 'fecha') return String(v).split('-').reverse().join('/')
  if (def.tipo === 'mes') return String(v).slice(0, 7)
  if (def.tipo === 'numero') return def.dinero ? fmt(v) : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  return String(v)
}

/** Valor original de un campo en una fila de una vista "vigente" (valores_originales solo trae los campos corregidos). */
export const valorOriginal = (fila, campo) => (fila.valores_originales && campo in fila.valores_originales ? fila.valores_originales[campo] : fila[campo])
export const estaCorregido = (fila, campo) => !!(fila.correcciones && campo in fila.correcciones)
export const camposCorregidos = (fila) => Object.keys(fila.correcciones || {})

/** Normaliza lo que escribió el usuario según el tipo del campo (o devuelve un error). */
export function normalizarEntrada(tabla, campo, texto, vocabulario = []) {
  const def = CATALOGO[tabla]?.campos[campo]
  if (!def) return { error: 'Campo no corregible.' }
  const t = String(texto ?? '').trim()
  if (t === '') return { error: 'Ingresá el valor corregido.' }
  if (def.tipo === 'numero') {
    const n = Number(t.replace(',', '.'))
    if (!Number.isFinite(n)) return { error: 'El valor debe ser un número.' }
    return { valor: n }
  }
  if (def.tipo === 'fecha' || def.tipo === 'mes') {
    const f = def.tipo === 'mes' ? (t.length === 7 ? `${t}-01` : t) : t
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(`${f}T00:00:00Z`))) return { error: 'La fecha no es válida.' }
    return { valor: f }
  }
  if (def.tipo === 'vocab' && vocabulario.length && !vocabulario.includes(t)) return { error: `Valor no permitido. Valores válidos: ${vocabulario.join(', ')}.` }
  return { valor: t }
}

/** Replica en la pantalla las reglas de la base (la base es la autoridad). Devuelve lista de errores. */
export function validarCorreccion({ tabla, campo, valor, vigente, motivo }) {
  const errores = []
  const def = CATALOGO[tabla]?.campos[campo]
  if (!def) return ['Campo no corregible.']
  if (String(motivo || '').trim().length < MIN_MOTIVO) errores.push(`El motivo es obligatorio (mínimo ${MIN_MOTIVO} caracteres).`)
  if (valor === null || valor === undefined) { errores.push('Falta el valor corregido.'); return errores }
  if (def.tipo === 'numero') {
    if (def.min === 'positivo' && valor <= 0) errores.push('El monto debe ser mayor que 0.')
    if (def.min === 'noNegativo' && valor < 0) errores.push('Este importe no puede ser negativo.')
    if (def.min === 'noCero' && valor === 0) errores.push('El monto no puede ser 0.')
  }
  if ((def.tipo === 'fecha' || def.tipo === 'mes') && (String(valor) < '2000-01-01' || String(valor) > '2100-12-31')) errores.push('La fecha está fuera de rango.')
  if (def.tipo === 'mes' && String(valor).slice(8, 10) !== '01') errores.push('El mes de Payroll debe ser el día 1 del mes.')
  if (JSON.stringify(valor) === JSON.stringify(vigente) || (typeof valor === 'number' && Number(vigente) === valor)) errores.push('La corrección no cambia el valor vigente.')
  return errores
}

// ------------------------------------------------------------------------------------------------ historial
/** Anota cada evento: vigente | reemplazada | revertida | reversion. Devuelve un arreglo en el orden recibido. */
export function anotarEventos(eventos) {
  const grupos = new Map()
  for (const e of [...eventos].sort((a, b) => a.id - b.id)) {
    const k = `${e.tabla}|${e.registro_id}|${e.campo}`
    grupos.set(k, [...(grupos.get(k) || []), e])
  }
  const estado = new Map()
  for (const lista of grupos.values()) {
    let previas = []
    for (const e of lista) {
      if (e.tipo_evento === 'reversion') {
        previas.forEach((p) => estado.set(p.id, 'revertida'))
        estado.set(e.id, 'reversion')
        previas = []
      } else {
        previas.forEach((p) => estado.set(p.id, 'reemplazada'))
        estado.set(e.id, 'vigente')
        previas = [e]
      }
    }
  }
  return eventos.map((e) => ({ ...e, estado: estado.get(e.id) }))
}

/** Valor vigente de un campo según los eventos (el original si no hay o si la última fue una reversión). */
export function valorVigenteSegunEventos(original, eventosDelCampo) {
  const ult = [...eventosDelCampo].sort((a, b) => b.id - a.id)[0]
  return !ult ? original : ult.tipo_evento === 'reversion' ? original : ult.valor_nuevo
}

// ------------------------------------------------------------------------------------------------ conciliaciones
const CAMPOS_QUE_AFECTAN_CONCILIACION = {
  pagos: ['monto_usd', 'fecha', 'cliente'],
  gastos: ['monto_usd', 'fecha', 'concepto'],
  movimientos_cuenta: ['monto', 'fecha', 'descripcion'],
  pagos_equipo: ['total_usd', 'mes'],
}
/** Avisos si el registro ya está conciliado. NUNCA modifica la conciliación. */
export function avisosConciliacion({ tabla, fila, campo, conciliaciones = [], movimientos = [] }) {
  const relevante = CAMPOS_QUE_AFECTAN_CONCILIACION[tabla]?.includes(campo)
  const movInfo = (id) => { const m = movimientos.find((x) => x.id === id); return m ? `${m.descripcion} (${fmt(m.monto)})` : `movimiento #${id}` }
  let relacionadas = []
  if (tabla === 'pagos') relacionadas = conciliaciones.filter((c) => c.estado === 'conciliado' && c.destino_tipo === 'pago' && c.destino_id === fila.id)
  if (tabla === 'gastos') relacionadas = conciliaciones.filter((c) => c.estado === 'conciliado' && c.destino_tipo === 'gasto' && c.destino_id === fila.id)
  if (tabla === 'pagos_equipo') relacionadas = conciliaciones.filter((c) => c.estado === 'conciliado' && ((c.destino_tipo === 'payroll_linea' && c.destino_id === fila.id) || (c.destino_tipo === 'payroll_mes' && String(c.destino_mes).slice(0, 7) === String(fila.mes).slice(0, 7))))
  if (tabla === 'movimientos_cuenta') relacionadas = conciliaciones.filter((c) => c.movimiento_cuenta_id === fila.id)
  if (!relacionadas.length) return []
  const quien = (c) => (tabla === 'movimientos_cuenta' ? `decisión "${c.estado}"` : `conciliado con ${movInfo(c.movimiento_cuenta_id)}`)
  const base = relevante
    ? 'Este registro YA está conciliado y el campo que corregís puede cambiar si la coincidencia sigue siendo válida. La conciliación NO se modifica sola: revisala después en la pestaña Conciliación.'
    : 'Este registro está conciliado. Este campo no afecta la coincidencia, y la conciliación no se modifica.'
  return [{ relevante, texto: base, detalle: relacionadas.map(quien) }]
}

// ------------------------------------------------------------------------------------------------ vista previa del impacto
const mesDe = (s) => (s ? String(s).slice(0, 7) : null)
const sumar = (rows, f, filtro = () => true) => r2(rows.filter(filtro).reduce((s, x) => s + Number(f(x) || 0), 0))
const linea = (texto, antes, despues, formato = fmt) => ({ texto, antes: formato(antes), despues: formato(despues), delta: typeof antes === 'number' && typeof despues === 'number' ? r2(despues - antes) : null })
const TIPOS_PERSONALES = ['Gasto personal compartido', 'Gasto personal']

function clasificacionFeccu(p) {
  if (p.tipo_venta === 'Back-end') return 'BECC (Back-end)'
  if (p.tipo_venta === 'Front-end' && p.tipo_pago === 'Upfront') return 'FECCU (Front-end Upfront)'
  if (p.tipo_venta === 'Front-end' && p.tipo_pago === 'Payment Plan') return 'FECCP (Front-end Payment Plan)'
  return 'Sin clasificar'
}

function impactoPagos(fila, campo, nuevo, ctx) {
  const rows = ctx.filas
  const mes = mesDe(fila.fecha)
  const lineas = [], avisos = []
  const cashMes = (m, rs = rows) => sumar(rs, (x) => x.monto_usd, (x) => mesDe(x.fecha) === m)
  const sin = (t) => ({ lineas: [{ texto: t }], avisos })
  switch (campo) {
    case 'monto_usd':
      lineas.push(linea(`Cash collected de ${mes}`, cashMes(mes), r2(cashMes(mes) - fila.monto_usd + nuevo)))
      if (fila.fuente) lineas.push(linea(`… de la fuente ${fila.fuente} en ${mes}`, sumar(rows, (x) => x.monto_usd, (x) => mesDe(x.fecha) === mes && x.fuente === fila.fuente), r2(sumar(rows, (x) => x.monto_usd, (x) => mesDe(x.fecha) === mes && x.fuente === fila.fuente) - fila.monto_usd + nuevo)))
      if (fila.closer) lineas.push(linea(`Comisión teórica de ${fila.closer} en ${mes} (10% del cash)`, r2(sumar(rows, (x) => x.monto_usd, (x) => mesDe(x.fecha) === mes && x.closer === fila.closer) * 0.1), r2((sumar(rows, (x) => x.monto_usd, (x) => mesDe(x.fecha) === mes && x.closer === fila.closer) - fila.monto_usd + nuevo) * 0.1)))
      if (fila.pesos_ars && nuevo > 0) avisos.push(`Tipo de cambio implícito: ${(fila.pesos_ars / nuevo).toLocaleString('es-AR', { maximumFractionDigits: 1 })} ARS por USD (antes ${(fila.pesos_ars / fila.monto_usd).toLocaleString('es-AR', { maximumFractionDigits: 1 })}).`)
      break
    case 'fecha': {
      const m2 = mesDe(nuevo)
      if (m2 === mes) return sin(`El pago sigue en ${mes}: los totales mensuales no cambian.`)
      lineas.push(linea(`Cash collected de ${mes}`, cashMes(mes), r2(cashMes(mes) - fila.monto_usd)))
      lineas.push(linea(`Cash collected de ${m2}`, cashMes(m2), r2(cashMes(m2) + fila.monto_usd)))
      if (m2.slice(0, 4) !== mes.slice(0, 4)) avisos.push(`El pago cambia de año (${mes.slice(0, 4)} → ${m2.slice(0, 4)}).`)
      break
    }
    case 'pesos_ars': {
      const tcA = fila.pesos_ars ? fila.pesos_ars / fila.monto_usd : null, tcN = nuevo / fila.monto_usd
      lineas.push({ texto: 'Tipo de cambio implícito (ARS por USD)', antes: tcA === null ? '(sin pesos)' : tcA.toLocaleString('es-AR', { maximumFractionDigits: 1 }), despues: tcN.toLocaleString('es-AR', { maximumFractionDigits: 1 }) })
      lineas.push({ texto: 'El cash en USD no cambia.' })
      if (tcN < 900 || tcN > 2000) avisos.push('Ese tipo de cambio queda fuera del rango habitual (900 a 2.000): revisá el valor.')
      break
    }
    case 'tipo_venta':
    case 'tipo_pago': {
      const antes = clasificacionFeccu(fila), despues = clasificacionFeccu({ ...fila, [campo]: nuevo })
      if (antes === despues) return sin(`La clasificación FECCU/FECCP/BECC no cambia (${antes}).`)
      const cat = (c, rs) => sumar(rs, (x) => x.monto_usd, (x) => mesDe(x.fecha) === mes && clasificacionFeccu(x) === c)
      const rs2 = rows.map((x) => (x.id === fila.id ? { ...x, [campo]: nuevo } : x))
      lineas.push({ texto: `Este pago pasa de "${antes}" a "${despues}" en el Dashboard.` })
      lineas.push(linea(`${antes} de ${mes}`, cat(antes, rows), cat(antes, rs2)))
      lineas.push(linea(`${despues} de ${mes}`, cat(despues, rows), cat(despues, rs2)))
      break
    }
    case 'closer': case 'setter': case 'fuente': case 'concepto': {
      const a = fila[campo] ?? '(vacío)', b = nuevo
      const g = (v, rs) => sumar(rs, (x) => x.monto_usd, (x) => mesDe(x.fecha) === mes && (x[campo] ?? '(vacío)') === v)
      const rs2 = rows.map((x) => (x.id === fila.id ? { ...x, [campo]: nuevo } : x))
      lineas.push(linea(`Cash de ${campo} "${a}" en ${mes}`, g(a, rows), g(a, rs2)))
      lineas.push(linea(`Cash de ${campo} "${b}" en ${mes}`, g(b, rows), g(b, rs2)))
      if (campo === 'closer') avisos.push('Cambia la comisión teórica de closers (10% del cash de cada uno).')
      if (campo === 'setter' || campo === 'fuente' || campo === 'concepto') avisos.push('Puede cambiar la comisión teórica de setters (Mai / ENRU).')
      break
    }
    case 'comision':
      lineas.push(linea(`Comisiones de plataformas de ${mes}`, sumar(rows, (x) => x.comision, (x) => mesDe(x.fecha) === mes), r2(sumar(rows, (x) => x.comision, (x) => mesDe(x.fecha) === mes) - Number(fila.comision || 0) + nuevo)))
      break
    default:
      return sin('Sin impacto en los totales (dato descriptivo).')
  }
  return { lineas, avisos }
}

function impactoGastos(fila, campo, nuevo, ctx) {
  const rows = ctx.filas, mes = mesDe(fila.fecha), lineas = [], avisos = []
  const total = (m, rs = rows) => sumar(rs, (x) => x.monto_usd, (x) => mesDe(x.fecha) === m)
  const porTipo = (m, t, rs = rows) => sumar(rs, (x) => x.monto_usd, (x) => mesDe(x.fecha) === m && (x.tipo ?? '(sin tipo)') === t)
  switch (campo) {
    case 'monto_usd':
      lineas.push(linea(`Gastos (tabla Gastos) de ${mes}`, total(mes), r2(total(mes) - fila.monto_usd + nuevo)))
      lineas.push(linea(`… del tipo ${fila.tipo ?? '(sin tipo)'} en ${mes}`, porTipo(mes, fila.tipo ?? '(sin tipo)'), r2(porTipo(mes, fila.tipo ?? '(sin tipo)') - fila.monto_usd + nuevo)))
      avisos.push('Cambia el Beneficio neto de ese mes en el Estado de Resultados (cuando los módulos lean los valores vigentes).')
      break
    case 'fecha': {
      const m2 = mesDe(nuevo)
      if (m2 === mes) return { lineas: [{ texto: `El gasto sigue en ${mes}: los totales mensuales no cambian.` }], avisos }
      lineas.push(linea(`Gastos de ${mes}`, total(mes), r2(total(mes) - fila.monto_usd)))
      lineas.push(linea(`Gastos de ${m2}`, total(m2), r2(total(m2) + fila.monto_usd)))
      if (m2.slice(0, 4) !== mes.slice(0, 4)) avisos.push(`El gasto cambia de año (${mes.slice(0, 4)} → ${m2.slice(0, 4)}).`)
      break
    }
    case 'tipo': {
      const a = fila.tipo ?? '(sin tipo)'
      const rs2 = rows.map((x) => (x.id === fila.id ? { ...x, tipo: nuevo } : x))
      lineas.push(linea(`Línea "${a}" en ${mes} (Estado de Resultados)`, porTipo(mes, a), porTipo(mes, a, rs2)))
      lineas.push(linea(`Línea "${nuevo}" en ${mes}`, porTipo(mes, nuevo), porTipo(mes, nuevo, rs2)))
      lineas.push({ texto: 'El total de gastos del mes no cambia: el gasto se mueve de una línea a otra.' })
      break
    }
    default:
      return { lineas: [{ texto: 'Sin impacto en los totales del Estado de Resultados (dato descriptivo).' }], avisos }
  }
  return { lineas, avisos }
}

function impactoMovimientos(fila, campo, nuevo, ctx) {
  const rows = ctx.filas, lineas = [], avisos = []
  const periodo = (fila.periodo ?? fila.fecha ?? '').slice(0, 7) || null
  const empresa = (m) => !TIPOS_PERSONALES.includes(m.tipo) && !m.es_resumen
  const sumas = (per, rs) => {
    const e = rs.filter((m) => empresa(m) && (m.periodo ?? m.fecha ?? '').slice(0, 7) === per)
    const ing = sumar(e, (m) => m.monto, (m) => m.tipo === 'Ingreso empresa'), gas = sumar(e, (m) => m.monto, (m) => m.tipo === 'Gasto empresa'), inv = sumar(e, (m) => m.monto, (m) => m.tipo === 'Inversión empresa')
    return { ing, gas, inv, neto: r2(ing + gas + inv) }
  }
  const aplicar = (cambios) => rows.map((x) => (x.id === fila.id ? { ...x, ...cambios } : x))
  // coherencia de signo con el tipo
  const tipoFinal = campo === 'tipo' ? nuevo : fila.tipo, montoFinal = campo === 'monto' ? nuevo : Number(fila.monto)
  if (tipoFinal === 'Ingreso empresa' && montoFinal < 0) avisos.push('Un ingreso debería tener monto positivo.')
  if (['Gasto empresa', 'Inversión empresa', 'Gasto personal compartido', 'Gasto personal'].includes(tipoFinal) && montoFinal > 0) avisos.push('Un gasto o inversión debería tener monto negativo (sale dinero).')
  switch (campo) {
    case 'tipo': {
      const eraEmpresa = empresa(fila), seraEmpresa = !TIPOS_PERSONALES.includes(nuevo) && !fila.es_resumen
      if (eraEmpresa !== seraEmpresa) avisos.push(seraEmpresa ? 'Pasa de PERSONAL a EMPRESA: ENTRA en los cálculos empresariales (vista movimientos_cuenta_empresa).' : 'Pasa de EMPRESA a PERSONAL: SALE de los cálculos empresariales (vista movimientos_cuenta_empresa).')
      if (periodo) {
        const a = sumas(periodo, rows), b = sumas(periodo, aplicar({ tipo: nuevo }))
        lineas.push(linea(`Neto empresarial de Cuentas en ${periodo}`, a.neto, b.neto))
        if (a.inv !== b.inv) lineas.push(linea(`Inversiones (Estado de Resultados) en ${periodo}`, a.inv, b.inv))
      } else avisos.push('El movimiento no tiene período: no se puede calcular el impacto por mes.')
      if (fila.tipo === 'Transferencia de dinero' || nuevo === 'Transferencia de dinero') avisos.push('Las transferencias entre cuentas no son ingresos ni gastos.')
      break
    }
    case 'monto': {
      if (!periodo) { lineas.push({ texto: 'El movimiento no tiene período: el impacto no se asigna a ningún mes.' }); break }
      if (!empresa(fila)) { lineas.push({ texto: 'Es un movimiento personal o un resumen: no afecta los totales empresariales.' }); break }
      const a = sumas(periodo, rows), b = sumas(periodo, aplicar({ monto: nuevo }))
      lineas.push(linea(`Neto empresarial de Cuentas en ${periodo}`, a.neto, b.neto))
      if (fila.tipo === 'Inversión empresa') lineas.push(linea(`Inversiones (Estado de Resultados) en ${periodo}`, a.inv, b.inv))
      break
    }
    case 'fecha': {
      const m2 = mesDe(nuevo)
      if (fila.periodo_fuente === 'fecha' && periodo && m2 !== periodo) {
        const a = sumas(periodo, rows), b = sumas(periodo, aplicar({ fecha: nuevo, periodo: `${m2}-01` })), a2 = sumas(m2, rows), b2 = sumas(m2, aplicar({ fecha: nuevo, periodo: `${m2}-01` }))
        lineas.push(linea(`Neto empresarial en ${periodo}`, a.neto, b.neto)); lineas.push(linea(`Neto empresarial en ${m2}`, a2.neto, b2.neto))
      } else lineas.push({ texto: fila.periodo_fuente === 'fecha' ? `El período sigue siendo ${periodo}.` : `El período NO cambia (viene de: ${fila.periodo_fuente}).` })
      break
    }
    default:
      lineas.push({ texto: 'Sin impacto en los totales (dato descriptivo). Puede cambiar cómo se sugiere la conciliación.' })
  }
  return { lineas, avisos }
}

function impactoPayroll(fila, campo, nuevo, ctx) {
  const rows = ctx.filas, lineas = [], avisos = []
  const mes = mesDe(fila.mes)
  const staff = (m, rs = rows) => sumar(rs, (x) => x.total_usd, (x) => mesDe(x.mes) === m)
  const staffDepto = (m, d, rs = rows) => sumar(rs, (x) => x.total_usd, (x) => mesDe(x.mes) === m && (x.departamento ?? '(sin departamento)') === d)
  const componentes = ['honorarios_base', 'bonuses', 'comision']
  const dep = fila.departamento ?? '(sin departamento)'
  let totalSugerido = null
  if (componentes.includes(campo)) {
    totalSugerido = r2(componentes.reduce((s, c) => s + Number(c === campo ? nuevo : fila[c] || 0), 0))
    lineas.push(linea('Total de la línea (honorarios + bonus + comisión)', Number(fila.total_usd), totalSugerido))
    if (Number(fila.total_usd) !== totalSugerido) avisos.push(`El total quedaría inconsistente con los componentes (suma ${fmt(totalSugerido)}). Corregí también el total.`)
    lineas.push(linea(`Staff de ${mes} — ${dep} (si se corrige también el total)`, staffDepto(mes, dep), r2(staffDepto(mes, dep) - Number(fila.total_usd) + totalSugerido)))
  } else if (campo === 'total_usd') {
    const suma = r2(componentes.reduce((s, c) => s + Number(fila[c] || 0), 0))
    lineas.push(linea(`Staff de ${mes}`, staff(mes), r2(staff(mes) - Number(fila.total_usd) + nuevo)))
    lineas.push(linea(`Staff de ${mes} — ${dep}`, staffDepto(mes, dep), r2(staffDepto(mes, dep) - Number(fila.total_usd) + nuevo)))
    if (r2(nuevo) !== suma) avisos.push(`El total (${fmt(nuevo)}) no coincide con honorarios + bonus + comisión (${fmt(suma)}).`)
    avisos.push('Cambia el gasto de Staff del Estado de Resultados (cuando los módulos lean los valores vigentes).')
  } else if (campo === 'mes') {
    const m2 = mesDe(nuevo)
    if (m2 === mes) lineas.push({ texto: `La línea sigue en ${mes}.` })
    else { lineas.push(linea(`Staff de ${mes}`, staff(mes), r2(staff(mes) - Number(fila.total_usd)))); lineas.push(linea(`Staff de ${m2}`, staff(m2), r2(staff(m2) + Number(fila.total_usd)))) }
  } else if (campo === 'departamento') {
    const rs2 = rows.map((x) => (x.id === fila.id ? { ...x, departamento: nuevo } : x))
    lineas.push(linea(`Staff de ${mes} — ${dep}`, staffDepto(mes, dep), staffDepto(mes, dep, rs2)))
    lineas.push(linea(`Staff de ${mes} — ${nuevo}`, staffDepto(mes, nuevo), staffDepto(mes, nuevo, rs2)))
    lineas.push({ texto: 'El total de Staff del mes no cambia: el importe se mueve de un departamento a otro.' })
  } else lineas.push({ texto: 'Sin impacto en los totales (dato descriptivo).' })
  return { lineas, avisos, totalSugerido }
}

/**
 * Vista previa del impacto de una corrección (cuando los módulos lean los valores vigentes).
 * @param {object} p  { tabla, fila (vigente), campo, valor (nuevo, normalizado), filas (todas las filas vigentes del módulo) }
 */
export function calcularImpacto({ tabla, fila, campo, valor, filas }) {
  const ctx = { filas }
  if (tabla === 'pagos') return impactoPagos(fila, campo, valor, ctx)
  if (tabla === 'gastos') return impactoGastos(fila, campo, valor, ctx)
  if (tabla === 'movimientos_cuenta') return impactoMovimientos(fila, campo, valor, ctx)
  return impactoPayroll(fila, campo, valor, ctx)
}

/** Texto legible del registro (se guarda como "referencia" en el historial). */
export function referenciaDe(tabla, fila, personas = []) {
  if (tabla === 'pagos') return `Pago de ${fila.cliente} · ${fila.fecha} · ${fmt(fila.monto_usd)}`
  if (tabla === 'gastos') return `Gasto "${fila.concepto}" · ${fila.fecha} · ${fmt(fila.monto_usd)}`
  if (tabla === 'movimientos_cuenta') return `Cuentas: ${fila.descripcion} · ${fila.fecha ?? (fila.periodo ?? 'sin fecha')} · ${fmt(fila.monto)}`
  const p = personas.find((x) => x.id === fila.persona_id)
  return `Payroll: ${p?.nombre ?? `persona #${fila.persona_id}`} · ${mesDe(fila.mes)} · ${fmt(fila.total_usd)}`
}
