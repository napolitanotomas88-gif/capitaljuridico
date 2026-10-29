// ── Bot "Capital Jurídico": carga REAL del pago en "Registro de Pagos" (docs/BOT-ALTA-CJ.md, paso 2) ───────────────
// Solo de servidor (googleapis, variables de entorno y el Puente Drive). No lleva `import 'server-only'` para poder
// probarlo con node (como crmEscribir.ts); no importarlo desde componentes de cliente.
// Toma la fila que arma filaRegistroPagos() (finanzas.ts, pura) y la carga en "SKWD | Finanzas 2026" como lo hace el
// "Formulario de Pagos" de Aylu: fila NUEVA EN LA FILA 2 (las más nuevas arriba) y el comprobante en Drive.
//   1. Lectura (1 batchGet con FORMULA + 1 spreadsheets.get): encabezados, las 60 filas de arriba, el sheetId y las
//      listas desplegables de la fila 2. Controles (puros, armarCarga): sin pendientes, encabezados de siempre, fecha
//      como serial, cada valor dentro de su lista desplegable (las listas son "estrictas": un valor fuera de la lista
//      frena), y que el mismo pago (cliente + fecha + monto) no esté ya cargado.
//   2. Comprobante por el puente a "DFY - SKWD / Subidos", con el nombre de la col I + la extensión. El cliente del puente
//      reintenta solo ante un 5xx, un error de red o una respuesta que no es JSON, y solo si el intento fue corto
//      (puenteDrive.ts, "Reintentos"). subirArchivo devuelve el que ya está con ese nombre, así que en general no duplica:
//      · Si el reintento lo encuentra (yaExistia con `dudoso`), puede ser el que subió el primer intento o uno anterior
//        con el mismo nombre (de otro pago): sin prueba, va el aviso de siempre ("revisar que sea el mismo") y, si después
//        Google rechaza la fila, NO se manda a la papelera.
//      · Si el reintento lo sube de nuevo (`dudoso` sin yaExistia), se avisa que puede haber quedado dos veces: la
//        búsqueda por nombre de Drive puede no ver todavía lo que subió el primer intento.
//      · Un intento dudoso largo (cortado por tiempo o de más de 25 s) no se reintenta: el Apps Script puede seguir
//        subiendo, y el resultado trae noReintentarAntesDe.
//   3. UN SOLO spreadsheets.batchUpdate (atómico: Google aplica todo o nada, y nadie puede meterse en el medio):
//      insertDimension de la fila 2 con inheritFromBefore:false (hereda de la fila de abajo), formato y listas
//      desplegables copiados de la fila 3 (la que era la 2), la fórmula de M copiada de la fila 3 (PASTE_FORMULA ajusta
//      A3 → A2), los VALORES de A2:R2 con updateCells por tramos y, si hay comprobante, el chip del archivo de Drive en
//      I2 (así están todas las filas de Aylu: la col I es un chip del comprobante, no un texto).
//      Los tramos saltean lo que no se toca (I si lleva el chip, M si se copió la fórmula, P y Q): dentro de un
//      updateCells una celda vacía BORRA. Cada celda va con numberValue (la fecha como serial, E), stringValue (texto
//      LITERAL: Sheets no lo convierte, así que va sin apóstrofo) o formulaValue (solo M, cuando se escribe).
//      Antes los valores iban en un values.update aparte: entre las dos llamadas otra carga (el Formulario de Pagos de
//      Aylu u otra instancia de Vercel) podía insertar en la fila 2 y los valores del bot pisaban ese pago; además el
//      values.update es un PUT y gaxios lo reintenta por su cuenta (hasta 3 veces, con espera) ante 5xx, 429 o falta de
//      respuesta, alargando esa ventana. El batchUpdate es un POST: gaxios no lo reintenta.
//   4. Relee la fila 2 y la 3 y verifica: los valores, la fórmula de M apuntando a A2, el chip, y que la fila que antes
//      era la 2 haya bajado entera a la 3 (si no, alguien cargó otra fila entre la lectura del paso 1 y el lote: no
//      pisa nada, pero se avisa para revisar a mano).
// En modo 'simulacion' hace solo el paso 1 (con scope de solo lectura) y devuelve exactamente lo que mandaría.
//
// Si el chip no se puede escribir (la API pide un scope de Drive y puede rechazarlo si la cuenta de servicio no ve el
// archivo), el batchUpdate entero se rechaza sin aplicar nada; entonces se repite sin el chip y la col I queda con el
// nombre del archivo (aviso).
// Límites: Sheets no tiene compare-and-set. Si OTRO programa inserta y escribe en dos pasos (como hacía antes este
// módulo) y el lote del bot cae entre esos dos pasos, los valores del otro caen sobre la fila del bot: la verificación
// lo detecta (C2 no es el cliente cargado) y avisa sin mostrar los datos de esa fila.
// Este módulo no tiene bandera propia: quien lo llame en modo 'real' decide (el webhook lo gatea con su bandera).
// Permiso: la cuenta de servicio tiene que ser EDITORA de la planilla de Finanzas; si no, el primer pedido da 403.
import { google } from 'googleapis'
import { letraColumna, normTxt } from '../../clientes/texto'
import { serialAYmd } from '../../clientes/fechas'
import { COLUMNAS_REGISTRO, FILA_NUEVA, cuotasAnterioresEn, formulaMes, type CeldaRegistro, type ColumnaRegistro, type FilaRegistroPagos } from './finanzas'
import { CARPETA_COMPROBANTES, ErrorPuente, MAXIMO_BYTES_ARCHIVO, bytesDeBase64, noRepetirAntesDe, puenteDriveReal, type ArchivoSubido, type PuenteDrive } from './puenteDrive'

export const PESTANA_REGISTRO = 'Registro de Pagos'
/** Cuántas filas de arriba se miran para no cargar dos veces el mismo pago. */
export const FILAS_REPETIDOS = 60
const N_COLUMNAS = COLUMNAS_REGISTRO.length   // 18: A..R
const ULTIMA = COLUMNAS_REGISTRO[N_COLUMNAS - 1].col
const TIMEOUT_SHEETS_MS = 20_000

export type ModoFinanzas = 'real' | 'simulacion'
export type Render = 'FORMULA' | 'UNFORMATTED_VALUE'
export type Celda = string | number | boolean | null
export type Fila = Celda[]

export interface ComprobantePago { nombre: string; mimeType: string; base64: string }

/** Validación de una celda, como la devuelve spreadsheets.get (solo lo que importa). */
export interface ValidacionCelda { tipo: string; lista: string[] | null; strict: boolean; showCustomUi: boolean; inputMessage: string | null }

