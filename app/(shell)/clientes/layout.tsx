import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { puedeVer } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { PestanasClientes } from '@/components/shell/PestanasClientes'
import { puedeEntregarGuiones } from '@/lib/bot/guiones/entrega'
import { pestanasVisibles } from '@/lib/auth/hubClientes'
import { rutaInicial } from '@/lib/auth/roles'
import { obtenerSesion } from '@/lib/auth/sesion'

// Clientes como hub (25/10/2026): arriba las pestañas que la persona puede ver (Cartera, Guiones, Edición, Anuncios,
// Referidos) y abajo la pantalla de la pestaña. Este layout solo exige tener AL MENOS UNA pestaña; cada pestaña tiene su
// propia barrera con su sección de siempre: (cartera)/layout.tsx y [id]/layout.tsx piden 'clientes' (la Cartera muestra
// cobros), edicion/layout.tsx pide 'edicion' y referidos/layout.tsx pide 'referidos'. Guiones (/guiones) y Anuncios
// (/anuncios) viven fuera de /clientes y dibujan las mismas pestañas desde sus layouts. Tabla completa: lib/auth/hubClientes.ts.
export default async function ClientesHubLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/entrar')
  const pestanas = pestanasVisibles(sesion)
  if (pestanas.length === 0) redirect(rutaInicial(sesion))
  return (
    <>
      <PestanasClientes pestanas={pestanas} puedeEditarCliente={puedeHacerAcciones(sesion.email)} puedeFinanzas={puedeVer(sesion, 'finanzas')} puedeEntregarGuiones={puedeVer(sesion, 'clientes') && puedeEntregarGuiones(sesion.email)} />
      <div className="cj-hub-cuerpo">{children}</div>
    </>
  )
}
