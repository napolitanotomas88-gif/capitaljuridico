// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-avisos.mjs
// Avisos de Discord de Edición (lib/edicion/avisos/* y db/avisos.ts): menciones solo con id (sin id, el nombre en texto),
// agrupación y ventanas con un reloj de juguete, avisos de una vez, dudosos, modo dry y modo sombra, 2.000 caracteres sin
// perder el link, sin mails ni teléfonos, Valen sin webhook de #ads, el texto armado al despachar con lo de ese momento, y
// el SQL de la cola contra un Neon FALSO. SIN red (fetch bloqueado), SIN base real, SIN Discord. Todo es inventado.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

for (const k of Object.keys(process.env)) if (/^(DISCORD_|EDICION_)/.test(k) || ['DATABASE_URL', 'DESPACHO_URL'].includes(k)) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const C = await import('../lib/edicion/avisos/cola.ts')
const M = await import('../lib/edicion/avisos/mensajes.ts')
const E = await import('../lib/edicion/avisos/entorno.ts')
const A = await import('../lib/edicion/avisos/index.ts')
const DBA = await import('../lib/edicion/db/avisos.ts')
const base = await import('../lib/edicion/db/base.ts')
const { ErrorEnvio } = await import('../lib/fathomAnuncios/discord.ts')
const { ID_TOMAS } = await import('../lib/fathomAnuncios/procesar.ts')

const AYLU = '111111111111111111', RENE = '222222222222222222', TOMI = '333333333333333333', GERO = '444444444444444444', VALEN = '555555555555555555'
const WEBHOOK = 'https://discord.com/api/webhooks/1/secreto-edicion', WEBHOOK_ADS = 'https://discord.com/api/webhooks/2/secreto-ads'
const ENV_REAL = { EDICION_MODO: 'real', DISCORD_WEBHOOK_EDICION: WEBHOOK, DISCORD_WEBHOOK_KICKOFF_ADS: WEBHOOK_ADS,
  DISCORD_ID_AYLU: AYLU, DISCORD_ID_RENE: RENE, DISCORD_ID_TOMAS: TOMI, DISCORD_ID_GERO_M: GERO, DISCORD_ID_VALENTINO: VALEN }
const BASE = 'https://despacho-capital-juridico.vercel.app'
const T0 = Date.parse('2026-10-27T13:00:00.000Z')     // martes 10:00 de Argentina

const fila = (id, estado, over = {}) => ({ id, id_crm: 'A101', cliente: 'Ana Pérez', clave: `T1-V${id}`, estado, prioridad: 'normal', gancho: `Gancho ${id}`,
  bloqueo: null, editado: { url: `https://drive.google.com/file/d/ARCHIVO${id}xxxxxxxx/view` }, paleta: true, ...over })
const evento = (video_id, a, over = {}) => ({ id: video_id * 10, video_id, id_crm: 'A101', cliente: 'Ana Pérez', tipo: 'estado', de: null, a,
  actor: { tipo: 'persona', rol: 'aylu', nombre: 'Aylu', email: 'aylu@ejemplo.test' }, nota: '', datos: {}, cuando: new Date(T0).toISOString(), ...over })
const nota = (over = {}) => ({ ronda: 2, origen: 'aylu', enviada: true, segundo: 17, hasta: null, tipo: 'texto', texto: 'dice «mora», va «demora»', tilde: null, ...over })

/** Una cola en memoria con la misma semántica que db/avisos.ts (mezcla por base, una vez por clave, dudosos a los 10 min). */
function colaMemoria() {
  const filas = []
  let n = 0
  const union = (a = [], b = []) => [...new Map([...a, ...b].map(x => [JSON.stringify(x), x])).values()]
  return {
    filas,
    repo: {
      encolar: async a => {
        if (a.unaVez) {
          const ya = filas.find(f => f.clave === a.base)
          if (ya) return ya
        } else {
          const p = filas.find(f => f.base === a.base && f.estado === 'pendiente')
          if (p) {
            p.datos = { ...p.datos, ...a.datos, videos: union(p.datos.videos, a.datos.videos), archivos: union(p.datos.archivos, a.datos.archivos) }
            const tope = new Date(Date.parse(p.creado) + 2 * 3_600_000).toISOString()
            p.enviar_despues = a.enviar_despues < tope ? a.enviar_despues : tope
            return p
          }
        }
        const f = { id: ++n, clave: a.unaVez ? a.base : '', base: a.base, tipo: a.tipo, canal: a.canal, datos: a.datos, texto: null, menciones: [], estado: 'pendiente',
          enviar_despues: a.enviar_despues, mensaje_id: null, intentos: 0, error: '', creado: new Date(reloj.t).toISOString(), enviado: null }
        filas.push(f)
        return f
      },
      reclamarVencidos: async (ahora, limite) => filas.filter(f => f.estado === 'pendiente' && f.enviar_despues <= ahora).slice(0, limite)
        .map(f => { f.estado = 'enviando'; f.intentos++; f.enviado = ahora; return { ...f } }),
      cerrarAviso: async (id, r) => { const f = filas.find(x => x.id === id); if (f?.estado === 'enviando') Object.assign(f, r) },
      reprogramar: async (a, cuando, error) => { const f = filas.find(x => x.id === a.id); Object.assign(f, { estado: 'pendiente', enviar_despues: cuando, error }); return 'pendiente' },
      marcarDudosos: async ahora => filas.filter(f => f.estado === 'enviando' && Date.parse(f.enviado) < Date.parse(ahora) - 10 * 60_000).map(f => { f.estado = 'dudoso'; return f }),
    },
  }
}
const reloj = { t: T0 }
const ahora = () => new Date(reloj.t)
/** Un lector de juguete: los videos y las notas se cambian a mano entre encolar y despachar. */
function lectorJuguete(estado = {}) {
  const s = { filas: [], notas: new Map(), tanda: null, sugerencia: 'parece campaña nueva (sin campañas activas en los últimos 7 días)', ...estado }
  return {
    s,
    lector: {
      videosDeCliente: async id_crm => s.filas.filter(f => f.id_crm === id_crm),
      videosPorIds: async ids => s.filas.filter(f => ids.includes(f.id)),
      notasDe: async id => s.notas.get(id) ?? [],
      tanda: async id => (s.tanda?.id === id ? s.tanda : null),
      sugerenciaMeta: async () => s.sugerencia,
    },
  }
}
function discordFalso({ falla = null } = {}) {
  const envios = []
  let id = 900
  return { envios, enviar: async (webhook, mensajes, menciones, op) => { envios.push({ webhook, mensajes, menciones, op }); if (falla) throw falla; return mensajes.map(() => String(++id)) } }
}
const deps = (cola, lector, env, enviar) => ({ repo: cola.repo, lector, env, enviar, ahora, baseLista: () => true })
beforeEach(() => { reloj.t = T0 })

