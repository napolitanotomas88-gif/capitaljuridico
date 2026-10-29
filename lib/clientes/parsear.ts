// ── Parseo de las hojas crudas del CRM de clientes (puro: sin red ni reloj) ─────────────────
// Las columnas se resuelven POR ENCABEZADO (las posiciones cambiaron varias veces): cada hoja trae
// la fila 1 en el índice 0 de HojasCrudas (por eso los rangos de lectura SIEMPRE arrancan en la fila 1).
// Si falta un encabezado no se adivina por posición: la clave queda en `faltantes` del diagnóstico.
import type {
  Celda, ClienteBase, ColumnasHoja, EstadoCliente, EstadoReferido, Fila, HojasCrudas, Linea, MomentoPedido,
  MovimientoCredito, Periodo, Referido, TipoMovimiento,
} from './tipos'
import { fechaDeCelda, ymdAFechaAR } from './fechas'
import { esExtension, esRenovacionPaga } from './renovaciones'
import { aNumero, letraColumna, normTxt, txt } from './texto'

// ── Resolución de columnas ──
type Pred = (h: string) => boolean
interface Resolucion<K extends string> { idx: Record<K, number>; resumen: ColumnasHoja }

// `relativas`: para columnas cuyo encabezado está en blanco en la planilla real (en Agencia las columnas
// A y B —ID y Nombre— no tienen título). No se adivina por letra: se toma la columna que está a `delta`
// posiciones de otra YA resuelta por encabezado (ID = 2 antes de "Estado", Nombre = 1 antes) y solo si
// su encabezado está realmente vacío. Queda anotado en `porPosicion` del diagnóstico.
type Relativas<K extends string> = Partial<Record<K, { respectoDe: K; delta: number }>>

export function resolverColumnas<K extends string>(hoja: string, header: Fila | undefined, spec: Record<K, Pred>, relativas: Relativas<K> = {}): Resolucion<K> {
  const hs = (header ?? []).map(h => normTxt(h))
  const idx = {} as Record<K, number>
  const resueltas: Record<string, string> = {}
  const faltantes: string[] = [], duplicadas: string[] = [], porPosicion: string[] = []
  const candidatasDe = {} as Record<K, number[]>
  for (const k of Object.keys(spec) as K[]) {
    candidatasDe[k] = hs.map((h, i) => (h && spec[k](h) ? i : -1)).filter(i => i >= 0)
    idx[k] = candidatasDe[k].length ? candidatasDe[k][0] : -1
  }
  for (const k of Object.keys(spec) as K[]) {
    const rel = relativas[k]
    if (idx[k] === -1 && rel && idx[rel.respectoDe] >= 0) {
      const i = idx[rel.respectoDe] + rel.delta
      if (i >= 0 && i < hs.length && hs[i] === '' && !Object.values(idx).includes(i)) { idx[k] = i; porPosicion.push(k) }
    }
    if (idx[k] === -1) faltantes.push(k)
    else resueltas[k] = letraColumna(idx[k])
    if (candidatasDe[k].length > 1) duplicadas.push(k)
  }
  return { idx, resumen: { hoja, resueltas, faltantes, duplicadas, porPosicion } }
}

