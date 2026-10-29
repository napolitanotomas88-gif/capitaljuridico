// ── Escalones de e01 (Neon: cj_grab_seguimientos) ─────────────────────────────────────────────────────────────────
// Un ciclo por cliente (fecha de inicio = `ciclo`), un paso por escalón (UNIQUE id_crm, ciclo, escalon). Los pasos los
// calcula calcularE01 (lib/bot/grabacion/seguimiento.ts, puro) y se crean con ON CONFLICT DO NOTHING (el diario puede
// correr dos veces). El texto del paso queda vacío hasta que Aylu marca "hecho" (la vista lo arma con textoE01 al mostrarlo).
//   · marcarPaso: "hecho" con nota (y el texto que se copió), con versión;
//   · decidirPaso: solo Tomás. "pausar" pausa EN LA MISMA SENTENCIA los videos del ciclo que siguen esperando crudos y
//     cancela el ciclo; "seguir" deja la decisión (y su hora: desde ahí cuentan los recordatorios cada 4 días hábiles).
import type { Actor, EventoVideo, IdCrm, PasoSeguimiento, Persona, ResultadoEscritura } from '../tipos'
import { ErrorEntradaEdicion, asegurarTablas, consulta, idCrm, idPositivo, leer, type Fila } from './base'
import { aEvento, aPaso, columnasActor } from './filas'

/** `hecho` solo viene cuando el paso nace hecho: el día 0 de un ciclo que abrió un envío con constancia de Aylu. */
export type PasoNuevo = Omit<PasoSeguimiento, 'id' | 'version' | 'hecho' | 'decision' | 'estado'> & { hecho?: PasoSeguimiento['hecho'] }

export async function pasosAbiertos(excluidos: readonly string[] = []): Promise<PasoSeguimiento[]> {
  const filas = await leer('pasos abiertos', [] as Fila[], q => q`SELECT * FROM cj_grab_seguimientos WHERE estado = 'abierto' AND NOT (upper(id_crm) = ANY(${[...excluidos]}::text[])) ORDER BY debido, id_crm, id LIMIT 2000` as Promise<Fila[]>)
  return filas.map(aPaso)
}

/** Lo que muestra /clientes/edicion/pendientes: los pasos de los ciclos abiertos. */
export const listarPendientesE01 = pasosAbiertos

export async function crearPasos(xs: PasoNuevo[]): Promise<PasoSeguimiento[]> {
  if (!xs.length) return []
  await asegurarTablas()
  const lote = xs.map(p => ({
    id_crm: p.id_crm.toUpperCase(), cliente: p.cliente.slice(0, 200), ciclo: p.ciclo, motivo: p.motivo, escalon: p.escalon, debido: p.debido,
    dias_habiles: p.dias_habiles, videos: p.videos, responsable: p.responsable, texto: p.texto ?? '', frenado: p.frenado ?? null,
    hecho: p.hecho ? { quien: p.hecho.quien.slice(0, 120), cuando: p.hecho.cuando, nota: p.hecho.nota.slice(0, 1_000) } : null,
  }))
  const filas = await consulta('crear pasos', q => q`INSERT INTO cj_grab_seguimientos (id_crm, cliente, ciclo, motivo, escalon, debido, dias_habiles, videos, responsable, texto, frenado, hecho)
    SELECT x.id_crm, x.cliente, x.ciclo, x.motivo, x.escalon, x.debido, x.dias_habiles,
      ARRAY(SELECT jsonb_array_elements_text(x.videos))::bigint[], x.responsable, x.texto, x.frenado, x.hecho
    FROM jsonb_to_recordset(${JSON.stringify(lote)}::jsonb) AS x(id_crm text, cliente text, ciclo date, motivo text, escalon text, debido date,
      dias_habiles int, videos jsonb, responsable text, texto text, frenado text, hecho jsonb)
    ON CONFLICT (id_crm, ciclo, escalon) DO NOTHING
    RETURNING *` as Promise<Fila[]>)
  return filas.map(aPaso)
}

