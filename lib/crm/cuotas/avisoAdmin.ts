// ── Aviso diario de las cuotas que cobra ADMINISTRACIÓN (12/11/2026, pedido de Tomás) ───────────────────────────────────
// Todos los días a las 10:00 (Argentina) GET /api/cuotas/aviso-admin junta, SOLO de los planes con responsable 'admin' y no
// abandonados (las de 'closer-N' las cobra cada closer y no se avisan), las cuotas con saldo que:
//   · vencen hoy,
//   · vencen en los próximos 2 días (aviso previo),
//   · están vencidas sin pagar (con los días de atraso).
// La fecha que manda es la de tarea() del modelo: la del pago coordinado (promesa) si hay, si no el vencimiento. Así una
// promesa vigente corre el aviso (no se reclama antes de la fecha coordinada). La fila «Pagado» y las cuotas saldadas no
// cuentan (tarea() devuelve null).
// Sale UN mensaje por día en #🛠️-operaciones (clave cuotas_admin:<día>, deduplicada en cj_alertas_discord) mencionando a
// Tomás, con una línea por cuota y el link a /cuotas. Además, por cada cuota que vence hoy o está atrasada, queda un texto
// listo para pegarle al cliente en /clientes/para-enviar (pieza k01, cj_canal_mensajes) con su «Enviado»: clave por cuota,
// estado y fecha, así no se repite mientras siga igual.
// Encendido con AVISO_CUOTAS_ADMIN=encendido (apagado por defecto). ?dry=1 devuelve lo que avisaría sin escribir ni mandar.
// Todo entra por DepsAvisoCuotas: las pruebas usan dependencias de juguete (scripts/test-aviso-cuotas-admin.mjs).
import type { Alerta, ResultadoAlerta } from '@/lib/alertas/alerta'
import type { MensajeCliente } from '@/lib/bot/canal/tipos'
import { dolares, fechaCorta, hoyBA, numeroDeCuota, porCobrar, tarea, type Plan } from './modelo'

type Entorno = Record<string, string | undefined>
export const avisoCuotasAdminEncendido = (env: Entorno = process.env): boolean => env.AVISO_CUOTAS_ADMIN?.trim().toLowerCase() === 'encendido'

/** Días de aviso previo (vence en 1 o 2 días). */
export const DIAS_PREVIO = 2
/** Líneas por mensaje de Discord (el resto se resume en «y N más»). */
export const MAX_LINEAS_DISCORD = 14
export const RESPONSABLE_ADMIN = 'admin'
/** Lugar para las líneas dentro de las 1.900 letras del mensaje (el resto es encabezado, menciones y links). */
export const MAX_CARACTERES_LINEAS = 1_450

export type EstadoCuotaAviso = 'atrasada' | 'hoy' | 'previo'
export interface CuotaAviso {
  planId: string
  cuotaId: string
  cliente: string
  concepto: 'venta' | 'renovacion'
  numero: number
  /** Lo que falta cobrar (centavos). */
  saldo: number
  /** Importe de la cuota (centavos). */
  importe: number
  vencimiento: string
  /** Fecha que manda: el pago coordinado (promesa) si hay, si no el vencimiento. */
  fecha: string
  coordinado: boolean
  estado: EstadoCuotaAviso
  /** Días hasta la fecha (previo) o de atraso (atrasada); 0 si vence hoy. */
  dias: number
}

const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)

/** Las cuotas de Administración para avisar hoy: atrasadas (más días primero), las de hoy y las del aviso previo. */
export function cuotasParaAvisar(planes: readonly Plan[], ahora = new Date()): CuotaAviso[] {
  const hoy = hoyBA(ahora)
  const out: CuotaAviso[] = []
  for (const p of planes) {
    if (!p || p.responsable !== RESPONSABLE_ADMIN || p.abandonado || !Array.isArray(p.cuotas)) continue
    for (const c of p.cuotas) {
      // tarea() descarta la fila «Pagado» y las cuotas saldadas; porCobrar() es el saldo real
      if (!tarea(c, ahora) || porCobrar(c) <= 0) continue
      const fecha = c.promesa || c.vencimiento
      const d = diasEntre(hoy, fecha)
      if (d > DIAS_PREVIO) continue
      const estado: EstadoCuotaAviso = d < 0 ? 'atrasada' : d === 0 ? 'hoy' : 'previo'
      out.push({
        planId: p.id, cuotaId: c.id, cliente: p.nombre, concepto: p.concepto, numero: numeroDeCuota(p, c), saldo: porCobrar(c), importe: c.centavos,
        vencimiento: c.vencimiento, fecha, coordinado: !!c.promesa, estado, dias: Math.abs(d),
      })
    }
  }
  const orden: Record<EstadoCuotaAviso, number> = { atrasada: 0, hoy: 1, previo: 2 }
  return out.sort((a, b) => orden[a.estado] - orden[b.estado] || (a.estado === 'atrasada' ? b.dias - a.dias : a.dias - b.dias) || a.cliente.localeCompare(b.cliente))
}

