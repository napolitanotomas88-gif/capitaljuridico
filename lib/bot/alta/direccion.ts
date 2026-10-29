// ── Bot "Capital Jurídico": separar la dirección del #ALTA en calle, ciudad, provincia y país (contrato de PandaDoc) ─────
// Puro y sin red: lo importa contrato.ts, que llega a un componente de cliente (plan.ts → SimuladorAlta). La llamada a
// Claude para cuando las reglas no alcanzan está aparte, en direccionClaude.ts (solo servidor).
//
// La plantilla del contrato tiene Client.StreetAddress, Client.City, Client.State y Client.Country. El closer escribe la
// dirección como le sale ("Calle 18 1017, B1906 La Plata, Provincia de Buenos Aires, Argentina", "Sarmiento 1452 4B CABA",
// "1 de mayo 1665 mar del plata"). Reglas, en este orden:
//   1. Se parte por comas (y ";" o " - "). El primer pedazo es siempre la calle. Desde el final se reconocen país,
//      provincia y ciudad con un catálogo (ciudades y provincias de Argentina, Uruguay y las capitales de la región).
//   2. Si la ciudad no quedó en su propio pedazo, se busca al final del texto ("… 4B CABA"), siempre que lo que quede
//      antes tenga un número (así "Av. Córdoba 1234" o "Calle Mendoza" no se toman como ciudad).
//   3. Una localidad que no está en el catálogo se acepta por posición si le sigue una provincia reconocida
//      ("…, Villa Allende, Córdoba"), pero siempre con confianza 'baja': puede ser un barrio ("…, Nueva Córdoba,
//      Córdoba"). Los pedazos que empiezan con una palabra de unidad o de barrio (Depto, Dpto, Piso, PB, Oficina, Local,
//      Torre, Lote, Manzana, UF, Centro, Barrio…) nunca son la ciudad: quedan en la calle.
//   4. El país sale del texto; si no, de la ciudad o provincia; si no, del código del teléfono (54, 598, 51, 57, 56, 52,
//      34, 1-809/829/849…). El teléfono también desempata ciudades con el mismo nombre (Córdoba de Argentina o de España).
// `confianza: 'alta'` = ciudad y provincia salieron del catálogo sin dudas. Con 'baja' el servidor le pregunta a Claude
// (direccionClaude.ts); si al final ciudad o provincia quedan vacías, es un faltante para el closer, y si quedan con la
// conjetura de las reglas (sin Claude), se le pide al closer que las confirme (FALTANTE_CONFIRMAR_CIUDAD).
import { normalizarTelefono } from './telefono'

export interface DireccionSeparada {
  calle: string        // calle, número, piso/depto (y barrio si lo escribió), tal como vino
  ciudad: string
  provincia: string    // provincia, estado, departamento o región
  pais: string
  confianza: 'alta' | 'baja'
}

/** Lo que se le pide al closer cuando ciudad o provincia quedan vacías. */
export const FALTANTE_CIUDAD_PROVINCIA = 'Ciudad y provincia del cliente'
/** Lo que se le pide al closer cuando ciudad y provincia quedaron llenas con una conjetura de las reglas (confianza
 *  'baja') que nadie verificó: sin clave de Claude, o con Claude caído. */
export const FALTANTE_CONFIRMAR_CIUDAD = 'Confirmar ciudad y provincia del cliente (deducidas sin verificar)'

export const CABA = { ciudad: 'CABA', provincia: 'Ciudad Autónoma de Buenos Aires', pais: 'Argentina' } as const

/** Texto → clave de comparación: minúsculas, sin acentos ni puntos, signos → espacio. "C.A.B.A." → "caba". */
export function claveTexto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

// ── Catálogo ─────────────────────────────────────────────────────────────────────────────────────────

interface Lugar { ciudad: string; provincia: string; pais: string }
interface Provincia { nombre: string; pais: string }

// [nombre, alias separados por "|"]
const PAISES: [string, string?][] = [
  ['Argentina', 'arg|rep argentina|republica argentina'],
  ['Uruguay', 'rou|republica oriental del uruguay'],
  ['Perú', 'republica del peru'],
  ['Colombia'], ['Chile'], ['México', 'mejico'], ['España'], ['Paraguay'], ['Bolivia'], ['Ecuador'], ['Venezuela'],
  ['Brasil', 'brazil'], ['Costa Rica'], ['Panamá'], ['Guatemala'], ['El Salvador'], ['Honduras'], ['Nicaragua'], ['Cuba'],
  ['República Dominicana', 'rep dominicana|rd'], ['Puerto Rico'], ['Estados Unidos', 'eeuu|ee uu|usa|united states'], ['Italia'],
]

