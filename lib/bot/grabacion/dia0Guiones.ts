// ── El día 0 de grabación va con el link de los guiones (Tomás, 2/11/2026). Solo servidor ──────────────────────────────
// El «para enviar» d02 lleva en un solo mensaje el link del Doc y el pedido de grabar con la fecha sugerida. Por eso:
//   · al marcar «Enviado» en ese mensaje (lib/bot/canal/ganchos.ts) → cumplirDia0PorGuiones: los videos de la tanda que
//     nacieron del Doc pasan a origen `aylu` (el ciclo de e01 que se abra después nace con el día 0 hecho, «guiones
//     enviados») y el día 0 abierto del cliente, si ya existía, queda hecho a nombre de quien lo mandó;
//   · paraEnviarE01 (e01Whatsapp.ts) ya no deja el día 0 por separado si el cliente tiene ese mensaje: si está pendiente,
//     espera al «Enviado»; si ya se mandó, marca el día 0 hecho con la misma constancia.
// La escalera sigue igual: días 2, 4 y 9 desde el día 0. Nunca le escribe al cliente.
import { neon } from '@neondatabase/serverless'
import * as Videos from '@/lib/edicion/db/videos'
import type { PasoSeguimiento } from '@/lib/edicion/tipos'

export const NOTA_DIA0_GUIONES = 'Hecho con el «para enviar» de los guiones (link del Doc + pedido de grabación).'
/** Cuántos días antes del inicio del ciclo puede haberse armado el mensaje de los guiones y seguir contando. */
export const DIAS_VENTANA_D02 = 10

const db = () => { const u = process.env.DATABASE_URL?.trim(); return u ? neon(u, { fetchOptions: { signal: AbortSignal.timeout(8_000) } }) : null }

/** Marca hecho el día 0 abierto del cliente (o el paso indicado). Devuelve cuántos pasos cambió. */
export async function marcarDia0Hecho(p: { idCrm: string; pasoId?: number | null; por: string; texto?: string }): Promise<number> {
  const q = db()
  if (!q) return 0
  const hecho = JSON.stringify({ quien: p.por, cuando: new Date().toISOString(), nota: NOTA_DIA0_GUIONES })
  const id = p.idCrm.trim().toUpperCase()
  const r = p.pasoId
    ? await q`UPDATE cj_grab_seguimientos SET hecho = ${hecho}::jsonb, texto = ${(p.texto ?? '').slice(0, 4_000)}, version = version + 1, actualizado = now()
        WHERE id = ${p.pasoId} AND upper(id_crm) = ${id} AND escalon = 'dia0' AND estado = 'abierto' AND hecho IS NULL RETURNING id`
    : await q`UPDATE cj_grab_seguimientos SET hecho = ${hecho}::jsonb, texto = ${(p.texto ?? '').slice(0, 4_000)}, version = version + 1, actualizado = now()
        WHERE upper(id_crm) = ${id} AND escalon = 'dia0' AND estado = 'abierto' AND hecho IS NULL RETURNING id`
  return r.length
}

/** «Enviado» del mensaje unificado: constancia en los videos de la tanda y el día 0 hecho. Devuelve el resumen. */
export async function cumplirDia0PorGuiones(p: { idCrm: string; tandaDoc: number | null; por: string; texto: string }): Promise<string> {
  const id = p.idCrm.trim().toUpperCase()
  let videos = 0
  if (p.tandaDoc) {
    const xs = await Videos.listarVideos({ id_crm: id, estados: ['esperando_crudos'] })
    for (const v of xs.filter(x => x.tanda_guion === p.tandaDoc && x.origen === 'doc')) {
      const r = await Videos.actualizarVideo({ id: v.id, version: v.version, actor: { tipo: 'bot', proceso: 'guiones' }, cambios: { origen: 'aylu' }, tipo: 'envio_cliente',
        nota: `guiones de la tanda ${p.tandaDoc} enviados (por ${p.por})`, datos: { envio: 'guiones', tanda_guion: p.tandaDoc } })
      if (r.ok) videos++
    }
  }
  const pasos = await marcarDia0Hecho({ idCrm: id, por: p.por, texto: p.texto })
  return `grabación: día 0 ${pasos ? 'hecho' : 'sin paso abierto (nace hecho)'}${videos ? `, ${videos} video(s) con la constancia` : ''}`
}

/** ¿El cliente tiene el mensaje unificado de los guiones para este ciclo? 'pendiente' | 'enviado' | null (no hay). */
export async function d02DelCiclo(p: Pick<PasoSeguimiento, 'id_crm' | 'ciclo'>): Promise<'pendiente' | 'enviado' | null> {
  const q = db()
  if (!q) return null
  try {
    const r = await q`SELECT estado FROM cj_canal_mensajes WHERE pieza = 'd02' AND upper(id_crm) = ${p.id_crm.trim().toUpperCase()}
      AND estado IN ('para_enviar', 'enviado') AND (datos->>'grabacion') = 'true'
      AND creado >= (${p.ciclo}::date - ${DIAS_VENTANA_D02}::int) ORDER BY creado DESC LIMIT 5`
    if (!r.length) return null
    return r.some(x => x.estado === 'enviado') ? 'enviado' : 'pendiente'
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return null
    throw e
  }
}
