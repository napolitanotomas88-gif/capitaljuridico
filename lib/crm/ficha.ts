// Lógica pura de la ficha del lead (docs/arquitectura.md §Ficha): etiquetas legibles para cada
// columna, las secciones de la pantalla y el formulario de cierre (Y, Z, AA, AD, AE, AF), que
// arma solo los campos que cambiaron para mandarlos a `guardarFicha`. Sin React ni red.

import { CAMPOS_FICHA, type CampoFicha } from "@/lib/crm/contratos";
import { PISTA_FORMULA, leerMontos, type Montos } from "@/lib/crm/pantalla";
import { ETIQUETA_CAMPO, type Campo } from "@/lib/crm/sheets/columnas";
import { mismoValor } from "@/lib/crm/sheets/verificacion";

/** Vive en columnas.ts (también la usa la validación de la escritura); se re-exporta acá. */
export { ETIQUETA_CAMPO } from "@/lib/crm/sheets/columnas";

/**
 * Lo que conviene leer antes de la call (BRIEF.md §3), en orden de utilidad. Sin Obstáculo,
 * Objetivo ni Inversión (N, O, P): columnas ocultas que la app no usa (`COLUMNAS_IGNORADAS`).
 */
export const CAMPOS_CONTEXTO: readonly Campo[] = [
  "contextoAgenda",
  "mensual",
  "urgencia",
  "leadScoring",
  "fuente",
  "campania",
  "video",
  "setter",
];

/**
 * El estado del lead: se muestran todos, con "—" si están vacíos. Sin U ni X (columnas ocultas que
 * la app no usa: `COLUMNAS_IGNORADAS`).
 */
export const CAMPOS_ESTADO: readonly Campo[] = [
  "precall",
  "presentoAgenda1",
  "fupsNoShow",
  "presentoReagenda",
  "situacion",
  "seguimientoPost1",
  // AB (Datos de Reagenda) sale de acá: tiene su propio bloque de notas editable (NotasReagenda)
  "fechaReagenda",
  "proximoSeguimiento",
  "ultimoToque",
];

export const CAMPOS_MONTO_FICHA = ["cashDia1", "cashTratoCerrado", "valorServicio"] as const satisfies readonly CampoFicha[];
export const CAMPOS_GRABACION = ["grabacion1", "grabacion2", "grabacion3"] as const satisfies readonly CampoFicha[];

/** Los valores del formulario de la ficha, siempre como texto. */
export type DatosFicha = Record<CampoFicha, string>;

/** Los campos editables de la ficha, tal como están en la planilla. */
export function datosFichaDesde(valores: Record<Campo, string>): DatosFicha {
  const datos = {} as DatosFicha;
  for (const campo of CAMPOS_FICHA) datos[campo] = valores[campo].trim();
  return datos;
}

/** Sirve para que el formulario se reinicie cuando cambian los valores de la planilla. */
export function firmaDatosFicha(datos: DatosFicha): string {
  return CAMPOS_FICHA.map((c) => datos[c]).join("\u0000");
}

const LARGO_MAXIMO = 500;
/** Las notas de AB pueden ser largas (hay de más de 1000 caracteres); el tope es el de una celda. */
export const LARGO_MAXIMO_NOTAS = 50_000;

export type ResultadoFicha =
  | { ok: true; cambios: Partial<Record<CampoFicha, string>> }
  | { ok: false; error: string };

/**
 * Arma los cambios para `guardarFicha`: solo los campos distintos de lo que hay en la planilla.
 * Vaciar un campo es un cambio válido (borra la celda). Se valida **solo lo que cambió**: los
 * montos tienen que ser números (sin separador de miles); las grabaciones, texto corto que no
 * empiece con "=" ni "+" (el Sheet lo tomaría como fórmula). Un monto que en la planilla es texto
 * (p. ej. "USD 500" o "-") y no se tocó no frena el guardado de una grabación.
 */
export function formularioFicha(original: Record<CampoFicha, string>, datos: DatosFicha): ResultadoFicha {
  const cambios: Partial<Record<CampoFicha, string>> = {};
  for (const campo of CAMPOS_FICHA) {
    const nuevo = datos[campo].trim();
    const viejo = original[campo].trim();
    if (nuevo === viejo) continue;
    if (nuevo && viejo && mismoValor(nuevo, viejo)) continue;
    cambios[campo] = nuevo;
  }
  if (Object.keys(cambios).length === 0) return { ok: false, error: "No cambiaste nada." };

  const montos: Montos = {};
  for (const campo of CAMPOS_MONTO_FICHA) if (campo in cambios) montos[campo] = cambios[campo];
  const leidos = leerMontos(montos);
  if (!leidos.ok) return { ok: false, error: leidos.error };

  for (const campo of CAMPOS_GRABACION) {
    const valor = cambios[campo];
    if (valor === undefined) continue;
    if (valor.length > LARGO_MAXIMO) return { ok: false, error: `${ETIQUETA_CAMPO[campo]}: el texto es demasiado largo.` };
    if (/^[=+]/.test(valor)) return { ok: false, error: `${ETIQUETA_CAMPO[campo]}: no puede empezar con "=" ni "+".` };
  }
  const notas = cambios.datosReagenda;
  if (notas !== undefined) {
    if (notas.length > LARGO_MAXIMO_NOTAS) return { ok: false, error: `${ETIQUETA_CAMPO.datosReagenda}: el texto es demasiado largo.` };
    if (/^\s*[=+]/.test(notas)) return { ok: false, error: `${ETIQUETA_CAMPO.datosReagenda}: no puede empezar con "=" ni "+": ${PISTA_FORMULA}.` };
  }
  return { ok: true, cambios };
}

/**
 * Cuando llega un valor nuevo de la planilla para un campo que se está editando: `antes` es lo que
 * había (o lo que se acaba de guardar), `ahora` lo que llegó y `local` lo que hay en pantalla. Sin
 * edición propia (o si la planilla ya dice lo mismo) se toma lo nuevo; con edición, se conserva el
 * borrador y `conflicto` avisa si además lo cambió otro (no se pisa sin que el closer lo vea).
 */
export function fusionarValor(local: string, antes: string, ahora: string): { valor: string; conflicto: boolean } {
  if (local.trim() === antes.trim() || local.trim() === ahora.trim()) return { valor: ahora, conflicto: false };
  return { valor: local, conflicto: ahora.trim() !== antes.trim() };
}

/**
 * `fusionarValor` campo por campo (los de `campos`; el resto queda como en `local`). Devuelve los
 * datos para el formulario y los campos en conflicto (editados acá y cambiados en la planilla).
 */
export function fusionarFicha(
  local: DatosFicha,
  antes: DatosFicha,
  ahora: DatosFicha,
  campos: readonly CampoFicha[] = CAMPOS_FICHA,
): { datos: DatosFicha; conflictos: CampoFicha[] } {
  const datos = { ...local };
  const conflictos: CampoFicha[] = [];
  for (const campo of campos) {
    const { valor, conflicto } = fusionarValor(local[campo], antes[campo], ahora[campo]);
    datos[campo] = valor;
    if (conflicto) conflictos.push(campo);
  }
  return { datos, conflictos };
}

/** Un valor que parece un link se muestra como tal. */
export const esLink = (valor: string) => /^https?:\/\/\S+$/i.test(valor.trim());
