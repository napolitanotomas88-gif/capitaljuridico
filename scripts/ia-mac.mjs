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
//   · Que no se cuelgue en silencio (3/11/2026: quedó vivo sin leer la cola tras un corte de red): cada consulta tiene tope
//     (query_timeout del pool + un tope duro propio), los errores de red se reintentan con espera creciente y un latido
//     sale con process.exit si en LATIDO_MS no completó una vuelta de la cola; launchd (KeepAlive) lo relanza.
//   · node_modules propios de la copia del trabajador (no un enlace a otra carpeta): si el package-lock.json cambió, npm ci.
//   · El aviso a Discord de pedidos esperando lo da el Despacho (lib/ia/puenteMac.ts → vigilarCola): si la Mac está caída,
//     ella no puede avisar.
// Necesita en .env.local: DATABASE_URL y CLAUDE_CODE_OAUTH_TOKEN (o el `claude` de la Mac con sesión iniciada). No imprime
// claves ni el contenido de los pedidos.
import { readFileSync, appendFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, lstatSync, unlinkSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const RAIZ = new URL('../', import.meta.url).pathname
const UNA = process.argv.includes('--una')
const DIR = process.env.IA_MAC_LOG_DIR || join(homedir(), 'Library/Logs/ia-mac'); mkdirSync(DIR, { recursive: true })
const LOG = join(DIR, 'ia-mac.log')
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); appendFileSync(LOG, l + '\n') }
const PARALELO = 3, CADA_MS = 2_000, VIDA_MS = 60 * 60_000, TOPE_MAX_MS = 15 * 60_000
// Topes contra cuelgues: consulta (pg) 20 s, tope duro 30 s, espera máxima entre vueltas con la red caída 60 s; el latido
// corta si pasan 3 min sin una vuelta completa (al cerrar, esperando los pedidos en curso: su tope + 3 min)
const CONSULTA_MS = 20_000, TOPE_DURO_MS = 30_000, ESPERA_MAX_MS = 60_000
const LATIDO_MS = Number(process.env.IA_MAC_LATIDO_MS) || 3 * 60_000
const salir = (codigo, m) => { try { log(m) } catch {} process.exit(codigo) }
process.on('unhandledRejection', (e) => salir(1, `error sin atrapar: ${String(e?.message ?? e).slice(0, 160)}`))

for (const linea of readFileSync(join(RAIZ, '.env.local'), 'utf8').split('\n')) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m || process.env[m[1]]) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  process.env[m[1]] = v
}
if (!process.env.DATABASE_URL) { log('falta DATABASE_URL en .env.local'); process.exit(1) }

// Código al día: solo en la copia del trabajador (IA_MAC_ACTUALIZAR=1 en el plist, ~/cj-trabajador, HEAD suelto en
// origin/main) y si está limpia; en una carpeta de trabajo no toca nada. Solo avanza: si HEAD tiene algo que main todavía
// no tiene (una rama de PR probándose) no lo pisa, salvo que esa rama ya no exista en origin (PR mergeado con squash)
const git = (...a) => execFileSync('git', ['-C', RAIZ, ...a], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
if (process.env.IA_MAC_ACTUALIZAR === '1' && !UNA) {
  try {
    if (!git('status', '--porcelain', '--untracked-files=no')) {
      git('fetch', '--quiet', 'origin')
      let adelante = false
      try { git('merge-base', '--is-ancestor', 'HEAD', 'origin/main') } catch { adelante = true }
      if (!adelante || !git('branch', '-r', '--contains', 'HEAD')) git('checkout', '--quiet', '--detach', 'origin/main')
      else log('HEAD tiene cambios que main todavía no tiene: no se actualiza')
    }
  } catch (e) { log(`no se pudo actualizar el código: ${String(e?.message ?? e).slice(0, 120)}`) }
  // node_modules propios: si es un enlace a otra copia (p. ej. ~/dashboard-unificado) o el lock cambió, npm ci
  try {
    const nm = join(RAIZ, 'node_modules'), sello = join(nm, '.ia-mac-lock')
    const huella = createHash('sha256').update(readFileSync(join(RAIZ, 'package-lock.json'))).digest('hex')
    let enlace = false; try { enlace = lstatSync(nm).isSymbolicLink() } catch {}
    const igual = !enlace && existsSync(sello) && readFileSync(sello, 'utf8').trim() === huella
    if (!igual) {
      if (enlace) unlinkSync(nm)   // solo el enlace: npm ci no tiene que tocar la carpeta de otro
      log('instala dependencias (npm ci)')
      execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: RAIZ, timeout: 10 * 60_000, stdio: 'ignore' })
      writeFileSync(sello, huella)
    }
  } catch (e) { log(`no se pudieron instalar las dependencias: ${String(e?.message ?? e).slice(0, 120)}`) }
}

const { ejecutarMotor, entornoMotor, MotorNoDisponible } = await import('../lib/bot/guiones/proceso-cli.ts')
const { SQL_IA_PEDIDOS } = await import('../lib/ia/puenteMac.ts')
const { armarPedido } = await import('../lib/ia/pedidoCli.ts')
const { default: pg } = await import('pg')
const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, max: PARALELO + 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
  query_timeout: CONSULTA_MS, keepAlive: true, maxLifetimeSeconds: 300,
})
// Un cliente ocioso que se corta (Neon, la red de la Mac) no tumba el proceso: el pool lo descarta y sigue
pool.on('error', (e) => log(`conexión ociosa caída: ${String(e?.message ?? e).slice(0, 120)}`))

