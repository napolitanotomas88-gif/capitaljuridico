// ── Bot "Capital Jurídico": sumar la respuesta del closer al #ALTA (diseño del motor, sección 3.3) ─────────────────────
// Puro y sin red. Cuando el bot pide un dato que falta, el closer responde con líneas "Clave: valor" ("Teléfono: +54 9 …",
// "DNI: …") y, a veces, el bloque entero de "Cuotas:". Concatenar los textos no sirve: el parser ACUMULA teléfonos y cuotas
// (parsearAlta), así que un teléfono corregido quedaría dos veces. Por eso:
//   · una línea con una clave que el #ALTA ya tenía la REEMPLAZA (todas las líneas de ese campo, que pueden ser varias);
//   · una clave nueva se suma antes de "Cuotas:" (o al final);
//   · si la respuesta trae "Cuotas:", reemplaza el bloque entero;
//   · si trae "Socios:" (con un socio por línea), se SUMA a los socios del #ALTA (Tomás, 24/10/2026: cada socio lleva su
//     correo para Skool): el socio que ya estaba (mismo nombre, teléfono o correo) se completa sin perder lo que tenía
//     ("Ana Gómez · ana@…" le pone el correo y deja su teléfono), uno nuevo se agrega y "Socios: ninguno" los saca.
// Setter, Fuente y Cuenta no son campos del #ALTA (el parser no los conoce): los lee extrasDeRespuesta.
// Cada cambio dice si COMPLETA un dato que faltaba o CORRIGE uno que ya estaba (revisión del diseño, punto 3): una
// corrección de algo que un paso ya usó abre un OK; completar no.
import { claveDeLinea, esContinuacionSocios, fecha, leerSocios, monto, parsearAlta, sinSocios, type Socio } from '../parsear'

export interface CambioFusion { campo: string; antes: string | null; despues: string; tipo: 'completa' | 'corrige' | 'igual' }
export interface Fusion { texto: string; cambios: CambioFusion[] }
export interface ExtrasRespuesta { setter?: string; fuente?: string; cuenta?: string }

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.+ ]/g, ' ').replace(/\s+/g, ' ').trim()
const valorDe = (linea: string) => { const i = linea.indexOf(':'); return i < 0 ? '' : linea.slice(i + 1).trim() }

/** "dd/mm/aaaa 1100" o "19/11/2026 cuota $1100⏳": una línea del cronograma de cuotas. */
export function esLineaCuota(linea: string): boolean {
  if (!fecha(linea)) return false
  return monto(linea.replace(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/, '')) !== null
}

// Claves de lo que el bot pregunta además del #ALTA (normalizadas)
const CLAVES_EXTRA: Record<string, keyof ExtrasRespuesta> = {
  setter: 'setter', fuente: 'fuente', cuenta: 'cuenta', 'cuenta que recibio': 'cuenta', 'cuenta que recibe': 'cuenta',
}
function claveExtra(linea: string): keyof ExtrasRespuesta | null {
  const i = linea.indexOf(':')
  if (i <= 0) return null
  return CLAVES_EXTRA[normal(linea.slice(0, i))] ?? null
}

/** Setter, Fuente y Cuenta de la respuesta del closer o de un aprobador ("Setter: Mai"). */
export function extrasDeRespuesta(texto: string): ExtrasRespuesta {
  const out: ExtrasRespuesta = {}
  for (const l of texto.split(/\r?\n/)) {
    const k = claveExtra(l.trim())
    const v = valorDe(l)
    if (k && v) out[k] = v
  }
  return out
}

/** Cuántas líneas "Clave: valor" reconoce el bot (campos del #ALTA más Setter, Fuente y Cuenta). Una respuesta sin cita
 *  en Ventas solo se toma si trae al menos una (revisión del diseño, punto 21: Ventas es un grupo con charla). */
export function lineasReconocidas(texto: string): number {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#\s*alta\b/i.test(l) && (claveDeLinea(l) !== null || claveExtra(l) !== null)).length
}

/** Bloque "Cuotas:" de un texto: [inicio, fin) de líneas (la de "Cuotas:" y las de cronograma que la siguen). */
function bloqueCuotas(lineas: string[]): [number, number] | null {
  const i = lineas.findIndex((l) => claveDeLinea(l) === 'cuotas')
  if (i < 0) return null
  let j = i + 1
  while (j < lineas.length && (lineas[j].trim() === '' || (esLineaCuota(lineas[j]) && claveDeLinea(lineas[j]) === null))) j++
  // las líneas vacías del final no son del bloque
  while (j > i + 1 && lineas[j - 1].trim() === '') j--
  return [i, j]
}

