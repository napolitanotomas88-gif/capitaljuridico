// Motor de cálculo del Estado de Resultados. Funciones puras: reciben los datos FUENTE y devuelven los números.
// NO replica las fórmulas del Excel. Reglas (ver docs/estado-de-resultados.md):
//  - Meses con límites exactos: un movimiento pertenece al mes de su fecha (nada de DATE(año,mes,31)).
//  - Ingresos: Pagos. Gastos: tabla Gastos (todos sus tipos, con la fecha real). Equipo: Payroll (todas las líneas del mes, pagadas o no).
//  - De Cuentas SOLO entra `Inversión empresa`, leída de la vista movimientos_cuenta_empresa. Nunca personales, resúmenes ni transferencias.
//  - Gastos Personales nunca entra (este módulo ni siquiera recibe esos datos).

export const AREAS_BASE = ['Ventas', 'Producto', 'Marketing', 'Operaciones']
export const TIPOS_GASTO_BASE = ['Software', 'Otros', 'Anuncios', 'Anuncios FM']
export const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const claveMes = (anio, m) => `${anio}-${String(m).padStart(2, '0')}`
const SIN_TIPO = '(sin tipo)'
const SIN_AREA = '(sin departamento)'

function ordenarTipos(tipos) {
  const base = TIPOS_GASTO_BASE.filter((t) => tipos.includes(t))
  const otros = tipos.filter((t) => !TIPOS_GASTO_BASE.includes(t)).sort((a, b) => a.localeCompare(b))
  return [...base, ...otros]
}
function ordenarAreas(areas) {
  const base = AREAS_BASE.filter((t) => areas.includes(t))
  const otros = areas.filter((t) => !AREAS_BASE.includes(t)).sort((a, b) => a.localeCompare(b))
  return [...base, ...otros]
}

/**
 * @param {object} d
 * @param {number} d.anio
 * @param {string} d.hoy                'YYYY-MM-DD' (para saber qué mes está en curso)
 * @param {number} d.saldoInicial
 * @param {{fecha:string, monto_usd:number, comision?:number|null}[]} d.pagos
 * @param {{fecha:string, monto_usd:number, tipo?:string|null}[]} d.gastos
 * @param {{mes:string, departamento?:string|null, total_usd:number, pagado:boolean}[]} d.equipo
 * @param {{periodo:string|null, monto:number, tipo:string}[]} d.inversiones   (solo de la vista de empresa)
 */
