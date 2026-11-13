// HUB_PRUEBAS_SIN_RED=1 HUB_CONFIG_PRIVADA_DIR=./private-config.example node --experimental-strip-types --no-warnings --import ./scripts/fixtures-entorno.mjs --import ./scripts/ts-resolve.mjs --test scripts/test-clientes-puntaje.mjs
// Puntaje de clientes (del cliente e interno) y Wins (especificación v1, 13/11/2026). SIN red ni base: todo con datos inventados
// (clientes Z0xx, «Estudio Ejemplo …»). Cubre: el cálculo con sus bordes (sin encuesta, sin EOW, sin Meta, todo en cero, bonus,
// restas que no bajan de 0, brecha en ambos sentidos), que la respuesta del equipo («manual») no cuenta como la del cliente, el
// armado de señales (EOW, cuotas, referidos, solo los que lanzaron), la validación de wins y los permisos de la API.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const P = await import('../lib/clientes/puntaje.ts')
const S = await import('../lib/clientes/puntajeSenales.ts')
const W = await import('../lib/clientes/wins/modelo.ts')
const API = await import('../lib/clientes/wins/api.ts')

const META_BIEN = { activa: true, cpl: 'verde', gastoRealDiarioUSD: 25, gastoObjetivoDiarioUSD: 25, semaforo: 'verde', errorPago: false }
const TODO_BIEN = {
  encuesta: { valor: 9, dia: '2026-11-02' }, metaLeida: true, meta: META_BIEN, promesa: 'Sí', wins: 2, eowLeido: true,
  eow: { color: 'verde', pesadilla: false }, renovo: true, pagos: 'al_dia', referido: true, grabaYResponde: true,
}
const TODO_CERO = {
  encuesta: null, metaLeida: true, meta: null, promesa: 'No', wins: 0, eowLeido: true, eow: { color: 'rojo', pesadilla: false },
  renovo: false, pagos: null, referido: false, grabaYResponde: false,
}
const renglon = (r, clave) => r.detalle.find(x => x.clave === clave)

