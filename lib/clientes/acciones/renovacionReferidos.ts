import { createHash } from 'node:crypto'
import { parsearHojas } from '../parsear'
import { derivarClientes } from '../clasificar'
import { calcularCreditosDeDatos } from '../programa'
import { saldoCanjeable } from '../creditos'
import { MARCA_CANJE_SOLO_MESES } from '../canjeMeses'
import { huellaCanje, huellaPedidoCanje, type CanjeLimpio } from '../canje'
import { PESTANA_CREDITOS } from '../pestanasNuevas'
import { REGLAS_REFERIDOS } from '../reglasReferidos'
import { filasCanje } from '../filasCanje'
import { hoyArgentina, sumarMeses } from '../fechas'
import { normTxt, letraColumna } from '../texto'
import type { Fila, ResumenCredito } from '../tipos'
import type { PedidoReservaCanje, ReservaCanje } from '../reservasCanje'
import type { CuerpoRenovacion, RenovacionReferidos, ResultadoEscritura } from './tipos'
import type { LecturaAcciones, PlanillaAcciones } from './escritor'
import type { PlanExtra } from './planesNuevos'

export interface ContextoCreditosRenovacion {
  resumen: ResumenCredito | undefined
  creditos: Fila[]
  hoy: string
  primeraFilaLibre: number
  mayorIdNumero: number
}
const noEscritura = (mensaje: string, codigo = 'referidos_cambiaron'): never => { throw Object.assign(new Error(mensaje), { sinEscritura: true, codigo }) }

export async function leerCreditosRenovacion(id: string, l: LecturaAcciones, planilla: PlanillaAcciones, op: { hoy?: string } = {}): Promise<ContextoCreditosRenovacion> {
  if (l.ids.Referidos === undefined || l.ids['Créditos'] === undefined) noEscritura('No se pudieron confirmar las pestañas Referidos y Créditos; no se confirmó la renovación.', 'referidos_no_disponibles')
  const [[creditos], [referidos, valores]] = await Promise.all([
    planilla.leer(["'Créditos'!A1:K5000"]),
    planilla.leer(["'Referidos'!A1:Q5000", "'Créditos'!A1:K5000"], 'UNFORMATTED_VALUE'),
  ])
  if (creditos.length >= 5000 || referidos.length >= 5000) noEscritura('La lectura alcanzó su límite de filas; revisar antes de renovar.', 'referidos_no_disponibles')
  for (const [i, columna] of PESTANA_CREDITOS.columnas.entries()) if (normTxt(creditos[0]?.[i]) !== normTxt(columna.encabezado)) noEscritura('Los encabezados del libro Créditos cambiaron; revisar antes de renovar.', 'referidos_no_disponibles')
  const p = parsearHojas({ agencia: l.agencia, consultora: l.consultora ?? [], renovaciones: l.renovaciones, referidos, creditos: valores, config: null })
  const diagnostico = p.columnas.find(x => x.hoja === 'Referidos')
  if (!diagnostico || diagnostico.duplicadas.length || diagnostico.faltantes.some(x => ['id', 'idReferidor', 'estado', 'fechaPrimerPago', 'reembolso', 'fechaPedido', 'fechaLlamada'].includes(x))) noEscritura('No se pudo interpretar Referidos de forma inequívoca.', 'referidos_no_disponibles')
  const hoy = op.hoy ?? hoyArgentina()
  const resumen = calcularCreditosDeDatos({ clientes: derivarClientes(p.base, hoy), referidos: p.referidos, movimientos: p.movimientos, hoy }).get(id.toUpperCase())
  let ultima = 1, mayorIdNumero = 0
  for (const [i, f] of creditos.entries()) if (i && String(f[0] ?? '').trim()) { ultima = i + 1; mayorIdNumero = Math.max(mayorIdNumero, Number(/^M(\d+)$/i.exec(String(f[0]).trim())?.[1] ?? 0)) }
  return { resumen, creditos, hoy, primeraFilaLibre: ultima + 1, mayorIdNumero }
}

