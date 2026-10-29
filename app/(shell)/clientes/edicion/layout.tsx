import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de Edición (pestaña de Clientes desde el 25/10/2026, antes /edicion) a nivel de segmento: la sección 'edicion',
// la de siempre. Cada página la repite en contextoEdicion (_componentes/contexto.ts).
export default async function EdicionLayout({ children }: { children: React.ReactNode }) {
  await exigirAcceso('edicion')
  return children
}
