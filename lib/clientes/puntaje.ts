// ── Puntaje de cada cliente: el del cliente y el interno (puro: sin red ni base; lo prueba scripts/test-clientes-puntaje.mjs) ──
// Especificación v1 de Tomás (13/11/2026). Dos números que NUNCA se mezclan:
//   1. Puntaje del cliente (definitivo): su última respuesta a la encuesta de satisfacción (Typeform, 0 a 10) llevada a 0–100
//      (un 8 es 80). El puntaje que le pone el EQUIPO desde la cartera («Puntuar», fuente manual) NO cuenta: es otra cosa.
//      Sin respuesta, no se inventa: null («sin respuesta»).
//   2. Puntaje interno (para nosotros): 100 puntos en tres bloques (Anuncios 50, Resultados 30, Mirada del equipo 20), menos
//      las restas (nunca baja de 0), más un bonus de compromiso de hasta +15 que no entra en el 100.
// Niveles: 70 o más Éxito · 50 a 69 en camino · menos de 50 atención. El nivel sale del puntaje del cliente si respondió; si
// no, del interno completo (interno + bonus) y se marca «estimado». Brecha: el del cliente y el interno (sin el bonus, los dos
// en 0–100) a 20 puntos o más.
// Una señal que no se pudo leer (o que el Despacho todavía no tiene) queda «sin dato» y suma 0: no se adivina.
// Excepción (13/11/2026): si META NO RESPONDIÓ, el bloque Anuncios (50 puntos) no se puede medir y el interno saldría bajo sin
// motivo. Ahí no hay interno (null: «Interno: sin datos de Meta»), ni nivel estimado, ni brecha; el puntaje del cliente, si
// existe, se muestra igual con su nivel. Distinto de «la cuenta no está vinculada o no tiene anuncios»: eso SÍ es un dato (0).
// La rama del cliente y su calidad (CALIDAD_RAMA, 1 a 5) van como dato informativo: no suman ni restan.
// El puntaje NO mueve etapas ni escribe en el CRM: a lo sumo sugiere («llegó a 70: anotar Éxito»).
import type { Ymd } from './fechas'
import type { FuenteRama, Rama } from '../anuncios/ramas'

export const UMBRAL_EXITO = 70
export const UMBRAL_EN_CAMINO = 50
export const UMBRAL_BRECHA = 20
export const DIAS_WINS = 60
export const BONUS_MAXIMO = 15

export type Nivel = 'exito' | 'en_camino' | 'atencion'
export const NOMBRE_NIVEL: Record<Nivel, string> = { exito: 'Éxito', en_camino: 'En camino', atencion: 'Atención' }
export type ColorSemaforo = 'verde' | 'amarillo' | 'rojo'

/** Lo que el Despacho sabe de la campaña de un cliente (lo que ya lee la cartera del tablero de Anuncios). */
export interface SenalMeta {
  activa: boolean                        // anuncios activos y gasto en los últimos 7 días
  cpl: ColorSemaforo | null              // costo por mensaje frente al KPI de su rama (verde ok, amarillo medio, rojo alto); null = sin datos
  gastoRealDiarioUSD: number | null      // promedio de los últimos 7 días completos
  gastoObjetivoDiarioUSD: number | null  // presupuesto mensual pactado / días del mes
  semaforo: string | null                // semáforo general del tablero (verde / amarillo / rojo)
  errorPago: boolean                     // la cuenta está frenada por un problema de pago
}

export interface SenalesPuntaje {
  /** La última respuesta DEL CLIENTE a la encuesta (0 a 10). null = no respondió. */
  encuesta: { valor: number; dia: Ymd | null } | null
  /** false = Meta no respondió hoy (todo el bloque Anuncios queda sin dato). */
  metaLeida: boolean
  /** null con metaLeida = el tablero no tiene una cuenta con campaña de este cliente. */
  meta: SenalMeta | null
  /** Columna «Promesa» del CRM, cruda ('Sí', 'Parcial', 'No' o vacía). */
  promesa: string
  /** Wins cargados en los últimos 60 días. null = no se pudo leer la base de wins. */
  wins: number | null
  /** false = no se pudo leer el EOW (o todavía no hay ninguno). */
  eowLeido: boolean
  /** El cliente en el último EOW: color que eligió Gero M (null = recién lanzado sin ubicar) y si figura como pesadilla. null = no figura. */
  eow: { color: ColorSemaforo | null; pesadilla: boolean } | null
  /** Renovó al menos una vez (columna «Renovó» o una renovación paga en Renovaciones). */
  renovo: boolean
  /** Plan de cuotas: al día, atrasado o null (sin plan en el tablero de cuotas o sin poder leerlo). */
  pagos: 'al_dia' | 'atrasado' | null
  /** Presentó al menos un referido. null = la pestaña Referidos no existe o no se pudo leer. */
  referido: boolean | null
  /** Graba y responde a tiempo. null = el Despacho todavía no tiene esta señal. */
  grabaYResponde: boolean | null
  /** La rama del tablero de Anuncios (la misma que fija el KPI del costo por mensaje). Solo informativa. */
  rama?: RamaPuntaje | null
}

