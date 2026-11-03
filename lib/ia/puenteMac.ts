// ── Puente de Claude a la Mac: las llamadas del Despacho se resuelven con el plan de Tomás, no con la API ─────────────────
// Decisión de Tomás (1/11/2026, opción «A»): nada del Despacho gasta créditos de la API. Con CLAUDE_VIA=mac, cada módulo
// que llamaba a la API (comprobantes, dirección, kickoff, mapa, copys, guiones, Fathom → anuncios, trazabilidad, éxito,
// bajas) deja su pedido en Neon (cj_ia_pedidos); el trabajador de la Mac (scripts/ia-mac.mjs) lo toma, lo corre con
// `claude -p` (Claude Code con su plan, sin claves de la API) y guarda la respuesta. El Despacho espera la respuesta.
//   · Imita lo que los módulos usan del SDK: messages.create, beta.messages.create y beta.messages.stream(...).finalMessage().
//     La respuesta tiene la forma de un mensaje de la API (content [{ type: 'text' }], stop_reason, usage).
//   · Sin respuesta a tiempo (la Mac apagada o dormida): APIConnectionError, que todos los módulos ya tratan como pasajero
//     (reintentan más tarde o lo deja para que lo mire una persona). Un error del trabajador (rechazo, JSON inválido):
//     APIError 400, definitivo.
//   · Huella: el mismo pedido (mismo cuerpo) reusa el que está en curso o ya resuelto (24 h). Así un módulo que corta antes
//     (dirección: 8 s; comprobante: 45 s) y reintenta más tarde se encuentra la respuesta, en vez de volver a empezar.
//   · Vigía de la cola (3/11/2026: la Mac quedó viva sin leer la cola y una kickoff se quedó sin tiempo): cuando el
//     Despacho deja un pedido, mientras espera y al rendirse, mira si hay pedidos que la Mac no tomó en más de 5 minutos;
//     si los hay, avisa en #🧰-sistema-bot (alertar, canal 'sistema'; una vez cada 30 min por la clave). Lo hace el
//     Despacho y no la Mac porque, si la Mac está caída, ella no puede avisar.
//   · Lo que no se traslada: thinking, betas y fallbacks del servidor (Claude Code decide). El esfuerzo y el modelo, sí.
// Solo de servidor (pg).
import { createHash, randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import type { Pool } from 'pg'

export const SQL_IA_PEDIDOS = `
CREATE TABLE IF NOT EXISTS cj_ia_pedidos (
 id text PRIMARY KEY, origen text NOT NULL, estado text NOT NULL DEFAULT 'pendiente',
 modelo text, esfuerzo text, cuerpo jsonb NOT NULL, respuesta jsonb, error text,
 creado timestamptz NOT NULL DEFAULT now(), vence timestamptz NOT NULL, tomado timestamptz, terminado timestamptz, intentos integer NOT NULL DEFAULT 0,
 huella text);
CREATE INDEX IF NOT EXISTS cj_ia_pedidos_pendientes ON cj_ia_pedidos(estado, creado);
CREATE INDEX IF NOT EXISTS cj_ia_pedidos_huella ON cj_ia_pedidos(huella, creado);`

/** ¿Las llamadas a Claude van a la Mac? (Vercel: CLAUDE_VIA=mac). */
export const viaMac = (env: NodeJS.ProcessEnv = process.env): boolean => env.CLAUDE_VIA?.trim() === 'mac'

/** Para los chequeos de "¿hay clave?" de los módulos: con el puente no hace falta clave de la API. */
export const MARCA_VIA_MAC = 'via-mac'

/** Cuánto espera el Despacho por defecto si el módulo no pidió un tope (la Mac tarda en arrancar `claude -p`). */
export const ESPERA_POR_DEFECTO_MS = 240_000
const CADA_MS = 1_500
const LIMPIAR_DESPUES_H = 24

/** Lo mínimo de la base que usa el puente (el real con pg; uno falso en los tests). */
export interface BasePuente {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

let pool: Pool | null = null
let lista = false
async function baseReal(): Promise<BasePuente> {
  if (!process.env.DATABASE_URL) throw new Anthropic.APIConnectionError({ message: 'Puente a la Mac: falta DATABASE_URL' })
  if (!pool) { const { Pool } = await import('pg'); pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000 }) }
  if (!lista) { await pool.query(SQL_IA_PEDIDOS); lista = true }
  return pool
}

/** Un mensaje con la forma de la API. */
export interface MensajeMac {
  id: string; type: 'message'; role: 'assistant'; model: string
  content: { type: 'text'; text: string }[]
  stop_reason: 'end_turn'; stop_sequence: null
  usage: { input_tokens: number; output_tokens: number }
}

