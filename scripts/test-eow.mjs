// node --experimental-strip-types --no-warnings --import ./scripts/fixtures-entorno.mjs --import ./scripts/ts-resolve.mjs --test scripts/test-eow.mjs
// Reporte EOW (13/11/2026): acceso por mail (EOW_CORREOS: nadie sin la variable, ni un socio), la API (leer, guardar con
// versión, nueva semana) sin permiso no lee ni escribe, el modelo, los recién lanzados del domingo con su aviso (solo Gero M)
// y el importador del documento. SIN red ni base: fetch bloqueado. Datos inventados.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
delete process.env.EOW_CORREOS
delete process.env.EOW_AVISO

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const C = await import('../lib/auth/correos.ts')
const RUTAS = await import('../lib/auth/rutas.ts')
const ACC = await import('../lib/auth/acceso.ts')
const NAV = await import('../components/shell/secciones.ts')
const M = await import('../lib/eow/modelo.ts')
const API = await import('../lib/eow/api.ts')
const L = await import('../lib/eow/lanzados.ts')
const LR = await import('../lib/eow/lanzadosReales.ts')
const I = await import('../lib/eow/importar.ts')
const V = await import('../lib/eow/vinculo.ts')

const PERMITIDOS = 'tomas@ejemplo.com, empresa@ejemplo.com;gerom@ejemplo.com'
const conLista = (fn) => { process.env.EOW_CORREOS = PERMITIDOS; try { return fn() } finally { delete process.env.EOW_CORREOS } }