/** Actualiza los videos y el freno de un paso abierto sin hacer (el ciclo sumó videos o se destrabó). */
export async function actualizarPaso(id: number, c: { videos: number[]; frenado: PasoSeguimiento['frenado'] | null }): Promise<void> {
  await asegurarTablas()
  await consulta('actualizar paso', q => q`UPDATE cj_grab_seguimientos SET videos = ${c.videos}::bigint[], frenado = ${c.frenado ?? null},
      version = version + 1, actualizado = now()
    WHERE id = ${idPositivo(id, 'paso_id')} AND estado = 'abierto' AND hecho IS NULL
      AND (videos IS DISTINCT FROM ${c.videos}::bigint[] OR frenado IS DISTINCT FROM ${c.frenado ?? null})`)
}

async function pasoSinEscribir(id: number): Promise<ResultadoEscritura<PasoSeguimiento>> {
  const [f] = await leer('leer paso', [] as Fila[], q => q`SELECT * FROM cj_grab_seguimientos WHERE id = ${id}` as Promise<Fila[]>)
  return f ? { ok: false, motivo: 'conflicto', actual: aPaso(f) } : { ok: false, motivo: 'no_existe', actual: null }
}

export async function marcarPaso(p: { id: number; version: number; actor: Persona | Actor; nota: string; texto: string }): Promise<ResultadoEscritura<PasoSeguimiento>> {
  const id = idPositivo(p.id, 'paso_id')
  const actor: Actor = 'tipo' in p.actor ? p.actor : { tipo: 'persona', ...p.actor }
  if (actor.tipo !== 'persona' || actor.rol === 'rene') return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'los pasos los marcan Aylu o Tomás' }
  const nota = (p.nota ?? '').trim().slice(0, 1_000), texto = (p.texto ?? '').slice(0, 4_000)
  const hecho = JSON.stringify({ quien: actor.nombre, cuando: new Date().toISOString(), nota })
  await asegurarTablas()
  const [f] = await consulta('marcar paso', q => q`UPDATE cj_grab_seguimientos SET hecho = ${hecho}::jsonb, texto = ${texto}, version = version + 1, actualizado = now()
    WHERE id = ${id} AND version = ${p.version} AND estado = 'abierto' AND hecho IS NULL RETURNING *` as Promise<Fila[]>)
  return f ? { ok: true, actual: aPaso(f) } : pasoSinEscribir(id)
}

