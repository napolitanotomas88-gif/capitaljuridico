// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-anuncios-por-lanzar.mjs
// "Por lanzar" del tablero de anuncios con la ficha de kickoff (lib/anuncios/porLanzar.ts y kickoffs.ts). SIN red y SIN
// base: fetch global queda bloqueado y DATABASE_URL se borra.
// Fixture: FICHA_PRUEBA, inventada con la MISMA FORMA que la ficha de la prueba del 24/10 (.cache/kickoff-prueba/
// salida-195704214.json, la kickoff de Laura): mismos campos, minutos y montos, pero nombres, lugares, citas, cuenta y mails
// inventados. Si además está la salida real (no se versiona), un test la pasa por el resumen y controla lo que importa sin
// imprimir nada de su contenido: que salga la tarjeta, sin mails ni datos de los ganadores (otros clientes).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

for (const k of ['DATABASE_URL', 'DESPACHO_URL']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const P = await import('../lib/anuncios/porLanzar.ts')
const K = await import('../lib/anuncios/kickoffs.ts')
const { crearCruce } = await import('../lib/anuncios/cruce.ts')
const V = await import('../lib/bot/kickoff/vista.ts')
const { combinarZonaConMapa } = await import('../lib/bot/kickoff/mapa-zona.ts')
const { VERSION_MAPA } = await import('../lib/bot/kickoff/mapa-prompt.ts')

const clonar = x => JSON.parse(JSON.stringify(x))
const BASE = 'https://despacho-capital-juridico.vercel.app'
const AHORA = Date.parse('2026-10-24T20:30:00.000Z')
const CUANDO = '2026-10-24T18:05:00.000Z'
const ev = (cita, timestamp, aprox = null) => ({ cita, timestamp, textual: true, aprox })
const item = (texto, cita, ts, aprox) => ({ texto, ...ev(cita, ts, aprox) })
const noSeHablo = { estado: 'no_se_hablo', detalle: '', cita: '', timestamp: null, textual: false }
const final = (estado, fuente, detalle, llamada = null) => ({ estado, detalle, fuente, meta: fuente === 'meta' || estado === 'sin_dato' ? { estado, detalle } : null, llamada, discrepancia: null })

const FICHA_PRUEBA = {
  version: 1,
  recording_id: 900000001,
  titulo: 'CLIENTA PRUEBA y Tomas Napolitano',
  url: 'https://fathom.video/calls/900000001',
  fecha: '2026-10-23T12:00:00Z',
  tipo_reunion: 'kickoff',
  resumen_corto: 'Kickoff de prueba: laboral despidos, 8 a 10 USD por día.',
  cliente: { nombre_escuchado: 'CLIENTA PRUEBA', apodo: 'Pru', cliente_crm: 'Clienta Prueba Inventada', id_crm: 'P157', email: 'clienta@ejemplo.test', como: 'email', cuentas: [] },
  rama: {
    principal: 'laboral', texto: 'Laboral: despidos', ...ev('arrancamos con despidos, que es lo que más entra', '00:22:10'),
    subramas: [item('despidos', 'arrancamos con despidos', '00:22:10'), item('despido después de un accidente de trabajo (doble causa), a confirmar', 'ahí hay dos temas', '00:18:07')],
    descartadas: [{ ...item('Penal', 'penal no me animo', '00:08:50'), motivo: 'se arranca con una sola rama' }],
    a_futuro: [item('Familia, cuando laboral funcione', 'familia después', '00:07:07', '00:08:25')],
  },
  avatar: {
    incluye: [item('antigüedad mínima de un año y medio trabajando', 'al menos un año y medio', '00:10:23'), item('en blanco o mitad en negro y mitad en blanco (prioridad)', 'más prioridad a los que estaban en blanco', '00:12:00', '00:12:19')],
    excluye: [
      item('nada de trabajo totalmente en negro', 'totalmente en negro no', '00:12:00', '00:12:25'),
      item('nada de pasantes', 'pasantes no', '00:10:23'),
      item('contexto de la zona: hay mucho trabajo rural', 'acá hay mucho trabajo rural', '00:10:42', '00:11:41'),
    ],
  },
  zona: {
    descripcion: 'Provincia de prueba: zona marcada en el mapa en pantalla desde Colonia Inventada hasta Pueblo Ficticio.',
    lugares: ['Colonia Inventada (de oído, verificar)', 'Villa Prueba', 'Pueblo Ficticio'],
    radio_km: null,
    presentarse_como: { texto: 'Ciudad Capital de Prueba', cuando: 'si un lead le pregunta dónde está', ...ev('deciles que estás en la capital', '00:16:00', '00:16:53') },
    contexto: [item('El estudio está a 60 km de la capital', 'estoy a 60 kilómetros', '00:16:00', '00:16:30')],
    pais: 'AR', mapa_en_pantalla: true, ...ev('desde Colonia Inventada hasta Pueblo Ficticio', '00:16:00', '00:17:18'),
  },
  presupuesto: {
    usd_dia_min: 8, usd_dia_max: 10, usd_mes: 240, moneda: 'USD', texto: '8 a 10 dólares al día; con 8 por día, 240 dólares al mes',
    deducido: false, certeza: 'confirmado', ...ev('8 a 10 dólares al día', '00:15:42'), evidencia_mes: ev('serían 240 al mes', '00:15:48'),
  },
  portfolio: {
    instagram: noSeHablo, whatsapp_business: noSeHablo, pagina_facebook: noSeHablo, portfolio_comercial: noSeHablo,
    tarjeta: { estado: 'sin_verificar', detalle: 'se le pidió tenerla cargada; no se comprobó', ...ev('que la tengas bien cargada', '00:18:59') },
    verificacion: noSeHablo, accesos_equipo: noSeHablo,
  },
  acuerdos: [
    { quien: 'Tomás', que: 'Primera entrega de guiones de despidos', cuando: 'mar 27/10 o mié 28/10, estimado', ...ev('tardamos entre dos, tres días', '00:18:36') },
    { quien: 'Clienta (Pru)', que: 'Grabar los videos y subirlos a su carpeta', cuando: null, ...ev('vos te los vas a grabar', '00:18:13') },
    { quien: 'Equipo de Capital Jurídico', que: 'Editar los videos y publicarlos en la campaña', cuando: null, ...ev('lo editamos', '00:18:19') },
  ],
  pendientes: [],
  ideas_guiones: {
    estado: 'a_revisar', revisores: ['Tomi', 'Gero M'], notas: '',
    ideas: [
      { titulo: 'Te echaron después de años', gancho: '¿Te despidieron después de dos años en blanco?', angulo: 'antigüedad', subrama: 'despidos', por_que: 'se apoya en G1' },
      { titulo: 'Volviste del accidente', gancho: 'Volviste de la ART y te echaron', angulo: 'doble causa', subrama: 'despido después de un accidente', por_que: 'G2' },
    ],
  },
  ganadores: { estado: 'ok', nota: '', ventana: '180 días', lista: [{ id: 'G1', anuncio: 'Gancho ajeno', copy: 'copy ajeno', subtema: 'despidos', cplUSD: 1, mensajes: 50, gastoUSD: 50, pais: 'AR', cliente: 'Otro Cliente Secreto', cuentaId: 'act_999999999999' }] },
  ajustes: [],
  faltantes: [],
  fin_grabacion: '2026-10-23T12:22:30Z',
  fin_agendado: '2026-10-23T12:45:00Z',
  grabo: { nombre: 'Tomas Napolitano', email: 'tomas@ejemplo.test', quien: 'Tomás' },
  portfolio_meta: {
    cuenta: 'act_1000000000000001', nombre: 'USD ESTUDIO PRUEBA', leido: true, motivo: null, aviso: null, generado: '2026-10-24T20:18:27.290Z',
    origen_cuenta: 'descubrimiento', moneda: 'USD', zona_horaria: 'America/Buenos_Aires',
  },
  portfolio_final: {
    instagram: final('sin_dato', 'ninguna', 'No se ve Instagram en el portfolio · en la llamada no se habló'),
    whatsapp_business: final('sin_dato', 'ninguna', 'Meta no nos deja leer el número de la página · en la llamada no se habló'),
    pagina_facebook: final('ok', 'meta', 'Página en el portfolio: «Estudio Prueba»'),
    portfolio_comercial: final('ok', 'meta', 'Portfolio «Estudio Prueba», dueño de la cuenta · sin verificar (no frena nada)'),
    tarjeta: final('ok', 'meta', 'Hay medio de pago: sí (tarjeta de crédito/débito); sin deuda', { estado: 'sin_verificar', detalle: 'se le pidió tenerla cargada', cita: 'que la tengas bien cargada', timestamp: '00:18:59', textual: true }),
    verificacion: final('ok', 'meta', 'Cuenta publicitaria activa, sin restricciones'),
    accesos_equipo: final('ok', 'meta', 'Con acceso para anunciar: Gero A y Valentino'),
  },
}

/** Una fila de cj_kickoffs como la devuelve la consulta de kickoffs.ts (aFila), con la ficha de prueba (o la que se pase). */
function fila(o = {}) {
  const ficha = 'ficha' in o ? o.ficha : clonar(FICHA_PRUEBA)
  return K.aFila({
    recording_id: ficha?.recording_id ?? 900000001, estado: 'lista', titulo: ficha?.titulo ?? null, url: ficha?.url ?? null,
    cliente_crm: ficha?.cliente?.cliente_crm ?? null, id_crm: ficha?.cliente?.id_crm ?? null, error: null, revision: null, portfolio_checks: null,
    faltantes_checks: null, zona_video: null, creado: new Date('2026-10-24T17:26:55.361Z'), actualizado: '2026-10-24T17:52:02.881Z', ...o, ficha,
  })
}
const resumir = (o = {}) => P.resumirKickoff(fila(o), { base: BASE, ahoraMs: AHORA })
const marca = nota => ({ nota, quien: 'Usuario de prueba', email: 'alguien@ejemplo.test', cuando: CUANDO })

describe('resumirKickoff: la tarjeta de la ficha de prueba (misma forma que la de Laura)', () => {
  const k = resumir()
  test('cabecera: link a la ficha del Despacho, grabación, fecha y la cuenta de Fathom que la grabó', () => {
    assert.equal(k.recordingId, 900000001)
    assert.equal(k.idCrm, 'P157')
    assert.equal(k.clienteCRM, 'Clienta Prueba Inventada')
    assert.equal(k.link, 'https://despacho-capital-juridico.vercel.app/clientes/P157/kickoff')
    assert.equal(k.fathom, 'https://fathom.video/calls/900000001')
    assert.equal(k.fecha, 'vie 23/10 09:00')
    assert.equal(k.quien, 'Tomás')
    assert.equal(k.clienteOido, 'CLIENTA PRUEBA')
    assert.deepEqual(k.ojos, [])
  })
  test('cuenta publicitaria con nombre, moneda y horario (de la ficha)', () => {
    assert.deepEqual(k.cuenta, { id: 'act_1000000000000001', nombre: 'USD ESTUDIO PRUEBA', monedaHora: 'factura en USD · hora de Argentina' })
    assert.equal(k.cuentaAviso, null)
  })
  test('rama y subramas; avatar sin el "nada de" y sin el contexto del mercado', () => {
    assert.equal(k.rama.nombre, 'Laboral (despidos)')
    assert.deepEqual(k.rama.subramas, ['despidos', 'despido después de un accidente de trabajo (doble causa), a confirmar'])
    assert.deepEqual(k.avatar.incluye, ['antigüedad mínima de un año y medio trabajando', 'en blanco o mitad en negro y mitad en blanco (prioridad)'])
    assert.deepEqual(k.avatar.excluye, ['trabajo totalmente en negro', 'pasantes'])
  })
  test('zona: lugares, "presentarse como" y el mapa pendiente con su ▶ a la grabación', () => {
    assert.deepEqual(k.zona.lugares, ['Colonia Inventada (de oído, verificar)', 'Villa Prueba', 'Pueblo Ficticio'])
    assert.equal(k.zona.descripcion, '', 'con lugares, la descripción no se repite')
    assert.deepEqual(k.zona.presentarse, { texto: 'Ciudad Capital de Prueba', cuando: 'si un lead le pregunta dónde está' })
    assert.equal(k.zona.mapa.estado, 'pendiente')
    assert.match(k.zona.mapa.texto, /^Mapa pendiente/)
    assert.equal(k.zona.mapa.momento.etiqueta, '≈17:18')
    assert.match(k.zona.mapa.momento.href, /^https:\/\/fathom\.video\/calls\/900000001/)
  })
  test('presupuesto por día y por mes; lanzamiento armado desde los acuerdos (sin fecha cargada)', () => {
    assert.equal(k.presupuesto.texto, 'USD 8 por día para arrancar (hasta 10) · ~USD 240 por mes')
    assert.equal(k.presupuesto.aConfirmar, false)
    assert.equal(k.lanzamiento.fecha, null)
    assert.match(k.lanzamiento.texto, /^Lanzamiento: sin fecha \(guiones para mar 27\/10 o mié 28\/10, estimado/)
    assert.equal(k.whatsapp, null)
  })
  test('portfolio: nada frena; Instagram y WhatsApp quedan para revisar a mano (WhatsApp antes)', () => {
    assert.deepEqual(k.frenos.map(f => [f.item, f.estado, f.frena]), [['whatsapp_business', 'para_tildar', false], ['instagram', 'para_tildar', false]])
    assert.equal(k.frenos[1].nombre, 'Instagram')
  })
  test('otros faltantes: los que no son del portfolio ni del mapa (cargar la cuenta en el CRM)', () => {
    assert.deepEqual(k.otrosFaltantes, ['Portfolio · cargar act_1000000000000001 en «Cuentas Meta» del CRM: hoy la encontró sola el tablero de anuncios'])
  })
  test('ideas: estado de la revisión', () => {
    assert.equal(k.ideas, 'Falta que las revisen Tomi y Gero M.')
  })
  test('no sale ningún mail ni nada de los ganadores (otros clientes), ni las citas', () => {
    const t = JSON.stringify(k)
    assert.doesNotMatch(t, /@/)
    assert.doesNotMatch(t, /Otro Cliente Secreto|act_999999999999|copy ajeno|Gancho ajeno/)
    assert.doesNotMatch(t, /arrancamos con despidos|deciles que/)
  })
})

describe('resumirKickoff: lo cargado a mano en la ficha manda', () => {
  test('fecha estimada, WhatsApp de destino y recorte anotado', () => {
    const k = resumir({ faltantes_checks: { fecha_lanzamiento: marca('mar 3/11'), whatsapp_destino: marca('+54 9 2954 000000'), zona_mapa: marca('Villa Prueba +20 km, sin Pueblo Ficticio') } })
    assert.equal(k.lanzamiento.fecha, 'mar 3/11')
    assert.equal(k.whatsapp, '+54 9 2954 000000')
    assert.equal(k.zona.mapa.estado, 'anotado')
    assert.equal(k.zona.mapa.texto, 'Recorte anotado en la ficha: Villa Prueba +20 km, sin Pueblo Ficticio')
    assert.ok(!k.otrosFaltantes.some(x => /^Zona/.test(x)))
  })
  test('un tilde a mano en falta pasa a frenar (con quién y la nota), y va primero', () => {
    const k = resumir({ portfolio_checks: { instagram: { valor: 'falta', nota: 'no tiene Instagram', quien: 'Tomi', email: 'x@ejemplo.test', cuando: CUANDO } } })
    assert.deepEqual(k.frenos.map(f => [f.item, f.estado, f.frena]), [['instagram', 'falta', true], ['whatsapp_business', 'para_tildar', false]])
    assert.equal(k.frenos[0].detalle, 'tildado a mano por Tomi · no tiene Instagram')
    assert.doesNotMatch(JSON.stringify(k), /@/)
  })
  test('accesos y tarjeta que faltan según Meta frenan, accesos antes que tarjeta', () => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.portfolio_final.tarjeta = final('problema', 'meta', 'Hay deuda en la cuenta')
    ficha.portfolio_final.accesos_equipo = final('falta', 'meta', 'Valentino no tiene acceso a la cuenta')
    const k = resumir({ ficha })
    assert.deepEqual(k.frenos.filter(f => f.frena).map(f => [f.nombre, f.estado]), [['Accesos del equipo', 'falta'], ['Tarjeta', 'problema']])
    assert.equal(k.frenos[0].detalle, 'Valentino no tiene acceso a la cuenta')
  })
  test('presupuesto a confirmar y cuenta en pesos (el faltante de la moneda queda en "otros")', () => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.presupuesto.certeza = 'a_confirmar'
    ficha.portfolio_meta.moneda = 'ARS'
    const k = resumir({ ficha })
    assert.equal(k.presupuesto.aConfirmar, true)
    assert.equal(k.cuenta.monedaHora, 'factura en ARS · hora de Argentina')
    assert.ok(k.otrosFaltantes.some(x => /^La cuenta factura en ARS: pasar USD 8–10 por día a pesos/.test(x)), k.otrosFaltantes.join(' | '))
    assert.ok(k.otrosFaltantes.includes('Presupuesto a confirmar'))
  })
})

