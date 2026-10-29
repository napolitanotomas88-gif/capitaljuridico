// ── Bot C.J., etapa Anuncios: seguimiento de lanzamientos y optimizaciones (g04, g05, g06) ───────────
// Pedido de Tomás (24/10/2026). El tablero de anuncios (lib/anuncios/tablero.ts) ya arma el ciclo de cada campaña: día 1 =
// anuncios nuevos, desde el día 4 "Revisar para optimizar" hasta que se confirma con «Ya optimicé», 7 días de "mejores
// compitiendo" y "Revisar ganador final" hasta «Ya revisé». Esto agrega, una vez por ciclo y en #📣-ads:
//   · optimizar (g05): al día 4–7 sin optimización, un recordatorio a Valentino con cada anuncio, su costo por mensaje y
//     qué apagar según la rama;
//   · ganadores (g06): a los 7–10 días de la optimización, sin la revisión final, cuáles dejar (1 o 2) y cuáles apagar;
//   · optimizada: cuando la optimización (o la revisión final) quedó hecha, el texto para avisarle al cliente. "Hecha" es
//     el botón del tablero o lo que se ve en el historial de Meta: una PERSONA (no "Meta") pausó un anuncio o un conjunto
//     de la tanda del ciclo (o, solo en la del día 4, le cambió el presupuesto) desde el día 3 y quedó algo prendido (ver
//     detectarAccion). En ese caso el bot la registra solo en «Ads Optimizaciones» (columna origen) para que el tablero
//     avance;
//   · lanzada (g04): el día 1–3 de una campaña nueva (o de videos nuevos en una que ya corría), el texto para el cliente.
//     Una campaña vieja que se reactiva no se avisa (un borrador que se prende días después de armarlo, sí).
// Los textos para el cliente van a Valentino hasta que el bot tenga WhatsApp (Whapi): él los pega en el grupo de ventas.
// Todo lo de acá es puro (sin red): procesar.ts lo orquesta.
import type { FilaAnuncio, Tablero } from '@/lib/anuncios/tablero'
import { diasEntre, dm, sumarDias } from '@/lib/anuncios/formato'
import { escaparDiscord } from '@/lib/fathomAnuncios/mensaje'

export type LanzamientoFila = FilaAnuncio['lanzamientos'][number]
export type FilaCandidato = Pick<FilaAnuncio, 'id' | 'cliente' | 'clienteCRM' | 'cuenta' | 'moneda' | 'usdPor' | 'rama' | 'links'>
export type TipoAviso = 'lanzada' | 'optimizar' | 'ganadores' | 'optimizada'
export type SubtipoHecha = 'optimizacion' | 'ganadores'

export interface Candidato {
  tipo: TipoAviso
  clave: string                    // una sola vez por campaña y ciclo (cj_anuncios_avisos)
  fila: FilaCandidato
  l: LanzamientoFila
  desde: string                    // AAAA-MM-DD: desde cuándo se miden los anuncios
  subtipo?: SubtipoHecha           // optimizada: la del día 4 o la final (ganadores)
  hecha?: { fecha: string; origen: 'tablero' | 'meta'; quien?: string; resumen?: string }
  rotacion?: boolean               // lanzada: videos nuevos en una campaña que ya corría
}

// Ventanas (días del ciclo): pasadas, el aviso ya no sale (no se avisa historia vieja al publicar esto)
export const DIA_OPTIMIZAR = { desde: 4, hasta: 7 }
export const DIA_GANADORES = { desde: 7, hasta: 10 }
export const REVISION_FINAL = { desde: 7, hasta: 11 }   // «Ya revisé» a 7–11 días de la optimización = la revisión final (el tablero cierra a los 7)
export const DIAS_PRIMERA_OPTIMIZACION = 10             // una optimización a más de 10 días del lanzamiento ya no es "la del día 4" (es una revisión semanal)
export const DIAS_TANDA = 2                             // la tanda del ciclo: anuncios creados entre l.fecha y 2 días después
export const DIAS_BORRADOR = 3                          // anuncios armados hasta 3 días antes de prender la campaña = un borrador que se lanzó, no una reactivación

