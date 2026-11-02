import type { Metadata, Viewport } from 'next'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'
import { correoFinanzas } from '@/lib/finanzasSkwd/correoSesion'
import { leerPreferenciasSinDemora, resolverPreferencias } from '@/lib/finanzasSkwd/preferencias'
import { MarcoCristal } from '@/components/finanzas/cristal/MarcoCristal'
import { VIEWPORT_APP } from '@/components/shell/pwa'
import { clasesFuentes } from '@/app/(shell)/fuentes'

// Diseño de cristal de Finanzas (probado en /finanzas/prueba y lanzado el 1/11/2026: «lanzalo todo»). Ocupa toda la pantalla
// con su propia navegación: no va dentro del marco del Despacho (el diseño anterior, que sí, quedó en app/finanzas/(despacho)/
// clasico). El login también sigue en (despacho). Acceso: proxy.ts (/finanzas/*) y la verificación de acá y de cada página.
export const dynamic = 'force-dynamic'
export const viewport: Viewport = { ...VIEWPORT_APP, themeColor: '#03221c', colorScheme: 'dark' }
export const metadata: Metadata = { title: 'Finanzas', robots: { index: false, follow: false } }

// Celular: el panel abierto taparía el contenido, así que se entra con el riel. Se decide ya en el servidor (por el navegador
// que pide la página) para que la barra no se vea abierta un instante al cargar; NavCristal lo confirma con el ancho real.
const esCelular = (ua: string | null, movil: string | null) => movil === '?1' || /Mobi|Android|iPhone|iPod/i.test(ua ?? '')

export default async function FinanzasCristalLayout({ children }: { children: React.ReactNode }) {
  const galletas = await cookies()
  if (!tokenValido(galletas.get(COOKIE_FINANZAS)?.value) && !(await adminEnPagina())) redirect('/finanzas/login')
  // Modo nocturno por defecto; lo que cada cuenta eligió (Neon, cj_preferencias_usuario) manda sobre la cookie de este
  // navegador, que queda como caché (si la base tarda o falla, la página sale igual con la cookie).
  const cabeceras = await headers()
  const correo = await correoFinanzas(cabeceras, galletas.get(COOKIE_FINANZAS)?.value)
  const prefs = resolverPreferencias(await leerPreferenciasSinDemora(correo), {
    noche: galletas.get('fin_cristal_noche_v2')?.value, nav: galletas.get('fin_cristal_nav')?.value,
  })
  return (
    <main className={clasesFuentes} lang="es">
      <MarcoCristal abiertaInicial={prefs.nav === 'panel' && !esCelular(cabeceras.get('user-agent'), cabeceras.get('sec-ch-ua-mobile'))} nocheInicial={prefs.noche}>
        {children}
      </MarcoCristal>
    </main>
  )
}
