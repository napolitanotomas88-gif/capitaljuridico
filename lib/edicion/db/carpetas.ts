// ── Árbol de carpetas de Drive por cliente (Neon: cj_grab_carpetas) ────────────────────────────────────────────────
// Tres niveles de tipo: la carpeta del CLIENTE (vínculo con el CRM), sus raíces (Crudos / Editados / Marca: raiz_id = la
// propia) y las subcarpetas (tipo `sub`, raiz_id = la raíz). Las subcarpetas heredan el cliente y el vínculo de la raíz.
// Vínculos (P: cliente equivocado):
//   · `alta` (vino de cj_altas), `aylu` / `tomas` (confirmado en la pantalla) y `bot` SOLO cuando el nombre normalizado
//     coincide exacto con un único cliente del CRM: esos procesan (tandas, videos, e01);
//   · `a_confirmar`: se listan con sus candidatos pero NO se procesa nada; a Aylu le llega un aviso una sola vez por carpeta.
//   · Un vínculo de una persona no lo pisa nunca la pasada del bot.
// vigilar: lo recalcula la pasada completa (ajustarVigilancia) y lo prende el vigía para las subcarpetas nuevas.
import type { Actor, CarpetaGrabacion, IdCrm, ResultadoEscritura } from '../tipos'
import { DIAS_SUBCARPETA_VIGILADA } from '../config'
import { asegurarTablas, consulta, idCrm, leer, type Fila } from './base'
import { aCarpeta, columnasActor, nombreActor } from './filas'

export const VINCULOS_QUE_PROCESAN = ['alta', 'aylu', 'tomas', 'bot'] as const
const LOTE = 400

/** Una fila por drive_id (la última gana): un INSERT … ON CONFLICT DO UPDATE con dos filas del mismo id da 21000 en Postgres. */
export function unaPorDriveId<T extends { drive_id: string }>(xs: readonly T[]): T[] {
  const m = new Map<string, T>()
  for (const x of xs) { m.delete(x.drive_id); m.set(x.drive_id, x) }
  return [...m.values()]
}

/** Upsert del árbol. `pisarVigilar`: la pasada completa recalcula; el vigía solo prende (nunca apaga). */
export async function guardarArbol(entrada: CarpetaGrabacion[], op: { pisarVigilar?: boolean } = {}): Promise<number> {
  const xs = unaPorDriveId(entrada)
  if (!xs.length) return 0
  await asegurarTablas()
  let n = 0
  for (let i = 0; i < xs.length; i += LOTE) {
    const lote = xs.slice(i, i + LOTE).map(c => ({
      drive_id: c.drive_id, id_crm: c.id_crm ? c.id_crm.toUpperCase() : null, tipo: c.tipo, raiz: c.raiz, raiz_id: c.raiz_id, padre_id: c.padre_id,
      nombre: c.nombre.slice(0, 300), ruta: c.ruta, nivel: c.nivel, vinculo: c.vinculo, candidatos: (c.candidatos ?? []).slice(0, 5), vigilar: c.vigilar === true,
      // La carpeta del cliente llega del lector sin estos campos: undefined en el JSON es NULL y vigilar es NOT NULL (26/10)
      creada: c.creada ?? null, ultimo_archivo: c.ultimo_archivo ?? null,
    }))
    const filas = await consulta('guardar árbol', q => q`INSERT INTO cj_grab_carpetas (drive_id, id_crm, tipo, raiz, raiz_id, padre_id, nombre, ruta, nivel,
        vinculo, candidatos, vigilar, creada, ultimo_archivo)
      SELECT x.drive_id, x.id_crm, x.tipo, x.raiz, x.raiz_id, x.padre_id, x.nombre, ARRAY(SELECT jsonb_array_elements_text(x.ruta)), x.nivel,
        x.vinculo, COALESCE(x.candidatos, '[]'::jsonb), x.vigilar, x.creada, x.ultimo_archivo
      FROM jsonb_to_recordset(${JSON.stringify(lote)}::jsonb) AS x(drive_id text, id_crm text, tipo text, raiz text, raiz_id text, padre_id text,
        nombre text, ruta jsonb, nivel int, vinculo text, candidatos jsonb, vigilar boolean, creada timestamptz, ultimo_archivo timestamptz)
      ON CONFLICT (drive_id) DO UPDATE SET
        nombre = EXCLUDED.nombre, padre_id = EXCLUDED.padre_id, ruta = EXCLUDED.ruta, nivel = EXCLUDED.nivel,
        tipo = EXCLUDED.tipo, raiz = EXCLUDED.raiz, raiz_id = EXCLUDED.raiz_id, borrada = NULL, visto = now(),
        creada = COALESCE(cj_grab_carpetas.creada, EXCLUDED.creada),
        ultimo_archivo = GREATEST(cj_grab_carpetas.ultimo_archivo, EXCLUDED.ultimo_archivo),
        id_crm = CASE WHEN cj_grab_carpetas.vinculo IN ('alta', 'aylu', 'tomas') THEN cj_grab_carpetas.id_crm ELSE EXCLUDED.id_crm END,
        vinculo = CASE WHEN cj_grab_carpetas.vinculo IN ('alta', 'aylu', 'tomas') THEN cj_grab_carpetas.vinculo ELSE EXCLUDED.vinculo END,
        candidatos = CASE WHEN cj_grab_carpetas.vinculo IN ('alta', 'aylu', 'tomas') THEN cj_grab_carpetas.candidatos ELSE EXCLUDED.candidatos END,
        vigilar = CASE WHEN ${op.pisarVigilar === true}::boolean THEN EXCLUDED.vigilar ELSE (cj_grab_carpetas.vigilar OR EXCLUDED.vigilar) END
      RETURNING drive_id` as Promise<Fila[]>)
    n += filas.length
  }
  return n
}

