// ── Tandas de subida (Neon: cj_grab_tandas) ──────────────────────────────────────────────────────────────────────
// Una tanda = un lote de archivos de un cliente (crudos o editados) que se corta a los CIERRE_TANDA_MIN sin archivos nuevos.
//   · asignarATanda: recibe los archivos nuevos ya guardados, los agrupa por el hueco de 45 minutos (agrupar() de
//     lib/bot/grabacion/tandas.ts) y los suma a la tanda abierta o abre otra (una sola abierta por cliente y tipo: índice
//     parcial). Los contadores (archivos, desde, hasta, subio) se recalculan desde los archivos: es idempotente.
//   · tandasParaCerrar: abiertas con más de 45 minutos desde su último archivo Y con todas las carpetas vigiladas del
//     cliente consultadas después de `hasta` + 45 minutos (si no, el barrido rotativo trae tarde archivos de la misma subida
//     y saldría una segunda tanda con un segundo aviso). Pasadas 6 horas se cierra igual.
//   · reclamarComparacion: cerrada → comparando (o una "comparando" colgada de más de 10 minutos, o una comparada que dejó
//     guiones para Claude). tandasParaComparar también lista las colgadas; soltarComparacion devuelve a 'cerrada' la que
//     falló.
import type { ArchivoGrabacion, EstadoTanda, IdCrm, ResultadoComparacion, ResultadoEscritura, TandaSubida } from '../tipos'
import { CIERRE_TANDA_MIN, COMPARANDO_COLGADA_MIN, ESPERA_TRANSCRIPCION_MIN } from '../config'
import { agrupar } from '../../bot/grabacion/tandas'
import { asegurarTablas, consulta, idCrm, idPositivo, leer, type Fila, type Sql } from './base'
import { aTanda } from './filas'

const CIERRE_FORZADO_HORAS = 6

async function recalcular(q: Sql, id: number): Promise<TandaSubida | null> {
  const [f] = await q`UPDATE cj_grab_tandas t SET
      archivos = s.n, desde = COALESCE(s.desde, t.desde), hasta = COALESCE(s.hasta, t.hasta), subio = COALESCE(s.subio, t.subio),
      version = t.version + 1, actualizado = now()
    FROM (SELECT count(*) AS n, min(creado_drive) AS desde, max(creado_drive) AS hasta,
            CASE WHEN count(DISTINCT subio) = 1 THEN max(subio) WHEN count(*) = 0 THEN NULL ELSE 'mixto' END AS subio
          FROM cj_grab_archivos WHERE tanda_id = ${id} AND borrado IS NULL) s
    WHERE t.id = ${id} RETURNING t.*` as Fila[]
  return f ? aTanda(f) : null
}

export async function asignarATanda(id_crm: IdCrm, tipo: 'crudos' | 'editados', archivos: ArchivoGrabacion[], ahora: Date): Promise<TandaSubida> {
  const id = idCrm(id_crm)
  if (!archivos.length) throw new Error('asignarATanda sin archivos')
  await asegurarTablas()
  return consulta('asignar a tanda', async q => {
    const [abierta] = await q`SELECT * FROM cj_grab_tandas WHERE id_crm = ${id} AND tipo = ${tipo} AND estado = 'abierta'` as Fila[]
    const grupos = agrupar(archivos, abierta ? [aTanda(abierta)] : [], ahora)
    let ultima: TandaSubida | null = null
    for (const g of grupos) {
      let destino = g.tanda_id
      if (destino === null) {
        // Grupo nuevo: la abierta (si hay) ya quedó a más de 45 minutos, se cierra; después se abre otra
        await q`UPDATE cj_grab_tandas SET estado = 'cerrada', cerrada = now(), version = version + 1, actualizado = now()
          WHERE id_crm = ${id} AND tipo = ${tipo} AND estado = 'abierta' AND hasta < ${g.desde}::timestamptz`
        const nueva = await q`INSERT INTO cj_grab_tandas (id_crm, tipo, desde, hasta, archivos, subio)
          VALUES (${id}, ${tipo}, ${g.desde}::timestamptz, ${g.hasta}::timestamptz, 0, ${g.subio})
          ON CONFLICT (id_crm, tipo) WHERE estado = 'abierta' DO NOTHING RETURNING id` as Fila[]
        if (nueva[0]) destino = Number(nueva[0].id)
        else {
          const [otra] = await q`SELECT id FROM cj_grab_tandas WHERE id_crm = ${id} AND tipo = ${tipo} AND estado = 'abierta'` as Fila[]
          if (!otra) throw new Error('no se pudo abrir la tanda')
          destino = Number(otra.id)
        }
      }
      await q`UPDATE cj_grab_archivos SET tanda_id = ${destino} WHERE id = ANY(${g.archivos}::bigint[]) AND tanda_id IS NULL`
      ultima = await recalcular(q, destino)
    }
    if (!ultima) throw new Error('no quedó ninguna tanda')
    return ultima
  })
}

