// ── Kickoff (Fathom → ficha del cliente): tipos ───────────────────────────────────────────────
// Después de la llamada de kickoff (la hacen Tomás o Gero M, cada uno con su Fathom), Claude arma la "ficha de kickoff" del cliente:
// reemplaza la tarjeta de ClickUp "Seguimiento de Anuncios" (decisión de Tomás, 24/10/2026). Vive en la base del Despacho
// (Neon, tabla cj_kickoffs, ver registro.ts), NO en columnas del CRM de Clientes.
// Todo dato que sale de la llamada lleva su evidencia: cita textual (hasta 25 palabras) y timestamp HH:MM:SS validado contra
// la transcripción (igual que lib/fathomAnuncios). Un timestamp mal formado o fuera de la llamada queda en null (sin link,
// no se adivina "el más cercano"); una cita que no aparece tal cual en la transcripción queda marcada textual: false. Como
// Fathom junta renglones de hasta 2 minutos, además se estima (aprox) el segundo de la cita dentro de su renglón para el link.
// El payload de Fathom es el mismo que usa /api/fathom-anuncios: se reusan su tipo y su validación (lib/fathomAnuncios/tipos).
import { NOMBRE_RAMA, type Rama } from '@/lib/anuncios/ramas'
import type { Quien } from './grabadores'
import type { BloqueMapaZona, ZonaVideoFicha } from './mapa-zona'

export type { ReunionFathom } from '@/lib/fathomAnuncios/tipos'
export type { Rama }

export const RAMAS = Object.keys(NOMBRE_RAMA) as Rama[]
export const esRama = (x: unknown): x is Rama => typeof x === 'string' && (RAMAS as string[]).includes(x)

// ── Qué fue la llamada (el título "X y Tomas Napolitano" es igual para kickoffs y seguimientos: decide Claude) ──
export const TIPOS_REUNION = ['kickoff', 'seguimiento', 'venta', 'equipo', 'otra'] as const
export type TipoReunion = (typeof TIPOS_REUNION)[number]

export type Certeza = 'confirmado' | 'a_confirmar'

/** Lo que respalda un dato: la cita textual y el momento de la grabación. */
export interface Evidencia {
  cita: string                    // hasta 25 palabras; '' = no hay
  timestamp: string | null        // HH:MM:SS dentro de la llamada; null = no vino o vino mal (va sin link)
  textual: boolean                // la cita aparece tal cual (normalizada) en la transcripción
  aprox?: string | null           // HH:MM:SS estimado de la cita dentro de su renglón (link con "≈"); null = el del renglón
}
export interface ItemConEvidencia extends Evidencia { texto: string }

// ── Portfolio (lista FIJA: lo que se revisa en el kickoff; lo que no se habló lo tilda Tomi a mano) ──
export const ITEMS_PORTFOLIO = [
  'instagram', 'whatsapp_business', 'pagina_facebook', 'portfolio_comercial', 'tarjeta', 'verificacion', 'accesos_equipo',
] as const
export type ItemPortfolio = (typeof ITEMS_PORTFOLIO)[number]
// El equipo que tiene que tener acceso a la cuenta publicitaria / portfolio del cliente (mails de trabajo, no secretos).
// UNA sola lista: de acá salen los mails del prompt (MAILS_ACCESOS_EQUIPO), el nombre del ítem y el chequeo de Meta
// (portfolio.ts le suma a cada uno cómo reconocerlo por nombre en Graph y qué token es suyo). «Gero A» = Gerónimo Actis
// (media buyer); no confundir con Gero M (Gerónimo Mozzi), que revisa las ideas.
export const EQUIPO_ACCESOS_BASE = [
  { clave: 'gero_a', quien: process.env.KICKOFF_EQUIPO_GERO_A_NOMBRE?.trim() || 'Gero A', corto: 'Gero A', mail: process.env.KICKOFF_EQUIPO_GERO_A_EMAIL?.trim() ?? '' },
  { clave: 'valentino', quien: process.env.KICKOFF_EQUIPO_VALENTINO_NOMBRE?.trim() || 'Valentino', corto: 'Valentino', mail: process.env.KICKOFF_EQUIPO_VALENTINO_EMAIL?.trim() ?? '' },
] as const
export type ClaveEquipo = (typeof EQUIPO_ACCESOS_BASE)[number]['clave']
export const MAILS_ACCESOS_EQUIPO: readonly string[] = EQUIPO_ACCESOS_BASE.map(m => m.mail).filter(Boolean)
export const NOMBRE_ITEM_PORTFOLIO: Record<ItemPortfolio, string> = {
  instagram: 'Instagram',
  whatsapp_business: 'WhatsApp Business',
  pagina_facebook: 'Página de Facebook',
  portfolio_comercial: 'Portfolio comercial (Business Portfolio de Meta)',
  tarjeta: 'Tarjeta (medio de pago de la cuenta publicitaria)',
  verificacion: 'Verificación / resumen de la cuenta',
  accesos_equipo: `Accesos del equipo (${EQUIPO_ACCESOS_BASE.map(m => m.corto).join(' y ')})`,
}
// Lo que dijo la llamada (el enum del schema de Claude: NO lleva 'sin_dato', que es de Meta). sin_verificar: se mencionó
// (un consejo, "tenela cargada") pero no se comprobó en la llamada. no_se_hablo: ni se mencionó.
export const ESTADOS_PORTFOLIO = ['ok', 'falta', 'problema', 'sin_verificar', 'no_se_hablo'] as const
export type EstadoPortfolio = (typeof ESTADOS_PORTFOLIO)[number]
export interface ChequeoPortfolio extends Evidencia { estado: EstadoPortfolio; detalle: string }

