// ── Seguimiento: lectura y escritura (SOLO servidor) ──────────────────────────────────────────────────────────────
// Pestaña "Seguimiento" del CRM de clientes (SHEET_ID_CLIENTES) y, si está conectada, la planilla de respuestas del Typeform
// (SHEET_ID_TYPEFORM, compartida con la cuenta de servicio). SEGUIMIENTO_ESCRITURA=real escribe; si no, MODO REVISIÓN (valida y
// avisa, no escribe). Solo agrega filas: nada se edita ni se borra.
import { conCache, invalidarClave } from '../anuncios/cache'
import { googleConfigurado, googleJson, sheetsBase } from '../auth/googleRest'
import { celdaSegura } from '../backend/modelo'
import { ENCABEZADOS_SEGUIMIENTO, PESTANA_SEGUIMIENTO, leerPuntaje, type Puntaje } from './modelo'
import { leerRespuestas, type ClienteParaCruce, type ResultadoTypeform } from './typeform'

export const escrituraReal = (): boolean => process.env.SEGUIMIENTO_ESCRITURA === 'real'
const configurado = (): boolean => !!process.env.SHEET_ID_CLIENTES?.trim() && googleConfigurado()
const base = (id: string) => `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(id.trim())}`
const CRM = () => base(process.env.SHEET_ID_CLIENTES!)
const RANGO = encodeURIComponent(`'${PESTANA_SEGUIMIENTO}'!A2:G`)
const ID_PESTANA = 7100005

// Caché COMPARTIDA entre instancias de Vercel (conCache: Data Cache de Next + memoria de cada instancia por hasta 60 s).
// Revisión del Hub (26/10/2026): con una caché solo en memoria, un puntaje guardado en una instancia tardaba hasta 10 min en
// verse en las otras (la cartera, Éxito y Bajas leen el último puntaje). Guardar un puntaje invalida la etiqueta en todas
// (revalidateTag) y la memoria de esta instancia; las demás lo ven en 60 s como mucho.
const CLAVE_CACHE = 'seguimiento-v2'
const CACHE_SEG = 60
export const invalidarSeguimiento = () => invalidarClave(CLAVE_CACHE)

async function leerDeLaPlanilla(): Promise<{ puntajes: Puntaje[]; ausente: boolean }> {
  try {
    const r = await googleJson<{ values?: unknown[][] }>(`${CRM()}/values/${RANGO}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)
    return { puntajes: (r.values ?? []).map(leerPuntaje).filter((p): p is Puntaje => p !== null), ausente: false }
  } catch (e) {
    if ((e as { status?: number }).status !== 400) throw e
    return { puntajes: [], ausente: true }
  }
}

/** Puntajes cargados a mano (o importados) en la pestaña Seguimiento. ausente = la pestaña todavía no existe. */
export async function leerSeguimiento(): Promise<{ puntajes: Puntaje[]; ausente: boolean }> {
  if (!configurado()) return { puntajes: [], ausente: true }
  const r = await conCache(CLAVE_CACHE, CACHE_SEG, leerDeLaPlanilla)
  return { puntajes: Array.isArray(r.data?.puntajes) ? r.data.puntajes : [], ausente: !!r.data?.ausente }
}

/** Respuestas del Typeform (si SHEET_ID_TYPEFORM está cargada). null = todavía no conectado. */
export async function leerTypeform(clientes: ClienteParaCruce[]): Promise<ResultadoTypeform | null> {
  const id = process.env.SHEET_ID_TYPEFORM?.trim()
  if (!id || !googleConfigurado()) return null
  const r = await googleJson<{ values?: unknown[][] }>(`${base(id)}/values/${encodeURIComponent('A1:Z5000')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)
  return leerRespuestas(r.values ?? [], clientes, process.env.TYPEFORM_COLUMNA_PUNTAJE)
}

async function asegurarPestana() {
  const meta = await googleJson<{ sheets?: { properties?: { title?: string } }[] }>(`${CRM()}?fields=sheets.properties.title`)
  if ((meta.sheets ?? []).some(s => s.properties?.title === PESTANA_SEGUIMIENTO)) return
  const n = ENCABEZADOS_SEGUIMIENTO.length
  await googleJson(`${CRM()}:batchUpdate`, { cuerpo: { requests: [
    { addSheet: { properties: { sheetId: ID_PESTANA, title: PESTANA_SEGUIMIENTO, gridProperties: { rowCount: 3000, columnCount: n, frozenRowCount: 1 } } } },
    { updateCells: { range: { sheetId: ID_PESTANA, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      rows: [{ values: ENCABEZADOS_SEGUIMIENTO.map(h => ({ userEnteredValue: { stringValue: h } })) }], fields: 'userEnteredValue' } },
    { repeatCell: { range: { sheetId: ID_PESTANA, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.102, green: 0.102, blue: 0.102 }, textFormat: { foregroundColor: { red: 0.953, green: 0.573, blue: 0 }, bold: true, fontSize: 9 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { setDataValidation: { range: { sheetId: ID_PESTANA, startRowIndex: 1, endRowIndex: 3000, startColumnIndex: 2, endColumnIndex: 3 },
      rule: { condition: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '1' }, { userEnteredValue: '10' }] }, strict: true, inputMessage: 'Del 1 al 10' } } },
    { setDataValidation: { range: { sheetId: ID_PESTANA, startRowIndex: 1, endRowIndex: 3000, startColumnIndex: 3, endColumnIndex: 4 },
      rule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'manual' }, { userEnteredValue: 'typeform' }] }, strict: true, showCustomUi: true } } },
    ...[110, 90, 100, 90, 300, 160, 80].map((w, i) => ({ updateDimensionProperties: { range: { sheetId: ID_PESTANA, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
  ] } })
}

const ahoraAR = (): string => new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16)

export type Resultado = { ok: true; mensaje: string; simulado?: boolean } | { ok: false; error: string }

export async function guardarPuntaje(idCliente: string, valor: number, nota: string, quien: string): Promise<Resultado> {
  if (!configurado()) return { ok: false, error: 'La planilla de clientes no está conectada.' }
  if (!escrituraReal()) return { ok: true, simulado: true, mensaje: `Modo revisión: el ${valor} quedaría anotado, pero todavía no se escribe en la planilla.` }
  try {
    await asegurarPestana()
    const fecha = ahoraAR()
    await googleJson(`${CRM()}/values/${encodeURIComponent(`'${PESTANA_SEGUIMIENTO}'!A:G`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      cuerpo: { values: [[fecha, idCliente, valor, 'manual', celdaSegura(nota), celdaSegura(quien), fecha.slice(0, 7)]] },
    })
    invalidarSeguimiento()
    return { ok: true, mensaje: `Puntaje ${valor} anotado.` }
  } catch (e) {
    console.error('[seguimiento] no se pudo guardar:', (e as Error).message?.slice(0, 160))
    return { ok: false, error: 'No se pudo guardar en la planilla. Probá de nuevo.' }
  }
}

export { asegurarPestana as asegurarPestanaSeguimiento }
