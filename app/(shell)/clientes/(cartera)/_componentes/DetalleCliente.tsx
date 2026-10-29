import Link from 'next/link'
import { Suspense, type CSSProperties } from 'react'
import { puedeVer } from '@/lib/auth/roles'
import type { Sesion } from '@/lib/auth/sesion'
import { baseConfigurada as baseGuiones, tandasDelCliente, type FilaTanda } from '@/lib/bot/guiones/registro'
import { rolPuedeCanjear } from '@/lib/clientes/canje'
import { armarFicha } from '@/lib/clientes/ficha'
import { fechaCorta } from '@/lib/clientes/formato'
import type { CampanaMeta } from '@/lib/clientes/prioridad'
import type { KickoffPorLanzar } from '@/lib/anuncios/porLanzar'
import { AYUDA_ETAPA, ETAPAS, ETAPAS_CIERRE, NOMBRE_ETAPA, NOMBRE_FUENTE, type FilaRecorrido } from '@/lib/clientes/recorrido'
import type { VistaCRM } from '@/lib/clientes/vista'
import { baseConfigurada as baseEdicion } from '@/lib/edicion/db/base'
import { listarVideos, type FilaTablero } from '@/lib/edicion/db/videos'
import { ETIQUETA_ESTADO as ETIQUETA_VIDEO, ESTADOS_VIDEO, type EstadoVideo } from '@/lib/edicion/tipos'
import { Cobros } from '../../[id]/_componentes/Cobros'
import { Creditos } from '../../[id]/_componentes/Creditos'
import { Datos } from '../../[id]/_componentes/Datos'
import { Notas } from '../../[id]/_componentes/Notas'
import { PanelReferidosFicha } from '../../[id]/_componentes/PanelReferidos'
import { Periodos } from '../../[id]/_componentes/Periodos'
import { SeccionFicha } from '../../[id]/_componentes/SeccionFicha'
import { Saltos } from './LineaTiempo'
import { RegistroHitos } from './RegistroHitos'
import { CorregirEtapa } from './CorregirEtapa'
import { AccionesCliente } from './AccionesCliente'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import type { Hito } from '@/lib/clientes/hitos'
import { asegurarDocumentoCliente, documentoVinculadoCliente } from '@/lib/bot/guiones/documento'
import { HistorialOperativo } from '@/components/clientes/HistorialOperativo'

// Tarjeta abierta de la línea de tiempo (25/10/2026): TODO el cliente en un solo lugar, reusando lo que ya existe.
//   · CRM: las mismas secciones de la ficha (/clientes/<id>) armadas con armarFicha. Períodos (con precios) y cobros, solo con Finanzas.
//   · Kickoff y "Para lanzar": el resumen que ya arma "Por lanzar" del tablero de anuncios (misma caché, sin otra consulta).
//   · Guiones: las tandas del cliente (cj_guiones), con el link a /guiones/<id>. Solo con la sección Guiones.
//   · Edición: sus videos por estado, con el link al tablero filtrado. Solo con la sección Edición.
//   · Anuncios: lo que ve el tablero de Meta. Solo con la sección Anuncios.
//   · Referidos y créditos, y las notas de la planilla.
// Cada lectura que falla deja su sección con un aviso; el resto sale igual. Con ?demo=1 no se toca la base.

type Props = {
  vista: VistaCRM
  fila: FilaRecorrido
  quien: Sesion
  meta: CampanaMeta | null
  kickoff: KickoffPorLanzar | null
  hitos: Hito[]
  demo: boolean
  accionInicial?: string
}