/** Bloques "Socios:" de un texto: [inicio, fin) de líneas (la de "Socios:" y las de cada socio que la siguen, con el mismo
 *  criterio que el parser: esContinuacionSocios). */
function bloquesSocios(lineas: string[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < lineas.length; i++) {
    if (claveDeLinea(lineas[i]) !== 'socios') continue
    const vacia = !valorDe(lineas[i])
    let j = i + 1
    while (j < lineas.length && (lineas[j].trim() === '' || esContinuacionSocios(lineas[j], vacia))) j++
    while (j > i + 1 && lineas[j - 1].trim() === '') j--
    out.push([i, j])
    i = j - 1
  }
  return out
}

/** Los tramos de socios de un bloque: el valor de "Socios:" y cada línea de abajo, partidos por ";". */
const tramosDe = (bloque: string[]) => [valorDe(bloque[0]), ...bloque.slice(1)].flatMap((l) => l.split(';')).map((l) => l.trim()).filter(Boolean)
const palabras = (n: string) => normal(n).split(' ').filter((p) => p.length > 1 && !['de', 'del', 'la', 'las', 'los', 'y'].includes(p))
/** "Ana" es la misma que "Ana Gómez" (todas las palabras de una están en la otra). */
const mismoNombre = (a: string, b: string) => { const x = palabras(a), y = palabras(b); return x.length > 0 && y.length > 0 && (x.every((p) => y.includes(p)) || y.every((p) => x.includes(p))) }
const lineaSocio = (s: Socio) => [s.nombre, s.telefono ? `+${s.telefono}` : null, s.correo].filter(Boolean).join(' · ')

/** Suma los socios de la respuesta a los del #ALTA. Devuelve las líneas del bloque nuevo (sin la de "Socios:") y el tipo
 *  de cambio: 'completa' si solo llenó lo que faltaba, 'corrige' si cambió un teléfono o un correo, agregó o sacó socios. */
function fusionarSocios(tramosAlta: string[], tramosResp: string[]): { lineas: string[]; tipo: CambioFusion['tipo'] } {
  type Tramo = { texto: string; socios: Socio[]; tocado: boolean }
  const alta: Tramo[] = tramosAlta.map((texto) => ({ texto, socios: leerSocios(texto), tocado: false }))
  const existentes = alta.flatMap((t) => t.socios.map((s) => ({ s, t })))
  const nuevos: Socio[] = []
  let corrige = false, completa = false
  for (const r of tramosResp.flatMap((t) => leerSocios(t))) {
    // Por nombre (exacto primero; "Ana" sola solo si hay una Ana), después por teléfono o por correo. Sin teléfono en la
    // respuesta, un correo solo va al único socio con nombre al que le falta el correo, y un nombre parecido ("Bea Gómez"
    // por "Beatriz Gómez": comparten una palabra) también, si es el único sin correo que se parece.
    const porNombre = r.nombre ? existentes.filter((x) => x.s.nombre && normal(x.s.nombre) === normal(r.nombre!)) : []
    const parecidos = r.nombre && !porNombre.length ? existentes.filter((x) => x.s.nombre && mismoNombre(x.s.nombre, r.nombre!)) : []
    const sinCorreo = existentes.filter((x) => x.s.nombre && !x.s.correo)
    const comparten = r.nombre && !r.telefono ? sinCorreo.filter((x) => palabras(x.s.nombre!).some((p) => palabras(r.nombre!).includes(p))) : []
    const e = porNombre[0] ?? (parecidos.length === 1 ? parecidos[0] : undefined)
      ?? (r.telefono ? existentes.find((x) => x.s.telefono === r.telefono) : undefined)
      ?? (r.correo ? existentes.find((x) => x.s.correo === r.correo) : undefined)
      ?? (!r.nombre && !r.telefono && r.correo && sinCorreo.length === 1 ? sinCorreo[0] : undefined)
      ?? (comparten.length === 1 ? comparten[0] : undefined)
    if (!e) { nuevos.push(r); corrige = true; continue }
    const antes = { ...e.s }
    if (r.nombre && (!e.s.nombre || r.nombre.length > e.s.nombre.length)) e.s.nombre = r.nombre
    if (r.telefono && r.telefono !== e.s.telefono) { if (e.s.telefono) corrige = true; e.s.telefono = r.telefono }
    if (r.correo && r.correo !== e.s.correo) { if (e.s.correo) corrige = true; e.s.correo = r.correo }
    if (JSON.stringify(antes) !== JSON.stringify(e.s)) { e.t.tocado = true; completa = true }
  }
  // Un tramo sin cambios queda tal cual (con su "(estudio)" o lo que tuviera); uno tocado se rearma socio por socio, y
  // también uno que, solo en su línea, el parser no leería como socio (p. ej. "Tel: +54 …", que es la clave del cliente)
  const tal = (t: Tramo) => !t.tocado && esContinuacionSocios(t.texto, true)
  const lineas = [...alta.flatMap((t) => (tal(t) ? [t.texto] : t.socios.map(lineaSocio))), ...nuevos.map(lineaSocio)]
  return { lineas, tipo: corrige ? 'corrige' : completa ? 'completa' : 'igual' }
}

