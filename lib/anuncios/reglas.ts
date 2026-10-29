// ── Reglas del tablero de anuncios: CPL, días corriendo, aumentos, pagos, saldo y semáforo ────
// Funciones puras (sin I/O): reciben la cuenta, sus días de insights y la fecha de "hoy" (AR).
// Así se pueden evaluar "como si fuera ayer" para detectar rojos NUEVOS en la alerta diaria.
//
// CPL = costo por mensaje = gasto / acciones "onsite_conversion.messaging_conversation_started_7d"
// (misma definición que usaba el media buyer). Solo se usan días COMPLETOS (hasta ayer); el día de
// hoy se muestra aparte como parcial.
//
// ── REGLAS FINALES (ajustar acá) ──
// TODO EN USD: cada cuenta se pasa a dólares (ARS con el dólar MEP venta del día, otras monedas con
// su cotización del día; ver tablero.ts → usdPor). Los textos y Discord muestran solo USD.
// 1. Nivel de CPL (con el CPL del día anterior completo, en USD):
//      hasta 2,80 OK (verde) · más de 2,80 a 4 MEDIO (amarillo) · más de 4 ALTO (rojo)
//      Cada RAMA del derecho puede tener sus propios valores (ramas.ts → UMBRALES_RAMA).
//      Sin cotización (raro): contra su propio histórico (+20% OK · +60% MEDIO · más ALTO).
//    Ayer sin actividad → sin datos (amarillo); con gasto y sin mensajes → rojo.
//    Las alertas históricas y el stock no cambian el color diario; los errores de pago tienen prioridad.
// 2. RACHA DE SUBA (el patrón de "se está quemando") — NO cambia el color (el color va solo por el
//    CPL actual); se marca aparte con el icono ↗ y se puede filtrar: se miran los últimos días hábiles normales
//    con gasto (sin fines de semana, feriados ni días malos de Meta) y se cuentan los días SEGUIDOS,
//    desde el más nuevo, en que el CPL del día quedó 20% o más arriba de su base (los 10 días hábiles
//    anteriores a esos 5) o gastó sin mensajes:
//      2 días o menos → nada (puede ser ruido)
//      3 días → "subiendo hace 3 días"
//      4 días → revisar nuevos guiones; durante competencia se suspende la alerta
// 3. PRIMERA TANDA: cuatro días completos con gasto y CPL alto o sin mensajes tras lanzar.
// 4. FINES DE SEMANA Y FERIADOS (feriados.ts): NO entran en el punto 2. Si ayer fue fin de
//    semana o feriado y el CPL de ese bloque supera en 30%+ a la base hábil → nota "fin de semana
//    / feriado: suele subir" (sin alerta). Solo alerta (rojo) si es EXTREMO: 2,5 veces la base o
//    más, o gasto mínimo sin ningún mensaje.
// 5. GASTA SIN MENSAJES: en los últimos 2 días hábiles gastó algo (USD 1 / ARS 1.000 / otras:
//    1/4 de su gasto diario promedio) y tuvo 0 mensajes → rojo. (USD 1 equivalente si hay cotización)
// 6. PAGOS: account_status 3 (deuda sin saldar), 7 (revisión de riesgo), 8 (pago pendiente de
//    liquidación), 9 (período de gracia) y 2 (deshabilitada, con disable_reason) → rojo (amarillo si
//    el cliente está PAUSADO en el CRM). Sin medio de pago cargado → rojo si está gastando.
// 7. SALDO: si tiene límite de gasto (spend_cap) → restante = límite − gastado; si es prepaga, el
//    "Saldo disponible" de funding_source_details. Días que le quedan = restante / gasto diario
//    promedio de 7 días. 3 días o menos (o sin saldo) → rojo; 7 días o menos → amarillo.
// 4b. DÍAS MALOS DE META (diasMalos.ts): días en que el CPL subió en casi todas las cuentas a la vez.
//    Tampoco entran en los puntos 2, 3, 4 y 5: no es culpa de la cuenta ni del guion. Se anotan.
// 8. FRENADA: sin gasto hoy ni ayer → amarillo "frenada hace N días" (nota gris si el cliente está
//    PAUSADO en el CRM).  SIN GUIONES (sheet de guiones) → amarillo.
// SEMÁFORO: ERROR (pago con error o sin medio de pago gastando: prioridad solucionarlo) > ROJO >
// AMARILLO > VERDE. Orden: errores arriba, después rojos, después amarillos, después verdes; dentro de cada color, el motivo más grave
// y después el que más gasta.
import { esHabil, tipoDia } from './feriados'
import { diasEntre, dm, fmtGasto, fmtMonto, fmtPct, sumarDias } from './formato'
import type { CuentaMeta, DiaInsight } from './meta'
import type { Guiones } from './cruce'

