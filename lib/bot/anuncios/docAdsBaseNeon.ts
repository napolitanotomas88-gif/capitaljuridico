// ── Línea de base del Doc de ADS en Neon (tabla cj_anuncios_doc_base) ───────────────────────────────────────────────
// Una fila por huella (bloque o video del Doc, docAdsBase.ts) con su estado: base (estaba el día de la línea de base),
// procesado (el bot ya armó o avisó) o pendiente (excepción explícita: se trata como nuevo). Sin filas = todavía no hay
// línea de base: la corrida la crea con el Doc de ese momento (todo «base») y no procesa nada.
// Misma base que el resto del Despacho (DATABASE_URL). La tabla se crea sola. Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { lineaBaseDe, type EstadoHuella, type FilaBase, type LineaBase } from './docAdsBase'

const TOPE_CONSULTA_MS = 10_000
type Sql = NeonQueryFunction<false, false>

async function consulta<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
  let t: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, rechazar) => { t = setTimeout(() => rechazar(new Error(`la base no respondió en ${TOPE_CONSULTA_MS / 1000} s (${que})`)), TOPE_CONSULTA_MS) })
  try {
    return await Promise.race([fn(q), tope])
  } finally {
    clearTimeout(t)
  }
}

let tablaLista: Promise<void> | null = null
function asegurarTabla(): Promise<void> {
  tablaLista ??= consulta('crear tabla', async q => {
    await q`CREATE TABLE IF NOT EXISTS cj_anuncios_doc_base (
      huella text PRIMARY KEY,
      tipo text NOT NULL,
      bloque text NOT NULL,
      listo boolean NOT NULL DEFAULT false,
      estado text NOT NULL,
      nombre text,
      creado timestamptz NOT NULL DEFAULT now(),
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
  }).catch(e => { tablaLista = null; throw e })
  return tablaLista
}

/** Tabla que no existe (42P01): leer = todavía no hay línea de base. */
export const faltaTablaBase = (e: unknown): boolean =>
  (e as { code?: string })?.code === '42P01' || /relation "cj_anuncios_doc_base" does not exist/i.test(String((e as Error)?.message ?? ''))

type FilaLeida = { huella: string; tipo: 'bloque' | 'video'; bloque: string; listo: boolean; estado: EstadoHuella }
/**
 * Las filas tal cual (serializables: el tablero las cachea). [] = todavía no hay línea de base.
 * La lee el tablero de anuncios, que también arma la cartera de clientes: no crea la tabla (velocidad 3, 13/11/2026, el
 * CREATE TABLE sumaba una ida a Neon en cada arranque en frío). La crean las escrituras (insertar).
 */
export async function leerFilasBase(): Promise<FilaLeida[]> {
  try {
    return await consulta('leer línea de base', q => q`SELECT huella, tipo, bloque, listo, estado FROM cj_anuncios_doc_base`) as FilaLeida[]
  } catch (e) {
    if (faltaTablaBase(e)) return []
    throw e
  }
}

/** La línea de base, o null si todavía no se creó (tabla vacía). */
export async function leerLineaBase(): Promise<LineaBase | null> {
  const filas = await leerFilasBase()
  return filas.length ? lineaBaseDe(filas) : null
}

async function insertar(filas: readonly FilaBase[], pisar: boolean): Promise<void> {
  if (!filas.length) return
  await asegurarTabla()
  const h = filas.map(f => f.huella), ti = filas.map(f => f.tipo), b = filas.map(f => f.bloque), l = filas.map(f => f.listo), e = filas.map(f => f.estado), n = filas.map(f => f.nombre.slice(0, 120))
  await consulta('guardar huellas', q => pisar
    ? q`INSERT INTO cj_anuncios_doc_base (huella, tipo, bloque, listo, estado, nombre)
        SELECT * FROM unnest(${h}::text[], ${ti}::text[], ${b}::text[], ${l}::boolean[], ${e}::text[], ${n}::text[])
        ON CONFLICT (huella) DO UPDATE SET estado = EXCLUDED.estado, listo = EXCLUDED.listo, actualizado = now()`
    : q`INSERT INTO cj_anuncios_doc_base (huella, tipo, bloque, listo, estado, nombre)
        SELECT * FROM unnest(${h}::text[], ${ti}::text[], ${b}::text[], ${l}::boolean[], ${e}::text[], ${n}::text[])
        ON CONFLICT (huella) DO NOTHING`)
}

/** Crea la línea de base (no pisa lo que ya hay). */
export const guardarLineaBase = (filas: readonly FilaBase[]) => insertar(filas, false)
/** Marca huellas como procesadas (o pendientes) pisando el estado anterior. */
export const marcarHuellas = (filas: readonly FilaBase[]) => insertar(filas, true)
