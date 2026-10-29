// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-drive.mjs
// Carpeta de Drive del cliente nuevo (paso 4 de docs/BOT-ALTA-CJ.md): nombres (puros) y prepararDriveCliente con un
// puente de juguete (sin red). Datos INVENTADOS salvo los nombres de la convención real de Drive que se usan de ejemplo
// ("Claudia Roldan" → "Guiones - ClaudiaR", como la carpeta de Aylu).
// Reintentos del puente (puenteDriveReal entero): con un Apps Script de juguete DETRÁS del fetch y un reloj de juguete
// (las esperas no se esperan de verdad). Nunca se llama al puente real ni a Google.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parsearAlta } from '../lib/bot/alta/parsear.ts'
import { armarBienvenida } from '../lib/bot/alta/bienvenida.ts'
import {
  ErrorPuente, esAccionDesconocida, puenteDriveReal, unirDudosos, CARPETA_COMPROBANTES, PREFIJO_CARPETA_PRUEBA, PREFIJO_PLANTILLA,
  ESPERAS_REINTENTO_MS, INTENTOS_PUENTE, MAXIMO_APPS_SCRIPT_MS, TOPE_LLAMADA_MS, INTENTO_LARGO_MS,
} from '../lib/bot/alta/puenteDrive.ts'
import { PREFIJO_PRUEBA } from '../lib/bot/alta/finanzasLimpiar.ts'
import {
  nombreCliente, sufijoCliente, nombresDriveCliente, prepararDriveCliente, motivoNombreDudoso, aprobarCarpetaExistente,
  plantillaGuionesDesdeEntorno, CARPETA_CLIENTES_DRIVE, PENDIENTE_COPIAR, PENDIENTE_PLANTILLA, PENDIENTE_NO_ES_PLANTILLA,
  MOTIVO_CARPETA_EXISTENTE, VARIABLE_PLANTILLA_GUIONES, MOTIVO_CARPETA_DE_INTENTO_DUDOSO, TOLERANCIA_RELOJ_MS, carpetaDeIntentoDudoso,
  MAXIMO_VENTANAS,
} from '../lib/bot/alta/driveCliente.ts'
import { sondearPuente, verificarPruebaDrive, limpiarPruebaDrive, ID_INEXISTENTE } from '../lib/bot/alta/drivePrueba.ts'

// La lectura de la fecha de creación usa la cuenta de servicio solo si está configurada: acá nunca (ni por descuido)
for (const k of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) delete process.env[k]

// ── Nombres ───────────────────────────────────────────────────────────────────────────────────────────────────
test('Claudia Roldan → "Claudia Roldan - C.J" con Guiones / Crudos / Editados "- ClaudiaR" (la convención real)', () => {
  assert.deepEqual(nombresDriveCliente('Claudia Roldan'), {
    cliente: 'Claudia Roldan',
    carpeta: 'Claudia Roldan - C.J',
    sufijo: 'ClaudiaR',
    guiones: 'Guiones - ClaudiaR',
    crudos: 'Crudos - ClaudiaR',
    editados: 'Editados - ClaudiaR',
    marca: 'Marca - ClaudiaR',
    bienvenida: 'Bienvenida - Claudia Roldan',
  })
})

test('otros clientes reales: MauroL, JulioH, BarbaraB, MartiF', () => {
  assert.equal(sufijoCliente('Mauro Lyonnet'), 'MauroL')
  assert.equal(sufijoCliente('Julio Herrera'), 'JulioH')
  assert.equal(sufijoCliente('Barbara Benitez'), 'BarbaraB')
  assert.equal(sufijoCliente('Marti Fernández'), 'MartiF')
})

test('dos nombres: primer nombre + inicial de la última palabra ("Claudia Gabriela Roldan" → ClaudiaR)', () => {
  const n = nombresDriveCliente('Claudia Gabriela Roldan')
  assert.equal(n.carpeta, 'Claudia Gabriela Roldan - C.J')
  assert.equal(n.guiones, 'Guiones - ClaudiaR')
  assert.equal(sufijoCliente('María José Paz'), 'MaríaP')
  assert.equal(sufijoCliente('Juan Pablo Pérez'), 'JuanP')
})

test('apellidos compuestos y con partículas', () => {
  const n = nombresDriveCliente('Juan Pablo de la Vega')
  assert.equal(n.carpeta, 'Juan Pablo de la Vega - C.J')
  assert.equal(n.sufijo, 'JuanV')
  assert.equal(nombreCliente('JUAN PABLO DE LA VEGA'), 'Juan Pablo de la Vega')
  assert.equal(nombreCliente('ana pérez-gómez'), 'Ana Pérez-Gómez')
  assert.equal(sufijoCliente('ana pérez-gómez'), 'AnaP')
  assert.equal(nombreCliente("sean o'connor"), "Sean O'Connor")
})

test('acentos: se respetan (como "Guiones - BelénA" de Aylu) y se normalizan a NFC', () => {
  assert.equal(sufijoCliente('Belén Acosta'), 'BelénA')
  assert.equal(sufijoCliente('Ángel Ávila'), 'ÁngelÁ')
  assert.equal(nombreCliente('LUCÍA BENÍTEZ'), 'Lucía Benítez')
  const nfd = 'Lucía Núñez'.normalize('NFD')
  assert.notEqual(nfd, 'Lucía Núñez')
  assert.equal(nombreCliente(nfd), 'Lucía Núñez')
  assert.equal(sufijoCliente(nfd), 'LucíaN')
})

test('"Ma. Laura Ruiz" → "María Laura Ruiz - C.J" y "Guiones - MaríaR" (también Ma.Laura, Mª y minúsculas)', () => {
  const n = nombresDriveCliente('Ma. Laura Ruiz')
  assert.equal(n.carpeta, 'María Laura Ruiz - C.J')
  assert.equal(n.guiones, 'Guiones - MaríaR')
  assert.equal(n.crudos, 'Crudos - MaríaR')
  assert.equal(nombreCliente('Ma.Laura Ruiz'), 'María Laura Ruiz')
  assert.equal(nombreCliente('Mª Laura Ruiz'), 'María Laura Ruiz')
  assert.equal(nombreCliente('ma. laura ruiz'), 'María Laura Ruiz')
  assert.equal(nombreCliente('Dra. Mª José Paz'), 'María José Paz')
})

test('títulos, iniciales sueltas, espacios y signos', () => {
  assert.equal(nombreCliente('Dra. Lucía Benítez'), 'Lucía Benítez')
  assert.equal(sufijoCliente('Dr. Juan Pérez'), 'JuanP')
  assert.equal(sufijoCliente('Juan J. Pérez'), 'JuanP')
  assert.equal(nombreCliente('  Claudia   Roldan  '), 'Claudia Roldan')
  assert.equal(nombreCliente('Juan . Pérez'), 'Juan Pérez')
  assert.equal(nombreCliente('CLAUDIA ROLDAN'), 'Claudia Roldan')
  assert.equal(nombreCliente('claudia\troldan\n'), 'Claudia Roldan')
})

test('un solo nombre: "Guiones - Gisela" (como lo hace Aylu)', () => {
  assert.equal(nombresDriveCliente('Gisela').guiones, 'Guiones - Gisela')
  assert.equal(nombresDriveCliente('Gisela').carpeta, 'Gisela - C.J')
})

test('el nombre de prueba conserva el guion: "PRUEBA BOT - borrar - C.J"', () => {
  const n = nombresDriveCliente('PRUEBA BOT - borrar')
  assert.equal(n.carpeta, 'PRUEBA BOT - borrar - C.J')
  assert.equal(n.sufijo, 'PRUEBAB')
  assert.equal(nombreCliente('- Juan - – Pérez -'), 'Juan - Pérez')   // guiones de los bordes y repetidos afuera
  assert.equal(nombreCliente('Juan -- Pérez'), 'Juan Pérez')          // "--" es un signo suelto
})

test('sin nombre → null', () => {
  assert.equal(nombresDriveCliente(null), null)
  assert.equal(nombresDriveCliente(''), null)
  assert.equal(nombresDriveCliente(' - . '), null)
  assert.equal(nombresDriveCliente('Dra.'), null)
  assert.equal(nombresDriveCliente('Escribana'), null)
})

test('títulos escritos enteros o pegados al nombre se sacan (los clientes son escribanos y abogados)', () => {
  const casos = [
    ['Escribana Laura Pérez', 'Laura Pérez', 'LauraP'],
    ['Abogada María Gómez', 'María Gómez', 'MaríaG'],
    ['Abogado Juan Pérez', 'Juan Pérez', 'JuanP'],
    ['Doctora Lucía Benítez', 'Lucía Benítez', 'LucíaB'],
    ['Dra.Lucía Benítez', 'Lucía Benítez', 'LucíaB'],
    ['Dr.Juan Pérez', 'Juan Pérez', 'JuanP'],
    ['Esc.Laura Pérez', 'Laura Pérez', 'LauraP'],
    ['Contador Juan Pérez', 'Juan Pérez', 'JuanP'],
    ['Cdora. Ana Ruiz', 'Ana Ruiz', 'AnaR'],
    ['ESCRIBANO JUAN PÉREZ', 'Juan Pérez', 'JuanP'],
    ['Lic. Ana Ruiz', 'Ana Ruiz', 'AnaR'],
  ]
  for (const [entrada, cliente, sufijo] of casos) {
    assert.equal(nombreCliente(entrada), cliente, entrada)
    assert.equal(sufijoCliente(entrada), sufijo, entrada)
  }
  // Un título más adelante no se toca, ni las iniciales con punto que no son títulos
  assert.equal(nombreCliente('Juan J.Pérez'), 'Juan J.Pérez')
})

test('nombre que parece traer a más de una persona → motivo (el bot no crea la carpeta y pregunta)', () => {
  for (const n of ['Juan Pérez y Ana Gómez', 'Juan Pérez Y Ana Gómez', 'Juan Pérez e Inés Gómez', 'Lucía Benítez (socia: Ana)', 'Pérez / Gómez', 'Pérez & Asociados', 'Juan + Ana'])
    assert.ok(motivoNombreDudoso(n), n)
  for (const n of ['Claudia Roldan', 'Juan Pablo de la Vega', 'PRUEBA BOT - borrar', 'Ana Pérez-Gómez', "Sean O'Connor", 'Dra. Lucía Benítez', 'Yanina Paz', null, ''])
    assert.equal(motivoNombreDudoso(n), null, String(n))
})

test('el doc de bienvenida usa el MISMO nombre que la carpeta (un solo normalizador)', () => {
  for (const [nombre, doc] of [['Dra. Lucía Benítez', 'Bienvenida - Lucía Benítez'], ['PRUEBA BOT - borrar', 'Bienvenida - PRUEBA BOT - borrar'],
    ['Escribana Laura Pérez', 'Bienvenida - Laura Pérez'], ['Ma. Laura Ruiz', 'Bienvenida - María Laura Ruiz'], ['LUCÍA BENÍTEZ', 'Bienvenida - Lucía Benítez']]) {
    const n = nombresDriveCliente(nombre)
    assert.equal(n.bienvenida, doc, nombre)
    assert.equal(n.carpeta, `${doc.slice('Bienvenida - '.length)} - C.J`, nombre)
    assert.equal(armarBienvenida(parsearAlta(`#ALTA\nNombre completo: ${nombre}`)).nombreDoc, doc, nombre)
  }
})

// ── prepararDriveCliente con un puente de juguete ───────────────────────────────────────────────────────────────
const ALTA = parsearAlta(`#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: Claudia Roldan
Teléfono: +54 9 11 3000-0001
Socios: ninguno
Correo: claudia@ejemplo.com
Dirección: Calle Inventada 123, CABA
DNI: 30000001
CUIT: 20-30000001-1
Inicio del servicio: 01/11/2026`)
const PLANTILLA = 'PlantillaDeJuguete0000000000000001'
const DOC_DE_CLIENTE = 'GuionesDeOtroClienteJuguete00001'   // un "Guiones - X" de un cliente: nunca se copia
const CLIENTES = 'CarpetaClientesJuguete00000000001'

/** Drive en memoria: busca por (carpeta, nombre) y devuelve el existente como hace el Apps Script.
 *  viejo = la versión publicada antes del 24/10 (sin copiarArchivo ni aPapeleraCarpeta); la plantilla tiene que llamarse
 *  "Plantilla…" (como exige el puente nuevo). */