export async function tandasParaCerrar(ahora: Date, excluidos: readonly string[] = []): Promise<TandaSubida[]> {
  const limite = new Date(ahora.getTime() - CIERRE_TANDA_MIN * 60_000).toISOString()
  const forzado = new Date(ahora.getTime() - CIERRE_FORZADO_HORAS * 3_600_000).toISOString()
  const filas = await leer('tandas para cerrar', [] as Fila[], q => q`SELECT t.* FROM cj_grab_tandas t
    WHERE t.estado = 'abierta' AND t.hasta < ${limite}::timestamptz
      AND NOT (upper(t.id_crm) = ANY(${[...excluidos]}::text[]))
      AND (t.hasta < ${forzado}::timestamptz OR NOT EXISTS (
        SELECT 1 FROM cj_grab_carpetas c
        WHERE c.id_crm = t.id_crm AND c.vigilar AND c.borrada IS NULL
          AND c.raiz = CASE WHEN t.tipo = 'crudos' THEN 'crudos' ELSE 'editados' END
          AND (c.consultada IS NULL OR c.consultada < t.hasta + make_interval(mins => ${CIERRE_TANDA_MIN}::int))))
    ORDER BY t.hasta LIMIT 50` as Promise<Fila[]>)
  return filas.map(aTanda)
}

export async function cerrarTanda(id: number, version: number): Promise<ResultadoEscritura<TandaSubida>> {
  const tid = idPositivo(id, 'tanda_id')
  await asegurarTablas()
  return consulta('cerrar tanda', async q => {
    const [f] = await q`UPDATE cj_grab_tandas SET estado = 'cerrada', cerrada = now(), version = version + 1, actualizado = now()
      WHERE id = ${tid} AND version = ${version} AND estado = 'abierta' RETURNING *` as Fila[]
    if (f) return { ok: true, actual: aTanda(f) }
    const [ya] = await q`SELECT * FROM cj_grab_tandas WHERE id = ${tid}` as Fila[]
    return ya ? { ok: false, motivo: 'conflicto', actual: aTanda(ya) } : { ok: false, motivo: 'no_existe', actual: null }
  })
}

export async function reclamarComparacion(id: number, ahora: Date): Promise<TandaSubida | null> {
  const tid = idPositivo(id, 'tanda_id')
  const colgada = new Date(ahora.getTime() - COMPARANDO_COLGADA_MIN * 60_000).toISOString()
  await asegurarTablas()
  const [f] = await consulta('reclamar comparación', q => q`UPDATE cj_grab_tandas SET estado = 'comparando', comparando_desde = now(), version = version + 1, actualizado = now()
    WHERE id = ${tid} AND (estado = 'cerrada'
      OR (estado = 'comparando' AND (comparando_desde IS NULL OR comparando_desde < ${colgada}::timestamptz))
      OR (estado = 'comparada' AND jsonb_array_length(COALESCE(resultado -> 'pendiente_claude', '[]'::jsonb)) > 0))
    RETURNING *` as Promise<Fila[]>)
  return f ? aTanda(f) : null
}

/** Una comparación que falló vuelve a 'cerrada' para que la retome la próxima corrida. */
export async function soltarComparacion(id: number): Promise<void> {
  const tid = idPositivo(id, 'tanda_id')
  await asegurarTablas()
  await consulta('soltar comparación', q => q`UPDATE cj_grab_tandas SET estado = 'cerrada', comparando_desde = NULL, version = version + 1, actualizado = now()
    WHERE id = ${tid} AND estado = 'comparando'`)
}

