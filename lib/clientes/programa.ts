// ── Programa de referidos: agregados y textos para las pantallas (puro, sin red ni reloj) ──
// Las reglas viven en reglasReferidos.ts y el cálculo de créditos en creditos.ts: acá solo se juntan
// los números del programa (embudo, créditos, ranking, quién está cerca del próximo nivel) y se
// traduce cada referido al paso del programa en el que está. Todo recibe `hoy` ('AAAA-MM-DD').
import type { Cliente, MomentoPedido, MovimientoCredito, Referido, ResumenCredito, Ymd } from './tipos'
import type { ClaveExtra, PasoIntento, PremioIntento, ReglasReferidos } from './reglasReferidos'
import { REGLAS_REFERIDOS } from './reglasReferidos'
import {
  calcularCreditosDeTodos, combinarMeses, esAnteriorAlPrograma, esCanjeDeExtra, usdDeTexto, indiceContactos, liberarPorFecha, nivelPorCierres, proximosVencimientos,
  saldoCanjeable, validarReferido, valorizarMeses, vencimientoDeCredito, type Valorizacion,
} from './creditos'
import { kpiClientesNuevosPorReferido, type KpiReferidos } from './metas'
import { fechaCorta, mesesTexto, textoDias, usd } from './formato'
import { zonaPorTelefono, type ZonaGrabacion } from './zona'
import { esIdAfiliadoExterno } from './afiliadosExternos'

/** Ventana para "créditos por vencer": cuántos días hacia adelante se mira */
export const DIAS_AVISO_VENCIMIENTO = 60
export const FILAS_RANKING = 10

export const ETIQUETA_MOMENTO: Record<MomentoPedido, string> = {
  post_kickoff: 'Post-kickoff',
  primer_win: 'Primer win',
  reporte_fin_de_mes: 'Reporte de fin de mes',
  llamada_proyeccion: 'Llamada de proyección',
}

const asistio = (r: Referido, reglas: ReglasReferidos) => (reglas.estadosAsistio as string[]).includes(r.estado)

// ── Créditos de todos los clientes con actividad ──
// La zona de cada cliente que refiere se deduce de su celular (zona.ts): solo viaja la zona, nunca el teléfono.
// Un referido es válido si es un lead nuevo (su teléfono o mail no está ya en el CRM). La asistencia NO se exige acá:
// un referido recién presentado todavía no asistió y no por eso es inválido (creditos.ts ya cuenta solo los que asistieron).
export function calcularCreditosDeDatos(
  datos: { clientes: Cliente[]; referidos: Referido[]; movimientos: MovimientoCredito[]; hoy: Ymd; reglas?: ReglasReferidos },
  reglas: ReglasReferidos = datos.reglas ?? REGLAS_REFERIDOS,
): Map<string, ResumenCredito> {
  const esContactoConocido = indiceContactos(datos.clientes)
  const reglasValidez: ReglasReferidos = { ...reglas, referidoValido: { ...reglas.referidoValido, debeAsistir: false } }
  const esValido = (r: Referido) => validarReferido(r, { esContactoConocido }, reglasValidez).valido
  const zonas = new Map<string, ZonaGrabacion>()
  for (const c of datos.clientes) if (c.id && !zonas.has(c.id)) zonas.set(c.id, zonaPorTelefono(c.celular))
  return calcularCreditosDeTodos({ referidos: datos.referidos, movimientos: datos.movimientos, hoy: datos.hoy, esValidoDe: () => esValido, zonaDe: id => zonas.get(id) }, reglas)
}

// ── Paso del programa de un referido ──
export const TOTAL_PASOS = 5   // 1 Presentado · 2 Asistió · 3 Cerró · 4 Primer pago · 5 Crédito liberado

export interface PasoReferido {
  numero: number | null         // 1 a 5; null = no llegó a ningún paso (descartado o sin estado)
  total: number
  titulo: string
  detalle: string | null
}

