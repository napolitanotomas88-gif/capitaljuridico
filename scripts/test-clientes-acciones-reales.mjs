// Acciones reales con Sheets y reservas durables simulados. Nunca usa credenciales ni hace red.
import { test, describe, after } from 'node:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { leerClienteFresco, congelarPlan, aplicarPlan, estadoPlan, pisoRenovaciones, clasificacionPago, filasFinanzasDelCliente, coincideFilaPagoMarcada } from '../lib/clientes/acciones/escritor.ts'
import { planDatos } from '../lib/clientes/acciones/campos.ts'
import { textoLiteral } from '../lib/bot/alta/finanzasEscribir.ts'
import { PESTANA_CREDITOS, PESTANA_REFERIDOS } from '../lib/clientes/pestanasNuevas.ts'
import { leerCreditosRenovacion } from '../lib/clientes/acciones/renovacionReferidos.ts'
import { resumenRenovacion } from '../lib/clientes/acciones/resumenRenovacion.ts'
import { MARCA_CANJE_SOLO_MESES } from '../lib/clientes/canjeMeses.ts'
import { planServicio, planPausa, planReanudar } from '../lib/clientes/acciones/plan.ts'
import { planExtra, evidenciaBeneficioReferido, estaArchivado } from '../lib/clientes/acciones/planesNuevos.ts'
import { ejecutarAccion, deshacerAccion, aplicarBeneficioReferido, leerCuerpoAccion, accionesParaPersona } from '../lib/clientes/acciones/servidor.ts'
import { idDesdeClave, huellaAccion } from '../lib/clientes/acciones/durable.ts'
import { ymdASerial, sumarMeses, sumarDias } from '../lib/clientes/fechas.ts'

