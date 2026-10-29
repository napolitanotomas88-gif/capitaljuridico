import { after } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { cargarTarjetasEdicion, ejecutarTarjetaEdicion } from '@/lib/edicion/tarjetasServidor'
import { despacharTarjetasPendientes } from '@/lib/edicion/tarjetasAvisos'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const respuesta = (cuerpo: unknown, status = 200) => Response.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })
export async function GET(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'edicion'); if (rechazo) return rechazo
  const id = new URL(req.url).searchParams.get('id') || undefined
  if (id && !/^[A-Za-z0-9_-]{5,80}$/.test(id)) return respuesta({ ok: false, mensaje: 'ID inválido.' }, 422)
  const r = await cargarTarjetasEdicion(sesionDePeticion(req.headers), id)
  return respuesta(r, r.ok ? 200 : r.codigo === 'no_existe' ? 404 : 503)
}
export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'edicion'); if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  if (!req.headers.get('content-type')?.includes('application/json')) return respuesta({ ok: false, mensaje: 'Se requiere JSON.' }, 415)
  if (Number(req.headers.get('content-length') ?? 0) > 20000) return respuesta({ ok: false, mensaje: 'El pedido es demasiado largo.' }, 413)
  const texto = await req.text(); if (texto.length > 20000) return respuesta({ ok: false, mensaje: 'El pedido es demasiado largo.' }, 413)
  let cuerpo: unknown; try { cuerpo = JSON.parse(texto) } catch { return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400) }
  const r = await ejecutarTarjetaEdicion(sesionDePeticion(req.headers), cuerpo, { dry: new URL(req.url).searchParams.get('dry') === '1' })
  if (r.status === 200 && !r.cuerpo.dry) after(() => despacharTarjetasPendientes({ hasta: Date.now() + 45000, incluirCliente: false }).then(() => undefined).catch(() => { console.error('[edicion/tarjetas] avisos pendientes; se retoman en el vigía.') }))
  return respuesta(r.cuerpo, r.status)
}
