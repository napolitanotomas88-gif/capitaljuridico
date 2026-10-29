// ── Registro de hitos de cada cliente (puro: sin red ni base; lo prueba scripts/test-clientes-recorrido.mjs) ─────────────
// Pedido de Tomás (25/10/2026): "llevar literalmente el registro de todo" en la tarjeta del cliente: cuándo fue el kickoff,
// cuándo se hicieron los guiones, la primera revisión, cuándo grabó (subió los crudos), cuándo se editó, cuándo se lanzó la
// campaña y cuándo tuvimos éxito. Cada hito se completa SOLO con lo que muestran las fuentes (aunque no haya Fathom de la
// kickoff: si hay guiones en Drive o campaña en Meta, la kickoff ya pasó) y se puede anotar o corregir a mano (tabla
// cj_hitos, lib/clientes/hitosRegistro.ts). Lo anotado a mano manda sobre lo automático.
//   · Fuentes por hito: CRM (Día 1, renovación), Despacho (ficha de kickoff, tandas de guiones, videos), Drive (doc de
//     guiones, carpetas de crudos y editados), Meta (último lanzamiento), ClickUp (subtareas de guiones, etapa) y Seguimiento
//     (puntaje de 8 o más).
//   · Un hito posterior hecho implica los anteriores: si grabó, hubo guiones y kickoff aunque no se sepa la fecha (se
//     marca "hecho, sin fecha", inferido).
//   · etapaPorHitos: la etapa que sale del último hito hecho (la usa recorrido.ts junto con el resto de las reglas).
import type { Etapa } from './recorrido'
import type { Ymd } from './fechas'

export const HITOS = ['alta', 'kickoff', 'guiones', 'revision', 'grabacion', 'edicion', 'lanzamiento', 'exito', 'renovacion'] as const
export type ClaveHito = (typeof HITOS)[number]
export const NOMBRE_HITO: Record<ClaveHito, string> = {
  alta: 'Alta', kickoff: 'Kickoff', guiones: 'Guiones hechos', revision: 'Primera revisión del cliente', grabacion: 'Grabó (subió los crudos)',
  edicion: 'Videos editados', lanzamiento: 'Campaña lanzada', exito: 'Éxito', renovacion: 'Renovó',
}
export const esClaveHito = (v: unknown): v is ClaveHito => typeof v === 'string' && (HITOS as readonly string[]).includes(v)

export type FuenteHito = 'crm' | 'despacho' | 'drive' | 'meta' | 'clickup' | 'seguimiento' | 'exito_bot' | 'manual' | 'inferido'
export const NOMBRE_FUENTE_HITO: Record<FuenteHito, string> = {
  crm: 'CRM', despacho: 'Despacho', drive: 'Drive', meta: 'Meta', clickup: 'ClickUp', seguimiento: 'Seguimiento', exito_bot: 'Bot de Éxito (OK en Verificaciones)', manual: 'Anotado a mano', inferido: 'Se deduce de lo que sigue',
}

export interface HitoManual { hito: ClaveHito; fecha: Ymd | null; nota: string; quien: string; cuando: string }
export interface Hito {
  clave: ClaveHito
  hecho: boolean
  fecha: Ymd | null
  fuente: FuenteHito | null
  detalle: string           // "Doc «Guiones - X» de Drive", "Tanda 1 aprobada", "último crudo subido"…
  manual: HitoManual | null // lo anotado a mano (manda sobre lo automático)
}

// Lo que cada fuente sabe del cliente (todo opcional: con una fuente caída, ese dato no está)
export interface EvidenciaHitos {
  dia1: Ymd | null
  renovo: string                                   // texto crudo del CRM: 'R1', 'NO', 'R1 +2 meses'…
  inicioPeriodo2: Ymd | null                       // Día 1 del período 1 (la primera renovación paga), si existe
  kickoff: Ymd | null                              // fecha de la ficha de kickoff (Despacho)
  // creado: la primera tanda que el equipo aprobó o mandó (una tanda «a revisar» todavía no son guiones hechos)
  tanda: { creado: Ymd | null; estado: string; aprobada: Ymd | null; enviada: Ymd | null; notaCliente?: Ymd | null } | null
  videos: { crudos: Ymd | null; editados: Ymd | null } | null   // PRIMER crudo y primer editado que llegaron (Despacho)
  // crudos / editados: el PRIMER archivo de cada carpeta (el registro es histórico: la primera vez que pasó)
  drive: { guion: Ymd | null; guionCreado: Ymd | null; crudos: Ymd | null; editados: Ymd | null } | null
  clickupGuiones: Ymd | null                       // primera subtarea "Guion N" hecha
  lanzamiento: Ymd | null                          // Meta: el PRIMER lanzamiento que se conoce (la etapa usa el último, aparte)
  campanaActiva: boolean
  exito: Ymd | null                                // día del PRIMER puntaje de 8 o más (con la promesa no incumplida)
  exitoBot?: { fecha: Ymd | null; testimonio: Ymd | null; por: string | null } | null   // OK del bot de Éxito (cj_exito_pedidos)
  manuales: HitoManual[]
}