describe('acceso por mail (EOW_CORREOS)', () => {
  test('sin la variable no entra nadie; con ella, solo esos mails (sin importar mayúsculas)', () => {
    assert.deepEqual(C.correosDe('eow', {}), [])
    assert.equal(C.correoPermitido('eow', 'tomas@ejemplo.com', {}), false)
    const env = { EOW_CORREOS: PERMITIDOS }
    assert.deepEqual(C.correosDe('eow', env), ['tomas@ejemplo.com', 'empresa@ejemplo.com', 'gerom@ejemplo.com'])
    assert.equal(C.correoPermitido('eow', 'TOMAS@ejemplo.com', env), true)
    assert.equal(C.correoPermitido('eow', 'geroa@ejemplo.com', env), false)
    assert.equal(C.correoPermitido('eow', '', env), false)
    assert.equal(C.correoPermitido('eow', null, env), false)
  })

  test('las reglas: /eow y /api/eow piden el mail; el cron es «propio» y va antes', () => {
    assert.equal(RUTAS.resolverRegla('/eow').regla.correos, 'eow')
    assert.equal(RUTAS.resolverRegla('/eow?semana=x').regla.quien, 'google')
    assert.equal(RUTAS.resolverRegla('/api/eow').regla.correos, 'eow')
    assert.equal(RUTAS.resolverRegla('/api/eow/aviso').regla.quien, 'propio')
    assert.equal(RUTAS.resolverRegla('/api/eow/otra').regla.correos, 'eow')
  })

  test('decidir: un socio con otro mail NO pasa (página → su inicio; API → 403); sin sesión, a /entrar o 401', () => conLista(() => {
    const socio = (email) => () => ({ sesion: { rol: 'socio', email }, maquina: false })
    assert.deepEqual(RUTAS.decidir({ pathname: '/eow', contexto: socio('tomas@ejemplo.com') }), { accion: 'pasar' })
    assert.deepEqual(RUTAS.decidir({ pathname: '/api/eow', contexto: socio('gerom@ejemplo.com') }), { accion: 'pasar' })
    const pagina = RUTAS.decidir({ pathname: '/eow', contexto: socio('geroa@ejemplo.com') })
    assert.equal(pagina.accion, 'redirigir')
    assert.equal(pagina.destino, '/')
    assert.deepEqual(RUTAS.decidir({ pathname: '/api/eow', contexto: socio('geroa@ejemplo.com') }), { accion: 'json', estado: 403, error: RUTAS.ERROR_SIN_PERMISO })
    assert.deepEqual(RUTAS.decidir({ pathname: '/api/eow', contexto: () => ({ sesion: { rol: 'closer', email: 'x@ejemplo.com' }, maquina: true }) }), { accion: 'json', estado: 403, error: RUTAS.ERROR_SIN_PERMISO })
    assert.deepEqual(RUTAS.decidir({ pathname: '/api/eow', contexto: () => ({ sesion: null, maquina: false }) }), { accion: 'json', estado: 401, error: RUTAS.ERROR_SIN_SESION })
    assert.equal(RUTAS.decidir({ pathname: '/eow', contexto: () => ({ sesion: null, maquina: false }) }).accion, 'redirigir')
    // El cliente del portal nunca
    assert.equal(RUTAS.decidir({ pathname: '/api/eow', contexto: () => ({ sesion: { rol: 'cliente', email: 'tomas@ejemplo.com', clienteId: 'A001' }, maquina: false }) }).estado, 403)
  }))

  test('sin EOW_CORREOS ni Tomás entra', () => {
    assert.equal(RUTAS.decidir({ pathname: '/api/eow', contexto: () => ({ sesion: { rol: 'socio', email: 'tomas@ejemplo.com' }, maquina: false }) }).estado, 403)
  })

  test('menú: EOW después de Finanzas y antes de Configuración, solo para los mails de la lista', () => {
    const env = { EOW_CORREOS: PERMITIDOS }
    const claves = (q) => NAV.menuDe(q, env).map((i) => i.clave)
    const socio = { rol: 'socio', email: 'tomas@ejemplo.com' }
    const c = claves(socio)
    assert.equal(c.indexOf('eow'), c.indexOf('finanzas') + 1)
    assert.equal(c.indexOf('configuracion'), c.indexOf('eow') + 1)
    assert.equal(claves({ rol: 'socio', email: 'geroa@ejemplo.com' }).includes('eow'), false)
    assert.equal(NAV.menuDe({ rol: 'csm', email: 'gerom@ejemplo.com' }, env).at(-1).href, '/eow')
    assert.equal(NAV.menuDe('socio', env).some((i) => i.clave === 'eow'), false)
    assert.equal(NAV.menuDe(socio, {}).some((i) => i.clave === 'eow'), false)
  })
})

// ── API con la barrera REAL (usuario de prueba de desarrollo, mail dev@localhost) y una base de juguete ──
function baseJuguete() {
  const reportes = new Map([['2026-11-08', { semana: '2026-11-08', filas: [], tarjetas: M.tarjetasVacias(), version: 3, actualizado: null, actualizadoPor: null }]])
  const escrituras = []
  return {
    escrituras,
    deps: {
      exigirAcceso: (r) => ACC.exigirAccesoApi(r, null, { correos: 'eow' }),
      sesion: (r) => ACC.sesionDePeticion(r.headers),
      mismoOrigen: (h) => h.get('origin') === 'http://localhost:3101',
      baseConfigurada: () => true,
      hoy: () => '2026-11-13',
      listarSemanas: async () => [...reportes.keys()].sort().reverse(),
      leerReporte: async (s) => reportes.get(s) ?? null,
      historial: async () => [],
      guardar: async (s, datos, version, quien) => {
        escrituras.push({ s, version, quien })
        const r = reportes.get(s)
        if (!r) return { ok: false, version: null }
        if (r.version !== version) return { ok: false, version: r.version }
        reportes.set(s, { ...r, ...datos, version: version + 1 })
        return { ok: true, version: version + 1, actualizado: '2026-11-13T13:00:00.000Z' }
      },
      nuevaSemana: async (s, quien) => { escrituras.push({ s, quien, nueva: true }); return { creada: true, reporte: { semana: s, filas: [], tarjetas: M.tarjetasVacias(), version: 1, actualizado: null, actualizadoPor: quien } } },
    },
  }
}
const pedido = (metodo, cuerpo) => new Request(`http://localhost:3101/api/eow${metodo === 'GET' ? '?semana=2026-11-08' : ''}`, {
  method: metodo,
  headers: { host: 'localhost:3101', origin: 'http://localhost:3101', 'content-type': 'application/json' },
  ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
})
const datosOk = { filas: [{ id: 'a1', cliente: 'Estudio Ejemplo', comentario: 'Activo', color: 'verde', pausado: false }], tarjetas: { observaciones: ['Nota'] } }