/** Lo que manda el vigía (alertar de lib/alertas en el servidor; uno falso en los tests). */
export type AvisoCola = (a: { canal: 'sistema'; tipo: string; clave: string; titulo: string; lineas: string[]; emoji?: string; urgente?: boolean }) => Promise<unknown>

export interface OpcionesPuente {
  /** Quien avisa a Discord de la cola trabada (por defecto, alertar de lib/alertas). */
  avisar?: AvisoCola
  base?: BasePuente
  origen?: string
  /** Tope por defecto (el módulo puede pedir otro con `timeout` en el cliente o en la llamada). */
  esperaMs?: number
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
}

type Cuerpo = Record<string, unknown>
type OpLlamada = { timeout?: number; signal?: AbortSignal } | undefined

const esfuerzoDe = (c: Cuerpo): string | null => {
  const e = (c.output_config as { effort?: unknown } | undefined)?.effort
  return typeof e === 'string' ? e : null
}

export const COLA_TRABADA_MIN = 5
const VIGIA_CADA_MS = 60_000
const AVISO_CADA_MS = 30 * 60_000
let ultimaVigia = 0

/** ¿Hay pedidos que la Mac no tomó en más de 5 minutos (pendientes, o que vencieron hace poco sin que nadie los tomara) y
 *  la Mac no tomó nada en esos 5 minutos? Los vencidos viejos no cuentan: si no, tras un corte ya resuelto seguiría avisando. Si los hay,
 *  avisa a #🧰-sistema-bot. Nunca tira ni demora más que una consulta; como mucho una vez por minuto por instancia. */
export async function vigilarCola(base: BasePuente, op: { avisar?: AvisoCola; ahora?: () => number; forzar?: boolean } = {}): Promise<boolean> {
  const ahora = (op.ahora ?? Date.now)()
  if (!op.forzar && ahora - ultimaVigia < VIGIA_CADA_MS) return false
  ultimaVigia = ahora
  try {
    const { rows } = await base.query(
      `SELECT count(*)::int AS n, min(creado) AS desde, string_agg(DISTINCT origen, ', ') AS origenes FROM cj_ia_pedidos
       WHERE tomado IS NULL AND creado < now() - interval '${COLA_TRABADA_MIN} minutes' AND creado > now() - interval '2 hours'
         AND (estado = 'pendiente' OR (estado = 'vencido' AND vence > now() - interval '10 minutes'))
         AND NOT EXISTS (SELECT 1 FROM cj_ia_pedidos t WHERE t.tomado > now() - interval '${COLA_TRABADA_MIN} minutes')`,
    )
    const f = rows[0]
    const n = Number(f?.n ?? 0)
    if (!n) return false
    const desde = f?.desde ? new Date(String(f.desde)) : null
    const min = desde ? Math.round((ahora - desde.getTime()) / 60_000) : null
    const avisar = op.avisar ?? (async (a) => (await import('@/lib/alertas')).alertar(a))
    await avisar({
      canal: 'sistema', tipo: 'ia_mac_cola', clave: `ia-mac-cola:${Math.floor(ahora / AVISO_CADA_MS)}`, emoji: '🧰', urgente: true,
      titulo: 'La Mac no está tomando los pedidos de Claude',
      lineas: [
        `${n} ${n === 1 ? 'pedido esperó' : 'pedidos esperaron'} más de ${COLA_TRABADA_MIN} min sin que la Mac los tomara${min ? ` (el más viejo, hace ${min} min)` : ''}.`,
        `Módulos: ${String(f?.origenes ?? 'sin dato')}.`,
        'Revisar que la Mac esté prendida y con internet; el servicio se relanza con `launchctl kickstart -k gui/$(id -u)/com.skyward.ia-mac` (log en ~/Library/Logs/ia-mac/ia-mac.log).',
      ],
    })
    return true
  } catch { return false }
}

