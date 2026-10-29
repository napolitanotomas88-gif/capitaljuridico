// ── Backend: del CRM + Cobros + Acciones al tablero (reglas puras, sin red ni disco) ────────────────────────────
// La pantalla Backend se retiró el 10/10/2026. Hoy esto lo usa SOLO Clientes (lib/clientes/marcasBackend.ts), con cobros y
// acciones vacíos, para marcar "Renovación pendiente" y "Proyección pendiente". Las reglas de abajo describen cómo era.
// Reglas que decidió Tomás (8/10/2026):
//   · "Renovó" = NO en la planilla es el valor POR DEFECTO de casi todos los clientes (107 de 142). Antes de que venza el período
//     es "sin decisión", no "no renovó". Esta pantalla arma su propia verdad con los toques: una decisión es un toque
//     (Renovó / No renovó / Pausa), un período siguiente pagado en Renovaciones, o un estado FINALIZADO / INACTIVO.
//   · Tasa de renovación = renovaron con pago (esRenovacionPaga) ÷ (renovaron con pago + extensiones gratis + no renovaron),
//     sobre períodos terminados en la ventana. Las extensiones gratis NO suman como renovación. Se muestra cuántos están "sin decisión".
//   · Cada toque queda atado a un CICLO: la fecha de fin del período en ese momento (Referencia). Si el cliente renueva y el
//     fin se corre, los toques viejos dejan de contar para el ciclo nuevo.
import type { Cliente } from '../clientes/tipos'
import { diasEntre, sumarDias, type Ymd } from '../clientes/fechas'
import { esExtension, esRenovacionPaga } from '../clientes/renovaciones'
import type { AccionBackend, Cobro, Lista } from './modelo'

export const VENTANA_RENOVACION_DIAS = 45
export const VENTANA_PROYECCION_DIAS = 35
export const VENTANA_COBROS_DIAS = 30
export const VENTANA_TASA_DIAS = 90

export type EtapaRenovacion = 'por_contactar' | 'agendada' | 'propuesta' | 'renovo' | 'no_renovo' | 'pausa'
export const ETIQUETA_ETAPA: Record<EtapaRenovacion, string> = {
  por_contactar: 'Por contactar',
  agendada: 'Llamada de proyección agendada',
  propuesta: 'Propuesta enviada',
  renovo: 'Renovó',
  no_renovo: 'No renovó',
  pausa: 'Pausa',
}

export interface Toque { id: string; cuando: string; accion: string; dato: string; quien: string; lista: Lista | '' }

export interface ItemBase {
  idCliente: string
  nombre: string
  referencia: string          // ciclo (fin de período) o clave del cobro
  ultimoContactoDias: number | null   // días desde el último toque (cualquier lista) sobre este cliente; null = nunca
  historial: Toque[]          // toques de este ítem, del más nuevo al más viejo (sin los anulados)
  puedeDeshacer: boolean
}
export interface ItemRenovacion extends ItemBase {
  finPeriodo: Ymd
  dias: number                // negativo = ya venció
  etapa: EtapaRenovacion
  notaCrm: string
  closer: string
  contratoMeses: number | null
  periodoSiguiente: number    // número de período que tendría la renovación
}
export interface ItemCuota extends ItemBase {
  cobro: Cobro
  dias: number                // negativo = vencida hace tantos días
  vencida: boolean
}
export interface ItemProyeccion extends ItemBase {
  finPeriodo: Ymd
  dias: number
  estado: 'sin_enviar' | 'link_enviado' | 'agendada'
  fechaLlamada: string | null
  notaCrm: string
}

export interface Tablero {
  hoy: Ymd
  renovaciones: ItemRenovacion[]
  cuotas: { vencidas: ItemCuota[]; proximas: ItemCuota[]; todas: ItemCuota[]; totalVencido: number; totalProximos30: number; totalMes: number }
  proyecciones: ItemProyeccion[]
  embudo: Record<EtapaRenovacion, number>
  cifras: {
    tasaRenovacion: number | null       // 0..1
    renovaron: number; extensionesGratis: number; noRenovaron: number; sinDecision: number; conPausa: number
    saldoPorCobrar: number
    cobroBackendMes: number | null      // BECCU + BECCP del mes, de lib/rawSheets (null = no se pudo leer)
    ventanaTasaDias: number
  }
}