const RE_RED = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EADDRNOTAVAIL|ENETUNREACH|EHOSTUNREACH|EPIPE|terminated|timeout|tope duro|Connection|socket/i
const esDeRed = (e) => RE_RED.test(`${e?.code ?? ''} ${e?.message ?? e}`)
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))
/** Una consulta que nunca queda colgada: query_timeout del pool y, por si el pool mismo se traba, un tope duro. */
function consulta(sql, params) {
  let t
  return Promise.race([
    pool.query(sql, params),
    new Promise((_, no) => { t = setTimeout(() => no(new Error(`tope duro de ${TOPE_DURO_MS / 1000} s en la consulta`)), TOPE_DURO_MS) }),
  ]).finally(() => clearTimeout(t))
}
/** Con reintentos (1 s, 3 s, 9 s…) ante errores de red; un error de SQL sale enseguida. */
async function consultaConReintentos(sql, params, intentos = 4) {
  for (let i = 1; ; i++) {
    try { return await consulta(sql, params) } catch (e) {
      if (i >= intentos || !esDeRed(e)) throw e
      await esperar(1000 * 3 ** (i - 1))
    }
  }
}

// Latido: si en LATIDO_MS no se completó una vuelta de la cola (o el arranque), sale para que launchd lo relance
let ultimaVuelta = Date.now(), cerrando = false
setInterval(() => {
  const limite = cerrando ? TOPE_MAX_MS + LATIDO_MS : LATIDO_MS
  const quieto = Date.now() - ultimaVuelta
  if (quieto > limite) salir(70, `latido: ${Math.round(quieto / 1000)} s sin completar una vuelta de la cola; sale para que launchd lo relance`)
}, Math.min(30_000, Math.max(1_000, LATIDO_MS / 4))).unref()

try {
  await consultaConReintentos(SQL_IA_PEDIDOS, undefined, 5)
  // Lo que quedó tomado por una corrida que se cortó vuelve a la cola
  await consultaConReintentos(`UPDATE cj_ia_pedidos SET estado = 'pendiente' WHERE estado = 'tomado' AND tomado < now() - interval '20 minutes'`, undefined, 5)
} catch (e) { salir(1, `no se pudo conectar a la base al arrancar: ${String(e?.message ?? e).slice(0, 160)}`) }
ultimaVuelta = Date.now()

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
    await consultaConReintentos(`UPDATE cj_ia_pedidos SET estado = 'listo', respuesta = $2, terminado = now(), cuerpo = '{}'::jsonb WHERE id = $1`, [f.id, JSON.stringify(respuesta)])
    log(`${f.id} ${f.origen} listo en ${Math.round((Date.now() - t0) / 1000)} s (${p.modelo}, ${p.esfuerzo}${p.herramientas.length ? `, ${p.herramientas.join('+')}` : ''})`)
  } catch (e) {
    const motivo = e instanceof MotorNoDisponible ? 'Claude no disponible en la Mac (límite del plan, sesión o conexión)' : String(e?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 300)
    await consultaConReintentos(`UPDATE cj_ia_pedidos SET estado = 'error', error = $2, terminado = now(), cuerpo = '{}'::jsonb WHERE id = $1`, [f.id, motivo]).catch(() => {})
    log(`${f.id} ${f.origen} error: ${motivo}`)
  } finally {
    rmSync(carpeta, { recursive: true, force: true })
  }
}

async function tomar() {
  const { rows } = await consulta(`UPDATE cj_ia_pedidos SET estado = 'tomado', tomado = now(), intentos = intentos + 1
    WHERE id = (SELECT id FROM cj_ia_pedidos WHERE estado = 'pendiente' AND vence > now() ORDER BY creado LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, origen, cuerpo, vence`)
  return rows[0] ?? null
}

const corriendo = new Set()
const inicio = Date.now()
let parar = false
process.on('SIGTERM', () => { parar = true }); process.on('SIGINT', () => { parar = true })
log(`arranca (pid ${process.pid})`)
let fallos = 0
while (!parar && (UNA || Date.now() - inicio < VIDA_MS)) {
  try {
    while (corriendo.size < PARALELO) {
      const f = await tomar()
      if (!f) break
      const t = correr(f).finally(() => corriendo.delete(t))
      corriendo.add(t)
    }
    if (fallos) log(`la cola se lee de nuevo (tras ${fallos} ${fallos === 1 ? 'falla' : 'fallas'})`)
    fallos = 0
  } catch (e) {
    fallos++
    log(`no se pudo leer la cola${fallos > 1 ? ` (${fallos}ª vez seguida)` : ''}: ${String(e?.message ?? e).slice(0, 160)}`)
  }
  ultimaVuelta = Date.now()
  if (UNA && !corriendo.size) break
  // Con la red caída espera cada vez más (2, 4, 8… hasta 60 s) para no martillar a Neon
  await esperar(fallos ? Math.min(ESPERA_MAX_MS, CADA_MS * 2 ** fallos) : CADA_MS)
}
cerrando = true; ultimaVuelta = Date.now()
await Promise.allSettled([...corriendo])
await Promise.race([pool.end(), esperar(10_000)])
log('sale')
process.exit(0)
