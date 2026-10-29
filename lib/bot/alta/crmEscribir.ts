// ── Bot "Capital Jurídico": escritura REAL del alta en el CRM de Clientes (docs/BOT-ALTA-CJ.md, paso 3) ─────────
// Solo de servidor (googleapis, variables de entorno y el snapshot en disco). No lleva `import 'server-only'` para poder
// probarlo con node (como pandadoc.ts); no importarlo desde componentes de cliente.
// Toma el PlanAlta de planAlta() (vía previsualizarAltaCrm) y lo escribe en "2026 - CRM - CLIENTES":
//   1. vista previa con lectura FORZADA: tiene que ser apta para escribir (plan ok, sin faltantes ni bloqueos, lectura de
//      menos de 60 s y que no sea el snapshot viejo de después de un error);
//   2. justo antes de escribir, UNA lectura directa a Sheets (sin snapshot, con fórmulas) de los encabezados, la fila 2
//      de Agencia, las dos filas destino y las columnas de ID. Se exige: filas destino VACÍAS (se aceptan las fórmulas
//      precargadas que el equipo deja debajo de la última fila, que sin ID no muestran nada), el ID nuevo sin usar, el
//      plan cayendo en las columnas que dicen HOY los encabezados y fórmulas en la fila 2 donde se van a copiar;
//   3. primero copia las fórmulas (spreadsheets.batchUpdate copyPaste PASTE_FORMULA, con los sheetId reales que da
//      spreadsheets.get) y después los valores (values.batchUpdate USER_ENTERED, como el resto del equipo). En ese orden
//      porque si se corta en el medio, una fila con fórmulas y sin ID no muestra nada (=IF($A…="","",…)), mientras que
//      una fila con ID y sin fórmulas es justo la trampa que describe lib/clientes/altas.ts;
//   4. relee y verifica: ID en A, nombre, celular, Día 1 y el resto de los valores, fórmulas en J:N apuntando a la fila
//      nueva y el período 0 en Renovaciones.
// En modo 'simulacion' hace 1 y 2 (solo lecturas) y devuelve exactamente los pedidos que mandaría, sin escribir.
//
// USER_ENTERED: los números van como número JSON (los seriales de fecha se ven como fecha porque esas filas ya tienen
// formato dd/mm/aaaa). El texto que Sheets convertiría solo (el celular "+549…" se volvería un número sin el "+", algo
// que empiece con "=", "-" o "@", o que parezca número, fecha o booleano) va con apóstrofo adelante: queda literal y el
// apóstrofo no se guarda (mismo criterio que valorCelda de lib/crm/sheets/verificacion.ts). Lo demás (nombre, "ACTIVO",
// "Hacer", mail) va tal cual, como lo tipearía una persona.
//
// Fórmulas precargadas (24/10/2026): el equipo deja fórmulas en las filas vacías de abajo (Agencia J; Renovaciones E
// "Finalización" = Día 1 + 120 días con Meses vacío o 4, o EDATE con otra cantidad de meses). Una celda destino con
// fórmula NO se pisa con un valor: en Renovaciones la Finalización queda calculada por la planilla (desde el 24/10/2026 el
// plan usa la misma regla de 120 días, así que coinciden) y se avisa. Una fórmula en cualquier otra columna que el plan
// iba a escribir frena todo.
//
// Límites: Sheets no tiene compare-and-set, así que entre la comprobación de filas vacías y la escritura queda una
// ventana mínima que solo una carga manual simultánea podría aprovechar. Dentro de este proceso las altas van de a una
// (cola); entre instancias (Vercel) no hay reservas durables como en escribirReferido.ts: si otra instancia escribió
// antes, esta encuentra la fila ocupada y aborta. Este módulo no tiene bandera propia: quien lo llame en modo 'real'
// decide (el webhook del bot debería gatearlo con su propia bandera de entorno).
// Permiso: la cuenta de servicio con scope de planillas tiene que ser EDITORA del CRM; si no, el primer pedido da 403 y
// se devuelve el error sin haber escrito nada.
import { google } from 'googleapis'
import type { EntradaAlta, PlanAlta } from '../../clientes/altas'
import { TIMEOUT_RED_SHEETS_MS } from '../../clientes/coordinadorPostgres'
import { serialAYmd, ymdASerial } from '../../clientes/fechas'
import { columnasDeClientes, columnasDeRenovaciones } from '../../clientes/parsear'
import { invalidarSnapshot } from '../../clientes/snapshot'
import { letraColumna } from '../../clientes/texto'
import type { Celda, Fila } from '../../clientes/tipos'
import type { ExtrasCrm } from './crm'
import { LECTURA_FRESCA_MS, previsualizarAltaCrm } from './crmServidor'
import type { PreviaAltaCrm } from './crmServidor'
import type { AltaParseada } from './parsear'

export const PESTANA_AGENCIA = 'Agencia'
export const PESTANA_RENOVACIONES = 'Renovaciones'
const FILA_FORMULAS_ORIGEN = 2   // la fila 2 de Agencia tiene todas las fórmulas bien armadas (altas.ts)

export type ModoEscritura = 'real' | 'simulacion'
export type Render = 'FORMULA' | 'UNFORMATTED_VALUE'

