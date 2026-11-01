// Motor de cálculo del Dashboard. Funciones puras: reciben datos FUENTE (Pagos y la columna "comisión" de Payroll).
// No usa fórmulas ni tablas dinámicas del Excel. Reglas aprobadas (ver docs/dashboard.md):
//  - Todo sale de Pagos, por fecha exacta, con rango INCLUSIVO (desde y hasta).
//  - Comisiones: regla del Excel como comisión TEÓRICA, mostrada junto a la registrada en Payroll. Gero y Tomi van aparte ("no se paga").
//  - Si faltan datos para calcular algo, se informa como "sin datos suficientes": nunca se asume.
//  - FECCU = Front-end + Upfront · FECCP = Front-end + Payment Plan · BECC = Back-end · lo demás = "Sin clasificar" (no se asigna solo).
//  - No entran Cuentas, Gastos, Gastos Personales ni datos sensibles del equipo.

export const REGLAS = {
  closerPct: 0.1,
  setterInboundPct: 0.05, // Mai: Fee + PIF + 1ra Cuota, fuente "Inbound IG"
  setterEnrutamientoPct: 0.025, // "ENRU / Mai": Fee + PIF + 1ra Cuota, fuente "Enrutamiento"
  conceptosSetter: ['Fee', 'PIF', '1ra Cuota'],
  socios: ['Gero', 'Tomi'],
  settersEnrutamiento: ['Mai', 'ENRU / Mai'],
}
// Cómo se llama en Payroll la persona que en Pagos figura con un nombre corto
export const ALIAS_PAYROLL = {
  Fer: 'Fernando Dewey', Carlos: 'Carlos Roletto', Marcos: 'Marcos Alejandro Carlomagno', Juan: 'Juan Vasquez', Ariel: 'Ariel Arrollo', Mai: 'Maite Revel',
}
export const ORDEN_CONCEPTOS = ['Fee', '1ra Cuota', '2da Cuota', '3ra Cuota', '4ta Cuota', 'PIF']
export const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const n2 = (n) => r2(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const p1 = (x) => (x * 100).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + '%'
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
const vacio = (v) => v === null || v === undefined || String(v).trim() === ''

// ---------------------------------------------------------------- fechas (UTC, sin zonas horarias)
const aFecha = (s) => new Date(`${s}T00:00:00Z`)
const aTexto = (d) => d.toISOString().slice(0, 10)
const sumarDias = (s, n) => aTexto(new Date(aFecha(s).getTime() + n * 86400000))
const ultimoDiaMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate()
const dif = (a, b) => Math.round((aFecha(b).getTime() - aFecha(a).getTime()) / 86400000)

/** Meses calendario completos que cubre el rango, como ['2026-09', ...]. */
export function mesesCubiertos(desde, hasta) {
  const out = []
  let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7))
  while (true) {
    const ini = `${y}-${String(m).padStart(2, '0')}-01`
    const fin = `${y}-${String(m).padStart(2, '0')}-${String(ultimoDiaMes(y, m)).padStart(2, '0')}`
    if (ini > hasta) break
    if (ini >= desde && fin <= hasta) out.push(ini.slice(0, 7))
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

/** Período anterior de comparación: meses completos -> los mismos meses inmediatamente anteriores; si no, igual cantidad de días. */
export function rangoAnterior(desde, hasta) {
  const yd = Number(desde.slice(0, 4)), md = Number(desde.slice(5, 7)), dd = Number(desde.slice(8, 10))
  const yh = Number(hasta.slice(0, 4)), mh = Number(hasta.slice(5, 7)), dh = Number(hasta.slice(8, 10))
  if (dd === 1 && dh === ultimoDiaMes(yh, mh)) {
    const n = (yh - yd) * 12 + (mh - md) + 1 // cantidad de meses completos
    let y = yd, m = md - n
    while (m < 1) { m += 12; y-- }
    const ini = `${y}-${String(m).padStart(2, '0')}-01`
    let y2 = yd, m2 = md - 1
    if (m2 < 1) { m2 = 12; y2-- }
    return { desde: ini, hasta: `${y2}-${String(m2).padStart(2, '0')}-${String(ultimoDiaMes(y2, m2)).padStart(2, '0')}`, tipo: n === 1 ? 'mes anterior' : `${n} meses anteriores` }
  }
  const dias = dif(desde, hasta) + 1
  return { desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1), tipo: `${dias} días anteriores` }
}

