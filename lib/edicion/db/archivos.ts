// ── Archivos de Drive (Neon: cj_grab_archivos y cj_grab_transcripciones) ─────────────────────────────────────────────
//   · guardarArchivos: upsert por drive_id en lotes (jsonb_to_recordset), con una fila por drive_id (si no, 21000). El ON
//     CONFLICT actualiza SOLO si cambió algo de los metadatos (el solapamiento de 120 minutos del vigía no reescribe filas);
//     la inferencia (tanda / video) se rehace solo si cambió la ruta. Un archivo movido a otra raíz o a otro cliente toma el
//     tipo y el id_crm nuevos y suelta su video, su propuesta y su tanda. Devuelve los nuevos y los movidos.
//     (El link del editado que quedó en un video se suelta en la misma sentencia: CTE `suelto`.)
//   · marcarBorrados: SOLO la pasada completa, con el listado ENTERO de la raíz (si no, marcaría de más).
//   · vincularArchivo: un vínculo puesto por una persona no lo pisa nunca el bot; el video tiene que ser del mismo cliente.
//     Vincular un editado deja el link en el video y limpia el bloqueo sin_link_editado; desvincularlo lo saca del video.
//   · transcripción: reclamarTranscripcion (pendiente → enviando, con condición), anotarTranscripcion, guardarTranscripcion
//     (→ lista, en la misma sentencia), anotarBorradaProveedor, porProveedorId, colgadas.
// Sin mails: el dueño del archivo ya llega reducido a `subio`. Solo servidor.
import type { Actor, ArchivoDrive, ArchivoGrabacion, EstadoTranscripcion, IdCrm, ResultadoEscritura, TipoArchivo, Transcripcion } from '../tipos'
import { ENVIADA_CONSULTAR_MIN, ENVIANDO_COLGADA_MIN, MOTIVO_DUPLICADO } from '../config'
import { ErrorEntradaEdicion, asegurarTablas, consulta, entero, idCrm, idPositivo, iso, json, leer, num, txt, type Fila } from './base'
import { aArchivo, columnasActor } from './filas'

const LOTE = 400

export interface ArchivoAGuardar extends ArchivoDrive {
  inferido?: { tanda_guion: number | null; numero: number | null; por: 'carpeta' | 'nombre' | null }
  tr_estado?: EstadoTranscripcion
}

/** Link de Drive de un archivo (para el video editado y la pantalla). */
export const linkDrive = (driveId: string): string => `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`

