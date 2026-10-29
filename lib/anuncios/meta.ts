// ── Meta (Graph API) para el tablero de anuncios de clientes ─────────────────────────────────
// Todo en lote para cuidar el rate limit (con 50+ cuentas no se puede pedir de a una):
//   · descubrirCuentas(): /me/adaccounts + /me/businesses (2-4 llamadas por token) → qué cuentas existen.
//   · leerCuentas(ids):   Batch API (hasta 50 pedidos por llamada) → estado, pago, saldo, portfolio.
//   · leerInsights(ids):  Batch API → gasto y mensajes POR DÍA (time_increment=1) de las últimas 5 semanas.
// Cada pedido que falla por permisos se reintenta con el otro token (token.ts). Errores de red /
// transitorios: reintento con backoff (1,5 s y 4 s). Si Meta limita (#4, #17, #32, #613, 80000+),
// no se insiste: se marca "limitado" y quedan los últimos datos buenos.
// Los plazos de refresco y la caché compartida están en tablero.ts / cache.ts.
import { esErrorPermisos, sinTokens, tokensMeta, type TokenMeta } from './token'

const GRAPH = 'https://graph.facebook.com/v23.0'
export const ACCION_MENSAJE = 'onsite_conversion.messaging_conversation_started_7d'
const LOTE = 25   // pedidos por llamada batch (máx. 50; de a 25 en paralelo responde más rápido)

export interface CuentaDescubierta { id: string; nombre: string; estado: number; negocio: { id: string; nombre: string } | null }

export interface CuentaMeta {
  id: string
  nombre: string
  estado: number                  // account_status
  presupuestoDiario?: number | null
  presupuestoDiarioNota?: string
  entrega?: 'activa' | 'sin_activos' // consulta efectiva de anuncios; ausente en cachés anteriores
  motivoBaja: number              // disable_reason
  moneda: string
  zonaHoraria: string | null
  negocio: { id: string; nombre: string } | null   // portfolio comercial (business)
  gastadoTotal: number            // amount_spent (en la moneda, ya dividido por el offset)
  limiteGasto: number             // spend_cap (0 = sin límite)
  deuda: number                   // balance: lo facturado pendiente (cuentas pospago)
  medioPago: { id: string | null; texto: string | null; tipo: number | null } | null
  prepago: boolean
  token: string                   // qué variable de entorno la pudo leer
}

export interface DiaInsight { d: string; g: number; m: number }   // fecha, gasto, mensajes
export interface InsightsCuentas {
  desde: string
  hasta: string
  porCuenta: Record<string, DiaInsight[]>
  errores: Record<string, string>
  limitado: boolean
}

export interface ResultadoCuentas { cuentas: Record<string, CuentaMeta>; errores: Record<string, string>; limitado: boolean }

