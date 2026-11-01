// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-notas.mjs
// Notas del cliente (lib/bot/anuncios/notas.ts): qué mensajes del webhook de Whapi se leen, qué se guarda y cuándo va el
// aviso a Valen. Sin red: directorio, Claude, base y Discord falsos.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const N = await import('../lib/bot/anuncios/notas.ts')

const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
const GENERAL = '120363000000000010@g.us', CONTENIDO = '120363000000000011@g.us', EQUIPO = '120363000000000020@g.us'
const CLIENTE_TEL = '5491155550099', TOMI = '5491100000001'
const AHORA = Date.parse('2026-11-01T15:00:00Z')
const TS = Math.floor(AHORA / 1000) - 30
let n = 0
const msg = (over = {}) => ({ id: `msg-${++n}-AbCd`, from_me: false, type: 'text', chat_id: GENERAL, timestamp: TS, source: 'mobile', text: { body: 'hola' }, from: CLIENTE_TEL, from_name: 'Ana', ...over })
const envio = messages => ({ messages, event: { type: 'messages', event: 'post' }, channel_id: 'MANTIS-PRUEBA1' })

describe('filtro barato', () => {
  test('pasa lo que puede ser de la campaña; no la charla', () => {
    assert.equal(N.pareceDeAnuncios('Me están llegando muchas consultas de Córdoba y yo atiendo solo en Rosario'), true)
    assert.equal(N.pareceDeAnuncios('¿Podemos pausar los anuncios del 20 al 31?'), true)
    assert.equal(N.pareceDeAnuncios('Esta semana no puedo pagar la tarjeta, frenemos'), true)
    assert.equal(N.pareceDeAnuncios('gracias chicos!'), false)
    assert.equal(N.pareceDeAnuncios('mañana grabo'), false)
    assert.equal(N.pareceDeAnuncios('qué lindo día hace hoy en la ciudad de mar'), true)   // amplio a propósito: decide Claude
  })
  test('candidatos: solo clientes en grupos que no son del equipo, con menos de 48 h', () => {
    const c = N.candidatosNotas(envio([
      msg({ text: { body: 'Me llegan consultas de otra provincia, no me sirven' } }),
      msg({ from_me: true, source: 'api', text: { body: 'Me llegan consultas de otra provincia' } }),
      msg({ from: TOMI, text: { body: 'Bajemos el presupuesto de los anuncios a 200' } }),
      msg({ chat_id: GRUPOS.ventas, text: { body: 'Bajemos el presupuesto de los anuncios a 200' } }),
      msg({ chat_id: EQUIPO, text: { body: 'Bajemos el presupuesto de los anuncios a 200' } }),
      msg({ chat_id: '5491100000000@s.whatsapp.net', text: { body: 'Bajemos el presupuesto de los anuncios a 200' } }),
      msg({ timestamp: TS - 3 * 86400, text: { body: 'Bajemos el presupuesto de los anuncios a 200' } }),
      msg({ text: { body: 'gracias!' } }),
      msg({ type: 'image', image: { id: 'i', mime_type: 'image/jpeg', caption: 'Miren este caso que me llegó por el anuncio' } }),
      msg({ type: 'voice', voice: { id: 'v' } }),
    ]), GRUPOS, AHORA, new Set([TOMI]), [EQUIPO])
    assert.deepEqual(c.map(x => x.texto), ['Me llegan consultas de otra provincia, no me sirven', 'Miren este caso que me llegó por el anuncio'])
    assert.equal(c[0].chatId, GENERAL)
  })
})

