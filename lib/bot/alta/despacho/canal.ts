// ── Bot "Capital Jurídico": por dónde van los pedidos del alta (Altas desde el Despacho, 26/10/2026) ───────────────────
// El 26/10/2026 WhatsApp suspendió el número del bot. Los pedidos (datos al closer, OK de Verificaciones) se pueden responder
// en el Despacho (/clientes/altas). BOT_ALTA_CANAL decide por dónde salen:
//   · whatsapp: como antes (Ventas C.J. y Verificaciones C.J). No hay avisos a Discord por pedido.
//   · despacho: no sale nada a esos dos grupos; cada pedido avisa a Discord con el link directo a la espera.
//   · ambos: sale por WhatsApp y, si la guardia de salud lo frena (número caído o suspendido), avisa a Discord.
// Sin la variable (o mal escrita): 'despacho' si la guardia ya sabe que el número está caído y 'ambos' si no (con el número
// caído, el primer envío lo frena la guardia y el aviso sale igual). Puro, sin red.
import type { PasoId } from '../motor/tipos'

export const CANALES = ['despacho', 'whatsapp', 'ambos'] as const
export type CanalAlta = (typeof CANALES)[number]

/** Motivo con que queda en reintento el aviso de Skool cuando el canal es Despacho ("a mano" en la pantalla). */
export const MOTIVO_CANAL_DESPACHO = 'canal Despacho: se hace a mano desde /clientes/altas'

/** Lo que queda a mano con el número caído: se cierra con "Hecho a mano" en la pantalla del alta. */
export const PASOS_A_MANO = ['comunidad', 'bienvenida', 'skool'] as const satisfies readonly PasoId[]
export type PasoAMano = (typeof PASOS_A_MANO)[number]
export const esPasoAMano = (x: unknown): x is PasoAMano => typeof x === 'string' && (PASOS_A_MANO as readonly string[]).includes(x)

export const esCanal = (x: unknown): x is CanalAlta => typeof x === 'string' && (CANALES as readonly string[]).includes(x)

/** Lo que la guardia de salud sabe del número (lib/bot/whapi/salud.ts: EstadoSalud), o null si todavía no lo miró. */
export type SaludConocida = { ok: boolean; conocido: boolean } | null

/** BOT_ALTA_CANAL, o el que corresponde por la salud del número. */
export function canalDesdeEntorno(env: NodeJS.ProcessEnv = process.env, salud: SaludConocida = null): CanalAlta {
  const v = env.BOT_ALTA_CANAL?.trim().toLowerCase()
  if (esCanal(v)) return v
  return salud && salud.conocido && !salud.ok ? 'despacho' : 'ambos'
}
