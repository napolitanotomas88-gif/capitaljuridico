// ── Aviso a Valentino (#📣-ads): "🚀 Para lanzar · Cliente" después de cada kickoff ─────────────────────────────────
// Pedido de Tomás (24/10/2026): que Valentino Zalazar (media buyer) reciba en Discord, mencionándolo, lo que necesita para
// lanzar la campaña del cliente nuevo, sin abrir la ficha (su usuario solo entra a /anuncios). Lo de acá:
//   · textoAvisoAds (puro): de la fila de cj_kickoffs al mensaje, pasando por armarVista (vista.ts: la MISMA vista de la
//     pantalla de la ficha y del bloque "Para lanzar" del tablero: lectura defensiva, ningún mail, los tildes y las marcas
//     hechas a mano, la lectura del mapa de la columna zona_video). Quién hizo la kickoff y cuándo, la cuenta publicitaria
//     (act_…, nombre, moneda y horario), rama y subramas, a quién le habla (los filtros son para el copy: en Meta no se
//     segmentan) y quién queda afuera, la zona (la provincia y el país, el "desde… hasta…" tal como se dijo, la distancia al
//     estudio, lo leído del mapa con sus lugares y límites, las diferencias marcadas para que Tomi confirme, y cómo
//     presentarse), el presupuesto por día y por mes, cuándo se lanza (cuando estén los videos) y el WhatsApp de destino, lo
//     que frena en el portfolio (WhatsApp Business sin confirmar no es "sin frenos": es el destino de los anuncios) y los
//     links a la ficha y al tablero. NADA de las ideas de guiones ni de los ganadores de otros clientes;
//   · largo: hasta 2000 caracteres, con renglones de ÍTEMS ENTEROS (encajar de mensaje.ts, igual que el aviso de
//     #📝-kickoff): lo que no entra queda como "+N" (está en la ficha). Si no entra, se achican los renglones de a poco; en
//     los últimos niveles un ítem que solo ya no entra se acorta en un límite de palabra, y como recurso final se sacan
//     renglones enteros de los menos importantes. La mención y el renglón de los links no se pierden nunca;
//   · cuándo sale (UNA sola vez por grabación: la marca de la columna aviso_ads, ver abajo):
//       1. procesar.ts, al marcar la ficha "lista", deja la marca "pendiente:<ms>" en el MISMO UPDATE (si la invocación se
//          corta después, el barrido la encuentra);
//       2. si no quedó una lectura del mapa en marcha (no hubo mapa en pantalla, falta la API key, la ruta del mapa no la
//          aceptó…), la manda procesar.ts enseguida;
//       3. si la lectura quedó en marcha, la manda la ruta del mapa cuando termina, en cualquier estado final (ok, sin
//          mapa, sin video, sin key, error): así Valentino recibe la zona completa. Si la ruta se reintenta sola, la manda
//          el reintento al terminar;
//       4. si la lectura se cuelga (la invocación se cortó, el disparo no llegó o no quedó tiempo), el barrido
//          (barrerAvisosAds) la manda en cuanto el mapa terminó o, si no termina, pasados ESPERA_MAX_MAPA_MS desde que quedó
//          pendiente o desde la última escritura de la lectura (una lectura vieja en "pedido" o en error pasajero no se
//          espera). El barrido corre después de cada grabación del webhook (igual que la purga de payloads: no hay cron
//          propio), al final de cada lectura del mapa y en el modo manual con ?recording_id= de una ficha lista. Lo pendiente
//          de hace más de MAX_ANTIGUEDAD_PENDIENTE_MS (7 días: un fin de semana largo sin grabaciones no lo pierde) no sale
//          solo (se manda a mano);
//   · a mano (avisoAdsManual): POST /api/bot/kickoff?recording_id=…&aviso_ads=1 manda el que nunca salió (una ficha de
//     antes, como la de Laura) o el que Discord rechazó; aviso_ads=forzar lo vuelve a mandar ya, aunque haya salido. Con
//     &dry=1 devuelve el texto sin escribir ni mandar nada. Retomar o forzar el KICKOFF (?forzar=1) no lo repite, y una
//     ficha de antes del aviso no sale ni forzándola (se manda a mano);
//   · si falla (Discord lo rechazó, no confirmó o la ficha no se puede leer), a Tomás le llega UN aviso corto en #📝-kickoff
//     (deps.avisarTomas) con cómo reintentarlo: la marca no se repite sola, así que no se repite. En el modo manual no (la
//     respuesta ya lo dice). El GET de estado comprueba que el webhook del canal exista (comprobarCanalAds: un GET que no
//     publica nada) y lista lo que hay que revisar (revisarAvisosAds: rechazados, dudosos, colgados a mitad, pendientes
//     viejos).
// La marca (columna aviso_ads, text, aditiva): NULL = ficha de antes del aviso (no sale sola, ni reprocesándola con
// forzar: se manda a mano) · '' = ficha nueva todavía sin aviso (reclamar la inserta así; si el aviso estaba apagado al
// marcarla lista, queda así y tampoco sale sola) · "pendiente:<ms>" · "enviando:<ms>" (alguien lo tomó; si la invocación se
// cortó a mitad, no se repite solo) · el id del mensaje de Discord (salió) · "dudoso:<ms>" (Discord no respondió o se cortó
// la conexión a mitad: puede haber salido; no se repite solo) · "error:<ms>" (Discord lo rechazó: el webhook está mal; no
// se repite solo). Un error pasajero que seguro no publicó (5xx, 429, sin tiempo) la devuelve a pendiente. Tomarla es un
// UPDATE con condición sobre la marca que se leyó (registro.ts): si la ruta del mapa y el barrido lo intentan a la vez,
// sale una sola vez.
// Canal: DISCORD_WEBHOOK_KICKOFF_ADS o, si no está, DISCORD_WEBHOOK_ANUNCIOS (#📣-ads). Mención: <@DISCORD_ID_VALENTINO>
// con allowed_mentions SOLO ese user (enviarDiscord de lib/fathomAnuncios/discord.ts); sin el ID sale "Valentino" en texto,
// sin notificar. Apagado por defecto desde el 26/10 (lo manda g01 con los videos editados); KICKOFF_AVISO_ADS=1 lo prende. Todo lo que escribió el modelo o vino de Meta pasa
// por escaparDiscord: sin markdown propio ni menciones.
import { MAX_DISCORD, escaparDiscord } from '@/lib/fathomAnuncios/mensaje'
import { enviarDiscord } from '@/lib/fathomAnuncios/discord'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import { motivoDe } from '@/lib/fathomAnuncios/procesar'
import { avisoAdsEncendido, idValentino, mencionesKickoff, pantallaFicha, urlDespacho, webhookKickoff, webhookKickoffAds } from './entorno'
import { corto, encajar, linkFicha, resumenDiferenciasMapa, subramaCorta, type GrupoAviso } from './mensaje'
import { ESTADOS_MAPA_HECHO, leerZonaVideo, sinNotaLugar, zonaVideoVigente, type ZonaVideoFicha } from './mapa-zona'
import { armarVista, taparMails, type FilaPortfolioVista, type Momento, type VistaKickoff } from './vista'
import { anotarAvisoAds, leerKickoff, pendientesAvisoAds, ponerAvisoAdsPendiente, tomarAvisoAds, type FilaAvisoAds, type FilaFichaCliente } from './registro'
import type { FichaKickoff, ItemPortfolio, PortfolioMetaFicha } from './tipos'

