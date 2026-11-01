// Motor de cálculo de Gastos Personales. Funciones puras: reciben SOLO filas de la tabla gastos_personales.
// MÓDULO TOTALMENTE INDEPENDIENTE: no importa nada de otros módulos, no conoce Pagos, Gastos, Cuentas,
// Estado de Resultados ni Dashboard, y nada de lo que calcula sale de este módulo hacia ellos.
//
// Regla del balance (aprobada):
//   "Gero para Tomi"  pagado por Gero -> Tomi debe el 100%.
//   "Tomi para Gero"  pagado por Tomi -> Gero debe el 100%.
//   "Para ambos"                      -> quien pagó tiene a su favor el 50% (el otro debe el 50%).
//   Inconsistentes (ej. "Tomi para Gero" ejecutado por Gero) -> "A revisar" y EXCLUIDOS del balance.

export const PERSONAS = { 'Gero A.': 'Gero', 'Tomi N.': 'Tomi' }
export const EJECUTORES = ['Gero A.', 'Tomi N.']
export const TIPOS = ['Personal', 'Empresarial']
export const GASTO_DE = ['Tomi para Gero', 'Gero para Tomi', 'Para ambos']
export const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const otro = (p) => (p === 'Gero' ? 'Tomi' : 'Gero')

/** Quién pagó y quién debe. Devuelve { estado: 'ok' | 'revisar', pagador, deudor, acreedor, porcentaje, clave, motivo }. */
export function clasificar(g) {
  const pagador = PERSONAS[g.ejecutado_por]
  if (!pagador) return { estado: 'revisar', pagador: null, motivo: `"Ejecutado por" desconocido: ${g.ejecutado_por}` }
  if (g.gasto_de === 'Para ambos') {
    return { estado: 'ok', pagador, acreedor: pagador, deudor: otro(pagador), porcentaje: 0.5, clave: pagador === 'Gero' ? 'ambos_gero' : 'ambos_tomi' }
  }
  if (g.gasto_de === 'Gero para Tomi' || g.gasto_de === 'Tomi para Gero') {
    const quienPaga = g.gasto_de.startsWith('Gero') ? 'Gero' : 'Tomi' // "X para Y": lo paga X
    if (pagador !== quienPaga) return { estado: 'revisar', pagador, motivo: `"${g.gasto_de}" debería haberlo ejecutado ${quienPaga}, pero figura ejecutado por ${pagador}.` }
    return { estado: 'ok', pagador, acreedor: pagador, deudor: otro(pagador), porcentaje: 1, clave: quienPaga === 'Gero' ? 'gero_para_tomi' : 'tomi_para_gero' }
  }
  return { estado: 'revisar', pagador, motivo: `"Gasto de" desconocido: ${g.gasto_de}` }
}

/** Filtra por rango de fechas (inclusive, opcional) y por tipo ('ambos' | 'Personal' | 'Empresarial'). */
export function filtrar(gastos, { desde = null, hasta = null, tipo = 'ambos' } = {}) {
  return gastos.filter((g) =>
    (!desde || (typeof g.fecha === 'string' && g.fecha >= desde)) &&
    (!hasta || (typeof g.fecha === 'string' && g.fecha <= hasta)) &&
    (tipo === 'ambos' || g.tipo_gasto === tipo)
  )
}

const LINEAS = [
  ['gero_para_tomi', 'Gero pagó "Gero para Tomi"', 'Tomi', 'Gero', 1],
  ['tomi_para_gero', 'Tomi pagó "Tomi para Gero"', 'Gero', 'Tomi', 1],
  ['ambos_gero', '"Para ambos" pagado por Gero', 'Tomi', 'Gero', 0.5],
  ['ambos_tomi', '"Para ambos" pagado por Tomi', 'Gero', 'Tomi', 0.5],
]

