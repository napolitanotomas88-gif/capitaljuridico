"use client";

import { HojaInferior } from "./HojaInferior";
import { Toast } from "./Toast";
import type { Escrituras } from "./useEscrituras";

type Props = {
  escrituras: Escrituras;
  /** Lista real de V de la hoja, para el formulario de resultado. */
  situaciones: string[];
  ahora: Date;
};

/** La hoja inferior (si hay un formulario abierto) y el toast, para cualquier pantalla con tarjetas. */
export function HojaYToast({ escrituras: esc, situaciones, ahora }: Props) {
  const { modal, toast } = esc;
  return (
    <>
      {modal && (
        <HojaInferior
          // Otra tarjeta u otro botón = formulario nuevo (sin arrastrar lo que se cargó en el anterior).
          // `id` y no `clave`: un lead puede tener dos tarjetas (pre-call y principal).
          key={`${modal.item.id}|${modal.boton.id}`}
          item={modal.item}
          boton={modal.boton}
          situaciones={situaciones}
          ahora={ahora}
          enCurso={esc.enCurso.has(modal.item.clave)}
          onConfirmar={(cambios, detalle) => void esc.confirmar(modal.item, modal.boton, cambios, detalle)}
          onCerrar={esc.cerrarModal}
        />
      )}
      <Toast
        estado={toast}
        arriba={modal !== null}
        puedeDeshacer={toast?.tipo === "ok" && !esc.enCurso.has(toast.item.clave)}
        onDeshacer={(e) => void esc.deshacer(e)}
      />
    </>
  );
}
