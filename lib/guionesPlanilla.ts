// ── Guiones: las fechas de guiones y grabaciones de la planilla «Guiones y Videos», por cliente (SOLO servidor) ─────────
// La tabla de /guiones solo necesita cuatro datos chicos por cliente (último guion, fechas de entrega, si grabó y cuándo),
// pero salen de fetchRawData, que arma TODO el Resumen: planillas de Finanzas, Ventas y CRM, tres consultas a GA4, el gasto
// de Meta del año y ClickUp, sin tope de espera y con caché solo en la memoria de cada instancia. En una instancia fría eso
// dejaba /guiones sin responder hasta que terminara (13/11/2026: 17 s y 61 s hasta el primer byte).
// Acá se guarda SOLO ese recorte en la caché compartida entre instancias (conCache, la de /anuncios), con
// stale-while-revalidate, y la pantalla no lo espera más de `esperaMs`: si no llega, sale sin ese dato y avisa (igual que
// Meta y Drive), y la lectura sigue de fondo para que la próxima carga ya lo tenga.
// Vive fuera de lib/clientes a propósito: esa carpeta es del CRM y de Referidos (scripts/test-pantallas.mjs la revisa).
import { after } from 'next/server'
import { conCache } from './anuncios/cache'
import { claveNombre, type GuionesPlanilla } from './clientes/prioridad'

const CACHE_SEG = 120
type Par = [string, GuionesPlanilla]

async function leerRecorte(): Promise<Par[]> {
  const { fetchRawData } = await import('./rawSheets')
  const raw = await fetchRawData({ ligero: true })
  // Una lectura de Sheets fallida devuelve cero filas sin error: no se guarda sobre el último recorte bueno
  if (raw.grabaciones.length === 0) throw new Error('la planilla de guiones vino sin filas')
  return raw.grabaciones.map((g): Par => [claveNombre(g.cliente), {
    ultimoGuion: g.ultimoGuion ?? null, fechasGuiones: g.fechasGuiones ?? [], grabado: g.grabado, ultimaGrabacion: g.ultimaGrabacion,
  }])
}

/** Guiones y grabaciones de la planilla por nombre de cliente (claveNombre). Nunca rechaza: sin dato, mapa vacío y aviso. */
export async function guionesDePlanilla(esperaMs = 6_000): Promise<{ porNombre: Map<string, GuionesPlanilla>; aviso: string | null }> {
  const vacio = new Map<string, GuionesPlanilla>()
  try {
    const lectura = conCache('guiones-planilla-v1', CACHE_SEG, leerRecorte)
    const deFondo = lectura.then(() => undefined, () => undefined)
    // Si vence el tope, la lectura termina aunque la respuesta ya haya salido (en Vercel, after() mantiene viva la función)
    try { after(() => deFondo) } catch { /* fuera de un pedido de Next (scripts, pruebas): no hace falta */ }
    const r = await Promise.race([lectura, new Promise<null>(res => setTimeout(() => res(null), esperaMs))])
    if (!r) return { porNombre: vacio, aviso: 'La planilla de guiones tardó en responder: se muestra sin fechas de guiones ni grabaciones (recargá en un minuto).' }
    return {
      porNombre: new Map(Array.isArray(r.data) ? r.data : []),
      aviso: r.viejo ? 'La planilla de guiones no respondió: las fechas de guiones y grabaciones son de la última lectura.' : null,
    }
  } catch (e) {
    console.error('[guiones] planilla:', String((e as Error)?.message ?? e).slice(0, 120))
    return { porNombre: vacio, aviso: 'No se pudo leer la planilla de guiones: sin fechas de guiones ni grabaciones.' }
  }
}
