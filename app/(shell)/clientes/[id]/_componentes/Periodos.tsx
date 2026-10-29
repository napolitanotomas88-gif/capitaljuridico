import { Etiqueta, Vacio } from '@/components/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Monto } from '@/components/clientes/Monto'
import { partirMontos, type FichaCliente, type PeriodoFicha } from '@/lib/clientes/ficha'
import { fechaCorta, mesesTexto, usd } from '@/lib/clientes/formato'
import { SeccionFicha } from './SeccionFicha'

// Línea de tiempo de períodos (pestaña Renovaciones): inicial, renovaciones y extensiones de servicio.
// Los montos van con <Monto> (también los escritos en las notas): el botón "Ocultar montos" los tapa en pantalla.
function detalle(p: PeriodoFicha): ReactNode[] {
  const partes: ReactNode[] = []
  if (p.precio === null) partes.push('Precio sin cargar')
  else if (p.precio === 0) partes.push('Sin cargo')
  else partes.push(<Monto key="precio">{usd(p.precio)}</Monto>)
  if (p.meses !== null) partes.push(mesesTexto(p.meses))
  if (p.notas) partes.push(<span key="notas">{partirMontos(p.notas).map((x, i) => (x.monto ? <Monto key={i}>{x.texto}</Monto> : x.texto))}</span>)
  return partes.flatMap((x, i) => (i ? [' · ', x] : [x]))
}

export function Periodos({ f, accionHref }: { f: FichaCliente; accionHref?: string }) {
  return (
    <SeccionFicha etiqueta="Períodos" titulo="Línea de tiempo del servicio">
      {f.periodos.length === 0 ? (
        <Vacio frase="Este cliente no tiene períodos cargados en la pestaña Renovaciones. Falta, al menos, el período inicial (0)." />
      ) : (
        <ol className="cj-linea" aria-label="Períodos del cliente">
          {f.periodos.map(p => (
            <li key={`${p.numero}-${p.titulo}`} aria-current={p.actual ? 'step' : undefined}>
              <Etiqueta tono={p.actual ? 'laton' : 'humo'}>
                {p.titulo}
                {p.actual ? ' · período actual' : ''}
              </Etiqueta>
              <p className="cj-linea__fechas cj-num">
                {fechaCorta(p.dia1)} al {fechaCorta(p.fin)}
              </p>
              <p className="cj-linea__detalle">{detalle(p)}</p>
            </li>
          ))}
        </ol>
      )}
      {accionHref && <p><Link className="cj-enlace" href={accionHref}>Registrar renovación</Link></p>}
    </SeccionFicha>
  )
}
