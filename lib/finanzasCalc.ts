// ── Dashboard de Finanzas: cálculo PURO (sin red ni Sheets) ──────────────────────────────
// Recibe las filas crudas del sheet de Finanzas (UNFORMATTED_VALUE) + gasto de Meta + dólar MEP
// y devuelve todo lo que muestra /finanzas para UN mes. Sin imports de runtime a propósito:
// así se puede probar con `node` directo (ver scripts de validación en el scratchpad).
//
// Fuentes (todas del sheet SHEET_ID_FINANZAS):
//   · Registro de Pagos → entradas (col E USD, F ARS), closer G, setter H, concepto J, fuente K,
//     tipo de venta N / tipo de pago O (categoría FECCU/FECCP/BECC).
//     "Cuenta que recibió": el Registro NO tiene esa columna (decisión del usuario, 30/9/2026). Para jul–sep 2026 se
//     usa el dato fijo de los comprobantes (lib/finanzasCuentas.ts, se pasa en `comprobantes`); si algún día aparece
//     una columna con ese encabezado, se usa la columna. El resto de los meses queda "sin dato".
//   · Gastos → A fecha, B concepto, C monto USD, D tipo de gasto (categoría), F banco / quién pagó.
//   · Payroll → un bloque por mes ("CONTRATISTAS FIJOS" + nombre del mes en col J): base J + bonus K = Staff;
//     comisión L (lo que se registró como pagado) solo para comparar; "Pagado por" por encabezado o col Q.
//   · Estado de Resultados → fila "Cash Collected" (control cruzado del cash).
//   · Pestaña Dashboard → sus fórmulas de comisiones se replican en comisionesDelMes().

import type { PagoComprobante } from './finanzasCuentas'

export type Celda = string | number | boolean | null | undefined
export type Fila = Celda[]

export type Cuenta = 'Tomi' | 'Gero' | 'Relay' | 'Financiera' | 'sin dato' | 'otra'
export type Pagador = 'Tomi' | 'Gero' | 'Empresa' | 'sin dato' | 'otro'
export type CategoriaGasto =
  | 'Software' | 'Anuncios' | 'Staff' | 'Comisiones' | 'Devoluciones' | 'Impuestos'
  | 'Comisiones bancarias' | 'Otros' | 'Sin categoría'

export const CATEGORIAS_GASTO: CategoriaGasto[] = [
  'Software', 'Anuncios', 'Staff', 'Comisiones', 'Devoluciones', 'Impuestos', 'Comisiones bancarias', 'Otros', 'Sin categoría',
]

// Monotributo — Categoría A. Valor OFICIAL de ARCA, tabla "Valores de aplicación desde el 1/08/2026".
// Fuente: https://www.arca.gob.ar/monotributo/categorias.asp (consultado el 30/09/2026).
// Actualizar cuando ARCA publique la tabla de febrero 2027.
export const MONOTRIBUTO_CAT_A = {
  topeAnualArs: 12_009_410.45,
  vigenteDesde: '2026-08-01',
  consultado: '2026-09-30',
  fuente: 'https://www.arca.gob.ar/monotributo/categorias.asp',
}

export const SOCIOS = ['Tomi', 'Gero'] as const

export interface EntradaCalculo {
  mes: string                       // 'YYYY-MM'
  hoy: string                       // 'YYYY-MM-DD' (hora argentina)
  registro: Fila[]                  // Registro de Pagos con la fila 1 (encabezados)
  gastos: Fila[]                    // Gastos con la fila 1
  payroll: Fila[]                   // Payroll completo (A1:Z)
  er: Fila[]                        // Estado de Resultados A1:X50 (con fila 1)
  anioPlanillas: number             // año de Payroll/ER (las pestañas no traen año por bloque)
  metaSpend: Record<string, number> // 'YYYY-MM' → gasto Meta (API, por consumo)
  mep: [string, number][]           // [('YYYY-MM-DD', venta)] ordenado por fecha — dólar MEP (bolsa)
  comprobantes?: PagoComprobante[]  // cuenta que recibió cada pago, sacada de los comprobantes (jul–sep 2026)
}

// ── utilidades ─────────────────────────────────────────────────────────────────────────
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const txt = (c: Celda) => (c ?? '').toString()
export const norm = (c: Celda) => txt(c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const r2 = (n: number) => Math.round(n * 100) / 100

// Serial de Sheets → 'YYYY-MM-DD' (truncando la hora: mismo criterio que rawSheets.serialToDate)
function serialAYmd(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial + 1e-6) * 86400000)
  return d.toISOString().slice(0, 10)   // es UTC puro a medianoche: toISOString no corre el día
}
const pad = (n: number) => String(n).padStart(2, '0')

// Fecha del Registro (col A): serial; como fallback texto "M/D/YYYY" (formato que usaba rawSheets)
function fechaRegistro(c: Celda): string | null {
  if (typeof c === 'number' && c > 30000) return serialAYmd(c)
  const p = txt(c).trim().split('/')
  if (p.length < 3) return null
  const m = parseInt(p[0]), d = parseInt(p[1]), y = parseInt(p[2])
  if (!m || !d || !y || m > 12) return null
  return `${y}-${pad(m)}-${pad(d)}`
}
// Fecha de Gastos (col A): serial o texto "D/M/YYYY" | "DD/MM/YY"
function fechaGasto(c: Celda): string | null {
  if (typeof c === 'number' && c > 30000) return serialAYmd(c)
  const p = txt(c).trim().split('/')
  if (p.length < 3) return null
  const d = parseInt(p[0]), m = parseInt(p[1])
  let y = parseInt(p[2]); if (y < 100) y += 2000
  if (!m || !d || !y || m > 12) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

// Fecha de una fila de Gastos (para ubicar avisos por mes)
function fechaGastoFila(gastos: Fila[], fila: number): string | null { return fechaGasto((gastos[fila - 1] ?? [])[0]) }

// Monto: number directo; texto en formato latino o estándar (misma regla que rawSheets.amountFromCell)
function montoTexto(c: Celda): number {
  if (typeof c === 'number') return c
  const s = txt(c).replace(/[$\s]/g, '').replace(/^usd/i, '').trim()
  if (!s) return 0
  if (/,\d{1,2}$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, '')) || 0
  return parseFloat(s.replace(/,/g, '')) || 0
}

// Igualdad de criterio de SUMIFS: sin distinguir mayúsculas, celda completa (los espacios cuentan)
const igualSheets = (celda: Celda, criterio: string) => txt(celda).toLowerCase() === criterio.toLowerCase()

