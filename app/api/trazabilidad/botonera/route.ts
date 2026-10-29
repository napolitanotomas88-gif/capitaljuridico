import { after, NextResponse } from 'next/server'
import { configurada, guardarSetting } from '@/lib/trazabilidad/db'
import { bearerValido } from '@/lib/trazabilidad/clave'
import { procesarSetting } from '@/lib/trazabilidad/leads'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Botón "Enviar al Despacho" de la botonera de ManyChat (extensión de Chrome). Recibe el resumen que la botonera ya
// generó, las etiquetas y campos del contacto (getInfo de ManyChat) y, si la hay, la transcripción del chat. Lo guarda
// (un registro por contacto: reenviar lo pisa) y lo analiza después de responder. Bearer TRAZABILIDAD_KEY.
const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '')

export async function POST(req: Request) {
  if (!process.env.TRAZABILIDAD_KEY?.trim()) return NextResponse.json({ error: 'Falta configurar TRAZABILIDAD_KEY' }, { status: 503 })
  if (!bearerValido(req, process.env.TRAZABILIDAD_KEY)) return NextResponse.json({ error: 'Clave del Despacho incorrecta' }, { status: 401 })
  if (!configurada()) return NextResponse.json({ error: 'Base de datos no conectada' }, { status: 503 })
  let b: Record<string, unknown>
  try {
    b = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const subscriberId = texto(b.subscriber_id, 40).trim()
  if (!/^\d{3,30}$/.test(subscriberId)) return NextResponse.json({ error: 'Falta el subscriber ID del contacto' }, { status: 400 })
  const resumen = texto(b.resumen, 40_000)
  if (!resumen.trim()) return NextResponse.json({ error: 'Falta el resumen: generalo con la botonera antes de enviar' }, { status: 400 })
  const etiquetas = Array.isArray(b.etiquetas) ? b.etiquetas.map((t) => texto(typeof t === 'object' && t ? (t as { name?: unknown }).name : t, 200)).filter(Boolean).slice(0, 500) : []
  const campos = b.campos && typeof b.campos === 'object' && !Array.isArray(b.campos) ? Object.fromEntries(Object.entries(b.campos as Record<string, unknown>).slice(0, 200).map(([k, v]) => [k.slice(0, 120), texto(v, 1000)])) : {}
  await guardarSetting({
    subscriberId, resumen, etiquetas, campos,
    nombre: texto(b.nombre, 200), igUsuario: texto(b.ig_usuario, 100).replace(/^@/, ''), telefono: texto(b.telefono, 40), email: texto(b.email, 200),
    transcript: texto(b.transcript, 300_000), enviadoPor: texto(b.enviado_por, 80),
  })
  after(() => procesarSetting(subscriberId).catch((e) => console.error('Trazabilidad: análisis de setting falló:', (e as Error).message?.slice(0, 200))))
  return NextResponse.json({ ok: true, mensaje: 'Guardado en el Despacho. El análisis tarda un minuto.' })
}
