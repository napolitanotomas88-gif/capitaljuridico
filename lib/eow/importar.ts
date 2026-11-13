// ── Importador del historial del EOW: el documento de Gero M exportado en HTML (Google Docs) → reportes por semana ───────
// Puro (sin red ni base): lo usa scripts/eow-importar.mjs y lo prueba scripts/test-eow.mjs con un ejemplo inventado. El HTML
// real NO va al repo (tiene datos de clientes): se pasa por ruta al script.
// Estructura de cada semana en el documento:
//   «Reporte EOW: DD/MM/AA», «Semáforo Rojo: (N)», «Semáforo Amarillo», «Semáforo Verde» con viñetas «Cliente - comentario»,
//   «Cliente Pesadilla», «Cancelaciones», «Reclamos abiertos», «Testimonios aceptados / pendientes / obtenidos»,
//   «Servicio terminado», «Observaciones», y los comentarios del documento como notas al pie [a], [b]…
// Reglas (pedido de Tomás, 13/11/2026):
//   · Reclamos abiertos → Observaciones con el prefijo «Reclamo: ».
//   · Testimonios aceptados y pendientes → «Testimonios pedidos».
//   · Las notas al pie se anexan al ítem que las cita («(Nota: …)»); si no se encuentra el ítem, van a Observaciones.
//   · «Pausado» se marca en las filas cuyo comentario dice que está pausado (pausamos, pausado/a, en pausa…), y esas filas
//     se suman a la tarjeta «Pausados».
//   · Fechas repetidas: si una semana repite la fecha de la anterior, se toma la anterior + 7 días (se informa en `avisos`).
import { datosVacios, esFecha, nuevoIdFila, sumarDias, unaLinea, TOPE_COMENTARIO, TOPE_CLIENTE, TOPE_ITEM, type Color, type DatosEow, type Tarjeta } from './modelo'

export interface SemanaImportada { semana: string; fechaDocumento: string; datos: DatosEow }
export interface ResultadoImportacion { semanas: SemanaImportada[]; avisos: string[] }

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•', iexcl: '¡', iquest: '¿',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»', deg: '°', ordm: 'º', ordf: 'ª', middot: '·',
}
// Vocales con tilde, diéresis, circunflejo y grave, y la eñe (Google Docs las exporta con nombre: &aacute;)
for (const v of 'aeiouAEIOU') for (const [suf, base] of [['acute', 0x301], ['grave', 0x300], ['uml', 0x308], ['circ', 0x302]] as const) ENTIDADES[`${v}${suf}`] = `${v}${String.fromCharCode(base)}`.normalize('NFC')
ENTIDADES.ntilde = 'ñ'
ENTIDADES.Ntilde = 'Ñ'
ENTIDADES.ccedil = 'ç'
function desescapar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m }
    return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? m
  })
}

/** HTML de Google Docs → líneas de texto. Las viñetas quedan con «• » adelante. */
export function htmlALineas(html: string): string[] {
  let s = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<head[\s\S]*?<\/head>/gi, '')
  s = s.replace(/<li[^>]*>/gi, '\n• ').replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  return desescapar(s).split('\n').map((l) => l.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
}

type Bloque = 'rojo' | 'amarillo' | 'verde' | 'pesadilla' | 'cancelaciones' | 'reclamos' | 'testAceptados' | 'testPendientes' | 'testObtenidos' | 'servicio' | 'observaciones'
const ENCABEZADOS: [RegExp, Bloque][] = [
  [/^sem[aá]foro rojo\b/i, 'rojo'],
  [/^sem[aá]foro amarillo\b/i, 'amarillo'],
  [/^sem[aá]foro verde\b/i, 'verde'],
  [/^cliente(s)? pesadilla\b/i, 'pesadilla'],
  [/^cancelaciones\b/i, 'cancelaciones'],
  [/^reclamos abiertos\b/i, 'reclamos'],
  [/^testimonios aceptados\b/i, 'testAceptados'],
  [/^testimonios pendientes\b/i, 'testPendientes'],
  [/^testimonios pedidos\b/i, 'testPendientes'],
  [/^testimonios obtenidos\b/i, 'testObtenidos'],
  [/^servicio(s)? terminado/i, 'servicio'],
  [/^observaciones\b/i, 'observaciones'],
]
const TARJETA_DE: Partial<Record<Bloque, Tarjeta>> = {
  pesadilla: 'pesadilla', cancelaciones: 'cancelaciones', testAceptados: 'testimoniosPedidos', testPendientes: 'testimoniosPedidos',
  testObtenidos: 'testimoniosObtenidos', servicio: 'servicioTerminado', observaciones: 'observaciones', reclamos: 'observaciones',
}
const RE_REPORTE = /^reporte eow:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i
const RE_NOTA = /^\[([a-z]{1,3})\]\s*(.*)$/i
const RE_MARCA = /\[([a-z]{1,3})\]/gi
const VACIO = /^[-–—•\s.]*$/

