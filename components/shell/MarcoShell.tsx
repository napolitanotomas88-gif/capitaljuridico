import { cookies } from 'next/headers'
import { ArrastrarParaActualizar } from '@/components/shell/ArrastrarParaActualizar'
import { Aviso } from '@/components/shell/Aviso'
import { Entrada } from '@/components/shell/Entrada'
import { Latido } from '@/components/shell/Latido'
import { Navegacion } from '@/components/shell/Navegacion'
import { SincronizarNoche } from '@/components/shell/SincronizarNoche'
import { menuDe, type ItemNavegacion } from '@/components/shell/secciones'
import { COOKIE_NAV, anchoVisible, leerPreferencia } from '@/components/shell/preferenciaNav'
import { ETIQUETA_ROL, rutaInicial } from '@/lib/auth/roles'
import { leerPreferenciasSinDemora, resolverPreferencias } from '@/lib/finanzasSkwd/preferencias'
import { COOKIE_NOCHE } from '@/components/shell/preferenciaNav'
import type { Sesion } from '@/lib/auth/sesion'
import '@/app/(shell)/cj.css'
import '@/app/(shell)/pantallas.css'
import '@/components/shell/cristal.css'
import { clasesFuentes } from '@/app/(shell)/fuentes'

// Solo en desarrollo y para el rol socio: acceso directo a la página de revisión de marca
const SISTEMA: ItemNavegacion = { clave: 'sistema', etiqueta: 'Sistema', href: '/sistema' }

/**
 * El marco del dashboard unificado: barra lateral (o superior en móvil) con las secciones del rol, nombre y "Salir".
 * Lo usan el layout de app/(shell) y, sin duplicarlo, Finanzas y Anuncios (que viven fuera del grupo porque se abren
 * también solo con su contraseña: ver MarcoOpcional).
 */
export async function MarcoShell({ sesion, children }: { sesion: Sesion; children: React.ReactNode }) {
  // Barra lateral chica o abierta y su ancho (cookie de la persona): se dibuja bien desde el servidor, sin parpadeo
  const galletas = await cookies()
  const nav = leerPreferencia(galletas.get(COOKIE_NAV)?.value)
  // Cristal (2/11/2026, «todo el tema nuevo»): el mismo de Finanzas en todo el Despacho. Modo nocturno por defecto; lo que la
  // cuenta eligió (Neon, la misma tabla que Finanzas) manda sobre la cookie de este navegador, que queda como caché.
  // Con la cookie puesta no se espera a la base (velocidad, tanda 2): SincronizarNoche trae lo de la cuenta después y la
  // corrige si hace falta. Sin cookie (primera vez en este navegador) se espera, con un tope corto.
  const cookieNoche = galletas.get(COOKIE_NOCHE)?.value
  const conCookie = cookieNoche === '0' || cookieNoche === '1'
  const cuenta = sesion.esDePrueba || conCookie ? null : await leerPreferenciasSinDemora(sesion.email, 500)
  const { noche } = resolverPreferencias(cuenta, { noche: cookieNoche })
  // "Clientes" agrupa Cartera, Guiones, Edición, Anuncios y Referidos: aparece con una sola de ellas (components/shell/secciones.ts)
  const items = menuDe(sesion)
  const aparte = process.env.NODE_ENV !== 'production' && sesion.rol === 'socio' ? [SISTEMA] : []

  return (
    <>
    {/* Entrada animada del primer ingreso de la sesión: va ANTES de .cj-raiz, que es lo que se abre en círculo (Entrada.tsx) */}
    <Entrada />
    {/* lang="es" explícito aunque el <html> del layout raíz (app/layout.tsx) ya lo trae: no depende de que ese archivo no cambie */}
    <div className={`cj-raiz cj-cristal ${clasesFuentes}`} lang="es" data-noche={noche} data-nav={nav.chica ? 'chica' : 'abierta'} style={{ '--cj-ancho-lateral': `${anchoVisible(nav)}px` } as React.CSSProperties}>
      <div className="cj-cristal__fondo" aria-hidden="true">
        <span className="cj-cristal__manchas" />
        <span className="cj-cristal__logo" />
      </div>
      <a href="#cj-contenido" className="cj-saltar">
        Saltar al contenido
      </a>
      <Navegacion
        items={items}
        aparte={aparte}
        inicio={rutaInicial(sesion)}
        nombre={sesion.nombre}
        rol={ETIQUETA_ROL[sesion.rol]}
        esDePrueba={sesion.esDePrueba}
        preferencia={nav}
        verConectados
        noche={noche}
      />
      <Latido />
      {!sesion.esDePrueba && <SincronizarNoche noche={noche} />}
      <Aviso />
      <ArrastrarParaActualizar />
      <main id="cj-contenido" className="cj-contenido">
        <div className="cj-pagina">{children}</div>
      </main>
    </div>
    </>
  )
}
