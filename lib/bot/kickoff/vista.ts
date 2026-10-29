// ── Pantalla de la ficha de kickoff (/clientes/<id>/kickoff): fila de cj_kickoffs → lo que se muestra (puro) ──────
// Reemplaza la tarjeta de ClickUp "Seguimiento de Anuncios" (decisión de Tomás, 24/10/2026). La página es un server
// component que lee las filas del cliente (registro.listarFichasCliente) y pasa CADA una por acá: lo que sale de armarVista
// es lo único que llega a la pantalla, así que acá se decide qué NO sale.
//   · Lectura defensiva: la ficha es jsonb de la base (puede ser de una versión vieja del prompt, o de una fila que quedó a
//     medias). Lo que falte queda vacío; si ni siquiera tiene la forma de una ficha, armarVista devuelve null.
//   · Portfolio: de portfolio_final (o portfolioFinalDe() de ficha.ts para las fichas viejas, sin chequeo de Meta). Los ítems
//     con fuente 'ninguna' (ni Meta ni la llamada los resolvieron) se tildan a mano: el tilde (portfolio_checks) manda sobre
//     "para tildar" en lo que se ve, y la línea "tildar a mano" de los faltantes se rehace con lo que queda sin tildar. Un
//     tilde de un ítem que dejó de ser tildable (la ficha se rehízo y Meta ya lo ve) se sigue mostrando, pero no manda.
//     "Sin verificar" queda SOLO para la verificación de Meta: lo que nadie resolvió es "Para tildar".
//   · Faltantes: se recalculan con calcularFaltantes de ficha.ts (así una ficha vieja muestra los textos de hoy: la zona con
//     el ▶ al mapa, sin "la grabación terminó…", que pasó a ser una nota de la cabecera). Cada uno con clave se puede marcar
//     como hecho con una nota (faltantes_checks): pasa a "Hechos" y deja de contar en "Falta completar".
//   · Para lanzar: lo que Valentino necesita para armar la campaña (cuenta, moneda y hora, página, presupuesto de arranque,
//     zona con el ▶ del mapa y la nota del recorte, avatar, estado de las ideas, lanzamiento) y los dos datos que se cargan
//     a mano (fecha estimada y WhatsApp de destino). Sin ganadores ni acuerdos: sirve también para mostrarlo en /anuncios.
//   · Ideas: las de la ficha; si la fila quedó a medias (error o procesando) y la ficha base todavía dice "no se pidieron",
//     las de la columna ideas (guardarIdeas las guarda apenas salen). La revisión de Tomi y Gero M (columna revision) cuenta
//     solo si su huella coincide con la de las ideas de ahora: si el bot las rehizo, vuelve a "pendiente" y se avisa. Cada
//     revisor muestra su historial ("pidió cambios el … → aprobó el …").
//   · Ganadores: anuncios de OTROS clientes (referencia interna). No salen el nombre del otro cliente, su cuenta ni el copy
//     (puede traer teléfonos o el nombre del abogado): solo id, gancho, subtema, país, números y qué ideas los citan.
//   · Cada dato de la llamada lleva su "▶ minuto": link a Fathom en el segundo de la cita (aprox, con "≈", cuando el renglón
//     de Fathom es largo) o en el del renglón. Solo si la URL es de fathom.video; si no, va sin link.
//   · Mails: ninguno llega a la pantalla. Los del equipo (EQUIPO_ACCESOS_BASE) se reemplazan por su nombre corto (Gero A,
//     Valentino) y cualquier otro por "[mail]", en todo texto (un pendiente de Claude traía los dos del equipo).
//   · Zona desde el video (24/10): la lectura del mapa que manda es la de la COLUMNA zona_video (la escribe
//     /api/bot/kickoff/mapa después de que la ficha quedó lista; la ficha guarda la que se conocía al armarla). conZonaVideo
//     (ficha.ts) la suma a la ficha antes de calcular los faltantes: con el mapa leído y sin diferencias, el faltante del
//     recorte se da por resuelto; con diferencias, pasa a "revisar". La zona trae el bloque `video` (lugares leídos, marca,
//     límites, radio, discrepancias con lo dicho y el ▶ al cuadro de la marca final) o el estado de la lectura. Una lectura
//     que quedó "pedido" o "leyendo" más de 20 minutos se muestra como cortada (para reintentar). Lo que pide el mapa YA
//     leído (revisar las diferencias, confirmar un recorte que se lee en parte) tiene su propia clave (zona_mapa_video): una
//     nota del recorte anotada a mano antes de que se leyera el video no lo tapa; queda a la vista como contexto, y "Para
//     lanzar" avisa que el video dice otra cosa. Con un pin con radio de Meta, "Para lanzar" lleva la ubicación configurada
//     con su radio ("San Juan +17 km · sin Chimbas"), no los nombres que se leen dentro del círculo.
//   · Duplicadas: la otra grabación de la misma reunión no tiene ficha (no sale en la lista); gemelasVista arma, de lo que
//     lee registro.gemelasDe, el "también la grabó Tomás" de la cabecera.
import { NOMBRE_RAMA } from '@/lib/anuncios/ramas'
import { fechaCortaAR, horaCorta, linkFathom } from '@/lib/fathomAnuncios/transcripcion'
import {
  MOTIVO_META, ORIGEN_CUENTA, calcularFaltantes, claveFaltante, conZonaVideo, faltantesPortfolio, lineaTildarPortfolio, monedaYHora, notaCorteGrabacion,
  portfolioFinalDe, renglonLanzamiento, textoPresupuesto,
} from './ficha'
import {
  NOMBRE_MARCA_MAPA, NOMBRE_TIPO_MAPA, diferenciasMapa, leerZonaVideo, mapaUtil, mismoLugar, rangoMomentos, textoEstadoMapa, zonaVideoVigente,
  type EstadoZonaVideoFicha, type MarcaMapa, type ZonaVideoFicha,
} from './mapa-zona'
import type { Quien } from './grabadores'
import {
  CLAVES_DATO, CLAVES_REVISOR, NOMBRE_DATO, NOMBRE_REVISOR, NOMBRE_VALOR_CHECK, huellaIdeas, leerChecks, leerMarcas, leerRevision,
  type CheckPortfolio, type ClaveDato, type ClaveMarca, type ClaveRevisor, type MarcaFaltante, type MarcasFaltantes,
} from './revision'
import type { FilaFichaCliente } from './registro'
import {
  EQUIPO_ACCESOS_BASE, ITEMS_PORTFOLIO, NOMBRE_ITEM_PORTFOLIO, TIPOS_REUNION, esRama,
  type EstadoIdeas, type EstadoPortfolioFinal, type FichaKickoff, type FuentePortfolio, type GanadoresFicha, type IdeasFicha, type ItemPortfolio,
  type ItemPortfolioFinal, type PortfolioMetaFicha, type TipoReunion,
} from './tipos'

