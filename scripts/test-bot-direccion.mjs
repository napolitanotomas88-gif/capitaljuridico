// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-direccion.mjs
// Dirección del cliente para el contrato (lib/bot/alta/direccion.ts y direccionClaude.ts) y su uso en PandaDoc.
// Sin red: Claude y PandaDoc van con clientes falsos. Direcciones y teléfonos inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  separarDireccion, paisPorTelefono, reglasAlcanzan, faltantesDireccion, combinarConClaude, claveTexto, FALTANTE_CIUDAD_PROVINCIA,
  FALTANTE_CONFIRMAR_CIUDAD,
} from '../lib/bot/alta/direccion.ts'
import { separarDireccionConClaude, resolverDireccion, MODELO_DIRECCION, TOPE_DIRECCION_MS } from '../lib/bot/alta/direccionClaude.ts'
import {
  crearBorradorContrato, clavePandaDoc, enviarContrato, textoAvisoBorrador, ContratoEnSandbox, TOPE_ESTADO_MS,
} from '../lib/bot/alta/pandadoc.ts'

// Candado: nada sale a la red (ni Anthropic ni PandaDoc)
globalThis.fetch = async () => { throw new Error('red prohibida en tests') }
delete process.env.ANTHROPIC_API_KEY
delete process.env.BOT_ANTHROPIC_API_KEY

const CABA = ['CABA', 'Ciudad Autónoma de Buenos Aires', 'Argentina']

// [texto, teléfono, calle, ciudad, provincia, país, confianza]
const CASOS = [
  ['Calle 18 1017, B1906 La Plata, Provincia de Buenos Aires, Argentina', '+54 9 221 400-0000', 'Calle 18 1017', 'La Plata', 'Buenos Aires', 'Argentina', 'alta'],
  ['Sarmiento 1452 4B CABA', '+54 9 11 3000-1111', 'Sarmiento 1452 4B', ...CABA, 'alta'],
  ['Ave. Winston Churchill 95, Santo Domingo', '+1 849 555 0101', 'Ave. Winston Churchill 95', 'Santo Domingo', 'Distrito Nacional', 'República Dominicana', 'alta'],
  ['1 de mayo 1665 mar del plata', '5492234000000', '1 de mayo 1665', 'Mar del Plata', 'Buenos Aires', 'Argentina', 'alta'],
  ['Av. Córdoba 3500, Piso 2, Capital Federal', '5491130001111', 'Av. Córdoba 3500, Piso 2', ...CABA, 'alta'],
  ['Bv. Oroño 845, Rosario, Santa Fe', null, 'Bv. Oroño 845', 'Rosario', 'Santa Fe', 'Argentina', 'alta'],
  ['Av. 18 de Julio 1234 apto 501, Montevideo', '+598 99 123 456', 'Av. 18 de Julio 1234 apto 501', 'Montevideo', 'Montevideo', 'Uruguay', 'alta'],
  ['Jr. de la Unión 456, Lima, Perú', '+51 987 654 321', 'Jr. de la Unión 456', 'Lima', 'Lima', 'Perú', 'alta'],
  ['Carrera 7 # 71-21, Bogotá', '+57 300 123 4567', 'Carrera 7 # 71-21', 'Bogotá', 'Bogotá D.C.', 'Colombia', 'alta'],
  ['Calle Mayor 10, 28013 Madrid, España', '+34 600 111 222', 'Calle Mayor 10', 'Madrid', 'Comunidad de Madrid', 'España', 'alta'],
  ['Av. Santa Fe 1234, Palermo, Buenos Aires', '5491130001111', 'Av. Santa Fe 1234, Palermo', ...CABA, 'alta'],
  ['Calle 3 789 La Plata Buenos Aires', null, 'Calle 3 789', 'La Plata', 'Buenos Aires', 'Argentina', 'alta'],
  ['Calle Ficticia 123, San Pedro, Buenos Aires', null, 'Calle Ficticia 123', 'San Pedro', 'Buenos Aires', 'Argentina', 'alta'],
  // Unidad o barrio antes de la provincia: se queda en la calle (nunca es la ciudad)
  ['San Martín 500, Centro, Mendoza', '5492614000000', 'San Martín 500, Centro', 'Mendoza', 'Mendoza', 'Argentina', 'alta'],
  ['Av. Colón 1234, Dpto B, Córdoba', '5493514000000', 'Av. Colón 1234, Dpto B', 'Córdoba', 'Córdoba', 'Argentina', 'alta'],
  ['Av. Colón 1234, PB, Córdoba', '5493514000000', 'Av. Colón 1234, PB', 'Córdoba', 'Córdoba', 'Argentina', 'alta'],
  ['Av. Colón 1234, Planta Baja, Córdoba', '5493514000000', 'Av. Colón 1234, Planta Baja', 'Córdoba', 'Córdoba', 'Argentina', 'alta'],
  ['Av. Colón 1234, Oficina A, Córdoba', '5493514000000', 'Av. Colón 1234, Oficina A', 'Córdoba', 'Córdoba', 'Argentina', 'alta'],
  ['Av. Colón 1234, Torre Norte, Córdoba', '5493514000000', 'Av. Colón 1234, Torre Norte', 'Córdoba', 'Córdoba', 'Argentina', 'alta'],
  ['Calle 1 123, B° Güemes, Córdoba', '5493514000000', 'Calle 1 123, B° Güemes', 'Córdoba', 'Córdoba', 'Argentina', 'alta'],
  ['Calle 1 123, Barrio Centro, Santa Fe', null, 'Calle 1 123, Barrio Centro', 'Santa Fe', 'Santa Fe', 'Argentina', 'alta'],
  ['Calle 1 123, Mz 4, Lote 5, Pilar, Buenos Aires', '5491130001111', 'Calle 1 123, Mz 4, Lote 5', 'Pilar', 'Buenos Aires', 'Argentina', 'alta'],
  // Las reglas no alcanzan: confianza baja (el servidor le pregunta a Claude)
  ['Belgrano 450, Pehuajó', '5492396400000', 'Belgrano 450', 'Pehuajó', '', 'Argentina', 'baja'],
  ['Calle 1 123', '5491130001111', 'Calle 1 123', '', '', 'Argentina', 'baja'],
  ['Av. Rivadavia 5000, Buenos Aires', '5491130001111', 'Av. Rivadavia 5000', '', 'Buenos Aires', 'Argentina', 'baja'],
  // Localidad fuera del catálogo antes de una provincia: se acepta por posición, pero nunca con confianza alta
  ['San Martín 500, Villa Allende, Córdoba', '5493514000000', 'San Martín 500', 'Villa Allende', 'Córdoba', 'Argentina', 'baja'],
  ['Obispo Trejo 300, Nueva Córdoba, Córdoba', '5493514000000', 'Obispo Trejo 300', 'Nueva Córdoba', 'Córdoba', 'Argentina', 'baja'],
  // El depto no es la ciudad ("Buenos Aires" solo es ambiguo: queda sin ciudad)
  ['Av. Corrientes 1234, Depto B, Buenos Aires', '5491130001111', 'Av. Corrientes 1234, Depto B', '', 'Buenos Aires', 'Argentina', 'baja'],
  ['Av. Corrientes 1234, Depto B', '5491130001111', 'Av. Corrientes 1234, Depto B', '', '', 'Argentina', 'baja'],
]

