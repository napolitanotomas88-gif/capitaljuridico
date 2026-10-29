// ── Zona desde el video: lo PURO (tipos, comparación con lo dicho, textos y lectura de lo guardado) ─────────────
// Lo comparten mapa.ts (que mira el video: Fathom, ffmpeg y Claude, solo servidor) y lo que muestra la ficha: ficha.ts
// (faltantes y markdown), vista.ts (la pantalla del Despacho) y mensaje.ts (el aviso de Discord). Está aparte para que la
// ficha y la pantalla no carguen el SDK de Claude ni node:child_process.
//   · combinarZonaConMapa: le suma a la zona dicha el bloque `mapa` (fuente 'video') con lo que coincide, lo parecido, lo
//     que no se puede verificar y las discrepancias, SIN pisar lo dicho (ver el detalle más abajo);
//   · lineaMapa / diferenciasMapa / mapaUtil: los textos y las reglas que usan la ficha, la pantalla y el aviso;
//   · ZonaVideoFicha: lo que queda guardado en cj_kickoffs.zona_video (columna aparte de la ficha, la escribe
//     guardarZonaVideo de registro.ts): el estado de la lectura (pedido a Fathom, leyendo, ok, sin mapa, sin video, sin la
//     API key, error), la versión del prompt (VERSION_MAPA: con la misma, al retomar no se repite), el download_id de Fathom
//     para retomar la descarga, el bloque `mapa` y los tokens. leerZonaVideo lo lee con cuidado (es jsonb de la base).
import type { Quien } from './grabadores'
import type { Uso } from './tipos'

// ── Lo que lee Claude en los cuadros (validarMapa de mapa.ts lo valida) ──

export const TIPOS_MAPA = ['google_maps', 'meta_ads', 'otro', 'ninguno'] as const
export type TipoMapa = (typeof TIPOS_MAPA)[number]
export const MARCAS_MAPA = ['pin_con_radio', 'poligono', 'area_resaltada', 'lista', 'otra', 'ninguna'] as const
export type MarcaMapa = (typeof MARCAS_MAPA)[number]
export const POSICIONES_LUGAR = ['dentro', 'borde', 'fuera', 'lista_incluida', 'lista_excluida', 'sin_marca'] as const
export type PosicionLugar = (typeof POSICIONES_LUGAR)[number]
export const LEGIBLES = ['si', 'parcial', 'no'] as const
export type Legible = (typeof LEGIBLES)[number]

