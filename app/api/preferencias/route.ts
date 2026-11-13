import { NextResponse } from 'next/server'
import { sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { baseConfigurada, guardarPreferencias, leerPreferencias, normalizarPreferencias } from '@/lib/finanzasSkwd/preferencias'

export const dynamic = 'force-dynamic'

// Modo nocturno del cristal en todo el Despacho (2/11/2026, pedido de Tomás: «acomodá toda la interfaz con el tema nuevo»).
// Misma tabla y misma clave (el correo) que /api/finanzas/preferencias: lo que cada cuenta elige vale igual en Finanzas y en
// el resto del Despacho. Regla en lib/auth/rutas.ts: sesión de Google de cualquier rol. POST { noche }: lo suma a lo guardado.
// GET: lo guardado en la cuenta ({ prefs }, null si nada). El marco ya no espera a la base cuando hay cookie: el navegador
// lo pide después y corrige la cookie si la cuenta dice otra cosa (components/shell/SincronizarNoche.tsx).
const SIN_CACHE = { 'Cache-Control': 'private, no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function GET(req: Request) {
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return json({ error: 'sin sesión' }, 401)
  if (sesion.esDePrueba || !baseConfigurada()) return json({ prefs: null })
  try {
    return json({ prefs: await leerPreferencias(sesion.email) })
  } catch {
    return json({ error: 'No se pudieron leer las preferencias' }, 502)
  }
}

export async function POST(req: Request) {
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return json({ error: 'sin sesión' }, 401)
  if (!mismoOrigen(req.headers)) return json({ error: 'origen no permitido' }, 403)
  if (sesion.esDePrueba) return json({ ok: true, prueba: true })
  if (!baseConfigurada()) return json({ error: 'Falta DATABASE_URL' }, 503)
  const texto = await req.text()
  if (texto.length > 500) return json({ error: 'cuerpo demasiado grande' }, 413)
  let cambios
  try { cambios = normalizarPreferencias(JSON.parse(texto || '{}')) } catch { return json({ error: 'JSON inválido' }, 400) }
  if (cambios.noche === undefined) return json({ error: 'Nada para guardar' }, 400)
  try {
    return json({ prefs: await guardarPreferencias(sesion.email, { noche: cambios.noche }) })
  } catch {
    return json({ error: 'No se pudieron guardar las preferencias' }, 502)
  }
}
