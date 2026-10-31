import {
  actividadReciente,
  callsDelDia,
  conFichaVigente,
  conteosDelDia,
  metricasPeriodo,
  sumarMetricas,
  type EntradaActividad,
  type Metricas,
  type Periodo,
} from "@/lib/crm/admin";
import { instagramDeAgenda } from "@/lib/crm/instagramCalendly";
import { NOMBRE_ADMIN } from "@/lib/crm/auth";
import { closers, nombreCloserDeHoja } from "@/lib/crm/config";
import type { CallDelDia, FichaLead, ItemCliente, OperacionHecha, PanelFicha } from "@/lib/crm/contratos";
import { hechasHoyPorHoja, operacionesDeHoy, precallEnviadoHoy, precallEnviadoHoyEnLog } from "@/lib/crm/hechas";
import { accionesDeFila, accionesDelDia, type ContextoDia, type Grupo } from "@/lib/crm/motor/proxima-accion";
import { esDeTarjeta } from "@/lib/crm/pantalla";
import { armarItem, callsDelDiaDe, identidadDe } from "@/lib/crm/presentacion";
import type { FilaLead } from "@/lib/crm/sheets/columnas";
import { leerDesplegables } from "@/lib/crm/sheets/desplegables";
import { leerHojas } from "@/lib/crm/sheets/leer";
import { historialDeFila, leerLog } from "@/lib/crm/sheets/log";

// Datos para las pantallas (docs/arquitectura.md §Datos para la pantalla). Todo serializable.

export type { FichaLead } from "@/lib/crm/contratos";

/** Motor + WhatsApp sobre las filas ya leídas de una hoja (una tarjeta por acción). */
function itemsDelDia(filas: FilaLead[], ahora: Date, dia: ContextoDia): ItemCliente[] {
  return accionesDelDia(filas, ahora, dia).map(({ fila, accion }) => armarItem(fila, accion, ahora));
}

export type DatosMiDia = {
  /**
   * La lista del día: una tarjeta por acción, con WhatsApp. Un lead puede tener dos (la de
   * pre-call y la principal, en columnas distintas).
   */
  items: ItemCliente[];
  /** TODAS las calls de hoy (D o AC de hoy), con o sin acción pendiente, por hora. */
  calls: CallDelDia[];
  /** "Hechas hoy" según "Log App": una entrada por operación, la más nueva primero, con `deshecha`. */
  hechas: OperacionHecha[];
};

/**
 * Todo lo de la pantalla "Mi día" con una sola lectura de la hoja y una del log (las dos con su
 * caché de 30 s, que se invalida al escribir): la lista del día, la tira de calls de hoy y
 * "Hechas hoy" (progreso del día y Deshacer).
 */
export async function datosMiDia(hoja: string, ahora: Date): Promise<DatosMiDia> {
  const [hojas, log] = await Promise.all([leerHojas([hoja]), leerLog()]);
  const filas = hojas.get(hoja) ?? [];
  const hechas = operacionesDeHoy(log, hoja, ahora);
  // Del log: a quién ya se le mandó hoy una fase del pre-call (el Enviado del pre-call no escribe AG).
  const dia: ContextoDia = { precallHoy: precallEnviadoHoy(hechas) };
  return {
    items: itemsDelDia(filas, ahora, dia),
    calls: callsDelDiaDe(filas, ahora, dia),
    hechas,
  };
}

export type ResumenCloser = {
  id: string;
  nombre: string;
  hoja: string;
  /**
   * Tarjetas pendientes de hoy: un lead puede sumar dos (en Pre-call y en otra columna). Sin los
   * pre-calls "listos por hoy" (como en la pantalla del closer).
   */
  pendientes: number;
  atrasados: number;
  /** Tarjetas pendientes de hoy por columna (la de pre-calls cuenta las del grupo precall). */
  porGrupo: Record<Grupo, number>;
  /** Calls (o reagendas) de hoy en la hoja. */
  callsHoy: number;
  /** Acciones netas de hoy en su hoja según "Log App" (sin Deshacer, sin las deshechas ni las del admin). */
  hechasHoy: number;
  /** Métricas del período elegido (7 o 30 días), solo lectura de la hoja. */
  metricas: Metricas;
};