export async function guardarArchivos(id_crm: IdCrm, tipo: TipoArchivo, entrada: ArchivoAGuardar[]): Promise<{ nuevos: ArchivoGrabacion[]; actualizados: number; movidos: ArchivoGrabacion[] }> {
  const id = idCrm(id_crm)
  // Una fila por drive_id: dos filas del mismo id en un INSERT … ON CONFLICT DO UPDATE dan 21000 en Postgres
  const porId = new Map<string, ArchivoAGuardar>()
  for (const a of entrada) { porId.delete(a.drive_id); porId.set(a.drive_id, a) }
  const xs = [...porId.values()]
  if (!xs.length) return { nuevos: [], actualizados: 0, movidos: [] }
  await asegurarTablas()
  const nuevos: ArchivoGrabacion[] = [], movidos: ArchivoGrabacion[] = []
  let actualizados = 0
  for (let i = 0; i < xs.length; i += LOTE) {
    const lote = xs.slice(i, i + LOTE).map(a => ({
      drive_id: a.drive_id, carpeta_id: a.carpeta_id, ruta: a.ruta, nombre: a.nombre.slice(0, 300), mime: a.mime.slice(0, 120),
      bytes: a.bytes, duracion_ms: a.duracion_ms, ancho: a.ancho, alto: a.alto, subio: a.subio, creado: a.creado || null, modificado: a.modificado || null,
      inf_tanda: a.inferido?.tanda_guion ?? null, inf_numero: a.inferido?.numero ?? null, inf_por: a.inferido?.por ?? null,
      tr_estado: a.tr_estado ?? 'no_aplica',
    }))
    const filas = await consulta('guardar archivos', q => q`INSERT INTO cj_grab_archivos (drive_id, id_crm, tipo, carpeta_id, ruta, nombre, mime, bytes,
        duracion_ms, ancho, alto, subio, creado_drive, modificado_drive, inf_tanda, inf_numero, inf_por, tr_estado)
      SELECT x.drive_id, ${id}, ${tipo}, x.carpeta_id, ARRAY(SELECT jsonb_array_elements_text(x.ruta)), x.nombre, x.mime, x.bytes,
        x.duracion_ms, x.ancho, x.alto, x.subio, x.creado, x.modificado, x.inf_tanda, x.inf_numero, x.inf_por, x.tr_estado
      FROM jsonb_to_recordset(${JSON.stringify(lote)}::jsonb) AS x(drive_id text, carpeta_id text, ruta jsonb, nombre text, mime text, bytes bigint,
        duracion_ms bigint, ancho int, alto int, subio text, creado timestamptz, modificado timestamptz, inf_tanda int, inf_numero int, inf_por text, tr_estado text)
      ON CONFLICT (drive_id) DO UPDATE SET
        carpeta_id = EXCLUDED.carpeta_id, ruta = EXCLUDED.ruta, nombre = EXCLUDED.nombre,
        -- Movido a otra raíz (Crudos ↔ Editados) o a la carpeta de otro cliente: toma el tipo y el cliente nuevos y suelta lo
        -- que dependía del lugar de antes (video, propuesta, tanda; la transcripción vuelve a calcularse para el tipo nuevo)
        tipo = EXCLUDED.tipo, id_crm = EXCLUDED.id_crm,
        video_id = CASE WHEN (cj_grab_archivos.tipo, cj_grab_archivos.id_crm) IS DISTINCT FROM (EXCLUDED.tipo, EXCLUDED.id_crm) THEN NULL ELSE cj_grab_archivos.video_id END,
        asignado_por = CASE WHEN (cj_grab_archivos.tipo, cj_grab_archivos.id_crm) IS DISTINCT FROM (EXCLUDED.tipo, EXCLUDED.id_crm) THEN NULL ELSE cj_grab_archivos.asignado_por END,
        propuesta_video_id = CASE WHEN (cj_grab_archivos.tipo, cj_grab_archivos.id_crm) IS DISTINCT FROM (EXCLUDED.tipo, EXCLUDED.id_crm) THEN NULL ELSE cj_grab_archivos.propuesta_video_id END,
        tanda_id = CASE WHEN (cj_grab_archivos.tipo, cj_grab_archivos.id_crm) IS DISTINCT FROM (EXCLUDED.tipo, EXCLUDED.id_crm) THEN NULL ELSE cj_grab_archivos.tanda_id END,
        tr_estado = CASE WHEN cj_grab_archivos.tipo IS DISTINCT FROM EXCLUDED.tipo AND cj_grab_archivos.tr_estado IN ('no_aplica', 'pendiente', 'vieja')
          THEN EXCLUDED.tr_estado ELSE cj_grab_archivos.tr_estado END,
        bytes = COALESCE(EXCLUDED.bytes, cj_grab_archivos.bytes), duracion_ms = COALESCE(EXCLUDED.duracion_ms, cj_grab_archivos.duracion_ms),
        ancho = COALESCE(EXCLUDED.ancho, cj_grab_archivos.ancho), alto = COALESCE(EXCLUDED.alto, cj_grab_archivos.alto),
        modificado_drive = EXCLUDED.modificado_drive, borrado = NULL, visto = now(),
        inf_tanda = CASE WHEN cj_grab_archivos.ruta IS DISTINCT FROM EXCLUDED.ruta THEN EXCLUDED.inf_tanda ELSE cj_grab_archivos.inf_tanda END,
        inf_numero = CASE WHEN cj_grab_archivos.ruta IS DISTINCT FROM EXCLUDED.ruta THEN EXCLUDED.inf_numero ELSE cj_grab_archivos.inf_numero END,
        inf_por = CASE WHEN cj_grab_archivos.ruta IS DISTINCT FROM EXCLUDED.ruta THEN EXCLUDED.inf_por ELSE cj_grab_archivos.inf_por END
      WHERE (cj_grab_archivos.carpeta_id, cj_grab_archivos.ruta, cj_grab_archivos.nombre, cj_grab_archivos.modificado_drive, cj_grab_archivos.borrado,
            cj_grab_archivos.tipo, cj_grab_archivos.id_crm)
          IS DISTINCT FROM (EXCLUDED.carpeta_id, EXCLUDED.ruta, EXCLUDED.nombre, EXCLUDED.modificado_drive, NULL::timestamptz, EXCLUDED.tipo, EXCLUDED.id_crm)
        OR (EXCLUDED.bytes IS NOT NULL AND cj_grab_archivos.bytes IS DISTINCT FROM EXCLUDED.bytes)
        OR (EXCLUDED.duracion_ms IS NOT NULL AND cj_grab_archivos.duracion_ms IS DISTINCT FROM EXCLUDED.duracion_ms)
      RETURNING *, (xmax = 0) AS insertado` as Promise<Fila[]>)
    for (const f of filas) {
      const a = aArchivo(f)
      if (f.insertado === true) nuevos.push(a)
      else { actualizados++; movidos.push(a) }
    }
  }
  // Un editado vinculado que se movió a Crudos (o a los Editados de OTRO cliente) deja de ser el editado del video: se suelta
  // el link, con su versión y su evento en la misma sentencia. Van todos los movidos: el SQL decide (revisión de la
  // integración, ronda 3: antes solo iban los que dejaron de ser editados y el editado movido a otro cliente seguía siendo el
  // link final del video del cliente anterior)
  const ids = movidos.map(a => a.id)
  if (ids.length) {
    await consulta('soltar editados movidos', q => q`WITH s AS (
        UPDATE cj_videos v SET editado_archivo_id = NULL, editado_url = NULL, version = v.version + 1, actualizado = now()
        FROM cj_grab_archivos a
        WHERE a.id = v.editado_archivo_id AND a.id = ANY(${ids}::bigint[]) AND (a.tipo <> 'editado' OR a.id_crm <> v.id_crm)
        RETURNING v.id, v.id_crm, a.id AS archivo_id, a.nombre, a.tipo
      )
      INSERT INTO cj_video_eventos (video_id, id_crm, tipo, actor_tipo, actor_rol, actor_nombre, nota, datos)
      SELECT s.id, s.id_crm, 'editado_vinculado', 'bot', 'vigia', 'bot',
        CASE WHEN s.tipo <> 'editado' THEN 'el archivo ya no está en Editados' ELSE 'el archivo pasó a los Editados de otro cliente' END,
        jsonb_build_object('archivo_id', s.archivo_id, 'nombre', s.nombre, 'desvinculado', true)
      FROM s`)
  }
  return { nuevos, actualizados, movidos }
}

