// Genera la configuración privada de alias desde una nota local explícita.
// El JSON se guarda en HUB_CONFIG_PRIVADA_DIR o .private-config, nunca dentro de lib/.
// Ejemplos y tests usan clientes ficticios; la nota real no se versiona.
// El extractor valida los nombres con el CRM antes de actuar.
// Columnas de la tabla: "Como aparece en transcripciones" | "Cliente real (CRM)" | "Ficha". Si "Cliente real" es "—", se
// usa el texto visible del enlace de la ficha ([[clientes/X\|Texto visible]]). Los alias van separados por coma (las
// comas dentro de paréntesis no cortan). Sale solo { escrito: [...], cliente } por fila: sin enlaces ni nada más.
//
// Solo LEE la bóveda. Para actualizar: correrlo de nuevo cuando cambie la tabla y dejar el JSON nuevo en la configuración privada.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const NOTA = process.argv[2] ?? process.env.HUB_ALIAS_NOTA?.trim() ?? ''
const SALIDA = join(resolve(process.env.HUB_CONFIG_PRIVADA_DIR?.trim() || join(process.cwd(), '.private-config')), 'fathom-alias.json')
const TITULO = /^##\s+Alias conocidos\b/

/** Celdas de una fila de tabla markdown; el "\|" de los enlaces de Obsidian no corta. */
function celdas(linea) {
  const PIPE = '\u0000'
  return linea.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, PIPE).split('|').map(c => c.replaceAll(PIPE, '|').trim())
}

/** "a, b (x, y), c" → ["a", "b (x, y)", "c"] */
function separarAlias(texto) {
  const partes = []
  let actual = '', nivel = 0
  for (const ch of texto) {
    if (ch === '(') nivel++
    if (ch === ')') nivel = Math.max(0, nivel - 1)
    if (ch === ',' && nivel === 0) { partes.push(actual); actual = '' } else actual += ch
  }
  partes.push(actual)
  return partes.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** Texto visible de [[ruta|Visible]] (o la última parte de la ruta si no tiene texto). */
function visibleDeFicha(celda) {
  const m = celda.match(/\[\[([^\]]+)\]\]/)
  if (!m) return ''
  const [ruta, visible] = m[1].split('|')
  return (visible ?? ruta.split('/').pop() ?? '').trim()
}

export function aliasDesdeNota(md) {
  const lineas = md.split(/\r?\n/)
  const inicio = lineas.findIndex(l => TITULO.test(l))
  if (inicio < 0) throw new Error('no está la sección "## Alias conocidos" en la nota')
  const filas = []
  for (const l of lineas.slice(inicio + 1)) {
    if (/^##\s/.test(l)) break
    if (!l.trim().startsWith('|')) continue
    const [escritoCelda, realCelda, fichaCelda] = celdas(l)
    if (!escritoCelda || /^-+$/.test(escritoCelda.replace(/:/g, '')) || /^como aparece/i.test(escritoCelda)) continue
    const real = (realCelda ?? '').trim()
    const cliente = (real && !/^[—–-]+$/.test(real) ? real : visibleDeFicha(fichaCelda ?? '')).replace(/\s+/g, ' ').trim()
    const escrito = [...new Set(separarAlias(escritoCelda))]
    if (!cliente || !escrito.length) continue
    filas.push({ escrito, cliente })
  }
  if (!filas.length) throw new Error('la sección "## Alias conocidos" no tiene filas')
  return filas
}

// Solo si se corre como script (los tests pueden importar aliasDesdeNota)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!NOTA) throw new Error('Indicá la nota privada como argumento o HUB_ALIAS_NOTA')
  const alias = aliasDesdeNota(readFileSync(NOTA, 'utf8'))
  mkdirSync(dirname(SALIDA), { recursive: true, mode: 0o700 })
  writeFileSync(SALIDA, `${JSON.stringify(alias, null, 2)}\n`, { mode: 0o600 })
  const repetidos = new Map()
  for (const a of alias) for (const e of a.escrito) repetidos.set(e, [...(repetidos.get(e) ?? []), a.cliente])
  const ambiguos = [...repetidos].filter(([, cs]) => new Set(cs).size > 1)
  console.log(`alias.json: ${alias.length} clientes, ${alias.reduce((n, a) => n + a.escrito.length, 0)} formas escritas → ${SALIDA}`)
  if (ambiguos.length) console.log(`ambiguos (mismo texto para varios clientes, el modelo decide por contexto): ${ambiguos.map(([e, cs]) => `${e} → ${[...new Set(cs)].join(' / ')}`).join('; ')}`)
}
