// ── Ficha de un cliente: lo que muestra /clientes/[id] y devuelve /api/clientes/[id] (puro) ──
// Es UN solo objeto para la página y la API, y es lo único que sale al navegador: solo trae lo que la ficha
// necesita (nada de la fila de la planilla, ni del gameplan interno, ni teléfono/mail de los referidos).
// Los datos de contacto viajan solo si quien llama tiene permiso (conContacto).
import type {
  Cliente, ColorSemaforo, DatosClientes, EntregableGanado, EstadoCliente, EstadoReferido, Linea, MomentoPedido, MovimientoCredito, Referido,
  ResumenCredito, TipoMovimiento, Ymd,
} from './tipos'
import type { Telefono } from './contacto'
import type { ReglasReferidos } from './reglasReferidos'
import { REGLAS_REFERIDOS } from './reglasReferidos'
import { calcularCreditos, premioDelIntento, saldoCanjeable } from './creditos'
import { zonaPorTelefono, type ZonaGrabacion } from './zona'
import { telefonosDe } from './contacto'
import { diasEntre } from './fechas'
import { diasHasta, textoDias } from './formato'
import { UMBRAL_SALDO_USD } from './listado'
import { ETIQUETA_MOMENTO, pasoDelPrograma, textoPremioIntento, type PasoReferido } from './programa'
import { detalleBeneficio, panelDeCliente, type LineaBeneficio, type PanelReferidos } from './panelReferidos'

// Forma de un ID del CRM (A012, C003). Cualquier otra cosa es un 404 sin tocar la planilla.
export const ID_CLIENTE_VALIDO = /^[A-Za-z]\d{1,6}$/

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ganado_cierre: 'Ganado por cierre',
  ganado_llamada: 'Ganado por intento',
  canje: 'Canje contra renovación',
  vencimiento: 'Vencimiento',
  ajuste: 'Ajuste',
}

export interface PeriodoFicha {
  numero: number
  tipo: 'inicial' | 'renovacion' | 'extension'
  titulo: string                // "Período inicial", "Renovación 1", "Extensión de servicio"
  dia1: Ymd | null
  fin: Ymd | null
  precio: number | null         // null = sin cargar; 0 = no se cobró (extensión)
  meses: number | null
  notas: string
  actual: boolean               // el período que cubre hoy
}

export interface MovimientoFicha {
  fecha: Ymd | null
  tipo: string
  meses: number
  extra: string
  vence: Ymd | null
  renovacion: string
  nota: string
}

export interface ReferidoFicha {
  id: string
  nombre: string
  estudio: string
  momento: string               // "Post-kickoff"…
  fechaPedido: Ymd | null
  estado: EstadoReferido | ''
  fechaLlamada: Ymd | null
  idClienteNuevo: string
  paso: PasoReferido
}

// Premio de un intento ya ganado, con su texto
export interface PremioIntentoFicha {
  intento: number
  texto: string                 // "Página web completa", "Crédito de USD 300"…
  fecha: Ymd                    // cuándo se ganó (la llamada del intento)
  vence: Ymd
  estado: 'vigente' | 'vencido' | 'canjeado'
}

