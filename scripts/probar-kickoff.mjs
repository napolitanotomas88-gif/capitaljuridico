// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/probar-kickoff.mjs [recording_id] [--rearmar] [--ads]
// Prueba EN SECO de la ficha de kickoff con un payload real de Fathom (por defecto el de la kickoff de Laura Ortiz Molina,
// grabación 195704214, en .cache/kickoff-prueba/payload-<id>.json). Hace el recorrido real de procesarKickoff con dry:
//   · lee el CRM SOLO LECTURA (snapshot de lib/clientes y "Cuentas Meta"), los ganadores de Meta y el portfolio del cliente
//     (subpedidos GET) y llama a Claude de verdad (dos llamadas: ficha e ideas; cuesta lo mismo que una pasada real);
//   · NO toca Neon ni Discord: se borran DATABASE_URL y los webhooks de Discord de este proceso, las dependencias de base y
//     Discord tiran error si alguien las llama, y fetch solo deja salir a los hosts de lectura (Claude, Meta, Google, ClickUp,
//     cotizaciones). A Meta solo le deja pasar subpedidos GET;
//   · carga .env.local sin imprimir nada (ni nombres de variables ni valores).
// Guarda .cache/kickoff-prueba/salida-<id>.json (ficha, ideas, mensaje, tokens, segundos, ajustes) y ficha-<id>.md (vista
// para revisar + el mensaje de Discord tal cual saldría), e imprime un resumen corto. Con --rearmar NO llama a Claude: toma la
// ficha guardada (extracción, ideas y ganadores tal cual), vuelve a chequear el portfolio en Meta de verdad (solo GET, con la
// misma búsqueda de cuenta que el bot) y rearma la ficha final, el mensaje y el markdown (para retocar el formato o probar
// el portfolio sin pagar Claude de nuevo).
// Las dos guardan también el aviso a Valentino «🚀 Para lanzar» (aviso-ads.ts) tal cual saldría a #📣-ads (mensaje_ads), sin
// mandarlo: con la ficha recién armada (sin tildes ni marcas de la pantalla) y la mención de DISCORD_ID_VALENTINO si está.
import { register } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Solo en este proceso: los .json se importan como en Next (sin atributo) y next/cache necesita la extensión en ESM
register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(spec, ctx, next) { if (spec === 'next/cache') return next('next/cache.js', ctx); return next(spec, ctx) }\n" +
  "export async function load(url, ctx, next) { if (url.endsWith('.json') && !ctx.importAttributes?.type) return next(url, { ...ctx, importAttributes: { ...ctx.importAttributes, type: 'json' } }); return next(url, ctx) }"))

const RAIZ = new URL('../', import.meta.url).pathname
const CARPETA = join(RAIZ, '.cache/kickoff-prueba')
const REARMAR = process.argv.includes('--rearmar')
const ID = process.argv.slice(2).find(x => !x.startsWith('--')) ?? '195704214'
if (!/^\d{1,16}$/.test(ID)) { console.error('recording_id inválido'); process.exit(1) }

// ── .env.local → process.env, sin imprimir nada ──
for (const linea of readFileSync(join(RAIZ, '.env.local'), 'utf8').split('\n')) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m || process.env[m[1]]) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  process.env[m[1]] = v
}
// Nada de base ni Discord en esta prueba, y ni a mano el token de escritura de Meta (el bot usa solo los de lectura)
for (const k of Object.keys(process.env)) if (k === 'DATABASE_URL' || k === 'CUOTAS_DATABASE_URL' || k === 'META_ADS_WRITE_TOKEN' || k.startsWith('DISCORD_WEBHOOK')) delete process.env[k]