/** Rama del cliente y su calidad para Capital Jurídico (1 a 5). Dato informativo: no suma ni resta. */
export interface RamaPuntaje { id: Rama; nombre: string; calidad: number; fuente: FuenteRama | null }

export type Bloque = 'anuncios' | 'resultados' | 'equipo' | 'bonus' | 'resta'
export const NOMBRE_BLOQUE: Record<Bloque, string> = { anuncios: 'Anuncios', resultados: 'Resultados', equipo: 'Mirada del equipo', bonus: 'Bonus de compromiso', resta: 'Restas' }
/** suma = sumó todo · parcial = sumó una parte · no_suma = se leyó y no sumó · sin_dato = no hay con qué medirlo (0) ·
 *  resta = la resta se aplicó · no_aplica = la resta no corresponde */
export type EstadoRenglon = 'suma' | 'parcial' | 'no_suma' | 'sin_dato' | 'resta' | 'no_aplica'

export interface Renglon {
  clave: string
  bloque: Bloque
  senal: string
  puntos: number      // negativo en las restas
  maximo: number      // negativo en las restas (lo que resta si se aplica)
  estado: EstadoRenglon
  motivo: string      // en palabras simples: por qué sumó, por qué no o por qué no hay dato
}

export interface Brecha { tipo: 'peor' | 'mejor'; diferencia: number; texto: string }

export interface ResultadoPuntaje {
  cliente: number | null   // 0–100; null = sin respuesta
  clienteDia: Ymd | null   // el día de esa respuesta
  base: number             // los 100 puntos, antes de las restas
  restas: number           // cuánto se restó (positivo)
  interno: number | null   // base − restas, nunca menos de 0 (0–100); null = Meta no respondió (sin datos de Meta)
  bonus: number            // 0 a +15
  total: number | null     // interno + bonus (puede pasar de 100); null sin interno
  nivel: Nivel | null      // null = el cliente no respondió y no hay interno
  estimado: boolean        // el nivel sale del interno porque el cliente no respondió
  sinMeta: boolean         // Meta no respondió: el interno no se muestra (ni su nivel ni la brecha)
  rama: RamaPuntaje | null // informativo
  brecha: Brecha | null
  sinDato: number          // cuántas señales quedaron sin dato
  detalle: Renglon[]
}

export const nivelDe = (n: number): Nivel => (n >= UMBRAL_EXITO ? 'exito' : n >= UMBRAL_EN_CAMINO ? 'en_camino' : 'atencion')
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const usd = (n: number) => `USD ${Math.round(n)}`

/** Encuesta 0–10 → 0–100 (redondeado). Fuera de rango → null. */
export function puntajeCliente(e: SenalesPuntaje['encuesta']): number | null {
  if (!e || typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor < 0 || e.valor > 10) return null
  return Math.round(e.valor * 10)
}