describe('menciones y datos personales', () => {
  test('con id: <@id> y el id va en la lista de menciones; sin id: "@Nombre" en texto, sin notificar', () => {
    const conIds = E.mencionesEdicion(ENV_REAL)
    const usados = []
    assert.equal(M.para('aylu', conIds, usados), `<@${AYLU}>`)
    assert.deepEqual(usados, [AYLU])
    const sinIds = E.mencionesEdicion({})
    const u2 = []
    assert.equal(M.para('aylu', sinIds, u2), '@Aylu')
    assert.equal(M.para('rene', sinIds, u2), '@René')
    assert.equal(M.para('valen', sinIds, u2), '@Valen')
    assert.deepEqual(u2, [], 'sin id no se notifica a nadie')
    assert.equal(sinIds.tomas, ID_TOMAS, 'Tomás: el de fathom-anuncios si falta DISCORD_ID_TOMAS')
    assert.equal(sinIds.gero_m, E.ID_GERO_M_POR_DEFECTO)
    assert.equal(E.mencionesEdicion({ DISCORD_ID_AYLU: 'no-es-un-id' }).aylu, null)
  })
  test('sinDatosPersonales saca mails y teléfonos de los DATOS; las fechas y los ids de Discord del armado quedan', () => {
    assert.equal(M.sinDatosPersonales('escribile a ana.perez@estudio.test'), 'escribile a (mail)')
    assert.equal(M.sinDatosPersonales('llamá al +54 9 11 5555-1234 ya'), 'llamá al (teléfono) ya')
    assert.equal(M.sinDatosPersonales('vence el 2026-10-27'), 'vence el 2026-10-27')
    assert.equal(M.sinDatosPersonales('seg 17 a 32'), 'seg 17 a 32')
    const r = M.textoParaEditar({ id_crm: 'A101', cliente: 'Ana 11 5555 1234 Pérez ana@x.test' }, { ...M.fotoVacia(), filas: [fila(1, 'para_editar')] }, E.mencionesEdicion(ENV_REAL), BASE)
    assert.ok(r.texto.startsWith(`<@${RENE}>`), 'la mención de 18 dígitos queda intacta')
    assert.ok(!/5555/.test(r.texto) && !/@x\.test/.test(r.texto))
    assert.match(r.texto, /Ana \(teléfono\) Pérez \(mail\)/)
  })
  test('lo escrito por personas se escapa: sin markdown propio ni menciones coladas', () => {
    const r = M.textoBloqueo({ video_id: 3, cliente: 'Ana', clave: 'T1-V3', motivo: '@everyone <@999999999999999999> **urgente**', quien: 'René' }, E.mencionesEdicion(ENV_REAL), BASE)
    assert.ok(!r.texto.includes('@everyone'), 'el @everyone queda neutralizado')
    assert.ok(!r.texto.includes('<@999999999999999999>'))
    assert.ok(r.texto.includes('\\*\\*urgente\\*\\*'))
    assert.deepEqual(r.menciones, [AYLU])
  })
})

