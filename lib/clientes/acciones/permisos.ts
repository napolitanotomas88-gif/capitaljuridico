// ── Quién puede hacer acciones sobre clientes desde la tarjeta ───────────────────────────────────────────────────────────
// Tomás (27/10/2026, por el orquestador del Hub): «Gero M - GERO A - AYLU Y TOMAS NAPOLITANO», para TODAS las acciones
// (editar datos, sumar servicio, pausar, reanudar, deshacer y, cuando estén, archivar y pagos). Por mail, no por rol: son las
// mismas cuatro personas que aprueban altas, así que se reusa esa lista (lib/bot/alta/despacho/aprobadores.ts: variables
// EDICION_REVISOR_TOMAS / KICKOFF_REVISOR_TOMI / KICKOFF_REVISOR_GERO_M / EDICION_REVISOR_AYLU + BOT_ALTA_APROBADORES_EMAIL).
// Pagos, además, piden la sección Finanzas (se chequea aparte). Puro, sin red.
import { aprobadoresDesdeEntorno, mailNormalizado } from '@/lib/bot/alta/despacho/aprobadores'

type Entorno = NodeJS.ProcessEnv

export function puedeHacerAcciones(email: string | null | undefined, env: Entorno = process.env): boolean {
  const m = mailNormalizado(email)
  return !!m && aprobadoresDesdeEntorno(env).some(a => a.email === m)
}
