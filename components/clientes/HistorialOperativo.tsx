import { baseAccionesConfigurada, listarAcciones } from '@/lib/clientes/acciones/registro'
import { historialOperativo, inicioPausaVigente } from '@/lib/clientes/historialOperativo'
import { accionesDemoHistorial } from '@/lib/clientes/historialOperativoDemo'
import { diasEntre } from '@/lib/clientes/fechas'
import { fechaCorta, numeroAR } from '@/lib/clientes/formato'
import type { EstadoCliente, Periodo } from '@/lib/clientes/tipos'
import { Monto } from './Monto'
import './historialOperativo.css'

const LIMITE = 500
interface Props { idCrm: string; periodos: Periodo[]; estado: EstadoCliente; fin: string | null; hoy: string; conFinanzas: boolean; demo?: boolean; nivel?: 2 | 3 }

/** Componente de servidor compartido: router.refresh después de pausar/retomar vuelve a leer las acciones confirmadas. */
export async function HistorialOperativo({ idCrm, periodos, estado, fin, hoy, conFinanzas, demo = false, nivel = 3 }: Props) {
  let acciones: Awaited<ReturnType<typeof listarAcciones>> = []
  let aviso: string | null = null
  if (demo) acciones = accionesDemoHistorial(hoy, fin)
  else {
    if (!baseAccionesConfigurada()) aviso = 'No se pudo leer el registro del Despacho. Se muestran los períodos del CRM.'
    else try { acciones = await listarAcciones(idCrm, LIMITE) } catch { aviso = 'No se pudo leer el registro del Despacho. Se muestran los períodos del CRM; las acciones anteriores siguen guardadas.' }
  }
  const eventos = historialOperativo(acciones, periodos, conFinanzas)
  const inicioPausa = inicioPausaVigente(acciones)
  const Titulo = nivel === 2 ? 'h2' : 'h3'
  return (
    <section className="hc" aria-label="Historial de servicio y movimientos">
      <div className="hc-cabecera">
        <Titulo className="hc-titulo">Historial de servicio y movimientos</Titulo>
        <p className="cj-texto-2">Cada renovación, extensión, pausa y regreso se agrega acá. El recorrido anterior se conserva.</p>
      </div>
      {demo && <p className="cj-texto-2">Historial de ejemplo: pausa y retoma sin guardar datos.</p>}
      {estado === 'PAUSADO' ? <p className="hc-estado" role="status">Servicio en pausa{inicioPausa ? ` desde el ${fechaCorta(inicioPausa)} · ${Math.max(0, diasEntre(inicioPausa, hoy))} días hasta hoy` : ' · falta registrar la fecha de inicio'}. Al retomar se mostrará el tiempo compensado.</p> : <p className="hc-estado">{estado === 'ACTIVO' ? 'Servicio activo' : estado === 'FINALIZADO' ? 'Servicio finalizado' : estado === 'INACTIVO' ? 'Cliente inactivo' : 'Estado sin registrar'}{fin ? ` · fin actual: ${fechaCorta(fin)}` : ''}</p>}
      {aviso && <p className="cj-aviso" role="status">{aviso}</p>}
      {acciones.length === LIMITE && <p className="cj-texto-2">Se muestran las últimas {LIMITE} acciones del Despacho y los períodos del CRM. El historial anterior se conserva.</p>}
      {!eventos.length ? <p className="cj-texto-2">Todavía no hay movimientos con evidencia registrada.</p> : <ol className="hc-lista">
        {eventos.map(e => <li key={e.id} className={`hc-evento${e.anulada ? ' hc-evento--anulado' : ''}`}>
          <span className="hc-punto" aria-hidden />
          <div className="hc-linea"><strong>{e.titulo}</strong>{e.anulada && <span className="hc-etiqueta">Deshecha</span>}{e.prueba && <span className="hc-etiqueta">Prueba</span>}</div>
          <p className="hc-fecha">{e.fecha ? <time dateTime={e.fecha}>{fechaCorta(e.fecha)}</time> : 'Fecha no registrada'} · {e.fuente}{e.quien ? ` · ${e.quien}` : ''}</p>
          {e.detalle && <p className="hc-detalle">{e.detalle}</p>}
          {e.monto !== null && <p className="hc-monto">USD <Monto>{numeroAR(e.monto)}</Monto></p>}
        </li>)}
      </ol>}
    </section>
  )
}
