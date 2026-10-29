import type { ReactNode } from "react";

// Pantallas sueltas (error, 404, sin usuario): una tarjeta blanca centrada (el logo ya está en la barra lateral del shell)
// centrada, con la paleta de docs/diseno.md. Sin hooks: la usan server components y `error.tsx`.

type Props = {
  /** Texto chico en dorado arriba del título ("404", "Error"). */
  etiqueta?: string;
  titulo: string;
  children: ReactNode;
  /** Botones o links, abajo de la tarjeta. */
  acciones?: ReactNode;
};

export function PantallaAviso({ etiqueta, titulo, children, acciones }: Props) {
  return (
    <div className="flex flex-1 flex-col">
      {/* div y no main: el main es el del shell (un solo landmark). */}
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-gris-linea border-t-4 border-t-dorado bg-blanco p-6 text-center shadow-sm">
          {etiqueta && <p className="text-xs font-bold uppercase tracking-[0.2em] text-dorado-oscuro">{etiqueta}</p>}
          <h1 className="mt-1 text-xl font-bold">{titulo}</h1>
          <div className="mt-3 space-y-2 text-sm text-gris-texto">{children}</div>
          {acciones && <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">{acciones}</div>}
        </div>
      </div>
    </div>
  );
}

/** Estilos de los botones de estas pantallas (principal dorado, secundario con borde negro). */
export const BOTON_PRINCIPAL =
  "flex min-h-12 items-center justify-center rounded-xl bg-dorado px-6 font-bold text-negro hover:bg-dorado-oscuro hover:text-blanco";
export const BOTON_SECUNDARIO =
  "flex min-h-12 items-center justify-center rounded-xl border border-negro bg-blanco px-6 font-bold hover:bg-gris-fondo";
