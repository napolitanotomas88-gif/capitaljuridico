import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_ANUNCIOS, claveConfigurada, sesionValida, cronAutorizado } from '@/lib/anuncios/auth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { obtenerTablero } from '@/lib/anuncios/tablero'
import { leerOptimizaciones, registrarOptimizacion } from '@/lib/anuncios/optimizaciones'
import { hoyAR } from '@/lib/anuncios/formato'
export const maxDuration = 60
export async function POST(req: NextRequest) {
  if (!(await adminPorCabeceras(req.headers)) && (!claveConfigurada() || (!sesionValida(req.cookies.get(COOKIE_ANUNCIOS)?.value) && !cronAutorizado(req)))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { campanaId, accion = 'optimizacion' } = await req.json()
    if (typeof campanaId !== 'string' || !/^\d+$/.test(campanaId)) return NextResponse.json({ error: 'Campaña inválida' }, { status: 400 })
    if (!['optimizacion', 'revision_competencia'].includes(accion)) return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
    const tablero = await obtenerTablero()
    const f = tablero.filas.find(f => f.lanzamientos.some(l => l.campanaId === campanaId))
    const l = f?.lanzamientos.find(l => l.campanaId === campanaId)
    if (!f || !l) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    if (!(await leerOptimizaciones()).some(o => o.campanaId === campanaId && (o.accion ?? 'optimizacion') === accion && o.fecha === hoyAR())) await registrarOptimizacion({ cuenta: f.id, campanaId, campana: l.campana, cliente: f.cliente, fechaLanzada: l.fecha, fecha: hoyAR(), confirmado: new Date().toISOString(), accion })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