const primera = (...xs: (Ymd | null | undefined)[]): Ymd | null => xs.filter((x): x is Ymd => !!x).sort()[0] ?? null
const ultima = (...xs: (Ymd | null | undefined)[]): Ymd | null => xs.filter((x): x is Ymd => !!x).sort().pop() ?? null
type Auto = { fecha: Ymd | null; fuente: FuenteHito; detalle: string } | null

/** Lo que dicen las fuentes de cada hito (sin lo manual ni lo inferido). */
function automatico(e: EvidenciaHitos): Record<ClaveHito, Auto> {
  const t = e.tanda, d = e.drive, v = e.videos
  // Guiones hechos = la primera aprobación, envío o nota del cliente; la creación de esa tanda, solo como último recurso
  const guiones: Auto = t?.creado
    ? { fecha: primera(t.aprobada, t.enviada, t.notaCliente) ?? t.creado, fuente: 'despacho', detalle: 'Primera tanda de guiones aprobada o enviada (Despacho)' }
    // El doc «Guiones - X» se crea vacío con el alta (Aylén, el mismo día): solo cuenta si se editó un día POSTERIOR a crearlo
    : d?.guion && d.guionCreado && d.guion > d.guionCreado ? { fecha: d.guion, fuente: 'drive', detalle: 'Doc de guiones en Drive (última edición)' }
    : e.clickupGuiones ? { fecha: e.clickupGuiones, fuente: 'clickup', detalle: 'Subtarea de guion hecha en ClickUp' } : null
  // La revisión es del CLIENTE: su primera nota sobre los guiones o, si no hay, el primer envío (la aprobación interna no cuenta)
  const revision: Auto = t?.notaCliente ? { fecha: t.notaCliente, fuente: 'despacho', detalle: 'Primera nota del cliente sobre los guiones' }
    : t?.enviada ? { fecha: t.enviada, fuente: 'despacho', detalle: 'Guiones enviados al cliente' } : null
  // El registro es histórico: la PRIMERA vez que llegó un crudo o un editado, entre el Despacho y Drive
  const crudos = primera(v?.crudos, d?.crudos)
  const editados = primera(v?.editados, d?.editados)
  const renovo = /^r\d/i.test(e.renovo.trim())
  return {
    alta: e.dia1 ? { fecha: e.dia1, fuente: 'crm', detalle: 'Día 1 en el CRM' } : null,
    kickoff: e.kickoff ? { fecha: e.kickoff, fuente: 'despacho', detalle: 'Ficha de kickoff (Fathom)' } : null,
    guiones,
    revision,
    grabacion: crudos ? { fecha: crudos, fuente: v?.crudos && v.crudos === crudos ? 'despacho' : 'drive', detalle: 'Último crudo subido' } : null,
    edicion: editados ? { fecha: editados, fuente: v?.editados && v.editados === editados ? 'despacho' : 'drive', detalle: 'Último video editado' } : null,
    lanzamiento: e.lanzamiento ? { fecha: e.lanzamiento, fuente: 'meta', detalle: e.campanaActiva ? 'Campaña activa en Meta' : 'Lanzó; hoy sin anuncios activos' } : null,
    // El OK del bot de Éxito (Tomás o Gero A en Verificaciones) manda sobre el puntaje
    exito: e.exitoBot ? { fecha: e.exitoBot.fecha, fuente: 'exito_bot', detalle: `OK${e.exitoBot.por ? ` de ${e.exitoBot.por}` : ''}${e.exitoBot.testimonio ? ` · testimonio recibido el ${e.exitoBot.testimonio.split('-').reverse().join('/')}` : ''}` }
      : e.exito ? { fecha: e.exito, fuente: 'seguimiento', detalle: 'Puntaje de 8 o más y la promesa cumplida' } : null,
    renovacion: renovo ? { fecha: e.inicioPeriodo2, fuente: 'crm', detalle: `Renovó (${e.renovo.trim()})` } : null,
  }
}

