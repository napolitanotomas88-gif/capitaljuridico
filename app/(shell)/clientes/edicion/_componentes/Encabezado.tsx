import Link from 'next/link'
import { SeccionTitulo } from '@/components/ui'
import { NOMBRE_PESTANA, NOMBRE_ROL, RUTA_PESTANA, type Pestana } from '@/lib/edicion/permisos'
import type { RolEdicion } from '@/lib/edicion/tipos'
import type { VistaVigia } from '@/lib/edicion/vista'
import { BannerModo } from './BannerModo'
import { conSufijo } from './enlaces'
import { UltimoVigia } from './UltimoVigia'

// La cabecera común de /clientes/edicion: título, último vigía, con qué rol se entró, el cartel del modo prueba y las pestañas
// que le tocan al rol (René: su cola y el tablero; Aylu y Tomás: todas). En el ejemplo, "Probar como" cambia el rol.
const ROLES_DEMO: RolEdicion[] = ['aylu', 'rene', 'tomas', 'lector']

type Props = {
  etiqueta: string; titulo: string; vigia: VistaVigia | null; modo: 'dry' | 'real'; demo: boolean
  rol: RolEdicion; pestanas: Pestana[]; actual: Pestana | 'tarjetas' | null; sufijo: string
  contadores?: Partial<Record<Pestana, number>>
  volver?: { href: string; texto: string }
  /** La ruta de esta página sin el modo de ejemplo (para "Probar como"). */
  rutaActual: string
  avisoRol?: string | null
}

export function Encabezado({ etiqueta, titulo, vigia, modo, demo, rol, pestanas, actual, sufijo, contadores = {}, volver, rutaActual, avisoRol }: Props) {
  const visibles: (Pestana | 'tarjetas')[] = ['tarjetas', ...pestanas]
  return (
    <div className="ed-cabecera">
      {volver && <Link href={conSufijo(volver.href, sufijo)} className="cj-enlace" style={{ alignSelf: 'flex-start' }}>{volver.texto}</Link>}
      <SeccionTitulo etiqueta={etiqueta} titulo={titulo} />
      <p className="ed-barra">
        {vigia && <UltimoVigia v={vigia} />}
        <span className="ed-sub">Entraste como <strong>{NOMBRE_ROL[rol]}</strong></span>
      </p>
      {avisoRol && <p className="ed-sub" role="note">{avisoRol}</p>}
      <BannerModo modo={modo} demo={demo} />
      {demo && (
        <nav className="ed-probar" aria-label="Probar la pantalla como">
          <span className="cj-etiqueta">Probar como</span>
          {ROLES_DEMO.map(r => (
            <Link key={r} href={conSufijo(rutaActual, `demo=1&como=${r}`)} className="cj-chip ed-probar__rol" aria-current={r === rol ? 'true' : undefined}>{NOMBRE_ROL[r]}</Link>
          ))}
        </nav>
      )}
      {visibles.length > 1 && (
        <nav className="ed-pestanas" aria-label="Secciones de Edición">
          <ul>
            {visibles.map(p => (
              <li key={p}>
                <Link href={conSufijo(p === 'tarjetas' ? '/clientes/edicion?vista=tarjetas' : p === 'cola' ? '/clientes/edicion?vista=cola' : RUTA_PESTANA[p], sufijo)} className="ed-pestana" aria-current={p === actual ? 'page' : undefined}>
                  {p === 'tarjetas' ? 'Tarjetas' : NOMBRE_PESTANA[p]}
                  {p !== 'tarjetas' && contadores[p] !== undefined && <span className="ed-contador">{contadores[p]}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
