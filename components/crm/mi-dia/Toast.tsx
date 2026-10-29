"use client";
import Link from "next/link";

import type { ItemCliente, Operacion } from "@/lib/crm/contratos";

export type EstadoToast =
  | { tipo: "guardando"; texto: string }
  | { tipo: "ok"; texto: string; item: ItemCliente; operacion: Operacion; motivo: string }
  | { tipo: "deshaciendo" }
  | { tipo: "info"; texto: string }
  | { tipo: "error"; texto: string };

type Props = {
  estado: EstadoToast | null;
  /** Deshabilitado mientras hay una escritura en curso para ese lead. */
  puedeDeshacer: boolean;
  onDeshacer: (estado: Extract<EstadoToast, { tipo: "ok" }>) => void;
  /** Hay una hoja inferior abierta: en el celular el aviso va arriba para no tapar su Confirmar. */
  arriba?: boolean;
};

/**
 * Aviso "Listo · Deshacer" (5 s) o el error de la escritura. Las dos regiones `aria-live` están
 * siempre en la página (un lector de pantalla solo anuncia cambios dentro de una región que ya
 * existía): `status` para lo que salió bien, `alert` para los errores.
 */
export function Toast({ estado, puedeDeshacer, onDeshacer, arriba = false }: Props) {
  const esError = estado?.tipo === "error";
  const caja = estado && (
    <div
      className={`pointer-events-auto flex flex-wrap min-h-14 items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-2xl ${
        esError ? "bg-rojo text-blanco" : "bg-negro text-blanco"
      }`}
    >
      <span className="min-w-0 break-words">
        {estado.tipo === "guardando" && `Guardando… ${estado.texto}`}
        {estado.tipo === "ok" && estado.texto}
        {estado.tipo === "deshaciendo" && "Deshaciendo…"}
        {estado.tipo === "info" && estado.texto}
        {estado.tipo === "error" && estado.texto}
      </span>
      {estado.tipo === "ok" && /^cerrado en /i.test(String(estado.operacion.despues.situacion ?? "")) && <Link className="min-h-11 inline-flex items-center rounded-lg border border-dorado px-3 text-dorado" href={`/cuotas?${new URLSearchParams({nuevo:"si",nombre:estado.item.identidad.nombre,telefono:estado.item.identidad.telefono,hoja:estado.item.identidad.hoja}).toString()}`}>Crear plan de cuotas</Link>}
      {estado.tipo === "ok" && (
        <button
          type="button"
          disabled={!puedeDeshacer}
          onClick={() => onDeshacer(estado)}
          className="min-h-11 shrink-0 rounded-lg px-3 font-bold text-dorado hover:bg-white/10 disabled:opacity-50"
        >
          Deshacer
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`pointer-events-none fixed inset-x-3 z-50 lg:inset-x-auto lg:bottom-6 lg:left-6 lg:top-auto lg:w-96 ${
        arriba ? "top-3" : "bottom-3"
      }`}
      style={{
        marginLeft: "env(safe-area-inset-left)",
        marginRight: "env(safe-area-inset-right)",
        ...(arriba ? { marginTop: "env(safe-area-inset-top)" } : { marginBottom: "env(safe-area-inset-bottom)" }),
      }}
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        {!esError && caja}
      </div>
      <div role="alert" aria-atomic="true">
        {esError && caja}
      </div>
    </div>
  );
}
