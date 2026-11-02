// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-proyeccion.mjs
// Continuidad: la llamada de proyección (lib/bot/proyeccion). SIN red ni base: fetch bloqueado, dependencias falsas.
// Nombres, mails e IDs inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

for (const k of Object.keys(process.env)) if (/^(BOT_|BAJA_|DISCORD_|CALENDLY_)/.test(k) || ['DATABASE_URL', 'CRON_SECRET'].includes(k)) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const R = await import('../lib/bot/proyeccion/reglas.ts')
const N = await import('../lib/bot/proyeccion/nucleo.ts')
const M = await import('../lib/bot/proyeccion/marcas.ts')
const V = await import('../lib/bot/proyeccion/vista.ts')
const BN = await import('../lib/bot/bajas/nucleo.ts')
const P = await import('../lib/alertas/personas.ts')

const HOY = '2026-11-02'
const sumar = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
let n = 0
const cli = (dias, extra = {}) => ({ id: `A9${String(++n).padStart(2, '0')}`, nombre: `Cliente Ficticio${n} Inventado${n}`, estado: 'ACTIVO', linea: 'agencia', mail: `ficticio${n}@ejemplo.test`, celular: '', dia1: '2026-07-01', finPeriodo: sumar(HOY, dias), periodos: [], fechaBaja: null, satisfaccion: null, ...extra })
const marca = (c, extra) => ({ idCrm: c.id, fin: c.finPeriodo, avisado: null, agendada: null, agendadaFuente: null, resultado: null, resultadoFecha: null, quien: 'Aylu', cuando: '2026-11-01T12:00:00Z', ...extra })

describe('fechas: −14 / −7 / −5 / −3', () => {
  test('pasoDelDia', () => {
    assert.equal(R.pasoDelDia(15), null)
    for (const d of [14, 10, 8]) assert.equal(R.pasoDelDia(d), 'invitar')
    for (const d of [7, 6]) assert.equal(R.pasoDelDia(d), 'agendar')
    for (const d of [5, 4]) assert.equal(R.pasoDelDia(d), 'rec5')
    for (const d of [3, 1, 0]) assert.equal(R.pasoDelDia(d), 'rec3')
    assert.equal(R.pasoDelDia(-1), null)
  })
  test('candidatos: 0 a 14 días para el cron; con atraso para el panel', () => {
    const cs = [cli(15), cli(14), cli(7), cli(5), cli(3), cli(0), cli(-1)]
    assert.deepEqual(R.candidatosProyeccion(cs, HOY).map((x) => x.dias), [0, 3, 5, 7, 14])
    assert.deepEqual(R.candidatosProyeccion(cs, HOY, {}, 30).map((x) => x.dias), [-1, 0, 3, 5, 7, 14])
  })
  test('fin real con extensión en Renovaciones (pausas incluidas)', () => {
    const c = cli(3, { periodos: [{ fin: sumar(HOY, 12), meses: null, periodo: 2 }] })
    assert.equal(R.candidatosProyeccion([c], HOY)[0].dias, 12)
  })
  test('plan del día: invitar a −14, tarea a −7, recordatorios a −5 y −3, con claves distintas', () => {
    const cs = [cli(14), cli(7), cli(5), cli(3)]
    const { acciones } = R.planDelDia(R.candidatosProyeccion(cs, HOY), [], [])
    assert.deepEqual(acciones.map((a) => [a.dias, a.paso]), [[3, 'rec3'], [5, 'rec5'], [7, 'agendar'], [14, 'invitar']])
    assert.equal(new Set(acciones.map((a) => a.clave)).size, 4)
    assert.match(acciones[3].clave, /^proyeccion:A9\d\d:\d{4}-\d{2}-\d{2}:invitar$/)
  })
})

