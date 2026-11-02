import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'
import { FinanzasDashboard } from '@/components/finanzas/FinanzasDashboard'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finanzas · prueba de cristal', robots: { index: false, follow: false } }

// Resumen de Finanzas con el diseño de cristal (prueba). Mismo componente y mismos datos que /finanzas.
export default async function FinanzasPruebaPage() {
  if (!tokenValido((await cookies()).get(COOKIE_FINANZAS)?.value) && !(await adminEnPagina())) redirect('/finanzas/login')
  return <FinanzasDashboard />
}
