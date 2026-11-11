// ── Controles de cumplimiento del cliente (pedido de Tomás, 11/11/2026; ajustado al contrato con garantía v4). Puro ─────────
// Para los clientes con garantía: cada día a las 10:00 (Argentina) se revisa lo que el contrato le pide al cliente. Cada
// hallazgo tiene un MODO:
//   · 'aviso'     → incumplimiento automático: fila en la base + aviso LISTO PARA PEGAR en /clientes/para-enviar (pieza j01)
//                   + alerta en 🛠️. Solo dos: error de pago / falta de fondos (5.b y 7.3 a) y, al cerrar cada Período
//                   Mensual de 30 días, gasto del período por debajo del presupuesto (4.b y 7.3 b).
//   · 'verificar' → posible incumplimiento: fila «a verificar» + alerta en 🛠️ a Gero M. El aviso al cliente se genera SOLO si
//                   alguien toca «Es incumplimiento» en /clientes/controles. Capturas (5.g), revisión de guiones (5.d) y
//                   crudos (5.e): el cliente puede haber cumplido por un canal que el sistema no ve.
//   · 'interna'   → solo alerta interna, nunca es incumplimiento del cliente: gasto diario bajo, campaña en pausa o sin
//                   entrega por otra causa (pausada por el equipo, revisión de Meta, sin anuncios todavía).
// Nada se le manda al cliente: una persona pega el aviso y marca «Enviado». La configuración vive en Neon
// (cj_controles_cliente), nunca en el repo. Subsanación: 3 días corridos (7.3).
import { esHabil as esHabilAR } from '@/lib/anuncios/feriados'
import { sumarDias } from '@/lib/anuncios/formato'

export type Ymd = string
export type TipoIncumplimiento = 'meta_pago' | 'periodo_gasto' | 'guiones_sin_revision' | 'crudos_sin_subir' | 'capturas_faltantes'
export type TipoInterno = 'meta_pausada' | 'meta_gasto_bajo'
export type TipoHallazgo = TipoIncumplimiento | TipoInterno
export type Modo = 'aviso' | 'verificar' | 'interna'

export const NOMBRE_TIPO: Record<TipoHallazgo, string> = {
  meta_pago: 'Pausa por error de pago o falta de fondos', periodo_gasto: 'Presupuesto del período no invertido',
  guiones_sin_revision: 'Guiones sin revisar', crudos_sin_subir: 'Sin crudos nuevos', capturas_faltantes: 'Faltan las capturas del día',
  meta_pausada: 'Campaña en pausa o sin entrega (no es del cliente)', meta_gasto_bajo: 'Gasto diario por debajo del presupuesto',
}
export const MODO_TIPO: Record<TipoHallazgo, Modo> = {
  meta_pago: 'aviso', periodo_gasto: 'aviso',
  guiones_sin_revision: 'verificar', crudos_sin_subir: 'verificar', capturas_faltantes: 'verificar',
  meta_pausada: 'interna', meta_gasto_bajo: 'interna',
}

export interface Plazos {
  /** Días hábiles para revisar los guiones enviados (5.d). */
  revisionHabiles: number
  /** Días corridos para subir crudos desde la aprobación de los guiones (5.e). */
  crudosCorridos: number
  /** Horas para mandar las capturas de un día, contadas desde el fin de ese día (5.g). */
  capturasHoras: number
  /** Días corridos para subsanar (7.3, va en el aviso). */
  correccionCorridos: number
  /** Días de cada Período Mensual (6.2). */
  periodoDias: number
}
export interface Clausulas { pago: string; gasto: string; guiones: string; crudos: string; capturas: string }

export const PLAZOS_POR_DEFECTO: Plazos = { revisionHabiles: 2, crudosCorridos: 5, capturasHoras: 24, correccionCorridos: 3, periodoDias: 30 }
export const CLAUSULAS_POR_DEFECTO: Clausulas = { pago: '5.b y 7.3 a)', gasto: '4.b y 7.3 b)', guiones: '5.d', crudos: '5.e', capturas: '5.g' }