for (const [texto, tel, calle, ciudad, provincia, pais, confianza] of CASOS) {
  test(`separarDireccion: ${texto}`, () => {
    assert.deepEqual(separarDireccion(texto, tel), { calle, ciudad, provincia, pais, confianza })
  })
}

test('calles con nombre de ciudad o de país no pierden el nombre', () => {
  assert.deepEqual(separarDireccion('Av. Córdoba 1234', '5491130001111'), { calle: 'Av. Córdoba 1234', ciudad: '', provincia: '', pais: 'Argentina', confianza: 'baja' })
  assert.equal(separarDireccion('Calle Mendoza', null).calle, 'Calle Mendoza')
  assert.equal(separarDireccion('Calle Mendoza', null).ciudad, '')
  assert.equal(separarDireccion('Calle Ficticia 123 San Pedro Buenos Aires', null).calle, 'Calle Ficticia 123')
  // Un depto con 4 cifras no es un código postal
  assert.equal(separarDireccion('Av. Libertador 5000, Dto 1203, CABA', null).calle, 'Av. Libertador 5000, Dto 1203')
})

test('ninguna palabra de unidad o barrio queda como ciudad con confianza alta', () => {
  const unidades = ['Depto B', 'Dpto. B', 'Departamento 4', 'Dto B', 'Piso 3', 'PB', 'Planta Baja', 'Of. A', 'Oficina A', 'Local 5',
    'Torre Norte', 'Casa 12', 'Lote 5', 'Manzana C', 'Mz C', 'UF 12', 'Unidad 3', 'Block 2', 'Centro', 'Apto 501', 'Edificio Sur',
    'Barrio Jardín', 'Bo Jardín', 'B° Jardín']
  for (const u of unidades) {
    for (const prov of ['Buenos Aires', 'Córdoba', 'Mendoza']) {
      const r = separarDireccion(`Av. Siempreviva 742, ${u}, ${prov}`, '5491130001111')
      assert.notEqual(r.ciudad, u, `${u}, ${prov}`)
      assert.ok(r.calle.endsWith(u), `${u}, ${prov}: la unidad queda en la calle (${r.calle})`)
    }
  }
  // "Departamento de …" no es una unidad: se toma como localidad por posición, con confianza baja
  const depto = separarDireccion('Ruta 5 km 3, Departamento de Lavalle, Mendoza', '5492614000000')
  assert.deepEqual([depto.ciudad, depto.provincia, depto.confianza], ['Departamento de Lavalle', 'Mendoza', 'baja'])
})

