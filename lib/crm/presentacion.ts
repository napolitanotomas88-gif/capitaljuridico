// Arma lo que ve el cliente a partir de una fila y su acción: hora corta y link de WhatsApp.
// Funciones puras (docs/arquitectura.md §Datos para la pantalla). La app no sugiere textos de
// mensajes (decisión de Gero del 28/09/2026): el closer los saca del doc "Mensajes" de la barra.

import { SITUACIONES_CERRADAS, VALORES } from "@/lib/crm/config/crm";
import type { AccionCliente, CallDelDia, Identidad, ItemCliente, ValoresEscribibles } from "@/lib/crm/contratos";
import { formatearCorto, horaCorta, mismoDia, parsearFechaReagenda, parsearFechaSheet } from "@/lib/crm/fechas";
import { accionesDeFila, type Accion, type ContextoDia } from "@/lib/crm/motor/proxima-accion";
import { CAMPOS_ESCRIBIBLES, type FilaLead } from "@/lib/crm/sheets/columnas";
import { normalizarTexto, soloDigitos } from "@/lib/crm/sheets/verificacion";

/**
 * El chat de WhatsApp con el lead, sin texto cargado: el closer escribe el mensaje según su guía.
 * La columna B ya trae el código de país; solo se sacan los no-dígitos.
 */
export function urlWhatsApp(telefono: string): string {
  return `https://web.whatsapp.com/send?phone=${digitosWhatsApp(telefono)}`;
}

/**
 * El teléfono como lo identifica WhatsApp (y 2Chat): solo dígitos y, en un celular argentino cargado sin el 9 ("+54 358
 * 482-3217", 54 + 10 dígitos), con el 9 ("5493580000001"). Los demás países quedan como están.
 */
export function digitosWhatsApp(telefono: string): string {
  const d = soloDigitos(telefono);
  return d.length === 12 && d.startsWith("54") && d[2] !== "9" ? `549${d.slice(2)}` : d;
}

/**
 * WhatsApp Web para todas las pestañas, sin texto precargado (pedido de Gero, 30/10/2026).
 * Se conserva la firma y el indicador para los consumidores existentes del contrato.
 * La cuenta remitente es la sesión que el closer tiene abierta en WhatsApp Web.
 */
export function urlChat(_hoja: string, telefono: string): { url: string; es2Chat: boolean } {
  return { url: urlWhatsApp(telefono), es2Chat: false };
}

/** `${hoja}:${numeroFila}`: el lead (`ItemCliente.clave`, `CallDelDia.clave`). */
export const claveLead = (fila: Pick<FilaLead, "hoja" | "numeroFila">) => `${fila.hoja}:${fila.numeroFila}`;

export function identidadDe(fila: FilaLead): Identidad {
  const { nombre, telefono, fechaCall } = fila.valores;
  return { hoja: fila.hoja, numeroFila: fila.numeroFila, nombre, telefono, fechaCall };
}

/** Los campos escribibles de la fila, tal como se leyeron (para armar `esperado` al escribir). */
export function valoresEscribibles(fila: FilaLead): ValoresEscribibles {
  const valores = {} as ValoresEscribibles;
  for (const campo of CAMPOS_ESCRIBIBLES) valores[campo] = fila.valores[campo];
  return valores;
}

export function serializarAccion(accion: Accion): AccionCliente {
  const { fechaReunion, ...resto } = accion;
  return { ...resto, fecha: accion.fecha.toISOString(), ...(fechaReunion ? { fechaReunion: fechaReunion.toISOString() } : {}) };
}

export function armarItem(fila: FilaLead, accion: Accion, ahora: Date): ItemCliente {
  const clave = claveLead(fila);
  const chat = urlChat(fila.hoja, fila.valores.telefono);
  return {
    clave,
    id: `${clave}|${accion.tipo}`,
    identidad: identidadDe(fila),
    valores: valoresEscribibles(fila),
    accion: serializarAccion(accion),
    // La hora de la call o reunión, también si la tarjeta lleva la fecha de un seguimiento acordado
    horaCall: formatearCorto(accion.fechaReunion ?? accion.fecha),
    urlChat: chat.url,
    chat2Chat: chat.es2Chat,
    // La reunión del pre-call (D o la reagenda) todavía no empezó
    cancelable: accion.grupo === "precall" && (accion.fechaReunion ?? accion.fecha).getTime() > ahora.getTime(),
  };
}

const es = (valor: string, esperado: string) => normalizarTexto(valor) === normalizarTexto(esperado);

/** Estado en pocas palabras de un lead sin acción para hoy (para la tira de calls del día). */
export function estadoDeFila(v: FilaLead["valores"], fechaCall: Date, ahora: Date): string {
  const situacion = v.situacion.trim();
  if (es(v.precall, VALORES.olvidar)) return "Olvidado";
  if (SITUACIONES_CERRADAS.some((s) => es(situacion, s))) return situacion;
  if (situacion) return `Resultado: ${situacion}`;
  if (es(v.presentoAgenda1, VALORES.no)) {
    return es(v.presentoReagenda, VALORES.no) ? "No vino a la reagenda" : "No se presentó";
  }
  if (v.presentoAgenda1.trim()) return "Se presentó";
  return fechaCall > ahora ? `Pre-call: ${v.precall.trim() || "sin arrancar"}` : "La call ya pasó";
}

/**
 * Todas las calls de hoy de una hoja (D o AC de hoy, en hora de Buenos Aires), tengan o no acción
 * pendiente, ordenadas por hora. Una por lead: si la reagenda (AC) es hoy, esa manda. `grupo` y
 * `estado` son los de la acción principal de hoy o, si no hay (la call todavía no pasó), los del
 * pre-call.
 */
export function callsDelDiaDe(filas: readonly FilaLead[], ahora: Date, dia: ContextoDia = {}): CallDelDia[] {
  const calls: CallDelDia[] = [];
  for (const fila of filas) {
    const v = fila.valores;
    if (!v.nombre.trim()) continue;
    const call = parsearFechaSheet(v.fechaCall);
    if (!call) continue;
    const reagenda = v.fechaReagenda.trim() ? parsearFechaReagenda(v.fechaReagenda, call) : null;
    const esReagenda = reagenda !== null && mismoDia(reagenda, ahora);
    const fecha = esReagenda ? reagenda : call;
    if (!mismoDia(fecha, ahora)) continue;
    const acciones = accionesDeFila(fila, ahora, dia);
    const accion = acciones.find((a) => a.grupo !== "precall") ?? acciones[0];
    calls.push({
      clave: claveLead(fila),
      nombre: v.nombre.trim(),
      hora: horaCorta(fecha),
      fechaISO: fecha.toISOString(),
      esReagenda,
      grupo: accion?.grupo ?? null,
      estado: accion?.estado ?? estadoDeFila(v, call, ahora),
    });
  }
  return calls.sort((a, b) => Date.parse(a.fechaISO) - Date.parse(b.fechaISO));
}