/** Resumen completo del módulo. `filtros` es opcional; sin filtros usa todos los gastos. */
export function calcularPersonales(gastos, filtros = {}) {
  const f = filtrar(gastos, filtros)
  const filas = f.map((g) => ({ ...g, ...clasificar(g) }))
  const monto = (g) => Number(g.monto_usd) || 0
  const suma = (arr) => arr.reduce((s, g) => s + monto(g), 0)

  // ---- balance
  const lineas = LINEAS.map(([clave, texto, deudor, acreedor, porcentaje]) => {
    const base = suma(filas.filter((g) => g.estado === 'ok' && g.clave === clave))
    const n = filas.filter((g) => g.estado === 'ok' && g.clave === clave).length
    return { clave, texto, deudor, acreedor, porcentaje, n, base: r2(base), importe: r2(base * porcentaje) }
  })
  const tomiDebeAGero = lineas.filter((l) => l.deudor === 'Tomi').reduce((s, l) => s + l.importe, 0)
  const geroDebeATomi = lineas.filter((l) => l.deudor === 'Gero').reduce((s, l) => s + l.importe, 0)
  const neto = r2(tomiDebeAGero - geroDebeATomi)
  const balance = {
    tomiDebeAGero: r2(tomiDebeAGero), geroDebeATomi: r2(geroDebeATomi), neto,
    deudor: neto > 0.005 ? 'Tomi' : neto < -0.005 ? 'Gero' : null,
    acreedor: neto > 0.005 ? 'Gero' : neto < -0.005 ? 'Tomi' : null,
    monto: Math.abs(neto),
    texto: neto > 0.005 ? `Tomi le debe $${fmt(neto)} a Gero` : neto < -0.005 ? `Gero le debe $${fmt(-neto)} a Tomi` : 'Están a mano',
    lineas,
  }

  // ---- totales
  const revisar = filas.filter((g) => g.estado === 'revisar')
  const pagoGero = suma(filas.filter((g) => g.pagador === 'Gero')), pagoTomi = suma(filas.filter((g) => g.pagador === 'Tomi'))

  // ---- por mes (apilado por quién pagó)
  const meses = [...new Set(filas.filter((g) => typeof g.fecha === 'string').map((g) => g.fecha.slice(0, 7)))].sort()
  const porMes = meses.map((m) => {
    const de = filas.filter((g) => g.fecha.slice(0, 7) === m)
    const gero = suma(de.filter((g) => g.pagador === 'Gero')), tomi = suma(de.filter((g) => g.pagador === 'Tomi'))
    return { mes: m, nombre: `${NOMBRES_MES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`, gero: r2(gero), tomi: r2(tomi), total: r2(suma(de)), n: de.length }
  })

  const grupo = (valores, clave) => valores.map((v) => {
    const de = filas.filter((g) => g[clave] === v)
    return { nombre: v, usd: r2(suma(de)), n: de.length }
  })

  return {
    filtros: { desde: filtros.desde ?? null, hasta: filtros.hasta ?? null, tipo: filtros.tipo ?? 'ambos' },
    filas,
    total: r2(suma(filas)), n: filas.length,
    pagoGero: r2(pagoGero), pagoTomi: r2(pagoTomi),
    revisar: { n: revisar.length, usd: r2(suma(revisar)), filas: revisar },
    balance, porMes,
    porParaQuien: grupo(GASTO_DE, 'gasto_de'),
    porTipo: grupo(TIPOS, 'tipo_gasto'),
  }
}

// ==================================================================================================================
// INGRESOS RECIBIDOS («Quién recibió»). Se suman al balance de gastos SOLO en la vista «Ambos».
// Funciones puras: reciben filas de pagos_vigentes y de pago_quien_recibio que les pasa la pantalla (solo lectura).
// No tocan ni recalculan calcularPersonales(): el balance de gastos sigue saliendo exactamente de la fórmula de arriba.
//
// Regla (aprobada): desde INGRESOS_DESDE cuentan como ingreso personal los pagos con «Quién recibió» = Gero o Tomi.
//   Financiera, Empresa y los pagos sin asignar NO cuentan. Los pagos anteriores a INGRESOS_DESDE NO se recalculan (no cuentan).
//   Los ingresos se reparten 50/50:  ajuste = (recibió Tomi − recibió Gero) / 2   (positivo: Tomi le debe a Gero; negativo: Gero le debe a Tomi).
//   Saldo final = neto de gastos (fórmula actual) + ajuste por ingresos. Mismo signo que balance.neto.
// ==================================================================================================================
export const INGRESOS_DESDE = '2026-10-01'
export const RECEPTORES = ['Gero', 'Tomi', 'Financiera', 'Empresa']
const RECEPTORES_PERSONALES = ['Gero', 'Tomi']

// Redondeo a centavos "mitad hacia afuera del cero" (50,005 -> 50,01 y −50,005 -> −50,01), sin errores de coma flotante
const aCentavos = (n) => { const c = Math.abs(n) * 100; const r = Math.round(c + 1e-7); return n < 0 ? -r : r }
const deCentavos = (c) => c / 100
// Redondea una cantidad que YA está en centavos (puede terminar en ,5) al centavo entero, mitad hacia afuera del cero
const redC = (c) => { const r = Math.round(Math.abs(c) + 1e-7); return c < 0 ? -r : r }

