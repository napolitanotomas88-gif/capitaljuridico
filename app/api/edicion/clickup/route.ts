import { NextResponse, after } from 'next/server'
import { autorizarCron } from '@/lib/bot/grabacion/acceso'
import { urlDespacho } from '@/lib/edicion/avisos/entorno'
import { idEntradaWebhook, pendientesClickUp } from '@/lib/edicion/clickupSync'
import { anotarEntrada, cerrarEntrada, despacharClickUpReal, registrarWebhook, sincronizarClickUpReal, ultimaSincronizacion, verificarWebhook } from '@/lib/edicion/clickupServidor'
import { procesarPublicaciones, simularPublicar, modoPublicar, rotarReal } from '@/lib/edicion/publicarServidor'
import { publicarDesde } from '@/lib/edicion/publicacionesDb'
import { transaccionTarjetas } from '@/lib/edicion/tarjetasDb'

// ── ClickUp ↔ tablero de Edición (4/11/2026). Se autentica sola (regla `propio` en lib/auth/rutas.ts), falla cerrado:
//   · POST con X-Signature (HMAC del webhook de ClickUp): anota el evento una vez y sincroniza esa tarea en after().
//   · POST con Bearer CRON_SECRET: ?accion=sincronizar (lectura completa + outbox + publicaciones), ?accion=registrar (alta
//     del webhook en ClickUp), ?accion=simular&tarjeta=<id> (prueba EN SECO del flujo Publicar: no escribe Neon, ClickUp,
//     el Doc ni Meta; devuelve qué pasaría).
//   · GET con Bearer CRON_SECRET: estado (última lectura, modos, cola a ClickUp, publicaciones).
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const json = (c: unknown, status = 200) => NextResponse.json(c, { status, headers: { 'Cache-Control': 'no-store' } })
const RUTA = '/api/edicion/clickup'

export async function POST(req: Request) {
  const t0 = Date.now()
  const firma = req.headers.get('x-signature')
  if (firma) {
    const cuerpo = await req.text()
    if (cuerpo.length > 200_000) return json({ error: 'demasiado largo' }, 413)
    const v = await verificarWebhook(cuerpo, firma)
    if (v !== 'ok') return json({ error: v === 'sin_secreto' ? 'no configurado' : 'firma inválida' }, v === 'sin_secreto' ? 503 : 401)
    let x: { event?: string; task_id?: string; webhook_id?: string; history_items?: { id?: unknown }[] }
    try { x = JSON.parse(cuerpo) } catch { return json({ error: 'JSON inválido' }, 400) }
    const tarea = String(x.task_id ?? '')
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(tarea)) return json({ ok: true, ignorado: 'sin tarea' })
    const id = idEntradaWebhook(cuerpo, x)
    if (!await anotarEntrada(id, tarea, String(x.event ?? ''))) return json({ ok: true, repetido: true })
    after(async () => {
      try {
        const r = await sincronizarClickUpReal(x.event === 'taskDeleted' ? { borradas: [tarea] } : { tareas: [tarea] })
        await cerrarEntrada(id)
        if ('publicar' in r && r.publicar.length) await procesarPublicaciones({ hasta: t0 + 280_000 })
      } catch (e) { await cerrarEntrada(id, String((e as Error)?.message ?? e)).catch(() => {}) }
    })
    return json({ ok: true })
  }
  const a = autorizarCron(req.headers, process.env)
  if (!a.ok) return json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, a.status)
  const u = new URL(req.url), accion = u.searchParams.get('accion')
  try {
    if (accion === 'registrar') return json(await registrarWebhook(`${urlDespacho()}${RUTA}`))
    if (accion === 'simular') {
      const tarjeta = u.searchParams.get('tarjeta') ?? ''
      if (!/^[A-Za-z0-9_-]{5,80}$/.test(tarjeta)) return json({ error: 'tarjeta inválida' }, 422)
      return json({ seco: true, nota: 'Simulación: no se escribió nada en Neon, ClickUp, el Doc de ADS ni Meta.', resultado: await simularPublicar(tarjeta, t0 + 270_000) })
    }
    if (accion === 'sincronizar') {
      const sync = await sincronizarClickUpReal({ forzar: true })
      const push = await despacharClickUpReal(t0 + 200_000)
      const pubs = await procesarPublicaciones({ hasta: t0 + 290_000 })
      return json({ sync, push, publicaciones: pubs })
    }
    return json({ error: 'acción desconocida' }, 422)
  } catch (e) { return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 500) }
}

export async function GET(req: Request) {
  const a = autorizarCron(req.headers, process.env)
  if (!a.ok) return json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, a.status)
  try {
    const pubs = await transaccionTarjetas(async c => (await c.query('SELECT estado,count(*)::int n FROM cj_edicion_publicaciones GROUP BY 1')).rows)
    const entradas = await transaccionTarjetas(async c => (await c.query("SELECT count(*)::int n,max(recibido) ultima,count(*) FILTER (WHERE error<>'')::int errores FROM cj_edicion_clickup_entrada")).rows[0])
    return json({ sincronizado: await ultimaSincronizacion(), modos: { escribir_clickup: process.env.EDICION_CLICKUP_ESCRIBIR?.trim() === 'real', publicar: modoPublicar(), publicar_desde: publicarDesde() ? new Date(publicarDesde()!).toISOString() : null, rotar: rotarReal(), doc_escribir: process.env.ANUNCIOS_DOC_ESCRIBIR?.trim() === 'real' }, webhook: entradas, cola_clickup: await pendientesClickUp(transaccionTarjetas), publicaciones: pubs })
  } catch (e) { return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, 500) }
}