describe('cálculo del puntaje', () => {
  test('todo bien: 100 de interno, bonus tope 15, el del cliente es la encuesta × 10', () => {
    const r = P.calcularPuntaje(TODO_BIEN)
    assert.equal(r.base, 100)
    assert.equal(r.interno, 100)
    assert.equal(r.bonus, 15)
    assert.equal(r.total, 115)          // el bonus puede pasar de 100
    assert.equal(r.cliente, 90)
    assert.equal(r.clienteDia, '2026-11-02')
    assert.equal(r.nivel, 'exito')
    assert.equal(r.estimado, false)
    assert.equal(r.brecha, null)        // 90 vs 100: la brecha se mide sin el bonus
  })
  test('brecha en los dos sentidos (20 puntos o más)', () => {
    const peor = P.calcularPuntaje({ ...TODO_BIEN, encuesta: { valor: 5, dia: null } })
    assert.equal(peor.interno, 100)
    assert.equal(peor.cliente, 50)
    assert.equal(peor.brecha?.tipo, 'peor')
    assert.match(peor.brecha.texto, /peor que los números/)
    assert.equal(peor.nivel, 'en_camino')   // el nivel sale del cliente, no del interno
    const mejor = P.calcularPuntaje({ ...TODO_CERO, encuesta: { valor: 8, dia: null } })
    assert.equal(mejor.brecha?.tipo, 'mejor')
    assert.equal(mejor.nivel, 'exito')
    const justo = P.calcularPuntaje({ ...TODO_BIEN, encuesta: { valor: 10, dia: null }, renovo: false, pagos: null, referido: false, grabaYResponde: null })
    assert.equal(justo.brecha, null)        // 100 vs 100
    const diecisiete = P.calcularPuntaje({ ...TODO_BIEN, encuesta: { valor: 10, dia: null }, wins: 1, eow: { color: 'amarillo', pesadilla: false } })
    assert.equal(diecisiete.interno, 83)
    assert.equal(diecisiete.brecha, null)   // 17 < 20
    const veinte = P.calcularPuntaje({ ...TODO_BIEN, encuesta: { valor: 6, dia: null }, wins: 2, meta: { ...META_BIEN, gastoRealDiarioUSD: 15 } })
    assert.equal(veinte.interno, 93)
    assert.equal(veinte.brecha?.diferencia, 33)
  })
  test('sin encuesta: cliente null, nivel estimado con el interno; la línea compacta lo dice', () => {
    const r = P.calcularPuntaje({ ...TODO_BIEN, encuesta: null })
    assert.equal(r.cliente, null)
    assert.equal(r.estimado, true)
    assert.equal(r.nivel, 'exito')
    assert.equal(r.brecha, null)
    assert.equal(P.textoCompacto(r), 'Cliente — · Interno 100 +15 (estimado)')
    assert.equal(P.textoCompacto({ cliente: 80, interno: 72, bonus: 8, estimado: false }), 'Cliente 80 · Interno 72 +8')
  })
  test('sin Meta: el bloque Anuncios entero queda sin dato (0) y las restas de Meta también', () => {
    const r = P.calcularPuntaje({ ...TODO_BIEN, metaLeida: false, meta: null })
    for (const k of ['campana', 'cpl', 'gasto', 'rojo_meta', 'falta_pago']) assert.equal(renglon(r, k).estado, 'sin_dato', k)
    assert.equal(r.base, 50)
    assert.equal(r.restas, 0)
  })
  test('Meta leída pero sin campaña del cliente: la campaña no suma; costo y gasto sin dato', () => {
    const r = P.calcularPuntaje({ ...TODO_BIEN, meta: null })
    assert.equal(renglon(r, 'campana').estado, 'no_suma')
    assert.equal(renglon(r, 'cpl').estado, 'sin_dato')
    assert.equal(renglon(r, 'rojo_meta').estado, 'no_aplica')
  })
  test('sin EOW: el semáforo de Gero M y la pesadilla quedan sin dato', () => {
    const r = P.calcularPuntaje({ ...TODO_BIEN, eowLeido: false, eow: null })
    assert.equal(renglon(r, 'eow').estado, 'sin_dato')
    assert.equal(renglon(r, 'pesadilla').estado, 'sin_dato')
    assert.equal(r.base, 80)
    const noFigura = P.calcularPuntaje({ ...TODO_BIEN, eow: null })
    assert.equal(renglon(noFigura, 'eow').estado, 'sin_dato')
    assert.equal(renglon(noFigura, 'pesadilla').estado, 'no_aplica')
  })
  test('todo en cero: interno 0, sin bonus, nivel atención estimado', () => {
    const r = P.calcularPuntaje(TODO_CERO)
    assert.equal(r.interno, 0)
    assert.equal(r.bonus, 0)
    assert.equal(r.nivel, 'atencion')
    assert.equal(r.estimado, true)
  })
  test('las restas nunca bajan el interno de 0 y se ven en el detalle', () => {
    const r = P.calcularPuntaje({ ...TODO_CERO, meta: { ...META_BIEN, activa: false, cpl: 'rojo', gastoRealDiarioUSD: 0, semaforo: 'rojo', errorPago: true }, eow: { color: 'rojo', pesadilla: true }, pagos: 'atrasado' })
    assert.equal(r.base, 0)
    assert.equal(r.restas, 45)
    assert.equal(r.interno, 0)
    assert.deepEqual(r.detalle.filter(x => x.bloque === 'resta').map(x => x.puntos), [-10, -15, -10, -10])
  })
  test('parciales: amarillo 12, gasto 50–79 % = 8, 1 win = 8, EOW amarillo 10, promesa parcial no suma', () => {
    const r = P.calcularPuntaje({ ...TODO_BIEN, meta: { ...META_BIEN, cpl: 'amarillo', gastoRealDiarioUSD: 15 }, wins: 1, eow: { color: 'amarillo', pesadilla: false }, promesa: 'Parcial' })
    assert.equal(renglon(r, 'cpl').puntos, 12)
    assert.equal(renglon(r, 'gasto').puntos, 8)
    assert.equal(renglon(r, 'wins').puntos, 8)
    assert.equal(renglon(r, 'eow').puntos, 10)
    assert.equal(renglon(r, 'promesa').puntos, 0)
    assert.equal(r.base, 10 + 12 + 8 + 0 + 8 + 10)
    const poco = P.calcularPuntaje({ ...TODO_BIEN, meta: { ...META_BIEN, gastoRealDiarioUSD: 10 } })
    assert.equal(renglon(poco, 'gasto').puntos, 0)
    const sinObjetivo = P.calcularPuntaje({ ...TODO_BIEN, meta: { ...META_BIEN, gastoObjetivoDiarioUSD: null } })
    assert.equal(renglon(sinObjetivo, 'gasto').estado, 'sin_dato')
  })
  test('niveles 70 / 50 y encuesta fuera de rango', () => {
    assert.equal(P.nivelDe(70), 'exito')
    assert.equal(P.nivelDe(69), 'en_camino')
    assert.equal(P.nivelDe(50), 'en_camino')
    assert.equal(P.nivelDe(49), 'atencion')
    assert.equal(P.puntajeCliente({ valor: 0, dia: null }), 0)
    assert.equal(P.puntajeCliente({ valor: 11, dia: null }), null)
  })
  test('sugerencia: llegó a 70 y la etapa no es Éxito (no mueve nada)', () => {
    const r = P.calcularPuntaje(TODO_BIEN)
    assert.match(P.sugerencia(r, 'lanzado'), /anotar Éxito/)
    assert.equal(P.sugerencia(r, 'exito'), null)
    assert.equal(P.sugerencia(P.calcularPuntaje(TODO_CERO), 'lanzado'), null)
  })
})