export async function decidirPaso(p: { id: number; version: number; actor: Persona | Actor; decision: 'pausar' | 'seguir' }): Promise<ResultadoEscritura<{ paso: PasoSeguimiento; eventos: EventoVideo[] }>> {
  const id = idPositivo(p.id, 'paso_id')
  if (p.decision !== 'pausar' && p.decision !== 'seguir') throw new ErrorEntradaEdicion('decision', 'decisión inválida')
  const actor: Actor = 'tipo' in p.actor ? p.actor : { tipo: 'persona', ...p.actor }
  if (actor.tipo !== 'persona' || actor.rol !== 'tomas') return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'la pausa la decide Tomás' }
  const a = columnasActor(actor)
  const decidido = JSON.stringify({ quien: actor.nombre, cuando: new Date().toISOString() })
  const pausar = p.decision === 'pausar'
  await asegurarTablas()
  return consulta('decidir paso', async q => {
    const filas = await q`WITH s AS (
        UPDATE cj_grab_seguimientos SET decision = ${p.decision}, decidido = ${decidido}::jsonb, version = version + 1, actualizado = now()
        WHERE id = ${id} AND version = ${p.version} AND estado = 'abierto' AND decision IS NULL AND escalon = 'dia9'
        RETURNING *
      ), v AS (
        UPDATE cj_videos SET estado = 'pausado', estado_previo = 'esperando_crudos', estado_desde = now(), version = version + 1, actualizado = now()
        WHERE ${pausar}::boolean AND estado = 'esperando_crudos' AND id = ANY(SELECT unnest(videos) FROM s) AND id_crm IN (SELECT id_crm FROM s)
        RETURNING *
      ), e AS (
        INSERT INTO cj_video_eventos (video_id, id_crm, tipo, de, a, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
        SELECT v.id, v.id_crm, 'estado', 'esperando_crudos', 'pausado', ${a.tipo}, ${a.rol}, ${a.nombre}, ${a.email},
          'pausa decidida en el seguimiento (día 9)', jsonb_build_object('accion', 'pausar', 'paso_id', ${id}::bigint)
        FROM v RETURNING *
      ), c AS (
        UPDATE cj_grab_seguimientos SET estado = 'cancelado', version = version + 1, actualizado = now()
        WHERE ${pausar}::boolean AND estado = 'abierto' AND (id_crm, ciclo) IN (SELECT id_crm, ciclo FROM s) AND id <> ${id}
        RETURNING id
      )
      SELECT row_to_json(s) AS paso, (SELECT coalesce(json_agg(e), '[]'::json) FROM e) AS eventos,
        (SELECT coalesce(json_agg(json_build_object('id', v.id, 'cliente', v.cliente)), '[]'::json) FROM v) AS videos
      FROM s`
    const f = (filas as Fila[])[0]
    if (!f) {
      const r = await pasoSinEscribir(id)
      if (r.ok || !r.actual) return { ok: false, motivo: 'no_existe', actual: null }
      const ya = r.actual
      return { ok: false, motivo: ya.decision || ya.estado !== 'abierto' || ya.escalon !== 'dia9' ? 'no_permitido' : 'conflicto', actual: null,
        detalle: `el paso está ${ya.estado}${ya.decision ? ` (ya se decidió: ${ya.decision})` : ''}${ya.escalon !== 'dia9' ? ' (la pausa se decide en el día 9)' : ''}` }
    }
    const clientes = new Map((f.videos as Fila[]).map(x => [Number(x.id), String(x.cliente ?? '')]))
    let paso = aPaso(f.paso as Fila)
    if (pausar) {
      // El paso de la decisión también queda cancelado (el ciclo terminó con la pausa)
      const [g] = await q`UPDATE cj_grab_seguimientos SET estado = 'cancelado', version = version + 1, actualizado = now() WHERE id = ${id} RETURNING *` as Fila[]
      if (g) paso = aPaso(g)
    }
    const eventos = (f.eventos as Fila[]).map(e => { const ev = aEvento(e); return { ...ev, cliente: clientes.get(ev.video_id) ?? '' } })
    return { ok: true, actual: { paso, eventos } }
  })
}

export async function cerrarCiclo(id_crm: IdCrm, ciclo: string, estado: 'resuelto' | 'cancelado'): Promise<number> {
  const id = idCrm(id_crm)
  await asegurarTablas()
  const filas = await consulta('cerrar ciclo', q => q`UPDATE cj_grab_seguimientos SET estado = ${estado}, version = version + 1, actualizado = now()
    WHERE id_crm = ${id} AND ciclo = ${ciclo}::date AND estado = 'abierto' RETURNING id` as Promise<Fila[]>)
  return filas.length
}

/** Hora de la decisión "seguir" de cada ciclo abierto (para los recordatorios). */
export async function decisionesSeguir(): Promise<Map<string, string>> {
  const filas = await leer('decisiones', [] as Fila[], q => q`SELECT id_crm, ciclo, decidido ->> 'cuando' AS cuando FROM cj_grab_seguimientos
    WHERE estado = 'abierto' AND decision = 'seguir'` as Promise<Fila[]>)
  return new Map(filas.map(f => [`${String(f.id_crm)}|${f.ciclo instanceof Date ? f.ciclo.toISOString().slice(0, 10) : String(f.ciclo).slice(0, 10)}`, String(f.cuando ?? '')]))
}