function puenteDeJuguete({ sinCopiar = false, viejo = false, fallar = {} } = {}) {
  const items = new Map()   // id → { id, padre, nombre, tipo, bloques?, copiaDe? }
  const llamadas = []
  let n = 0
  const nuevoId = () => `IdDeJuguete${String(++n).padStart(24, '0')}`
  const desconocida = (accion) => new ErrorPuente(`El puente rechazó ${accion}: acción desconocida: ${accion}`, false, 'accion_desconocida')
  items.set(PLANTILLA, { id: PLANTILLA, padre: 'FueraDeClientes0000000000000001', nombre: 'Plantilla Guiones - C.J', tipo: 'doc' })
  items.set(DOC_DE_CLIENTE, { id: DOC_DE_CLIENTE, padre: 'CarpetaDeOtroCliente0000000001', nombre: 'Guiones - RM', tipo: 'doc' })
  const buscar = (padre, nombre, tipo) => [...items.values()].find((x) => x.padre === padre && x.nombre === nombre && x.tipo === tipo && !x.papelera)
  const crear = (padre, nombre, tipo, extra = {}) => {
    const ya = buscar(padre, nombre, tipo)
    if (ya) return { id: ya.id, url: `https://drive.ejemplo/${ya.id}`, yaExistia: true }
    const id = nuevoId()
    items.set(id, { id, padre, nombre, tipo, ...extra })
    return { id, url: `https://drive.ejemplo/${id}`, yaExistia: false }
  }
  const quizasFallar = (accion) => { if (fallar[accion]) throw fallar[accion] }
  const noExiste = (accion) => new ErrorPuente(`El puente rechazó ${accion}: No item with the given ID could be found.`, false)
  return {
    items, llamadas, crear,
    async ping() { llamadas.push(['ping']); quizasFallar('ping'); return { cuenta: 'cuenta@ejemplo.com', version: viejo ? null : '2026-10-24b' } },
    async subirArchivo() { throw new Error('no se usa') },
    async aPapelera(id) {
      llamadas.push(['aPapelera', id]); quizasFallar('aPapelera:' + id)
      const x = items.get(id)
      if (!x) throw noExiste('aPapelera')
      // Como el puente nuevo: solo archivos de "Subidos" o de una carpeta "PRUEBA BOT…"
      if (!viejo && !(x.padre === CARPETA_COMPROBANTES || items.get(x.padre)?.nombre.startsWith(PREFIJO_CARPETA_PRUEBA))) throw new ErrorPuente('El puente rechazó aPapelera: solo se mandan a la papelera archivos de "Subidos" o de una carpeta "PRUEBA BOT…"', false)
      x.papelera = true
    },
    async crearCarpeta({ padreId, nombre }) { llamadas.push(['crearCarpeta', nombre, padreId]); quizasFallar('crearCarpeta:' + nombre); return crear(padreId, nombre, 'carpeta') },
    async crearDoc({ carpetaId, nombre, bloques }) { llamadas.push(['crearDoc', nombre]); quizasFallar('crearDoc'); return crear(carpetaId, nombre, 'doc', { bloques }) },
    async copiarArchivo({ archivoId, carpetaId, nombre }) {
      llamadas.push(['copiarArchivo', nombre])
      if (sinCopiar || viejo) throw desconocida('copiarArchivo')
      quizasFallar('copiarArchivo')
      if (!archivoId || !carpetaId || !nombre) throw new ErrorPuente('El puente rechazó copiarArchivo: faltan archivoId, carpetaId o nombre', false)
      const origen = items.get(archivoId)
      if (!origen) throw noExiste('copiarArchivo')
      if (!origen.nombre.startsWith(PREFIJO_PLANTILLA)) throw new ErrorPuente('El puente rechazó copiarArchivo: solo se copian plantillas (el nombre del archivo tiene que empezar con "Plantilla")', false, 'no_es_plantilla')
      return crear(carpetaId, nombre, 'doc', { copiaDe: archivoId })
    },
    async aPapeleraCarpeta(id) {
      llamadas.push(['aPapeleraCarpeta', id])
      if (viejo) throw desconocida('aPapeleraCarpeta')
      quizasFallar('aPapeleraCarpeta:' + id)
      const x = items.get(id)
      if (!x) throw noExiste('aPapeleraCarpeta')
      if (!x.nombre.startsWith(PREFIJO_CARPETA_PRUEBA)) throw new ErrorPuente('El puente rechazó aPapeleraCarpeta: solo se mandan a la papelera carpetas de prueba', false)
      x.papelera = true
      for (const h of items.values()) if (h.padre === id) h.papelera = true
    },
  }
}
/** La cuenta de servicio de juguete: hijos fuera de la papelera (como la consulta de drive/v3). */
const lectorDe = (p) => async (carpetaId, nombre) => [...p.items.values()]
  .filter((x) => x.padre === carpetaId && !x.papelera && (!nombre || x.nombre === nombre))
  .map((x) => ({ id: x.id, name: x.nombre, mimeType: x.tipo === 'carpeta' ? 'application/vnd.google-apps.folder' : 'application/vnd.google-apps.document' }))
const real = (puente, extra = {}) => ({ modo: 'real', plantillaGuionesId: PLANTILLA, carpetaClientesId: CLIENTES, deps: { puente: () => puente }, ...extra })