test('el teléfono desempata ciudades con el mismo nombre (y sin teléfono queda en duda)', () => {
  assert.deepEqual(separarDireccion('Av. Colón 1234, Córdoba', '+34 600 111 222'), { calle: 'Av. Colón 1234', ciudad: 'Córdoba', provincia: 'Andalucía', pais: 'España', confianza: 'alta' })
  assert.deepEqual(separarDireccion('Av. Colón 1234, Córdoba', '5493514000000'), { calle: 'Av. Colón 1234', ciudad: 'Córdoba', provincia: 'Córdoba', pais: 'Argentina', confianza: 'alta' })
  assert.equal(separarDireccion('Av. Colón 1234, Córdoba', null).confianza, 'baja')
  // La provincia escrita manda: San Pedro de Buenos Aires, no el de Jujuy
  assert.equal(separarDireccion('Mitre 100, San Pedro, Jujuy', null).provincia, 'Jujuy')
})

test('barrio porteño sin ciudad: CABA con confianza baja', () => {
  assert.deepEqual(separarDireccion('Calle 1 123, Flores', '5491130001111'), { calle: 'Calle 1 123, Flores', ...{ ciudad: CABA[0], provincia: CABA[1], pais: CABA[2] }, confianza: 'baja' })
})

test('dirección vacía: solo el país del teléfono', () => {
  assert.deepEqual(separarDireccion('', '+598 99 123 456'), { calle: '', ciudad: '', provincia: '', pais: 'Uruguay', confianza: 'baja' })
  assert.deepEqual(separarDireccion(null), { calle: '', ciudad: '', provincia: '', pais: '', confianza: 'baja' })
})

test('paisPorTelefono: códigos de la región y el +1 del Caribe', () => {
  assert.equal(paisPorTelefono('+54 9 11 3000-1111'), 'Argentina')
  assert.equal(paisPorTelefono('5491130001111'), 'Argentina')
  assert.equal(paisPorTelefono('+598 99 123 456'), 'Uruguay')
  assert.equal(paisPorTelefono('+51 987 654 321'), 'Perú')
  assert.equal(paisPorTelefono('+57 300 123 4567'), 'Colombia')
  assert.equal(paisPorTelefono('+56 9 1234 5678'), 'Chile')
  assert.equal(paisPorTelefono('+52 55 1234 5678'), 'México')
  assert.equal(paisPorTelefono('+34 600 111 222'), 'España')
  assert.equal(paisPorTelefono('+1 849 555 0101'), 'República Dominicana')
  assert.equal(paisPorTelefono('+1 305 555 0101'), '')   // EE.UU. o Canadá: no se sabe
  assert.equal(paisPorTelefono(''), '')
  assert.equal(paisPorTelefono(null), '')
})

test('reglasAlcanzan, faltantesDireccion y claveTexto', () => {
  assert.equal(reglasAlcanzan(separarDireccion('Sarmiento 1452 4B CABA')), true)
  assert.equal(reglasAlcanzan(separarDireccion('Belgrano 450, Pehuajó')), false)
  assert.deepEqual(faltantesDireccion({ ciudad: 'La Plata', provincia: 'Buenos Aires' }), [])
  assert.deepEqual(faltantesDireccion({ ciudad: 'Pehuajó', provincia: ' ' }), [FALTANTE_CIUDAD_PROVINCIA])
  assert.equal(FALTANTE_CIUDAD_PROVINCIA, 'Ciudad y provincia del cliente')
  // Llenas pero sin verificar: se piden confirmar; vacías gana el faltante de siempre
  assert.deepEqual(faltantesDireccion({ ciudad: 'Córdoba', provincia: 'Córdoba' }, true), [FALTANTE_CONFIRMAR_CIUDAD])
  assert.deepEqual(faltantesDireccion({ ciudad: 'Pehuajó', provincia: '' }, true), [FALTANTE_CIUDAD_PROVINCIA])
  assert.match(FALTANTE_CONFIRMAR_CIUDAD, /^Confirmar ciudad y provincia/)
  assert.equal(claveTexto('C.A.B.A.'), 'caba')
  assert.equal(claveTexto('  Pcia. de Bs. As. '), 'pcia de bs as')
})