globalThis.fetch = async () => { throw new Error('No se permite red en estas pruebas') }
delete process.env.DATABASE_URL
const HEAD = ['ID', 'Nombre', 'Estado', 'Día 1', 'Fin período actual', 'Notas renovación', 'Anotaciones', 'Fecha de baja', 'Llamada agendada', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Satisfacción', 'Próximo cobro']
const RH = ['ID Cliente', 'Nombre', 'Período (0=inicial)', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses (vacío = 120 días)']
function planillaFake() {
  const hojas = { Agencia: [HEAD, ['Z001', 'PRUEBA BOT Acciones', 'ACTIVO', ymdASerial('2026-10-13'), '=MAX(Renovaciones!E2:E)', '', '', '', '', '+5491100000000', 'prueba@example.test', 'Carlos', 'Referido', 'Firmado', 8, '']], Consultora: [HEAD], Renovaciones: [RH, ['Z001', 'PRUEBA BOT Acciones', 0, ymdASerial('2026-10-13'), ymdASerial('2027-02-10'), 2600, 'Inicial', '']], Referidos: [PESTANA_REFERIDOS.columnas.map(c => c.encabezado)], 'Créditos': [PESTANA_CREDITOS.columnas.map(c => c.encabezado)] }
  const writes = []
  const valor = (hoja, fila, col, render) => {
    const v = hojas[hoja]?.[fila]?.[col]
    if (render === 'UNFORMATTED_VALUE' && hoja !== 'Renovaciones' && hojas[hoja][0][col] === 'Fin período actual' && typeof v === 'string' && v.startsWith('=')) {
      const id = hojas[hoja][fila][hojas[hoja][0].indexOf('ID')]
      return Math.max(...hojas.Renovaciones.slice(1).filter(r => r[0] === id).map(r => Number(r[4])))
    }
    return v ?? ''
  }
  const p = {
    async ids() { return { Agencia: 0, Renovaciones: 1, Consultora: 2, Referidos: 3, Créditos: 4 } },
    async leer(rangos, render = 'FORMULA') {
      return rangos.map(range => {
        const m = /^'([^']+)'!([A-Z]+)(\d+)$/.exec(range)
        if (!m) {
          const h = /^'([^']+)'!/.exec(range)?.[1]
          return hojas[h].map((r, i) => r.map((_, j) => valor(h, i, j, render)))
        }
        const col = [...m[2]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
        return [[valor(m[1], Number(m[3]) - 1, col, render)]]
      })
    },
    async escribir(celdas, _ids, reversa) {
      writes.push(structuredClone(celdas))
      for (const c of celdas) {
        const m = /^'([^']+)'!([A-Z]+)(\d+)$/.exec(c.range)
        const col = [...m[2]].reduce((n, x) => n * 26 + x.charCodeAt(0) - 64, 0) - 1
        const row = Number(m[3]) - 1
        while (hojas[m[1]].length <= row) hojas[m[1]].push([])
        hojas[m[1]][row][col] = reversa ? c.antes : c.despues
      }
    },
  }
  return { p, hojas, writes }
}
async function contexto() { const f = planillaFake(); return { ...f, l: await leerClienteFresco('Z001', f.p) } }
function repositorio(f, opciones = {}) {
  const ops = new Map(), enviados = new Set(), reversas = new Set(), pagos = new Set(), canjes = new Map(); let pagosEscritos = 0
  const historial = async () => [...ops.values()].map(x => x.accion).reverse()
  return { ops, canjes, get pagosEscritos() { return pagosEscritos }, deps: {
    historial,
    creditos: (id, l, p) => leerCreditosRenovacion(id, l, p, { hoy: '2026-10-29' }),
    liberarEnvioAntesDeSheets: async id => { enviados.delete(id) },
    planilla: f.p,
    leerFresco: id => leerClienteFresco(id, f.p),
    buscar: async id => ops.get(id) ?? null,
    reservar: async (n, clave, huella, piso, construir, pedidoCanje) => {
      if (ops.has(n.id)) return ops.get(n.id)
      if ([...ops.values()].some(x => x.accion.estado === 'registrada' || x.resultado.deshaciendo)) throw Object.assign(new Error('Otra acción pendiente'), { codigo: 'cliente_con_accion_pendiente' })
      if (pedidoCanje && canjes.has(pedidoCanje.cicloClave)) throw Object.assign(new Error('Canje concurrente'), { codigo: 'canje_concurrente' })
      const canje = pedidoCanje ? { ...pedidoCanje, fila: pedidoCanje.pisoFila, idNumero: pedidoCanje.pisoIdNumero + 1, id: `M${String(pedidoCanje.pisoIdNumero + 1).padStart(3, '0')}`, estado: 'pendiente', resultado: null } : undefined
      const resultado = construir(piso, canje)
      const o = { huella, resultado, accion: { ...n, creada: new Date().toISOString(), aplicada: null, anulada: null, error: null, esDeshacible: n.tipo !== 'pago' && !canje } }
      if (canje) canjes.set(pedidoCanje.cicloClave, canje)
      ops.set(n.id, o); return o
    },
    tomarEnvio: async id => { if (enviados.has(id)) return false; enviados.add(id); return true },
    confirmar: async id => { const o = ops.get(id);if (o.resultado.canje) o.resultado.canje.estado = 'confirmada';o.accion.estado = 'aplicada';o.accion.aplicada = new Date().toISOString();o.accion.renovacionReferidos = resumenRenovacion(o.resultado);return o.accion },
    error: async () => {}, rechazar: async id => { const o = ops.get(id);o.accion.estado = 'error';if(o.resultado.canje)canjes.delete(o.resultado.canje.cicloClave) },
    pago: async (_c, b) => ({ fila: { celdas: { B: b.programa, K: b.fuente, H: b.setter, A: ymdASerial(b.fecha), C: 'PRUEBA BOT Acciones', E: b.usd, J: b.concepto, R: b.cuenta } }, duplicado: null }),
    escribirPago: async id => { pagosEscritos++;if (opciones.pagoIncierto) throw new Error('Timeout');pagos.add(id) },
    pagoConfirmado: async id => pagos.has(id),
  }, reversaDeps: {
    historial, planilla: f.p,
    reservar: async (_id, id) => { const o = ops.get(id); o.resultado.deshaciendo = true; return o },
    tomarEnvio: async id => { if (reversas.has(id)) return false; reversas.add(id); return true },
    cancelar: async id => { delete ops.get(id).resultado.deshaciendo; reversas.delete(id) },
    confirmar: async id => { const o = ops.get(id);o.accion.estado = 'anulada';delete o.resultado.deshaciendo;return o.accion },
  } }
}
const servicio = { tipo: 'servicio', duracion: '1m', clave: 'prueba-mes-0001' }
const casosRenovacion = []
after(() => {
  const ruta = fileURLToPath(new URL('../../qa-hub/renovacion-referidos-fakes.json', import.meta.url))
  mkdirSync(dirname(ruta), { recursive: true, mode: 0o700 })
  writeFileSync(ruta, JSON.stringify({ tipo: 'deps falsas; sin red ni producción', ok: casosRenovacion.length === 5, casos: casosRenovacion }, null, 2), { mode: 0o600 })
})