/** Se prendió de nuevo una campaña que ya había corrido (no un borrador que se lanzó): no se le avisa al cliente. */
export const esReactivacion = (l: LanzamientoFila): boolean => !!l.reactivada && l.reactivada === l.fecha && (!l.creada || diasEntre(l.creada, l.reactivada) > DIAS_BORRADOR)
export const DIAS_AVISO_HECHA = 3        // una optimización registrada en los últimos 3 días (si el aviso no salió, sale al otro día; la segunda llave evita dobles)
export const DIAS_LANZADA = 3            // día 1 a 3 (cuando ya gasta: una en revisión o sin entregar todavía no se avisa)
export const MIN_GASTO_USD = 3           // con menos gasto, un anuncio "todavía no dice nada"
export const MAX_AVISOS_POR_CORRIDA = 15

const claveDe = (tipo: string, l: LanzamientoFila, fecha: string) => `${tipo}:${l.campanaId}:${fecha}`

/** Qué toca hoy, campaña por campaña. Una campaña da como mucho un aviso por corrida (el más avanzado del ciclo). Las
 *  lanzadas de un mismo cliente se juntan al mandarlas (procesar.ts), cada una con su clave. Una cuenta pausada o con
 *  error de pago no da avisos (no corre nada, y el tablero ya alerta el pago). */
export function candidatos(t: Pick<Tablero, 'hoy' | 'filas'>): Candidato[] {
  const hoy = t.hoy
  const out: Candidato[] = []
  for (const f of t.filas) {
    if (f.pausado || f.pago?.errorPago) continue
    const fila: FilaCandidato = { id: f.id, cliente: f.cliente, clienteCRM: f.clienteCRM, cuenta: f.cuenta, moneda: f.moneda, usdPor: f.usdPor, rama: f.rama, links: f.links }
    for (const l of f.lanzamientos) {
      const opt = l.fechaOptimizacion, rev = l.fechaRevision
      // La revisión final: «Ya revisé» a 7–11 días de la optimización (la revisión semanal de las DM no se le avisa al cliente)
      const primera = !!opt && diasEntre(l.fecha, opt) <= DIAS_PRIMERA_OPTIMIZACION   // la optimización del día 4 de este ciclo
      if (opt && primera && rev && rev >= opt && diasEntre(opt, rev) >= REVISION_FINAL.desde && diasEntre(opt, rev) <= REVISION_FINAL.hasta && diasEntre(rev, hoy) <= DIAS_AVISO_HECHA) {
        out.push({ tipo: 'optimizada', subtipo: 'ganadores', clave: claveDe('ganadores-hecha', l, rev), fila, l, desde: opt, hecha: { fecha: rev, origen: 'tablero' } })
      } else if (opt && primera && (!rev || rev < opt) && diasEntre(opt, hoy) <= DIAS_AVISO_HECHA) {
        out.push({ tipo: 'optimizada', subtipo: 'optimizacion', clave: claveDe('optimizada', l, opt), fila, l, desde: l.fecha, hecha: { fecha: opt, origen: 'tablero' } })
      } else if (l.etapa === 'ganador' && opt && primera && l.diasCompetencia >= DIA_GANADORES.desde && l.diasCompetencia <= DIA_GANADORES.hasta) {
        out.push({ tipo: 'ganadores', clave: claveDe('ganadores', l, opt), fila, l, desde: opt })
      } else if (l.pendienteRevision && !opt && l.dia >= DIA_OPTIMIZAR.desde && l.dia <= DIA_OPTIMIZAR.hasta) {
        out.push({ tipo: 'optimizar', clave: claveDe('optimizar', l, l.fecha), fila, l, desde: l.fecha })
      } else if (!opt && !esReactivacion(l) && l.anuncios > 0 && l.dia >= 1 && l.dia <= DIAS_LANZADA && ((l.gasto ?? 0) > 0 || (l.mensajes ?? 0) > 0)) {
        out.push({ tipo: 'lanzada', clave: claveDe('lanzada', l, l.fecha), fila, l, desde: l.fecha, rotacion: !l.reactivada && !!l.inicioCompetencia && l.inicioCompetencia < l.fecha })
      }
    }
  }
  return out
}