/** Deja el pedido y espera la respuesta de la Mac. */
export async function pedirALaMac(cuerpo: Cuerpo, op: OpcionesPuente & { topeMs?: number; signal?: AbortSignal } = {}): Promise<MensajeMac> {
  const base = op.base ?? (await baseReal())
  const ahora = op.ahora ?? Date.now
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)))
  const tope = Math.max(10_000, op.topeMs ?? op.esperaMs ?? ESPERA_POR_DEFECTO_MS)
  const modelo = typeof cuerpo.model === 'string' ? cuerpo.model : null
  // Sin `stream` ni campos del SDK que el trabajador no usa
  const { stream: _s, ...limpio } = cuerpo
  const texto = JSON.stringify(limpio)
  const huella = createHash('sha256').update(`${op.origen ?? ''}\n${texto}`).digest('hex')
  const vence = new Date(ahora() + tope).toISOString()
  // ¿Ya está en curso o resuelto? Se reusa (y se le estira el vencimiento si todavía nadie lo tomó)
  const previo = (await base.query(
    `SELECT id FROM cj_ia_pedidos WHERE huella = $1 AND estado IN ('pendiente','tomado','listo') AND creado > now() - interval '${LIMPIAR_DESPUES_H} hours' ORDER BY creado DESC LIMIT 1`,
    [huella],
  )).rows[0]
  let id: string
  if (previo) {
    id = String(previo.id)
    await base.query(`UPDATE cj_ia_pedidos SET vence = GREATEST(vence, $2::timestamptz) WHERE id = $1 AND estado = 'pendiente'`, [id, vence])
  } else {
    id = `ia_${randomUUID()}`
    await base.query(
      `INSERT INTO cj_ia_pedidos (id, origen, modelo, esfuerzo, cuerpo, vence, huella) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, op.origen ?? 'despacho', modelo, esfuerzoDe(cuerpo), texto, vence, huella],
    )
  }
  const fin = ahora() + tope
  const vigia = (forzar = false) => vigilarCola(base, { avisar: op.avisar, ahora, forzar })
  await vigia()
  try {
    for (let primera = true; ahora() < fin; primera = false) {
      if (op.signal?.aborted) throw new Anthropic.APIUserAbortError()
      if (!primera) { await esperar(CADA_MS); await vigia() }
      const { rows } = await base.query(`SELECT estado, respuesta, error FROM cj_ia_pedidos WHERE id = $1`, [id])
      const f = rows[0]
      if (!f) throw new Anthropic.APIConnectionError({ message: 'Puente a la Mac: el pedido desapareció' })
      if (f.estado === 'listo') {
        const r = (typeof f.respuesta === 'string' ? JSON.parse(f.respuesta) : f.respuesta) as { texto?: unknown; modelo?: unknown; entrada?: unknown; salida?: unknown }
        return {
          id, type: 'message', role: 'assistant', model: typeof r.modelo === 'string' ? r.modelo : (modelo ?? 'claude'),
          content: [{ type: 'text', text: String(r.texto ?? '') }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: Number(r.entrada) || 0, output_tokens: Number(r.salida) || 0 },
        }
      }
      if (f.estado === 'error') {
        const motivo = `La Mac no pudo resolverlo: ${String(f.error ?? 'sin detalle').slice(0, 200)}`
        // "no disponible" (sin sesión de Claude, límite del plan): pasajero; el resto, definitivo
        if (/no disponible|límite|limit|overloaded|timeout|tiempo/i.test(String(f.error ?? ''))) throw new Anthropic.APIConnectionError({ message: motivo })
        throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: motivo } }, motivo, new Headers())
      }
    }
    throw new Anthropic.APIConnectionTimeoutError({ message: `La Mac no respondió en ${Math.round(tope / 1000)} s (¿está prendida?)` })
  } finally {
    // Lo que nadie tomó y ya venció se cancela (así la Mac no lo corre de balde); lo que la Mac ya está corriendo sigue y
    // queda para el reintento (huella). Los viejos se borran: llevan los archivos en base64
    await base.query(`UPDATE cj_ia_pedidos SET estado = 'vencido' WHERE id = $1 AND estado = 'pendiente' AND vence <= now()`, [id]).catch(() => {})
    await vigia(true)
    await base.query(`DELETE FROM cj_ia_pedidos WHERE creado < now() - interval '${LIMPIAR_DESPUES_H} hours'`).catch(() => {})
  }
}

/** Cliente con la forma del SDK de Anthropic (lo que usan los módulos). */
export function clienteMac(op: OpcionesPuente = {}) {
  const llamar = (c: Cuerpo, o: OpLlamada) => pedirALaMac(c, { ...op, topeMs: o?.timeout ?? op.esperaMs, signal: o?.signal })
  const messages = {
    create: (c: Cuerpo, o?: OpLlamada) => llamar(c, o),
    stream: (c: Cuerpo, o?: OpLlamada) => {
      const p = llamar(c, o)
      p.catch(() => {})   // el error lo recibe quien llame a finalMessage()
      return { finalMessage: () => p }
    },
  }
  return { messages, beta: { messages } }
}
