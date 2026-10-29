// Estudio/CSM/Ciudad del cliente: sólo fixtures; ninguna credencial ni red.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { parsearHojas, columnasDeClientes } from '../lib/clientes/parsear.ts'
import { camposDe, planDatos, validarValor, esClaveCampo } from '../lib/clientes/acciones/campos.ts'
import { nombresCsmDeAccesos, rosterCsmDeAccesos } from '../lib/clientes/acciones/csm.ts'
import { planColumnasDatos, asegurarColumnasDatos } from '../lib/clientes/acciones/columnasDatos.ts'
import { leerClienteFresco, congelarPlan, aplicarPlan } from '../lib/clientes/acciones/escritor.ts'
import { ejecutarAccion, deshacerAccion } from '../lib/clientes/acciones/servidor.ts'

globalThis.fetch = async () => { throw Error('La suite no admite red') }
const env = Object.fromEntries(['CLIENTES_ESCRITURA','HUB_CSM_OPCIONES_JSON','HUB_CSM_VERSION','HUB_CSM_FUENTE'].map(k=>[k,process.env[k]]))
process.env.HUB_CSM_OPCIONES_JSON = JSON.stringify([{nombre:'CSM Ficticia Uno',activo:true,nombresIdentidad:['CSM Ficticia Uno','Alias CSM Uno']}])
process.env.HUB_CSM_VERSION = '2026-10-29.1'
process.env.HUB_CSM_FUENTE = 'Equipo ficticio de QA'
process.env.CLIENTES_ESCRITURA = 'prueba'
after(() => { for (const [k,v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v })
const base = ['ID', 'Nombre', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Notas renovación', 'Anotaciones']
const rh = ['ID Cliente', 'Nombre', 'Período', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses']
const csm = ['CSM QA']
function fake(linea = 'Agencia') {
  const headers = { Agencia: [...base, 'Estudio', 'CSM', 'Ciudad'], Consultora: ['Ciudad', ...base, 'CSM', 'Estudio'] }
  const data = { ID:'Z001', Nombre:'PRUEBA BOT Datos', Estado:'ACTIVO', Celular:'+5491100000000', Closer:'Closer distinto', Estudio:'', CSM:'', Ciudad:'' }
  const hojas = Object.fromEntries(Object.entries(headers).map(([h,head])=>[h,[head,...(h===linea?[head.map(k=>data[k]??'')]:[])]]))
  hojas.Renovaciones = [rh]
  const writes=[]
  const p = {
    ids: async()=>({Agencia:0,Consultora:1,Renovaciones:2}),
    leer: async rangos => rangos.map(range=>{
      const m=/^'([^']+)'!([A-Z]+)(\d+)$/.exec(range)
      if(!m)return structuredClone(hojas[/^'([^']+)'!/.exec(range)[1]])
      const col=[...m[2]].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1
      return [[hojas[m[1]][Number(m[3])-1]?.[col]??'']]
    }),
    escribir: async(celdas,_ids,reversa=false)=>{
      writes.push(structuredClone(celdas))
      for(const c of celdas){const m=/^'([^']+)'!([A-Z]+)(\d+)$/.exec(c.range), col=[...m[2]].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1;hojas[m[1]][Number(m[3])-1][col]=reversa?c.antes:c.despues}
    },
  }
  return { p, hojas, writes }
}
function repo(f) {
  const ops=new Map(), enviados=new Set(), reversas=new Set()
  const historial=async()=>[...ops.values()].map(x=>x.accion).reverse()
  return {ops,deps:{historial,planilla:f.p,leerFresco:id=>leerClienteFresco(id,f.p),buscar:async id=>ops.get(id)??null,
    reservar:async(n,_clave,huella,piso,construir)=>{if(ops.has(n.id))return ops.get(n.id);const op={huella,resultado:construir(piso),accion:{...n,creada:new Date().toISOString(),aplicada:null,anulada:null,error:null}};ops.set(n.id,op);return op},
    tomarEnvio:async id=>{if(enviados.has(id))return false;enviados.add(id);return true},
    confirmar:async id=>{const op=ops.get(id);op.accion.estado='aplicada';op.accion.aplicada=new Date().toISOString();return op.accion},
    error:async()=>{},rechazar:async id=>{ops.get(id).accion.estado='error'},
  },undo:{historial,planilla:f.p,reservar:async(_crm,id)=>{const op=ops.get(id);op.resultado.deshaciendo=true;return op},
    tomarEnvio:async id=>{if(reversas.has(id))return false;reversas.add(id);return true},
    confirmar:async id=>{const op=ops.get(id);op.accion.estado='anulada';delete op.resultado.deshaciendo;return op.accion},
    cancelar:async id=>{delete ops.get(id).resultado.deshaciendo;reversas.delete(id)},
  }}
}

test('campos opcionales: hojas anteriores siguen leyendo vacío, sin deducir CSM de Closer ni Ciudad del teléfono',()=>{
  const r=parsearHojas({agencia:[base,['Z001','PRUEBA BOT','ACTIVO','+5491100000000','','Closer QA']],consultora:[base],renovaciones:[rh],referidos:null,creditos:null,config:null}).base[0]
  assert.equal(r.estudio,'');assert.equal(r.csm,'');assert.equal(r.ciudad,'')
})
test('whitelist rechaza claves del prototipo aunque el cuerpo JSON intente usarlas como campos',async()=>{
  const c=(await leerClienteFresco('Z001',fake().p)).cliente
  for(const key of ['__proto__','constructor','toString']){assert.equal(esClaveCampo(key),false);assert.match(planDatos(c,{tipo:'datos',cambios:[{campo:key,valor:'ajeno'}]},false,csm),/no editable/)}
})
test('CSM usa catálogo de negocio versionado; rol auth no agrega nombres ni exige cuenta para asignar',()=>{
  assert.deepEqual(nombresCsmDeAccesos([]),['CSM Ficticia Uno'])
  const roster=rosterCsmDeAccesos([{nombre:' CSM   Ficticia Uno ',email:'csm@example.test',rol:'acceso'},{nombre:'Socio',email:'otro@example.test',rol:'csm'}])
  assert.deepEqual(roster.personas,[{nombre:'CSM Ficticia Uno',email:'csm@example.test'}]);assert.equal(roster.version,'2026-10-29.1');assert.match(roster.fuente,/Equipo/)
  assert.deepEqual(rosterCsmDeAccesos([{nombre:'CSM Ficticia Uno',email:'uno@example.test'},{nombre:'Alias CSM Uno',email:'dos@example.test'}]).personas,[{nombre:'CSM Ficticia Uno'}])
  assert.deepEqual(rosterCsmDeAccesos([{nombre:'Aylu',email:'alias@example.test'}]).personas,[{nombre:'CSM Ficticia Uno'}])
  assert.equal(validarValor('csm','CSM QA',csm),'CSM QA');assert.equal(validarValor('csm','',[]),'')
  assert.match(validarValor('csm','Inventado',csm).error,/roster/)
})
test('campos se ofrecen sin Finanzas, CSM conserva legado sin ofrecerlo como asignación nueva, y textos rechazan fórmulas',async()=>{
  const f=fake(),c=(await leerClienteFresco('Z001',f.p)).cliente;c.csm='CSM anterior'
  const campos=camposDe(c,false,csm)
  for(const k of ['estudio','csm','ciudad'])assert.ok(campos.some(x=>x.campo===k))
  assert.ok(!campos.some(x=>x.campo==='proximoCobro'))
  assert.ok(campos.find(x=>x.campo==='csm').opciones.includes('CSM anterior'))
  assert.match(campos.find(x=>x.campo==='csm').aviso,/actual/)
  for(const k of ['estudio','csm','ciudad'])assert.ok(typeof validarValor(k,'=IMPORTDATA("no")',csm)!=='string')
  assert.equal(validarValor('ciudad','  Ciudad   QA  '),'Ciudad QA')
  assert.ok(typeof validarValor('estudio','x'.repeat(161))!=='string')
})
for(const linea of ['Agencia','Consultora'])test(`${linea}: revisión, batch real único, replay concurrente, lectura y deshacer de los tres campos`,async()=>{
  const f=fake(linea),r=repo(f),inicial=(await leerClienteFresco('Z001',f.p)).cliente
  const cuerpo={tipo:'datos',clave:`qa-datos-extra-${linea}`,cambios:[{campo:'estudio',valor:'Estudio QA'},{campo:'csm',valor:'CSM Ficticia Uno'},{campo:'ciudad',valor:'Ciudad QA'}]}
  const rev=await ejecutarAccion(inicial,{...cuerpo,revisar:true},'QA',false,{deps:r.deps})
  assert.equal(rev.status,200);assert.equal(f.writes.length,0)
  const resultados=await Promise.all([ejecutarAccion(inicial,cuerpo,'QA',false,{deps:r.deps}),ejecutarAccion(inicial,cuerpo,'QA',false,{deps:r.deps})])
  assert.ok(resultados.every(x=>[200,202].includes(x.status)));assert.equal(f.writes.length,1)
  const replay=await ejecutarAccion(inicial,cuerpo,'QA',false,{deps:r.deps});assert.equal(replay.status,200);assert.equal(f.writes.length,1)
  const actual=(await leerClienteFresco('Z001',f.p)).cliente
  assert.deepEqual([actual.estudio,actual.csm,actual.ciudad],['Estudio QA','CSM Ficticia Uno','Ciudad QA'])
  assert.ok(f.writes[0].every(x=>x.range.startsWith(`'${linea}'!`)))
  assert.equal(f.writes[0].length,3)
  const undo=await deshacerAccion('Z001',replay.cuerpo.accion.id,'QA',false,{deps:r.undo})
  assert.equal(undo.status,200)
  const despues=(await leerClienteFresco('Z001',f.p)).cliente
  assert.deepEqual([despues.estudio,despues.csm,despues.ciudad],['','',''])
  assert.equal(despues.closer,'Closer distinto')
})
test('encabezado duplicado o celda fórmula nunca se congela para escribir; cambio manual bloquea reversa',async()=>{
  const f=fake(),l=await leerClienteFresco('Z001',f.p)
  const p=planDatos(l.cliente,{tipo:'datos',cambios:[{campo:'ciudad',valor:'Ciudad QA'}]},false,csm)
  f.hojas.Agencia[0].push('Localidad')
  assert.throws(()=>congelarPlan({...l,agencia:f.hojas.Agencia},p,null),/ambigua/)
  f.hojas.Agencia[0].pop();const col=columnasDeClientes('Agencia',f.hojas.Agencia[0]).idx.ciudad
  f.hojas.Agencia[1][col]='=FORMULA()';assert.throws(()=>congelarPlan({...l,agencia:f.hojas.Agencia},p,null),/fórmula/)
  f.hojas.Agencia[1][col]='';const frozen=congelarPlan({...l,agencia:f.hojas.Agencia},p,null)
  await aplicarPlan(f.p,frozen,l.ids);f.hojas.Agencia[1][col]='Cambio humano'
  await assert.rejects(()=>aplicarPlan(f.p,frozen,l.ids,true),/cambi|coincid|conflicto/i)
  assert.equal(f.hojas.Agencia[1][col],'Cambio humano')
})
test('si se cambia el encabezado después de reservar, no escribe ni deshace sobre una columna distinta',async()=>{
  const f=fake(),l=await leerClienteFresco('Z001',f.p)
  const p=planDatos(l.cliente,{tipo:'datos',cambios:[{campo:'ciudad',valor:'Ciudad QA'}]},false,csm)
  const frozen=congelarPlan(l,p,null),col=columnasDeClientes('Agencia',f.hojas.Agencia[0]).idx.ciudad
  f.hojas.Agencia[0][col]='Dato ajeno'
  await assert.rejects(()=>aplicarPlan(f.p,frozen,l.ids),/cambi/i)
  assert.equal(f.writes.length,0)
})

function schemaFake() {
  const hojas=[{nombre:'Agencia',id:0,filas:2000,columnas:12,encabezado:[...base]},{nombre:'Consultora',id:1,filas:2000,columnas:20,encabezado:['ID','Nombre','Estado','Ciudad']}]
  const writes=[]
  return {hojas,writes,leer:async()=>structuredClone(hojas),batch:async requests=>{
    writes.push(structuredClone(requests))
    for(const r of requests){if(r.appendDimension){hojas.find(h=>h.id===r.appendDimension.sheetId).columnas+=r.appendDimension.length;continue}
      const {range,rows,fields}=r.updateCells;assert.equal(range.startRowIndex,0);assert.equal(range.endRowIndex,1);assert.equal(fields,'userEnteredValue');hojas.find(h=>h.id===range.sheetId).encabezado[range.startColumnIndex]=rows[0].values[0].userEnteredValue.stringValue}
  }}
}
test('migración append-only planea sin escribir, usa un batch para ambas hojas y readback idempotente',async()=>{
  const s=schemaFake(),before=structuredClone(s.hojas)
  assert.equal((await asegurarColumnasDatos(s)).escribio,false);assert.equal(s.writes.length,0)
  const applied=await asegurarColumnasDatos(s,true);assert.equal(applied.verificado,true);assert.equal(s.writes.length,1)
  assert.equal(applied.plan.agregadas.length,5)
  for(const hoja of before)assert.deepEqual(s.hojas.find(h=>h.id===hoja.id).encabezado.slice(0,hoja.encabezado.length),hoja.encabezado)
  assert.equal((await asegurarColumnasDatos(s,true)).escribio,false);assert.equal(s.writes.length,1)
})
test('migración rechaza duplicados/overflow y cambios concurrentes de esquema antes de escribir',async()=>{
  const s=schemaFake();s.hojas[0].encabezado.push('CSM','Responsable CSM')
  assert.throws(()=>planColumnasDatos(s.hojas),/duplicados/)
  const t=schemaFake();t.hojas[0].encabezado=[...base,...Array.from({length:21},(_,i)=>`Ajena ${i}`)]
  assert.throws(()=>planColumnasDatos(t.hojas),/AF/)
  const u=schemaFake();let reads=0;const leer=u.leer;u.leer=async()=>{const rows=await leer();if(++reads===2)rows[0].encabezado.push('Columna ajena');return rows}
  await assert.rejects(()=>asegurarColumnasDatos(u,true),/esquema cambió/);assert.equal(u.writes.length,0)
})

test('migración no aplica un nuevo plan distinto de la huella revisada por el operador',async()=>{
  const s=schemaFake(),revisado=(await asegurarColumnasDatos(s)).plan
  s.hojas[0].encabezado.push('Columna nueva ajena')
  await assert.rejects(()=>asegurarColumnasDatos(s,true,revisado),/plan revisado/);assert.equal(s.writes.length,0)
})
