// ── Wins en Neon (13/11/2026). SOLO servidor ────────────────────────────────────────────────────────────────────────────
// Tabla propia cj_wins (editar wins no toca ninguna otra tabla). Se crea sola con la PRIMERA ESCRITURA (asegurarTablaWins):
// las lecturas nunca crean nada; sin tabla, devuelven la lista vacía.
//   · captura: bytea con la imagen ya achicada y validada (lib/clientes/wins/modelo.ts). Se lee solo por la ruta protegida
//     /api/clientes/wins/<id>/captura: los listados nunca traen los bytes.
//   · clave: única, para que el mismo pedido reintentado no duplique el win (idempotencia).
//   · Borrar es lógico (borrado + borrado_por) y libera la captura: el win deja de verse y de sumar, el registro queda.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { conCache, invalidarEtiqueta } from '../../anuncios/cache'
import type { Ymd } from '../fechas'
import { esFuenteWin, TIPOS_CAPTURA, type TipoCaptura, type Win, type WinNuevo } from './modelo'

type Q = NeonQueryFunction<false, false>
export const baseWinsConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()
const conectar = (tope = 8_000): Q => {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('Falta DATABASE_URL')
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(tope) } })
}
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "cj_wins" does not exist/i.test((e as Error)?.message ?? '')
const ETIQUETA = 'wins'

let lista: Promise<void> | null = null
/** Crea la tabla si no existe. Solo la llaman las escrituras. */
export function asegurarTablaWins(q: Q = conectar()): Promise<void> {
  lista ??= (async () => {
    await q`CREATE TABLE IF NOT EXISTS cj_wins (
      id bigserial PRIMARY KEY, clave text NOT NULL UNIQUE, id_crm text NOT NULL, fecha date NOT NULL, texto text NOT NULL,
      fuente text NOT NULL, autorizado boolean NOT NULL DEFAULT false, captura bytea, captura_tipo text, captura_bytes int,
      cargado_por text NOT NULL, creado timestamptz NOT NULL DEFAULT now(), borrado timestamptz, borrado_por text)`
    await q`CREATE INDEX IF NOT EXISTS cj_wins_cliente ON cj_wins (upper(id_crm), fecha DESC) WHERE borrado IS NULL`
  })().catch((e) => { lista = null; throw e })
  return lista
}

const iso = (x: unknown): string | null => {
  if (!x) return null
  const d = x instanceof Date ? x : new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function aWin(f: Record<string, unknown>): Win {
  return {
    id: Number(f.id), idCrm: String(f.id_crm).toUpperCase(), fecha: String(f.fecha), texto: String(f.texto ?? ''),
    fuente: esFuenteWin(f.fuente) ? f.fuente : 'otro', autorizado: f.autorizado === true, cargadoPor: String(f.cargado_por ?? ''),
    creado: iso(f.creado), conCaptura: f.con_captura === true,
  }
}

/** Todos los wins vigentes (sin los bytes de la captura), del más nuevo al más viejo. Sin tabla: ninguno. */
export async function listarWins(idCrm?: string | null): Promise<Win[]> {
  const q = conectar()
  try {
    const filas = (idCrm
      ? await q`SELECT id, id_crm, to_char(fecha, 'YYYY-MM-DD') AS fecha, texto, fuente, autorizado, cargado_por, creado, captura IS NOT NULL AS con_captura
          FROM cj_wins WHERE borrado IS NULL AND upper(id_crm) = ${idCrm.toUpperCase()} ORDER BY fecha DESC, creado DESC LIMIT 500`
      : await q`SELECT id, id_crm, to_char(fecha, 'YYYY-MM-DD') AS fecha, texto, fuente, autorizado, cargado_por, creado, captura IS NOT NULL AS con_captura
          FROM cj_wins WHERE borrado IS NULL ORDER BY fecha DESC, creado DESC LIMIT 2000`) as Record<string, unknown>[]
    return filas.map(aWin)
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

/** Para el puntaje: cliente y fecha de los wins vigentes de los últimos 180 días (caché compartida de 60 s). */
export async function fechasDeWins(): Promise<{ idCrm: string; fecha: Ymd }[]> {
  const r = await conCache('wins-fechas-v1', 60, async () => {
    const q = conectar(4_000)
    try {
      const filas = (await q`SELECT upper(id_crm) AS id, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM cj_wins
        WHERE borrado IS NULL AND fecha >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 180`) as Record<string, unknown>[]
      return filas.map(f => ({ idCrm: String(f.id), fecha: String(f.fecha) }))
    } catch (e) {
      if (faltaTabla(e)) return []
      throw e
    }
  }, { etiquetas: [ETIQUETA] })
  return Array.isArray(r.data) ? r.data : []
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

/** Guarda un win. Si la clave ya existía (reintento), devuelve el que ya estaba sin duplicar. */
export async function crearWin(w: WinNuevo, quien: string): Promise<{ id: number; nuevo: boolean }> {
  const q = conectar()
  await asegurarTablaWins(q)
  const c = w.captura
  const filas = (await q`INSERT INTO cj_wins (clave, id_crm, fecha, texto, fuente, autorizado, captura, captura_tipo, captura_bytes, cargado_por)
    VALUES (${w.clave}, ${w.idCrm}, ${w.fecha}::date, ${w.texto}, ${w.fuente}, ${w.autorizado},
      decode(${c ? hex(c.bytes) : null}::text, 'hex'), ${c?.tipo ?? null}, ${c ? c.bytes.length : null}, ${quien.slice(0, 120)})
    ON CONFLICT (clave) DO NOTHING RETURNING id`) as { id: unknown }[]
  invalidarEtiqueta(ETIQUETA)
  if (filas.length) return { id: Number(filas[0].id), nuevo: true }
  const previo = (await q`SELECT id FROM cj_wins WHERE clave = ${w.clave}`) as { id: unknown }[]
  return { id: Number(previo[0]?.id ?? 0), nuevo: false }
}

/** Borra (lógico) un win y libera su captura. false = no existía o ya estaba borrado. */
export async function borrarWin(id: number, quien: string): Promise<boolean> {
  const q = conectar()
  await asegurarTablaWins(q)
  const r = (await q`UPDATE cj_wins SET borrado = now(), borrado_por = ${quien.slice(0, 120)}, captura = NULL
    WHERE id = ${id} AND borrado IS NULL RETURNING id`) as unknown[]
  invalidarEtiqueta(ETIQUETA)
  return r.length > 0
}

/** Los bytes de la captura de un win vigente. null = no existe, está borrado o no tiene captura. */
export async function leerCaptura(id: number): Promise<{ tipo: TipoCaptura; bytes: Uint8Array } | null> {
  const q = conectar()
  try {
    const filas = (await q`SELECT encode(captura, 'base64') AS b64, captura_tipo FROM cj_wins WHERE id = ${id} AND borrado IS NULL AND captura IS NOT NULL`) as Record<string, unknown>[]
    if (!filas.length) return null
    const tipo = String(filas[0].captura_tipo)
    if (!(TIPOS_CAPTURA as readonly string[]).includes(tipo)) return null
    return { tipo: tipo as TipoCaptura, bytes: new Uint8Array(Buffer.from(String(filas[0].b64).replace(/\s+/g, ''), 'base64')) }
  } catch (e) {
    if (faltaTabla(e)) return null
    throw e
  }
}
