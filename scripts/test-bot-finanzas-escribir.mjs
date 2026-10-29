// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-finanzas-escribir.mjs
// Carga del pago en "Registro de Pagos" (lib/bot/alta/finanzasEscribir.ts), limpieza de pruebas (finanzasLimpiar.ts) y
// la lista desplegable de R. SIN RED: sin credenciales de Google ni Puente Drive, con una planilla de juguete en memoria
// que imita lo que importa de la API (FORMULA / UNFORMATTED_VALUE, updateCells con numberValue / stringValue /
// formulaValue, insertDimension y deleteDimension que corren las referencias, copyPaste con referencias relativas,
// chips, batchUpdate atómico, ganchos para simular otra carga en el medio) y un puente de juguete. Datos inventados.
// Los reintentos del puente se prueban con el cliente real (puenteDriveReal) y un Apps Script de juguete DETRÁS del
// fetch, con un reloj de juguete (las esperas no se esperan de verdad).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'SHEET_ID_FINANZAS', 'PUENTE_DRIVE_URL', 'PUENTE_DRIVE_SECRETO', 'VERCEL', 'VERCEL_ENV']) delete process.env[k]

const {
  armarCarga, buscarRepetido, cargarPagoFinanzas, celdaApi, encabezadosDistintos, extensionDe, formulaApuntaA, lecturaDesde,
  listaConOpcion, loteCarga, mimeAceptado, mismoValor, nombreArchivoComprobante, pedidoValidacionLista, rangosLectura,
  nombreConSufijo, resumenReglas, textoLiteral, tramosValores, urlArchivoDrive, OPCION_EMPRESA,
} = await import('../lib/bot/alta/finanzasEscribir.ts')
const {
  comprobantePruebaAPapelera, controlarBorrado, diferenciasConPrueba, entornoProhibido, filasDePrueba, limpiarPagoPrueba, HUELLA_PRUEBA,
} = await import('../lib/bot/alta/finanzasLimpiar.ts')
const { bytesDeBase64, esIdDrive, puenteDriveReal, CARPETA_COMPROBANTES, MAXIMO_APPS_SCRIPT_MS } = await import('../lib/bot/alta/puenteDrive.ts')
const { parsearAlta } = await import('../lib/bot/alta/parsear.ts')
const { filaRegistroPagos } = await import('../lib/bot/alta/finanzas.ts')
const { ymdASerial, serialAYmd } = await import('../lib/clientes/fechas.ts')

const HOY = '2026-10-24'
const S = ymdASerial(HOY)
const SHEET_ID = 1580408897

// ── Planilla de juguete con la forma real de "Registro de Pagos" (24/10/2026) ──
const ENC = ['', '', 'Nombre del Cliente', 'Telefono', 'Efectivo Recaudado', 'Pesos ARS', 'Closer', 'Setter', 'Comprobante', 'Concepto',
  'Fuente', 'Comisión', 'Mes', 'Tipos de venta', 'Tipo de pago', '', '← CAT - CASH', 'Cuenta que recibió']
const lista = (vals, strict = true) => ({ tipo: 'ONE_OF_LIST', lista: vals, strict, showCustomUi: true, inputMessage: null })
const LISTAS = {
  1: lista(['DFY | PP | $3000', 'DFY | PIF | $2400', 'DFY | PIF | $2600', 'DFY | PP | $3300', 'DWY | PIF | $447', 'DWY | PP | $600', 'DFY+R | PIF | $3400', 'DFY+R | PP | $3400', 'DFY+R++ | PIF | $3800', 'DFY+R++ | PP | $3800', 'DFY | PIF | $6.000', 'DFY | PP | $8.000']),
  6: lista(['Gero', 'Fer', 'Juan', 'Carlos', 'Tomi', 'Marcos', 'Yami']),
  7: lista(['Tomi / Gero', 'Mai', 'ENRU / Mai']),
  9: lista(['Fee', '1ra Cuota', '2da Cuota', '3ra Cuota', '4ta Cuota', 'PIF']),
  10: lista(['Inbound IG', 'Inbound Tiktok', 'VSL Funnel', 'BIO Página Web', 'Referido', 'Outbound', 'Webinar', 'Enrutamiento']),
  13: lista(['Front-end', 'Back-end']),
  14: lista(['Upfront', 'Payment Plan']),
  17: lista(['Tomi', 'Gero', 'Relay', 'Financiera', 'Otra']),
}
const validacionesFila = (listas = LISTAS) => Array.from({ length: 18 }, (_, i) => (listas[i] ? structuredClone(listas[i]) : null))
const formulaM = (n) => `=IF(A${n}="";""; TEXT(A${n}; "yyyy-mmmm"))`
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function filaVieja(n, nombre, serial, usd) {
  return [serial, '', nombre, '54 9 11 4000-000' + n, usd, '', 'Gero', 'Mai', `${nombre} - PIF.jpeg`, 'PIF', 'Inbound IG', '', formulaM(n), 'Front-end', 'Upfront']
}
function hojaInicial() {
  const filas = [ENC]
  const nombres = ['Ana Inventada', 'Beto Inventado', 'Caro Inventada', 'Dani Inventado', 'Eli Inventada']
  nombres.forEach((nom, i) => filas.push(filaVieja(i + 2, nom, S - 1 - i, 2600)))
  return {
    filas,
    validaciones: filas.map((_, i) => (i === 0 ? Array(18).fill(null) : validacionesFila())),
    chips: filas.map((f, i) => (i === 0 ? [] : [`https://drive.google.com/file/d/VIEJO${i}xxxxxxxxxxxxxxxxxxxx/view`])),
    filasHoja: 5719,
  }
}

const vacia = (c) => c === undefined || c === null || c === ''
const esF = (c) => typeof c === 'string' && c.startsWith('=')
const letraAIndice = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
function parsear(rango) {
  const m = /^'(.+)'!([A-Z]+)(\d+)?:([A-Z]+)(\d+)?$/.exec(rango)
  if (!m || m[1] !== 'Registro de Pagos') throw new Error(`Unable to parse range: ${rango}`)
  return { c0: letraAIndice(m[2]), f0: m[3] ? Number(m[3]) : 2, c1: letraAIndice(m[4]), f1: m[5] ? Number(m[5]) : null }
}
function recortar(filas) {
  const out = filas.map(f => { const r = [...f]; while (r.length && vacia(r[r.length - 1])) r.pop(); return r.map(c => (c === undefined || c === null ? '' : c)) })
  while (out.length && !out[out.length - 1].length) out.pop()
  return out
}
/** Corre las referencias de fila de las fórmulas: las >= desde suman delta (insert) o restan (delete). */
const correrRefs = (formula, desde, delta) => formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, a, col, b, fila) => (Number(fila) >= desde ? `${a}${col}${b}${Number(fila) + delta}` : m))
const ajustarRelativo = (formula, delta) => formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, a, col, b, fila) => (b ? m : `${a}${col}${Number(fila) + delta}`))

/** Otra carga (un pago real inventado) que entra en la fila `pos`, como el Formulario de Pagos de Aylu. */
const FILA_AYLU = [S, '', 'Cliente Real Inventado', '54 9 11 5555-1234', 7777.77, '', 'Gero', 'Mai', 'Cliente Real Inventado - PIF.jpeg', 'PIF', 'Inbound IG']
function meterFila(h, fila = FILA_AYLU, pos = 2) {
  for (const f of h.filas) f.forEach((c, i) => { if (esF(c)) f[i] = correrRefs(c, pos, 1) })
  h.filas.splice(pos - 1, 0, [...fila]); h.validaciones.splice(pos - 1, 0, validacionesFila()); h.chips.splice(pos - 1, 0, [])
  h.filasHoja++
}

