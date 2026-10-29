// ── Ficha de kickoff: armado, faltantes y vista para revisar (puro, sin red) ───────────────────────
// Recibe las salidas YA validadas (extraer.ts, ideas.ts, ganadores.ts) y arma la FichaKickoff que se guarda en cj_kickoffs.
//   · normalizarRama: lo que diga Claude ("Laboral", "tránsito", "ART / accidentes de trabajo") → una clave de Rama de
//     lib/anuncios/ramas.ts, o null. No se usa clasificarRama sobre texto libre: una rama mal adivinada es peor que ninguna.
//   · normalizarPresupuesto: completa lo que se deduce directo (un solo monto diario → min = max; el mensual desde el
//     diario o al revés) y lo marca deducido, con el ajuste anotado.
//   · portfolio: armarFicha recibe la lectura de Meta (portfolio.ts, solo GET) y guarda portfolio_meta (la cabecera: cuenta
//     act_…, si se leyó, el aviso) y portfolio_final = combinarPortfolio(Meta, llamada): la ÚNICA fusión, de la que leen los
//     faltantes, el markdown y el aviso. portfolioFinalDe() lo rearma para las fichas viejas (sin chequeo de Meta).
//   · faltantes: lo que tiene que completar Tomi, calculado ACÁ (nunca por Claude): cliente sin verificar, rama sin
//     definir, sin subramas, zona vacía o marcada en el mapa (con el ▶ al minuto y los lugares que se nombraron), presupuesto
//     sin monto o deducido, cuenta que factura en otra moneda que el presupuesto; del portfolio, lo que ni Meta ni la llamada
//     resolvieron (tildar a mano), lo que está en falta o con problema (diciendo según quién), lo que Meta y la llamada ven
//     distinto, la cuenta que encontró sola el tablero (cargarla en «Cuentas Meta») y el aviso de Meta; ideas que no salieron.
//     Cada uno tiene su clave (claveFaltante: la pantalla los marca como hechos en faltantes_checks) y su etiqueta corta
//     para el aviso (ETIQUETA_FALTANTE). Que la grabación cortó antes de lo agendado NO es un faltante: es una nota de la
//     cabecera (notaCorteGrabacion).
//   · pendientes: los de Claude, sin los que hablan del portfolio cuando Meta se consultó (los cubre el chequeo: decían "no
//     se revisó el portfolio" al lado de una tabla que sí lo revisó); lo sacado queda en los ajustes.
//   · quienGrabo: recorded_by del payload de Fathom → Tomás / Gero M (las kickoffs las hacen los dos, cada uno con su Fathom);
//     si recorded_by no alcanza, la cuenta de Fathom que firmó el webhook (columna grabador).
//   · zona desde el video (24/10): conZonaVideo le suma a la ficha la lectura del mapa (columna zona_video de cj_kickoffs,
//     ver mapa-zona.ts): zona.mapa y zona_video. El faltante del mapa se da por resuelto si el mapa del video se lee bien y
//     no contradice lo dicho; si lo contradice, pasa a "revisar las diferencias" y, si coincide pero se lee en parte, a
//     "confirmar el recorte leído" (las dos con su propia clave, zona_mapa_video); mientras el bot lo lee, dice eso; si no se
//     pudo leer, dice por qué (sin la API key de Fathom de quien grabó, sin video…). El markdown suma el bloque con su ▶.
//   · fichaMarkdown: la vista para revisar (Despacho / archivo de la prueba), con links a cada momento de la grabación
//     (al segundo estimado de la cita, con "≈", cuando el renglón de Fathom es largo). Los ganadores van sin el nombre del
//     otro cliente.
import { NOMBRE_RAMA, type Rama } from '@/lib/anuncios/ramas'
import { fechaCortaAR, horaCorta, linkFathom } from '@/lib/fathomAnuncios/transcripcion'
import type { Quien } from './grabadores'
import {
  NOMBRE_MARCA_MAPA, NOMBRE_TIPO_MAPA, diferenciasMapa, leerZonaVideo, listaLugares, mapaUtil, textoEstadoMapa, unirLugares,
  type BloqueMapaZona, type ZonaVideoFicha,
} from './mapa-zona'
import { combinarPortfolio } from './portfolio'
import type { ClaveFaltante } from './revision'
import {
  ITEMS_PORTFOLIO, NOMBRE_ITEM_PORTFOLIO, RAMAS, REVISORES,
  type Evidencia, type ExtraccionKickoff, type FichaKickoff, type GanadoresFicha, type GraboKickoff, type IdeasFicha, type ItemPortfolio,
  type ItemPortfolioFinal, type LecturaPortfolioMeta, type MotivoSinLecturaMeta, type PortfolioMetaFicha, type PresupuestoFicha,
} from './tipos'

const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// Formas en que Claude (o una persona) puede nombrar una rama, además de la clave y del nombre de NOMBRE_RAMA
const SINONIMOS: Record<string, Rama> = {
  despidos: 'laboral', 'derecho laboral': 'laboral', trabajo: 'laboral',
  'accidentes de trabajo': 'art', 'accidentes laborales': 'art', 'enfermedades profesionales': 'art',
  'accidentes de transito': 'transito', choques: 'transito',
  amparos: 'salud', prepagas: 'salud', 'obras sociales': 'salud',
  jubilaciones: 'previsional', divorcios: 'familia', alimentos: 'familia', herencias: 'sucesiones',
  deudas: 'consumidor', 'defensa del consumidor': 'consumidor', ciudadanias: 'internacional', ciudadania: 'internacional',
  contratos: 'empresas',
}

/** Una clave de Rama o null. */
export function normalizarRama(x: unknown): Rama | null {
  if (typeof x !== 'string') return null
  const n = norm(x)
  if (!n) return null
  const directa = RAMAS.find(r => r === n.replace(/ /g, '_') || r === n)
  if (directa) return directa
  const porNombre = RAMAS.find(r => norm(NOMBRE_RAMA[r]) === n)
  if (porNombre) return porNombre
  return SINONIMOS[n] ?? null
}

const redondo = (n: number, dec = 0) => Math.round(n * 10 ** dec) / 10 ** dec