export type { FilaAvisoAds }

// ── Tiempos ──
/** Lo máximo que se espera a la lectura del mapa (una invocación de 300 s + el reintento solo + el disparo, con margen). */
export const ESPERA_MAX_MAPA_MS = 12 * 60_000
/**
 * Lo pendiente de hace más que esto no sale solo (si el aviso se prende o el canal se carga semanas después, no manda
 * viejas). 7 días: el barrido corre solo cuando llegan grabaciones, y un fin de semana largo sin kickoffs no tiene que
 * dejar a Valentino sin el aviso.
 */
export const MAX_ANTIGUEDAD_PENDIENTE_MS = 7 * 24 * 3600_000
/**
 * Lo mínimo que tiene que quedar para tomar el aviso (si no, queda pendiente para el barrido). Casi siempre tomar, mandar y
 * anotar son 1 a 2 s, pero el peor caso es tomar la marca con el tope de una consulta (10 s) y anotar cómo terminó con otro
 * tanto: el deadline más tardío de los llamadores es 7 s antes de los 300 s (el barrido y la ruta del mapa), así que con 15 s
 * el anotar termina antes del corte de Vercel aunque las dos consultas tarden su tope (y no queda "enviando" para siempre).
 */
export const MIN_TIEMPO_ADS_MS = 15_000
/**
 * Lo que el envío a Discord deja antes del deadline para anotar cómo terminó. Si tomar tardó tanto que ya no queda tiempo,
 * enviarDiscord corta sin mandar ("se acabó el tiempo", pasajero) y la marca vuelve a pendiente.
 */
export const RESERVA_ANOTAR_MS = 6_000
/** Un pendiente con más que esto (la espera del mapa y una hora) es que no hubo barrido: el GET de estado lo lista para revisar. */
export const PENDIENTE_VIEJO_MS = ESPERA_MAX_MAPA_MS + 3600_000
/** Un "enviando" más nuevo que esto no lo pisa ni el forzar (otro lo está mandando ahora). */
export const ENVIO_RECIENTE_MS = 2 * 60_000

// ── El texto ──
export interface ConfigTextoAds {
  valentino: string | null       // ID de Discord (null = "Valentino" en texto, sin mención)
  urlBase: string                // el Despacho (urlDespacho de entorno.ts): la ficha y el tablero
  pantalla: boolean              // ¿va el link a la ficha? (KICKOFF_PANTALLA=0 lo apaga; sin ID del CRM, nunca)
}

const SIN_TOPE = 10_000
// De más detalle a menos: se usa el primero que entra en 2000 caracteres. linea: rama, zona, presupuesto y lanzamiento;
// avatar, mapa y portfolio tienen el suyo (son lo que más le importa a Valentino). detalle: el porqué de lo que frena en el
// portfolio; pagina: la página de Facebook en el renglón de la cuenta; item: el largo máximo de UN ítem (hasta el nivel 4
// no se corta nada).
const NIVELES_ADS = [
  { linea: 320, avatar: 360, mapa: 460, portfolio: 360, detalle: true, pagina: true, item: SIN_TOPE },
  { linea: 240, avatar: 300, mapa: 360, portfolio: 280, detalle: true, pagina: true, item: SIN_TOPE },
  { linea: 180, avatar: 240, mapa: 280, portfolio: 220, detalle: false, pagina: true, item: SIN_TOPE },
  { linea: 140, avatar: 200, mapa: 220, portfolio: 160, detalle: false, pagina: false, item: SIN_TOPE },
  { linea: 110, avatar: 160, mapa: 170, portfolio: 130, detalle: false, pagina: false, item: 220 },
  { linea: 90, avatar: 130, mapa: 130, portfolio: 110, detalle: false, pagina: false, item: 140 },
  { linea: 0, avatar: 0, mapa: 0, portfolio: 0, detalle: false, pagina: false, item: 90 },
] as const
type NivelAds = (typeof NIVELES_ADS)[number]
// El recurso final: renglones enteros que se sacan, del menos importante al más (la cabecera y los links quedan siempre)
const ORDEN_QUITAR = ['presentarse', 'llamada', 'lanzamiento', 'rama', 'avatar', 'presupuesto', 'zona', 'portfolio', 'cuenta', 'mapa'] as const
type ClaveRenglon = (typeof ORDEN_QUITAR)[number]

const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const sinParentesis = (t: string) => t.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || t
/** Texto de afuera recortado ANTES de escapar (así el corte nunca cae en medio de un escape). */
const txt = (t: string, max: number) => escaparDiscord(corto(t.replace(/\s+/g, ' ').trim(), max))
const crudo = (t: string) => t
type Obj = Record<string, unknown>
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {})

// Un lugar dicho para el aviso: sin la nota "(de oído, verificar)" pero avisando que es de oído (Valentino lo busca en Meta)
const RE_OIDO = /\([^)]*o[ií]do[^)]*\)/i
const lugarAviso = (x: string): string => (RE_OIDO.test(x) ? `${sinNotaLugar(x)} (de oído)` : sinNotaLugar(x))

// ── La zona para segmentar ──
// Sin la provincia, "Pedernal" o "Tres Esquinas" pueden ser localidades de otra provincia en Meta; y "desde A y B hasta C y
// D" es un ÁREA entre esos puntos, no cuatro pines sueltos. La distancia al estudio sirve para el radio.
const NOMBRE_PAIS: Record<string, string> = {
  AR: 'Argentina', UY: 'Uruguay', CL: 'Chile', PY: 'Paraguay', MX: 'México', BO: 'Bolivia', PE: 'Perú', CO: 'Colombia',
}
const PROVINCIAS_AR = new Set(['buenos aires', 'caba', 'ciudad de buenos aires', 'catamarca', 'chaco', 'chubut', 'cordoba', 'corrientes',
  'entre rios', 'formosa', 'jujuy', 'la pampa', 'la rioja', 'mendoza', 'misiones', 'neuquen', 'rio negro', 'salta', 'san juan', 'san luis',
  'santa cruz', 'santa fe', 'santiago del estero', 'tierra del fuego', 'tucuman'])
// "provincia de San Juan", "provincia del Chaco", "Provincia de Santiago del Estero" (el nombre, con mayúsculas)
const RE_PROVINCIA = /\b[Pp]rovincia\s+del?\s+\p{Lu}[\p{L}'’.-]*(?:\s+(?:del?\s+|la\s+|las\s+|los\s+)?\p{Lu}[\p{L}'’.-]*){0,3}/u
// "desde Tres Esquinas y Pedernal hasta Caucete y el Bordón" (el primer tramo puede tener comas; el segundo corta en una)
const RE_DESDE_HASTA = /\b[Dd]esde\s+([^;:.()]{2,160}?)\s+hasta\s+([^;:.(),]{2,100}?)\s*(?=[;:.(),]|$)/u
const RE_DISTANCIA = /\d+\s*(?:km|kil[oó]metros?)\b|\bestudio\b|distancia/i
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** La provincia de la descripción de la zona ("Provincia de San Juan"), o lo que va antes de ":" si es una provincia; null si no se dijo. */
export function regionDeZona(descripcion: string): string | null {
  const m = RE_PROVINCIA.exec(descripcion)
  if (m) return m[0].replace(/^p/, 'P').trim()
  const i = descripcion.indexOf(':')
  const antes = i > 0 ? descripcion.slice(0, i).trim() : ''
  return antes && antes.length <= 40 && PROVINCIAS_AR.has(norm(antes)) ? antes : null
}

