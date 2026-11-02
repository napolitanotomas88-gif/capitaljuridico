// ── Bot "Capital Jurídico": RASTROS de las corridas con clientes de prueba (Neon, tabla cj_prueba_rastros) — solo servidor ──
// Cada acción EXTERNA que una etapa hace por un cliente de prueba (BOT_CLIENTES_PRUEBA, lib/bot/clientesPrueba.ts) deja una
// fila: qué etapa, qué cliente, qué tipo (whatsapp | discord), dónde (chat de WhatsApp o el NOMBRE de la variable del webhook
// de Discord, nunca la URL) y el id del mensaje. Con eso, scripts/limpiar-cliente-prueba-<etapa>.mjs borra todo después.
// Nunca tira: si la base falla, lo dice el log (sin valores) y la acción sigue.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

export type TipoRastro = 'whatsapp' | 'discord'
export interface Rastro { etapa: string; idCrm: string; tipo: TipoRastro; destino: string; ref: string | null; detalle?: Record<string, unknown> }
export type RegistrarRastro = (r: Rastro) => Promise<void>

export const TABLA_RASTROS = 'cj_prueba_rastros'
const TOPE_MS = 8_000

type Sql = NeonQueryFunction<false, false>
let tablaLista: Promise<void> | null = null

export async function asegurarTablaRastros(q: Sql): Promise<void> {
  tablaLista ??= (async () => {
    await q`CREATE TABLE IF NOT EXISTS cj_prueba_rastros (
      id bigserial PRIMARY KEY, etapa text NOT NULL, id_crm text NOT NULL, tipo text NOT NULL, destino text NOT NULL,
      ref text, detalle jsonb NOT NULL DEFAULT '{}'::jsonb, borrado timestamptz, creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE INDEX IF NOT EXISTS cj_prueba_rastros_etapa ON cj_prueba_rastros (etapa, id_crm, creado)`
  })().catch((e) => { tablaLista = null; throw e })
  return tablaLista
}

/** El registrador real (Neon). Sin DATABASE_URL no registra nada (y lo avisa una vez). */
export function registradorRastros(env: NodeJS.ProcessEnv = process.env, log: { warn(m: string): void } = console): RegistrarRastro {
  return async (r) => {
    const url = env.DATABASE_URL?.trim()
    if (!url) { log.warn('rastros de prueba: sin DATABASE_URL, no se registró la acción'); return }
    try {
      const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_MS) } })
      await asegurarTablaRastros(q)
      await q`INSERT INTO cj_prueba_rastros (etapa, id_crm, tipo, destino, ref, detalle) VALUES (${r.etapa}, ${r.idCrm}, ${r.tipo}, ${r.destino}, ${r.ref}, ${JSON.stringify(r.detalle ?? {})}::jsonb)`
    } catch (e) {
      log.warn(`rastros de prueba: no se pudo registrar (${String((e as Error)?.name ?? 'error').slice(0, 40)})`)
    }
  }
}

/** Registrador en memoria (tests). */
export function rastrosEnMemoria(): RegistrarRastro & { lista: Rastro[] } {
  const lista: Rastro[] = []
  const f = (async (r: Rastro) => { lista.push({ ...r }) }) as RegistrarRastro & { lista: Rastro[] }
  f.lista = lista
  return f
}
