// Validación de lo que llega desde el cliente a las server actions. Cualquiera puede hacer un
// POST con lo que quiera, así que nada se da por sentado. Funciones puras.

import { CAMPOS_FICHA, type Cambios, type CampoFicha, type Identidad } from "@/lib/crm/contratos";

const MAX_MOTIVO = 200;

const esObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export function leerIdentidad(x: unknown): Identidad | null {
  if (!esObjeto(x)) return null;
  const { hoja, numeroFila, nombre, telefono, fechaCall } = x;
  if (typeof hoja !== "string" || !hoja.trim()) return null;
  if (typeof numeroFila !== "number" || !Number.isInteger(numeroFila) || numeroFila < 2) return null;
  if (typeof nombre !== "string" || typeof telefono !== "string" || typeof fechaCall !== "string") return null;
  return { hoja, numeroFila, nombre, telefono, fechaCall };
}

/** Hoja + número de fila (p. ej. para `obtenerFicha`). */
export function leerHojaYFila(hoja: unknown, fila: unknown): { hoja: string; numeroFila: number } | null {
  if (typeof hoja !== "string" || !hoja.trim()) return null;
  if (typeof fila !== "number" || !Number.isInteger(fila) || fila < 2) return null;
  return { hoja, numeroFila: fila };
}

/**
 * Un segmento dinámico de la URL (`[hoja]`, `[id]`). Next 16.3.6 se los pasa a la página
 * **codificados**: el router los decodifica al matchear la ruta y `getParamValue`
 * (next/dist/shared/lib/router/utils/get-dynamic-param.js) les vuelve a aplicar
 * `encodeURIComponent` antes de dárselos al código de la app. Así `/lead/Closer%201/541` llega como
 * "Closer%201" y `/lead/Gero-Xavi%20Rejunte/5` como "Gero-Xavi%20Rejunte". Un texto mal codificado
 * no es una hoja: null.
 */
export function decodificarParam(crudo: string): string | null {
  try {
    const valor = decodeURIComponent(crudo);
    return valor.trim() ? valor : null;
  } catch {
    return null;
  }
}

/** Número de fila de la URL: solo dígitos y desde la 2 (la 1 son los encabezados). */
export function leerFilaParam(crudo: string): number | null {
  if (!/^\d{1,7}$/.test(crudo)) return null;
  const n = Number(crudo);
  return n >= 2 ? n : null;
}

/** Id de una operación del log: 8 caracteres hexadecimales (ver `idOperacion` en escribir.ts). */
export function leerIdOperacion(x: unknown): string | null {
  return typeof x === "string" && /^[0-9a-f]{8}$/.test(x) ? x : null;
}

/** Un objeto plano de campo → texto. No chequea la lista blanca: eso lo hace `aplicarCambios`. */
export function leerCambios(x: unknown): Cambios | null {
  if (!esObjeto(x)) return null;
  const cambios: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(x)) {
    if (typeof valor !== "string") return null;
    cambios[campo] = valor;
  }
  return cambios as Cambios;
}

/** Solo los campos de cierre de la ficha (Y, Z, AA, AD, AE, AF). */
export function leerCambiosFicha(x: unknown): Partial<Record<CampoFicha, string>> | null {
  const cambios = leerCambios(x);
  if (!cambios) return null;
  const permitidos = CAMPOS_FICHA as readonly string[];
  if (!Object.keys(cambios).every((c) => permitidos.includes(c))) return null;
  return cambios as Partial<Record<CampoFicha, string>>;
}

export function leerMotivo(x: unknown): string {
  return typeof x === "string" ? x.trim().slice(0, MAX_MOTIVO) : "";
}
