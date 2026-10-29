import { NextResponse } from 'next/server'
import { bearerValido } from '@/lib/trazabilidad/clave'
import { configurada } from '@/lib/trazabilidad/db'
import { procesarPendientes } from '@/lib/trazabilidad/leads'
import { importarDesdeManyChat, manychatConfigurado } from '@/lib/trazabilidad/manychat'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Cron diario (10:00 UTC = 7:00 AR): importa de ManyChat las etiquetas de los cierres nuevos sin setting (si hay
// MANYCHAT_API_KEY), analiza los envíos sin análisis y trae de Fathom las llamadas que faltan. Bearer CRON_SECRET, falla cerrado.
export async function GET(req: Request) {
  if (!bearerValido(req, process.env.CRON_SECRET)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  if (!configurada()) return NextResponse.json({ error: 'Base de datos no conectada' }, { status: 503 })
  try {
    const manychat = manychatConfigurado() ? await importarDesdeManyChat({ escribir: true, tope: 25 }).catch((e) => ({ error: (e as Error).message })) : null
    return NextResponse.json({ manychat, ...(await procesarPendientes()) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
