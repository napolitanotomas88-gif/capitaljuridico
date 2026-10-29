// ── Hitos anotados a mano (Neon, tabla cj_hitos) — SOLO servidor ────────────────────────────────────────────────────────
// Lo que se anota o corrige desde la tarjeta del cliente (la regla está en hitos.ts). Una fila por cliente y hito: anotar de
// nuevo pisa la anterior y "borrar" la deja sin efecto (vuelve a mandar lo automático). La tabla se crea sola con la primera
// anotación; sin tabla, la lectura devuelve [] (no es una falla). Sin mails: quien anotó se guarda con su nombre corto.
import { neon } from '@neondatabase/serverless'
import { esClaveHito, type ClaveHito, type HitoManual } from './hitos'

const TOPE_MS = 4_000
const ID_CRM = /^[A-Za-z]\d{1,6}$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
export const NOTA_MAX = 300
// AAAA-MM-DD y que exista (2026-02-31 no): ida y vuelta por Date
const fechaReal = (f: string) => FECHA.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f

export const baseHitosConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()
const sql = (tope = TOPE_MS) => neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(tope) } })
// Para escribir: un tope POR CONSULTA y más largo (la primera anotación crea tablas y con Neon despertando 4 s compartidos entre
// las 5 consultas no alcanzaban: quedaba a medias con "No se pudo guardar"; revisión del Hub, 26/10/2026)
const TOPE_ESCRITURA_MS = 10_000
const sqlEscritura = (): ReturnType<typeof sql> => ((partes: TemplateStringsArray, ...valores: unknown[]) => sql(TOPE_ESCRITURA_MS)(partes, ...valores)) as ReturnType<typeof sql>
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "cj_hitos" does not exist/i.test((e as Error)?.message ?? '')
const dia = (x: unknown): string | null => {
  if (!x) return null
  if (typeof x === 'string' && FECHA.test(x.slice(0, 10))) return x.slice(0, 10)
  const d = x instanceof Date ? x : new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// Dos primeras anotaciones a la vez pueden correr el CREATE en paralelo: Postgres tira 23505 (pg_type) o 42P07; se toleran
const yaExiste = (e: unknown) => ['23505', '42P07'].includes((e as { code?: string })?.code ?? '')
async function crearTabla(q: ReturnType<typeof sql>): Promise<void> {
  for (const crear of [
    () => q`CREATE TABLE IF NOT EXISTS cj_hitos (
      id_crm text NOT NULL, hito text NOT NULL, fecha date, nota text NOT NULL DEFAULT '', quien text NOT NULL DEFAULT '',
      cuando timestamptz NOT NULL DEFAULT now(), borrado boolean NOT NULL DEFAULT false, PRIMARY KEY (id_crm, hito))`,
    // Historial: cada anotación, corrección o borrado queda registrado (la tabla de arriba guarda solo la vigente)
    () => q`CREATE TABLE IF NOT EXISTS cj_hitos_historial (
      id bigserial PRIMARY KEY, id_crm text NOT NULL, hito text NOT NULL, fecha date, nota text NOT NULL DEFAULT '',
      borrado boolean NOT NULL DEFAULT false, quien text NOT NULL DEFAULT '', cuando timestamptz NOT NULL DEFAULT now())`,
  ]) {
    try { await crear() } catch (e) { if (!yaExiste(e)) throw e }
  }
}

/** Todos los hitos anotados a mano, por cliente (IDs en mayúscula). */
export async function leerHitosManuales(): Promise<Map<string, HitoManual[]>> {
  const out = new Map<string, HitoManual[]>()
  if (!baseHitosConfigurada()) return out
  let filas: Record<string, unknown>[]
  try {
    filas = (await sql()`SELECT id_crm, hito, fecha::text AS fecha, nota, quien, cuando FROM cj_hitos WHERE NOT borrado`) as Record<string, unknown>[]
  } catch (e) {
    if (faltaTabla(e)) return out
    throw e
  }
  for (const f of filas) {
    const id = String(f.id_crm).toUpperCase(), hito = String(f.hito)
    if (!esClaveHito(hito)) continue
    const m: HitoManual = { hito, fecha: dia(f.fecha), nota: String(f.nota ?? ''), quien: String(f.quien ?? ''), cuando: f.cuando instanceof Date ? f.cuando.toISOString() : String(f.cuando ?? '') }
    out.set(id, [...(out.get(id) ?? []), m])
  }
  return out
}

export interface PedidoHito { hito: ClaveHito; fecha: string | null; nota: string; borrar: boolean }

/** Valida el cuerpo del POST. Devuelve el pedido o el motivo del rechazo. */
export function leerPedidoHito(x: unknown, hoy: string): PedidoHito | string {
  const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null
  if (!o || !esClaveHito(o.hito)) return 'Hito desconocido.'
  if (o.borrar === true) return { hito: o.hito, fecha: null, nota: '', borrar: true }
  const fecha = o.fecha === null || o.fecha === '' || o.fecha === undefined ? null : typeof o.fecha === 'string' && fechaReal(o.fecha) ? o.fecha : undefined
  if (fecha === undefined) return 'La fecha tiene que ser una fecha real (AAAA-MM-DD).'
  if (fecha && fecha > hoy) return 'La fecha no puede ser futura.'
  if (fecha && fecha < '2024-01-01') return 'La fecha es demasiado vieja.'
  const nota = typeof o.nota === 'string' ? o.nota.replace(/\s+/g, ' ').trim().slice(0, NOTA_MAX) : ''
  return { hito: o.hito, fecha, nota, borrar: false }
}

/** Anota (o borra) un hito de un cliente. */
export async function guardarHito(idCrm: string, p: PedidoHito, quien: string): Promise<void> {
  if (!ID_CRM.test(idCrm)) throw new Error('ID del CRM inválido')
  const id = idCrm.toUpperCase()
  const q = sqlEscritura()
  const escribir = () => p.borrar
    ? q`UPDATE cj_hitos SET borrado = true, quien = ${quien}, cuando = now() WHERE id_crm = ${id} AND hito = ${p.hito}`
    : q`INSERT INTO cj_hitos (id_crm, hito, fecha, nota, quien, cuando, borrado) VALUES (${id}, ${p.hito}, ${p.fecha}, ${p.nota}, ${quien}, now(), false)
        ON CONFLICT (id_crm, hito) DO UPDATE SET fecha = EXCLUDED.fecha, nota = EXCLUDED.nota, quien = EXCLUDED.quien, cuando = now(), borrado = false`
  const historial = () => q`INSERT INTO cj_hitos_historial (id_crm, hito, fecha, nota, borrado, quien) VALUES (${id}, ${p.hito}, ${p.fecha}, ${p.nota}, ${p.borrar}, ${quien})`
  try {
    await escribir()
  } catch (e) {
    if (!faltaTabla(e)) throw e
    await crearTabla(q)
    await escribir()
  }
  try { await historial() } catch (e) {
    if (!faltaTabla(e)) { console.error('[hitos] no se pudo guardar el historial:', String((e as Error)?.message ?? e).slice(0, 120)); return }
    await crearTabla(q)
    await historial().catch(() => { /* el historial no frena la anotación */ })
  }
}

// ── Etapa corregida a mano (tabla cj_etapas_manual) ──
// Pedido de Tomás ("Corregir etapa"): fijar a mano en qué etapa está un cliente cuando el registro automático no alcanza.
// Manda sobre la etapa automática hasta que se saca ("Volver a la automática"); Pausa y Baja las sigue decidiendo el CRM.
// Cada cambio queda también en cj_hitos_historial (hito = 'etapa').
export const ETAPAS_CORREGIBLES = ['alta', 'kickoff', 'guiones', 'grabacion', 'edicion', 'por_lanzar', 'lanzado', 'exito', 'renovacion'] as const
export type EtapaCorregible = (typeof ETAPAS_CORREGIBLES)[number]
export interface EtapaManual { etapa: EtapaCorregible; nota: string; quien: string; cuando: string }
const esEtapaCorregible = (v: unknown): v is EtapaCorregible => typeof v === 'string' && (ETAPAS_CORREGIBLES as readonly string[]).includes(v)
const faltaTablaEtapas = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "cj_etapas_manual" does not exist/i.test((e as Error)?.message ?? '')

async function crearTablaEtapas(q: ReturnType<typeof sql>): Promise<void> {
  try {
    await q`CREATE TABLE IF NOT EXISTS cj_etapas_manual (
      id_crm text PRIMARY KEY, etapa text NOT NULL, nota text NOT NULL DEFAULT '', quien text NOT NULL DEFAULT '',
      cuando timestamptz NOT NULL DEFAULT now(), borrado boolean NOT NULL DEFAULT false)`
  } catch (e) { if (!yaExiste(e)) throw e }
  await crearTabla(q)   // el historial
}

/** Las etapas fijadas a mano, por cliente (IDs en mayúscula). */
export async function leerEtapasManuales(): Promise<Map<string, EtapaManual>> {
  const out = new Map<string, EtapaManual>()
  if (!baseHitosConfigurada()) return out
  let filas: Record<string, unknown>[]
  try {
    filas = (await sql()`SELECT id_crm, etapa, nota, quien, cuando FROM cj_etapas_manual WHERE NOT borrado`) as Record<string, unknown>[]
  } catch (e) {
    if (faltaTablaEtapas(e)) return out
    throw e
  }
  for (const f of filas) {
    if (!esEtapaCorregible(f.etapa)) continue
    out.set(String(f.id_crm).toUpperCase(), { etapa: f.etapa, nota: String(f.nota ?? ''), quien: String(f.quien ?? ''), cuando: f.cuando instanceof Date ? f.cuando.toISOString() : String(f.cuando ?? '') })
  }
  return out
}

export interface PedidoEtapa { etapa: EtapaCorregible | null; nota: string }
/** { etapa: 'lanzado', nota } fija; { etapa: null } vuelve a la automática. */
export function leerPedidoEtapa(x: unknown): PedidoEtapa | string {
  const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null
  if (!o || !('etapa' in o)) return 'Falta la etapa.'
  if (o.etapa !== null && !esEtapaCorregible(o.etapa)) return 'Etapa desconocida (Pausa y Baja salen del CRM).'
  const nota = typeof o.nota === 'string' ? o.nota.replace(/\s+/g, ' ').trim().slice(0, NOTA_MAX) : ''
  return { etapa: o.etapa as EtapaCorregible | null, nota }
}

export async function guardarEtapa(idCrm: string, p: PedidoEtapa, quien: string): Promise<void> {
  if (!ID_CRM.test(idCrm)) throw new Error('ID del CRM inválido')
  const id = idCrm.toUpperCase()
  const q = sqlEscritura()
  const escribir = () => p.etapa === null
    ? q`UPDATE cj_etapas_manual SET borrado = true, quien = ${quien}, cuando = now() WHERE id_crm = ${id}`
    : q`INSERT INTO cj_etapas_manual (id_crm, etapa, nota, quien, cuando, borrado) VALUES (${id}, ${p.etapa}, ${p.nota}, ${quien}, now(), false)
        ON CONFLICT (id_crm) DO UPDATE SET etapa = EXCLUDED.etapa, nota = EXCLUDED.nota, quien = EXCLUDED.quien, cuando = now(), borrado = false`
  try { await escribir() } catch (e) {
    if (!faltaTablaEtapas(e)) throw e
    await crearTablaEtapas(q)
    await escribir()
  }
  const nota = p.etapa === null ? 'volvió a la automática' : `${p.etapa}${p.nota ? ` · ${p.nota}` : ''}`
  try {
    await q`INSERT INTO cj_hitos_historial (id_crm, hito, fecha, nota, borrado, quien) VALUES (${id}, 'etapa', ${null}, ${nota}, ${p.etapa === null}, ${quien})`
  } catch (e) {
    if (!faltaTabla(e)) { console.error('[hitos] historial de etapa:', String((e as Error)?.message ?? e).slice(0, 120)); return }
    await crearTabla(q)
    await q`INSERT INTO cj_hitos_historial (id_crm, hito, fecha, nota, borrado, quien) VALUES (${id}, 'etapa', ${null}, ${nota}, ${p.etapa === null}, ${quien})`.catch(() => {})
  }
}

// ── Lectura de todo lo anotado a mano (hitos + etapas), con pausa tras una falla que se puede reiniciar ──
// Revisión del Hub (26/10/2026): si la lectura fallaba, la cartera mostraba todo como automático sin avisar y lo recién
// anotado "desaparecía". Ahora quien lee avisa (EnVivo.tsx) y, como con Neon caído no conviene esperar el tope en cada
// carga, tras una falla hay un minuto sin consultar; un POST que guardó bien la reinicia (la base volvió).
const PAUSA_ANOTACIONES_MS = 60_000
let pausaAnotaciones = { hasta: 0, motivo: '' }
export const reiniciarPausaAnotaciones = (): void => { pausaAnotaciones = { hasta: 0, motivo: '' } }
export async function leerAnotaciones(): Promise<{ hitos: Map<string, HitoManual[]>; etapas: Map<string, EtapaManual> }> {
  if (Date.now() < pausaAnotaciones.hasta) throw new Error(pausaAnotaciones.motivo)
  try {
    const [hitos, etapas] = await Promise.all([leerHitosManuales(), leerEtapasManuales()])
    return { hitos, etapas }
  } catch (e) {
    pausaAnotaciones = { hasta: Date.now() + PAUSA_ANOTACIONES_MS, motivo: String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 140) }
    throw e
  }
}