// ── Lo que muestra la pantalla ──
export interface Momento { href: string; etiqueta: string; aprox: boolean }   // "▶ 12:30" / "▶ ≈12:30"
export interface DatoVista { texto: string; cita: string | null; textual: boolean; momento: Momento | null }
export type Tono = 'verde' | 'amarillo' | 'rojo' | 'gris'

export interface CheckVista extends Omit<CheckPortfolio, 'email'> { etiqueta: string; cuandoTexto: string | null }   // sin el mail de quien tildó
export interface FilaPortfolioVista {
  item: ItemPortfolio
  nombre: string
  estado: EstadoPortfolioFinal     // lo que quedó en la ficha (Meta o la llamada)
  fuente: FuentePortfolio
  etiquetaFuente: string
  detalle: string
  discrepancia: string | null
  mencionado: boolean              // la llamada lo nombró sin confirmarlo
  dato: DatoVista | null           // la cita y el ▶, solo cuando la fila habla de la llamada (como el markdown)
  tildable: boolean                // ni Meta ni la llamada lo resolvieron: se tilda a mano
  check: CheckVista | null         // lo tildado a mano (si hay)
  visto: { estado: EstadoPortfolioFinal; texto: string; tono: Tono; aMano: boolean }
}
/** Una marca de faltante hecho o un dato cargado, sin el mail de quien lo hizo. */
export interface MarcaVista extends Omit<MarcaFaltante, 'email'> { cuandoTexto: string | null }
export interface FaltanteVista {
  texto: string                    // con el ▶ aparte (momento): en el texto no queda un "▶ 17:18" que no se puede tocar
  clave: ClaveMarca | null         // null = no se marca acá (el del portfolio se resuelve tildando)
  momento: Momento | null          // la zona del mapa: ▶ al minuto en que se marcó (o al cuadro del mapa leído)
  marca: MarcaVista | null         // hecho (con quién, cuándo y la nota)
  contexto: string | null          // lo que hay que saber al marcarlo (la nota del recorte anotada antes de leer el video)
}
export interface DatoLanzamiento { clave: ClaveDato; nombre: string; marca: MarcaVista | null }
export interface ParaLanzarVista {
  cuenta: string | null            // "act_… («nombre»)"
  monedaHora: string               // "factura en USD · hora de Argentina" ('' = sin dato)
  pagina: string | null
  presupuesto: string
  // nota: la del faltante del mapa marcado como hecho; video: el recorte leído del mapa en el video (si se lee); revisar: el
  // video dice otra cosa que lo dicho y nadie lo revisó todavía (aunque haya una nota); leyendo: el bot lo está leyendo
  zona: { texto: string; momento: Momento | null; nota: string | null; video: string | null; revisar: boolean; leyendo: boolean }
  avatar: string
  ideas: string
  lanzamiento: string
  datos: DatoLanzamiento[]
}
export interface RevisorVista {
  clave: ClaveRevisor
  nombre: string                   // 'Tomi' | 'Gero M'
  estado: 'pendiente' | 'aprobada' | 'cambios'
  comentario: string
  cuandoTexto: string | null
  previo: string | null            // el `cuando` guardado: la marca para escribir con condición (aunque sea de otras ideas)
  anterior: string | null          // "aprobó otra versión de las ideas (vie 23/10 18:10)": la revisión guardada ya no cuenta
  historial: string[]              // "Pidió cambios el sáb 24/10 15:10: «…»", el más nuevo primero
}
export interface IdeaVista { n: number; titulo: string; gancho: string; angulo: string; subrama: string; por_que: string; ganadores: string[] }
export type EstadoGeneralIdeas = 'sin_ideas' | 'pendiente' | 'a_medias' | 'cambios' | 'aprobadas'
export interface GanadorVista {
  id: string; anuncio: string; subtema: string; pais: string | null; cplUSD: number; mensajes: number; gastoUSD: number
  ideas: number[]                  // qué ideas (1…5) lo citan
}

/** El mapa de la zona leído del video (o el estado de la lectura), para la pantalla. */
export interface MapaVideoVista {
  estado: EstadoZonaVideoFicha
  texto: string                    // "Leído del video" / "Se está leyendo del video" / por qué no se pudo
  tono: Tono
  momento: Momento | null          // ▶ al cuadro con la marca terminada
  fuente: string                   // "Google Maps · polígono"
  lugares: string[]                // la zona marcada
  sinPosicion: string[]            // se leen sin saber si quedan dentro
  excluidas: string[]
  limites: string
  radio: string | null             // "17 km" / "≈20 km (estimado: …)"
  coinciden: string[]
  ojos: string[]                   // lo dicho que no se ve o queda afuera, y el radio
  revisar: string[]                // lo dicho que solo se parece (lo decide una persona)
  noVerificables: string[]
  tambien: string[]                // en el mapa y no se dijo (informativo; vacío con un polígono o un área: repetía la zona)
  notas: string
  util: boolean                    // se lee y hay una zona marcada (sirve para la campaña)
  coincide: boolean                // además, no contradice lo dicho
  // Desde el 24/10 (tarde)
  marca: MarcaMapa | null
  marcados: { nombre: string; dicho: boolean }[]   // lo marcado en el mapa (con pin: las ubicaciones configuradas), con ✓ si se dijo
  dentroCirculo: string[]          // con un pin con radio: los nombres que se leen impresos dentro del círculo
  parcial: boolean                 // se lee en parte: lo leído hay que confirmarlo
  leyendo: boolean                 // pedido a Fathom o leyendo: el resultado llega en unos minutos
  rango: string | null             // "de 17:08 a 20:18": los minutos que miró el bot (para "en esos minutos no está")
  conPin: boolean                  // pin con radio (o lista) de Meta con la ubicación configurada a la vista
}
/** La otra grabación de la misma reunión (quedó "duplicada" de esta). */
export interface GemelaVista { recording_id: number; quien: string; fathom: string | null }