/** Las carpetas a consultar en esta corrida, de la consultada hace más tiempo a la más reciente. Solo vínculos que procesan. */
export async function carpetasAVigilar(limite: number, excluidos: readonly string[] = []): Promise<CarpetaGrabacion[]> {
  const n = Math.max(1, Math.min(2_000, Math.trunc(limite)))
  const filas = await leer('carpetas a vigilar', [] as Fila[], q => q`SELECT * FROM cj_grab_carpetas
    WHERE vigilar AND borrada IS NULL AND id_crm IS NOT NULL AND vinculo IN ('alta', 'aylu', 'tomas', 'bot') AND raiz IN ('crudos', 'editados')
      AND NOT (upper(id_crm) = ANY(${[...excluidos]}::text[]))
    ORDER BY consultada NULLS FIRST, nivel, drive_id LIMIT ${n}` as Promise<Fila[]>)
  return filas.map(aCarpeta)
}

/** Anota la hora de la consulta (la que se usa para el filtro por fecha de la próxima) y el último archivo visto. */
export async function anotarConsulta(drive_id: string, cuando: string, ultimo_archivo?: string | null): Promise<void> {
  await anotarConsultas([{ drive_id, cuando, ultimo_archivo: ultimo_archivo ?? null }])
}
export async function anotarConsultas(entrada: { drive_id: string; cuando: string; ultimo_archivo: string | null }[]): Promise<void> {
  // Una por carpeta (la consulta más reciente y el último archivo más nuevo)
  const m = new Map<string, { drive_id: string; cuando: string; ultimo_archivo: string | null }>()
  for (const x of entrada) {
    const y = m.get(x.drive_id)
    m.set(x.drive_id, y ? { drive_id: x.drive_id, cuando: x.cuando > y.cuando ? x.cuando : y.cuando,
      ultimo_archivo: [x.ultimo_archivo, y.ultimo_archivo].filter((u): u is string => !!u).sort().pop() ?? null } : x)
  }
  const xs = [...m.values()]
  if (!xs.length) return
  await asegurarTablas()
  await consulta('anotar consultas', q => q`UPDATE cj_grab_carpetas c SET consultada = x.cuando,
      ultimo_archivo = GREATEST(c.ultimo_archivo, x.ultimo_archivo)
    FROM jsonb_to_recordset(${JSON.stringify(xs)}::jsonb) AS x(drive_id text, cuando timestamptz, ultimo_archivo timestamptz)
    WHERE c.drive_id = x.drive_id`)
}