export interface ConfigControles {
  idCrm: string
  /** Nombre para el saludo del aviso y las alertas («Ana»). */
  cliente: string
  activo: boolean
  /** Cuenta publicitaria (act_…). null = no se controla Meta. */
  cuentaMeta: string | null
  presupuestoDiarioUsd: number
  /** Carpeta del cliente en Drive (si falta, se toma la vinculada en Grabación: cj_grab_carpetas tipo 'cliente'). */
  carpetaCliente: string | null
  /** Carpeta «Capturas» (si falta, se crea adentro de la del cliente y se guarda). */
  carpetaCapturas: string | null
  /** Fecha de Inicio del contrato: desde acá se controla y arrancan los Períodos Mensuales. */
  desde: Ymd
  plazos: Plazos
  clausulas: Clausulas
}

export const esIdCrm = (x: unknown): x is string => typeof x === 'string' && /^[A-Z]\d{1,6}$/.test(x.trim().toUpperCase())
export const esCuentaMeta = (x: unknown): x is string => typeof x === 'string' && /^(act_)?\d{5,25}$/.test(x.trim())
export const esIdDrive = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(x.trim())
const esYmd = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T12:00:00Z`))
const entero = (x: unknown, d: number, min: number, max: number) => { const n = Number(x); return Number.isInteger(n) && n >= min && n <= max ? n : d }
const clausula = (x: unknown, d: string) => (typeof x === 'string' && /^[\w.()\- ]{1,30}$/.test(x.trim()) ? x.trim() : d)

/** Valida y completa una configuración (la del POST o la de la base). Devuelve el motivo si no sirve. */
export function normalizarConfig(x: unknown, hoy: Ymd): { ok: true; config: ConfigControles } | { ok: false; motivo: string } {
  const o = (x ?? {}) as Record<string, unknown>
  const idCrm = String(o.idCrm ?? o.id_crm ?? '').trim().toUpperCase()
  if (!esIdCrm(idCrm)) return { ok: false, motivo: 'idCrm inválido (formato A123)' }
  const cliente = String(o.cliente ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!cliente) return { ok: false, motivo: 'falta el nombre del cliente' }
  const cuentaRaw = o.cuentaMeta ?? o.cuenta_meta ?? null
  if (cuentaRaw != null && cuentaRaw !== '' && !esCuentaMeta(cuentaRaw)) return { ok: false, motivo: 'cuentaMeta inválida (act_ y números)' }
  const cuentaMeta = cuentaRaw ? `act_${String(cuentaRaw).trim().replace(/^act_/, '')}` : null
  const presupuesto = Number(o.presupuestoDiarioUsd ?? o.presupuesto_diario_usd ?? 12)
  if (!Number.isFinite(presupuesto) || presupuesto <= 0 || presupuesto > 10_000) return { ok: false, motivo: 'presupuestoDiarioUsd inválido' }
  const carpeta = (k: string, k2: string) => { const v = o[k] ?? o[k2]; return v == null || v === '' ? null : esIdDrive(v) ? String(v).trim() : undefined }
  const carpetaCliente = carpeta('carpetaCliente', 'carpeta_cliente')
  const carpetaCapturas = carpeta('carpetaCapturas', 'carpeta_capturas')
  if (carpetaCliente === undefined || carpetaCapturas === undefined) return { ok: false, motivo: 'id de carpeta de Drive inválido' }
  const desdeRaw = o.desde instanceof Date ? o.desde.toISOString().slice(0, 10) : o.desde
  const desde = esYmd(desdeRaw) ? desdeRaw : hoy
  const p = (o.plazos ?? {}) as Record<string, unknown>
  const c = (o.clausulas ?? {}) as Record<string, unknown>
  const d = PLAZOS_POR_DEFECTO, k = CLAUSULAS_POR_DEFECTO
  return {
    ok: true,
    config: {
      idCrm, cliente, activo: o.activo !== false, cuentaMeta, presupuestoDiarioUsd: Math.round(presupuesto * 100) / 100,
      carpetaCliente, carpetaCapturas, desde,
      plazos: {
        revisionHabiles: entero(p.revisionHabiles, d.revisionHabiles, 1, 30), crudosCorridos: entero(p.crudosCorridos, d.crudosCorridos, 1, 60),
        capturasHoras: entero(p.capturasHoras, d.capturasHoras, 1, 168), correccionCorridos: entero(p.correccionCorridos, d.correccionCorridos, 1, 30),
        periodoDias: entero(p.periodoDias, d.periodoDias, 7, 62),
      },
      clausulas: {
        pago: clausula(c.pago, k.pago), gasto: clausula(c.gasto, k.gasto), guiones: clausula(c.guiones, k.guiones),
        crudos: clausula(c.crudos, k.crudos), capturas: clausula(c.capturas, k.capturas),
      },
    },
  }
}

// ── Fechas (Argentina) ───────────────────────────────────────────────────────────────────────────────────────────
const TZ = 'America/Argentina/Buenos_Aires'
export const ymdAR = (d: Date | string | number): Ymd => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })
export const dm = (ymd: Ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
/** Instante de las 00:00 de Argentina (UTC−3, sin horario de verano) de un día. */
export const inicioDiaAR = (ymd: Ymd): number => Date.parse(`${ymd}T03:00:00Z`)
const diasEntre = (a: Ymd, b: Ymd) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
/** El n-ésimo día hábil después de `desde`. */
export function sumarHabiles(desde: Ymd, n: number, esHabil: (d: Ymd) => boolean = esHabilAR): Ymd {
  let d = desde, k = 0
  while (k < n) { d = sumarDias(d, 1); if (esHabil(d)) k++ }
  return d
}

/** Período Mensual (6.2) que contiene `dia`: número (desde 1), inicio y fin. null si es anterior a la Fecha de Inicio. */
export function periodoDe(config: Pick<ConfigControles, 'desde' | 'plazos'>, dia: Ymd): { numero: number; inicio: Ymd; fin: Ymd } | null {
  if (dia < config.desde) return null
  const n = config.plazos.periodoDias
  const k = Math.floor(diasEntre(config.desde, dia) / n)
  const inicio = sumarDias(config.desde, k * n)
  return { numero: k + 1, inicio, fin: sumarDias(inicio, n - 1) }
}

// ── Hallazgos ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Hallazgo {
  idCrm: string
  cliente: string
  tipo: TipoHallazgo
  /** Día del hecho (o del vencimiento del plazo). */
  fecha: Ymd
  /** Idempotencia dentro del cliente y el tipo (el día, la tanda, el período…). */
  ref: string
  clausula: string
  /** Qué faltó, en palabras para el cliente (va en el aviso). Vacío en las internas. */
  falta: string
  /** Detalle interno para el equipo (va en la alerta, no en el aviso). */
  lineas: string[]
}
/** Compatibilidad de nombres: un incumplimiento es un hallazgo de tipo no interno. */
export type Incumplimiento = Hallazgo
export const modoDe = (h: Pick<Hallazgo, 'tipo'>): Modo => MODO_TIPO[h.tipo]
export const claveIncumplimiento = (i: Pick<Hallazgo, 'idCrm' | 'tipo' | 'ref'>) => `${i.idCrm}:${i.tipo}:${i.ref}`.slice(0, 200)

export const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface CuentaControl {
  /** account_status de Meta. */
  estado: number
  motivoBaja: number
  /** 'sin_activos' = ningún anuncio activo ahora. */
  entrega: 'activa' | 'sin_activos' | null
  /** Hay medio de pago cargado (funding_source_details). */
  medioPago: boolean
  moneda: string
  /** Texto legible del estado (textoEstadoCuenta del tablero). */
  textoEstado: string
}

const pasarUsd = (monto: number, moneda: string, usdPor: number | null) => (moneda === 'USD' ? monto : usdPor ? monto / usdPor : null)

/** Control 1 (Meta, el día anterior). Uno solo por día: error de pago (aviso) > pausa/sin entrega (interna) > gasto bajo
 *  (interna). Solo el error de pago o la falta de fondos es incumplimiento del cliente (7.3 a). */
export function evaluarMeta(p: {
  config: ConfigControles; dia: Ymd; cuenta: CuentaControl | null; gasto: number | null; usdPor: number | null; erroresPago: readonly number[]
}): { hallazgo: Hallazgo | null; avisos: string[]; gastoUsd: number | null } {
  const { config: c, dia, cuenta } = p
  const avisos: string[] = []
  if (!c.cuentaMeta || dia < c.desde) return { hallazgo: null, avisos, gastoUsd: null }
  if (!cuenta) return { hallazgo: null, avisos: ['Meta no devolvió la cuenta publicitaria: el control del día no se pudo hacer.'], gastoUsd: null }
  const gastoUsd = p.gasto == null ? null : pasarUsd(p.gasto, cuenta.moneda, p.usdPor)
  const base = { idCrm: c.idCrm, cliente: c.cliente, fecha: dia, ref: dia }
  const gastoTxt = p.gasto == null ? 'sin dato' : cuenta.moneda === 'USD' ? usd(p.gasto) : `${cuenta.moneda} ${Math.round(p.gasto).toLocaleString('es-AR')}${gastoUsd != null ? ` (≈ ${usd(gastoUsd)})` : ''}`
  if (p.erroresPago.includes(cuenta.estado) || !cuenta.medioPago) {
    const motivo = p.erroresPago.includes(cuenta.estado) ? cuenta.textoEstado : 'sin medio de pago cargado'
    return {
      gastoUsd, avisos,
      hallazgo: { ...base, tipo: 'meta_pago', clausula: c.clausulas.pago, falta: 'las campañas de Meta quedaron en pausa por un error de pago o por falta de fondos en el medio de pago; hace falta regularizarlo', lineas: [`Cuenta: ${motivo}`, `Gasto del ${dm(dia)}: ${gastoTxt}`] },
    }
  }
  if (cuenta.entrega === 'sin_activos' || p.gasto === 0) {
    return {
      gastoUsd, avisos,
      hallazgo: { ...base, tipo: 'meta_pausada', clausula: '', falta: '', lineas: [cuenta.entrega === 'sin_activos' ? 'Ningún anuncio activo en la cuenta' : 'Anuncios activos pero sin gasto', `Gasto del ${dm(dia)}: ${gastoTxt}`, 'Sin error de pago: no es incumplimiento del cliente. Revisar si la pausamos nosotros, si Meta está revisando o si faltan anuncios.'] },
    }
  }
  if (p.gasto == null) { avisos.push(`Meta no devolvió el gasto del ${dm(dia)}: el control de presupuesto no se pudo hacer.`); return { hallazgo: null, avisos, gastoUsd } }
  if (gastoUsd == null) { avisos.push(`No hay cotización de ${cuenta.moneda} a USD: el control de presupuesto del ${dm(dia)} no se pudo hacer.`); return { hallazgo: null, avisos, gastoUsd } }
  if (gastoUsd < c.presupuestoDiarioUsd) {
    return {
      gastoUsd, avisos,
      hallazgo: { ...base, tipo: 'meta_gasto_bajo', clausula: '', falta: '', lineas: [`Gasto del ${dm(dia)}: ${gastoTxt}`, `Presupuesto: ${usd(c.presupuestoDiarioUsd)} por día`, 'Alerta interna: el incumplimiento (7.3 b) se mide sobre el gasto del Período Mensual.'] },
    }
  }
  return { hallazgo: null, avisos, gastoUsd }
}

/** Gasto esperado de un tramo de período: presupuesto × días. En el primer período los días anteriores al primer gasto no
 *  cuentan (producción inicial, 6.2 bis). null si en el primer período todavía no hubo gasto. */
export function esperadoPeriodo(config: ConfigControles, periodo: { numero: number; inicio: Ymd }, hasta: Ymd, gastos: Record<Ymd, number>): { desde: Ymd; dias: number; esperado: number } | null {
  let desde = periodo.inicio
  if (periodo.numero === 1) {
    const primero = Object.keys(gastos).filter((d) => d >= periodo.inicio && d <= hasta && gastos[d] > 0).sort()[0]
    if (!primero) return null
    desde = primero
  }
  const dias = diasEntre(desde, hasta) + 1
  return { desde, dias, esperado: Math.round(config.presupuestoDiarioUsd * dias * 100) / 100 }
}

export const sumaEntre = (gastos: Record<Ymd, number>, desde: Ymd, hasta: Ymd) => Object.entries(gastos).filter(([d]) => d >= desde && d <= hasta).reduce((a, [, g]) => a + g, 0)

/** Control de gasto del Período Mensual (4.b y 7.3 b): al cerrar el período, gasto en USD < presupuesto × días. */
export function evaluarPeriodo(p: { config: ConfigControles; periodo: { numero: number; inicio: Ymd; fin: Ymd }; gastos: Record<Ymd, number>; moneda: string; usdPor: number | null }): { hallazgo: Hallazgo | null; avisos: string[] } {
  const { config: c, periodo } = p
  const esp = esperadoPeriodo(c, periodo, periodo.fin, p.gastos)
  if (!esp) return { hallazgo: null, avisos: [`Período ${periodo.numero} (${dm(periodo.inicio)} al ${dm(periodo.fin)}) cerró sin gasto en Meta: revisar si la campaña llegó a lanzarse (6.2 bis).`] }
  const totalUsd = pasarUsd(sumaEntre(p.gastos, esp.desde, periodo.fin), p.moneda, p.usdPor)
  if (totalUsd == null) return { hallazgo: null, avisos: [`No hay cotización de ${p.moneda} a USD: el gasto del período ${periodo.numero} no se pudo controlar.`] }
  if (totalUsd + 0.005 >= esp.esperado) return { hallazgo: null, avisos: [] }
  return {
    avisos: [],
    hallazgo: {
      idCrm: c.idCrm, cliente: c.cliente, tipo: 'periodo_gasto', fecha: periodo.fin, ref: `p${periodo.numero}`, clausula: c.clausulas.gasto,
      falta: `cerró el período mensual del ${dm(periodo.inicio)} al ${dm(periodo.fin)} con una inversión en Meta de ${usd(totalUsd)}, por debajo de los ${usd(esp.esperado)} acordados (${usd(c.presupuestoDiarioUsd)} por día)`,
      lineas: [`Período ${periodo.numero}: ${dm(periodo.inicio)} al ${dm(periodo.fin)}`, `Gasto: ${usd(totalUsd)} de ${usd(esp.esperado)} (${esp.dias} días desde el ${dm(esp.desde)})`],
    },
  }
}

export interface TandaControl {
  id: number
  tanda: number
  estado: string
  /** Cuándo se le mandaron los guiones al cliente (entrega manual, «Enviado» del d02 o WhatsApp viejo). */
  envio: string | null
  /** Notas del cliente (cuándo). */
  notas: { cuando: string }[]
}

/** Control 2 (entregas, a verificar). Solo tandas «enviada» (con notas o corrigiendo ya hubo revisión; cerrada = fuera del
 *  bot). Grabar cuenta también como revisión. Los crudos se cuentan desde la aprobación (5.e): como el OK puede llegar por
 *  WhatsApp sin quedar registrado, se toma la fecha más tardía posible (el fin del plazo de revisión). */
export function evaluarEntregas(p: { config: ConfigControles; hoy: Ymd; tandas: readonly TandaControl[]; crudos: readonly { creado: string }[]; esHabil?: (d: Ymd) => boolean }): Hallazgo[] {
  const { config: c, hoy } = p
  const out: Hallazgo[] = []
  for (const t of p.tandas) {
    if (t.estado !== 'enviada' || !t.envio || Number.isNaN(Date.parse(t.envio))) continue
    const envioMs = Date.parse(t.envio)
    const dEnvio = ymdAR(envioMs)
    if (dEnvio < c.desde) continue
    const grabo = p.crudos.some((x) => Date.parse(x.creado) > envioMs)
    const reviso = grabo || t.notas.some((n) => Date.parse(n.cuando) > envioMs)
    const limiteRev = sumarHabiles(dEnvio, c.plazos.revisionHabiles, p.esHabil)
    if (!reviso && hoy > limiteRev) {
      out.push({
        idCrm: c.idCrm, cliente: c.cliente, tipo: 'guiones_sin_revision', fecha: limiteRev, ref: `t${t.id}`, clausula: c.clausulas.guiones,
        falta: `no recibimos tus observaciones ni tu aprobación de los guiones que te enviamos el ${dm(dEnvio)}, dentro de los ${c.plazos.revisionHabiles} días hábiles acordados`,
        lineas: [`Tanda ${t.tanda} enviada el ${dm(dEnvio)}`, `Plazo de revisión: hasta el ${dm(limiteRev)} (${c.plazos.revisionHabiles} días hábiles)`, 'Sin notas del cliente ni crudos nuevos desde el envío. ¿Dio el OK por WhatsApp?'],
      })
    }
    const limiteCrudos = sumarDias(limiteRev, c.plazos.crudosCorridos)
    if (!grabo && hoy > limiteCrudos) {
      out.push({
        idCrm: c.idCrm, cliente: c.cliente, tipo: 'crudos_sin_subir', fecha: limiteCrudos, ref: `t${t.id}`, clausula: c.clausulas.crudos,
        falta: `pasaron ${c.plazos.crudosCorridos} días corridos desde la aprobación de los guiones y no recibimos los videos en la carpeta Crudos de tu Drive`,
        lineas: [`Tanda ${t.tanda} enviada el ${dm(dEnvio)} (aprobación a más tardar el ${dm(limiteRev)})`, `Plazo de crudos: hasta el ${dm(limiteCrudos)} (${c.plazos.crudosCorridos} días corridos)`, 'Sin crudos nuevos en Drive desde el envío'],
      })
    }
  }
  return out
}

/** Días con campaña activa = gasto > 0 ese día en Meta. */
export const diasActivos = (gastos: Record<Ymd, number>): Ymd[] => Object.entries(gastos).filter(([, g]) => g > 0).map(([d]) => d).sort()

/** ¿Hay capturas de ese día? Cuenta cualquier archivo creado desde las 00:00 del día hasta el fin del plazo. */
export function hayCapturas(dia: Ymd, archivos: readonly { creado: string }[], horas: number): boolean {
  const desde = inicioDiaAR(dia)
  const hasta = desde + (24 + horas) * 3_600_000
  return archivos.some((a) => { const t = Date.parse(a.creado); return t >= desde && t < hasta })
}

/** Control 3 (capturas, a verificar: un día con gasto puede no tener conversaciones). Revisa los días con campaña activa
 *  cuyo plazo ya venció (ventana corta: se repite sin duplicar). */
export function evaluarCapturas(p: { config: ConfigControles; ahora: number; dias: readonly Ymd[]; archivos: readonly { creado: string }[] }): Hallazgo[] {
  const { config: c } = p
  const out: Hallazgo[] = []
  for (const dia of p.dias) {
    if (dia < c.desde) continue
    const vence = inicioDiaAR(dia) + (24 + c.plazos.capturasHoras) * 3_600_000
    if (p.ahora < vence || hayCapturas(dia, p.archivos, c.plazos.capturasHoras)) continue
    out.push({
      idCrm: c.idCrm, cliente: c.cliente, tipo: 'capturas_faltantes', fecha: dia, ref: dia, clausula: c.clausulas.capturas,
      falta: `no recibimos las capturas de las conversaciones del ${dm(dia)} originadas en los anuncios, dentro de las ${c.plazos.capturasHoras} horas acordadas`,
      lineas: [`Día con campaña activa: ${dm(dia)}`, 'Sin archivos nuevos en «Capturas». ¿Hubo conversaciones ese día? ¿Las mandó por WhatsApp?', 'Si corresponde, tocá «Es incumplimiento» en el Despacho para generar el aviso.'],
    })
  }
  return out
}

// ── Textos ───────────────────────────────────────────────────────────────────────────────────────────────────────
const primerNombre = (s: string) => s.trim().split(/\s+/)[0] ?? s

/** El aviso al cliente, LISTO PARA PEGAR: formal, con voseo y corto. `hoy` = el día en que se arma (para el plazo). */
export function textoAviso(i: Pick<Hallazgo, 'fecha' | 'falta' | 'clausula'>, config: Pick<ConfigControles, 'cliente' | 'plazos'>, hoy: Ymd): string {
  const n = config.plazos.correccionCorridos
  const cl = / y /.test(i.clausula) ? `las cláusulas ${i.clausula}` : `la cláusula ${i.clausula}`
  return [
    `Hola, ${primerNombre(config.cliente)}. Te escribimos por el seguimiento de los compromisos del programa.`,
    `El ${dm(i.fecha)} ${i.falta}, según ${cl} del contrato.`,
    `Tenés ${n} días corridos para subsanarlo (hasta el ${dm(sumarDias(hoy, n))}). Si ya lo resolviste o necesitás ayuda, avisanos por acá.`,
  ].join('\n')
}

export interface ResumenSemana {
  config: ConfigControles
  desde: Ymd
  hasta: Ymd
  incumplimientos: { tipo: TipoHallazgo; fecha: Ymd; estado: string }[]
  /** Gastos por día (moneda de la cuenta) de la semana. null = no se pudo leer Meta. */
  gastos: Record<Ymd, number> | null
  /** Período Mensual en curso al cierre de la semana: acumulado en USD contra lo esperado a esa fecha. */
  periodo: { numero: number; inicio: Ymd; fin: Ymd; hasta: Ymd; gastoUsd: number | null; esperado: number | null } | null
  /** Días con campaña activa que tuvieron capturas. null = no se pudo leer Drive. */
  conCapturas: number | null
}

/** Las viñetas del resumen de los lunes (hasta 6, el formato de las alertas). */
export function lineasResumen(r: ResumenSemana): string[] {
  const dias = diasEntre(r.desde, r.hasta) + 1
  const activos = r.gastos ? diasActivos(r.gastos).length : null
  const porTipo = new Map<TipoHallazgo, number>()
  for (const i of r.incumplimientos) porTipo.set(i.tipo, (porTipo.get(i.tipo) ?? 0) + 1)
  const aVerificar = r.incumplimientos.filter((i) => i.estado === 'a_verificar').length
  const pendientes = r.incumplimientos.filter((i) => i.estado === 'para_enviar').length
  const detalle = [...porTipo].map(([t, n]) => `${NOMBRE_TIPO[t]} ×${n}`).join(' · ')
  const per = r.periodo
  const lineaPeriodo = !per ? 'Período mensual: sin dato'
    : `Período ${per.numero} (${dm(per.inicio)} al ${dm(per.fin)}), al ${dm(per.hasta)}: ${per.gastoUsd == null ? 'gasto sin dato' : usd(per.gastoUsd)} de ${per.esperado == null ? 'sin gasto todavía (producción inicial)' : `${usd(per.esperado)} esperados`}`
  return [
    `Incumplimientos y a verificar: ${r.incumplimientos.length}${detalle ? ` (${detalle})` : ''}${aVerificar ? ` · ${aVerificar} a verificar` : ''}${pendientes ? ` · ${pendientes} aviso(s) sin marcar «Enviado»` : ''}`,
    `Días con campaña activa: ${activos == null ? 'sin dato de Meta' : `${activos} de ${dias}`}`,
    lineaPeriodo,
    `Capturas: ${r.conCapturas == null ? 'sin dato de Drive' : activos == null ? `${r.conCapturas} día(s) con capturas` : `${r.conCapturas} de ${activos} días con campaña`}`,
    'Potenciales clientes: carga manual (sin fuente automática)',
    'Responder en 12 h: chequeo manual en el grupo del cliente',
  ]
}

/** Lunes anterior → domingo anterior de un día (la semana cerrada que se resume). */
export function semanaAnterior(hoy: Ymd): { desde: Ymd; hasta: Ymd } {
  const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay()   // 0 = domingo
  const lunesEsta = sumarDias(hoy, -((dow + 6) % 7))
  return { desde: sumarDias(lunesEsta, -7), hasta: sumarDias(lunesEsta, -1) }
}

/** CONTROLES_CLIENTES=encendido prende los controles. Sin la variable (o con otro valor), apagados. */
export const controlesEncendidos = (env: Record<string, string | undefined> = process.env): boolean => env.CONTROLES_CLIENTES?.trim().toLowerCase() === 'encendido'
