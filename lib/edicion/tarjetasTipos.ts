// Columnas de la lista real «Sistema de Edición», leídas el 29/10/2026. El estado del padre y el de cada subtarea son independientes.
export const ETAPAS_TARJETAS = ['en espera de datos', 'para editar', 'editando', 'editado', 'corregido', 'revisión', 'publicar', 'publicado'] as const
export type EtapaTarjeta = (typeof ETAPAS_TARJETAS)[number]
export const COLOR_ETAPA_TARJETA: Record<EtapaTarjeta, string> = {
  'en espera de datos': '#87909e', 'para editar': '#ff0000', editando: '#f76808', editado: '#ffc53d',
  corregido: '#a18072', 'revisión': '#3db88b', publicar: '#12a594', publicado: '#008844',
}
export interface CamposTarjetaEdicion { paleta: string; crudo: string; editado: string }
export interface TarjetaEdicion {
  id: string; parent_id: string | null; id_crm: string | null; video_id: number | null
  nombre: string; etapa: EtapaTarjeta; version: number; campos: CamposTarjetaEdicion; hijos: TarjetaEdicion[]
  prioridad?: string | null; asignados?: string[]; clickup_url?: string | null; clickup_id?: string | null; origen?: string | null
  etapas_permitidas?: EtapaTarjeta[]; ronda_cliente?: number; espera_whatsapp?: boolean; avisos?: string[]
  /** Un cruce CRM incierto queda visible para revisar, sin ofrecer escrituras. */
  puede_editar?: boolean
}
export interface PermisosTarjetasEdicion { mover: boolean; campos: boolean; comentar: boolean }
export interface EventoTarjetaEdicion {
  id: string; fecha: string; quien: string; tipo: 'movimiento' | 'campos' | 'comentario'
  antes?: EtapaTarjeta; despues?: EtapaTarjeta; texto: string
}
export interface RespuestaTarjetasEdicion {
  ok: boolean; tarjetas?: TarjetaEdicion[]; tarjeta?: TarjetaEdicion; historial?: EventoTarjetaEdicion[]
  mensaje?: string; codigo?: string; dry?: boolean; modo?: 'dry' | 'real'; permisos?: PermisosTarjetasEdicion
  /** Última sincronización con ClickUp (ISO) y si Aylu/Tomás pueden crear tarjetas. */
  sincronizado?: string | null; crear?: boolean
}
/** Alta desde el tablero (Aylu y Tomás): un cliente del CRM y sus videos. Si el cliente ya tiene tarjeta, se le suman. */
export interface VideoNuevoEdicion { nombre: string; crudo: string; editado: string; prioridad: string | null; asignado: string | null; guion: string }
export interface PedidoNuevaTarjeta { accion: 'crear'; clave: string; id_crm: string; cliente: string; padre_id: string | null; videos: VideoNuevoEdicion[] }
export interface RespuestaSincronizacion { ok: boolean; mensaje?: string; sincronizado?: string | null; leidas?: number; creadas?: number; actualizadas?: number; apagado?: boolean }
export type PedidoTarjetaEdicion = { id: string; version: number; clave: string } & (
  | { accion: 'mover'; etapa: EtapaTarjeta; comentario?: string; origen?: 'interno' | 'cliente'; autorizarTercera?: boolean }
  | { accion: 'campos'; campos: CamposTarjetaEdicion }
  | { accion: 'comentar'; texto: string }
)
