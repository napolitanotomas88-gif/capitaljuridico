// El borrador de las notas de la ficha (`NotasReagenda`) en la pestaña: sobrevive a cerrar el panel,
// cambiar de lead o recargar. Sin React ni red, para poder testearlo.

import type { Identidad } from "@/lib/crm/contratos";

/**
 * `lead` es la `claveIdentidad` de quien lo escribió (lib/crm/pantalla.ts): la clave de la
 * pestaña es por hoja + fila y, si alguien ordena la planilla, en esa fila puede quedar otro lead.
 * `nombre` es el de ese lead, para el aviso cuando la fila ya es de otro.
 */
export type BorradorNotas = { texto: string; base: string; lead: string; nombre: string };

/**
 * Lo que hay en la pestaña para una fila. `deOtroLead`: lo escribió el lead que estaba antes en esa
 * fila (alguien ordenó la planilla o le corrigieron el nombre o el teléfono). Ese no se carga en las
 * notas (no se puede guardar en el lead que hay ahora sin que el closer lo decida): se avisa con el
 * texto para copiarlo.
 */
export type LecturaBorradorNotas = { borrador: BorradorNotas; deOtroLead: boolean };

/** Dónde se guarda en sessionStorage: uno por fila de la hoja. */
export const claveBorradorNotas = (identidad: Pick<Identidad, "hoja" | "numeroFila">) =>
  `crm:notas:${identidad.hoja}:${identidad.numeroFila}`;

// sessionStorage puede no estar (modo privado, datos del sitio bloqueados): sin él, el borrador
// vive solo en el textarea y todo lo demás funciona igual.

/** El borrador de esa fila y si es de este lead o del que estaba antes en la fila (null si no hay). */
export function leerBorradorNotas(clave: string, lead: string): LecturaBorradorNotas | null {
  try {
    const crudo = sessionStorage.getItem(clave);
    if (!crudo) return null;
    const b = JSON.parse(crudo) as Partial<BorradorNotas> | null;
    if (!b || typeof b.texto !== "string" || typeof b.base !== "string" || typeof b.lead !== "string") return null;
    const borrador = { texto: b.texto, base: b.base, lead: b.lead, nombre: typeof b.nombre === "string" ? b.nombre : "" };
    return { borrador, deOtroLead: b.lead !== lead };
  } catch {
    return null;
  }
}

/** Guarda el borrador (o lo borra con null). */
export function escribirBorradorNotas(clave: string, borrador: BorradorNotas | null): void {
  try {
    if (borrador) sessionStorage.setItem(clave, JSON.stringify(borrador));
    else sessionStorage.removeItem(clave);
  } catch {
    // Sin sessionStorage: el borrador queda solo en pantalla.
  }
}

/**
 * "Pasarlo a estas notas" (el borrador del lead anterior, cuando el closer dice que es el mismo): si
 * ya había escrito algo nuevo acá, lo del anterior va debajo; si no, lo reemplaza.
 */
export function textoAlPasar(anterior: string, texto: string, base: string): string {
  return texto.trim() === base.trim() ? anterior : `${texto.trimEnd()}\n\n${anterior}`;
}