import { UMBRAL_GENERAL } from './ramas'
const SUBA_DIA = 1.2           // un día "subió" si su CPL es 20%+ más caro que la base
const RACHA_MAX = 5
const FINDE_NOTA = 1.3
const FINDE_EXTREMO = 2.5
const VENTANA_DIAS = 35          // días de insights que se piden (5 semanas)
const ESTADOS_ERROR_PAGO = [2, 3, 7, 8]

export type Nivel = 'ok' | 'medio' | 'alto' | 'sin_ref' | 'sin_datos'
export type Semaforo = 'sin_gasto' | 'error' | 'rojo' | 'amarillo' | 'verde'
export type TipoMotivo = 'pago' | 'saldo' | 'sin_mensajes' | 'grabar' | 'no_rinde' | 'quemando' | 'cpl_alto' | 'finde' | 'sin_medio_pago'
  | 'cpl_medio' | 'subiendo' | 'saldo_bajo' | 'frenada' | 'sin_guiones' | 'sin_datos'
export interface Motivo { tipo: TipoMotivo; texto: string; color: 'rojo' | 'amarillo' }

const PESO: Record<TipoMotivo, number> = {
  pago: 90, saldo: 85, sin_mensajes: 80, grabar: 78, no_rinde: 75, quemando: 72, cpl_alto: 70, finde: 55, sin_medio_pago: 50,
  cpl_medio: 40, subiendo: 38, saldo_bajo: 30, frenada: 25, sin_guiones: 20, sin_datos: 10,
}
// Motivos que dependen solo del rendimiento (sirven para comparar "hoy vs ayer" en la alerta diaria)
export const MOTIVOS_RENDIMIENTO: TipoMotivo[] = ['sin_mensajes', 'grabar', 'no_rinde', 'quemando', 'cpl_alto', 'finde']

export interface Analisis {
  cpl: { ayer: number | null; d7: number | null; d7prev: number | null; historico: number | null; nivel: Nivel; variacion7: number | null }
  gasto: { hoy: number; ayer: number; d7: number; d7prev: number; promedioDiario: number }
  mensajes: { hoy: number; ayer: number; d7: number; d7prev: number }
  corriendo: { dias: number; desdeVentana: boolean; frenadaHace: number | null; sinGastoEnVentana: boolean; sinAnunciosActivos?: boolean }
  tendencia: {
    tipo: 'subiendo' | 'quemando' | 'grabar' | 'finde' | 'mejora' | 'estable' | 'sin_datos'
    texto: string
    cplReciente: number | null
    cplBase: number | null
    variacion: number | null
    racha: number                // días hábiles seguidos con el CPL 20%+ arriba de su base
  }
  aGrabar: 'quema' | 'no_rinde' | null   // va a la lista "Guiones a grabar"
  aumento: { dias: number; nivel: 'subiendo' | 'quemando' | 'grabar'; texto: string } | null   // racha de suba (icono ↗, no cambia el color)
  pago: { periodoGracia: boolean; codigo: number; errorPago: boolean; texto: string; sinMedioPago: boolean; medio: string | null; nuevo: { desde: string; dia: number } | null }   // nuevo = entró en error de pago hace menos de 3 días (se muestra en azul)
  saldo: { restante: number | null; dias: number | null; fuente: 'limite' | 'prepago' | null }
  semaforo: Semaforo
  motivos: Motivo[]
  notas: string[]
  frase: string
  prioridad: number
  serie: { d: string; g: number; m: number; h: boolean; x: boolean }[]   // h = hábil · x = día malo de Meta
}