describe('planificar: agrupación y ventanas (reloj de juguete)', () => {
  const ctx = filas => ({ filasPorCliente: new Map([['A101', filas]]) })
  test('para_editar: sale enseguida si no queda nada en crudo_a_revisar; si queda, a los 30 min', () => {
    const [p1] = C.planificar([evento(1, 'para_editar')], [], ctx([fila(1, 'para_editar'), fila(2, 'para_editar')]), ahora())
    assert.equal(p1.base, 'rene_cola:A101'); assert.equal(p1.tipo, 'para_editar')
    assert.equal(p1.enviar_despues, new Date(T0).toISOString())
    const [p2] = C.planificar([evento(1, 'para_editar')], [], ctx([fila(1, 'para_editar'), fila(2, 'crudo_a_revisar')]), ahora())
    assert.equal(p2.enviar_despues, new Date(T0 + 30 * 60_000).toISOString())
  })
  test('editados y corregidos: lote completo → enseguida; si René sigue, 30 min; corrección: 10 min; aprobado: 30 min a #ads', () => {
    assert.equal(C.planificar([evento(1, 'editado')], [], ctx([fila(1, 'editado')]), ahora())[0].enviar_despues, new Date(T0).toISOString())
    assert.equal(C.planificar([evento(1, 'editado')], [], ctx([fila(1, 'editado'), fila(2, 'para_editar')]), ahora())[0].enviar_despues, new Date(T0 + 30 * 60_000).toISOString())
    assert.equal(C.planificar([evento(1, 'corregido')], [], ctx([fila(1, 'corregido'), fila(2, 'correccion')]), ahora())[0].base, 'aylu_corregidos:A101')
    const [c] = C.planificar([evento(1, 'correccion')], [], ctx([fila(1, 'correccion')]), ahora())
    assert.equal(c.base, 'rene_correccion:A101'); assert.equal(c.enviar_despues, new Date(T0 + 10 * 60_000).toISOString())
    const [v] = C.planificar([evento(1, 'aprobado')], [], ctx([fila(1, 'aprobado')]), ahora())
    assert.equal(v.base, 'valen:A101'); assert.equal(v.canal, 'ads'); assert.equal(v.enviar_despues, new Date(T0 + 30 * 60_000).toISOString())
  })
  test('varios eventos del mismo lote se juntan en un aviso con todos los videos', () => {
    const p = C.planificar([evento(1, 'para_editar'), evento(2, 'para_editar'), evento(3, 'para_editar')], [], ctx([fila(1, 'para_editar'), fila(2, 'para_editar'), fila(3, 'para_editar')]), ahora())
    assert.equal(p.length, 1)
    assert.deepEqual(p[0].datos.videos, [1, 2, 3])
  })
  test('una nota o un pedido que se suma a la ronda abierta va con la corrección; René marcando un bloqueo avisa a Aylu una vez', () => {
    const p = C.planificar([evento(1, null, { tipo: 'nota' }), evento(1, null, { tipo: 'pedido', datos: { ronda_abierta: true } })], [], ctx([fila(1, 'correccion')]), ahora())
    assert.equal(p.length, 1); assert.equal(p[0].base, 'rene_correccion:A101')
    assert.equal(C.planificar([evento(1, null, { tipo: 'nota' })], [], ctx([fila(1, 'editado')]), ahora()).length, 0, 'una nota nueva fuera de corrección no avisa')
    const b = C.planificar([evento(1, null, { tipo: 'bloqueo', nota: 'falta el crudo del CTA', actor: { tipo: 'persona', rol: 'rene', nombre: 'René', email: 'r@x.test' } })], [],
      ctx([fila(1, 'para_editar', { bloqueo: 'otro' })]), ahora())
    assert.equal(b[0].tipo, 'bloqueo'); assert.equal(b[0].unaVez, true); assert.equal(b[0].datos.quien, 'René')
    assert.ok(!JSON.stringify(b).includes('r@x.test'), 'el mail del actor no va al aviso')
  })
  test('sin paleta al pasar a Para editar → marca_falta una vez por cliente y día', () => {
    const p = C.planificar([evento(1, 'para_editar'), evento(2, 'para_editar')], [], ctx([fila(1, 'para_editar', { paleta: false }), fila(2, 'para_editar', { paleta: false })]), ahora())
    const m = p.filter(x => x.tipo === 'marca_falta')
    assert.equal(m.length, 1); assert.equal(m[0].base, 'marca:A101:2026-10-27'); assert.equal(m[0].unaVez, true); assert.equal(m[0].datos.videos, 2)
  })
  test('avisos del motor: una vez, con su base', () => {
    const tanda = { id: 44, id_crm: 'A101', tipo: 'crudos', desde: '', hasta: '', archivos: 14, subio: 'cliente', estado: 'comparada', cerrada: null, resultado: null, version: 1 }
    const p = C.planificar([], [
      { tipo: 'tanda_crudos', tanda, cliente: 'Ana Pérez', demorada: false },
      { tipo: 'tope_rondas', video_id: 7, id_crm: 'A101', cliente: 'Ana Pérez', clave: 'T1-V2', ronda: 3, pedido_id: 9 },
      { tipo: 'error', proceso: 'vigia', motivo: 'Drive respondió 500 en la carpeta 123' },
      { tipo: 'vigia_callado', desde: '2026-10-27T10:00:00.000Z', horas: 3 },
      { tipo: 'vinculo_pendiente', carpeta_id: 'CARP1', nombre: 'Lucas Q', candidatos: [] },
      { tipo: 'crudo_borrado', video_id: 7, id_crm: 'A101', cliente: 'Ana Pérez', clave: 'T1-V2', archivo: 'IMG_0249.MOV' },
      { tipo: 'transcripcion_fallida', archivo_id: 5, id_crm: 'A101', cliente: 'Ana Pérez', nombre: 'C0001.MP4', motivo: 'grande' },
    ], { filasPorCliente: new Map() }, ahora())
    assert.deepEqual(p.map(x => x.base.replace(/:[0-9a-f]{8}:/, ':H:')), ['tanda:44', 'tope:7:3', 'error:vigia:H:2026-10-27', 'callado:2026-10-27T10:00:00.000Z', 'vinculo:CARP1',
      p[5].base, 'transcripcion:A101:2026-10-27'])
    assert.ok(p.slice(0, 6).every(x => x.unaVez))
    assert.equal(p[6].unaVez, undefined, 'las transcripciones fallidas se agrupan por cliente y día')
    assert.equal(C.huella('Drive respondió 500 en la carpeta 123'), C.huella('Drive respondió 500 en la carpeta 999'), 'el mismo error con otro número es el mismo')
  })
})