export const MOTIVO_VINCULO_CORREGIDO = 'la carpeta de sus crudos era de otro cliente (vínculo corregido): revisar o descartar'

/**
 * Aylu o Tomás confirman (o cambian) a qué cliente va la carpeta de un cliente; baja a sus raíces, subcarpetas y archivos.
 * Si el cliente CAMBIA ("Corregir el cliente"), lo que se armó con el cliente anterior se suelta en la misma sentencia
 * (revisión de la integración, ronda 3: los crudos quedaban vinculados a videos del cliente anterior y la comparación del
 * nuevo movía esos videos con material ajeno):
 *   · los archivos que cambian de cliente pierden su video, su propuesta, su tanda y quién los asignó, y su fecha de Drive
 *     queda vacía para que la próxima pasada completa los vuelva a mirar (ubicación por carpeta o nombre) con el cliente nuevo;
 *   · los videos del cliente anterior sueltan el link del editado que salía de esa carpeta y, si tenían crudos de ahí y no
 *     están cerrados, quedan bloqueados (`crudo_borrado`) para que Aylu decida; cada desvínculo deja su evento;
 *   · las tandas del cliente anterior que quedan sin archivos se cierran (no se comparan ni se avisan vacías).
 * Lo que salió del doc de guiones de la carpeta lo resuelve la próxima lectura del doc (vigia.ts → procesarDoc).
 */
