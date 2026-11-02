// ── Bandeja central → Discord (2/11/2026). Reglas puras (sin red ni base; lo prueba scripts/test-alertas-discord.mjs) ───────
// Reemplaza la salida de WhatsApp de la bandeja (lib/notificaciones/whatsapp, apagada sin el número del bot). Cada aviso de
// cj_notificaciones que NO sale ya por Discord desde su propio bot va UNA vez al canal de su área, con las mismas reglas de
// antes: se revalida que la etapa siga siendo real justo antes de mandarlo y no sale nada de más de 48 h.
// Interruptor NOTIF_DISCORD: 'real' (por defecto) | 'apagado'.
import type { Canal } from '../../alertas/canales'
import type { Mencion } from '../../alertas/personas'

type Entorno = Record<string, string | undefined>
export const modoNotifDiscord = (env: Entorno = process.env): 'real' | 'apagado' => (env.NOTIF_DISCORD?.trim().toLowerCase() === 'apagado' ? 'apagado' : 'real')
export const MAX_ANTIGUEDAD_MS = 48 * 3600_000
export const MAX_POR_CORRIDA = 20

/** Tipos que su bot ya avisa por Discord (no se duplican): altas (✅ con el link a la espera), guiones para revisar o con notas
 *  (✍️), la entrega de guiones (📤 «para enviar»), Edición (✂️, su propia cola) y los pedidos de Éxito y Bajas (✅). */
const EXCLUIDOS = new Set(['guiones_a_revisar', 'guiones_con_notas', 'guiones_entrega', 'exito_abierto', 'bajas_abierto'])
const PREFIJOS_EXCLUIDOS = ['altas_', 'alta_', 'edicion_', 'anuncios_g', 'anuncios_resumen']

export type MapeoDiscord = { ok: true; canal: Canal; menciones: Mencion[]; emoji: string } | { ok: false; motivo: string }

export function mapearDiscord(tipo: string): MapeoDiscord {
  if (EXCLUIDOS.has(tipo) || PREFIJOS_EXCLUIDOS.some((p) => tipo.startsWith(p))) return { ok: false, motivo: 'ya sale por Discord desde su bot' }
  switch (tipo) {
    case 'guiones_error': return { ok: true, canal: 'guiones', menciones: ['tomas', 'faus'], emoji: '⚠️' }
    case 'kickoff_error': return { ok: true, canal: 'operaciones', menciones: ['tomas'], emoji: '⚠️' }
    case 'cliente_sin_respuesta': return { ok: true, canal: 'csm', menciones: ['gero_m'], emoji: '⏳' }
    case 'beneficio_referido': return { ok: true, canal: 'csm', menciones: ['gero_m'], emoji: '🎁' }
    case 'anuncios_dudoso': return { ok: true, canal: 'ads', menciones: ['valentino'], emoji: '❓' }
    case 'exito_error': case 'exito_dudoso': case 'bajas_error': case 'bajas_dudoso': return { ok: true, canal: 'csm', menciones: ['gero_m'], emoji: '⚠️' }
    default: return { ok: false, motivo: 'tipo sin canal de Discord' }
  }
}
