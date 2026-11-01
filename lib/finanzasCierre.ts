// ── Automatización de fin de mes (Finanzas): lógica PURA, sin red ──────────────────────────
// La usa /api/finanzas-cierre. Corre todos los días (cron de Vercel) pero solo actúa cuando MAÑANA
// (hora AR) es el último día del mes:
//   1) carga en Gastos el gasto de Meta del mes como ESTIMADO (hasta leer lo cobrado en Relay), sin duplicar;
//      desde el 1/11/2026 también en la app de Finanzas (finanzas.gastos), con su propio plan sobre los gastos de la app;
//   2) arma el aviso para Tomi y Gero (Discord #finanzas).
import { MARCA_ESTIMADO_META, categoriaGasto, esEstimadoMeta, etiquetaMes, mesDe, parsearGastos, type Celda, type Fila, type Finanzas, type Gasto } from './finanzasCalc'

const pad = (n: number) => String(n).padStart(2, '0')
const r2 = (n: number) => Math.round(n * 100) / 100
const sumarDias = (ymd: string, d: number) => {
  const [y, m, dd] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd + d)).toISOString().slice(0, 10)
}
export const ultimoDiaDelMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number)
  return `${mes}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}
// true si mañana es el último día del mes de mañana (o sea, hoy es el anteúltimo día)
export function esVisperaDeFinDeMes(hoy: string): boolean {
  const manana = sumarDias(hoy, 1)
  return ultimoDiaDelMes(manana.slice(0, 7)) === manana
}
// Fecha → serial de Sheets (días desde 30/12/1899), como las fechas que ya están en la col A de Gastos
export const serialSheets = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000)
}
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

// Formato es-AR: US$ 1.234,56 · $ 1.234.567 (pesos)
const usd = (n: number) => `US$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usd0 = (n: number) => `US$ ${Math.round(n).toLocaleString('es-AR')}`
const ars = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
const pct = (x: number) => `${(x * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`

// ── 1) Gasto de Meta → fila de Anuncios estimada en Gastos ──
export type PlanMeta =
  | { accion: 'nada'; motivo: string }
  | { accion: 'agregar'; fila: number; rango: string; valores: (string | number)[]; monto: number; fecha: string }
  | { accion: 'actualizar'; fila: number; rango: string; montoAnterior: number; monto: number }

const filaVacia = (r: Fila | undefined) => !r || r.every(c => c == null || String(c).trim() === '')

export function planAnunciosMeta(gastos: Fila[], mes: string, hoy: string, metaMes: number | null | undefined): PlanMeta {
  if (!metaMes || metaMes <= 0) return { accion: 'nada', motivo: 'No hay dato de gasto de Meta para el mes (API sin respuesta o sin consumo).' }
  const monto = r2(metaMes)
  const anuncios = parsearGastos(gastos, []).lista.filter(g => g.mes === mes && g.cat === 'Anuncios')
  const reales = anuncios.filter(g => !esEstimadoMeta(g.concepto))
  if (reales.length) {
    const total = reales.reduce((s, g) => s + g.monto, 0)
    return { accion: 'nada', motivo: `Ya hay anuncios del mes cargados en Gastos (${usd(total)}, fila ${reales.map(g => g.fila).join(', ')}): no se carga el estimado.` }
  }
  const est = anuncios.find(g => esEstimadoMeta(g.concepto))
  if (est) {
    if (Math.abs(est.monto - monto) < 0.5) return { accion: 'nada', motivo: `El estimado de Meta ya estaba cargado (fila ${est.fila}, ${usd(est.monto)}).` }
    return { accion: 'actualizar', fila: est.fila, rango: `Gastos!C${est.fila}`, montoAnterior: r2(est.monto), monto }
  }
  // Reglas del usuario (30/9/2026) para escribir en Gastos: fila nueva AL FINAL (pegada a la última con datos),
  // A = fecha como serial (el formato se copia de la fila anterior), B concepto, C monto USD, D = "Anuncios";
  // UNA fila "ADS" con fecha del ÚLTIMO día del mes; E y F vacías. Nada más en el sheet.
  let ultima = gastos.length
  while (ultima > 1 && filaVacia(gastos[ultima - 1])) ultima--
  const fila = ultima + 1
  const fecha = ultimoDiaDelMes(mes)
  const valores: (string | number)[] = [serialSheets(fecha), conceptoEstimadoMeta(hoy), monto, 'Anuncios']
  return { accion: 'agregar', fila, rango: `Gastos!A${fila}:D${fila}`, valores, monto, fecha }
}

