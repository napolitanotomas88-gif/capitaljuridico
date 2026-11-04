// ── Encuesta mensual de satisfacción SIN WhatsApp (4/11/2026). Puro: rondas, cruce con el CRM y lista de los que no contestaron ──
// Pedido de Tomás (4/11/2026): él manda a mano el Typeform «Encuesta mensual de satisfacción» (bnvnMvVn) a los clientes activos
// y marca en el Despacho (/clientes/encuesta) «encuesta enviada» con la fecha, para todos o para una selección. Cada marca es
// una RONDA de ese cliente y se cruza con las respuestas de la planilla del Typeform con las reglas del bot de Éxito
// (lib/bot/exito/rondas.ts): solo cuenta una respuesta posterior al envío y anterior al envío siguiente del mismo cliente.
//   · El envío vale desde las 00:00 (Argentina) del día marcado: Tomás marca DESPUÉS de mandar, y lo que contestaron en el medio
//     cuenta igual.
//   · Lo que no cruza con un único cliente (nombre, apellido y estudio: lib/seguimiento/typeform.ts) va a «sin asignar» y se
//     corrige a mano en el Despacho (asignar a un ID o descartar). También va ahí la respuesta de un cliente sin envío marcado.
//   · Una ronda vale 30 días; desde el día 3 sin respuesta entra en el aviso diario de 🛠️-operaciones. Nunca se le escribe al cliente.
import type { Encuesta } from '@/lib/bot/exito/almacen'
import { rondasVigentes, vinculos, type RespuestaEncuesta } from '@/lib/bot/exito/rondas'
import { diasEntre, ymdAFechaAR, type Ymd } from '../fechas'

export const PRIMER_AVISO_DIAS = 3
export const VIGENCIA_DIAS = 30
const ESTADOS_FUERA = new Set(['FINALIZADO', 'INACTIVO'])

export interface EnvioEncuesta { idCrm: string; dia: Ymd; por: string | null }
/** Corrección a mano de una respuesta: idCrm = a quién se asigna; null = descartada (prueba, duplicada, no es un cliente). */
export interface AsignacionEncuesta { clave: string; idCrm: string | null }
export interface ClienteEncuesta { id: string; nombre: string; responsable: string; estado: string }

export interface FilaEncuesta { id: string; nombre: string; responsable: string; enviada: Ymd; dias: number }
export interface Contesto extends FilaEncuesta { valor: number | null; respondidaEn: string }
export interface SinAsignar { clave: string; quien: string; valor: number | null; respondidaEn: string; motivo: string; sugerido: string | null }
export interface EstadoEncuesta { contestaron: Contesto[]; noContestaron: FilaEncuesta[]; sinAsignar: SinAsignar[]; promedio: number | null; total: number }

/** El instante desde el que cuenta un envío: las 00:00 de Argentina de ese día. */
export const inicioDelDia = (dia: Ymd): string => new Date(Date.parse(`${dia}T00:00:00-03:00`)).toISOString()

const aRonda = (e: EnvioEncuesta): Encuesta => ({
  id: `${e.dia}:${e.idCrm}`, mes: e.dia.slice(0, 7), clave: e.idCrm, idCrm: e.idCrm, cliente: e.idCrm, general: null, estado: 'enviada',
  enviadaEn: inicioDelDia(e.dia), mensajeId: null, recordatorioEn: null, recordatorioEstado: null, respondida: false, respuestaId: null,
  puntaje: null, respondidaEn: null, creado: inicioDelDia(e.dia),
})

/** Responsable para el seguimiento: el CSM del roster y, si no hay, el closer. */
export const responsableDe = (c: { csm?: string; closer?: string }): string => c.csm?.trim() || c.closer?.trim() || 'sin responsable'