// ── Errores de Graph ──
type ErrGraph = { message?: string; code?: number; error_subcode?: number; type?: string }
const esLimite = (code?: number) => code === 4 || code === 17 || code === 32 || code === 613 || (!!code && code >= 80000 && code <= 80014)
const esTransitorio = (code?: number) => code === 1 || code === 2
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))
const textoError = (e: ErrGraph) => sinTokens(`${e.message ?? 'error'}${e.code ? ` (#${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : ''}`)

// Monedas sin centavos según Meta (el resto viene en centavos: dividir por 100)
const SIN_CENTAVOS = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'])
const desdeCentavos = (v: string | number | undefined, moneda: string) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0') || 0
  return SIN_CENTAVOS.has(moneda) ? n : n / 100
}

interface ConjuntoPresupuesto {
  id: string; daily_budget?: string; lifetime_budget?: string; effective_status?: string
  start_time?: string; end_time?: string; ads?: { data?: { id: string }[] }
  campaign?: { id: string; daily_budget?: string; lifetime_budget?: string; effective_status?: string }
}
export function sumarPresupuestoConfigurado(conjuntos: { data?: ConjuntoPresupuesto[]; paging?: { next?: string } } | undefined, moneda: string, ahora = Date.now()): { diario: number | null; nota: string } {
  if (!conjuntos) return { diario: null, nota: 'Meta no devolvió la configuración de presupuesto' }
  if (conjuntos.paging?.next) return { diario: null, nota: 'Configuración incompleta: más conjuntos de los que devolvió Meta' }
  let diario = 0
  const campanas = new Set<string>()
  for (const c of conjuntos.data ?? []) {
    if (c.effective_status !== 'ACTIVE' || c.campaign?.effective_status !== 'ACTIVE' || !c.ads?.data?.length) continue
    if (c.start_time && new Date(c.start_time).getTime() > ahora || c.end_time && new Date(c.end_time).getTime() <= ahora) continue
    const campana = c.campaign
    if (Number(campana.daily_budget) > 0) {
      if (!campanas.has(campana.id)) { diario += desdeCentavos(campana.daily_budget, moneda); campanas.add(campana.id) }
    } else if (Number(campana.lifetime_budget) > 0 || Number(c.lifetime_budget) > 0) {
      return { diario: null, nota: 'Hay presupuesto total de campaña/conjunto; no equivale a un monto diario fijo' }
    } else if (Number(c.daily_budget) > 0) diario += desdeCentavos(c.daily_budget, moneda)
    else return { diario: null, nota: 'Un conjunto activo no tiene presupuesto diario legible' }
  }
  return { diario, nota: 'Suma de presupuestos diarios activos; campañas compartidas contadas una sola vez' }
}

// GET simple con reintentos (para /me/... con paginado)
type RespGraph<T> = { ok: true; data: T } | { ok: false; error: ErrGraph }
async function getGraph<T>(url: string): Promise<RespGraph<T>> {
  let ultimo: ErrGraph = { message: 'sin respuesta' }
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      const j = await r.json() as T & { error?: ErrGraph }
      if (!j.error) return { ok: true, data: j }
      ultimo = j.error
      if (esLimite(j.error.code) || !(esTransitorio(j.error.code) || r.status >= 500)) break
    } catch (e) {
      ultimo = { message: (e as Error).message }
    }
    await esperar(intento === 0 ? 1500 : 4000)
  }
  return { ok: false, error: ultimo }
}

// Una llamada a la Batch API. Devuelve una respuesta por pedido (en el mismo orden).
type RespBatch = { ok: true; body: unknown } | { ok: false; error: ErrGraph }
async function llamarBatch(token: string, urls: string[]): Promise<RespBatch[]> {
  let ultimo: ErrGraph = { message: 'sin respuesta' }
  for (let intento = 0; intento < 3; intento++) {
    try {
      const body = new URLSearchParams({ access_token: token, include_headers: 'false', batch: JSON.stringify(urls.map(u => ({ method: 'GET', relative_url: u }))) })
      const r = await fetch(`${GRAPH}/`, { method: 'POST', body, cache: 'no-store' })
      const j = await r.json() as ({ code: number; body: string } | null)[] | { error?: ErrGraph }
      if (Array.isArray(j)) {
        return urls.map((_, i) => {
          const x = j[i]
          if (!x) return { ok: false, error: { message: 'Meta no respondió este pedido (timeout del lote)', code: 2 } }
          let b: { error?: ErrGraph } | null = null
          try { b = JSON.parse(x.body) } catch { /* cuerpo vacío */ }
          if (x.code === 200 && b && !b.error) return { ok: true, body: b }
          return { ok: false, error: b?.error ?? { message: `HTTP ${x.code}` } }
        })
      }
      ultimo = j.error ?? { message: `HTTP ${r.status}` }
      if (esLimite(ultimo.code) || !(esTransitorio(ultimo.code) || r.status >= 500)) break
    } catch (e) {
      ultimo = { message: (e as Error).message }
    }
    await esperar(intento === 0 ? 1500 : 4000)
  }
  return urls.map(() => ({ ok: false, error: ultimo }))
}

