// ── Créditos del programa de referidos: funciones PURAS (sin I/O, sin Date sueltos) ─────────
// Las reglas viven en reglasReferidos.ts; acá solo se aplican. Todo recibe `hoy` ('AAAA-MM-DD',
// hora argentina) para poder evaluar "como si fuera ayer" y para testear sin reloj.
//
// Cómo se calcula (resumen; el detalle y de dónde sale cada número está en docs/REGLAS-REFERIDOS.md):
//  · El programa arranca en reglas.vigenteDesde (1/10/2026): un referido presentado antes NO genera nada.
//  · ESCALERA POR CIERRES. Un cierre se LIBERA cuando entró el primer pago y pasaron `diasSinReembolso` días (14) sin reembolso:
//    fecha de liberación = primer pago + 14 días; hoy >= esa fecha → liberado. La escalera se mide con los cierres liberados y
//    vigentes del CICLO ACTUAL. El escalón alcanzado REEMPLAZA al anterior (1 = 1 mes · 2 = 2 meses + identidad de marca ·
//    3 = renovación gratis de 4 meses); del 4.º cierre en adelante +1 mes por cierre.
//  · ESCALERA POR INTENTOS. Un INTENTO es un referido que entra a la llamada y NO cierra (estado "No cerró"); un cierre NO es un
//    intento. Con la cantidad acumulada de intentos de quien refiere: 1 = página web · 2 = USD 300 · 3 = branding · 4 = USD 300 ·
//    5 = +1 mes de servicio · 6 en adelante = USD 150 por intento, sin tope (tentativo). Cada premio se gana en la fecha de la llamada
//    del intento (o la del pedido si falta). La web y el branding se ganan UNA sola vez por cliente.
//  · Cada crédito dura `vigenciaMeses` (12) desde que se gana; vigente hasta ese día inclusive.
//  · Sin tope de meses (8/10/2026): los meses de la escalera de cierres y el mes del intento 5 se suman sin límite. `topeMesesAcumulados` es null;
//    si algún día vuelve a fijarse un número, todo el cálculo lo respeta (el código sigue aceptándolo).
//  · Los USD (intentos 2, 4 y 6+) se llevan APARTE de los meses (no se convierten) y se canjean solo contra la renovación.
//  · El CICLO termina cuando se canjea contra una renovación (movimiento 'canje' en el libro): lo ganado hasta esa fecha ya se
//    consumió y se empieza de cero. El contador de intentos NO se reinicia (sigue de largo). Un canje de un extra (grabación, web,
//    branding) no corta el ciclo.
//  · Todo se canjea solo contra la renovación, nunca en efectivo.
import type { CierrePendiente, EntregableGanado, MovimientoCredito, PremioGanado, Referido, ResumenCredito } from './tipos'
import type { ReglasReferidos, PasoEscalera, PasoIntento } from './reglasReferidos'
import { REGLAS_REFERIDOS, PREMIOS_UNICOS } from './reglasReferidos'
import type { Ymd } from './fechas'
import { diasEntre, esYmdValido, exigirYmd, sumarDias, sumarMeses } from './fechas'
import { clavesTelefono, normTxt } from './texto'
import { esIdAfiliadoExterno } from './afiliadosExternos'
import { esCanjeSoloMeses } from './canjeMeses'
import type { ZonaGrabacion } from './zona'

const asistio = (estado: Referido['estado'], reglas: ReglasReferidos) => (reglas.estadosAsistio as string[]).includes(estado)

const esEnteroNoNegativo = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

const escaleraOrdenada = (reglas: ReglasReferidos): PasoEscalera[] => [...reglas.escalera].sort((a, b) => a.cierres - b.cierres)

/** Meses de la renovación gratis (los del escalón que la trae): 4 */
export const mesesRenovacionGratis = (reglas: ReglasReferidos = REGLAS_REFERIDOS): number =>
  reglas.escalera.find(p => p.renovacionGratis)?.mesesServicio ?? 0

/** Cantidad de cierres liberados con los que la escalera, por sí sola, llega al tope de meses; null si no hay tope (configuración actual) */
export function cierresParaElTope(reglas: ReglasReferidos = REGLAS_REFERIDOS): number | null {
  const escalera = escaleraOrdenada(reglas)
  const ultimo = escalera[escalera.length - 1]
  const tope = reglas.topeMesesAcumulados
  if (tope === null) return null
  for (const p of escalera) if (p.mesesServicio >= tope) return p.cierres
  return ultimo.cierres + Math.ceil((tope - ultimo.mesesServicio) / reglas.masAllaDeLaEscalera.mesesPorCierreExtra)
}

// ── Valorización (solo para reportes: el crédito se lleva en meses) ───────────────────────
export interface Valorizacion { pagoUnicoUSD: number; planDePagosUSD: number }