describe('cola: despacho con el texto de ESE momento', () => {
  test('modo real: encola, espera la ventana y manda con lo último (René terminó 2 de 3, no 1 de 3)', async () => {
    const cola = colaMemoria(), j = lectorJuguete({ filas: [fila(1, 'editado'), fila(2, 'para_editar'), fila(3, 'para_editar')] }), d = discordFalso()
    const r1 = await C.avisar([evento(1, 'editado')], [], deps(cola, j.lector, ENV_REAL, d.enviar))
    assert.equal(r1.encolados, 1); assert.equal(r1.enviados, 0, 'René sigue: espera 30 min')
    reloj.t += 10 * 60_000
    j.s.filas[1].estado = 'editado'
    await C.avisar([evento(2, 'editado')], [], deps(cola, j.lector, ENV_REAL, d.enviar))
    assert.equal(cola.filas.length, 1, 'se mezcló en el mismo aviso pendiente')
    assert.deepEqual(cola.filas[0].datos.videos, [1, 2])
    reloj.t += 31 * 60_000
    const r = await C.despachar(deps(cola, j.lector, ENV_REAL, d.enviar))
    assert.equal(r.enviados, 1)
    assert.equal(d.envios.length, 1)
    assert.equal(d.envios[0].webhook, WEBHOOK)
    assert.match(d.envios[0].mensajes[0], new RegExp(`^<@${AYLU}> 👀 René terminó 2 de 3 de Ana Pérez · \\[revisar\\]\\(<${BASE}/clientes/edicion/cliente/A101>\\)$`))
    assert.deepEqual(d.envios[0].menciones, [AYLU])
    assert.equal(cola.filas[0].estado, 'enviado'); assert.equal(cola.filas[0].mensaje_id, '901')
  })
  test('lote completo: el aviso sale en el mismo despacho; si al despachar ya no hay nada, queda descartado', async () => {
    const cola = colaMemoria(), j = lectorJuguete({ filas: [fila(1, 'para_editar'), fila(2, 'para_editar', { prioridad: 'urgente' })] }), d = discordFalso()
    const r = await C.avisar([evento(1, 'para_editar'), evento(2, 'para_editar')], [], deps(cola, j.lector, ENV_REAL, d.enviar))
    assert.equal(r.enviados, 1)
    assert.equal(d.envios[0].mensajes[0], `<@${RENE}> ✂️ **Para editar · Ana Pérez** · 2 videos (1 urgente) · paleta cargada · [Edición](<${BASE}/clientes/edicion?cola=rene>)`)
    const cola2 = colaMemoria(), j2 = lectorJuguete({ filas: [fila(1, 'para_editar')] })
    await C.avisar([evento(1, 'para_editar')], [], deps(cola2, j2.lector, ENV_REAL, d.enviar), { despachar: false })
    j2.s.filas[0].estado = 'crudo_a_revisar'     // Aylu lo devolvió antes de que saliera
    const r2 = await C.despachar(deps(cola2, j2.lector, ENV_REAL, d.enviar))
    assert.equal(r2.descartados, 1)
    assert.equal(cola2.filas[0].estado, 'descartado')
  })
  test('una vez: el mismo aviso del motor encolado dos veces sale una sola vez', async () => {
    const cola = colaMemoria(), j = lectorJuguete(), d = discordFalso()
    const tope = { tipo: 'tope_rondas', video_id: 7, id_crm: 'A101', cliente: 'Ana Pérez', clave: 'T1-V2', ronda: 3, pedido_id: 9 }
    await C.avisar([], [tope], deps(cola, j.lector, ENV_REAL, d.enviar))
    await C.avisar([], [tope], deps(cola, j.lector, ENV_REAL, d.enviar))
    assert.equal(cola.filas.length, 1)
    assert.equal(d.envios.length, 1)
    assert.match(d.envios[0].mensajes[0], /^<@333333333333333333> 🚦 \*\*Tope de rondas · Ana Pérez · T1 video 2\*\*: el cliente pidió la ronda 3 de correcciones\. Espera tu OK/)
    assert.match(d.envios[0].mensajes[0], /al cliente no se le dijo nada/)
    assert.match(d.envios[0].mensajes[0], new RegExp(`\\(<${BASE}/clientes/edicion/video/7>\\)$`))
  })
  test('dudoso: un timeout de Discord queda dudoso (no se reintenta) y uno colgado más de 10 minutos también', async () => {
    const cola = colaMemoria(), j = lectorJuguete({ filas: [fila(1, 'para_editar')] })
    const d = discordFalso({ falla: new ErrorEnvio('Discord no respondió en 15 s', [], true) })
    await C.avisar([evento(1, 'para_editar')], [], deps(cola, j.lector, ENV_REAL, d.enviar))
    assert.equal(cola.filas[0].estado, 'dudoso')
    assert.match(cola.filas[0].error, /mirá el canal/)
    const cola2 = colaMemoria()
    await cola2.repo.encolar({ base: 'x:1', tipo: 'error', canal: 'edicion', datos: { proceso: 'p', motivo: 'm' }, enviar_despues: new Date(T0).toISOString(), unaVez: true })
    await cola2.repo.reclamarVencidos(new Date(T0).toISOString(), 5)      // otro despacho lo tomó y se colgó
    reloj.t += 11 * 60_000
    const r = await C.despachar(deps(cola2, j.lector, ENV_REAL, discordFalso().enviar))
    assert.equal(r.dudosos, 1); assert.equal(cola2.filas[0].estado, 'dudoso')
  })
  test('errores: sin conexión → vuelve a la cola (hasta 3 intentos); un 404 → error; sin DISCORD_WEBHOOK_EDICION → error', async () => {
    const cola = colaMemoria(), j = lectorJuguete({ filas: [fila(1, 'para_editar')] })
    await C.avisar([evento(1, 'para_editar')], [], deps(cola, j.lector, ENV_REAL, discordFalso({ falla: new ErrorEnvio('no se pudo conectar con Discord (TypeError)', [], true) }).enviar))
    assert.equal(cola.filas[0].estado, 'pendiente'); assert.equal(cola.filas[0].enviar_despues, new Date(T0 + 5 * 60_000).toISOString())
    for (let i = 0; i < 3; i++) { reloj.t += 6 * 60_000; await C.despachar(deps(cola, j.lector, ENV_REAL, discordFalso({ falla: new ErrorEnvio('no se pudo conectar con Discord (TypeError)', [], true) }).enviar)) }
    assert.equal(cola.filas[0].estado, 'error', 'después de 3 intentos, error')
    const c2 = colaMemoria()
    await C.avisar([evento(1, 'para_editar')], [], deps(c2, j.lector, ENV_REAL, discordFalso({ falla: new ErrorEnvio('Discord respondió 404: Unknown Webhook', [], false) }).enviar))
    assert.equal(c2.filas[0].estado, 'error'); assert.match(c2.filas[0].error, /404/)
    const c3 = colaMemoria(), d3 = discordFalso()
    await C.avisar([evento(1, 'para_editar')], [], deps(c3, j.lector, { ...ENV_REAL, DISCORD_WEBHOOK_EDICION: '' }, d3.enviar))
    assert.equal(c3.filas[0].estado, 'error'); assert.equal(c3.filas[0].error, 'falta DISCORD_WEBHOOK_EDICION'); assert.equal(d3.envios.length, 0)
    assert.ok(!JSON.stringify(c2.filas).includes('secreto-edicion'), 'la URL del webhook nunca queda en la base')
  })
})