test('combinarConClaude: ciudad y provincia de Claude (vacías si no sabe), calle y país de respaldo', () => {
  const reglas = separarDireccion('Belgrano 450, Pehuajó', '5492396400000')
  assert.deepEqual(combinarConClaude(reglas, { calle: 'Belgrano 450', ciudad: 'Pehuajó', provincia: 'Buenos Aires', pais: 'Argentina' }),
    { calle: 'Belgrano 450', ciudad: 'Pehuajó', provincia: 'Buenos Aires', pais: 'Argentina', confianza: 'baja' })
  // Claude no sabe la ciudad: no se rellena con la conjetura de las reglas
  assert.deepEqual(combinarConClaude(reglas, { calle: '', ciudad: '', provincia: '', pais: '' }),
    { calle: 'Belgrano 450', ciudad: '', provincia: '', pais: 'Argentina', confianza: 'baja' })
  // La CABA se escribe siempre igual; el país, como en el catálogo
  assert.deepEqual(combinarConClaude(reglas, { calle: 'X 1', ciudad: 'Capital Federal', provincia: 'Buenos Aires', pais: 'argentina' }),
    { calle: 'X 1', ciudad: 'CABA', provincia: 'Ciudad Autónoma de Buenos Aires', pais: 'Argentina', confianza: 'baja' })
})

// ── Claude con un cliente falso ─────────────────────────────────────────────────────────────────────

function claudeFalso(respuesta) {
  const pedidos = []
  const cliente = {
    messages: {
      create: async (cuerpo, opciones) => {
        pedidos.push({ cuerpo, opciones })
        if (respuesta instanceof Error) throw respuesta
        return typeof respuesta === 'function' ? respuesta(cuerpo) : respuesta
      },
    },
  }
  return { cliente, pedidos }
}
const mensaje = (json, extra = {}) => ({
  stop_reason: 'end_turn', stop_details: null,
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
  ...extra,
})

test('separarDireccionConClaude: Haiku 5.5, JSON estricto, esfuerzo bajo y pista del teléfono', async () => {
  const { cliente, pedidos } = claudeFalso(mensaje({ calle: ' Belgrano 450 ', ciudad: 'Pehuajó', provincia: 'Buenos Aires', pais: 'Argentina' }))
  const r = await separarDireccionConClaude('Belgrano 450,  Pehuajó', { cliente, paisTelefono: 'Argentina' })
  assert.deepEqual(r, { calle: 'Belgrano 450', ciudad: 'Pehuajó', provincia: 'Buenos Aires', pais: 'Argentina', confianza: 'baja' })
  const { cuerpo, opciones } = pedidos[0]
  assert.equal(MODELO_DIRECCION, 'claude-haiku-5-5')
  assert.equal(cuerpo.model, 'claude-haiku-5-5')
  assert.equal(cuerpo.output_config.effort, 'low')
  assert.equal(cuerpo.output_config.format.type, 'json_schema')
  assert.deepEqual(cuerpo.output_config.format.schema.required, ['calle', 'ciudad', 'provincia', 'pais'])
  assert.equal(cuerpo.output_config.format.schema.additionalProperties, false)
  assert.equal(cuerpo.thinking, undefined)          // Haiku 5.5: adaptativo por defecto, se regula con el esfuerzo
  assert.equal(cuerpo.temperature, undefined)       // Haiku 5.5 rechaza temperature distinta de la de fábrica
  assert.match(cuerpo.system, /No inventes/)
  assert.equal(cuerpo.messages[0].content, 'Dirección: Belgrano 450, Pehuajó\nPaís del teléfono del cliente (solo pista): Argentina')
  // 8 s y sin reintentos: con los 30 s de PandaDoc entra en una función de Vercel de 60 s
  assert.deepEqual(opciones, { timeout: 8000, maxRetries: 0 })
  assert.equal(TOPE_DIRECCION_MS, 8000)
  assert.ok(TOPE_DIRECCION_MS + TOPE_ESTADO_MS <= 45_000)
})

