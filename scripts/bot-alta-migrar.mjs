// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-alta-migrar.mjs [--simular]
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-alta-migrar.mjs --real [--confirmar]
// ── Tablas del motor de altas en Neon: cj_altas, cj_altas_pasos, cj_altas_mensajes y cj_altas_recursos ──────────────────
// Lee DATABASE_URL SOLO del entorno (cargá .env.local antes en la terminal; este script no abre archivos .env) y nunca la
// imprime. Las tablas las crea asegurarTablas() de lib/bot/alta/motor/almacenNeon.ts, la misma que corre el motor en su
// primera escritura: CREATE TABLE / INDEX IF NOT EXISTS y, en una tabla vieja, ADD COLUMN IF NOT EXISTS de lo que falte.
// Nunca DROP ni cambios de tipo. Correrla dos veces no cambia nada.
//   · --simular (por defecto): NO se conecta a ninguna base. Muestra las sentencias que correría.
//   · --real: solo lectura. Mira information_schema y dice qué tablas y columnas faltan.
//   · --real --confirmar: corre asegurarTablas() y vuelve a mirar.
// Conviene correrlo primero contra una RAMA de Neon (la DATABASE_URL de la rama) y después contra la base del Despacho.
// main() se exporta para scripts/test-bot-orquestador.mjs.
import { pathToFileURL } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { COLUMNAS_AGREGABLES, asegurarTablas, sqlParaPruebas } from '../lib/bot/alta/motor/almacenNeon.ts'

export const TABLAS = ['cj_altas', 'cj_altas_pasos', 'cj_altas_mensajes', 'cj_altas_recursos']
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

/** Cliente SQL que no se conecta: anota cada sentencia (los valores como $n). Responde vacío, salvo information_schema:
 *  ahí responde todas las columnas, como quedan después de los CREATE (así la simulación no muestra ALTER de más). */
export function sqlQueAnota(sentencias) {
  const columnas = Object.entries(COLUMNAS_AGREGABLES).flatMap(([t, cs]) => cs.map(([c]) => ({ table_name: t, column_name: c })))
  const q = (strings, ...vals) => {
    let t = ''
    strings.forEach((s, i) => {
      t += s
      if (i < vals.length) { const v = vals[i]; t += v && typeof v === 'object' && 'raw' in v ? v.raw : `$${i + 1}` }
    })
    sentencias.push(t.replace(/\s+/g, ' ').trim())
    return (async () => (/information_schema/.test(t) ? columnas : []))()
  }
  q.unsafe = (raw) => ({ raw })
  return q
}

/** Qué tablas y columnas (de las que el motor necesita) faltan en la base. */
export async function faltantes(q) {
  const filas = await q`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY(${TABLAS})`
  const hay = new Set(filas.map((f) => `${f.table_name}.${f.column_name}`))
  const tablas = new Set(filas.map((f) => String(f.table_name)))
  const sinTabla = TABLAS.filter((t) => !tablas.has(t))
  const sinColumna = Object.entries(COLUMNAS_AGREGABLES).flatMap(([t, cs]) => (tablas.has(t) ? cs.filter(([c]) => !hay.has(`${t}.${c}`)).map(([c]) => `${t}.${c}`) : []))
  return { sinTabla, sinColumna }
}

/** Devuelve el código de salida. `entorno`: { salida, crearSql } para los tests (crearSql reemplaza al cliente de Neon). */
export async function main(argv, entorno = {}) {
  const salida = entorno.salida ?? ((t) => console.log(t))
  let a
  try {
    a = parsearArgs(argv)
  } catch (e) {
    salida(`✖ ${e.message}`)
    return 1
  }

  if (a.modo === 'simular') {
    const sentencias = []
    const previa = process.env.DATABASE_URL
    if (!previa?.trim()) process.env.DATABASE_URL = URL_SIMULACION   // asegurarTablas la exige; el cliente falso no la usa
    sqlParaPruebas(() => sqlQueAnota(sentencias))
    try {
      await asegurarTablas()
    } finally {
      sqlParaPruebas(null)
      if (!previa?.trim()) delete process.env.DATABASE_URL
    }
    salida('Simulación: no se conectó a ninguna base. Esto es lo que correría asegurarTablas() en una base vacía:')
    for (const s of sentencias) salida(`  ${s.length > 160 ? `${s.slice(0, 157)}…` : s}`)
    salida(`(${sentencias.length} sentencias; en una base que ya tiene las tablas no cambia nada)`)
    return 0
  }

  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    salida('✖ Falta DATABASE_URL en el entorno (cargá .env.local, o la URL de una rama de Neon para probar).')
    return 1
  }
  const crear = entorno.crearSql ?? ((u) => neon(u, { fetchOptions: { signal: AbortSignal.timeout(20_000) } }))
  try {
    const antes = await faltantes(crear(url))
    salida(antes.sinTabla.length || antes.sinColumna.length
      ? `Faltan: ${[...antes.sinTabla.map((t) => `tabla ${t}`), ...antes.sinColumna.map((c) => `columna ${c}`)].join(', ')}`
      : 'Las 4 tablas del motor ya están, con todas sus columnas.')
    if (!a.confirmar) {
      if (antes.sinTabla.length || antes.sinColumna.length) salida('Sin --confirmar no se cambia nada. Para crearlas: --real --confirmar')
      return 0
    }
    sqlParaPruebas(entorno.crearSql ?? null)
    try { await asegurarTablas() } finally { sqlParaPruebas(null) }
    const despues = await faltantes(crear(url))
    if (despues.sinTabla.length || despues.sinColumna.length) {
      salida(`✖ Después de asegurarTablas() siguen faltando: ${[...despues.sinTabla, ...despues.sinColumna].join(', ')}`)
      return 1
    }
    salida('✔ Tablas del motor listas (cj_altas, cj_altas_pasos, cj_altas_mensajes, cj_altas_recursos).')
    return 0
  } catch (e) {
    salida(`✖ No se pudo: ${String(e?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