export interface LugarVisto { nombre: string; posicion: PosicionLugar }
export interface MapaLeido {
  hay_mapa: boolean
  tipo: TipoMapa
  lugares: LugarVisto[]           // tal como se leen, con su posición respecto de la marca
  marca: MarcaMapa
  marca_detalle: string
  radio_km: number | null         // solo si el número se lee en pantalla
  radio_estimado_km: number | null // estimado (por la escala); radio_como dice cómo
  radio_como: string
  limites: string
  excluidas: string[]
  mejor_cuadro: number | null     // 1..N
  momento: string | null          // HH:MM:SS del mejor cuadro
  legible: Legible
  notas: string
}
export const normLugar = (x: string): string => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// ── Zona dicha + mapa visto ─────────────────────────────────────────────────────────────────────
// Tres grupos de lo que se lee en el mapa: la zona marcada (dentro, borde, lista de incluidas), lo de afuera (fuera, lista de
// excluidas, excluidas) y lo que se lee sin posición (sin_marca: no hay marca, o no se distingue si queda dentro). Cada lugar
// dicho se busca primero con el MISMO nombre y, si no, con uno parecido:
//   · igual en la zona → coinciden; igual afuera → dichos_afuera; igual sin posición → no_verificables;
//   · parecido (uno contiene al otro, o 1–2 letras de diferencia) → parecidos, para que lo revise una persona: "Sarmiento" y
//     "Villa del Sarmiento" pueden ser lugares distintos, y "Causete" puede ser "Caucete" mal oído. No cuenta ni como
//     coincidencia ni como discrepancia;
//   · ninguno → dichos_no_vistos si el mapa se lee y tiene una zona marcada; si no (ilegible, sin lugares leídos o sin marca),
//     no_verificables: que no se lea no prueba nada.
// vistos_no_dichos es INFORMATIVO (con un polígono se marca justamente lo que no se nombra): no suma a hay_discrepancias. Con
// un pin con radio (o una lista) de Meta sale solo de las ubicaciones configuradas (`incluidas`), no de los nombres impresos
// dentro del círculo.
export interface DiscrepanciasMapa {
  dichos_no_vistos: string[]      // se dijeron y no se leen en un mapa legible con zona marcada
  dichos_afuera: string[]         // se dijeron y en el mapa se leen AFUERA de la marca (o excluidos)
  vistos_no_dichos: string[]      // informativo: se leen en la zona marcada (con pin o lista, las configuradas) y no se dijeron
  radio: string | null            // el radio dicho y el del mapa no coinciden
}
export interface ParecidoMapa { dicho: string; visto: string; donde: 'zona' | 'afuera' | 'sin_posicion' }
export interface BloqueMapaZona {
  fuente: 'video'
  momento: string | null          // HH:MM:SS del cuadro con el estado final de la marca (link a Fathom con ?timestamp=)
  tipo: TipoMapa
  marca: MarcaMapa
  marca_detalle: string
  lugares: string[]               // la zona marcada: dentro, en el borde o en la lista de incluidas, tal como se leen
  // Las ubicaciones CONFIGURADAS en la lista de Meta (lista_incluida): con un pin con radio es la única que se carga ("San
  // Juan +17 km"); los demás nombres de `lugares` son lo que se lee impreso dentro del círculo. [] en las lecturas de antes
  incluidas: string[]
  sin_posicion: string[]          // se leen en el mapa sin saber si quedan dentro (no hay marca o no se distingue)
  radio_km: number | null
  radio_estimado_km: number | null
  radio_como: string
  limites: string
  excluidas: string[]
  legible: Legible
  notas: string
  coinciden: string[]             // lo dicho que se lee en la zona marcada con el mismo nombre (como se dijo)
  parecidos: ParecidoMapa[]       // lo dicho que solo se parece a un lugar del mapa: lo revisa una persona
  no_verificables: string[]       // lo dicho que el mapa no permite confirmar ni descartar
  discrepancias: DiscrepanciasMapa
  hay_discrepancias: boolean      // dichos_no_vistos, dichos_afuera o radio (no cuentan vistos_no_dichos ni parecidos)
}
type ZonaDicha = { lugares: string[]; radio_km: number | null }

// Lo que va entre paréntesis en un lugar dicho suele ser una nota ("de oído, verificar"); si no, es otro nombre del mismo
// lugar ("Villa Krause (Rawson)") y se compara también. Lo que va después de una coma es el contexto (Meta escribe "Chimbas,
// San Juan, Argentina"): se compara solo lo de antes. Sin acentos, sin prefijos administrativos ("Departamento Pocito" =
// "Pocito"; "Provincia de San Juan" NO es "San Juan": queda como parecido) y con los números del 1 al 31 en letras ("9 de
// Julio" = "Nueve de Julio", como lo rotula Google Maps).
const RE_NOTA = /o[ií]do|verificar|aprox|confirmar|\?/i
const RE_PREFIJO = /^(departamento|depto|dpto|partido|ciudad|localidad|barrio|municipio) (de )?/
const CARDINALES = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco',
  'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve', 'treinta', 'treinta y uno',
]
const enLetras = (n: string): string =>
  n.split(' ').map(t => {
    if (t === 'primero') return 'uno'
    const m = /^(\d{1,2})(?:ro|ero|er|do|to|vo|no|mo)?$/.exec(t)
    const k = m ? Number(m[1]) : 0
    return k >= 1 && k <= 31 ? CARDINALES[k] : t
  }).join(' ')
