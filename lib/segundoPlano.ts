// ── Trabajo «de fondo» que tiene que terminar aunque la respuesta ya haya salido ─────────────────────────────
// En Vercel la función se congela apenas se envía la respuesta: una promesa que la página dejó corriendo (la lectura
// de Meta o de Drive que superó el tope de espera, el refresco de un snapshot) queda a medias y la caché nunca se
// llena. `after()` de Next le avisa a la plataforma que espere esa promesa (hasta el maxDuration de la ruta).
//
// `after()` solo existe dentro de un pedido o render de Next: en crons armados a mano, scripts y pruebas tira un
// error. Ahí el proceso sigue vivo y la promesa termina sola, así que el error se ignora.
import { after } from 'next/server'

/** Registra una promesa para que termine aunque se cierre la respuesta. Nunca tira y nunca deja un rechazo suelto. */
export function enSegundoPlano(promesa: Promise<unknown>): void {
  const silenciosa = promesa.then(() => undefined, () => undefined)   // el error lo maneja quien lanzó la lectura
  try { after(silenciosa) } catch { /* fuera de un pedido de Next (scripts, pruebas): la promesa sigue igual */ }
}
