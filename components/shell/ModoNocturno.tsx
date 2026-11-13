'use client'

import { useEffect, useState } from 'react'
import { COOKIE_NOCHE, EVENTO_NOCHE } from './preferenciaNav'

// Interruptor del modo nocturno del cristal (2/11/2026). Cambia data-noche en .cj-raiz al instante (el CSS de
// components/shell/cristal.css hace el resto, también en la tarjeta del cliente, que va en un portal), lo deja en la cookie
// cj_noche (para que el servidor dibuje bien la próxima página, sin parpadeo) y en la cuenta (Neon, /api/preferencias),
// que es lo que manda en cualquier navegador. Mismo dato que el «Modo nocturno» de Finanzas.
export function ModoNocturno({ inicial, compacto = false }: { inicial: boolean; compacto?: boolean }) {
  const [noche, setNoche] = useState(inicial)
  // Si la cuenta trae otro modo (SincronizarNoche), el interruptor lo acompaña
  useEffect(() => {
    const alCambiar = (e: Event) => { if (typeof (e as CustomEvent).detail === 'boolean') setNoche((e as CustomEvent<boolean>).detail) }
    window.addEventListener(EVENTO_NOCHE, alCambiar)
    return () => window.removeEventListener(EVENTO_NOCHE, alCambiar)
  }, [])
  const alternar = () => {
    const nuevo = !noche
    setNoche(nuevo)
    document.querySelectorAll<HTMLElement>('.cj-raiz').forEach((r) => { r.dataset.noche = String(nuevo) })
    try { document.cookie = `${COOKIE_NOCHE}=${nuevo ? '1' : '0'}; path=/; max-age=31536000; samesite=lax` } catch { /* sin cookies: solo no se recuerda */ }
    fetch('/api/preferencias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noche: nuevo }), keepalive: true })
      .catch(() => { /* sin red: queda la cookie de este navegador */ })
  }
  return (
    <button type="button" role="switch" aria-checked={noche} className={`cj-noche${compacto ? ' cj-noche--compacto' : ''}`} onClick={alternar} title={compacto ? 'Modo nocturno' : undefined}>
      <svg className="cj-icono" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {noche ? <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
      </svg>
      <span className="cj-nav__txt">Modo nocturno</span>
      <span className="cj-noche__llave" aria-hidden="true"><span /></span>
    </button>
  )
}
