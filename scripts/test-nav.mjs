// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-nav.mjs
// Barra lateral plegable y con ancho regulable: lectura de la cookie y reglas del arrastre.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerPreferencia, escribirPreferencia, anchoVisible, alArrastrar, ANCHO_MIN, ANCHO_MAX, ANCHO_DEFECTO, ANCHO_CHICA } from '../components/shell/preferenciaNav.ts'

test('cookie: valores buenos, y cualquier otra cosa vuelve al valor por defecto', () => {
  assert.deepEqual(leerPreferencia('chica:300'), { chica: true, ancho: 300 })
  assert.deepEqual(leerPreferencia('abierta:280'), { chica: false, ancho: 280 })
  for (const raro of [undefined, null, '', 'x', 'chica', 'abierta:-5', 'abierta:abc', 'grande:300', 'abierta:300;x=1']) assert.deepEqual(leerPreferencia(raro), { chica: false, ancho: ANCHO_DEFECTO }, String(raro))
})
test('el ancho siempre queda entre el mínimo y el máximo', () => {
  assert.equal(leerPreferencia('abierta:90').ancho, ANCHO_MIN)
  assert.equal(leerPreferencia('abierta:9999').ancho, ANCHO_MAX)
  assert.equal(escribirPreferencia({ chica: false, ancho: 1000 }), `abierta:${ANCHO_MAX}`)
  assert.equal(escribirPreferencia({ chica: true, ancho: 262.6 }), 'chica:263')
})
test('la barra chica mide lo mismo siempre y recuerda el ancho para cuando se abre', () => {
  assert.equal(anchoVisible({ chica: true, ancho: 330 }), ANCHO_CHICA)
  assert.equal(anchoVisible({ chica: false, ancho: 330 }), 330)
})
test('arrastrar: muy angosto la achica (sin perder el ancho anterior); si no, abre con ese ancho', () => {
  assert.deepEqual(alArrastrar(100, { chica: false, ancho: 300 }), { chica: true, ancho: 300 })
  assert.deepEqual(alArrastrar(170, { chica: true, ancho: 300 }), { chica: false, ancho: ANCHO_MIN })
  assert.deepEqual(alArrastrar(320, { chica: true, ancho: 250 }), { chica: false, ancho: 320 })
  assert.deepEqual(alArrastrar(900, { chica: false, ancho: 250 }), { chica: false, ancho: ANCHO_MAX })
})

// Edición (24/10/2026) sigue con etiqueta e ícono propios; desde el 25/10/2026 es una pestaña de Clientes, no del menú
test('Edición: etiqueta "Edición", ícono propio y pestaña de Clientes en /clientes/edicion', async () => {
  const { readFileSync } = await import('node:fs')
  const { ETIQUETA_SECCION } = await import('../components/shell/secciones.ts')
  const { PESTANAS_CLIENTES } = await import('../lib/auth/hubClientes.ts')
  assert.equal(ETIQUETA_SECCION.edicion, 'Edición')
  assert.equal(PESTANAS_CLIENTES.find((p) => p.clave === 'edicion').href, '/clientes/edicion')
  const iconos = readFileSync(new URL('../components/shell/iconos.tsx', import.meta.url), 'utf8')
  assert.match(iconos, /^\s*edicion: <>/m)
  assert.match(iconos, /^\s*cartera: <>/m)
})

// ── Clientes como hub (25/10/2026) ─────────────────────────────────────────────────────────────────────────────────────
const H = await import('../lib/auth/hubClientes.ts')
const N = await import('../components/shell/secciones.ts')
const R = await import('../lib/auth/roles.ts')
const acceso = (secciones) => ({ rol: 'acceso', secciones })
const claves = (q) => N.menuDe(q).map((i) => i.clave)

