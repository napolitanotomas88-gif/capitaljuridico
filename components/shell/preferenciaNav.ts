// Preferencia de la barra lateral (solo escritorio): abierta con un ancho elegido, o "chica" (solo íconos, para tener más
// lugar en las calls). Se guarda por persona en la cookie cj_nav ("chica:264" o "abierta:300") para que el servidor la
// dibuje bien desde el primer momento (sin parpadeo). Puro: lo usan el marco (servidor), la barra (cliente) y los tests.
export const COOKIE_NAV = 'cj_nav'
export const ANCHO_MIN = 200
export const ANCHO_MAX = 380
export const ANCHO_DEFECTO = 248
export const ANCHO_CHICA = 76
/** Arrastrando el borde por debajo de esto, la barra pasa a "chica" */
export const UMBRAL_CHICA = 150

export type PreferenciaNav = { chica: boolean; ancho: number }
export const PREFERENCIA_DEFECTO: PreferenciaNav = { chica: false, ancho: ANCHO_DEFECTO }

export const limitarAncho = (n: number): number => Math.round(Math.min(ANCHO_MAX, Math.max(ANCHO_MIN, n)))

/** Lee la cookie; cualquier cosa rara vuelve al valor por defecto (nunca rompe el marco). */
export function leerPreferencia(valor: string | undefined | null): PreferenciaNav {
  const m = /^(chica|abierta):(\d{2,4})$/.exec(String(valor ?? '').trim())
  if (!m) return PREFERENCIA_DEFECTO
  return { chica: m[1] === 'chica', ancho: limitarAncho(Number(m[2])) }
}

export const escribirPreferencia = (p: PreferenciaNav): string => `${p.chica ? 'chica' : 'abierta'}:${limitarAncho(p.ancho)}`

/** Ancho real de la barra según la preferencia (la "chica" conserva el ancho elegido para cuando se vuelva a abrir). */
export const anchoVisible = (p: PreferenciaNav): number => (p.chica ? ANCHO_CHICA : limitarAncho(p.ancho))

/** Resultado de arrastrar el borde hasta `x` px: por debajo del umbral se achica; si no, abre con ese ancho. */
export function alArrastrar(x: number, previa: PreferenciaNav): PreferenciaNav {
  if (x < UMBRAL_CHICA) return { chica: true, ancho: previa.ancho }
  return { chica: false, ancho: limitarAncho(x) }
}
