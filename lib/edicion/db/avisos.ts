// ── Cola de avisos de Discord: SQL sobre cj_edicion_avisos (la tabla la crea la migración de A) ────────────────────────
// Estados: pendiente → enviando → enviado | dry | error | dudoso | descartado.
//   · encolar(): un aviso AGRUPADO usa `base` (por ejemplo rene_cola:A157): si ya hay uno pendiente con esa base, se
//     mezclan los datos y se corre enviar_despues, en UNA sentencia (INSERT … ON CONFLICT (base) WHERE estado =
//     'pendiente' DO UPDATE, sobre el índice único parcial): dos encolados a la vez no se pisan. enviar_despues nunca pasa
//     de creado + 2 h (si no, eventos cada 25 minutos lo postergarían para siempre). `clave` queda NULL.
//     Un aviso DE UNA VEZ (unaVez) usa clave = base e INSERT … ON CONFLICT DO NOTHING: nunca sale dos veces.
//   · reclamarVencidos(): pendiente → enviando, con FOR UPDATE SKIP LOCKED (dos despachos a la vez no toman el mismo).
//     Al reclamar se anota la hora en `enviado` (es la hora en que se tomó; al cerrar se pisa con la del envío).
//   · marcarDudosos(): un aviso en `enviando` hace más de 10 minutos pasa a `dudoso` y NO se reintenta solo: un timeout de
//     Discord pudo haberlo publicado igual. Se ve en /clientes/edicion/avisos.
//   · reprogramar(): un error pasajero (5xx, 429 sin tiempo) vuelve a pendiente; si mientras tanto se encoló otro con la
//     misma base, se le mezclan los datos a ese y este queda descartado.
// Los datos se mezclan así: claves nuevas pisan a las viejas, salvo las listas `videos` y `archivos`, que se juntan sin
// repetir. El texto se arma al despachar (cola.ts), con lo que hay en ese momento en la base.
// Ningún dato personal va acá: los datos son ids, claves de video y nombres de cliente; la URL del webhook nunca.
import type { Aviso, CanalAviso, EstadoAviso, Iso } from '../tipos'
import { asegurarTablas, consulta, entero, iso, isoONull, json, leer, lista, txt, txtONull, type Fila } from './base'

export const TOPE_POSTERGAR_MS = 2 * 60 * 60_000
export const DUDOSO_MIN = 10
export const LARGO_BASE = 200

export function aAviso(f: Fila): Aviso {
  return {
    id: entero(f.id), clave: txt(f.clave), base: txt(f.base), tipo: txt(f.tipo), canal: (txt(f.canal) || 'edicion') as CanalAviso,
    datos: json(f.datos, {}), texto: txtONull(f.texto), menciones: lista(f.menciones), estado: (txt(f.estado) || 'pendiente') as EstadoAviso,
    enviar_despues: iso(f.enviar_despues), mensaje_id: txtONull(f.mensaje_id), intentos: entero(f.intentos), error: txt(f.error),
    creado: iso(f.creado), enviado: isoONull(f.enviado),
  }
}

export interface NuevoAviso { base: string; tipo: string; canal: CanalAviso; datos: Record<string, unknown>; enviar_despues: Iso; unaVez?: boolean }

const baseValida = (b: string): string => {
  const t = String(b ?? '').trim()
  if (!t || t.length > LARGO_BASE || /\s/.test(t)) throw new Error(`base de aviso inválida: ${JSON.stringify(t.slice(0, 40))}`)
  return t
}

/** Encola (o mezcla con el pendiente de la misma base). Devuelve el aviso como quedó (el existente, si era de una vez y ya estaba). */
export async function encolar(a: NuevoAviso): Promise<Aviso> {
  const base = baseValida(a.base)
  const datos = JSON.stringify(a.datos ?? {})
  const cuando = new Date(a.enviar_despues).toISOString()
  await asegurarTablas()
  return consulta('encolar aviso', async q => {
    if (a.unaVez) {
      const filas = await q`INSERT INTO cj_edicion_avisos (clave, base, tipo, canal, datos, estado, enviar_despues)
        VALUES (${base}, ${base}, ${a.tipo}, ${a.canal}, ${datos}::jsonb, 'pendiente', ${cuando}::timestamptz)
        ON CONFLICT DO NOTHING RETURNING *` as Fila[]
      if (filas[0]) return aAviso(filas[0])
      const [ya] = await q`SELECT * FROM cj_edicion_avisos WHERE clave = ${base} OR (base = ${base} AND estado = 'pendiente') ORDER BY id DESC LIMIT 1` as Fila[]
      return aAviso(ya ?? { base, tipo: a.tipo, canal: a.canal, datos: a.datos, estado: 'descartado', enviar_despues: cuando })
    }
    const [f] = await q`INSERT INTO cj_edicion_avisos (base, tipo, canal, datos, estado, enviar_despues)
      VALUES (${base}, ${a.tipo}, ${a.canal}, ${datos}::jsonb, 'pendiente', ${cuando}::timestamptz)
      ON CONFLICT (base) WHERE estado = 'pendiente' DO UPDATE SET
        datos = cj_edicion_avisos.datos || EXCLUDED.datos
          || jsonb_build_object('videos', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(
               coalesce(cj_edicion_avisos.datos -> 'videos', '[]'::jsonb) || coalesce(EXCLUDED.datos -> 'videos', '[]'::jsonb)) x))
          || jsonb_build_object('archivos', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(
               coalesce(cj_edicion_avisos.datos -> 'archivos', '[]'::jsonb) || coalesce(EXCLUDED.datos -> 'archivos', '[]'::jsonb)) x)),
        enviar_despues = LEAST(EXCLUDED.enviar_despues, cj_edicion_avisos.creado + interval '2 hours')
      RETURNING *` as Fila[]
    return aAviso(f)
  })
}