test('separarDireccionConClaude: rechazo, corte, JSON inválido y falta de clave son errores', async () => {
  await assert.rejects(separarDireccionConClaude('X 1', { cliente: claudeFalso(mensaje('{}', { stop_reason: 'refusal', stop_details: { category: 'cyber' } })).cliente }), /rechazó.*cyber/)
  await assert.rejects(separarDireccionConClaude('X 1', { cliente: claudeFalso(mensaje('{"calle":', { stop_reason: 'max_tokens' })).cliente }), /max_tokens/)
  await assert.rejects(separarDireccionConClaude('X 1', { cliente: claudeFalso(mensaje('no es json')).cliente }), /no es JSON válido/)
  await assert.rejects(separarDireccionConClaude('X 1', { cliente: claudeFalso(mensaje('[1]')).cliente }), /no es un objeto/)
  await assert.rejects(separarDireccionConClaude('X 1'), /falta BOT_ANTHROPIC_API_KEY/)
  await assert.rejects(separarDireccionConClaude('   ', { cliente: claudeFalso(mensaje({})).cliente }), /dirección vacía/)
  // Campos que no son texto vuelven vacíos (nunca se inventa)
  const raro = await separarDireccionConClaude('X 1', { cliente: claudeFalso(mensaje({ calle: 'X 1', ciudad: null, provincia: 3, pais: 'Argentina' })).cliente })
  assert.deepEqual(raro, { calle: 'X 1', ciudad: '', provincia: '', pais: 'Argentina', confianza: 'baja' })
})

test('resolverDireccion: si las reglas alcanzan no llama a Claude', async () => {
  const { cliente, pedidos } = claudeFalso(new Error('no debería llamarse'))
  const r = await resolverDireccion('Sarmiento 1452 4B CABA', '+54 9 11 3000-1111', { cliente })
  assert.equal(pedidos.length, 0)
  assert.deepEqual(r, { calle: 'Sarmiento 1452 4B', ciudad: CABA[0], provincia: CABA[1], pais: CABA[2], confianza: 'alta', fuente: 'reglas', avisos: [], faltantes: [] })
})

test('resolverDireccion: con confianza baja pregunta a Claude y avisa que hay que revisarlo', async () => {
  const { cliente, pedidos } = claudeFalso(mensaje({ calle: 'Belgrano 450', ciudad: 'Pehuajó', provincia: 'Buenos Aires', pais: 'Argentina' }))
  const r = await resolverDireccion('Belgrano 450, Pehuajó', '5492396400000', { cliente })
  assert.equal(pedidos.length, 1)
  assert.match(pedidos[0].cuerpo.messages[0].content, /solo pista\): Argentina$/)
  assert.deepEqual(r, {
    calle: 'Belgrano 450', ciudad: 'Pehuajó', provincia: 'Buenos Aires', pais: 'Argentina', confianza: 'baja', fuente: 'claude',
    avisos: ['Ciudad y provincia deducidas por Claude (Pehuajó, Buenos Aires): revisarlas en el borrador'], faltantes: [],
  })
  // Claude tampoco sabe: queda el faltante para el closer
  const nada = await resolverDireccion('Calle 1 123', '5491130001111', { cliente: claudeFalso(mensaje({ calle: 'Calle 1 123', ciudad: '', provincia: '', pais: '' })).cliente })
  assert.deepEqual([nada.fuente, nada.ciudad, nada.pais, nada.avisos, nada.faltantes], ['claude', '', 'Argentina', [], [FALTANTE_CIUDAD_PROVINCIA]])
})

test('resolverDireccion: sin clave o con Claude caído sigue con las reglas, avisa y nunca tira error', async () => {
  const sinClave = await resolverDireccion('Belgrano 450, Pehuajó', '5492396400000')
  assert.equal(sinClave.fuente, 'reglas')
  assert.match(sinClave.avisos[0], /Sin clave de Claude/)
  assert.deepEqual(sinClave.faltantes, [FALTANTE_CIUDAD_PROVINCIA])
  const caido = await resolverDireccion('Belgrano 450, Pehuajó', '5492396400000', { cliente: claudeFalso(new Error('se cortó la conexión')).cliente })
  assert.deepEqual([caido.fuente, caido.ciudad, caido.provincia], ['reglas', 'Pehuajó', ''])
  assert.deepEqual(caido.avisos, ['No se pudo separar la dirección con Claude: se cortó la conexión'])
  assert.deepEqual(caido.faltantes, [FALTANTE_CIUDAD_PROVINCIA])
})

