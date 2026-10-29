// node scripts/fathom-webhook-kickoff.mjs --quien tomas|gero_m [--url https://despacho-capital-juridico.vercel.app/api/bot/kickoff] [--dry]
// node scripts/fathom-webhook-kickoff.mjs --quien tomas|gero_m --borrar <id> [--dry]
// node scripts/fathom-webhook-kickoff.mjs --listar [--quien tomas|gero_m]
// ── Webhook de kickoff de cada cuenta de Fathom (Tomás y Gero M), por API ─────────────────────────────
// Las kickoffs las graban Tomás Y Gero M, cada uno con su Fathom: cada cuenta necesita SU webhook hacia /api/bot/kickoff
// con SU secreto (lib/bot/kickoff/grabadores.ts). Este CLI lo crea con la API de Fathom (doc oficial, 24/10/2026):
//   · POST https://api.fathom.ai/external/v1/webhooks con X-Api-Key = FATHOM_API_KEY_<QUIEN> (de .env.local, o del entorno)
//     y { destination_url, triggered_for: ['my_recordings'], include_transcript, include_summary, include_action_items }
//     (solo las grabaciones propias: con las compartidas del equipo, la grabación de uno llegaría también por el webhook
//     del otro);
//   · la respuesta 201 trae el secreto (whsec_…) UNA sola vez: se agrega a .env.local como
//     FATHOM_KICKOFF_WEBHOOK_SECRET_<QUIEN> SIN mostrarlo. Si esa variable ya está, no se crea nada (no se pisa: un webhook
//     sin su secreto guardado no sirve) y se avisa. Después hay que cargarlo en Vercel y redeployar (lo dice al terminar);
//   · --borrar <id>: DELETE /webhooks/{id} (204). La variable del secreto queda: se avisa qué hacer con ella;
//   · --listar: la API de Fathom NO tiene un pedido para listar webhooks (solo crear y borrar): muestra los que creó este
//     CLI (.cache/fathom-webhooks-kickoff.json, sin secretos), si hay API key y secreto por persona (sí/no, nunca valores)
//     y dónde verlos en Fathom (Settings → API Access → Manage). No sale a la red;
//   · --dry: muestra el pedido que haría (la key como <FATHOM_API_KEY_…>, nunca el valor) y no llama a nada.
// Sin la API key: explica qué falta y sale con código 1. Nunca imprime la API key ni el secreto. --raiz <carpeta> (para
// las pruebas) cambia dónde se buscan .env.local y .cache. main() se exporta para los tests (scripts/test-bot-kickoff-fathom.mjs).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BASE_FATHOM = 'https://api.fathom.ai/external/v1'
export const URL_POR_DEFECTO = 'https://despacho-capital-juridico.vercel.app/api/bot/kickoff'
// Igual que GRABADORES de lib/bot/kickoff/grabadores.ts (el test controla que no se separen): acá en .mjs puro para que
// el CLI corra con un node pelado, sin el resolvedor de TypeScript
export const GRABADORES = { tomas: { nombre: 'Tomás', sufijo: 'TOMAS' }, gero_m: { nombre: 'Gero M', sufijo: 'GERO_M' } }
export const varApiKey = q => `FATHOM_API_KEY_${GRABADORES[q].sufijo}`
export const varSecreto = q => `FATHOM_KICKOFF_WEBHOOK_SECRET_${GRABADORES[q].sufijo}`
const TOPE_MS = 15_000
const RAIZ_REPO = fileURLToPath(new URL('../', import.meta.url))
const ARCHIVO_REGISTRO = '.cache/fathom-webhooks-kickoff.json'

