import type { Metadata } from 'next'
import Link from 'next/link'
import { exigirAcceso } from '@/lib/auth/sesion'
import { Cifra, SeccionTitulo, Vacio } from '@/components/ui'
import { linkFathom } from '@/lib/fathomAnuncios/transcripcion'
import { hoyYMD, sumarDias } from '@/lib/eodSetter'
import { leerCierres } from '@/lib/trazabilidad/cierres'
import { listarLlamadas, type FilaLlamadaCloser, type RevisionLlamada } from '@/lib/trazabilidad/llamadasCloser'
import { agendaDeLlamada, duracionTexto, leadDeLlamada } from '@/lib/trazabilidad/llamadasCloserCalc'
import type { AgendaLigera } from '@/lib/trazabilidad/modelo'
import { guardarMarcaLlamada, prepararRevisionLlamada, traerLlamadasCloser } from '../acciones'
import { SubNav, fechaCorta, usd } from '../_componentes/comunes'
import { FormAccion } from '../_componentes/FormAccion'

export const metadata: Metadata = { title: 'Llamadas de closers · Trazabilidad' }
export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'
const diaAR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) : '')
const horaAR = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—')
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const RESULTADO: Record<RevisionLlamada['resultado'], string> = {
  cerro: 'Cerró', sena: 'Dejó seña', seguimiento: 'Seguimiento', no_califica: 'No califica', no_se_presento: 'No se presentó', reagenda: 'Reagenda', sin_definir: 'Sin definir',
}
// Las de la cuenta de Tomás son onboardings y reuniones de clientes: se ven eligiéndolas, no por defecto
const FUERA_POR_DEFECTO = new Set(['Tomas'])
const PERIODOS = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['2d', 'Ayer y hoy'], ['7d', '7 días'], ['30d', '30 días']] as const

type Busqueda = Promise<{ p?: string; c?: string; v?: string }>