/** Completa lo que se deduce directo de lo dicho y lo marca deducido. Devuelve el presupuesto nuevo y los ajustes. */
export function normalizarPresupuesto(p: PresupuestoFicha): { presupuesto: PresupuestoFicha; ajustes: string[] } {
  const ajustes: string[] = []
  let { usd_dia_min: min, usd_dia_max: max, usd_mes: mes, deducido } = p
  if (min === null && max !== null) min = max
  if (max === null && min !== null) max = min
  if (min !== null && max !== null && min > max) { [min, max] = [max, min]; ajustes.push('presupuesto diario con mínimo mayor que el máximo: se invirtieron') }
  if (mes === null && min !== null && max !== null) {
    mes = redondo(((min + max) / 2) * 30)
    deducido = true
    ajustes.push(`presupuesto mensual calculado: promedio diario × 30 = USD ${mes}`)
  } else if (min === null && mes !== null) {
    min = max = redondo(mes / 30, 1)
    deducido = true
    ajustes.push(`presupuesto diario calculado: mensual ÷ 30 = USD ${min}`)
  }
  return { presupuesto: { ...p, usd_dia_min: min, usd_dia_max: max, usd_mes: mes, deducido }, ajustes }
}

export const MIN_CORTE_TEMPRANO_MS = 10 * 60_000   // la grabación terminó al menos 10 min antes de lo agendado

// Para los faltantes (que también van al aviso de Discord): el nombre del ítem sin la aclaración entre paréntesis
const NOMBRE_CORTO_PORTFOLIO = Object.fromEntries(ITEMS_PORTFOLIO.map(k => [k, NOMBRE_ITEM_PORTFOLIO[k].replace(/\s*\(.*\)$/, '')])) as Record<(typeof ITEMS_PORTFOLIO)[number], string>

/** "09:22" en hora de Buenos Aires (de fechaCortaAR, "vie 23/10 09:22"). */
const horaAR = (iso: string | null | undefined) => fechaCortaAR(iso ?? null)?.slice(-5) ?? null

type BaseFaltantes = Pick<FichaKickoff, 'tipo_reunion' | 'cliente' | 'rama' | 'avatar' | 'zona' | 'presupuesto' | 'portfolio' | 'ideas_guiones'>
  & Partial<Pick<FichaKickoff, 'fin_grabacion' | 'fin_agendado' | 'portfolio_meta' | 'portfolio_final' | 'zona_video' | 'recording_id'>>

/** El portfolio final de una ficha: el guardado o, en una ficha vieja (sin chequeo de Meta), el de la llamada sola. */
export function portfolioFinalDe(f: Pick<FichaKickoff, 'portfolio'> & Partial<Pick<FichaKickoff, 'portfolio_final'>>): Record<ItemPortfolio, ItemPortfolioFinal> {
  const g = f.portfolio_final
  return g && ITEMS_PORTFOLIO.every(k => g[k] && typeof g[k].estado === 'string') ? g : combinarPortfolio(null, f.portfolio)
}

// Por qué Meta no pudo leer la cuenta, corto (faltantes, markdown y aviso)
export const MOTIVO_META: Record<MotivoSinLecturaMeta, string> = {
  sin_cuenta: 'no se encontró la cuenta del cliente', sin_acceso: 'sin acceso a la cuenta', token_invalido: 'token de Meta vencido',
  limite: 'Meta limitó las consultas', timeout: 'Meta no respondió a tiempo', sin_token: 'sin token de Meta', error: 'error al leer la cuenta',
}
const FUENTE_TXT = { meta: 'Meta', llamada: 'la llamada', ninguna: 'nadie' } as const
const PEDIR_ACCESO = /^Pedirle al cliente: darle acceso/

const yLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs[0] ?? '')

/**
 * La línea de los ítems para tildar a mano. "Sin verificar" queda SOLO para la verificación de Meta: lo que nadie
 * resolvió es "para tildar", y lo que la llamada nombró sin confirmar es "solo se nombró". Lo usa también vista.ts (con lo
 * que todavía no se tildó).
 */
export function lineaTildarPortfolio(items: ItemPortfolio[], nombrados: ItemPortfolio[], meta: Pick<PortfolioMetaFicha, 'leido' | 'motivo'> | null): string {
  const porque = !meta ? 'sin chequeo de Meta y en la llamada no se confirmaron'
    : meta.leido ? 'Meta no los pudo leer y en la llamada no se confirmaron'
      : `Meta no pudo leer la cuenta: ${MOTIVO_META[meta.motivo ?? 'error'] ?? 'error al leer la cuenta'}, y en la llamada no se confirmaron`
  const n = nombrados.filter(k => items.includes(k)).map(k => NOMBRE_CORTO_PORTFOLIO[k])
  const solo = n.length ? ` (${yLista(n)} solo se nombr${n.length === 1 ? 'ó' : 'aron'})` : ''
  return `Portfolio para tildar a mano (${porque}): ${items.length === ITEMS_PORTFOLIO.length ? 'los 7 ítems' : yLista(items.map(k => NOMBRE_CORTO_PORTFOLIO[k]))}${solo}`
}