export async function confirmarVinculo(p: { drive_id: string; id_crm: IdCrm; actor: Actor }): Promise<ResultadoEscritura<CarpetaGrabacion>> {
  if (typeof p.drive_id !== 'string' || !/^[A-Za-z0-9_-]{10,80}$/.test(p.drive_id)) return { ok: false, motivo: 'no_existe', actual: null }
  const id = idCrm(p.id_crm)
  if (p.actor.tipo !== 'persona' || (p.actor.rol !== 'aylu' && p.actor.rol !== 'tomas')) return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'los vínculos los confirman Aylu o Tomás' }
  const vinculo = p.actor.rol
  const a = columnasActor(p.actor)
  await asegurarTablas()
  return consulta('confirmar vínculo', async q => {
    const filas = await q`WITH c AS (
        UPDATE cj_grab_carpetas SET id_crm = ${id}, vinculo = ${vinculo}, actualizado_por = ${nombreActor(p.actor)}
        WHERE drive_id = ${p.drive_id} RETURNING *
      ), hijas AS (
        UPDATE cj_grab_carpetas h SET id_crm = ${id}, vinculo = ${vinculo}
        WHERE h.drive_id <> ${p.drive_id} AND (h.padre_id = ${p.drive_id}
          OR h.raiz_id IN (SELECT r.drive_id FROM cj_grab_carpetas r WHERE r.padre_id = ${p.drive_id}))
        RETURNING h.drive_id
      ), viejos AS (
        SELECT f.id, f.tipo, f.nombre, f.video_id, f.tanda_id FROM cj_grab_archivos f
        WHERE f.carpeta_id IN (SELECT drive_id FROM hijas) AND f.id_crm <> ${id}
      ), a AS (
        UPDATE cj_grab_archivos f SET id_crm = ${id}, video_id = NULL, asignado_por = NULL, propuesta_video_id = NULL, tanda_id = NULL,
          modificado_drive = NULL
        WHERE f.id IN (SELECT id FROM viejos) RETURNING f.id
      ), pares AS (
        SELECT DISTINCT v.id AS video_id, v.id_crm, x.id AS archivo_id, x.nombre, x.tipo,
          (v.editado_archivo_id = x.id) AS era_editado, (x.tipo = 'crudo' AND x.video_id = v.id) AS era_crudo
        FROM viejos x JOIN cj_videos v ON (v.id = x.video_id OR v.editado_archivo_id = x.id) AND v.id_crm <> ${id}
      ), vids AS (
        UPDATE cj_videos v SET
          editado_archivo_id = CASE WHEN p.editado THEN NULL ELSE v.editado_archivo_id END,
          editado_url = CASE WHEN p.editado THEN NULL ELSE v.editado_url END,
          bloqueo = CASE WHEN p.crudo AND v.bloqueo IS NULL AND v.estado NOT IN ('aprobado', 'descartado') THEN 'crudo_borrado' ELSE v.bloqueo END,
          motivo_bloqueo = CASE WHEN p.crudo AND v.bloqueo IS NULL AND v.estado NOT IN ('aprobado', 'descartado') THEN ${MOTIVO_VINCULO_CORREGIDO}::text ELSE v.motivo_bloqueo END,
          version = v.version + 1, actualizado = now()
        FROM (SELECT video_id, bool_or(era_editado) AS editado, bool_or(era_crudo) AS crudo FROM pares GROUP BY video_id) p
        WHERE v.id = p.video_id
        RETURNING v.id
      ), ev AS (
        INSERT INTO cj_video_eventos (video_id, id_crm, tipo, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
        SELECT p.video_id, p.id_crm, CASE WHEN p.tipo = 'editado' THEN 'editado_vinculado' ELSE 'crudo_vinculado' END,
          ${a.tipo}::text, ${a.rol}::text, ${a.nombre}::text, ${a.email}::text, 'la carpeta se corrigió a otro cliente',
          jsonb_build_object('archivo_id', p.archivo_id, 'nombre', p.nombre, 'desvinculado', true, 'cliente_nuevo', ${id}::text)
        FROM pares p
        RETURNING id
      ), t AS (
        UPDATE cj_grab_tandas t SET estado = 'avisada', version = t.version + 1, actualizado = now()
        WHERE t.id IN (SELECT tanda_id FROM viejos WHERE tanda_id IS NOT NULL) AND t.estado IN ('abierta', 'cerrada')
          AND NOT EXISTS (SELECT 1 FROM cj_grab_archivos o WHERE o.tanda_id = t.id AND o.id NOT IN (SELECT id FROM viejos))
        RETURNING t.id
      )
      SELECT row_to_json(c) AS carpeta, (SELECT count(*) FROM hijas) AS hijas, (SELECT count(*) FROM viejos) AS archivos,
        (SELECT count(*) FROM vids) AS videos FROM c`
    const f = (filas as Fila[])[0]
    return f ? { ok: true, actual: aCarpeta(f.carpeta as Fila) } : { ok: false, motivo: 'no_existe', actual: null }
  })
}

/** Carpetas de cliente: primero las por confirmar, después las que vinculó el bot (para revisar) y las confirmadas (para
 *  corregir un vínculo equivocado sin tocar la base). */
export async function listarVinculos(excluidos: readonly string[] = []): Promise<CarpetaGrabacion[]> {
  const filas = await leer('listar vínculos', [] as Fila[], q => q`SELECT * FROM cj_grab_carpetas
    WHERE tipo = 'cliente' AND borrada IS NULL
      AND (id_crm IS NULL OR NOT (upper(id_crm) = ANY(${[...excluidos]}::text[])))
    ORDER BY CASE vinculo WHEN 'a_confirmar' THEN 0 WHEN 'bot' THEN 1 ELSE 2 END, nombre LIMIT 500` as Promise<Fila[]>)
  return filas.map(aCarpeta)
}

export async function carpetasDeCliente(id_crm: IdCrm): Promise<CarpetaGrabacion[]> {
  const id = idCrm(id_crm)
  const filas = await leer('carpetas del cliente', [] as Fila[], q => q`SELECT * FROM cj_grab_carpetas WHERE id_crm = ${id} AND borrada IS NULL ORDER BY nivel, nombre LIMIT 500` as Promise<Fila[]>)
  return filas.map(aCarpeta)
}

