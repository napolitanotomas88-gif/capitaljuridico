import type { Indicadores } from '@/lib/clientes/indicadores'
import { Etiqueta } from '@/components/ui'

// Qué le falta a la planilla para que las cifras sean confiables. Plegado por defecto: es para quien carga datos.
export function CalidadDatos({ calidad, noClientes, avisos }: { calidad: Indicadores['calidad']; noClientes: number; avisos: string[] }) {
  const items: string[] = []
  if (calidad.sinId) items.push(`${calidad.sinId} fila(s) sin ID: no cuentan en las métricas y no tienen ficha. Hay que completarles el ID y las fórmulas en la planilla.`)
  if (calidad.activosSinFin) items.push(`${calidad.activosSinFin} cliente(s) activos o pausados sin fecha de fin de período (los activos aparecen con semáforo gris).`)
  if (calidad.sinPeriodos) items.push(`${calidad.sinPeriodos} cliente(s) activos o pausados sin ningún período en la pestaña Renovaciones: sus fichas no muestran la línea de tiempo.`)
  if (calidad.sinLtv) items.push(`${calidad.sinLtv} cliente(s) de Agencia sin LTV cargado (contratado ni cobrado).`)
  if (noClientes) items.push(`${noClientes} fila(s) de Agencia finalizadas o inactivas con menos de USD 400 cobrados: no cuentan como clientes y se ocultan de la lista.`)
  for (const a of avisos) items.push(a)
  return (
    <details className="cj-detalles">
      <summary>
        <Etiqueta tono="laton">Calidad de los datos{items.length ? ` (${items.length})` : ''}</Etiqueta>
      </summary>
      {items.length === 0 ? (
        <p className="cj-parrafo cj-texto-2">No hay nada para corregir en la planilla.</p>
      ) : (
        <ul className="cj-lista">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </details>
  )
}
