import { NextResponse } from 'next/server'
import { sendDiscord } from '@/lib/discord'
import { hoyYMD, sumarDias } from '@/lib/eodSetter'
import { bearerValido } from '@/lib/trazabilidad/clave'
import { cargarDatos } from '@/lib/trazabilidad/leads'
import { ETIQUETA_ORIGEN } from '@/lib/trazabilidad/modelo'
import { diasEOD, domingoDe, enviosDelRango, resumenEnvios } from '@/lib/trazabilidad/semanal'
import { textoSemanal } from '@/lib/trazabilidad/semanalTexto'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Semanal de setting a Discord, los lunes (cron 11:00 UTC = 8:00 AR): la semana domingo–sábado que terminó.
// ?preview=1 devuelve el texto sin mandarlo; ?semana=YYYY-MM-DD elige otra semana. Bearer CRON_SECRET, falla cerrado.
// Canal: TRAZ_DISCORD_WEBHOOK, o el de enrutamientos (donde ya llega el EOD de la setter).
export async function GET(req: Request) {
  if (!bearerValido(req, process.env.CRON_SECRET)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const url = new URL(req.url)
  try {
    const ref = url.searchParams.get('semana') ?? sumarDias(hoyYMD(), -7)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) return NextResponse.json({ error: 'semana inválida' }, { status: 400 })
    const domingo = domingoDe(ref), sabado = sumarDias(domingo, 6)
    const [{ dias, aviso }, datos] = await Promise.all([diasEOD(domingo), cargarDatos()])
    const res = resumenEnvios(enviosDelRango(datos.envios, domingo, sabado))
    const cierres = datos.leads.filter((l) => l.cierre.fecha && l.cierre.fecha >= domingo && l.cierre.fecha <= sabado)
    const partes = textoSemanal({
      domingo, dias,
      botonera: { total: res.total, origenes: res.origenes.map(([o, k]) => [ETIQUETA_ORIGEN[o], k]) },
      cierres: cierres.map((l) => ({ nombre: l.cierre.nombre, muestra: l.cierre.grupo === 'muestra', setting: !!l.setting?.analisis, llamada: !!l.llamada?.analisis })),
      url: `https://despacho-capital-juridico.vercel.app/trazabilidad/semanal?semana=${domingo}`,
    })
    if (aviso) partes.splice(1, 0, `⚠️ ${aviso}`)
    if (url.searchParams.get('preview')) return NextResponse.json({ preview: partes.join('\n\n') })
    const r = await sendDiscord(partes, process.env.TRAZ_DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK_ENRUTAMIENTO)
    return NextResponse.json(r, { status: r.enviado ? 200 : 500 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
