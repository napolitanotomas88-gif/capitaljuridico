// Los botones y el vigía anteriores siguen alimentando el mismo tablero. Una respuesta tardía nunca pisa una versión nueva.
import { createHash } from 'node:crypto'
import type { EstadoVideo, EventoVideo } from './tipos'
import type { EtapaTarjeta } from './tarjetasTipos'
import { transaccionTarjetas } from './tarjetasDb'

export function etapaDesdeVideo(estado: EstadoVideo): EtapaTarjeta | null {
  switch (estado) {
    case 'esperando_crudos': case 'crudo_a_revisar': case 'regrabar': return 'en espera de datos'
    case 'para_editar': case 'correccion': return 'para editar'
    case 'editado': return 'editado'
    case 'corregido': return 'corregido'
    case 'con_cliente': return 'revisión'
    case 'aprobado': return 'publicado'
    default: return null
  }
}

/** Se ejecuta después del evento operativo ya confirmado; no manda ni encola mensajes. */
export async function sincronizarEventosTarjetas(eventos: readonly EventoVideo[]): Promise<void> {
  const ids = [...new Set(eventos.filter(e => e.datos?.origen !== 'tarjetas').map(e => e.video_id).filter(id => Number.isSafeInteger(id) && id > 0))]
  if (!ids.length) return
  await transaccionTarjetas(async c => {
    const videos = (await c.query('SELECT id,id_crm,cliente,estado,version,ronda_cliente,editado_url,clickup_id FROM cj_videos WHERE id=ANY($1::bigint[]) ORDER BY id FOR SHARE', [ids])).rows
    for (const v of videos) {
      if (!/^[A-Z]\d{1,6}$/.test(v.id_crm)) continue
      const etapa = etapaDesdeVideo(v.estado as EstadoVideo)
      const tarjeta = (await c.query('SELECT * FROM cj_edicion_tarjetas WHERE video_id=$1 FOR UPDATE', [v.id])).rows[0]
      if (tarjeta?.motor_bloqueado === 'finalizado_en_clickup') continue
      const editado = typeof v.editado_url === 'string' && /^https:\/\//.test(v.editado_url) ? v.editado_url : ''
      if (!tarjeta) {
        if (!etapa) continue
        // Un video nuevo del documento entra sin depender de una importación futura de ClickUp.
        const raices = (await c.query('SELECT id FROM cj_edicion_tarjetas WHERE id_crm=$1 AND parent_id IS NULL ORDER BY id LIMIT 2', [v.id_crm])).rows
        if (raices.length > 1) continue // No elegimos una tanda o tarjeta a ciegas.
        const parent = raices[0]?.id ?? `crm_${v.id_crm}`
        if (!raices.length) await c.query("INSERT INTO cj_edicion_tarjetas(id,id_crm,nombre,etapa) VALUES($1,$2,$3,'en espera de datos') ON CONFLICT(id) DO NOTHING", [parent, v.id_crm, v.cliente || v.id_crm])
        const identidad = (await c.query('SELECT id_crm,parent_id FROM cj_edicion_tarjetas WHERE id=$1', [parent])).rows[0]
        if (!identidad || identidad.id_crm !== v.id_crm || identidad.parent_id) throw new Error('La tarjeta padre no corresponde al cliente del video.')
        const id = `video_${v.id}`
        const insertada = (await c.query(`INSERT INTO cj_edicion_tarjetas(id,parent_id,id_crm,video_id,nombre,etapa,campos,ronda_cliente,video_version)
          SELECT $1,$2,$3,v.id,v.clave,$4,$5::jsonb,v.ronda_cliente,v.version FROM cj_videos v WHERE v.id=$6
          ON CONFLICT DO NOTHING RETURNING *`, [id, parent, v.id_crm, etapa ?? 'en espera de datos', JSON.stringify({paleta:'',crudo:'',editado}), v.id])).rows[0]
        if (insertada) await c.query("INSERT INTO cj_edicion_tarjetas_historial(id,tarjeta_id,quien,tipo,despues,texto,datos) VALUES($1,$2,'Despacho','movimiento',$3,'Video incorporado desde el flujo de trabajo.',$4::jsonb) ON CONFLICT DO NOTHING", [`video_${v.id}_v${v.version}`, id, etapa, JSON.stringify({origen:'motor',video_id:Number(v.id),video_version:Number(v.version)})])
        continue
      }
      if (tarjeta.id_crm !== v.id_crm || Number(tarjeta.video_version ?? 0) >= Number(v.version)) continue
      const campos = typeof tarjeta.campos === 'string' ? JSON.parse(tarjeta.campos) : tarjeta.campos
      const siguientes = {...campos, ...(editado ? {editado} : {})}
      const bloqueado = v.estado === 'pausado' || v.estado === 'descartado'
      const bloqueo = bloqueado ? v.estado : null
      const changed = !!etapa && etapa !== tarjeta.etapa || !!editado && editado !== campos.editado || (tarjeta.motor_bloqueado ?? null) !== bloqueo
      const next = etapa ?? tarjeta.etapa
      const row = (await c.query(`UPDATE cj_edicion_tarjetas t SET etapa=$2,campos=$3::jsonb,video_version=$4,
        ronda_cliente=GREATEST(t.ronda_cliente,$5),version=t.version+$6,actualizado=CASE WHEN $6=1 THEN now() ELSE t.actualizado END,
        entrega_evento=CASE WHEN $7 THEN NULL ELSE t.entrega_evento END,motor_bloqueado=$8
        FROM cj_videos v WHERE t.id=$1 AND t.video_id=v.id AND t.id_crm=v.id_crm AND v.version=$4 AND COALESCE(t.video_version,0)<v.version RETURNING t.id`,
      [tarjeta.id,next,JSON.stringify(siguientes),v.version,v.ronda_cliente,changed?1:0,!!changed||bloqueado,bloqueo])).rows[0]
      if (row && changed) {
        const texto = bloqueado ? v.estado === 'pausado' ? 'Edición en pausa.' : 'Video descartado.' : tarjeta.motor_bloqueado ? 'Edición retomada.' : tarjeta.etapa === next ? 'Se actualizó el link del editado desde el flujo de trabajo.' : `${tarjeta.etapa} → ${next}`
        const hash = createHash('sha256').update(`${v.id}:${v.version}`).digest('hex').slice(0,24)
        await c.query("INSERT INTO cj_edicion_tarjetas_historial(id,tarjeta_id,quien,tipo,antes,despues,texto,datos) VALUES($1,$2,'Despacho','movimiento',$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING", [`motor_${hash}`,tarjeta.id,tarjeta.etapa,next,texto,JSON.stringify({origen:'motor',video_id:Number(v.id),video_version:Number(v.version)})])
      }
    }
  })
}
