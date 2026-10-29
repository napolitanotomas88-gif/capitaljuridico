import type { ReactNode } from "react";

type Props = {
  /** Cuántas tarjetas hay adentro (van en el título: "Listo por hoy (3)"). */
  cantidad: number;
  /** Abierta o cerrada (`seccionListosAbierta` de pantalla.ts): el estado vive en MiDia. */
  abierta: boolean;
  /** El closer la abrió o la cerró (solo cuando cambia algo que no venía de `abierta`). */
  onCambiar: (abierta: boolean) => void;
  /** Las tarjetas, ya armadas (con `tenue`). */
  children: ReactNode;
  /** Qué hay adentro, para explicarlo bien: pre-calls de hoy, seguimientos coordinados para otro día o las dos cosas. */
  tipos?: { precall: boolean; coordinados: boolean };
};

/**
 * Sección plegada "Listo por hoy" (decisión de Gero del 28/09/2026, docs/diseno.md): los pre-calls a
 * los que hoy ya se les mandó una fase y cuya siguiente puede esperar a mañana. No son pendientes,
 * así que van al pie (de la columna Pre-call en la computadora, de la lista con los chips "Todo" y
 * "Pre-call" en el celular), cerrados por defecto. Un `<details>` nativo (se abre con el teclado y el
 * lector de pantalla dice si está abierto) con `open` controlado desde MiDia: la sección se desmonta
 * y se vuelve a montar (tablero ↔ "Todo al día", chips, la única tarjeta que se oculta y vuelve con
 * un error) y así queda como la dejó el closer.
 */
export function ListoPorHoy({ cantidad, abierta, onCambiar, children, tipos = { precall: true, coordinados: false } }: Props) {
  const explicacion =
    tipos.precall && tipos.coordinados
      ? "Pre-calls a los que ya les mandaste una fase hoy y seguimientos coordinados para otro día: no cuentan como pendientes."
      : tipos.coordinados
        ? "Seguimientos coordinados para otro día: ese día vuelven a la columna."
        : "Ya les mandaste una fase hoy: la siguiente puede esperar a mañana.";
  return (
    <details
      className="group rounded-2xl border border-dashed border-gris-borde"
      open={abierta}
      // `toggle` llega también cuando el cambio lo hizo React (al montar abierta, o abierta por una
      // búsqueda): solo se guarda si el `<details>` quedó distinto de lo que pidió MiDia, o sea, si fue
      // el closer. Así una búsqueda la abre sin dejarla abierta para después.
      onToggle={(e) => {
        const ahora = e.currentTarget.open;
        if (ahora !== abierta) onCambiar(ahora);
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-gris-texto hover:text-negro [&::-webkit-details-marker]:hidden">
        <span>
          Listo por hoy <span className="tabular">({cantidad})</span>
        </span>
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-3 px-2 pb-2">
        <p className="px-1 text-sm text-gris-texto">{explicacion}</p>
        {children}
      </div>
    </details>
  );
}