describe('señales', () => {
  test('la respuesta del EQUIPO («Puntuar», manual) no cuenta como la del cliente', () => {
    const historial = [
      { valor: 3, dia: '2026-11-10', fecha: '2026-11-10 10:00', fuente: 'manual' },
      { valor: 9, dia: '2026-10-02', fecha: '2026-10-02', fuente: 'typeform' },
      { valor: 7, dia: '2026-09-02', fecha: '2026-09-02', fuente: 'typeform' },
    ]
    assert.deepEqual(S.ultimaRespuestaCliente(historial), { valor: 9, dia: '2026-10-02' })
    assert.equal(S.ultimaRespuestaCliente(historial.slice(0, 1)), null)
  })
  test('EOW: color por vínculo manual o por nombre, pesadilla por la tarjeta; lo dudoso no se vincula', () => {
    const cartera = [
      { id: 'Z001', nombre: 'Estudio Ejemplo Uno', estado: 'activo', estadoCrm: 'ACTIVO', pausaDesde: null },
      { id: 'Z002', nombre: 'Estudio Ejemplo Dos', estado: 'activo', estadoCrm: 'ACTIVO', pausaDesde: null },
    ]
    const tarjetas = { pesadilla: ['Estudio Ejemplo Dos'], cancelaciones: [], pausados: [], testimoniosPedidos: [], testimoniosObtenidos: [], servicioTerminado: [], observaciones: [] }
    const filas = [
      { id: 'a', cliente: 'Cualquier nombre', comentario: '', color: 'verde', pausado: false, idCrm: 'Z001', lanzado: null, origen: 'manual' },
      { id: 'b', cliente: 'Estudio Ejemplo Dos', comentario: '', color: 'amarillo', pausado: false, idCrm: null, lanzado: null, origen: 'manual' },
      { id: 'c', cliente: 'Nadie Conocido', comentario: '', color: 'rojo', pausado: false, idCrm: null, lanzado: null, origen: 'manual' },
    ]
    const m = S.indiceEow({ filas, tarjetas }, cartera)
    assert.deepEqual(m.get('Z001'), { color: 'verde', pesadilla: false })
    assert.deepEqual(m.get('Z002'), { color: 'amarillo', pesadilla: true })
    assert.equal(m.size, 2)
  })
  test('cuotas: cruce por teléfono o nombre con UN solo cliente; una cuota vencida = atrasado', () => {
    const clientes = [
      { id: 'Z001', nombre: 'Estudio Ejemplo Uno', celular: '+54 9 11 0000-0001' },
      { id: 'Z002', nombre: 'Estudio Ejemplo Dos', celular: '' },
      { id: 'Z003', nombre: 'Repetido', celular: '' }, { id: 'Z004', nombre: 'Repetido', celular: '' },
    ]
    const m = S.estadoPagos([
      { nombre: 'Otro nombre', telefono: '11 0000 0001', abandonado: false, atrasado: true },
      { nombre: 'estudio ejemplo dos', telefono: '', abandonado: false, atrasado: false },
      { nombre: 'Repetido', telefono: '', abandonado: false, atrasado: true },
      { nombre: 'Estudio Ejemplo Dos', telefono: '', abandonado: true, atrasado: true },
    ], clientes)
    assert.equal(m.get('Z001'), 'atrasado')
    assert.equal(m.get('Z002'), 'al_dia')
    assert.equal(m.has('Z003'), false)
  })
  test('solo los que ya lanzaron tienen puntaje; referidos descartados no cuentan', () => {
    const base = { linea: 'agencia', estado: 'ACTIVO', celular: '', promesa: 'Sí', renovo: 'NO', renovacionesPagas: 0, esNoCliente: false }
    const clientes = [{ ...base, id: 'Z001', nombre: 'Estudio Ejemplo Uno' }, { ...base, id: 'Z002', nombre: 'Estudio Ejemplo Dos' }, { ...base, id: 'Z003', nombre: 'Consultora', linea: 'consultora' }]
    const r = S.puntajesDeCartera({
      clientes, hoy: '2026-11-13', historialDe: () => [], metaLeida: true,
      campanaDe: c => (c.id === 'Z001' ? { ...META_BIEN, ultimoLanzamiento: null, lanzamientoAprox: false, aGrabar: null } : null),
      lanzo: c => c.id === 'Z001',
      referidos: [{ idReferidor: 'Z001', estado: 'Descartado' }],
      fuentes: { winsFechas: [{ idCrm: 'z001', fecha: '2026-11-01' }, { idCrm: 'Z001', fecha: '2026-08-01' }], eow: null, planes: null },
    })
    assert.deepEqual([...r.keys()], ['Z001'])
    const p = r.get('Z001')
    assert.equal(renglon(p, 'wins').puntos, 8)          // el de agosto quedó fuera de los 60 días
    assert.equal(renglon(p, 'referido').estado, 'no_suma')
    assert.equal(renglon(p, 'eow').estado, 'sin_dato')
    assert.equal(renglon(p, 'graba').estado, 'sin_dato')
    assert.equal(P.yaLanzo({ hitoLanzamiento: false }), false)
    assert.equal(P.yaLanzo({ hitoLanzamiento: false, primerLanzamiento: '2026-10-01' }), true)
  })
  test('renovó: columna R1 o renovación paga', () => {
    assert.equal(S.renovoDe({ renovo: 'R1 +2 meses', renovacionesPagas: 0 }), true)
    assert.equal(S.renovoDe({ renovo: 'NO +1 mes', renovacionesPagas: 0 }), false)
    assert.equal(S.renovoDe({ renovo: '', renovacionesPagas: 1 }), true)
  })
})