function conCreditos(f) {
  const ref = (id, estado, fecha, pago = '') => [id, ymdASerial('2026-10-01'), 'Post-kickoff', 'Z001', `LEAD FICTICIO ${id}`, `549119999${id.slice(1)}`, `${id}@example.test`, `ESTUDIO FICTICIO ${id}`, estado, ymdASerial(fecha), pago ? 'A999' : '', pago ? ymdASerial(pago) : '', '', 'NO', '', 'QA', 'PRUEBA BOT Acciones']
  f.hojas.Referidos.push(ref('R001', 'Cerró', '2026-10-01', '2026-10-01'), ref('R002', 'No cerró', '2026-10-03'), ref('R003', 'No cerró', '2026-10-04'))
  f.hojas['Créditos'].push(['M001', ymdASerial('2026-10-15'), 'Z001', 'ganado_cierre', 'R001', 1, '', ymdASerial('2027-10-15'), '', 'QA', 'QA'])
  return f
}
async function revisarRenovacion(f, repo, clave = 'renovacion-auto-0001') {
  const b = { tipo: 'renovacion', inicio: '2027-02-10', meses: 4, precio: 2600, clave }
  const r = await ejecutarAccion(f.l.cliente, { ...b, revisar: true }, 'Equipo', true, { deps: repo.deps })
  assert.equal(r.status, 200, r.cuerpo.mensaje)
  return { preview: r, cuerpo: { ...b, referidosEsperados: r.cuerpo.renovacionReferidos.huella } }
}
describe('renovación y canje automático indivisible', () => {
  const abrir = async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba';process.env.CRM_ESCRITURA_CANJE = 'real';process.env.REFERIDOS_HMAC_SECRET = 'solo-pruebas-no-es-secreto'.repeat(2)
    return conCreditos(await contexto())
  }
  after(() => { delete process.env.CLIENTES_ESCRITURA;delete process.env.CRM_ESCRITURA_CANJE;delete process.env.REFERIDOS_HMAC_SECRET })
  test('preview muestra4+1, confirmar escribe ambas hojas en un lote, conservaUSD300 y bloquea undo', async () => {
    const f = await abrir(), repo = repositorio(f), { preview, cuerpo } = await revisarRenovacion(f, repo)
    assert.deepEqual([preview.cuerpo.renovacionReferidos.mesesContratados, preview.cuerpo.renovacionReferidos.mesesReferidos, preview.cuerpo.renovacionReferidos.mesesTotales, preview.cuerpo.renovacionReferidos.usdPendiente], [4, 1, 5, 300])
    assert.equal(f.writes.length, 0);assert.equal(repo.canjes.size, 0)
    const r = await ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps })
    assert.equal(r.status, 200, r.cuerpo.mensaje)
    assert.equal(f.writes.length, 1)
    assert.ok(f.writes[0].some(c => c.range.includes('Renovaciones')) && f.writes[0].some(c => c.range.includes('Créditos')))
    assert.equal((await leerClienteFresco('Z001', f.p)).cliente.finPeriodo, '2027-07-10')
    const ctx = await repo.deps.creditos('Z001', await leerClienteFresco('Z001', f.p), f.p)
    assert.equal(ctx.resumen.mesesGanados, 0);assert.equal(ctx.resumen.usd.disponible, 300)
    assert.equal(f.hojas['Créditos'][2][6], MARCA_CANJE_SOLO_MESES)
    assert.equal(f.hojas['Créditos'][2][5], -1)
    assert.equal(r.cuerpo.accion.esDeshacible, false)
    assert.equal((await deshacerAccion('Z001', r.cuerpo.accion.id, 'Equipo', true, { deps: repo.reversaDeps })).status, 409)
    assert.equal(f.writes.length, 1)
    casosRenovacion.push('preview4+1; lote único; USD300 intactos; undo409')
  })
  test('respuesta perdida se reconcilia con la misma clave y no reescribe servicio ni canje', async () => {
    const f = await abrir(), repo = repositorio(f), { cuerpo } = await revisarRenovacion(f, repo)
    const escribir = f.p.escribir.bind(f.p)
    f.p.escribir = async (...a) => { await escribir(...a);throw new Error('Respuesta perdida') }
    assert.equal((await ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps })).status, 202)
    const r = await ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps })
    assert.equal(r.status, 200)
    assert.equal(f.writes.length, 1);assert.equal(repo.canjes.size, 1)
    assert.equal(r.cuerpo.renovacionReferidos.mesesReferidos, 1)
    casosRenovacion.push('respuesta perdida; replay0 escrituras')
  })
  test('doble confirmación y canje manual concurrente no consumen dos veces', async () => {
    const f = await abrir(), repo = repositorio(f), { cuerpo } = await revisarRenovacion(f, repo)
    const rs = await Promise.all([ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps }), ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps })])
    assert.ok(rs.some(r => r.status === 200));assert.equal(f.writes.length, 1);assert.equal(repo.canjes.size, 1)
    const g = await abrir(), ocupado = repositorio(g), p = await revisarRenovacion(g, ocupado)
    ocupado.canjes.set('', { estado: 'pendiente', id: 'M002', origen: 'canje manual' })
    const r = await ejecutarAccion(g.l.cliente, p.cuerpo, 'Equipo', true, { deps: ocupado.deps })
    assert.equal(r.status, 409);assert.equal(g.writes.length, 0);assert.equal(ocupado.ops.size, 0)
    casosRenovacion.push('doble confirmación1 lote; canje manual concurrente409')
  })
  test('cambio de saldo antes y después de reservar pide revisión y no consume servicio ni crédito', async () => {
    for (const despuesDeReserva of [false, true]) {
      const f = await abrir(), repo = repositorio(f), { cuerpo } = await revisarRenovacion(f, repo)
      if (despuesDeReserva) {
        const reservar = repo.deps.reservar
        repo.deps.reservar = async (...a) => { const op = await reservar(...a);f.hojas.Referidos[1][13] = 'SI';return op }
      } else f.hojas.Referidos[1][13] = 'SI'
      const r = await ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps })
      assert.equal(r.status, 409);assert.equal(r.cuerpo.codigo, 'referidos_cambiaron')
      assert.equal(f.writes.length, 0);assert.equal(repo.canjes.size, 0)
    }
    casosRenovacion.push('saldo cambiado: revisión409 sin servicio ni consumo')
  })
  test('fallo de lectura antes de enviar conserva reserva y permite retomar sin duplicar', async () => {
    const f = await abrir(), repo = repositorio(f), { cuerpo } = await revisarRenovacion(f, repo)
    const leer = repo.deps.creditos;let n = 0
    repo.deps.creditos = (...a) => { if (++n === 2) throw new Error('No respondió la lectura de preflight');return leer(...a) }
    assert.equal((await ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps })).status, 202)
    assert.equal(f.writes.length, 0);assert.equal(repo.canjes.size, 1)
    assert.equal((await ejecutarAccion(f.l.cliente, cuerpo, 'Equipo', true, { deps: repo.deps })).status, 200)
    assert.equal(f.writes.length, 1);assert.equal(repo.canjes.size, 1)
    casosRenovacion.push('preflight sin envío: reserva retomada y1 lote')
  })
})