// ── Lo mínimo de la API de Sheets que usan la escritura y la limpieza (la real o una de juguete en los tests) ──
export interface PlanillaCrm {
  /** values.batchGet. FORMULA: las fórmulas como texto y el resto como valor sin formato; UNFORMATTED_VALUE: lo calculado. */
  leer(rangos: string[], render: Render): Promise<Fila[][]>
  /** spreadsheets.get: título de cada pestaña → sheetId. */
  idsDePestanas(): Promise<Record<string, number>>
  /** values.batchUpdate con USER_ENTERED. */
  escribirValores(data: RangoValores[]): Promise<void>
  /** spreadsheets.batchUpdate (acá, solo copyPaste). */
  batchUpdate(requests: PedidoCopia[]): Promise<void>
  /** values.batchClear (solo lo usa crmLimpiar.ts). */
  limpiar(rangos: string[]): Promise<void>
}

export interface RangoValores { range: string; values: Celda[][] }
export interface GridRangoReal { sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }
export interface PedidoCopia {
  copyPaste: { source: GridRangoReal; destination: GridRangoReal; pasteType: 'PASTE_FORMULA'; pasteOrientation: 'NORMAL' }
}

/** Cliente real: misma cuenta de servicio y misma planilla (SHEET_ID_CLIENTES) que lib/clientes/leer.ts, pero con el scope
 *  de escritura, como planillaReal() de lib/clientes/escribirReferido.ts. */
export function planillaCrmReal(): PlanillaCrm {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const spreadsheetId = process.env.SHEET_ID_CLIENTES
  if (!email || !key || !spreadsheetId) throw new Error('Faltan credenciales de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY) o SHEET_ID_CLIENTES')
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
  const op = { timeout: TIMEOUT_RED_SHEETS_MS }
  return {
    async leer(rangos, render) {
      const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: rangos, valueRenderOption: render }, op)
      return rangos.map((_, i) => (r.data.valueRanges?.[i]?.values ?? []) as Fila[])
    },
    async idsDePestanas() {
      const r = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' }, op)
      const out: Record<string, number> = {}
      for (const s of r.data.sheets ?? []) if (s.properties?.title != null && s.properties.sheetId != null) out[s.properties.title] = s.properties.sheetId
      return out
    },
    async escribirValores(data) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data } }, op)
    },
    async batchUpdate(requests) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, op)
    },
    async limpiar(rangos) {
      await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: rangos } }, op)
    },
  }
}

// ── Utilidades puras ─────────────────────────────────────────────────────────────────────────────

export const esFormula = (c: Celda | undefined): c is string => typeof c === 'string' && c.startsWith('=')
export const celdaVacia = (c: Celda | undefined): boolean => c === undefined || c === null || (typeof c === 'string' && c.trim() === '')