const SPEC_CLIENTES = {
  id: (h: string) => h === 'id' || h === 'id cliente',
  nombre: (h: string) => h === 'nombre' || h.startsWith('nombre y apellido'),
  estado: (h: string) => h === 'estado',
  celular: (h: string) => ['cel', 'celular', 'telefono', 'whatsapp'].includes(h),
  mail: (h: string) => ['mail', 'email', 'e mail', 'correo'].includes(h),
  closer: (h: string) => h === 'closer',
  estudio: (h: string) => ['estudio', 'estudio juridico', 'nombre del estudio'].includes(h),
  csm: (h: string) => ['csm', 'responsable csm'].includes(h),
  ciudad: (h: string) => ['ciudad', 'localidad', 'ciudad del cliente'].includes(h),
  fuente: (h: string) => h === 'fuente',
  contrato: (h: string) => h === 'contrato',
  dia1: (h: string) => h === 'dia 1',
  finPeriodo: (h: string) => h.startsWith('fin periodo'),
  renovo: (h: string) => h === 'renovo',
  ltvContratado: (h: string) => h.includes('ltv') && h.includes('contratado'),
  ltvCobrado: (h: string) => h.includes('ltv') && h.includes('cobrado'),
  duracion: (h: string) => h.startsWith('duracion'),
  promesa: (h: string) => h.includes('promesa'),
  satisfaccion: (h: string) => h.includes('satisfaccion'),
  testimonio: (h: string) => h === 'testimonio',
  gameplan: (h: string) => h.includes('gameplan'),
  notasRenov: (h: string) => h.startsWith('notas') && h.includes('renov'),
  anotaciones: (h: string) => h === 'anotaciones',
  proximoCobro: (h: string) => h.includes('proximo cobro'),
  llamadaAgendada: (h: string) => h.includes('llamada agendada'),
  fechaBaja: (h: string) => h.includes('fecha de baja'),
}

// En Agencia las columnas A y B no tienen encabezado: ID y Nombre van pegados a la izquierda de "Estado"
const RELATIVAS_CLIENTES: Relativas<keyof typeof SPEC_CLIENTES> = { id: { respectoDe: 'estado', delta: -2 }, nombre: { respectoDe: 'estado', delta: -1 } }

const SPEC_RENOVACIONES = {
  id: (h: string) => h === 'id' || h === 'id cliente',
  nombre: (h: string) => h === 'nombre',
  periodo: (h: string) => h.startsWith('periodo'),
  dia1: (h: string) => h === 'dia 1',
  fin: (h: string) => h.startsWith('finalizacion') || h.startsWith('fin periodo') || h === 'fin',
  precio: (h: string) => h === 'precio',
  notas: (h: string) => h === 'notas',
  meses: (h: string) => h.startsWith('meses'),   // "Meses (vacío = 120 días)": vacío o 4 = 120 días corridos; otro número = meses
}

const SPEC_REFERIDOS = {
  id: (h: string) => h === 'id',
  fechaPedido: (h: string) => h.startsWith('fecha') && h.includes('pedido'),
  momento: (h: string) => h.startsWith('momento'),
  idReferidor: (h: string) => /^id\b.*referidor/.test(h),
  nombre: (h: string) => h === 'nombre' || h === 'nombre referido',
  telefono: (h: string) => ['telefono', 'cel', 'celular'].includes(h),
  mail: (h: string) => ['mail', 'email', 'correo'].includes(h),
  estudio: (h: string) => h === 'estudio',
  estado: (h: string) => h === 'estado',
  fechaLlamada: (h: string) => h.startsWith('fecha') && h.includes('llamada'),
  idClienteNuevo: (h: string) => /^id\b.*nuevo/.test(h),
  fechaPrimerPago: (h: string) => h.includes('primer pago'),
  fechaLiberacion: (h: string) => h.includes('liberacion'),
  reembolso: (h: string) => h.startsWith('reembolso'),
  notas: (h: string) => h === 'notas',
  cargadoPor: (h: string) => h.startsWith('cargado'),
}

const SPEC_CREDITOS = {
  id: (h: string) => h === 'id',
  fecha: (h: string) => h === 'fecha',
  idCliente: (h: string) => h === 'id cliente',
  tipo: (h: string) => h === 'tipo',
  idReferido: (h: string) => h === 'referido' || h === 'id referido',
  meses: (h: string) => h.startsWith('meses'),
  extra: (h: string) => h === 'extra',
  vence: (h: string) => h === 'vence',
  renovacionAplicada: (h: string) => h.startsWith('renovacion'),
  nota: (h: string) => h === 'nota' || h === 'notas',
  cargadoPor: (h: string) => h.startsWith('cargado'),
}

// Claves que sin encabezado impiden leer la hoja (no solo "faltan datos")
export const OBLIGATORIAS_CLIENTES = ['id', 'nombre', 'estado'] as const

