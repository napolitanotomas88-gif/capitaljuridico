import { exigirAcceso } from '@/lib/auth/sesion'
import './trazabilidad.css'

// Barrera de acceso de Trazabilidad a nivel de segmento (igual que Guiones): un rol sin permiso recibe un 307 real.
export default async function TrazabilidadLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('trazabilidad')
  return children
}
