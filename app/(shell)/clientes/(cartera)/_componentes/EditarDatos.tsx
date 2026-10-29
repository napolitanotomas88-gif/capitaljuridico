'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import './acciones.css'
import type { CambioPlan, CampoEditable, ClaveCampo, ModoAcciones, RespuestaAccion, RespuestaCampos } from '@/lib/clientes/acciones/tipos'

// Editar los datos del cliente desde la tarjeta (27/10/2026, Tomás: "literalmente en la tarjeta poder modificar todo del
// cliente"). La lista blanca de campos, sus tipos y la celda de cada uno son de CONSULTOR (lib/clientes/acciones/campos.ts,
// GET /api/clientes/<id>/acciones?campos=1); el cambio va por el mismo POST de acciones ({ tipo: 'datos', cambios }), con
// Revisar → Confirmar y Deshacer la última desde el historial. En sombra se registra sin escribir el CRM.
// Los campos se leen recién al abrir el editor (no en cada tarjeta).

type Valores = Partial<Record<ClaveCampo, string>>
const fechaAR = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v)
const mostrar = (c: CampoEditable, v: string) => (v === '' ? '—' : c.tipo === 'fecha' ? fechaAR(v) : v)

export function EditarDatos({ idCrm, demo, alGuardar, alPendiente }: { idCrm: string; demo: boolean; alGuardar?: () => void; alPendiente?: (pendiente: boolean) => void }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [campos, setCampos] = useState<CampoEditable[] | null>(null)
  const [modo, setModo] = useState<ModoAcciones>('sombra')
  const [valores, setValores] = useState<Valores>({})
  const [motivo, setMotivo] = useState('')
  const [revisando, setRevisando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [intentoPendiente, setIntentoPendiente] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string; plan?: CambioPlan[] } | null>(null)
  const [, empezar] = useTransition()
  const clave = useRef<string | null>(null)
  const enVuelo = useRef(false)
  const base = `/api/clientes/${encodeURIComponent(idCrm)}/acciones`

  const abrir = async () => {
    if (enVuelo.current || intentoPendiente) return
    clave.current = null
    setAbierto(true); setMensaje(null); setRevisando(false); setValores({}); setMotivo('')
    if (demo) { setCampos(camposDemo()); return }
    setCampos(null)
    try {
      const r = await fetch(`${base}?campos=1`, { cache: 'no-store' })
      const j = (await r.json()) as RespuestaCampos
      if (!r.ok || !j.ok) throw new Error(j.mensaje ?? String(r.status))
      setCampos(j.campos); setModo(j.modo)
    } catch (e) { setCampos([]); setMensaje({ tipo: 'error', texto: `No se pudieron leer los datos (${(e as Error).message}).` }) }
  }

  const cambios = (campos ?? []).filter(c => valores[c.campo] !== undefined && valores[c.campo] !== c.valor).map(c => ({ c, valor: valores[c.campo]! }))

  const confirmar = async () => {
    if (!cambios.length || enVuelo.current) return
    if (demo) { setMensaje({ tipo: 'error', texto: 'Con los datos de ejemplo (?demo=1) no se registra nada.' }); return }
    clave.current ??= `ui_${crypto.randomUUID()}`
    enVuelo.current = true; setIntentoPendiente(true); alPendiente?.(true)
    setEnviando(true); setMensaje(null)
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clave: clave.current, tipo: 'datos', cambios: cambios.map(x => ({ campo: x.c.campo, valor: x.valor })), motivo: motivo.trim() || undefined }) })
      const j = (await r.json().catch(() => ({}))) as RespuestaAccion
      if (!r.ok || !j.ok) {
        if (r.status >= 400 && r.status < 500 && ![408, 429].includes(r.status)) { setIntentoPendiente(false); alPendiente?.(false) }
        setMensaje({ tipo: 'error', texto: j.mensaje ?? 'No se pudo comprobar el resultado. Reintentá este mismo pedido.' }); return
      }
      setIntentoPendiente(false); alPendiente?.(false)
      setMensaje({ tipo: 'ok', texto: j.accion?.resumen ?? 'Cambios registrados.', plan: j.plan ?? j.accion?.plan })
      setAbierto(false); setRevisando(false)
      alGuardar?.()
      empezar(() => router.refresh())
    } catch { setMensaje({ tipo: 'error', texto: 'Sin conexión. Probá de nuevo.' }) }
    finally { enVuelo.current = false; setEnviando(false) }
  }

  const campo = (c: CampoEditable) => {
    const v = valores[c.campo] ?? c.valor
    const set = (x: string) => setValores(o => ({ ...o, [c.campo]: x }))
    const comun = { id: `ed-${idCrm}-${c.campo}`, className: 'rc-input', value: v, disabled: revisando || enviando || intentoPendiente, onChange: (e: { target: { value: string } }) => set(e.target.value) }
    return (
      <label key={c.campo} className={`rc-campo ed-campo${c.tipo === 'textoLargo' ? ' ed-campo--ancho' : ''}${v !== c.valor ? ' ed-campo--cambiado' : ''}`} htmlFor={comun.id}>
        <span className="cj-etiqueta">{c.etiqueta}{c.soloFinanzas ? ' · Finanzas' : ''}</span>
        {c.tipo === 'textoLargo' ? <textarea {...comun} rows={3} maxLength={c.max} />
          : c.tipo === 'opcion' ? <select {...comun}>{(c.opciones ?? []).map(o => <option key={o} value={o}>{o || '(vacío)'}</option>)}</select>
          : <input {...comun} type={c.tipo === 'fecha' ? 'date' : c.tipo === 'numero' ? 'number' : 'text'} min={c.tipo === 'numero' ? 1 : undefined} max={c.tipo === 'numero' ? 10 : undefined} maxLength={c.tipo === 'texto' ? c.max : undefined} />}
        {c.aviso && <span className="cj-texto-2">{c.aviso}</span>}
      </label>
    )
  }

  return (
    <div className="ac ed">
      {!abierto && <div className="ac-botones"><button type="button" className="ac-boton" onClick={() => void abrir()}>Editar datos del cliente</button></div>}
      {abierto && (
        <form className="ac-forma" onSubmit={e => { e.preventDefault(); if (revisando) void confirmar(); else if (cambios.length) setRevisando(true) }}>
          <p className="cj-etiqueta">Editar datos del cliente {modo === 'sombra' ? '· modo prueba: no se escribe el CRM todavía' : ''}</p>
          {campos === null ? <p className="cj-texto-2">Cargando…</p> : <div className="ed-grilla">{campos.map(campo)}</div>}
          {!!campos?.length && (
            <label className="rc-campo ac-motivo"><span className="cj-etiqueta">Motivo (opcional)</span>
              <input type="text" className="rc-input" maxLength={300} value={motivo} disabled={revisando} onChange={e => setMotivo(e.target.value)} />
            </label>
          )}
          {revisando && (
            <div className="ac-revisar" role="status">
              <strong>Revisá {cambios.length === 1 ? 'el cambio' : `los ${cambios.length} cambios`}:</strong>
              <ul className="ac-plan">{cambios.map(({ c, valor }) => <li key={c.campo}><strong>{c.etiqueta}</strong>: <span className="ac-antes">{mostrar(c, c.valor)}</span> → {mostrar(c, valor)}</li>)}</ul>
            </div>
          )}
          <div className="ac-fila">
            <button type="submit" className="cj-boton cj-boton--primario" disabled={enviando || !cambios.length}>{enviando ? 'Guardando…' : intentoPendiente ? 'Comprobar este intento' : revisando ? 'Confirmar' : cambios.length ? `Revisar (${cambios.length})` : 'Sin cambios'}</button>
            {revisando && <button type="button" className="cj-boton cj-boton--secundario" disabled={enviando || intentoPendiente} onClick={() => { clave.current = null; setRevisando(false) }}>Volver a editar</button>}
            <button type="button" className="rc-limpiar" disabled={enviando || intentoPendiente} onClick={() => { setAbierto(false); setRevisando(false) }}>Cancelar</button>
          </div>
        </form>
      )}
      {mensaje && (
        <div className={`ac-mensaje ac-mensaje--${mensaje.tipo}`} role={mensaje.tipo === 'error' ? 'alert' : 'status'}>
          <p>{mensaje.texto}</p>
          {!!mensaje.plan?.length && (
            <details open>
              <summary>{modo === 'real' ? 'Lo que se escribió en el CRM' : 'Lo que se escribiría en el CRM'}</summary>
              <ul className="ac-plan">{mensaje.plan.map((c, i) => <li key={i}><strong>{c.hoja}</strong> · {c.celda}: <span className="ac-antes">{c.antes || '—'}</span> → {c.despues || '—'}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ?demo=1: campos de ejemplo (no toca la base)
function camposDemo(): CampoEditable[] {
  const c = (campo: ClaveCampo, etiqueta: string, tipo: CampoEditable['tipo'], valor: string, o: Partial<CampoEditable> = {}): CampoEditable =>
    ({ campo, etiqueta, tipo, valor, hoja: 'Agencia', columna: '?', soloFinanzas: false, ...o })
  return [
    c('nombre', 'Nombre', 'texto', 'Estudio Ejemplo Dos'), c('celular', 'Celular', 'texto', '+54 9 11 0000-0000'), c('mail', 'Mail', 'texto', 'ejemplo@ejemplo.test'),
    c('estudio', 'Estudio', 'texto', 'Estudio de ejemplo'), c('ciudad', 'Ciudad', 'texto', 'Ciudad de ejemplo'),
    c('csm', 'CSM', 'opcion', '', { opciones: [''], aviso: 'Ejemplo sin responsable asignado; el roster real se consulta al editar un cliente.' }),
    c('closer', 'Closer', 'texto', 'Closer Fer'), c('dia1', 'Día 1', 'fecha', '2026-09-01'), c('promesa', 'Promesa cumplida', 'opcion', 'Parcial', { opciones: ['', 'Sí', 'Parcial', 'No'] }),
    c('satisfaccion', 'Satisfacción (1–10)', 'numero', '8'), c('proximoCobro', 'Próximo cobro', 'fecha', '2026-11-05', { soloFinanzas: true }),
    c('anotaciones', 'Anotaciones', 'textoLargo', 'Cliente de ejemplo.'),
  ]
}