test('simulación: no llama al puente y devuelve las llamadas que haría', async () => {
  const r = await prepararDriveCliente(ALTA, { modo: 'simulacion', plantillaGuionesId: PLANTILLA, deps: { puente: () => { throw new Error('no tenía que llamar al puente') } } })
  assert.equal(r.ok, true)
  assert.equal(r.completo, true)
  for (const k of ['carpeta', 'crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(r[k].estado, 'simulado', k)
  assert.deepEqual(r.llamadas.map((l) => [l.accion, l.datos.nombre]), [
    ['crearCarpeta', 'Claudia Roldan - C.J'],
    ['crearCarpeta', 'Crudos - ClaudiaR'],
    ['crearCarpeta', 'Editados - ClaudiaR'],
    ['crearCarpeta', 'Marca - ClaudiaR'],
    ['copiarArchivo', 'Guiones - ClaudiaR'],
    ['crearDoc', 'Bienvenida - Claudia Roldan'],
  ])
  assert.equal(r.llamadas[0].datos.padreId, CARPETA_CLIENTES_DRIVE)
  assert.equal(r.llamadas[4].datos.archivoId, PLANTILLA)
  assert.deepEqual(r.llamadas[5].datos.bloques, armarBienvenida(ALTA).bloquesDoc)
})

test('real: crea todo adentro de la carpeta del cliente; la segunda vez reutiliza (idempotente)', async () => {
  const p = puenteDeJuguete()
  const r1 = await prepararDriveCliente(ALTA, real(p))
  assert.equal(r1.ok, true)
  assert.equal(r1.completo, true)
  for (const k of ['carpeta', 'crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(r1[k].estado, 'creado', k)
  const carpeta = p.items.get(r1.carpeta.id)
  assert.equal(carpeta.padre, CLIENTES)
  assert.equal(carpeta.nombre, 'Claudia Roldan - C.J')
  for (const k of ['crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(p.items.get(r1[k].id).padre, r1.carpeta.id, k)
  assert.equal(p.items.get(r1.guiones.id).copiaDe, PLANTILLA)
  assert.deepEqual(p.items.get(r1.bienvenida.id).bloques, armarBienvenida(ALTA).bloquesDoc)
  assert.equal(r1.llamadas.length, 6)

  assert.equal(r1.esperaOk, null)
  for (const k of ['carpeta', 'crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.deepEqual(r1.guardar[k], { id: r1[k].id, url: r1[k].url }, k)

  // Reintento con los ids guardados en cj_altas: no llama al puente, mismos ids
  const antes = p.llamadas.length
  const r2 = await prepararDriveCliente(ALTA, real(p, { guardado: r1.guardar }))
  for (const k of ['carpeta', 'crudos', 'editados', 'marca', 'guiones', 'bienvenida']) {
    assert.equal(r2[k].estado, 'existia', k)
    assert.equal(r2[k].id, r1[k].id, k)
  }
  assert.equal(p.llamadas.length, antes, 'con todo guardado no llama al puente')
  assert.deepEqual(r2.llamadas, [])
  assert.deepEqual(r2.guardar, r1.guardar)
  assert.equal(r2.completo, true)
  assert.equal(p.items.size, 6 + 2, 'no duplicó nada (6 del cliente + la plantilla y el doc de otro cliente)')
})

test('primera corrida y la carpeta YA EXISTÍA (homónimo o la armó Aylu): no crea nada adentro y espera el OK', async () => {
  const p = puenteDeJuguete()
  // Otra "Claudia Roldan" con sus guiones adentro
  const ajena = p.crear(CLIENTES, 'Claudia Roldan - C.J', 'carpeta')
  const guionesAjenos = p.crear(ajena.id, 'Guiones - ClaudiaR', 'doc')
  const cuantos = p.items.size
  const r = await prepararDriveCliente(ALTA, real(p))
  assert.equal(r.esperaOk, 'carpeta_existente')
  assert.equal(r.ok, true)
  assert.equal(r.completo, false)
  assert.equal(r.carpeta.estado, 'pendiente')
  assert.equal(r.carpeta.motivo, MOTIVO_CARPETA_EXISTENTE)
  assert.equal(r.carpeta.id, ajena.id, 'muestra cuál es, para revisarla')
  for (const k of ['crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(r[k].estado, 'pendiente', k)
  assert.equal(r.guiones.id, null, 'no devuelve los guiones del otro cliente')
  assert.equal(p.items.size, cuantos, 'no creó nada adentro')
  assert.deepEqual(r.llamadas.map((l) => l.accion), ['crearCarpeta'])
  assert.equal(r.guardar.carpeta, undefined, 'la carpeta ajena no se guarda hasta el OK')
  assert.ok(r.pendientes.some((x) => x.includes('Ya había una carpeta "Claudia Roldan - C.J"') && x.includes('responder OK')))

  // Con el OK (era la de este cliente, armada a mano): sigue en esa carpeta y reutiliza lo que ya tenía
  const guardado = aprobarCarpetaExistente(r)
  assert.deepEqual(guardado.carpeta, { id: ajena.id, url: ajena.url })
  const r2 = await prepararDriveCliente(ALTA, real(p, { guardado }))
  assert.equal(r2.esperaOk, null)
  assert.equal(r2.ok, true)
  assert.equal(r2.carpeta.id, ajena.id)
  assert.equal(r2.guiones.estado, 'existia')
  assert.equal(r2.guiones.id, guionesAjenos.id)
  for (const k of ['crudos', 'editados', 'marca', 'bienvenida']) {
    assert.equal(r2[k].estado, 'creado', k)
    assert.equal(p.items.get(r2[k].id).padre, ajena.id, k)
  }
  assert.ok(!r2.llamadas.some((l) => l.datos.padreId === CLIENTES), 'no vuelve a buscar en Clientes')
  assert.equal(aprobarCarpetaExistente(r2), null)

  // Si es de OTRO cliente: se responde con otro nombre y se arma una carpeta nueva
  const r3 = await prepararDriveCliente(ALTA, real(puenteDeJuguete(), { nombreConfirmado: 'Claudia Roldan Rosario' }))
  assert.equal(r3.carpeta.nombre, 'Claudia Roldan Rosario - C.J')
  assert.equal(r3.carpeta.estado, 'creado')
})

test('reintento: con la carpeta guardada no busca por nombre en Clientes; pide solo lo que falta', async () => {
  const p = puenteDeJuguete()
  const mia = p.crear(CLIENTES, 'Claudia Roldan - C.J', 'carpeta')
  const crudos = p.crear(mia.id, 'Crudos - ClaudiaR', 'carpeta')
  const r = await prepararDriveCliente(ALTA, real(p, { guardado: { carpeta: { id: mia.id, url: mia.url }, crudos: { id: crudos.id, url: crudos.url }, editados: { id: 'roto', url: 'x' } } }))
  assert.equal(r.ok, true)
  assert.equal(r.completo, true)
  assert.equal(r.carpeta.estado, 'existia')
  assert.equal(r.crudos.estado, 'existia')
  assert.deepEqual(r.llamadas.map((l) => [l.accion, l.datos.nombre]), [
    ['crearCarpeta', 'Editados - ClaudiaR'],   // el id guardado roto se ignora y se vuelve a pedir
    ['crearCarpeta', 'Marca - ClaudiaR'],      // un alta guardada antes del 26/10 no tiene 'marca': se crea adentro
    ['copiarArchivo', 'Guiones - ClaudiaR'],
    ['crearDoc', 'Bienvenida - Claudia Roldan'],
  ])
  assert.ok(r.llamadas.every((l) => (l.datos.padreId ?? l.datos.carpetaId) === mia.id))
  for (const k of ['carpeta', 'crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.ok(r.guardar[k]?.id, k)
})

test('nombre dudoso ("Juan Pérez y Ana Gómez"): no llama al puente; con el nombre confirmado, sí', async () => {
  const conSocios = { ...ALTA, nombre: 'Juan Pérez y Ana Gómez' }
  const r = await prepararDriveCliente(conSocios, { modo: 'real', plantillaGuionesId: PLANTILLA, carpetaClientesId: CLIENTES, deps: { puente: () => { throw new Error('no tenía que llamar') } } })
  assert.equal(r.esperaOk, 'nombre_dudoso')
  assert.equal(r.ok, true)
  assert.equal(r.completo, false)
  assert.deepEqual(r.llamadas, [])
  assert.ok(r.pendientes[0].includes('"Juan Pérez y Ana Gómez"') && r.pendientes[0].includes('Verificaciones C.J') && r.pendientes[0].includes('Guiones - JuanG'))
  const s = await prepararDriveCliente(conSocios, { modo: 'simulacion', plantillaGuionesId: PLANTILLA })
  assert.equal(s.esperaOk, 'nombre_dudoso')
  assert.deepEqual(s.llamadas, [])

  const p = puenteDeJuguete()
  const r2 = await prepararDriveCliente(conSocios, real(p, { nombreConfirmado: 'Juan Pérez' }))
  assert.equal(r2.esperaOk, null)
  assert.equal(r2.carpeta.nombre, 'Juan Pérez - C.J')
  assert.equal(r2.guiones.nombre, 'Guiones - JuanP')
  assert.equal(r2.bienvenida.nombre, 'Bienvenida - Juan Pérez')
  assert.equal(p.items.get(r2.bienvenida.id).bloques[1].texto.startsWith('Juan, esta carpeta'), true)
})

test('la plantilla tiene que llamarse "Plantilla…": el "Guiones - X" de un cliente no se copia', async () => {
  const p = puenteDeJuguete()
  const r = await prepararDriveCliente(ALTA, real(p, { plantillaGuionesId: DOC_DE_CLIENTE }))
  assert.equal(r.guiones.estado, 'pendiente')
  assert.equal(r.guiones.motivo, PENDIENTE_NO_ES_PLANTILLA)
  assert.ok(r.pendientes.some((x) => x.includes(PENDIENTE_NO_ES_PLANTILLA)))
  assert.ok(![...p.items.values()].some((x) => x.copiaDe === DOC_DE_CLIENTE))
  assert.equal(r.ok, true)
})

test('no hay plantilla por defecto: sale de PLANTILLA_GUIONES_ID y, sin ella, los guiones quedan pendientes', async () => {
  const antes = process.env[VARIABLE_PLANTILLA_GUIONES]
  try {
    delete process.env[VARIABLE_PLANTILLA_GUIONES]
    assert.equal(plantillaGuionesDesdeEntorno(), null)
    const r = await prepararDriveCliente(ALTA, real(puenteDeJuguete(), { plantillaGuionesId: plantillaGuionesDesdeEntorno() }))
    assert.equal(r.guiones.motivo, PENDIENTE_PLANTILLA)
    process.env[VARIABLE_PLANTILLA_GUIONES] = `  ${PLANTILLA} `
    assert.equal(plantillaGuionesDesdeEntorno(), PLANTILLA)
  } finally {
    if (antes === undefined) delete process.env[VARIABLE_PLANTILLA_GUIONES]; else process.env[VARIABLE_PLANTILLA_GUIONES] = antes
  }
  const fuente = readFileSync(new URL('../lib/bot/alta/driveCliente.ts', import.meta.url), 'utf8')
  assert.ok(!fuente.includes('fixture-google-id-000000000000000000000017'), 'el "Guiones - RM" de un cliente no puede quedar como plantilla en el código')
})

test('simulación con ids guardados: solo las llamadas que faltan', async () => {
  const g = { carpeta: { id: 'CarpetaGuardada0000000000000001', url: 'https://drive.ejemplo/c' }, guiones: { id: 'GuionesGuardados00000000000001', url: 'https://drive.ejemplo/g' } }
  const r = await prepararDriveCliente(ALTA, { modo: 'simulacion', plantillaGuionesId: PLANTILLA, guardado: g })
  assert.deepEqual(r.llamadas.map((l) => [l.accion, l.datos.nombre]), [['crearCarpeta', 'Crudos - ClaudiaR'], ['crearCarpeta', 'Editados - ClaudiaR'], ['crearCarpeta', 'Marca - ClaudiaR'], ['crearDoc', 'Bienvenida - Claudia Roldan']])
  assert.ok(r.llamadas.every((l) => (l.datos.padreId ?? l.datos.carpetaId) === g.carpeta.id))
  assert.equal(r.carpeta.estado, 'existia')
  assert.equal(r.guiones.estado, 'existia')
})

test('puente sin copiarArchivo (versión vieja): guiones pendientes y el resto se crea igual', async () => {
  const p = puenteDeJuguete({ sinCopiar: true })
  const r = await prepararDriveCliente(ALTA, real(p))
  assert.equal(r.ok, true)
  assert.equal(r.completo, false)
  assert.equal(r.guiones.estado, 'pendiente')
  assert.equal(r.guiones.motivo, PENDIENTE_COPIAR)
  assert.ok(r.pendientes.some((x) => x.startsWith('Guiones - ClaudiaR: ') && x.includes('copiar la plantilla a mano')))
  for (const k of ['carpeta', 'crudos', 'editados', 'bienvenida']) assert.equal(r[k].estado, 'creado', k)
  assert.deepEqual(r.errores, [])
})

test('sin plantilla: no llama a copiarArchivo y lo deja pendiente', async () => {
  const p = puenteDeJuguete()
  const r = await prepararDriveCliente(ALTA, real(p, { plantillaGuionesId: null }))
  assert.equal(r.guiones.estado, 'pendiente')
  assert.equal(r.guiones.motivo, PENDIENTE_PLANTILLA)
  assert.ok(!p.llamadas.some(([a]) => a === 'copiarArchivo'))
  assert.equal(r.ok, true)
  assert.equal(r.completo, false)
  const r2 = await prepararDriveCliente(ALTA, real(puenteDeJuguete(), { plantillaGuionesId: 'no es un id' }))
  assert.equal(r2.guiones.estado, 'pendiente')
  assert.match(r2.guiones.motivo, /no es un id de Drive válido/)
})

test('si falla la carpeta del cliente, no sigue (lo demás queda pendiente)', async () => {
  const p = puenteDeJuguete({ fallar: { 'crearCarpeta:Claudia Roldan - C.J': new ErrorPuente('El puente rechazó crearCarpeta: Access denied', false) } })
  const r = await prepararDriveCliente(ALTA, real(p))
  assert.equal(r.ok, false)
  assert.equal(r.carpeta.estado, 'error')
  for (const k of ['crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(r[k].estado, 'pendiente', k)
  assert.deepEqual(p.llamadas, [['crearCarpeta', 'Claudia Roldan - C.J', CLIENTES]])
})

test('si falla un elemento de adentro, los otros se hacen igual y queda el error', async () => {
  const p = puenteDeJuguete({ fallar: { crearDoc: new ErrorPuente('El puente no respondió (crearDoc): TimeoutError', null) } })
  const r = await prepararDriveCliente(ALTA, real(p))
  assert.equal(r.ok, false)
  assert.equal(r.bienvenida.estado, 'error')
  assert.match(r.errores.join(' '), /crearDoc/)
  for (const k of ['carpeta', 'crudos', 'editados', 'guiones']) assert.equal(r[k].estado, 'creado', k)
  // Al reintentar (el puente ya responde), lo que estaba se reutiliza y se crea solo el doc
  const fallo = p.crearDoc
  p.crearDoc = async (x) => { p.llamadas.push(['crearDoc', x.nombre]); return { id: 'IdDelDocReintento00000000000001', url: 'https://drive.ejemplo/d', yaExistia: false } }
  assert.equal(r.guardar.bienvenida, undefined, 'lo que falló no se guarda')
  const r2 = await prepararDriveCliente(ALTA, real(p, { guardado: r.guardar }))
  p.crearDoc = fallo
  assert.equal(r2.ok, true)
  assert.equal(r2.bienvenida.estado, 'creado')
  assert.deepEqual(r2.llamadas.map((l) => l.accion), ['crearDoc'])
  for (const k of ['carpeta', 'crudos', 'editados', 'guiones']) {
    assert.equal(r2[k].estado, 'existia', k)
    assert.equal(r2[k].id, r[k].id, k)
  }
})

test('sin nombre en el #ALTA: no llama al puente', async () => {
  const sinNombre = { ...ALTA, nombre: null }
  const r = await prepararDriveCliente(sinNombre, { modo: 'real', plantillaGuionesId: PLANTILLA, deps: { puente: () => { throw new Error('no tenía que llamar') } } })
  assert.equal(r.ok, false)
  assert.equal(r.nombres, null)
  assert.match(r.errores[0], /Falta el nombre/)
  assert.deepEqual(r.llamadas, [])
})

test('sin las variables del puente: error, sin excepción', async () => {
  const antes = { url: process.env.PUENTE_DRIVE_URL, secreto: process.env.PUENTE_DRIVE_SECRETO }
  delete process.env.PUENTE_DRIVE_URL
  delete process.env.PUENTE_DRIVE_SECRETO
  try {
    const r = await prepararDriveCliente(ALTA, { modo: 'real', plantillaGuionesId: PLANTILLA })
    assert.equal(r.ok, false)
    assert.match(r.errores[0], /PUENTE_DRIVE_URL/)
  } finally {
    if (antes.url !== undefined) process.env.PUENTE_DRIVE_URL = antes.url
    if (antes.secreto !== undefined) process.env.PUENTE_DRIVE_SECRETO = antes.secreto
  }
})

// ── Cliente real del puente, con fetch de juguete ──────────────────────────────────────────────────────────────
test('puenteDriveReal: "acción desconocida" → ErrorPuente con codigo accion_desconocida; ids inválidos no salen', async () => {
  const antes = { url: process.env.PUENTE_DRIVE_URL, secreto: process.env.PUENTE_DRIVE_SECRETO, fetch: globalThis.fetch }
  process.env.PUENTE_DRIVE_URL = 'https://puente.ejemplo.invalid/exec'
  process.env.PUENTE_DRIVE_SECRETO = 'secreto-de-juguete'
  const pedidos = []
  globalThis.fetch = async (_url, init) => {
    const cuerpo = JSON.parse(init.body)
    pedidos.push(cuerpo)
    if (cuerpo.accion === 'copiarArchivo' && cuerpo.nombre === 'Guiones - X') return new Response(JSON.stringify({ ok: false, error: 'acción desconocida: copiarArchivo' }), { status: 200 })
    if (cuerpo.accion === 'copiarArchivo') return new Response(JSON.stringify({ ok: false, error: 'solo se copian plantillas (el nombre del archivo tiene que empezar con "Plantilla")' }), { status: 200 })
    if (cuerpo.accion === 'ping') return new Response(JSON.stringify({ ok: true, cuenta: 'cuenta@ejemplo.com', version: '2026-10-24b' }), { status: 200 })
    if (cuerpo.accion === 'crearCarpeta') return new Response(JSON.stringify({ ok: true, id: 'IdDeCarpetaDeJuguete000000001', url: 'https://drive.ejemplo/c', yaExistia: true }), { status: 200 })
    return new Response(JSON.stringify({ ok: false, error: 'Access denied' }), { status: 200 })
  }
  try {
    const p = puenteDriveReal()
    await assert.rejects(p.copiarArchivo({ archivoId: PLANTILLA, carpetaId: CLIENTES, nombre: 'Guiones - X' }), (e) => {
      assert.ok(e instanceof ErrorPuente)
      assert.equal(e.codigo, 'accion_desconocida')
      assert.equal(esAccionDesconocida(e), true)
      assert.ok(!e.message.includes('secreto-de-juguete') && !e.message.includes('puente.ejemplo'))
      return true
    })
    await assert.rejects(p.aPapeleraCarpeta(CLIENTES), (e) => e instanceof ErrorPuente && e.codigo === null && esAccionDesconocida(e) === false)
    await assert.rejects(p.copiarArchivo({ archivoId: PLANTILLA, carpetaId: CLIENTES, nombre: 'Guiones - Y' }), (e) => e instanceof ErrorPuente && e.codigo === 'no_es_plantilla')
    assert.deepEqual(await p.ping(), { cuenta: 'cuenta@ejemplo.com', version: '2026-10-24b' })
    assert.deepEqual(await p.crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' }), { id: 'IdDeCarpetaDeJuguete000000001', url: 'https://drive.ejemplo/c', yaExistia: true })
    const n = pedidos.length
    await assert.rejects(p.aPapeleraCarpeta('../../no'), /Id de Drive inválido/)
    await assert.rejects(p.copiarArchivo({ archivoId: 'x', carpetaId: CLIENTES, nombre: 'G' }), /Id de Drive inválido/)
    assert.equal(pedidos.length, n, 'con un id inválido no se llama al puente')
    assert.ok(pedidos.every((x) => x.secreto === 'secreto-de-juguete'))
  } finally {
    globalThis.fetch = antes.fetch
    if (antes.url !== undefined) process.env.PUENTE_DRIVE_URL = antes.url; else delete process.env.PUENTE_DRIVE_URL
    if (antes.secreto !== undefined) process.env.PUENTE_DRIVE_SECRETO = antes.secreto; else delete process.env.PUENTE_DRIVE_SECRETO
  }
})

// ── Prueba real (lib/bot/alta/drivePrueba.ts) con el puente de juguete ─────────────────────────────────────────────
const NOMBRES_PRUEBA = nombresDriveCliente('PRUEBA BOT - borrar')
const ALTA_PRUEBA = { ...ALTA, nombre: 'PRUEBA BOT - borrar' }
const ctxPrueba = { alta: ALTA_PRUEBA, nombres: NOMBRES_PRUEBA, plantillaGuionesId: PLANTILLA, carpetaClientesId: CLIENTES }
const depsPrueba = (p, extra = {}) => { const lineas = []; return { lineas, deps: { puente: p, leerHijos: lectorDe(p), log: (l) => lineas.push(l), ...extra } } }
const fuera = (p) => [...p.items.values()].filter((x) => !x.papelera && x.id !== PLANTILLA && x.id !== DOC_DE_CLIENTE)

test('sondeo: el puente nuevo pasa sin cambiar nada; el viejo o sin secreto, no', async () => {
  const p = puenteDeJuguete()
  const cuantos = p.items.size
  const s = await sondearPuente(p)
  assert.deepEqual(s, { ok: true, cuenta: 'cuenta@ejemplo.com', version: '2026-10-24b', motivo: null })
  assert.equal(p.items.size, cuantos, 'el sondeo no crea nada')
  assert.ok(p.llamadas.some(([a, id]) => a === 'aPapeleraCarpeta' && id === ID_INEXISTENTE))

  const v = await sondearPuente(puenteDeJuguete({ viejo: true }))
  assert.equal(v.ok, false)
  assert.match(v.motivo, /no tiene copiarArchivo ni aPapeleraCarpeta/)
  assert.match(v.motivo, /No se creó nada/)

  const sinSecreto = await sondearPuente(puenteDeJuguete({ fallar: { ping: new ErrorPuente('El puente rechazó ping: no autorizado', false) } }))
  assert.equal(sinSecreto.ok, false)
  assert.match(sinSecreto.motivo, /propiedad SECRETO/)

  const sinRed = puenteDeJuguete()
  sinRed.aPapeleraCarpeta = async () => { throw new ErrorPuente('El puente no respondió (aPapeleraCarpeta): TimeoutError', null) }
  const r = await sondearPuente(sinRed)
  assert.equal(r.ok, false)
  assert.match(r.motivo, /No se pudo confirmar aPapeleraCarpeta/)
})

test('verificación de la prueba: reintento con ids, freno de homónimos y lectura con la cuenta de servicio', async () => {
  const p = puenteDeJuguete()
  const res = await prepararDriveCliente(ALTA_PRUEBA, real(p))
  assert.equal(res.completo, true)
  const { deps } = depsPrueba(p)
  const { controles, corridas } = await verificarPruebaDrive(ctxPrueba, res, deps)
  assert.equal(corridas.length, 2)
  assert.deepEqual(controles.filter((c) => !c.ok), [])
  assert.ok(controles.some((c) => c.que.includes('espera el OK')))
  assert.ok(controles.filter((c) => c.que.includes('cuenta de servicio')).length >= 5)
})

test('limpieza: manda a la papelera la carpeta de prueba con todo lo de adentro y nada más', async () => {
  const p = puenteDeJuguete()
  const res = await prepararDriveCliente(ALTA_PRUEBA, real(p))
  const { deps, lineas } = depsPrueba(p)
  const r = await limpiarPruebaDrive({ nombres: NOMBRES_PRUEBA, carpetaClientesId: CLIENTES, resultados: [res] }, deps)
  assert.equal(r.ok, true, lineas.join('\n'))
  assert.deepEqual(fuera(p), [])
  assert.equal(p.items.get(DOC_DE_CLIENTE).papelera, undefined)
  assert.equal(p.llamadas.filter(([a]) => a === 'aPapelera').length, 2, 'los dos docs, que están adentro')
})

test('limpieza: un doc que NO está adentro de la carpeta de prueba no se manda a la papelera por su id', async () => {
  const p = puenteDeJuguete()
  const res = await prepararDriveCliente(ALTA_PRUEBA, real(p))
  // Un resultado con un id ajeno (por ejemplo, el "Guiones - X" de un cliente)
  const trucho = { ...res, guiones: { ...res.guiones, id: DOC_DE_CLIENTE } }
  const { deps, lineas } = depsPrueba(p)
  const r = await limpiarPruebaDrive({ nombres: NOMBRES_PRUEBA, carpetaClientesId: CLIENTES, resultados: [trucho] }, deps)
  assert.equal(r.ok, true)
  assert.ok(!p.llamadas.some(([a, id]) => a === 'aPapelera' && id === DOC_DE_CLIENTE))
  assert.equal(p.items.get(DOC_DE_CLIENTE).papelera, undefined)
  assert.ok(lineas.some((l) => l.includes('no aparece adentro')))
  assert.deepEqual(fuera(p), [])   // la copia real de los guiones se fue con la carpeta
})

test('limpieza: si falla a mitad de camino sigue con lo demás y avisa', async () => {
  const p = puenteDeJuguete()
  const res = await prepararDriveCliente(ALTA_PRUEBA, real(p))
  p.aPapelera = async () => { throw new ErrorPuente('El puente no respondió (aPapelera): TimeoutError', null) }
  const { deps, lineas } = depsPrueba(p)
  const r = await limpiarPruebaDrive({ nombres: NOMBRES_PRUEBA, carpetaClientesId: CLIENTES, resultados: [res] }, deps)
  assert.equal(r.ok, false)
  assert.ok(lineas.some((l) => l.startsWith('  [MAL]') && l.includes('Guiones - PRUEBAB')))
  assert.deepEqual(fuera(p), [], 'la carpeta se mandó igual (con los docs adentro)')
})

test('limpieza con el puente viejo: avisa que la carpeta quedó CON lo de adentro (no vacía)', async () => {
  const p = puenteDeJuguete()
  const res = await prepararDriveCliente(ALTA_PRUEBA, real(p))
  // Puente publicado antes del 24/10: no conoce aPapeleraCarpeta
  const viejo = { ...p, aPapeleraCarpeta: async () => { throw new ErrorPuente('El puente rechazó aPapeleraCarpeta: acción desconocida: aPapeleraCarpeta', false, 'accion_desconocida') } }
  const { deps, lineas } = depsPrueba(p, { puente: viejo })
  const r = await limpiarPruebaDrive({ nombres: NOMBRES_PRUEBA, carpetaClientesId: CLIENTES, resultados: [res] }, deps)
  assert.equal(r.ok, false)
  assert.ok(lineas.some((l) => l.includes('no tiene aPapeleraCarpeta') && l.includes('CON lo de adentro')))
  assert.ok(lineas.some((l) => l.includes('Todavía hay 1 carpeta')))
})

test('limpieza: más de una carpeta de prueba (y una corrida que falló sin devolver el id) → todas a la papelera', async () => {
  const p = puenteDeJuguete()
  const a = p.crear(CLIENTES, NOMBRES_PRUEBA.carpeta, 'carpeta')
  // Una segunda con el mismo nombre (una corrida simultánea): el puente de juguete no la duplicaría, se agrega a mano
  p.items.set('CarpetaPruebaDuplicada000000000001', { id: 'CarpetaPruebaDuplicada000000000001', padre: CLIENTES, nombre: NOMBRES_PRUEBA.carpeta, tipo: 'carpeta' })
  p.crear(a.id, NOMBRES_PRUEBA.crudos, 'carpeta')
  const { deps, lineas } = depsPrueba(p)
  const r = await limpiarPruebaDrive({ nombres: NOMBRES_PRUEBA, carpetaClientesId: CLIENTES, resultados: [null] }, deps)
  assert.equal(r.ok, true, lineas.join('\n'))
  assert.ok(lineas.some((l) => l.includes('Hay 2 carpetas')))
  assert.deepEqual(fuera(p), [])
})

test('limpieza: no toca nada si la carpeta no es de prueba; sin cuenta de servicio, la carpeta se lleva los docs', async () => {
  const p = puenteDeJuguete()
  const res = await prepararDriveCliente(ALTA, real(p))
  const { deps } = depsPrueba(p)
  const r = await limpiarPruebaDrive({ nombres: nombresDriveCliente('Claudia Roldan'), carpetaClientesId: CLIENTES, resultados: [res] }, deps)
  assert.equal(r.ok, false)
  assert.ok(!p.llamadas.some(([x]) => x === 'aPapelera' || x === 'aPapeleraCarpeta'))

  const q = puenteDeJuguete()
  const resQ = await prepararDriveCliente(ALTA_PRUEBA, real(q))
  const { deps: sinLector, lineas } = depsPrueba(q, { leerHijos: async () => null })
  const r2 = await limpiarPruebaDrive({ nombres: NOMBRES_PRUEBA, carpetaClientesId: CLIENTES, resultados: [resQ] }, sinLector)
  assert.equal(r2.ok, true)
  assert.ok(!q.llamadas.some(([x]) => x === 'aPapelera'))
  assert.ok(lineas.some((l) => l.includes('se van a la papelera con la carpeta')))
  assert.deepEqual(fuera(q), [])
})

// ── Reintentos del puente: puenteDriveReal entero con un Apps Script de juguete detrás del fetch ────────────────────
const T0 = Date.parse('2026-10-24T15:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const DIA = 86_400_000
/** Reloj de juguete: cada pedido al puente "tarda" lo que diga el Apps Script de juguete y las esperas entre intentos
 *  lo adelantan (sin esperar de verdad). */
function relojDeJuguete(t = T0) {
  const r = { t, esperas: [], ahora: () => r.t, avanzar: (ms) => { r.t += ms }, esperar: async (ms) => { r.esperas.push(ms); r.t += ms } }
  return r
}
/** Apps Script de juguete DETRÁS del fetch: imita doPost de Codigo.gs sobre un Drive en memoria (busca por nombre fuera de
 *  la papelera y devuelve el existente con yaExistia; cada elemento guarda su createdTime con el reloj de juguete).
 *  `fallas`: cada una se usa una vez, en orden, en el primer pedido de esa acción (y ese nombre, si lo dice):
 *    '500'           Google responde 500 sin correr el script (tramo del POST)
 *    '500-despues'   el script corre (crea o encuentra) y Google responde 500 (tramo del GET del 302)
 *    '404-despues'   el script corre y el GET del 302 responde 404 (Response.redirected = true)
 *    'timeout'       el script corre y la respuesta no llega: corte por tiempo (cuando lo diga la señal del intento)
 *    'timeout-antes' corte por tiempo sin que el script corra (ídem)
 *    'red'           error de red · 'html' 200 con HTML (no es JSON)
 *    'drive'         { ok: false, error: 'Service error: Drive' } · 'rechazo' { ok: false, error: 'Access denied' }
 *    '403' / '429'   HTTP 4xx en el POST (sin redirección)
 *  `tarda`: cuánto dura ese pedido en el reloj (por defecto 1 s). Como el fetch real, el pedido respeta la señal del
 *  intento (senalDeJuguete trae sus ms): si tardaría más, se corta ahí con TimeoutError (y el script corre si la falla es
 *  de las que corren). */
function appsScriptDeJuguete(reloj, fallas = []) {
  const items = new Map()   // id → { id, padre, nombre, tipo, creada, papelera?, copiaDe? }
  const pedidos = []
  let n = 0
  const nuevoId = () => `IdAppsScript${String(++n).padStart(22, '0')}`
  items.set(PLANTILLA, { id: PLANTILLA, padre: 'FueraDeClientes0000000000000001', nombre: 'Plantilla Guiones - C.J', tipo: 'doc', creada: iso(T0 - 30 * DIA) })
  const buscar = (padre, nombre, tipo) => [...items.values()].find((x) => x.padre === padre && x.nombre === nombre && x.tipo === tipo && !x.papelera)
  const crear = (padre, nombre, tipo, extra = {}) => {
    const ya = buscar(padre, nombre, tipo)
    if (ya) return { ok: true, id: ya.id, url: `https://drive.ejemplo/${ya.id}`, yaExistia: true }
    const id = nuevoId()
    items.set(id, { id, padre, nombre, tipo, creada: iso(reloj.ahora()), ...extra })
    return { ok: true, id, url: `https://drive.ejemplo/${id}`, yaExistia: false }
  }
  const noExiste = { ok: false, error: 'No item with the given ID could be found.' }
  const correr = (p) => {
    switch (p.accion) {
      case 'ping': return { ok: true, cuenta: 'cuenta@ejemplo.com', version: '2026-10-24b' }
      case 'crearCarpeta': return crear(p.padreId, p.nombre, 'carpeta')
      case 'crearDoc': return crear(p.carpetaId, p.nombre, 'doc')
      case 'copiarArchivo': {
        if (!p.archivoId || !p.carpetaId || !p.nombre) return { ok: false, error: 'faltan archivoId, carpetaId o nombre' }
        const origen = items.get(p.archivoId)
        if (!origen) return noExiste
        if (!origen.nombre.startsWith(PREFIJO_PLANTILLA)) return { ok: false, error: 'solo se copian plantillas (el nombre del archivo tiene que empezar con "Plantilla")' }
        return crear(p.carpetaId, p.nombre, 'doc', { copiaDe: p.archivoId })
      }
      case 'aPapelera': case 'aPapeleraCarpeta': {
        const x = items.get(p.id)
        if (!x) return noExiste
        x.papelera = true
        return { ok: true }
      }
      default: return { ok: false, error: `acción desconocida: ${p.accion}` }
    }
  }
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status })
  const html = (status) => new Response(`<html><body>Error ${status}</body></html>`, { status })
  const corte = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  const senales = []   // los ms de la señal de cada pedido (el corte de cada intento)
  async function fetchDeJuguete(_url, init) {
    const p = JSON.parse(init.body)
    pedidos.push(p)
    const ms = init.signal?.msDeJuguete
    senales.push(ms)
    const i = fallas.findIndex((f) => f.accion === p.accion && (!f.nombre || f.nombre === p.nombre))
    const f = i >= 0 ? fallas.splice(i, 1)[0] : null
    const colgado = f?.tipo === 'timeout' || f?.tipo === 'timeout-antes'
    const dura = f?.tarda ?? (colgado ? Infinity : 1_000)
    if (dura > (ms ?? 90_000)) {
      reloj.avanzar(ms ?? 90_000)
      if (!f || f.tipo === 'timeout' || f.tipo === '500-despues' || f.tipo === '404-despues') correr(p)
      throw corte()
    }
    reloj.avanzar(dura)
    switch (f?.tipo) {
      case '500': return html(500)
      case '403': return html(403)
      case '429': return html(429)
      case 'red': throw new TypeError('fetch failed')
      case 'timeout-antes': throw corte()
      case 'drive': return json({ ok: false, error: 'Service error: Drive' })
      case 'rechazo': return json({ ok: false, error: 'Access denied' })
      case 'html': return html(200)
    }
    const respuesta = correr(p)
    if (f?.tipo === '500-despues') return html(500)
    if (f?.tipo === '404-despues') return Object.defineProperty(html(404), 'redirected', { value: true })
    if (f?.tipo === 'timeout') throw corte()
    return json(respuesta)
  }
  /** La cuenta de servicio de juguete: files.get por id (createdTime, parents, trashed); un id que no existe da 404. */
  const leerCarpeta = async (id) => {
    const x = items.get(id)
    if (!x) throw new Error('Google respondió 404')
    return { creada: x.creada, padres: [x.padre], papelera: !!x.papelera }
  }
  const enClientes = (nombre) => [...items.values()].filter((x) => x.padre === CLIENTES && x.nombre === nombre && !x.papelera)
  const adentro = (id) => [...items.values()].filter((x) => x.padre === id && !x.papelera)
  return { items, pedidos, senales, fallas, crear, fetch: fetchDeJuguete, leerCarpeta, enClientes, adentro }
}

/** Corre `fn` con puenteDriveReal apuntando al Apps Script de juguete (variables y fetch de juguete, que se restauran). */
async function conAppsScript(script, fn) {
  const antes = { url: process.env.PUENTE_DRIVE_URL, secreto: process.env.PUENTE_DRIVE_SECRETO, fetch: globalThis.fetch }
  process.env.PUENTE_DRIVE_URL = 'https://puente.ejemplo.invalid/exec'
  process.env.PUENTE_DRIVE_SECRETO = 'secreto-de-juguete'
  globalThis.fetch = script.fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = antes.fetch
    if (antes.url !== undefined) process.env.PUENTE_DRIVE_URL = antes.url; else delete process.env.PUENTE_DRIVE_URL
    if (antes.secreto !== undefined) process.env.PUENTE_DRIVE_SECRETO = antes.secreto; else delete process.env.PUENTE_DRIVE_SECRETO
  }
}
/** La señal de cada intento, con sus ms a la vista del Apps Script de juguete (que corta ahí, como el fetch real). */
const senalDeJuguete = (ms) => Object.assign(new AbortController().signal, { msDeJuguete: ms })
/** El cliente real del puente con el reloj de juguete y sin azar en las esperas. */
const puenteConReloj = (reloj, extra = {}) => puenteDriveReal({ ahora: reloj.ahora, esperar: reloj.esperar, azar: () => 0, senal: senalDeJuguete, ...extra })
/** prepararDriveCliente en modo real con el cliente real del puente (contra el Apps Script de juguete) y la cuenta de
 *  servicio de juguete. */
const realConScript = (s, reloj, extra = {}) => real(null, { deps: { puente: () => puenteConReloj(reloj), leerCarpeta: s.leerCarpeta }, ...extra })
const CARPETA_CR = 'Claudia Roldan - C.J'
const pedidosDe = (s, accion, nombre) => s.pedidos.filter((p) => p.accion === accion && (!nombre || p.nombre === nombre)).length

test('reintentos: un 500 antes de correr se reintenta a los 3 s y la respuesta buena trae la marca `dudoso`', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', tipo: '500' }])
  await conAppsScript(s, async () => {
    const r = await puenteConReloj(reloj).crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' })
    assert.equal(s.pedidos.length, 2)
    assert.deepEqual(reloj.esperas, [ESPERAS_REINTENTO_MS[0]])
    assert.equal(r.yaExistia, false)
    assert.deepEqual(r.dudoso, { desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false })
    assert.equal(s.enClientes('X - C.J').length, 1)
    // Una llamada que sale bien de una no trae `dudoso` (el test de "acción desconocida" compara el resultado exacto)
    const limpia = await puenteConReloj(reloj).crearCarpeta({ padreId: CLIENTES, nombre: 'Y - C.J' })
    assert.deepEqual(Object.keys(limpia), ['id', 'url', 'yaExistia'])
  })
})

test('reintentos: "creó y después respondió 500" → el reintento devuelve la MISMA carpeta (yaExistia) sin duplicarla', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', tipo: '500-despues' }])
  await conAppsScript(s, async () => {
    const r = await puenteConReloj(reloj).crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' })
    assert.equal(s.pedidos.length, 2)
    assert.equal(r.yaExistia, true, 'la creó el primer intento')
    assert.equal(r.id, s.enClientes('X - C.J')[0].id)
    assert.equal(s.enClientes('X - C.J').length, 1, 'no se duplicó')
    assert.deepEqual(r.dudoso, { desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false })
  })
})

test('reintentos: corte por tiempo (90 s) → crearCarpeta NO se reintenta (el Apps Script puede seguir); ping tampoco: no entra en el tope', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [
    { accion: 'ping', tipo: 'timeout' },
    { accion: 'crearCarpeta', nombre: 'Larga - C.J', tipo: 'timeout' },
  ])
  await conAppsScript(s, async () => {
    const p = puenteConReloj(reloj)
    await assert.rejects(p.ping(), (e) => e.aplicado === null && e.dudoso.puedeSeguir === true && /TimeoutError/.test(e.message))
    assert.equal(pedidosDe(s, 'ping'), 1, 'tras 90 s quedan 100 − 90 − 3 − 5 = 2 s del tope: no hay lugar para otro intento')

    const t = reloj.ahora()
    await assert.rejects(p.crearCarpeta({ padreId: CLIENTES, nombre: 'Larga - C.J' }), (e) => {
      assert.ok(e instanceof ErrorPuente)
      assert.equal(e.aplicado, null)
      assert.deepEqual(e.dudoso, { desde: iso(t), hasta: iso(t + 90_000), puedeSeguir: true })
      assert.match(e.message, /no respondió \(crearCarpeta\): TimeoutError/)
      return true
    })
    assert.equal(pedidosDe(s, 'crearCarpeta', 'Larga - C.J'), 1, 'no se reintenta: un segundo intento en paralelo podría duplicar')
    assert.equal(s.enClientes('Larga - C.J').length, 1, 'el script la creó igual (por eso el error es dudoso)')
    assert.deepEqual(s.senales, [90_000, 90_000], 'cada intento se corta a los 90 s')
  })
})

test('reintentos: nunca ante un rechazo del puente ({ ok: false }) ni un 4xx: un solo pedido y aplicado = false', async () => {
  for (const tipo of ['rechazo', '403', '429']) {
    const reloj = relojDeJuguete()
    const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', tipo }])
    await conAppsScript(s, async () => {
      await assert.rejects(puenteConReloj(reloj).crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' }), (e) => e instanceof ErrorPuente && e.aplicado === false && e.dudoso === null)
      assert.equal(s.pedidos.length, 1, tipo)
      assert.deepEqual(reloj.esperas, [], tipo)
      assert.equal(s.enClientes('X - C.J').length, 0, tipo)
    })
  }
})

test('reintentos: un error pasajero de Drive adentro del script ({ ok: false, "Service error: Drive" }) no se reintenta pero queda dudoso', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', tipo: 'drive' }])
  await conAppsScript(s, async () => {
    await assert.rejects(puenteConReloj(reloj).crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' }), (e) => {
      assert.equal(e.aplicado, null, 'createFolder puede haberla creado igual: no es un "seguro no se hizo"')
      assert.deepEqual(e.dudoso, { desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false })
      assert.match(e.message, /error pasajero de Drive \(crearCarpeta\): Service error: Drive/)
      return true
    })
    assert.equal(s.pedidos.length, 1)
  })
})

test('reintentos: tres fallas seguidas → 3 pedidos (2 reintentos), esperas crecientes y el error dice cuántos; sin URL ni secreto', async () => {
  assert.equal(INTENTOS_PUENTE, 3)
  assert.ok(ESPERAS_REINTENTO_MS[1] > ESPERAS_REINTENTO_MS[0])
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearDoc', tipo: '500' }, { accion: 'crearDoc', tipo: 'red' }, { accion: 'crearDoc', tipo: 'html' }])
  await conAppsScript(s, async () => {
    await assert.rejects(puenteConReloj(reloj, { azar: () => 0.5 }).crearDoc({ carpetaId: CLIENTES, nombre: 'Bienvenida - X', bloques: [] }), (e) => {
      assert.equal(e.aplicado, null)
      assert.match(e.message, /HTTP 200 \(no es JSON\) · 3 intentos$/)
      assert.deepEqual(e.dudoso, { desde: iso(T0), hasta: iso(reloj.ahora()), puedeSeguir: false })
      assert.ok(!e.message.includes('secreto-de-juguete') && !e.message.includes('puente.ejemplo'))
      return true
    })
    assert.equal(s.pedidos.length, 3)
    assert.deepEqual(reloj.esperas, [ESPERAS_REINTENTO_MS[0] + 500, ESPERAS_REINTENTO_MS[1] + 500], 'con un poco de azar')
  })
})

test('reintentos: un error de red o una respuesta que no es JSON se reintentan y la llamada sale bien', async () => {
  for (const tipo of ['red', 'html']) {
    const reloj = relojDeJuguete()
    const s = appsScriptDeJuguete(reloj, [{ accion: 'copiarArchivo', tipo }])
    await conAppsScript(s, async () => {
      const r = await puenteConReloj(reloj).copiarArchivo({ archivoId: PLANTILLA, carpetaId: CLIENTES, nombre: 'Guiones - X' })
      assert.equal(s.pedidos.length, 2, tipo)
      assert.equal([...s.items.values()].filter((x) => x.nombre === 'Guiones - X').length, 1, tipo)
      assert.ok(r.dudoso, tipo)
    })
  }
})

test('reintentos con plazo (hasta): sin tiempo no llama; con poco no reintenta; con margen sí', async () => {
  const casos = [
    { hasta: T0 + 8_000, pedidos: 0 },    // menos de 10 s libres: ni lo intenta (seguro no se hizo)
    { hasta: T0 + 25_000, pedidos: 1 },   // tras el 500 quedarían 25 − 1 − 3 − 5 = 16 s: no reintenta
    { hasta: T0 + 60_000, pedidos: 2 },
  ]
  for (const c of casos) {
    const reloj = relojDeJuguete()
    const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', tipo: '500' }])
    await conAppsScript(s, async () => {
      const intento = puenteConReloj(reloj, { hasta: c.hasta }).crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' })
      if (c.pedidos === 0) await assert.rejects(intento, (e) => e.aplicado === false && /No queda tiempo/.test(e.message))
      else if (c.pedidos === 1) await assert.rejects(intento, (e) => e.aplicado === null)
      else assert.equal((await intento).yaExistia, false)
      assert.equal(s.pedidos.length, c.pedidos, String(c.hasta - T0))
    })
  }
})

test('reintentos: un 500 que tardó más de 25 s se reintenta en aPapelera (repetirla no hace daño) pero no en subirArchivo', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'aPapelera', tipo: '500', tarda: 30_000 }, { accion: 'subirArchivo', tipo: '500-despues', tarda: 30_000 }])
  const { id } = s.crear(CARPETA_COMPROBANTES, 'Comprobante - X.png', 'archivo')
  await conAppsScript(s, async () => {
    const p = puenteConReloj(reloj)
    await p.aPapelera(id)
    assert.equal(pedidosDe(s, 'aPapelera'), 2)
    assert.equal(s.items.get(id).papelera, true)
    await assert.rejects(p.subirArchivo({ carpetaId: CARPETA_COMPROBANTES, nombre: 'Otro.png', mimeType: 'image/png', base64: 'eA==' }), (e) => e.aplicado === null)
    assert.equal(pedidosDe(s, 'subirArchivo'), 1)
  })
})

test('unirDudosos (intentos de una misma llamada): la ventana más amplia de las dos; puedeSeguir si alguno lo dejó', () => {
  const a = { desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false }
  const b = { desde: iso(T0 + 60_000), hasta: iso(T0 + 150_000), puedeSeguir: true }
  assert.deepEqual(unirDudosos(a, b), { desde: a.desde, hasta: b.hasta, puedeSeguir: true })
  assert.deepEqual(unirDudosos(null, a), a)
  assert.deepEqual(unirDudosos(a, undefined), a)
  assert.equal(unirDudosos(null, null), null)
})

test('carpetaDeIntentoDudoso: ventana desde 3 s antes del primer intento hasta 6 min después del último; sin lectura, nunca', async () => {
  const intento = { desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false }
  const leer = (creada, extra = {}) => async () => ({ creada: iso(creada), padres: [CLIENTES], papelera: false, ...extra })
  const ver = (l) => carpetaDeIntentoDudoso('IdCualquieraDeJuguete00000000001', [intento], CLIENTES, l)
  assert.equal((await ver(leer(T0 - TOLERANCIA_RELOJ_MS))).nuestra, true)
  assert.deepEqual(await ver(leer(T0 - TOLERANCIA_RELOJ_MS - 1)), { nuestra: false, cuando: 'antes', creada: iso(T0 - TOLERANCIA_RELOJ_MS - 1), motivo: 'se creó antes del primer intento del bot' })
  assert.equal((await ver(leer(T0 + 1_000 + MAXIMO_APPS_SCRIPT_MS))).nuestra, true)
  assert.equal((await ver(leer(T0 + 1_001 + MAXIMO_APPS_SCRIPT_MS))).cuando, 'despues')
  for (const [l, motivo] of [
    [async () => null, /no está configurada/],
    [async () => { throw new Error('Google respondió 403') }, /no se pudo leer.*403/],
    [leer(T0, { papelera: true }), /papelera/],
    [leer(T0, { padres: ['OtraCarpetaDeJuguete0000000001'] }), /Clientes/],
    [async () => ({ creada: null, padres: [CLIENTES], papelera: false }), /fecha de creación/],
  ]) {
    const o = await ver(l)
    assert.equal(o.nuestra, false)
    assert.equal(o.cuando, null)
    assert.match(o.motivo, motivo)
  }
  assert.equal((await carpetaDeIntentoDudoso('IdCualquieraDeJuguete00000000001', [], CLIENTES, leer(T0))).nuestra, false, 'sin ventanas, nunca')
})

test('carpetaDeIntentoDudoso con dos corridas: cada ventana por separado; lo creado ENTRE las dos (horas) no es del bot', async () => {
  const lunes = { desde: iso(T0), hasta: iso(T0 + 14_000), puedeSeguir: false }
  const viernes = { desde: iso(T0 + 4 * DIA), hasta: iso(T0 + 4 * DIA + 1_000), puedeSeguir: false }
  const ver = (creada) => carpetaDeIntentoDudoso('IdCualquieraDeJuguete00000000001', [lunes, viernes], CLIENTES, async () => ({ creada: iso(creada), padres: [CLIENTES], papelera: false }))
  assert.equal((await ver(T0 + 10_000)).nuestra, true, 'en la ventana del lunes')
  assert.equal((await ver(T0 + 4 * DIA + 500)).nuestra, true, 'en la del viernes')
  for (const entre of [T0 + 14_000 + MAXIMO_APPS_SCRIPT_MS + 1, T0 + DIA, T0 + 4 * DIA - TOLERANCIA_RELOJ_MS - 1]) {
    assert.deepEqual(await ver(entre), { nuestra: false, cuando: 'despues', creada: iso(entre), motivo: 'se creó fuera de la ventana de los intentos del bot que no respondieron' })
  }
  assert.equal((await ver(T0 - DIA)).cuando, 'antes')
})

// ── prepararDriveCliente con el cliente real del puente (reintentos + freno de homónimos) ──
test('carpeta principal: "creó y respondió 500" → el reintento la encuentra, la fecha confirma que es del bot y sigue (sin falso homónimo)', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500-despues' }])
  const r = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r.esperaOk, null, r.pendientes.join(' | '))
  assert.equal(r.ok, true)
  assert.equal(r.completo, true)
  assert.equal(r.carpeta.estado, 'creado')
  assert.equal(r.carpeta.motivo, MOTIVO_CARPETA_DE_INTENTO_DUDOSO)
  for (const k of ['crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(r[k].estado, 'creado', k)
  assert.equal(s.enClientes(CARPETA_CR).length, 1, 'una sola carpeta del cliente')
  assert.equal(s.adentro(r.carpeta.id).length, 5)
  assert.deepEqual(r.guardar.carpeta, { id: r.carpeta.id, url: r.carpeta.url })
  assert.equal(r.intentoCarpeta, null)
  assert.equal(r.noReintentarAntesDe, null)
  assert.equal(r.llamadas.length, 6, 'llamadas cuenta pedidos lógicos, no intentos')
  assert.equal(pedidosDe(s, 'crearCarpeta', CARPETA_CR), 2)
})

test('carpeta principal: homónimo REAL + 500 en el primer intento → el reintento lo encuentra, pero es anterior: espera el OK (no lo tapa)', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500-despues' }])
  const ajena = s.crear(CLIENTES, CARPETA_CR, 'carpeta', { creada: iso(T0 - 90 * DIA) })
  s.crear(ajena.id, 'Guiones - ClaudiaR', 'doc', { creada: iso(T0 - 90 * DIA) })
  const cuantos = s.items.size
  const r = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r.esperaOk, 'carpeta_existente')
  assert.equal(r.carpeta.estado, 'pendiente')
  assert.equal(r.carpeta.motivo, MOTIVO_CARPETA_EXISTENTE)
  assert.equal(r.carpeta.id, ajena.id)
  assert.equal(s.items.size, cuantos, 'no creó nada adentro')
  assert.equal(r.guardar.carpeta, undefined)
  assert.equal(r.guiones.id, null)
  assert.ok(r.pendientes.some((x) => x.includes('anterior al primer intento del bot') && x.includes('responder OK')), r.pendientes.join(' | '))
  assert.equal(r.intentoCarpeta, null, 'la duda se aclaró: no es del bot')
})

test('carpeta principal: si la fecha no se puede confirmar, el freno NO se abre (espera el OK, avisando que casi seguro es del bot)', async () => {
  const variantes = [
    ['sin cuenta de servicio', async () => null],
    ['la lectura falla', async () => { throw new Error('Google respondió 403') }],
    ['otra carpeta padre', async () => ({ creada: iso(T0), padres: ['OtraCarpetaDeJuguete0000000001'], papelera: false })],
    ['en la papelera', async () => ({ creada: iso(T0), padres: [CLIENTES], papelera: true })],
    ['sin fecha', async () => ({ creada: null, padres: [CLIENTES], papelera: false })],
  ]
  for (const [que, leerCarpeta] of variantes) {
    const reloj = relojDeJuguete()
    const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500-despues' }])
    const r = await conAppsScript(s, () => prepararDriveCliente(ALTA, real(null, { deps: { puente: () => puenteConReloj(reloj), leerCarpeta } })))
    assert.equal(r.esperaOk, 'carpeta_existente', que)
    assert.equal(r.carpeta.estado, 'pendiente', que)
    assert.equal(s.adentro(r.carpeta.id).length, 0, `${que}: no creó nada adentro`)
    assert.equal(r.guardar.carpeta, undefined, que)
    assert.ok(r.pendientes.some((x) => x.includes('Casi seguro la creó el bot') && x.includes('No se pudo confirmar')), `${que}: ${r.pendientes.join(' | ')}`)
    assert.deepEqual(r.intentoCarpeta, { nombre: CARPETA_CR, padreId: CLIENTES, ventanas: [{ desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false }] }, `${que}: la marca sigue para la próxima`)
    // Con la cuenta de servicio andando, la corrida siguiente (con la marca) la confirma y sigue
    if (que === 'sin cuenta de servicio') {
      reloj.avanzar(60_000)
      const r2 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: r.intentoCarpeta })))
      assert.equal(r2.esperaOk, null)
      assert.equal(r2.carpeta.estado, 'creado')
      assert.equal(r2.carpeta.id, r.carpeta.id)
      assert.equal(r2.completo, true)
      assert.equal(r2.intentoCarpeta, null)
      assert.equal(s.enClientes(CARPETA_CR).length, 1)
    }
  }
})

