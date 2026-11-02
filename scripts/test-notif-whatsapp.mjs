// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-notif-whatsapp.mjs
// Salida única de WhatsApp de la bandeja central (lib/notificaciones/whatsapp/*): apagado por defecto, prueba solo a
// Tomás, mapeo tipo → grupo, tipos excluidos (no duplicar), regla de Tomás (se verifica antes de mandar), un mensaje por
// corrida, /health, turno, dedupe y estados. SIN red ni base: fetch bloqueado y todo por fakes.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
for (const k of Object.keys(process.env)) if (/^(NOTIF_|WHAPI_|BOT_|DISCORD_)/.test(k) || ['DATABASE_URL', 'CRON_SECRET'].includes(k)) delete process.env[k]
const M = await import('../lib/notificaciones/whatsapp/modelo.ts')
const D = await import('../lib/notificaciones/whatsapp/despacho.ts')

const TEL_TOMAS = '5490000000001', TEL_AYLU = '5490000000002', TEL_RENE = '5490000000003', TEL_VALEN = '5490000000004'
const ENV = {
  NOTIF_WHATSAPP: 'real',
  NOTIF_WHATSAPP_PRUEBA_CHAT: '+54 9 0000-000001',
  WHAPI_GRUPO_EDICION: '120363000000000001@g.us', WHAPI_GRUPO_ADS: '120363000000000002@g.us', WHAPI_GRUPO_OPERACIONES: '120363000000000003@g.us',
  WHAPI_GRUPO_COPYWRITING: '120363000000000004@g.us', WHAPI_GRUPO_CSM: '120363000000000005@g.us',
  EDICION_REVISOR_AYLU: 'aylu@ej.com', EDICION_REVISOR_TOMAS: 'tomas@ej.com', EDICION_EDITOR_RENE: 'rene@ej.com', KICKOFF_REVISOR_GERO_M: 'gero@ej.com',
  NOTIF_PERSONAS_JSON: JSON.stringify({ 'aylu@ej.com': { nombre: 'Aylu', tel: TEL_AYLU }, tomas: { nombre: 'Tomás', tel: TEL_TOMAS }, 'rene@ej.com': { nombre: 'René', tel: TEL_RENE } }),
  ANUNCIOS_WHATSAPP_TEL_VALENTINO: TEL_VALEN,
}
// 1/11/2026 15:00 en Argentina (UTC-3) = 18:00 UTC
const AHORA = Date.parse('2026-11-01T18:00:00Z')
const hace = (min) => new Date(AHORA - min * 60_000).toISOString()

