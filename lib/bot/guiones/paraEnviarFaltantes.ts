// ── El «para enviar» de los guiones aprobados, SÍ O SÍ (Tomás, 3/11/2026). Solo servidor ──────────────────────────────────
// «Cada vez que Faus haga las correcciones y marque como listo el guion, enviá el mensaje a 📤-para-enviar-al-cliente avisando
// que ya está listo para enviar, SÍ O SÍ, porque si no nunca le llega al cliente nada y no sabemos en qué parte está».
// El check final ya lo deja (publicacion.ts → guionesParaEnviar), aunque falle el Doc. Esto es la red: el vigía (cada 15 min)
// busca tandas «aprobada» de los últimos DIAS_RED días con más de MIN_EDAD_MIN minutos desde el check final y sin su «para
// enviar» (ni pendiente ni de esta aprobación), y lo crea. Si el Doc no quedó bien, sale con la advertencia. La misma función,
// con otra fecha, hizo el barrido inicial (aprobadas desde el 24/10/2026, Tomás lo limitó a 10 días).
import type { FilaTanda } from './registro'
import { claveD02, problemaDelDoc, type ProblemaDoc } from './whatsappCliente'

export const DIAS_RED = 10
/** Margen para no pisarse con la publicación en curso (dura hasta ~4 min; la reserva vence a los 7). */
export const MIN_EDAD_MIN = 20

export interface DepsFaltantes {
  aprobadas(desde: string, hasta: string): Promise<FilaTanda[]>
  existentes(tandaId: number): Promise<{ clave: string; estado: string }[]>
  crear(fila: FilaTanda, problema: ProblemaDoc | null): Promise<{ estado: string; motivo?: string }>
}

export interface Faltante { id: number; id_crm: string | null; cliente: string | null; tanda: number; aprobada: string; problema: string | null; estado?: string }

/** Una vuelta. Nunca tira: lo que falle queda en `errores`. */
export async function crearParaEnviarFaltantes(deps: DepsFaltantes, op: { desde?: string; ahora?: Date; dry?: boolean } = {}) {
  const ahora = op.ahora ?? new Date()
  const desde = op.desde ?? new Date(ahora.getTime() - DIAS_RED * 86_400_000).toISOString()
  const hasta = new Date(ahora.getTime() - MIN_EDAD_MIN * 60_000).toISOString()
  const out = { faltantes: [] as Faltante[], errores: [] as string[] }
  let filas: FilaTanda[] = []
  try { filas = await deps.aprobadas(desde, hasta) } catch (e) { out.errores.push(`leer: ${(e as Error)?.message?.slice(0, 120)}`); return out }
  for (const f of filas) {
    try {
      const previos = await deps.existentes(f.id)
      if (previos.some(m => m.estado === 'para_enviar' || m.clave === `d02:${claveD02(f)}`)) continue
      const problema = problemaDelDoc(f)
      const x: Faltante = { id: f.id, id_crm: f.id_crm, cliente: f.cliente, tanda: f.doc?.tanda ?? f.tanda, aprobada: f.aprobacion!.cuando, problema: problema?.motivo ?? null }
      if (!op.dry) x.estado = (await deps.crear(f, problema)).estado
      out.faltantes.push(x)
    } catch (e) { out.errores.push(`${f.id_crm ?? f.id}: ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 120)}`) }
  }
  return out
}

/** Con las dependencias reales (Neon + 📤). */
export async function crearParaEnviarFaltantesReal(op: { desde?: string; dry?: boolean } = {}) {
  const reg = await import('./registro')
  if (!reg.baseConfigurada()) return { faltantes: [], errores: [] }
  const { d02DeTanda } = await import('../canal/registro')
  const { guionesParaEnviar } = await import('./whatsappCliente')
  const { exigirClienteNoArchivado } = await import('@/lib/clientes/archivados')
  return crearParaEnviarFaltantes({
    aprobadas: reg.tandasAprobadasEntre,
    existentes: d02DeTanda,
    crear: async (f, problema) => { await exigirClienteNoArchivado(f.id_crm); return guionesParaEnviar(f, new Date(), problema) },
  }, op)
}
