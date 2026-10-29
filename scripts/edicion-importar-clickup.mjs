// Importación desde ClickUp ("Sistema de Edición") en MODO PRUEBA: arma la propuesta y NO escribe en Neon ni en ClickUp.
//
//   # Por defecto, SIN red: desde un volcado (tareas crudas de ClickUp o ya normalizadas) y, si se quiere, un volcado del CRM
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/edicion-importar-clickup.mjs \
//     --desde-volcado <tareas.json> [--crm <crm.json>] [--fecha-corte AAAA-MM-DD] [--salida <carpeta>]
//
//   # Leyendo ClickUp de verdad (solo GET) y el CRM (solo lectura), con el entorno privado cargado sin imprimir nada
//   node … scripts/edicion-importar-clickup.mjs --leer-clickup [--leer-crm] [--fecha-corte AAAA-MM-DD]
//
//   # Cargar una propuesta en Neon (NO en esta etapa): pide escribir CARGAR, exige EDICION_MODO=real y corre antes del
//   # primer diario real, con la propuesta regenerada ese mismo día
//   node … scripts/edicion-importar-clickup.mjs --cargar .cache/edicion-importacion/propuesta-AAAA-MM-DD.json
//
// Salida: .cache/edicion-importacion/propuesta-AAAA-MM-DD.json (ignorado en git) y un resumen con conteos (sin mails ni
// teléfonos: la propuesta tampoco los tiene). fetch queda bloqueado salvo para api.clickup.com (solo GET) y la lectura del
// CRM (Google). La lista sale de CLICKUP_LISTA_EDICION (sin destino por defecto); la fecha de corte, de --fecha-corte o
// EDICION_FECHA_CORTE (por defecto, hoy).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const valor = nombre => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined }
const LEER_CLICKUP = args.includes('--leer-clickup')
const LEER_CRM = args.includes('--leer-crm')
const CARGAR = valor('--cargar')
const VOLCADO = valor('--desde-volcado')
const CRM_VOLCADO = valor('--crm')

// ── .env.local de la sesión dueña → process.env, sin imprimir nada (solo si hace falta leer de verdad o cargar) ──
function cargarEnv() {
  const ruta = process.env.HUB_ENV_FILE?.trim() || join(RAIZ, '.env.local')
  if (!existsSync(ruta)) return // También admite node --env-file=<archivo privado>.
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m || process.env[m[1]]) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}
if (LEER_CLICKUP || LEER_CRM || CARGAR) cargarEnv()
// Nada de Discord, Meta ni Claude en este proceso (y la base solo con --cargar)
for (const k of Object.keys(process.env)) {
  if (k.startsWith('DISCORD_WEBHOOK') || k === 'META_ADS_WRITE_TOKEN' || k === 'ANTHROPIC_API_KEY' || k === 'BOT_ANTHROPIC_API_KEY') delete process.env[k]
  if (!CARGAR && (k === 'DATABASE_URL' || k === 'CUOTAS_DATABASE_URL')) delete process.env[k]
}

// ── fetch: solo ClickUp (GET) y la lectura del CRM ──
const PERMITIDOS = [/^api\.clickup\.com$/, /^(oauth2|sheets|www)\.googleapis\.com$/]
const original = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const { host } = new URL(url)
  if (CARGAR && /neon\.tech$/.test(host)) return original(input, init)
  if (!PERMITIDOS.some(re => re.test(host))) throw new Error(`importación en prueba: ${host} no está permitido`)
  const metodo = (init.method ?? 'GET').toUpperCase()
  if (host === 'api.clickup.com' && metodo !== 'GET') throw new Error('a ClickUp solo se le piden GET (nunca se escribe en ClickUp)')
  return original(input, init)
}

const I = await import('../lib/edicion/importar.ts')
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
const fechaCorte = valor('--fecha-corte') ?? process.env.EDICION_FECHA_CORTE?.trim() ?? hoy
if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCorte)) { console.error('fecha de corte inválida (AAAA-MM-DD)'); process.exit(1) }

// ── --cargar: no en esta etapa ──
if (CARGAR) {
  if (process.env.EDICION_MODO?.trim().toLowerCase() !== 'real') { console.error('--cargar exige EDICION_MODO=real (en esta etapa no se carga nada)'); process.exit(1) }
  const prop = JSON.parse(readFileSync(CARGAR, 'utf8'))
  if (prop.version !== I.VERSION_IMPORTACION) { console.error(`la propuesta es de otra versión (${prop.version}): regenerala`); process.exit(1) }
  if (prop.generado?.slice(0, 10) !== new Date().toISOString().slice(0, 10)) { console.error('la propuesta no es de hoy: regenerala antes de cargar'); process.exit(1) }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ok = (await rl.question(`Se van a cargar ${prop.videos.length} videos y ${prop.marcas.length} fichas de marca en Neon. Escribí CARGAR para seguir: `)).trim()
  rl.close()
  if (ok !== 'CARGAR') { console.log('No se cargó nada.'); process.exit(0) }
  const V = await import('../lib/edicion/db/videos.ts')
  const Mk = await import('../lib/edicion/db/marca.ts')
  const { consulta } = await import('../lib/edicion/db/base.ts')
  const r = await I.cargarPropuesta(prop, {
    listarVideos: f => V.listarVideos(f),
    crearVideoSiFalta: (v, actor) => V.crearVideoSiFalta(v, actor),
    actualizarVideo: p => V.actualizarVideo(p),
    tieneAccionesDePersonas: id => consulta('acciones de personas', async q => ((await q`SELECT 1 FROM cj_video_eventos WHERE video_id = ${id} AND actor_tipo = 'persona' LIMIT 1`)).length > 0),
    leerMarca: id => Mk.leerMarca(id),
    guardarMarca: (id, ficha, version, actor) => Mk.guardarMarca(id, ficha, version, actor),
  })
  console.log(JSON.stringify(r, null, 2))
  process.exit(0)
}

