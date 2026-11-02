// «Pagado por» repartido en Pagos del equipo (pedido de Tomás, 1/11/2026): «que pueda elegir quién paga tanto porcentaje,
// ya sea Tomi, Gero, Financiera o Empresa» (ej.: Carlos comisionó USD 4.000; Gero paga 80 % y Tomi 20 %).
// Reglas puras (sin base): validar el reparto, armar el resumen legible y repartir el total de la línea en USD.
// En la base: finanzas.pagos_equipo_pagadores + finanzas.reemplazar_pagadores() (db/finanzas/migraciones/2026-11-01-pagadores.sql).
// El resumen de acá es el MISMO que arma finanzas.resumen_pagadores() (lo comprueban los tests).

export const QUIENES_PAGAN = ['Tomi', 'Gero', 'Financiera', 'Empresa']

const aC = (v) => Math.round(Number(v) * 100 + (Number(v) >= 0 ? 1e-7 : -1e-7))
const orden = (q) => { const i = QUIENES_PAGAN.indexOf(q); return i < 0 ? 99 : i }
const pctTexto = (p) => {
  const c = aC(p)
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace(/0$/, '').replace('.', ',')
}

/** Filas del editor: [{ quien, porcentaje }] con el porcentaje como texto. Por defecto, una fila al 100 %. */
export const filaVacia = (porcentaje = '100') => ({ quien: '', porcentaje })
export const repartoInicial = () => [filaVacia()]
export const repartoUno = (quien = '') => [{ quien, porcentaje: '100' }]
export const repartoMitades = () => [{ quien: 'Tomi', porcentaje: '50' }, { quien: 'Gero', porcentaje: '50' }]

/**
 * Reparto de una línea leída de pagos_equipo_vigentes, para el editor. Usa la columna `pagadores`; si la línea todavía no
 * tiene (p. ej. «Otro» o vacío), arranca de pagado_por si es uno de los cuatro, y si no, una fila vacía al 100 %.
 */
export function repartoDeLinea(l) {
  const ps = Array.isArray(l?.pagadores) ? l.pagadores : []
  if (ps.length) return ordenar(ps).map((p) => ({ quien: p.quien, porcentaje: pctTexto(p.porcentaje) }))
  if (QUIENES_PAGAN.includes(l?.pagado_por)) return repartoUno(l.pagado_por)
  return repartoInicial()
}

const ordenar = (ps) => [...ps].sort((a, b) => aC(b.porcentaje) - aC(a.porcentaje) || orden(a.quien) - orden(b.quien))

/**
 * Valida las filas del editor. Devuelve { errores, reparto } donde `reparto` es lo que se guarda:
 * [{ quien, porcentaje: number }] ordenado, o [] si no se eligió a nadie (una sola fila sin «quién» = sin dato).
 * Los mensajes llevan «Pagado por» (la pantalla los ubica al lado de ese campo).
 */
export function validarReparto(filas) {
  const lista = Array.isArray(filas) ? filas : []
  if (lista.length === 0 || (lista.length === 1 && !lista[0].quien)) return { errores: [], reparto: [] }
  const errores = []
  if (lista.some((f) => !f.quien)) errores.push('«Pagado por»: elegí quién paga en cada fila (o quitá la fila).')
  if (lista.some((f) => f.quien && !QUIENES_PAGAN.includes(f.quien))) errores.push(`«Pagado por»: solo ${QUIENES_PAGAN.join(', ')}.`)
  const vistos = new Set()
  for (const f of lista) {
    if (!f.quien) continue
    if (vistos.has(f.quien)) { errores.push(`«Pagado por»: ${f.quien} aparece dos veces; juntalo en una sola fila.`); break }
    vistos.add(f.quien)
  }
  let malPct = false
  for (const f of lista) {
    const t = String(f.porcentaje ?? '').trim().replace(',', '.')
    const n = Number(t)
    if (t === '' || !Number.isFinite(n) || n <= 0 || n > 100 || !/^\d+(\.\d{1,2})?$/.test(t)) malPct = true
  }
  if (malPct) errores.push('«Pagado por»: cada porcentaje tiene que ser mayor que 0 y hasta 100 (con 2 decimales como máximo).')
  if (!malPct) {
    const suma = lista.reduce((s, f) => s + aC(String(f.porcentaje).replace(',', '.')), 0)
    if (Math.abs(suma - 10000) > 1) errores.push(`«Pagado por»: los porcentajes suman ${pctTexto(suma / 100)}% y tienen que sumar 100%.`)
  }
  if (errores.length) return { errores, reparto: [] }
  return { errores, reparto: ordenar(lista.map((f) => ({ quien: f.quien, porcentaje: aC(String(f.porcentaje).replace(',', '.')) / 100 }))) }
}

