// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-panel-referidos.mjs
// Panel de referidos por cliente (lib/clientes/panelReferidos.ts): conteos, créditos disponibles/usados/pendientes, beneficios,
// columnas del listado, ficha con el panel y las 10 dudas abiertas tal cual, y estados vacíos honestos. Sin red ni reloj.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { panelDeCliente, panelesDeTodos, detalleBeneficio } from '../lib/clientes/panelReferidos.ts'
import { calcularCreditosDeDatos } from '../lib/clientes/programa.ts'
import { calcularCreditos } from '../lib/clientes/creditos.ts'
import { armarFicha } from '../lib/clientes/ficha.ts'
import { aListado, textoReferidos, textoUsadosPendientes, textoIntentos, textoGrabacion, textoExtraCorto } from '../lib/clientes/listado.ts'
import { crearDatosDemo } from '../lib/clientes/demo.ts'
import { REGLAS_REFERIDOS } from '../lib/clientes/reglasReferidos.ts'
import { puedeVer, ROLES } from '../lib/auth/roles.ts'

const RAIZ = join(fileURLToPath(import.meta.url), '..', '..')
const HOY = '2026-12-20'
const R = REGLAS_REFERIDOS
let n = 0
const ref = (idReferidor, estado, extra = {}) => ({
  id: `R${String(++n).padStart(3, '0')}`, fila: n + 1, fechaPedido: '2026-10-10', momento: 'post_kickoff', idReferidor, nombre: `Ref ${n}`,
  telefono: '', mail: '', estudio: 'Otro', estado, fechaLlamada: '2026-10-15', idClienteNuevo: '', fechaPrimerPago: null,
  fechaLiberacion: null, reembolso: false, notas: '', cargadoPor: '', ...extra,
})
const canje = (idCliente, meses, extra = '') => ({ id: 'M', fila: 2, fecha: '2026-11-01', idCliente, tipo: 'canje', idReferido: '', meses, extra, vence: null, renovacionAplicada: 'Renovación 1', nota: '', cargadoPor: '' })

