import { Bloque, Estado, Resumen, SeccionTitulo, VacioGuiado, type DatoResumen, type Tono } from '@/components/ui'
import { avancePlan, barraCasos, fechaLarga, NOMBRE_ESTADO_ETAPA, type EstadoEtapa } from '@/lib/clientes/portal/modelo'
import { numero } from '@/lib/clientes/portal/reporte'
import { BloqueReporte, ProgresoCasosVista } from './ProgresoYReporte'
import './portal.css'
import type { PaginaPortal } from '@/lib/clientes/portal/armar'

// Lo que ve el CLIENTE en su portal (2/11/2026). El equipo ve exactamente esto debajo de su panel de edición. Solo lectura y
// solo lo de este cliente: su objetivo, el plan por etapas, los próximos pasos, cómo viene el proceso, sus guiones aprobados y
// las notas de seguimiento (cada sección se puede ocultar por portal: datos.secciones, 2/11/2026). Sin montos, sin nombres del equipo, sin fuentes internas. Clases del Despacho (cj-*): sin CSS propio.

const TONO_ETAPA: Record<EstadoEtapa, Tono> = { hecha: 'ok', en_curso: 'atencion', pendiente: 'neutro' }

export function VistaPortal({ p }: { p: PaginaPortal }) {
  const { datos, actualizado } = p.portal
  const nombre = datos.nombre || p.nombreCRM
  const avance = avancePlan(datos.etapas)
  const guiones = p.tandas.reduce((n, t) => n + t.guiones.length, 0)
  const pasos = datos.proximos.filter(x => !x.hecho)
  const notas = [...datos.notas].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
  const ver = datos.secciones
  const barra = barraCasos(datos.progreso)

  const resumen: (DatoResumen | null)[] = [
    { etiqueta: 'Nuestro objetivo', icono: 'ok', destacado: true, valor: datos.objetivo.metrica || '—', contexto: datos.objetivo.fecha ? `Para el ${fechaLarga(datos.objetivo.fecha)}` : datos.objetivo.metrica ? 'El objetivo final' : 'Lo definimos juntos', ...(ver.objetivo && datos.objetivo.texto ? { href: '#objetivo', accion: 'Ver el objetivo' } : {}) },
    // «Cómo vamos» (antes «Avance del plan»): lleva al plan solo si esa sección se ve
    // Sin plan visible ni etapas cargadas, la tarjeta solo diría «—»: no se muestra (2/11/2026)
    !ver.plan && !avance ? null : { etiqueta: 'Cómo vamos', icono: 'tarea', valor: avance ? <>{avance.hechas}<span className="cj-dato__unidad">de {avance.total} etapas</span></> : '—', contexto: avance ? `${avance.porcentaje} % recorrido` : 'El plan se arma en la primera reunión', ...(ver.plan ? { href: '#plan', accion: 'Ver el plan' } : {}) },
    { etiqueta: 'Guiones listos', icono: 'guiones', valor: String(guiones), contexto: p.tandas.length ? `En ${p.tandas.length} ${p.tandas.length === 1 ? 'tanda' : 'tandas'}` : 'Se están preparando', ...(ver.guiones ? { href: '#guiones', accion: 'Ver los guiones' } : {}) },
    // Historias de Instagram (10/11/2026): tarjeta propia cuando hay guiones de historias cargados y la sección se ve
    ver.historias && datos.historias.guiones.length ? { etiqueta: 'Historias de Instagram', icono: 'guiones', valor: <>{datos.historias.guiones.length}<span className="cj-dato__unidad">guiones</span></>, contexto: 'Uno por día, con las instrucciones para grabar', href: '#historias', accion: 'Ver las historias' } : null,
  ]
  // Casos conseguidos (2/11/2026): segunda tarjeta del resumen cuando hay conteo y la sección se ve
  if (ver.progreso && barra) resumen.splice(1, 0, { etiqueta: barra.mes ? 'Casos del mes' : 'Casos conseguidos', icono: 'estrategia', valor: <>{numero(barra.casos)}<span className="cj-dato__unidad">de {numero(barra.meta)}</span></>, contexto: barra.hito ? (barra.hito.logrado ? `Meta de ${numero(barra.hito.casos)} lograda` : `${barra.mes ? 'Meta del mes' : 'Próxima meta'}: ${numero(barra.hito.casos)}${barra.hito.fecha ? ` al ${fechaLarga(barra.hito.fecha)}` : ''}`) : `${Math.floor(barra.porcentaje)} % del objetivo`, href: '#progreso', accion: 'Ver el avance' })
  const intro = ver.plan
    ? 'Acá ves el objetivo que nos propusimos, el camino para llegar y cómo viene cada paso. Lo vamos actualizando con cada avance.'
    : 'Acá ves el objetivo que nos propusimos, cómo vamos y tus guiones. Lo vamos actualizando con cada avance.'

  return (
    <div className="cj-pila pc-portal">
      <SeccionTitulo etiqueta="Tu portal · Capital Jurídico" titulo={nombre} />
      <p className="cj-parrafo cj-texto-2" style={{ marginTop: -40 }}>
        {intro}
        {actualizado && <> Última actualización: {fechaLarga(actualizado.slice(0, 10))}.</>}
      </p>

      <Resumen titulo="Resumen" datos={resumen.filter((d): d is DatoResumen => d !== null)} />

      {ver.objetivo && (
      <Bloque titulo="El objetivo" etiqueta="Hacia dónde vamos" id="objetivo">
        {datos.objetivo.texto ? (
          <div className="cj-pila cj-pila--chica">
            <TextoObjetivo texto={datos.objetivo.texto} />
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
      )}

      {ver.progreso && (
      <Bloque titulo="Casos conseguidos" etiqueta="El objetivo, en números" id="progreso">
        <ProgresoCasosVista progreso={datos.progreso} />
      </Bloque>
      )}

      {ver.reporte && <BloqueReporte reporte={p.reporte} />}

      {ver.plan && (
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
      )}

      {ver.proximos && (
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
      )}

      {ver.proceso && (
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
      )}

      {ver.guiones && (
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
      )}

      {ver.historias && datos.historias.guiones.length > 0 && (
      <Bloque titulo="Historias de Instagram" etiqueta="Un guion por día" id="historias">
        <div className="cj-pila cj-pila--chica">
          {datos.historias.indicaciones && <p className="cj-parrafo" style={{ whiteSpace: 'pre-line' }}>{datos.historias.indicaciones}</p>}
          {datos.historias.guiones.map((g, i) => (
            <details key={i} className="cj-detalles" open={i === 0}>
              <summary><strong>Día {i + 1} · {g.titulo}</strong>{g.clave && <span className="cj-texto-2">&nbsp;· Palabra clave: {g.clave}</span>}</summary>
              <dl className="cj-pila cj-pila--chica" style={{ margin: '16px 0 0' }}>
                {g.historias.map((h, j) => (
                  <div key={j} className="cj-panel">
                    <dt className="cj-etiqueta cj-etiqueta--laton">Historia {j + 1}</dt>
                    <dd style={{ margin: '6px 0 0', whiteSpace: 'pre-line' }}>{h.dice}</dd>
                    {h.pantalla && <dd className="cj-texto-2" style={{ margin: '8px 0 0', whiteSpace: 'pre-line' }}>En pantalla: <strong>{h.pantalla}</strong></dd>}
                    {h.sticker && <dd className="cj-texto-2" style={{ margin: '4px 0 0', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>Sticker: {h.sticker}</dd>}
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
      </Bloque>
      )}

      {ver.seguimiento && (
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
      )}
    </div>
  )
}

/** El objetivo: párrafos y, las líneas que empiezan con «•» o «-», como lista (así el equipo escribe el plan en viñetas). */
function TextoObjetivo({ texto }: { texto: string }) {
  const bloques: ({ tipo: 'p'; texto: string } | { tipo: 'ul'; items: string[] })[] = []
  for (const linea of texto.split('\n').map(l => l.trim())) {
    if (!linea) continue
    const item = /^[•\-–*]\s*(.+)$/.exec(linea)
    const ultimo = bloques.at(-1)
    if (item) {
      if (ultimo?.tipo === 'ul') ultimo.items.push(item[1])
      else bloques.push({ tipo: 'ul', items: [item[1]] })
    } else bloques.push({ tipo: 'p', texto: linea })
  }
  return (
    <>
      {bloques.map((b, i) => b.tipo === 'p'
        ? <p key={i} className="cj-parrafo" style={{ fontSize: 17 }}>{b.texto}</p>
        : <ul key={i} className="pc-objetivo__lista">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>)}
    </>
  )
}