// ── Utilidades ──────────────────────────────────────────────────────────────────────────────
const SOLO_FECHA = (cuando: string): Ymd | null => (/^\d{4}-\d{2}-\d{2}/.test(cuando) ? cuando.slice(0, 10) : null)
const esActiva = (a: AccionBackend) => !a.anulada
const aToque = (a: AccionBackend): Toque => ({ id: a.id, cuando: a.cuando, accion: a.accion, dato: a.dato, quien: a.quien, lista: a.lista })
// Del más nuevo al más viejo: fecha y hora, y a igualdad la fila (las filas siempre crecen)
const masNuevoPrimero = (a: AccionBackend, b: AccionBackend) => (a.cuando === b.cuando ? b.fila - a.fila : a.cuando < b.cuando ? 1 : -1)

export function ultimoContacto(acciones: AccionBackend[], idCliente: string, hoy: Ymd): number | null {
  let mejor: Ymd | null = null
  for (const a of acciones) {
    if (!esActiva(a) || a.idCliente !== idCliente) continue
    const f = SOLO_FECHA(a.cuando)
    if (f && (!mejor || f > mejor)) mejor = f
  }
  return mejor ? Math.max(0, diasEntre(mejor, hoy)) : null
}

// ── Etapa de una renovación según los toques del ciclo ───────────────────────────────────────
export function etapaDeRenovacion(tocesDelCiclo: AccionBackend[]): EtapaRenovacion {
  const activos = tocesDelCiclo.filter(esActiva).sort(masNuevoPrimero)
  // La decisión más reciente manda (si se anotó "Renovó" y después "No renovó", vale la última; deshacer la saca)
  const decision = activos.find((a) => a.lista === 'renovaciones' && (a.accion === 'Renovó' || a.accion === 'No renovó' || a.accion === 'Pausa'))
  if (decision) return decision.accion === 'Renovó' ? 'renovo' : decision.accion === 'No renovó' ? 'no_renovo' : 'pausa'
  if (activos.some((a) => a.lista === 'renovaciones' && a.accion === 'Propuesta enviada')) return 'propuesta'
  if (activos.some((a) => a.lista === 'proyeccion' && (a.accion === 'Agendada' || a.accion === 'Hecha'))) return 'agendada'
  return 'por_contactar'
}

// ── Armado del tablero ───────────────────────────────────────────────────────────────────────
export interface EntradaTablero {
  hoy: Ymd
  clientes: Cliente[]
  cobros: Cobro[]
  acciones: AccionBackend[]
  cobroBackendMes?: number | null
}

