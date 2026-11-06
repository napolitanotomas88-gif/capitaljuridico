import { NOMBRE_ADMIN, puedeVerHoja } from "@/lib/crm/auth";
import type { Sesion } from "@/lib/crm/auth";
import { closers, type Closer } from "@/lib/crm/config";
import { conDiagnostico } from "@/lib/crm/errores";
import { datosMiDia, datosPrecaller } from "@/lib/crm/mi-dia";
import { VISTA_PRECALLER, precallV2Activo } from "@/lib/crm/config/precallV2";
import { leerDesplegables } from "@/lib/crm/sheets/desplegables";
import { MiDia } from "./MiDia";

/**
 * Server component compartido por "/" y "/closer/[id]": arma la lista del día, las calls de hoy,
 * "Hechas hoy" (una lectura de la hoja y una del log) y la lista de situaciones (V), y se las
 * pasa al cliente. La autorización ya la hizo la página.
 */
export async function PantallaMiDia({ closer, sesion }: { closer: Closer; sesion: Sesion }) {
  const ahora = new Date();
  // Si la lectura falla, `conDiagnostico` le dice a la pantalla de error de qué tipo fue.
  const esAdmin = sesion.rol === "admin";
  // El selector de hoja: el socio ve todas; quien tiene varias pestañas (pre-caller), las suyas
  const hojasElegibles = closers().filter((c) => puedeVerHoja(sesion, c.hoja));
  // Pre-call v2: la vista del pre-caller junta las hojas que puede ver (los desplegables de V no se usan ahí: los de la primera)
  const esVistaPrecaller = closer.id === VISTA_PRECALLER.id;
  const hojaDesplegables = esVistaPrecaller ? (hojasElegibles[0]?.hoja ?? "") : closer.hoja;
  const [datos, desplegables] = await conDiagnostico(
    Promise.all([
      esVistaPrecaller ? datosPrecaller(hojasElegibles.map((c) => c.hoja), ahora) : datosMiDia(closer.hoja, ahora),
      leerDesplegables(hojaDesplegables),
    ]),
  );
  // El pre-caller no tiene selector: solo su vista
  const opciones = sesion.precaller ? [] : [...(precallV2Activo() && (esAdmin || hojasElegibles.length > 1) ? [VISTA_PRECALLER] : []), ...hojasElegibles];

  return (
    <MiDia
      // El admin cambia de closer sin cambiar de ruta: la clave reinicia filtros y tarjetas ocultas.
      key={closer.id}
      items={datos.items}
      calls={datos.calls}
      hechas={datos.hechas}
      ahoraISO={ahora.toISOString()}
      // Nunca el PIN al cliente: solo lo que la pantalla muestra.
      closer={{ id: closer.id, nombre: closer.nombre, hoja: closer.hoja }}
      situaciones={desplegables.situacion}
      esAdmin={esAdmin}
      closers={esAdmin || (!sesion.precaller && hojasElegibles.length > 1) ? opciones.map((c) => ({ id: c.id, nombre: c.nombre })) : []}
      excluirDelProgreso={NOMBRE_ADMIN}
    />
  );
}
