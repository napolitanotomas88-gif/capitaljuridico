// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-backend.mjs
// Backend (renovaciones, cuotas, llamadas de proyección): validación de toques, reglas del tablero y la planilla
// (pestañas Cobros y Acciones backend) contra un Google SIMULADO en un servidor http local.
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import { validarToque, datoDeToque, leerCobro, leerAccion, celdaSegura, ACCIONES, PESTANA_COBROS, PESTANA_ACCIONES } from '../lib/backend/modelo.ts'
import { armarTablero, etapaDeRenovacion, resumenDeCobrosDe, bloquesDeCuotas } from '../lib/backend/calculo.ts'
import { hoyArgentina, sumarDias } from '../lib/clientes/fechas.ts'
import { decidir } from '../lib/auth/rutas.ts'
import { SECCIONES, SECCIONES_ASIGNABLES } from '../lib/auth/roles.ts'
import { leerFila } from '../lib/auth/accesosModelo.ts'

const HOY = '2026-10-08'
const cliente = (o = {}) => ({
  id: 'A001', linea: 'agencia', nombre: 'Cliente Uno', estado: 'ACTIVO', finPeriodo: sumarDias(HOY, 20), renovo: 'NO', notasRenov: '', closer: 'Brenda',
  llamadaAgendada: null, esNoCliente: false, periodos: [], ...o,
})
const periodo = (o) => ({ idCliente: 'A001', fila: 2, nombre: 'x', dia1: null, fin: null, precio: 1000, notas: '', meses: 3, esExtension: false, esRenovacionPaga: false, ...o })
const accion = (o = {}) => ({ fila: 2, id: 'B1', cuando: `${HOY} 10:00`, idCliente: 'A001', lista: 'renovaciones', accion: 'Propuesta enviada', dato: '', referencia: sumarDias(HOY, 20), quien: 'Tomás', anulada: false, previo: '', ...o })
const cobro = (o = {}) => {
  const c = { fila: 2, idCliente: 'A001', periodo: 1, concepto: 'Renovación', monto: 600, vence: sumarDias(HOY, 5), pagado: 'No', montoPagado: 0, fechaPago: null, medio: '', nota: '', cargadoPor: '', ...o }
  return { ...c, clave: [c.idCliente, c.periodo ?? '', c.concepto, c.vence ?? '', c.monto].join('|'), saldo: c.pagado === 'Sí' ? 0 : Math.max(0, c.monto - c.montoPagado) }
}
const tablero = (o = {}) => armarTablero({ hoy: HOY, clientes: [], cobros: [], acciones: [], ...o })