/** Código de país del teléfono → país. Para el +1 solo se distinguen las áreas del Caribe (EE.UU. y Canadá no). */
const PREFIJOS_TELEFONO: Record<string, string> = {
  '54': 'Argentina', '598': 'Uruguay', '51': 'Perú', '57': 'Colombia', '56': 'Chile', '52': 'México', '34': 'España',
  '595': 'Paraguay', '591': 'Bolivia', '593': 'Ecuador', '58': 'Venezuela', '55': 'Brasil', '506': 'Costa Rica',
  '507': 'Panamá', '502': 'Guatemala', '503': 'El Salvador', '504': 'Honduras', '505': 'Nicaragua', '53': 'Cuba', '39': 'Italia',
  '1809': 'República Dominicana', '1829': 'República Dominicana', '1849': 'República Dominicana',
  '1787': 'Puerto Rico', '1939': 'Puerto Rico',
}

// [provincia, país, alias]
const PROVINCIAS: [string, string, string?][] = [
  // Argentina (CABA va como ciudad: ver CIUDADES)
  ['Buenos Aires', 'Argentina', 'bs as|bsas|pba|bs aires'], ['Catamarca', 'Argentina'], ['Chaco', 'Argentina'],
  ['Chubut', 'Argentina'], ['Córdoba', 'Argentina', 'cba'], ['Corrientes', 'Argentina'], ['Entre Ríos', 'Argentina'],
  ['Formosa', 'Argentina'], ['Jujuy', 'Argentina'], ['La Pampa', 'Argentina'], ['La Rioja', 'Argentina'],
  ['Mendoza', 'Argentina'], ['Misiones', 'Argentina'], ['Neuquén', 'Argentina'], ['Río Negro', 'Argentina'],
  ['Salta', 'Argentina'], ['San Juan', 'Argentina'], ['San Luis', 'Argentina'], ['Santa Cruz', 'Argentina'],
  ['Santa Fe', 'Argentina', 'sta fe'], ['Santiago del Estero', 'Argentina'],
  ['Tierra del Fuego', 'Argentina', 'tdf|tierra del fuego antartida e islas del atlantico sur'], ['Tucumán', 'Argentina'],
  // Uruguay (departamentos)
  ['Artigas', 'Uruguay'], ['Canelones', 'Uruguay'], ['Cerro Largo', 'Uruguay'], ['Colonia', 'Uruguay'], ['Durazno', 'Uruguay'],
  ['Flores', 'Uruguay'], ['Florida', 'Uruguay'], ['Lavalleja', 'Uruguay'], ['Maldonado', 'Uruguay'], ['Montevideo', 'Uruguay'],
  ['Paysandú', 'Uruguay'], ['Río Negro', 'Uruguay'], ['Rivera', 'Uruguay'], ['Rocha', 'Uruguay'], ['Salto', 'Uruguay'],
  ['San José', 'Uruguay'], ['Soriano', 'Uruguay'], ['Tacuarembó', 'Uruguay'], ['Treinta y Tres', 'Uruguay'],
  // Resto de la región (las provincias de las ciudades del catálogo)
  ['Lima', 'Perú'], ['Arequipa', 'Perú'], ['Cusco', 'Perú', 'cuzco'], ['La Libertad', 'Perú'], ['Lambayeque', 'Perú'],
  ['Piura', 'Perú'], ['Callao', 'Perú'],
  ['Bogotá D.C.', 'Colombia', 'bogota d c|bogota distrito capital|distrito capital de bogota'], ['Cundinamarca', 'Colombia'],
  ['Antioquia', 'Colombia'], ['Valle del Cauca', 'Colombia', 'valle'], ['Atlántico', 'Colombia'], ['Bolívar', 'Colombia'],
  ['Santander', 'Colombia'], ['Risaralda', 'Colombia'],
  ['Región Metropolitana', 'Chile', 'rm|region metropolitana de santiago'], ['Valparaíso', 'Chile'], ['Biobío', 'Chile', 'bio bio'],
  ['Antofagasta', 'Chile'],
  ['Ciudad de México', 'México', 'cdmx|distrito federal'], ['Estado de México', 'México', 'edomex'], ['Jalisco', 'México'],
  ['Nuevo León', 'México'], ['Puebla', 'México'],
  ['Comunidad de Madrid', 'España', 'madrid'], ['Cataluña', 'España', 'catalunya'],
  ['Comunidad Valenciana', 'España', 'valencia'], ['Andalucía', 'España'],
  ['Distrito Nacional', 'República Dominicana'], ['Santiago', 'República Dominicana'], ['La Altagracia', 'República Dominicana'],
  ['Distrito Capital', 'Paraguay'], ['Alto Paraná', 'Paraguay'], ['Central', 'Paraguay'],
  ['Santa Cruz', 'Bolivia'], ['La Paz', 'Bolivia'], ['Cochabamba', 'Bolivia'],
  ['Pichincha', 'Ecuador'], ['Guayas', 'Ecuador'],
  ['San José', 'Costa Rica'], ['Panamá', 'Panamá'], ['Distrito Capital', 'Venezuela'], ['Carabobo', 'Venezuela'],
  ['Florida', 'Estados Unidos', 'fl'],
]

