import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ETAPAS_TARJETAS, COLOR_ETAPA_TARJETA } from '../lib/edicion/tarjetasTipos.ts'
import { buscarTarjeta, cantidadDescendientes, coincideTarjeta, esRegresoTarjeta, reemplazarTarjeta } from '../lib/edicion/vistaTarjetas.ts'
import { tarjetasEdicionDemo } from '../lib/edicion/demoTarjetas.ts'

test('conserva las ocho etapas y colores del tablero ClickUp relevado, con publicar y publicado distintos', () => {
  assert.deepEqual(ETAPAS_TARJETAS, ['en espera de datos', 'para editar', 'editando', 'editado', 'corregido', 'revisión', 'publicar', 'publicado'])
  assert.deepEqual(ETAPAS_TARJETAS.map(e => COLOR_ETAPA_TARJETA[e]), ['#87909e', '#ff0000', '#f76808', '#ffc53d', '#a18072', '#3db88b', '#12a594', '#008844'])
  assert.equal(ETAPAS_TARJETAS.includes('aprobado'), false)
})

test('mover un padre conserva los estados propios de sus videos y el objeto original', () => {
  const antes = tarjetasEdicionDemo(), padre = antes[0]
  const siguiente = reemplazarTarjeta(antes, { ...padre, etapa: 'revisión', version: 2 })
  assert.equal(siguiente[0].etapa, 'revisión')
  assert.deepEqual(siguiente[0].hijos.map(h => h.etapa), ['editado', 'en espera de datos'])
  assert.equal(antes[0].etapa, 'editado')
  assert.equal(antes[0].version, 1)
  const parcial = reemplazarTarjeta(antes, { ...padre, etapa: 'revisión', version: 2, hijos: [] }, true)
  assert.equal(parcial[0].hijos.length, 2, 'la respuesta de una mutación no borra los hijos que el endpoint no releyó')
})

test('mover una subtarea anidada conserva su padre, la tarjeta cliente y todos sus hermanos', () => {
  const antes = tarjetasEdicionDemo(), hija = buscarTarjeta(antes, 'demo-video-6')
  const despues = reemplazarTarjeta(antes, { ...hija, etapa: 'editando', version: 2 })
  assert.equal(buscarTarjeta(despues, hija.id).parent_id, hija.parent_id)
  assert.equal(buscarTarjeta(despues, hija.id).etapa, 'editando')
  assert.equal(buscarTarjeta(despues, hija.parent_id).etapa, 'revisión')
  assert.equal(despues[2].etapa, 'revisión')
  assert.deepEqual(despues[0], antes[0])
  assert.equal(cantidadDescendientes(despues[2]), 2)
})

test('búsqueda alcanza subtareas anidadas e ID sin perder la tarjeta cliente', () => {
  const t = tarjetasEdicionDemo()[2]
  assert.equal(coincideTarjeta(t, 'versión alternativa'), true)
  assert.equal(coincideTarjeta(t, 'VERSION ALTERNATIVA'), true)
  assert.equal(coincideTarjeta(t, 'E003'), true)
  assert.equal(coincideTarjeta(t, 'inexistente'), false)
  assert.equal(buscarTarjeta([t], 'desconocida'), null)
})

test('un regreso se distingue de un avance para pedir la nota sin inferir aprobación', () => {
  assert.equal(esRegresoTarjeta('revisión', 'editando'), true)
  assert.equal(esRegresoTarjeta('editado', 'para editar'), true)
  assert.equal(esRegresoTarjeta('para editar', 'editando'), false)
  assert.equal(esRegresoTarjeta('publicar', 'publicado'), false)
  assert.equal(esRegresoTarjeta('editado', 'editado'), false)
})