/** Marca como borrados los archivos de la raíz que ya no están (solo con el listado completo de la raíz). */
export async function marcarBorrados(raiz_id: string, presentes: string[]): Promise<ArchivoGrabacion[]> {
  if (typeof raiz_id !== 'string' || !raiz_id) throw new ErrorEntradaEdicion('raiz_id', 'raíz inválida')
  await asegurarTablas()
  const filas = await consulta('marcar borrados', q => q`UPDATE cj_grab_archivos a SET borrado = now()
    FROM cj_grab_carpetas c
    WHERE c.drive_id = a.carpeta_id AND c.raiz_id = ${raiz_id} AND a.borrado IS NULL AND NOT (a.drive_id = ANY(${presentes}::text[]))
    RETURNING a.*` as Promise<Fila[]>)
  return filas.map(aArchivo)
}

const quienAsigna = (a: Actor): ArchivoGrabacion['asignado_por'] => (a.tipo === 'bot' ? 'bot' : a.rol)

export async function vincularArchivo(p: { archivo_id: number; video_id: number | null; actor: Actor; por?: 'carpeta' | 'nombre' | 'contenido' }): Promise<ResultadoEscritura<ArchivoGrabacion>> {
  const aid = idPositivo(p.archivo_id, 'archivo_id')
  const vid = p.video_id === null ? null : idPositivo(p.video_id, 'video_id')
  const esBot = p.actor.tipo === 'bot'
  const quien = quienAsigna(p.actor)
  const a = columnasActor(p.actor)
  await asegurarTablas()
  return consulta('vincular archivo', async q => {
    const filas = await q`WITH antes AS (
        SELECT id, video_id, tipo FROM cj_grab_archivos WHERE id = ${aid} AND borrado IS NULL FOR UPDATE
      ), x AS (
        UPDATE cj_grab_archivos f SET video_id = ${vid}, asignado_por = ${vid === null ? null : quien}, inf_por = COALESCE(${p.por ?? null}, f.inf_por),
          propuesta_video_id = CASE WHEN f.propuesta_video_id = ${vid} THEN NULL ELSE f.propuesta_video_id END
        FROM antes
        WHERE f.id = antes.id
          AND (NOT ${esBot}::boolean OR f.asignado_por IS NULL OR f.asignado_por = 'bot')
          AND (${vid}::bigint IS NULL OR EXISTS (SELECT 1 FROM cj_videos v WHERE v.id = ${vid} AND v.id_crm = f.id_crm))
        RETURNING f.*
      ), suelto AS (
        UPDATE cj_videos SET editado_archivo_id = NULL, editado_url = NULL, version = version + 1, actualizado = now()
        WHERE editado_archivo_id IN (SELECT id FROM x) AND (${vid}::bigint IS NULL OR id <> ${vid})
        RETURNING id
      ), v AS (
        UPDATE cj_videos SET editado_archivo_id = x.id, editado_url = 'https://drive.google.com/file/d/' || x.drive_id || '/view',
          bloqueo = CASE WHEN cj_videos.bloqueo = 'sin_link_editado' THEN NULL ELSE cj_videos.bloqueo END,
          motivo_bloqueo = CASE WHEN cj_videos.bloqueo = 'sin_link_editado' THEN '' ELSE cj_videos.motivo_bloqueo END,
          version = cj_videos.version + 1, actualizado = now()
        FROM x WHERE x.tipo = 'editado' AND cj_videos.id = x.video_id
        RETURNING cj_videos.id
      ), e AS (
        INSERT INTO cj_video_eventos (video_id, id_crm, tipo, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
        SELECT COALESCE(x.video_id, antes.video_id), x.id_crm, CASE WHEN x.tipo = 'editado' THEN 'editado_vinculado' ELSE 'crudo_vinculado' END,
          ${a.tipo}, ${a.rol}, ${a.nombre}, ${a.email}, '',
          jsonb_build_object('archivo_id', x.id, 'nombre', x.nombre, 'por', ${p.por ?? null}::text, 'desvinculado', x.video_id IS NULL)
        FROM x JOIN antes ON antes.id = x.id
        WHERE COALESCE(x.video_id, antes.video_id) IS NOT NULL AND x.video_id IS DISTINCT FROM antes.video_id
        RETURNING id
      )
      SELECT row_to_json(x) AS archivo, (SELECT count(*) FROM v) AS videos FROM x`
    const f = (filas as Fila[])[0]
    if (f) return { ok: true, actual: aArchivo(f.archivo as Fila) }
    const [ya] = await q`SELECT * FROM cj_grab_archivos WHERE id = ${aid}` as Fila[]
    if (!ya || ya.borrado) return { ok: false, motivo: 'no_existe', actual: null }
    const arch = aArchivo(ya)
    if (esBot && arch.asignado_por && arch.asignado_por !== 'bot') return { ok: false, motivo: 'no_permitido', actual: arch, detalle: 'lo asignó una persona: el bot no lo pisa' }
    return { ok: false, motivo: 'no_permitido', actual: arch, detalle: 'el video no existe o es de otro cliente' }
  })
}

