import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de acceso de Configuración a nivel de segmento: solo administradores (la sección 'configuracion' no se puede asignar a mano).
export default async function ConfiguracionLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('configuracion')
  return children
}
