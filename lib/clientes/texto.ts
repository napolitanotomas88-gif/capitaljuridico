// ── Helpers de texto del CRM de clientes (puros) ───────────────────────────────────────────
import type { Celda } from './tipos'

export const txt = (c: Celda | undefined): string => (c ?? '').toString().trim()

// Minúsculas, sin acentos ni puntuación, espacios simples: sirve para encabezados y nombres
// ("Día 1" → "dia 1", "Duración (días)" → "duracion dias").
export const normTxt = (x: unknown): string => (x ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Teléfono → clave de 7 dígitos (sufijo, robusto a prefijos de país/área). Con varios números
// "a / b" devuelve la clave de cada uno. Mismo criterio que telKeyOf de lib/rawSheets.ts.
export function clavesTelefono(cel: unknown): string[] {
  return (cel ?? '').toString().split('/')
    .map(p => p.replace(/\D/g, ''))
    .filter(p => p.length >= 7)
    .map(p => p.slice(-7))
}

// Número desde una celda. Con UNFORMATTED_VALUE casi siempre ya es number; el texto solo aparece si
// la celda se cargó como texto. Misma lógica que amountFromCell de lib/rawSheets.ts (no se exporta):
// "625,00" / "1.212,93" (latino), "12.500" (miles latinos), "1417.42" (estándar). Vacío o ilegible → null.
export function aNumero(c: Celda | undefined): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  if (typeof c !== 'string') return null
  const limpio = c.replace(/[$\s]/g, '').trim()
  if (!limpio) return null
  let n: number
  if (/,\d{1,2}$/.test(limpio)) n = parseFloat(limpio.replace(/\./g, '').replace(',', '.'))
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) n = parseFloat(limpio.replace(/\./g, ''))
  else n = parseFloat(limpio.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

// Índice de columna (0 = A) → letra de Sheets ('A', 'Z', 'AA')
export function letraColumna(i: number): string {
  let n = i + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
