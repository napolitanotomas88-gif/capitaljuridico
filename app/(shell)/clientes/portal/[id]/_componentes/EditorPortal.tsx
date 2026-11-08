'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { Boton } from '@/components/ui'
import { ESTADOS_ETAPA, fechaLarga, NOMBRE_ESTADO_ETAPA, NOMBRE_SECCION_PORTAL, SECCIONES_PORTAL, TOPES, type DatosPortal, type EstadoEtapa, type ModoCasos, type ProgresoCasos } from '@/lib/clientes/portal/modelo'

// Panel del EQUIPO para armar el portal del cliente (2/11/2026). Guarda todo junto con la versión que leyó: si otra persona
// guardó en el medio, avisa y no pisa. Solo lo ve el equipo (la página no lo dibuja para el cliente y la API le da 403).

type Props = { id: string; inicial: DatosPortal; version: number; nombreCRM: string }

const quitar = <T,>(xs: T[], i: number) => xs.filter((_, j) => j !== i)
const mover = <T,>(xs: T[], i: number, d: -1 | 1) => {
  const j = i + d
  if (j < 0 || j >= xs.length) return xs
  const c = [...xs];
  [c[i], c[j]] = [c[j], c[i]]
  return c
}

export function EditorPortal({ id, inicial, version: versionInicial, nombreCRM }: Props) {
  const router = useRouter()
  const base = useId()
  const [d, setD] = useState<DatosPortal>(inicial)
  const [version, setVersion] = useState(versionInicial)
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const bloqueado = version < 0

  const cambiar = (parcial: Partial<DatosPortal>) => { setD(x => ({ ...x, ...parcial })); setEstado(null) }

  async function guardar() {
    setGuardando(true)
    setEstado(null)
    try {
      const r = await fetch(`/api/clientes/portal/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, datos: d }) })
      const cuerpo = (await r.json().catch(() => ({}))) as { version?: number; error?: string }
      if (!r.ok) { setEstado({ tipo: 'error', texto: cuerpo.error ?? 'No se pudo guardar.' }); return }
      setVersion(cuerpo.version ?? version + 1)
      setEstado({ tipo: 'ok', texto: 'Guardado. El cliente ya lo ve así.' })
      router.refresh()
    } catch {
      setEstado({ tipo: 'error', texto: 'No se pudo guardar (sin conexión). Probá de nuevo.' })
    } finally {
      setGuardando(false)
    }
  }

  const campo = (sufijo: string) => `${base}-${sufijo}`
  const prog = (parcial: Partial<ProgresoCasos>) => cambiar({ progreso: { ...d.progreso, ...parcial } })
  // Número entero o null (campo vacío). Lo que no es número queda como está y lo rechaza el servidor con su motivo.
  const ent = (v: string): number | null => (v.trim() === '' ? null : Number(v))
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  return (
    <form className="cj-formulario cj-panel" style={{ maxWidth: 'none' }} onSubmit={e => { e.preventDefault(); void guardar() }} noValidate>
      {bloqueado && <p className="cj-formulario__error" role="alert">No se pudo leer lo guardado: recargá la página antes de editar (así no se pisa nada).</p>}

      <div className="cj-formulario__campo">
        <label htmlFor={campo('nombre')} className="cj-etiqueta">Cómo lo saludamos</label>
        <input id={campo('nombre')} className="cj-campo__entrada" value={d.nombre} maxLength={TOPES.nombre} placeholder={nombreCRM} onChange={e => cambiar({ nombre: e.target.value })} />
        <span className="cj-formulario__ayuda">Vacío = el nombre del CRM. Es el título que ve el cliente.</span>
      </div>

      <fieldset className="cj-formulario" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend className="cj-etiqueta cj-etiqueta--laton">Qué secciones ve el cliente</legend>
        <span className="cj-formulario__ayuda">El resumen de arriba siempre se ve. Lo que destildes queda guardado acá pero el cliente no lo ve.</span>
        <div className="cj-fila" style={{ gap: '4px 20px', flexWrap: 'wrap' }}>
          {SECCIONES_PORTAL.map(k => (
            <label key={k} className="cj-fila" style={{ gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={d.secciones[k]} onChange={e => cambiar({ secciones: { ...d.secciones, [k]: e.target.checked } })} />
              {NOMBRE_SECCION_PORTAL[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="cj-formulario" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend className="cj-etiqueta cj-etiqueta--laton">Objetivo</legend>
        <div className="cj-formulario__campo">
          <label htmlFor={campo('obj')} className="cj-etiqueta">El objetivo (las líneas que empiezan con «•» o «-» se ven como viñetas)</label>
          <textarea id={campo('obj')} className="cj-campo__entrada" rows={6} maxLength={TOPES.objetivo} value={d.objetivo.texto} onChange={e => cambiar({ objetivo: { ...d.objetivo, texto: e.target.value } })} />
        </div>
        <div className="cj-fila" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div className="cj-formulario__campo" style={{ flex: '2 1 240px' }}>
            <label htmlFor={campo('met')} className="cj-etiqueta">Cómo lo medimos</label>
            <input id={campo('met')} className="cj-campo__entrada" maxLength={TOPES.metrica} placeholder="Ej.: 10.000 seguidores · 20 consultas por mes" value={d.objetivo.metrica} onChange={e => cambiar({ objetivo: { ...d.objetivo, metrica: e.target.value } })} />
          </div>
          <div className="cj-formulario__campo" style={{ flex: '1 1 160px' }}>
            <label htmlFor={campo('fobj')} className="cj-etiqueta">Para cuándo</label>
            <input id={campo('fobj')} type="date" className="cj-campo__entrada" value={d.objetivo.fecha ?? ''} onChange={e => cambiar({ objetivo: { ...d.objetivo, fecha: e.target.value || null } })} />
          </div>
        </div>
      </fieldset>

      <fieldset className="cj-formulario" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend className="cj-etiqueta cj-etiqueta--laton">Casos conseguidos (barra de progreso)</legend>
        <span className="cj-formulario__ayuda">Casos conseguidos ACUMULADOS desde que arrancamos. Al guardar, el conteo queda en el historial con su fecha (uno por día): de ahí salen los casos de cada mes del reporte. «Por mes»: la barra muestra los casos del mes en curso contra el objetivo, que pasa a ser por mes.</span>
        <div className="cj-fila" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div className="cj-formulario__campo" style={{ flex: '1 1 160px' }}>
            <label htmlFor={campo('modo')} className="cj-etiqueta">Cómo se mide</label>
            <select id={campo('modo')} className="cj-campo__entrada" value={d.progreso.modo} onChange={e => prog({ modo: e.target.value as ModoCasos })}>
              <option value="acumulado">Acumulado</option>
              <option value="mensual">Por mes</option>
            </select>
          </div>
          <div className="cj-formulario__campo" style={{ flex: '1 1 140px' }}>
            <label htmlFor={campo('casos')} className="cj-etiqueta">Casos conseguidos hoy</label>
            <input id={campo('casos')} type="number" inputMode="numeric" min={0} step={1} className="cj-campo__entrada" value={d.progreso.casos ?? ''} onChange={e => prog({ casos: ent(e.target.value), actualizado: d.progreso.actualizado ?? hoy })} />
          </div>
          <div className="cj-formulario__campo" style={{ flex: '1 1 160px' }}>
            <label htmlFor={campo('casosf')} className="cj-etiqueta">Fecha del conteo</label>
            <input id={campo('casosf')} type="date" className="cj-campo__entrada" value={d.progreso.actualizado ?? ''} onChange={e => prog({ actualizado: e.target.value || null })} />
          </div>
          <div className="cj-formulario__campo" style={{ flex: '1 1 140px' }}>
            <label htmlFor={campo('meta')} className="cj-etiqueta">Objetivo final</label>
            <input id={campo('meta')} type="number" inputMode="numeric" min={1} step={1} className="cj-campo__entrada" placeholder="Ej.: 500" value={d.progreso.meta ?? ''} onChange={e => prog({ meta: ent(e.target.value) })} />
          </div>
        </div>
        <div className="cj-fila" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div className="cj-formulario__campo" style={{ flex: '1 1 140px' }}>
            <label htmlFor={campo('hito')} className="cj-etiqueta">Marca intermedia (casos)</label>
            <input id={campo('hito')} type="number" inputMode="numeric" min={1} step={1} className="cj-campo__entrada" placeholder="Ej.: 200" value={d.progreso.hito?.casos ?? ''} onChange={e => { const n = ent(e.target.value); prog({ hito: n === null ? null : { casos: n, fecha: d.progreso.hito?.fecha ?? null } }) }} />
          </div>
          <div className="cj-formulario__campo" style={{ flex: '1 1 160px' }}>
            <label htmlFor={campo('hitof')} className="cj-etiqueta">Para cuándo</label>
            <input id={campo('hitof')} type="date" className="cj-campo__entrada" disabled={!d.progreso.hito} value={d.progreso.hito?.fecha ?? ''} onChange={e => d.progreso.hito && prog({ hito: { ...d.progreso.hito, fecha: e.target.value || null } })} />
          </div>
        </div>
        {d.progreso.historial.length > 0 && (
          <details className="cj-detalles">
            <summary>Historial de conteos ({d.progreso.historial.length})</summary>
            <ul className="cj-lista" style={{ marginTop: 8 }}>
              {[...d.progreso.historial].reverse().map(h => (
                <li key={h.fecha} className="cj-fila" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <span>{fechaLarga(h.fecha)}: <strong>{h.casos}</strong> casos</span>
                  <Boton variante="secundario" onClick={() => prog({ historial: d.progreso.historial.filter(x => x.fecha !== h.fecha) })} aria-label={`Quitar el conteo del ${fechaLarga(h.fecha)}`}>Quitar</Boton>
                </li>
              ))}
            </ul>
          </details>
        )}
      </fieldset>

      <fieldset className="cj-formulario" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend className="cj-etiqueta cj-etiqueta--laton">Reporte de anuncios (Meta)</legend>
        <span className="cj-formulario__ayuda">Las cuentas publicitarias del cliente (act_ y los números). Solo las lee el servidor, una vez por hora; el cliente no ve los IDs ni puede pedir otra cuenta.</span>
        {d.reporte.cuentas.map((c, i) => (
          <div key={i} className="cj-fila" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="cj-formulario__campo" style={{ flex: '3 1 240px' }}>
              <label htmlFor={campo(`cta-${i}`)} className="cj-etiqueta">Cuenta {i + 1}</label>
              <input id={campo(`cta-${i}`)} className="cj-campo__entrada" value={c} placeholder="act_123456789" spellCheck={false} onChange={e => cambiar({ reporte: { ...d.reporte, cuentas: d.reporte.cuentas.map((y, j) => (j === i ? e.target.value.trim() : y)) } })} />
            </div>
            <Boton variante="secundario" onClick={() => cambiar({ reporte: { ...d.reporte, cuentas: quitar(d.reporte.cuentas, i) } })} aria-label={`Quitar la cuenta ${i + 1}`}>Quitar</Boton>
          </div>
        ))}
        {d.reporte.cuentas.length < TOPES.cuentas && <div><Boton variante="secundario" onClick={() => cambiar({ reporte: { ...d.reporte, cuentas: [...d.reporte.cuentas, ''] } })}>Agregar cuenta</Boton></div>}
        <div className="cj-formulario__campo" style={{ maxWidth: 260 }}>
          <label htmlFor={campo('valor')} className="cj-etiqueta">Valor promedio por caso (USD)</label>
          <input id={campo('valor')} type="number" inputMode="decimal" min={1} step="any" className="cj-campo__entrada" value={d.reporte.valorCaso} onChange={e => cambiar({ reporte: { ...d.reporte, valorCaso: Number(e.target.value) } })} />
          <span className="cj-formulario__ayuda">Con esto se estiman ingresos y profit (casos × valor).</span>
        </div>
      </fieldset>

      <fieldset className="cj-formulario" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend className="cj-etiqueta cj-etiqueta--laton">Plan por etapas ({d.etapas.length}/{TOPES.etapas})</legend>
        {d.etapas.map((e, i) => (
          <div key={i} className="cj-panel" style={{ padding: 16 }}>
            <div className="cj-fila" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="cj-formulario__campo" style={{ flex: '3 1 220px' }}>
                <label htmlFor={campo(`et-${i}`)} className="cj-etiqueta">Etapa {i + 1}</label>
                <input id={campo(`et-${i}`)} className="cj-campo__entrada" maxLength={TOPES.titulo} value={e.titulo} placeholder="Ej.: Definir los 3 temas que te posicionan" onChange={x => cambiar({ etapas: d.etapas.map((y, j) => (j === i ? { ...y, titulo: x.target.value } : y)) })} />
              </div>
              <div className="cj-formulario__campo" style={{ flex: '1 1 140px' }}>
                <label htmlFor={campo(`ee-${i}`)} className="cj-etiqueta">Estado</label>
                <select id={campo(`ee-${i}`)} className="cj-campo__entrada" value={e.estado} onChange={x => cambiar({ etapas: d.etapas.map((y, j) => (j === i ? { ...y, estado: x.target.value as EstadoEtapa } : y)) })}>
                  {ESTADOS_ETAPA.map(s => <option key={s} value={s}>{NOMBRE_ESTADO_ETAPA[s]}</option>)}
                </select>
              </div>
              <div className="cj-formulario__campo" style={{ flex: '1 1 140px' }}>
                <label htmlFor={campo(`ef-${i}`)} className="cj-etiqueta">Fecha</label>
                <input id={campo(`ef-${i}`)} type="date" className="cj-campo__entrada" value={e.fecha ?? ''} onChange={x => cambiar({ etapas: d.etapas.map((y, j) => (j === i ? { ...y, fecha: x.target.value || null } : y)) })} />
              </div>
            </div>
            <div className="cj-formulario__campo" style={{ marginTop: 12 }}>
              <label htmlFor={campo(`ed-${i}`)} className="cj-etiqueta">Qué hacemos en esta etapa</label>
              <textarea id={campo(`ed-${i}`)} className="cj-campo__entrada" rows={2} maxLength={TOPES.detalle} value={e.detalle} onChange={x => cambiar({ etapas: d.etapas.map((y, j) => (j === i ? { ...y, detalle: x.target.value } : y)) })} />
            </div>
            <div className="cj-formulario__acciones" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <Boton variante="secundario" onClick={() => cambiar({ etapas: mover(d.etapas, i, -1) })} disabled={i === 0} aria-label={`Subir la etapa ${i + 1}`}>Subir</Boton>
              <Boton variante="secundario" onClick={() => cambiar({ etapas: mover(d.etapas, i, 1) })} disabled={i === d.etapas.length - 1} aria-label={`Bajar la etapa ${i + 1}`}>Bajar</Boton>
              <Boton variante="secundario" onClick={() => cambiar({ etapas: quitar(d.etapas, i) })} aria-label={`Quitar la etapa ${i + 1}`}>Quitar</Boton>
            </div>
          </div>
        ))}
        {d.etapas.length < TOPES.etapas && <div><Boton variante="secundario" onClick={() => cambiar({ etapas: [...d.etapas, { titulo: '', detalle: '', estado: 'pendiente', fecha: null }] })}>Agregar etapa</Boton></div>}
      </fieldset>

      <fieldset className="cj-formulario" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend className="cj-etiqueta cj-etiqueta--laton">Próximos pasos ({d.proximos.length}/{TOPES.proximos})</legend>
        {d.proximos.map((x, i) => (
          <div key={i} className="cj-fila" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="cj-formulario__campo" style={{ flex: '3 1 240px' }}>
              <label htmlFor={campo(`pp-${i}`)} className="cj-etiqueta">Paso {i + 1}</label>
              <input id={campo(`pp-${i}`)} className="cj-campo__entrada" maxLength={TOPES.paso} value={x.texto} placeholder="Ej.: Grabar los 3 videos de la tanda 1" onChange={e => cambiar({ proximos: d.proximos.map((y, j) => (j === i ? { ...y, texto: e.target.value } : y)) })} />
            </div>
            <div className="cj-formulario__campo" style={{ flex: '1 1 140px' }}>
              <label htmlFor={campo(`pf-${i}`)} className="cj-etiqueta">Fecha</label>
              <input id={campo(`pf-${i}`)} type="date" className="cj-campo__entrada" value={x.fecha ?? ''} onChange={e => cambiar({ proximos: d.proximos.map((y, j) => (j === i ? { ...y, fecha: e.target.value || null } : y)) })} />
            </div>
            <label className="cj-fila" style={{ gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={x.hecho} onChange={e => cambiar({ proximos: d.proximos.map((y, j) => (j === i ? { ...y, hecho: e.target.checked } : y)) })} />
              Hecho (no se muestra)
            </label>
            <Boton variante="secundario" onClick={() => cambiar({ proximos: quitar(d.proximos, i) })} aria-label={`Quitar el paso ${i + 1}`}>Quitar</Boton>
          </div>
        ))}
        {d.proximos.length < TOPES.proximos && <div><Boton variante="secundario" onClick={() => cambiar({ proximos: [...d.proximos, { texto: '', fecha: null, hecho: false }] })}>Agregar paso</Boton></div>}
      </fieldset>

      <fieldset className="cj-formulario" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend className="cj-etiqueta cj-etiqueta--laton">Seguimiento y reuniones ({d.notas.length}/{TOPES.notas})</legend>
        <span className="cj-formulario__ayuda">Lo que vimos y acordamos en cada reunión. Lo lee el cliente: nada interno.</span>
        {d.notas.map((n, i) => (
          <div key={i} className="cj-panel" style={{ padding: 16 }}>
            <div className="cj-fila" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="cj-formulario__campo" style={{ flex: '3 1 220px' }}>
                <label htmlFor={campo(`nt-${i}`)} className="cj-etiqueta">Título</label>
                <input id={campo(`nt-${i}`)} className="cj-campo__entrada" maxLength={TOPES.titulo} value={n.titulo} placeholder="Ej.: Reunión de estrategia" onChange={e => cambiar({ notas: d.notas.map((y, j) => (j === i ? { ...y, titulo: e.target.value } : y)) })} />
              </div>
              <div className="cj-formulario__campo" style={{ flex: '1 1 140px' }}>
                <label htmlFor={campo(`nf-${i}`)} className="cj-etiqueta">Fecha</label>
                <input id={campo(`nf-${i}`)} type="date" className="cj-campo__entrada" value={n.fecha ?? ''} onChange={e => cambiar({ notas: d.notas.map((y, j) => (j === i ? { ...y, fecha: e.target.value || null } : y)) })} />
              </div>
            </div>
            <div className="cj-formulario__campo" style={{ marginTop: 12 }}>
              <label htmlFor={campo(`nx-${i}`)} className="cj-etiqueta">Qué vimos</label>
              <textarea id={campo(`nx-${i}`)} className="cj-campo__entrada" rows={3} maxLength={TOPES.nota} value={n.texto} onChange={e => cambiar({ notas: d.notas.map((y, j) => (j === i ? { ...y, texto: e.target.value } : y)) })} />
            </div>
            <div className="cj-formulario__acciones" style={{ marginTop: 12 }}>
              <Boton variante="secundario" onClick={() => cambiar({ notas: quitar(d.notas, i) })} aria-label={`Quitar la nota ${i + 1}`}>Quitar</Boton>
            </div>
          </div>
        ))}
        {d.notas.length < TOPES.notas && <div><Boton variante="secundario" onClick={() => cambiar({ notas: [{ fecha: new Date().toISOString().slice(0, 10), titulo: '', texto: '' }, ...d.notas] })}>Agregar nota</Boton></div>}
      </fieldset>

      <div className="cj-formulario__acciones" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Boton type="submit" variante="marca" disabled={guardando || bloqueado}>{guardando ? 'Guardando…' : 'Guardar el portal'}</Boton>
        {estado && <p role={estado.tipo === 'error' ? 'alert' : 'status'} className={estado.tipo === 'error' ? 'cj-formulario__error' : 'cj-formulario__ayuda'} style={{ margin: 0 }}>{estado.texto}</p>}
      </div>
    </form>
  )
}