test('carpeta principal con corte por tiempo: no se reintenta; queda la marca y noReintentarAntesDe; la corrida siguiente (con la marca) sigue', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: 'timeout' }])
  const r1 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r1.ok, false)
  assert.equal(r1.carpeta.estado, 'error')
  assert.match(r1.errores[0], /no respondió \(crearCarpeta\): TimeoutError/)
  for (const k of ['crudos', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(r1[k].estado, 'pendiente', k)
  assert.equal(pedidosDe(s, 'crearCarpeta', CARPETA_CR), 1)
  assert.equal(s.enClientes(CARPETA_CR).length, 1, 'el Apps Script la creó aunque no respondió')
  assert.deepEqual(r1.intentoCarpeta, { nombre: CARPETA_CR, padreId: CLIENTES, ventanas: [{ desde: iso(T0), hasta: iso(T0 + 90_000), puedeSeguir: true }] })
  assert.equal(r1.noReintentarAntesDe, iso(T0 + 90_000 + MAXIMO_APPS_SCRIPT_MS))
  assert.equal(r1.guardar.carpeta, undefined)

  reloj.avanzar(7 * 60_000)
  // Sin la marca (como era antes): el freno salta por una carpeta que creó el propio bot
  const sinMarca = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(sinMarca.esperaOk, 'carpeta_existente')
  // Con la marca guardada en cj_altas: la fecha de creación cae en la ventana y sigue en esa carpeta
  const r2 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: r1.intentoCarpeta })))
  assert.equal(r2.esperaOk, null, r2.pendientes.join(' | '))
  assert.equal(r2.carpeta.estado, 'creado')
  assert.equal(r2.carpeta.motivo, MOTIVO_CARPETA_DE_INTENTO_DUDOSO)
  assert.equal(r2.completo, true)
  assert.equal(r2.intentoCarpeta, null)
  assert.equal(r2.noReintentarAntesDe, null)
  assert.equal(s.enClientes(CARPETA_CR).length, 1)
  assert.equal(s.adentro(r2.carpeta.id).length, 5)
})