/** El bot propone un editado para un video (René o Aylu lo aceptan en la pantalla). Una sola vez por archivo. */
export async function proponerEditado(archivo_id: number, video_id: number): Promise<void> {
  const aid = idPositivo(archivo_id, 'archivo_id'), vid = idPositivo(video_id, 'video_id')
  await asegurarTablas()
  await consulta('proponer editado', q => q`WITH x AS (
      UPDATE cj_grab_archivos f SET propuesta_video_id = ${vid}
      WHERE f.id = ${aid} AND f.video_id IS NULL AND f.propuesta_video_id IS DISTINCT FROM ${vid}
        AND EXISTS (SELECT 1 FROM cj_videos v WHERE v.id = ${vid} AND v.id_crm = f.id_crm)
      RETURNING f.*
    )
    INSERT INTO cj_video_eventos (video_id, id_crm, tipo, actor_tipo, actor_rol, actor_nombre, nota, datos)
    SELECT ${vid}::bigint, x.id_crm, 'editado_propuesto', 'bot', 'vigia', 'bot', '', jsonb_build_object('archivo_id', x.id, 'nombre', x.nombre) FROM x`)
}

// ── Transcripción ───────────────────────────────────────────────────────────────────────────────────────────────
export async function pendientesDeTranscribir(limite: number, excluidos: readonly string[] = [], videosExcluidos: readonly number[] = []): Promise<ArchivoGrabacion[]> {
  const n = Math.max(1, Math.min(200, Math.trunc(limite)))
  const filas = await leer('pendientes de transcribir', [] as Fila[], q => q`SELECT * FROM cj_grab_archivos
    WHERE tipo = 'crudo' AND tr_estado = 'pendiente' AND borrado IS NULL AND (mime LIKE 'video/%' OR mime LIKE 'audio/%')
      AND NOT (upper(id_crm) = ANY(${[...excluidos]}::text[]))
      AND (video_id IS NULL OR NOT (video_id = ANY(${[...videosExcluidos]}::bigint[])))
    ORDER BY creado_drive NULLS LAST, id LIMIT ${n}` as Promise<Fila[]>)
  return filas.map(aArchivo)
}

