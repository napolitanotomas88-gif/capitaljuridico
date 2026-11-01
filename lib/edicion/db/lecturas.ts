// ── Lecturas del grupo Contenido (f05 / f06): SQL sobre cj_edicion_lecturas (la crea la migración v3) ───────────────────
// reclamar() inserta la fila ANTES de llamar a Claude (mensaje_id único): el mismo mensaje que Whapi manda dos veces se lee
// una sola vez. guardar() anota la lectura y a qué videos va. descartar() la cierra con quién (nombre, nunca el mail).
// Las lecturas no crean la tabla (leer → vacío). Solo servidor.
import type { Lectura, MensajeContenido, ResultadoLectura, VideoConCliente } from '../contenido'
import { nombreVideo } from '../avisos/mensajes'
import { asegurarTablas, consulta, idPositivo, leer, type Fila } from './base'

export interface LecturaGuardada {
  id: number; id_crm: string; texto: string; enviado: string; estado: string
  tipo: Lectura['tipo'] | null; sentido: Lectura['sentido'] | null; motivo: string; resumen: string
  video_ids: number[]; por: string | null; pedido_id: number | null; version: number
  resuelta: string | null; resuelta_por: string | null; creado: string
}

const iso = (x: unknown): string => (x instanceof Date ? x.toISOString() : String(x ?? ''))
const aLectura = (f: Fila): LecturaGuardada => ({
  id: Number(f.id), id_crm: String(f.id_crm), texto: String(f.texto ?? ''), enviado: iso(f.enviado), estado: String(f.estado),
  tipo: (f.tipo as LecturaGuardada['tipo']) ?? null, sentido: (f.sentido as LecturaGuardada['sentido']) ?? null,
  motivo: String(f.motivo ?? ''), resumen: String(f.resumen ?? ''),
  video_ids: Array.isArray(f.video_ids) ? (f.video_ids as unknown[]).map(Number).filter(Number.isSafeInteger) : [],
  por: (f.por as string) ?? null, pedido_id: f.pedido_id === null || f.pedido_id === undefined ? null : Number(f.pedido_id),
  version: Number(f.version ?? 1), resuelta: f.resuelta ? iso(f.resuelta) : null, resuelta_por: (f.resuelta_por as string) ?? null, creado: iso(f.creado),
})

/** Reclama el mensaje. null = ya estaba (otro envío lo tomó). */
export async function reclamarLectura(m: MensajeContenido, c: { idCrm: string }): Promise<number | null> {
  await asegurarTablas()
  return consulta('reclamar lectura', async q => {
    const filas = await q.query(`INSERT INTO cj_edicion_lecturas (mensaje_id, id_crm, texto, enviado) VALUES ($1, $2, $3, $4)
      ON CONFLICT (mensaje_id) DO NOTHING RETURNING id`, [m.mensajeId.slice(0, 200), c.idCrm, m.texto.slice(0, 4_000), m.enviadoEn]) as Fila[]
    return filas[0] ? Number(filas[0].id) : null
  })
}

export async function guardarLectura(id: number, r: ResultadoLectura, modelo: string | null): Promise<void> {
  const lid = idPositivo(id, 'lectura_id')
  await consulta('guardar lectura', q => q.query(`UPDATE cj_edicion_lecturas SET estado=$2, tipo=$3, sentido=$4, motivo=$5, resumen=$6,
      video_ids=$7::bigint[], por=$8, pedido_id=$9, modelo=$10 WHERE id=$1`,
  [lid, r.estado, r.lectura.tipo, r.lectura.sentido, r.lectura.motivo.slice(0, 300), r.lectura.resumen.slice(0, 300), r.videos.map(v => v.id), r.por, r.pedidoId, modelo]))
}

/** Las lecturas del cliente que esperan a Aylu (más las últimas resueltas, para el historial corto). */
export async function lecturasDelCliente(idCrm: string, max = 20): Promise<LecturaGuardada[]> {
  return leer('lecturas del cliente', [] as LecturaGuardada[], async q =>
    ((await q.query(`SELECT * FROM cj_edicion_lecturas WHERE id_crm=$1 AND estado IN ('propuesta_ok','pedido','sin_video','descartada','fallida')
      ORDER BY creado DESC LIMIT $2`, [idCrm, max])) as Fila[]).map(aLectura))
}