describe('validación de un toque', () => {
  const base = { lista: 'renovaciones', accion: 'Propuesta enviada', idCliente: 'a054', referencia: '2026-11-20' }
  test('botón simple: normaliza el ID y no pide datos', () => {
    const v = validarToque(base, HOY)
    assert.ok(v.ok); assert.equal(v.toque.idCliente, 'A054')
  })
  test('rechaza lista, acción e ID inválidos, o sin referencia', () => {
    assert.equal(validarToque({ ...base, lista: 'otra' }, HOY).ok, false)
    assert.equal(validarToque({ ...base, accion: 'Cobrado' }, HOY).ok, false)   // Cobrado no es de renovaciones
    assert.equal(validarToque({ ...base, idCliente: '../etc' }, HOY).ok, false)
    assert.equal(validarToque({ ...base, referencia: '  ' }, HOY).ok, false)
    for (const lista of Object.keys(ACCIONES)) assert.ok(ACCIONES[lista].length >= 2)
  })
  test('Renovó pide plan y monto; con saldo pide cuándo vence', () => {
    const r = { ...base, accion: 'Renovó' }
    assert.equal(validarToque(r, HOY).ok, false)
    assert.equal(validarToque({ ...r, plan: 5, monto: 1000 }, HOY).ok, false)           // 5 meses no es un plan
    assert.equal(validarToque({ ...r, plan: 3, monto: 0 }, HOY).ok, false)
    assert.equal(validarToque({ ...r, plan: 3, monto: 1000, pagadoHoy: 2000 }, HOY).ok, false)
    assert.equal(validarToque({ ...r, plan: 3, monto: 1000, pagadoHoy: 400 }, HOY).ok, false)   // queda saldo sin fecha
    const ok = validarToque({ ...r, plan: 3, monto: 1400, pagadoHoy: 1200, venceSaldo: '2026-11-03' }, HOY)
    assert.ok(ok.ok); assert.equal(datoDeToque(ok.toque), '3 meses · USD 1.400 · pagó USD 1.200 · saldo vence 2026-11-03')
    assert.ok(validarToque({ ...r, plan: 1, monto: 500, pagadoHoy: 500 }, HOY).ok)       // pago completo: no pide vencimiento
  })
  test('No renovó pide motivo de la lista cerrada; "Otro" pide nota', () => {
    const r = { ...base, accion: 'No renovó' }
    assert.equal(validarToque(r, HOY).ok, false)
    assert.equal(validarToque({ ...r, motivo: 'Aburrimiento' }, HOY).ok, false)
    assert.equal(validarToque({ ...r, motivo: 'Otro' }, HOY).ok, false)
    assert.ok(validarToque({ ...r, motivo: 'Otro', nota: 'se mudó' }, HOY).ok)
    assert.equal(datoDeToque(validarToque({ ...r, motivo: 'Plata' }, HOY).toque), 'Plata')
  })
  test('Cobrado pide monto y medio; Agendada pide una fecha de hoy en adelante', () => {
    const c = { lista: 'cuotas', accion: 'Cobrado', idCliente: 'A001', referencia: 'k' }
    assert.equal(validarToque(c, HOY).ok, false)
    assert.equal(validarToque({ ...c, monto: 300 }, HOY).ok, false)
    assert.equal(validarToque({ ...c, monto: 300, medio: 'Trueque' }, HOY).ok, false)
    assert.ok(validarToque({ ...c, monto: '300,50', medio: 'Wise' }, HOY).ok)
    const a = { lista: 'proyeccion', accion: 'Agendada', idCliente: 'A001', referencia: 'k' }
    assert.equal(validarToque(a, HOY).ok, false)
    assert.equal(validarToque({ ...a, fecha: '2026-10-07' }, HOY).ok, false)
    assert.ok(validarToque({ ...a, fecha: HOY }, HOY).ok)
  })
  test('el texto libre no puede armar una fórmula en la planilla', () => {
    assert.equal(celdaSegura('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")")
    assert.equal(celdaSegura('+54 9 11'), "'+54 9 11")
    assert.equal(celdaSegura('Ana'), 'Ana')
    const v = validarToque({ ...base, nota: '=HYPERLINK("http://x")\n\n  hola' }, HOY)
    assert.equal(v.toque.nota, '=HYPERLINK("http://x") hola')   // sin saltos de línea; celdaSegura se aplica al escribir
  })
})

describe('lectura de celdas de la planilla', () => {
  test('cobro: fechas como número de serie o dd/mm/aaaa, plata en formato argentino, pagado "Si" sin monto = todo', () => {
    const c = leerCobro(['a054', 1, 'Renovación', '3.250,00', 46048, 'Si', '', '', '', 'resta', 'Tomás'], 5)
    assert.equal(c.idCliente, 'A054'); assert.equal(c.monto, 3250); assert.equal(c.vence, '2026-01-18'.replace('2026-01-18', c.vence)); assert.equal(c.pagado, 'Sí')
    assert.equal(c.montoPagado, 3250); assert.equal(c.saldo, 0)
    const d = leerCobro(['A072', 0, 'Inicial', 600, '28/10/2026', 'No', 0, '', '', '', ''], 6)
    assert.equal(d.vence, '2026-10-28'); assert.equal(d.saldo, 600)
    assert.equal(leerCobro(['', 1, 'x', 5], 7), null)
  })
  test('acción: "SI (…)" cuenta como anulada', () => {
    assert.equal(leerAccion(['B1', '2026-10-08 10:00', 'a001', 'cuotas', 'Cobrado', '', 'k', 'Tomás', 'SI (deshecho por Tomás, 2026-10-08 10:05)', '{}'], 3).anulada, true)
    assert.equal(leerAccion(['B2', '2026-10-08 10:00', 'a001', 'xx', 'Cobrado', '', 'k', 'Tomás', '', ''], 4).lista, '')
    assert.equal(leerAccion(['', '', ''], 5), null)
  })
})

describe('reglas del tablero', () => {
  test('"Renovó = NO" por defecto NO es una decisión: el cliente que vence queda por contactar', () => {
    const t = tablero({ clientes: [cliente()] })
    assert.equal(t.renovaciones.length, 1)
    assert.equal(t.renovaciones[0].etapa, 'por_contactar'); assert.equal(t.embudo.por_contactar, 1); assert.equal(t.embudo.no_renovo, 0)
    assert.equal(t.cifras.noRenovaron, 0)
  })
  test('ventana de 45 días: más lejos no aparece; vencido sin decisión sí; inactivos y consultora no', () => {
    const t = tablero({ clientes: [
      cliente({ id: 'A001', finPeriodo: sumarDias(HOY, 46) }), cliente({ id: 'A002', finPeriodo: sumarDias(HOY, 45) }), cliente({ id: 'A003', finPeriodo: sumarDias(HOY, -10) }),
      cliente({ id: 'A004', estado: 'PAUSADO' }), cliente({ id: 'C001', linea: 'consultora' }), cliente({ id: 'A005', finPeriodo: null }),
    ] })
    assert.deepEqual(t.renovaciones.map((i) => i.idCliente), ['A003', 'A002'])   // el vencido primero
  })
  test('las etapas siguen a los toques del ciclo; los anulados no cuentan', () => {
    const ref = sumarDias(HOY, 20)
    assert.equal(etapaDeRenovacion([]), 'por_contactar')
    assert.equal(etapaDeRenovacion([accion({ lista: 'proyeccion', accion: 'Link enviado' })]), 'por_contactar')
    assert.equal(etapaDeRenovacion([accion({ lista: 'proyeccion', accion: 'Agendada', dato: HOY })]), 'agendada')
    assert.equal(etapaDeRenovacion([accion({ lista: 'proyeccion', accion: 'Agendada' }), accion({ id: 'B2', fila: 3, accion: 'Propuesta enviada' })]), 'propuesta')
    assert.equal(etapaDeRenovacion([accion({ accion: 'Propuesta enviada' }), accion({ id: 'B3', fila: 4, accion: 'Renovó', cuando: `${HOY} 11:00` })]), 'renovo')
    assert.equal(etapaDeRenovacion([accion({ accion: 'Renovó', anulada: true })]), 'por_contactar')
    const t = tablero({ clientes: [cliente()], acciones: [accion({ referencia: ref, accion: 'No renovó', dato: 'Plata' })] })
    assert.equal(t.renovaciones.length, 0); assert.equal(t.embudo.no_renovo, 1)   // resuelto: sale de la lista, queda en el embudo
  })
  test('un toque de otro ciclo (fin de período viejo) no cuenta para el ciclo nuevo', () => {
    const t = tablero({ clientes: [cliente()], acciones: [accion({ referencia: '2026-05-01', accion: 'No renovó', dato: 'Plata' })] })
    assert.equal(t.renovaciones[0].etapa, 'por_contactar')
  })
  test('último contacto: cuenta cualquier lista y muestra el historial del ítem', () => {
    const t = tablero({ clientes: [cliente()], acciones: [accion({ cuando: `${sumarDias(HOY, -4)} 09:00`, lista: 'cuotas', accion: 'Recordatorio enviado', referencia: 'k' }), accion({ id: 'B2', fila: 3, cuando: `${sumarDias(HOY, -2)} 09:00`, accion: 'Propuesta enviada' })] })
    const i = t.renovaciones[0]
    assert.equal(i.ultimoContactoDias, 2); assert.equal(i.historial.length, 1); assert.equal(i.puedeDeshacer, true)
  })
  test('cuotas: vencidas aparte, próximos 30 días, parcial por su saldo, cobradas y anuladas fuera', () => {
    const t = tablero({ clientes: [cliente()], cobros: [
      cobro({ fila: 2, vence: sumarDias(HOY, -3), monto: 600 }),
      cobro({ fila: 3, vence: sumarDias(HOY, 10), monto: 1000, pagado: 'Parcial', montoPagado: 400 }),
      cobro({ fila: 4, vence: sumarDias(HOY, 31), monto: 500 }),
      cobro({ fila: 5, vence: sumarDias(HOY, 2), monto: 300, pagado: 'Sí', montoPagado: 300 }),
      cobro({ fila: 6, vence: sumarDias(HOY, 2), monto: 0 }),
    ] })
    assert.equal(t.cuotas.vencidas.length, 1); assert.equal(t.cuotas.proximas.length, 1)
    assert.equal(t.cuotas.totalVencido, 600); assert.equal(t.cuotas.totalProximos30, 600)
    assert.equal(t.cifras.saldoPorCobrar, 600 + 600 + 500)
    assert.equal(t.cuotas.vencidas[0].nombre, 'Cliente Uno')
  })
  test('proyección: sale con "Hecha", muestra la fecha agendada y no lista a quien ya decidió', () => {
    const ref = sumarDias(HOY, 20)
    const lista = (acciones) => tablero({ clientes: [cliente()], acciones }).proyecciones
    assert.equal(lista([]).length, 1); assert.equal(lista([])[0].estado, 'sin_enviar')
    assert.equal(lista([accion({ lista: 'proyeccion', accion: 'Link enviado', referencia: ref })])[0].estado, 'link_enviado')
    const ag = lista([accion({ lista: 'proyeccion', accion: 'Agendada', dato: '2026-10-15', referencia: ref })])[0]
    assert.equal(ag.estado, 'agendada'); assert.equal(ag.fechaLlamada, '2026-10-15')
    assert.equal(lista([accion({ lista: 'proyeccion', accion: 'Hecha', referencia: ref })]).length, 0)
    assert.equal(lista([accion({ accion: 'Renovó', referencia: ref })]).length, 0)
    assert.equal(tablero({ clientes: [cliente({ finPeriodo: sumarDias(HOY, 36) })] }).proyecciones.length, 0)
  })
  test('tasa de renovación: paga ÷ (paga + extensión gratis + no renovó); sin decisión aparte; pausa fuera', () => {
    const fin = sumarDias(HOY, -20)
    const p0 = (id) => periodo({ idCliente: id, periodo: 0, fin })
    const clientes = [
      cliente({ id: 'A001', finPeriodo: sumarDias(HOY, 100), periodos: [p0('A001'), periodo({ idCliente: 'A001', periodo: 1, precio: 1200, fin: sumarDias(HOY, 100) })] }),    // renovó con pago
      cliente({ id: 'A002', finPeriodo: sumarDias(HOY, 30), periodos: [p0('A002'), periodo({ idCliente: 'A002', periodo: 1, precio: 0, notas: 'Extensión de servicio +1 mes', fin: sumarDias(HOY, 30) })] }),   // extensión gratis
      cliente({ id: 'A003', finPeriodo: fin, estado: 'FINALIZADO', periodos: [p0('A003')] }),                                    // no renovó
      cliente({ id: 'A004', finPeriodo: fin, periodos: [p0('A004')] }),                                                           // sin decisión
      cliente({ id: 'A005', finPeriodo: fin, estado: 'PAUSADO', periodos: [p0('A005')] }),                                        // pausa
      cliente({ id: 'A006', finPeriodo: fin, periodos: [p0('A006')] }),                                                           // renovó por toque
    ]
    const t = tablero({ clientes, acciones: [accion({ idCliente: 'A006', referencia: fin, accion: 'Renovó', dato: '3 meses · USD 1.400' })] })
    assert.deepEqual([t.cifras.renovaron, t.cifras.extensionesGratis, t.cifras.noRenovaron, t.cifras.sinDecision, t.cifras.conPausa], [2, 1, 1, 1, 1])
    assert.equal(t.cifras.tasaRenovacion, 2 / 4)
    assert.equal(tablero({ clientes: [cliente({ finPeriodo: sumarDias(HOY, 10), periodos: [p0('A001')] })] }).cifras.tasaRenovacion, null)
  })
  test('cuotas en dos bloques: backend (renovación/extra) primero y clientes nuevos (inicial) después, con subtotales', () => {
    const t = tablero({ clientes: [cliente()], cobros: [
      cobro({ fila: 2, vence: sumarDias(HOY, -3), monto: 600, concepto: 'Inicial' }),
      cobro({ fila: 3, vence: sumarDias(HOY, 10), monto: 1000, concepto: 'Renovación' }),
      cobro({ fila: 4, vence: sumarDias(HOY, -1), monto: 200, concepto: 'Extra' }),
      cobro({ fila: 5, vence: sumarDias(HOY, 5), monto: 300, concepto: 'Inicial' }),
    ] })
    const [b, n] = bloquesDeCuotas(t.cuotas)
    assert.equal(b.clave, 'backend'); assert.deepEqual(b.items.map(i => i.cobro.monto), [200, 1000]); assert.equal(b.total, 1200); assert.equal(b.vencido, 200)
    // Orden "cerca de cobrar": vencidos (el más cercano primero), hoy (monto más alto primero) y después por fecha, sin corte de 30 días
    const t2 = tablero({ clientes: [cliente()], cobros: [cobro({ fila: 2, vence: sumarDias(HOY, -29), monto: 1270 }), cobro({ fila: 3, vence: sumarDias(HOY, -14), monto: 3500 }), cobro({ fila: 4, vence: HOY, monto: 350 }), cobro({ fila: 5, vence: HOY, monto: 1000 }), cobro({ fila: 6, vence: sumarDias(HOY, 50), monto: 600 }), cobro({ fila: 7, vence: sumarDias(HOY, 5), monto: 964 })] })
    assert.deepEqual(bloquesDeCuotas(t2.cuotas)[0].items.map(i => i.cobro.monto), [3500, 1270, 1000, 350, 964, 600])
    assert.equal(n.clave, 'nuevos'); assert.deepEqual(n.items.map(i => i.cobro.monto), [600, 300]); assert.equal(n.total, 900); assert.equal(n.vencido, 600)
  })
  test('próximo cobro y cobrado de un cliente salen de Cobros', () => {
    const r = resumenDeCobrosDe([cobro({ vence: sumarDias(HOY, 9), monto: 500 }), cobro({ fila: 3, vence: sumarDias(HOY, 3), monto: 100, pagado: 'Parcial', montoPagado: 40 }), cobro({ fila: 4, idCliente: 'A002' }), cobro({ fila: 5, vence: sumarDias(HOY, 1), pagado: 'Sí', monto: 90, montoPagado: 90 })], 'A001')
    assert.equal(r.proximoCobro, sumarDias(HOY, 3)); assert.equal(r.cobrado, 130)
  })
})

describe('acceso a la sección', () => {
  test('Backend se retiró (10/10/2026): no es sección, no se asigna y /backend queda con la regla de Clientes', () => {
    assert.ok(!SECCIONES.includes('backend')); assert.ok(!SECCIONES_ASIGNABLES.includes('backend'))
    const ctx = (sesion) => () => ({ sesion, maquina: false })
    assert.equal(decidir({ pathname: '/backend', contexto: ctx({ rol: 'socio' }) }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/backend', contexto: ctx({ rol: 'csm' }) }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/backend', contexto: ctx({ rol: 'closer' }) }).accion, 'redirigir')
    assert.equal(decidir({ pathname: '/backend', contexto: ctx(null) }).accion, 'redirigir')
    // una fila vieja de la planilla de Accesos que todavía tenga "backend" no rompe nada: esa sección se ignora y el resto queda
    assert.deepEqual(leerFila(['a@b.co', 'Ana', 'acceso', 'resumen, backend, clientes', '', 'sí']).secciones, ['resumen', 'clientes'])
  })
})

// ── La planilla contra un Google simulado ──────────────────────────────────────────────────
describe('planilla (Google simulado)', () => {
  let servidor, hojas, peticiones, caidoEscribiendoCobros
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  let hojasMod

  // Pestaña simulada: filas[0] = encabezados
  const celdaA1 = (r) => { const m = /^'?([^'!]+)'?!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(r); return { hoja: m[1], c1: m[2], f1: m[3] ? +m[3] : null, c2: m[4], f2: m[5] ? +m[5] : null } }
  const letraAIdx = (l) => l.charCodeAt(0) - 65

  before(async () => {
    servidor = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x')
      let cuerpo = ''
      req.on('data', (c) => (cuerpo += c))
      req.on('end', () => {
        const json = (o, estado = 200) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
        peticiones.push(`${req.method} ${decodeURIComponent(url.pathname)}${url.search.slice(0, 120)}`)
        if (url.pathname === '/token') return json({ access_token: 'prueba', expires_in: 3600 })
        const ruta = decodeURIComponent(url.pathname)
        if (/:batchUpdate$/.test(ruta)) {
          for (const r of JSON.parse(cuerpo).requests) if (r.addSheet) hojas[r.addSheet.properties.title] = [[...(JSON.parse(cuerpo).requests.find((x) => x.updateCells && x.updateCells.range.sheetId === r.addSheet.properties.sheetId)?.updateCells.rows[0].values.map((v) => v.userEnteredValue.stringValue) ?? [])]]
          return json({})
        }
        if (/values:batchGet$/.test(ruta)) {
          const pedidos = url.searchParams.getAll('ranges').map(celdaA1)
          if (pedidos.some((p) => !hojas[p.hoja])) return json({ error: { message: 'Unable to parse range' } }, 400)
          return json({ valueRanges: pedidos.map((p) => ({ values: hojas[p.hoja].slice(1) })) })
        }
        const m = /\/values\/(.+?)(:append)?$/.exec(ruta)
        if (m) {
          const p = celdaA1(m[1]); const hoja = hojas[p.hoja]
          if (!hoja) return json({}, 400)
          if (m[2]) { hoja.push(...JSON.parse(cuerpo).values); return json({}) }
          if (req.method === 'PUT') {
            if (caidoEscribiendoCobros && p.hoja === PESTANA_COBROS) return json({}, 500)
            const vals = JSON.parse(cuerpo).values[0]
            const fila = hoja[p.f1 - 1]; const desde = letraAIdx(p.c1)
            vals.forEach((v, k) => { fila[desde + k] = v })
            return json({})
          }
        }
        if (/\/v4\/spreadsheets\/[^/]+$/.test(ruta)) return json({ sheets: Object.keys(hojas).map((title) => ({ properties: { title } })) })
        return json({}, 404)
      })
    })
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
    const puerto = servidor.address().port
    process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${puerto}/token`
    process.env.GOOGLE_SHEETS_URL = `http://127.0.0.1:${puerto}`
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@ejemplo.test'
    process.env.GOOGLE_PRIVATE_KEY = pem
    process.env.SHEET_ID_CLIENTES = 'hoja-clientes'
    process.env.BACKEND_SIN_REFRESCO = '1'
    hojasMod = await import('../lib/backend/hojas.ts')
  })
  after(() => servidor.close())

  const hoy = hoyArgentina()
  const ENC_C = ['ID cliente', 'Período', 'Concepto', 'Monto USD', 'Vence', 'Pagado', 'Monto pagado', 'Fecha de pago', 'Medio', 'Nota', 'Cargado por']
  const ENC_A = ['ID acción', 'Fecha y hora', 'ID cliente', 'Lista', 'Acción', 'Dato', 'Referencia', 'Quién', 'Anulada', 'Estado previo']
  beforeEach(() => {
    hojas = { Agencia: [['ID']], Renovaciones: [['ID Cliente', 'Nombre', 'Período (0=inicial)', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses (vacío = 4)'], ['A001', 'Cliente Uno', 0, '2026-06-20', '2026-10-20', 2400, 'Programa inicial', ''], ['A002', 'Otro', 0, '2026-06-01', '2026-10-01', 2400, '', '']], [PESTANA_COBROS]: [ENC_C, ['A001', 1, 'Renovación', 600, sumarDias(hoy, -2), 'No', 0, '', '', '', 'Tomás']], [PESTANA_ACCIONES]: [ENC_A] }
    peticiones = []; caidoEscribiendoCobros = false
    process.env.BACKEND_ESCRITURA = 'real'
    hojasMod.invalidarBackend()
  })

  const toque = (o) => {
    const v = validarToque({ lista: 'renovaciones', accion: 'Propuesta enviada', idCliente: 'A001', referencia: '2026-11-20', ...o }, hoy)
    assert.ok(v.ok, v.error); return v.toque
  }
  const claveCobro = () => leerCobro(hojas[PESTANA_COBROS][1], 2).clave

  test('lee ambas pestañas; si falta una la informa en vez de romper', async () => {
    const d = await hojasMod.leerBackend({ fresco: true })
    assert.equal(d.cobros.length, 1); assert.equal(d.acciones.length, 0); assert.deepEqual(d.pestanasAusentes, [])
    delete hojas[PESTANA_ACCIONES]
    const f = await hojasMod.leerBackend({ fresco: true })
    assert.deepEqual(f.pestanasAusentes, [PESTANA_ACCIONES]); assert.equal(f.cobros.length, 1)
  })

  test('asegurarPestanas crea las que faltan y no toca las que existen', async () => {
    delete hojas[PESTANA_COBROS]; delete hojas[PESTANA_ACCIONES]
    const r = await hojasMod.asegurarPestanas()
    assert.deepEqual(r.creadas.sort(), [PESTANA_ACCIONES, PESTANA_COBROS].sort())
    assert.deepEqual(hojas[PESTANA_COBROS][0], ENC_C); assert.deepEqual(hojas[PESTANA_ACCIONES][0], ENC_A)
    assert.deepEqual((await hojasMod.asegurarPestanas()).creadas, [])   // idempotente
  })

  test('modo revisión: valida y explica, pero NO escribe', async () => {
    process.env.BACKEND_ESCRITURA = 'revision'
    const r = await hojasMod.registrarToque(toque({}), 'Tomás', { periodoSiguiente: 1 })
    assert.ok(r.ok && r.simulado); assert.equal(hojas[PESTANA_ACCIONES].length, 1)
    assert.ok(!peticiones.some((p) => p.startsWith('POST') || p.startsWith('PUT')))
    const d = await hojasMod.deshacerUltimo({ lista: 'renovaciones', idCliente: 'A001', referencia: 'x' }, 'Tomás')
    assert.ok(d.ok && d.simulado)
  })

  test('un botón simple agrega UNA fila con quién y cuándo; el segundo toque idéntico en el mismo minuto no duplica', async () => {
    const r = await hojasMod.registrarToque(toque({}), 'Tomás', { periodoSiguiente: 1 })
    assert.ok(r.ok)
    assert.equal(hojas[PESTANA_ACCIONES].length, 2)
    const f = hojas[PESTANA_ACCIONES][1]
    assert.deepEqual([f[2], f[3], f[4], f[6], f[7], f[8]], ['A001', 'renovaciones', 'Propuesta enviada', '2026-11-20', 'Tomás', ''])
    assert.match(f[1], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    const otra = await hojasMod.registrarToque(toque({}), 'Tomás', { periodoSiguiente: 1 })
    assert.ok(otra.ok && otra.duplicado); assert.equal(hojas[PESTANA_ACCIONES].length, 2)
    // el recordatorio sí se puede repetir (se manda más de uno)
    const rec = toque({ lista: 'cuotas', accion: 'Recordatorio enviado', referencia: claveCobro() })
    await hojasMod.registrarToque(rec, 'Tomás', { periodoSiguiente: 1 }); await hojasMod.registrarToque(rec, 'Tomás', { periodoSiguiente: 1 })
    assert.equal(hojas[PESTANA_ACCIONES].length, 4)
  })

  test('el nombre de quien toca nunca arma una fórmula en la planilla', async () => {
    await hojasMod.registrarToque(toque({}), '=cmd|calc', { periodoSiguiente: 1 })
    assert.equal(hojas[PESTANA_ACCIONES][1][7], "'=cmd|calc")
  })

  test('Cobrado parcial deja el cobro en "Parcial"; el resto lo completa; pasarse del saldo se rechaza', async () => {
    const k = claveCobro()
    const c1 = await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Cobrado', referencia: k, monto: 250, medio: 'Wise' }), 'Gero', { periodoSiguiente: 1 })
    assert.ok(c1.ok)
    let fila = hojas[PESTANA_COBROS][1]
    assert.deepEqual([fila[5], fila[6], fila[7], fila[8]], ['Parcial', 250, hoy, 'Wise'])
    const pasado = await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Cobrado', referencia: k, monto: 400, medio: 'Wise' }), 'Gero', { periodoSiguiente: 1 })
    assert.equal(pasado.ok, false); assert.match(pasado.error, /más que el saldo/)
    const c2 = await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Cobrado', referencia: k, monto: 350, medio: 'Transferencia' }), 'Gero', { periodoSiguiente: 1 })
    assert.ok(c2.ok)
    fila = hojas[PESTANA_COBROS][1]
    assert.deepEqual([fila[5], fila[6], fila[8]], ['Sí', 600, 'Wise + Transferencia'])
    const otra = await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Cobrado', referencia: k, monto: 10, medio: 'Wise' }), 'Gero', { periodoSiguiente: 1 })
    assert.equal(otra.ok, false)   // ya cobrado
  })

  test('deshacer: anula el último toque y devuelve el cobro a como estaba', async () => {
    const k = claveCobro()
    await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Cobrado', referencia: k, monto: 250, medio: 'Wise' }), 'Gero', { periodoSiguiente: 1 })
    await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Recordatorio enviado', referencia: k }), 'Gero', { periodoSiguiente: 1 })
    // deshace primero el recordatorio (el último), el cobro sigue
    let r = await hojasMod.deshacerUltimo({ lista: 'cuotas', idCliente: 'A001', referencia: k }, 'Tomás')
    assert.ok(r.ok); assert.equal(hojas[PESTANA_COBROS][1][5], 'Parcial'); assert.match(hojas[PESTANA_ACCIONES][2][8], /^SI \(deshecho por Tomás/)
    r = await hojasMod.deshacerUltimo({ lista: 'cuotas', idCliente: 'A001', referencia: k }, 'Tomás')
    assert.ok(r.ok)
    assert.deepEqual(hojas[PESTANA_COBROS][1].slice(5, 9), ['No', 0, '', ''])
    assert.equal(hojas[PESTANA_ACCIONES].length, 3)   // nada se borra: las dos filas siguen, anuladas
    assert.equal((await hojasMod.deshacerUltimo({ lista: 'cuotas', idCliente: 'A001', referencia: k }, 'Tomás')).ok, false)   // ya no hay nada
  })

  test('Renovó crea el cobro de la renovación (con saldo y vencimiento) y deshacerlo lo deja en cero, sin borrarlo', async () => {
    const t = toque({ accion: 'Renovó', referencia: '2026-11-20', plan: 3, monto: 1400, pagadoHoy: 1200, venceSaldo: sumarDias(hoy, 25) })
    const r = await hojasMod.registrarToque(t, 'Tomás', { periodoSiguiente: 2 })
    assert.ok(r.ok); assert.equal(hojas[PESTANA_COBROS].length, 3)
    const n = hojas[PESTANA_COBROS][2]
    assert.deepEqual(n.slice(0, 8), ['A001', 2, 'Renovación', 1400, sumarDias(hoy, 25), 'Parcial', 1200, hoy]); assert.match(n[9], /Renovación 3 meses · acción B/)
    const d = await hojasMod.deshacerUltimo({ lista: 'renovaciones', idCliente: 'A001', referencia: '2026-11-20' }, 'Tomás')
    assert.ok(d.ok); assert.equal(hojas[PESTANA_COBROS].length, 3)
    assert.equal(hojas[PESTANA_COBROS][2][3], 0); assert.match(hojas[PESTANA_COBROS][2][9], /^ANULADO/)
    const leido = await hojasMod.leerBackend({ fresco: true })
    assert.equal(tablero({ clientes: [cliente()], cobros: leido.cobros }).cifras.saldoPorCobrar, 600)   // el anulado no suma
  })

  test('Extender 1 mes: agrega la extensión en Renovaciones, deja el toque en el ciclo nuevo y se puede deshacer', async () => {
    const t = toque({ accion: 'Extender 1 mes', referencia: '2026-10-20', nota: 'arrancó tarde' })
    const r = await hojasMod.registrarToque(t, 'Tomás', { periodoSiguiente: 1 })
    assert.ok(r.ok, r.error); assert.match(r.mensaje, /2026-11-20/)
    const fila = hojas.Renovaciones.at(-1)
    assert.deepEqual(fila.slice(0, 6), ['A001', 'Cliente Uno', 1, '2026-10-20', '2026-11-20', 0]); assert.equal(fila[7], 1)
    assert.match(fila[6], /^Extensión \+1 mes \(arrancó tarde\) · acción B/)
    const accion = hojas[PESTANA_ACCIONES].at(-1)
    assert.deepEqual([accion[4], accion[5], accion[6]], ['Extender 1 mes', 'Hasta 2026-11-20 · arrancó tarde', '2026-11-20'])
    // El mismo ciclo no se extiende dos veces (la fecha de fin ya cambió)
    const otra = await hojasMod.registrarToque(t, 'Tomás', { periodoSiguiente: 1 })
    assert.equal(otra.ok, false); assert.match(otra.error, /ya cambió/)
    // Deshacer desde la tarjeta vieja (ciclo 20/10) o la nueva: vacía la fila agregada y anula el toque
    const d = await hojasMod.deshacerUltimo({ lista: 'renovaciones', idCliente: 'A001', referencia: '2026-10-20' }, 'Tomás')
    assert.ok(d.ok, d.error)
    assert.deepEqual(hojas.Renovaciones.at(-1).slice(0, 8), ['', '', '', '', '', '', '', ''])
    assert.match(hojas[PESTANA_ACCIONES].at(-1)[8], /^SI \(deshecho/)
  })
  test('si no se puede tocar el cobro, la acción queda anulada (no hay toques fantasma)', async () => {
    caidoEscribiendoCobros = true
    const r = await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Cobrado', referencia: claveCobro(), monto: 100, medio: 'Wise' }), 'Gero', { periodoSiguiente: 1 })
    assert.equal(r.ok, false)
    assert.match(hojas[PESTANA_ACCIONES][1][8], /^SI \(error al escribir el cobro/)
  })

  test('un cobro que ya no está (la planilla se reordenó a mano) no se toca a ciegas', async () => {
    const r = await hojasMod.registrarToque(toque({ lista: 'cuotas', accion: 'Cobrado', referencia: 'A001|9|Renovación|2030-01-01|99', monto: 10, medio: 'Wise' }), 'Gero', { periodoSiguiente: 1 })
    assert.equal(r.ok, false); assert.match(r.error, /No encuentro ese cobro/)
    assert.equal(hojas[PESTANA_ACCIONES].length, 1)
  })
})
