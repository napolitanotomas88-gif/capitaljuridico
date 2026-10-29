// ── Registro de acciones sobre clientes (Neon, tabla cj_cliente_acciones) — SOLO servidor ───────────────────────────────
// Una fila por acción hecha desde la tarjeta: qué se pidió, el plan de celdas, en qué modo y si quedó aplicada, con error o
// anulada (deshacer). Nada se borra. La tabla se crea sola con la primera acción (mismo patrón que hitosRegistro.ts).
import { neon } from '@neondatabase/serverless'
import { diasEntre, hoyArgentina, type Ymd } from '../fechas'
import type { Accion, CambioPlan, CuerpoAccion, EstadoAccion, ModoAcciones, PausaVigente, TipoAccion } from './tipos'
import { resumenRenovacion } from './resumenRenovacion'
import type { ResultadoEscritura } from './tipos'

const TOPE_LECTURA_MS = 4_000
const TOPE_ESCRITURA_MS = 10_000
const ID_CRM = /^[A-Za-z]\d{1,6}$/

export const baseAccionesConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()
const sql = (tope: number) => neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(tope) } })
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "cj_cliente_acciones" does not exist/i.test((e as Error)?.message ?? '')
const yaExiste = (e: unknown) => ['23505', '42P07'].includes((e as { code?: string })?.code ?? '')

/** CLIENTES_ESCRITURA: sombra (por defecto) | prueba | real. Cualquier otro valor cuenta como sombra. */
export function modoAcciones(): ModoAcciones {
  const v = (process.env.CLIENTES_ESCRITURA ?? '').trim().toLowerCase()
  return v === 'real' || v === 'prueba' ? v : 'sombra'
}

async function crearTabla(): Promise<void> {
  const q = sql(TOPE_ESCRITURA_MS)
  for (const crear of [
    () => q`CREATE TABLE IF NOT EXISTS cj_cliente_acciones (
      id text PRIMARY KEY, id_crm text NOT NULL, tipo text NOT NULL, estado text NOT NULL, modo text NOT NULL,
      datos jsonb NOT NULL, plan jsonb NOT NULL DEFAULT '[]'::jsonb, resumen text NOT NULL DEFAULT '', quien text NOT NULL DEFAULT '',
      creada timestamptz NOT NULL DEFAULT now(), aplicada timestamptz, anulada timestamptz, anulada_por text, error text,
      resultado jsonb)`,
    () => q`CREATE INDEX IF NOT EXISTS cj_cliente_acciones_id_crm ON cj_cliente_acciones (id_crm, creada DESC)`,
  ]) {
    try { await crear() } catch (e) { if (!yaExiste(e)) throw e }
  }
}

const iso = (x: unknown): string | null => (x ? (x instanceof Date ? x : new Date(String(x))).toISOString() : null)
const aAccion = (f: Record<string, unknown>): Accion => ({
  id: String(f.id), idCrm: String(f.id_crm), tipo: String(f.tipo) as TipoAccion, estado: String(f.estado) as EstadoAccion,
  modo: String(f.modo) as ModoAcciones, datos: f.datos as CuerpoAccion, plan: (f.plan ?? []) as CambioPlan[],
  resumen: String(f.resumen ?? ''), quien: String(f.quien ?? ''), creada: iso(f.creada) ?? '', aplicada: iso(f.aplicada),
  anulada: iso(f.anulada), error: f.error ? String(f.error) : null,
  esDeshacible: String(f.tipo) !== 'pago' && !(f.resultado as {deshaciendo?:boolean;canje?:unknown}|null)?.deshaciendo && !(f.resultado as {canje?:unknown}|null)?.canje && (String(f.modo)==='sombra' || !!f.resultado && (f.resultado as {version?:number}).version===1),
  renovacionReferidos: resumenRenovacion(f.resultado as ResultadoEscritura | null),
})

/** Id nuevo: corto, legible y sin choques prácticos (va en la nota de Renovaciones). */
export function nuevoIdAccion(ahora = Date.now()): string {
  return `ac_${ahora.toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0')}`
}

/** Historial de un cliente, de la más nueva a la más vieja. Sin tabla todavía: lista vacía. */
export async function listarAcciones(idCrm: string, limite = 100): Promise<Accion[]> {
  if (!baseAccionesConfigurada() || !ID_CRM.test(idCrm)) return []
  try {
    const filas = (await sql(TOPE_LECTURA_MS)`SELECT * FROM cj_cliente_acciones WHERE id_crm = ${idCrm.toUpperCase()} ORDER BY creada DESC LIMIT ${limite}`) as Record<string, unknown>[]
    return filas.map(aAccion)
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

/**
 * Pausa abierta: la última "pausa" vigente (no anulada ni con error) sin un "reanudar" vigente posterior.
 * Recibe el historial ya ordenado de más nueva a más vieja (el de listarAcciones).
 */
export function pausaVigente(acciones: readonly Accion[], hoy: Ymd = hoyArgentina()): PausaVigente | null {
  for (const a of acciones) {
    if (a.estado === 'anulada' || a.estado === 'error') continue
    if (a.tipo === 'reanudar') return null
    if (a.tipo === 'pausa') {
      const desde = (a.datos as { desde?: Ymd }).desde ?? a.creada.slice(0, 10)
      return { desde, dias: Math.max(0, diasEntre(desde, hoy)), accionId: a.id, modo: a.modo }
    }
  }
  return null
}

export interface NuevaAccion { id: string; idCrm: string; tipo: TipoAccion; estado: EstadoAccion; modo: ModoAcciones; datos: CuerpoAccion; plan: CambioPlan[]; resumen: string; quien: string; error?: string | null }

export async function guardarAccion(n: NuevaAccion): Promise<Accion> {
  const q = sql(TOPE_ESCRITURA_MS)
  const insertar = async () => (await q`INSERT INTO cj_cliente_acciones (id, id_crm, tipo, estado, modo, datos, plan, resumen, quien, aplicada, error)
    VALUES (${n.id}, ${n.idCrm.toUpperCase()}, ${n.tipo}, ${n.estado}, ${n.modo}, ${JSON.stringify(n.datos)}::jsonb, ${JSON.stringify(n.plan)}::jsonb,
      ${n.resumen}, ${n.quien}, ${n.estado === 'aplicada' ? new Date().toISOString() : null}, ${n.error ?? null})
    RETURNING *`) as Record<string, unknown>[]
  try {
    return aAccion((await insertar())[0])
  } catch (e) {
    if (!faltaTabla(e)) throw e
    await crearTabla()
    return aAccion((await insertar())[0])
  }
}

/** Marca una acción como anulada (deshacer). Devuelve la acción actualizada o null si no existe o ya estaba anulada. */
export async function anularAccion(id: string, idCrm: string, quien: string): Promise<Accion | null> {
  const filas = (await sql(TOPE_ESCRITURA_MS)`UPDATE cj_cliente_acciones SET estado = 'anulada', anulada = now(), anulada_por = ${quien}
    WHERE id = ${id} AND id_crm = ${idCrm.toUpperCase()} AND estado <> 'anulada' RETURNING *`) as Record<string, unknown>[]
  return filas.length ? aAccion(filas[0]) : null
}
