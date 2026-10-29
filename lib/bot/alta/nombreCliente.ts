// ── Bot "Capital Jurídico": el nombre del cliente para Drive y la bienvenida (puro, con tests) ──────────────────────
// Un solo normalizador para la carpeta "<Nombre> - C.J", los "Guiones / Crudos / Editados - X" (driveCliente.ts) y el doc
// "Bienvenida - <Nombre>" (bienvenida.ts). Antes cada archivo tenía el suyo y daban nombres distintos ("Dra. Lucía
// Benítez" → carpeta "Lucía Benítez - C.J" pero doc "Bienvenida - Dra. Lucía Benítez"). Como la idempotencia del Puente
// Drive busca por nombre, un cambio en uno solo de los dos duplicaba el doc en el reintento.
// Tests: scripts/test-bot-drive.mjs (nombres) y scripts/test-bot-bienvenida.mjs (saludo y doc).

/** Títulos que los closers escriben adelante del nombre, abreviados o enteros, con o sin punto: Dr./Dra., Doctor/a,
 *  Lic., Licenciado/a, Ab./Abg./Abog., Abogado/a, Esc./Escr., Escribano/a, Cr./Cra., Cdor./Cdora., Ctdor./Ctdora.,
 *  Contador/a. Los clientes son abogados y escribanos: "Escribana Laura Pérez" es un caso probable. */
export const TITULO = /^(dra?|doctora?|lic|licenciad[oa]|ab|abg|abog|abogad[oa]|esc|escr|escriban[oa]|cra?|cdora?|ctdora?|contadora?)\.?$/i

/** Títulos abreviados pegados al nombre ("Dra.Lucía") → se separan ("Dra. Lucía") para poder sacarlos. */
const RE_TITULO_PEGADO = /(^|\s)(dra?|lic|ab|abg|abog|esc|escr|cra?|cdora?|ctdora?)\.(?=\p{L})/giu

const TITULO_FEMENINO = /^(dra|doctora|licenciada|abogada|escribana|cra|cdora|ctdora|contadora)$/
const TITULO_MASCULINO = /^(dr|doctor|licenciado|abogado|escribano|cr|cdor|ctdor|contador)$/

export const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do', 'dos', 'van', 'von'])
/** Abreviaturas de María que escriben los closers: "Ma." / "Ma" / "Mª". */
export const RE_MARIA = /^m[aª]\.?$/i
const GUION_SUELTO = /^[-–—]$/

/** "Dra.Lucía Benítez" → "Dra. Lucía Benítez"; "Ma.Laura Ruiz" → "Ma. Laura Ruiz". El resto queda igual. */
export const separarAbreviaturasPegadas = (nombre: string): string =>
  nombre.replace(RE_TITULO_PEGADO, '$1$2. ').replace(/(^|\s)(m[aª])\.(?=\p{L})/giu, '$1$2. ')

/** Género que indica un título ("Dra." → femenino, "Escribano" → masculino). null si no es un título con género
 *  ("Lic.", "Ab.", "Esc." o cualquier otra palabra). */
export function generoDelTitulo(palabra: string): 'femenino' | 'masculino' | null {
  const t = palabra.toLowerCase().replace(/\.$/, '')
  return TITULO_FEMENINO.test(t) ? 'femenino' : TITULO_MASCULINO.test(t) ? 'masculino' : null
}

/** "pérez-gómez" → "Pérez-Gómez"; "o'connor" → "O'Connor". */
const mayusculaInicial = (p: string) => p.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())

/** Nombre del cliente como va en Drive: sin título adelante ("Dra.", "Escribana"), sin signos sueltos, espacios simples,
 *  "Ma." → "María" y, si viene todo en mayúsculas o todo en minúsculas, con mayúscula inicial ("de", "la"… en
 *  minúscula). Si ya viene con mayúsculas y minúsculas se respeta como está. Un guion suelto entre dos palabras se
 *  mantiene ("PRUEBA BOT - borrar"). "" si no hay nombre. */
export function nombreCliente(nombre: string | null | undefined): string {
  let t = separarAbreviaturasPegadas((nombre ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' '))
    .trim().split(/\s+/)
    .filter((p) => /[\p{L}\d]/u.test(p) || GUION_SUELTO.test(p))
    .map((p) => (GUION_SUELTO.test(p) ? '-' : p))
  while (t.length && (TITULO.test(t[0]) || t[0] === '-')) t.shift()
  while (t.length && t[t.length - 1] === '-') t.pop()
  t = t.filter((p, i) => !(p === '-' && t[i - 1] === '-'))
  const unido = t.join(' ')
  if (unido === unido.toUpperCase() || unido === unido.toLowerCase()) {
    t = t.map((p, i) => (i > 0 && PARTICULAS.has(p.toLowerCase()) ? p.toLowerCase() : mayusculaInicial(p)))
  }
  if (t.length && RE_MARIA.test(t[0])) t[0] = 'María'
  return t.join(' ')
}

/** Sufijo de "Guiones - X", "Crudos - X" y "Editados - X": primer nombre + inicial de la última palabra.
 *  "Claudia Roldan" → "ClaudiaR"; "Claudia Gabriela Roldan" → "ClaudiaR"; "Ma. Laura Ruiz" → "MaríaR";
 *  "Juan J. Pérez" → "JuanP" (las iniciales sueltas no cuentan); "Gisela" → "Gisela". "" si no hay nombre. */
export function sufijoCliente(nombre: string | null | undefined): string {
  const palabras = nombreCliente(nombre).split(' ')
    .map((p) => p.replace(/[.,;:]+$/, ''))
    .filter((p) => /\p{L}.*\p{L}/u.test(p))
  if (!palabras.length) return ''
  const primero = palabras[0]
  if (palabras.length === 1) return primero
  return primero + palabras[palabras.length - 1].charAt(0).toLocaleUpperCase('es')
}

/** Nombre del doc de bienvenida de la carpeta: "Bienvenida - Lucía Benítez" (con el nombre ya normalizado por
 *  nombreCliente). Lo usan bienvenida.ts y driveCliente.ts, así el reintento busca siempre el mismo nombre. */
export const nombreDocBienvenida = (cliente: string): string => `Bienvenida - ${cliente || 'Cliente'}`

/** ¿El nombre del #ALTA parece traer más de una persona o una aclaración? Devuelve el motivo, o null si está bien.
 *  "Juan Pérez y Ana Gómez" → la inicial saldría "JuanG"; "Lucía Benítez (socia: Ana)" → "LucíaA". Con eso el bot no
 *  crea la carpeta: pregunta en Verificaciones C.J (los socios van en "Socios:"). Un apellido con "y" ("Ortega y
 *  Gasset") también se pregunta: es raro y confirmarlo cuesta un OK. */
export function motivoNombreDudoso(nombre: string | null | undefined): string | null {
  const t = (nombre ?? '').normalize('NFC')
  if (/[()[\]{}]/.test(t)) return 'trae paréntesis'
  const signo = t.match(/[/&+]/)?.[0]
  if (signo) return `trae "${signo}"`
  const conjuncion = t.match(/(?:^|\s)([ye])(?=\s|$)/i)?.[1]
  if (conjuncion) return `trae "${conjuncion}" entre dos nombres`
  return null
}
