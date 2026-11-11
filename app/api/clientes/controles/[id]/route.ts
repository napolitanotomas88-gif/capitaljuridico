import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { leerConfigs, resolverVerificacion } from '@/lib/clientes/controles/db'
import { PLAZOS_POR_DEFECTO, textoAviso, ymdAR } from '@/lib/clientes/controles/reglas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/clientes/controles/[id] — {accion:'confirmar'} («Es incumplimiento») o {accion:'descartar', motivo} («No
// corresponde») de un hallazgo «a verificar» de los controles de cumplimiento (11/11/2026). Sesión de Google con la sección
// Clientes, mismo origen y JSON. Con «Es incumplimiento» se arma el aviso (plazo de subsanación desde hoy) y queda en
// /clientes/para-enviar (pieza j01). Nunca le escribe al cliente.
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
  if (!Number.isSafeInteger(id) || id <= 0) return json(400, { ok: false, mensaje: 'Registro inválido.' })
  const raw = await req.text()
  if (raw.length > 2000) return json(413, { ok: false, mensaje: 'Pedido demasiado grande.' })
  let b: Record<string, unknown>
  try { b = JSON.parse(raw) } catch { return json(400, { ok: false, mensaje: 'JSON inválido.' }) }
  const accion = b?.accion
  const motivo = typeof b?.motivo === 'string' ? b.motivo.trim().slice(0, 300) : ''
  if (accion !== 'confirmar' && accion !== 'descartar') return json(400, { ok: false, mensaje: 'Acción desconocida.' })
  if (accion === 'descartar' && motivo.length < 3) return json(422, { ok: false, mensaje: 'Falta el motivo.' })
  if (!process.env.DATABASE_URL?.trim()) return json(503, { ok: false, mensaje: 'Base no configurada.' })
  const por = sesion.nombre || sesion.email
  try {
    const hoy = ymdAR(new Date())
    const r = await resolverVerificacion(id, accion, por, accion === 'descartar' ? motivo : null, async (h) => {
      const cfg = (await leerConfigs(hoy, false)).find((x) => x.idCrm === h.idCrm)
      return textoAviso(h, { cliente: cfg?.cliente ?? h.idCrm, plazos: cfg?.plazos ?? PLAZOS_POR_DEFECTO }, hoy)
    })
    if (!r) return json(409, { ok: false, mensaje: 'Ya se resolvió. Recargá.' })
    if (r.estado === 'descartado') return json(200, { ok: true, mensaje: 'Listo: quedó como «No corresponde».' })
    return json(200, { ok: true, mensajeId: r.mensajeId, mensaje: r.mensajeId ? 'Listo: el aviso quedó en «Para enviar».' : 'Quedó confirmado, pero no se pudo crear el aviso: revisá «Para enviar».' })
  } catch (e) {
    console.error('[controles] no se pudo resolver:', (e as Error)?.name ?? 'error')
    return json(503, { ok: false, mensaje: 'No se pudo guardar. Probá de nuevo.' })
  }
}