// [ciudad, provincia, país, alias]. El orden importa solo para desempatar dentro del mismo país.
const CIUDADES: [string, string, string, string?][] = [
  [CABA.ciudad, CABA.provincia, CABA.pais,
    'capital federal|cap fed|ciudad autonoma de buenos aires|ciudad de buenos aires|ciudad autonoma de bs as|ciudad de bs as'],
  // Provincia de Buenos Aires
  ...([
    'La Plata', 'Mar del Plata|mdp', 'Bahía Blanca', 'Tandil', 'Quilmes', 'Bernal', 'Lomas de Zamora', 'Banfield', 'Temperley',
    'Adrogué', 'Lanús', 'Avellaneda', 'Morón', 'Haedo', 'Castelar', 'Ituzaingó', 'Hurlingham', 'Ramos Mejía', 'San Justo',
    'Caseros', 'San Isidro', 'Martínez', 'Olivos', 'Vicente López', 'Tigre', 'Pilar', 'Escobar', 'San Miguel', 'José C. Paz',
    'Moreno', 'Merlo', 'Monte Grande', 'Ezeiza', 'Florencio Varela', 'Berazategui', 'Berisso', 'Ensenada', 'City Bell',
    'Olavarría', 'Necochea', 'Pergamino', 'Junín', 'Luján', 'Zárate', 'Campana', 'San Nicolás de los Arroyos|san nicolas',
    'San Pedro', 'Chivilcoy', 'Azul', 'Tres Arroyos', 'Pinamar', 'Villa Gesell', 'Chascomús', 'Trenque Lauquen', 'Balcarce',
    'Miramar', 'Mercedes',
  ].map(c => [c.split('|')[0], 'Buenos Aires', 'Argentina', c.split('|')[1]] as [string, string, string, string?])),
  ['Rosario', 'Santa Fe', 'Argentina'], ['Santa Fe', 'Santa Fe', 'Argentina', 'santa fe de la vera cruz'],
  ['Rafaela', 'Santa Fe', 'Argentina'], ['Venado Tuerto', 'Santa Fe', 'Argentina'], ['Reconquista', 'Santa Fe', 'Argentina'],
  ['Córdoba', 'Córdoba', 'Argentina'], ['Villa Carlos Paz', 'Córdoba', 'Argentina', 'carlos paz'],
  ['Río Cuarto', 'Córdoba', 'Argentina'], ['Villa María', 'Córdoba', 'Argentina'], ['Alta Gracia', 'Córdoba', 'Argentina'],
  ['San Francisco', 'Córdoba', 'Argentina'],
  ['Mendoza', 'Mendoza', 'Argentina'], ['San Rafael', 'Mendoza', 'Argentina'], ['Godoy Cruz', 'Mendoza', 'Argentina'],
  ['Luján de Cuyo', 'Mendoza', 'Argentina'], ['Guaymallén', 'Mendoza', 'Argentina'],
  ['San Miguel de Tucumán', 'Tucumán', 'Argentina', 'tucuman|s m de tucuman|san miguel de tuc'],
  ['Yerba Buena', 'Tucumán', 'Argentina'], ['Salta', 'Salta', 'Argentina'],
  ['San Salvador de Jujuy', 'Jujuy', 'Argentina', 'jujuy'], ['San Pedro', 'Jujuy', 'Argentina', 'san pedro de jujuy'],
  ['Neuquén', 'Neuquén', 'Argentina'], ['San Carlos de Bariloche', 'Río Negro', 'Argentina', 'bariloche'],
  ['Viedma', 'Río Negro', 'Argentina'], ['General Roca', 'Río Negro', 'Argentina'], ['Cipolletti', 'Río Negro', 'Argentina'],
  ['Santa Rosa', 'La Pampa', 'Argentina'], ['Paraná', 'Entre Ríos', 'Argentina'], ['Concordia', 'Entre Ríos', 'Argentina'],
  ['Gualeguaychú', 'Entre Ríos', 'Argentina'], ['Corrientes', 'Corrientes', 'Argentina'], ['Resistencia', 'Chaco', 'Argentina'],
  ['Posadas', 'Misiones', 'Argentina'], ['Oberá', 'Misiones', 'Argentina'], ['Formosa', 'Formosa', 'Argentina'],
  ['Santiago del Estero', 'Santiago del Estero', 'Argentina'], ['La Banda', 'Santiago del Estero', 'Argentina'],
  ['San Fernando del Valle de Catamarca', 'Catamarca', 'Argentina', 'catamarca'], ['La Rioja', 'La Rioja', 'Argentina'],
  ['San Juan', 'San Juan', 'Argentina'], ['San Luis', 'San Luis', 'Argentina'], ['Villa Mercedes', 'San Luis', 'Argentina'],
  ['Río Gallegos', 'Santa Cruz', 'Argentina'], ['Ushuaia', 'Tierra del Fuego', 'Argentina'],
  ['Río Grande', 'Tierra del Fuego', 'Argentina'], ['Comodoro Rivadavia', 'Chubut', 'Argentina'],
  ['Trelew', 'Chubut', 'Argentina'], ['Puerto Madryn', 'Chubut', 'Argentina'], ['Rawson', 'Chubut', 'Argentina'],
  // Uruguay
  ['Montevideo', 'Montevideo', 'Uruguay'], ['Punta del Este', 'Maldonado', 'Uruguay'], ['Maldonado', 'Maldonado', 'Uruguay'],
  ['Piriápolis', 'Maldonado', 'Uruguay'], ['Colonia del Sacramento', 'Colonia', 'Uruguay', 'colonia'],
  ['Salto', 'Salto', 'Uruguay'], ['Paysandú', 'Paysandú', 'Uruguay'], ['Canelones', 'Canelones', 'Uruguay'],
  ['Ciudad de la Costa', 'Canelones', 'Uruguay'], ['Las Piedras', 'Canelones', 'Uruguay'], ['Rivera', 'Rivera', 'Uruguay'],
  ['Mercedes', 'Soriano', 'Uruguay'],
  // Perú
  ['Lima', 'Lima', 'Perú'], ['Callao', 'Callao', 'Perú'], ['Arequipa', 'Arequipa', 'Perú'], ['Trujillo', 'La Libertad', 'Perú'],
  ['Cusco', 'Cusco', 'Perú', 'cuzco'], ['Chiclayo', 'Lambayeque', 'Perú'], ['Piura', 'Piura', 'Perú'],
  // Colombia
  ['Bogotá', 'Bogotá D.C.', 'Colombia', 'bogota dc|bogota d c|santa fe de bogota'], ['Medellín', 'Antioquia', 'Colombia'],
  ['Cali', 'Valle del Cauca', 'Colombia'], ['Barranquilla', 'Atlántico', 'Colombia'],
  ['Cartagena', 'Bolívar', 'Colombia', 'cartagena de indias'], ['Bucaramanga', 'Santander', 'Colombia'],
  ['Pereira', 'Risaralda', 'Colombia'],
  // Chile
  ['Santiago', 'Región Metropolitana', 'Chile', 'santiago de chile'], ['Valparaíso', 'Valparaíso', 'Chile'],
  ['Viña del Mar', 'Valparaíso', 'Chile'], ['Concepción', 'Biobío', 'Chile'], ['Antofagasta', 'Antofagasta', 'Chile'],
  // México
  ['Ciudad de México', 'Ciudad de México', 'México', 'cdmx|mexico df|ciudad de mexico df'], ['Guadalajara', 'Jalisco', 'México'],
  ['Monterrey', 'Nuevo León', 'México'], ['Puebla', 'Puebla', 'México'],
  // España
  ['Madrid', 'Comunidad de Madrid', 'España'], ['Barcelona', 'Cataluña', 'España'], ['Valencia', 'Comunidad Valenciana', 'España'],
  ['Sevilla', 'Andalucía', 'España'], ['Málaga', 'Andalucía', 'España'], ['Córdoba', 'Andalucía', 'España'],
  // República Dominicana
  ['Santo Domingo', 'Distrito Nacional', 'República Dominicana', 'santo domingo de guzman|santo domingo dn'],
  ['Santiago de los Caballeros', 'Santiago', 'República Dominicana', 'santiago'],
  ['Punta Cana', 'La Altagracia', 'República Dominicana'],
  // Resto
  ['Asunción', 'Distrito Capital', 'Paraguay'], ['Ciudad del Este', 'Alto Paraná', 'Paraguay'],
  ['Santa Cruz de la Sierra', 'Santa Cruz', 'Bolivia'], ['La Paz', 'La Paz', 'Bolivia'], ['Cochabamba', 'Cochabamba', 'Bolivia'],
  ['Quito', 'Pichincha', 'Ecuador'], ['Guayaquil', 'Guayas', 'Ecuador'], ['San José', 'San José', 'Costa Rica'],
  ['Ciudad de Panamá', 'Panamá', 'Panamá', 'panama'], ['Caracas', 'Distrito Capital', 'Venezuela'],
  ['Valencia', 'Carabobo', 'Venezuela'], ['Miami', 'Florida', 'Estados Unidos'], ['Orlando', 'Florida', 'Estados Unidos'],
]

