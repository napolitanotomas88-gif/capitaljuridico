// ── Etiquetas de Edición (puro y liviano: lo importan la vista y los componentes del navegador) ─────────────────────
import type { Bloqueo, MotivoRegrabar, Prioridad, TipoNota } from './tipos'

export const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = { urgente: 'Urgente', alta: 'Alta', normal: 'Normal' }
export const ETIQUETA_BLOQUEO: Record<Bloqueo, string> = {
  tope_rondas_cliente: 'Espera el OK de Tomás (3.ª ronda del cliente)',
  sin_link_editado: 'Falta el link al editado',
  crudo_borrado: 'Se borró un crudo en Drive',
  otro: 'Bloqueado',
}
export const ETIQUETA_MOTIVO: Record<MotivoRegrabar, string> = { duro: 'Duro (poco natural)', audio: 'Audio', encuadre: 'Encuadre', falta_frase: 'Falta una frase', otro: 'Otro' }
export const ETIQUETA_TIPO_NOTA: Record<TipoNota, string> = {
  texto: 'Texto u ortografía', corte: 'Corte', velocidad: 'Velocidad', broll: 'B-roll', titulo: 'Título', guion: 'Cambio de guion', audio: 'Audio', otro: 'Otro',
}

/**
 * Cómo se nombra un video en la pantalla: "T2-V4" tal cual; un importado de ClickUp cuyo nombre no decía la tanda (clave
 * CU-<id>) por el número que sí se leyó ("Video 3 · ClickUp"), nunca la clave opaca.
 */
export function claveVisible(v: { clave: string; numero?: number | null }): string {
  if (!/^CU-/i.test(v.clave)) return v.clave
  return typeof v.numero === 'number' && v.numero > 0 ? `Video ${v.numero} · ClickUp` : 'Video de ClickUp'
}
