// Mapa de columnas de las hojas de closers (ver BRIEF.md §3).
// Única fuente de verdad sobre qué letra es cada campo: el resto del código usa los nombres.

import { COLUMNAS_IGNORADAS } from "@/lib/crm/config/crm";

export const COLUMNAS = {
  nombre: "A",
  telefono: "B",
  email: "C",
  fechaCall: "D",
  linkCall: "E",
  precall: "F",
  fuente: "G",
  campania: "H",
  video: "I",
  contextoAgenda: "J",
  setter: "K",
  mensual: "L",
  urgencia: "M",
  // N, O, P, U y X: columnas ocultas que la app no usa (`COLUMNAS_IGNORADAS` de src/config/crm.ts).
  // Siguen acá para no correr los índices de la fila.
  obstaculo: "N",
  objetivo: "O",
  inversion: "P",
  leadScoring: "Q",
  presentoAgenda1: "R",
  fupsNoShow: "S",
  presentoReagenda: "T",
  presentoCall2: "U",
  situacion: "V",
  seguimientoPost1: "W",
  seguimientoPost2: "X",
  cashDia1: "Y",
  cashTratoCerrado: "Z",
  valorServicio: "AA",
  datosReagenda: "AB",
  fechaReagenda: "AC",
  grabacion1: "AD",
  grabacion2: "AE",
  grabacion3: "AF",
  // Confirmado con Gero (24/09/2026): AG queda para la app. Los valores viejos que había en
  // "Closer 2" y "Gero-Xavi Rejunte" se borran antes de la etapa 4.
  ultimoToque: "AG",
  // Pedido de Tomás (11/10/2026): fecha acordada para el próximo seguimiento de No-show o Post-call
  // ("Coordinar fecha"). Columna nueva al final de las 4 pestañas: no corre ninguna otra.
  proximoSeguimiento: "AH",
  // Pedido de Tomás (21/10/2026): resultado de la llamada del pre-caller ("Efectiva" / "No efectiva"). Columna nueva al final
  // de las 6 pestañas, con desplegable.
  llamadaPrecall: "AI",
  // Bandera roja del lead ("Si" / vacía): una marca interna del equipo, sin reglas (pedido de Tomás del 25/10/2026; el 24/10
  // era un aviso de riesgo de no-show con botones y se sacó). Se prende y se apaga con el circulito de la esquina de las
  // tarjetas de Pre-call (`alternarBandera`). Columna al final de las 6 pestañas, con desplegable.
  banderaRoja: "AJ",
  // Recordatorio manual del pre-call (Gero, 30/10/2026): vacío, 1, 2 o 3. No cambia la fase F.
  recordatorioPrecall: "AK",
} as const;

export type Campo = keyof typeof COLUMNAS;
export type Letra = (typeof COLUMNAS)[Campo];

/** Encabezados esperados en la fila 1, tal como figuran en BRIEF.md. */
export const ENCABEZADOS_ESPERADOS: Record<Campo, string> = {
  nombre: "Nombre del lead",
  telefono: "Número de Contacto",
  email: "Email",
  fechaCall: "Día y Fecha de la Call",
  linkCall: "Link a call",
  precall: "¿Pre call?",
  fuente: "Fuente",
  campania: "Campaña",
  video: "Video",
  contextoAgenda: "Contexto Agenda",
  setter: "Setter",
  mensual: "$ Mensual",
  urgencia: "Urgencia",
  obstaculo: "Obstáculo",
  objetivo: "Objetivo",
  inversion: "Inversión",
  leadScoring: "Lead Scoring",
  presentoAgenda1: "¿Se presentó Agenda 1?",
  fupsNoShow: "FUPs Show Up agenda 1",
  presentoReagenda: "¿Se presentó REAGENDA CALL 1?",
  presentoCall2: "¿Se presentó Call 2?",
  situacion: "Situación del Lead",
  seguimientoPost1: "Seguimientos post-call 1",
  seguimientoPost2: "Seguimientos post-call 2",
  cashDia1: "Cash Collected Día 1",
  cashTratoCerrado: "Cash Collected Trato Cerrado",
  valorServicio: "Valor del Servicio",
  datosReagenda: "Datos de Reagenda",
  fechaReagenda: "Fecha y Hora de Reagenda",
  grabacion1: "Grabación 1",
  grabacion2: "Grabación 2",
  grabacion3: "Grabación 3",
  ultimoToque: "Último toque (app)",
  proximoSeguimiento: "Próximo seguimiento",
  llamadaPrecall: "Llamada pre-call",
  banderaRoja: "Bandera roja",
  recordatorioPrecall: "Recordatorio",
};

/**
 * Cómo se llama cada columna en la pantalla y en los mensajes de error (los encabezados de la
 * planilla son más crípticos). Lo usan la ficha, el admin y la validación de la escritura.
 */