// Resolución de columnas de las hojas de clientes y de Renovaciones (la usan las altas para saber dónde escribir)
export const columnasDeClientes = (hoja: string, header: Fila | undefined) => resolverColumnas(hoja, header, SPEC_CLIENTES, RELATIVAS_CLIENTES)
export const columnasDeRenovaciones = (header: Fila | undefined) => resolverColumnas('Renovaciones', header, SPEC_RENOVACIONES)

// ── Normalizadores ──
const ESTADOS_CLIENTE: EstadoCliente[] = ['ACTIVO', 'FINALIZADO', 'INACTIVO', 'PAUSADO']
export function parsearEstadoCliente(c: Celda | undefined): EstadoCliente {
  const v = txt(c).toUpperCase()
  if (v === 'TERMINÓ' || v === 'TERMINO') return 'FINALIZADO'   // valor de la migración del CRM viejo
  return (ESTADOS_CLIENTE as string[]).includes(v) ? (v as EstadoCliente) : ''
}

const ESTADOS_REFERIDO: Record<string, EstadoReferido> = {
  presentado: 'Presentado', asistio: 'Asistió', 'no asistio': 'No asistió', cerro: 'Cerró', 'no cerro': 'No cerró', descartado: 'Descartado',
}
export const parsearEstadoReferido = (c: Celda | undefined): EstadoReferido | '' => ESTADOS_REFERIDO[normTxt(c)] ?? ''

export function parsearMomento(c: Celda | undefined): MomentoPedido | '' {
  const t = normTxt(c)
  if (!t) return ''
  if (t.includes('kick')) return 'post_kickoff'
  if (t.includes('win')) return 'primer_win'
  if (t.includes('fin de mes') || t.includes('reporte')) return 'reporte_fin_de_mes'
  if (t.includes('proyeccion')) return 'llamada_proyeccion'
  return ''
}

const TIPOS_MOV: TipoMovimiento[] = ['ganado_cierre', 'ganado_llamada', 'canje', 'vencimiento', 'ajuste']
export function parsearTipoMovimiento(c: Celda | undefined): TipoMovimiento | '' {
  const t = normTxt(c).replace(/ /g, '_')
  return (TIPOS_MOV as string[]).includes(t) ? (t as TipoMovimiento) : ''
}

const esSi = (c: Celda | undefined) => normTxt(c).startsWith('si')

// IDs de cliente escritos a mano en Referidos y Créditos ("a012 ", "A012"): la validación de la planilla no es
// estricta, y con una minúscula el crédito no se asociaría al cliente (los IDs del CRM son A0xx / C0xx en mayúscula).
const idEnMayusculas = (c: Celda | undefined): string => txt(c).toUpperCase()

// Col "Llamada agendada": fecha (serial) o texto libre ("Agendada (10/9)", "Proyección 11/9")
function parsearLlamada(c: Celda | undefined): string | null {
  // Una fecha de la planilla se muestra como fecha argentina ("3/9/2026"), no como 'AAAA-MM-DD': el campo es texto para mostrar
  if (typeof c === 'number') {
    const ymd = c > 0 ? fechaDeCelda(c) : null
    return ymd ? ymdAFechaAR(ymd) : null
  }
  return txt(c).slice(0, 80) || null
}

// ── Hojas ──
const filasDeDatos = (hoja: Fila[] | null): Fila[] => (hoja ?? []).slice(1)