export async function todasLasCarpetas(): Promise<CarpetaGrabacion[]> {
  const filas = await leer('todas las carpetas', [] as Fila[], q => q`SELECT * FROM cj_grab_carpetas WHERE borrada IS NULL ORDER BY nivel, drive_id LIMIT 20000` as Promise<Fila[]>)
  return filas.map(aCarpeta)
}

/**
 * Recalcula `vigilar`: las raíces de Crudos y Editados de los clientes activos con vínculo que procesa, las subcarpetas con
 * actividad en DIAS_SUBCARPETA_VIGILADA días y TODO el árbol de Crudos de los clientes con videos esperando crudos o para
 * regrabar (Aylu arma "Tanda N/Video N" de antemano y la fecha de un archivo nuevo no sube a las carpetas padre).
 */
// COALESCE(…, false): con id_crm o raiz NULL (carpetas de cliente sin vincular) la expresión da NULL y vigilar es NOT NULL
// (26/10/2026: la primera pasada completa en sombra cortaba ahí).
export async function ajustarVigilancia(activos: IdCrm[], conEspera: IdCrm[], ahora: Date): Promise<number> {
  await asegurarTablas()
  const desde = new Date(ahora.getTime() - DIAS_SUBCARPETA_VIGILADA * 86_400_000).toISOString()
  const a = activos.map(x => x.toUpperCase()), e = conEspera.map(x => x.toUpperCase())
  const filas = await consulta('ajustar vigilancia', q => q`UPDATE cj_grab_carpetas c SET vigilar = v.nuevo
    FROM (SELECT drive_id, COALESCE((id_crm = ANY(${a}::text[]) AND borrada IS NULL AND vinculo IN ('alta', 'aylu', 'tomas', 'bot')
            AND raiz IN ('crudos', 'editados')
            AND (tipo IN ('crudos', 'editados') OR (raiz = 'crudos' AND id_crm = ANY(${e}::text[]))
                 OR COALESCE(ultimo_archivo, creada) >= ${desde}::timestamptz)), false) AS nuevo
          FROM cj_grab_carpetas) v
    WHERE c.drive_id = v.drive_id AND c.vigilar IS DISTINCT FROM v.nuevo
    RETURNING c.drive_id` as Promise<Fila[]>)
  return filas.length
}

/** Prende la vigilancia de todo el árbol de Crudos de un cliente (al crear videos que esperan crudos). */
export async function vigilarCrudosDe(id_crm: IdCrm): Promise<void> {
  const id = idCrm(id_crm)
  await asegurarTablas()
  await consulta('vigilar crudos', q => q`UPDATE cj_grab_carpetas SET vigilar = true
    WHERE id_crm = ${id} AND raiz = 'crudos' AND borrada IS NULL AND NOT vigilar AND vinculo IN ('alta', 'aylu', 'tomas', 'bot')`)
}

/** Carpetas de cliente "a_confirmar" que todavía no se avisaron; las marca avisadas (aviso vinculo_pendiente, una vez). */
export async function vinculosSinAviso(): Promise<CarpetaGrabacion[]> {
  await asegurarTablas()
  const filas = await consulta('vínculos sin aviso', q => q`UPDATE cj_grab_carpetas SET avisado_vinculo = now()
    WHERE tipo = 'cliente' AND vinculo = 'a_confirmar' AND avisado_vinculo IS NULL AND borrada IS NULL
    RETURNING *` as Promise<Fila[]>)
  return filas.map(aCarpeta)
}

/** Marca borradas las carpetas que la pasada completa ya no vio (solo con el listado entero de esa raíz). */
export async function marcarCarpetasBorradas(raiz_id: string, presentes: string[]): Promise<number> {
  await asegurarTablas()
  const filas = await consulta('carpetas borradas', q => q`UPDATE cj_grab_carpetas SET borrada = now(), vigilar = false
    WHERE raiz_id = ${raiz_id} AND drive_id <> ${raiz_id} AND borrada IS NULL AND NOT (drive_id = ANY(${presentes}::text[])) RETURNING drive_id` as Promise<Fila[]>)
  return filas.length
}
