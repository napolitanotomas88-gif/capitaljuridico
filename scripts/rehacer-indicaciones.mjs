// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/rehacer-indicaciones.mjs <tanda.json>
// Reescribe SOLO las indicaciones de grabación de una tanda guardada (preferencia 6 de Tomás: objeto o gesto, simple, sin
// jerga de cámara ni tono). Un pedido por guion en paralelo; el texto hablado no se toca. Solo api.anthropic.com.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const RAIZ = new URL('../', import.meta.url).pathname
for (const l of readFileSync(join(RAIZ, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
for (const k of Object.keys(process.env)) if (k.includes('DATABASE_URL') || k.startsWith('DISCORD_WEBHOOK') || k.startsWith('META_')) delete process.env[k]
const original = globalThis.fetch
globalThis.fetch = async (i, o) => { const u = typeof i === 'string' ? i : i instanceof URL ? i.href : i.url; if (new URL(u).host !== 'api.anthropic.com') throw new Error('host no permitido'); return original(i, o) }
const { llamarClaude } = await import('../lib/bot/kickoff/claude.ts')
const { PREFERENCIAS_TOMAS } = await import('../lib/bot/guiones/preferencias.ts')
const { revisarTanda } = await import('../lib/bot/guiones/revisar.ts')
const { CATALOGO } = await import('../lib/bot/guiones/formatos.ts')
const ruta = process.argv[2]
const d = JSON.parse(readFileSync(ruta, 'utf8'))
const SISTEMA = `Reescribís las indicaciones de grabación (lo que va entre paréntesis) de un guion de anuncio que graba un abogado con el celular. El texto hablado NO se toca. Regla de Tomás, el dueño:\n${PREFERENCIAS_TOMAS}\nEn cada sección, una o dos frases cortas, de vos, en español rioplatense, que digan qué objeto muestra o qué hace con la mano o el cuerpo, en el momento justo del texto. Mantené el recurso creativo del guion (el objeto o la acción que lo hace distinto) y que algo cambie en cada sección. Devolvé las 4 indicaciones en orden: HOOK, PROBLEMA, SOLUCION, CTA.`
const SCHEMA = { type: 'object', additionalProperties: false, required: ['indicaciones'], properties: { indicaciones: { type: 'array', items: { type: 'string' } } } }
const t0 = Date.now()
const res = await Promise.all(d.tanda.guiones.map(g => llamarClaude({ que: `indicaciones ${g.numero}`, sistema: SISTEMA, schema: SCHEMA, esfuerzo: 'medium', topeMs: 200000,
  usuario: `Recurso creativo: ${g.formato}. Utilería: ${g.utileria.join(', ') || 'ninguna'}\n` + g.secciones.map(s => `${s.seccion}\nIndicación actual: ${s.indicacion}\nTexto: ${s.texto}`).join('\n\n') })))
let usoIn = 0, usoOut = 0
d.tanda.guiones.forEach((g, k) => { const ind = res[k].json.indicaciones; usoIn += res[k].usage.input_tokens; usoOut += res[k].usage.output_tokens; if (Array.isArray(ind) && ind.length === 4) g.secciones.forEach((s, j) => { s.indicacion = String(ind[j]).replace(/^\(|\)$/g, '').trim() }) })
d.hallazgos = revisarTanda(d.tanda, CATALOGO, d.tanda.guiones.length)
d.indicaciones_v = 'p2'
writeFileSync(ruta.replace('.json', '-p2.json'), JSON.stringify(d, null, 2))
console.log(`${Math.round((Date.now() - t0) / 1000)} s · ~USD ${((usoIn * 4 + usoOut * 20) / 1e6).toFixed(2)} · errores: ${d.hallazgos.filter(h => h.gravedad === 'error').length}`)
for (const h of d.hallazgos) console.log(`  [${h.gravedad}] ${h.guion} · ${h.regla}: ${h.detalle}`)
