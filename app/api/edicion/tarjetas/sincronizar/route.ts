import { after } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { despacharClickUpReal, sincronizarClickUpReal, ultimaSincronizacion } from '@/lib/edicion/clickupServidor'
import { procesarPublicaciones } from '@/lib/edicion/publicarServidor'
import type { RespuestaSincronizacion } from '@/lib/edicion/tarjetasTipos'

// POST /api/edicion/tarjetas/sincronizar — el botón «Actualizar» del tablero: trae de ClickUp lo modificado desde la última
// lectura y lo aplica (clickupSync.ts). Después la pantalla vuelve a leer las tarjetas. Sesión con la sección Edición.
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const respuesta = (c: RespuestaSincronizacion, status = 200) => Response.json(c, { status, headers: { 'cache-control': 'no-store' } })
export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'edicion'); if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  const t0 = Date.now()
  try {
    const r = await sincronizarClickUpReal()
    if ('apagado' in r) return respuesta({ ok: true, apagado: true, sincronizado: await ultimaSincronizacion(), mensaje: 'La sincronización con ClickUp está apagada.' })
    after(async () => { await despacharClickUpReal(t0 + 55_000).catch(() => null); if (r.publicar.length) await procesarPublicaciones({ hasta: t0 + 290_000, limite: 1 }).catch(() => null) })
    return respuesta({ ok: true, sincronizado: r.sincronizado, leidas: r.leidas, creadas: r.creadas, actualizadas: r.actualizadas, mensaje: r.saltada ? 'Recién sincronizado con ClickUp.' : `ClickUp: ${r.leidas} tareas leídas · ${r.creadas} nuevas · ${r.actualizadas} actualizadas.` })
  } catch (e) {
    console.error('[edicion/sincronizar]', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    return respuesta({ ok: false, sincronizado: await ultimaSincronizacion(), mensaje: 'No se pudo leer ClickUp ahora. El tablero muestra lo último sincronizado.' }, 503)
  }
}