describe('API /api/eow (barrera real)', () => {
  const previo = { rol: process.env.CRM_DEV_ROL, nodeEnv: process.env.NODE_ENV }
  process.env.CRM_DEV_ROL = 'socio'
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test'

  test('sin permiso NO lee ni escribe (403) y no toca la base', async () => {
    const b = baseJuguete()
    assert.equal((await API.atenderGetEow(pedido('GET'), b.deps)).status, 403)
    assert.equal((await API.atenderPostEow(pedido('POST', { accion: 'guardar', semana: '2026-11-08', version: 3, datos: datosOk }), b.deps)).status, 403)
    assert.equal((await API.atenderPostEow(pedido('POST', { accion: 'nueva' }), b.deps)).status, 403)
    assert.equal(b.escrituras.length, 0)
  })

  test('con permiso: lee, guarda con versión y responde 409 si la versión es vieja', async () => {
    process.env.EOW_CORREOS = 'dev@localhost'
    try {
      const b = baseJuguete()
      const g = await API.atenderGetEow(pedido('GET'), b.deps)
      assert.equal(g.status, 200)
      assert.equal((await g.json()).reporte.version, 3)
      const ok = await API.atenderPostEow(pedido('POST', { accion: 'guardar', semana: '2026-11-08', version: 3, datos: datosOk }), b.deps)
      assert.equal(ok.status, 200)
      assert.equal((await ok.json()).version, 4)
      const viejo = await API.atenderPostEow(pedido('POST', { accion: 'guardar', semana: '2026-11-08', version: 3, datos: datosOk }), b.deps)
      assert.equal(viejo.status, 409)
      const malo = await API.atenderPostEow(pedido('POST', { accion: 'guardar', semana: '2026-11-08', version: 4, datos: { filas: [{ cliente: 'X', color: 'azul' }] } }), b.deps)
      assert.equal(malo.status, 422)
      // Otro origen: 403
      const ajeno = new Request('http://localhost:3101/api/eow', { method: 'POST', headers: { host: 'localhost:3101', origin: 'https://otro.ejemplo', 'content-type': 'application/json' }, body: '{}' })
      assert.equal((await API.atenderPostEow(ajeno, b.deps)).status, 403)
      // Nueva semana: si el domingo de esta semana (15/11) es posterior a la última, esa
      const n = await API.atenderPostEow(pedido('POST', { accion: 'nueva' }), b.deps)
      assert.equal((await n.json()).reporte.semana, '2026-11-15')
    } finally {
      delete process.env.EOW_CORREOS
    }
  })

  test('la ruta usa la barrera por mail y el mismo origen', () => {
    const ruta = readFileSync(join(RAIZ, 'app/api/eow/route.ts'), 'utf8')
    assert.match(ruta, /exigirAccesoApi\(r, null, \{ correos: 'eow' \}\)/)
    assert.match(ruta, /mismoOrigen/)
    const pagina = readFileSync(join(RAIZ, 'app/(shell)/eow/page.tsx'), 'utf8')
    assert.match(pagina, /await exigirCorreos\('eow'\)/)
  })

  after(() => { process.env.CRM_DEV_ROL = previo.rol; process.env.NODE_ENV = previo.nodeEnv })
})