/** Letra de columna → índice (A = 0). */
export function indiceColumna(letras: string): number {
  let n = 0
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export interface RangoA1 { pestana: string; c0: number | null; f0: number | null; c1: number | null; f1: number | null }

/** "'Agencia'!A168:I168" → { pestana: 'Agencia', c0: 0, f0: 168, c1: 8, f1: 168 }. También "'Agencia'!A2:A" (filas sin fin
 *  → null) y "'Agencia'!168:168" (fila entera → columnas null). Filas 1-based, columnas 0-based. */
export function parsearRango(rango: string): RangoA1 {
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/.exec(rango.trim())
  if (!m) throw new Error(`Rango inválido: ${rango}`)
  const pestana = (m[1] ?? m[2]).replace(/''/g, "'")
  const col = (s: string | undefined) => (s ? indiceColumna(s) : null)
  const fil = (s: string | undefined) => (s ? Number(s) : null)
  const c0 = col(m[3]), f0 = fil(m[4])
  const hayFin = m[5] !== undefined || m[6] !== undefined
  return { pestana, c0, f0, c1: hayFin ? col(m[5]) : c0, f1: hayFin ? fil(m[6]) : f0 }
}

export const rangoCelda = (pestana: string, col: number, fila: number) => `'${pestana}'!${letraColumna(col)}${fila}`
const rangoFila = (pestana: string, fila: number, hasta: string) => `'${pestana}'!A${fila}:${hasta}${fila}`

const PARECE_NUMERO_O_FECHA = /^[\d\s.,:/\-+()%$€]+$/   // "1100", "24/10/2026", "2026-10-24", "11:30", "50%", "+54 9 11…"
const PARECE_BOOLEANO = /^(true|false|verdadero|falso)$/i

/** Valor listo para USER_ENTERED: número tal cual; texto que Sheets convertiría solo, con apóstrofo; vacío = ''. */
export function celdaUserEntered(v: Celda): Celda {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string') return v
  if (v === '') return ''
  const t = v.trim()
  return /^[=+\-@']/.test(v) || PARECE_NUMERO_O_FECHA.test(t) || PARECE_BOOLEANO.test(t) ? `'${v}` : v
}

/** ¿Lo leído (UNFORMATTED_VALUE) es lo que se escribió? Número con número; texto con texto (sin espacios de los bordes). */
export function mismoValor(planeado: Celda, leido: Celda | undefined): boolean {
  if (typeof planeado === 'number') return typeof leido === 'number' && Math.abs(leido - planeado) < 1e-9
  if (celdaVacia(planeado)) return celdaVacia(leido)
  if (typeof planeado === 'boolean') return leido === planeado
  return typeof leido === 'string' && leido.trim() === String(planeado).trim()
}

/** ¿La fórmula apunta a celdas de esa fila? ("=IF($A168="",…" → true para 168). */
export const formulaDeLaFila = (formula: string, fila: number): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])\\$?[A-Z]{1,3}\\$?${fila}(?!\\d)`).test(formula)

const mostrar = (c: Celda | undefined): string => (celdaVacia(c) ? '(vacía)' : typeof c === 'string' ? `"${c}"` : String(c))
const fechaDeSerial = (c: Celda | undefined): string => (typeof c === 'number' ? (serialAYmd(c) ?? String(c)) : mostrar(c))

// ── Lectura previa a escribir ─────────────────────────────────────────────────────────────────────

/** Lo que se lee (con FORMULA) justo antes de escribir. */
export interface LecturaPrevia {
  encAgencia: Fila
  fila2Agencia: Fila
  encRenovaciones: Fila
  destinoAgencia: Fila
  destinoRenovaciones: Fila
  idsAgencia: Celda[]
  idsRenovaciones: Celda[]
}

export function rangosLecturaPrevia(filaAgencia: number, filaRenovaciones: number): string[] {
  return [
    `'${PESTANA_AGENCIA}'!A1:AD${FILA_FORMULAS_ORIGEN}`,
    `'${PESTANA_RENOVACIONES}'!A1:L1`,
    rangoFila(PESTANA_AGENCIA, filaAgencia, 'AD'),
    rangoFila(PESTANA_RENOVACIONES, filaRenovaciones, 'L'),
    `'${PESTANA_AGENCIA}'!A2:A`,
    `'${PESTANA_RENOVACIONES}'!A2:A`,
  ]
}

export function lecturaPreviaDesde(bloques: Fila[][]): LecturaPrevia {
  const [ag = [], renEnc = [], dA = [], dR = [], idsA = [], idsR = []] = bloques
  return {
    encAgencia: ag[0] ?? [], fila2Agencia: ag[1] ?? [], encRenovaciones: renEnc[0] ?? [],
    destinoAgencia: dA[0] ?? [], destinoRenovaciones: dR[0] ?? [],
    idsAgencia: idsA.map(f => f[0] ?? ''), idsRenovaciones: idsR.map(f => f[0] ?? ''),
  }
}

// ── Armado de la escritura (puro) ─────────────────────────────────────────────────────────────────

export interface CeldaPlan { pestana: string; fila: number; col: number; valor: Celda }
export interface CeldaOmitida extends CeldaPlan { formula: string }
export interface DestinoFormula { pestana: string; fila: number; col: number; origen: string }
/** Fórmulas que las filas destino tenían ANTES de escribir (letra → fórmula): las precargadas por el equipo. */
export interface FormulasPrevias { agencia: Record<string, string>; renovaciones: Record<string, string> }

export interface Escritura {
  ok: boolean
  errores: string[]
  avisos: string[]
  valores: RangoValores[]            // values.batchUpdate USER_ENTERED, listo para mandar
  copiarFormulas: PedidoCopia[]      // spreadsheets.batchUpdate, con los sheetId reales
  celdas: CeldaPlan[]                // lo que se escribe (valor del plan, sin el apóstrofo)
  omitidas: CeldaOmitida[]           // celdas del plan que NO se escriben porque la planilla ya tiene su fórmula
  formulas: DestinoFormula[]         // celdas que quedan con la fórmula copiada de la fila 2
  formulasPrevias: FormulasPrevias
  columnas: { agencia: ReturnType<typeof columnasDeClientes>['idx']; renovaciones: ReturnType<typeof columnasDeRenovaciones>['idx'] }
}

const OBLIGATORIAS_AGENCIA = ['id', 'nombre', 'estado', 'celular', 'dia1'] as const
const OBLIGATORIAS_RENOVACIONES = ['id', 'nombre', 'periodo', 'dia1', 'fin', 'precio'] as const

/** Agrupa celdas de UNA fila en rangos de columnas consecutivas, con los valores ya pasados a USER_ENTERED. */
export function rangosDeCeldas(celdas: CeldaPlan[]): RangoValores[] {
  const grupos = new Map<string, CeldaPlan[]>()
  for (const c of celdas) {
    const k = `${c.pestana}\u0000${c.fila}`
    grupos.set(k, [...(grupos.get(k) ?? []), c])
  }
  const out: RangoValores[] = []
  for (const cs of grupos.values()) {
    const orden = [...cs].sort((a, b) => a.col - b.col)
    let tramo: CeldaPlan[] = []
    const cerrar = () => {
      if (!tramo.length) return
      const a = tramo[0], b = tramo[tramo.length - 1]
      out.push({ range: `'${a.pestana}'!${letraColumna(a.col)}${a.fila}:${letraColumna(b.col)}${b.fila}`, values: [tramo.map(c => celdaUserEntered(c.valor))] })
      tramo = []
    }
    for (const c of orden) {
      if (tramo.length && c.col !== tramo[tramo.length - 1].col + 1) cerrar()
      tramo.push(c)
    }
    cerrar()
  }
  return out
}

/** Arma los pedidos exactos a partir del plan y de la lectura de recién. Puro: no llama a ninguna API. */
export function armarEscritura(plan: PlanAlta, entrada: EntradaAlta, lectura: LecturaPrevia, sheetIds: Record<string, number>): Escritura {
  const errores: string[] = [], avisos: string[] = []
  const colA = columnasDeClientes(PESTANA_AGENCIA, lectura.encAgencia).idx
  const colR = columnasDeRenovaciones(lectura.encRenovaciones).idx
  const vacio = (): Escritura => ({
    ok: false, errores, avisos, valores: [], copiarFormulas: [], celdas: [], omitidas: [], formulas: [],
    formulasPrevias: { agencia: {}, renovaciones: {} }, columnas: { agencia: colA, renovaciones: colR },
  })
  const { idNuevo, filaAgencia, filaRenovaciones, payload } = plan
  if (!plan.ok || !payload || !idNuevo || !filaAgencia || !filaRenovaciones) {
    errores.push('El plan no está completo (sin ID, filas o payload): no hay nada que escribir.')
    return vacio()
  }
  if (filaAgencia <= FILA_FORMULAS_ORIGEN || filaRenovaciones <= 1) {
    errores.push(`Filas destino inválidas (Agencia ${filaAgencia}, Renovaciones ${filaRenovaciones}): nunca se escribe en los encabezados ni en la fila ${FILA_FORMULAS_ORIGEN}.`)
    return vacio()
  }

  // Encabezados de HOY: tienen que estar las columnas obligatorias y el ID en la columna A de las dos pestañas
  for (const k of OBLIGATORIAS_AGENCIA) if (colA[k] < 0) errores.push(`No se encontró la columna "${k}" en Agencia (¿cambió el encabezado?).`)
  for (const k of OBLIGATORIAS_RENOVACIONES) if (colR[k] < 0) errores.push(`No se encontró la columna "${k}" en Renovaciones (¿cambió el encabezado?).`)
  if (colA.id > 0 || colR.id > 0) errores.push('El ID ya no está en la columna A de Agencia o de Renovaciones: revisar la planilla antes de escribir.')
  if (errores.length) return vacio()

  // Celdas del plan, una por una
  const celdasPlan: CeldaPlan[] = []
  for (const d of payload.valores.data) {
    let r: RangoA1
    try { r = parsearRango(d.range) } catch (e) { errores.push((e as Error).message); continue }
    const filaEsperada = r.pestana === PESTANA_AGENCIA ? filaAgencia : r.pestana === PESTANA_RENOVACIONES ? filaRenovaciones : null
    if (filaEsperada === null) { errores.push(`El plan escribe en una pestaña inesperada: ${d.range}.`); continue }
    if (r.c0 === null || r.c1 === null || r.f0 !== filaEsperada || r.f1 !== filaEsperada) { errores.push(`El rango ${d.range} no es la fila ${filaEsperada} de ${r.pestana}.`); continue }
    const fila = d.values[0] ?? []
    if (d.values.length !== 1 || fila.length !== r.c1 - r.c0 + 1) { errores.push(`El rango ${d.range} no coincide con la cantidad de valores.`); continue }
    fila.forEach((valor, j) => celdasPlan.push({ pestana: r.pestana, fila: filaEsperada, col: (r.c0 as number) + j, valor }))
  }
  if (errores.length) return vacio()
  const valorEn = (pestana: string, col: number): Celda | undefined => celdasPlan.find(c => c.pestana === pestana && c.col === col)?.valor

  // El plan tiene que caer en las columnas que dicen los encabezados de hoy (si alguien movió columnas, se frena)
  const precio = plan.precio?.precioUSD ?? null
  const controles: [string, string, number, Celda][] = [
    ['Agencia', 'ID', colA.id, idNuevo],
    ['Agencia', 'nombre', colA.nombre, entrada.nombre.trim()],
    ['Agencia', 'estado', colA.estado, 'ACTIVO'],
    ['Agencia', 'celular', colA.celular, entrada.celular.trim()],
    ['Agencia', 'Día 1', colA.dia1, ymdASerial(entrada.dia1)],
    ['Renovaciones', 'ID', colR.id, idNuevo],
    ['Renovaciones', 'nombre', colR.nombre, entrada.nombre.trim()],
    ['Renovaciones', 'período', colR.periodo, 0],
    ['Renovaciones', 'Día 1', colR.dia1, ymdASerial(entrada.dia1)],
    ...(precio !== null ? [['Renovaciones', 'precio', colR.precio, precio] as [string, string, number, Celda]] : []),
  ]
  for (const [pestana, que, col, esperado] of controles) {
    const v = valorEn(pestana, col)
    if (!mismoValor(esperado, v)) errores.push(`El plan no pone ${que} en la columna ${letraColumna(col)} de ${pestana} (tiene ${mostrar(v)}): ¿cambiaron las columnas?`)
  }
  if (!entrada.celular.trim()) errores.push('Sin celular no se escribe: el LTV cobrado se calcula con sus últimos 7 dígitos.')

  // ID sin usar en la lectura de recién
  const norm = (c: Celda | undefined) => String(c ?? '').trim().toUpperCase()
  if (lectura.idsAgencia.some(c => norm(c) === idNuevo.toUpperCase())) errores.push(`El ID ${idNuevo} ya está en Agencia: alguien cargó un cliente en el medio.`)
  if (lectura.idsRenovaciones.some(c => norm(c) === idNuevo.toUpperCase())) errores.push(`El ID ${idNuevo} ya está en Renovaciones: alguien cargó algo en el medio.`)

  // Filas destino vacías: se aceptan las fórmulas precargadas; cualquier valor frena
  const formulasPrevias: FormulasPrevias = { agencia: {}, renovaciones: {} }
  const revisarDestino = (pestana: string, filaN: number, fila: Fila, guardar: Record<string, string>) => {
    const ocupadas: string[] = []
    fila.forEach((c, i) => {
      if (esFormula(c)) guardar[letraColumna(i)] = c
      else if (!celdaVacia(c)) ocupadas.push(letraColumna(i))
    })
    if (ocupadas.length) errores.push(`La fila ${filaN} de ${pestana} ya tiene datos (${ocupadas.join(', ')}): alguien cargó algo en el medio; no se escribe.`)
  }
  revisarDestino(PESTANA_AGENCIA, filaAgencia, lectura.destinoAgencia, formulasPrevias.agencia)
  revisarDestino(PESTANA_RENOVACIONES, filaRenovaciones, lectura.destinoRenovaciones, formulasPrevias.renovaciones)

  // Celdas del plan donde la planilla ya tiene fórmula: solo se respeta la Finalización de Renovaciones
  const celdas: CeldaPlan[] = [], omitidas: CeldaOmitida[] = []
  for (const c of celdasPlan) {
    const previa = (c.pestana === PESTANA_AGENCIA ? lectura.destinoAgencia : lectura.destinoRenovaciones)[c.col]
    if (!esFormula(previa)) { celdas.push(c); continue }
    if (c.pestana === PESTANA_RENOVACIONES && c.col === colR.fin) {
      omitidas.push({ ...c, formula: previa })
      avisos.push(`Renovaciones ${letraColumna(c.col)}${c.fila} (Finalización) ya tiene la fórmula de la planilla: no se pisa; la calcula la planilla en vez de ${fechaDeSerial(c.valor)} del plan.`)
    } else {
      errores.push(`${c.pestana} ${letraColumna(c.col)}${c.fila} tiene una fórmula y el plan iba a escribir un valor ahí: revisar a mano.`)
    }
  }

  // Fórmulas a copiar: de la fila 2 de Agencia a la fila nueva, con el sheetId real
  const copiarFormulas: PedidoCopia[] = [], formulas: DestinoFormula[] = []
  const idAgencia = sheetIds[PESTANA_AGENCIA]
  if (payload.copiarFormulas.length && typeof idAgencia !== 'number') errores.push('No se encontró el sheetId de la pestaña Agencia (spreadsheets.get).')
  for (const c of payload.copiarFormulas) {
    let o: RangoA1, d: RangoA1
    try { o = parsearRango(c.origen); d = parsearRango(c.destino) } catch (e) { errores.push((e as Error).message); continue }
    const { source, destination } = c.request.copyPaste
    const coherente = o.pestana === PESTANA_AGENCIA && d.pestana === PESTANA_AGENCIA
      && o.f0 === FILA_FORMULAS_ORIGEN && o.f1 === FILA_FORMULAS_ORIGEN && d.f0 === filaAgencia && d.f1 === filaAgencia
      && o.c0 === d.c0 && o.c1 === d.c1 && o.c0 !== null && o.c1 !== null
      && source.startRowIndex === FILA_FORMULAS_ORIGEN - 1 && source.endRowIndex === FILA_FORMULAS_ORIGEN
      && destination.startRowIndex === filaAgencia - 1 && destination.endRowIndex === filaAgencia
      && source.startColumnIndex === o.c0 && source.endColumnIndex === (o.c1 as number) + 1
      && destination.startColumnIndex === o.c0 && destination.endColumnIndex === (o.c1 as number) + 1
    if (!coherente) { errores.push(`La copia de fórmulas ${c.origen} → ${c.destino} no es de la fila ${FILA_FORMULAS_ORIGEN} a la fila ${filaAgencia} de Agencia.`); continue }
    for (let col = o.c0 as number; col <= (o.c1 as number); col++) {
      const formula = lectura.fila2Agencia[col]
      if (!esFormula(formula)) errores.push(`La fila ${FILA_FORMULAS_ORIGEN} de Agencia no tiene fórmula en ${letraColumna(col)}: no se copia (se pegarían datos de otro cliente).`)
      if (celdasPlan.some(x => x.pestana === PESTANA_AGENCIA && x.col === col)) errores.push(`La columna ${letraColumna(col)} de Agencia está a la vez en los valores y en las fórmulas a copiar.`)
      formulas.push({ pestana: PESTANA_AGENCIA, fila: filaAgencia, col, origen: esFormula(formula) ? formula : '' })
    }
    if (typeof idAgencia === 'number') copiarFormulas.push({ copyPaste: { ...c.request.copyPaste, source: { ...source, sheetId: idAgencia }, destination: { ...destination, sheetId: idAgencia } } })
  }
  if (!payload.copiarFormulas.length) avisos.push('El plan no trae fórmulas para copiar: fin de período, LTV y duración pueden quedar vacíos.')

  if (errores.length) return { ...vacio(), formulasPrevias }
  return {
    ok: true, errores, avisos, valores: rangosDeCeldas(celdas), copiarFormulas, celdas, omitidas, formulas, formulasPrevias,
    columnas: { agencia: colA, renovaciones: colR },
  }
}

// ── Verificación después de escribir (pura) ───────────────────────────────────────────────────────

export interface ControlVerificacion { que: string; ok: boolean; detalle: string; informativo?: boolean }
export interface Verificacion { ok: boolean; controles: ControlVerificacion[] }
export interface FilasLeidas { agenciaFormula: Fila; agenciaValor: Fila; renovacionesFormula: Fila; renovacionesValor: Fila }

export function rangosVerificacion(filaAgencia: number, filaRenovaciones: number): string[] {
  return [rangoFila(PESTANA_AGENCIA, filaAgencia, 'AD'), rangoFila(PESTANA_RENOVACIONES, filaRenovaciones, 'L')]
}

export function verificarEscritura(esc: Escritura, plan: Pick<PlanAlta, 'idNuevo' | 'filaAgencia' | 'filaRenovaciones' | 'precio'>, l: FilasLeidas): Verificacion {
  const controles: ControlVerificacion[] = []
  const { agencia: colA, renovaciones: colR } = esc.columnas
  const id = plan.idNuevo ?? ''
  const fA = plan.filaAgencia ?? 0, fR = plan.filaRenovaciones ?? 0
  const leido = (c: CeldaPlan) => (c.pestana === PESTANA_AGENCIA ? l.agenciaValor : l.renovacionesValor)[c.col]
  const celdaDe = (pestana: string, col: number) => esc.celdas.find(c => c.pestana === pestana && c.col === col)
  const controlar = (que: string, pestana: string, col: number, mostrarComo: (c: Celda | undefined) => string = mostrar) => {
    const c = celdaDe(pestana, col)
    if (!c) { controles.push({ que, ok: false, detalle: `No estaba en lo escrito (${pestana} ${letraColumna(col)})` }); return }
    const v = leido(c)
    controles.push({ que, ok: mismoValor(c.valor, v), detalle: `${pestana} ${letraColumna(col)}${c.fila}: esperado ${mostrarComo(c.valor)}, leído ${mostrarComo(v)}` })
  }
  controlar('ID en A', PESTANA_AGENCIA, colA.id)
  controlar('Nombre', PESTANA_AGENCIA, colA.nombre)
  controlar('Celular', PESTANA_AGENCIA, colA.celular)
  controlar('Día 1', PESTANA_AGENCIA, colA.dia1, fechaDeSerial)

  const nombradas = new Set([`${PESTANA_AGENCIA}:${colA.id}`, `${PESTANA_AGENCIA}:${colA.nombre}`, `${PESTANA_AGENCIA}:${colA.celular}`, `${PESTANA_AGENCIA}:${colA.dia1}`,
    `${PESTANA_RENOVACIONES}:${colR.id}`, `${PESTANA_RENOVACIONES}:${colR.periodo}`])
  const restoAg = esc.celdas.filter(c => c.pestana === PESTANA_AGENCIA && !nombradas.has(`${c.pestana}:${c.col}`))
  const malasAg = restoAg.filter(c => !mismoValor(c.valor, leido(c)))
  controles.push({ que: 'Resto de los valores de Agencia', ok: malasAg.length === 0, detalle: malasAg.length ? `distintos en ${malasAg.map(c => `${letraColumna(c.col)} (esperado ${mostrar(c.valor)}, leído ${mostrar(leido(c))})`).join(', ')}` : `${restoAg.length} celdas iguales a lo escrito` })

  // Fórmulas J:N: tienen que estar y apuntar a la fila nueva
  const malasF = esc.formulas.filter(f => { const x = l.agenciaFormula[f.col]; return !esFormula(x) || !formulaDeLaFila(x, fA) })
  const letrasF = esc.formulas.map(f => letraColumna(f.col))
  controles.push({
    que: `Fórmulas ${letrasF.length ? `${letrasF[0]}:${letrasF[letrasF.length - 1]}` : '(ninguna)'}`,
    ok: esc.formulas.length > 0 && malasF.length === 0,
    detalle: !esc.formulas.length ? 'No se copió ninguna fórmula' : malasF.length ? `sin fórmula o apuntando a otra fila: ${malasF.map(f => letraColumna(f.col)).join(', ')}` : `${esc.formulas.length} fórmulas copiadas en la fila ${fA}`,
  })

  // Renovaciones: período 0 del ID nuevo
  const idR = l.renovacionesValor[colR.id], perR = l.renovacionesValor[colR.periodo]
  controles.push({ que: 'Renovaciones: período 0', ok: mismoValor(id, idR) && mismoValor(0, perR), detalle: `fila ${fR}: ID ${mostrar(idR)}, período ${mostrar(perR)}` })
  const restoR = esc.celdas.filter(c => c.pestana === PESTANA_RENOVACIONES && !nombradas.has(`${c.pestana}:${c.col}`))
  const malasR = restoR.filter(c => !mismoValor(c.valor, leido(c)))
  controles.push({ que: 'Resto de los valores de Renovaciones', ok: malasR.length === 0, detalle: malasR.length ? `distintos en ${malasR.map(c => `${letraColumna(c.col)} (esperado ${mostrar(c.valor)}, leído ${mostrar(leido(c))})`).join(', ')}` : `${restoR.length} celdas iguales a lo escrito (Día 1, precio, notas…)` })

  // Finalización que quedó a cargo de la fórmula de la planilla: tiene que seguir siendo fórmula y dar una fecha posterior al Día 1
  for (const o of esc.omitidas) {
    const f = l.renovacionesFormula[o.col], v = l.renovacionesValor[o.col], d1 = l.renovacionesValor[colR.dia1]
    const ok = esFormula(f) && typeof v === 'number' && typeof d1 === 'number' && v > d1
    controles.push({ que: `Renovaciones: ${letraColumna(o.col)} calculada por la planilla`, ok, detalle: `${letraColumna(o.col)}${o.fila} = ${fechaDeSerial(v)} (${esFormula(f) ? 'fórmula intacta' : 'SIN fórmula'}; el plan decía ${fechaDeSerial(o.valor)})` })
  }

  // Informativos: no frenan, pero muestran que la fila quedó enganchada con Renovaciones
  if (colA.ltvContratado >= 0 && plan.precio?.precioUSD != null) {
    const v = l.agenciaValor[colA.ltvContratado]
    controles.push({ que: 'LTV contratado = precio del período 0', ok: mismoValor(plan.precio.precioUSD, v), detalle: `leído ${mostrar(v)}, esperado ${plan.precio.precioUSD}`, informativo: true })
  }
  if (colA.finPeriodo >= 0) {
    const v = l.agenciaValor[colA.finPeriodo]
    controles.push({ que: 'Fin de período calculado', ok: typeof v === 'number', detalle: `leído ${fechaDeSerial(v)}`, informativo: true })
  }
  return { ok: controles.every(c => c.ok || c.informativo), controles }
}

// ── El paso completo ──────────────────────────────────────────────────────────────────────────────

export interface DepsEscritura {
  previsualizar?: typeof previsualizarAltaCrm
  planilla?: () => PlanillaCrm
  ahora?: () => number
  invalidarCache?: () => void
}
export interface OpcionesEscritura { modo: ModoEscritura; deps?: DepsEscritura }

export interface ResultadoEscrituraCrm {
  ok: boolean
  modo: ModoEscritura
  etapa: 'previa' | 'control' | 'escritura' | 'verificacion' | 'listo'
  motivo: string | null
  /** true = se mandó al menos un pedido de escritura que pudo haberse aplicado (aunque después haya fallado algo). */
  escribio: boolean
  id: string | null
  filaAgencia: number | null
  filaRenovaciones: number | null
  verificacion: Verificacion | null
  /** Lo que se mandó (real) o se mandaría (simulación), tal cual. */
  pedidos: { valores: RangoValores[]; copiarFormulas: PedidoCopia[] } | null
  omitidas: CeldaOmitida[]
  formulasPrevias: FormulasPrevias | null
  avisos: string[]
  previa: Pick<PreviaAltaCrm, 'faltantes' | 'bloqueos' | 'motivosNoApto' | 'lectura' | 'aptoParaEscribir'> | null
  /** Ya hay un cliente vigente (ACTIVO o PAUSADO) con ese celular, mail o nombre: planAlta no da el alta de nuevo. Lo usa el
   *  motor del bot para no depender del texto "Ya hay un cliente vigente". null si no hay (o si no se llegó a leer). */
  duplicadoVigente: { id: string; motivo: 'celular' | 'mail' | 'nombre' } | null
}

/** El primer duplicado ACTIVO o PAUSADO del plan (el mismo criterio con el que planAlta frena el alta). Puro. */
export function duplicadoVigenteDe(plan: Pick<PlanAlta, 'duplicados'> | null | undefined): ResultadoEscrituraCrm['duplicadoVigente'] {
  const d = plan?.duplicados?.find(x => x.estado === 'ACTIVO' || x.estado === 'PAUSADO')
  return d ? { id: d.id, motivo: d.motivo } : null
}

const mensajeDe = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)
/** 400/401/403/404: Google rechazó el pedido sin aplicarlo. Cualquier otro error (timeout, 5xx) puede haberse aplicado. */
const rechazado = (e: unknown): boolean => {
  const x = e as { code?: number | string; status?: number | string }
  return [400, 401, 403, 404].includes(Number(x?.code ?? x?.status))
}

let cola: Promise<unknown> = Promise.resolve()
/** Las altas de este proceso van de a una: dos #ALTA simultáneos no eligen la misma fila. */
function enCola<T>(f: () => Promise<T>): Promise<T> {
  const p = cola.then(f, f)
  cola = p.catch(() => undefined)
  return p
}

export function escribirAltaCrm(
  a: AltaParseada,
  extras: Omit<ExtrasCrm, 'closersConocidos'> = {},
  opciones: OpcionesEscritura,
): Promise<ResultadoEscrituraCrm> {
  return enCola(() => escribir(a, extras, opciones))
}

async function escribir(a: AltaParseada, extras: Omit<ExtrasCrm, 'closersConocidos'>, opciones: OpcionesEscritura): Promise<ResultadoEscrituraCrm> {
  const { modo, deps = {} } = opciones ?? ({} as OpcionesEscritura)
  const ahora = deps.ahora ?? Date.now
  const invalidar = deps.invalidarCache ?? (() => { invalidarSnapshot() })
  const base: ResultadoEscrituraCrm = {
    ok: false, modo, etapa: 'previa', motivo: null, escribio: false, id: null, filaAgencia: null, filaRenovaciones: null,
    verificacion: null, pedidos: null, omitidas: [], formulasPrevias: null, avisos: [], previa: null, duplicadoVigente: null,
  }
  if (modo !== 'real' && modo !== 'simulacion') return { ...base, motivo: `Modo inválido: ${String(modo)} (tiene que ser 'real' o 'simulacion').` }

  // 1. Vista previa con lectura FORZADA
  let previa: PreviaAltaCrm
  try {
    previa = await (deps.previsualizar ?? previsualizarAltaCrm)(a, extras, { forzarLectura: true })
  } catch (e) {
    return { ...base, motivo: `No se pudo leer el CRM: ${mensajeDe(e)}` }
  }
  const { plan } = previa
  const conPlan: ResultadoEscrituraCrm = {
    ...base, id: plan.idNuevo, filaAgencia: plan.filaAgencia, filaRenovaciones: plan.filaRenovaciones,
    avisos: [...previa.avisos, ...plan.advertencias],
    previa: { faltantes: previa.faltantes, bloqueos: previa.bloqueos, motivosNoApto: previa.motivosNoApto, lectura: previa.lectura, aptoParaEscribir: previa.aptoParaEscribir },
    duplicadoVigente: duplicadoVigenteDe(plan),
  }
  if (!previa.aptoParaEscribir) return { ...conPlan, motivo: `No apta para escribir: ${previa.motivosNoApto.join(' ')}` }
  const edadMs = ahora() - previa.lectura.snapshotEn
  if (previa.lectura.fuente === 'snapshot_viejo' || edadMs > LECTURA_FRESCA_MS) {
    return { ...conPlan, motivo: `La lectura del CRM no es fresca (${previa.lectura.fuente}, ${Math.round(edadMs / 1000)} s; máximo ${LECTURA_FRESCA_MS / 1000} s).` }
  }
  if (!plan.filaAgencia || !plan.filaRenovaciones) return { ...conPlan, motivo: 'El plan no trae las filas destino.' }

  // 2. Lectura directa justo antes de escribir
  let planilla: PlanillaCrm, lectura: LecturaPrevia, sheetIds: Record<string, number>
  try {
    planilla = (deps.planilla ?? planillaCrmReal)()
    const [ids, bloques] = await Promise.all([planilla.idsDePestanas(), planilla.leer(rangosLecturaPrevia(plan.filaAgencia, plan.filaRenovaciones), 'FORMULA')])
    sheetIds = ids
    lectura = lecturaPreviaDesde(bloques)
  } catch (e) {
    return { ...conPlan, etapa: 'control', motivo: `No se pudieron releer las filas destino: ${mensajeDe(e)}. No se escribió nada.` }
  }
  const esc = armarEscritura(plan, previa.entrada, lectura, sheetIds)
  const conEscritura: ResultadoEscrituraCrm = {
    ...conPlan, etapa: 'control',
    pedidos: esc.ok ? { valores: esc.valores, copiarFormulas: esc.copiarFormulas } : null,
    omitidas: esc.omitidas, formulasPrevias: esc.formulasPrevias, avisos: [...conPlan.avisos, ...esc.avisos],
  }
  if (!esc.ok) return { ...conEscritura, motivo: `${esc.errores.join(' ')} No se escribió nada.` }
  if (modo === 'simulacion') return { ...conEscritura, ok: true, etapa: 'listo' }

  // 3. Escribir: primero las fórmulas, después los valores
  let escribio = false
  try {
    if (esc.copiarFormulas.length) {
      try { await planilla.batchUpdate(esc.copiarFormulas) } catch (e) { if (!rechazado(e)) escribio = true; throw e }
      escribio = true
    }
    try { await planilla.escribirValores(esc.valores) } catch (e) { if (!rechazado(e)) escribio = true; throw e }
    escribio = true
  } catch (e) {
    if (escribio) invalidar()
    return {
      ...conEscritura, etapa: 'escritura', escribio,
      motivo: escribio
        ? `Falló la escritura (${mensajeDe(e)}): puede haber quedado a medias en Agencia fila ${plan.filaAgencia} / Renovaciones fila ${plan.filaRenovaciones}; revisar a mano.`
        : `Google rechazó la escritura (${mensajeDe(e)}): no se escribió nada.`,
    }
  }
  invalidar()   // la próxima lectura del dashboard trae la fila nueva

  // 4. Releer y verificar
  try {
    const rangos = rangosVerificacion(plan.filaAgencia, plan.filaRenovaciones)
    const [conFormulas, calculado] = await Promise.all([planilla.leer(rangos, 'FORMULA'), planilla.leer(rangos, 'UNFORMATTED_VALUE')])
    const verificacion = verificarEscritura(esc, plan, {
      agenciaFormula: conFormulas[0]?.[0] ?? [], renovacionesFormula: conFormulas[1]?.[0] ?? [],
      agenciaValor: calculado[0]?.[0] ?? [], renovacionesValor: calculado[1]?.[0] ?? [],
    })
    const fallidos = verificacion.controles.filter(c => !c.ok && !c.informativo)
    return {
      ...conEscritura, escribio: true, verificacion, ok: verificacion.ok, etapa: verificacion.ok ? 'listo' : 'verificacion',
      motivo: verificacion.ok ? null : `Se escribió pero la verificación falló: ${fallidos.map(c => `${c.que} (${c.detalle})`).join('; ')}.`,
    }
  } catch (e) {
    return { ...conEscritura, escribio: true, etapa: 'verificacion', motivo: `Se escribió pero no se pudo releer para verificar: ${mensajeDe(e)}.` }
  }
}
