import { redirect } from 'next/navigation'

// Backend se retiró el 10/10/2026 (pedido de Tomás): los cobros pendientes pasaron a Cobro de cuotas (/cuotas) y las
// renovaciones y llamadas de proyección se marcan en Clientes. Respaldo del código en un respaldo local privado.
export default function PaginaBackend() {
  redirect('/clientes?renovacion=1')
}