describe('modelo', () => {
  test('validar: una línea, sin filas vacías, color válido, ids únicos', () => {
    const v = M.validarDatos({ filas: [{ id: 'a', cliente: ' Uno\n', comentario: 'x\ny', color: 'rojo', pausado: true }, { id: 'a', cliente: 'Dos' }, { cliente: '' }], tarjetas: { pesadilla: ['  P  ', ''] } })
    assert.equal(v.ok, true)
    assert.equal(v.datos.filas.length, 2)
    assert.equal(v.datos.filas[0].cliente, 'Uno')
    assert.equal(v.datos.filas[0].comentario, 'x y')
    assert.notEqual(v.datos.filas[0].id, v.datos.filas[1].id)
    assert.equal(v.datos.filas[1].color, null)
    assert.deepEqual(v.datos.tarjetas.pesadilla, ['P'])
    assert.equal(M.validarDatos({ filas: [{ cliente: 'X', color: 'violeta' }] }).ok, false)
    assert.equal('reclamos' in v.datos.tarjetas, false)
  })
  test('tarjetas en el orden pedido (sin Reclamos abiertos)', () => {
    assert.deepEqual(M.TARJETAS.map((k) => M.NOMBRE_TARJETA[k]), ['Cliente pesadilla', 'Cancelaciones', 'Pausados', 'Testimonios pedidos', 'Testimonios obtenidos', 'Servicio terminado', 'Observaciones'])
  })
  test('contar, ubicar (Pausado deja la fila en Amarillo pausada) y copiar la semana', () => {
    const filas = [
      { id: 'a', cliente: 'A', comentario: '', color: 'rojo', pausado: false, idCrm: null, lanzado: null, origen: 'manual' },
      { id: 'b', cliente: 'B', comentario: '', color: null, pausado: false, idCrm: null, lanzado: '2026-11-10', origen: 'sistema' },
    ]
    assert.deepEqual(M.contar(filas), { rojo: 1, amarillo: 0, verde: 0, sinUbicar: 1, pausados: 0 })
    assert.equal(M.ubicar(filas, 'b', 'verde')[1].color, 'verde')
    const p = M.ubicar(filas, 'b', 'pausado')[1]
    assert.deepEqual([p.color, p.pausado], ['amarillo', true])
    const copia = M.copiarSemana({ filas, tarjetas: { ...M.tarjetasVacias(), observaciones: ['x'] } })
    assert.equal(copia.filas.length, 2)
    assert.deepEqual(copia.tarjetas.observaciones, ['x'])
    assert.equal(M.domingoDe('2026-11-13'), '2026-11-15')
    assert.equal(M.domingoDe('2026-11-15'), '2026-11-15')
    assert.equal(M.fechaCorta('2026-11-08'), '08/11/26')
  })
  test('registro de cambios: color, pausa, comentario, altas, bajas y tarjetas', () => {
    const a = { filas: [{ id: 'a', cliente: 'A', comentario: 'x', color: 'rojo', pausado: false }], tarjetas: M.tarjetasVacias() }
    const b = { filas: [{ id: 'a', cliente: 'A', comentario: 'y', color: 'verde', pausado: true }, { id: 'n', cliente: 'N', comentario: '', color: null, pausado: false }], tarjetas: { ...M.tarjetasVacias(), pesadilla: ['Q'] } }
    const c = M.resumirCambios(a, b)
    assert.ok(c.includes('A: Rojo → Verde'))
    assert.ok(c.includes('A: pausado'))
    assert.ok(c.includes('A: comentario'))
    assert.ok(c.includes('+ N (sin ubicar)'))
    assert.ok(c.includes('Cliente pesadilla: +1'))
    assert.ok(M.resumirCambios(b, a).includes('− N'))
  })
})