export interface EstructuraRegistro {
  sheetId: number
  filasHoja: number                         // gridProperties.rowCount
  validaciones: (ValidacionCelda | null)[]  // de la fila pedida, A..R
  chips: string[]                           // URIs de los chips de la celda I de esa fila
}

// ── Lo mínimo de la API de Sheets que usan la carga, la limpieza y el script de la lista (real o de juguete) ──
export interface PlanillaFinanzas {
  /** values.batchGet. FORMULA: fórmulas como texto y el resto como valor sin formato; UNFORMATTED_VALUE: lo calculado. */
  leer(rangos: string[], render: Render): Promise<Fila[][]>
  /** spreadsheets.get de una fila de "Registro de Pagos": sheetId, cantidad de filas, validaciones A..R y chips de I. */
  estructura(fila: number): Promise<EstructuraRegistro>
  /** Validaciones de una columna desde la fila 2 hasta el final (para la lista desplegable de R). */
  validacionesDeColumna(letra: string): Promise<(ValidacionCelda | null)[]>
  /** spreadsheets.batchUpdate. */
  batchUpdate(requests: object[]): Promise<void>
}

type ReglaApi = { condition?: { type?: string | null; values?: { userEnteredValue?: string | null }[] | null } | null; strict?: boolean | null; showCustomUi?: boolean | null; inputMessage?: string | null } | null | undefined
const validacionDeApi = (dv: ReglaApi): ValidacionCelda | null => {
  if (!dv?.condition?.type) return null
  const tipo = dv.condition.type
  return {
    tipo,
    lista: tipo === 'ONE_OF_LIST' ? (dv.condition.values ?? []).map(v => String(v.userEnteredValue ?? '')) : null,
    strict: dv.strict === true,
    showCustomUi: dv.showCustomUi === true,
    inputMessage: dv.inputMessage ?? null,
  }
}

/** Cliente real: misma cuenta de servicio que lib/finanzas.ts, planilla SHEET_ID_FINANZAS. En 'simulacion' con scope de
 *  SOLO LECTURA (aunque hubiera un error, no puede escribir). En 'real', planillas + drive.readonly (la API exige un
 *  scope de Drive para escribir chips de archivos). */
export function planillaFinanzasReal(modo: ModoFinanzas): PlanillaFinanzas {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const spreadsheetId = process.env.SHEET_ID_FINANZAS
  if (!email || !key || !spreadsheetId) throw new Error('Faltan credenciales de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY) o SHEET_ID_FINANZAS')
  const scopes = modo === 'real'
    ? ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
    : ['https://www.googleapis.com/auth/spreadsheets.readonly']
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes }) })
  const op = { timeout: TIMEOUT_SHEETS_MS }
  const pestana = `'${PESTANA_REGISTRO}'`

  async function gridDe(rango: string, campos: string) {
    const r = await sheets.spreadsheets.get({
      spreadsheetId, ranges: [rango], includeGridData: true,
      fields: `sheets(properties(sheetId,title,gridProperties.rowCount),data.rowData.values(${campos}))`,
    }, op)
    const hoja = r.data.sheets?.find(s => s.properties?.title === PESTANA_REGISTRO)
    if (!hoja || hoja.properties?.sheetId == null) throw new Error(`No se encontró la pestaña "${PESTANA_REGISTRO}"`)
    return hoja
  }

  return {
    async leer(rangos, render) {
      const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: rangos, valueRenderOption: render }, op)
      return rangos.map((_, i) => (r.data.valueRanges?.[i]?.values ?? []) as Fila[])
    },
    async estructura(fila) {
      const hoja = await gridDe(`${pestana}!A${fila}:${ULTIMA}${fila}`, 'dataValidation,chipRuns')
      const celdas = hoja.data?.[0]?.rowData?.[0]?.values ?? []
      const validaciones = Array.from({ length: N_COLUMNAS }, (_, i) => validacionDeApi(celdas[i]?.dataValidation as ReglaApi))
      const chips = (celdas[8]?.chipRuns ?? []).map(c => c.chip?.richLinkProperties?.uri ?? '').filter(Boolean)
      return { sheetId: hoja.properties!.sheetId as number, filasHoja: hoja.properties?.gridProperties?.rowCount ?? 0, validaciones, chips }
    },
    async validacionesDeColumna(letra) {
      const hoja = await gridDe(`${pestana}!${letra}2:${letra}`, 'dataValidation')
      return (hoja.data?.[0]?.rowData ?? []).map(r => validacionDeApi(r.values?.[0]?.dataValidation as ReglaApi))
    },
    async batchUpdate(requests) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, op)
    },
  }
}

// ── Utilidades puras ─────────────────────────────────────────────────────────────────────────────

export const esFormula = (c: Celda | undefined): c is string => typeof c === 'string' && c.startsWith('=')
export const celdaVacia = (c: Celda | undefined): boolean => c === undefined || c === null || (typeof c === 'string' && c.trim() === '')
const indice = (col: ColumnaRegistro) => COLUMNAS_REGISTRO.findIndex(c => c.col === col)
const I_A = indice('A'), I_C = indice('C'), I_E = indice('E'), I_I = indice('I'), I_M = indice('M')

const EXTENSIONES: Record<string, string> = {
  'image/jpeg': '.jpeg', 'image/jpg': '.jpeg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
  'image/heif': '.heif', 'image/gif': '.gif', 'application/pdf': '.pdf',
}

/** Extensión del archivo: por el mimeType (".jpeg" como los de Aylu) o, si no se conoce, la del nombre original. */
export function extensionDe(mimeType: string, nombreOriginal = ''): string {
  const porMime = EXTENSIONES[mimeType.trim().toLowerCase()]
  if (porMime) return porMime
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(nombreOriginal.trim())
  return m ? `.${m[1].toLowerCase()}` : ''
}

/** ¿Es un tipo de comprobante aceptado? (imagen o PDF, como los que sube Aylu) */
export const mimeAceptado = (mimeType: string) => /^image\/[a-z0-9.+-]+$/i.test(mimeType.trim()) || mimeType.trim().toLowerCase() === 'application/pdf'

/** Nombre del archivo en Drive = valor de la col I + extensión ("Ana Pérez - PP 1/3" + ".jpeg"). null si I está vacía. */
export function nombreArchivoComprobante(colI: CeldaRegistro, comprobante: Pick<ComprobantePago, 'mimeType' | 'nombre'>): string | null {
  const base = String(colI ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!base) return null
  const ext = extensionDe(comprobante.mimeType, comprobante.nombre)
  return ext && base.toLowerCase().endsWith(ext) ? base : base + ext
}

/** URL canónica del archivo de Drive (la de los chips de Aylu). */
export const urlArchivoDrive = (id: string) => `https://drive.google.com/file/d/${id}/view`

