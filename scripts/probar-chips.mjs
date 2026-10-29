// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/probar-chips.mjs <idTanda> [docIdDePrueba] [--tanda=N] [--clave=x]
// Prueba controlada de la carga en chips (27/10/2026): toma una tanda de cj_guiones y la carga con cargarEnChips en un Doc de
// PRUEBA (por defecto «Guiones - PRUEBA BOT», copia de la plantilla en la carpeta «PRUEBA BOT guiones chips»). Se niega a
// escribir en cualquier Doc cuyo nombre no diga «PRUEBA». Nunca imprime la URL ni el secreto del puente.
import { readFileSync } from 'node:fs'
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '') }
const { leerTanda } = await import('../lib/bot/guiones/registro.ts')
const { guionesParaChips, claveTanda } = await import('../lib/bot/guiones/envio.ts')
const docPrueba = process.env.DOC_GUIONES_PRUEBA_ID?.trim()
if (!docPrueba) throw new Error('Falta DOC_GUIONES_PRUEBA_ID')
const [id, docId = docPrueba] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const claveForzada = process.argv.find(a => a.startsWith('--clave='))?.slice(8) ?? null   // para probar el freno ante texto ajeno
const tandaForzada = Number(process.argv.find(a => a.startsWith('--tanda='))?.slice(8)) || null   // sin esto, tanda 0 (la elige el puente, como en producción)
const fila = await leerTanda(Number(id))
if (!fila) throw new Error(`no existe la tanda ${id}`)
if (docId !== docPrueba && !process.argv.includes('--es-prueba')) throw new Error('solo el Doc de prueba (o pasá --es-prueba si el Doc es otra copia de PRUEBA)')
const r = await fetch(process.env.PUENTE_DRIVE_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ secreto: process.env.PUENTE_DRIVE_SECRETO, accion: 'cargarEnChips', docId, tanda: tandaForzada ?? 0, clave: claveForzada ?? claveTanda(fila), guiones: guionesParaChips(fila) }) })
console.log(r.status, (await r.text()).slice(0, 400))
