// ── Bot "Capital Jurídico": etapa BAJA — clientes de prueba (variable COMÚN BOT_CLIENTES_PRUEBA) — puro, sin red ─────────
// Para hacer una corrida punta a punta con un cliente ficticio sin tocar a nadie más. Cada etapa del bot que la use:
//   · corre en REAL solo para esos IDs del CRM aunque su modo general esté apagado (seco);
//   · con el modo general apagado, jamás toca a otro cliente (el resto sigue en seco);
//   · con el modo general prendido, esos IDs quedan fuera del flujo general (los atiende solo el modo prueba).
// Formato: IDs del CRM separados por coma, espacio o punto y coma ("Z001, Z002"). Lo que no sea un ID se ignora.
// Doble seguro: además de estar en la lista, la fila del CRM tiene que llamarse "PRUEBA BOT…" (el mismo prefijo que usan
// las pruebas del alta y del CRM). Así un ID mal tipeado nunca apunta a un cliente real.

export const VARIABLE_CLIENTES_PRUEBA = 'BOT_CLIENTES_PRUEBA'
export const PREFIJO_NOMBRE_PRUEBA = 'PRUEBA BOT'
const ID_CRM = /^[A-Z]\d{1,6}$/

/** IDs del CRM de la lista blanca (en mayúsculas, sin repetidos). Vacía = no hay modo prueba. */
export function clientesPrueba(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set((env[VARIABLE_CLIENTES_PRUEBA] ?? '').split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter((x) => ID_CRM.test(x)))]
}

/** ¿Ese ID del CRM está en la lista blanca? */
export function esClientePrueba(idCrm: string | null | undefined, lista: readonly string[]): boolean {
  return !!idCrm && lista.includes(idCrm.trim().toUpperCase())
}

/** ¿La fila del CRM es de prueba? (nombre "PRUEBA BOT…", sin importar mayúsculas ni espacios de más). */
export function nombreDePrueba(nombre: string | null | undefined): boolean {
  return (nombre ?? '').trim().replace(/\s+/g, ' ').toUpperCase().startsWith(PREFIJO_NOMBRE_PRUEBA)
}

/** Lo que exige el modo prueba para tocar a un cliente: estar en la lista Y ser una fila "PRUEBA BOT…". */
export function clienteDePrueba(c: { id: string | null | undefined; nombre: string | null | undefined }, lista: readonly string[]): boolean {
  return esClientePrueba(c.id, lista) && nombreDePrueba(c.nombre)
}