// Pide `urls` (una por cuenta) en lotes paralelos; lo que falla por permisos se reintenta con el
// siguiente token y lo transitorio, una vez más con el mismo.
export async function batchConRespaldo(pedidos: { id: string; url: string }[]): Promise<{ ok: Record<string, { body: unknown; token: string }>; errores: Record<string, string>; limitado: boolean }> {
  const tokens = tokensMeta()
  const ok: Record<string, { body: unknown; token: string }> = {}
  const errores: Record<string, string> = {}
  let limitado = false
  if (!tokens.length) {
    for (const p of pedidos) errores[p.id] = 'Falta configurar META_CLIENTES_TOKEN'
    return { ok, errores, limitado }
  }
  let pendientes = pedidos
  for (let ti = 0; ti < tokens.length && pendientes.length; ti++) {
    const t: TokenMeta = tokens[ti]
    const reintentar: typeof pedidos = []   // errores de permisos: van al próximo token
    for (let vuelta = 0; vuelta < 2 && pendientes.length; vuelta++) {
      const lotes: (typeof pedidos)[] = []
      for (let i = 0; i < pendientes.length; i += LOTE) lotes.push(pendientes.slice(i, i + LOTE))
      const resps = await Promise.all(lotes.map(l => llamarBatch(t.token, l.map(p => p.url))))
      const transitorios: typeof pedidos = []
      lotes.forEach((l, li) => l.forEach((p, i) => {
        const r = resps[li][i]
        if (r.ok) { ok[p.id] = { body: r.body, token: t.nombre }; delete errores[p.id]; return }
        errores[p.id] = textoError(r.error)
        if (esLimite(r.error.code)) limitado = true
        else if (esErrorPermisos(r.error.code, r.error.error_subcode)) reintentar.push(p)
        else if (esTransitorio(r.error.code) && vuelta === 0) transitorios.push(p)
      }))
      if (!transitorios.length) break
      await esperar(1500)
      pendientes = transitorios
    }
    pendientes = reintentar   // con el próximo token, solo los de permisos
  }
  return { ok, errores, limitado }
}

// ── Descubrimiento: qué cuentas ve cada token (para sumar las de clientes activos) ──
export async function descubrirCuentas(): Promise<{ cuentas: CuentaDescubierta[]; errores: string[] }> {
  const porId = new Map<string, CuentaDescubierta>()
  const errores: string[] = []
  const campos = 'id,name,account_status,business{id,name}'
  type Cta = { id: string; name?: string; account_status?: number; business?: { id: string; name?: string } }
  const agregar = (c: Cta, negocio?: { id: string; name?: string }) => {
    if (porId.has(c.id)) return
    const b = c.business ?? negocio
    porId.set(c.id, { id: c.id, nombre: c.name ?? c.id, estado: c.account_status ?? 0, negocio: b ? { id: b.id, nombre: b.name ?? '' } : null })
  }
  for (const t of tokensMeta()) {
    let url: string | null = `${GRAPH}/me/adaccounts?fields=${campos}&limit=100&access_token=${t.token}`
    for (let pag = 0; url && pag < 8; pag++) {
      const r: RespGraph<{ data?: Cta[]; paging?: { next?: string } }> = await getGraph(url)
      if (!r.ok) { errores.push(`${t.nombre} /me/adaccounts: ${textoError(r.error)}`); break }
      for (const c of r.data.data ?? []) agregar(c)
      url = r.data.paging?.next ?? null
    }
    type Biz = { id: string; name?: string; owned_ad_accounts?: { data?: Cta[] }; client_ad_accounts?: { data?: Cta[] } }
    url = `${GRAPH}/me/businesses?fields=id,name,owned_ad_accounts.limit(200){id,name,account_status},client_ad_accounts.limit(200){id,name,account_status}&limit=50&access_token=${t.token}`
    for (let pag = 0; url && pag < 4; pag++) {
      const r: RespGraph<{ data?: Biz[]; paging?: { next?: string } }> = await getGraph(url)
      if (!r.ok) { errores.push(`${t.nombre} /me/businesses: ${textoError(r.error)}`); break }
      for (const b of r.data.data ?? []) {
        for (const c of b.owned_ad_accounts?.data ?? []) agregar(c, b)
        // Cuentas "de cliente" compartidas al portfolio: el dueño real se completa con business{} en leerCuentas
        for (const c of b.client_ad_accounts?.data ?? []) agregar(c)
      }
      url = r.data.paging?.next ?? null
    }
  }
  return { cuentas: [...porId.values()], errores }
}

