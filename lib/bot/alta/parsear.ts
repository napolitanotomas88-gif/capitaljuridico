// ── Bot "Capital Jurídico": lectura del mensaje de alta que mandan los closers en "Ventas C.J." ─────
// Pedido de Tomás (21/10/2026), ver docs/BOT-ALTA-CJ.md. Lee:
//   · el formato nuevo `#ALTA` ("Clave: valor" por línea), y
//   · el formato de antes ("Nombre completo del lead:", "Teléfono y de los socios:", cronograma con ✅/⏳…),
//     porque los closers van a tardar en cambiar de costumbre.
// No escribe nada ni llama a ninguna API: devuelve los datos + lo que falta (para pedírselo al closer) +
// avisos (para que un humano mire). El comprobante (imagen) se valida aparte.
// Montos: en USD. "$" se toma como USD porque así escriben los closers en este grupo. Si "Este pago" dice ARS, pesos,
// MP o Mercado Pago, o trae un monto de más de 6 cifras sin decir USD ("$3.500.000"), se marca en `pagoEnPesos`: un
// monto en pesos NO se toma como USD (Tomás, 24/10/2026: va a la col F y el USD sale del MEP, en finanzas.ts).
// Criterio del bot (a confirmar con Tomás): también se toma como pesos un monto sin "USD" de más de USD 10.000, que
// ningún programa cuesta ("$465.000"); con el MEP a ~1.500, un Fee en pesos tiene 6 cifras.
// En "Este pago" el monto es el pegado a la moneda ("1ra cuota 1100 USD" → 1100); los ordinales ("1ra", "cuota 1")
// y las fechas no cuentan como monto.
// Socios (Tomás, 24/10/2026): también reciben la invitación a Skool, así que cada socio va con nombre, teléfono y correo,
// uno por línea debajo de "Socios:" ("Ana Gómez · +54 9 11 … · ana@…"). El formato de antes (todo en la línea de
// "Socios:", separados por coma) se sigue leyendo. Un socio con nombre y sin correo es un faltante, como el del cliente.
import { normalizarTelefono, telefonoSinPais } from './telefono'

export type Ymd = string   // 'aaaa-mm-dd'

export interface Telefono { numero: string; etiqueta: string }   // numero = solo dígitos con código de país
/** Un socio del #ALTA. Cuenta como socio (para Skool) si trae nombre o correo: un teléfono suelto, sin nombre ni correo,
 *  suele ser el del estudio (se suma a los grupos igual, pero no se lo invita a Skool ni se le pide el correo). */
export interface Socio {
  nombre: string | null     // como lo escribió el closer, sin títulos ni aclaraciones ("Ana Gómez")
  telefono: string | null   // solo dígitos con código de país (como Telefono.numero)
  correo: string | null     // en minúscula
}
export interface Cuota { fecha: Ymd; montoUsd: number; pagada: boolean }
/** Parte de "Este pago" que se pagó en pesos (Mercado Pago, transferencia en pesos…). */
export interface PagoEnPesos {
  ars: number | null            // monto en pesos que escribió el closer (null si no lo puso)
  usdDelCloser: number | null   // USD que el closer dice que son esos pesos (null si solo puso pesos)
  usdAparte: number             // lo que se pagó en el mismo pago en USD por otro medio (efectivo…); 0 si fue todo en pesos
}

export interface AltaParseada {
  etiquetaAlta: boolean          // trae "#ALTA"
  closer: string | null
  programa: string | null
  modalidad: 'PP' | 'PIF' | null // PP = en cuotas · PIF = pago completo
  totalUsd: number | null
  estePagoUsd: number | null
  medioPago: string | null
  pagoEnPesos: PagoEnPesos | null   // null = nada en pesos
  nombre: string | null
  telefonos: Telefono[]          // el primero es el del cliente; el resto, socios / estudio
  socios: string | null          // el texto de "Socios:" (con un socio por línea, las líneas van unidas con "; "): leerSocios()
  correo: string | null
  direccion: string | null
  dni: string | null
  cuit: string | null            // 'XX-XXXXXXXX-X'
  inicio: Ymd | null
  contrato: 'normal' | 'garantia'   // sin la línea "Contrato:" se toma el normal
  cuotas: Cuota[]
  /** "2 cuotas de 1300" (formato libre): el monto de cada cuota. Solo está si el mensaje lo dice (altaLibre.ts, regla C). */
  primeraCuotaUsd?: number
  faltantes: string[]            // se le piden al closer
  avisos: string[]               // los mira un humano antes de seguir
}

export const MINIMO_USD = 500

/** Menos de USD 500 es un "Fee" (seña): se registra en Finanzas y el alta no arranca (Tomás, 24/10/2026). */
export const esMontoFee = (usd: number | null | undefined): boolean => usd != null && usd < MINIMO_USD

/** Aviso del parser para un pago en USD de menos de USD 500. El estado del alta lo decide plan.ts (con el USD calculado
 *  si el pago fue en pesos), así que plan.ts lo saca de la lista de cosas a revisar con `esAvisoFee`. */
const PREFIJO_AVISO_FEE = 'Pago de '
export const avisoFee = (usd: number) => `${PREFIJO_AVISO_FEE}${usd} USD: es un Fee (seña). Se registra en Finanzas y el alta arranca cuando el pago llegue a USD ${MINIMO_USD}`
export const esAvisoFee = (aviso: string) => aviso.startsWith(PREFIJO_AVISO_FEE) && aviso.includes('es un Fee (seña)')