/** Los faltantes del portfolio (todos empiezan con "Portfolio": el aviso de Discord los resume en su propio renglón). */
export function faltantesPortfolio(f: Pick<BaseFaltantes, 'portfolio' | 'portfolio_meta' | 'portfolio_final'>): string[] {
  const out: string[] = []
  const final = portfolioFinalDe(f)
  const meta = f.portfolio_meta ?? null
  // 1. Lo que ni Meta ni la llamada resolvieron: lo tilda Tomi a mano (lo que solo se nombró, aclarado)
  const aMano = ITEMS_PORTFOLIO.filter(k => final[k].fuente === 'ninguna')
  const nombrados = aMano.filter(k => final[k].llamada?.estado === 'sin_verificar')
  if (aMano.length) out.push(lineaTildarPortfolio(aMano, nombrados, meta))
  // 2. Falta / problema (según quién) y lo que Meta y la llamada ven distinto. Con deuda, verificación dice "(ver Tarjeta)":
  //    no se repite.
  const deuda = final.tarjeta.fuente === 'meta' && final.tarjeta.estado === 'problema'
  for (const k of ITEMS_PORTFOLIO) {
    const x = final[k]
    if (k === 'verificacion' && deuda && x.fuente === 'meta' && /\(ver Tarjeta\)/.test(x.meta?.detalle ?? '')) continue
    const det = x.fuente === 'meta' ? x.meta?.detalle : x.fuente === 'llamada' ? x.llamada?.detalle : ''
    const ojo = !x.discrepancia || !x.llamada || !x.meta ? ''
      : x.fuente === 'meta' ? `en la llamada se dijo «${x.llamada.estado}»${x.llamada.detalle ? ` (${x.llamada.detalle})` : ''}`
        : `Meta dice «${x.meta.estado}», pero lo deduce de los anuncios`
    if (x.estado === 'falta' || x.estado === 'problema') {
      out.push(`Portfolio · ${NOMBRE_ITEM_PORTFOLIO[k]}: ${x.estado} según ${FUENTE_TXT[x.fuente]}${det ? ` (${det})` : ''}${ojo ? ` · ojo: ${ojo}` : ''}`)
    } else if (ojo && x.llamada && x.meta) {
      out.push(`Portfolio · ${NOMBRE_ITEM_PORTFOLIO[k]}: ojo: Meta dice «${x.meta.estado}», en la llamada se dijo «${x.llamada.estado}»${x.llamada.detalle ? ` (${x.llamada.detalle})` : ''}: revisar`)
    }
  }
  // 3. Qué hacer según Meta (cargar la cuenta, renovar el token, reintentar…), sin repetir el pedido de accesos de arriba
  if (meta?.aviso) {
    const yaPedido = final.accesos_equipo.fuente === 'meta' && final.accesos_equipo.estado === 'falta'
    const partes = meta.aviso.split(' · ').map(x => x.trim()).filter(x => x && !(yaPedido && PEDIR_ACCESO.test(x)))
    if (partes.length) out.push(`Portfolio en Meta${meta.cuenta ? ` (${meta.cuenta})` : ''}: ${partes.join(' · ')}`)
  }
  // 4. La cuenta la encontró sola el tablero (no está en «Cuentas Meta»): si la próxima vez el descubrimiento falla o está
  //    frío, la ficha queda "sin cuenta", y el tablero de anuncios tampoco la asocia al cliente
  if (meta?.leido && meta.origen_cuenta === 'descubrimiento' && meta.cuenta) {
    out.push(`Portfolio · cargar ${meta.cuenta} en «Cuentas Meta» del CRM: hoy la encontró sola el tablero de anuncios`)
  }
  return out
}

// ── Claves y etiquetas de los faltantes (la pantalla los marca como hechos; el aviso los nombra corto) ──
// Por el principio del texto: reconoce también los textos de las fichas viejas (la zona decía "Zona marcada en un mapa…")
// La zona del mapa: lo que pide el mapa YA leído del video (revisar, confirmar) tiene su clave, antes que la de "anotar"
const CLAVES_POR_TEXTO: [RegExp, ClaveFaltante][] = [
  [/^Cliente sin verificar/, 'cliente'], [/^Rama principal sin definir/, 'rama'], [/^Subramas sin definir/, 'subramas'],
  [/^Avatar sin filtros/, 'avatar'], [/^Zona sin definir/, 'zona'], [/^Zona del mapa: (revisar|confirmar)/, 'zona_mapa_video'],
  [/^Zona (marcada en un mapa|del mapa)/, 'zona_mapa'],
  [/^Presupuesto sin monto/, 'presupuesto_monto'], [/^Presupuesto con montos deducidos/, 'presupuesto_deducido'],
  [/^Presupuesto a confirmar/, 'presupuesto_confirmar'], [/^La cuenta factura en/, 'moneda'], [/^Portfolio · cargar act_/, 'cuenta_crm'],
  [/^Ideas de guiones: no salieron/, 'ideas'],
]
/** La clave de un faltante (para marcarlo como hecho), o null (los del portfolio que se tildan, los de Meta). */
export const claveFaltante = (texto: string): ClaveFaltante | null => CLAVES_POR_TEXTO.find(([re]) => re.test(texto))?.[1] ?? null
/** Cómo los nombra el aviso de Discord: corto y fijo, así entran todos en una línea (el detalle está en la ficha). */
export const ETIQUETA_REVISAR_MAPA = 'revisar el mapa de la zona'
export const ETIQUETA_FALTANTE: Record<ClaveFaltante, string> = {
  cliente: 'cliente sin cruzar', rama: 'rama sin definir', subramas: 'subramas', avatar: 'avatar sin filtros', zona: 'zona sin definir',
  zona_mapa: 'recorte de la zona (mapa)', zona_mapa_video: ETIQUETA_REVISAR_MAPA, presupuesto_monto: 'presupuesto sin monto',
  presupuesto_deducido: 'presupuesto deducido', presupuesto_confirmar: 'presupuesto a confirmar', moneda: 'moneda de la cuenta',
  cuenta_crm: 'cuenta en el CRM', ideas: 'ideas',
}
/** La etiqueta corta de un faltante para el aviso (null si no tiene clave). */
export function etiquetaFaltante(texto: string): string | null {
  const k = claveFaltante(texto)
  if (!k) return null
  if (k === 'zona_mapa_video' && /^Zona del mapa: confirmar/.test(texto)) return 'confirmar el recorte (mapa)'
  if (k === 'zona_mapa' && /^Zona del mapa: se está leyendo/.test(texto)) return 'recorte de la zona (lo está leyendo el bot)'
  return ETIQUETA_FALTANTE[k]
}

/**
 * Un gancho entre comillas angulares, sin que queden dobles: si el gancho ya trae «…» (una frase citada), adentro pasan a
 * “…”. Antes salía «««Mirá, mañana no hace falta que vengas.» ¿Te lo dijeron así…?» y parecía que terminaba en «vengas.».
 */
export const entreComillas = (g: string): string => `«${g.replace(/«/g, '“').replace(/»/g, '”')}»`

/** "≈17:18" (el segundo estimado de la cita) o "16:00" (el del renglón), o null. */
const minuto = (e: Pick<Evidencia, 'timestamp' | 'aprox'>): string | null => {
  const ts = e.aprox ?? e.timestamp
  return ts ? `${e.aprox ? '≈' : ''}${horaCorta(ts)}` : null
}
const sinParentesis = (t: string) => t.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || t

/**
 * El faltante de la zona del mapa, o null si no corresponde: no hubo mapa en pantalla, o el mapa del video se lee bien y
 * coincide con lo dicho (el recorte quedó leído). Mientras el bot lo lee, eso (no "anotalo vos": lo está haciendo el bot).
 * Con diferencias, "revisar"; si coincide pero se lee en parte, "confirmar" (las dos con la clave zona_mapa_video: una nota
 * del recorte anotada antes de leer el video no las tapa). Si no se pudo leer, el porqué al lado del ▶. `id`: el
 * recording_id, para decir cómo se reintenta una lectura cortada.
 */
