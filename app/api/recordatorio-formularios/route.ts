import { NextResponse } from 'next/server'
import { buildRecordatorioFormularios, sendDiscord } from '@/lib/discord'

export const dynamic = 'force-dynamic'

// Cron de Vercel los días 1 y 15 (9:00 AR). ?preview=1 devuelve el texto sin enviar.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get('key') !== secret))
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const partes = buildRecordatorioFormularios()
  if (url.searchParams.get('preview')) return NextResponse.json({ preview: partes.join('\n\n') })
  const r = await sendDiscord(partes)
  return NextResponse.json(r, { status: r.enviado ? 200 : 500 })
}
