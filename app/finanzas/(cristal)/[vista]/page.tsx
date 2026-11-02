import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'
import { FinanzasSkwd } from '@/components/finanzas/skwd/FinanzasSkwd'
import { esVistaSkwd } from '@/components/finanzas/skwd/vistas'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finanzas', robots: { index: false, follow: false } }

// Pantallas de Finanzas SKWD con el diseño de cristal. Mismo acceso que /finanzas: protegida por proxy.ts y verificada acá otra vez.
export default async function FinanzasVistaPage({ params }: { params: Promise<{ vista: string }> }) {
  const { vista } = await params
  if (!esVistaSkwd(vista)) notFound()
  if (!tokenValido((await cookies()).get(COOKIE_FINANZAS)?.value) && !(await adminEnPagina())) redirect('/finanzas/login')
  return (
    <Suspense>
      <FinanzasSkwd vista={vista} />
    </Suspense>
  )
}