/** Lo que queda en la celda: null = no se toca; el texto sin el apóstrofo que finanzas.ts pone a los teléfonos
 *  extranjeros (con USER_ENTERED lo consumía Sheets; con stringValue se guardaría). Puro. */
export const textoLiteral = (v: CeldaRegistro): Celda => (typeof v === 'string' ? v.replace(/^'/, '') : v)

/** CellData de updateCells: número → numberValue; texto → stringValue (LITERAL: "54 9 11 3000-9999", "=HACK()" o
 *  "TRUE" quedan como texto); la fórmula solo donde se pide (`formula`). '' (o un número inválido) → {} = vacía. */
export function celdaApi(v: Celda, formula = false): { userEnteredValue?: { numberValue?: number; stringValue?: string; formulaValue?: string; boolValue?: boolean } } {
  if (v === null || v === '') return {}
  if (typeof v === 'number') return Number.isFinite(v) ? { userEnteredValue: { numberValue: v } } : {}
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v } }
  if (formula && v.startsWith('=')) return { userEnteredValue: { formulaValue: v } }
  return { userEnteredValue: { stringValue: v } }
}

/** updateCells de la fila 2 por tramos de columnas seguidas (A..R; null = no se toca: queda fuera de todo tramo, porque
 *  dentro de un tramo una celda vacía se BORRA). Solo userEnteredValue: el formato y las listas ya se copiaron. Puro. */
export function tramosValores(sheetId: number, valores: Celda[]): object[] {
  const out: object[] = []
  for (let i = 0; i < valores.length;) {
    if (valores[i] === null) { i++; continue }
    const desde = i, celdas: object[] = []
    for (; i < valores.length && valores[i] !== null; i++) celdas.push(celdaApi(valores[i], i === I_M))
    out.push({ updateCells: { rows: [{ values: celdas }], fields: 'userEnteredValue', start: { sheetId, rowIndex: FILA_NUEVA - 1, columnIndex: desde } } })
  }
  return out
}