function parsearClientes(hoja: Fila[], linea: Linea, nombreHoja: string): { clientes: ClienteBase[]; columnas: ColumnasHoja } {
  const { idx, resumen } = resolverColumnas(nombreHoja, hoja[0], SPEC_CLIENTES, RELATIVAS_CLIENTES)
  const clientes: ClienteBase[] = []
  filasDeDatos(hoja).forEach((r, i) => {
    const g = (k: keyof typeof SPEC_CLIENTES): Celda | undefined => (idx[k] >= 0 ? r[idx[k]] : undefined)
    const id = txt(g('id')), nombre = txt(g('nombre'))
    if (!id && !nombre) return   // fila vacía (o con fórmulas precargadas y nada más)
    clientes.push({
      id, linea, fila: i + 2, nombre,
      estudio: txt(g('estudio')), csm: txt(g('csm')), ciudad: txt(g('ciudad')),
      estado: parsearEstadoCliente(g('estado')),
      celular: txt(g('celular')), mail: txt(g('mail')), closer: txt(g('closer')), fuente: txt(g('fuente')), contrato: txt(g('contrato')),
      dia1: fechaDeCelda(g('dia1')), finPeriodo: fechaDeCelda(g('finPeriodo')),
      renovo: txt(g('renovo')),
      // Consultora no tiene precios cargados en Renovaciones: su "LTV contratado" es un 0 de relleno (suma de
      // precios vacíos), no un monto contratado. Se lee como "sin cargar" para no mostrar "contratado USD 0".
      ltvContratado: linea === 'consultora' && aNumero(g('ltvContratado')) === 0 ? null : aNumero(g('ltvContratado')),
      ltvCobrado: aNumero(g('ltvCobrado')),
      duracionDias: aNumero(g('duracion')),
      promesa: txt(g('promesa')),
      satisfaccion: (() => { const n = aNumero(g('satisfaccion')); return n !== null && n > 0 && n <= 10 ? n : null })(),
      testimonio: txt(g('testimonio')), gameplan: txt(g('gameplan')), notasRenov: txt(g('notasRenov')), anotaciones: txt(g('anotaciones')),
      proximoCobro: fechaDeCelda(g('proximoCobro')),
      llamadaAgendada: parsearLlamada(g('llamadaAgendada')),
      fechaBaja: fechaDeCelda(g('fechaBaja')),
      periodos: [],
    })
  })
  return { clientes, columnas: resumen }
}

function parsearPeriodos(hoja: Fila[]): { periodos: Periodo[]; columnas: ColumnasHoja; descartadas: number } {
  const { idx, resumen } = resolverColumnas('Renovaciones', hoja[0], SPEC_RENOVACIONES)
  const periodos: Periodo[] = []
  let descartadas = 0
  filasDeDatos(hoja).forEach((r, i) => {
    const g = (k: keyof typeof SPEC_RENOVACIONES): Celda | undefined => (idx[k] >= 0 ? r[idx[k]] : undefined)
    const idCliente = txt(g('id'))
    if (!idCliente) return
    const periodo = aNumero(g('periodo'))
    if (periodo === null) { descartadas++; return }   // sin número de período no se puede ubicar
    const notas = txt(g('notas'))
    const celdaPrecio = g('precio')
    const precio = txt(celdaPrecio) === '' ? null : aNumero(celdaPrecio)   // vacío = pendiente de cargar
    const meses = aNumero(g('meses'))
    periodos.push({
      idCliente, fila: i + 2, nombre: txt(g('nombre')), periodo,
      dia1: fechaDeCelda(g('dia1')), fin: fechaDeCelda(g('fin')),
      precio, notas, meses,
      esExtension: esExtension(notas),
      esRenovacionPaga: esRenovacionPaga({ periodo, notas, precio }),
    })
  })
  return { periodos, columnas: resumen, descartadas }
}

export function parsearReferidos(hoja: Fila[] | null): { referidos: Referido[]; columnas: ColumnasHoja | null } {
  if (!hoja) return { referidos: [], columnas: null }
  const { idx, resumen } = resolverColumnas('Referidos', hoja[0], SPEC_REFERIDOS)
  const referidos: Referido[] = []
  filasDeDatos(hoja).forEach((r, i) => {
    const g = (k: keyof typeof SPEC_REFERIDOS): Celda | undefined => (idx[k] >= 0 ? r[idx[k]] : undefined)
    const id = txt(g('id')), nombre = txt(g('nombre'))
    if (!id && !nombre) return
    referidos.push({
      id, fila: i + 2,
      fechaPedido: fechaDeCelda(g('fechaPedido')), momento: parsearMomento(g('momento')),
      idReferidor: idEnMayusculas(g('idReferidor')), nombre, telefono: txt(g('telefono')), mail: txt(g('mail')), estudio: txt(g('estudio')),
      estado: parsearEstadoReferido(g('estado')),
      fechaLlamada: fechaDeCelda(g('fechaLlamada')), idClienteNuevo: idEnMayusculas(g('idClienteNuevo')),
      fechaPrimerPago: fechaDeCelda(g('fechaPrimerPago')), fechaLiberacion: fechaDeCelda(g('fechaLiberacion')),
      reembolso: esSi(g('reembolso')), notas: txt(g('notas')), cargadoPor: txt(g('cargadoPor')),
    })
  })
  return { referidos, columnas: resumen }
}

