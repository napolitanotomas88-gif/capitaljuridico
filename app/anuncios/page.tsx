import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_ANUNCIOS, claveConfigurada, sesionValida } from '@/lib/anuncios/auth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'
import { TableroAnuncios } from '@/components/anuncios/TableroAnuncios'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Anuncios de clientes', robots: { index: false, follow: false } }

// Tablero de anuncios de Meta de los clientes (Tomás + media buyer). Protegido con su propia clave.
export default async function AnunciosPage() {
  // Administrador con sesión de Google: sin clave (lib/auth/llaveAdmin.ts). El resto, con la cookie de Anuncios como siempre.
  if ((!claveConfigurada() || !sesionValida((await cookies()).get(COOKIE_ANUNCIOS)?.value)) && !(await adminEnPagina())) redirect('/anuncios/login')
  return <TableroAnuncios />
}
