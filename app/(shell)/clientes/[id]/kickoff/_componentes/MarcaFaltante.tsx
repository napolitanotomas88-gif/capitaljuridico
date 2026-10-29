'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LARGO_FECHA_LANZAMIENTO, LARGO_NOTA, type ClaveMarca } from '@/lib/bot/kickoff/revision'
import { enviarKickoff } from './enviar'

// Marca de un faltante (hecho, con una nota: "el recorte del mapa es…") o un dato de lanzamiento que se carga a mano (la
// fecha estimada, el WhatsApp de destino: la nota ES el dato). Se guarda en cj_kickoffs.faltantes_checks con quién y cuándo
// (POST /api/clientes/<id>/kickoff, accion 'faltante'); manda el `cuando` de lo que se ve (previo): si otro lo cambió en el
// medio, el servidor no escribe y se recarga. En el ejemplo (?demo=1) cambia solo en pantalla.
export interface MarcaActual { nota: string; quien: string; cuandoTexto: string | null; cuando: string }

type Props = {
  idCliente: string; recordingId: number; clave: ClaveMarca; actual: MarcaActual | null; demo: boolean
  /** Un dato de lanzamiento: el campo es obligatorio y se "borra" en vez de "desmarcar". */
  dato?: { nombre: string; placeholder: string; tipo: 'texto' | 'telefono' }
}

const firma = (m: MarcaActual | null) => (m ? `${m.cuando}|${m.nota}` : '')

export function MarcaFaltante({ idCliente, recordingId, clave, actual, demo, dato }: Props) {
  const router = useRouter()
  const idCampo = useId()
  const [marca, setMarca] = useState(actual)
  const [nota, setNota] = useState(actual?.nota ?? '')
  const [visto, setVisto] = useState(firma(actual))
  if (visto !== firma(actual)) { setVisto(firma(actual)); setMarca(actual); setNota(actual?.nota ?? '') }
  const [enviando, setEnviando] = useState(false)
  const [msj, setMsj] = useState<{ texto: string; error: boolean } | null>(null)

  async function guardar(hecho: boolean) {
    if (enviando) return
    const n = hecho ? nota.trim() : ''
    if (hecho && dato && n.length < 3) { setMsj({ texto: `Escribí ${dato.nombre.toLowerCase()}.`, error: true }); return }
    if (demo) {
      setMarca(hecho ? { nota: n, quien: 'vos', cuandoTexto: 'recién', cuando: new Date().toISOString() } : null)
      if (!hecho) setNota('')
      setMsj({ texto: 'Ejemplo: no se guarda.', error: false })
      return
    }
    setEnviando(true)
    setMsj(null)
    const r = await enviarKickoff(idCliente, { accion: 'faltante', recording_id: recordingId, clave, hecho, nota: n, previo: marca?.cuando ?? null })
    setEnviando(false)
    if (r.ok) {
      setMarca(hecho && r.cuando ? { nota: n, quien: 'vos', cuandoTexto: 'recién', cuando: r.cuando } : null)
      if (!hecho) setNota('')
      setMsj({ texto: r.mensaje, error: false })
      router.refresh()
    } else {
      setMsj({ texto: r.mensaje, error: true })
      if (r.codigo === 'conflicto') router.refresh()
    }
  }

  const cambio = nota.trim() !== (marca?.nota ?? '')
  const etiqueta = dato ? dato.nombre : marca ? 'Nota' : 'Nota (opcional)'
  return (
    <div className="ko-marca">
      <label className="ko-tilde__nota" htmlFor={idCampo}>
        <span className="ko-sub">{etiqueta}</span>
        <input id={idCampo} type={dato?.tipo === 'telefono' ? 'tel' : 'text'} inputMode={dato?.tipo === 'telefono' ? 'tel' : undefined} value={nota}
          maxLength={dato?.tipo === 'texto' ? LARGO_FECHA_LANZAMIENTO : dato ? 30 : LARGO_NOTA} autoComplete="off" disabled={enviando}
          placeholder={dato?.placeholder} onChange={e => setNota(e.target.value)} />
      </label>
      <div className="ko-tilde__botones">
        {(!marca || cambio) && (
          <button type="button" className="cj-chip" disabled={enviando || (!!dato && !nota.trim())} onClick={() => guardar(true)}>
            {dato ? 'Guardar' : marca ? 'Guardar la nota' : 'Marcar como hecho'}
          </button>
        )}
        {marca && (
          <button type="button" className="cj-chip ko-tilde__quitar" disabled={enviando} onClick={() => guardar(false)}>
            {dato ? 'Borrar' : 'Desmarcar'}
          </button>
        )}
      </div>
      {marca && <p className="ko-sub">{`${dato ? 'Cargado' : 'Hecho'} por ${marca.quien || 'alguien'}${marca.cuandoTexto ? ` · ${marca.cuandoTexto}` : ''}`}</p>}
      <p role="status" aria-live="polite" className={msj?.error ? 'ko-msj ko-msj--error' : 'ko-msj'}>{enviando ? 'Guardando…' : msj?.texto ?? ''}</p>
    </div>
  )
}