describe('escritor CRM', () => {
  test('un ID repetido entre Agencia y Consultora frena toda escritura', async () => {
    const f = planillaFake()
    f.hojas.Consultora.push([...f.hojas.Agencia[1]])
    await assert.rejects(leerClienteFresco('Z001', f.p), /ID duplicado/)
    assert.equal(f.writes.length, 0)
  })
  test('Consultora resuelve por presencia, respeta columnas distintas y permite escribir, verificar y deshacer cada acción', async () => {
    for (const id of ['C777', 'A777']) {
      const f = planillaFake()
      const original = Object.fromEntries(HEAD.map((h, i) => [h, f.hojas.Agencia[1][i]]))
      original.ID = id
      const coHead = [...HEAD].reverse()
      f.hojas.Consultora = [coHead, coHead.map(h => original[h])]
      f.hojas.Agencia = [HEAD]
      f.hojas.Renovaciones[1][0] = id
      const l = await leerClienteFresco(id, f.p)
      assert.equal(l.cliente.linea, 'consultora', 'el prefijo no decide la hoja')
      const planes = [
        c => planDatos(c, { tipo: 'datos', cambios: [{ campo: 'mail', valor: 'consultora@example.test' }] }, false),
        c => planExtra(c, { tipo: 'proyeccion', estado: 'agendada', fecha: '2026-10-28' }, 'ac_consulta1'),
        c => planExtra(c, { tipo: 'archivar', confirmado: true, confirmacion: c.nombre, motivo: 'Archivo de prueba' }, 'ac_consulta2'),
        c => planPausa(c, { tipo: 'pausa' }, '2026-10-28', null),
        c => planServicio(c, { tipo: 'servicio', duracion: '1m' }, 'ac_consulta3'),
        c => planExtra(c, { tipo: 'renovacion', inicio: c.finPeriodo, meses: 4, precio: 447 }, 'ac_consulta4', '2026-10-28', true),
      ]
      for (const crear of planes) {
        const actual = await leerClienteFresco(id, f.p), plan = crear(actual.cliente)
        assert.notEqual(typeof plan, 'string')
        assert.ok(plan.plan.every(x => !x.hoja.includes('Agencia')))
        const p = congelarPlan(actual, plan, plan.extension || plan.renovacion ? pisoRenovaciones(actual) : null)
        assert.equal(p.identidad.range, "'Consultora'!P2")
        assert.ok(p.celdas.every(x => !x.range.includes('Agencia')))
        await aplicarPlan(f.p, p, actual.ids)
        assert.equal(await estadoPlan(f.p, p), 'despues')
        if (plan.valores?.some(x => x.campo === 'estado' && x.valor === 'FINALIZADO')) {
          const archivado = await leerClienteFresco(id, f.p)
          const restaurar = congelarPlan(archivado, planExtra(archivado.cliente, { tipo: 'restaurar' }, 'ac_consulta5'), null)
          await aplicarPlan(f.p, restaurar, archivado.ids)
          assert.equal((await leerClienteFresco(id, f.p)).cliente.estado, 'ACTIVO')
          await aplicarPlan(f.p, restaurar, archivado.ids, true)
        }
        await aplicarPlan(f.p, p, actual.ids, true)
        assert.equal(await estadoPlan(f.p, p), 'antes')
      }
      const base = await leerClienteFresco(id, f.p)
      const pausa = congelarPlan(base, planPausa(base.cliente, { tipo: 'pausa', desde: '2026-10-14' }, '2026-10-28', null), null)
      await aplicarPlan(f.p, pausa, base.ids)
      const pausado = await leerClienteFresco(id, f.p)
      const reanudar = congelarPlan(pausado, planReanudar(pausado.cliente, { tipo: 'reanudar' }, '2026-10-28', { desde: '2026-10-14', dias: 14, accionId: 'p', modo: 'real' }, 'ac_consulta6'), pisoRenovaciones(pausado))
      await aplicarPlan(f.p, reanudar, pausado.ids)
      assert.equal((await leerClienteFresco(id, f.p)).cliente.finPeriodo, '2027-02-24')
      await aplicarPlan(f.p, reanudar, pausado.ids, true)
      await aplicarPlan(f.p, pausa, base.ids, true)
      assert.equal((await leerClienteFresco(id, f.p)).cliente.estado, 'ACTIVO')
      assert.equal(f.hojas.Agencia.length, 1, 'nunca escribió una fila en Agencia')
    }
  })
  test('lee valores calculados para planificar y fórmulas para no pisarlas; extiende un mes calendario', async () => {
    const { l, p, writes } = await contexto()
    assert.equal(l.cliente.finPeriodo, '2027-02-10')
    const plan = planServicio(l.cliente, servicio, 'ac_12345678')
    const frozen = congelarPlan(l, plan, pisoRenovaciones(l))
    assert.ok(!frozen.celdas.some(c => c.range === "'Agencia'!E2"))
    await aplicarPlan(p, frozen, l.ids)
    assert.equal((await leerClienteFresco('Z001', p)).cliente.finPeriodo, '2027-03-10')
    await aplicarPlan(p, frozen, l.ids)
    assert.equal(writes.length, 1, 'no repite una escritura ya aplicada')
    await aplicarPlan(p, frozen, l.ids, true)
    assert.equal((await leerClienteFresco('Z001', p)).cliente.finPeriodo, '2027-02-10')
  })
  test('si el ID se movió de fila o una celda cambió, no escribe ni deshace encima de datos ajenos', async () => {
    const { l, p, hojas, writes } = await contexto()
    const frozen = congelarPlan(l, planPausa(l.cliente, { tipo: 'pausa' }, '2026-10-28', null), null)
    hojas.Agencia[1][0] = 'A123'
    await assert.rejects(aplicarPlan(p, frozen, l.ids), /datos cambiaron/)
    assert.equal(writes.length, 0)
    hojas.Agencia[1][0] = 'Z001'
    await aplicarPlan(p, frozen, l.ids)
    hojas.Agencia[1][5] = 'Nota escrita a mano después'
    await assert.rejects(aplicarPlan(p, frozen, l.ids, true), /datos cambiaron/)
    assert.equal(writes.length, 1)
  })
  test('una extensión calculada antes de otra renovación se rechaza, no crea un período superpuesto', async () => {
    const { l, p, hojas, writes } = await contexto()
    const frozen = congelarPlan(l, planServicio(l.cliente, servicio, 'ac_12345678'), 4)
    hojas.Renovaciones.push(['Z001', l.cliente.nombre, 1, ymdASerial('2027-02-10'), ymdASerial('2027-03-10'), 0, 'Otro movimiento', 1])
    assert.equal(await estadoPlan(p, frozen), 'conflicto')
    await assert.rejects(aplicarPlan(p, frozen, l.ids), /datos cambiaron/)
    assert.equal(writes.length, 0)
  })
  test('una fórmula en un campo editable y una fila de renovación ocupada frenan el lote completo', async () => {
    const { l } = await contexto()
    l.agencia[1][5] = '=NOW()'
    assert.throws(() => congelarPlan(l, planPausa(l.cliente, { tipo: 'pausa' }, '2026-10-28', null), null), /fórmula/)
    assert.throws(() => congelarPlan(l, planServicio(l.cliente, servicio, 'ac_12345678'), 2), /ocupada/)
  })
})

