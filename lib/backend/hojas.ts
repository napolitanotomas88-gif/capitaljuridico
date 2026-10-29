// ── Backend: lectura y escritura de las pestañas "Cobros" y "Acciones backend" (SOLO servidor) ─────────────────
// Misma planilla que el CRM de clientes (SHEET_ID_CLIENTES) y misma cuenta de servicio (EDITORA). REST por fetch, sin googleapis.
//   · Escribe SOLO en esas dos pestañas, nunca en Agencia ni en Renovaciones.
//   · BACKEND_ESCRITURA=real escribe de verdad; con cualquier otro valor (o sin definir) es MODO REVISIÓN: valida y arma la fila
//     pero no escribe, y la pantalla lo avisa.
//   · Nada se borra: deshacer marca la acción como "SI (quién, cuándo)" y revierte el cobro con el estado previo guardado.
//   · Antes de modificar un cobro se vuelve a leer su fila y se comprueba que siga siendo el mismo (la planilla se puede ordenar a mano).
import { googleConfigurado, googleJson, sheetsBase } from '../auth/googleRest'
import {
  ENCABEZADOS_ACCIONES, ENCABEZADOS_COBROS, PESTANA_ACCIONES, PESTANA_COBROS, celdaSegura, datoDeToque, leerAccion, leerCobro,
  type AccionBackend, type Cobro, type Lista, type ToqueValido,
} from './modelo'
import { esYmdValido, hoyArgentina, serialAYmd, sumarMeses, type Ymd } from '../clientes/fechas'

export const modoEscrituraReal = (): boolean => process.env.BACKEND_ESCRITURA === 'real'
export const backendConfigurado = (): boolean => !!process.env.SHEET_ID_CLIENTES?.trim() && googleConfigurado()
const idPlanilla = () => encodeURIComponent(process.env.SHEET_ID_CLIENTES!.trim())
const base = () => `${sheetsBase()}/v4/spreadsheets/${idPlanilla()}`
const rango = (r: string) => encodeURIComponent(r)
const COBROS = `'${PESTANA_COBROS}'`
const ACCIONES = `'${PESTANA_ACCIONES}'`

export interface DatosBackend { cobros: Cobro[]; acciones: AccionBackend[]; pestanasAusentes: string[]; leidoEn: number }

// ── Lectura ──────────────────────────────────────────────────────────────────────────────────
// Caché corta (5 s): una pantalla que se refresca justo después de un toque no pega dos veces a Google, y las escrituras la
// descartan. La cuota de lectura (60/min) se comparte con el resto del dashboard.
let cache: { en: number; datos: DatosBackend } | null = null
let enVuelo: Promise<DatosBackend> | null = null
const FRESCO_MS = 5_000
export const invalidarBackend = () => { cache = null }

const esErrorDeRango = (e: unknown): boolean => (e as { status?: number })?.status === 400

async function pestanasExistentes(): Promise<Set<string>> {
  const r = await googleJson<{ sheets?: { properties?: { title?: string } }[] }>(`${base()}?fields=sheets.properties.title`)
  return new Set((r.sheets ?? []).map((s) => s.properties?.title ?? ''))
}

