import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi } from '@/lib/auth/acceso'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Reporte de anuncios desde Meta. Con ?month=YYYY-MM TODO el payload cubre ese
// mes (gráfico diario, campañas y anuncios); sin parámetro: últimos 35 días de
// gráfico y últimos 7 días para tablas. Caché de módulo 10 min por período.

// retargeting = embudo propio (NO está dentro de vsl): se suma aparte
interface DailyRow { date: string; vsl: number; fm: number; webinar: number; uruguay: number; retargeting: number; otros: number }
interface CampaignRow { name: string; funnel: string; spend7d: number; spendMonth: number; active: boolean }
interface AdRow { name: string; funnel: string; spend7d: number; leadsMeta: number; cplMeta: number | null; active: boolean }
interface AdsPayload { daily: DailyRow[]; activeCampaigns: CampaignRow[]; ads: AdRow[]; isMonthView: boolean }

const cacheByKey: Record<string, { ts: number; data: AdsPayload }> = {}

// Misma regla que lib/rawSheets.ts (classifyCampaign) — mantener sincronizadas:
// 'retarget' → Retargeting (embudo PROPIO, separado del VSL; incluye "RETARGETING VSL FUNNEL");
// webinar = solo 'webinar'; 'Hammer Them' (pre-call de todos los embudos) → otros.
function classifyCampaign(name: string): 'vsl' | 'fm' | 'webinar' | 'uruguay' | 'retargeting' | 'otros' {
  const n = name.toLowerCase()
  if (n.includes('uruguay')) return 'uruguay'
  if (n.includes('retarget')) return 'retargeting'   // antes que vsl: el nombre también dice "vsl funnel"
  if (n.includes('webinar')) return 'webinar'
  if (n.includes('vsl')) return 'vsl'
  if (n.includes('fm')) return 'fm'
  if (n.includes('publicación de instagram') || n.includes('coment')) return 'fm'
  return 'otros'
}

const FUNNEL_LABEL: Record<string, string> = {
  vsl: 'VSL', fm: 'FM', webinar: 'Webinar', uruguay: 'Uruguay', retargeting: 'Retargeting', otros: 'Otros',
}

// Fechas como día calendario local 'YYYY-MM-DD' (nunca toISOString: corre el día según la zona)
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// Hoy en hora argentina, a medianoche (el server de Vercel corre en UTC: después de las 21 AR ya sería mañana)
const hoyArgentina = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  d.setHours(0, 0, 0, 0)
  return d
}

