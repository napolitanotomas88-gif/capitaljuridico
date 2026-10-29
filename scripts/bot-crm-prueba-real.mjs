// cd <APP_DIR> && set -a && source .env.local && set +a && \
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-crm-prueba-real.mjs --simular
//
// Prueba del paso "Alta en el CRM de Clientes" del bot C.J. contra el CRM REAL ("2026 - CRM - CLIENTES") con un #ALTA
// INVENTADO ("PRUEBA BOT - borrar", +54 9 11 0000-0000 —ningún abonado argentino tiene un número que empiece con 0, así
// que no es de nadie—, prueba.bot@example.com, Marcos, PP 3300 USD, este pago 1100, inicio hoy, 2 cuotas de 1100).
//   --simular  SOLO LECTURA: lectura forzada + relectura de las filas destino; imprime exactamente lo que escribiría.
//   --real     ESCRIBE la fila de Agencia, copia las fórmulas y el período 0 en Renovaciones y verifica. Apenas vuelve
//              la escritura guarda un recibo (.cache/bot-crm-prueba-real.json: ID, filas, pedidos y fórmulas precargadas)
//              y SIEMPRE (en un finally, aunque falle la verificación) borra esas filas con limpiarFilaPrueba() y verifica
//              la limpieza. Si la limpieza aborta porque la fila todavía no tiene el nombre (una escritura que se cortó por
//              timeout y Google aplicó después), reintenta una vez a los 10 s.
//              Ctrl+C / SIGTERM / SIGHUP no cortan: se espera a que termine la limpieza (a la 3.ª vez sale igual).
//              No corre de 7:45 a 11:15 hora argentina (10:45–14:15 UTC): ahí corren los crons de vercel.json que leen
//              planillas (11:00–13:00 UTC, con margen por si se corren y por los 10 min del snapshot) y podrían
//              llevarse la fila de prueba a un reporte. Tampoco corre si quedó el recibo de una prueba sin limpiar.
//   --limpiar [filaAgencia filaRenovaciones]
//              SOLO la limpieza, con los mismos candados, a partir del recibo que dejó --real (si se pasan las filas,
//              tienen que ser las del recibo). Corre a cualquier hora. Si queda bien, borra el recibo.
// limpiarFilaPrueba (lib/bot/alta/crmLimpiar.ts) solo borra si el nombre empieza con "PRUEBA BOT", el ID de la columna A
// es el que escribió la prueba y no hay datos en columnas que la prueba no escribió; borra solo A:AD y A:L.
// Antes de la primera corrida --real: confirmar que ningún escenario de Make ni Apps Script de "2026 - CRM - CLIENTES"
// reacciona a filas nuevas de Agencia (desde acá no se puede ver).
// Solo imprime datos de la fila de prueba: de los clientes reales, a lo sumo IDs (posibles repetidos).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(raiz)   // el snapshot vive en .cache/ de la raíz del repo
const args = process.argv.slice(2)
const MODOS = { '--simular': 'simulacion', '--real': 'real', '--limpiar': 'limpiar' }
const pedidosDeModo = Object.keys(MODOS).filter(m => args.includes(m))
const modo = pedidosDeModo.length === 1 ? MODOS[pedidosDeModo[0]] : null
const COMANDO = 'cd <APP_DIR> && set -a && source .env.local && set +a && node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-crm-prueba-real.mjs'
if (!modo) {
  console.error([
    'Uso: … scripts/bot-crm-prueba-real.mjs --simular                        (solo lectura)',
    '     … scripts/bot-crm-prueba-real.mjs --real                           (escribe y borra al final)',
    '     … scripts/bot-crm-prueba-real.mjs --limpiar [filaAgencia filaRen.]  (solo la limpieza, con el recibo de --real)',
  ].join('\n'))
  process.exit(2)
}

// ── Recibo de la prueba: lo que hace falta para limpiarla después con los mismos candados ──
const RECIBO = join(raiz, '.cache', 'bot-crm-prueba-real.json')
function leerRecibo() {
  try { return JSON.parse(readFileSync(RECIBO, 'utf8')) } catch { return null }
}
const reciboDe = (res) => ({
  creado: new Date().toISOString(), id: res.id, filaAgencia: res.filaAgencia, filaRenovaciones: res.filaRenovaciones,
  pedidos: res.pedidos, formulasPrevias: res.formulasPrevias,
})
function guardarRecibo(recibo) {
  try {
    mkdirSync(dirname(RECIBO), { recursive: true })
    writeFileSync(RECIBO, JSON.stringify(recibo, null, 2))
  } catch (e) {
    console.error(`No se pudo guardar el recibo de la prueba (${String(e?.message ?? e).slice(0, 200)}): si la limpieza falla no va a andar --limpiar; habría que borrar a mano.`)
  }
}