const AYUDA = `Webhook de kickoff de cada cuenta de Fathom (Tomás y Gero M).

  Crear:   node scripts/fathom-webhook-kickoff.mjs --quien tomas|gero_m [--url <https://…/api/bot/kickoff>] [--dry]
  Borrar:  node scripts/fathom-webhook-kickoff.mjs --quien tomas|gero_m --borrar <id> [--dry]
  Listar:  node scripts/fathom-webhook-kickoff.mjs --listar [--quien tomas|gero_m]

  --url     destino del webhook (por defecto ${URL_POR_DEFECTO})
  --dry     muestra el pedido que haría, sin llamar a Fathom ni escribir nada
  --raiz    carpeta donde buscar .env.local y .cache (para pruebas; por defecto, la del repo)

Necesita FATHOM_API_KEY_<QUIEN> en .env.local (Fathom → Settings → API Access → Generate API key). Nunca la muestra.`

// ── Argumentos ──
export function parsearArgs(argv) {
  const a = { quien: null, listar: false, borrar: null, url: URL_POR_DEFECTO, dry: false, ayuda: false, raiz: null, error: null }
  const conValor = new Set(['--quien', '--borrar', '--url', '--raiz'])
  for (let i = 0; i < argv.length; i++) {
    let k = argv[i], v = null
    const igual = k.indexOf('=')
    if (k.startsWith('--') && igual > 0) { v = k.slice(igual + 1); k = k.slice(0, igual) }
    if (conValor.has(k)) {
      if (v === null) v = argv[++i] ?? null
      if (v === null || v.startsWith('--')) return { ...a, error: `${k} necesita un valor` }
    }
    if (k === '--quien') {
      const q = v.trim().toLowerCase().replace(/[\s-]+/g, '_')
      // Object.hasOwn y no `in`: `in` también acepta lo heredado (--quien constructor, --quien __proto__)
      if (!Object.hasOwn(GRABADORES, q)) return { ...a, error: `--quien tiene que ser ${Object.keys(GRABADORES).join(' o ')}` }
      a.quien = q
    } else if (k === '--borrar') a.borrar = v.trim()
    else if (k === '--url') a.url = v.trim()
    else if (k === '--raiz') a.raiz = v
    else if (k === '--listar') a.listar = true
    else if (k === '--dry') a.dry = true
    else if (k === '--ayuda' || k === '--help' || k === '-h') a.ayuda = true
    else return { ...a, error: `opción desconocida: ${k}` }
  }
  return a
}

// ── .env.local (solo se leen nombres y valores en memoria: nunca se imprimen) ──
export function leerEnv(ruta) {
  const vars = new Map()
  if (!existsSync(ruta)) return vars
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (v) vars.set(m[1], v)
  }
  return vars
}

/** Agrega KEY=valor al final de .env.local (con salto de línea antes si hace falta). No pisa nada. */
function agregarAEnv(ruta, clave, valor) {
  const previo = existsSync(ruta) ? readFileSync(ruta, 'utf8') : null
  const linea = `${clave}=${valor}\n`
  if (previo === null) writeFileSync(ruta, linea, { mode: 0o600 })
  else appendFileSync(ruta, `${previo.length && !previo.endsWith('\n') ? '\n' : ''}${linea}`)
}

function leerRegistro(ruta) {
  try {
    const x = JSON.parse(readFileSync(ruta, 'utf8'))
    return Array.isArray(x) ? x : []
  } catch {
    return []
  }
}
function guardarRegistro(ruta, lista) {
  mkdirSync(dirname(ruta), { recursive: true })
  writeFileSync(ruta, `${JSON.stringify(lista, null, 2)}\n`)
}

const cuerpoWebhook = url => ({
  destination_url: url,
  triggered_for: ['my_recordings'],
  include_transcript: true,
  include_summary: true,
  include_action_items: true,
  include_crm_matches: false,
})

