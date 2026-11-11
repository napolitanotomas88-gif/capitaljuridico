// ── Controles de cumplimiento del cliente (pedido de Tomás, 11/11/2026). Puro, sin red ni base ──────────────────────────
// Para los clientes con garantía: cada día a las 10:00 (Argentina) se revisa lo que el contrato le pide al
// cliente y cada falta queda como incumplimiento, con un aviso LISTO PARA PEGAR. Nada se le manda al cliente: una persona lo
// pega y marca «Enviado» en /clientes/para-enviar (pieza j01). La configuración de cada cliente vive en Neon
// (cj_controles_cliente), nunca en el repo.
//   1. Meta (día anterior): anuncios en pausa o sin entrega, error de pago de la cuenta y gasto por debajo del presupuesto.
//   2. Entregas: guiones enviados sin revisión del cliente en N días hábiles; guiones listos para grabar sin crudos nuevos
//      en M días corridos.
//   3. Capturas: un día con campaña activa sin archivos nuevos en la carpeta «Capturas» dentro de las 24 h siguientes.
//   4. Resumen semanal (lunes): incumplimientos, días con campaña, gasto vs. presupuesto, capturas y lo que es manual.
// Las cláusulas de cada control se configuran por cliente (por defecto: Meta → 7.3; entregas y capturas → 5).
import { esHabil as esHabilAR } from '@/lib/anuncios/feriados'
import { sumarDias } from '@/lib/anuncios/formato'

export type Ymd = string
export type TipoIncumplimiento = 'meta_pago' | 'meta_pausada' | 'meta_gasto_bajo' | 'guiones_sin_revision' | 'crudos_sin_subir' | 'capturas_faltantes'
export const TIPOS_INCUMPLIMIENTO: readonly TipoIncumplimiento[] = ['meta_pago', 'meta_pausada', 'meta_gasto_bajo', 'guiones_sin_revision', 'crudos_sin_subir', 'capturas_faltantes']

export const NOMBRE_TIPO: Record<TipoIncumplimiento, string> = {
  meta_pago: 'Error de pago en Meta', meta_pausada: 'Campaña en pausa o sin entrega', meta_gasto_bajo: 'Gasto por debajo del presupuesto',
  guiones_sin_revision: 'Guiones sin revisar', crudos_sin_subir: 'Sin crudos nuevos', capturas_faltantes: 'Faltan las capturas del día',
}

export interface Plazos {
  /** Días hábiles para revisar los guiones enviados. */
  revisionHabiles: number
  /** Días corridos para subir crudos desde que los guiones quedaron listos para grabar. */
  crudosCorridos: number
  /** Horas para dejar las capturas de un día (contadas desde el fin de ese día). */
  capturasHoras: number
  /** Días corridos que se le dan al cliente para corregir (va en el aviso). */
  correccionCorridos: number
}
export interface Clausulas { meta: string; guiones: string; crudos: string; capturas: string }

export const PLAZOS_POR_DEFECTO: Plazos = { revisionHabiles: 2, crudosCorridos: 5, capturasHoras: 24, correccionCorridos: 3 }
export const CLAUSULAS_POR_DEFECTO: Clausulas = { meta: '7.3', guiones: '5', crudos: '5', capturas: '5' }

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
  /** Desde qué día se controla (nada anterior genera incumplimientos). */
  desde: Ymd
  plazos: Plazos
  clausulas: Clausulas
}

