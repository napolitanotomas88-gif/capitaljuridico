// ── Kickoffs: que Valentino no reciba dos mensajes por la misma llamada ──────────────────────────
// Pedido de Tomás (24/10/2026): en una kickoff, Valentino recibe SOLO el «🚀 Para lanzar» del bot de kickoff
// (lib/bot/kickoff/aviso-ads.ts). Las dos rutas reciben las mismas grabaciones de Tomás (dos webhooks de Fathom), así que
// antes de mandar, procesar.ts mira cómo clasificó la llamada el bot de kickoff en cj_kickoffs (solo LECTURA: la tabla es
// de lib/bot/kickoff, acá nunca se escribe):
//   · kickoff "lista" (el «🚀 Para lanzar» sale de ahí) → la grabación queda "omitida" (motivo con PREFIJO_KICKOFF) y
//     no sale nada;
//   · no es kickoff (la ficha dice otro tipo, o "no_kickoff") → sigue como siempre;
//   · todavía sin decidir (en "procesando", con o sin ficha, o la base no respondió) → espera, consultando cada
//     ESPERA_KICKOFF_PASO_MS, hasta ESPERA_KICKOFF_MAX_MS desde que arrancó la grabación;
//   · sin fila, omitida, error (aunque la ficha sea de kickoff: el «Para lanzar» no salió), colgada en "procesando" más
//     de 10 minutos, o sin decidir pasado el tope → sigue como siempre: mejor un mensaje de más que dejar a Valentino sin
//     nada o perder el cambio de un seguimiento.
// El bot de kickoff guarda la ficha (con tipo_reunion) apenas sale de Claude, con la fila todavía en "procesando"
// (guardarFicha de lib/bot/kickoff/registro.ts): un seguimiento se sabe a ~1 minuto del webhook y una kickoff llega a
// "lista" a los ~2–2,5 minutos. Una fila "duplicada" (la misma reunión la grabó Gero M primero) decide por la original
// (duplicada_de). Si el «Para lanzar» está apagado o sin canal (servidor.ts), ni se mira.

export const PREFIJO_KICKOFF = 'kickoff:'
export const MOTIVO_KICKOFF = `${PREFIJO_KICKOFF} la llamada es una kickoff: Valentino recibe el «🚀 Para lanzar» del bot de kickoff`
export const ESPERA_KICKOFF_PASO_MS = 10_000
export const ESPERA_KICKOFF_MAX_MS = 210_000
export const TOPE_LECTURA_KICKOFF_MS = 4_000      // por consulta: es best effort, no puede comerse el margen para mandar

/** Lo que se lee de una fila de cj_kickoffs. tipo = ficha.tipo_reunion (null si todavía no hay ficha); colgada = sin
 *  cambios hace más de 10 minutos (la función del bot de kickoff murió). */
export interface FilaKickoffLeida { estado: string; tipo: string | null; duplicada_de: number | null; colgada?: boolean }
export interface ConsultaKickoff { fila: FilaKickoffLeida | null; original: FilaKickoffLeida | null }

export type DecisionKickoff = 'kickoff' | 'no_kickoff' | 'pendiente' | 'desconocido'

function decidirFila(f: FilaKickoffLeida): DecisionKickoff {
  if (f.estado === 'lista') return 'kickoff'
  if (f.estado === 'no_kickoff' || (f.tipo && f.tipo !== 'kickoff')) return 'no_kickoff'
  if (f.estado === 'procesando') return f.colgada ? 'desconocido' : 'pendiente'
  return 'desconocido'
}

export function decidirKickoff(c: ConsultaKickoff | null): DecisionKickoff {
  const f = c?.fila
  if (!f) return 'desconocido'
  if (f.estado !== 'duplicada') return decidirFila(f)
  // Una duplicada no tiene ficha propia: decide la original; si la original también es duplicada, no se sigue la cadena
  return c.original && c.original.estado !== 'duplicada' ? decidirFila(c.original) : 'desconocido'
}
