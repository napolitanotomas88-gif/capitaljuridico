// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-clientes.mjs
// Capa de datos del CRM de clientes: parseo por encabezado, reglas (semáforo, "no clientes", extensiones),
// altas dry-run y snapshot/fallback. Sin red: las credenciales se borran del entorno a propósito.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Sin credenciales: cualquier intento de leer Sheets falla y no sale nada a la red
for (const k of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'SHEET_ID_CLIENTES']) delete process.env[k]
const DIR = mkdtempSync(join(tmpdir(), 'clientes-test-'))
process.env.CLIENTES_CACHE_DIR = DIR

const { resolverColumnas, parsearHojas, parsearReferidos, parsearMovimientos } = await import('../lib/clientes/parsear.ts')
const { semaforoVencimiento, semaforoDeCliente } = await import('../lib/clientes/semaforo.ts')
const { derivarClientes, marcarNoClientes, UMBRAL_CLIENTE_USD } = await import('../lib/clientes/clasificar.ts')
const { esExtension, esRenovacionPaga, parsearRenovo } = await import('../lib/clientes/renovaciones.ts')
const { planAlta, proximoId, planReparacionFormulas, NOTA_PERIODO_INICIAL } = await import('../lib/clientes/altas.ts')
const { resumirCartera } = await import('../lib/clientes/resumen.ts')
const { ymdASerial, serialAYmd } = await import('../lib/clientes/fechas.ts')
const nuevas = await import('../lib/clientes/pestanasNuevas.ts')
const snap = await import('../lib/clientes/snapshot.ts')
const { obtenerHojas, leerClientes, lecturasRealizadas, reiniciarEstadoDeLectura, datosDesdeSnapshot } = await import('../lib/clientes/leer.ts')
const { calcularCreditosDeDatos, resumirPrograma } = await import('../lib/clientes/programa.ts')
const { armarFicha } = await import('../lib/clientes/ficha.ts')
const { panelesDeTodos } = await import('../lib/clientes/panelReferidos.ts')
const { textoReferidos, textoIntentos, textoGrabacion, aListado } = await import('../lib/clientes/listado.ts')