describe('panelDeCliente: referidos y créditos', () => {
  const referidos = [
    ref('A001', 'Presentado'), ref('A001', 'No asistió'), ref('A001', 'Asistió'), ref('A001', 'No cerró'),
    ref('A001', 'Cerró', { fechaPrimerPago: '2026-10-20' }),                  // liberado (pasaron más de 14 días)
    ref('A001', 'Cerró', { fechaPrimerPago: '2026-12-15' }),                  // pendiente: faltan días
    ref('A001', 'Cerró', { fechaPrimerPago: null }),                          // pendiente: sin primer pago
    ref('A001', 'Presentado', { fechaPedido: '2026-09-15', fechaLlamada: null }),  // anterior al programa
    ref('A002', 'Cerró', { fechaPrimerPago: '2026-10-20' }),                  // de otro cliente: no cuenta
  ]
  const resumen = calcularCreditos({ idCliente: 'A001', referidos, movimientos: [], hoy: HOY })
  const p = panelDeCliente('A001', referidos, [], resumen)
  test('presentados, asistieron y cerraron (un cierre también asistió)', () => {
    assert.deepEqual(p.referidos, { presentados: 8, asistieron: 5, cerraron: 3, anterioresAlPrograma: 1 })
  })
  test('créditos: disponibles = saldo canjeable, pendientes = cierres sin liberar, usados = 0 sin canjes', () => {
    assert.equal(p.creditos.pendientesDeLiberar, 2)
    assert.equal(p.creditos.usados, 0)
    assert.equal(p.creditos.disponibles, resumen.mesesGanados)
    assert.ok(p.creditos.disponibles >= 1)
  })
  test('beneficios salen del resumen (intentos, premios únicos, USD, zona, extra, nivel)', () => {
    assert.equal(p.beneficios.cierresLiberados, 1)
    assert.equal(p.beneficios.nivel, 1)
    assert.equal(p.beneficios.intentos, 1); assert.equal(p.beneficios.intentos, resumen.intentos)   // solo el "No cerró": el "Asistió" sin resultado y los cierres no cuentan
    assert.equal(p.beneficios.paginaWeb.vigente, true); assert.equal(p.beneficios.branding, null)
    assert.deepEqual(p.beneficios.usd, { ganado: 0, usado: 0, vencido: 0, disponible: 0 })
    assert.deepEqual([p.beneficios.proximoIntento.intento, p.beneficios.proximoIntento.premio], [2, 'credito_usd'])
    assert.equal(p.beneficios.zona, 'sin_determinar')
    assert.deepEqual(p.beneficios.extras, [])
  })
  test('la zona sale del resumen o del parámetro, que lo pisa', () => {
    const conZona = calcularCreditos({ idCliente: 'A001', referidos, movimientos: [], hoy: HOY, zona: 'buenos_aires' })
    assert.equal(panelDeCliente('A001', referidos, [], conZona).beneficios.zona, 'buenos_aires')
    assert.equal(panelDeCliente('A001', referidos, [], conZona, R, 'sin_determinar').beneficios.zona, 'sin_determinar')
    assert.equal(panelDeCliente('A001', referidos, [], undefined, R, 'buenos_aires').beneficios.zona, 'buenos_aires')
  })
  test('USD y premios únicos con muchos intentos; los canjes en USD del libro se reflejan', () => {
    const muchos = Array.from({ length: 7 }, (_, i) => ref('M', 'No cerró', { fechaLlamada: `2026-10-${String(10 + i).padStart(2, '0')}` }))
    const libro = [canje('M', 0, 'USD 300')]
    const res = calcularCreditos({ idCliente: 'M', referidos: muchos, movimientos: [], hoy: HOY })
    const q = panelDeCliente('M', muchos, libro, res)
    assert.equal(q.beneficios.intentos, 7); assert.equal(q.beneficios.usd.ganado, 300 + 300 + 2 * 150); assert.ok(q.beneficios.paginaWeb && q.beneficios.branding)
    assert.equal(q.beneficios.mesesPorIntentos, 1); assert.equal(q.creditos.disponibles, 1)
    // con el canje en el libro, el cálculo lo lee (USD usado) y el panel cuenta 0 meses usados (el canje es de 0 meses)
    const conCanje = calcularCreditos({ idCliente: 'M', referidos: muchos, movimientos: libro, hoy: HOY })
    assert.equal(panelDeCliente('M', muchos, libro, conCanje).beneficios.usd.usado, 300); assert.equal(panelDeCliente('M', muchos, libro, conCanje).creditos.usados, 0)
  })
  test('usados: suma los canjes contra renovación y NO los de un extra (grabación, página web, branding)', () => {
    const libro = [canje('A001', -3, 'renovación gratis'), canje('A001', -1), canje('A001', 0, 'grabación'), canje('A001', 0, 'página web'), canje('A001', 0, 'branding'), canje('A002', -9)]
    const q = panelDeCliente('A001', referidos, libro, resumen)
    assert.equal(q.creditos.usados, 4)
  })
  test('un cliente sin referidos ni resumen queda en ceros (no inventa nada)', () => {
    const v = panelDeCliente('A999', referidos, [], undefined)
    assert.deepEqual(v.referidos, { presentados: 0, asistieron: 0, cerraron: 0, anterioresAlPrograma: 0 })
    assert.deepEqual(v.creditos, { disponibles: 0, usados: 0, pendientesDeLiberar: 0 })
    assert.equal(v.beneficios.nivel, 0); assert.equal(v.beneficios.renovacionGratis, false)
    assert.equal(v.beneficios.intentos, 0); assert.equal(v.beneficios.paginaWeb, null); assert.equal(v.beneficios.branding, null)
    assert.deepEqual(v.beneficios.usd, { ganado: 0, usado: 0, vencido: 0, disponible: 0 }); assert.equal(v.beneficios.proximoIntento.premio, 'pagina_web'); assert.equal(v.beneficios.zona, 'sin_determinar')
  })
  test('con renovación gratis y extra del nivel 2', () => {
    const dos = [ref('B', 'Cerró', { fechaPrimerPago: '2026-10-20' }), ref('B', 'Cerró', { fechaPrimerPago: '2026-10-21' })]
    const q = panelDeCliente('B', dos, [], calcularCreditos({ idCliente: 'B', referidos: dos, movimientos: [], hoy: HOY }))
    assert.equal(q.beneficios.nivel, 2); assert.deepEqual(q.beneficios.extras, ['identidad_marca_completa'])
    assert.equal(textoExtraCorto(q), 'Identidad de marca completa')
  })
})

