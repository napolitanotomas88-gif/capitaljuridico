import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CargandoVentas } from "@/components/crm/CargandoVentas";
import { PantallaMiDia } from "@/components/crm/mi-dia/PantallaMiDia";
import { closerDeSesion, puedeVerHoja, requerirSesion } from "@/lib/crm/auth";
import { closers } from "@/lib/crm/config";
import { decodificarParam } from "@/lib/crm/entrada";
import { ID_VISTA_PRECALLER, VISTA_PRECALLER, precallV2Activo } from "@/lib/crm/config/precallV2";

type Props = PageProps<"/ventas/closer/[id]">;

/** El id llega codificado, como todos los params de Next 16 (ver `decodificarParam`). */
async function closerDeParams(params: Props["params"]) {
  const id = decodificarParam((await params).id);
  // Pre-call v2: la vista del pre-caller (todas las hojas) solo existe con la bandera prendida
  if (id === ID_VISTA_PRECALLER && precallV2Activo()) return { id, closer: VISTA_PRECALLER };
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
  // La vista del pre-caller: el socio o quien trabaja en varias hojas
  if (closer === VISTA_PRECALLER && sesion.rol !== "admin" && !sesion.precaller && sesion.hojas.length < 2) redirect("/ventas");
  // El pre-caller no ve las hojas de los closers: solo su vista
  if (closer && closer !== VISTA_PRECALLER && (sesion.precaller || !puedeVerHoja(sesion, closer.hoja))) redirect("/ventas");
  if (!closer) notFound();

  // Para un closer con una sola pestaña se muestra su nombre; para el socio y para quien trabaja en varias (pre-caller),
  // el de la pestaña elegida (el de su closer)
  const propia = sesion.rol === "closer" && sesion.hojas.length === 1 && sesion.closerId === closer.id;
  // Las hojas se leen dentro de <Suspense>: el esqueleto sale al toque y las redirecciones de arriba siguen siendo reales.
  return (
    <Suspense fallback={<CargandoVentas />}>
      <PantallaMiDia closer={propia ? closerDeSesion(sesion) : closer} sesion={sesion} />
    </Suspense>
  );
}