// Llamadas de los closers para revisar todos los días: salen de la cuenta de Fathom de cada uno, con su fila del CRM, una
// revisión en español (qué pasó, precio, objeciones y momentos con el minuto) y la marca de revisada con la nota de Tomás.
export default async function LlamadasPage({ searchParams }: { searchParams: Busqueda }) {
  await exigirAcceso('trazabilidad')
  const q = await searchParams
  const hoy = hoyYMD()
  const p = PERIODOS.some(([k]) => k === q.p) ? q.p! : '2d'
  const desde = p === 'hoy' ? hoy : p === 'ayer' || p === '2d' ? sumarDias(hoy, -1) : p === '7d' ? sumarDias(hoy, -6) : sumarDias(hoy, -29)
  const hasta = p === 'ayer' ? sumarDias(hoy, -1) : hoy
  let filas: FilaLlamadaCloser[] = []
  let agendas: AgendaLigera[] = []
  let error = ''
  try {
    const [l, crm] = await Promise.all([listarLlamadas(new Date(Date.parse(`${desde}T00:00:00-03:00`)).toISOString()), leerCierres().catch(() => ({ agendas: [] as AgendaLigera[] }))])
    filas = l
    agendas = crm.agendas
  } catch (e) {
    error = (e as Error).message
  }
  const enPeriodo = filas.filter((f) => f.externa && diaAR(f.inicio) >= desde && diaAR(f.inicio) <= hasta)
  const closers = [...new Set(enPeriodo.map((f) => f.closer))].sort()
  const c = q.c && closers.includes(q.c) ? q.c : 'todos'
  const soloPendientes = q.v === 'pendientes'
  const visibles = enPeriodo
    .filter((f) => (c === 'todos' ? !FUERA_POR_DEFECTO.has(f.closer) : f.closer === c))
    .filter((f) => !soloPendientes || !f.revisada)
  const porDia = new Map<string, FilaLlamadaCloser[]>()
  for (const f of visibles) porDia.set(diaAR(f.inicio), [...(porDia.get(diaAR(f.inicio)) ?? []), f])
  const href = (o: Partial<{ p: string; c: string; v: string }>) => {
    const s = new URLSearchParams({ p, c, v: soloPendientes ? 'pendientes' : 'todas', ...o })
    return `/trazabilidad/llamadas?${s}`
  }

  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Trazabilidad" titulo="Llamadas de closers" acciones={<FormAccion accion={traerLlamadasCloser} boton="Traer llamadas nuevas" pendiente="Trayendo de Fathom…" className="" />} />
      <SubNav actual="/trazabilidad/llamadas" />
      <p className="traz-texto">
        Las llamadas con leads de cada closer, sacadas de su cuenta de Fathom. Se traen solas a las 7:30 y con el botón. Cada una
        trae su fila del CRM y una revisión en español que <strong>describe</strong> lo que pasó, con el minuto de cada momento para ir directo a la grabación.
        El análisis es tuyo: marcala como revisada y dejá tu nota.
      </p>
      {error && <p className="traz-error" role="alert">No se pudieron leer las llamadas: {error}</p>}

      <div className="cj-rejilla">
        <Cifra etiqueta="Llamadas" valor={visibles.length} contexto={`${fechaCorta(desde)}${desde !== hasta ? ` al ${fechaCorta(hasta)}` : ''}`} />
        <Cifra etiqueta="Revisadas" valor={`${visibles.filter((f) => f.revisada).length}/${visibles.length}`} contexto="por vos" />
        <Cifra etiqueta="Con revisión IA" valor={`${visibles.filter((f) => f.revision).length}/${visibles.length}`} contexto="las de menos de 2 min no se revisan" />
      </div>

      <div className="cj-pila cj-pila--chica">
        <div className="cj-fila" role="group" aria-label="Período">
          {PERIODOS.map(([k, t]) => <Link key={k} className="cj-chip" aria-current={p === k ? 'page' : undefined} href={href({ p: k })}>{t}</Link>)}
        </div>
        <div className="cj-fila" role="group" aria-label="Closer">
          <Link className="cj-chip" aria-current={c === 'todos' ? 'page' : undefined} href={href({ c: 'todos' })}>Todos los closers</Link>
          {closers.map((n) => <Link key={n} className="cj-chip" aria-current={c === n ? 'page' : undefined} href={href({ c: n })}>{n} ({enPeriodo.filter((f) => f.closer === n).length})</Link>)}
        </div>
        <div className="cj-fila" role="group" aria-label="Estado">
          <Link className="cj-chip" aria-current={!soloPendientes ? 'page' : undefined} href={href({ v: 'todas' })}>Todas</Link>
          <Link className="cj-chip" aria-current={soloPendientes ? 'page' : undefined} href={href({ v: 'pendientes' })}>Sin revisar</Link>
        </div>
      </div>

      {!visibles.length && <Vacio frase={filas.length ? 'No hay llamadas en este período con este filtro.' : 'Todavía no se trajo ninguna llamada: tocá «Traer llamadas nuevas».'} />}

      {[...porDia].map(([dia, ls]) => (
        <section key={dia} className="cj-pila cj-pila--chica" aria-label={dia}>
          <SeccionTitulo nivel={2} etiqueta={`${ls.length} llamada${ls.length === 1 ? '' : 's'}`} titulo={`${DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${fechaCorta(dia)}`} />
          {ls.map((f) => <Tarjeta key={f.recordingId} f={f} agenda={agendaDe(f, agendas)} />)}
        </section>
      ))}
    </div>
  )
}

// Las «Impromptu» no traen invitados: se usa el nombre que la revisión sacó de la conversación
function agendaDe(f: FilaLlamadaCloser, agendas: AgendaLigera[]): AgendaLigera | null {
  const nombre = f.revision?.lead.nombre
  return agendaDeLlamada(f, agendas) ?? (nombre ? agendaDeLlamada({ ...f, invitados: [...f.invitados, { nombre, email: '', externo: true }] }, agendas) : null)
}

const nombreLead = (f: FilaLlamadaCloser, agenda: AgendaLigera | null) => agenda?.nombre || f.revision?.lead.nombre || leadDeLlamada(f)