describe('panelesDeTodos', () => {
  test('uno por cliente con referidos o libro; los demás no figuran', () => {
    const referidos = [ref('A1', 'Cerró', { fechaPrimerPago: '2026-10-20' }), ref('A2', 'Presentado')]
    const movimientos = [canje('A3', -1)]
    const creditos = new Map([['A3', calcularCreditos({ idCliente: 'A3', referidos, movimientos, hoy: HOY })]])
    const m = panelesDeTodos({ referidos, movimientos, hoy: HOY }, creditos)
    assert.deepEqual([...m.keys()].sort(), ['A1', 'A2', 'A3'])
    assert.equal(m.get('A3').creditos.usados, 1)
  })
})

describe('detalleBeneficio: todo sale de las reglas verificadas', () => {
  const vacio = panelDeCliente('X', [], [], undefined)
  test('sin nada: dice qué da el primer cierre y el primer intento; usa los números de las reglas', () => {
    const l = detalleBeneficio(vacio)
    assert.deepEqual(l.map(x => x.clave), ['escalera', 'intentos', 'usd', 'grabacion', 'extra', 'tope', 'canje'])
    assert.match(l[0].texto, /Sin cierres liberados todavía/)
    assert.match(l.find(x => x.clave === 'intentos').texto, /0 intentos \(referidos que entraron a la llamada y no cerraron\)/)
    assert.match(l.find(x => x.clave === 'intentos').texto, /Próximo \(intento 1\): Página web completa/)
    assert.match(l.find(x => x.clave === 'tope').texto, /Sin tope/); assert.match(l.find(x => x.clave === 'tope').texto, /mes del intento 5/)
    assert.match(l.find(x => x.clave === 'canje').texto, /solo contra la renovación, nunca en efectivo/)
    assert.match(l.find(x => x.clave === 'canje').texto, new RegExp(`${R.vigenciaMeses} meses`))
    assert.match(l.find(x => x.clave === 'usd').texto, /solo contra la renovación y se lleva aparte de los meses/)
  })
  test('con reglas distintas el texto cambia (nada escrito a mano)', () => {
    const otras = { ...R, topeMesesAcumulados: 6, vigenciaMeses: 10 }
    const l = detalleBeneficio(vacio, otras)
    assert.match(l.find(x => x.clave === 'tope').texto, /6 meses/); assert.match(l.find(x => x.clave === 'canje').texto, /10 meses/)
    const sin5 = { ...R, intentos: { ...R.intentos, escalera: R.intentos.escalera.filter(p => p.premio !== 'mes_servicio') } }
    assert.doesNotMatch(detalleBeneficio(vacio, sin5).find(x => x.clave === 'tope').texto, /intento 5/)
  })
  test('la grabación es un extra por zona, nunca un crédito ganado', () => {
    const t = zona => detalleBeneficio(panelDeCliente('X', [], [], undefined, R, zona)).find(x => x.clave === 'grabacion').texto
    assert.equal(t('buenos_aires'), 'Extra disponible para esta zona: grabación en las oficinas de Buenos Aires (a confirmar por el closer).')
    assert.match(t('sin_determinar'), /Zona sin determinar/); assert.match(t('sin_determinar'), /el closer puede ofrecer la grabación/)
    assert.doesNotMatch(t('buenos_aires') + t('sin_determinar'), /ganada|ganó|gana\b|disponibles?\b(?! para esta zona)/)
  })
  test('el saldo en USD y los premios aparecen con lo que tiene el cliente', () => {
    const intentos = Array.from({ length: 6 }, (_, i) => ref('Z', 'No cerró', { fechaLlamada: `2026-10-${String(10 + i).padStart(2, '0')}` }))
    const q = panelDeCliente('Z', intentos, [], calcularCreditos({ idCliente: 'Z', referidos: intentos, movimientos: [], hoy: HOY }))
    const l = detalleBeneficio(q)
    assert.match(l.find(x => x.clave === 'usd').texto, /Disponible USD 750; ganado USD 750; canjeado USD 0/)
    assert.match(l.find(x => x.clave === 'intentos').texto, /6 intentos/); assert.match(l.find(x => x.clave === 'intentos').texto, /Página web: ganada; branding: ganado/)
    assert.match(l.find(x => x.clave === 'intentos').texto, /Próximo \(intento 7\): USD 150 de crédito por cada intento adicional, sin tope/)
  })
  test('no menciona el descuento del referido: no es un beneficio de quien refiere', () => {
    assert.ok(!detalleBeneficio(vacio).some(x => /descuento/i.test(x.texto)))
  })
})

