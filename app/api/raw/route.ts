import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi } from '@/lib/auth/acceso'
import { fetchRawData } from '@/lib/rawSheets'
import { serializeRaw } from '@/lib/serializeRaw'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Fechas de calls/transactions como día puro "YYYY-MM-DD" (ver lib/serializeRaw.ts).
// Acceso: sesión de Google con rol que ve el Resumen, o Authorization: Bearer CRON_SECRET (lib/auth/rutas.ts).
// El proxy ya lo exige; se repite acá por si el proxy no corre.
export async function GET(req: Request) {
  await asegurarUsuarios()
  const denegado = exigirAccesoApi(req, 'resumen', { maquina: true })
  if (denegado) return denegado
  try {
    return NextResponse.json(serializeRaw(await fetchRawData({ ligero: true })))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
