// ── Continuidad: lo anotado de la llamada de proyección (Neon, cj_proyeccion). SOLO servidor ────────────────────────────
// Una fila por cliente y fin de ciclo con tres datos que se marcan por separado desde la tarjeta o el panel «Pendientes de
// llamada de proyección» (y el cron, cuando la ve en Calendly):
//   · avisado (fecha): se le avisó que vamos a tener la llamada. También lo marca el «Enviado» de la invitación en 📤.
//   · agendada (fecha de la llamada) + fuente (manual / calendly).
//   · resultado: hecha / no_se_dio (con fecha).
// Cada dato se puede quitar (null). La tabla se crea sola con la primera marca; sin tabla, la lectura devuelve [] (no es una
// falla). Se suman las acciones «Llamada de proyección» de la tarjeta (cj_cliente_acciones, aplicadas): link enviado =
// avisado, agendada, hecha. Sin mails: quien marcó se guarda con su nombre corto.
import { neon } from '@neondatabase/serverless'
import type { FuenteAgenda, MarcaProyeccion, Resultado } from './reglas'

const ID_CRM = /^[A-Za-z]\d{1,6}$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
export const fechaReal = (f: string) => FECHA.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f

export const baseProyeccionConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()
const sql = (tope = 6_000) => neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(tope) } })
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "cj_\w+" does not exist/i.test((e as Error)?.message ?? '')
const yaExiste = (e: unknown) => ['23505', '42P07'].includes((e as { code?: string })?.code ?? '')
const dia = (x: unknown): string | null => {
  if (!x) return null
  if (typeof x === 'string' && FECHA.test(x.slice(0, 10))) return x.slice(0, 10)
  const d = x instanceof Date ? x : new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const diaAR = (x: unknown): string | null => {
  const d = x instanceof Date ? x : new Date(String(x ?? ''))
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

export type CampoMarca = 'avisado' | 'agendada' | 'resultado'
export interface PedidoMarca { fin: string; campo: CampoMarca; fecha: string | null; resultado: Resultado | null }

/** Valida el cuerpo del POST: { fin, campo: 'avisado'|'agendada'|'resultado', fecha|null, resultado?: 'hecha'|'no_se_dio' }.
 *  fecha null = quitar ese dato. Devuelve el texto del error si no sirve. */
export function leerPedidoMarca(cuerpo: unknown, hoy: string): PedidoMarca | string {
  const o = (cuerpo ?? {}) as Record<string, unknown>
  const fin = typeof o.fin === 'string' ? o.fin : ''
  if (!fechaReal(fin)) return 'Falta el fin del programa.'
  const campo = o.campo
  if (campo !== 'avisado' && campo !== 'agendada' && campo !== 'resultado') return 'Dato inválido (avisado, agendada o resultado).'
  const fecha = o.fecha === null || o.fecha === undefined || o.fecha === '' ? null : String(o.fecha)
  if (fecha !== null && !fechaReal(fecha)) return 'Fecha inválida.'
  if (fecha && fecha < '2024-01-01') return 'Fecha inválida.'
  let resultado: Resultado | null = null
  if (campo === 'resultado' && fecha !== null) {
    if (o.resultado !== 'hecha' && o.resultado !== 'no_se_dio') return 'Resultado inválido (hecha o no_se_dio).'
    resultado = o.resultado
    if (fecha > hoy) return 'La llamada no puede estar hecha (o no darse) en una fecha futura.'
  }
  if (campo === 'avisado' && fecha && fecha > hoy) return 'El aviso no puede tener una fecha futura.'
  return { fin, campo, fecha, resultado }
}

/** Todas las marcas: las de cj_proyeccion y las acciones «Llamada de proyección» aplicadas (IDs en mayúscula). */
export async function leerMarcasProyeccion(): Promise<MarcaProyeccion[]> {
  if (!baseProyeccionConfigurada()) return []
  const [propias, acciones] = await Promise.all([leerPropias(), leerAcciones()])
  return [...propias, ...acciones]
}

async function leerPropias(): Promise<MarcaProyeccion[]> {
  try {
    const filas = (await sql()`SELECT id_crm, fin::text AS fin, avisado::text AS avisado, agendada::text AS agendada, agendada_fuente, resultado,
      resultado_fecha::text AS resultado_fecha, quien, cuando FROM cj_proyeccion`) as Record<string, unknown>[]
    return filas.flatMap((f) => {
      const fin = dia(f.fin)
      if (!fin) return []
      const res = String(f.resultado ?? '')
      const fuente = String(f.agendada_fuente ?? '')
      return [{
        idCrm: String(f.id_crm).toUpperCase(), fin, avisado: dia(f.avisado), agendada: dia(f.agendada),
        agendadaFuente: (['manual', 'calendly', 'accion'].includes(fuente) ? fuente : null) as FuenteAgenda | null,
        resultado: res === 'hecha' || res === 'no_se_dio' ? res : null, resultadoFecha: dia(f.resultado_fecha),
        quien: String(f.quien ?? ''), cuando: f.cuando instanceof Date ? f.cuando.toISOString() : String(f.cuando ?? ''),
      }]
    })
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

async function leerAcciones(): Promise<MarcaProyeccion[]> {
  try {
    const filas = (await sql()`SELECT id_crm, datos, quien, creada FROM cj_cliente_acciones
      WHERE tipo = 'proyeccion' AND estado = 'aplicada' AND anulada IS NULL ORDER BY creada DESC LIMIT 500`) as Record<string, unknown>[]
    return filas.flatMap((f): MarcaProyeccion[] => {
      const d = (f.datos ?? {}) as { estado?: string; fecha?: string }
      const creada = diaAR(f.creada)
      const fecha = typeof d.fecha === 'string' && fechaReal(d.fecha) ? d.fecha : creada
      if (!creada || !fecha) return []
      const quien = String(f.quien ?? '').split('@')[0]
      const base: MarcaProyeccion = { idCrm: String(f.id_crm).toUpperCase(), fin: null, ref: creada, avisado: null, agendada: null, agendadaFuente: null, resultado: null, resultadoFecha: null, quien, cuando: f.creada instanceof Date ? f.creada.toISOString() : String(f.creada ?? '') }
      if (d.estado === 'link_enviado') return [{ ...base, avisado: fecha }]
      if (d.estado === 'agendada') return [{ ...base, agendada: fecha, agendadaFuente: 'accion' as const }]
      if (d.estado === 'hecha') return [{ ...base, resultado: 'hecha' as const, resultadoFecha: fecha }]
      return []
    })
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

async function crearTabla(q: ReturnType<typeof sql>): Promise<void> {
  try {
    await q`CREATE TABLE IF NOT EXISTS cj_proyeccion (
      id_crm text NOT NULL, fin date NOT NULL, avisado date, agendada date, agendada_fuente text, resultado text, resultado_fecha date,
      quien text NOT NULL DEFAULT '', cuando timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id_crm, fin))`
  } catch (e) { if (!yaExiste(e)) throw e }
}

/** Marca (o quita, con fecha null) un dato de la llamada de proyección de un cliente para ese fin. */
export async function guardarMarcaProyeccion(idCrm: string, p: PedidoMarca, quien: string, fuente: 'manual' | 'calendly' = 'manual'): Promise<void> {
  if (!ID_CRM.test(idCrm)) throw new Error('ID inválido')
  const q = sql(10_000)
  await crearTabla(q)
  const id = idCrm.toUpperCase()
  const nombre = quien.slice(0, 60)
  await q`INSERT INTO cj_proyeccion (id_crm, fin, quien) VALUES (${id}, ${p.fin}, ${nombre}) ON CONFLICT (id_crm, fin) DO NOTHING`
  if (p.campo === 'avisado') await q`UPDATE cj_proyeccion SET avisado = ${p.fecha}, quien = ${nombre}, cuando = now() WHERE id_crm = ${id} AND fin = ${p.fin}`
  else if (p.campo === 'agendada') await q`UPDATE cj_proyeccion SET agendada = ${p.fecha}, agendada_fuente = ${p.fecha ? fuente : null}, quien = ${nombre}, cuando = now() WHERE id_crm = ${id} AND fin = ${p.fin}`
  else await q`UPDATE cj_proyeccion SET resultado = ${p.fecha ? p.resultado : null}, resultado_fecha = ${p.fecha}, quien = ${nombre}, cuando = now() WHERE id_crm = ${id} AND fin = ${p.fin}`
}

/** «Enviado» de la invitación en 📤: avisado = hoy, si todavía no estaba. Nunca pisa una fecha anotada. */
export async function marcarAvisadoSiFalta(idCrm: string, fin: string, hoy: string, quien: string): Promise<boolean> {
  if (!ID_CRM.test(idCrm) || !fechaReal(fin) || !fechaReal(hoy)) return false
  const q = sql(8_000)
  await crearTabla(q)
  const r = await q`INSERT INTO cj_proyeccion (id_crm, fin, avisado, quien) VALUES (${idCrm.toUpperCase()}, ${fin}, ${hoy}, ${quien.slice(0, 60)})
    ON CONFLICT (id_crm, fin) DO UPDATE SET avisado = EXCLUDED.avisado, quien = EXCLUDED.quien, cuando = now() WHERE cj_proyeccion.avisado IS NULL RETURNING id_crm`
  return r.length > 0
}
