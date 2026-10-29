'use client'

import { useState } from 'react'
import type { FichaMarca } from '@/lib/edicion/tipos'
import type { PropuestaMarca } from '@/lib/edicion/db/marcaPropuestas'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'

// e05: la ficha de marca del cliente (paleta en hexadecimal, tipografías, logo, una referencia y la carpeta "Marca - X").
// La cargan Aylu y Tomás; de dónde salió cada dato queda a nombre de quien lo cambió (lo arma el servidor). No frena nada.
// Los límites y la validación de verdad son los de lib/edicion/marca.ts (bloque C): acá solo se ayuda a no equivocarse.
// Propuesta del bot (26/10): si la ficha no tiene colores y el vigía leyó algo de "Marca - X", se muestra con «Usar estos
// colores», que abre el formulario ya cargado (con el archivo como referencia). Se guarda recién cuando Aylu toca Guardar.
const MAX_COLORES = 12
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const idCarpeta = (url: string): string | null => /\/folders\/([A-Za-z0-9_-]{10,200})/.exec(url)?.[1] ?? null

export function FormMarca({ idCrm, ficha, lecturas = [], demo }: { idCrm: string; ficha: FichaMarca | null; lecturas?: PropuestaMarca[]; demo: boolean }) {
  // La propuesta más nueva con colores; si no hay, el último archivo de Marca que no se pudo usar (para pedirlo de nuevo)
  const propuesta = lecturas.find(l => l.estado === 'propuesta' && l.colores.length) ?? null
  const problema = !propuesta ? lecturas.find(l => l.estado === 'error' || l.estado === 'sin_colores') ?? null : null
  const { enviando, msj, setMsj, enviar } = useEnvio(demo)
  const [abierto, setAbierto] = useState(false)
  const [colores, setColores] = useState(ficha?.colores.length ? ficha.colores : [{ hex: '', nombre: '' }])
  const [tipografias, setTipografias] = useState((ficha?.tipografias ?? []).join(', '))
  const [logo, setLogo] = useState(ficha?.logo?.url ?? '')
  const [refUrl, setRefUrl] = useState(ficha?.referencia?.url ?? '')
  const [refDesc, setRefDesc] = useState(ficha?.referencia?.descripcion ?? '')
  const [carpeta, setCarpeta] = useState(ficha?.carpeta_marca?.url ?? '')
  const [notas, setNotas] = useState(ficha?.notas ?? '')
  const ofrecer = !!propuesta?.colores.length && !ficha?.colores.length
  function usarPropuesta() {
    if (!propuesta) return
    setColores(propuesta.colores.slice(0, MAX_COLORES).map(c => ({ hex: c.hex, nombre: c.nombre })))
    if (!tipografias.trim() && propuesta.tipografias.length) setTipografias(propuesta.tipografias.join(', '))
    if (!refUrl.trim()) { setRefUrl(`https://drive.google.com/file/d/${propuesta.drive_id}/view`); setRefDesc(`«${propuesta.nombre.slice(0, 120)}», de la carpeta Marca`) }
    setAbierto(true)
  }
  const cambiarColor = (i: number, c: Partial<{ hex: string; nombre: string }>) => setColores(xs => xs.map((x, k) => (k === i ? { ...x, ...c } : x)))

  async function guardar() {
    const cs = colores.filter(c => c.hex.trim())
    const malo = cs.find(c => !HEX.test(c.hex.trim()))
    if (malo) { setMsj({ texto: `«${malo.hex}» no es un color en hexadecimal (#1E4740).`, error: true }); return }
    let carpetaMarca: { id: string; url: string } | null = null
    if (carpeta.trim()) {
      const id = idCarpeta(carpeta.trim())
      if (!id) { setMsj({ texto: 'El link de la carpeta tiene que ser el de una carpeta de Drive (…/folders/…).', error: true }); return }
      carpetaMarca = { id, url: carpeta.trim() }
    }
    const fichaNueva = {
      colores: cs.map(c => ({ hex: c.hex.trim().startsWith('#') ? c.hex.trim() : `#${c.hex.trim()}`, nombre: c.nombre.trim() })),
      tipografias: tipografias.split(',').map(t => t.trim()).filter(Boolean),
      logo: logo.trim() ? { url: logo.trim(), drive_id: null } : null,
      referencia: refUrl.trim() ? { url: refUrl.trim(), descripcion: refDesc.trim() } : null,
      carpeta_marca: carpetaMarca, fuentes: {}, notas: notas.trim(),
    }
    const r = await enviar({ accion: 'marca_guardar', id_crm: idCrm, version: ficha?.version ?? null, ficha: fichaNueva })
    if (r?.ok) setAbierto(false)
  }

  if (!abierto) {
    return (
      <>
      {ofrecer && propuesta && (
        <div className="ed-panel-accion">
          <p className="cj-etiqueta cj-etiqueta--laton">Propuesta del bot</p>
          <p>Leída de «{propuesta.nombre}», que el cliente subió a la carpeta Marca{propuesta.nota ? ` (${propuesta.nota})` : ''}. Revisala antes de guardarla.</p>
          <ul className="ed-paleta ed-paleta--grande">
            {propuesta.colores.map(c => (
              <li key={c.hex}><span className="ed-muestra" style={{ background: c.hex }} aria-hidden="true" /><span>{c.nombre ? `${c.nombre} · ` : ''}{c.hex}</span></li>
            ))}
          </ul>
          {propuesta.tipografias.length > 0 && <p>Tipografías: {propuesta.tipografias.join(', ')}</p>}
          <div className="ed-botones"><button type="button" className="cj-boton cj-boton--primario" onClick={usarPropuesta}>Usar estos colores</button></div>
        </div>
      )}
      {problema && !ficha?.colores.length && (
        <p className="ed-vacio">Marca: «{problema.nombre}» no sirvió para la paleta{problema.nota ? ` (${problema.nota})` : ''}. Pedíselo al cliente en otro formato.</p>
      )}
      <div className="ed-botones">
        <button type="button" className="cj-boton cj-boton--secundario" onClick={() => setAbierto(true)}>{ficha ? 'Editar la ficha de marca' : 'Cargar la ficha de marca'}</button>
        <Mensaje msj={msj} enviando={enviando} />
      </div>
      </>
    )
  }
  return (
    <div className="ed-form ed-panel-accion">
      <p className="cj-etiqueta cj-etiqueta--laton">Ficha de marca</p>
      <fieldset className="ed-opciones" style={{ flexDirection: 'column' }}>
        <legend>Paleta (hexadecimal)</legend>
        {colores.map((c, i) => (
          <div key={i} className="ed-form__fila">
            <span className="ed-muestra" style={{ background: HEX.test(c.hex.trim()) ? (c.hex.trim().startsWith('#') ? c.hex.trim() : `#${c.hex.trim()}`) : 'transparent' }} aria-hidden="true" />
            <label className="ed-campo ed-campo--chico"><span>Hex</span><input value={c.hex} maxLength={7} placeholder="#1E4740" onChange={e => cambiarColor(i, { hex: e.target.value })} autoComplete="off" /></label>
            <label className="ed-campo"><span>Nombre</span><input value={c.nombre} maxLength={60} placeholder="Verde petróleo" onChange={e => cambiarColor(i, { nombre: e.target.value })} autoComplete="off" /></label>
            <button type="button" className="cj-chip" onClick={() => setColores(xs => (xs.length > 1 ? xs.filter((_, k) => k !== i) : [{ hex: '', nombre: '' }]))}>Quitar</button>
          </div>
        ))}
        {colores.length < MAX_COLORES && <div><button type="button" className="cj-chip" onClick={() => setColores(xs => [...xs, { hex: '', nombre: '' }])}>Otro color</button></div>}
      </fieldset>
      <label className="ed-campo"><span>Tipografías (separadas por coma)</span><input value={tipografias} onChange={e => setTipografias(e.target.value)} placeholder="Montserrat, Playfair Display" autoComplete="off" /></label>
      <label className="ed-campo"><span>Logo (link https)</span><input type="url" inputMode="url" value={logo} onChange={e => setLogo(e.target.value)} autoComplete="off" /></label>
      <div className="ed-form__fila">
        <label className="ed-campo"><span>Referencia (link https)</span><input type="url" inputMode="url" value={refUrl} onChange={e => setRefUrl(e.target.value)} autoComplete="off" /></label>
        <label className="ed-campo"><span>Qué es</span><input value={refDesc} maxLength={300} onChange={e => setRefDesc(e.target.value)} placeholder="captura de la web del estudio" autoComplete="off" /></label>
      </div>
      <label className="ed-campo"><span>Carpeta «Marca - …» en Drive (link)</span><input type="url" inputMode="url" value={carpeta} onChange={e => setCarpeta(e.target.value)} autoComplete="off" /></label>
      <label className="ed-campo"><span>Notas</span><textarea value={notas} maxLength={1000} rows={2} onChange={e => setNotas(e.target.value)} /></label>
      <div className="ed-botones">
        <button type="button" className="cj-boton cj-boton--primario" disabled={enviando} onClick={() => void guardar()}>Guardar la ficha</button>
        <button type="button" className="cj-boton cj-boton--secundario" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}
