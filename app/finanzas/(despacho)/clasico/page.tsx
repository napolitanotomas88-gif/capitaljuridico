import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'
import { FinanzasDashboard } from '@/components/finanzas/FinanzasDashboard'
import { BASE_CLASICO } from '@/components/finanzas/cristal/rutas'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finanzas · diseño clásico', robots: { index: false, follow: false } }

// Diseño anterior de Finanzas (hasta el 1/11/2026), guardado por si Tomás quiere volver: mismo componente y mismos datos
// que /finanzas, dentro del marco del Despacho. Protegida por proxy.ts y verificada acá otra vez.
export default async function FinanzasClasicoPage() {
  if (!tokenValido((await cookies()).get(COOKIE_FINANZAS)?.value) && !(await adminEnPagina())) redirect('/finanzas/login')
  return <FinanzasDashboard base={BASE_CLASICO} />
}