/**
 * El "desde… hasta…" de la descripción, con "(de oído)" en los lugares que lo son, y qué lugares de la lista nombra; null si
 * no lo hay o si nombra menos de dos lugares de la lista (puede ser otra cosa: "desde el centro hasta 30 km").
 */
export function areaDicha(descripcion: string, lugares: string[]): { texto: string; usados: Set<number> } | null {
  const m = RE_DESDE_HASTA.exec(descripcion)
  if (!m) return null
  let texto = `desde ${m[1].replace(/\s+/g, ' ').trim()} hasta ${m[2].replace(/\s+/g, ' ').trim()}`
  const usados = new Set<number>()
  lugares.forEach((x, i) => {
    const nombre = sinNotaLugar(x).replace(/\s+/g, ' ').trim()
    if (!nombre) return
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escRe(nombre)}(?![\\p{L}\\p{N}])`, 'iu')
    if (!re.test(texto)) return
    usados.add(i)
    if (RE_OIDO.test(x)) texto = texto.replace(re, t => `${t} (de oído)`)
  })
  return usados.size >= 2 ? { texto, usados } : null
}

const CORTO_ITEM: Record<ItemPortfolio, string> = {
  instagram: 'Instagram', whatsapp_business: 'WhatsApp Business', pagina_facebook: 'Página de Facebook', portfolio_comercial: 'Portfolio comercial',
  tarjeta: 'Tarjeta', verificacion: 'Verificación', accesos_equipo: 'Accesos del equipo',
}
// Lo que más le importa a Valentino, primero: sin accesos no entra a la cuenta y sin tarjeta los anuncios no salen
const ORDEN_FRENOS: ItemPortfolio[] = ['accesos_equipo', 'tarjeta', 'verificacion', 'pagina_facebook', 'whatsapp_business', 'portfolio_comercial', 'instagram']
const CONFIRMAR = 'confirmar el recorte con Tomi antes de lanzar'

/** El renglón del mapa: lo anotado a mano, si coincide con lo dicho (o qué no coincide, para que Tomi confirme) y lo leído. */
function gruposMapa(v: VistaKickoff, zv: ZonaVideoFicha | null): GrupoAviso[] | null {
  const m = v.zona.video
  const nota = v.lanzar.zona.nota
  const revisar = v.lanzar.zona.revisar
  if (!v.zona.mapa && !m && !nota) return null
  const estado: string[] = []
  if (nota) estado.push(`recorte anotado: «${nota}»${revisar ? ' (ojo: el mapa del video dice otra cosa)' : ''}`)
  const leido: GrupoAviso[] = []
  if (m?.estado === 'ok') {
    const b = zv?.estado === 'ok' ? zv.mapa : null
    const dif = b ? resumenDiferenciasMapa(b, crudo) : []
    if (!m.util) estado.push(`⚠️ el mapa del video no deja leer el recorte: ${CONFIRMAR}`)
    else if (dif.length || !m.coincide) estado.push(`⚠️ el mapa del video ${dif.length ? dif.join('; ') : 'no coincide del todo con lo dicho'}: ${CONFIRMAR}`)
    else if (m.parcial) estado.push(`coincide con lo dicho, pero se lee en parte: ${CONFIRMAR}`)
    else estado.push('✅ el mapa del video coincide con lo dicho')
    if (m.util) {
      // Con un pin con radio de Meta, lo que se carga es la ubicación configurada con su radio (no los nombres que se leen
      // dentro del círculo); con un polígono o un área, los lugares y los límites
      const radioMas = m.radio && /^\d/.test(m.radio) ? ` +${m.radio}` : ''
      if (m.conPin) leido.push({ prefijo: 'leído: ', items: [`${m.marcados.map(x => x.nombre).join(' · ')}${radioMas}`] })
      else {
        leido.push({ prefijo: 'leído: ', items: m.lugares })
        leido.push({ items: m.radio ? [`radio ${m.radio}`] : [] })
      }
      leido.push({ prefijo: 'sin ', items: m.excluidas, sep: ', ' })
      leido.push({ prefijo: 'límites: ', items: m.limites ? [m.limites] : [] })
    }
  } else if (!nota || revisar) {
    const porque = !m ? 'se marcó en un mapa en pantalla y no se leyó del video'
      : m.estado === 'pedido' || m.estado === 'leyendo' ? 'la lectura del mapa del video no terminó'
        : m.estado === 'sin_mapa' ? 'en el video no se ve el mapa de la zona'
          : m.estado === 'sin_video' ? 'la grabación no tiene video para leer el mapa'
            : 'no se pudo leer el mapa del video'
    estado.push(`⚠️ ${porque}: ${CONFIRMAR}`)
  }
  return [{ items: estado }, ...leido]
}

/**
 * Lo que frena en el portfolio (falta o problema, con los tildes a mano), lo que nadie confirmó y el aviso de Meta. Las
 * campañas de CJ son de mensajes a WhatsApp: con WhatsApp Business sin confirmar (ni Meta, ni la llamada, ni un tilde) no
 * se dice "sin frenos", se avisa que es el destino (si la página no tiene el número, el anuncio a WhatsApp no se arma).
 */
function gruposPortfolio(v: VistaKickoff, pm: PortfolioMetaFicha | null, detalle: boolean): GrupoAviso[] {
  const filas = [...v.portfolio.filas].sort((a, b) => ORDEN_FRENOS.indexOf(a.item) - ORDEN_FRENOS.indexOf(b.item))
  const frenan = filas.filter(x => x.visto.estado === 'falta' || x.visto.estado === 'problema')
  const waDuda = filas.some(x => x.item === 'whatsapp_business' && x.visto.estado === 'sin_dato')
  const sinConfirmar = filas.filter(x => x.tildable && !x.check && !(waDuda && x.item === 'whatsapp_business'))
  const ok = v.portfolio.resumen.ok, okMeta = filas.filter(x => x.visto.estado === 'ok' && x.fuente === 'meta' && !x.visto.aMano).length
  const item = (x: FilaPortfolioVista): string => {
    const d = detalle ? (x.check?.nota || x.detalle).split(' · ')[0].trim() : ''
    return `${CORTO_ITEM[x.item]}: ${x.visto.estado === 'problema' ? 'problema' : 'falta'}${x.visto.aMano ? ' (tildado a mano)' : ''}${d ? ` — ${d}` : ''}`
  }
  const sinMeta = !pm ? 'sin chequeo de Meta: confirmar accesos y tarjeta con Tomi'
    : !pm.leido ? 'Meta no pudo leer la cuenta: confirmar accesos y tarjeta con Tomi' : ''
  const wa = waDuda ? ['⚠️ WhatsApp Business sin confirmar (es el destino de los anuncios)'] : []
  const conteo = `${ok}/${v.portfolio.resumen.total} ok${ok && okMeta === ok ? ' según Meta' : ''}`
  const primero: GrupoAviso = frenan.length ? { prefijo: '⛔ frena: ', items: frenan.map(item) }
    : sinMeta ? { items: [sinMeta] }
      : { items: waDuda ? [...wa, conteo] : [`sin frenos: ${conteo}`] }
  return [
    primero,
    { items: frenan.length && sinMeta ? [sinMeta] : [] },
    { items: frenan.length || sinMeta ? wa : [] },
    { prefijo: 'sin confirmar: ', items: sinConfirmar.map(x => CORTO_ITEM[x.item]), sep: ', ' },
    { items: pm?.aviso ? [`➜ ${pm.aviso}`] : [] },
  ]
}

/**
 * Cuándo se lanza: la fecha cargada a mano en la ficha o, si no, lo que se acordó (sale cuando estén los videos). Y el
 * WhatsApp de destino: el cargado a mano o, si no está, que se lo pida a Tomi (sin él no se arma el anuncio a WhatsApp).
 */
function gruposLanzamiento(v: VistaKickoff): GrupoAviso[] {
  const dato = (k: string) => v.lanzar.datos.find(d => d.clave === k)?.marca?.nota?.trim() || ''
  const fecha = dato('fecha_lanzamiento'), wa = dato('whatsapp_destino')
  const l = v.lanzar.lanzamiento.replace(/^Lanzamiento:\s*/i, '').trim()
  const sinFecha = !l || /^sin fecha/i.test(l)
  const detalle = sinFecha ? (/\(([^()]*)\)\s*$/.exec(l)?.[1] ?? '').split(/;\s*/).map(x => x.trim()).filter(Boolean) : []
  return [
    { items: [fecha ? `estimado ${fecha} (cuando estén los videos)` : sinFecha ? 'sin fecha todavía: sale cuando estén los videos' : `estimado ${l} (cuando estén los videos)`] },
    { items: detalle },
    { items: [wa ? `📲 WhatsApp de destino: ${wa}` : '📲 WhatsApp de destino: sin cargar (pedíselo a Tomi)'] },
  ]
}

/** La fila "en memoria" (la ficha recién armada, sin tildes ni marcas): para el texto en seco (dry) y la prueba local. */
export function filaParaAviso(ficha: FichaKickoff, zonaVideo: ZonaVideoFicha | null, cuando: string = new Date().toISOString()): FilaFichaCliente {
  return {
    recording_id: ficha.recording_id, estado: 'lista', titulo: ficha.titulo, url: ficha.url, cliente_crm: ficha.cliente.cliente_crm, id_crm: ficha.cliente.id_crm,
    error: null, ficha, ideas: null, revision: null, portfolio_checks: null, faltantes_checks: null, zona_video: zonaVideo, creado: cuando, actualizado: cuando,
  }
}

/**
 * El aviso a Valentino, tal cual sale (hasta 2000 caracteres), o null si la fila no es un kickoff legible. `ahoraMs`: para
 * dar por cortada una lectura del mapa colgada (como la pantalla).
 */
export function textoAvisoAds(fila: FilaFichaCliente, c: ConfigTextoAds, ahoraMs: number = Date.now()): string | null {
  const v = armarVista(fila, ahoraMs)
  if (!v || !v.encabezado.esKickoff) return null
  const ficha = obj(fila.ficha)
  const zv = zonaVideoVigente(leerZonaVideo(fila.zona_video) ?? leerZonaVideo(ficha.zona_video), ahoraMs)
  const pm = (ficha.portfolio_meta && typeof ficha.portfolio_meta === 'object' ? ficha.portfolio_meta : null) as PortfolioMetaFicha | null

  const quien = c.valentino ? `<@${c.valentino}>` : 'Valentino'
  const cliente = `${txt(v.encabezado.cliente, 120)}${v.encabezado.verificado ? '' : ' (sin cruzar con el CRM)'}`
  const cabeza = `${quien} 🚀 **Para lanzar · ${cliente}**`
  const llamada = [v.encabezado.quien ? `Kickoff de ${txt(v.encabezado.quien, 60)}` : '', v.encabezado.fecha ?? '', v.encabezado.fathom ? `[Fathom](<${v.encabezado.fathom}>)` : '']
    .filter(Boolean).join(' · ')
  const link = linkFicha(c.urlBase, { recording_id: v.recording_id, cliente: { id_crm: v.encabezado.idCrm } as FichaKickoff['cliente'] }, c.pantalla)
  const tablero = `${c.urlBase.replace(/\/+$/, '')}/anuncios`
  const links = `👉 ${[link ? `[Ficha](<${link}>)` : '', `[Tablero de anuncios](<${tablero}>)`].filter(Boolean).join(' · ')}`

  // La cuenta: el act_… en código (se copia de un toque), el nombre, moneda y horario y, si entra, la página
  const idCuenta = pm?.cuenta && /^act_\d{1,25}$/.test(pm.cuenta) ? pm.cuenta : null
  const monedaHora = v.lanzar.monedaHora ? v.lanzar.monedaHora.split(' · ').filter(Boolean) : []
  const pagina = v.lanzar.pagina ? v.lanzar.pagina.replace(/^p[aá]gina[^:«]*:\s*/i, 'página ') : ''
  // Rama, a quién apuntar y la zona dicha (como en el aviso de #📝-kickoff)
  const nombreRama = v.rama.principal ?? 'sin definir'
  const ramaGrupos: GrupoAviso[] = [
    { items: v.rama.texto && norm(v.rama.texto) !== norm(nombreRama) ? [v.rama.texto] : [] },
    { prefijo: 'subramas: ', items: v.rama.subramas.map(d => subramaCorta(d.texto)), sep: '; ' },
  ]
  const avatarGrupos: GrupoAviso[] = [
    { items: v.avatar.incluye.map(d => sinParentesis(d.texto)) },
    { prefijo: '✋ afuera: ', items: v.avatar.excluye.map(d => sinParentesis(d.texto).replace(/^nada de\s+/i, '')) },
  ]
  // La zona: "Provincia de San Juan, Argentina:" delante (para no elegir una localidad homónima de otra provincia en Meta),
  // el "desde… hasta…" tal como se dijo (un área entre esos puntos) o los lugares, el radio y la distancia al estudio (en
  // los niveles con lugar: es contexto para el radio)
  const desc = v.zona.descripcion.texto
  const lugares = v.zona.lugares
  const area = lugares.length ? areaDicha(desc, lugares) : null
  const dichos = lugares.length
    ? [...(area ? [area.texto] : []), ...lugares.filter((_, i) => !area?.usados.has(i)).map(lugarAviso)]
    : desc.split(/;\s+/)
  const region = regionDeZona(desc)
  const pais = v.zona.pais ? NOMBRE_PAIS[v.zona.pais] ?? v.zona.pais : ''
  const regionYPais = [
    region && (lugares.length || !norm(desc).includes(norm(region))) ? region : '',
    pais && !(region && norm(region).includes(norm(pais))) ? pais : '',
  ].filter(Boolean).join(', ')
  const distancia = v.zona.contexto.find(d => RE_DISTANCIA.test(d.texto))?.texto ?? ''
  const radio = v.zona.radioKm !== null ? [`radio ${v.zona.radioKm} km`] : []
  const hayZona = [...dichos, ...radio].some(x => x.trim())
  const zonaGrupos = (n: NivelAds): GrupoAviso[] => [
    { ...(regionYPais ? { prefijo: `${txt(regionYPais, Math.min(n.item, 80))}: ` } : {}), items: dichos },
    { items: radio },
    { items: distancia && n.linea >= 180 ? [distancia] : [] },
  ]
  const mapa = gruposMapa(v, zv)
  const mo: Momento | null = v.zona.video?.momento ?? v.lanzar.zona.momento
  const pres = v.presupuesto
  const presGrupos: GrupoAviso[] = [
    { items: [`${v.lanzar.presupuesto}${pres.deducido ? ' (deducido)' : ''}`] },
    { items: pres.certeza === 'A confirmar' ? ['a confirmar'] : [] },
    // La cuenta factura en otra moneda que el presupuesto: hay que pasarlo al cargarlo
    { items: pm?.moneda && pres.moneda && pm.moneda !== pres.moneda ? [`la cuenta factura en ${pm.moneda}: pasarlo a ${pm.moneda} al cargarlo`] : [] },
  ]
  const presentarse = v.zona.presentarse

  const armar = (n: NivelAds, sin: ReadonlySet<ClaveRenglon> = new Set()): string => {
    const it = (x: string) => txt(x, n.item)
    const esc = (gs: GrupoAviso[]): GrupoAviso[] => gs.map(g => ({ ...g, items: g.items.map(y => y.replace(/\s+/g, ' ').trim()).filter(Boolean).map(it) }))
    const r: [ClaveRenglon, string][] = []
    if (llamada) r.push(['llamada', `📞 ${llamada}`])
    const cuenta = idCuenta
      ? [`\`${idCuenta}\`${pm?.nombre ? ` («${it(taparMails(pm.nombre))}»)` : ''}${pm && !pm.leido ? ' (Meta no la pudo leer)' : ''}`, ...monedaHora.map(it), ...(n.pagina && pagina ? [it(pagina)] : [])].join(' · ')
      : it(pm ? 'sin identificar en Meta: pedile el act_… a Tomi' : 'sin chequeo de Meta: pedile la cuenta a Tomi')
    r.push(['cuenta', `🏦 **Cuenta:** ${cuenta}`])
    const ramaTxt = encajar(esc(ramaGrupos), n.linea)
    r.push(['rama', `⚖️ **Rama:** ${it(nombreRama)}${ramaTxt ? ` — ${ramaTxt}` : ''}`])
    // Los filtros (antigüedad, en blanco…) no se segmentan en Meta: van en el copy
    r.push(['avatar', `👤 **A quién le habla (para el copy):** ${encajar(esc(avatarGrupos), n.avatar) || 'sin filtros'}`])
    r.push(['zona', `📍 **Zona:** ${hayZona ? encajar(esc(zonaGrupos(n)), n.linea) : 'sin definir'}`])
    if (mapa) r.push(['mapa', `🗺️ **Mapa:** ${encajar(esc(mapa), n.mapa)}${mo ? ` [▶ ${mo.etiqueta}](<${mo.href}>)` : ''}`])
    if (presentarse) {
      const p = `«${presentarse.texto}»`, conCuando = presentarse.cuando ? `${p} (${presentarse.cuando})` : p
      r.push(['presentarse', `🗣️ **Presentarse como:** ${it(conCuando.length <= Math.max(n.linea, 60) ? conCuando : p)}`])
    }
    r.push(['presupuesto', `💵 **Presupuesto:** ${encajar(esc(presGrupos), n.linea)}`])
    r.push(['lanzamiento', `📅 **Lanzamiento:** ${encajar(esc(gruposLanzamiento(v)), n.linea)}`])
    r.push(['portfolio', `🧾 **Portfolio:** ${encajar(esc(gruposPortfolio(v, pm, n.detalle)), n.portfolio)}`])
    const cuerpo = r.filter(([k]) => !sin.has(k)).map(([, t]) => t)
    const [primero, ...resto] = cuerpo
    return [cabeza, ...(primero?.startsWith('📞') ? [primero, '', ...resto] : ['', ...cuerpo]), '', links].join('\n')
  }
  for (const n of NIVELES_ADS) {
    const t = armar(n)
    if (t.length <= MAX_DISCORD) return t
  }
  // Recurso final: el último nivel sin los renglones menos importantes, de a uno (la cabecera y los links quedan)
  const ultimo = NIVELES_ADS[NIVELES_ADS.length - 1]
  const sin = new Set<ClaveRenglon>()
  for (const k of ORDEN_QUITAR) {
    sin.add(k)
    const t = armar(ultimo, sin)
    if (t.length <= MAX_DISCORD) return t
  }
  // No debería pasar (la cabecera está acotada): los links van siempre
  return `${cabeza.slice(0, Math.max(0, MAX_DISCORD - links.length - 3))}…\n\n${links}`.slice(0, MAX_DISCORD)
}

