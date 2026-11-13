'use client'

import { useEffect } from 'react'
import { TIEMPOS, escribirCifra, escudoDentroDelLogo, leerCifra, textoEn, vuelo, type Cifra, type EstadoEntrada } from './entradaLogica'

// La parte de la entrada que necesita medir y tocar la página ya hidratada (ver Entrada.tsx): el vuelo del escudo hasta el
// logo real de la barra, el contenido de a un bloque, las cifras que cuentan y los botones que se arman. Si el script en
// línea no marcó la entrada (ya se vio, movimiento reducido, sin sessionStorage) no hace nada. Todo lo que agrega
// (animaciones, textos, un atributo en el botón principal) se deshace al terminar o al saltarla: no queda nada en línea.

const CURVA = 'cubic-bezier(.22,1,.36,1)'
const CELULAR = '(max-width: 768px)'
const CIFRAS = '[data-cuenta], .cj-dato__valor, .rc-barra__n'

/** ¿React ya hidrató este nodo? Tocar texto o atributos de un bloque que todavía no se hidrató (Suspense) provocaría un error
 *  de hidratación; si no se puede saber, no se toca (la entrada sigue igual, solo sin esa cifra o ese botón). */
const hidratado = (el: Element): boolean => Object.keys(el).some((k) => k.startsWith('__reactFiber$'))

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0
}

/** El único nodo de texto con dígitos de la cifra (los de unidad, como «%» en un span aparte, quedan como están) */
function textoDeCifra(el: Element): Text | null {
  const andar = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let hallado: Text | null = null
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    if (!/\d/.test(n.nodeValue ?? '')) continue
    if (hallado) return null // dos números: no es una cifra limpia
    hallado = n as Text
  }
  return hallado
}

/** Bloques de contenido: se baja mientras haya un solo hijo (plantilla, pila) y se toman los de ese nivel */
function bloques(pagina: Element): HTMLElement[] {
  let nivel: Element = pagina
  while (nivel.children.length === 1 && nivel.children[0].children.length > 0) nivel = nivel.children[0]
  return Array.from(nivel.children).filter((el): el is HTMLElement => el instanceof HTMLElement).slice(0, 12)
}

/** Caja del escudo en la barra: el isotipo (barra chica) o la parte del escudo dentro del logo completo (barra abierta) */
function destino(): DOMRect | { left: number; top: number; width: number; height: number } | null {
  const lateral = document.querySelector('.cj-lateral')
  const iso = lateral?.querySelector('.cj-logo-iso')
  if (iso && iso.getClientRects().length) return iso.getBoundingClientRect()
  const logo = lateral?.querySelector('.cj-logo')
  if (logo && logo.getClientRects().length) return escudoDentroDelLogo(logo.getBoundingClientRect())
  return null
}