/** ¿Lo leído (UNFORMATTED_VALUE) es lo que se escribió? Número con número; texto con texto (sin el apóstrofo ni espacios). */
export function mismoValor(planeado: Celda | undefined, leido: Celda | undefined): boolean {
  if (typeof planeado === 'number') return typeof leido === 'number' && Math.abs(leido - planeado) < 1e-6
  if (celdaVacia(planeado)) return celdaVacia(leido)
  if (typeof planeado === 'boolean') return leido === planeado
  const p = String(planeado).replace(/^'/, '').trim()
  return typeof leido === 'string' ? leido.trim() === p : typeof leido === 'number' && String(leido) === p
}

/** ¿La fórmula apunta a la celda A de esa fila? ('=IF(A2="";…' → true para 2) */
export const formulaApuntaA = (formula: string, fila: number): boolean => new RegExp(`(^|[^A-Za-z0-9_])\\$?A\\$?${fila}(?!\\d)`).test(formula)

const mostrar = (c: Celda | undefined): string => (celdaVacia(c) ? '(vacía)' : typeof c === 'string' ? `"${c}"` : String(c))
const nombreNormal = (s: Celda | undefined) => normTxt(s).replace(/\s+/g, ' ').trim()

// Encabezados que se esperan en la fila 1 (sin acentos ni mayúsculas). A y B hoy están vacíos en la planilla. P y Q no
// se escriben: no se controlan.
const ENCABEZADOS: Partial<Record<ColumnaRegistro, string[]>> = {
  A: ['', 'fecha'], B: ['', 'programa'], C: ['nombre del cliente'], D: ['telefono'], E: ['efectivo recaudado'], F: ['pesos ars'],
  G: ['closer'], H: ['setter'], I: ['comprobante'], J: ['concepto'], K: ['fuente'], L: ['comision'], M: ['mes'],
  N: ['tipos de venta'], O: ['tipo de pago'], R: ['cuenta que recibio'],
}

/** Encabezados que no son los de siempre (vacío = están bien). Puro. */
export function encabezadosDistintos(enc: Fila): string[] {
  const out: string[] = []
  COLUMNAS_REGISTRO.forEach(({ col }, i) => {
    const esperados = ENCABEZADOS[col]
    if (!esperados) return
    const v = nombreNormal(enc[i])
    if (!esperados.includes(v)) out.push(`${col} dice ${mostrar(enc[i])} (se esperaba "${esperados.filter(Boolean)[0]}")`)
  })
  return out
}

/** Fila de arriba con el mismo pago: mismo cliente, misma fecha (serial) y mismo monto en USD. Devuelve el número de
 *  fila de la planilla (2 = la primera) o null. `filas` empieza en la fila 2. Puro. */
export function buscarRepetido(filas: Fila[], celdas: Record<ColumnaRegistro, CeldaRegistro>): number | null {
  const nombre = nombreNormal(celdas.C)
  if (!nombre || typeof celdas.A !== 'number') return null
  const i = filas.findIndex(f => nombreNormal(f[I_C]) === nombre
    && typeof f[I_A] === 'number' && Math.round(f[I_A] as number) === Math.round(celdas.A as number)
    && (typeof celdas.E !== 'number' || (typeof f[I_E] === 'number' && Math.abs((f[I_E] as number) - (celdas.E as number)) < 0.01)))
  return i < 0 ? null : i + 2
}

// ── Lectura previa y armado de la carga (puro) ───────────────────────────────────────────────────

export interface LecturaRegistro {
  encabezados: Fila
  filas: Fila[]            // desde la fila 2 (FORMULA), hasta FILAS_REPETIDOS
  estructura: EstructuraRegistro   // de la fila 2 (la que va a bajar a la 3): sheetId, listas desplegables
}

export const rangosLectura = (): string[] => [`'${PESTANA_REGISTRO}'!A1:${ULTIMA}${1 + FILAS_REPETIDOS}`]

export function lecturaDesde(bloques: Fila[][], estructura: EstructuraRegistro): LecturaRegistro {
  const b = bloques[0] ?? []
  return { encabezados: b[0] ?? [], filas: b.slice(1), estructura }
}

export interface ComprobantePlaneado { nombreArchivo: string; mimeType: string; bytes: number }

export interface Carga {
  ok: boolean
  errores: string[]
  avisos: string[]
  controles: string[]      // lo que se controló y dio bien (para mostrar)
  celdas: Record<ColumnaRegistro, CeldaRegistro>   // la fila de finanzas.ts (los teléfonos extranjeros con apóstrofo)
  /** Primera parte del lote: insertDimension + formato y listas de la fila 3 + fórmula de M si se copia. */
  insertar: object[]
  /** Lo que queda en A2:R2, tal cual (texto literal sin apóstrofo; M con la fórmula si se escribe). null = no se toca
   *  (M si se copió la fórmula, P y Q). I va con el nombre: con chip, loteCarga la saltea. */
  valores: Celda[]
  formulaM: 'copiada' | 'escrita'
  comprobante: ComprobantePlaneado | null
  sheetId: number | null
  /** Fila de arriba con el mismo pago (mismo cliente, fecha y monto): por eso no se carga. null si no hay. */
  repetido: { fila: number } | null
}

export interface OpcionesCarga {
  comprobante?: Pick<ComprobantePago, 'nombre' | 'mimeType' | 'base64'> | null
  /** Nombre del archivo ya decidido por un intento anterior (con su " (2)" si lo tuvo): manda sobre el de la col I. */
  nombreArchivo?: string | null
}

/** "Ana Pérez - PIF.jpeg" → "Ana Pérez - PIF (2).jpeg". Puro. */
export function nombreConSufijo(nombre: string, n: number): string {
  const m = /^(.*?)(\.[A-Za-z0-9]{2,5})?$/.exec(nombre)
  return `${m?.[1] ?? nombre} (${n})${m?.[2] ?? ''}`
}
export const MAX_SUFIJO_ARCHIVO = 5

const gridFila = (sheetId: number, fila: number, c0 = 0, c1 = N_COLUMNAS) => ({ sheetId, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: c0, endColumnIndex: c1 })

/** Arma los pedidos exactos a partir de la fila y de la lectura de recién. Puro: no llama a ninguna API. */
export function armarCarga(fila: FilaRegistroPagos, lectura: LecturaRegistro, opciones: OpcionesCarga = {}): Carga {
  const errores: string[] = [], avisos: string[] = [...fila.avisos]
  const celdas = { ...fila.celdas }
  const sheetId = Number.isInteger(lectura.estructura?.sheetId) ? lectura.estructura.sheetId : null
  const controles: string[] = []
  let repetido: Carga['repetido'] = null
  const vacio = (): Carga => ({ ok: false, errores, avisos, controles, celdas, insertar: [], valores: [], formulaM: 'escrita', comprobante: null, sheetId, repetido })

  // La fila tiene que estar completa (pendientes = datos que el bot todavía no consiguió)
  if (fila.pendientes.length) errores.push(`Faltan datos antes de cargar: ${fila.pendientes.join('; ')}.`)
  if (!Array.isArray(fila.fila) || fila.fila.length !== N_COLUMNAS) errores.push(`La fila no tiene las ${N_COLUMNAS} columnas A–${ULTIMA}.`)
  if (celdas.P !== null || celdas.Q !== null) errores.push('Las columnas P y Q no se escriben (categoría vieja): tienen que venir en null.')
  const a = celdas.A
  if (typeof a !== 'number' || !Number.isInteger(a) || !serialAYmd(a) || a < 45658 || a > 55000) errores.push(`La fecha (A) tiene que ser un serial de Sheets de 2025 en adelante: ${mostrar(a as Celda)}.`)
  if (celdaVacia(celdas.C as Celda)) errores.push('Falta el nombre del cliente (C).')
  if (typeof celdas.E !== 'number' || celdas.E < 0) errores.push(`El efectivo recaudado (E) tiene que ser un número en USD: ${mostrar(celdas.E as Celda)}.`)
  if (celdaVacia(celdas.R as Celda)) errores.push('Falta la cuenta que recibió (R).')
  for (const { col } of COLUMNAS_REGISTRO) {
    const v = celdas[col]
    if (col !== 'M' && typeof v === 'string' && v.trim().startsWith('=')) avisos.push(`La columna ${col} empieza con "=": se escribe como texto, no como fórmula.`)
  }

  // Encabezados de hoy y sheetId
  const distintos = encabezadosDistintos(lectura.encabezados)
  if (distintos.length) errores.push(`Los encabezados de "${PESTANA_REGISTRO}" cambiaron (${distintos.join('; ')}): revisar la planilla antes de cargar.`)
  if (sheetId === null) errores.push(`No se encontró el sheetId de "${PESTANA_REGISTRO}".`)

  // Listas desplegables (de la fila 2 de hoy, que es la que se copia): un valor fuera de una lista estricta frena
  const validaciones = lectura.estructura?.validaciones ?? []
  const enLista: string[] = []
  COLUMNAS_REGISTRO.forEach(({ col }, i) => {
    const v = celdas[col], regla = validaciones[i]
    if (!regla?.lista || v === null || celdaVacia(v as Celda)) return
    const texto = String(v).replace(/^'/, '').trim()
    if (regla.lista.includes(texto)) { enLista.push(col); return }
    const msg = `El valor "${texto}" de la columna ${col} no está en su lista desplegable (${regla.lista.join(', ')})`
    if (regla.strict) errores.push(col === 'R' && texto === OPCION_EMPRESA
      ? `${msg}: primero hay que sumar "${OPCION_EMPRESA}" a la lista (scripts/bot-finanzas-validacion.mjs --real).`
      : `${msg}: la lista es estricta, no se carga.`)
    else avisos.push(`${msg}: queda marcado como inválido en la planilla.`)
  })

  // Mismo pago ya cargado en las filas de arriba
  const filaRepetida = buscarRepetido(lectura.filas, celdas)
  if (filaRepetida !== null) {
    repetido = { fila: filaRepetida }
    errores.push(`Ya hay un pago igual en la fila ${filaRepetida} (mismo cliente, fecha y monto): no se carga de nuevo.`)
  }

  // Comprobante
  let comprobante: ComprobantePlaneado | null = null
  const cp = opciones.comprobante
  if (cp) {
    const bytes = typeof cp.base64 === 'string' ? bytesDeBase64(cp.base64) : 0
    const nombreArchivo = opciones.nombreArchivo?.trim() || nombreArchivoComprobante(celdas.I, cp)
    if (!nombreArchivo) errores.push('Sin el nombre del comprobante (col I) no se sube el archivo.')
    if (!bytes) errores.push('El comprobante está vacío.')
    else if (bytes > MAXIMO_BYTES_ARCHIVO) errores.push(`El comprobante pesa ${Math.round(bytes / 1024 / 1024)} MB: el máximo es ${MAXIMO_BYTES_ARCHIVO / 1024 / 1024} MB.`)
    if (!mimeAceptado(String(cp.mimeType ?? ''))) errores.push(`Tipo de comprobante no aceptado: ${String(cp.mimeType)} (imagen o PDF).`)
    if (nombreArchivo && bytes) comprobante = { nombreArchivo, mimeType: String(cp.mimeType).trim().toLowerCase(), bytes }
  } else {
    avisos.push('Sin comprobante: la col I queda con el nombre, sin el chip del archivo.')
  }

  if (errores.length || sheetId === null) return vacio()
  controles.push(`Encabezados de "${PESTANA_REGISTRO}" como siempre`)
  controles.push(`Listas desplegables: ${enLista.length ? `${enLista.join(', ')} dentro de su lista` : 'ningún valor con lista'}`)
  controles.push(`Sin el mismo pago (cliente + fecha + monto) en las ${lectura.filas.length} filas de arriba`)
  controles.push(`Hoja de ${lectura.estructura.filasHoja} filas · sheetId ${sheetId}`)

  // Fórmula de M: si la fila 2 de hoy la tiene (va a bajar a la 3), se copia de ahí; si no, se escribe la de finanzas.ts
  const mHoy = lectura.filas[0]?.[I_M]
  const formulaM: Carga['formulaM'] = esFormula(mHoy) ? 'copiada' : 'escrita'
  if (formulaM === 'escrita') {
    celdas.M = formulaMes(FILA_NUEVA)
    avisos.push(`La fila 2 de hoy no tiene la fórmula de "Mes" (M): se escribe ${celdas.M}.`)
  } else {
    controles.push(`Fórmula de Mes (M): se copia de la fila 3 (la que hoy es la 2: ${mHoy})`)
  }

  const insertar: object[] = [
    { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: FILA_NUEVA - 1, endIndex: FILA_NUEVA }, inheritFromBefore: false } },
    { copyPaste: { source: gridFila(sheetId, FILA_NUEVA + 1), destination: gridFila(sheetId, FILA_NUEVA), pasteType: 'PASTE_FORMAT', pasteOrientation: 'NORMAL' } },
    { copyPaste: { source: gridFila(sheetId, FILA_NUEVA + 1), destination: gridFila(sheetId, FILA_NUEVA), pasteType: 'PASTE_DATA_VALIDATION', pasteOrientation: 'NORMAL' } },
  ]
  if (formulaM === 'copiada') {
    insertar.push({ copyPaste: { source: gridFila(sheetId, FILA_NUEVA + 1, I_M, I_M + 1), destination: gridFila(sheetId, FILA_NUEVA, I_M, I_M + 1), pasteType: 'PASTE_FORMULA', pasteOrientation: 'NORMAL' } })
  }

  const valores = COLUMNAS_REGISTRO.map(({ col }) => (col === 'M' && formulaM === 'copiada' ? null : textoLiteral(celdas[col])))
  return { ok: true, errores, avisos, controles, celdas, insertar, valores, formulaM, comprobante, sheetId, repetido }
}