export interface CreditosFicha {
  pestanasAusentes: string[]    // 'Referidos' / 'Créditos' que todavía no existen en la planilla
  nivel: number
  nivelesTotal: number
  mesesDisponibles: number      // escalera de cierres + mes del intento 5 (con el tope) + ajustes vigentes
  mesesPorCierres: number       // de la escalera de cierres, sin tope
  mesesPorIntentos: number      // el mes del intento 5, si es vigente y del ciclo actual
  mesesSobreTope: number        // los que no suman porque se llegó al tope
  topeMeses: number | null      // null = sin tope
  valorUSD: number              // referencia para reportes (pago único): el crédito va en meses
  valorPlanDePagosUSD: number   // ídem, con la renovación gratis en plan de pagos
  renovacionGratis: boolean
  mesesExtraSobreRenovacion: number
  extras: string[]
  usd: { ganado: number; usado: number; vencido: number; disponible: number }   // créditos en USD, aparte de los meses
  intentos: number              // acumulados: referidos que entraron a la llamada y no cerraron
  premiosIntentos: PremioIntentoFicha[]
  paginaWeb: EntregableGanado | null
  branding: EntregableGanado | null
  proximosPremios: { intento: number; texto: string }[]   // lo que dan los próximos intentos
  zona: ZonaGrabacion           // pista por teléfono para ofrecer la grabación en las oficinas (la confirma el closer)
  cierresLiberados: number
  cierresPendientes: { idReferido: string; texto: string }[]
  cierresVencidos: number
  cierresReembolsados: number
  anterioresAlPrograma: number  // presentados antes del inicio del programa: no generan crédito
  programaDesde: Ymd
  topeAlcanzado: boolean
  cicloDesde: Ymd | null
  proximoNivel: { cierresFaltantes: number; descripcion: string } | null
  proximoVencimiento: { fecha: Ymd; dias: number; cierres: number; mesesIntentos: number; usd: number; entregables: number } | null
  advertencias: string[]
  movimientos: MovimientoFicha[]
  referidos: ReferidoFicha[]
}

/** Panel de referidos de la ficha: los números del cliente, el detalle del beneficio y las dudas abiertas del programa tal como están */
export interface PanelFicha extends PanelReferidos {
  detalle: LineaBeneficio[]
  dudasAbiertas: string[]
  /** Pestañas 'Referidos' / 'Créditos' que no existen todavía: el panel lo dice en vez de mostrar ceros como si fueran datos */
  pestanasAusentes: string[]
}

export interface FichaCliente {
  id: string
  linea: Linea
  nombre: string
  estudio?: string
  csm?: string
  ciudad?: string
  estado: EstadoCliente
  semaforo: ColorSemaforo | null
  dias: number | null
  closer: string
  fuente: string
  contrato: string
  dia1: Ymd | null
  fin: Ymd | null
  renovo: string
  fechaBaja: Ymd | null
  llamadaAgendada: string | null
  promesa: string
  satisfaccion: number | null
  testimonio: string
  contacto: { telefonos: Telefono[]; mail: string } | null   // null = sin permiso para ver contacto
  esNoCliente: boolean
  faltantes: string[]           // 'id', 'fin_periodo', 'ltv', 'duracion'
  periodos: PeriodoFicha[]
  cobros: {
    contratado: number | null
    cobrado: number | null
    aviso?: string | null
    saldo: number | null        // contratado − cobrado (si ambos están cargados); nunca negativo
    saldoRelevante: boolean     // pasa el umbral de USD 50
    proximoCobro: Ymd | null
    proximoCobroDias: number | null
  }
  creditos: CreditosFicha
  panel: PanelFicha
  notas: { anotaciones: string; renovacion: string }
  reglas: { version: string; estado: 'borrador' | 'vigente' }
}

const TITULO_TIPO = { inicial: 'Período inicial', extension: 'Extensión de servicio' } as const

function periodosDe(c: Cliente, hoy: Ymd): PeriodoFicha[] {
  const lista: PeriodoFicha[] = c.periodos.map(p => {
    const tipo = p.periodo === 0 ? 'inicial' : p.esExtension ? 'extension' : 'renovacion'
    return {
      numero: p.periodo, tipo,
      titulo: tipo === 'renovacion' ? `Renovación ${p.periodo}` : TITULO_TIPO[tipo],
      dia1: p.dia1, fin: p.fin, precio: p.precio, meses: p.meses, notas: p.notas,
      actual: false,
    }
  })
  // El período actual: el último (por número) que cubre hoy
  for (let i = lista.length - 1; i >= 0; i--) {
    const p = lista[i]
    if (p.dia1 && p.fin && p.dia1 <= hoy && hoy <= p.fin) { p.actual = true; break }
  }
  return lista
}

function movimientosDe(movs: MovimientoCredito[]): MovimientoFicha[] {
  return movs.slice().sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '')).map(m => ({
    fecha: m.fecha, tipo: m.tipo ? ETIQUETA_MOVIMIENTO[m.tipo] : 'Sin tipo', meses: m.meses, extra: m.extra, vence: m.vence,
    renovacion: m.renovacionAplicada, nota: m.nota,
  }))
}

