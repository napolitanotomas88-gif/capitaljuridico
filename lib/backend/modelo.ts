// ── Backend: modelo de datos de las tres listas de trabajo (sin dependencias: se prueba con node:test) ─────────────
// Dos pestañas NUEVAS en el CRM de clientes (SHEET_ID_CLIENTES):
//   · "Cobros"            una fila por pago acordado (cuota, saldo, renovación).
//   · "Acciones backend"  libro de toques: una fila por botón apretado (quién y cuándo). Nunca se borra: deshacer = marcar "Anulada".
// Las columnas se leen por POSICIÓN fija (las crea este mismo módulo, no las edita nadie a mano en otro orden).
import { esYmdValido, type Ymd } from '../clientes/fechas'

export const PESTANA_COBROS = 'Cobros'
export const PESTANA_ACCIONES = 'Acciones backend'

// ── Listas y botones ──────────────────────────────────────────────────────────────────────────────
export const LISTAS = ['renovaciones', 'cuotas', 'proyeccion'] as const
export type Lista = (typeof LISTAS)[number]
export const ETIQUETA_LISTA: Record<Lista, string> = {
  renovaciones: 'Renovaciones pendientes',
  cuotas: 'Cuotas a cobrar',
  proyeccion: 'Llamadas de proyección',
}

export const ACCIONES: Record<Lista, readonly string[]> = {
  renovaciones: ['Propuesta enviada', 'Renovó', 'No renovó', 'Pausa', 'Extender 1 mes'],
  cuotas: ['Recordatorio enviado', 'Cobrado'],
  proyeccion: ['Link enviado', 'Agendada', 'Hecha'],
}

// Texto del botón (el valor guardado en la planilla es el de ACCIONES)
export const ETIQUETA_BOTON: Record<string, string> = { 'Extender 1 mes': 'Extender 1 mes más' }

export const MOTIVOS_NO_RENOVO = ['Resultados', 'Plata', 'Tiempo para grabar', 'Pausa', 'Se fue con otro', 'Otro'] as const
export const MEDIOS_COBRO = ['Transferencia', 'Wise', 'Mercado Pago', 'Tarjeta', 'Efectivo', 'Cripto', 'Otro'] as const
export const PLANES_MESES = [1, 2, 3, 4, 6, 8, 12] as const
export const CONCEPTOS = ['Inicial', 'Renovación', 'Extra'] as const

// ── Cobros ────────────────────────────────────────────────────────────────────────────────────────
export const ENCABEZADOS_COBROS = [
  'ID cliente', 'Período', 'Concepto', 'Monto USD', 'Vence', 'Pagado', 'Monto pagado', 'Fecha de pago', 'Medio', 'Nota', 'Cargado por',
] as const
export type EstadoPago = 'Sí' | 'No' | 'Parcial'

export interface Cobro {
  fila: number              // fila en la planilla (1 = encabezados)
  clave: string             // identifica el cobro entre lecturas: cliente|período|concepto|vence|monto
  idCliente: string
  periodo: number | null
  concepto: string
  monto: number             // USD acordados
  vence: Ymd | null
  pagado: EstadoPago
  montoPagado: number
  fechaPago: Ymd | null
  medio: string
  nota: string
  cargadoPor: string
  saldo: number             // lo que falta cobrar (monto − pagado, nunca negativo)
}

export const claveCobro = (c: { idCliente: string; periodo: number | null; concepto: string; vence: Ymd | null; monto: number }): string =>
  [c.idCliente, c.periodo ?? '', c.concepto, c.vence ?? '', c.monto].join('|')

// ── Acciones backend ──────────────────────────────────────────────────────────────────────────────
export const ENCABEZADOS_ACCIONES = [
  'ID acción', 'Fecha y hora', 'ID cliente', 'Lista', 'Acción', 'Dato', 'Referencia', 'Quién', 'Anulada', 'Estado previo',
] as const

export interface AccionBackend {
  fila: number
  id: string
  cuando: string            // 'AAAA-MM-DD HH:mm' hora argentina
  idCliente: string
  lista: Lista | ''
  accion: string
  dato: string
  referencia: string        // renovaciones/proyección: fin del período (ciclo) · cuotas: clave del cobro
  quien: string
  anulada: boolean
  previo: string            // JSON con lo que había antes (para deshacer un cobro); vacío si no aplica
}

