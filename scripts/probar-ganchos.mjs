// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/probar-ganchos.mjs [--por-idea 4] [--nuevas 1] [--ciudad "San Juan"] [--esfuerzo high|medium]
// Prueba EN SECO de la tanda de ganchos para calibrar con Tomás (lib/bot/guiones/ganchos.ts), con la ficha de kickoff de
// Laura Ortiz Molina (grabación 195704214, .cache/kickoff-prueba/salida-195704214.json): sus 5 ideas + las nuevas que proponga
// el redactor, el catálogo de recursos creativos (formatos.ts), la base de laboral (kickoff/kb) y el análisis de mercado de
// la zona si está (.cache/guiones/investigacion/mercado-san-juan.md). Dos llamadas a Claude: redactor y revisor con contexto
// limpio. NO toca Neon, Discord, Drive ni Meta: fetch solo deja salir a api.anthropic.com. Carga .env.local sin imprimir nada.
// Guarda .cache/guiones/prueba/ganchos-<fecha>.json y .md (para revisar) e imprime un resumen corto.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('../', import.meta.url).pathname
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const POR_IDEA = Number(arg('--por-idea', '4'))
const NUEVAS = Number(arg('--nuevas', '1'))
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

const { generarGanchos, VERSION_GANCHOS } = await import('../lib/bot/guiones/ganchos.ts')
const { CATALOGO, FORMATOS, catalogoEnTexto, VERSION_FORMATOS } = await import('../lib/bot/guiones/formatos.ts')
const { kbDeRama } = await import('../lib/bot/kickoff/kb/index.ts')

const salida = JSON.parse(readFileSync(join(RAIZ, '.cache/kickoff-prueba/salida-195704214.json'), 'utf8'))
const ficha = salida.ficha
const ideas = salida.ideas?.ideas ?? []
const rutaMercado = join(RAIZ, '.cache/guiones/investigacion/mercado-san-juan.md')
const mercado = existsSync(rutaMercado) ? readFileSync(rutaMercado, 'utf8') : null

const t0 = Date.now()
const r = await generarGanchos({
  ficha, ideas, ciudad: CIUDAD, catalogo: catalogoEnTexto(), mercado, kb: kbDeRama(ficha.rama.principal)?.texto ?? null,
  porIdea: POR_IDEA, ideasNuevas: NUEVAS,
}, CATALOGO, { esfuerzo: ESFUERZO })
const segundos = Math.round((Date.now() - t0) / 1000)
// Opus 5.5: USD 4 / 20 por millón (entrada / salida)
const costo = (r.usage.input_tokens * 4 + r.usage.output_tokens * 20) / 1e6

const carpeta = join(RAIZ, '.cache/guiones/prueba')
mkdirSync(carpeta, { recursive: true })
const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
writeFileSync(join(carpeta, `ganchos-${sello}.json`), JSON.stringify({ version: VERSION_GANCHOS, formatos: VERSION_FORMATOS, ciudad: CIUDAD, con_mercado: !!mercado, segundos, costo_usd: costo, ...r }, null, 2))

const rev = new Map((r.revision?.ganchos ?? []).map(x => [x.numero, x]))
const nombre = Object.fromEntries(FORMATOS.map(f => [f.clave, f.nombre]))
const md = [
  `# Ganchos de prueba · Laura Ortiz Molina (${CIUDAD})`,
  `${r.ganchos.length} ganchos · ${segundos} s · ~USD ${costo.toFixed(2)} · mercado: ${mercado ? 'sí' : 'no'} · ${VERSION_GANCHOS} / ${VERSION_FORMATOS}`,
  '', r.ajustes.length ? `**Ajustes:** ${r.ajustes.join(' · ')}` : '', r.notas ? `**Notas del redactor:** ${r.notas}` : '',
  '', `**Revisor (tanda):** ${r.revision?.tanda ?? ''}`, `**Favoritos del revisor:** ${(r.revision?.favoritos ?? []).join(', ')}`, '',
  ...r.ganchos.map(g => {
    const x = rev.get(g.numero)
    return [
      `## #${g.numero} · ${nombre[g.formato] ?? g.formato} · ${g.tipo_gancho}${x ? ` · ${x.general}/10` : ''}`,
      `Idea: ${g.idea}`, '', `**HOOK** · Velocidad ${g.velocidad} · (${g.indicacion})`, g.texto, '',
      `Insight: ${g.insight}`, `Por qué: ${g.por_que}`,
      x ? `Revisor: frena ${x.frena} · callout ${x.callout} · urgencia ${x.urgencia} · recurso ${x.recurso} · local ${x.local} · filtro ${x.filtro} · voz ${x.voz} — ${x.comentario}${x.mejora ? `\nMejora: ${x.mejora}` : ''}` : '',
      '',
    ].join('\n')
  }),
].join('\n')
writeFileSync(join(carpeta, `ganchos-${sello}.md`), md)
console.log(`ganchos: ${r.ganchos.length} · ${segundos} s · ~USD ${costo.toFixed(2)} · ajustes: ${r.ajustes.length} · favoritos: ${(r.revision?.favoritos ?? []).join(', ')}`)
console.log(`→ .cache/guiones/prueba/ganchos-${sello}.md`)