// `cicloDesde` (fecha del último canje contra una renovación): un crédito liberado antes de esa fecha ya se consumió.
// Un referido presentado antes del inicio del programa no genera nada, aunque haya cerrado.
export function pasoDelPrograma(
  r: Pick<Referido, 'estado' | 'fechaLlamada' | 'fechaPrimerPago' | 'reembolso'> & { fechaPedido?: Ymd | null },
  hoy: Ymd,
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
  cicloDesde: Ymd | null = null,
): PasoReferido {
  const paso = (numero: number | null, titulo: string, detalle: string | null = null): PasoReferido => ({ numero, total: TOTAL_PASOS, titulo, detalle })
  if (esAnteriorAlPrograma({ fechaPedido: r.fechaPedido ?? null, fechaLlamada: r.fechaLlamada, fechaPrimerPago: r.fechaPrimerPago }, reglas))
    return paso(null, 'Anterior al programa', `Se presentó antes del ${fechaCorta(reglas.vigenteDesde)}: no genera crédito`)
  switch (r.estado) {
    case 'Presentado':
      return paso(1, 'Presentado', r.fechaLlamada ? `Llamada el ${fechaCorta(r.fechaLlamada)}` : 'Esperando que agende la llamada')
    case 'No asistió':
      return paso(1, 'No asistió a la llamada', 'No suma ningún beneficio')
    case 'Asistió':
      return paso(2, 'Asistió a la llamada', 'Falta saber si cierra: todavía no cuenta como intento ni como cierre')
    case 'No cerró':
      return paso(2, 'Asistió y no cerró', 'Cuenta como intento: suma a la escalera de intentos; no hay crédito por cierre')
    case 'Descartado':
      return paso(null, 'Descartado', null)
    case 'Cerró': {
      const lib = liberarPorFecha({ estado: 'Cerró', fechaPrimerPago: r.fechaPrimerPago, reembolso: r.reembolso }, hoy, reglas)
      switch (lib.motivo) {
        case 'reembolsado': return paso(4, 'Reembolsado', 'El crédito no suma')
        case 'sin_primer_pago': return paso(3, 'Cerró', 'Falta cargar el primer pago')
        case 'fecha_invalida': return paso(3, 'Cerró', 'La fecha del primer pago es inválida')
        case 'esperando_dias':
          return paso(4, 'Primer pago recibido', `Se libera el ${fechaCorta(lib.fechaLiberacion)} (${textoDias(lib.diasParaLiberar)})`)
        default: {
          if (!lib.fechaLiberacion) return paso(5, 'Crédito liberado')
          if (cicloDesde && lib.fechaLiberacion <= cicloDesde) return paso(5, 'Crédito canjeado', 'Se usó en una renovación anterior')
          const vence = vencimientoDeCredito(lib.fechaLiberacion, reglas)
          return vence < hoy ? paso(5, 'Crédito vencido', `Venció el ${fechaCorta(vence)}`) : paso(5, 'Crédito liberado', `Vence el ${fechaCorta(vence)}`)
        }
      }
    }
    default:
      return paso(null, 'Sin estado cargado', 'Falta el estado en la planilla')
  }
}

// ── Nivel de la escalera ──
export const etiquetaNivel = (nivel: number): string => (nivel > 0 ? `Nivel ${nivel}` : 'Sin nivel')

/** Valor de referencia de un escalón en USD (solo reportes): meses × valor del mes; la renovación gratis, USD 2.600 en pago único y USD 3.800 en plan de pagos */
export const valorDelPaso = (paso: { mesesServicio: number; renovacionGratis: boolean }, reglas: ReglasReferidos = REGLAS_REFERIDOS): Valorizacion =>
  valorizarMeses(paso.mesesServicio, paso.renovacionGratis, reglas)

// Meses de servicio que se pierden si vencen los créditos que caducan dentro de `dias` (cierres y mes del intento 5).
// Los más viejos vencen primero: se mide la diferencia con y sin esos créditos, ya con el tope de meses aplicado.
export function mesesPorVencer(res: ResumenCredito, dias: number, reglas: ReglasReferidos = REGLAS_REFERIDOS): number {
  const vencen = proximosVencimientos(res, dias)
  const cierres = vencen.reduce((s, v) => s + v.cierres, 0)
  const intentos = vencen.reduce((s, v) => s + v.mesesIntentos, 0)
  if (!cierres && !intentos) return 0
  const meses = (c: number, i: number) => combinarMeses(nivelPorCierres(c, { reglas }).mesesSinTope, i, reglas).meses
  const antes = meses(res.cierresLiberados, res.mesesPorIntentos)
  const despues = meses(Math.max(0, res.cierresLiberados - cierres), Math.max(0, res.mesesPorIntentos - intentos))
  return Math.max(0, antes - despues)
}

/** USD de crédito que se pierden si no se canjean antes de que venzan, dentro de `dias` */
export function usdPorVencer(res: ResumenCredito, dias: number): number {
  return proximosVencimientos(res, dias).reduce((s, v) => s + v.usd, 0)
}