/** Texto corto del signo del saldo (positivo: Tomi debe; negativo: Gero debe). */
export function etiquetaSaldo(neto) {
  return neto > 0.005 ? `Tomi debe $${fmt(neto)}` : neto < -0.005 ? `Gero debe $${fmt(-neto)}` : 'A mano'
}
function textoSaldo(neto) {
  return neto > 0.005 ? `Tomi le debe $${fmt(neto)} a Gero` : neto < -0.005 ? `Gero le debe $${fmt(-neto)} a Tomi` : 'Están a mano'
}

/** Mapa pago_id -> quien. Acepta el arreglo [{pago_id, quien}] o ya un objeto. */
function mapaAsignaciones(a) {
  if (Array.isArray(a)) return Object.fromEntries(a.map((x) => [x.pago_id, x.quien]))
  return a || {}
}

/**
 * Clasifica los pagos del período (desde/hasta de los filtros) para el cálculo de ingresos.
 * `pagos`: filas de pagos_vigentes (id, fecha, monto_usd, cliente). `asignaciones`: filas de pago_quien_recibio.
 * Devuelve los ingresos que SÍ cuentan y, aparte, los avisos informativos (nada de eso se suma).
 */
export function clasificarIngresos(pagos, asignaciones, { desde = null, hasta = null } = {}) {
  const quien = mapaAsignaciones(asignaciones)
  const enRango = (p) => typeof p.fecha === 'string' && (!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta)
  const monto = (p) => Number(p.monto_usd) || 0
  const sumaC = (arr) => arr.reduce((s, p) => s + aCentavos(monto(p)), 0)
  const resumen = (arr) => ({ n: arr.length, usd: deCentavos(sumaC(arr)) })
  const delPeriodo = pagos.filter(enRango)
  const nuevos = delPeriodo.filter((p) => p.fecha >= INGRESOS_DESDE)
  const validos = nuevos.filter((p) => RECEPTORES_PERSONALES.includes(quien[p.id]))
  const gero = validos.filter((p) => quien[p.id] === 'Gero'), tomi = validos.filter((p) => quien[p.id] === 'Tomi')
  const sinAsignar = nuevos.filter((p) => !quien[p.id])
  const otros = nuevos.filter((p) => quien[p.id] && !RECEPTORES_PERSONALES.includes(quien[p.id]))
  const anteriores = delPeriodo.filter((p) => p.fecha < INGRESOS_DESDE)
  return {
    desde: INGRESOS_DESDE,
    validos: validos.map((p) => ({ id: p.id, fecha: p.fecha, cliente: p.cliente ?? null, monto_usd: monto(p), quien: quien[p.id] })),
    geroC: sumaC(gero), tomiC: sumaC(tomi),
    gero: deCentavos(sumaC(gero)), tomi: deCentavos(sumaC(tomi)), n: validos.length, nGero: gero.length, nTomi: tomi.length,
    // informativos: NO entran al cálculo
    sinAsignar: { ...resumen(sinAsignar), filas: sinAsignar.map((p) => ({ id: p.id, fecha: p.fecha, cliente: p.cliente ?? null, monto_usd: monto(p) })) },
    otrosReceptores: { ...resumen(otros), financiera: resumen(otros.filter((p) => quien[p.id] === 'Financiera')), empresa: resumen(otros.filter((p) => quien[p.id] === 'Empresa')) },
    anteriores: { ...resumen(anteriores), conReceptorPersonal: resumen(anteriores.filter((p) => RECEPTORES_PERSONALES.includes(quien[p.id]))) },
  }
}

/**
 * Saldo combinado de Gastos Personales: balance de gastos (calcularPersonales, sin cambios) + ajuste por ingresos.
 * `ingresos`: { pagos, asignaciones } leídos de Supabase, o null si la lectura falló.
 * Los ingresos se incluyen SOLO en la vista tipo = 'ambos'. Si se necesitan y no están disponibles, `definitivo` es false y `saldo` es null.
 */