test('marca de una corrida anterior: una carpeta creada DESPUÉS de la ventana (Aylu a mano) espera el OK; con otro nombre o rota, no cuenta', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [1, 2, 3].map(() => ({ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500' })))
  const r1 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r1.carpeta.estado, 'error')
  assert.match(r1.errores[0], /HTTP 500 · 3 intentos/)
  assert.equal(r1.intentoCarpeta.ventanas[0].puedeSeguir, false)
  assert.equal(r1.noReintentarAntesDe, null, 'sin cortes por tiempo se puede repetir ya')
  assert.equal(s.enClientes(CARPETA_CR).length, 0)

  reloj.avanzar(60 * 60_000)
  const deAylu = s.crear(CLIENTES, CARPETA_CR, 'carpeta')   // una hora después
  const r2 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: r1.intentoCarpeta })))
  assert.equal(r2.esperaOk, 'carpeta_existente')
  assert.equal(r2.carpeta.id, deAylu.id)
  assert.ok(r2.pendientes.some((x) => x.includes('posterior a los intentos del bot')), r2.pendientes.join(' | '))
  assert.equal(s.adentro(deAylu.id).length, 0)

  // Con otro nombre confirmado, la marca (de "Claudia Roldan - C.J") no se aplica: se crea la carpeta nueva y la marca se va
  const r3 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: r1.intentoCarpeta, nombreConfirmado: 'Claudia Roldan Rosario' })))
  assert.equal(r3.carpeta.estado, 'creado')
  assert.equal(r3.carpeta.motivo, null)
  assert.equal(r3.intentoCarpeta, null)
  // Una marca rota (de cj_altas) o del formato viejo (una sola ventana suelta) se ignora: sin duda, el freno de siempre
  const ventanaVieja = r1.intentoCarpeta.ventanas[0]
  for (const rota of [
    { nombre: CARPETA_CR, padreId: CLIENTES, ventanas: [{ desde: 'ayer', hasta: 'hoy', puedeSeguir: false }] },
    { nombre: CARPETA_CR, padreId: CLIENTES, ...ventanaVieja },
  ]) {
    const r4 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: rota })))
    assert.equal(r4.esperaOk, 'carpeta_existente')
    assert.ok(r4.pendientes[0].includes('es la primera vez que el bot arma esta alta'))
  }
  // Una marca de OTRA carpeta padre no cuenta, aunque la ventana cubra la fecha de creación
  const ventanaQueCubre = { desde: iso(Date.parse(s.items.get(deAylu.id).creada) - 1_000), hasta: iso(Date.parse(s.items.get(deAylu.id).creada)), puedeSeguir: false }
  const r5 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: { nombre: CARPETA_CR, padreId: 'OtraCarpetaDeJuguete0000000001', ventanas: [ventanaQueCubre] } })))
  assert.equal(r5.esperaOk, 'carpeta_existente')
  assert.ok(r5.pendientes[0].includes('es la primera vez que el bot arma esta alta'))
  // Control: la misma ventana con el padre bien sí la acepta (la de arriba se frenó por el padre)
  const r6 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: { nombre: CARPETA_CR, padreId: CLIENTES, ventanas: [ventanaQueCubre] } })))
  assert.equal(r6.esperaOk, null)
  assert.equal(r6.carpeta.motivo, MOTIVO_CARPETA_DE_INTENTO_DUDOSO)
})

