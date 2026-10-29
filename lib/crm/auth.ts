// Sesión del CRM de ventas = la sesión de Google del dashboard (lib/auth/sesion.ts). No hay PIN ni cookie propia:
//   socio            → "admin" del CRM (ve todas las pestañas y el tablero de administración).
//   closer o setter  → "closer": solo las pestañas que el socio le asignó en AUTH_VENTAS_PESTANAS. Sin pestaña
//                      asignada no entra a ningún lead (sesionActual devuelve null y la página lo explica).
//   csm              → sin acceso (la matriz de roles ya lo frena antes de llegar acá).
// Mantiene la misma forma que tenía el CRM original (Sesion, requerirSesion, closerDeSesion…) para no tocar su lógica.
import { redirect } from "next/navigation";
import { puedeVer, rutaSinCRM } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { closers, hojasClosers, hojasDeMail, type Closer } from "@/lib/crm/config";

export { NOMBRE_ADMIN, firmarOperacion, verificarOperacion } from "@/lib/crm/firma";
import { NOMBRE_ADMIN } from "@/lib/crm/firma";

export type Rol = "closer" | "admin";

/** Responsable de los planes de cuotas de Administración (renovaciones y cobros que no son de un closer). */
export const RESPONSABLE_ADMINISTRACION = "admin";

export type Sesion = {
  rol: Rol;
  /** id de la pestaña (idDeHoja). Solo para rol "closer". */
  closerId?: string;
  /** Lo que queda en la columna Closer del log: el nombre de la persona, o "Admin". */
  nombre: string;
  email: string;
  /** Pestañas que puede abrir (todas para el admin). */
  hojas: string[];
};

/** La sesión del CRM, o null si no hay sesión de Google, el rol no ve Ventas o el closer no tiene pestaña asignada. */
export async function sesionActual(seccion: "ventas" | "cuotas" = "ventas"): Promise<Sesion | null> {
  const s = await obtenerSesion();
  if (!s || !puedeVer(s, seccion)) return null;
  // Administrador (socio de Vercel o "admin" de Configuración): ve todas las pestañas y el tablero
  if (s.admin) return { rol: "admin", nombre: NOMBRE_ADMIN, email: s.email, hojas: hojasClosers() };
  // Closer, setter o persona con Ventas marcada en Configuración: solo las pestañas que se le asignaron
  const hojas = hojasDeMail(s.email);
  const closer = closers().find((c) => c.hoja === hojas[0]);
  if (!closer) {
    // Decisión de Tomás (10/10/2026): quien tiene Cobro de cuotas pero no Ventas (un acceso de Configuración, sin pestaña de
    // closer) ve y gestiona SOLO los planes de Administración: es el "closer" de esa lista (listarPlanes y puedeAcceder ya
    // filtran por closerId). Con Ventas y sin pestaña sigue sin sesión: /ventas le explica el "sin CRM asignado".
    if (seccion === "cuotas" && !puedeVer(s, "ventas")) return { rol: "closer", closerId: RESPONSABLE_ADMINISTRACION, nombre: s.nombre, email: s.email, hojas: [] };
    return null;
  }
  return { rol: "closer", closerId: closer.id, nombre: s.nombre, email: s.email, hojas };
}

/**
 * Aviso para quien ve Cobro de cuotas sin sesión del CRM y sin a dónde redirigirlo. Desde el 10/10/2026 no debería pasar:
 * con Cobro de cuotas sin Ventas se ven los planes de Administración (sesionActual) y con Ventas sin pestaña se va a /ventas.
 */
export const AVISO_CUOTAS_SIN_PESTANA = {
  titulo: "Tu cuenta todavía no tiene planes de cuotas asignados",
  texto:
    "Tenés acceso a Cobro de cuotas, pero no sos administrador ni tenés una pestaña del CRM de ventas asignada (cada closer ve sus planes). Pedile a un socio que te la asigne en Configuración.",
};

/**
 * Para páginas: sin sesión de Google → /entrar; con sesión pero sin acceso al CRM → /ventas (muestra el "sin CRM asignado")
 * o, si no ve Ventas, a su sección inicial. Nunca de vuelta a la misma sección: quien ve Cobro de cuotas sin Ventas ni
 * pestaña y tiene /cuotas como sección inicial quedaba en un bucle de redirecciones. Ahí se corta con un error (sin darle
 * ningún plan: no se abre ningún permiso). Ojo: hoy lo atrapa app/(shell)/cuotas/error.tsx, que muestra su texto fijo
 * ("No se pudieron cargar las cuotas…") y no este mensaje (en producción Next igual lo reemplaza por uno genérico). Para
 * que la persona vea AVISO_CUOTAS_SIN_PESTANA, la página de cuotas tiene que mostrarlo antes de llamar a requerirSesion.
 */
export async function requerirSesion(seccion: "ventas" | "cuotas" = "ventas"): Promise<Sesion> {
  const sesion = await sesionActual(seccion);
  if (sesion) return sesion;
  const base = await obtenerSesion();
  if (!base) redirect("/entrar");
  const destino = rutaSinCRM(base, seccion);
  if (destino) redirect(destino);
  throw new Error(AVISO_CUOTAS_SIN_PESTANA.texto);
}

/** Para páginas de admin: cualquiera que no sea socio vuelve a su lista. */
export async function requerirAdmin(): Promise<Sesion> {
  const sesion = await requerirSesion();
  if (sesion.rol !== "admin") redirect("/ventas");
  return sesion;
}

/** El closer de una sesión de rol "closer". Lanza si la sesión es de admin o la pestaña ya no existe. */
export function closerDeSesion(sesion: Sesion): Closer {
  const closer = sesion.rol === "closer" ? closers().find((c) => c.id === sesion.closerId) : undefined;
  if (!closer) throw new Error(`La sesión no corresponde a una pestaña de closer (${sesion.closerId ?? sesion.rol})`);
  // El nombre de la persona (no el de la pestaña) es el que se muestra y el que queda en el log
  return { ...closer, nombre: sesion.nombre };
}

/** Admin ve cualquier hoja de closer; un closer, solo las suyas. */
export function puedeVerHoja(sesion: Sesion, hoja: string): boolean {
  if (!hojasClosers().includes(hoja)) return false;
  return sesion.rol === "admin" || sesion.hojas.includes(hoja);
}