async function leer<T>(que: string, fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false }> {
  try { return { ok: true, v: await fn() } } catch (e) {
    console.error(`[recorrido] ${que}:`, String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    return { ok: false }
  }
}

// Día argentino de una fecha ISO en UTC (después de las 21 h sería el día siguiente)
const diaAR = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

const ETIQUETA_TANDA: Record<string, string> = {
  pendiente: 'Por arrancar',
  mercado: 'Leyendo el mercado', plan: 'Armando el plan', escribiendo: 'Escribiendo', a_revisar: 'A revisar por el equipo', aprobada: 'Aprobada',
  enviada: 'Enviada al cliente', con_notas: 'Con notas del cliente', corrigiendo: 'Corrigiendo', error: 'Con error',
}

export async function DetalleCliente({ vista, fila, quien, meta, kickoff, hitos, demo, accionInicial }: Props) {
  const ficha = armarFicha(vista.datos, vista.creditos, fila.id, { conContacto: puedeVer(quien, 'clientes') })
  if (!ficha) return <p className="cj-aviso" role="alert">No se encontró este cliente en el CRM.</p>
  const ver = { guiones: puedeVer(quien, 'guiones'), edicion: puedeVer(quien, 'edicion'), anuncios: puedeVer(quien, 'anuncios'), finanzas: puedeVer(quien, 'finanzas'), referidos: puedeVer(quien, 'referidos'), acciones: puedeVer(quien, 'clientes') }
  const sufijo = demo ? '?demo=1' : ''
  const id = encodeURIComponent(ficha.id)

  const [tandas, videos, documento] = await Promise.all([
    !ver.guiones ? null : demo ? { ok: true as const, v: tandasDemo(fila) } : baseGuiones() ? leer('tandas', () => tandasDelCliente(ficha.id)) : { ok: false as const },
    !ver.edicion ? null : demo ? { ok: true as const, v: [] as FilaTablero[] } : baseEdicion() ? leer('videos', () => listarVideos({ id_crm: ficha.id, incluirFinales: true, limite: 200 })) : { ok: false as const },
    demo ? null : (puedeHacerAcciones(quien.email) ? asegurarDocumentoCliente(ficha.id) : documentoVinculadoCliente(ficha.id)).catch(() => null),
  ])

  return (
    <div className="rc-detalle">
      <Recorrido fila={fila} dia1={ficha.dia1} demo={demo} />
      {documento && <p><a className="cj-enlace" href={documento.url} target="_blank" rel="noreferrer">Documento de guiones del cliente</a></p>}

      {fila.alertas.length > 0 && (
        <ul className="rc-alertas" aria-label="Qué mirar">
          {fila.alertas.map(a => <li key={a}>{a}</li>)}
        </ul>
      )}

      <Saltos secciones={[
        ['rc-registro', 'Registro'], ...(ver.acciones ? [['rc-acciones', 'Acciones'] as [string, string]] : []), ['rc-crm', 'CRM'], ['rc-kickoff', 'Kickoff'], ...(ver.guiones ? [['rc-guiones', 'Guiones'] as [string, string]] : []),
        ...(ver.edicion ? [['rc-edicion', 'Edición'] as [string, string]] : []), ...(ver.anuncios ? [['rc-anuncios', 'Anuncios'] as [string, string]] : []),
        ...(ver.referidos ? [['rc-referidos', 'Referidos'] as [string, string]] : []), ['rc-notas', 'Notas'],
      ]} />

      <div id="rc-registro" className="rc-bloque">
        <SeccionFicha etiqueta="Registro" titulo="Todo lo que pasó con el cliente">
          <p className="cj-parrafo cj-texto-2">Se completa solo con el CRM, el Despacho, Drive, Meta y ClickUp. Si algo falta o está mal, anotalo: lo anotado manda.</p>
          <RegistroHitos idCrm={ficha.id} hitos={hitos} hoy={vista.datos.hoy} demo={demo} />
          <Suspense fallback={<p className="cj-texto-2" role="status">Leyendo el historial de servicio…</p>}>
            <HistorialOperativo idCrm={ficha.id} periodos={vista.datos.clientes.find(c => c.id === ficha.id)?.periodos ?? []} estado={ficha.estado} fin={ficha.fin} hoy={vista.datos.hoy} conFinanzas={ver.finanzas} demo={demo} />
          </Suspense>
        </SeccionFicha>
      </div>

      {ver.acciones && (
        <div id="rc-acciones" className="rc-bloque">
          <SeccionFicha etiqueta="Acciones" titulo="Servicio, pausas y más">
            <AccionesCliente key={`${ficha.id}:${accionInicial ?? ""}`} idCrm={ficha.id} nombre={ficha.nombre} hoy={vista.datos.hoy} demo={demo} puedeEditar={demo || puedeHacerAcciones(quien.email)} puedeFinanzas={ver.finanzas} estado={ficha.estado} accionInicial={accionInicial} />
          </SeccionFicha>
        </div>
      )}

      <div id="rc-crm" className="rc-bloque">
        <Datos f={ficha} />
          {ver.finanzas && <Periodos f={ficha} accionHref={demo || puedeHacerAcciones(quien.email) ? `/clientes?cliente=${id}&${demo ? 'demo=1&' : ''}accion=renovacion#rc-acciones` : undefined} />}
          {ver.finanzas && <Cobros f={ficha} accionHref={demo || puedeHacerAcciones(quien.email) ? `/clientes?cliente=${id}&${demo ? 'demo=1&' : ''}accion=pago#rc-acciones` : undefined} />}
        <p><Link className="cj-enlace" href={`/clientes/${id}${sufijo}`}>Abrir la ficha completa</Link></p>
      </div>

      <div id="rc-kickoff" className="rc-bloque">
        <SeccionFicha etiqueta="Kickoff" titulo="Ficha de kickoff y para lanzar">
          {kickoff ? <ResumenKickoff k={kickoff} /> : <p className="cj-parrafo cj-texto-2">Todavía no hay ficha de kickoff de este cliente (o no se pudo leer la base).</p>}
          <p><Link className="cj-enlace" href={`/clientes/${id}/kickoff${sufijo}`}>Abrir la ficha de kickoff</Link></p>
        </SeccionFicha>
      </div>

      {ver.guiones && (
        <div id="rc-guiones" className="rc-bloque">
          <SeccionFicha etiqueta="Guiones" titulo="Tandas de guiones">
            {!tandas?.ok ? <p className="cj-aviso" role="status">No se pudieron leer las tandas. Probá de nuevo en un minuto.</p>
              : tandas.v.length === 0 ? <p className="cj-parrafo cj-texto-2">Sin tandas en el Despacho todavía.</p>
              : (
                <ul className="rc-lista">
                  {tandas.v.slice(0, 5).map(t => (
                    <li key={t.id}>
                      <span className="rc-lista__titulo">Tanda {t.tanda}</span>
                      <span className="rc-chip">{ETIQUETA_TANDA[t.estado] ?? t.estado}</span>
                      <span className="cj-texto-2">{Object.keys(t.guiones ?? {}).length} guiones · {fechaCorta(diaAR(t.actualizado))}</span>
                      {t.doc && <a className="cj-enlace" href={t.doc.url} target="_blank" rel="noreferrer">Doc del cliente</a>}
                    </li>
                  ))}
                </ul>
              )}
            <p><Link className="cj-enlace" href={`/guiones/${id}${sufijo}`}>Ver los guiones</Link></p>
          </SeccionFicha>
        </div>
      )}

      {ver.edicion && (
        <div id="rc-edicion" className="rc-bloque">
          <SeccionFicha etiqueta="Edición" titulo="Grabación y edición">
            {!videos?.ok ? <p className="cj-aviso" role="status">No se pudieron leer los videos. Probá de nuevo en un minuto.</p> : <ConteoVideos videos={videos.v} fila={fila} />}
            <p><Link className="cj-enlace" href={`/clientes/edicion?vista=estado&cliente=${id}${demo ? '&demo=1' : ''}`}>Abrir en Edición</Link></p>
          </SeccionFicha>
        </div>
      )}

      {ver.anuncios && (
        <div id="rc-anuncios" className="rc-bloque">
          <SeccionFicha etiqueta="Anuncios" titulo="Campaña en Meta">
            {meta ? (
              <dl className="rc-datos">
                <div><dt className="cj-etiqueta">Campaña</dt><dd>{meta.activa ? 'Activa' : 'Sin anuncios activos'}</dd></div>
                <div><dt className="cj-etiqueta">Semáforo</dt><dd>{meta.semaforo ? <span className={`rc-semaforo rc-semaforo--${meta.semaforo}`}>{meta.semaforo}</span> : '—'}</dd></div>
                <div><dt className="cj-etiqueta">Último lanzamiento</dt><dd>{meta.ultimoLanzamiento ? `${meta.lanzamientoAprox ? '≈ ' : ''}${fechaCorta(meta.ultimoLanzamiento)}` : '—'}</dd></div>
                {meta.aGrabar && <div><dt className="cj-etiqueta">Pide guiones</dt><dd>{meta.aGrabar === 'quema' ? 'Los anuncios se están quemando' : 'Lo que corre no rinde'}</dd></div>}
              </dl>
            ) : <p className="cj-parrafo cj-texto-2">El tablero de Meta no tiene una cuenta con campaña de este cliente (o Meta tardó en responder).</p>}
            <p><a className="cj-enlace" href="/anuncios">Abrir el tablero de anuncios</a></p>
          </SeccionFicha>
        </div>
      )}

      {ver.referidos && (
        <div id="rc-referidos" className="rc-bloque">
          <PanelReferidosFicha f={ficha} />
          <Creditos f={ficha} sufijo={sufijo} puedeCanjear={rolPuedeCanjear(quien.rol)} demo={demo} />
        </div>
      )}

      <div id="rc-notas" className="rc-bloque">
        <Notas f={ficha} puedeEditarCliente={puedeHacerAcciones(quien.email)} />
      </div>
    </div>
  )
}

/** Mini recorrido arriba de la tarjeta: dónde está el cliente entre Alta y Éxito (o en qué cierre). */
function Recorrido({ fila, dia1, demo }: { fila: FilaRecorrido; dia1: string | null; demo: boolean }) {
  const pasos = ETAPAS.filter(e => !ETAPAS_CIERRE.includes(e))
  const actual = pasos.indexOf(fila.etapa)
  return (
    <div className="rc-recorrido">
      <p className="rc-recorrido__etapa">
        <span className={`rc-chip rc-chip--${fila.etapa}`}>{NOMBRE_ETAPA[fila.etapa]}</span>
        <span className="cj-texto-2">{fila.detalle}</span>
      </p>
      {fila.etapa !== 'pausa' && fila.etapa !== 'baja' && <CorregirEtapa idCrm={fila.id} etapa={fila.etapa} manual={!!fila.corregida} automatica={fila.automatica ?? null} demo={demo} />}
      {actual >= 0 && <p className="rc-progreso">Etapa {actual + 1} de {pasos.length}<span className="rc-progreso__barra" style={{ '--avance': (actual + 1) / pasos.length } as CSSProperties} aria-hidden /></p>}
      {actual >= 0 && (
        <ol className="rc-pasos" aria-label={`Recorrido: etapa ${actual + 1} de ${pasos.length}`}>
          {pasos.map((e, i) => (
            <li key={e} className={i < actual ? 'rc-paso rc-paso--hecho' : i === actual ? 'rc-paso rc-paso--actual' : 'rc-paso'} aria-current={i === actual ? 'step' : undefined}>
              <span className="rc-paso__punto" aria-hidden />
              <span className="rc-paso__nombre">{NOMBRE_ETAPA[e]}</span>
            </li>
          ))}
        </ol>
      )}
      <dl className="rc-datos">
        <div><dt className="cj-etiqueta">En la etapa</dt><dd>{fila.diasEtapa === null ? '—' : `${fila.diasEtapa} ${fila.diasEtapa === 1 ? 'día' : 'días'}`}</dd></div>
        <div><dt className="cj-etiqueta">Entró</dt><dd>{dia1 ? fechaCorta(dia1) : '—'}{fila.diasCliente !== null ? ` · hace ${fila.diasCliente} ${fila.diasCliente === 1 ? 'día' : 'días'}` : ''}</dd></div>
        <div><dt className="cj-etiqueta">Closer</dt><dd>{fila.closer || '—'}</dd></div>
        <div><dt className="cj-etiqueta">Contento</dt><dd>{fila.contento === null ? 'Sin puntaje' : fila.contento ? 'Sí' : 'No'}</dd></div>
        <div><dt className="cj-etiqueta">Fuente de la etapa</dt><dd title={AYUDA_ETAPA[fila.etapa]}>{NOMBRE_FUENTE[fila.fuente]}</dd></div>
      </dl>
    </div>
  )
}

function ResumenKickoff({ k }: { k: KickoffPorLanzar }) {
  // Defensivo: la ficha sale de un jsonb que puede venir de una versión vieja del bot (revisión del Hub)
  const frenan = (Array.isArray(k.frenos) ? k.frenos : []).filter(f => f?.frena)
  const rama = k.rama ?? { nombre: null, texto: '', subramas: [] }
  const zona = k.zona ?? { lugares: [], descripcion: '', radioKm: null, presentarse: null, mapa: null }
  const presupuesto = k.presupuesto ?? { texto: '', aConfirmar: false }
  const lanzamiento = k.lanzamiento ?? { fecha: null, texto: '' }
  return (
    <dl className="rc-datos rc-datos--ancho">
      <div><dt className="cj-etiqueta">Llamada</dt><dd>{k.fecha ?? '—'}{k.fathom && <> · <a className="cj-enlace" href={k.fathom} target="_blank" rel="noreferrer">grabación</a></>}</dd></div>
      <div><dt className="cj-etiqueta">Ideas de guiones</dt><dd>{k.ideas || '—'}</dd></div>
      {rama.nombre && <div><dt className="cj-etiqueta">Rama</dt><dd>{rama.nombre}{rama.subramas?.length ? ` · ${rama.subramas.join(', ')}` : ''}</dd></div>}
      <div><dt className="cj-etiqueta">Zona</dt><dd>{zona.lugares?.length ? zona.lugares.join(', ') : zona.descripcion || '—'}{zona.radioKm ? ` · ${zona.radioKm} km` : ''}</dd></div>
      <div><dt className="cj-etiqueta">Presupuesto</dt><dd>{presupuesto.texto || '—'}{presupuesto.aConfirmar ? ' (a confirmar)' : ''}</dd></div>
      <div><dt className="cj-etiqueta">Lanzamiento</dt><dd>{lanzamiento.fecha ? fechaCorta(lanzamiento.fecha) : lanzamiento.texto || '—'}</dd></div>
      <div className="rc-datos__ancho"><dt className="cj-etiqueta">Lo que frena</dt><dd>{frenan.length ? frenan.map(f => `${f.nombre}: ${f.detalle}`).join(' · ') : 'Nada: listo para armar'}</dd></div>
    </dl>
  )
}

function ConteoVideos({ videos, fila }: { videos: FilaTablero[]; fila: FilaRecorrido }) {
  if (!videos.length) return <p className="cj-parrafo cj-texto-2">{fila.etapa === 'grabacion' || fila.etapa === 'edicion' ? fila.detalle : 'Sin videos en el tablero de Edición.'}</p>
  const cuenta = new Map<EstadoVideo, number>()
  for (const v of videos) cuenta.set(v.estado, (cuenta.get(v.estado) ?? 0) + 1)
  return (
    <ul className="rc-conteo">
      {ESTADOS_VIDEO.filter(e => cuenta.get(e)).map(e => (
        <li key={e}><span className="rc-conteo__n">{cuenta.get(e)}</span><span>{ETIQUETA_VIDEO[e]}</span></li>
      ))}
    </ul>
  )
}

// ?demo=1: una tanda ficticia según la etapa de ejemplo (no toca la base)
function tandasDemo(fila: FilaRecorrido): FilaTanda[] {
  if (!['guiones', 'grabacion', 'edicion', 'por_lanzar', 'lanzado', 'exito', 'renovacion'].includes(fila.etapa)) return []
  const estado = fila.etapa === 'guiones' ? 'con_notas' : 'enviada'
  const hoy = new Date().toISOString()
  return [{
    id: 1, recording_id: 1, tanda: 1, id_crm: fila.id, cliente: fila.nombre, ciudad: null, estado, mercado: null, plan: null,
    guiones: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [String(n), {} as FilaTanda['guiones'][string]])),
    aprobacion: null, doc: null, whatsapp: null, notas: [], aviso_discord: null, error: null, tokens_in: 0, tokens_out: 0, version: null, creado: hoy, actualizado: hoy,
  }]
}
