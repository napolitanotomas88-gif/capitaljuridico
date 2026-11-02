import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { puedeVer } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { PestanasClientes } from '@/components/shell/PestanasClientes'
import { puedeEntregarGuiones } from '@/lib/bot/guiones/entrega'
import { pestanasVisibles } from '@/lib/auth/hubClientes'
import { rutaInicial } from '@/lib/auth/roles'
import { obtenerSesion } from '@/lib/auth/sesion'
import { rutaPortal } from '@/lib/auth/portal'
import { portalesArmados } from '@/lib/clientes/portal/base'
import { cargarVista } from '@/lib/clientes/vista'

// Clientes como hub (25/10/2026): arriba las pestañas que la persona puede ver (Cartera, Guiones, Edición, Anuncios,
// Referidos) y abajo la pantalla de la pestaña. Este layout solo exige tener AL MENOS UNA pestaña; cada pestaña tiene su
// propia barrera con su sección de siempre: (cartera)/layout.tsx y [id]/layout.tsx piden 'clientes' (la Cartera muestra
// cobros), edicion/layout.tsx pide 'edicion' y referidos/layout.tsx pide 'referidos'. Guiones (/guiones) y Anuncios
// (/anuncios) viven fuera de /clientes y dibujan las mismas pestañas desde sus layouts. Tabla completa: lib/auth/hubClientes.ts.
export default async function ClientesHubLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion({ incluirCliente: true })
  if (!sesion) redirect('/entrar')
  // Portal del cliente (2/11/2026): el cliente no ve pestañas. Su única página (/clientes/portal/<ID>) se protege sola
  // (accesoPortal); cualquier otra que pida la manda a su portal (exigirAcceso → /entrar → rutaInicial).
  if (sesion.rol === 'cliente') return <div className="cj-hub-cuerpo">{children}</div>
  const pestanas = pestanasVisibles(sesion)
  if (pestanas.length === 0) redirect(rutaInicial(sesion))
  // Portales del cliente (2/11/2026): una pestaña por portal armado, solo para quien ve la Cartera (el portal pide 'clientes').
  // Título = el del portal; sin título, «Portal · <nombre del CRM>». Todo sale de Neon y del CRM: nada de clientes en el código.
  const portales = puedeVer(sesion, 'clientes') ? await pestanasDePortal() : []
  return (
    <>
      <PestanasClientes pestanas={pestanas} portales={portales} puedeEditarCliente={puedeHacerAcciones(sesion.email)} puedeFinanzas={puedeVer(sesion, 'finanzas')} puedeEntregarGuiones={puedeVer(sesion, 'clientes') && puedeEntregarGuiones(sesion.email)} />
      <div className="cj-hub-cuerpo">{children}</div>
    </>
  )
}

async function pestanasDePortal(): Promise<{ href: string; etiqueta: string }[]> {
  const armados = await portalesArmados()
  if (armados.length === 0) return []
  // El CRM solo se lee si algún portal no tiene título (misma lectura memorizada que usa la página)
  const sinTitulo = armados.some(p => !p.titulo)
  const clientes = sinTitulo ? await cargarVista(false, 'omitir').then(v => v.datos.clientes).catch(() => []) : []
  return armados.map(p => ({
    href: rutaPortal(p.id),
    etiqueta: p.titulo || `Portal · ${clientes.find(c => c.id === p.id)?.nombre ?? p.id}`,
  }))
}
