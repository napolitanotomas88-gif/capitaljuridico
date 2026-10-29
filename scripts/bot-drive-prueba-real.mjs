// cd <APP_DIR> && set -a && source .env.local && set +a && \
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-drive-prueba-real.mjs --simular
//
// Prueba del paso "Drive" del bot C.J. (docs/BOT-ALTA-CJ.md, paso 4) con un #ALTA INVENTADO: "PRUEBA BOT - borrar".
//   --simular  no llama al puente: imprime los nombres y las llamadas que haría (carpeta, Crudos, Editados, copia de la
//              plantilla de guiones y doc de bienvenida).
//   --real     ANTES de crear nada, sondea el puente (ping y dos llamadas que no cambian nada: sondearPuente en
//              lib/bot/alta/drivePrueba.ts): si el puente publicado no tiene copiarArchivo y aPapeleraCarpeta, aborta,
//              porque la limpieza no terminaría y la carpeta de prueba quedaría en Clientes.
//              Después crea todo en "Clientes" por el Puente Drive, verifica y SIEMPRE (en un finally, aunque falle algo)
//              manda a la papelera lo creado (limpiarPruebaDrive): los docs que la cuenta de servicio ve adentro de la
//              carpeta de prueba con aPapelera y la carpeta (con todo lo de adentro) con aPapeleraCarpeta.
//              Verificación (verificarPruebaDrive): (1) reintento con los ids guardados: mismos ids, "existia", sin buscar
//              la carpeta por nombre en Clientes; (2) primera corrida otra vez, sin ids: la carpeta existente queda
//              esperando el OK y no se crea nada adentro (el freno de homónimos); (3) con la cuenta de servicio (Drive
//              de solo lectura): una sola carpeta en Clientes y cada elemento adentro, sin duplicados. Al final, otra vez
//              con la cuenta de servicio: que no quede la carpeta fuera de la papelera. Ctrl+C no corta en seco:
//              termina el paso en curso, limpia y sale (el segundo Ctrl+C sí corta).
//              Ojo: /clientes y /guiones guardan Drive en caché 30 min; si alguien los abre durante la prueba, la carpeta
//              de prueba puede aparecer ahí un rato.
// Plantilla de guiones: no hay una por defecto (el doc de un cliente real se llena con sus guiones). --real exige
// --plantilla=<id> (un doc cuyo nombre empiece con "Plantilla": el puente no copia otros) o --sin-plantilla (los
// guiones quedan pendientes). --simular acepta las dos y, sin ninguna, muestra los guiones pendientes.
// No imprime la URL ni el secreto del puente.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(raiz)
const args = process.argv.slice(2)
const modo = args.includes('--real') ? 'real' : args.includes('--simular') ? 'simulacion' : null
if (!modo || (args.includes('--real') && args.includes('--simular'))) {
  console.error('Uso: … scripts/bot-drive-prueba-real.mjs --simular   (no llama al puente)\n     … scripts/bot-drive-prueba-real.mjs --real --plantilla=<id> | --sin-plantilla   (crea en Clientes y manda todo a la papelera al final)\n     --plantilla=<id>: el doc "Plantilla Guiones - C.J" (fuera de Clientes); --sin-plantilla: los guiones quedan pendientes')
  process.exit(2)
}
if (modo === 'real' && (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production')) {
  console.error('La prueba real no corre en Vercel ni con NODE_ENV=production.')
  process.exit(2)
}
if (modo === 'real' && (!process.env.PUENTE_DRIVE_URL || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)) {
  const { default: nextEnv } = await import('@next/env')
  nextEnv.loadEnvConfig(raiz, true, { info: () => {}, error: () => {} })
}

const { parsearAlta } = await import('../lib/bot/alta/parsear.ts')
const { prepararDriveCliente, nombresDriveCliente, CARPETA_CLIENTES_DRIVE } = await import('../lib/bot/alta/driveCliente.ts')
const { puenteDriveReal, esIdDrive, PREFIJO_CARPETA_PRUEBA: PREFIJO_PRUEBA } = await import('../lib/bot/alta/puenteDrive.ts')
const { sondearPuente, verificarPruebaDrive, limpiarPruebaDrive } = await import('../lib/bot/alta/drivePrueba.ts')

const MENSAJE = `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PIF 3000 USD
Este pago: 3000 USD · Transferencia USD (Galicia)
Nombre completo: PRUEBA BOT - borrar
Teléfono: +54 9 11 3000-9999
Socios: ninguno
Correo: prueba.bot@example.com
Dirección: Calle Inventada 123, CABA
DNI: 30999999
CUIT: 20-30999999-1
Inicio del servicio: 01/11/2026`

const alta = parsearAlta(MENSAJE)
const nombres = nombresDriveCliente(alta.nombre)
// La limpieza solo puede mandar a la papelera una carpeta "PRUEBA BOT…" (el puente lo exige): si no, no se sigue
if (!nombres || !nombres.carpeta.startsWith(PREFIJO_PRUEBA)) {
  console.error(`La carpeta de prueba se llamaría "${nombres?.carpeta}": no empieza con "${PREFIJO_PRUEBA}". No se sigue.`)
  process.exit(1)
}
const argPlantilla = args.find((x) => x.startsWith('--plantilla='))?.slice('--plantilla='.length).trim()
const sinPlantilla = args.includes('--sin-plantilla')
if (argPlantilla && sinPlantilla) {
  console.error('--plantilla y --sin-plantilla no van juntos.')
  process.exit(2)
}
if (modo === 'real' && !argPlantilla && !sinPlantilla) {
  console.error('--real necesita --plantilla=<id> (el doc "Plantilla Guiones - C.J", fuera de Clientes) o --sin-plantilla (los guiones quedan pendientes). No hay plantilla por defecto: el "Guiones - X" de un cliente se llena con sus guiones.')
  process.exit(2)
}
const plantillaGuionesId = argPlantilla || null
if (plantillaGuionesId && !esIdDrive(plantillaGuionesId)) {
  console.error('El id de la plantilla de guiones no tiene forma de id de Drive.')
  process.exit(2)
}

// ── Impresión ──
const lista = (xs) => (xs?.length ? xs.map((x) => `  - ${x}`).join('\n') : '  (ninguno)')
const ELEMENTOS = ['carpeta', 'crudos', 'editados', 'marca', 'guiones', 'bienvenida']
function describirLlamada(l) {
  const { bloques, ...resto } = l.datos
  const extra = bloques ? ` · ${bloques.length} bloques (${bloques.filter((b) => b.tipo === 'subtitulo').map((b) => b.texto).join(' / ')})` : ''
  return `${l.accion} ${JSON.stringify(resto)}${extra}`
}
function imprimir(res, titulo) {
  console.log(`\n${titulo}: ok ${res.ok ? 'SÍ' : 'NO'} · completo ${res.completo ? 'SÍ' : 'no'}`)
  for (const k of ELEMENTOS) {
    const e = res[k]
    console.log(`  ${k.padEnd(10)} ${e.estado.padEnd(9)} "${e.nombre}"${e.id ? ` · id ${e.id}` : ''}${e.motivo ? ` · ${e.motivo}` : ''}`)
  }
  console.log(` llamadas al puente (${res.modo === 'real' ? 'hechas' : 'que haría'}):\n${lista(res.llamadas.map(describirLlamada))}`)
  console.log(` pendientes:\n${lista(res.pendientes)}`)
  console.log(` errores:\n${lista(res.errores)}`)
}

console.log(`Prueba del paso Drive · ${modo.toUpperCase()} · ${new Date().toISOString()} · #ALTA inventado: ${alta.nombre}`)
console.log(`Clientes: ${CARPETA_CLIENTES_DRIVE} · plantilla de guiones: ${plantillaGuionesId ?? '(ninguna: los guiones quedan pendientes)'}`)
console.log(`Nombres: carpeta "${nombres.carpeta}" · "${nombres.guiones}" · "${nombres.crudos}" · "${nombres.editados}"`)

if (modo === 'simulacion') {
  const res = await prepararDriveCliente(alta, { modo, plantillaGuionesId })
  imprimir(res, 'Simulación')
  process.exitCode = res.ok ? 0 : 1
} else {
  await pruebaReal()
}

// ── Prueba real ──
async function pruebaReal() {
  const { googleConfigurado, googleJson } = await import('../lib/auth/googleRest.ts')
  const SCOPE_LECTURA = 'https://www.googleapis.com/auth/drive.readonly'
  const puente = puenteDriveReal()
  const ctx = { alta, nombres, plantillaGuionesId, carpetaClientesId: CARPETA_CLIENTES_DRIVE }

  /** Hijos (sin papelera) de una carpeta, con la cuenta de servicio. null si no está configurada. */
  async function leerHijos(id, nombre = undefined) {
    if (!googleConfigurado()) return null
    const filtroNombre = nombre ? ` and name = '${nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : ''
    const q = encodeURIComponent(`'${id}' in parents and trashed = false${filtroNombre}`)
    const r = await googleJson(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { scopes: SCOPE_LECTURA })
    return r.files ?? []
  }
  const deps = { puente, leerHijos, log: (l) => console.log(l) }

  // 0) Sondeo: sin la versión nueva del puente no se crea nada (la limpieza no podría terminar)
  const sondeo = await sondearPuente(puente)
  console.log(`\nSondeo del puente: ${sondeo.ok ? 'OK' : 'NO'} · cuenta ${sondeo.cuenta ?? '—'} · versión ${sondeo.version ?? '(sin versión: anterior al 24/10)'}`)
  if (!sondeo.ok) {
    console.error(sondeo.motivo)
    process.exitCode = 1
    return
  }

  const resultados = []   // todas las corridas: lo que hayan creado se limpia
  let salida = 0
  let interrumpido = null

  const alInterrumpir = (senal) => {
    if (interrumpido) {
      console.error(`\n${senal} otra vez: se sale SIN terminar la limpieza. Revisar a mano la carpeta "${nombres.carpeta}" en Clientes.`)
      process.exit(1)
    }
    interrumpido = senal
    console.error(`\n${senal}: no se corta en seco. Se termina el paso en curso, se limpia y se sale (${senal} otra vez = salir YA, sin limpiar).`)
  }
  process.on('SIGINT', () => alInterrumpir('SIGINT'))
  process.on('SIGTERM', () => alInterrumpir('SIGTERM'))

  try {
    if (interrumpido) throw new Error(`interrumpido (${interrumpido}) antes de empezar: no se creó nada`)
    const res = await prepararDriveCliente(alta, { modo: 'real', plantillaGuionesId })
    resultados.push(res)
    imprimir(res, 'Resultado')
    if (!res.ok) salida = 1
    if (res.esperaOk === 'carpeta_existente') {
      console.log(`\n[MAL] Ya había una carpeta "${nombres.carpeta}" en Clientes (de una prueba anterior que no se limpió): el freno de homónimos no creó nada adentro. Se manda a la papelera; volver a correr la prueba.`)
      salida = 1
    } else if (res.carpeta.id && !interrumpido) {
      console.log('\nVerificación')
      const { controles, corridas } = await verificarPruebaDrive(ctx, res, deps)
      resultados.push(...corridas)
      for (const c of controles) console.log(`  [${c.info ? 'info' : c.ok ? 'ok' : 'MAL'}] ${c.que}: ${c.detalle}`)
      if (!controles.every((c) => c.ok)) salida = 1
    }
  } catch (e) {
    console.error('La prueba falló:', String(e?.message ?? e).slice(0, 300))
    salida = 1
  } finally {
    console.log('\nLimpieza (siempre): docs de adentro con aPapelera y la carpeta con aPapeleraCarpeta')
    const limpieza = await limpiarPruebaDrive({ nombres, carpetaClientesId: CARPETA_CLIENTES_DRIVE, resultados }, deps)
    if (!limpieza.ok) salida = 1
    if (interrumpido) salida = salida || (interrumpido === 'SIGINT' ? 130 : 143)
    process.exitCode = salida
  }
}
