// ── Bot "Capital Jurídico": motor de altas (BLOQUE O) — punto de entrada ─────────────────────────────────────────────
// crearMotorAltas(deps) es lo único que usa la ruta del webhook de Whapi (BLOQUE W): recibe el modo, las capacidades, los
// grupos y el cliente de Whapi (con su compuerta) y arma el orquestador con las dependencias reales de servidor.ts (Neon,
// Sheets, Drive, PandaDoc, Claude, MEP), que respetan el modo: en seco no hay ninguna lectura externa y nada se escribe.
// Los tests no pasan por acá: usan crearOrquestador (orquestador.ts) con un almacén en memoria y dependencias de juguete.
import type { CrearMotorAltas } from './tipos'
import { crearOrquestador } from './orquestador'
import { depsServidor } from './servidor'

export const crearMotorAltas: CrearMotorAltas = (deps) => crearOrquestador(depsServidor(deps))

export { crearOrquestador, vistaAlta, veredictoDe, type DepsOrquestador, type MotorAltasO } from './orquestador'
export { almacenEnMemoria } from './almacen'
