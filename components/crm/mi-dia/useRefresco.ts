"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";

/** Al volver a la pestaña (o a la app en el celular) se relee la planilla si pasó más de esto. */
export const REFRESCO_AL_VOLVER_MS = 60_000;

/**
 * "Actualizar" y el refresco al volver a la pestaña (docs/diseno.md, sin polling: cuida la cuota
 * de la API). `datos` es lo que vino del servidor: cuando cambia, cuenta como la última lectura.
 */
export function useRefresco(datos: unknown): { actualizar: () => void; actualizando: boolean } {
  const router = useRouter();
  const [actualizando, iniciar] = useTransition();
  const ultimo = useRef(0);

  useEffect(() => {
    ultimo.current = Date.now();
  }, [datos]);

  const actualizar = useCallback(() => {
    ultimo.current = Date.now();
    iniciar(() => router.refresh());
  }, [router]);

  useEffect(() => {
    // visibilitychange y focus llegan juntos al volver: el primero actualiza y el segundo ya no.
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultimo.current > REFRESCO_AL_VOLVER_MS) actualizar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [actualizar]);

  return { actualizar, actualizando };
}
