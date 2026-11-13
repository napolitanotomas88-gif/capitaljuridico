// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs --test scripts/test-aviso-cuotas-admin.mjs
// Aviso diario de las cuotas que cobra Administración (12/11/2026, lib/crm/cuotas/avisoAdmin.ts): qué cuotas entran (solo
// 'admin', no abandonados, con saldo; hoy, en 2 días o atrasadas; promesa vigente), el mensaje de Discord, los textos para el
// cliente, la idempotencia, el dry, el interruptor, la ruta y el cron. SIN red ni base: fetch bloqueado. Datos inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
delete process.env.AVISO_CUOTAS_ADMIN

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const A = await import('../lib/crm/cuotas/avisoAdmin.ts')
const P = await import('../lib/alertas/personas.ts')
const RUTAS = await import('../lib/auth/rutas.ts')

// 12/11/2026 a las 10:00 de Argentina (13:00 UTC)
const AHORA = new Date('2026-11-12T13:00:00Z')
let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const cuota = (vencimiento, centavos = 30000, extra = {}) => ({ id: uuid(), vencimiento, centavos, pagos: [], gestiones: [], ...extra })
const plan = (cuotas, extra = {}) => ({ id: uuid(), responsable: 'admin', nombre: 'Estudio Ejemplo', telefono: '', concepto: 'renovacion', notas: '', abandonado: false, cuotas, eventos: [], ...extra })
const pago = (centavos) => ({ id: uuid(), centavos, fecha: '2026-11-01', creado: '2026-11-01T12:00:00Z', actor: 'x' })

test('interruptor: AVISO_CUOTAS_ADMIN apagado por defecto; solo «encendido» lo prende', () => {
  assert.equal(A.avisoCuotasAdminEncendido({}), false)
  assert.equal(A.avisoCuotasAdminEncendido({ AVISO_CUOTAS_ADMIN: 'si' }), false)
  assert.equal(A.avisoCuotasAdminEncendido({ AVISO_CUOTAS_ADMIN: ' Encendido ' }), true)
})

test('entran solo las de admin, no abandonadas, con saldo: hoy, 1–2 días y atrasadas', () => {
  const p = plan([
    cuota('2026-11-01', 50000, { inicial: true, pagos: [pago(50000)] }), // fila Pagado: nunca
    cuota('2026-11-05'),                                     // atrasada 7
    cuota('2026-11-12'),                                     // hoy
    cuota('2026-11-13'),                                     // previo 1
    cuota('2026-11-14'),                                     // previo 2
    cuota('2026-11-15'),                                     // 3 días: no
    cuota('2026-11-10', 30000, { pagos: [pago(30000)] }),    // pagada: no
    cuota('2026-11-11', 30000, { pagos: [pago(10000)] }),    // atrasada 1, saldo parcial
  ])
  const otros = [
    plan([cuota('2026-11-12')], { responsable: 'closer-1' }),
    plan([cuota('2026-11-12')], { abandonado: true }),
  ]
  const xs = A.cuotasParaAvisar([p, ...otros], AHORA)
  assert.deepEqual(xs.map((x) => `${x.estado}:${x.dias}`), ['atrasada:7', 'atrasada:1', 'hoy:0', 'previo:1', 'previo:2'])
  assert.deepEqual(xs.map((x) => x.numero), [1, 7, 2, 3, 4], 'la fila Pagado no se numera')
  assert.equal(xs[1].saldo, 20000)
  assert.ok(xs.every((x) => x.planId === p.id))
})

test('promesa vigente: manda la fecha coordinada (no se reclama antes)', () => {
  const lejos = cuota('2026-11-05', 30000, { promesa: '2026-11-20' })
  const cerca = cuota('2026-11-05', 30000, { promesa: '2026-11-13' })
  const hoy = cuota('2026-11-01', 30000, { promesa: '2026-11-12' })
  const xs = A.cuotasParaAvisar([plan([lejos, cerca, hoy])], AHORA)
  assert.deepEqual(xs.map((x) => [x.cuotaId, x.estado, x.dias, x.coordinado]), [[hoy.id, 'hoy', 0, true], [cerca.id, 'previo', 1, true]])
  assert.match(A.lineaCuota(xs[1]), /pago coordinado 13\/11\/2026 \(vencía 05\/11\/2026\)/)
})

test('línea de Discord y textos para el cliente (formal, voseo, sin «anticipo»)', () => {
  const [atr, hoy, prev] = A.cuotasParaAvisar([plan([cuota('2026-11-09', 150000), cuota('2026-11-12'), cuota('2026-11-14')], { concepto: 'venta' })], AHORA)
  assert.match(A.lineaCuota(atr), /Estudio Ejemplo · Venta · cuota 1 · USD\s1\.500,00 · vence 09\/11\/2026 · \*\*atrasada 3 días\*\*/)
  assert.match(A.lineaCuota(hoy), /\*\*vence hoy\*\*/)
  assert.match(A.lineaCuota(prev), /\*\*vence en 2 días\*\*/)
  assert.equal(A.etiquetaEstado({ estado: 'previo', dias: 1 }), 'vence en 1 día')
  assert.equal(A.llevaTexto(prev), false, 'el aviso previo es interno')
  for (const x of [atr, hoy]) {
    const t = A.textoCliente(x)
    assert.doesNotMatch(t, /anticip/i)
    assert.match(t, /envianos el comprobante/)
    assert.doesNotMatch(t, /\btú\b|\benvíanos\b/)
    assert.ok(t.length < 400, t)
  }
  assert.match(A.textoCliente(hoy), /hoy vence la cuota 2 de tu plan de pago/)
  assert.match(A.textoCliente(atr), /con vencimiento el 09\/11\/2026, figura pendiente de pago/)
})

