// Relevo real entre procesos falsos, sin red, base, mensajes ni consumo de modelos.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { llamarCli } from '../lib/bot/guiones/motor-cli.ts'
import { tomarCandado } from './lib/guiones-candado.mjs'

const pedido = { que: 'prueba', sistema: 'instrucciones', usuario: 'dato de prueba', esfuerzo: 'medium', topeMs: 2_000,
  schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] } }

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cj-respaldo-test-'))
  const env = { ...process.env }
  process.env.GUIONES_CLI_RESPALDO = 'codex'
  process.env.GUIONES_RESPALDO_ESTADO = join(dir, 'estado.json')
  process.env.GUIONES_CLAUDE_BIN = join(dir, 'claude')
  process.env.GUIONES_CODEX_BIN = join(dir, 'codex')
  process.env.OPENAI_API_KEY = 'NO-PASAR'; process.env.DATABASE_URL = 'NO-PASAR'
  process.env.BOT_ANTHROPIC_API_KEY = 'NO-PASAR'; process.env.WHAPI_TOKEN = 'NO-PASAR'
  const script = (name, code) => writeFileSync(join(dir, name), `#!${process.execPath}\n${code}`, { mode: 0o700 })
  const trace = join(dir, 'trace.jsonl')
  const prelude = `const fs=require('node:fs');const trace=${JSON.stringify(trace)};`
  const claude = (reply, extra = '') => script('claude', `${prelude}fs.appendFileSync(trace, JSON.stringify({motor:'claude',pid:process.pid})+'\\n');${extra || `console.log(${JSON.stringify(JSON.stringify(reply))});`}`)
  const codex = (extra = '') => script('codex', `${prelude}
    if(process.argv[2]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
    const args=process.argv.slice(2);let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>input+=x);
    process.stdin.on('end',()=>{
      const prev=fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\\n').map(JSON.parse).filter(x=>x.motor==='claude').at(-1):null;
      if(prev){let alive=false;try{process.kill(prev.pid,0);alive=true;}catch{}if(alive)throw Error('principal todavía vivo');}
      fs.appendFileSync(trace,JSON.stringify({motor:'codex',args,input,cwd:process.cwd(),secret:process.env.DATABASE_URL||process.env.OPENAI_API_KEY||process.env.WHAPI_TOKEN||process.env.CLAUDE_CODE_OAUTH_TOKEN,schema:args.includes('--output-schema')?JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8')):null})+'\\n');
      ${extra || `fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({ok:true}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:12,output_tokens:3}}));`}
    });`)
  codex()
  const rows = () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : []
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); rmSync(dir, { recursive: true, force: true }) })
  return { dir, claude, codex, rows }
}