function nombresDe(x: string): string[] {
  const out = [normLugar(x.replace(/\([^)]*\)/g, ' ').split(',')[0])]
  for (const m of x.matchAll(/\(([^)]*)\)/g)) if (!RE_NOTA.test(m[1])) out.push(normLugar(m[1].split(',')[0]))
  return out.map(n => enLetras(n.replace(RE_PREFIJO, ''))).filter(Boolean)
}
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/**
 * ¿Es el mismo lugar? 'igual': el mismo nombre (sin acentos, con lo de entre paréntesis, sin prefijos administrativos y con
 * los números en letras). 'parecido': uno contiene al otro como palabras ("Sarmiento" / "Villa del Sarmiento") o difieren en
 * 1–2 letras ("Causete" / "Caucete"); puede ser el mismo o no, lo decide una persona. null: distintos.
 */
export function compararLugares(a: string, b: string): 'igual' | 'parecido' | null {
  let parecido = false
  for (const x of nombresDe(a)) {
    for (const y of nombresDe(b)) {
      if (x === y) return 'igual'
      if (parecido) continue
      const [corto, largo] = x.length <= y.length ? [x, y] : [y, x]
      if (corto.length >= 5 && ` ${largo} `.includes(` ${corto} `)) parecido = true
      else {
        const tolerancia = corto.length >= 9 ? 2 : corto.length >= 5 ? 1 : 0
        if (tolerancia && distancia(x, y) <= tolerancia) parecido = true
      }
    }
  }
  return parecido ? 'parecido' : null
}
/** El mismo lugar con el mismo nombre (compararLugares 'igual'). */
export const mismoLugar = (a: string, b: string): boolean => compararLugares(a, b) === 'igual'

// El radio LEÍDO (Meta lo muestra exacto, en km enteros) se compara con 1 km de tolerancia: 20 dichos y "+17 km" en pantalla
// es una diferencia real de configuración. El ESTIMADO (por la escala) es grueso: solo más de un 50 % cuenta.
const TOLERANCIA_RADIO_KM = 1
const DIFERENCIA_RADIO_ESTIMADO = 0.5

/**
 * Le suma a la zona dicha el bloque `mapa` (fuente 'video') con lo que coincide, lo parecido, lo que no se puede verificar y
 * las discrepancias. No toca nada de lo dicho (descripción, lugares, radio). Si el video no mostró un mapa, mapa: null.
 */