/** Los 9 hitos del cliente: lo manual manda; si un hito posterior está hecho, los anteriores se dan por hechos. */
export function hitosDelCliente(e: EvidenciaHitos): Hito[] {
  const auto = automatico(e)
  const manual = new Map(e.manuales.map(m => [m.hito, m]))
  const base = HITOS.map((clave): Hito => {
    const m = manual.get(clave)
    const a = auto[clave]
    // Anotado SIN fecha y la fuente sí la sabe: se conserva la fecha automática (no se pisa con vacío)
    if (m) return { clave, hecho: true, fecha: m.fecha ?? a?.fecha ?? null, fuente: 'manual', detalle: m.nota || 'Anotado a mano', manual: m }
    return a ? { clave, hecho: true, fecha: a.fecha, fuente: a.fuente, detalle: a.detalle, manual: null } : { clave, hecho: false, fecha: null, fuente: null, detalle: '', manual: null }
  })
  // Inferidos: del alta a la campaña, un hito hecho implica los anteriores. Éxito y renovación NO infieren nada hacia atrás
  // (un 9 en Seguimiento o una renovación no prueban que se grabó o se lanzó la tanda actual)
  const cadena: ClaveHito[] = ['alta', 'kickoff', 'guiones', 'grabacion', 'edicion', 'lanzamiento']
  const ultimoHecho = Math.max(...cadena.map((k, i) => (base.find(h => h.clave === k)!.hecho ? i : -1)))
  return base.map(h => {
    const i = cadena.indexOf(h.clave)
    if (h.hecho || i < 0 || i >= ultimoHecho) return h
    return { ...h, hecho: true, fuente: 'inferido', detalle: `Se deduce: ya hay «${NOMBRE_HITO[cadena[ultimoHecho]]}»` }
  })
}

/** La etapa que sale del último hito hecho del recorrido (null = ninguno además del alta). */
// anotado: el día en que se anotó a mano (si el hito que da la etapa es manual): lo que está en curso le gana solo si es posterior
export function etapaPorHitos(hitos: Hito[]): { etapa: Etapa; desde: Ymd | null; detalle: string; fuente: FuenteHito | null; anotado: Ymd | null } | null {
  const h = (k: ClaveHito) => hitos.find(x => x.clave === k)!
  const conFecha = (k: ClaveHito) => (h(k).fuente === 'inferido' ? null : h(k).fecha)
  const anotadoEl = (k: ClaveHito): Ymd | null => {
    const c = h(k).manual?.cuando
    const d = c ? new Date(c) : null
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) : null
  }
  const de = (k: ClaveHito, etapa: Etapa, detalle: string, desde: Ymd | null = conFecha(k)) => ({ etapa, desde, detalle: `${detalle} (${NOMBRE_FUENTE_HITO[h(k).fuente ?? 'inferido']})`, fuente: h(k).fuente, anotado: anotadoEl(k) })
  if (h('lanzamiento').hecho) return de('lanzamiento', 'lanzado', 'Campaña lanzada')
  if (h('edicion').hecho) return de('edicion', 'por_lanzar', 'Videos editados: falta lanzar')
  if (h('grabacion').hecho) return de('grabacion', 'edicion', 'Grabó: falta editar')
  if (h('revision').hecho || h('guiones').hecho) return de(h('revision').hecho ? 'revision' : 'guiones', 'grabacion', 'Guiones hechos: falta grabar', ultima(conFecha('revision'), conFecha('guiones')))
  if (h('kickoff').hecho) return de('kickoff', 'kickoff', 'Kickoff hecho: faltan los guiones')
  return null
}

/** Para la tarjeta: los hitos en orden con su texto de fecha. */
export const textoFechaHito = (h: Hito): string => (!h.hecho ? 'Pendiente' : h.fecha ? h.fecha.split('-').reverse().join('/') : 'Hecho, sin fecha')
export { primera as primeraFecha }