export const esIdCrm = (x: unknown): x is string => typeof x === 'string' && /^[A-Z]\d{1,6}$/.test(x.trim().toUpperCase())
export const esCuentaMeta = (x: unknown): x is string => typeof x === 'string' && /^(act_)?\d{5,25}$/.test(x.trim())
export const esIdDrive = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(x.trim())
const esYmd = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T12:00:00Z`))
const entero = (x: unknown, d: number, min: number, max: number) => { const n = Number(x); return Number.isInteger(n) && n >= min && n <= max ? n : d }
const clausula = (x: unknown, d: string) => (typeof x === 'string' && /^[\w.\- ]{1,20}$/.test(x.trim()) ? x.trim() : d)

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
  return {
    ok: true,
    config: {
      idCrm, cliente, activo: o.activo !== false, cuentaMeta, presupuestoDiarioUsd: Math.round(presupuesto * 100) / 100,
      carpetaCliente, carpetaCapturas, desde,
      plazos: {
        revisionHabiles: entero(p.revisionHabiles, PLAZOS_POR_DEFECTO.revisionHabiles, 1, 30),
        crudosCorridos: entero(p.crudosCorridos, PLAZOS_POR_DEFECTO.crudosCorridos, 1, 60),
        capturasHoras: entero(p.capturasHoras, PLAZOS_POR_DEFECTO.capturasHoras, 1, 168),
        correccionCorridos: entero(p.correccionCorridos, PLAZOS_POR_DEFECTO.correccionCorridos, 1, 30),
      },
      clausulas: {
        meta: clausula(c.meta, CLAUSULAS_POR_DEFECTO.meta), guiones: clausula(c.guiones, CLAUSULAS_POR_DEFECTO.guiones),
        crudos: clausula(c.crudos, CLAUSULAS_POR_DEFECTO.crudos), capturas: clausula(c.capturas, CLAUSULAS_POR_DEFECTO.capturas),
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
/** El n-ésimo día hábil después de `desde`. */
export function sumarHabiles(desde: Ymd, n: number, esHabil: (d: Ymd) => boolean = esHabilAR): Ymd {
  let d = desde, k = 0
  while (k < n) { d = sumarDias(d, 1); if (esHabil(d)) k++ }
  return d
}

// ── Incumplimientos ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Incumplimiento {
  idCrm: string
  cliente: string
  tipo: TipoIncumplimiento
  /** Día del hecho (o del vencimiento del plazo). */
  fecha: Ymd
  /** Idempotencia dentro del cliente y el tipo (el día, la tanda…). */
  ref: string
  clausula: string
  /** Qué faltó, en palabras para el cliente (va en el aviso). */
  falta: string
  /** Detalle interno para el equipo (va en la alerta, no en el aviso). */
  lineas: string[]
}
export const claveIncumplimiento = (i: Pick<Incumplimiento, 'idCrm' | 'tipo' | 'ref'>) => `${i.idCrm}:${i.tipo}:${i.ref}`.slice(0, 200)

const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

/** Control 1 (Meta, el día anterior). Uno solo por día: error de pago > pausa/sin entrega > gasto bajo. */
export function evaluarMeta(p: {
  config: ConfigControles; dia: Ymd; cuenta: CuentaControl | null; gasto: number | null; usdPor: number | null; erroresPago: readonly number[]
}): { incumplimiento: Incumplimiento | null; avisos: string[]; gastoUsd: number | null } {
  const { config: c, dia, cuenta } = p
  const avisos: string[] = []
  if (!c.cuentaMeta || dia < c.desde) return { incumplimiento: null, avisos, gastoUsd: null }
  if (!cuenta) return { incumplimiento: null, avisos: ['Meta no devolvió la cuenta publicitaria: el control del día no se pudo hacer.'], gastoUsd: null }
  const gastoUsd = p.gasto == null ? null : cuenta.moneda === 'USD' ? p.gasto : p.usdPor ? p.gasto / p.usdPor : null
  const base = { idCrm: c.idCrm, cliente: c.cliente, fecha: dia, ref: dia, clausula: c.clausulas.meta }
  const gastoTxt = p.gasto == null ? 'sin dato' : cuenta.moneda === 'USD' ? usd(p.gasto) : `${cuenta.moneda} ${Math.round(p.gasto).toLocaleString('es-AR')}${gastoUsd != null ? ` (≈ ${usd(gastoUsd)})` : ''}`
  if (p.erroresPago.includes(cuenta.estado) || !cuenta.medioPago) {
    const motivo = p.erroresPago.includes(cuenta.estado) ? cuenta.textoEstado : 'sin medio de pago cargado'
    return {
      gastoUsd, avisos,
      incumplimiento: { ...base, tipo: 'meta_pago', falta: 'la cuenta publicitaria de Meta quedó con un problema de pago y los anuncios no pudieron circular con normalidad; hace falta regularizar el medio de pago', lineas: [`Cuenta: ${motivo}`, `Gasto del ${dm(dia)}: ${gastoTxt}`] },
    }
  }
  if (cuenta.entrega === 'sin_activos' || p.gasto === 0) {
    return {
      gastoUsd, avisos,
      incumplimiento: { ...base, tipo: 'meta_pausada', falta: 'la campaña de Meta no tuvo entrega (anuncios en pausa o sin circular)', lineas: [cuenta.entrega === 'sin_activos' ? 'Ningún anuncio activo en la cuenta' : 'Anuncios activos pero sin gasto', `Gasto del ${dm(dia)}: ${gastoTxt}`] },
    }
  }
  if (p.gasto == null) { avisos.push(`Meta no devolvió el gasto del ${dm(dia)}: el control de presupuesto no se pudo hacer.`); return { incumplimiento: null, avisos, gastoUsd } }
  if (gastoUsd == null) { avisos.push(`No hay cotización de ${cuenta.moneda} a USD: el control de presupuesto del ${dm(dia)} no se pudo hacer.`); return { incumplimiento: null, avisos, gastoUsd } }
  if (gastoUsd < c.presupuestoDiarioUsd) {
    return {
      gastoUsd, avisos,
      incumplimiento: { ...base, tipo: 'meta_gasto_bajo', falta: `la inversión en Meta fue de ${usd(gastoUsd)}, por debajo de los ${usd(c.presupuestoDiarioUsd)} diarios acordados`, lineas: [`Gasto del ${dm(dia)}: ${gastoTxt}`, `Presupuesto: ${usd(c.presupuestoDiarioUsd)} por día`] },
    }
  }
  return { incumplimiento: null, avisos, gastoUsd }
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

/** Control 2 (entregas). Solo tandas «enviada» (con notas o corrigiendo ya hubo revisión; cerrada = fuera del bot). Grabar
 *  cuenta también como revisión (el OK del cliente puede ser grabar directamente). */
export function evaluarEntregas(p: { config: ConfigControles; hoy: Ymd; tandas: readonly TandaControl[]; crudos: readonly { creado: string }[]; esHabil?: (d: Ymd) => boolean }): Incumplimiento[] {
  const { config: c, hoy } = p
  const out: Incumplimiento[] = []
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
        falta: `los guiones que te enviamos el ${dm(dEnvio)} no tuvieron revisión dentro de los ${c.plazos.revisionHabiles} días hábiles acordados`,
        lineas: [`Tanda ${t.tanda} enviada el ${dm(dEnvio)}`, `Plazo de revisión: hasta el ${dm(limiteRev)} (${c.plazos.revisionHabiles} días hábiles)`, 'Sin notas del cliente ni crudos nuevos desde el envío'],
      })
    }
    const limiteCrudos = sumarDias(dEnvio, c.plazos.crudosCorridos)
    if (!grabo && hoy > limiteCrudos) {
      out.push({
        idCrm: c.idCrm, cliente: c.cliente, tipo: 'crudos_sin_subir', fecha: limiteCrudos, ref: `t${t.id}`, clausula: c.clausulas.crudos,
        falta: `pasaron ${c.plazos.crudosCorridos} días corridos desde que los guiones quedaron listos para grabar (${dm(dEnvio)}) y no recibimos videos nuevos en la carpeta Crudos`,
        lineas: [`Tanda ${t.tanda} lista para grabar desde el ${dm(dEnvio)}`, `Plazo: hasta el ${dm(limiteCrudos)} (${c.plazos.crudosCorridos} días corridos)`, 'Sin crudos nuevos en Drive desde el envío'],
      })
    }
  }
  return out
}

/** Días con campaña activa = gasto > 0 ese día en Meta. */
export const diasActivos = (gastos: Record<Ymd, number>): Ymd[] => Object.entries(gastos).filter(([, g]) => g > 0).map(([d]) => d).sort()

/** ¿Hay capturas de ese día? Cuenta cualquier archivo creado desde las 00:00 del día hasta el fin del plazo (24 h después
 *  del fin del día, por defecto). */
export function hayCapturas(dia: Ymd, archivos: readonly { creado: string }[], horas: number): boolean {
  const desde = inicioDiaAR(dia)
  const hasta = desde + (24 + horas) * 3_600_000
  return archivos.some((a) => { const t = Date.parse(a.creado); return t >= desde && t < hasta })
}

/** Control 3 (capturas). Revisa los días con campaña activa cuyo plazo ya venció (ventana corta: se repite sin duplicar). */
export function evaluarCapturas(p: { config: ConfigControles; ahora: number; dias: readonly Ymd[]; archivos: readonly { creado: string }[] }): Incumplimiento[] {
  const { config: c } = p
  const out: Incumplimiento[] = []
  for (const dia of p.dias) {
    if (dia < c.desde) continue
    const vence = inicioDiaAR(dia) + (24 + c.plazos.capturasHoras) * 3_600_000
    if (p.ahora < vence || hayCapturas(dia, p.archivos, c.plazos.capturasHoras)) continue
    out.push({
      idCrm: c.idCrm, cliente: c.cliente, tipo: 'capturas_faltantes', fecha: dia, ref: dia, clausula: c.clausulas.capturas,
      falta: `no recibimos en la carpeta Capturas del Drive las capturas de los potenciales clientes del ${dm(dia)}`,
      lineas: [`Día con campaña activa: ${dm(dia)}`, `Plazo: ${c.plazos.capturasHoras} h después del fin del día`, 'Sin archivos nuevos en «Capturas»'],
    })
  }
  return out
}

// ── Textos ───────────────────────────────────────────────────────────────────────────────────────────────────────
const primerNombre = (s: string) => s.trim().split(/\s+/)[0] ?? s

/** El aviso al cliente, LISTO PARA PEGAR: formal, con voseo y corto. `hoy` = el día en que se arma (para el plazo). */
export function textoAviso(i: Incumplimiento, config: Pick<ConfigControles, 'cliente' | 'plazos'>, hoy: Ymd): string {
  const n = config.plazos.correccionCorridos
  return [
    `Hola, ${primerNombre(config.cliente)}. Te escribimos por el seguimiento de los compromisos del programa.`,
    `El ${dm(i.fecha)} ${i.falta}, según la cláusula ${i.clausula} del contrato.`,
    `Tenés ${n} días corridos para corregirlo (hasta el ${dm(sumarDias(hoy, n))}). Si ya lo resolviste o necesitás ayuda, avisanos por acá.`,
  ].join('\n')
}

export interface ResumenSemana {
  config: ConfigControles
  desde: Ymd
  hasta: Ymd
  incumplimientos: { tipo: TipoIncumplimiento; fecha: Ymd; estado: string }[]
  /** null = no se pudo leer Meta. */
  gastos: Record<Ymd, number> | null
  gastoUsd: number | null
  /** Días con campaña activa que tuvieron capturas. null = no se pudo leer Drive. */
  conCapturas: number | null
}

/** Las viñetas del resumen de los lunes (hasta 6, el formato de las alertas). */
export function lineasResumen(r: ResumenSemana): string[] {
  const dias = (Math.round((Date.parse(`${r.hasta}T12:00:00Z`) - Date.parse(`${r.desde}T12:00:00Z`)) / 86_400_000) || 0) + 1
  const activos = r.gastos ? diasActivos(r.gastos).length : null
  const porTipo = new Map<TipoIncumplimiento, number>()
  for (const i of r.incumplimientos) porTipo.set(i.tipo, (porTipo.get(i.tipo) ?? 0) + 1)
  const pendientes = r.incumplimientos.filter((i) => i.estado === 'para_enviar').length
  const detalle = [...porTipo].map(([t, n]) => `${NOMBRE_TIPO[t]} ×${n}`).join(' · ')
  const presupuesto = r.config.presupuestoDiarioUsd * dias
  return [
    `Incumplimientos: ${r.incumplimientos.length}${detalle ? ` (${detalle})` : ''}${pendientes ? ` · ${pendientes} aviso(s) sin marcar «Enviado»` : ''}`,
    `Días con campaña activa: ${activos == null ? 'sin dato de Meta' : `${activos} de ${dias}`}`,
    `Gasto: ${r.gastoUsd == null ? 'sin dato' : usd(r.gastoUsd)} de ${usd(presupuesto)} (${usd(r.config.presupuestoDiarioUsd)} × ${dias} días)`,
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
