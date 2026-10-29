import { cookies } from 'next/headers'
import { ArrastrarParaActualizar } from '@/components/shell/ArrastrarParaActualizar'
import { Aviso } from '@/components/shell/Aviso'
import { Latido } from '@/components/shell/Latido'
import { Navegacion } from '@/components/shell/Navegacion'
import { menuDe, type ItemNavegacion } from '@/components/shell/secciones'
import { COOKIE_NAV, anchoVisible, leerPreferencia } from '@/components/shell/preferenciaNav'
import { ETIQUETA_ROL, rutaInicial } from '@/lib/auth/roles'
import type { Sesion } from '@/lib/auth/sesion'
import '@/app/(shell)/cj.css'
import '@/app/(shell)/pantallas.css'
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
  const nav = leerPreferencia((await cookies()).get(COOKIE_NAV)?.value)
  // "Clientes" agrupa Cartera, Guiones, Edición, Anuncios y Referidos: aparece con una sola de ellas (components/shell/secciones.ts)
  const items = menuDe(sesion)
  const aparte = process.env.NODE_ENV !== 'production' && sesion.rol === 'socio' ? [SISTEMA] : []

  return (
    // lang="es" explícito aunque el <html> del layout raíz (app/layout.tsx) ya lo trae: no depende de que ese archivo no cambie
    <div className={`cj-raiz ${clasesFuentes}`} lang="es" data-nav={nav.chica ? 'chica' : 'abierta'} style={{ '--cj-ancho-lateral': `${anchoVisible(nav)}px` } as React.CSSProperties}>
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
      />
      <Latido />
      <Aviso />
      <ArrastrarParaActualizar />
      <main id="cj-contenido" className="cj-contenido">
        <div className="cj-pagina">{children}</div>
      </main>
    </div>
  )
}