/** Pedido que pone el chip del archivo de Drive en I2 (texto "@" + chipRuns, como dice la API). */
function pedidoChip(sheetId: number, url: string): object {
  return {
    updateCells: {
      rows: [{ values: [{ userEnteredValue: { stringValue: '@' }, chipRuns: [{ startIndex: 0, chip: { richLinkProperties: { uri: url } } }] }] }],
      fields: 'userEnteredValue,chipRuns',
      start: { sheetId, rowIndex: FILA_NUEVA - 1, columnIndex: I_I },
    },
  }
}

/** El lote ATÓMICO completo (un solo batchUpdate): insertar + valores por tramos + el chip si se pasa su url (con chip,
 *  los tramos saltean I: si no, el valor y el chip se pisarían). Puro. */
export function loteCarga(carga: Carga, urlChip: string | null): object[] {
  const sheetId = carga.sheetId as number
  const valores = urlChip ? carga.valores.map((v, i) => (i === I_I ? null : v)) : carga.valores
  return [...carga.insertar, ...tramosValores(sheetId, valores), ...(urlChip ? [pedidoChip(sheetId, urlChip)] : [])]
}

// ── Verificación después de escribir (pura) ───────────────────────────────────────────────────────

export interface ControlVerificacion { que: string; ok: boolean; detalle: string; informativo?: boolean }
export interface Verificacion { ok: boolean; controles: ControlVerificacion[] }

export interface FilasTrasCarga {
  formula: Fila[]          // filas 2 y 3 con FORMULA
  valor: Fila              // fila 2 con UNFORMATTED_VALUE
  estructura: EstructuraRegistro | null   // de la fila 2 (chips de I y listas desplegables)
}

/** Rango A:R de filas de "Registro de Pagos" ('Registro de Pagos'!A2:R3). */
export const rangoFilas = (desde: number, hasta = desde): string => `'${PESTANA_REGISTRO}'!A${desde}:${ULTIMA}${hasta}`

/** `antes` = la fila 2 leída antes de insertar (FORMULA): tiene que aparecer entera en la fila 3. `chip` = id del archivo
 *  si se pidió el chip en I2. */
export function verificarCarga(carga: Carga, antes: Fila, l: FilasTrasCarga, chip: { id: string } | null): Verificacion {
  const controles: ControlVerificacion[] = []
  const [f2 = [], f3 = []] = l.formula
  const v2 = l.valor
  const c = carga.celdas

  // Si C2 no es el cliente cargado, la fila 2 es de OTRA carga (un pago real): se informan solo las letras de las
  // columnas distintas, nunca sus valores (no se imprimen datos de otros clientes).
  const nuestra = mismoValor(c.C as Celda, v2[I_C])
  const leido = (x: Celda | undefined) => (nuestra ? `, leído ${mostrar(x)}` : '')
  controles.push({ que: 'Fecha (A2)', ok: mismoValor(c.A as Celda, v2[I_A]), detalle: `esperado ${mostrar(c.A as Celda)}${typeof c.A === 'number' ? ` (${serialAYmd(c.A)})` : ''}${leido(v2[I_A])}` })
  controles.push({ que: 'Nombre (C2)', ok: nuestra, detalle: nuestra ? `${mostrar(c.C as Celda)}` : `esperado ${mostrar(c.C as Celda)}: la fila 2 tiene OTRO nombre (no se muestra: es de otra carga)` })

  const saltear = new Set<ColumnaRegistro>(['A', 'C', 'M', 'P', 'Q', ...(chip ? ['I' as ColumnaRegistro] : [])])
  const resto = COLUMNAS_REGISTRO.map(({ col }, i) => ({ col, i })).filter(({ col }) => !saltear.has(col))
  const malas = resto.filter(({ col, i }) => !mismoValor(c[col] as Celda, v2[i]))
  controles.push({
    que: 'Resto de los valores (B, D–L, N, O, R)', ok: malas.length === 0,
    detalle: !malas.length ? `${resto.length} celdas iguales a lo escrito`
      : nuestra ? `distintos en ${malas.map(({ col, i }) => `${col} (esperado ${mostrar(c[col] as Celda)}, leído ${mostrar(v2[i])})`).join(', ')}`
      : `distintos en ${malas.map(({ col }) => col).join(', ')}`,
  })

  const m = f2[I_M]
  controles.push({ que: 'Mes (M2)', ok: esFormula(m) && formulaApuntaA(m, FILA_NUEVA) && !celdaVacia(v2[I_M]), detalle: `${esFormula(m) ? m : 'SIN fórmula'}${nuestra ? ` → ${mostrar(v2[I_M])}` : ''}` })

  if (chip) {
    const uris = l.estructura?.chips ?? []
    controles.push({ que: 'Comprobante (chip en I2)', ok: uris.some(u => u.includes(chip.id)), detalle: uris.length ? `chip → ${uris.some(u => u.includes(chip.id)) ? 'el archivo subido' : 'OTRO archivo'}` : 'sin chip' })
  }

  // La fila que era la 2 tiene que estar entera en la 3 (si no, alguien insertó otra fila en el medio)
  const distintas: string[] = []
  for (let i = 0; i < N_COLUMNAS; i++) {
    const x = antes[i], y = f3[i]
    if (esFormula(x) ? !esFormula(y) : !mismoValor(x, y)) distintas.push(letraColumna(i))
  }
  controles.push({ que: 'La fila que era la 2 bajó a la 3', ok: distintas.length === 0, detalle: distintas.length ? `la fila 3 no coincide en ${distintas.join(', ')}: ¿alguien cargó otra fila en el medio? Revisar a mano` : 'igual que antes de insertar' })

  // Informativo: listas desplegables en la fila nueva
  const conLista = (l.estructura?.validaciones ?? []).map((r, i) => (r?.lista ? letraColumna(i) : null)).filter(Boolean)
  if (l.estructura) controles.push({ que: 'Listas desplegables en la fila 2', ok: conLista.length > 0, detalle: conLista.length ? conLista.join(', ') : 'ninguna', informativo: true })

  return { ok: controles.every(x => x.ok || x.informativo), controles }
}