function bloqueAnuncios(s: SenalesPuntaje): Renglon[] {
  const r = (clave: string, senal: string, maximo: number, puntos: number, estado: EstadoRenglon, motivo: string): Renglon => ({ clave, bloque: 'anuncios', senal, puntos, maximo, estado, motivo })
  if (!s.metaLeida) {
    const motivo = 'Meta no respondió en esta lectura: sin dato.'
    return [r('campana', 'Campaña activa y gastando', 10, 0, 'sin_dato', motivo), r('cpl', 'Costo por mensaje dentro del KPI', 25, 0, 'sin_dato', motivo), r('gasto', 'Gasta lo pactado por día', 15, 0, 'sin_dato', motivo)]
  }
  const m = s.meta
  if (!m) {
    // Meta respondió y este cliente no tiene cuenta vinculada (o no tiene anuncios): es un dato, no una falta de lectura
    const motivo = 'Meta respondió, pero el tablero de Anuncios no tiene una cuenta vinculada con anuncios de este cliente.'
    return [r('campana', 'Campaña activa y gastando', 10, 0, 'no_suma', motivo), r('cpl', 'Costo por mensaje dentro del KPI', 25, 0, 'no_suma', 'Sin cuenta vinculada con anuncios: no hay costo por mensaje.'), r('gasto', 'Gasta lo pactado por día', 15, 0, 'no_suma', 'Sin cuenta vinculada con anuncios: no gasta.')]
  }
  const campana = m.activa
    ? r('campana', 'Campaña activa y gastando', 10, 10, 'suma', 'Tiene anuncios activos y gastó en los últimos 7 días.')
    : r('campana', 'Campaña activa y gastando', 10, 0, 'no_suma', 'Hoy no tiene anuncios activos o no gastó en los últimos 7 días.')
  const cpl = m.cpl === 'verde' ? r('cpl', 'Costo por mensaje dentro del KPI', 25, 25, 'suma', 'Semáforo verde: el costo por mensaje está dentro del KPI de su rama.')
    : m.cpl === 'amarillo' ? r('cpl', 'Costo por mensaje dentro del KPI', 25, 12, 'parcial', 'Semáforo amarillo: el costo por mensaje está algo arriba del KPI.')
      : m.cpl === 'rojo' ? r('cpl', 'Costo por mensaje dentro del KPI', 25, 0, 'no_suma', 'Semáforo rojo: el costo por mensaje está muy arriba del KPI.')
        : r('cpl', 'Costo por mensaje dentro del KPI', 25, 0, 'sin_dato', 'Sin mensajes suficientes (o sin referencia) para medir el costo por mensaje.')
  let gasto: Renglon
  const real = m.gastoRealDiarioUSD, objetivo = m.gastoObjetivoDiarioUSD
  if (objetivo === null || !(objetivo > 0)) gasto = r('gasto', 'Gasta lo pactado por día', 15, 0, 'sin_dato', 'No hay presupuesto mensual cargado para este cliente.')
  else if (real === null) gasto = r('gasto', 'Gasta lo pactado por día', 15, 0, 'sin_dato', 'No se pudo calcular el gasto diario (falta la cotización o los días de Meta).')
  else {
    const pct = Math.round((real / objetivo) * 100)
    const texto = `Gasta ${usd(real)} por día de ${usd(objetivo)} pactados (${pct} %).`
    gasto = pct >= 80 ? r('gasto', 'Gasta lo pactado por día', 15, 15, 'suma', texto)
      : pct >= 50 ? r('gasto', 'Gasta lo pactado por día', 15, 8, 'parcial', `${texto} Entre 50 y 79 % suma 8.`)
        : r('gasto', 'Gasta lo pactado por día', 15, 0, 'no_suma', `${texto} Menos del 50 % no suma.`)
  }
  return [campana, cpl, gasto]
}

function bloqueResultados(s: SenalesPuntaje): Renglon[] {
  const r = (clave: string, senal: string, puntos: number, estado: EstadoRenglon, motivo: string): Renglon => ({ clave, bloque: 'resultados', senal, puntos, maximo: 15, estado, motivo })
  const p = s.promesa.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const promesa = !p ? r('promesa', 'Promesa alcanzada', 0, 'sin_dato', 'La columna «Promesa» del CRM está vacía.')
    : p.startsWith('si') ? r('promesa', 'Promesa alcanzada', 15, 'suma', 'El CRM marca la promesa como alcanzada.')
      : p.startsWith('parcial') ? r('promesa', 'Promesa alcanzada', 7, 'parcial', 'El CRM marca la promesa alcanzada en parte: suma la mitad.')
        : r('promesa', 'Promesa alcanzada', 0, 'no_suma', 'El CRM marca que la promesa todavía no se alcanzó.')
  const n = s.wins
  const wins = n === null ? r('wins', `Wins cargados (últimos ${DIAS_WINS} días)`, 0, 'sin_dato', 'No se pudo leer la base de wins.')
    : n >= 2 ? r('wins', `Wins cargados (últimos ${DIAS_WINS} días)`, 15, 'suma', `${plural(n, 'win cargado', 'wins cargados')} en los últimos ${DIAS_WINS} días.`)
      : n === 1 ? r('wins', `Wins cargados (últimos ${DIAS_WINS} días)`, 8, 'parcial', `1 win cargado en los últimos ${DIAS_WINS} días: con 2 o más suma 15.`)
        : r('wins', `Wins cargados (últimos ${DIAS_WINS} días)`, 0, 'no_suma', `Ningún win cargado en los últimos ${DIAS_WINS} días.`)
  return [promesa, wins]
}