// ── Tareas: volcado (por defecto) o ClickUp (GET) ──
const esperar = ms => new Promise(r => setTimeout(r, ms))
async function get(path) {
  const token = process.env.CLICKUP_TOKEN
  if (!token) throw new Error('falta CLICKUP_TOKEN')
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(`https://api.clickup.com/api/v2${path}`, { headers: { Authorization: token }, signal: AbortSignal.timeout(20_000) })
    if (r.status === 429) { await esperar(15_000); continue }
    if (!r.ok) throw new Error(`ClickUp respondió ${r.status} (${path.split('?')[0]})`)
    return r.json()
  }
  throw new Error('ClickUp sigue respondiendo 429')
}
let tareas
if (LEER_CLICKUP) {
  const lista = process.env.CLICKUP_LISTA_EDICION?.trim() || I.LISTA_EDICION_POR_DEFECTO
  if (!/^\d+$/.test(lista)) throw new Error('Falta CLICKUP_LISTA_EDICION válido')
  const crudas = []
  for (let p = 0; p < 30; p++) {
    const r = await get(`/list/${lista}/task?include_closed=true&subtasks=true&archived=false&page=${p}`)
    crudas.push(...(r.tasks ?? []))
    if (r.last_page || !(r.tasks ?? []).length) break
  }
  tareas = []
  for (const t of crudas) {
    const norm = I.tareaDesdeClickUp(t)
    if (!I.esActiva(norm)) { tareas.push(norm); continue }
    const c = await get(`/task/${t.id}/comment`)
    tareas.push(I.tareaDesdeClickUp(t, c.comments ?? []))
    await esperar(650)       // ClickUp: 100 pedidos por minuto
  }
} else if (VOLCADO) {
  const v = JSON.parse(readFileSync(VOLCADO, 'utf8'))
  const lista = Array.isArray(v) ? v : Array.isArray(v.tareas) ? v.tareas : Array.isArray(v.edicion) ? v.edicion : null
  if (!lista) { console.error('el volcado no trae una lista de tareas (array, {tareas} o {edicion})'); process.exit(1) }
  const comentarios = v.comentarios ?? {}
  tareas = lista.map(t => ('campos' in t ? t : I.tareaDesdeClickUp(t, comentarios[t.id] ?? [])))
} else {
  console.error('usá --desde-volcado <json> (sin red) o --leer-clickup')
  process.exit(1)
}

// ── CRM: volcado, lectura real (solo id, nombre y estado) o nada (todo queda sin cruzar) ──
let crm = []
if (CRM_VOLCADO) {
  const c = JSON.parse(readFileSync(CRM_VOLCADO, 'utf8'))
  crm = (Array.isArray(c) ? c : c.clientes ?? []).map(x => ({ id: String(x.id ?? ''), nombre: String(x.nombre ?? ''), estado: String(x.estado ?? '') })).filter(x => x.id && x.nombre)
} else if (LEER_CRM) {
  const { leerClientes } = await import('../lib/clientes/leer.ts')
  const d = await leerClientes()
  crm = d.clientes.filter(x => x.id).map(x => ({ id: x.id, nombre: x.nombre, estado: x.estado }))   // nada de celular ni mail
}

const prop = I.mapearTareas(tareas, crm, { fechaCorte })
const carpeta = valor('--salida') ?? join(RAIZ, '.cache/edicion-importacion')
mkdirSync(carpeta, { recursive: true })
const salida = join(carpeta, `propuesta-${hoy}.json`)
writeFileSync(salida, JSON.stringify(prop, null, 2))
console.log(`Propuesta ${prop.version} (corte ${prop.fecha_corte}): ${prop.videos.length} videos de ${prop.clientes.length} clientes · ${prop.marcas.length} fichas de marca · ` +
  `${prop.sin_cruzar.length} tarjetas sin cruzar · ${prop.omitidas.length} omitidas · ${prop.avisos.length} avisos`)
console.log(`Por estado: ${Object.entries(prop.conteo).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
console.log(`Para confirmar con Aylu: ${prop.videos.filter(v => v.confirmar_con_aylu.length).length} videos`)
console.log(`Archivo: ${salida}`)
