// ── SOLO PARA PRUEBAS: borra las filas de un alta de prueba del bot en el CRM de Clientes ─────────────────────────
// Lo usa scripts/bot-crm-prueba-real.mjs para dejar "2026 - CRM - CLIENTES" como estaba después de escribir un alta
// inventada con escribirAltaCrm(). La app NO lo llama nunca. Candados (si alguno falla, aborta SIN tocar nada):
//   · hay que pasarle lo que escribió la prueba (`escrito`, de escritoDesdePedidos: el ID y las columnas de cada fila);
//   · el nombre de esa fila de Agencia tiene que empezar con "PRUEBA BOT" y su ID (A) ser el que escribió la prueba;
//   · la fila de Renovaciones tiene que estar vacía o ser de esa misma prueba (mismo ID y nombre "PRUEBA BOT…");
//   · en las columnas que la prueba NO escribió no puede haber ningún dato (si alguien cargó algo en esa fila mientras
//     existía, se aborta para no perderlo); como fórmula, solo las precargadas que había antes (`formulasPrevias`);
//   · nunca la fila 1 (encabezados) ni la 2 (de ahí se copian las fórmulas); nunca en Vercel ni con NODE_ENV=production.
// Borra con values.batchClear SOLO A:AD de Agencia y A:L de Renovaciones: los mismos rangos que controla antes y
// verifica después (una columna que el equipo agregue más a la derecha no se toca). No borra la fila (nada de
// deleteDimension): no se corre nada de abajo ni se rompen referencias. Si se le pasan las fórmulas que esas filas
// tenían ANTES de la prueba (`formulasPrevias` de escribirAltaCrm: las precargadas por el equipo, ej. Agencia J y
// Renovaciones E), las vuelve a poner para que la planilla quede exactamente como estaba. Después relee y verifica:
// ningún valor en las dos filas y, como fórmulas, solo las restauradas (que sin ID ni Día 1 no muestran nada).
// Límite que queda: Sheets no tiene compare-and-set, así que entre la relectura y el borrado (≈1 s) una edición manual
// de esa misma fila no se detectaría.
import { invalidarSnapshot } from '../../clientes/snapshot'
import { columnasDeClientes, columnasDeRenovaciones } from '../../clientes/parsear'
import { letraColumna } from '../../clientes/texto'
import type { Fila } from '../../clientes/tipos'
import type { ControlVerificacion, FormulasPrevias, PedidoCopia, PlanillaCrm, RangoA1, RangoValores, Verificacion } from './crmEscribir'
import { PESTANA_AGENCIA, PESTANA_RENOVACIONES, celdaVacia, esFormula, formulaDeLaFila, indiceColumna, parsearRango, planillaCrmReal } from './crmEscribir'

export const PREFIJO_PRUEBA = 'PRUEBA BOT'
/** Última columna que se controla, se borra y se verifica en cada pestaña (lo mismo que lee crmEscribir.ts). */
export const HASTA_AGENCIA = 'AD', HASTA_RENOVACIONES = 'L'

/** Lo que escribió la prueba: el ID nuevo y, por pestaña, las columnas (0 = A) con valores o con fórmulas copiadas. */
export interface EscritoPorLaPrueba { id: string; agencia: number[]; renovaciones: number[] }

/** Problemas de un `escrito` (vacío = sirve). También valida lo que llega desde JS (el recibo del script). Puro. */
export function problemasDeEscrito(e: EscritoPorLaPrueba | null | undefined): string[] {
  if (!e || typeof e.id !== 'string' || !e.id.trim()) return ['Falta el ID que escribió la prueba: sin eso no se borra nada.']
  const errores: string[] = []
  const pestanas: [string, unknown, string][] = [[PESTANA_AGENCIA, e.agencia, HASTA_AGENCIA], [PESTANA_RENOVACIONES, e.renovaciones, HASTA_RENOVACIONES]]
  for (const [pestana, cols, hasta] of pestanas) {
    if (!Array.isArray(cols) || !cols.every(c => Number.isInteger(c) && c >= 0)) { errores.push(`Columnas escritas inválidas en ${pestana}.`); continue }
    const fuera = cols.filter(c => c > indiceColumna(hasta))
    if (fuera.length) errores.push(`La prueba escribió en ${pestana} fuera de A:${hasta} (${fuera.map(letraColumna).join(', ')}): la limpieza no lo cubriría.`)
  }
  if (!errores.length && !e.agencia.includes(0)) errores.push('La prueba no escribió la columna A (ID) de Agencia: no se reconoce la fila.')
  return errores
}

