// Lógica pura de la escritura segura (docs/arquitectura.md §Escritura segura): comparar la
// identidad de la fila, validar la lista blanca y los valores, armar los rangos y el log.
// Sin red ni "server-only", para poder testearla.

import { FASES_PRECALL, MAX_SEGUIMIENTOS, VALORES } from "@/lib/crm/config/crm";
import type { Cambios, Identidad } from "@/lib/crm/contratos";
import { formatearFechaSheet, parsearFechaSheet } from "@/lib/crm/fechas";
import { CAMPOS_ESCRIBIBLES, CAMPOS_TEXTO_LIBRE, COLUMNAS, etiquetaCampo, rango, type Campo, type FilaLead } from "./columnas";

export const normalizarTexto = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export const soloDigitos = (s: string) => s.replace(/\D/g, "");

/**
 * Nombre sin espacios de más ni mayúsculas; teléfono solo por dígitos. Si la fila no tiene
 * teléfono, además la fecha de la call (D): dos leads homónimos sin teléfono no se confunden.
 */
export function mismaIdentidad(fila: FilaLead, identidad: Pick<Identidad, "nombre" | "telefono" | "fechaCall">): boolean {
  if (normalizarTexto(fila.valores.nombre) !== normalizarTexto(identidad.nombre)) return false;
  const telefono = soloDigitos(fila.valores.telefono);
  if (telefono !== soloDigitos(identidad.telefono)) return false;
  return telefono !== "" || mismoValor(fila.valores.fechaCall, identidad.fechaCall);
}

/** Claves de `cambios` que no están en la lista blanca. */
export function camposProhibidos(cambios: Record<string, unknown>): string[] {
  return Object.keys(cambios).filter((c) => !(CAMPOS_ESCRIBIBLES as readonly string[]).includes(c));
}

const SEGUIMIENTOS = Array.from({ length: MAX_SEGUIMIENTOS }, (_, i) => `S${i + 1}`);
const CAMPOS_NUMERICOS: readonly Campo[] = ["cashDia1", "cashTratoCerrado", "valorServicio"];
const CAMPOS_FECHA: readonly Campo[] = ["fechaReagenda", "ultimoToque", "proximoSeguimiento"];
/** Largo máximo de un valor que escribe una acción (desplegables, montos, fechas). */
const LARGO_MAXIMO = 500;
/**
 * Lo máximo que entra en una celda de Google Sheets. Vale para el texto libre (AB, AD–AF: hay notas
 * de AB de más de 1000 caracteres) y para Deshacer, que devuelve lo que ya estaba en la planilla.
 */
export const LARGO_MAXIMO_CELDA = 50_000;

/** Valores que acepta cada desplegable, tal como están en src/config/crm.ts. V se deja al Sheet. */
export const LISTAS_FIJAS: Partial<Record<Campo, readonly string[]>> = {
  precall: [...FASES_PRECALL, VALORES.olvidar],
  presentoAgenda1: [VALORES.si, VALORES.no],
  presentoReagenda: [VALORES.si, VALORES.no],
  fupsNoShow: [...SEGUIMIENTOS, VALORES.noHacer],
  seguimientoPost1: [VALORES.hacer, VALORES.noHacer, ...SEGUIMIENTOS],
  llamadaPrecall: [VALORES.llamadaEfectiva, VALORES.llamadaNoEfectiva],
  banderaRoja: [VALORES.si],
};

export const esNumero = (v: string) => /^-?\d+([.,]\d+)?$/.test(v.trim());

/**
 * "1.500", "1,500", "12.345.678": grupos de tres dígitos después de un punto o una coma. En la
 * planilla (es_AR) "1.500" es mil quinientos, pero `esNumero` + `Number` lo leerían como 1,5; y
 * "1,500" es 1,5 en Argentina y 1500 en inglés. Para un monto es ambiguo: se pide sin separador
 * de miles.
 */
export const pareceMiles = (v: string) => /^-?\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(v.trim());

export const MENSAJE_MILES = "escribilo sin puntos ni comas de miles (p. ej. 1500 o 1500,50)";

export type ModoEscritura = "accion" | "restaurar";

