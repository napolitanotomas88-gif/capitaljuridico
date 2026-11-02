// ── Corte global del WhatsApp del bot (2/11/2026) ──────────────────────────────────────────────────────────────────────
// El número del bot (Whapi) no se recuperó: Tomás decidió que el sistema deja de usar WhatsApp. Todo lo que el bot le
// mandaba al equipo va a Discord (lib/alertas) y lo que le mandaba al cliente queda «para enviar» a mano
// (lib/bot/canal/salidaCliente.ts). Esta es la ÚNICA puerta: ningún pedido de escritura sale a Whapi (mensajes, grupos,
// participantes, medios) salvo que WHATSAPP_BOT valga exactamente «encendido». Sin la variable, apagado. Así una variable
// vieja (GUIONES_WHATSAPP=real, NOTIF_WHATSAPP=real, BOT_EXITO_MODO=real…) no puede volver a escribirle a nadie aunque el
// número se reconecte. Puro, sin red.
type Entorno = Record<string, string | undefined>

let permitidoEnPruebas = false

/** ¿El bot puede escribir por WhatsApp? Solo con WHATSAPP_BOT=encendido (o en los tests que prueban el cliente de Whapi). */
export function whatsappBotEncendido(env: Entorno = process.env): boolean {
  return permitidoEnPruebas || env.WHATSAPP_BOT?.trim().toLowerCase() === 'encendido'
}

export const MOTIVO_WHATSAPP_APAGADO = 'el WhatsApp del bot está apagado (WHATSAPP_BOT): no sale nada por Whapi'

/** SOLO para los tests del cliente de Whapi (con fetch falso): abre la puerta en este proceso. */
export function permitirWhatsappEnPruebas(si = true): void {
  permitidoEnPruebas = si
}