describe('columnas del listado', () => {
  test('textos de cada columna y "—" cuando no hay nada', () => {
    assert.equal(textoReferidos(null), '—'); assert.equal(textoUsadosPendientes(null), '—'); assert.equal(textoIntentos(null), '—')
    assert.equal(textoGrabacion(null), '—'); assert.equal(textoExtraCorto(null), '—')
    const ceros = panelDeCliente('X', [], [], undefined)
    assert.equal(textoReferidos(ceros), '—'); assert.equal(textoUsadosPendientes(ceros), '—'); assert.equal(textoIntentos(ceros), '—'); assert.equal(textoGrabacion(ceros), '—')
    const p = { ...ceros, referidos: { presentados: 3, asistieron: 2, cerraron: 1, anterioresAlPrograma: 0 },
      creditos: { disponibles: 2, usados: 1, pendientesDeLiberar: 2 },
      beneficios: { ...ceros.beneficios, intentos: 6, paginaWeb: { fecha: '2026-10-10', vence: '2027-10-10', vigente: true }, branding: { fecha: '2026-10-12', vence: '2027-10-12', vigente: true }, zona: 'buenos_aires' } }
    assert.equal(textoReferidos(p), '3 / 2 / 1')
    assert.equal(textoUsadosPendientes(p), '1 mes usados · 2 por liberar')
    assert.equal(textoIntentos(p), '6 intentos · página web, branding')
    assert.equal(textoIntentos({ ...p, beneficios: { ...p.beneficios, intentos: 1, branding: null } }), '1 intento · página web')
    assert.equal(textoIntentos({ ...p, beneficios: { ...p.beneficios, intentos: 2, paginaWeb: null, branding: null } }), '2 intentos')
    assert.equal(textoGrabacion(p), 'Extra para esta zona (a confirmar)')   // es un extra a confirmar, no una grabación ganada
    assert.equal(textoGrabacion({ ...p, beneficios: { ...p.beneficios, zona: 'sin_determinar' } }), '—')
  })
  test('aListado lleva el panel y sigue andando con 3 argumentos', () => {
    const d = crearDatosDemo('2026-10-06')
    const cr = calcularCreditosDeDatos(d)
    const pan = panelesDeTodos(d, cr, d.reglas)
    const con = d.clientes.map((c, i) => aListado(c, i, cr.get(c.id), pan.get(c.id)))
    assert.ok(con.some(f => f.panel && f.panel.referidos.presentados > 0))
    assert.ok(con.every(f => f.panel === null || typeof f.panel.referidos.presentados === 'number'))
    assert.equal(aListado(d.clientes[0], 0, cr.get(d.clientes[0].id)).panel, null)
  })
})

