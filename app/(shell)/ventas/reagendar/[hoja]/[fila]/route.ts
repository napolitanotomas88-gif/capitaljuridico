import { NextResponse } from 'next/server'
import { puedeVerHoja, sesionActual } from '@/lib/crm/auth'
import { nombreCloserDeHoja } from '@/lib/crm/config'
import { filaVisible } from '@/lib/crm/config/crm'
import { linkReprogramacion } from '@/lib/crm/calendlyReagenda'
import { decodificarParam } from '@/lib/crm/entrada'
import { leerFila } from '@/lib/crm/sheets/leer'

export const dynamic = 'force-dynamic'

// "Reagendar en Calendly" (tarjetas de Pre-call y No-show, pedidos de Tomás del 19 y 22/10/2026): busca la reunión del lead en
// Calendly y redirige a su link de reprogramación (con el mismo closer si el evento round robin tiene "Use same hosts as
// original meeting"). Calendly libera el horario viejo, mueve el evento en Google Calendar y avisa al webhook, que actualiza la
// fila del CRM (lib/crm/calendlyReagenda.ts). Si la reunión ya pasó, abre el evento "Reagenda" de su closer.
// Mismo acceso que la ficha: sesión del CRM y la hoja tiene que ser suya (el socio, cualquiera).

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function aviso(titulo: string, texto: string, status = 200) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(titulo)}</title>
<style>body{margin:0;background:#f2eadc;color:#1d1d1b;font-family:Georgia,serif;display:grid;place-items:center;min-height:100vh;padding:16px}main{max-width:520px;background:#fffdf8;border:1px solid #d6cbb8;border-radius:16px;padding:24px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5}button{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid #1d1d1b;background:#fffdf8;font:inherit;font-weight:700;cursor:pointer}</style></head>
<body><main><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p><button onclick="window.close()">Cerrar esta pestaña</button></main></body></html>`
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

export async function GET(_req: Request, ctx: { params: Promise<{ hoja: string; fila: string }> }) {
  const sesion = await sesionActual()
  if (!sesion) return aviso('Sin acceso', 'Entrá al Despacho con tu cuenta de Google y volvé a tocar el botón.', 401)
  const { hoja: h, fila: f } = await ctx.params
  const hoja = decodificarParam(h)
  const numeroFila = Number(decodificarParam(f))
  if (!hoja || !Number.isInteger(numeroFila) || numeroFila < 2 || !filaVisible(hoja, numeroFila) || !puedeVerHoja(sesion, hoja))
    return aviso('Lead no disponible', 'No tenés acceso a este lead o la dirección no es válida.', 404)
  const fila = await leerFila(hoja, numeroFila)
  if (!fila) return aviso('Lead no encontrado', 'Esa fila ya no tiene un lead. Actualizá el CRM y probá de nuevo.', 404)
  const r = await linkReprogramacion(fila, nombreCloserDeHoja(hoja)).catch((e) => ({ error: `No se pudo consultar Calendly (${String(e?.message ?? e).slice(0, 80)}).` }))
  if ('url' in r) return NextResponse.redirect(r.url, 302)
  return aviso('No pude abrir la reagenda en Calendly', `${r.error} Reagendala desde Calendly a mano (no desde Google Calendar), así el CRM se actualiza solo.`)
}