export const ETIQUETA_CAMPO: Record<Campo, string> = {
  nombre: "Nombre",
  telefono: "Teléfono",
  email: "Email",
  fechaCall: "Call",
  linkCall: "Link a la call",
  precall: "Pre-call",
  fuente: "Fuente",
  campania: "Campaña",
  video: "Video",
  contextoAgenda: "Contexto de la agenda",
  setter: "Setter",
  mensual: "$ Mensual",
  urgencia: "Urgencia",
  obstaculo: "Obstáculo",
  objetivo: "Objetivo",
  inversion: "Inversión",
  leadScoring: "Lead scoring",
  presentoAgenda1: "¿Se presentó a la call?",
  fupsNoShow: "Seguimientos no-show",
  presentoReagenda: "¿Se presentó a la reagenda?",
  presentoCall2: "¿Se presentó a la call 2?",
  situacion: "Situación",
  seguimientoPost1: "Seguimientos post-call 1",
  seguimientoPost2: "Seguimientos post-call 2",
  cashDia1: "Cash cobrado en la llamada (día 1)",
  cashTratoCerrado: "Cash cobrado al cerrar el trato",
  valorServicio: "Valor del servicio",
  datosReagenda: "Datos de la reagenda",
  fechaReagenda: "Fecha de la reagenda",
  grabacion1: "Grabación 1",
  grabacion2: "Grabación 2",
  grabacion3: "Grabación 3",
  ultimoToque: "Último toque desde la app",
  proximoSeguimiento: "Próximo seguimiento",
  llamadaPrecall: "Llamada pre-call",
  banderaRoja: "Bandera roja 🚩",
  recordatorioPrecall: "Recordatorio",
};

/** Etiqueta legible de un campo; si no es un campo conocido, el texto tal cual. */
export function etiquetaCampo(campo: string): string {
  return (ETIQUETA_CAMPO as Record<string, string>)[campo] ?? campo;
}

/**
 * Columnas en las que la app puede escribir (BRIEF.md §6): F, R, S, T, V, W, Y, Z, AA, AB, AC, AD,
 * AE, AF, AG, AH (próximo seguimiento, desde el 11/10/2026), AI (llamada del pre-caller, desde el 21/10/2026) y AJ (bandera roja,
 * desde el 24/10/2026). Cualquier otra está prohibida. U y X quedaron afuera el 27/09/2026 (columnas ocultas
 * que la app no usa: `COLUMNAS_IGNORADAS`).
 */
export const CAMPOS_ESCRIBIBLES = [
  "precall",
  "presentoAgenda1",
  "fupsNoShow",
  "presentoReagenda",
  "situacion",
  "seguimientoPost1",
  "cashDia1",
  "cashTratoCerrado",
  "valorServicio",
  "datosReagenda",
  "fechaReagenda",
  "grabacion1",
  "grabacion2",
  "grabacion3",
  "ultimoToque",
  "proximoSeguimiento",
  "llamadaPrecall",
  "banderaRoja",
  "recordatorioPrecall",
] as const satisfies readonly Campo[];

export type CampoEscribible = (typeof CAMPOS_ESCRIBIBLES)[number];

/**
 * Texto libre (AB, AD, AE, AF): se escribe literal, para que el Sheet no convierta "12/03" en
 * fecha ni "1500" en número (docs/arquitectura.md §Escritura segura).
 */
export const CAMPOS_TEXTO_LIBRE: readonly Campo[] = ["datosReagenda", "grabacion1", "grabacion2", "grabacion3"];

export const ULTIMA_COLUMNA: Letra = COLUMNAS.recordatorioPrecall;

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function indiceColumna(letra: string): number {
  let n = 0;
  for (const c of letra.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function letraColumna(indice: number): string {
  let s = "";
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

const CAMPOS = Object.keys(COLUMNAS) as Campo[];

/** true si es una de las columnas ocultas que la app no usa (N, O, P, U, X: `COLUMNAS_IGNORADAS`). */
export const esColumnaIgnorada = (campo: string) => (COLUMNAS_IGNORADAS as readonly string[]).includes(campo);

/**
 * Los campos que la app tiene en cuenta (los escribe, los lee para decidir o los muestra): todos
 * menos `COLUMNAS_IGNORADAS`. `npm run verificar` avisa si alguno está oculto en la planilla.
 */
export const CAMPOS_USADOS: readonly Campo[] = CAMPOS.filter((c) => !esColumnaIgnorada(c));

/**
 * Una fila de una hoja de closer, con los valores tal como se ven en la planilla. Las columnas
 * ignoradas (N, O, P, U, X) llegan siempre vacías: nada de la app puede decidir ni mostrar algo
 * con ellas.
 */
export type FilaLead = {
  hoja: string;
  /** Número de fila en la planilla (1 = encabezados, así que los datos arrancan en 2). */
  numeroFila: number;
  valores: Record<Campo, string>;
};

export function filaDesdeValores(hoja: string, numeroFila: number, celdas: unknown[]): FilaLead {
  const valores = {} as Record<Campo, string>;
  for (const campo of CAMPOS) {
    const celda = esColumnaIgnorada(campo) ? null : celdas[indiceColumna(COLUMNAS[campo])];
    valores[campo] = celda == null ? "" : String(celda);
  }
  return { hoja, numeroFila, valores };
}

/** Rango A1 con la hoja entre comillas (los nombres tienen espacios). */
export function rango(hoja: string, desde: string, hasta?: string): string {
  const nombre = `'${hoja.replace(/'/g, "''")}'`;
  return hasta ? `${nombre}!${desde}:${hasta}` : `${nombre}!${desde}`;
}
