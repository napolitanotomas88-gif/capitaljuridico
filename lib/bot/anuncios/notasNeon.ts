// ── Notas del cliente en Neon (tabla cj_anuncios_notas) ──────────────────────────────────────────────
// Una fila por mensaje de WhatsApp leído (mensaje_id único: se reclama antes de llamar a Claude, así un mensaje que Whapi
// manda dos veces se lee una sola vez). Estados: leyendo → nota (es de anuncios) | descartado (no es de anuncios: el texto
// se borra, solo queda el id para no releerlo) | sin_leer (Claude no respondió) → avisada / aviso_fallido si fue a Valen.
// Misma base que el resto del Despacho (DATABASE_URL). La tabla se crea sola. Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { Lectura, MensajeNota, NotaGuardada, TipoNota } from './notas'

export const TOPE_CONSULTA_MS = 10_000
type Sql = NeonQueryFunction<false, false>

let fabricaSql: ((url: string) => Sql) | null = null
/** Solo para tests: un Neon falso (null vuelve al real). */
export function sqlNotasParaPruebas(f: ((url: string) => Sql) | null): void { fabricaSql = f; tablaLista = null }

async function consulta<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = fabricaSql ? fabricaSql(url) : neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
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
    await q`CREATE TABLE IF NOT EXISTS cj_anuncios_notas (
      id serial PRIMARY KEY,
      mensaje_id text NOT NULL UNIQUE,
      id_crm text,
      cliente text NOT NULL,
      grupo text,
      enviado timestamptz NOT NULL,
      texto text,
      dijo text,
      pide text,
      tipo text,
      avisar boolean NOT NULL DEFAULT false,
      estado text NOT NULL DEFAULT 'leyendo',
      discord_id text,
      creado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE INDEX IF NOT EXISTS cj_anuncios_notas_enviado ON cj_anuncios_notas (enviado DESC)`
  }).catch(e => { tablaLista = null; throw e })
  return tablaLista
}

export async function reclamarNota(m: MensajeNota, c: { idCrm: string | null; cliente: string; grupo: string }): Promise<NotaGuardada | null> {
  await asegurarTabla()
  const filas = await consulta('reclamar nota', q => q`INSERT INTO cj_anuncios_notas (mensaje_id, id_crm, cliente, grupo, enviado, texto)
    VALUES (${m.mensajeId}, ${c.idCrm}, ${c.cliente}, ${c.grupo}, ${m.enviadoEn}, ${m.texto})
    ON CONFLICT (mensaje_id) DO NOTHING RETURNING id`)
  const id = Number((filas as { id: unknown }[])[0]?.id)
  return Number.isFinite(id) && id > 0 ? { id } : null
}

export async function guardarLectura(id: number, l: Lectura | null): Promise<void> {
  await asegurarTabla()
  if (!l) { await consulta('guardar nota', q => q`UPDATE cj_anuncios_notas SET estado = 'sin_leer' WHERE id = ${id}`); return }
  if (!l.esDeAnuncios) { await consulta('guardar nota', q => q`UPDATE cj_anuncios_notas SET estado = 'descartado', texto = NULL WHERE id = ${id}`); return }
  await consulta('guardar nota', q => q`UPDATE cj_anuncios_notas SET estado = 'nota', dijo = ${l.dijo}, pide = ${l.pide || null}, tipo = ${l.tipo}, avisar = ${l.avisar} WHERE id = ${id}`)
}

export async function marcarAvisoNota(id: number, discordId: string | null, estado: 'avisada' | 'aviso_fallido'): Promise<void> {
  await consulta('marcar aviso', q => q`UPDATE cj_anuncios_notas SET estado = ${estado}, discord_id = ${discordId} WHERE id = ${id}`)
}

export interface NotaCliente {
  id: number; idCrm: string | null; cliente: string; grupo: string | null; enviado: string
  texto: string | null; dijo: string; pide: string | null; tipo: TipoNota; avisar: boolean; estado: string
}

/** Las notas de los últimos `dias` (las que son de anuncios), la más nueva primero. Sin base o sin tabla: lista vacía. */
export async function listarNotas(dias = 60, limite = 300): Promise<NotaCliente[]> {
  if (!process.env.DATABASE_URL?.trim() && !fabricaSql) return []
  try {
    const filas = await consulta('listar notas', q => q`SELECT id, id_crm, cliente, grupo, enviado, texto, dijo, pide, tipo, avisar, estado FROM cj_anuncios_notas
      WHERE estado IN ('nota', 'avisada', 'aviso_fallido') AND enviado > now() - make_interval(days => ${dias})
      ORDER BY enviado DESC LIMIT ${limite}`) as Record<string, unknown>[]
    return filas.map(f => ({
      id: Number(f.id), idCrm: (f.id_crm as string | null) ?? null, cliente: String(f.cliente ?? ''), grupo: (f.grupo as string | null) ?? null,
      enviado: new Date(f.enviado as string).toISOString(), texto: (f.texto as string | null) ?? null, dijo: String(f.dijo ?? ''),
      pide: (f.pide as string | null) ?? null, tipo: (f.tipo as TipoNota) ?? 'otro', avisar: f.avisar === true, estado: String(f.estado ?? ''),
    }))
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return []
    throw e
  }
}
