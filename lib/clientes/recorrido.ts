// ── Recorrido de cada cliente: en qué etapa está (puro: sin red ni base; lo prueba scripts/test-clientes-recorrido.mjs) ──
// Pedido de Tomás (25/10/2026): reemplaza el bloque "Prioridad: todavía sin campaña lanzada" de la cartera por una línea de
// tiempo con TODOS los clientes de Agencia, cada uno en su etapa. Las fuentes las junta lib/clientes/recorridoFuentes.ts:
//   · CRM (planilla): estado, Día 1, vencimiento, promesa y satisfacción; los puntajes de seguimiento (Typeform o a mano).
//   · Despacho (Neon): la ficha de kickoff (cj_kickoffs), la última tanda de guiones (cj_guiones) y los videos (cj_videos).
//   · Meta (tablero de /anuncios): si tiene campaña activa, desde cuándo y su semáforo.
//   · ClickUp "Clientes 2026": SOLO de respaldo, para los clientes de antes del Despacho (sin ficha, tanda ni videos).
// Reglas, en orden (la primera que aplica manda):
//   1. CRM: PAUSADO → Pausa; FINALIZADO / INACTIVO → Baja.
//   2. Meta con campaña activa → Lanzado, o Éxito si el cliente está contento (ver esContento); si además vence en 30 días o
//      menos → Renovación (es lo próximo que hay que hacer con él).
//   3. Lo más avanzado entre el Despacho (videos > tanda > ficha) y ClickUp. ClickUp nunca gana con "campaña activa" si Meta
//      respondió y no ve anuncios: ahí queda Lanzado con la alerta "sin anuncios activos".
//   4. Sin nada: Alta si entró hace 45 días o menos; si no, "Sin dato" (no se adivina).
// "Frenado": en una etapa de producción (Alta a Por lanzar) sin moverse hace FRENADO_DIAS o más, o con algo que lo traba
// (semáforo rojo, puntaje bajo, error en la tanda). Éxito es relativo (Tomás, 25/10): se mide por lo contento que está el
// cliente con los resultados y si se cumple lo prometido, no por un número fijo de casos.
import { diasEntre, type Ymd } from './fechas'
import { etapaPorHitos, type FuenteHito, type Hito } from './hitos'
import type { EstadoCliente } from './tipos'

export const ETAPAS = ['alta', 'kickoff', 'guiones', 'grabacion', 'edicion', 'por_lanzar', 'lanzado', 'exito', 'renovacion', 'pausa', 'baja', 'sin_dato'] as const
export type Etapa = (typeof ETAPAS)[number]
export const ETAPAS_PRODUCCION: readonly Etapa[] = ['alta', 'kickoff', 'guiones', 'grabacion', 'edicion', 'por_lanzar']
// Las que van a la derecha, separadas del recorrido: no avanzan, se cierran
export const ETAPAS_CIERRE: readonly Etapa[] = ['pausa', 'baja', 'sin_dato']
export const NOMBRE_ETAPA: Record<Etapa, string> = {
  alta: 'Alta', kickoff: 'Kickoff', guiones: 'Guiones', grabacion: 'Grabación', edicion: 'Edición', por_lanzar: 'Por lanzar',
  lanzado: 'Lanzado', exito: 'Éxito', renovacion: 'Renovación', pausa: 'Pausa', baja: 'Baja', sin_dato: 'Sin dato',
}
export const AYUDA_ETAPA: Record<Etapa, string> = {
  alta: 'Entró al CRM y todavía no tuvo kickoff',
  kickoff: 'Tiene ficha de kickoff; faltan los guiones',
  guiones: 'Tanda de guiones en curso o con correcciones',
  grabacion: 'Guiones aprobados: esperando o revisando crudos',
  edicion: 'Videos en edición o con el cliente',
  por_lanzar: 'Videos aprobados, sin campaña activa',
  lanzado: 'Campaña activa en Meta, optimizando',
  exito: 'Campaña activa y el cliente contento: puntaje de 8 o más con la promesa cumplida, o éxito anotado en el registro',
  renovacion: 'Ya lanzó y vence en 30 días o menos (o venció sin renovar): toca la charla de renovación',
  pausa: 'Pausado en el CRM',
  baja: 'Finalizado o inactivo en el CRM',
  sin_dato: 'No hay datos del Despacho, Meta ni ClickUp para ubicarlo',
}
export const FRENADO_DIAS = 7
export const VENCE_PRONTO_DIAS = 30
export const ALTA_RECIENTE_DIAS = 45
export const PUNTAJE_CONTENTO = 8      // 8 a 10: contento
export const PUNTAJE_DESCONTENTO = 5   // 1 a 5: alerta
export type FuenteEtapa = 'crm' | 'meta' | 'despacho' | 'clickup' | 'drive' | 'manual'
export const NOMBRE_FUENTE: Record<FuenteEtapa, string> = { crm: 'CRM', meta: 'Meta', despacho: 'Despacho', clickup: 'ClickUp (respaldo)', drive: 'Drive', manual: 'Anotado a mano' }

