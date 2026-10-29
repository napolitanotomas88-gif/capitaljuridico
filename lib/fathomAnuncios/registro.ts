// ── Registro de grabaciones procesadas (Neon, tabla cj_fathom_anuncios) ───────────────────────────
// Para qué: Fathom puede mandar la misma grabación más de una vez (reintentos, o si se reenvía a mano) y cada
// pasada cuesta una llamada a Claude y le escribe a Valentino. La fila por recording_id hace de candado y además
// guarda lo necesario para RETOMAR sin repetir:
//   · reclamar(): INSERT … ON CONFLICT DO NOTHING; si ya existía, solo se re-reclama si quedó en "error", si quedó
//     colgada en "procesando" más de 10 minutos (la función murió a mitad) o si se pide forzar; el cron además exige
//     intentos < tope. Si no → duplicada. Al reclamar se guarda el payload (la reunión ya validada) para poder
//     reintentar sin que Fathom la reenvíe; se borra (NULL) cuando la fila llega a un estado final.
//   · guardarExtraccion(): el resultado de Claude se guarda APENAS sale, antes de mandar nada: un reintento con la
//     misma versión del prompt lo reusa (no se vuelve a pagar Claude ni cambia lo que se manda).
//   · anotarEnviados(): después de cada cliente que salió entero, su clave va a clientes_enviados (y los ids de Discord
//     a mensajes): un reintento manda solo los clientes que faltan.
//   · marcar(): estado final o error. Lo que no se pasa queda como estaba (COALESCE); el error se pisa siempre.
// Cada consulta tiene un tope de TOPE_CONSULTA_MS (Promise.race + AbortSignal en el fetch de Neon): una base colgada no
// mata la invocación sin pasar por el manejo de errores. Sin conexión, 5xx o timeout → error transitorio.
// Misma base que Cuotas (DATABASE_URL). La tabla se crea sola la primera vez y las columnas nuevas se agregan con
// ADD COLUMN IF NOT EXISTS (una vez por proceso). Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { ErrorTransitorio } from './errores'
import type { EstadoRegistro } from './tipos'
import { TOPE_LECTURA_KICKOFF_MS, type ConsultaKickoff, type FilaKickoffLeida } from './kickoff'

export const baseConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()

export const TOPE_CONSULTA_MS = 10_000
export const MINUTOS_COLGADA = 10            // = el interval '10 minutes' de las consultas
export const ESTADOS_FINALES = ['enviado', 'sin_cambios', 'omitida'] as const

type Sql = NeonQueryFunction<false, false>

// Solo para tests: reemplaza el cliente de Neon por uno falso (null vuelve al real)
let fabricaSql: ((url: string) => Sql) | null = null
export function sqlParaPruebas(f: ((url: string) => Sql) | null): void { fabricaSql = f }