test('menú: Resumen, Clientes, Ventas, Cobro de cuotas, Trazabilidad, Finanzas, Configuración (sin Guiones, Edición, Anuncios ni Referidos)', () => {
  assert.deepEqual(N.SECCIONES_NAV.map((s) => s.etiqueta), ['Resumen', 'Clientes', 'Ventas', 'Cobro de cuotas', 'Trazabilidad', 'Finanzas', 'Configuración'])
  assert.deepEqual(claves('socio'), ['resumen', 'clientes', 'ventas', 'cuotas', 'trazabilidad', 'finanzas', 'configuracion'])
  for (const s of ['guiones', 'edicion', 'anuncios', 'referidos']) assert.ok(!N.SECCIONES_NAV.some((i) => i.clave === s), s)
  // Toda sección sigue alcanzable: o está en el menú o es una pestaña del hub
  for (const s of R.SECCIONES) assert.ok(N.SECCIONES_NAV.some((i) => i.clave === s) || H.SECCIONES_HUB.includes(s), s)
})
test('pestañas del hub en orden: Cartera, Guiones, Edición, Anuncios, Referidos, con las secciones de siempre', () => {
  assert.deepEqual(H.PESTANAS_CLIENTES.map((p) => [p.etiqueta, p.clave, p.href]), [
    ['Cartera', 'clientes', '/clientes'], ['Guiones', 'guiones', '/guiones'], ['Edición', 'edicion', '/clientes/edicion'],
    ['Anuncios', 'anuncios', '/anuncios'], ['Referidos', 'referidos', '/clientes/referidos'], ['Cargar alta', 'altas', '/clientes/altas'],
  ])
  assert.deepEqual(H.pestanasVisibles('socio').map((p) => p.clave), ['clientes', 'guiones', 'edicion', 'anuncios', 'referidos', 'altas'])
  assert.deepEqual(H.pestanasVisibles('csm').map((p) => p.clave), ['clientes', 'referidos'])
})
test('René (solo [edicion]): ve Clientes, entra directo a Edición y ÚNICAMENTE esa pestaña (nunca la Cartera)', () => {
  const rene = acceso(['edicion'])
  assert.deepEqual(H.pestanasVisibles(rene).map((p) => p.clave), ['edicion'])
  assert.deepEqual(claves(rene), ['clientes'])
  assert.equal(N.menuDe(rene)[0].href, '/clientes/edicion')
  assert.equal(H.rutaClientes(rene), '/clientes/edicion')
})
test('Faus (solo [guiones]): Clientes lleva a /guiones; la pestaña por defecto es siempre la primera permitida', () => {
  const faus = acceso(['guiones'])
  assert.deepEqual(H.pestanasVisibles(faus).map((p) => p.clave), ['guiones'])
  assert.equal(N.menuDe(faus)[0].href, '/guiones')
  assert.equal(H.rutaClientes(acceso(['anuncios', 'referidos'])), '/anuncios')
  assert.equal(H.rutaClientes(acceso(['referidos'])), '/clientes/referidos')
  assert.equal(H.rutaClientes(acceso(['clientes', 'edicion'])), '/clientes')
  // Barrido: para cualquier combinación sin 'clientes', ni el menú ni las pestañas llevan a la Cartera
  const hub = ['guiones', 'edicion', 'anuncios', 'referidos']
  for (let m = 1; m < 1 << hub.length; m++) {
    const q = acceso(hub.filter((_, i) => m & (1 << i)))
    assert.ok(!H.pestanasVisibles(q).some((p) => p.clave === 'clientes'), q.secciones.join())
    assert.notEqual(H.rutaClientes(q), '/clientes', q.secciones.join())
    assert.equal(R.puedeVer(q, 'clientes'), false)
  }
})
test('sin ninguna pestaña no hay Clientes en el menú (closer, setter, solo Ventas)', () => {
  // Los closers no cargan altas (decisión de Tomás, 26/10/2026): el rol closer no tiene ninguna pestaña del hub
  for (const q of ['closer', 'setter', acceso(['ventas', 'cuotas']), acceso([])]) {
    assert.equal(H.veClientes(q), false)
    assert.ok(!claves(q).includes('clientes'))
  }
  assert.equal(H.veClientes('csm'), true)
})
test('pestaña activa según la ruta: la ficha y su kickoff son Cartera; Edición y Referidos ganan a /clientes', () => {
  const casos = [
    ['/clientes', 'clientes'], ['/clientes/', 'clientes'], ['/clientes/A101', 'clientes'], ['/clientes/A101/kickoff', 'clientes'],
    ['/clientes/edicion', 'edicion'], ['/clientes/edicion/video/7', 'edicion'], ['/clientes/referidos', 'referidos'],
    ['/guiones', 'guiones'], ['/guiones/A101', 'guiones'], ['/anuncios', 'anuncios'], ['/anuncios/login', 'anuncios'],
    ['/ventas', null], ['/clientesx', null], ['/', null],
  ]
  for (const [ruta, esperado] of casos) assert.equal(H.pestanaActiva(ruta), esperado, ruta)
})
test('"Clientes" del menú queda activo en todas las pestañas, también en /guiones y /anuncios', () => {
  const it = N.SECCIONES_NAV.find((i) => i.clave === 'clientes')
  assert.deepEqual([...it.prefijos], ['/clientes', '/guiones', '/anuncios'])
})
test('Configuración nombra las pestañas como "Clientes · …" (las claves de la planilla no cambian)', () => {
  assert.equal(N.ETIQUETA_ACCESO.clientes, 'Clientes · Cartera')
  assert.equal(N.ETIQUETA_ACCESO.edicion, 'Clientes · Edición')
  assert.equal(N.ETIQUETA_ACCESO.ventas, 'Ventas')
})
test('ficha: accesos rápidos solo a las pestañas que la persona tiene', async () => {
  const { readFileSync } = await import('node:fs')
  const fuente = readFileSync(new URL('../app/(shell)/clientes/[id]/_componentes/AccesosCliente.tsx', import.meta.url), 'utf8')
  assert.match(fuente, /puedeVer\(quien, 'guiones'\)/)
  assert.match(fuente, /puedeVer\(quien, 'edicion'\)/)
  assert.match(fuente, /`\/guiones\/\$\{enc\}`/)
  assert.match(fuente, /`\/clientes\/edicion\/cliente\/\$\{enc\}`/)
})
test('usuario de prueba "acceso" (solo desarrollo): CRM_DEV_SECCIONES, sin configuracion ni claves inventadas', async () => {
  const { seccionesDePrueba } = await import('../lib/auth/identidad.ts')
  assert.deepEqual(seccionesDePrueba('edicion'), ['edicion'])
  assert.deepEqual(seccionesDePrueba(' Referidos , guiones,configuracion,nada'), ['guiones', 'referidos'])
  assert.deepEqual(seccionesDePrueba(undefined), [])
})