describe('resumirKickoff: el mapa leído del video', () => {
  const zv = (estado, extra = {}) => ({ estado, version: VERSION_MAPA, quien: 'tomas', download_id: null, motivo: null, transitorio: false, mapa: null, momentos: [1038], tokens: null, modelo: null, generado: '2026-10-24T20:25:00.000Z', ...extra })
  const leido = lugares => combinarZonaConMapa(clonar(FICHA_PRUEBA.zona), {
    hay_mapa: true, tipo: 'google_maps', marca: 'poligono', marca_detalle: 'polígono a mano', radio_km: null, radio_estimado_km: null, radio_como: '',
    limites: 'de la ruta 5 al río', excluidas: [], mejor_cuadro: 3, momento: '00:17:30', legible: 'si', notas: '',
    lugares: lugares.map(nombre => ({ nombre, posicion: 'dentro' })),
  }).mapa
  test('leído y coincide con lo dicho: el recorte del video, con su ▶ al cuadro', () => {
    const k = resumir({ zona_video: zv('ok', { mapa: leido(['Colonia Inventada', 'Villa Prueba', 'Pueblo Ficticio']) }) })
    assert.equal(k.zona.mapa.estado, 'leido')
    assert.match(k.zona.mapa.texto, /^Recorte leído del mapa del video: Colonia Inventada · Villa Prueba · Pueblo Ficticio/)
    assert.match(k.zona.mapa.texto, /límites: de la ruta 5 al río/)
    assert.equal(k.zona.mapa.momento.etiqueta, '17:30')
  })
  test('leído pero no coincide: revisar con Tomi', () => {
    const k = resumir({ zona_video: zv('ok', { mapa: leido(['Villa Prueba']) }) })
    assert.equal(k.zona.mapa.estado, 'revisar')
    assert.match(k.zona.mapa.texto, /^Revisar con Tomi: el mapa del video no coincide del todo con lo dicho/)
  })
  test('el bot lo está leyendo; colgado más de 20 minutos pasa a pendiente con el porqué', () => {
    assert.equal(resumir({ zona_video: zv('leyendo') }).zona.mapa.estado, 'leyendo')
    const colgado = P.resumirKickoff(fila({ zona_video: zv('leyendo') }), { base: BASE, ahoraMs: AHORA + 60 * 60_000 })
    assert.equal(colgado.zona.mapa.estado, 'pendiente')
    assert.match(colgado.zona.mapa.texto, /no se pudo leer del video/)
  })
  test('sin mapa en pantalla no hay línea del mapa', () => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.zona.mapa_en_pantalla = false
    assert.equal(resumir({ ficha }).zona.mapa, null)
  })
})

