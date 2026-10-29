// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/plan-campana.mjs <recording_id de la kickoff> [--videos 5] [--fecha AAAA-MM-DD] [--habitantes N]
// g03 en SECO: arma el plan de campaña de un cliente desde su ficha de kickoff (Neon, solo SELECT). Estima los habitantes
// de la zona con Claude (unos centavos) salvo que se pasen con --habitantes. No escribe en Meta, ni en la base, ni en Discord.
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent("export async function load(url, ctx, next) { if (url.endsWith('.json') && !ctx.importAttributes?.type) return next(url, { ...ctx, importAttributes: { ...ctx.importAttributes, type: 'json' } }); return next(url, ctx) }"))
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const { neon } = await import('@neondatabase/serverless')
const { armarPlan, textoPlan, miles } = await import('../lib/bot/anuncios/plan.ts')
const { estimarHabitantes } = await import('../lib/bot/anuncios/habitantes.ts')

const args = process.argv.slice(2)
const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const id = Number(args[0])
if (!Number.isSafeInteger(id) || id <= 0) { console.error('Uso: plan-campana.mjs <recording_id> [--videos 5] [--fecha AAAA-MM-DD] [--habitantes N]'); process.exit(1) }
const q = neon(process.env.DATABASE_URL)
const [fila] = await q`SELECT ficha, to_jsonb(cj_kickoffs) -> 'zona_video' AS zona_video FROM cj_kickoffs WHERE recording_id = ${id} AND estado = 'lista'`
if (!fila) { console.error(`No hay una ficha de kickoff lista para la grabación ${id}.`); process.exit(1) }
const f = fila.ficha
const zona = { ...f.zona, mapa: f.zona?.mapa ?? fila.zona_video?.mapa ?? null }
let habitantes = val('--habitantes') ? Number(val('--habitantes')) : null
let etiqueta = (zona.presentarse_como?.texto ?? zona.lugares?.[0] ?? '').replace(/\s*\(de oído.*?\)/g, '')
if (habitantes === null) {
  const e = await estimarHabitantes(zona)
  habitantes = e.habitantes
  etiqueta = e.etiqueta || etiqueta
  console.log(`Habitantes (Claude, confianza ${e.confianza}): ~${miles(e.habitantes)} (${miles(e.minimo)}–${miles(e.maximo)}) · ${e.base}\n`)
}
const nVideos = Number(val('--videos') ?? 5)
const plan = armarPlan({
  cliente: f.cliente?.cliente_crm ?? f.cliente?.nombre_escuchado ?? 'Cliente',
  rama: f.rama?.principal ?? null,
  mensualUSD: f.presupuesto?.usd_mes ?? null,
  zona: etiqueta,
  habitantes,
  videos: Array.from({ length: nVideos }, (_, i) => f.ideas_guiones?.lista?.[i]?.gancho ?? f.ideas_guiones?.ideas?.[i]?.gancho ?? `Video ${i + 1}`),
  fecha: val('--fecha') ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
})
console.log(textoPlan(plan, f.cliente?.cliente_crm ?? 'Cliente', null))
