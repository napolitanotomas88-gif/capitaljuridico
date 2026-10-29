// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-bajas-migrar.mjs [--simular]
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-bajas-migrar.mjs --real [--confirmar]
// ── Tablas de la etapa BAJA en Neon: cj_bajas_pedidos, cj_bajas_bajas, cj_bajas_llamadas y cj_bajas_recontactos ─────────
// Mismo patrón que scripts/bot-alta-migrar.mjs. Lee DATABASE_URL SOLO del entorno (no abre archivos .env) y nunca la imprime.
// Las tablas las crea asegurarTablasBajas() (lib/bot/bajas/almacenNeon.ts), la misma que corre la etapa en su primera
// escritura: CREATE TABLE / INDEX IF NOT EXISTS. Nunca DROP ni cambios de tipo. Correrla dos veces no cambia nada.
//   · --simular (por defecto): NO se conecta a ninguna base. Muestra las sentencias que correría.
//   · --real: solo lectura. Dice qué tablas faltan.
//   · --real --confirmar: corre asegurarTablasBajas() y vuelve a mirar.
// main() se exporta para scripts/test-bot-bajas.mjs.
import { pathToFileURL } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { TABLAS_BAJAS, asegurarTablasBajas, sqlBajasParaPruebas } from '../lib/bot/bajas/almacenNeon.ts'

const URL_SIMULACION = 'postgres://simulacion.invalid/sin-base'

export function parsearArgs(argv) {
  const a = { modo: 'simular', confirmar: false }
  for (const x of argv) {
    if (x === '--simular') a.modo = 'simular'
    else if (x === '--real') a.modo = 'real'
    else if (x === '--confirmar') a.confirmar = true
    else throw new Error(`argumento desconocido: ${x.split('=')[0]}`)
  }
  if (a.confirmar && a.modo !== 'real') throw new Error('--confirmar va con --real')
  return a
}

/** Cliente SQL que no se conecta: anota cada sentencia (los valores como $n) y responde vacío. */
export function sqlQueAnota(sentencias) {
  const q = (strings, ...vals) => {
    let t = ''
    strings.forEach((s, i) => {
      t += s
      if (i < vals.length) { const v = vals[i]; t += v && typeof v === 'object' && 'raw' in v ? v.raw : `$${i + 1}` }
    })
    sentencias.push(t.replace(/\s+/g, ' ').trim())
    return (async () => [])()
  }
  q.unsafe = (raw) => ({ raw })
  q.query = async (t) => { sentencias.push(String(t).replace(/\s+/g, ' ').trim()); return [] }
  return q
}

export async function faltantes(q) {
  const filas = await q`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(${[...TABLAS_BAJAS]})`
  const hay = new Set(filas.map((f) => String(f.table_name)))
  return TABLAS_BAJAS.filter((t) => !hay.has(t))
}

export async function main(argv, entorno = {}) {
  const salida = entorno.salida ?? ((t) => console.log(t))
  let a
  try { a = parsearArgs(argv) } catch (e) { salida(`✖ ${e.message}`); return 1 }

  if (a.modo === 'simular') {
    const sentencias = []
    const previa = process.env.DATABASE_URL
    if (!previa?.trim()) process.env.DATABASE_URL = URL_SIMULACION
    sqlBajasParaPruebas(() => sqlQueAnota(sentencias))
    try { await asegurarTablasBajas() } finally {
      sqlBajasParaPruebas(null)
      if (!previa?.trim()) delete process.env.DATABASE_URL
    }
    salida('Simulación: no se conectó a ninguna base. Esto es lo que correría asegurarTablasBajas() en una base vacía:')
    for (const s of sentencias) salida(`  ${s.length > 160 ? `${s.slice(0, 157)}…` : s}`)
    salida(`(${sentencias.length} sentencias; en una base que ya tiene las tablas no cambia nada)`)
    return 0
  }

  const url = process.env.DATABASE_URL?.trim()
  if (!url) { salida('✖ Falta DATABASE_URL en el entorno (cargá .env.local, o la URL de una rama de Neon para probar).'); return 1 }
  const crear = entorno.crearSql ?? ((u) => neon(u, { fetchOptions: { signal: AbortSignal.timeout(20_000) } }))
  try {
    const antes = await faltantes(crear(url))
    salida(antes.length ? `Faltan: ${antes.join(', ')}` : 'Las 4 tablas de la etapa Bajas ya están.')
    if (!a.confirmar) {
      if (antes.length) salida('Sin --confirmar no se cambia nada. Para crearlas: --real --confirmar')
      return 0
    }
    sqlBajasParaPruebas(entorno.crearSql ?? null)
    try { await asegurarTablasBajas() } finally { sqlBajasParaPruebas(null) }
    const despues = await faltantes(crear(url))
    if (despues.length) { salida(`✖ Después de asegurarTablasBajas() siguen faltando: ${despues.join(', ')}`); return 1 }
    salida(`✔ Tablas de la etapa Bajas listas (${TABLAS_BAJAS.join(', ')}).`)
    return 0
  } catch (e) {
    salida(`✖ No se pudo: ${String(e?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