describe('resumirKickoff: fichas viejas, a medias o que no son kickoff', () => {
  test('ficha de antes del chequeo de Meta: sin cuenta, con el porqué; sin quién la hizo', () => {
    const ficha = clonar(FICHA_PRUEBA)
    for (const x of ['portfolio_meta', 'portfolio_final', 'grabo']) delete ficha[x]
    const k = resumir({ ficha })
    assert.equal(k.cuenta, null)
    assert.match(k.cuentaAviso, /^Sin chequeo de Meta/)
    assert.equal(k.quien, null)
    assert.ok(k.frenos.length >= 1, 'lo que nadie confirmó queda para revisar')
  })
  test('no es "lista", no es kickoff o no tiene la forma de una ficha → null', () => {
    assert.equal(resumir({ estado: 'error' }), null)
    assert.equal(resumir({ estado: 'procesando' }), null)
    assert.equal(resumir({ ficha: { ...clonar(FICHA_PRUEBA), tipo_reunion: 'seguimiento' } }), null)
    assert.equal(resumir({ ficha: {} }), null)
    assert.equal(resumir({ ficha: null }), null)
  })
  test('sin id del CRM no hay link (el nombre del CRM sigue sirviendo para cruzar)', () => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.cliente.id_crm = null
    const k = resumir({ ficha, id_crm: null })
    assert.equal(k.link, null)
    assert.equal(k.idCrm, null)
    assert.equal(k.clienteCRM, 'Clienta Prueba Inventada')
  })
})