/** Toma hasta `limite` avisos vencidos (pendiente → enviando). */
export async function reclamarVencidos(ahora: Iso, limite: number): Promise<Aviso[]> {
  const n = Math.max(1, Math.min(50, Math.floor(limite)))
  return leer('reclamar avisos', [] as Aviso[], async q => {
    const filas = await q`UPDATE cj_edicion_avisos SET estado = 'enviando', intentos = intentos + 1, enviado = now()
      WHERE id IN (
        SELECT id FROM cj_edicion_avisos WHERE estado = 'pendiente' AND enviar_despues <= ${ahora}::timestamptz
        ORDER BY enviar_despues, id LIMIT ${n} FOR UPDATE SKIP LOCKED
      ) AND estado = 'pendiente'
      RETURNING *` as Fila[]
    return filas.map(aAviso).sort((a, b) => a.enviar_despues.localeCompare(b.enviar_despues) || a.id - b.id)
  })
}

/** Cierra un aviso tomado: enviado, dry, error, dudoso o descartado (solo si sigue `enviando`). */
export async function cerrarAviso(id: number, r: { estado: EstadoAviso; texto: string; menciones: string[]; mensaje_id?: string; error?: string }): Promise<void> {
  await consulta('cerrar aviso', async q => {
    await q`UPDATE cj_edicion_avisos SET estado = ${r.estado}, texto = ${r.texto}, menciones = ${r.menciones}::text[],
        mensaje_id = ${r.mensaje_id ?? null}, error = ${(r.error ?? '').slice(0, 500)},
        enviado = CASE WHEN ${r.estado} IN ('enviado', 'dry') THEN now() ELSE enviado END
      WHERE id = ${id} AND estado = 'enviando'`
  })
}

/** Un error pasajero: vuelve a pendiente para más tarde (o se mezcla con el pendiente nuevo de la misma base). */
export async function reprogramar(a: Pick<Aviso, 'id' | 'base' | 'datos'>, enviar_despues: Iso, error: string): Promise<'pendiente' | 'mezclado'> {
  return consulta('reprogramar aviso', async q => {
    const filas = await q`UPDATE cj_edicion_avisos SET estado = 'pendiente', enviar_despues = ${enviar_despues}::timestamptz, error = ${error.slice(0, 500)}
      WHERE id = ${a.id} AND estado = 'enviando'
        AND NOT EXISTS (SELECT 1 FROM cj_edicion_avisos o WHERE o.base = ${a.base} AND o.estado = 'pendiente' AND o.id <> ${a.id})
      RETURNING id` as Fila[]
    if (filas.length) return 'pendiente'
    // Igual que encolar(): las claves del pendiente (más nuevo) pisan, y las listas `videos` y `archivos` se juntan sin repetir
    // (revisión de la integración, ronda 3: con un `||` solo, los videos del aviso viejo se perdían)
    const viejos = JSON.stringify(a.datos ?? {})
    await q`UPDATE cj_edicion_avisos o SET datos = ${viejos}::jsonb || o.datos
        || jsonb_build_object('videos', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(
             coalesce(${viejos}::jsonb -> 'videos', '[]'::jsonb) || coalesce(o.datos -> 'videos', '[]'::jsonb)) x))
        || jsonb_build_object('archivos', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(
             coalesce(${viejos}::jsonb -> 'archivos', '[]'::jsonb) || coalesce(o.datos -> 'archivos', '[]'::jsonb)) x))
      WHERE o.base = ${a.base} AND o.estado = 'pendiente' AND o.id <> ${a.id}`
    await q`UPDATE cj_edicion_avisos SET estado = 'descartado', error = ${`se juntó con el aviso siguiente de la misma base (${error})`.slice(0, 500)}
      WHERE id = ${a.id} AND estado = 'enviando'`
    return 'mezclado'
  })
}

/** Los que quedaron `enviando` más de 10 minutos pasan a `dudoso` (no se reintentan solos). */
export async function marcarDudosos(ahora: Iso): Promise<Aviso[]> {
  return leer('avisos dudosos', [] as Aviso[], async q => ((await q`UPDATE cj_edicion_avisos SET estado = 'dudoso',
      error = 'quedó enviándose más de 10 minutos: puede haber salido igual; mirá el canal antes de reenviarlo'
    WHERE estado = 'enviando' AND enviado < ${ahora}::timestamptz - make_interval(mins => ${DUDOSO_MIN}::int)
    RETURNING *`) as Fila[]).map(aAviso))
}

export async function listarAvisos(f: { estados?: EstadoAviso[]; desde?: Iso; limite?: number }): Promise<Aviso[]> {
  const estados = f.estados?.length ? f.estados : null
  const desde = f.desde ? new Date(f.desde).toISOString() : null
  const n = Math.max(1, Math.min(500, Math.floor(f.limite ?? 100)))
  return leer('listar avisos', [] as Aviso[], async q => ((await q`SELECT * FROM cj_edicion_avisos
    WHERE (${estados}::text[] IS NULL OR estado = ANY(${estados}::text[])) AND (${desde}::timestamptz IS NULL OR creado >= ${desde}::timestamptz)
    ORDER BY id DESC LIMIT ${n}`) as Fila[]).map(aAviso))
}

/** ¿Ya salió (o está por salir) el aviso de una vez con esta clave? (el resumen diario lo usa para no armarlo de nuevo). */
export async function existeClave(clave: string): Promise<boolean> {
  return leer('aviso por clave', false, async q => ((await q`SELECT 1 FROM cj_edicion_avisos WHERE clave = ${clave} LIMIT 1`) as Fila[]).length > 0)
}