// ── Candados de --real: fuera del horario de los crons y sin una prueba anterior sin limpiar ──
const VENTANA_CRONS_UTC = [10 * 60 + 45, 14 * 60 + 15]   // 10:45–14:15 UTC = 7:45–11:15 en Argentina
if (modo === 'real') {
  const ahora = new Date(), minuto = ahora.getUTCHours() * 60 + ahora.getUTCMinutes()
  if (minuto >= VENTANA_CRONS_UTC[0] && minuto < VENTANA_CRONS_UTC[1]) {
    console.error('--real no corre de 7:45 a 11:15 hora argentina (10:45–14:15 UTC): a esa hora los crons de vercel.json (resumen diario, analista, finanzas, anuncios…) leen las planillas y podrían llevarse la fila de prueba a un reporte. Probá más tarde.')
    process.exit(2)
  }
  if (existsSync(RECIBO)) {
    console.error(`Quedó el recibo de una prueba anterior sin limpiar (${RECIBO}). Primero:\n  ${COMANDO} --limpiar`)
    process.exit(2)
  }
}

// ── Ctrl+C no corta una prueba a medias: se espera a que termine la limpieza ──
if (modo !== 'simulacion') {
  let veces = 0
  const alInterrumpir = (senal) => {
    veces++
    if (veces >= 3) {
      console.error(`\n${senal} por 3.ª vez: salgo SIN terminar. Si la prueba llegó a escribir, puede haber quedado la fila "PRUEBA BOT" en el CRM:\n  ${COMANDO} --limpiar\n(sin recibo, revisar a mano las filas que se imprimieron arriba).`)
      process.exit(130)
    }
    console.error(`\n${senal}: no se corta en el medio; termino la prueba y la limpieza${veces === 2 ? ' (una vez más y salgo sin limpiar)' : ''}.`)
  }
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => alInterrumpir(s))
  for (const st of [process.stdout, process.stderr]) st.on('error', () => {})   // terminal cerrada (SIGHUP): que imprimir no tire
}

if (!process.env.SHEET_ID_CLIENTES) {
  // Por si no se cargó .env.local con source: el cargador de Next, sin imprimir nada
  const { default: nextEnv } = await import('@next/env')
  nextEnv.loadEnvConfig(raiz, true, { info: () => {}, error: () => {} })
}

const { parsearAlta } = await import('../lib/bot/alta/parsear.ts')
const { escribirAltaCrm } = await import('../lib/bot/alta/crmEscribir.ts')
const { escritoDesdePedidos, limpiarFilaPrueba, PREFIJO_PRUEBA } = await import('../lib/bot/alta/crmLimpiar.ts')
const { lecturasRealizadas } = await import('../lib/clientes/leer.ts')
const { hoyArgentina, sumarMeses, serialAYmd } = await import('../lib/clientes/fechas.ts')

