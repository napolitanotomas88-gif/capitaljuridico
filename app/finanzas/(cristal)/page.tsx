import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'
import { FinanzasDashboard } from '@/components/finanzas/FinanzasDashboard'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finanzas', robots: { index: false, follow: false } }

// Resumen de Finanzas con el diseño de cristal. Protegida por proxy.ts; se vuelve a verificar acá por si cambia el matcher.
export default async function FinanzasPage() {
  // Administrador con sesión de Google: sin contraseña (lib/auth/llaveAdmin.ts). El resto, con la cookie de Finanzas como siempre.
  if (!tokenValido((await cookies()).get(COOKIE_FINANZAS)?.value) && !(await adminEnPagina())) redirect('/finanzas/login')
  return <FinanzasDashboard />
}