/** Desde los pedidos de escribirAltaCrm (res.pedidos): qué columnas escribió en cada fila (valores + fórmulas copiadas
 *  J:N). Exige que todo caiga en las filas de la prueba. Puro. */
export function escritoDesdePedidos(
  id: string | null | undefined,
  pedidos: { valores: RangoValores[]; copiarFormulas: PedidoCopia[] } | null | undefined,
  filaAgencia: number,
  filaRenovaciones: number,
): { ok: boolean; errores: string[]; escrito: EscritoPorLaPrueba | null } {
  const errores: string[] = []
  const idTxt = String(id ?? '').trim()
  if (!idTxt) errores.push('No se sabe qué ID escribió la prueba.')
  if (!pedidos || !Array.isArray(pedidos.valores) || !pedidos.valores.length) errores.push('No están los pedidos de escritura de la prueba (qué celdas escribió).')
  if (errores.length || !pedidos) return { ok: false, errores, escrito: null }

  const agencia = new Set<number>(), renovaciones = new Set<number>()
  for (const d of pedidos.valores) {
    let r: RangoA1
    try { r = parsearRango(String(d?.range ?? '')) } catch (e) { errores.push((e as Error).message); continue }
    const destino = r.pestana === PESTANA_AGENCIA ? { fila: filaAgencia, cols: agencia } : r.pestana === PESTANA_RENOVACIONES ? { fila: filaRenovaciones, cols: renovaciones } : null
    if (!destino) { errores.push(`La prueba escribió en otra pestaña: ${d.range}.`); continue }
    if (r.c0 === null || r.c1 === null || r.f0 !== destino.fila || r.f1 !== destino.fila) { errores.push(`El pedido ${d.range} no es la fila ${destino.fila} de ${r.pestana}.`); continue }
    for (let c = r.c0; c <= r.c1; c++) destino.cols.add(c)
  }
  for (const p of pedidos.copiarFormulas ?? []) {
    const d = p?.copyPaste?.destination   // escribirAltaCrm solo copia dentro de Agencia (fila 2 → fila nueva)
    if (!d || d.startRowIndex !== filaAgencia - 1 || d.endRowIndex !== filaAgencia || !(d.endColumnIndex > d.startColumnIndex)) {
      errores.push(`La copia de fórmulas no es de la fila ${filaAgencia} de Agencia.`)
      continue
    }
    for (let c = d.startColumnIndex; c < d.endColumnIndex; c++) agencia.add(c)
  }
  const orden = (s: Set<number>) => [...s].sort((a, b) => a - b)
  const escrito: EscritoPorLaPrueba = { id: idTxt, agencia: orden(agencia), renovaciones: orden(renovaciones) }
  errores.push(...problemasDeEscrito(escrito))
  return errores.length ? { ok: false, errores, escrito: null } : { ok: true, errores, escrito }
}

export interface LecturaLimpieza { encAgencia: Fila; encRenovaciones: Fila; agencia: Fila; renovaciones: Fila }   // UNFORMATTED_VALUE

/** ¿Son filas de una prueba del bot? Puro. `limpiarRenovaciones` = false si esa fila ya está vacía (no se toca).
 *  `idEsperado`: el ID que escribió la prueba (la limpieza siempre lo pasa). `filaSinNombre`: la fila de Agencia no
 *  tiene nombre (puede ser que la escritura de los valores todavía no se haya aplicado: vale reintentar). */
