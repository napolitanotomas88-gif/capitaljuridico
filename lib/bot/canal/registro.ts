// ── Mensajes «para enviar» al cliente: registro en Neon (cj_canal_mensajes). Solo servidor ─────────────────────────────
// Una fila por mensaje que el bot dejaba para el cliente: clave UNIQUE (pieza:clave propia), pieza, id_crm, cliente, texto
// (completo: lo tiene que copiar una persona; el repo no lo guarda), abrir (ruta interna), adjuntos, datos del gancho,
// estado para_enviar → enviado | descartado, quién y cuándo, motivo (descartado), recordatorios.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { MensajeCliente, PiezaCliente } from './tipos'

type Q = NeonQueryFunction<false, false>
type Fila = Record<string, unknown>
const url = () => process.env.DATABASE_URL?.trim() || ''
export const baseCanalLista = (): boolean => !!url()
const q = (): Q => neon(url(), { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
let lista = false

export async function asegurarTablaCanal(c: Q = q()): Promise<void> {
  if (lista) return
  await c`CREATE TABLE IF NOT EXISTS cj_canal_mensajes (
    id bigserial PRIMARY KEY, clave text NOT NULL UNIQUE, pieza text NOT NULL, id_crm text, cliente text NOT NULL,
    texto text NOT NULL, abrir text, adjuntos jsonb NOT NULL DEFAULT '[]'::jsonb, datos jsonb NOT NULL DEFAULT '{}'::jsonb,
    proveedor text NOT NULL DEFAULT 'manual', estado text NOT NULL DEFAULT 'para_enviar', por text, cuando timestamptz, motivo text,
    recordatorios int NOT NULL DEFAULT 0, creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now())`
  await c`CREATE INDEX IF NOT EXISTS cj_canal_mensajes_estado ON cj_canal_mensajes (estado, creado)`
  lista = true
}

export interface MensajeGuardado {
  id: number; clave: string; pieza: PiezaCliente; idCrm: string | null; cliente: string; texto: string; abrir: string | null; adjuntos: string[]
  datos: Record<string, unknown>; estado: 'para_enviar' | 'enviado' | 'descartado'; por: string | null; cuando: string | null; motivo: string | null
  recordatorios: number; creado: string
}

const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : x ? String(x) : null)
const json = <T>(x: unknown, d: T): T => { try { return (typeof x === 'string' ? JSON.parse(x) : x ?? d) as T } catch { return d } }
const aMensaje = (f: Fila): MensajeGuardado => ({
  id: Number(f.id), clave: String(f.clave), pieza: String(f.pieza) as PiezaCliente, idCrm: f.id_crm ? String(f.id_crm) : null, cliente: String(f.cliente ?? ''),
  texto: String(f.texto ?? ''), abrir: f.abrir ? String(f.abrir) : null, adjuntos: json<string[]>(f.adjuntos, []).filter((x) => typeof x === 'string'),
  datos: json<Record<string, unknown>>(f.datos, {}), estado: String(f.estado) as MensajeGuardado['estado'], por: f.por ? String(f.por) : null,
  cuando: iso(f.cuando), motivo: f.motivo ? String(f.motivo) : null, recordatorios: Number(f.recordatorios ?? 0), creado: iso(f.creado) ?? '',
})

/** Inserta el mensaje. null = ya existía esa clave (no se duplica). */
export async function insertarMensaje(m: MensajeCliente & { claveCompleta: string }): Promise<number | null> {
  const c = q()
  await asegurarTablaCanal(c)
  const r = await c`INSERT INTO cj_canal_mensajes (clave, pieza, id_crm, cliente, texto, abrir, adjuntos, datos)
    VALUES (${m.claveCompleta}, ${m.pieza}, ${m.idCrm ? m.idCrm.toUpperCase() : null}, ${m.cliente.slice(0, 160)}, ${m.texto.slice(0, 6000)}, ${m.abrir ?? null},
      ${JSON.stringify((m.adjuntos ?? []).slice(0, 20))}::jsonb, ${JSON.stringify(m.datos ?? {})}::jsonb)
    ON CONFLICT (clave) DO NOTHING RETURNING id`
  return r.length ? Number(r[0].id) : null
}

export async function idPorClave(clave: string): Promise<number | null> {
  const r = await q()`SELECT id FROM cj_canal_mensajes WHERE clave = ${clave}`
  return r.length ? Number(r[0].id) : null
}

export async function leerMensaje(id: number): Promise<MensajeGuardado | null> {
  await asegurarTablaCanal()
  const r = (await q()`SELECT * FROM cj_canal_mensajes WHERE id = ${id}`) as Fila[]
  return r.length ? aMensaje(r[0]) : null
}

/** Pendientes (todos) y los últimos 30 resueltos. */
export async function listarMensajes(): Promise<{ pendientes: MensajeGuardado[]; resueltos: MensajeGuardado[] }> {
  if (!url()) return { pendientes: [], resueltos: [] }
  const c = q()
  await asegurarTablaCanal(c)
  const p = (await c`SELECT * FROM cj_canal_mensajes WHERE estado = 'para_enviar' ORDER BY creado LIMIT 300`) as Fila[]
  const r = (await c`SELECT * FROM cj_canal_mensajes WHERE estado <> 'para_enviar' ORDER BY actualizado DESC LIMIT 30`) as Fila[]
  return { pendientes: p.map(aMensaje), resueltos: r.map(aMensaje) }
}

/** para_enviar → enviado | descartado (una sola vez). Devuelve la fila si la cambió. */
export async function resolverMensaje(id: number, estado: 'enviado' | 'descartado', por: string, motivo: string | null): Promise<MensajeGuardado | null> {
  const r = (await q()`UPDATE cj_canal_mensajes SET estado = ${estado}, por = ${por.slice(0, 120)}, cuando = now(), motivo = ${motivo ? motivo.slice(0, 300) : null}, actualizado = now()
    WHERE id = ${id} AND estado = 'para_enviar' RETURNING *`) as Fila[]
  return r.length ? aMensaje(r[0]) : null
}

/** Cierra por clave (lo usa la pantalla propia de la pieza: p. ej. «Confirmar entrega» de guiones). */
export async function cerrarPorClave(clave: string, por: string): Promise<boolean> {
  if (!url()) return false
  await asegurarTablaCanal()
  const r = await q()`UPDATE cj_canal_mensajes SET estado = 'enviado', por = ${por.slice(0, 120)}, cuando = now(), actualizado = now()
    WHERE clave = ${clave} AND estado = 'para_enviar' RETURNING id`
  return r.length > 0
}

/** Cierra por prefijo de clave (todas las de una tanda, una alta…). */
export async function cerrarPorPrefijo(prefijo: string, por: string): Promise<number> {
  if (!url()) return 0
  await asegurarTablaCanal()
  const r = await q()`UPDATE cj_canal_mensajes SET estado = 'enviado', por = ${por.slice(0, 120)}, cuando = now(), actualizado = now()
    WHERE starts_with(clave, ${prefijo}) AND estado = 'para_enviar' RETURNING id`
  return r.length
}

/** Pendientes que llevan más de `horas` y tienen menos de `n` recordatorios (los marca). */
export async function tomarParaRecordar(horas: number, n: number): Promise<MensajeGuardado[]> {
  if (!url()) return []
  await asegurarTablaCanal()
  const r = (await q()`UPDATE cj_canal_mensajes SET recordatorios = ${n}, actualizado = actualizado
    WHERE id IN (SELECT id FROM cj_canal_mensajes WHERE estado = 'para_enviar' AND recordatorios < ${n} AND creado < now() - make_interval(hours => ${horas}) ORDER BY creado LIMIT 20)
    RETURNING *`) as Fila[]
  return r.map(aMensaje)
}
