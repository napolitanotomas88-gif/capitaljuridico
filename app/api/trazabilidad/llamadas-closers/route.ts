import { NextResponse } from 'next/server'
import { bearerValido } from '@/lib/trazabilidad/clave'
import { revisarPendientes, sincronizar } from '@/lib/trazabilidad/llamadasCloser'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Cron diario (10:30 UTC = 7:30 AR): trae de Fathom las llamadas de los closers de los últimos 2 días y arma la revisión
// en español de las que no la tienen (hasta 6 por corrida). ?dias=N para traer más atrás (máx. 30). Bearer CRON_SECRET.
export async function GET(req: Request) {
  if (!bearerValido(req, process.env.CRON_SECRET)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const url = new URL(req.url)
  const dias = Math.max(1, Math.min(30, Number(url.searchParams.get('dias') ?? 2)))
  const tope = Math.max(0, Math.min(12, Number(url.searchParams.get('revisar') ?? 6)))
  try {
    const sync = await sincronizar(dias)
    const rev = tope ? await revisarPendientes(tope) : { revisadas: 0, errores: [] }
    return NextResponse.json({ ...sync, revisadas: rev.revisadas, erroresRevision: rev.errores })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