// JPEG mínimo de prueba (solo la firma): alcanza para validar el tipo por los primeros bytes
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString('base64')
const WIN = { clave: 'clave-de-prueba-0001', idCrm: 'z001', fecha: '2026-11-10', texto: '  Gracias, ya me llegaron 3 consultas\r\nde sucesiones  ', fuente: 'whatsapp', autorizado: true, captura: null }

describe('wins: validación', () => {
  test('un win válido conserva el texto textual (saltos incluidos) y pasa el ID a mayúscula', () => {
    const v = W.validarWin(WIN, '2026-11-13')
    assert.equal(v.ok, true)
    assert.equal(v.win.idCrm, 'Z001')
    assert.equal(v.win.texto, 'Gracias, ya me llegaron 3 consultas\nde sucesiones')
  })
  test('rechaza texto vacío, fecha futura, fuente rara, autorizado sin decir y clave faltante', () => {
    assert.equal(W.validarWin({ ...WIN, texto: '   ' }, '2026-11-13').ok, false)
    assert.equal(W.validarWin({ ...WIN, fecha: '2026-11-14' }, '2026-11-13').ok, false)
    assert.equal(W.validarWin({ ...WIN, fuente: 'mail' }, '2026-11-13').ok, false)
    assert.equal(W.validarWin({ ...WIN, autorizado: undefined }, '2026-11-13').ok, false)
    assert.equal(W.validarWin({ ...WIN, clave: '' }, '2026-11-13').ok, false)
    assert.equal(W.validarWin({ ...WIN, idCrm: 'nada' }, '2026-11-13').ok, false)
  })
  test('captura: el tipo sale de la firma (no del navegador); lo que no es imagen o pesa de más se rechaza', () => {
    const ok = W.validarWin({ ...WIN, captura: { base64: `data:image/png;base64,${JPEG}` } }, '2026-11-13')
    assert.equal(ok.ok, true)
    assert.equal(ok.win.captura.tipo, 'image/jpeg')
    assert.equal(W.validarWin({ ...WIN, captura: { base64: Buffer.from('<svg onload=x>').toString('base64') } }, '2026-11-13').ok, false)
    assert.equal(W.validarWin({ ...WIN, captura: { base64: 'no es base64 !!' } }, '2026-11-13').ok, false)
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(W.TOPE_CAPTURA_BYTES)]).toString('base64')
    assert.equal(W.validarWin({ ...WIN, captura: { base64: grande } }, '2026-11-13').ok, false)
  })
  test('filtro y orden: del más nuevo al más viejo, por cliente y por autorizado', () => {
    const ws = [
      { id: 1, idCrm: 'Z001', fecha: '2026-10-01', autorizado: true, creado: '2026-10-01T10:00:00Z' },
      { id: 2, idCrm: 'Z002', fecha: '2026-11-01', autorizado: false, creado: '2026-11-01T10:00:00Z' },
      { id: 3, idCrm: 'Z001', fecha: '2026-11-01', autorizado: false, creado: '2026-11-01T12:00:00Z' },
    ]
    assert.deepEqual(W.filtrarWins(ws, { idCrm: null, autorizado: null }).map(w => w.id), [3, 2, 1])
    assert.deepEqual(W.filtrarWins(ws, { idCrm: 'z001', autorizado: null }).map(w => w.id), [3, 1])
    assert.deepEqual(W.filtrarWins(ws, { idCrm: null, autorizado: true }).map(w => w.id), [1])
    assert.deepEqual([...W.contarWinsDesde(ws, '2026-10-15')], [['Z002', 1], ['Z001', 1]])
  })
})