// ── fetch con lista de hosts de lectura (y a Meta, solo subpedidos GET) ──
const PERMITIDOS = [/^api\.anthropic\.com$/, /^graph\.facebook\.com$/, /^(oauth2|sheets|www)\.googleapis\.com$/, /^api\.clickup\.com$/, /^dolarapi\.com$/, /^cdn\.jsdelivr\.net$/, /\.currency-api\.pages\.dev$/]
const llamadas = {}
const original = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const host = new URL(url).host
  if (!PERMITIDOS.some(re => re.test(host))) throw new Error(`prueba en seco: ${host} no está permitido`)
  if (REARMAR && host === 'api.anthropic.com') throw new Error('prueba en seco (--rearmar): Claude no se llama')
  const metodo = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (host === 'graph.facebook.com' && metodo !== 'GET') {
    const lote = init.body instanceof URLSearchParams ? init.body.get('batch') : null
    const pedidos = lote ? JSON.parse(lote) : null
    if (!Array.isArray(pedidos) || !pedidos.every(p => p.method === 'GET')) throw new Error('prueba en seco: a Meta solo se le piden GET')
  }
  llamadas[host] = (llamadas[host] ?? 0) + 1
  return original(input, init)
}

const { procesarKickoff, chequeoPortfolio, extraccionDeFicha } = await import('../lib/bot/kickoff/procesar.ts')
const { depsLectura } = await import('../lib/bot/kickoff/servidor.ts')
const { armarFicha, fichaMarkdown } = await import('../lib/bot/kickoff/ficha.ts')
const { armarAviso, linkFicha } = await import('../lib/bot/kickoff/mensaje.ts')
const { filaParaAviso, textoAvisoAds } = await import('../lib/bot/kickoff/aviso-ads.ts')
const { validarReunion } = await import('../lib/fathomAnuncios/tipos.ts')

const TOPE_REARMAR_MS = 30_000
let llamadasPortfolio = 0
const medirPortfolio = fn => async (...a) => { llamadasPortfolio++; return fn(...a) }

const escribirMd = (ruta, ficha, mensaje, estado, motivo, mensajeAds = null) => {
  const md = ficha ? fichaMarkdown(ficha) : `# Sin ficha\n\nEstado: ${estado}${motivo ? ` (${motivo})` : ''}`
  const ads = mensajeAds ? `\n## Aviso a Valentino en #📣-ads (tal cual saldría, ${mensajeAds.length} caracteres)\n\n\`\`\`\n${mensajeAds}\n\`\`\`\n` : ''
  writeFileSync(ruta, `${md}\n\n---\n\n## Mensaje de Discord (tal cual saldría, ${mensaje?.length ?? 0} caracteres)\n\n\`\`\`\n${mensaje ?? '(no sale mensaje)'}\n\`\`\`\n${ads}`)
}