// 1 mes = valorMesUSD; la renovación gratis vale distinto según cómo se pague (USD 2.600 pago único, USD 3.800 plan de
// pagos): los meses por encima de la renovación se valorizan a valorMesUSD. Sin renovación gratis las dos coinciden.
export function valorizarMeses(meses: number, renovacionGratis: boolean, reglas: ReglasReferidos = REGLAS_REFERIDOS): Valorizacion {
  if (typeof meses !== 'number' || !Number.isFinite(meses) || meses < 0) throw new RangeError(`meses inválidos: se esperaba un número >= 0 y llegó ${JSON.stringify(meses)}`)
  const ren = mesesRenovacionGratis(reglas)
  if (!renovacionGratis || meses < ren) return { pagoUnicoUSD: meses * reglas.valorMesUSD, planDePagosUSD: meses * reglas.valorMesUSD }
  const extra = (meses - ren) * reglas.valorMesUSD
  return { pagoUnicoUSD: reglas.renovacionGratis.valorPagoUnicoUSD + extra, planDePagosUSD: reglas.renovacionGratis.valorPlanDePagosUSD + extra }
}

// ── Escalera por cierres ──────────────────────────────────────────────────────────────────
export interface NivelEscalera {
  cierres: number                     // cierres liberados que se evaluaron
  nivel: number                       // escalón alcanzado (0 = ninguno … escalera.length)
  cierresAportantes: number           // los que suman (el resto quedó sobre el tope)
  cierresSobreTope: number
  mesesServicio: number               // de la escalera, con el tope aplicado
  mesesSinTope: number                // de la escalera, sin tope (para combinar con el mes del intento 5)
  renovacionGratis: boolean
  mesesExtraSobreRenovacion: number
  topeAlcanzado: boolean              // la escalera sola llega al tope
  extras: string[]
  valorUSD: number                    // pago único
  valorPlanDePagosUSD: number
  proximoNivel: { cierresFaltantes: number; descripcion: string } | null
}

interface OpcionesNivel { reglas?: ReglasReferidos }

// Cantidad de cierres liberados → lo que se gana por la escalera. Lanza RangeError si `cierres` no es un
// entero >= 0 (NaN, negativo, decimal, texto): es un error de quien llama, no un dato de la planilla.
export function nivelPorCierres(cierres: number, op: OpcionesNivel = {}): NivelEscalera {
  if (!esEnteroNoNegativo(cierres)) throw new RangeError(`cierres inválidos: se esperaba un entero >= 0 y llegó ${JSON.stringify(cierres)}`)
  const reglas = op.reglas ?? REGLAS_REFERIDOS
  const escalera = escaleraOrdenada(reglas)
  const ultimo = escalera[escalera.length - 1]
  const { mesesPorCierreExtra } = reglas.masAllaDeLaEscalera
  const tope = reglas.topeMesesAcumulados

  if (cierres === 0) {
    return {
      cierres, nivel: 0, cierresAportantes: 0, cierresSobreTope: 0, mesesServicio: 0, mesesSinTope: 0, renovacionGratis: false,
      mesesExtraSobreRenovacion: 0, topeAlcanzado: false, extras: [], valorUSD: 0, valorPlanDePagosUSD: 0,
      proximoNivel: { cierresFaltantes: escalera[0].cierres, descripcion: escalera[0].etiqueta },
    }
  }

  // Escalón más alto que alcanza (el nivel REEMPLAZA al anterior)
  let idx = -1
  escalera.forEach((p, i) => { if (p.cierres <= cierres) idx = i })
  const paso = escalera[idx]

  const sinTope = cierres > ultimo.cierres ? ultimo.mesesServicio + (cierres - ultimo.cierres) * mesesPorCierreExtra : paso.mesesServicio
  const meses = tope === null ? sinTope : Math.min(tope, sinTope)
  const topeAlcanzado = tope !== null && sinTope >= tope
  const topeCierres = cierresParaElTope(reglas)
  const aportantes = topeCierres === null ? cierres : Math.min(cierres, topeCierres)
  const pasoRenovacion = escalera.find(p => p.renovacionGratis)
  const mesesExtra = paso.renovacionGratis && pasoRenovacion ? Math.max(0, meses - pasoRenovacion.mesesServicio) : 0

  // Qué falta para el próximo escalón
  let proximoNivel: NivelEscalera['proximoNivel'] = null
  const siguiente = escalera.find(p => p.cierres > cierres)
  if (siguiente) proximoNivel = { cierresFaltantes: siguiente.cierres - cierres, descripcion: siguiente.etiqueta }
  else if (!topeAlcanzado) proximoNivel = { cierresFaltantes: 1, descripcion: `+${mesesPorCierreExtra} mes de servicio` }

  const valor = valorizarMeses(meses, paso.renovacionGratis, reglas)
  return {
    cierres,
    nivel: idx + 1,
    cierresAportantes: aportantes,
    cierresSobreTope: cierres - aportantes,
    mesesServicio: meses,
    mesesSinTope: sinTope,
    renovacionGratis: paso.renovacionGratis,
    mesesExtraSobreRenovacion: mesesExtra,
    topeAlcanzado,
    extras: paso.extra ? [paso.extra] : [],
    valorUSD: valor.pagoUnicoUSD,
    valorPlanDePagosUSD: valor.planDePagosUSD,
    proximoNivel,
  }
}

