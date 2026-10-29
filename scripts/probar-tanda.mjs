// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/probar-tanda.mjs [--cantidad 6] [--ciudad "San Juan"] [--esfuerzo high]
// Prueba EN SECO de la tanda de guiones completos (lib/bot/guiones/generar.ts) con la ficha de Laura: plan, redacción en
// paralelo, revisor mecánico, jefe creativo con contexto limpio y corrección. Igual que probar-ganchos.mjs: solo
// api.anthropic.com, .env.local sin imprimir nada. Guarda .cache/guiones/prueba/tanda-<fecha>.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('../', import.meta.url).pathname
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const CANTIDAD = Number(arg('--cantidad', '6'))
const CIUDAD = arg('--ciudad', 'San Juan')
const ESFUERZO = arg('--esfuerzo', 'high')

for (const linea of readFileSync(join(RAIZ, '.env.local'), 'utf8').split('\n')) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m || process.env[m[1]]) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  process.env[m[1]] = v
}
for (const k of Object.keys(process.env)) if (k.includes('DATABASE_URL') || k.startsWith('DISCORD_WEBHOOK') || k.startsWith('META_')) delete process.env[k]
const original = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (new URL(url).host !== 'api.anthropic.com') throw new Error(`prueba en seco: ${new URL(url).host} no está permitido`)
  return original(input, init)
}

const { generarTanda, VERSION_TANDA } = await import('../lib/bot/guiones/generar.ts')
const { CATALOGO, catalogoEnTexto } = await import('../lib/bot/guiones/formatos.ts')
const { kbDeRama } = await import('../lib/bot/kickoff/kb/index.ts')
const salida = JSON.parse(readFileSync(join(RAIZ, '.cache/kickoff-prueba/salida-195704214.json'), 'utf8'))
const ficha = salida.ficha
// Preferencia de Tomás: nada de ángulos sobre gente que ya firmó la liquidación
const ideas = (salida.ideas?.ideas ?? []).filter(i => !/firm/i.test(i.titulo))
const rutaMercado = join(RAIZ, '.cache/guiones/investigacion/mercado-san-juan.md')
const mercado = existsSync(rutaMercado) ? readFileSync(rutaMercado, 'utf8') : null
const t0 = Date.now()
const r = await generarTanda({ ficha, ideas, cantidad: CANTIDAD, ciudad: CIUDAD, catalogo: catalogoEnTexto(), mercado, kb: kbDeRama(ficha.rama.principal)?.texto ?? null }, CATALOGO, { esfuerzo: ESFUERZO })
const segundos = Math.round((Date.now() - t0) / 1000)
const costo = (r.usage.input_tokens * 4 + r.usage.output_tokens * 20) / 1e6
const carpeta = join(RAIZ, '.cache/guiones/prueba')
mkdirSync(carpeta, { recursive: true })
const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
writeFileSync(join(carpeta, `tanda-${sello}.json`), JSON.stringify({ version: VERSION_TANDA, segundos, costo_usd: costo, ...r }, null, 2))
const errs = r.hallazgos.filter(h => h.gravedad === 'error')
console.log(`guiones: ${r.tanda.guiones.length} · ${segundos} s · ~USD ${costo.toFixed(2)} · errores: ${errs.length} · avisos: ${r.hallazgos.length - errs.length} · ajustes: ${r.ajustes.length}`)
for (const h of errs) console.log(`  [error] ${h.guion ?? 'tanda'} · ${h.regla}: ${h.detalle}`)
console.log(`→ .cache/guiones/prueba/tanda-${sello}.json`)