/** «Gero 80% · Tomi 20%»; un solo pagador al 100 % = su nombre; sin reparto = null. (Igual que finanzas.resumen_pagadores.) */
export function resumenReparto(reparto) {
  const ps = ordenar((reparto ?? []).filter((p) => p && p.quien))
  if (!ps.length) return null
  if (ps.length === 1 && aC(ps[0].porcentaje) === 10000) return ps[0].quien
  return ps.map((p) => `${p.quien} ${pctTexto(p.porcentaje)}%`).join(' · ')
}

/**
 * Parte en USD de cada pagador sobre el total de la línea, en centavos exactos: cada uno redondeado y el último se queda
 * con la diferencia (las partes suman exactamente el total). Filas sin «quién» o porcentajes inválidos cuentan 0.
 */
export function montosReparto(total, filas) {
  const tc = aC(total || 0)
  const pcts = (filas ?? []).map((f) => { const n = Number(String(f.porcentaje ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 })
  const sumaPct = pcts.reduce((s, n) => s + n, 0)
  const exacto = Math.abs(sumaPct - 100) <= 0.01
  let usado = 0
  return pcts.map((n, i) => {
    let c = Math.round((tc * n) / 100)
    if (exacto && i === pcts.length - 1) c = tc - usado
    usado += c
    return c / 100
  })
}

/** Chips para mostrar: [{ quien, porcentaje, texto }]. Si la línea no tiene reparto, cae al texto de pagado_por. */
export function chipsDeLinea(l) {
  const ps = Array.isArray(l?.pagadores) && l.pagadores.length ? ordenar(l.pagadores) : null
  if (ps) {
    if (ps.length === 1 && aC(ps[0].porcentaje) === 10000) return [{ quien: ps[0].quien, porcentaje: 100, texto: ps[0].quien }]   // 100 % = el nombre solo
    return ps.map((p) => ({ quien: p.quien, porcentaje: Number(p.porcentaje), texto: `${p.quien} ${pctTexto(p.porcentaje)}%` }))
  }
  return l?.pagado_por ? [{ quien: l.pagado_por, porcentaje: 100, texto: l.pagado_por }] : []
}

/**
 * Cuánto pone cada pagador en un conjunto de líneas (cierre de mes): { Tomi, Gero, Financiera, Empresa, otro, sinDato } en USD.
 * Cada línea reparte su total con sus porcentajes; sin reparto: su pagado_por (si es uno de los cuatro) o «sin dato».
 */
export function totalesPorPagador(lineas) {
  const c = { Tomi: 0, Gero: 0, Financiera: 0, Empresa: 0, otro: 0, sinDato: 0 }
  for (const l of lineas ?? []) {
    const ps = Array.isArray(l.pagadores) && l.pagadores.length ? ordenar(l.pagadores) : null
    if (ps) {
      montosReparto(l.total_usd, ps).forEach((m, i) => { c[QUIENES_PAGAN.includes(ps[i].quien) ? ps[i].quien : 'otro'] += aC(m) })
    } else if (QUIENES_PAGAN.includes(l.pagado_por)) c[l.pagado_por] += aC(l.total_usd)
    else if (l.pagado_por) c.otro += aC(l.total_usd)
    else c.sinDato += aC(l.total_usd)
  }
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / 100]))
}