function planillaDeJuguete(hoja, opciones = {}) {
  const llamadas = []
  const drive = opciones.drive
  const calcular = (f, c) => {
    const v = hoja.filas[f - 1]?.[c]
    if (!esF(v)) return v
    const m = /^=IF\(A(\d+)="";""; TEXT\(A\1; "yyyy-mmmm"\)\)$/.exec(v)
    if (m) { const a = hoja.filas[Number(m[1]) - 1]?.[0]; if (vacia(a)) return ''; const ymd = serialAYmd(a); return `${ymd.slice(0, 4)}-${MESES[Number(ymd.slice(5, 7)) - 1]}` }
    return 0
  }
  const leerRango = (rango, render) => {
    const r = parsear(rango)
    const f1 = r.f1 ?? hoja.filas.length
    const out = []
    for (let f = r.f0; f <= f1; f++) { const fila = []; for (let c = r.c0; c <= r.c1; c++) fila.push(render === 'FORMULA' ? hoja.filas[f - 1]?.[c] : calcular(f, c)); out.push(fila) }
    return recortar(out)
  }
  const fila = (h, f) => { while (h.filas.length < f) { h.filas.push([]); h.validaciones.push(Array(18).fill(null)); h.chips.push([]) } return h.filas[f - 1] }

  function aplicar(h, req) {
    if (req.insertDimension) {
      const { range: r, inheritFromBefore } = req.insertDimension
      assert.equal(r.sheetId, SHEET_ID); assert.equal(r.dimension, 'ROWS')
      const n = r.endIndex - r.startIndex, desde = r.startIndex + 1
      for (const f of h.filas) f.forEach((c, i) => { if (esF(c)) f[i] = correrRefs(c, desde, n) })
      for (let k = 0; k < n; k++) { h.filas.splice(r.startIndex, 0, []); h.validaciones.splice(r.startIndex, 0, Array(18).fill(null)); h.chips.splice(r.startIndex, 0, []) }
      h.filasHoja += n
      h.heredo = inheritFromBefore
      return
    }
    if (req.deleteDimension) {
      const r = req.deleteDimension.range
      assert.equal(r.sheetId, SHEET_ID)
      const n = r.endIndex - r.startIndex
      h.filas.splice(r.startIndex, n); h.validaciones.splice(r.startIndex, n); h.chips.splice(r.startIndex, n)
      for (const f of h.filas) f.forEach((c, i) => { if (esF(c)) f[i] = correrRefs(c, r.endIndex + 1, -n) })
      h.filasHoja -= n
      return
    }
    if (req.copyPaste) {
      const { source: s, destination: d, pasteType } = req.copyPaste
      if (s.sheetId !== SHEET_ID || d.sheetId !== SHEET_ID) throw Object.assign(new Error('sheetId inválido'), { code: 400 })
      for (let c = s.startColumnIndex; c < s.endColumnIndex; c++) {
        if (pasteType === 'PASTE_FORMULA') { const v = h.filas[s.startRowIndex]?.[c]; fila(h, d.startRowIndex + 1)[c] = esF(v) ? ajustarRelativo(v, d.startRowIndex - s.startRowIndex) : v }
        else if (pasteType === 'PASTE_DATA_VALIDATION') h.validaciones[d.startRowIndex][c] = structuredClone(h.validaciones[s.startRowIndex]?.[c] ?? null)
        else if (pasteType !== 'PASTE_FORMAT') throw new Error(`pasteType inesperado ${pasteType}`)
      }
      return
    }
    if (req.updateCells) {
      const { start, rows, fields } = req.updateCells
      assert.equal(start.sheetId, SHEET_ID)
      if (fields === 'userEnteredValue') {   // valores: el CellData vacío borra la celda
        if (opciones.rechazarValores) throw Object.assign(new Error('Invalid value'), { code: 400 })
        rows[0].values.forEach((cel, k) => {
          const u = cel.userEnteredValue ?? {}
          fila(h, start.rowIndex + 1)[start.columnIndex + k] = 'numberValue' in u ? u.numberValue : 'formulaValue' in u ? u.formulaValue : 'stringValue' in u ? u.stringValue : 'boolValue' in u ? u.boolValue : ''
        })
        return
      }
      if (opciones.rechazarChip) throw Object.assign(new Error('Writing Drive file chips requires a Drive scope'), { code: 403 })
      assert.equal(fields, 'userEnteredValue,chipRuns')
      const cel = rows[0].values[0]
      assert.equal(cel.userEnteredValue.stringValue, '@')
      const uri = cel.chipRuns[0].chip.richLinkProperties.uri
      const id = /\/d\/([^/]+)/.exec(uri)?.[1]
      fila(h, start.rowIndex + 1)[start.columnIndex] = drive?.archivos.get(id)?.nombre ?? '@'
      h.chips[start.rowIndex] = [uri]
      return
    }
    if (req.setDataValidation) {
      const { range: r, rule } = req.setDataValidation
      const regla = { tipo: rule.condition.type, lista: rule.condition.values.map(v => v.userEnteredValue), strict: rule.strict, showCustomUi: rule.showCustomUi, inputMessage: rule.inputMessage ?? null }
      for (let f = r.startRowIndex; f < h.validaciones.length; f++) for (let c = r.startColumnIndex; c < r.endColumnIndex; c++) h.validaciones[f][c] = structuredClone(regla)
      return
    }
    throw new Error(`Pedido inesperado: ${JSON.stringify(req)}`)
  }

  return {
    llamadas, hoja,
    async leer(rangos, render) { llamadas.push({ tipo: 'leer', rangos, render }); if (opciones.fallarLeer) throw opciones.fallarLeer; return rangos.map(r => leerRango(r, render)) },
    async estructura(f) {
      llamadas.push({ tipo: 'estructura', f })
      return { sheetId: opciones.sinSheetId ? undefined : SHEET_ID, filasHoja: hoja.filasHoja, validaciones: structuredClone(hoja.validaciones[f - 1] ?? Array(18).fill(null)), chips: [...(hoja.chips[f - 1] ?? [])] }
    },
    async validacionesDeColumna(letra) { const c = letraAIndice(letra); return hoja.validaciones.slice(1).map(v => structuredClone(v[c] ?? null)) },
    async batchUpdate(requests) {
      llamadas.push({ tipo: 'batchUpdate', requests })
      const inserta = requests.some(r => r.insertDimension), borra = requests.some(r => r.deleteDimension)
      // Ganchos de una sola vez: otra carga justo antes / justo después de este pedido
      const gancho = (k) => { const g = opciones[k]; if (g) { opciones[k] = null; g(hoja) } }
      if (inserta) gancho('antesDeLote')
      if (borra) gancho('antesDeBorrar')
      if (opciones.fallarBatch && inserta) throw opciones.fallarBatch
      const copia = structuredClone(hoja)   // atómico: si un pedido falla, no se aplica ninguno
      for (const r of requests) aplicar(copia, r)
      Object.assign(hoja, copia)
      if (inserta) gancho('despuesDeLote')
      if (borra) gancho('despuesDeBorrar')
    },
  }
}

function puenteDeJuguete(opciones = {}) {
  const archivos = new Map(), llamadas = []
  let n = 0
  return {
    archivos, llamadas,
    async subirArchivo({ carpetaId, nombre, mimeType, base64 }) {
      llamadas.push({ tipo: 'subir', carpetaId, nombre, mimeType })
      if (opciones.fallarSubida) throw opciones.fallarSubida
      for (const [id, a] of archivos) if (a.nombre === nombre && !a.papelera) return { id, url: `https://drive.google.com/file/d/${id}/view?usp=drivesdk`, yaExistia: true }
      const id = `ARCHIVO${++n}${'x'.repeat(26)}`
      archivos.set(id, { nombre, mimeType, bytes: bytesDeBase64(base64), carpetaId, papelera: false })
      return { id, url: `https://drive.google.com/file/d/${id}/view?usp=drivesdk`, yaExistia: false }
    },
    async aPapelera(id) { llamadas.push({ tipo: 'papelera', id }); const a = archivos.get(id); if (!a) throw new Error('no existe'); a.papelera = true },
  }
}

