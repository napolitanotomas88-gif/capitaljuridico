// cd <APP_DIR> && set -a && source .env.local && set +a && \
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-finanzas-prueba-real.mjs --simular
//
// Prueba del paso "Finanzas" del bot C.J. contra "SKWD | Finanzas 2026" → "Registro de Pagos" con un #ALTA INVENTADO
// ("PRUEBA BOT - borrar", +54 9 11 3000-9999, Marcos, PP 3300 USD, este pago 1100 USD · Transferencia USD (Galicia)),
// cuenta Tomi, setter Mai, fuente Inbound IG y un comprobante PNG chiquito generado acá.
//   --simular  SOLO LECTURA (scope readonly, sin subir nada): imprime la fila y los pedidos exactos que mandaría, con
//              los controles hechos contra la planilla real (encabezados, listas desplegables, repetidos, fórmula de M).
//   --real     sube el comprobante por el Puente Drive, carga la fila 2 (un solo batchUpdate atómico: inserción +
//              valores + chip), verifica y SIEMPRE (en un finally, aunque falle algo o se escape una excepción) llama a
//              limpiarPagoPrueba(): busca la fila de prueba en las filas 2–10 por su huella completa (C, A, D, E, G, I),
//              la borra y manda el comprobante a la papelera aunque la fila no se haya podido borrar. Ctrl+C o SIGTERM
//              no cortan en seco: se termina el paso en curso, se limpia y se sale (la segunda señal sí corta, sin
//              limpiar). Después compara un hash de las filas 2–5 (y la cantidad de filas de la hoja) de antes y de
//              después: tienen que ser iguales. No imprime datos de la planilla.
//              COORDINAR CON AYLU: que nadie cargue pagos durante el minuto que dura (Sheets no tiene compare-and-set:
//              la limpieza verifica por contenido pero borra por posición).
// Solo imprime datos de la fila de prueba.
import { createHash } from 'node:crypto'
import { deflateSync, crc32 } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(raiz)
const modo = process.argv.includes('--real') ? 'real' : process.argv.includes('--simular') ? 'simulacion' : null
if (!modo || (process.argv.includes('--real') && process.argv.includes('--simular'))) {
  console.error('Uso: … scripts/bot-finanzas-prueba-real.mjs --simular   (solo lectura)\n     … scripts/bot-finanzas-prueba-real.mjs --real      (carga y borra al final)')
  process.exit(2)
}
if (modo === 'real' && (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production')) {
  console.error('La prueba real no corre en Vercel ni con NODE_ENV=production.')
  process.exit(2)
}
if (!process.env.SHEET_ID_FINANZAS) {
  const { default: nextEnv } = await import('@next/env')
  nextEnv.loadEnvConfig(raiz, true, { info: () => {}, error: () => {} })
}

const { parsearAlta } = await import('../lib/bot/alta/parsear.ts')
const { filaRegistroPagos, COLUMNAS_REGISTRO } = await import('../lib/bot/alta/finanzas.ts')
const { cargarPagoFinanzas, planillaFinanzasReal } = await import('../lib/bot/alta/finanzasEscribir.ts')
const { limpiarPagoPrueba, HUELLA_PRUEBA, PREFIJO_PRUEBA, FILA_MAXIMA } = await import('../lib/bot/alta/finanzasLimpiar.ts')
const { hoyArgentina, sumarMeses, serialAYmd } = await import('../lib/clientes/fechas.ts')

const hoy = hoyArgentina()
const ddmmaaaa = (ymd) => ymd.split('-').reverse().join('/')
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
Inicio del servicio: ${ddmmaaaa(hoy)}
Cuotas:
${ddmmaaaa(sumarMeses(hoy, 1))} 1100
${ddmmaaaa(sumarMeses(hoy, 2))} 1100`

const alta = parsearAlta(MENSAJE)
if (!(alta.nombre ?? '').startsWith(PREFIJO_PRUEBA)) {
  console.error(`El parser leyó el nombre "${alta.nombre}": no empieza con "${PREFIJO_PRUEBA}", así que la limpieza no podría borrarlo. No se sigue.`)
  process.exit(1)
}
const fila = filaRegistroPagos(alta, { fecha: hoy, setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Tomi' })
// La limpieza reconoce la fila solo por su huella completa: si el #ALTA inventado no la arma igual, no podría borrarla
const huellaDistinta = [
  fila.celdas.D !== HUELLA_PRUEBA.telefono && `D "${fila.celdas.D}" (la limpieza espera "${HUELLA_PRUEBA.telefono}")`,
  fila.celdas.E !== HUELLA_PRUEBA.usd && `E ${fila.celdas.E} (espera ${HUELLA_PRUEBA.usd})`,
  fila.celdas.G !== HUELLA_PRUEBA.closer && `G "${fila.celdas.G}" (espera "${HUELLA_PRUEBA.closer}")`,
  !String(fila.celdas.I ?? '').startsWith(PREFIJO_PRUEBA) && `I "${fila.celdas.I}" (tiene que empezar con "${PREFIJO_PRUEBA}")`,
  typeof fila.celdas.A !== 'number' && 'A no es un serial',
].filter(Boolean)
if (huellaDistinta.length) {
  console.error(`La fila de prueba no tiene la huella que reconoce la limpieza: ${huellaDistinta.join('; ')}. No se sigue.`)
  process.exit(1)
}

// ── Comprobante: PNG de 24×24 generado acá (dos franjas), ~100 bytes ──
function pngChiquito() {
  const ancho = 24, alto = 24
  const crudo = Buffer.alloc((ancho * 3 + 1) * alto)
  for (let y = 0; y < alto; y++) {
    crudo[y * (ancho * 3 + 1)] = 0   // filtro "ninguno"
    for (let x = 0; x < ancho; x++) {
      const o = y * (ancho * 3 + 1) + 1 + x * 3
      const oro = y < alto / 2
      crudo[o] = oro ? 0xb8 : 0x1a; crudo[o + 1] = oro ? 0x96 : 0x1a; crudo[o + 2] = oro ? 0x5a : 0x1a
    }
  }
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length)
    const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([largo, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))])
}
const png = pngChiquito()
const comprobante = { nombre: 'comprobante-prueba.png', mimeType: 'image/png', base64: png.toString('base64') }

// ── Impresión ──
const lista = (xs) => (xs?.length ? xs.map(x => `  - ${x}`).join('\n') : '  (ninguno)')
const valor = (v) => (v === null ? '(no se toca)' : typeof v === 'number' ? (v > 40000 && v < 60000 && Number.isInteger(v) ? `${v} (${ddmmaaaa(serialAYmd(v))})` : String(v)) : JSON.stringify(v))
const letra = (i) => String.fromCharCode(65 + i)

console.log(`Prueba del paso Finanzas · ${modo.toUpperCase()} · ${new Date().toISOString()} · #ALTA inventado: ${alta.nombre} · fecha ${hoy}`)
if (alta.faltantes.length) console.log(`Faltantes del parser:\n${lista(alta.faltantes)}`)
console.log(`\nFila de "Registro de Pagos" (filaRegistroPagos) · fecha ${fila.fechaLegible}:`)
COLUMNAS_REGISTRO.forEach(({ col, titulo }, i) => console.log(`  ${col} ${titulo.padEnd(34)} ${valor(fila.fila[i])}`))
console.log(` pendientes:\n${lista(fila.pendientes)}`)
console.log(` avisos de finanzas.ts:\n${lista(fila.avisos)}`)
console.log(`Comprobante generado: ${comprobante.mimeType}, ${png.length} bytes`)

function describirPedido(p) {
  if (p.insertDimension) { const r = p.insertDimension.range; return `insertDimension ROWS ${r.startIndex + 1} (inheritFromBefore: ${p.insertDimension.inheritFromBefore})` }
  if (p.copyPaste) { const { source: s, destination: d, pasteType } = p.copyPaste; return `copyPaste ${pasteType}: ${letra(s.startColumnIndex)}${s.startRowIndex + 1}:${letra(s.endColumnIndex - 1)}${s.endRowIndex} → ${letra(d.startColumnIndex)}${d.startRowIndex + 1}:${letra(d.endColumnIndex - 1)}${d.endRowIndex}` }
  if (p.updateCells) {
    const st = p.updateCells.start, celdas = p.updateCells.rows[0].values
    if (celdas[0]?.chipRuns) return `updateCells ${letra(st.columnIndex)}${st.rowIndex + 1}: chip → ${celdas[0].chipRuns[0].chip.richLinkProperties.uri}`
    const fin = letra(st.columnIndex + celdas.length - 1)
    const lineas = celdas.map((c, k) => {
      const [tipo, v] = Object.entries(c.userEnteredValue ?? {})[0] ?? ['vacía', '']
      return `      ${letra(st.columnIndex + k)}: ${tipo === 'vacía' ? '(vacía)' : `${tipo} ${valor(v)}`}`
    })
    return `updateCells ${letra(st.columnIndex)}${st.rowIndex + 1}:${fin}${st.rowIndex + 1} (${p.updateCells.fields})\n${lineas.join('\n')}`
  }
  if (p.deleteDimension) return `deleteDimension ROWS ${p.deleteDimension.range.startIndex + 1}`
  return JSON.stringify(p)
}

function imprimirResultado(res) {
  console.log(`\nResultado: etapa ${res.etapa} · ok: ${res.ok ? 'SÍ' : 'NO'} · escribió: ${res.escribio ? 'SÍ' : 'no'}${res.fila ? ` · fila ${res.fila}` : ''}`)
  if (res.motivo) console.log(`Motivo: ${res.motivo}`)
  console.log(`Comprobante: archivo "${res.nombreArchivo ?? '—'}" · ${res.modo === 'real' ? (res.comprobanteId ? `subido (id ${res.comprobanteId}${res.comprobanteYaExistia ? ', ya existía' : ''})` : 'no quedó en Drive') : 'se subiría a DFY - SKWD / Subidos'} · chip en I2: ${res.modo === 'simulacion' && res.chip === 'puesto' ? 'se pondría' : (res.chip ?? '—')}`)
  if (res.controles?.length) console.log(` controles contra la planilla real:\n${lista(res.controles)}`)
  if (res.pedidos) {
    console.log(`\n${res.modo === 'real' ? 'Lote enviado' : 'Lote que se enviaría'}: UN SOLO spreadsheets.batchUpdate (atómico), en este orden:`)
    for (const p of res.pedidos) console.log(`  - ${describirPedido(p)}`)
  }
  console.log(` avisos:\n${lista(res.avisos)}`)
  if (res.verificacion) {
    console.log(`\nVerificación: ${res.verificacion.ok ? 'OK' : 'FALLÓ'}`)
    for (const c of res.verificacion.controles) console.log(`  [${c.ok ? 'ok' : c.informativo ? 'info' : 'MAL'}] ${c.que}: ${c.detalle}`)
  }
}

// Hash de las filas 2–5 (A:AF, con fórmulas) + filas de la hoja: para comparar antes/después sin imprimir datos
async function huella() {
  const p = planillaFinanzasReal('simulacion')
  const [[filas = []], e] = await Promise.all([p.leer(["'Registro de Pagos'!A2:AF5"], 'FORMULA'), p.estructura(2)])
  return { hash: createHash('sha256').update(JSON.stringify(filas)).digest('hex'), filasHoja: e.filasHoja }
}

let res = null
let salida = 0
let antes = null
let interrumpido = null

// Ctrl+C / SIGTERM: con un handler instalado Node no sale solo; el flujo sigue hasta el finally, que limpia. La segunda
// señal corta en seco (sin limpiar).
if (modo === 'real') {
  const alInterrumpir = (senal) => {
    if (interrumpido) {
      console.error(`\n${senal} otra vez: se sale SIN terminar la limpieza. Revisar a mano las filas 2–${FILA_MAXIMA} de "Registro de Pagos" (fila "${PREFIJO_PRUEBA}…") y la carpeta Subidos.`)
      process.exit(1)
    }
    interrumpido = senal
    console.error(`\n${senal}: no se corta en seco. Se termina el paso en curso, se limpia y se sale (${senal} otra vez = salir YA, sin limpiar).`)
  }
  process.on('SIGINT', () => alInterrumpir('SIGINT'))
  process.on('SIGTERM', () => alInterrumpir('SIGTERM'))
}

async function limpiar() {
  console.log(`\nLimpieza (siempre): fila de prueba (filas 2–${FILA_MAXIMA}) + comprobante`)
  if (!res) console.log(' Sin resultado de la carga: se busca la fila de prueba igual. Si llegó a subirse un comprobante, no se sabe su id: revisar Subidos.')
  try {
    const l = await limpiarPagoPrueba({ comprobanteId: res?.comprobanteId ?? null, nombreArchivo: res?.nombreArchivo ?? null, serial: fila.celdas.A })
    console.log(` ok: ${l.ok ? 'SÍ' : 'NO'} · fila borrada: ${l.filaBorrada ?? (l.noEstaba ? 'no había ninguna fila de prueba' : 'ninguna')} · comprobante a la papelera: ${l.comprobanteEnPapelera ? 'sí' : res?.comprobanteId ? 'NO' : 'no había'}`)
    if (l.motivo) console.log(` motivo: ${l.motivo}`)
    for (const c of l.controles) console.log(`  [${c.ok ? 'ok' : 'MAL'}] ${c.que}: ${c.detalle}`)
    if (l.noEstaba && res?.ok) { console.error('¡La carga quedó verificada en la fila 2 pero la limpieza no la encontró! Revisar a mano "Registro de Pagos".'); salida = 1 }
    if (!l.ok) { console.error('¡LA LIMPIEZA NO QUEDÓ BIEN! Revisar a mano las filas de arriba de "Registro de Pagos" y la carpeta Subidos.'); salida = 1 }
  } catch (e) {
    console.error(`¡FALLÓ LA LIMPIEZA! (${String(e?.message ?? e).slice(0, 200)}) Revisar a mano las filas de arriba de "Registro de Pagos".`)
    salida = 1
  }
  if (!antes) return
  try {
    const despues = await huella()
    const iguales = despues.hash === antes.hash && despues.filasHoja === antes.filasHoja
    console.log(`Huella después: filas 2–5 ${despues.hash.slice(0, 12)}… · filas de la hoja ${despues.filasHoja} → ${iguales ? 'IGUAL que antes: la planilla quedó como estaba' : '¡DISTINTA! Revisar a mano (¿alguien cargó un pago durante la prueba?)'}`)
    if (!iguales) salida = 1
  } catch (e) {
    console.error(`No se pudo releer la huella de después: ${String(e?.message ?? e).slice(0, 200)}`)
    salida = 1
  }
}

try {
  if (modo === 'real') {
    antes = await huella()
    console.log(`\nHuella antes: filas 2–5 ${antes.hash.slice(0, 12)}… · filas de la hoja ${antes.filasHoja}`)
  }
  if (interrumpido) throw new Error(`interrumpido (${interrumpido}) antes de cargar: no se cargó nada`)
  res = await cargarPagoFinanzas(fila, comprobante, { modo })
  imprimirResultado(res)
  if (!res.ok) salida = 1
} catch (e) {
  console.error('La prueba falló:', String(e?.message ?? e).slice(0, 300))
  salida = 1
} finally {
  if (modo === 'real') await limpiar()
  if (interrumpido) salida = salida || (interrumpido === 'SIGINT' ? 130 : 143)
  process.exitCode = salida
}
