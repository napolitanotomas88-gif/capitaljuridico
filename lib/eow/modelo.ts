// ── Reporte EOW (End of Week): modelo, validación y reglas puras (13/11/2026) ───────────────────────────────────────────
// Pedido de Tomás: la sección «EOW» del Despacho reemplaza el documento semanal de Gero M. Un reporte por semana (la fecha
// del reporte, AAAA-MM-DD) con:
//   · filas de clientes: nombre · comentario de una línea · color (rojo / amarillo / verde) · pausado (pill gris dentro de su
//     color). Una fila SIN color es un «recién lanzado para ubicar» (la agrega el sistema con la fecha de lanzamiento);
//   · tarjetas: listas simples de nombres o notas (Cliente pesadilla, Cancelaciones, Pausados, Testimonios pedidos,
//     Testimonios obtenidos, Servicio terminado, Observaciones). «Reclamos abiertos» NO va (lo viejo pasó a Observaciones).
// Sin imports de Next ni de la base: se prueba con node:test (scripts/test-eow.mjs).

export const COLORES = ['rojo', 'amarillo', 'verde'] as const
export type Color = (typeof COLORES)[number]
export const NOMBRE_COLOR: Record<Color, string> = { rojo: 'Rojo', amarillo: 'Amarillo', verde: 'Verde' }

export const TARJETAS = ['pesadilla', 'cancelaciones', 'pausados', 'testimoniosPedidos', 'testimoniosObtenidos', 'servicioTerminado', 'observaciones'] as const
export type Tarjeta = (typeof TARJETAS)[number]
export const NOMBRE_TARJETA: Record<Tarjeta, string> = {
  pesadilla: 'Cliente pesadilla',
  cancelaciones: 'Cancelaciones',
  pausados: 'Pausados',
  testimoniosPedidos: 'Testimonios pedidos',
  testimoniosObtenidos: 'Testimonios obtenidos',
  servicioTerminado: 'Servicio terminado',
  observaciones: 'Observaciones',
}

export type OrigenFila = 'manual' | 'sistema' | 'importado'

export interface FilaEow {
  /** Identificador estable dentro del reporte (no es el ID del CRM). */
  id: string
  cliente: string
  comentario: string
  /** null = recién lanzado, todavía sin ubicar */
  color: Color | null
  pausado: boolean
  /** ID del CRM (A001…), si se conoce */
  idCrm: string | null
  /** Fecha de lanzamiento de la campaña (la pone el sistema) */
  lanzado: string | null
  origen: OrigenFila
}

export type Tarjetas = Record<Tarjeta, string[]>

export interface DatosEow {
  filas: FilaEow[]
  tarjetas: Tarjetas
}

export interface ReporteEow extends DatosEow {
  semana: string
  version: number
  actualizado: string | null
  actualizadoPor: string | null
}

// ── Topes (el guardado viaja entero: que no crezca sin control) ──
export const TOPE_FILAS = 300
export const TOPE_ITEMS_TARJETA = 120
export const TOPE_CLIENTE = 120
export const TOPE_COMENTARIO = 600
export const TOPE_ITEM = 600

const FECHA = /^\d{4}-\d{2}-\d{2}$/
export const esFecha = (f: unknown): f is string =>
  typeof f === 'string' && FECHA.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f
export const esColor = (x: unknown): x is Color => typeof x === 'string' && (COLORES as readonly string[]).includes(x)
const ID_CRM = /^[A-Za-z]\d{1,6}$/
const ID_FILA = /^[A-Za-z0-9_-]{1,40}$/

/** Una línea: sin saltos ni caracteres de control, espacios juntos, recortada. */
export const unaLinea = (x: unknown, tope: number): string =>
  String(x ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, tope)

export const tarjetasVacias = (): Tarjetas => Object.fromEntries(TARJETAS.map((t) => [t, [] as string[]])) as Tarjetas
export const datosVacios = (): DatosEow => ({ filas: [], tarjetas: tarjetasVacias() })

