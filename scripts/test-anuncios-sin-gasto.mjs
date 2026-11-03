// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-anuncios-sin-gasto.mjs
// Por qué no gasta un cliente del tablero (lib/anuncios/sinGasto.ts) y la pausa que se lee de las acciones (pausas.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
const S = await import('../lib/anuncios/sinGasto.ts')
const P = await import('../lib/anuncios/pausas.ts')

const fila = (o = {}) => ({ pausado: false, semaforo: 'sin_gasto', pago: { errorPago: false, sinMedioPago: false, texto: '', periodoGracia: false }, corriendo: { sinAnunciosActivos: false }, ...o })

test('pausa del cliente: con fecha, con condición, sin nada', () => {
  assert.equal(S.causaSinGasto(fila(), { desde: '2026-11-01', hasta: '2026-11-20', vuelta: null, motivo: 'Vacaciones' }).texto, 'Pausado hasta 20/11 · Vacaciones')
  assert.equal(S.causaSinGasto(fila(), { desde: '2026-11-01', hasta: null, vuelta: 'cuando agende la proyección', motivo: null }).texto, 'Pausado · cuando agende la proyección')
  assert.equal(S.causaSinGasto(fila({ pausado: true }), null).texto, 'Pausado · sin fecha de vuelta')
  assert.equal(S.causaSinGasto(fila({ pausado: true, semaforo: 'verde' }), null).tipo, 'pausa')   // pausado en el CRM aunque siga gastando
})

test('sin pausa: la causa en Meta, en orden', () => {
  assert.match(S.causaSinGasto(fila({ pago: { errorPago: true, sinMedioPago: false, texto: 'error de pago: deuda sin saldar', periodoGracia: false } }), null).texto, /^Error de pago: deuda/)
  assert.equal(S.causaSinGasto(fila({ pago: { errorPago: false, sinMedioPago: true, texto: '', periodoGracia: false } }), null).tipo, 'sin_medio_pago')
  assert.equal(S.causaSinGasto(fila({ corriendo: { sinAnunciosActivos: true } }), null).texto, 'Campañas en pausa en Meta')
  assert.equal(S.causaSinGasto(fila(), null).tipo, 'sin_gasto')
  assert.equal(S.causaSinGasto(fila({ semaforo: 'verde' }), null), null)
})

test('pausaDeFila: la última acción manda; un reanudar corta la pausa', () => {
  assert.deepEqual(P.pausaDeFila({ tipo: 'pausa', datos: { desde: '2026-11-02', hasta: '2026-12-01', motivo: ' sin plata ' }, creada: '2026-11-02T10:00:00Z' }),
    { desde: '2026-11-02', hasta: '2026-12-01', vuelta: null, motivo: 'sin plata' })
  assert.equal(P.pausaDeFila({ tipo: 'reanudar', datos: {}, creada: '2026-11-03T10:00:00Z' }), null)
  assert.equal(P.pausaDeFila({ tipo: 'pausa', datos: {}, creada: new Date('2026-11-02T10:00:00Z') }).desde, '2026-11-02')
})

test('pausado con deuda, motivo sin referencias internas y arranque de hoy', () => {
  const t = S.causaSinGasto(fila({ pausado: true, pago: { errorPago: true, sinMedioPago: false, texto: 'error de pago', periodoGracia: false } }), { desde: '2026-11-01', hasta: null, vuelta: null, motivo: 'Pausa pedida por Tomás en sombra (ac_mvth6gs6 x)' }).texto
  assert.equal(t, 'Pausado · sin fecha de vuelta · Pausa pedida por Tomás · deuda en Meta')
  assert.equal(S.causaSinGasto(fila({ gasto: { hoy: 1.15 } }), null).texto, 'Empezó a gastar hoy')
})
