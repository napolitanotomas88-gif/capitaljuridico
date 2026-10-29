'use client'

import { useEffect, useSyncExternalStore } from 'react'
import './montos.css'

// "Ocultar montos / Mostrar montos" (26/10/2026, pedido de Tomás): para quien SÍ tiene Finanzas, tapa o destapa en pantalla
// todas las cifras envueltas con <Monto> (por ejemplo, para compartir pantalla). Solo visual: no cambia lo que manda el
// servidor (sin Finanzas los montos ni llegan). La preferencia se guarda por persona en este navegador (localStorage, en
// try/catch: en una ventana privada vuelve a "visibles") y se aplica con un <style id="cj-montos-ocultos"> en <head>, así
// sirve para la cartera, la tarjeta y la ficha a la vez. El <script> de abajo lo agrega antes de dibujar el resto de la página
// (un atributo en <html> rompía la hidratación de React; un <style> extra en <head> React lo tolera).
const CLAVE = 'cj-montos-ocultos'
const leer = (): boolean => { try { return localStorage.getItem(CLAVE) === '1' } catch { return false } }
const ID_ESTILO = 'cj-montos-ocultos'
const CSS_OCULTOS = '.cj-monto,.cj-monto *{color:transparent!important;text-shadow:none!important}.cj-monto{background:var(--cj-filete-fuerte,rgba(29,29,27,.28));border-radius:3px;user-select:none}'
const aplicar = (ocultos: boolean) => {
  const previo = document.getElementById(ID_ESTILO)
  if (ocultos && !previo) {
    const st = document.createElement('style')
    st.id = ID_ESTILO
    st.textContent = CSS_OCULTOS
    document.head.appendChild(st)
  } else if (!ocultos && previo) previo.remove()
}
const oyentes = new Set<() => void>()
const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f) } }
const SCRIPT = `try{if(localStorage.getItem('${CLAVE}')==='1'&&!document.getElementById('${ID_ESTILO}')){var s=document.createElement('style');s.id='${ID_ESTILO}';s.textContent=${JSON.stringify(CSS_OCULTOS)};document.head.appendChild(s)}}catch(e){}`

export function BotonMontos() {
  const ocultos = useSyncExternalStore(suscribir, leer, () => false)
  // Si se llegó navegando desde otra pantalla, el <script> no corre: se aplica la preferencia al montar
  useEffect(() => { aplicar(leer()) }, [])
  const cambiar = () => {
    const nuevo = !leer()
    try { localStorage.setItem(CLAVE, nuevo ? '1' : '0') } catch { /* sin almacenamiento: vale para esta vista */ }
    aplicar(nuevo)
    oyentes.forEach(f => f())
  }
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <button type="button" className="cj-boton-montos" aria-pressed={ocultos} onClick={cambiar}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ocultos
            ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 10 7a13 13 0 0 1-3.1 3.9M6.5 6.6C4.2 8 2.7 10.1 2 12c1 2 5 7 10 7 1.7 0 3.2-.5 4.6-1.2" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>
            : <><path d="M2 12c1-2 5-7 10-7s9 5 10 7c-1 2-5 7-10 7S3 14 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
        {ocultos ? 'Mostrar montos' : 'Ocultar montos'}
      </button>
    </>
  )
}
