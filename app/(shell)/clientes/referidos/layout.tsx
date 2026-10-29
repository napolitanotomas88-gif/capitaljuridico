import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de acceso de Referidos a nivel de segmento: corre ANTES del límite de carga (loading.tsx), así un rol sin permiso
// recibe un 307 real y no una redirección dentro de la respuesta ya empezada. Cada página la repite (un layout no se
// vuelve a ejecutar en cada navegación dentro del segmento).
export default async function ReferidosLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('referidos')
  return children
}