const lista = (xs) => (xs?.length ? xs.map(x => `  - ${x}`).join('\n') : '  (ninguno)')
const ddmmaaaa = (ymd) => ymd.split('-').reverse().join('/')
const valor = (v) => (typeof v === 'number' ? (v > 40000 && v < 60000 ? `${v} (${ddmmaaaa(serialAYmd(v))})` : String(v)) : JSON.stringify(v))
const letra = (i) => { let n = i + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

// ── Limpieza con el recibo (la usan --real en el finally y --limpiar) ──
const REINTENTO_MS = 10_000
const esperar = (ms) => new Promise(r => setTimeout(r, ms))
async function limpiarConRecibo(recibo) {
  const { filaAgencia: fA, filaRenovaciones: fR } = recibo
  console.log(`\nLimpieza: Agencia fila ${fA} · Renovaciones fila ${fR} · ID ${recibo.id ?? '—'}`)
  const desc = escritoDesdePedidos(recibo.id, recibo.pedidos, fA, fR)
  if (!desc.ok) {
    console.error(` No se sabe con certeza qué escribió la prueba (${desc.errores.join(' ')}): no se borra nada. Revisar a mano Agencia fila ${fA} y Renovaciones fila ${fR}.`)
    return false
  }
  const opciones = { escrito: desc.escrito, formulasPrevias: recibo.formulasPrevias ?? null }
  let l = await limpiarFilaPrueba(fA, fR, opciones)
  if (!l.ok && !l.borro && l.reintentable) {
    console.log(` La fila de Agencia todavía no tiene nombre (${l.motivo}); puede que la escritura llegue tarde: reintento en ${REINTENTO_MS / 1000} s…`)
    await esperar(REINTENTO_MS)
    l = await limpiarFilaPrueba(fA, fR, opciones)
  }
  console.log(` ok: ${l.ok ? 'SÍ' : 'NO'} · borró: ${l.borro ? 'sí' : 'no'} · Renovaciones tocada: ${l.renovacionesTocada ? 'sí' : 'no'} · fórmulas restauradas: ${l.restauradas.join(', ') || '(ninguna)'}`)
  if (l.motivo) console.log(` motivo: ${l.motivo}`)
  for (const c of l.verificacion?.controles ?? []) console.log(`  [${c.ok ? 'ok' : 'MAL'}] ${c.que}: ${c.detalle}`)
  if (l.ok) {
    try { rmSync(RECIBO, { force: true }) } catch { /* el recibo de una prueba ya limpia no molesta */ }
    return true
  }
  console.error(`¡LA LIMPIEZA NO QUEDÓ BIEN! Revisar a mano Agencia fila ${fA} y Renovaciones fila ${fR}. Para reintentarla con los mismos candados:\n  ${COMANDO} --limpiar`)
  if (!l.borro && l.reintentable) console.error(` Si la fila quedó sin nombre ni datos (solo las fórmulas J:N copiadas, que sin ID no muestran nada), no hay nada de la prueba a la vista: se puede borrar el recibo ${RECIBO}.`)
  return false
}

if (modo === 'limpiar') {
  // ── --limpiar: solo la limpieza, con el recibo ──
  const recibo = leerRecibo()
  if (!recibo) {
    console.error(`No hay recibo de una prueba (${RECIBO}): sin saber qué ID y qué celdas escribió, no se borra nada. Revisar a mano.`)
    process.exit(1)
  }
  const i = args.indexOf('--limpiar')
  const filas = args.slice(i + 1, i + 3).filter(x => !x.startsWith('--'))
  if (filas.length && (filas.length !== 2 || Number(filas[0]) !== recibo.filaAgencia || Number(filas[1]) !== recibo.filaRenovaciones)) {
    console.error(`Las filas pedidas (${filas.join(', ')}) no son las del recibo (Agencia ${recibo.filaAgencia}, Renovaciones ${recibo.filaRenovaciones}): no se borra nada.`)
    process.exit(2)
  }
  console.log(`Limpieza de la prueba del ${recibo.creado ?? '(sin fecha)'} · ${new Date().toISOString()}`)
  let ok = false
  try {
    ok = await limpiarConRecibo(recibo)
  } catch (e) {
    console.error(`¡FALLÓ LA LIMPIEZA! (${String(e?.message ?? e).slice(0, 200)}) Revisar a mano Agencia fila ${recibo.filaAgencia} y Renovaciones fila ${recibo.filaRenovaciones}.`)
  }
  process.exitCode = ok ? 0 : 1
} else {
  await probarAlta()
}

async function probarAlta() {
  const hoy = hoyArgentina()
  const MENSAJE = `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD
Nombre completo: PRUEBA BOT - borrar
Teléfono: +54 9 11 0000-0000
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
    process.exitCode = 1
    return
  }

  function imprimirResultado(res) {
    const p = res.previa
    console.log(`\nModo: ${res.modo.toUpperCase()} · etapa: ${res.etapa} · ok: ${res.ok ? 'SÍ' : 'NO'} · escribió: ${res.escribio ? 'SÍ' : 'no'}`)
    if (p) {
      console.log(`Lectura del CRM: ${p.lectura.fuente} · hace ${p.lectura.edadSeg} s · fórmulas de Agencia: ${p.lectura.formulas} · apta para escribir: ${p.aptoParaEscribir ? 'SÍ' : 'NO'}`)
      if (p.motivosNoApto.length) console.log(` motivos:\n${lista(p.motivosNoApto)}`)
      if (p.bloqueos.length) console.log(` bloqueos:\n${lista(p.bloqueos.map(b => `[${b.motivo}] ${b.detalle}`))}`)
    }
    if (res.motivo) console.log(`Motivo: ${res.motivo}`)
    console.log(`ID nuevo: ${res.id ?? '—'} · fila Agencia: ${res.filaAgencia ?? '—'} · fila Renovaciones: ${res.filaRenovaciones ?? '—'}`)
    if (res.pedidos) {
      console.log(`\n${res.modo === 'real' ? 'Pedidos enviados' : 'Pedidos que se enviarían'} (en este orden):`)
      console.log(' 1) spreadsheets.batchUpdate · copyPaste PASTE_FORMULA')
      for (const r of res.pedidos.copiarFormulas) {
        const { source: s, destination: d } = r.copyPaste
        console.log(`  - sheetId ${s.sheetId}: ${letra(s.startColumnIndex)}${s.startRowIndex + 1}:${letra(s.endColumnIndex - 1)}${s.endRowIndex} → ${letra(d.startColumnIndex)}${d.startRowIndex + 1}:${letra(d.endColumnIndex - 1)}${d.endRowIndex} (sheetId ${d.sheetId})`)
      }
      console.log(' 2) values.batchUpdate · USER_ENTERED')
      for (const d of res.pedidos.valores) console.log(`  - ${d.range} = [${d.values[0].map(valor).join(', ')}]`)
      const desc = escritoDesdePedidos(res.id, res.pedidos, res.filaAgencia, res.filaRenovaciones)
      console.log(desc.ok
        ? ` la limpieza solo borraría si el ID de A es ${desc.escrito.id} y no hay datos fuera de: Agencia ${desc.escrito.agencia.map(letra).join(',')} · Renovaciones ${desc.escrito.renovaciones.map(letra).join(',')}`
        : ` ¡la limpieza no podría reconocer lo escrito! ${desc.errores.join(' ')}`)
    }
    if (res.omitidas.length) console.log(` celdas del plan que NO se escriben (la planilla ya tiene su fórmula):\n${lista(res.omitidas.map(o => `${o.pestana} ${letra(o.col)}${o.fila}: plan ${valor(o.valor)} → queda ${o.formula}`))}`)
    if (res.formulasPrevias) {
      const fp = res.formulasPrevias
      console.log(` fórmulas precargadas en las filas destino (se respetan y la limpieza las restaura): Agencia ${Object.keys(fp.agencia).join(', ') || '(ninguna)'} · Renovaciones ${Object.keys(fp.renovaciones).join(', ') || '(ninguna)'}`)
    }
    console.log(` avisos:\n${lista(res.avisos)}`)
    if (res.verificacion) {
      console.log(`\nVerificación: ${res.verificacion.ok ? 'OK' : 'FALLÓ'}`)
      for (const c of res.verificacion.controles) console.log(`  [${c.ok ? 'ok' : c.informativo ? 'info' : 'MAL'}] ${c.que}: ${c.detalle}`)
    }
  }

  console.log(`Prueba del alta en el CRM de Clientes · ${new Date().toISOString()} · #ALTA inventado: ${alta.nombre} · Día 1 ${hoy}`)
  if (alta.faltantes.length) console.log(`Faltantes del parser:\n${lista(alta.faltantes)}`)

  let res = null, recibo = null
  let salida = 0
  try {
    res = await escribirAltaCrm(alta, { mensaje: MENSAJE, hoy }, { modo })
    if (modo === 'real' && res.escribio) { recibo = reciboDe(res); guardarRecibo(recibo) }   // antes de imprimir y de limpiar
    imprimirResultado(res)
    if (!res.ok) salida = 1
  } catch (e) {
    // escribirAltaCrm no tira después de empezar a escribir (devuelve escribio=true); si tira es antes: no escribió nada
    console.error(res ? `Falló al imprimir el resultado: ${String(e?.message ?? e).slice(0, 300)}` : `escribirAltaCrm falló antes de escribir: ${String(e?.message ?? e).slice(0, 300)}`)
    salida = 1
  } finally {
    if (modo === 'real' && res?.escribio && res.filaAgencia && res.filaRenovaciones) {
      try {
        if (!(await limpiarConRecibo(recibo ?? reciboDe(res)))) salida = 1
      } catch (e) {
        console.error(`¡FALLÓ LA LIMPIEZA! (${String(e?.message ?? e).slice(0, 200)}) Revisar a mano Agencia fila ${res.filaAgencia} y Renovaciones fila ${res.filaRenovaciones}. Para reintentarla:\n  ${COMANDO} --limpiar`)
        salida = 1
      }
    } else if (modo === 'real') {
      console.log('\nLimpieza: no hace falta (no se mandó ninguna escritura).')
    }
    console.log(`\nLlamadas de lectura del CRM por leer.ts en esta corrida: ${lecturasRealizadas()} (más las directas de la escritura)`)
    process.exitCode = salida
  }
}