export function combinarZonaConMapa<Z extends ZonaDicha>(zona: Z, mapa: MapaLeido): Z & { mapa: BloqueMapaZona | null } {
  if (!mapa.hay_mapa) return { ...zona, mapa: null }
  const enZona = mapa.lugares.filter(l => l.posicion === 'dentro' || l.posicion === 'borde' || l.posicion === 'lista_incluida').map(l => l.nombre)
  const incluidas = mapa.lugares.filter(l => l.posicion === 'lista_incluida').map(l => l.nombre)
  const sinPosicion = mapa.lugares.filter(l => l.posicion === 'sin_marca').map(l => l.nombre)
  const excluidas = [...new Set([...mapa.lugares.filter(l => l.posicion === 'lista_excluida').map(l => l.nombre), ...mapa.excluidas])]
  const afuera = [...mapa.lugares.filter(l => l.posicion === 'fuera').map(l => l.nombre), ...excluidas]
  const grupos = [
    { donde: 'zona', nombres: enZona },
    { donde: 'afuera', nombres: afuera },
    { donde: 'sin_posicion', nombres: sinPosicion },
  ] as const
  const buscar = (d: string, nivel: 'igual' | 'parecido') => {
    for (const g of grupos) for (const n of g.nombres) if (compararLugares(d, n) === nivel) return { donde: g.donde, visto: n }
    return null
  }
  // Lo dicho solo se puede dar por "no visto" si el mapa se lee, tiene lugares leídos y una zona marcada
  const verificable = mapa.legible !== 'no' && mapa.marca !== 'ninguna' && (mapa.lugares.length > 0 || mapa.excluidas.length > 0)

  const dichos = zona.lugares.filter(Boolean)
  const coinciden: string[] = [], parecidos: ParecidoMapa[] = [], no_verificables: string[] = []
  const dichos_no_vistos: string[] = [], dichos_afuera: string[] = []
  for (const d of dichos) {
    const igual = buscar(d, 'igual')
    if (igual?.donde === 'zona') coinciden.push(d)
    else if (igual?.donde === 'afuera') dichos_afuera.push(d)
    else if (igual) no_verificables.push(d)
    else {
      const p = buscar(d, 'parecido')
      if (p) parecidos.push({ dicho: d, visto: p.visto, donde: p.donde })
      else (verificable ? dichos_no_vistos : no_verificables).push(d)
    }
  }
  // Con un pin o una lista de Meta, lo que "se marcó" son las ubicaciones configuradas: los nombres impresos dentro del círculo
  // no son ubicaciones aparte (si no, «en el mapa también» repetía todo lo que se lee adentro)
  const marcadas = (mapa.marca === 'pin_con_radio' || mapa.marca === 'lista') && incluidas.length ? incluidas : enZona
  const vistos_no_dichos = marcadas.filter(n => !dichos.some(d => compararLugares(d, n) !== null))

  let radio: string | null = null
  const dicho = zona.radio_km
  if (dicho !== null && dicho > 0) {
    if (mapa.radio_km !== null) {
      if (Math.abs(mapa.radio_km - dicho) >= TOLERANCIA_RADIO_KM) radio = `se dijo ${dicho} km y en el mapa se lee ${mapa.radio_km} km`
    } else if (mapa.radio_estimado_km !== null && Math.abs(mapa.radio_estimado_km - dicho) / dicho > DIFERENCIA_RADIO_ESTIMADO) {
      radio = `se dijo ${dicho} km y en el mapa parece de unos ${mapa.radio_estimado_km} km (estimado)`
    }
  }
  const discrepancias = { dichos_no_vistos, dichos_afuera, vistos_no_dichos, radio }
  return {
    ...zona,
    mapa: {
      fuente: 'video',
      momento: mapa.momento,
      tipo: mapa.tipo,
      marca: mapa.marca,
      marca_detalle: mapa.marca_detalle,
      lugares: enZona,
      incluidas,
      sin_posicion: sinPosicion,
      radio_km: mapa.radio_km,
      radio_estimado_km: mapa.radio_estimado_km,
      radio_como: mapa.radio_como,
      limites: mapa.limites,
      excluidas,
      legible: mapa.legible,
      notas: mapa.notas,
      coinciden,
      parecidos,
      no_verificables,
      discrepancias,
      hay_discrepancias: !!(dichos_no_vistos.length || dichos_afuera.length || radio),
    },
  }
}

