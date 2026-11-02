// ── Alertas por Discord: dependencias reales (Neon + webhook). Solo servidor ────────────────────────────────────────────
// alertar(a) = alertarCon(a, depsReales()). La tabla cj_alertas_discord se crea sola (idempotente, como las otras cj_*):
//   clave UNIQUE, canal, tipo, id_crm, resumen (título — cliente, 160 caracteres), estado anotado|enviado|dudoso|error|
//   sin_webhook|tope|apagado, mensaje_id, motivo, intentos, creado, enviado.
// Sin DATABASE_URL la alerta sale igual, sin deduplicar.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { urlDespacho } from '@/lib/edicion/avisos/entorno'
import { MAX_INTENTOS, alertarCon, enviarWebhook, type Alerta, type DepsAlerta, type RegistroAlertas, type ResultadoAlerta } from './alerta'

export type { Alerta, ResultadoAlerta } from './alerta'
export type { Canal } from './canales'
export type { Mencion, PiezaCliente, Rol } from './personas'

type Q = NeonQueryFunction<false, false>
const url = () => process.env.DATABASE_URL?.trim() || ''
let lista = false

async function asegurar(q: Q): Promise<void> {
  if (lista) return
  await q`CREATE TABLE IF NOT EXISTS cj_alertas_discord (
    id bigserial PRIMARY KEY, clave text NOT NULL UNIQUE, canal text NOT NULL, tipo text NOT NULL, id_crm text, resumen text,
    estado text NOT NULL DEFAULT 'anotado', mensaje_id text, motivo text, intentos int NOT NULL DEFAULT 1,
    creado timestamptz NOT NULL DEFAULT now(), enviado timestamptz)`
  await q`CREATE INDEX IF NOT EXISTS cj_alertas_discord_canal ON cj_alertas_discord (canal, enviado)`
  lista = true
}

export function registroNeon(): RegistroAlertas | null {
  if (!url()) return null
  const q = neon(url(), { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
  return {
    async anotar(f) {
      await asegurar(q)
      const r = await q`INSERT INTO cj_alertas_discord (clave, canal, tipo, id_crm, resumen) VALUES (${f.clave}, ${f.canal}, ${f.tipo}, ${f.idCrm}, ${f.resumen})
        ON CONFLICT (clave) DO UPDATE SET estado = 'anotado', intentos = cj_alertas_discord.intentos + 1, motivo = NULL
        WHERE cj_alertas_discord.estado IN ('error', 'sin_webhook', 'apagado') AND cj_alertas_discord.intentos < ${MAX_INTENTOS}
        RETURNING id`
      return r.length > 0
    },
    async cerrar(clave, estado, mensajeId, motivo) {
      await q`UPDATE cj_alertas_discord SET estado = ${estado}, mensaje_id = ${mensajeId}, motivo = ${motivo},
        enviado = CASE WHEN ${estado} IN ('enviado', 'dudoso') THEN now() ELSE enviado END WHERE clave = ${clave}`
    },
    async enLaHora(canal) {
      await asegurar(q)
      const r = await q`SELECT count(*)::int AS n FROM cj_alertas_discord WHERE canal = ${canal} AND estado IN ('enviado', 'dudoso') AND enviado > now() - interval '1 hour'`
      return Number(r[0]?.n ?? 0)
    },
  }
}

export function depsAlertasReales(env: Record<string, string | undefined> = process.env): DepsAlerta {
  return { env, ahora: Date.now, base: urlDespacho(env), registro: registroNeon(), enviar: enviarWebhook }
}

/** Manda una alerta del sistema a Discord. Nunca tira. */
export async function alertar(a: Alerta, deps: DepsAlerta = depsAlertasReales()): Promise<ResultadoAlerta> {
  try { return await alertarCon(a, deps) } catch (e) {
    console.error(`[alertas] ${a.tipo}: falló (${String((e as Error)?.name ?? 'error').slice(0, 40)})`)
    return { estado: 'error', motivo: 'falló el armado de la alerta' }
  }
}

/** Para pantallas de estado: las últimas alertas (sin textos ni URLs). */
export async function ultimasAlertas(n = 50): Promise<Record<string, unknown>[]> {
  if (!url()) return []
  const q = neon(url(), { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
  try {
    await asegurar(q)
    return (await q`SELECT clave, canal, tipo, id_crm, resumen, estado, motivo, intentos, creado, enviado FROM cj_alertas_discord ORDER BY id DESC LIMIT ${Math.min(200, Math.max(1, n))}`) as Record<string, unknown>[]
  } catch { return [] }
}
