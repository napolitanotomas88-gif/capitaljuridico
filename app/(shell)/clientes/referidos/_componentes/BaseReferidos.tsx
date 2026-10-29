import Link from 'next/link'
import { BotonEnlace, Vacio } from '@/components/ui'
import { Pasos } from '@/components/clientes/Pasos'
import { ActualizarReferido } from '@/components/clientes/ActualizarReferido'
import { CATEGORIAS_BASE, contarPorCategoria, type CategoriaBase, type FilaBase } from '@/lib/clientes/baseReferidos'
import { fechaCorta } from '@/lib/clientes/formato'

// Base de referidos: una ficha por persona recomendada, para tenerlo todo a mano (quién la presentó, paso, intento y beneficios).
// Sale de la pestaña "Referidos" del CRM Clientes; el enlace abre esa planilla. Solo lectura: no escribe nada.
type Props = {
  filas: FilaBase[]
  filtro: CategoriaBase | null
  sufijo: string                       // '?demo=1' o ''
  hojaUrl: string | null               // planilla del CRM Clientes (null en el ejemplo)
  pestanaAusente: boolean
  /** "Actualizar referido" (27/10/2026): solo si quien mira puede (Tomás, Gero A, Gero M, Aylu) y no es el ejemplo */
  edicion?: { estados: readonly string[]; clientes: { id: string; nombre: string }[]; hoy: string } | null
}

const hrefFiltro = (sufijo: string, c: CategoriaBase | null) => {
  const q = new URLSearchParams(sufijo.replace(/^\?/, ''))
  if (c) q.set('base', c)
  const s = q.toString()
  return `/clientes/referidos${s ? `?${s}` : ''}`
}
const hrefCliente = (id: string, sufijo: string) => `/clientes/${encodeURIComponent(id)}${sufijo}`

export function BaseReferidos({ filas, filtro, sufijo, hojaUrl, pestanaAusente, edicion = null }: Props) {
  const cuenta = contarPorCategoria(filas)
  const visibles = filtro ? filas.filter(f => f.categoria === filtro) : filas
  return (
    <section id="base-referidos" className="cj-pila cj-pila--chica" aria-labelledby="base-referidos-titulo">
      <div className="cj-base-cabecera">
        <div>
          <p className="cj-etiqueta cj-etiqueta--laton">Base de referidos</p>
          <h2 id="base-referidos-titulo" className="cj-base-titulo">Quién vino recomendado y qué le toca a cada uno</h2>
        </div>
        {hojaUrl && <BotonEnlace href={hojaUrl} target="_blank" rel="noopener noreferrer">Abrir el CRM Clientes (pestaña Referidos)</BotonEnlace>}
      </div>

      {pestanaAusente ? (
        <Vacio frase="Todavía no existe la pestaña “Referidos” en la planilla del CRM Clientes. Cuando se cree y se cargue el primer referido, cada persona va a aparecer acá, conectada con la ficha de quien la presentó." />
      ) : (
        <>
          <nav className="cj-pendientes" aria-label="Filtrar la base de referidos">
            <BotonEnlace href={hrefFiltro(sufijo, null)} variante={filtro === null ? 'primario' : undefined} aria-current={filtro === null ? 'true' : undefined}>Todos · {filas.length}</BotonEnlace>
            {CATEGORIAS_BASE.map(c => (
              <BotonEnlace key={c.clave} href={hrefFiltro(sufijo, c.clave)} variante={filtro === c.clave ? 'primario' : undefined} aria-current={filtro === c.clave ? 'true' : undefined}>
                {c.titulo} · {cuenta[c.clave]}
              </BotonEnlace>
            ))}
          </nav>

          {visibles.length === 0 ? (
            <Vacio frase={filas.length === 0 ? 'Sin registros todavía: la pestaña Referidos existe pero no tiene personas cargadas.' : 'No hay referidos en este grupo.'} />
          ) : (
            <ul className="cj-base-lista">
              {visibles.map(f => (
                <li key={f.id || `${f.nombre}-${f.fechaPedido}`} className="cj-base-ficha" data-categoria={f.categoria}>
                  <div className="cj-base-ficha__cab">
                    <h3 className="cj-base-ficha__nombre">{f.nombre || f.id || 'Sin nombre'}</h3>
                    <p className="cj-sub">
                      {[f.estudio, f.momento, f.fechaPedido ? `pedido el ${fechaCorta(f.fechaPedido)}` : ''].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>

                  <p className="cj-base-ficha__ref">
                    Lo presentó{' '}
                    {f.referidorEnCrm ? <Link href={hrefCliente(f.idReferidor, sufijo)} className="cj-enlace">{f.nombreReferidor}</Link> : <span>{f.nombreReferidor || 'sin cliente asignado'}</span>}
                  </p>

                  <p className="cj-base-chips">
                    <span className="cj-base-chip" data-tono={f.categoria}>{f.estado || 'Sin estado'}</span>
                    {f.intento && <span className="cj-base-chip" data-tono={f.intento.cuenta ? 'intento' : 'ninguno'}>Intento {f.intento.numero}</span>}
                  </p>

                  <dl className="cj-base-datos">
                    {f.intento && (
                      <div>
                        <dt>Para quien refiere</dt>
                        <dd>{f.intento.cuenta ? f.intento.premio : `El intento ${f.intento.numero} no suma todavía (revisar que sea un lead nuevo).`}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Beneficios del referido</dt>
                      <dd data-tono={f.beneficio.tono}>{f.beneficio.texto}</dd>
                    </div>
                    <div>
                      <dt>Paso del programa</dt>
                      <dd><Pasos paso={f.paso} /></dd>
                    </div>
                    {f.idClienteNuevo && (
                      <div>
                        <dt>Cliente nuevo</dt>
                        <dd>
                          {f.nombreClienteNuevo
                            ? <Link href={hrefCliente(f.idClienteNuevo, sufijo)} className="cj-enlace">{f.nombreClienteNuevo} ({f.idClienteNuevo})</Link>
                            : <span>{f.idClienteNuevo}</span>}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {edicion && f.id && (
                    <ActualizarReferido
                      referido={{ id: f.id, nombre: f.nombre, estado: f.estado, fechaLlamada: f.fechaLlamada, idClienteNuevo: f.idClienteNuevo, fechaPrimerPago: f.fechaPrimerPago, reembolso: f.reembolso }}
                      estados={edicion.estados} clientes={edicion.clientes} hoy={edicion.hoy}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="cj-parrafo cj-texto-2">Los beneficios del referido valen solo si se suma en la llamada. La planilla no tiene ese dato, así que lo confirma el closer: acá se muestran como condición, no como verificado.</p>
        </>
      )}
    </section>
  )
}