export interface VistaKickoff {
  recording_id: number
  registro: { estado: string; aviso: string | null; tono: Tono; etiqueta: string }
  encabezado: {
    cliente: string; verificado: boolean; idCrm: string | null; apodo: string | null; como: string
    titulo: string; fecha: string | null; fechaIso: string | null; quien: string | null; fathom: string | null
    resumen: string; tipo: TipoReunion; esKickoff: boolean
    corte: string | null           // "La grabación cortó a las 09:22; el evento iba hasta las 09:45"
  }
  faltantes: FaltanteVista[]       // lo que falta (sin marcar)
  hechos: FaltanteVista[]          // marcados como hechos (con la nota)
  lanzar: ParaLanzarVista
  rama: { principal: string | null; texto: string; dato: DatoVista; subramas: DatoVista[]; descartadas: (DatoVista & { motivo: string })[]; aFuturo: DatoVista[] }
  avatar: { incluye: DatoVista[]; excluye: DatoVista[]; contexto: DatoVista[] }
  zona: {
    descripcion: DatoVista; lugares: string[]; radioKm: number | null; presentarse: (DatoVista & { cuando: string }) | null
    contexto: DatoVista[]; pais: string | null; mapa: boolean; mapaMomento: Momento | null
    video: MapaVideoVista | null     // la lectura del mapa desde el video (null = no hubo mapa o no se pidió)
  }
  presupuesto: { texto: string; certeza: string; deducido: boolean; acordado: string; moneda: string | null; dato: DatoVista; mes: DatoVista | null }
  portfolio: {
    filas: FilaPortfolioVista[]
    resumen: { ok: number; total: number; aTildar: number; tildados: number; texto: string }
    meta: { lineas: string[]; aviso: string | null }
  }
  acuerdos: { quien: string; que: string; cuando: string | null; dato: DatoVista }[]
  pendientes: string[]
  ideas: {
    estado: EstadoIdeas; motivo: string | null; notas: string; lista: IdeaVista[]; huella: string
    revisores: RevisorVista[]; general: EstadoGeneralIdeas; texto: string; desdeRegistro: boolean
  }
  ganadores: { estado: string; estadoTexto: string; nota: string; ventana: string | null; lista: GanadorVista[] }
  ajustes: string[]
}

export interface OpcionFicha { recording_id: number; etiqueta: string; actual: boolean }

// ── Mails: ninguno llega a la pantalla ──
const RE_MAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const CORTO_EQUIPO = new Map<string, string>(EQUIPO_ACCESOS_BASE.map(m => [m.mail.toLowerCase(), m.corto]))
/** Los mails del equipo → su nombre corto (geroa2004@… → Gero A); cualquier otro → [mail]. */
export const taparMails = (t: string): string => t.replace(RE_MAIL, m => CORTO_EQUIPO.get(m.toLowerCase()) ?? '[mail]')

// ── Lectura defensiva ──
type Obj = Record<string, unknown>
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {})
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const str = (x: unknown): string => (typeof x === 'string' ? taparMails(x.replace(/\s+/g, ' ').trim()) : '')
const strONull = (x: unknown): string | null => str(x) || null
const numONull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** ¿Tiene la forma mínima de una FichaKickoff? (lo demás se lee con cuidado: puede faltar en una ficha vieja) */
export function esFichaKickoff(x: unknown): x is FichaKickoff {
  const f = obj(x)
  return f.version === 1 && typeof f.recording_id === 'number' && typeof f.tipo_reunion === 'string'
    && !!f.cliente && typeof f.cliente === 'object' && !!f.portfolio && typeof f.portfolio === 'object'
}

/** La URL de la grabación, solo si es de Fathom (https, fathom.video): la única que se linkea. */
export function urlFathom(x: unknown): string | null {
  if (typeof x !== 'string') return null
  try {
    const u = new URL(x)
    return u.protocol === 'https:' && (u.hostname === 'fathom.video' || u.hostname.endsWith('.fathom.video')) ? u.toString() : null
  } catch {
    return null
  }
}

const RE_TS = /^\d{2}:\d{2}:\d{2}$/
/** El "▶ minuto" de un dato: al segundo estimado de la cita (aprox) si lo hay, o al del renglón. */
export function momentoDe(e: unknown, url: string | null): Momento | null {
  if (!url) return null
  const o = obj(e)
  const aprox = typeof o.aprox === 'string' && RE_TS.test(o.aprox) ? o.aprox : null
  const ts = aprox ?? (typeof o.timestamp === 'string' && RE_TS.test(o.timestamp) ? o.timestamp : null)
  if (!ts) return null
  return { href: linkFathom(url, ts), etiqueta: `${aprox ? '≈' : ''}${horaCorta(ts)}`, aprox: !!aprox }
}

function datoDe(x: unknown, url: string | null, texto?: string): DatoVista {
  const o = obj(x)
  const cita = str(o.cita)
  return { texto: texto ?? str(o.texto), cita: cita || null, textual: o.textual === true, momento: momentoDe(o, url) }
}
const datos = (xs: unknown, url: string | null): DatoVista[] => arr(xs).map(x => datoDe(x, url)).filter(d => d.texto)

// ── Portfolio ──
const ETIQUETA_FUENTE: Record<FuentePortfolio, string> = { meta: 'Meta', llamada: 'Llamada', ninguna: '—' }
const TEXTO_ESTADO: Record<EstadoPortfolioFinal, string> = { ok: 'Ok', falta: 'Falta', problema: 'Problema', sin_dato: 'Para tildar' }
const TONO_ESTADO: Record<EstadoPortfolioFinal, Tono> = { ok: 'verde', falta: 'amarillo', problema: 'rojo', sin_dato: 'gris' }

// La nota del tilde la escribe una persona ("pedirle el acceso a laura@estudio.com"): sin mails, como las marcas (la ven la
// pantalla, el bloque "Para lanzar" y el aviso a Valentino en #📣-ads)
function checkVista(c: CheckPortfolio | undefined): CheckVista | null {
  if (!c) return null
  return { valor: c.valor, nota: taparMails(c.nota), quien: c.quien, cuando: c.cuando, etiqueta: NOMBRE_VALOR_CHECK[c.valor], cuandoTexto: fechaCortaAR(c.cuando) }
}
const marcaVista = (m: MarcaFaltante | undefined): MarcaVista | null =>
  m ? { nota: taparMails(m.nota), quien: m.quien, cuando: m.cuando, cuandoTexto: fechaCortaAR(m.cuando) } : null

function filaPortfolio(k: ItemPortfolio, x: ItemPortfolioFinal, f: FichaKickoff, url: string | null, check: CheckPortfolio | undefined): FilaPortfolioVista {
  const c = obj(obj(f.portfolio)[k])
  const mencionado = x.llamada?.estado === 'sin_verificar' || c.estado === 'sin_verificar'
  const tildable = x.fuente === 'ninguna'
  const cv = checkVista(check)
  // La cita y el ▶ solo si la fila habla de la llamada (misma regla que fichaMarkdown)
  const conLlamada = x.fuente === 'llamada' || !!x.discrepancia || mencionado
  const dato = conLlamada && (str(c.cita) || momentoDe(c, url)) ? datoDe(c, url, str(c.detalle)) : null
  const manda = tildable && cv ? cv.valor : null
  const visto = manda
    ? { estado: manda as EstadoPortfolioFinal, texto: `${NOMBRE_VALOR_CHECK[manda]} (a mano)`, tono: TONO_ESTADO[manda], aMano: true }
    : tildable && mencionado
      ? { estado: x.estado, texto: 'Para tildar (se mencionó)', tono: 'amarillo' as Tono, aMano: false }
      : { estado: x.estado, texto: TEXTO_ESTADO[x.estado] ?? 'Para tildar', tono: TONO_ESTADO[x.estado] ?? 'gris', aMano: false }
  return {
    item: k, nombre: NOMBRE_ITEM_PORTFOLIO[k], estado: x.estado, fuente: x.fuente, etiquetaFuente: ETIQUETA_FUENTE[x.fuente] ?? '—',
    detalle: str(x.detalle), discrepancia: strONull(x.discrepancia), mencionado, dato, tildable, check: cv, visto,
  }
}

