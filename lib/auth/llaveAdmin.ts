// ── Llave de administrador para Finanzas y Anuncios (8/10/2026, pedido de Tomás) ─────────────────────────────
// Finanzas y Anuncios se abren con su propia contraseña (lib/finanzasAuth.ts, lib/anuncios/auth.ts). Desde el 8/10 un
// ADMINISTRADOR con sesión de Google válida (socio de la lista fija de Vercel o "admin" de la planilla de Accesos) entra sin
// pedirle la contraseña: ya se identificó con Google. Cualquier otra persona (closer, csm, setter, acceso por secciones, o el
// media buyer que entra solo con la clave) sigue exactamente como antes. Las contraseñas no cambian.
// Se usa en todas las puertas: proxy.ts, las páginas y las rutas de API de las dos secciones.
import { asegurarUsuarios } from './accesos'
import { sesionDePeticion } from './acceso'
import type { Sesion } from './identidad'

type Cabeceras = { get(nombre: string): string | null }

/** Administrador: socio (lista fija) o "admin" de la planilla. Fallo cerrado: sin sesión, false. */
export const esAdministrador = (s: Pick<Sesion, 'rol' | 'admin'> | null | undefined): boolean => !!s && (s.admin || s.rol === 'socio')

/** Para proxy.ts y las rutas de API: la sesión de Google de la petición, con la lista de accesos al día. */
export async function adminPorCabeceras(headers: Cabeceras): Promise<boolean> {
  try {
    await asegurarUsuarios()
    return esAdministrador(sesionDePeticion(headers))
  } catch {
    return false
  }
}