// ── Datos de cada cuenta: estado, pago, saldo, portfolio ──
const CAMPOS_CUENTA = 'id,name,account_status,disable_reason,currency,timezone_name,business{id,name},amount_spent,spend_cap,balance,funding_source_details,is_prepay_account,adsets.limit(100).filtering([{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]){id,daily_budget,lifetime_budget,effective_status,start_time,end_time,campaign{id,daily_budget,lifetime_budget,effective_status},ads.limit(1).filtering([{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]){id}},ads.limit(1).filtering([{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]){id}'
const ultimasCuentas = new Map<string, CuentaMeta>()   // último dato bueno por cuenta (si Meta limita una)

export async function leerCuentas(ids: string[]): Promise<ResultadoCuentas> {
  const r = await batchConRespaldo(ids.map(id => ({ id, url: `${id}?fields=${encodeURIComponent(CAMPOS_CUENTA)}` })))
  const cuentas: Record<string, CuentaMeta> = {}
  for (const [id, { body, token }] of Object.entries(r.ok)) {
    const c = body as {
      id: string; name?: string; account_status?: number; disable_reason?: number; currency?: string; timezone_name?: string
      business?: { id: string; name?: string }; amount_spent?: string; spend_cap?: string; balance?: string
      funding_source_details?: { id?: string; display_string?: string; type?: number }; is_prepay_account?: boolean
      adsets?: { data?: ConjuntoPresupuesto[]; paging?: { next?: string } }
      ads?: { data?: { id: string }[] }
    }
    const moneda = c.currency ?? 'USD'
    const presupuesto = sumarPresupuestoConfigurado(c.adsets, moneda)
    const cuenta: CuentaMeta = {
      presupuestoDiario: presupuesto.diario, presupuestoDiarioNota: presupuesto.nota,
      id,
      nombre: c.name ?? id,
      estado: c.account_status ?? 0,
      // Graph omite la expansión ads cuando el filtro no devuelve ningún anuncio.
      entrega: c.ads?.data?.length ? 'activa' : 'sin_activos',
      motivoBaja: c.disable_reason ?? 0,
      moneda,
      zonaHoraria: c.timezone_name ?? null,
      negocio: c.business ? { id: c.business.id, nombre: c.business.name ?? '' } : null,
      gastadoTotal: desdeCentavos(c.amount_spent, moneda),
      limiteGasto: desdeCentavos(c.spend_cap, moneda),
      deuda: desdeCentavos(c.balance, moneda),
      medioPago: c.funding_source_details ? { id: c.funding_source_details.id ?? null, texto: c.funding_source_details.display_string ?? null, tipo: c.funding_source_details.type ?? null } : null,
      prepago: !!c.is_prepay_account,
      token,
    }
    cuentas[id] = cuenta
    ultimasCuentas.set(id, cuenta)
  }
  // Las que fallaron: último dato bueno (si lo hay en esta instancia)
  for (const id of Object.keys(r.errores)) { const prev = ultimasCuentas.get(id); if (prev) cuentas[id] = prev }
  if (!Object.keys(r.ok).length && ids.length) throw new Error(`Meta no devolvió ninguna cuenta: ${Object.values(r.errores)[0] ?? 'sin detalle'}`)
  return { cuentas, errores: r.errores, limitado: r.limitado }
}

// ── Insights diarios (gasto + mensajes) ──
const ultimosInsights = new Map<string, DiaInsight[]>()