// Barrios de CABA: "Av. Santa Fe 1234, Palermo" es CABA (el barrio queda en la calle).
const BARRIOS_CABA = new Set([
  'Agronomía', 'Almagro', 'Balvanera', 'Barracas', 'Belgrano', 'Boedo', 'Caballito', 'Chacarita', 'Coghlan', 'Colegiales',
  'Constitución', 'Flores', 'Floresta', 'La Boca', 'La Paternal', 'Liniers', 'Mataderos', 'Monte Castro', 'Monserrat',
  'Nueva Pompeya', 'Núñez', 'Palermo', 'Parque Avellaneda', 'Parque Chacabuco', 'Parque Chas', 'Parque Patricios',
  'Puerto Madero', 'Recoleta', 'Retiro', 'Saavedra', 'San Cristóbal', 'San Nicolás', 'San Telmo', 'Vélez Sarsfield',
  'Versalles', 'Villa Crespo', 'Villa del Parque', 'Villa Devoto', 'Villa General Mitre', 'Villa Lugano', 'Villa Luro',
  'Villa Ortúzar', 'Villa Pueyrredón', 'Villa Real', 'Villa Riachuelo', 'Villa Santa Rita', 'Villa Soldati', 'Villa Urquiza',
  'Microcentro', 'Tribunales', 'Barrio Norte',
].map(claveTexto))