describe('modelo', () => {
  test('interruptor: sin variable = apagado; solo prueba o real', () => {
    assert.equal(M.modoNotifWa({}), 'apagado')
    assert.equal(M.modoNotifWa({ NOTIF_WHATSAPP: 'si' }), 'apagado')
    assert.equal(M.modoNotifWa({ NOTIF_WHATSAPP: ' Prueba ' }), 'prueba')
    assert.equal(M.modoNotifWa({ NOTIF_WHATSAPP: 'real' }), 'real')
    assert.equal(M.maxPorDia({}), M.MAX_DIA_POR_DEFECTO); assert.equal(M.maxPorDia({ NOTIF_WHATSAPP_MAX_DIA: '3' }), 3); assert.equal(M.maxPorDia({ NOTIF_WHATSAPP_MAX_DIA: '999' }), M.MAX_DIA_POR_DEFECTO)
  })
  test('lista blanca: prueba = solo el chat de Tomás; real = solo los WHAPI_GRUPO_* con forma de grupo', () => {
    assert.equal(M.chatPrueba(ENV), '5490000000001@s.whatsapp.net')
    assert.deepEqual([...M.chatsPermitidos('prueba', ENV)], ['5490000000001@s.whatsapp.net'])
    assert.equal(M.chatsPermitidos('real', ENV).size, 5)
    assert.equal(M.chatsPermitidos('apagado', ENV).size, 0)
    assert.equal(M.chatGrupo('CSM', { WHAPI_GRUPO_CSM: '5491100000000@s.whatsapp.net' }), null, 'un chat directo no es un grupo del equipo')
    assert.equal(M.chatPrueba({ NOTIF_WHATSAPP_PRUEBA_CHAT: 'algo@g.us' }), null)
  })
  test('tipos excluidos: lo que ya sale por WhatsApp no se duplica', () => {
    for (const tipo of ['guiones_a_revisar', 'guiones_con_notas', 'altas_esperando_humano', 'altas_revisar', 'exito_abierto', 'bajas_abierto', 'exito_error', 'exito_dudoso', 'bajas_error', 'bajas_dudoso'])
      assert.equal(M.mapear({ tipo, paraEmail: null, paraSeccion: null }).ok, false, tipo)
    assert.deepEqual(M.mapear({ tipo: 'algo_nuevo', paraEmail: null, paraSeccion: null }), { ok: false, motivo: 'tipo sin grupo de WhatsApp' })
  })
  test('clave de reconciliación: se lee desde el final (ids con «:»); lo ilegible no sale', () => {
    assert.deepEqual(M.parsearRecon('recon:edicion:12:editado:2026-11-01T12:00:00.000Z'), { fuente: 'edicion', id: '12', estado: 'editado' })
    assert.deepEqual(M.parsearRecon('recon:anuncios:optimizada:123:2026-11-01:dudoso:2026-11-01T12:00:00.000Z'), { fuente: 'anuncios', id: 'optimizada:123:2026-11-01', estado: 'dudoso' })
    assert.deepEqual(M.parsearRecon('recon:guiones:5:error:actual'), { fuente: 'guiones', id: '5', estado: 'error' })
    assert.equal(M.parsearRecon('recon:anuncios:raro'), null)
    assert.equal(M.parsearRecon(null), null)
  })
  test('cliente sin respuesta: si respondió o el equipo volvió a escribir, no sale', () => {
    const clave = 'inactivos:A1:2026-10-28T12:00:00.000Z:1'
    assert.deepEqual(M.sinRespuestaVigente(clave, { ultimoCliente: '2026-10-20T00:00:00.000Z', ultimoEquipo: '2026-10-28T12:00:00.000Z' }), { ok: true })
    assert.equal(M.sinRespuestaVigente(clave, { ultimoCliente: '2026-10-30T00:00:00.000Z', ultimoEquipo: '2026-10-28T12:00:00.000Z' }).motivo, 'el cliente ya respondió')
    assert.equal(M.sinRespuestaVigente(clave, { ultimoCliente: null, ultimoEquipo: '2026-10-31T12:00:00.000Z' }).ok, false)
    assert.equal(M.sinRespuestaVigente(clave, null).ok, false)
    assert.equal(M.sinRespuestaVigente('otra', { ultimoCliente: null, ultimoEquipo: '2026-10-28T12:00:00.000Z' }).ok, false)
  })
  test('mapeo tipo → grupo y menciones', () => {
    const g = (tipo, paraEmail = null, paraSeccion = null) => { const m = M.mapear({ tipo, paraEmail, paraSeccion }); return m.ok ? [m.destino.grupo, m.destino.roles, m.destino.persona] : null }
    assert.deepEqual(g('edicion_tarjetas', 'rene@ej.com'), ['EDICION', [], 'rene@ej.com'])
    assert.deepEqual(g('edicion_tarjetas', null, 'anuncios'), ['ADS', ['valen'], null])
    assert.deepEqual(g('edicion_bloqueado', null, 'edicion'), ['EDICION', ['tomas', 'aylu'], null])
    assert.deepEqual(g('guiones_entrega', 'gero@ej.com'), ['OPERACIONES', [], 'gero@ej.com'])
    assert.deepEqual(g('guiones_error', null, 'guiones'), ['COPYWRITING', ['tomas', 'faus'], null])
    assert.deepEqual(g('kickoff_error', null, 'clientes'), ['OPERACIONES', ['tomas'], null])
    assert.deepEqual(g('cliente_sin_respuesta', null, 'clientes'), ['CSM', [], null])
    assert.equal(g('bajas_dudoso', null, 'clientes'), null, 'ya avisa en Verificaciones')
    assert.deepEqual(g('anuncios_dudoso', null, 'anuncios'), ['ADS', ['valen'], null])
  })
  test('personas: por mail, por rol y de respaldo; sin teléfono va el nombre', () => {
    assert.deepEqual(M.personaPorEmail('AYLU@ej.com', ENV), { nombre: 'Aylu', tel: TEL_AYLU })
    assert.deepEqual(M.personaPorRol('tomas', ENV), { nombre: 'Tomás', tel: TEL_TOMAS })
    assert.deepEqual(M.personaPorRol('valen', ENV), { nombre: 'Valen', tel: TEL_VALEN })
    assert.deepEqual(M.personaPorEmail('gero@ej.com', ENV), { nombre: 'Gero M', tel: null })
    assert.deepEqual(M.personaPorEmail('gero@ej.com', { ...ENV, BOT_ALTA_EQUIPO_TELEFONOS: '{"Gero M":"549 000 000 0005"}' }), { nombre: 'Gero M', tel: '5490000000005' })
    assert.deepEqual(M.personaPorEmail('otro@ej.com', {}), { nombre: 'otro', tel: null })
    assert.deepEqual(M.personasDesdeEntorno({ NOTIF_PERSONAS_JSON: 'roto' }), {})
  })
  test('horario hábil de Argentina: 9 a 20', () => {
    assert.equal(M.enHorario(Date.parse('2026-11-01T12:00:00Z')), true)   // 9:00 AR
    assert.equal(M.enHorario(Date.parse('2026-11-01T11:59:00Z')), false)  // 8:59 AR
    assert.equal(M.enHorario(Date.parse('2026-11-01T23:00:00Z')), false)  // 20:00 AR
  })
  test('mensaje: uno por grupo, repetidos juntos, menciones con @número, más de 5 = cuenta y link', () => {
    const aylu = { nombre: 'Aylu', tel: TEL_AYLU }, gero = { nombre: 'Gero M', tel: null }
    const { texto, menciones } = M.armarMensaje({ modo: 'real', grupo: 'OPERACIONES', base: 'https://d', items: [
      { titulo: 'Guiones listos para entregar · Estudio Uno', url: '/clientes/entregas?cliente=A1', personas: [aylu] },
      { titulo: 'Guiones listos para entregar · Estudio Uno', url: '/clientes/entregas?cliente=A1', personas: [gero] },
    ] })
    assert.deepEqual(menciones, [TEL_AYLU])
    assert.match(texto, /^🔔 \*1 aviso para Operaciones\* · @5490000000002 Gero M\n• Guiones listos para entregar · Estudio Uno\n  https:\/\/d\/clientes\/entregas\?cliente=A1$/)
    const muchos = M.armarMensaje({ modo: 'real', grupo: 'CSM', base: 'https://d', items: Array.from({ length: 6 }, (_, i) => ({ titulo: `Respuesta pendiente · C${i}`, url: `/c/${i}`, personas: [] })) })
    assert.match(muchos.texto, /6 avisos para CSM\*\nEstán en la campanita del Despacho: https:\/\/d$/)
    assert.doesNotMatch(muchos.texto, /C0/)
    const p = M.armarMensaje({ modo: 'prueba', grupo: 'EDICION', base: 'https://d', items: [{ titulo: 'Edición: *para* editar', url: null, personas: [aylu] }] })
    assert.deepEqual(p.menciones, [], 'en prueba no se menciona a nadie')
    assert.match(p.texto, /^🧪 PRUEBA → iría a Edición mencionando Aylu\n🔔 \*1 aviso para Edición\* · Aylu\n• Edición: para editar\n  https:\/\/d$/)
    assert.doesNotMatch(p.texto, /5490000000002/)
  })
})

