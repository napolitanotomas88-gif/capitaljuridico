import type { Metadata } from 'next'
import { SeccionTitulo } from '@/components/ui'
import { exigirCorreos } from '@/lib/auth/sesion'
import { baseEowConfigurada, historialSemana, leerReporte, listarSemanas, type EntradaHistorial } from '@/lib/eow/db'
import { esFecha, type ReporteEow } from '@/lib/eow/modelo'
import { leerCartera } from '@/lib/eow/cartera'
import { EditorEow } from './EditorEow'
import './eow.css'

export const metadata: Metadata = { title: 'EOW' }
export const dynamic = 'force-dynamic'

// Reporte EOW (End of Week, 13/11/2026): el semáforo semanal de clientes que antes era el documento de Gero M.
// Solo los mails de EOW_CORREOS (lib/auth/correos.ts): Tomás, la cuenta Empresa y Gero M. Ningún rol lo abre.
// Datos en Neon (cj_eow_reportes, lib/eow/db.ts); el guardado va por /api/eow con control de versión.
export default async function PaginaEow({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  await exigirCorreos('eow')
  const q = await searchParams
  if (!baseEowConfigurada()) {
    return (
      <div className="cj-pila cj-pila--chica">
        <SeccionTitulo etiqueta="EOW" titulo="Reporte EOW" />
        <p className="eow-error" role="alert">Falta conectar la base (DATABASE_URL).</p>
      </div>
    )
  }
  let semanas: string[] = []
  let reporte: ReporteEow | null = null
  let historial: EntradaHistorial[] = []
  let error = ''
  // Estado de la Cartera (solo lectura): en paralelo con el reporte; si el CRM no responde, el EOW sale sin esa columna
  const lecturaCartera = leerCartera()
  try {
    semanas = await listarSemanas()
    const semana = q.semana && esFecha(q.semana) && semanas.includes(q.semana) ? q.semana : semanas[0]
    reporte = semana ? await leerReporte(semana) : null
    historial = reporte ? await historialSemana(reporte.semana) : []
  } catch {
    error = 'No se pudo leer el EOW. Recargá en un minuto.'
  }
  if (error) {
    return (
      <div className="cj-pila cj-pila--chica">
        <SeccionTitulo etiqueta="EOW" titulo="Reporte EOW" />
        <p className="eow-error" role="alert">{error}</p>
      </div>
    )
  }
  const cartera = await lecturaCartera
  return <EditorEow key={`${reporte?.semana ?? 'nada'}-${reporte?.version ?? 0}`} semanas={semanas} inicial={reporte} historial={historial} cartera={cartera} />
}
