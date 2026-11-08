import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoPrecaller } from "@/components/crm/mi-dia/DemoPrecaller";
import { requerirSesion } from "@/lib/crm/auth";

export const metadata: Metadata = { title: "Pre-caller · práctica" };

/**
 * Tablero de práctica del pre-caller (Gero, 7/11/2026): leads de mentira para ver y probar las 4 columnas. Todo vive en la
 * memoria del navegador: no lee ni escribe la planilla, no llama a Make/2Chat/Calendly y se reinicia al recargar.
 * Lo ven el socio y el pre-caller.
 */
export default async function PaginaDemoPrecaller() {
  const sesion = await requerirSesion();
  if (sesion.rol !== "admin" && !sesion.precaller) redirect("/ventas");
  return <DemoPrecaller ahoraISO={new Date().toISOString()} />;
}