/** Debajo de la tabla: qué cuenta se revisó en Meta, de dónde salió, moneda y hora, y cuándo (o por qué no se pudo). */
export function lineasMeta(m: PortfolioMetaFicha | null): { lineas: string[]; aviso: string | null } {
  if (!m) return { lineas: ['Sin chequeo de Meta (ficha anterior al chequeo del portfolio): todo sale de la llamada.'], aviso: null }
  const cuando = fechaCortaAR(str(m.generado) || null)
  const origen = m.origen_cuenta ? ORIGEN_CUENTA[m.origen_cuenta] ?? '' : ''
  const cuenta = m.cuenta ? `${m.cuenta}${m.nombre ? ` («${str(m.nombre)}»)` : ''}` : ''
  const mh = monedaYHora(m)
  const linea = m.leido
    ? `Cuenta revisada en Meta: ${cuenta || 'sin id'}${mh ? ` · ${mh}` : ''}${origen ? ` · ${origen}` : ''}${cuando ? ` · chequeo del ${cuando}` : ''}`
    : `Meta no pudo leer ${cuenta ? `la cuenta ${cuenta}` : 'la cuenta del cliente'} (${MOTIVO_META[m.motivo ?? 'error'] ?? 'error al leer la cuenta'})${cuando ? ` · ${cuando}` : ''}`
  return { lineas: [linea], aviso: strONull(m.aviso) }
}

// ── Faltantes ──
const esPortfolio = (x: string) => /^Portfolio\b/.test(x)
const esCorte = (x: string) => /^La grabación terminó/.test(x)

/**
 * Los faltantes con los tildes y las marcas aplicados. Lo que no es del portfolio sale de calcularFaltantes (los textos de
 * hoy, también para una ficha vieja; si la ficha no tiene la forma para recalcular, los guardados); el bloque del portfolio
 * se rehace (faltantesPortfolio, sin su línea de "tildar a mano") y la línea de tildar lista solo lo que falta tildar. Lo
 * tildado como falta o problema queda anotado, con quién. Devuelve los textos ANTES de separar los hechos.
 */
export function faltantesConChecks(f: FichaKickoff, filas: FilaPortfolioVista[]): string[] {
  let todos: string[]
  try {
    todos = calcularFaltantes(f)
  } catch {
    todos = arr(f.faltantes).filter((x): x is string => typeof x === 'string')
  }
  todos = todos.map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x && !esCorte(x))
  const propios = faltantesPortfolio(f).filter(x => !/tildar a mano/.test(x))
  const sinTildar = filas.filter(x => x.tildable && !x.check)
  const tildar = sinTildar.length
    ? [lineaTildarPortfolio(sinTildar.map(x => x.item), sinTildar.filter(x => x.mencionado).map(x => x.item), (f.portfolio_meta ?? null) as PortfolioMetaFicha | null)]
    : []
  const tildadosMal = filas.filter(x => x.tildable && x.check && x.check.valor !== 'ok')
    .map(x => `Portfolio · ${NOMBRE_ITEM_PORTFOLIO[x.item]}: ${x.check!.valor} (lo tildó ${x.check!.quien || 'alguien'}${x.check!.cuandoTexto ? ` el ${x.check!.cuandoTexto}` : ''})${x.check!.nota ? ` · ${x.check!.nota}` : ''}`)
  const bloque = [...tildar, ...propios, ...tildadosMal]
  // El bloque va donde estaba el del portfolio (o antes de las ideas, que van al final)
  const i = todos.findIndex(esPortfolio)
  const resto = todos.filter(x => !esPortfolio(x))
  const donde = i >= 0 ? todos.slice(0, i).filter(x => !esPortfolio(x)).length
    : (() => { const j = resto.findIndex(x => /^Ideas de guiones/.test(x)); return j >= 0 ? j : resto.length })()
  return [...resto.slice(0, donde), ...bloque, ...resto.slice(donde)].map(taparMails)
}

/** El "▶ 17:18" / "▶ ≈17:18" dentro de un texto (en la pantalla el ▶ va aparte, como link). */
const RE_PLAY = /\s*▶\s*≈?\d{1,2}:\d{2}(?::\d{2})?/g

/**
 * Pendientes y hechos: cada faltante con clave puede estar marcado (faltantes_checks). La zona del mapa lleva su ▶ (al
 * cuadro del mapa leído en el video, si lo hay; si no, al minuto en que se habló de la zona), que en el texto ya no se
 * repite. Lo que pide el mapa leído (zona_mapa_video) con una nota del recorte anotada antes lleva esa nota como contexto.
 */
function separarFaltantes(textos: string[], marcas: MarcasFaltantes, f: FichaKickoff, url: string | null): { faltantes: FaltanteVista[]; hechos: FaltanteVista[] } {
  const faltantes: FaltanteVista[] = [], hechos: FaltanteVista[] = []
  const vistas = new Set<ClaveMarca>()
  const mapaMomento = f.zona?.mapa?.momento ? momentoDe({ timestamp: f.zona.mapa.momento }, url) : null
  for (const texto of textos) {
    const k = claveFaltante(texto)
    const clave = k && !vistas.has(k) ? k : null      // dos con la misma clave: solo el primero se marca
    if (clave) vistas.add(clave)
    const esMapa = clave === 'zona_mapa' || clave === 'zona_mapa_video'
    const momento = esMapa ? mapaMomento ?? momentoDe(f.zona, url) : null
    const marca = clave ? marcaVista(marcas[clave]) : null
    const previa = clave === 'zona_mapa_video' && !marca && marcas.zona_mapa?.nota ? taparMails(marcas.zona_mapa.nota) : null
    const x: FaltanteVista = {
      texto: momento ? texto.replace(RE_PLAY, '').replace(/\(\s*;\s*/, '(').replace(/;\s*\)/, ')').replace(/\s+/g, ' ').trim() : texto,
      clave, momento, marca,
      contexto: previa ? `Antes se anotó a mano el recorte «${previa}»: el mapa del video lo contradice o hay que confirmarlo.` : null,
    }
    ;(x.marca ? hechos : faltantes).push(x)
  }
  return { faltantes, hechos }
}

const TONO_MAPA: Record<EstadoZonaVideoFicha, Tono> = { ok: 'verde', pedido: 'amarillo', leyendo: 'amarillo', sin_mapa: 'gris', sin_video: 'gris', sin_key: 'amarillo', error: 'rojo' }
const mayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)

