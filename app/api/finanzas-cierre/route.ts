import { NextResponse } from 'next/server'
import { leerDatosFinanzas, calcularMes, escribirEnGastos } from '@/lib/finanzas'
import { armarMensajeCierre, esVisperaDeFinDeMes, gastosConPlan, planAnunciosMeta, type PlanMeta } from '@/lib/finanzasCierre'
import { sendDiscord } from '@/lib/discord'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Automatización de fin de mes de Finanzas. Cron diario de Vercel (10:00 AR) que SOLO actúa cuando
// mañana (hora AR) es el último día del mes:
//   1) carga en Gastos el gasto de Meta del mes como estimado (sin duplicar; si ya hay anuncios reales, no carga);
//   2) manda el aviso de cierre a Tomi y Gero por Discord (DISCORD_WEBHOOK_FINANZAS, canal privado #finanzas).
// ?preview=1 → no escribe ni envía: devuelve lo que haría (también fuera del día de cierre).
// ?forzar=1  → corre aunque no sea el día. ?mes=YYYY-MM solo se acepta con preview.
// Protegido con CRON_SECRET (Vercel lo manda como Bearer; a mano: ?key=). Sin CRON_SECRET no corre:
// la respuesta tiene datos financieros y la ruta escribe en el sheet.
const URL_FINANZAS = 'https://dashboard-metricas-eight.vercel.app/finanzas'
const MENCIONES_POR_DEFECTO: string[] = []   // Tomi, Gero

function textoMeta(plan: PlanMeta, escrito: { ok: boolean; error?: string } | null): string {
  const fmt = (n: number) => `US$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (plan.accion === 'nada') return plan.motivo
  if (escrito && !escrito.ok) return `⚠️ no pude cargar el estimado de Meta (${fmt(plan.monto)}) en Gastos: ${escrito.error}. Cargarlo a mano o con lo cobrado en Relay.`
  if (plan.accion === 'agregar') return `cargué el estimado de Meta ${fmt(plan.monto)} en la fila ${plan.fila} ("ADS" con fecha ${plan.fecha.split('-').reverse().join('/')}, marcada como estimado). Reemplazar el monto con el Facebook cobrado en Relay y dejar el concepto "ADS".`
  return `actualicé el estimado de Meta de la fila ${plan.fila}: ${fmt(plan.montoAnterior)} → ${fmt(plan.monto)}. Reemplazarlo con el Facebook cobrado en Relay.`
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Falta CRON_SECRET: la automatización de finanzas no corre sin él' }, { status: 503 })
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}` && url.searchParams.get('key') !== secret)
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })

  const preview = !!url.searchParams.get('preview')
  const forzar = !!url.searchParams.get('forzar')
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const datos = await leerDatosFinanzas()
    const tocaHoy = esVisperaDeFinDeMes(datos.hoy)
    if (!tocaHoy && !forzar && !preview)
      return NextResponse.json({ ok: true, hoy: datos.hoy, tocaHoy, detalle: 'Mañana no es el último día del mes: no hago nada.' }, { headers })

    const mesParam = url.searchParams.get('mes')
    const mes = preview && mesParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesParam) ? mesParam : datos.hoy.slice(0, 7)

    // 1) Estimado de Meta en Gastos
    const plan = planAnunciosMeta(datos.hojas.gastos, mes, datos.hoy, datos.metaSpend[mes])
    let escrito: { ok: boolean; error?: string; rango?: string } | null = null
    if (!preview && plan.accion !== 'nada') {
      try {
        const r = plan.accion === 'agregar'
          ? await escribirEnGastos(plan.rango, [plan.valores], true)
          : await escribirEnGastos(plan.rango, [[plan.monto]])
        escrito = { ok: true, rango: r.rango }
      } catch (e) {
        const msg = (e as Error).message ?? 'error'
        escrito = { ok: false, error: /permission|403/i.test(msg) ? 'la cuenta de servicio no tiene permiso de edición en el sheet de Finanzas' : msg.slice(0, 160) }
        console.error('finanzas-cierre: no se pudo escribir en Gastos:', msg)
      }
    }
    // El mensaje se calcula con la fila ya cargada (en preview, simulada)
    const gastos = plan.accion !== 'nada' && (preview || escrito?.ok) ? gastosConPlan(datos.hojas.gastos, plan) : datos.hojas.gastos
    const f = calcularMes(datos, mes, gastos)

    // 2) Aviso a Discord
    const ids = (process.env.DISCORD_MENTION_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const mencion = (ids.length ? ids : MENCIONES_POR_DEFECTO).map(i => `<@${i}>`).join(' ')
    const partes = armarMensajeCierre(f, { mencion, resultadoMeta: textoMeta(plan, escrito), urlFinanzas: URL_FINANZAS, hoy: datos.hoy })
    const webhook = process.env.DISCORD_WEBHOOK_FINANZAS
    const base = { hoy: datos.hoy, mes, tocaHoy, forzado: forzar && !tocaHoy, planMeta: plan, metaMes: datos.metaSpend[mes] ?? null, avisos: f.avisos }

    if (preview)
      return NextResponse.json({ ...base, preview: true, escribiria: plan.accion !== 'nada', webhookConfigurado: !!webhook, mensaje: partes.join('\n\n') }, { headers })

    // Sin webhook propio NO se cae al canal general: el aviso tiene datos financieros
    const envio = webhook
      ? await sendDiscord(partes, webhook)
      : { enviado: false, mensajes: 0, error: 'Falta DISCORD_WEBHOOK_FINANZAS: el aviso no se envió (no se usa el canal general)' }
    const ok = envio.enviado && (escrito == null || escrito.ok)
    return NextResponse.json({ ...base, escrito, envio }, { status: ok ? 200 : 500, headers })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers })
  }
}