describe('modos', () => {
  test('EDICION_MODO dry (por defecto): no escribe nada ni llama a Discord; devuelve el plan con el texto que saldría', async () => {
    const cola = colaMemoria(), j = lectorJuguete({ filas: [fila(1, 'para_editar')] }), d = discordFalso()
    const r = await C.avisar([evento(1, 'para_editar')], [], deps(cola, j.lector, { DISCORD_ID_RENE: RENE }, d.enviar))
    assert.equal(r.encolados, 0); assert.equal(cola.filas.length, 0); assert.equal(d.envios.length, 0)
    assert.equal(r.plan.length, 1)
    assert.match(r.plan[0].texto, /^<@222222222222222222> ✂️ \*\*Para editar · Ana Pérez\*\*/)
    const desp = await C.despachar(deps(cola, j.lector, {}, d.enviar))
    assert.deepEqual(desp, { enviados: 0, dry: 0, errores: 0, descartados: 0, dudosos: 0 })
  })
  test('modo sombra (EDICION_MODO=real + EDICION_AVISOS=dry): se encola y queda en "dry" con su texto, sin Discord', async () => {
    const cola = colaMemoria(), j = lectorJuguete({ filas: [fila(1, 'para_editar')] }), d = discordFalso()
    const r = await C.avisar([evento(1, 'para_editar')], [], deps(cola, j.lector, { ...ENV_REAL, EDICION_AVISOS: 'dry' }, d.enviar))
    assert.equal(r.encolados, 1); assert.equal(d.envios.length, 0)
    assert.equal(cola.filas[0].estado, 'dry')
    assert.match(cola.filas[0].texto, /Para editar · Ana Pérez/)
    assert.deepEqual(cola.filas[0].menciones, [RENE])
  })
  test('avisarEventos (index) nunca lanza: con el lector o la cola rotos devuelve ceros', async () => {
    const roto = { videosDeCliente: async () => { throw new Error('Neon caído') }, videosPorIds: async () => { throw new Error('x') }, notasDe: async () => [], tanda: async () => null, sugerenciaMeta: async () => null }
    const repoRoto = { ...colaMemoria().repo, encolar: async () => { throw new Error('la base no respondió') }, reclamarVencidos: async () => { throw new Error('caída') } }
    const r = await A.avisarEventos([evento(1, 'para_editar')], [], { repo: repoRoto, lector: roto, env: ENV_REAL, ahora, baseLista: () => true, enviar: discordFalso().enviar })
    assert.deepEqual({ encolados: r.encolados, enviados: r.enviados }, { encolados: 0, enviados: 0 })
    const d = await A.despacharPendientes({ repo: repoRoto, lector: roto, env: ENV_REAL, ahora, baseLista: () => true })
    assert.equal(d.errores, 1)
  })
  test('sin base configurada no hay cola: el plan sale igual (como en dry)', async () => {
    const cola = colaMemoria(), j = lectorJuguete()
    const r = await C.avisar([], [{ tipo: 'error', proceso: 'diario', motivo: 'algo' }], { ...deps(cola, j.lector, ENV_REAL, discordFalso().enviar), baseLista: () => false })
    assert.equal(cola.filas.length, 0); assert.equal(r.plan.length, 1)
  })
})

describe('Valen (#ads)', () => {
  test('aprobado: links a los ARCHIVOS editados de Drive (nunca a la carpeta) y la sugerencia de Meta, en #ads', async () => {
    const filas = [fila(1, 'aprobado'), fila(2, 'aprobado', { editado: { url: 'https://drive.google.com/drive/folders/CARPETAxxxxxxxx' } }), fila(3, 'con_cliente')]
    const cola = colaMemoria(), j = lectorJuguete({ filas, sugerencia: 'parece optimización (hay campañas activas en los últimos 7 días)' }), d = discordFalso()
    await C.avisar([evento(1, 'aprobado'), evento(2, 'aprobado')], [], deps(cola, j.lector, ENV_REAL, d.enviar))
    reloj.t += 31 * 60_000
    await C.despachar(deps(cola, j.lector, ENV_REAL, d.enviar))
    assert.equal(d.envios[0].webhook, WEBHOOK_ADS)
    const t = d.envios[0].mensajes[0]
    assert.match(t, new RegExp(`^<@${VALEN}> 🎬 \\*\\*Ana Pérez aprobó 2 videos\\*\\*`))
    assert.match(t, /\[T1 video 1\]\(<https:\/\/drive\.google\.com\/file\/d\/ARCHIVO1xxxxxxxx\/view>\)/)
    assert.match(t, /T1 video 2 \(sin link\)/, 'el link a una carpeta no va')
    assert.ok(!/folders/.test(t))
    assert.match(t, /\n💡 parece optimización/)
    assert.deepEqual(d.envios[0].menciones, [VALEN])
  })
  test('sin el webhook de #ads: va a #✂️-edicion para que Aylu lo reenvíe, y un error a Tomás una vez por día', async () => {
    const cola = colaMemoria(), j = lectorJuguete({ filas: [fila(1, 'aprobado')], sugerencia: null }), d = discordFalso()
    const env = { ...ENV_REAL, DISCORD_WEBHOOK_KICKOFF_ADS: '' }
    await C.avisar([evento(1, 'aprobado')], [], deps(cola, j.lector, env, d.enviar))
    reloj.t += 31 * 60_000
    await C.despachar(deps(cola, j.lector, env, d.enviar))
    await C.despachar(deps(cola, j.lector, env, d.enviar))
    assert.equal(d.envios[0].webhook, WEBHOOK)
    assert.match(d.envios[0].mensajes[0], new RegExp(`^<@${AYLU}> para reenviarle a Valen \\(falta el webhook de #ads\\):`))
    assert.match(d.envios[0].mensajes[0], /sin dato de Meta: decidir con Tomás/)
    const errores = cola.filas.filter(f => f.tipo === 'error')
    assert.equal(errores.length, 1)
    assert.match(d.envios[1].mensajes[0], new RegExp(`^<@${TOMI}> ⚠️ \\*\\*Edición · error en avisos:\\*\\* falta DISCORD\\\\_WEBHOOK\\\\_KICKOFF\\\\_ADS`))
  })
})

