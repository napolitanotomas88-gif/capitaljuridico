import { MarcoShell } from '@/components/shell/MarcoShell'
import { PestanasClientes } from '@/components/shell/PestanasClientes'
import { pestanasVisibles } from '@/lib/auth/hubClientes'
import { puedeVer, type Seccion } from '@/lib/auth/roles'
import { obtenerSesion } from '@/lib/auth/sesion'
import { clasesFuentes } from '@/app/(shell)/fuentes'

/**
 * Finanzas y Anuncios se abren con su propia contraseña, sin pedir el login de Google (el acceso no cambió). Si además
 * hay una sesión de Google que puede ver la sección, la pantalla se muestra DENTRO del marco del dashboard (menú,
 * nombre y Salir). Sin sesión de Google (el media buyer, por ejemplo) se muestra sola, con la misma fuente.
 * Esto no abre ni cierra nada: el acceso lo deciden la contraseña y proxy.ts.
 */
export async function MarcoOpcional({ seccion, children, hubClientes = false }: { seccion: Seccion; children: React.ReactNode; hubClientes?: boolean }) {
  const sesion = await obtenerSesion()
  // hubClientes (Anuncios, 25/10/2026): dentro del marco van además las pestañas de Clientes que la persona puede ver.
  // Sin sesión de Google (el media buyer con la clave) no hay marco ni pestañas: no puede saltar a la Cartera ni a otra.
  if (sesion && puedeVer(sesion, seccion)) {
    return (
      <MarcoShell sesion={sesion}>
        {hubClientes ? <PestanasClientes pestanas={pestanasVisibles(sesion)} oscuro /> : null}
        {hubClientes ? <div className="cj-hub-cuerpo">{children}</div> : children}
      </MarcoShell>
    )
  }
  // Sin marco la pantalla es el contenido principal de la página (con marco lo es <main id="cj-contenido">)
  return <main className={clasesFuentes} lang="es">{children}</main>
}
