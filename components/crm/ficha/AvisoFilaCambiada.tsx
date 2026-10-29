import type { ReactNode } from "react";

type Props = {
  /** El nombre del lead que hoy está en la fila. */
  actual: string;
  /** El nombre del lead para el que se escribió lo que no se guardó. */
  anterior: string;
  /** "lo que escribiste en las notas", "lo que cargaste en el cierre"… */
  que: string;
  /** Qué hacer con eso (va debajo del título). */
  ayuda: string;
  /** El texto del desplegable con lo que no se guardó. */
  resumen: string;
  /** Lo que no se guardó, para copiarlo. */
  children: ReactNode;
  /** Botones extra (antes de "Cerrar aviso"). */
  acciones?: ReactNode;
  onCerrar: () => void;
};

/** El estilo de los botones del aviso (también para las acciones extra). */
export const CLASE_BOTON_AVISO =
  "min-h-11 rounded-xl border border-negro bg-blanco px-4 text-sm font-bold text-negro hover:bg-negro hover:text-blanco";

/**
 * Aviso de las notas y del formulario de cierre cuando la fila de la ficha pasó a ser de otro lead
 * (alguien ordenó la planilla o le corrigieron el nombre o el teléfono) y había algo sin guardar del
 * anterior: no se guarda en este sin que el closer lo decida, pero tampoco se pierde sin explicación.
 */
export function AvisoFilaCambiada({ actual, anterior, que, ayuda, resumen, children, acciones, onCerrar }: Props) {
  return (
    <div role="alert" className="space-y-2 rounded-lg bg-ambar-fondo px-3 py-2 text-sm text-ambar">
      <p className="font-medium">
        <span aria-hidden="true">⚠ </span>
        Esta fila ahora es de {actual.trim() || "otro lead"} (cambió la planilla): {que} para {anterior.trim() || "el lead anterior"} no
        se guardó.
      </p>
      <p className="text-negro">{ayuda}</p>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-2">{resumen}</summary>
        <div className="pb-1 text-negro">{children}</div>
      </details>
      <div className="flex flex-wrap gap-2 pb-1">
        {acciones}
        <button type="button" onClick={onCerrar} className={CLASE_BOTON_AVISO}>
          Cerrar aviso
        </button>
      </div>
    </div>
  );
}