// ── Segunda pasada de diseño (25/10/2026): tarjetas sobrias, estados con ícono y texto, datos de ejemplo solo en desarrollo ──
test('tarjetas: sin brillos ni degradados, y el estado siempre lleva ícono y texto', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(new URL('../components/ui/tarjetas.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /gradient|text-shadow|blur\(|glow/i)
  const tsx = readFileSync(new URL('../components/ui/Tarjetas.tsx', import.meta.url), 'utf8')
  assert.match(tsx, /<Icono nombre=\{ICONO_TONO\[tono\]\} \/>\s*<span>\{children\}<\/span>/)
  for (const n of ['ok', 'atencion', 'alerta', 'pausa', 'neutro', 'flecha']) assert.match(readFileSync(new URL('../components/shell/iconos.tsx', import.meta.url), 'utf8'), new RegExp(`^\\s*${n}: <>`, 'm'), n)
})
test('Anuncios de ejemplo: seis cuentas "(ejemplo)" con las reglas reales, y la pantalla solo los pide fuera de producción', async () => {
  const { readFileSync } = await import('node:fs')
  const { tableroDemo } = await import('../lib/anuncios/demo.ts')
  const t = tableroDemo('2026-10-25')
  assert.equal(t.filas.length, 6)
  assert.ok(t.filas.every((f) => /\(ejemplo\)/.test(f.cliente)))
  assert.equal(t.resumen.total, 6)
  const tablero = readFileSync(new URL('../components/anuncios/TableroAnuncios.tsx', import.meta.url), 'utf8')
  assert.match(tablero, /process\.env\.NODE_ENV !== 'production' && new URLSearchParams\(window\.location\.search\)\.get\('demo'\) === '1'/)
  assert.doesNotMatch(readFileSync(new URL('../lib/anuncios/demo.ts', import.meta.url), 'utf8'), /^import \{[^}]*\} from '\.\/tablero'/m, 'demo.ts va al navegador: de tablero.ts solo tipos')
})
test('Cartera y Guiones de ejemplo usan pedidoDemo (solo desarrollo) y no consultan fuentes de afuera', async () => {
  const { readFileSync } = await import('node:fs')
  const cartera = readFileSync(new URL('../app/(shell)/clientes/(cartera)/page.tsx', import.meta.url), 'utf8')
  assert.match(cartera, /const demo = pedidoDemo\(params\.demo\)/)
  // 25/10/2026: las fuentes de afuera se leen en _componentes/EnVivo.tsx (streaming); la página le pasa la vista (con esDemo)
  assert.match(cartera, /from '\.\/_componentes\/EnVivo'/)
  const enVivo = readFileSync(new URL('../app/(shell)/clientes/(cartera)/_componentes/EnVivo.tsx', import.meta.url), 'utf8')
  assert.match(enVivo, /vista\.esDemo \? \{ tareas: \[\], aviso: null \} : tareasClickUp\(\)/)
  assert.match(enVivo, /vista\.esDemo \? \{ porCliente: new Map\(\), aviso: null \} : campanasMetaCartera\(\)/)
  const guiones = readFileSync(new URL('../app/(shell)/guiones/page.tsx', import.meta.url), 'utf8')
  assert.match(guiones, /const demo = pedidoDemo\(\(await searchParams\)\.demo\)/)
})