describe('exclusiones', () => {
  test('sin fin, pausados, finalizados, no clientes, prueba y otra línea quedan fuera', () => {
    const sinFinLista = cli(10), sinFinMarca = cli(10, { sinFin: true }), pausado = cli(10, { estado: 'PAUSADO' }), fin = cli(10, { estado: 'FINALIZADO' })
    const noCli = cli(10, { esNoCliente: true }), prueba = cli(10, { nombre: 'PRUEBA BOT Ficticio' }), pruebaLista = cli(10), otra = cli(10, { linea: 'consultoria' }), ok = cli(10)
    const todos = [sinFinLista, sinFinMarca, pausado, fin, noCli, prueba, pruebaLista, otra, ok]
    const r = R.candidatosProyeccion(todos, HOY, { sinFin: [sinFinLista.id], prueba: [pruebaLista.id] })
    assert.deepEqual(r.map((x) => x.cliente.id), [ok.id])
    assert.equal(R.motivoFuera(pausado), 'pausado')
    assert.equal(R.motivoFuera(sinFinLista, { sinFin: [sinFinLista.id] }), 'sin fecha de fin')
  })
})

describe('corte por «agendada» / «hecha»', () => {
  test('marca manual agendada o hecha corta la tarea de −7', () => {
    const a = cli(7), b = cli(5), c = cli(3)
    const marcas = [marca(a, { agendada: sumar(HOY, 4) }), marca(b, { resultado: 'hecha', resultadoFecha: HOY })]
    const p = R.planDelDia(R.candidatosProyeccion([a, b, c], HOY), marcas, [])
    assert.deepEqual(p.acciones.map((x) => x.cliente.id), [c.id])
    assert.deepEqual(p.cortados.map((x) => x.motivo).sort(), ['llamada agendada', 'llamada hecha'])
  })
  test('«No se dio» vuelve a pedir que se agende', () => {
    const a = cli(5)
    const p = R.planDelDia(R.candidatosProyeccion([a], HOY), [marca(a, { agendada: '2026-11-01', resultado: 'no_se_dio', resultadoFecha: '2026-11-01' })], [])
    assert.equal(p.acciones[0].paso, 'rec5')
  })
  test('ya avisado a mano: la invitación de −14 no sale', () => {
    const a = cli(12)
    const p = R.planDelDia(R.candidatosProyeccion([a], HOY), [marca(a, { avisado: '2026-10-30' })], [])
    assert.equal(p.acciones.length, 0)
    assert.equal(p.cortados[0].motivo, 'ya avisado')
  })
  test('la acción «Llamada de proyección» de la tarjeta (sin fin) cuenta por cercanía', () => {
    const a = cli(6)
    const accion = { idCrm: a.id, fin: null, ref: '2026-10-31', avisado: null, agendada: sumar(HOY, 3), agendadaFuente: 'accion', resultado: null, resultadoFecha: null, quien: 'tomas', cuando: '2026-10-31T10:00:00Z' }
    assert.equal(R.planDelDia(R.candidatosProyeccion([a], HOY), [accion], []).acciones.length, 0)
    const vieja = { ...accion, ref: '2026-06-01' }
    assert.equal(R.planDelDia(R.candidatosProyeccion([a], HOY), [vieja], []).acciones.length, 1)
  })
  test('marca de otro ciclo (fin a más de 30 días) no corta', () => {
    const a = cli(7)
    assert.equal(R.planDelDia(R.candidatosProyeccion([a], HOY), [marca(a, { fin: '2026-05-01', agendada: '2026-04-25' })], []).acciones.length, 1)
  })
})

