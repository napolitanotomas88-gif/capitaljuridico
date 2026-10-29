// Reglas de negocio del CRM que se pueden ajustar sin tocar la lógica del motor.
// Los textos tienen que coincidir con los desplegables del Sheet: la validación es estricta
// y rechaza cualquier valor que no esté en la lista.

import type { Campo } from "@/lib/crm/sheets/columnas";

/**
 * Fases del pre-call en orden. F guarda la última fase enviada (vacío = no arrancó).
 *
 * TODO(Gero): el brief propone Confirmación → Decisores → Videos Conf → Dolores → Hecho.
 * Mientras el desplegable de F no se actualice, usamos las fases que acepta hoy.
 * Al cambiarlo, agregar acá los valores viejos en `EQUIVALENCIAS_FASE`
 * (p. ej. "CONF + DECISORES" = fase "Decisores" ya enviada).
 */
export const FASES_PRECALL = ["CONF + DECISORES", "VIDEOS CONF", "DOLORES", "Hecho - link a call"] as const;

/** Valores viejos o alternativos de F → fase equivalente de `FASES_PRECALL`. */
export const EQUIVALENCIAS_FASE: Record<string, (typeof FASES_PRECALL)[number]> = {};

export const VALORES = {
  si: "Si",
  no: "No",
  hacer: "Hacer",
  noHacer: "No hacer",
  olvidar: "Olvidar",
  llamadaEfectiva: "Efectiva",
  llamadaNoEfectiva: "No efectiva",
  cerradoEnLlamada: "Cerrado en llamada",
  cerradoEnSeguimiento: "Cerrado en seguimiento",
  reagendo: "Reagendó",
} as const;

/**
 * Desde qué fila de cada pestaña muestra leads el CRM (pedido de Tomás, 12/10/2026): solo los de los closers actuales
 * (Carlos en Closer 1, Marcos en Closer 2). Las filas de arriba son de closers anteriores: no aparecen en ninguna parte del
 * CRM (tarjetas, calls de hoy, ficha, tablero del admin y contadores). La planilla no se toca. Gero-Xavi Rejunte, todas.
 * Ojo: es por número de fila; si alguien inserta o borra filas por encima del corte, el corte se corre.
 */
export const PRIMERA_FILA_VISIBLE: Readonly<Record<string, number>> = {
  "Closer 1": 264,
  "Closer 2": 473,
  // Closer 3 = Yamila Coutoune (desde el 18/10/2026): desde su primer lead, la fila 47 (Laura Cristina Ortiz Molina, call del
  // 19/10). Las filas 2 a 46 son leads viejos de Ariel, ocultas también en el Sheet. Pedido de Tomás, 19/10/2026.
  "Closer 3": 47,
};

/** true si el CRM muestra esa fila de esa pestaña (la 1 son los encabezados; sin corte, desde la 2). */
export const filaVisible = (hoja: string, numeroFila: number): boolean => numeroFila >= (PRIMERA_FILA_VISIBLE[hoja] ?? 2);

/** Situaciones (V) que sacan al lead de la lista. */
export const SITUACIONES_CERRADAS = [VALORES.cerradoEnLlamada, VALORES.cerradoEnSeguimiento];

/**
 * Columnas OCULTAS de las hojas de closers que la app no usa para nada (decisión de Gero del
 * 27/09/2026, manda sobre BRIEF.md): N (Obstáculo), O (Objetivo), P (Inversión), U (¿Se presentó
 * Call 2?) y X (Seguimientos post-call 2). La app NO las escribe (no están en `CAMPOS_ESCRIBIBLES`),
 * NO las lee para decidir (`filaDesdeValores` las deja vacías) y NO las muestra (ni en la ficha ni
 * en el admin). El CRM queda como está. Las letras siguen en `COLUMNAS` (src/lib/sheets/columnas.ts)
 * para no correr los índices de la fila. `npm run verificar` avisa si alguna columna que la app sí
 * usa quedó oculta.
 */
export const COLUMNAS_IGNORADAS = [
  "obstaculo",
  "objetivo",
  "inversion",
  "presentoCall2",
  "seguimientoPost2",
] as const satisfies readonly Campo[];

/*
 * Decisión 03/10/2026: V = Reagendó es un motivo de no cierre, sin fecha obligatoria.
 * No-show depende de R = No y T distinto de Si. Su botón de asistencia escribe T = Si;
 * las fechas de AC no activan preguntas de asistencia ni sacan al lead de No-show.
 */

/** Leads cuya última fecha (call o reagenda) tiene más de estos días no se muestran. */
export const VENTANA_DIAS = 60;

/** Máximo de seguimientos (S1…S5). */
export const MAX_SEGUIMIENTOS = 5;

// TODO(Gero): ¿los seguimientos cuentan fines de semana? Hoy se cuentan días corridos.

/**
 * Situaciones (V) si no se puede leer la validación de datos del Sheet (`leerDesplegables`).
 * Es la unión de las listas que hoy tienen las 4 hojas más los valores tipeados a mano
 * ("No es el momento", "Competencia"). TODO(Gero): unificar la validación de V en las 4 hojas.
 */
export const SITUACIONES_POR_DEFECTO = [
  "Cerrado en llamada",
  "Cerrado en seguimiento",
  "Tiene que decidir con alguien mas",
  "Quiere pensarlo",
  "Reagendó",
  "Fee",
  "No le interesa",
  "Broke",
  "Follow Up",
  "No es el momento",
  "Competencia",
] as const;

/**
 * Doc de Google "PROCESOS VENTAS - SKWD": la guía de mensajes de los closers (pre-call, no-show,
 * post-call), según el tipo de lead. Lo abre el botón "Mensajes" de la barra negra (Mi día, admin y
 * ficha) en otra pestaña. La app no sugiere textos (decisión de Gero del 28/09/2026, manda sobre
 * BRIEF.md §7): el closer elige el mensaje con esta guía. Si el doc cambia de lugar, se cambia acá.
 */
export const URL_DOC_MENSAJES = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/.test(process.env.NEXT_PUBLIC_VENTAS_MENSAJES_URL ?? "") ? process.env.NEXT_PUBLIC_VENTAS_MENSAJES_URL! : "";