test('adentro de la carpeta: 500, "creó y respondió 500" y error de red se reintentan; todo queda una sola vez', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [
    { accion: 'crearCarpeta', nombre: 'Crudos - ClaudiaR', tipo: '500-despues' },
    { accion: 'crearDoc', tipo: '500' },
    { accion: 'copiarArchivo', tipo: 'red' },
  ])
  const r = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r.ok, true, r.errores.join(' | '))
  assert.equal(r.completo, true)
  assert.equal(r.esperaOk, null)
  assert.equal(r.crudos.estado, 'existia', 'la encontró el reintento (la había creado el primer intento)')
  for (const k of ['carpeta', 'editados', 'marca', 'guiones', 'bienvenida']) assert.equal(r[k].estado, 'creado', k)
  const hijos = s.adentro(r.carpeta.id)
  assert.equal(hijos.length, 5)
  assert.equal(new Set(hijos.map((x) => x.nombre)).size, 5, 'ningún nombre repetido')
  assert.equal(s.pedidos.length, 6 + 3)
  assert.equal(r.noReintentarAntesDe, null)
  // Los que el reintento creó de nuevo (bienvenida y guiones) avisan que puede haber quedado un duplicado; Crudos no
  // (el reintento encontró el del primer intento)
  const avisos = r.pendientes.filter((x) => x.includes('puede haber quedado dos veces'))
  assert.equal(avisos.length, 2, r.pendientes.join(' | '))
  assert.ok(avisos.some((x) => x.startsWith('Bienvenida - Claudia Roldan')) && avisos.some((x) => x.startsWith('Guiones - ClaudiaR')))
})

