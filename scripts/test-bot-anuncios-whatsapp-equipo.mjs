// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-whatsapp-equipo.mjs
// Avisos de Anuncios al grupo ADS por WhatsApp (lib/bot/anuncios/whatsappEquipo.ts): un solo mensaje por corrida, mención a
// Valen, apagado por defecto y sin turno no sale. Sin red.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const W = await import('../lib/bot/anuncios/whatsappEquipo.ts')
const S = await import('../lib/bot/anuncios/whatsappEquipoServidor.ts')

describe('textos', () => {
  test('Discord → WhatsApp: sin mención de Discord, negrita simple, links a la vista', () => {
    assert.equal(W.discordAWhatsapp('<@366> 🗣️ **Nota del cliente** · Ana \\| Zona\n[Ver la nota en el Despacho](<https://d/anuncios?nota=7#notas>)'),
      '🗣️ *Nota del cliente* · Ana | Zona\nVer la nota en el Despacho: https://d/anuncios?nota=7#notas')
    assert.equal(W.textoSuelto('**Hola**', '5490000000000'), '@5490000000000 *Hola*')
  })
  test('resumen: uno solo, con mención y tope de líneas', () => {
    assert.equal(W.textoResumen([], 'l', null), null)
    const t = W.textoResumen([{ tipo: 'optimizar', cliente: 'Ana' }, { tipo: 'videos', cliente: 'Beto' }], 'https://d/anuncios', '5490000000000')
    assert.match(t, /^@5490000000000 📣 \*Anuncios de hoy\* · 2 avisos/)
    assert.match(t, /• Ana — Optimizar\n• Beto — Videos nuevos para subir/)
    assert.match(t, /Tablero: https:\/\/d\/anuncios$/)
    const muchos = W.textoResumen(Array.from({ length: 25 }, (_, i) => ({ tipo: 'lanzada', cliente: `C${i}` })), 'l', null)
    assert.equal(muchos.split('\n').filter(l => l.startsWith('•')).length, W.MAX_LINEAS_RESUMEN + 1)
    assert.match(muchos, /… y 5 más/)
  })
  test('variables: apagado por defecto, teléfono solo dígitos, tope del día', () => {
    assert.equal(W.equipoEncendido({}), false); assert.equal(W.equipoEncendido({ ANUNCIOS_WHATSAPP_EQUIPO: 'real' }), true)
    assert.equal(W.telValentino({ ANUNCIOS_WHATSAPP_TEL_VALENTINO: '+54 9 11 0000-0000' }), '5491100000000'); assert.equal(W.telValentino({}), null)
    assert.equal(W.maxPorDia({}), 6); assert.equal(W.maxPorDia({ ANUNCIOS_WHATSAPP_EQUIPO_MAX_DIA: '2' }), 2)
  })
})

describe('avisarEquipo', () => {
  const deps = (o = {}) => { const d = { enviados: [] }; return Object.assign(d, { encendido: true, tel: '5490000000000', reclamarTurno: async () => true, enviar: async (t, m) => { d.enviados.push([t, m]); return 'W1' } }, o) }
  test('apagado, sin texto, sin turno: no sale nada', async () => {
    const d = deps({ encendido: false }); assert.equal((await W.avisarEquipo('x', d)).estado, 'apagado'); assert.equal(d.enviados.length, 0)
    assert.equal((await W.avisarEquipo(null, deps())).estado, 'nada')
    const d2 = deps({ reclamarTurno: async () => false }); assert.equal((await W.avisarEquipo('x', d2)).estado, 'sin_turno'); assert.equal(d2.enviados.length, 0)
  })
  test('encendido: sale con la mención; un error (número caído) no tira y no muestra teléfonos', async () => {
    const d = deps(); assert.equal((await W.avisarEquipo('@5490000000000 hola', d)).estado, 'enviado'); assert.deepEqual(d.enviados, [['@5490000000000 hola', ['5490000000000']]])
    const r = await W.avisarEquipo('x', deps({ enviar: async () => { throw new Error('número del bot desconectado 5490000000000') } }))
    assert.equal(r.estado, 'error'); assert.doesNotMatch(r.motivo, /\d{7,}/)
  })
  test('el resumen junta solo lo que salió por Discord (seguimiento + videos)', () => {
    const items = S.itemsDelDia({ avisos: [{ tipo: 'optimizar', cliente: 'Ana', estado: 'enviado' }, { tipo: 'lanzada', cliente: 'Beto', estado: 'ya_salio' }] }, { avisos: [{ cliente: 'Caro', estado: 'enviado' }, { cliente: 'Dani', estado: 'dudoso' }] })
    assert.deepEqual(items, [{ tipo: 'optimizar', cliente: 'Ana' }, { tipo: 'videos', cliente: 'Caro' }])
    assert.deepEqual(S.itemsDelDia({ apagado: true }, { apagado: true }), [])
  })
})
