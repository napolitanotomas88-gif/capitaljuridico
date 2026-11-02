// ── Clientes SIN fecha de fin (variable BOT_CLIENTES_SIN_FIN) — puro, sin red ───────────────────────────────────────────
// Algunos clientes no tienen fin de servicio: su programa es «hasta alcanzar los objetivos» (decisión de Tomás, 2/11/2026).
// En el CRM pueden figurar con una fecha de fin (la del alta) y esa fila NO se toca: el CRM queda como está. Lo que cambia
// es cómo la leen el bot y el Despacho. Para los IDs de la lista:
//   · Bajas: sin aviso de fin (i01), sin cruce de la llamada de renovación por cercanía al fin ni FINALIZADO propuesto por
//     fin vencido (i02/i04: si alguna vez se van, se pregunta), y fuera de la lista de recontacto (i05).
//   · Despacho: sin semáforo de vencimiento (queda «Sin fecha»), sin días para vencer, fuera de «Renovación pendiente»,
//     de las llamadas de proyección y de la etapa Renovación del recorrido.
// Formato: IDs del CRM separados por coma, espacio o punto y coma ("A001, A002"). Lo que no sea un ID se ignora.
// El repositorio es público: los IDs reales van SOLO en la variable, nunca en el código.

export const VARIABLE_CLIENTES_SIN_FIN = 'BOT_CLIENTES_SIN_FIN'
const ID_CRM = /^[A-Z]\d{1,6}$/

/** IDs del CRM sin fecha de fin (en mayúsculas, sin repetidos). Vacía = ninguno. */
export function clientesSinFin(env: Record<string, string | undefined> = process.env): string[] {
  return [...new Set((env[VARIABLE_CLIENTES_SIN_FIN] ?? '').split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter((x) => ID_CRM.test(x)))]
}

/** ¿Ese ID del CRM está en la lista de clientes sin fin? */
export function esSinFin(idCrm: string | null | undefined, lista: readonly string[]): boolean {
  return !!idCrm && lista.includes(idCrm.trim().toUpperCase())
}