// ── El paso completo ──────────────────────────────────────────────────────────────────────────────

export interface DepsCarga {
  planilla?: (modo: ModoFinanzas) => PlanillaFinanzas
  puente?: () => PuenteDrive
}
export interface OpcionesCargaPago {
  modo: ModoFinanzas
  /** Poner el chip del archivo en I2 (como Aylu). Por defecto sí, si hay comprobante. */
  chip?: boolean
  /** Plazo (epoch ms) para el puente real: ver OpcionesPuente.hasta en puenteDrive.ts. */
  hasta?: number
  /** Primer intento de este pago (el motor lo sabe: todavía no congeló la fila). Un archivo que ya estaba con ese nombre en
   *  Subidos (sin un intento dudoso propio en el medio) es de OTRO pago: el de una seña anterior o el de otro cliente con el
   *  mismo nombre. Entonces se sube como "<nombre> (2)" (hasta " (5)") y el chip apunta al archivo nuevo. Revisión del 24/10
   *  (ronda 2): antes se usaba el que estaba y el chip de la col I quedaba en el comprobante de otro pago. */
  archivoNuevo?: boolean
  /** Nombre del archivo que eligió un intento anterior (con su sufijo): ver OpcionesCarga.nombreArchivo. */
  nombreArchivo?: string | null
  deps?: DepsCarga
}

export type EtapaCarga = 'lectura' | 'control' | 'comprobante' | 'insercion' | 'verificacion' | 'listo'

export interface ResultadoCargaFinanzas {
  ok: boolean
  modo: ModoFinanzas
  etapa: EtapaCarga
  motivo: string | null
  /** true = se mandó al menos un pedido a la planilla que pudo haberse aplicado (aunque después fallara algo). */
  escribio: boolean
  /** Fila donde quedó el pago (siempre la 2) si se escribió. */
  fila: number | null
  verificacion: Verificacion | null
  /** Archivo en "Subidos" (null si no hubo comprobante o si se mandó a la papelera tras un rechazo). */
  comprobanteId: string | null
  comprobanteUrl: string | null
  comprobanteYaExistia: boolean
  /** Si la subida del comprobante quedó dudosa después de un intento largo (cortado por tiempo o de más de 25 s), el Apps
   *  Script pudo seguir subiéndolo hasta 6 min: quien reintente la carga no lo hace antes de esta hora (ISO), para no
   *  subirlo dos veces en paralelo. null = se puede repetir ya. */
  noReintentarAntesDe: string | null
  nombreArchivo: string | null
  chip: 'puesto' | 'rechazado' | 'no' | null
  /** El lote (un solo batchUpdate) que se mandó (real) o se mandaría (simulación), tal cual. */
  pedidos: object[] | null
  /** Para la limpieza de pruebas y los reintentos: la fila 2 tal como estaba antes de insertar (FORMULA). */
  filaAnterior: Fila | null
  /** Controles previos que dieron bien (encabezados, listas, repetidos, fórmula de M). */
  controles: string[]
  avisos: string[]
  /** El mismo pago (cliente + fecha + monto) ya estaba en esa fila: no se cargó. Lo usa el motor del bot para no depender
   *  del texto del motivo. null si no hubo repetido (o si no se llegó a controlar). */
  repetido: { fila: number } | null
}

const mensajeDe = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)
/** 400/401/403/404: Google rechazó el pedido sin aplicarlo. Cualquier otro error (timeout, 5xx) puede haberse aplicado. */
export const rechazado = (e: unknown): boolean => {
  const x = e as { code?: number | string; status?: number | string; response?: { status?: number } }
  return [400, 401, 403, 404].includes(Number(x?.code ?? x?.status ?? x?.response?.status))
}

let cola: Promise<unknown> = Promise.resolve()
/** Las cargas de este proceso van de a una: dos pagos simultáneos no se pisan la fila 2. */
function enCola<T>(f: () => Promise<T>): Promise<T> {
  const p = cola.then(f, f)
  cola = p.catch(() => undefined)
  return p
}

export function cargarPagoFinanzas(fila: FilaRegistroPagos, comprobante: ComprobantePago | null | undefined, opciones: OpcionesCargaPago): Promise<ResultadoCargaFinanzas> {
  return enCola(() => cargar(fila, comprobante ?? null, opciones))
}