/** La lectura del mapa para la pantalla (los textos pasan por str: sin mails). `id`: para decir cómo se reintenta. */
export function mapaVideoVista(zv: ZonaVideoFicha | null, url: string | null, id?: number | null): MapaVideoVista | null {
  if (!zv) return null
  const b = zv.estado === 'ok' ? zv.mapa : null
  const leyendo = zv.estado === 'pedido' || zv.estado === 'leyendo'
  const vacia = {
    lugares: [], sinPosicion: [], excluidas: [], limites: '', radio: null, coinciden: [], ojos: [], revisar: [], noVerificables: [], tambien: [], notas: '',
    marca: null, marcados: [], dentroCirculo: [], parcial: false, leyendo, rango: rangoMomentos(zv.momentos), conPin: false,
  }
  if (!b) return { estado: zv.estado, texto: mayuscula(str(textoEstadoMapa(zv, id))), tono: TONO_MAPA[zv.estado] ?? 'gris', momento: null, fuente: '', util: false, coincide: false, ...vacia }
  const { ojos, revisar } = diferenciasMapa(b)
  const util = mapaUtil(b)
  const coincide = util && !ojos.length && !revisar.length
  const parcial = coincide && b.legible === 'parcial'
  const radio = b.radio_km !== null ? `${b.radio_km} km` : b.radio_estimado_km !== null ? `≈${b.radio_estimado_km} km (estimado${b.radio_como ? `: ${str(b.radio_como)}` : ''})` : null
  // Con un pin o una lista de Meta, lo marcado son las ubicaciones configuradas; lo demás se lee dentro del círculo
  const incluidas = (b.incluidas ?? []).map(str).filter(Boolean)
  const conPin = (b.marca === 'pin_con_radio' || b.marca === 'lista') && incluidas.length > 0
  const lugares = b.lugares.map(str).filter(Boolean)
  const coinciden = b.coinciden.map(str).filter(Boolean)
  const marcados = (conPin ? incluidas : lugares).map(nombre => ({ nombre, dicho: coinciden.some(c => mismoLugar(c, nombre)) }))
  const area = b.marca === 'poligono' || b.marca === 'area_resaltada'
  return {
    estado: 'ok',
    texto: !util ? 'El mapa del video no deja leer el recorte' : parcial ? 'Leído del video: coincide con lo dicho, pero se lee en parte (confirmalo)'
      : coincide ? 'Leído del video: coincide con lo dicho' : 'Leído del video: no coincide del todo con lo dicho',
    tono: coincide && !parcial ? 'verde' : 'amarillo',
    momento: b.momento ? momentoDe({ timestamp: b.momento }, url) : null,
    fuente: `${NOMBRE_TIPO_MAPA[b.tipo]} · ${NOMBRE_MARCA_MAPA[b.marca]}${b.legible === 'parcial' ? ' · se lee en parte' : b.legible === 'no' ? ' · no se lee' : ''}`,
    lugares,
    sinPosicion: b.sin_posicion.map(str).filter(Boolean),
    excluidas: b.excluidas.map(str).filter(Boolean),
    limites: str(b.limites),
    radio,
    coinciden,
    ojos: ojos.map(str),
    revisar: revisar.map(str),
    noVerificables: b.no_verificables.map(str).filter(Boolean),
    tambien: area ? [] : b.discrepancias.vistos_no_dichos.map(str).filter(Boolean),
    notas: str(b.notas),
    util,
    coincide,
    marca: b.marca,
    marcados,
    dentroCirculo: conPin ? lugares.filter(x => !incluidas.includes(x)) : [],
    parcial,
    leyendo: false,
    rango: rangoMomentos(zv.momentos),
    conPin,
  }
}

/**
 * El recorte según el video, en una línea para "Para lanzar" (y el aviso a Valentino). Con un pin con radio de Meta: la
 * ubicación configurada con su radio y lo excluido ("San Juan, San Juan, Argentina +17 km · sin Chimbas…"): antes salían
 * también los nombres que se leen dentro del círculo y se leía como 9 ubicaciones de 17 km cada una. Con un polígono o un
 * área, los lugares y los límites (a Valentino le sirven más que la lista de nombres). null si no se lee.
 */
export function recorteSegunVideo(m: MapaVideoVista | null): string | null {
  if (!m?.util) return null
  const conPin = m.conPin
  const radioMas = m.radio && /^\d/.test(m.radio) ? ` +${m.radio}` : m.radio ? ` (radio ${m.radio})` : ''
  const sin = m.excluidas.length ? `sin ${m.excluidas.join(', ')}` : ''
  const partes = conPin
    ? [`${m.marcados.map(x => x.nombre).join(' · ')}${radioMas}`, sin]
    : [m.lugares.join(' · '), m.radio ? `radio ${m.radio}` : '', sin, m.limites ? `límites: ${m.limites}` : '']
  const texto = partes.filter(Boolean).join(' · ')
  if (!texto) return null
  return texto + (m.coincide ? (m.parcial ? ' (se lee en parte: confirmarlo)' : '') : ' (revisar: no coincide del todo con lo dicho)')
}

// ── Ideas y revisión ──
const RE_GANADOR = /\bG(\d{1,2})\b/g
const ganadoresCitados = (t: string): string[] => [...new Set([...t.matchAll(RE_GANADOR)].map(m => `G${Number(m[1])}`))]

/** Las ideas a mostrar: las de la ficha o, si la fila quedó a medias, las que ya se guardaron en la columna ideas. */
function ideasDe(fila: Pick<FilaFichaCliente, 'estado' | 'ideas'>, f: FichaKickoff): { ideas: IdeasFicha; ganadores: GanadoresFicha | null; desdeRegistro: boolean } {
  const propias = obj(f.ideas_guiones) as Partial<IdeasFicha>
  const guardadas = obj(obj(fila.ideas).ideas) as Partial<IdeasFicha>
  const ganadoresGuardados = obj(fila.ideas).ganadores
  const sinPedir = (propias.estado ?? 'no_corresponde') === 'no_corresponde' && f.tipo_reunion === 'kickoff'
  if (fila.estado !== 'lista' && sinPedir && arr(guardadas.ideas).length) {
    return {
      ideas: { estado: (guardadas.estado as EstadoIdeas) ?? 'a_revisar', revisores: arr(guardadas.revisores).map(str), ideas: arr(guardadas.ideas) as IdeasFicha['ideas'], notas: str(guardadas.notas) },
      ganadores: ganadoresGuardados && typeof ganadoresGuardados === 'object' ? (ganadoresGuardados as GanadoresFicha) : null,
      desdeRegistro: true,
    }
  }
  return {
    ideas: { estado: (propias.estado as EstadoIdeas) ?? 'no_corresponde', revisores: arr(propias.revisores).map(str), ideas: arr(propias.ideas) as IdeasFicha['ideas'], notas: str(propias.notas), motivo: strONull(propias.motivo) ?? undefined },
    ganadores: null,
    desdeRegistro: false,
  }
}

