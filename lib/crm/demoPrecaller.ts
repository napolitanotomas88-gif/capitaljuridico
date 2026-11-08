// Leads de mentira del tablero de práctica del pre-caller (`/ventas/demo-precaller`). Puro: sin red ni planilla.

import { PRECALLER } from "@/lib/crm/config/precallV2";
import { formatearFechaSheet } from "@/lib/crm/fechas";
import { COLUMNAS, type Campo, type FilaLead } from "@/lib/crm/sheets/columnas";

export const HOJA_DEMO = "Demo";
export const HORA = 60 * 60 * 1000;

function filaDemo(numeroFila: number, valores: Partial<Record<Campo, string>>): FilaLead {
  const base = Object.fromEntries(Object.keys(COLUMNAS).map((c) => [c, ""])) as Record<Campo, string>;
  return { hoja: HOJA_DEMO, numeroFila, valores: { ...base, telefono: "5490000000000", ...valores } };
}

/** Dos leads por columna: Llamar, Seguimiento por chat, Confirmó: pasar al closer y Reagendar o cancelar. */
export function leadsIniciales(ahora: Date): FilaLead[] {
  const manana = formatearFechaSheet(new Date(ahora.getTime() + 20 * HORA));
  const pasada = formatearFechaSheet(new Date(ahora.getTime() - 2 * HORA));
  const calendario = (mensual: string, contextoAgenda: string, urgencia: string) => ({ mensual, contextoAgenda, urgencia });
  return [
    filaDemo(2, { nombre: "Lucía Demo (Marcos)", fechaCall: manana, ...calendario("USD 8.000", "Estudio de 3 abogados, laboral", "Alta") }),
    filaDemo(3, { nombre: "Martín Prueba (Nahuel)", fechaCall: manana, ...calendario("USD 3.000", "Abogado solo, familia", "Media") }),
    filaDemo(4, { nombre: "Ana Ficticia (Marcos)", fechaCall: manana, contactoPrecaller: PRECALLER.noAtendio2 }),
    filaDemo(5, { nombre: "Pedro Ejemplo (Nahuel)", fechaCall: manana, contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: "S2" }),
    filaDemo(6, { nombre: "Sofía Demo (Marcos)", fechaCall: manana, contactoPrecaller: PRECALLER.llamadaEfectiva }),
    filaDemo(7, { nombre: "Juan Prueba (Nahuel)", fechaCall: manana, contactoPrecaller: PRECALLER.noAtendio2, confirmoPrecaller: PRECALLER.confirmo }),
    filaDemo(8, { nombre: "Carla Ficticia (Marcos)", fechaCall: manana, contactoPrecaller: PRECALLER.noAtendio2, seguimientosPrecaller: "S4" }),
    filaDemo(9, { nombre: "Diego Demo (Nahuel)", fechaCall: pasada, contactoPrecaller: PRECALLER.porChat }),
  ];
}

