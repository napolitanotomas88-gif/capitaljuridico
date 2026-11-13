'use client'

import { useCallback, useEffect, useState } from 'react'
import { Boton } from '@/components/ui'
import { useConfirmacion } from '@/components/ui/Confirmacion'
import { FUENTES_WIN, LADO_MAXIMO_CAPTURA, NOMBRE_FUENTE_WIN, TOPE_CAPTURA_BYTES, TOPE_TEXTO, type FuenteWin, type Win } from '@/lib/clientes/wins/modelo'
import './puntaje.css'

// Wins de un cliente en su tarjeta (especificación v1, 13/11/2026): la lista y «Agregar win» (texto textual obligatorio,
// fecha, fuente, autorizado sí/no y captura opcional: se pega desde el portapapeles o se sube un archivo). La captura se
// achica acá (máx. 1600 px de lado, WebP o JPEG, hasta 600 KB) y el servidor la vuelve a validar. Cargar y borrar: solo
// quienes pueden usar las acciones de la tarjeta (el servidor lo vuelve a comprobar).

const fechaAR = (f: string) => f.split('-').reverse().join('/')
const nuevaClave = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w${Date.now()}${Math.random().toString(36).slice(2, 10)}`)

/** Achica la imagen en el navegador hasta que entre en el tope. null si no se puede leer. */
async function achicar(archivo: Blob): Promise<{ blob: Blob; url: string } | null> {
  let imagen: ImageBitmap
  try { imagen = await createImageBitmap(archivo) } catch { return null }
  const escala = Math.min(1, LADO_MAXIMO_CAPTURA / Math.max(imagen.width, imagen.height))
  let ancho = Math.max(1, Math.round(imagen.width * escala)), alto = Math.max(1, Math.round(imagen.height * escala))
  const lienzo = document.createElement('canvas')
  const dibujar = () => {
    lienzo.width = ancho; lienzo.height = alto
    const ctx = lienzo.getContext('2d')
    if (!ctx) return false
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, ancho, alto)
    ctx.drawImage(imagen, 0, 0, ancho, alto)
    return true
  }
  const aBlob = (tipo: string, calidad: number) => new Promise<Blob | null>(res => lienzo.toBlob(res, tipo, calidad))
  for (let intento = 0; intento < 4; intento++) {
    if (!dibujar()) return null
    for (const calidad of [0.82, 0.7, 0.58, 0.46]) {
      let b = await aBlob('image/webp', calidad)
      if (!b || b.type !== 'image/webp') b = await aBlob('image/jpeg', calidad)
      if (b && b.size <= TOPE_CAPTURA_BYTES) return { blob: b, url: URL.createObjectURL(b) }
    }
    ancho = Math.round(ancho * 0.75); alto = Math.round(alto * 0.75)
  }
  return null
}

const aBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''))
  r.onerror = () => rej(new Error('lectura'))
  r.readAsDataURL(b)
})

/** Un win en la lista (lo usan la tarjeta y la sección Wins del hub). */
export function ItemWin({ w, nombre, alBorrar }: { w: Win; nombre?: string; alBorrar?: (w: Win) => void }) {
  return (
    <li className="pz-win">
      <div className="pz-win__cab">
        {nombre && <span className="pz-win__cliente">{nombre} ({w.idCrm})</span>}
        <span>{fechaAR(w.fecha)}</span>
        <span>{NOMBRE_FUENTE_WIN[w.fuente]}</span>
        {w.autorizado ? <span className="pz-autorizado">Autorizado para usar</span> : <span>Sin autorización para usar</span>}
      </div>
      <p className="pz-win__texto">«{w.texto}»</p>
      {w.conCaptura && (
        <a href={`/api/clientes/wins/${w.id}/captura`} target="_blank" rel="noreferrer" aria-label="Abrir la captura del chat en grande">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por una ruta con sesión: sin optimizador */}
          <img className="pz-win__captura" src={`/api/clientes/wins/${w.id}/captura`} alt={`Captura del chat del ${fechaAR(w.fecha)}`} loading="lazy" />
        </a>
      )}
      <div className="pz-win__pie">
        <span>Cargó {w.cargadoPor || 'el equipo'}</span>
        {alBorrar && <button type="button" className="pz-boton-texto" onClick={() => alBorrar(w)}>Borrar</button>}
      </div>
    </li>
  )
}

/** Borrar un win con confirmación propia (nunca window.confirm). */
export function useBorrarWin(alTerminar: () => void) {
  const [confirmar, dialogo] = useConfirmacion()
  const [error, setError] = useState('')
  const borrar = useCallback(async (w: Win) => {
    const ok = await confirmar({
      titulo: '¿Borrar este win?',
      detalle: `Deja de verse y de sumar al puntaje${w.conCaptura ? ', y su captura se descarta' : ''}. Queda el registro de quién lo borró.`,
      accion: 'Borrar el win',
      peligro: true,
    })
    if (!ok) return
    setError('')
    try {
      const r = await fetch(`/api/clientes/wins/${w.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error ?? 'No se pudo borrar.'); return }
      alTerminar()
    } catch {
      setError('Sin conexión: no se borró. Probá de nuevo.')
    }
  }, [confirmar, alTerminar])
  return { borrar, dialogo, error }
}

