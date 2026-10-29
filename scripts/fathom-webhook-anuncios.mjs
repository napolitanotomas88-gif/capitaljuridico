// node scripts/fathom-webhook-anuncios.mjs [--url https://despacho-capital-juridico.vercel.app/api/fathom-anuncios] [--dry]
// node scripts/fathom-webhook-anuncios.mjs --borrar <id> [--dry]
// ── Webhook de Fathom → /api/fathom-anuncios (cambios de anuncios para Valentino), por API ─────────
// Solo las llamadas de Tomás (decisión del 24/10/2026): API key FATHOM_API_KEY_TOMAS, triggered_for my_recordings.
// Es un webhook APARTE del de /api/bot/kickoff (scripts/fathom-webhook-kickoff.mjs, de esa sesión), con otro secreto:
//   · POST https://api.fathom.ai/external/v1/webhooks con transcripción, resumen y tareas;
//   · la respuesta 201 trae el secreto (whsec_…) UNA sola vez: se agrega a .env.local como FATHOM_WEBHOOK_SECRET SIN
//     mostrarlo. Si esa variable ya está, no se crea nada (un webhook sin su secreto guardado no sirve). Después hay que
//     cargarlo en Vercel y redeployar: recién ahí la ruta deja de responder 503;
//   · --borrar <id>: DELETE /webhooks/{id}. La variable del secreto queda en .env.local (se avisa);
//   · --dry: muestra el pedido (la key como <FATHOM_API_KEY_TOMAS>) y no llama a nada.
// Los creados quedan anotados (sin secretos) en .cache/fathom-webhooks-anuncios.json. Nunca imprime la key ni el secreto.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://api.fathom.ai/external/v1'
const URL_POR_DEFECTO = 'https://despacho-capital-juridico.vercel.app/api/fathom-anuncios'
const VAR_KEY = 'FATHOM_API_KEY_TOMAS', VAR_SECRETO = 'FATHOM_WEBHOOK_SECRET'
const RAIZ = fileURLToPath(new URL('../', import.meta.url))
const ENV = join(RAIZ, '.env.local'), REGISTRO = join(RAIZ, '.cache/fathom-webhooks-anuncios.json')

function leerEnv() {
  const vars = new Map()
  if (!existsSync(ENV)) return vars
  for (const l of readFileSync(ENV, 'utf8').split('\n')) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (v) vars.set(m[1], v)
  }
  return vars
}
const registro = () => { try { const x = JSON.parse(readFileSync(REGISTRO, 'utf8')); return Array.isArray(x) ? x : [] } catch { return [] } }
const guardar = lista => { mkdirSync(dirname(REGISTRO), { recursive: true }); writeFileSync(REGISTRO, `${JSON.stringify(lista, null, 2)}\n`) }
const limpio = (t, key) => t.split(key).join('[clave]').replace(/whsec_[A-Za-z0-9+/=_-]+/g, '[secreto]').replace(/\s+/g, ' ').slice(0, 200)

const args = process.argv.slice(2)
const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? '' : null }
const dry = args.includes('--dry'), borrar = val('--borrar'), url = val('--url') ?? URL_POR_DEFECTO
if (borrar !== null && (!borrar.trim() || borrar.startsWith('--'))) { console.error('--borrar necesita el id del webhook'); process.exit(1) }
if (!url.trim() || url.startsWith('--')) { console.error('--url necesita un valor'); process.exit(1) }
const env = leerEnv(), key = env.get(VAR_KEY) || process.env[VAR_KEY]?.trim()
if (!key) { console.error(`Falta ${VAR_KEY} en .env.local.`); process.exit(1) }

if (borrar) {
  if (dry) { console.log(`DELETE ${BASE}/webhooks/${borrar} (X-Api-Key: <${VAR_KEY}>)`); process.exit(0) }
  const r = await fetch(`${BASE}/webhooks/${encodeURIComponent(borrar)}`, { method: 'DELETE', headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(15_000) })
  if (r.status !== 204 && r.status !== 200) { console.error(`Fathom respondió ${r.status}: ${limpio(await r.text().catch(() => ''), key)}`); process.exit(1) }
  guardar(registro().map(w => (w.id === borrar ? { ...w, borrado: new Date().toISOString() } : w)))
  console.log(`Webhook ${borrar} borrado. ${VAR_SECRETO} sigue en .env.local: sacala (y de Vercel) si no se crea otro.`)
  process.exit(0)
}

if (!/^https:\/\/[^\s/]+\/\S*$/.test(url)) { console.error('--url tiene que ser https'); process.exit(1) }
const cuerpo = { destination_url: url, triggered_for: ['my_recordings'], include_transcript: true, include_summary: true, include_action_items: true, include_crm_matches: false }
if (dry) { console.log(`POST ${BASE}/webhooks (X-Api-Key: <${VAR_KEY}>)\n${JSON.stringify(cuerpo, null, 2)}`); process.exit(0) }
if (!existsSync(ENV)) { console.error('No existe .env.local: el secreto no tendría dónde guardarse (no se crea nada).'); process.exit(1) }
if (env.get(VAR_SECRETO)) { console.error(`${VAR_SECRETO} ya está en .env.local: no se crea otro webhook (borrá el viejo con --borrar y sacá la variable antes).`); process.exit(1) }

const r = await fetch(`${BASE}/webhooks`, {
  method: 'POST', headers: { 'X-Api-Key': key, accept: 'application/json', 'content-type': 'application/json' },
  body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(15_000),
})
if (r.status !== 201 && r.status !== 200) { console.error(`Fathom respondió ${r.status}: ${limpio(await r.text().catch(() => ''), key)}`); process.exit(1) }
const w = await r.json()
const secreto = typeof w?.secret === 'string' && /^whsec_[A-Za-z0-9+/=_-]+$/.test(w.secret.trim()) ? w.secret.trim() : null
if (!secreto) { console.error(`Fathom creó el webhook ${w?.id ?? '?'} pero no devolvió el secreto: borralo con --borrar y probá de nuevo.`); process.exit(1) }
// Primero el id (si falla guardar el secreto, queda anotado para borrarlo), después el secreto
guardar([...registro(), { id: w.id ?? null, url, triggered_for: cuerpo.triggered_for, created_at: w.created_at ?? null, creado_local: new Date().toISOString() }])
try {
  const previo = readFileSync(ENV, 'utf8')
  appendFileSync(ENV, `${previo.length && !previo.endsWith('\n') ? '\n' : ''}${VAR_SECRETO}=${secreto}\n`)
} catch {
  console.error(`Se creó el webhook ${w.id} pero no se pudo guardar el secreto en .env.local: borralo con --borrar ${w.id} y probá de nuevo.`)
  process.exit(1)
}
console.log(`Webhook ${w.id} creado → ${url}. Secreto guardado en .env.local como ${VAR_SECRETO} (no se muestra).`)
console.log(`Falta: cargar ${VAR_SECRETO} en Vercel (Production) y redeployar; hasta entonces la ruta responde 503.`)
