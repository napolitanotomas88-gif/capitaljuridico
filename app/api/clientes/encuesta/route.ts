import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { esYmdValido, hoyArgentina, sumarDias } from '@/lib/clientes/fechas'
import { asignarRespuesta, marcarEnviada, quitarEnvio } from '@/lib/clientes/encuesta/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/clientes/encuesta (4/11/2026) — sesión de Google con la sección Clientes, mismo origen y JSON:
//   {accion:'enviada', ids:[...], dia?}  marca la encuesta mensual como enviada ese día (hoy por defecto; hasta 30 días atrás)
//   {accion:'quitar', id, dia}           saca una marca
//   {accion:'asignar', clave, id}        asigna una respuesta «sin asignar» a un cliente
//   {accion:'descartar', clave}          la descarta (prueba, duplicada, no es un cliente)
const json = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })
const ID = /^[A-Za-z]\d{1,6}$/

export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes')
  if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return json(403, { ok: false, mensaje: 'Origen no permitido.' })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return json(415, { ok: false, mensaje: 'Se espera JSON.' })
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return json(401, { ok: false, mensaje: 'Iniciá sesión.' })
  if (!process.env.DATABASE_URL?.trim()) return json(503, { ok: false, mensaje: 'Base no configurada.' })
  const raw = await req.text()
  if (raw.length > 20_000) return json(413, { ok: false, mensaje: 'Pedido demasiado grande.' })
  let b: Record<string, unknown>
  try { b = JSON.parse(raw) } catch { return json(400, { ok: false, mensaje: 'JSON inválido.' }) }
  const por = sesion.nombre || sesion.email
  const hoy = hoyArgentina()
  try {
    switch (b?.accion) {
      case 'enviada': {
        const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string' && ID.test(x.trim())) : []
        const dia = typeof b.dia === 'string' && b.dia ? b.dia : hoy
        if (!esYmdValido(dia) || dia > hoy || dia < sumarDias(hoy, -30)) return json(422, { ok: false, mensaje: 'La fecha tiene que ser de los últimos 30 días.' })
        if (!ids.length) return json(422, { ok: false, mensaje: 'Elegí al menos un cliente.' })
        if (ids.length > 500) return json(413, { ok: false, mensaje: 'Demasiados clientes.' })
        const n = await marcarEnviada(ids, dia, por)
        return json(200, { ok: true, mensaje: n === ids.length ? `Listo: ${n} marcados como enviados.` : `Listo: ${n} nuevos (${ids.length - n} ya estaban marcados ese día).` })
      }
      case 'quitar': {
        const id = typeof b.id === 'string' ? b.id.trim() : '', dia = typeof b.dia === 'string' ? b.dia : ''
        if (!ID.test(id) || !esYmdValido(dia)) return json(400, { ok: false, mensaje: 'Datos inválidos.' })
        return (await quitarEnvio(id, dia)) ? json(200, { ok: true, mensaje: 'Marca quitada.' }) : json(404, { ok: false, mensaje: 'Esa marca ya no estaba. Recargá.' })
      }
      case 'asignar': case 'descartar': {
        const clave = typeof b.clave === 'string' ? b.clave.trim() : ''
        const id = b.accion === 'asignar' && typeof b.id === 'string' ? b.id.trim().toUpperCase() : null
        if (!clave || clave.length > 200) return json(400, { ok: false, mensaje: 'Respuesta inválida.' })
        if (b.accion === 'asignar' && (!id || !ID.test(id))) return json(422, { ok: false, mensaje: 'Escribí un ID del CRM (por ejemplo A123).' })
        await asignarRespuesta(clave, id, por)
        return json(200, { ok: true, mensaje: id ? `Respuesta asignada a ${id}.` : 'Respuesta descartada.' })
      }
      default: return json(400, { ok: false, mensaje: 'Acción desconocida.' })
    }
  } catch (e) {
    console.error('[encuesta] no se pudo guardar:', (e as Error)?.name ?? 'error')
    return json(503, { ok: false, mensaje: 'No se pudo guardar. Probá de nuevo.' })
  }
}