// ── Lo que se lee de Meta para una campaña (metaDetalle.ts) ──
export interface AnuncioCampana { id: string; nombre: string; conjunto: string; activo: boolean; creado: string | null }   // creado: AAAA-MM-DD (AR)
export interface MetricaAnuncio { gasto: number; mensajes: number }   // moneda de la cuenta
// fecha: hora de Argentina, 'AAAA-MM-DDTHH:MM' (se compara como texto con un 'AAAA-MM-DD')
export interface EventoMeta { tipo: string; objeto: string; nombre: string; quien: string; fecha: string; viejo: number | null; nuevo: number | null }
export interface DetalleCampana {
  anuncios: AnuncioCampana[]
  metricas: Record<string, MetricaAnuncio>          // por id de anuncio, desde Candidato.desde (un activo sin fila = no entregó)
  metricasOk?: boolean                              // Meta devolvió gasto Y mensajes (si no, no se arma ninguna métrica)
  eventos: EventoMeta[] | null                      // null = no se pudo leer el historial
}

// Estados apagados del run_status de activities (verificado con datos reales del 24/10): un ANUNCIO pausado queda en 8
// ("Inactivo"); un CONJUNTO, en 7; eliminado, 3 en los dos. (1 activo, 9 en revisión, 17 procesando, 4 no aprobado.)
const APAGADO = { update_ad_run_status: new Set([8, 3]), update_ad_set_run_status: new Set([7, 3]) } as const
const esPersona = (q: string) => !!q.trim() && !/^meta$/i.test(q.trim())

/**
 * Lo que hizo una persona en la campaña desde `desde` (AAAA-MM-DD, hora de Argentina) sobre la TANDA del ciclo (anuncios
 * creados entre `tanda.desde` y `tanda.hasta`, y sus conjuntos): apagar anuncios o conjuntos que estaban prendidos (al
 * menos uno; con `conPresupuesto`, el resumen suma los cambios de presupuesto). Tiene que quedar al menos un anuncio
 * prendido (si no, se frenó, no se optimizó). No cuenta pausar la campaña entera, ni lo que hace Meta solo (revisiones, aprobaciones), ni tandas viejas o
 * nuevas de la misma campaña. Devuelve null si no hubo nada.
 */