export function faltanteMapa(z: BaseFaltantes['zona'], zv: ZonaVideoFicha | null | undefined, id?: number | null): string | null {
  const b: BloqueMapaZona | null = zv ? (zv.estado === 'ok' ? zv.mapa : null) : z.mapa ?? null
  if (!z.mapa_en_pantalla && !b) return null
  if (b && mapaUtil(b)) {
    const { ojos, revisar } = diferenciasMapa(b)
    const ve = b.momento ? `el mapa se ve ▶ ${horaCorta(b.momento)}` : ''
    if (!ojos.length && !revisar.length) {
      return b.legible === 'si' ? null : `Zona del mapa: confirmar el recorte leído del video (se lee en parte${ve ? `; ${ve}` : ''})`
    }
    const que = [...ojos.map(o => `ojo: ${o}`), ...revisar.map(r => `revisar: ${r}`)].join('; ')
    return `Zona del mapa: revisar las diferencias entre el mapa del video y lo dicho (${que}${ve ? `; ${ve}` : ''})`
  }
  if (zv && (zv.estado === 'pedido' || zv.estado === 'leyendo')) {
    return 'Zona del mapa: se está leyendo del video (en unos minutos queda acá; si preferís, anotá el recorte a mano)'
  }
  // El recorte del mapa no está en la transcripción (ni en la cuenta: la del cliente nuevo todavía no tiene campañas)
  const m = minuto(z), lugares = z.lugares.map(sinParentesis).filter(Boolean)
  const porque = b ? 'el mapa del video no deja leer el recorte' : zv ? textoEstadoMapa(zv, id) : ''
  // Sin mapa en los minutos que miró el bot, el ▶ es a cuando se habló de la zona (no "se ve en la grabación": ahí no está)
  const donde = zv?.estado === 'sin_mapa' ? (m ? `se habló de la zona ▶ ${m}` : 'se habló de la zona') : m ? `se ve en la grabación ▶ ${m}` : 'se ve en la grabación'
  const partes = [donde, lugares.length ? `se nombró ${yLista(lugares)}` : '', porque].filter(Boolean).join('; ')
  return `Zona del mapa: anotar el recorte exacto para la campaña (${partes})`
}

/** Lo que tiene que completar Tomi (solo para kickoffs). */
export function calcularFaltantes(f: BaseFaltantes): string[] {
  if (f.tipo_reunion !== 'kickoff') return []
  const out: string[] = []
  if (!f.cliente.cliente_crm) out.push(`Cliente sin verificar en el CRM (se escuchó «${f.cliente.nombre_escuchado}»): cruzarlo a mano`)
  if (!f.rama.principal) out.push(`Rama principal sin definir${f.rama.texto ? ` o fuera de la lista («${f.rama.texto}»)` : ''}: elegirla`)
  if (!f.rama.subramas.length) out.push('Subramas sin definir')
  if (!f.avatar.incluye.length && !f.avatar.excluye.length) out.push('Avatar sin filtros (registración, antigüedad, rubro…)')
  if (!f.zona.descripcion && !f.zona.lugares.length) out.push('Zona sin definir')
  const mapa = faltanteMapa(f.zona, f.zona_video ?? null, f.recording_id ?? null)
  if (mapa) out.push(mapa)
  const p = f.presupuesto
  if (p.usd_dia_min === null && p.usd_mes === null) out.push(`Presupuesto sin monto en USD${p.texto ? ` («${p.texto}»)` : ''}`)
  else if (p.deducido) out.push('Presupuesto con montos deducidos: confirmarlos')
  if (p.certeza === 'a_confirmar' && (p.usd_dia_min !== null || p.usd_mes !== null)) out.push('Presupuesto a confirmar')
  // La cuenta factura en otra moneda que el presupuesto acordado: hay que pasarlo al cargarlo (los USD por día, a pesos)
  const monedaCuenta = f.portfolio_meta?.leido ? f.portfolio_meta.moneda ?? null : null
  const monedaPres = (p.moneda ?? 'USD').toUpperCase()
  if (monedaCuenta && p.usd_dia_min !== null && monedaCuenta !== monedaPres) {
    const rango = p.usd_dia_max !== null && p.usd_dia_max !== p.usd_dia_min ? `${p.usd_dia_min}–${p.usd_dia_max}` : `${p.usd_dia_min}`
    out.push(`La cuenta factura en ${monedaCuenta}: pasar ${monedaPres} ${rango} por día a ${NOMBRE_MONEDA[monedaCuenta] ?? monedaCuenta} al cargar el presupuesto`)
  }
  out.push(...faltantesPortfolio(f))
  if (f.ideas_guiones.estado === 'sin_ideas') out.push(`Ideas de guiones: no salieron${f.ideas_guiones.motivo ? ` (${f.ideas_guiones.motivo})` : ''}`)
  return out
}

const NOMBRE_MONEDA: Record<string, string> = { ARS: 'pesos', UYU: 'pesos uruguayos', CLP: 'pesos chilenos', MXN: 'pesos mexicanos', COP: 'pesos colombianos', PYG: 'guaraníes', PEN: 'soles', EUR: 'euros', USD: 'dólares' }

/**
 * La grabación cortó bastante antes de lo agendado (10 min o más): lo que pasó después no está en la ficha. No es algo
 * para completar (quien hizo la llamada sabe si hubo algo más): va como nota en la cabecera. null = no cortó antes.
 */
export function notaCorteGrabacion(f: Partial<Pick<FichaKickoff, 'fin_grabacion' | 'fin_agendado'>>): string | null {
  const fin = f.fin_grabacion ? Date.parse(f.fin_grabacion) : NaN, agendado = f.fin_agendado ? Date.parse(f.fin_agendado) : NaN
  if (!Number.isFinite(fin) || !Number.isFinite(agendado) || agendado - fin < MIN_CORTE_TEMPRANO_MS) return null
  return `La grabación cortó a las ${horaAR(f.fin_grabacion)}; el evento iba hasta las ${horaAR(f.fin_agendado)}`
}

/** "hora de Argentina" de un timezone_name de Meta (America/Argentina/San_Juan), o el nombre tal cual. */
export function zonaHorariaTexto(tz: string | null | undefined): string | null {
  if (!tz) return null
  const PAIS: [RegExp, string][] = [[/^America\/(Argentina\/|Buenos_Aires|Cordoba|Mendoza)/, 'Argentina'], [/^America\/Montevideo/, 'Uruguay'], [/^America\/Santiago/, 'Chile'],
    [/^America\/Asuncion/, 'Paraguay'], [/^America\/Bogota/, 'Colombia'], [/^America\/Lima/, 'Perú'], [/^America\/Mexico_City/, 'México'], [/^Europe\/Madrid/, 'España']]
  const p = PAIS.find(([re]) => re.test(tz))?.[1]
  return p ? `hora de ${p}` : `zona horaria ${tz}`
}