test('sondeo de la prueba real: un 500 pasajero en el ping se reintenta y el sondeo pasa sin crear nada', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'ping', tipo: '500' }])
  const cuantos = s.items.size
  const sondeo = await conAppsScript(s, () => sondearPuente(puenteConReloj(reloj)))
  assert.deepEqual(sondeo, { ok: true, cuenta: 'cuenta@ejemplo.com', version: '2026-10-24b', motivo: null })
  assert.equal(pedidosDe(s, 'ping'), 2)
  assert.equal(s.items.size, cuantos)
})

test('verificación de la prueba: aunque el puente dé 500 en la corrida "homónimo", la fecha de creación la delata y espera el OK', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj)
  const res = await conAppsScript(s, () => prepararDriveCliente(ALTA_PRUEBA, realConScript(s, reloj)))
  assert.equal(res.completo, true)
  reloj.avanzar(60_000)
  s.fallas.push({ accion: 'crearCarpeta', nombre: NOMBRES_PRUEBA.carpeta, tipo: '500-despues' })
  const { controles, corridas } = await conAppsScript(s, () => verificarPruebaDrive(ctxPrueba, res, { puente: puenteConReloj(reloj), leerHijos: lectorDe(s), leerCarpeta: s.leerCarpeta }))
  assert.deepEqual(controles.filter((c) => !c.ok), [])
  assert.equal(corridas[1].esperaOk, 'carpeta_existente')
  assert.equal(pedidosDe(s, 'crearCarpeta', NOMBRES_PRUEBA.carpeta), 1 + 2, 'la 1.ª corrida + el 500 y el reintento de la verificación')
})

// ── Revisión de los reintentos (24/10/2026): cada hallazgo con su test ──
test('freno: las ventanas de corridas distintas NO se unen (una carpeta ajena creada entre dos corridas espera el OK)', async () => {
  // (a) Corrida 1: tres 500 sin que corra el script. Una hora después alguien crea la carpeta a mano. Corrida 2 (con la
  //     marca): el primer intento da 500 después de correr (la encontró) y el reintento la devuelve con yaExistia
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [1, 2, 3].map(() => ({ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500' })))
  const r1 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r1.intentoCarpeta.ventanas.length, 1)
  reloj.avanzar(60 * 60_000)
  const ajena = s.crear(CLIENTES, CARPETA_CR, 'carpeta')
  reloj.avanzar(60 * 60_000)
  s.fallas.push({ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500-despues' })
  const r2 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: r1.intentoCarpeta })))
  assert.equal(r2.esperaOk, 'carpeta_existente', 'la ventana de la corrida 1 y la de la 2 no se juntan en una de dos horas')
  assert.equal(r2.carpeta.id, ajena.id)
  assert.equal(s.adentro(ajena.id).length, 0, 'no creó nada adentro de la carpeta ajena')
  assert.ok(r2.pendientes.some((x) => x.includes('posterior a los intentos del bot')), r2.pendientes.join(' | '))

  // (b) Lunes falla, martes aparece una carpeta ajena, viernes falla de nuevo (la marca guarda DOS ventanas) y la
  //     corrida 3 sale bien de una: la ajena espera el OK
  const reloj2 = relojDeJuguete()
  const s2 = appsScriptDeJuguete(reloj2, [1, 2, 3, 4, 5, 6].map(() => ({ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500' })))
  const lunes = await conAppsScript(s2, () => prepararDriveCliente(ALTA, realConScript(s2, reloj2)))
  reloj2.avanzar(DIA)
  const ajena2 = s2.crear(CLIENTES, CARPETA_CR, 'carpeta')
  reloj2.avanzar(3 * DIA)
  const viernes = await conAppsScript(s2, () => prepararDriveCliente(ALTA, realConScript(s2, reloj2, { intentoCarpeta: lunes.intentoCarpeta })))
  assert.equal(viernes.carpeta.estado, 'error')
  assert.equal(viernes.intentoCarpeta.ventanas.length, 2, 'la marca previa no se pierde en el catch')
  assert.deepEqual(viernes.intentoCarpeta.ventanas[0], lunes.intentoCarpeta.ventanas[0])
  const r3 = await conAppsScript(s2, () => prepararDriveCliente(ALTA, realConScript(s2, reloj2, { intentoCarpeta: viernes.intentoCarpeta })))
  assert.equal(r3.esperaOk, 'carpeta_existente')
  assert.equal(r3.carpeta.id, ajena2.id)
  assert.equal(s2.adentro(ajena2.id).length, 0)
})

test('freno: marca de la corrida anterior + duda nueva → la carpeta creada en la ventana VIEJA se acepta (se miran todas)', async () => {
  // Corrida 1: el script crea la carpeta pero la respuesta se corta (90 s). Corrida 2, 7 min después: el primer intento da
  // 500 antes de correr y el reintento la encuentra. Su fecha cae en la ventana de la corrida 1, no en la de la 2
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: 'timeout' }])
  const r1 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r1.carpeta.estado, 'error')
  reloj.avanzar(7 * 60_000)
  s.fallas.push({ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500' })
  const r2 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: r1.intentoCarpeta })))
  assert.equal(r2.esperaOk, null, r2.pendientes.join(' | '))
  assert.equal(r2.carpeta.motivo, MOTIVO_CARPETA_DE_INTENTO_DUDOSO)
  assert.equal(r2.completo, true)
  assert.equal(r2.intentoCarpeta, null)
  assert.equal(s.enClientes(CARPETA_CR).length, 1)
})

test('freno: la marca guarda solo las últimas MAXIMO_VENTANAS ventanas (las rotas se descartan)', async () => {
  const reloj = relojDeJuguete(T0 + 30 * DIA)
  const s = appsScriptDeJuguete(reloj, [1, 2, 3].map(() => ({ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500' })))
  const ventanas = Array.from({ length: MAXIMO_VENTANAS + 2 }, (_, i) => ({ desde: iso(T0 + i * DIA), hasta: iso(T0 + i * DIA + 1_000), puedeSeguir: false }))
  const r = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: { nombre: CARPETA_CR, padreId: CLIENTES, ventanas: [{ desde: 'x', hasta: 'y' }, ...ventanas] } })))
  assert.equal(r.intentoCarpeta.ventanas.length, MAXIMO_VENTANAS)
  assert.deepEqual(r.intentoCarpeta.ventanas.at(-1).desde, iso(T0 + 30 * DIA), 'la más nueva es la de esta corrida')
  assert.deepEqual(r.intentoCarpeta.ventanas[0], ventanas[3])
})

test('4xx DESPUÉS del 302 (el script ya corrió): no se reintenta pero queda dudoso; la corrida siguiente (con la marca) no da falso homónimo', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '404-despues' }])
  const r1 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(pedidosDe(s, 'crearCarpeta', CARPETA_CR), 1, 'un 4xx no se reintenta nunca')
  assert.match(r1.errores[0], /HTTP 404 después de correr el script/)
  assert.equal(s.enClientes(CARPETA_CR).length, 1, 'el script la creó')
  assert.deepEqual(r1.intentoCarpeta, { nombre: CARPETA_CR, padreId: CLIENTES, ventanas: [{ desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false }] })
  reloj.avanzar(10 * 60_000)
  const r2 = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj, { intentoCarpeta: r1.intentoCarpeta })))
  assert.equal(r2.esperaOk, null, r2.pendientes.join(' | '))
  assert.equal(r2.carpeta.motivo, MOTIVO_CARPETA_DE_INTENTO_DUDOSO)
  assert.equal(r2.completo, true)
  // Un 4xx en el POST (sin redirección) sigue siendo "seguro no se hizo" (el test de los rechazos lo cubre con 403 y 429)
})

test('tope por llamada sin plazo: ninguna pasa de TOPE_LLAMADA_MS − 5 s; cada intento se corta a min(90 s, lo que queda)', async () => {
  assert.equal(TOPE_LLAMADA_MS, 100_000)
  // crearCarpeta: dos 500 rápidos y el tercero colgado → se corta a los 82 s (no a los 90): 95 s en total
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [
    { accion: 'crearCarpeta', tipo: '500' }, { accion: 'crearCarpeta', tipo: '500' }, { accion: 'crearCarpeta', tipo: 'timeout-antes' },
    { accion: 'aPapelera', tipo: '500', tarda: 30_000 }, { accion: 'aPapelera', tipo: 'timeout' },
  ])
  const { id } = s.crear(CARPETA_COMPROBANTES, 'Comprobante - X.png', 'archivo')
  await conAppsScript(s, async () => {
    const p = puenteConReloj(reloj)
    await assert.rejects(p.crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' }), (e) => e.aplicado === null && e.dudoso.puedeSeguir === true)
    assert.deepEqual(s.senales, [90_000, 90_000, 82_000])
    assert.equal(reloj.ahora() - T0, 95_000)
    // aPapelera (no crea nada): un 500 lento (30 s) se reintenta, pero el segundo intento solo tiene 62 s
    const t = reloj.ahora()
    await assert.rejects(p.aPapelera(id), (e) => e.aplicado === null)
    assert.deepEqual(s.senales.slice(3), [90_000, 62_000])
    assert.equal(reloj.ahora() - t, 95_000, 'antes del tope eran 30 + 3 + 90 + 8 + 90 s')
  })
  // Con plazo, manda el que llegue primero: hasta = inicio + 60 s → el único intento se corta a los 55 s y no se reintenta
  const reloj2 = relojDeJuguete()
  const s2 = appsScriptDeJuguete(reloj2, [{ accion: 'crearCarpeta', tipo: 'timeout' }])
  await conAppsScript(s2, async () => {
    await assert.rejects(puenteConReloj(reloj2, { hasta: T0 + 60_000 }).crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' }), (e) => {
      assert.deepEqual(e.dudoso, { desde: iso(T0), hasta: iso(T0 + 55_000), puedeSeguir: true })
      return true
    })
    assert.deepEqual(s2.senales, [55_000])
  })
})

