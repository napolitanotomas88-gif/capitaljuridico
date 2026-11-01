// ── Bot "Capital Jurídico": etapa ÉXITO — estado (contrato del almacén + versión en memoria para los tests) ────────────────
// La versión real va en Neon (almacenNeon.ts, tablas cj_exito_*). Reglas que el almacén GARANTIZA (no solo el núcleo):
//   · un solo pedido abierto por cliente: crearPedido devuelve false si ya hay uno 'abierto', 'aprobado' o 'dudoso'
//     (en Neon, índice único parcial);
//   · cada señal (un mensaje o una respuesta de la encuesta) se reclama una sola vez (reclamarSenal);
//   · cada pedido reconoce UN testimonio (reclamarTestimonio: solo si testimonio_mensaje está vacío);
//   · cada encuesta del mes por cliente se reclama una sola vez (reclamarEncuesta).
import { ENFRIAMIENTO_ENVIADO_MS, ENFRIAMIENTO_NO_MS } from './config'
import type { GrupoCliente, MotivoExito } from './textos'

export type EstadoPedido =
  | 'abierto'            // pedido en Verificaciones (o reporte de ensayo), esperando OK / NO
  | 'aprobado'           // OK recibido, el mensaje al cliente se está mandando
  | 'enviado'            // el mensaje de testimonio salió al General
  | 'dudoso'             // Whapi no confirmó el envío al cliente (pudo haber salido): cuenta como enviado
  | 'aprobado_simulado'  // OK en ensayo (o sin la capacidad exito_mensaje_cliente): no salió nada al cliente
  | 'rechazado'          // NO
  | 'vencido'            // 14 días sin respuesta
  | 'error'              // falló el envío al cliente (seguro que no salió)
export const PEDIDO_ABIERTO: readonly EstadoPedido[] = ['abierto', 'aprobado', 'dudoso']

export interface Pedido {
  id: string; clave: string; cliente: string; idCrm: string | null; general: string; invitacion: string | null
  motivo: MotivoExito; modo: string; estado: EstadoPedido
  mensajePedidoId: string | null; huella: string; por: string | null; respuesta: string | null; mensajeClienteId: string | null
  resuelto: string | null; testimonioMensaje: string | null; testimonioEn: string | null; error: string | null
  creado: string; actualizado: string
}
export type PedidoNuevo = Omit<Pedido, 'estado' | 'por' | 'respuesta' | 'mensajeClienteId' | 'resuelto' | 'testimonioMensaje' | 'testimonioEn' | 'error' | 'actualizado'>

export type EstadoSenal = 'reclamada' | 'exito' | 'no' | 'error' | 'bloqueado' | 'tope' | 'consultada' | 'asignada' | 'descartada'
export interface Senal { id: string; tipo: 'mensaje' | 'encuesta' | 'dudosa'; clave: string; chatId: string | null; estado: EstadoSenal; detalle: Record<string, unknown>; creado: string }

export interface Testimonio {
  mensajeId: string; pedidoId: string; clave: string; chatId: string; grupo: GrupoCliente
  medio: Record<string, unknown>; enviadoEn: string; estado: string; agradecimientoId: string | null; discordId: string | null; creado: string
}

/** Una RONDA de la encuesta mensual de un cliente (id "<AAAA-MM>:<ID del CRM>"). La respuesta vinculada es la primera con
 *  submitted_at posterior al envío de esta ronda y anterior al envío de la siguiente ronda del mismo cliente. */
export interface Encuesta {
  id: string; mes: string; clave: string; idCrm: string | null; cliente: string; general: string | null
  estado: string; enviadaEn: string | null; mensajeId: string | null; recordatorioEn: string | null; recordatorioEstado: string | null
  respondida: boolean; respuestaId: string | null; puntaje: number | null; respondidaEn: string | null; creado: string
}
export type EncuestaNueva = Omit<Encuesta, 'creado' | 'respuestaId' | 'puntaje' | 'respondidaEn'>