/** pendiente → enviando, con condición (dos corridas no mandan el mismo archivo). */
export async function reclamarTranscripcion(archivo_id: number, segundosEstimados: number | null = null): Promise<boolean> {
  const id = idPositivo(archivo_id, 'archivo_id')
  await asegurarTablas()
  const filas = await consulta('reclamar transcripción', q => q`UPDATE cj_grab_archivos SET tr_estado = 'enviando', tr_intentos = tr_intentos + 1,
      tr_enviado = now(), tr_segundos = COALESCE(${segundosEstimados}::int, tr_segundos)
    WHERE id = ${id} AND tr_estado = 'pendiente' RETURNING id` as Promise<Fila[]>)
  return filas.length > 0
}

export async function anotarTranscripcion(archivo_id: number, c: { estado: EstadoTranscripcion; proveedor_id?: string; motivo?: string }): Promise<void> {
  const id = idPositivo(archivo_id, 'archivo_id')
  await asegurarTablas()
  await consulta('anotar transcripción', q => q`UPDATE cj_grab_archivos SET tr_estado = ${c.estado}, tr_id = COALESCE(${c.proveedor_id ?? null}, tr_id),
      tr_motivo = ${(c.motivo ?? '').slice(0, 300)}, tr_listo = CASE WHEN ${c.estado} = 'lista' THEN now() ELSE tr_listo END
    WHERE id = ${id}`)
}

/** Guarda el texto y pasa el archivo a `lista` en la misma sentencia (después se borra del lado del proveedor). */
export async function guardarTranscripcion(t: Transcripcion): Promise<void> {
  const id = idPositivo(t.archivo_id, 'archivo_id')
  await asegurarTablas()
  await consulta('guardar transcripción', q => q`WITH t AS (
      INSERT INTO cj_grab_transcripciones (archivo_id, proveedor, proveedor_id, modelo, idioma, texto, palabras, duracion_ms)
      SELECT a.id, ${t.proveedor}::text, a.tr_id, ${t.modelo}::text, ${t.idioma}::text, ${t.texto}::text, ${JSON.stringify(t.palabras)}::jsonb, ${t.duracion_ms}::bigint
      FROM cj_grab_archivos a WHERE a.id = ${id}
      ON CONFLICT (archivo_id) DO UPDATE SET texto = EXCLUDED.texto, palabras = EXCLUDED.palabras, modelo = EXCLUDED.modelo,
        idioma = EXCLUDED.idioma, duracion_ms = EXCLUDED.duracion_ms, creado = now()
      RETURNING archivo_id
    )
    UPDATE cj_grab_archivos SET tr_estado = 'lista', tr_listo = now(), tr_motivo = '', duracion_ms = COALESCE(duracion_ms, ${t.duracion_ms}::bigint),
      -- el tope diario cuenta la duración REAL desde que se sabe (al enviar se anotó una estimación por el peso)
      tr_segundos = COALESCE(CEIL(${t.duracion_ms}::bigint / 1000.0)::int, tr_segundos)
    WHERE id IN (SELECT archivo_id FROM t)`)
}

