// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test scripts/test-config-privada.mjs
// Sin red ni datos reales. La configuración ausente debe bloquear el cálculo, nunca devolver un vacío implícito.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { leerFinanzasPrivadas, leerCuentasPrivadas, leerPresupuestosPrivados, leerAliasPrivados, esFinanzasPrivadas, esCuentasPrivadas, esPresupuestosPrivados, esAliasPrivados } from '../lib/configPrivada.ts'
import { leerComprobantes } from '../lib/finanzasCuentas.ts'

const raiz = fileURLToPath(new URL('../', import.meta.url))
const variables = ['HUB_CONFIG_PRIVADA_DIR', 'HUB_CONFIG_FINANZAS_CUENTAS_JSON', 'HUB_CONFIG_ANUNCIOS_CUENTAS_JSON', 'HUB_CONFIG_ANUNCIOS_PRESUPUESTOS_JSON', 'HUB_CONFIG_FATHOM_ALIAS_JSON']
const conEntorno = fn => {
  const antes = new Map(variables.map(k => [k, process.env[k]]))
  for (const k of variables) delete process.env[k]
  const temporal = mkdtempSync(join(tmpdir(), 'hub-config-ficticia-'))
  process.env.HUB_CONFIG_PRIVADA_DIR = temporal
  try { return fn(temporal) }
  finally {
    rmSync(temporal, { recursive: true, force: true })
    for (const [k, v] of antes) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}
const ejemplo = nombre => JSON.parse(readFileSync(join(raiz, 'private-config.example', `${nombre}.json`), 'utf8'))

test('importar no lee datos; las cuatro cargas sin configuración fallan explícitamente', () => conEntorno(() => {
  for (const cargar of [leerFinanzasPrivadas, leerCuentasPrivadas, leerPresupuestosPrivados, leerAliasPrivados]) {
    assert.throws(cargar, /Falta la configuración privada/)
  }
  assert.throws(leerComprobantes, /Falta la configuración privada finanzas-cuentas/)
}))

test('la carpeta privada conserva importes, referencias y textos sin alterarlos', () => conEntorno(dir => {
  for (const nombre of ['finanzas-cuentas', 'anuncios-cuentas', 'anuncios-presupuestos', 'fathom-alias']) {
    writeFileSync(join(dir, `${nombre}.json`), JSON.stringify(ejemplo(nombre)))
  }
  assert.deepEqual(leerFinanzasPrivadas(), ejemplo('finanzas-cuentas'))
  assert.deepEqual(leerComprobantes(), ejemplo('finanzas-cuentas').comprobantes)
  assert.deepEqual(leerCuentasPrivadas(), ejemplo('anuncios-cuentas'))
  assert.deepEqual(leerPresupuestosPrivados(), ejemplo('anuncios-presupuestos'))
  assert.deepEqual(leerAliasPrivados(), ejemplo('fathom-alias'))
}))

test('JSON de entorno tiene precedencia y se relee: no queda un dato privado anterior en caché', () => conEntorno(dir => {
  writeFileSync(join(dir, 'fathom-alias.json'), JSON.stringify(ejemplo('fathom-alias')))
  process.env.HUB_CONFIG_FATHOM_ALIAS_JSON = JSON.stringify([{ cliente: 'Cliente Ficticio Dos', escrito: ['FicticioDos'] }])
  assert.equal(leerAliasPrivados()[0].cliente, 'Cliente Ficticio Dos')
  process.env.HUB_CONFIG_FATHOM_ALIAS_JSON = '[]'
  assert.deepEqual(leerAliasPrivados(), [])
  process.env.HUB_CONFIG_FATHOM_ALIAS_JSON = ''
  assert.throws(leerAliasPrivados, /no contiene JSON válido/)
}))

test('errores de JSON y esquema no imprimen contenido privado ni ruta local', () => conEntorno(dir => {
  process.env.HUB_CONFIG_FINANZAS_CUENTAS_JSON = 'MARCADOR_PRIVADO_SIN_ECHO'
  assert.throws(leerFinanzasPrivadas, e => /JSON válido/.test(e.message) && !e.message.includes('MARCADOR_PRIVADO') && !e.message.includes(dir))
  process.env.HUB_CONFIG_FINANZAS_CUENTAS_JSON = JSON.stringify({ secreto: 'MARCADOR_PRIVADO_SIN_ECHO' })
  assert.throws(leerFinanzasPrivadas, e => /formato requerido/.test(e.message) && !e.message.includes('MARCADOR_PRIVADO'))
}))

test('finanzas rechaza fecha imposible, mes sin respaldo, monto inválido y cuenta desconocida', () => {
  const valido = ejemplo('finanzas-cuentas')
  assert.equal(esFinanzasPrivadas(valido), true)
  for (const [i, v] of [[0, '2030-02-31'], [0, '2030-02-01'], [2, -1], [2, Infinity], [3, 'desconocida'], [3, [['Otro', NaN]]]]) {
    const x = structuredClone(valido); x.comprobantes[0][i] = v
    assert.equal(esFinanzasPrivadas(x), false)
  }
  const dividido = structuredClone(valido); dividido.comprobantes[0][3] = [['Otro', 40], ['Relay', 60]]
  assert.equal(esFinanzasPrivadas(dividido), true)
})

test('cuentas, presupuesto y alias malformados se rechazan completos', () => {
  assert.equal(esCuentasPrivadas(ejemplo('anuncios-cuentas')), true)
  assert.equal(esCuentasPrivadas({ base: ['id_ajeno'], excluidas: [], ajustes: {} }), false)
  assert.equal(esCuentasPrivadas({ base: [], excluidas: [], ajustes: { act_1: { rama: 'rama_inventada' } } }), false)
  assert.equal(esPresupuestosPrivados({ act_1: { taskIds: [], planillaUSD: null } }), true)
  assert.equal(esPresupuestosPrivados({ act_1: { taskIds: ['tarea'], planillaUSD: '100' } }), false)
  assert.equal(esPresupuestosPrivados({ act_1: { taskIds: ['tarea'], planillaUSD: -100 } }), false)
  assert.equal(esAliasPrivados([{ cliente: 'Ficticio Uno', escrito: ['Uno'] }, { cliente: 'Ficticio Dos', escrito: '' }]), false)
})

test('el generador escribe alias solamente en la carpeta privada configurada', () => conEntorno(dir => {
  const nota = join(dir, 'nota-ficticia.md')
  writeFileSync(nota, '## Alias conocidos\n\n| Como aparece en transcripciones | Cliente real (CRM) | Ficha |\n| --- | --- | --- |\n| FicticioUno | Cliente Ficticio Uno | |\n')
  execFileSync(process.execPath, [join(raiz, 'scripts/fathom-alias-desde-boveda.mjs'), nota], { cwd: raiz, env: { ...process.env }, stdio: 'pipe' })
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'fathom-alias.json'), 'utf8')), [{ escrito: ['FicticioUno'], cliente: 'Cliente Ficticio Uno' }])
  assert.equal(existsSync(join(raiz, 'lib/fathomAnuncios/alias.json')), false)
}))

