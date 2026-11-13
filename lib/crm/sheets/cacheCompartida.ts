// ── Caché compartida del CRM de ventas: nombres de claves y etiquetas (velocidad, tanda 2) ──────────────────────────
// La usan leer.ts (hojas de los closers) y log.ts ("Log App"). La clave lleva un resumen del id de la planilla para que una
// copia (preview que apunta a otra planilla) nunca lea lo guardado de la original, sin poner el id en la clave.
import { createHash } from "node:crypto";

/** Etiqueta de todo el CRM de ventas: invalidarCache() sin hoja la usa. */
export const ETIQUETA_CRM_VENTAS = "crm-ventas";

/** `prefijo:<8 hex del id de la planilla>`. */
export function claveDePlanilla(prefijo: string, idPlanilla: string): string {
  return `${prefijo}:${createHash("sha256").update(idPlanilla).digest("hex").slice(0, 8)}`;
}
