// ── "Días malos de Meta": días en que a CASI TODAS las cuentas les sube el CPL a la vez ─────────
// Si el costo por mensaje sube en una sola cuenta, el problema es de esa cuenta (anuncio, guion,
// público). Si sube en casi todas el mismo día, es Meta (subasta, cambios de algoritmo, caída): no
// hay que tocar guiones ni campañas por ese día. Este módulo detecta esos días con todas las cuentas
// juntas y las reglas (reglas.ts) los sacan de las tendencias, igual que los fines de semana.
//
// CÓMO SE DETECTA (ajustar acá):
//   Para cada día completo (hasta ayer) y cada cuenta que gastó ese día lo mínimo:
//     ratio = CPL de ese día / CPL de su base. La base es la misma cuenta en los días del MISMO TIPO
//     (hábil con hábil, fin de semana/feriado con fin de semana/feriado) de las 3-4 semanas previas,
//     sin contar días malos ya detectados. Gastó sin ningún mensaje → ratio 3 (tope).
//   El día es MALO si: hay 8+ cuentas comparables, al 55%+ le subió 30% o más, y la suba mediana de
//   todas es de 30% o más. (Calibrado con sep-2026: un día normal tiene 20-50% de cuentas subiendo
//   30%+ por puro ruido y mediana entre -10% y +27%; los días malos dieron 55-60% y +36% a +42%.) Así un fin de semana normal NO es día malo (se compara contra otros
//   fines de semana), pero un sábado peor que los sábados de siempre sí.
import { esHabil } from './feriados'
import { sumarDias } from './formato'
import type { DiaInsight } from './meta'

const MIN_CUENTAS = 8
const SUBA = 1.3               // "le subió": 30% o más sobre su base
const PARTE_MIN = 0.55         // al 55%+ de las cuentas
const MEDIANA_MIN = 1.3        // y la suba mediana es 30%+
const TOPE = 3                 // un ratio no cuenta más que x3 (y "sin mensajes" = x3)
const BASE_HABIL = 21          // días hacia atrás para la base de un día hábil
const BASE_FINDE = 28          // y para un sábado/domingo/feriado (hay menos)
const MIN_MSJ_BASE = 5

export interface DiaMeta {
  d: string
  tipo: 'habil' | 'finde'
  cuentas: number              // cuentas comparables ese día
  suben: number                // cuántas subieron 30%+
  parte: number                // suben / cuentas
  mediana: number              // ratio mediano (1,45 = +45%)
  malo: boolean
}

const gastoMinimoDia = (moneda: string, promedio: number) =>
  moneda === 'USD' ? 2 : moneda === 'ARS' ? 2000 : Math.max(promedio * 0.5, 0.01)

function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b), k = Math.floor(o.length / 2)
  return o.length % 2 ? o[k] : (o[k - 1] + o[k]) / 2
}

// porCuenta: insights diarios de todas las cuentas · monedas: moneda de cada cuenta · dias: cuántos
// días completos evaluar hacia atrás desde ayer (los que se ven en las líneas chicas del tablero)
export function detectarDiasMeta(porCuenta: Record<string, DiaInsight[]>, monedas: Record<string, string>, hoy: string, dias = 21): DiaMeta[] {
  const cuentas = Object.entries(porCuenta).map(([id, xs]) => {
    const mapa = new Map(xs.map(x => [x.d, x]))
    const conGasto = xs.filter(x => x.g > 0)
    const promedio = conGasto.length ? conGasto.reduce((a, x) => a + x.g, 0) / conGasto.length : 0
    return { id, mapa, minimo: gastoMinimoDia(monedas[id] ?? 'USD', promedio) }
  })
  const malos = new Set<string>()
  const out: DiaMeta[] = []
  // Del más viejo al más nuevo, para que la base de cada día no incluya días malos anteriores
  for (let i = dias; i >= 1; i--) {
    const d = sumarDias(hoy, -i)
    const habil = esHabil(d)
    const largoBase = habil ? BASE_HABIL : BASE_FINDE
    const ratios: number[] = []
    for (const c of cuentas) {
      const x = c.mapa.get(d)
      if (!x || x.g < c.minimo) continue
      let gB = 0, mB = 0
      for (let k = 1; k <= largoBase; k++) {
        const b = sumarDias(d, -k)
        if (esHabil(b) !== habil || malos.has(b)) continue
        const y = c.mapa.get(b)
        if (y) { gB += y.g; mB += y.m }
      }
      if (mB < MIN_MSJ_BASE || gB <= 0) continue
      const base = gB / mB
      ratios.push(x.m > 0 ? Math.min(TOPE, x.g / x.m / base) : TOPE)
    }
    if (!ratios.length) continue
    const suben = ratios.filter(r => r >= SUBA).length
    const parte = suben / ratios.length
    const med = mediana(ratios)
    const malo = ratios.length >= MIN_CUENTAS && parte >= PARTE_MIN && med >= MEDIANA_MIN
    if (malo) malos.add(d)
    out.push({ d, tipo: habil ? 'habil' : 'finde', cuentas: ratios.length, suben, parte, mediana: med, malo })
  }
  return out
}
