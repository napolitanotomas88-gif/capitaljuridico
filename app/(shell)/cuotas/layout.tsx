import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de acceso de Cobro de cuotas a nivel de segmento (igual que Clientes): corre ANTES del límite de carga.
// `cuotas-raiz` le da los radios del Despacho a sus utilidades de Tailwind (globals.css), como `crm-raiz` en Ventas.
export default async function CuotasLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('cuotas')
  return <div className="cuotas-raiz">{children}</div>
}