describe('Calendly: la kickoff agendada por segunda vez', () => {
  test('qué eventos cuentan', () => {
    assert.ok(R.esEventoProyeccion('KickOff - Skyward Consultoría Jurídica', 'tomi'))
    assert.ok(R.esEventoProyeccion('Reunion de Análisis y Proyecciones', 'ventas'))
    assert.ok(!R.esEventoProyeccion('Reunión Consultiva - Capital Jurídico', 'ventas'))
    assert.ok(!R.esEventoProyeccion('Coaching Call - Semanal', 'tomi'))
    assert.ok(!R.esEventoProyeccion('Reunión Presencial - Capital Jurídico', 'ventas'))
  })
  test('por mail o por 2 palabras del nombre: anota «Agendada» y corta', () => {
    const a = cli(7), b = cli(5), c = cli(3)
    const ev = [
      { invitado: 'Otra Persona', email: a.mail.toUpperCase(), inicio: sumar(HOY, 2), evento: 'KickOff' },
      { invitado: `Dra. ${b.nombre.split(' ').slice(1).join(' ')} ficticio${b.id.slice(-2) * 1}`, email: '', inicio: sumar(HOY, 3), evento: 'KickOff' },
      { invitado: 'Ficticio Nadie', email: 'x@ejemplo.test', inicio: sumar(HOY, 1), evento: 'KickOff' },
    ]
    const p = R.planDelDia(R.candidatosProyeccion([a, b, c], HOY), [], ev)
    assert.deepEqual(p.detecciones.map((d) => d.cliente.id).sort(), [a.id, b.id].sort())
    assert.deepEqual(p.acciones.map((x) => x.cliente.id), [c.id])
  })
  test('ya anotada a mano: no se vuelve a anotar; ya anotada desde Calendly con la misma fecha: tampoco', () => {
    const a = cli(7), b = cli(6)
    const ev = [{ invitado: '', email: a.mail, inicio: sumar(HOY, 2), evento: 'KickOff' }, { invitado: '', email: b.mail, inicio: sumar(HOY, 2), evento: 'KickOff' }]
    const marcas = [marca(a, { agendada: sumar(HOY, 5), agendadaFuente: 'manual' }), marca(b, { agendada: sumar(HOY, 2), agendadaFuente: 'calendly' })]
    assert.equal(R.planDelDia(R.candidatosProyeccion([a, b], HOY), marcas, ev).detecciones.length, 0)
  })
  test('reprogramada en Calendly: se anota la fecha nueva', () => {
    const a = cli(7)
    const p = R.planDelDia(R.candidatosProyeccion([a], HOY), [marca(a, { agendada: sumar(HOY, 2), agendadaFuente: 'calendly' })], [{ invitado: '', email: a.mail, inicio: sumar(HOY, 4), evento: 'KickOff' }])
    assert.equal(p.detecciones[0].evento.inicio, sumar(HOY, 4))
  })
})

