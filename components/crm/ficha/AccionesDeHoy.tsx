"use client";

import { useMemo } from "react";
import type { ItemCliente } from "@/lib/crm/contratos";
import { HojaYToast } from "@/components/crm/mi-dia/HojaYToast";
import { useEscrituras } from "@/components/crm/mi-dia/useEscrituras";
import { ListaAccionesDeHoy } from "./ListaAccionesDeHoy";

type Props = {
  /** Las acciones de hoy del lead (hasta dos: pre-call y principal); [] si no le toca nada. */
  items: ItemCliente[];
  situaciones: string[];
  ahoraISO: string;
};

/**
 * Bloque "Acciones de hoy" de la página de la ficha (docs/diseno.md §Ficha): las mismas tarjetas que
 * en "Mi día", con los mismos botones, la hoja inferior y el toast con Deshacer. Después de cada
 * escritura la página se vuelve a leer (`router.refresh()` en `useEscrituras`) y aparece la acción
 * siguiente.
 */
export function AccionesDeHoy({ items, situaciones, ahoraISO }: Props) {
  const escrituras = useEscrituras(items);
  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);

  return (
    <>
      <ListaAccionesDeHoy items={items} escrituras={escrituras} />
      <HojaYToast escrituras={escrituras} situaciones={situaciones} ahora={ahora} />
    </>
  );
}
