// ── Textos de Discord del tablero de anuncios (canal DISCORD_WEBHOOK_ANUNCIOS) ───────────────
//   · reporteSemanal(): lunes 8:30 AR. Resumen por cliente: rojos y por qué, aumentos de CPL de la
//     semana vs. la anterior, errores de pago, saldos por agotarse, sin guiones y estado del token.
//   · alertaDiaria(): 8:45 AR. SOLO si hay algo: rojos NUEVOS (de rendimiento, comparando con la
//     evaluación de ayer), errores de pago, saldo para 3 días o menos, gasto sin mensajes o token
//     por vencer (10 días o menos). Si todo está bien devuelve [] y no se manda nada.
// Cada sección queda por debajo de 1.900 caracteres (sendDiscord junta secciones por mensaje).
import { AVISO_TOKEN_DIAS, textoToken, type EstadoToken } from './token'
import { dm, fmtMonto, fmtPct, fmtGasto, sumarDias } from './formato'
import type { FilaAnuncio, Tablero } from './tablero'
import { MOTIVOS_RENDIMIENTO } from './reglas'
import { nombreDia } from './feriados'
import type { DiaMeta } from './diasMalos'
import type { Recuento } from './recuento'

// "jueves 24/9: al 70% de las cuentas (14 de 20) le subió el CPL, suba mediana +45%"
const lineaDiaMalo = (x: DiaMeta) =>
  `${nombreDia(x.d)} ${dm(x.d)}: al ${Math.round(x.parte * 100)}% de las cuentas (${x.suben} de ${x.cuentas}) le subió el CPL, suba mediana ${fmtPct(x.mediana - 1)}`

export const URL_TABLERO = 'https://dashboard-metricas-eight.vercel.app/anuncios'
const TZ = 'America/Argentina/Buenos_Aires'
const fechaLarga = (d: Date) => d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })

const nombre = (f: FilaAnuncio) => {
  const c = f.cliente.trim(), k = f.cuenta.trim()
  return c.toLowerCase() === k.toLowerCase() ? `**${c}**` : `**${c}** (${k})`
}

// Arma una o más secciones con título; corta en varias si supera ~1.800 caracteres
function secciones(titulo: string, lineas: string[]): string[] {
  if (!lineas.length) return []
  const out: string[] = []
  let actual = titulo
  for (const l of lineas) {
    if ((actual + '\n' + l).length > 1800) { out.push(actual); actual = `${titulo} (sigue)` }
    actual += '\n' + l
  }
  out.push(actual)
  return out
}

// Todo en USD (ARS con el dólar MEP venta, otras monedas con su cotización del día)
const usd = (f: FilaAnuncio, v: number | null) => (f.usdPor && v != null ? fmtMonto(v / f.usdPor, 'USD') : fmtMonto(v, f.moneda))
const usdGasto = (f: FilaAnuncio, v: number) => (f.usdPor ? fmtGasto(v / f.usdPor, 'USD') : fmtGasto(v, f.moneda))

const motivosTxt = (f: FilaAnuncio, n = 3) => f.motivos.slice(0, n).map(m => m.texto).join(' · ')

function lineaPago(f: FilaAnuncio): string {
  const uso = f.corriendo.frenadaHace == null ? `gastó ${usdGasto(f, f.gasto.d7)} en 7 días` : f.corriendo.sinGastoEnVentana ? 'sin gasto en 5 semanas' : `frenada hace ${f.corriendo.frenadaHace} días`
  return `• ${nombre(f)} — ${f.pago.texto}${f.pago.medio ? ` (${f.pago.medio})` : ''} · ${uso}`
}