// ── Entradas (lo mínimo de cada fuente) ──
export interface ClienteRecorrido {
  id: string; nombre: string; closer: string; estado: EstadoCliente
  dia1: Ymd | null; diasParaVencer: number | null; fechaBaja: Ymd | null
  promesa: string; satisfaccion: number | null
}
export interface KickoffResumen { fecha: Ymd | null; frenos: number; ideas: string }
export type EstadoTandaResumen = 'pendiente' | 'mercado' | 'plan' | 'escribiendo' | 'a_revisar' | 'aprobada' | 'enviada' | 'con_notas' | 'corrigiendo' | 'error' | 'cerrada'
export interface TandaResumen {
  tanda: number; estado: EstadoTandaResumen; actualizado: Ymd | null; guiones: number
  // para el registro de hitos (de TODAS las tandas del cliente): primera tanda aprobada o enviada, primera aprobación,
  // primer envío y primera nota del cliente
  creado?: Ymd | null; aprobada?: Ymd | null; enviada?: Ymd | null; notaCliente?: Ymd | null
}
export interface VideosResumen {
  grabacion: number; edicion: number; aprobados: number; pausados: number
  ultimoGrabacion: Ymd | null; ultimoEdicion: Ymd | null; ultimoAprobado: Ymd | null
  crudoRecibido?: Ymd | null; editado?: Ymd | null   // para el registro: último crudo que llegó y último video editado
}
export interface MetaResumen { activa: boolean; ultimoLanzamiento: Ymd | null; semaforo: string | null }
export interface ClickUpResumen { estado: string; actualizada: Ymd | null }
export interface PuntajeResumen { valor: number; dia: Ymd | null }
export interface FuentesCliente {
  kickoff: KickoffResumen | null
  tanda: TandaResumen | null
  videos: VideosResumen | null
  meta: MetaResumen | null
  clickup: ClickUpResumen | null
  puntaje: PuntajeResumen | null
  hitos?: Hito[] | null       // el registro (hitos.ts): automático de todas las fuentes + lo anotado a mano
  etapaManual?: { etapa: Etapa; nota: string; quien: string; cuando: string } | null   // "Corregir etapa" (cj_etapas_manual)
}
/** Qué fuentes se pudieron leer: con una caída no se saca ninguna conclusión de su ausencia. */
export interface Lecturas { meta: boolean; despacho: boolean; clickup: boolean }

// ── Salida ──
export interface UbicacionCliente {
  etapa: Etapa
  fuente: FuenteEtapa
  desde: Ymd | null            // desde cuándo está en la etapa (o el último movimiento que se conoce)
  diasEtapa: number | null
  diasCliente: number | null   // desde el Día 1 del CRM
  frenado: boolean
  alertas: string[]            // por qué está frenado o qué mirar ("12 días sin moverse", "Semáforo rojo")
  detalle: string              // una línea: qué se ve de la etapa ("Tanda 2 · con notas del cliente")
  contento: boolean | null     // null = no hay puntaje ni satisfacción cargada
  venceEn: number | null       // solo activos
  automatica?: Etapa           // con la etapa corregida a mano: la que daría el registro automático (para mostrarla)
  corregida?: boolean          // la etapa viene de "Corregir etapa" (no de un hito anotado a mano)
}

