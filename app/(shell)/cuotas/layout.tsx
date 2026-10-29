import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de acceso de Cobro de cuotas a nivel de segmento (igual que Clientes): corre ANTES del límite de carga.
export default async function CuotasLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('cuotas')
  return children
}