let contador = 0
/** Id corto para una fila nueva (no tiene que ser global: es único dentro del reporte). */
export function nuevoIdFila(semilla: string = Date.now().toString(36)): string {
  contador = (contador + 1) % 1_000_000
  return `f${semilla}${contador.toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40)
}

export type Validacion = { ok: true; datos: DatosEow } | { ok: false; error: string }

/** Valida lo que manda la pantalla (o el importador). Normaliza textos a una línea y descarta filas sin cliente. */
export function validarDatos(entrada: unknown): Validacion {
  if (!entrada || typeof entrada !== 'object') return { ok: false, error: 'Faltan los datos del reporte.' }
  const o = entrada as Record<string, unknown>
  if (!Array.isArray(o.filas)) return { ok: false, error: 'Faltan las filas de clientes.' }
  if (o.filas.length > TOPE_FILAS) return { ok: false, error: `Demasiadas filas (máximo ${TOPE_FILAS}).` }
  const filas: FilaEow[] = []
  const ids = new Set<string>()
  for (const crudo of o.filas) {
    if (!crudo || typeof crudo !== 'object') return { ok: false, error: 'Fila inválida.' }
    const f = crudo as Record<string, unknown>
    const cliente = unaLinea(f.cliente, TOPE_CLIENTE)
    if (!cliente) continue
    let id = typeof f.id === 'string' && ID_FILA.test(f.id) ? f.id : nuevoIdFila()
    while (ids.has(id)) id = nuevoIdFila()
    ids.add(id)
    if (f.color !== null && f.color !== undefined && f.color !== '' && !esColor(f.color)) return { ok: false, error: `Color inválido en «${cliente}».` }
    const origen: OrigenFila = f.origen === 'sistema' || f.origen === 'importado' ? f.origen : 'manual'
    filas.push({
      id,
      cliente,
      comentario: unaLinea(f.comentario, TOPE_COMENTARIO),
      color: esColor(f.color) ? f.color : null,
      pausado: f.pausado === true,
      idCrm: typeof f.idCrm === 'string' && ID_CRM.test(f.idCrm) ? f.idCrm.toUpperCase() : null,
      lanzado: esFecha(f.lanzado) ? f.lanzado : null,
      origen,
    })
  }
  const t = (o.tarjetas && typeof o.tarjetas === 'object' ? o.tarjetas : {}) as Record<string, unknown>
  const tarjetas = tarjetasVacias()
  for (const k of TARJETAS) {
    const lista = t[k]
    if (lista === undefined) continue
    if (!Array.isArray(lista)) return { ok: false, error: `La tarjeta «${NOMBRE_TARJETA[k]}» tiene que ser una lista.` }
    if (lista.length > TOPE_ITEMS_TARJETA) return { ok: false, error: `Demasiados ítems en «${NOMBRE_TARJETA[k]}».` }
    tarjetas[k] = lista.map((x) => unaLinea(x, TOPE_ITEM)).filter(Boolean)
  }
  return { ok: true, datos: { filas, tarjetas } }
}

/** Contadores de la cabecera. Los pausados cuentan dentro de su color. */
export function contar(filas: readonly FilaEow[]): Record<Color | 'sinUbicar' | 'pausados', number> {
  const n = { rojo: 0, amarillo: 0, verde: 0, sinUbicar: 0, pausados: 0 }
  for (const f of filas) {
    if (f.color) n[f.color]++
    else n.sinUbicar++
    if (f.pausado) n.pausados++
  }
  return n
}

export type DestinoUbicar = Color | 'pausado'
/**
 * «Ubicar» un recién lanzado: Rojo, Amarillo o Verde lo pasan a esa lista; «Pausado» lo deja pausado en Amarillo (un cliente
 * en pausa necesita seguimiento, pero no es una alarma; el color se cambia después si hace falta).
 */
export function ubicar(filas: readonly FilaEow[], id: string, destino: DestinoUbicar): FilaEow[] {
  return filas.map((f) =>
    f.id !== id ? f : destino === 'pausado' ? { ...f, color: f.color ?? 'amarillo', pausado: true } : { ...f, color: destino, pausado: f.pausado },
  )
}

// ── Semanas ──
export const sumarDias = (f: string, n: number): string => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** El domingo de la semana de `hoy` (lunes a domingo): la fecha con que se nombra el reporte. */
export function domingoDe(hoy: string): string {
  const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay() // 0 = domingo
  return dia === 0 ? hoy : sumarDias(hoy, 7 - dia)
}
/** «13/11/26» */
export const fechaCorta = (f: string): string => (esFecha(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : f)

/**
 * La semana nueva copia de la anterior la lista de clientes (con sus comentarios, colores y pausas) y las tarjetas, para
 * editarla. Los recién lanzados sin ubicar también pasan (siguen sin ubicar). Ids nuevos y origen «manual».
 */
export function copiarSemana(anterior: DatosEow | null, semilla = 'n'): DatosEow {
  if (!anterior) return datosVacios()
  return {
    filas: anterior.filas.map((f, i) => ({ ...f, id: `${semilla}${i.toString(36)}`, origen: f.origen === 'sistema' && !f.color ? 'sistema' : 'manual' })),
    tarjetas: Object.fromEntries(TARJETAS.map((k) => [k, [...(anterior.tarjetas[k] ?? [])]])) as Tarjetas,
  }
}

// ── Registro de cambios: qué cambió entre dos versiones, en líneas cortas (sin el texto entero de los comentarios) ──
export function resumirCambios(antes: DatosEow | null, despues: DatosEow): string[] {
  if (!antes) return ['Reporte creado']
  const cambios: string[] = []
  const porId = new Map(antes.filas.map((f) => [f.id, f]))
  const nuevosIds = new Set(despues.filas.map((f) => f.id))
  for (const f of despues.filas) {
    const a = porId.get(f.id)
    if (!a) { cambios.push(`+ ${f.cliente}${f.color ? ` (${NOMBRE_COLOR[f.color]})` : ' (sin ubicar)'}`); continue }
    if (a.cliente !== f.cliente) cambios.push(`${a.cliente} → renombrado a ${f.cliente}`)
    if (a.color !== f.color) cambios.push(`${f.cliente}: ${a.color ? NOMBRE_COLOR[a.color] : 'sin ubicar'} → ${f.color ? NOMBRE_COLOR[f.color] : 'sin ubicar'}`)
    if (a.pausado !== f.pausado) cambios.push(`${f.cliente}: ${f.pausado ? 'pausado' : 'sin pausa'}`)
    if (a.comentario !== f.comentario) cambios.push(`${f.cliente}: comentario`)
  }
  for (const a of antes.filas) if (!nuevosIds.has(a.id)) cambios.push(`− ${a.cliente}`)
  for (const k of TARJETAS) {
    const x = antes.tarjetas[k] ?? [], y = despues.tarjetas[k] ?? []
    const mas = y.filter((v) => !x.includes(v)).length, menos = x.filter((v) => !y.includes(v)).length
    if (mas || menos) cambios.push(`${NOMBRE_TARJETA[k]}: ${[mas ? `+${mas}` : '', menos ? `−${menos}` : ''].filter(Boolean).join(' ')}`)
  }
  return cambios
}