test('mensaje: menciona a Tomás, link a /cuotas y entra en 1.900 caracteres aunque sean muchas', () => {
  const muchas = A.cuotasParaAvisar([plan(Array.from({ length: 40 }, (_, i) => cuota(`2026-10-${String(i % 28 + 1).padStart(2, '0')}`)), { nombre: 'Un cliente con nombre bastante largo para probar' })], AHORA)
  const m = A.plantillaDiscord(muchas, '2026-11-12', 'https://despacho.ejemplo/clientes/para-enviar')
  assert.ok(m.startsWith('{@tomas} {@gero_m} 💳 **Cuotas que cobra Administración · 12/11/2026** (40 atrasadas)'), m.slice(0, 120))
  assert.match(m, /… y \d+ más en el tablero\./)
  assert.match(m, /➡️ <\{link\}>$/)
  assert.ok(m.length < 1800, String(m.length))
})

const deps = (planes, extra = {}) => {
  const registrados = new Map(), alertas = []
  return {
    registrados, alertas,
    d: {
      ahora: () => AHORA, planes: async () => planes, base: 'https://despacho.ejemplo',
      registrar: async (m) => { if (registrados.has(m.claveCompleta)) return null; registrados.set(m.claveCompleta, m); return registrados.size },
      alertar: async (a) => { const ya = alertas.some((x) => x.clave === a.clave); alertas.push(a); return { estado: ya ? 'ya_estaba' : 'enviado' } },
      ...extra,
    },
  }
}

test('corrida: dry no escribe ni manda; real deja los textos (k01) y UN mensaje en 🛠️; repetir no duplica', async () => {
  const planes = [plan([cuota('2026-11-05'), cuota('2026-11-12'), cuota('2026-11-14')])]
  const t = deps(planes)
  const dry = await A.correrAvisoCuotasAdmin(t.d, { dry: true })
  assert.equal(dry.dry, true)
  assert.deepEqual(dry.porEstado, { atrasada: 1, hoy: 1, previo: 1 })
  assert.equal(t.registrados.size, 0)
  assert.equal(t.alertas.length, 0)
  assert.ok(dry.mensaje.includes('<https://despacho.ejemplo/clientes/para-enviar>'))

  const r = await A.correrAvisoCuotasAdmin(t.d)
  assert.equal(r.alerta, 'enviado')
  assert.equal(t.registrados.size, 2, 'solo hoy y atrasada llevan texto')
  for (const m of t.registrados.values()) {
    assert.equal(m.pieza, 'k01')
    assert.equal(m.idCrm, null)
    assert.ok(m.claveCompleta.startsWith('k01:'))
    assert.equal(m.abrir, '/cuotas')
  }
  assert.equal(t.alertas.length, 1)
  const a = t.alertas[0]
  assert.equal(a.canal, 'operaciones')
  assert.equal(a.clave, 'cuotas_admin:2026-11-12')
  assert.deepEqual(a.menciones, ['tomas', 'gero_m'])
  assert.equal(a.link, '/cuotas')

  const otra = await A.correrAvisoCuotasAdmin(t.d)
  assert.equal(otra.alerta, 'ya_estaba')
  assert.equal(t.registrados.size, 2)
  assert.ok(otra.cuotas.filter((c) => c.texto).every((c) => c.paraEnviar === 'ya_estaba'))
})

test('sin nada para avisar: no manda ni registra', async () => {
  const t = deps([plan([cuota('2026-12-01')])])
  const r = await A.correrAvisoCuotasAdmin(t.d)
  assert.equal(r.total, 0)
  assert.equal(r.alerta, undefined)
  assert.equal(t.alertas.length + t.registrados.size, 0)
})

test('si falla el registro de un texto, el aviso sale igual', async () => {
  const t = deps([plan([cuota('2026-11-12')])], { registrar: async () => { throw new Error('base caída') } })
  const r = await A.correrAvisoCuotasAdmin(t.d)
  assert.equal(r.cuotas[0].paraEnviar, 'error')
  assert.equal(t.alertas.length, 1)
})

test('pieza k01 (Pedido de pago de cuota) para Tomás, grupo General', () => {
  assert.ok(P.PIEZAS_CLIENTE.includes('k01'))
  assert.equal(P.NOMBRE_PIEZA.k01, 'Pedido de pago de cuota')
  assert.equal(P.GRUPO_PIEZA.k01, 'General')
  assert.deepEqual(P.responsablesDe('k01', {}), ['tomas'])
})

test('ruta, cron y proxy: solo Bearer CRON_SECRET, 10:05 AR', () => {
  const regla = RUTAS.REGLAS.find((r) => r.patron === '/api/cuotas/aviso-admin')
  assert.equal(regla?.quien, 'propio')
  const crons = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons
  assert.ok(crons.some((c) => c.path === '/api/cuotas/aviso-admin' && c.schedule === '5 13 * * *'))
  const ruta = readFileSync(join(RAIZ, 'app/api/cuotas/aviso-admin/route.ts'), 'utf8')
  assert.match(ruta, /accesoMaquina\(req\.headers\)/)
  assert.doesNotMatch(ruta, /searchParams\.get\('key'\)/)
  assert.match(readFileSync(join(RAIZ, 'proxy.ts'), 'utf8'), /\|cuotas\/aviso-admin\|/)
})
