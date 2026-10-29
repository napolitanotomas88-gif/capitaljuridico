import type { Metadata } from 'next'
import { BotonEnlace, SeccionTitulo, Vacio } from '@/components/ui'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { listarVinculos } from '@/lib/edicion/operativo'
import { pestanasDe, puedePestana } from '@/lib/edicion/permisos'
import type { CarpetaGrabacion } from '@/lib/edicion/tipos'
import { armarVinculos } from '@/lib/edicion/vista'
import { BotonAccion } from '../_componentes/BotonAccion'
import { contextoEdicion, logLectura, type BusquedaPagina } from '../_componentes/contexto'
import { Encabezado } from '../_componentes/Encabezado'
import { conSufijo } from '../_componentes/enlaces'
import { VinculoManual } from '../_componentes/VinculoManual'
import '../edicion.css'

// Vínculos carpeta ↔ cliente: los clientes viejos se vinculan una sola vez. El bot propone por nombre (con puntaje) y Aylu
// o Tomás confirman; mientras una carpeta está «a confirmar» el vigía la lista pero no arma tandas, videos ni seguimiento
// con ella (así un cliente equivocado no recibe avisos). Los clientes nuevos llegan vinculados desde el alta. Cada
// confirmación se pregunta antes, y las ya vinculadas se pueden corregir acá (las del bot primero, para revisar).
export const metadata: Metadata = { title: 'Vínculos de carpetas' }

export default async function VinculosPage({ searchParams }: { searchParams: Promise<BusquedaPagina> }) {
  const sp = await searchParams
  const c = await contextoEdicion(sp)
  const comun = { modo: c.modo, demo: c.demo, rol: c.rol, sufijo: c.sufijo, rutaActual: '/clientes/edicion/vinculos', avisoRol: c.avisoRol, pestanas: pestanasDe(c.rol, c.socio), actual: 'vinculos' as const }
  if (!puedePestana(c.rol, c.socio, 'vinculos')) {
    return (
      <div className="ed-pila">
        <Encabezado etiqueta="Edición" titulo="Vínculos de carpetas" vigia={null} {...comun} />
        <Vacio frase="Esta parte es de Aylu y Tomás." accion={<BotonEnlace href={conSufijo('/clientes/edicion', c.sufijo)}>Volver al tablero</BotonEnlace>} />
      </div>
    )
  }
  let carpetas: CarpetaGrabacion[] = []
  let falla: string | null = null
  if (c.demo) carpetas = (await import('@/lib/edicion/demo')).datosDemo(new Date()).carpetas
  else if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try { carpetas = await listarVinculos() } catch (e) { logLectura('los vínculos', e); falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.' }
  }
  if (falla) return <div className="ed-pila"><SeccionTitulo etiqueta="Edición" titulo="Vínculos de carpetas" /><div className="cj-aviso" role="alert"><p>{falla}</p></div></div>
  const v = armarVinculos(carpetas, c.rol)
  return (
    <div className="ed-pila">
      <Encabezado etiqueta="Edición" titulo="Vínculos de carpetas" vigia={null} contadores={{ vinculos: v.pendientes.length }} {...comun} />
      <p className="ed-parrafo ed-sub">{v.confirmados} carpeta{v.confirmados === 1 ? '' : 's'} ya vinculada{v.confirmados === 1 ? '' : 's'} (se pueden corregir más abajo). Las por confirmar no procesan nada hasta que se confirme de qué cliente son.</p>
      {v.pendientes.length ? (
        <ul className="ed-vinculos">
          {v.pendientes.map(k => (
            <li key={k.drive_id} className="ed-vinculo">
              <p><strong>{k.nombre}</strong> · <a className="ed-link" href={k.link} target="_blank" rel="noopener noreferrer">Abrir en Drive</a></p>
              {k.ruta && <p className="ed-sub">{k.ruta}</p>}
              {k.candidatos.length ? (
                <div className="ed-botones">
                  {k.candidatos.map(x => (
                    v.puedeConfirmar
                      ? <BotonAccion key={x.id_crm} demo={c.demo} etiqueta={`Es ${x.nombre} (${x.id_crm} · ${x.puntaje})`} cuerpo={{ accion: 'vinculo_confirmar', carpeta_id: k.drive_id, id_crm: x.id_crm }}
                          confirmar={`¿La carpeta «${k.nombre}» es de ${x.nombre} (${x.id_crm})? Desde ahí el vigía procesa sus crudos y avisos para ese cliente.`} />
                      : <span key={x.id_crm} className="ed-marca">{x.nombre} ({x.puntaje})</span>
                  ))}
                </div>
              ) : <p className="ed-sub">El bot no encontró un cliente parecido.</p>}
              {v.puedeConfirmar && <VinculoManual carpetaId={k.drive_id} nombre={k.nombre} demo={c.demo} />}
            </li>
          ))}
        </ul>
      ) : <Vacio frase="No hay carpetas por confirmar." />}
      {v.vinculadas.length > 0 && (
        <section className="ed-seccion" aria-labelledby="ed-vinculadas">
          <h2 id="ed-vinculadas">Ya vinculadas <span className="ed-contador">{v.vinculadas.length}</span></h2>
          <ul className="ed-vinculos">
            {v.vinculadas.map(k => (
              <li key={k.drive_id} className="ed-vinculo">
                <p><strong>{k.nombre}</strong> → {k.id_crm} · por {k.por}{k.revisar ? <> · <span className="ed-marca ed-marca--laton">revisar</span></> : null} · <a className="ed-link" href={k.link} target="_blank" rel="noopener noreferrer">Abrir en Drive</a></p>
                {v.puedeConfirmar && (
                  <details className="cj-detalles">
                    <summary className="cj-etiqueta">Corregir el cliente</summary>
                    <p className="ed-sub">Lo que el bot armó con el cliente anterior se suelta: sus videos con crudos de esta carpeta quedan bloqueados para revisar y los que salieron del doc y todavía esperaban crudos se descartan.</p>
                    <VinculoManual carpetaId={k.drive_id} nombre={k.nombre} demo={c.demo} etiqueta="Cliente correcto (id)" boton="Cambiar" />
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
