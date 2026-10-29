'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import './acciones.css'
import { EditarDatos } from './EditarDatos'
import { SeguimientoRespuesta } from './SeguimientoRespuesta'
import type { Accion, CambioPlan, ModoAcciones, RespuestaAccion, RespuestaHistorial } from '@/lib/clientes/acciones/tipos'

type TipoForma = 'servicio' | 'pausa' | 'reanudar' | 'pago' | 'renovacion' | 'proyeccion' | 'archivar' | 'restaurar'
type Forma = { tipo: TipoForma; duracion: string; hasta: string; dias: string; fecha: string; desde: string; motivo: string; usd: string; ars: string; concepto: string; cuenta: string; programa: string; fuente: string; setter: string; tipoVenta: string; nombre: string; confirmado: boolean; meses: string; precio: string; estadoProyeccion: string }
const TIPOS: TipoForma[] = ['servicio', 'pausa', 'reanudar', 'pago', 'renovacion', 'proyeccion', 'archivar', 'restaurar']
const TITULOS: Record<TipoForma, string> = { servicio: 'Sumar servicio', pausa: 'Pausar servicio', reanudar: 'Reanudar servicio', pago: 'Agregar pago', renovacion: 'Registrar renovación', proyeccion: 'Llamada de proyección', archivar: 'Archivar cliente', restaurar: 'Restaurar cliente' }
const MODOS: Record<ModoAcciones, string> = { sombra: 'Simulación: los cambios todavía no se aplican', prueba: 'Prueba controlada: sólo cliente de prueba', real: 'Cambios sincronizados con el CRM' }
const nuevaForma = (tipo: TipoForma, hoy: string): Forma => ({ tipo, duracion: '1m', hasta: '', dias: '', fecha: hoy, desde: '', motivo: '', usd: '', ars: '', concepto: '', cuenta: '', programa: '', fuente: '', setter: '', tipoVenta: '', nombre: '', confirmado: false, meses: '4', precio: '', estadoProyeccion: 'agendada' })
const tipoInicial = (x: string | undefined, finanzas: boolean) => TIPOS.includes(x as TipoForma) && (finanzas || !['pago', 'renovacion'].includes(x!)) ? x as TipoForma : null
const dia = (s: string) => s.split('-').reverse().join('/')
const numero = (s: string) => Number(s.replace(',', '.'))
type PreviaRenovacion = NonNullable<RespuestaAccion['renovacionReferidos']>

function ResumenRenovacion({ r, aplicada = false }: { r: PreviaRenovacion; aplicada?: boolean }) {
  return <div className="ac-renovacion">
    <strong>{aplicada ? 'Renovación confirmada' : 'Servicio que quedará al confirmar'}</strong>
    <ul className="ac-plan">
      <li>{r.mesesContratados} {r.mesesContratados === 1 ? 'mes contratado' : 'meses contratados'} · fin: {dia(r.finContrato)}</li>
      <li>{r.mesesReferidos} {r.mesesReferidos === 1 ? 'mes liberado' : 'meses liberados'} por referidos{r.mesesReferidos > 0 ? aplicada ? r.mesesReferidos === 1 ? ' aplicado automáticamente' : ' aplicados automáticamente' : ' para aplicar automáticamente' : ' disponibles'}</li>
      <li>Total: {r.mesesTotales} {r.mesesTotales === 1 ? 'mes' : 'meses'} de servicio · fin: {dia(r.finServicio)}</li>
    </ul>
    <p className="cj-texto-2">El precio contratado se mantiene. Los créditos en USD requieren un canje manual y no se descuentan en esta renovación.</p>
  </div>
}