// ── Escalera por intentos ─────────────────────────────────────────────────────────────────
const escaleraIntentosOrdenada = (reglas: ReglasReferidos): PasoIntento[] => [...reglas.intentos.escalera].sort((a, b) => a.intento - b.intento)

/** ¿El premio se gana una sola vez por cliente (página web, branding) y no se canjea contra la renovación? */
export const esPremioUnico = (premio: PasoIntento['premio']): boolean => PREMIOS_UNICOS.includes(premio)

/** Qué da el intento N.º `n` (1, 2, 3…): los de la escalera y, del siguiente al último, el crédito por intento adicional (sin tope) */
export function premioDelIntento(n: number, reglas: ReglasReferidos = REGLAS_REFERIDOS): PasoIntento {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`intento inválido: se esperaba un entero >= 1 y llegó ${JSON.stringify(n)}`)
  const escalera = escaleraIntentosOrdenada(reglas)
  const paso = escalera.find(p => p.intento === n)
  if (paso) return paso
  const { creditoUSD } = reglas.intentos.masAllaDeLaEscalera
  return { intento: n, premio: 'credito_usd', creditoUSD, mesesServicio: 0, etiqueta: `USD ${creditoUSD} de crédito por cada intento adicional, sin tope` }
}

/** Todos los premios de la escalera hasta el intento `total` inclusive, sin vigencia ni ciclo (para mostrar y para cuentas de referencia) */
export function premiosHastaElIntento(total: number, reglas: ReglasReferidos = REGLAS_REFERIDOS): PasoIntento[] {
  if (!esEnteroNoNegativo(total)) throw new RangeError(`intentos inválidos: se esperaba un entero >= 0 y llegó ${JSON.stringify(total)}`)
  return Array.from({ length: total }, (_, i) => premioDelIntento(i + 1, reglas))
}

