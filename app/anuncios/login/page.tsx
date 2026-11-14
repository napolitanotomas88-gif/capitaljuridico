import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_ANUNCIOS, claveConfigurada, sesionValida } from '@/lib/anuncios/auth'
import { adminEnPagina } from '@/lib/auth/llaveAdminPagina'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Anuncios de clientes — acceso', robots: { index: false, follow: false } }

const MENSAJES: Record<string, string> = {
  '1': 'Clave incorrecta.',
  intentos: 'Demasiados intentos fallidos. Probá de nuevo en 15 minutos.',
  config: 'Falta configurar la clave del tablero (ANUNCIOS_PASSWORD) en el servidor. Hasta que se cargue, el tablero queda bloqueado.',
}

export default async function LoginAnuncios({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const configurada = !!claveConfigurada()
  if ((configurada && sesionValida((await cookies()).get(COOKIE_ANUNCIOS)?.value)) || (await adminEnPagina())) redirect('/anuncios')
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const mensaje = !configurada ? MENSAJES.config : error ? (Object.hasOwn(MENSAJES, error) ? MENSAJES[error] : MENSAJES['1']) : null

  return (
    <div className="flex items-center justify-center px-4 py-16 anu-login" style={{ minHeight: '100vh' }}>
      <div className="w-full" style={{ maxWidth: 380 }}>
        <p className="etq-laton">Capital Jurídico</p>
        <h1 className="serif mt-3" style={{ fontSize: 44, lineHeight: 1.05 }}>Anuncios de clientes</h1>
        <div style={{ height: 24 }} />
        {mensaje && (
          <p className="mb-6 anu-aviso" style={{ fontSize: 15 }}>{mensaje}</p>
        )}
        {configurada && (
          <form method="post" action="/api/anuncios/login" className="flex flex-col gap-3">
            <label className="etq" htmlFor="clave">Clave</label>
            <input id="clave" name="clave" type="password" required autoFocus autoComplete="current-password" className="buscar" style={{ fontSize: 17 }} />
            <button
              type="submit" className="mt-6 boton boton--primario"
            >
              Entrar
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