export function controlarFilasDePrueba(l: LecturaLimpieza, idEsperado?: string): { ok: boolean; errores: string[]; limpiarRenovaciones: boolean; filaSinNombre: boolean } {
  const errores: string[] = []
  const colA = columnasDeClientes(PESTANA_AGENCIA, l.encAgencia).idx
  const colR = columnasDeRenovaciones(l.encRenovaciones).idx
  if (colA.nombre < 0 || colA.id < 0) errores.push('No se encontraron las columnas de ID y nombre en Agencia.')
  if (colR.nombre < 0 || colR.id < 0) errores.push('No se encontraron las columnas de ID y nombre en Renovaciones.')
  if (errores.length) return { ok: false, errores, limpiarRenovaciones: false, filaSinNombre: false }

  const txt = (c: unknown) => String(c ?? '').trim()
  const nombreA = txt(l.agencia[colA.nombre]), idA = txt(l.agencia[colA.id])
  if (!nombreA.startsWith(PREFIJO_PRUEBA)) errores.push(`El nombre de la fila de Agencia no empieza con "${PREFIJO_PRUEBA}": no es una prueba del bot, no se toca nada.`)
  const esperado = idEsperado === undefined ? null : txt(idEsperado)
  if (esperado !== null && idA !== esperado) errores.push(`El ID de la fila de Agencia (${idA || 'sin ID'}) no es el que escribió la prueba (${esperado || 'sin ID'}): no se toca nada.`)

  const renovacionesVacia = l.renovaciones.every(c => celdaVacia(c))
  if (!renovacionesVacia) {
    const nombreR = txt(l.renovaciones[colR.nombre]), idR = txt(l.renovaciones[colR.id])
    const idRef = esperado ?? idA
    if (!nombreR.startsWith(PREFIJO_PRUEBA)) errores.push(`La fila de Renovaciones no es de una prueba del bot (el nombre no empieza con "${PREFIJO_PRUEBA}"): no se toca nada.`)
    else if (idRef && idR !== idRef) errores.push(`La fila de Renovaciones es de otro ID (${idR || 'sin ID'}) que el de la prueba (${idRef}): no se toca nada.`)
  }
  return { ok: errores.length === 0, errores, limpiarRenovaciones: !renovacionesVacia, filaSinNombre: nombreA === '' }
}

/** En las columnas que la prueba NO escribió: ningún valor y, como fórmula, solo la precargada que había antes
 *  (exactamente la misma). Se mira con render FORMULA. Devuelve los errores (vacío = se puede borrar). Puro. */
export function controlarCeldasAjenas(
  filas: { agencia: Fila; renovaciones: Fila },
  escrito: EscritoPorLaPrueba,
  formulasPrevias: FormulasPrevias | null | undefined,
  limpiarRenovaciones: boolean,
): string[] {
  const errores: string[] = []
  const revisar = (pestana: string, fila: Fila, propias: number[], previas: Record<string, string>) => {
    const datos: string[] = [], formulas: string[] = []
    fila.forEach((c, i) => {
      if (celdaVacia(c) || propias.includes(i)) return
      const letra = letraColumna(i)
      if (!esFormula(c)) datos.push(letra)
      else if (previas[letra] !== c) formulas.push(letra)
    })
    if (datos.length) errores.push(`${pestana}: hay datos en ${datos.join(', ')}, columnas que la prueba no escribió (alguien cargó algo en esa fila): no se toca nada.`)
    if (formulas.length) errores.push(`${pestana}: hay fórmulas en ${formulas.join(', ')} que no puso la prueba ni estaban antes: no se toca nada.`)
  }
  revisar(PESTANA_AGENCIA, filas.agencia, escrito.agencia, formulasPrevias?.agencia ?? {})
  if (limpiarRenovaciones) revisar(PESTANA_RENOVACIONES, filas.renovaciones, escrito.renovaciones, formulasPrevias?.renovaciones ?? {})
  return errores
}

/** Valida las fórmulas a restaurar y arma los pedidos (USER_ENTERED: un texto que empieza con "=" queda como fórmula). Puro. */
export function pedidosDeRestauracion(fp: FormulasPrevias | undefined, filaAgencia: number, filaRenovaciones: number, limpiarRenovaciones: boolean): { ok: boolean; errores: string[]; data: RangoValores[] } {
  const errores: string[] = [], data: RangoValores[] = []
  if (!fp) return { ok: true, errores, data }
  const filas: [string, number, Record<string, string>][] = [[PESTANA_AGENCIA, filaAgencia, fp.agencia ?? {}]]
  if (limpiarRenovaciones) filas.push([PESTANA_RENOVACIONES, filaRenovaciones, fp.renovaciones ?? {}])
  for (const [pestana, fila, formulas] of filas) {
    for (const [letra, formula] of Object.entries(formulas)) {
      if (!/^[A-Z]{1,2}$/.test(letra)) { errores.push(`Columna inválida para restaurar en ${pestana}: "${letra}".`); continue }
      if (!esFormula(formula) || formula.length > 50_000) { errores.push(`${pestana} ${letra}${fila}: lo que hay que restaurar no es una fórmula.`); continue }
      if (!formulaDeLaFila(formula, fila)) { errores.push(`${pestana} ${letra}${fila}: la fórmula a restaurar no apunta a la fila ${fila}.`); continue }
      data.push({ range: `'${pestana}'!${letra}${fila}`, values: [[formula]] })
    }
  }
  return { ok: errores.length === 0, errores, data }
}

