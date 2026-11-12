import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { calificada, FACTURACIONES, letraDe, URGENCIAS } from '@/lib/embudoWa/letra'
import { guardarLead, marcarCapi } from '@/lib/embudoWa/db'
import { enviarEvento } from '@/lib/embudoWa/capi'
import { cabecerasCors, origenPermitido } from '@/lib/embudoWa/cors'
import { normalizarTel } from '@/lib/embudoWa/tel'
import { esperaSegundos, seguimientoEncendido, seguirLead } from '@/lib/embudoWa/seguimiento'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Formulario de la landing del embudo formulario → WhatsApp (público, sin sesión: solo acepta el origen de la landing).
// Calcula la letra con la matriz del CRM, guarda el lead y, si es A o B, manda el evento de conversión por la API de
// conversiones con el mismo event_id que dispara el píxel del navegador. Todos los leads pasan a la página de gracias.
export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cabecerasCors(req.headers.get('origin')) })
}

const texto = (v: unknown, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export async function POST(req: Request) {
  const origen = req.headers.get('origin')
  const cors = cabecerasCors(origen)
  if (!origenPermitido(origen)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403, headers: cors })
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: cors }) }
  if (texto(b.web)) return NextResponse.json({ ok: true, id: '', letra: 'E', calificado: false }, { headers: cors }) // trampa para bots

  const nombre = texto(b.nombre), apellido = texto(b.apellido)
  const telefono = texto(b.telefono, 30).replace(/[^\d+]/g, '')
  const facturacion = texto(b.facturacion), urgencia = texto(b.urgencia)
  const digitos = normalizarTel(telefono)
  if (!nombre || !apellido || digitos.length < 8 || digitos.length > 15
    || !(FACTURACIONES as readonly string[]).includes(facturacion) || !(URGENCIAS as readonly string[]).includes(urgencia)) {
    return NextResponse.json({ error: 'Faltan datos o hay un dato inválido' }, { status: 400, headers: cors })
  }

  const letra = letraDe(urgencia, facturacion)
  const ok = calificada(letra)
  const id = crypto.randomUUID()
  const url = texto(b.url, 500) || 'https://capitaljuridico.com.ar/'
  const o: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'fbp', 'fbc', 'url'] as const) {
    const v = texto(b[k], 500); if (v) o[k] = v
  }
  await guardarLead({ id, nombre, apellido, telefono: digitos, facturacion, urgencia, letra, calificado: ok, origen: o })

  if (ok) {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
    const ua = req.headers.get('user-agent')
    after(async () => {
      const r = await enviarEvento({ eventId: id, url, ip, ua, fbp: o.fbp, fbc: o.fbc, telefono: digitos, nombre, apellido, letra })
      await marcarCapi(id, r.ok, r.error).catch(() => {})
    })
  }
  // Seguimiento por WhatsApp (todas las letras): espera y, si no hay conversación, 2Chat manda un mensaje del setter.
  if (seguimientoEncendido()) {
    after(async () => {
      await new Promise((r) => setTimeout(r, esperaSegundos() * 1000))
      await seguirLead(id, digitos, nombre)
    })
  }
  // La letra no se le muestra al lead: la página solo la usa para decidir si dispara el píxel.
  return NextResponse.json({ ok: true, id, calificado: ok }, { headers: cors })
}