test('los datasets originales no están en el árbol y la carpeta privada está ignorada', () => {
  for (const n of ['lib/fathomAnuncios/alias.json', 'lib/anuncios/presupuestos-cuentas.json', '.private-config', '.env.local']) {
    assert.equal(existsSync(join(raiz, n)), false, n)
  }
  assert.match(readFileSync(join(raiz, '.gitignore'), 'utf8'), /^\.private-config\/$/m)
})

test('sin identidad del equipo no se confirma acceso a Meta ni se consulta otra agencia', () => {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('KICKOFF_EQUIPO_')) delete env[k]
  const codigo = `
    import assert from 'node:assert/strict';
    import { interpretarPortfolio, agenciasParaLeer } from './lib/bot/kickoff/portfolio.ts';
    globalThis.fetch = async () => { throw new Error('No debe haber red'); };
    const r = Array.from({ length: 9 }, () => ({ ok: true, body: { data: [] } }));
    r[0] = { ok: true, body: { id: 'act_1000000000000001', currency: 'USD', business: { id: '1000000000000003', name: 'Negocio Ficticio' }, user_tasks: ['ADVERTISE'] } };
    const p = interpretarPortfolio(r, null, 'META_CLIENTES_TOKEN');
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato');
    assert.match(p.items.accesos_equipo.detalle, /Falta configurar/);
    assert.deepEqual(agenciasParaLeer(r, 'META_CLIENTES_TOKEN'), []);
  `
  execFileSync(process.execPath, ['--experimental-strip-types', '--import', './scripts/ts-resolve.mjs', '--input-type=module', '-e', codigo], { cwd: raiz, env, stdio: 'pipe' })
})