describe('wins: API y permisos', () => {
  const llamadas = []
  const deps = (o = {}) => ({
    exigirAcceso: () => null,
    sesion: () => ({ nombre: 'Persona Ejemplo', email: 'persona@ejemplo.test' }),
    puedeEscribir: () => true,
    mismoOrigen: () => true,
    baseConfigurada: () => true,
    hoy: () => '2026-11-13',
    clienteExiste: async () => true,
    listar: async () => [{ id: 1, idCrm: 'Z001', fecha: '2026-11-01', texto: 'x', fuente: 'otro', autorizado: true, cargadoPor: 'A', creado: null, conCaptura: false }],
    crear: async (w, quien) => { llamadas.push(['crear', w.idCrm, quien]); return { id: 7, nuevo: true } },
    borrar: async (id) => { llamadas.push(['borrar', id]); return true },
    captura: async () => ({ tipo: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) }),
    ...o,
  })
  const post = (cuerpo, h = {}) => new Request('https://despacho.ejemplo.test/api/clientes/wins', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://despacho.ejemplo.test', ...h }, body: JSON.stringify(cuerpo) })
  test('sin la sección Clientes no lee ni escribe', async () => {
    const no = () => new Response('{}', { status: 403 })
    assert.equal((await API.atenderGetWins(new Request('https://x.test/api/clientes/wins'), deps({ exigirAcceso: no }))).status, 403)
    assert.equal((await API.atenderPostWins(post(WIN), deps({ exigirAcceso: no }))).status, 403)
    assert.equal((await API.atenderGetCaptura(new Request('https://x.test/api/clientes/wins/1/captura'), '1', deps({ exigirAcceso: no }))).status, 403)
  })
  test('ver sí, cargar y borrar solo con permiso de acciones', async () => {
    const lector = deps({ puedeEscribir: () => false })
    assert.equal((await API.atenderGetWins(new Request('https://x.test/api/clientes/wins?cliente=Z001'), lector)).status, 200)
    assert.equal((await API.atenderPostWins(post(WIN), lector)).status, 403)
    assert.equal((await API.atenderDeleteWin(new Request('https://x.test/api/clientes/wins/1', { method: 'DELETE' }), '1', lector)).status, 403)
    assert.equal(llamadas.length, 0)
  })
  test('crear: mismo origen, cliente existente y datos válidos', async () => {
    assert.equal((await API.atenderPostWins(post(WIN), deps({ mismoOrigen: () => false }))).status, 403)
    assert.equal((await API.atenderPostWins(post({ ...WIN, texto: '' }), deps())).status, 422)
    assert.equal((await API.atenderPostWins(post(WIN), deps({ clienteExiste: async () => false }))).status, 404)
    assert.equal((await API.atenderPostWins(post(WIN), deps({ clienteExiste: async () => null }))).status, 503)
    const r = await API.atenderPostWins(post(WIN), deps())
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { ok: true, id: 7, nuevo: true })
    assert.deepEqual(llamadas.at(-1), ['crear', 'Z001', 'Persona Ejemplo'])
  })
  test('la captura sale privada, sin caché compartida y con nosniff', async () => {
    const r = await API.atenderGetCaptura(new Request('https://x.test/api/clientes/wins/5/captura'), '5', deps())
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'image/jpeg')
    assert.equal(r.headers.get('cache-control'), 'private, no-store')
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    assert.equal((await API.atenderGetCaptura(new Request('https://x.test/api/clientes/wins/x/captura'), 'abc', deps())).status, 404)
    assert.equal((await API.atenderGetCaptura(new Request('https://x.test/api/clientes/wins/5/captura'), '5', deps({ sesion: () => null }))).status, 401)
  })
})
