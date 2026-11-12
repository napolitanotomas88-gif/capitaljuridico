import { NextResponse, after } from 'next/server'
import { autorizarVigia, autorizarCron, estadoVariables } from '@/lib/bot/grabacion/acceso'
import { correrVigia } from '@/lib/bot/grabacion/vigia'
import { PLAZO_VIGIA_MS, depsReales } from '@/lib/bot/grabacion/servidor'
import { modoEdicion } from '@/lib/edicion/config'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { corridasDesde, ultimaCorrida } from '@/lib/edicion/db/corridas'
import { listarVideos } from '@/lib/edicion/operativo'
import { conArchivadosActuales } from '@/lib/clientes/archivados'
import { despacharNotifDiscordReal } from '@/lib/notificaciones/discord/servidor'
import { recordarParaEnviar } from '@/lib/bot/canal/salidaCliente'
import { recordarGuionesARevisar } from '@/lib/bot/guiones/servidor'
import { crearParaEnviarFaltantesReal } from '@/lib/bot/guiones/paraEnviarFaltantes'

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
  // Sin WhatsApp (2/11/2026): la bandeja central sale por Discord y se recuerdan los mensajes «para enviar» sin marcar
  after(() => despacharNotifDiscordReal().then(() => undefined).catch(e => { console.error('notif-discord: falla inesperada —', motivo(e)) }))
  after(() => recordarParaEnviar().then(() => undefined).catch(e => { console.error('para-enviar: falla inesperada —', motivo(e)) }))
  // Guiones para revisar (3/11/2026): aviso que haya faltado + recordatorios de 24 h (Faus y Gero M) y 48 h (escala a Gero M), de 9 a 20 h
  after(() => recordarGuionesARevisar().then(() => undefined).catch(e => { console.error('guiones-revision: falla inesperada —', motivo(e)) }))
  // Guiones aprobados sin su «para enviar» en 📤 (3/11/2026, «SÍ O SÍ»): la red que lo crea si el check final no lo dejó
  after(() => crearParaEnviarFaltantesReal().then(r => { if (r.faltantes.length || r.errores.length) console.log(`guiones-para-enviar: ${r.faltantes.map(f => `${f.id_crm} tanda ${f.tanda} (${f.estado})`).join(' · ') || '0'}${r.errores.length ? ` | errores ${r.errores.join(' · ')}` : ''}`) }).catch(e => { console.error('guiones-para-enviar: falla inesperada —', motivo(e)) }))
  // Cargas de guiones en el Doc que quedaron «dudosas» (12/11/2026): se reintentan con la misma clave y, si quedan escritas,
  // se completa lo que faltó (doc, chips «Para grabar», Edición, 📤). Detalle en lib/bot/guiones/publicacion.ts.
  after(async () => {
    try {
      const { reconciliarDudosas } = await import('@/lib/bot/guiones/publicacion')
      const r = await reconciliarDudosas(t0 + 280_000)
      if (r.length) console.log(`guiones-dudosas: reintentadas ${r.join(', ')}`)
    } catch (e) { console.error('guiones-dudosas: falla inesperada —', motivo(e)) }
  })
  // Tablero de Edición ↔ ClickUp (4/11/2026): lectura de lo modificado, réplica de la outbox y anuncios de «Publicar».
  after(async () => {
    try {
      const { sincronizarClickUpReal, despacharClickUpReal } = await import('@/lib/edicion/clickupServidor')
      const { procesarPublicaciones } = await import('@/lib/edicion/publicarServidor')
      const s = await sincronizarClickUpReal({ forzar: true })
      const p = await despacharClickUpReal(t0 + 150_000)
      const pub = await procesarPublicaciones({ hasta: t0 + PLAZO_VIGIA_MS })
      console.log(`edicion-clickup: ${'apagado' in s ? 'lectura apagada' : `${s.leidas} leídas, ${s.creadas} nuevas, ${s.actualizadas} actualizadas`} · ${'apagado' in p ? 'escritura apagada' : `${p.enviados} a ClickUp`} · ${pub.procesadas.length} publicaciones${pub.errores.length ? ` | ${pub.errores.join(' · ')}` : ''}`)
    } catch (e) { console.error('edicion-clickup: falla inesperada —', motivo(e)) }
  })
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