describe('ultimasPorCliente / resumirKickoffs: la última kickoff lista de cada cliente', () => {
  const conFecha = (id, fecha, o = {}) => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.recording_id = id
    ficha.fecha = fecha
    if (o.idCrm !== undefined) ficha.cliente.id_crm = o.idCrm
    if (o.nombre) ficha.cliente.cliente_crm = o.nombre
    if (o.tipo) ficha.tipo_reunion = o.tipo
    return fila({ ficha, recording_id: id, estado: o.estado ?? 'lista', id_crm: ficha.cliente.id_crm, cliente_crm: ficha.cliente.cliente_crm })
  }
  test('gana la más nueva lista; no cuentan las que quedaron en error ni las que no son kickoff', () => {
    const filas = [
      conFecha(1, '2026-10-10T12:00:00Z'),
      conFecha(2, '2026-10-20T12:00:00Z'),
      conFecha(3, '2026-10-22T12:00:00Z', { estado: 'error' }),
      conFecha(4, '2026-10-23T12:00:00Z', { tipo: 'seguimiento' }),
      conFecha(5, '2026-10-21T12:00:00Z', { idCrm: 'p157' }),   // el id se compara sin mayúsculas
      conFecha(6, '2026-10-15T12:00:00Z', { idCrm: null, nombre: 'Otra Clienta Sin Id' }),
      conFecha(7, '2026-10-18T12:00:00Z', { idCrm: null, nombre: 'otra clienta sin id' }),
    ]
    assert.deepEqual(P.ultimasPorCliente(filas).map(f => f.recording_id), [5, 7])
    assert.deepEqual(P.resumirKickoffs(filas, { base: BASE, ahoraMs: AHORA }).map(k => k.recordingId), [5, 7])
  })
})

// ── El cruce, con las opciones del tablero (opcionesCruceTablero) sobre un CRM de prueba y la heurística real de cuentas ──
const CRM = {
  clientes: [
    ['Clienta Prueba Inventada', 'ACTIVO'], ['Zeta Sin Ficha', 'ACTIVO'], ['Beta Con Acceso', 'ACTIVO'], ['Delta Por Cuenta', 'ACTIVO'],
    ['Épsilon Ficha Sin Acceso', 'ACTIVO'], ['Gamma Ya Gasta', 'ACTIVO'], ['Eta Frenada', 'ACTIVO'], ['Laura Fernández', 'ACTIVO'],
    ['José María Gallardo Pérez', 'ACTIVO'], ['Cliente Pausado Viejo', 'PAUSADO'],
  ].map(([nombre, estado]) => ({ nombre, estado })),
  cuentasMeta: [], alias: [], guiones: [], errores: [],
}
const cruce = crearCruce(CRM)
const cuenta = (id, nombre = `Cuenta ${id}`, por = 'nombre') => ({ id, nombre, estado: 1, por })
const VISIBLES = [
  { id: 'act_1000000000000001', nombre: 'USD ESTUDIO PRUEBA', estado: 1 }, { id: 'act_30000', nombre: 'Cuenta act_30000', estado: 1 },
  { id: 'act_60000', nombre: 'USD ETA', estado: 1 }, { id: 'act_70000', nombre: 'USD FERNANDEZ RUIZ', estado: 1 },
  { id: 'act_80000', nombre: 'Cuenta act_80000', estado: 1 }, { id: 'act_99900', nombre: 'Cuenta act_99900', estado: 1 },
]
const opTablero = (o = {}) => P.opcionesCruceTablero({
  buscarCliente: cruce.buscarCliente, visibles: VISIBLES, filas: [{ id: 'act_50000', cliente: 'Gamma G. (cuenta vieja)' }],
  excluida: id => (id === 'act_10100' ? 'cuenta cerrada en Meta' : null), descubrimientoOk: true, ...o,
})
const kick = (id, o = {}) => ({ ...resumir(), recordingId: id, ...o })
const it = (cliente, cuentas = [], extra = {}) => ({ cliente, acceso: cuentas.length ? 'si' : 'no', cuentas, etapa: null, clickup: null, ...extra })
const conFreno = { frenos: [{ item: 'accesos_equipo', nombre: 'Accesos del equipo', estado: 'falta', detalle: 'Valentino no tiene acceso a la cuenta', frena: true }] }