describe('corrida (núcleo) con dependencias falsas', () => {
  const deps = (clientes, extra = {}) => {
    const hechas = { enviar: [], tareas: [], anotadas: [], verif: [] }
    return {
      hechas,
      d: {
        hoy: HOY, dry: false, calendlyUrl: 'https://calendly.example/tomi', exclusiones: {},
        leerClientes: async () => clientes, leerMarcas: async () => [], eventosCalendly: async () => [],
        paraEnviar: async (p) => (hechas.enviar.push(p), { estado: 'manual_pendiente' }),
        tarea: async (p) => (hechas.tareas.push(p), { estado: 'enviado' }),
        anotarAgendada: async (p) => { hechas.anotadas.push(p) },
        verificaciones: async (p) => (hechas.verif.push(p), { estado: 'enviado' }),
        ...extra,
      },
    }
  }
  test('invitación en 📤 con el Calendly y tono de continuidad; tarea en 🛠️ con el texto si no se avisó', async () => {
    const a = cli(14), b = cli(7)
    const { d, hechas } = deps([a, b])
    const r = await N.correrProyeccion(d)
    assert.equal(r.invitar.length, 1); assert.equal(r.agendar.length, 1)
    assert.match(hechas.enviar[0].texto, /llamada de proyección/); assert.match(hechas.enviar[0].texto, /calendly\.example/)
    assert.doesNotMatch(hechas.enviar[0].texto, /termina|vence|se te/i)
    assert.equal(hechas.enviar[0].fin, a.finPeriodo)
    assert.match(hechas.tareas[0].titulo, /^Agendar la llamada de proyección con .* \(le quedan 7 días\)$/)
    assert.ok(hechas.tareas[0].copiar)
  })
  test('en seco no manda ni anota nada', async () => {
    const a = cli(14), b = cli(7)
    const { d, hechas } = deps([a, b], { dry: true, eventosCalendly: async () => [{ invitado: '', email: b.mail, inicio: sumar(HOY, 3), evento: 'KickOff' }] })
    const r = await N.correrProyeccion(d)
    assert.equal(r.invitar[0].estado, 'haría'); assert.equal(r.agendadas.length, 1)
    assert.equal(hechas.enviar.length + hechas.tareas.length + hechas.anotadas.length + hechas.verif.length, 0)
  })
  test('detección en Calendly: anota y avisa en ✅ («X agendó la llamada de proyección para el …»), sin tarea', async () => {
    const b = cli(7)
    const { d, hechas } = deps([b], { eventosCalendly: async () => [{ invitado: '', email: b.mail, inicio: '2026-11-06', evento: 'KickOff' }] })
    await N.correrProyeccion(d)
    assert.deepEqual(hechas.anotadas, [{ idCrm: b.id, fin: b.finPeriodo, fecha: '2026-11-06' }])
    assert.match(hechas.verif[0].titulo, /agendó la llamada de proyección para el 06\/11\/2026$/)
    assert.equal(hechas.tareas.length, 0)
  })
  test('sin marcas legibles no avisa (podría avisar de más); Calendly caído igual avisa', async () => {
    const a = cli(7)
    const r1 = await N.correrProyeccion(deps([a], { leerMarcas: async () => { throw new Error('base caída') } }).d)
    assert.equal(r1.agendar.length, 0); assert.equal(r1.errores.length, 1)
    const r2 = await N.correrProyeccion(deps([a], { eventosCalendly: async () => { throw new Error('caído') } }).d)
    assert.equal(r2.agendar.length, 1)
  })
  test('archivado: no avisa', async () => {
    const a = cli(7)
    const r = await N.correrProyeccion(deps([a], { clienteOperativo: async () => false }).d)
    assert.equal(r.agendar.length, 0); assert.equal(r.cortados[0].motivo, 'archivado')
  })
})

describe('sin duplicar con i01 de Bajas', () => {
  test('la invitación va como pieza i01 a Aylu, Gero M y Tomás, con nombre de continuidad', () => {
    assert.deepEqual([...P.RESPONSABLE_POR_DEFECTO.i01].sort(), ['aylu', 'gero_m', 'tomas'])
    assert.equal(P.NOMBRE_PIEZA.i01, 'Invitación a la llamada de proyección')
  })
  test('con avisoFinPorProyeccion, Bajas no abre el pedido de OK del aviso de fin', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../lib/bot/bajas/nucleo.ts', import.meta.url), 'utf8')
    assert.match(src, /if \(d\.avisoFinPorProyeccion\) \{/)
    // un OK tardío a un pedido viejo no manda el aviso: lo cierra como reemplazado
    assert.match(src, /reemplazado por la invitación de la llamada de proyección/)
    const srv = (await import('node:fs')).readFileSync(new URL('../lib/bot/bajas/servidor.ts', import.meta.url), 'utf8')
    assert.match(srv, /avisoFinPorProyeccion: !prueba && proyeccionPrendida\(env\)/)
    assert.equal(typeof BN.crearNucleoBajas, 'function')
  })
  test('interruptor BOT_PROYECCION', () => {
    assert.equal(R.proyeccionPrendida({}), true)
    assert.equal(R.proyeccionPrendida({ BOT_PROYECCION: 'no' }), false)
  })
})