const NOMBRE_TIPO: Record<TipoMapa, string> = { google_maps: 'Google Maps', meta_ads: 'Meta Ads', otro: 'mapa', ninguno: 'sin mapa' }
const NOMBRE_MARCA: Record<MarcaMapa, string> = {
  pin_con_radio: 'pin con radio', poligono: 'polígono', area_resaltada: 'área resaltada', lista: 'lista de ubicaciones', otra: 'otra marca', ninguna: 'sin marca',
}
const NOMBRE_DONDE: Record<ParecidoMapa['donde'], string> = { zona: '', afuera: ' (afuera)', sin_posicion: ' (sin saber si queda dentro)' }
// Meta escribe las ubicaciones con comas ("Chimbas, San Juan, Argentina"): si algún nombre trae coma (fuera de paréntesis:
// "El Bordón (de oído, verificar)" no cuenta), se separan con "; "
const sep = (xs: string[]) => (xs.some(x => x.replace(/\([^)]*\)/g, '').includes(',')) ? '; ' : ', ')
const unir = (xs: string[]) => xs.join(sep(xs))
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(sep(xs))} y ${xs[xs.length - 1]}`)

/** Una línea para la ficha / el aviso: qué se ve en el mapa y lo que no coincide con lo dicho (sin markdown ni links). */
export function lineaMapa(b: BloqueMapaZona): string {
  const radio = b.radio_km !== null ? ` · radio ${b.radio_km} km` : b.radio_estimado_km !== null ? ` · radio ≈${b.radio_estimado_km} km (estimado)` : ''
  const zona = b.marca === 'ninguna' ? 'no hay una zona marcada' : b.lugares.length ? unir(b.lugares) : 'no se leen lugares en la zona marcada'
  const partes = [`En el video (${NOMBRE_TIPO[b.tipo]}, ${NOMBRE_MARCA[b.marca]}${b.momento ? `, ${b.momento}` : ''}): ${zona}${radio}`]
  if (b.sin_posicion.length) partes.push(`${b.marca === 'ninguna' ? 'se leen' : 'se leen sin saber si quedan dentro'}: ${unir(b.sin_posicion)}`)
  if (b.excluidas.length) partes.push(`excluidas: ${unir(b.excluidas)}`)
  const { ojos, revisar } = diferenciasMapa(b)
  partes.push(...ojos.map(o => `ojo: ${o}`))
  if (revisar.length) partes.push(`revisar: ${revisar.join('; ')}`)
  if (b.no_verificables.length) partes.push(`el mapa no permite verificar ${lista(b.no_verificables)}`)
  if (b.discrepancias.vistos_no_dichos.length) partes.push(`en el mapa también: ${lista(b.discrepancias.vistos_no_dichos)} (no se dijo)`)
  return partes.join(' · ')
}

// Nombres para mostrar (ficha, pantalla y aviso) y las listas con "y" ("A, B y C"; con "; " si los nombres traen coma)
export const NOMBRE_TIPO_MAPA = NOMBRE_TIPO
export const NOMBRE_MARCA_MAPA = NOMBRE_MARCA
export const listaLugares = lista
export const unirLugares = unir

/** Un lugar dicho sin la nota entre paréntesis ("El Bordón (de oído, verificar)" → "El Bordón"); un alias queda. */
export const sinNotaLugar = (x: string): string => x.replace(/\s*\(([^)]*)\)/g, (m, n: string) => (RE_NOTA.test(n) ? '' : m)).replace(/\s+/g, ' ').trim() || x
/** ¿Se anotó como "de oído"? */
const deOido = (x: string): boolean => [...x.matchAll(/\(([^)]*)\)/g)].some(m => /o[ií]do/i.test(m[1]))

/**
 * Lo que no coincide entre el mapa y lo dicho, en frases cortas: `ojos` (lo dicho que no se ve o queda afuera, y el
 * radio) y `revisar` (lo dicho que solo se parece a un lugar del mapa: lo decide una persona). vistos_no_dichos no va: es
 * informativo (con un polígono se marca justamente lo que no se nombra). Los lugares van sin la nota "(de oído, verificar)"
 * metida en la frase: los que se anotaron de oído se aclaran al final. Que un nombre no aparezca en el mapa NO quiere decir
 * que quede afuera: dentro de un polígono un pueblo chico puede no tener el rótulo, o el nombre pudo estar mal oído.
 */
export function diferenciasMapa(b: Pick<BloqueMapaZona, 'discrepancias' | 'parecidos'>): { ojos: string[]; revisar: string[] } {
  const d = b.discrepancias
  const nv = d.dichos_no_vistos, af = d.dichos_afuera
  const oido = nv.filter(deOido).map(sinNotaLugar)
  const varios = nv.length > 1
  const ojos = [
    ...(nv.length ? [`se nombr${varios ? 'aron' : 'ó'} ${lista(nv.map(sinNotaLugar))} y en el mapa no ${varios ? 'aparecen sus nombres' : 'aparece su nombre'}: `
      + `puede${varios ? 'n' : ''} estar dentro sin nombre, afuera o mal oído${varios ? 's' : ''}${oido.length ? ` (${lista(oido)}, de oído)` : ''}`] : []),
    ...(af.length ? [`${lista(af.map(sinNotaLugar))} se nombr${af.length > 1 ? 'aron' : 'ó'} pero en el mapa queda${af.length > 1 ? 'n' : ''} afuera`] : []),
    ...(d.radio ? [d.radio] : []),
  ]
  const revisar = b.parecidos.map(p => `se nombró ${sinNotaLugar(p.dicho)} y en el mapa se lee ${p.visto}${NOMBRE_DONDE[p.donde]}`)
  return { ojos, revisar }
}

/** ¿El mapa del video sirve para la campaña? Se lee (aunque sea en parte), hay una zona marcada y se ve qué abarca. */
export function mapaUtil(b: Pick<BloqueMapaZona, 'legible' | 'marca' | 'lugares' | 'radio_km' | 'radio_estimado_km' | 'limites'>): boolean {
  return b.legible !== 'no' && b.marca !== 'ninguna' && (b.lugares.length > 0 || b.radio_km !== null || b.radio_estimado_km !== null || !!b.limites)
}

// ── Lo guardado en cj_kickoffs.zona_video ──
// pedido: procesar.ts ya le pidió el video a Fathom (download_id) y falta mirarlo; leyendo: /api/bot/kickoff/mapa lo está
// mirando (vence_ms: hasta cuándo vale ese candado). ok / sin_mapa / sin_video: terminado (con la misma VERSION_MAPA no se
// repite). sin_key: falta la API key de Fathom de quien grabó (o no se sabe quién grabó). error: con `transitorio` si vale
// reintentar (y el download_id, si ya había una descarga).
export const ESTADOS_ZONA_VIDEO = ['pedido', 'leyendo', 'ok', 'sin_mapa', 'sin_video', 'sin_key', 'error'] as const
export type EstadoZonaVideoFicha = (typeof ESTADOS_ZONA_VIDEO)[number]
/** Terminados: con la misma VERSION_MAPA, al retomar no se vuelve a mirar el video. */
export const ESTADOS_MAPA_HECHO: readonly EstadoZonaVideoFicha[] = ['ok', 'sin_mapa', 'sin_video']
/** Una lectura que quedó en pedido o leyendo más que esto se da por cortada (la ruta tiene 300 s). */
export const MAPA_COLGADO_MS = 20 * 60_000

export interface ZonaVideoFicha {
  estado: EstadoZonaVideoFicha
  version: string                 // VERSION_MAPA con que se pidió o se leyó
  quien: Quien | null             // la cuenta de Fathom (su API key) con que se pide el video
  download_id: string | null      // la descarga de Fathom, para retomarla en vez de pedir otro MP4
  motivo: string | null           // por qué no se leyó (para la ficha: sin nombres de variables)
  transitorio: boolean            // vale reintentar
  mapa: BloqueMapaZona | null     // solo con ok
  momentos: number[] | null       // los segundos que se miraron
  tokens: (Uso & { costo_usd: number }) | null
  modelo: string | null
  generado: string                // ISO de esta escritura
  vence_ms?: number | null        // solo en "leyendo": hasta cuándo vale el candado
}

type Obj = Record<string, unknown>
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {})
const txt = (x: unknown, max: number): string => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const txts = (x: unknown, max = 40): string[] => (Array.isArray(x) ? x.map(y => txt(y, 120)).filter(Boolean).slice(0, max) : [])
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1_000 ? x : null)
const enumDe = <T extends string>(x: unknown, valores: readonly T[], porDefecto: T): T => ((valores as readonly unknown[]).includes(x) ? (x as T) : porDefecto)
const RE_HHMMSS = /^\d{2,3}:[0-5]\d:[0-5]\d$/
/** Lo más que se guarda de los límites y de las notas del mapa (validarMapa de mapa.ts los corta en una frase, no a la mitad). */
export const LARGO_FRASES_MAPA = 600
const RE_DESCARGA = /^[A-Za-z0-9_-]{1,120}$/

/** El bloque `mapa` guardado (jsonb), leído con cuidado; null si no tiene la forma. hay_discrepancias se recalcula. */
export function leerBloqueMapa(x: unknown): BloqueMapaZona | null {
  const b = obj(x)
  if (b.fuente !== 'video') return null
  const d = obj(b.discrepancias)
  const discrepancias: DiscrepanciasMapa = {
    dichos_no_vistos: txts(d.dichos_no_vistos), dichos_afuera: txts(d.dichos_afuera), vistos_no_dichos: txts(d.vistos_no_dichos),
    radio: txt(d.radio, 200) || null,
  }
  const parecidos: ParecidoMapa[] = (Array.isArray(b.parecidos) ? b.parecidos : []).map(obj)
    .map(p => ({ dicho: txt(p.dicho, 120), visto: txt(p.visto, 120), donde: enumDe(p.donde, ['zona', 'afuera', 'sin_posicion'] as const, 'zona') }))
    .filter(p => p.dicho && p.visto).slice(0, 40)
  const momento = typeof b.momento === 'string' && RE_HHMMSS.test(b.momento) ? b.momento : null
  return {
    fuente: 'video', momento,
    tipo: enumDe(b.tipo, TIPOS_MAPA, 'otro'), marca: enumDe(b.marca, MARCAS_MAPA, 'otra'), marca_detalle: txt(b.marca_detalle, 300),
    lugares: txts(b.lugares), incluidas: txts(b.incluidas), sin_posicion: txts(b.sin_posicion),
    radio_km: num(b.radio_km), radio_estimado_km: num(b.radio_estimado_km), radio_como: txt(b.radio_como, 200),
    limites: txt(b.limites, LARGO_FRASES_MAPA), excluidas: txts(b.excluidas), legible: enumDe(b.legible, LEGIBLES, 'parcial'), notas: txt(b.notas, LARGO_FRASES_MAPA),
    coinciden: txts(b.coinciden), parecidos, no_verificables: txts(b.no_verificables), discrepancias,
    hay_discrepancias: !!(discrepancias.dichos_no_vistos.length || discrepancias.dichos_afuera.length || discrepancias.radio),
  }
}

/** Lo guardado en cj_kickoffs.zona_video (o en la ficha), leído con cuidado; null si no tiene la forma. */
export function leerZonaVideo(x: unknown): ZonaVideoFicha | null {
  const z = obj(x)
  if (!(ESTADOS_ZONA_VIDEO as readonly unknown[]).includes(z.estado) || typeof z.version !== 'string' || !z.version) return null
  const estado = z.estado as EstadoZonaVideoFicha
  const mapa = estado === 'ok' ? leerBloqueMapa(z.mapa) : null
  const t = obj(z.tokens)
  const tokens = typeof t.input_tokens === 'number' && typeof t.output_tokens === 'number'
    ? { input_tokens: t.input_tokens, output_tokens: t.output_tokens, costo_usd: typeof t.costo_usd === 'number' ? t.costo_usd : 0 } : null
  return {
    estado: estado === 'ok' && !mapa ? 'error' : estado,
    version: txt(z.version, 40),
    quien: z.quien === 'tomas' || z.quien === 'gero_m' ? z.quien : null,
    download_id: typeof z.download_id === 'string' && RE_DESCARGA.test(z.download_id) ? z.download_id : null,
    motivo: txt(z.motivo, 300) || (estado === 'ok' && !mapa ? 'el bloque del mapa guardado no se puede leer' : null),
    transitorio: z.transitorio === true,
    mapa,
    momentos: Array.isArray(z.momentos) ? z.momentos.filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s >= 0).slice(0, 12) : null,
    tokens,
    modelo: txt(z.modelo, 60) || null,
    generado: typeof z.generado === 'string' && Number.isFinite(Date.parse(z.generado)) ? z.generado : new Date(0).toISOString(),
    ...(typeof z.vence_ms === 'number' && Number.isFinite(z.vence_ms) ? { vence_ms: z.vence_ms } : {}),
  }
}

/**
 * Una lectura que quedó en "pedido" o "leyendo" mucho tiempo (la ruta se cortó, o el disparo no llegó): se muestra como
 * error para reintentar. Sin `ahoraMs`, tal cual.
 */
export function zonaVideoVigente(zv: ZonaVideoFicha | null, ahoraMs?: number): ZonaVideoFicha | null {
  if (!zv || ahoraMs === undefined || (zv.estado !== 'pedido' && zv.estado !== 'leyendo')) return zv
  const desde = Date.parse(zv.generado)
  if (!Number.isFinite(desde) || ahoraMs - desde < MAPA_COLGADO_MS) return zv
  return { ...zv, estado: 'error', transitorio: true, motivo: 'la lectura del video no terminó' }
}

/** Sin el minuto en que se habló de la zona (timestamp mal formado o fuera de la llamada) no se sabe qué parte mirar. */
export const MOTIVO_SIN_MOMENTO = 'la ficha no tiene el minuto en que se habló de la zona: no se sabe qué parte del video mirar'

/** Lo que falta para leer el mapa solo, cuando no hay API key de Fathom de quien grabó (sin nombres de variables). */
export const textoSinKeyMapa = (nombre: string): string => `conectar la API key de Fathom de ${nombre} para leer el mapa`

/** Cómo se reintenta una lectura cortada (la pantalla no tiene botón y la ruta del mapa pide el Bearer). */
export const comoReintentarMapa = (id?: number | null): string =>
  id ? `para reintentar, pedile a Claude que relea el mapa de la grabación ${id}` : 'reintentar'

/**
 * En palabras, para la ficha y la pantalla: "se está leyendo del video", "la grabación no tiene video"… `id`: el
 * recording_id, para decir cómo se reintenta un error pasajero.
 */
export function textoEstadoMapa(zv: Pick<ZonaVideoFicha, 'estado' | 'motivo' | 'transitorio'>, id?: number | null): string {
  switch (zv.estado) {
    case 'ok': return 'leído del video'
    case 'pedido': case 'leyendo': return 'se está leyendo del video'
    case 'sin_mapa': return 'en los minutos de la zona el video no muestra el mapa'
    case 'sin_video': return 'la grabación no tiene video'
    case 'sin_key': return zv.motivo || 'falta la API key de Fathom de quien grabó'
    default: return `no se pudo leer del video${zv.motivo ? ` (${zv.motivo})` : ''}${zv.transitorio ? `: ${comoReintentarMapa(id)}` : ''}`
  }
}

/** "de 17:08 a 20:18": los minutos de la grabación que miró el bot (los `momentos` en segundos), o null. */
export function rangoMomentos(momentos: number[] | null | undefined): string | null {
  const xs = (momentos ?? []).filter(s => Number.isFinite(s) && s >= 0)
  if (!xs.length) return null
  const dos = (n: number) => String(n).padStart(2, '0')
  const mm = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60); return `${h ? `${h}:` : ''}${dos(m)}:${dos(x)}` }
  const a = Math.min(...xs), b = Math.max(...xs)
  return a === b ? `el ${mm(a)}` : `de ${mm(a)} a ${mm(b)}`
}