// ── Portfolio final de la ficha: lo que vio Meta (portfolio.ts, solo GET) cruzado con lo que se dijo en la llamada ──
// UNA sola verdad: combinarPortfolio (portfolio.ts) arma portfolio_final; los faltantes, el markdown y el aviso leen de ahí.
// Manda Meta salvo que diga 'sin_dato'; ahí queda lo de la llamada ('ok' / 'falta' / 'problema'); si la llamada tampoco lo
// resolvió (sin_verificar o no_se_hablo) → 'sin_dato' con fuente 'ninguna': lo tilda Tomi a mano.
export type EstadoPortfolioFinal = 'ok' | 'falta' | 'problema' | 'sin_dato'
export type FuentePortfolio = 'meta' | 'llamada' | 'ninguna'
export type MotivoSinLecturaMeta = 'sin_cuenta' | 'sin_acceso' | 'token_invalido' | 'limite' | 'timeout' | 'sin_token' | 'error'
export interface ItemPortfolioFinal {
  estado: EstadoPortfolioFinal
  detalle: string                 // el de la fuente que ganó, con " · ojo: …" si la otra dijo otra cosa
  fuente: FuentePortfolio         // de dónde salió el estado ('ninguna' = ni Meta ni la llamada: tildar a mano)
  meta: { estado: EstadoPortfolioFinal; detalle: string } | null   // null = Meta no se consultó
  llamada: { estado: 'ok' | 'falta' | 'problema' | 'sin_verificar'; detalle: string; cita: string; timestamp: string | null; textual: boolean } | null
  discrepancia: string | null     // la llamada dijo otra cosa que Meta (gane quien gane, queda anotado)
}
/** La cabecera del chequeo de Meta que queda en la ficha (los 7 ítems de Meta van dentro de portfolio_final[k].meta). */
export interface PortfolioMetaFicha {
  cuenta: string | null           // act_… revisada; null = no se encontró la cuenta del cliente
  nombre: string | null           // nombre de la cuenta publicitaria
  leido: boolean                  // se pudo leer la cuenta
  motivo: MotivoSinLecturaMeta | null
  aviso: string | null            // qué hacer: cargar la cuenta en "Cuentas Meta", pedir accesos, renovar el token, reintentar
  generado: string                // ISO del chequeo
  origen_cuenta: 'crm' | 'descubrimiento' | null   // de dónde salió la cuenta (a Laura, A157, solo la encuentra el descubrimiento)
  // De la cuenta (currency, timezone_name; desde el 24/10: faltan en las fichas anteriores). Si la moneda no es la del
  // presupuesto, ficha.ts suma un faltante (pasar los USD por día a la moneda de la cuenta)
  moneda?: string | null
  zona_horaria?: string | null
}
/** Lo que recibe armarFicha: la cabecera + los 7 ítems de Meta (paraFicha() de portfolio.ts, sin lo crudo de Graph). */
export interface LecturaPortfolioMeta extends PortfolioMetaFicha {
  items: Record<ItemPortfolio, { estado: EstadoPortfolioFinal; detalle: string; debil?: boolean }>
}