function bloqueEquipo(s: SenalesPuntaje): Renglon {
  const r = (puntos: number, estado: EstadoRenglon, motivo: string): Renglon => ({ clave: 'eow', bloque: 'equipo', senal: 'Semáforo de Gero M en el último EOW', puntos, maximo: 20, estado, motivo })
  if (!s.eowLeido) return r(0, 'sin_dato', 'No se pudo leer el EOW (o todavía no hay ninguno).')
  if (!s.eow) return r(0, 'sin_dato', 'El cliente no figura en el último EOW.')
  if (s.eow.color === 'verde') return r(20, 'suma', 'Verde en el último EOW.')
  if (s.eow.color === 'amarillo') return r(10, 'parcial', 'Amarillo en el último EOW.')
  if (s.eow.color === 'rojo') return r(0, 'no_suma', 'Rojo en el último EOW.')
  return r(0, 'sin_dato', 'Figura como recién lanzado, todavía sin ubicar en el EOW.')
}

function bonus(s: SenalesPuntaje): Renglon[] {
  const r = (clave: string, senal: string, maximo: number, puntos: number, estado: EstadoRenglon, motivo: string): Renglon => ({ clave, bloque: 'bonus', senal, puntos, maximo, estado, motivo })
  return [
    s.renovo ? r('renovo', 'Renovó', 5, 5, 'suma', 'Renovó al menos una vez.') : r('renovo', 'Renovó', 5, 0, 'no_suma', 'Todavía no renovó.'),
    s.pagos === 'al_dia' ? r('pagos', 'Pagos al día', 4, 4, 'suma', 'Su plan de cuotas no tiene cuotas vencidas.')
      : s.pagos === 'atrasado' ? r('pagos', 'Pagos al día', 4, 0, 'no_suma', 'Tiene una cuota vencida sin pagar.')
        : r('pagos', 'Pagos al día', 4, 0, 'sin_dato', 'Sin plan de cuotas en el tablero de cuotas: no se puede confirmar.'),
    s.referido === null ? r('referido', 'Trajo un referido', 3, 0, 'sin_dato', 'No se pudo leer la pestaña Referidos.')
      : s.referido ? r('referido', 'Trajo un referido', 3, 3, 'suma', 'Presentó al menos un referido.') : r('referido', 'Trajo un referido', 3, 0, 'no_suma', 'Todavía no presentó referidos.'),
    s.grabaYResponde === null ? r('graba', 'Graba y responde a tiempo', 3, 0, 'sin_dato', 'El Despacho todavía no mide esta señal.')
      : s.grabaYResponde ? r('graba', 'Graba y responde a tiempo', 3, 3, 'suma', 'Graba y responde a tiempo.') : r('graba', 'Graba y responde a tiempo', 3, 0, 'no_suma', 'Se demora en grabar o en responder.'),
  ]
}

function restas(s: SenalesPuntaje): Renglon[] {
  const r = (clave: string, senal: string, maximo: number, aplica: boolean | null, si: string, no: string, sinDato: string): Renglon =>
    ({ clave, bloque: 'resta', senal, maximo: -maximo, puntos: aplica ? -maximo : 0, estado: aplica === null ? 'sin_dato' : aplica ? 'resta' : 'no_aplica', motivo: aplica === null ? sinDato : aplica ? si : no })
  const sinMeta = !s.metaLeida ? null : s.meta ? undefined : false
  return [
    r('rojo_meta', 'Semáforo rojo en Meta', 10, sinMeta === undefined ? s.meta!.semaforo === 'rojo' : sinMeta, 'El tablero de Anuncios lo tiene en rojo.', 'El tablero de Anuncios no lo tiene en rojo.', 'Meta no respondió en esta lectura.'),
    r('pesadilla', 'Reclamo abierto o «cliente pesadilla» en el EOW', 15, !s.eowLeido ? null : !!s.eow?.pesadilla,
      'Figura en «Cliente pesadilla» del último EOW.', 'No figura en «Cliente pesadilla» del último EOW (el EOW ya no lleva reclamos abiertos).', 'No se pudo leer el EOW.'),
    r('pago_atrasado', 'Pago atrasado', 10, s.pagos === null ? null : s.pagos === 'atrasado', 'Tiene una cuota vencida sin pagar.', 'Sin cuotas vencidas.', 'Sin plan de cuotas en el tablero de cuotas.'),
    r('falta_pago', 'Campaña parada por falta de pago', 10, sinMeta === undefined ? s.meta!.errorPago : sinMeta, 'La cuenta de Meta está frenada por un problema de pago.', 'La cuenta de Meta no tiene problemas de pago.', 'Meta no respondió en esta lectura.'),
  ]
}