/** Índice clave → filas: el nombre y cada alias (columna `iAlias`, separados por "|") apuntan a la fila. */
function indexar<F extends [string, ...(string | undefined)[]], T>(filas: F[], iAlias: number, valor: (f: F) => T): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const f of filas) {
    const claves = new Set([f[0], ...String(f[iAlias] ?? '').split('|')].map(claveTexto).filter(Boolean))
    for (const k of claves) m.set(k, [...(m.get(k) ?? []), valor(f)])
  }
  return m
}

const MAPA_PAISES = indexar(PAISES, 1, f => f[0])
const MAPA_PROVINCIAS = indexar(PROVINCIAS, 2, (f): Provincia => ({ nombre: f[0], pais: f[1] }))
const MAPA_CIUDADES = indexar(CIUDADES, 3, (f): Lugar => ({ ciudad: f[0], provincia: f[1], pais: f[2] }))

const PREFIJOS_PROVINCIA = ['provincia de', 'provincia del', 'provincia', 'pcia de', 'pcia', 'prov de', 'prov',
  'departamento de', 'dpto de', 'depto de', 'estado de', 'region de', 'region del', 'region']

/** País por el código del teléfono (cualquier formato: "+1 849 …", "5491130001111"). '' si no se sabe. */
export function paisPorTelefono(telefono?: string | null): string {
  if (!telefono) return ''
  const d = normalizarTelefono(telefono)
  for (const largo of [4, 3, 2]) {
    const p = PREFIJOS_TELEFONO[d.slice(0, largo)]
    if (p) return p
  }
  return ''
}

const buscarPais = (k: string): string => MAPA_PAISES.get(k)?.[0] ?? ''
const buscarCiudades = (k: string): Lugar[] => MAPA_CIUDADES.get(k) ?? []

/** Provincias que coinciden con la clave. `explicita`: el texto dice "Provincia de …", "Pcia. …", "Departamento de …". */
function buscarProvincias(k: string): { cands: Provincia[]; explicita: boolean } {
  const prefijo = PREFIJOS_PROVINCIA.find(p => k.startsWith(p + ' '))
  const directa = MAPA_PROVINCIAS.get(k)
  if (directa) return { cands: directa, explicita: !!prefijo }
  if (prefijo) {
    const sin = MAPA_PROVINCIAS.get(k.slice(prefijo.length + 1))
    if (sin) return { cands: sin, explicita: true }
  }
  return { cands: [], explicita: false }
}

const esConocido = (k: string) => !!buscarPais(k) || buscarCiudades(k).length > 0 || buscarProvincias(k).cands.length > 0 || BARRIOS_CABA.has(k)

// ── Códigos postales ─────────────────────────────────────────────────────────────────────────────────

const RE_CP_LETRA = /^[a-z]\d{4}(?:[a-z]{3})?$/i   // B1906, C1425ABC (Argentina)
const RE_CP_NUM = /^\d{4,7}$/                        // 1900, 11000, 28013, 110111

/** Saca el código postal de un pedazo que NO es la calle. `explicito` saca solo los que no se confunden con una altura
 *  o un depto: con letra ("B1906 La Plata"), entre paréntesis ("La Plata (1900)") o después de "CP". `todo` saca además
 *  los números sueltos de 4 a 7 cifras en los bordes ("1900 La Plata", pero también "Dto 1203" → "Dto"). */
