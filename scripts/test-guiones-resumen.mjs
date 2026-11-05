// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-guiones-resumen.mjs
// Resumen de guiones trabados (5/11/2026): el paso de cada tanda abierta, el orden y la alerta diaria a Gero M, que SOLO lleva
// lo que falta corregir/verificar, el check final y el check que no entró al Doc (pedido de Tomás).
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { pasoDe, tandasPendientes, alertaResumen } = await import('../lib/bot/guiones/resumen.ts')

const AHORA = new Date('2026-11-05T15:00:00Z')
const hace = d => new Date(AHORA.getTime() - d * 86_400_000).toISOString()
const v = { quien: 'Faus', email: 'x@y.z', cuando: hace(0) }
const gs = (verificados, total = 6) => Object.fromEntries(Array.from({ length: total }, (_, i) => [String(i + 1), { estado: 'listo', verificado: i < verificados ? v : null }]))
let n = 0
const fila = (x) => ({ id: ++n, id_crm: `CUENTA_QA${n}`, cliente: `Cliente QA ${n}`, tanda: 1, estado: 'a_revisar', guiones: gs(0), aprobacion: null, doc: null, error: null, actualizado: hace(1), ...x })

test('pasoDe: revisar, a medias, check final, Doc fallido, sin entregar, bot trabado y nada', () => {
  assert.equal(pasoDe(fila({}), AHORA).paso, 'revisar')
  assert.match(pasoDe(fila({}), AHORA).falta, /Ninguno verificado \(6 guiones\)/)
  assert.match(pasoDe(fila({ guiones: gs(4) }), AHORA).falta, /Van 4 de 6: faltan 5 y 6/)
  assert.equal(pasoDe(fila({ guiones: gs(3, 3) }), AHORA).paso, 'check_final')
  const ap = { quien: 'Faus', email: 'x', cuando: hace(1) }
  const fallida = pasoDe(fila({ estado: 'aprobada', aprobacion: ap, doc: { id: 'd', url: 'u', publicacion: { estado: 'error', cuando: hace(1), motivo: 'sin tanda libre' } } }), AHORA)
  assert.equal(fallida.paso, 'doc_fallido'); assert.equal(fallida.falta, 'sin tanda libre'); assert.equal(fallida.dias, 1)
  assert.equal(pasoDe(fila({ estado: 'aprobada', aprobacion: ap, doc: { id: 'd', url: 'u', publicada: ap.cuando } }), AHORA).paso, 'entregar')
  assert.equal(pasoDe(fila({ estado: 'escribiendo', actualizado: hace(0.5) }), AHORA).paso, 'bot_trabado')
  assert.equal(pasoDe(fila({ estado: 'escribiendo', actualizado: new Date(AHORA.getTime() - 600_000).toISOString() }), AHORA).paso, 'armando')
  assert.equal(pasoDe(fila({ estado: 'enviada' }), AHORA), null)
  assert.equal(pasoDe(fila({ estado: 'cerrada' }), AHORA), null)
})

test('tandasPendientes: lo más trabado primero y, dentro del paso, la más vieja; sin ID del CRM no entra', () => {
  const t = tandasPendientes([
    fila({ actualizado: hace(0) }), fila({ actualizado: hace(5) }), fila({ guiones: gs(6) }),
    fila({ estado: 'aprobada', aprobacion: { cuando: hace(1) }, doc: { publicacion: { estado: 'error', cuando: hace(1) } } }),
    fila({ id_crm: null }),
  ], AHORA)
  assert.deepEqual(t.map(x => [x.paso, x.dias]), [['doc_fallido', 1], ['revisar', 5], ['revisar', 0], ['check_final', 1]])
})

test('alertaResumen: solo revisar, check final y Doc fallido; menciona a Gero M; una por día; null si no hay nada de eso', () => {
  const ap = { cuando: hace(2) }
  const t = tandasPendientes([
    fila({ cliente: 'Ariel QA', actualizado: hace(0) }), fila({ cliente: 'Flor QA', guiones: gs(3, 3) }),
    fila({ cliente: 'Bauti QA', estado: 'aprobada', aprobacion: ap, doc: { publicacion: { estado: 'error', cuando: hace(1), motivo: 'sin tanda libre' } } }),
    fila({ cliente: 'Entrega QA', estado: 'aprobada', aprobacion: ap, doc: { publicada: ap.cuando } }),
    fila({ cliente: 'Error QA', estado: 'error' }),
  ], AHORA)
  const a = alertaResumen(t, 'https://despacho.test/', '2026-11-05')
  assert.equal(a.canal, 'guiones'); assert.deepEqual(a.menciones, ['gero_m']); assert.equal(a.clave, 'guiones_resumen:2026-11-05')
  assert.match(a.titulo, /^Guiones: 3 tandas/)
  const texto = a.lineas.join('\n')
  assert.match(a.lineas[0], /Check dado, pero no entró al Doc.*Bauti QA.*sin tanda libre/)
  assert.match(a.lineas[1], /Falta revisar.*Ariel QA.*hoy/)
  assert.match(a.lineas[2], /Falta el check final.*Flor QA/)
  assert.doesNotMatch(texto, /Entrega QA|Error QA/)
  assert.equal(a.lineas.at(-1), 'Detalle y links: <https://despacho.test/guiones>')
  assert.ok(a.lineas.length <= 6)
  assert.equal(alertaResumen(tandasPendientes([fila({ estado: 'error' })], AHORA), 'x', 'd'), null)
})