// ── Créditos en USD: lectura del campo Extra del libro ────────────────────────────────────
// El libro de Créditos NO tiene columna de USD: un canje en USD se anota en el texto del campo Extra ("USD 300",
// "renovación gratis + USD 450", "u$s 1.200,50", "300 USD"). Se toma el PRIMER monto; si hay varios se avisa (varios = true).
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2}`
const RE_USD = new RegExp(String.raw`(?:(?<![a-z])(?:usd|us\$|u\$s)\s*(${NUM})(?![\d.,]*\d)|(?<![\d.,])(${NUM})\s*(?:usd|us\$|u\$s|d[oó]lares)(?![a-z]))`, 'gi')

export interface MontoUSDDeTexto { usd: number; varios: boolean }

function numeroDeMonto(t: string): number {
  // "1.200,50" (latino) · "1.200" (miles) · "300" · "150.5" (decimal con punto)
  if (/,/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, ''))
  return parseFloat(t)
}

/** "USD 300" → { usd: 300, varios: false }; sin monto → null. Con más de un monto toma el primero y marca varios. */
export function usdDeTexto(texto: unknown): MontoUSDDeTexto | null {
  if (typeof texto !== 'string' || !texto) return null
  const montos = [...texto.matchAll(RE_USD)].map(m => numeroDeMonto(m[1] ?? m[2])).filter(n => Number.isFinite(n) && n > 0)
  return montos.length ? { usd: montos[0], varios: montos.length > 1 } : null
}

// ── Tope común de meses ───────────────────────────────────────────────────────────────────
export interface MesesCombinados {
  meses: number                       // escalera de cierres + mes del intento 5, con el tope aplicado
  sinTope: number
  sobreTope: number                   // meses que no suman porque se llegó al tope
  topeAlcanzado: boolean
}

// Los meses de la escalera de cierres (sin tope) y los de la escalera de intentos (el del intento 5) se SUMAN dentro de un único tope.
export function combinarMeses(mesesEscalera: number, mesesIntentos: number, reglas: ReglasReferidos = REGLAS_REFERIDOS): MesesCombinados {
  if (!esEnteroNoNegativo(mesesEscalera) || !esEnteroNoNegativo(mesesIntentos))
    throw new RangeError(`meses inválidos: ${JSON.stringify([mesesEscalera, mesesIntentos])}`)
  const sinTope = mesesEscalera + mesesIntentos
  const tope = reglas.topeMesesAcumulados
  const meses = tope === null ? sinTope : Math.min(tope, sinTope)
  return { meses, sinTope, sobreTope: sinTope - meses, topeAlcanzado: tope !== null && sinTope >= tope }
}

// ── Liberación de un cierre ──────────────────────────────────────────────────────────────
export type MotivoLiberacion = 'liberado' | 'esperando_dias' | 'sin_primer_pago' | 'no_cerro' | 'reembolsado' | 'fecha_invalida'

export interface Liberacion {
  liberado: boolean
  fechaLiberacion: Ymd | null         // primer pago + diasSinReembolso (null si no hay primer pago válido)
  diasParaLiberar: number | null      // > 0 faltan; 0 o menos ya pasó
  motivo: MotivoLiberacion
}

// El crédito de un cierre se libera cuando entró el primer pago del referido y pasaron 14 días sin
// reembolso: con el pago el día D, el día D+13 todavía no, el día D+14 sí. Un reembolso lo anula
// siempre. La fecha de liberación de la planilla (fórmula) NO se usa: se recalcula acá.
export function liberarPorFecha(
  ref: Pick<Referido, 'estado' | 'fechaPrimerPago' | 'reembolso'>,
  hoy: Ymd,
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
): Liberacion {
  exigirYmd(hoy, 'hoy')
  if (ref.estado !== 'Cerró') return { liberado: false, fechaLiberacion: null, diasParaLiberar: null, motivo: 'no_cerro' }
  if (ref.reembolso) return { liberado: false, fechaLiberacion: null, diasParaLiberar: null, motivo: 'reembolsado' }
  if (ref.fechaPrimerPago === null || ref.fechaPrimerPago === undefined || ref.fechaPrimerPago === '')
    return { liberado: false, fechaLiberacion: null, diasParaLiberar: null, motivo: 'sin_primer_pago' }
  if (!esYmdValido(ref.fechaPrimerPago)) return { liberado: false, fechaLiberacion: null, diasParaLiberar: null, motivo: 'fecha_invalida' }
  const fechaLiberacion = sumarDias(ref.fechaPrimerPago, reglas.liberacion.diasSinReembolso)
  const diasParaLiberar = diasEntre(hoy, fechaLiberacion)
  return diasParaLiberar <= 0
    ? { liberado: true, fechaLiberacion, diasParaLiberar, motivo: 'liberado' }
    : { liberado: false, fechaLiberacion, diasParaLiberar, motivo: 'esperando_dias' }
}

// ── Vigencia ─────────────────────────────────────────────────────────────────────────────
// Un crédito vence `vigenciaMeses` después de su fecha de origen (liberación del cierre, o la fecha de la llamada del
// intento que dio el premio). Es vigente hasta ese día INCLUSIVE.
export const vencimientoDeCredito = (origen: Ymd, reglas: ReglasReferidos = REGLAS_REFERIDOS): Ymd =>
  sumarMeses(origen, reglas.vigenciaMeses)

export const creditoVigente = (vence: Ymd, hoy: Ymd): boolean => exigirYmd(hoy, 'hoy') <= exigirYmd(vence, 'vence')

// ── Inicio del programa ──────────────────────────────────────────────────────────────────
// Fecha en que se presentó el referido: la del pedido; si falta, la de la llamada y, si tampoco, la del primer pago.
// null = no hay ninguna fecha utilizable (en ese caso no se puede decir que sea anterior al programa).
export function fechaDePresentacion(r: Pick<Referido, 'fechaPedido' | 'fechaLlamada' | 'fechaPrimerPago'>): Ymd | null {
  for (const f of [r.fechaPedido, r.fechaLlamada, r.fechaPrimerPago]) if (f && esYmdValido(f)) return f
  return null
}

/** ¿Se presentó antes del inicio del programa (1/10/2026)? Entonces no genera crédito. Sin fecha utilizable: no. */
export function esAnteriorAlPrograma(r: Pick<Referido, 'fechaPedido' | 'fechaLlamada' | 'fechaPrimerPago'>, reglas: ReglasReferidos = REGLAS_REFERIDOS): boolean {
  const f = fechaDePresentacion(r)
  return f !== null && f < reglas.vigenteDesde
}

// ── Referido válido ──────────────────────────────────────────────────────────────────────
// "Un referido válido es un lead nuevo, de otro estudio, que asiste a la llamada."
export interface ContextoValidacion {
  estudioReferidor?: string
  esContactoConocido?: (r: Referido) => boolean   // ver indiceContactos
}

export function validarReferido(ref: Referido, ctx: ContextoValidacion = {}, reglas: ReglasReferidos = REGLAS_REFERIDOS): { valido: boolean; motivos: string[] } {
  const motivos: string[] = []
  if (reglas.referidoValido.debeAsistir && !asistio(ref.estado, reglas)) motivos.push('no asistió a la llamada')
  if (reglas.referidoValido.otroEstudio && ctx.estudioReferidor && ref.estudio && normTxt(ref.estudio) === normTxt(ctx.estudioReferidor)) motivos.push('es del mismo estudio que quien refiere')
  if (reglas.referidoValido.leadNuevo && ctx.esContactoConocido?.(ref)) motivos.push('ya era contacto o cliente (no es un lead nuevo)')
  return { valido: motivos.length === 0, motivos }
}

// Índice de contactos del CRM (teléfono y mail) para saber si un referido es un lead nuevo. Se
// excluye al cliente cuyo ID es el `idClienteNuevo` del propio referido: al cerrar se convierte en
// cliente y no por eso deja de haber sido un lead nuevo.
export function indiceContactos(clientes: { id: string; celular: string; mail: string }[]): (r: Referido) => boolean {
  const porTel = new Map<string, Set<string>>(), porMail = new Map<string, Set<string>>()
  const sumar = (m: Map<string, Set<string>>, k: string, id: string) => { if (k) m.set(k, (m.get(k) ?? new Set()).add(id)) }
  clientes.forEach((c, i) => {
    const id = c.id || `#${i}`   // una fila cargada sin ID también cuenta como contacto conocido
    for (const k of clavesTelefono(c.celular)) sumar(porTel, k, id)
    const mail = (c.mail ?? '').toString().trim().toLowerCase()
    if (mail.includes('@')) sumar(porMail, mail, id)
  })
  const hayOtro = (ids: Set<string> | undefined, idNuevo: string) => !!ids && [...ids].some(id => !idNuevo || id !== idNuevo)
  return r => clavesTelefono(r.telefono).some(k => hayOtro(porTel.get(k), r.idClienteNuevo))
    || hayOtro(porMail.get((r.mail ?? '').toString().trim().toLowerCase()), r.idClienteNuevo)
}