// ── La marca y cuándo está listo ──
export type MarcaAds =
  | { tipo: 'ninguna' }
  | { tipo: 'pendiente' | 'enviando' | 'dudoso' | 'error'; desde: number }
  | { tipo: 'enviado'; id: string }

/** La marca de la columna aviso_ads, leída con cuidado. Cualquier otro texto cuenta como "salió" (no se repite solo). */
export function leerMarcaAds(x: unknown): MarcaAds {
  if (typeof x !== 'string' || !x.trim()) return { tipo: 'ninguna' }
  const m = /^(pendiente|enviando|dudoso|error):([0-9]{1,15})$/.exec(x.trim())
  if (m) return { tipo: m[1] as 'pendiente' | 'enviando' | 'dudoso' | 'error', desde: Number(m[2]) }
  return { tipo: 'enviado', id: x.trim().slice(0, 40) }
}

export type PorQueListo = 'sin_lectura' | 'mapa_terminado' | 'lectura_vieja' | 'espera_vencida' | 'esperando_mapa'

/**
 * ¿Ya se puede mandar? Sí si no hay ninguna lectura del mapa guardada (no hubo mapa en pantalla, o es una ficha de antes:
 * en el bot, el pedido del video queda anotado en zona_video antes de disparar la lectura) o si terminó (ok, sin mapa, sin
 * video, sin key, error definitivo); si está pedida, leyendo o con un error pasajero (puede venir el reintento solo), se
 * espera hasta ESPERA_MAX_MAPA_MS desde que quedó pendiente (`desde`) o desde la última escritura de la lectura
 * (`generado`): una lectura vieja (un "pedido" o un error pasajero de hace horas, y el aviso pedido a mano ahora) no la está
 * leyendo nadie, y esperar 12 minutos más no cambia nada. Puro.
 */
