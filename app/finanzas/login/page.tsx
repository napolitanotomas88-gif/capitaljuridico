import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { FormularioClave } from '@/components/finanzas/FormularioClave'
import { COOKIE_FINANZAS, passwordConfigurada, tokenValido } from '@/lib/finanzasAuth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finanzas — contraseña', robots: { index: false, follow: false } }

const MENSAJES: Record<string, string> = {
  '1': 'Contraseña incorrecta.',
  intentos: 'Demasiados intentos fallidos. Probá de nuevo en 15 minutos.',
  config: 'El acceso a Finanzas está bloqueado: falta configurar FINANZAS_PASSWORD en el servidor.',
}

// Pantalla de la contraseña de Finanzas (pública, como antes; la cuenta de Google no la reemplaza). Verde, y con el marco del
// dashboard alrededor si hay sesión de Google (lo pone app/finanzas/layout.tsx).
export default async function LoginFinanzas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const configurada = !!passwordConfigurada()
  if ((configurada && tokenValido((await cookies()).get(COOKIE_FINANZAS)?.value)) || (await adminEnPagina())) redirect('/finanzas')
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const mensaje = !configurada ? MENSAJES.config : error ? (Object.hasOwn(MENSAJES, error) ? MENSAJES[error] : MENSAJES['1']) : null
  return <FormularioClave mensaje={mensaje} configurada={configurada} />
}