function Tarjeta({ f, agenda }: { f: FilaLlamadaCloser; agenda: AgendaLigera | null }) {
  const r = f.revision
  const ir = (min: string) => <a className="traz-link" href={linkFathom(f.url, min)} target="_blank" rel="noreferrer">{min.replace(/^00:/, '')}</a>
  return (
    <article className={`cj-panel cj-pila cj-pila--chica${f.revisada ? ' traz-revisada' : ''}`}>
      <div className="cj-fila traz-llamada-cab">
        <strong>{nombreLead(f, agenda)}</strong>
        <span className="traz-nota">{f.closer} · {horaAR(f.inicio)} · {duracionTexto(f.duracionS)}</span>
        {r && <span className="traz-etiqueta">{RESULTADO[r.resultado]}</span>}
        {f.revisada && <span className="traz-etiqueta traz-etiqueta--gatillo">Revisada</span>}
        <a className="cj-enlace" href={f.url} target="_blank" rel="noreferrer">Abrir en Fathom</a>
      </div>
      <p className="traz-nota">
        CRM: {agenda ? <>{agenda.nombre} · {agenda.pestana} · {agenda.situacion || 'sin situación'}{agenda.cobrado ? ` · ${usd(agenda.cobrado)}` : ''}</> : 'no encontré su fila (mail o nombre distinto)'}
      </p>
      {r ? (
        <div className="cj-pila cj-pila--chica">
          <p className="traz-texto">{r.resumen}</p>
          <dl className="traz-dl">
            <dt>Precio</dt><dd>{r.precio_presentado ? `Se presentó${r.monto_mencionado ? ` (${r.monto_mencionado})` : ''}` : 'No se presentó'}</dd>
            {r.lead.dolor && <><dt>Dolor</dt><dd>{r.lead.dolor}</dd></>}
            {r.lead.objetivo && <><dt>Objetivo</dt><dd>{r.lead.objetivo}</dd></>}
            {r.proximos_pasos && <><dt>Próximos pasos</dt><dd>{r.proximos_pasos}</dd></>}
          </dl>
          {r.objeciones.length > 0 && (
            <div><span className="cj-etiqueta">Objeciones</span>
              <ul className="traz-ol">{r.objeciones.map((o, i) => <li key={i}>{ir(o.minuto)} · {o.objecion} <span className="traz-cita">“{o.cita}”</span><br /><span className="traz-nota">Respuesta: {o.respuesta}</span></li>)}</ul>
            </div>
          )}
          {r.momentos.length > 0 && (
            <div><span className="cj-etiqueta">Momentos para mirar</span>
              <ul className="traz-ol">{r.momentos.map((m, i) => <li key={i}>{ir(m.minuto)} · {m.que_paso} <span className="traz-nota">— {m.por_que_mirarlo}</span></li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <div className="cj-fila">
          <span className="traz-nota">{f.revisionError ? `La revisión falló: ${f.revisionError}` : (f.duracionS ?? 0) < 120 ? 'Llamada de menos de 2 minutos: sin revisión.' : 'Revisión pendiente (se arma sola o con el botón).'}</span>
          <FormAccion accion={prepararRevisionLlamada} boton="Preparar revisión" pendiente="Leyendo la llamada…" className="">
            <input type="hidden" name="recording" value={f.recordingId} />
          </FormAccion>
        </div>
      )}
      {f.resumenFathom && (
        <details><summary className="cj-etiqueta">Resumen de Fathom (inglés)</summary><pre className="traz-pre">{f.resumenFathom}</pre></details>
      )}
      <FormAccion accion={guardarMarcaLlamada} boton="Guardar" className="traz-form">
        <input type="hidden" name="recording" value={f.recordingId} />
        <label className="cj-fila traz-nota"><input type="checkbox" name="revisada" defaultChecked={f.revisada} /> Revisada{f.revisadaEn ? ` (${fechaCorta(diaAR(f.revisadaEn))})` : ''}</label>
        <textarea name="nota" defaultValue={f.nota} placeholder="Tu nota: qué hizo bien, qué cambiar, qué ángulo apareció…" aria-label="Nota" className="traz-nota-campo" />
      </FormAccion>
    </article>
  )
}