const QUE_PASO = { aprobada: 'Aprobó', cambios: 'Pidió cambios' } as const

function revisores(revision: unknown, huella: string, hayIdeas: boolean): RevisorVista[] {
  const r = leerRevision(revision)
  return CLAVES_REVISOR.map((k): RevisorVista => {
    const x = r[k]
    const historial = (x?.historial ?? []).map(p => {
      const cuando = fechaCortaAR(p.cuando)
      return `${QUE_PASO[p.estado]}${cuando ? ` el ${cuando}` : ''}${p.comentario ? `: «${taparMails(p.comentario)}»` : ''}${p.huella && p.huella !== huella ? ' (sobre otra versión de las ideas)' : ''}`
    })
    const base = { clave: k, nombre: NOMBRE_REVISOR[k], previo: x?.cuando ?? null, historial }
    if (!x || x.estado === 'pendiente') return { ...base, estado: 'pendiente', comentario: '', cuandoTexto: null, anterior: null }
    const cuandoTexto = fechaCortaAR(x.cuando)
    // Una revisión sin huella o de otras ideas (el bot las rehizo) no cuenta: queda a la vista como "anterior"
    if (!hayIdeas || x.huella !== huella) {
      const que = x.estado === 'aprobada' ? 'aprobó' : 'pidió cambios sobre'
      return { ...base, estado: 'pendiente', comentario: '', cuandoTexto: null, anterior: `${que} otra versión de las ideas${cuandoTexto ? ` (${cuandoTexto})` : ''}` }
    }
    return { ...base, estado: x.estado, comentario: taparMails(x.comentario), cuandoTexto, anterior: null }
  })
}

export function estadoGeneral(rs: RevisorVista[], hayIdeas: boolean): { general: EstadoGeneralIdeas; texto: string } {
  if (!hayIdeas) return { general: 'sin_ideas', texto: 'No hay ideas para revisar.' }
  const con = (e: RevisorVista['estado']) => rs.filter(r => r.estado === e).map(r => r.nombre)
  const cambios = con('cambios'), aprobaron = con('aprobada'), faltan = con('pendiente')
  const y = (xs: string[]) => xs.join(' y ')
  if (cambios.length) return { general: 'cambios', texto: `${y(cambios)} pidi${cambios.length > 1 ? 'eron' : 'ó'} cambios${aprobaron.length ? ` · aprob${aprobaron.length > 1 ? 'aron' : 'ó'} ${y(aprobaron)}` : ''}${faltan.length ? ` · falta ${y(faltan)}` : ''}.` }
  if (!faltan.length) return { general: 'aprobadas', texto: `Aprobadas por ${y(aprobaron)}.` }
  if (aprobaron.length) return { general: 'a_medias', texto: `Aprobó ${y(aprobaron)}; falta ${y(faltan)}.` }
  return { general: 'pendiente', texto: `Falta que las revisen ${y(faltan)}.` }
}

// ── Ganadores ──
const ESTADO_GANADORES: Record<string, string> = {
  ok: 'Listos', pocos_datos: 'Pocos datos (menos de 3)', sin_datos: 'Sin datos en Meta', error: 'Meta no respondió', sin_rama: 'Sin rama: no se buscaron',
  no_pedido: 'No se pidieron',
}
/** La nota de las fichas de antes del 24/10 decía "4 de otro país que AR afuera". */
const notaGanadores = (t: string): string => t
  .replace(/(\d+) de otro país que ([A-Z]{2}) \((\d+) usados para completar, marcados\)/, '$1 de otro país (no $2): $3 usados para completar, marcados')
  .replace(/(\d+) de otro país que ([A-Z]{2}) afuera/, '$1 de otro país (no $2) quedaron afuera')

// ── Encabezado y estado de la fila ──
function registroDe(fila: Pick<FilaFichaCliente, 'estado' | 'error' | 'recording_id'>, tipo: TipoReunion): VistaKickoff['registro'] {
  const e = fila.estado
  if (e === 'lista') return { estado: e, aviso: null, tono: 'verde', etiqueta: 'Lista' }
  if (e === 'no_kickoff') return { estado: e, aviso: `Claude la clasificó como «${tipo}», no como kickoff: no se pidieron ideas ni se chequeó el portfolio en Meta. Si era un kickoff, hay que reprocesarla.`, tono: 'gris', etiqueta: 'No es kickoff' }
  if (e === 'procesando') return { estado: e, aviso: 'El bot todavía la está armando: lo que se ve es la ficha base (sin el portfolio de Meta ni el aviso). Recargá en un par de minutos.', tono: 'amarillo', etiqueta: 'Procesando' }
  if (e === 'error') {
    const motivo = str(fila.error).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 240)
    return { estado: e, aviso: `El bot no terminó esta ficha${motivo ? ` (${motivo})` : ''}. Lo que se ve es lo que alcanzó a guardar. Para reintentar, pedile a Claude que reintente el kickoff ${fila.recording_id}.`, tono: 'rojo', etiqueta: 'Con error' }
  }
  return { estado: e, aviso: null, tono: 'gris', etiqueta: e }
}

const COMO: Record<string, string> = { email: 'cruzado con el CRM por el mail del invitado', claude: 'cruzado con el CRM por nombre' }
const sinParentesis = (t: string) => t.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || t

/**
 * La ficha de una fila, lista para la pantalla. null = la fila no tiene una ficha legible. `ahoraMs`: para dar por cortada
 * una lectura del mapa que quedó colgada (por defecto, ahora).
 */
