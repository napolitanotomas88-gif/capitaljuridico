// cd <APP_DIR> && set -a && source .env.local && set +a && \
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-finanzas-validacion.mjs --simular
//
// Suma "Empresa" a la lista desplegable de la columna R ("Cuenta que recibió") de "Registro de Pagos", SIN quitar las
// que ya están (Tomi, Gero, Relay, Financiera, Otra: las viejas quedan para las filas anteriores). Tomás, 24/10/2026.
//   --simular  SOLO LECTURA (scope readonly): lee la regla de R2:R y muestra el pedido que mandaría.
//   --real     aplica setDataValidation en R2:R (de la fila 2 hasta el final) con la lista ampliada, manteniendo
//              strict / showCustomUi / mensaje de ayuda como estaban, y relee para verificar.
// No toca ningún valor de la planilla: solo la regla de validación de la columna R. Antes de aplicar controla que el
// encabezado R1 siga siendo "Cuenta que recibió" (si insertaron una columna antes de R, la lista caería en otra).
// Ojo: la API no expone los colores de las opciones del desplegable; si la lista tenía colores, al reescribir la regla
// pueden volver al gris por defecto. Como es un cambio de una sola vez, lo más seguro es sumar "Empresa" A MANO en
// Datos → Validación de datos (conserva los colores); este script queda para verificar con --simular.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(raiz)
const modo = process.argv.includes('--real') ? 'real' : process.argv.includes('--simular') ? 'simulacion' : null
if (!modo || (process.argv.includes('--real') && process.argv.includes('--simular'))) {
  console.error('Uso: … scripts/bot-finanzas-validacion.mjs --simular   (solo lectura)\n     … scripts/bot-finanzas-validacion.mjs --real      (aplica la lista ampliada)')
  process.exit(2)
}
if (!process.env.SHEET_ID_FINANZAS) {
  const { default: nextEnv } = await import('@next/env')
  nextEnv.loadEnvConfig(raiz, true, { info: () => {}, error: () => {} })
}

const { planillaFinanzasReal, listaConOpcion, resumenReglas, pedidoValidacionLista, OPCION_EMPRESA, PESTANA_REGISTRO } = await import('../lib/bot/alta/finanzasEscribir.ts')
const { normTxt } = await import('../lib/clientes/texto.ts')
const COLUMNA = 'R', INDICE = 17, ENCABEZADO = 'cuenta que recibio'
// Errores de Google: solo el mensaje (sin la configuración del pedido)
const soloMensaje = (e) => String(e?.message ?? e).slice(0, 300)

const planilla = planillaFinanzasReal(modo)
let estructura, reglas, r1
try {
  ;[estructura, reglas, [[[r1] = []]]] = await Promise.all([
    planilla.estructura(2), planilla.validacionesDeColumna(COLUMNA), planilla.leer([`'${PESTANA_REGISTRO}'!${COLUMNA}1`], 'FORMULA'),
  ])
} catch (e) {
  console.error(`No se pudo leer "${PESTANA_REGISTRO}": ${soloMensaje(e)}`)
  process.exit(1)
}
const r = resumenReglas(reglas)
console.log(`"${PESTANA_REGISTRO}" · columna ${COLUMNA} · ${modo.toUpperCase()} · ${new Date().toISOString()}`)
if (normTxt(r1) !== ENCABEZADO) {
  console.error(`El encabezado ${COLUMNA}1 dice "${String(r1 ?? '')}", no "Cuenta que recibió": ¿movieron columnas? No se sigue.`)
  process.exit(1)
}
console.log(`Encabezado ${COLUMNA}1: "${r1}" (el de siempre)`)
console.log(`Filas de la hoja: ${estructura.filasHoja} · celdas leídas en ${COLUMNA}2:${COLUMNA}: ${r.total} · con la regla principal: ${r.conEsa} · sin regla: ${r.sinRegla} · reglas distintas: ${r.distintas}`)
if (!r.regla || r.regla.tipo !== 'ONE_OF_LIST' || !r.regla.lista) {
  console.error(`La columna ${COLUMNA} no tiene una lista desplegable (ONE_OF_LIST): no se sigue.`)
  process.exit(1)
}
console.log(`Regla de hoy: lista [${r.regla.lista.join(', ')}] · strict: ${r.regla.strict} · showCustomUi: ${r.regla.showCustomUi} · mensaje: ${r.regla.inputMessage ?? '(ninguno)'}`)
if (r.distintas > 1 || r.sinRegla > 0) console.log(`Aviso: no todas las celdas tienen la misma regla; setDataValidation deja la regla ampliada en TODA la columna desde la fila 2.`)

const { lista, cambia } = listaConOpcion(r.regla.lista, OPCION_EMPRESA)
if (!cambia) {
  console.log(`"${OPCION_EMPRESA}" ya está en la lista: no hay nada que hacer.`)
  process.exit(0)
}
const pedido = pedidoValidacionLista(estructura.sheetId, INDICE, r.regla, lista)
console.log(`Lista nueva: [${lista.join(', ')}]`)
console.log(`${modo === 'real' ? 'Pedido que se manda' : 'Pedido que se mandaría'} (spreadsheets.batchUpdate):\n${JSON.stringify(pedido, null, 2)}`)
console.log(`Recomendado: sumar "${OPCION_EMPRESA}" a mano en Datos → Validación de datos (la API puede devolver los colores de las opciones al gris).`)
if (modo === 'simulacion') process.exit(0)

let despues
try {
  await planilla.batchUpdate([pedido])
  despues = resumenReglas(await planilla.validacionesDeColumna(COLUMNA))
} catch (e) {
  console.error(`Google rechazó o no respondió el pedido: ${soloMensaje(e)}. Releer con --simular para ver si se aplicó.`)
  process.exit(1)
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ok = despues.regla && igual(despues.regla.lista, lista) && despues.regla.strict === r.regla.strict && despues.regla.showCustomUi === r.regla.showCustomUi
  && despues.distintas === 1 && despues.sinRegla === 0
console.log(`\nVerificación: ${ok ? 'OK' : 'FALLÓ'} · lista [${despues.regla?.lista?.join(', ') ?? '—'}] · strict ${despues.regla?.strict} · showCustomUi ${despues.regla?.showCustomUi} · celdas con la regla ${despues.conEsa}/${despues.total}`)
process.exitCode = ok ? 0 : 1