test('resolverDireccion: la conjetura de las reglas sin Claude (llena, confianza baja) se pide confirmar, no solo se avisa', async () => {
  // Sin teléfono, Córdoba puede ser de Argentina o de España: las reglas eligen una, pero nadie lo verificó
  const cordoba = await resolverDireccion('Av. Colón 1234, Córdoba', null)
  assert.deepEqual([cordoba.fuente, cordoba.ciudad, cordoba.provincia, cordoba.confianza], ['reglas', 'Córdoba', 'Córdoba', 'baja'])
  assert.deepEqual(cordoba.faltantes, [FALTANTE_CONFIRMAR_CIUDAD])
  assert.match(cordoba.avisos[0], /Sin clave de Claude/)
  // Barrio porteño sin ciudad: CABA probable, a confirmar
  const micro = await resolverDireccion('Florida 100, Microcentro', null, { cliente: claudeFalso(new Error('caído')).cliente })
  assert.deepEqual([micro.ciudad, micro.faltantes], ['CABA', [FALTANTE_CONFIRMAR_CIUDAD]])
  // Localidad por posición ("Nueva Córdoba" es un barrio): ahora va a Claude, y sin Claude se pide confirmar
  const nueva = await resolverDireccion('Obispo Trejo 300, Nueva Córdoba, Córdoba', '5493514000000')
  assert.deepEqual([nueva.ciudad, nueva.faltantes], ['Nueva Córdoba', [FALTANTE_CONFIRMAR_CIUDAD]])
  const conClaude = claudeFalso(mensaje({ calle: 'Obispo Trejo 300, Nueva Córdoba', ciudad: 'Córdoba', provincia: 'Córdoba', pais: 'Argentina' }))
  const corregida = await resolverDireccion('Obispo Trejo 300, Nueva Córdoba, Córdoba', '5493514000000', { cliente: conClaude.cliente })
  assert.equal(conClaude.pedidos.length, 1)
  assert.deepEqual([corregida.fuente, corregida.calle, corregida.ciudad, corregida.faltantes], ['claude', 'Obispo Trejo 300, Nueva Córdoba', 'Córdoba', []])
  // Con confianza alta no hay nada que confirmar
  assert.deepEqual((await resolverDireccion('Av. Colón 1234, Córdoba', '5493514000000')).faltantes, [])
})

// ── PandaDoc: clave y dirección en el borrador (fetch falso) ────────────────────────────────────────

/** Corre `f` con esas variables de entorno (undefined = sin la variable) y después deja todo como estaba. */
async function conEntorno(vars, f) {
  const antes = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]))
  const poner = o => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  poner(vars)
  try { return await f() } finally { poner(antes) }
}
const SIN_ENTORNO = { PANDADOC_API_KEY: undefined, PANDADOC_API_KEY_SANDBOX: undefined, PANDADOC_USAR_SANDBOX: undefined, VERCEL_ENV: undefined }

test('clavePandaDoc: opciones, después producción y la sandbox solo fuera de producción', async () => {
  await conEntorno({ ...SIN_ENTORNO, PANDADOC_API_KEY: 'PROD', PANDADOC_API_KEY_SANDBOX: 'SAND' }, () => {
    assert.deepEqual(clavePandaDoc({ apiKey: 'X' }), { clave: 'X', origen: 'opciones.apiKey' })
    assert.deepEqual(clavePandaDoc({ apiKey: 'SAND' }), { clave: 'SAND', origen: 'PANDADOC_API_KEY_SANDBOX' })   // se reconoce
    assert.deepEqual(clavePandaDoc(), { clave: 'PROD', origen: 'PANDADOC_API_KEY' })
    process.env.PANDADOC_API_KEY = '  '
    assert.deepEqual(clavePandaDoc(), { clave: 'SAND', origen: 'PANDADOC_API_KEY_SANDBOX' })   // local o preview
    process.env.VERCEL_ENV = 'preview'
    assert.deepEqual(clavePandaDoc(), { clave: 'SAND', origen: 'PANDADOC_API_KEY_SANDBOX' })
    // Producción sin la clave de producción: error (los contratos reales no van a la sandbox por descuido)
    process.env.VERCEL_ENV = 'production'
    assert.throws(() => clavePandaDoc(), /falta PANDADOC_API_KEY \(producción\).*PANDADOC_USAR_SANDBOX=1/)
    // Salvo pedido explícito
    process.env.PANDADOC_USAR_SANDBOX = '1'
    assert.deepEqual(clavePandaDoc(), { clave: 'SAND', origen: 'PANDADOC_API_KEY_SANDBOX' })
    // PANDADOC_USAR_SANDBOX=1 fuerza la sandbox aunque esté la de producción; sin la de sandbox, error
    process.env.PANDADOC_API_KEY = 'PROD'
    assert.deepEqual(clavePandaDoc(), { clave: 'SAND', origen: 'PANDADOC_API_KEY_SANDBOX' })
    delete process.env.PANDADOC_API_KEY_SANDBOX
    assert.throws(() => clavePandaDoc(), /PANDADOC_USAR_SANDBOX=1 pero falta PANDADOC_API_KEY_SANDBOX/)
  })
  await conEntorno(SIN_ENTORNO, () => {
    assert.throws(() => clavePandaDoc(), /falta la API key \(PANDADOC_API_KEY o PANDADOC_API_KEY_SANDBOX\)/)
  })
})