// ── Cálculo completo para un cliente ─────────────────────────────────────────────────────
export interface EntradaCreditos {
  idCliente: string                   // el que refiere
  referidos: Referido[]               // todos los referidos (se filtran por idReferidor)
  hoy: Ymd
  movimientos?: MovimientoCredito[]   // libro del cliente: ciclo, ajustes y canjes (incluidos los USD del campo Extra)
  zona?: ZonaGrabacion                // zona deducida del teléfono de quien refiere (zona.ts); por defecto 'sin_determinar'
  esValido?: (r: Referido) => boolean         // por defecto todos valen (ver validarReferido)
}

// Un canje de un EXTRA (grabación, página web, branding) es una entrega, no una renovación: no corta el ciclo
export const esCanjeDeExtra = (m: MovimientoCredito) => m.tipo === 'canje' && /^(grabacion|pagina web|branding)/.test(normTxt(m.extra))

type Vencimiento = { cierres: number; mesesIntentos: number; usd: number; entregables: number }

// Dado el historial de referidos (y el libro) devuelve nivel, intentos y sus premios, meses y USD ganados, ya con inicio del
// programa, liberación, vigencia, ciclo y tope aplicados.
export function calcularCreditos(entrada: EntradaCreditos, reglas: ReglasReferidos = REGLAS_REFERIDOS): ResumenCredito {
  if (!entrada || typeof entrada.idCliente !== 'string' || !entrada.idCliente.trim()) throw new TypeError('idCliente es obligatorio')
  if (esIdAfiliadoExterno(entrada.idCliente)) throw new TypeError('Los afiliados externos (X###) no tienen créditos de cliente')
  if (!Array.isArray(entrada.referidos)) throw new TypeError('referidos debe ser una lista')
  const hoy = exigirYmd(entrada.hoy, 'hoy')
  const zona = entrada.zona ?? 'sin_determinar'
  if (zona !== 'buenos_aires' && zona !== 'sin_determinar') throw new TypeError(`zona inválida: ${JSON.stringify(zona)}`)
  const advertencias: string[] = []

  // Ciclo: arranca en el último canje contra una renovación (el canje de un extra no lo corta)
  const movs = (entrada.movimientos ?? []).filter(m => m && m.idCliente === entrada.idCliente)
  const canjesRenovacion = movs.filter(m => m.tipo === 'canje' && !esCanjeDeExtra(m))
  for (const m of canjesRenovacion) if (!m.fecha) advertencias.push(`El canje ${m.id || `de la fila ${m.fila}`} no tiene fecha: no corta el ciclo.`)
  const cicloDesde = canjesRenovacion.reduce<Ymd | null>((mx, m) => (m.fecha && (mx === null || m.fecha > mx) ? m.fecha : mx), null)
  const enCiclo = (f: Ymd) => cicloDesde === null || f > cicloDesde
  // El canje automático aprobado el 29/10 consume sólo meses. Los USD conservan su propio ciclo hasta un canje manual completo.
  const cicloUsdDesde = canjesRenovacion.filter(m => !esCanjeSoloMeses(m)).reduce<Ymd | null>((mx, m) => (m.fecha && (mx === null || m.fecha > mx) ? m.fecha : mx), null)
  const enCicloUsd = (f: Ymd) => cicloUsdDesde === null || f > cicloUsdDesde

  let cierresLiberados = 0, cierresVencidos = 0, cierresReembolsados = 0, anterioresAlPrograma = 0
  const fechasIntentos: Ymd[] = []
  const pendientes: CierrePendiente[] = []
  const vencen = new Map<Ymd, Vencimiento>()
  const sumarVence = (fecha: Ymd, campo: keyof Vencimiento, cantidad = 1) => {
    const v = vencen.get(fecha) ?? { cierres: 0, mesesIntentos: 0, usd: 0, entregables: 0 }
    v[campo] += cantidad
    vencen.set(fecha, v)
  }

  for (const r of entrada.referidos) {
    if (!r || r.idReferidor !== entrada.idCliente) continue
    // Antes del inicio del programa no genera nada (ni cierre, ni intento)
    if (esAnteriorAlPrograma(r, reglas)) { anterioresAlPrograma++; continue }
    const valido = entrada.esValido ? entrada.esValido(r) : true
    // Causa más probable de un "no válido" en un cierre: el referido ya figura como cliente en el CRM (su teléfono o mail
    // coincide) y la fila de Referidos no tiene cargado el "ID cliente nuevo", así que parece un contacto que ya existía.
    if (!valido) {
      const pista = r.estado === 'Cerró' && !r.idClienteNuevo ? ' Si ya es cliente, cargá el "ID cliente nuevo" en la fila de Referidos.' : ''
      advertencias.push(`${r.id || `Fila ${r.fila}`}: no es un referido válido, no suma.${pista}`)
      continue
    }

    // Intento: entró a la llamada y no cerró. Se gana en la fecha de la llamada (o la del pedido si falta). "Asistió" todavía sin
    // resultado NO cuenta (puede cerrar), y un cierre tampoco.
    if (r.estado === reglas.intentos.estado) {
      const fecha = [r.fechaLlamada, r.fechaPedido].find((f): f is Ymd => !!f && esYmdValido(f))
      if (!fecha) advertencias.push(`${r.id || `Fila ${r.fila}`}: no cerró pero no tiene fecha de llamada ni de pedido, no se cuenta el intento.`)
      else fechasIntentos.push(fecha)
      continue
    }

    // Cierre → mes de servicio, cuando se libera
    if (r.estado !== 'Cerró') continue
    const lib = liberarPorFecha(r, hoy, reglas)
    if (lib.motivo === 'reembolsado') cierresReembolsados++
    else if (lib.motivo === 'fecha_invalida') advertencias.push(`${r.id || `Fila ${r.fila}`}: la fecha del primer pago es inválida, el cierre no se libera.`)
    else if (lib.motivo === 'esperando_dias' || lib.motivo === 'sin_primer_pago')
      pendientes.push({ idReferido: r.id, motivo: lib.motivo === 'sin_primer_pago' ? 'sin_primer_pago' : 'esperando_dias', fechaLiberacion: lib.fechaLiberacion, diasParaLiberar: lib.diasParaLiberar })
    else if (lib.motivo === 'liberado' && lib.fechaLiberacion) {
      if (!enCiclo(lib.fechaLiberacion)) continue   // ya se consumió en un canje anterior
      const vence = vencimientoDeCredito(lib.fechaLiberacion, reglas)
      if (!creditoVigente(vence, hoy)) cierresVencidos++
      else { cierresLiberados++; sumarVence(vence, 'cierres') }
    }
  }

  // Escalera por intentos. El contador sigue de largo (no se reinicia por ciclo): el N.º de intento es el de toda la vida del cliente.
  // Cada premio se gana en la fecha de su intento. USD y mes: solo cuentan los del ciclo actual (lo anterior se consumió en un canje) y
  // vigentes. La web y el branding (únicos por cliente) no se canjean: solo dependen de la vigencia.
  fechasIntentos.sort()
  const premiosIntentos: PremioGanado[] = []
  let paginaWeb: EntregableGanado | null = null, branding: EntregableGanado | null = null
  let usdGanado = 0, usdVencido = 0, usdDisponible = 0, mesesIntentos = 0
  fechasIntentos.forEach((fecha, i) => {
    const paso = premioDelIntento(i + 1, reglas)
    const vence = vencimientoDeCredito(fecha, reglas)
    const vigente = creditoVigente(vence, hoy)
    usdGanado += paso.creditoUSD
    if (esPremioUnico(paso.premio)) {
      const ya = paso.premio === 'pagina_web' ? paginaWeb : branding
      if (ya) return   // una sola vez por cliente (la escalera trae cada uno una sola vez; esto cubre una configuración que lo repita)
      const entregable: EntregableGanado = { fecha, vence, vigente }
      if (paso.premio === 'pagina_web') paginaWeb = entregable; else branding = entregable
      premiosIntentos.push({ intento: paso.intento, premio: paso.premio, fecha, vence, creditoUSD: 0, meses: 0, estado: vigente ? 'vigente' : 'vencido' })
      if (vigente) sumarVence(vence, 'entregables')
      return
    }
    const perteneceAlCiclo = paso.creditoUSD > 0 ? enCicloUsd(fecha) : enCiclo(fecha)
    const estado: PremioGanado['estado'] = !perteneceAlCiclo ? 'canjeado' : vigente ? 'vigente' : 'vencido'
    premiosIntentos.push({ intento: paso.intento, premio: paso.premio, fecha, vence, creditoUSD: paso.creditoUSD, meses: paso.mesesServicio, estado })
    if (estado === 'vencido') usdVencido += paso.creditoUSD
    if (estado === 'vigente') {
      usdDisponible += paso.creditoUSD
      mesesIntentos += paso.mesesServicio
      if (paso.creditoUSD > 0) sumarVence(vence, 'usd', paso.creditoUSD)
      if (paso.mesesServicio > 0) sumarVence(vence, 'mesesIntentos', paso.mesesServicio)
    }
  })

  // USD canjeados: se leen del texto del campo Extra de los canjes del libro (no hay columna de USD)
  let usdUsado = 0
  for (const m of movs) {
    if (m.tipo !== 'canje') continue
    const monto = usdDeTexto(m.extra)
    if (!monto) continue
    usdUsado += monto.usd
    if (monto.varios) advertencias.push(`El canje ${m.id || `de la fila ${m.fila}`} nombra más de un monto en USD en el campo Extra: se tomó el primero (USD ${monto.usd}).`)
  }

  const nivel = nivelPorCierres(cierresLiberados, { reglas })
  const comb = combinarMeses(nivel.mesesSinTope, mesesIntentos, reglas)

  // Ajustes manuales vigentes del ciclo actual (el libro es el único lugar donde se corrigen a mano)
  const ajusteMeses = movs.filter(m => m.tipo === 'ajuste' && m.fecha && enCiclo(m.fecha) && (!m.vence || creditoVigente(m.vence, hoy)))
    .reduce((s, m) => s + (Number.isFinite(m.meses) ? m.meses : 0), 0)

  // Control cruzado con el libro: lo ganado por cierres y por intentos (tipo 'ganado_llamada') allá debería coincidir con el cálculo
  const mesesLibro = (tipo: 'ganado_cierre' | 'ganado_llamada') => movs.filter(m => m.tipo === tipo && m.fecha && enCiclo(m.fecha) && (!m.vence || creditoVigente(m.vence, hoy)))
    .reduce((s, m) => s + (Number.isFinite(m.meses) ? m.meses : 0), 0)
  if (movs.some(m => m.tipo === 'ganado_cierre') && mesesLibro('ganado_cierre') !== nivel.mesesServicio)
    advertencias.push(`El libro de Créditos suma ${mesesLibro('ganado_cierre')} meses ganados por cierres y los referidos dan ${nivel.mesesServicio}: revisar.`)
  if (movs.some(m => m.tipo === 'ganado_llamada' && m.meses > 0) && mesesLibro('ganado_llamada') !== mesesIntentos)
    advertencias.push(`El libro de Créditos suma ${mesesLibro('ganado_llamada')} meses ganados por intentos y los referidos dan ${mesesIntentos}: revisar.`)

  const renovacionGratis = nivel.renovacionGratis
  const valor = valorizarMeses(comb.meses, renovacionGratis, reglas)
  const sig = premioDelIntento(fechasIntentos.length + 1, reglas)

  return {
    idCliente: entrada.idCliente,
    hoy,
    reglasVersion: reglas.version,
    cicloDesde,
    cicloUsdDesde,
    nivel: nivel.nivel,
    cierresLiberados,
    cierresPendientes: pendientes.sort((a, b) => (a.diasParaLiberar ?? 9999) - (b.diasParaLiberar ?? 9999)),
    cierresVencidos,
    cierresReembolsados,
    anterioresAlPrograma,
    intentos: fechasIntentos.length,
    premiosIntentos,
    paginaWeb,
    branding,
    proximoIntento: { intento: sig.intento, premio: sig.premio, etiqueta: sig.etiqueta, creditoUSD: sig.creditoUSD },
    mesesPorIntentos: mesesIntentos,
    mesesPorCierres: nivel.mesesSinTope,
    mesesSobreTope: comb.sobreTope,
    mesesGanados: comb.meses,
    topeMeses: reglas.topeMesesAcumulados,
    ajusteMeses,
    renovacionGratis,
    mesesExtraSobreRenovacion: renovacionGratis ? Math.max(0, comb.meses - mesesRenovacionGratis(reglas)) : 0,
    topeAlcanzado: comb.topeAlcanzado,
    extras: nivel.extras,
    usd: { ganado: usdGanado, usado: usdUsado, vencido: usdVencido, disponible: usdDisponible },
    zona,
    valorUSD: valor.pagoUnicoUSD,
    valorPlanDePagosUSD: valor.planDePagosUSD,
    proximoNivel: comb.topeAlcanzado ? null : nivel.proximoNivel,
    vencimientos: [...vencen.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, v]) => ({ fecha, ...v })),
    advertencias,
  }
}

