import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de la Cartera (/clientes) a nivel de segmento: corre ANTES del límite de carga (loading.tsx), así un rol sin
// permiso recibe un 307 real y no una redirección dentro de la respuesta ya empezada. Pide la sección 'clientes': la Cartera
// muestra cobros, y ninguna otra pestaña del hub la habilita (quien no la tiene va a su primera pestaña: destinoSinPermiso).
// La página la repite (un layout no se vuelve a ejecutar en cada navegación dentro del segmento).
export default async function CarteraLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('clientes')
  return children
}