export function armarVista(fila: FilaFichaCliente, ahoraMs: number = Date.now()): VistaKickoff | null {
  if (!esFichaKickoff(fila.ficha)) return null
  // La lectura del mapa: la de la columna (manda) o, si no hay, la que trae la ficha
  const zv = zonaVideoVigente(leerZonaVideo(fila.zona_video) ?? leerZonaVideo(fila.ficha.zona_video), ahoraMs)
  const f = zv ? conZonaVideo(fila.ficha, zv) : fila.ficha
  const url = urlFathom(f.url) ?? urlFathom(fila.url)
  const tipo: TipoReunion = (TIPOS_REUNION as readonly string[]).includes(f.tipo_reunion) ? f.tipo_reunion : 'otra'
  const esKickoff = tipo === 'kickoff'
  const cli = obj(f.cliente)
  const crm = strONull(cli.cliente_crm)
  const grabo = obj(f.grabo)
  const fechaIso = strONull(f.fecha)

  // Portfolio (la fusión es la de la ficha; los tildes, de la columna)
  const checks = leerChecks(fila.portfolio_checks)
  const final = portfolioFinalDe(f)
  const filas = ITEMS_PORTFOLIO.map(k => filaPortfolio(k, final[k], f, url, checks[k]))
  const okVistos = filas.filter(x => x.visto.estado === 'ok').length
  const aTildar = filas.filter(x => x.tildable && !x.check).length, tildados = filas.filter(x => x.tildable && x.check).length
  const resumen = {
    ok: okVistos, total: filas.length, aTildar, tildados,
    texto: `${okVistos} de ${filas.length} ok${aTildar ? ` · ${aTildar} para tildar a mano` : ''}${tildados ? ` · ${tildados} tildado${tildados > 1 ? 's' : ''} a mano` : ''}`,
  }

  // Ideas, revisión y ganadores
  const { ideas, ganadores: ganadoresFila, desdeRegistro } = ideasDe(fila, f)
  const lista: IdeaVista[] = ideas.ideas.map((x, i) => {
    const o = obj(x)
    const porQue = str(o.por_que)
    return { n: i + 1, titulo: str(o.titulo), gancho: str(o.gancho), angulo: str(o.angulo), subrama: str(o.subrama), por_que: porQue, ganadores: ganadoresCitados(porQue) }
  }).filter(x => x.titulo || x.gancho)
  const hayIdeas = esKickoff && lista.length > 0
  const huella = huellaIdeas(lista)
  const rs = revisores(fila.revision, huella, hayIdeas)
  const general = estadoGeneral(rs, hayIdeas)
  const g = obj(ganadoresFila ?? f.ganadores)
  const ganadores: GanadorVista[] = arr(g.lista).map(x => {
    const o = obj(x)
    const id = str(o.id)
    return {
      id, anuncio: str(o.anuncio), subtema: str(o.subtema), pais: strONull(o.pais),
      cplUSD: numONull(o.cplUSD) ?? 0, mensajes: numONull(o.mensajes) ?? 0, gastoUSD: numONull(o.gastoUSD) ?? 0,
      ideas: lista.filter(i => i.ganadores.includes(id)).map(i => i.n),
    }
  }).filter(x => x.id)

  const rama = obj(f.rama), zona = obj(f.zona), pres = obj(f.presupuesto), pc = f.zona?.presentarse_como as unknown
  const principal = esRama(rama.principal) ? NOMBRE_RAMA[rama.principal] : null
  const presentarse = pc && typeof pc === 'object' && str(obj(pc).texto)
    ? { ...datoDe(pc, url), cuando: str(obj(pc).cuando) }
    : typeof pc === 'string' && str(pc) ? { texto: str(pc), cita: null, textual: false, momento: null, cuando: '' } : null
  const presupuestoTexto = (() => {
    try { return textoPresupuesto(f.presupuesto) } catch { return str(pres.texto) || 'sin definir' }
  })()
  // El avatar: el contexto del mercado ("contexto de la zona: …") no es un filtro: va aparte
  const excluyeTodo = datos(obj(f.avatar).excluye, url)
  const esContexto = (d: DatoVista) => /^contexto\b/i.test(d.texto)
  const avatar = { incluye: datos(obj(f.avatar).incluye, url), excluye: excluyeTodo.filter(d => !esContexto(d)), contexto: excluyeTodo.filter(esContexto) }

  // Faltantes (con las marcas) y lo que hace falta para lanzar
  const marcas = leerMarcas(fila.faltantes_checks)
  const { faltantes, hechos } = esKickoff ? separarFaltantes(faltantesConChecks(f, filas), marcas, f, url) : { faltantes: [], hechos: [] }
  const meta = (f.portfolio_meta ?? null) as PortfolioMetaFicha | null
  const lugares = arr(zona.lugares).map(str).filter(Boolean)
  const acuerdos = arr(f.acuerdos).map(x => {
    const o = obj(x)
    return { quien: str(o.quien), que: str(o.que), cuando: strONull(o.cuando), dato: datoDe(o, url, str(o.que)) }
  }).filter(a => a.que)
  const mapaVideo = esKickoff && (zona.mapa_en_pantalla === true || zv?.estado === 'ok') ? mapaVideoVista(zv, url, fila.recording_id) : null
  // El recorte anotado a mano: el de lo que pidió el mapa leído (revisar / confirmar) o, si no, el de "anotar"
  const notaMapa = marcas.zona_mapa_video?.nota || marcas.zona_mapa?.nota || ''
  const lanzar: ParaLanzarVista = {
    cuenta: meta?.cuenta ? `${meta.cuenta}${meta.nombre ? ` («${str(meta.nombre)}»)` : ''}` : null,
    monedaHora: meta ? monedaYHora(meta) : '',
    pagina: final.pagina_facebook.estado === 'ok' ? str(final.pagina_facebook.detalle) || null : null,
    presupuesto: presupuestoTexto,
    zona: {
      texto: [lugares.length ? lugares.map(sinParentesis).join(' · ') : str(zona.descripcion), numONull(zona.radio_km) !== null ? `radio ${zona.radio_km} km` : '',
        presentarse ? `se presenta como «${presentarse.texto}»` : ''].filter(Boolean).join(' · ') || 'sin definir',
      momento: zona.mapa_en_pantalla === true || mapaVideo?.momento ? mapaVideo?.momento ?? momentoDe(zona, url) : null,
      nota: notaMapa ? taparMails(notaMapa) : null,
      video: recorteSegunVideo(mapaVideo),
      // Lo que pide el mapa leído sigue sin revisar (aunque haya una nota del recorte de antes): Valentino tiene que verlo
      revisar: faltantes.some(x => x.clave === 'zona_mapa_video'),
      leyendo: !!mapaVideo?.leyendo,
    },
    avatar: [...avatar.incluye.map(d => sinParentesis(d.texto)), ...(avatar.excluye.length ? [`afuera: ${avatar.excluye.map(d => sinParentesis(d.texto).replace(/^nada de\s+/i, '')).join(' · ')}`] : [])].join(' · ') || 'sin filtros',
    ideas: general.texto,
    lanzamiento: renglonLanzamiento(acuerdos),
    datos: CLAVES_DATO.map(k => ({ clave: k, nombre: NOMBRE_DATO[k], marca: marcaVista(marcas[k]) })),
  }

  return {
    recording_id: fila.recording_id,
    registro: registroDe(fila, tipo),
    encabezado: {
      cliente: crm ?? (str(cli.nombre_escuchado) || 'Cliente sin nombre'),
      verificado: !!crm,
      idCrm: strONull(cli.id_crm),
      apodo: strONull(cli.apodo),
      como: COMO[str(cli.como)] ?? 'sin verificar en el CRM',
      titulo: str(f.titulo) || str(fila.titulo),
      fecha: fechaCortaAR(fechaIso),
      fechaIso,
      quien: strONull(grabo.quien) ?? strONull(grabo.nombre),
      fathom: url,
      resumen: str(f.resumen_corto),
      tipo,
      esKickoff,
      corte: (() => { try { return notaCorteGrabacion(f) } catch { return null } })(),
    },
    faltantes,
    hechos,
    lanzar,
    rama: {
      principal, texto: str(rama.texto), dato: datoDe(rama, url, str(rama.texto)),
      subramas: datos(rama.subramas, url),
      descartadas: arr(rama.descartadas).map(x => ({ ...datoDe(x, url), motivo: str(obj(x).motivo) })).filter(d => d.texto),
      aFuturo: datos(rama.a_futuro, url),
    },
    avatar,
    zona: {
      descripcion: datoDe(zona, url, str(zona.descripcion)),
      lugares,
      radioKm: numONull(zona.radio_km),
      presentarse,
      contexto: datos(zona.contexto, url),
      pais: strONull(zona.pais),
      mapa: zona.mapa_en_pantalla === true,
      mapaMomento: zona.mapa_en_pantalla === true ? momentoDe(zona, url) : null,
      video: mapaVideo,
    },
    presupuesto: {
      texto: presupuestoTexto,
      certeza: pres.certeza === 'confirmado' ? 'Confirmado' : 'A confirmar',
      deducido: pres.deducido === true,
      acordado: str(pres.texto),
      moneda: strONull(pres.moneda),
      dato: datoDe(pres, url, presupuestoTexto),
      mes: pres.evidencia_mes && typeof pres.evidencia_mes === 'object' ? datoDe(pres.evidencia_mes, url, 'El mensual se dijo aparte') : null,
    },
    portfolio: { filas, resumen, meta: lineasMeta(meta) },
    acuerdos,
    pendientes: arr(f.pendientes).map(str).filter(Boolean),
    ideas: {
      estado: ideas.estado, motivo: strONull(ideas.motivo), notas: ideas.notas, lista, huella,
      revisores: rs, ...general, desdeRegistro,
    },
    ganadores: {
      estado: str(g.estado) || 'no_pedido', estadoTexto: ESTADO_GANADORES[str(g.estado) || 'no_pedido'] ?? str(g.estado),
      nota: notaGanadores(str(g.nota)), ventana: strONull(g.ventana), lista: ganadores,
    },
    ajustes: arr(f.ajustes).map(str).filter(Boolean),
  }
}