/** ¿El comentario dice que el cliente está en pausa? */
export const pareceePausado = (c: string): boolean =>
  /\bpausamos\b|\bpausad[oa]s?\b(?!\s+en\s+facebook)|\ben pausa\b|\bstand ?by\b/i.test(c) && !/publicidades pausadas en facebook/i.test(c)

/** «Cliente - comentario», «Cliente: comentario» o «Cliente (comentario)» */
export function partirItem(t: string): { cliente: string; comentario: string } {
  const guion = /^(.+?)\s+[-–—]\s*(.*)$/.exec(t)
  const dos = /^([^:]{2,80}?):\s*(.*)$/.exec(t)
  const paren = /^([^(]{2,80}?)\s*\((.*)\)\s*$/.exec(t)
  const m = [guion, dos, paren].filter((x): x is RegExpExecArray => !!x).sort((a, b) => a[1].length - b[1].length)[0]
  if (!m) return { cliente: t.trim(), comentario: '' }
  return { cliente: m[1].trim(), comentario: m[2].trim().replace(/^[-–—]\s*/, '').replace(/\s*[-–—]\s*$/, '') }
}

export function importarHistorial(html: string): ResultadoImportacion {
  const lineas = htmlALineas(html)
  const avisos: string[] = []

  // 1. Notas al pie: desde la primera línea «[a]…» que esté DESPUÉS del último encabezado de semana
  const ultimoReporte = lineas.reduce((i, l, k) => (RE_REPORTE.test(l) ? k : i), -1)
  let inicioNotas = lineas.length
  for (let k = Math.max(0, ultimoReporte); k < lineas.length; k++) if (RE_NOTA.test(lineas[k])) { inicioNotas = k; break }
  const notas = new Map<string, string>()
  let actual: string | null = null
  for (const l of lineas.slice(inicioNotas)) {
    const m = RE_NOTA.exec(l)
    if (m) { actual = m[1].toLowerCase(); notas.set(actual, m[2].trim()); continue }
    if (actual) notas.set(actual, `${notas.get(actual)} ${l}`.trim())
  }
  const usadas = new Set<string>()

  // 2. Semanas
  type Crudo = { fecha: string; bloques: { bloque: Bloque; cabecera: string; items: string[] }[] }
  const crudos: Crudo[] = []
  let semana: Crudo | null = null
  let bloque: Crudo['bloques'][number] | null = null
  for (const l of lineas.slice(0, inicioNotas)) {
    const r = RE_REPORTE.exec(l)
    if (r) {
      const anio = r[3].length === 2 ? `20${r[3]}` : r[3]
      semana = { fecha: `${anio}-${r[2].padStart(2, '0')}-${r[1].padStart(2, '0')}`, bloques: [] }
      crudos.push(semana)
      bloque = null
      continue
    }
    if (!semana) continue
    const enc = ENCABEZADOS.find(([re]) => re.test(l))
    if (enc) {
      // Lo que viene después de «Semáforo Verde: (56 clientes) - …» es una nota del encabezado
      const resto = l.replace(/^[^:]*:\s*/, '').replace(/^\(\s*\d+\s*clientes?\s*\)\s*/i, '').replace(/^[-–—]\s*/, '').trim()
      bloque = { bloque: enc[1], cabecera: /^sem[aá]foro/i.test(l) ? resto : '', items: [] }
      semana.bloques.push(bloque)
      if (!/^sem[aá]foro/i.test(l) && resto && !VACIO.test(resto) && !/^\(/.test(resto)) bloque.items.push(resto)
      continue
    }
    if (!bloque) continue
    const esViñeta = l.startsWith('• ')
    const texto = l.replace(/^•\s*/, '').trim()
    if (VACIO.test(texto)) continue
    const esColor = bloque.bloque === 'rojo' || bloque.bloque === 'amarillo' || bloque.bloque === 'verde'
    // En los semáforos, una línea sin viñeta continúa el ítem anterior; en las tarjetas, cada línea es un ítem
    if (esColor && !esViñeta && bloque.items.length) bloque.items[bloque.items.length - 1] += ` ${texto}`
    else bloque.items.push(texto.replace(/^[–—-]\s+/, ''))
  }

  // 3. Fechas repetidas → la anterior + 7 días
  const semanas: SemanaImportada[] = []
  for (let i = 0; i < crudos.length; i++) {
    const c = crudos[i]
    let fecha = c.fecha
    if (!esFecha(fecha)) { avisos.push(`Fecha inválida «${c.fecha}»: se saltea esa semana.`); continue }
    const previa = semanas[semanas.length - 1]?.semana
    if (previa && fecha <= previa) {
      const corregida = sumarDias(previa, 7)
      avisos.push(`La semana ${i + 1} repite o retrocede la fecha (${c.fecha}): se toma ${corregida} (la anterior + 7 días).`)
      fecha = corregida
    }
    const datos = datosVacios()
    const conNotas = (t: string): string => {
      let salida = t.replace(RE_MARCA, '').replace(/\s+/g, ' ').trim()
      const citadas = [...t.matchAll(RE_MARCA)].map((m) => m[1].toLowerCase())
      const textos = citadas.filter((k) => notas.has(k)).map((k) => { usadas.add(k); return notas.get(k)! })
      if (textos.length) salida = `${salida} (Nota: ${textos.join(' / ')})`
      return salida
    }
    for (const b of c.bloques) {
      if (b.bloque === 'rojo' || b.bloque === 'amarillo' || b.bloque === 'verde') {
        const color: Color = b.bloque
        if (b.cabecera) datos.tarjetas.observaciones.push(unaLinea(`${color[0].toUpperCase()}${color.slice(1)}: ${conNotas(b.cabecera)}`, TOPE_ITEM))
        for (const it of b.items) {
          // Las marcas [a] se sacan antes de partir (si no, «Cliente (comentario)[a]» no se reconoce) y se reponen al comentario
          const marcas = [...it.matchAll(RE_MARCA)].map((m) => m[0]).join('')
          const { cliente, comentario } = partirItem(it.replace(RE_MARCA, '').trim())
          const limpio = unaLinea(cliente, TOPE_CLIENTE)
          if (!limpio) continue
          const com = unaLinea(conNotas(`${comentario}${marcas}`), TOPE_COMENTARIO)
          const pausado = pareceePausado(comentario)
          datos.filas.push({ id: nuevoIdFila(`i${fecha.replace(/-/g, '')}`), cliente: limpio, comentario: com, color, pausado, idCrm: null, lanzado: null, origen: 'importado' })
          if (pausado) datos.tarjetas.pausados.push(limpio)
        }
        continue
      }
      const tarjeta = TARJETA_DE[b.bloque]
      if (!tarjeta) continue
      for (const it of b.items) {
        if (/^nuevo enfoque de testimonio/i.test(it)) continue
        const t = unaLinea(conNotas(it), TOPE_ITEM)
        if (!t) continue
        const item = b.bloque === 'reclamos' ? `Reclamo: ${t}` : t
        if (!datos.tarjetas[tarjeta].includes(item)) datos.tarjetas[tarjeta].push(item)
      }
    }
    semanas.push({ semana: fecha, fechaDocumento: c.fecha, datos })
  }
  // Notas que no se pudieron anexar: a Observaciones de la última semana
  const sueltas = [...notas.keys()].filter((k) => !usadas.has(k))
  if (sueltas.length && semanas.length) {
    for (const k of sueltas) semanas[semanas.length - 1].datos.tarjetas.observaciones.push(unaLinea(`Nota [${k}]: ${notas.get(k)}`, TOPE_ITEM))
    avisos.push(`${sueltas.length} notas sin ítem: van a Observaciones de la última semana.`)
  }
  return { semanas, avisos }
}