export function parsearMovimientos(hoja: Fila[] | null): { movimientos: MovimientoCredito[]; columnas: ColumnasHoja | null } {
  if (!hoja) return { movimientos: [], columnas: null }
  const { idx, resumen } = resolverColumnas('Créditos', hoja[0], SPEC_CREDITOS)
  const movimientos: MovimientoCredito[] = []
  filasDeDatos(hoja).forEach((r, i) => {
    const g = (k: keyof typeof SPEC_CREDITOS): Celda | undefined => (idx[k] >= 0 ? r[idx[k]] : undefined)
    const id = txt(g('id')), idCliente = idEnMayusculas(g('idCliente'))
    if (!id && !idCliente) return
    movimientos.push({
      id, fila: i + 2, fecha: fechaDeCelda(g('fecha')), idCliente, tipo: parsearTipoMovimiento(g('tipo')),
      idReferido: txt(g('idReferido')), meses: aNumero(g('meses')) ?? 0, extra: txt(g('extra')),
      vence: fechaDeCelda(g('vence')), renovacionAplicada: txt(g('renovacionAplicada')), nota: txt(g('nota')), cargadoPor: txt(g('cargadoPor')),
    })
  })
  return { movimientos, columnas: resumen }
}

// ── Todo junto ──
export interface HojasParseadas {
  base: ClienteBase[]             // Agencia + Consultora, con sus períodos ya asociados por ID
  periodos: Periodo[]
  referidos: Referido[]
  movimientos: MovimientoCredito[]
  columnas: ColumnasHoja[]
  avisos: string[]
}

export function parsearHojas(hojas: HojasCrudas): HojasParseadas {
  const avisos: string[] = []
  const ag = parsearClientes(hojas.agencia, 'agencia', 'Agencia')
  const co = parsearClientes(hojas.consultora, 'consultora', 'Consultora')
  const re = parsearPeriodos(hojas.renovaciones)
  const rf = parsearReferidos(hojas.referidos)
  const mv = parsearMovimientos(hojas.creditos)
  const columnas = [ag.columnas, co.columnas, re.columnas, rf.columnas, mv.columnas].filter((c): c is ColumnasHoja => c !== null)

  // Sin ID/Nombre/Estado la hoja no se puede leer: se avisa fuerte (no se adivina por posición)
  for (const c of [ag.columnas, co.columnas]) {
    const sin = OBLIGATORIAS_CLIENTES.filter(k => c.faltantes.includes(k))
    if (sin.length) avisos.push(`En "${c.hoja}" no se encontró el encabezado de: ${sin.join(', ')}.`)
  }
  if (re.descartadas) avisos.push(`Renovaciones: ${re.descartadas} fila(s) con ID pero sin número de período, ignoradas.`)

  // Períodos asociados por ID (A y C comparten la pestaña Renovaciones)
  const porId = new Map<string, Periodo[]>()
  for (const p of re.periodos) porId.set(p.idCliente, [...(porId.get(p.idCliente) ?? []), p])
  const base = [...ag.clientes, ...co.clientes]
  const vistos = new Map<string, number>()
  for (const c of base) {
    if (c.id) {
      vistos.set(c.id, (vistos.get(c.id) ?? 0) + 1)
      c.periodos = (porId.get(c.id) ?? []).slice().sort((a, b) => a.periodo - b.periodo)
    }
  }
  const repetidos = [...vistos.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  if (repetidos.length) avisos.push(`ID repetido en el CRM: ${repetidos.join(', ')}.`)
  return { base, periodos: re.periodos, referidos: rf.referidos, movimientos: mv.movimientos, columnas, avisos }
}

