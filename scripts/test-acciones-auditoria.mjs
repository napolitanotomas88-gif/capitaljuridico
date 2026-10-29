// Auditoría independiente de límites de autorización y conservación de datos. Sin red ni base real.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ejecutarAccion } from '../lib/clientes/acciones/servidor.ts'
import { huellaAccion } from '../lib/clientes/acciones/durable.ts'
import { planExtra, estaArchivado } from '../lib/clientes/acciones/planesNuevos.ts'
import { congelarPlan, estadoPlan } from '../lib/clientes/acciones/escritor.ts'
import { planServicio } from '../lib/clientes/acciones/plan.ts'
import { ymdASerial } from '../lib/clientes/fechas.ts'

delete process.env.DATABASE_URL
globalThis.fetch = async () => { throw new Error('La auditoría no usa red') }
const cliente = { id: 'Z001', nombre: 'PRUEBA BOT Auditoría', estado: 'ACTIVO', linea: 'agencia', fila: 2, anotaciones: '', notasRenov: '', fechaBaja: null, finPeriodo: '2027-02-10', periodos: [] }

test('un replay idempotente no puede saltar el permiso financiero de Próximo cobro', async () => {
  process.env.CLIENTES_ESCRITURA = 'prueba'
  const cuerpo = { tipo: 'datos', cambios: [{ campo: 'proximoCobro', valor: '2026-11-14' }], clave: 'auditoria-replay-finanzas' }
  let accesos = 0
  const deps = { buscar: async () => { accesos++; return { huella: huellaAccion(cuerpo), accion: { tipo: 'datos', estado: 'aplicada', datos: cuerpo, plan: [], resumen: 'Editar Próximo cobro' } } } }
  try {
    const r = await ejecutarAccion(cliente, cuerpo, 'Equipo sin Finanzas', false, { deps })
    assert.equal(r.status, 403)
    assert.equal(accesos, 0, 'el permiso se valida antes de resolver un intento previo')
  } finally { delete process.env.CLIENTES_ESCRITURA }
})

test('archivar y restaurar nunca reactiva un finalizado/inactivo ni pierde su fecha de baja previa', () => {
  for (const estado of ['FINALIZADO', 'INACTIVO', '']) {
    const original = { ...cliente, estado, fechaBaja: '2026-09-01' }
    const p = planExtra(original, { tipo: 'archivar', confirmado: true, confirmacion: original.nombre, motivo: 'Ocultar tarjeta' }, 'ac_auditoria1', '2026-10-28')
    if (typeof p === 'string') continue // Rechazar ese archivo también preserva el estado previo.
    const archivado = { ...original }
    for (const x of p.valores) archivado[x.campo] = x.valor
    const restaurar = planExtra(archivado, { tipo: 'restaurar' }, 'ac_auditoria2', '2026-10-28')
    assert.notEqual(typeof restaurar, 'string')
    const restaurado = { ...archivado }
    for (const x of restaurar.valores) restaurado[x.campo] = x.valor
    assert.equal(restaurado.estado, estado)
    assert.equal(restaurado.fechaBaja, original.fechaBaja)
  }
})

test('una marca histórica de archivo resuelta no vuelve a ocultar al cliente si finaliza después', () => {
  const anotaciones = '[[ARCHIVADO:ac_primero estado=ACTIVO]] 2026-09-01\n[[RESTAURADO:ac_segundo]] 2026-09-02'
  assert.equal(estaArchivado({ estado: 'FINALIZADO', anotaciones }), false)
})

test('sumar servicio acepta el fin vigente de Agencia cuando no hay períodos en Renovaciones', async () => {
  const head = ['ID', 'Nombre', 'Estado', 'Fin período actual', 'Notas renovación']
  const rh = ['ID Cliente', 'Nombre', 'Período (0=inicial)', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses (vacío = 120 días)']
  for (const finCelda of [ymdASerial(cliente.finPeriodo), cliente.finPeriodo, '10/2/2027']) {
    const hojas = { Agencia: [head, [cliente.id, cliente.nombre, 'ACTIVO', finCelda, '']], Renovaciones: [rh] }
    const l = { cliente, agencia: hojas.Agencia, renovaciones: hojas.Renovaciones, ids: { Agencia: 0, Renovaciones: 1 } }
    const frozen = congelarPlan(l, planServicio(cliente, { tipo: 'servicio', duracion: '1m' }, 'ac_auditoria3'), 2)
    const planilla = { leer: async rangos => rangos.map(r => {
      const m = /^'([^']+)'!([A-Z]+)(\d+)$/.exec(r)
      if (!m) return hojas[r.includes('Renovaciones') ? 'Renovaciones' : 'Agencia']
      const col = [...m[2]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
      return [[hojas[m[1]][Number(m[3]) - 1]?.[col] ?? '']]
    }) }
    assert.equal(await estadoPlan(planilla, frozen), 'antes', `fecha fuente: ${finCelda}`)
  }
})