// ── Helpers ──
function nivelCPL(cplUSD: number | null, cpl: number | null, historico: number | null, u: { ok: number; medio: number }): Nivel {
  if (cpl == null) return 'sin_datos'
  if (cplUSD != null) return cplUSD <= u.ok ? 'ok' : cplUSD <= u.medio ? 'medio' : 'alto'
  if (historico == null || historico <= 0) return 'sin_ref'
  const r = cpl / historico
  return r <= 1.2 ? 'ok' : r <= 1.6 ? 'medio' : 'alto'
}
// Mínimos en USD (pasados a la moneda de la cuenta); sin cotización, los de antes
const gastoMinimo = (moneda: string, promedioDiario: number, usdPor: number | null) =>
  usdPor ? 5 * usdPor : moneda === 'ARS' ? 5000 : Math.max(promedioDiario * 1.5, 0.01)
const gastoMinimoSinMensajes = (moneda: string, promedioDiario: number, usdPor: number | null) =>
  usdPor ? 1 * usdPor : moneda === 'ARS' ? 1000 : Math.max(promedioDiario * 0.25, 0.01)
const cplDe = (g: number, m: number) => (m > 0 ? g / m : null)
const nDias = (n: number) => { const d = Math.max(0, Math.floor(n)); return `${d} día${d === 1 ? '' : 's'}` }

const TEXTO_ESTADO: Record<number, string> = {
  1: 'activa', 2: 'cuenta deshabilitada', 3: 'error de pago: deuda sin saldar', 7: 'en revisión de riesgo de pago',
  8: 'pago pendiente de liquidación', 9: 'período de gracia: Meta corta si no se paga', 100: 'cierre pendiente', 101: 'cerrada',
}
const MOTIVO_BAJA: Record<number, string> = {
  1: 'políticas de anuncios', 2: 'revisión de propiedad intelectual', 3: 'riesgo de pago', 4: 'cuenta gris cerrada',
  5: 'revisión AFC', 6: 'integridad del negocio', 7: 'cierre permanente', 8: 'cuenta de revendedor sin uso', 9: 'cuenta sin uso',
  10: 'cuenta paraguas', 11: 'políticas del Business Manager', 12: 'cuenta tergiversada', 13: 'entidad legal', 14: 'revisión de hilos', 15: 'cuenta comprometida',
}
export function textoEstadoCuenta(codigo: number, motivoBaja = 0): string {
  const base = TEXTO_ESTADO[codigo] ?? `estado ${codigo}`
  return codigo === 2 && motivoBaja ? `${base} (${MOTIVO_BAJA[motivoBaja] ?? `motivo ${motivoBaja}`})` : base
}