// ── Quién hizo la kickoff (recorded_by del payload de Fathom): la hacen Tomás y Gero M, cada uno con su Fathom ──
export type QuienKickoff = 'Tomás' | 'Gero M'
export interface GraboKickoff {
  nombre: string | null           // como figura en Fathom ("Tomas Napolitano")
  email: string | null
  quien: QuienKickoff | null      // reconocido por nombre o mail (o, si no alcanza, por la cuenta que firmó); null = otra persona
  cuenta_fathom?: Quien | null    // la cuenta de Fathom que firmó el webhook (columna grabador): su API key baja el video
}

// ── La ficha ──
export interface ClienteFicha {
  nombre_escuchado: string
  apodo: string | null            // cómo lo llaman en la llamada ("Cris"): sirve para entender "la carpeta de Cris"
  cliente_crm: string | null      // solo si está en la lista del CRM (validado en extraer.ts); null = "sin verificar"
  id_crm: string | null           // A0xx / C0xx si se pudo cruzar
  email: string | null            // mail del invitado externo de Fathom
  como: 'claude' | 'email' | null // cómo se cruzó con el CRM (email = coincidencia exacta con el mail del invitado)
  cuentas: string[]               // cuentas publicitarias del cliente según el CRM ("Cuentas Meta" y AJUSTES_CUENTA)
}
export interface RamaFicha extends Evidencia {
  principal: Rama | null          // una clave de lib/anuncios/ramas.ts; null = no se definió o no está en la lista
  texto: string                   // "Laboral: despidos"
  subramas: ItemConEvidencia[]    // solo el tema ("despidos", "despido después de un accidente"): los filtros van en avatar
  descartadas: (ItemConEvidencia & { motivo: string })[]
  a_futuro: ItemConEvidencia[]    // "Familia, cuando laboral funcione"
}
export interface AvatarFicha { incluye: ItemConEvidencia[]; excluye: ItemConEvidencia[] }
/** Cómo se presenta el abogado y en qué contexto se dijo ("si un lead pregunta", "en los anuncios"), con su propia cita. */
export interface PresentacionZona extends Evidencia { texto: string; cuando: string }
export interface ZonaFicha extends Evidencia {
  descripcion: string
  lugares: string[]
  radio_km: number | null
  presentarse_como: PresentacionZona | null
  contexto: ItemConEvidencia[]    // lo que no es límite de la zona: dónde está el estudio, a qué distancia, si acepta viajar
  pais: string | null             // ISO de 2 letras (AR, UY…): los ganadores de Meta se eligen del mismo país
  mapa_en_pantalla: boolean       // se marcó en un mapa compartido en pantalla: el recorte exacto no está en la transcripción
  // Lo que se leyó del VIDEO (mapa.ts, tarea c03): no sale de Claude-ficha, lo suma conZonaVideo (ficha.ts) desde la columna
  // zona_video. Falta en las fichas viejas y mientras no se leyó.
  mapa?: BloqueMapaZona | null
}
export interface PresupuestoFicha extends Evidencia {
  usd_dia_min: number | null
  usd_dia_max: number | null
  usd_mes: number | null
  moneda: string | null           // la moneda en que se acordó ('USD', 'ARS'…)
  texto: string                   // tal como se acordó ("USD 8 a 10 por día, unos 240 por mes")
  deducido: boolean               // algún monto se dedujo (de Claude o calculado acá) en vez de decirse
  certeza: Certeza
  evidencia_mes: Evidencia | null // el renglón donde se dijo el mensual, si fue aparte del diario
}
export interface Acuerdo extends Evidencia { quien: string; que: string; cuando: string | null }

export interface IdeaGuion {
  titulo: string
  gancho: string                  // la primera frase del video, como la diría el abogado
  angulo: string
  subrama: string
  por_que: string                 // en qué ganador (G1…) o ejemplo de la base se apoya
}
export type EstadoIdeas = 'a_revisar' | 'sin_ideas' | 'no_corresponde'
export interface IdeasFicha {
  estado: EstadoIdeas
  revisores: string[]             // Tomi y Gero M
  ideas: IdeaGuion[]
  notas: string
  motivo?: string                 // por qué no hay (no_corresponde / sin_ideas)
}

