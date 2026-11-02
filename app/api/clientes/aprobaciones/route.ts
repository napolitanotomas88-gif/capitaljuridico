import { NextResponse } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { aprobadorDe } from '@/lib/bot/alta/despacho/aprobadores'
import { esFuente } from '@/lib/clientes/aprobaciones'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// POST /api/clientes/aprobaciones — {fuente, id, veredicto: 'ok'|'no'|'a_mano', resto?} (2/11/2026). Reemplaza el «OK / NO
// citando» del grupo Verificaciones C.J. de WhatsApp. Sesión de Google con Clientes, mismo origen y JSON; solo aprobadores
// (Tomás, Gero A, Gero M y Aylu por mail). OK / NO entran al mismo núcleo de Éxito o Bajas (el que antes leía el webhook);
// «Hecho a mano» cierra el pedido sin que el bot mande nada.
const json = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes')
  if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return json(403, { ok: false, mensaje: 'Origen no permitido.' })
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return json(415, { ok: false, mensaje: 'Se espera JSON.' })
  const sesion = sesionDePeticion(req.headers)
  const ap = aprobadorDe(sesion)
  if (!sesion || !ap) return json(403, { ok: false, mensaje: 'Solo Tomás, Gero A, Gero M y Aylu pueden aprobar.' })
  const raw = await req.text()
  if (raw.length > 2000) return json(413, { ok: false, mensaje: 'Pedido demasiado grande.' })
  let b: Record<string, unknown>
  try { b = JSON.parse(raw) } catch { return json(400, { ok: false, mensaje: 'JSON inválido.' }) }
  const fuente = b?.fuente, id = typeof b?.id === 'string' ? b.id.slice(0, 200) : '', veredicto = b?.veredicto
  const resto = typeof b?.resto === 'string' ? b.resto.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  if (!esFuente(fuente) || !id || !['ok', 'no', 'a_mano'].includes(String(veredicto))) return json(400, { ok: false, mensaje: 'Pedido inválido.' })
  const por = ap.nombre || sesion.nombre || sesion.email
  const ahora = new Date().toISOString()
  try {
    if (veredicto === 'a_mano') {
      let ok = false
      if (fuente === 'bajas') {
        const { almacenBajasNeon } = await import('@/lib/bot/bajas/almacenNeon')
        ok = await almacenBajasNeon().actualizarPedido(id, { estado: 'enviado', por, respuesta: `hecho a mano ${resto}`.trim(), resuelto: ahora }, ['abierto'])
      } else {
        const { almacenExitoNeon } = await import('@/lib/bot/exito/almacenNeon')
        const a = almacenExitoNeon()
        if (fuente === 'exito_pedido') ok = await a.actualizarPedido(id, { estado: 'enviado', por, respuesta: `hecho a mano ${resto}`.trim(), resuelto: ahora }, ['abierto'])
        else if (fuente === 'exito_lote') ok = await a.actualizarLote(id, { estado: 'completo', por, aprobadoEn: ahora }, ['pedido'])
        else { await a.marcarSenal(id, 'descartada', { por, aMano: true }); ok = true }
      }
      return ok ? json(200, { ok: true, mensaje: 'Listo: quedó hecho a mano.' }) : json(409, { ok: false, mensaje: 'Ese pedido ya no está abierto. Recargá.' })
    }
    const v = veredicto as 'ok' | 'no'
    const r = fuente === 'bajas'
      ? await (await import('@/lib/bot/bajas/servidor')).resolverBajasManualReal({ id, veredicto: v, resto, por })
      : await (await import('@/lib/bot/exito/servidor')).resolverExitoManualReal({ fuente: fuente === 'exito_pedido' ? 'pedido' : fuente === 'exito_lote' ? 'lote' : 'dudosa', id, veredicto: v, resto, por })
    const lineas = [...r.registro, ...r.errores.map((e) => `Ojo: ${e}`)].map((x) => x.replace(/\d{8,}/g, '[número]')).slice(0, 6)
    if (r.errores.length && !r.aprobados && !r.rechazados) return json(422, { ok: false, mensaje: lineas.join(' · ') || 'No se pudo aplicar.' })
    return json(200, { ok: true, mensaje: `${v === 'ok' ? 'OK' : 'NO'} registrado por ${por}.${lineas.length ? ` ${lineas.join(' · ')}` : ''}` })
  } catch (e) {
    console.error('[aprobaciones] falló:', (e as Error)?.name ?? 'error')
    return json(503, { ok: false, mensaje: 'No se pudo aplicar. Probá de nuevo.' })
  }
}