// "Saldo disponible ($1.234,56 ARS)" / "Available balance ($12.34 USD)" → número
export function montoDeTexto(texto: string): number | null {
  if (!/saldo|balance|disponible|available|fondos|funds/i.test(texto)) return null
  const m = texto.match(/-?\d[\d.,]*/)
  if (!m) return null
  let s = m[0]
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')        // 1.234,56
  else if (/\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '')                       // 1,234.56
  else s = s.replace(/[.,]/g, '')                                              // 1.234 / 1,234
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

// ── Análisis de una cuenta ──
export function analizarCuenta(
  cuenta: CuentaMeta | null,
  dias: DiaInsight[] | null,
  hoy: string,
  ctx: { pausado: boolean; guiones: Guiones | null; moneda: string; diasMalos?: Set<string>; usdPor?: number | null; umbral?: { ok: number; medio: number }; periodoCPL?: 'ayer' | 'd7'; fechaLanzamiento?: string | null; enCompetencia?: boolean; errorPagoDesde?: string | null },
): Analisis {
  const moneda = cuenta?.moneda ?? ctx.moneda
  const usdPor = moneda === 'USD' ? 1 : ctx.usdPor && ctx.usdPor > 0 ? ctx.usdPor : null
  const enUSD = (v: number | null | undefined) => (v == null ? null : usdPor ? v / usdPor : null)
  // Montos en texto: siempre en USD (si no hay cotización, en su moneda)
  const fmtCPL = (v: number | null | undefined) => usdPor ? fmtMonto(enUSD(v), 'USD') : fmtMonto(v, moneda)
  const fmtG = (v: number | null | undefined) => usdPor ? fmtGasto(enUSD(v), 'USD') : fmtGasto(v, moneda)
  const porDia = new Map((dias ?? []).map(x => [x.d, x]))
  const g = (d: string) => porDia.get(d)?.g ?? 0
  const m = (d: string) => porDia.get(d)?.m ?? 0
  const rango = (desde: number, hasta: number) => {   // días hacia atrás desde hoy (1 = ayer), inclusive
    let gs = 0, ms = 0
    for (let i = desde; i <= hasta; i++) { const d = sumarDias(hoy, -i); gs += g(d); ms += m(d) }
    return { g: gs, m: ms }
  }
  const ayer = sumarDias(hoy, -1)
  const r7 = rango(1, 7), r7p = rango(8, 14), rHist = rango(8, 28)
  const promedioDiario = r7.g / 7
  const cpl7 = cplDe(r7.g, r7.m), cpl7p = cplDe(r7p.g, r7p.m), cplHist = cplDe(rHist.g, rHist.m)
  const minimo = gastoMinimo(moneda, promedioDiario, usdPor)
  const cplAyer = cplDe(g(ayer), m(ayer))
  const semanal = ctx.periodoCPL === 'd7'
  const cplEstado = semanal ? cpl7 : cplAyer
  const gastoEstado = semanal ? r7.g : g(ayer)
  const mensajesEstado = semanal ? r7.m : m(ayer)
  const periodoEstado = semanal ? '7 días' : 'ayer'
  const nivel: Nivel = !dias || (gastoEstado === 0 && mensajesEstado === 0) ? 'sin_datos'
    : cplEstado == null ? 'alto' : nivelCPL(enUSD(cplEstado), cplEstado, cplHist, ctx.umbral ?? UMBRAL_GENERAL)
  // La evidencia semanal para guiones sigue siendo independiente del estado diario.

  // ── Días corriendo / frenada ──
  let diasCorriendo = 0, frenadaHace: number | null = null, desdeVentana = false, sinGastoEnVentana = false
  const inicio = g(hoy) > 0 ? hoy : g(ayer) > 0 ? ayer : null
  if (inicio) {
    let d = inicio
    while (g(d) > 0 && diasCorriendo < VENTANA_DIAS) { diasCorriendo++; d = sumarDias(d, -1) }
    desdeVentana = d < sumarDias(hoy, -(VENTANA_DIAS - 1))   // la racha llega al principio de los datos: son "N+" días
  } else {
    const conGasto = (dias ?? []).filter(x => x.g > 0 && x.d <= hoy).map(x => x.d).sort()
    const ultimo = conGasto[conGasto.length - 1]
    if (ultimo) frenadaHace = diasEntre(ultimo, hoy)
    else { frenadaHace = VENTANA_DIAS; sinGastoEnVentana = true }
  }
  const corriendo = !!inicio
  const sinAnunciosActivos = cuenta?.entrega === 'sin_activos'
  const rendimientoActivo = corriendo && !ctx.pausado && !sinAnunciosActivos

  // ── Tendencia (solo días hábiles con gasto; hoy no cuenta) ──
  const completos: string[] = []
  for (let i = 1; i <= VENTANA_DIAS - 1; i++) completos.push(sumarDias(hoy, -i))
  const malo = (d: string) => !!ctx.diasMalos?.has(d)
  const habilesActivos = completos.filter(d => esHabil(d) && !malo(d) && g(d) > 0)
  const suma = (ds: string[]) => ds.reduce((a, d) => ({ g: a.g + g(d), m: a.m + m(d) }), { g: 0, m: 0 })
  // Racha: días hábiles normales con gasto mínimo, del más nuevo al más viejo
  const minDia = gastoMinimoSinMensajes(moneda, promedioDiario, usdPor)
  const normales = habilesActivos.filter(d => g(d) >= minDia)
  const ultimos = normales.slice(0, RACHA_MAX), base = normales.slice(RACHA_MAX, RACHA_MAX + 10)
  const sB = suma(base)
  const cplB = cplDe(sB.g, sB.m)
  const tramoActual = ultimos.length > 0 && ultimos[0] >= sumarDias(hoy, -4)
  let racha = 0
  if (tramoActual && base.length >= 5 && sB.m >= 5 && cplB != null) {
    for (const d of ultimos) { const c = cplDe(g(d), m(d)); if (c == null || c >= cplB * SUBA_DIA) racha++; else break }
  }
  const sR = suma(ultimos.slice(0, Math.max(racha, 3)))
  const cplR = cplDe(sR.g, sR.m)
  const variacion = cplR != null && cplB ? cplR / cplB - 1 : null
  let tendencia: Analisis['tendencia'] = { tipo: 'sin_datos', texto: 'pocos datos para ver tendencia', cplReciente: cplR, cplBase: cplB, variacion: null, racha }
  let mejora = false
  if (tramoActual && base.length >= 5 && sB.m >= 5 && cplB != null) {
    const vs = `${fmtCPL(cplR)} vs. ${fmtCPL(cplB)}`
    if (racha >= 4) tendencia = { tipo: 'grabar', texto: `se quema hace ${racha} días hábiles seguidos (${vs})`, cplReciente: cplR, cplBase: cplB, variacion, racha }
    else if (racha === 3) tendencia = { tipo: 'subiendo', texto: `subiendo hace 3 días (${vs})`, cplReciente: cplR, cplBase: cplB, variacion, racha }
    else if (variacion != null && variacion <= -0.25) { mejora = true; tendencia = { tipo: 'mejora', texto: `bajando: ${fmtPct(variacion)} (últimos días hábiles)`, cplReciente: cplR, cplBase: cplB, variacion, racha } }
    else tendencia = { tipo: 'estable', texto: racha ? `${racha} día${racha > 1 ? 's' : ''} más caro, todavía sin patrón` : 'estable', cplReciente: cplR, cplBase: cplB, variacion, racha }
  }
  // Fin de semana / feriado: bloque de días no hábiles que termina ayer
  let findeExtremo = false
  const notas: string[] = []
  if (tipoDia(ayer) === 'finde') {
    const bloque: string[] = []
    for (let d = ayer; tipoDia(d) === 'finde' && bloque.length < 5; d = sumarDias(d, -1)) if (!malo(d)) bloque.push(d)
    const sF = suma(bloque)
    const baseHabil = cplB ?? cplDe(suma(habilesActivos.slice(0, 10)).g, suma(habilesActivos.slice(0, 10)).m)
    if (sF.g > 0 && baseHabil != null) {
      const cplF = cplDe(sF.g, sF.m)
      const ratio = cplF == null ? Infinity : cplF / baseHabil
      if ((cplF == null && sF.g >= minimo) || (ratio >= FINDE_EXTREMO && sF.g >= minimo * 0.5)) {
        findeExtremo = true
        if (racha < 3) tendencia = { tipo: 'finde', texto: cplF == null ? 'fin de semana / feriado sin mensajes' : `fin de semana / feriado muy caro: ${fmtPct(ratio - 1)} vs. días hábiles`, cplReciente: cplF, cplBase: baseHabil, variacion: ratio - 1, racha }
      } else if (ratio >= FINDE_NOTA) {
        notas.push(`fin de semana / feriado: suele subir (${fmtPct(ratio - 1)} vs. hábiles, sin alerta)`)
        if (tendencia.tipo === 'sin_datos' || tendencia.tipo === 'estable') tendencia = { tipo: 'finde', texto: `fin de semana / feriado: suele subir (${fmtPct(ratio - 1)})`, cplReciente: cplF, cplBase: baseHabil, variacion: ratio - 1, racha }
      }
    }
  }
  if (mejora) notas.push(tendencia.texto)
  if (malo(ayer) && g(ayer) > 0) notas.push('ayer fue un día malo de Meta (subió en casi todas las cuentas): no cuenta para las alertas')

  // ── Gasta sin mensajes: últimos 2 días hábiles del calendario ──
  const ultimos2: string[] = []
  for (let i = 1; ultimos2.length < 2 && i <= 10; i++) { const d = sumarDias(hoy, -i); if (esHabil(d) && !malo(d)) ultimos2.push(d) }
  const s2 = suma(ultimos2)
  const sinMensajes = !!dias && s2.m === 0 && s2.g >= gastoMinimoSinMensajes(moneda, promedioDiario, usdPor)

  // ── Pago y saldo ──
  const codigo = cuenta?.estado ?? 0
  const errorPago = ESTADOS_ERROR_PAGO.includes(codigo)
  const sinMedioPago = !!cuenta && !cuenta.medioPago?.id
  const pago: Analisis['pago'] = {
    periodoGracia: codigo === 9, codigo, errorPago, sinMedioPago,
    texto: cuenta ? textoEstadoCuenta(codigo, cuenta.motivoBaja) : 'sin datos de la cuenta',
    medio: cuenta?.medioPago?.texto ?? null,
    nuevo: errorPago && ctx.errorPagoDesde && diasEntre(ctx.errorPagoDesde, hoy) + 1 <= 3 ? { desde: ctx.errorPagoDesde, dia: diasEntre(ctx.errorPagoDesde, hoy) + 1 } : null,
  }
  let restante: number | null = null, fuente: Analisis['saldo']['fuente'] = null
  if (cuenta && cuenta.limiteGasto > 0) { restante = cuenta.limiteGasto - cuenta.gastadoTotal; fuente = 'limite' }
  const prepago = cuenta?.medioPago?.texto ? montoDeTexto(cuenta.medioPago.texto) : null
  if (prepago != null && (restante == null || prepago < restante)) { restante = prepago; fuente = 'prepago' }
  const diasSaldo = restante != null && promedioDiario > 0 ? restante / promedioDiario : null

  // ── Motivos y semáforo ──
  const motivos: Motivo[] = []
  const add = (tipo: TipoMotivo, texto: string, color: 'rojo' | 'amarillo') => motivos.push({ tipo, texto, color })
  if (errorPago) add('pago', ctx.pausado ? `${pago.texto} (cliente en pausa)` : (pago.nuevo ? `Error de pago nuevo (día ${pago.nuevo.dia} de 3, desde el ${dm(pago.nuevo.desde)}): ${pago.texto.replace(/^error de pago: /i, '')}` : pago.texto[0].toUpperCase() + pago.texto.slice(1)), ctx.pausado ? 'amarillo' : 'rojo')
  if (sinMedioPago && !errorPago && codigo !== 9) add('sin_medio_pago', 'Sin medio de pago cargado', corriendo ? 'rojo' : 'amarillo')
  if (restante != null && (corriendo || restante <= 0)) {
    if (restante <= 0) add('saldo', fuente === 'limite' ? 'Sin saldo: llegó al límite de gasto' : 'Sin saldo prepago', 'rojo')
    else if (diasSaldo != null && diasSaldo <= 3) add('saldo', `Se queda sin saldo: ~${nDias(diasSaldo)} (${fmtG(restante)})`, 'rojo')
    else if (diasSaldo != null && diasSaldo <= 7) add('saldo_bajo', `Saldo bajo: ~${nDias(diasSaldo)} (${fmtG(restante)})`, 'amarillo')
  }
  if (codigo === 9) notas.push('Período de gracia: revisar pago; no es un error de pago')
  if (rendimientoActivo && sinMensajes) add('sin_mensajes', `Gasta sin mensajes: ${fmtG(s2.g)} en los últimos 2 días hábiles y 0 mensajes`, 'rojo')
  // Primera tanda: cuatro días completos desde el lanzamiento con gasto y CPL alto
  // del cliente. No pedir guiones por stock ni por semanas históricas tras optimizar.
  const diasTanda = [1, 2, 3, 4].map(i => sumarDias(hoy, -i))
  const noRinde = rendimientoActivo && !ctx.enCompetencia && !!ctx.fechaLanzamiento
    && diasEntre(ctx.fechaLanzamiento, hoy) >= 4 && diasEntre(ctx.fechaLanzamiento, hoy) <= 10
    && diasTanda.every(d => d >= ctx.fechaLanzamiento! && g(d) >= minDia && !malo(d)
      && (m(d) === 0 || nivelCPL(enUSD(cplDe(g(d), m(d))), cplDe(g(d), m(d)), cplHist, ctx.umbral ?? UMBRAL_GENERAL) === 'alto'))
  if (noRinde) add('no_rinde', 'Primera tanda sin resultados suficientes: CPL del cliente alto o sin mensajes durante 4 días completos; revisar guiones', 'rojo')
  if (rendimientoActivo && nivel === 'alto')
    add('cpl_alto', cplEstado == null ? `${fmtG(gastoEstado)} sin mensajes (${periodoEstado})` : `CPL alto: ${fmtCPL(cplEstado)} (${periodoEstado})`, 'rojo')
  if (rendimientoActivo && nivel === 'medio') add('cpl_medio', `CPL medio: ${fmtCPL(cplEstado)} (${periodoEstado})`, 'amarillo')
  const pct = variacion != null ? ` (${fmtPct(variacion)})` : ''
  // La racha de suba NO cambia el color (que va por el CPL actual): se marca aparte con "aumento"
  const aumento: Analisis['aumento'] = rendimientoActivo && racha >= 3 ? {
    dias: racha,
    nivel: racha >= 4 ? 'grabar' : 'subiendo',
    texto: ctx.enCompetencia ? `CPL elevado ${racha} días${pct} · mejores compitiendo; sin pedido de guiones` : racha >= 4 ? `Se quema hace ${racha} días seguidos: revisar nuevos guiones${pct}` : `Subiendo hace 3 días${pct}`,
  } : null
  if (rendimientoActivo && findeExtremo) add('finde', tendencia.tipo === 'finde' ? tendencia.texto[0].toUpperCase() + tendencia.texto.slice(1) : 'Fin de semana / feriado muy caro', 'rojo')
  if (ctx.pausado && corriendo) notas.push('Cliente en pausa según el CRM; gasto reciente conservado como histórico')
  if (!rendimientoActivo) notas.push('Alertas de rendimiento suspendidas; el CPL de 7 días es histórico')
  if (sinAnunciosActivos && !ctx.pausado) add('frenada', 'Sin anuncios activos en Meta', 'amarillo')
  else if (!corriendo) {
    const txt = sinGastoEnVentana ? `sin gasto en ${VENTANA_DIAS}+ días` : `sin gasto reciente: último gasto hace ${frenadaHace} día${frenadaHace === 1 ? '' : 's'}`
    if (ctx.pausado) notas.push(`${txt} (cliente en pausa según el CRM)`)
    else add('frenada', txt[0].toUpperCase() + txt.slice(1), 'amarillo')
  }
  const quema = rendimientoActivo && !ctx.enCompetencia && racha >= 4
  if (quema) add('grabar', `CPL en aumento consistente durante ${racha} días: revisar nuevos guiones`, 'rojo')
  if ((quema || noRinde) && ctx.guiones?.estado === 'sin_guiones') add('sin_guiones', 'Se necesitan nuevos guiones; todavía sin hacer', 'amarillo')
  if (ctx.enCompetencia) notas.push('Mejores compitiendo: alertas de nuevos guiones suspendidas durante 7 días desde la optimización')
  if (!dias && cuenta) add('sin_datos', 'Sin datos de gasto de Meta', 'amarillo')

  motivos.sort((a, b) => Number(b.color === 'rojo') - Number(a.color === 'rojo') || PESO[b.tipo] - PESO[a.tipo])
  const esError = errorPago || motivos.some(x => x.color === 'rojo' && (x.tipo === 'pago' || x.tipo === 'sin_medio_pago'))
  const semaforo: Semaforo = esError ? 'error' : ctx.pausado || sinAnunciosActivos || (!!dias && (gastoEstado === 0 || !corriendo)) ? 'sin_gasto' : !rendimientoActivo ? 'amarillo' : nivel === 'alto' ? 'rojo' : nivel === 'ok' ? 'verde' : 'amarillo'
  const aGrabar: Analisis['aGrabar'] = quema ? 'quema' : noRinde ? 'no_rinde' : null
  const estadoDiario = nivel === 'sin_datos' ? `Sin actividad para medir el CPL (${periodoEstado})`
    : cplEstado == null ? `${fmtG(gastoEstado)} sin mensajes (${periodoEstado})`
    : `CPL ${nivel === 'ok' ? 'OK' : nivel === 'medio' ? 'medio' : nivel === 'alto' ? 'alto' : 'sin referencia'} ${fmtCPL(cplEstado)} (${periodoEstado})`
  let frase = [!esError && rendimientoActivo ? estadoDiario : '', ...motivos.filter(x => !['cpl_alto', 'cpl_medio'].includes(x.tipo)).slice(0, 3).map(x => x.texto)].filter(Boolean).join(' · ')
  if (semaforo === 'verde') {
    const partes: string[] = []
    if (nivel === 'ok') partes.push(`CPL OK ${fmtCPL(cplEstado)} (${periodoEstado})`)
    else if (nivel === 'sin_ref') partes.push(`CPL ${fmtCPL(cplEstado)} (${periodoEstado}, sin histórico para comparar)`)
    else if (nivel === 'sin_datos' && corriendo) partes.push('Ayer sin actividad para medir el CPL')
    if (corriendo) partes.push(`corriendo hace ${diasCorriendo}${desdeVentana ? '+' : ''} días`)
    if (notas.length) partes.push(notas[0])
    frase = partes.join(' · ') || 'Todo en orden'
  }
  if (semaforo === 'sin_gasto') frase = `Sin gasto evaluable (${periodoEstado})${frase ? ` · ${frase}` : ''}`
  if (ctx.pausado) frase = `Cliente en pausa según el CRM${frase ? ` · ${frase}` : ''}`
  const colorBase = semaforo === 'error' ? 4000 : semaforo === 'rojo' ? 3000 : semaforo === 'amarillo' ? 2000 : semaforo === 'verde' ? 1000 : 0
  const prioridad = colorBase + (motivos[0] ? PESO[motivos[0].tipo] * 10 : 0) + Math.min(9, motivos.length)

  const serie: Analisis['serie'] = []
  for (let i = 20; i >= 0; i--) { const d = sumarDias(hoy, -i); serie.push({ d, g: g(d), m: m(d), h: esHabil(d), x: malo(d) }) }

  return {
    cpl: { ayer: cplAyer, d7: cpl7, d7prev: cpl7p, historico: cplHist, nivel, variacion7: cpl7 != null && cpl7p != null ? cpl7 / cpl7p - 1 : null },
    gasto: { hoy: g(hoy), ayer: g(ayer), d7: r7.g, d7prev: r7p.g, promedioDiario },
    mensajes: { hoy: m(hoy), ayer: m(ayer), d7: r7.m, d7prev: r7p.m },
    corriendo: { dias: diasCorriendo, desdeVentana, frenadaHace, sinGastoEnVentana, sinAnunciosActivos },
    tendencia,
    pago,
    saldo: { restante, dias: diasSaldo, fuente },
    semaforo, motivos, notas, frase, prioridad, serie, aGrabar, aumento,
  }
}

export const DIAS_VENTANA = VENTANA_DIAS