// Un anuncio ganador de la misma rama (de OTRO cliente): referencia interna para Tomi y Gero M, nunca para el cliente nuevo
export interface Ganador {
  id: string                      // 'G1', 'G2'… (así lo cita el prompt de ideas)
  anuncio: string                 // nombre del anuncio = gancho del guion
  copy: string | null             // texto del anuncio, recortado
  subtema: string
  cplUSD: number
  mensajes: number
  gastoUSD: number
  pais: string | null             // de la moneda y del nombre de las campañas de la cuenta; null = sin dato
  cliente: string                 // solo en el JSON (no va a Discord ni al markdown ni a Claude)
  cuentaId: string
}
export type EstadoGanadores = 'ok' | 'pocos_datos' | 'sin_datos' | 'error' | 'sin_rama' | 'no_pedido'
export interface GanadoresFicha { estado: EstadoGanadores; nota: string; lista: Ganador[]; ventana: string | null }

export interface FichaKickoff {
  version: 1
  recording_id: number
  titulo: string
  url: string
  fecha: string | null            // inicio de la grabación (ISO)
  tipo_reunion: TipoReunion
  resumen_corto: string
  cliente: ClienteFicha
  rama: RamaFicha
  avatar: AvatarFicha
  zona: ZonaFicha
  presupuesto: PresupuestoFicha
  portfolio: Record<ItemPortfolio, ChequeoPortfolio>   // lo de la LLAMADA (Claude), tal cual
  acuerdos: Acuerdo[]
  pendientes: string[]
  faltantes: string[]             // lo que tiene que completar Tomi: lo calcula ficha.ts (nunca Claude)
  ideas_guiones: IdeasFicha
  ganadores: GanadoresFicha
  ajustes: string[]               // qué se corrigió de lo que devolvió Claude
  fin_grabacion?: string | null   // ISO: si terminó bastante antes de lo agendado, puede faltar algo (va a faltantes)
  fin_agendado?: string | null    // ISO: fin del evento del calendario (scheduled_end_time del payload de Fathom)
  // Los tres de abajo NO salen de Claude (van al Omit de la extracción) y faltan en las fichas guardadas antes del 24/10:
  // quien lea una ficha de la base tiene que tolerarlos ausentes (portfolioFinalDe() de ficha.ts lo resuelve).
  grabo?: GraboKickoff | null     // quién hizo la kickoff (Tomás o Gero M)
  portfolio_meta?: PortfolioMetaFicha | null   // null = Meta no se consultó (ficha vieja o no es kickoff)
  portfolio_final?: Record<ItemPortfolio, ItemPortfolioFinal>
  // La lectura del mapa desde el video (estado, motivo, versión, download_id, tokens). La que manda es la de la COLUMNA
  // zona_video de cj_kickoffs (la escribe /api/bot/kickoff/mapa después de que la ficha quedó lista); acá queda la que se
  // conocía al armar la ficha.
  zona_video?: ZonaVideoFicha | null
}

/** La extracción ya validada (todo lo de la ficha que sale de Claude, sin faltantes ni ideas). */
export type ExtraccionKickoff = Omit<FichaKickoff, 'version' | 'recording_id' | 'titulo' | 'url' | 'fecha' | 'faltantes' | 'ideas_guiones' | 'ganadores' | 'ajustes' | 'fin_grabacion' | 'fin_agendado' | 'grabo' | 'portfolio_meta' | 'portfolio_final' | 'zona_video'>

export interface Uso { input_tokens: number; output_tokens: number }
export interface ResultadoExtraccionKickoff { extraccion: ExtraccionKickoff; ajustes: string[]; modelo: string; usage: Uso }
export interface ResultadoIdeas { ideas: IdeaGuion[]; notas: string; ajustes: string[]; modelo: string; usage: Uso }

// ── Contexto del CRM (con los IDs: A0xx) ──
export interface ClienteCRMKickoff { id: string; nombre: string; estado: string; email: string; cuentas: string[] }
export interface ContextoKickoff { clientes: ClienteCRMKickoff[]; estado: 'ok' | 'sin_crm'; aviso?: string }

// ── Registro (tabla cj_kickoffs) ──
// duplicada (24/10): la misma kickoff grabada por los dos (Tomás y Gero M) llega con otro recording_id; la segunda queda así,
// con duplicada_de = la primera, sin Claude ni aviso.
export type EstadoRegistro = 'procesando' | 'lista' | 'no_kickoff' | 'omitida' | 'error' | 'duplicada'
/** El motivo de error de una grabación que llegó sin transcripción (el webhook de esa cuenta no tiene Transcript). */
export const PREFIJO_SIN_TRANSCRIPCION = 'sin_transcripcion:'
export const REVISORES = ['Tomi', 'Gero M'] as const
