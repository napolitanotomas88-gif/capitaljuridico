import { NextResponse } from 'next/server'
import { sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { baseConfigurada, conectados, latido } from '@/lib/presencia/registro'

export const dynamic = 'force-dynamic'

// Quién está conectado (lib/presencia/registro.ts). Regla en lib/auth/rutas.ts: sesión de Google de cualquier rol.
//   · POST { ruta }: la pestaña avisa que sigue abierta (components/shell/Latido.tsx). Mismo origen, cuerpo chico. El
//     usuario de prueba de desarrollo no se registra.
//   · GET: los conectados de los últimos 2 minutos. Los ve todo el equipo (decisión de Tomás, 27/10/2026: «TODOS»).
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function POST(req: Request) {
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return json({ error: 'sin sesión' }, 401)
  if (!mismoOrigen(req.headers)) return json({ error: 'origen no permitido' }, 403)
  if (sesion.esDePrueba) return json({ ok: true, prueba: true })
  if (!baseConfigurada()) return json({ ok: false, motivo: 'sin base' }, 503)
  const texto = await req.text()
  if (texto.length > 1000) return json({ error: 'cuerpo demasiado grande' }, 413)
  let ruta: unknown = '/'
  try {
    ruta = (JSON.parse(texto || '{}') as { ruta?: unknown }).ruta
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }
  try {
    await latido({ email: sesion.email, nombre: sesion.nombre, ruta: String(ruta ?? '/') })
    return json({ ok: true })
  } catch (e) {
    console.error('presencia: no se pudo registrar el latido —', (e as Error)?.message?.slice(0, 120))
    return json({ ok: false }, 503)
  }
}

export async function GET(req: Request) {
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return json({ error: 'sin sesión' }, 401)
  if (!baseConfigurada()) return json({ conectados: [] })
  try {
    return json({ conectados: await conectados() })
  } catch (e) {
    console.error('presencia: no se pudo leer —', (e as Error)?.message?.slice(0, 120))
    return json({ conectados: [], error: 'no se pudo leer' }, 503)
  }
}
