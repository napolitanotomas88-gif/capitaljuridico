// Motor de la Conciliación de Cuentas. Funciones puras: SOLO LEEN datos y devuelven sugerencias.
// Reglas aprobadas (ver docs/conciliacion.md):
//  - Solo se concilian movimientos de la vista movimientos_cuenta_empresa (ingresos y gastos de empresa).
//  - Monto exacto (±$0,01) como condición base. Nada se confirma solo, nada se crea solo.
//  - Los resúmenes de Cuentas se usan ÚNICAMENTE en "controles del mes"; no entran en ningún cálculo empresarial.
//  - Ninguna conciliación modifica Pagos, Gastos, Cuentas, Payroll, Estado de Resultados ni Dashboard.

export const TOLERANCIA = 0.011
export const DIAS_FECHA = 7

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const STOP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'pago', 'pagos', 'en', 'pesos', 'con', 'por', 'para', 'cuota', 'fee', 'pif', 'sena', 'mitad', 'mes', 'ads'])
const tokens = (s) => new Set(norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t)))
const compartidos = (a, b) => [...a].filter((t) => b.has(t)).length
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const mesDe = (periodoOFecha) => (periodoOFecha ? String(periodoOFecha).slice(0, 7) : null)
const dias = (a, b) => Math.abs((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000)
const igualMonto = (a, b) => Math.abs(Math.abs(Number(a)) - Math.abs(Number(b))) <= TOLERANCIA

/** Compara un movimiento con un candidato (fuente). Devuelve null si el monto no es exacto. */
function evaluar(m, c) {
  if (!igualMonto(m.monto, c.monto)) return null
  const mesM = mesDe(m.periodo ?? m.fecha)
  const fecha7 = !!(m.fecha && c.fecha && dias(m.fecha, c.fecha) <= DIAS_FECHA)
  const mesIgual = !!(mesM && c.mes && mesM === c.mes)
  const mesDistinto = !!(mesM && c.mes && mesM !== c.mes) && !fecha7
  const comp = compartidos(m.tk, c.tk)
  let pts = 60
  const razones = ['monto exacto']
  if (fecha7) { pts += 30; razones.push(`fecha dentro de ±${DIAS_FECHA} días`) }
  else if (mesIgual) { pts += 15; razones.push('mismo mes') }
  else if (mesDistinto) { pts -= 25; razones.push('mes distinto') }
  else razones.push('sin período para comparar')
  if (comp >= 1) { pts += Math.min(30, 15 * comp); razones.push(`nombre parecido (${comp})`) }
  const apoyo = fecha7 || (comp >= 1 && !mesDistinto)
  // débil = mes distinto sin respaldo de fecha ni nombre: solo se ofrece en "elegir otro"
  const nivel = mesDistinto && comp === 0 ? 'debil' : apoyo ? 'alta' : 'media'
  return { c, pts, razones, nivel }
}

const claveDestino = (c) => `${c.tipo}:${c.id}`

/**
 * Empareja movimientos con candidatos (1 a 1, sin repetir destino). No decide nada: solo sugiere.
 * @returns Map(movId -> { estado: 'alta'|'media'|'ambigua'|'sin_coincidencia', mejor, candidatos, debiles })
 */
function emparejar(movs, fuentes, ocupados) {
  const disponibles = fuentes.filter((c) => !ocupados.has(claveDestino(c)))
  const info = new Map()
  for (const m of movs) {
    const evs = disponibles.map((c) => evaluar(m, c)).filter(Boolean).sort((a, b) => b.pts - a.pts)
    const fuertes = evs.filter((e) => e.nivel !== 'debil')
    info.set(m.id, { m, fuertes, debiles: evs.filter((e) => e.nivel === 'debil') })
  }
  const res = new Map()
  const tomados = new Set()
  const orden = [...info.values()].sort((a, b) => (b.fuertes[0]?.pts ?? -1) - (a.fuertes[0]?.pts ?? -1))
  for (const { m, fuertes, debiles } of orden) {
    if (!fuertes.length) { res.set(m.id, { estado: 'sin_coincidencia', mejor: null, candidatos: [], debiles }); continue }
    const top = fuertes[0].pts
    const empatados = fuertes.filter((e) => e.pts === top)
    if (empatados.length > 1) { res.set(m.id, { estado: 'ambigua', mejor: null, candidatos: fuertes, debiles }); continue }
    const libre = fuertes.find((e) => !tomados.has(claveDestino(e.c)))
    if (!libre) { res.set(m.id, { estado: 'sin_coincidencia', mejor: null, candidatos: fuertes, debiles, nota: 'Su candidato ya fue asignado a otro movimiento.' }); continue }
    tomados.add(claveDestino(libre.c))
    res.set(m.id, { estado: libre.nivel, mejor: libre, candidatos: fuertes, debiles })
  }
  return res
}

/**
 * @param {object} d
 * @param {object[]} d.movimientos     filas de la VISTA movimientos_cuenta_empresa: {id, cuenta_id, fecha, periodo, descripcion, monto, tipo, hoja_origen}
 * @param {object[]} d.resumenes       resúmenes de Cuentas (SOLO para controles): {id, periodo, descripcion, monto}
 * @param {object[]} d.pagos           {id, fecha, monto_usd, cliente, concepto}
 * @param {object[]} d.gastos          {id, fecha, monto_usd, concepto, tipo}
 * @param {object[]} d.equipo          {id, mes, total_usd, persona}
 * @param {object[]} d.conciliaciones  decisiones ya guardadas: {id, movimiento_cuenta_id, estado, destino_tipo, destino_id, destino_mes, confianza, nota}
 */
export function calcularConciliacion({ movimientos = [], resumenes = [], pagos = [], gastos = [], equipo = [], conciliaciones = [] }) {
  const decisiones = new Map(conciliaciones.map((c) => [c.movimiento_cuenta_id, c]))

  // ---- fuentes normalizadas
  const fPagos = pagos.map((p) => ({ tipo: 'pago', id: p.id, fecha: p.fecha, mes: mesDe(p.fecha), monto: Number(p.monto_usd), texto: p.cliente, tk: tokens(p.cliente), original: p }))
  const fGastos = gastos.map((g) => ({ tipo: 'gasto', id: g.id, fecha: g.fecha, mes: mesDe(g.fecha), monto: Number(g.monto_usd), texto: g.concepto, tk: tokens(g.concepto), original: g }))
  const fLineas = equipo.map((e) => ({ tipo: 'payroll_linea', id: e.id, fecha: null, mes: mesDe(e.mes), monto: Number(e.total_usd), texto: e.persona, tk: tokens(e.persona), original: e }))
  const totalesMes = {}
  equipo.forEach((e) => { totalesMes[mesDe(e.mes)] = (totalesMes[mesDe(e.mes)] || 0) + Number(e.total_usd) })
  const fMeses = Object.entries(totalesMes).filter(([, t]) => t > 0).map(([mes, t]) => ({ tipo: 'payroll_mes', id: mes, fecha: null, mes, monto: r2(t), texto: 'pago al equipo total del mes', tk: tokens('equipo'), original: { mes, total: r2(t) } }))

  // ---- destinos ya ocupados por decisiones confirmadas (no se vuelven a sugerir)
  const ocupados = new Set()
  conciliaciones.forEach((c) => { if (c.estado === 'conciliado' && (c.destino_tipo === 'pago' || c.destino_tipo === 'gasto')) ocupados.add(`${c.destino_tipo}:${c.destino_id}`) })

  const prep = (m) => ({ ...m, monto: Number(m.monto), tk: tokens(m.descripcion) })
  const todos = movimientos.map(prep)
  const ingresos = todos.filter((m) => m.tipo === 'Ingreso empresa')
  const gastosM = todos.filter((m) => m.tipo === 'Gasto empresa')
  const otros = todos.filter((m) => m.tipo !== 'Ingreso empresa' && m.tipo !== 'Gasto empresa')

  // ---- ingresos <-> pagos
  const pendIng = ingresos.filter((m) => !decisiones.has(m.id))
  const sugIng = emparejar(pendIng, fPagos, ocupados)

  // ---- gastos <-> gastos; los que no calzan, contra Payroll (línea o total del mes); si no, posible pago parcial
  const pendGas = gastosM.filter((m) => !decisiones.has(m.id))
  const sugGas = emparejar(pendGas, fGastos, ocupados)
  const resto = pendGas.filter((m) => sugGas.get(m.id).estado === 'sin_coincidencia')
  const sugLin = emparejar(resto, fLineas, new Set())
  const sugMes = emparejar(resto.filter((m) => sugLin.get(m.id).estado === 'sin_coincidencia'), fMeses, new Set())
  for (const m of resto) {
    const l = sugLin.get(m.id)
    if (l.estado !== 'sin_coincidencia') { sugGas.set(m.id, { ...l, destinoFuente: 'payroll' }); continue }
    const s = sugMes.get(m.id)
    if (s && s.estado !== 'sin_coincidencia') { sugGas.set(m.id, { ...s, destinoFuente: 'payroll' }); continue }
    // posible pago parcial: el nombre coincide con alguien de Payroll en el mismo mes (no se concilia sola)
    const mes = mesDe(m.periodo ?? m.fecha)
    const parcial = fLineas.filter((c) => compartidos(m.tk, c.tk) >= 1 && (!mes || c.mes === mes))
    sugGas.set(m.id, { ...sugGas.get(m.id), parcial })
  }

  const fila = (m, sug) => ({ mov: m, decision: decisiones.get(m.id) || null, sugerencia: decisiones.has(m.id) ? null : sug.get(m.id) || null })
  const filasIng = ingresos.map((m) => fila(m, sugIng))
  const filasGas = gastosM.map((m) => fila(m, sugGas))
  const filasOtros = otros.map((m) => ({ mov: m, decision: decisiones.get(m.id) || null, sugerencia: null }))

  // ---- contadores
  const contar = (filas) => {
    const c = { total: filas.length, usd: r2(filas.reduce((s, f) => s + f.mov.monto, 0)), decididos: 0, conciliados: 0, sinContraparte: 0, faltaRegistrar: 0, ignorados: 0, duplicados: 0, alta: 0, media: 0, ambigua: 0, sinCoincidencia: 0, altaUsd: 0, pendientes: 0 }
    for (const f of filas) {
      if (f.decision) {
        c.decididos++
        if (f.decision.estado === 'conciliado') c.conciliados++
        else if (f.decision.estado === 'sin_contraparte') c.sinContraparte++
        else if (f.decision.estado === 'falta_registrar') c.faltaRegistrar++
        else if (f.decision.estado === 'ignorado') c.ignorados++
        else if (f.decision.estado === 'duplicado_cuentas') c.duplicados++
      } else if (f.sugerencia) {
        c.pendientes++
        const e = f.sugerencia.estado
        if (e === 'alta') { c.alta++; c.altaUsd += Math.abs(f.mov.monto) }
        else if (e === 'media') c.media++
        else if (e === 'ambigua') c.ambigua++
        else c.sinCoincidencia++
      }
    }
    c.altaUsd = r2(c.altaUsd)
    return c
  }

  // ---- posibles duplicados dentro de Cuentas: más movimientos iguales que destinos posibles
  const claveDup = (m) => `${norm(m.descripcion).trim()}|${Math.abs(m.monto)}|${mesDe(m.periodo ?? m.fecha) || '?'}`
  const grupos = new Map()
  ;[...ingresos, ...gastosM].forEach((m) => { const k = claveDup(m); grupos.set(k, [...(grupos.get(k) || []), m]) })
  const duplicados = []
  for (const [k, ms] of grupos) {
    if (ms.length < 2) continue
    const fuente = ms[0].tipo === 'Ingreso empresa' ? fPagos : [...fGastos, ...fLineas]
    const mes = mesDe(ms[0].periodo ?? ms[0].fecha)
    const destinos = fuente.filter((c) => igualMonto(c.monto, ms[0].monto) && (!mes || c.mes === mes)).length
    if (ms.length > destinos) duplicados.push({ clave: k, movimientos: ms, destinosPosibles: destinos, decisiones: ms.map((m) => decisiones.get(m.id) || null) })
  }

  // ---- controles del mes con los resúmenes (SOLO control de calidad)
  const meses = [...new Set(resumenes.map((r) => mesDe(r.periodo)).filter(Boolean))].sort()
  const controles = meses.map((mes) => {
    const rs = resumenes.filter((r) => mesDe(r.periodo) === mes)
    const cashRes = rs.filter((r) => /cash collected/i.test(r.descripcion)).reduce((s, r) => s + Number(r.monto), 0)
    const adsRes = rs.filter((r) => /^ads$/i.test(String(r.descripcion).trim())).reduce((s, r) => s + Math.abs(Number(r.monto)), 0)
    const cashPagos = pagos.filter((p) => mesDe(p.fecha) === mes).reduce((s, p) => s + Number(p.monto_usd), 0)
    const adsGastos = gastos.filter((g) => mesDe(g.fecha) === mes && /anuncio/i.test(g.tipo || '')).reduce((s, g) => s + Number(g.monto_usd), 0)
    const tieneCash = cashRes !== 0, tieneAds = adsRes !== 0
    const difCash = r2(cashRes - cashPagos), difAds = r2(adsRes - adsGastos)
    return {
      mes, cashResumenes: r2(cashRes), cashPagos: r2(cashPagos), difCash: tieneCash ? difCash : null, estadoCash: !tieneCash ? null : Math.abs(difCash) < 0.005 ? 'ok' : 'diferencia',
      adsResumenes: r2(adsRes), adsGastos: r2(adsGastos), difAds: tieneAds ? difAds : null, estadoAds: !tieneAds ? null : Math.abs(difAds) < 0.005 ? 'ok' : 'diferencia',
    }
  })

  // ---- cobertura: ¿qué parte de los pagos de cada mes aparece en Cuentas?
  const pagoConfirmado = new Set(conciliaciones.filter((c) => c.estado === 'conciliado' && c.destino_tipo === 'pago').map((c) => Number(c.destino_id)))
  const pagoSugerido = new Set(filasIng.filter((f) => f.sugerencia && ['alta', 'media'].includes(f.sugerencia.estado)).map((f) => Number(f.sugerencia.mejor.c.id)))
  const mesesPagos = [...new Set(pagos.map((p) => mesDe(p.fecha)))].sort()
  const cobertura = mesesPagos.map((mes) => {
    const ps = pagos.filter((p) => mesDe(p.fecha) === mes)
    const usd = ps.reduce((s, p) => s + Number(p.monto_usd), 0)
    const conf = ps.filter((p) => pagoConfirmado.has(Number(p.id))), sug = ps.filter((p) => !pagoConfirmado.has(Number(p.id)) && pagoSugerido.has(Number(p.id)))
    const usdC = conf.reduce((s, p) => s + Number(p.monto_usd), 0), usdS = sug.reduce((s, p) => s + Number(p.monto_usd), 0)
    return { mes, pagos: ps.length, usd: r2(usd), confirmados: conf.length, usdConfirmados: r2(usdC), sugeridos: sug.length, usdSugeridos: r2(usdS), pctConfirmado: usd ? usdC / usd : null, pctConConSugeridos: usd ? (usdC + usdS) / usd : null }
  })

  return {
    ingresos: { filas: filasIng, ...contar(filasIng) },
    gastos: { filas: filasGas, ...contar(filasGas) },
    otros: { filas: filasOtros, total: filasOtros.length },
    duplicados, controles, cobertura,
  }
}

/** Datos de la decisión a guardar para una sugerencia o un candidato elegido. */
export function decisionDesdeCandidato(movId, cand, confianza, nota = null) {
  const c = cand.c || cand
  const base = { movimiento_cuenta_id: movId, estado: 'conciliado', confianza, nota, destino_tipo: c.tipo, destino_id: null, destino_mes: null }
  if (c.tipo === 'payroll_mes') return { ...base, destino_mes: `${c.id}-01` }
  return { ...base, destino_id: c.id }
}

export const etiquetaDestino = (c) => (c.tipo === 'pago' ? `Pago de ${c.texto}` : c.tipo === 'gasto' ? `Gasto "${c.texto}"` : c.tipo === 'payroll_linea' ? `Payroll: ${c.texto}` : `Payroll: total de ${c.mes}`)
