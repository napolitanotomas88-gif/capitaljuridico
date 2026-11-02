// ── «Enviado»: lo mismo que hacía el envío automático por WhatsApp cuando salía bien (2/11/2026). Solo servidor ─────────────
// Lo llama POST /api/clientes/para-enviar/[id] después de marcar el mensaje como enviado. Cada gancho es idempotente y nunca
// tira (lo que falle queda en el log y en la respuesta; el mensaje ya quedó «enviado»).
//   · d02 → la tanda pasa a «enviada» (la misma entrega manual de /clientes/entregas) y se cierra su aviso de la campanita.
//     Unificado con el día 0 de grabación (2/11/2026): si el mensaje lleva el pedido de grabar (datos.grabacion), el día 0
//     de e01 queda hecho y los videos de la tanda llevan la constancia (lib/bot/grabacion/dia0Guiones.ts).
//   · f04 → cada video del lote queda «enviado al cliente» (envio_link), como el envío del bot.
//   · e01 → el paso del día 0 o del recordatorio queda hecho (a nombre de quien lo mandó).
//   · b07 → el paso «bienvenida» del alta queda hecho a mano y el alta sigue.
//   · i01 de la etapa Proyección (datos.origen 'proyeccion') → la llamada de proyección queda «Avisado» (lib/bot/proyeccion).
//   · g04–g06, h01–h03, i01, i03 → nada extra: el bot ya los dio por entregados al dejarlos «para enviar».
// En todos, si hay ID del CRM, cuenta como contacto del equipo (cliente sin respuesta).
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import type { MensajeGuardado } from './registro'

const motivoDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)
const num = (x: unknown): number | null => { const n = Number(x); return Number.isSafeInteger(n) && n > 0 ? n : null }

export interface Quien { email: string; nombre: string }

export async function alConfirmarEnvio(m: MensajeGuardado, quien: Quien, op: { fondo?: (fn: () => Promise<unknown>) => void } = {}): Promise<{ hecho: string[]; errores: string[] }> {
  const hecho: string[] = [], errores: string[] = []
  const intentar = async (que: string, fn: () => Promise<string | null>) => {
    try { const r = await fn(); if (r) hecho.push(r) } catch (e) { errores.push(`${que}: ${motivoDe(e)}`) }
  }
  const por = quien.nombre || quien.email
  if (m.pieza === 'd02') await intentar('guiones', async () => {
    const tanda = num(m.datos.tanda)
    if (!tanda) return null
    const reg = await import('@/lib/bot/guiones/registro')
    const fila = await reg.leerTanda(tanda)
    if (!fila || fila.estado !== 'aprobada') return 'la tanda ya estaba entregada'
    const ok = await reg.marcarEntregaManual(tanda, quien, fila.actualizado)
    const { cerrarAvisosEntrega } = await import('@/lib/bot/guiones/entrega')
    await cerrarAvisosEntrega(tanda, por)
    return ok ? 'la tanda quedó «enviada»' : 'la tanda cambió: confirmá la entrega en /clientes/entregas'
  })
  if (m.pieza === 'd02' && m.datos.grabacion === true && m.idCrm) await intentar('grabación', async () => {
    const { cumplirDia0PorGuiones } = await import('@/lib/bot/grabacion/dia0Guiones')
    return cumplirDia0PorGuiones({ idCrm: m.idCrm!, tandaDoc: num(m.datos.tandaDoc), por, texto: m.texto })
  })
  if (m.pieza === 'f04') await intentar('edición', async () => {
    const envios = Array.isArray(m.datos.envios) ? (m.datos.envios as { tarjeta?: string; evento?: string; link?: string }[]) : []
    if (!envios.length) return null
    const { transaccionTarjetas } = await import('@/lib/edicion/tarjetasDb')
    let n = 0
    await transaccionTarjetas(async (c) => {
      for (const s of envios) {
        if (!s.tarjeta) continue
        const t = (await c.query('SELECT * FROM cj_edicion_tarjetas WHERE id=$1 FOR UPDATE', [s.tarjeta])).rows[0]
        if (!t?.video_id || t.entrega_evento !== s.evento) continue
        const v = (await c.query("UPDATE cj_videos SET envio_link=$2::jsonb,version=version+1,actualizado=now() WHERE id=$1 AND estado='con_cliente' AND editado_url=$3 RETURNING version", [t.video_id, JSON.stringify({ quien: por, cuando: new Date().toISOString(), texto: m.texto.slice(0, 2000) }), s.link])).rows[0]
        if (v) { await c.query('UPDATE cj_edicion_tarjetas SET video_version=$2 WHERE id=$1', [t.id, v.version]); n++ }
      }
    })
    return `${n} video(s) quedaron «enviados al cliente»`
  })
  if (m.pieza === 'e01') await intentar('grabación', async () => {
    const paso = num(m.datos.paso)
    const db = process.env.DATABASE_URL?.trim()
    if (!paso || !db) return null
    const hecho = JSON.stringify({ quien: por, cuando: new Date().toISOString(), nota: 'enviado a mano (para enviar)' })
    const r = await neon(db, { fetchOptions: { signal: AbortSignal.timeout(8_000) } })`UPDATE cj_grab_seguimientos SET hecho = ${hecho}::jsonb, texto = ${m.texto.slice(0, 4_000)}, version = version + 1, actualizado = now()
      WHERE id = ${paso} AND estado = 'abierto' AND hecho IS NULL RETURNING id`
    return r.length ? 'el paso de grabación quedó hecho' : 'el paso ya estaba hecho o cerrado'
  })
  if (m.pieza === 'b07') await intentar('alta', async () => {
    const alta = typeof m.datos.alta === 'string' ? m.datos.alta : null
    if (!alta) return null
    const { motorDelEntorno } = await import('@/lib/bot/alta/despacho/servidor')
    const correr = () => motorDelEntorno().hechoAMano(alta, 'bienvenida', por, { hasta: Date.now() + 240_000, invocacion: `para-enviar-${randomUUID().slice(0, 8)}` })
    if (op.fondo) { op.fondo(correr); return 'la bienvenida queda hecha y el alta sigue (en segundo plano)' }
    const r = await correr()
    return r.errores.length ? `alta: ${r.errores[0]}` : 'la bienvenida quedó hecha y el alta sigue'
  })
  if (m.pieza === 'i01' && m.datos.origen === 'proyeccion' && m.idCrm && typeof m.datos.fin === 'string') await intentar('proyección', async () => {
    const { marcarAvisadoSiFalta, baseProyeccionConfigurada } = await import('@/lib/bot/proyeccion/marcas')
    if (!baseProyeccionConfigurada()) return null
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    return (await marcarAvisadoSiFalta(m.idCrm!, m.datos.fin as string, hoy, por)) ? 'la llamada de proyección quedó «Avisado»' : 'ya figuraba avisado'
  })
  if (m.idCrm) {
    await intentar('actividad', async () => {
      const { registrarActividadInactivos } = await import('@/lib/clientes/inactivos')
      await registrarActividadInactivos({ idCrm: m.idCrm!, tipo: 'equipo', origen: `para-enviar-${m.pieza}` })
      return null
    })
  }
  return { hecho, errores }
}