// ── Vencimientos próximos ────────────────────────────────────────────────────────────────
// Créditos vigentes que vencen dentro de `dentroDeDias` (para avisarle al cliente antes de que se pierdan).
export function proximosVencimientos(resumen: ResumenCredito, dentroDeDias: number): (ResumenCredito['vencimientos'][number] & { dias: number })[] {
  if (!esEnteroNoNegativo(dentroDeDias)) throw new RangeError(`dentroDeDias inválido: ${JSON.stringify(dentroDeDias)}`)
  return resumen.vencimientos
    .map(v => ({ ...v, dias: diasEntre(resumen.hoy, v.fecha) }))
    .filter(v => v.dias >= 0 && v.dias <= dentroDeDias)
}

// ── Saldo canjeable ──────────────────────────────────────────────────────────────────────
export interface SaldoCanjeable {
  meses: number                       // escalera de cierres + mes del intento 5 (con el tope) + ajustes vigentes (nunca negativo)
  usd: number                         // créditos en USD vigentes del ciclo actual (aparte de los meses: no se convierten)
  renovacionGratis: boolean
  valorUSD: number                    // referencia para reportes (pago único): el crédito va en meses
  valorPlanDePagosUSD: number         // ídem, con la renovación gratis en plan de pagos
  extras: string[]
  soloContraRenovacion: boolean       // regla: no se canjea en efectivo
}