// ClickUp → etapa (solo de respaldo). "onboarding" es antes del kickoff: va a Alta (sin ficha todavía)
const ETAPA_CLICKUP: Record<string, Etapa> = {
  'nuevo cliente': 'alta', onboarding: 'alta', 'en espera de tópicos': 'guiones', guionizar: 'guiones', 'opt. guiones': 'guiones',
  'grabación': 'grabacion', 'edición': 'edicion', 'creación de campaña': 'por_lanzar',
  'campañas activas': 'lanzado', verde: 'lanzado', amarillo: 'lanzado', rojo: 'lanzado', pausa: 'pausa', 'final del servicio': 'baja',
}
const ORDEN = (e: Etapa) => ETAPAS.indexOf(e)
// El día argentino de una fecha ISO (una corrección después de las 21 h no cae al día siguiente)
const diaArgentino = (iso: string): Ymd | null => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) }
const fuenteDeHito = (f: FuenteHito | null): FuenteEtapa =>
  f === 'drive' || f === 'manual' || f === 'meta' || f === 'clickup' || f === 'despacho' ? f : f === 'crm' || f === 'seguimiento' || f === 'exito_bot' ? 'crm' : 'despacho'
const TANDA_HECHA: readonly EstadoTandaResumen[] = ['aprobada', 'enviada', 'cerrada']
const TEXTO_TANDA: Record<EstadoTandaResumen, string> = {
  pendiente: 'por arrancar', mercado: 'leyendo el mercado', plan: 'armando el plan', escribiendo: 'escribiendo', a_revisar: 'a revisar por el equipo',
  aprobada: 'aprobada', enviada: 'enviada al cliente', con_notas: 'con notas del cliente', corrigiendo: 'corrigiendo', error: 'con error', cerrada: 'cerrada fuera del bot',
}
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const maxFecha = (...xs: (Ymd | null | undefined)[]): Ymd | null => xs.filter((x): x is Ymd => !!x).sort().pop() ?? null

/** Contento con los resultados: último puntaje de seguimiento (o, sin puntaje, la satisfacción del CRM) de 8 o más, y la
 *  promesa no marcada como incumplida. null = no hay con qué medirlo. */
export function esContento(c: Pick<ClienteRecorrido, 'promesa' | 'satisfaccion'>, puntaje: PuntajeResumen | null): boolean | null {
  const valor = puntaje?.valor ?? c.satisfaccion
  const promesaNo = /^no\b/i.test(c.promesa.trim())
  if (valor === null || valor === undefined) return promesaNo ? false : null
  return valor >= PUNTAJE_CONTENTO && !promesaNo
}

interface Candidata { etapa: Etapa; fuente: FuenteEtapa; desde: Ymd | null; detalle: string }

function desdeDespacho(f: FuentesCliente): Candidata | null {
  const v = f.videos
  if (v && v.edicion > 0) return { etapa: 'edicion', fuente: 'despacho', desde: v.ultimoEdicion, detalle: `${plural(v.edicion, 'video', 'videos')} en edición` }
  if (v && v.grabacion > 0) return { etapa: 'grabacion', fuente: 'despacho', desde: v.ultimoGrabacion, detalle: `${plural(v.grabacion, 'video', 'videos')} esperando o revisando crudos` }
  if (v && v.aprobados > 0) return { etapa: 'por_lanzar', fuente: 'despacho', desde: v.ultimoAprobado, detalle: `${plural(v.aprobados, 'video aprobado', 'videos aprobados')}` }
  const t = f.tanda
  if (t) {
    const hecha = TANDA_HECHA.includes(t.estado)
    return { etapa: hecha ? 'grabacion' : 'guiones', fuente: 'despacho', desde: t.actualizado, detalle: `Tanda ${t.tanda} · ${TEXTO_TANDA[t.estado] ?? t.estado}${hecha && t.estado !== 'cerrada' ? ' (falta grabar)' : ''}` }
  }
  if (f.kickoff) return { etapa: 'kickoff', fuente: 'despacho', desde: f.kickoff.fecha, detalle: f.kickoff.frenos ? `Ficha lista · ${plural(f.kickoff.frenos, 'cosa frena', 'cosas frenan')} el lanzamiento` : 'Ficha de kickoff lista' }
  return null
}