export function avisoAdsListo(x: { zv: ZonaVideoFicha | null; desde: number; ahoraMs: number }): { listo: boolean; por: PorQueListo } {
  const zv = x.zv
  if (!zv) return { listo: true, por: 'sin_lectura' }
  if (ESTADOS_MAPA_HECHO.includes(zv.estado) || zv.estado === 'sin_key' || (zv.estado === 'error' && !zv.transitorio)) return { listo: true, por: 'mapa_terminado' }
  const escrita = Date.parse(zv.generado)
  if (Number.isFinite(escrita) && x.ahoraMs - escrita >= ESPERA_MAX_MAPA_MS) return { listo: true, por: 'lectura_vieja' }
  if (x.ahoraMs - x.desde >= ESPERA_MAX_MAPA_MS) return { listo: true, por: 'espera_vencida' }
  return { listo: false, por: 'esperando_mapa' }
}

// ── Mandarlo (una sola vez) ──
// enviado: salió (aviso_id) · ya_salio: la marca dice que salió antes · en_curso: otro lo tomó · esperando_mapa: la lectura
// del mapa sigue (lo manda la ruta del mapa al terminar, o el barrido) · sin_tiempo: no quedó tiempo (queda pendiente) ·
// no_corresponde: no hay aviso pendiente (fila de antes, no es lista, ficha ilegible) · dudoso / error: ver la marca ·
// apagado: sin KICKOFF_AVISO_ADS=1 o sin canal · dry: el texto, sin mandar nada
export type EstadoAvisoAds = 'enviado' | 'ya_salio' | 'en_curso' | 'esperando_mapa' | 'sin_tiempo' | 'no_corresponde' | 'dudoso' | 'error' | 'apagado' | 'dry'
export interface ResultadoAvisoAds { estado: EstadoAvisoAds; aviso_id?: string; motivo?: string; texto?: string | null; largo?: number; marca?: string | null }

