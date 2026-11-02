import { NextResponse, after } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { leerMensaje, resolverMensaje } from '@/lib/bot/canal/registro'
import { alConfirmarEnvio } from '@/lib/bot/canal/ganchos'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// POST /api/clientes/para-enviar/[id] — {accion:'enviado'} o {accion:'descartar', motivo} (2/11/2026). Sesión de Google con la
// sección Clientes, mismo origen y JSON. Guarda quién y cuándo; con «Enviado» corre el gancho de la pieza (lib/bot/canal/ganchos.ts).
const json = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes')
  if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return json(403, { ok: false, mensaje: 'Origen no permitido.' })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return json(415, { ok: false, mensaje: 'Se espera JSON.' })
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return json(401, { ok: false, mensaje: 'Iniciá sesión.' })
  const id = Number((await ctx.params).id)
  if (!Number.isSafeInteger(id) || id <= 0) return json(400, { ok: false, mensaje: 'Mensaje inválido.' })
  const raw = await req.text()
  if (raw.length > 2000) return json(413, { ok: false, mensaje: 'Pedido demasiado grande.' })
  let b: Record<string, unknown>
  try { b = JSON.parse(raw) } catch { return json(400, { ok: false, mensaje: 'JSON inválido.' }) }
  const accion = b?.accion
  const motivo = typeof b?.motivo === 'string' ? b.motivo.trim().slice(0, 300) : ''
  if (accion !== 'enviado' && accion !== 'descartar') return json(400, { ok: false, mensaje: 'Acción desconocida.' })
  if (accion === 'descartar' && motivo.length < 3) return json(422, { ok: false, mensaje: 'Falta el motivo.' })
  const quien = { email: sesion.email, nombre: sesion.nombre || sesion.email }
  try {
    const previo = await leerMensaje(id)
    if (!previo) return json(404, { ok: false, mensaje: 'No existe ese mensaje.' })
    const m = await resolverMensaje(id, accion === 'enviado' ? 'enviado' : 'descartado', quien.nombre, accion === 'descartar' ? motivo : null)
    if (!m) return json(409, { ok: false, mensaje: 'Ese mensaje ya se resolvió. Recargá.' })
    if (accion === 'descartar') return json(200, { ok: true, mensaje: 'Listo: quedó como «No corresponde».' })
    const g = await alConfirmarEnvio(m, quien, { fondo: (fn) => after(() => fn().then(() => undefined).catch(() => undefined)) })
    const extra = [...g.hecho, ...g.errores.map((e) => `Ojo: ${e}`)].join(' · ')
    return json(200, { ok: true, mensaje: `Enviado registrado${extra ? `: ${extra}` : '.'}` })
  } catch (e) {
    console.error('[para-enviar] no se pudo guardar:', (e as Error)?.name ?? 'error')
    return json(503, { ok: false, mensaje: 'No se pudo guardar. Probá de nuevo.' })
  }
}