export function ubicarCliente(c: ClienteRecorrido, f: FuentesCliente, hoy: Ymd, lecturas: Lecturas): UbicacionCliente {
  const diasCliente = c.dia1 ? Math.max(0, diasEntre(c.dia1, hoy)) : null
  const contento = esContento(c, f.puntaje)
  const venceEn = c.estado === 'ACTIVO' ? c.diasParaVencer : null
  const alertas: string[] = []
  // Mismo valor que "contento": el último puntaje o, si no hay, la satisfacción del CRM
  const valorSatisfaccion = f.puntaje?.valor ?? c.satisfaccion
  if (valorSatisfaccion !== null && valorSatisfaccion !== undefined && valorSatisfaccion <= PUNTAJE_DESCONTENTO) alertas.push(`Descontento (${valorSatisfaccion}/10)`)

  let cand: Candidata
  if (c.estado === 'PAUSADO') cand = { etapa: 'pausa', fuente: 'crm', desde: null, detalle: 'Pausado en el CRM' }
  // Sin Estado en el CRM no se sabe si sigue: igual que la lista (que no lo cuenta entre los actuales), va a Sin dato
  else if (c.estado === '') cand = { etapa: 'sin_dato', fuente: 'crm', desde: null, detalle: 'Estado vacío en el CRM: completalo para ubicarlo' }
  else if (c.estado === 'FINALIZADO' || c.estado === 'INACTIVO') cand = { etapa: 'baja', fuente: 'crm', desde: c.fechaBaja, detalle: c.estado === 'FINALIZADO' ? 'Finalizó' : 'Inactivo' }
  else if (f.meta?.activa) {
    // Éxito: contento con los resultados (y sin semáforo rojo), o anotado a mano en el registro
    const exitoManual = !!f.hitos?.find(h => h.clave === 'exito' && (h.fuente === 'manual' || h.fuente === 'exito_bot'))
    const etapa: Etapa = venceEn !== null && venceEn <= VENCE_PRONTO_DIAS ? 'renovacion' : exitoManual || (contento && f.meta.semaforo !== 'rojo') ? 'exito' : 'lanzado'
    const ver = venceEn === null ? '' : venceEn > 0 ? ` · vence en ${plural(venceEn, 'día', 'días')}` : venceEn === 0 ? ' · vence hoy' : ` · venció hace ${plural(-venceEn, 'día', 'días')}`
    cand = { etapa, fuente: 'meta', desde: f.meta.ultimoLanzamiento, detalle: `Campaña activa${f.meta.semaforo ? ` · semáforo ${f.meta.semaforo}` : ''}${etapa === 'renovacion' ? ver : ''}` }
    if (f.meta.semaforo === 'rojo') alertas.push('Semáforo rojo en Meta')
  } else {
    // Lo más avanzado entre el Despacho (lo que está en curso) y el registro de hitos (Drive, Despacho, Meta, lo anotado a
    // mano…); a igualdad, el Despacho
    const enCurso = desdeDespacho(f)
    const ph = f.hitos ? etapaPorHitos(f.hitos) : null
    const porHitos: Candidata | null = ph ? { etapa: ph.etapa, fuente: fuenteDeHito(ph.fuente), desde: ph.desde, detalle: ph.detalle } : null
    // Contra un hito anotado a mano se compara con el día de la ANOTACIÓN: lo en curso le gana solo si es posterior a cuando
    // alguien dijo a mano en qué punto estaba (revisión del Hub, 26/10/2026)
    const referencia = ph?.fuente === 'manual' ? [porHitos?.desde, ph.anotado].filter((x): x is Ymd => !!x).sort().pop() ?? null : porHitos?.desde ?? null
    // (o el Despacho si lo en curso es POSTERIOR al último hito: una tanda nueva después de haber lanzado)
    // Un hito sin fecha (inferido) no le gana a lo que está en curso: no se sabe cuál es más nuevo
    const masNuevo = !!enCurso && !!porHitos && (referencia === null || (!!enCurso.desde && enCurso.desde > referencia))
    const despacho = enCurso && (!porHitos || ORDEN(enCurso.etapa) >= ORDEN(porHitos.etapa) || masNuevo) ? enCurso : porHitos ?? enCurso
    const etapaCU = f.clickup ? ETAPA_CLICKUP[f.clickup.estado] ?? null : null
    let cu: Candidata | null = etapaCU && f.clickup ? { etapa: etapaCU, fuente: 'clickup', desde: f.clickup.actualizada, detalle: `En ClickUp: ${f.clickup.estado}` } : null
    // ClickUp dice campaña pero Meta respondió y no ve anuncios activos: lanzó, hoy no corre nada
    const metaVeSinAnuncios = lecturas.meta && cu?.etapa === 'lanzado'
    if (cu && (cu.etapa === 'pausa' || cu.etapa === 'baja')) cu = null   // el estado lo manda el CRM, no ClickUp
    const lanzoAntes = f.meta && !f.meta.activa
    // Después de haber lanzado, solo cuenta como producción nueva una tanda, videos o una ficha POSTERIOR al lanzamiento
    // (la ficha de kickoff de antes de lanzar no lo devuelve a Kickoff)
    const fichaVieja = despacho?.etapa === 'kickoff' && !!f.meta?.ultimoLanzamiento && (!despacho.desde || despacho.desde <= f.meta.ultimoLanzamiento)
    if (lanzoAntes && (!despacho || fichaVieja || despacho.etapa === 'lanzado')) {
      cand = { etapa: 'lanzado', fuente: 'meta', desde: f.meta!.ultimoLanzamiento, detalle: 'Lanzó, pero hoy no tiene anuncios activos' }
      alertas.push('Sin anuncios activos')
    } else if (despacho && (!cu || ORDEN(despacho.etapa) >= ORDEN(cu.etapa) || metaVeSinAnuncios)) {
      cand = despacho
      // Lanzamiento anotado a mano, pero Meta respondió y no ve anuncios activos
      if (cand.etapa === 'lanzado' && lecturas.meta && !f.meta?.activa) alertas.push('Sin anuncios activos')
    }
    else if (cu) {
      cand = cu
      if (metaVeSinAnuncios) { cand = { ...cu, detalle: 'ClickUp dice campaña activa, pero Meta no ve anuncios' }; alertas.push('Sin anuncios activos') }
    } else if (diasCliente === null || diasCliente <= ALTA_RECIENTE_DIAS) cand = { etapa: 'alta', fuente: 'crm', desde: c.dia1, detalle: 'Esperando el kickoff' }
    else cand = { etapa: 'sin_dato', fuente: 'crm', desde: null, detalle: lecturas.despacho && lecturas.clickup && lecturas.meta ? 'Sin ficha, tanda, videos ni tarea en ClickUp' : 'Alguna fuente no respondió: recargá en un minuto' }
  }
  // Renovación: ya lanzó (con o sin anuncios hoy) y vence en 30 días o menos, o ya venció sin renovar. Es lo próximo que hay que
  // hacer con él, aunque esté contento. Al renovar, el CRM corre el fin del período y vuelve a Lanzado o Éxito.
  // Sin anuncios activos y vencido hace más de 30 días ya no es una renovación pendiente: queda en Lanzado con la alerta para
  // revisar el estado en el CRM (suele ser un cliente que se fue y nadie lo pasó a Finalizado)
  if ((cand.etapa === 'lanzado' || cand.etapa === 'exito') && venceEn !== null && venceEn <= VENCE_PRONTO_DIAS) {
    const ver = venceEn > 0 ? `vence en ${plural(venceEn, 'día', 'días')}` : venceEn === 0 ? 'vence hoy' : `venció hace ${plural(-venceEn, 'día', 'días')}`
    if (venceEn < -VENCE_PRONTO_DIAS && !f.meta?.activa) alertas.push(`Venció hace ${plural(-venceEn, 'día', 'días')}: revisar el estado en el CRM`)
    else cand = { ...cand, etapa: 'renovacion', detalle: `${cand.detalle} · ${ver}` }
  }
  // Etapa corregida a mano: manda (salvo Pausa y Baja, que las decide el CRM) y se guarda cuál daba el registro automático
  // Deja de mandar sola cuando el registro automático avanzó DESPUÉS de la corrección (por ejemplo lanzó en Meta), y una
  // Renovación siempre le gana a una corrección a Lanzado o Éxito (es lo próximo que hay que hacer)
  let automatica: Etapa | undefined
  const diaCorreccion = f.etapaManual ? diaArgentino(f.etapaManual.cuando) : null
  const superada = !!f.etapaManual && ORDEN(cand.etapa) > ORDEN(f.etapaManual.etapa) && !!cand.desde && !!diaCorreccion && cand.desde > diaCorreccion
  const renovacionGana = cand.etapa === 'renovacion' && (f.etapaManual?.etapa === 'lanzado' || f.etapaManual?.etapa === 'exito')
  if (f.etapaManual && cand.etapa !== 'pausa' && cand.etapa !== 'baja' && !superada && !renovacionGana) {
    automatica = cand.etapa
    const desde = diaCorreccion
    const quien = f.etapaManual.quien ? ` por ${f.etapaManual.quien}` : ''
    cand = { etapa: f.etapaManual.etapa, fuente: 'manual', desde, detalle: `Corregida a mano${quien}${f.etapaManual.nota ? ` · «${f.etapaManual.nota}»` : ''}` }
  }
  if (f.tanda?.estado === 'error' && ETAPAS_PRODUCCION.includes(cand.etapa)) alertas.push('La tanda de guiones quedó con error')

  const diasEtapa = cand.desde ? Math.max(0, diasEntre(cand.desde, hoy)) : null
  // Sin Meta no se sabe si "Por lanzar" ya lanzó: no se lo marca frenado por días (sale el aviso de arriba)
  const produccion = ETAPAS_PRODUCCION.includes(cand.etapa) && !(cand.etapa === 'por_lanzar' && !lecturas.meta)
  if (produccion && diasEtapa !== null && diasEtapa >= FRENADO_DIAS) alertas.unshift(`${diasEtapa} días sin moverse`)
  // Pausa, baja y sin dato no se cuentan como frenados (no están en el recorrido)
  const frenado = !ETAPAS_CIERRE.includes(cand.etapa) && ((produccion && diasEtapa !== null && diasEtapa >= FRENADO_DIAS) || alertas.length > 0)
  return {
    etapa: cand.etapa, fuente: cand.fuente, desde: cand.desde, diasEtapa, diasCliente, frenado, alertas, detalle: cand.detalle, contento, venceEn,
    ...(automatica !== undefined ? { corregida: true } : {}), ...(automatica && automatica !== cand.etapa ? { automatica } : {}),
  }
}

