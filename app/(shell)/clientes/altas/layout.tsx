import { redirect } from 'next/navigation'
import { rutaInicial } from '@/lib/auth/roles'
import { obtenerSesion } from '@/lib/auth/sesion'
import { puedeCargar } from '@/lib/bot/alta/despacho/aprobadores'

// «Cargar alta» (26/10/2026): entran los closers (rol "closer": cargan y completan SUS altas) y los aprobadores (Tomás,
// Gero A, Aylu y Gero M, por su mail: lib/bot/alta/despacho/aprobadores.ts). Barrera a nivel de segmento, antes de cargar
// nada; la página la repite (un layout no se vuelve a ejecutar en cada navegación).
export default async function AltasLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/entrar?next=/clientes/altas')
  if (!puedeCargar(sesion)) redirect(rutaInicial(sesion))
  return children
}
