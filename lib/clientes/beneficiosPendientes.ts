// Cola durable del mes adicional para un nuevo cliente referido que cerró. El CRM sigue siendo la fuente.
import { neon } from '@neondatabase/serverless'
import { planillaActualizarReal } from './actualizarReferido'
import { aplicarBeneficioReferido } from './acciones/servidor'
import { leerClienteFresco } from './acciones/escritor'
import { finalizarBeneficio } from './beneficiosFinalizar'
import type { RespuestaAccion } from './acciones/tipos'

export interface BeneficioPendiente { idCrm: string; idReferido?: string; origen: 'alta' | 'referido'; quien: string }
const q = () => neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(10_000) } })
const idValido = (id: string) => /^[ACZ]\d{3,}$/.test(id)
let tabla: Promise<unknown> | null = null
function asegurarTabla() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('No se pudo registrar el beneficio pendiente')
  tabla ??= q()`CREATE TABLE IF NOT EXISTS cj_beneficios_referidos_pendientes (
    id_crm text PRIMARY KEY, id_referido text, origen text NOT NULL, quien text NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente', detalle text, creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now())`.catch(e => { tabla = null; throw e })
  return tabla
}
export function correspondeBeneficio(e: { estado?: unknown; idClienteNuevo?: unknown; reembolso?: unknown }, real: boolean): e is { estado: 'Cerró'; idClienteNuevo: string; reembolso?: unknown } {
  return real && e.estado === 'Cerró' && typeof e.idClienteNuevo === 'string' && idValido(e.idClienteNuevo.toUpperCase()) && e.reembolso !== true
}
export const beneficioConfirmado = (r: { status: number; cuerpo: RespuestaAccion }): boolean => r.status === 200 && r.cuerpo.ok && r.cuerpo.beneficioAplicado === true
export async function encolarBeneficio(p: BeneficioPendiente): Promise<void> {
  if (!idValido(p.idCrm.toUpperCase()) || (p.idReferido && !/^R\d{3,}$/.test(p.idReferido))) throw new Error('Cliente o referido inválido')
  await asegurarTabla()
  await q()`INSERT INTO cj_beneficios_referidos_pendientes (id_crm,id_referido,origen,quien)
    VALUES (${p.idCrm.toUpperCase()},${p.idReferido ?? null},${p.origen},${p.quien.slice(0,100)})
    ON CONFLICT (id_crm) DO UPDATE SET id_referido=EXCLUDED.id_referido,origen=EXCLUDED.origen,quien=EXCLUDED.quien,actualizado=now() WHERE cj_beneficios_referidos_pendientes.estado='pendiente'`
}
/** La cola se puede reservar antes de escribir el cierre; sólo se aplica si después la fuente confirma ese cierre. */
export async function verificarElegibilidad(p: BeneficioPendiente): Promise<boolean> {
  if (p.origen === 'referido' && p.idReferido) {
    const r = await planillaActualizarReal().leerFila(p.idReferido)
    return !!r && r.estado === 'Cerró' && !r.reembolso && r.idClienteNuevo.toUpperCase() === p.idCrm.toUpperCase()
  }
  const c = (await leerClienteFresco(p.idCrm)).cliente
  return /\breferid[oa]\b/i.test(c.fuente)
}
export async function procesarBeneficio(p: BeneficioPendiente) {
  if (!await verificarElegibilidad(p)) {
    await q()`UPDATE cj_beneficios_referidos_pendientes SET actualizado=now() WHERE id_crm=${p.idCrm.toUpperCase()} AND estado='pendiente'`
    return { ok: false, pendiente: true, mensaje: 'El cierre o la fuente del referido todavía no está confirmado.' }
  }
  const r = await aplicarBeneficioReferido(p.idCrm, p.idReferido ?? 'alta', p.quien)
  const listo = beneficioConfirmado(r)
  const detalle = r.cuerpo.mensaje ?? (listo ? 'Mes adicional incluido.' : 'El beneficio requiere revisión.')
  return finalizarBeneficio(p.idCrm, listo, detalle)
}
export async function procesarBeneficiosPendientes(limite = 10) {
  await asegurarTabla()
  const filas = await q()`SELECT id_crm,id_referido,origen,quien FROM cj_beneficios_referidos_pendientes WHERE estado='pendiente' ORDER BY actualizado ASC LIMIT ${Math.min(20, Math.max(1, limite))}` as Record<string, unknown>[]
  const resultados = []
  for (const f of filas) {
    const p: BeneficioPendiente = { idCrm: String(f.id_crm), idReferido: f.id_referido ? String(f.id_referido) : undefined, origen: f.origen === 'alta' ? 'alta' : 'referido', quien: String(f.quien) }
    try { resultados.push({ idCrm: p.idCrm, ...await procesarBeneficio(p) }) }
    catch {
      await q()`UPDATE cj_beneficios_referidos_pendientes SET actualizado=now() WHERE id_crm=${p.idCrm.toUpperCase()} AND estado='pendiente'`
      resultados.push({ idCrm: p.idCrm, ok: false, pendiente: true, mensaje: 'No se pudo comprobar el beneficio; se conserva el pedido.' })
    }
  }
  return resultados
}