// OJO (21/10/2026): pidiendo `spend` y `actions` juntos, Meta devuelve spend "0" en muchas cuentas aunque gasten
// (con `spend` solo viene bien). Por eso el gasto y los mensajes se piden en dos consultas y se unen por día.
async function insightsDiarios(ids: string[], desde: string, hasta: string, limit: number): Promise<{ porCuenta: Record<string, DiaInsight[]>; errores: Record<string, string>; limitado: boolean; ok: number }> {
  const rango = encodeURIComponent(JSON.stringify({ since: desde, until: hasta }))
  const base = (id: string, campos: string) => `${id}/insights?level=account&fields=${campos}&time_increment=1&time_range=${rango}&limit=${limit}`
  const r = await batchConRespaldo(ids.flatMap(id => [{ id: `${id}#g`, url: base(id, 'spend') }, { id: `${id}#m`, url: base(id, 'actions') }]))
  type Fila = { date_start: string; spend?: string; actions?: { action_type: string; value: string }[] }
  const porCuenta: Record<string, DiaInsight[]> = {}
  const errores: Record<string, string> = {}
  let ok = 0
  for (const id of ids) {
    const g = r.ok[`${id}#g`], m = r.ok[`${id}#m`]
    if (!g || !m) { errores[id] = r.errores[`${id}#g`] ?? r.errores[`${id}#m`] ?? 'sin respuesta'; continue }
    ok++
    const dias = new Map<string, DiaInsight>()
    for (const f of ((g.body as { data?: Fila[] }).data ?? [])) dias.set(f.date_start, { d: f.date_start, g: Math.round((parseFloat(f.spend ?? '0') || 0) * 100) / 100, m: 0 })
    for (const f of ((m.body as { data?: Fila[] }).data ?? [])) {
      const msj = parseInt(f.actions?.find(a => a.action_type === ACCION_MENSAJE)?.value ?? '0') || 0
      const d = dias.get(f.date_start)
      if (d) d.m = msj; else dias.set(f.date_start, { d: f.date_start, g: 0, m: msj })
    }
    porCuenta[id] = [...dias.values()].sort((a, b) => a.d.localeCompare(b.d))
  }
  return { porCuenta, errores, limitado: r.limitado, ok }
}

export async function leerInsights(ids: string[], desde: string, hasta: string): Promise<InsightsCuentas> {
  const r = await insightsDiarios(ids, desde, hasta, 100)
  for (const [id, dias] of Object.entries(r.porCuenta)) ultimosInsights.set(id, dias)
  for (const id of Object.keys(r.errores)) { const prev = ultimosInsights.get(id); if (prev) r.porCuenta[id] = prev }
  if (!r.ok && ids.length) throw new Error(`Meta no devolvió insights: ${Object.values(r.errores)[0] ?? 'sin detalle'}`)
  return { desde, hasta, porCuenta: r.porCuenta, errores: r.errores, limitado: r.limitado }
}

// ── Insights diarios de un rango largo (recuento por mes / fechas). No toca el "último dato bueno"
// del tablero en vivo. Hasta ~400 días por cuenta en un solo pedido (el rango se limita antes).
export async function leerInsightsRango(ids: string[], desde: string, hasta: string): Promise<InsightsCuentas> {
  const r = await insightsDiarios(ids, desde, hasta, 400)
  if (!r.ok && ids.length) throw new Error(`Meta no devolvió insights: ${Object.values(r.errores)[0] ?? 'sin detalle'}`)
  return { desde, hasta, porCuenta: r.porCuenta, errores: r.errores, limitado: r.limitado }
}

// ── Lanzamientos: anuncios ACTIVOS creados en los últimos `dias` días, agrupados por campaña ──
// (cubre campañas nuevas y anuncios nuevos dentro de campañas viejas). Fecha de lanzamiento de la
// campaña = el anuncio nuevo más viejo. Después se piden gasto y mensajes de cada campaña desde
// esa fecha, para la revisión del día 4.
export interface Lanzamiento {
  cuenta: string
  campanaId: string
  campana: string
  fecha: string            // AAAA-MM-DD (hora de Argentina)
  dm?: boolean
  inicioCompetencia?: string
  reactivada?: string      // AAAA-MM-DD: última vez que la campaña se pasó de pausada a activa (reinicia la espera de 3 días)
  creada?: string          // AAAA-MM-DD: la fecha de los anuncios ANTES de pasarla a la reactivación (borrador prendido días después ≠ reactivar una vieja)
  anuncios: number         // anuncios nuevos activos en esa campaña
  gasto: number | null     // desde la fecha de lanzamiento (moneda de la cuenta)
  mensajes: number | null
}

const fechaAR = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

