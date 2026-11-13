// Importa el historial del EOW (el documento de Gero M exportado en HTML desde Google Docs) a Neon (cj_eow_reportes).
// El HTML tiene datos de clientes: NUNCA va al repo, se pasa por ruta.
//
//   # Prueba (por defecto): parsea y muestra conteos por semana, sin nombres ni comentarios. No toca la base.
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/eow-importar.mjs <eow.html>
//
//   # Cargar: crea las tablas si faltan (la misma función idempotente que usa la app) e inserta cada semana que NO exista.
//   # Las que ya están no se tocan. Con --forzar reemplaza solo las semanas importadas que nadie editó (versión 1).
//   node … scripts/eow-importar.mjs <eow.html> --cargar [--forzar]
//
// Lee DATABASE_URL de .env.local (o HUB_ENV_FILE) sin imprimirla. Solo habla con Neon.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const ruta = args.find((a) => !a.startsWith('--'))
const CARGAR = args.includes('--cargar')
const FORZAR = args.includes('--forzar')
if (!ruta || !existsSync(ruta)) {
  console.error('Uso: scripts/eow-importar.mjs <eow.html> [--cargar] [--forzar]')
  process.exit(1)
}

function cargarEnv() {
  const archivo = process.env.HUB_ENV_FILE?.trim() || join(RAIZ, '.env.local')
  if (!existsSync(archivo)) return
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m || process.env[m[1]]) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

// Solo Neon, y solo al cargar
const original = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (CARGAR && /neon\.tech$/.test(new URL(url).host)) return original(input, init)
  throw new Error('eow-importar: red no permitida')
}

const { importarHistorial } = await import('../lib/eow/importar.ts')
const { contar } = await import('../lib/eow/modelo.ts')
const { semanas, avisos } = importarHistorial(readFileSync(ruta, 'utf8'))

console.log(`Semanas: ${semanas.length}`)
for (const s of semanas) {
  const n = contar(s.datos.filas)
  const t = s.datos.tarjetas
  console.log(`  ${s.semana}${s.semana !== s.fechaDocumento ? ` (en el documento: ${s.fechaDocumento})` : ''} · clientes ${s.datos.filas.length} (rojo ${n.rojo}, amarillo ${n.amarillo}, verde ${n.verde}, pausados ${n.pausados}) · pesadilla ${t.pesadilla.length} · cancelaciones ${t.cancelaciones.length} · test. pedidos ${t.testimoniosPedidos.length} · obtenidos ${t.testimoniosObtenidos.length} · terminados ${t.servicioTerminado.length} · observaciones ${t.observaciones.length}`)
}
for (const a of avisos) console.log(`Aviso: ${a}`)

if (!CARGAR) {
  console.log('\nPrueba: no se escribió nada. Para cargar: --cargar')
  process.exit(0)
}

cargarEnv()
if (!process.env.DATABASE_URL?.trim()) {
  console.error('Falta DATABASE_URL')
  process.exit(1)
}
const { neon } = await import('@neondatabase/serverless')
const { asegurarTablasEow } = await import('../lib/eow/db.ts')
const q = neon(process.env.DATABASE_URL.trim())
await asegurarTablasEow(q)
const QUIEN = 'Importación (documento de Gero M)'
let nuevas = 0, reemplazadas = 0, intactas = 0
for (const s of semanas) {
  const data = JSON.stringify(s.datos)
  const r = await q`INSERT INTO cj_eow_reportes (semana, data, actualizado_por) VALUES (${s.semana}::date, ${data}::jsonb, ${QUIEN}) ON CONFLICT (semana) DO NOTHING RETURNING semana`
  if (r.length) {
    nuevas++
    await q`INSERT INTO cj_eow_historial (semana, quien, version, cambios) VALUES (${s.semana}::date, ${QUIEN}, 1, ${JSON.stringify(['Importado del documento'])}::jsonb)`
    continue
  }
  if (FORZAR) {
    const u = await q`UPDATE cj_eow_reportes SET data = ${data}::jsonb, actualizado = now() WHERE semana = ${s.semana}::date AND version = 1 AND actualizado_por = ${QUIEN} RETURNING semana`
    if (u.length) { reemplazadas++; continue }
  }
  intactas++
}
console.log(`\nCargado: ${nuevas} nuevas, ${reemplazadas} reemplazadas, ${intactas} ya estaban (sin tocar).`)