/** Premio de un intento en palabras: "Página web completa", "Crédito de USD 300", "Branding completo", "1 mes de servicio" */
export function textoPremioIntento(p: PasoIntento): string {
  if (p.premio === 'credito_usd') return `Crédito de ${usd(p.creditoUSD)}`
  if (p.premio === 'mes_servicio') return mesesTexto(p.mesesServicio) + ' de servicio'
  return ETIQUETA_PREMIO_INTENTO[p.premio]
}

/** Nombre corto del premio de un intento */
export const ETIQUETA_PREMIO_INTENTO: Record<PremioIntento, string> = {
  pagina_web: 'Página web completa',
  credito_usd: 'Crédito en USD',
  branding: 'Branding completo',
  mes_servicio: '1 mes de servicio',
}

// ── Resumen del programa ──
export interface FilaRanking {
  idCliente: string
  nombre: string
  enCrm: boolean                // false = el ID del referidor no figura en el CRM (sin ficha a la que enlazar)
  presentados: number
  asistieron: number
  cerraron: number
  liberados: number
  meses: number
  nivel: number
  renovacionGratis: boolean
  intentos: number              // referidos que entraron a la llamada y no cerraron (cuentan para la escalera de intentos)
  usd: number                   // crédito en USD disponible (vigente, del ciclo actual)
}

export interface CercaDelNivel {
  idCliente: string
  nombre: string
  enCrm: boolean
  nivel: number
  cierresLiberados: number
  cierresPendientes: number
  faltan: number                // cierres que todavía no existen para llegar al próximo nivel (0 = alcanza con liberar los pendientes)
  premio: string                // lo que gana al llegar
}

export interface ResumenPrograma {
  hoy: Ymd
  embudo: { presentados: number; asistieron: number; cerraron: number; liberados: number }
  creditos: {
    otorgadosMeses: number      // ganados por cierres y llamadas (con el tope aplicado), contando lo ya canjeado
    canjeadosMeses: number
    disponiblesMeses: number    // vigentes y sin canjear
    porVencerMeses: number      // de los disponibles, los que caducan dentro de diasAviso
    usdDisponible: number       // créditos en USD vigentes y sin canjear (aparte de los meses)
    usdCanjeado: number         // canjes en USD leídos del campo Extra del libro
    usdPorVencer: number        // de los disponibles, los que caducan dentro de diasAviso
    diasAviso: number
    valorMesUSD: number
  }
  ranking: FilaRanking[]
  cerca: CercaDelNivel[]
  referidoresActivos: number
  intentos: number              // total de intentos (entraron a la llamada y no cerraron) de los presentados desde el inicio del programa
  anterioresAlPrograma: number  // presentados antes del inicio del programa: no entran en el embudo ni generan crédito
  programaDesde: Ymd            // inicio del programa con el que se calculó
  kpi: KpiReferidos             // % de clientes nuevos del mes que entran por referido, con su meta
}

export interface EntradaPrograma {
  clientes: Cliente[]
  referidos: Referido[]
  movimientos: MovimientoCredito[]
  creditos: Map<string, ResumenCredito>
  hoy: Ymd
  pestanasAusentes?: string[]   // si falta 'Referidos' el KPI queda "sin datos" (no inventa un 0 %)
}

