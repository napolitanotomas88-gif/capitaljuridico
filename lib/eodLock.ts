// ── Lock durable del EOD (un envío por fecha) sobre Google Sheets ────────────
// No hay KV/Redis en el proyecto: se usa la pestaña "EOD Locks" como cola de reclamos. Cada intento APPENDEA una fila
// (Sheets serializa los appends → números de fila distintos) y después lee la pestaña: gana la fila VIVA más baja de esa
// fecha. Estados de una fila: en-curso → snapshot-ok → enviando → enviado:<ids>  (o fallo:<motivo> / abandonado / perdido).
// Garantías reales (ver tests):
//   • Concurrencia: dos requests simultáneos nunca envían los dos (gana una sola fila viva).
//   • "enviando" es el único estado ambiguo (se mandó o no): NO se reenvía solo (at-most-once); queda marcado como incierto y
//     un humano decide con ?forzar=1 tras mirar el canal. Si la marca "enviado" no se pudo escribir, queda en "enviando".
//   • en-curso / snapshot-ok viejos (>10 min) = el proceso murió ANTES de enviar → se puede reintentar sin riesgo.
//   • fallo:* (error antes de enviar o Discord rechazó el primer mensaje) → reintento libre.

export interface FilaLock { idx: number; fecha: string; token: string; ts: string; estado: string }
export interface StoreLock {
  append(f: { fecha: string; token: string; ts: string; estado: string }): Promise<number>
  rows(): Promise<FilaLock[]>
  update(idx: number, estado: string): Promise<void>
}
export const STALE_MS = 10 * 60_000

const previoAEnvio = (e: string) => e === 'en-curso' || e === 'snapshot-ok'
export const vivo = (r: FilaLock, ahora: number) =>
  r.estado.startsWith('enviado') || r.estado === 'enviando' || (previoAEnvio(r.estado) && ahora - Date.parse(r.ts) <= STALE_MS)

export type ResultadoClaim =
  | { gano: true; idx: number }
  | { gano: false; motivo: 'yaEnviado' | 'enCurso' | 'incierto'; estado: string }

export async function reclamar(store: StoreLock, fecha: string, token: string, ahora: number): Promise<ResultadoClaim> {
  await store.append({ fecha, token, ts: new Date(ahora).toISOString(), estado: 'en-curso' })
  const todas = await store.rows()
  // La fila propia se ubica por TOKEN (único), no por el índice que devuelve el append: bajo concurrencia no es confiable
  const mia = todas.find(r => r.token === token)
  if (!mia) throw new Error('no se encontró la fila de lock propia')
  const g = todas.filter(r => r.fecha === fecha && vivo(r, ahora)).sort((a, b) => a.idx - b.idx)[0]
  if (g && g.token === token) return { gano: true, idx: mia.idx }
  await store.update(mia.idx, 'perdido').catch(() => {})
  if (!g) return { gano: false, motivo: 'enCurso', estado: 'sin-ganador' }   // no debería pasar: nuestra fila es viva
  if (g.estado.startsWith('enviado')) return { gano: false, motivo: 'yaEnviado', estado: g.estado }
  if (g.estado === 'enviando' && ahora - Date.parse(g.ts) > STALE_MS) return { gano: false, motivo: 'incierto', estado: g.estado }
  return { gano: false, motivo: 'enCurso', estado: g.estado }
}

// El operador decidió reintentar tras revisar el canal: los "enviando" de esa fecha pasan a abandonados
export async function abandonarEnviando(store: StoreLock, fecha: string) {
  for (const r of await store.rows()) if (r.fecha === fecha && r.estado === 'enviando') await store.update(r.idx, 'abandonado')
}