export interface DepsAvisoAds extends ConfigTextoAds {
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  /** La fila con la marca (leerKickoff: lectura, no crea la tabla). */
  leer(id: number): Promise<FilaAvisoAds | undefined>
  /** Con condición: `previo` → `marca`, solo en una ficha lista; la fila o null (otro la tomó). */
  tomar(id: number, previo: string, marca: string): Promise<FilaAvisoAds | null>
  /** Con condición: deja `valor` si la marca sigue siendo `si`. */
  anotar(id: number, valor: string, si: string): Promise<boolean>
  /** A mano: "pendiente:<desdeMs>" (ver ponerAvisoAdsPendiente). */
  pendiente(id: number, desdeMs: number, op: { forzar: boolean; ahoraMs: number; recienteMs?: number }): Promise<boolean>
  /** Las pendientes desde `desdeMs` (para el barrido). */
  pendientes(limite: number, desdeMs: number): Promise<number[]>
  /** Manda UN mensaje (mencionando solo a `menciones`) sin pasarse del deadline y devuelve su id. */
  enviar(texto: string, menciones: string[], deadline: number): Promise<string>
  /** El aviso corto a Tomás en #📝-kickoff cuando el aviso a Valentino no salió y no se va a repetir solo (sin canal, no está). */
  avisarTomas?(texto: string, deadline: number): Promise<void>
  /** La mención de Tomás en ese aviso (null = "Tomás" en texto). */
  tomas?: string | null
  ahora(): number
}

export interface OpcionesIntentoAds {
  /** Hora límite (ms epoch) para mandar. Con menos de MIN_TIEMPO_ADS_MS no se toma (queda pendiente para el barrido). */
  deadline: number
  /** La lectura del mapa terminó o no hay ninguna en marcha: no se espera (procesar.ts sin lectura, la ruta del mapa al terminar). */
  listo?: boolean
  /** La lectura del mapa que manda (la ruta del mapa pasa la que acaba de guardar; si no, la de la columna). */
  zv?: ZonaVideoFicha | null
  /** Si falla para siempre (rechazado, dudoso, ficha ilegible), ¿se le avisa a Tomás? Por defecto sí; el modo manual, no. */
  avisarFalla?: boolean
}

function resultadoDeMarca(m: MarcaAds): ResultadoAvisoAds {
  switch (m.tipo) {
    case 'enviado': return { estado: 'ya_salio', aviso_id: m.id }
    case 'enviando': return { estado: 'en_curso', motivo: 'otro intento lo tomó (o se cortó a mitad): no se repite solo' }
    case 'dudoso': return { estado: 'dudoso', motivo: 'Discord no confirmó un envío anterior: puede haber salido (mirá #📣-ads; para mandarlo igual, aviso_ads=forzar)' }
    case 'error': return { estado: 'error', motivo: 'un envío anterior falló (Discord lo rechazó o la ficha no se pudo leer): revisar el webhook; para reintentar, aviso_ads=1' }
    default: return { estado: 'no_corresponde', motivo: 'no hay aviso pendiente (ficha de antes del aviso, o estaba apagado: se manda a mano con aviso_ads=1)' }
  }
}

/** Qué le pasó al aviso a Valentino, para el aviso corto a Tomás (y cómo reintentarlo). */
export type FallaAvisoAds = 'rechazado' | 'dudoso' | 'ilegible'

/**
 * El aviso corto a Tomás en #📝-kickoff cuando el «🚀 Para lanzar» no salió y no se repite solo: Discord lo rechazó (el
 * webhook de #📣-ads está vencido o se regeneró), no confirmó (puede haber salido) o la ficha guardada no se puede leer. Dice
 * cómo reintentarlo, en el estilo de los otros avisos de error (sin URLs ni claves: el motivo ya viene limpio). Puro.
 */
export function textoFallaAvisoAds(x: { id: number; cliente: string | null; falla: FallaAvisoAds; motivo: string; tomas: string | null }): string {
  const quien = x.tomas ? `<@${x.tomas}> ` : ''
  const de = x.cliente ? ` de «${escaparDiscord(corto(x.cliente.replace(/\s+/g, ' ').trim(), 120))}»` : ''
  const cmd = (modo: '1' | 'forzar') => `POST /api/bot/kickoff?recording_id=${x.id}&aviso_ads=${modo}`
  // El motivo se recorta ANTES de escapar (así el corte nunca cae en medio de un escape)
  const motivo = escaparDiscord(corto(x.motivo.replace(/\s+/g, ' ').trim(), 200))
  const que = x.falla === 'rechazado'
    ? `Discord lo rechazó (${motivo}): seguramente el webhook de #📣-ads se borró o se regeneró. Cuando esté el nuevo en Vercel, pedile a Claude que lo mande (${cmd('1')}).`
    : x.falla === 'dudoso'
      ? `Discord no confirmó el envío (${motivo}): puede haber salido. Fijate en #📣-ads; si no está, pedile a Claude que lo vuelva a mandar (${cmd('forzar')}).`
      : `la ficha guardada no se puede leer: revisala en la pantalla y, cuando esté bien, pedile a Claude que lo mande (${cmd('1')}). No se repite solo.`
  return `${quien}⚠️ No salió el aviso a Valentino «🚀 Para lanzar»${de} (grabación ${x.id}): ${que}`.slice(0, MAX_DISCORD)
}