export function WinsCliente({ idCrm, puedeEditar, demo, hoy }: { idCrm: string; puedeEditar: boolean; demo: boolean; hoy: string }) {
  const [wins, setWins] = useState<Win[] | null>(demo ? [] : null)
  const [errorLista, setErrorLista] = useState('')
  const [abierto, setAbierto] = useState(false)
  const cargar = useCallback(async () => {
    if (demo) return
    try {
      const r = await fetch(`/api/clientes/wins?cliente=${encodeURIComponent(idCrm)}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErrorLista(j.error ?? 'No se pudieron leer los wins.'); setWins([]); return }
      setErrorLista('')
      setWins(Array.isArray(j.wins) ? j.wins : [])
    } catch {
      setErrorLista('Sin conexión: no se pudieron leer los wins.')
      setWins([])
    }
  }, [idCrm, demo])
  useEffect(() => { const t = setTimeout(() => void cargar(), 0); return () => clearTimeout(t) }, [cargar])
  const { borrar, dialogo, error } = useBorrarWin(() => { void cargar() })

  return (
    <div className="pz">
      {dialogo}
      {demo && <p className="cj-texto-2">Datos de ejemplo: los wins no se leen ni se guardan.</p>}
      {errorLista && <p className="cj-aviso" role="alert">{errorLista}</p>}
      {error && <p className="cj-aviso" role="alert">{error}</p>}
      {wins === null ? <p className="cj-texto-2" role="status">Leyendo los wins…</p>
        : wins.length === 0 ? <p className="cj-texto-2">Todavía no hay wins cargados de este cliente.</p>
          : <ul className="pz-wins">{wins.map(w => <ItemWin key={w.id} w={w} alBorrar={puedeEditar && !demo ? borrar : undefined} />)}</ul>}
      {puedeEditar && (abierto
        ? <FormaWin idCrm={idCrm} hoy={hoy} demo={demo} alCerrar={() => setAbierto(false)} alGuardar={() => { setAbierto(false); void cargar() }} />
        : <div><Boton variante="secundario" onClick={() => setAbierto(true)}>Agregar win</Boton></div>)}
      {!puedeEditar && <p className="cj-texto-2">Cargar o borrar wins es de quienes usan las acciones de la tarjeta.</p>}
    </div>
  )
}

function FormaWin({ idCrm, hoy, demo, alCerrar, alGuardar }: { idCrm: string; hoy: string; demo: boolean; alCerrar: () => void; alGuardar: () => void }) {
  const [texto, setTexto] = useState('')
  const [fecha, setFecha] = useState(hoy)
  const [fuente, setFuente] = useState<FuenteWin>('whatsapp')
  const [autorizado, setAutorizado] = useState(false)
  const [captura, setCaptura] = useState<{ blob: Blob; url: string } | null>(null)
  const [estado, setEstado] = useState<{ tipo: 'trabajando' | 'error' | 'ok'; texto: string } | null>(null)
  // Una clave por formulario: si el guardado se reintenta, el servidor no duplica el win
  const [clave] = useState(nuevaClave)
  useEffect(() => () => { if (captura) URL.revokeObjectURL(captura.url) }, [captura])

  const tomarImagen = async (archivo: Blob | null | undefined) => {
    if (!archivo) return
    if (!/^image\//.test(archivo.type)) { setEstado({ tipo: 'error', texto: 'La captura tiene que ser una imagen.' }); return }
    setEstado({ tipo: 'trabajando', texto: 'Preparando la captura…' })
    const r = await achicar(archivo)
    if (!r) { setEstado({ tipo: 'error', texto: 'No se pudo leer la imagen. Probá con otra captura.' }); return }
    setCaptura(r)
    setEstado(null)
  }

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!texto.trim()) { setEstado({ tipo: 'error', texto: 'Pegá lo que dijo el cliente, textual.' }); return }
    if (demo) { setEstado({ tipo: 'ok', texto: 'Datos de ejemplo: no se guarda nada.' }); return }
    setEstado({ tipo: 'trabajando', texto: 'Guardando…' })
    try {
      const cuerpo = { clave, idCrm, fecha, texto, fuente, autorizado, captura: captura ? { base64: await aBase64(captura.blob) } : null }
      const r = await fetch('/api/clientes/wins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setEstado({ tipo: 'error', texto: j.error ?? 'No se pudo guardar.' }); return }
      alGuardar()
    } catch {
      setEstado({ tipo: 'error', texto: 'Sin conexión: no se guardó. Probá de nuevo.' })
    }
  }

  return (
    <form className="pz-forma" onSubmit={e => void guardar(e)} aria-label="Agregar win">
      <label className="pz-campo">
        <span className="cj-etiqueta">Lo que dijo el cliente, textual</span>
        <textarea className="pz-input" required maxLength={TOPE_TEXTO} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Pegá el mensaje tal cual lo escribió" />
      </label>
      <div className="pz-forma__fila">
        <label className="pz-campo">
          <span className="cj-etiqueta">Fecha</span>
          <input className="pz-input" type="date" required max={hoy} value={fecha} onChange={e => setFecha(e.target.value)} />
        </label>
        <label className="pz-campo">
          <span className="cj-etiqueta">De dónde salió</span>
          <select className="pz-input" value={fuente} onChange={e => setFuente(e.target.value as FuenteWin)}>
            {FUENTES_WIN.map(f => <option key={f} value={f}>{NOMBRE_FUENTE_WIN[f]}</option>)}
          </select>
        </label>
        <label className="pz-check">
          <input type="checkbox" checked={autorizado} onChange={e => setAutorizado(e.target.checked)} />
          <span>El cliente autorizó usarlo como caso de éxito</span>
        </label>
      </div>
      <div
        className="pz-pegar" tabIndex={0} role="group" aria-label="Captura del chat (opcional): pegala acá o elegí un archivo"
        onPaste={e => { const it = [...e.clipboardData.items].find(i => i.type.startsWith('image/')); if (it) { e.preventDefault(); void tomarImagen(it.getAsFile()) } }}
      >
        <span>Captura del chat (opcional): hacé clic acá y pegala con Ctrl+V o Cmd+V, o elegí un archivo.</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Elegir la captura" onChange={e => void tomarImagen(e.target.files?.[0])} />
        {captura && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
            <img className="pz-win__captura" src={captura.url} alt="Vista previa de la captura" />
            <span>{Math.round(captura.blob.size / 1024)} KB · <button type="button" className="pz-boton-texto" onClick={() => setCaptura(null)}>Quitar la captura</button></span>
          </>
        )}
      </div>
      {estado && <p className={estado.tipo === 'error' ? 'cj-aviso' : 'cj-texto-2'} role={estado.tipo === 'error' ? 'alert' : 'status'}>{estado.texto}</p>}
      <div className="pz-forma__fila">
        <Boton type="submit" variante="primario" disabled={estado?.tipo === 'trabajando'}>Guardar win</Boton>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
      </div>
    </form>
  )
}