// ── El #ALTA inventado de la prueba real ──
const MENSAJE = `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: PRUEBA BOT - borrar
Teléfono: +54 9 11 3000-9999
Socios: ninguno
Correo: prueba.bot@example.com
Dirección: Calle Inventada 123, CABA
DNI: 30999999
CUIT: 20-30999999-1
Inicio del servicio: 24/10/2026
Cuotas:
24/11/2026 1100
24/12/2026 1100`
const filaPrueba = (extras = {}, mensaje = MENSAJE) => filaRegistroPagos(parsearAlta(mensaje), { fecha: HOY, setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Tomi', ...extras })
const COMPROBANTE = { nombre: 'IMG-2026.png', mimeType: 'image/png', base64: Buffer.from('png de prueba').toString('base64') }
async function lecturaDe(planilla) {
  const [bloques, estructura] = await Promise.all([planilla.leer(rangosLectura(), 'FORMULA'), planilla.estructura(2)])
  return lecturaDesde(bloques, estructura)
}
const escrituras = (p) => p.llamadas.filter(l => l.tipo === 'batchUpdate')

describe('utilidades', () => {
  test('extensión y nombre del comprobante (col I + extensión, sin repetirla)', () => {
    assert.equal(extensionDe('image/jpeg'), '.jpeg')
    assert.equal(extensionDe('application/pdf'), '.pdf')
    assert.equal(extensionDe('application/octet-stream', 'foto.HEIC'), '.heic')
    assert.equal(extensionDe('raro/raro', 'sin-extension'), '')
    assert.equal(nombreArchivoComprobante('Ana Pérez - PP 1/3', { mimeType: 'image/png', nombre: 'x.png' }), 'Ana Pérez - PP 1/3.png')
    assert.equal(nombreArchivoComprobante('Ana Pérez - PIF.pdf', { mimeType: 'application/pdf', nombre: '' }), 'Ana Pérez - PIF.pdf')
    assert.equal(nombreArchivoComprobante('  Ana \n Pérez  ', { mimeType: 'image/jpeg', nombre: '' }), 'Ana Pérez.jpeg')
    assert.equal(nombreArchivoComprobante('', { mimeType: 'image/png', nombre: '' }), null)
    assert.ok(mimeAceptado('image/jpeg') && mimeAceptado('application/pdf') && !mimeAceptado('text/html'))
    assert.equal(urlArchivoDrive('abc'), 'https://drive.google.com/file/d/abc/view')
    assert.equal(bytesDeBase64(Buffer.from('hola mundo').toString('base64')), 10)
    assert.ok(esIdDrive('fixture-google-id-000000000000000000000018') && !esIdDrive('../x') && !esIdDrive(''))
  })
  test('celdaApi / textoLiteral / tramosValores: texto literal sin apóstrofo, número, fórmula solo donde se pide', () => {
    assert.deepEqual(celdaApi('54 9 11 3000-9999'), { userEnteredValue: { stringValue: '54 9 11 3000-9999' } })
    assert.deepEqual(celdaApi('=HACK()'), { userEnteredValue: { stringValue: '=HACK()' } })
    assert.deepEqual(celdaApi('=IF(A2="";"";1)', true), { userEnteredValue: { formulaValue: '=IF(A2="";"";1)' } })
    assert.deepEqual(celdaApi('TRUE'), { userEnteredValue: { stringValue: 'TRUE' } })
    assert.deepEqual(celdaApi(1100), { userEnteredValue: { numberValue: 1100 } })
    assert.deepEqual([celdaApi(''), celdaApi(Number.NaN)], [{}, {}])
    assert.equal(textoLiteral("'+34 600111222"), '+34 600111222')
    assert.equal(textoLiteral('DFY | PP | $3300'), 'DFY | PP | $3300')
    assert.equal(textoLiteral(null), null)
    const t = tramosValores(SHEET_ID, ['a', null, null, 'b', '', null])
    assert.deepEqual(t.map(x => [x.updateCells.start, x.updateCells.rows[0].values, x.updateCells.fields]), [
      [{ sheetId: SHEET_ID, rowIndex: 1, columnIndex: 0 }, [{ userEnteredValue: { stringValue: 'a' } }], 'userEnteredValue'],
      [{ sheetId: SHEET_ID, rowIndex: 1, columnIndex: 3 }, [{ userEnteredValue: { stringValue: 'b' } }, {}], 'userEnteredValue'],
    ])
  })
  test('mismoValor y formulaApuntaA', () => {
    assert.ok(mismoValor("'54 9 11 3000-9999", '54 9 11 3000-9999'))
    assert.ok(mismoValor(1100, 1100) && !mismoValor(1100, '1100'))
    assert.ok(mismoValor('', undefined) && !mismoValor('Tomi', ''))
    assert.ok(formulaApuntaA(formulaM(2), 2) && !formulaApuntaA(formulaM(12), 2) && !formulaApuntaA(formulaM(3), 2))
  })
  test('encabezados: los de hoy pasan (A y B vacíos); una columna movida frena', () => {
    assert.deepEqual(encabezadosDistintos(ENC), [])
    const movida = [...ENC]; movida[2] = 'Telefono'; movida[3] = 'Nombre del Cliente'
    assert.equal(encabezadosDistintos(movida).length, 2)
  })
  test('buscarRepetido: mismo cliente + fecha + monto (sin importar mayúsculas ni acentos)', () => {
    const filas = [[S, '', 'Ána  Inventada', '', 2600], [S, '', 'Beto', '', 1100]]
    assert.equal(buscarRepetido(filas, { A: S, C: 'ana inventada', E: 2600 }), 2)
    assert.equal(buscarRepetido(filas, { A: S, C: 'Ana Inventada', E: 1100 }), null)
    assert.equal(buscarRepetido(filas, { A: S - 1, C: 'Beto', E: 1100 }), null)
  })
})

describe('armarCarga (puro)', () => {
  test('caso de la prueba real: inserta la fila 2, copia formato, listas y la fórmula de M; A2:R2 sin tocar M, P ni Q', async () => {
    const p = planillaDeJuguete(hojaInicial())
    const fila = filaPrueba()
    assert.deepEqual(fila.pendientes, [])
    const c = armarCarga(fila, await lecturaDe(p), { comprobante: COMPROBANTE })
    assert.ok(c.ok, c.errores.join(' '))
    assert.equal(c.formulaM, 'copiada')
    assert.deepEqual(c.insertar[0], { insertDimension: { range: { sheetId: SHEET_ID, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, inheritFromBefore: false } })
    assert.deepEqual(c.insertar.slice(1).map(x => x.copyPaste.pasteType), ['PASTE_FORMAT', 'PASTE_DATA_VALIDATION', 'PASTE_FORMULA'])
    assert.deepEqual(c.insertar[3].copyPaste.source, { sheetId: SHEET_ID, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 12, endColumnIndex: 13 })
    const v = c.valores
    assert.equal(v.length, 18)
    assert.deepEqual([v[0], v[1], v[2], v[3], v[4], v[8], v[9], v[12], v[15], v[16], v[17]],
      [S, 'DFY | PP | $3300', 'PRUEBA BOT - borrar', '54 9 11 3000-9999', 1100, 'PRUEBA BOT - borrar - PP 1/3', '1ra Cuota', null, null, null, 'Tomi'])
    assert.equal(c.comprobante.nombreArchivo, 'PRUEBA BOT - borrar - PP 1/3.png')
    assert.ok(c.controles.some(x => x.includes('B, G, H, J, K, N, O, R')))
    // Lote sin chip: insertar + tramos A–L, N–O y R (M copiada, P y Q no se tocan)
    const tramos = (lote) => lote.filter(x => x.updateCells?.fields === 'userEnteredValue').map(t => [t.updateCells.start.columnIndex, t.updateCells.rows[0].values.length])
    const sin = loteCarga(c, null)
    assert.deepEqual(sin.slice(0, 4), c.insertar)
    assert.deepEqual(tramos(sin), [[0, 12], [13, 2], [17, 1]])
    const a2 = sin[4].updateCells.rows[0].values
    assert.deepEqual([a2[0], a2[3], a2[4], a2[5]], [{ userEnteredValue: { numberValue: S } }, { userEnteredValue: { stringValue: '54 9 11 3000-9999' } }, { userEnteredValue: { numberValue: 1100 } }, {}])
    // Con chip: los tramos saltean I (A–H, J–L, N–O, R) y el chip va al final, todo en el MISMO lote
    const ch = loteCarga(c, urlArchivoDrive('ID123'))
    assert.deepEqual(tramos(ch), [[0, 8], [9, 3], [13, 2], [17, 1]])
    assert.deepEqual(ch.at(-1).updateCells.start, { sheetId: SHEET_ID, rowIndex: 1, columnIndex: 8 })
    assert.equal(ch.at(-1).updateCells.fields, 'userEnteredValue,chipRuns')
  })
  test('sin la fórmula de M en la fila 2 de hoy: se escribe la de finanzas.ts', async () => {
    const h = hojaInicial(); h.filas[1][12] = ''
    const c = armarCarga(filaPrueba(), await lecturaDe(planillaDeJuguete(h)), {})
    assert.ok(c.ok)
    assert.equal(c.formulaM, 'escrita')
    assert.equal(c.valores[12], formulaM(2))
    assert.equal(c.insertar.length, 3)
    const tramo = loteCarga(c, null).find(x => x.updateCells?.start.columnIndex === 0).updateCells.rows[0].values
    assert.equal(tramo.length, 15, 'A–O en un solo tramo (M incluida)')
    assert.deepEqual(tramo[12], { userEnteredValue: { formulaValue: formulaM(2) } })
    assert.ok(c.avisos.some(a => a.includes('Sin comprobante')))
  })
  test('frena: pendientes, "Empresa" fuera de la lista estricta, encabezado movido, repetido, fecha en texto, sin sheetId', async () => {
    const p = planillaDeJuguete(hojaInicial())
    const lectura = await lecturaDe(p)
    const conPendientes = armarCarga(filaPrueba({ setter: '' }), lectura)
    assert.ok(!conPendientes.ok && conPendientes.errores[0].includes('Faltan datos'))
    const empresa = armarCarga(filaPrueba({ cuenta: 'Empresa' }), lectura)
    assert.ok(!empresa.ok && empresa.errores.some(e => e.includes('bot-finanzas-validacion.mjs')))
    const h2 = hojaInicial(); h2.filas[0] = [...ENC]; h2.filas[0][4] = 'USD'
    assert.ok(!armarCarga(filaPrueba(), await lecturaDe(planillaDeJuguete(h2))).ok)
    const h3 = hojaInicial(); h3.filas.splice(1, 0, [S, '', 'PRUEBA BOT - borrar', '', 1100]); h3.validaciones.splice(1, 0, validacionesFila()); h3.chips.splice(1, 0, [])
    const rep = armarCarga(filaPrueba(), await lecturaDe(planillaDeJuguete(h3)))
    assert.ok(!rep.ok && rep.errores.some(e => e.includes('fila 2')))
    const f = filaPrueba(); f.celdas.A = '24/10/2026'
    assert.ok(!armarCarga(f, lectura).ok)
    assert.ok(!armarCarga(filaPrueba(), await lecturaDe(planillaDeJuguete(hojaInicial(), { sinSheetId: true }))).ok)
    assert.ok(!armarCarga(filaPrueba(), lectura, { comprobante: { ...COMPROBANTE, mimeType: 'text/html' } }).ok)
  })
  test('lista NO estricta: el valor fuera de la lista pasa con aviso', async () => {
    const h = hojaInicial(); h.validaciones[1][17].strict = false
    const c = armarCarga(filaPrueba({ cuenta: 'Empresa' }), await lecturaDe(planillaDeJuguete(h)))
    assert.ok(c.ok)
    assert.ok(c.avisos.some(a => a.includes('inválido')))
  })
})

describe('cargarPagoFinanzas', () => {
  test('simulación: solo lee; no sube nada ni escribe', async () => {
    const p = planillaDeJuguete(hojaInicial()), d = puenteDeJuguete()
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'simulacion', deps: { planilla: () => p, puente: () => d } })
    assert.ok(r.ok, r.motivo)
    assert.equal(r.escribio, false)
    assert.equal(escrituras(p).length, 0)
    assert.equal(d.llamadas.length, 0)
    assert.ok(r.pedidos.some(x => x.insertDimension) && r.pedidos.some(x => x.updateCells?.rows[0].values[0].chipRuns))
  })
  test('real: sube el comprobante, inserta en la fila 2 con chip, la fila de antes baja a la 3 y verifica todo', async () => {
    const h = hojaInicial(), antes = structuredClone(h.filas)
    const d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(r.ok, r.motivo)
    assert.equal(r.fila, 2)
    assert.equal(r.chip, 'puesto')
    assert.ok(r.verificacion.controles.every(c => c.ok), JSON.stringify(r.verificacion.controles))
    const archivo = d.archivos.get(r.comprobanteId)
    assert.deepEqual([archivo.nombre, archivo.carpetaId, archivo.mimeType], ['PRUEBA BOT - borrar - PP 1/3.png', CARPETA_COMPROBANTES, 'image/png'])
    assert.deepEqual(h.chips[1], [urlArchivoDrive(r.comprobanteId)])
    assert.equal(h.filas[1][2], 'PRUEBA BOT - borrar')
    assert.equal(h.filas[1][3], '54 9 11 3000-9999')
    assert.equal(h.filas[1][12], formulaM(2))
    assert.equal(h.filas[1][17], 'Tomi')
    assert.deepEqual(h.filas[2], [...antes[1].slice(0, 12), formulaM(3), ...antes[1].slice(13)], 'la fila de antes bajó a la 3 con su fórmula ajustada')
    assert.deepEqual(h.validaciones[1], validacionesFila(), 'la fila nueva tiene las listas desplegables')
    assert.equal(h.heredo, false)
    assert.equal(h.filasHoja, 5720)
    assert.equal(p.llamadas.filter(l => l.tipo === 'batchUpdate').length, 1, 'inserción, valores y chip en UN solo batchUpdate')
  })
  test('real: si Google rechaza el chip, repite sin chip y la col I queda con el nombre', async () => {
    const h = hojaInicial(), d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d, rechazarChip: true })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(r.ok, r.motivo)
    assert.equal(r.chip, 'rechazado')
    assert.equal(h.filas[1][8], 'PRUEBA BOT - borrar - PP 1/3')
    assert.deepEqual(h.chips[1], [])
    assert.ok(r.avisos.some(a => a.includes('chip')))
    assert.equal(p.llamadas.filter(l => l.tipo === 'batchUpdate').length, 2)
  })
  test('real: si falla la subida del comprobante, no se escribe nada', async () => {
    const h = hojaInicial(), antes = structuredClone(h)
    const d = puenteDeJuguete({ fallarSubida: new Error('El puente rechazó subirArchivo: x') }), p = planillaDeJuguete(h, { drive: d })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(!r.ok)
    assert.equal(r.etapa, 'comprobante')
    assert.equal(escrituras(p).length, 0)
    assert.deepEqual(h, antes)
  })
  test('real: inserción rechazada (403) → nada escrito y el comprobante subido va a la papelera', async () => {
    const h = hojaInicial(), antes = structuredClone(h)
    const d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d, fallarBatch: Object.assign(new Error('The caller does not have permission'), { code: 403 }) })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(!r.ok)
    assert.equal(r.escribio, false)
    assert.equal(r.comprobanteId, null)
    assert.ok([...d.archivos.values()].every(a => a.papelera))
    assert.deepEqual(h, antes)
  })
  test('real: valores rechazados → el lote entero no se aplica (no queda ninguna fila vacía) y el comprobante va a la papelera', async () => {
    const h = hojaInicial(), antes = structuredClone(h)
    const d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d, rechazarValores: true })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(!r.ok)
    assert.equal(r.escribio, false, r.motivo)
    assert.ok(r.motivo.includes('no se escribió nada'))
    assert.deepEqual(h, antes)
    assert.ok([...d.archivos.values()].every(a => a.papelera))
  })
  test('real: sin respuesta de Google (503) → escribió = sí (no se sabe si se aplicó) y el aviso dice que es todo o nada', async () => {
    const d = puenteDeJuguete(), p = planillaDeJuguete(hojaInicial(), { drive: d, fallarBatch: Object.assign(new Error('Service Unavailable'), { code: 503 }) })
    const r = await cargarPagoFinanzas(filaPrueba(), null, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(!r.ok && r.escribio)
    assert.ok(r.motivo.includes('atómico'))
  })
  test('real: otra carga entre la lectura y el lote NO se pisa: queda entera en la 3 y la verificación avisa', async () => {
    const h = hojaInicial(), d = puenteDeJuguete()
    const p = planillaDeJuguete(h, { drive: d, antesDeLote: (hh) => meterFila(hh) })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(!r.ok)
    assert.equal(r.etapa, 'verificacion')
    assert.ok(r.motivo.includes('bajó a la 3'))
    assert.deepEqual(h.filas[2], FILA_AYLU, 'el pago de la otra carga quedó intacto')
    assert.deepEqual([h.filas[1][2], h.filas[1][3], h.filas[1][4]], ['PRUEBA BOT - borrar', '54 9 11 3000-9999', 1100])
  })
  test('real: si la fila 2 releída es de OTRA carga, la verificación no muestra sus datos (solo letras de columnas)', async () => {
    const h = hojaInicial(), d = puenteDeJuguete()
    const p = planillaDeJuguete(h, { drive: d, despuesDeLote: (hh) => { hh.filas[1] = [...FILA_AYLU] } })
    const r = await cargarPagoFinanzas(filaPrueba(), null, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(!r.ok)
    const texto = JSON.stringify([r.motivo, r.verificacion])
    for (const dato of ['Cliente Real', '5555', '7777', 'Gero']) assert.ok(!texto.includes(dato), `no debería mostrar "${dato}": ${texto}`)
    assert.ok(r.verificacion.controles.find(c => c.que === 'Resto de los valores (B, D–L, N, O, R)').detalle.match(/distintos en [A-R](, [A-R])*$/))
  })
  test('dos cargas simultáneas van en cola y quedan las dos', async () => {
    const h = hojaInicial(), d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d })
    const otra = MENSAJE.replace('PRUEBA BOT - borrar', 'PRUEBA BOT - otra').replace('3000-9999', '3000-8888')
    const [r1, r2] = await Promise.all([
      cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } }),
      cargarPagoFinanzas(filaPrueba({}, otra), COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } }),
    ])
    assert.ok(r1.ok && r2.ok, `${r1.motivo} ${r2.motivo}`)
    assert.deepEqual([h.filas[1][2], h.filas[2][2]], ['PRUEBA BOT - otra', 'PRUEBA BOT - borrar'])
  })
  test('modo inválido', async () => {
    const r = await cargarPagoFinanzas(filaPrueba(), null, { modo: 'prueba' })
    assert.ok(!r.ok && r.motivo.includes('Modo inválido'))
  })
})