export type TableroAdmin = {
  equipo: ResumenCloser[];
  totales: { pendientes: number; atrasados: number; callsHoy: number; hechasHoy: number };
  metricasEquipo: Metricas;
  /** Últimas 30 filas del log, la más nueva primero (`fichaVigente`: el lead sigue en esa fila). */
  actividad: EntradaActividad[];
};

/**
 * Para /admin: una fila por closer con los conteos del día, métricas y actividad. Un solo batchGet +
 * una lectura del log, que sirve para "hechas hoy" y para saber a qué leads ya se les mandó una fase
 * del pre-call hoy (los "listos por hoy" no cuentan como pendientes, igual que en la pantalla del closer).
 */
export async function tableroAdmin(ahora: Date, dias: Periodo): Promise<TableroAdmin> {
  const lista = closers();
  const [datos, log] = await Promise.all([leerHojas(lista.map((c) => c.hoja)), leerLog()]);
  const hechas = hechasHoyPorHoja(log, ahora, NOMBRE_ADMIN, esDeTarjeta);
  const dia: ContextoDia = { precallHoy: precallEnviadoHoyEnLog(log, ahora) };

  const equipo = lista.map((c): ResumenCloser => {
    const filas = datos.get(c.hoja) ?? [];
    return {
      id: c.id,
      nombre: c.nombre,
      hoja: c.hoja,
      ...conteosDelDia(filas, ahora, dia),
      callsHoy: callsDelDia(filas, ahora),
      hechasHoy: hechas[c.hoja] ?? 0,
      metricas: metricasPeriodo(filas, ahora, dias),
    };
  });

  const totales = equipo.reduce(
    (t, c) => ({
      pendientes: t.pendientes + c.pendientes,
      atrasados: t.atrasados + c.atrasados,
      callsHoy: t.callsHoy + c.callsHoy,
      hechasHoy: t.hechasHoy + c.hechasHoy,
    }),
    { pendientes: 0, atrasados: 0, callsHoy: 0, hechasHoy: 0 },
  );

  return {
    equipo,
    totales,
    metricasEquipo: sumarMetricas(
      equipo.map((c) => c.metricas),
      dias,
    ),
    actividad: conFichaVigente(actividadReciente(log), datos),
  };
}

/**
 * Todo lo que muestra la ficha. null si la fila no existe, está vacía o no tiene nombre. El
 * historial es el del lead que hoy está en esa fila (hoja + fila + nombre): la hoja y el log se
 * leen en paralelo y después se filtra (con la caché del log, sin otra lectura).
 */
export async function datosDelLead(hoja: string, numeroFila: number, ahora = new Date()): Promise<FichaLead | null> {
  const [filas, log] = await Promise.all([leerHojas([hoja]), leerLog()]);
  const fila = (filas.get(hoja) ?? []).find((f) => f.numeroFila === numeroFila);
  if (!fila || !fila.valores.nombre.trim()) return null;
  const dia: ContextoDia = { precallHoy: precallEnviadoHoy(operacionesDeHoy(log, hoja, ahora)) };
  const [instagram, historial] = await Promise.all([instagramDeAgenda(fila.valores), historialDeFila(hoja, numeroFila, fila.valores.nombre)]);
  return {
    instagram,
    identidad: identidadDe(fila),
    valores: fila.valores,
    items: accionesDeFila(fila, ahora, dia).map((accion) => armarItem(fila, accion, ahora)),
    historial,
  };
}

/** La ficha más lo que necesita para abrirse sola (panel lateral): lista de V, closer y hora. */
export async function panelFicha(hoja: string, numeroFila: number, ahora = new Date()): Promise<PanelFicha | null> {
  const [ficha, desplegables] = await Promise.all([datosDelLead(hoja, numeroFila, ahora), leerDesplegables(hoja)]);
  if (!ficha) return null;
  return { ficha, situaciones: desplegables.situacion, closer: nombreCloserDeHoja(hoja), ahoraISO: ahora.toISOString() };
}