describe('lectura de Claude', () => {
  test('forma válida; sin "dijo" no hay nota; con pedido siempre se avisa', () => {
    assert.deepEqual(N.lecturaValida({ es_de_anuncios: true, dijo: 'Le llegan consultas de Córdoba.', pide: 'Sacar Córdoba de la zona', avisar: false, tipo: 'zona' }),
      { esDeAnuncios: true, dijo: 'Le llegan consultas de Córdoba.', pide: 'Sacar Córdoba de la zona', avisar: true, tipo: 'zona' })
    assert.equal(N.lecturaValida({ es_de_anuncios: true, dijo: '', pide: '', avisar: false, tipo: 'otro' }), null)
    assert.equal(N.lecturaValida({ es_de_anuncios: false }).esDeAnuncios, false)
    assert.equal(N.lecturaValida({ dijo: 'x' }), null)
    assert.equal(N.lecturaValida({ es_de_anuncios: true, dijo: 'Va bien.', pide: '', avisar: false, tipo: 'raro' }).tipo, 'otro')
  })
  test('el aviso a Valen: mención, pedido y link', () => {
    const t = N.textoAvisoNota({ cliente: 'Ana Pérez', dijo: 'Le llegan consultas de Córdoba.', pide: 'Sacar Córdoba de la zona', tipo: 'zona', enviadoEn: '2026-11-01T14:59:00Z' }, 'https://despacho/anuncios?nota=7#notas', '366')
    assert.match(t, /^<@366> 🗣️ \*\*Nota del cliente\*\* · Ana Pérez \(Zona, 0?1\/11\)/)
    assert.match(t, /👉 \*\*Pide:\*\* Sacar Córdoba de la zona/)
    assert.match(t, /\[Ver la nota en el Despacho\]\(<https:\/\/despacho\/anuncios\?nota=7#notas>\)/)
    assert.match(N.textoAvisoNota({ cliente: 'Ana', dijo: 'x', pide: '', tipo: 'otro', enviadoEn: '2026-11-01T14:59:00Z' }, 'l', null), /Tenelo en cuenta/)
  })
})

describe('procesarNotas', () => {
  const m = (texto, chatId = GENERAL) => ({ mensajeId: `m${++n}`, chatId, texto, autor: { telefono: CLIENTE_TEL, lid: null, nombre: 'Ana' }, enviadoEn: '2026-11-01T14:59:00Z' })
  function deps(o = {}) {
    const d = { guardadas: [], enviados: [], marcas: [], reclamados: new Set() }
    let id = 0
    return Object.assign(d, {
      deChat: async c => (c === CONTENIDO ? { idCrm: 'A1', cliente: 'Ana Pérez', grupo: 'contenido' } : c === GENERAL ? { idCrm: 'A1', cliente: 'Ana Pérez', grupo: 'general' } : null),
      reclamar: async x => (d.reclamados.has(x.mensajeId) ? null : (d.reclamados.add(x.mensajeId), { id: ++id })),
      leer: async t => (/pausar/.test(t) ? { esDeAnuncios: true, dijo: 'Quiere pausar en diciembre.', pide: 'Pausar del 20 al 31/12', avisar: true, tipo: 'pausa' }
        : /bien/.test(t) ? { esDeAnuncios: true, dijo: 'Dice que vienen bien las consultas.', pide: '', avisar: false, tipo: 'calidad_consultas' }
          : { esDeAnuncios: false, dijo: '', pide: '', avisar: false, tipo: 'otro' }),
      guardar: async (i, l) => { d.guardadas.push([i, l?.esDeAnuncios ?? null]) },
      enviar: async t => { d.enviados.push(t); return 'D1' },
      marcarAviso: async (i, idm, e) => { d.marcas.push([i, idm, e]) },
      link: i => `https://despacho/anuncios?nota=${i}#notas`,
      valentino: '366',
    }, o)
  }
  test('pedido → nota + aviso; comentario → nota sin aviso; lo que no es de anuncios se descarta; Contenido y grupos ajenos no', async () => {
    const d = deps()
    const pausa = m('¿Podemos pausar los anuncios del 20 al 31?')
    const r = await N.procesarNotas([pausa, m('Vienen bien las consultas de los anuncios'), m('Mañana paso a pagar la tarjeta de la oficina'), m('Pausar los anuncios en enero', CONTENIDO), m('Pausar los anuncios', '120363000000000777@g.us')], d)
    assert.deepEqual({ ...r, errores: r.errores.length }, { leidos: 3, notas: 2, avisos: 1, errores: 0 })
    assert.deepEqual(d.guardadas, [[1, true], [2, true], [3, false]])
    assert.equal(d.enviados.length, 1); assert.match(d.enviados[0], /Pausar del 20 al 31\/12/); assert.match(d.enviados[0], /nota=1#notas/)
    assert.deepEqual(d.marcas, [[1, 'D1', 'avisada']])
    // El mismo mensaje otra vez (Whapi reintenta): no se relee ni se re-avisa
    const r2 = await N.procesarNotas([pausa], d)
    assert.equal(r2.leidos, 0); assert.equal(d.enviados.length, 1)
  })
  test('Discord falla: queda aviso_fallido; Claude falla: se guarda sin leer y no se avisa; cliente archivado: nada', async () => {
    const d = deps({ enviar: async () => { throw new Error('Discord 500') } })
    const r = await N.procesarNotas([m('¿Podemos pausar los anuncios?')], d)
    assert.equal(r.avisos, 0); assert.deepEqual(d.marcas, [[1, null, 'aviso_fallido']]); assert.match(r.errores[0], /discord/)
    const d2 = deps({ leer: async () => { throw new Error('sin clave') } })
    const r2 = await N.procesarNotas([m('¿Podemos pausar los anuncios?')], d2)
    assert.deepEqual(d2.guardadas, [[1, null]]); assert.equal(r2.notas, 0); assert.match(r2.errores[0], /claude/)
    const d3 = deps({ clienteOperativo: async () => false })
    assert.equal((await N.procesarNotas([m('¿Podemos pausar los anuncios?')], d3)).leidos, 0)
  })
})