describe('recién lanzados y aviso del domingo', () => {
  const reporte = { filas: [{ id: 'x', cliente: 'Lucía Fernández', comentario: '', color: 'verde', pausado: false, idCrm: 'A010', lanzado: null, origen: 'manual' }], tarjetas: { ...M.tarjetasVacias(), servicioTerminado: ['Pedro Gómez'] } }
  const lanzados = [
    { nombre: 'Lucía Fernández', idCrm: 'A010', lanzado: '2026-11-12' },     // ya está (ID)
    { nombre: 'Pedro Gómez', idCrm: null, lanzado: '2026-11-11' },           // ya está (tarjeta)
    { nombre: 'Estudio Nuevo Ejemplo', idCrm: 'A200', lanzado: '2026-11-10' },
    { nombre: 'Viejo Cliente', idCrm: 'A050', lanzado: '2026-10-01' },       // fuera de la ventana
    { nombre: 'PRUEBA BOT Alfa', idCrm: null, lanzado: '2026-11-12' },       // prueba
  ]
  test('ventana y filtro', () => {
    const v = L.ventana('2026-11-15', '2026-11-08')
    assert.deepEqual(v, { desde: '2026-11-09', hasta: '2026-11-15' })
    assert.deepEqual(L.recienLanzados(lanzados, reporte, v).map((c) => c.nombre), ['Estudio Nuevo Ejemplo'])
    const datos = L.agregarFilas(reporte, [lanzados[2]])
    assert.equal(datos.filas[0].color, null)
    assert.equal(datos.filas[0].origen, 'sistema')
    assert.equal(datos.filas[0].lanzado, '2026-11-10')
    assert.equal(L.agregarFilas(datos, [lanzados[2]]).filas.length, datos.filas.length, 'no se repite')
  })
  test('texto del aviso', () => {
    const t = L.textoAviso('2026-11-15', ['Uno', 'Dos'], 'https://despacho.ejemplo/eow')
    assert.match(t, /^Reporte EOW de la semana: 2 clientes recién lanzados para ubicar\n• Uno\n• Dos\n/)
    assert.match(t, /https:\/\/despacho\.ejemplo\/eow/)
  })

  function deps(hoy, extra = {}) {
    const llamadas = { agregar: [], enviar: [], reservas: new Set(), creadas: [] }
    const semanas = new Map([['2026-11-08', reporte]])
    return {
      llamadas,
      semanas,
      d: {
        hoy: () => hoy, encendido: true, base: 'https://despacho.ejemplo',
        lanzados: async () => lanzados,
        semanaAnterior: async () => '2026-11-08',
        leer: async (s) => semanas.get(s) ?? null,
        crearSemana: async (s) => { if (semanas.has(s)) return false; llamadas.creadas.push(s); semanas.set(s, M.copiarSemana(reporte)); return true },
        agregar: async (s, nuevos) => { llamadas.agregar.push([s, nuevos.map((c) => c.nombre)]); return { ok: true, creado: true } },
        reservarAviso: async (s) => { if (llamadas.reservas.has(s)) return false; llamadas.reservas.add(s); return true },
        cerrarAviso: async () => {},
        enviar: async (t) => { llamadas.enviar.push(t); return 'enviado' },
        ...extra,
      },
    }
  }
  test('solo actúa los domingos y con EOW_AVISO encendido; ?dry=1 no escribe', async () => {
    const sabado = deps('2026-11-14')
    assert.equal((await L.correrAvisoEow(sabado.d)).motivo, 'Solo actúa los domingos.')
    const apagado = deps('2026-11-15', { encendido: false })
    assert.match((await L.correrAvisoEow(apagado.d)).motivo, /EOW_AVISO/)
    const dry = deps('2026-11-14')
    const r = await L.correrAvisoEow(dry.d, { dry: true })
    assert.deepEqual(r.nuevos.map((x) => x.nombre), ['Estudio Nuevo Ejemplo'])
    assert.equal(dry.llamadas.agregar.length + dry.llamadas.enviar.length + dry.llamadas.creadas.length, 0)
    assert.equal(r.semanaCreada, true, 'en dry informa que la crearía')
  })
  test('el domingo crea SIEMPRE la semana nueva copiando la anterior (aunque no haya lanzados ni Meta), una sola vez', async () => {
    const sinMeta = deps('2026-11-15', { lanzados: async () => null })
    const r = await L.correrAvisoEow(sinMeta.d)
    assert.equal(r.semanaCreada, true)
    assert.deepEqual(sinMeta.llamadas.creadas, ['2026-11-15'])
    assert.equal(sinMeta.semanas.get('2026-11-15').filas[0].cliente, 'Lucía Fernández')
    assert.deepEqual(sinMeta.semanas.get('2026-11-15').tarjetas.servicioTerminado, ['Pedro Gómez'])
    const sinNuevos = deps('2026-11-15', { lanzados: async () => [] })
    assert.equal((await L.correrAvisoEow(sinNuevos.d)).semanaCreada, true)
    const r2 = await L.correrAvisoEow(sinNuevos.d)
    assert.equal(r2.semanaCreada, false, 'idempotente')
    assert.deepEqual(sinNuevos.llamadas.creadas, ['2026-11-15'])
    assert.equal(sinNuevos.llamadas.enviar.length, 0)
  })
  test('el domingo agrega a la semana (15/11), avisa una sola vez', async () => {
    const x = deps('2026-11-15')
    const r = await L.correrAvisoEow(x.d)
    assert.equal(r.semana, '2026-11-15')
    assert.deepEqual(x.llamadas.agregar, [['2026-11-15', ['Estudio Nuevo Ejemplo']]])
    assert.equal(x.llamadas.enviar.length, 1)
    assert.equal(r.aviso, 'enviado')
    const r2 = await L.correrAvisoEow(x.d)
    assert.equal(r2.aviso, 'ya_estaba')
    assert.equal(x.llamadas.enviar.length, 1)
  })
  test('webhook: #📊-reporte-eow y, si falta, operaciones; interruptor', () => {
    const w = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz'
    const o = 'https://discord.com/api/webhooks/223456789012345678/abcdefghijklmnopqrstuvwxyz'
    assert.equal(LR.webhookEow({ DISCORD_WEBHOOK_EOW: w, DISCORD_WEBHOOK_OPERACIONES: o }), w)
    assert.equal(LR.webhookEow({ DISCORD_WEBHOOK_OPERACIONES: o }), o)
    assert.equal(LR.webhookEow({ DISCORD_WEBHOOK_EOW: 'no-es-un-webhook' }), null)
    assert.equal(LR.avisoEowEncendido({}), false)
    assert.equal(LR.avisoEowEncendido({ EOW_AVISO: ' Encendido ' }), true)
  })
  test('menciona SOLO a Gero M', () => {
    const fuente = readFileSync(join(RAIZ, 'lib/eow/lanzadosReales.ts'), 'utf8')
    assert.match(fuente, /resolverMenciones\(\['gero_m'\], env\)/)
    assert.doesNotMatch(fuente, /'gero_a'|'tomas'/)
  })
  test('ruta, cron (10:00 AR) y proxy', () => {
    const crons = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons
    assert.ok(crons.some((c) => c.path === '/api/eow/aviso' && c.schedule === '0 13 * * *'))
    const ruta = readFileSync(join(RAIZ, 'app/api/eow/aviso/route.ts'), 'utf8')
    assert.match(ruta, /accesoMaquina\(req\.headers\)/)
    assert.doesNotMatch(ruta, /searchParams\.get\('key'\)/)
    assert.match(readFileSync(join(RAIZ, 'proxy.ts'), 'utf8'), /\|eow\/aviso\|/)
  })
})