export function armarTablero(e: EntradaTablero): Tablero {
  const { hoy } = e
  const porCliente = new Map<string, AccionBackend[]>()
  for (const a of e.acciones) {
    if (!a.idCliente) continue
    const l = porCliente.get(a.idCliente) ?? []
    l.push(a)
    porCliente.set(a.idCliente, l)
  }
  const nombres = new Map(e.clientes.filter((c) => c.id).map((c) => [c.id, c.nombre]))
  const nombreDe = (id: string) => nombres.get(id) ?? id

  const base = (idCliente: string, referencia: string, listas: Lista[]): ItemBase => {
    const delCliente = porCliente.get(idCliente) ?? []
    const deItem = delCliente.filter((a) => esActiva(a) && a.referencia === referencia && listas.includes(a.lista as Lista)).sort(masNuevoPrimero)
    return {
      idCliente, nombre: nombreDe(idCliente), referencia,
      ultimoContactoDias: ultimoContacto(delCliente, idCliente, hoy),
      historial: deItem.map(aToque),
      puedeDeshacer: deItem.length > 0,
    }
  }
  const delCiclo = (idCliente: string, ciclo: string) => (porCliente.get(idCliente) ?? []).filter((a) => a.referencia === ciclo && (a.lista === 'renovaciones' || a.lista === 'proyeccion'))

  const agencia = e.clientes.filter((c) => c.linea === 'agencia' && c.id && c.estado === 'ACTIVO' && c.finPeriodo)

  // ── Renovaciones: vencen dentro de la ventana o ya vencieron sin decisión ──
  const renovaciones: ItemRenovacion[] = []
  const embudo: Record<EtapaRenovacion, number> = { por_contactar: 0, agendada: 0, propuesta: 0, renovo: 0, no_renovo: 0, pausa: 0 }
  for (const c of agencia) {
    const fin = c.finPeriodo as Ymd
    const dias = diasEntre(hoy, fin)
    if (dias > VENTANA_RENOVACION_DIAS) continue
    const etapa = etapaDeRenovacion(delCiclo(c.id, fin))
    // Las decisiones cerradas hace más de 30 días ya no hacen ruido en el embudo
    if (dias < -30 && etapa !== 'por_contactar' && etapa !== 'agendada' && etapa !== 'propuesta') continue
    embudo[etapa]++
    if (etapa === 'renovo' || etapa === 'no_renovo' || etapa === 'pausa') continue   // ya resueltas: salen de la lista de trabajo
    const ultimo = Math.max(0, ...c.periodos.map((p) => p.periodo))
    renovaciones.push({
      ...base(c.id, fin, ['renovaciones', 'proyeccion']),
      finPeriodo: fin, dias, etapa, notaCrm: c.notasRenov, closer: c.closer,
      contratoMeses: c.periodos.find((p) => p.periodo === ultimo)?.meses ?? null,
      periodoSiguiente: ultimo + 1,
    })
  }
  // Más urgentes primero: los vencidos (más viejos arriba) y después los que vencen pronto
  renovaciones.sort((a, b) => a.dias - b.dias)

  // ── Llamadas de proyección: a ~35 días del fin y sin llamada hecha ──
  const proyecciones: ItemProyeccion[] = []
  for (const c of agencia) {
    const fin = c.finPeriodo as Ymd
    const dias = diasEntre(hoy, fin)
    if (dias > VENTANA_PROYECCION_DIAS || dias < -3) continue
    const toques = delCiclo(c.id, fin).filter((a) => esActiva(a) && a.lista === 'proyeccion').sort(masNuevoPrimero)
    if (toques.some((a) => a.accion === 'Hecha')) continue
    const etapa = etapaDeRenovacion(delCiclo(c.id, fin))
    if (etapa === 'renovo' || etapa === 'no_renovo' || etapa === 'pausa') continue
    const agendada = toques.find((a) => a.accion === 'Agendada')
    const link = toques.find((a) => a.accion === 'Link enviado')
    const fechaLlamada = agendada ? /\d{4}-\d{2}-\d{2}/.exec(agendada.dato)?.[0] ?? null : null
    proyecciones.push({
      ...base(c.id, fin, ['proyeccion']),
      finPeriodo: fin, dias, estado: agendada ? 'agendada' : link ? 'link_enviado' : 'sin_enviar', fechaLlamada,
      notaCrm: c.llamadaAgendada ?? '',
    })
  }
  proyecciones.sort((a, b) => a.dias - b.dias)

  // ── Cuotas a cobrar ──
  const pendientes = e.cobros.filter((c) => c.pagado !== 'Sí' && c.saldo > 0 && c.monto > 0 && c.vence)
  const aCuota = (cobro: Cobro): ItemCuota => {
    const dias = diasEntre(hoy, cobro.vence as Ymd)
    return { ...base(cobro.idCliente, cobro.clave, ['cuotas']), cobro, dias, vencida: dias < 0 }
  }
  const dentro = pendientes.filter((c) => diasEntre(hoy, c.vence as Ymd) <= VENTANA_COBROS_DIAS).map(aCuota).sort((a, b) => a.dias - b.dias)
  const vencidas = dentro.filter((i) => i.vencida)
  const proximas = dentro.filter((i) => !i.vencida)
  const suma = (l: { cobro: Cobro }[]) => Math.round(l.reduce((s, i) => s + i.cobro.saldo, 0) * 100) / 100
  const mes = hoy.slice(0, 7)
  const totalMes = Math.round(pendientes.filter((c) => (c.vence as Ymd).startsWith(mes)).reduce((s, c) => s + c.saldo, 0) * 100) / 100

  // ── Cifras: tasa de renovación ──
  const desde = sumarDias(hoy, -VENTANA_TASA_DIAS)
  let renovaron = 0, extensionesGratis = 0, noRenovaron = 0, sinDecision = 0, conPausa = 0
  for (const c of e.clientes) {
    if (c.linea !== 'agencia' || !c.id || c.esNoCliente) continue
    const periodos = [...c.periodos].sort((a, b) => a.periodo - b.periodo)
    const ultimo = periodos.length ? periodos[periodos.length - 1].periodo : -1
    for (const p of periodos) {
      const ciclo = p.periodo === ultimo ? (c.finPeriodo ?? p.fin) : p.fin
      if (!ciclo || ciclo > hoy || ciclo < desde) continue
      const siguiente = periodos.find((q) => q.periodo === p.periodo + 1)
      if (siguiente) {
        if (esRenovacionPaga(siguiente)) renovaron++
        else if (esExtension(siguiente.notas)) extensionesGratis++
        else noRenovaron++   // siguiente con precio 0 sin ser extensión: renovación cancelada
        continue
      }
      const etapa = etapaDeRenovacion(delCiclo(c.id, ciclo))
      if (etapa === 'renovo') renovaron++
      else if (etapa === 'no_renovo') noRenovaron++
      else if (etapa === 'pausa' || c.estado === 'PAUSADO') conPausa++
      else if (c.estado === 'FINALIZADO' || c.estado === 'INACTIVO') noRenovaron++
      else sinDecision++
    }
  }
  const decididos = renovaron + extensionesGratis + noRenovaron

  return {
    hoy,
    renovaciones,
    cuotas: { vencidas, proximas, todas: ordenarParaCobrar(pendientes.map(aCuota)), totalVencido: suma(vencidas), totalProximos30: suma(proximas), totalMes },
    proyecciones,
    embudo,
    cifras: {
      tasaRenovacion: decididos > 0 ? renovaron / decididos : null,
      renovaron, extensionesGratis, noRenovaron, sinDecision, conPausa,
      saldoPorCobrar: Math.round(pendientes.reduce((s, c) => s + c.saldo, 0) * 100) / 100,
      cobroBackendMes: e.cobroBackendMes ?? null,
      ventanaTasaDias: VENTANA_TASA_DIAS,
    },
  }
}