// ── Filtros de la línea de tiempo (los aplica el navegador; puros para poder probarlos) ──
export const RANGOS_ANTIGUEDAD = ['todos', 'nuevos', 'medio', 'veteranos'] as const
export type RangoAntiguedad = (typeof RANGOS_ANTIGUEDAD)[number]
export const NOMBRE_RANGO: Record<RangoAntiguedad, string> = { todos: 'Todos', nuevos: 'Hasta 30 días', medio: '31 a 90 días', veteranos: 'Más de 90 días' }
export interface FiltrosRecorrido { etapa: Etapa | null; closer: string | null; antiguedad: RangoAntiguedad; frenados: boolean; vencen: boolean; texto: string; cierre: boolean }
export const FILTROS_RECORRIDO_INICIALES: FiltrosRecorrido = { etapa: null, closer: null, antiguedad: 'todos', frenados: false, vencen: false, texto: '', cierre: false }

// clave: una por fila del CRM (el ID puede repetirse en la planilla): es la key de React; el ID abre la tarjeta
export interface FilaRecorrido extends UbicacionCliente { id: string; clave?: string; nombre: string; closer: string }

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export function enRango(dias: number | null, r: RangoAntiguedad): boolean {
  if (r === 'todos') return true
  if (dias === null) return false
  return r === 'nuevos' ? dias <= 30 : r === 'medio' ? dias > 30 && dias <= 90 : dias > 90
}
/** Filtra sin la etapa (la etapa elegida es el "zoom": se aplica al mostrar). */
export function filtrarRecorrido(filas: FilaRecorrido[], f: FiltrosRecorrido): FilaRecorrido[] {
  const q = sinTildes(f.texto.trim())
  return filas.filter(x =>
    (!f.closer || x.closer === f.closer) && enRango(x.diasCliente, f.antiguedad) && (!f.frenados || x.frenado) &&
    (!f.vencen || (x.venceEn !== null && x.venceEn <= VENCE_PRONTO_DIAS)) && (!q || sinTildes(x.nombre).includes(q) || sinTildes(x.id) === q))
}
/** Dentro de una etapa: primero los frenados, después los que más días llevan en ella. */
export const ordenEnEtapa = (a: FilaRecorrido, b: FilaRecorrido): number =>
  Number(b.frenado) - Number(a.frenado) || (b.diasEtapa ?? -1) - (a.diasEtapa ?? -1) || a.nombre.localeCompare(b.nombre, 'es')
