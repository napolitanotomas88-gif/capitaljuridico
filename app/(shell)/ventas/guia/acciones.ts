"use server";
// Editar los enlaces de los videos de la guía (igual que el CRM original: solo el administrador).
import { revalidatePath } from "next/cache";
import { sesionActual } from "@/lib/crm/auth";
import { enlaceValido, guardarVideosGuia } from "@/lib/crm/videosGuia";

export type EstadoVideos = { ok?: boolean; mensaje?: string; error?: string };

export async function guardarVideos(_previo: EstadoVideos, datos: FormData): Promise<EstadoVideos> {
  const sesion = await sesionActual();
  if (sesion?.rol !== "admin") return { error: "Solo el administrador puede editar los videos." };
  const ventas = enlaceValido(datos.get("ventas"));
  const cuotas = enlaceValido(datos.get("cuotas"));
  if (!ventas || !cuotas) return { error: "Ingresá enlaces HTTPS válidos." };
  try {
    await guardarVideosGuia({ ventas, cuotas });
  } catch {
    return { error: "No se pudo guardar. Probá de nuevo en un rato." };
  }
  revalidatePath("/ventas/guia");
  return { ok: true, mensaje: "Enlaces guardados." };
}
