'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { GoalBar } from '@/components/GoalBar'
import { CuotasCard } from '@/components/CuotasCard'
import { DateFilter, DateRange, buildDateRange } from '@/components/DateFilter'
import { PersonFilter } from '@/components/PersonFilter'
import { MonthPicker } from '@/components/MonthPicker'
import { CashChart } from '@/components/CashChart'
import { CallsChart } from '@/components/CallsChart'
import { RevenuePieChart } from '@/components/RevenuePieChart'
import { SalesFunnel } from '@/components/SalesFunnel'
import { LeadQualityCard } from '@/components/LeadQualityCard'
import { KpiBoard } from '@/components/KpiBoard'
import { AdsReport, AdsDaily, AdsCampaign, AdsAd } from '@/components/AdsReport'
import { AnalystPanel } from '@/components/AnalystPanel'
import { LeadSourceChart, type EmbudoPago } from '@/components/LeadSourceChart'
import { fmtMoneda, gastosCompletos, baseOcurridas, pct, primerosPagosFeccu } from '@/components/tablero'
import type { RawSerializada } from '@/lib/serializeRaw'
import { LOGIN_VUELTA_AL_RESUMEN, leerJsonDeDatos } from '@/lib/auth/datosResumen'

// Forma JSON de /api/raw (fechas de transacciones y llamadas como "YYYY-MM-DD")
type RawData = RawSerializada
type RawCall = RawData['calls'][number]
// Canal de la llamada como texto: 'retargeting' es un embudo propio (col H/I de la hoja del closer
// con 'retarget' o anuncio 'RTG'); se compara como string para no depender de la versión del tipo Canal.
const canalDe = (c: { channel: string }) => c.channel as string
// Embudo atribuido del pago (lo manda el server; un /api/raw viejo no lo trae)
const embudoDe = (t: object): EmbudoPago | null => (t as { embudo?: EmbudoPago | null }).embudo ?? null
// Campos nuevos del server (ronda post-auditoría). Opcionales: si el JSON todavía no los trae,
// la página sigue funcionando con el comportamiento anterior.
type RawExtra = Partial<{
  monthlyGastosCompletos: (boolean | null)[]   // false = al ER del mes le faltan gastos
  // Retargeting = embudo propio (NO está dentro de monthlyAdsVSL / monthlyVSL / monthlyFeccuVSL)
  monthlyAdsRetargeting: number[]              // gasto en campañas 'retarget' (Meta API)
  monthlyRetargeting: number[]                 // agendas del canal retargeting
  monthlyFeccuRetargeting: number[]            // FECCU atribuido al embudo retargeting
  monthlyFeccuCacRetargeting: (number | null)[] // FECCU retargeting ÷ ads retargeting (null si ads < $300)
  monthlySinRegistro: number[]                 // agendas ocurridas sin registro por mes
  igTasaFuente: string                         // "calibrada con agosto (0.86%)"
  monthlyCierresSoloFee: number[]              // cierres descartados por mes (pagaron solo el fee, < $400)
}>
// noClientes: FINALIZADO/INACTIVO con < $400 cobrados (solo fee) → fuera de todas las métricas de clientes
type CrmExtra = Partial<{ pausados: number; bajasSinFecha: number; noClientes: number; noClientesNombres: string[] }>
type RawConExtra = RawData & RawExtra

// /api/metrics: solo cuotas y el cash del mes (lectura defensiva: campos opcionales)
type MetricsResp = Partial<{
  monthlyRevenue: number | null
  cuotasTotal: number | null       // J4 + M4 (compatibilidad; antes era solo J4)
  cuotasPendiente: number | null   // 'Cuotas a Cobrar'!J4 (suma col E)
  cuotasCobradas: number | null    // 'Cuotas a Cobrar'!M4 (suma col F)
  cuotasNoPaga: number | null      // J17 (parte del pendiente marcada "No Paga")
  lastUpdated: string
}>

interface AdsData { daily: AdsDaily[]; activeCampaigns: AdsCampaign[]; ads: AdsAd[] }

// Refresco cada 2 min y solo con la pestaña visible: /api/raw hace ~25 lecturas de Sheets
// y la service account tiene 60/min (con 30 s y 2 pestañas se pasaba de cuota → métricas en 0)
const REFRESH = 120_000
const MONTHLY_GOAL = 100_000

// Sesión vencida (las rutas de datos responden 401): al login, y al entrar vuelve al Resumen. Toda lectura de datos pasa por leerJsonDeDatos
const irAlLogin = () => window.location.assign(LOGIN_VUELTA_AL_RESUMEN)

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// Parsear "YYYY-MM-DD" como medianoche LOCAL (new Date("YYYY-MM-DD") asume UTC
// y corre la fecha un día atrás en zonas horarias negativas como Argentina)
function parseLocalDay(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + 'T00:00:00')
}

function inRange(dateStr: string, range: DateRange): boolean {
  if (!range.from && !range.to) return true
  const d = parseLocalDay(dateStr)
  if (range.from && d < range.from) return false
  if (range.to   && d > range.to)   return false
  return true
}

