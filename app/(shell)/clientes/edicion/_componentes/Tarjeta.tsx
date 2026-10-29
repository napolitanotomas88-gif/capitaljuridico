import Link from 'next/link'
import { ETIQUETA_PRIORIDAD, type TarjetaVideo } from '@/lib/edicion/vista'
import { conSufijo } from './enlaces'
import { PaletaChica } from './Paleta'

// La tarjeta de un video en el tablero y en las colas: cliente e id, clave y gancho, prioridad, bloqueo, paleta, cuánto
// lleva en el estado (bordó si está trabado), rondas y "editado propuesto". La tarjeta entera es el enlace al video.
export function Tarjeta({ t, sufijo, mostrarEstado = false }: { t: TarjetaVideo; sufijo: string; mostrarEstado?: boolean }) {
  const alerta = !!t.bloqueo || t.tiempo.trabado
  return (
    <li className={alerta ? 'ed-tarjeta ed-tarjeta--alerta' : 'ed-tarjeta'}>
      <Link href={conSufijo(t.href, sufijo)} className="ed-tarjeta__enlace">
        <span className="ed-tarjeta__cab">
          <span className="ed-tarjeta__cliente">{t.cliente} · {t.id_crm}</span>
          {t.prioridad !== 'normal' && <span className={t.prioridad === 'urgente' ? 'ed-marca ed-marca--alerta' : 'ed-marca ed-marca--laton'}>{ETIQUETA_PRIORIDAD[t.prioridad]}</span>}
        </span>
        <span className="ed-tarjeta__titulo">
          <span className="ed-tarjeta__clave">{t.clave}</span>
          <span className="ed-tarjeta__gancho">{t.gancho || 'Sin gancho cargado'}</span>
        </span>
        <span className="ed-tarjeta__pie">
          {mostrarEstado && <span>{t.etiquetaEstado}</span>}
          <span className={t.tiempo.trabado ? 'ed-marca ed-marca--alerta' : undefined} title={t.tiempo.detalle || undefined}>
            {t.tiempo.trabado ? `Trabado · ${t.tiempo.texto}` : t.tiempo.texto}
          </span>
          {t.rondas && <span className={t.rondas.tope ? 'ed-marca ed-marca--laton' : undefined}>{t.rondas.texto}</span>}
          {t.notasAbiertas > 0 && <span>{t.notasAbiertas} nota{t.notasAbiertas === 1 ? '' : 's'} sin tildar</span>}
          <PaletaChica colores={t.paleta} />
        </span>
        {(t.bloqueo || t.editadoPropuesto || t.posibleDuplicado.length > 0) && (
          <span className="ed-tarjeta__marcas">
            {t.bloqueo && <span className="ed-marca ed-marca--alerta">{t.bloqueo.texto}</span>}
            {t.editadoPropuesto && <span className="ed-marca ed-marca--ok">Editado propuesto</span>}
            {t.posibleDuplicado.length > 0 && <span className="ed-marca ed-marca--laton">¿Duplicado de {t.posibleDuplicado.join(', ')}?</span>}
          </span>
        )}
      </Link>
    </li>
  )
}
