// Tipos que cruzan la frontera servidor ↔ cliente (docs/arquitectura.md). Solo tipos y valores
// planos: este archivo lo importan tanto server actions como componentes cliente.

import type { Accion, Grupo } from "@/lib/crm/motor/proxima-accion";
import type { Campo, CampoEscribible } from "@/lib/crm/sheets/columnas";

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string; codigo?: CodigoError };

/** Códigos de error que el cliente puede distinguir (el texto en `error` es para mostrar). */
export type CodigoError =
  | "sin_sesion"
  | "hoja_prohibida"
  | "entrada_invalida"
  | "escritura_bloqueada"
  | "columna_prohibida"
  | "valor_invalido"
  | "fila_cambiada"
  | "api";

/**
 * Cómo se reconoce un lead antes de escribir: fila + nombre + teléfono. `fechaCall` (D, tal como
 * se leyó) solo se compara si la fila no tiene teléfono.
 */
export type Identidad = { hoja: string; numeroFila: number; nombre: string; telefono: string; fechaCall: string };

export type Cambios = Partial<Record<Campo, string>>;

/**
 * `esperado`: lo que tenían las celdas de `cambios` cuando se armó la tarjeta (mismas claves).
 * Si la planilla cambió desde entonces, no se escribe (`fila_cambiada`).
 */
export type EntradaAccion = Identidad & { cambios: Cambios; esperado: Cambios; motivo: string };
/**
 * El Deshacer del toast: `restaurar` = `antes`, `esperado` = `despues`, el mismo `motivo` y la
 * `firma` que devolvió `ejecutarAccion` (sin firma válida no se restaura nada).
 */
export type EntradaDeshacer = Identidad & { restaurar: Cambios; esperado: Cambios; motivo?: string; firma: string };

export const CAMPOS_FICHA = [
  "cashDia1",
  "cashTratoCerrado",
  "valorServicio",
  "grabacion1",
  "grabacion2",
  "grabacion3",
  // AB "Datos de Reagenda": espacio de notas libre de la ficha (pedido de Tomás, 10/10/2026)
  "datosReagenda",
] as const satisfies readonly Campo[];
export type CampoFicha = (typeof CAMPOS_FICHA)[number];
/** `esperado` (opcional): lo que había en esos campos cuando se abrió el formulario. */
export type EntradaFicha = Identidad & {
  cambios: Partial<Record<CampoFicha, string>>;
  esperado?: Partial<Record<CampoFicha, string>>;
};

/**
 * Lo que devuelve cada escritura; `antes` es lo que usa Deshacer. `firma` (solo `ejecutarAccion`):
 * HMAC de hoja + fila + antes + despues + motivo, que exige `deshacerAccion`.
 */
export type Operacion = { id: string; antes: Cambios; despues: Cambios; logFallo?: boolean; firma?: string };

/** `Accion` con la fecha en ISO, para pasarla a componentes cliente. */
export type AccionCliente = Omit<Accion, "fecha" | "fechaReunion"> & { fecha: string; fechaReunion?: string };

/** Los campos escribibles de una fila, como texto (lo que había al armar la tarjeta). */
export type ValoresEscribibles = Record<CampoEscribible, string>;

/**
 * Una tarjeta. Un lead puede tener dos a la vez (la de pre-call y la principal, en columnas
 * distintas): `clave` es la del lead (la comparten) e `id` la de la tarjeta.
 */
export type ItemCliente = {
  /** `${hoja}:${numeroFila}`: el lead. Lo comparten sus dos tarjetas (p. ej. `enCurso` bloquea las dos). */
  clave: string;
  /** `${clave}|${tipo}`: única por tarjeta (un lead nunca tiene dos acciones del mismo tipo). */
  id: string;
  identidad: Identidad;
  /** Para armar `esperado` al escribir: `esperado[campo] = valores[campo]` (`esperadoPara` de pantalla.ts). */
  valores: ValoresEscribibles;
  accion: AccionCliente;
  /** "jue 24/09 15:00" */
  horaCall: string;
  /**
   * El chat con el lead, sin texto: la app no sugiere mensajes (los decide el closer). En 2Chat, desde el número del closer
   * de la pestaña (`chat2Chat`); en una pestaña sin número de 2Chat, WhatsApp (https://wa.me/<solo dígitos>).
   */
  urlChat: string;
  chat2Chat: boolean;
  /** Pre-call de una reunión que todavía no empezó: se puede cancelar en Calendly ("Cancelar reunión"). */
  cancelable: boolean;
};

/** Una fila de la hoja "Log App". */
export type EntradaLog = {
  fecha: string;
  operacion: string;
  closer: string;
  hoja: string;
  fila: number;
  lead: string;
  columna: string;
  campo: string;
  antes: string;
  despues: string;
  motivo: string;
};

/** Todo lo que muestra la ficha del lead (página propia o panel lateral). */
export type FichaLead = {
  identidad: Identidad;
  /** Todos los campos de la fila, tal como están en la planilla (las columnas ignoradas N, O, P, U y X, vacías). */
  valores: Record<Campo, string>;
  /** Las acciones de hoy (hasta dos: pre-call y principal) con WhatsApp; [] si no le toca nada. */
  items: ItemCliente[];
  /** Filas de "Log App" de este lead, más nuevo primero. */
  historial: EntradaLog[];
};

/** Lo que devuelve `obtenerFicha` para abrir la ficha como panel lateral. */
export type PanelFicha = {
  ficha: FichaLead;
  /** Lista real de V de la hoja (formulario de resultado). */
  situaciones: string[];
  /** Nombre del closer dueño de la hoja (o la hoja si no está configurada). */
  closer: string;
  /** La hora del servidor al armar los datos. */
  ahoraISO: string;
};

/** Una call del día (D o AC de hoy), tenga o no acción pendiente. */
export type CallDelDia = {
  /** `${hoja}:${numeroFila}`, igual que `ItemCliente.clave`. */
  clave: string;
  nombre: string;
  /** "15:00" (Buenos Aires). */
  hora: string;
  fechaISO: string;
  /** true si es la reagenda (AC) y no la call original (D). */
  esReagenda: boolean;
  /** Grupo de la acción de hoy, o null si no le toca nada. */
  grupo: Grupo | null;
  /** Estado en pocas palabras ("Pre-call: DOLORES", "Cerrado en llamada"...). */
  estado: string;
};

export type CambioHecho = { columna: string; campo: string; antes: string; despues: string };

/** Una escritura de hoy según "Log App" (todas las celdas de una misma operación juntas). */
export type OperacionHecha = {
  idOperacion: string;
  /** "15:04" (Buenos Aires). */
  hora: string;
  /** El texto de la columna Fecha del log (`dd/mm/yyyy HH:mm:ss`). */
  fecha: string;
  /** Quién la hizo (columna Closer del log). */
  closer: string;
  hoja: string;
  fila: number;
  lead: string;
  motivo: string;
  cambios: CambioHecho[];
  /** Hay un "Deshacer: …" posterior sobre la misma fila y columnas. */
  deshecha: boolean;
};