// --rearmar: SIN Claude. La extracción, las ideas y los ganadores salen de la ficha guardada; el portfolio se vuelve a
// chequear en Meta (solo GET, igual que el bot: búsqueda de la cuenta + chequeo, con tope) y se rearma la ficha final
if (REARMAR) {
  const rutaJson = join(CARPETA, `salida-${ID}.json`), rutaMd = join(CARPETA, `ficha-${ID}.md`)
  const prev = JSON.parse(readFileSync(rutaJson, 'utf8'))
  const base = extraccionDeFicha(prev.ficha)
  if (!base) { console.error('la salida guardada no tiene una ficha con la forma esperada'); process.exit(1) }
  // La reunión: del payload (trae recorded_by y el fin agendado) o, si no está, de la ficha
  let reunionPrev = null
  try {
    const crudo = JSON.parse(readFileSync(join(CARPETA, `payload-${ID}.json`), 'utf8'))
    const v = validarReunion(crudo)
    if (v.ok) reunionPrev = { ...v.reunion, scheduled_end_time: typeof crudo.scheduled_end_time === 'string' ? crudo.scheduled_end_time : null }
  } catch { /* sin payload: va lo de la ficha */ }
  const f0 = prev.ficha
  const reunion = reunionPrev ?? { recording_id: f0.recording_id, title: f0.titulo, url: f0.url, recording_start_time: f0.fecha, created_at: f0.fecha, recording_end_time: f0.fin_grabacion ?? null, scheduled_end_time: f0.fin_agendado ?? null, recorded_by: null }
  const l = depsLectura()
  const t = Date.now()
  let port = null
  if (base.extraccion.tipo_reunion === 'kickoff') {
    l.prepararPortfolio?.()
    // En el bot el descubrimiento se calienta mientras Claude lee la llamada (~60 s); acá no hay Claude: se le da más tope
    port = await chequeoPortfolio({ portfolio: medirPortfolio(l.portfolio), topePortfolioMs: TOPE_REARMAR_MS }, base.extraccion)
  }
  const portfolio_s = Math.round((Date.now() - t) / 100) / 10
  const ficha = armarFicha({
    reunion, extraccion: base.extraccion, ajustes: [...base.ajustes, ...(port?.ajustes ?? [])],
    ideas: base.extraccion.tipo_reunion === 'kickoff' ? f0.ideas_guiones ?? null : null,
    ganadores: base.extraccion.tipo_reunion === 'kickoff' ? f0.ganadores ?? null : null,
    portfolioMeta: port?.lectura ?? null,
  })
  const mensaje = ficha.tipo_reunion === 'kickoff' ? armarAviso(ficha, l.menciones, linkFicha(l.urlBase, ficha, l.pantallaFicha !== false)) : null
  const mensajeAds = ficha.tipo_reunion === 'kickoff' ? textoAvisoAds(filaParaAviso(ficha, null), { valentino: l.valentino ?? null, urlBase: l.urlBase, pantalla: l.pantallaFicha !== false }) : null
  const rearmado = { cuando: new Date().toISOString(), sin_claude: true, portfolio_s, portfolio_llamadas: llamadasPortfolio, llamadas_http: llamadas, cuentas_cliente: port?.cuentas ?? [] }
  writeFileSync(rutaJson, JSON.stringify({ ...prev, ficha, ideas: ficha.ideas_guiones, mensaje, mensaje_largo: mensaje?.length ?? 0, mensaje_ads: mensajeAds, mensaje_ads_largo: mensajeAds?.length ?? 0, ajustes: ficha.ajustes, rearmado }, null, 2))
  escribirMd(rutaMd, ficha, mensaje, prev.estado, prev.motivo, mensajeAds)
  const pf = ficha.portfolio_final
  console.log(JSON.stringify({
    rearmado: true, portfolio_s, llamadas_http: llamadas,
    cuenta: ficha.portfolio_meta?.cuenta ?? null, leido: ficha.portfolio_meta?.leido ?? null, origen_cuenta: ficha.portfolio_meta?.origen_cuenta ?? null, aviso: ficha.portfolio_meta?.aviso ?? null,
    portfolio: pf ? Object.fromEntries(Object.entries(pf).map(([k, x]) => [k, `${x.estado} (${x.fuente})`])) : null,
    grabo: ficha.grabo?.quien ?? ficha.grabo?.nombre ?? null,
    faltantes: ficha.faltantes.length, mensaje_largo: mensaje?.length ?? 0, mensaje_ads_largo: mensajeAds?.length ?? 0, archivos: [rutaJson, rutaMd],
  }, null, 1))
  if (process.argv.includes('--ads') && mensajeAds) console.log(`\n${mensajeAds}`)
  process.exit(0)
}

const payload = JSON.parse(readFileSync(join(CARPETA, `payload-${ID}.json`), 'utf8'))
const prohibido = que => async () => { throw new Error(`prueba en seco: ${que} no se puede usar`) }
const lectura = depsLectura()
const tiempos = {}
const medir = (que, fn) => async (...a) => {
  const t = Date.now()
  try { return await fn(...a) } finally { tiempos[que] = Math.round((Date.now() - t) / 100) / 10 }
}
let crm = null
const deps = {
  ...lectura,
  contexto: medir('crm_s', async () => (crm = await lectura.contexto())),
  extraer: medir('ficha_claude_s', lectura.extraer),
  candidatos: medir('ganadores_meta_s', lectura.candidatos),
  portfolio: medir('portfolio_meta_s', lectura.portfolio),
  ideas: medir('ideas_claude_s', lectura.ideas),
  reclamar: prohibido('la base'), guardarFicha: prohibido('la base'), guardarIdeas: prohibido('la base'), anotarAviso: prohibido('la base'), marcar: prohibido('la base'),
  enviar: prohibido('Discord'), avisar: prohibido('Discord'),
  discordListo: false,
}

