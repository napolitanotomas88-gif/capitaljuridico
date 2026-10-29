import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PantallaMiDia } from "@/components/crm/mi-dia/PantallaMiDia";
import { closerDeSesion, puedeVerHoja, requerirSesion } from "@/lib/crm/auth";
import { closers } from "@/lib/crm/config";
import { decodificarParam } from "@/lib/crm/entrada";

type Props = PageProps<"/ventas/closer/[id]">;

/** El id llega codificado, como todos los params de Next 16 (ver `decodificarParam`). */
async function closerDeParams(params: Props["params"]) {
  const id = decodificarParam((await params).id);
  return { id, closer: id === null ? undefined : closers().find((c) => c.id === id) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { closer } = await closerDeParams(params);
  return { title: closer ? `Mi día de ${closer.nombre}` : "Mi día" };
}

/** "Mi día" de un closer: el admin ve a cualquiera; un closer, solo el suyo. */
export default async function PaginaCloser({ params }: Props) {
  const { closer } = await closerDeParams(params);
  const sesion = await requerirSesion();
  // El socio ve a cualquiera; un closer o setter, solo las pestañas que tiene asignadas (nunca la de otro)
  if (closer && !puedeVerHoja(sesion, closer.hoja)) redirect("/ventas");
  if (!closer) notFound();

  // Para un closer con una sola pestaña se muestra su nombre; para el socio y para quien trabaja en varias (pre-caller),
  // el de la pestaña elegida (el de su closer)
  const propia = sesion.rol === "closer" && sesion.hojas.length === 1 && sesion.closerId === closer.id;
  return <PantallaMiDia closer={propia ? closerDeSesion(sesion) : closer} sesion={sesion} />;
}