function quitarCodigoPostal(s: string): { explicito: string; todo: string } {
  const t = s
    .replace(/\(\s*[a-z]?\d{4,7}[a-z]{0,3}\s*\)/gi, ' ')
    .replace(/(^|\s)(?:c\.?\s?p\.?|c[oó]digo postal)\s*:?\s*[a-z]?\d{4,7}[a-z]{0,3}(?=\s|$)/gi, ' ')
  const bordes = (palabras: string[], esCP: (p: string) => boolean) => {
    const r = [...palabras]
    while (r.length && esCP(r[0])) r.shift()
    while (r.length && esCP(r[r.length - 1])) r.pop()
    return r
  }
  const explicito = bordes(t.trim().split(/\s+/).filter(Boolean), p => RE_CP_LETRA.test(p))
  return { explicito: explicito.join(' '), todo: bordes(explicito, p => RE_CP_NUM.test(p)).join(' ') }
}

interface Pedazo { texto: string; k: string; vacio: boolean; digitos: boolean }

/** Analiza un pedazo (no la calle). Un número suelto se toma como código postal solo si sin él queda un lugar conocido
 *  ("1900 La Plata" → "La Plata"; "Dto 1203" sigue siendo parte de la calle). */
function analizar(seg: string): Pedazo {
  const { explicito, todo } = quitarCodigoPostal(seg)
  if (!todo) return { texto: '', k: '', vacio: true, digitos: false }   // "CP 7600", "1900": solo el código postal
  const texto = esConocido(claveTexto(todo)) ? todo : explicito || todo
  return { texto, k: claveTexto(texto), vacio: false, digitos: /\d/.test(texto) }
}

/** Pedazo que empieza con una palabra de unidad o de barrio: es parte de la calle, nunca la ciudad ("Depto B", "PB",
 *  "Planta Baja", "Oficina A", "Torre Norte", "Lote 5", "Mz 3", "UF 12", "Centro", "Barrio Jardín", "B° Güemes").
 *  "Departamento de …" / "Dpto. de …" no cuenta: en Uruguay es la provincia y en Argentina, una división. Recibe la clave
 *  (claveTexto) y el texto original (para "B°"). */
const RE_UNIDAD_O_BARRIO = new RegExp('^(?:(?:dto|dpto|depto|departamento)(?! del? )|piso|pb|planta baja|of|oficina|local|torre|'
  + 'casa|lote|manzana|mz|mza|uf|unidad|block|centro|apto|apartamento|edificio|edif|barrio|bo)(?: |$)')
const esUnidadOBarrio = (k: string, texto: string) => RE_UNIDAD_O_BARRIO.test(k) || /^b\s*[°º]/i.test(texto.trim())

const esLugar = (seg: string | undefined) => {
  if (!seg) return false
  const p = analizar(seg)
  return !p.vacio && !p.digitos && !buscarPais(p.k) && !esUnidadOBarrio(p.k, p.texto)
}

const limpiarBordes = (s: string) => s.replace(/^[\s,;\-–—]+|[\s,;\-–—]+$/g, '')

