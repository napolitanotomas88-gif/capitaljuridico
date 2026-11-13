import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { accesoMaquina, exigirAccesoApi } from '@/lib/auth/acceso'
import { calcularCruce, validarFoto } from '@/lib/anuncios/seguidoresCruce'
import { guardarFoto, ultimasFotos } from '@/lib/anuncios/seguidoresCruceNeon'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SIN_CACHE = { 'Cache-Control': 'no-store' }

// Costo por seguidor real de FM (cruce diario Meta Ads × Business Suite).
// GET: el Resumen (sesión con la sección Resumen) o Bearer CRON_SECRET. Devuelve el cruce calculado con la última foto.
// POST: SOLO Bearer CRON_SECRET (la tarea diaria de la Mac). Guarda la foto del día.
export async function GET(request: Request) {
  await asegurarUsuarios()
  const denegado = exigirAccesoApi(request, 'resumen', { maquina: true })
  if (denegado) return denegado
  try {
    const fotos = await ultimasFotos(2)
    if (fotos === null) return NextResponse.json({ error: 'base no configurada' }, { status: 503, headers: SIN_CACHE })
    if (!fotos.length) return NextResponse.json({ cruce: null }, { headers: SIN_CACHE })
    return NextResponse.json({ cruce: calcularCruce(fotos[0], fotos[1] ?? null) }, { headers: SIN_CACHE })
  } catch (e) {
    console.error(`[ads/seguidores] GET falló (${String((e as Error)?.name ?? 'error').slice(0, 40)})`)
    return NextResponse.json({ error: 'no se pudo leer el cruce' }, { status: 500, headers: SIN_CACHE })
  }
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) return NextResponse.json({ error: 'falta CRON_SECRET' }, { status: 503, headers: SIN_CACHE })
  if (!accesoMaquina(request.headers)) return NextResponse.json({ error: 'no autorizado' }, { status: 401, headers: SIN_CACHE })
  let cuerpo: unknown
  try { cuerpo = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: SIN_CACHE }) }
  const v = validarFoto(cuerpo)
  if (!v.ok) return NextResponse.json({ error: v.motivo }, { status: 400, headers: SIN_CACHE })
  try {
    const ok = await guardarFoto(v.foto)
    if (!ok) return NextResponse.json({ error: 'base no configurada' }, { status: 503, headers: SIN_CACHE })
    return NextResponse.json({ ok: true, dia: v.foto.dia, posteos: v.foto.posteos.length, perfiles: v.foto.perfiles.length }, { headers: SIN_CACHE })
  } catch (e) {
    console.error(`[ads/seguidores] POST falló (${String((e as Error)?.name ?? 'error').slice(0, 40)})`)
    return NextResponse.json({ error: 'no se pudo guardar' }, { status: 500, headers: SIN_CACHE })
  }
}