async function cargar(fila: FilaRegistroPagos, comprobante: ComprobantePago | null, opciones: OpcionesCargaPago): Promise<ResultadoCargaFinanzas> {
  const { modo, deps = {} } = opciones ?? ({} as OpcionesCargaPago)
  const base: ResultadoCargaFinanzas = {
    ok: false, modo, etapa: 'lectura', motivo: null, escribio: false, fila: null, verificacion: null, comprobanteId: null,
    comprobanteUrl: null, comprobanteYaExistia: false, noReintentarAntesDe: null, nombreArchivo: null, chip: null, pedidos: null, filaAnterior: null, controles: [], avisos: [],
    repetido: null,
  }
  if (modo !== 'real' && modo !== 'simulacion') return { ...base, motivo: `Modo inválido: ${String(modo)} (tiene que ser 'real' o 'simulacion').` }

  // 1. Lectura y controles
  let planilla: PlanillaFinanzas, lectura: LecturaRegistro
  try {
    planilla = (deps.planilla ?? planillaFinanzasReal)(modo)
    const [bloques, estructura] = await Promise.all([planilla.leer(rangosLectura(), 'FORMULA'), planilla.estructura(FILA_NUEVA)])
    lectura = lecturaDesde(bloques, estructura)
  } catch (e) {
    return { ...base, motivo: `No se pudo leer "${PESTANA_REGISTRO}": ${mensajeDe(e)}. No se escribió nada.` }
  }
  const carga = armarCarga(fila, lectura, { comprobante, nombreArchivo: opciones.nombreArchivo ?? null })
  const quiereChip = opciones.chip !== false && carga.comprobante !== null
  const conCarga: ResultadoCargaFinanzas = {
    ...base, etapa: 'control', avisos: carga.avisos, controles: carga.controles, nombreArchivo: carga.comprobante?.nombreArchivo ?? null,
    filaAnterior: lectura.filas[0] ?? [], repetido: carga.repetido,
    pedidos: carga.ok ? loteCarga(carga, quiereChip ? urlArchivoDrive('ID_DEL_ARCHIVO_SUBIDO') : null) : null,
  }
  if (!carga.ok) return { ...conCarga, motivo: `${carga.errores.join(' ')} No se escribió nada.` }
  if (modo === 'simulacion') return { ...conCarga, ok: true, etapa: 'listo', chip: quiereChip ? 'puesto' : 'no' }

  // 2. Comprobante a Drive (antes de tocar la planilla: si falla, no se escribe nada)
  let puente: PuenteDrive | null = null
  let subido: ArchivoSubido | null = null
  let archivoOtroPago: string | null = null
  if (carga.comprobante && comprobante) {
    try {
      puente = (deps.puente ?? (() => puenteDriveReal({ hasta: opciones.hasta })))()
      subido = await puente.subirArchivo({ carpetaId: CARPETA_COMPROBANTES, nombre: carga.comprobante.nombreArchivo, mimeType: carga.comprobante.mimeType, base64: comprobante.base64 })
      // Primer intento y ya había uno con ese nombre (sin un intento dudoso propio): es de otro pago → " (2)", " (3)"…
      const planeado = carga.comprobante
      for (let n = 2; opciones.archivoNuevo && subido.yaExistia && !subido.dudoso && n <= MAX_SUFIJO_ARCHIVO; n++) {
        const otro = nombreConSufijo(planeado.nombreArchivo, n)
        archivoOtroPago = planeado.nombreArchivo
        subido = await puente.subirArchivo({ carpetaId: CARPETA_COMPROBANTES, nombre: otro, mimeType: planeado.mimeType, base64: comprobante.base64 })
        carga.comprobante = { ...planeado, nombreArchivo: otro }
      }
      if (opciones.archivoNuevo && subido.yaExistia && !subido.dudoso) {
        return { ...conCarga, etapa: 'control', motivo: `Ya hay ${MAX_SUFIJO_ARCHIVO} archivos "${planeado.nombreArchivo}" (con " (2)" a " (${MAX_SUFIJO_ARCHIVO})") en Subidos, de otros pagos: subí el comprobante a mano. No se escribió nada en la planilla.` }
      }
    } catch (e) {
      const err = e instanceof ErrorPuente ? e : null
      const dudoso = err?.aplicado === null
      // Sin la ventana de los intentos, se supone que el Apps Script pudo seguir (lo prudente: puede seguir subiéndolo)
      const sinVentana = { desde: new Date().toISOString(), hasta: new Date().toISOString(), puedeSeguir: true }
      const noReintentarAntesDe = dudoso ? noRepetirAntesDe([err?.dudoso ?? sinVentana]) : null
      return { ...conCarga, etapa: 'comprobante', noReintentarAntesDe, nombreArchivo: carga.comprobante?.nombreArchivo ?? conCarga.nombreArchivo, motivo: `No se pudo subir el comprobante (${mensajeDe(e)}).${dudoso ? ' Puede haber quedado subido en "Subidos": revisar.' : ''} No se escribió nada en la planilla.` }
    }
  }
  const nombreArchivo = carga.comprobante?.nombreArchivo
  const avisoOtroPago = archivoOtroPago && subido && !subido.yaExistia
    ? `Ya había un archivo "${archivoOtroPago}" en Subidos (de otro pago: una seña anterior u otro cliente con el mismo nombre): este comprobante se subió como "${nombreArchivo}".`
    : null
  // Con `dudoso` (el primer intento no respondió y lo resolvió un reintento): si lo encontró, puede ser el que subió ese
  // intento o uno anterior con el mismo nombre (sin prueba, el aviso de siempre); si lo subió de nuevo, puede haber dos
  const avisoArchivo = !subido ? null
    : subido.yaExistia ? `Ya había un archivo "${nombreArchivo}" en Subidos: no se subió de nuevo (se usa ese). Revisar que sea el mismo comprobante.${subido.dudoso ? ' El primer intento de subirlo no respondió: puede ser el que subió ese intento o uno anterior con el mismo nombre (de otro pago).' : ''}`
    : subido.dudoso ? `El primer intento de subir el comprobante no respondió y el reintento lo subió: si ese intento también lo había subido, "${nombreArchivo}" puede haber quedado dos veces en Subidos. Revisar (el que subió el reintento es ${subido.url}).`
    : null
  const conArchivo: ResultadoCargaFinanzas = {
    ...conCarga, etapa: 'insercion', comprobanteId: subido?.id ?? null, comprobanteUrl: subido?.url ?? null, comprobanteYaExistia: subido?.yaExistia ?? false,
    nombreArchivo: nombreArchivo ?? conCarga.nombreArchivo,
    avisos: [...conCarga.avisos, ...(avisoOtroPago ? [avisoOtroPago] : []), ...(avisoArchivo ? [avisoArchivo] : [])],
  }
  // Si nada quedó escrito en la planilla, el archivo que se acaba de subir se manda a la papelera (no queda huérfano).
  // Uno que ya estaba (o que encontró un reintento) no: no hay prueba de que sea del bot, y es un comprobante.
  const soltarArchivo = async (): Promise<Partial<ResultadoCargaFinanzas>> => {
    if (!subido || subido.yaExistia || !puente) return {}
    try { await puente.aPapelera(subido.id); return { comprobanteId: null, comprobanteUrl: null } } catch { return {} }
  }
  const quedoEnSubidos = subido?.yaExistia && subido.dudoso
    ? ` El comprobante "${nombreArchivo}" quedó en Subidos: lo encontró el reintento y puede ser el que subió el primer intento (que no respondió) o uno anterior con el mismo nombre, así que no se manda a la papelera. Si ninguna otra fila del Registro lo usa, es el del bot y se puede borrar a mano; si lo usa otra, dejarlo.`
    : ''
  const copiaDelPrimero = subido?.dudoso && !subido.yaExistia
    ? ` Puede haber quedado otra copia de "${nombreArchivo}" en Subidos, del primer intento que no respondió: revisar.`
    : ''

  // 3. Un solo batchUpdate ATÓMICO: fila 2 nueva + formato, listas y fórmula de M + valores (+ chip). Con chip; si
  //    Google lo rechaza (no aplicó nada), de nuevo sin chip.
  let chip: ResultadoCargaFinanzas['chip'] = subido && quiereChip ? 'puesto' : 'no'
  let pedidos = loteCarga(carga, subido && chip === 'puesto' ? urlArchivoDrive(subido.id) : null)
  const avisos = [...conArchivo.avisos]
  try {
    try {
      await planilla.batchUpdate(pedidos)
    } catch (e) {
      if (chip !== 'puesto' || !rechazado(e)) throw e
      avisos.push(`Google rechazó la carga con el chip del comprobante (${mensajeDe(e)}): se repite sin el chip y la col I queda con el nombre del archivo.`)
      chip = 'rechazado'
      pedidos = loteCarga(carga, null)
      await planilla.batchUpdate(pedidos)
    }
  } catch (e) {
    if (rechazado(e)) {
      const s = await soltarArchivo()
      return { ...conArchivo, ...s, avisos, chip, pedidos, motivo: `Google rechazó la carga de la fila (${mensajeDe(e)}): no se escribió nada.${s.comprobanteId === null ? ' El comprobante subido se mandó a la papelera.' : ''}${copiaDelPrimero}${quedoEnSubidos}` }
    }
    return { ...conArchivo, avisos, chip, pedidos, escribio: true, motivo: `Falló la carga de la fila (${mensajeDe(e)}): el pedido es atómico, así que quedó la fila 2 completa o no quedó nada; revisar a mano.` }
  }
  const insertado: ResultadoCargaFinanzas = { ...conArchivo, etapa: 'verificacion', escribio: true, fila: FILA_NUEVA, avisos, chip, pedidos }

  // 4. Releer y verificar
  try {
    const [[filas23 = []], [filas2 = []], estructura] = await Promise.all([
      planilla.leer([rangoFilas(FILA_NUEVA, FILA_NUEVA + 1)], 'FORMULA'),
      planilla.leer([rangoFilas(FILA_NUEVA)], 'UNFORMATTED_VALUE'),
      planilla.estructura(FILA_NUEVA).catch(() => null),
    ])
    const verificacion = verificarCarga(carga, lectura.filas[0] ?? [], { formula: filas23, valor: filas2[0] ?? [], estructura }, chip === 'puesto' && subido ? { id: subido.id } : null)
    const fallidos = verificacion.controles.filter(c => !c.ok && !c.informativo)
    return {
      ...insertado, verificacion, ok: verificacion.ok, etapa: verificacion.ok ? 'listo' : 'verificacion',
      motivo: verificacion.ok ? null : `Se cargó pero la verificación falló: ${fallidos.map(c => `${c.que} (${c.detalle})`).join('; ')}.`,
    }
  } catch (e) {
    return { ...insertado, etapa: 'verificacion', motivo: `Se cargó pero no se pudo releer para verificar: ${mensajeDe(e)}.` }
  }
}