/** El puntaje completo de un cliente que ya lanzó. */
export function calcularPuntaje(s: SenalesPuntaje): ResultadoPuntaje {
  const cien = [...bloqueAnuncios(s), ...bloqueResultados(s), bloqueEquipo(s)]
  const extra = bonus(s)
  const menos = restas(s)
  const base = cien.reduce((t, x) => t + x.puntos, 0)
  const restado = menos.reduce((t, x) => t - x.puntos, 0)
  const sinMeta = !s.metaLeida
  // Sin Meta el bloque Anuncios (50) no se midió: un interno sin él se leería como «el cliente está mal». No se muestra
  const interno = sinMeta ? null : Math.max(0, base - restado)
  const b = Math.min(BONUS_MAXIMO, extra.reduce((t, x) => t + x.puntos, 0))
  const total = interno === null ? null : interno + b
  const cliente = puntajeCliente(s.encuesta)
  const estimado = cliente === null && total !== null
  const nivel = cliente !== null ? nivelDe(cliente) : total !== null ? nivelDe(total) : null
  let brecha: Brecha | null = null
  // La brecha compara con el interno SIN bonus: los dos están en 0–100 y el bonus mide compromiso, no resultados
  if (cliente !== null && interno !== null && Math.abs(cliente - interno) >= UMBRAL_BRECHA) {
    const diferencia = Math.abs(cliente - interno)
    brecha = cliente < interno
      ? { tipo: 'peor', diferencia, texto: 'Se siente peor que los números: prioridad para llamarlo.' }
      : { tipo: 'mejor', diferencia, texto: 'Se siente mejor que los números: cuidar que los resultados acompañen.' }
  }
  const detalle = [...cien, ...extra, ...menos]
  const rama = s.rama ?? null
  return { cliente, clienteDia: cliente === null ? null : s.encuesta?.dia ?? null, base, restas: restado, interno, bonus: b, total, nivel, estimado, sinMeta, rama, brecha, sinDato: detalle.filter(x => x.estado === 'sin_dato').length, detalle }
}

export const TEXTO_SIN_META = 'Interno: sin datos de Meta'

/** «Cliente 80 · Interno 72 +8» / «Cliente — · Interno 72 (estimado)» / «Cliente 80 · Interno: sin datos de Meta»: la línea
 *  chica de la cartera. Sin Meta y sin respuesta del cliente queda solo «Interno: sin datos de Meta». */
export function textoCompacto(p: Pick<ResultadoPuntaje, 'cliente' | 'interno' | 'bonus' | 'estimado'>): string {
  if (p.interno === null) return p.cliente === null ? TEXTO_SIN_META : `Cliente ${p.cliente} · ${TEXTO_SIN_META}`
  const interno = `Interno ${p.interno}${p.bonus ? ` +${p.bonus}` : ''}`
  return `Cliente ${p.cliente ?? '—'} · ${interno}${p.estimado ? ' (estimado)' : ''}`
}

/** Sugerencia que NO mueve nada: si el nivel llegó a Éxito y la etapa todavía no lo dice. */
export function sugerencia(p: Pick<ResultadoPuntaje, 'nivel' | 'cliente' | 'total' | 'estimado'>, etapa: string | null): string | null {
  if (p.nivel !== 'exito' || etapa === 'exito') return null
  return `Llegó a ${p.cliente ?? p.total}${p.estimado ? ' (estimado)' : ''}: si corresponde, anotar Éxito en el registro.`
}

// ── Cuándo hay puntaje: solo para los clientes que ya lanzaron (los demás están «en producción») ──
/** Ya lanzó: el hito «Campaña lanzada» (anotado, guardado al ver gasto en Meta o deducido del registro), o Meta lo ve corriendo. */
export function yaLanzo(e: { hitoLanzamiento: boolean; metaActiva?: boolean; primerLanzamiento?: string | null; etapa?: string | null }): boolean {
  return e.hitoLanzamiento || !!e.metaActiva || !!e.primerLanzamiento || e.etapa === 'lanzado' || e.etapa === 'exito'
}

// ── Lo que viaja al navegador para la cartera (liviano) ──
export interface PuntajeCompacto { cliente: number | null; interno: number | null; bonus: number; nivel: Nivel | null; estimado: boolean; brecha: Brecha['tipo'] | null }
export const compacto = (p: ResultadoPuntaje): PuntajeCompacto => ({ cliente: p.cliente, interno: p.interno, bonus: p.bonus, nivel: p.nivel, estimado: p.estimado, brecha: p.brecha?.tipo ?? null })
