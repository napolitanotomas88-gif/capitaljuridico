import { NextResponse } from 'next/server'
import { bearerValido } from '@/lib/trazabilidad/clave'
import { configurada } from '@/lib/trazabilidad/db'
import { procesarPendientes } from '@/lib/trazabilidad/leads'
import { importarDesdeManyChat, importarPares, manychatConfigurado } from '@/lib/trazabilidad/manychat'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Importa a Trazabilidad las etiquetas de ManyChat de los cierres sin setting. Bearer CRON_SECRET, falla cerrado.
//   GET                 → prueba: cuántos cierres encuentra en ManyChat y por qué vía, SIN escribir nada
//   GET ?escribir=1     → guarda y vincula los encontrados (&tope=N, por defecto 200)
//   GET ?analizar=N     → analiza con Claude hasta N envíos pendientes (los importados quedan sin analizar hasta acá o el cron)
//   POST {pares:[{clave, subscriber_id, via}], escribir} → pares ya cruzados afuera (Instagram de Calendly → ID de ManyChat):
//                         devuelve nombre e Instagram de ManyChat para revisar y, con escribir=true, guarda y vincula
export async function GET(req: Request) {
  if (!bearerValido(req, process.env.CRON_SECRET)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  if (!configurada()) return NextResponse.json({ error: 'Base de datos no conectada' }, { status: 503 })
  const url = new URL(req.url)
  try {
    const analizar = Number(url.searchParams.get('analizar') ?? 0)
    if (analizar > 0) return NextResponse.json(await procesarPendientes({ setting: Math.min(analizar, 25), llamadas: 0 }))
    if (!manychatConfigurado()) return NextResponse.json({ error: 'Falta MANYCHAT_API_KEY en Vercel' }, { status: 503 })
    const tope = Math.max(1, Math.min(300, Number(url.searchParams.get('tope') ?? 200)))
    return NextResponse.json(await importarDesdeManyChat({ escribir: url.searchParams.get('escribir') === '1', tope }))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!bearerValido(req, process.env.CRON_SECRET)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  if (!configurada()) return NextResponse.json({ error: 'Base de datos no conectada' }, { status: 503 })
  if (!manychatConfigurado()) return NextResponse.json({ error: 'Falta MANYCHAT_API_KEY en Vercel' }, { status: 503 })
  let b: { pares?: unknown; escribir?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (!Array.isArray(b.pares)) return NextResponse.json({ error: 'Falta pares' }, { status: 400 })
  const pares = b.pares.filter((p): p is { clave: string; subscriber_id: string; via?: string } => !!p && typeof (p as { clave?: unknown }).clave === 'string' && /^\d{3,}$/.test(String((p as { subscriber_id?: unknown }).subscriber_id ?? '')))
  try {
    return NextResponse.json({ revision: await importarPares(pares, b.escribir === true) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