export function agruparPorEtapa(filas: FilaRecorrido[]): Map<Etapa, FilaRecorrido[]> {
  const m = new Map<Etapa, FilaRecorrido[]>(ETAPAS.map(e => [e, []]))
  for (const x of filas) m.get(x.etapa)!.push(x)
  for (const xs of m.values()) xs.sort(ordenEnEtapa)
  return m
}
export const esEtapa = (v: unknown): v is Etapa => typeof v === 'string' && (ETAPAS as readonly string[]).includes(v)
export { maxFecha }

// ── Eje de tiempo literal (pedido de Tomás, 25/10/2026): de 0 a 4 meses desde el Día 1, más lo que pasa de 4 meses ──
// Cada tramo es de 30 días. El eje dibuja cada cliente en su día exacto (posicionEnEje) y agrupa por tramo para abrirlo.
export const DIAS_TRAMO = 30
export const TRAMOS = [
  { id: 'm0', nombre: '0 a 1 mes', desde: 0, hasta: 30 },
  { id: 'm1', nombre: '1 a 2 meses', desde: 31, hasta: 60 },
  { id: 'm2', nombre: '2 a 3 meses', desde: 61, hasta: 90 },
  { id: 'm3', nombre: '3 a 4 meses', desde: 91, hasta: 120 },
  { id: 'm4', nombre: 'Más de 4 meses', desde: 121, hasta: Infinity },
] as const
export type IdTramo = (typeof TRAMOS)[number]['id'] | 'sin_fecha'
export const NOMBRE_TRAMO: Record<IdTramo, string> = { ...Object.fromEntries(TRAMOS.map(t => [t.id, t.nombre])), sin_fecha: 'Sin Día 1' } as Record<IdTramo, string>
export const EJE_DIAS = DIAS_TRAMO * TRAMOS.length   // 150: el último tramo se dibuja del mismo ancho (de 121 en adelante, recortado)

export function tramoDe(dias: number | null): IdTramo {
  if (dias === null) return 'sin_fecha'
  return TRAMOS.find(t => dias >= t.desde && dias <= t.hasta)?.id ?? 'm4'
}
/** 0 a 1: dónde va el cliente en el eje (lo de más de 150 días queda pegado al final). */
export const posicionEnEje = (dias: number): number => Math.min(Math.max(dias, 0), EJE_DIAS) / EJE_DIAS
/** Por tramo, del que entró hace menos al que hace más; los sin Día 1 aparte. */
export function agruparPorTramo(filas: FilaRecorrido[]): Map<IdTramo, FilaRecorrido[]> {
  const m = new Map<IdTramo, FilaRecorrido[]>([...TRAMOS.map(t => [t.id, []] as [IdTramo, FilaRecorrido[]]), ['sin_fecha', []]])
  for (const x of filas) m.get(tramoDe(x.diasCliente))!.push(x)
  for (const xs of m.values()) xs.sort((a, b) => (a.diasCliente ?? 0) - (b.diasCliente ?? 0) || a.nombre.localeCompare(b.nombre, 'es'))
  return m
}
