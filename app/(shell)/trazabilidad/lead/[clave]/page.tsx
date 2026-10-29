import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirAcceso } from '@/lib/auth/sesion'
import { SeccionTitulo } from '@/components/ui'
import { ETIQUETA_ARQUETIPO } from '@/lib/trazabilidad/catalogo'
import { cargarDatos } from '@/lib/trazabilidad/leads'
import { ETIQUETA_ORIGEN, puntajeVinculo } from '@/lib/trazabilidad/modelo'
import { anguloDePieza } from '@/lib/trazabilidad/reporte'
import { pegarLlamada, pegarSetting, reanalizarSetting, traerLlamada, vincular } from '../../acciones'
import { SubNav, fechaCorta, usd } from '../../_componentes/comunes'
import { FormAccion } from '../../_componentes/FormAccion'

export const metadata: Metadata = { title: 'Lead · Trazabilidad' }
export const dynamic = 'force-dynamic'

const o = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v)

// Ficha de un cierre con sus tres capas. Desde acá se vincula o pega el setting y se trae o pega la llamada.
export default async function LeadPage({ params }: { params: Promise<{ clave: string }> }) {
  await exigirAcceso('trazabilidad')
  const { clave: cruda } = await params
  let clave = cruda
  try {
    clave = decodeURIComponent(cruda)
  } catch { /* ya venía decodificada */ }
  const datos = await cargarDatos()
  const lead = datos.leads.find((l) => l.cierre.clave === clave)
  if (!lead) notFound()
  const { cierre: c, setting: s, llamada: ll } = lead
  const nombreAngulo = new Map(datos.angulos.map((a) => [a.id, a.nombre]))
  const angulo = (id: string | null) => (id ? nombreAngulo.get(id) ?? id : 'Sin ángulo')
  const candidatos = [...datos.envios].sort((a, b) => puntajeVinculo(c, b) - puntajeVinculo(c, a) || b.actualizado.localeCompare(a.actualizado)).slice(0, 150)
  const a = s?.analisis

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta={`Trazabilidad · ${c.grupo === 'muestra' ? 'Muestra' : 'Contraste'}`} titulo={c.nombre} acciones={<Link className="cj-enlace" href="/trazabilidad">← Cierres</Link>} />
      <SubNav actual="" />

      <section className="cj-panel" aria-labelledby="t-closing">
        <h2 id="t-closing" className="cj-titulo cj-titulo--seccion">Closing · CRM</h2>
        <dl className="traz-dl">
          <dt>Llamada</dt><dd>{fechaCorta(c.fecha)} · {c.pestana}, fila {c.fila}</dd>
          <dt>Cobrado</dt><dd>{usd(c.cobrado)} de {usd(c.valor)} · {c.concepto}</dd>
          <dt>Situación</dt><dd>{c.situacion}</dd>
          <dt>Fuente</dt><dd>{o([c.fuente, c.campania, c.video].filter(Boolean).join(' · '))}</dd>
          <dt>Setter</dt><dd>{o(c.setter)}</dd>
          <dt>Contexto agenda</dt><dd>{o(c.contextoAgenda)}</dd>
          <dt>Grabaciones</dt><dd>{c.grabaciones.length ? c.grabaciones.map((g, i) => <span key={g}>{i ? ' · ' : ''}<a className="traz-link" href={g} target="_blank" rel="noreferrer">Fathom {i + 1}</a></span>) : '—'}</dd>
        </dl>
      </section>

      <section className="cj-panel cj-pila cj-pila--chica" aria-labelledby="t-setting">
        <h2 id="t-setting" className="cj-titulo cj-titulo--seccion">Setting · botonera</h2>
        {s ? (
          <>
            <p className="traz-nota">
              {s.subscriberId.startsWith('manual:') ? 'Pegado a mano' : `Contacto ManyChat ${s.subscriberId}${s.igUsuario ? ` · @${s.igUsuario}` : ''}`} · enviado {fechaCorta(s.actualizado.slice(0, 10))}{s.enviadoPor ? ` por ${s.enviadoPor}` : ''} · {lead.vinculoManual ? 'vinculado a mano' : 'vinculado solo (teléfono, mail o nombre)'}
            </p>
            {s.error && <p className="traz-error">El análisis falló: {s.error}</p>}
            {a ? (
              <div className="traz-dos">
                <dl className="traz-dl">
                  <dt>Origen</dt><dd>{ETIQUETA_ORIGEN[a.origen]}</dd>
                  <dt>Situación</dt><dd>{o(a.situacion)}</dd>
                  <dt>Dolor</dt><dd>{o(a.dolor)}</dd>
                  <dt>Objetivo</dt><dd>{o(a.objetivo)}</dd>
                  <dt>Ciclo de agenda</dt><dd>{a.ciclo_dias != null ? `${a.ciclo_dias} días` : '—'} ({fechaCorta(a.primera_interaccion)} → {fechaCorta(a.fecha_agenda)})</dd>
                  <dt>Seguimientos</dt><dd>{o(a.seguimientos)}</dd>
                  <dt>Material enviado</dt><dd>{a.material_enviado.length ? a.material_enviado.join(' · ') : '—'}</dd>
                  <dt>Caso de éxito</dt><dd>{o(a.caso_exito_enviado)}</dd>
                </dl>
                <div className="cj-pila cj-pila--chica">
                  <span className="cj-etiqueta">Contenido consumido ({a.piezas.length})</span>
                  {a.piezas.length ? (
                    <ul className="traz-ol">
                      {a.piezas.map((p) => (
                        <li key={p.etiqueta}>
                          <span className={p.etiqueta === a.pieza_gatillo ? 'traz-etiqueta traz-etiqueta--gatillo' : 'traz-etiqueta'}>{p.etiqueta}</span>{' '}
                          <span className="traz-nota">{p.tipo} · {angulo(anguloDePieza(p.etiqueta, p.angulo, datos.piezas))}{p.etiqueta === a.pieza_gatillo ? ' · GATILLO' : ''}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="traz-nota">Sin piezas de contenido en las etiquetas.</p>}
                </div>
              </div>
            ) : !s.error && <p className="traz-nota">Análisis en curso o pendiente.</p>}
            <details>
              <summary className="cj-etiqueta">Resumen de la botonera</summary>
              <pre className="traz-pre">{s.resumen}</pre>
            </details>
            <FormAccion accion={reanalizarSetting} boton="Volver a analizar" pendiente="Analizando…" className="">
              <input type="hidden" name="subscriber" value={s.subscriberId} />
            </FormAccion>
          </>
        ) : (
          <p className="traz-texto">Todavía no hay setting para este cierre. Abrí su chat en ManyChat y tocá <strong>Enviar al Despacho</strong> en la botonera, o pegá el resumen acá abajo.</p>
        )}

        <FormAccion accion={vincular} boton="Guardar vínculo" className="traz-form">
          <input type="hidden" name="clave" value={c.clave} />
          <label className="cj-etiqueta" htmlFor="sel-sub">Vincular con un envío de la botonera</label>
          <select id="sel-sub" name="subscriber" defaultValue={lead.vinculoManual ? (s?.subscriberId ?? '__ninguno') : '__auto'}>
            <option value="__auto">Automático (teléfono, mail o nombre)</option>
            <option value="__ninguno">No tiene chat de setting</option>
            {candidatos.map((e) => (
              <option key={e.subscriberId} value={e.subscriberId}>{e.nombre || e.igUsuario || e.subscriberId}{e.igUsuario ? ` (@${e.igUsuario})` : ''} · {fechaCorta(e.actualizado.slice(0, 10))}</option>
            ))}
          </select>
        </FormAccion>

        <details>
          <summary className="cj-etiqueta">Pegar el resumen a mano</summary>
          <FormAccion accion={pegarSetting} boton="Guardar y analizar" pendiente="Analizando…">
            <input type="hidden" name="clave" value={c.clave} />
            <label className="traz-nota" htmlFor="res-set">Resumen de la botonera (botón «Copiar al CRM»)</label>
            <textarea id="res-set" name="resumen" />
            <label className="traz-nota" htmlFor="eti-set">Etiquetas de ManyChat, una por renglón (opcional, mejora el contenido consumido)</label>
            <textarea id="eti-set" name="etiquetas" style={{ minHeight: 80 }} />
          </FormAccion>
        </details>
      </section>

      <section className="cj-panel cj-pila cj-pila--chica" aria-labelledby="t-llamada">
        <h2 id="t-llamada" className="cj-titulo cj-titulo--seccion">Llamada · Fathom</h2>
        {ll?.error && <p className="traz-error">{ll.error}</p>}
        {ll?.analisis ? (
          <div className="traz-dos">
            <dl className="traz-dl">
              <dt>Meta</dt><dd>{o(ll.analisis.meta)}</dd>
              <dt>Situación</dt><dd>{o(ll.analisis.situacion_actual)}</dd>
              <dt>Oferta</dt><dd>{o(ll.analisis.oferta_propuesta)}</dd>
              <dt>Por qué compró</dt><dd>{o(ll.analisis.motivo_decision)}</dd>
              <dt>Closer</dt><dd>{o(ll.analisis.habilidad_closer)}</dd>
              <dt>Cómo nos conoció</dt><dd>{o(ll.analisis.como_nos_conocio)}</dd>
              <dt>Contenido que nombró</dt><dd>{ll.analisis.contenido_mencionado.length ? ll.analisis.contenido_mencionado.join(' · ') : '—'}</dd>
              <dt>Objeciones</dt><dd>{ll.analisis.objeciones.length ? ll.analisis.objeciones.join(' · ') : '—'}</dd>
              <dt>Arquetipo</dt><dd>{ETIQUETA_ARQUETIPO[ll.analisis.arquetipo]}</dd>
            </dl>
            <div className="cj-pila cj-pila--chica">
              <span className="cj-etiqueta">Dolores que dijo ({ll.analisis.dolores.length})</span>
              <ul className="traz-ol">
                {ll.analisis.dolores.map((d, i) => (
                  <li key={i}>{d.tema} <span className="traz-nota">· {d.angulo ? angulo(d.angulo) : 'NUEVO (fuera del catálogo)'}</span><br /><span className="traz-cita">“{d.cita}”</span></li>
                ))}
              </ul>
            </div>
          </div>
        ) : !ll?.error && <p className="traz-nota">Todavía no se trajo la llamada.</p>}
        {ll?.url && <p className="traz-nota"><a className="traz-link" href={ll.url} target="_blank" rel="noreferrer">Abrir en Fathom</a></p>}
        {ll?.resumen && (
          <details>
            <summary className="cj-etiqueta">Resumen de Fathom</summary>
            <pre className="traz-pre">{ll.resumen}</pre>
          </details>
        )}
        <FormAccion accion={traerLlamada} boton={ll?.analisis ? 'Volver a traer de Fathom' : 'Traer de Fathom'} pendiente="Buscando en Fathom y analizando…" className="">
          <input type="hidden" name="clave" value={c.clave} />
        </FormAccion>
        <details>
          <summary className="cj-etiqueta">Pegar el resumen de la llamada a mano</summary>
          <FormAccion accion={pegarLlamada} boton="Guardar y analizar" pendiente="Analizando…">
            <input type="hidden" name="clave" value={c.clave} />
            <label className="traz-nota" htmlFor="res-ll">Resumen o transcripción de la llamada</label>
            <textarea id="res-ll" name="resumen" />
          </FormAccion>
        </details>
      </section>
    </div>
  )
}