/**
 * Chequea los valores antes de mandarlos al Sheet. En modo "accion" exige los textos exactos de
 * los desplegables, fechas legibles y números; en modo "restaurar" (Deshacer) solo lo básico,
 * porque devuelve lo que ya estaba en la planilla (p. ej. una reagenda escrita a mano o una nota
 * de AB de 1500 caracteres), salvo AG, que solo puede volver a una fecha legible o a vacío.
 * El texto libre (AB, AD–AF) y lo que se restaura pueden ocupar una celda entera; el resto, 500.
 * Devuelve el mensaje de error (con el nombre legible de la columna) o null si está todo bien.
 */
export function validarCambios(cambios: Cambios, modo: ModoEscritura = "accion"): string | null {
  const entradas = Object.entries(cambios) as [Campo, string][];
  if (entradas.length === 0) return "No hay nada para escribir.";
  for (const [campo, valor] of entradas) {
    const nombre = etiquetaCampo(campo);
    if (typeof valor !== "string") return `${nombre}: el valor tiene que ser texto.`;
    const maximo = modo === "restaurar" || CAMPOS_TEXTO_LIBRE.includes(campo) ? LARGO_MAXIMO_CELDA : LARGO_MAXIMO;
    if (valor.length > maximo) return `${nombre}: el texto es demasiado largo.`;
    if (/^\s*[=+]/.test(valor)) return `${nombre}: el valor no puede empezar con "=" ni "+".`;
    if (valor.trim() === "") continue;
    if (modo === "restaurar") {
      if (campo === "ultimoToque" && !parsearFechaSheet(valor)) return `${nombre}: "${valor}" no es una fecha.`;
      continue;
    }

    const lista = LISTAS_FIJAS[campo];
    if (lista && !lista.includes(valor)) return `${nombre}: "${valor}" no es una opción del desplegable.`;
    if (CAMPOS_NUMERICOS.includes(campo) && pareceMiles(valor)) return `${nombre}: "${valor}": ${MENSAJE_MILES}.`;
    if (CAMPOS_NUMERICOS.includes(campo) && !esNumero(valor)) return `${nombre}: "${valor}" no es un número.`;
    if (CAMPOS_FECHA.includes(campo) && !parsearFechaSheet(valor)) {
      return `${nombre}: "${valor}" no es una fecha dd/mm/yyyy HH:mm:ss.`;
    }
  }
  return null;
}

/** true si los dos objetos tienen exactamente las mismas claves (p. ej. `cambios` y `esperado`). */
export function mismasClaves(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const x = Object.keys(a).sort();
  const y = Object.keys(b).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

/** Iguales como texto, o como número, o como fecha de la planilla (lo que el Sheet convierte solo). */
export function mismoValor(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x === y) return true;
  if (esNumero(x) && esNumero(y)) return Number(x.replace(",", ".")) === Number(y.replace(",", "."));
  const fx = parsearFechaSheet(x);
  const fy = parsearFechaSheet(y);
  return fx !== null && fy !== null && fx.getTime() === fy.getTime();
}

/** Campos de `esperado` cuyo valor actual en la fila es otro. */
export function camposDistintos(fila: FilaLead, esperado: Cambios): Campo[] {
  return (Object.entries(esperado) as [Campo, string][])
    .filter(([campo, valor]) => !mismoValor(fila.valores[campo], valor))
    .map(([campo]) => campo);
}

/** Agrega AG = ahora, salvo que `cambios` ya lo traiga (Deshacer restaura el AG anterior). */
export function conUltimoToque(cambios: Cambios, ahora: Date): Cambios {
  return "ultimoToque" in cambios ? { ...cambios } : { ...cambios, ultimoToque: formatearFechaSheet(ahora) };
}

/**
 * Si una acción de tarjeta escribe AG (último toque). Todas sí, menos el "Enviado" del pre-call
 * (solo F con una fase): desde el 28/09/2026 el pre-call no tiene límite por día y es una tarjeta
 * aparte de la principal, y AG es lo que usan los seguimientos (S y W) para mandar uno solo por día
 * y esconder "Terminó la secuencia" (CERRAR) hasta mañana; una fase mandada hoy no puede frenar el
 * S2 del mismo lead. "Olvidar" (S + F) sí lo escribe.
 */
export function tocaUltimoToque(cambios: Cambios): boolean {
  // El pre-call (una fase de F, la llamada del pre-caller en AI y/o la bandera roja en AJ) no toca AG: no frena los
  // seguimientos de ese día.
  const campos = Object.keys(cambios);
  if (campos.length === 0 || campos.some((c) => c !== "precall" && c !== "llamadaPrecall" && c !== "banderaRoja")) return true;
  if (!("precall" in cambios)) return false;
  const valor = normalizarTexto(cambios.precall ?? "");
  return !FASES_PRECALL.some((fase) => normalizarTexto(fase) === valor);
}

