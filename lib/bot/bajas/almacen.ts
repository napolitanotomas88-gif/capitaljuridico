// ── Bot "Capital Jurídico": etapa BAJA — estado (contrato del almacén + versión en memoria para los tests) ────────────────
// La versión real va en Neon (almacenNeon.ts, tablas cj_bajas_*). Reglas que el almacén GARANTIZA (no solo el núcleo):
//   · cada pedido tiene un id determinístico: el aviso de fin es "aviso:<ID>:<fin>", así un mismo período nunca se pide dos
//     veces (crearPedido devuelve false si el id ya existe);
//   · un solo pedido abierto por cliente y por tipo (en Neon, índice único parcial);
//   · cada grabación de Fathom se reclama una sola vez (reclamarLlamada), salvo que haya quedado 'cortada' o en 'error':
//     ahí se puede reintentar. El pedido de baja tiene id fijo por grabación ("baja:<ID>:f<recording_id>"), así que un
//     reintento nunca manda dos veces;
//   · una sola baja por id (crearBaja) y una sola lista de recontacto por mes (reclamarRecontacto).
import type { OrigenBaja } from './textos'

export type TipoPedido = 'aviso_fin' | 'confirmar_baja' | 'despedida' | 'pausar_meta'
export type EstadoPedido =
  | 'abierto'            // pedido en Verificaciones (o reporte de ensayo), esperando OK / NO
  | 'aprobado'           // OK recibido, se está ejecutando
  | 'enviado'            // hecho (el mensaje salió / la baja quedó confirmada)
  | 'dudoso'             // Whapi no confirmó el envío (pudo haber salido)
  | 'aprobado_simulado'  // OK en ensayo (o sin la capacidad): no salió nada
  | 'rechazado'          // NO
  | 'vencido'            // 14 días sin respuesta
  | 'error'              // falló (seguro que no salió)

export interface Pedido {
  id: string; tipo: TipoPedido; clave: string; cliente: string; idCrm: string; general: string | null; fin: string | null
  modo: string; estado: EstadoPedido; mensajePedidoId: string | null; huella: string
  por: string | null; respuesta: string | null; mensajeClienteId: string | null
  detalle: Record<string, unknown>; resuelto: string | null; error: string | null; creado: string; actualizado: string
}
export type PedidoNuevo = Omit<Pedido, 'estado' | 'por' | 'respuesta' | 'mensajeClienteId' | 'resuelto' | 'error' | 'actualizado'>

export type EstadoPaso = 'hecho' | 'simulado' | 'error' | 'dudoso' | 'omitido' | 'pendiente'
export interface PasoBaja { estado: EstadoPaso; detalle: string; en: string }
export type NombrePaso = 'crm' | 'skool' | 'drive' | 'meta' | 'despedida' | 'grupos' | 'comunidad'

/** Una baja CONFIRMADA (con el OK humano). Los pasos guardan qué se hizo de cada cosa. */
export interface Baja {
  id: string; clave: string; idCrm: string; cliente: string; general: string | null; mail: string
  motivo: string; origen: OrigenBaja; por: string; modo: string; confirmada: string
  pasos: Partial<Record<NombrePaso, PasoBaja>>; creado: string
}

/** 'cortada' (se acabó el tiempo de la invocación) y 'error' se pueden volver a reclamar: quedan para reintentar. */
export type EstadoLlamada = 'reclamada' | 'sin_cliente' | 'clasificada' | 'cortada' | 'error'
export const LLAMADA_REINTENTABLE: readonly EstadoLlamada[] = ['cortada', 'error']
export interface Llamada {
  recordingId: number; clave: string | null; cliente: string | null; fecha: string | null; estado: EstadoLlamada
  decision: string | null; confianza: string | null; cita: string | null; motivo: string | null; motivoBaja: string | null
  url: string | null; pedidoId: string | null; creado: string
}

export interface Recontacto { mes: string; estado: string; modo: string; cantidad: number; discordIds: string[]; creado: string }