export function detectarAccion(d: DetalleCampana, desde: string, op: { tanda: { desde: string; hasta: string }; conPresupuesto: boolean }): { fecha: string; quien: string; resumen: string } | null {
  if (!d.eventos || !d.anuncios.some(a => a.activo)) return null
  const deLaTanda = d.anuncios.filter(a => !a.creado || (a.creado >= op.tanda.desde && a.creado <= op.tanda.hasta))
  const anuncios = new Set(deLaTanda.map(a => a.id)), conjuntos = new Set(deLaTanda.map(a => a.conjunto))
  const propios = d.eventos.filter(e => e.fecha >= desde && esPersona(e.quien)
    && ((e.tipo === 'update_ad_run_status' && anuncios.has(e.objeto)) || ((e.tipo === 'update_ad_set_run_status' || e.tipo === 'update_ad_set_budget') && conjuntos.has(e.objeto))))
  const pausas = propios.filter(e => {
    if (e.tipo !== 'update_ad_run_status' && e.tipo !== 'update_ad_set_run_status') return false
    const apagado = APAGADO[e.tipo]
    return e.viejo !== null && e.nuevo !== null && !apagado.has(e.viejo) && apagado.has(e.nuevo)
  })
  // Optimizar = apagar los caros (Tomás): sin ninguna pausa no está hecha. Los cambios de presupuesto solo van al resumen
  if (!pausas.length) return null
  const presupuestos = op.conPresupuesto ? propios.filter(e => e.tipo === 'update_ad_set_budget') : []
  const todos = [...pausas, ...presupuestos].sort((a, b) => a.fecha.localeCompare(b.fecha))
  const quienes = [...new Set(todos.map(e => e.quien.trim()))]
  const nA = new Set(pausas.filter(e => e.tipo === 'update_ad_run_status').map(e => e.objeto)).size
  const nC = new Set(pausas.filter(e => e.tipo === 'update_ad_set_run_status').map(e => e.objeto)).size
  const nP = new Set(presupuestos.map(e => e.objeto)).size
  const partes = [
    nC ? `pausó ${nC} conjunto${nC > 1 ? 's' : ''}` : '',
    nA ? `pausó ${nA} anuncio${nA > 1 ? 's' : ''}` : '',
    nP ? `cambió el presupuesto de ${nP} conjunto${nP > 1 ? 's' : ''}` : '',
  ].filter(Boolean)
  return { fecha: todos[0].fecha.slice(0, 10), quien: quienes.join(' y '), resumen: partes.join(', ') }
}

// ── Cada anuncio, en USD, contra los umbrales de la rama del cliente ──
export type Nivel = 'bien' | 'mirar' | 'apagar' | 'sin_datos'
export interface FilaMetrica { id: string; nombre: string; activo: boolean; gastoUSD: number; mensajes: number; cpl: number | null; nivel: Nivel }

export function metricasUSD(fila: Pick<FilaCandidato, 'usdPor' | 'rama'>, d: DetalleCampana, soloActivos: boolean): FilaMetrica[] {
  const umbral = fila.rama?.umbral ?? { ok: 2.8, medio: 4 }
  const div = fila.usdPor && fila.usdPor > 0 ? fila.usdPor : null
  if (div === null || d.metricasOk === false) return []
  return d.anuncios.filter(a => !soloActivos || a.activo).flatMap(a => {
    const m = d.metricas[a.id] ?? (a.activo ? { gasto: 0, mensajes: 0 } : null)   // activo sin datos = todavía no entregó
    if (!m) return []
    const gastoUSD = m.gasto / div
    const cpl = m.mensajes > 0 ? gastoUSD / m.mensajes : null
    const nivel: Nivel = gastoUSD < MIN_GASTO_USD && (cpl === null || cpl <= umbral.medio) ? 'sin_datos'
      : cpl === null ? (gastoUSD >= umbral.ok * 2 ? 'apagar' : 'sin_datos')
        : cpl <= umbral.ok ? 'bien' : cpl <= umbral.medio ? 'mirar' : 'apagar'
    return [{ id: a.id, nombre: a.nombre, activo: a.activo, gastoUSD, mensajes: m.mensajes, cpl, nivel }]
  }).sort((x, y) => (x.cpl ?? Infinity) - (y.cpl ?? Infinity) || y.mensajes - x.mensajes)
}