// ── Despachador con fakes ────────────────────────────────────────────────────────────────────────────────────────────
function crearFakes(op = {}) {
  const env = op.env ?? ENV
  const cola = []                        // filas de cj_notif_whatsapp
  const notifs = op.notifs ?? []         // cj_notificaciones
  const log = { enviados: [], turnos: 0, reconciliado: 0, salud: 0 }
  let turnoLibre = op.turno ?? true
  const deps = {
    env, ahora: () => op.ahora ?? AHORA, base: 'https://despacho.test',
    async reconciliar() { log.reconciliado++ },
    async candidatas(desde) { return notifs.filter(n => n.creadaEn >= desde && !n.hechaEn && !cola.some(c => c.notificacionId === n.id)).map(({ id, clave, tipo, paraEmail, paraSeccion }) => ({ id, clave, tipo, paraEmail, paraSeccion })) },
    async insertar(filas) { for (const f of filas) if (!cola.some(c => c.clave === f.clave)) cola.push({ ...f, id: cola.length + 1 }) },
    async vencerEnviando() { let n = 0; for (const c of cola) if (c.estado === 'enviando' && c.viejo) { c.estado = 'dudoso'; n++ } return n },
    async pendientes() {
      return cola.filter(c => c.estado === 'pendiente').map(c => { const n = notifs.find(x => x.id === c.notificacionId); return { id: c.id, notificacionId: n.id, tipo: c.tipo, grupo: c.grupo, destino: c.destino, creadaEn: n.creadaEn, hechaEn: n.hechaEn ?? null, titulo: n.titulo, url: n.url ?? null, clave: n.clave } })
    },
    async vigencia(f) { return op.vigencia ? op.vigencia(f) : { ok: true } },
    async omitir(id, motivo) { const c = cola.find(x => x.id === id); if (c.estado === 'pendiente') Object.assign(c, { estado: 'omitido', motivo }) },
    async salud() { log.salud++; return op.salud ?? { ok: true, motivo: 'conectado' } },
    async reclamarTurno() { log.turnos++; const t = turnoLibre; if (op.unTurno) turnoLibre = false; return t },
    async reclamar(ids, lote, modo) { const r = []; for (const c of cola) if (ids.includes(c.id) && c.estado === 'pendiente') { Object.assign(c, { estado: 'enviando', lote, modo }); r.push(c.id) } return r },
    async enviar(chat, texto, menciones) { if (op.falla) throw op.falla; log.enviados.push({ chat, texto, menciones }); return `msg-${log.enviados.length}` },
    async cerrar(ids, estado, motivo, mensajeId) { for (const c of cola) if (ids.includes(c.id) && c.estado === 'enviando') Object.assign(c, { estado, motivo, mensajeId }) },
  }
  return { deps, cola, log, notifs }
}
const notif = (id, tipo, extra = {}) => ({ id, clave: `k${id}`, tipo, paraEmail: null, paraSeccion: null, titulo: `Aviso ${id}`, url: `/x/${id}`, creadaEn: hace(30), ...extra })

