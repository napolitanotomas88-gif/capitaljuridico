import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizarBeneficio } from '../lib/clientes/beneficiosFinalizar.ts'
import { beneficioConfirmado, correspondeBeneficio } from '../lib/clientes/beneficiosPendientes.ts'

globalThis.fetch = async () => { throw new Error('Estas pruebas no usan red') }

function repositorio({ fallaCierre = false } = {}) {
  const guardado = { estado: 'pendiente', avisos: [], orden: [] }
  let cola = Promise.resolve()
  const deps = {
    conBloqueo: (_id, trabajo) => {
      const tarea = cola.then(async () => {
        let estado = guardado.estado
        const r = await trabajo({
          estado,
          cerrarAviso: async () => {
            guardado.orden.push('cerrar')
            if (fallaCierre) throw new Error('No respondió la base al cerrar')
            guardado.avisos.forEach(a => { a.hecho = true })
          },
          guardar: async nuevo => { guardado.orden.push(nuevo); estado = nuevo },
        })
        guardado.estado = estado
        return r
      })
      cola = tarea.catch(() => {})
      return tarea
    },
    avisar: async n => { guardado.avisos.push({ ...n, hecho: false }); return 1 },
  }
  return { guardado, deps }
}

test('un preview sombra200ok o una respuesta202 nunca confirma el beneficio de la cola', () => {
  assert.equal(beneficioConfirmado({ status: 200, cuerpo: { ok: true, plan: [] } }), false)
  assert.equal(beneficioConfirmado({ status: 202, cuerpo: { ok: false } }), false)
  assert.equal(beneficioConfirmado({ status: 200, cuerpo: { ok: true, beneficioAplicado: true } }), true)
  assert.equal(correspondeBeneficio({ estado: 'Cerró', idClienteNuevo: 'A149' }, true), true)
  assert.equal(correspondeBeneficio({ estado: 'Cerró', idClienteNuevo: 'A149', reembolso: true }, true), false)
  assert.equal(correspondeBeneficio({ estado: 'Cerró', idClienteNuevo: 'A149' }, false), false)
})

test('cierra exclusivamente la alerta del beneficio antes de pasar su cola a aplicado', async () => {
  const { guardado, deps } = repositorio()
  await finalizarBeneficio('a149', false, 'Revisar evidencia', deps)
  assert.equal(guardado.avisos[0].clave, 'beneficio-referido-pendiente:A149')
  assert.equal(guardado.avisos[0].origen, 'beneficio-referido:A149')
  guardado.orden.length = 0
  const r = await finalizarBeneficio('a149', true, 'Mes incluido', deps)
  assert.deepEqual(guardado.orden, ['cerrar', 'aplicado'])
  assert.equal(guardado.estado, 'aplicado')
  assert.equal(guardado.avisos[0].hecho, true)
  assert.equal(r.pendiente, false)
})

test('si cerrar la alerta falla, conserva el pedido pendiente para que el cron retome', async () => {
  const { guardado, deps } = repositorio({ fallaCierre: true })
  await assert.rejects(finalizarBeneficio('A149', true, 'Mes incluido', deps), /No respondió/)
  assert.equal(guardado.estado, 'pendiente')
  assert.deepEqual(guardado.orden, ['cerrar'])
})

test('un resultado202 concurrente nunca degrada aplicado ni reabre su alerta', async () => {
  for (const confirmadoPrimero of [true, false]) {
    const { guardado, deps } = repositorio()
    const resultados = await Promise.all([
      finalizarBeneficio('A149', confirmadoPrimero, 'Primer resultado', deps),
      finalizarBeneficio('A149', !confirmadoPrimero, 'Segundo resultado', deps),
    ])
    assert.equal(guardado.estado, 'aplicado')
    assert.equal(guardado.avisos.filter(a => !a.hecho).length, 0)
    if (confirmadoPrimero) assert.ok(resultados.every(r => r.ok && !r.pendiente))
  }
})