/** Intenta mandar el aviso pendiente de una grabación. Nunca lanza: lo que falla queda en el resultado (y en el log). */
export async function intentarAvisoAds(id: number, deps: DepsAvisoAds, op: OpcionesIntentoAds): Promise<ResultadoAvisoAds> {
  try {
    const fila = await deps.leer(id)
    if (!fila) return { estado: 'no_corresponde', motivo: 'la grabación no está en el registro' }
    if (deps.clienteOperativo && !await deps.clienteOperativo(fila.id_crm, fila.cliente_crm ?? '')) return { estado: 'no_corresponde', motivo: 'Cliente archivado: aviso detenido' }
    const marca = leerMarcaAds(fila.aviso_ads)
    if (marca.tipo !== 'pendiente') return resultadoDeMarca(marca)
    if (fila.estado !== 'lista') return { estado: 'no_corresponde', motivo: `la ficha está «${fila.estado}», no lista` }
    const previo = String(fila.aviso_ads).trim()
    const ahora = deps.ahora()
    const zvFila = leerZonaVideo(fila.zona_video)
    if (!op.listo) {
      const l = avisoAdsListo({ zv: zonaVideoVigente(op.zv ?? zvFila, ahora), desde: marca.desde, ahoraMs: ahora })
      if (!l.listo) return { estado: 'esperando_mapa', marca: previo }
    }
    if (op.deadline - ahora < MIN_TIEMPO_ADS_MS) return { estado: 'sin_tiempo', motivo: 'no quedó tiempo para mandarlo: queda pendiente', marca: previo }
    const tomado = `enviando:${ahora}`
    const t = await deps.tomar(id, previo, tomado)
    if (!t) return { estado: 'en_curso', motivo: 'otro intento lo tomó primero' }
    const anotar = async (valor: string): Promise<void> => {
      try {
        if (!(await deps.anotar(id, valor, tomado))) console.warn(`kickoff-ads: grabación ${id}, la marca cambió antes de anotar ${valor.split(':')[0]}`)
      } catch (e) {
        console.error(`kickoff-ads: grabación ${id}, no se pudo anotar (${valor.split(':')[0]}) —`, motivoDe(e))
      }
    }
    // No sale y no se va a repetir solo: UN aviso corto a Tomás (la marca ya no es pendiente, así que no se repite). Nunca lanza
    const avisarFalla = async (falla: FallaAvisoAds, motivo: string): Promise<void> => {
      if (op.avisarFalla === false || !deps.avisarTomas) return
      try {
        await deps.avisarTomas(textoFallaAvisoAds({ id, cliente: t.cliente_crm ?? t.titulo, falla, motivo, tomas: deps.tomas ?? null }), op.deadline)
      } catch (e) {
        console.error(`kickoff-ads: grabación ${id}, tampoco salió el aviso a Tomás —`, motivoDe(e))
      }
    }
    // Ya tomada: si armar el texto lanza (una ficha rara), queda en error y no "enviando" para siempre
    let texto: string | null
    try {
      texto = textoAvisoAds({ ...t, zona_video: op.zv ?? t.zona_video }, deps, ahora)
    } catch (e) {
      console.error(`kickoff-ads: grabación ${id}, no se pudo armar el aviso a Valentino —`, motivoDe(e))
      texto = null
    }
    if (!texto) {
      await anotar(`error:${ahora}`)
      await avisarFalla('ilegible', '')
      return { estado: 'no_corresponde', motivo: 'la ficha guardada no se puede leer o no es un kickoff' }
    }
    let msg: string
    try {
      // El envío deja RESERVA_ANOTAR_MS antes del deadline para anotar cómo terminó
      msg = await deps.enviar(texto, deps.valentino ? [deps.valentino] : [], op.deadline - RESERVA_ANOTAR_MS)
    } catch (e) {
      const m = motivoDe(e)
      // Un timeout o un corte de red a mitad del pedido pudo haber publicado (la misma regla que el aviso de #📝-kickoff en
      // procesar.ts): no se repite solo. Un error pasajero que seguro no publicó (5xx, 429, sin tiempo) vuelve a pendiente
      // (lo toma el próximo barrido); uno definitivo (400, 404: el webhook) queda en error
      const dudoso = /no respondió|no se pudo conectar/i.test(m)
      const pasajero = (e as { transitorio?: unknown })?.transitorio === true
      await anotar(dudoso ? `dudoso:${ahora}` : pasajero ? previo : `error:${ahora}`)
      console.warn(`kickoff-ads: grabación ${id}, no salió el aviso a Valentino — ${m}`)
      if (dudoso || !pasajero) await avisarFalla(dudoso ? 'dudoso' : 'rechazado', m)
      return { estado: dudoso ? 'dudoso' : 'error', motivo: m, ...(pasajero && !dudoso ? { marca: previo } : {}) }
    }
    const aviso = msg || 'sin-id'
    await anotar(aviso)
    console.log(`kickoff-ads: grabación ${id}, aviso a Valentino ${aviso} (${texto.length} caracteres)`)
    return { estado: 'enviado', aviso_id: aviso, largo: texto.length }
  } catch (e) {
    // La base (leer o tomar): la marca queda como estaba (pendiente), para el próximo intento
    const m = motivoDe(e)
    console.warn(`kickoff-ads: grabación ${id}, no se pudo intentar el aviso a Valentino — ${m}`)
    return { estado: 'error', motivo: m }
  }
}

/**
 * El barrido: las pendientes de los últimos MAX_ANTIGUEDAD_PENDIENTE_MS (o solo `id`), con avisoAdsListo (espera la lectura
 * del mapa hasta ESPERA_MAX_MAPA_MS). Corre después de cada grabación del webhook, al final de cada lectura del mapa y en
 * el modo manual. Sin tiempo para mandar ni siquiera busca. Nunca lanza.
 */
export async function barrerAvisosAds(deps: DepsAvisoAds, op: { deadline: number; limite?: number; id?: number }): Promise<{ recording_id: number; ads: ResultadoAvisoAds }[]> {
  if (op.deadline - deps.ahora() < MIN_TIEMPO_ADS_MS) return []
  let ids: number[]
  try {
    ids = op.id !== undefined ? [op.id] : await deps.pendientes(op.limite ?? 3, deps.ahora() - MAX_ANTIGUEDAD_PENDIENTE_MS)
  } catch (e) {
    console.warn('kickoff-ads: no se pudieron buscar los avisos pendientes —', motivoDe(e))
    return []
  }
  const out: { recording_id: number; ads: ResultadoAvisoAds }[] = []
  for (const id of ids) {
    if (op.deadline - deps.ahora() < MIN_TIEMPO_ADS_MS) break
    out.push({ recording_id: id, ads: await intentarAvisoAds(id, deps, { deadline: op.deadline }) })
  }
  return out
}

