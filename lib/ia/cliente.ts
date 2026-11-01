// ── El cliente de Claude de los módulos: la API o el puente a la Mac (CLAUDE_VIA=mac) ─────────────────────────────────
// Todos los módulos que llamaban a la API crean su cliente acá. Con CLAUDE_VIA=mac no se usa ninguna clave: las llamadas
// se resuelven en la Mac de Tomás con su plan (puenteMac.ts, decisión del 1/11/2026). Sin CLAUDE_VIA, igual que antes.
import Anthropic from '@anthropic-ai/sdk'
import { MARCA_VIA_MAC, clienteMac, viaMac } from './puenteMac'

export { viaMac, MARCA_VIA_MAC }

/** Opciones del SDK que usan los módulos. `origen` identifica al módulo en la cola de la Mac. */
export interface OpcionesCliente { apiKey?: string; maxRetries?: number; timeout?: number; fetch?: typeof fetch; origen: string }

export function crearClienteClaude({ origen, ...op }: OpcionesCliente): Anthropic {
  if (viaMac()) return clienteMac({ origen, esperaMs: op.timeout }) as unknown as Anthropic
  return new Anthropic(op)
}

/** La clave de la API de un módulo o, con el puente, una marca que no es clave (para los chequeos de "¿hay Claude?"). */
export const claveOMac = (clave: string): string => (viaMac() ? MARCA_VIA_MAC : clave)