export function saldoCanjeable(resumen: ResumenCredito, reglas: ReglasReferidos = REGLAS_REFERIDOS): SaldoCanjeable {
  const meses = Math.max(0, resumen.mesesGanados + resumen.ajusteMeses)
  const valor = valorizarMeses(meses, resumen.renovacionGratis, reglas)
  return {
    meses,
    usd: resumen.usd.disponible,
    renovacionGratis: resumen.renovacionGratis,
    valorUSD: valor.pagoUnicoUSD,
    valorPlanDePagosUSD: valor.planDePagosUSD,
    extras: resumen.extras,
    soloContraRenovacion: reglas.canje.soloContraRenovacion,
  }
}

// ¿Se puede canjear en este contexto? Solo contra la renovación; nunca en efectivo.
export function puedeCanjear(contexto: 'renovacion' | 'efectivo', reglas: ReglasReferidos = REGLAS_REFERIDOS): boolean {
  if (contexto === 'renovacion') return true
  if (contexto === 'efectivo') return reglas.canje.enEfectivo
  throw new RangeError(`contexto de canje inválido: ${JSON.stringify(contexto)}`)
}

// Fila del libro que registraría un canje contra una renovación (DRY-RUN: devuelve el movimiento,
// no escribe nada). Canjea TODO el saldo (meses y USD) y cierra el ciclo: lo ganado hasta esa fecha queda consumido.
// Los USD van en el texto del campo Extra ("USD 300"), porque el libro no tiene columna de USD.
export function planCanje(
  resumen: ResumenCredito,
  datos: { fecha: Ymd; renovacionAplicada: string; cargadoPor: string },
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
): Omit<MovimientoCredito, 'id' | 'fila'> {
  exigirYmd(datos.fecha, 'fecha del canje')
  if (!datos.renovacionAplicada.trim()) throw new TypeError('El canje necesita la renovación a la que se aplica')
  const saldo = saldoCanjeable(resumen, reglas)
  if (saldo.meses <= 0 && saldo.usd <= 0) throw new RangeError('No hay meses ni USD para canjear')
  const extra = [saldo.renovacionGratis ? 'renovación gratis' : '', saldo.usd > 0 ? `USD ${saldo.usd}` : ''].filter(Boolean).join(' + ')
  return {
    fecha: datos.fecha, idCliente: resumen.idCliente, tipo: 'canje', idReferido: '', meses: saldo.meses > 0 ? -saldo.meses : 0,
    extra, vence: null,
    renovacionAplicada: datos.renovacionAplicada.trim(),
    nota: `Canje contra renovación (reglas ${resumen.reglasVersion})`, cargadoPor: datos.cargadoPor,
  }
}