function cuerpoDe(f: Forma, nombre: string): Record<string, unknown> | string {
  const motivo = f.motivo.trim() || undefined
  if (f.tipo === 'servicio') {
    if (f.duracion !== 'personalizado') return { tipo: f.tipo, duracion: f.duracion, motivo }
    if (f.hasta) return { tipo: f.tipo, duracion: f.duracion, hasta: f.hasta, motivo }
    const dias = numero(f.dias)
    return Number.isInteger(dias) && dias >= 1 && dias <= 365 ? { tipo: f.tipo, duracion: f.duracion, dias, motivo } : 'Indicá una fecha o entre 1 y 365 días.'
  }
  if (f.tipo === 'pausa') return { tipo: f.tipo, desde: f.fecha, motivo }
  if (f.tipo === 'reanudar') return { tipo: f.tipo, fecha: f.fecha, desdePausa: f.desde || undefined, motivo }
  if (f.tipo === 'pago') {
    if (!Number.isFinite(numero(f.usd)) || numero(f.usd) <= 0) return 'El monto en USD tiene que ser mayor que cero.'
    if (!f.concepto || !f.cuenta) return 'Elegí el concepto y la cuenta del pago.'
    return { tipo: f.tipo, fecha: f.fecha, usd: numero(f.usd), ars: f.ars ? numero(f.ars) : undefined, concepto: f.concepto, cuenta: f.cuenta, programa: f.programa.trim() || undefined, fuente: f.fuente.trim() || undefined, setter: f.setter.trim() || undefined, tipoVenta: f.tipoVenta || undefined, motivo }
  }
  if (f.tipo === 'renovacion') {
    if (!Number.isInteger(numero(f.meses)) || numero(f.meses) < 1 || !f.precio || !Number.isFinite(numero(f.precio)) || numero(f.precio) < 0) return 'Revisá los meses y el precio de la renovación.'
    return { tipo: f.tipo, inicio: f.fecha, meses: numero(f.meses), precio: numero(f.precio), motivo }
  }
  if (f.tipo === 'proyeccion') return { tipo: f.tipo, estado: f.estadoProyeccion, fecha: f.fecha, motivo }
  if (f.tipo === 'archivar') {
    if (f.nombre !== nombre || !f.confirmado || !motivo) return 'Para archivar, escribí el nombre exacto, indicá el motivo y marcá la confirmación.'
    return { tipo: f.tipo, confirmacion: f.nombre, confirmado: true, motivo }
  }
  return { tipo: 'restaurar', motivo }
}