export async function anotarBorradaProveedor(archivo_id: number, borrada = true): Promise<void> {
  const id = idPositivo(archivo_id, 'archivo_id')
  await asegurarTablas()
  await consulta('anotar borrado del proveedor', q => q`UPDATE cj_grab_archivos SET tr_borrada_proveedor = ${borrada} WHERE id = ${id}`)
}

export async function porProveedorId(id: string): Promise<ArchivoGrabacion | null> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(id)) return null
  const [f] = await leer('archivo por proveedor', [] as Fila[], q => q`SELECT * FROM cj_grab_archivos WHERE tr_id = ${id}` as Promise<Fila[]>)
  return f ? aArchivo(f) : null
}

export async function leerArchivo(id: number): Promise<ArchivoGrabacion | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const [f] = await leer('leer archivo', [] as Fila[], q => q`SELECT * FROM cj_grab_archivos WHERE id = ${id}` as Promise<Fila[]>)
  return f ? aArchivo(f) : null
}

export async function transcripcionesDe(ids: number[]): Promise<Transcripcion[]> {
  const xs = ids.filter(n => Number.isSafeInteger(n) && n > 0)
  if (!xs.length) return []
  const filas = await leer('transcripciones', [] as Fila[], q => q`SELECT * FROM cj_grab_transcripciones WHERE archivo_id = ANY(${xs}::bigint[])` as Promise<Fila[]>)
  return filas.map(f => ({
    archivo_id: entero(f.archivo_id), proveedor: 'assemblyai' as const, modelo: txt(f.modelo), idioma: txt(f.idioma), texto: txt(f.texto),
    palabras: json<[number, number, string][]>(f.palabras, []), duracion_ms: num(f.duracion_ms), creado: iso(f.creado),
  }))
}

/** Lo que quedó a medias: enviando de más de 10 min, enviada de más de 30 min y listas sin borrar del proveedor. */
export async function colgadas(ahora: Date): Promise<{ enviando: ArchivoGrabacion[]; enviada: ArchivoGrabacion[]; sinBorrar: ArchivoGrabacion[] }> {
  const t = ahora.getTime()
  const enviandoAntes = new Date(t - ENVIANDO_COLGADA_MIN * 60_000).toISOString()
  const enviadaAntes = new Date(t - ENVIADA_CONSULTAR_MIN * 60_000).toISOString()
  const filas = await leer('transcripciones colgadas', [] as Fila[], q => q`SELECT * FROM cj_grab_archivos
    WHERE (tr_estado = 'enviando' AND tr_enviado < ${enviandoAntes}::timestamptz)
       OR (tr_estado = 'enviada' AND tr_enviado < ${enviadaAntes}::timestamptz)
       OR (tr_estado = 'lista' AND tr_id IS NOT NULL AND NOT tr_borrada_proveedor)
    ORDER BY tr_enviado NULLS FIRST LIMIT 100` as Promise<Fila[]>)
  const xs = filas.map(f => ({ a: aArchivo(f), f }))
  return {
    enviando: xs.filter(x => x.a.transcripcion.estado === 'enviando').map(x => x.a),
    enviada: xs.filter(x => x.a.transcripcion.estado === 'enviada').map(x => x.a),
    sinBorrar: xs.filter(x => x.a.transcripcion.estado === 'lista').map(x => x.a),
  }
}

/** Segundos de audio mandados a transcribir desde `desde` (tope diario de minutos). */
export async function segundosEnviadosDesde(desde: string): Promise<number> {
  const [f] = await leer('minutos del día', [] as Fila[], q => q`SELECT coalesce(sum(coalesce(tr_segundos, duracion_ms / 1000, 0)), 0) AS s FROM cj_grab_archivos
    WHERE tr_enviado >= ${desde}::timestamptz AND tr_estado IN ('enviando', 'enviada', 'lista', 'error')` as Promise<Fila[]>)
  return entero(f?.s)
}