describe('cruzarKickoffs: grupos y orden', () => {
  const items = [
    it('Zeta Sin Ficha'),
    it('Beta Con Acceso', [cuenta('act_80000')]),
    it('Clienta Prueba Inventada'),                                     // el tablero no le encontró cuenta por nombre
    it('Delta Por Cuenta', [cuenta('act_30000')]),                     // dos palabras en común con su cuenta
    it('Épsilon Ficha Sin Acceso', [cuenta('act_99900')]),             // el tablero le adivinó otra cuenta
    it('Gamma Ya Gasta'),
    it('Eta Frenada'),
  ]
  const kickoffs = [
    kick(11),                                                                                                      // por nombre; su cuenta la ve el tablero
    kick(12, { clienteCRM: 'Estudio Delta Otro', cuenta: { id: 'act_30000', nombre: null, monedaHora: '' }, fechaIso: '2026-10-01T12:00:00Z' }),   // por cuenta, a nombre de otro
    kick(13, { clienteCRM: 'Epsilon Ficha Sin Acceso', cuenta: { id: 'act_40400', nombre: null, monedaHora: '' } }),   // su cuenta no la ve el tablero
    kick(15, { clienteCRM: 'Gamma Ya Gasta', cuenta: { id: 'act_50000', nombre: null, monedaHora: '' } }),             // su cuenta ya tiene fila
    kick(16, { clienteCRM: 'Eta Frenada', cuenta: { id: 'act_60000', nombre: null, monedaHora: '' }, ...conFreno }),  // con acceso pero frenada
    kick(14, { clienteCRM: 'Cliente Pausado Viejo' }),                                                                  // está en el CRM: no es suelta
  ]
  const { porLanzar: r, sueltas } = P.cruzarKickoffs(items, kickoffs, opTablero())
  const de = n => r.find(x => x.cliente === n)
  test('orden: listos, a revisar (de la kickoff más vieja), sin acceso, ya gastan, y los sin ficha como antes', () => {
    assert.deepEqual(r.map(x => [x.cliente, x.grupo]), [
      ['Clienta Prueba Inventada', 'listo'], ['Delta Por Cuenta', 'revisar'], ['Eta Frenada', 'revisar'], ['Épsilon Ficha Sin Acceso', 'sin_acceso'],
      ['Gamma Ya Gasta', 'ya_gasta'], ['Zeta Sin Ficha', 'sin_ficha_sin_acceso'], ['Beta Con Acceso', 'sin_ficha_con_acceso'],
    ])
    assert.deepEqual(sueltas, [], 'las que no cruzaron son de clientes que están en el CRM')
  })
  test('por nombre del CRM; la cuenta de la ficha visible da acceso y va primera', () => {
    const c = de('Clienta Prueba Inventada')
    assert.equal(c.kickoff.recordingId, 11)
    assert.equal(c.acceso, 'si')
    assert.deepEqual(c.cuentas.map(x => [x.id, x.por]), [['act_1000000000000001', 'ficha']])
    assert.equal(c.cuentaFicha.estado, 'visible')
    assert.equal(c.confirmar, null)
    assert.equal(c.sinFicha, false)
  })
  test('por la cuenta (dos palabras en común) con la ficha a nombre de otro: a confirmar, no está listo', () => {
    const d = de('Delta Por Cuenta')
    assert.equal(d.kickoff.recordingId, 12)
    assert.equal(d.confirmar, 'Ficha guardada a nombre de «Estudio Delta Otro», cruzada por la cuenta act_30000: confirmar que es este cliente')
    assert.equal(d.grupo, 'revisar')
  })
  test('la cuenta de la ficha no la ve el tablero: sin acceso, aunque el tablero le haya adivinado otra (queda como "otra visible")', () => {
    const e = de('Épsilon Ficha Sin Acceso')
    assert.equal(e.kickoff.recordingId, 13)
    assert.deepEqual([e.acceso, e.cuentaFicha.estado], ['no', 'no_visible'])
    assert.deepEqual(e.cuentas.map(x => x.id), ['act_99900'])
  })
  test('la cuenta de la ficha ya tiene fila: ya gasta (con el nombre de la fila), con acceso y fuera de "listos"', () => {
    const g = de('Gamma Ya Gasta')
    assert.deepEqual(g.cuentaFicha, { estado: 'con_fila', cliente: 'Gamma G. (cuenta vieja)' })
    assert.equal(g.acceso, 'si')
    assert.equal(g.grupo, 'ya_gasta')
  })
  test('ficha y acceso pero el portfolio frena (accesos del equipo): a revisar, no "listo"', () => {
    assert.deepEqual([de('Eta Frenada').acceso, de('Eta Frenada').grupo], ['si', 'revisar'])
    assert.equal(r.filter(x => x.grupo === 'listo').length, 1, 'el chip «listos para armar» cuenta solo los del grupo listo')
  })
  test('sin ficha: la marca "sin ficha de kickoff" (se leyó la base)', () => {
    assert.deepEqual([de('Zeta Sin Ficha').kickoff, de('Zeta Sin Ficha').sinFicha], [null, true])
    assert.equal(de('Beta Con Acceso').sinFicha, true)
  })
  test('base caída (null): como antes del 24/10, sin ficha ni marca ni sueltas, sin acceso primero y por nombre', () => {
    const viejo = P.cruzarKickoffs(items, null, opTablero())
    assert.deepEqual(viejo.porLanzar.map(x => x.cliente), ['Clienta Prueba Inventada', 'Eta Frenada', 'Gamma Ya Gasta', 'Zeta Sin Ficha', 'Beta Con Acceso', 'Delta Por Cuenta', 'Épsilon Ficha Sin Acceso'])
    assert.ok(viejo.porLanzar.every(x => x.kickoff === null && x.sinFicha === false && x.cuentaFicha === null))
    assert.deepEqual(viejo.porLanzar.find(x => x.cliente === 'Épsilon Ficha Sin Acceso').acceso, 'si', 'sin ficha, el acceso es el de antes')
    assert.deepEqual(viejo.sueltas, [])
  })
  test('una ficha se usa una sola vez, y su cuenta se le saca al otro cliente que la tenía solo por el nombre', () => {
    const k = kick(31, { clienteCRM: 'Estudio Uno Dos', cuenta: { id: 'act_30000', nombre: null, monedaHora: '' } })
    const dos = P.cruzarKickoffs([it('Uno', [cuenta('act_30000')]), it('Dos', [cuenta('act_30000')])], [k], opTablero()).porLanzar
    assert.equal(dos.filter(x => x.kickoff).length, 1)
    const otro = dos.find(x => !x.kickoff)
    assert.deepEqual([otro.cuentas, otro.acceso], [[], 'no'])
  })
  test('la cuenta de AJUSTES_CUENTA no se le saca a nadie', () => {
    const k = kick(32, { cuenta: { id: 'act_1000000000000001', nombre: null, monedaHora: '' } })
    const r2 = P.cruzarKickoffs([it('Clienta Prueba Inventada'), it('Otro A Mano', [cuenta('act_1000000000000001', 'x', 'manual')])], [k], opTablero()).porLanzar
    assert.deepEqual(r2.find(x => x.cliente === 'Otro A Mano').cuentas.map(c => c.por), ['manual'])
  })
  test('con dos fichas del mismo nombre gana la más nueva', () => {
    const dos = P.cruzarKickoffs([it('Clienta Prueba Inventada')], [kick(21, { fechaIso: '2026-10-01T00:00:00Z' }), kick(22, { fechaIso: '2026-10-20T00:00:00Z' })], opTablero()).porLanzar
    assert.equal(dos[0].kickoff.recordingId, 22)
  })
  test('cuenta de la ficha fuera del tablero (cerrada) o sin el listado de Meta', () => {
    const k = kick(41, { cuenta: { id: 'act_10100', nombre: null, monedaHora: '' } })
    const c = P.cruzarKickoffs([it('Clienta Prueba Inventada')], [k], opTablero()).porLanzar[0]
    assert.deepEqual([c.cuentaFicha, c.acceso, c.grupo], [{ estado: 'excluida', motivo: 'cuenta cerrada en Meta' }, 'no', 'revisar'])
    const s = P.cruzarKickoffs([it('Clienta Prueba Inventada')], [kick(42, { cuenta: { id: 'act_40400', nombre: null, monedaHora: '' } })], opTablero({ descubrimientoOk: false })).porLanzar[0]
    assert.deepEqual([s.cuentaFicha.estado, s.acceso, s.grupo], ['sin_dato', 'no', 'sin_acceso'])
  })
})