describe('despachador', () => {
  test('apagado (sin variable): no toca nada, ni reconcilia ni encola', async () => {
    const f = crearFakes({ env: { ...ENV, NOTIF_WHATSAPP: undefined }, notifs: [notif(1, 'cliente_sin_respuesta')] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'apagado'); assert.equal(f.log.reconciliado, 0); assert.equal(f.cola.length, 0); assert.equal(f.log.enviados.length, 0)
  })
  test('real: encola, excluye lo que ya sale por WhatsApp y manda UN mensaje al grupo que más espera, con menciones', async () => {
    const f = crearFakes({ notifs: [
      notif(1, 'edicion_tarjetas', { paraEmail: 'aylu@ej.com', titulo: 'Edición: videos listos para revisar', creadaEn: hace(40) }),
      notif(2, 'guiones_a_revisar', { paraEmail: 'tomas@ej.com' }),
      notif(3, 'cliente_sin_respuesta', { paraSeccion: 'clientes', creadaEn: hace(20) }),
    ] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'enviado'); assert.equal(r.grupo, 'EDICION'); assert.equal(r.encolados, 2)
    assert.equal(f.log.reconciliado, 1)
    assert.equal(f.log.enviados.length, 1)
    assert.equal(f.log.enviados[0].chat, ENV.WHAPI_GRUPO_EDICION)
    assert.deepEqual(f.log.enviados[0].menciones, [TEL_AYLU])
    assert.match(f.log.enviados[0].texto, /@5490000000002/)
    assert.deepEqual(f.cola.map(c => [c.notificacionId, c.estado]), [[1, 'enviado'], [2, 'omitido'], [3, 'pendiente']])
    assert.equal(f.cola[1].motivo, 'ya sale por WhatsApp desde su bot')
    assert.equal(f.cola[0].mensajeId, 'msg-1')
  })
  test('dedupe: una segunda corrida no repite lo enviado; lo que queda sale en otra corrida con otro turno', async () => {
    const f = crearFakes({ notifs: [notif(1, 'kickoff_error', { creadaEn: hace(40) }), notif(2, 'cliente_sin_respuesta', { creadaEn: hace(20) })] })
    await D.despacharNotifWhatsapp(f.deps)
    const r2 = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r2.grupo, 'CSM')
    const r3 = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r3.estado, 'nada')
    assert.equal(f.log.enviados.length, 2)
    assert.equal(f.cola.length, 2)
  })
  test('prueba: todo va SOLO al chat de Tomás, con el prefijo y sin menciones', async () => {
    const f = crearFakes({ env: { ...ENV, NOTIF_WHATSAPP: 'prueba' }, notifs: [notif(1, 'edicion_bloqueado', { paraSeccion: 'edicion' })] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(f.log.enviados[0].chat, '5490000000001@s.whatsapp.net')
    assert.deepEqual(f.log.enviados[0].menciones, [])
    assert.match(f.log.enviados[0].texto, /^🧪 PRUEBA → iría a Edición mencionando Tomás, Aylu/)
    assert.equal(f.cola[0].modo, 'prueba')
  })
  test('prueba sin chat de Tomás: no sale nada', async () => {
    const f = crearFakes({ env: { ...ENV, NOTIF_WHATSAPP: 'prueba', NOTIF_WHATSAPP_PRUEBA_CHAT: '' }, notifs: [notif(1, 'kickoff_error')] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'sin_destino'); assert.equal(f.log.enviados.length, 0); assert.equal(f.log.turnos, 0)
  })
  test('real sin el WHAPI_GRUPO del área: no sale (nunca a otro chat)', async () => {
    const f = crearFakes({ env: { ...ENV, WHAPI_GRUPO_CSM: '' }, notifs: [notif(1, 'cliente_sin_respuesta')] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'sin_destino'); assert.equal(r.motivo, 'falta WHAPI_GRUPO_CSM'); assert.equal(f.cola[0].estado, 'pendiente')
  })
  test('/health no está AUTH: no pide turno, no manda y queda pendiente', async () => {
    const f = crearFakes({ salud: { ok: false, motivo: 'número del bot desconectado o suspendido' }, notifs: [notif(1, 'kickoff_error')] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'sin_numero'); assert.equal(f.log.turnos, 0); assert.equal(f.log.enviados.length, 0); assert.equal(f.cola[0].estado, 'pendiente')
  })
  test('sin turno (5 min entre mensajes o tope del día): no manda y queda pendiente', async () => {
    const f = crearFakes({ turno: false, notifs: [notif(1, 'kickoff_error')] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'sin_turno'); assert.equal(f.log.enviados.length, 0); assert.equal(f.cola[0].estado, 'pendiente')
  })
  test('fuera de horario: encola pero no manda', async () => {
    const f = crearFakes({ ahora: Date.parse('2026-11-02T02:00:00Z'), notifs: [notif(1, 'kickoff_error', { creadaEn: '2026-11-02T01:00:00.000Z' })] })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'fuera_de_horario'); assert.equal(f.cola[0].estado, 'pendiente'); assert.equal(f.log.salud, 0)
  })
  test('ventana de 10 min: lo recién llegado espera para juntarse', async () => {
    const f = crearFakes({ notifs: [notif(1, 'kickoff_error', { creadaEn: hace(3) })] })
    assert.equal((await D.despacharNotifWhatsapp(f.deps)).estado, 'esperando_ventana')
    assert.equal(f.log.enviados.length, 0)
  })
  test('regla de Tomás: hecha, vieja o con la etapa resuelta fuera del bot → omitido con el motivo; no sale', async () => {
    const f = crearFakes({
      notifs: [notif(1, 'kickoff_error'), notif(2, 'kickoff_error', { creadaEn: hace(60 * 47) }), notif(3, 'guiones_entrega', { paraEmail: 'aylu@ej.com' })],
      vigencia: (x) => x.tipo === 'guiones_entrega' ? { ok: false, motivo: 'el cliente ya grabó después de la aprobación' } : { ok: true },
    })
    await D.despacharNotifWhatsapp(f.deps)   // encola los 3 y manda el 1 y el 2 juntos
    // ahora el 1 se marca hecho en la bandeja después de encolarse
    const g = crearFakes({ notifs: [notif(1, 'kickoff_error')], vigencia: () => ({ ok: true }) })
    await g.deps.insertar(D.filasNuevas([{ id: 1, clave: 'k1', tipo: 'kickoff_error', paraEmail: null, paraSeccion: null }]))
    g.notifs[0].hechaEn = hace(1)
    const r = await D.despacharNotifWhatsapp(g.deps)
    assert.equal(r.estado, 'nada'); assert.equal(g.cola[0].estado, 'omitido'); assert.equal(g.cola[0].motivo, 'ya está hecha en el Despacho')
    assert.equal(f.cola.find(c => c.notificacionId === 3).estado, 'omitido')
    assert.equal(f.cola.find(c => c.notificacionId === 3).motivo, 'el cliente ya grabó después de la aprobación')
    assert.doesNotMatch(f.log.enviados.map(e => e.texto).join('\n'), /Aviso 3/)
    // más de 48 h: ni se encola
    const h = crearFakes({ notifs: [notif(1, 'kickoff_error', { creadaEn: hace(60 * 49) })] })
    assert.equal((await D.despacharNotifWhatsapp(h.deps)).encolados, 0)
  })
  test('si no se puede verificar (CRM caído) la corrida se corta sin mandar ni omitir', async () => {
    const f = crearFakes({ notifs: [notif(1, 'kickoff_error')], vigencia: () => { throw new Error('No se pudo leer el CRM') } })
    const r = await D.despacharNotifWhatsapp(f.deps)
    assert.equal(r.estado, 'error'); assert.equal(f.cola[0].estado, 'pendiente'); assert.equal(f.log.enviados.length, 0)
  })
  test('errores al mandar: número caído → pendiente; config → error sin reintento; sin saber → dudoso', async () => {
    const caido = crearFakes({ falla: Object.assign(new Error('Whapi: número caído'), { aplicado: false, tipo: 'sin_numero' }), notifs: [notif(1, 'kickoff_error')] })
    assert.equal((await D.despacharNotifWhatsapp(caido.deps)).estado, 'no_salio'); assert.equal(caido.cola[0].estado, 'pendiente')
    const config = crearFakes({ falla: Object.assign(new Error('Whapi: mención 5491122334455 rota'), { aplicado: false, tipo: 'config' }), notifs: [notif(1, 'kickoff_error')] })
    const rc = await D.despacharNotifWhatsapp(config.deps)
    assert.equal(config.cola[0].estado, 'error'); assert.doesNotMatch(rc.motivo, /5491122334455/, 'nunca un teléfono en el motivo')
    const dudoso = crearFakes({ falla: Object.assign(new Error('timeout'), { aplicado: null }), notifs: [notif(1, 'kickoff_error')] })
    assert.equal((await D.despacharNotifWhatsapp(dudoso.deps)).estado, 'dudoso'); assert.equal(dudoso.cola[0].estado, 'dudoso')
    // un dudoso no se reintenta solo
    assert.equal((await D.despacharNotifWhatsapp(dudoso.deps)).estado, 'nada')
  })
  test('clave de la cola: única por notificación y grupo', () => {
    assert.equal(D.claveWa({ id: 7, clave: 'recon:guiones:3:error:actual' }, 'COPYWRITING'), 'wa:recon:guiones:3:error:actual:COPYWRITING')
    assert.equal(D.claveWa({ id: 7, clave: null }, null), 'wa:id-7:ninguno')
  })
})

describe('servidor (sin red ni base)', async () => {
  const S = await import('../lib/notificaciones/whatsapp/servidor.ts')
  test('id del CRM desde la ruta del aviso', () => {
    assert.equal(S.idCrmDeUrl('/clientes?cliente=a12'), 'A12')
    assert.equal(S.idCrmDeUrl('/guiones/B7'), 'B7')
    assert.equal(S.idCrmDeUrl('/clientes/edicion?tarjeta=x'), null)
    assert.equal(S.idCrmDeUrl(null), null)
  })
  test('etapas en las que un aviso de Edición sigue siendo real', () => {
    assert.deepEqual(S.etapasVigentesEdicion('edicion_tarjetas', 'Edición: para editar o corregir'), ['para editar', 'editando'])
    assert.deepEqual(S.etapasVigentesEdicion('edicion_tarjetas', 'Edición: OK del cliente para Ads'), ['publicado'])
    assert.deepEqual(S.etapasVigentesEdicion('edicion_tarjetas', 'Edición: videos listos para revisar'), ['editado', 'corregido', 'revisión'])
    assert.deepEqual(S.etapasVigentesEdicion('edicion_entrega_revisar', 'x'), ['revisión'])
  })
  test('apagado: la entrada real no toca la base ni Whapi', async () => {
    assert.deepEqual(await S.despacharNotifWhatsappReal({}), { estado: 'apagado', modo: 'apagado', encolados: 0, omitidos: 0, vencidos: 0 })
  })
  test('estado sin base: solo variables sí/no, nunca valores', async () => {
    const e = await S.estadoNotifWhatsapp({ NOTIF_WHATSAPP: 'prueba', NOTIF_WHATSAPP_PRUEBA_CHAT: '5490000000001' })
    assert.equal(e.variables.NOTIF_WHATSAPP, 'prueba'); assert.equal(e.variables.NOTIF_WHATSAPP_PRUEBA_CHAT, true)
    assert.doesNotMatch(JSON.stringify(e), /5490000000001/)
  })
})