async function leerDeGoogle(): Promise<DatosBackend> {
  const pedir = async (pestanas: string[]) => {
    const rangos = pestanas.map((p) => `ranges=${rango(p === PESTANA_COBROS ? `${COBROS}!A2:K` : `${ACCIONES}!A2:J`)}`).join('&')
    const r = await googleJson<{ valueRanges?: { values?: unknown[][] }[] }>(`${base()}/values:batchGet?${rangos}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)
    return r.valueRanges ?? []
  }
  let ausentes: string[] = []
  let rangos: { values?: unknown[][] }[]
  try {
    rangos = await pedir([PESTANA_COBROS, PESTANA_ACCIONES])
  } catch (e) {
    if (!esErrorDeRango(e)) throw e
    // Una pestaña todavía no existe: se lee la que haya (y se avisa)
    const hay = await pestanasExistentes()
    ausentes = [PESTANA_COBROS, PESTANA_ACCIONES].filter((p) => !hay.has(p))
    const existentes = [PESTANA_COBROS, PESTANA_ACCIONES].filter((p) => hay.has(p))
    const leidas = existentes.length ? await pedir(existentes) : []
    rangos = [PESTANA_COBROS, PESTANA_ACCIONES].map((p) => (hay.has(p) ? leidas[existentes.indexOf(p)] : {}))
  }
  const cobros = (rangos[0]?.values ?? []).map((f, i) => leerCobro(f, i + 2)).filter((c): c is Cobro => c !== null)
  const acciones = (rangos[1]?.values ?? []).map((f, i) => leerAccion(f, i + 2)).filter((a): a is AccionBackend => a !== null)
  return { cobros, acciones, pestanasAusentes: ausentes, leidoEn: Date.now() }
}

export async function leerBackend(opciones: { fresco?: boolean } = {}): Promise<DatosBackend> {
  if (!backendConfigurado()) throw new Error('Falta la planilla de clientes o la cuenta de servicio de Google')
  if (!opciones.fresco && cache && Date.now() - cache.en < FRESCO_MS) return cache.datos
  if (!enVuelo) {
    enVuelo = leerDeGoogle().then((d) => { cache = { en: Date.now(), datos: d }; return d }).finally(() => { enVuelo = null })
  }
  return enVuelo
}

// ── Creación de las pestañas (idempotente) ────────────────────────────────────────────────────
const DARK = { red: 0.102, green: 0.102, blue: 0.102 }, NARANJA = { red: 0.953, green: 0.573, blue: 0 }
const ROJO = { red: 0.99, green: 0.89, blue: 0.85 }, VERDE = { red: 0.85, green: 0.94, blue: 0.85 }, GRIS = { red: 0.93, green: 0.93, blue: 0.93 }
const ID_COBROS = 7100003, ID_ACCIONES = 7100004
type Req = Record<string, unknown>

function requestsPestana(id: number, titulo: string, encabezados: readonly string[], anchos: number[], filas: number): Req[] {
  const n = encabezados.length
  return [
    { addSheet: { properties: { sheetId: id, title: titulo, gridProperties: { rowCount: filas, columnCount: n, frozenRowCount: 1 } } } },
    { updateCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      rows: [{ values: encabezados.map((h) => ({ userEnteredValue: { stringValue: h } })) }], fields: 'userEnteredValue' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      cell: { userEnteredFormat: { backgroundColor: DARK, textFormat: { foregroundColor: NARANJA, bold: true, fontSize: 9 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)' } },
    { setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 0, endRowIndex: filas, startColumnIndex: 0, endColumnIndex: n } } } },
    ...anchos.map((w, i) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
  ]
}
const col = (id: number, c: number, desde = 1, hasta = 5000) => ({ sheetId: id, startRowIndex: desde, endRowIndex: hasta, startColumnIndex: c, endColumnIndex: c + 1 })
const lista = (id: number, c: number, valores: string[], estricta: boolean): Req => ({
  setDataValidation: { range: col(id, c), rule: { condition: { type: 'ONE_OF_LIST', values: valores.map((v) => ({ userEnteredValue: v })) }, strict: estricta, showCustomUi: true } },
})
const formatoFecha = (id: number, c: number): Req => ({ repeatCell: { range: col(id, c), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } })
const regla = (id: number, formula: string, fondo: Record<string, number>, hasta: number): Req => ({
  addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: id, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: hasta }], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format: { backgroundColor: fondo } } } },
})

export function construirPestanas(faltan: string[]): Req[] {
  const reqs: Req[] = []
  if (faltan.includes(PESTANA_COBROS)) {
    reqs.push(
      ...requestsPestana(ID_COBROS, PESTANA_COBROS, ENCABEZADOS_COBROS, [90, 70, 110, 100, 110, 80, 110, 120, 130, 280, 130], 2000),
      lista(ID_COBROS, 2, ['Inicial', 'Renovación', 'Extra'], false),
      lista(ID_COBROS, 5, ['Sí', 'No', 'Parcial'], true),
      formatoFecha(ID_COBROS, 4), formatoFecha(ID_COBROS, 7),
      { setDataValidation: { range: col(ID_COBROS, 3), rule: { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '0' }] }, strict: true, inputMessage: 'USD acordados (número)' } } },
      { setDataValidation: { range: col(ID_COBROS, 4), rule: { condition: { type: 'DATE_IS_VALID' }, strict: true, inputMessage: 'Una fecha (dd/mm/aaaa)' } } },
      // Rojo = vencido sin cobrar · verde = cobrado
      regla(ID_COBROS, '=AND($E2<>"",$E2<TODAY(),$F2<>"Sí",$D2>0)', ROJO, 11),
      regla(ID_COBROS, '=$F2="Sí"', VERDE, 11),
    )
  }
  if (faltan.includes(PESTANA_ACCIONES)) {
    reqs.push(
      ...requestsPestana(ID_ACCIONES, PESTANA_ACCIONES, ENCABEZADOS_ACCIONES, [140, 130, 90, 110, 150, 280, 220, 220, 150, 260], 5000),
      regla(ID_ACCIONES, '=LEFT($I2,2)="SI"', GRIS, 10),
    )
  }
  return reqs
}

let pestanasVerificadas = false
/** Crea las pestañas que falten (con encabezados, listas y colores). No toca las que ya existen. */
export async function asegurarPestanas(): Promise<{ creadas: string[] }> {
  if (pestanasVerificadas) return { creadas: [] }
  const hay = await pestanasExistentes()
  const faltan = [PESTANA_COBROS, PESTANA_ACCIONES].filter((p) => !hay.has(p))
  if (faltan.length) await googleJson(`${base()}:batchUpdate`, { cuerpo: { requests: construirPestanas(faltan) } })
  pestanasVerificadas = true
  invalidarBackend()
  return { creadas: faltan }
}

// ── Escritura de un toque ───────────────────────────────────────────────────────────────────
export type ResultadoToque =
  | { ok: true; mensaje: string; simulado?: boolean; duplicado?: boolean }
  | { ok: false; error: string }

const ahoraAR = (): string => new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16)
const nuevoId = (): string => `B${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`.toUpperCase()
const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`

async function agregar(pestana: string, hasta: string, fila: unknown[], entrada: 'RAW' | 'USER_ENTERED') {
  await googleJson(`${base()}/values/${rango(`'${pestana}'!A:${hasta}`)}:append?valueInputOption=${entrada}&insertDataOption=INSERT_ROWS`, { cuerpo: { values: [fila] } })
}
async function poner(rangoA1: string, valores: unknown[][], entrada: 'RAW' | 'USER_ENTERED') {
  await googleJson(`${base()}/values/${rango(rangoA1)}?valueInputOption=${entrada}`, { metodo: 'PUT', cuerpo: { values: valores } })
}

export interface ContextoToque { periodoSiguiente: number }

/**
 * Registra un toque (ya validado por modelo.validarToque). `quien` = nombre de quien lo hizo.
 * Hace, en este orden: (1) lectura fresca, (2) comprobaciones del caso, (3) efecto en Cobros, (4) fila en "Acciones backend".
 * Si falla el paso 4 después del 3 el cobro queda cambiado sin rastro: por eso se escribe primero la acción con el estado previo
 * y recién después se toca el cobro (si el cobro falla, la acción se anula sola).
 */
export async function registrarToque(t: ToqueValido, quien: string, ctx: ContextoToque): Promise<ResultadoToque> {
  if (!backendConfigurado()) return { ok: false, error: 'El Backend todavía no está conectado a la planilla.' }
  const hoy = hoyArgentina()
  if (!modoEscrituraReal()) {
    return { ok: true, simulado: true, mensaje: `Modo revisión: "${t.accion}" quedaría anotado (${datoDeToque(t) || 'sin datos'}), pero todavía no se escribe en la planilla.` }
  }
  try {
    await asegurarPestanas()
    const datos = await leerBackend({ fresco: true })

    // Doble toque: el mismo botón, con los mismos datos, sobre el mismo ítem en el mismo minuto es el mismo toque
    const dato = celdaSegura(datoDeToque(t))
    const reciente = datos.acciones.filter((a) => !a.anulada && a.idCliente === t.idCliente && a.referencia === t.referencia && a.lista === t.lista && a.accion === t.accion && a.dato === dato).pop()
    if (reciente && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(reciente.cuando) && reciente.cuando === ahoraAR() && t.accion !== 'Recordatorio enviado') {
      return { ok: true, duplicado: true, mensaje: 'Ya estaba anotado.' }
    }

    const id = nuevoId()
    let previo: Record<string, unknown> = {}
    let cobro: Cobro | undefined
    let referencia = t.referencia
    let datoFinal = dato
    let extension: { fila: unknown[] } | null = null

    // Extender 1 mes: período siguiente en Renovaciones (Día 1 = fin actual, +1 mes, precio 0, "Extensión +1 mes…"). El toque queda en el
    // ciclo NUEVO (la nueva fecha de fin), así la tarjeta lo muestra y se puede deshacer; previo guarda el ciclo anterior.
    if (t.lista === 'renovaciones' && t.accion === 'Extender 1 mes') {
      const ren = await leerRenovaciones()
      const delCliente = ren.filter((r) => r.id === t.idCliente)
      const finActual = delCliente.map((r) => r.fin).filter((f): f is Ymd => !!f).sort().pop() ?? null
      if (finActual && finActual !== t.referencia) return { ok: false, error: `La fecha de fin ya cambió (ahora ${finActual}): actualizá la pantalla antes de extender.` }
      const desde = finActual ?? t.referencia
      const nuevoFin = sumarMeses(desde, 1)
      const periodo = Math.max(0, ...delCliente.map((r) => r.periodo)) + 1
      const nombre = delCliente.at(-1)?.nombre ?? ''
      referencia = nuevoFin
      datoFinal = celdaSegura(`Hasta ${nuevoFin}${t.nota ? ` · ${t.nota}` : ''}`)
      previo = { extension: { cicloAnterior: t.referencia, nuevoFin, periodo } }
      extension = { fila: [t.idCliente, celdaSegura(nombre), periodo, desde, nuevoFin, 0, celdaSegura(`Extensión +1 mes${t.nota ? ` (${t.nota})` : ''} · acción ${id}`), 1] }
    }

    if (t.lista === 'cuotas' && t.accion === 'Cobrado') {
      cobro = datos.cobros.find((c) => c.idCliente === t.idCliente && c.clave === t.referencia)
      if (!cobro) return { ok: false, error: 'No encuentro ese cobro en la planilla (¿lo movieron o borraron?). Actualizá la pantalla.' }
      if (cobro.saldo <= 0) return { ok: false, error: 'Ese cobro ya está cobrado.' }
      if ((t.monto ?? 0) > cobro.saldo + 0.005) return { ok: false, error: `Cobraste más que el saldo (${usd(cobro.saldo)}). Poné un monto menor o igual.` }
      previo = { fila: cobro.fila, clave: cobro.clave, pagado: cobro.pagado, montoPagado: cobro.montoPagado, fechaPago: cobro.fechaPago ?? '', medio: cobro.medio }
    }

    // (3a) la acción primero (con el estado previo): es el rastro que permite deshacer
    await agregar(PESTANA_ACCIONES, 'J', [id, ahoraAR(), t.idCliente, t.lista, t.accion, datoFinal, referencia, celdaSegura(quien), '', JSON.stringify(previo)], 'RAW')

    // (3b) efecto en Cobros
    try {
      if (cobro) {
        const total = Math.round((cobro.montoPagado + (t.monto ?? 0)) * 100) / 100
        const completo = total >= cobro.monto - 0.005
        const medios = cobro.medio && cobro.medio !== t.medio ? `${cobro.medio} + ${t.medio}` : t.medio
        await poner(`${COBROS}!F${cobro.fila}:I${cobro.fila}`, [[completo ? 'Sí' : 'Parcial', total, hoy, celdaSegura(medios)]], 'USER_ENTERED')
      } else if (extension) {
        await agregar('Renovaciones', 'H', extension.fila, 'USER_ENTERED')
      } else if (t.lista === 'renovaciones' && t.accion === 'Renovó') {
        const total = t.monto ?? 0
        const pagado = t.pagadoHoy
        const estado = pagado >= total ? 'Sí' : pagado > 0 ? 'Parcial' : 'No'
        const vence = pagado >= total ? hoy : t.venceSaldo ?? hoy
        const nota = `Renovación ${t.plan} ${t.plan === 1 ? 'mes' : 'meses'} · acción ${id}`
        await agregar(PESTANA_COBROS, 'K', [t.idCliente, ctx.periodoSiguiente, 'Renovación', total, vence, estado, pagado, pagado > 0 ? hoy : '', '', nota, celdaSegura(quien)], 'USER_ENTERED')
      }
    } catch (e) {
      // El cobro no se pudo tocar: la acción se anula para no dejar un toque que no tuvo efecto
      await anularFila((await leerBackend({ fresco: true })).acciones.find((a) => a.id === id)?.fila, `error al escribir el cobro (${quien})`).catch(() => {})
      throw e
    }
    invalidarBackend()
    if (extension) await refrescarCRM()
    return { ok: true, mensaje: extension ? `Extendido 1 mes: el nuevo fin es ${referencia}.` : mensajeDe(t) }
  } catch (e) {
    console.error('[backend] no se pudo registrar el toque:', (e as Error).message?.slice(0, 160))
    invalidarBackend()
    return { ok: false, error: 'No se pudo guardar en la planilla. Probá de nuevo en unos segundos.' }
  }
}

const mensajeDe = (t: ToqueValido): string => {
  switch (t.accion) {
    case 'Renovó': return 'Renovación anotada y cobro cargado.'
    case 'Cobrado': return `Cobro anotado (${usd(t.monto ?? 0)}).`
    default: return `${t.accion}: anotado.`
  }
}

// ── Renovaciones (solo para "Extender 1 mes") ──
interface FilaRenovacion { fila: number; id: string; nombre: string; periodo: number; fin: Ymd | null; notas: string }
const RENOVACIONES = `'Renovaciones'`
async function leerRenovaciones(): Promise<FilaRenovacion[]> {
  const r = await googleJson<{ valueRanges?: { values?: unknown[][] }[] }>(`${base()}/values:batchGet?ranges=${rango(`${RENOVACIONES}!A2:H`)}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)
  const fecha = (c: unknown): Ymd | null => (typeof c === 'number' ? serialAYmd(c) : esYmdValido(String(c ?? '')) ? String(c) : null)
  return (r.valueRanges?.[0]?.values ?? []).map((f, i) => ({
    fila: i + 2, id: String(f[0] ?? '').trim().toUpperCase(), nombre: String(f[1] ?? ''), periodo: Number(f[2]) || 0, fin: fecha(f[4]), notas: String(f[6] ?? ''),
  })).filter((x) => x.id)
}
/** Después de tocar Renovaciones, la fecha de fin del CRM cambia (la calcula la planilla): se relee para que la lista la muestre */
async function refrescarCRM() {
  if (process.env.BACKEND_SIN_REFRESCO === '1') return   // pruebas con el Google simulado
  try { const { leerClientes } = await import('../clientes/leer'); await leerClientes({ forzar: true }) } catch { /* se verá en la próxima lectura (10 min) */ }
}

async function anularFila(fila: number | undefined, motivo: string) {
  if (!fila) return
  await poner(`${ACCIONES}!I${fila}`, [[celdaSegura(`SI (${motivo}, ${ahoraAR()})`)]], 'RAW')
}

// ── Deshacer ─────────────────────────────────────────────────────────────────────────────────
export interface ItemRef { lista: Lista; idCliente: string; referencia: string }

/** Deshace el último toque vigente de un ítem: lo marca anulado y revierte lo que haya hecho en Cobros. */
export async function deshacerUltimo(item: ItemRef, quien: string): Promise<ResultadoToque> {
  if (!backendConfigurado()) return { ok: false, error: 'El Backend todavía no está conectado a la planilla.' }
  if (!modoEscrituraReal()) return { ok: true, simulado: true, mensaje: 'Modo revisión: no hay nada escrito para deshacer.' }
  try {
    const datos = await leerBackend({ fresco: true })
    // En renovaciones el ciclo se comparte con proyección: se deshace el último toque de cualquiera de las dos listas
    const listas: Lista[] = item.lista === 'cuotas' ? ['cuotas'] : ['renovaciones', 'proyeccion']
    // También vale una extensión hecha desde este ciclo (quedó anotada en el ciclo nuevo, pero la pantalla puede seguir mostrando el viejo)
    const delItem = (a: AccionBackend) => a.referencia === item.referencia || a.previo.includes(`"cicloAnterior":"${item.referencia}"`)
    const ultima = datos.acciones.filter((a) => !a.anulada && a.idCliente === item.idCliente && delItem(a) && listas.includes(a.lista as Lista)).pop()
    if (!ultima) return { ok: false, error: 'No hay nada para deshacer en este ítem.' }

    // Revertir el efecto en Cobros ANTES de marcar la acción (si falla, la acción sigue vigente y se puede reintentar)
    if (ultima.lista === 'cuotas' && ultima.accion === 'Cobrado' && ultima.previo) {
      const p = JSON.parse(ultima.previo) as { fila: number; clave: string; pagado: string; montoPagado: number; fechaPago: string; medio: string }
      const actual = datos.cobros.find((c) => c.clave === p.clave && c.idCliente === item.idCliente)
      if (!actual) return { ok: false, error: 'No encuentro el cobro para revertirlo (¿lo movieron?). Corregilo a mano en la planilla.' }
      await poner(`${COBROS}!F${actual.fila}:I${actual.fila}`, [[p.pagado, p.montoPagado, p.fechaPago, celdaSegura(p.medio)]], 'USER_ENTERED')
    }
    if (ultima.lista === 'renovaciones' && ultima.accion === 'Renovó') {
      // El cobro que creó esta renovación (lo identifica el ID de la acción en la nota): queda en 0 y rotulado, no se borra
      const creado = datos.cobros.find((c) => c.nota.includes(`acción ${ultima.id}`))
      if (creado) await poner(`${COBROS}!D${creado.fila}:J${creado.fila}`, [[0, '', 'No', 0, '', '', celdaSegura(`ANULADO · ${creado.nota}`)]], 'USER_ENTERED')
    }
    let extensionDeshecha = false
    if (ultima.lista === 'renovaciones' && ultima.accion === 'Extender 1 mes') {
      // La fila de Renovaciones que agregó ESTE toque (la identifica el ID en la nota): se vacía y el fin vuelve a ser el anterior
      const fila = (await leerRenovaciones()).find((r) => r.notas.includes(`acción ${ultima.id}`))
      if (fila) await poner(`${RENOVACIONES}!A${fila.fila}:H${fila.fila}`, [['', '', '', '', '', '', '', '']], 'RAW')
      extensionDeshecha = true
    }
    await anularFila(ultima.fila, `deshecho por ${quien}`)
    invalidarBackend()
    if (extensionDeshecha) await refrescarCRM()
    return { ok: true, mensaje: `Deshecho: ${ultima.accion}.` }
  } catch (e) {
    console.error('[backend] no se pudo deshacer:', (e as Error).message?.slice(0, 160))
    invalidarBackend()
    return { ok: false, error: 'No se pudo deshacer. Probá de nuevo en unos segundos.' }
  }
}
