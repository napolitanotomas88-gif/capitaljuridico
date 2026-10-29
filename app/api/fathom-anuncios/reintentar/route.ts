import { NextResponse } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { cronReintentos } from '@/lib/fathomAnuncios/servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Cron diario de reintentos de Fathom → cambios de anuncios (vercel.json, "30 11 * * *" = 8:30 AR; en Hobby Vercel lo
// dispara en algún momento entre las 8:00 y las 8:59). Es una ruta hija y no "/api/fathom-anuncios?reintentar=1"
// porque Vercel no documenta que respete una query en el path de un cron.
// Retoma hasta 5 grabaciones en error o colgadas en "procesando" (con el payload guardado e intentos < 4), en serie y
// dentro del tiempo de la función; las que no tienen payload se avisan a Tomás una vez. Detalle en procesar.ts
// (reintentarPendientes) y en docs/FATHOM-ANUNCIOS.md. Solo con "Authorization: Bearer <CRON_SECRET>" (Vercel lo manda
// solo); nunca ?key=. Sin CRON_SECRET no abre.
export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return NextResponse.json({ error: 'no autorizado' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  return cronReintentos()
}
