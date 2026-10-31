"use client";

import { Tarjeta } from "@/components/crm/mi-dia/Tarjeta";
import type { Escrituras } from "@/components/crm/mi-dia/useEscrituras";
import type { ItemCliente } from "@/lib/crm/contratos";
import { claveOculta, separarListos } from "@/lib/crm/pantalla";

type Props = {
  /** Las acciones de hoy del lead (pre-call y principal, en el orden del motor). */
  items: readonly ItemCliente[];
  /** Las escrituras de la pantalla: en el panel lateral, las del tablero (se ocultan juntas). */
  escrituras: Escrituras;
};

/**
 * Las tarjetas de hoy de un lead dentro de la ficha (página o panel lateral). Cada una con su
 * etiqueta de grupo (pueden ser de columnas distintas) y sin link al nombre (ya estamos en la ficha).
 * Un pre-call "listo por hoy" se muestra igual, con la marca "Listo por hoy", después de las pendientes.
 */
export function ListaAccionesDeHoy({ items, escrituras }: Props) {
  const { pendientes, listos } = separarListos(items.filter((i) => !escrituras.estaOculto(i)));
  const visibles = [...pendientes, ...listos];
  if (visibles.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gris-borde bg-blanco px-4 py-5 text-center text-sm text-gris-texto">
        {items.length === 0 ? "Nada pendiente para hoy." : items.length === 1 ? "Listo, ya la resolviste." : "Listo, ya las resolviste."}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {visibles.map((item) => (
        <Tarjeta
          key={claveOculta(item)}
          item={item}
          enCurso={escrituras.enCurso.has(item.clave)}
          error={escrituras.errorDe(item)}
          onBoton={escrituras.alTocarBoton}
          onBandera={escrituras.alternarBandera}
          onRecordatorio={escrituras.cambiarRecordatorio}
          linkFicha={false}
        />
      ))}
    </div>
  );
}