// Acceso: sesión de Google con rol que ve el Resumen, o Authorization: Bearer CRON_SECRET (lib/auth/rutas.ts).
// El proxy ya lo exige; se repite acá por si el proxy no corre.
export async function GET(request: Request) {
  await asegurarUsuarios()
  const denegado = exigirAccesoApi(request, 'resumen', { maquina: true })
  if (denegado) return denegado
  try {
    const token = process.env.META_ACCESS_TOKEN
    const acct = process.env.META_AD_ACCOUNT_ID
    if (!token || !acct) return NextResponse.json({ error: 'Meta no configurado' }, { status: 500 })

    const month = new URL(request.url).searchParams.get('month')
    const isMonthView = !!(month && /^\d{4}-\d{2}$/.test(month))
    const cacheKey = isMonthView ? month! : '7d'
    const cached = cacheByKey[cacheKey]
    if (cached && Date.now() - cached.ts < 10 * 60_000) return NextResponse.json(cached.data)

    const hoy = hoyArgentina()

    // Período de tablas (campañas y anuncios) + rango del gráfico diario
    let tablaSince: Date, tablaUntil: Date, chartSince: Date
    if (isMonthView) {
      const [y, m] = month!.split('-').map(Number)
      tablaSince = new Date(y, m - 1, 1)
      const finMes = new Date(y, m, 0)
      tablaUntil = finMes <= hoy ? finMes : hoy
      chartSince = tablaSince                      // el gráfico muestra ese mes
    } else {
      tablaUntil = hoy
      tablaSince = new Date(hoy); tablaSince.setDate(tablaSince.getDate() - 6)
      chartSince = new Date(hoy); chartSince.setDate(chartSince.getDate() - 34)
    }

    const trChart = encodeURIComponent(JSON.stringify({ since: ymd(chartSince), until: ymd(tablaUntil) }))
    const trTabla = encodeURIComponent(JSON.stringify({ since: ymd(tablaSince), until: ymd(tablaUntil) }))

    const insightsUrl =
      `https://graph.facebook.com/v23.0/act_${acct}/insights?level=campaign` +
      `&fields=campaign_name,spend&time_increment=1&time_range=${trChart}&limit=1000&access_token=${token}`
    const campaignsUrl =
      `https://graph.facebook.com/v23.0/act_${acct}/campaigns?fields=name,effective_status&limit=200&access_token=${token}`
    const adsUrl =
      `https://graph.facebook.com/v23.0/act_${acct}/insights?level=ad` +
      `&fields=ad_id,ad_name,campaign_name,spend,actions&time_range=${trTabla}&limit=500&access_token=${token}`
    // Estado (activo/apagado) de cada anuncio
    const adStatusUrl =
      `https://graph.facebook.com/v23.0/act_${acct}/ads?fields=id,effective_status&limit=1000&access_token=${token}`

    const [insightsRes, campaignsRes, adsRes, adStatusRes] = await Promise.all([
      fetch(insightsUrl), fetch(campaignsUrl), fetch(adsUrl), fetch(adStatusUrl),
    ])
    const insights = await insightsRes.json() as {
      error?: { message: string }
      data?: { campaign_name?: string; spend?: string; date_start?: string }[]
    }
    const campaigns = await campaignsRes.json() as {
      data?: { name?: string; effective_status?: string }[]
    }
    const adsJson = await adsRes.json() as {
      data?: { ad_id?: string; ad_name?: string; campaign_name?: string; spend?: string; actions?: { action_type: string; value: string }[] }[]
    }
    const adStatusJson = await adStatusRes.json() as {
      data?: { id?: string; effective_status?: string }[]
    }
    if (insights.error) return NextResponse.json({ error: insights.error.message }, { status: 500 })

    const activeAdIds = new Set(
      (adStatusJson.data ?? []).filter(a => a.effective_status === 'ACTIVE').map(a => a.id ?? '')
    )

    // Serie diaria del gráfico
    const byDate: Record<string, DailyRow> = {}
    for (let d = new Date(chartSince); d <= tablaUntil; d.setDate(d.getDate() + 1)) {
      byDate[ymd(d)] = { date: ymd(d), vsl: 0, fm: 0, webinar: 0, uruguay: 0, retargeting: 0, otros: 0 }
    }
    // Gasto por campaña dentro del período de tabla + mes calendario (vista 7d)
    const spendByCampaign: Record<string, { periodo: number; mes: number }> = {}
    const mesActual = ymd(hoy).slice(0, 7)

    for (const row of insights.data ?? []) {
      const date = row.date_start ?? ''
      const name = row.campaign_name ?? ''
      const spend = parseFloat(row.spend ?? '0') || 0
      const funnel = classifyCampaign(name)
      if (byDate[date]) byDate[date][funnel] += spend
      spendByCampaign[name] = spendByCampaign[name] ?? { periodo: 0, mes: 0 }
      if (date >= ymd(tablaSince) && date <= ymd(tablaUntil)) spendByCampaign[name].periodo += spend
      if (date.slice(0, 7) === mesActual) spendByCampaign[name].mes += spend
    }

    const activeNames = new Set(
      (campaigns.data ?? []).filter(c => c.effective_status === 'ACTIVE').map(c => c.name ?? '')
    )
    const activeCampaigns: CampaignRow[] = Object.entries(spendByCampaign)
      .filter(([name, s]) => (isMonthView ? s.periodo > 0 : (activeNames.has(name) || s.periodo > 0)))
      .map(([name, s]) => ({
        name,
        funnel: FUNNEL_LABEL[classifyCampaign(name)],
        spend7d: Math.round(s.periodo * 100) / 100,     // gasto del período de la tabla
        spendMonth: Math.round(s.mes * 100) / 100,      // mes calendario actual (solo vista 7d)
        active: activeNames.has(name),
      }))
      .sort((a, b) => b.spend7d - a.spend7d)

    const ads: AdRow[] = (adsJson.data ?? [])
      .map(r => {
        const spend = parseFloat(r.spend ?? '0') || 0
        const leads = parseInt((r.actions ?? []).find(a => a.action_type === 'lead')?.value ?? '0') || 0
        return {
          name: r.ad_name ?? '',
          funnel: FUNNEL_LABEL[classifyCampaign(r.campaign_name ?? '')],
          spend7d: Math.round(spend * 100) / 100,
          leadsMeta: leads,
          cplMeta: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
          active: activeAdIds.has(r.ad_id ?? ''),
        }
      })
      .filter(a => a.spend7d > 0)
      .sort((a, b) => b.spend7d - a.spend7d)
      .slice(0, 25)

    const data: AdsPayload = { daily: Object.values(byDate), activeCampaigns, ads, isMonthView }
    cacheByKey[cacheKey] = { ts: Date.now(), data }
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
