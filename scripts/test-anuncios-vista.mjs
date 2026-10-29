import assert from 'node:assert/strict'
import { ordenarCPL } from '../lib/anuncios/vista.ts'
import { analizarCuenta } from '../lib/anuncios/reglas.ts'
const fila = (cliente, d7, ayer, moneda = 'USD') => ({ cliente, moneda, cpl: { d7, ayer } })
const filas = [fila('Diez', 10, 1), fila('Dos', 2, 9), fila('Sin mensajes', null, null), fila('Sin cotización', .01, .01, 'ARS'), fila('Cero real', 0, 0)]
assert.deepEqual(ordenarCPL(filas, 'd7', 'alto').map(f => f.cliente), ['Diez', 'Dos', 'Cero real', 'Sin mensajes', 'Sin cotización'])
assert.deepEqual(ordenarCPL(filas, 'd7', 'bajo').map(f => f.cliente), ['Cero real', 'Dos', 'Diez', 'Sin mensajes', 'Sin cotización'])
assert.deepEqual(ordenarCPL(filas, 'ayer', 'alto').map(f => f.cliente), ['Dos', 'Diez', 'Cero real', 'Sin mensajes', 'Sin cotización'])
assert.equal(ordenarCPL(filas, 'ayer', 'prioridad'), filas)
assert.equal(filas[0].cliente, 'Diez')
const pesosConvertidos = fila('Pesos convertidos', 1500 / 1500, 3000 / 1500)
assert.equal(ordenarCPL([fila('Dólares', 2, 1), pesosConvertidos], 'd7', 'bajo')[0].cliente, 'Pesos convertidos')
const dias = Array.from({length:35}, (_, i) => {
 const d = new Date(Date.UTC(2026, 9, 5 - i)).toISOString().slice(0,10)
 return { d, g: d >= '2026-10-04' ? 0 : d >= '2026-09-26' ? 3 : 1, m: d >= '2026-09-26' ? 0 : 2 }
})
const ctx = { pausado:false, guiones:null, moneda:'USD' }
const activo = analizarCuenta(null, dias, '2026-10-03', ctx)
assert.ok(activo.motivos.some(m => m.tipo === 'sin_mensajes'))
assert.ok(activo.aumento)
const detenido = analizarCuenta(null, dias, '2026-10-05', ctx)
assert.equal(detenido.corriendo.frenadaHace, 2)
assert.equal(detenido.aumento, null)
assert.equal(detenido.aGrabar, null)
assert.ok(!detenido.motivos.some(m => ['sin_mensajes','no_rinde','cpl_alto','cpl_medio','finde'].includes(m.tipo)))
assert.equal(detenido.gasto.d7, 18)
assert.match(detenido.frase, /sin gasto reciente/i)
const pausaCRM = analizarCuenta(null, dias, '2026-10-03', {...ctx, pausado:true})
assert.equal(pausaCRM.aumento, null)
assert.equal(pausaCRM.aGrabar, null)
assert.ok(!pausaCRM.motivos.some(m => m.tipo === 'sin_mensajes'))
const pausaMeta = analizarCuenta({estado:1, moneda:'USD', medioPago:{id:'p'}, limiteGasto:0, entrega:'sin_activos'}, dias, '2026-10-03', ctx)
assert.equal(pausaMeta.aumento, null)
assert.equal(pausaMeta.aGrabar, null)
assert.match(pausaMeta.frase, /Sin anuncios activos en Meta/)
assert.ok(pausaMeta.gasto.d7 > 0)
assert.ok(!pausaMeta.motivos.some(m => m.tipo === 'sin_mensajes'))
const errorPago = analizarCuenta({estado:2, moneda:'USD', medioPago:{id:'p'}, limiteGasto:0, motivoBaja:0}, dias, '2026-10-05', ctx)
assert.ok(errorPago.pago.errorPago)
assert.equal(errorPago.semaforo, 'error')
console.log('OK: orden numérico, períodos, ausentes, moneda y pausa con gasto histórico; errores de pago preservados')