describe('reglas nuevas y privacidad', () => {
  test('una marca de pago no confirma la acción si cambió el teléfono que determina su identidad financiera', () => {
    const esperado = { celdas: { A: 46323, B: 'DFY | PIF | $2600', C: 'CLIENTE PRUEBA', D: '+549110000111', E: 1, H: null, J: 'PIF', K: 'Referido', N: 'Front-end', O: 'Upfront', R: 'Empresa' } }
    const columnas = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R']
    const leida = columnas.map(k => esperado.celdas[k] ?? '')
    assert.equal(coincideFilaPagoMarcada(leida, esperado, textoLiteral), true)
    esperado.celdas.D = "'" + esperado.celdas.D
    assert.equal(coincideFilaPagoMarcada(leida, esperado, textoLiteral), true, 'usa la misma normalización del escritor de Finanzas')
    leida[3] = '+549110000222'
    assert.equal(coincideFilaPagoMarcada(leida, esperado, textoLiteral), false)
  })
  test('tipo de venta es independiente de cuota y modalidad del programa define el tipo de pago', () => {
    const h = n => { const fila = []; fila[13] = n; return fila }
    assert.deepEqual(clasificacionPago({ concepto: '2da Cuota', tipoVenta: 'Front-end' }, 'DFY | PIF | $2600', []), { tipoVenta: 'Front-end', tipoPago: 'Upfront' })
    assert.deepEqual(clasificacionPago({ concepto: 'PIF', tipoVenta: 'Back-end' }, 'DFY | PIF | $2600', []), { tipoVenta: 'Back-end', tipoPago: 'Upfront' })
    assert.deepEqual(clasificacionPago({ concepto: 'Renovación', tipoVenta: 'Back-end' }, 'DWY | PP | $600', []), { tipoVenta: 'Back-end', tipoPago: 'Payment Plan' })
    assert.equal(clasificacionPago({ concepto: '3ra Cuota' }, 'DWY | PP | $600', [h('Front-end'), h('Front-end')]).tipoVenta, 'Front-end')
    assert.throws(() => clasificacionPago({ concepto: '2da Cuota' }, 'DFY | PP | $3000', [h('Front-end'), h('Back-end')]), /tipo de venta/)
    assert.throws(() => clasificacionPago({ concepto: 'Renovación' }, 'DFY | PIF | $2600', [h('Back-end')]), /explícitamente/)
    assert.throws(() => clasificacionPago({ concepto: 'Fee', tipoVenta: 'Front-end' }, 'Fee', []), /modalidad única/)
  })
  test('inferencia financiera comparte identidad del saldo y rechaza nombre/teléfono cruzados de dos clientes', () => {
    const clientes = [{ id: 'A1', nombre: 'Ana Peña', celular: '+549110000111' }, { id: 'C2', nombre: 'Ana Pena', celular: '+549110000222' }]
    const fila = []; fila[2] = 'ANA PEÑA'; fila[3] = '+549110000111'
    assert.equal(filasFinanzasDelCliente(clientes[0], [[], fila], clientes).length, 1)
    assert.equal(filasFinanzasDelCliente(clientes[1], [[], fila], clientes).length, 0)
    const cruzada = [...fila]; cruzada[3] = clientes[1].celular
    assert.throws(() => filasFinanzasDelCliente(clientes[0], [[], cruzada], clientes), /identidad financiera/)
    assert.throws(() => filasFinanzasDelCliente(clientes[0], [[], fila], [...clientes, { id: 'A3', nombre: 'Ana Peña', celular: '+549110000333' }]), /identidad financiera/)
  })
  test('archivar exige dos confirmaciones, conserva historia y se puede restaurar', async () => {
    const { l, p } = await contexto()
    const b = { tipo: 'archivar', motivo: 'Fin del servicio', confirmacion: l.cliente.nombre, confirmado: false }
    assert.equal(typeof planExtra(l.cliente, b, 'ac_archivo1'), 'string')
    const plan = planExtra(l.cliente, { ...b, confirmado: true }, 'ac_archivo1')
    const frozen = congelarPlan(l, plan, null)
    await aplicarPlan(p, frozen, l.ids)
    const c = (await leerClienteFresco('Z001', p)).cliente
    assert.equal(estaArchivado(c), true)
    assert.equal(c.periodos.length, 1)
    const restaurar = congelarPlan(await leerClienteFresco('Z001', p), planExtra(c, { tipo: 'restaurar' }, 'ac_restaura1'), null)
    await aplicarPlan(p, restaurar, l.ids)
    assert.equal(estaArchivado((await leerClienteFresco('Z001', p)).cliente), false)
  })
  test('el beneficio no duplica extensiones existentes ni iniciales que ya traen un mes extra', async () => {
    const { l } = await contexto(), c = l.cliente
    assert.equal(evidenciaBeneficioReferido(c).estado, 'falta')
    const e = { ...c.periodos[0], fila: 3, periodo: 1, dia1: '2027-02-10', fin: '2027-03-10', precio: 0, notas: 'Extensión +1 mes' }
    assert.equal(evidenciaBeneficioReferido({ ...c, periodos: [...c.periodos, e] }).estado, 'ambiguo')
    assert.equal(evidenciaBeneficioReferido({ ...c, periodos: [...c.periodos, { ...e, notas: 'Beneficio por referido' }] }).estado, 'incluido')
    assert.equal(evidenciaBeneficioReferido({ ...c, periodos: [{ ...c.periodos[0], fin: sumarMeses(sumarDias(c.dia1, 120), 1) }] }).estado, 'ambiguo')
  })
  test('historial sin Finanzas nunca devuelve precios, montos, planes ni resultado interno del pago/renovación', () => {
    const a = { tipo: 'pago', datos: { tipo: 'pago', usd: 4321 }, resumen: 'USD 4321', plan: [{ celda: 'USD', despues: '4321' }], error: 'Monto 4321', resultado: { secreto: '4321' }, esDeshacible: true }
    const limpio = accionesParaPersona([a], false)
    assert.ok(!JSON.stringify(limpio).includes('4321'))
    assert.equal(limpio[0].esDeshacible, false)
    assert.ok(!('resultado' in accionesParaPersona([a], true)[0]))
    const datos = { ...a, tipo: 'datos', datos: { tipo: 'datos', cambios: [{ campo: 'proximoCobro', valor: '2026-11-14' }] }, plan: [{ celda: 'Próximo cobro', despues: '2026-11-14' }] }
    assert.ok(!JSON.stringify(accionesParaPersona([datos], false)).includes('4321'))
    assert.ok(!JSON.stringify(accionesParaPersona([datos], false)).includes('2026-11-14'))
  })
  test('una clave fija produce el mismo ID y la misma huella aunque el orden JSON cambie', () => {
    assert.equal(idDesdeClave('A149', 'beneficio-referido-A149'), idDesdeClave('a149', 'beneficio-referido-A149'))
    assert.equal(huellaAccion(servicio), huellaAccion({ clave: 'otra', revisar: true, duracion: '1m', tipo: 'servicio' }))
    assert.equal(typeof leerCuerpoAccion({ tipo: 'archivar', confirmado: true, confirmacion: 'PRUEBA BOT', motivo: 'Fin', clave: 'abcd-12345' }), 'object')
  })
})

