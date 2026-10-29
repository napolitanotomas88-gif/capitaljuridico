// ── Períodos y renovaciones (reglas puras, sin dependencias) ──────────────────────────────
import { normTxt } from './texto'

// Extensión de servicio = período de Renovaciones con Notas que empiezan con "Extensión" y precio 0.
// No cuenta como renovación paga.
export const esExtension = (notas: string): boolean => normTxt(notas).startsWith('extension')

// Renovación PAGA = período > 0, que no sea extensión y con precio distinto de 0. Precio vacío
// (null) cuenta como paga: es un precio pendiente de cargar; un 0 explícito es "no se cobró"
// (renovación cancelada o extensión sin rotular).
export function esRenovacionPaga(p: { periodo: number; notas: string; precio: number | null }): boolean {
  return p.periodo > 0 && !esExtension(p.notas) && p.precio !== 0
}

// Columna "Renovó": 'R1', 'R2 +1 mes', 'NO', 'NO +2 meses'. Sin texto = todavía sin decisión.
export interface ParseRenovo { renovaciones: number; extensionMeses: number; noRenovo: boolean }
export function parsearRenovo(texto: string): ParseRenovo {
  const t = (texto ?? '').toString().trim()
  const m = /^(NO|R\s*(\d+)?)\s*(?:\+\s*(\d+)\s*mes)?/i.exec(t)
  if (!m) return { renovaciones: 0, extensionMeses: 0, noRenovo: false }
  const esNo = m[1].toUpperCase() === 'NO'
  return { renovaciones: esNo ? 0 : (m[2] ? +m[2] : 1), extensionMeses: m[3] ? +m[3] : 0, noRenovo: esNo }
}