/** Cuántas lecturas por cliente esperan a Aylu (para el aviso del tablero). Las del OK cuyo video ya salió de «Con el
 *  cliente» no cuentan: ya se resolvieron por otro lado. */
export async function lecturasPendientes(): Promise<{ id_crm: string; cliente: string; n: number }[]> {
  return leer('lecturas pendientes', [] as { id_crm: string; cliente: string; n: number }[], async q =>
    ((await q.query(`SELECT l.id_crm, (SELECT max(v2.cliente) FROM cj_videos v2 WHERE v2.id_crm=l.id_crm) AS cliente, count(*)::int AS n FROM cj_edicion_lecturas l
      WHERE l.resuelta IS NULL AND l.estado IN ('propuesta_ok','pedido','sin_video')
        AND (l.estado <> 'propuesta_ok' OR EXISTS (SELECT 1 FROM cj_videos v WHERE v.id = ANY(l.video_ids) AND v.estado='con_cliente'))
        AND (l.estado <> 'pedido' OR EXISTS (SELECT 1 FROM cj_video_pedidos p WHERE p.id = l.pedido_id AND p.estado='propuesto'))
      GROUP BY l.id_crm ORDER BY l.id_crm LIMIT 200`)) as Fila[]).map(f => ({ id_crm: String(f.id_crm), cliente: String(f.cliente ?? ''), n: Number(f.n) })))
}

/** Aylu cierra una lectura (no era un OK, ya lo resolvió a mano…). Con la versión que vio: si cambió, false. */
export async function resolverLectura(p: { id: number; version: number; quien: string; estado: 'descartada' | 'usada' }): Promise<boolean> {
  const lid = idPositivo(p.id, 'lectura_id')
  await asegurarTablas()
  return consulta('resolver lectura', async q => ((await q.query(`UPDATE cj_edicion_lecturas SET resuelta=now(), resuelta_por=$3, version=version+1,
      estado=CASE WHEN $4='descartada' THEN 'descartada' ELSE estado END
    WHERE id=$1 AND version=$2 AND resuelta IS NULL RETURNING id`, [lid, p.version, p.quien.slice(0, 80), p.estado])) as Fila[]).length === 1)
}

// ── Lo que el orquestador necesita de los videos ──
export async function videosConCliente(idCrm: string): Promise<VideoConCliente[]> {
  return leer('videos con el cliente', [] as VideoConCliente[], async q =>
    ((await q.query(`SELECT id, version, numero, tanda_guion, clave FROM cj_videos WHERE id_crm=$1 AND estado='con_cliente' ORDER BY id LIMIT 60`, [idCrm])) as Fila[])
      .map(f => {
        const numero = f.numero === null || f.numero === undefined ? null : Number(f.numero)
        const nombre = nombreVideo(String(f.clave ?? ''), true, numero)
        return { id: Number(f.id), version: Number(f.version), numero, tanda_guion: f.tanda_guion === null || f.tanda_guion === undefined ? null : Number(f.tanda_guion), nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1) }
      }))
}

/** El id del CRM por el nombre del cliente en Edición, solo si es uno solo. */
export async function idPorNombreCliente(cliente: string): Promise<string | null> {
  const nombre = cliente.trim()
  if (!nombre) return null
  return leer('cliente por nombre', null as string | null, async q => {
    const filas = await q.query(`SELECT DISTINCT id_crm FROM cj_videos WHERE lower(cliente)=lower($1) LIMIT 2`, [nombre]) as Fila[]
    return filas.length === 1 ? String(filas[0].id_crm) : null
  })
}

/** Los videos que el bot entregó en ese mensaje de WhatsApp (outbox de las tarjetas). */
export async function videosDelMensaje(mensajeId: string): Promise<number[]> {
  return leer('videos del mensaje citado', [] as number[], async q =>
    ((await q.query(`SELECT DISTINCT t.video_id FROM cj_edicion_tarjetas_outbox o JOIN cj_edicion_tarjetas t ON t.id=o.tarjeta_id
      WHERE o.canal='cliente' AND o.mensaje_id=$1 AND t.video_id IS NOT NULL LIMIT 60`, [mensajeId.slice(0, 200)])) as Fila[]).map(f => Number(f.video_id)))
}