export interface FilasTrasLimpieza { agenciaFormula: Fila; agenciaValor: Fila; renovacionesFormula: Fila; renovacionesValor: Fila }

/** Después de limpiar: sin ningún valor y, como fórmulas, exactamente las restauradas. Puro. */
export function verificarLimpieza(l: FilasTrasLimpieza, restauradas: FormulasPrevias, limpiarRenovaciones: boolean): Verificacion {
  const controles: ControlVerificacion[] = []
  const revisar = (pestana: string, valores: Fila, formulas: Fila, esperadas: Record<string, string> | null) => {
    const conValor = valores.map((c, i) => (celdaVacia(c) ? null : letraColumna(i))).filter((x): x is string => !!x)
    controles.push({ que: `${pestana}: sin valores`, ok: conValor.length === 0, detalle: conValor.length ? `quedaron valores en ${conValor.join(', ')}` : 'fila vacía' })
    if (!esperadas) return   // fila que no se tocó: sus fórmulas quedan como estaban
    const encontradas: Record<string, string> = {}
    formulas.forEach((c, i) => { if (esFormula(c)) encontradas[letraColumna(i)] = c })
    const sobran = Object.keys(encontradas).filter(k => !(k in esperadas))
    const faltan = Object.keys(esperadas).filter(k => encontradas[k] !== esperadas[k])
    controles.push({
      que: `${pestana}: fórmulas como antes de la prueba`, ok: !sobran.length && !faltan.length,
      detalle: sobran.length || faltan.length ? `${sobran.length ? `sobran ${sobran.join(', ')}` : ''}${sobran.length && faltan.length ? '; ' : ''}${faltan.length ? `faltan ${faltan.join(', ')}` : ''}`
        : Object.keys(esperadas).length ? `restauradas: ${Object.keys(esperadas).join(', ')}` : 'sin fórmulas',
    })
  }
  revisar(PESTANA_AGENCIA, l.agenciaValor, l.agenciaFormula, restauradas.agencia)
  revisar(PESTANA_RENOVACIONES, l.renovacionesValor, l.renovacionesFormula, limpiarRenovaciones ? restauradas.renovaciones : null)
  return { ok: controles.every(c => c.ok), controles }
}

export interface ResultadoLimpieza {
  ok: boolean
  motivo: string | null
  borro: boolean                 // se mandó el values.batchClear
  /** Abortó sin borrar porque la fila de Agencia todavía no tiene nombre: puede que la escritura llegue tarde, vale reintentar. */
  reintentable: boolean
  filaAgencia: number
  filaRenovaciones: number
  renovacionesTocada: boolean
  restauradas: string[]          // "'Agencia'!J168", …
  verificacion: Verificacion | null
}

export interface OpcionesLimpieza {
  /** Lo que escribió la prueba (escritoDesdePedidos). Obligatorio: sin esto no se borra nada. */
  escrito: EscritoPorLaPrueba | null
  formulasPrevias?: FormulasPrevias | null
  planilla?: () => PlanillaCrm
  invalidarCache?: () => void
}

const mensajeDe = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)

