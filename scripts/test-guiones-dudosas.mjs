// Cargas de guiones en el Doc que quedan «dudosas» (12/11/2026): el puente no respondió a tiempo pero casi siempre ya escribió.
// Se reintentan solas desde el vigía con la misma clave y, si quedan escritas, se completa todo como en el camino «ok».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publicarParaEntrega, reconciliarDudosas, MAX_INTENTOS_DUDOSO, MARGEN_RECONCILIAR_MS, alertaFallaPublicacion } from '../lib/bot/guiones/publicacion.ts'
import { plazoEscritura } from '../lib/bot/guiones/envio.ts'

const ID = 'doc_de_prueba_1234567890'
const fila = (o = {}) => ({ id: 31, id_crm: 'A999', cliente: 'Cliente Prueba', tanda: 3, estado: 'aprobada', aprobacion: { cuando: '2026-11-12T14:08:59.285Z' }, guiones: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [n, { guion: { numero: n, titulo: `G${n}`, secciones: [] } }])), notas: [], doc: null, ...o })

const publicador = (o = {}) => {
  const log = [], alertas = [], whatsapp = []; let actual = fila(o.fila)
  return { log, alertas, whatsapp, deps: {
    reservar: async () => true, leer: async () => actual,
    resolver: async () => ({ id: ID, url: 'x' }),
    escribir: async () => { log.push('escribir'); return { estado: 'ok', id: ID, url: 'x', yaExistia: false, tanda: 3, ancla: null } },
    guardar: async (_i, doc) => { log.push('guardar'); actual = { ...actual, doc } },
    marcarChips: async (doc, tanda, cantidad) => { log.push(`chips ${tanda}x${cantidad}`); return { estado: 'ok', cambiados: cantidad } },
    altaEdicion: async (_f, _d, tanda) => { log.push(`edicion ${tanda}`); return { modo: 'real', altas: [], actualizados: [], frenadas: 0, pospuestos: [], avisos: [] } },
    whatsapp: async (_f, problema) => { whatsapp.push(problema ?? null); return { estado: 'manual' } },
    notificar: async () => { log.push('notificar') },
    error: async (_i, _m, dudoso) => { log.push(dudoso ? 'dudoso' : 'error'); return o.intentos ? { intentos: o.intentos } : undefined },
    alertar: async a => { alertas.push(a) },
    ...(o.deps ?? {}),
  } }
}
const dudosa = async () => ({ estado: 'dudoso', motivo: 'el puente no respondió (puede haberla escrito)' })

test('dudosa con intentos por delante: no alerta todavía (la reintenta el vigía), pero el «para enviar» sale con advertencia', async () => {
  const a = publicador({ intentos: 1, deps: { escribir: dudosa } })
  await publicarParaEntrega(31, Date.now() + 1000, a.deps)
  assert.deepEqual(a.log, ['dudoso']); assert.equal(a.alertas.length, 0)
  assert.deepEqual(a.whatsapp, [{ dudoso: true, motivo: 'el puente no respondió (puede haberla escrito)' }])
})

test('dudosa en el último intento: sale la alerta DUDOSA contando los reintentos', async () => {
  const a = publicador({ intentos: MAX_INTENTOS_DUDOSO, deps: { escribir: dudosa } })
  await publicarParaEntrega(31, Date.now() + 1000, a.deps)
  assert.equal(a.alertas.length, 1); assert.match(a.alertas[0].titulo, /DUDOSA/)
  assert.ok(a.alertas[0].lineas.some(l => /reintentó sola 3 veces/.test(l)))
  assert.ok(!a.alertas[0].lineas.some(l => /duplicar la tanda\)/.test(l)))
})

test('un error (no dudoso) alerta enseguida aunque sea el primer intento', async () => {
  const a = publicador({ intentos: 1, deps: { escribir: async () => ({ estado: 'error', motivo: 'ya hay texto que no cargó el bot' }) } })
  await publicarParaEntrega(31, Date.now() + 1000, a.deps)
  assert.equal(a.alertas.length, 1); assert.doesNotMatch(a.alertas[0].titulo, /DUDOSA/)
})

test('el reintento que confirma la carga completa TODO como el camino ok: doc, chips «Para grabar», Edición y 📤 sin advertencia', async () => {
  const a = publicador({ fila: { doc: { id: ID, url: 'x', publicacion: { estado: 'dudoso', cuando: '2026-11-12T14:10:30.135Z', motivo: 'm', intentos: 1 } } } })
  await publicarParaEntrega(31, Date.now() + 300_000, a.deps)
  assert.deepEqual(a.log, ['escribir', 'guardar', 'chips 3x6', 'edicion 3', 'notificar'])
  assert.deepEqual(a.whatsapp, [null]); assert.equal(a.alertas.length, 0)
})

test('reconciliarDudosas: pide las dudosas con el máximo, las publica en orden y frena si no queda tiempo para esperar al puente', async () => {
  const pedidas = [], hechas = []
  const deps = { dudosas: async (max) => { pedidas.push(max); return [31, 40] }, publicar: async (id) => { hechas.push(id) } }
  assert.deepEqual(await reconciliarDudosas(Date.now() + MARGEN_RECONCILIAR_MS + 60_000, deps), [31, 40])
  assert.deepEqual(pedidas, [MAX_INTENTOS_DUDOSO]); assert.deepEqual(hechas, [31, 40])
  hechas.length = 0
  assert.deepEqual(await reconciliarDudosas(Date.now() + 10_000, deps), []); assert.deepEqual(hechas, [])
})

test('plazoEscritura: con el presupuesto del check final espera más que los 90 s de antes, hasta 4 min, nunca menos de 5 s', () => {
  const t0 = 1_000_000
  assert.ok(plazoEscritura(t0 + 250_000, t0 + 5_000) > 90_000)
  assert.equal(plazoEscritura(t0 + 250_000, t0 + 5_000), 215_000)
  assert.equal(plazoEscritura(t0 + 600_000, t0), 240_000)
  assert.equal(plazoEscritura(t0 + 1_000, t0), 5_000)
})

test('alertaFallaPublicacion sin intentos (compatibilidad) no menciona reintentos', () => {
  const a = alertaFallaPublicacion({ id: 9 }, 'x', true)
  assert.ok(!a.lineas.some(l => /reintentó/.test(l)))
})
