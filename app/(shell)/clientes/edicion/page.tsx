import type { Metadata } from 'next'
import Link from 'next/link'
import { BotonEnlace, Resumen, SeccionTitulo, Vacio, type DatoResumen } from '@/components/ui'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { ultimaCorrida } from '@/lib/edicion/db/corridas'
import { leerMarcas } from '@/lib/edicion/operativo'
import { listarPendientesE01 } from '@/lib/edicion/operativo'
import { listarVideos, type FilaTablero } from '@/lib/edicion/operativo'
import { puedePestana, pestanasDe } from '@/lib/edicion/permisos'
import { cargarTarjetasEdicion } from '@/lib/edicion/tarjetasServidor'
import { ESTADOS_FINALES, ESTADOS_VIDEO, ETIQUETA_ESTADO, type Corrida, type FichaMarca, type IdCrm } from '@/lib/edicion/tipos'
import { armarTablero, estadoVigia, pasosPorHacer } from '@/lib/edicion/vista'
import { BotonAccion } from './_componentes/BotonAccion'
import { Columna } from './_componentes/Columna'
import { contextoEdicion, logLectura, uno, type BusquedaPagina } from './_componentes/contexto'
import { Encabezado } from './_componentes/Encabezado'
import { conSufijo } from './_componentes/enlaces'
import { Tarjeta } from './_componentes/Tarjeta'
import { TableroTarjetas } from './_componentes/TableroTarjetas'
import './edicion.css'

// Edición (24/10/2026): reemplaza la lista "Sistema de Edición" de ClickUp. Dos vistas del mismo tablero:
//   · Mi cola (René: para editar y correcciones; Aylu y Tomás: lo que les toca revisar, mandar o destrabar), por cliente;
//   · Por estado: columnas en escritorio, lista agrupada en el celular, con filtros en la URL (?estado=&cliente=).
// Lo que se muestra sale de lib/edicion/vista.ts (que decide qué NO llega al navegador: mails, teléfonos, montos). Cada
// página de /clientes/edicion pide la sección Edición (exigirAcceso en contextoEdicion). Con ?demo=1 (solo en desarrollo) muestra
// datos ficticios de lib/edicion/demo.ts y no toca la base; ?como=aylu|rene|tomas|lector cambia el rol del ejemplo.
export const metadata: Metadata = { title: 'Edición' }

type Props = { searchParams: Promise<BusquedaPagina> }