/** Corre una consulta con tope de tiempo. Sin conexión, 5xx de Neon o timeout → ErrorTransitorio (se puede reintentar). */
async function consulta<T>(que: string, fn: (q: Sql) => Promise<T>, topeMs = TOPE_CONSULTA_MS): Promise<T> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = fabricaSql ? fabricaSql(url) : neon(url, { fetchOptions: { signal: AbortSignal.timeout(topeMs) } })
  let t: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, rechazar) => {
    t = setTimeout(() => rechazar(new ErrorTransitorio(`la base no respondió en ${topeMs / 1000} s (${que})`)), topeMs)
  })
  try {
    return await Promise.race([fn(q), tope])
  } catch (e) {
    if (e instanceof ErrorTransitorio) throw e
    const m = (e as Error)?.message ?? ''
    if (/^Error connecting to database|^Server error \(HTTP status 5\d\d|TimeoutError|AbortError|aborted/i.test(m)) {
      throw new ErrorTransitorio(`la base no respondió (${que}): ${m.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 120)}`)
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

let tablaLista: Promise<void> | null = null
function asegurarTabla(): Promise<void> {
  tablaLista ??= consulta('crear tabla', async q => {
    await q`CREATE TABLE IF NOT EXISTS cj_fathom_anuncios (
      recording_id bigint PRIMARY KEY,
      estado text NOT NULL,
      titulo text,
      url text,
      intentos int NOT NULL DEFAULT 1,
      clientes int,
      cambios int,
      mensajes text[],
      resultado jsonb,
      error text,
      modelo text,
      version_prompt text,
      tokens_in int,
      tokens_out int,
      duracion_ms int,
      creado timestamptz NOT NULL DEFAULT now(),
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    // Ronda 2 (13/10/2026): payload para reintentar y clientes ya mandados para no duplicar al retomar
    await q`ALTER TABLE cj_fathom_anuncios
      ADD COLUMN IF NOT EXISTS payload jsonb,
      ADD COLUMN IF NOT EXISTS clientes_enviados text[] NOT NULL DEFAULT '{}'`
  }).catch(e => { tablaLista = null; throw e })
  return tablaLista
}

/** Lo que ya había en la fila al reclamarla (para retomar). En una fila nueva, todo vacío. */
export interface Reclamo {
  intentos: number
  error_previo: string | null          // el error del intento anterior (no se borra al reclamar: sirve para no repetir avisos)
  resultado: unknown
  version_prompt: string | null
  modelo: string | null
  tokens_in: number | null
  tokens_out: number | null
  clientes_enviados: string[]
  mensajes: string[]
}

const textos = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
const num = (x: unknown): number | null => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x))
const texto = (x: unknown): string | null => (typeof x === 'string' ? x : null)

function aReclamo(f: Record<string, unknown>): Reclamo {
  return {
    intentos: num(f.intentos) ?? 1,
    error_previo: texto(f.error),
    resultado: f.resultado ?? null,
    version_prompt: texto(f.version_prompt),
    modelo: texto(f.modelo),
    tokens_in: num(f.tokens_in),
    tokens_out: num(f.tokens_out),
    clientes_enviados: textos(f.clientes_enviados),
    mensajes: textos(f.mensajes),
  }
}

export interface OpcionesReclamo {
  forzar: boolean
  /** Solo el cron: no re-reclama filas con intentos >= topeIntentos. Con forzar no hay tope. */
  topeIntentos?: number
}

/**
 * Se queda con la grabación (y guarda el payload) o devuelve null si otra ejecución la tiene o ya terminó (duplicada).
 * Con forzar se descartan el resultado y los clientes enviados anteriores: se re-extrae y se manda todo de nuevo.
 */
export async function reclamar(id: number, op: OpcionesReclamo, datos: { titulo: string; url: string; payload: unknown }): Promise<Reclamo | null> {
  await asegurarTabla()
  const payload = JSON.stringify(datos.payload)
  return consulta('reclamar', async q => {
    const nueva = await q`INSERT INTO cj_fathom_anuncios (recording_id, estado, titulo, url, payload)
      VALUES (${id}, 'procesando', ${datos.titulo}, ${datos.url}, ${payload}::jsonb)
      ON CONFLICT (recording_id) DO NOTHING
      RETURNING intentos, error, resultado, version_prompt, modelo, tokens_in, tokens_out, clientes_enviados, mensajes`
    if (nueva.length) return aReclamo(nueva[0] as Record<string, unknown>)
    const tope = op.topeIntentos ?? null
    const otra = await q`UPDATE cj_fathom_anuncios SET
        estado = 'procesando', intentos = intentos + 1, titulo = ${datos.titulo}, url = ${datos.url},
        payload = ${payload}::jsonb, actualizado = now(),
        resultado = CASE WHEN ${op.forzar}::boolean THEN NULL ELSE resultado END,
        clientes_enviados = CASE WHEN ${op.forzar}::boolean THEN '{}'::text[] ELSE clientes_enviados END
      WHERE recording_id = ${id}
        AND (${op.forzar}::boolean OR (
          (estado = 'error' OR (estado = 'procesando' AND actualizado < now() - interval '10 minutes'))
          AND (${tope}::int IS NULL OR intentos < ${tope}::int)
        ))
      RETURNING intentos, error, resultado, version_prompt, modelo, tokens_in, tokens_out, clientes_enviados, mensajes`
    return otra.length ? aReclamo(otra[0] as Record<string, unknown>) : null
  })
}

export interface Extraida {
  resultado: unknown
  modelo: string
  version_prompt: string
  tokens_in: number
  tokens_out: number
}

/** Guarda la extracción apenas sale de Claude (antes de mandar). También renueva "actualizado" (la fila sigue viva). */
export async function guardarExtraccion(id: number, x: Extraida): Promise<void> {
  await asegurarTabla()
  await consulta('guardar extracción', q => q`UPDATE cj_fathom_anuncios SET
      resultado = ${JSON.stringify(x.resultado)}::jsonb, modelo = ${x.modelo}, version_prompt = ${x.version_prompt},
      tokens_in = ${x.tokens_in}, tokens_out = ${x.tokens_out}, actualizado = now()
    WHERE recording_id = ${id}`)
}

/** Clientes ya mandados enteros y todos los ids de Discord hasta ahora (el estado completo, no un agregado). */
export async function anotarEnviados(id: number, clientes: string[], mensajes: string[]): Promise<void> {
  await asegurarTabla()
  await consulta('anotar enviados', q => q`UPDATE cj_fathom_anuncios SET
      clientes_enviados = ${clientes}::text[], mensajes = ${mensajes}::text[], actualizado = now()
    WHERE recording_id = ${id}`)
}

export interface Marca {
  estado: Exclude<EstadoRegistro, 'procesando'>
  clientes?: number | null
  cambios?: number | null
  mensajes?: string[] | null
  clientes_enviados?: string[] | null
  resultado?: unknown
  error?: string | null
  modelo?: string | null
  version_prompt?: string | null
  tokens_in?: number | null
  tokens_out?: number | null
  duracion_ms?: number | null
}

/** Estado final (enviado, sin_cambios, omitida: además borra el payload) o error. Lo que no se pasa queda como estaba. */
export async function marcar(id: number, m: Marca): Promise<void> {
  await asegurarTabla()
  const resultado = m.resultado === undefined || m.resultado === null ? null : JSON.stringify(m.resultado)
  const final = (ESTADOS_FINALES as readonly string[]).includes(m.estado)
  await consulta('marcar', q => q`UPDATE cj_fathom_anuncios SET
      estado = ${m.estado}, error = ${m.error ?? null},
      clientes = COALESCE(${m.clientes ?? null}::int, clientes), cambios = COALESCE(${m.cambios ?? null}::int, cambios),
      mensajes = COALESCE(${m.mensajes ?? null}::text[], mensajes),
      clientes_enviados = COALESCE(${m.clientes_enviados ?? null}::text[], clientes_enviados),
      resultado = COALESCE(${resultado}::jsonb, resultado),
      modelo = COALESCE(${m.modelo ?? null}::text, modelo), version_prompt = COALESCE(${m.version_prompt ?? null}::text, version_prompt),
      tokens_in = COALESCE(${m.tokens_in ?? null}::int, tokens_in), tokens_out = COALESCE(${m.tokens_out ?? null}::int, tokens_out),
      duracion_ms = COALESCE(${m.duracion_ms ?? null}::int, duracion_ms),
      payload = CASE WHEN ${final}::boolean THEN NULL ELSE payload END,
      actualizado = now()
    WHERE recording_id = ${id}`)
}

/** El payload guardado de una grabación. undefined = no hay fila; null = la fila no tiene payload. */
export async function leerPayload(id: number): Promise<{ payload: unknown; estado: string; intentos: number } | undefined> {
  await asegurarTabla()
  const filas = await consulta('leer payload', q => q`SELECT payload, estado, intentos FROM cj_fathom_anuncios WHERE recording_id = ${id}`)
  if (!filas.length) return undefined
  const f = filas[0] as Record<string, unknown>
  return { payload: f.payload ?? null, estado: String(f.estado), intentos: num(f.intentos) ?? 1 }
}

export interface FilaPendiente {
  recording_id: number
  estado: string                 // 'error' o 'procesando' (colgada)
  titulo: string | null
  intentos: number
  error: string | null
  tiene_payload: boolean
}

/**
 * Filas para el cron: en error con intentos < tope y que no sean de las que no tiene sentido reintentar solas (las
 * marcadas con los prefijos de `excluir`, ej. sin_payload: y sin_transcripcion:), y TODAS las colgadas en procesando
 * (más de 10 min), aunque hayan llegado al tope: el cron las cierra con aviso (marcarAgotada) en vez de olvidarlas.
 * Las más viejas primero.
 */
export async function pendientes(limite: number, topeIntentos: number, excluir: readonly string[]): Promise<FilaPendiente[]> {
  await asegurarTabla()
  const patrones = excluir.map(p => `${p.replace(/[\\%_]/g, m => `\\${m}`)}%`)
  const filas = await consulta('pendientes', q => q`SELECT recording_id, estado, titulo, intentos, error, (payload IS NOT NULL) AS tiene_payload
    FROM cj_fathom_anuncios
    WHERE (estado = 'error'
        AND intentos < ${topeIntentos}::int
        AND (error IS NULL OR NOT (error LIKE ANY (${patrones}::text[]))))
      OR (estado = 'procesando' AND actualizado < now() - interval '10 minutes')
    ORDER BY actualizado ASC
    LIMIT ${Math.max(1, Math.min(20, limite))}`)
  return filas.map(f => {
    const r = f as Record<string, unknown>
    return { recording_id: Number(r.recording_id), estado: String(r.estado), titulo: texto(r.titulo), intentos: num(r.intentos) ?? 1, error: texto(r.error), tiene_payload: r.tiene_payload === true }
  })
}

/**
 * Una fila sin payload no se puede reintentar sola: queda en error con el prefijo (así el cron no la vuelve a tomar).
 * Devuelve true solo si ESTA ejecución la marcó: si otra ya lo hizo (dos crons a la vez), false, y el aviso sale una vez.
 */
export async function marcarSinPayload(id: number, error: string, prefijo: string): Promise<boolean> {
  await asegurarTabla()
  const patron = `${prefijo.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const filas = await consulta('marcar sin payload', q => q`UPDATE cj_fathom_anuncios SET estado = 'error', error = ${error}, actualizado = now()
    WHERE recording_id = ${id} AND payload IS NULL AND (error IS NULL OR error NOT LIKE ${patron})
    RETURNING recording_id`)
  return filas.length > 0
}

/**
 * Una colgada en procesando que ya llegó al tope de intentos: pasa a error con el prefijo (el cron no la vuelve a tomar).
 * El payload se conserva para un reintento a mano. true solo si ESTA ejecución la cerró (el aviso sale una vez).
 */
export async function marcarAgotada(id: number, error: string): Promise<boolean> {
  await asegurarTabla()
  const filas = await consulta('marcar agotada', q => q`UPDATE cj_fathom_anuncios SET estado = 'error', error = ${error}, actualizado = now()
    WHERE recording_id = ${id} AND estado = 'procesando' RETURNING recording_id`)
  return filas.length > 0
}

/**
 * Privacidad: las filas en error que ya no se van a reintentar solas guardarían para siempre la transcripción y los
 * mails de los invitados. Pasados `dias` sin cambios se les borra el payload (lo corre el cron diario).
 */
export async function purgarPayloadsViejos(dias = 14): Promise<number> {
  await asegurarTabla()
  const filas = await consulta('purgar payloads', q => q`UPDATE cj_fathom_anuncios SET payload = NULL
    WHERE estado = 'error' AND payload IS NOT NULL AND actualizado < now() - make_interval(days => ${Math.max(1, Math.trunc(dias))}::int)
    RETURNING recording_id`)
  return filas.length
}

export interface FilaRegistro {
  recording_id: number; estado: string; titulo: string | null; url: string | null; intentos: number
  clientes: number | null; cambios: number | null; mensajes: string[] | null; clientes_enviados: string[]
  tiene_payload: boolean; error: string | null; modelo: string | null
  version_prompt: string | null; tokens_in: number | null; tokens_out: number | null; duracion_ms: number | null
  creado: string; actualizado: string
}

/** Las últimas n filas, sin "resultado" ni "payload" (para el GET de estado). */
export async function ultimas(n = 10): Promise<FilaRegistro[]> {
  await asegurarTabla()
  const filas = await consulta('últimas', q => q`SELECT recording_id, estado, titulo, url, intentos, clientes, cambios, mensajes, clientes_enviados,
      (payload IS NOT NULL) AS tiene_payload, error, modelo, version_prompt, tokens_in, tokens_out, duracion_ms, creado, actualizado
    FROM cj_fathom_anuncios ORDER BY creado DESC LIMIT ${Math.max(1, Math.min(50, n))}`)
  const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x))
  return filas.map(f => ({ ...(f as FilaRegistro), recording_id: Number(f.recording_id), creado: iso(f.creado), actualizado: iso(f.actualizado) }))
}

// ── Kickoffs (cj_kickoffs, de lib/bot/kickoff): solo LECTURA ────────────────────────────────────
// Cómo clasificó la llamada el bot de kickoff (ver kickoff.ts). Nunca se crea ni se escribe esa tabla desde acá: si no
// existe todavía, no hay fila. duplicada_de es una columna que suma el bot de kickoff: si en esta base todavía no está
// (42703), se lee por to_jsonb (más pesado: arma la fila entera). Cada consulta tiene un tope corto (best effort).
type FilaCruda = { estado: unknown; tipo: unknown; duplicada_de: unknown; colgada: unknown }
const aFilaKickoff = (f: FilaCruda | undefined): FilaKickoffLeida | null => {
  if (!f || typeof f.estado !== 'string') return null
  const de = Number(f.duplicada_de)
  return { estado: f.estado, tipo: typeof f.tipo === 'string' && f.tipo ? f.tipo : null, duplicada_de: Number.isSafeInteger(de) && de > 0 ? de : null, colgada: f.colgada === true }
}
const sinTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "cj_kickoffs" does not exist/i.test((e as Error)?.message ?? '')
const sinColumna = (e: unknown) => (e as { code?: string })?.code === '42703' || /column "duplicada_de" does not exist/i.test((e as Error)?.message ?? '')
let columnaDuplicada = true

export async function leerKickoff(id: number): Promise<ConsultaKickoff> {
  const una = async (rid: number) => {
    const leer = (directo: boolean) => consulta('leer kickoff', q => (directo
      ? q`SELECT estado, ficha ->> 'tipo_reunion' AS tipo, duplicada_de, (actualizado < now() - interval '10 minutes') AS colgada
          FROM cj_kickoffs WHERE recording_id = ${rid}`
      : q`SELECT estado, ficha ->> 'tipo_reunion' AS tipo, to_jsonb(k) ->> 'duplicada_de' AS duplicada_de, (actualizado < now() - interval '10 minutes') AS colgada
          FROM cj_kickoffs k WHERE recording_id = ${rid}`), TOPE_LECTURA_KICKOFF_MS)
    let filas
    try {
      filas = await leer(columnaDuplicada)
    } catch (e) {
      if (!columnaDuplicada || !sinColumna(e)) throw e
      columnaDuplicada = false
      filas = await leer(false)
    }
    return aFilaKickoff(filas[0] as FilaCruda | undefined)
  }
  try {
    const fila = await una(id)
    const original = fila?.estado === 'duplicada' && fila.duplicada_de && fila.duplicada_de !== id ? await una(fila.duplicada_de) : null
    return { fila, original }
  } catch (e) {
    if (sinTabla(e)) return { fila: null, original: null }
    throw e
  }
}
