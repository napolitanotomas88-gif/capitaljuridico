import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de la ficha (/clientes/<id> y su kickoff): la sección 'clientes', igual que antes del hub (25/10/2026), antes del
// límite de carga. Además cubre lo que el proxy compara sin mayúsculas: /clientes/EDICION no es Edición sino un <id>, y acá
// pide la Cartera. Cada página la repite.
export default async function FichaLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('clientes')
  return children
}