export function resumirPrograma(entrada: EntradaPrograma, reglas: ReglasReferidos = REGLAS_REFERIDOS): ResumenPrograma {
  // Los afiliados externos (X###) no son clientes del programa: no entran al embudo, al ranking ni a los totales de créditos
  const e: EntradaPrograma = { ...entrada, referidos: entrada.referidos.filter(r => !esIdAfiliadoExterno(r.idReferidor)), movimientos: entrada.movimientos.filter(m => !esIdAfiliadoExterno(m.idCliente)), creditos: new Map([...entrada.creditos].filter(([id]) => !esIdAfiliadoExterno(id))) }
  const { hoy } = e
  const nombres = new Map<string, string>()
  for (const c of e.clientes) if (c.id && !nombres.has(c.id)) nombres.set(c.id, c.nombre)
  const nombreDe = (id: string) => nombres.get(id) ?? `${id} (no está en el CRM)`
  const liberado = (r: Referido) => r.estado === 'Cerró' && liberarPorFecha(r, hoy, reglas).liberado

  // Los presentados antes del inicio del programa no cuentan (no generan crédito): se informan aparte
  const elegibles = e.referidos.filter(r => !esAnteriorAlPrograma(r, reglas))
  const embudo = {
    presentados: elegibles.length,
    asistieron: elegibles.filter(r => asistio(r, reglas)).length,
    cerraron: elegibles.filter(r => r.estado === 'Cerró').length,
    liberados: elegibles.filter(liberado).length,
  }

  const porReferidor = new Map<string, Referido[]>()
  for (const r of elegibles) if (r.idReferidor) porReferidor.set(r.idReferidor, [...(porReferidor.get(r.idReferidor) ?? []), r])

  const ranking: FilaRanking[] = [...porReferidor.entries()].map(([id, refs]) => {
    const res = e.creditos.get(id)
    return {
      idCliente: id, nombre: nombreDe(id), enCrm: nombres.has(id),
      presentados: refs.length, asistieron: refs.filter(r => asistio(r, reglas)).length,
      cerraron: refs.filter(r => r.estado === 'Cerró').length, liberados: refs.filter(liberado).length,
      meses: res ? saldoCanjeable(res, reglas).meses : 0, nivel: res?.nivel ?? 0, renovacionGratis: res?.renovacionGratis ?? false,
      intentos: refs.filter(r => r.estado === reglas.intentos.estado).length, usd: res?.usd.disponible ?? 0,
    }
  }).sort((a, b) => b.liberados - a.liberados || b.cerraron - a.cerraron || b.asistieron - a.asistieron || b.presentados - a.presentados || a.nombre.localeCompare(b.nombre, 'es'))

  let otorgados = 0, disponibles = 0, porVencer = 0, usdDisponible = 0, usdPorVencerTotal = 0
  const cerca: CercaDelNivel[] = []
  for (const [id, res] of e.creditos) {
    otorgados += res.mesesGanados
    disponibles += saldoCanjeable(res, reglas).meses
    porVencer += mesesPorVencer(res, DIAS_AVISO_VENCIMIENTO, reglas)
    usdDisponible += res.usd.disponible
    usdPorVencerTotal += usdPorVencer(res, DIAS_AVISO_VENCIMIENTO)
    // Cerca del próximo nivel: ya tiene un cierre (liberado o por liberarse) y le falta uno o ninguno contando los pendientes
    if (!res.proximoNivel || res.nivel >= reglas.escalera.length) continue
    const pendientes = res.cierresPendientes.length
    const faltan = Math.max(0, res.proximoNivel.cierresFaltantes - pendientes)
    if (res.cierresLiberados + pendientes >= 1 && faltan <= 1)
      cerca.push({ idCliente: id, nombre: nombreDe(id), enCrm: nombres.has(id), nivel: res.nivel, cierresLiberados: res.cierresLiberados, cierresPendientes: pendientes, faltan, premio: res.proximoNivel.descripcion })
  }
  cerca.sort((a, b) => a.faltan - b.faltan || b.cierresPendientes - a.cierresPendientes || a.nombre.localeCompare(b.nombre, 'es'))

  const canjeados = e.movimientos.filter(m => m.tipo === 'canje' && m.meses < 0 && !esCanjeDeExtra(m)).reduce((s, m) => s - m.meses, 0)
  const usdCanjeado = e.movimientos.filter(m => m.tipo === 'canje').reduce((s, m) => s + (usdDeTexto(m.extra)?.usd ?? 0), 0)
  return {
    hoy,
    embudo,
    creditos: {
      otorgadosMeses: otorgados + canjeados, canjeadosMeses: canjeados, disponiblesMeses: disponibles,
      porVencerMeses: porVencer, usdDisponible, usdCanjeado, usdPorVencer: usdPorVencerTotal, diasAviso: DIAS_AVISO_VENCIMIENTO, valorMesUSD: reglas.valorMesUSD,
    },
    ranking: ranking.slice(0, FILAS_RANKING),
    cerca,
    referidoresActivos: porReferidor.size,
    intentos: elegibles.filter(r => r.estado === reglas.intentos.estado).length,
    anterioresAlPrograma: e.referidos.length - elegibles.length,
    programaDesde: reglas.vigenteDesde,
    kpi: kpiClientesNuevosPorReferido({ clientes: e.clientes, referidos: e.referidos, hoy, pestanaReferidosAusente: e.pestanasAusentes?.includes('Referidos') }, reglas),
  }
}

/** Beneficio extra de un nivel, en palabras. El extra del nivel 2 está resuelto (identidad de marca completa); su alcance, responsable y plazo no. */
const TEXTO_EXTRA: Record<ClaveExtra, string> = {
  identidad_marca_completa: 'Identidad de marca completa (alcance, responsable y plazo por definir)',
}
export const textoExtra = (extra: string): string => (Object.hasOwn(TEXTO_EXTRA, extra) ? TEXTO_EXTRA[extra as ClaveExtra] : extra)