/**
 * Cuándo se lanza, armado desde los acuerdos (la llamada casi nunca dice una fecha): "Lanzamiento: sin fecha (guiones para
 * lun 26/10; después graba Laura y se edita)". Si un acuerdo de lanzar o publicar tiene fecha, esa.
 */
export function renglonLanzamiento(acuerdos: readonly Pick<FichaKickoff['acuerdos'][number], 'quien' | 'que' | 'cuando'>[]): string {
  const con = (re: RegExp) => acuerdos.find(a => re.test(a.que ?? ''))
  const lanza = acuerdos.find(a => /\b(lanz|activ|sale|salen|salir)\w*/i.test(a.que ?? '') && a.cuando)
  if (lanza) return `Lanzamiento: ${lanza.cuando}`
  const g = con(/gui[oó]n/i), graba = con(/\bgrab/i), edita = con(/\bedit/i)
  const quien = graba ? sinParentesis(graba.quien ?? '').split(/[\s/]/)[0] : ''
  const despues = graba && edita ? `después graba ${quien || 'el cliente'} y se edita` : graba ? `después graba ${quien || 'el cliente'}` : edita ? 'después se edita' : ''
  const partes = [g ? (g.cuando ? `guiones para ${g.cuando}` : 'guiones sin fecha') : '', despues].filter(Boolean)
  return `Lanzamiento: sin fecha${partes.length ? ` (${partes.join('; ')})` : ''}`
}

const NOMBRE_CUENTA: Record<Quien, 'Tomás' | 'Gero M'> = { tomas: 'Tomás', gero_m: 'Gero M' }

/**
 * Quién hizo la kickoff, de recorded_by de Fathom. Se reconoce por nombre o mail; si no alcanza (no vino, u otro nombre),
 * por la cuenta de Fathom que firmó el webhook (`cuenta`, columna grabador). Si no es Tomás ni Gero M, va el nombre.
 */
export function quienGrabo(rb: { name?: string | null; email?: string | null } | null | undefined, cuenta?: Quien | null): GraboKickoff | null {
  const nombre = rb?.name?.replace(/\s+/g, ' ').trim() || null, email = rb?.email?.trim() || null
  const deCuenta = cuenta && NOMBRE_CUENTA[cuenta] ? NOMBRE_CUENTA[cuenta] : null
  if (!nombre && !email && !deCuenta) return null
  const n = norm(`${nombre ?? ''} ${email ?? ''}`)
  const quien = /\bmozzi|\bggeroo/.test(n) ? 'Gero M' : /\bnapolitano/.test(n) ? 'Tomás' : deCuenta
  return { nombre, email, quien, ...(deCuenta ? { cuenta_fathom: cuenta } : {}) }
}

/** La cuenta de Fathom (tomas | gero_m) de quien grabó: la que firmó el webhook o, si no se sabe, la de recorded_by. */
export function cuentaDeGrabacion(grabador: Quien | null | undefined, rb: { name?: string | null; email?: string | null } | null | undefined): Quien | null {
  if (grabador && NOMBRE_CUENTA[grabador]) return grabador
  const q = quienGrabo(rb)?.quien
  return q === 'Tomás' ? 'tomas' : q === 'Gero M' ? 'gero_m' : null
}

export interface PartesFicha {
  reunion: {
    recording_id: number; title: string; url: string; recording_start_time: string | null; created_at: string | null
    recording_end_time?: string | null; scheduled_end_time?: string | null
    recorded_by?: { name?: string | null; email?: string | null } | null
  }
  extraccion: ExtraccionKickoff
  ajustes: string[]
  ideas: IdeasFicha | null       // null = no se pidieron (no es kickoff)
  ganadores: GanadoresFicha | null
  /** El chequeo de Meta (paraFicha() de portfolio.ts); null o sin pasar = no se consultó (no es kickoff). */
  portfolioMeta?: LecturaPortfolioMeta | null
  /** La cuenta de Fathom que firmó el webhook (columna grabador): quién hizo la kickoff si recorded_by no alcanza. */
  grabador?: Quien | null
  /** La lectura del mapa desde el video que se conoce al armar la ficha (columna zona_video). */
  zonaVideo?: ZonaVideoFicha | null
}

/** La cabecera que guarda la ficha (los ítems de Meta quedan dentro de portfolio_final). */
const cabeceraMeta = (m: LecturaPortfolioMeta): PortfolioMetaFicha => ({
  cuenta: m.cuenta, nombre: m.nombre, leido: m.leido, motivo: m.motivo, aviso: m.aviso, generado: m.generado, origen_cuenta: m.origen_cuenta,
  moneda: m.moneda ?? null, zona_horaria: m.zona_horaria ?? null,
})

// Un pendiente de Claude que habla del portfolio, cuando Meta ya se consultó: lo cubre el chequeo (portfolio_final)
const RE_PEND_PORTFOLIO = /\b(portfolio|accesos?|instagram|whatsapp business|p[aá]gina de facebook|verificaci[oó]n|tarjeta)\b/i

export function armarFicha(p: PartesFicha): FichaKickoff {
  const esKickoff = p.extraccion.tipo_reunion === 'kickoff'
  const ideas: IdeasFicha = p.ideas ?? {
    estado: 'no_corresponde', revisores: [...REVISORES], ideas: [], notas: '',
    motivo: esKickoff ? 'todavía no se pidieron' : `la llamada no es un kickoff (${p.extraccion.tipo_reunion})`,
  }
  const ganadores: GanadoresFicha = p.ganadores ?? { estado: 'no_pedido', nota: esKickoff ? '' : 'no es un kickoff', lista: [], ventana: null }
  const meta = p.portfolioMeta ?? null
  const ajustes = [...p.ajustes]
  const pendientes = meta ? p.extraccion.pendientes.filter(x => {
    if (!RE_PEND_PORTFOLIO.test(x)) return true
    ajustes.push(`pendiente del portfolio sacado («${x.replace(/\s+/g, ' ').slice(0, 80)}${x.length > 80 ? '…' : ''}»): lo cubre el chequeo de Meta`)
    return false
  }) : p.extraccion.pendientes
  const zv = esKickoff ? p.zonaVideo ?? null : null
  const base = {
    ...p.extraccion,
    zona: zonaConMapa(p.extraccion.zona, zv),
    pendientes,
    ideas_guiones: ideas,
    fin_grabacion: p.reunion.recording_end_time ?? null,
    fin_agendado: p.reunion.scheduled_end_time ?? null,
    grabo: quienGrabo(p.reunion.recorded_by, p.grabador),
    portfolio_meta: meta ? cabeceraMeta(meta) : null,
    portfolio_final: combinarPortfolio(meta, p.extraccion.portfolio),
    ...(zv ? { zona_video: zv } : {}),
  }
  return {
    version: 1,
    recording_id: p.reunion.recording_id,
    titulo: p.reunion.title,
    url: p.reunion.url,
    fecha: p.reunion.recording_start_time ?? p.reunion.created_at,
    ...base,
    faltantes: calcularFaltantes({ ...base, recording_id: p.reunion.recording_id }),
    ganadores,
    ajustes,
  }
}

