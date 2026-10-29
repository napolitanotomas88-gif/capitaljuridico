import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BotonGuia } from "@/components/crm/BotonGuia";
import { BotonMensajes } from "@/components/crm/BotonMensajes";
import { AccionesDeHoy } from "@/components/crm/ficha/AccionesDeHoy";
import { ContenidoFicha } from "@/components/crm/ficha/ContenidoFicha";
import { puedeVerHoja, requerirSesion } from "@/lib/crm/auth";
import { closers } from "@/lib/crm/config";
import { decodificarParam, leerFilaParam } from "@/lib/crm/entrada";
import { conDiagnostico } from "@/lib/crm/errores";
import { datosDelLead } from "@/lib/crm/mi-dia";
import { leerDesplegables } from "@/lib/crm/sheets/desplegables";

export const metadata: Metadata = { title: "Ficha del lead" };

/**
 * Ficha del lead (docs/arquitectura.md §Ficha): "Acciones de hoy" arriba con los mismos botones
 * que "Mi día", contacto, estado, contexto de la agenda, formulario de cierre (`guardarFicha`) e
 * historial del "Log App". El cuerpo es `ContenidoFicha`, el mismo del panel lateral del tablero.
 * El closer ve solo las de su hoja; el admin, cualquiera.
 *
 * La hoja llega codificada (`/lead/Closer%201/541` → "Closer%201"; ver `decodificarParam`).
 */
export default async function PaginaLead({ params }: PageProps<"/ventas/lead/[hoja]/[fila]">) {
  const crudo = await params;
  const hoja = decodificarParam(crudo.hoja);
  const numeroFila = leerFilaParam(crudo.fila);
  const sesion = await requerirSesion();
  if (hoja === null || !puedeVerHoja(sesion, hoja)) redirect("/ventas");
  if (numeroFila === null) notFound();

  const ahora = new Date();
  const [ficha, desplegables] = await conDiagnostico(Promise.all([datosDelLead(hoja, numeroFila, ahora), leerDesplegables(hoja)]));
  if (!ficha) notFound();
  const { identidad, items } = ficha;

  // Volver: el closer a su lista; el admin a la lista del closer dueño de la hoja.
  const closerDeLaHoja = closers().find((c) => c.hoja === hoja);
  // El socio y quien trabaja en varias hojas (pre-caller) vuelven a la hoja de este lead; un closer, a su día
  const variasHojas = sesion.rol === "admin" || sesion.hojas.length > 1;
  const volver = variasHojas ? (closerDeLaHoja ? `/ventas/closer/${encodeURIComponent(closerDeLaHoja.id)}` : sesion.rol === "admin" ? "/ventas/admin" : "/ventas") : "/ventas";

  return (
    <div className="flex flex-1 flex-col">
      <header className="marca-barra sticky top-0 z-30 bg-negro px-4 py-2 text-blanco" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <Link
            href={volver}
            aria-label="Volver a la lista"
            className="-ml-2 flex h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold hover:bg-white/10"
          >
            <span aria-hidden="true" className="text-lg leading-none">←</span>
            <span className="ml-1 hidden sm:inline">Volver</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold uppercase tracking-[0.2em] text-dorado">Ficha · {closerDeLaHoja?.nombre ?? hoja}</p>
            <h1 className="truncate text-lg font-bold leading-tight">{identidad.nombre.trim()}</h1>
          </div>
            <BotonMensajes />
            <BotonGuia />
          {sesion.rol === "admin" && (
            <Link
              href="/ventas/admin"
              className="hidden h-11 shrink-0 items-center rounded-lg border border-white/60 px-3 text-sm font-semibold hover:bg-white/10 sm:flex"
            >
              Tablero
            </Link>
          )}
        </div>
      </header>

      {/* div y no main: el main es el del shell. pb-28: en el celular la barra de secciones (fija abajo) no tapa el final. */}
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 lg:px-6 lg:pb-4">
        <ContenidoFicha
          ficha={ficha}
          dosColumnas
          accion={<AccionesDeHoy items={items} situaciones={desplegables.situacion} ahoraISO={ahora.toISOString()} />}
        />
      </div>
    </div>
  );
}