describe('textos', () => {
  const m = E.mencionesEdicion(ENV_REAL)
  test('tanda de crudos: archivos, quién subió, cobertura y lo que falta, con link a la vista del cliente', () => {
    const tanda = { id: 44, id_crm: 'A101', tipo: 'crudos', desde: '', hasta: '', archivos: 14, subio: 'cliente', estado: 'comparada', cerrada: null, version: 1,
      resultado: { version: 'cmp1', generado: '', sin_ubicar: [91], sin_transcribir: [], tokens: null, guiones: [
        ...[1, 2, 4, 5].map(n => ({ guion_ref: `T1-V${n}`, video_id: n, frases: 8, presentes: 8, faltan: [], dudosas: [], mejor_toma: null, por: 'cruce', estado: 'completo' })),
        { guion_ref: 'T1-V3', video_id: 3, frases: 8, presentes: 7, faltan: ['Escribinos al WhatsApp del estudio, te respondemos hoy'], dudosas: [], mejor_toma: null, por: 'claude', estado: 'incompleto' },
      ] } }
    const r = M.textoTandaCrudos({ tanda_id: 44, id_crm: 'A101', cliente: 'Belén Alvelo', demorada: false }, { ...M.fotoVacia(), tanda }, m, BASE)
    assert.equal(r.texto, `<@${AYLU}> 📥 **Crudos nuevos · Belén Alvelo** · Tanda 1: 14 archivos (los subió el cliente) · 4 de 5 guiones completos · ` +
      `video 3: 1 frase falta («Escribinos al WhatsApp del estudio, te respondemos hoy») · 1 crudo sin ubicar (asignalos en la pantalla) · [Revisar](<${BASE}/clientes/edicion/cliente/A101>)`)
    const demorada = M.textoTandaCrudos({ tanda_id: 44, id_crm: 'A101', cliente: 'Belén Alvelo', demorada: true }, { ...M.fotoVacia(), tanda: { ...tanda, resultado: null } }, m, BASE)
    assert.match(demorada.texto, /la transcripción viene demorada/)
  })
  test('corrección: la lista de notas con su momento, la ronda y de quién; René ve solo las enviadas sin tildar', () => {
    const foto = { ...M.fotoVacia(), filas: [fila(1, 'correccion'), fila(2, 'correccion'), fila(3, 'editado')],
      notas: new Map([[1, [nota(), nota({ segundo: 26, hasta: 32, tipo: 'corte', texto: 'cortar donde se traba' }), nota({ texto: 'ya resuelta', tilde: { quien: 'René', cuando: '' } }), nota({ texto: 'sin mandar', enviada: false })]],
        [2, [nota({ origen: 'cliente', ronda: 3, segundo: null, tipo: 'broll', texto: 'sumar imágenes del juzgado' })]]]) }
    const r = M.textoCorreccion({ id_crm: 'A101', cliente: 'Uriel Biondi', videos: [1, 2] }, foto, m, BASE)
    assert.match(r.texto, /^<@222222222222222222> 🛠️ \*\*Corrección · Uriel Biondi\*\*/)
    assert.match(r.texto, /• video 1 \(«Gancho 1»\) \(corrección 2, de Aylu\): 2 notas\n {2}· 0:17 · texto: dice «mora», va «demora»\n {2}· 0:26–0:32 · corte: cortar donde se traba/)
    assert.match(r.texto, /• video 2 \(«Gancho 2»\) \(corrección 3, del cliente\): 1 nota\n {2}· b-roll: sumar imágenes del juzgado/)
    assert.ok(!/ya resuelta|sin mandar/.test(r.texto))
    assert.ok(r.texto.endsWith(`[Ver en Edición](<${BASE}/clientes/edicion?cola=rene>)`))
  })
  test('resumen de la daily: Aylu siempre; Gero M si hay audio o llamada; Tomás si hay día 9', () => {
    const resumen = (escalones) => ({ fecha: '2026-10-27', escalones, colas: { para_editar: 12, con_cliente: 16, crudo_a_revisar: 3 },
      trabados: [{ video_id: 1, id_crm: 'A101', cliente: 'Lucas Quiroga', clave: 'T2-V4', estado: 'para_editar', desde: '', horas: 30.2, habiles: 1, quien: 'rene' }],
      cola_rene: [{ id_crm: 'A101', cliente: 'Lucas Quiroga', videos: 8, urgente: true }], grabado_sin_crudos: [], editados_por_vincular: 2, vinculos_por_confirmar: 1,
      sin_transcribir: [{ id_crm: 'A102', cliente: 'Belén', archivos: 2, motivo: 'grande' }] })
    const c = (cliente, responsable = 'aylu') => ({ id_crm: 'A1', cliente, dias: 2, responsable })
    const soloAylu = M.textoResumen(resumen([{ escalon: 'dia0', clientes: [c('Ana')] }]), m, BASE)
    assert.deepEqual(soloAylu.menciones, [AYLU])
    assert.match(soloAylu.texto, /📋 \*\*Resumen para la daily · mar 27\/10\*\*/)
    assert.match(soloAylu.texto, /🎬 \*\*Grabaciones pendientes:\*\* día 0 \(mensaje\): Ana/)
    assert.match(soloAylu.texto, /🗂️ \*\*Colas:\*\* crudos a revisar 3 · para editar 12 · con el cliente 16/)
    assert.match(soloAylu.texto, /⏱️ \*\*Trabados:\*\* Lucas Quiroga T2 video 4 \(30 h, René\)/)
    assert.match(soloAylu.texto, /✂️ \*\*Cola de René:\*\* Lucas Quiroga 8 \(urgente\)/)
    assert.match(soloAylu.texto, /editados por vincular: 2 · carpetas por confirmar: 1 · sin transcribir: 2 crudos \(plan B\)/)
    assert.ok(soloAylu.texto.includes(`[Grabaciones pendientes](<${BASE}/clientes/edicion/pendientes>)`))
    const todos = M.textoResumen(resumen([{ escalon: 'dia2', clientes: [c('Bea', 'gero_m')] }, { escalon: 'dia9', clientes: [c('Ceci', 'tomas')] }, { escalon: 'r1', clientes: [c('Dani')] }]), m, BASE)
    assert.deepEqual(todos.menciones, [AYLU, GERO, TOMI])
    assert.match(todos.texto, /día 2 \(audio de Gero M\): Bea · día 9 \(decide Tomás\): Ceci · recordatorio: Dani/)
  })
  test('2.000 caracteres: con muchísimos datos el mensaje entra, los ítems no se cortan a la mitad y el link no se pierde', () => {
    const muchas = Array.from({ length: 40 }, (_, i) => nota({ segundo: i, texto: `nota larga número ${i} `.repeat(8) }))
    const filas = Array.from({ length: 12 }, (_, i) => fila(i + 1, 'correccion', { gancho: 'Un gancho bastante largo para ocupar lugar en el renglón '.repeat(2) }))
    const foto = { ...M.fotoVacia(), filas, notas: new Map(filas.map(f => [f.id, muchas])) }
    const r = M.textoCorreccion({ id_crm: 'A101', cliente: 'Cliente con nombre largo '.repeat(5), videos: [] }, foto, m, BASE)
    assert.ok(r.texto.length <= 2000, `${r.texto.length}`)
    assert.ok(r.texto.endsWith(`[Ver en Edición](<${BASE}/clientes/edicion?cola=rene>)`), 'el pie con el link queda')
    assert.match(r.texto, /\+\d+ videos más en la pantalla/)
    const resumen = { fecha: '2026-10-27', colas: {}, trabados: Array.from({ length: 60 }, (_, i) => ({ video_id: i, id_crm: 'A1', cliente: `Cliente ${i} con nombre`, clave: `T1-V${i}`, estado: 'para_editar', desde: '', horas: 50, habiles: 2, quien: 'rene' })),
      escalones: [{ escalon: 'dia0', clientes: Array.from({ length: 80 }, (_, i) => ({ id_crm: 'A1', cliente: `Persona ${i} Apellido`, dias: 0, responsable: 'aylu' })) }],
      cola_rene: [], grabado_sin_crudos: [], editados_por_vincular: 0, vinculos_por_confirmar: 0, sin_transcribir: [] }
    const t = M.textoResumen(resumen, m, BASE).texto
    assert.ok(t.length <= 2000)
    assert.ok(t.includes(`(<${BASE}/clientes/edicion/pendientes>)`))
    assert.match(t, /y 74 más/)
  })
  test('ningún aviso lleva mails ni teléfonos aunque vengan en los datos', () => {
    const sucios = { cliente: 'Ana ana@estudio.test', archivo: 'llamar 351 555 4433.mov', nombre: 'carpeta de +54 9 351 555-4433', motivo: 'ana@estudio.test' }
    const textos = [
      M.textoCrudoBorrado({ video_id: 1, cliente: sucios.cliente, clave: 'T1-V1', archivo: sucios.archivo }, m, BASE).texto,
      M.textoVinculo({ carpeta_id: 'X', nombre: sucios.nombre, candidatos: [{ id_crm: 'A1', nombre: sucios.cliente, puntaje: 1 }] }, m, BASE).texto,
      M.textoError({ proceso: 'vigia', motivo: `falló con ${sucios.motivo} y https://www.googleapis.com/drive/v3/files?key=abc` }, m).texto,
      M.textoTranscripcion({ id_crm: 'A1', cliente: sucios.cliente, archivos: [{ archivo_id: 1, nombre: sucios.archivo, motivo: 'link_privado' }] }, m, BASE).texto,
    ]
    for (const t of textos) {
      assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i.test(t), t)
      assert.ok(!/555[\s-]?4433/.test(t), t)
    }
    assert.ok(!textos[2].includes('googleapis'), 'el motivo de un error va sin URLs')
  })
})