test('Claude sano sigue principal y no inicia Codex', async t => {
  const f = fixture(t); f.claude({ result: '{"ok":true}', usage: { input_tokens: 2, output_tokens: 1 } })
  assert.equal((await llamarCli(pedido)).modelo, 'claude-opus-5-5')
  assert.deepEqual(f.rows().map(x => x.motor), ['claude'])
})
test('límite de Claude activa Codex, con schema, sin secretos ni shell', async t => {
  const f = fixture(t); f.claude({ is_error: true, api_error_status: 429, result: 'Rate limit reached' })
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'NO-PASAR-A-CODEX'
  const r = await llamarCli(pedido); assert.equal(r.modelo, 'codex/chatgpt'); assert.deepEqual(r.json, { ok: true })
  const c = f.rows()[1]; assert.equal(c.secret, undefined); assert.deepEqual(c.schema, pedido.schema)
  assert.ok(c.args.includes('read-only')); assert.ok(c.args.includes('shell_tool')); assert.ok(c.args.includes('multi_agent'))
  assert.match(c.input, /instrucciones/); assert.match(c.input, /dato de prueba/); assert.ok(!existsSync(c.cwd))
})
test('el circuito persiste, evita repetir Claude y vuelve a probar tras la pausa', async t => {
  const f = fixture(t); f.claude({ is_error: true, result: "You've hit your limit" })
  await llamarCli(pedido); await llamarCli(pedido)
  assert.deepEqual(f.rows().map(x => x.motor), ['claude', 'codex', 'codex'])
  writeFileSync(join(f.dir, 'estado.json'), JSON.stringify({ claude_retry_after: Date.now() - 1 }))
  f.claude({ structured_output: { ok: true } }); assert.equal((await llamarCli(pedido)).modelo, 'claude-opus-5-5')
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'estado.json'))).claude_retry_after, 0)
})
test('un timeout espera la salida del principal antes de iniciar el respaldo', async t => {
  const f = fixture(t)
  f.claude(null, "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),100));setInterval(()=>{},1000);")
  await llamarCli({ ...pedido, topeMs: 1_000 })
  const rows = f.rows(); assert.deepEqual(rows.map(x => x.motor), ['claude', 'codex'])
  assert.throws(() => process.kill(rows[0].pid, 0), { code: 'ESRCH' })
})
test('CLI Claude ausente también permite el relevo', async t => {
  const f = fixture(t)
  assert.equal((await llamarCli(pedido)).modelo, 'codex/chatgpt'); assert.equal(f.rows().length, 1)
})
test('rechazo de contenido no dispara otro proveedor', async t => {
  const f = fixture(t); f.claude({ is_error: true, result: 'Content refused for safety' })
  await assert.rejects(llamarCli(pedido), /sin relevo/); assert.deepEqual(f.rows().map(x => x.motor), ['claude'])
})
test('mercado admite salida de texto y habilita únicamente búsqueda web', async t => {
  const f = fixture(t); f.claude({ is_error: true, api_error_status: 429 })
  const r = await llamarCli({ ...pedido, schema: undefined, herramientas: ['WebSearch', 'WebFetch'] })
  assert.equal(r.json, null); assert.ok(r.texto)
  const c = f.rows()[1]; assert.ok(c.args.includes('web_search="live"')); assert.equal(c.schema, null)
})
test('Claude con salida pero exit 1 no se acepta como éxito', async t => {
  const f = fixture(t); f.claude(null, 'console.log(JSON.stringify({result:"{\\"ok\\":true}"}));process.exit(1);')
  await assert.rejects(llamarCli(pedido), /código 1/); assert.equal(f.rows().length, 1)
})
test('salida rota del principal no se confunde con falta de cuota', async t => {
  const f = fixture(t); f.claude(null, 'console.log("no-json")')
  await assert.rejects(llamarCli(pedido), /no devolvió JSON/); assert.equal(f.rows().length, 1)
})
test('respaldo apagado conserva el error y no llama Codex', async t => {
  const f = fixture(t); process.env.GUIONES_CLI_RESPALDO = 'off'; f.claude({ is_error: true, api_error_status: 429 })
  await assert.rejects(llamarCli(pedido)); assert.equal(f.rows().length, 1)
})
test('Codex fallido no produce un resultado aprobado ni deja temporales', async t => {
  const f = fixture(t); f.claude({ is_error: true, api_error_status: 429 })
  f.codex("console.log(JSON.stringify({type:'turn.failed'}));")
  await assert.rejects(llamarCli(pedido), /no pudo completar/)
  assert.ok(!existsSync(f.rows()[1].cwd))
})
test('Codex autenticado con API key no ejecuta ni consume ese saldo', async t => {
  const f = fixture(t); f.claude({ is_error: true, api_error_status: 429 })
  writeFileSync(process.env.GUIONES_CODEX_BIN, `#!${process.execPath}\nconsole.log('Logged in using an API key');`, { mode: 0o700 })
  await assert.rejects(llamarCli(pedido), /sesión Codex de ChatGPT/)
  assert.deepEqual(f.rows().map(x => x.motor), ['claude'])
})
test('candado: un proceso vivo de más de dos horas no se pisa', t => {
  const f = fixture(t); const p = join(f.dir, 'lock')
  writeFileSync(p, `${process.pid} ${Date.now() - 3 * 3600_000}`)
  assert.equal(tomarCandado(p), null)
  rmSync(p); const liberar = tomarCandado(p); assert.equal(typeof liberar, 'function'); assert.equal(tomarCandado(p), null)
  liberar(); assert.ok(!existsSync(p))
})
test('candado de PID muerto se recupera', t => {
  const f = fixture(t); const p = join(f.dir, 'lock'); writeFileSync(p, '2147483647 1')
  const liberar = tomarCandado(p); assert.equal(typeof liberar, 'function'); liberar()
})
test('varios procesos recuperando el mismo candado admiten un único trabajador', async t => {
  const f = fixture(t); const p = join(f.dir, 'lock'); writeFileSync(p, '2147483647 1')
  const modulo = new URL('./lib/guiones-candado.mjs', import.meta.url).href
  const inicio = Date.now() + 1_000
  const code = `import {tomarCandado} from ${JSON.stringify(modulo)};setTimeout(()=>{const liberar=tomarCandado(${JSON.stringify(p)});console.log(liberar?'ganó':'ocupado');if(liberar)setTimeout(()=>liberar(),800)},Math.max(0,${inicio}-Date.now()));`
  const salidas = await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const h = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; h.stdout.on('data', d => { out += d }); h.on('error', reject); h.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error('falló un competidor')))
  })))
  assert.equal(salidas.filter(x => x === 'ganó').length, 1)
})