function fmt(v: number | null, f: 'currency' | 'number' | 'percent' | 'ratio') {
  if (v === null) return '—'
  if (f === 'currency') return fmtMoneda(v)
  if (f === 'percent')  return `${v.toFixed(1)}%`
  if (f === 'ratio')    return `${v.toFixed(2)}x`
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export default function Dashboard() {
  // Render solo en el cliente: el HTML del server (fecha en UTC, tema, datos vivos)
  // nunca coincide con el del navegador y generaba errores de hidratación (#418/#31)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [monthly, setMonthly] = useState<MetricsResp | null>(null)
  const [raw, setRaw] = useState<RawData | null>(null)
  const [ads, setAds] = useState<AdsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  // Con el shell en la estética del CRM (marfil) el Resumen arranca en claro; el botón deja pasar al oscuro
  const [darkMode, setDarkMode] = useState(false)
  // El tema también va en <html>: el body toma el fondo del tema (sin franja clara al hacer overscroll).
  // Al salir del Resumen se quita: las otras secciones del shell tienen su propia marca y no deben heredarlo.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    return () => document.documentElement.removeAttribute('data-theme')
  }, [darkMode])
  // El PDF siempre sale en claro: si se está viendo en oscuro, se pasa a claro, se imprime y se vuelve
  const descargarPdf = () => {
    if (!darkMode) return window.print()
    setDarkMode(false)
    setTimeout(() => { window.print(); setDarkMode(true) }, 450)
  }

  const [dateRange, setDateRange] = useState<DateRange>(buildDateRange('month'))
  const [person, setPerson] = useState('')

  const currentMonthIdx = useMemo(() => new Date().getMonth(), [])
  const [viewMonthIdx, setViewMonthIdx] = useState<number | null>(currentMonthIdx)

  const handleDateRangeChange = useCallback((r: DateRange) => {
    setDateRange(r)
    if (r.quick === 'month') {
      setViewMonthIdx(currentMonthIdx)
    } else {
      setViewMonthIdx(null)
    }
  }, [currentMonthIdx])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [m, r] = await Promise.all([
        fetch('/api/metrics', { cache: 'no-store' }).then(r => leerJsonDeDatos(r, irAlLogin)),
        fetch('/api/raw',     { cache: 'no-store' }).then(r => leerJsonDeDatos(r, irAlLogin)),
      ])
      // Si una API responde con error ({ error }) se conservan los datos anteriores:
      // pisar el estado con un objeto sin transacciones rompía toda la página
      if (m && !m.error) setMonthly(m)
      if (r && !r.error && Array.isArray(r.transactions)) setRaw(r)
      setLastUpdated(new Date().toISOString())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    // Arrastrar para actualizar (celular): vuelve a pedir los datos sin recargar la página
    const alActualizar = (e: Event) => { e.preventDefault(); fetchAll() }
    window.addEventListener('cj:actualizar', alActualizar)
    fetchAll()
    let ultimo = Date.now()
    const refrescar = () => {
      if (document.visibilityState !== 'visible') return   // pestaña oculta: no gastar cuota de Sheets
      ultimo = Date.now()
      fetchAll()
    }
    const iv = setInterval(refrescar, REFRESH)
    // Al volver a la pestaña: refrescar si los datos tienen más de 1 min
    const alVolver = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultimo > 60_000) refrescar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('cj:actualizar', alActualizar) }
  }, [fetchAll])

  // Anuncios: la tabla sigue al mes seleccionado (sin mes → últimos 7 días)
  const adsMonthParam = dateRange.quick === 'month'
    ? `?month=2026-${String((viewMonthIdx ?? currentMonthIdx) + 1).padStart(2, '0')}`
    : ''
  // Evita pedir dos veces lo mismo al cargar: el efecto corre al montar y otra vez cuando termina fetchAll (lastUpdated)
  const ultimaAds = useRef({ param: '', ts: 0 })
  useEffect(() => {
    if (ultimaAds.current.param === adsMonthParam && Date.now() - ultimaAds.current.ts < 30_000) return
    ultimaAds.current = { param: adsMonthParam, ts: Date.now() }
    fetch('/api/ads' + adsMonthParam, { cache: 'no-store' })
      .then(r => leerJsonDeDatos(r, irAlLogin))
      .then(a => { if (a && !a.error) setAds(a) })
      .catch(() => {})
  }, [adsMonthParam, lastUpdated])

  // Month label for column-M matching (e.g. "2026-mayo")
  const activeMonthLabel = useMemo(() => {
    const idx = viewMonthIdx ?? currentMonthIdx
    return `${new Date().getFullYear()}-${MESES[idx]}`
  }, [viewMonthIdx, currentMonthIdx])

  // Active month index (used for monthly aggregates)
  const activeMonthIdx = viewMonthIdx ?? currentMonthIdx

  // ── TRANSACCIONES filtradas por mes o rango de fechas ──────────────
  const filteredTx = useMemo(() => {
    if (!raw) return []
    if (dateRange.quick === 'month') {
      return raw.transactions.filter(t =>
        t.month === activeMonthLabel && (person === '' || t.closer === person)
      )
    }
    return raw.transactions.filter(t =>
      inRange(t.date, dateRange) && (person === '' || t.closer === person)
    )
  }, [raw, dateRange, person, activeMonthLabel])

  // ── LLAMADAS del período activo, filtradas por persona ────────────
  // Modo "mes": llamadas del mes seleccionado. Otros modos: por rango de fechas.
  const periodCalls = useMemo(() => {
    if (!raw) return []
    const byPerson = (c: RawCall) => person === '' || c.closer === person
    if (dateRange.quick === 'month') {
      return raw.calls.filter(c => parseLocalDay(c.date).getMonth() === activeMonthIdx && byPerson(c))
    }
    return raw.calls.filter(c => inRange(c.date, dateRange) && byPerson(c))
  }, [raw, dateRange, person, activeMonthIdx])

  // ── MÉTRICAS DE CASH ───────────────────────────────────────────────
  const rawCashCollected = filteredTx.reduce((s, t) => s + t.amount, 0)

  const cashCollected = useMemo(() => {
    // Con filtro de persona: sumar sus transacciones (los totales del ER son de todos)
    if (dateRange.quick !== 'month' || person !== '' || !raw) return rawCashCollected
    // Cualquier mes (también el en curso): fila "Cash Collected" del ER (raw.monthlyCash).
    // Antes el mes en curso salía de /api/metrics, que calculaba el mes en UTC y el último día
    // del mes desde las 21:00 AR leía la columna del mes siguiente ($0).
    if (raw.monthlyCash[activeMonthIdx] > 0) return raw.monthlyCash[activeMonthIdx]
    return rawCashCollected
  }, [dateRange.quick, person, raw, activeMonthIdx, rawCashCollected])

  // Categorías del Registro de Pagos (derivadas de cols N "Tipos de venta" + O "Tipo de pago"):
  // FECCU / FECCP = front-end upfront / plan de pagos · BECC = BECCU + BECCP (back-end).
  // La categorización ahora es completa → FECCU es la suma directa (antes se derivaba
  // como cash − FECCP − BECC porque la col P venía vacía).
  const esBECC = (c: string) => c === 'BECCU' || c === 'BECCP'
  const feccp = filteredTx.filter(t => t.category === 'FECCP').reduce((s, t) => s + t.amount, 0)
  const becc  = filteredTx.filter(t => esBECC(t.category)).reduce((s, t) => s + t.amount, 0)
  const feccu = filteredTx.filter(t => t.category === 'FECCU').reduce((s, t) => s + t.amount, 0)

  // ── MÉTRICAS DE LLAMADAS (agendadas/calif/pres/cerradas + canales) ──
  // Modo "mes": agregados mensuales (autoritativos). Otros rangos: contar las
  // llamadas individuales filtradas por fecha (Hoy/Ayer/7d/30d/Todo).
  const isMonth = dateRange.quick === 'month'
  // Agregados mensuales solo cuando NO hay filtro de persona (son totales de todos).
  // Con persona seleccionada, contamos sus llamadas individuales (periodCalls).
  const useAgg = isMonth && person === ''
  const llamadasAg    = useAgg ? (raw?.monthlyAgendadas[activeMonthIdx]   ?? 0) : periodCalls.length
  const unidadesCerr  = useAgg ? (raw?.monthlyCerradas[activeMonthIdx]    ?? 0) : periodCalls.filter(c => c.closed).length
  const llamadasPres  = useAgg ? (raw?.monthlyPresentadas[activeMonthIdx] ?? 0) : periodCalls.filter(c => c.presented).length
  const llamadasCalif = useAgg ? (raw?.monthlyCalificadas[activeMonthIdx] ?? 0) : periodCalls.filter(c => c.qualified).length
  // Cierres descartados por "solo fee" (< $400 cobrados y no es cliente activo). Lectura defensiva.
  const cierresSoloFee = useAgg
    ? ((raw as RawConExtra | null)?.monthlyCierresSoloFee?.[activeMonthIdx] ?? 0)
    : periodCalls.filter(c => (c as { soloFee?: boolean }).soloFee).length

  // Agendas por canal de origen (para el embudo y la tabla de leads)
  const rx = raw as RawConExtra | null
  const agVSL   = useAgg ? (raw?.monthlyVSL[activeMonthIdx]          ?? 0) : periodCalls.filter(c => c.channel === 'vsl').length
  const agIG    = useAgg ? (raw?.monthlyIG[activeMonthIdx]           ?? 0) : periodCalls.filter(c => c.channel === 'ig').length
  // Retargeting: embudo propio (fuera del VSL). Agregado del server si viene; si no, se cuentan las llamadas
  const agRetargetingCalls = periodCalls.filter(c => canalDe(c) === 'retargeting').length
  const agRetargeting = useAgg ? (rx?.monthlyRetargeting?.[activeMonthIdx] ?? agRetargetingCalls) : agRetargetingCalls
  const agUruguay  = periodCalls.filter(c => c.channel === 'uruguay').length
  const agWebinar  = periodCalls.filter(c => c.channel === 'webinar').length
  const agWsp      = periodCalls.filter(c => c.channel === 'wsp').length
  const agReferido = periodCalls.filter(c => c.channel === 'referido').length
  const agOtras = useAgg ? (raw?.monthlyOtrasFuentes[activeMonthIdx] ?? 0) : agUruguay + agWebinar + agWsp + agReferido

  // Denominador de tasas: solo llamadas que YA ocurrieron (una agenda para mañana no puede
  // haberse presentado todavía) Y con "¿Se presentó?" registrado: las ocurridas sin registro
  // no se sabe si se presentaron → se descuentan (y se avisa "N sin registrar").
  const { sinRegistro: agSinRegistro, base: agBaseTasas } = baseOcurridas(periodCalls)
  const showUpRate = pct(llamadasPres, agBaseTasas)   // null si no hay ocurridas registradas
  const tasaCierre = pct(unidadesCerr, agBaseTasas)
  const subSinRegistro = agSinRegistro > 0 ? ` · ${agSinRegistro} sin registrar` : ''

  // ── LEADS CRUDOS (solo en modo mes y sin filtro de persona:
  //    las visitas GA4/ManyChat son globales, no por closer) ──────────
  const showLeads = isMonth && person === ''
  const leadsVSL = showLeads ? (raw?.monthlyLeadsVSL[activeMonthIdx] ?? null) : null
  const leadsIGRaw = showLeads ? (raw?.monthlyLeadsIG[activeMonthIdx] ?? 0) : 0
  const leadsIG = leadsIGRaw > 0 ? leadsIGRaw : null   // 0 = aún sin datos cargados
  // Costo por lead VSL = gasto VSL ÷ visitas GA4 (el retargeting es otro embudo: no entra)
  const adsVSLMes = showLeads ? (raw?.monthlyAdsVSL[activeMonthIdx] ?? 0) : 0
  const costoPorLeadVSL = leadsVSL && leadsVSL > 0 && adsVSLMes > 0 ? adsVSLMes / leadsVSL : null

  // ── Tablero rápido: no-shows y tasa de agenda sobre leads totales ──
  const noShows = periodCalls.filter(c => c.noShow).length
  // Tasa de agenda = agendas de los embudos con leads medidos (VSL + IG) ÷ (leads VSL + IG).
  // Retargeting/referidos/enrutamiento/webinar/Uruguay no tienen leads en el denominador → fuera del numerador.
  // Solo si AMBOS canales de leads tienen dato: con uno solo se sobreestima.
  const tasaAgendaBoard = leadsVSL != null && leadsIG != null && leadsVSL + leadsIG > 0
    ? ((agVSL + agIG) / (leadsVSL + leadsIG)) * 100 : null

  // AOV TC = promedio de "Cash Collected Trato Cerrado" (hoja del closer) por trato del período
  const { aovTC, dealsTC } = useMemo(() => {
    const conTC = periodCalls.filter(c => c.cashTC > 0)
    const total = conTC.reduce((s, c) => s + c.cashTC, 0)
    return { aovTC: conTC.length > 0 ? total / conTC.length : null, dealsTC: conTC.length }
  }, [periodCalls])

  // ── EMBUDO POR CANAL (Todos / VSL / IG) — usa periodCalls (fecha+persona) ──
  const funnelByChannel = useMemo(() => {
    const build = (calls: typeof periodCalls, leads: number | null, feccuCacCh: number | null) => ({
      leads,
      feccuCac: feccuCacCh,
      agendadas:   calls.length,
      ocurridas:   calls.filter(c => c.occurred).length,
      sinRegistro: calls.filter(c => c.occurred && c.sinRegistro).length,
      calificadas: calls.filter(c => c.qualified).length,
      presentadas: calls.filter(c => c.presented).length,
      cerradas:    calls.filter(c => c.closed).length,
    })
    const totalLeads = leadsVSL != null || leadsIG != null ? (leadsVSL ?? 0) + (leadsIG ?? 0) : null
    // FECCU:CAC por embudo solo tiene sentido a nivel mes y sin filtro de persona
    const fcOk = isMonth && person === ''
    return {
      todos: build(periodCalls, totalLeads, fcOk ? (raw?.monthlyFeccuCac[activeMonthIdx] ?? null) : null),
      vsl:   build(periodCalls.filter(c => c.channel === 'vsl'), leadsVSL, fcOk ? (raw?.monthlyFeccuCacVSL[activeMonthIdx] ?? null) : null),
      // Retargeting: sin leads propios (leads = null)
      retargeting: build(periodCalls.filter(c => canalDe(c) === 'retargeting'), null, fcOk ? (rx?.monthlyFeccuCacRetargeting?.[activeMonthIdx] ?? null) : null),
      ig:    build(periodCalls.filter(c => c.channel === 'ig'), leadsIG, fcOk ? (raw?.monthlyFeccuCacFM[activeMonthIdx] ?? null) : null),
      uruguay:  build(periodCalls.filter(c => c.channel === 'uruguay'), null, fcOk ? (raw?.monthlyFeccuCacUruguay[activeMonthIdx] ?? null) : null),
      webinar:  build(periodCalls.filter(c => c.channel === 'webinar'), null, fcOk ? (raw?.monthlyFeccuCacWebinar[activeMonthIdx] ?? null) : null),
      wsp:      build(periodCalls.filter(c => c.channel === 'wsp'), null, null),
      referido: build(periodCalls.filter(c => c.channel === 'referido'), null, null),
    }
  }, [periodCalls, leadsVSL, leadsIG, isMonth, person, raw, rx, activeMonthIdx])

  // ── CALIDAD DE LEADS (Lead Scoring A–E) — usa periodCalls (respeta mes/rango + persona) ──
  const leadQuality = useMemo(() => {
    const init = () => ({ agendas: 0, cierres: 0, cash: 0 })
    const stats: Record<'A' | 'B' | 'C' | 'D' | 'E', { agendas: number; cierres: number; cash: number }> = {
      A: init(), B: init(), C: init(), D: init(), E: init(),
    }
    let sinClasificar = 0
    for (const c of periodCalls) {
      if (!c.letra) { sinClasificar++; continue }
      stats[c.letra].agendas++
      if (c.closed) stats[c.letra].cierres++
      stats[c.letra].cash += c.cash
    }
    return { stats, sinClasificar }
  }, [periodCalls])

  const QUICK_LABELS: Record<string, string> = {
    all: 'todo el histórico', today: 'hoy', yesterday: 'ayer',
    '7d': 'últimos 7 días', '30d': 'últimos 30 días', custom: 'rango custom',
  }
  const leadQualityPeriodLabel = isMonth
    ? MESES[activeMonthIdx].charAt(0).toUpperCase() + MESES[activeMonthIdx].slice(1)
    : (QUICK_LABELS[dateRange.quick] ?? '')

  // ── REPORTE DE ANUNCIOS: agendas por día + CPA + CPS ───────────────
  const agendasPorDia = useMemo(() => {
    const map: Record<string, { vsl: number; ig: number; retargeting: number }> = {}
    if (!raw) return map
    for (const c of raw.calls) {
      const k = c.date.slice(0, 10)
      map[k] = map[k] ?? { vsl: 0, ig: 0, retargeting: 0 }
      if (c.channel === 'vsl') map[k].vsl++
      else if (c.channel === 'ig') map[k].ig++
      else if (canalDe(c) === 'retargeting') map[k].retargeting++
    }
    return map
  }, [raw])

  // CPA VSL = ads VSL ÷ agendas VSL del mes (ambos sin retargeting)
  const cpaVSL = raw && raw.monthlyAdsVSL[activeMonthIdx] > 0 && raw.monthlyVSL[activeMonthIdx] > 0
    ? raw.monthlyAdsVSL[activeMonthIdx] / raw.monthlyVSL[activeMonthIdx] : null
  // CPA Retargeting = ads retargeting ÷ agendas retargeting del mes (siempre del mes, sin filtro de persona)
  const adsRetargetingMes = rx?.monthlyAdsRetargeting?.[activeMonthIdx] ?? null
  const agRetargetingMes = rx?.monthlyRetargeting?.[activeMonthIdx]
    ?? (raw?.calls.filter(c => canalDe(c) === 'retargeting' && parseLocalDay(c.date).getMonth() === activeMonthIdx).length ?? 0)
  const cpaRetargeting = adsRetargetingMes != null && adsRetargetingMes > 0 && agRetargetingMes > 0
    ? adsRetargetingMes / agRetargetingMes : null
  // CPL Instagram (CPR de IG): gasto FM ÷ seguimientos cargados (pestaña Seguidores IG).
  // Durante el mes los seguimientos no están cargados → el server manda el estimado de Meta
  // (gasto FM ÷ visitas al perfil × tasa de seguimiento) y marca el mes como estimado.
  const cplIG = raw?.monthlyCPLInstagram?.[activeMonthIdx] ?? null
  const cplIGEstimado = raw?.monthlyCPLInstagramEstimado?.[activeMonthIdx] ?? false
  const seguidoresMes = raw?.monthlySeguidoresIG[activeMonthIdx] ?? 0

  // ── NFCF automático por mes (calculado desde Estado de Resultados) ──
  // Si al ER del mes le faltan gastos (monthlyGastosCompletos = false) los números que dependen
  // de todos los gastos no son confiables → "—" con aviso (el server ya los manda en null; acá
  // se fuerza igual por si el JSON es anterior). Cash Out se muestra, marcado como parcial.
  const gastosOk   = gastosCompletos(rx, activeMonthIdx)
  const subFaltanGastos = `faltan gastos del ER de ${MESES[activeMonthIdx]}`
  const nfcf       = gastosOk ? (raw?.monthlyNFCF[activeMonthIdx] ?? null) : null
  const feccuCac   = raw?.monthlyFeccuCac[activeMonthIdx] ?? null
  const feccuCacBlended = gastosOk ? (raw?.monthlyFeccuCacBlended[activeMonthIdx] ?? null) : null
  const cac        = gastosOk ? (raw?.monthlyCAC[activeMonthIdx] ?? null) : null
  const cacAds     = raw?.monthlyCACAds[activeMonthIdx]   ?? null
  const margenNFCF = gastosOk ? (raw?.monthlyMargen[activeMonthIdx] ?? null) : null
  const cashOut    = raw?.monthlyCashOut[activeMonthIdx]  ?? null
  const subCashOut = gastosOk ? 'Gastos Totales (ER)' : 'parcial · faltan gastos'
  const adsMesTotal = raw?.monthlyAds[activeMonthIdx] ?? 0
  // Ratios con gasto < $300 vienen en null del server (muestra chica)
  const subMuestraChica = (valor: number | null, gasto: number, normal: string) =>
    valor == null && gasto > 0 && gasto < 300 ? 'gasto < $300: muestra chica' : normal
  // Con filtro de persona estos grupos siguen siendo de toda la empresa → se rotulan
  const sufEmpresa = person !== '' ? ' · total empresa' : ''

  const closerNames = raw?.closerNames ?? []
  const hasData = raw !== null

  // ── OPERATIVO · BACKEND del mes seleccionado ───────────────────────
  // Sigue al mes elegido: ClickUp en vivo solo en el mes en curso; en meses pasados usa
  // la ÚLTIMA foto diaria del cron dentro de ese mes (pestaña "Historial operativo").
  // Backend mensual (activos/bajas/churn/LTV acumulado/LTGP:CAC) sale de backend.mensual.
  const esMesEnCurso = activeMonthIdx === currentMonthIdx
  const operativo = useMemo(() => {
    if (!raw) return null
    const m = activeMonthIdx
    const mes = MESES[m]
    const en = <T,>(arr: T[] | undefined): T | null => arr?.[m] ?? null
    const cu = raw.clickup

    // ClickUp: foto del mes (pasado) o estado de hoy
    const prefijo = `${new Date().getFullYear()}-${String(m + 1).padStart(2, '0')}-`
    const fotosMes = (raw.historialOperativo ?? [])
      .filter(f => f.fecha.startsWith(prefijo))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    const foto = !esMesEnCurso && fotosMes.length ? fotosMes[fotosMes.length - 1] : null
    const dm = (ymd: string) => `${Number(ymd.slice(8, 10))}/${Number(ymd.slice(5, 7))}`
    const dmFoto = foto ? dm(foto.fecha) : ''
    // Mes pasado sin foto: "—" (antes mostraba los valores de HOY, que nunca cambiaban de mes)
    const primeraFoto = (raw.historialOperativo ?? []).map(f => f.fecha).sort()[0] ?? null
    const sinFoto = !esMesEnCurso && !foto
    const clickup = foto
      ? { disponible: true, sinFoto: false, rojo: foto.rojo, amarillo: foto.amarillo, verde: foto.verde, pausa: foto.pausa,
          produccion: foto.produccion, finalizados: foto.finalizados, conNombres: false, fuente: `foto del ${dmFoto}` }
      : sinFoto
        ? { disponible: false, sinFoto: true, rojo: 0, amarillo: 0, verde: 0, pausa: 0, produccion: 0, finalizados: 0, conNombres: false,
            fuente: primeraFoto ? `sin historial (arranca ${dm(primeraFoto)})` : 'sin historial de ClickUp' }
        : { disponible: cu.disponible, sinFoto: false, rojo: cu.rojo, amarillo: cu.amarillo, verde: cu.verde, pausa: cu.pausa,
            produccion: cu.produccion, finalizados: cu.finalizados, conNombres: true, fuente: 'hoy' }

    // Backend del mes
    const bm = raw.backend.mensual
    const crmOk = raw.backend.crm.disponible
    const inicio = en(bm?.activosInicio) ?? 0
    const bajas = en(bm?.bajas) ?? 0
    const renov = en(bm?.renovaciones) ?? 0
    let churn = crmOk ? en(bm?.churn) : null
    let churnSub: string
    if (crmOk) {
      // Promedio de los últimos 3 meses CERRADOS hasta el mes elegido (Movimiento 1 del mentor)
      const cerrados: number[] = []
      for (let i = Math.min(m, currentMonthIdx - 1); i >= 0 && cerrados.length < 3; i--) {
        const v = bm?.churn[i]
        if (v != null) cerrados.push(v)
      }
      const prom3 = cerrados.length ? cerrados.reduce((s, v) => s + v, 0) / cerrados.length : null
      churnSub = churn != null
        ? `${bajas} bajas de ${inicio} activos al 1/${m + 1}${esMesEnCurso ? ' · en curso' : ''}${prom3 != null ? ` · prom 3m ${prom3.toFixed(1)}%` : ''}`
        : inicio < 3 ? 'menos de 3 activos al inicio del mes' : 'sin datos del mes'
    } else {
      // Sin CRM conectado: aproximado por pagos
      churn = raw.backend.churn[m] ?? null
      churnSub = churn != null ? 'aprox. por pagos (CRM no conectado)' : 'aprox. por pagos — sin datos'
    }
    const tasaRenov = crmOk ? en(bm?.tasaRenovacion) : null
    // Clientes activos: mes en curso = estado ACTIVO del CRM hoy (backend.crm.activos, el mismo
    // número de la hoja Métricas y de Discord); meses pasados = activos al cierre (activosFin)
    const crmX = raw.backend.crm as RawData['backend']['crm'] & CrmExtra
    const pausadosHoy = esMesEnCurso ? (crmX.pausados ?? null) : null
    const bajasSinFecha = esMesEnCurso ? (crmX.bajasSinFecha ?? 0) : 0
    // Meses cerrados: las bajas sin "Fecha de baja" se imputan al mes EN CURSO (hoy), así que un mes
    // pasado puede estar subestimado (ej. el 1/10 las de septiembre pasan a octubre). Se avisa igual.
    const bajasSinFechaFuera = !esMesEnCurso && crmOk && m < currentMonthIdx ? (crmX.bajasSinFecha ?? 0) : 0
    // Los que pagaron solo el fee (< $400) y nunca avanzaron no cuentan como clientes
    const noClientes = crmOk ? (crmX.noClientes ?? 0) : 0
    const sufNoClientes = noClientes > 0 ? ` · sin contar ${noClientes} que solo pagaron el fee` : ''
    return {
      mes, clickup, pausadosHoy, bajasSinFecha, bajasSinFechaFuera, noClientes, sufNoClientes,
      activosFin: !crmOk ? null : esMesEnCurso ? raw.backend.crm.activos : en(bm?.activosFin),
      activosInicio: inicio,
      nuevos: crmOk ? en(bm?.nuevos) : null,
      bajas: crmOk ? bajas : null,
      renov,
      churn, churnSub,
      tasaRenov,
      tasaRenovSub: tasaRenov != null ? `${renov} renovaron · ${bajas} no renovaron` : crmOk ? 'sin vencimientos decididos en el mes' : 'CRM Clientes no conectado',
      ltvAcum: en(bm?.ltvAcumulado),
      ltgpCac: en(bm?.ltgpCac),
      beccPct: en(bm?.beccPct),
    }
  }, [raw, activeMonthIdx, currentMonthIdx, esMesEnCurso])

  // ── ORIGEN DE CIERRES FECCU ───────────────────────────────────────
  // Solo transacciones FECCU (clientes nuevos). count = cierres = clientes cuyo PRIMER pago FECCU
  // del año cae en el período (dedupe por teléfono de 7 dígitos ∪ nombre normalizado): el 2do pago
  // de un PIF partido o el PIF que sigue a un fee del mes anterior ya no cuentan como otro cierre.
  const primerosFeccu = useMemo(() => primerosPagosFeccu(raw?.transactions ?? []), [raw])
  const feccuSources = useMemo(() => {
    // Se agrupa por embudo atribuido del pago (transactions[].embudo: la fila de closer del cliente,
    // p.ej. retargeting) + fuente; sin embudo (/api/raw viejo) el gráfico clasifica por la fuente col K.
    const map: Record<string, { source: string; embudo: EmbudoPago | null; amount: number; count: number }> = {}
    filteredTx.forEach(t => {
      if (t.category !== 'FECCU') return
      const s = t.source.trim() || '(sin fuente)'   // sin fuente → se clasifica como VSL (bug de tracking)
      const embudo = embudoDe(t)
      const k = `${embudo ?? ''}|${s}`
      if (!map[k]) map[k] = { source: s, embudo, amount: 0, count: 0 }
      map[k].amount += t.amount
      // "No cliente" (pagó solo el fee: < $400 en total y no está activo en el CRM): su plata SÍ suma
      // en amount (es FECCU real), pero no cuenta como cierre
      if (primerosFeccu.has(t) && !t.noCliente) map[k].count++
    })
    return Object.values(map)
  }, [filteredTx, primerosFeccu])

  const timeAgo = lastUpdated
    ? Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000)
    : null

  // Label del mes visto (para header)
  const viewedMonthLabel = useMemo(() => {
    if (dateRange.quick !== 'month' || viewMonthIdx === null) return null
    const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return `${labels[viewMonthIdx]} ${new Date().getFullYear()}`
  }, [dateRange.quick, viewMonthIdx])

  // Nombre del mes activo (para el embudo — funciona en cualquier modo)
  const activeMonthName = useMemo(() => {
    const labels = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return labels[activeMonthIdx]
  }, [activeMonthIdx])

  if (!mounted) return <div data-theme="light" className="resumen-marca" style={{ minHeight: '100vh', background: 'var(--bg)' }} />

  return (
    <div data-theme={darkMode ? 'dark' : 'light'} className="resumen-marca" style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.3s, color 0.3s' }}>
      {/* ── HEADER ─────────────────────────────────── */}
      {/* Banda verde de la marca (como el encabezado del CRM de ventas), de borde a borde. Header fijo: permite cambiar filtros mientras se scrollea y comparar */}
      {/* Sticky solo desde 768px (clase dashboard-header en globals.css): en el celular tapaba media pantalla */}
      <header className="no-print-sticky dashboard-header marca-banda" style={{ zIndex: 40 }}>
        <div className="max-w-6xl mx-auto px-4" style={{ padding: '12px 16px 14px' }}>
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>
                Despacho <span style={{ color: 'var(--brand-texto)' }}>· Capital Jurídico</span>
              </h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
                {viewedMonthLabel && (
                  <span className="ml-2 text-xs">
                    {'· Viendo: '}
                    <span style={{ color: 'var(--brand-texto)', fontWeight: 600 }}>{viewedMonthLabel}</span>
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 no-print">
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span className="status-dot" />
                {loading ? 'Actualizando...' : timeAgo !== null ? `hace ${timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo/60)}m`}` : ''}
              </div>
              <button
                onClick={() => setDarkMode(d => !d)}
                style={{
                  padding: '5px 12px', borderRadius: 8,
                  border: '1.5px solid var(--border)', background: 'var(--card)',
                  color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}
              >
                {darkMode ? 'Modo claro' : 'Modo oscuro'}
              </button>
              <button
                onClick={descargarPdf}
                disabled={loading || !hasData}
                style={{
                  padding: '5px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--brand-orange)', color: 'var(--on-brand)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'opacity 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                Descargar PDF
              </button>
            </div>
          </div>

          {/* Filtros. En el celular cada fila de botones se desliza de costado (.fila-deslizable): el bloque que la envuelve no
              puede estirarse al ancho de los botones (min-w-0 / max-w-full), si no ensancha la página y el celular la achica entera. */}
          <div className="flex flex-wrap gap-4 items-start no-print min-w-0">
            <div className="min-w-0 max-w-full">
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>PERÍODO</p>
              <DateFilter value={dateRange} onChange={handleDateRangeChange} />
            </div>
            {closerNames.length > 0 && (
              <div className="min-w-0 max-w-full">
                <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>PERSONA</p>
                <PersonFilter closers={closerNames} selected={person} onChange={setPerson} />
              </div>
            )}
            {dateRange.quick === 'month' && raw && (
              <div className="min-w-0 max-w-full">
                <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>MES</p>
                <MonthPicker
                  monthlyCash={raw.monthlyCash}
                  selected={viewMonthIdx}
                  onChange={idx => setViewMonthIdx(idx ?? currentMonthIdx)}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 md:py-8">

        {/* Mientras llegan los datos: bloques de carga en lugar de una pantalla de "Sin datos" */}
        {!hasData && loading && (
          <div role="status" aria-busy="true" aria-label="Cargando el resumen" className="mb-6">
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {Array.from({ length: 12 }, (_, i) => <div key={i} className="esqueleto" style={{ height: 96 }} />)}
            </div>
          </div>
        )}

        {/* ── PRINCIPALES (volumen + adquisición) — arriba del todo ── */}
        {hasData && (
          <section className="mb-6">
            <KpiBoard
              title="Principales"
              periodLabel={leadQualityPeriodLabel}
              groups={[
                { title: 'Volumen', items: [
                  { label: 'Leads — VSL', value: leadsVSL, format: 'number', sub: 'visitas GA4' },
                  { label: 'Leads — Inbound', value: leadsIG, format: 'number', sub: 'conversaciones IG (orgánico + pago)' },
                  // Setter (Maite): agendas propias (col K "mai") y % sobre los asignados por ManyChat (etiqueta ASIGNADO → pestaña Setter IG)
                  { label: 'Agendas del setter', value: raw?.monthlyAgendasSetter[activeMonthIdx] ?? null, format: 'number',
                    sub: ((raw?.monthlyAsignadosSetter[activeMonthIdx] ?? 0) > 0 ? `de ${(raw?.monthlyAsignadosSetter[activeMonthIdx] ?? 0).toLocaleString('en-US')} asignados (ManyChat)` : 'Maite · col K "mai" en closers') + sufEmpresa },
                  // null = mes sin asignados reales (antes del tracking) o asignados < agendas → "—"
                  { label: '% Agenda del setter', value: raw?.monthlyTasaAgendaSetter[activeMonthIdx] != null ? (raw!.monthlyTasaAgendaSetter[activeMonthIdx] as number) * 100 : null, format: 'percent',
                    sub: (raw?.monthlyTasaAgendaSetter[activeMonthIdx] != null ? 'agendas de Maite ÷ asignados (ASIGNADO)' : 'sin asignados medidos ese mes') + sufEmpresa },
                  // CPL de IG = gasto FM ÷ seguimientos; mientras no se carguen, estimado de Meta
                  { label: 'CPL Instagram', value: cplIG, format: 'currency',
                    sub: (cplIG == null ? 'sin gasto FM ni datos de Meta'
                      : cplIGEstimado ? `estimado Meta${rx?.igTasaFuente ? ` · tasa ${rx.igTasaFuente}` : ''} · falta cargar seguimientos del mes` : 'gasto FM ÷ seguimientos') + sufEmpresa },
                  // Clicks en "Agendar" (lead real BECC): evento click_agendar de GA4 (snippet en Framer)
                  { label: 'Clicks en Agendar', value: raw?.monthlyClicksAgendar[activeMonthIdx] ?? null, format: 'number',
                    sub: (raw?.monthlyClicksAgendar[activeMonthIdx] != null ? 'botón #agendarpr (GA4)' : 'falta el snippet en Framer') + sufEmpresa },
                  // Agendas medidas en la landing de Framer (thank-you /graciasporagendar vía GA4)
                  { label: 'Agendas — Web', value: raw?.monthlyAgendasWeb[activeMonthIdx] ?? null, format: 'number',
                    sub: ((raw?.monthlyAgendasWeb[activeMonthIdx] ?? 0) && leadsVSL ? `${(((raw?.monthlyAgendasWeb[activeMonthIdx] ?? 0) / leadsVSL) * 100).toFixed(1)}% de visitas · /graciasporagendar` : '/graciasporagendar (GA4)') + sufEmpresa },
                  { label: 'Llamadas Agendadas', value: llamadasAg, format: 'number' },
                  { label: 'Llamadas Canceladas', value: null, format: 'number', sub: 'no se registra en el CRM' },
                  { label: 'No Shows', value: noShows, format: 'number', sub: `ocurridas sin presentarse${subSinRegistro}` },
                  { label: 'Llamadas Efectivas', value: llamadasPres, format: 'number', sub: 'se presentó Call 1' },
                  { label: 'Llamadas Calificadas', value: llamadasCalif, format: 'number' },
                  { label: 'Cierres', value: unidadesCerr, format: 'number', sub: `con ≥ $400 cobrados o cliente activo${cierresSoloFee > 0 ? ` (${cierresSoloFee} con solo fee no cuentan)` : ''}` },
                  { label: 'FECCU', value: feccu, format: 'currency' },
                  { label: 'FECCP', value: feccp, format: 'currency' },
                  { label: 'BECC', value: becc, format: 'currency' },
                  // Métrica de compensación del CSM (JD): objetivo ≥10%, tramos 15/20/25%
                  { label: 'BECC %', value: cashCollected > 0 ? (becc / cashCollected) * 100 : null, format: 'percent',
                    sub: 'del cash · meta ≥10% (CSM)',
                    tone: cashCollected > 0 ? (becc / cashCollected >= 0.15 ? 'good' : becc / cashCollected >= 0.10 ? 'warn' : 'bad') : undefined },
                  { label: 'AOV TC', value: aovTC, format: 'currency', sub: dealsTC > 0 ? `${dealsTC} ${dealsTC === 1 ? 'trato cerrado' : 'tratos cerrados'}` : 'sin tratos con TC cargado' },
                  { label: 'Cash In (Ingresos)', value: cashCollected, format: 'currency', highlight: true },
                ]},
                { title: `Adquisición y rentabilidad · ${MESES[activeMonthIdx]}${sufEmpresa}`, items: [
                  { label: 'Inversión en ADS', value: (raw?.monthlyAds[activeMonthIdx] ?? 0) > 0 ? raw!.monthlyAds[activeMonthIdx] : null, format: 'currency', sub: 'Meta API' },
                  { label: 'Otros Gastos en Marketing', value: (raw?.monthlyMktArea[activeMonthIdx] ?? 0) > 0 ? raw!.monthlyMktArea[activeMonthIdx] : null, format: 'currency', sub: 'área Marketing (ER)' },
                  { label: 'Comisiones de Ventas', value: (raw?.monthlyVentasArea[activeMonthIdx] ?? 0) > 0 ? raw!.monthlyVentasArea[activeMonthIdx] : null, format: 'currency', sub: 'área Ventas (ER)' },
                  { label: 'Gastos en Adquisición', value: (raw?.monthlyGastoAdq[activeMonthIdx] ?? 0) > 0 ? raw!.monthlyGastoAdq[activeMonthIdx] : null, format: 'currency', sub: 'ads + ventas + mkt' },
                  { label: 'Cash Out (Gastos)', value: cashOut, format: 'currency', sub: subCashOut, tone: gastosOk ? undefined : 'warn' },
                  { label: 'CAC', value: cacAds, format: 'currency', sub: 'solo ads / cierre' },
                  { label: 'CAC Blended', value: cac, format: 'currency', sub: gastosOk ? 'adquisición / cierre' : subFaltanGastos },
                  { label: 'FECCU:CAC', value: feccuCac, format: 'ratio', sub: subMuestraChica(feccuCac, adsMesTotal, 'FECCU / ads'), highlight: true },
                  { label: 'FECCU:CAC Blended', value: feccuCacBlended, format: 'ratio', sub: gastosOk ? subMuestraChica(feccuCacBlended, adsMesTotal, 'FECCU / adquisición') : subFaltanGastos },
                  { label: 'NFCF', value: nfcf, format: 'currency', sub: gastosOk ? 'beneficio neto del mes' : subFaltanGastos },
                  { label: 'Margen NFCF', value: margenNFCF, format: 'percent', sub: gastosOk ? 'NFCF / cash' : subFaltanGastos },
                ]},
              ]}
            />
          </section>
        )}

        {/* ── OPERATIVO (salud de clientes + backend del mes elegido) ── */}
        {hasData && operativo && raw && (
          <section className="mb-6">
            <KpiBoard
              title="Operativo · Backend"
              periodLabel={leadQualityPeriodLabel + sufEmpresa}
              groups={[
                { title: `Salud de clientes · ClickUp · ${operativo.mes}${esMesEnCurso ? ' (hoy)' : ''}`, items: [
                  { label: 'Rojo', value: operativo.clickup.disponible ? operativo.clickup.rojo : null, format: 'number', tone: 'bad',
                    sub: !operativo.clickup.conNombres ? operativo.clickup.fuente
                      : raw.clickup.nombresRojo.length ? raw.clickup.nombresRojo.slice(0, 3).join(' · ') + (raw.clickup.nombresRojo.length > 3 ? ` +${raw.clickup.nombresRojo.length - 3}` : '') + ` · ${operativo.clickup.fuente}`
                      : `ninguno · ${operativo.clickup.fuente}` },
                  { label: 'Amarillo', value: operativo.clickup.disponible ? operativo.clickup.amarillo : null, format: 'number', tone: 'warn',
                    sub: !operativo.clickup.conNombres ? operativo.clickup.fuente
                      : raw.clickup.nombresAmarillo.length ? raw.clickup.nombresAmarillo.slice(0, 3).join(' · ') + (raw.clickup.nombresAmarillo.length > 3 ? ` +${raw.clickup.nombresAmarillo.length - 3}` : '') + ` · ${operativo.clickup.fuente}`
                      : `ninguno · ${operativo.clickup.fuente}` },
                  { label: 'Verde', value: operativo.clickup.disponible ? operativo.clickup.verde : null, format: 'number', tone: 'good', sub: `saludables · ${operativo.clickup.fuente}` },
                  { label: 'En pausa', value: operativo.clickup.disponible ? operativo.clickup.pausa : null, format: 'number', sub: `servicio pausado · ${operativo.clickup.fuente}` },
                  { label: 'En producción', value: operativo.clickup.disponible ? operativo.clickup.produccion : null, format: 'number', sub: `onboarding → campañas activas · ${operativo.clickup.fuente}` },
                  { label: 'Activos en ClickUp',
                    value: operativo.clickup.disponible ? operativo.clickup.rojo + operativo.clickup.amarillo + operativo.clickup.verde + operativo.clickup.pausa + operativo.clickup.produccion : null,
                    format: 'number', sub: operativo.clickup.disponible ? `${operativo.clickup.finalizados} finalizados · ${operativo.clickup.fuente}`
                      : operativo.clickup.sinFoto ? operativo.clickup.fuente : 'ClickUp no conectado' },
                ]},
                { title: `Backend · ${operativo.mes}${esMesEnCurso ? ' (en curso)' : ''}`, items: [
                  { label: 'Clientes Activos', value: operativo.activosFin, format: 'number',
                    sub: !raw.backend.crm.disponible ? 'CRM Clientes no conectado'
                      : (esMesEnCurso
                        ? `hoy · estado ACTIVO (CRM)${operativo.pausadosHoy ? ` · ${operativo.pausadosHoy} en pausa` : ''} · ${operativo.activosInicio} al 1/${activeMonthIdx + 1}`
                        : `al cierre del mes · ${operativo.activosInicio} al 1/${activeMonthIdx + 1}`) + operativo.sufNoClientes },
                  { label: 'Clientes nuevos', value: operativo.nuevos, format: 'number', sub: '"Día 1" en el mes (CRM Agencia)' + operativo.sufNoClientes },
                  { label: 'Bajas', value: operativo.bajas, format: 'number',
                    sub: `${operativo.renov} ${operativo.renov === 1 ? 'renovación paga' : 'renovaciones pagas'}${operativo.bajasSinFecha > 0 ? ` · ${operativo.bajasSinFecha} sin "Fecha de baja" (imputadas a hoy)` : ''}${operativo.bajasSinFechaFuera > 0 ? ` · ⚠️ ${operativo.bajasSinFechaFuera} bajas sin "Fecha de baja" se cuentan en el mes en curso: este mes puede estar subestimado` : ''}` },
                  { label: 'Churn Rate', value: operativo.churn, format: 'percent', sub: operativo.churnSub + operativo.sufNoClientes },
                  { label: 'Tasa de Renovación', value: operativo.tasaRenov, format: 'percent', sub: operativo.tasaRenovSub },
                  { label: 'LTV acumulado', value: operativo.ltvAcum, format: 'currency', highlight: true,
                    sub: (esMesEnCurso ? 'cobrado ÷ clientes · a hoy (Registro)' : `cobrado ÷ clientes · al cierre de ${operativo.mes}`) + operativo.sufNoClientes },
                  // LTV acumulado del mes × margen bruto ÷ CAC blended del mes; con gastos del ER incompletos → "—"
                  { label: 'LTGP:CAC', value: gastosOk ? operativo.ltgpCac : null, format: 'ratio', highlight: true,
                    sub: gastosOk ? `LTV acum. × margen ÷ CAC blended de ${operativo.mes} · meta ≥3x` : subFaltanGastos,
                    tone: !gastosOk || operativo.ltgpCac == null ? undefined : operativo.ltgpCac >= 5 ? 'good' : operativo.ltgpCac >= 3 ? 'warn' : 'bad' },
                  // Métrica de compensación del CSM: BECC por fecha de pago ÷ cash del mes
                  { label: 'BECC % del cash', value: operativo.beccPct, format: 'percent', sub: 'por fecha de pago · meta ≥10% (CSM)',
                    tone: operativo.beccPct == null ? undefined : operativo.beccPct >= 15 ? 'good' : operativo.beccPct >= 10 ? 'warn' : 'bad' },
                ]},
                { title: 'Stock acumulado · hoy (sin historia por mes)', items: [
                  { label: 'LTV cobrado (real)', value: raw.backend.crm.ltvCobrado ?? raw.backend.ltv ?? null, format: 'currency',
                    sub: (raw.backend.crm.ltvCobrado != null ? 'hoy · CRM Clientes × Registro' : `hoy · ${raw.backend.clientes} clientes · Registro de Pagos`) + operativo.sufNoClientes },
                  { label: 'LTV contratado', value: raw.backend.crm.ltvContratado ?? null, format: 'currency',
                    sub: raw.backend.crm.disponible ? 'hoy · lo que deberían pagar (CRM)' + operativo.sufNoClientes : 'CRM Clientes no conectado' },
                  { label: 'LTGP', value: raw.backend.ltgp ?? null, format: 'currency',
                    sub: raw.backend.margenBruto != null ? `hoy · margen bruto ${(raw.backend.margenBruto * 100).toFixed(0)}% (Producto+Ops)` : 'faltan gastos de entrega' },
                  // Promesa alcanzada: Sí ÷ cargados ("Parcial" cuenta como no). La satisfacción solo si hay dato.
                  { label: 'Tasa de Éxito', value: raw.backend.crm.tasaExito ?? null, format: 'percent',
                    sub: raw.backend.crm.tasaExito != null
                      ? `hoy · Sí ÷ cargados (Parcial cuenta como no)${raw.backend.crm.satisfaccion != null ? ` · satisfacción ${raw.backend.crm.satisfaccion.toFixed(1)}/10` : ''}`
                      : 'cargar "Promesa alcanzada" en el CRM (1 vez al mes)' },
                ]},
              ]}
            />
          </section>
        )}

        {/* ── EMBUDO DE VENTAS ─────────────────────────── */}
        {hasData && (
          <section className="mb-6">
            <SalesFunnel
              byChannel={funnelByChannel}
              vsl={agVSL}
              retargeting={agRetargeting}
              ig={agIG}
              uruguay={agUruguay}
              webinar={agWebinar}
              wsp={agWsp}
              referido={agReferido}
              monthLabel={isMonth ? activeMonthName : null}
              leadsVSL={leadsVSL}
              leadsIG={leadsIG}
              costoPorLeadVSL={costoPorLeadVSL}
              cpaRetargeting={isMonth && person === '' ? cpaRetargeting : null}
              cpsIG={cplIG}
              cpsIGEstimado={cplIGEstimado}
            />
          </section>
        )}

        {/* ── TASAS DEL MES ────────────────────────────── */}
        {hasData && (
          <section className="mb-6">
            <KpiBoard
              title="Tasas"
              periodLabel={leadQualityPeriodLabel}
              groups={[
                { title: 'Tasas', items: [
                  { label: 'Tasa de Agenda', value: tasaAgendaBoard, format: 'percent', sub: 'agendas VSL+IG / leads VSL+IG' },
                  { label: 'Tasa de Show Up', value: showUpRate, format: 'percent', sub: `efectivas / ocurridas registradas${subSinRegistro}` },
                  { label: 'Tasa de Cierre s/ presentada', value: llamadasPres > 0 ? (unidadesCerr / llamadasPres) * 100 : null, format: 'percent' },
                  { label: 'Tasa de Calificación', value: llamadasAg > 0 ? (llamadasCalif / llamadasAg) * 100 : null, format: 'percent', sub: 'calificadas / agendadas' },
                ]},
              ]}
            />
          </section>
        )}

        {/* ── CALIDAD DE LEADS A/B/C/D ─────────────────── */}
        {hasData && (
          <section className="mb-6">
            <LeadQualityCard
              stats={leadQuality.stats}
              sinClasificar={leadQuality.sinClasificar}
              periodLabel={leadQualityPeriodLabel}
            />
          </section>
        )}

        {/* ── ANUNCIOS: CAMPAÑAS ACTIVAS ───────────────── */}
        {hasData && ads && (
          <section className="mb-6">
            <AdsReport
              daily={ads.daily}
              campaigns={ads.activeCampaigns}
              adsIndividuales={ads.ads ?? []}
              adsPeriodLabel={isMonth ? MESES[activeMonthIdx] : 'últimos 7 días'}
              isMonthView={isMonth}
              agendasPorDia={agendasPorDia}
              cpaVSL={cpaVSL}
              agendasVSLMes={raw?.monthlyVSL[activeMonthIdx] ?? 0}
              cpaRetargeting={cpaRetargeting}
              agendasRetargetingMes={agRetargetingMes}
              adsRetargetingMes={adsRetargetingMes}
              esMesPasado={isMonth && activeMonthIdx < currentMonthIdx}
              cps={cplIG}
              cpsEstimado={cplIGEstimado}
              seguidoresMes={seguidoresMes}
              monthLabel={isMonth ? activeMonthName : null}
            />
          </section>
        )}

        {/* ── ANALISTA (único): hallazgos simples arriba de los objetivos ── */}
        {raw && (
          <section className="mb-6"><AnalystPanel raw={raw} monthIdx={activeMonthIdx} metaMensual={MONTHLY_GOAL} /></section>
        )}

        {/* ── OBJETIVOS ──────────────────────────────────── */}
        <section className="mb-6">
          <p className="section-title">Objetivos</p>
          <div className="grid grid-cols-1 gap-3 mb-3">
            {/* Fuera del modo mes: cash del mes en curso (misma fila del ER que el resto del tablero) */}
            <GoalBar
              value={isMonth ? (hasData ? cashCollected : null) : (raw ? (raw.monthlyCash[currentMonthIdx] ?? null) : (monthly?.monthlyRevenue ?? null))}
              type="monthly"
              monthIdx={isMonth ? activeMonthIdx : undefined}
              persona={isMonth && person !== '' ? person : undefined}
            />
          </div>
          {/* J4 = PENDIENTE (suma col E) y M4 = cobrado (suma col F). Si /api/metrics todavía no manda
              cuotasPendiente, su cuotasTotal viejo ERA J4 (lo pendiente) */}
          <CuotasCard
            pendiente={monthly ? (monthly.cuotasPendiente !== undefined ? monthly.cuotasPendiente : (monthly.cuotasTotal ?? null)) : null}
            cobradas={monthly?.cuotasCobradas ?? null}
            noPaga={monthly?.cuotasNoPaga ?? null}
          />
        </section>

        {/* ── GRÁFICOS ───────────────────────────────────── */}
        <section className="mb-6">
          <p className="section-title">Evolución mensual</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CashChart  labels={raw?.monthlyLabels ?? []} cash={raw?.monthlyCash ?? []} />
            <CallsChart labels={raw?.monthlyLabels ?? []} agendadas={raw?.monthlyAgendadas ?? []} cerradas={raw?.monthlyCerradas ?? []} />
          </div>
        </section>

        {/* ── ANÁLISIS DEL PERÍODO ───────────────────────── */}
        {hasData && (
          <section className="mb-6">
            <p className="section-title">Análisis del período</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <RevenuePieChart feccu={feccu} feccp={feccp} becc={becc} />
              <LeadSourceChart sources={feccuSources} />
            </div>
          </section>
        )}

        {/* ── AGENDA DETALLADA ──────────────────────────── */}
        <section className="mb-6">
          <p className="section-title">Agenda detallada</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              { label: 'Llamadas Presentadas',  value: hasData ? llamadasPres : null, format: 'number'  as const },
              { label: 'Llamadas Calificadas',  value: hasData ? llamadasCalif: null, format: 'number'  as const },
              // Tasas: null ("—") si no hay ocurridas registradas; sin registrar fuera del denominador
              { label: 'Show Up Rate',          value: hasData ? showUpRate   : null, format: 'percent' as const, sub: agSinRegistro > 0 ? `${agSinRegistro} sin registrar` : undefined },
              { label: 'Tasa de Cierre (s/ agendas ocurridas)', value: hasData ? tasaCierre : null, format: 'percent' as const, sub: agSinRegistro > 0 ? `${agSinRegistro} sin registrar` : undefined },
              { label: `CAC (solo Ads) · ${MESES[activeMonthIdx]}`, value: cacAds,   format: 'currency' as const },
              { label: `CAC Blended · ${MESES[activeMonthIdx]}`,    value: cac,      format: 'currency' as const, sub: gastosOk ? undefined : subFaltanGastos },
              { label: `Margen NFCF · ${MESES[activeMonthIdx]}`,    value: margenNFCF, format: 'percent' as const, sub: gastosOk ? undefined : subFaltanGastos },
              { label: `Cash Out (gastos) · ${MESES[activeMonthIdx]}`, value: cashOut, format: 'currency' as const, sub: gastosOk ? undefined : 'parcial · faltan gastos' },
              { label: isMonth ? 'Cash In (mes)' : 'Cash In (período)', value: hasData ? cashCollected : null, format: 'currency' as const },
            ] as { label: string; value: number | null; format: 'number' | 'percent' | 'currency'; sub?: string }[]).map(m => (
              <div key={m.label} className="small-metric">
                <p className="sm-label">{m.label}</p>
                <p className="sm-value" style={{ color: m.value === null ? 'var(--text-muted)' : 'var(--text)' }}>
                  {fmt(m.value, m.format)}
                </p>
                {m.sub && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{m.sub}</p>}
              </div>
            ))}
          </div>
        </section>

        <footer className="text-center text-xs py-4" style={{ color: 'var(--text-muted)' }}>
          Auto-refresh 2 min (solo con la pestaña abierta) · Despacho · Capital Jurídico
        </footer>
      </div>
    </div>
  )
}
