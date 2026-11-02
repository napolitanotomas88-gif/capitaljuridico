import { Bloque, Estado, Resumen, SeccionTitulo, VacioGuiado, type DatoResumen, type Tono } from '@/components/ui'
import { avancePlan, fechaLarga, NOMBRE_ESTADO_ETAPA, type EstadoEtapa } from '@/lib/clientes/portal/modelo'
import type { PaginaPortal } from '@/lib/clientes/portal/armar'

// Lo que ve el CLIENTE en su portal (2/11/2026). El equipo ve exactamente esto debajo de su panel de edición. Solo lectura y
// solo lo de este cliente: su objetivo, el plan por etapas, los próximos pasos, cómo viene el proceso, sus guiones aprobados y
// las notas de seguimiento. Sin montos, sin nombres del equipo, sin fuentes internas. Clases del Despacho (cj-*): sin CSS propio.

const TONO_ETAPA: Record<EstadoEtapa, Tono> = { hecha: 'ok', en_curso: 'atencion', pendiente: 'neutro' }

export function VistaPortal({ p }: { p: PaginaPortal }) {
  const { datos, actualizado } = p.portal
  const nombre = datos.nombre || p.nombreCRM
  const avance = avancePlan(datos.etapas)
  const guiones = p.tandas.reduce((n, t) => n + t.guiones.length, 0)
  const pasos = datos.proximos.filter(x => !x.hecho)
  const notas = [...datos.notas].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))

  const resumen: DatoResumen[] = [
    { etiqueta: 'Nuestro objetivo', icono: 'ok', destacado: true, valor: datos.objetivo.metrica || '—', contexto: datos.objetivo.fecha ? `Para el ${fechaLarga(datos.objetivo.fecha)}` : 'Lo definimos juntos' },
    { etiqueta: 'Avance del plan', icono: 'tarea', valor: avance ? <>{avance.hechas}<span className="cj-dato__unidad">de {avance.total} etapas</span></> : '—', contexto: avance ? `${avance.porcentaje} % recorrido` : 'El plan se arma en la primera reunión', href: '#plan', accion: 'Ver el plan' },
    { etiqueta: 'Guiones listos', icono: 'guiones', valor: String(guiones), contexto: p.tandas.length ? `En ${p.tandas.length} ${p.tandas.length === 1 ? 'tanda' : 'tandas'}` : 'Se están preparando', href: '#guiones', accion: 'Ver los guiones' },
  ]

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Tu portal · Capital Jurídico" titulo={nombre} />
      <p className="cj-parrafo cj-texto-2" style={{ marginTop: -40 }}>
        Acá ves el objetivo que nos propusimos, el camino para llegar y cómo viene cada paso. Lo vamos actualizando con cada avance.
        {actualizado && <> Última actualización: {fechaLarga(actualizado.slice(0, 10))}.</>}
      </p>

      <Resumen titulo="Resumen" datos={resumen} />

      <Bloque titulo="El objetivo" etiqueta="Hacia dónde vamos" id="objetivo">
        {datos.objetivo.texto ? (
          <div className="cj-pila cj-pila--chica">
            <p className="cj-parrafo" style={{ whiteSpace: 'pre-line', fontSize: 17 }}>{datos.objetivo.texto}</p>
            {(datos.objetivo.metrica || datos.objetivo.fecha) && (
              <dl className="cj-datos" style={{ margin: 0 }}>
                {datos.objetivo.metrica && <div><dt className="cj-etiqueta">Cómo lo medimos</dt><dd>{datos.objetivo.metrica}</dd></div>}
                {datos.objetivo.fecha && <div><dt className="cj-etiqueta">Para cuándo</dt><dd>{fechaLarga(datos.objetivo.fecha)}</dd></div>}
              </dl>
            )}
          </div>
        ) : (
          <VacioGuiado titulo="Lo estamos definiendo" texto="El objetivo lo dejamos por escrito acá apenas lo cerremos juntos." />
        )}
      </Bloque>

      <Bloque titulo="Cómo vamos a llegar" etiqueta="El plan, por etapas" id="plan" estado={avance ? { tono: avance.hechas === avance.total ? 'ok' : 'atencion', texto: `${avance.hechas} de ${avance.total} logradas` } : undefined}>
        {datos.etapas.length ? (
          <ol className="cj-linea">
            {datos.etapas.map((e, i) => (
              <li key={i} aria-current={e.estado === 'en_curso' ? 'step' : undefined}>
                <p className="cj-etiqueta">Etapa {i + 1}{e.fecha ? ` · ${fechaLarga(e.fecha)}` : ''}</p>
                <h3 className="cj-bloque__titulo" style={{ fontSize: 19 }}>{e.titulo}</h3>
                {e.detalle && <p className="cj-linea__detalle" style={{ whiteSpace: 'pre-line' }}>{e.detalle}</p>}
                <span><Estado tono={TONO_ETAPA[e.estado]}>{NOMBRE_ESTADO_ETAPA[e.estado]}</Estado></span>
              </li>
            ))}
          </ol>
        ) : (
          <VacioGuiado titulo="El plan se arma con vos" texto="Cuando definamos las etapas, vas a ver acá cada una y en cuál estamos." />
        )}
      </Bloque>

      <Bloque titulo="Próximos pasos" etiqueta="Lo que sigue" id="proximos">
        {pasos.length ? (
          <ul className="cj-lista">
            {pasos.map((x, i) => (
              <li key={i}>{x.texto}{x.fecha && <span className="cj-texto-2"> · {fechaLarga(x.fecha)}</span>}</li>
            ))}
          </ul>
        ) : (
          <p className="cj-parrafo cj-texto-2">Por ahora no hay pasos pendientes de tu lado.</p>
        )}
      </Bloque>

      <Bloque titulo="Cómo viene el proceso" etiqueta="Lo que ya hicimos juntos" id="proceso">
        {p.proceso.length ? (
          <ol className="cj-linea">
            {p.proceso.map(h => (
              <li key={h.clave} aria-current={h.actual ? 'step' : undefined}>
                <p className="cj-linea__fechas cj-etiqueta">{h.hecho ? (h.fecha ? fechaLarga(h.fecha) : 'Hecho') : h.actual ? 'En eso estamos' : 'Más adelante'}</p>
                <p className="cj-parrafo" style={{ fontSize: 17 }}>{h.titulo}</p>
                {h.hecho && <span><Estado tono="ok">Listo</Estado></span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="cj-parrafo cj-texto-2">Todavía no hay avances para mostrar.</p>
        )}
      </Bloque>

      <Bloque titulo="Tus guiones" etiqueta="Para grabar" id="guiones">
        {p.tandas.length ? (
          <div className="cj-pila cj-pila--chica">
            {p.tandas.map((t, i) => (
              <details key={t.tanda} className="cj-detalles" open={i === 0}>
                <summary><strong>Tanda {t.tanda}</strong><span className="cj-texto-2">&nbsp;· {t.guiones.length} {t.guiones.length === 1 ? 'guion' : 'guiones'}{t.fecha ? ` · ${fechaLarga(t.fecha)}` : ''}</span></summary>
                <div className="cj-pila cj-pila--chica" style={{ marginTop: 16 }}>
                  {t.guiones.map(g => (
                    <article key={g.numero} className="cj-panel">
                      <p className="cj-etiqueta cj-etiqueta--laton">Guion {g.numero}</p>
                      <h3 className="cj-bloque__titulo" style={{ fontSize: 19, marginBottom: 12 }}>{g.titulo}</h3>
                      <dl className="cj-pila cj-pila--chica" style={{ margin: 0 }}>
                        {g.secciones.map((s, j) => (
                          <div key={j}>
                            <dt className="cj-etiqueta">{s.seccion}{s.indicacion && <span className="cj-texto-2" style={{ textTransform: 'none', letterSpacing: 0 }}> · {s.indicacion}</span>}</dt>
                            <dd style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{s.texto}</dd>
                          </div>
                        ))}
                      </dl>
                      {g.ganchos.length > 0 && (
                        <details className="cj-detalles" style={{ marginTop: 12 }}>
                          <summary className="cj-texto-2">Otras formas de empezar</summary>
                          <ul className="cj-lista">{g.ganchos.map((x, k) => <li key={k}>{x}</li>)}</ul>
                        </details>
                      )}
                    </article>
                  ))}
                </div>
              </details>
            ))}
            {p.documento && <p><a className="cj-enlace" href={p.documento} target="_blank" rel="noreferrer">Abrir tu documento de guiones</a></p>}
          </div>
        ) : (
          <VacioGuiado titulo="Se están preparando" texto="Cuando una tanda de guiones esté lista y revisada, aparece acá para que la grabes." accion={p.documento ? <a className="cj-enlace" href={p.documento} target="_blank" rel="noreferrer">Abrir tu documento de guiones</a> : undefined} />
        )}
      </Bloque>

      <Bloque titulo="Seguimiento" etiqueta="Lo que vamos viendo" id="seguimiento">
        {notas.length ? (
          <ol className="cj-linea">
            {notas.map((n, i) => (
              <li key={i}>
                {n.fecha && <p className="cj-linea__fechas cj-etiqueta">{fechaLarga(n.fecha)}</p>}
                {n.titulo && <h3 className="cj-bloque__titulo" style={{ fontSize: 18 }}>{n.titulo}</h3>}
                {n.texto && <p className="cj-parrafo" style={{ whiteSpace: 'pre-line' }}>{n.texto}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="cj-parrafo cj-texto-2">Después de cada reunión dejamos acá lo que vimos y lo que acordamos.</p>
        )}
      </Bloque>
    </div>
  )
}