// ── e01 por WhatsApp (lib/bot/grabacion/e01Whatsapp.ts): el bot reclama el paso, manda y confirma ─────────────────────
// Reclamar = marcarlo hecho a nombre del bot con la nota «enviando…» (condicionado a la versión y a que nadie lo marcó):
// así dos corridas no mandan dos veces. Si el envío falla, se suelta (hecho NULL) y el texto guardado dice que no salió,
// para que Aylu lo mande a mano (el bot no lo reintenta). Si el proceso se corta entre reclamar y confirmar, queda la nota
// «enviando…»: Aylu lo ve en Grabaciones pendientes y revisa el grupo.
export const QUIEN_BOT_WHATSAPP = 'Bot (WhatsApp)'
export const NOTA_ENVIANDO = 'enviando por WhatsApp…'
export const PREFIJO_NO_SALIO = 'No salió por WhatsApp'

export async function reclamarPasoBot(id: number, version: number, texto: string): Promise<boolean> {
  const k = idPositivo(id, 'paso_id')
  const hecho = JSON.stringify({ quien: QUIEN_BOT_WHATSAPP, cuando: new Date().toISOString(), nota: NOTA_ENVIANDO })
  await asegurarTablas()
  const filas = await consulta('reclamar paso (whatsapp)', q => q`UPDATE cj_grab_seguimientos SET hecho = ${hecho}::jsonb, texto = ${texto.slice(0, 4_000)},
      version = version + 1, actualizado = now()
    WHERE id = ${k} AND version = ${version} AND estado = 'abierto' AND hecho IS NULL RETURNING id` as Promise<Fila[]>)
  return filas.length > 0
}

export async function confirmarPasoBot(id: number, nota: string): Promise<void> {
  const k = idPositivo(id, 'paso_id')
  await consulta('confirmar paso (whatsapp)', q => q`UPDATE cj_grab_seguimientos SET hecho = jsonb_set(hecho, '{nota}', to_jsonb(${nota.slice(0, 1_000)}::text)),
      version = version + 1, actualizado = now()
    WHERE id = ${k} AND hecho->>'quien' = ${QUIEN_BOT_WHATSAPP} AND hecho->>'nota' = ${NOTA_ENVIANDO}`)
}

export async function soltarPasoBot(id: number, motivo: string): Promise<void> {
  const k = idPositivo(id, 'paso_id')
  await consulta('soltar paso (whatsapp)', q => q`UPDATE cj_grab_seguimientos SET hecho = NULL, texto = ${`${PREFIJO_NO_SALIO}: ${motivo}`.slice(0, 1_000)},
      version = version + 1, actualizado = now()
    WHERE id = ${k} AND hecho->>'quien' = ${QUIEN_BOT_WHATSAPP} AND hecho->>'nota' = ${NOTA_ENVIANDO}`)
}

/** El bot no lo pudo mandar (sin grupo claro): queda sin hacer y con el motivo en el texto, para Aylu. No se reintenta. */
export async function anotarNoSalioBot(id: number, version: number, motivo: string): Promise<void> {
  const k = idPositivo(id, 'paso_id')
  await asegurarTablas()
  await consulta('anotar paso (whatsapp)', q => q`UPDATE cj_grab_seguimientos SET texto = ${`${PREFIJO_NO_SALIO}: ${motivo}`.slice(0, 1_000)},
      version = version + 1, actualizado = now()
    WHERE id = ${k} AND version = ${version} AND estado = 'abierto' AND hecho IS NULL`)
}

/** Pasos que el bot reclamó y no confirmó hace más de `minutos` (el proceso se cortó entre reclamar y confirmar). */
export async function pasosBotColgados(minutos: number): Promise<{ id: number; cliente: string }[]> {
  const filas = await leer('pasos colgados (whatsapp)', [] as Fila[], q => q`SELECT id, cliente FROM cj_grab_seguimientos
    WHERE hecho->>'quien' = ${QUIEN_BOT_WHATSAPP} AND hecho->>'nota' = ${NOTA_ENVIANDO}
      AND (hecho->>'cuando')::timestamptz < now() - make_interval(mins => ${Math.max(1, Math.round(minutos))}::int)
    LIMIT 50` as Promise<Fila[]>)
  return filas.map(f => ({ id: Number(f.id), cliente: String(f.cliente ?? '') }))
}