describe('cruzarKickoffs: el falso positivo de un apellido compartido (heurística real de cuentas)', () => {
  const fichaFR = kick(51, { clienteCRM: 'Estudio Fernández Ruiz', idCrm: null, link: null, cuenta: { id: 'act_70000', nombre: 'USD FERNANDEZ RUIZ', monedaHora: '' } })
  test('«Laura Fernández» se queda con «USD FERNANDEZ RUIZ» solo por un apellido (débil)', () => {
    assert.deepEqual(P.cuentasDelCliente('Laura Fernández', VISIBLES, { tokFilas: new Set() }).map(c => [c.id, c.por]), [['act_70000', 'apellido']])
  })
  test('la ficha de «Estudio Fernández Ruiz» no se le pega a Laura: queda suelta (no está en el CRM) y la cuenta se le saca', () => {
    const cuentas = P.cuentasDelCliente('Laura Fernández', VISIBLES, { tokFilas: new Set() })
    const { porLanzar, sueltas } = P.cruzarKickoffs([it('Laura Fernández', cuentas)], [fichaFR], opTablero())
    assert.deepEqual([porLanzar[0].kickoff, porLanzar[0].cuentas, porLanzar[0].acceso, porLanzar[0].grupo], [null, [], 'no', 'sin_ficha_sin_acceso'])
    assert.deepEqual(sueltas.map(x => [x.recordingId, x.cliente, x.verificado]), [[51, 'Estudio Fernández Ruiz', true]])
    const [aviso] = P.avisosFichasSueltas(sueltas, AHORA)
    assert.match(aviso, /^1 ficha de kickoff de clientes que no están en el CRM de Agencia ni gastan en el tablero: «Estudio Fernández Ruiz» \(kickoff vie 23\/10 09:00\)/)
  })
  test('con dos palabras en común sí cruza por la cuenta, pero a confirmar (está a nombre de otro)', () => {
    const cuentas = P.cuentasDelCliente('Laura Fernández Ruiz', VISIBLES, { tokFilas: new Set() })
    assert.deepEqual(cuentas.map(c => c.por), ['nombre'])
    const r = P.cruzarKickoffs([it('Laura Fernández Ruiz', cuentas)], [fichaFR], opTablero()).porLanzar[0]
    assert.equal(r.kickoff.recordingId, 51)
    assert.match(r.confirmar, /^Ficha guardada a nombre de «Estudio Fernández Ruiz», cruzada por la cuenta act_70000: confirmar/)
    assert.deepEqual([r.acceso, r.grupo], ['si', 'revisar'])
  })
  test('las palabras de clientes con fila no sirven para cruzar a otro', () => {
    assert.deepEqual(P.cuentasDelCliente('Laura Fernández', VISIBLES, { tokFilas: new Set(['fernandez']) }), [])
    assert.deepEqual(P.cuentasDelCliente('Laura Fernández', VISIBLES, { manual: 'act_80000', tokFilas: new Set(['fernandez']) }).map(c => c.por), ['manual'])
  })
})

