import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi } from '@/lib/auth/acceso'
import { conCache } from '@/lib/anuncios/cache'
import { CLAVE_RAW_COMPARTIDA, ETIQUETA_RAW, fetchRawData } from '@/lib/rawSheets'
import { serializeRaw } from '@/lib/serializeRaw'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Fechas de calls/transactions como día puro "YYYY-MM-DD" (ver lib/serializeRaw.ts).
// Acceso: sesión de Google con rol que ve el Resumen, o Authorization: Bearer CRON_SECRET (lib/auth/rutas.ts).
// El proxy ya lo exige; se repite acá por si el proxy no corre.
// Caché COMPARTIDA entre instancias (conCache) de la respuesta ya serializada, 60 s: vencida, sale la anterior y se renueva
// de fondo (lo mismo que hacía fetchRawData en la memoria de cada instancia). invalidarCacheRaw() la invalida.
export async function GET(req: Request) {
  await asegurarUsuarios()
  const denegado = exigirAccesoApi(req, 'resumen', { maquina: true })
  if (denegado) return denegado
  try {
    const r = await conCache(CLAVE_RAW_COMPARTIDA, 60, async () => serializeRaw(await fetchRawData({ ligero: true })), { etiquetas: [ETIQUETA_RAW] })
    return NextResponse.json(r.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