describe('limpieza de pruebas (finanzasLimpiar.ts)', () => {
  /** Carga real del pago de prueba en una planilla de juguete; devuelve todo lo necesario para limpiar. */
  async function conPrueba(opcionesPlanilla = {}) {
    const h = hojaInicial(), antes = structuredClone(h)
    const d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d, ...opcionesPlanilla })
    const fila = filaPrueba()
    const r = await cargarPagoFinanzas(fila, COMPROBANTE, { modo: 'real', deps: { planilla: () => p, puente: () => d } })
    assert.ok(r.ok, r.motivo)
    const deps = { planilla: () => p, puente: () => d }
    const limpiar = (extra = {}) => limpiarPagoPrueba({ comprobanteId: r.comprobanteId, nombreArchivo: r.nombreArchivo, serial: fila.celdas.A, deps, ...extra })
    return { h, antes, d, p, r, limpiar }
  }

  test('después de una carga real: borra la fila 2, manda el comprobante a la papelera y la planilla queda igual', async () => {
    const { h, antes, d, r, limpiar } = await conPrueba()
    const l = await limpiar()
    assert.ok(l.ok, l.motivo)
    assert.equal(l.filaBorrada, 2)
    assert.ok(l.comprobanteEnPapelera)
    assert.equal(d.archivos.get(r.comprobanteId).papelera, true)
    assert.deepEqual(h.filas, antes.filas)
    assert.deepEqual(h.validaciones, antes.validaciones)
    assert.equal(h.filasHoja, antes.filasHoja)
  })
  test('si alguien cargó un pago después de la prueba, borra la de prueba en su fila real (la 3) y no toca el otro', async () => {
    const { h, antes, limpiar } = await conPrueba()
    meterFila(h)   // el pago de Aylu entra en la 2; la prueba baja a la 3
    const l = await limpiar()
    assert.ok(l.ok, l.motivo)
    assert.equal(l.filaBorrada, 3)
    assert.deepEqual(h.filas[1], FILA_AYLU)
    assert.deepEqual(h.filas.slice(2).map(f => f[2]), antes.filas.slice(1).map(f => f[2]))
  })
  test('carrera: si un pago entra en la fila 2 entre la relectura y el borrado, avisa en mayúsculas que se borró otra fila', async () => {
    const { h, d, limpiar } = await conPrueba()
    const p2 = planillaDeJuguete(h, { antesDeBorrar: (hh) => meterFila(hh) })
    const l = await limpiar({ deps: { planilla: () => p2, puente: () => d } })
    assert.ok(!l.ok)
    assert.match(l.motivo, /SE BORRÓ UNA FILA QUE NO ERA LA PRUEBA \(.+\): la de prueba sigue en la fila 2\. Restaurar desde Archivo → Historial de versiones/)
    assert.equal(h.filas[1][2], 'PRUEBA BOT - borrar', 'se borró el pago de Aylu (lo que el aviso tiene que detectar)')
  })
  test('si un pago entra justo DESPUÉS del borrado, no es una falsa alarma', async () => {
    const { h, d, limpiar } = await conPrueba()
    const p2 = planillaDeJuguete(h, { despuesDeBorrar: (hh) => meterFila(hh) })
    const l = await limpiar({ deps: { planilla: () => p2, puente: () => d } })
    assert.ok(l.ok, l.motivo)
    assert.match(l.controles[0].detalle, /justo después/)
    assert.deepEqual(h.filas[1], FILA_AYLU)
  })
  test('una fila "PRUEBA BOT" que no coincide en toda la huella no se borra, pero el comprobante va igual a la papelera', async () => {
    const { h, d, r, limpiar } = await conPrueba()
    h.filas[1][3] = '54 9 11 4000-0000'   // otro teléfono
    const antes = structuredClone(h)
    const l = await limpiar()
    assert.ok(!l.ok && l.noEstaba && l.filaBorrada === null)
    assert.match(l.motivo, /no coincide en D/)
    assert.deepEqual(h, antes)
    assert.equal(d.archivos.get(r.comprobanteId).papelera, true)
  })
  test('sin ninguna fila de prueba (no se llegó a escribir): ok, no borra nada', async () => {
    const h = hojaInicial(), antes = structuredClone(h), p = planillaDeJuguete(h)
    const l = await limpiarPagoPrueba({ serial: S, deps: { planilla: () => p, puente: () => puenteDeJuguete() } })
    assert.ok(l.ok && l.noEstaba && l.filaBorrada === null, l.motivo)
    assert.equal(escrituras(p).length, 0)
    assert.deepEqual(h, antes)
  })
  test('dos filas de prueba iguales: no borra ninguna', async () => {
    const { h, limpiar } = await conPrueba()
    meterFila(h, h.filas[1], 4)
    const antes = structuredClone(h)
    const l = await limpiar()
    assert.ok(!l.ok && l.filaBorrada === null)
    assert.match(l.motivo, /filas 2, 4/)
    assert.deepEqual(h, antes)
  })
  test('sin el serial de la fecha no toca la planilla (el comprobante sí va a la papelera)', async () => {
    const { h, d, r, p, limpiar } = await conPrueba()
    const antes = structuredClone(h), n = escrituras(p).length
    const l = await limpiar({ serial: undefined })
    assert.ok(!l.ok && l.motivo.includes('serial'))
    assert.equal(escrituras(p).length, n)
    assert.deepEqual(h, antes)
    assert.equal(d.archivos.get(r.comprobanteId).papelera, true)
  })
  test('controles puros y entorno', () => {
    const prueba = [S, '', 'PRUEBA BOT - x', HUELLA_PRUEBA.telefono, HUELLA_PRUEBA.usd, '', 'Marcos', '', 'PRUEBA BOT - x - PP 1/3.png']
    assert.deepEqual(diferenciasConPrueba(prueba, S), [])
    assert.deepEqual(diferenciasConPrueba(prueba, S - 1), ['A'])
    assert.deepEqual(diferenciasConPrueba([S, '', 'Ana Inventada', '54 9 11 4000-0002', 2600, '', 'Gero', 'Mai', 'Ana - PIF.jpeg'], S), ['C', 'D', 'E', 'G', 'I'])
    assert.deepEqual(filasDePrueba([[S, '', 'Ana'], prueba, [S, '', 'Beto']], S), [3])
    const abajo = [S - 1, '', 'Ana']
    assert.ok(controlarBorrado(2, abajo, [abajo, [S - 2, '', 'Beto']], S, 'h').ok)
    assert.match(controlarBorrado(2, abajo, [prueba, abajo], S, '24/10/2026, 15:00:00').detalle, /^SE BORRÓ UNA FILA QUE NO ERA LA PRUEBA \(24\/10\/2026, 15:00:00\)/)
    assert.match(controlarBorrado(2, abajo, [[S, '', 'Otro'], [S, '', 'Otro más']], S, 'h').detalle, /^NO SE PUEDE CONFIRMAR/)
    assert.ok(entornoProhibido({ VERCEL: '1' }) && entornoProhibido({ NODE_ENV: 'production' }) && !entornoProhibido({}))
  })
  test('en Vercel no corre', async () => {
    process.env.VERCEL = '1'
    try {
      const l = await limpiarPagoPrueba({ serial: S, deps: { planilla: () => { throw new Error('no debería leer') } } })
      assert.ok(!l.ok && l.motivo.includes('Vercel'))
    } finally { delete process.env.VERCEL }
  })
  test('comprobante solo: únicamente si es de una prueba', async () => {
    const d = puenteDeJuguete()
    const { id } = await d.subirArchivo({ carpetaId: CARPETA_COMPROBANTES, nombre: 'Cliente Real - PIF.jpeg', mimeType: 'image/jpeg', base64: 'eA==' })
    const r = await comprobantePruebaAPapelera(id, 'Cliente Real - PIF.jpeg', { puente: () => d })
    assert.ok(!r.ok)
    assert.equal(d.archivos.get(id).papelera, false)
    const { id: id2 } = await d.subirArchivo({ carpetaId: CARPETA_COMPROBANTES, nombre: 'PRUEBA BOT - borrar - PP 1/3.png', mimeType: 'image/png', base64: 'eA==' })
    assert.ok((await comprobantePruebaAPapelera(id2, 'PRUEBA BOT - borrar - PP 1/3.png', { puente: () => d })).ok)
    assert.equal(d.archivos.get(id2).papelera, true)
  })
})