export async function guardarResultado(id: number, r: ResultadoComparacion): Promise<void> {
  const tid = idPositivo(id, 'tanda_id')
  await asegurarTablas()
  await consulta('guardar comparación', q => q`UPDATE cj_grab_tandas SET estado = 'comparada', resultado = ${JSON.stringify(r)}::jsonb,
      version_comparacion = ${r.version}, tokens_in = ${r.tokens?.in ?? null}, tokens_out = ${r.tokens?.out ?? null}, version = version + 1, actualizado = now()
    WHERE id = ${tid} AND estado = 'comparando'`)
}

export async function marcarAvisada(id: number): Promise<void> {
  const tid = idPositivo(id, 'tanda_id')
  await asegurarTablas()
  await consulta('marcar tanda avisada', q => q`UPDATE cj_grab_tandas SET estado = 'avisada', version = version + 1, actualizado = now()
    WHERE id = ${tid} AND estado IN ('cerrada', 'comparando', 'comparada')`)
}

export async function listarTandas(f: { id_crm?: IdCrm; estados?: EstadoTanda[]; desde?: string }): Promise<TandaSubida[]> {
  const id = f.id_crm ? idCrm(f.id_crm) : null
  const estados = f.estados?.length ? f.estados : null
  const desde = f.desde ?? null
  const filas = await leer('listar tandas', [] as Fila[], q => q`SELECT * FROM cj_grab_tandas
    WHERE (${id}::text IS NULL OR id_crm = ${id}) AND (${estados}::text[] IS NULL OR estado = ANY(${estados}::text[]))
      AND (${desde}::timestamptz IS NULL OR hasta >= ${desde}::timestamptz)
    ORDER BY hasta DESC LIMIT 200` as Promise<Fila[]>)
  return filas.map(aTanda)
}

/**
 * Tandas de crudos cerradas listas para comparar: todas sus transcripciones terminaron (ninguna pendiente, enviando o
 * enviada) o se cerraron hace más de ESPERA_TRANSCRIPCION_MIN; las comparadas que dejaron guiones para Claude; y las que
 * quedaron 'comparando' más de COMPARANDO_COLGADA_MIN (la función se cortó a mitad: reclamarComparacion las vuelve a tomar).
 */
export async function tandasParaComparar(ahora: Date, excluidos: readonly string[] = []): Promise<TandaSubida[]> {
  const espera = new Date(ahora.getTime() - ESPERA_TRANSCRIPCION_MIN * 60_000).toISOString()
  const colgada = new Date(ahora.getTime() - COMPARANDO_COLGADA_MIN * 60_000).toISOString()
  const filas = await leer('tandas para comparar', [] as Fila[], q => q`SELECT t.* FROM cj_grab_tandas t
    WHERE NOT (upper(t.id_crm) = ANY(${[...excluidos]}::text[])) AND t.tipo = 'crudos' AND (
      (t.estado = 'cerrada' AND (t.cerrada < ${espera}::timestamptz OR NOT EXISTS (
        SELECT 1 FROM cj_grab_archivos a WHERE a.tanda_id = t.id AND a.borrado IS NULL AND a.tr_estado IN ('pendiente', 'enviando', 'enviada'))))
      OR (t.estado = 'comparada' AND jsonb_array_length(COALESCE(t.resultado -> 'pendiente_claude', '[]'::jsonb)) > 0)
      OR (t.estado = 'comparando' AND (t.comparando_desde IS NULL OR t.comparando_desde < ${colgada}::timestamptz)))
    ORDER BY t.cerrada NULLS LAST LIMIT 20` as Promise<Fila[]>)
  return filas.map(aTanda)
}

/** Tandas de editados cerradas (sin comparación): se marcan avisadas después de proponer los vínculos. */
export async function tandasEditadosCerradas(excluidos: readonly string[] = []): Promise<TandaSubida[]> {
  const filas = await leer('tandas de editados', [] as Fila[], q => q`SELECT * FROM cj_grab_tandas WHERE tipo = 'editados' AND estado = 'cerrada' AND NOT (upper(id_crm) = ANY(${[...excluidos]}::text[])) ORDER BY cerrada LIMIT 50` as Promise<Fila[]>)
  return filas.map(aTanda)
}

export async function leerTanda(id: number): Promise<TandaSubida | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const [f] = await leer('leer tanda', [] as Fila[], q => q`SELECT * FROM cj_grab_tandas WHERE id = ${id}` as Promise<Fila[]>)
  return f ? aTanda(f) : null
}