/** Lo que había y lo que va a quedar, campo por campo. */
export function diferencias(fila: FilaLead, cambios: Cambios): { antes: Cambios; despues: Cambios } {
  const antes: Cambios = {};
  const despues: Cambios = {};
  for (const [campo, valor] of Object.entries(cambios) as [Campo, string][]) {
    antes[campo] = fila.valores[campo];
    despues[campo] = valor;
  }
  return { antes, despues };
}

export type RangoEscritura = { range: string; values: (string | number)[][] };

const aNumero = (texto: string) => Number(texto.replace(",", "."));

/** Lo que va en la celda con USER_ENTERED (ver `armarRangos`). */
export function valorCelda(campo: Campo, valor: string, modo: ModoEscritura = "accion"): string | number {
  const texto = valor.trim();
  if (texto === "") return ""; // borra la celda
  // Al deshacer, un número vuelve como número solo si así lo pudo haber leído la API: con
  // UNFORMATTED_VALUE una celda numérica llega con la forma de JS (`String(numero)`). "46094" o
  // "1500.5" sí; "01155556666" o "1.500" solo pueden ser texto (y "1.500" no es 1,5).
  const comoLaApi = String(Number(texto)) === texto;
  if (CAMPOS_NUMERICOS.includes(campo) && esNumero(texto) && (modo === "accion" || comoLaApi)) return aNumero(texto);
  if (CAMPOS_TEXTO_LIBRE.includes(campo)) {
    // Al deshacer, un número de la API vuelve como número (p. ej. una fecha nativa como serial);
    // todo lo demás, literal.
    if (modo === "restaurar" && esNumero(texto) && comoLaApi) return Number(texto);
    // El apóstrofo le dice al Sheet "esto es texto": no lo convierte en fecha, número ni fórmula,
    // y no queda guardado (la API lo lee sin el apóstrofo).
    return `'${valor}`;
  }
  return valor;
}

/**
 * Un rango por celda (`'Hoja'!F12`), para `values.batchUpdate` con USER_ENTERED. Los campos
 * numéricos van como número JSON para que el Sheet no dependa del separador decimal del locale;
 * el texto libre (AB, AD, AE, AF) con apóstrofo adelante, para que quede literal; el resto como
 * texto (los desplegables y las fechas de AC/AG los interpreta el Sheet).
 */
export function armarRangos(hoja: string, numeroFila: number, cambios: Cambios, modo: ModoEscritura = "accion"): RangoEscritura[] {
  return (Object.entries(cambios) as [Campo, string][]).map(([campo, valor]) => ({
    range: rango(hoja, `${COLUMNAS[campo]}${numeroFila}`),
    values: [[valorCelda(campo, valor, modo)]],
  }));
}

/** Claves de orden viejas que quedaron pegadas en AG (`yyyymmddHHMMSS`). */
export const esClaveVieja = (valor: string) => /^\d{14}$/.test(valor.trim());

export const ENCABEZADOS_LOG = [
  "Fecha",
  "Operación",
  "Closer",
  "Hoja",
  "Fila",
  "Lead",
  "Columna",
  "Campo",
  "Antes",
  "Después",
  "Motivo",
] as const;

export type DatosLog = {
  fecha: Date;
  operacion: string;
  closer: string;
  hoja: string;
  numeroFila: number;
  lead: string;
  antes: Cambios;
  despues: Cambios;
  motivo: string;
};

/** Una fila de "Log App" por celda que cambió, en el orden de ENCABEZADOS_LOG. */
export function filasLog(d: DatosLog): (string | number)[][] {
  const fecha = formatearFechaSheet(d.fecha);
  return (Object.entries(d.despues) as [Campo, string][])
    .filter(([campo, valor]) => (d.antes[campo] ?? "").trim() !== valor.trim())
    .map(([campo, valor]) => [
      fecha,
      d.operacion,
      d.closer,
      d.hoja,
      d.numeroFila,
      d.lead,
      COLUMNAS[campo],
      campo,
      d.antes[campo] ?? "",
      valor,
      d.motivo,
    ]);
}