/** true si el rango NO es exactamente una sucesión de meses calendario completos (la comisión de Payroll es mensual). */
function rangoParcial(desde, hasta, cubiertos) {
  if (!cubiertos.length) return true
  const ult = cubiertos[cubiertos.length - 1]
  const fin = `${ult}-${String(ultimoDiaMes(Number(ult.slice(0, 4)), Number(ult.slice(5, 7)))).padStart(2, '0')}`
  return desde !== `${cubiertos[0]}-01` || hasta !== fin
}

// ---------------------------------------------------------------- utilidades
const suma = (arr, f = (x) => x.monto_usd) => arr.reduce((s, x) => s + Number(f(x) || 0), 0)
const enRango = (p, desde, hasta) => typeof p.fecha === 'string' && p.fecha >= desde && p.fecha <= hasta
const variacion = (actual, anterior) => (anterior > 0 ? r2(((actual - anterior) / anterior) * 10000) / 10000 : null)

function agrupar(pagos, clave, etiquetaVacia) {
  const m = new Map()
  for (const p of pagos) {
    const k = vacio(p[clave]) ? etiquetaVacia : String(p[clave]).trim()
    const g = m.get(k) || { nombre: k, usd: 0, n: 0 }
    g.usd += Number(p.monto_usd); g.n++
    m.set(k, g)
  }
  return [...m.values()].map((g) => ({ ...g, usd: r2(g.usd) }))
}

/** Busca en Payroll a la persona de un nombre corto: alias explícito o prefijo único. Devuelve el nombre o null. */
function resolverPersona(alias, nombresPayroll) {
  const exacto = ALIAS_PAYROLL[alias]
  if (exacto) { const hit = nombresPayroll.find((n) => norm(n) === norm(exacto)); if (hit) return hit }
  const candidatos = nombresPayroll.filter((n) => norm(n).startsWith(norm(alias)) || norm(n) === norm(alias))
  return candidatos.length === 1 ? candidatos[0] : null
}

/**
 * @param {object} d
 * @param {string} d.desde  'YYYY-MM-DD' (inclusive)
 * @param {string} d.hasta  'YYYY-MM-DD' (inclusive)
 * @param {object[]} d.pagos   {fecha, monto_usd, pesos_ars, closer, setter, concepto, fuente, tipo_venta, tipo_pago, programa}
 * @param {object[]} d.equipo  {mes, comision, persona}  (solo la comisión registrada en Payroll)
 */
