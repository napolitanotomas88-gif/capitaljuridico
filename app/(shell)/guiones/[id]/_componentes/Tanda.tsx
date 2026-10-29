'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'
import type { SeccionGuion } from '@/lib/bot/guiones/tipos'

// Una tanda de guiones en la pantalla del Despacho: cada guion con sus 4 secciones (indicación y texto editables mientras
// está para revisar) y su «✓ Verificado», el check final de UNA persona, Tomi o Faus, que se habilita con todos verificados
// (pedido de Tomás del 27/10; aprobar: la primera vez pide el Doc «Guiones - …» del cliente), retomar si se
// frenó o quedó colgada, y lo que respondió el cliente (llega solo por WhatsApp o se pega a mano): el bot corrige solo y la
// tanda vuelve a revisión para el check (pedido de Tomás del 25/10). Todo por POST /api/guiones/<id>; el servidor decide
// quién puede qué.
export interface TandaVista {
  id: number; tanda: number; estado: string; estadoTexto: string; error: string | null; previo: string; total: number; colgada: boolean; tieneDoc: boolean; esperandoMac: boolean
  guiones: { numero: number; titulo: string; formato: string; utileria: string[]; secciones: SeccionGuion[]; ganchos: string[]; verificar: string[]; largo: number; editado: string | null; estado: string; verificado: string | null }[]
  docPendiente?: string | null; aprobacion: string | null; doc: string | null; whatsapp: boolean
  notas: { id: string; texto: string; guion: number | null; aplicada: boolean; guiones: number[]; origen: string }[]
}

const NOMBRE: Record<string, string> = { HOOK: 'Hook', PROBLEMA: 'Problema', SOLUCION: 'Solución', CTA: 'CTA' }