/** Modo prueba (BOT_CLIENTES_PRUEBA): cada acción EXTERNA sobre un cliente de prueba deja un rastro para poder borrarla
 *  después (scripts/limpiar-cliente-prueba-bajas.mjs). `datos` lleva ids técnicos (mensaje, grupo, carpeta, fila del CRM y
 *  sus valores anteriores), nunca textos al cliente. */
export type TipoRastro = 'whatsapp' | 'discord' | 'crm' | 'drive' | 'grupos' | 'comunidad'
export interface Rastro { idCrm: string; tipo: TipoRastro; datos: Record<string, unknown>; creado: string }

export interface AlmacenBajas {
  crearPedido(p: PedidoNuevo): Promise<boolean>
  /** Cambia un pedido si está en uno de `siEstado` (si se pasa). Devuelve si cambió. */
  actualizarPedido(id: string, cambios: Partial<Pedido>, siEstado?: readonly EstadoPedido[]): Promise<boolean>
  pedido(id: string): Promise<Pedido | null>
  pedidoPorMensaje(mensajeId: string): Promise<Pedido | null>
  pedidoSinIdPorHuella(huella: string, desde: string): Promise<Pedido | null>
  pedidosAbiertosAntesDe(antes: string): Promise<Pedido[]>
  /** El pedido abierto (o aprobado) de ese cliente y ese tipo. */
  abiertoDe(clave: string, tipo: TipoPedido): Promise<Pedido | null>
  /** IDs del CRM a los que se les mandó (o simuló) el mensaje de renovación desde `desde`. */
  conAvisoDesde(desde: string): Promise<Set<string>>
  crearBaja(b: Omit<Baja, 'pasos'>): Promise<boolean>
  marcarPaso(id: string, paso: NombrePaso, valor: PasoBaja): Promise<void>
  baja(id: string): Promise<Baja | null>
  /** La última baja confirmada de ese cliente. */
  bajaDe(clave: string): Promise<Baja | null>
  reclamarLlamada(l: Pick<Llamada, 'recordingId' | 'fecha' | 'url'>, ahora: string): Promise<boolean>
  actualizarLlamada(recordingId: number, cambios: Partial<Llamada>): Promise<void>
  /** Motivos de baja conocidos por cliente (de las bajas confirmadas y, si no, de la última llamada "no renueva"). */
  motivosDeBaja(): Promise<Map<string, string>>
  reclamarRecontacto(r: Omit<Recontacto, 'estado' | 'discordIds'>): Promise<boolean>
  actualizarRecontacto(mes: string, cambios: Partial<Recontacto>): Promise<void>
  listarPedidos(limite: number): Promise<Pedido[]>
  listarBajas(limite: number): Promise<Baja[]>
  /** Modo prueba: anota una acción externa sobre un cliente de prueba (opcional: sin esto no se anota). */
  registrarRastro?(r: Rastro): Promise<void>
  /** Los rastros de esos IDs del CRM (para la limpieza). */
  rastrosDe?(idsCrm: readonly string[]): Promise<Rastro[]>
}

export const PEDIDO_ABIERTO: readonly EstadoPedido[] = ['abierto', 'aprobado']
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

