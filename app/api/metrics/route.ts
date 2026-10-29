import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi } from '@/lib/auth/acceso'
import { fetchDashboardData } from '@/lib/sheets'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Acceso: sesión de Google con rol que ve el Resumen, o Authorization: Bearer CRON_SECRET (lib/auth/rutas.ts).
// El proxy ya lo exige; se repite acá por si el proxy no corre.
export async function GET(req: Request) {
  await asegurarUsuarios()
  const denegado = exigirAccesoApi(req, 'resumen', { maquina: true })
  if (denegado) return denegado
  try {
    const data = await fetchDashboardData()
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