describe('lista desplegable de R (Empresa)', () => {
  test('listaConOpcion: Empresa después de Gero, sin quitar ninguna; si ya está, no cambia', () => {
    assert.deepEqual(listaConOpcion(['Tomi', 'Gero', 'Relay', 'Financiera', 'Otra'], OPCION_EMPRESA), { lista: ['Tomi', 'Gero', 'Empresa', 'Relay', 'Financiera', 'Otra'], cambia: true })
    assert.deepEqual(listaConOpcion(['Relay', 'Otra'], OPCION_EMPRESA).lista, ['Relay', 'Otra', 'Empresa'])
    assert.equal(listaConOpcion(['Tomi', 'Empresa'], OPCION_EMPRESA).cambia, false)
  })
  test('resumenReglas y pedidoValidacionLista mantienen strict y showCustomUi; aplicado, toda la columna queda con la lista nueva', async () => {
    const h = hojaInicial(), p = planillaDeJuguete(h)
    const r = resumenReglas(await p.validacionesDeColumna('R'))
    assert.deepEqual([r.total, r.conEsa, r.distintas, r.sinRegla], [5, 5, 1, 0])
    const { lista: nueva } = listaConOpcion(r.regla.lista, OPCION_EMPRESA)
    const pedido = pedidoValidacionLista(SHEET_ID, 17, r.regla, nueva)
    assert.deepEqual(pedido.setDataValidation.range, { sheetId: SHEET_ID, startRowIndex: 1, startColumnIndex: 17, endColumnIndex: 18 })
    assert.deepEqual([pedido.setDataValidation.rule.strict, pedido.setDataValidation.rule.showCustomUi], [true, true])
    assert.ok(!('inputMessage' in pedido.setDataValidation.rule))
    await p.batchUpdate([pedido])
    const despues = resumenReglas(await p.validacionesDeColumna('R'))
    assert.deepEqual(despues.regla.lista, ['Tomi', 'Gero', 'Empresa', 'Relay', 'Financiera', 'Otra'])
    assert.equal(despues.conEsa, 5)
    // Con Empresa en la lista, una carga con cuenta Empresa ya pasa
    const c = armarCarga(filaPrueba({ cuenta: 'Empresa' }), await lecturaDe(p))
    assert.ok(c.ok, c.errores.join(' '))
  })
})