/** Localidad escrita toda en minúsculas → con mayúsculas ("pehuajó" → "Pehuajó"). Si ya trae mayúsculas, queda igual. */
function capitalizar(s: string): string {
  if (s !== s.toLowerCase()) return s
  const menores = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y'])
  return s.split(' ').map((w, i) => (i > 0 && menores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
}

// ── Separación ───────────────────────────────────────────────────────────────────────────────────────

interface Hallazgo {
  pais: string
  provs: Provincia[]
  provExplicita: boolean
  ciudades: Lugar[]                 // candidatas del catálogo
  ciudadTexto: string               // localidad aceptada por posición (no está en el catálogo)
  barrio: boolean                   // ciudad = CABA por un barrio
}

/** Busca país, provincia y ciudad al final de un texto sin comas ("Sarmiento 1452 4B CABA"). Devuelve dónde termina la
 *  calle (en palabras). Lo que queda antes tiene que tener un número: así "Calle Mendoza" no pierde su nombre. */
function buscarAlFinal(seg: string, h: Hallazgo): string {
  const palabras = seg.split(/\s+/).filter(Boolean)
  let fin = palabras.length
  const ciudadAntes = (hasta: number) => {
    for (let n = Math.min(6, hasta); n >= 1; n--) {
      const k = claveTexto(palabras.slice(hasta - n, hasta).join(' '))
      if (k && buscarCiudades(k).length && /\d/.test(palabras.slice(0, hasta - n).join(' '))) return true
    }
    return false
  }
  for (let vuelta = 0; vuelta < 8 && fin > 0 && !h.ciudades.length; vuelta++) {
    const ult = palabras[fin - 1].replace(/[,;]+$/, '')
    // Código postal: con letra (B1906), entre paréntesis o después de "CP". Un número suelto puede ser la altura.
    if (RE_CP_LETRA.test(ult) || /^\(\d{4,7}\)$/.test(ult)) { fin--; continue }
    if (fin >= 2 && RE_CP_NUM.test(ult) && /^c\.?p\.?:?$/i.test(palabras[fin - 2])) { fin -= 2; continue }
    let corte = 0
    for (let n = Math.min(6, fin); n >= 1 && !corte; n--) {
      const k = claveTexto(palabras.slice(fin - n, fin).join(' '))
      if (!k || !/\d/.test(palabras.slice(0, fin - n).join(' '))) continue
      if (!h.pais && buscarPais(k)) { h.pais = buscarPais(k); corte = n; break }
      const pr = buscarProvincias(k)
      const cs = buscarCiudades(k)
      if (cs.length && !pr.explicita) {
        // "… Rosario Santa Fe": Santa Fe es ciudad y provincia; como antes hay una ciudad, acá es la provincia
        if (pr.cands.length && !h.provs.length && ciudadAntes(fin - n)) { h.provs = pr.cands; corte = n; break }
        h.ciudades = cs
        corte = n
        break
      }
      if (pr.cands.length && !h.provs.length) { h.provs = pr.cands; h.provExplicita = pr.explicita; corte = n; break }
    }
    if (!corte) break
    fin -= corte
  }
  return limpiarBordes(palabras.slice(0, fin).join(' '))
}

const mismaProvincia = (c: Lugar, p: Provincia) =>
  c.pais === p.pais && (c.provincia === p.nombre || (c.ciudad === CABA.ciudad && p.nombre === 'Buenos Aires'))

/** Separa la dirección con reglas puras. `telefono` (opcional, cualquier formato) da el país si el texto no lo dice y
 *  desempata ciudades con el mismo nombre. Nunca inventa: lo que no se sabe queda vacío y la confianza, 'baja'. */
export function separarDireccion(texto: string | null | undefined, telefono?: string | null): DireccionSeparada {
  const paisTel = paisPorTelefono(telefono)
  const limpio = (texto ?? '').replace(/\s+/g, ' ').trim()
  if (!limpio) return { calle: '', ciudad: '', provincia: '', pais: paisTel, confianza: 'baja' }

  const segs = limpio.split(/\s*[,;]\s*|\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean)
  const h: Hallazgo = { pais: '', provs: [], provExplicita: false, ciudades: [], ciudadTexto: '', barrio: false }

  // 1. Desde el final, pedazo por pedazo (el primero es la calle)
  let fin = segs.length
  for (let i = segs.length - 1; i >= 1; i--) {
    const p = analizar(segs[i])
    if (p.vacio) { fin = i; continue }                                   // solo el código postal
    if (!h.pais && buscarPais(p.k)) { h.pais = buscarPais(p.k); fin = i; continue }
    if (/^partido( de)? /.test(p.k)) { fin = i; continue }              // "Partido de La Plata": no aporta
    // Barrio de CABA ("…, Palermo", "…, Palermo, Buenos Aires"). Va antes que las provincias: "Flores" también es un
    // departamento de Uruguay. El barrio queda en la calle.
    if (BARRIOS_CABA.has(p.k) && (!paisTel || paisTel === 'Argentina') && !h.pais
      && (!h.provs.length || h.provs.some(x => x.nombre === 'Buenos Aires'))) {
      h.barrio = true
      break
    }
    const pr = buscarProvincias(p.k)
    const cs = buscarCiudades(p.k)
    if (!h.provs.length && pr.cands.length && (pr.explicita || !cs.length || esLugar(i >= 2 ? segs[i - 1] : undefined))) {
      h.provs = pr.cands
      h.provExplicita = pr.explicita
      fin = i
      continue
    }
    if (cs.length) { h.ciudades = cs; fin = i; break }
    // "Piso 3", "Dto 4B", "Depto B", "PB", "Centro", "Barrio Jardín": es la calle
    if (p.digitos || esUnidadOBarrio(p.k, p.texto)) break
    h.ciudadTexto = capitalizar(p.texto)                                // localidad fuera del catálogo (confianza baja)
    fin = i
    break
  }

  // 2. Ciudad pegada a la calle ("Sarmiento 1452 4B CABA")
  let calle = limpiarBordes(segs.slice(0, fin).join(', '))
  if (!h.ciudades.length && !h.ciudadTexto && !h.barrio) {
    const ultimo = segs[fin - 1] ?? ''
    const resto = buscarAlFinal(ultimo, h)
    calle = limpiarBordes([...segs.slice(0, fin - 1), resto].filter(Boolean).join(', '))
  }

  // 3. La provincia también es ciudad ("…, Barrio Centro, Santa Fe"): sin otra ciudad, es la capital
  if (!h.ciudades.length && !h.ciudadTexto && !h.barrio && h.provs.length && !h.provExplicita) {
    const capital = buscarCiudades(claveTexto(h.provs[0].nombre)).filter(c => h.provs.some(p => mismaProvincia(c, p)))
    if (capital.length) { h.ciudades = capital; h.provs = [] }
  }

  // 4. Resolver candidatas: primero la provincia escrita, después el país escrito y por último el del teléfono
  let ciudad = '', provincia = '', pais = h.pais, dudas = false
  const filtrar = <T>(lista: T[], f: (x: T) => boolean, desempate = false): T[] => {
    const r = lista.filter(f)
    if (r.length) return r
    if (!desempate) dudas = true
    return lista
  }
  let provs = h.provs
  if (h.ciudades.length) {
    let cs = h.ciudades
    if (provs.length) cs = filtrar(cs, c => provs.some(p => mismaProvincia(c, p)))
    if (h.pais) cs = filtrar(cs, c => c.pais === h.pais)
    if (cs.length > 1 && paisTel) cs = filtrar(cs, c => c.pais === paisTel, true)
    if (new Set(cs.map(c => `${c.ciudad}|${c.provincia}|${c.pais}`)).size > 1) dudas = true
    const elegida = cs[0]
    ciudad = elegida.ciudad
    const choca = provs.length > 0 && !provs.some(p => mismaProvincia(elegida, p))
    provincia = choca ? provs[0].nombre : elegida.provincia     // si choca, se respeta lo escrito (y queda en duda)
    pais ||= choca ? provs[0].pais : elegida.pais
  } else if (h.barrio) {
    ciudad = CABA.ciudad
    provincia = CABA.provincia
    pais ||= CABA.pais
    if (!h.provs.length) dudas = true                            // "Av. Cabildo 2000, Belgrano": probablemente CABA
  } else {
    // Localidad aceptada solo por la posición (no está en el catálogo): puede ser un barrio ("Nueva Córdoba") o un
    // pedazo de la calle que no reconocimos. Nunca es 'alta': la revisa Claude o, sin Claude, la confirma el closer.
    if (h.ciudadTexto) { ciudad = h.ciudadTexto; dudas = true }
    if (provs.length) {
      if (h.pais) provs = filtrar(provs, p => p.pais === h.pais)
      if (provs.length > 1 && paisTel) provs = filtrar(provs, p => p.pais === paisTel, true)
      if (provs.length > 1) dudas = true
      provincia = provs[0].nombre
      pais ||= provs[0].pais
    }
  }
  pais ||= paisTel
  const confianza = ciudad && provincia && !dudas ? 'alta' : 'baja'
  return { calle, ciudad, provincia, pais, confianza }
}

/** ¿Las reglas alcanzan para el contrato sin preguntarle a Claude? */
export const reglasAlcanzan = (d: DireccionSeparada) => d.confianza === 'alta' && !!d.ciudad && !!d.provincia

/** Faltante para el closer: FALTANTE_CIUDAD_PROVINCIA si ciudad o provincia quedaron vacías; con `confirmar` (están
 *  llenas, pero con una conjetura de las reglas que nadie verificó), FALTANTE_CONFIRMAR_CIUDAD. */
export const faltantesDireccion = (d: Pick<DireccionSeparada, 'ciudad' | 'provincia'>, confirmar = false): string[] =>
  !d.ciudad.trim() || !d.provincia.trim() ? [FALTANTE_CIUDAD_PROVINCIA] : confirmar ? [FALTANTE_CONFIRMAR_CIUDAD] : []

/** Nombre del país como en el catálogo ("Peru" → "Perú"); si no está, queda como vino. */
const paisCanonico = (p: string) => buscarPais(claveTexto(p)) || p

/** Combina lo que separaron las reglas (con confianza baja) con lo que devolvió Claude. Ciudad y provincia salen de Claude
 *  (vacías si no las sabe: nunca se rellenan con una conjetura de las reglas); la calle y el país, de Claude y si no, de
 *  las reglas (el país puede venir del teléfono). La CABA se escribe siempre igual. Puro. */
export function combinarConClaude(reglas: DireccionSeparada, claude: Omit<DireccionSeparada, 'confianza'>): DireccionSeparada {
  let ciudad = claude.ciudad.trim()
  let provincia = claude.provincia.trim()
  const kc = claveTexto(ciudad)
  if (kc && buscarCiudades(kc).some(c => c.ciudad === CABA.ciudad)) { ciudad = CABA.ciudad; provincia = CABA.provincia }
  return {
    calle: claude.calle.trim() || reglas.calle,
    ciudad,
    provincia,
    pais: paisCanonico(claude.pais.trim()) || reglas.pais,
    confianza: 'baja',
  }
}