const t0 = Date.now()
const r = await procesarKickoff(payload, deps, { dry: true })
const segundos = Math.round((Date.now() - t0) / 100) / 10

const costo = u => (u ? Math.round(((u.input_tokens * 4 + u.output_tokens * 20) / 1e6) * 10_000) / 10_000 : 0)
const tokens = {
  ficha: r.usage?.extraccion ?? null,
  ideas: r.usage?.ideas ?? null,
  total: {
    input_tokens: (r.usage?.extraccion?.input_tokens ?? 0) + (r.usage?.ideas?.input_tokens ?? 0),
    output_tokens: (r.usage?.extraccion?.output_tokens ?? 0) + (r.usage?.ideas?.output_tokens ?? 0),
  },
}
const costoUSD = { ficha: costo(tokens.ficha), ideas: costo(tokens.ideas), total: costo(tokens.total), tarifa: 'Opus 5.5: USD 4/M entrada, USD 20/M salida (el razonamiento cuenta como salida)' }

const salida = {
  generado: new Date().toISOString(),
  recording_id: Number(ID),
  estado: r.estado,
  motivo: r.motivo ?? null,
  modelo: r.modelo ?? null,
  segundos,
  tiempos,
  tokens,
  costo_usd: costoUSD,
  llamadas_http: llamadas,
  crm: crm ? { estado: crm.estado, clientes: crm.clientes.length, aviso: crm.aviso ?? null } : null,
  ficha: r.ficha ?? null,
  ideas: r.ficha?.ideas_guiones ?? null,
  mensaje: r.mensaje ?? null,
  mensaje_largo: r.mensaje?.length ?? 0,
  mensaje_ads: r.mensaje_ads ?? null,
  mensaje_ads_largo: r.mensaje_ads?.length ?? 0,
  ajustes: r.ficha?.ajustes ?? [],
}
const rutaJson = join(CARPETA, `salida-${ID}.json`)
const rutaMd = join(CARPETA, `ficha-${ID}.md`)
writeFileSync(rutaJson, JSON.stringify(salida, null, 2))
escribirMd(rutaMd, r.ficha, r.mensaje, r.estado, r.motivo, r.mensaje_ads ?? null)

const f = r.ficha
console.log(JSON.stringify({
  estado: r.estado,
  motivo: r.motivo ?? undefined,
  tipo: f?.tipo_reunion,
  cliente: f ? `${f.cliente.cliente_crm ?? `${f.cliente.nombre_escuchado} (sin verificar)`}${f.cliente.id_crm ? ` ${f.cliente.id_crm}` : ''}` : undefined,
  rama: f ? `${f.rama.principal ?? 'sin rama'} · ${f.rama.subramas.length} subramas` : undefined,
  presupuesto: f ? [f.presupuesto.usd_dia_min, f.presupuesto.usd_dia_max, f.presupuesto.usd_mes] : undefined,
  zona: f ? `${f.zona.lugares.length} lugares · mapa ${f.zona.mapa_en_pantalla}` : undefined,
  ideas: f?.ideas_guiones.ideas.length,
  ganadores: f ? `${f.ganadores.estado} (${f.ganadores.lista.length})` : undefined,
  portfolio: f?.portfolio_final ? Object.fromEntries(Object.entries(f.portfolio_final).map(([k, x]) => [k, `${x.estado} (${x.fuente})`])) : undefined,
  faltantes: f?.faltantes.length,
  ajustes: f?.ajustes.length,
  segundos, tiempos,
  tokens: tokens.total, costo_usd: costoUSD.total,
  mensaje_largo: salida.mensaje_largo,
  mensaje_ads_largo: salida.mensaje_ads_largo,
  archivos: [rutaJson, rutaMd],
}, null, 1))
process.exit(r.estado === 'dry' || r.estado === 'no_kickoff' ? 0 : 1)