// Mismo concepto en la planilla y en la app (así se reconoce como estimado en las dos)
export const conceptoEstimadoMeta = (hoy: string) => `ADS (${MARCA_ESTIMADO_META}; Meta al ${ddmm(hoy)})`

// ── 1b) Lo mismo en la app de Finanzas (1/11/2026, «pasa todo a la app»): el plan se arma con los gastos de la APP,
// porque desde ahora los gastos se cargan ahí y la planilla puede no tener los anuncios reales. Mismas reglas: si hay
// anuncios reales del mes no se carga; si ya está el estimado con el mismo monto, nada; si cambió, se actualiza (solo
// una fila web: las importadas de la planilla no se tocan); si no, UN gasto "ADS" con fecha del último día del mes.
export type PlanMetaApp =
  | { accion: 'nada'; motivo: string }
  | { accion: 'agregar'; fecha: string; concepto: string; monto: number }
  | { accion: 'actualizar'; id: number; montoAnterior: number; monto: number }

export function planAnunciosMetaApp(gastos: Gasto[], mes: string, hoy: string, metaMes: number | null | undefined): PlanMetaApp {
  if (!metaMes || metaMes <= 0) return { accion: 'nada', motivo: 'No hay dato de gasto de Meta para el mes (API sin respuesta o sin consumo).' }
  const monto = r2(metaMes)
  const anuncios = gastos.filter(g => g.mes === mes && g.cat === 'Anuncios')
  const reales = anuncios.filter(g => !esEstimadoMeta(g.concepto))
  if (reales.length) {
    const total = reales.reduce((s, g) => s + g.monto, 0)
    return { accion: 'nada', motivo: `Ya hay anuncios del mes cargados en la app (${usd(total)}): no se carga el estimado.` }
  }
  const est = anuncios.find(g => esEstimadoMeta(g.concepto))
  if (est) {
    if (Math.abs(est.monto - monto) < 0.5) return { accion: 'nada', motivo: `El estimado de Meta ya estaba cargado en la app (${usd(est.monto)}).` }
    if (!est.web || est.id == null) return { accion: 'nada', motivo: `El estimado de Meta de la app (${usd(est.monto)}) es una fila importada: corregirlo a ${usd(monto)} con «Corregir dato».` }
    return { accion: 'actualizar', id: est.id, montoAnterior: r2(est.monto), monto }
  }
  return { accion: 'agregar', fecha: ultimoDiaDelMes(mes), concepto: conceptoEstimadoMeta(hoy), monto }
}

// Aplica el plan de la app sobre una COPIA de los gastos (para el mensaje con el gasto ya cargado)
export function gastosAppConPlan(gastos: Gasto[], plan: PlanMetaApp): Gasto[] {
  if (plan.accion === 'actualizar') return gastos.map(g => (g.id === plan.id ? { ...g, monto: plan.monto } : g))
  if (plan.accion !== 'agregar') return gastos
  const { cat, inferida } = categoriaGasto('Anuncios', plan.concepto)
  return [...gastos, {
    fila: 0, ref: 'Gasto nuevo del cierre', web: true, fecha: plan.fecha, mes: mesDe(plan.fecha), concepto: plan.concepto,
    monto: plan.monto, montoOrigen: 'USD', tipoTexto: 'Anuncios', cat, inferida, pagadoPorTexto: '', pagador: 'Empresa',
  }]
}