// Eventos del historial de la cuenta → última fecha (AR) en que cada campaña pasó de pausada/otro estado a Activa, dentro de [desde, hasta]
export function reactivacionesDe(eventos: { event_type: string; object_id: string; event_time?: string; extra_data?: string }[], desde: string, hasta: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of eventos) {
    if (e.event_type !== 'update_campaign_run_status' || !e.event_time) continue
    let rs: { new_value?: number; old_value?: number } | undefined
    try { rs = (JSON.parse(e.extra_data ?? '{}') as { run_status?: typeof rs }).run_status } catch { continue }
    if (rs?.new_value !== 1 || rs.old_value === 1) continue
    const f = fechaAR(e.event_time)
    if (f >= desde && f <= hasta && (!out.has(e.object_id) || f > out.get(e.object_id)!)) out.set(e.object_id, f)
  }
  return out
}

// Historial de la cuenta (activities, ad_account_update_status) → fecha AR en que pasó a error de pago por última vez
// (de un estado sin error a "Pago necesario", revisión de riesgo, pago pendiente o deshabilitada). Null si no hay ese cambio en lo leído.
const ES_ERROR_PAGO = /pago necesario|payment needed|unsettled|riesgo|risk|liquidaci|settlement|deshabilitad|disabled/i
export function entradaErrorPago(eventos: { event_type: string; event_time?: string; extra_data?: string }[]): string | null {
  let ultima: { t: number; f: string } | null = null
  for (const e of eventos) {
    if (e.event_type !== 'ad_account_update_status' || !e.event_time) continue
    let d: { old_value?: string; new_value?: string }
    try { d = JSON.parse(e.extra_data ?? '{}') } catch { continue }
    if (!ES_ERROR_PAGO.test(d.new_value ?? '') || ES_ERROR_PAGO.test(d.old_value ?? '')) continue
    const t = new Date(e.event_time).getTime()
    if (!ultima || t > ultima.t) ultima = { t, f: fechaAR(e.event_time) }
  }
  return ultima?.f ?? null
}

export async function leerEntradasErrorPago(ids: string[], desde: string): Promise<{ desde: Record<string, string>; errores: Record<string, string> }> {
  const out: Record<string, string> = {}
  if (!ids.length) return { desde: out, errores: {} }
  const desdeUnix = Math.floor(new Date(`${desde}T00:00:00-03:00`).getTime() / 1000)
  const r = await batchConRespaldo(ids.map(id => ({ id, url: `${id}/activities?fields=event_type,event_time,extra_data&since=${desdeUnix}&limit=500` })))
  for (const [id, { body }] of Object.entries(r.ok)) {
    const f = entradaErrorPago((body as { data?: { event_type: string; event_time?: string; extra_data?: string }[] }).data ?? [])
    if (f) out[id] = f
  }
  return { desde: out, errores: r.errores }
}

