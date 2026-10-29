// Lo cargado y sin guardar en el formulario de cierre de la ficha (`FormularioFicha`), anotado en la
// pestaña (sessionStorage) por hoja + fila. No se vuelve a poner en los campos: sirve para avisar
// cuando la fila pasó a ser de otro lead (alguien ordenó la planilla o le corrigieron el nombre o el
// teléfono) y el formulario se volvió a montar sin lo que se había cargado para el anterior.
// Sin React ni red, para poder testearlo.

import type { CampoFicha, Identidad } from "@/lib/crm/contratos";
import type { DatosFicha } from "@/lib/crm/ficha";

export type CambiosCierre = Partial<Record<CampoFicha, string>>;

/** `lead` es la `claveIdentidad` de quien lo cargó (lib/crm/pantalla.ts) y `nombre` el suyo, para el aviso. */
export type CierreSinGuardar = { lead: string; nombre: string; cambios: CambiosCierre };

/** Dónde se anota en sessionStorage: uno por fila de la hoja. */
export const claveCierreSinGuardar = (identidad: Pick<Identidad, "hoja" | "numeroFila">) =>
  `crm:cierre:${identidad.hoja}:${identidad.numeroFila}`;

/**
 * Los campos que difieren de la base (lo que hay en la planilla o lo recién guardado), con lo que
 * está escrito; null si no hay ninguno. Mismo criterio que el formulario: sin espacios de los bordes.
 */
export function cambiosSinGuardar(datos: DatosFicha, base: DatosFicha, campos: readonly CampoFicha[]): CambiosCierre | null {
  const cambios: CambiosCierre = {};
  for (const c of campos) if (datos[c].trim() !== base[c].trim()) cambios[c] = datos[c];
  return Object.keys(cambios).length > 0 ? cambios : null;
}

// Sin sessionStorage (modo privado, datos del sitio bloqueados) no hay aviso y todo lo demás funciona igual.

/** Lo anotado en esa fila, solo si lo cargó otro lead (para avisar); si es de este (o no hay), null. */
export function leerCierreDeOtroLead(clave: string, lead: string): CierreSinGuardar | null {
  try {
    const crudo = sessionStorage.getItem(clave);
    if (!crudo) return null;
    const c = JSON.parse(crudo) as Partial<CierreSinGuardar> | null;
    if (!c || typeof c.lead !== "string" || typeof c.nombre !== "string" || !c.cambios || typeof c.cambios !== "object") return null;
    const cambios = Object.fromEntries(Object.entries(c.cambios).filter(([, v]) => typeof v === "string")) as CambiosCierre;
    if (c.lead === lead || Object.keys(cambios).length === 0) return null;
    return { lead: c.lead, nombre: c.nombre, cambios };
  } catch {
    return null;
  }
}

/** Anota lo que quedó sin guardar (o lo borra con null). */
export function escribirCierreSinGuardar(clave: string, cierre: CierreSinGuardar | null): void {
  try {
    if (cierre) sessionStorage.setItem(clave, JSON.stringify(cierre));
    else sessionStorage.removeItem(clave);
  } catch {
    // Sin sessionStorage: no queda anotado.
  }
}
