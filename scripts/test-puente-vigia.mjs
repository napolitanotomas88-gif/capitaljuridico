// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-puente-vigia.mjs
// El disparador del vigía para el Puente Drive (docs/edicion/puente/Vigia.gs), corrido en node:vm con juguetes de
// Utilities, PropertiesService, UrlFetchApp, ScriptApp, console y Logger. SIN red: nada sale de este proceso.
// Controla: fuera de hora no se llama a nada; sin la propiedad tampoco; va la cabecera Bearer y el cuerpo con la versión;
// el log nunca tiene el secreto; instalar deja UN solo disparador (y no toca los de otras funciones); probarVigia lista los
// disparadores; y que el archivo no repite ningún nombre global de Código.gs (Apps Script junta todos los .gs).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const RUTA = new URL('../docs/edicion/puente/Vigia.gs', import.meta.url)
const CODIGO = readFileSync(RUTA, 'utf8')
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789abcdef'

function entorno({ hora = 10, props = { VIGIA_SECRETO: SECRETO, VIGIA_URL: 'https://despacho.example.test/api/bot/grabacion/vigia' }, respuesta = 202, triggers = [], lanzar = null } = {}) {
  const llamadas = [], logs = [], disparadores = [...triggers]
  const registrar = (...a) => logs.push(a.map(String).join(' '))
  const ctx = {
    Utilities: { formatDate: (_d, zona, formato) => { assert.equal(zona, 'America/Argentina/Buenos_Aires'); assert.equal(formato, 'H'); return String(hora) } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    UrlFetchApp: {
      fetch: (url, opciones) => {
        llamadas.push({ url, opciones })
        if (lanzar) throw lanzar
        return { getResponseCode: () => respuesta, getContentText: () => 'cuerpo que no se loguea' }
      },
    },
    ScriptApp: {
      getProjectTriggers: () => [...disparadores],
      deleteTrigger: t => { const i = disparadores.indexOf(t); if (i >= 0) disparadores.splice(i, 1) },
      newTrigger: funcion => ({
        timeBased: () => ({
          everyMinutes: n => ({ create: () => { const t = { getHandlerFunction: () => funcion, cada: n }; disparadores.push(t); return t } }),
        }),
      }),
    },
    console: { log: registrar, warn: registrar, error: registrar },
    Logger: { log: registrar },
  }
  vm.createContext(ctx)
  vm.runInContext(CODIGO, ctx, { filename: 'Vigia.gs' })
  return { ctx, llamadas, logs, disparadores }
}
const trigger = f => ({ getHandlerFunction: () => f })

describe('dispararVigia', () => {
  test('en horario y con la propiedad: un POST al vigía con Bearer y el cuerpo con la versión', () => {
    const e = entorno({ hora: 10 })
    e.ctx.dispararVigia()
    assert.equal(e.llamadas.length, 1)
    const { url, opciones } = e.llamadas[0]
    assert.equal(url, 'https://despacho.example.test/api/bot/grabacion/vigia')
    assert.equal(opciones.method, 'post')
    assert.equal(opciones.contentType, 'application/json')
    assert.equal(opciones.headers.Authorization, `Bearer ${SECRETO}`)
    assert.equal(opciones.muteHttpExceptions, true)
    assert.equal(opciones.followRedirects, false)
    const cuerpo = JSON.parse(opciones.payload)
    assert.equal(cuerpo.origen, 'puente')
    assert.match(cuerpo.version, /^2026-10-24v\d+$/)
    assert.ok(!opciones.payload.includes(SECRETO), 'el secreto va en la cabecera, nunca en el cuerpo')
    assert.ok(!url.includes(SECRETO) && !/[?&]key=/.test(url), 'nunca en la URL')
  })
  test('fuera de hora (antes de las 8 y desde las 22) no llama a nada', () => {
    for (const hora of [0, 6, 7, 22, 23]) {
      const e = entorno({ hora })
      e.ctx.dispararVigia()
      assert.equal(e.llamadas.length, 0, `hora ${hora}`)
    }
    for (const hora of [8, 21]) {
      const e = entorno({ hora })
      e.ctx.dispararVigia()
      assert.equal(e.llamadas.length, 1, `hora ${hora}`)
    }
  })
  test('sin la propiedad VIGIA_SECRETO no llama y lo avisa en el log', () => {
    const e = entorno({ props: {} })
    e.ctx.dispararVigia()
    assert.equal(e.llamadas.length, 0)
    assert.ok(e.logs.some(l => /falta la propiedad VIGIA_SECRETO/.test(l)))
  })
  test('VIGIA_URL pisa la URL por defecto', () => {
    const e = entorno({ props: { VIGIA_SECRETO: SECRETO, VIGIA_URL: 'https://preview.ejemplo.test/api/bot/grabacion/vigia' } })
    e.ctx.dispararVigia()
    assert.equal(e.llamadas[0].url, 'https://preview.ejemplo.test/api/bot/grabacion/vigia')
  })
  test('una respuesta de error queda en el log solo con el código: ni el cuerpo ni el secreto', () => {
    const e = entorno({ respuesta: 503 })
    e.ctx.dispararVigia()
    assert.ok(e.logs.some(l => /respondió 503/.test(l)))
    for (const l of e.logs) {
      assert.ok(!l.includes(SECRETO), 'el log no tiene el secreto')
      assert.ok(!l.includes('cuerpo que no se loguea'), 'el log no tiene el cuerpo')
    }
  })
  test('si UrlFetchApp lanza, no se cae y el log no trae el secreto ni la URL', () => {
    const err = Object.assign(new Error(`Falló https://despacho-capital-juridico.vercel.app Bearer ${SECRETO}`), { name: 'Exception' })
    const e = entorno({ lanzar: err })
    assert.doesNotThrow(() => e.ctx.dispararVigia())
    assert.ok(e.logs.some(l => /no se pudo llamar al Despacho \(Exception\)/.test(l)))
    for (const l of e.logs) assert.ok(!l.includes(SECRETO) && !l.includes('vercel.app'))
  })
})

describe('disparadores', () => {
  test('instalar deja UN solo disparador de dispararVigia cada 15 minutos y no toca los de otras funciones', () => {
    const otra = trigger('otraFuncion')
    const e = entorno({ triggers: [trigger('dispararVigia'), trigger('dispararVigia'), otra] })
    e.ctx.instalarDisparadorVigia()
    const vigia = e.disparadores.filter(t => t.getHandlerFunction() === 'dispararVigia')
    assert.equal(vigia.length, 1)
    assert.equal(vigia[0].cada, 15)
    assert.ok(e.disparadores.includes(otra), 'el de otra función queda')
    e.ctx.instalarDisparadorVigia()
    assert.equal(e.disparadores.filter(t => t.getHandlerFunction() === 'dispararVigia').length, 1, 'instalar dos veces sigue dejando uno')
  })
  test('quitar borra solo los de dispararVigia', () => {
    const e = entorno({ triggers: [trigger('dispararVigia'), trigger('probar')] })
    e.ctx.quitarDisparadorVigia()
    assert.deepEqual(e.disparadores.map(t => t.getHandlerFunction()), ['probar'])
  })
  test('probarVigia dice si la propiedad está (sin mostrarla) y lista los disparadores con su cantidad', () => {
    const e = entorno({ triggers: [trigger('dispararVigia'), trigger('viejoVigiaAMano'), trigger('viejoVigiaAMano')] })
    e.ctx.probarVigia()
    assert.ok(e.logs.includes('VIGIA_SECRETO cargado: true'))
    assert.ok(e.logs.some(l => l === 'Disparador: dispararVigia × 1'))
    assert.ok(e.logs.some(l => l === 'Disparador: viejoVigiaAMano × 2'), 'se ve el que quedó armado a mano')
    for (const l of e.logs) assert.ok(!l.includes(SECRETO))
    const sin = entorno({ props: {} })
    sin.ctx.probarVigia()
    assert.ok(sin.logs.includes('VIGIA_SECRETO cargado: false'))
    assert.ok(sin.logs.includes('Disparadores del proyecto: ninguno'))
  })
})

describe('convivencia con Código.gs (mismo espacio de nombres en Apps Script)', () => {
  // Los nombres globales de Código.gs (VERSION 2026-10-25a, de la sesión del alta). Si el archivo está a mano, se leen de ahí.
  const CONOCIDOS = ['VERSION', 'PREFIJO_PRUEBA', 'PREFIJO_PLANTILLA', 'CARPETA_COMPROBANTES', 'doPost', 'resp_', 'primeroNoBorrado_', 'subirArchivo_',
    'crearCarpeta_', 'crearDoc_', 'aPapelera_', 'enSubidosOPrueba_', 'copiarArchivo_', 'aPapeleraCarpeta_', 'probar',
    'PREFIJO_DOC_GUIONES', 'TANDA_MAX_BLOQUES', 'TANDA_MAX_TEXTO', 'TANDA_COLOR_MARCA', 'TANDA_TAMANO_MARCA', 'agregarTanda_', 'formatoTandaLimpio_']
  const globales = src => [...src.matchAll(/^(?:var|let|const)\s+([A-Za-z_$][\w$]*)|^function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1] ?? m[2])
  test('ningún nombre global de Vigia.gs choca con los de Código.gs', () => {
    const mios = globales(CODIGO)
    const codigoGs = process.env.PUENTE_CODIGO_GS || new URL('../integrations/apps-script/Codigo.gs', import.meta.url)
    const suyos = new Set([...CONOCIDOS, ...(existsSync(codigoGs) ? globales(readFileSync(codigoGs, 'utf8')) : [])])
    const choques = mios.filter(n => suyos.has(n))
    assert.deepEqual(choques, [], `choques: ${choques.join(', ')}`)
    assert.ok(mios.includes('VERSION_VIGIA') && !mios.includes('VERSION'))
    for (const f of ['dispararVigia', 'instalarDisparadorVigia', 'quitarDisparadorVigia', 'probarVigia']) assert.ok(mios.includes(f), f)
  })
  test('el archivo no trae un secreto escrito ni pide publicar una versión nueva', () => {
    assert.ok(!/Bearer\s+[A-Za-z0-9_-]{16,}/.test(CODIGO))
    assert.ok(!/var\s+VIGIA_SECRETO\s*=/.test(CODIGO))
    assert.match(CODIGO, /NO hace falta "Implementar → Nueva versión"/)
    assert.match(CODIGO, /EDICION_MODO=real/)
  })
})