/** Otro crudo del mismo cliente con el mismo nombre y peso que ya se mandó o se transcribió (subido dos veces). */
export async function buscarGemelo(a: Pick<ArchivoGrabacion, 'id' | 'id_crm' | 'nombre' | 'bytes'>): Promise<number | null> {
  if (a.bytes === null) return null
  const [f] = await leer('buscar gemelo', [] as Fila[], q => q`SELECT id FROM cj_grab_archivos
    WHERE id_crm = ${a.id_crm} AND nombre = ${a.nombre} AND bytes = ${a.bytes} AND id <> ${a.id} AND borrado IS NULL
      AND tr_estado IN ('enviando', 'enviada', 'lista') ORDER BY id LIMIT 1` as Promise<Fila[]>)
  return f ? entero(f.id) : null
}

/** Crudos del cliente desde una fecha (la comparación es por tanda del guion: todos los crudos desde que pasó a grabar). */
export async function crudosDeCliente(id_crm: IdCrm, desde: string | null): Promise<ArchivoGrabacion[]> {
  const id = idCrm(id_crm)
  const filas = await leer('crudos del cliente', [] as Fila[], q => q`SELECT * FROM cj_grab_archivos
    WHERE id_crm = ${id} AND tipo = 'crudo' AND borrado IS NULL AND (${desde}::timestamptz IS NULL OR creado_drive >= ${desde}::timestamptz)
    ORDER BY creado_drive, id LIMIT 600` as Promise<Fila[]>)
  return filas.map(aArchivo)
}

export async function archivosDeTanda(tanda_id: number): Promise<ArchivoGrabacion[]> {
  const id = idPositivo(tanda_id, 'tanda_id')
  const filas = await leer('archivos de la tanda', [] as Fila[], q => q`SELECT * FROM cj_grab_archivos WHERE tanda_id = ${id} AND borrado IS NULL ORDER BY creado_drive, id` as Promise<Fila[]>)
  return filas.map(aArchivo)
}

/** Para el diario: crudos sin ubicar (por cliente), editados sin vincular y crudos que no se transcriben solos. */
export interface EstadoArchivos {
  sinUbicar: { id_crm: IdCrm; creado: string; subio: ArchivoGrabacion['subio'] }[]
  editadosPorVincular: number
  sinTranscribir: { id_crm: IdCrm; archivos: number; motivo: 'grande' | 'link_privado' | 'error' }[]
}
export async function estadoArchivos(desde: string): Promise<EstadoArchivos> {
  return leer('estado de archivos', { sinUbicar: [], editadosPorVincular: 0, sinTranscribir: [] } as EstadoArchivos, async q => {
    const [sin, ed, tr] = await Promise.all([
      // Solo videos y audios (una foto o un PDF en Crudos no se transcribe ni se ubica) y sin las copias marcadas como
      // duplicado (su gemelo es el que se transcribe y se ubica): si no, frenaban el e01 hasta 30 días (revisión de la
      // integración, ronda 3)
      q`SELECT id_crm, creado_drive, subio FROM cj_grab_archivos WHERE tipo = 'crudo' AND video_id IS NULL AND borrado IS NULL
        AND (mime LIKE 'video/%' OR mime LIKE 'audio/%') AND NOT (tr_estado = 'no_aplica' AND tr_motivo LIKE ${MOTIVO_DUPLICADO + '%'})
        AND creado_drive >= ${desde}::timestamptz ORDER BY creado_drive LIMIT 2000` as Promise<Fila[]>,
      q`SELECT count(*) AS n FROM cj_grab_archivos WHERE tipo = 'editado' AND video_id IS NULL AND borrado IS NULL` as Promise<Fila[]>,
      q`SELECT id_crm, CASE WHEN tr_estado = 'grande' THEN 'grande' WHEN tr_motivo LIKE 'link_privado%' THEN 'link_privado' ELSE 'error' END AS motivo,
          count(*) AS n
        FROM cj_grab_archivos WHERE tipo = 'crudo' AND borrado IS NULL AND tr_estado IN ('grande', 'error')
        GROUP BY 1, 2 ORDER BY 1` as Promise<Fila[]>,
    ])
    return {
      sinUbicar: sin.map(f => ({ id_crm: txt(f.id_crm), creado: iso(f.creado_drive), subio: (txt(f.subio) || 'desconocido') as ArchivoGrabacion['subio'] })),
      editadosPorVincular: entero(ed[0]?.n),
      sinTranscribir: tr.map(f => ({ id_crm: txt(f.id_crm), archivos: entero(f.n), motivo: txt(f.motivo) as 'grande' | 'link_privado' | 'error' })),
    }
  })
}
