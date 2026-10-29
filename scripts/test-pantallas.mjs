// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-pantallas.mjs
// Lógica pura de las pantallas de Clientes y Referidos: formato, contacto (WhatsApp E.164), listado (filtros y orden),
// indicadores de la franja, paso del programa, agregados de referidos y ficha. Sin red ni reloj: los datos son los ficticios de demo.ts. La última suite vigila que la marca nueva no se cargue en el dashboard viejo (lee los imports del layout raíz).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { numeroAR, usd, fechaLarga, fechaCorta, textoDias, mesesTexto, horaAR } from '../lib/clientes/formato.ts'
import { normalizarE164, telefonosDe } from '../lib/clientes/contacto.ts'
import {
  aListado, filtrarListado, ordenarListado, parsearFiltros, filtrosAParams, hayParams, closersDe, textoCredito, FILTROS_INICIALES, SIN_CLOSER, UMBRAL_SALDO_USD,
  cambioDeLinea, textoMostrar, soloRenovacion, sinRespuestaDelMes,
} from '../lib/clientes/listado.ts'
import { marcasBackend, marcaDe } from '../lib/clientes/marcasBackend.ts'
import { indicadoresDeCartera } from '../lib/clientes/indicadores.ts'
import { pasoDelPrograma, mesesPorVencer, resumirPrograma, calcularCreditosDeDatos, valorDelPaso, DIAS_AVISO_VENCIMIENTO } from '../lib/clientes/programa.ts'
import { armarFicha, ID_CLIENTE_VALIDO } from '../lib/clientes/ficha.ts'
import { crearDatosDemo, demoPermitido, pedidoDemo, reglasDeDemo } from '../lib/clientes/demo.ts'
import { calcularCreditos } from '../lib/clientes/creditos.ts'
import { REGLAS_REFERIDOS } from '../lib/clientes/reglasReferidos.ts'
import { textoExtra } from '../lib/clientes/programa.ts'
import { sumarDias } from '../lib/clientes/fechas.ts'

const HOY = '2026-10-06'
const demo = crearDatosDemo(HOY)
const creditos = calcularCreditosDeDatos(demo)   // usa demo.reglas: las reales, con el programa arrancando 14 meses antes (solo en el ejemplo)
// Mecánica de pasos y liberación con fechas de septiembre de 2026: reglas reales con el programa arrancando en el año 2000
const R0 = { ...REGLAS_REFERIDOS, vigenteDesde: '2000-01-01' }

describe('formato', () => {
  test('números con punto de miles también de 4 cifras', () => {
    assert.equal(numeroAR(4000), '4.000'); assert.equal(numeroAR(36762), '36.762'); assert.equal(numeroAR(999), '999')
    assert.equal(numeroAR(1234567), '1.234.567'); assert.equal(numeroAR(-1500), '-1.500'); assert.equal(numeroAR(0.4), '0')
    assert.equal(usd(4000), 'USD 4.000'); assert.equal(usd(null), '—')
  })
  test('fechas en español y hora argentina', () => {
    assert.equal(fechaLarga('2026-10-06'), '6 de octubre de 2026'); assert.equal(fechaLarga('2026-02-30'), '—')
    assert.equal(fechaCorta('2026-10-06'), '6/10/2026'); assert.equal(fechaCorta(null), '—')
    assert.equal(horaAR(Date.UTC(2026, 9, 6, 18, 5)), '15:05')       // 18:05 UTC = 15:05 en Argentina
    assert.equal(horaAR(Date.UTC(2026, 9, 7, 2, 30)), '23:30')       // pasada la medianoche UTC sigue siendo el día anterior
  })
  test('días y meses', () => {
    assert.equal(textoDias(0), 'hoy'); assert.equal(textoDias(1), 'mañana'); assert.equal(textoDias(-1), 'ayer')
    assert.equal(textoDias(6), 'en 6 días'); assert.equal(textoDias(-12), 'hace 12 días'); assert.equal(textoDias(null), '')
    assert.equal(mesesTexto(1), '1 mes'); assert.equal(mesesTexto(8), '8 meses')
  })
})

describe('contacto: enlace de WhatsApp solo cuando el número es inequívoco', () => {
  test('con "+" y código de país', () => {
    assert.equal(normalizarE164('+54 9 11 5555-1234'), '+5491155551234')
    assert.equal(normalizarE164('+598 99 123 456'), '+59899123456')
    assert.equal(normalizarE164('+57 300 123 4567'), '+573001234567')
  })
  test('argentino sin el 9 de móvil: se agrega; sin "+" pero con 54: vale', () => {
    assert.equal(normalizarE164('+54 11 5555-1234'), '+5491155551234')
    assert.equal(normalizarE164('54 9 11 5555 1234'), '+5491155551234')
    assert.equal(normalizarE164('0054 9 11 5555 1234'), '+5491155551234')
  })
  test('sin código de país NO se adivina', () => {
    assert.equal(normalizarE164('11 5555 1234'), null)
    assert.equal(normalizarE164('5555-1234'), null)
    assert.equal(normalizarE164('351 555 1234'), null)
  })
  test('basura: muy corto, muy largo, vacío', () => {
    assert.equal(normalizarE164('+54'), null); assert.equal(normalizarE164('+1234567890123456'), null); assert.equal(normalizarE164(''), null)
  })
  test('varios teléfonos en una celda, con la nota entre paréntesis', () => {
    const t = telefonosDe('+54 9 11 1111-0001 (Mari) / +54 9 11 2222-0002 (Sil)')
    assert.equal(t.length, 2)
    assert.equal(t[0].wa, 'https://wa.me/5491111110001'); assert.equal(t[1].e164, '+5491122220002'); assert.match(t[0].texto, /Mari/)
    assert.deepEqual(telefonosDe(''), [])
    assert.equal(telefonosDe('11 5555 1234')[0].wa, null)
  })
})

