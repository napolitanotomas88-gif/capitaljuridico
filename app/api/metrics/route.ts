import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi } from '@/lib/auth/acceso'
import { conCache } from '@/lib/anuncios/cache'
import { fetchDashboardData } from '@/lib/sheets'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Acceso: sesión de Google con rol que ve el Resumen, o Authorization: Bearer CRON_SECRET (lib/auth/rutas.ts).
// El proxy ya lo exige; se repite acá por si el proxy no corre.
// Caché COMPARTIDA entre instancias (conCache), 60 s, con la anterior mientras se renueva de fondo. Nada en el Despacho
// escribe esas celdas: se cargan a mano en las planillas.
export async function GET(req: Request) {
  await asegurarUsuarios()
  const denegado = exigirAccesoApi(req, 'resumen', { maquina: true })
  if (denegado) return denegado
  try {
    const r = await conCache('resumen-metricas-v1', 60, fetchDashboardData)
    return NextResponse.json(r.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