// Aplica el plan sobre una COPIA de las filas (para calcular el mensaje con la fila ya cargada)
export function gastosConPlan(gastos: Fila[], plan: PlanMeta): Fila[] {
  const copia: Fila[] = gastos.map(r => [...r])
  if (plan.accion === 'agregar') {
    while (copia.length < plan.fila - 1) copia.push([])
    copia[plan.fila - 1] = plan.valores as Celda[]
  } else if (plan.accion === 'actualizar') {
    const r = copia[plan.fila - 1] ?? []
    r[2] = plan.monto
    copia[plan.fila - 1] = r
  }
  return copia
}

// ── 2) Mensaje para Discord ──
export interface ContextoMensaje {
  mencion: string                 // "<@id> <@id>"
  resultadoMeta: string           // qué pasó con la fila de Meta (ya redactado)
  urlFinanzas: string
  hoy: string
  fuente?: 'app' | 'planilla'     // de dónde salieron pagos y gastos (1/11/2026: la app de Finanzas)
}

export function armarMensajeCierre(f: Finanzas, ctx: ContextoMensaje): string[] {
  const partes: string[] = []
  const nombreMes = etiquetaMes(f.mes)
  const ultimo = ultimoDiaDelMes(f.mes)
  const enMes = ctx.hoy.slice(0, 7) === f.mes
  const enApp = ctx.fuente === 'app'
  const dondeGastos = enApp ? 'la app de Finanzas' : 'la pestaña Gastos'

  partes.push(`${ctx.mencion}\n📆 **CIERRE DE MES — ${nombreMes}**${enMes && sumarDias(ctx.hoy, 1) === ultimo ? ' _(mañana es el último día)_' : ''}\n` +
    `🏦 **Pendiente: entrar a Relay** para cargar los gastos del banco del mes (software, Facebook cobrado, devoluciones de Stripe, comisiones). ` +
    `Iniciá sesión en Relay en Chrome y avisale al asistente: los carga en ${dondeGastos}.`)

  // Gastos cargados en la pestaña Gastos
  const lista = f.gastos.lista
  const totalCargado = r2(lista.reduce((s, g) => s + g.monto, 0))
  const porCat = new Map<string, number>()
  for (const g of lista) porCat.set(g.categoria, (porCat.get(g.categoria) ?? 0) + g.monto)
  const sinCat = lista.filter(g => g.categoria === 'Sin categoría')
  const lineasG = [
    lista.length
      ? `• Por categoría: ${[...porCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, m]) => `${c} ${usd(m)}`).join(' · ')}`
      : '• No hay gastos del mes cargados todavía.',
    `• Anuncios (Meta): ${ctx.resultadoMeta}`,
    sinCat.length
      ? `• ⚠️ Sin categoría (${sinCat.length}): ${sinCat.slice(0, 8).map(g => `"${g.concepto}" ${usd(g.monto)}`).join(', ')}${sinCat.length > 8 ? '…' : ''}`
      : '• Todos los gastos cargados tienen categoría ✅',
    `• Resultado del mes (con Payroll y comisiones): gastos ${usd(f.resultado.gastos)} · neto ${usd(f.resultado.neto)}${f.resultado.margen != null ? ` · margen ${pct(f.resultado.margen)}` : ''}${f.gastos.anunciosEstimado ? ' _(anuncios estimados)_' : ''}`,
  ]
  partes.push(`🧾 **Gastos cargados en ${dondeGastos}: ${usd(totalCargado)}** (${lista.length} ${enApp ? 'gastos' : 'filas'})\n${lineasG.join('\n')}`)

  // Payroll
  const pay = f.gastos.payroll
  if (!pay.length) partes.push(`👥 **Payroll pendiente:** la pestaña Payroll no tiene el bloque de ${nombreMes}. Cargarlo (sueldos, bonus, comisiones y quién pagó en la col Q).`)
  else {
    const pend = pay.filter(p => !p.pagado)
    const total = pay.reduce((s, p) => s + p.total, 0)
    partes.push(`👥 **Payroll de ${nombreMes}: ${usd(total)}** (${pay.length} ${pay.length === 1 ? 'persona' : 'personas'})\n` +
      (pend.length ? `• ⚠️ Sin marcar como pagado (${pend.length}): ${pend.slice(0, 10).map(p => `${p.nombre} ${usd(p.total)}`).join(', ')}${pend.length > 10 ? '…' : ''}` : '• Todo marcado como pagado ✅'))
  }

  // Comisiones
  const c = f.comisiones
  const aPagar = c.lineas.filter(l => !l.socio && l.comision > 0)
  // Tomi y Gero son socios: no cobran comisión (confirmado por el usuario 1/10), no se mencionan
  const lineasC = [
    ...aPagar.map(l => `• ${l.persona} (${l.rol}) ${usd(l.comision)} — ${l.regla}, base ${usd0(l.base)}${l.payroll != null ? ` · Payroll ${usd(l.payroll)}` : ''}`),
    ...c.noComisionados.map(n => `• ⚠️ ${n.pagos} pagos con Setter "${n.setter}" (${usd0(n.base)}) no generan comisión en el sheet — si corresponde el 2,5%: ${usd(n.base * 0.025)}`),
  ]
  partes.push(`💸 **Comisiones a pagar: ${usd(c.aPagar)}**${c.payrollTotal != null ? ` _(Payroll registra ${usd(c.payrollTotal)})_` : ''}\n${lineasC.length ? lineasC.join('\n') : '• Sin comisiones este mes'}`)

  // Devoluciones
  const devs = lista.filter(g => g.categoria === 'Devoluciones')
  const devsRegistro = f.revisar.filter(r => r.tipo === 'devolucion' && (r.fila?.startsWith('Registro') || r.fila?.startsWith('Pago #')))
  partes.push(`↩️ **Devoluciones del mes: ${usd(f.resultado.devoluciones)}**\n` +
    (devs.length ? devs.slice(0, 10).map(g => `• ${g.concepto} ${usd(g.monto)}${g.inferida ? ' _(cargada como otro tipo)_' : ''}`).join('\n') : '• Ninguna cargada en Gastos (las de Stripe aparecen en Relay como "STRIPE ACH Pull").') +
    (devsRegistro.length ? `\n• ⚠️ En ${enApp ? 'los pagos de la app' : 'el Registro de Pagos'} hay ${devsRegistro.length} pago(s) que parecen devolución: revisar en /finanzas.` : ''))

  // Entradas por cuenta
  const e = f.entradas
  const lineasE = [
    `• Tomi ${usd(e.porCuenta.Tomi)} (${e.cantPorCuenta.Tomi}) · Gero ${usd(e.porCuenta.Gero)} (${e.cantPorCuenta.Gero}) · Relay ${usd(e.porCuenta.Relay)} (${e.cantPorCuenta.Relay})${e.porCuenta.Financiera > 0 ? ` · Financiera ${usd(e.porCuenta.Financiera)} (${e.cantPorCuenta.Financiera})` : ''}`,
  ]
  const sinDato = e.porCuenta['sin dato'], nSinDato = e.cantPorCuenta['sin dato']
  if (e.porCuenta.otra > 0) lineasE.push(`• Otras cuentas (Pagos Rio, efectivo, dLocal, etc.) ${usd(e.porCuenta.otra)} (${e.cantPorCuenta.otra})`)
  if (e.fuenteCuenta === 'app') lineasE.push('• _Cuenta de cada pago según «quién recibió» de la app de Finanzas («Tomi y Gero» = mitad y mitad)._')
  if (e.fuenteCuenta === 'comprobantes') lineasE.push('• _Cuenta de cada pago según los comprobantes revisados (jul–sep 2026)._')
  if (!e.fuenteCuenta) lineasE.push(`• ⚠️ No se sabe a qué cuenta entraron los pagos del mes (${usd(sinDato)}, ${nSinDato} pagos): el Registro no tiene ese dato. Falta decidir cómo registrarlo.`)
  else if (nSinDato) lineasE.push(`• ⚠️ Sin cuenta (${nSinDato} pagos): ${usd(sinDato)} — ver "A revisar" en /finanzas.`)
  partes.push(`💰 **Entró en el mes: ${usd(e.cash)}** (${e.pagos} pagos)\n${lineasE.join('\n')}`)

  // Reparto 50/50
  const rp = f.reparto
  const quien = rp.deudor && rp.acreedor ? `**${rp.deudor} le debe ${usd(rp.monto)} a ${rp.acreedor}**` : '**Están a mano**'
  const faltan: string[] = []
  if (rp.faltantes.ingresosSinCuenta > 0.5) faltan.push(`${usd(rp.faltantes.ingresosSinCuenta)} de ingresos sin cuenta`)
  if (rp.faltantes.gastosSinPagador > 0.5) faltan.push(`${usd(rp.faltantes.gastosSinPagador)} de gastos sin quién pagó`)
  if (!e.fuenteCuenta) partes.push(`⚖️ **Reparto 50/50:** no se puede calcular — no se sabe a qué cuenta entró cada pago del mes.`)
  else partes.push(`⚖️ **Reparto 50/50:** ${quien}${rp.completo ? '' : ' _(provisorio)_'}\n` +
    `• Tomi: entró ${usd(rp.ingresos.Tomi)} − pagó ${usd(rp.gastos.Tomi)} = ${usd(rp.saldo.Tomi)}\n` +
    `• Gero: entró ${usd(rp.ingresos.Gero)} − pagó ${usd(rp.gastos.Gero)} = ${usd(rp.saldo.Gero)}` +
    (faltan.length ? `\n• ⚠️ Faltan datos: ${faltan.join(' y ')}. El número puede cambiar.` : ''))

  // Monotributo
  const m = f.monotributo
  const lineasM = m.personas.map(p => `• ${p.quien}: ${ars(p.anioArs)} en 12 meses → **${pct(p.pctTope)} del tope**${p.pctTope >= 0.8 ? ' ⚠️' : ''} · este mes ${ars(p.mesArs)} (${usd(p.mesUsd)})${p.pagosSinCotizacion ? ` · ${p.pagosSinCotizacion} pagos sin cotización` : ''}`)
  const notasM: string[] = []
  if (m.cuentaDesde && m.cuentaDesde > m.desde) notasM.push(`la cuenta de cada pago se conoce desde ${etiquetaMes(m.cuentaDesde)}: lo anterior no está sumado, el número real es mayor`)
  if (m.sinCuenta12.pagos) notasM.push(`${m.sinCuenta12.pagos} pagos (${usd0(m.sinCuenta12.usd)}) sin cuenta no se cuentan`)
  if (!m.cuentaDesde) partes.push(`🧮 **Monotributo — Categoría A** (tope ${ars(m.tope.topeAnualArs)} anual)\n• Sin datos: no se sabe a qué cuenta entró cada pago.\n• Es un seguimiento: las decisiones las toma el contador.`)
  else partes.push(`🧮 **Monotributo — Categoría A** (tope ${ars(m.tope.topeAnualArs)} anual)\n${lineasM.join('\n')}` +
    (notasM.length ? `\n• ${notasM.join(' · ')}` : '') + `\n• Es un seguimiento: las decisiones las toma el contador.`)

  partes.push(`🔗 Detalle y lista "A revisar": ${ctx.urlFinanzas}`)
  return partes
}