describe('importador del documento', () => {
  const html = `<html><head><style>.c1{}</style></head><body>
<p>Reporte EOW: 06/09/26</p>
<p>Sem&aacute;foro Rojo: (1 Cliente)</p><ul><li>Cliente Uno (Sin respuestas)<a href="#cmnt1" id="cmnt_ref1">[a]</a></li></ul>
<p>Sem&aacute;foro Amarillo: (1 clientes)</p><ul><li>Cliente Dos - Contest&oacute; poco</li></ul><p>Sigue en la l&iacute;nea de abajo.</p>
<p>Sem&aacute;foro Verde: (2 clientes) - Nota del verde</p><ul><li>Cliente Tres - Activo</li><li>Cliente Cuatro: Pausamos hasta el lunes</li><li> </li></ul>
<p>Cliente Pesadilla:</p><ul><li>Cliente Dos</li></ul>
<p>Cancelaciones: </p><p>&ndash;</p>
<p>Reclamos abiertos: </p><p>Cliente Tres por la demora</p>
<p>Testimonios aceptados: </p><p>Nuevo enfoque de testimonio - Analizamos.</p><p>Cliente Tres</p>
<p>Testimonios pendientes (semana pasada/acumulados):</p><p>Cliente Uno</p>
<p>Testimonios obtenidos:</p><p>Cliente Cinco</p>
<p>Servicio terminado: </p><ul><li>Cliente Seis</li></ul>
<p>Observaciones (Decisiones o apoyo necesario concreto):</p><ul><li>Algo para decidir</li></ul>
<p>Reporte EOW: 06/09/26</p>
<p>Sem&aacute;foro Verde: (1 clientes)</p><ul><li>Cliente Tres - Activo</li></ul>
<div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a>Preguntar a alguien</p><p>segunda l&iacute;nea</p></div>
</body></html>`
  const { semanas, avisos } = I.importarHistorial(html)
  test('semanas, fecha repetida → +7 días', () => {
    assert.deepEqual(semanas.map((s) => s.semana), ['2026-09-06', '2026-09-13'])
    assert.equal(semanas[1].fechaDocumento, '2026-09-06')
    assert.ok(avisos.some((a) => /2026-09-13/.test(a)))
  })
  test('filas: colores, comentarios, continuaciones, notas al pie y pausa', () => {
    const f = semanas[0].datos.filas
    assert.deepEqual(f.map((x) => [x.cliente, x.color]), [['Cliente Uno', 'rojo'], ['Cliente Dos', 'amarillo'], ['Cliente Tres', 'verde'], ['Cliente Cuatro', 'verde']])
    assert.equal(f[0].comentario, 'Sin respuestas (Nota: Preguntar a alguien segunda línea)')
    assert.equal(f[1].comentario, 'Contestó poco Sigue en la línea de abajo.')
    assert.equal(f[3].pausado, true)
    assert.ok(f.every((x) => x.origen === 'importado'))
  })
  test('tarjetas: reclamos a Observaciones, aceptados y pendientes a pedidos', () => {
    const t = semanas[0].datos.tarjetas
    assert.deepEqual(t.pesadilla, ['Cliente Dos'])
    assert.deepEqual(t.cancelaciones, [])
    assert.deepEqual(t.testimoniosPedidos, ['Cliente Tres', 'Cliente Uno'])
    assert.deepEqual(t.testimoniosObtenidos, ['Cliente Cinco'])
    assert.deepEqual(t.servicioTerminado, ['Cliente Seis'])
    assert.deepEqual(t.pausados, ['Cliente Cuatro'])
    assert.ok(t.observaciones.includes('Reclamo: Cliente Tres por la demora'))
    assert.ok(t.observaciones.includes('Algo para decidir'))
    assert.ok(t.observaciones.includes('Verde: Nota del verde'))
  })
})