describe('listado: filas, filtros y orden', () => {
  const filas = demo.clientes.map((c, i) => aListado(c, i, creditos.get(c.id)))
  test('la fila no lleva teléfono, mail ni notas', () => {
    const j = JSON.stringify(filas)
    assert.ok(!/5550|ejemplo\.test|Cliente de ejemplo/.test(j))
    assert.deepEqual(Object.keys(filas[0]).sort(), ['clave', 'closer', 'cobrado', 'cobrosAviso', 'contratado', 'credito', 'dias', 'estado', 'fin', 'id', 'linea', 'nombre', 'noCliente', 'panel', 'saldo', 'semaforo', 'puntaje', 'sinRespuestaMes', 'sinCampana', 'backend'].sort())
    // La única nota que viaja es la de "Llamada agendada" en las marcas de renovación (pedido de Tomás, 10/10/2026)
    assert.equal(filas[0].backend, null)
  })
  test('filtro "Renovación pendiente" (lo que era Backend): solo las filas con renovación marcada', () => {
    const conMarca = demo.clientes.map((c, i) => aListado(c, i, undefined, undefined, i === 0 ? { backend: { renovacionDias: -5, proyeccion: false, notaCrm: 'no renueva' } } : i === 1 ? { backend: { renovacionDias: null, proyeccion: true, notaCrm: null } } : {}))
    const ids = filtrarListado(conMarca, { ...FILTROS_INICIALES, renovacion: true }).map(x => x.id)
    assert.deepEqual(ids, [conMarca[0].id])
    assert.equal(filtrosAParams({ ...FILTROS_INICIALES, renovacion: true }).get('renovacion'), '1')
    assert.equal(parsearFiltros({ renovacion: '1' }).renovacion, true)
  })
  test('marcas de Backend: una sola función para la página y la API (antes /api/clientes?renovacion=1 daba siempre 0)', () => {
    const clientes = [
      ...demo.clientes.map(c => (c.id === 'E004' ? { ...c, llamadaAgendada: ' no renueva ' } : c.id === 'E003' ? { ...c, llamadaAgendada: 'Agendada (10/9)' } : c)),
      { ...demo.clientes[1], id: 'C001', linea: 'consultora' },   // vence igual que E002, pero es de Consultora
    ]
    const marcas = marcasBackend(HOY, clientes)
    assert.deepEqual([...marcas.keys()].sort(), ['E001', 'E002', 'E004', 'E005'])   // E003 tiene nota pero no vence: sin marca
    assert.deepEqual(marcas.get('E004'), { renovacionDias: -5, proyeccion: false, notaCrm: 'no renueva' })
    assert.deepEqual(marcas.get('E002'), { renovacionDias: 6, proyeccion: true, notaCrm: null })
    assert.equal(marcaDe(marcas, clientes.at(-1)), null)                     // Consultora nunca tiene
    assert.equal(marcaDe(marcas, { linea: 'agencia', id: '' }), null)
    // Lo que arma la API (aListado + marcaDe) con ?renovacion=1: las cuatro, la vencida primero
    const filasApi = clientes.map((c, i) => aListado(c, i, undefined, undefined, { backend: marcaDe(marcas, c) }))
    assert.deepEqual(ordenarListado(filtrarListado(filasApi, parsearFiltros({ renovacion: '1' })), 'vencimiento').map(f => f.id), ['E004', 'E002', 'E005', 'E001'])
  })
  test('la API /api/clientes usa las marcas de Backend y rechaza los filtros que no puede calcular (guarda del código fuente)', () => {
    // El test de arriba arma a mano lo que hace la API: esto vigila que route.ts siga haciéndolo (si vuelve a llamar a
    // aListado sin las marcas, ?renovacion=1 da 0 otra vez; si se saca el 400, sincampana y sinrespuesta dan una lista vacía engañosa)
    const raiz = join(fileURLToPath(import.meta.url), '..', '..')
    const ruta = readFileSync(join(raiz, 'app', 'api', 'clientes', 'route.ts'), 'utf8')
    assert.match(ruta, /marcasBackend\(datos\.hoy, datos\.clientes\)/)
    assert.match(ruta, /aListado\(c, i, [^\n]*\{ backend: marcaDe\(marcas, c\) \}\)/)
    assert.match(ruta, /if \(filtros\.sinCampana \|\| filtros\.sinRespuesta\) return json\([^)]*\}, 400\)/)
    // y la página usa la misma regla pura de "sin respuesta este mes" (probada abajo), no una copia a mano
    // (25/10/2026: el armado de las filas pasó de page.tsx a _componentes/EnVivo.tsx, que la página usa por streaming)
    assert.match(readFileSync(join(raiz, 'app', '(shell)', 'clientes', '(cartera)', 'page.tsx'), 'utf8'), /<ListaEnVivo /)
    const pagina = readFileSync(join(raiz, 'app', '(shell)', 'clientes', '(cartera)', '_componentes', 'EnVivo.tsx'), 'utf8')
    assert.match(pagina, /sinRespuestaMes: sinRespuestaDelMes\(c, e, datos\.hoy, !!typeform\)/)
    assert.match(pagina, /backend: marcaDe\(marcas, c\)/)
  })
  test('"sin respuesta este mes": solo Agencia, con el Typeform conectado, clientes actuales sin respuesta ni puntaje del mes', () => {
    const nada = { respondioTypeformEsteMes: false, ultimo: null }
    const agencia = { linea: 'agencia', estado: 'ACTIVO' }
    assert.equal(sinRespuestaDelMes(agencia, nada, HOY, true), true)
    assert.equal(sinRespuestaDelMes({ linea: 'agencia', estado: 'PAUSADO' }, nada, HOY, true), true)
    // Consultora nunca (antes la alerta roja salía siempre: el Typeform solo se cruza con Agencia)
    assert.equal(sinRespuestaDelMes({ linea: 'consultora', estado: 'ACTIVO' }, nada, HOY, true), false)
    assert.equal(sinRespuestaDelMes(agencia, nada, HOY, false), false)                                   // sin Typeform no se sabe
    for (const estado of ['FINALIZADO', 'INACTIVO']) assert.equal(sinRespuestaDelMes({ linea: 'agencia', estado }, nada, HOY, true), false, estado)
    assert.equal(sinRespuestaDelMes(agencia, { respondioTypeformEsteMes: true, ultimo: null }, HOY, true), false)
    assert.equal(sinRespuestaDelMes(agencia, { respondioTypeformEsteMes: false, ultimo: { mes: HOY.slice(0, 7) } }, HOY, true), false)   // puntuado a mano este mes
    assert.equal(sinRespuestaDelMes(agencia, { respondioTypeformEsteMes: false, ultimo: { mes: '2026-09' } }, HOY, true), true)         // el del mes pasado no cuenta
  })
  test('chips de Mostrar: al pasar a Consultora se apagan los que solo existen en Agencia (antes la lista quedaba vacía)', () => {
    const conMarca = demo.clientes.map((c, i) => aListado(c, i, undefined, undefined, i === 3 ? { backend: { renovacionDias: -5, proyeccion: false, notaCrm: null } } : {}))
    const ambas = [...conMarca, { ...conMarca[0], clave: 'c0', id: 'C001', linea: 'consultora', backend: null }]
    const desdeBackend = parsearFiltros({ renovacion: '1' })                 // /backend → /clientes?renovacion=1
    assert.deepEqual(filtrarListado(ambas, desdeBackend).map(f => f.id), ['E004'])
    const enConsultora = { ...desdeBackend, ...cambioDeLinea('consultora') }
    assert.deepEqual(filtrarListado(ambas, enConsultora).map(f => f.id), ['C001'])
    for (const k of ['renovacion', 'sinCampana', 'sinRespuesta', 'conNoClientes']) assert.equal(enConsultora[k], false, k)
    assert.equal(enConsultora.closer, 'todos')
    assert.deepEqual(cambioDeLinea('agencia'), { linea: 'agencia', closer: 'todos' })   // volver a Agencia no apaga nada
  })
  test('renglón de resultados: dice qué chips de Mostrar están prendidos; "solo renovación" tiene su propio vacío', () => {
    assert.deepEqual(textoMostrar(FILTROS_INICIALES), [])
    assert.deepEqual(textoMostrar({ ...FILTROS_INICIALES, renovacion: true, vencen: 30, conNoClientes: true }), ['renovación pendiente', 'vencen en 30 días', 'con los no clientes'])
    assert.deepEqual(textoMostrar({ ...FILTROS_INICIALES, sinCampana: true, sinRespuesta: true }), ['sin campaña', 'sin respuesta este mes'])
    assert.equal(soloRenovacion(parsearFiltros({ renovacion: '1' })), true)
    assert.equal(soloRenovacion(parsearFiltros({ renovacion: '1', orden: 'nombre' })), true)   // el orden no es un filtro
    assert.equal(soloRenovacion(parsearFiltros({ renovacion: '1', q: 'ana' })), false)
    assert.equal(soloRenovacion(FILTROS_INICIALES), false)
  })
  test('sin URLSearchParams.size (Safari 16.4, que Next 16 soporta): hayParams y soloRenovacion responden igual', () => {
    // Antes `.size` daba undefined en esos navegadores: "Limpiar filtros" y el vacío de renovación no salían y el HTML del
    // servidor no coincidía con el del cliente al hidratar. Acá se saca el getter de verdad y se repone al final.
    const original = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size')
    delete URLSearchParams.prototype.size
    try {
      assert.equal(new URLSearchParams('a=1').size, undefined)   // el navegador viejo, simulado
      assert.equal(hayParams(filtrosAParams(FILTROS_INICIALES)), false)
      assert.equal(hayParams(filtrosAParams({ ...FILTROS_INICIALES, q: 'ana' })), true)
      assert.equal(hayParams(filtrosAParams({ ...FILTROS_INICIALES, renovacion: true })), true)
      assert.equal(soloRenovacion(parsearFiltros({ renovacion: '1' })), true)
      assert.equal(soloRenovacion(parsearFiltros({ renovacion: '1', orden: 'nombre' })), true)
      assert.equal(soloRenovacion(parsearFiltros({ renovacion: '1', q: 'ana' })), false)
      assert.equal(soloRenovacion(FILTROS_INICIALES), false)
    } finally {
      if (original) Object.defineProperty(URLSearchParams.prototype, 'size', original)
    }
    assert.equal(new URLSearchParams('a=1').size, 1)   // repuesto para el resto de las pruebas
  })
  test('saldo solo si pasa el umbral de USD 50', () => {
    assert.equal(UMBRAL_SALDO_USD, 50)
    assert.equal(filas[0].saldo, 2000)        // E001: 8.000 contratado − 6.000 cobrado
    assert.equal(filas[1].saldo, null)
  })
  test('filtros: estado, semáforo, closer, vencen en 30 días, búsqueda sin acentos', () => {
    const f = o => filtrarListado(filas, { ...FILTROS_INICIALES, ...o }).map(x => x.id)
    assert.equal(f({}).length, 9)
    assert.deepEqual(f({ semaforo: 'rojo' }), ['E004'])
    assert.deepEqual(f({ semaforo: 'amarillo' }), ['E002'])
    assert.deepEqual(f({ vencen: 30 }).sort(), ['E002', 'E005'])     // E004 ya venció: no entra; E001 vence en 40
    assert.ok(f({ vencen: 15 }).every(id => ['E002', 'E005'].includes(id)))
    // Vista por defecto = clientes actuales (activos y pausados); "todos" suma finalizados e inactivos
    const conFin = [...filas, { ...filas[0], clave: 'f', id: 'F01', estado: 'FINALIZADO' }]
    assert.equal(filtrarListado(conFin, FILTROS_INICIALES).some(x => x.id === 'F01'), false)
    assert.equal(filtrarListado(conFin, { ...FILTROS_INICIALES, estado: 'todos' }).some(x => x.id === 'F01'), true)
    const marcadas = filas.map((x, i) => ({ ...x, sinCampana: i === 0, sinRespuestaMes: i === 1 }))
    assert.deepEqual(filtrarListado(marcadas, { ...FILTROS_INICIALES, sinCampana: true }).map(x => x.id), [filas[0].id])
    assert.deepEqual(filtrarListado(marcadas, { ...FILTROS_INICIALES, sinRespuesta: true }).map(x => x.id), [filas[1].id])
    assert.deepEqual(f({ q: 'ejemplo TRES' }), ['E003']); assert.deepEqual(f({ q: 'e006' }), ['E006'])
    assert.deepEqual(f({ estado: 'FINALIZADO' }), [])
    assert.deepEqual(f({ linea: 'consultora' }), [])
    assert.ok(f({ closer: 'Gero' }).every(id => ['E001', 'E004'].includes(id)))
  })
  test('orden por vencimiento: primero lo urgente (vencidos arriba), luego el resto', () => {
    const o = ordenarListado(filas, 'vencimiento').map(x => x.id)
    assert.deepEqual(o, ['E004', 'E002', 'E005', 'E001', 'E003', 'E006', 'E007', 'E008', 'E009'])
  })
  test('orden: finalizados al final del más reciente al más viejo; pausados después de activos; sin fecha al fondo del grupo', () => {
    const base = { clave: 'x', id: '', linea: 'agencia', nombre: 'N', semaforo: null, closer: '', contratado: null, cobrado: null, saldo: null, credito: null, noCliente: false }
    const f = (id, estado, fin, dias) => ({ ...base, id, estado, fin, dias, nombre: id })
    const o = ordenarListado([
      f('F1', 'FINALIZADO', '2026-01-01', -200), f('F2', 'FINALIZADO', '2026-09-01', -35), f('P1', 'PAUSADO', '2026-10-20', 14),
      f('A1', 'ACTIVO', null, null), f('A2', 'ACTIVO', '2026-10-10', 4), f('I1', 'INACTIVO', null, null),
    ], 'vencimiento').map(x => x.id)
    assert.deepEqual(o, ['A2', 'A1', 'P1', 'F2', 'F1', 'I1'])
    assert.deepEqual(ordenarListado(filas, 'nombre').map(x => x.id), ['E005', 'E004', 'E002', 'E009', 'E008', 'E006', 'E007', 'E003', 'E001'])   // Cinco, Cuatro, Dos, Nueve, Ocho, Seis, Siete, Tres, Uno
    assert.deepEqual(ordenarListado(filas, 'cobrado').map(x => x.id), ['E006', 'E005', 'E001', 'E003', 'E002', 'E009', 'E008', 'E007', 'E004'])   // mayor cobrado primero; empate por nombre
    assert.deepEqual(ordenarListado(filas, 'id').map(x => x.id), ['E001', 'E002', 'E003', 'E004', 'E005', 'E006', 'E007', 'E008', 'E009'])
  })
  test('"no clientes" se ocultan salvo que se pidan; sin closer tiene su opción', () => {
    const extra = [...filas, { ...filas[0], clave: 'z', id: 'A999', noCliente: true, closer: '' }]
    assert.equal(filtrarListado(extra, FILTROS_INICIALES).some(x => x.id === 'A999'), false)
    assert.equal(filtrarListado(extra, { ...FILTROS_INICIALES, conNoClientes: true }).some(x => x.id === 'A999'), true)
    assert.deepEqual(filtrarListado(extra, { ...FILTROS_INICIALES, conNoClientes: true, closer: SIN_CLOSER }).map(x => x.id), ['A999'])
    const cl = closersDe(extra); assert.equal(cl[cl.length - 1].nombre, SIN_CLOSER)
  })
  test('filtros ↔ URL: ida y vuelta, y lo desconocido cae en el valor inicial', () => {
    const f = { ...FILTROS_INICIALES, q: 'ana', estado: 'ACTIVO', semaforo: 'rojo', closer: 'Gero', vencen: 30, sinCampana: true, sinRespuesta: true, linea: 'consultora', conNoClientes: true, orden: 'nombre' }
    assert.deepEqual(parsearFiltros(Object.fromEntries(filtrosAParams(f))), f)
    const todos = { ...FILTROS_INICIALES, estado: 'todos', vencen: 15 }
    assert.deepEqual(parsearFiltros(Object.fromEntries(filtrosAParams(todos))), todos)
    assert.equal(parsearFiltros({ vencen30: '1' }).vencen, 30)   // enlaces viejos
    assert.equal(filtrosAParams(FILTROS_INICIALES).toString(), '')
    assert.deepEqual(parsearFiltros({ estado: 'zzz', semaforo: 'azul', orden: 'raro', linea: 'x', vencen30: '7' }), FILTROS_INICIALES)
    assert.deepEqual(parsearFiltros({ q: ['a', 'b'] }).q, 'a')
  })
  test('texto de créditos', () => {
    assert.equal(textoCredito(null), '—')
    assert.equal(textoCredito({ meses: 2, usd: 0, renovacionGratis: false, mesesSobreRenovacion: 0 }), '2 meses')
    assert.equal(textoCredito({ meses: 4, usd: 300, renovacionGratis: true, mesesSobreRenovacion: 0 }), 'Renovación gratis + USD 300')
    assert.equal(textoCredito({ meses: 5, usd: 0, renovacionGratis: true, mesesSobreRenovacion: 1 }), 'Renovación gratis + 1 mes')
    assert.equal(textoCredito({ meses: 8, usd: 1650, renovacionGratis: true, mesesSobreRenovacion: 4 }), 'Renovación gratis + 4 meses + USD 1.650')
    assert.equal(textoCredito({ meses: 0, usd: 600, renovacionGratis: false, mesesSobreRenovacion: 0 }), 'USD 600')   // solo USD: se llevan aparte de los meses
    assert.equal(textoCredito({ meses: 0, usd: 0, renovacionGratis: false, mesesSobreRenovacion: 0 }), '0')
  })
  test('la fila del listado arma sus meses sobre la renovación y su saldo en USD desde el cálculo (E001: 5 meses = renovación gratis + 1, y USD 600)', () => {
    const e001 = filas.find(x => x.id === 'E001').credito, e002 = filas.find(x => x.id === 'E002').credito
    assert.deepEqual(e001, { meses: 5, usd: 600, renovacionGratis: true, mesesSobreRenovacion: 1 })
    assert.equal(textoCredito(e001), 'Renovación gratis + 1 mes + USD 600')
    assert.deepEqual(e002, { meses: 2, usd: 300, renovacionGratis: false, mesesSobreRenovacion: 0 })
    assert.equal(textoCredito(e002), '2 meses + USD 300')
    assert.equal(filas.find(x => x.id === 'E003').credito.meses, 1)
    assert.equal(textoCredito(filas.find(x => x.id === 'E005').credito), '0')   // el USD 300 de E005 ya se canjeó
    assert.equal(filas.find(x => x.id === 'E007').credito, null)   // sin actividad de referidos
  })
})