const HOY = '2026-10-06'
const S = ymd => ymdASerial(ymd)
const AG_HEAD = ['', '', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Renovó', 'LTV contratado', 'LTV cobrado', 'Duración (días)', 'Promesa alcanzada', 'Semaforo de Clientes', 'Testimonio', 'Notas renovación', 'Anotaciones', 'Próximo cobro', 'Llamada agendada', 'Fecha de baja']
// Fila de Agencia: [id, nombre, estado, cel, mail, closer, fuente, contrato, dia1, fin, renovo, ltvC, ltvCob, dur, promesa]
const ag = (id, nombre, estado, cel, o = {}) => [id, nombre, estado, cel, o.mail ?? '', o.closer ?? 'Gero', '', o.contrato ?? 'Firmado',
  o.dia1 === undefined ? S('2026-06-01') : o.dia1, o.fin === undefined ? S('2026-12-01') : o.fin, o.renovo ?? 'NO', o.ltvC ?? 2600, o.ltvCob === undefined ? 2600 : o.ltvCob, 120, o.promesa ?? 'Sí', '', '', '', '', '', '', o.baja ?? '']
const CO_HEAD = ['ID', 'Nombre', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Renovó', 'LTV contratado', 'LTV cobrado', 'Duración (días)', 'Promesa alcanzada', 'Satisfacción (1-10)']
const RE_HEAD = ['ID Cliente', 'Nombre', 'Período (0=inicial)', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses (vacío = 4)']
const hojasBase = () => ({
  agencia: [AG_HEAD,
    ag('A001', 'Ana Perez', 'ACTIVO', '+54 9 11 1111-0001'),
    ag('A002', 'Beatriz Gomez', 'FINALIZADO', '11 2222 0002', { ltvCob: 100 }),
    ag('A003', 'Carla Diaz', 'INACTIVO', '11 3333 0003', { ltvCob: 0 }),
    ag('A004', 'Diana Lopez', 'FINALIZADO', '11 4444 0004', { ltvCob: 1500 }),
    [],                                                                // fila vacía
    ag('', 'Elena Sola', 'ACTIVO', '11 5555 0005', { fin: '', ltvC: '', ltvCob: '' }),   // la trampa: sin ID y sin fórmulas
  ],
  consultora: [CO_HEAD, ['C001', 'Fabio Consultor', 'FINALIZADO', '11 6666 0006', '', '', '', '', S('2026-01-01'), S('2026-05-01'), 'NO', '', 0, 120, '', 8]],
  renovaciones: [RE_HEAD,
    ['A001', 'Ana Perez', 0, S('2026-06-01'), S('2026-10-01'), 2600, 'Programa inicial'],
    ['A001', 'Ana Perez', 1, S('2026-10-01'), S('2027-06-01'), 4000, ''],
    ['A001', 'Ana Perez', 2, S('2026-10-02'), S('2026-11-02'), 0, 'Extensión +1 mes'],
    ['A002', 'Beatriz Gomez', 0, S('2026-02-01'), S('2026-06-01'), '', 'Programa inicial'],
    ['A002', 'Beatriz Gomez', 1, S('2026-06-01'), S('2026-09-01'), 0, ''],         // precio 0 sin rotular: no es renovación paga
    ['A002', 'Beatriz Gomez', 2, S('2026-09-01'), S('2026-10-01'), '', ''],        // precio vacío: pendiente de cargar, cuenta
    ['A003', 'Carla Diaz', 'x', S('2026-02-01')],                                  // sin número de período: se descarta
  ],
  referidos: null, creditos: null, config: null,
})

describe('resolución de columnas por encabezado', () => {
  test('Agencia: encabezados A y B vacíos → ID y Nombre junto a "Estado", anotado como por posición', () => {
    const r = resolverColumnas('Agencia', AG_HEAD, { id: h => h === 'id', nombre: h => h === 'nombre', estado: h => h === 'estado' }, { id: { respectoDe: 'estado', delta: -2 }, nombre: { respectoDe: 'estado', delta: -1 } })
    assert.deepEqual(r.idx, { id: 0, nombre: 1, estado: 2 }); assert.deepEqual(r.resumen.porPosicion, ['id', 'nombre'])
  })
  test('si el encabezado existe se usa el encabezado (aunque cambie de lugar) y no hay "por posición"', () => {
    const r = resolverColumnas('X', ['Estado', 'ID', 'Nombre'], { id: h => h === 'id', nombre: h => h === 'nombre', estado: h => h === 'estado' }, { id: { respectoDe: 'estado', delta: -2 } })
    assert.deepEqual(r.idx, { id: 1, nombre: 2, estado: 0 }); assert.deepEqual(r.resumen.porPosicion, [])
  })
  test('si la columna de al lado NO está vacía no se adivina', () => {
    const r = resolverColumnas('X', ['Algo', 'Otra', 'Estado'], { id: h => h === 'id', estado: h => h === 'estado' }, { id: { respectoDe: 'estado', delta: -2 } })
    assert.equal(r.idx.id, -1); assert.deepEqual(r.resumen.faltantes, ['id'])
  })
  test('una columna con dos candidatas usa la primera y lo avisa', () => {
    const r = resolverColumnas('X', ['Estado', 'Estado'], { estado: h => h === 'estado' })
    assert.equal(r.idx.estado, 0); assert.deepEqual(r.resumen.duplicadas, ['estado'])
  })
  test('insertar una columna nueva en el medio no cambia el resultado (las posiciones cambian seguido)', () => {
    const h = hojasBase()
    const conExtra = f => [...f.slice(0, 3), f === h.agencia[0] ? 'Columna nueva' : 'x', ...f.slice(3)]
    const original = parsearHojas(h)
    const movido = parsearHojas({ ...h, agencia: h.agencia.map(f => (f.length ? conExtra(f) : f)) })
    const sinPeriodos = cs => cs.filter(c => c.linea === 'agencia').map(c => ({ ...c, periodos: [] }))
    assert.deepEqual(sinPeriodos(movido.base), sinPeriodos(original.base))
    assert.equal(movido.columnas[0].resueltas.celular, 'E')   // se movió de D a E y se encontró igual
  })
})

describe('parseo de las hojas', () => {
  const p = parsearHojas(hojasBase())
  test('filas: Agencia con y sin ID, vacías descartadas, Consultora aparte', () => {
    assert.equal(p.base.filter(c => c.linea === 'agencia').length, 5)   // A001-A004 + la fila sin ID; la vacía no
    assert.equal(p.base.filter(c => c.linea === 'consultora').length, 1)
    const sin = p.base.find(c => c.nombre === 'Elena Sola'); assert.equal(sin.id, ''); assert.equal(sin.fila, 7)
    assert.equal(p.base.find(c => c.id === 'A001').fila, 2)
  })
  test('fechas como día local, números y estado normalizado', () => {
    const a = p.base.find(c => c.id === 'A001')
    assert.equal(a.dia1, '2026-06-01'); assert.equal(a.finPeriodo, '2026-12-01'); assert.equal(a.ltvCobrado, 2600); assert.equal(a.estado, 'ACTIVO')
    assert.equal(p.base.find(c => c.nombre === 'Elena Sola').finPeriodo, null)
    assert.equal(p.base.find(c => c.id === 'C001').satisfaccion, 8)
  })
  test('Consultora: un "LTV contratado" en 0 es relleno (sin precios cargados) y se lee como sin cargar; en Agencia el 0 se respeta', () => {
    const h = hojasBase()
    h.consultora = [CO_HEAD, ['C001', 'Fabio Consultor', 'ACTIVO', '', '', '', '', '', S('2026-01-01'), S('2026-05-01'), 'NO', 0, 447, 120, '', 8], ['C002', 'Otra Consultora', 'ACTIVO', '', '', '', '', '', S('2026-01-01'), S('2026-05-01'), 'NO', 1500, 500, 120, '', 8]]
    h.agencia.push(ag('A009', 'Cero Contratado', 'FINALIZADO', '11 9999 0009', { ltvC: 0, ltvCob: 100 }))
    const q = parsearHojas(h)
    assert.equal(q.base.find(c => c.id === 'C001').ltvContratado, null)
    assert.equal(q.base.find(c => c.id === 'C001').ltvCobrado, 447)
    assert.equal(q.base.find(c => c.id === 'C002').ltvContratado, 1500)   // un monto real de Consultora se conserva
    assert.equal(q.base.find(c => c.id === 'A009').ltvContratado, 0)
  })
  test('períodos asociados por ID, ordenados, y el huérfano sin número descartado con aviso', () => {
    assert.deepEqual(p.base.find(c => c.id === 'A001').periodos.map(x => x.periodo), [0, 1, 2])
    assert.equal(p.base.find(c => c.id === 'A003').periodos.length, 0)
    assert.match(p.avisos.join(' '), /sin número de período/)
  })
  test('extensión y renovación paga', () => {
    const per = p.base.find(c => c.id === 'A001').periodos
    assert.deepEqual(per.map(x => [x.esExtension, x.esRenovacionPaga]), [[false, false], [false, true], [true, false]])
    const b = p.base.find(c => c.id === 'A002').periodos
    assert.deepEqual(b.map(x => x.esRenovacionPaga), [false, false, true])   // 0 = no se cobró · vacío = pendiente, cuenta
  })
  test('ID repetido se avisa', () => {
    const h = hojasBase(); h.agencia.push(ag('A001', 'Repetida', 'ACTIVO', '11 9999 0009'))
    assert.match(parsearHojas(h).avisos.join(' '), /A001/)
  })
  test('hojas opcionales ausentes → listas vacías; presentes → parseadas por encabezado', () => {
    assert.deepEqual(parsearReferidos(null), { referidos: [], columnas: null })
    assert.deepEqual(parsearMovimientos(null), { movimientos: [], columnas: null })
    const r = parsearReferidos([
      ['ID', 'Fecha del pedido', 'Momento', 'ID referidor', 'Nombre', 'Teléfono', 'Mail', 'Estudio', 'Estado', 'Fecha de llamada', 'ID cliente nuevo', 'Fecha del primer pago', 'Fecha de liberación', 'Reembolso', 'Notas', 'Cargado por'],
      ['R001', S('2026-09-01'), 'Post-kickoff', 'A001', 'Lead', '11 1', 'l@x.com', 'Estudio X', 'Cerró', S('2026-09-05'), 'A120', S('2026-09-10'), S('2026-09-24'), 'NO', '', 'Tomás'],
      ['R002', '', 'Llamada de proyección', 'A001', 'Otro', '', '', '', 'asistio', '', '', '', '', 'SI', '', ''],
    ])
    assert.equal(r.referidos[0].estado, 'Cerró'); assert.equal(r.referidos[0].momento, 'post_kickoff'); assert.equal(r.referidos[0].fechaPrimerPago, '2026-09-10')
    assert.equal(r.referidos[0].reembolso, false); assert.equal(r.referidos[1].reembolso, true); assert.equal(r.referidos[1].estado, 'Asistió'); assert.equal(r.referidos[1].momento, 'llamada_proyeccion')
    const m = parsearMovimientos([['ID', 'Fecha', 'ID cliente', 'Tipo', 'Referido', 'Meses', 'Extra', 'Vence', 'Renovación aplicada', 'Nota', 'Cargado por'], ['M001', S('2026-09-30'), 'A001', 'canje', '', -8, '', '', 'R2', '', '']])
    assert.equal(m.movimientos[0].tipo, 'canje'); assert.equal(m.movimientos[0].meses, -8); assert.equal(m.movimientos[0].fecha, '2026-09-30')
  })
  test('IDs de cliente escritos a mano en minúscula o con espacios se normalizan (si no, el crédito no se asocia al cliente)', () => {
    const r = parsearReferidos([
      ['ID', 'ID referidor', 'Nombre', 'Estado', 'ID cliente nuevo'],
      ['R001', ' a012 ', 'Lead', 'Cerró', 'a141'],
    ])
    assert.equal(r.referidos[0].idReferidor, 'A012'); assert.equal(r.referidos[0].idClienteNuevo, 'A141')
    const m = parsearMovimientos([['ID', 'Fecha', 'ID cliente', 'Tipo', 'Meses'], ['M001', S('2026-09-30'), 'a012', 'canje', -8]])
    assert.equal(m.movimientos[0].idCliente, 'A012')
  })
})

describe('semáforo por vencimiento', () => {
  const sem = fin => semaforoVencimiento(fin, HOY)
  test('verde > 14 días · amarillo ≤ 14 · rojo vencido · gris sin fecha', () => {
    assert.deepEqual(sem('2026-10-21'), { color: 'verde', dias: 15 })
    assert.deepEqual(sem('2026-10-20'), { color: 'amarillo', dias: 14 })
    assert.deepEqual(sem('2026-10-06'), { color: 'amarillo', dias: 0 })    // vence hoy
    assert.deepEqual(sem('2026-10-05'), { color: 'rojo', dias: -1 })
    assert.deepEqual(sem(null), { color: 'gris', dias: null })
  })
  test('solo los ACTIVO tienen semáforo', () => {
    assert.equal(semaforoDeCliente({ estado: 'ACTIVO', finPeriodo: '2026-12-01' }, HOY).color, 'verde')
    for (const estado of ['PAUSADO', 'FINALIZADO', 'INACTIVO', '']) assert.equal(semaforoDeCliente({ estado, finPeriodo: '2026-12-01' }, HOY), null)
  })
  test('cruce de año', () => assert.equal(semaforoVencimiento('2027-01-03', '2026-12-25').color, 'amarillo'))
})

describe('"no clientes" y métricas solo de Agencia', () => {
  const base = () => parsearHojas(hojasBase()).base
  test('el umbral es el de producción (400)', () => assert.equal(UMBRAL_CLIENTE_USD, 400))
  test('FINALIZADO/INACTIVO con cobrado < 400 no cuentan; con 400 o más sí', () => {
    const cs = derivarClientes(base(), HOY)
    const por = id => cs.find(c => c.id === id)
    assert.equal(por('A002').esNoCliente, true)     // FINALIZADO, cobró 100
    assert.equal(por('A003').esNoCliente, true)     // INACTIVO, cobró 0
    assert.equal(por('A004').esNoCliente, false)    // FINALIZADO, cobró 1500
    assert.equal(por('A001').esNoCliente, false)    // ACTIVO nunca
    const b = base(); b.find(c => c.id === 'A002').ltvCobrado = 399
    assert.equal(derivarClientes(b, HOY).find(c => c.id === 'A002').esNoCliente, true)
    b.find(c => c.id === 'A002').ltvCobrado = 400
    assert.equal(derivarClientes(b, HOY).find(c => c.id === 'A002').esNoCliente, false)
  })
  test('Consultora y filas sin ID no cuentan en las métricas; un no-cliente tampoco', () => {
    const cs = derivarClientes(base(), HOY)
    assert.equal(cs.find(c => c.id === 'C001').cuentaEnMetricas, false)
    assert.equal(cs.find(c => c.id === 'C001').esNoCliente, false)   // Consultora: no se aplica la regla
    assert.equal(cs.find(c => c.nombre === 'Elena Sola').cuentaEnMetricas, false)
    assert.equal(cs.find(c => c.id === 'A002').cuentaEnMetricas, false)
    assert.equal(cs.find(c => c.id === 'A001').cuentaEnMetricas, true)
  })
  test('quien volvió (otra fila vigente con el mismo teléfono o nombre) no es "no cliente"', () => {
    const b = base(); b.push({ ...b.find(c => c.id === 'A001'), id: 'A050', nombre: 'Otra', celular: '011 2222-0002', estado: 'ACTIVO', fila: 60 })
    assert.equal(derivarClientes(b, HOY).find(c => c.id === 'A002').esNoCliente, false)   // mismo teléfono que A050 (últimos 7 dígitos)
  })
  test('cobradoExterno (Registro de Pagos): gana el mayor de los dos', () => {
    assert.equal(derivarClientes(base(), HOY, { cobradoExterno: new Map([['A002', 2000]]) }).find(c => c.id === 'A002').esNoCliente, false)
    assert.equal([...marcarNoClientes(base(), { umbral: 50 })].length, 1)   // con umbral 50 solo queda A003 (cobró 0)
  })
  test('campos derivados: faltantes, renovaciones pagas, extensiones, precio inicial, días', () => {
    const cs = derivarClientes(base(), HOY)
    const a = cs.find(c => c.id === 'A001')
    assert.equal(a.renovacionesPagas, 1); assert.equal(a.extensiones, 1); assert.equal(a.precioInicial, 2600); assert.equal(a.semaforo, 'verde'); assert.equal(a.diasParaVencer, 56)
    assert.equal(cs.find(c => c.id === 'A002').renovacionesPagas, 1)
    const sin = cs.find(c => c.nombre === 'Elena Sola')
    assert.equal(sin.sinId, true); assert.deepEqual(sin.faltantes, ['id', 'fin_periodo', 'ltv']); assert.equal(sin.semaforo, 'gris')
  })
  test('resumen: respeta Agencia, no clientes y semáforo', () => {
    const cs = derivarClientes(base(), HOY)
    const r = resumirCartera(cs, [], HOY)
    assert.equal(r.filas.total, 6); assert.equal(r.filas.sinId, 1); assert.equal(r.crudo.total, 5)
    assert.equal(r.metricas.clientes, 2)            // A001 y A004
    assert.equal(r.noClientesExcluidos, 2)
    assert.equal(r.metricas.semaforo.verde, 1); assert.equal(r.calidadDeDatos.activosSinFin, 1)
    assert.equal(r.calidadDeDatos.sinPeriodos, 0)   // la fila sin ID no cuenta; A001 tiene períodos
  })
  test('calidad: un ACTIVO con ID y sin ninguna fila en Renovaciones (cliente recién cargado) se informa', () => {
    const h = hojasBase()
    h.agencia.push(ag('A010', 'Recien Cargado', 'ACTIVO', '11 1010 0010'))   // sin filas en Renovaciones
    const cs = derivarClientes(parsearHojas(h).base, HOY)
    assert.equal(resumirCartera(cs, [], HOY).calidadDeDatos.sinPeriodos, 1)
  })
})

describe('reglas de renovaciones', () => {
  test('extensión: notas que empiezan con "Extensión"', () => {
    assert.equal(esExtension('Extensión +1 mes (migrada de notas)'), true); assert.equal(esExtension('  extension 2 meses'), true)
    assert.equal(esExtension('Programa inicial'), false); assert.equal(esExtension(''), false)
  })
  test('renovación paga: período > 0, no extensión, precio ≠ 0 (vacío cuenta)', () => {
    const pag = (periodo, notas, precio) => esRenovacionPaga({ periodo, notas, precio })
    assert.equal(pag(0, '', 2600), false); assert.equal(pag(1, '', 4000), true); assert.equal(pag(1, 'Extensión', 0), false)
    assert.equal(pag(1, 'Extensión', 500), false); assert.equal(pag(1, '', 0), false); assert.equal(pag(1, '', null), true)
  })
  test('columna Renovó', () => {
    assert.deepEqual(parsearRenovo('R1'), { renovaciones: 1, extensionMeses: 0, noRenovo: false })
    assert.deepEqual(parsearRenovo('R3'), { renovaciones: 3, extensionMeses: 0, noRenovo: false })
    assert.deepEqual(parsearRenovo('R1 +2 meses'), { renovaciones: 1, extensionMeses: 2, noRenovo: false })
    assert.deepEqual(parsearRenovo('NO'), { renovaciones: 0, extensionMeses: 0, noRenovo: true })
    assert.deepEqual(parsearRenovo('NO +1 mes'), { renovaciones: 0, extensionMeses: 1, noRenovo: true })
    assert.deepEqual(parsearRenovo(''), { renovaciones: 0, extensionMeses: 0, noRenovo: false })
  })
})

describe('alta de cliente nuevo (dry-run)', () => {
  const FORMULAS = { 'J Fin período actual': '=…', 'K Renovó': '=…', 'L LTV contratado': '=…', 'M LTV cobrado': '=…', 'N Duración (días)': '=…' }
  const ctx = (extra = {}) => { const h = hojasBase(); const p = parsearHojas(h); return { hojas: h, clientes: derivarClientes(p.base, HOY), formulasAgencia: FORMULAS, ...extra } }
  const entrada = (o = {}) => ({ nombre: 'Gabriela Nueva', celular: '+54 9 11 7777-0007', dia1: '2026-10-05', mail: 'g@x.com', closer: 'Marcos', contrato: 'Firmado', ...o })

  test('próximo ID correlativo (nunca reutiliza) y filas destino', () => {
    assert.equal(proximoId(['A001', 'A139', 'A140', 'C010', '', 'x']), 'A141'); assert.equal(proximoId([]), 'A001'); assert.equal(proximoId(['A999']), 'A1000')
    const plan = planAlta(entrada(), ctx())
    assert.equal(plan.ok, true); assert.equal(plan.dryRun, true); assert.equal(plan.idNuevo, 'A005'); assert.equal(plan.filaAgencia, 8); assert.equal(plan.filaRenovaciones, 9)
  })
  test('el ID de Renovaciones también cuenta (un huérfano allá no se pisa)', () => {
    const c = ctx(); c.hojas.renovaciones.push(['A077', 'Huérfano', 0, S('2026-01-01')])
    assert.equal(planAlta(entrada(), c).idNuevo, 'A078')
  })
  test('fila de Agencia por encabezado: no escribe las columnas con fórmula', () => {
    const plan = planAlta(entrada({ anotaciones: 'nota' }), ctx())
    const ag1 = plan.payload.valores.data[0]
    assert.equal(ag1.range, "'Agencia'!A8:I8")
    assert.deepEqual(ag1.values[0], ['A005', 'Gabriela Nueva', 'ACTIVO', '+54 9 11 7777-0007', 'g@x.com', 'Marcos', '', 'Firmado', ymdASerial('2026-10-05')])
    assert.equal(plan.payload.valores.data[1].range, "'Agencia'!S8:S8")
    for (const d of plan.payload.valores.data.slice(0, -1)) assert.ok(!/!([J-N])\d+/.test(d.range))   // nada de J a N
  })
  test('fórmulas J:N a copiar de la fila 2 con PASTE_FORMULA', () => {
    const [f] = planAlta(entrada(), ctx()).payload.copiarFormulas
    assert.equal(f.origen, "'Agencia'!J2:N2"); assert.equal(f.destino, "'Agencia'!J8:N8")
    assert.deepEqual(f.request.copyPaste.destination, { sheetId: f.request.copyPaste.destination.sheetId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 9, endColumnIndex: 14 })
    assert.equal(f.request.copyPaste.pasteType, 'PASTE_FORMULA')
  })
  test('sin sondeo de fórmulas se deducen por encabezado (fin período, Renovó, LTV, duración)', () => {
    const [f] = planAlta(entrada(), ctx({ formulasAgencia: null })).payload.copiarFormulas
    assert.equal(f.origen, "'Agencia'!J2:N2")
  })
  test('período 0 en Renovaciones: Día 1, Finalización = Día 1 + 120 días (contrato), precio de la tabla y nota habitual', () => {
    const plan = planAlta(entrada(), ctx())
    const r = plan.payload.valores.data.at(-1)
    assert.equal(r.range, "'Renovaciones'!A9:H9")
    const [id, , periodo, d1, fin, precio, notas, meses] = r.values[0]
    assert.deepEqual([id, periodo, serialAYmd(d1), serialAYmd(fin), precio, meses], ['A005', 0, '2026-10-05', '2027-02-02', 2600, ''])
    assert.equal(fin - d1, 120)
    assert.equal(planAlta(entrada({ meses: 4 }), ctx()).payload.valores.data.at(-1).values[0][4], fin)   // 4 explícito = el estándar
    assert.equal(serialAYmd(planAlta(entrada({ dia1: '2026-10-24' }), ctx()).payload.valores.data.at(-1).values[0][4]), '2027-02-21')
    assert.match(notas, new RegExp(`^${NOTA_PERIODO_INICIAL}`)); assert.match(notas, /ASUMIDO/)
    assert.equal(plan.precio.origen, 'tabla'); assert.match(plan.advertencias.join(' '), /SIN verificar/)
  })
  test('precio y meses explícitos pisan la tabla (y 4 meses deja Meses vacío)', () => {
    const plan = planAlta(entrada({ precioUSD: 3300, meses: 8 }), ctx())
    const [, , , , fin, precio, notas, meses] = plan.payload.valores.data.at(-1).values[0]
    assert.deepEqual([serialAYmd(fin), precio, notas, meses], ['2027-06-05', 3300, NOTA_PERIODO_INICIAL, 8])
    assert.equal(plan.precio.origen, 'entrada')
    assert.equal(planAlta(entrada({ producto: 'inicial_3300' }), ctx()).payload.valores.data.at(-1).values[0][5], 3300)
  })
  test('finDelPeriodo = la fórmula de Renovaciones E: vacío o 4 → +120 días corridos; otros meses → meses de calendario', async () => {
    const { finDelPeriodo, DIAS_PROGRAMA, MESES_POR_DEFECTO } = await import('../lib/clientes/precios.ts')
    assert.equal(DIAS_PROGRAMA, 120); assert.equal(MESES_POR_DEFECTO, 4)
    assert.equal(finDelPeriodo('2026-10-24'), '2027-02-21')
    assert.equal(finDelPeriodo('2026-10-24', 4), '2027-02-21')
    assert.equal(finDelPeriodo('2026-10-31', 4), '2027-02-28')   // cruza febrero: 120 días, no "31/2"
    assert.equal(finDelPeriodo('2026-10-05', 8), '2027-06-05')
    assert.equal(finDelPeriodo('2026-09-30', 1), '2026-10-30')
  })
  test('errores: sin nombre/celular, fecha mala, producto inexistente, precio y meses inválidos', () => {
    for (const malo of [{ nombre: ' ' }, { celular: '' }, { dia1: '5/10/2026' }, { producto: 'regalo' }, { precioUSD: -1 }, { precioUSD: NaN }, { meses: 0 }, { meses: 2.5 }]) {
      const plan = planAlta(entrada(malo), ctx())
      assert.equal(plan.ok, false, JSON.stringify(malo)); assert.equal(plan.payload, null); assert.ok(plan.errores.length > 0)
    }
    assert.match(planAlta(entrada({ celular: '123' }), ctx()).advertencias.join(' '), /menos de 7 dígitos/)
  })
  test('duplicados: vigente bloquea; finalizado solo avisa', () => {
    assert.equal(planAlta(entrada({ celular: '11 1111 0001' }), ctx()).ok, false)               // A001 ACTIVO, mismo celular
    const plan = planAlta(entrada({ nombre: 'Beatriz Gomez', celular: '11 0000 1234' }), ctx())    // A002 FINALIZADO, mismo nombre
    assert.equal(plan.ok, true); assert.deepEqual(plan.duplicados.map(d => [d.id, d.motivo]), [['A002', 'nombre']]); assert.match(plan.advertencias.join(' '), /A002/)
    assert.equal(planAlta(entrada({ mail: 'X@y.com' }), ctx({ clientes: [{ id: 'A009', linea: 'agencia', nombre: 'Z', celular: '', mail: 'x@y.com', estado: 'ACTIVO' }] })).ok, false)
  })
  test('nunca escribe: el plan es solo datos y dice dryRun', () => {
    const plan = planAlta(entrada(), ctx())
    assert.equal(plan.dryRun, true); assert.equal(JSON.stringify(plan).includes('function'), false)
  })
  test('reparación: detecta filas con ID sin fórmulas y sin período 0 (la trampa)', () => {
    const h = hojasBase()
    h.agencia.push(['A005', 'Nueva Sin Formulas', 'ACTIVO', '11 8888 0008', '', '', '', '', S('2026-10-01'), S('2027-02-01'), 'NO', '', '', ''])   // J llena, K..N vacías
    h.agencia.push(['A006', 'Otra Sin Formulas', 'ACTIVO', '11 8888 0009', '', '', '', '', S('2026-10-02'), S('2027-02-02'), 'NO', '', '', ''])
    // J y N en blanco pero K, L y M con valor: la fórmula está, el resultado es "" legítimo (sin Día 1) → no se marca
    h.agencia.push(['A007', 'Sin Dia1', 'ACTIVO', '11 8888 0010', '', '', '', '', '', '', 'NO', 0, 0, ''])
    h.renovaciones.push(['A007', 'Sin Dia1', 0, '', '', 2600, ''])
    const rep = planReparacionFormulas(h, FORMULAS)
    assert.equal(rep.filas.some(f => f.id === 'A007'), false)
    assert.deepEqual(rep.filas.filter(f => f.id === 'A005' || f.id === 'A006').map(f => [f.id, f.fila, f.faltan.join(''), f.sinPeriodo0]), [['A005', 8, 'LMN', true], ['A006', 9, 'LMN', true]])
    const g = rep.copiarFormulas.find(c => c.destino === "'Agencia'!L8:N9")
    assert.ok(g, JSON.stringify(rep.copiarFormulas.map(c => c.destino))); assert.equal(g.origen, "'Agencia'!L2:N2")
    assert.equal(g.request.copyPaste.destination.startRowIndex, 7); assert.equal(g.request.copyPaste.destination.endRowIndex, 9)
  })
})

describe('pestañas nuevas Referidos y Créditos (diseño + dry-run)', () => {
  const { PESTANA_REFERIDOS, PESTANA_CREDITOS, construirBatchUpdateNuevasPestanas, resumirBatch } = nuevas
  const encabezados = p => [p.columnas.map(c => c.encabezado)]
  test('los encabezados diseñados los lee parsear.ts: ninguna columna sin resolver', () => {
    const rf = parsearReferidos(encabezados(PESTANA_REFERIDOS))
    const faltantesRef = rf.columnas.faltantes.filter(k => k !== 'referidorNombre')
    assert.deepEqual(faltantesRef, []); assert.deepEqual(rf.columnas.duplicadas, [])
    const mv = parsearMovimientos(encabezados(PESTANA_CREDITOS))
    assert.deepEqual(mv.columnas.faltantes, []); assert.deepEqual(mv.columnas.duplicadas, [])
    // cada clave del diseño cae en la letra de su posición
    PESTANA_REFERIDOS.columnas.forEach((c, i) => { if (rf.columnas.resueltas[c.clave]) assert.equal(rf.columnas.resueltas[c.clave], String.fromCharCode(65 + i), c.clave) })
  })
  test('columnas del pedido: 16 de Referidos (+1 de ayuda) y 11 de Créditos', () => {
    assert.deepEqual(PESTANA_REFERIDOS.columnas.slice(0, 16).map(c => c.encabezado), ['ID', 'Fecha del pedido', 'Momento', 'ID referidor', 'Nombre', 'Teléfono', 'Mail', 'Estudio', 'Estado', 'Fecha de llamada', 'ID cliente nuevo', 'Fecha del primer pago', 'Fecha de liberación', 'Reembolso', 'Notas', 'Cargado por'])
    assert.deepEqual(PESTANA_REFERIDOS.columnas[8].lista, ['Presentado', 'Asistió', 'No asistió', 'Cerró', 'No cerró', 'Descartado'])
    assert.deepEqual(PESTANA_CREDITOS.columnas.map(c => c.encabezado), ['ID', 'Fecha', 'ID cliente', 'Tipo', 'Referido', 'Meses (+/-)', 'Extra', 'Vence', 'Renovación aplicada', 'Nota', 'Cargado por'])
    assert.deepEqual(PESTANA_CREDITOS.columnas[3].lista, ['ganado_cierre', 'ganado_llamada', 'canje', 'vencimiento', 'ajuste'])
  })
  test('fórmulas: liberación = primer pago + 14 (sale de la configuración), vence = fecha + 12 meses', () => {
    const lib = PESTANA_REFERIDOS.columnas.find(c => c.clave === 'fechaLiberacion').formula
    assert.equal(lib(5), '=IF(OR($L5="",$N5="SI"),"",$L5+14)')
    assert.equal(PESTANA_CREDITOS.columnas.find(c => c.clave === 'vence').formula(3), '=IF(OR($D3="ganado_cierre",$D3="ganado_llamada"),IF($B3="","",EDATE($B3,12)),"")')
    assert.deepEqual(PESTANA_REFERIDOS.columnas.filter(c => c.formula).map(c => c.clave), ['fechaLiberacion', 'referidorNombre'])
  })
  test('batchUpdate: solo toca las dos pestañas nuevas (sheetId propios), crea 2 hojas y valida las listas', () => {
    const b = construirBatchUpdateNuevasPestanas()
    const ids = new Set()
    JSON.stringify(b, (k, v) => { if (k === 'sheetId') ids.add(v); return v })
    assert.deepEqual([...ids].sort(), [7100001, 7100002])
    const r = resumirBatch(b)
    assert.equal(r.addSheet, 2); assert.ok(r.setDataValidation >= 10); assert.equal(r.addProtectedRange, 3)
    assert.ok(b.requests.every(x => !('deleteSheet' in x) && !('deleteRange' in x) && !('updateSpreadsheetProperties' in x)))
    const estados = b.requests.find(x => x.setDataValidation?.rule.condition.values?.some(v => v.userEnteredValue === 'Presentado'))
    assert.equal(estados.setDataValidation.rule.condition.type, 'ONE_OF_LIST'); assert.equal(estados.setDataValidation.rule.condition.values.length, 6)
  })
  test('el script de las pestañas no puede escribir: sin googleapis, sin credenciales, sin red y sin flag para enviar', () => {
    for (const f of ['scripts/crm-referidos-tabs.mjs', 'lib/clientes/pestanasNuevas.ts']) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
      for (const prohibido of ['googleapis', 'google.sheets', '.spreadsheets', 'fetch(', 'GOOGLE_PRIVATE_KEY', '.env.local', 'valueInputOption', 'process.env']) assert.equal(src.includes(prohibido), false, `${f} contiene ${prohibido}`)
    }
  })
})

describe('la capa de datos es de solo lectura', () => {
  test('ningún archivo de lib/clientes escribe en Sheets: scope readonly y sin métodos de escritura', () => {
    const lee = n => readFileSync(new URL(`../lib/clientes/${n}`, import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    const leer = lee('leer.ts')
    assert.ok(leer.includes("spreadsheets.readonly")); assert.equal(leer.includes("auth/spreadsheets'"), false)
    // TODOS los .ts de lib/clientes (también metas, programa, ficha, listado, demo…), no una lista fija que se desactualiza al sumar archivos
    const archivos = readdirSync(new URL('../lib/clientes/', import.meta.url)).filter(n => n.endsWith('.ts'))
    assert.ok(archivos.length >= 20 && archivos.includes('metas.ts') && archivos.includes('programa.ts'), 'tiene que recorrer todos los archivos')
    // ÚNICO escritor autorizado: escribirReferido.ts (Registrar referido: una fila en Referidos, scope de planillas, solo con
    // CRM_ESCRITURA_REFERIDOS=real). Sus propios límites los prueba scripts/test-alta-referido.mjs. Todo el resto sigue sin escribir.
    // Segundo escritor: escribirCanje.ts (libro Créditos), conectado SOLO a la ruta del canje y con la bandera CRM_ESCRITURA_CANJE=real (se comprueba abajo).
    // actualizarReferido.ts (27/10/2026): "Actualizar referido" escribe I:L y N:O de UNA fila existente de Referidos.
    for (const n of archivos.filter(a => a !== 'escribirReferido.ts' && a !== 'escribirCanje.ts' && a !== 'actualizarReferido.ts')) {
      for (const metodo of ['values.update', 'values.append', 'values.clear', 'batchUpdate(', '.clear(']) assert.equal(lee(n).includes(metodo), false, `${n} usa ${metodo}`)
      assert.equal(lee(n).includes("auth/spreadsheets'"), false, `${n} pide el scope de escritura`)
    }
    assert.equal(lee('altas.ts').includes('googleapis'), false)
  })
  test('el escritor del canje (escribirCanje.ts) solo lo importa la ruta POST /api/referidos/canje (ninguna pantalla ni otro módulo)', () => {
    const recorrer = d => readdirSync(new URL(d, import.meta.url), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? (e.name === 'node_modules' || e.name === '.next' ? [] : recorrer(`${d}${e.name}/`)) : [`${d}${e.name}`]))
    const fuentes = ['../app/', '../components/', '../lib/'].flatMap(recorrer).filter(f => /\.(ts|tsx)$/.test(f))
    const importadores = fuentes.filter(f => !f.endsWith('/escribirCanje.ts') && /escribirCanje['"]/.test(readFileSync(new URL(f, import.meta.url), 'utf8')))
    assert.deepEqual(importadores, ['../app/api/referidos/canje/route.ts'])
  })
})

describe('pestañas Referidos y Créditos que existen pero están vacías (solo encabezados): estados vacíos honestos', () => {
  const cab = p => [p.columnas.map(c => c.encabezado)]
  const vacias = { ...hojasBase(), referidos: cab(nuevas.PESTANA_REFERIDOS), creditos: cab(nuevas.PESTANA_CREDITOS) }
  const snapshot = hojas => ({ version: 1, guardadoEn: Date.now(), invalidado: false, hojas, ausentes: {}, formulasAgencia: null, formulasRenovaciones: null, reintentarDesde: 0 })
  const datos = datosDesdeSnapshot(snapshot(vacias), 'snapshot', { hoy: HOY })
  test('las pestañas cuentan como existentes y sin filas: no están "ausentes" ni hay referidos ni movimientos', () => {
    assert.deepEqual(datos.pestanasAusentes, []); assert.deepEqual(datos.referidos, []); assert.deepEqual(datos.movimientos, [])
  })
  test('el programa no inventa nada: embudo, intentos, créditos y USD en cero, sin referidores', () => {
    const creditos = calcularCreditosDeDatos(datos)
    assert.equal(creditos.size, 0)
    const r = resumirPrograma({ clientes: datos.clientes, referidos: datos.referidos, movimientos: datos.movimientos, creditos, hoy: HOY, pestanasAusentes: datos.pestanasAusentes })
    assert.deepEqual(r.embudo, { presentados: 0, asistieron: 0, cerraron: 0, liberados: 0 }); assert.equal(r.intentos, 0); assert.equal(r.referidoresActivos, 0)
    assert.deepEqual([r.creditos.usdDisponible, r.creditos.usdCanjeado, r.creditos.usdPorVencer, r.creditos.disponiblesMeses], [0, 0, 0, 0])
    assert.deepEqual([r.ranking.length, r.cerca.length], [0, 0])
  })
  test('la ficha de un cliente sin referidos trae ceros SIN declarar pestañas ausentes (la pantalla dice "Sin registros todavía")', () => {
    const f = armarFicha(datos, calcularCreditosDeDatos(datos), 'A001', { conContacto: false })
    assert.deepEqual(f.creditos.pestanasAusentes, []); assert.deepEqual(f.panel.pestanasAusentes, [])
    assert.equal(f.panel.referidos.presentados, 0); assert.equal(f.panel.beneficios.intentos, 0); assert.equal(f.creditos.intentos, 0)
    assert.deepEqual(f.creditos.usd, { ganado: 0, usado: 0, vencido: 0, disponible: 0 }); assert.equal(f.creditos.mesesDisponibles, 0)
    assert.equal(f.creditos.paginaWeb, null); assert.equal(f.creditos.branding, null); assert.deepEqual(f.creditos.premiosIntentos, [])
    assert.equal(f.creditos.proximosPremios[0].texto, 'Página web completa'); assert.equal(f.creditos.movimientos.length, 0); assert.equal(f.creditos.referidos.length, 0)
    assert.equal(f.panel.dudasAbiertas.length, 10)
  })
  test('las columnas del listado muestran "—" (nada que contar), no ceros', () => {
    const paneles = panelesDeTodos(datos, calcularCreditosDeDatos(datos))
    assert.equal(paneles.size, 0)
    const fila = aListado(datos.clientes[0], 0, undefined, paneles.get(datos.clientes[0].id))
    assert.equal(fila.panel, null); assert.equal(fila.credito, null)
    assert.deepEqual([textoReferidos(fila.panel), textoIntentos(fila.panel), textoGrabacion(fila.panel)], ['—', '—', '—'])
  })
  test('con la pestaña Referidos ausente (no vacía) lo declara', () => {
    const d = datosDesdeSnapshot(snapshot(hojasBase()), 'snapshot', { hoy: HOY })
    assert.deepEqual(d.pestanasAusentes, ['Referidos', 'Créditos'])
    assert.deepEqual(armarFicha(d, new Map(), 'A001', { conContacto: false }).panel.pestanasAusentes, ['Referidos', 'Créditos'])
  })
})

describe('snapshot y respaldo ante errores (sin red)', () => {
  const hojas = () => ({ ...hojasBase() })
  const snapshotDe = (edadMs, o = {}) => ({ version: 1, guardadoEn: Date.now() - edadMs, invalidado: false, hojas: hojas(), ausentes: {}, formulasAgencia: null, formulasRenovaciones: null, reintentarDesde: 0, ...o })
  after(() => rmSync(DIR, { recursive: true, force: true }))

  test('sin snapshot y sin credenciales: falla y NO insiste hasta pasada la espera', async () => {
    reiniciarEstadoDeLectura()
    await assert.rejects(obtenerHojas(), /Faltan credenciales/)
    await assert.rejects(obtenerHojas(), /falló hace instantes/)
    assert.equal(lecturasRealizadas(), 0)
  })
  test('snapshot fresco (< 10 min): se usa sin leer Sheets', async () => {
    reiniciarEstadoDeLectura()
    snap.guardarSnapshot(snapshotDe(2 * 60_000))
    const r = await obtenerHojas()
    assert.equal(r.fuente, 'snapshot'); assert.equal(lecturasRealizadas(), 0)
    const d = await leerClientes({ hoy: HOY })
    assert.equal(d.fuente, 'snapshot'); assert.equal(d.clientes.length, 6); assert.deepEqual(d.pestanasAusentes, ['Referidos', 'Créditos'])
    assert.equal(d.clientes.find(c => c.id === 'A001').semaforo, 'verde')
  })
  test('snapshot vencido y Sheets falla (429 o lo que sea): se responde con el snapshot viejo y no se insiste', async () => {
    reiniciarEstadoDeLectura()
    snap.guardarSnapshot(snapshotDe(11 * 60_000))
    const r = await obtenerHojas()
    assert.equal(r.fuente, 'snapshot_viejo'); assert.ok(r.aviso)
    assert.ok(snap.leerSnapshot().reintentarDesde > Date.now())   // la espera queda guardada en el archivo
    const otra = await obtenerHojas({ forzar: true })              // ni forzando se insiste durante la espera
    assert.equal(otra.fuente, 'snapshot_viejo'); assert.match(otra.aviso, /espera/)
    assert.equal(lecturasRealizadas(), 0)
  })
  test('lectura muy reciente (< 30 s): ni forzando se vuelve a leer', async () => {
    reiniciarEstadoDeLectura()
    snap.guardarSnapshot(snapshotDe(5_000))
    const r = await obtenerHojas({ forzar: true })
    assert.equal(r.fuente, 'snapshot'); assert.match(r.aviso, /reciente/)
  })
  test('invalidar conserva los datos de respaldo', async () => {
    reiniciarEstadoDeLectura()
    snap.guardarSnapshot(snapshotDe(60_000, { ausentes: { Referidos: Date.now() } }))
    assert.equal(snap.invalidarSnapshot(), true)
    const s = snap.leerSnapshot()
    assert.equal(s.invalidado, true); assert.deepEqual(s.ausentes, {}); assert.equal(s.hojas.agencia.length, 7)
    assert.equal(snap.snapshotFresco(s), false)
    const r = await obtenerHojas()   // invalidado, sin credenciales: lee → falla → vuelve con el respaldo
    assert.equal(r.fuente, 'snapshot_viejo')
  })
  test('pedidos simultáneos comparten una sola lectura', async () => {
    reiniciarEstadoDeLectura()
    snap.guardarSnapshot(snapshotDe(11 * 60_000))
    const a = obtenerHojas(), b = obtenerHojas()
    assert.equal(a, b); await a
  })
  test('el archivo tiene permisos 600 (datos personales) y TTL de 10 min / espera de 60 s configurados', () => {
    snap.guardarSnapshot(snapshotDe(0))
    assert.equal(statSync(snap.rutaSnapshot()).mode & 0o777, 0o600)
    assert.equal(snap.TTL_SNAPSHOT_MS, 10 * 60_000); assert.equal(snap.ESPERA_TRAS_FALLO_MS, 60_000)
  })
  test('archivo corrupto o de otra versión = no hay snapshot', () => {
    writeFileSync(snap.rutaSnapshot(), '{roto')
    assert.equal(snap.leerSnapshot(), null)
    writeFileSync(snap.rutaSnapshot(), JSON.stringify({ version: 99 }))
    assert.equal(snap.leerSnapshot(), null)
  })
})