export async function limpiarFilaPrueba(filaAgencia: number, filaRenovaciones: number, opciones: OpcionesLimpieza): Promise<ResultadoLimpieza> {
  const o = opciones ?? ({ escrito: null } as OpcionesLimpieza)
  const base: ResultadoLimpieza = { ok: false, motivo: null, borro: false, reintentable: false, filaAgencia, filaRenovaciones, renovacionesTocada: false, restauradas: [], verificacion: null }
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') return { ...base, motivo: 'La limpieza de pruebas no corre en Vercel ni en producción.' }
  if (![filaAgencia, filaRenovaciones].every(f => Number.isInteger(f) && f >= 3)) return { ...base, motivo: `Filas inválidas (Agencia ${filaAgencia}, Renovaciones ${filaRenovaciones}): nunca se tocan las filas 1 y 2.` }
  const problemas = problemasDeEscrito(o.escrito)
  if (problemas.length || !o.escrito) return { ...base, motivo: `${problemas.join(' ')} No se tocó nada.` }
  const escrito = o.escrito

  const rangoA = `'${PESTANA_AGENCIA}'!A${filaAgencia}:${HASTA_AGENCIA}${filaAgencia}`
  const rangoR = `'${PESTANA_RENOVACIONES}'!A${filaRenovaciones}:${HASTA_RENOVACIONES}${filaRenovaciones}`
  let planilla: PlanillaCrm, lectura: LecturaLimpieza, conFormulasAntes: Fila[][]
  try {
    planilla = (o.planilla ?? planillaCrmReal)()
    const [calculado, formulas] = await Promise.all([
      planilla.leer([`'${PESTANA_AGENCIA}'!A1:${HASTA_AGENCIA}1`, `'${PESTANA_RENOVACIONES}'!A1:${HASTA_RENOVACIONES}1`, rangoA, rangoR], 'UNFORMATTED_VALUE'),
      planilla.leer([rangoA, rangoR], 'FORMULA'),
    ])
    const [encA, encR, ag, re] = calculado
    lectura = { encAgencia: encA?.[0] ?? [], encRenovaciones: encR?.[0] ?? [], agencia: ag?.[0] ?? [], renovaciones: re?.[0] ?? [] }
    conFormulasAntes = formulas
  } catch (e) {
    return { ...base, motivo: `No se pudieron leer las filas: ${mensajeDe(e)}. No se tocó nada.` }
  }
  const control = controlarFilasDePrueba(lectura, escrito.id)
  if (!control.ok) return { ...base, reintentable: control.filaSinNombre, motivo: control.errores.join(' ') }
  const ajenas = controlarCeldasAjenas({ agencia: conFormulasAntes[0]?.[0] ?? [], renovaciones: conFormulasAntes[1]?.[0] ?? [] }, escrito, o.formulasPrevias, control.limpiarRenovaciones)
  if (ajenas.length) return { ...base, motivo: ajenas.join(' ') }
  const restauracion = pedidosDeRestauracion(o.formulasPrevias ?? undefined, filaAgencia, filaRenovaciones, control.limpiarRenovaciones)
  if (!restauracion.ok) return { ...base, motivo: `${restauracion.errores.join(' ')} No se tocó nada.` }

  // Borrar A:AD / A:L de cada fila (valores y fórmulas: lo mismo que se controló) y restaurar las fórmulas precargadas
  const aBorrar = [rangoA, ...(control.limpiarRenovaciones ? [rangoR] : [])]
  const conBase = { ...base, renovacionesTocada: control.limpiarRenovaciones }
  try {
    await planilla.limpiar(aBorrar)
  } catch (e) {
    return { ...conBase, borro: true, motivo: `Falló el borrado (${mensajeDe(e)}): revisar a mano Agencia fila ${filaAgencia} y Renovaciones fila ${filaRenovaciones}.` }
  }
  ;(o.invalidarCache ?? (() => { invalidarSnapshot() }))()
  const conBorrado = { ...conBase, borro: true }
  try {
    if (restauracion.data.length) await planilla.escribirValores(restauracion.data)
  } catch (e) {
    return { ...conBorrado, motivo: `Se borró, pero falló la restauración de las fórmulas precargadas (${mensajeDe(e)}): ${restauracion.data.map(d => d.range).join(', ')}.` }
  }
  const restauradas = restauracion.data.map(d => d.range)

  // Releer y verificar
  try {
    const [conFormulas, calculado] = await Promise.all([planilla.leer([rangoA, rangoR], 'FORMULA'), planilla.leer([rangoA, rangoR], 'UNFORMATTED_VALUE')])
    const esperadas: FormulasPrevias = {
      agencia: o.formulasPrevias?.agencia ?? {},
      renovaciones: control.limpiarRenovaciones ? (o.formulasPrevias?.renovaciones ?? {}) : {},
    }
    const verificacion = verificarLimpieza({
      agenciaFormula: conFormulas[0]?.[0] ?? [], renovacionesFormula: conFormulas[1]?.[0] ?? [],
      agenciaValor: calculado[0]?.[0] ?? [], renovacionesValor: calculado[1]?.[0] ?? [],
    }, esperadas, control.limpiarRenovaciones)
    return {
      ...conBorrado, restauradas, verificacion, ok: verificacion.ok,
      motivo: verificacion.ok ? null : `La limpieza no quedó bien: ${verificacion.controles.filter(c => !c.ok).map(c => `${c.que} (${c.detalle})`).join('; ')}.`,
    }
  } catch (e) {
    return { ...conBorrado, restauradas, motivo: `Se borró pero no se pudo releer para verificar: ${mensajeDe(e)}.` }
  }
}