// ── Todos los clientes con actividad de referidos ────────────────────────────────────────
// Un ResumenCredito por cada cliente que refirió a alguien o tiene movimientos en el libro.
export function calcularCreditosDeTodos(
  datos: {
    referidos: Referido[]; movimientos: MovimientoCredito[]; hoy: Ymd
    esValidoDe?: (idCliente: string) => ((r: Referido) => boolean) | undefined
    zonaDe?: (idCliente: string) => ZonaGrabacion | undefined
  },
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
): Map<string, ResumenCredito> {
  const ids = new Set<string>()
  // Los afiliados externos (X###) nunca generan créditos de cliente: se saltean aunque aparezcan en las filas (ver afiliadosExternos.ts)
  for (const r of datos.referidos) if (r.idReferidor && !esIdAfiliadoExterno(r.idReferidor)) ids.add(r.idReferidor)
  for (const m of datos.movimientos) if (m.idCliente && !esIdAfiliadoExterno(m.idCliente)) ids.add(m.idCliente)
  const out = new Map<string, ResumenCredito>()
  for (const id of ids) out.set(id, calcularCreditos({ idCliente: id, referidos: datos.referidos, movimientos: datos.movimientos, hoy: datos.hoy, esValido: datos.esValidoDe?.(id), zona: datos.zonaDe?.(id) }, reglas))
  return out
}