export const esLista = (v: unknown): v is Lista => typeof v === 'string' && (LISTAS as readonly string[]).includes(v)

// ── Lectura de celdas ─────────────────────────────────────────────────────────────────────────────
const txt = (c: unknown): string => (c === null || c === undefined ? '' : String(c).trim())
function num(c: unknown): number {
  if (typeof c === 'number') return Number.isFinite(c) ? c : 0
  const s = txt(c).replace(/[^\d,.-]/g, '')
  if (!s) return 0
  // 1.234,56 (es-AR) o 1234.56
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
  return Number.isFinite(n) ? n : 0
}
function ymd(c: unknown): Ymd | null {
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    const d = new Date(Math.round((c - 25569) * 86400000))
    return d.toISOString().slice(0, 10)
  }
  const s = txt(c)
  if (esYmdValido(s)) return s
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)   // dd/mm/aaaa (como se ve en la planilla)
  if (m) {
    const r = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return esYmdValido(r) ? r : null
  }
  return null
}
const normPagado = (c: unknown): EstadoPago => {
  const s = txt(c).toLowerCase().replace('í', 'i')
  return s === 'si' ? 'Sí' : s === 'parcial' ? 'Parcial' : 'No'
}

export function leerCobro(celdas: unknown[], fila: number): Cobro | null {
  const idCliente = txt(celdas[0]).toUpperCase()
  if (!idCliente) return null
  const periodoN = txt(celdas[1]) === '' ? null : num(celdas[1])
  const monto = num(celdas[3])
  const vence = ymd(celdas[4])
  const pagado = normPagado(celdas[5])
  const montoPagado = pagado === 'Sí' && txt(celdas[6]) === '' ? monto : num(celdas[6])
  const base = { idCliente, periodo: periodoN, concepto: txt(celdas[2]), monto, vence }
  return {
    fila, clave: claveCobro(base), ...base, pagado, montoPagado,
    fechaPago: ymd(celdas[7]), medio: txt(celdas[8]), nota: txt(celdas[9]), cargadoPor: txt(celdas[10]),
    saldo: pagado === 'Sí' ? 0 : Math.max(0, Math.round((monto - montoPagado) * 100) / 100),
  }
}

export function leerAccion(celdas: unknown[], fila: number): AccionBackend | null {
  const id = txt(celdas[0])
  if (!id) return null
  const lista = txt(celdas[3])
  return {
    fila, id, cuando: txt(celdas[1]), idCliente: txt(celdas[2]).toUpperCase(), lista: esLista(lista) ? lista : '',
    accion: txt(celdas[4]), dato: txt(celdas[5]), referencia: txt(celdas[6]), quien: txt(celdas[7]),
    anulada: /^(si|sí|x|1|true)\b/i.test(txt(celdas[8])), previo: txt(celdas[9]),
  }
}

// ── Validación de un toque (lo que llega del navegador es dato no confiable) ─────────────────────────
export interface EntradaToque {
  lista: unknown; accion: unknown; idCliente: unknown; referencia: unknown
  // datos según la acción (todos opcionales acá: se exigen abajo)
  plan?: unknown; monto?: unknown; pagadoHoy?: unknown; venceSaldo?: unknown; motivo?: unknown; medio?: unknown; fecha?: unknown; nota?: unknown
}
export interface ToqueValido {
  lista: Lista; accion: string; idCliente: string; referencia: string
  plan: number | null; monto: number | null; pagadoHoy: number; venceSaldo: Ymd | null; motivo: string; medio: string; fecha: Ymd | null; nota: string
}

const ID_CLIENTE = /^[AC]\d{3,4}$/
export const MAX_REFERENCIA = 120
const limpiar = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
// Una celda que empieza con = + - @ se interpretaría como fórmula en la planilla: se neutraliza
export const celdaSegura = (s: string): string => (/^[=+\-@]/.test(s) ? `'${s}` : s)

function montoUsd(v: unknown): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = num(s)
  return n > 0 && n <= 1_000_000 ? Math.round(n * 100) / 100 : null
}

export type Validacion = { ok: true; toque: ToqueValido } | { ok: false; error: string }

