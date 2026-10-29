"use client";

import { IconoActualizar } from "@/components/crm/mi-dia/Encabezado";
import { useRefresco } from "@/components/crm/mi-dia/useRefresco";

/**
 * "Actualizar" del tablero de admin: vuelve a leer las hojas y el log (`router.refresh()`), y
 * relee solo al volver a la pestaña si pasó más de un minuto, igual que "Mi día". Hace falta
 * porque la app agregada a la pantalla de inicio no tiene el botón de recargar del navegador.
 */
export function BotonActualizar({ generado }: { generado: string }) {
  const { actualizar, actualizando } = useRefresco(generado);
  return (
    <button
      type="button"
      onClick={actualizar}
      disabled={actualizando}
      aria-label={actualizando ? "Actualizando el tablero" : "Actualizar el tablero"}
      title="Actualizar"
      className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-white/60 px-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-60 lg:px-3"
    >
      <IconoActualizar girando={actualizando} />
      <span className="hidden lg:inline">{actualizando ? "Actualizando…" : "Actualizar"}</span>
    </button>
  );
}
