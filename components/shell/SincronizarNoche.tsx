'use client'

import { useEffect } from 'react'
import { COOKIE_NOCHE, EVENTO_NOCHE } from './preferenciaNav'

const CLAVE_SESION = 'cj-noche-sincronizado'

/**
 * El marco dibuja el modo nocturno con la cookie de este navegador, sin esperar a la base (velocidad, tanda 2). Después,
 * una vez por pestaña, pide a /api/preferencias lo que eligió la cuenta (que manda en cualquier navegador) y, si es otro,
 * corrige la cookie, el atributo data-noche de .cj-raiz (el CSS hace el resto) y el interruptor (evento cj:noche).
 * No dibuja nada. Lo que corrige es la cookie y el DOM: no depende de que el componente siga montado.
 */
export function SincronizarNoche({ noche }: { noche: boolean }) {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(CLAVE_SESION)) return
      sessionStorage.setItem(CLAVE_SESION, '1')
    } catch { /* sin sessionStorage: se sincroniza en cada carga completa */ }
    fetch('/api/preferencias', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ prefs?: { noche?: unknown } | null }>) : null))
      .then((j) => {
        const deCuenta = j?.prefs?.noche
        const final = typeof deCuenta === 'boolean' ? deCuenta : noche
        // Sin cookie todavía (primera vez en este navegador), se deja puesta: la próxima carga ya no espera a la base
        const sinCookie = !document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_NOCHE}=`))
        if (final === noche && !sinCookie) return
        try { document.cookie = `${COOKIE_NOCHE}=${final ? '1' : '0'}; path=/; max-age=31536000; samesite=lax` } catch { /* sin cookies */ }
        if (final === noche) return
        document.querySelectorAll<HTMLElement>('.cj-raiz').forEach((r) => { r.dataset.noche = String(final) })
        window.dispatchEvent(new CustomEvent(EVENTO_NOCHE, { detail: final }))
      })
      .catch(() => { /* sin red: queda la cookie */ })
  }, [noche])
  return null
}
