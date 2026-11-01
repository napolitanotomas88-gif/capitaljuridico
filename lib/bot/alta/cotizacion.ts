// ── Bot "Capital Jurídico": cotización de otras monedas contra el dólar (comprobantes que no son USD ni ARS) ────────
// Tomás, 1/11/2026: "comparalo con el comprobante de acá en adelante". El alta de Nadia Blanco decía USD 1.299 y el
// comprobante era de ₲ 3.107.995 (unos USD 500): el bot no lo comparó porque la moneda no era USD ni pesos.
// Fuente: currency-api (fawazahmed0), gratis y sin clave, con histórico por día: un JSON por fecha con { usd: { pyg: … } }.
// Es una cotización de mercado: la pasarela (dLocal, etc.) cobra con la suya, por eso la comparación tiene margen amplio.
// SOLO SERVIDOR: buscarCotizacionUsd() sale a internet. La parte pura (cotizacionDe) se prueba en scripts/test-bot-alta.mjs.

export interface CotizacionUsd {
  iso: string       // 'PYG'
  porUsd: number    // unidades de esa moneda por 1 USD
  fecha: string     // 'aaaa-mm-dd' de la cotización usada
  fuente: string
}

export const FUENTE_COTIZACION = 'currency-api'
export const esIso = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v)

/** Puro: la cotización de `iso` en el JSON de currency-api. null si no está o no es un número positivo. */
export function cotizacionDe(json: unknown, iso: string): CotizacionUsd | null {
  if (!esIso(iso) || !json || typeof json !== 'object') return null
  const o = json as { date?: unknown; usd?: Record<string, unknown> }
  const v = o.usd?.[iso.toLowerCase()]
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null
  return { iso, porUsd: v, fecha: typeof o.date === 'string' ? o.date : '', fuente: FUENTE_COTIZACION }
}

/** Con red (solo servidor): la cotización de `iso` del día `fecha` ('aaaa-mm-dd'). Dos espejos; null si ninguno responde. */
export async function buscarCotizacionUsd(iso: string, fecha: string): Promise<CotizacionUsd | null> {
  if (!esIso(iso) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${fecha}/v1/currencies/usd.json`,
    `https://${fecha}.currency-api.pages.dev/v1/currencies/usd.json`,
  ]
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8_000) })
      if (!r.ok) continue
      const c = cotizacionDe(await r.json(), iso)
      if (c) return c
    } catch { /* el otro espejo */ }
  }
  return null
}