/** El lote de la encuesta de un mes: la lista que se publicó en Verificaciones y lo que respondieron. Solo con el OK sale. */
export type EstadoLote = 'pedido' | 'aprobado' | 'rechazado' | 'completo'
export interface ClienteLote { id: string; nombre: string; general: string }
export interface Lote {
  mes: string; estado: EstadoLote; modo: string; clientes: ClienteLote[]; excluidos: string[]; sinGrupo: string[]
  mensajeId: string | null; huella: string; por: string | null; aprobadoEn: string | null; creado: string
}

export type Bloqueo = { motivo: 'abierto' | 'enviado_reciente' | 'reciente'; pedido: Pedido } | null

export interface AlmacenExito {
  reclamarSenal(s: Omit<Senal, 'creado' | 'estado'>, ahora: string): Promise<boolean>
  marcarSenal(id: string, estado: EstadoSenal, detalle?: Record<string, unknown>): Promise<void>
  evaluadasDesde(clave: string, desde: string): Promise<number>
  /** Señales de mensajes y de la encuesta (no las dudosas) desde `desde` (ISO), para el medidor (h01). */
  senalesDesde(desde: string): Promise<Senal[]>
  bloqueo(clave: string, ahora: number): Promise<Bloqueo>
  crearPedido(p: PedidoNuevo): Promise<boolean>
  /** Cambia un pedido si está en uno de `siEstado` (si se pasa). Devuelve si cambió. */
  actualizarPedido(id: string, cambios: Partial<Pedido>, siEstado?: readonly EstadoPedido[]): Promise<boolean>
  pedido(id: string): Promise<Pedido | null>
  pedidoPorMensaje(mensajeId: string): Promise<Pedido | null>
  pedidoSinIdPorHuella(huella: string, desde: string): Promise<Pedido | null>
  pedidosAbiertosAntesDe(antes: string): Promise<Pedido[]>
  /** El último pedido del cliente que mandó (o simuló) el mensaje de testimonio desde `desde` y todavía sin testimonio. */
  pedidoParaTestimonio(clave: string, desde: string): Promise<Pedido | null>
  reclamarTestimonio(pedidoId: string, mensajeId: string, ahora: string): Promise<boolean>
  guardarTestimonio(t: Testimonio): Promise<void>
  actualizarTestimonio(mensajeId: string, cambios: Partial<Testimonio>): Promise<void>
  reclamarEncuesta(e: EncuestaNueva, ahora: string): Promise<boolean>
  actualizarEncuesta(id: string, cambios: Partial<Encuesta>): Promise<void>
  encuestasDelMes(mes: string): Promise<Encuesta[]>
  /** Todas las rondas enviadas (sin los reportes de ensayo) desde `desde` (ISO). */
  rondasDesde(desde: string): Promise<Encuesta[]>
  /** Vincula la respuesta a la ronda si todavía no tiene una. Devuelve si la vinculó. */
  vincularRespuesta(rondaId: string, r: { respuestaId: string; puntaje: number | null; respondidaEn: string }): Promise<boolean>
  lote(mes: string): Promise<Lote | null>
  crearLote(l: Omit<Lote, 'estado' | 'excluidos' | 'por' | 'aprobadoEn'>): Promise<boolean>
  actualizarLote(mes: string, cambios: Partial<Lote>, siEstado?: readonly EstadoLote[]): Promise<boolean>
  lotePorMensaje(mensajeId: string): Promise<Lote | null>
  loteSinIdPorHuella(huella: string): Promise<Lote | null>
  /** Respuestas dudosas consultadas en Verificaciones. */
  dudosaPorMensaje(mensajeId: string): Promise<Senal | null>
  dudosaSinIdPorHuella(huella: string): Promise<Senal | null>
  /** Respuestas dudosas que un aprobador asignó a un cliente: clave de la respuesta → ID del CRM. */
  asignaciones(): Promise<Map<string, string>>
  listarPedidos(limite: number): Promise<Pedido[]>
  listarTestimonios(limite: number): Promise<Testimonio[]>
}