export function validarToque(e: EntradaToque, hoy: Ymd): Validacion {
  if (!esLista(e.lista)) return { ok: false, error: 'Lista inválida.' }
  const lista = e.lista
  const accion = limpiar(e.accion, 40)
  if (!ACCIONES[lista].includes(accion)) return { ok: false, error: 'Acción inválida para esta lista.' }
  const idCliente = limpiar(e.idCliente, 8).toUpperCase()
  if (!ID_CLIENTE.test(idCliente)) return { ok: false, error: 'ID de cliente inválido.' }
  const referencia = limpiar(e.referencia, MAX_REFERENCIA)
  if (!referencia) return { ok: false, error: 'Falta la referencia del ítem.' }

  const t: ToqueValido = {
    lista, accion, idCliente, referencia, plan: null, monto: null, pagadoHoy: 0, venceSaldo: null,
    motivo: '', medio: '', fecha: null, nota: limpiar(e.nota, 200),
  }

  if (lista === 'renovaciones' && accion === 'Renovó') {
    const plan = Number(e.plan)
    if (!(PLANES_MESES as readonly number[]).includes(plan)) return { ok: false, error: 'Elegí el plan (cantidad de meses).' }
    t.plan = plan
    t.monto = montoUsd(e.monto)
    if (t.monto === null) return { ok: false, error: 'Poné el monto total en USD (mayor a 0).' }
    const pagado = String(e.pagadoHoy ?? '').trim() === '' ? 0 : montoUsd(e.pagadoHoy)
    if (pagado === null) return { ok: false, error: 'El monto pagado hoy no es válido.' }
    if (pagado > t.monto) return { ok: false, error: 'Lo pagado hoy no puede superar el monto total.' }
    t.pagadoHoy = pagado
    if (t.monto - pagado > 0) {
      const v = String(e.venceSaldo ?? '').trim()
      if (!esYmdValido(v)) return { ok: false, error: 'Queda saldo: poné cuándo vence.' }
      t.venceSaldo = v
    }
  }
  if (lista === 'renovaciones' && accion === 'No renovó') {
    const motivo = limpiar(e.motivo, 40)
    if (!(MOTIVOS_NO_RENOVO as readonly string[]).includes(motivo)) return { ok: false, error: 'Elegí el motivo.' }
    t.motivo = motivo
    if (motivo === 'Otro' && !t.nota) return { ok: false, error: 'Con motivo "Otro" escribí una nota.' }
  }
  if (lista === 'cuotas' && accion === 'Cobrado') {
    t.monto = montoUsd(e.monto)
    if (t.monto === null) return { ok: false, error: 'Poné el monto cobrado en USD (mayor a 0).' }
    const medio = limpiar(e.medio, 30)
    if (!(MEDIOS_COBRO as readonly string[]).includes(medio)) return { ok: false, error: 'Elegí el medio de pago.' }
    t.medio = medio
  }
  if (lista === 'renovaciones' && accion === 'Extender 1 mes' && !esYmdValido(referencia)) return { ok: false, error: 'Falta la fecha de fin del período. Actualizá la pantalla.' }
  if (lista === 'proyeccion' && accion === 'Agendada') {
    const f = String(e.fecha ?? '').trim()
    if (!esYmdValido(f)) return { ok: false, error: 'Poné la fecha de la llamada.' }
    if (f < hoy) return { ok: false, error: 'La fecha de la llamada no puede ser anterior a hoy.' }
    t.fecha = f
  }
  return { ok: true, toque: t }
}

/** Texto corto que queda en la columna "Dato" (legible en la planilla y en el historial de la tarjeta) */
export function datoDeToque(t: ToqueValido): string {
  const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
  const partes: string[] = []
  if (t.accion === 'Renovó') {
    partes.push(`${t.plan} ${t.plan === 1 ? 'mes' : 'meses'}`, usd(t.monto ?? 0))
    if (t.pagadoHoy > 0) partes.push(`pagó ${usd(t.pagadoHoy)}`)
    if (t.venceSaldo) partes.push(`saldo vence ${t.venceSaldo}`)
  } else if (t.accion === 'No renovó') partes.push(t.motivo)
  else if (t.accion === 'Cobrado') partes.push(usd(t.monto ?? 0), t.medio)
  else if (t.accion === 'Agendada' && t.fecha) partes.push(t.fecha)
  if (t.nota) partes.push(t.nota)
  return partes.join(' · ')
}