describe('reintentos del puente al subir el comprobante (puenteDriveReal con un Apps Script de juguete detrás del fetch)', () => {
  const T0 = Date.parse('2026-10-24T15:00:00.000Z')
  const iso = (ms) => new Date(ms).toISOString()
  const relojDeJuguete = () => { const r = { t: T0, ahora: () => r.t, avanzar: (ms) => { r.t += ms }, esperar: async (ms) => { r.t += ms } }; return r }
  /** Imita subirArchivo y aPapelera de Codigo.gs (busca por nombre en la carpeta, fuera de la papelera). Fallas de una
   *  vez por acción: '500' (no corre), '500-despues' (corre y responde 500), 'timeout' (corre y no responde: 90 s),
   *  'rechazo' ({ ok: false }); `tarda` = cuánto dura ese pedido (por defecto 1 s). `latencia`: lo recién subido no
   *  aparece en la búsqueda por nombre hasta pasados esos ms (como la demora de las búsquedas de Drive). */
  function appsScriptDeJuguete(reloj, fallas = [], { latencia = 0 } = {}) {
    const archivos = new Map(), pedidos = []
    let n = 0
    const correr = (p) => {
      if (p.accion === 'subirArchivo') {
        for (const [id, a] of archivos) if (a.carpetaId === p.carpetaId && a.nombre === p.nombre && !a.papelera && reloj.ahora() >= a.creado + latencia) return { ok: true, id, url: `https://drive.google.com/file/d/${id}/view?usp=drivesdk`, yaExistia: true }
        const id = `SUBIDO${++n}${'x'.repeat(26)}`
        archivos.set(id, { nombre: p.nombre, mimeType: p.mimeType, carpetaId: p.carpetaId, bytes: bytesDeBase64(p.base64), papelera: false, creado: reloj.ahora() })
        return { ok: true, id, url: `https://drive.google.com/file/d/${id}/view?usp=drivesdk`, yaExistia: false }
      }
      if (p.accion === 'aPapelera') {
        const a = archivos.get(p.id)
        if (!a) return { ok: false, error: 'No item with the given ID could be found.' }
        if (a.carpetaId !== CARPETA_COMPROBANTES) return { ok: false, error: 'solo se mandan a la papelera archivos de "Subidos" o de una carpeta "PRUEBA BOT…"' }
        a.papelera = true
        return { ok: true }
      }
      return { ok: false, error: `acción desconocida: ${p.accion}` }
    }
    async function fetchDeJuguete(_url, init) {
      const p = JSON.parse(init.body)
      pedidos.push(p.accion)
      const i = fallas.findIndex((f) => f.accion === p.accion)
      const f = i >= 0 ? fallas.splice(i, 1)[0] : null
      reloj.avanzar(f?.tarda ?? (f?.tipo === 'timeout' ? 90_000 : 1_000))
      if (f?.tipo === '500') return new Response('<html>Error 500</html>', { status: 500 })
      if (f?.tipo === 'rechazo') return new Response(JSON.stringify({ ok: false, error: 'Access denied' }), { status: 200 })
      const respuesta = correr(p)
      if (f?.tipo === '500-despues') return new Response('<html>Error 500</html>', { status: 500 })
      if (f?.tipo === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      return new Response(JSON.stringify(respuesta), { status: 200 })
    }
    return { archivos, pedidos, fetch: fetchDeJuguete }
  }
  async function conAppsScript(s, fn) {
    const antes = globalThis.fetch
    process.env.PUENTE_DRIVE_URL = 'https://puente.ejemplo.invalid/exec'
    process.env.PUENTE_DRIVE_SECRETO = 'secreto-de-juguete'
    globalThis.fetch = s.fetch
    try { return await fn() } finally {
      globalThis.fetch = antes
      delete process.env.PUENTE_DRIVE_URL
      delete process.env.PUENTE_DRIVE_SECRETO
    }
  }
  const cargarCon = (s, reloj, planilla) => conAppsScript(s, () => cargarPagoFinanzas(filaPrueba(), COMPROBANTE, {
    modo: 'real', deps: { planilla: () => planilla, puente: () => puenteDriveReal({ ahora: reloj.ahora, esperar: reloj.esperar, azar: () => 0 }) },
  }))
  const vivos = (s) => [...s.archivos.values()].filter((a) => !a.papelera)
  const subidas = (s) => s.pedidos.filter((x) => x === 'subirArchivo').length
  const filasDePruebaEn = (h) => h.filas.filter((f) => f[2] === 'PRUEBA BOT - borrar').length

  test('se subió y el puente respondió 500: el reintento lo encuentra; un solo archivo, una sola fila y el aviso de siempre ("revisar que sea el mismo")', async () => {
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: '500-despues' }])
    const h = hojaInicial(), p = planillaDeJuguete(h, { drive: s })
    const r = await cargarCon(s, reloj, p)
    assert.ok(r.ok, r.motivo)
    assert.equal(subidas(s), 2)
    assert.equal(vivos(s).length, 1, 'no se subió dos veces')
    assert.equal(r.comprobanteYaExistia, true)
    assert.equal(r.comprobanteId, [...s.archivos.keys()][0])
    // Sin prueba de que sea el del bot (puede ser uno anterior con el mismo nombre), no se afirma: se pide revisar
    assert.ok(r.avisos.some((a) => a.includes('Revisar que sea el mismo comprobante') && a.includes('puede ser el que subió ese intento o uno anterior')), r.avisos.join(' | '))
    assert.ok(!r.avisos.some((a) => a.includes('casi seguro')))
    assert.equal(escrituras(p).length, 1)
    assert.equal(filasDePruebaEn(h), 1, 'una sola fila')
    assert.deepEqual(h.chips[1], [urlArchivoDrive(r.comprobanteId)])
    assert.equal(r.noReintentarAntesDe, null)
  })

  test('500 antes de subir: el reintento lo sube; un archivo y una fila, con el aviso de que PUEDE haber quedado dos veces (no se sabe en qué tramo fue el 500)', async () => {
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: '500' }])
    const h = hojaInicial(), p = planillaDeJuguete(h, { drive: s })
    const r = await cargarCon(s, reloj, p)
    assert.ok(r.ok, r.motivo)
    assert.equal(subidas(s), 2)
    assert.equal(vivos(s).length, 1)
    assert.equal(r.comprobanteYaExistia, false)
    assert.ok(r.avisos.some((a) => a.includes('puede haber quedado dos veces en Subidos') && a.includes(r.comprobanteUrl)), r.avisos.join(' | '))
    assert.equal(filasDePruebaEn(h), 1)
    // Sin 500, ningún aviso sobre Subidos
    const reloj2 = relojDeJuguete(), s2 = appsScriptDeJuguete(reloj2)
    const r2 = await cargarCon(s2, reloj2, planillaDeJuguete(hojaInicial(), { drive: s2 }))
    assert.ok(r2.ok, r2.motivo)
    assert.ok(!r2.avisos.some((a) => a.includes('Subidos')), r2.avisos.join(' | '))
  })

  test('corte por tiempo al subir (90 s): no se reintenta (no se sube dos veces en paralelo), no se escribe nada y queda noReintentarAntesDe', async () => {
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: 'timeout' }])
    const h = hojaInicial(), antes = structuredClone(h), p = planillaDeJuguete(h, { drive: s })
    const r = await cargarCon(s, reloj, p)
    assert.ok(!r.ok)
    assert.equal(r.etapa, 'comprobante')
    assert.ok(r.motivo.includes('Puede haber quedado subido'), r.motivo)
    assert.equal(subidas(s), 1)
    assert.equal(escrituras(p).length, 0)
    assert.deepEqual(h, antes)
    assert.equal(r.noReintentarAntesDe, iso(T0 + 90_000 + MAXIMO_APPS_SCRIPT_MS))
    // Repetida después de esa hora: encuentra el archivo que subió el intento cortado (no lo duplica) y carga UNA fila
    reloj.avanzar(7 * 60_000)
    const r2 = await cargarCon(s, reloj, p)
    assert.ok(r2.ok, r2.motivo)
    assert.equal(vivos(s).length, 1)
    assert.equal(r2.comprobanteYaExistia, true)
    assert.ok(r2.avisos.some((a) => a.includes('Ya había un archivo')))
    assert.equal(filasDePruebaEn(h), 1)
  })

  test('se subió + 500, y después Google rechaza la fila (403): el comprobante NO va a la papelera (sin prueba de que sea del bot) y se avisa que quedó en Subidos', async () => {
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: '500-despues' }])
    const h = hojaInicial(), antes = structuredClone(h)
    const p = planillaDeJuguete(h, { drive: s, fallarBatch: Object.assign(new Error('The caller does not have permission'), { code: 403 }) })
    const r = await cargarCon(s, reloj, p)
    assert.ok(!r.ok)
    assert.equal(r.escribio, false)
    assert.deepEqual(h, antes)
    assert.equal(vivos(s).length, 1)
    assert.ok(!s.pedidos.includes('aPapelera'))
    assert.ok(r.motivo.includes('quedó en Subidos') && r.motivo.includes('Si ninguna otra fila del Registro lo usa'), r.motivo)
    assert.ok(!r.motivo.includes('casi seguro'), r.motivo)
    assert.equal(r.comprobanteId, [...s.archivos.keys()][0])
  })

  test('comprobante HOMÓNIMO de otro pago + 500 antes de correr: el reintento lo encuentra y NO se afirma que sea del bot', async () => {
    // En Subidos ya hay un archivo con el mismo nombre (otro pago, de hace un mes). El 500 llega sin que corra el script
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: '500' }])
    const nombre = 'PRUEBA BOT - borrar - PP 1/3.png'
    s.archivos.set('VIEJOdeOtroPago' + 'x'.repeat(20), { nombre, mimeType: 'image/png', carpetaId: CARPETA_COMPROBANTES, bytes: 10, papelera: false, creado: T0 - 30 * 86_400_000 })
    const h = hojaInicial(), p = planillaDeJuguete(h, { drive: s })
    const r = await cargarCon(s, reloj, p)
    assert.equal(r.nombreArchivo, nombre)
    assert.equal(r.comprobanteYaExistia, true)
    assert.ok(r.comprobanteId.startsWith('VIEJOdeOtroPago'))
    assert.ok(r.avisos.some((a) => a.includes('Revisar que sea el mismo comprobante')), r.avisos.join(' | '))
    assert.ok(!r.avisos.some((a) => a.includes('casi seguro')), r.avisos.join(' | '))
    // Y si Google rechaza la fila, el motivo no empuja a borrar un comprobante que usa otra fila
    const reloj2 = relojDeJuguete(), s2 = appsScriptDeJuguete(reloj2, [{ accion: 'subirArchivo', tipo: '500' }])
    s2.archivos.set('VIEJOdeOtroPago' + 'x'.repeat(20), { nombre, mimeType: 'image/png', carpetaId: CARPETA_COMPROBANTES, bytes: 10, papelera: false, creado: T0 - 30 * 86_400_000 })
    const r2 = await cargarCon(s2, reloj2, planillaDeJuguete(hojaInicial(), { drive: s2, fallarBatch: Object.assign(new Error('The caller does not have permission'), { code: 403 }) }))
    assert.ok(!r2.ok)
    assert.ok(!s2.pedidos.includes('aPapelera'), 'no se manda a la papelera')
    assert.ok(r2.motivo.includes('si lo usa otra, dejarlo'), r2.motivo)
  })

  test('el reintento sube un SEGUNDO comprobante (la búsqueda de Drive todavía no veía el primero): avisa; si se rechaza la fila, no dice que no quedó nada', async () => {
    // El primer intento sube y responde 500; a los 3 s la búsqueda por nombre todavía no lo ve (latencia de 10 s)
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: '500-despues' }], { latencia: 10_000 })
    const r = await cargarCon(s, reloj, planillaDeJuguete(hojaInicial(), { drive: s }))
    assert.ok(r.ok, r.motivo)
    assert.equal(vivos(s).length, 2, 'quedaron dos (el riesgo que se avisa)')
    assert.ok(r.avisos.some((a) => a.includes('puede haber quedado dos veces en Subidos')), r.avisos.join(' | '))

    const reloj2 = relojDeJuguete(), s2 = appsScriptDeJuguete(reloj2, [{ accion: 'subirArchivo', tipo: '500-despues' }], { latencia: 10_000 })
    const r2 = await cargarCon(s2, reloj2, planillaDeJuguete(hojaInicial(), { drive: s2, fallarBatch: Object.assign(new Error('The caller does not have permission'), { code: 403 }) }))
    assert.ok(!r2.ok)
    assert.equal(r2.comprobanteId, null, 'el que subió el reintento va a la papelera')
    assert.equal(vivos(s2).length, 1, 'el del primer intento sigue en Subidos')
    assert.ok(r2.motivo.includes('se mandó a la papelera') && r2.motivo.includes('Puede haber quedado otra copia'), r2.motivo)
  })

  test('un 500 lento (más de 25 s) al subir: no se reintenta y queda noReintentarAntesDe (el Apps Script puede seguir subiendo)', async () => {
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: '500', tarda: 30_000 }])
    const h = hojaInicial(), antes = structuredClone(h), p = planillaDeJuguete(h, { drive: s })
    const r = await cargarCon(s, reloj, p)
    assert.ok(!r.ok)
    assert.equal(subidas(s), 1)
    assert.ok(r.motivo.includes('Puede haber quedado subido'), r.motivo)
    assert.equal(r.noReintentarAntesDe, iso(T0 + 30_000 + MAXIMO_APPS_SCRIPT_MS))
    assert.deepEqual(h, antes)
    // Un 500 rápido que se agota en los 3 intentos no lo fija
    const reloj2 = relojDeJuguete(), s2 = appsScriptDeJuguete(reloj2, [1, 2, 3].map(() => ({ accion: 'subirArchivo', tipo: '500' })))
    const r2 = await cargarCon(s2, reloj2, planillaDeJuguete(hojaInicial(), { drive: s2 }))
    assert.ok(!r2.ok)
    assert.equal(subidas(s2), 3)
    assert.equal(r2.noReintentarAntesDe, null)
  })

  test('fila rechazada con un comprobante recién subido: aPapelera con un 500 pasajero se reintenta y el archivo queda en la papelera', async () => {
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'aPapelera', tipo: '500' }])
    const h = hojaInicial(), p = planillaDeJuguete(h, { drive: s, fallarBatch: Object.assign(new Error('The caller does not have permission'), { code: 403 }) })
    const r = await cargarCon(s, reloj, p)
    assert.ok(!r.ok)
    assert.equal(s.pedidos.filter((x) => x === 'aPapelera').length, 2)
    assert.deepEqual(vivos(s), [], 'el comprobante no quedó huérfano')
    assert.equal(r.comprobanteId, null)
    assert.ok(r.motivo.includes('se mandó a la papelera'), r.motivo)
  })

  test('un rechazo del puente al subir ({ ok: false }) no se reintenta: un pedido y no se escribe nada', async () => {
    const reloj = relojDeJuguete(), s = appsScriptDeJuguete(reloj, [{ accion: 'subirArchivo', tipo: 'rechazo' }])
    const h = hojaInicial(), p = planillaDeJuguete(h, { drive: s })
    const r = await cargarCon(s, reloj, p)
    assert.ok(!r.ok)
    assert.equal(r.etapa, 'comprobante')
    assert.equal(subidas(s), 1)
    assert.ok(!r.motivo.includes('Puede haber quedado subido'), r.motivo)
    assert.equal(r.noReintentarAntesDe, null)
    assert.equal(escrituras(p).length, 0)
  })
})

