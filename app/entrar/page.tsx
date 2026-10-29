import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import { METADATA_APP, VIEWPORT_APP } from '@/components/shell/pwa'
import { Wordmark } from '@/components/shell/Wordmark'
import { SeccionTitulo } from '@/components/ui'
import { rutaInternaSegura } from '@/lib/auth/destino'
import { esCodigoError, type CodigoError } from '@/lib/auth/errores'
import { leerConfig } from '@/lib/auth/google'
import { rutaInicial } from '@/lib/auth/roles'
import { obtenerSesion } from '@/lib/auth/sesion'
import '../(shell)/cj.css'
import { clasesFuentes } from '../(shell)/fuentes'

// Acá aterriza el shell cuando no hay sesión. Vive FUERA de app/(shell) a propósito: si estuviera adentro,
// el layout del shell lo redirigiría a sí mismo en loop. Comparte marca (cj.css y fuentes) con el shell.
// Una sola idea: entrar con la cuenta de Google. Si falta configurar el acceso, lo dice (y no abre nada).

export const metadata: Metadata = {
  title: 'Entrar · Despacho',
  robots: { index: false, follow: false },
  // Ícono y título de iOS también acá: es la primera pantalla de quien instala la app desde "Agregar a inicio"
  ...METADATA_APP,
}

// Fondo TINTA también en la barra del navegador del celular (igual que el shell): es la primera pantalla que ve cada persona
// y viewport-fit=cover (como el resto de la app instalable): cj.css respeta la muesca con env(safe-area-inset-*)
export const viewport: Viewport = VIEWPORT_APP

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

// Un mensaje por código de error (los códigos son fijos: ver lib/auth/errores.ts)
const MENSAJES: Record<CodigoError, string> = {
  cuenta_no_autorizada: 'Esa cuenta de Google no tiene acceso al dashboard. Pedile a un socio que la agregue o entrá con otra cuenta.',
  intento_vencido: 'El intento de ingreso venció o ya se usó. Tocá "Entrar con Google" para empezar de nuevo.',
  google_rechazo: 'Google no confirmó tu identidad. Probá de nuevo o elegí otra cuenta.',
  configuracion: 'Falta terminar de configurar el acceso. Avisale a quien administra el dashboard.',
  sin_secciones: 'Tu cuenta no tiene ninguna sección habilitada. Pedile a un administrador que te asigne al menos una.',
  error: 'No pudimos completar el ingreso. Probá de nuevo y, si sigue pasando, avisale a quien administra el dashboard.',
}

export default async function EntrarPage({ searchParams }: Props) {
  const sesion = await obtenerSesion()
  if (sesion) {
    const destino = rutaInicial(sesion)
    // Sin ninguna sección no hay a dónde mandarla: se muestra el aviso en vez de redirigir en bucle
    if (!destino.startsWith('/entrar')) redirect(destino)
  }

  const params = await searchParams
  const codigo = primero(params.error)
  const mensaje = esCodigoError(codigo) ? MENSAJES[codigo] : null
  const next = rutaInternaSegura(primero(params.next))
  const enDesarrollo = process.env.NODE_ENV !== 'production'
  const config = leerConfig()

  // Sin configuración completa el login no se ofrece: falla cerrado
  if (!config.ok) {
    return (
      <div className={`cj-raiz ${clasesFuentes}`} lang="es">
        <main className="cj-entrar">
          <div className="cj-entrar__cuerpo">
            <Wordmark href={null} fondo="claro" />
            <SeccionTitulo etiqueta="Despacho" titulo="Acceso no configurado" />
            <p>Todavía falta terminar de configurar el acceso con Google, así que por ahora nadie puede entrar. Avisale a quien administra el dashboard.</p>
            {enDesarrollo && (
              <p className="cj-texto-2">
                En desarrollo: falta o está mal {config.faltan.join(', ')}. Para probar sin Google, definí CRM_DEV_ROL con socio, closer, csm o setter en
                el .env.local y reiniciá el servidor.
              </p>
            )}
          </div>
        </main>
      </div>
    )
  }

  const destino = `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`
  return (
    <div className={`cj-raiz ${clasesFuentes}`} lang="es">
      <main className="cj-entrar">
        <div className="cj-entrar__cuerpo">
          <Wordmark href={null} fondo="claro" />
          <SeccionTitulo etiqueta="Despacho · Capital Jurídico" titulo="Entrá con tu cuenta de Google" />
          {mensaje && (
            <p className="cj-aviso" role="alert">
              {mensaje}
            </p>
          )}
          {/* Enlace común y no next/link: next/link lo precargaría y la ruta dispararía un login sin que nadie lo pida */}
          <div>
            <a className="cj-boton cj-boton--primario" href={destino}>
              Entrar con Google
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}
