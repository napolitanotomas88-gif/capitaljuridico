// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/ia-mac.mjs [--una]
// Trabajador de la Mac del puente de Claude (lib/ia/puenteMac.ts; decisión de Tomás del 1/11/2026, opción «A»: nada del
// Despacho gasta créditos de la API). Toma de Neon (cj_ia_pedidos) los pedidos que dejan los módulos, los corre con
// `claude -p` (Claude Code con el plan de Tomás) y guarda la respuesta. Lo mantiene vivo launchd
// (~/Library/LaunchAgents/com.skyward.ia-mac.plist, KeepAlive); cada hora sale solo para que launchd lo relance y tome
// el código nuevo de main (con IA_MAC_ACTUALIZAR=1 se pone en origin/main al arrancar).
//   · De a 3 pedidos a la vez; mira la cola cada 2 s. Un pedido vencido (nadie lo esperaba ya) no se corre.
//   · Los archivos (imágenes y PDF de comprobantes, capturas del mapa) se escriben en una carpeta temporal y Claude los lee
//     con Read; se borran al terminar. Las búsquedas web del mercado van con WebSearch/WebFetch.
//   · Nunca usa la API: entornoMotor() no pasa ANTHROPIC_API_KEY ni BOT_ANTHROPIC_API_KEY a `claude -p`.
// Necesita en .env.local: DATABASE_URL y CLAUDE_CODE_OAUTH_TOKEN (o el `claude` de la Mac con sesión iniciada). No imprime
// claves ni el contenido de los pedidos.
import { readFileSync, appendFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const RAIZ = new URL('../', import.meta.url).pathname
const UNA = process.argv.includes('--una')
const DIR = join(homedir(), 'Library/Logs/ia-mac'); mkdirSync(DIR, { recursive: true })
const LOG = join(DIR, 'ia-mac.log')
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); appendFileSync(LOG, l + '\n') }
const PARALELO = 3, CADA_MS = 2_000, VIDA_MS = 60 * 60_000, TOPE_MAX_MS = 15 * 60_000

for (const linea of readFileSync(join(RAIZ, '.env.local'), 'utf8').split('\n')) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m || process.env[m[1]]) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  process.env[m[1]] = v
}
if (!process.env.DATABASE_URL) { log('falta DATABASE_URL en .env.local'); process.exit(1) }

// Código al día: solo en la copia del trabajador (IA_MAC_ACTUALIZAR=1 en el plist, ~/cj-trabajador, HEAD suelto en
// origin/main) y si está limpia; en una carpeta de trabajo no toca nada
try {
  const sucio = execFileSync('git', ['-C', RAIZ, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()
  if (process.env.IA_MAC_ACTUALIZAR === '1' && !sucio && !UNA) {
    execFileSync('git', ['-C', RAIZ, 'fetch', '--quiet', 'origin', 'main'], { timeout: 30_000 })
    execFileSync('git', ['-C', RAIZ, 'checkout', '--quiet', '--detach', 'origin/main'], { timeout: 30_000 })
  }
} catch (e) { log(`no se pudo actualizar el código: ${String(e?.message ?? e).slice(0, 120)}`) }

const { ejecutarMotor, entornoMotor, MotorNoDisponible } = await import('../lib/bot/guiones/proceso-cli.ts')
const { SQL_IA_PEDIDOS } = await import('../lib/ia/puenteMac.ts')
const { armarPedido } = await import('../lib/ia/pedidoCli.ts')
const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: PARALELO + 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 })
await pool.query(SQL_IA_PEDIDOS)
// Lo que quedó tomado por una corrida que se cortó vuelve a la cola
await pool.query(`UPDATE cj_ia_pedidos SET estado = 'pendiente' WHERE estado = 'tomado' AND tomado < now() - interval '20 minutes'`)

