"use client";
import { useEffect } from "react";
import Link from "next/link";

// Error al armar Cobro de cuotas (por ejemplo, la base Neon no respondió). Mismo patrón que app/(shell)/error.tsx:
// unstable_retry vuelve a pedir la página al servidor (reset() solo redibujaba la misma respuesta con el error).
// El detalle queda en la consola: acá no se muestra texto interno.
export default function ErrorCuotas({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">No se pudieron cargar las cuotas</h1>
      <p role="alert" className="mt-3">Probá otra vez. Si continúa, avisale a Tomás para revisar la conexión.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => unstable_retry()} className="min-h-11 rounded-lg bg-dorado px-4 font-bold text-negro hover:bg-dorado-oscuro hover:text-blanco">
          Reintentar
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center px-3 underline-offset-4 hover:underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
