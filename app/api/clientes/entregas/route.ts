import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { puedeEntregarGuiones, cerrarAvisosEntrega } from '@/lib/bot/guiones/entrega'
import { leerTanda, marcarEntregaManual } from '@/lib/bot/guiones/registro'
import { registrarActividadInactivos } from '@/lib/clientes/inactivos'
import { exigirClienteNoArchivado } from '@/lib/clientes/archivados'
export const dynamic = 'force-dynamic'
const json = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })
export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes')
  if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return json(403, { ok: false, mensaje: 'Origen no permitido.' })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return json(415, { ok: false, mensaje: 'Se espera JSON.' })
  const sesion = sesionDePeticion(req.headers)
  if (!sesion || (!puedeEntregarGuiones(sesion.email) && !(process.env.NODE_ENV !== 'production' && sesion.esDePrueba && sesion.rol === 'socio'))) return json(403, { ok: false, mensaje: 'La entrega la confirman Aylu, Gero o Tomás.' })
  const raw = await req.text()
  if (raw.length > 2000) return json(413, { ok: false, mensaje: 'Pedido demasiado grande.' })
  let b: Record<string, unknown>
  try { b = JSON.parse(raw) } catch { return json(400, { ok: false, mensaje: 'JSON inválido.' }) }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json(400, { ok: false, mensaje: 'JSON inválido.' })
  const id = Number(b.tanda)
  if (!Number.isSafeInteger(id) || id <= 0 || b.confirmacion !== true || typeof b.previo !== 'string') return json(400, { ok: false, mensaje: 'Confirmá que ya entregaste esta versión del documento.' })
  try {
    const fila = await leerTanda(id)
    if (!fila?.id_crm) return json(404, { ok: false, mensaje: 'Tanda no encontrada.' })
    await exigirClienteNoArchivado(fila.id_crm)
    if (!(await marcarEntregaManual(id, { email: sesion.email, nombre: sesion.nombre || sesion.email }, b.previo))) return json(409, { ok: false, mensaje: 'La tanda cambió, ya fue entregada o todavía no está publicada. Recargá.' })
    await Promise.all([cerrarAvisosEntrega(id, sesion.nombre || sesion.email), registrarActividadInactivos({ idCrm: fila.id_crm, tipo: 'equipo', origen: 'entrega-guiones' }).catch(e => console.error('Entrega: no se registró la actividad —', (e as Error)?.name ?? 'error'))])
    return json(200, { ok: true, mensaje: 'Entrega al cliente registrada.' })
  } catch (e) {
    if ([409, 503].includes((e as { status?: number })?.status ?? 0)) return json((e as { status: number }).status, { ok: false, mensaje: (e as Error).message })
    return json(503, { ok: false, mensaje: 'No se pudo registrar la entrega. Probá nuevamente.' })
  }
}