describe('reservar → escribir → verificar → reconciliar', () => {
  test('modo prueba sólo permite Z001 y PRUEBA BOT; pagos y renovación exigen Finanzas', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const f = await contexto(), repo = repositorio(f)
    assert.equal((await ejecutarAccion({ ...f.l.cliente, id: 'A149' }, servicio, 'Equipo', false, { deps: repo.deps })).status, 403)
    assert.equal((await ejecutarAccion(f.l.cliente, { tipo: 'renovacion', inicio: '2027-02-10', meses: 4, precio: 2600, clave: 'clave-pago-001' }, 'Equipo', false, { deps: repo.deps })).status, 403)
    delete process.env.CLIENTES_ESCRITURA
  })
  test('una acción y sus reintentos producen una sola extensión; una respuesta perdida se reconcilia sin reescribir', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const f = await contexto(), repo = repositorio(f)
    assert.equal((await ejecutarAccion(f.l.cliente, servicio, 'Equipo', false, { deps: repo.deps })).status, 200)
    assert.equal((await ejecutarAccion(f.l.cliente, servicio, 'Equipo', false, { deps: repo.deps })).status, 200)
    assert.equal(f.writes.length, 1)
    const g = await contexto(), original = g.p.escribir.bind(g.p)
    g.p.escribir = async (...args) => { await original(...args);throw new Error('Respuesta perdida después de escribir') }
    const r2 = repositorio(g)
    assert.equal((await ejecutarAccion(g.l.cliente, servicio, 'Equipo', false, { deps: r2.deps })).status, 202)
    assert.equal((await ejecutarAccion(g.l.cliente, servicio, 'Equipo', false, { deps: r2.deps })).status, 200)
    assert.equal(g.writes.length, 1)
    delete process.env.CLIENTES_ESCRITURA
  })
  test('dos confirmaciones concurrentes con la misma clave envían un solo lote', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const f = await contexto(), repo = repositorio(f)
    const rs = await Promise.all([ejecutarAccion(f.l.cliente, servicio, 'Equipo', false, { deps: repo.deps }), ejecutarAccion(f.l.cliente, servicio, 'Equipo', false, { deps: repo.deps })])
    assert.ok(rs.some(r => r.status === 200));assert.equal(f.writes.length, 1)
    delete process.env.CLIENTES_ESCRITURA
  })
  test('el pago confirmado es único y un pago incierto nunca vuelve a insertarse a ciegas', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const body = { tipo: 'pago', fecha: '2026-10-28', usd: 100, concepto: '2da Cuota', cuenta: 'Empresa', programa: 'DFY | PIF | $2600', fuente: 'Referido', clave: 'pago-prueba-0001' }
    const f = await contexto(), repo = repositorio(f)
    assert.equal((await ejecutarAccion(f.l.cliente, body, 'Equipo', true, { deps: repo.deps })).status, 200)
    assert.equal((await ejecutarAccion(f.l.cliente, body, 'Equipo', true, { deps: repo.deps })).status, 200)
    assert.equal(repo.pagosEscritos, 1)
    const g = await contexto(), incierto = repositorio(g, { pagoIncierto: true })
    assert.equal((await ejecutarAccion(g.l.cliente, body, 'Equipo', true, { deps: incierto.deps })).status, 202)
    assert.equal((await ejecutarAccion(g.l.cliente, body, 'Equipo', true, { deps: incierto.deps })).status, 202)
    assert.equal(incierto.pagosEscritos, 1)
    delete process.env.CLIENTES_ESCRITURA
  })
  test('dos deshacer concurrentes envían una sola reversa y sus reintentos son idempotentes', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const f = await contexto(), repo = repositorio(f)
    const aplicada = await ejecutarAccion(f.l.cliente, servicio, 'Equipo', false, { deps: repo.deps })
    const id = aplicada.cuerpo.accion.id
    const rs = await Promise.all([deshacerAccion('Z001', id, 'Equipo', false, { deps: repo.reversaDeps }), deshacerAccion('Z001', id, 'Equipo', false, { deps: repo.reversaDeps })])
    assert.ok(rs.some(r => r.status === 200))
    assert.equal(f.writes.length, 2, 'un lote de aplicación y uno de reversa')
    assert.equal((await deshacerAccion('Z001', id, 'Equipo', false, { deps: repo.reversaDeps })).status, 200)
    assert.equal(f.writes.length, 2)
    delete process.env.CLIENTES_ESCRITURA
  })
  test('una reversa rechazada antes del envío libera su reserva para acciones posteriores', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const f = await contexto(), repo = repositorio(f)
    const aplicada = await ejecutarAccion(f.l.cliente, { tipo: 'pausa', clave: 'pausa-con-conflicto1' }, 'Equipo', false, { deps: repo.deps })
    const id = aplicada.cuerpo.accion.id
    f.hojas.Agencia[1][5] = 'Cambio manual posterior'
    assert.equal((await deshacerAccion('Z001', id, 'Equipo', false, { deps: repo.reversaDeps })).status, 409)
    assert.equal(repo.ops.get(id).resultado.deshaciendo, undefined)
    const nueva = await ejecutarAccion(f.l.cliente, { tipo: 'datos', cambios: [{ campo: 'mail', valor: 'nuevo@example.test' }], clave: 'datos-tras-conflicto' }, 'Equipo', false, { deps: repo.deps })
    assert.equal(nueva.status, 200)
    assert.equal(f.writes.length, 2, 'el conflicto no escribió una reversa')
    delete process.env.CLIENTES_ESCRITURA
  })
  test('Próximo cobro tampoco se puede deshacer sin Finanzas', async () => {
    const f = await contexto(), repo = repositorio(f)
    let reservas = 0
    repo.reversaDeps.historial = async () => [{ id: 'ac_finanzas', estado: 'aplicada', modo: 'real', datos: { tipo: 'datos', cambios: [{ campo: 'proximoCobro', valor: '2026-11-14' }] } }]
    repo.reversaDeps.reservar = async () => { reservas++; throw new Error('No debe reservar') }
    assert.equal((await deshacerAccion('Z001', 'ac_finanzas', 'Sin Finanzas', false, { deps: repo.reversaDeps })).status, 403)
    assert.equal(reservas, 0)
  })
  test('reanudar una pausa heredada exige su fecha real y registra los días compensados', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const f = await contexto(), repo = repositorio(f)
    f.hojas.Agencia[1][2] = 'PAUSADO'
    const sinFecha = { tipo: 'reanudar', fecha: '2026-10-28', clave: 'pausa-heredada-0001' }
    assert.equal((await ejecutarAccion(f.l.cliente, sinFecha, 'Equipo', false, { deps: repo.deps })).status, 409)
    const r = await ejecutarAccion(f.l.cliente, { ...sinFecha, desdePausa: '2026-10-14' }, 'Equipo', false, { deps: repo.deps })
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.accion.datos.desdePausa, '2026-10-14')
    const actual = (await leerClienteFresco('Z001', f.p)).cliente
    assert.equal(actual.estado, 'ACTIVO')
    assert.equal(actual.finPeriodo, '2027-02-24')
    assert.equal((await ejecutarAccion(actual, { ...sinFecha, clave: 'reanudacion-otro-0001', desdePausa: '2026-10-14' }, 'Equipo', false, { deps: repo.deps })).status, 409)
    delete process.env.CLIENTES_ESCRITURA
  })
  test('modo sombra o prueba no puede deshacer escrituras reales', async () => {
    const f = await contexto(), repo = repositorio(f)
    let reservas = 0
    repo.reversaDeps.historial = async () => [{ id: 'ac_real', estado: 'aplicada', modo: 'real', datos: { tipo: 'pausa' } }]
    repo.reversaDeps.reservar = async () => { reservas++; throw new Error('No debe reservar') }
    delete process.env.CLIENTES_ESCRITURA
    assert.equal((await deshacerAccion('A149', 'ac_real', 'Equipo', false, { deps: repo.reversaDeps })).status, 409)
    process.env.CLIENTES_ESCRITURA = 'prueba'
    assert.equal((await deshacerAccion('Z001', 'ac_real', 'Equipo', false, { deps: repo.reversaDeps })).status, 409)
    assert.equal(reservas, 0)
    delete process.env.CLIENTES_ESCRITURA
  })
  test('alta y cierre de referido comparten un único beneficio por cliente y sólo confirman evidencia del CRM', async () => {
    process.env.CLIENTES_ESCRITURA = 'prueba'
    const f = await contexto(), repo = repositorio(f)
    const deps = { leerFresco: id => leerClienteFresco(id, f.p), buscar: repo.deps.buscar, ejecutar: (c, b, quien, finanzas) => ejecutarAccion(c, b, quien, finanzas, { deps: repo.deps }) }
    const alta = await aplicarBeneficioReferido('Z001', 'alta-origen', 'Equipo', { deps })
    assert.equal(alta.status, 200)
    assert.equal(alta.cuerpo.beneficioAplicado, true)
    const cierre = await aplicarBeneficioReferido('Z001', 'R123', 'Equipo', { deps })
    assert.equal(cierre.cuerpo.beneficioAplicado, true)
    assert.equal(f.writes.length, 1)
    assert.equal(repo.ops.size, 1)
    f.hojas.Renovaciones.splice(2)
    const modificado = await aplicarBeneficioReferido('Z001', 'R123', 'Equipo', { deps })
    assert.equal(modificado.status, 409)
    assert.equal(modificado.cuerpo.beneficioAplicado, undefined)
    assert.equal(f.writes.length, 1, 'no agrega otro mes si alguien quitó la extensión aplicada')
    delete process.env.CLIENTES_ESCRITURA
  })
  test('una revisión del beneficio en sombra nunca demuestra que el mes fue aplicado', async () => {
    delete process.env.CLIENTES_ESCRITURA
    const f = await contexto()
    const deps = { leerFresco: id => leerClienteFresco(id, f.p), buscar: async () => null, ejecutar: ejecutarAccion }
    const r = await aplicarBeneficioReferido('Z001', 'alta-origen', 'Equipo', { deps })
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.ok, true)
    assert.ok(r.cuerpo.plan.length > 0)
    assert.equal(r.cuerpo.beneficioAplicado, undefined)
    assert.equal(f.writes.length, 0)
  })
})
