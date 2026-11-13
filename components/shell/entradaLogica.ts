// ── Entrada animada del Despacho (13/11/2026): lógica pura, sin React ni DOM ─────────────────────────────────
// Va aparte de Entrada.tsx (que en macOS chocaría con «entrada.ts»). La usan components/shell/Entrada.tsx (telón + script en línea) y EntradaCliente.tsx (vuelo, cifras y botones).
// Se prueba en scripts/test-entrada.mjs.

/** Clave de sessionStorage: con ella puesta, este navegador ya vio la entrada en esta sesión */
export const CLAVE_VISTA = 'cj-entrada-vista'

/**
 * Tiempos de la secuencia, en ms desde que el script en línea marcó el telón (los mismos de la maqueta aprobada).
 * El telón (escudo que se construye, nombre y línea), la apertura en círculo y los íconos de la barra van en entrada.css;
 * estos son los de la parte que maneja EntradaCliente.
 */
export const TIEMPOS = {
  vuelo: 3150, // el escudo sale del centro hacia el logo de la barra
  vueloDura: 1700,
  aterriza: 4850, // el escudo de la barra aparece y el que voló se desvanece
  bloques: 4300, // contenido: un bloque cada 150 ms
  bloquePaso: 150,
  bloqueDura: 1100,
  cifras: 4500, // cifras: cuentan desde 0, una cada 150 ms
  cifraPaso: 150,
  cifraDura: 1900,
  botones: 4500, // botones: se arman de izquierda a derecha, uno cada 260 ms
  botonPaso: 260,
  botonDura: 1200,
  principal: 5900, // el botón principal pasa de bordó a marfil
  principalDura: 1800,
  fin: 7900, // todo quedó en su estado normal
  /** Red de seguridad del script en línea: si la parte de React nunca llega, a los 9,5 s la página queda normal igual */
  seguridad: 9500,
} as const

/**
 * Script en línea que va justo después del telón, ANTES de que se pinte el resto del marco. Es lo único que corre antes
 * de React: decide si es el primer ingreso de la sesión del navegador y, si lo es, marca el telón (data-fase="anda"),
 * con lo que entrada.css esconde la página y arranca la secuencia. Si no (ya se vio, movimiento reducido o el
 * navegador no deja usar sessionStorage), no toca nada y el telón queda oculto: la página se pinta como siempre.
 * Además deja `window.__cjEntrada` con el reloj y `fin()`, que salta al estado final (clic, tecla o la red de seguridad).
 */
export const SCRIPT_ENTRADA = `(function(){try{var d=document,t=d.getElementById('cj-telon'),w=window;if(!t)return;var s=w.sessionStorage;if(s.getItem('${CLAVE_VISTA}'))return;s.setItem('${CLAVE_VISTA}','1');if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;var e={t0:w.performance.now(),listo:false,alTerminar:null};function fin(){if(e.listo)return;e.listo=true;clearTimeout(e.r);w.removeEventListener('pointerdown',fin,true);w.removeEventListener('keydown',fin,true);t.removeAttribute('data-fase');t.removeAttribute('data-contenido');if(e.alTerminar)try{e.alTerminar()}catch(x){}}e.fin=fin;e.r=setTimeout(fin,${TIEMPOS.seguridad});w.addEventListener('pointerdown',fin,true);w.addEventListener('keydown',fin,true);w.__cjEntrada=e;t.setAttribute('data-fase','anda')}catch(x){}})()`

/** Lo que el script en línea deja en window para la parte de React */
export type EstadoEntrada = { t0: number; listo: boolean; alTerminar: (() => void) | null; fin: () => void }

// ── Cifras que cuentan ─────────────────────────────────────────────────────────────────────────────────────────────

/** Un número «limpio» leído del texto ya renderizado: prefijo + número + sufijo, sin nada más */
export type Cifra = {
  prefijo: string
  sufijo: string
  /** Valor absoluto (el signo, si hay, queda en el prefijo) */
  valor: number
  decimales: number
  /** Separador de miles del original ('' si no tenía) */
  miles: string
  /** Separador decimal del original (',' o '.') */
  coma: string
}