/** La zona con el bloque del mapa del video (solo si la lectura está ok); sin lectura, sin bloque (lo dicho no se toca). */
function zonaConMapa<Z extends FichaKickoff['zona']>(zona: Z, zv: ZonaVideoFicha | null): Z {
  const { mapa: _viejo, ...dicha } = zona
  void _viejo
  return (zv?.estado === 'ok' && zv.mapa ? { ...dicha, mapa: zv.mapa } : dicha) as Z
}

/**
 * La ficha con la lectura del mapa que manda (la de la columna zona_video, leída con leerZonaVideo): zona.mapa, zona_video
 * y los faltantes recalculados. Sin lectura válida, la ficha tal cual (con la que ya traía, si traía). Lo usan la pantalla
 * (vista.ts) y la prueba en seco.
 */
export function conZonaVideo(f: FichaKickoff, zonaVideo: unknown): FichaKickoff {
  const zv = leerZonaVideo(zonaVideo)
  if (!zv || f.tipo_reunion !== 'kickoff') return f
  const base = { ...f, zona: zonaConMapa(f.zona, zv), zona_video: zv }
  return { ...base, faltantes: calcularFaltantes(base) }
}

// ── Vista en markdown ──────────────────────────────────────────────────────────────────────────
const celda = (x: string) => x.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
const linea = (x: string) => x.replace(/\s+/g, ' ').trim()

function momento(e: Evidencia, url: string): string {
  // Con aprox, el link va al segundo estimado de la cita (los renglones de Fathom pueden durar 2 minutos)
  const ts = e.aprox ?? e.timestamp
  const link = ts ? ` [▶ ${e.aprox ? '≈' : ''}${horaCorta(ts)}](${linkFathom(url, ts)})` : ''
  const cita = e.cita ? ` — «${linea(e.cita)}»${e.textual ? '' : ' (no textual)'}` : ''
  return `${link}${cita}`
}

