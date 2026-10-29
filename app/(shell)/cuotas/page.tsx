import Link from "next/link";
import { BotonGuia } from "@/components/crm/BotonGuia";
import { RESPONSABLE_ADMINISTRACION, puedeVerHoja, requerirSesion } from "@/lib/crm/auth";
import { puedeVer } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { closers } from "@/lib/crm/config";
import { configurado, listarPlanes } from "@/lib/crm/cuotas/db";
import { TableroCuotas } from "@/components/crm/cuotas/TableroCuotas";
import { hoyBA } from "@/lib/crm/cuotas/modelo";

// Cobro de cuotas (ZIP del CRM del 8/10/2026): planes de pago de clientes con avisos, cobros, pagos parciales y abandonos.
// Sección propia de la barra (10/10/2026, pedido de Tomás): ya no vive dentro de Ventas; las dos planillas no tienen relación.
// Base propia en Neon Postgres (CUOTAS_DATABASE_URL o DATABASE_URL); no lee ni escribe Google Sheets. Socio = todos los planes
// y Administración; closer = solo los suyos. Docs: docs/CUOTAS.md.
export const metadata = { title: "Cobro de cuotas" };
export const dynamic = "force-dynamic";

export default async function Cuotas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sesion = await requerirSesion("cuotas");
  // Quien entra sin Ventas (solo planes de Administración) no tiene la guía del CRM de ventas: el botón llevaría a otra sección
  const base = await obtenerSesion();
  const veVentas = !!base && puedeVer(base, "ventas");
  const soloAdministracion = sesion.rol === "closer" && sesion.closerId === RESPONSABLE_ADMINISTRACION;
  const responsables = [
    ...closers().map((c) => ({ id: c.id, nombre: c.nombre })),
    { id: "admin", nombre: "Administración" },
  ];
  const habilitado = configurado();
  const registros = habilitado
    ? await listarPlanes(sesion.rol === "admin" ? undefined : sesion.closerId)
    : [];
  const parametros = await searchParams;
  const valor = (k: string) =>
    typeof parametros[k] === "string" ? (parametros[k] as string).slice(0, 150) : "";
  const hoja = valor("hoja");
  const dueno = hoja && puedeVerHoja(sesion, hoja) ? closers().find((c) => c.hoja === hoja)?.id : undefined;
  return (
    <>
      <header className="marca-barra sticky top-0 z-30 bg-negro text-blanco">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div>
            <h1 className="text-xl font-bold">Cobro de cuotas</h1>
            <p className="text-sm text-white/75">{sesion.rol === "admin" ? "Equipo y renovaciones" : soloAdministracion ? `${sesion.nombre} · planes de Administración` : sesion.nombre}</p>
          </div>
          {/* Sin Ventas no hay nada que mostrar acá: el <nav> vacío sería un landmark sin contenido para el lector de pantalla */}
          {veVentas && (
            <nav aria-label="Secciones del CRM" className="flex flex-wrap items-center gap-3">
              <BotonGuia />
            </nav>
          )}
        </div>
      </header>
      {habilitado ? (
        <TableroCuotas
          registros={registros}
          responsables={responsables}
          esAdmin={sesion.rol === "admin"}
          responsable={sesion.closerId ?? "admin"}
          hoy={hoyBA()}
          ahora={new Date().toISOString()}
          prefill={
            valor("nuevo") === "si"
              ? { nombre: valor("nombre"), telefono: valor("telefono"), responsable: dueno ?? valor("responsable") }
              : undefined
          }
        />
      ) : (
        <div className="mx-auto w-full max-w-3xl p-6">
          <h2 className="text-2xl font-bold">Cuotas: conexión pendiente</h2>
          <p className="mt-4">Cuotas necesita su base de datos (Neon), que todavía no está conectada a este proyecto. El resto del dashboard sigue disponible.</p>
          <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-dorado px-4 font-bold">
            Volver al inicio
          </Link>
        </div>
      )}
    </>
  );
}
