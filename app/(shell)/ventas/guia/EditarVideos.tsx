"use client";
import { useActionState } from "react";
import { guardarVideos, type EstadoVideos } from "./acciones";

export function EditarVideos({ ventas, cuotas }: { ventas: string; cuotas: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoVideos, FormData>(guardarVideos, {});
  return (
    <details className="mb-6 rounded-2xl border border-gris-linea bg-blanco p-5">
      <summary className="cursor-pointer font-bold">Editar enlaces de los videos</summary>
      <form action={accion} className="mt-4 space-y-4">
        <label className="block">Video del CRM de ventas<input name="ventas" type="url" required defaultValue={ventas} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <label className="block">Video de cobro de cuotas<input name="cuotas" type="url" required defaultValue={cuotas} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <button className="min-h-11 rounded-lg bg-dorado px-4 font-bold" disabled={pendiente}>{pendiente ? "Guardando…" : "Guardar enlaces"}</button>
        <p role="status" aria-live="polite" className={estado.error ? "text-sm text-red-700" : "text-sm"}>{estado.error ?? estado.mensaje ?? ""}</p>
      </form>
    </details>
  );
}
