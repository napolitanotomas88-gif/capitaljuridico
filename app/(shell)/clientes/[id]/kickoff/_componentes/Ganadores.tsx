import { Tabla, type Columna } from '@/components/ui'
import type { GanadorVista, VistaKickoff } from '@/lib/bot/kickoff/vista'
import { SeccionFicha } from '../../_componentes/SeccionFicha'

// Ganadores de la misma rama en Meta (anuncios de OTROS clientes, 180 días, por costo por mensaje): referencia interna para
// Tomi y Gero M, nunca para el cliente. Sin el nombre del otro cliente, su cuenta ni el copy (vista.ts no los deja pasar).
// La tabla va CERRADA (<details>): si en un seguimiento se comparte pantalla con el cliente, el costo por mensaje de otros
// clientes no queda a la vista. El estado va con texto ('Listos', 'Pocos datos (menos de 3)'), nunca la clave cruda.
const usd = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const COLUMNAS: Columna<GanadorVista>[] = [
  { clave: 'id', titulo: 'Id' },
  { clave: 'anuncio', titulo: 'Anuncio (gancho)', largo: true },
  { clave: 'subtema', titulo: 'Subtema', largo: true },
  { clave: 'pais', titulo: 'País', celda: g => g.pais ?? 'sin dato' },
  { clave: 'cpl', titulo: 'USD por mensaje', numerica: true, celda: g => usd(g.cplUSD) },
  { clave: 'mensajes', titulo: 'Mensajes', numerica: true, celda: g => g.mensajes.toLocaleString('es-AR') },
  { clave: 'gasto', titulo: 'Gasto USD', numerica: true, celda: g => usd(g.gastoUSD, 0) },
  { clave: 'ideas', titulo: 'Lo usan las ideas', celda: g => (g.ideas.length ? g.ideas.join(', ') : '—') },
]

export function Ganadores({ g }: { g: VistaKickoff['ganadores'] }) {
  return (
    <SeccionFicha etiqueta="Referencia interna" titulo="Ganadores de la rama en Meta">
      <details className="cj-detalles ko-ganadores">
        <summary className="cj-etiqueta">
          {`Ganadores de la rama en Meta (referencia interna: no mostrar al cliente) · ${g.estadoTexto}${g.lista.length ? ` · ${g.lista.length}` : ''}`}
        </summary>
        <p className="ko-nota" role="note">Son anuncios de otros clientes: sirven para idear. No se comparten con el cliente.</p>
        <p className="ko-sub">
          {g.nota || `Estado: ${g.estadoTexto}`}
          {g.ventana ? ` · ${g.ventana}` : ''}
        </p>
        <Tabla descripcion="Ganadores de la rama en Meta" columnas={COLUMNAS} filas={g.lista} claveFila={x => x.id}
          vacio={<p className="ko-vacio">No hay ganadores para esta ficha.</p>} />
      </details>
    </SeccionFicha>
  )
}