/** Próximo cobro de un cliente según Cobros (el vencimiento pendiente más cercano) y lo cobrado en total */
export function resumenDeCobrosDe(cobros: Cobro[], idCliente: string): { proximoCobro: Ymd | null; cobrado: number } {
  let proximo: Ymd | null = null
  let cobrado = 0
  for (const c of cobros) {
    if (c.idCliente !== idCliente) continue
    cobrado += c.montoPagado
    if (c.pagado !== 'Sí' && c.saldo > 0 && c.vence && (!proximo || c.vence < proximo)) proximo = c.vence
  }
  return { proximoCobro: proximo, cobrado: Math.round(cobrado * 100) / 100 }
}

// ── Cuotas en dos bloques (pedido de Tomás, 9/10/2026): primero "Backend" (Renovación, Extra o sin concepto) y debajo
// "Clientes nuevos" (Inicial). Una sola lista por bloque, sin corte de 30 días, con "los que estamos cerca de cobrar" arriba:
// primero los vencidos (el más cercano a hoy primero), después los de hoy y después los que vencen antes. A igual día, el monto más alto.
export function ordenarParaCobrar(items: ItemCuota[]): ItemCuota[] {
  const grupo = (i: ItemCuota) => (i.dias < 0 ? 0 : i.dias === 0 ? 1 : 2)
  return [...items].sort((a, b) => grupo(a) - grupo(b) || (grupo(a) === 0 ? b.dias - a.dias : a.dias - b.dias) || b.cobro.saldo - a.cobro.saldo)
}
export interface BloqueCuotas { clave: 'backend' | 'nuevos'; titulo: string; items: ItemCuota[]; total: number; vencido: number }
export const esCuotaInicial = (c: Cobro) => /^inicial$/i.test(c.concepto.trim())
export function bloquesDeCuotas(cuotas: Tablero['cuotas']): BloqueCuotas[] {
  const todas = cuotas.todas
  const suma = (l: ItemCuota[]) => Math.round(l.reduce((s, i) => s + i.cobro.saldo, 0) * 100) / 100
  const armar = (clave: BloqueCuotas['clave'], titulo: string, items: ItemCuota[]): BloqueCuotas =>
    ({ clave, titulo, items, total: suma(items), vencido: suma(items.filter(i => i.vencida)) })
  return [
    armar('backend', 'Backend: renovaciones y extras', todas.filter(i => !esCuotaInicial(i.cobro))),
    armar('nuevos', 'Clientes nuevos', todas.filter(i => esCuotaInicial(i.cobro))),
  ]
}