export async function leerLanzamientos(ids: string[], desde: string, hasta: string): Promise<{ lanzamientos: Lanzamiento[]; errores: Record<string, string>; erroresPausas: Record<string, string> }> {
  const filtro = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]))
  const r = await batchConRespaldo(ids.map(id => ({ id, url: `${id}/ads?fields=id,created_time,campaign{id,name},adset{destination_type,optimization_goal}&filtering=${filtro}&limit=200` })))
  const porCampana = new Map<string, Lanzamiento>()
  for (const [id, { body }] of Object.entries(r.ok)) {
    type Anuncio = { id: string; created_time?: string; campaign?: { id: string; name: string }; adset?: { destination_type?: string; optimization_goal?: string } }
    const pagina = body as { data?: Anuncio[]; paging?: { next?: string } }
    const anuncios = [...(pagina.data ?? [])]
    let next = pagina.paging?.next
    const vistas = new Set<string>()
    let completo = true
    while (next) {
      if (vistas.has(next)) { r.errores[id] = 'Meta repitió una página de anuncios; revisión incompleta'; completo = false; break }
      vistas.add(next)
      const p = await getGraph<{ data?: Anuncio[]; paging?: { next?: string } }>(next)
      if (!p.ok) { r.errores[id] = `No se pudo completar anuncios: ${textoError(p.error)}`; completo = false; break }
      anuncios.push(...(p.data.data ?? []))
      next = p.data.paging?.next
    }
    if (!completo) continue // nunca inferir un número de competidores desde un conjunto truncado
    const recientes = new Map<string, string>()
    const vistos = new Set<string>()
    for (const a of anuncios) {
      if (vistos.has(a.id)) continue
      vistos.add(a.id)
      if (!a.created_time || !a.campaign) continue
      const f = fechaAR(a.created_time)
      const dm = /(?:^|[\[\s])DM(?:[\]\s]|$)/i.test(a.campaign.name) || a.adset?.optimization_goal === 'CONVERSATIONS' || ['MESSENGER', 'INSTAGRAM_DIRECT', 'WHATSAPP'].includes(a.adset?.destination_type ?? '')
      if (f >= desde && f <= hasta && (!recientes.has(a.campaign.id) || f < recientes.get(a.campaign.id)!)) recientes.set(a.campaign.id, f)
      const prev = porCampana.get(a.campaign.id)
      if (prev) { prev.anuncios++; prev.dm ||= dm; if (f < prev.fecha) prev.fecha = f }
      else porCampana.set(a.campaign.id, { cuenta: id, campanaId: a.campaign.id, campana: a.campaign.name, fecha: f, dm, anuncios: 1, gasto: null, mensajes: null })
    }
    for (const l of porCampana.values()) if (l.cuenta === id) { l.inicioCompetencia = l.fecha; l.fecha = recientes.get(l.campanaId) ?? l.fecha }
  }
  // Una campaña que se pausó y se volvió a activar dentro de la ventana empieza de nuevo: fecha = reactivación,
  // así se esperan otros 3 días para decir que salió de la fase de aprendizaje. Fuente: historial de la cuenta
  // (activities, update_campaign_run_status: pasa a Activa desde otro estado).
  const erroresPausas: Record<string, string> = {}
  const idsConLanz = [...new Set([...porCampana.values()].map(l => l.cuenta))]
  if (idsConLanz.length) {
    const desdeUnix = Math.floor(new Date(`${desde}T00:00:00-03:00`).getTime() / 1000)
    const act = await batchConRespaldo(idsConLanz.map(id => ({ id, url: `${id}/activities?fields=event_type,object_id,event_time,extra_data&since=${desdeUnix}&limit=500` })))
    Object.assign(erroresPausas, act.errores)
    for (const [id, { body }] of Object.entries(act.ok)) {
      const pag = body as { data?: { event_type: string; object_id: string; event_time?: string; extra_data?: string }[]; paging?: { next?: string } }
      if (pag.paging?.next) { erroresPausas[id] = 'Historial de la cuenta incompleto (más de 500 eventos)'; continue }
      for (const [campanaId, f] of reactivacionesDe(pag.data ?? [], desde, hasta)) {
        const l = porCampana.get(campanaId)
        if (l) l.reactivada = f
      }
    }
    for (const l of porCampana.values()) if (l.reactivada) { if (l.reactivada > l.fecha) { l.creada = l.fecha; l.fecha = l.reactivada; l.inicioCompetencia = l.reactivada } else delete l.reactivada }
  }
  const lanz = [...porCampana.values()]
  if (lanz.length) {
    // Gasto y mensajes en consultas separadas: juntos, Meta devuelve spend "0" en muchas cuentas (ver insightsDiarios)
    const recientes = lanz.filter(l => l.fecha >= desde)
    const url = (l: Lanzamiento, campos: string) => `${l.campanaId}/insights?fields=${campos}&time_range=${encodeURIComponent(JSON.stringify({ since: l.fecha, until: hasta }))}`
    const ins = await batchConRespaldo(recientes.flatMap(l => [{ id: `${l.campanaId}#g`, url: url(l, 'spend') }, { id: `${l.campanaId}#m`, url: url(l, 'actions') }]))
    for (const l of recientes) {
      const g = ins.ok[`${l.campanaId}#g`], m = ins.ok[`${l.campanaId}#m`]
      if (!g || !m) continue
      const fg = ((g.body as { data?: { spend?: string }[] }).data ?? [])[0]
      const fm = ((m.body as { data?: { actions?: { action_type: string; value: string }[] }[] }).data ?? [])[0]
      l.gasto = parseFloat(fg?.spend ?? '0') || 0
      l.mensajes = parseInt(fm?.actions?.find(a => a.action_type === ACCION_MENSAJE)?.value ?? '0') || 0
    }
  }
  return { lanzamientos: lanz.sort((a, b) => b.fecha.localeCompare(a.fecha)), errores: r.errores, erroresPausas }
}