/**
 * A mano (POST /api/bot/kickoff?recording_id=…&aviso_ads=1|forzar): `1` manda el que nunca salió (una ficha de antes) o
 * el que Discord rechazó, esperando la lectura del mapa si está en marcha; `forzar` lo vuelve a mandar ya, aunque haya
 * salido (salvo que otro lo esté mandando ahora). Con dry, solo el texto: no escribe ni manda nada. `deps` null = apagado o
 * sin canal (con dry igual devuelve el texto). Nunca lanza.
 */
export async function avisoAdsManual(id: number, modo: 'uno' | 'forzar', op: {
  dry: boolean; deps: DepsAvisoAds | null; leer: (id: number) => Promise<FilaAvisoAds | undefined>; config: ConfigTextoAds; deadline: number; ahora?: () => number
}): Promise<ResultadoAvisoAds> {
  const ahora = op.ahora ?? Date.now
  try {
    if (op.dry) {
      const fila = await op.leer(id)
      if (!fila) return { estado: 'no_corresponde', motivo: 'la grabación no está en el registro' }
      const texto = textoAvisoAds(fila, op.config, ahora())
      return texto
        ? { estado: 'dry', texto, largo: texto.length, marca: fila.aviso_ads ?? null }
        : { estado: 'no_corresponde', motivo: 'la ficha no es un kickoff legible', marca: fila.aviso_ads ?? null }
    }
    if (!op.deps) return { estado: 'apagado', motivo: 'el aviso a Valentino en la kickoff está apagado (sale con los videos editados; KICKOFF_AVISO_ADS=1 lo prende) o no hay canal (DISCORD_WEBHOOK_KICKOFF_ADS / DISCORD_WEBHOOK_ANUNCIOS)' }
    const forzar = modo === 'forzar'
    const t = op.deps.ahora()
    await op.deps.pendiente(id, t, { forzar, ahoraMs: t, recienteMs: ENVIO_RECIENTE_MS })
    // Si falla, la respuesta lo dice: no hace falta avisarle a Tomás por Discord
    return await intentarAvisoAds(id, op.deps, { deadline: op.deadline, listo: forzar, avisarFalla: false })
  } catch (e) {
    return { estado: 'error', motivo: motivoDe(e) }
  }
}

// ── Para el GET de estado ──
export interface AvisoAdsARevisar {
  recording_id: number
  que: 'rechazado' | 'dudoso' | 'colgado' | 'pendiente_viejo'
  detalle: string
  /** Lo que se le agrega a POST /api/bot/kickoff?recording_id=… para reintentarlo. */
  reintentar: string
}

/**
 * De las filas del GET de estado (las últimas), los avisos a Valentino que hay que mirar: Discord los rechazó, no confirmó,
 * quedaron "enviando" más de ENVIO_RECIENTE_MS (la invocación se cortó a mitad) o pendientes más de PENDIENTE_VIEJO_MS (no
 * hubo barrido). Puro.
 */
export function revisarAvisosAds(filas: { recording_id: number; estado?: string; aviso_ads?: string | null }[], ahoraMs: number): AvisoAdsARevisar[] {
  const out: AvisoAdsARevisar[] = []
  for (const f of filas) {
    const m = leerMarcaAds(f.aviso_ads)
    if (m.tipo === 'error') out.push({ recording_id: f.recording_id, que: 'rechazado', detalle: 'Discord lo rechazó o la ficha no se pudo leer: revisar el webhook de #📣-ads', reintentar: '&aviso_ads=1' })
    else if (m.tipo === 'dudoso') out.push({ recording_id: f.recording_id, que: 'dudoso', detalle: 'Discord no confirmó: mirar en #📣-ads si salió', reintentar: '&aviso_ads=forzar' })
    else if (m.tipo === 'enviando' && ahoraMs - m.desde > ENVIO_RECIENTE_MS) out.push({ recording_id: f.recording_id, que: 'colgado', detalle: 'quedó a mitad del envío (la invocación se cortó): mirar en #📣-ads si salió', reintentar: '&aviso_ads=forzar' })
    else if (m.tipo === 'pendiente' && ahoraMs - m.desde > PENDIENTE_VIEJO_MS) out.push({ recording_id: f.recording_id, que: 'pendiente_viejo', detalle: 'pendiente hace más de una hora: no hubo barrido (no llegaron grabaciones)', reintentar: '&aviso_ads=1' })
  }
  return out
}

/**
 * ¿Existe el webhook del canal? Un GET al webhook: Discord devuelve sus datos SIN publicar nada. true = existe; false = 401,
 * 403 o 404 (se borró o se regeneró: cada aviso terminaría en "rechazado"); null = no se pudo comprobar (red, 5xx, 429).
 * Nunca devuelve ni loguea la URL ni lo que contesta Discord (trae el token). Nunca lanza.
 */
export async function comprobarCanalAds(webhook: string, op: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<{ ok: boolean | null; motivo?: string }> {
  if (!webhook) return { ok: false, motivo: 'no hay canal' }
  let res: Response
  try {
    res = await (op.fetch ?? fetch)(webhook, { method: 'GET', signal: AbortSignal.timeout(op.timeoutMs ?? 5_000), cache: 'no-store' })
  } catch (e) {
    const n = (e as Error)?.name
    return { ok: null, motivo: n === 'TimeoutError' || n === 'AbortError' ? 'Discord no respondió' : 'no se pudo conectar con Discord' }
  }
  await res.body?.cancel().catch(() => {})
  if (res.ok) return { ok: true }
  if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, motivo: `Discord respondió ${res.status}: el webhook no existe (se borró o se regeneró)` }
  return { ok: null, motivo: `Discord respondió ${res.status}` }
}

// ── Dependencias reales ──
/** Lo del entorno para el texto (también sin canal: el texto en seco). */
export function configAvisoAds(): ConfigTextoAds {
  return { valentino: idValentino(), urlBase: urlDespacho(), pantalla: pantallaFicha() }
}

/**
 * Las dependencias reales (Neon y Discord), o null si el aviso está apagado (sin KICKOFF_AVISO_ADS=1) o no hay canal. Si falla
 * para siempre, el aviso corto va a Tomás en #📝-kickoff (DISCORD_WEBHOOK_KICKOFF, mencionándolo solo a él); sin ese canal,
 * queda solo en el log.
 */
export function depsAvisoAdsReales(): DepsAvisoAds | null {
  const webhook = webhookKickoffAds()
  if (!avisoAdsEncendido() || !webhook) return null
  const kickoff = webhookKickoff()
  const tomas = mencionesKickoff().tomi
  return {
    ...configAvisoAds(),
    clienteOperativo,
    leer: id => leerKickoff(id),
    tomar: tomarAvisoAds,
    anotar: anotarAvisoAds,
    pendiente: ponerAvisoAdsPendiente,
    pendientes: pendientesAvisoAds,
    enviar: async (texto, menciones, deadline) => {
      const [id] = await enviarDiscord(webhook, [texto], menciones, { deadline, reintentos429: 1 })
      return id ?? ''
    },
    ...(kickoff ? {
      avisarTomas: async (texto: string, deadline: number) => { await enviarDiscord(kickoff, [texto], tomas ? [tomas] : [], { deadline, reintentos429: 1 }) },
      tomas,
    } : {}),
    ahora: () => Date.now(),
  }
}