const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: n < 10 ? 2 : 0, maximumFractionDigits: n < 10 ? 2 : 0 })}`
const nombreAnuncio = (n: string) => escaparDiscord(n.length > 60 ? `${n.slice(0, 57)}…` : n)
const EMOJI: Record<Nivel, string> = { bien: '✅', mirar: '⚠️', apagar: '❌', sin_datos: '⏳' }

function renglon(m: FilaMetrica, marca?: string): string {
  if (m.gastoUSD === 0 && m.mensajes === 0) return `${marca ?? EMOJI.sin_datos} ${nombreAnuncio(m.nombre)} · sin entrega todavía`
  const costo = m.cpl !== null ? `${usd(m.cpl)} · ${m.mensajes} msj` : `${usd(m.gastoUSD)} sin mensajes`
  const cola = m.nivel === 'apagar' ? ' → apagar' : m.nivel === 'mirar' ? ' · mirar la calidad' : m.nivel === 'sin_datos' ? ' · poco gasto todavía' : ''
  return `${marca ?? EMOJI[m.nivel]} ${nombreAnuncio(m.nombre)} · ${costo}${cola}`
}

function totales(ms: FilaMetrica[]): string {
  const g = ms.reduce((s, m) => s + m.gastoUSD, 0), n = ms.reduce((s, m) => s + m.mensajes, 0)
  return `${usd(g)} · ${n} msj${n ? ` · ${usd(g / n)} por mensaje` : ''}`
}

const URL_TABLERO = 'https://despacho-capital-juridico.vercel.app/anuncios'
const pie = (c: Candidato) => `👉 [Ads Manager](<${c.l.link || c.fila.links.ads}>) · [Tablero](<${URL_TABLERO}>)`
const titulo = (c: Candidato) => escaparDiscord(c.fila.clienteCRM ?? c.fila.cliente)
const campana = (c: Candidato) => escaparDiscord(c.l.campana)
const rangoRama = (c: Candidato) => c.fila.rama ? `${escaparDiscord(c.fila.rama.nombre)}: normal hasta ${usd(c.fila.rama.umbral.ok)}` : `sin rama: normal hasta ${usd(2.8)}`
const mencion = (v: string | null) => (v ? `<@${v}> ` : '')

// Discord corta en 2000: se dejan los primeros MAX_RENGLONES anuncios (los más baratos primero) y, si igual no entra, se
// sacan renglones del medio; el título (con la mención) y el pie no se pierden nunca
export const MAX_RENGLONES = 12
export const MAX_TEXTO = 1900
function armar(cabeza: string[], cuerpo: string[], cola: string[]): string {
  let filas = cuerpo.length > MAX_RENGLONES ? [...cuerpo.slice(0, MAX_RENGLONES), `… y ${cuerpo.length - MAX_RENGLONES} más (en Ads Manager)`] : cuerpo
  const unir = (xs: string[]) => [...cabeza, ...xs, ...cola].filter(Boolean).join('\n')
  while (unir(filas).length > MAX_TEXTO && filas.length > 1) filas = [...filas.slice(0, -2), `… y más (en Ads Manager)`]
  const t = unir(filas)
  return t.length > MAX_TEXTO ? t.slice(0, MAX_TEXTO - 1) + '…' : t
}

const sinDetalle = (c: Candidato, d: DetalleCampana) => (d.metricasOk !== false && d.anuncios.length && !(c.fila.usdPor && c.fila.usdPor > 0)
  ? `(sin la cotización de hoy de ${escaparDiscord(c.fila.moneda)} a USD: mirá los costos en Ads Manager)`
  : '(Meta no devolvió el detalle por anuncio: mirá la campaña en Ads Manager)')

/** g05: el recordatorio del día 4. */
export function textoOptimizar(c: Candidato, d: DetalleCampana, valentino: string | null): string {
  const ms = metricasUSD(c.fila, d, true)
  const cuerpo = ms.length ? ms.map(m => renglon(m)) : [sinDetalle(c, d)]
  const caros = ms.some(m => m.nivel === 'apagar' && m.mensajes > 0)
  const uno = d.anuncios.filter(a => a.activo).length === 1 && ms.length === 1
  return armar([
    `${mencion(valentino)}🛠️ **Optimizar · día ${c.l.dia} · ${titulo(c)}**`,
    `${campana(c)} · desde el ${dm(c.desde)}${ms.length ? ` · ${totales(ms)}` : ''} (${rangoRama(c)})`,
  ], cuerpo, [
    uno ? `Un solo anuncio activo: no hay qué apagar. ${ms[0].nivel === 'bien' ? 'Viene bien: se puede escalar de a 20–25 %.' : 'Si sigue caro, hacen falta videos nuevos (avisale a Tomi).'}` : '',
    !uno && caros ? 'Antes de apagar uno caro, preguntale al cliente si esas consultas son buenas.' : '',
    `${pie(c)} · cuando optimices lo veo solo en Meta (o tocá «Ya optimicé»)`,
  ])
}

/** g06: dejar 1 o 2 ganadores, a los 7 días de la optimización. */
export function textoGanadores(c: Candidato, d: DetalleCampana, valentino: string | null): string {
  const ms = metricasUSD(c.fila, d, true)
  const umbral = c.fila.rama?.umbral ?? { ok: 2.8, medio: 4 }
  const conCosto = ms.filter(m => m.cpl !== null && m.nivel !== 'sin_datos')
  const mejor = conCosto[0]?.cpl ?? null
  const ganadores = conCosto.filter(m => m.cpl! <= umbral.medio).slice(0, 2).map(m => m.id)
  const cuerpo = ms.map(m => {
    const i = ganadores.indexOf(m.id)
    if (i >= 0) return renglon({ ...m, nivel: 'bien' }, i === 0 ? '🥇' : '🥈')
    const apagar = m.nivel === 'apagar' || (mejor !== null && m.cpl !== null && m.cpl > mejor * 1.5) || ganadores.length >= 2
    return renglon({ ...m, nivel: apagar ? 'apagar' : m.nivel })
  })
  return armar([
    `${mencion(valentino)}🏆 **Dejar 1 o 2 ganadores · ${titulo(c)}**`,
    `${campana(c)} · ${c.l.diasCompetencia} días desde la optimización del ${dm(c.desde)} · ${ms.length} activo${ms.length === 1 ? '' : 's'}${ms.length ? ` · ${totales(ms)}` : ''} (${rangoRama(c)})`,
  ], cuerpo.length ? cuerpo : [sinDetalle(c, d)], [
    !ms.length ? '' : ganadores.length ? 'Pedí iteraciones de los ganadores antes de que se fatiguen.' : 'Ninguno quedó en un costo normal: hacen falta guiones nuevos.',
    `${pie(c)} · cuando termines lo veo solo en Meta (o tocá «Ya revisé»)`,
  ])
}

// ── Textos para el cliente (hasta Whapi los manda Valentino en el grupo de ventas) ──
const TITULOS = /^(dra?|dr|lic|abog|abogad[oa]|estudio|est)\.?$/i
/** El nombre de pila del cliente del CRM ("Dra. Laura Ortiz" → "Laura"); null si no parece una persona. */
export function nombrePila(cliente: string | null): string | null {
  if (!cliente) return null
  const partes = cliente.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean)
  const p = partes.find(x => !TITULOS.test(x))
  if (!p || /^(estudio|abogado|abogada|consultora|legal|usd)$/i.test(partes[0]) || !/^[\p{Lu}][\p{L}'’-]+$/u.test(p)) return null
  return p
}
const hola = (c: Candidato) => { const n = nombrePila(c.fila.clienteCRM); return n ? `¡Hola ${n}!` : '¡Hola!' }

export function textoCliente(c: Candidato): string {
  if (c.tipo === 'lanzada') {
    return c.rotacion
      ? `${hola(c)} Ya están al aire los videos nuevos en tus anuncios. Los primeros días Meta los prueba con distintas personas, así que puede variar la cantidad de consultas. Cualquier mensaje que te llegue, contanos qué tal es.`
      : `${hola(c)} Ya están corriendo tus anuncios. Los primeros 2 días pueden escribirte personas de otras zonas: es normal mientras Meta aprende, después se acomoda solo. Respondé rápido los mensajes y contanos cómo vienen las consultas.`
  }
  if (c.subtipo === 'ganadores') {
    return `${hola(c)} Ya pasó la primera semana de prueba: dejamos corriendo los anuncios que mejor funcionaron y apagamos el resto, así el presupuesto va a lo que mejor te trae consultas. Seguimos de cerca. ¿Cómo vienen los casos que te llegan?`
  }
  return `${hola(c)} Ya pasaron los primeros días de la campaña: apagamos los anuncios que traían consultas más caras y dejamos corriendo los que mejor funcionan. Contanos cómo vienen las consultas (si son de tu zona y del tipo de caso que buscás): eso nos ayuda a elegir los mejores.`
}

export const PARA_CLIENTE = '📲 **Para el cliente** (pegalo en su grupo de ventas hasta que el bot tenga WhatsApp):'

/** Cambia el renglón «Para el cliente» según lo que pasó con el WhatsApp: ya salió (y a qué grupo) o por qué no salió. */
export function conWhatsApp(texto: string, r: { estado: 'enviado'; grupo: string } | { estado: 'no'; motivo: string }): string {
  if (!texto.includes(PARA_CLIENTE)) return texto
  return texto.replace(PARA_CLIENTE, r.estado === 'enviado'
    ? `📲 **Ya se lo mandé al cliente** por WhatsApp en «${escaparDiscord(r.grupo)}»:`
    : `📲 **Para el cliente** (pegalo en su grupo Ventas: ${escaparDiscord(r.motivo)}):`)
}

/** optimizada: quedó hecha (botón o Meta) → el texto para el cliente. */
export function textoHecha(c: Candidato, valentino: string | null): string {
  const h = c.hecha!
  const como = h.origen === 'meta'
    ? `${escaparDiscord(h.quien ?? 'alguien')} ${escaparDiscord(h.resumen ?? 'hizo cambios')} el ${dm(h.fecha)} (lo vi en Meta y lo registré en el tablero)`
    : `registrada en el tablero el ${dm(h.fecha)}`
  return armar([`${mencion(valentino)}✅ **${c.subtipo === 'ganadores' ? 'Ganadores elegidos' : 'Optimización hecha'} · ${titulo(c)}** · ${como}`], [`🗂️ ${campana(c)}`], [PARA_CLIENTE, `> ${textoCliente(c)}`])
}

/** g04: campañas lanzadas del mismo cliente el mismo día (o videos nuevos) → un aviso con el texto para el cliente. */
export function textoLanzada(cs: Candidato[], valentino: string | null): string {
  const c = cs[0], rotacion = cs.every(x => x.rotacion)
  const n = cs.reduce((s, x) => s + x.l.anuncios, 0)
  const cuales = cs.length === 1 ? `🗂️ ${campana(c)}` : `🗂️ ${cs.length} campañas: ${cs.map(x => campana(x)).join(' · ')}`
  const hecho: Candidato = { ...c, rotacion }
  return armar([`${mencion(valentino)}🚀 **${rotacion ? 'Videos nuevos al aire' : cs.length > 1 ? 'Campañas al aire' : 'Campaña al aire'} · ${titulo(c)}** · desde el ${dm(c.desde)} (${n} anuncio${n === 1 ? '' : 's'} activo${n === 1 ? '' : 's'})`],
    [cuales], [PARA_CLIENTE, `> ${textoCliente(hecho)}`])
}

/** El día del ciclo desde el que se mira el historial de Meta para dar por hecha la optimización (día 3). */
export const desdeDeteccion = (c: Candidato): string => (c.tipo === 'ganadores' ? sumarDias(c.desde, 3) : sumarDias(c.desde, 2))
/** La tanda del ciclo: los anuncios creados entre el lanzamiento y DIAS_TANDA días después. */
export const tandaDe = (c: Candidato): { desde: string; hasta: string } => ({
  // Prendida días después de armarla (borrador o reactivación): l.fecha es la del prendido y los anuncios son de antes
  desde: c.l.reactivada && c.l.reactivada === c.l.fecha ? c.l.creada ?? '0000-00-00' : c.l.fecha,
  hasta: sumarDias(c.l.fecha, DIAS_TANDA),
})