export function calcularEstado({ anio, hoy, saldoInicial = 0, pagos = [], gastos = [], equipo = [], inversiones = [] }) {
  const anioHoy = Number(hoy.slice(0, 4)), mesHoy = Number(hoy.slice(5, 7))
  const estadoDe = (m) => {
    if (anio < anioHoy) return 'cerrado'
    if (anio > anioHoy) return 'futuro'
    return m < mesHoy ? 'cerrado' : m === mesHoy ? 'en_curso' : 'futuro'
  }
  const enMes = (texto, m) => typeof texto === 'string' && texto.slice(0, 7) === claveMes(anio, m)

  const alertas = []
  const tiposPresentes = new Set(), areasPresentes = new Set()
  const delAnio = (txt) => typeof txt === 'string' && txt.slice(0, 4) === String(anio)
  gastos.filter((g) => delAnio(g.fecha)).forEach((g) => tiposPresentes.add(g.tipo || SIN_TIPO))
  equipo.filter((e) => delAnio(e.mes)).forEach((e) => areasPresentes.add(e.departamento || SIN_AREA))
  const tipos = ordenarTipos([...tiposPresentes])
  const areas = ordenarAreas([...areasPresentes])

  const sinTipo = gastos.filter((g) => delAnio(g.fecha) && !g.tipo).length
  if (sinTipo) alertas.push(`${sinTipo} gasto(s) sin tipo: se muestran en la línea "${SIN_TIPO}".`)
  const invSinPeriodo = inversiones.filter((i) => i.tipo === 'Inversión empresa' && !i.periodo)
  if (invSinPeriodo.length) alertas.push(`${invSinPeriodo.length} inversión(es) sin período asignado: no están incluidas en ningún mes (el período se completa desde la pantalla Cuentas → Por completar, hoy oculta del menú).`)

  const meses = []
  let acumulado = Number(saldoInicial) || 0
  let acumuladoDesp = acumulado
  let acumuladoCerrado = acumulado, acumuladoCerradoDesp = acumulado, acumuladoConCurso = null, acumuladoConCursoDesp = null

  for (let m = 1; m <= 12; m++) {
    const estado = estadoDe(m)
    const base = { m, key: claveMes(anio, m), nombre: NOMBRES_MES[m - 1], estado }
    if (estado === 'futuro') {
      meses.push({ ...base, vacio: true })
      continue
    }
    const p = pagos.filter((x) => enMes(x.fecha, m))
    const cash = p.reduce((s, x) => s + Number(x.monto_usd), 0)
    const comisiones = p.reduce((s, x) => s + Number(x.comision || 0), 0)
    const cashNeto = cash - comisiones

    const eq = equipo.filter((x) => enMes(x.mes, m))
    const staffAreas = Object.fromEntries(areas.map((a) => [a, r2(eq.filter((x) => (x.departamento || SIN_AREA) === a).reduce((s, x) => s + Number(x.total_usd), 0))]))
    const staffSub = eq.reduce((s, x) => s + Number(x.total_usd), 0)
    const pend = eq.filter((x) => !x.pagado)
    const staffPendiente = { monto: r2(pend.reduce((s, x) => s + Number(x.total_usd), 0)), lineas: pend.length }

    const gm = gastos.filter((x) => enMes(x.fecha, m))
    const gastosPorTipo = Object.fromEntries(tipos.map((t) => [t, r2(gm.filter((x) => (x.tipo || SIN_TIPO) === t).reduce((s, y) => s + Number(y.monto_usd), 0))]))
    const gastosTipos = gm.reduce((s, x) => s + Number(x.monto_usd), 0)
    const gastosTotales = staffSub + gastosTipos

    const beneficio = cashNeto - gastosTotales
    const inv = inversiones.filter((i) => i.tipo === 'Inversión empresa' && i.periodo && enMes(i.periodo, m)).reduce((s, i) => s + Number(i.monto), 0)
    const resultadoDesp = beneficio + inv

    acumulado += beneficio
    acumuladoDesp += resultadoDesp
    if (estado === 'cerrado') { acumuladoCerrado = acumulado; acumuladoCerradoDesp = acumuladoDesp }
    if (estado === 'en_curso') { acumuladoConCurso = acumulado; acumuladoConCursoDesp = acumuladoDesp }

    meses.push({
      ...base, vacio: false,
      cash: r2(cash), comisiones: r2(comisiones), cashNeto: r2(cashNeto),
      staff: { areas: staffAreas, subtotal: r2(staffSub), pendiente: staffPendiente },
      gastosPorTipo, gastosTotales: r2(gastosTotales),
      beneficio: r2(beneficio), pct: estado === 'en_curso' || cash === 0 ? null : r2((beneficio / cash) * 10000) / 10000,
      inversiones: r2(inv), resultadoDespuesInversiones: r2(resultadoDesp),
      acumulado: r2(acumulado), acumuladoDespuesInversiones: r2(acumuladoDesp),
    })
  }

  // Variación del cash contra el mes anterior (solo entre meses cerrados; n/d para enero y el mes en curso)
  meses.forEach((x, i) => {
    if (x.vacio) return
    const prev = meses[i - 1]
    x.variacion = i > 0 && x.estado === 'cerrado' && prev && !prev.vacio && prev.cash > 0 ? r2(((x.cash - prev.cash) / prev.cash) * 10000) / 10000 : null
  })

  // Total año (suma de meses cerrados + en curso)
  const activos = meses.filter((x) => !x.vacio)
  const suma = (f) => r2(activos.reduce((s, x) => s + f(x), 0))
  const total = {
    cash: suma((x) => x.cash), comisiones: suma((x) => x.comisiones), cashNeto: suma((x) => x.cashNeto),
    staff: { areas: Object.fromEntries(areas.map((a) => [a, suma((x) => x.staff.areas[a])])), subtotal: suma((x) => x.staff.subtotal), pendiente: { monto: suma((x) => x.staff.pendiente.monto), lineas: activos.reduce((s, x) => s + x.staff.pendiente.lineas, 0) } },
    gastosPorTipo: Object.fromEntries(tipos.map((t) => [t, suma((x) => x.gastosPorTipo[t])])),
    gastosTotales: suma((x) => x.gastosTotales), beneficio: suma((x) => x.beneficio), inversiones: suma((x) => x.inversiones),
    resultadoDespuesInversiones: suma((x) => x.resultadoDespuesInversiones),
  }
  total.pct = total.cash ? r2((total.beneficio / total.cash) * 10000) / 10000 : null

  return {
    anio, hoy, saldoInicial: Number(saldoInicial) || 0, tipos, areas, meses, total, alertas,
    acumuladoCerrado: r2(acumuladoCerrado), acumuladoCerradoDespuesInversiones: r2(acumuladoCerradoDesp),
    acumuladoConEnCurso: acumuladoConCurso === null ? null : r2(acumuladoConCurso),
    acumuladoConEnCursoDespuesInversiones: acumuladoConCursoDesp === null ? null : r2(acumuladoConCursoDesp),
    hayMesEnCurso: meses.some((x) => x.estado === 'en_curso'),
  }
}