describe('marcas (validación del POST) y vista del panel', () => {
  test('leerPedidoMarca', () => {
    assert.deepEqual(M.leerPedidoMarca({ fin: '2026-11-15', campo: 'agendada', fecha: '2026-11-10' }, HOY), { fin: '2026-11-15', campo: 'agendada', fecha: '2026-11-10', resultado: null })
    assert.deepEqual(M.leerPedidoMarca({ fin: '2026-11-15', campo: 'resultado', fecha: HOY, resultado: 'no_se_dio' }, HOY).resultado, 'no_se_dio')
    assert.equal(M.leerPedidoMarca({ fin: '2026-11-15', campo: 'avisado', fecha: null }, HOY).fecha, null)
    assert.equal(typeof M.leerPedidoMarca({ fin: '2026-02-30', campo: 'avisado', fecha: null }, HOY), 'string')
    assert.equal(typeof M.leerPedidoMarca({ fin: '2026-11-15', campo: 'resultado', fecha: '2026-11-20', resultado: 'hecha' }, HOY), 'string')
    assert.equal(typeof M.leerPedidoMarca({ fin: '2026-11-15', campo: 'otro', fecha: null }, HOY), 'string')
  })
  test('panel: atrasados y por agendar primero, hechas al final', () => {
    const a = cli(10), b = cli(-3), c = cli(6), d = cli(2)
    const items = V.itemsProyeccion([a, b, c, d], [marca(d, { resultado: 'hecha', resultadoFecha: HOY })], HOY, {})
    assert.deepEqual(items.map((i) => i.fase), ['atrasado', 'agendar', 'invitar', 'hecha'])
  })
})

describe('revisión: Calendly hacia atrás, primera kickoff, Bajas ya resuelto y texto corto', () => {
  test('la proyección agendada antes del día −14 cuenta; la primera kickoff (primer mes) no', () => {
    const c = cli(5, { dia1: '2026-08-07', nombre: 'Maria Ficticia Inventada Caro', mail: '' })
    const ev = (inicio) => [{ invitado: 'Ficticia Inventada', email: '', inicio, evento: 'KickOff' }]
    assert.equal(R.eventoDe(c, ev('2026-10-16'), c.finPeriodo)?.inicio, '2026-10-16')          // 22 días antes del fin
    assert.equal(R.eventoDe(c, ev('2026-08-20'), c.finPeriodo), null)                           // la del arranque
    const nuevo = cli(10, { dia1: '2026-10-25' })
    assert.equal(R.eventoDe(nuevo, [{ invitado: '', email: nuevo.mail, inicio: '2026-11-03', evento: 'KickOff' }], nuevo.finPeriodo), null)
  })
  test('aviso de fin de Bajas ya resuelto (enviado o NO): la invitación no vuelve a salir', async () => {
    const a = cli(12)
    const enviar = []
    const d = {
      hoy: HOY, dry: false, calendlyUrl: 'https://calendly.example.test/x', exclusiones: {},
      leerClientes: async () => [a], leerMarcas: async () => [], eventosCalendly: async () => [],
      avisosFinResueltos: async () => new Set([`${a.id}:${a.finPeriodo}`]),
      paraEnviar: async (p) => { enviar.push(p); return { estado: 'enviado' } }, tarea: async () => ({ estado: 'enviado' }),
      anotarAgendada: async () => {}, verificaciones: async () => ({ estado: 'enviado' }),
    }
    const r = await N.correrProyeccion(d)
    assert.equal(enviar.length, 0); assert.equal(r.cortados[0].motivo, 'aviso de fin ya resuelto en Bajas')
    const r2 = await N.correrProyeccion({ ...d, avisosFinResueltos: async () => { throw new Error('caída') } })
    assert.equal(r2.invitar.length, 0); assert.equal(r2.errores.length, 1)
  })
  test('texto: «en una semana» a −14, «en estos días» si se pega desde la tarea', () => {
    assert.match(R.textoInvitacion('Ficticia X', 'https://c.test', 14), /en una semana hacemos/)
    const corto = R.textoInvitacion('Ficticia X', 'https://c.test', 5)
    assert.match(corto, /en estos días hacemos/); assert.doesNotMatch(corto, /una semana/)
    assert.doesNotMatch(corto + R.textoInvitacion('X', '', 14), /termina|se te acaba|vence/i)
  })
})