describe('vínculo con la Cartera (solo lectura)', () => {
  const cartera = [
    { id: 'A001', nombre: 'Teresa Santoni', estadoCrm: 'ACTIVO', pausaDesde: null },
    { id: 'A002', nombre: 'Julio Ejemplar', estadoCrm: 'ACTIVO', pausaDesde: '2026-11-01' },
    { id: 'A003', nombre: 'Ana Pérez', estadoCrm: 'PAUSADO', pausaDesde: null },
    { id: 'A004', nombre: 'Ana Pérez', estadoCrm: 'FINALIZADO', pausaDesde: null },
    { id: 'A005', nombre: 'Carla Gómez', estadoCrm: 'ACTIVO', pausaDesde: null },
    { id: 'A006', nombre: 'Carla Gómez', estadoCrm: 'ACTIVO', pausaDesde: null },
  ].map((c) => ({ ...c, estado: V.estadoDe(c.estadoCrm, c.pausaDesde) }))
  const vincular = V.crearVinculador(cartera)
  const fila = (cliente, extra = {}) => ({ cliente, idCrm: null, noVincular: false, pausado: false, ...extra })
  test('estado: CRM PAUSADO o pausa abierta en el Despacho = pausado', () => {
    assert.deepEqual(cartera.map((c) => c.estado), ['activo', 'pausado', 'pausado', 'finalizado', 'activo', 'activo'])
  })
  test('emparejamiento por nombre normalizado, paréntesis y cruce; dudosos sin vincular; manual manda', () => {
    assert.equal(vincular(fila('julio ejemplar')).cliente.id, 'A002')
    assert.equal(vincular(fila('Mara (Teresa Santoni)')).cliente.id, 'A001')
    assert.equal(vincular(fila('Ana Perez')).cliente.id, 'A003', 'entre dos iguales, el vigente')
    assert.equal(vincular(fila('Carla Gómez')).tipo, 'ninguno', 'dos vigentes con el mismo nombre: dudoso')
    assert.equal(vincular(fila('Desconocido Total')).tipo, 'ninguno')
    assert.deepEqual([vincular(fila('Carla Gómez', { idCrm: 'A006' })).tipo, vincular(fila('Carla Gómez', { idCrm: 'A006' })).cliente.id], ['manual', 'A006'])
    assert.equal(vincular(fila('Julio Ejemplar', { noVincular: true })).motivo, 'quitado')
    assert.equal(vincular(fila('X', { idCrm: 'Z999' })).motivo, 'id_desconocido')
  })
  test('«no coincide» cuando el EOW y la Cartera dicen distinto; link a la tarjeta', () => {
    assert.equal(V.difiereDeCartera({ pausado: false }, vincular(fila('Julio Ejemplar'))), true)
    assert.equal(V.difiereDeCartera({ pausado: true }, vincular(fila('Julio Ejemplar'))), false)
    assert.equal(V.difiereDeCartera({ pausado: true }, vincular(fila('Desconocido'))), false)
    assert.equal(V.linkCartera('a002'), '/clientes?cliente=A002')
  })
  test('el EOW NO escribe la Cartera: sin acciones ni escrituras al CRM en lib/eow', () => {
    for (const f of ['lib/eow/cartera.ts', 'lib/eow/vinculo.ts', 'lib/eow/db.ts', 'app/api/eow/route.ts']) {
      const t = readFileSync(join(RAIZ, f), 'utf8')
      assert.doesNotMatch(t, /ejecutarAccion|guardarAccion|INSERT INTO cj_cliente_acciones|UPDATE cj_cliente_acciones|crmEscribir|escritor/, f)
    }
    assert.match(readFileSync(join(RAIZ, 'lib/eow/cartera.ts'), 'utf8'), /SELECT DISTINCT ON \(id_crm\)/)
  })
  test('el modelo guarda el vínculo manual y «no vincular»', () => {
    const v = M.validarDatos({ filas: [{ cliente: 'A', color: 'verde', idCrm: 'a002' }, { cliente: 'B', color: 'rojo', noVincular: true }] })
    assert.equal(v.datos.filas[0].idCrm, 'A002')
    assert.equal(v.datos.filas[1].noVincular, true)
  })
})
