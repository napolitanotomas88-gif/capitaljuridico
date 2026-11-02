import { NextResponse, after } from 'next/server'
import { autorizarVigia, autorizarCron, estadoVariables } from '@/lib/bot/grabacion/acceso'
import { correrVigia } from '@/lib/bot/grabacion/vigia'
import { PLAZO_VIGIA_MS, depsReales } from '@/lib/bot/grabacion/servidor'
import { modoEdicion } from '@/lib/edicion/config'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { corridasDesde, ultimaCorrida } from '@/lib/edicion/db/corridas'
import { listarVideos } from '@/lib/edicion/operativo'
import { conArchivadosActuales } from '@/lib/clientes/archivados'
import { despacharNotifWhatsappReal } from '@/lib/notificaciones/whatsapp/servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Vigía de Crudos y Editados (e02). Detalle en docs/edicion/MOTOR.md. Se autentica sola y falla cerrado (regla `propio` en
// lib/auth/rutas.ts, fuera del matcher de proxy.ts), siempre por cabecera:
//   · POST con `Authorization: Bearer <VIGIA_SECRETO>` (el Puente Drive cada 15 minutos, 8 a 22) o `Bearer <CRON_SECRET>`
//     (a mano). Responde 202 ENSEGUIDA y trabaja en after(). Con EDICION_MODO distinto de `real` responde 202 y no hace nada
//     (en dry nunca avanza `consultada`: cada corrida leería todo de nuevo sin guardar nada).
//     ?dry=1 → el plan EN EL MOMENTO (sin after, sin escribir). ?tipo=completa (solo con CRON_SECRET) → la pasada completa.
//   · GET con Bearer CRON_SECRET → qué variables están (sí/no, nunca el valor), las últimas corridas y los contadores.
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })
const motivo = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

export async function POST(req: Request) {
  const t0 = Date.now()
  const a = autorizarVigia(req.headers, process.env)
  if (!a.ok) return json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, a.status)
  const u = new URL(req.url)
  const dry = u.searchParams.get('dry') === '1'
  const tipo = u.searchParams.get('tipo') === 'completa' ? 'completa' : 'vigia'
  if (tipo === 'completa' && a.origen !== 'manual') return json({ error: 'la pasada completa se pide con CRON_SECRET' }, 403)
  if (!baseConfigurada()) return json({ error: 'falta DATABASE_URL' }, 503)
  if (dry) {
    try {
      const r = await conArchivadosActuales(() => correrVigia(depsReales({ inicio: t0, dry: true }), { tipo, origen: a.origen, deadline: t0 + PLAZO_VIGIA_MS }))
      return json(r)
    } catch (e) {
      return json({ ok: false, dry: true, error: motivo(e) }, 500)
    }
  }
  // Salida única de WhatsApp de la bandeja (docs/NOTIF-WHATSAPP.md): el vigía corre cada 15 min de 8 a 22 y es su reloj.
  // Con NOTIF_WHATSAPP apagado no hace nada. Va aparte del modo de Edición y nunca frena al vigía.
  after(() => despacharNotifWhatsappReal().then(() => undefined).catch(e => { console.error('notif-whatsapp: falla inesperada —', motivo(e)) }))
  if (modoEdicion() !== 'real') return json({ ok: true, dry: true, nada: 'EDICION_MODO no es real: el vigía no corre (probá con ?dry=1)' }, 202)
  after(async () => {
    try {
      const r = await conArchivadosActuales(() => correrVigia(depsReales({ inicio: t0 }), { tipo, origen: a.origen, deadline: t0 + PLAZO_VIGIA_MS }))
      console.log(`grabacion-vigia: ${r.saltada ? `salteada (${r.saltada})` : `corrida ${r.corrida}: ${r.consultadas}/${r.carpetas} carpetas, ${r.archivos_nuevos} archivos nuevos, ${r.tandas_cerradas} tandas cerradas, ${r.comparadas} comparadas, ${r.errores.length} errores`}`)
    } catch (e) {
      console.error('grabacion-vigia: falla inesperada —', motivo(e))
    }
  })
  return json({ ok: true, aceptado: true, origen: a.origen, tipo }, 202)
}

export async function GET(req: Request) {
  const a = autorizarCron(req.headers, process.env)
  if (!a.ok) return json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, a.status)
  const variables = estadoVariables(process.env)
  if (!baseConfigurada()) return json({ variables, corridas: [], contadores: {} })
  try {
    const [ultima, corridas, videos] = await Promise.all([
      ultimaCorrida('vigia'), corridasDesde(new Date(Date.now() - 86_400_000).toISOString()), listarVideos({ incluirFinales: false }),
    ])
    const contadores: Record<string, number> = {}
    for (const v of videos) contadores[v.estado] = (contadores[v.estado] ?? 0) + 1
    return json({ variables, ultima_vigia: ultima, corridas: corridas.slice(-10).reverse(), contadores })
  } catch (e) {
    return json({ variables, error: motivo(e) }, 500)
  }
}
