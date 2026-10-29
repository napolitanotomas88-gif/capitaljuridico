// ── Dólar en Argentina (precio de VENTA) para pasar los montos en pesos a USD ─────────────────
//   · Hoy:       dolarapi.com/v1/dolares → oficial, blue, bolsa (MEP), tarjeta… (se usa la venta)
//   · Histórico: api.argentinadatos.com/v1/cotizaciones/dolares/{casa} → venta de cada día, para el
//     recuento por mes (el gasto de cada día se pasa con el dólar de ESE día).
// Son fuentes públicas sin clave. Si fallan, el tablero sigue en pesos y lo avisa.
export type CasaDolar = 'oficial' | 'blue' | 'bolsa' | 'tarjeta'
export const CASAS: { id: CasaDolar; nombre: string }[] = [
  { id: 'oficial', nombre: 'Oficial' },
  { id: 'blue', nombre: 'Blue' },
  { id: 'bolsa', nombre: 'MEP' },
  { id: 'tarjeta', nombre: 'Tarjeta' },
]
export const esCasa = (x: unknown): x is CasaDolar => CASAS.some(c => c.id === x)

export interface CotizacionHoy { venta: number; fecha: string }
export type DolarHoy = Partial<Record<CasaDolar, CotizacionHoy>>

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`${new URL(url).host} respondió ${r.status}`)
  return r.json() as Promise<T>
}

export async function dolarHoy(): Promise<DolarHoy> {
  const xs = await getJSON<{ casa: string; venta: number; fechaActualizacion: string }[]>('https://dolarapi.com/v1/dolares')
  const out: DolarHoy = {}
  for (const x of xs) if (esCasa(x.casa) && x.venta > 0) out[x.casa] = { venta: x.venta, fecha: x.fechaActualizacion }
  if (!Object.keys(out).length) throw new Error('dolarapi no devolvió cotizaciones')
  return out
}

// Venta por fecha 'AAAA-MM-DD' (solo días con cotización: fines de semana y feriados no tienen)
export async function dolarHistorico(casa: CasaDolar): Promise<Record<string, number>> {
  const xs = await getJSON<{ fecha: string; venta: number }[]>(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${casa}`)
  const out: Record<string, number> = {}
  for (const x of xs) if (x.venta > 0 && x.fecha >= '2024-01-01') out[x.fecha.slice(0, 10)] = x.venta
  if (!Object.keys(out).length) throw new Error('argentinadatos no devolvió cotizaciones')
  return out
}

// Venta de un día: la de esa fecha o, si no hubo (fin de semana / feriado), la del último día anterior con cotización
export function ventaDelDia(historico: Record<string, number>, fecha: string, fechasOrdenadas?: string[]): number | null {
  if (historico[fecha]) return historico[fecha]
  const fs = fechasOrdenadas ?? Object.keys(historico).sort()
  let lo = 0, hi = fs.length - 1, res = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (fs[mid] <= fecha) { res = mid; lo = mid + 1 } else hi = mid - 1 }
  return res >= 0 ? historico[fs[res]] : null
}

// ── Otras monedas (UYU, PEN, CLP, MXN…): cuántas unidades vale 1 USD ──
// Fuente pública sin clave (fawazahmed0/currency-api, por jsDelivr; respaldo en pages.dev). Con
// fecha 'AAAA-MM-DD' devuelve la cotización de ese día (para el recuento por mes); sin fecha, la de hoy.
export async function monedasPorUSD(fecha?: string): Promise<Record<string, number>> {
  const v = fecha ?? 'latest'
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${v}/v1/currencies/usd.json`,
    `https://${v}.currency-api.pages.dev/v1/currencies/usd.json`,
  ]
  let ultimo: unknown
  for (const u of urls) {
    try {
      const j = await getJSON<{ usd?: Record<string, number> }>(u)
      const out: Record<string, number> = {}
      for (const [k, n] of Object.entries(j.usd ?? {})) if (typeof n === 'number' && n > 0) out[k.toUpperCase()] = n
      if (Object.keys(out).length) return out
    } catch (e) { ultimo = e }
  }
  throw ultimo ?? new Error('sin cotizaciones de otras monedas')
}