export function estadoEncuesta(p: {
  envios: readonly EnvioEncuesta[]; respuestas: readonly RespuestaEncuesta[]; asignaciones: readonly AsignacionEncuesta[]
  clientes: readonly ClienteEncuesta[]; hoy: Ymd
}): EstadoEncuesta {
  const asignada = new Map(p.asignaciones.map((a) => [a.clave, a.idCrm?.toUpperCase() ?? null]))
  const respuestas = p.respuestas
    .filter((r) => asignada.get(r.clave) !== null)
    .map((r) => (asignada.has(r.clave) ? { ...r, idCliente: asignada.get(r.clave)!, motivo: null } : r))
  const envios = p.envios.map((e) => ({ ...e, idCrm: e.idCrm.toUpperCase() }))
  const rondas = envios.map(aRonda)
  const respuestaDe = new Map(vinculos(rondas, respuestas).map((v) => [v.ronda.id, v.respuesta]))
  const porId = new Map(p.clientes.map((c) => [c.id.toUpperCase(), c]))

  const contestaron: Contesto[] = [], noContestaron: FilaEncuesta[] = []
  let desde: string | null = null
  for (const r of rondasVigentes(rondas)) {
    const c = porId.get(r.idCrm!)
    const dia = r.id.slice(0, 10)
    const dias = diasEntre(dia, p.hoy)
    if (!c || ESTADOS_FUERA.has(c.estado) || dias < 0 || dias > VIGENCIA_DIAS) continue
    if (!desde || r.enviadaEn! < desde) desde = r.enviadaEn!
    const fila: FilaEncuesta = { id: c.id.toUpperCase(), nombre: c.nombre, responsable: c.responsable, enviada: dia, dias }
    const x = respuestaDe.get(r.id)
    if (x) contestaron.push({ ...fila, valor: x.valor, respondidaEn: x.enviadaEn })
    else noContestaron.push(fila)
  }

  // Sin asignar: respuestas de la ronda en curso que no quedaron en ninguna (no cruzan, o el cliente no tiene envío marcado).
  // La segunda respuesta de alguien que ya contestó no se muestra: no cambia nada.
  const usadas = new Set([...respuestaDe.values()].map((x) => x.clave))
  const yaContestaron = new Set(contestaron.map((c) => c.id))
  const sinAsignar: SinAsignar[] = !desde ? [] : respuestas
    .filter((r) => r.enviadaEn >= desde! && !usadas.has(r.clave) && !(r.idCliente && yaContestaron.has(r.idCliente.toUpperCase())))
    .map((r) => ({
      clave: r.clave, quien: r.quien, valor: r.valor, respondidaEn: r.enviadaEn, sugerido: r.idCliente,
      motivo: r.idCliente ? `${r.idCliente} no tiene la encuesta marcada como enviada` : r.motivo ?? 'No coincide con un único cliente',
    }))

  const valores = contestaron.map((c) => c.valor).filter((v): v is number => v !== null)
  const orden = (a: FilaEncuesta, b: FilaEncuesta) => b.dias - a.dias || a.id.localeCompare(b.id)
  return {
    contestaron: contestaron.sort(orden), noContestaron: noContestaron.sort(orden), sinAsignar: sinAsignar.sort((a, b) => a.respondidaEn.localeCompare(b.respondidaEn)),
    promedio: valores.length ? Math.round((valores.reduce((s, v) => s + v, 0) / valores.length) * 10) / 10 : null,
    total: contestaron.length + noContestaron.length,
  }
}

/** Los que entran en el aviso de hoy: sin respuesta desde hace PRIMER_AVISO_DIAS días o más. */
export const pendientesDeAviso = (e: EstadoEncuesta): FilaEncuesta[] => e.noContestaron.filter((f) => f.dias >= PRIMER_AVISO_DIAS)

const MAX_BLOQUE = 1_500

/** El aviso de 🛠️-operaciones: resumen + la lista (una línea por cliente) partida en bloques que entran en un mensaje. */
export function avisoPendientes(e: EstadoEncuesta): { titulo: string; lineas: string[]; bloques: string[] } | null {
  const pend = pendientesDeAviso(e)
  if (!pend.length) return null
  const lineas = [
    `Contestaron ${e.contestaron.length} de ${e.total}${e.promedio !== null ? ` · promedio ${String(e.promedio).replace('.', ',')}` : ''}`,
    `Sin contestar desde hace ${PRIMER_AVISO_DIAS} días o más: ${pend.length}`,
    ...(e.sinAsignar.length ? [`Respuestas sin asignar: ${e.sinAsignar.length} (asignalas en el Despacho)`] : []),
  ]
  const bloques: string[] = []
  let actual = ''
  for (const f of pend) {
    const l = `${f.id} · ${f.nombre} · ${f.responsable} · ${f.dias} días (enviada el ${ymdAFechaAR(f.enviada).replace(/\/\d{4}$/, '')})`
    if (actual && actual.length + l.length + 1 > MAX_BLOQUE) { bloques.push(actual); actual = '' }
    actual = actual ? `${actual}\n${l}` : l
  }
  if (actual) bloques.push(actual)
  return { titulo: `Encuesta mensual: ${pend.length} sin contestar`, lineas, bloques }
}