// ── Cuál se muestra y el selector ──
const fechaDe = (f: FilaFichaCliente): string => (esFichaKickoff(f.ficha) && typeof f.ficha.fecha === 'string' ? f.ficha.fecha : '') || f.creado
const esKickoffFila = (f: FilaFichaCliente) => esFichaKickoff(f.ficha) && f.ficha.tipo_reunion === 'kickoff'

/** De la más nueva a la más vieja, por la fecha de la grabación (o la de la fila). */
export const ordenarFilas = (filas: FilaFichaCliente[]): FilaFichaCliente[] =>
  [...filas].sort((a, b) => Date.parse(fechaDe(b)) - Date.parse(fechaDe(a)) || b.recording_id - a.recording_id)

/** La que se muestra: la pedida (?grabacion=<recording_id>) si es de este cliente; si no, el último kickoff; si no hay, la última. */
export function elegirFila(filas: FilaFichaCliente[], pedido?: string | string[] | null): FilaFichaCliente | null {
  const legibles = ordenarFilas(filas.filter(f => esFichaKickoff(f.ficha)))
  const p = Array.isArray(pedido) ? pedido[0] : pedido
  if (p && /^\d{1,15}$/.test(p)) {
    const una = legibles.find(f => f.recording_id === Number(p))
    if (una) return una
  }
  return legibles.find(esKickoffFila) ?? legibles[0] ?? null
}

/** Las opciones del selector (solo si hay más de una ficha legible): fecha, tipo y quién la hizo. */
export function opcionesFichas(filas: FilaFichaCliente[], elegida: FilaFichaCliente | null): OpcionFicha[] {
  const legibles = ordenarFilas(filas.filter(f => esFichaKickoff(f.ficha)))
  if (legibles.length < 2) return []
  return legibles.map(f => {
    const ficha = f.ficha as FichaKickoff
    const fecha = fechaCortaAR(fechaDe(f)) ?? 'sin fecha'
    const quien = str(obj(ficha.grabo).quien)
    // "Fathom de": si los dos la grabaron gana la que llegó primero, que no es necesariamente la de quien llevó la llamada
    const que = ficha.tipo_reunion === 'kickoff' ? `kickoff${quien ? ` (Fathom de ${quien})` : ''}` : `${ficha.tipo_reunion} (no es kickoff)`
    const estado = f.estado === 'lista' || f.estado === 'no_kickoff' ? '' : f.estado === 'error' ? ' · con error' : ` · ${f.estado}`
    return { recording_id: f.recording_id, etiqueta: `${fecha} · ${que}${estado}`, actual: f.recording_id === elegida?.recording_id }
  })
}

// Los nombres de las cuentas de Fathom (los de GRABADORES de grabadores.ts, sin cargar la firma de los webhooks)
const NOMBRE_CUENTA: Record<Quien, string> = { tomas: 'Tomás', gero_m: 'Gero M' }

/** Las otras grabaciones de la misma reunión (registro.gemelasDe), para la cabecera: quién la grabó y el link a Fathom. */
export function gemelasVista(xs: readonly { recording_id: number; url: string | null; grabador: Quien | null }[]): GemelaVista[] {
  return xs.filter(x => Number.isSafeInteger(x.recording_id) && x.recording_id > 0)
    .map(x => ({ recording_id: x.recording_id, quien: x.grabador ? NOMBRE_CUENTA[x.grabador] : 'el otro Fathom', fathom: urlFathom(x.url) }))
}

/** ¿Se puede tildar a mano ese ítem en esa fila? (lo usa la API antes de escribir: misma regla que la pantalla) */
export function itemTildable(v: VistaKickoff, item: ItemPortfolio): boolean {
  return v.encabezado.esKickoff && !!v.portfolio.filas.find(x => x.item === item)?.tildable
}

/** El `cuando` del tilde guardado de un ítem (la marca para escribir con condición). */
export const previoCheck = (v: VistaKickoff, item: ItemPortfolio): string | null => v.portfolio.filas.find(x => x.item === item)?.check?.cuando ?? null

/** ¿Se puede marcar esa clave en esa fila? Un dato de lanzamiento, siempre en un kickoff; un faltante, si la ficha lo tiene. */
export function claveMarcable(v: VistaKickoff, clave: ClaveMarca): boolean {
  if (!v.encabezado.esKickoff) return false
  return (CLAVES_DATO as readonly string[]).includes(clave) || [...v.faltantes, ...v.hechos].some(x => x.clave === clave)
}