// Prefijos y sufijos admitidos: moneda o signo adelante; %, unidad corta o «k» atrás. Cualquier otra cosa (fechas, «3 de 5»,
// rangos, horas, texto) no es un número limpio y no se toca.
const PREFIJO = String.raw`(\s*(?:[+\-−]\s?)?(?:USD|US\$|ARS|AR\$|\$|€)?\s?)`
const NUMERO = String.raw`(\d{1,3}(?:([.,   ])\d{3})+|\d+)(?:([.,])(\d+))?`
const SUFIJO = String.raw`(\s?(?:%|k|K|M|x|×)?\s*)`
const PATRON = new RegExp(`^${PREFIJO}${NUMERO}${SUFIJO}$`)

/** Lee un número limpio del texto; null si no lo es (y entonces la entrada no lo anima) */
export function leerCifra(texto: string): Cifra | null {
  if (!texto || texto.length > 24) return null
  const m = PATRON.exec(texto)
  if (!m) return null
  const [, prefijo, entero, miles = '', coma = '', fraccion = '', sufijo] = m
  // «1.500,5» o «1,500.5»: el decimal tiene que ser el otro separador
  if (miles && coma && miles === coma) return null
  // Un solo grupo de 3 tras un punto o coma sin miles («1.500», «2,500») es separador de miles en es-AR: ya lo tomó el grupo
  const valor = Number(entero.split(miles || '\u0000').join('') + (fraccion ? `.${fraccion}` : ''))
  if (!Number.isFinite(valor)) return null
  return { prefijo, sufijo, valor, decimales: fraccion.length, miles, coma: coma || (miles === '.' ? ',' : '.') }
}

/** Escribe un valor intermedio con el mismo formato que el original (separadores, decimales, prefijo y sufijo) */
export function escribirCifra(c: Cifra, valor: number): string {
  const fijo = Math.abs(valor).toFixed(c.decimales)
  const [ent, frac] = fijo.split('.')
  const entero = c.miles ? ent.replace(/\B(?=(\d{3})+(?!\d))/g, c.miles) : ent
  return `${c.prefijo}${entero}${frac ? c.coma + frac : ''}${c.sufijo}`
}

/** Curva de la cuenta: arranca rápido y llega despacio (la de la maqueta) */
export const suavizar = (p: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 4)

/**
 * Texto de la cifra en el instante `t` (ms desde que empezó a contar). Al llegar a `dura` devuelve EXACTAMENTE el texto
 * original, no uno reescrito: así nunca queda una diferencia de formato.
 */
export function textoEn(original: string, c: Cifra, t: number, dura: number): string {
  if (t >= dura) return original
  return escribirCifra(c, c.valor * suavizar(t / dura))
}

// ── Vuelo del escudo ───────────────────────────────────────────────────────────────────────────────────────────────

type Caja = { left: number; top: number; width: number; height: number }

/**
 * Dónde está el escudo dentro del logo completo de la barra (public/marca/logo-claro.svg, viewBox 927,41 × 446,75):
 * ocupa la franja izquierda de 303,4 de ancho y toda la altura (es el isotipo escalado 0,5466 desde el origen).
 */
export const ESCUDO_EN_LOGO = 303.4 / 927.41

/** Caja del escudo dentro de la caja del logo completo (barra abierta) */
export function escudoDentroDelLogo(logo: Caja): Caja {
  return { left: logo.left, top: logo.top, width: logo.width * ESCUDO_EN_LOGO, height: logo.height }
}

/** Desplazamiento y escala para llevar el centro de `desde` al centro de `hasta` con el mismo ancho */
export function vuelo(desde: Caja, hasta: Caja): { dx: number; dy: number; s: number } | null {
  if (!(desde.width > 0) || !(hasta.width > 0)) return null
  return {
    dx: hasta.left + hasta.width / 2 - (desde.left + desde.width / 2),
    dy: hasta.top + hasta.height / 2 - (desde.top + desde.height / 2),
    s: hasta.width / desde.width,
  }
}
