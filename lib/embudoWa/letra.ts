// Embudo formulario → WhatsApp: letra del lead con la MISMA matriz que la fórmula de la col Q "Lead Scoring" del CRM
// de ventas (desde el 12/11/2026, letras A a E). Si cambia la fórmula del CRM, cambiar esta matriz igual.
export const URGENCIAS = [
  'Lo quiero resolver YA mismo',
  'Quiero verlo en 2 - 4 semanas',
  'Quiero resolverlo en unos meses',
  'Aún no sé cuándo resolverlo',
] as const
export const FACTURACIONES = [
  '$0 - $750 USD',
  '$750 - $1.500 USD',
  '$1.500 - $3.000 USD',
  '$3.000 - $5.000 USD',
  '$5.000 - $15.000 USD',
  '$15.000 - $30.000 USD',
  'Más de $30.000 USD',
] as const
export type Letra = 'A' | 'B' | 'C' | 'D' | 'E'

// Filas: urgencia (YA, 2-4 sem, meses, no sé). Columnas: 0-750, "0 a 1500" (opción vieja), 750-1500, 1500-3000, 3000+.
const MATRIZ: Letra[][] = [
  ['C', 'C', 'B', 'A', 'C'],
  ['D', 'D', 'C', 'A', 'C'],
  ['E', 'E', 'D', 'C', 'D'],
  ['E', 'E', 'D', 'C', 'D'],
]

function columna(facturacion: string): number {
  const c = facturacion.replace(/[.\s]/g, '')
  if (c === '') return 0
  if (/^\$?0a\$?1500/.test(c)) return 1
  if (/^\$?0/.test(c)) return 0
  if (/^\$?750/.test(c)) return 2
  if (/^\$?1500(-|a)/.test(c)) return 3
  return 4
}

export function letraDe(urgencia: string, facturacion: string): Letra {
  const u = URGENCIAS.indexOf(urgencia.trim() as (typeof URGENCIAS)[number])
  return MATRIZ[u < 0 ? 3 : u][columna(facturacion)]
}

/** Las letras por las que optimiza la campaña: solo estas disparan el evento de conversión. */
export const calificada = (l: Letra) => l === 'A' || l === 'B'