/** Programa del #ALTA → prefijo de la lista de Finanzas (Tomás, 24/10/2026): el closer no lo escribe y el bot lo deduce.
 *  · vacío, "Agencia", "DFY" o "Done For You" → DFY (agencia);
 *  · "Renovación" o cualquier "+R" ("DFY+R", "Agencia + R") → DFY+R, y con "++" → DFY+R++: es una renovación, no un alta nueva;
 *  · DWY ("Done With You") no se usa en las altas, pero si el closer lo escribe se respeta;
 *  · cualquier otro texto queda tal cual (Finanzas avisa que no está en la lista). */
export function prefijoPrograma(programa: string | null): string {
  const p = (programa ?? '').trim()
  if (!p) return 'DFY'
  const c = p.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9+]/g, '')
  if (/RENOV|\+R/.test(c)) return /\+\+/.test(c) ? 'DFY+R++' : 'DFY+R'
  if (/DWY|DONEWITHYOU/.test(c)) return 'DWY'
  if (/DFY|AGENCIA|DONEFORYOU/.test(c)) return 'DFY'
  return p
}
/** DFY+R o DFY+R++: renovación (no es un alta nueva). */
export const esRenovacion = (programa: string | null) => prefijoPrograma(programa).startsWith('DFY+R')

// Claves aceptadas (normalizadas: minúsculas, sin acentos ni signos) → campo
const CLAVES: Record<string, keyof Campos> = {
  'closer': 'closer',
  'programa': 'programa',
  'tipo de pago': 'tipoPago',
  'este pago': 'estePago',
  'nombre completo': 'nombre',
  'nombre completo del lead': 'nombre',
  'nombre': 'nombre',
  'telefono': 'telefono',
  'tel': 'telefono',
  // Formato libre (Tomás, 26/10/2026: altas sin #ALTA, ver altaLibre.ts): las mismas claves que usa el detector
  'nombre y apellido': 'nombre',
  'nombre del cliente': 'nombre',
  'cliente': 'nombre',
  'telefono del cliente': 'telefono',
  'cel': 'telefono',
  'celular': 'telefono',
  'whatsapp': 'telefono',
  'whats app': 'telefono',
  'wsp': 'telefono',
  'wpp': 'telefono',
  'e mail': 'correo',
  'correo electronico': 'correo',
  'ci': 'dni',          // cédula de identidad (Paraguay, Uruguay): va donde el DNI
  'c i': 'dni',
  'cedula': 'dni',
  'cedula de identidad': 'dni',
  'telefono y de los socios': 'telefono',
  'socios': 'socios',
  'correo': 'correo',
  'correo principal': 'correo',
  'mail': 'correo',
  'email': 'correo',
  'direccion': 'direccion',
  'domicilio': 'direccion',
  'dni': 'dni',
  'cuit': 'cuit',
  'cuil': 'cuit',
  'inicio del servicio': 'inicio',
  'fecha de inicio del servicio': 'inicio',
  'cuotas': 'cuotas',
  'contrato': 'contrato',
}
interface Campos {
  closer: string; programa: string; tipoPago: string; estePago: string; nombre: string; telefono: string
  socios: string; correo: string; direccion: string; dni: string; cuit: string; inicio: string; cuotas: string; contrato: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** "3300", "$3300", "1.100", "1100,50", "USD 1.100" → número. null si no hay número. */
export function monto(texto: string): number | null {
  const m = texto.match(/\d[\d.,]*/)
  if (!m) return null
  let s = m[0].replace(/[.,]$/, '')
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** dd/mm/aaaa (o dd-mm-aaaa, año de 2 dígitos) → 'aaaa-mm-dd'. */
export function fecha(texto: string): Ymd | null {
  const m = texto.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (!m) return null
  const d = Number(m[1]), mes = Number(m[2])
  let a = Number(m[3]); if (a < 100) a += 2000
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const RE_TEL = /\+?\d[\d\s\-().]{7,}\d/g

/** Correos de un texto ("ana.gomez@estudio.com.ar"). Sin paréntesis, comas ni "·" pegados, y sin el punto final. */
const RE_CORREO_G = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi
export const tieneCorreo = (texto: string): boolean => new RegExp(RE_CORREO_G.source, 'i').test(texto)
export const correosDe = (texto: string): string[] => [...texto.matchAll(RE_CORREO_G)].map((m) => m[0].toLowerCase())
/** Cada correo del texto reemplazado por lo que devuelva `por` (la bienvenida los cambia por "," para separar nombres). */
export const reemplazarCorreos = (texto: string, por: (correo: string) => string): string => texto.replace(RE_CORREO_G, por)
/** El texto con los correos tapados por espacios (mismo largo): así los dígitos de un correo ("estudio2215001111@…")
 *  nunca se leen como teléfono y la etiqueta de un teléfono no se queda con el correo de al lado. */
const taparCorreos = (texto: string) => reemplazarCorreos(texto, (m) => ' '.repeat(m.length))

// Pesos y dólares, sobre el texto normalizado (norm deja solo letras, números y espacios: "u$s" → "u s")
const RE_PESOS = /\bars\b|\bpesos?\b|\bmercado ?pago\b|\bmp\b/
// Monto pegado a la moneda, sobre el texto original: "3.500.000 ARS", "ARS 3.500.000", "1100 USD", "U$S 1.100"
const RE_MONTO_ARS = /(\d[\d.,]*)\s*(?:ars|pesos?)\b|\b(?:ars|ar\$)\s*\$?\s*(\d[\d.,]*)/i
const RE_MONTO_USD = /(\d[\d.,]*)\s*(?:usd|u\$s|us\$|d[oó]lar(?:es)?)|\b(?:usd|u\$s|us\$)\s*\$?\s*(\d[\d.,]*)/i
const montoEn = (t: string, re: RegExp) => { const m = t.match(re); return m ? monto(m[1] ?? m[2]) : null }
// Dice USD (sobre el texto original). "usdt" es cripto, no cuenta.
const RE_DICE_USD = /\busd\b|u\$s|us\$|d[oó]lar/i
// Números que NO son montos: ordinales ("1ra", "2do", "1°"), número de cuota ("cuota 1", "cuota 1/3", "cuota 2 de 3";
// "cuota 1.100" sí es un monto) y fechas ("24/10", "24/10/2026").
const RE_NO_MONTO = new RegExp([
  String.raw`\b\d{1,2}\s*(?:ra|ro|da|do|er|ta|to|va|vo|na|no|ma|mo)\b\.?`,
  String.raw`\b\d{1,2}\s*[°º]`,
  String.raw`\bcuotas?\s*(?:n\S{0,6}\s*)?\d{1,2}(?:\s*(?:de|\/)\s*\d{1,2})?\b(?![.,]\d)`,
  String.raw`\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b`,
].join('|'), 'gi')
const sinNoMontos = (t: string) => t.replace(RE_NO_MONTO, ' ')
/** Monto de un tramo sin moneda: el primer número que no sea un ordinal, un número de cuota ni una fecha. */
const montoSuelto = (t: string) => monto(sinNoMontos(t))
// El más caro de los programas es USD 8.000: un monto sin "USD" más grande que esto no puede ser USD, son pesos.
const TOPE_USD_SUELTO = 10_000
/** Un monto sin "USD" que no puede ser USD son pesos. Tomás (24/10/2026): "$" con más de 6 cifras ("$3.500.000");
 *  el bot lo amplía a más de USD 10.000 ("$465.000"), que ningún programa cuesta. Mira el primer monto (sin ordinales
 *  ni fechas) y los escritos como plata ("$…" o con punto de miles), no números de operación sueltos. */
export function pesosPorCifras(t: string): boolean {
  if (RE_DICE_USD.test(t)) return false
  const s = sinNoMontos(t)
  const candidatos = [monto(s), ...[...s.matchAll(/\$\s*(\d[\d.,]*)|\b(\d{1,3}(?:[.,]\d{3})+)\b/g)].map((m) => monto(m[1] ?? m[2]))]
  return candidatos.some((n) => n !== null && n > TOPE_USD_SUELTO)
}

/** Parte en pesos de un pago: "200 USD · Mercado Pago (pesos)", "$3.500.000 ARS (Mercado Pago)",
 *  "2400 usd efectivo + 200 usd en transferencia en pesos". null si no se pagó nada en pesos.
 *  Con un solo tramo, todo el pago es en pesos; con "+", solo los tramos que dicen pesos (el resto es USD aparte). */
export function pagoEnPesos(texto: string): PagoEnPesos | null {
  const enPesos = (t: string) => RE_PESOS.test(norm(t)) || pesosPorCifras(t)
  if (!enPesos(texto)) return null
  const tramos = texto.split('+')
  const conPesos = tramos.length > 1 ? tramos.filter(enPesos) : tramos
  const aparte = tramos.length > 1 ? tramos.filter((t) => !enPesos(t)) : []
  let ars: number | null = null, usd: number | null = null
  for (const t of conPesos) {
    const usdExplicito = montoEn(t, RE_MONTO_USD)
    const suelto = usdExplicito === null ? montoSuelto(t) : null
    // "ARS"/"pesos" pegado al número, o un número suelto demasiado grande para ser USD
    const a = montoEn(t, RE_MONTO_ARS) ?? (suelto !== null && suelto > TOPE_USD_SUELTO ? suelto : null)
    const u = usdExplicito ?? (a === null ? suelto : null)   // sin moneda = USD (así escriben los closers)
    if (a !== null) ars = (ars ?? 0) + a
    if (u !== null) usd = (usd ?? 0) + u
  }
  const usdAparte = aparte.reduce((s, t) => s + (montoEn(t, RE_MONTO_USD) ?? montoSuelto(t) ?? 0), 0)
  return { ars, usdDelCloser: usd, usdAparte }
}

/** Teléfonos de una línea, con el texto que viene después de cada uno como etiqueta ("nicolas", "estudio").
 *  Los números quedan con código de país (sin "+" se completa el de Argentina cuando es claro: telefono.ts).
 *  Los correos no cuentan: ni sus dígitos son un teléfono ni van en la etiqueta (24/10/2026, socios con correo). */
export function telefonos(textoOriginal: string): Telefono[] {
  const texto = taparCorreos(textoOriginal)
  const out: Telefono[] = []
  const matches = [...texto.matchAll(RE_TEL)]
  matches.forEach((m, i) => {
    const digitos = m[0].replace(/\D/g, '')
    if (digitos.length < 8) return
    const fin = i + 1 < matches.length ? matches[i + 1].index! : texto.length
    const etiqueta = texto.slice(m.index! + m[0].length, fin).replace(/[,;/·-]/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({ numero: normalizarTelefono(m[0]), etiqueta })
  })
  return out
}

// ── Socios ─────────────────────────────────────────────────────────────────────────────────────────────────
// "Socios:" es texto libre: los closers ponen nombres y teléfonos, pero también "No tiene", "Trabaja sola", "N/A" o "-".
// Esas frases no son nombres (antes la bienvenida saludaba "Hola Juan y No!"). Lo usan el parser y la bienvenida.

/** Palabras que no son un nombre en "Socios:": títulos, relleno, parentescos y frases de "no tiene". Sin acentos ni
 *  puntos, en minúscula. Las partículas de apellido ("de", "la"…) tampoco cuentan como nombre. */
const NO_ES_NOMBRE = new Set(('socio socia socios socias estudio estudios oficina abogado abogada abogados abogadas dr dra ' +
  'dres lic abog abg esc ab tel telefono telefonos cel celular whatsapp wsp wpp numero nro contacto mail correo ' +
  'secretario secretaria asistente contador contadora hermano hermana esposo esposa pareja marido mujer hijo hija ' +
  'padre madre colega su sus mi el ella ellos ellas con y e de del la las los da do dos van von es son un una pero otro ' +
  'otra tambien ademas ' +
  'no sin tiene posee hay aplica ninguno ninguna nadie solo sola solamente trabaja unipersonal independiente individual'
).split(' '))

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** ¿La palabra parece un nombre propio? Solo letras (con ' o -), 2 o más, y no es relleno: "Ana" y "Ma." sí;
 *  "socia", "Dra.", "tel", "y", "x" o "+54" no. No mira mayúsculas: eso lo decide quien llama. */
export function esPalabraDeNombre(palabra: string): boolean {
  const p = palabra.replace(/^['’.]+|[.,;:'’]+$/g, '')
  return /^\p{L}[\p{L}'’-]*\p{L}$/u.test(p) && !NO_ES_NOMBRE.has(sinAcentos(p).replace(/[^a-zñ]/g, ''))
}

/** Frases que dicen que no hay socios, al principio del texto (normalizado: sin acentos y sin signos). */
const RE_FRASE_SIN_SOCIOS = /^(no|sin|ningun[oa]?|nadie|sol[oa]|solamente|trabaja sol[oa]|unipersonal|n a|na)( |$)/

/** true = el campo "Socios:" dice que no hay socios: vacío, empieza con "No", "Sin", "Ningún", "Solo", "Trabaja
 *  solo/sola", "Unipersonal" o "N/A", o no trae ningún teléfono ni ninguna palabra con mayúscula inicial que parezca
 *  nombre ("-", "—", ".", "x", "nadie"). Ojo: con esta regla, un nombre todo en minúscula y sin teléfono no cuenta. */
export function sinSocios(texto: string | null | undefined): boolean {
  const t = (texto ?? '').trim()
  if (!t) return true
  if (RE_FRASE_SIN_SOCIOS.test(sinAcentos(t).replace(/[^a-z0-9ñ]+/g, ' ').trim())) return true
  if (telefonos(t).length || tieneCorreo(t)) return false
  return !t.split(/[\s,;/()·:–—-]+/).some((p) => /^['’.]*\p{Lu}/u.test(p) && esPalabraDeNombre(p))
}

/** Partículas de apellido: siguen el nombre ("Juan de la Vega") pero solas no son un nombre. */
const PARTICULAS_SOCIO = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'do', 'dos', 'di', 'du', 'van', 'von', 'le'])

/** Nombres de un trozo de texto sin teléfonos ni correos: "Ana Gómez", "socia Ana (estudio)", "Ana y Pedro" → cada
 *  nombre desde la primera palabra que parece nombre propio (con mayúscula, salvo que todo esté en minúscula) hasta la
 *  primera que no ("Ana Gómez socia" → "Ana Gómez"). Los títulos ("Dra.") y el relleno ("tel", "su hermano") quedan afuera. */
function nombresDelHueco(hueco: string, todoMinuscula: boolean): string[] {
  const out: string[] = []
  for (const trozo of hueco.split(/[,/]|\s+[ye]\s+/i)) {
    const palabras = trozo.replace(/[()·:–—|-]/g, ' ').trim().split(/\s+/).filter(Boolean)
    const desde = palabras.findIndex((p) => esPalabraDeNombre(p) && (todoMinuscula || /^['’.]*\p{Lu}/u.test(p)))
    if (desde < 0) continue
    const nombre: string[] = []
    for (const p of palabras.slice(desde)) {
      if (esPalabraDeNombre(p) || PARTICULAS_SOCIO.has(sinAcentos(p))) nombre.push(p.replace(/[,;:]+$/, ''))
      else break
    }
    while (nombre.length && PARTICULAS_SOCIO.has(sinAcentos(nombre[nombre.length - 1]))) nombre.pop()
    if (nombre.length) out.push(nombre.join(' '))
  }
  return out
}

type CampoSocio = keyof Socio
/** Los socios de un tramo (una línea, o un pedazo entre ";"). Cada nombre, teléfono y correo es una pieza; las piezas se
 *  juntan en orden: una pieza de un tipo que el socio en armado ya tiene abre otro socio ("Ana +54 1 ana@x, Pedro +54 2"
 *  y "+54 1 Ana, +54 2 Pedro" dan dos socios). Si vienen en columnas ("Ana y Pedro: +54 1, +54 2"), con la misma cantidad
 *  de cada tipo, se emparejan por orden. */
function sociosDelTramo(tramo: string, todoMinuscula: boolean): Socio[] {
  const marcas: { tipo: CampoSocio; valor: string; desde: number; hasta: number }[] = []
  for (const m of tramo.matchAll(RE_CORREO_G)) marcas.push({ tipo: 'correo', valor: m[0].toLowerCase(), desde: m.index!, hasta: m.index! + m[0].length })
  for (const m of taparCorreos(tramo).matchAll(RE_TEL)) {
    if (m[0].replace(/\D/g, '').length >= 8) marcas.push({ tipo: 'telefono', valor: normalizarTelefono(m[0]), desde: m.index!, hasta: m.index! + m[0].length })
  }
  marcas.sort((x, y) => x.desde - y.desde)
  const piezas: { tipo: CampoSocio; valor: string }[] = []
  let pos = 0
  for (const mk of [...marcas, null]) {
    for (const n of nombresDelHueco(tramo.slice(pos, mk ? mk.desde : tramo.length), todoMinuscula)) piezas.push({ tipo: 'nombre', valor: n })
    if (mk) { piezas.push({ tipo: mk.tipo, valor: mk.valor }); pos = mk.hasta }
  }
  // En columnas: cada tipo en un solo tramo seguido y todos con la misma cantidad (2 o más)
  const tipos = piezas.map((p) => p.tipo)
  const corridas = tipos.filter((t, i) => i === 0 || tipos[i - 1] !== t)
  const cuenta = (t: CampoSocio) => tipos.filter((x) => x === t).length
  const presentes = [...new Set(tipos)]
  if (presentes.length > 1 && corridas.length === presentes.length && presentes.every((t) => cuenta(t) === cuenta(presentes[0])) && cuenta(presentes[0]) >= 2) {
    const de = (t: CampoSocio) => piezas.filter((p) => p.tipo === t).map((p) => p.valor)
    return de(presentes[0]).map((_, i) => ({ nombre: de('nombre')[i] ?? null, telefono: de('telefono')[i] ?? null, correo: de('correo')[i] ?? null }))
  }
  const out: Socio[] = []
  let actual: Socio = { nombre: null, telefono: null, correo: null }
  const cerrar = () => { if (actual.nombre || actual.telefono || actual.correo) out.push(actual); actual = { nombre: null, telefono: null, correo: null } }
  for (const p of piezas) {
    if (actual[p.tipo] !== null) cerrar()
    actual[p.tipo] = p.valor
  }
  cerrar()
  return out
}

/** Todo lo que trae "Socios:", socio por socio (nombre, teléfono y correo). [] si no hay socios ("ninguno", "No tiene",
 *  "-"…). Incluye los teléfonos sueltos (sin nombre ni correo): quien llama decide con `esSocioSkool` si cuentan. */
export function leerSocios(texto: string | null | undefined): Socio[] {
  const t = (texto ?? '').trim()
  if (!t || sinSocios(t)) return []
  const todoMinuscula = t === t.toLowerCase()
  return t.split(/[;\n]/).flatMap((tramo) => sociosDelTramo(tramo, todoMinuscula))
}

/** ¿Este socio entra a Skool? Sí si trae nombre o correo; un teléfono suelto (el del estudio, por ejemplo) no. */
export const esSocioSkool = (s: Socio): boolean => !!(s.nombre || s.correo)

/** Faltante del parser cuando hay socios con nombre y sin correo. Empieza siempre igual (el motor arma el ejemplo con eso). */
export const FALTANTE_CORREO_SOCIOS = 'Correo de cada socio'
export function faltanteCorreoSocios(nombres: string[]): string {
  const unir = (n: string[]) => (n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`)
  return `${FALTANTE_CORREO_SOCIOS} (${nombres.length === 1 ? `falta el de ${nombres[0]}` : `faltan los de ${unir(nombres)}`})`
}

/** ¿La línea sigue el bloque de "Socios:"? (un socio por línea). No si es "Clave: valor" ni una línea de cuotas. Sí si trae
 *  un teléfono o un correo; con "Socios:" vacío, también un nombre solo ("Ana Gómez") o "ninguno". Lo usan el parser y la
 *  fusión del motor (lib/bot/alta/motor/fusion.ts), para que los dos vean el mismo bloque. */
export function esContinuacionSocios(linea: string, cabeceraVacia: boolean): boolean {
  const l = linea.trim()
  if (!l || /^#\s*alta\b/i.test(l) || lineaClaveValor(l) || lineaCuota(l)) return false
  if (tieneCorreo(l) || telefonos(l).length) return true
  return cabeceraVacia && !/[\d:]/.test(l) && /\p{L}{2}/u.test(l)
}

/** Campo del #ALTA al que corresponde una línea "Clave: valor" ("Teléfono: …" → 'telefono', "Nombre completo del lead:" →
 *  'nombre'), con la misma tabla que usa el parser. null si la línea no tiene una clave conocida. Lo usa el motor del bot
 *  (lib/bot/alta/motor/fusion.ts) para reemplazar una línea en vez de sumarla: el parser ACUMULA teléfonos y cuotas. */
export function claveDeLinea(linea: string): keyof Campos | null {
  return lineaClaveValor(linea.trim())?.[0] ?? null
}

// Negritas y cursivas de WhatsApp alrededor del valor ("*Nombre:* Ana")
const limpiarValor = (v: string) => v.replace(/^[*_\s]+|[*_\s]+$/g, '')

function lineaClaveValor(linea: string): [keyof Campos, string] | null {
  const i = linea.indexOf(':')
  const clave = i > 0 ? CLAVES[norm(linea.slice(0, i))] : undefined
  if (clave) return [clave, limpiarValor(linea.slice(i + 1))]
  // Formato libre (26/10/2026): "Tel - +595 …", "Nombre – Ana". Solo con una clave conocida antes del guion, así una línea
  // de cuota ("26/11/2026 - 1100") o de un socio ("Ana Gómez - +54 …") no cambia.
  const g = /^(.{1,40}?)\s*[-–—]\s+(.*)$/.exec(linea)
  const claveGuion = g ? CLAVES[norm(g[1])] : undefined
  return g && claveGuion ? [claveGuion, limpiarValor(g[2])] : null
}

/** Línea de cronograma: "19/11/2026 cuota $1100⏳", "19/10/2026: inicio $1100 ✅", "dd/mm/aaaa 1100". */
function lineaCuota(linea: string): Cuota | null {
  const f = fecha(linea)
  if (!f) return null
  const sinFecha = linea.replace(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/, '')
  const m = monto(sinFecha)
  if (m === null) return null
  return { fecha: f, montoUsd: m, pagada: /✅|✔|pagad|abonad/i.test(linea) }
}

export function parsearAlta(mensaje: string): AltaParseada {
  const r: AltaParseada = {
    etiquetaAlta: /#\s*alta\b/i.test(mensaje), closer: null, programa: null, modalidad: null, totalUsd: null,
    estePagoUsd: null, medioPago: null, pagoEnPesos: null, nombre: null, telefonos: [], socios: null, correo: null, direccion: null,
    dni: null, cuit: null, inicio: null, contrato: 'normal', cuotas: [], faltantes: [], avisos: [],
  }
  const lineas = mensaje.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let enCuotas = false
  const sueltas: string[] = []   // líneas sin clave reconocida (formato libre)
  // "Socios:" y las líneas de cada socio que lo siguen (formato del 24/10/2026: uno por línea). Se procesa al cerrar el
  // bloque, para que los teléfonos de los socios queden en el orden en que aparecen (crm.ts los reconoce releyendo `socios`).
  let bloqueSocios: { lineas: string[]; vacia: boolean } | null = null
  const textosSocios: string[] = []
  const correosCliente: string[] = []   // todos los correos de las líneas "Correo:" (más de uno = se pregunta)
  const cerrarSocios = () => {
    if (!bloqueSocios) return
    const valor = bloqueSocios.lineas.join('; ')
    bloqueSocios = null
    // "No tiene", "Trabaja sola", "N/A", "-"… sin teléfono: no hay socios. Con teléfono se guarda igual (aunque empiece con
    // "No…"), porque crm.ts y la comunidad releen `socios` para saber qué números no son del cliente (la bienvenida y
    // leerSocios vuelven a mirar sinSocios). Los números son los mismos de siempre (telefonos), en orden de aparición.
    const tels = telefonos(valor)
    if (!valor || /^ningun/i.test(norm(valor)) || (sinSocios(valor) && !tels.length)) return
    textosSocios.push(valor)
    // Etiqueta: el nombre del socio; un teléfono suelto conserva lo que lo acompañaba ("(estudio)")
    const nombres = new Map(leerSocios(valor).filter((s) => s.telefono && s.nombre).map((s) => [s.telefono!, s.nombre!]))
    r.telefonos.push(...tels.map((t) => ({ numero: t.numero, etiqueta: nombres.get(t.numero) ?? (t.etiqueta || 'socio') })))
  }

  for (const linea of lineas) {
    if (/^#\s*alta\b/i.test(linea)) continue
    const kv = lineaClaveValor(linea)
    if (kv) {
      const [campo, valor] = kv
      enCuotas = campo === 'cuotas'
      cerrarSocios()
      switch (campo) {
        case 'closer': r.closer = valor || null; break
        case 'programa': r.programa = valor || null; break
        case 'tipoPago': leerTipoPago(r, valor); break
        case 'estePago': {
          const medio = valor.replace(/^[^·\-–]*[·\-–]/, '').trim()
          r.medioPago = medio && medio !== valor ? medio : null
          // En pesos: si el closer solo puso pesos, el USD queda null (sale de la conversión, no del número en ARS)
          const p = pagoEnPesos(valor)
          r.pagoEnPesos = p
          // En USD: el monto pegado a la moneda ("1ra cuota 1100 USD" → 1100); si no hay, el primero que no sea un ordinal
          r.estePagoUsd = !p ? (montoEn(valor, RE_MONTO_USD) ?? montoSuelto(valor)) : p.usdDelCloser !== null ? p.usdDelCloser + p.usdAparte : null
          if (p?.ars != null && !RE_PESOS.test(norm(valor))) r.avisos.push(`"Este pago" trae ${p.ars.toLocaleString('es-AR')} sin decir la moneda: por la cantidad de cifras se toma como pesos (confirmar con el comprobante)`)
          break
        }
        case 'nombre': r.nombre = valor || null; break
        case 'telefono': r.telefonos.push(...telefonos(valor)); break
        // Se cierra en la próxima "Clave: valor" (o al final). Las líneas de en medio que sigan el bloque son socios.
        case 'socios': bloqueSocios = { lineas: valor ? [valor] : [], vacia: !valor }; break
        case 'correo': r.correo = (valor.match(/[^\s@]+@[^\s@]+\.[^\s@]+/) ?? [null])[0]?.toLowerCase() ?? null; correosCliente.push(...correosDe(valor)); break
        case 'direccion': r.direccion = valor || null; break
        case 'dni': { const d = valor.replace(/\D/g, ''); r.dni = d || null; break }
        case 'cuit': {
          const d = valor.replace(/\D/g, '')
          r.cuit = d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (d || null)
          break
        }
        case 'inicio': r.inicio = fecha(valor); break
        case 'cuotas': break
        case 'contrato': r.contrato = /garant/i.test(valor) ? 'garantia' : 'normal'; break
      }
      continue
    }
    if (bloqueSocios) {
      if (esContinuacionSocios(linea, bloqueSocios.vacia)) { bloqueSocios.lineas.push(linea); continue }
      cerrarSocios()
    }
    const cuota = lineaCuota(linea)
    if (cuota) { r.cuotas.push(cuota); continue }
    if (enCuotas) continue
    sueltas.push(linea)
  }
  cerrarSocios()
  r.socios = textosSocios.length ? textosSocios.join('; ') : null

  // Formato libre (ej. Carlos: "Ingresa pago PIF 2400 usd efectivo + 200 usd en transferencia en pesos" + nombre suelto)
  for (const s of sueltas) {
    if (!r.modalidad && /\b(PIF|PP)\b/i.test(s)) {
      leerTipoPago(r, s)
      const montos = [...s.matchAll(/(\d[\d.,]*)\s*(usd|u\$s|dolares|\$)/gi)].map(m => monto(m[1])).filter((n): n is number => n !== null)
      if (montos.length > 1) {
        const suma = montos.reduce((a, b) => a + b, 0)
        r.totalUsd = suma
        r.avisos.push(`Monto armado sumando ${montos.join(' + ')} = ${suma} USD: confirmar`)
      }
      if (r.estePagoUsd === null && r.modalidad === 'PIF') r.estePagoUsd = r.totalUsd
      r.medioPago ??= s.replace(/^.*?\b(PIF|PP)\b[\s\d.,$usd]*/i, '').trim() || null
      r.pagoEnPesos ??= pagoEnPesos(s)
      continue
    }
    // Formato libre (26/10/2026): "2 cuotas de 1300" y una línea de pago sin PIF/PP ("Seña 300 USD")
    const c = cuotasDe(s)
    if (c && !r.modalidad) { r.modalidad = 'PP'; r.totalUsd = c.total; r.primeraCuotaUsd = c.cuota; continue }
    // Una seña escrita después de "PIF 1300 USD" corrige el "este pago = total" que se puso al leer el PIF
    const senaTrasPif = r.modalidad === 'PIF' && r.estePagoUsd === r.totalUsd && /\b(sena|senas|fee|anticipo|parcial)\b/.test(norm(s))
    if ((r.estePagoUsd === null || senaTrasPif) && RE_LINEA_PAGO.test(norm(s)) && (RE_DICE_USD.test(s) || /\$\s*\d/.test(s))) {
      const p = pagoEnPesos(s)
      if (p) { r.pagoEnPesos ??= p; r.estePagoUsd = p.usdDelCloser !== null ? p.usdDelCloser + p.usdAparte : null }
      else r.estePagoUsd = montoEn(s, RE_MONTO_USD) ?? montoSuelto(s)
      continue
    }
    if (!r.nombre && /^[\p{L}' ]{5,60}$/u.test(s) && s.split(' ').length >= 2) { r.nombre = s; continue }
  }

  // Lo que se puede deducir del cronograma
  if (r.cuotas.length) {
    const pagadas = r.cuotas.filter(c => c.pagada)
    if (r.estePagoUsd === null && pagadas.length) r.estePagoUsd = pagadas[pagadas.length - 1].montoUsd
    r.inicio ??= r.cuotas[0].fecha
    // En el formato #ALTA "Cuotas:" lista solo las que faltan (sin ✅): se suma "Este pago". Si "Este pago" fue en pesos
    // sin decir cuántos USD, no se puede sumar (el USD sale del MEP): no se compara.
    const suma = r.cuotas.reduce((a, c) => a + c.montoUsd, 0) + (pagadas.length ? 0 : r.estePagoUsd ?? 0)
    const sePuedeSumar = pagadas.length > 0 || r.estePagoUsd !== null || !r.pagoEnPesos
    if (sePuedeSumar && r.totalUsd !== null && Math.abs(suma - r.totalUsd) > 1) r.avisos.push(`El cronograma suma ${suma} USD y el total dice ${r.totalUsd} USD`)
  }
  if (r.modalidad === 'PIF' && r.estePagoUsd === null) {
    r.estePagoUsd = r.totalUsd
    // PIF pagado en pesos sin decir cuántos USD: el closer dijo el total, así que esos pesos valen el total
    if (r.pagoEnPesos && r.pagoEnPesos.usdDelCloser === null && r.totalUsd !== null) r.pagoEnPesos.usdDelCloser = r.totalUsd - r.pagoEnPesos.usdAparte
  }

  // Controles
  if (!r.nombre) r.faltantes.push('Nombre completo')
  if (!r.telefonos.length) r.faltantes.push('Teléfono')
  if (!r.correo) r.faltantes.push('Correo')
  // Más de un correo en "Correo:" (o dos líneas): casi siempre es el de un socio escrito como "Correo:"/"Mail:", que pisaría
  // el del cliente (contrato, CRM). Se pregunta en vez de quedarse con el último.
  const correosDistintos = [...new Set(correosCliente)]
  if (correosDistintos.length > 1) r.faltantes.push(`Correo del cliente (vinieron ${correosDistintos.length}: ${correosDistintos.join(', ')}; el de cada socio va en su línea de "Socios:")`)
  // Socios (Tomás, 24/10/2026): cada uno recibe la invitación a Skool, así que un socio con nombre y sin correo falta
  const sociosSinCorreo = leerSocios(r.socios).filter((s) => s.nombre && !s.correo).map((s) => s.nombre!)
  if (sociosSinCorreo.length) r.faltantes.push(faltanteCorreoSocios(sociosSinCorreo))
  if (!r.modalidad || r.totalUsd === null) r.faltantes.push('Tipo de pago (PP o PIF) y total en USD')
  if (r.estePagoUsd === null && r.pagoEnPesos?.ars == null) r.faltantes.push('Este pago (monto en USD y medio)')
  if (r.telefonos[0] && telefonoSinPais(r.telefonos[0].numero)) r.faltantes.push('Teléfono con código de país (ej. +54 9 11 …)')
  if (!r.inicio) r.faltantes.push('Inicio del servicio')
  if (r.modalidad === 'PP' && !r.cuotas.length) r.faltantes.push('Cuotas (fecha y monto)')
  const argentino = r.telefonos[0]?.numero.startsWith('54') ?? false
  if (argentino && !r.dni) r.faltantes.push('DNI')
  if (argentino && !r.cuit) r.faltantes.push('CUIT')
  if (!r.direccion) r.faltantes.push('Dirección')
  if (r.etiquetaAlta && !r.closer) r.faltantes.push('Closer')

  if (r.estePagoUsd !== null && r.totalUsd !== null && r.estePagoUsd > r.totalUsd + 1) r.avisos.push(`Este pago (${r.estePagoUsd} USD) es más que el total (${r.totalUsd} USD): ¿el monto está en pesos?`)
  // Fee: solo con un pago en USD. En pesos lo decide plan.ts con el USD calculado con el MEP (el del closer puede no coincidir).
  if (!r.pagoEnPesos && esMontoFee(r.estePagoUsd)) r.avisos.push(avisoFee(r.estePagoUsd!))
  // DFY+R es una renovación: si llega en un #ALTA, no se arranca un alta nueva sin que lo confirmen (Tomás, 24/10/2026)
  if (esRenovacion(r.programa)) r.avisos.push(`Programa ${prefijoPrograma(r.programa)}: es una renovación, no un alta nueva. Tomi o Gero confirman antes de seguir (no se crean CRM, Drive ni comunidad nuevos)`)
  if (r.dni && r.cuit && !r.cuit.replace(/\D/g, '').includes(r.dni)) r.avisos.push('El CUIT no contiene el DNI: revisar')
  if (r.dni && (r.dni.length < 7 || r.dni.length > 8)) r.avisos.push(`DNI con ${r.dni.length} dígitos: revisar`)
  if (r.cuit && r.cuit.replace(/\D/g, '').length !== 11) r.avisos.push('CUIT sin 11 dígitos: revisar')
  return r
}

function leerTipoPago(r: AltaParseada, valor: string) {
  const m = valor.match(/\b(PIF|PP)\b/i)
  r.modalidad = m ? (m[1].toUpperCase() as 'PP' | 'PIF') : null
  r.totalUsd = monto(valor.replace(/\b(PIF|PP)\b/i, ''))
  const c = cuotasDe(valor)
  if (c) { r.modalidad ??= 'PP'; r.totalUsd = c.total; r.primeraCuotaUsd = c.cuota }
}

/** "2 cuotas de 1300", "3 cuotas de USD 1.100" → cada cuota y el total. null si el texto no lo dice. */
export function cuotasDe(texto: string): { n: number; cuota: number; total: number } | null {
  const m = /\b(\d{1,2})\s*cuotas?\s*de\s*(?:usd|u\$s|us\$|\$)?\s*(\d[\d.,]*)/i.exec(texto)
  if (!m) return null
  const n = Number(m[1]), cuota = monto(m[2])
  if (!n || cuota === null || cuota <= 0) return null
  return { n, cuota, total: n * cuota }
}

// Línea de pago en formato libre sin PIF/PP ("Seña 300 USD", "Pagó 1000 usd por transferencia"): el monto de este pago
const RE_LINEA_PAGO = /\b(sena|senas|fee|parcial|pago|pagos|pagado|pagada|abono|abona|abonado|anticipo|ingresa|ingreso|entro|entraron|transferencia|deposito)\b/