export function fusionarRespuesta(textoAlta: string, respuesta: string): Fusion {
  let lineas = textoAlta.split(/\r?\n/)
  const resp = respuesta.split(/\r?\n/).map((l) => l.trim())
  const cambios: CambioFusion[] = []

  // 0. Socios de la respuesta: se suman a los del #ALTA (no reemplazan: así no se pierde el teléfono de nadie)
  const bsResp = bloquesSocios(resp)
  if (bsResp.length) {
    const tramosResp = bsResp.flatMap(([i, j]) => tramosDe(resp.slice(i, j)))
    const bsAlta = bloquesSocios(lineas)
    const tramosAlta = bsAlta.flatMap(([i, j]) => tramosDe(lineas.slice(i, j)))
    const antes = tramosAlta.length && !sinSocios(tramosAlta.join('; ')) ? tramosAlta.join('; ') : null
    let bloque: string[], tipo: CambioFusion['tipo']
    if (sinSocios(tramosResp.join('; '))) {
      // "Socios: ninguno" (o "No tiene"): saca los que hubiera
      bloque = [resp[bsResp[0][0]]]
      tipo = antes ? 'corrige' : bsAlta.length ? 'igual' : 'completa'
    } else {
      const f = fusionarSocios(antes ? tramosAlta : [], tramosResp)
      bloque = ['Socios:', ...f.lineas]
      // Sin socios en el #ALTA: completa si no decía nada; si decía "ninguno", es una corrección
      tipo = antes ? f.tipo : bsAlta.length ? 'corrige' : 'completa'
    }
    if (tipo !== 'igual') {
      // El bloque nuevo va donde estaba el primero (los demás se sacan) o, si no había, antes de "Cuotas:" o al final
      const sacar = new Set(bsAlta.flatMap(([i, j]) => Array.from({ length: j - i }, (_, k) => i + k)))
      const donde = bsAlta.length ? bsAlta[0][0] : (bloqueCuotas(lineas)?.[0] ?? lineas.length)
      lineas = [...lineas.slice(0, donde).filter((_, i) => !sacar.has(i)), ...bloque, ...lineas.slice(donde).filter((_, i) => !sacar.has(i + donde))]
    }
    cambios.push({ campo: 'socios', antes, despues: bloque.slice(1).join('; ') || valorDe(bloque[0]), tipo })
  }

  // 1. Bloque de cuotas de la respuesta: reemplaza el del #ALTA entero
  const bResp = bloqueCuotas(resp)
  if (bResp) {
    const nuevo = resp.slice(bResp[0], bResp[1]).filter(Boolean)
    const bAlta = bloqueCuotas(lineas)
    const antes = bAlta ? lineas.slice(bAlta[0] + 1, bAlta[1]).filter((l) => l.trim()).join(' · ') : null
    const despues = nuevo.slice(1).join(' · ')
    if (bAlta) lineas = [...lineas.slice(0, bAlta[0]), ...nuevo, ...lineas.slice(bAlta[1])]
    else lineas = [...lineas, ...nuevo]
    cambios.push({ campo: 'cuotas', antes: antes || null, despues, tipo: !antes ? 'completa' : normal(antes) === normal(despues) ? 'igual' : 'corrige' })
  }

  // 2. Cada línea "Clave: valor" (fuera de los bloques de cuotas y de socios)
  resp.forEach((l, idx) => {
    if (!l || /^#\s*alta\b/i.test(l)) return
    if (bResp && idx >= bResp[0] && idx < bResp[1]) return
    if (bsResp.some(([i, j]) => idx >= i && idx < j)) return
    const campo = claveDeLinea(l)
    if (!campo || campo === 'cuotas' || campo === 'socios') return
    const despues = valorDe(l)
    const iguales = lineas.map((x, i) => (claveDeLinea(x) === campo ? i : -1)).filter((i) => i >= 0)
    const antes = iguales.length ? iguales.map((i) => valorDe(lineas[i])).filter(Boolean).join(' · ') : null
    if (iguales.length) {
      const [primera, ...resto] = iguales
      lineas[primera] = l
      lineas = lineas.filter((_, i) => !resto.includes(i))
    } else {
      const b = bloqueCuotas(lineas)
      lineas = b ? [...lineas.slice(0, b[0]), l, ...lineas.slice(b[0])] : [...lineas, l]
    }
    cambios.push({ campo, antes: antes || null, despues, tipo: !antes ? 'completa' : normal(antes) === normal(despues) ? 'igual' : 'corrige' })
  })
  return { texto: lineas.join('\n'), cambios }
}

const RE_CORREO = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i
const ETIQUETA_CORREO = /^(?:correo|mail|email|e mail)(?: electronico)?$/
const ETIQUETA_CORREO_DE = /^(?:correo|mail|email|e mail)(?: electronico)? (?:de|del) (?:(?:la|el) )?(?:(?:socio|socia) )?(.+)$/

/** Correos de socios contestados de otras formas (revisión del 24/10, ronda 2). Cuando el #ALTA tiene socios con nombre:
 *  · "Correo de Beatriz: x" / "Mail de la socia Beatriz Gómez: x" → a ese socio;
 *  · "Beatriz Gómez: x" (el nombre de un socio como etiqueta) → a ese socio;
 *  · "Correo: x" / "Mail: x" con un correo distinto del que ya tiene el cliente y UN solo socio sin correo → a ese socio
 *    (con más de uno, `ambiguo`: se pregunta de quién es; sin ninguno, es una corrección del correo del cliente).
 *  Cada una se reescribe como "Socios: Nombre · correo", que fusionarRespuesta suma sin perder el teléfono del socio. El
 *  resto de la respuesta queda igual. Puro. */
export function adaptarRespuestaSocios(textoAlta: string, respuesta: string): { texto: string; ambiguo: boolean } {
  const lineasAlta = textoAlta.split(/\r?\n/)
  const tramos = bloquesSocios(lineasAlta).flatMap(([i, j]) => tramosDe(lineasAlta.slice(i, j)))
  const socios = sinSocios(tramos.join('; ')) ? [] : tramos.flatMap((t) => leerSocios(t)).filter((x) => x.nombre)
  if (!socios.length) return { texto: respuesta, ambiguo: false }
  const alta = parsearAlta(textoAlta)
  const correoCliente = alta.correo?.trim().toLowerCase() ?? null
  const esCliente = (n: string) => !!alta.nombre && mismoNombre(alta.nombre, n)
  const sinCorreo = socios.filter((x) => !x.correo)
  const socioDe = (nombre: string): Socio | null => {
    const exacto = socios.filter((x) => normal(x.nombre!) === normal(nombre))
    if (exacto.length === 1) return exacto[0]
    const parecidos = socios.filter((x) => mismoNombre(x.nombre!, nombre))
    if (parecidos.length === 1) return parecidos[0]
    const comparten = socios.filter((x) => palabras(x.nombre!).some((p) => palabras(nombre).includes(p)))
    return comparten.length === 1 ? comparten[0] : null
  }
  const resp = respuesta.split(/\r?\n/)
  const enSocios = new Set(bloquesSocios(resp.map((l) => l.trim())).flatMap(([i, j]) => Array.from({ length: j - i }, (_, k) => i + k)))
  let ambiguo = false
  const salida = resp.map((linea, idx) => {
    if (enSocios.has(idx)) return linea
    const i = linea.indexOf(':')
    const correo = i > 0 ? RE_CORREO.exec(linea.slice(i + 1))?.[0] : undefined
    if (!correo) return linea
    const etiqueta = normal(linea.slice(0, i))
    const aSocio = (x: Socio) => `Socios: ${x.nombre} · ${correo}`
    if (ETIQUETA_CORREO.test(etiqueta)) {
      if (!correoCliente || correo.toLowerCase() === correoCliente || !sinCorreo.length) return linea
      if (sinCorreo.length === 1) return aSocio(sinCorreo[0])
      ambiguo = true
      return linea
    }
    const de = ETIQUETA_CORREO_DE.exec(etiqueta)
    if (de) {
      if (esCliente(de[1])) return `Correo: ${correo}`
      const x = socioDe(de[1])
      return x ? aSocio(x) : linea
    }
    // El nombre de un socio como etiqueta (y no una clave del #ALTA: "Correo", "Dirección"…, ni el nombre del cliente)
    if (claveDeLinea(linea) !== null || claveExtra(linea) !== null || esCliente(etiqueta)) return linea
    const x = socioDe(etiqueta)
    return x ? aSocio(x) : linea
  })
  return { texto: salida.join('\n'), ambiguo }
}

/** Huella del texto de un #ALTA para reconocer un reenvío: sin mayúsculas, acentos, signos ni espacios de más. */
export function textoNormalizado(texto: string): string {
  return texto.split(/\r?\n/).map(normal).filter(Boolean).join('\n')
}