export function calcularDashboard({ desde, hasta, pagos = [], equipo = [] }) {
  const enP = pagos.filter((p) => enRango(p, desde, hasta))
  const ant = rangoAnterior(desde, hasta)
  const enAnt = pagos.filter((p) => enRango(p, ant.desde, ant.hasta))

  // ------------------------------------------------ KPIs y comparación
  const cash = suma(enP), n = enP.length
  const cashAnt = suma(enAnt), nAnt = enAnt.length
  const ticket = n ? cash / n : null, ticketAnt = nAnt ? cashAnt / nAnt : null
  const pesos = enP.filter((p) => p.pesos_ars !== null && p.pesos_ars !== undefined)
  const kpis = {
    cash: r2(cash), pagos: n, ticket: ticket === null ? null : r2(ticket),
    pesos: { n: pesos.length, usd: r2(suma(pesos)), pct: cash > 0 ? r2((suma(pesos) / cash) * 10000) / 10000 : null },
    anterior: { desde: ant.desde, hasta: ant.hasta, tipo: ant.tipo, cash: r2(cashAnt), pagos: nAnt, ticket: ticketAnt === null ? null : r2(ticketAnt) },
    variacion: { cash: variacion(cash, cashAnt), pagos: variacion(n, nAnt), ticket: ticket !== null && ticketAnt !== null ? variacion(ticket, ticketAnt) : null },
  }

  // ------------------------------------------------ cash por mes (año de "hasta")
  const anio = Number(hasta.slice(0, 4))
  const porMes = Array.from({ length: 12 }, (_, i) => {
    const clave = `${anio}-${String(i + 1).padStart(2, '0')}`
    const ps = pagos.filter((p) => typeof p.fecha === 'string' && p.fecha.slice(0, 7) === clave)
    const ini = `${clave}-01`, fin = `${clave}-${String(ultimoDiaMes(anio, i + 1)).padStart(2, '0')}`
    return { mes: clave, nombre: NOMBRES_MES[i], usd: r2(suma(ps)), n: ps.length, enRango: ini <= hasta && fin >= desde }
  })

  // ------------------------------------------------ agrupaciones
  const ordenUsd = (a, b) => b.usd - a.usd
  const porFuente = agrupar(enP, 'fuente', 'Sin fuente').sort(ordenUsd)
  const porConcepto = agrupar(enP, 'concepto', 'Sin concepto').sort((a, b) => {
    const ia = ORDEN_CONCEPTOS.indexOf(a.nombre), ib = ORDEN_CONCEPTOS.indexOf(b.nombre)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const porCloser = agrupar(enP, 'closer', 'Sin closer').sort(ordenUsd)
  const porSetter = agrupar(enP, 'setter', 'Sin setter').sort(ordenUsd)

  // ------------------------------------------------ FECCU / FECCP / BECC
  const esFront = (p) => p.tipo_venta === 'Front-end', esBack = (p) => p.tipo_venta === 'Back-end'
  const celda = (arr) => ({ usd: r2(suma(arr)), n: arr.length })
  const feccu = enP.filter((p) => esFront(p) && p.tipo_pago === 'Upfront')
  const feccp = enP.filter((p) => esFront(p) && p.tipo_pago === 'Payment Plan')
  const becc = enP.filter(esBack)
  const sinTipoVenta = enP.filter((p) => !esFront(p) && !esBack(p))
  const frontSinPago = enP.filter((p) => esFront(p) && p.tipo_pago !== 'Upfront' && p.tipo_pago !== 'Payment Plan')
  const clasificacion = {
    feccu: celda(feccu), feccp: celda(feccp), becc: celda(becc),
    sinClasificar: celda([...sinTipoVenta, ...frontSinPago]),
    detalleSinClasificar: { frontSinTipoPago: celda(frontSinPago), sinTipoVenta: celda(sinTipoVenta) },
    backSinTipoPago: celda(becc.filter((p) => vacio(p.tipo_pago))), // informativo: BECC no depende del tipo de pago
  }

  // ------------------------------------------------ calidad de datos (dentro del rango)
  const falta = (f) => celda(enP.filter(f))
  const calidad = {
    sinFuente: falta((p) => vacio(p.fuente)), sinTipoPago: falta((p) => vacio(p.tipo_pago)), sinTipoVenta: falta((p) => vacio(p.tipo_venta)),
    sinPrograma: falta((p) => vacio(p.programa)), sinSetter: falta((p) => vacio(p.setter)), sinCloser: falta((p) => vacio(p.closer)), sinConcepto: falta((p) => vacio(p.concepto)),
  }
  // «Sin programa» ya no es una alerta: el formulario de Pagos dejó de pedir el programa. El dato se sigue calculando (no cambia ningún importe), pero no activa el aviso.
  calidad.hayProblemas = Object.entries(calidad).some(([k, c]) => k !== 'sinPrograma' && c && c.n > 0)

  // ------------------------------------------------ comisiones
  const cubiertos = mesesCubiertos(desde, hasta)
  const nombresPayroll = [...new Set(equipo.map((e) => e.persona).filter(Boolean))]
  const payrollDe = (persona) => equipo.filter((e) => e.persona === persona && cubiertos.includes(String(e.mes).slice(0, 7))).reduce((s, e) => s + Number(e.comision || 0), 0)
  const notas = []

  const socios = []
  const filas = new Map() // clave de persona -> fila
  const fila = (clave, persona, alias) => {
    if (!filas.has(clave)) filas.set(clave, { nombre: persona || alias, alias: [], persona, teorica: 0, detalle: [] })
    const f = filas.get(clave); if (!f.alias.includes(alias)) f.alias.push(alias)
    return f
  }

  // Closers: 10% del cash del closer
  for (const g of porCloser) {
    if (g.nombre === 'Sin closer') continue
    if (REGLAS.socios.includes(g.nombre)) { socios.push({ nombre: g.nombre, cash: g.usd, n: g.n, teorica: r2(g.usd * REGLAS.closerPct) }); continue }
    const persona = resolverPersona(g.nombre, nombresPayroll)
    const f = fila(persona || `alias:${g.nombre}`, persona, g.nombre)
    const monto = g.usd * REGLAS.closerPct
    f.teorica += monto
    f.detalle.push({ concepto: `Closer ${g.nombre}: ${p1(REGLAS.closerPct)} de $${n2(g.usd)}`, base: g.usd, pct: REGLAS.closerPct, monto: r2(monto) })
  }

  // Setters: reglas de Mai
  const baseSetter = (p) => REGLAS.conceptosSetter.includes(p.concepto)
  const inbound = enP.filter((p) => p.setter === 'Mai' && p.fuente === 'Inbound IG' && baseSetter(p))
  const enrut = enP.filter((p) => p.fuente === 'Enrutamiento' && REGLAS.settersEnrutamiento.includes(p.setter) && baseSetter(p))
  if (inbound.length || enrut.length) {
    const persona = resolverPersona('Mai', nombresPayroll)
    const f = fila(persona || 'alias:Mai', persona, 'Mai')
    if (inbound.length) { const base = suma(inbound), monto = base * REGLAS.setterInboundPct; f.teorica += monto; f.detalle.push({ concepto: `Setter Mai · Inbound IG (Fee + PIF + 1ra Cuota): ${p1(REGLAS.setterInboundPct)} de $${n2(base)}`, base: r2(base), pct: REGLAS.setterInboundPct, monto: r2(monto) }) }
    if (enrut.length) { const base = suma(enrut), monto = base * REGLAS.setterEnrutamientoPct; f.teorica += monto; f.detalle.push({ concepto: `Setter ENRU / Mai · Enrutamiento (Fee + PIF + 1ra Cuota): ${p1(REGLAS.setterEnrutamientoPct)} de $${n2(base)}`, base: r2(base), pct: REGLAS.setterEnrutamientoPct, monto: r2(monto) }) }
  }
  // Pagos de setters que la regla no permite calcular: se informan, no se asumen
  const sinDatosSetter = enP.filter((p) => vacio(p.setter))
  if (sinDatosSetter.length) notas.push({ tipo: 'sin_datos', texto: `${sinDatosSetter.length} pago(s) por $${n2(suma(sinDatosSetter))} sin setter: sin datos suficientes para calcular su comisión.` })
  const maiSinFuente = enP.filter((p) => p.setter === 'Mai' && vacio(p.fuente) && baseSetter(p))
  if (maiSinFuente.length) notas.push({ tipo: 'sin_datos', texto: `${maiSinFuente.length} pago(s) de Mai por $${n2(suma(maiSinFuente))} sin fuente: sin datos suficientes (no se sabe si corresponde 5% o 2,5%).` })
  const maiOtrasFuentes = enP.filter((p) => p.setter === 'Mai' && !vacio(p.fuente) && !['Inbound IG', 'Enrutamiento'].includes(p.fuente) && baseSetter(p))
  if (maiOtrasFuentes.length) notas.push({ tipo: 'sin_regla', texto: `${maiOtrasFuentes.length} pago(s) de Mai por $${n2(suma(maiOtrasFuentes))} de otras fuentes: no hay regla de comisión definida.` })
  const settersSinRegla = enP.filter((p) => p.setter === 'Tomi / Gero')
  if (settersSinRegla.length) notas.push({ tipo: 'sin_regla', texto: `${settersSinRegla.length} pago(s) por $${n2(suma(settersSinRegla))} con setter "Tomi / Gero": no hay regla de comisión definida.` })
  const closerSin = enP.filter((p) => vacio(p.closer))
  if (closerSin.length) notas.push({ tipo: 'sin_datos', texto: `${closerSin.length} pago(s) por $${n2(suma(closerSin))} sin closer: sin datos suficientes.` })
  const cuotasSetter = enP.filter((p) => p.setter === 'Mai' && ['2da Cuota', '3ra Cuota', '4ta Cuota'].includes(p.concepto))
  if (cuotasSetter.length) notas.push({ tipo: 'info', texto: `${cuotasSetter.length} pago(s) de Mai por $${n2(suma(cuotasSetter))} son cuotas posteriores (2da a 4ta): la regla solo comisiona Fee, PIF y 1ra Cuota.` })

  // Personas con comisión en Payroll (meses completos) que no tienen fila: se agregan, sin inventar su teórica
  for (const persona of nombresPayroll) {
    if (filas.has(persona)) continue
    if (cubiertos.length && payrollDe(persona) > 0) filas.set(persona, { nombre: persona, alias: [], persona, teorica: null, detalle: [] })
  }

  const personas = [...filas.values()].map((f) => {
    let payroll, estadoPayroll
    if (!f.persona) { payroll = null; estadoPayroll = 'sin_datos' }
    else if (!cubiertos.length) { payroll = null; estadoPayroll = 'rango_parcial' }
    else { payroll = r2(payrollDe(f.persona)); estadoPayroll = 'ok' }
    const teorica = f.teorica === null ? null : r2(f.teorica)
    return {
      nombre: f.nombre, alias: f.alias, teorica, detalle: f.detalle, payroll, estadoPayroll,
      diferencia: teorica !== null && payroll !== null ? r2(teorica - payroll) : null,
      estadoTeorica: teorica === null ? 'sin_datos' : 'ok',
    }
  }).sort((a, b) => (b.teorica ?? -1) - (a.teorica ?? -1))

  return {
    desde, hasta, anio, kpis, porMes, porFuente, porConcepto, porCloser, porSetter, clasificacion, calidad,
    comisiones: { personas, socios: socios.sort((a, b) => b.cash - a.cash), notas, mesesCubiertos: cubiertos, rangoParcial: rangoParcial(desde, hasta, cubiertos) },
  }
}