// El promedio semanal y ayer pueden dar colores opuestos; hoy parcial no participa.
const periodoDias = Array.from({length:35}, (_, i) => ({
 d:new Date(Date.UTC(2026,9,5-i)).toISOString().slice(0,10), g:i===0?500:i===1?1:20, m:1,
}))
const diario = analizarCuenta(null, periodoDias, '2026-10-05', ctx)
const semanal = analizarCuenta(null, periodoDias, '2026-10-05', {...ctx,periodoCPL:'d7'})
assert.equal(diario.semaforo,'verde')
assert.equal(semanal.semaforo,'rojo')
assert.equal(diario.cpl.ayer,1)
assert.match(diario.frase,/ayer/)
assert.match(semanal.frase,/7 días/)
const inversos=periodoDias.map((d,i)=>({...d,g:i===1?10:1}))
assert.equal(analizarCuenta(null,inversos,'2026-10-05',ctx).semaforo,'rojo')
assert.equal(analizarCuenta(null,inversos,'2026-10-05',{...ctx,periodoCPL:'d7'}).semaforo,'verde')
const sinResultados=periodoDias.map((d,i)=>i===1?{...d,g:.5,m:0}:d)
assert.equal(analizarCuenta(null,sinResultados,'2026-10-05',ctx).semaforo,'rojo')
const sinActividad=periodoDias.map((d,i)=>i===1?{...d,g:0,m:0}:d)
assert.equal(analizarCuenta(null,sinActividad,'2026-10-05',ctx).semaforo,'sin_gasto')
assert.equal(analizarCuenta(null,periodoDias,'2026-10-05',{...ctx,guiones:{estado:'sin_guiones'}}).semaforo,'verde')
for(const periodoCPL of ['ayer','d7']) {
 assert.equal(analizarCuenta(null,periodoDias,'2026-10-05',{...ctx,pausado:true,periodoCPL}).semaforo,'sin_gasto')
 assert.equal(analizarCuenta({estado:3,moneda:'USD',medioPago:{id:'p'},limiteGasto:0},periodoDias,'2026-10-05',{...ctx,periodoCPL}).semaforo,'error')
}
const {filasDelPeriodo}=await import('../lib/anuncios/vista.ts')
const seleccion=filasDelPeriodo([{...diario,cliente:'Prueba',estadoSemanal:{semaforo:semanal.semaforo,motivos:semanal.motivos,frase:semanal.frase,prioridad:semanal.prioridad,nivel:semanal.cpl.nivel}}],'d7')
assert.equal(seleccion[0].semaforo,'rojo')
assert.equal(seleccion[0].cpl.nivel,'alto')
console.log('OK: estados diario/semanal opuestos, hoy excluido, gasto sin resultados, inactividad, stock, pausas y pago')

assert.equal(detenido.semaforo,'sin_gasto')
assert.equal(pausaMeta.semaforo,'sin_gasto')
assert.equal(analizarCuenta({estado:3,moneda:'USD',medioPago:{id:'p'},limiteGasto:0},periodoDias,'2026-10-05',{...ctx,pausado:true}).semaforo,'error')
console.log('OK: sin gasto y pago en grupos separados, fuera de los colores')