export function EntradaCliente() {
  useEffect(() => {
    const e = (window as { __cjEntrada?: EstadoEntrada }).__cjEntrada
    const telon = document.getElementById('cj-telon')
    if (!e || e.listo || !telon) return

    const animaciones: Animation[] = []
    const relojes: number[] = []
    const cifras: { nodo: Text; original: string; ultimo: string; c: Cifra; desde: number }[] = []
    let principal: HTMLElement | null = null
    let cuadro = 0
    const falta = (t: number) => Math.max(0, t - (performance.now() - e.t0))
    const despues = (t: number, fn: () => void) => relojes.push(window.setTimeout(() => { try { fn() } catch { /* la red de seguridad deja todo normal */ } }, falta(t)))

    // Deja todo como es: sin animaciones, cifras con su texto EXACTO y el botón sin su atributo
    const limpiar = () => {
      relojes.forEach(clearTimeout)
      cancelAnimationFrame(cuadro)
      animaciones.forEach((a) => a.cancel())
      for (const c of cifras) if (c.nodo.nodeValue === c.ultimo) c.nodo.nodeValue = c.original
      principal?.removeAttribute('data-cje-boton')
    }
    e.alTerminar = limpiar

    // Vuelo del escudo al logo real de la barra, medido en el momento (barra chica o abierta). En el celular no hay barra
    // lateral: queda el vuelo de respaldo del CSS (sube y se desvanece). Si React llegó tarde, también.
    const escudo = telon.querySelector<HTMLElement>('.cj-telon__escudo')
    if (escudo && !window.matchMedia(CELULAR).matches && falta(TIEMPOS.vuelo) > 0) {
      despues(TIEMPOS.vuelo, () => {
        const hasta = destino()
        const alto = document.documentElement.clientHeight
        // Caja del escudo en el centro, sin la transformación: left 50 %, top 45 %, corrido -50 % / -58 % de su tamaño
        const w = escudo.offsetWidth, h = escudo.offsetHeight
        const desde = { left: window.innerWidth / 2 - w / 2, top: alto * 0.45 - h * 0.58, width: w, height: h }
        const v = hasta && vuelo(desde, hasta)
        if (!v) return
        animaciones.push(
          escudo.animate(
            [{ transform: 'translate(-50%, -58%)', opacity: 1 }, { transform: `translate(calc(-50% + ${v.dx}px), calc(-58% + ${v.dy}px)) scale(${v.s})`, opacity: 1 }],
            { duration: TIEMPOS.vueloDura, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'forwards' },
          ),
          escudo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: falta(TIEMPOS.aterriza), easing: 'ease', fill: 'both' }),
        )
      })
    }

    // Contenido, cifras y botones
    despues(TIEMPOS.bloques, () => {
      const pagina = document.querySelector('.cj-raiz .cj-pagina')
      if (!pagina) return
      const base = performance.now() - e.t0 - TIEMPOS.bloques // cuánto se atrasó este momento
      const enMs = (t: number) => Math.max(0, t - TIEMPOS.bloques - base)
      bloques(pagina).forEach((b, i) => {
        animaciones.push(b.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], {
          duration: TIEMPOS.bloqueDura, delay: enMs(TIEMPOS.bloques + i * TIEMPOS.bloquePaso), easing: CURVA, fill: 'backwards',
        }))
      })

      // Botones de la cabecera de la pantalla: se descubren de izquierda a derecha, de a uno
      const cabecera = pagina.querySelector('.cj-seccion') ?? bloques(pagina)[0]
      const botones = cabecera ? Array.from(cabecera.querySelectorAll<HTMLElement>('.cj-boton')).filter(visible).slice(0, 6) : []
      botones.forEach((b, i) => {
        animaciones.push(b.animate([{ opacity: 0, clipPath: 'inset(0 100% 0 0 round 12px)' }, { opacity: 1, clipPath: 'inset(0 0 0 0 round 12px)' }], {
          duration: TIEMPOS.botonDura, delay: enMs(TIEMPOS.botones + i * TIEMPOS.botonPaso), easing: CURVA, fill: 'backwards',
        }))
      })
      const prim = botones.find((b) => b.classList.contains('cj-boton--primario'))
      if (prim && hidratado(prim)) {
        principal = prim
        prim.setAttribute('data-cje-boton', 'bordo')
        despues(TIEMPOS.principal, () => prim.setAttribute('data-cje-boton', 'pasa'))
        // A mitad del pase el texto vuelve a su color (oscuro sobre marfil)
        despues(TIEMPOS.principal + TIEMPOS.principalDura / 2, () => prim.setAttribute('data-cje-boton', 'pasada'))
      }

      // Cifras: se lee el número ya escrito y se cuenta desde 0; al final queda el texto original tal cual
      Array.from(pagina.querySelectorAll(CIFRAS)).filter((el) => visible(el) && hidratado(el)).slice(0, 24).forEach((el) => {
        const nodo = textoDeCifra(el)
        const original = nodo?.nodeValue ?? ''
        const c = nodo ? leerCifra(original) : null
        if (!nodo || !c || c.valor === 0) return
        const ultimo = escribirCifra(c, 0)
        nodo.nodeValue = ultimo
        cifras.push({ nodo, original, ultimo, c, desde: performance.now() + enMs(TIEMPOS.cifras + cifras.length * TIEMPOS.cifraPaso) })
      })
      const paso = (ahora: number) => {
        let quedan = false
        for (const cifra of cifras) {
          if (cifra.nodo.nodeValue !== cifra.ultimo) continue // React lo cambió: es suyo, no se toca más
          const texto = textoEn(cifra.original, cifra.c, ahora - cifra.desde, TIEMPOS.cifraDura)
          if (texto !== cifra.original) quedan = true
          if (texto !== cifra.ultimo) cifra.nodo.nodeValue = cifra.ultimo = texto
        }
        if (quedan) cuadro = requestAnimationFrame(paso)
      }
      if (cifras.length) cuadro = requestAnimationFrame(paso)
      telon.setAttribute('data-contenido', '')
    })

    // Fin: todo queda en su estado normal (las animaciones ya terminaron; esto saca el telón y lo que se agregó)
    despues(TIEMPOS.fin, () => e.fin())
    // Al desmontar (en desarrollo, el doble montaje de StrictMode) se deshace lo hecho; el próximo montaje lo vuelve a armar.
    // Si el marco se desmontara de verdad a mitad de la entrada, la red de seguridad del script en línea la termina.
    return limpiar
  }, [])
  return null
}