function usd(n: number | null): string {
  return n === null ? '—' : `USD ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
}

/**
 * "USD 8–10 por día (~USD 240–300 por mes)" o lo que haya. Con un rango diario, si el mensual cae dentro del rango × 30 (el
 * promedio deducido, o un mensual que no es de ningún extremo), se muestra el rango mensual entero: "~USD 240 por mes" solo,
 * al lado de "8–10 por día", se lee como si 240 fuera el equivalente de todo el rango. Si el mensual que se DIJO es el del
 * mínimo ("si vamos con 8, 240 al mes"), es con cuánto se arranca: "USD 8 por día para arrancar (hasta 10) · ~USD 240 por mes".
 */
export function textoPresupuesto(p: PresupuestoFicha): string {
  const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
  const rango = p.usd_dia_min !== null && p.usd_dia_max !== null && p.usd_dia_max !== p.usd_dia_min
  if (rango && !p.deducido && p.usd_mes !== null && Math.abs(p.usd_mes - p.usd_dia_min! * 30) <= 1) {
    return `USD ${fmt(p.usd_dia_min!)} por día para arrancar (hasta ${fmt(p.usd_dia_max!)}) · ~USD ${fmt(p.usd_mes)} por mes`
  }
  const dia = p.usd_dia_min !== null ? `USD ${fmt(p.usd_dia_min)}${rango ? `–${fmt(p.usd_dia_max!)}` : ''} por día` : ''
  const mesMin = rango ? redondo(p.usd_dia_min! * 30) : null, mesMax = rango ? redondo(p.usd_dia_max! * 30) : null
  const enRango = p.usd_mes !== null && mesMin !== null && mesMax !== null && p.usd_mes >= mesMin - 1 && p.usd_mes <= mesMax + 1
  const mes = p.usd_mes === null ? ''
    : enRango ? `~USD ${fmt(mesMin!)}–${fmt(mesMax!)} por mes`
      : `${dia ? '~' : ''}${usd(p.usd_mes)} por mes`
  const montos = dia && mes ? `${dia} (${mes})` : dia || mes
  return montos || p.texto || 'sin definir'
}

// "Sin verificar" queda solo para la verificación de Meta: lo que nadie resolvió es "para tildar" (y "se nombró" si la
// llamada lo mencionó sin confirmarlo)
export const NOMBRE_ESTADO_PORTFOLIO = { ok: '✅ ok', falta: '⬜ falta', problema: '⚠️ problema', sin_verificar: '🔸 para tildar (se nombró)', no_se_hablo: '— no se habló', sin_dato: '— para tildar' } as const
const NOMBRE_FUENTE = { meta: 'Meta', llamada: 'llamada', ninguna: '—' } as const

/** De dónde salió la cuenta revisada (el pie del portfolio en el markdown y en la pantalla). */
export const ORIGEN_CUENTA: Record<'crm' | 'descubrimiento', string> = {
  descubrimiento: 'la encontró el tablero de anuncios (no está en «Cuentas Meta» del CRM)', crm: 'de «Cuentas Meta» del CRM',
}
/** "factura en USD · hora de Argentina", de la cabecera de Meta (vacío en las fichas anteriores al 24/10). */
export const monedaYHora = (m: Pick<PortfolioMetaFicha, 'moneda' | 'zona_horaria'>): string =>
  [m.moneda ? `factura en ${m.moneda}` : '', zonaHorariaTexto(m.zona_horaria) ?? ''].filter(Boolean).join(' · ')

/** Cómo se encontró la cuenta y cuándo se chequeó, para el pie de la tabla del portfolio. */
function pieMeta(m: PortfolioMetaFicha | null): string[] {
  if (!m) return ['- Meta: sin chequeo (ficha anterior al chequeo del portfolio): todo sale de la llamada.']
  const cuando = fechaCortaAR(m.generado)
  const origen = m.origen_cuenta ? ORIGEN_CUENTA[m.origen_cuenta] ?? '' : ''
  const cuenta = m.cuenta ? `${m.cuenta}${m.nombre ? ` («${linea(m.nombre)}»)` : ''}` : ''
  const mh = monedaYHora(m)
  const out = [m.leido
    ? `- Cuenta revisada en Meta: ${cuenta}${mh ? ` · ${mh}` : ''}${origen ? ` · ${origen}` : ''}${cuando ? ` · chequeo del ${cuando}` : ''}`
    : `- Meta no pudo leer ${cuenta ? `la cuenta ${cuenta}` : 'la cuenta del cliente'} (${MOTIVO_META[m.motivo ?? 'error']})${cuando ? ` · ${cuando}` : ''}`]
  if (m.aviso) out.push(`- ⚠️ Qué hacer según Meta: ${linea(m.aviso)}`)
  return out
}

/** El bloque del mapa en el markdown: lo leído en el video (con su ▶) o, si no se leyó, por qué. */
function lineasMapaMarkdown(f: FichaKickoff, u: string): string[] {
  const zv = f.zona_video ?? null
  const b = f.zona.mapa ?? (zv?.estado === 'ok' ? zv.mapa : null)
  if (!b) {
    if (!f.zona.mapa_en_pantalla) return []
    return [`- 🗺️ Se marcó en un mapa en pantalla: el recorte exacto no está en la transcripción${zv ? ` (${textoEstadoMapa(zv, f.recording_id)})` : ''}.`]
  }
  const link = b.momento ? ` [▶ ${horaCorta(b.momento)}](${linkFathom(u, b.momento)})` : ''
  const radio = b.radio_km !== null ? `${b.radio_km} km` : b.radio_estimado_km !== null ? `≈${b.radio_estimado_km} km (estimado${b.radio_como ? `: ${linea(b.radio_como)}` : ''})` : ''
  const { ojos, revisar } = diferenciasMapa(b)
  const sub = (titulo: string, x: string) => (x ? [`  - ${titulo}: ${linea(x)}`] : [])
  // Con un pin o una lista de Meta, lo que se carga son las ubicaciones configuradas (con su radio); los demás nombres son lo
  // que se lee impreso dentro del círculo. Con un polígono o un área, «también en el mapa» repetía casi toda la zona marcada
  const conPin = (b.marca === 'pin_con_radio' || b.marca === 'lista') && (b.incluidas?.length ?? 0) > 0
  const dentro = conPin ? b.lugares.filter(x => !b.incluidas.includes(x)) : []
  const area = b.marca === 'poligono' || b.marca === 'area_resaltada'
  return [
    `- 🗺️ Mapa según el video${link} (${NOMBRE_TIPO_MAPA[b.tipo]}, ${NOMBRE_MARCA_MAPA[b.marca]}${b.legible === 'parcial' ? ', se lee en parte' : b.legible === 'no' ? ', no se lee' : ''}):`,
    ...(conPin
      ? [...sub('Ubicación marcada', `${unirLugares(b.incluidas)}${b.radio_km !== null ? ` +${b.radio_km} km` : ''}`), ...sub('Dentro del círculo se lee', unirLugares(dentro))]
      : sub('Zona marcada', b.marca === 'ninguna' ? 'no hay una zona marcada' : b.lugares.length ? unirLugares(b.lugares) : 'no se leen lugares en la zona marcada')),
    ...sub('Límites', b.limites),
    ...(conPin && b.radio_km !== null ? [] : sub('Radio', radio)),
    ...sub('Excluidas', unirLugares(b.excluidas)),
    ...sub(b.marca === 'ninguna' ? 'Se leen' : 'Se leen sin saber si quedan dentro', unirLugares(b.sin_posicion)),
    ...sub('Coincide con lo dicho', listaLugares(b.coinciden)),
    ...ojos.map(o => `  - ⚠️ Ojo: ${linea(o)}`),
    ...revisar.map(r => `  - Revisar: ${linea(r)}`),
    ...sub('El mapa no permite verificar', listaLugares(b.no_verificables)),
    ...(area ? [] : sub('En el mapa también (no se dijo)', listaLugares(b.discrepancias.vistos_no_dichos))),
  ]
}

export function fichaMarkdown(f: FichaKickoff): string {
  const u = f.url
  const nombre = f.cliente.cliente_crm ?? `${f.cliente.nombre_escuchado} (sin verificar)`
  const fecha = fechaCortaAR(f.fecha)
  const items = (xs: (Evidencia & { texto: string })[], vacio = '(ninguno)') =>
    xs.length ? xs.map(x => `  - ${linea(x.texto)}${momento(x, u)}`).join('\n') : `  - ${vacio}`
  const out: string[] = []
  out.push(`# Ficha de kickoff · ${nombre}${f.cliente.id_crm ? ` (${f.cliente.id_crm})` : ''}`)
  out.push('')
  out.push(`Llamada: «${linea(f.titulo)}»${fecha ? ` · ${fecha}` : ''} · [Fathom](${u}) · grabación ${f.recording_id}`)
  const g0 = f.grabo
  // "Grabada con el Fathom de": si los dos la grabaron, gana la que llegó primero, que no es necesariamente la de quien la llevó
  if (g0) out.push(`Grabada con el Fathom de: **${g0.quien ?? linea(g0.nombre ?? g0.email ?? '')}**${g0.nombre && g0.quien ? ` (${linea(g0.nombre)} en Fathom)` : ''}`)
  const corte = notaCorteGrabacion(f)
  if (corte) out.push(`⏱️ ${corte}: si después se habló o se hizo algo más, no está en la ficha.`)
  out.push(`Tipo: **${f.tipo_reunion}** · ${linea(f.resumen_corto)}`)
  if (f.tipo_reunion !== 'kickoff') {
    out.push('', 'No es un kickoff: no se piden ideas ni se manda aviso.')
    return out.join('\n')
  }
  out.push('', '## Falta completar (Tomi)')
  out.push(f.faltantes.length ? f.faltantes.map(x => `- ${linea(x)}`).join('\n') : '- Nada: la ficha quedó completa.')

  out.push('', '## Cliente')
  const como = f.cliente.como === 'email' ? 'cruzado por el mail del invitado' : f.cliente.como === 'claude' ? 'cruzado por nombre' : '**sin verificar**'
  out.push(`- En el CRM: ${f.cliente.cliente_crm ?? '—'}${f.cliente.id_crm ? ` (${f.cliente.id_crm})` : ''} · ${como}`)
  out.push(`- Se escuchó: ${linea(f.cliente.nombre_escuchado)}${f.cliente.apodo ? ` · le dicen «${linea(f.cliente.apodo)}»` : ''}`)
  if (f.cliente.email) out.push(`- Mail del invitado: ${f.cliente.email}`)
  if (f.cliente.cuentas.length) out.push(`- Cuentas publicitarias: ${f.cliente.cuentas.join(', ')}`)

  out.push('', '## Rama')
  out.push(`- Principal: **${f.rama.principal ? NOMBRE_RAMA[f.rama.principal] : 'sin definir'}**${f.rama.texto ? ` — ${linea(f.rama.texto)}` : ''}${momento(f.rama, u)}`)
  out.push('- Subramas:', items(f.rama.subramas, '(ninguna)'))
  out.push('- Descartadas:', f.rama.descartadas.length
    ? f.rama.descartadas.map(d => `  - ${linea(d.texto)}${d.motivo ? ` (${linea(d.motivo)})` : ''}${momento(d, u)}`).join('\n')
    : '  - (ninguna)')
  out.push('- A futuro:', items(f.rama.a_futuro, '(nada)'))

  out.push('', '## Avatar')
  out.push('- Incluye:', items(f.avatar.incluye))
  out.push('- Excluye:', items(f.avatar.excluye))

  out.push('', '## Zona')
  out.push(`- ${linea(f.zona.descripcion) || 'sin definir'}${momento(f.zona, u)}`)
  if (f.zona.lugares.length) out.push(`- Lugares: ${f.zona.lugares.map(linea).join(' · ')}`)
  if (f.zona.radio_km !== null) out.push(`- Radio: ${f.zona.radio_km} km`)
  const pc = f.zona.presentarse_como
  if (pc) out.push(`- Se presenta como: «${linea(pc.texto)}»${pc.cuando ? ` (${linea(pc.cuando)})` : ''}${momento(pc, u)}`)
  if (f.zona.contexto?.length) out.push('- Contexto:', items(f.zona.contexto))
  if (f.zona.pais) out.push(`- País: ${f.zona.pais}`)
  out.push(...lineasMapaMarkdown(f, u))

  out.push('', '## Presupuesto')
  const p = f.presupuesto
  out.push(`- ${textoPresupuesto(p)}${p.deducido ? ' (con montos deducidos)' : ''} · ${p.certeza === 'confirmado' ? 'confirmado' : 'a confirmar'}${momento(p, u)}`)
  if (p.evidencia_mes) out.push(`- El mensual se dijo aparte:${momento(p.evidencia_mes, u) || ' (sin cita)'}`)
  if (p.texto) out.push(`- Como se acordó: ${linea(p.texto)}${p.moneda ? ` (${p.moneda})` : ''}`)
  out.push(`- ${renglonLanzamiento(f.acuerdos)}`)

  // Portfolio: el final (Meta cruzado con la llamada). El momento de la grabación va solo cuando la fila habla de la
  // llamada (la fuente es la llamada, se mencionó sin verificar o la llamada dijo otra cosa que Meta)
  const final = portfolioFinalDe(f)
  out.push('', '## Portfolio', '', '| Ítem | Estado | Fuente | Detalle | Momento |', '|---|---|---|---|---|')
  for (const k of ITEMS_PORTFOLIO) {
    const x = final[k], c = f.portfolio[k]
    const estado = x.fuente === 'ninguna' && x.llamada?.estado === 'sin_verificar' ? NOMBRE_ESTADO_PORTFOLIO.sin_verificar : NOMBRE_ESTADO_PORTFOLIO[x.estado]
    const conMomento = x.fuente === 'llamada' || !!x.discrepancia || c.estado === 'sin_verificar'
    out.push(`| ${NOMBRE_ITEM_PORTFOLIO[k]} | ${estado} | ${NOMBRE_FUENTE[x.fuente]} | ${celda(x.detalle) || '—'} | ${(conMomento && celda(momento(c, u).replace(/^ — /, ''))) || '—'} |`)
  }
  out.push('', ...pieMeta(f.portfolio_meta ?? null))

  out.push('', '## Acuerdos')
  out.push(f.acuerdos.length ? f.acuerdos.map(a => `- **${linea(a.quien)}:** ${linea(a.que)}${a.cuando ? ` · 🗓️ ${linea(a.cuando)}` : ''}${momento(a, u)}`).join('\n') : '- (ninguno)')
  out.push('', '## Pendientes')
  out.push(f.pendientes.length ? f.pendientes.map(x => `- ${linea(x)}`).join('\n') : '- (ninguno)')

  const ig = f.ideas_guiones
  out.push('', `## Ideas de guiones (${ig.estado === 'a_revisar' ? `a revisar: ${ig.revisores.join(' y ')}` : ig.estado})`)
  if (ig.ideas.length) {
    ig.ideas.forEach((x, i) => {
      out.push(`${i + 1}. **${linea(x.titulo)}** — ${entreComillas(linea(x.gancho))}`)
      out.push(`   - Ángulo: ${linea(x.angulo)}`, `   - Subrama: ${linea(x.subrama)}`, `   - Por qué: ${linea(x.por_que)}`)
    })
  } else out.push(`- Sin ideas${ig.motivo ? `: ${linea(ig.motivo)}` : ''}`)
  if (ig.notas) out.push('', `Notas: ${linea(ig.notas)}`)

  const g = f.ganadores
  out.push('', '## Ganadores de la rama (referencia interna: no compartir con el cliente)')
  out.push(`- Estado: ${g.estado}${g.nota ? ` · ${linea(g.nota)}` : ''}${g.ventana ? ` · ${g.ventana}` : ''}`)
  if (g.lista.length) {
    out.push('', '| Id | Anuncio (gancho) | Subtema | País | USD por mensaje | Mensajes | Gasto USD |', '|---|---|---|---|---|---|---|')
    for (const x of g.lista) out.push(`| ${x.id} | ${celda(x.anuncio)} | ${celda(x.subtema)} | ${x.pais ?? 'sin dato'} | ${x.cplUSD.toFixed(2)} | ${x.mensajes} | ${Math.round(x.gastoUSD)} |`)
  }

  if (f.ajustes.length) out.push('', '## Ajustes de la validación', f.ajustes.map(x => `- ${linea(x)}`).join('\n'))
  return out.join('\n')
}
