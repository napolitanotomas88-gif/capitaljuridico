// ── Errores transitorios (se reintentan) vs. definitivos ────────────────────────────────────────
// procesar.ts reintenta UNA vez, dentro de la misma invocación, el paso que falló si el error es transitorio y queda
// tiempo hasta el deadline. Cada adaptador marca los suyos con `transitorio: true`:
//   · Claude (extraer.ts): 429, 5xx, 529 "overloaded", error a mitad del stream, conexión caída o cortada;
//   · Discord (discord.ts): 5xx después de sus propios reintentos, timeout de 15 s, sin conexión, 429 que no entra en el tiempo;
//   · Neon (registro.ts): sin conexión, 5xx del servicio o consulta de más de 10 s.
// Lo demás (400, 401, 404, un rechazo de Claude, un JSON roto) es definitivo: reintentar enseguida daría lo mismo.
// Igual, cualquier fila en "error" la vuelve a tomar el cron del día siguiente (procesar.ts / reintentarPendientes).

export class ErrorTransitorio extends Error {
  readonly transitorio = true
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorTransitorio'
  }
}

export const esTransitorio = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { transitorio?: unknown }).transitorio === true