async function post(idCliente: string, cuerpo: Record<string, unknown>): Promise<{ ok: boolean; mensaje: string }> {
  try {
    const r = await fetch(`/api/guiones/${encodeURIComponent(idCliente)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
    const j = (await r.json().catch(() => null)) as { ok?: boolean; mensaje?: string } | null
    return { ok: r.ok && j?.ok === true, mensaje: j?.mensaje ?? (r.status === 401 ? 'Se cerró la sesión: volvé a entrar.' : 'No se pudo guardar.') }
  } catch { return { ok: false, mensaje: 'Sin conexión: no se guardó.' } }
}

export function Tanda({ idCliente, t, aprobador, soloLectura = false }: { idCliente: string; t: TandaVista; aprobador: boolean; soloLectura?: boolean }) {
  const router = useRouter()
  const [msj, setMsj] = useState<{ texto: string; error: boolean } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [nota, setNota] = useState('')
  const [notaGuion, setNotaGuion] = useState('')
  const editable = !soloLectura && t.estado === 'a_revisar'
  const faltan = t.guiones.filter(g => !g.verificado).map(g => g.numero)

  async function hacer(cuerpo: Record<string, unknown>): Promise<boolean> {
    if (ocupado || soloLectura) return false
    setOcupado(true)
    const r = await post(idCliente, { tanda: t.id, previo: t.previo, ...cuerpo })
    setMsj({ texto: r.mensaje, error: !r.ok })
    setOcupado(false)
    if (r.ok) router.refresh()
    return r.ok
  }

  return (
    <section className="cj-panel gu-tanda" aria-label={`Tanda ${t.tanda}`}>
      <header className="gu-cabecera">
        <span className="cj-etiqueta cj-etiqueta--laton">Tanda {t.tanda}</span>
        <strong className={`gu-estado gu-estado--${t.estado}`}>{t.estadoTexto}</strong>
        {t.total > 0 && t.guiones.length < t.total && <span className="gu-meta">{t.guiones.length} de {t.total} guiones</span>}
        {t.aprobacion && <span className="gu-meta">Aprobó {t.aprobacion}</span>}
        {t.doc && <a className="gu-enlace" href={t.doc} target="_blank" rel="noreferrer">Abrir el Doc</a>}
        {t.whatsapp && <span className="gu-meta">Avisado en WhatsApp</span>}
      </header>
      {t.docPendiente && <div className="cj-aviso" role="status"><p>Documento pendiente: {t.docPendiente}</p></div>}
      {(t.error || t.colgada) && <div className="cj-aviso" role="alert"><p>{t.error ?? 'Hace un rato que no avanza.'}</p>{!soloLectura && <Boton variante="secundario" disabled={ocupado} onClick={() => hacer({ accion: 'reanudar' })}>Retomar</Boton>}</div>}
      {!soloLectura && t.esperandoMac && aprobador && <div className="cj-aviso" role="alert"><p>Hace más de 2 horas que la Mac no la toma (¿está apagada?). Se puede armar con la API (~USD 2).</p><Boton variante="secundario" disabled={ocupado} onClick={() => hacer({ accion: 'armar_api' })}>Armar con la API</Boton></div>}
      {msj && <p className={msj.error ? 'gu-msj gu-msj--error' : 'gu-msj'} role="status">{msj.texto}</p>}

      <ol className="gu-lista">
        {t.guiones.map(g => <GuionVista key={g.numero} g={g} editable={editable} aprobador={aprobador} ocupado={ocupado}
          onGuardar={secciones => { void hacer({ accion: 'editar', numero: g.numero, secciones }) }}
          onVerificar={si => { void hacer({ accion: 'verificar', numero: g.numero, si }) }} />)}
      </ol>

      {!soloLectura && t.estado === 'a_revisar' && (
        <div className="gu-aprobar">
          {aprobador ? (<>
            <p className="gu-meta">El documento se conecta automáticamente. Después del check, Aylu o Gero reciben el link para entregarlo al cliente.</p>
            {faltan.length > 0 && <p className="gu-meta">Falta verificar {faltan.length === 1 ? 'el guion' : 'los guiones'} {faltan.join(', ')}.</p>}
            <Boton disabled={ocupado || faltan.length > 0} onClick={() => hacer({ accion: 'aprobar' })}>✓ Check final: aprobar y preparar entrega</Boton>
          </>) : <p className="gu-meta">Cada guion lo verifican Tomi o Faus, y uno de los dos da el check final.</p>}
        </div>
      )}
      {!soloLectura && t.estado === 'aprobada' && aprobador && (
        <Boton variante="secundario" disabled={ocupado} onClick={() => hacer({ accion: 'reenviar' })}>Revisar publicación y aviso</Boton>
      )}

      <div className="gu-notas">
        <h2>Respuesta del cliente</h2>
        {t.notas.length === 0 && <p className="gu-meta">Todavía no respondió. Cuando escriba en el grupo Contenido, aparece acá y el bot corrige solo.</p>}
        <ul>
          {t.notas.map(n => (
            <li key={n.id} className={n.aplicada ? 'gu-nota gu-nota--aplicada' : 'gu-nota'}>
              <p>{n.guion ? <strong>Guion {n.guion}: </strong> : null}{n.texto}</p>
              <span className="gu-meta">{n.aplicada ? `Aplicada por el bot${n.guiones.length ? ` en ${n.guiones.length === 1 ? 'el guion' : 'los guiones'} ${n.guiones.join(', ')}` : ''}` : 'El bot la está aplicando'}{n.origen === 'manual' ? ' · cargada a mano' : ' · por WhatsApp'}</span>
            </li>
          ))}
        </ul>
        {!soloLectura && t.estado !== 'mercado' && t.estado !== 'plan' && t.estado !== 'escribiendo' && (
          <div className="gu-nueva">
            <label className="gu-campo">Pegar lo que respondió el cliente
              <textarea value={nota} onChange={e => setNota(e.target.value)} rows={3} /></label>
            <label className="gu-campo">¿De qué guion? (opcional)
              <select value={notaGuion} onChange={e => setNotaGuion(e.target.value)}><option value="">De la tanda</option>{t.guiones.map(g => <option key={g.numero} value={g.numero}>{g.numero}. {g.titulo}</option>)}</select></label>
            <Boton variante="secundario" disabled={ocupado || !nota.trim()} onClick={async () => { if (await hacer({ accion: 'nota', texto: nota, guion: notaGuion || undefined })) setNota('') }}>Agregar nota</Boton>
          </div>
        )}
      </div>
    </section>
  )
}

function GuionVista({ g, editable, aprobador, ocupado, onGuardar, onVerificar }: {
  g: TandaVista['guiones'][number]; editable: boolean; aprobador: boolean; ocupado: boolean
  onGuardar: (s: { seccion: string; indicacion: string; texto: string }[]) => void
  onVerificar: (si: boolean) => void
}) {
  const [editando, setEditando] = useState(false)
  const [secs, setSecs] = useState(g.secciones.map(s => ({ seccion: s.seccion, indicacion: s.indicacion, texto: s.texto })))
  return (
    <li className="gu-guion">
      <div className="gu-guion__cab">
        <span className="gu-num">{g.numero}</span>
        <h3>{g.titulo}</h3>
        <span className="gu-meta">{g.largo} caracteres{g.editado ? ` · editado por ${g.editado}` : ''}{g.estado !== 'listo' ? ' · corrigiendo' : ''}</span>
        {g.verificado ? <span className="gu-verificado">✓ Verificado por {g.verificado}</span> : <span className="gu-meta gu-sin-verificar">Sin verificar</span>}
      </div>
      {g.utileria.length > 0 && <p className="gu-meta">Para tener a mano: {g.utileria.join(', ')}</p>}
      {g.secciones.map((s, k) => (
        <div key={s.seccion} className="gu-seccion">
          <span className="gu-etq">{NOMBRE[s.seccion] ?? s.seccion}</span>
          <span className="gu-vel">Velocidad {s.velocidad}</span>
          {editando ? (<>
            <textarea aria-label={`Indicación de ${NOMBRE[s.seccion]}`} value={secs[k].indicacion} rows={2} onChange={e => setSecs(xs => xs.map((x, j) => (j === k ? { ...x, indicacion: e.target.value } : x)))} />
            <textarea aria-label={`Texto de ${NOMBRE[s.seccion]}`} value={secs[k].texto} rows={3} onChange={e => setSecs(xs => xs.map((x, j) => (j === k ? { ...x, texto: e.target.value } : x)))} />
          </>) : (<>
            <p className="gu-ind">({s.indicacion})</p>
            <p className="gu-txt">{s.texto}</p>
          </>)}
        </div>
      ))}
      {(g.ganchos.length > 0 || g.verificar.length > 0) && (
        <details className="gu-extra"><summary>Ganchos alternativos y lo que hay que verificar</summary>
          {g.ganchos.length > 0 && <ul>{g.ganchos.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {g.verificar.length > 0 && <p><strong>Verificar:</strong> {g.verificar.join('; ')}</p>}
        </details>
      )}
      <div className="gu-acciones">
        {/* Al abrir el editor se toma el texto de AHORA (el bot pudo haberlo corregido desde la última vez) */}
        {editable && aprobador && !editando && (g.verificado
          ? <Boton variante="secundario" disabled={ocupado} onClick={() => onVerificar(false)}>Sacar verificación</Boton>
          : <Boton disabled={ocupado} onClick={() => onVerificar(true)}>✓ Verificado</Boton>)}
        {editable && !editando && <Boton variante="secundario" onClick={() => { setSecs(g.secciones.map(s => ({ seccion: s.seccion, indicacion: s.indicacion, texto: s.texto }))); setEditando(true) }}>Editar</Boton>}
        {editando && <><Boton disabled={ocupado} onClick={() => { onGuardar(secs); setEditando(false) }}>Guardar</Boton><Boton variante="secundario" onClick={() => { setEditando(false); setSecs(g.secciones.map(s => ({ seccion: s.seccion, indicacion: s.indicacion, texto: s.texto }))) }}>Cancelar</Boton></>}
      </div>
    </li>
  )
}