describe('db/avisos (Neon falso)', () => {
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    q.query = async texto => (/max\(version\)/.test(texto) ? [{ version: 999 }] : [])
    q.transaction = async xs => Promise.all(xs)
    return { consultas, fabrica: () => q }
  }
  const filaAviso = (over = {}) => ({ id: '5', clave: null, base: 'rene_cola:A101', tipo: 'para_editar', canal: 'edicion', datos: { videos: [1] }, texto: null, menciones: [], estado: 'pendiente',
    enviar_despues: new Date(T0), mensaje_id: null, intentos: 0, error: '', creado: new Date(T0), enviado: null, ...over })
  beforeEach(() => { process.env.DATABASE_URL = 'postgres://falsa.test/db' })
  afterEach(() => { base.sqlParaPruebas(null); delete process.env.DATABASE_URL })

  test('encolar agrupado: una sola sentencia con ON CONFLICT (base) WHERE pendiente, listas juntadas y tope de 2 h', async () => {
    const n = neonFalso(t => (t.startsWith('INSERT') ? [filaAviso()] : []))
    base.sqlParaPruebas(n.fabrica)
    const a = await DBA.encolar({ base: 'rene_cola:A101', tipo: 'para_editar', canal: 'edicion', datos: { videos: [2] }, enviar_despues: new Date(T0).toISOString() })
    assert.equal(a.id, 5)
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_edicion_avisos'))
    assert.match(ins.texto, /ON CONFLICT \(base\) WHERE estado = 'pendiente' DO UPDATE SET/)
    assert.match(ins.texto, /jsonb_agg\(DISTINCT x\).*'videos'/)
    assert.match(ins.texto, /enviar_despues = LEAST\(EXCLUDED\.enviar_despues, cj_edicion_avisos\.creado \+ interval '2 hours'\)/)
    assert.ok(!/\bclave\b/.test(ins.texto.split('VALUES')[0]), 'el agrupado no usa clave')
  })
  test('encolar de una vez: clave = base y ON CONFLICT DO NOTHING; si ya estaba, devuelve el existente', async () => {
    const n = neonFalso(t => (t.startsWith('SELECT') ? [filaAviso({ clave: 'tanda:44', base: 'tanda:44', estado: 'enviado' })] : []))
    base.sqlParaPruebas(n.fabrica)
    const a = await DBA.encolar({ base: 'tanda:44', tipo: 'tanda_crudos', canal: 'edicion', datos: {}, enviar_despues: new Date(T0).toISOString(), unaVez: true })
    assert.equal(a.estado, 'enviado')
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT'))
    assert.match(ins.texto, /\(clave, base, tipo, canal, datos, estado, enviar_despues\)/)
    assert.match(ins.texto, /ON CONFLICT DO NOTHING RETURNING \*/)
    await assert.rejects(DBA.encolar({ base: 'con espacios', tipo: 'x', canal: 'edicion', datos: {}, enviar_despues: new Date(T0).toISOString() }), /base de aviso inválida/)
  })
  test('reclamar con FOR UPDATE SKIP LOCKED; dudosos a los 10 min; cerrar solo si sigue enviando; las lecturas no crean la tabla', async () => {
    let n = neonFalso(() => [filaAviso({ estado: 'enviando' })])
    base.sqlParaPruebas(n.fabrica)
    const xs = await DBA.reclamarVencidos(new Date(T0).toISOString(), 5)
    assert.equal(xs[0].estado, 'enviando')
    assert.match(n.consultas[0].texto, /FOR UPDATE SKIP LOCKED/)
    assert.match(n.consultas[0].texto, /SET estado = 'enviando', intentos = intentos \+ 1, enviado = now\(\)/)
    await DBA.marcarDudosos(new Date(T0).toISOString())
    assert.match(n.consultas.at(-1).texto, /SET estado = 'dudoso'.*WHERE estado = 'enviando' AND enviado < \$\d+::timestamptz - make_interval\(mins => \$\d+::int\)/)
    await DBA.cerrarAviso(5, { estado: 'enviado', texto: 't', menciones: [RENE], mensaje_id: '9' })
    assert.match(n.consultas.at(-1).texto, /WHERE id = \$\d+ AND estado = 'enviando'$/)
    n = neonFalso(() => { throw Object.assign(new Error('relation "cj_edicion_avisos" does not exist'), { code: '42P01' }) })
    base.sqlParaPruebas(n.fabrica)
    assert.deepEqual(await DBA.listarAvisos({ estados: ['dudoso'] }), [])
    assert.deepEqual(await DBA.reclamarVencidos(new Date(T0).toISOString(), 5), [])
    assert.equal(await DBA.existeClave('resumen:2026-10-27'), false)
    assert.ok(!n.consultas.some(c => /CREATE/.test(c.texto)))
  })
  test('reprogramar: si ya hay otro pendiente de la misma base, le mezcla los datos y este queda descartado', async () => {
    const n = neonFalso(t => (t.startsWith('UPDATE cj_edicion_avisos SET estado = \'pendiente\'') ? [] : []))
    base.sqlParaPruebas(n.fabrica)
    const r = await DBA.reprogramar({ id: 5, base: 'rene_cola:A101', datos: { videos: [1] } }, new Date(T0).toISOString(), 'Discord respondió 503')
    assert.equal(r, 'mezclado')
    assert.ok(n.consultas.some(c => /SET estado = 'descartado'/.test(c.texto)))
    // t08 (ronda 3): las listas videos y archivos se juntan sin repetir, igual que en encolar (antes el `||` las pisaba)
    const mezcla = n.consultas.find(c => c.texto.startsWith('UPDATE cj_edicion_avisos o SET datos'))
    assert.ok(mezcla, 'sentencia de mezcla')
    assert.match(mezcla.texto, /jsonb_build_object\('videos', \(SELECT coalesce\(jsonb_agg\(DISTINCT x\)/)
    assert.match(mezcla.texto, /jsonb_build_object\('archivos', \(SELECT coalesce\(jsonb_agg\(DISTINCT x\)/)
    assert.ok(mezcla.valores.includes(JSON.stringify({ videos: [1] })))
  })
})

describe('revisión (24/10)', () => {
  const mm = E.mencionesEdicion({ DISCORD_ID_RENE: '222222222222222222', DISCORD_ID_AYLU: '111111111111111111' })
  test('un importado de ClickUp se nombra por su número en Discord, nunca por la clave CU-…', () => {
    assert.equal(M.nombreVideo('CU-86b6xyz', false, 3), 'video 3 (ClickUp)')
    assert.equal(M.nombreVideo('CU-86b6xyz', true), 'video de ClickUp')
    assert.equal(M.nombreVideo('T2-V4', true), 'T2 video 4')
    const t = M.textoTope({ video_id: 7, id_crm: 'A101', cliente: 'Lucas', clave: 'CU-86b6xyz', ronda: 3, pedido_id: 1, numero: 3 }, mm, 'https://d.test')
    assert.ok(!t.texto.includes('CU-86b6xyz')); assert.match(t.texto, /video 3 \(ClickUp\)/)
  })
  test('corrección: solo las notas de la corrección EN CURSO (las de una anterior forzada sin tildar no se repiten)', () => {
    const f = { id: 1, id_crm: 'A101', cliente: 'Uriel', clave: 'T1-V1', estado: 'correccion', prioridad: 'normal', gancho: '', bloqueo: null, editado: null }
    const n = (o) => ({ ronda: 2, origen: 'aylu', enviada: true, segundo: null, hasta: null, tipo: 'texto', texto: 'x', tilde: null, ...o })
    const foto = { ...M.fotoVacia(), filas: [f], notas: new Map([[1, [n({ ronda: 1, texto: 'vieja sin tildar' }), n({ texto: 'nueva' })]]]) }
    const r = M.textoCorreccion({ id_crm: 'A101', cliente: 'Uriel', videos: [1] }, foto, mm, 'https://d.test')
    assert.match(r.texto, /nueva/); assert.ok(!/vieja sin tildar/.test(r.texto))
    assert.match(r.texto, /corrección 2/)
  })
})
