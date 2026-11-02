import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'
import { MarcoCristal } from '@/components/finanzas/cristal/MarcoCristal'
import { VIEWPORT_APP } from '@/components/shell/pwa'
import { clasesFuentes } from '@/app/(shell)/fuentes'

// PRUEBA del diseño de cristal de Finanzas (1/11/2026). Vive aparte de /finanzas (que sigue igual, en app/finanzas/(despacho))
// porque ocupa toda la pantalla con su propia navegación: no va dentro del marco del Despacho. Mismo acceso que /finanzas:
// proxy.ts (/finanzas/*) y la verificación de acá y de cada página.
export const dynamic = 'force-dynamic'
export const viewport: Viewport = { ...VIEWPORT_APP, themeColor: '#03221c', colorScheme: 'dark' }
export const metadata: Metadata = { title: 'Finanzas · prueba de cristal', robots: { index: false, follow: false } }

export default async function FinanzasPruebaLayout({ children }: { children: React.ReactNode }) {
  const galletas = await cookies()
  if (!tokenValido(galletas.get(COOKIE_FINANZAS)?.value) && !(await adminEnPagina())) redirect('/finanzas/login')
  return (
    <main className={clasesFuentes} lang="es">
      <MarcoCristal abiertaInicial={galletas.get('fin_cristal_nav')?.value !== 'riel'} nocheInicial={galletas.get('fin_cristal_noche')?.value === '1'}>
        {children}
      </MarcoCristal>
    </main>
  )
}
