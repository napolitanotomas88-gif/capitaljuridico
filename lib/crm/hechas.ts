// Operaciones de "Log App" (docs/arquitectura.md §Hechas hoy): el log tiene una fila por celda;
// acá se agrupan por operación (una escritura = una operación, con todas sus celdas) y se marcan
// las que se deshicieron. Lo usan "Hechas hoy" (con Deshacer), el progreso del día, el tablero
// de admin y `deshacerOperacion`. Funciones puras: sin red ni "server-only".

import type { EntradaLog, OperacionHecha } from "@/lib/crm/contratos";
import { horaCorta, mismoDia, parsearFechaSheet } from "@/lib/crm/fechas";
import { claveFaseHoy, claveFaseHoyPorF } from "@/lib/crm/motor/proxima-accion";

/** El motivo que escribe `deshacer`: "Deshacer: <motivo original>". */
export const esMotivoDeshacer = (motivo: string) => /^deshacer:/i.test(motivo.trim());

export type OperacionLog = OperacionHecha & {
  /** Es un Deshacer (no se lista en "Hechas hoy" ni se cuenta como hecha). */
  esDeshacer: boolean;
};

/**
 * Agrupa el log por operación, en el orden de la planilla (más vieja primero). La clave es el id
 * más la fecha: todas las celdas de una escritura comparten las dos, y así dos ids repetidos en
 * días distintos (son 8 hex al azar) no se mezclan.
 *
 * Cada Deshacer marca como `deshecha` a la operación anterior más reciente de la misma fila cuyas
 * columnas cubre (deshacer restaura exactamente las celdas que la operación cambió).
 */
export function agruparOperaciones(log: readonly EntradaLog[]): OperacionLog[] {
  const porClave = new Map<string, OperacionLog>();
  const orden: OperacionLog[] = [];
  for (const e of log) {
    if (!e.operacion.trim()) continue;
    const clave = `${e.operacion}\u0000${e.fecha}`;
    let op = porClave.get(clave);
    if (!op) {
      const fecha = parsearFechaSheet(e.fecha);
      op = {
        idOperacion: e.operacion,
        hora: fecha ? horaCorta(fecha) : "",
        fecha: e.fecha,
        closer: e.closer,
        hoja: e.hoja,
        fila: e.fila,
        lead: e.lead,
        motivo: e.motivo,
        cambios: [],
        deshecha: false,
        esDeshacer: esMotivoDeshacer(e.motivo),
      };
      porClave.set(clave, op);
      orden.push(op);
    }
    op.cambios.push({ columna: e.columna, campo: e.campo, antes: e.antes, despues: e.despues });
  }

  orden.forEach((deshacer, i) => {
    if (!deshacer.esDeshacer) return;
    const columnas = new Set(deshacer.cambios.map((c) => c.columna));
    for (let j = i - 1; j >= 0; j--) {
      const op = orden[j];
      if (op.esDeshacer || op.deshecha || op.hoja !== deshacer.hoja || op.fila !== deshacer.fila) continue;
      if (op.cambios.every((c) => columnas.has(c.columna))) {
        op.deshecha = true;
        return;
      }
    }
  });
  return orden;
}

const esDeHoy = (op: OperacionLog, ahora: Date) => {
  const fecha = parsearFechaSheet(op.fecha);
  return fecha !== null && mismoDia(fecha, ahora);
};

/** Sin el campo interno `esDeshacer`, para mandarlo al cliente. */
function paraCliente(op: OperacionLog): OperacionHecha {
  const { idOperacion, hora, fecha, closer, hoja, fila, lead, motivo, cambios, deshecha } = op;
  return { idOperacion, hora, fecha, closer, hoja, fila, lead, motivo, cambios, deshecha };
}

/**
 * "Hechas hoy" de una hoja: las operaciones de hoy (hora de Buenos Aires), la más nueva primero,
 * sin los Deshacer (se reflejan en `deshecha` de la operación que deshicieron). Incluye las que
 * hizo el admin sobre esa hoja (`closer` dice quién fue).
 */
export function operacionesDeHoy(log: readonly EntradaLog[], hoja: string, ahora: Date): OperacionHecha[] {
  return agruparOperaciones(log)
    .filter((op) => op.hoja === hoja && !op.esDeshacer && esDeHoy(op, ahora))
    .reverse()
    .map(paraCliente);
}

/**
 * Leads a los que hoy ya se les mandó una fase del pre-call desde la app: operaciones de `hechas`
 * (las de hoy, `operacionesDeHoy`) no deshechas que escribieron F. Para el estado "… enviada hoy"
 * de la tarjeta de pre-call y `listoPorHoy` (el Enviado del pre-call no escribe AG:
 * `tocaUltimoToque`). Dos claves por envío, las dos del motor: `claveFaseHoy` (hoja + fila del log +
 * nombre del lead) y `claveFaseHoyPorF` (hoja + nombre + el F que se escribió), para reconocer al lead
 * aunque después alguien haya insertado u ordenado filas y ya no esté en la fila del log.
 */
export function precallEnviadoHoy(hechas: readonly OperacionHecha[]): Set<string> {
  const leads = new Set<string>();
  for (const op of hechas) {
    const fase = op.cambios.find((c) => c.campo === "precall");
    if (op.deshecha || !fase) continue;
    leads.add(claveFaseHoy(op.hoja, op.fila, op.lead));
    if (fase.despues.trim()) leads.add(claveFaseHoyPorF(op.hoja, op.lead, fase.despues));
  }
  return leads;
}

/**
 * `precallEnviadoHoy` de todas las hojas a la vez, directo del log (para el admin, que ya lee el log
 * entero para "hechas hoy": sin otra lectura de la API). La clave lleva la hoja, así que un solo set
 * sirve para todos los closers.
 */
export function precallEnviadoHoyEnLog(log: readonly EntradaLog[], ahora: Date): Set<string> {
  return precallEnviadoHoy(agruparOperaciones(log).filter((op) => !op.esDeshacer && esDeHoy(op, ahora)));
}

/**
 * Acciones netas de hoy por hoja (para el admin y el progreso): operaciones de hoy que no son un
 * Deshacer ni se deshicieron, sin contar las que hizo `excluir` (el admin) sobre esa hoja. `cuenta`
 * (opcional) filtra por motivo: el admin pasa `esDeTarjeta` de pantalla.ts para que los guardados de
 * la ficha no sumen (se recibe por parámetro para no importar pantalla.ts desde acá).
 */
export function hechasHoyPorHoja(log: readonly EntradaLog[], ahora: Date, excluir?: string, cuenta?: (motivo: string) => boolean): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (const op of agruparOperaciones(log)) {
    if (op.esDeshacer || op.deshecha || !esDeHoy(op, ahora)) continue;
    if (excluir !== undefined && op.closer === excluir) continue;
    if (cuenta && !cuenta(op.motivo)) continue;
    resultado[op.hoja] = (resultado[op.hoja] ?? 0) + 1;
  }
  return resultado;
}