describe('pantalla de Clientes: foco y lectores de pantalla (guardas del código fuente)', () => {
  // Son componentes de cliente (JSX, next/link, acciones del servidor): no se pueden montar acá. Se vigila el código.
  const RAIZ = join(fileURLToPath(import.meta.url), '..', '..')
  const leer = (...p) => readFileSync(join(RAIZ, ...p), 'utf8')
  const lista = leer('app', '(shell)', 'clientes', '(cartera)', '_componentes', 'ListaClientes.tsx')
  const puntaje = leer('components', 'clientes', 'PuntajeRapido.tsx')

  test('la lista no usa URLSearchParams.size (no existe antes de Safari 17): "hay filtros" sale de hayParams', () => {
    assert.doesNotMatch(lista, /\)\.size\b/)
    assert.match(lista, /const hayFiltros = hayParams\(filtrosAParams\(/)
  })
  test('tarjeta del celular: nombre corto y, como descripción, ID y semáforo, la nota "Llamada agendada" y los datos', () => {
    // Con solo aria-labelledby el lector anunciaba "Nombre + insignias" y se perdían el <dl> y la nota (donde está "no renueva")
    assert.match(lista, /className="cj-tarjeta__enlace" aria-labelledby=\{nombreTarjeta\(f\)\} aria-describedby=\{descripcionTarjeta\(f\)\}/)
    const desc = lista.match(/const descripcionTarjeta = [^\n]+/)?.[0] ?? ''
    for (const id of ['cl-c-', 'cl-a-', 'cl-d-']) assert.ok(desc.includes(id), `la descripción no incluye ${id}`)
    assert.match(desc, /tieneNota\(f\) \? \[`cl-a-/)   // la nota solo si existe (un id que no está en la página no suma nada, pero ensucia)
    // cada id que nombran el nombre y la descripción existe en la tarjeta
    for (const id of ['cl-n-', 'cl-m-', 'cl-c-', 'cl-a-', 'cl-d-']) assert.match(lista, new RegExp(`(id|idNota)=\\{\`${id}\\$\\{f\\.clave\\}\`\\}`), id)
    assert.match(lista, /<dl id=\{`cl-d-\$\{f\.clave\}`\} className="cj-tarjeta__datos">/)
    assert.match(lista, /<div id=\{`cl-c-\$\{f\.clave\}`\} className="cj-tarjeta__cab">/)
    assert.match(lista, /<span id=\{idNota\} className="cj-sub">Llamada agendada:/)
  })
  // Arma un DOM de juguete: elementos con isConnected y contains, un <body> y un activeElement que se puede mover
  const domFalso = () => {
    const body = { nombre: 'body', isConnected: true }
    const doc = { body, activeElement: body }
    const el = (nombre, { conectado = true, hijos = [] } = {}) => {
      const e = { nombre, isConnected: conectado, enfocado: 0, focus() { e.enfocado++; doc.activeElement = e }, contains: x => x === e || hijos.includes(x) }
      return e
    }
    return { doc, body, el }
  }
  // Saca el cuerpo de un useEffect(() => { ... }, [deps]) del código fuente para correrlo con el DOM de juguete
  const cuerpoEfecto = (fuente, deps) => {
    const m = fuente.match(new RegExp(`useEffect\\(\\(\\) => \\{\\n([\\s\\S]*?)\\n  \\}, \\[${deps}\\]\\)`))
    assert.ok(m, `no encontré el useEffect con [${deps}]`)
    return m[1]
  }

  test('si el control enfocado desaparece (Limpiar filtros, Ver todos, un chip que solo se ve prendido, la fila puntuada que sale del filtro), el foco va al renglón de resultados', () => {
    assert.match(lista, /<p ref=\{refEstado\} tabIndex=\{-1\} className="cj-etiqueta" role="status"/)
    // el contenedor anota el último control enfocado (onFocus burbujea en React), también los números del puntaje rápido
    assert.match(lista, /<div className="cj-pila cj-pila--chica" style=\{\{ gap: 40 \}\} onFocus=\{e => \{ ultimoFoco\.current = e\.target \}\}>/)
    // el chequeo va atado a las filas visibles (no a los filtros): también cambian cuando el servidor manda filas nuevas al puntuar
    const rescatar = new Function('ultimoFoco', 'document', 'refEstado', cuerpoEfecto(lista, 'visibles'))
    const caso = ({ ultimo, activo }) => {
      const { doc, body, el } = domFalso()
      const estado = el('renglón de resultados')
      const u = ultimo === 'conectado' ? el('chip') : ultimo === 'desconectado' ? el('número de una fila que ya no está', { conectado: false }) : null
      doc.activeElement = activo === 'body' ? body : activo === 'nada' ? null : el('buscador')
      rescatar({ current: u }, doc, { current: estado })
      return estado.enfocado
    }
    assert.equal(caso({ ultimo: 'desconectado', activo: 'body' }), 1, 'el control se fue y el foco cayó en <body>')
    assert.equal(caso({ ultimo: 'desconectado', activo: 'nada' }), 1, 'sin elemento activo')
    assert.equal(caso({ ultimo: 'desconectado', activo: 'otro' }), 0, 'si el usuario ya está en otro lado no se le roba el foco')
    assert.equal(caso({ ultimo: 'conectado', activo: 'body' }), 0, 'el control sigue en la página: no hay nada que rescatar')
    assert.equal(caso({ ultimo: null, activo: 'body' }), 0, 'al montar no enfoca nada')
    assert.doesNotMatch(lista, /tocado\.current/)   // el mecanismo viejo (solo filtros) no quedó a medias
  })
  test('la fila puntuada que sale del filtro deja el aviso en el renglón de resultados (si no, «Puntaje N anotado.» se perdía)', () => {
    assert.equal((lista.match(/<PuntajeRapido [^>]*alGuardar=\{anotar\(f\)\} \/>/g) ?? []).length, 2, 'tabla y tarjetas avisan a la lista')
    assert.match(lista, /\{avisoFuera && <span className="cl-aviso">\{avisoFuera\}<\/span>\}\n {10}<\/p>/)   // dentro del renglón que toma el foco
    assert.match(lista, /const cambiar = \(parcial: Partial<FiltrosListado>\) => \{\n    setGuardado\(null\)/)   // al tocar filtros el aviso viejo se va
    const expr = lista.match(/const avisoFuera = ([^\n]+)/)?.[1]
    assert.ok(expr, 'no encontré avisoFuera')
    const aviso = new Function('guardado', 'visibles', `return ${expr}`)
    const g = { id: 'E001', nombre: 'Estudio Pérez', mensaje: 'Puntaje 8 anotado.' }
    assert.equal(aviso(g, [{ id: 'E002' }]), 'Puntaje 8 anotado. Estudio Pérez ya no aparece con estos filtros.')
    assert.equal(aviso(g, [{ id: 'E001' }, { id: 'E002' }]), null, 'si la fila sigue, el aviso lo da el propio puntaje')
    assert.equal(aviso(null, []), null)
    assert.match(puntaje, /const r = await puntuarCliente\(previo, datos\)\n    if \(r\.ok && r\.mensaje\) alGuardar\?\.\(r\.mensaje\)\n    return r/)
    assert.match(leer('app', '(shell)', 'pantallas.css'), /\.cl-aviso \{[^}]*text-transform: none;/)
  })
  test('puntaje rápido: al abrir, exactamente un número toma el foco, también con un 0 del Typeform', () => {
    const expr = puntaje.match(/autoFocus=\{([^}]+)\}/)?.[1]
    assert.ok(expr, 'no encontré el autoFocus de los números')
    const enfoca = new Function('n', 'valor', `return ${expr}`)
    for (const [valor, esperado] of [[null, 1], [0, 1], [1, 1], [7, 7], [10, 10]]) {
      const conFoco = Array.from({ length: 10 }, (_, i) => i + 1).filter(n => enfoca(n, valor))
      assert.deepEqual(conFoco, [esperado], `último puntaje ${valor}`)
    }
  })
  test('puntaje rápido: después de guardar bien el foco vuelve al chip (no solo al cancelar), salvo que el usuario ya esté en otra cosa', () => {
    assert.match(puntaje, /const cerrar = \(\) => \{ setAbierto\(false\); chipRef\.current\?\.focus\(\) \}/)
    assert.match(puntaje, /<div ref=\{cajaRef\} className="pt-caja">/)
    const volver = new Function('estado', 'document', 'cajaRef', 'chipRef', cuerpoEfecto(puntaje, 'estado'))
    const caso = ({ estado = { ok: true }, activo }) => {
      const { doc, body, el } = domFalso()
      const numero = el('número tocado')
      const chip = el('chip')
      const caja = el('caja del puntaje', { hijos: [numero, chip] })
      doc.activeElement = activo === 'body' ? body : activo === 'nada' ? null : activo === 'adentro' ? numero : el('chip de otro cliente')
      volver(estado, doc, { current: caja }, { current: chip })
      return chip.enfocado
    }
    assert.equal(caso({ activo: 'body' }), 1, 'el número desapareció con el formulario y el foco cayó en <body>')
    assert.equal(caso({ activo: 'nada' }), 1)
    assert.equal(caso({ activo: 'adentro' }), 1, 'el foco sigue en el número (deshabilitado mientras guardaba)')
    assert.equal(caso({ activo: 'afuera' }), 0, 'mientras guardaba el usuario siguió con otro cliente: no se le roba el foco')
    assert.equal(caso({ estado: {}, activo: 'body' }), 0, 'el estado inicial no enfoca nada al montar')
    assert.equal(caso({ estado: { error: 'No tenés permiso' }, activo: 'adentro' }), 0, 'con error el formulario sigue abierto')
  })
  test('enlaces de Prioridad y Guiones (.pr-enlace): latón y subrayado, con especificidad para ganarle a `.cj-raiz a`', () => {
    const css = leer('app', '(shell)', 'pantallas.css')
    const regla = css.match(/\.cj-raiz a\.pr-enlace \{([^}]*)\}/)?.[1] ?? ''
    assert.match(regla, /color: var\(--cj-laton\)/)
    assert.match(regla, /text-decoration: underline/)
    // la regla que les sacaba el color sigue teniendo especificidad (0,1,1): una regla de una sola clase no le alcanza
    assert.match(leer('app', '(shell)', 'cj.css'), /\.cj-raiz a:not\(:where\(\.crm-raiz a\)\) \{ color: inherit; \}/)
  })
})

describe('indicadores de la franja', () => {
  const ind = indicadoresDeCartera(demo.clientes, demo.referidos, HOY)
  test('activos, vencen en 30 días (sin vencidos), corte', () => {
    assert.equal(ind.activos, 9); assert.equal(ind.vencen30, 2); assert.equal(ind.corte30, '2026-11-05')
  })
  test('a cobrar: saldo de activos/pausados mayor a 50', () => { assert.equal(ind.aCobrarUSD, 5500); assert.equal(ind.conSaldo, 2) })   // E001 debe 2.000 y E004 debe 3.500
  test('tasa de renovación: renovó (R…) ÷ (renovó + no renovó con estado no activo)', () => {
    assert.equal(ind.renovadores, 2); assert.equal(ind.noRenovaron, 0); assert.equal(ind.tasaRenovacion, 100)
    const otros = demo.clientes.map(c => (c.id === 'E003' ? { ...c, estado: 'FINALIZADO', renovo: 'NO' } : c))
    const i2 = indicadoresDeCartera(otros, [], HOY)
    assert.equal(i2.noRenovaron, 1); assert.equal(Math.round(i2.tasaRenovacion), 67)
  })
})

describe('paso del programa de cada referido', () => {
  const p = (estado, o = {}) => pasoDelPrograma({ estado, fechaLlamada: null, fechaPrimerPago: null, reembolso: false, ...o }, HOY, R0)
  test('los cinco pasos y las salidas', () => {
    assert.equal(p('Presentado').numero, 1); assert.equal(p('No asistió').numero, 1)
    assert.equal(p('Asistió').numero, 2); assert.equal(p('No cerró').numero, 2)
    assert.equal(p('Cerró').numero, 3); assert.match(p('Cerró').detalle, /primer pago/)
    const esperando = p('Cerró', { fechaPrimerPago: '2026-10-01' })
    assert.equal(esperando.numero, 4); assert.match(esperando.detalle, /Se libera el 15\/10\/2026 \(en 9 días\)/)
    const liberado = p('Cerró', { fechaPrimerPago: '2026-09-01' })
    assert.equal(liberado.numero, 5); assert.match(liberado.detalle, /Vence el 15\/9\/2027/)
    assert.equal(p('Cerró', { fechaPrimerPago: '2026-09-01', reembolso: true }).titulo, 'Reembolsado')
    assert.equal(p('Descartado').numero, null); assert.equal(p('').titulo, 'Sin estado cargado')
  })
  test('crédito liberado pero ya canjeado en una renovación anterior, o vencido: no dice que "vence"', () => {
    const canjeado = pasoDelPrograma({ estado: 'Cerró', fechaLlamada: null, fechaPrimerPago: '2026-01-10', reembolso: false }, HOY, R0, '2026-03-01')
    assert.equal(canjeado.titulo, 'Crédito canjeado'); assert.match(canjeado.detalle, /renovación anterior/)
    const vencido = pasoDelPrograma({ estado: 'Cerró', fechaLlamada: null, fechaPrimerPago: '2025-08-01', reembolso: false }, HOY, R0)
    assert.equal(vencido.titulo, 'Crédito vencido'); assert.match(vencido.detalle, /Venció el 15\/8\/2026/)
    assert.equal(vencido.numero, 5)
  })
  test('el día 14 exacto ya está liberado, el 13 todavía no', () => {
    assert.equal(p('Cerró', { fechaPrimerPago: '2026-09-22' }).numero, 5)   // 22/9 + 14 = 6/10
    assert.equal(p('Cerró', { fechaPrimerPago: '2026-09-23' }).numero, 4)
  })
  test('"No cerró" dice que cuenta como intento; "Asistió" todavía sin resultado dice que no cuenta; ninguno habla de llamadas asistidas ni de grabación', () => {
    assert.match(p('No cerró').detalle, /Cuenta como intento: suma a la escalera de intentos; no hay crédito por cierre/)
    assert.equal(p('No cerró').titulo, 'Asistió y no cerró')
    assert.match(p('Asistió').detalle, /todavía no cuenta como intento ni como cierre/)
    for (const estado of ['Asistió', 'No cerró']) assert.doesNotMatch(p(estado).detalle, /grabaci|llamadas? asistidas?|cada 5/i)
  })
  test('presentado antes del inicio del programa: "Anterior al programa", sin paso y sin importar que haya cerrado', () => {
    const r = (o = {}) => pasoDelPrograma({ estado: 'Cerró', fechaPedido: '2026-09-30', fechaLlamada: '2026-10-02', fechaPrimerPago: '2026-10-03', reembolso: false, ...o }, '2026-11-20')   // reglas reales
    const antes = r(); assert.equal(antes.numero, null); assert.equal(antes.titulo, 'Anterior al programa'); assert.match(antes.detalle, /antes del 1\/10\/2026: no genera crédito/)
    assert.equal(r({ estado: 'Asistió' }).titulo, 'Anterior al programa')
    const desde = r({ fechaPedido: '2026-10-01' }); assert.equal(desde.numero, 5); assert.equal(desde.titulo, 'Crédito liberado')   // 3/10 + 14 = 17/10: ya pasó
    assert.equal(pasoDelPrograma({ estado: 'Presentado', fechaPedido: null, fechaLlamada: null, fechaPrimerPago: null, reembolso: false }, '2026-11-20').numero, 1)   // sin fecha no se descarta
  })
})

describe('resumen del programa con los datos de ejemplo', () => {
  const r = resumirPrograma({ clientes: demo.clientes, referidos: demo.referidos, movimientos: demo.movimientos, creditos, hoy: HOY, pestanasAusentes: demo.pestanasAusentes }, demo.reglas)
  test('embudo: el referido anterior al programa no entra y se informa aparte', () => {
    assert.deepEqual(r.embudo, { presentados: 31, asistieron: 28, cerraron: 12, liberados: 9 }); assert.equal(r.referidoresActivos, 6)
    assert.equal(r.anterioresAlPrograma, 2); assert.equal(r.programaDesde, demo.reglas.vigenteDesde)
    assert.equal(demo.referidos.length, 33)   // 31 + los 2 anteriores al programa (un cierre y un "no cerró")
    assert.equal(r.intentos, 13)               // los "No cerró" desde el inicio del programa: el anterior al programa no cuenta
  })
  test('créditos: otorgados incluyen lo canjeado; por vencer usa la escalera y el mes del intento 5; los USD van aparte', () => {
    assert.equal(r.creditos.canjeadosMeses, 1); assert.equal(r.creditos.disponiblesMeses, 10); assert.equal(r.creditos.otorgadosMeses, 11)   // E001 5 + E002 2 + E003 1 + E006 2 = 10
    assert.equal(r.creditos.porVencerMeses, 1); assert.equal(r.creditos.diasAviso, DIAS_AVISO_VENCIMIENTO); assert.equal(r.creditos.valorMesUSD, 650)
    assert.equal(r.creditos.usdDisponible, 1200); assert.equal(r.creditos.usdCanjeado, 300)   // E001 600 + E002 300 + E006 300; el canje de E005 dice "USD 300"
    assert.equal(r.creditos.usdPorVencer, 300)                                                  // el USD 300 de E006 vence en 25 días
  })
  test('ranking: ordenado por liberados y cerrados', () => {
    assert.equal(r.ranking[0].idCliente, 'E001'); assert.equal(r.ranking[0].meses, 5); assert.equal(r.ranking[0].renovacionGratis, true)
    assert.ok(r.ranking.every((f, i, a) => i === 0 || a[i - 1].liberados >= f.liberados))
    assert.equal(r.ranking.find(f => f.idCliente === 'E004').presentados, 4)   // R013, R014, R015 y R027: el R023 y el R028 son anteriores al programa
    assert.equal(r.ranking[0].intentos, 5); assert.equal(r.ranking[0].usd, 600)
    assert.equal(r.ranking.find(f => f.idCliente === 'E004').intentos, 0)      // su "Asistió" no es un intento y su "No cerró" es anterior al programa
  })
  test('cerca del próximo nivel: los que tienen un cierre más a mano', () => {
    const ids = r.cerca.map(c => c.idCliente)
    assert.ok(ids.includes('E002') && ids.includes('E003') && ids.includes('E006'))
    assert.ok(!ids.includes('E001'))                                   // ya está en el último escalón
    assert.equal(r.cerca.find(c => c.idCliente === 'E002').faltan, 0)  // el tercer cierre se libera en 9 días
  })
  test('mesesPorVencer: pierde la diferencia de la escalera (y de las llamadas), no un mes por cierre', () => {
    const e006 = creditos.get('E006')
    assert.equal(mesesPorVencer(e006, 60, demo.reglas), 1)      // 2 cierres → 1: pasa de 2 meses a 1
    assert.equal(mesesPorVencer(e006, 5, demo.reglas), 0)       // nada vence en 5 días
    const e001 = creditos.get('E001')
    assert.equal(mesesPorVencer(e001, 400, demo.reglas), 5)     // vencen los tres cierres (4 meses) y el mes de las llamadas → de 5 a 0
    assert.equal(mesesPorVencer(e001, 100, demo.reglas), 0)     // en 100 días no vence nada de E001
    assert.equal(mesesPorVencer(e001, 260, demo.reglas), 2)     // vence el primer cierre (el 22/6/2027, a los 259 días): 3 cierres → 2 baja la escalera de 4 a 2 meses; el mes por llamadas sigue (de 5 a 3)
  })
  test('valor de referencia de la escalera: USD 650 por mes y la renovación gratis en pago único o plan de pagos', () => {
    assert.deepEqual(REGLAS_REFERIDOS.escalera.map(p => valorDelPaso(p).pagoUnicoUSD), [650, 1300, 2600])
    assert.deepEqual(REGLAS_REFERIDOS.escalera.map(p => valorDelPaso(p).planDePagosUSD), [650, 1300, 3800])
  })
  test('el KPI del mes: 1 de 3 clientes nuevos de octubre entró por referido (33 %) contra una meta del 5 %', () => {
    assert.equal(r.kpi.mes, '2026-10'); assert.equal(r.kpi.estado, 'ok'); assert.equal(r.kpi.clientesNuevos, 3); assert.equal(r.kpi.porReferido, 1)
    assert.ok(Math.abs(r.kpi.porcentaje - 100 / 3) < 1e-9); assert.equal(r.kpi.meta.minPct, 5); assert.equal(r.kpi.cumpleMeta, true); assert.equal(r.kpi.cierresSinCliente, 0)
  })
  test('el KPI sin la pestaña Referidos queda "sin datos", no en 0 %', () => {
    const sin = resumirPrograma({ clientes: demo.clientes, referidos: [], movimientos: [], creditos: new Map(), hoy: HOY, pestanasAusentes: ['Referidos', 'Créditos'] })
    assert.equal(sin.kpi.estado, 'sin_pestana'); assert.equal(sin.kpi.porcentaje, null); assert.equal(sin.kpi.meta.minPct, 5)
    assert.equal(resumirPrograma({ clientes: [], referidos: [], movimientos: [], creditos: new Map(), hoy: HOY }).kpi.estado, 'sin_clientes_nuevos')
  })
  test('un referido que ya es contacto del CRM no suma (lead nuevo) y avisa', () => {
    const d = crearDatosDemo(HOY)
    d.referidos[0].telefono = d.clientes[1].celular    // el teléfono de otro cliente
    const c = calcularCreditosDeDatos(d)
    assert.equal(c.get('E001').cierresLiberados, 2)
    assert.ok(c.get('E001').advertencias.some(a => /no es un referido válido/.test(a)))
  })
  test('sin pestañas todo da cero (no inventa)', () => {
    const vacio = resumirPrograma({ clientes: demo.clientes, referidos: [], movimientos: [], creditos: new Map(), hoy: HOY })
    assert.deepEqual(vacio.embudo, { presentados: 0, asistieron: 0, cerraron: 0, liberados: 0 }); assert.equal(vacio.ranking.length, 0); assert.equal(vacio.cerca.length, 0)
  })
})

describe('ficha del cliente (la usan la página y la API)', () => {
  const ficha = (id, conContacto = true) => armarFicha(demo, creditos, id, { conContacto })
  test('ID válido y búsqueda sin distinguir mayúsculas', () => {
    assert.ok(ID_CLIENTE_VALIDO.test('A012') && ID_CLIENTE_VALIDO.test('c3'))
    assert.ok(!ID_CLIENTE_VALIDO.test('A') && !ID_CLIENTE_VALIDO.test('../etc') && !ID_CLIENTE_VALIDO.test('A1234567'))
    assert.equal(ficha('e001').id, 'E001'); assert.equal(ficha('Z999'), null)
  })
  test('el contacto solo viaja con permiso', () => {
    assert.ok(ficha('E001', true).contacto.telefonos.length === 1)
    assert.equal(ficha('E001', false).contacto, null)
    assert.ok(!JSON.stringify(ficha('E001', false)).includes('5550'))
  })
  test('no expone la fila de la planilla ni el teléfono o mail de los referidos', () => {
    const j = JSON.stringify(ficha('E002', true))
    assert.ok(!j.includes('5551') && !/"fila"/.test(j) && !/gameplan/.test(j))
  })
  test('períodos: tipo, título y período actual', () => {
    const f = ficha('E001'); assert.deepEqual(f.periodos.map(p => p.tipo), ['inicial', 'renovacion', 'extension'])
    assert.deepEqual(f.periodos.map(p => p.titulo), ['Período inicial', 'Renovación 1', 'Extensión de servicio'])
    assert.equal(f.periodos.filter(p => p.actual).length, 1); assert.equal(f.periodos[1].actual, true)
  })
  test('cobros: saldo nunca negativo y solo "relevante" sobre el umbral', () => {
    const f = ficha('E001'); assert.equal(f.cobros.saldo, 2000); assert.equal(f.cobros.saldoRelevante, true); assert.equal(f.cobros.proximoCobroDias, 9)
    assert.equal(ficha('E002').cobros.saldoRelevante, false)
  })
  test('créditos y referidos con su paso', () => {
    const f = ficha('E002'); assert.equal(f.creditos.nivel, 2); assert.equal(f.creditos.mesesDisponibles, 2)   // 2 por los cierres; con 2 intentos todavía no hay mes
    assert.equal(f.creditos.referidos.length, 5); assert.equal(f.creditos.movimientos.length, 2)
    // el ciclo de E005 empezó con un canje: su cierre anterior figura como canjeado, no como "vence"
    assert.equal(ficha('E005').creditos.referidos.find(r => r.id === 'R017').paso.titulo, 'Crédito canjeado')
    assert.deepEqual(f.creditos.referidos.map(r => r.paso.numero).sort(), [2, 2, 4, 5, 5])
    assert.equal(f.creditos.cierresPendientes[0].idReferido, 'R008')
    assert.equal(f.creditos.proximoNivel.cierresFaltantes, 1)
  })
  test('el panel de créditos trae todo lo nuevo: saldo en meses y en USD, intentos y premios, extra, zona, vencimiento y valores', () => {
    const e001 = ficha('E001').creditos
    assert.equal(e001.mesesDisponibles, 5); assert.equal(e001.renovacionGratis, true); assert.equal(e001.mesesExtraSobreRenovacion, 1)
    assert.equal(e001.mesesPorCierres, 4); assert.equal(e001.mesesPorIntentos, 1); assert.equal(e001.mesesSobreTope, 0); assert.equal(e001.topeMeses, null)
    assert.equal(e001.valorUSD, 2600 + 650); assert.equal(e001.valorPlanDePagosUSD, 3800 + 650)
    assert.deepEqual(e001.usd, { ganado: 600, usado: 0, vencido: 0, disponible: 600 })
    assert.equal(e001.intentos, 5); assert.equal(e001.zona, 'buenos_aires')
    assert.deepEqual(e001.premiosIntentos.map(p => [p.intento, p.texto, p.estado]), [
      [1, 'Página web completa', 'vigente'], [2, 'Crédito de USD 300', 'vigente'], [3, 'Branding completo', 'vigente'], [4, 'Crédito de USD 300', 'vigente'], [5, '1 mes de servicio', 'vigente'],
    ])
    assert.equal(e001.paginaWeb.vigente, true); assert.equal(e001.branding.vigente, true)
    assert.deepEqual(e001.proximosPremios, [{ intento: 6, texto: 'Crédito de USD 150' }, { intento: 7, texto: 'Crédito de USD 150' }, { intento: 8, texto: 'Crédito de USD 150' }])
    assert.equal(e001.nivel, 3); assert.equal(e001.nivelesTotal, 3); assert.deepEqual(e001.extras, [])
    assert.deepEqual([e001.proximoVencimiento.cierres, e001.proximoVencimiento.entregables, e001.proximoVencimiento.dias], [0, 1, 185])   // el primero en vencer es la página web (intento 1)
    const e002 = ficha('E002').creditos
    assert.deepEqual(e002.extras, ['identidad_marca_completa']); assert.match(textoExtra(e002.extras[0]), /Identidad de marca completa \(alcance, responsable y plazo por definir\)/)
    assert.equal(e002.valorUSD, 2 * 650); assert.equal(e002.valorPlanDePagosUSD, 2 * 650)   // sin renovación gratis las dos formas de pago valen igual
    assert.deepEqual(e002.usd, { ganado: 300, usado: 0, vencido: 0, disponible: 300 }); assert.equal(e002.intentos, 2); assert.equal(e002.mesesPorIntentos, 0)
    assert.deepEqual(e002.proximosPremios.map(p => p.texto), ['Branding completo', 'Crédito de USD 300', '1 mes de servicio'])
    const e003 = ficha('E003').creditos   // Córdoba: la zona no se puede deducir; un intento (página web)
    assert.equal(e003.zona, 'sin_determinar'); assert.equal(e003.intentos, 1); assert.deepEqual(e003.usd, { ganado: 0, usado: 0, vencido: 0, disponible: 0 }); assert.equal(e003.paginaWeb.vigente, true)
    const e005 = ficha('E005').creditos   // el USD 300 del ciclo anterior ya se canjeó; la web y el branding siguen vigentes
    assert.deepEqual(e005.usd, { ganado: 300, usado: 300, vencido: 0, disponible: 0 }); assert.equal(e005.nivel, 0); assert.equal(e005.cierresReembolsados, 1); assert.equal(e005.zona, 'sin_determinar')
    assert.deepEqual(e005.premiosIntentos.map(p => p.estado), ['vigente', 'canjeado', 'vigente']); assert.equal(e005.proximoVencimiento.dias, 65)
    // el canje de la página web (un extra) no cortó el ciclo: sigue en el 1.º canje contra la renovación
    assert.equal(e005.cicloDesde, sumarDias(HOY, -250))
    const e006 = ficha('E006').creditos   // la web vence en 15 días y los USD 300 en 25
    assert.equal(e006.proximoVencimiento.dias, 15); assert.equal(e006.proximoVencimiento.entregables, 1); assert.equal(e006.usd.disponible, 300)
    const e004 = ficha('E004').creditos   // su "Asistió" no cuenta como intento
    assert.equal(e004.intentos, 0); assert.deepEqual(e004.premiosIntentos, []); assert.equal(e004.zona, 'buenos_aires')
  })
  test('un referido anterior al programa se muestra como tal en la ficha y no suma', () => {
    const e004 = ficha('E004').creditos
    assert.equal(e004.anterioresAlPrograma, 2); assert.equal(e004.programaDesde, demo.reglas.vigenteDesde)
    const r23 = e004.referidos.find(r => r.id === 'R023'); assert.equal(r23.paso.titulo, 'Anterior al programa'); assert.equal(r23.paso.numero, null)
    assert.equal(e004.referidos.find(r => r.id === 'R028').paso.titulo, 'Anterior al programa')   // un "no cerró" anterior no es un intento
    assert.equal(e004.mesesDisponibles, 0); assert.equal(e004.cierresLiberados, 0)
  })
  test('la ficha usa las reglas de los datos (la demo) y, si no traen, las reales', () => {
    assert.equal(ficha('E001').reglas.version, 'final-2026-10-08'); assert.equal(ficha('E001').reglas.estado, 'vigente')
    const sinReglas = { ...crearDatosDemo(HOY), reglas: undefined }   // con las reales los referidos del ejemplo son anteriores al programa
    const f = armarFicha(sinReglas, calcularCreditosDeDatos(sinReglas), 'E001', { conContacto: false })
    assert.equal(f.creditos.mesesDisponibles, 0); assert.equal(f.creditos.anterioresAlPrograma, 10); assert.equal(f.creditos.programaDesde, '2026-10-01')
    assert.equal(f.creditos.intentos, 0); assert.equal(f.creditos.usd.disponible, 0); assert.equal(f.creditos.paginaWeb, null)   // todos anteriores: sin premios
  })
  test('cliente sin actividad de referidos: saldo cero y nivel 0, sin romper', () => {
    const d = crearDatosDemo(HOY); const f = armarFicha(d, new Map(), 'E003', { conContacto: true })
    assert.equal(f.creditos.mesesDisponibles, 0); assert.equal(f.creditos.nivel, 0); assert.equal(f.creditos.proximoVencimiento, null)
  })
  test('con las pestañas ausentes lo informa', () => {
    const d = { ...crearDatosDemo(HOY), pestanasAusentes: ['Referidos', 'Créditos'], referidos: [], movimientos: [] }
    assert.deepEqual(armarFicha(d, new Map(), 'E001', { conContacto: true }).creditos.pestanasAusentes, ['Referidos', 'Créditos'])
  })
})

describe('demo: solo fuera de producción', () => {
  test('?demo=1 se ignora en producción y se respeta en desarrollo', () => {
    const antes = { n: process.env.NODE_ENV, v: process.env.VERCEL_ENV }
    try {
      process.env.NODE_ENV = 'development'; delete process.env.VERCEL_ENV
      assert.equal(demoPermitido(), true); assert.equal(pedidoDemo('1'), true); assert.equal(pedidoDemo(['1']), true); assert.equal(pedidoDemo('0'), false); assert.equal(pedidoDemo(undefined), false)
      process.env.NODE_ENV = 'production'
      assert.equal(demoPermitido(), false); assert.equal(pedidoDemo('1'), false)
      process.env.NODE_ENV = 'development'; process.env.VERCEL_ENV = 'production'
      assert.equal(pedidoDemo('1'), false)
    } finally {
      if (antes.n === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antes.n
      if (antes.v === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = antes.v
    }
  })
  test('todo lo ficticio está rotulado "(ejemplo)" y no usa IDs reales', () => {
    assert.ok(demo.clientes.every(c => /\(ejemplo\)$/.test(c.nombre) && /^E\d{3}$/.test(c.id)))
    assert.ok(demo.referidos.every(r => /\(ejemplo\)/.test(r.nombre)))
  })
  test('calcularCreditos sigue siendo coherente con el libro de demo (sin advertencias de control cruzado)', () => {
    for (const [id, res] of creditos) assert.ok(!res.advertencias.some(a => /libro de Créditos/.test(a)), `${id}: ${res.advertencias.join(' | ')}`)
    assert.ok(calcularCreditos({ idCliente: 'E001', referidos: demo.referidos, movimientos: demo.movimientos, hoy: HOY }, demo.reglas).renovacionGratis)
  })
  test('el ejemplo usa las reglas reales y solo adelanta el inicio del programa (14 meses antes de hoy) para poder mostrar créditos liberados', () => {
    assert.deepEqual({ ...demo.reglas, vigenteDesde: null }, { ...REGLAS_REFERIDOS, vigenteDesde: null })
    assert.equal(demo.reglas.vigenteDesde, '2025-08-06'); assert.deepEqual(reglasDeDemo(HOY), demo.reglas)
    assert.ok(demo.reglas.vigenteDesde < REGLAS_REFERIDOS.vigenteDesde)
    assert.equal(REGLAS_REFERIDOS.vigenteDesde, '2026-10-01')   // las reales no se tocan
  })
  test('el ejemplo muestra cada situación de las dos escaleras: renovación gratis + 5 intentos (mes extra y USD 600), nivel 2 con 2 intentos, nivel 1 con la web, premios canjeados y por vencer', () => {
    const por = id => creditos.get(id)
    assert.equal(por('E001').nivel, 3); assert.equal(por('E001').mesesGanados, 5); assert.equal(por('E001').intentos, 5); assert.equal(por('E001').mesesPorIntentos, 1); assert.equal(por('E001').usd.disponible, 600)
    assert.equal(por('E002').nivel, 2); assert.equal(por('E002').mesesPorIntentos, 0); assert.equal(por('E002').mesesGanados, 2); assert.equal(por('E002').usd.disponible, 300)
    assert.equal(por('E003').nivel, 1); assert.equal(por('E003').mesesGanados, 1); assert.equal(por('E003').intentos, 1)
    assert.equal(por('E004').nivel, 0); assert.equal(por('E004').intentos, 0); assert.equal(por('E005').nivel, 0); assert.equal(por('E005').usd.usado, 300)
    assert.equal(por('E006').usd.disponible, 300)
    assert.deepEqual(['E001', 'E002', 'E003', 'E004', 'E005', 'E006'].map(id => por(id).zona), ['buenos_aires', 'buenos_aires', 'sin_determinar', 'buenos_aires', 'sin_determinar', 'buenos_aires'])
    assert.ok(demo.clientes.filter(c => c.dia1 && c.dia1.startsWith('2026-10')).length === 3)   // E007 a E009: los clientes nuevos del mes
  })
})

describe('reglas del 7/10/2026: nada de las reglas viejas en el código, las pantallas ni los documentos', () => {
  const RAIZ = join(fileURLToPath(import.meta.url), '..', '..')
  const leer = rel => readFileSync(join(RAIZ, rel), 'utf8')
  const tsx = dir => readdirSync(join(RAIZ, dir), { recursive: true }).filter(n => /\.tsx?$/.test(n)).map(n => join(dir, n))
  const FUENTES = [
    ...readdirSync(join(RAIZ, 'lib', 'clientes')).filter(n => /\.ts$/.test(n) && n !== 'precios.ts').map(n => join('lib', 'clientes', n)),   // precios.ts es la tabla de precios de las altas: otra cosa
    // Cartera, ficha y Referidos (desde el 25/10/2026 Referidos es una pestaña bajo /clientes; Edición no es de referidos)
    ...tsx(join('app', '(shell)', 'clientes')).filter(f => !f.startsWith(join('app', '(shell)', 'clientes', 'edicion'))),
    join('docs', 'CRM-CLIENTES-TABS.md'), join('docs', 'REGLAS-REFERIDOS.md'), join('docs', 'SPEC-PESTANAS-REFERIDOS-CREDITOS.md'),
  ]
  const OBSOLETO = [
    [/grabacionPorLlamada|GrabacionPorLlamada|una_por_ciclo|cada_llamada/, 'regla vieja de 1 grabación por cada llamada'],
    [/eleccionNivel1|EleccionNivel1|alternativaGrabacion|grabacionesPorNivel|\bporNivel\b|\bporAsistencia\b/, 'elección de grabación en el nivel 1'],
    [/a_definir|extra a definir|["']a definir["']/i, 'extra del nivel 2 "a definir" (ya es la identidad de marca)'],
    [/valorNetoUSD/, 'valor neto de la renovación de USD 4.000'],
    [/topeMesesAcumulados:\s*12|12 meses acumulados|hasta 12 meses|tope de 12/i, 'tope de 12 meses'],
    [/8 meses de la renovaci|Renovación gratis \(8 meses|renovación gratis de 8 meses/i, 'renovación gratis de 8 meses'],
    [/1 mes = USD 500|USD 500\b|valorMesUSD:\s*500/, 'mes de USD 500'],
    [/borrador-2026-10-06|final-2026-10-06/, 'versión vieja de las reglas'],
    // Regla vieja de llamadas asistidas (se eliminó el 7/10/2026): contadores, meses por llamadas, grabación con la primera llamada
    [/llamadasAsistidas|mesesPorLlamadas|mesesLlamadas|llamadasPorMes|llamadasParaProximoMes|fechasDeMesesPorLlamadas|grabacionEnPrimeraLlamada|contadorReiniciaPorCiclo|\bgrabaciones\b|textoMesesLlamadas|grabacionesTexto/, 'contadores o parámetros de la regla de llamadas'],
    [/1 mes cada \d+ llamadas|cada \d+ llamadas|cada \d+ suman 1 mes|llamadas? asistidas?|Llamadas con asistencia|Meses por llamadas|Premio por llamada/i, 'textos de la regla de llamadas'],
    [/primera llamada asistida|con la primera llamada|grabación (ganada|disponible)|se gana con la primera|1 grabación con cámara/i, 'grabación en la primera llamada'],
    [/descuento_referido|descuentoAnteriorUSD|viaje_grabacion|contador_llamadas|quién paga el traslado|Viaje para la grabación/, 'dudas viejas (descuento sin confirmar, viaje, contador de llamadas)'],
    [/descuento[^.\n]{0,80}(sin confirmar|no está confirmado|no se muestra como beneficio)|El descuento no está confirmado/i, 'descuento sin confirmar'],
  ]
  for (const rel of FUENTES) {
    test(`${rel} no menciona las reglas viejas`, () => {
      const fuente = leer(rel)
      for (const [re, que] of OBSOLETO) assert.doesNotMatch(fuente, re, `${rel} todavía menciona: ${que}`)
    })
  }
  test('el guard sí detecta las reglas viejas (no es un test vacío)', () => {
    const viejos = ['1 mes cada 5 llamadas', 'grabación en la primera llamada asistida', 'llamadasAsistidas', 'El descuento no está confirmado', 'final-2026-10-06', 'Meses por llamadas']
    for (const t of viejos) assert.ok(OBSOLETO.some(([re]) => re.test(t)), t)
  })
  test('las dudas abiertas de /referidos salen de la configuración, sin textos propios', () => {
    const fuente = leer(join('app', '(shell)', 'clientes', 'referidos', '_componentes', 'ReglasPrograma.tsx'))
    assert.match(fuente, /R\.dudasAbiertas\.map/)
    assert.equal((fuente.match(/<li\b/g) ?? []).length, 1)    // una sola lista: la de las dudas
    assert.doesNotMatch(fuente, /USD 300|300 de descuento|USD 150/)   // los montos salen de la configuración, no están escritos en la pantalla
  })
  test('/referidos muestra las dos escaleras, los beneficios del referido con su condición y la grabación por zona, todo desde la configuración', () => {
    const fuente = leer(join('app', '(shell)', 'clientes', 'referidos', '_componentes', 'ReglasPrograma.tsx'))
    assert.match(fuente, /R\.intentos\.escalera/); assert.match(fuente, /R\.escalera/)
    assert.match(fuente, /R\.referido\.descuentoUSD/); assert.match(fuente, /R\.referido\.soloEnLlamada/)
    assert.match(fuente, /m[aá]s de servicio al cerrar, aplicado autom[aá]ticamente/)
    assert.match(fuente, /No obtiene el descuento; el mes extra se aplica si cierra despu[eé]s/)
    assert.match(fuente, /R\.grabacion\.lugar/); assert.match(fuente, /el closer lo ofrece/); assert.match(fuente, /solo una pista/)
    assert.match(fuente, /Escalera por intentos/); assert.match(fuente, /Escalera por cierres liberados/)
    assert.doesNotMatch(fuente, /\b(150|300)\b/)
  })
  test('/referidos y la ficha leen las reglas de la configuración: sin los números de las escaleras escritos a mano', () => {
    for (const rel of [join('app', '(shell)', 'clientes', 'referidos', '_componentes', 'ReglasPrograma.tsx'), join('app', '(shell)', 'clientes', '[id]', '_componentes', 'Creditos.tsx')])
      assert.doesNotMatch(leer(rel), /\b(650|2\.600|3\.800|446|150|300)\b|2600|3800/, rel)
  })
  test('estado vacío honesto: con la pestaña Referidos vacía dice "Sin registros todavía" (no ceros como saldo confirmado)', () => {
    assert.match(leer(join('app', '(shell)', 'clientes', 'referidos', '_componentes', 'ResumenReferidos.tsx')), /Sin registros todavía: la pestaña “Referidos” existe pero está vacía/)
    assert.match(leer(join('app', '(shell)', 'clientes', '[id]', '_componentes', 'PanelReferidos.tsx')), /Sin registros todavía/)
    // y los números: sin filas no hay embudo, ni créditos, ni USD (todo en cero, y la pantalla no los muestra como datos)
    const vacio = resumirPrograma({ clientes: demo.clientes, referidos: [], movimientos: [], creditos: new Map(), hoy: HOY, pestanasAusentes: [] })
    assert.deepEqual(vacio.embudo, { presentados: 0, asistieron: 0, cerraron: 0, liberados: 0 }); assert.equal(vacio.intentos, 0)
    assert.deepEqual([vacio.creditos.usdDisponible, vacio.creditos.usdCanjeado, vacio.creditos.usdPorVencer, vacio.creditos.disponiblesMeses], [0, 0, 0, 0])
    assert.equal(vacio.kpi.estado, 'ok'); assert.equal(vacio.kpi.porReferido, 0)
  })
  test('la ficha y /referidos muestran la misma lista de 10 dudas, en este orden, sin identificadores de código', () => {
    const f = armarFicha(demo, creditos, 'E001', { conContacto: false })
    assert.equal(f.panel.dudasAbiertas.length, 10)
    assert.deepEqual(f.panel.dudasAbiertas, REGLAS_REFERIDOS.dudasAbiertas.map(d => d.texto))
    assert.deepEqual(REGLAS_REFERIDOS.dudasAbiertas.map(d => d.clave), [
      'dias_liberacion', 'reembolso_posterior', 'vigencia_desde', 'otro_estudio', 'contador_intentos', 'credito_150_sin_tope',
      'cerro_en_llamada', 'zona_buenos_aires', 'credito_usd_en_libro', 'entregables',
    ])
    assert.ok(f.panel.dudasAbiertas.every(t => !/[a-z]+_[a-z_]+|[a-z]+[A-Z][a-zA-Z]+/.test(t)))
  })
})

describe('marca: cj.css y las fuentes de Capital Jurídico no se cuelan en el layout raíz ni en el 404', () => {
  // Lo que importa un archivo que cuelga del layout raíz (app/layout.tsx, app/not-found.tsx) se precarga en TODAS las páginas.
  // Desde el 7/10/2026 Finanzas y Anuncios SÍ llevan la marca, a propósito, a través de components/shell/MarcoOpcional.tsx
  // (que importa MarcoShell, cj.css y la fuente): ver el bloque de abajo. El layout raíz y el 404 no.
  const RAIZ = join(fileURLToPath(import.meta.url), '..', '..')
  const archivos = (dir) => readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(tsx?|css)$/.test(n) ? [ruta] : []
  })
  const importsDe = (fuente) => [
    ...[...fuente.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...fuente.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
  ]
  const MARCA = /(^|\/)(cj|pantallas)\.css$|\/fuentes$/
  // El 404 y el layout raíz comparten árbol con todo; "/" importa el shell a mano (por eso está acá: tiene que seguir así)
  const SUELTOS = ['app/layout.tsx', 'app/not-found.tsx']

  for (const rel of SUELTOS) {
    test(`${rel} no importa estilos ni fuentes de la marca nueva`, () => {
      const malos = importsDe(readFileSync(join(RAIZ, rel), 'utf8')).filter((e) => MARCA.test(e))
      assert.deepEqual(malos, [], `${rel} importa ${malos.join(', ')}: se cargaría en las páginas viejas. La marca va dentro de app/(shell).`)
    })
  }
  test('Finanzas y Anuncios: marco opcional (no cambia quién entra), tema verde y sin login de Google en las páginas', () => {
    const lee = (...p) => readFileSync(join(RAIZ, ...p), 'utf8')
    for (const [carpeta, seccion] of [['finanzas', 'finanzas'], ['anuncios', 'anuncios']]) {
      const layout = lee('app', carpeta, 'layout.tsx')
      // Anuncios además dibuja las pestañas del hub Clientes (solo con sesión de Google: hubClientes)
      assert.match(layout, new RegExp(`<MarcoOpcional seccion="${seccion}"${seccion === 'anuncios' ? ' hubClientes' : ''}>`), `${carpeta}/layout.tsx tiene que envolver con MarcoOpcional`)
      for (const rel of archivos(join(RAIZ, 'app', carpeta)).filter((f) => /page\.tsx$/.test(f))) {
        const fuente = readFileSync(rel, 'utf8')
        assert.doesNotMatch(fuente, /obtenerSesion|exigirAcceso/, `${rel}: Finanzas y Anuncios se abren con su contraseña, sin pedir Google`)
      }
    }
    const marco = lee('components', 'shell', 'MarcoOpcional.tsx')
    assert.doesNotMatch(marco, /redirect\(|notFound\(/, 'MarcoOpcional no puede redirigir ni cerrar nada: solo decide si dibuja el marco')
    assert.match(marco, /return <main[^>]*>\{children\}<\/main>/, 'sin sesión de Google la pantalla se muestra sola')
    assert.match(lee('components', 'finanzas', 'Tema.tsx'), /\.fin-verde[\s\S]*#08382f/, 'Finanzas es verde')
    assert.match(lee('app', 'anuncios', 'layout.tsx'), /--tinta: #08382f/, 'Anuncios es verde')
  })
  test('el marco no deja <main> anidados: las pantallas de Anuncios y Finanzas usan <div>', () => {
    for (const rel of ['components/anuncios/TableroAnuncios.tsx', 'app/anuncios/login/page.tsx', 'components/finanzas/FinanzasDashboard.tsx', 'components/finanzas/FormularioClave.tsx']) {
      assert.doesNotMatch(readFileSync(join(RAIZ, rel), 'utf8'), /<main[\s>]/, `${rel}: con el marco ya hay un <main id="cj-contenido">`)
    }
  })
  test('el 404 raíz tampoco carga next/font (solo el layout raíz usa Geist)', () => {
    const fuente = readFileSync(join(RAIZ, 'app', 'not-found.tsx'), 'utf8')
    assert.deepEqual(importsDe(fuente).filter((e) => e.startsWith('next/font')), [])
    assert.doesNotMatch(fuente, /components\/(ui|shell)/, 'esos componentes dependen de cj.css')
  })
  test('el 404 raíz está en español, con la salida a "/" y sin lo que prohíbe la marca', () => {
    const fuente = readFileSync(join(RAIZ, 'app', 'not-found.tsx'), 'utf8')
    assert.match(fuente, /No encontramos esa página/)
    assert.match(fuente, /href="\/"/)
    assert.doesNotMatch(fuente, /gradient|boxShadow|box-shadow|backdrop|blur\(|borderRadius|#(?:E84E0F|F39200|FBBA00)\b/i)
  })
})
