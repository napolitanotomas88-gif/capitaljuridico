// ── Bot "Capital Jurídico": CLIENTES DE PRUEBA comunes a todas las etapas (puro, sin red) ─────────────────────────────────
// BOT_CLIENTES_PRUEBA = lista de IDs del CRM separados por coma ("Z001" o "Z001, Z002"). Pedido de Tomás (1/11/2026): poder
// hacer una corrida punta a punta con un cliente FICTICIO, como si hubiera hecho todo el caminito, sin tocar a nadie real.
// Reglas (cada etapa las aplica con estas funciones):
//   · un cliente de la lista corre la etapa EN REAL (todas sus capacidades) aunque el modo general esté en seco o ensayo;
//   · con el modo general en seco o ensayo, NADIE que no esté en la lista recibe nada (el modo general se respeta igual);
//   · sin la variable (o vacía) no cambia nada: cada etapa sigue con su modo.
//   · cada acción externa sobre un cliente de prueba deja un rastro (lib/bot/rastrosPrueba.ts) para poder borrarla después.
// Solo IDs con forma de ID del CRM (una letra y de 1 a 6 dígitos): un valor raro se ignora (nunca "todos").

export const PATRON_ID_PRUEBA = /^[A-Za-z]\d{1,6}$/

/** "Z001, z002 ; basura" → {Z001, Z002}. */
export function clientesPrueba(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set((env.BOT_CLIENTES_PRUEBA ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => PATRON_ID_PRUEBA.test(x)).map((x) => x.toUpperCase()))
}

export const hayClientesPrueba = (env: NodeJS.ProcessEnv = process.env): boolean => clientesPrueba(env).size > 0

/** ¿Este ID del CRM es de un cliente de prueba? null / vacío → no. */
export function esClientePrueba(idCrm: string | null | undefined, ids: ReadonlySet<string> = clientesPrueba()): boolean {
  const t = (idCrm ?? '').trim().toUpperCase()
  return !!t && ids.has(t)
}

/** Prefijo de los mensajes AL EQUIPO (Verificaciones, Discord) que salen por un cliente de prueba. */
export const PREFIJO_PRUEBA = '🧪 PRUEBA (cliente ficticio)'
export const conPrefijoPrueba = (texto: string): string => (texto.trimStart().startsWith(PREFIJO_PRUEBA) ? texto : `${PREFIJO_PRUEBA}\n\n${texto}`)