describe('opcionesCruceTablero: el cruce por nombre del tablero (normTxt + buscarCliente de cruce.ts)', () => {
  const op = opTablero()
  test('acentos, mayúsculas y un nombre con agregados (buscarCliente)', () => {
    assert.equal(op.mismoCliente('EPSILON FICHA SIN ACCESO', 'Épsilon Ficha Sin Acceso'), true)
    assert.equal(op.mismoCliente('Jose Maria Gallardo Perez (Estudio)', 'José María Gallardo Pérez'), true)
    assert.equal(op.mismoCliente('Estudio Fernández Ruiz', 'Laura Fernández'), false)
  })
  test('una ficha sin cliente del CRM: queda suelta con el nombre escuchado', () => {
    const k = kick(61, { clienteCRM: null, idCrm: null, link: null, clienteOido: 'Pru', cuenta: null })
    const { porLanzar, sueltas } = P.cruzarKickoffs([it('Zeta Sin Ficha')], [k], op)
    assert.equal(porLanzar[0].kickoff, null)
    assert.deepEqual(sueltas.map(x => [x.cliente, x.verificado]), [['Pru', false]])
    assert.match(P.avisosFichasSueltas(sueltas, AHORA)[0], /^1 ficha de kickoff sin cliente del CRM .*«Pru»/)
  })
  test('las sueltas viejas (más de DIAS_FICHA_SUELTA días) no son aviso', () => {
    const vieja = { recordingId: 1, cliente: 'X', verificado: true, fecha: null, fechaIso: '2026-07-01T00:00:00Z' }
    assert.deepEqual(P.avisosFichasSueltas([vieja], AHORA), [])
  })
})

describe('resumirKickoffs: claves del cliente y fichas que no se pueden leer', () => {
  const conFicha = (id, fecha, cambiar) => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.recording_id = id
    ficha.fecha = fecha
    cambiar?.(ficha)
    return fila({ ficha, recording_id: id, id_crm: ficha.cliente.id_crm ?? null, cliente_crm: ficha.cliente.cliente_crm ?? null })
  }
  test('una ficha con id y otra sin id del mismo cliente son una sola (gana la más nueva)', () => {
    const filas = [conFicha(1, '2026-10-10T12:00:00Z'), conFicha(2, '2026-10-20T12:00:00Z', f => { f.cliente.id_crm = null })]
    assert.deepEqual(P.resumirKickoffs(filas, { base: BASE, ahoraMs: AHORA }).map(k => k.recordingId), [2])
  })
  test('la más nueva no se puede leer (otra versión): no tapa a la anterior', () => {
    const filas = [conFicha(1, '2026-10-10T12:00:00Z'), conFicha(2, '2026-10-20T12:00:00Z', f => { f.version = 2 })]
    assert.deepEqual(P.ultimasPorCliente(filas).map(f => f.recording_id), [1])
    assert.deepEqual(P.resumirKickoffs(filas, { base: BASE, ahoraMs: AHORA }).map(k => k.recordingId), [1])
  })
  test('sin cliente del CRM también da tarjeta, con el nombre escuchado (y sin link)', () => {
    const filas = [conFicha(3, '2026-10-20T12:00:00Z', f => { f.cliente.cliente_crm = null; f.cliente.id_crm = null })]
    const [k] = P.resumirKickoffs(filas, { base: BASE, ahoraMs: AHORA })
    assert.deepEqual([k.clienteCRM, k.clienteOido, k.link], [null, 'CLIENTA PRUEBA', null])
  })
})

describe('resumirKickoff: discrepancias del portfolio y el aviso de Meta', () => {
  test('Meta dice ok y la llamada "falta": sale en "ojo" (no frena) y no se pierde', () => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.portfolio_final.tarjeta.llamada = { estado: 'falta', detalle: 'no la cargó', cita: 'no la cargué', timestamp: '00:18:59', textual: true }
    ficha.portfolio_final.tarjeta.discrepancia = 'en la llamada se dijo que falta'
    const k = resumir({ ficha })
    assert.deepEqual(k.ojos, ['Tarjeta: Meta dice «ok», en la llamada se dijo «falta» (no la cargó)'])
    assert.ok(!k.frenos.some(f => f.item === 'tarjeta'))
    assert.ok(!k.otrosFaltantes.some(x => /ojo/.test(x)))
  })
  test('Meta no pudo leer la cuenta: el aviso va con la cuenta y no se repite en "también falta"', () => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.portfolio_meta = { ...ficha.portfolio_meta, leido: false, motivo: 'sin_permiso', aviso: 'pedir acceso al portfolio del cliente' }
    const vista = V.armarVista(fila({ ficha }), AHORA)
    assert.ok(vista.faltantes.some(x => /^Portfolio en Meta/.test(x.texto)), 'la vista lo trae')
    const k = resumir({ ficha })
    assert.match(k.cuentaAviso, /pedir acceso al portfolio del cliente/)
    assert.ok(!k.otrosFaltantes.some(x => /^Portfolio en Meta/.test(x)), k.otrosFaltantes.join(' | '))
  })
  test('con Meta leída, su aviso sí queda en "también falta" (no hay cuentaAviso)', () => {
    const ficha = clonar(FICHA_PRUEBA)
    ficha.portfolio_meta.aviso = 'revisar el método de pago'
    const k = resumir({ ficha })
    assert.equal(k.cuentaAviso, null)
    assert.ok(k.otrosFaltantes.some(x => /^Portfolio en Meta \(act_1000000000000001\): revisar el método de pago/.test(x)))
  })
})

