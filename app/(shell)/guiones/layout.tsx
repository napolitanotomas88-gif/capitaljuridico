import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { puedeVer } from '@/lib/auth/roles'
import { PestanasClientes } from '@/components/shell/PestanasClientes'
import { puedeEntregarGuiones } from '@/lib/bot/guiones/entrega'
import { pestanasVisibles } from '@/lib/auth/hubClientes'
import { exigirAcceso } from '@/lib/auth/sesion'

// Barrera de acceso de Guiones a nivel de segmento (igual que Ventas): un rol sin permiso recibe un 307 real.
// Desde el 25/10/2026 Guiones es una pestaña de Clientes: la ruta no se movió (/guiones y la tanda por cliente /guiones/[id]
// siguen pidiendo solo la sección Guiones, sin Clientes), pero se dibujan las pestañas del hub (lib/auth/hubClientes.ts).
export default async function GuionesLayout({ children }: { children: React.ReactNode }) {
  const sesion = await exigirAcceso('guiones')
  return (
    <>
      <PestanasClientes pestanas={pestanasVisibles(sesion)} puedeEditarCliente={puedeHacerAcciones(sesion.email)} puedeFinanzas={puedeVer(sesion, 'finanzas')} puedeEntregarGuiones={puedeVer(sesion, 'clientes') && puedeEntregarGuiones(sesion.email)} />
      <div className="cj-hub-cuerpo">{children}</div>
    </>
  )
}
