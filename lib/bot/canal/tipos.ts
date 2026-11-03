// ── Salida al CLIENTE (2/11/2026): el punto de enganche único ───────────────────────────────────────────────────────────
// Tomás (2/11/2026): el bot ya NO le escribe al cliente por WhatsApp (ni Whapi ni nada). Lo que antes le mandaba ahora es un
// mensaje «para enviar»: queda en /clientes/para-enviar con el texto listo, y sale una alerta en #📤-para-enviar-al-cliente
// mencionando a la persona responsable. Ella lo pega a mano en el grupo del cliente y marca «Enviado» en el Despacho; con eso
// se hace lo mismo que hacía el envío automático cuando salía bien (ganchos.ts).
// Punto de enganche para el canal OFICIAL de WhatsApp (futuro, NO construido): la interfaz CanalSalidaCliente. Hoy hay un
// solo proveedor, 'manual'. Cuando exista el número oficial, un proveedor 'meta' o '2chat' implementa la misma interfaz y se
// elige con CANAL_CLIENTE_PROVEEDOR; ninguna pieza cambia.
import type { PiezaCliente } from '@/lib/alertas/personas'

export type { PiezaCliente } from '@/lib/alertas/personas'

export interface MensajeCliente {
  pieza: PiezaCliente
  /** ID del CRM (A123). Sin ID igual se registra (Éxito puede conocer solo el nombre), pero el link va a la lista. */
  idCrm: string | null
  cliente: string
  /** Idempotencia de la pieza (sin el prefijo de la pieza): la misma clave nunca se registra dos veces. */
  clave: string
  /** El texto tal cual iba por WhatsApp. */
  texto: string
  /** Ruta interna de la pantalla de la pieza (p. ej. /clientes/entregas?cliente=A123) para «Abrir». */
  abrir?: string | null
  /** Links que acompañan (video de bienvenida, Drive…): se muestran aparte. */
  adjuntos?: string[]
  /** Advertencias para el equipo (no van en el texto del cliente): p. ej. «la carga en el Doc falló, revisalo antes». */
  avisos?: string[]
  /** Lo que necesita el gancho de «Enviado» (ids internos; nunca teléfonos). */
  datos?: Record<string, unknown>
}

export type ResultadoSalidaCliente =
  | { estado: 'manual_pendiente'; id: number | null }
  | { estado: 'ya_estaba'; id: number | null }
  | { estado: 'error'; motivo: string }

export interface CanalSalidaCliente {
  readonly proveedor: 'manual' | 'meta' | '2chat'
  /** Nunca tira. */
  enviar(m: MensajeCliente): Promise<ResultadoSalidaCliente>
}

export const PROVEEDORES = ['manual'] as const
/** CANAL_CLIENTE_PROVEEDOR: hoy solo 'manual' (cualquier otro valor también es manual hasta que exista otro proveedor). */
export const proveedorCanalCliente = (): 'manual' => 'manual'
