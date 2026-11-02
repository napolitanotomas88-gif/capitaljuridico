import Image from 'next/image'
import { cookies } from 'next/headers'
import { Icono } from '@/components/shell/iconos'
import { COOKIE_NOCHE } from '@/components/shell/preferenciaNav'
import { resolverPreferencias } from '@/lib/finanzasSkwd/preferencias'
import type { Sesion } from '@/lib/auth/sesion'
import '@/app/(shell)/cj.css'
import '@/app/(shell)/pantallas.css'
import '@/components/shell/cristal.css'
import { clasesFuentes } from '@/app/(shell)/fuentes'

/**
 * Marco del PORTAL DEL CLIENTE (2/11/2026, lib/auth/portal.ts). El cliente no ve el menú del Despacho, ni quién está conectado,
 * ni notificaciones: solo la marca, su página y «Salir». Mismo cristal que el resto (nocturno por defecto; si este navegador ya
 * eligió otro modo, se respeta la cookie). No llama a ninguna API: toda /api le da 403.
 */
export async function MarcoPortal({ sesion, children }: { sesion: Sesion; children: React.ReactNode }) {
  const { noche } = resolverPreferencias(null, { noche: (await cookies()).get(COOKIE_NOCHE)?.value })
  return (
    <div className={`cj-raiz cj-cristal ${clasesFuentes}`} lang="es" data-noche={noche} data-portal="cliente" style={{ flexDirection: 'column', '--cj-ancho-lateral': '0px' } as React.CSSProperties}>
      <div className="cj-cristal__fondo" aria-hidden="true">
        <span className="cj-cristal__manchas" />
        <span className="cj-cristal__logo" />
        <span className="cj-cristal__grano" />
      </div>
      <a href="#cj-contenido" className="cj-saltar">
        Saltar al contenido
      </a>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px clamp(16px, 5vw, 80px) 0', position: 'relative' }}>
        <span className="cj-marca" style={{ minHeight: 0 }}>
          <Image src="/marca/logo-claro.svg" alt="Capital Jurídico" width={927} height={447} unoptimized priority className="cj-logo" style={{ width: 132 }} />
        </span>
        {!sesion.esDePrueba && (
          <form method="post" action="/api/auth/salir">
            <button type="submit" className="cj-boton cj-boton--secundario">
              <Icono nombre="salir" />
              <span>Salir</span>
            </button>
          </form>
        )}
      </header>
      <main id="cj-contenido" className="cj-contenido" style={{ position: 'relative', paddingInline: 'clamp(16px, 5vw, 80px)' }}>
        <div className="cj-pagina">{children}</div>
      </main>
    </div>
  )
}
