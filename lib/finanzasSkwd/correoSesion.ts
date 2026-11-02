// Correo de quien entró a Finanzas (lo comparten /api/finanzas/db, /api/finanzas/preferencias y el marco de cristal).
// Mismo acceso que /api/finanzas: cookie de la contraseña de Finanzas o administrador del Despacho. Con Google, su correo;
// con la contraseña (sin Google), un correo fijo que firma los cambios. Sin acceso: null.
import { tokenValido } from '@/lib/finanzasAuth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { sesionDePeticion } from '@/lib/auth/acceso'

/** Correo que firma los cambios cuando se entró a Finanzas con la contraseña (sin Google). */
export const CORREO_SIN_GOOGLE = 'acceso-por-clave@finanzas.despacho'

type Cabeceras = { get(nombre: string): string | null }

export async function correoFinanzas(cabeceras: Cabeceras, tokenFinanzas: string | undefined | null): Promise<string | null> {
  if (!tokenValido(tokenFinanzas) && !(await adminPorCabeceras(cabeceras))) return null
  try { return sesionDePeticion(cabeceras)?.email || CORREO_SIN_GOOGLE } catch { return CORREO_SIN_GOOGLE }
}