export function almacenBajasEnMemoria(): AlmacenBajas & { _pedidos: Pedido[]; _bajas: Baja[]; _llamadas: Llamada[]; _recontactos: Recontacto[]; _rastros: Rastro[] } {
  const pedidos: Pedido[] = [], bajas: Baja[] = [], llamadas: Llamada[] = [], recontactos: Recontacto[] = [], rastros: Rastro[] = []
  const ahoraIso = () => new Date().toISOString()
  const una = <T>(x: T | undefined): T | null => (x ? copia(x) : null)
  return {
    _pedidos: pedidos, _bajas: bajas, _llamadas: llamadas, _recontactos: recontactos, _rastros: rastros,
    async registrarRastro(r) { rastros.push(copia(r)) },
    async rastrosDe(ids) { const s = new Set(ids.map((x) => x.toUpperCase())); return copia(rastros.filter((r) => s.has(r.idCrm.toUpperCase()))) },
    async crearPedido(p) {
      if (pedidos.some((x) => x.id === p.id || (x.clave === p.clave && x.tipo === p.tipo && PEDIDO_ABIERTO.includes(x.estado)))) return false
      pedidos.push({ ...copia(p), estado: 'abierto', por: null, respuesta: null, mensajeClienteId: null, resuelto: null, error: null, actualizado: p.creado })
      return true
    },
    async actualizarPedido(id, cambios, siEstado) {
      const p = pedidos.find((x) => x.id === id)
      if (!p || (siEstado && !siEstado.includes(p.estado))) return false
      const { detalle, ...resto } = copia(cambios)
      Object.assign(p, resto, { actualizado: ahoraIso() })
      if (detalle) p.detalle = { ...p.detalle, ...detalle }
      return true
    },
    async pedido(id) { return una(pedidos.find((x) => x.id === id)) },
    async pedidoPorMensaje(m) { return una(pedidos.find((x) => x.mensajePedidoId === m)) },
    async pedidoSinIdPorHuella(huella, desde) {
      return una(pedidos.filter((x) => !x.mensajePedidoId && x.huella === huella && x.creado >= desde && x.estado === 'abierto').sort((a, b) => b.creado.localeCompare(a.creado))[0])
    },
    async pedidosAbiertosAntesDe(antes) { return copia(pedidos.filter((x) => x.estado === 'abierto' && x.creado < antes)) },
    async abiertoDe(clave, tipo) { return una(pedidos.find((x) => x.clave === clave && x.tipo === tipo && PEDIDO_ABIERTO.includes(x.estado))) },
    async conAvisoDesde(desde) {
      return new Set(pedidos.filter((x) => x.tipo === 'aviso_fin' && ['enviado', 'dudoso', 'aprobado_simulado'].includes(x.estado) && (x.resuelto ?? '') >= desde).map((x) => x.idCrm.toUpperCase()))
    },
    async crearBaja(b) {
      if (bajas.some((x) => x.id === b.id)) return false
      bajas.push({ ...copia(b), pasos: {} })
      return true
    },
    async marcarPaso(id, paso, valor) { const b = bajas.find((x) => x.id === id); if (b) b.pasos[paso] = copia(valor) },
    async baja(id) { return una(bajas.find((x) => x.id === id)) },
    async bajaDe(clave) { return una(bajas.filter((x) => x.clave === clave).sort((a, b) => b.creado.localeCompare(a.creado))[0]) },
    async reclamarLlamada(l, ahora) {
      const previa = llamadas.find((x) => x.recordingId === l.recordingId)
      if (previa) {
        if (!LLAMADA_REINTENTABLE.includes(previa.estado)) return false
        Object.assign(previa, { estado: 'reclamada', creado: ahora })
        return true
      }
      llamadas.push({ ...copia(l), clave: null, cliente: null, estado: 'reclamada', decision: null, confianza: null, cita: null, motivo: null, motivoBaja: null, pedidoId: null, creado: ahora })
      return true
    },
    async actualizarLlamada(id, cambios) { const l = llamadas.find((x) => x.recordingId === id); if (l) Object.assign(l, copia(cambios)) },
    async motivosDeBaja() {
      const m = new Map<string, string>()
      for (const l of [...llamadas].sort((a, b) => a.creado.localeCompare(b.creado))) if (l.clave && l.motivoBaja && (l.decision === 'no_renueva' || l.decision === 'dudoso')) m.set(l.clave, l.motivoBaja)
      for (const b of [...bajas].sort((a, b) => a.creado.localeCompare(b.creado))) if (b.motivo) m.set(b.clave, b.motivo)
      return m
    },
    async reclamarRecontacto(r) {
      if (recontactos.some((x) => x.mes === r.mes)) return false
      recontactos.push({ ...copia(r), estado: 'reclamado', discordIds: [] })
      return true
    },
    async actualizarRecontacto(mes, cambios) { const r = recontactos.find((x) => x.mes === mes); if (r) Object.assign(r, copia(cambios)) },
    async listarPedidos(limite) { return copia([...pedidos].sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, limite)) },
    async listarBajas(limite) { return copia([...bajas].sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, limite)) },
  }
}