/** Regla de bloqueo (pura, la usan las dos versiones): abierto, enviado hace menos de 60 días, o NO / ensayo hace menos de 30. */
export function bloqueoDe(pedidos: readonly Pedido[], ahora: number): Bloqueo {
  const ordenados = [...pedidos].sort((a, b) => b.creado.localeCompare(a.creado))
  const abierto = ordenados.find((p) => p.estado === 'abierto' || p.estado === 'aprobado')
  if (abierto) return { motivo: 'abierto', pedido: abierto }
  for (const p of ordenados) {
    const t = Date.parse(p.resuelto ?? p.actualizado)
    if ((p.estado === 'enviado' || p.estado === 'dudoso') && ahora - t < ENFRIAMIENTO_ENVIADO_MS) return { motivo: 'enviado_reciente', pedido: p }
    if ((p.estado === 'rechazado' || p.estado === 'aprobado_simulado') && ahora - t < ENFRIAMIENTO_NO_MS) return { motivo: 'reciente', pedido: p }
  }
  return null
}

const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

export function almacenExitoEnMemoria(): AlmacenExito & { _pedidos: Pedido[]; _senales: Senal[]; _testimonios: Testimonio[]; _encuestas: Encuesta[]; _lotes: Lote[] } {
  const pedidos: Pedido[] = [], senales: Senal[] = [], testimonios: Testimonio[] = [], encuestas: Encuesta[] = [], lotes: Lote[] = []
  const ahoraIso = () => new Date().toISOString()
  return {
    _pedidos: pedidos, _senales: senales, _testimonios: testimonios, _encuestas: encuestas, _lotes: lotes,
    async lote(mes) { const l = lotes.find((x) => x.mes === mes); return l ? copia(l) : null },
    async crearLote(l) {
      if (lotes.some((x) => x.mes === l.mes)) return false
      lotes.push({ ...copia(l), estado: 'pedido', excluidos: [], por: null, aprobadoEn: null })
      return true
    },
    async actualizarLote(mes, cambios, siEstado) {
      const l = lotes.find((x) => x.mes === mes)
      if (!l || (siEstado && !siEstado.includes(l.estado))) return false
      Object.assign(l, copia(cambios))
      return true
    },
    async lotePorMensaje(mensajeId) { const l = lotes.find((x) => x.mensajeId === mensajeId); return l ? copia(l) : null },
    async loteSinIdPorHuella(huella) { const l = lotes.find((x) => !x.mensajeId && x.huella === huella && x.estado === 'pedido'); return l ? copia(l) : null },
    async reclamarSenal(s, ahora) {
      if (senales.some((x) => x.id === s.id)) return false
      senales.push({ ...copia(s), estado: 'reclamada', creado: ahora })
      return true
    },
    async marcarSenal(id, estado, detalle) {
      const s = senales.find((x) => x.id === id)
      if (s) { s.estado = estado; if (detalle) s.detalle = { ...s.detalle, ...copia(detalle) } }
    },
    async evaluadasDesde(clave, desde) {
      return senales.filter((s) => s.clave === clave && s.tipo === 'mensaje' && ['exito', 'no', 'error'].includes(s.estado) && s.creado >= desde).length
    },
    async senalesDesde(desde) {
      return copia(senales.filter((s) => (s.tipo === 'mensaje' || s.tipo === 'encuesta') && s.creado >= desde))
    },
    async bloqueo(clave, ahora) {
      return bloqueoDe(pedidos.filter((p) => p.clave === clave), ahora)
    },
    async crearPedido(p) {
      if (pedidos.some((x) => x.id === p.id || (x.clave === p.clave && PEDIDO_ABIERTO.includes(x.estado) && x.estado !== 'dudoso'))) return false
      pedidos.push({ ...copia(p), estado: 'abierto', por: null, respuesta: null, mensajeClienteId: null, resuelto: null, testimonioMensaje: null, testimonioEn: null, error: null, actualizado: p.creado })
      return true
    },
    async actualizarPedido(id, cambios, siEstado) {
      const p = pedidos.find((x) => x.id === id)
      if (!p || (siEstado && !siEstado.includes(p.estado))) return false
      Object.assign(p, copia(cambios), { actualizado: ahoraIso() })
      return true
    },
    async pedido(id) { const p = pedidos.find((x) => x.id === id); return p ? copia(p) : null },
    async pedidoPorMensaje(mensajeId) { const p = pedidos.find((x) => x.mensajePedidoId === mensajeId); return p ? copia(p) : null },
    async pedidoSinIdPorHuella(huella, desde) {
      const p = pedidos.filter((x) => !x.mensajePedidoId && x.huella === huella && x.creado >= desde && x.estado === 'abierto').sort((a, b) => b.creado.localeCompare(a.creado))[0]
      return p ? copia(p) : null
    },
    async pedidosAbiertosAntesDe(antes) { return copia(pedidos.filter((x) => x.estado === 'abierto' && x.creado < antes)) },
    async pedidoParaTestimonio(clave, desde) {
      const p = pedidos.filter((x) => x.clave === clave && ['enviado', 'dudoso', 'aprobado_simulado'].includes(x.estado) && (x.resuelto ?? '') >= desde && !x.testimonioMensaje)
        .sort((a, b) => (b.resuelto ?? '').localeCompare(a.resuelto ?? ''))[0]
      return p ? copia(p) : null
    },
    async reclamarTestimonio(pedidoId, mensajeId, ahora) {
      const p = pedidos.find((x) => x.id === pedidoId)
      if (!p || p.testimonioMensaje) return false
      p.testimonioMensaje = mensajeId; p.testimonioEn = ahora
      return true
    },
    async guardarTestimonio(t) { if (!testimonios.some((x) => x.mensajeId === t.mensajeId)) testimonios.push(copia(t)) },
    async actualizarTestimonio(mensajeId, cambios) { const t = testimonios.find((x) => x.mensajeId === mensajeId); if (t) Object.assign(t, copia(cambios)) },
    async reclamarEncuesta(e, ahora) {
      if (encuestas.some((x) => x.id === e.id)) return false
      encuestas.push({ ...copia(e), respuestaId: null, puntaje: null, respondidaEn: null, creado: ahora })
      return true
    },
    async rondasDesde(desde) { return copia(encuestas.filter((e) => e.clave !== '__reporte' && !!e.enviadaEn && e.enviadaEn >= desde)) },
    async vincularRespuesta(rondaId, r) {
      const e = encuestas.find((x) => x.id === rondaId)
      if (!e || e.respuestaId) return false
      Object.assign(e, { respuestaId: r.respuestaId, puntaje: r.puntaje, respondidaEn: r.respondidaEn, respondida: true })
      return true
    },
    async dudosaPorMensaje(mensajeId) { const x = senales.find((s) => s.tipo === 'dudosa' && s.detalle.mensajeId === mensajeId); return x ? copia(x) : null },
    async dudosaSinIdPorHuella(huella) { const x = senales.find((s) => s.tipo === 'dudosa' && s.estado === 'consultada' && !s.detalle.mensajeId && s.detalle.huella === huella); return x ? copia(x) : null },
    async asignaciones() { return new Map(senales.filter((s) => s.tipo === 'dudosa' && s.estado === 'asignada' && typeof s.detalle.idCliente === 'string').map((s) => [String(s.detalle.respuesta), String(s.detalle.idCliente)])) },
    async actualizarEncuesta(id, cambios) { const e = encuestas.find((x) => x.id === id); if (e) Object.assign(e, copia(cambios)) },
    async encuestasDelMes(mes) { return copia(encuestas.filter((e) => e.mes === mes)) },
    async listarPedidos(limite) { return copia([...pedidos].sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, limite)) },
    async listarTestimonios(limite) { return copia([...testimonios].sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, limite)) },
  }
}