function referidosDe(refs: Referido[], hoy: Ymd, cicloDesde: Ymd | null, reglas: ReglasReferidos): ReferidoFicha[] {
  return refs.slice().sort((a, b) => (b.fechaPedido ?? '').localeCompare(a.fechaPedido ?? '')).map(r => ({
    id: r.id, nombre: r.nombre, estudio: r.estudio,
    momento: r.momento ? ETIQUETA_MOMENTO[r.momento as MomentoPedido] : '',
    fechaPedido: r.fechaPedido, estado: r.estado, fechaLlamada: r.fechaLlamada, idClienteNuevo: r.idClienteNuevo,
    paso: pasoDelPrograma(r, hoy, reglas, cicloDesde),
  }))
}

function creditosDe(c: Cliente, datos: DatosClientes, resumen: ResumenCredito | undefined, reglas: ReglasReferidos, zona: ZonaGrabacion): CreditosFicha {
  const hoy = datos.hoy
  const res = resumen ?? calcularCreditos({ idCliente: c.id, referidos: [], movimientos: [], hoy }, reglas)
  const saldo = saldoCanjeable(res, reglas)
  const prox = res.vencimientos.length ? { ...res.vencimientos[0], dias: diasEntre(hoy, res.vencimientos[0].fecha) } : null
  return {
    pestanasAusentes: datos.pestanasAusentes,
    nivel: res.nivel, nivelesTotal: reglas.escalera.length,
    mesesDisponibles: saldo.meses, mesesPorCierres: res.mesesPorCierres, mesesPorIntentos: res.mesesPorIntentos,
    mesesSobreTope: res.mesesSobreTope, topeMeses: res.topeMeses,
    valorUSD: saldo.valorUSD, valorPlanDePagosUSD: saldo.valorPlanDePagosUSD,
    renovacionGratis: res.renovacionGratis, mesesExtraSobreRenovacion: res.mesesExtraSobreRenovacion, extras: res.extras,
    usd: res.usd,
    intentos: res.intentos,
    premiosIntentos: res.premiosIntentos.map(p => ({
      intento: p.intento,
      texto: textoPremioIntento(premioDelIntento(p.intento, reglas)),
      fecha: p.fecha, vence: p.vence, estado: p.estado,
    })),
    paginaWeb: res.paginaWeb, branding: res.branding,
    proximosPremios: Array.from({ length: 3 }, (_, i) => premioDelIntento(res.intentos + 1 + i, reglas)).map(p => ({ intento: p.intento, texto: textoPremioIntento(p) })),
    zona,
    cierresLiberados: res.cierresLiberados,
    cierresPendientes: res.cierresPendientes.map(p => ({
      idReferido: p.idReferido,
      texto: p.motivo === 'sin_primer_pago' ? 'Falta el primer pago' : `Se libera ${textoDias(p.diasParaLiberar)}`,
    })),
    cierresVencidos: res.cierresVencidos, cierresReembolsados: res.cierresReembolsados,
    anterioresAlPrograma: res.anterioresAlPrograma, programaDesde: reglas.vigenteDesde,
    topeAlcanzado: res.topeAlcanzado, cicloDesde: res.cicloDesde,
    proximoNivel: res.proximoNivel,
    proximoVencimiento: prox,
    advertencias: res.advertencias,
    movimientos: movimientosDe(datos.movimientos.filter(m => m.idCliente === c.id)),
    referidos: referidosDe(datos.referidos.filter(r => r.idReferidor === c.id), hoy, res.cicloDesde, reglas),
  }
}