// Revisión del 24/10 (ronda 2): el nombre del comprobante es determinístico ("<Nombre> - Fee", "<Nombre> - PIF") y el puente
// devuelve el archivo que ya está con ese nombre. En el PRIMER intento de un pago, ese archivo es de otro pago (una seña
// anterior u otro cliente con el mismo nombre): se sube como "<nombre> (2)" y el chip apunta al nuevo.
describe('archivo de otro pago con el mismo nombre (archivoNuevo)', () => {
  test('nombreConSufijo', () => {
    assert.equal(nombreConSufijo('Ana Pérez - PIF.jpeg', 2), 'Ana Pérez - PIF (2).jpeg')
    assert.equal(nombreConSufijo('Ana Pérez - PP 1/3.png', 3), 'Ana Pérez - PP 1/3 (3).png')
    assert.equal(nombreConSufijo('sin extension', 2), 'sin extension (2)')
  })
  test('primer intento con un archivo ajeno con ese nombre: sube "(2)", el chip es del nuevo y queda el aviso; sin archivoNuevo, usa el que estaba', async () => {
    const h = hojaInicial(), d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d })
    const viejo = await d.subirArchivo({ carpetaId: CARPETA_COMPROBANTES, nombre: 'PRUEBA BOT - borrar - PP 1/3.png', mimeType: 'image/png', base64: COMPROBANTE.base64 })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', archivoNuevo: true, deps: { planilla: () => p, puente: () => d } })
    assert.ok(r.ok, r.motivo)
    assert.notEqual(r.comprobanteId, viejo.id)
    assert.equal(d.archivos.get(r.comprobanteId).nombre, 'PRUEBA BOT - borrar - PP 1/3 (2).png')
    assert.equal(r.nombreArchivo, 'PRUEBA BOT - borrar - PP 1/3 (2).png')
    assert.equal(r.comprobanteYaExistia, false)
    assert.deepEqual(h.chips[1], [urlArchivoDrive(r.comprobanteId)])
    assert.ok(r.avisos.some((x) => /de otro pago/.test(x) && /\(2\)\.png/.test(x)), JSON.stringify(r.avisos))
    // Un reintento con el nombre que eligió el primero encuentra ESE archivo (no el de otro pago)
    const h2 = hojaInicial(), p2 = planillaDeJuguete(h2, { drive: d })
    const r2 = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', nombreArchivo: r.nombreArchivo, deps: { planilla: () => p2, puente: () => d } })
    assert.equal(r2.comprobanteId, r.comprobanteId); assert.equal(r2.comprobanteYaExistia, true)
    // Sin archivoNuevo (un reintento sin nombre guardado): el de siempre, con su aviso
    const h3 = hojaInicial(), p3 = planillaDeJuguete(h3, { drive: d })
    const r3 = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', deps: { planilla: () => p3, puente: () => d } })
    assert.equal(r3.comprobanteId, viejo.id)
    assert.ok(r3.avisos.some((x) => /Revisar que sea el mismo comprobante/.test(x)))
  })
  test('con los cinco nombres ocupados no carga nada (a mano)', async () => {
    const h = hojaInicial(), d = puenteDeJuguete(), p = planillaDeJuguete(h, { drive: d })
    const base = 'PRUEBA BOT - borrar - PP 1/3.png'
    for (const n of [base, ...[2, 3, 4, 5].map((i) => nombreConSufijo(base, i))]) await d.subirArchivo({ carpetaId: CARPETA_COMPROBANTES, nombre: n, mimeType: 'image/png', base64: COMPROBANTE.base64 })
    const r = await cargarPagoFinanzas(filaPrueba(), COMPROBANTE, { modo: 'real', archivoNuevo: true, deps: { planilla: () => p, puente: () => d } })
    assert.ok(!r.ok); assert.equal(r.etapa, 'control'); assert.equal(r.escribio, false)
    assert.match(r.motivo, /subí el comprobante a mano/)
    assert.equal(escrituras(p).length, 0)
  })
})