test('enviarContrato se niega con la clave de sandbox, sin ningún pedido', async () => {
  const pedidos = []
  const f = async (url) => { pedidos.push(url); throw new Error('no debería pedir nada') }
  await conEntorno({ ...SIN_ENTORNO, PANDADOC_API_KEY_SANDBOX: 'SAND' }, async () => {
    await assert.rejects(enviarContrato('docS', 'Hola', { fetch: f }), e => e instanceof ContratoEnSandbox && /docS.*sandbox/.test(e.message))
    await assert.rejects(enviarContrato('docS', 'Hola', { apiKey: 'SAND', fetch: f }), ContratoEnSandbox)
  })
  assert.equal(pedidos.length, 0)
})

test('textoAvisoBorrador: siempre dice la clave; la sandbox, bien a la vista; faltantes y avisos de la dirección', () => {
  const base = {
    nombre: 'Contrato - Ana Inventada - C.J', link: 'https://app.pandadoc.com/a/#/documents/d1', estado: 'document.draft',
    faltantes: [], clave: 'PANDADOC_API_KEY', direccion: null,
  }
  assert.equal(textoAvisoBorrador(base), [
    'Contrato - Ana Inventada - C.J: borrador en PandaDoc. El closer lo revisa y confirma antes de mandarlo a firmar.',
    'https://app.pandadoc.com/a/#/documents/d1',
    'Clave: producción.',
  ].join('\n'))
  const sandbox = textoAvisoBorrador({
    ...base, clave: 'PANDADOC_API_KEY_SANDBOX', estado: 'document.uploaded', faltantes: [FALTANTE_CONFIRMAR_CIUDAD],
    direccion: { avisos: ['Sin clave de Claude (BOT_ANTHROPIC_API_KEY): la dirección se separó solo con reglas'] },
  })
  assert.match(sandbox, /⚠ Clave: SANDBOX\. Es un borrador de prueba con marca de agua: no se puede mandar a firmar\./)
  assert.match(sandbox, /todavía lo está procesando \(document\.uploaded\)/)
  assert.match(sandbox, /Falta: Confirmar ciudad y provincia del cliente \(deducidas sin verificar\)\./)
  assert.match(sandbox, /Dirección: Sin clave de Claude \(BOT_ANTHROPIC_API_KEY\): la dirección se separó solo con reglas\.$/)
  assert.match(textoAvisoBorrador({ ...base, clave: 'opciones.apiKey' }), /Clave: la que se pasó al crearlo/)
  assert.ok(!/firma(rlo)? solo|se manda a firmar y/i.test(sandbox))
})

const alta = (o = {}) => ({
  etiquetaAlta: true, closer: 'Marcos', programa: 'Agencia', modalidad: 'PIF', totalUsd: 3300, estePagoUsd: 3300,
  medioPago: 'Transferencia USD', pagoEnPesos: null,
  nombre: 'Ana Inventada', telefonos: [{ numero: '5492396400000', etiqueta: '' }], socios: null,
  correo: 'ana.inventada@example.com', direccion: 'Belgrano 450, Pehuajó', dni: '30222333', cuit: null,
  inicio: '2026-10-26', contrato: 'normal', cuotas: [], faltantes: [], avisos: [],
  ...o,
})

function pandadocFalso() {
  const llamadas = []
  const respuestas = [{ status: 201, body: { id: 'docD', status: 'document.draft' } }]
  const f = async (url, init) => {
    llamadas.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers })
    const r = respuestas.shift()
    if (!r) throw new Error('pedido de más')
    return new Response(JSON.stringify(r.body), { status: r.status })
  }
  return { f, llamadas }
}
const tokens = llamada => Object.fromEntries(llamada.body.tokens.map(t => [t.name, t.value]))

test('crearBorradorContrato: la dirección resuelta llena City/State/Country y StreetAddress lleva solo la calle', async () => {
  const pd = pandadocFalso()
  const vistos = []
  const r = await crearBorradorContrato(alta(), {
    apiKey: 'K', fetch: pd.f, esperar: async () => {},
    direccion: async (texto, tel) => {
      vistos.push([texto, tel])
      return { calle: 'Belgrano 450', ciudad: 'Pehuajó', provincia: 'Buenos Aires', pais: 'Argentina', confianza: 'baja', fuente: 'claude', avisos: ['revisar'], faltantes: [] }
    },
  })
  assert.deepEqual(vistos, [['Belgrano 450, Pehuajó', '5492396400000']])
  const t = tokens(pd.llamadas[0])
  assert.deepEqual([t['Client.StreetAddress'], t['Client.City'], t['Client.State'], t['Client.Country']], ['Belgrano 450', 'Pehuajó', 'Buenos Aires', 'Argentina'])
  assert.equal(t['TU DIRECCIÓN EN ARGENTINA'], 'Calle Ficticia 123, Ciudad Ejemplo, Provincia Ejemplo')
  assert.deepEqual(r.faltantes, [])
  assert.equal(r.clave, 'opciones.apiKey')
  assert.equal(r.direccion.fuente, 'claude')
  assert.deepEqual(r.direccion.avisos, ['revisar'])
})