describe('ficha: panel, dudas abiertas y estados vacíos', () => {
  const d = crearDatosDemo('2026-10-06')
  const cr = calcularCreditosDeDatos(d)
  const conRefs = d.clientes.find(c => d.referidos.some(r => r.idReferidor === c.id))
  test('la ficha trae el panel con el detalle y las dudas abiertas tal cual están en las reglas', () => {
    const f = armarFicha(d, cr, conRefs.id, { conContacto: true })
    assert.ok(f.panel.referidos.presentados > 0)
    assert.equal(f.panel.dudasAbiertas.length, 10)
    assert.deepEqual(f.panel.dudasAbiertas, (d.reglas ?? R).dudasAbiertas.map(x => x.texto))
    assert.equal(f.panel.detalle.length, 7)
  })
  test('REGLAS_REFERIDOS tiene exactamente las 10 dudas', () => assert.equal(R.dudasAbiertas.length, 10))
  test('la ficha trae la zona (no el teléfono): E001 de Buenos Aires, E003 de Córdoba y E005 de Uruguay sin determinar', () => {
    const zona = id => armarFicha(d, cr, id, { conContacto: false }).panel.beneficios.zona
    assert.deepEqual(['E001', 'E003', 'E005'].map(zona), ['buenos_aires', 'sin_determinar', 'sin_determinar'])
    assert.ok(!/5550|555-0|\+598|\+54/.test(JSON.stringify(armarFicha(d, cr, 'E003', { conContacto: false }))))   // sin permiso de contacto no sale ningún teléfono
  })
  test('el panel de la ficha y la columna del listado dicen lo mismo del cliente de ejemplo con 5 intentos', () => {
    const f = armarFicha(d, cr, 'E001', { conContacto: false })
    assert.equal(f.panel.beneficios.intentos, 5); assert.equal(f.panel.beneficios.usd.disponible, 600); assert.equal(f.panel.creditos.disponibles, 5)
    assert.equal(textoIntentos(f.panel), '5 intentos · página web, branding'); assert.equal(textoGrabacion(f.panel), 'Extra para esta zona (a confirmar)')
  })
  test('sin la pestaña Referidos la ficha lo declara (la pantalla muestra el vacío en vez de ceros)', () => {
    const f = armarFicha({ ...d, referidos: [], pestanasAusentes: ['Referidos', 'Créditos'] }, new Map(), conRefs.id, { conContacto: false })
    assert.deepEqual(f.panel.pestanasAusentes, ['Referidos', 'Créditos'])
    assert.equal(f.panel.referidos.presentados, 0)
    assert.equal(f.panel.dudasAbiertas.length, 10)
  })
  test('la ficha no suma datos de contacto al panel', () => {
    const f = armarFicha(d, cr, conRefs.id, { conContacto: false })
    const sinDudas = { ...f.panel, dudasAbiertas: [] }   // el texto de las dudas habla "del teléfono" en general: no es un dato de contacto
    assert.ok(!/telefono|teléfono|mail|celular|\+54|555/i.test(JSON.stringify(sinDudas)))
  })
})

describe('pantallas: lectura de las fuentes', () => {
  const leer = (...p) => readFileSync(join(RAIZ, ...p), 'utf8')
  test('la lista muestra las columnas del panel y la página no calcula con Referidos ausente', () => {
    const l = leer('app', '(shell)', 'clientes', '(cartera)', '_componentes', 'ListaClientes.tsx')
    for (const c of ['Referidos: presentó / asistieron / cerraron', 'Créditos usados / por liberar', 'Intentos y premios únicos']) assert.ok(l.includes(c), c)
    // 8/10/2026: Tomás pidió sacar "grabación en oficinas" y "extra" de Clientes
    for (const c of ['Grabación en oficinas', "titulo: 'Extra'"]) assert.ok(!l.includes(c), c)
    assert.ok(!l.includes('Meses por llamadas'))
    // 25/10/2026: el armado de la lista pasó de page.tsx a _componentes/EnVivo.tsx (streaming)
    const pg = leer('app', '(shell)', 'clientes', '(cartera)', '_componentes', 'EnVivo.tsx')
    assert.match(pg, /pestanasAusentes\.includes\('Referidos'\) \? new Map\(\)/)
  })
  test('la ficha muestra el panel y las dudas; solo con acceso a Clientes', () => {
    assert.match(leer('app', '(shell)', 'clientes', '[id]', 'page.tsx'), /<PanelReferidosFicha f=\{ficha\} \/>/)
    assert.match(leer('app', '(shell)', 'clientes', '[id]', 'page.tsx'), /exigirAcceso\('clientes'\)/)
    assert.match(leer('app', '(shell)', 'clientes', '(cartera)', 'page.tsx'), /exigirAcceso\('clientes'\)/)
    const con = ROLES.filter(r => puedeVer(r, 'clientes'))
    assert.ok(con.length >= 1 && con.length < ROLES.length, `roles con Clientes: ${con}`)
  })
})