const gracia=analizarCuenta({estado:9,moneda:'USD',medioPago:null,limiteGasto:0},periodoDias,'2026-10-05',ctx)
assert.equal(gracia.pago.periodoGracia,true)
assert.equal(gracia.pago.errorPago,false)
assert.notEqual(gracia.semaforo,'error')
assert.ok(!gracia.motivos.some(m=>m.tipo==='pago'||m.tipo==='sin_medio_pago'))
const {evaluarPresupuesto}=await import('../lib/anuncios/presupuestos.ts')
const mes=Array.from({length:10},(_,i)=>({d:`2026-10-${String(i+1).padStart(2,'0')}`,g:10,m:1}))
const presupuesto=evaluarPresupuesto(310,mes,'2026-10-11',1,false,'test')
assert.equal(presupuesto.objetivoDiarioUSD,10)
assert.equal(presupuesto.realDiarioUSD,10)
assert.equal(presupuesto.proyeccionUSD,310)
assert.equal(presupuesto.ajusteDiarioUSD,10)
assert.equal(presupuesto.estado,'en_rango')
assert.equal(evaluarPresupuesto(310,mes.map(d=>({...d,g:15})),'2026-10-11',1,false,'test').estado,'exceso')
assert.equal(evaluarPresupuesto(310,mes.map(d=>({...d,g:5})),'2026-10-11',1,false,'test').estado,'corto')
assert.equal(evaluarPresupuesto(310,[...mes,{d:'2026-10-11',g:10000,m:1}],'2026-10-11',1,false,'test').proyeccionUSD,310)
assert.equal(evaluarPresupuesto(310,mes,'2026-10-01',1,false,'test').estado,'sin_datos')
assert.equal(evaluarPresupuesto(null,mes,'2026-10-11',1,false,'test').estado,'sin_presupuesto')
assert.equal(evaluarPresupuesto(310,null,'2026-10-11',1,false,'test').realDiarioUSD,null)
assert.equal(evaluarPresupuesto(310,mes,'2026-10-11',null,false,'test').proyeccionUSD,null)
assert.equal(evaluarPresupuesto(310,mes,'2026-10-11',1,true,'test').estado,'pausado')
assert.equal(evaluarPresupuesto(290,[],'2028-02-01',1,false,'test').objetivoDiarioUSD,10)
assert.equal(evaluarPresupuesto(310,mes.map(d=>({...d,g:d.g*1500})),'2026-10-11',1500,false,'test').proyeccionUSD,310)
console.log('OK: gracia fuera de errores; objetivos, proyección mensual, sobre/subgasto, días completos, monedas y pausas')