test('crearBorradorContrato: sin ciudad ni provincia no las manda y las deja como faltante', async () => {
  const pd = pandadocFalso()
  const r = await crearBorradorContrato(alta({ direccion: 'Calle 1 123' }), { apiKey: 'K', fetch: pd.f, esperar: async () => {}, direccion: false })
  const t = tokens(pd.llamadas[0])
  assert.equal(t['Client.StreetAddress'], 'Calle 1 123')
  assert.ok(!('Client.City' in t) && !('Client.State' in t))
  assert.equal(t['Client.Country'], 'Argentina')
  assert.deepEqual(r.faltantes, [FALTANTE_CIUDAD_PROVINCIA])
  assert.equal(r.direccion.fuente, 'reglas')
})

test('crearBorradorContrato: conjetura de las reglas sin Claude → se manda (el closer la ve) y queda "Confirmar ciudad y provincia"', async () => {
  const pd = pandadocFalso()
  const r = await crearBorradorContrato(alta({ direccion: 'Av. Colón 1234, Córdoba', telefonos: [] }), { apiKey: 'K', fetch: pd.f, esperar: async () => {} })
  const t = tokens(pd.llamadas[0])
  assert.deepEqual([t['Client.StreetAddress'], t['Client.City'], t['Client.State']], ['Av. Colón 1234', 'Córdoba', 'Córdoba'])
  assert.deepEqual(r.faltantes, [FALTANTE_CONFIRMAR_CIUDAD])
  assert.deepEqual(r.direccion.faltantes, [FALTANTE_CONFIRMAR_CIUDAD])
  assert.match(r.direccion.avisos[0], /Sin clave de Claude/)
  // Lo que dedujo Claude no se pide confirmar (va como aviso)
  const pd2 = pandadocFalso()
  const r2 = await crearBorradorContrato(alta({ direccion: 'Av. Colón 1234, Córdoba', telefonos: [] }), {
    apiKey: 'K', fetch: pd2.f, esperar: async () => {},
    direccion: async () => ({ calle: 'Av. Colón 1234', ciudad: 'Córdoba', provincia: 'Córdoba', pais: 'Argentina', confianza: 'baja', fuente: 'claude', avisos: ['revisar'], faltantes: [] }),
  })
  assert.deepEqual(r2.faltantes, [])
  // La ciudad y provincia confirmadas por el closer (extra) no se vuelven a pedir
  const pd3 = pandadocFalso()
  const r3 = await crearBorradorContrato(alta({ direccion: 'Av. Colón 1234, Córdoba', telefonos: [] }), {
    apiKey: 'K', fetch: pd3.f, esperar: async () => {}, extra: { ciudad: 'Córdoba', provincia: 'Córdoba', pais: 'Argentina' },
  })
  assert.deepEqual(r3.faltantes, [])
})

test('crearBorradorContrato: un resolvedor que falla no frena el borrador; extra manda; sin nombre no llama a nadie', async () => {
  const pd = pandadocFalso()
  const r = await crearBorradorContrato(alta(), { apiKey: 'K', fetch: pd.f, esperar: async () => {}, direccion: async () => { throw new Error('Claude caído') } })
  assert.deepEqual(r.direccion.avisos, ['No se pudo separar la dirección: Claude caído'])
  assert.deepEqual(r.faltantes, [FALTANTE_CIUDAD_PROVINCIA])
  assert.equal(tokens(pd.llamadas[0])['Client.City'], 'Pehuajó')   // la conjetura de las reglas (el closer la revisa)

  const conExtra = pandadocFalso()
  let llamado = false
  const r2 = await crearBorradorContrato(alta(), {
    apiKey: 'K', fetch: conExtra.f, esperar: async () => {}, extra: { ciudad: 'Pehuajó', provincia: 'Buenos Aires' },
    direccion: async () => { llamado = true; throw new Error('no') },
  })
  assert.equal(llamado, false)
  assert.equal(r2.direccion, null)
  assert.equal(tokens(conExtra.llamadas[0])['Client.State'], 'Buenos Aires')

  let gasto = false
  await assert.rejects(crearBorradorContrato(alta({ nombre: null }), { apiKey: 'K', fetch: pandadocFalso().f, direccion: async () => { gasto = true } }), /nombre completo/)
  assert.equal(gasto, false)
})