export function prepararRenovacionReferidos(id: string, cuerpo: CuerpoRenovacion, plan: PlanExtra, ctx: ContextoCreditosRenovacion, accionId: string, actor: string) {
  const saldo = ctx.resumen ? saldoCanjeable(ctx.resumen) : { meses: 0, usd: 0, renovacionGratis: false, extras: [] }
  if (!Number.isInteger(saldo.meses) || saldo.meses < 0) noEscritura('El saldo de meses requiere una revisión manual; no se consumió nada.')
  const finContrato = sumarMeses(cuerpo.inicio, cuerpo.meses), finServicio = sumarMeses(finContrato, saldo.meses)
  const huella = createHash('sha256').update(JSON.stringify([id.toUpperCase(), cuerpo.inicio, cuerpo.meses, cuerpo.precio, saldo.meses, saldo.usd, ctx.resumen?.cicloDesde ?? '', ctx.resumen?.cicloUsdDesde ?? '', REGLAS_REFERIDOS.version, ctx.hoy])).digest('hex')
  const meta: RenovacionReferidos = { mesesContratados: cuerpo.meses, mesesReferidos: saldo.meses, mesesTotales: cuerpo.meses + saldo.meses, finContrato, finServicio, usdPendiente: saldo.usd, huella }
  const renovacion = plan.renovacion!
  const ampliado: PlanExtra = { ...plan, renovacion: { ...renovacion, hasta: finServicio, meses: meta.mesesTotales, notas: `${renovacion.notas}${saldo.meses ? ` + ${saldo.meses} meses de referidos (canje automático)` : ''}` }, resumen: `Renovar ${cuerpo.meses} meses${saldo.meses ? ` + ${saldo.meses} de referidos` : ''} hasta ${finServicio}`, plan: [...plan.plan, { hoja: 'Renovaciones · fila nueva', celda: 'Meses contratados / referidos / total', antes: '', despues: `${cuerpo.meses} / ${saldo.meses} / ${meta.mesesTotales}` }, { hoja: 'Renovaciones · fila nueva', celda: 'Fin contratado / fin del servicio', antes: '', despues: `${finContrato} / ${finServicio}` }, { hoja: 'Créditos', celda: 'Meses a canjear / USD conservados', antes: `${saldo.meses} meses`, despues: `${saldo.meses} meses a la renovación; USD ${saldo.usd} sin consumir` }] }
  const canje: CanjeLimpio = { idCliente: id.toUpperCase(), renovacionAplicada: `Renovación ${accionId}`, fecha: ctx.hoy, contexto: 'renovacion', claveEnvio: `renovacion-${accionId}` }
  const pedido: PedidoReservaCanje | undefined = saldo.meses ? { actor, clave: canje.claveEnvio, huellaPedido: huellaPedidoCanje(canje, actor), huella: huellaCanje(canje, { meses: saldo.meses, usd: 0, renovacionGratis: saldo.renovacionGratis, extras: saldo.extras }, REGLAS_REFERIDOS.version, ctx.resumen?.cicloDesde ?? null, actor), cliente: id.toUpperCase(), cicloClave: ctx.resumen?.cicloDesde ?? '', meses: saldo.meses, usd: 0, extra: MARCA_CANJE_SOLO_MESES, pisoFila: ctx.primeraFilaLibre, pisoIdNumero: ctx.mayorIdNumero } : undefined
  return { meta, plan: ampliado, pedido, canje }
}

export function agregarCanjeCongelado(resultado: ResultadoEscritura, ctx: ContextoCreditosRenovacion, reserva: ReservaCanje | undefined, canje: CanjeLimpio, actor: string, meta: RenovacionReferidos): ResultadoEscritura {
  if (!meta.mesesReferidos) return { ...resultado, renovacionReferidos: meta }
  if (!reserva) return noEscritura('No se obtuvo una reserva durable para los meses revisados.')
  if (reserva.meses !== meta.mesesReferidos || reserva.usd !== 0 || reserva.extra !== MARCA_CANJE_SOLO_MESES) noEscritura('La reserva del canje no coincide con los meses revisados.')
  const fila = ctx.creditos[reserva.fila - 1] ?? []
  const bloques = filasCanje(reserva, canje, actor)
  const valores = [...bloques.bloqueAG.map((valor, i) => ({ valor, columna: i })), ...bloques.bloqueIK.map((valor, i) => ({ valor, columna: i + 8 }))]
  const celdas = valores.map(({ valor, columna }) => {
    const antes = fila[columna] ?? null
    if (antes !== null && antes !== '') noEscritura('La fila reservada de Créditos contiene datos o fórmulas; no se pisan.')
    return { range: `'Créditos'!${letraColumna(columna)}${reserva.fila}`, antes, despues: valor }
  })
  return { ...resultado, celdas: [...resultado.celdas, ...celdas], canje: reserva, renovacionReferidos: meta }
}
