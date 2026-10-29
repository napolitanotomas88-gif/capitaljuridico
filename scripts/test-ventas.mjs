import assert from 'node:assert/strict'
import { pestanasPermitidas, pendientesDeFilas } from '../lib/ventas/pendientes.ts'
const hoy = '2026-10-06'
function fila(overrides = {}) { const r = Array(33).fill(''); r[0]='Lead de prueba'; r[3]='05/10/2026 14:00:00'; r[5]='Hecho - link a call'; for (const [k,v] of Object.entries(overrides)) r[Number(k)]=v; return r }
assert.deepEqual(pestanasPermitidas('closer','a@b.com',undefined),[])
assert.deepEqual(pestanasPermitidas('closer','a@b.com','{"a@b.com":["Closer 1","inventada"]}'),[])
assert.deepEqual(pestanasPermitidas('closer','a@b.com','{"a@b.com":["Closer 1","Closer 1"]}'),['Closer 1'])
assert.deepEqual(pestanasPermitidas('csm','a@b.com','{"a@b.com":["Closer 1"]}'),[])
assert.equal(pestanasPermitidas('socio','a@b.com',undefined).length,6)
assert.equal(pendientesDeFilas('Closer 1',[fila()],hoy)[0].accion,'Confirmar asistencia')
assert.equal(pendientesDeFilas('Closer 1',[fila({17:'Si'})],hoy)[0].accion,'Registrar resultado de la llamada')
assert.equal(pendientesDeFilas('Closer 1',[fila({17:'No',18:'S5'})],hoy).length,0)
assert.equal(pendientesDeFilas('Closer 1',[fila({17:'Si',21:'Cerrado en llamada',22:'Hacer'})],hoy).length,0)
assert.equal(pendientesDeFilas('Closer 1',[fila({3:'01/07/2026'})],hoy).length,0)
assert.equal(pendientesDeFilas('Closer 1',[fila({17:'No',28:'08/10/2026'})],hoy).length,0)
assert.equal(pendientesDeFilas('Closer 1',[fila({17:'S3'})],hoy)[0].accion,'Revisar columnas heredadas')
assert.equal(pendientesDeFilas('Closer 1',[fila({17:'Si',21:'Quiere pensarlo',22:'Hacer'})],hoy)[0].revision,true)
console.log('Ventas: 13 comprobaciones de permisos, cierre, reagenda, antigüedad y estados heredados pasaron')