export const etiquetaConcepto = (c: CuotaAviso['concepto']) => (c === 'renovacion' ? 'Renovación' : 'Venta')
export function etiquetaEstado(x: Pick<CuotaAviso, 'estado' | 'dias'>): string {
  if (x.estado === 'hoy') return 'vence hoy'
  if (x.estado === 'previo') return `vence en ${x.dias} ${x.dias === 1 ? 'día' : 'días'}`
  return `atrasada ${x.dias} ${x.dias === 1 ? 'día' : 'días'}`
}
const montoDe = (x: CuotaAviso) => (x.saldo < x.importe ? `${dolares(x.saldo)} (saldo de ${dolares(x.importe)})` : dolares(x.saldo))

/** Una línea del aviso de Discord. */
export function lineaCuota(x: CuotaAviso): string {
  const fecha = x.coordinado ? `pago coordinado ${fechaCorta(x.fecha)} (vencía ${fechaCorta(x.vencimiento)})` : `vence ${fechaCorta(x.vencimiento)}`
  const nombre = x.cliente.replace(/\s+/g, ' ').trim().slice(0, 60)
  return `${x.estado === 'atrasada' ? '🔴' : x.estado === 'hoy' ? '🟠' : '🟡'} ${nombre} · ${etiquetaConcepto(x.concepto)} · cuota ${x.numero} · ${montoDe(x)} · ${fecha} · **${etiquetaEstado(x)}**`
}

/** ¿Lleva texto para pegarle al cliente? Solo lo que vence hoy o está atrasado (el aviso previo es interno). */
export const llevaTexto = (x: CuotaAviso) => x.estado !== 'previo'

/** Texto para pegarle al cliente: formal, con voseo y corto. */
export function textoCliente(x: CuotaAviso): string {
  const plan = x.concepto === 'renovacion' ? 'la renovación del programa' : 'tu plan de pago'
  const monto = dolares(x.saldo)
  if (x.estado === 'hoy')
    return [
      'Hola, ¿cómo estás?',
      `Te recordamos que hoy vence la cuota ${x.numero} de ${plan}, por ${monto}.`,
      'Cuando realices el pago, envianos el comprobante por acá. ¡Muchas gracias!',
    ].join('\n')
  return [
    'Hola, ¿cómo estás?',
    `Te escribimos porque la cuota ${x.numero} de ${plan}, por ${monto}, con vencimiento el ${fechaCorta(x.fecha)}, figura pendiente de pago.`,
    '¿Podrías regularizarla en estos días? Si ya la abonaste, envianos el comprobante por acá y lo registramos. ¡Muchas gracias!',
  ].join('\n')
}

/** Clave del «para enviar» (sin el prefijo de la pieza): la misma cuota, en el mismo estado y fecha, nunca dos veces. */
export const claveTexto = (x: CuotaAviso) => `${x.cuotaId}:${x.estado}:${x.fecha}`
/** Clave de la alerta de Discord: un mensaje por día. */
export const claveAlerta = (hoy: string) => `cuotas_admin:${hoy}`

