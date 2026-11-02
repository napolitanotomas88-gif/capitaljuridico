// ── g03 · Si algo de lo armado en Meta NO quedó en pausa: aviso en 📣-ads y en 🧰-sistema-bot ─────────────────────────────
// Pedido de Tomás (2/11/2026): «que se lancen pero que queden pausados». borrador.ts relee campaña, conjuntos y CADA anuncio
// y, si alguno no está en PAUSED, lo vuelve a pausar y tira ErrorPausa. Acá se avisa a Valen y a Tomás en los dos canales
// (además del renglón «No pude armarlo» del aviso de videos) y se vuelve a tirar el error. Sin IDs de Discord en el código.
import type { Alerta, ResultadoAlerta } from '@/lib/alertas/alerta'
import type { ErrorPausa } from './borrador'

export interface DepsAvisoPausa {
  alertar(a: Alerta): Promise<ResultadoAlerta>
  esErrorPausa(e: unknown): e is ErrorPausa
}

/** Las dos alertas (📣-ads y 🧰-sistema-bot) para un ErrorPausa. Puro. */
export function alertasPausa(e: ErrorPausa, x: { cliente: string; cuenta: string }): Alerta[] {
  const ids = e.sueltas.map(p => p.id).join(',')
  const sin = e.sueltas.filter(p => !p.repausada)
  const lineas = [
    ...e.sueltas.map(p => `${p.tipo} ${p.id}: estaba ${p.estado} → ${p.repausada ? 'lo volví a pausar' : 'NO lo pude pausar'}`),
    sin.length ? 'Pausalo YA desde el Administrador: el bot nunca prende nada.' : 'Quedó en pausa. Revisá en el historial de la cuenta quién o qué lo cambió.',
    `Cuenta ${x.cuenta || 'sin cuenta'}`,
  ]
  const base = { tipo: 'anuncios_no_en_pausa', titulo: '🚨 Algo del borrador en Meta no quedó en pausa', cliente: x.cliente, lineas, urgente: true }
  return [
    { ...base, canal: 'ads', clave: `pausa:ads:${x.cuenta}:${ids}`, menciones: ['valentino', 'tomas'] },
    { ...base, canal: 'sistema', clave: `pausa:sistema:${x.cuenta}:${ids}`, menciones: ['tomas'] },
  ]
}

/** Corre el armado; si tira ErrorPausa, avisa en los dos canales y lo vuelve a tirar (el aviso de videos lleva el motivo). */
export async function avisarSiNoQuedoEnPausa<T>(armar: () => Promise<T>, x: { cliente: string; cuenta: string }, deps: DepsAvisoPausa): Promise<T> {
  try { return await armar() } catch (e) {
    if (deps.esErrorPausa(e)) for (const a of alertasPausa(e, x)) await deps.alertar(a).catch(() => null)
    throw e
  }
}