assert.equal(evaluarPresupuesto(310,mes.map(d=>({...d,g:10.9})),'2026-10-11',1,false,'test').estado,'exceso')
assert.equal(evaluarPresupuesto(310,mes.map(d=>({...d,g:9.1})),'2026-10-11',1,false,'test').estado,'corto')
console.log('OK: desvíos menores al 10% también quedan para revisar')
// Guiones: cuatro días para definir la primera tanda; sin stock no alcanza.
const tanda = Array.from({length:5},(_,i)=>({d:`2026-10-0${5-i}`,g:8,m:1}))
const mala=analizarCuenta(null,tanda,'2026-10-05',{...ctx,fechaLanzamiento:'2026-10-01'})
assert.equal(mala.aGrabar,'no_rinde')
assert.equal(analizarCuenta(null,tanda,'2026-10-04',{...ctx,fechaLanzamiento:'2026-10-01'}).aGrabar,null)
assert.equal(analizarCuenta(null,tanda,'2026-10-05',{...ctx,fechaLanzamiento:'2026-10-01',enCompetencia:true}).aGrabar,null)
assert.equal(analizarCuenta(null,tanda,'2026-10-05',ctx).aGrabar,null)
assert.equal(analizarCuenta(null,tanda.map(d=>d.d==='2026-10-03'?{...d,g:1}:d),'2026-10-05',{...ctx,fechaLanzamiento:'2026-10-01'}).aGrabar,null)
assert.ok(!analizarCuenta(null,periodoDias,'2026-10-05',{...ctx,guiones:{estado:'sin_guiones'}}).motivos.some(m=>m.tipo==='sin_guiones'))
assert.equal(activo.aGrabar,'quema')
assert.equal(analizarCuenta(null,dias,'2026-10-03',{...ctx,enCompetencia:true}).aGrabar,null)
console.log('OK: guiones solo por quema de 4 días o primera tanda mala de 4 días, suspensión tras optimizar y sin falsas alarmas de stock')
assert.ok(!analizarCuenta(null,dias,'2026-10-03',{...ctx,enCompetencia:true}).aumento.texto.includes('revisar nuevos guiones'))
// Margen absoluto autorizado: hasta USD20 inclusive, manteniendo objetivo exacto.
for (const [proyectado,estado] of [[290,'en_rango'],[330,'en_rango'],[329.99,'en_rango'],[330.01,'exceso'],[289.99,'corto']]) {
 const r=evaluarPresupuesto(310,mes.map(d=>({...d,g:proyectado/31})),'2026-10-11',1,false,'test')
 assert.equal(r.estado,estado)
 assert.equal(r.objetivoDiarioUSD,10)
}
console.log('OK: margen USD20 inclusive, alerta al superarlo y objetivo pactado conservado')
const {requiereRevision,fechaUltimaRevision}=await import('../lib/anuncios/optimizaciones.ts')
const dm={fecha:'2026-09-27',dm:true,anuncios:2}
assert.equal(requiereRevision(dm,null,null,'2026-10-05'),true)
assert.equal(requiereRevision(dm,'2026-10-05',null,'2026-10-11'),false)
assert.equal(requiereRevision(dm,'2026-10-05',null,'2026-10-12'),true)
assert.equal(requiereRevision(dm,'2026-10-05','2026-10-12','2026-10-18'),false)
assert.equal(requiereRevision(dm,'2026-10-05','2026-10-12','2026-10-19'),true)
assert.equal(requiereRevision({...dm,anuncios:1},'2026-10-05',null,'2026-10-19'),false)
assert.equal(requiereRevision({...dm,dm:false},null,null,'2026-10-20'),true)
assert.equal(fechaUltimaRevision('2026-10-14','2026-10-12',dm.fecha),'2026-10-14')
console.log('OK: revisión persistente después del día5/10, DM2 anuncios cada7días, revisión reinicia ciclo y nueva optimización prevalece')
// Pausa y reactivación: la campaña vuelve a esperar 3 días (día 4) desde que se reactivó
{
  const { reactivacionesDe } = await import('../lib/anuncios/meta.ts')
  const ev = (id, tipo, viejo, nuevo, t) => ({ event_type: tipo, object_id: id, event_time: t, extra_data: JSON.stringify({ run_status: { old_value: viejo, new_value: nuevo } }) })
  const eventos = [
    ev('c1', 'update_campaign_run_status', 1, 15, '2026-10-02T15:00:00+0000'),   // pausada
    ev('c1', 'update_campaign_run_status', 15, 1, '2026-10-05T15:00:00+0000'),   // reactivada
    ev('c2', 'update_campaign_run_status', 1, 15, '2026-10-05T15:00:00+0000'),   // solo pausada: no cuenta
    ev('c3', 'update_ad_set_run_status', 17, 1, '2026-10-05T15:00:00+0000'),     // evento de conjunto: no cuenta
    ev('c4', 'update_campaign_run_status', 15, 1, '2026-09-20T15:00:00+0000'),   // fuera de la ventana
  ]
  const r = reactivacionesDe(eventos, '2026-09-27', '2026-10-06')
  assert.equal(r.get('c1'), '2026-10-05')
  assert.equal([...r.keys()].join(), 'c1')
  const c = { fecha: '2026-10-05', inicioCompetencia: '2026-10-05', dm: true, anuncios: 2 }
  assert.equal(requiereRevision(c, null, null, '2026-10-07'), false)    // día 3 tras reactivar: todavía en aprendizaje
  assert.equal(requiereRevision(c, null, null, '2026-10-08'), true)     // día 4
  console.log('OK: pausa y reactivación reinician la espera de 3 días (solo campañas, dentro de la ventana)')
}
// Orden por CPL: gasto sin mensajes = peor caso (arriba en "más alto"), sin gasto ni CPL = al final
{
  const f = (cliente, ayer, g) => ({ cliente, moneda: 'USD', cpl: { ayer, d7: ayer }, gasto: { ayer: g, d7: g } })
  const filas = [f('Dos', 2, 10), f('Sin msj con gasto', null, 8), f('Siete', 7, 10), f('Inactiva', null, 0)]
  assert.deepEqual(ordenarCPL(filas, 'ayer', 'alto').map(x => x.cliente), ['Sin msj con gasto', 'Siete', 'Dos', 'Inactiva'])
  assert.deepEqual(ordenarCPL(filas, 'ayer', 'bajo').map(x => x.cliente), ['Dos', 'Siete', 'Sin msj con gasto', 'Inactiva'])
  console.log('OK: orden por CPL del día anterior: sin mensajes con gasto arriba en "más alto", inactivas al final')
}
// Error de pago nuevo: fecha de entrada desde el historial de Meta (azul durante 3 días)
{
  const { entradaErrorPago } = await import('../lib/anuncios/meta.ts')
  const ev = (t, viejo, nuevo) => ({ event_type: 'ad_account_update_status', event_time: t, extra_data: JSON.stringify({ old_value: viejo, new_value: nuevo, type: 'status' }) })
  const eventos = [
    ev('2026-10-03T22:29:53+0000', 'Activa', 'Pago necesario'),
    ev('2026-10-12T16:28:13+0000', 'Pago necesario', 'Activa'),          // se arregló
    ev('2026-10-20T04:40:02+0000', 'Activa', 'Pago necesario'),          // volvió a caer: cuenta la última
    { event_type: 'update_ad_run_status', event_time: '2026-10-21T00:00:00+0000', extra_data: '{}' },
  ]
  assert.equal(entradaErrorPago(eventos), '2026-10-20')
  assert.equal(entradaErrorPago([ev('2026-10-01T00:41:15+0000', 'Activa', 'En período de gracia'), ev('2026-10-05T23:10:48+0000', 'En período de gracia', 'Pago necesario')]), '2026-10-05')
  assert.equal(entradaErrorPago([ev('2026-10-01T00:41:15+0000', 'Activa', 'En período de gracia')]), null)   // gracia no es error
  const base = { pausado: false, guiones: null, moneda: 'USD' }
  const cuenta = { id: 'a', nombre: 'x', estado: 3, motivoBaja: 0, moneda: 'USD', zonaHoraria: null, negocio: null, gastadoTotal: 0, limiteGasto: 0, deuda: 0, medioPago: { id: '1', texto: null, tipo: 1 }, prepago: false, token: 't' }
  const dias = Array.from({ length: 35 }, (_, i) => ({ d: new Date(Date.UTC(2026, 9, 20 - i)).toISOString().slice(0, 10), g: 5, m: 2 }))
  assert.deepEqual(analizarCuenta(cuenta, dias, '2026-10-20', { ...base, errorPagoDesde: '2026-10-20' }).pago.nuevo, { desde: '2026-10-20', dia: 1 })
  assert.equal(analizarCuenta(cuenta, dias, '2026-10-22', { ...base, errorPagoDesde: '2026-10-20' }).pago.nuevo?.dia, 3)
  assert.equal(analizarCuenta(cuenta, dias, '2026-10-23', { ...base, errorPagoDesde: '2026-10-20' }).pago.nuevo, null)   // al día 4 pasa a error normal
  assert.equal(analizarCuenta(cuenta, dias, '2026-10-20', base).pago.nuevo, null)                                       // sin fecha conocida: error normal
  assert.equal(analizarCuenta(cuenta, dias, '2026-10-20', { ...base, errorPagoDesde: '2026-10-20' }).semaforo, 'error')  // el error nunca se oculta
  console.log('OK: error de pago nuevo en azul 3 días (último cambio a error, gracia no cuenta, día 4 vuelve a error normal)')
}