// Columna por encabezado (normalizado, "empieza con" o "contiene"); si no está, el índice de respaldo
function col(header: Fila, fallback: number, ...claves: string[]): number {
  const h = header.map(norm)
  for (const k of claves) { const i = h.findIndex(x => x === k); if (i >= 0) return i }
  for (const k of claves) { const i = h.findIndex(x => x.startsWith(k)); if (i >= 0) return i }
  for (const k of claves) { const i = h.findIndex(x => x && x.includes(k)); if (i >= 0) return i }
  return fallback
}
function colOpcional(header: Fila, ...claves: string[]): number | null {
  const i = col(header, -1, ...claves)
  return i >= 0 ? i : null
}

export function mesDe(ymd: string) { return ymd.slice(0, 7) }
function sumarMeses(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
export function etiquetaMes(mes: string) {
  const [y, m] = mes.split('-').map(Number)
  return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} ${y}`
}
function diaAnterior(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

// Dólar MEP venta del día ANTERIOR (decisión del usuario). Si ese día no hubo cotización
// (fin de semana/feriado) se usa la última anterior a esa fecha.
export function mepDiaAnterior(mep: [string, number][], ymd: string): { valor: number; fecha: string } | null {
  const objetivo = diaAnterior(ymd)
  let lo = 0, hi = mep.length - 1, res = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (mep[mid][0] <= objetivo) { res = mid; lo = mid + 1 } else hi = mid - 1
  }
  if (res < 0) return null
  // Si la última cotización tiene más de 7 días de atraso respecto al objetivo, no es confiable
  const atraso = (Date.parse(objetivo) - Date.parse(mep[res][0])) / 86400000
  if (atraso > 7) return null
  return { valor: mep[res][1], fecha: mep[res][0] }
}

export function normCuenta(c: Celda): Cuenta {
  const s = norm(c)
  if (!s) return 'sin dato'
  if (/^(tomi|tomas|tomás)\b/.test(s) || s.includes('tomi')) return 'Tomi'
  if (/^(gero|geronimo)\b/.test(s) || s.includes('gero')) return 'Gero'
  if (s.includes('relay') || s.includes('stripe') || s.includes('empresa') || s.includes('llc')) return 'Relay'
  // Financiera de la empresa (Asociación Mutual de Escribanos): plata de la empresa, como Relay
  if (s.includes('financ') || s.includes('mutual') || s.includes('escriban')) return 'Financiera'
  return 'otra'
}
// Quién pagó un gasto (Gastos col F "Banco / Cuenta" o Payroll "Pagado por").
// Relay (y Mercury, el banco anterior de la LLC) = la empresa → fuera del reparto.
// Financiera (Asociación Mutual de Escribanos) = empresa: el equipo se paga con plata que entra ahí (usuario 3/10).
// ARQ / Macro: no se sabe de quién son → "otro".
export function normPagador(c: Celda): Pagador {
  const s = norm(c)
  if (!s) return 'sin dato'
  if (s.includes('tomi') || s.includes('tomas')) return 'Tomi'
  if (s.includes('gero')) return 'Gero'
  if (s.includes('relay') || s.includes('mercury') || s.includes('empresa') || s.includes('llc') || s.includes('stripe')) return 'Empresa'
  if (s.includes('financ') || s.includes('mutual') || s.includes('escriban')) return 'Empresa'
  return 'otro'
}

// Fila de Anuncios que carga la automatización de fin de mes (/api/finanzas-cierre) con el gasto de Meta
// hasta tener lo cobrado en Relay. El concepto lleva esta marca; si en el mes ya hay anuncios "reales"
// (Facebook cobrado en Relay), el estimado NO se suma y se pide borrarlo.
export const MARCA_ESTIMADO_META = 'estimado Meta — reemplazar con lo cobrado en Relay'
export const esEstimadoMeta = (concepto: Celda) => norm(concepto).includes('estimado meta')

// Categoría de gasto desde "Tipo de Gasto" (col D). inferida=true cuando se dedujo del concepto.
export function categoriaGasto(tipo: Celda, concepto: Celda): { cat: CategoriaGasto; inferida: boolean } {
  const t = norm(tipo), c = norm(concepto)
  const esDevolucion = (s: string) => /devoluc|reembols|refund|chargeback|disputa|contracargo/.test(s)
  if (t) {
    if (t.startsWith('software') || t === 'saas') return { cat: 'Software', inferida: false }
    if (/anuncio|^ads\b|publicidad|^meta\b|facebook/.test(t)) return { cat: 'Anuncios', inferida: false }
    if (/staff|payroll|sueldo|honorario|contratista/.test(t)) return { cat: 'Staff', inferida: false }
    if (/comisi\w* bancari|bancari|banco/.test(t)) return { cat: 'Comisiones bancarias', inferida: false }
    if (/comisi/.test(t)) return { cat: 'Comisiones', inferida: false }
    if (esDevolucion(t)) return { cat: 'Devoluciones', inferida: false }
    if (/impuesto|tax|iva|monotributo|afip|arca|iibb|ingresos brutos/.test(t)) return { cat: 'Impuestos', inferida: false }
    if (t.startsWith('otro')) {
      // Julio: las devoluciones se cargaron como "Otros" con el concepto "Devolución: …"
      if (esDevolucion(c)) return { cat: 'Devoluciones', inferida: true }
      return { cat: 'Otros', inferida: false }
    }
    return { cat: 'Sin categoría', inferida: false }   // texto que no es ninguna de las 8
  }
  if (esDevolucion(c)) return { cat: 'Devoluciones', inferida: true }
  return { cat: 'Sin categoría', inferida: false }
}

// Categoría FECCU/FECCP/BECC — misma regla que rawSheets.categoriaPago (N + O + J; P legado)
function numeroCuota(concepto: string): number {
  const c = norm(concepto)
  if (!c.includes('cuota')) return 0
  const m = c.match(/(\d+)\s*(?:ra|da|ta|ma|va|na|er|do|o|a|°|º)?\.?\s*cuota/)
  if (m) return parseInt(m[1]) || 0
  const pal: Record<string, number> = { primer: 1, segunda: 2, tercer: 3, cuarta: 4, quinta: 5, sexta: 6 }
  for (const [p, n] of Object.entries(pal)) if (c.includes(p)) return n
  return 0
}
export function categoriaPagoFin(tipoVenta: string, tipoPago: string, concepto: string, legado = ''): 'FECCU' | 'FECCP' | 'BECC' | 'Sin categoría' {
  const n = tipoVenta.toLowerCase().trim(), o = tipoPago.toLowerCase().trim()
  const front = n.startsWith('front'), back = n.startsWith('back')
  const cuotaPost = numeroCuota(concepto) >= 2
  if (front || back) {
    const plan = o.includes('plan') ? true : o.startsWith('upfront') ? false : cuotaPost
    return front ? (plan ? 'FECCP' : 'FECCU') : 'BECC'
  }
  const p = legado.toUpperCase().trim()
  if (p === 'FECCU' || p === 'FECCP') return p
  if (p.startsWith('BECC')) return 'BECC'
  return 'Sin categoría'
}

// ── parseo de pestañas ─────────────────────────────────────────────────────────────────
export interface Pago {
  fila: number; fecha: string; mes: string
  montoCelda: Celda; monto: number; montoEsNumero: boolean
  ars: number | null
  cliente: string; closerCelda: Celda; setterCelda: Celda; conceptoCelda: Celda; fuenteCelda: Celda
  concepto: string; categoria: 'FECCU' | 'FECCP' | 'BECC' | 'Sin categoría'
  comisionPlataforma: number
  cuenta: Cuenta; cuentaTexto: string
  partes: { cuenta: Cuenta; monto: number }[]   // pago partido entre dos cuentas (comprobantes); si no, una sola parte
  fuenteCuenta: 'columna' | 'comprobantes' | null
}

export function parsearRegistro(registro: Fila[]): { pagos: Pago[]; tieneColCuenta: boolean; colCuentaLetra: string | null } {
  const h = registro[0] ?? []
  const cFecha = 0   // col A no tiene encabezado
  const cMonto = col(h, 4, 'efectivo recaudado')
  const cArs = col(h, 5, 'pesos ars', 'pesos')
  const cCliente = col(h, 2, 'nombre del cliente')
  const cCloser = col(h, 6, 'closer')
  const cSetter = col(h, 7, 'setter')
  const cConcepto = col(h, 9, 'concepto')
  const cFuente = col(h, 10, 'fuente')
  const cComision = col(h, 11, 'comision')
  const cTipoVenta = col(h, 13, 'tipos de venta', 'tipo de venta')
  const cTipoPago = col(h, 14, 'tipo de pago')
  const cCuenta = colOpcional(h, 'cuenta que recibio', 'cuenta que recibe', 'cuenta receptora', 'recibio en', 'cuenta')
  const pagos: Pago[] = []
  registro.slice(1).forEach((r, i) => {
    const fecha = fechaRegistro(r[cFecha])
    const montoCelda = r[cMonto]
    if (!fecha || montoCelda == null || montoCelda === '') return
    const arsCelda = r[cArs]
    const ars = typeof arsCelda === 'number' ? arsCelda : (txt(arsCelda).trim() ? montoTexto(arsCelda) || null : null)
    const cuentaTexto = cCuenta != null ? txt(r[cCuenta]).trim() : ''
    pagos.push({
      fila: i + 2, fecha, mes: mesDe(fecha),
      montoCelda, monto: montoTexto(montoCelda), montoEsNumero: typeof montoCelda === 'number',
      ars: ars && ars > 0 ? ars : null,
      cliente: txt(r[cCliente]).trim(),
      closerCelda: r[cCloser], setterCelda: r[cSetter], conceptoCelda: r[cConcepto], fuenteCelda: r[cFuente],
      concepto: txt(r[cConcepto]).trim(),
      categoria: categoriaPagoFin(txt(r[cTipoVenta]), txt(r[cTipoPago]), txt(r[cConcepto]), txt(r[15])),
      comisionPlataforma: typeof r[cComision] === 'number' ? (r[cComision] as number) : 0,
      cuenta: cCuenta != null ? normCuenta(cuentaTexto) : 'sin dato',
      cuentaTexto,
      partes: [],
      fuenteCuenta: cCuenta != null ? 'columna' : null,
    })
  })
  for (const p of pagos) p.partes = [{ cuenta: p.cuenta, monto: p.monto }]
  const letra = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26))
  return { pagos, tieneColCuenta: cCuenta != null, colCuentaLetra: cCuenta != null ? letra(cCuenta) : null }
}

// Cuenta que recibió desde los comprobantes (dato fijo de jul–sep 2026). Se busca por fecha + cliente (+ monto ±1);
// si el monto del Registro cambió (corrección), alcanza con fecha + cliente. Cada comprobante se usa una sola vez.
// Solo completa pagos sin cuenta (la columna del Registro, si existiera, manda).
const CUENTA_COMPROBANTE: Record<string, Cuenta> = { Tomi: 'Tomi', Gero: 'Gero', Relay: 'Relay', Financiera: 'Financiera', Otro: 'otra' }
export function asignarCuentasComprobantes(pagos: Pago[], comprobantes: PagoComprobante[]): { sinUsar: PagoComprobante[] } {
  const libres = comprobantes.map((c, i) => ({ c, i, usado: false }))
  const clave = (s: string) => norm(s).replace(/[^a-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).join(' ')
  const meses = new Set(comprobantes.map(c => c[0].slice(0, 7)))
  const candidatos = pagos.filter(p => meses.has(p.mes) && p.cuenta === 'sin dato')
  for (const pasada of [1, 2]) {
    for (const p of candidatos) {
      if (p.fuenteCuenta === 'comprobantes') continue
      const l = libres.find(x => !x.usado && x.c[0] === p.fecha && clave(x.c[1]) === clave(p.cliente) &&
        (pasada === 2 || Math.abs(x.c[2] - p.monto) <= 1))
      if (!l) continue
      l.usado = true
      const [, , montoC, cta] = l.c
      if (Array.isArray(cta)) {
        const escala = montoC ? p.monto / montoC : 1
        p.partes = cta.map(([c, m]) => ({ cuenta: CUENTA_COMPROBANTE[c], monto: r2(m * escala) }))
        p.cuenta = p.partes[0].cuenta
        p.cuentaTexto = cta.map(([c, m]) => `${c} ${m}`).join(' + ')
      } else {
        p.cuenta = CUENTA_COMPROBANTE[cta]
        p.partes = [{ cuenta: p.cuenta, monto: p.monto }]
        p.cuentaTexto = cta
      }
      p.fuenteCuenta = 'comprobantes'
    }
  }
  return { sinUsar: libres.filter(x => !x.usado).map(x => x.c) }
}

export interface Gasto {
  fila: number; fecha: string; mes: string; concepto: string; monto: number
  montoOrigen: 'USD' | 'ARS→MEP'; mepUsado?: { valor: number; fecha: string }
  tipoTexto: string; cat: CategoriaGasto; inferida: boolean
  pagadoPorTexto: string; pagador: Pagador
}
export function parsearGastos(gastos: Fila[], mep: [string, number][]): { lista: Gasto[]; sinCotizacion: { fila: number; concepto: string; ars: number }[] } {
  const h = gastos[0] ?? []
  const cFecha = col(h, 0, 'fecha')
  const cConcepto = col(h, 1, 'concepto')
  const cMonto = col(h, 2, 'monto (en usd)', 'monto usd', 'monto')
  const cArs = colOpcional(h, 'monto (en ars)', 'monto ars', 'monto en pesos', 'pesos')
  const cTipo = col(h, 3, 'tipo de gasto', 'tipo', 'categoria')
  const cPago = col(h, 5, 'pagado por', 'banco / cuenta', 'banco', 'cuenta')
  const lista: Gasto[] = []
  const sinCotizacion: { fila: number; concepto: string; ars: number }[] = []
  gastos.slice(1).forEach((r, i) => {
    const fecha = fechaGasto(r[cFecha])
    if (!fecha) return
    const usdCelda = r[cMonto]
    let monto = usdCelda == null || usdCelda === '' ? 0 : montoTexto(usdCelda)
    let montoOrigen: Gasto['montoOrigen'] = 'USD'
    let mepUsado: Gasto['mepUsado']
    if (!monto && cArs != null) {
      const ars = montoTexto(r[cArs])
      if (ars) {
        const m = mepDiaAnterior(mep, fecha)
        if (m) { monto = ars / m.valor; montoOrigen = 'ARS→MEP'; mepUsado = m }
        else sinCotizacion.push({ fila: i + 2, concepto: txt(r[cConcepto]), ars })
      }
    }
    if (!monto) return
    const { cat, inferida } = categoriaGasto(r[cTipo], r[cConcepto])
    const pagadoPorTexto = txt(r[cPago]).trim()
    lista.push({
      fila: i + 2, fecha, mes: mesDe(fecha), concepto: txt(r[cConcepto]).trim(), monto,
      montoOrigen, mepUsado, tipoTexto: txt(r[cTipo]).trim(), cat, inferida,
      // Col F vacía = Relay: TODOS los gastos de la empresa pasan por Relay y las filas nuevas se cargan con E/F vacías
      pagadoPorTexto, pagador: pagadoPorTexto ? normPagador(pagadoPorTexto) : 'Empresa',
    })
  })
  return { lista, sinCotizacion }
}

export interface FilaPayroll {
  fila: number; nombre: string; puesto: string; base: number; bonus: number; comision: number; total: number
  pagado: boolean; pagadoPorTexto: string; pagador: Pagador
}
// Payroll: un bloque por mes. Fila de título con "CONTRATISTAS" y el mes en col J; la siguiente trae los encabezados.
export function parsearPayroll(payroll: Fila[], anio: number): Map<string, FilaPayroll[]> {
  const out = new Map<string, FilaPayroll[]>()
  const inicios: { fila: number; mes: string }[] = []
  payroll.forEach((r, i) => {
    const titulo = r.map(norm).join(' ')
    if (!titulo.includes('contratistas')) return
    const nombreMes = r.map(norm).find(x => MESES.includes(x))
    if (nombreMes) inicios.push({ fila: i, mes: `${anio}-${pad(MESES.indexOf(nombreMes) + 1)}` })
  })
  inicios.forEach((ini, k) => {
    const fin = k + 1 < inicios.length ? inicios[k + 1].fila : payroll.length
    const h = payroll[ini.fila + 1] ?? []
    const cNombre = col(h, 1, 'nombre y apellido', 'nombre')
    const cPuesto = col(h, 7, 'puesto')
    const cBase = col(h, 9, 'honorarios base', 'honorarios')
    const cBonus = col(h, 10, 'bonuses', 'bonus')
    const cCom = col(h, 11, 'comision')
    const cTotal = col(h, 12, 'total usd', 'total')
    const cPagado = col(h, 15, 'pagado')
    const cPagadoPor = colOpcional(h, 'pagado por', 'quien pago')
    const filas: FilaPayroll[] = []
    for (let i = ini.fila + 2; i < fin; i++) {
      const r = payroll[i] ?? []
      const nombre = txt(r[cNombre]).trim()
      if (!nombre) continue
      const num = (c: Celda) => (typeof c === 'number' ? c : montoTexto(c))
      const base = num(r[cBase]), bonus = num(r[cBonus]), comision = num(r[cCom])
      let total = base + bonus + comision
      if (!total) total = num(r[cTotal])
      // "Pagado por": por encabezado; si la columna no tiene título todavía, se mira la col Q (así lo cargan desde agosto)
      const pagadoPorTexto = txt(r[cPagadoPor != null && cPagadoPor !== cPagado ? cPagadoPor : 16]).trim()
      const pagador = normPagador(pagadoPorTexto)
      filas.push({
        fila: i + 1, nombre, puesto: txt(r[cPuesto]).trim(), base, bonus, comision, total,
        pagado: r[cPagado] === true || norm(r[cPagado]) === 'true' || norm(r[cPagado]) === 'si',
        // un texto largo en col Q ("le pagué yo gero") no es un pagador confiable → se muestra como nota
        pagadoPorTexto,
        pagador: pagadoPorTexto.split(' ').length <= 3 ? pagador : (pagador === 'sin dato' ? 'sin dato' : 'otro'),
      })
    }
    if (filas.length) out.set(ini.mes, filas)
  })
  return out
}

// Cash Collected del Estado de Resultados para el mes (cols pares: B=ene, D=feb…)
function cashER(er: Fila[], mes: string, anio: number): number | null {
  const [y, m] = mes.split('-').map(Number)
  if (y !== anio) return null
  const fila = er.find(r => norm(r[0]) === 'cash collected')
  const v = fila?.[2 * (m - 1) + 1]
  return typeof v === 'number' ? v : null
}

// ── comisiones: réplica EXACTA de la pestaña Dashboard ──────────────────────────────────
// Closers (col C):  SUMIFS(E; A>=inicio; A<=fin; G=closer) × 0,1
// "Mai" (F11):      (SUMIFS(E; …; H="Mai"; K="Inbound IG"; J="Fee") + …J="PIF" + …J="1ra Cuota") × 0,05
// "ENRU / Mai" (F12): igual pero K="Enrutamiento" × 0,025 — OJO: la fórmula busca H = E11 ("Mai"), no "ENRU / Mai"
// Setters genéricos (F13/F14): SUMIFS(E; …; H=setter) × 0,05
// El sheet solo lista a Fer, Carlos, Gero y Tomi como closers: acá se aplica la misma fórmula a TODOS los
// closers del mes (Marcos, Juan, Ariel… quedaban afuera del sheet).
export interface LineaComision {
  persona: string; rol: 'closer' | 'setter'; regla: string; base: number; comision: number
  socio: boolean; payroll: number | null; pagos: number
}
const CONCEPTOS_SETTER = ['Fee', 'PIF', '1ra Cuota']
const esSocio = (nombre: string) => {
  const n = norm(nombre)
  return n === 'tomi' || n === 'gero' || n === 'tomi / gero' || n === 'gero / tomi' || n === 'tomas' || n === 'geronimo'
}

export function comisionesDelMes(pagosMes: Pago[], payrollMes: FilaPayroll[] | undefined) {
  const numericos = pagosMes.filter(p => p.montoEsNumero)   // SUMIFS ignora montos cargados como texto
  const lineas: LineaComision[] = []
  const payrollDe = (persona: string) => {
    if (!payrollMes) return null
    const p = norm(persona).split(' ')[0]
    if (!p) return null
    const filas = payrollMes.filter(f => norm(f.nombre).split(' ')[0].startsWith(p))
    return filas.length ? r2(filas.reduce((s, f) => s + f.comision, 0)) : null
  }
  // Closers: cada valor distinto de G (tal cual está escrito; SUMIFS no distingue mayúsculas)
  const closers = new Map<string, string>()
  for (const p of numericos) { const k = txt(p.closerCelda).toLowerCase(); if (k.trim() && !closers.has(k)) closers.set(k, txt(p.closerCelda)) }
  for (const nombre of closers.values()) {
    const filas = numericos.filter(p => igualSheets(p.closerCelda, nombre))
    const base = filas.reduce((s, p) => s + p.monto, 0)
    lineas.push({ persona: nombre.trim(), rol: 'closer', regla: '10% de todo lo cobrado como closer', base: r2(base), comision: r2(base * 0.1), socio: esSocio(nombre), payroll: payrollDe(nombre), pagos: filas.length })
  }
  // Mai: 5% Inbound IG + 2,5% Enrutamiento, solo Fee / PIF / 1ra Cuota
  const mai = (fuente: string) => numericos.filter(p => igualSheets(p.setterCelda, 'Mai') && igualSheets(p.fuenteCelda, fuente) && CONCEPTOS_SETTER.some(c => igualSheets(p.conceptoCelda, c)))
  const maiIG = mai('Inbound IG'), maiEnru = mai('Enrutamiento')
  const baseIG = maiIG.reduce((s, p) => s + p.monto, 0), baseEnru = maiEnru.reduce((s, p) => s + p.monto, 0)
  const hayMai = numericos.some(p => igualSheets(p.setterCelda, 'Mai'))
  if (hayMai || baseIG || baseEnru) {
    const pay = payrollDe('Mai')
    lineas.push({ persona: 'Mai', rol: 'setter', regla: '5% Inbound IG (Fee, PIF, 1ra Cuota)', base: r2(baseIG), comision: r2(baseIG * 0.05), socio: false, payroll: pay, pagos: maiIG.length })
    lineas.push({ persona: 'Mai (ENRU)', rol: 'setter', regla: '2,5% Enrutamiento (Fee, PIF, 1ra Cuota)', base: r2(baseEnru), comision: r2(baseEnru * 0.025), socio: false, payroll: null, pagos: maiEnru.length })
  }
  // Otros setters: 5% de todo lo que tienen en H (el sheet no tiene filas para "ENRU / Mai" ni socios → quedan en 0)
  const setters = new Map<string, string>()
  for (const p of numericos) { const k = txt(p.setterCelda).toLowerCase(); if (k.trim() && k !== 'mai' && !setters.has(k)) setters.set(k, txt(p.setterCelda)) }
  const noComisionados: { setter: string; base: number; pagos: number; motivo: string }[] = []
  for (const nombre of setters.values()) {
    const filas = numericos.filter(p => igualSheets(p.setterCelda, nombre))
    const base = filas.reduce((s, p) => s + p.monto, 0)
    if (esSocio(nombre)) continue   // "Tomi / Gero": socios, el sheet no les calcula comisión de setter
    if (norm(nombre).includes('enru')) {
      noComisionados.push({ setter: nombre.trim(), base: r2(base), pagos: filas.length, motivo: 'la fórmula del sheet busca Setter = "Mai", no "' + nombre.trim() + '"' })
      continue
    }
    lineas.push({ persona: nombre.trim(), rol: 'setter', regla: '5% de todo lo cobrado como setter', base: r2(base), comision: r2(base * 0.05), socio: false, payroll: payrollDe(nombre), pagos: filas.length })
  }
  const aPagar = r2(lineas.filter(l => !l.socio).reduce((s, l) => s + l.comision, 0))
  const socios = r2(lineas.filter(l => l.socio).reduce((s, l) => s + l.comision, 0))
  const payrollTotal = payrollMes ? r2(payrollMes.reduce((s, f) => s + f.comision, 0)) : null
  return { lineas, aPagar, socios, payrollTotal, noComisionados }
}

// ── cálculo del mes ─────────────────────────────────────────────────────────────────────
export interface ItemRevisar { tipo: 'gasto' | 'pago' | 'devolucion' | 'comision' | 'dato'; texto: string; monto?: number; fila?: string }

export function calcularFinanzas(e: EntradaCalculo) {
  const { mes } = e
  const { pagos, tieneColCuenta, colCuentaLetra } = parsearRegistro(e.registro)
  const { sinUsar: comprobantesSinUsar } = e.comprobantes?.length ? asignarCuentasComprobantes(pagos, e.comprobantes) : { sinUsar: [] }
  const { lista: gastos, sinCotizacion } = parsearGastos(e.gastos, e.mep)
  const payroll = parsearPayroll(e.payroll, e.anioPlanillas)
  const revisar: ItemRevisar[] = []

  // Meses con datos (para el selector): Registro, Gastos o Payroll con algo cargado, hasta el mes en curso
  const mesHoy = mesDe(e.hoy)
  const mesesSet = new Set<string>([mesHoy])
  for (const p of pagos) mesesSet.add(p.mes)
  for (const g of gastos) mesesSet.add(g.mes)
  for (const m of payroll.keys()) if (payroll.get(m)!.length) mesesSet.add(m)
  const mesesDisponibles = [...mesesSet].filter(m => m <= mesHoy && m >= '2025-01').sort()

  // ── Entradas ──
  const pagosMes = pagos.filter(p => p.mes === mes)
  const cash = r2(pagosMes.filter(p => p.montoEsNumero).reduce((s, p) => s + p.monto, 0))
  const porCategoria = { FECCU: 0, FECCP: 0, BECC: 0, 'Sin categoría': 0 }
  for (const p of pagosMes) if (p.montoEsNumero) porCategoria[p.categoria] += p.monto
  const porCuenta: Record<Cuenta, number> = { Tomi: 0, Gero: 0, Relay: 0, Financiera: 0, 'sin dato': 0, otra: 0 }
  const cantPorCuenta: Record<Cuenta, number> = { Tomi: 0, Gero: 0, Relay: 0, Financiera: 0, 'sin dato': 0, otra: 0 }
  for (const p of pagosMes) if (p.montoEsNumero) for (const pt of p.partes) { porCuenta[pt.cuenta] += pt.monto; cantPorCuenta[pt.cuenta]++ }
  const fuenteCuenta: 'columna' | 'comprobantes' | null = pagosMes.some(p => p.fuenteCuenta === 'comprobantes') ? 'comprobantes' : tieneColCuenta ? 'columna' : null
  const cashEr = cashER(e.er, mes, e.anioPlanillas)
  if (cashEr != null && Math.abs(cashEr - cash) > 0.5)
    revisar.push({ tipo: 'dato', texto: `El Estado de Resultados dice Cash Collected $${cashEr.toFixed(2)} y el Registro suma $${cash.toFixed(2)} para el mes. Este dashboard usa el Registro (el ER tiene fórmulas con fechas mal puestas).` })
  for (const p of pagosMes.filter(x => !x.montoEsNumero))
    revisar.push({ tipo: 'pago', texto: `Monto cargado como TEXTO ("${txt(p.montoCelda)}"): el sheet lo ignora en sus sumas — reingresarlo como número. ${p.cliente}`, monto: p.monto, fila: `Registro fila ${p.fila}` })
  for (const p of pagosMes.filter(x => x.montoEsNumero && x.monto < 0))
    revisar.push({ tipo: 'devolucion', texto: `Pago NEGATIVO en el Registro (${p.cliente}). Las devoluciones van como gasto "Devoluciones" en la pestaña Gastos.`, monto: p.monto, fila: `Registro fila ${p.fila}` })
  for (const p of pagosMes.filter(x => /devoluc|reembols|refund/.test(norm(x.concepto))))
    revisar.push({ tipo: 'devolucion', texto: `Pago con concepto "${p.concepto}" (${p.cliente}): confirmar si es una devolución.`, monto: p.monto, fila: `Registro fila ${p.fila}` })
  if (porCategoria['Sin categoría'] > 0)
    revisar.push({ tipo: 'pago', texto: `Pagos sin "Tipos de venta" (no se pueden clasificar FECCU/FECCP/BECC).`, monto: r2(porCategoria['Sin categoría']) })
  // "otra" = otras cuentas conocidas (Pagos Rio, efectivo, dLocal…): el usuario decidió no identificarlas → no es un faltante
  const sinCuenta = pagosMes.filter(p => p.montoEsNumero && p.cuenta === 'sin dato')
  if (sinCuenta.length) {
    const total = sinCuenta.reduce((s, p) => s + p.monto, 0)
    const conComprobantes = pagosMes.some(p => p.fuenteCuenta === 'comprobantes')
    revisar.push({
      tipo: 'pago',
      texto: conComprobantes
        ? `${sinCuenta.length} pagos sin cuenta: no coinciden (fecha + cliente) con ningún comprobante revisado: ${sinCuenta.slice(0, 8).map(p => `${p.cliente || 'sin nombre'} $${Math.round(p.monto)} (fila ${p.fila})`).join(', ')}${sinCuenta.length > 8 ? '…' : ''}`
        : tieneColCuenta
          ? `${sinCuenta.length} pagos sin "Cuenta que recibió" válida: ${sinCuenta.slice(0, 8).map(p => `${p.cliente || 'sin nombre'} $${Math.round(p.monto)}${p.cuentaTexto ? ` ("${p.cuentaTexto}")` : ''}`).join(', ')}${sinCuenta.length > 8 ? '…' : ''}`
          : `No se sabe a qué cuenta entraron los ${sinCuenta.length} pagos del mes: el Registro no tiene ese dato (solo jul–sep 2026 están revisados con los comprobantes). Falta decidir cómo registrarlo.`,
      monto: r2(total),
    })
  }
  for (const c of comprobantesSinUsar.filter(c => c[0].slice(0, 7) === mes))
    revisar.push({ tipo: 'pago', texto: `Comprobante revisado que ya no coincide con ninguna fila del Registro: ${c[1]} $${c[2]} del ${c[0].split('-').reverse().join('/')} (¿se corrigió la fecha o el nombre?).`, monto: c[2] })

  // ── Gastos ──
  const gastosMesTodos = gastos.filter(g => g.mes === mes)
  const esFilaEstimado = (g: Gasto) => g.cat === 'Anuncios' && esEstimadoMeta(g.concepto)
  const hayAnunciosReales = gastosMesTodos.some(g => g.cat === 'Anuncios' && !esFilaEstimado(g))
  const estimadosSobrantes = hayAnunciosReales ? gastosMesTodos.filter(esFilaEstimado) : []
  const gastosMes = gastosMesTodos.filter(g => !estimadosSobrantes.includes(g))
  const soloEstimadoMeta = gastosMes.some(g => g.cat === 'Anuncios') && gastosMes.filter(g => g.cat === 'Anuncios').every(esFilaEstimado)
  const payrollMes = payroll.get(mes)
  const comisiones = comisionesDelMes(pagosMes, payrollMes)
  const porCat: Record<CategoriaGasto, number> = Object.fromEntries(CATEGORIAS_GASTO.map(c => [c, 0])) as Record<CategoriaGasto, number>
  for (const g of gastosMes) porCat[g.cat] += g.monto
  // Anuncios: si Gastos no tiene anuncios del mes, se usa el gasto de Meta (API, por consumo) como ESTIMADO
  const anunciosEnGastos = gastosMes.some(g => g.cat === 'Anuncios')
  const meta = e.metaSpend[mes] ?? null
  let anunciosEstimado = soloEstimadoMeta   // la fila cargada por la automatización también es un estimado
  if (!anunciosEnGastos && meta && meta > 0) { porCat.Anuncios = meta; anunciosEstimado = true }
  // Staff = Payroll base + bonus (la comisión de Payroll NO se suma: la reemplaza la comisión calculada, sin duplicar)
  const staffPayroll = payrollMes ? payrollMes.reduce((s, f) => s + f.base + f.bonus, 0) : 0
  porCat.Staff += staffPayroll
  // Comisiones = closers/setters calculados (sin socios) + comisiones de plataforma del Registro (col L) + las cargadas en Gastos
  const comPlataforma = pagosMes.reduce((s, p) => s + p.comisionPlataforma, 0)
  porCat.Comisiones += comisiones.aPagar + comPlataforma
  const categorias = CATEGORIAS_GASTO.map(c => ({
    categoria: c,
    monto: r2(porCat[c]),
    estimado: c === 'Anuncios' && anunciosEstimado,
    detalle: c === 'Staff' ? (payrollMes ? `Payroll: ${payrollMes.length} personas (base + bonus)` : 'Sin bloque de Payroll para el mes')
      : c === 'Comisiones' ? `Closers/setters calculados $${comisiones.aPagar.toFixed(0)}${comPlataforma ? ` + plataformas $${comPlataforma.toFixed(0)}` : ''}`
      : c === 'Anuncios' && soloEstimadoMeta ? 'Estimado de Meta cargado en Gastos por la automatización de fin de mes (reemplazar con lo cobrado en Relay)'
      : c === 'Anuncios' && anunciosEstimado ? 'Estimado con el gasto de Meta (no hay anuncios cargados en Gastos)'
      : undefined,
  })).filter(c => c.categoria !== 'Sin categoría' || c.monto > 0)
  const gastoTotal = r2(categorias.reduce((s, c) => s + c.monto, 0))

  for (const g of gastosMes.filter(x => x.cat === 'Sin categoría'))
    revisar.push({ tipo: 'gasto', texto: `Gasto sin categoría: "${g.concepto}"${g.tipoTexto ? ` (Tipo de Gasto = "${g.tipoTexto}", no es una de las 8)` : ' (Tipo de Gasto vacío)'}`, monto: r2(g.monto), fila: `Gastos fila ${g.fila}` })
  for (const g of gastosMes.filter(x => x.cat === 'Devoluciones'))
    revisar.push({ tipo: 'devolucion', texto: `Devolución a confirmar: "${g.concepto}"${g.inferida ? ` — cargada como "${g.tipoTexto || 'sin tipo'}", se tomó como Devolución por el concepto` : ''}`, monto: r2(g.monto), fila: `Gastos fila ${g.fila}` })
  for (const s of sinCotizacion.filter(x => mesDe(fechaGastoFila(e.gastos, x.fila) ?? '') === mes))
    revisar.push({ tipo: 'gasto', texto: `Gasto en pesos sin cotización MEP disponible: "${s.concepto}" ($${s.ars} ARS) — no se sumó.`, fila: `Gastos fila ${s.fila}` })
  for (const g of estimadosSobrantes)
    revisar.push({ tipo: 'gasto', texto: `Fila de estimado de Meta que ya no hace falta (el mes tiene anuncios cobrados en Relay cargados): borrarla. No se suma.`, monto: r2(g.monto), fila: `Gastos fila ${g.fila}` })
  if (soloEstimadoMeta)
    revisar.push({ tipo: 'gasto', texto: `Los anuncios del mes son el estimado de Meta que cargó la automatización: reemplazarlo con lo cobrado en Relay (Facebook).`, monto: r2(porCat.Anuncios) })
  if (anunciosEstimado && !soloEstimadoMeta)
    revisar.push({ tipo: 'gasto', texto: `Anuncios del mes no cargados en Gastos: se usa el gasto de Meta ($${meta!.toFixed(2)}) como estimado. El cobro real está en Relay (Facebook).`, monto: r2(meta!) })
  if (!anunciosEnGastos && !anunciosEstimado)
    revisar.push({ tipo: 'gasto', texto: 'Sin anuncios en Gastos y sin dato de Meta para el mes.' })
  if (!payrollMes)
    revisar.push({ tipo: 'gasto', texto: 'No hay bloque de Payroll para este mes (Staff = 0).' })
  const payrollPendiente = (payrollMes ?? []).filter(f => !f.pagado)
  if (payrollPendiente.length)
    revisar.push({ tipo: 'gasto', texto: `Payroll pendiente de pago (casilla "Pagado" sin tildar): ${payrollPendiente.map(f => `${f.nombre} $${f.total}`).join(', ')}`, monto: r2(payrollPendiente.reduce((s, f) => s + f.total, 0)) })
  for (const n of comisiones.noComisionados)
    revisar.push({ tipo: 'comision', texto: `${n.pagos} pagos con Setter "${n.setter}" ($${n.base.toFixed(2)}) no generan comisión: ${n.motivo}. Si corresponde el 2,5% serían $${(n.base * 0.025).toFixed(2)}.`, monto: n.base })

  const devoluciones = r2(porCat.Devoluciones)
  const neto = r2(cash - gastoTotal)
  const margen = cash > 0 ? neto / cash : null

  // ── Reparto 50/50 (Relay = empresa, fuera del reparto) ──
  const ingresosSocio = { Tomi: r2(porCuenta.Tomi), Gero: r2(porCuenta.Gero) }
  const gastosSocio = { Tomi: 0, Gero: 0 }
  const detalleGastosSocio: { quien: 'Tomi' | 'Gero'; concepto: string; monto: number; origen: string }[] = []
  let gastosSinPagador = 0
  const gastosSinPagadorLista: string[] = []
  for (const g of gastosMes) {
    if (g.pagador === 'Tomi' || g.pagador === 'Gero') { gastosSocio[g.pagador] += g.monto; detalleGastosSocio.push({ quien: g.pagador, concepto: g.concepto, monto: r2(g.monto), origen: `Gastos fila ${g.fila}` }) }
    else if (g.pagador !== 'Empresa') { gastosSinPagador += g.monto; gastosSinPagadorLista.push(`${g.concepto}${g.pagadoPorTexto ? ` ("${g.pagadoPorTexto}")` : ''}`) }
  }
  for (const f of payrollMes ?? []) {
    if (f.pagador === 'Tomi' || f.pagador === 'Gero') { gastosSocio[f.pagador] += f.total; detalleGastosSocio.push({ quien: f.pagador, concepto: `Payroll: ${f.nombre}`, monto: r2(f.total), origen: `Payroll fila ${f.fila}` }) }
    else if (f.pagador !== 'Empresa') { gastosSinPagador += f.total; gastosSinPagadorLista.push(`Payroll: ${f.nombre}${f.pagadoPorTexto ? ` ("${f.pagadoPorTexto}")` : ''}`) }
  }
  const saldoTomi = ingresosSocio.Tomi - gastosSocio.Tomi
  const saldoGero = ingresosSocio.Gero - gastosSocio.Gero
  const dif = (saldoTomi - saldoGero) / 2
  const ingresosSinCuenta = r2(porCuenta['sin dato'])
  const reparto = {
    ingresos: ingresosSocio,
    gastos: { Tomi: r2(gastosSocio.Tomi), Gero: r2(gastosSocio.Gero) },
    saldo: { Tomi: r2(saldoTomi), Gero: r2(saldoGero) },
    deudor: Math.abs(dif) < 0.5 ? null : (dif > 0 ? 'Tomi' : 'Gero') as 'Tomi' | 'Gero' | null,
    acreedor: Math.abs(dif) < 0.5 ? null : (dif > 0 ? 'Gero' : 'Tomi') as 'Tomi' | 'Gero' | null,
    monto: r2(Math.abs(dif)),
    faltantes: {
      ingresosSinCuenta,
      pagosSinCuenta: sinCuenta.length,
      otrasCuentas: r2(porCuenta.otra),   // entró a cuentas que no son de Tomi, Gero ni Relay: fuera del reparto
      gastosSinPagador: r2(gastosSinPagador),
      gastosSinPagadorLista: gastosSinPagadorLista.slice(0, 15),
    },
    completo: ingresosSinCuenta < 0.5 && gastosSinPagador < 0.5,
    detalleGastos: detalleGastosSocio,
  }
  if (gastosSinPagador > 0.5)
    revisar.push({ tipo: 'gasto', texto: `Sin un pagador claro (Tomi / Gero / Relay), necesario para el reparto — en Payroll es la col Q ("Financiera": ¿de quién sale esa plata?): ${gastosSinPagadorLista.slice(0, 8).join(', ')}${gastosSinPagadorLista.length > 8 ? '…' : ''}`, monto: r2(gastosSinPagador) })

  // ── Monotributo: ingresos a cuentas personales, mes y 12 meses móviles (USD y ARS al MEP) ──
  const desde12 = sumarMeses(mes, -11)
  const primerMesConDatos = pagos.length ? pagos.map(p => p.mes).sort()[0] : null
  // Pesos del pago: col F del Registro; si no está, USD × MEP venta del día anterior. Si F es mucho menor que
  // USD × MEP, el pago fue MIXTO (parte en pesos y parte en dólares, p. ej. Ares De Parga 28/9: USD 1.900 + $2.790.000)
  // y F es solo la parte en pesos → se usa USD × MEP para el total.
  const arsDe = (p: Pago): { ars: number | null; viaMep: boolean } => {
    const m = mepDiaAnterior(e.mep, p.fecha)
    if (p.ars && !(m && p.ars < 0.85 * p.monto * m.valor)) return { ars: p.ars, viaMep: false }
    return m ? { ars: p.monto * m.valor, viaMep: true } : (p.ars ? { ars: p.ars, viaMep: false } : { ars: null, viaMep: true })
  }
  const monotributo = SOCIOS.map(quien => {
    // parte del pago que entró a la cuenta de `quien` (pagos partidos: proporcional, también en ARS)
    const parte = (p: Pago) => p.partes.filter(pt => pt.cuenta === quien).reduce((s, pt) => s + pt.monto, 0)
    const deQuien = (p: Pago) => p.montoEsNumero && parte(p) !== 0
    const mesP = pagosMes.filter(deQuien)
    const anioP = pagos.filter(p => deQuien(p) && p.mes >= desde12 && p.mes <= mes)
    const sumArs = (ps: Pago[]) => {
      let total = 0, sinCot = 0
      for (const p of ps) {
        const a = arsDe(p)
        if (a.ars == null) sinCot++
        else total += p.monto ? a.ars * (parte(p) / p.monto) : 0
      }
      return { total: Math.round(total), sinCot }
    }
    const mArs = sumArs(mesP), aArs = sumArs(anioP)
    return {
      quien,
      mesUsd: r2(mesP.reduce((s, p) => s + parte(p), 0)),
      mesArs: mArs.total,
      anioUsd: r2(anioP.reduce((s, p) => s + parte(p), 0)),
      anioArs: aArs.total,
      pagosSinCotizacion: mArs.sinCot + aArs.sinCot,
      pctTope: aArs.total / MONOTRIBUTO_CAT_A.topeAnualArs,
    }
  })
  // Primer mes con la cuenta conocida (comprobantes o columna): antes de eso el monotributo no tiene datos (se avisa aparte)
  const cuentaDesde = pagos.filter(p => p.fuenteCuenta).map(p => p.mes).sort()[0] ?? null
  const desdeSinCuenta = cuentaDesde && cuentaDesde > desde12 ? cuentaDesde : desde12
  const sinCuenta12 = pagos.filter(p => p.montoEsNumero && p.cuenta === 'sin dato' && p.mes >= desdeSinCuenta && p.mes <= mes)

  return {
    mes, etiqueta: etiquetaMes(mes), mesesDisponibles,
    entradas: {
      cash, cashEr,
      porCategoria: Object.fromEntries(Object.entries(porCategoria).map(([k, v]) => [k, r2(v)])) as Record<keyof typeof porCategoria, number>,
      porCuenta: Object.fromEntries(Object.entries(porCuenta).map(([k, v]) => [k, r2(v)])) as Record<Cuenta, number>,
      cantPorCuenta,
      pagos: pagosMes.length,
      tieneColCuenta, colCuentaLetra, fuenteCuenta,
    },
    gastos: {
      categorias, total: gastoTotal, anunciosEstimado, metaSpend: meta,
      lista: gastosMes.map(g => ({ fecha: g.fecha, concepto: g.concepto, monto: r2(g.monto), categoria: g.cat, inferida: g.inferida, pagadoPor: g.pagadoPorTexto || 'Relay (col F vacía)', origen: g.montoOrigen })),
      payroll: (payrollMes ?? []).map(f => ({ nombre: f.nombre, puesto: f.puesto, base: f.base, bonus: f.bonus, comision: f.comision, total: r2(f.total), pagado: f.pagado, pagadoPor: f.pagadoPorTexto })),
    },
    resultado: { ingresos: cash, gastos: gastoTotal, neto, margen, devoluciones },
    comisiones,
    reparto,
    monotributo: {
      tope: MONOTRIBUTO_CAT_A,
      desde: desde12, hasta: mes,
      datosDesde: primerMesConDatos,
      cuentaDesde,
      personas: monotributo,
      sinCuenta12: { pagos: sinCuenta12.length, usd: r2(sinCuenta12.reduce((s, p) => s + p.monto, 0)) },
      mepHoy: e.mep.length ? { valor: e.mep[e.mep.length - 1][1], fecha: e.mep[e.mep.length - 1][0] } : null,
    },
    revisar,
  }
}

export type Finanzas = ReturnType<typeof calcularFinanzas>
