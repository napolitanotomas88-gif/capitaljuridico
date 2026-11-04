// ── Dependencias reales de la sincronización con ClickUp (clickupSync.ts). Solo servidor. ─────────────────────────────
// Interruptor: EDICION_CLICKUP_SYNC=0 apaga la lectura; EDICION_CLICKUP_ESCRIBIR=real habilita la escritura en ClickUp.
// El secreto del webhook: CLICKUP_WEBHOOK_SECRET o el que guardó el alta del webhook en cj_edicion_sync (clave «webhook»).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { clickupReal, listaClickUp, tokenClickUp, API_CLICKUP } from './clickupApi'
import { despacharClickUp, sincronizarClickUp, type ResultadoPush, type ResultadoSync } from './clickupSync'
import { transaccionTarjetas } from './tarjetasDb'
import { publicarDesde } from './publicacionesDb'

export const syncClickUpEncendida = (env: Record<string, string | undefined> = process.env): boolean => env.EDICION_CLICKUP_SYNC?.trim() !== '0' && !!tokenClickUp(env) && !!listaClickUp(env)
const objeto = <T>(x: unknown, d: T): T => { if (typeof x === 'string') { try { return JSON.parse(x) as T } catch { return d } } return (x ?? d) as T }

export async function sincronizarClickUpReal(op: { tareas?: string[]; borradas?: string[]; forzar?: boolean } = {}): Promise<ResultadoSync | { apagado: true }> {
  const api = clickupReal(), lista = listaClickUp()
  if (!syncClickUpEncendida() || !api || !lista) return { apagado: true }
  return sincronizarClickUp({
    api, lista, transaccion: transaccionTarjetas, ahora: () => Date.now(), publicarDesdeMs: publicarDesde(),
    crm: async () => { const { leerClientes } = await import('@/lib/clientes/leer'); return (await leerClientes()).clientes.filter(c => c.id).map(c => ({ id: c.id, nombre: c.nombre, estado: c.estado })) },
  }, op)
}
export async function despacharClickUpReal(hasta: number): Promise<ResultadoPush | { apagado: true }> {
  const api = clickupReal()
  if (!api) return { apagado: true }
  return despacharClickUp({ api, transaccion: transaccionTarjetas, ahora: () => Date.now(), hasta })
}
export async function ultimaSincronizacion(): Promise<string | null> {
  try { return await transaccionTarjetas(async c => { const v = objeto<{ ultima?: string; ultima_puntual?: string }>((await c.query("SELECT valor FROM cj_edicion_sync WHERE clave='clickup'")).rows[0]?.valor, {}); return [v.ultima, v.ultima_puntual].filter(Boolean).sort().pop() ?? null }) } catch { return null }
}

async function secretoWebhook(): Promise<string | null> {
  const env = process.env.CLICKUP_WEBHOOK_SECRET?.trim()
  if (env) return env
  try { return await transaccionTarjetas(async c => objeto<{ secret?: string }>((await c.query("SELECT valor FROM cj_edicion_sync WHERE clave='webhook'")).rows[0]?.valor, {}).secret ?? null) } catch { return null }
}
/** Firma de ClickUp: X-Signature = HMAC-SHA256(secreto, cuerpo crudo) en hex. Tiempo constante. */
export function firmaValida(cuerpo: string, firma: string | null, secreto: string): boolean {
  if (!firma || !/^[0-9a-f]{64}$/i.test(firma)) return false
  const esperada = createHmac('sha256', secreto).update(cuerpo).digest()
  return timingSafeEqual(esperada, Buffer.from(firma, 'hex'))
}
export async function verificarWebhook(cuerpo: string, firma: string | null): Promise<'ok' | 'sin_secreto' | 'firma'> {
  const s = await secretoWebhook()
  if (!s) return 'sin_secreto'
  return firmaValida(cuerpo, firma, s) ? 'ok' : 'firma'
}
/** Anota la entrada del webhook (una vez por evento). true = nueva. */
export async function anotarEntrada(id: string, tarea: string, evento: string): Promise<boolean> {
  return transaccionTarjetas(async c => (await c.query('INSERT INTO cj_edicion_clickup_entrada(id,tarea_id,evento) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id', [id.slice(0, 200), tarea, evento])).rows.length > 0)
}
export async function cerrarEntrada(id: string, error = ''): Promise<void> { await transaccionTarjetas(c => c.query('UPDATE cj_edicion_clickup_entrada SET procesado=now(),error=$2 WHERE id=$1', [id.slice(0, 200), error.slice(0, 250)])) }

export const EVENTOS_WEBHOOK = ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskStatusUpdated', 'taskAssigneeUpdated', 'taskPriorityUpdated', 'taskMoved'] as const
/** Da de alta el webhook de la lista de Edición en ClickUp y guarda su id y secreto en Neon. Idempotente por endpoint. */
export async function registrarWebhook(endpoint: string): Promise<{ id: string; nuevo: boolean }> {
  const token = tokenClickUp(), lista = listaClickUp()
  if (!token || !lista) throw new Error('falta CLICKUP_TOKEN o CLICKUP_LISTA_EDICION')
  const pedir = async (ruta: string, init: RequestInit = {}) => { const r = await fetch(`${API_CLICKUP}${ruta}`, { ...init, headers: { authorization: token, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`ClickUp respondió ${r.status}`); return j as Record<string, unknown> }
  const equipo = process.env.CLICKUP_EQUIPO?.trim() || String(((await pedir('/team')).teams as { id: string }[] | undefined)?.[0]?.id ?? '')
  if (!/^\d+$/.test(equipo)) throw new Error('no encontré el equipo de ClickUp')
  const existentes = ((await pedir(`/team/${equipo}/webhook`)).webhooks as { id: string; endpoint: string; health?: { status?: string } }[] | undefined) ?? []
  const ya = existentes.find(w => w.endpoint === endpoint)
  if (ya && await secretoWebhook()) return { id: ya.id, nuevo: false }
  if (ya) await pedir(`/webhook/${ya.id}`, { method: 'DELETE' })
  const r = await pedir(`/team/${equipo}/webhook`, { method: 'POST', body: JSON.stringify({ endpoint, events: EVENTOS_WEBHOOK, list_id: Number(lista) }) })
  const w = (r.webhook ?? {}) as { id?: string; secret?: string }
  const id = String(r.id ?? w.id ?? '')
  await transaccionTarjetas(c => c.query("INSERT INTO cj_edicion_sync(clave,valor) VALUES('webhook',$1::jsonb) ON CONFLICT(clave) DO UPDATE SET valor=EXCLUDED.valor,actualizado=now()", [JSON.stringify({ id, secret: w.secret ?? '', endpoint })]))
  return { id, nuevo: true }
}