function lineaToken(token: EstadoToken | null): string {
  if (!token) return '• No se pudo consultar el token'
  return `• ${textoToken(token)}${token.aviso ? `\n• ${token.aviso}` : ''}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// mes: recuento del mes en curso (del 1 a ayer), opcional
export function reporteSemanal(t: Tablero, ahora: Date = new Date(), mes: Recuento | null = null): string[] {
  const r = t.resumen
  const desde = sumarDias(t.hoy, -7), hasta = sumarDias(t.hoy, -1)
  const partes: string[] = [
    `**REPORTE SEMANAL DE ANUNCIOS — ${fechaLarga(ahora)}**\n` +
    `Semana del ${dm(desde)} al ${dm(hasta)} vs. la anterior · ${r.total} cuentas de clientes: **${r.errores} con error** · **${r.rojos} en rojo** · ${r.amarillos} en amarillo · ${r.verdes} en verde · ${r.sinGasto} sin gasto\n` +
    `${r.erroresPago} con error de pago · ${r.saldosPorAgotarse} por quedarse sin saldo · ${r.sinMensajes} gastando sin mensajes · ${r.enAumento} subiendo 3+ días · ${r.aGrabar} con guiones a grabar · ${r.sinGuionesNecesarios} sin guiones que se necesitan`,
  ]
  partes.push(...seccionGrabar(t.filas))
  const lanzSemana = t.filas.flatMap(f => f.lanzamientos.filter(l => !l.etapa && l.dia <= 7).map(l => lineaLanzamiento(f, l)))
  partes.push(...secciones(`**LANZAMIENTOS DE LA SEMANA (${lanzSemana.length})**`, lanzSemana))
  const rojos = t.filas.filter(f => f.semaforo === 'rojo')
  partes.push(...secciones(`**EN ROJO (${rojos.length})**`, rojos.map(f => `• ${nombre(f)} — ${motivosTxt(f)}`)))

  // Aumentos de la semana: CPL 7 días vs. 7 anteriores, +20% o más con gasto razonable en ambas
  const aumentos = t.filas
    .filter(f => f.cpl.variacion7 != null && f.cpl.variacion7 >= 0.2 && f.mensajes.d7prev >= 5 && f.mensajes.d7 > 0)
    .sort((a, b) => (b.cpl.variacion7 ?? 0) - (a.cpl.variacion7 ?? 0))
  partes.push(...secciones(`**AUMENTOS DE CPL — semana vs. la anterior (${aumentos.length})**`,
    aumentos.map(f => `• ${nombre(f)} — ${usd(f, f.cpl.d7prev)} → ${usd(f, f.cpl.d7)} (${fmtPct(f.cpl.variacion7)})`)))
  if (!aumentos.length) partes.push('**AUMENTOS DE CPL — semana vs. la anterior**\n• Ninguna cuenta subió 20% o más')

  const malosSemana = t.diasMeta.filter(x => x.malo && x.d >= desde && x.d <= hasta)
  partes.push(`**DÍAS MALOS DE META en la semana (${malosSemana.length})**\n` + (malosSemana.length
    ? malosSemana.map(x => `• ${lineaDiaMalo(x)}`).join('\n') + '\n_Esos días no cuentan para las alertas: fue Meta, no los guiones._'
    : '• Ninguno: las subas de la semana son de cada cuenta')
    + (mes ? `\n• En ${MESES[+mes.desde.slice(5, 7) - 1]} (al ${dm(mes.hasta)}): **${mes.malos}** día${mes.malos === 1 ? '' : 's'} malo${mes.malos === 1 ? '' : 's'}${mes.malos ? ` (${mes.dias.filter(x => x.malo).map(x => `${nombreDia(x.d).slice(0, 3)} ${dm(x.d)}`).join(', ')})` : ''}` +
      (mes.malos && mes.totales.cplUSDMalos != null && mes.totales.cplUSDNormales ? ` · esos días el CPL general fue ${fmtPct(mes.totales.cplUSDMalos / mes.totales.cplUSDNormales - 1)} vs. el resto` : '') : ''))

  const pagos = t.filas.filter(f => f.pago.errorPago || (f.pago.sinMedioPago && f.corriendo.frenadaHace == null))
  partes.push(...secciones(`**ERRORES DE PAGO (${pagos.length})**`, pagos.map(lineaPago)))

  const saldo = t.filas.filter(f => f.motivos.some(m => m.tipo === 'saldo' || m.tipo === 'saldo_bajo'))
  partes.push(...secciones(`**SALDOS POR AGOTARSE (${saldo.length})**`, saldo.map(f => `• ${nombre(f)} — ${f.motivos.find(m => m.tipo === 'saldo' || m.tipo === 'saldo_bajo')!.texto}`)))

  const sinGuiones = t.filas.filter(f => f.aGrabar && f.guiones.estado === 'sin_guiones')
  partes.push(...secciones(`**SIN GUIONES QUE SE NECESITAN — hay que hacerlos (${sinGuiones.length})**`, sinGuiones.map(f => `• ${nombre(f)} — ${f.guiones.detalle}`)))

  const amarillos = t.filas.filter(f => f.semaforo === 'amarillo')
  partes.push(...secciones(`**EN AMARILLO (${amarillos.length})**`, amarillos.map(f => `• ${nombre(f)} — ${motivosTxt(f, 2)}`)))
  const verdes = t.filas.filter(f => f.semaforo === 'verde')
  const repetidos = new Set(verdes.map(f => f.cliente).filter((c, i, xs) => xs.indexOf(c) !== i))
  if (verdes.length) partes.push(...secciones(`**EN VERDE (${verdes.length})**`, [verdes.map(f => repetidos.has(f.cliente) ? `${f.cliente} (${f.cuenta})` : f.cliente).join(' · ')]))

  partes.push(`**TOKEN DE META**\n${lineaToken(t.token)}`)
  if (t.avisos.length) partes.push(`**AVISOS DEL TABLERO**\n${t.avisos.map(a => `• ${a}`).join('\n')}`.slice(0, 1800))
  partes.push(`Tablero: ${URL_TABLERO}`)
  return partes
}

// Guiones a grabar: se queman (5+ días hábiles seguidos más caros) o no rinden (CPL alto 2 semanas)
function seccionGrabar(filas: FilaAnuncio[], titulo = 'GUIONES A GRABAR'): string[] {
  const xs = filas.filter(f => f.aGrabar)
  return secciones(`**${titulo} (${xs.length})**`, xs.map(f =>
    `• ${nombre(f)} — ${f.aGrabar === 'quema' ? f.aumento?.texto ?? '' : f.motivos.find(m => m.tipo === 'no_rinde')?.texto ?? ''} · guiones: ${f.guiones.estado === 'sin_guiones' ? 'NO TIENE' : f.guiones.estado === 'pendiente' ? 'listos, falta grabar' : f.guiones.estado === 'grabado' ? 'ya grabados' : 'en pausa'}`))
}

// Campañas con anuncios nuevos: línea con lo que llevan desde el lanzamiento
function lineaLanzamiento(f: FilaAnuncio, l: FilaAnuncio['lanzamientos'][number]): string {
  const gasto = l.gasto == null ? '' : ` · ${usdGasto(f, l.gasto)} · ${l.mensajes} msj · CPL ${l.cplUSD != null ? fmtMonto(l.cplUSD, 'USD') : 'sin mensajes'} (normal ≤ ${fmtMonto(f.rama?.umbral.ok ?? 2.8, 'USD')})`
  return `• ${nombre(f)} — ${l.campana} · lanzada el ${dm(l.fecha)} (día ${l.dia})${gasto}`
}

export function alertaDiaria(t: Tablero, ahora: Date = new Date()): string[] {
  const nuevos = t.filas.filter(f => f.motivos.some(m => m.color === 'rojo' && MOTIVOS_RENDIMIENTO.includes(m.tipo) && !f.previo.rendimiento.includes(m.tipo)))
  const pagos = t.filas.filter(f => f.pago.errorPago && !f.pausado)
  const saldo = t.filas.filter(f => f.motivos.some(m => m.tipo === 'saldo'))
  const sinMensajes = t.filas.filter(f => f.motivos.some(m => m.tipo === 'sin_mensajes') && !nuevos.includes(f))
  const tokenUrgente = !!t.token && (t.token.nivel !== 'ok' || (t.token.principal?.diasRestantes != null && t.token.principal.diasRestantes <= AVISO_TOKEN_DIAS))
  const ayerMalo = t.diasMeta.find(x => x.d === sumarDias(t.hoy, -1) && x.malo) ?? null
  const nuevosGrabar = t.filas.some(f => f.aGrabar && !f.previo.aGrabar)
  const dia4 = t.filas.flatMap(f => f.lanzamientos.filter(l => l.pendienteRevision).map(l => lineaLanzamiento(f, l)))
  if (!nuevos.length && !pagos.length && !saldo.length && !sinMensajes.length && !tokenUrgente && !ayerMalo && !nuevosGrabar && !dia4.length) return []

  const partes: string[] = [`**ALERTA DE ANUNCIOS — ${fechaLarga(ahora)}**\n${t.resumen.errores} con error · ${t.resumen.rojos} en rojo · ${t.resumen.amarillos} en amarillo · ${t.resumen.verdes} en verde · ${t.resumen.sinGasto} sin gasto`]
  if (ayerMalo) partes.push(`**AYER FUE UN DÍA MALO DE META**\n• ${lineaDiaMalo(ayerMalo)}\n• Es general, no de una cuenta: no tocar guiones ni campañas por ayer. No cuenta para las alertas; si mañana sigue caro, ahí sí.`)
  partes.push(...secciones(`**REVISIÓN DE DÍA 4 — hoy (${dia4.length})**`, dia4))
  partes.push(...seccionGrabar(t.filas.filter(f => f.aGrabar && !f.previo.aGrabar), 'NUEVOS PARA GRABAR'))
  partes.push(...secciones(`**NUEVOS EN ROJO (${nuevos.length})**`, nuevos.map(f => `• ${nombre(f)} — ${motivosTxt(f, 2)}`)))
  partes.push(...secciones(`**SE QUEDAN SIN SALDO (${saldo.length})**`, saldo.map(f => `• ${nombre(f)} — ${f.motivos.find(m => m.tipo === 'saldo')!.texto}`)))
  partes.push(...secciones(`**GASTAN SIN MENSAJES (${sinMensajes.length})**`, sinMensajes.map(f => `• ${nombre(f)} — ${f.motivos.find(m => m.tipo === 'sin_mensajes')!.texto}`)))
  partes.push(...secciones(`**ERRORES DE PAGO (${pagos.length})**`, pagos.map(lineaPago)))
  if (tokenUrgente) partes.push(`**TOKEN DE META**\n${lineaToken(t.token)}`)
  partes.push(`Tablero: ${URL_TABLERO}`)
  return partes
}

// ── Reporte semanal en PDF: un mensaje con el resumen, menciones y el PDF adjunto ──
export const MENCIONES_REPORTE = { tomas: process.env.DISCORD_ID_TOMAS?.trim() ?? '', gero: process.env.DISCORD_ID_GERO_M?.trim() ?? '' }

export async function enviarPDFDiscord(webhook: string, t: Tablero, pdf: Uint8Array, nombreArchivo: string): Promise<{ enviado: boolean; error?: string }> {
  const r = t.resumen
  const desde = sumarDias(t.hoy, -7), hasta = sumarDias(t.hoy, -1)
  const menciones = Object.values(MENCIONES_REPORTE).filter(id => /^\d{15,22}$/.test(id));
  const contenido = `${menciones.map(id => `<@${id}>`).join(' ')} **Reporte semanal de anuncios** — semana del ${dm(desde)} al ${dm(hasta)}\n` +
    `${r.errores} con error · ${r.rojos} en rojo · ${r.amarillos} en amarillo · ${r.verdes} en verde · ${r.sinGasto} sin gasto · ${r.enAumento} en aumento · ${r.aGrabar} con guiones a grabar · ${r.lanzadas} con campañas nuevas\n` +
    `Tablero: ${URL_TABLERO}`
  const form = new FormData()
  form.append('payload_json', JSON.stringify({ content: contenido, allowed_mentions: { users: menciones } }))
  form.append('files[0]', new Blob([pdf as BlobPart], { type: 'application/pdf' }), nombreArchivo)
  const res = await fetch(webhook, { method: 'POST', body: form })
  return res.ok ? { enviado: true } : { enviado: false, error: `Discord respondió ${res.status}: ${(await res.text()).slice(0, 200)}` }
}