test('el pedido se arma antes de mandarlo: un plazo con decimales ya no rompe la señal; una URL inválida frena al crear el cliente', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj)
  await conAppsScript(s, async () => {
    // Sin el gancho de la señal: AbortSignal.timeout de verdad (rechaza los ms con decimales con un RangeError)
    const p = puenteDriveReal({ ahora: reloj.ahora, esperar: reloj.esperar, azar: () => 0, hasta: T0 + 60_000.5 })
    const r = await p.crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' })
    assert.equal(r.yaExistia, false)
    assert.equal(s.pedidos.length, 1)
    const antes = process.env.PUENTE_DRIVE_URL
    process.env.PUENTE_DRIVE_URL = 'no es una url'
    try {
      assert.throws(() => puenteDriveReal(), (e) => /no es una URL válida/.test(e.message) && !e.message.includes('no es una url'))
    } finally {
      process.env.PUENTE_DRIVE_URL = antes
    }
  })
})

test('un 500 y después un rechazo: aplicado queda en null (pudo hacerse) pero `rechazo` dice que la acción respondió', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', tipo: '500' }, { accion: 'crearCarpeta', tipo: 'rechazo' }])
  await conAppsScript(s, async () => {
    await assert.rejects(puenteConReloj(reloj).crearCarpeta({ padreId: CLIENTES, nombre: 'X - C.J' }), (e) => {
      assert.equal(e.aplicado, null)
      assert.equal(e.rechazo, true)
      assert.deepEqual(e.dudoso, { desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false })
      assert.match(e.message, /El puente rechazó crearCarpeta: Access denied · 2 intentos$/)
      return true
    })
  })
  // En la carpeta principal deja la marca (un intento pudo haberla creado): sin ella volvería el falso homónimo
  const reloj2 = relojDeJuguete()
  const s2 = appsScriptDeJuguete(reloj2, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500-despues' }, { accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: 'rechazo' }])
  const r = await conAppsScript(s2, () => prepararDriveCliente(ALTA, realConScript(s2, reloj2)))
  assert.equal(r.carpeta.estado, 'error')
  assert.deepEqual(r.intentoCarpeta?.ventanas, [{ desde: iso(T0), hasta: iso(T0 + 1_000), puedeSeguir: false }])
})

test('sondeo de la prueba real: un 500 y después el rechazo confirma la acción; tres 500 no', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'copiarArchivo', tipo: '500' }, { accion: 'aPapeleraCarpeta', tipo: '500-despues' }])
  const cuantos = s.items.size
  const sondeo = await conAppsScript(s, () => sondearPuente(puenteConReloj(reloj)))
  assert.deepEqual(sondeo, { ok: true, cuenta: 'cuenta@ejemplo.com', version: '2026-10-24b', motivo: null })
  assert.equal(pedidosDe(s, 'copiarArchivo'), 2)
  assert.equal(pedidosDe(s, 'aPapeleraCarpeta'), 2)
  assert.equal(s.items.size, cuantos, 'no creó nada')

  const reloj2 = relojDeJuguete()
  const s2 = appsScriptDeJuguete(reloj2, [1, 2, 3].map(() => ({ accion: 'copiarArchivo', tipo: '500' })))
  const malo = await conAppsScript(s2, () => sondearPuente(puenteConReloj(reloj2)))
  assert.equal(malo.ok, false)
  assert.match(malo.motivo, /No se pudo confirmar copiarArchivo: .*HTTP 500 · 3 intentos/)
})

test('un 500 lento (más de 25 s) en la carpeta principal: no se reintenta y fija noReintentarAntesDe (el Apps Script puede seguir)', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500', tarda: INTENTO_LARGO_MS + 5_000 }])
  const r = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(pedidosDe(s, 'crearCarpeta', CARPETA_CR), 1)
  assert.equal(r.carpeta.estado, 'error')
  assert.equal(r.intentoCarpeta.ventanas[0].puedeSeguir, true)
  assert.equal(r.noReintentarAntesDe, iso(T0 + INTENTO_LARGO_MS + 5_000 + MAXIMO_APPS_SCRIPT_MS))
  // Un 500 rápido no lo fija (el test de la marca lo cubre con tres 500 de 1 s)
})

test('noReintentarAntesDe también sale de una llamada que terminó bien pero con un intento dudoso largo antes', async () => {
  const p = puenteDeJuguete()
  const crearDoc = p.crearDoc
  const duda = { desde: iso(T0), hasta: iso(T0 + 40_000), puedeSeguir: true }
  p.crearDoc = async (x) => ({ ...(await crearDoc(x)), dudoso: duda })
  const r = await prepararDriveCliente(ALTA, real(p))
  assert.equal(r.completo, true)
  assert.equal(r.noReintentarAntesDe, iso(T0 + 40_000 + MAXIMO_APPS_SCRIPT_MS))
})

test('carpeta principal creada por el reintento después de un 500: avisa que puede haber quedado dos veces en Clientes', async () => {
  const reloj = relojDeJuguete()
  const s = appsScriptDeJuguete(reloj, [{ accion: 'crearCarpeta', nombre: CARPETA_CR, tipo: '500' }])
  const r = await conAppsScript(s, () => prepararDriveCliente(ALTA, realConScript(s, reloj)))
  assert.equal(r.completo, true)
  assert.equal(r.carpeta.estado, 'creado')
  assert.ok(r.pendientes.some((x) => x.startsWith(CARPETA_CR) && x.includes('puede haber quedado dos veces en Clientes') && x.includes(r.carpeta.url)), r.pendientes.join(' | '))
  // Sin 500, ningún aviso
  const reloj2 = relojDeJuguete()
  const s2 = appsScriptDeJuguete(reloj2)
  const r2 = await conAppsScript(s2, () => prepararDriveCliente(ALTA, realConScript(s2, reloj2)))
  assert.deepEqual(r2.pendientes, [])
})

// ── El Apps Script tiene las acciones que usa el cliente y los frenos (solo en la compu de Tomás: el .gs no está en el repo) ──
const GS = process.env.PUENTE_CODIGO_GS?.trim() || new URL('../integrations/apps-script/Codigo.gs', import.meta.url)
const sinGs = (!GS || !existsSync(GS)) && 'Falta el puente versionado de integrations/apps-script'
/** Cuerpo de una función del .gs (contando llaves desde la primera después de "function nombre("). */
function cuerpoGs(gs, nombre) {
  const i = gs.indexOf(`function ${nombre}(`)
  assert.ok(i >= 0, `falta la función ${nombre}`)
  let j = gs.indexOf('{', i), nivel = 0
  for (let k = j; k < gs.length; k++) {
    if (gs[k] === '{') nivel++
    else if (gs[k] === '}' && --nivel === 0) return gs.slice(j, k + 1)
  }
  throw new Error(`no cierra la función ${nombre}`)
}

test('Codigo.gs: tiene las acciones que usa el cliente y ya no crearCarpetaCliente', { skip: sinGs }, () => {
  const gs = readFileSync(GS, 'utf8')
  for (const accion of ['ping', 'subirArchivo', 'crearCarpeta', 'crearDoc', 'aPapelera', 'copiarArchivo', 'aPapeleraCarpeta']) {
    assert.ok(gs.includes(`case '${accion}':`), `falta la acción ${accion}`)
  }
  // Creaba "Guiones - X" como carpeta; la convención es un Google Doc
  assert.ok(!gs.includes("case 'crearCarpetaCliente'") && !gs.includes('function crearCarpetaCliente_'), 'volvió crearCarpetaCliente')
  assert.match(cuerpoGs(gs, 'doPost'), /version: VERSION/)
  assert.ok(gs.includes(`var PREFIJO_PRUEBA = '${PREFIJO_CARPETA_PRUEBA}';`), 'el prefijo del .gs no es el de puenteDrive.ts')
  assert.equal(PREFIJO_CARPETA_PRUEBA, PREFIJO_PRUEBA, 'el prefijo de Drive y el de finanzasLimpiar.ts tienen que ser el mismo')
  assert.ok(gs.includes(`var PREFIJO_PLANTILLA = '${PREFIJO_PLANTILLA}';`), 'el prefijo de plantilla del .gs no es el de puenteDrive.ts')
  assert.match(gs, /getProperty\(['"]DRIVE_CARPETA_COMPROBANTES['"]\)/, 'el puente debe pedir la carpeta privada a ScriptProperties')
})

test('Codigo.gs: aPapeleraCarpeta_ compara el nombre con el prefijo y rechaza las demás carpetas', { skip: sinGs }, () => {
  const c = cuerpoGs(readFileSync(GS, 'utf8'), 'aPapeleraCarpeta_')
  assert.match(c, /if \(c\.getName\(\)\.indexOf\(PREFIJO_PRUEBA\) !== 0\) return \{ ok: false,/)
  assert.ok(c.indexOf('indexOf(PREFIJO_PRUEBA)') < c.indexOf('setTrashed(true)'), 'el control va antes de mandar a la papelera')
})

test('Codigo.gs: aPapelera_ solo acepta archivos de "Subidos" o de una carpeta "PRUEBA BOT…"', { skip: sinGs }, () => {
  const gs = readFileSync(GS, 'utf8')
  const c = cuerpoGs(gs, 'aPapelera_')
  assert.match(c, /if \(!enSubidosOPrueba_\(f\)\) return \{ ok: false,/)
  assert.ok(c.indexOf('enSubidosOPrueba_') < c.indexOf('setTrashed(true)'))
  const freno = cuerpoGs(gs, 'enSubidosOPrueba_')
  assert.match(freno, /getParents\(\)/)
  assert.match(freno, /getId\(\) === CARPETA_COMPROBANTES/)
  assert.match(freno, /getName\(\)\.indexOf\(PREFIJO_PRUEBA\) === 0/)
})

test('Codigo.gs: copiarArchivo_ rechaza sin datos antes de tocar Drive y solo copia "Plantilla…"', { skip: sinGs }, () => {
  const c = cuerpoGs(readFileSync(GS, 'utf8'), 'copiarArchivo_')
  const faltan = c.indexOf("if (!p.archivoId || !p.carpetaId || !p.nombre) return { ok: false")
  assert.ok(faltan >= 0 && faltan < c.indexOf('DriveApp'), 'el sondeo de la prueba depende de que "faltan …" salga antes de tocar Drive')
  assert.match(c, /if \(origen\.getName\(\)\.indexOf\(PREFIJO_PLANTILLA\) !== 0\) return \{ ok: false, error: 'solo se copian plantillas/)
  assert.ok(c.indexOf('PREFIJO_PLANTILLA') < c.indexOf('makeCopy('))
  assert.match(c, /origen\.makeCopy\(p\.nombre, carpeta\)/)
})

test('Codigo.gs: toda búsqueda por nombre saltea la papelera (primeroNoBorrado_)', { skip: sinGs }, () => {
  const gs = readFileSync(GS, 'utf8')
  assert.match(gs, /function primeroNoBorrado_\(it\)/)
  const busquedas = gs.match(/[\w.]*By(Name|Type)\([^)]*\)[^;\n]*/g) ?? []
  assert.ok(busquedas.length >= 4, `se esperaban las búsquedas de subirArchivo, crearCarpeta, crearDoc y copiarArchivo: ${busquedas.length}`)
  for (const linea of gs.split('\n').filter((l) => /By(Name|Type)\(/.test(l))) {
    assert.match(linea, /primeroNoBorrado_\([\w.]+\.get(Files|Folders)By(Name|Type)\(/, `búsqueda sin primeroNoBorrado_: ${linea.trim()}`)
  }
  assert.ok(!/By(Name|Type)\([^)]*\)\s*\.hasNext\(\)/.test(gs), 'quedó un .hasNext() directo sobre una búsqueda')
})

test('Codigo.gs: el secreto no está en el archivo (sale de las propiedades del proyecto)', { skip: sinGs }, () => {
  const gs = readFileSync(GS, 'utf8')
  assert.ok(!/var SECRETO\s*=/.test(gs), 'el secreto volvió a estar escrito en el .gs')
  assert.match(cuerpoGs(gs, 'doPost'), /PropertiesService\.getScriptProperties\(\)\.getProperty\('SECRETO'\)/)
  assert.match(cuerpoGs(gs, 'doPost'), /if \(!secreto\) return resp_\(\{ ok: false/)
  const secreto = process.env.PUENTE_DRIVE_SECRETO
  if (secreto) assert.ok(!gs.includes(secreto), 'el .gs contiene el valor de PUENTE_DRIVE_SECRETO')
})
