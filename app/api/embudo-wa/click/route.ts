import { NextResponse } from 'next/server'
import { marcarClick } from '@/lib/embudoWa/db'
import { cabecerasCors, origenPermitido } from '@/lib/embudoWa/cors'

export const dynamic = 'force-dynamic'

// El lead tocó el botón de WhatsApp en la página de gracias (no prueba que haya mandado el mensaje: eso lo dice 2Chat).
export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cabecerasCors(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const origen = req.headers.get('origin')
  const cors = cabecerasCors(origen)
  if (!origenPermitido(origen)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403, headers: cors })
  let id = ''
  try { id = String((await req.json())?.id ?? '') } catch { /* sendBeacon puede mandar texto */ }
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400, headers: cors })
  return NextResponse.json({ ok: await marcarClick(id) }, { headers: cors })
}