/** El mensaje del día (plantilla de alertas: {@tomas} y {link}). */
export function plantillaDiscord(items: readonly CuotaAviso[], hoy: string, linkParaEnviar: string | null): string {
  const n = (e: EstadoCuotaAviso) => items.filter((x) => x.estado === e).length
  const resumen = [n('atrasada') && `${n('atrasada')} atrasada${n('atrasada') === 1 ? '' : 's'}`, n('hoy') && `${n('hoy')} vence${n('hoy') === 1 ? '' : 'n'} hoy`, n('previo') && `${n('previo')} por vencer`].filter(Boolean).join(' · ')
  // Discord corta en 2.000 caracteres (las alertas, en 1.900): las líneas entran mientras haya lugar
  const lineas: string[] = []
  for (const x of items) {
    const l = lineaCuota(x)
    if (lineas.length >= MAX_LINEAS_DISCORD || lineas.join('\n').length + l.length > MAX_CARACTERES_LINEAS) break
    lineas.push(l)
  }
  if (items.length > lineas.length) lineas.push(`… y ${items.length - lineas.length} más en el tablero.`)
  const conTexto = items.filter(llevaTexto).length
  return [
    `{@tomas} {@gero_m} 💳 **Cuotas que cobra Administración · ${fechaCorta(hoy)}** (${resumen})`,
    ...lineas,
    conTexto ? `📤 ${conTexto === 1 ? 'El texto para el cliente está listo' : `Los ${conTexto} textos para los clientes están listos`} para pegar${linkParaEnviar ? `: <${linkParaEnviar}>` : ' en Para enviar'} (marcá «Enviado» al mandarlo).` : '',
    '➡️ <{link}>',
  ].filter(Boolean).join('\n')
}

export interface DepsAvisoCuotas {
  ahora: () => Date
  planes(): Promise<Plan[]>
  /** Registra el texto «para enviar». id = fila nueva; null = ya estaba. */
  registrar(m: MensajeCliente & { claveCompleta: string }): Promise<number | null>
  alertar(a: Alerta): Promise<ResultadoAlerta>
  /** Base del Despacho (https://…) para el link a /clientes/para-enviar. */
  base: string
}

export interface ResultadoAvisoCuotas {
  fecha: string
  dry: boolean
  total: number
  porEstado: Record<EstadoCuotaAviso, number>
  cuotas: (CuotaAviso & { texto?: string; paraEnviar?: 'nuevo' | 'ya_estaba' | 'error' })[]
  alerta?: string
  mensaje?: string
}

export const PIEZA_CUOTA = 'k01' as const

/** La corrida del día. En dry no escribe ni manda nada. */
export async function correrAvisoCuotasAdmin(d: DepsAvisoCuotas, op: { dry?: boolean } = {}): Promise<ResultadoAvisoCuotas> {
  const ahora = d.ahora()
  const hoy = hoyBA(ahora)
  const dry = !!op.dry
  const items = cuotasParaAvisar(await d.planes(), ahora)
  const porEstado = { atrasada: 0, hoy: 0, previo: 0 } as Record<EstadoCuotaAviso, number>
  for (const x of items) porEstado[x.estado]++
  const r: ResultadoAvisoCuotas = { fecha: hoy, dry, total: items.length, porEstado, cuotas: items.map((x) => ({ ...x, ...(llevaTexto(x) ? { texto: textoCliente(x) } : {}) })) }
  if (!items.length) return r
  const linkPE = `${d.base.replace(/\/+$/, '')}/clientes/para-enviar`
  r.mensaje = plantillaDiscord(items, hoy, linkPE)
  if (dry) return r
  for (const c of r.cuotas) {
    if (!c.texto) continue
    try {
      const id = await d.registrar({
        pieza: PIEZA_CUOTA, idCrm: null, cliente: c.cliente, clave: claveTexto(c), claveCompleta: `${PIEZA_CUOTA}:${claveTexto(c)}`, texto: c.texto,
        abrir: '/cuotas', datos: { origen: 'cuotas_admin', plan: c.planId, cuota: c.cuotaId, estado: c.estado, fecha: c.fecha },
      })
      c.paraEnviar = id === null ? 'ya_estaba' : 'nuevo'
    } catch { c.paraEnviar = 'error' }
  }
  const a = await d.alertar({ canal: 'operaciones', tipo: 'cuotas_admin', clave: claveAlerta(hoy), titulo: 'Cuotas que cobra Administración', plantilla: r.mensaje, link: '/cuotas', menciones: ['tomas', 'gero_m'] })
  r.alerta = a.estado
  return r
}
