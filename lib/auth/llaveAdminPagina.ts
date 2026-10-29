// Igual que adminPorCabeceras (lib/auth/llaveAdmin.ts) pero para páginas (Server Components): lee la cookie con next/headers.
import { obtenerSesion } from './sesion'
import { esAdministrador } from './llaveAdmin'

export async function adminEnPagina(): Promise<boolean> {
  try {
    return esAdministrador(await obtenerSesion())
  } catch {
    return false
  }
}