// ── Lista desplegable de la columna R (Tomás, 24/10/2026: sumar "Empresa") ───────────────────────────
// La usa scripts/bot-finanzas-validacion.mjs. Puro.

export const OPCION_EMPRESA = 'Empresa'

/** La lista con `opcion` agregada sin quitar ninguna: va después de la última de `despuesDe` que esté (Tomi, Gero) o
 *  al final. Si ya está, la lista queda igual (cambia = false). */
export function listaConOpcion(actual: string[], opcion: string, despuesDe: string[] = ['Tomi', 'Gero']): { lista: string[]; cambia: boolean } {
  if (actual.includes(opcion)) return { lista: [...actual], cambia: false }
  const pos = Math.max(-1, ...despuesDe.map(d => actual.indexOf(d)))
  const lista = [...actual]
  lista.splice(pos < 0 ? lista.length : pos + 1, 0, opcion)
  return { lista, cambia: true }
}

const claveRegla = (r: ValidacionCelda | null) => (r ? JSON.stringify([r.tipo, r.lista, r.strict, r.showCustomUi, r.inputMessage]) : 'sin regla')

/** Resumen de las reglas de una columna (desde la fila 2): la regla más común y cuántas celdas la tienen. */
export function resumenReglas(reglas: (ValidacionCelda | null)[]): { regla: ValidacionCelda | null; conEsa: number; total: number; distintas: number; sinRegla: number } {
  const cuenta = new Map<string, { regla: ValidacionCelda | null; n: number }>()
  for (const r of reglas) {
    const k = claveRegla(r)
    cuenta.set(k, { regla: r, n: (cuenta.get(k)?.n ?? 0) + 1 })
  }
  const conRegla = [...cuenta.values()].filter(x => x.regla).sort((a, b) => b.n - a.n)
  const principal = conRegla[0] ?? null
  return { regla: principal?.regla ?? null, conEsa: principal?.n ?? 0, total: reglas.length, distintas: conRegla.length, sinRegla: cuenta.get('sin regla')?.n ?? 0 }
}

/** setDataValidation de la columna (desde la fila 2 hasta el final) con la lista nueva, manteniendo strict,
 *  showCustomUi y el mensaje de ayuda de la regla de hoy. */
export function pedidoValidacionLista(sheetId: number, columna: number, regla: ValidacionCelda, lista: string[]): object {
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: columna, endColumnIndex: columna + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: lista.map(v => ({ userEnteredValue: v })) },
        strict: regla.strict,
        showCustomUi: regla.showCustomUi,
        ...(regla.inputMessage ? { inputMessage: regla.inputMessage } : {}),
      },
    },
  }
}

/** Pago de un cliente que ya existe (Tomás, 26/10/2026): cuántas cuotas (o PIF) suyas ya hay en "Registro de Pagos", para
 *  cargar este como "2da Cuota", "3ra Cuota"… SOLO LECTURA (scope readonly): columnas A..R de todo el Registro. */
export async function cuotasAnterioresFinanzas(p: { nombre: string | null; telefono: string | null }): Promise<number> {
  const [filas] = await planillaFinanzasReal('simulacion').leer([`'${PESTANA_REGISTRO}'!A2:${ULTIMA}`], 'UNFORMATTED_VALUE')
  return cuotasAnterioresEn(filas, p)
}