describe('kickoffs.ts: lectura sin base, link, tope y motivos', () => {
  test('sin DATABASE_URL: null ("no se sabe"), sin tocar la red', async () => {
    assert.equal(await K.leerFichasKickoff(), null)
  })
  test('DESPACHO_URL solo si es https; si no, el dominio del Despacho', () => {
    assert.equal(K.baseDespacho({ DESPACHO_URL: 'https://otro.ejemplo.test/' }), 'https://otro.ejemplo.test')
    assert.equal(K.baseDespacho({ DESPACHO_URL: 'http://inseguro.ejemplo.test' }), K.URL_DESPACHO)
    assert.equal(K.baseDespacho({}), 'https://despacho-capital-juridico.vercel.app')
    assert.equal(P.linkFicha('https://x.test/', 'a157'), 'https://x.test/clientes/A157/kickoff')
    assert.equal(P.linkFicha('https://x.test', '../A157'), null)
  })
  test('conTope: corta a tiempo y deja pasar lo rápido', async () => {
    await assert.rejects(K.conTope(new Promise(r => setTimeout(r, 200)), 20, 'fichas de kickoff'), /fichas de kickoff: tardó más de/)
    assert.equal(await K.conTope(Promise.resolve(7), 50, 'x'), 7)
  })
  test('pausa tras una falla: no vuelve a la base ni espera hasta que pasa la pausa; un tope vencido no pausa', async () => {
    let reloj = 0, llamadas = 0, falla = true
    const leer = K.crearLecturaConPausa(async () => { llamadas++; if (falla) throw new Error('la base del Despacho no respondió: x'); return 'ok' },
      { esperaMs: 50, pausaMs: 60_000, que: K.QUE_KICKOFFS, ahora: () => reloj })
    await assert.rejects(leer(), /no respondió/)
    reloj = 59_000
    await assert.rejects(leer(), /no respondió/)
    assert.equal(llamadas, 1, 'durante la pausa no se consulta')
    reloj = 61_000; falla = false
    assert.equal(await leer(), 'ok')
    assert.equal(llamadas, 2)
    let lentas = 0
    const lenta = K.crearLecturaConPausa(() => { lentas++; return new Promise(r => setTimeout(() => r('tarde'), 120)) }, { esperaMs: 20, pausaMs: 60_000, que: K.QUE_KICKOFFS })
    await assert.rejects(lenta(), /fichas de kickoff: tardó más de/)
    await assert.rejects(lenta(), /fichas de kickoff: tardó más de/)
    assert.equal(lentas, 2, 'el tope no pausa: la lectura sigue y se vuelve a pedir')
  })
  test('el aviso de la lectura: tope vencido, falla (sin URLs), dato viejo y bien', async () => {
    const tope = await K.conTope(new Promise(r => setTimeout(r, 100)), 10, K.QUE_KICKOFFS).then(() => '', e => e.message)
    assert.match(K.avisoLecturaFichas({ ok: false, error: tope }, () => ''), /^Las fichas de kickoff tardaron en llegar de la base del Despacho: «Por lanzar» sale sin la ficha por ahora/)
    const falla = K.avisoLecturaFichas({ ok: false, error: 'la base del Despacho no respondió: fetch failed postgresql://u:clave@host.test/db' }, () => '')
    assert.match(falla, /^No se pudieron leer las fichas de kickoff \(la base del Despacho no respondió: fetch failed \[url\]\)/)
    assert.equal(K.avisoLecturaFichas({ ok: true, v: { viejo: true, at: 0 } }, () => 'hace 5 min'), 'La base del Despacho no respondió: fichas de kickoff de hace 5 min.')
    assert.equal(K.avisoLecturaFichas({ ok: true, v: { at: 0 } }, () => ''), null)
  })
  test('el motivo de un error sale sin URLs (la de la base puede traer el host y la clave)', () => {
    const m = K.motivoCorto(new Error('Error connecting to database: postgresql://usuario:clave@host.ejemplo.test/neondb?sslmode=require'))
    assert.doesNotMatch(m, /postgresql:|clave@|host\.ejemplo/)
    assert.match(m, /\[url\]/)
  })
  test('aFila: fechas a ISO y sin la columna ideas', () => {
    const f = K.aFila({ recording_id: '5', estado: 'lista', creado: new Date('2026-10-24T00:00:00Z'), actualizado: '2026-10-24T01:00:00Z', ideas: { x: 1 } })
    assert.equal(f.recording_id, 5)
    assert.equal(f.creado, '2026-10-24T00:00:00.000Z')
    assert.equal(f.ideas, null)
  })
})

// La salida real de la prueba del 24/10 (no se versiona). No se imprime nada de su contenido.
const REAL = new URL('../.cache/kickoff-prueba/salida-195704214.json', import.meta.url)
describe('la ficha real de la prueba del 24/10 (si está en .cache)', { skip: !existsSync(REAL) && 'no está la salida real (no se versiona)' }, () => {
  test('sale la tarjeta completa, sin mails ni datos de los ganadores', () => {
    const real = JSON.parse(readFileSync(REAL, 'utf8'))
    const k = P.resumirKickoff(fila({ ficha: real.ficha, recording_id: real.ficha.recording_id }), { base: BASE, ahoraMs: AHORA })
    assert.ok(k, 'la ficha real tiene que dar una tarjeta')
    assert.match(k.link ?? '', /^https:\/\/despacho-capital-juridico\.vercel\.app\/clientes\/[A-Z]\d+\/kickoff$/)
    assert.equal(k.rama.nombre, 'Laboral (despidos)')
    assert.match(k.cuenta?.id ?? '', /^act_\d+$/)
    assert.equal(k.cuenta.monedaHora, 'factura en USD · hora de Argentina')
    assert.match(k.presupuesto.texto, /^USD 8 por día/)
    assert.ok(k.zona.lugares.length >= 2 && k.zona.presentarse, 'lugares y "presentarse como"')
    assert.equal(k.zona.mapa?.estado, 'pendiente', 'la salida guardada no trae la lectura del video')
    assert.ok(k.frenos.every(f => !f.frena), 'accesos y tarjeta ok según Meta')
    assert.ok(k.avatar.incluye.length && k.avatar.excluye.length)
    const t = JSON.stringify(k)
    assert.doesNotMatch(t, /@/, 'ningún mail')
    for (const g of real.ficha.ganadores?.lista ?? []) {
      if (g.cliente) assert.ok(!t.includes(g.cliente), 'el nombre de otro cliente (ganadores)')
      if (g.cuentaId) assert.ok(!t.includes(g.cuentaId), 'la cuenta de otro cliente (ganadores)')
    }
  })
})