export function AccionesCliente({ idCrm, nombre = idCrm, hoy, demo, puedeEditar, puedeFinanzas = false, estado, accionInicial }: { idCrm: string; nombre?: string; hoy: string; demo: boolean; puedeEditar: boolean; puedeFinanzas?: boolean; estado?: string; accionInicial?: string }) {
  const router = useRouter()
  const inicial = tipoInicial(accionInicial, puedeFinanzas)
  const [hist, setHist] = useState<RespuestaHistorial | null>(null)
  const [errorHist, setErrorHist] = useState<string | null>(null)
  const [forma, setForma] = useState<Forma | null>(() => inicial ? nuevaForma(inicial, hoy) : null)
  const [revisando, setRevisando] = useState(false)
  const [planPrevio, setPlanPrevio] = useState<CambioPlan[]>([])
  const [renovacionPrevia, setRenovacionPrevia] = useState<PreviaRenovacion | null>(null)
  const [opcionesPago, setOpcionesPago] = useState<Record<string, string[]>>({})
  const [enviando, setEnviando] = useState(false)
  const [intentoPendiente, setIntentoPendiente] = useState(false)
  const [datosPendientes, setDatosPendientes] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string; plan?: CambioPlan[]; renovacionReferidos?: PreviaRenovacion; renovacionAplicada?: boolean } | null>(null)
  const clave = useRef<string | null>(null)
  const cuerpoConfirmado = useRef<Record<string, unknown> | null>(null)
  const enVuelo = useRef(false)
  const [, empezar] = useTransition()
  const base = `/api/clientes/${encodeURIComponent(idCrm)}/acciones`
  const cargar = useCallback(async () => {
    if (demo) { setHist({ ok: true, modo: 'sombra', acciones: [], pausa: null }); return }
    try {
      const r = await fetch(base, { cache: 'no-store' }), j = await r.json() as RespuestaHistorial
      if (!r.ok || !j.ok) throw new Error(j.mensaje ?? String(r.status))
      setHist(j); setErrorHist(null)
    } catch { setErrorHist('No se pudo leer el historial. Reintentá antes de hacer cambios.') }
  }, [base, demo])
  useEffect(() => { const t = setTimeout(() => void cargar(), 0); return () => clearTimeout(t) }, [cargar])
  useEffect(() => { if (inicial) document.getElementById('rc-acciones')?.scrollIntoView({ block: 'start' }) }, [inicial])
  useEffect(() => {
    if (forma?.tipo !== 'pago' || demo || !puedeEditar) return
    let vigente = true
    void fetch(`${base}?pago=1`, { cache: 'no-store' }).then(async r => ({ r, j: await r.json() })).then(({ r, j }) => {
      if (!vigente || !r.ok || !j.ok || cuerpoConfirmado.current) return
      setOpcionesPago(j.opciones ?? j)
      setForma(f => f?.tipo === 'pago' ? { ...f, programa: f.programa || j.programa || j.pago?.programa || '', fuente: f.fuente || j.fuente || j.pago?.fuente || '', setter: f.setter || j.setter || j.pago?.setter || '', tipoVenta: f.tipoVenta || j.tipoVenta || j.pago?.tipoVenta || '' } : f)
    }).catch(() => { /* se puede revisar la inferencia del pago desde el formulario */ })
    return () => { vigente = false }
  }, [base, demo, forma?.tipo, puedeEditar])
  const abrir = (tipo: TipoForma) => {
    if (intentoPendiente || datosPendientes || enVuelo.current) return
    clave.current = null; cuerpoConfirmado.current = null; setForma(nuevaForma(tipo, hoy)); setRevisando(false); setPlanPrevio([]); setRenovacionPrevia(null); setMensaje(null)
  }
  const revisar = async () => {
    if (!forma || enVuelo.current) return
    const cuerpo = cuerpoDe(forma, nombre)
    if (typeof cuerpo === 'string') { setMensaje({ tipo: 'error', texto: cuerpo }); return }
    if (demo) { setRevisando(true); return }
    clave.current ??= `ui_${crypto.randomUUID()}`
    enVuelo.current = true
    setEnviando(true); setMensaje(null); setRenovacionPrevia(null)
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...cuerpo, clave: clave.current, revisar: true }) }), j = await r.json() as RespuestaAccion
      if (!r.ok || !j.ok) { setMensaje({ tipo: 'error', texto: j.mensaje ?? 'Revisá los datos del pedido.' }); return }
      setPlanPrevio(j.plan ?? [])
      setRenovacionPrevia(j.renovacionReferidos ?? null)
      const pago = j.pago
      if (pago) setForma(f => f?.tipo === 'pago' ? { ...f, programa: pago.programa, fuente: pago.fuente, setter: pago.setter ?? '', tipoVenta: pago.tipoVenta ?? f.tipoVenta } : f)
      setRevisando(true)
    } catch { setMensaje({ tipo: 'error', texto: 'No se pudo revisar el pedido. No se aplicó ningún cambio.' }) }
    finally { enVuelo.current = false; setEnviando(false) }
  }
  const confirmar = async () => {
    if (!forma || enVuelo.current) return
    const actual = cuerpoDe(forma, nombre)
    if (typeof actual === 'string') { setMensaje({ tipo: 'error', texto: actual }); return }
    if (demo) { setMensaje({ tipo: 'error', texto: 'Los datos de ejemplo no generan cambios.' }); return }
    if (forma.tipo === 'renovacion' && !cuerpoConfirmado.current && !renovacionPrevia?.huella) { setMensaje({ tipo: 'error', texto: 'Revisá otra vez la renovación para confirmar los meses disponibles por referidos.' }); setRevisando(false); return }
    const cuerpo = cuerpoConfirmado.current ?? { ...actual, ...(forma.tipo === 'renovacion' && renovacionPrevia ? { referidosEsperados: renovacionPrevia.huella } : {}) }
    clave.current ??= `ui_${crypto.randomUUID()}`
    enVuelo.current = true; cuerpoConfirmado.current = cuerpo; setIntentoPendiente(true)
    setEnviando(true); setMensaje(null)
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...cuerpo, clave: clave.current }) }), j = await r.json().catch(() => ({})) as RespuestaAccion
      if (!r.ok || !j.ok) {
        if (r.status >= 400 && r.status < 500 && ![408, 429].includes(r.status)) { setIntentoPendiente(false); cuerpoConfirmado.current = null }
        if (['referidos_cambiaron', 'revisar_referidos'].includes(j.codigo ?? '')) { setRevisando(false); setPlanPrevio([]); setRenovacionPrevia(null); clave.current = null }
        setMensaje({ tipo: 'error', texto: j.mensaje ?? 'No se pudo confirmar. Reintentá este mismo pedido para comprobar el resultado.' }); return
      }
      setIntentoPendiente(false); cuerpoConfirmado.current = null; setMensaje({ tipo: 'ok', texto: j.mensaje ?? j.accion?.resumen ?? 'Cambio guardado.', plan: j.plan ?? j.accion?.plan, renovacionReferidos: j.renovacionReferidos, renovacionAplicada: j.accion?.estado === 'aplicada' }); setForma(null); setRevisando(false); setRenovacionPrevia(null); clave.current = null
      await cargar(); empezar(() => router.refresh())
    } catch { setMensaje({ tipo: 'error', texto: 'Se cortó la conexión. Reintentá este mismo pedido para comprobar el resultado.' }) }
    finally { enVuelo.current = false; setEnviando(false) }
  }
  const deshacer = async (a: Accion) => {
    if (enVuelo.current || intentoPendiente || datosPendientes || !window.confirm(`¿Deshacer «${a.resumen}»?`)) return
    enVuelo.current = true
    setEnviando(true); setMensaje(null)
    try {
      const r = await fetch(`${base}/${encodeURIComponent(a.id)}`, { method: 'DELETE' }), j = await r.json().catch(() => ({})) as RespuestaAccion
      setMensaje(r.ok && j.ok ? { tipo: 'ok', texto: j.mensaje ?? 'Cambio deshecho.' } : { tipo: 'error', texto: j.mensaje ?? 'No se pudo deshacer.' }); await cargar(); empezar(() => router.refresh())
    } catch { setMensaje({ tipo: 'error', texto: 'No se pudo comprobar el resultado. Reintentá antes de hacer otro cambio.' }) }
    finally { enVuelo.current = false; setEnviando(false) }
  }
  const comprobar = async (a: Accion) => {
    if (enVuelo.current || intentoPendiente || datosPendientes || !a.datos.clave) return
    enVuelo.current = true; setEnviando(true); setMensaje(null)
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a.datos) }), j = await r.json().catch(() => ({})) as RespuestaAccion
      setMensaje({ tipo: r.ok && j.ok ? 'ok' : 'error', texto: j.mensaje ?? 'El intento sigue pendiente de confirmación.', renovacionReferidos: j.renovacionReferidos, renovacionAplicada: j.accion?.estado === 'aplicada' })
      await cargar(); empezar(() => router.refresh())
    } catch { setMensaje({ tipo: 'error', texto: 'No se pudo comprobar el intento. Sigue guardado con su clave original.' }) }
    finally { enVuelo.current = false; setEnviando(false) }
  }
  const archivado = hist?.archivado ?? (hist?.acciones.find(a => a.estado === 'aplicada' && ['archivar', 'restaurar'].includes(a.tipo))?.tipo === 'archivar')
  const pausa = hist?.pausa ?? null, pausado = !!pausa || estado === 'PAUSADO'
  const ultima = hist?.acciones.find(a => a.estado !== 'anulada' && a.estado !== 'error')
  const cambiar = (k: keyof Forma, v: string | boolean) => setForma(f => f ? { ...f, [k]: v } : null)
  const campo = (k: keyof Forma, etiqueta: string, tipo = 'text', requerido = false) => <label className="rc-campo" key={k}><span className="cj-etiqueta">{etiqueta}</span><input className="rc-input" type={tipo} required={requerido} value={String(forma?.[k] ?? '')} onChange={e => cambiar(k, e.target.value)} maxLength={tipo === 'text' ? 300 : undefined} min={tipo === 'number' ? 0 : undefined} step={tipo === 'number' ? 'any' : undefined} /></label>
  const opcion = (k: keyof Forma, etiqueta: string, opciones: string[]) => <label className="rc-campo" key={k}><span className="cj-etiqueta">{etiqueta}</span><select className="rc-input" value={String(forma?.[k] ?? '')} onChange={e => cambiar(k, e.target.value)}>{opciones.map(o => <option key={o} value={o}>{o === '' ? 'Elegir…' : ({ '1m': '1 mes', '2s': '2 semanas', personalizado: 'Personalizado', link_enviado: 'Link enviado', agendada: 'Agendada', hecha: 'Realizada', 'Front-end': 'Inicial (Front-end)', 'Back-end': 'Renovación (Back-end)' } as Record<string, string>)[o] ?? o}</option>)}</select></label>
  return <div className="ac">
    {hist && <p className={`ac-modo ac-modo--${hist.modo}`}>{MODOS[hist.modo]}</p>}
    {errorHist && <p role="alert" className="ac-mensaje ac-mensaje--error">{errorHist}</p>}
    {archivado && <p role="status" className="ac-pausa">Cliente archivado: fuera de la cartera activa. Podés restaurarlo.</p>}
    {pausa && <p className="ac-pausa" role="status">Pausado desde el {dia(pausa.desde)} ({pausa.dias} días)</p>}
    {!puedeEditar ? <p className="cj-texto-2">Los cambios los hacen Tomás, Gero A, Gero M y Aylu.</p> : <>
      <div className="ac-botones" role="group" aria-label="Acciones sobre el cliente">
        {(archivado ? ['restaurar'] : ['servicio', pausado ? 'reanudar' : 'pausa', ...(puedeFinanzas ? ['pago', 'renovacion'] : []), 'proyeccion', 'archivar']).map(t => <button type="button" className="ac-boton" key={t} onClick={() => abrir(t as TipoForma)} disabled={enviando || intentoPendiente || datosPendientes}>{TITULOS[t as TipoForma]}</button>)}
      </div>
      {!archivado && !forma && !intentoPendiente && <EditarDatos idCrm={idCrm} demo={demo} alGuardar={() => void cargar()} alPendiente={setDatosPendientes} />}
      {forma && <form className="ac-forma" onSubmit={e => { e.preventDefault(); if (revisando) void confirmar(); else void revisar() }}>
        <h3>{TITULOS[forma.tipo]}</h3>
        <fieldset className="ac-campos" disabled={revisando || enviando}>
          {forma.tipo === 'servicio' && <>{opcion('duracion', 'Duración', ['1m', '2s', 'personalizado'])}{forma.duracion === 'personalizado' && <>{campo('hasta', 'Hasta el', 'date')}{campo('dias', 'O cantidad de días', 'number')}</>}</>}
          {['pausa', 'reanudar', 'pago', 'renovacion', 'proyeccion'].includes(forma.tipo) && campo('fecha', forma.tipo === 'renovacion' ? 'Inicio de la renovación' : 'Fecha', 'date', true)}
          {forma.tipo === 'reanudar' && !pausa && campo('desde', 'Pausado desde (si se cargó fuera del Despacho)', 'date', true)}
          {forma.tipo === 'pago' && <>{campo('usd', 'Monto en USD', 'number', true)}{campo('ars', 'Monto en ARS (si corresponde)', 'number')}{opcion('concepto', 'Concepto', ['', 'Fee', '1ra Cuota', '2da Cuota', '3ra Cuota', '4ta Cuota', 'PIF', 'Renovación'])}{opcion('cuenta', 'Cuenta que recibió', ['', 'Tomi', 'Gero', 'Empresa'])}{opcion('tipoVenta', 'Tipo de venta', ['', ...(opcionesPago.tiposVenta ?? ['Front-end', 'Back-end'])])}{opcionesPago.programas?.length ? opcion('programa', 'Programa', ['', ...opcionesPago.programas]) : campo('programa', 'Programa')}{opcionesPago.fuentes?.length ? opcion('fuente', 'Fuente', ['', ...opcionesPago.fuentes]) : campo('fuente', 'Fuente')}{opcionesPago.setters?.length ? opcion('setter', 'Setter (si corresponde)', ['', ...opcionesPago.setters]) : campo('setter', 'Setter (si corresponde)')}</>}
          {forma.tipo === 'renovacion' && <>{campo('meses', 'Meses contratados (sin incluir créditos)', 'number', true)}{campo('precio', 'Precio contratado en USD', 'number', true)}<p className="cj-texto-2">Los meses liberados y vigentes por referidos se suman automáticamente al confirmar. Revisá el detalle antes de guardar. El cobro se carga aparte, con Agregar pago; los créditos en USD se canjean manualmente.</p></>}
          {forma.tipo === 'proyeccion' && opcion('estadoProyeccion', 'Estado de la llamada', ['link_enviado', 'agendada', 'hecha'])}
          {campo('motivo', forma.tipo === 'archivar' ? 'Motivo del archivo' : 'Motivo / nota (opcional)', 'text', forma.tipo === 'archivar')}
          {forma.tipo === 'archivar' && <><p>Se quitará de la cartera activa y de los seguimientos. Se conserva el historial para restaurarlo.</p>{campo('nombre', `Escribí el nombre exacto: ${nombre}`, 'text', true)}<label><input type="checkbox" checked={forma.confirmado} onChange={e => cambiar('confirmado', e.target.checked)} required /> Confirmo que quiero archivar a este cliente.</label></>}
        </fieldset>
        {revisando && <div className="ac-revisar" role="status"><strong>Revisá antes de confirmar:</strong><ul className="ac-plan">{Object.entries(cuerpoDe(forma, nombre)).filter(([k, v]) => k !== 'tipo' && v !== undefined && v !== '').map(([k, v]) => <li key={k}>{({ duracion: 'Duración', hasta: 'Hasta', dias: 'Días', fecha: 'Fecha', desde: 'Desde', desdePausa: 'Inicio de pausa', usd: 'USD', ars: 'ARS', concepto: 'Concepto', cuenta: 'Cuenta', tipoVenta: 'Tipo de venta', programa: 'Programa', fuente: 'Fuente', setter: 'Setter', inicio: 'Inicio', meses: 'Meses', precio: 'Precio USD', estado: 'Estado', confirmacion: 'Cliente', confirmado: 'Confirmado', motivo: 'Nota' } as Record<string, string>)[k] ?? k}: {typeof v === 'boolean' ? 'Sí' : String(v)}</li>)}</ul>{!!planPrevio.length && <ul className="ac-plan">{planPrevio.map((p, i) => <li key={i}>{p.hoja} · {p.celda}: {p.antes || '—'} → {p.despues || '—'}</li>)}</ul>}<p>{hist?.modo === 'sombra' ? 'Es una simulación.' : `Se guardará para ${nombre} y se actualizará el Despacho.`}</p></div>}
        {revisando && forma.tipo === 'renovacion' && renovacionPrevia && <ResumenRenovacion r={renovacionPrevia} />}
        {intentoPendiente && <p className="cj-texto-2" role="status">Estamos comprobando este intento. Conservá los datos y reintentá para confirmar el resultado sin duplicarlo.</p>}
        <div className="ac-fila"><button type="submit" className="cj-boton cj-boton--primario" disabled={enviando}>{enviando ? 'Guardando…' : intentoPendiente ? 'Comprobar este intento' : revisando ? forma.tipo === 'renovacion' ? 'Confirmar renovación' : 'Confirmar' : 'Revisar'}</button>{revisando && <button type="button" className="cj-boton" disabled={enviando || intentoPendiente} onClick={() => { clave.current = null; setRevisando(false); setRenovacionPrevia(null) }}>Volver a editar</button>}<button type="button" className="rc-limpiar" disabled={enviando || intentoPendiente} onClick={() => { setForma(null); setRevisando(false); setRenovacionPrevia(null); clave.current = null }}>Cancelar</button></div>
      </form>}
      {!archivado && <SeguimientoRespuesta idCrm={idCrm} demo={demo} />}
    </>}
    {mensaje && <div className={`ac-mensaje ac-mensaje--${mensaje.tipo}`} role={mensaje.tipo === 'error' ? 'alert' : 'status'}><p>{mensaje.texto}</p>{puedeFinanzas && mensaje.tipo === 'ok' && mensaje.renovacionReferidos && <ResumenRenovacion r={mensaje.renovacionReferidos} aplicada={mensaje.renovacionAplicada} />}{!!mensaje.plan?.length && <details><summary>Cambios del pedido</summary><ul className="ac-plan">{mensaje.plan.map((c, i) => <li key={i}><strong>{c.hoja}</strong> · {c.celda}: <span className="ac-antes">{c.antes || '—'}</span> → {c.despues || '—'}</li>)}</ul></details>}</div>}
    {!!hist?.acciones.length && <details className="ac-historial"><summary>Historial de acciones ({hist.acciones.length})</summary><ul className="ac-lista">{hist.acciones.map(a => <li key={a.id}><div><strong>{a.resumen}</strong><p className="cj-texto-2">{a.quien} · {new Date(a.creada).toLocaleString('es-AR')} · {a.estado === 'anulada' ? 'Deshecha' : a.estado === 'aplicada' ? 'Aplicada' : a.estado === 'error' ? 'Revisar' : 'Registrada'}</p></div>{puedeEditar && a.estado === 'registrada' && a.modo === hist.modo && a.modo !== 'sombra' && a.datos.clave ? <button type="button" className="ac-boton" disabled={enviando || intentoPendiente || datosPendientes} onClick={() => void comprobar(a)}>Comprobar intento pendiente</button> : puedeEditar && a.id === ultima?.id && a.esDeshacible !== false && !['pago'].includes(a.tipo) ? <button type="button" className="ac-boton" disabled={enviando || intentoPendiente || datosPendientes} onClick={() => void deshacer(a)}>Deshacer</button> : null}</li>)}</ul></details>}
  </div>
}