async function correr(f) {
  const carpeta = mkdtempSync(join(tmpdir(), 'ia-mac-'))
  const t0 = Date.now()
  try {
    const cuerpo = typeof f.cuerpo === 'string' ? JSON.parse(f.cuerpo) : f.cuerpo
    const p = armarPedido(cuerpo, carpeta, (ruta, datos) => writeFileSync(ruta, datos))
    const env = entornoMotor()
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const args = ['-p', p.usuario, '--model', p.modelo, '--effort', p.esfuerzo, '--output-format', 'json',
      '--tools', p.herramientas.join(','), '--no-session-persistence', '--add-dir', carpeta]
    if (p.sistema) args.push('--system-prompt', p.sistema)
    if (p.schema) args.push('--json-schema', JSON.stringify(p.schema))
    if (p.herramientas.length) args.push('--allowedTools', p.herramientas.join(','))
    const tope = Math.min(TOPE_MAX_MS, Math.max(60_000, new Date(f.vence).getTime() - Date.now() + 120_000))
    const salida = await ejecutarMotor(process.env.GUIONES_CLAUDE_BIN?.trim() || 'claude', args, { env, topeMs: tope, cwd: carpeta, errorEstructurado: true })
    const r = JSON.parse(salida)
    const resultado = typeof r.result === 'string' ? r.result : ''
    if (r.is_error) {
      const status = Number(r.api_error_status)
      const noDisp = status === 401 || status === 429 || (status >= 500 && status <= 599) || /rate.?limit|usage.?limit|hit your limit|limit reached|overloaded|unauthorized|not logged|authentication|expired/i.test(resultado)
      throw new Error(noDisp ? 'Claude no disponible en la Mac (límite del plan, sesión o conexión)' : 'Claude no completó el pedido')
    }
    let texto = resultado
    if (p.schema) {
      let json = r.structured_output ?? null
      if (json === null) { const m = resultado.match(/\{[\s\S]*\}/); try { json = m ? JSON.parse(m[0]) : null } catch { json = null } }
      if (json === null) throw new Error('la salida no trae el JSON pedido')
      texto = JSON.stringify(json)
    }
    const u = r.usage ?? {}
    const respuesta = { texto, modelo: p.modelo, entrada: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), salida: u.output_tokens ?? 0 }
    // El cuerpo se vacía: puede traer archivos en base64 y ya no hace falta (la huella queda para reusar la respuesta)
    await pool.query(`UPDATE cj_ia_pedidos SET estado = 'listo', respuesta = $2, terminado = now(), cuerpo = '{}'::jsonb WHERE id = $1`, [f.id, JSON.stringify(respuesta)])
    log(`${f.id} ${f.origen} listo en ${Math.round((Date.now() - t0) / 1000)} s (${p.modelo}, ${p.esfuerzo}${p.herramientas.length ? `, ${p.herramientas.join('+')}` : ''})`)
  } catch (e) {
    const motivo = e instanceof MotorNoDisponible ? 'Claude no disponible en la Mac (límite del plan, sesión o conexión)' : String(e?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 300)
    await pool.query(`UPDATE cj_ia_pedidos SET estado = 'error', error = $2, terminado = now(), cuerpo = '{}'::jsonb WHERE id = $1`, [f.id, motivo]).catch(() => {})
    log(`${f.id} ${f.origen} error: ${motivo}`)
  } finally {
    rmSync(carpeta, { recursive: true, force: true })
  }
}

async function tomar() {
  const { rows } = await pool.query(`UPDATE cj_ia_pedidos SET estado = 'tomado', tomado = now(), intentos = intentos + 1
    WHERE id = (SELECT id FROM cj_ia_pedidos WHERE estado = 'pendiente' AND vence > now() ORDER BY creado LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, origen, cuerpo, vence`)
  return rows[0] ?? null
}

const corriendo = new Set()
const inicio = Date.now()
let parar = false
process.on('SIGTERM', () => { parar = true }); process.on('SIGINT', () => { parar = true })
log(`arranca (pid ${process.pid})`)
while (!parar && (UNA || Date.now() - inicio < VIDA_MS)) {
  try {
    while (corriendo.size < PARALELO) {
      const f = await tomar()
      if (!f) break
      const t = correr(f).finally(() => corriendo.delete(t))
      corriendo.add(t)
    }
  } catch (e) { log(`no se pudo leer la cola: ${String(e?.message ?? e).slice(0, 160)}`) }
  if (UNA && !corriendo.size) break
  await new Promise((ok) => setTimeout(ok, CADA_MS))
}
await Promise.allSettled([...corriendo])
await pool.end()
log('sale')