/** Busca el cliente por ID (sin distinguir mayúsculas) y arma su ficha; null si no existe */
export function armarFicha(
  datos: DatosClientes,
  creditos: Map<string, ResumenCredito>,
  id: string,
  op: { conContacto: boolean },
): FichaCliente | null {
  const c = datos.clientes.find(x => x.id && x.id.toUpperCase() === id.toUpperCase())
  if (!c) return null
  const { hoy } = datos
  const reglas = datos.reglas ?? REGLAS_REFERIDOS
  const zona = zonaPorTelefono(c.celular)   // solo la zona sale al navegador, nunca el teléfono sin permiso
  const panel = panelDeCliente(c.id, datos.referidos, datos.movimientos, creditos.get(c.id), reglas, zona)
  const saldoCrudo = c.ltvContratado !== null && c.ltvCobrado !== null ? c.ltvContratado - c.ltvCobrado : null
  return {
    id: c.id, linea: c.linea, nombre: c.nombre, estado: c.estado, semaforo: c.semaforo, dias: c.diasParaVencer,
    estudio: c.estudio ?? '', csm: c.csm ?? '', ciudad: c.ciudad ?? '',
    closer: c.closer, fuente: c.fuente, contrato: c.contrato, dia1: c.dia1, fin: c.finPeriodo, renovo: c.renovo,
    fechaBaja: c.fechaBaja, llamadaAgendada: c.llamadaAgendada, promesa: c.promesa, satisfaccion: c.satisfaccion, testimonio: c.testimonio,
    contacto: op.conContacto ? { telefonos: telefonosDe(c.celular), mail: c.mail } : null,
    esNoCliente: c.esNoCliente, faltantes: c.faltantes,
    periodos: periodosDe(c, hoy),
    cobros: {
      contratado: c.ltvContratado, cobrado: c.ltvCobrado,
      aviso: c.cobrosAviso ?? null,
      saldo: saldoCrudo === null ? null : Math.max(0, saldoCrudo),
      saldoRelevante: saldoCrudo !== null && saldoCrudo > UMBRAL_SALDO_USD,
      proximoCobro: c.proximoCobro, proximoCobroDias: diasHasta(hoy, c.proximoCobro),
    },
    creditos: creditosDe(c, datos, creditos.get(c.id), reglas, zona),
    panel: {
      ...panel,
      detalle: detalleBeneficio(panel, reglas),
      dudasAbiertas: reglas.dudasAbiertas.map(d => d.texto),
      pestanasAusentes: datos.pestanasAusentes,
    },
    notas: { anotaciones: c.anotaciones, renovacion: c.notasRenov },
    reglas: { version: reglas.version, estado: reglas.estado },
  }
}

/** La ficha sin montos, para quien ve Clientes pero no Finanzas (26/10/2026): sin contratado, cobrado ni saldo, y sin el
 *  precio de cada período. Las fechas (próximo cobro, días) y los créditos quedan: no son plata del estudio. */
export function sinMontos(f: FichaCliente): FichaCliente {
  return {
    ...f,
    periodos: f.periodos.map(p => ({ ...p, precio: null, notas: taparMontos(p.notas) })),
    cobros: { ...f.cobros, contratado: null, cobrado: null, aviso: null, saldo: null, saldoRelevante: false },
    notas: { anotaciones: taparMontos(f.notas.anotaciones), renovacion: taparMontos(f.notas.renovacion) },
  }
}

/** Tapa los montos escritos en un texto libre ("precio ASUMIDO $2.600", "USD 1500", "1.200 usd", "u$s 900"). */
const MONTO_EN_TEXTO = /(?:US\$|U\$S|USD|\$)\s*\d[\d.,]*(?:\s*(?:k|mil)\b)?|\b\d[\d.,]*\s*(?:k\s*)?(?:USD|US\$|U\$S|d[oó]lares|pesos|ARS)\b/gi

export function taparMontos(t: string): string {
  return t.replace(MONTO_EN_TEXTO, '[monto]')
}

/** Parte un texto libre en trozos de texto y de monto (para envolver los montos con <Monto> y que el botón los tape). */
export function partirMontos(t: string): { texto: string; monto: boolean }[] {
  const out: { texto: string; monto: boolean }[] = []
  let i = 0
  for (const m of t.matchAll(MONTO_EN_TEXTO)) {
    const k = m.index ?? 0
    if (k > i) out.push({ texto: t.slice(i, k), monto: false })
    out.push({ texto: m[0], monto: true })
    i = k + m[0].length
  }
  if (i < t.length) out.push({ texto: t.slice(i), monto: false })
  return out
}