export function calcularSaldoCombinado(gastos, ingresos, filtros = {}) {
  const base = calcularPersonales(gastos, filtros)
  const tipo = filtros.tipo ?? 'ambos'
  const incluyeIngresos = tipo === 'ambos'
  const disponible = !!ingresos && Array.isArray(ingresos.pagos) && ingresos.asignaciones !== undefined && ingresos.asignaciones !== null
  const ing = disponible ? clasificarIngresos(ingresos.pagos, ingresos.asignaciones, filtros) : null
  const usa = incluyeIngresos && disponible
  const definitivo = !incluyeIngresos || disponible // en «Personal»/«Empresarial» el saldo es el de gastos y no depende de los ingresos

  // ---- totales
  const ajusteC = usa ? redC((ing.tomiC - ing.geroC) / 2) : 0
  const ajusteNeto = deCentavos(ajusteC)
  const netoGastosC = aCentavos(base.balance.neto)
  const netoC = netoGastosC + ajusteC
  const neto = deCentavos(netoC)
  const quedaDeudor = (n) => (n > 0.005 ? 'Tomi' : n < -0.005 ? 'Gero' : null)
  const ajuste = { neto: ajusteNeto, deudor: quedaDeudor(ajusteNeto), acreedor: ajusteNeto > 0.005 ? 'Gero' : ajusteNeto < -0.005 ? 'Tomi' : null, texto: textoSaldo(ajusteNeto) }
  const saldo = definitivo
    ? { neto, deudor: quedaDeudor(neto), acreedor: neto > 0.005 ? 'Gero' : neto < -0.005 ? 'Tomi' : null, monto: Math.abs(neto), texto: textoSaldo(neto) }
    : null

  // ---- detalle por mes (solo gastos que SÍ entran al balance, es decir "ok", más los ingresos válidos)
  const ok = base.filas.filter((g) => g.estado === 'ok' && typeof g.fecha === 'string')
  const montoC = (g) => aCentavos(Number(g.monto_usd) || 0)
  const meses = [...new Set([...ok.map((g) => g.fecha.slice(0, 7)), ...(usa ? ing.validos.map((p) => p.fecha.slice(0, 7)) : [])])].sort()
  // Todo se calcula por diferencia de acumulados redondeados al centavo: así la suma de los meses da EXACTAMENTE el total.
  // El último mes se fija a los totales oficiales (neto de gastos de la fórmula actual y ajuste de ingresos).
  let gastos2 = 0 // neto de gastos acumulado en medios centavos (100% de lo "para el otro" + 50% de lo compartido)
  let dif = 0 // (recibió Tomi − recibió Gero) acumulado en centavos; el ajuste es la mitad
  let prevGastosC = 0, prevAjusteC = 0
  const mensual = meses.map((m, i) => {
    const gm = ok.filter((g) => g.fecha.slice(0, 7) === m)
    const por = (clave) => gm.filter((g) => g.clave === clave).reduce((s, g) => s + montoC(g), 0)
    const geroPorTomiC = por('gero_para_tomi'), tomiPorGeroC = por('tomi_para_gero'), ambosGeroC = por('ambos_gero'), ambosTomiC = por('ambos_tomi')
    const pm = usa ? ing.validos.filter((p) => p.fecha.slice(0, 7) === m) : []
    const recGeroC = pm.filter((p) => p.quien === 'Gero').reduce((s, p) => s + aCentavos(p.monto_usd), 0)
    const recTomiC = pm.filter((p) => p.quien === 'Tomi').reduce((s, p) => s + aCentavos(p.monto_usd), 0)
    gastos2 += 2 * geroPorTomiC + ambosGeroC - 2 * tomiPorGeroC - ambosTomiC
    dif += recTomiC - recGeroC
    const ultimo = i === meses.length - 1
    const acumGastosC = ultimo ? netoGastosC : redC(gastos2 / 2)
    const acumAjusteC = ultimo ? ajusteC : redC(dif / 2)
    const netoGastosMesC = acumGastosC - prevGastosC, ajusteMesC = acumAjusteC - prevAjusteC
    prevGastosC = acumGastosC
    prevAjusteC = acumAjusteC
    return {
      mes: m, nombre: `${NOMBRES_MES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`,
      recibioGero: deCentavos(recGeroC), recibioTomi: deCentavos(recTomiC),
      geroPorTomi: deCentavos(geroPorTomiC), tomiPorGero: deCentavos(tomiPorGeroC),
      compartidos: deCentavos(ambosGeroC + ambosTomiC), compartidosGero: deCentavos(ambosGeroC), compartidosTomi: deCentavos(ambosTomiC),
      netoGastos: deCentavos(netoGastosMesC), ajuste: deCentavos(ajusteMesC),
      saldoMes: deCentavos(netoGastosMesC + ajusteMesC), acumulado: deCentavos(acumGastosC + acumAjusteC),
    }
  })

  return {
    base, tipo, incluyeIngresos, disponible, definitivo,
    ingresos: ing, // con avisos informativos; null si no se pudieron leer
    ajuste, saldo, netoGastos: base.balance.neto, mensual,
  }
}

function fmt(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