/** Mensaje de un estado de error de Fathom (sin la key; el detalle de un 400 va recortado y sin la key por las dudas). */
function errorDeFathom(status, quien, que, detalle, retryAfter) {
  const { nombre } = GRABADORES[quien]
  if (status === 400 || status === 422) return `Fathom rechazó el pedido de ${que} (${status})${detalle ? `: ${detalle}` : ''}. Revisá la URL (tiene que ser https y pública).`
  if (status === 401) return `la API key de Fathom de ${nombre} (${varApiKey(quien)}) no es válida o se revocó (401): generá otra en Fathom → Settings → API Access y reemplazala en .env.local.`
  if (status === 403) return `la API key de ${nombre} no tiene permiso para ${que} (403).`
  if (status === 404) return `Fathom no encontró ${que} (404): ¿es de la otra cuenta o ya se borró?`
  if (status === 429) return `Fathom limitó los pedidos de la cuenta de ${nombre} (429): probá de nuevo en ${retryAfter ? `${retryAfter} s` : 'un minuto'}.`
  return `Fathom respondió ${status} a ${que}: probá de nuevo en un rato.`
}

async function pedirFathom(fetchImpl, metodo, ruta, clave, cuerpo) {
  try {
    return await fetchImpl(`${BASE_FATHOM}${ruta}`, {
      method: metodo,
      headers: { 'X-Api-Key': clave, accept: 'application/json', ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      signal: AbortSignal.timeout(TOPE_MS),
    })
  } catch (e) {
    const n = e?.name
    throw new Error(n === 'TimeoutError' || n === 'AbortError' ? `Fathom no respondió en ${TOPE_MS / 1000} s` : 'no se pudo conectar con Fathom (¿hay internet?)')
  }
}

async function detalleError(res, clave) {
  try {
    const t = (await res.text()).replace(/\s+/g, ' ').trim()
    return (clave ? t.split(clave).join('[clave]') : t).replace(/whsec_[A-Za-z0-9+/=_-]+/g, '[secreto]').slice(0, 200)
  } catch {
    return ''
  }
}

const faltaClave = (quien, rutaEnv) => [
  `Falta ${varApiKey(quien)} (la API key de Fathom de ${GRABADORES[quien].nombre}).`,
  `  1. ${GRABADORES[quien].nombre} entra a Fathom → Settings → API Access → Generate API key (con SU cuenta).`,
  `  2. Se pega en ${rutaEnv} como ${varApiKey(quien)}=… (una línea; no se comparte por chat).`,
  '  3. Se vuelve a correr este comando.',
].join('\n')

// ── Programa ──
export async function main(argv, entorno = {}) {
  const log = entorno.log ?? (t => console.log(t))
  const err = entorno.err ?? (t => console.error(t))
  const fetchImpl = entorno.fetch ?? globalThis.fetch
  const env = entorno.env ?? process.env
  const a = parsearArgs(argv)
  if (a.ayuda) { log(AYUDA); return 0 }
  if (a.error) { err(`${a.error}\n\n${AYUDA}`); return 1 }
  const raiz = a.raiz ?? entorno.raiz ?? RAIZ_REPO
  const rutaEnv = join(raiz, '.env.local'), rutaRegistro = join(raiz, ARCHIVO_REGISTRO)
  const archivo = leerEnv(rutaEnv)
  const claveDe = q => archivo.get(varApiKey(q)) || env[varApiKey(q)]?.trim() || null
  const dondeClave = q => (archivo.get(varApiKey(q)) ? 'en .env.local' : env[varApiKey(q)]?.trim() ? 'en el entorno' : null)

  // --listar: sin red (la API no tiene cómo listar webhooks)
  if (a.listar) {
    const registro = leerRegistro(rutaRegistro)
    const lineas = ['La API de Fathom no tiene un pedido para listar webhooks (solo crear y borrar). Los de cada cuenta se ven en Fathom → Settings → API Access → Manage.', '']
    for (const q of a.quien ? [a.quien] : Object.keys(GRABADORES)) {
      const propios = registro.filter(w => w.quien === q)
      lineas.push(`${GRABADORES[q].nombre} (${q}):`)
      lineas.push(`  ${varApiKey(q)}: ${dondeClave(q) ? `sí (${dondeClave(q)})` : 'no'}`)
      lineas.push(`  ${varSecreto(q)}: ${archivo.has(varSecreto(q)) ? 'sí, en .env.local (falta confirmar que esté en Vercel)' : 'no'}`)
      if (!propios.length) lineas.push('  webhooks creados con este CLI: ninguno')
      for (const w of propios) lineas.push(`  webhook ${w.id} → ${w.url} (creado ${w.created_at ?? w.creado_local ?? '?'}${w.borrado ? `, BORRADO ${w.borrado}` : ''})`)
    }
    log(lineas.join('\n'))
    return 0
  }

  if (!a.quien) { err(`Falta --quien (${Object.keys(GRABADORES).join(' o ')}).\n\n${AYUDA}`); return 1 }
  const q = a.quien, { nombre } = GRABADORES[q]
  const clave = claveDe(q)

  // --borrar <id>
  if (a.borrar !== null) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(a.borrar)) { err('--borrar: id de webhook inválido (letras, números, _ y -)'); return 1 }
    const pedido = `DELETE ${BASE_FATHOM}/webhooks/${a.borrar}\n  X-Api-Key: <${varApiKey(q)}${clave ? `, ${dondeClave(q)}` : ', FALTA'}>`
    if (a.dry) {
      log(`[dry] Borraría el webhook ${a.borrar} de la cuenta de ${nombre}:\n  ${pedido}${clave ? '' : `\n\nOjo: ${faltaClave(q, rutaEnv)}`}`)
      return 0
    }
    if (!clave) { err(faltaClave(q, rutaEnv)); return 1 }
    let res
    try {
      res = await pedirFathom(fetchImpl, 'DELETE', `/webhooks/${encodeURIComponent(a.borrar)}`, clave, null)
    } catch (e) { err(e.message); return 1 }
    if (!res.ok) {
      err(errorDeFathom(res.status, q, `el webhook ${a.borrar}`, res.status === 400 ? await detalleError(res, clave) : '', res.headers.get('retry-after')))
      return 1
    }
    const registro = leerRegistro(rutaRegistro)
    if (registro.some(w => w.id === a.borrar)) guardarRegistro(rutaRegistro, registro.map(w => (w.id === a.borrar ? { ...w, borrado: new Date().toISOString() } : w)))
    log([
      `Webhook ${a.borrar} borrado de la cuenta de Fathom de ${nombre}.`,
      `${varSecreto(q)} sigue en .env.local (y en Vercel, si se cargó). Si no vas a crear otro webhook para ${nombre}, sacala de los dos;`,
      'si vas a crear otro, sacala de .env.local antes de correr este CLI (no la piso) y después reemplazala en Vercel.',
    ].join('\n'))
    return 0
  }

  // Crear
  let destino
  try {
    destino = new URL(a.url)
  } catch {
    err(`--url inválida: ${a.url}`); return 1
  }
  if (destino.protocol !== 'https:') { err('--url tiene que ser https (Fathom manda a una dirección pública)'); return 1 }
  const avisos = []
  if (destino.href !== URL_POR_DEFECTO) avisos.push(`Ojo: el destino no es el del Despacho (${URL_POR_DEFECTO}).`)
  if (!destino.pathname.replace(/\/+$/, '').endsWith('/api/bot/kickoff')) avisos.push('Ojo: el destino no termina en /api/bot/kickoff (la ruta del webhook de kickoff).')
  const cuerpo = cuerpoWebhook(destino.href)
  const yaHay = archivo.has(varSecreto(q))
  if (a.dry) {
    log([
      `[dry] Crearía el webhook de kickoff de ${nombre}:`,
      `  POST ${BASE_FATHOM}/webhooks`,
      `  X-Api-Key: <${varApiKey(q)}${clave ? `, ${dondeClave(q)}` : ', FALTA'}>`,
      '  Content-Type: application/json',
      ...JSON.stringify(cuerpo, null, 2).split('\n').map(l => `  ${l}`),
      '',
      yaHay
        ? `No lo crearía: ${varSecreto(q)} ya está en .env.local (no se pisa).`
        : `Guardaría el secreto de la respuesta en .env.local como ${varSecreto(q)} (sin mostrarlo).`,
      ...avisos,
      ...(clave ? [] : ['', `Ojo: ${faltaClave(q, rutaEnv)}`]),
    ].join('\n'))
    return 0
  }
  if (!clave) { err(faltaClave(q, rutaEnv)); return 1 }
  if (yaHay) {
    err([
      `${varSecreto(q)} ya está en .env.local: no creo otro webhook (su secreto no tendría dónde guardarse sin pisar el que hay).`,
      `Si el webhook anterior de ${nombre} ya no existe (Fathom → Settings → API Access → Manage), sacá esa línea de .env.local y volvé a correr esto.`,
    ].join('\n'))
    return 1
  }
  for (const x of avisos) log(x)
  let res
  try {
    res = await pedirFathom(fetchImpl, 'POST', '/webhooks', clave, cuerpo)
  } catch (e) { err(e.message); return 1 }
  if (!res.ok) {
    err(errorDeFathom(res.status, q, 'el webhook', res.status === 400 || res.status === 422 ? await detalleError(res, clave) : '', res.headers.get('retry-after')))
    return 1
  }
  let w
  try {
    w = await res.json()
  } catch {
    w = null
  }
  const id = typeof w?.id === 'string' ? w.id : null
  const secreto = typeof w?.secret === 'string' && /^whsec_[A-Za-z0-9+/=_-]+$/.test(w.secret.trim()) ? w.secret.trim() : null
  if (!secreto) {
    err(`Fathom respondió ${res.status} pero sin un secreto whsec_… válido${id ? ` (webhook ${id})` : ''}: así no se pueden verificar los envíos. Borralo (${id ? `--borrar ${id}` : 'Settings → API Access → Manage'}) y volvé a intentar.`)
    return 1
  }
  // Por si alguien la agregó mientras tanto: no se pisa
  if (leerEnv(rutaEnv).has(varSecreto(q))) {
    err(`${varSecreto(q)} apareció en .env.local mientras se creaba el webhook: no la piso. Borrá el webhook nuevo (--borrar ${id ?? '<id>'}) y volvé a intentar.`)
    return 1
  }
  agregarAEnv(rutaEnv, varSecreto(q), secreto)
  const registro = leerRegistro(rutaRegistro)
  registro.push({
    quien: q, id, url: typeof w.url === 'string' ? w.url : destino.href, triggered_for: Array.isArray(w.triggered_for) ? w.triggered_for : cuerpo.triggered_for,
    include_transcript: w.include_transcript ?? null, include_summary: w.include_summary ?? null, include_action_items: w.include_action_items ?? null,
    created_at: typeof w.created_at === 'string' ? w.created_at : null, creado_local: new Date().toISOString(),
  })
  guardarRegistro(rutaRegistro, registro)
  const faltan = ['include_transcript', 'include_summary', 'include_action_items'].filter(k => w[k] === false)
  log([
    `Webhook de kickoff creado para ${nombre}: ${id ?? '(sin id)'} → ${typeof w.url === 'string' ? w.url : destino.href}`,
    `  grabaciones: ${(Array.isArray(w.triggered_for) ? w.triggered_for : cuerpo.triggered_for).join(', ')} · transcript, summary y action items: ${faltan.length ? `OJO, faltan ${faltan.join(', ')}` : 'sí'}`,
    `  secreto guardado en .env.local como ${varSecreto(q)} (no se muestra).`,
    '',
    'Falta (el webhook ya está activo: hasta que Vercel tenga el secreto, la ruta le responde 401 y la grabación no se procesa):',
    `  1. Cargar ${varSecreto(q)} en Vercel (Production), sin que el valor pase por la pantalla:`,
    `       grep '^${varSecreto(q)}=' .env.local | cut -d= -f2- | tr -d '\\n' | vercel env add ${varSecreto(q)} production`,
    '  2. Redeployar desde <APP_DIR>.',
    `  3. Comprobar con el GET de estado (Bearer CRON_SECRET) que fathom.firmas incluya ${varSecreto(q)}.`,
  ].join('\n'))
  return 0
}

// Solo si se corre como programa (los tests importan main sin ejecutarlo)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