export default async function EdicionPage({ searchParams }: Props) {
  const sp = await searchParams
  const c = await contextoEdicion(sp)
  const vista = uno(sp.vista)
  if (vista === 'tarjetas' || (!vista && !uno(sp.estado) && !uno(sp.cliente))) {
    const inicial = c.demo ? undefined : await cargarTarjetasEdicion(c.sesion)
    return <div className="ed-pila">
      <Encabezado etiqueta="Edición" titulo="Sistema de Edición" vigia={null} modo={c.modo} demo={c.demo} rol={c.rol}
        pestanas={pestanasDe(c.rol, c.socio)} actual="tarjetas" sufijo={c.sufijo} rutaActual="/clientes/edicion?vista=tarjetas" avisoRol={c.avisoRol} />
      <TableroTarjetas key={`${c.demo}:${c.rol}`} demo={c.demo} rol={c.rol} inicial={inicial} />
    </div>
  }
  const ahora = new Date()
  let filas: FilaTablero[] = []
  let marcas = new Map<IdCrm, FichaMarca>()
  let corrida: Corrida | null = null
  let pendientes: number | undefined
  let falla: string | null = null

  if (c.demo) {
    const d = (await import('@/lib/edicion/demo')).datosDemo(ahora)
    filas = d.filas; marcas = d.marcas; corrida = d.corrida; pendientes = pasosPorHacer(d.pasos)
  } else if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try {
      // Aprobado y Descartado no se leen salvo que se filtre por ellos (pueden ser cientos)
      const final = (ESTADOS_FINALES as readonly string[]).includes(uno(sp.estado)) ? uno(sp.estado) : null
      filas = await listarVideos(final ? { estados: ESTADOS_VIDEO.filter(e => !ESTADOS_FINALES.includes(e) || e === final) } : {})
      const ids = [...new Set(filas.map(f => f.id_crm))]
      const verPendientes = puedePestana(c.rol, c.socio, 'pendientes')
      const [m, k, p] = await Promise.all([leerMarcas(ids), ultimaCorrida(), verPendientes ? listarPendientesE01() : Promise.resolve(null)])
      marcas = m; corrida = k; pendientes = p ? pasosPorHacer(p) : undefined
    } catch (e) {
      logLectura('el tablero', e)
      falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.'
    }
  }

  if (falla) {
    return (
      <div className="ed-pila">
        <SeccionTitulo etiqueta="Edición" titulo="Grabación y edición" />
        <div className="cj-aviso" role="alert"><p>{falla}</p></div>
        <div className="cj-fila"><BotonEnlace href="/clientes/edicion">Reintentar</BotonEnlace></div>
      </div>
    )
  }

  const v = armarTablero(filas, c.rol, ahora, { marcas, filtro: { estado: uno(sp.estado), cliente: uno(sp.cliente) }, socio: c.socio })
  const pidioEstado = uno(sp.vista) === 'estado' || !!uno(sp.estado) || !!uno(sp.cliente)
  const pestana = v.cola && !pidioEstado ? 'cola' : 'estado'
  const base = pestana === 'estado' ? '/clientes/edicion?vista=estado' : '/clientes/edicion?vista=cola'
  const conFiltro = (o: { estado?: string | null; cliente?: string | null }) => {
    const q = new URLSearchParams({ vista: 'estado' })
    const estado = o.estado === undefined ? v.filtros.estado : o.estado
    const cliente = o.cliente === undefined ? v.filtros.cliente : o.cliente
    if (estado) q.set('estado', estado)
    if (cliente) q.set('cliente', cliente)
    return conSufijo(`/clientes/edicion?${q.toString()}`, c.sufijo)
  }
  const conVideos = v.columnas.filter(col => col.tarjetas.length)
  const sinVideos = v.columnas.filter(col => !col.tarjetas.length)
  const totalPorEstado = new Map(ESTADOS_VIDEO.map(e => [e, filas.filter(f => f.estado === e && (!v.filtros.cliente || f.id_crm === v.filtros.cliente)).length]))

  return (
    <div className="ed-pila">
      <Encabezado etiqueta="Edición" titulo="Grabación y edición" vigia={estadoVigia(corrida, ahora)} modo={c.modo} demo={c.demo} rol={c.rol}
        pestanas={v.pestanas} actual={pestana} sufijo={c.sufijo} rutaActual={base} avisoRol={c.avisoRol}
        contadores={{ ...(v.cola ? { cola: v.cola.total } : {}), ...(pendientes !== undefined ? { pendientes } : {}) }} />

      {/* Mini panel (25/10/2026): lo que le toca a quien entró, lo trabado, lo bloqueado y lo que falta grabar, a un clic */}
      <Resumen titulo="Resumen del tablero" datos={[
        ...(v.cola ? [{ etiqueta: 'Lo que te toca', icono: 'tarea', destacado: true, valor: v.cola.total, contexto: `De ${v.resumen.activos} videos activos`, estado: v.cola.total ? { tono: 'atencion' as const, texto: 'Pendiente' } : { tono: 'ok' as const, texto: 'Al día' }, href: conSufijo('/clientes/edicion?vista=cola', c.sufijo), accion: 'Ver mi cola' }] : [
          { etiqueta: 'Videos activos', icono: 'edicion', destacado: true, valor: v.resumen.activos, contexto: 'En el tablero ahora', href: conSufijo('/clientes/edicion?vista=estado', c.sufijo), accion: 'Ver por estado' }]),
        { etiqueta: 'Trabados', icono: 'atencion', valor: v.resumen.trabados, contexto: 'Pasaron el tiempo de su estado (días hábiles)', estado: v.resumen.trabados ? { tono: 'alerta', texto: 'Destrabar' } : { tono: 'ok', texto: 'Ninguno' }, href: conSufijo('/clientes/edicion?vista=estado', c.sufijo), accion: 'Ver por estado' },
        { etiqueta: 'Bloqueados', icono: 'alerta', valor: v.resumen.bloqueados, contexto: 'Tienen un bloqueo marcado', estado: v.resumen.bloqueados ? { tono: 'alerta', texto: 'Revisar' } : { tono: 'ok', texto: 'Ninguno' } },
        ...(pendientes !== undefined ? [{ etiqueta: 'Por grabar', icono: 'camara', valor: pendientes, contexto: 'Pasos del seguimiento de quienes no grabaron', estado: pendientes ? { tono: 'atencion' as const, texto: 'Seguir' } : { tono: 'ok' as const, texto: 'Nada pendiente' }, href: conSufijo('/clientes/edicion/pendientes', c.sufijo), accion: 'Ver pendientes' }]
          : [{ etiqueta: 'Clientes sin paleta', icono: 'clientes', valor: v.resumen.sinPaleta, contexto: 'Les falta la paleta de colores' }]),
      ] satisfies DatoResumen[]} />

      {pestana === 'cola' && v.cola && (
        <section className="ed-seccion" aria-labelledby="ed-cola-t">
          <h2 id="ed-cola-t">{v.cola.titulo} <span className="ed-contador">{v.cola.total}</span></h2>
          <p className="ed-sub">{v.cola.explicacion}</p>
          {v.cola.grupos.length ? (
            <div className="ed-cola">
              {v.cola.grupos.map(g => (
                <section key={g.id_crm} className="ed-grupo" aria-label={g.cliente}>
                  <div className="ed-grupo__cab">
                    <h3><Link href={conSufijo(`/clientes/edicion/cliente/${encodeURIComponent(g.id_crm)}`, c.sufijo)} className="ed-enlace-cliente">{g.cliente}</Link> <span className="ed-sub ed-num">· {g.id_crm}</span></h3>
                    {g.lote && (
                      <BotonAccion demo={c.demo} variante="secundario"
                        etiqueta={g.lote.transicion === 'listo' ? `Terminé los ${g.lote.items.length} para editar` : `Sirven los ${g.lote.items.length}: a edición`}
                        confirmar={g.lote.transicion === 'listo' ? `¿Marcar listos los ${g.lote.items.length} videos de ${g.cliente}?` : `¿Pasar los ${g.lote.items.length} crudos de ${g.cliente} a Para editar?`}
                        cuerpo={{ accion: 'mover_lote', transicion: g.lote.transicion, items: g.lote.items }} />
                    )}
                  </div>
                  <ul className="ed-tarjetas">{g.tarjetas.map(t => <Tarjeta key={t.id} t={t} sufijo={c.sufijo} mostrarEstado />)}</ul>
                </section>
              ))}
            </div>
          ) : (
            <Vacio frase={c.rol === 'rene' ? 'No tenés videos para editar ni correcciones. Cuando Aylu apruebe una tanda, te avisamos por Discord.' : 'No hay nada esperándote. Lo que llegue (crudos, editados, correcciones) aparece acá.'} />
          )}
        </section>
      )}

      {pestana === 'estado' && (
        <section className="ed-seccion" aria-labelledby="ed-estado-t">
          <h2 id="ed-estado-t">Por estado</h2>
          <div className="ed-filtros">
            <nav aria-label="Filtrar por estado">
              <ul>
                <li><Link href={conFiltro({ estado: null })} className="cj-chip ed-filtro" aria-current={!v.filtros.estado ? 'true' : undefined}>Todos</Link></li>
                {ESTADOS_VIDEO.map(e => {
                  const n = totalPorEstado.get(e) ?? 0
                  const final = ESTADOS_FINALES.includes(e)
                  return <li key={e}><Link href={conFiltro({ estado: e })} className="cj-chip ed-filtro" aria-current={v.filtros.estado === e ? 'true' : undefined}>{ETIQUETA_ESTADO[e]}{!final || v.filtros.estado === e ? <span className="ed-contador">&nbsp;{n}</span> : null}</Link></li>
                })}
              </ul>
            </nav>
            <form method="get" action="/clientes/edicion" className="ed-form-filtro">
              <input type="hidden" name="vista" value="estado" />
              {v.filtros.estado && <input type="hidden" name="estado" value={v.filtros.estado} />}
              {c.demo && <><input type="hidden" name="demo" value="1" /><input type="hidden" name="como" value={c.rol} /></>}
              <label className="ed-campo ed-campo--medio">
                <span>Cliente</span>
                <select name="cliente" defaultValue={v.filtros.cliente ?? ''}>
                  <option value="">Todos los clientes</option>
                  {v.filtros.clientes.map(k => <option key={k.id_crm} value={k.id_crm}>{k.cliente} ({k.videos})</option>)}
                </select>
              </label>
              <button type="submit" className="cj-boton cj-boton--secundario">Filtrar</button>
              {(v.filtros.cliente || v.filtros.estado) && <Link href={conSufijo('/clientes/edicion?vista=estado', c.sufijo)} className="cj-enlace">Sacar los filtros</Link>}
            </form>
          </div>
          {conVideos.length ? (
            <div className="ed-columnas">{conVideos.map(col => <Columna key={col.estado} c={col} sufijo={c.sufijo} />)}</div>
          ) : (
            <Vacio frase={filas.length ? 'No hay videos con estos filtros.' : 'Todavía no hay videos en Edición. Entran cuando un guion pasa a «Para grabar», cuando Aylu marca «guiones enviados» o con la importación de ClickUp.'} />
          )}
          {conVideos.length > 0 && sinVideos.length > 0 && <p className="ed-vacias">Sin videos en: {sinVideos.map(col => col.etiqueta).join(', ')}.</p>}
        </section>
      )}
    </div>
  )
}
