import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PantallaMiDia } from '@/components/crm/mi-dia/PantallaMiDia'
import { PantallaAviso, BOTON_SECUNDARIO } from '@/components/crm/PantallaAviso'
import { exigirAcceso } from '@/lib/auth/sesion'
import { closerDeSesion, sesionActual } from '@/lib/crm/auth'
import { closers } from '@/lib/crm/config'

export const metadata: Metadata = { title: 'Ventas' }

/** "Mi día" del closer. El socio no tiene lista propia: va al tablero de administración. */
export default async function VentasPage() {
  const base = await exigirAcceso('ventas')
  const sesion = await sesionActual()
  if (sesion?.rol === 'admin') redirect('/ventas/admin')
  if (!sesion) {
    // Closer o setter sin pestaña asignada: no entra a ningún lead hasta que un socio la vincule (AUTH_VENTAS_PESTANAS)
    return (
      <PantallaAviso titulo="Tu cuenta todavía no tiene un CRM asignado" acciones={<Link href="/" className={BOTON_SECUNDARIO}>Volver</Link>}>
        <p>Iniciaste sesión como {base.nombre}, pero un socio todavía no te asignó una pestaña del CRM de ventas. Pedile que la vincule.</p>
      </PantallaAviso>
    )
  }
  // Con varias pestañas (p. ej. el pre-caller, que trabaja en todas) no hay "su" hoja: arranca en la primera y cambia
  // con el selector del encabezado; cada hoja se ve con el nombre de su closer.
  if (sesion.hojas.length > 1) {
    const primera = closers().find((c) => sesion.hojas.includes(c.hoja))
    if (primera) redirect(`/ventas/closer/${encodeURIComponent(primera.id)}`)
  }
  return <PantallaMiDia closer={closerDeSesion(sesion)} sesion={sesion} />
}
