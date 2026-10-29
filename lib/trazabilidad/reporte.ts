// ── Reporte de trazabilidad: solo cuentas y porcentajes (puro, sin red) ─────────────────────────
// Lo que la clase pide mirar, en números: qué ángulo fue el GATILLO de la agenda (última pieza antes de agendar) contra
// en cuántos recorridos APARECE cada ángulo. Mucho en el recorrido y poco como gatillo = atrae; mucho como gatillo = dispara.
// Las etiquetas "Atrae / Dispara / Mixto" son una regla fija sobre esos dos números, no una opinión de la IA.
import type { Angulo, Arquetipo, Bolsa } from './catalogo'
import { META_N, TRAMOS_CICLO, tramoCiclo, type LeadTraz, type Origen } from './modelo'

export interface PiezaCatalogo { angulo: string | null }
type Piezas = Map<string, PiezaCatalogo>

/** Ángulo de una pieza: el del catálogo de piezas si está; si no, el que propuso el análisis */
export const anguloDePieza = (etiqueta: string, propuesto: string | null, piezas: Piezas) => piezas.get(etiqueta)?.angulo ?? propuesto ?? null

export interface FilaAngulo {
  id: string; nombre: string; bolsa: Bolsa | null; descartado: boolean
  gatillos: number; pctGatillo: number        // sobre leads con gatillo identificado
  presencia: number; pctPresencia: number     // sobre leads con setting analizado
  deCadaDiez: number | null                   // de cada 10 que lo consumieron, cuántos lo tuvieron de gatillo
  lectura: 'Atrae' | 'Dispara' | 'Mixto' | '—'
}

export interface Reporte {
  n: number; meta: number; direccional: boolean
  conSetting: number; conGatillo: number; conLlamada: number; contraste: number
  cobradoTotal: number
  angulos: FilaAngulo[]
  sinAngulo: { gatillos: number; presencia: number }
  piezasGatillo: { etiqueta: string; angulo: string | null; leads: number }[]
  origenes: { origen: Origen; leads: number; pct: number }[]
  ciclo: { tramo: string; leads: number; pct: number; anguloTipico: string | null }[]
  cicloMediana: number | null
  seguimientos: { mediana: number | null; promedio: number | null; conDato: number }
  bolsas: { bolsa: Bolsa | 'sin bolsa'; gatillos: number; pct: number }[]
  dolores: { tema: string; angulo: string | null; leads: number; citas: string[] }[]
  arquetipos: { arquetipo: Arquetipo; leads: number; pct: number }[]
  contrasteGatillos: { id: string; nombre: string; muestra: number; pctMuestra: number; contraste: number; pctContraste: number }[]
  individual: { clave: string; nombre: string; fecha: string | null; cobrado: number; concepto: string; pieza: string | null; angulo: string | null; ciclo: number | null; seguimientos: number | null; origen: Origen | null; capas: { setting: boolean; llamada: boolean } }[]
}

const pct = (a: number, b: number) => (b ? a / b : 0)
const mediana = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const moda = (xs: (string | null)[]) => {
  const c = new Map<string, number>()
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function gatilloDe(l: LeadTraz, piezas: Piezas): { etiqueta: string; angulo: string | null } | null {
  const a = l.setting?.analisis
  if (!a?.pieza_gatillo) return null
  const p = a.piezas.find((x) => x.etiqueta === a.pieza_gatillo)
  return { etiqueta: a.pieza_gatillo, angulo: anguloDePieza(a.pieza_gatillo, p?.angulo ?? null, piezas) }
}
const angulosDelRecorrido = (l: LeadTraz, piezas: Piezas) =>
  new Set((l.setting?.analisis?.piezas ?? []).map((p) => anguloDePieza(p.etiqueta, p.angulo, piezas)).filter((x): x is string => !!x))

/** Lectura fija sobre los dos números (no es una conclusión): ver encabezado del archivo */
//   · menos de 2 leads con el ángulo en el recorrido → sin lectura
//   · de cada 10 que lo consumieron, 5 o más lo tuvieron de gatillo → Dispara
//   · 2 o menos de cada 10, y aparece en al menos el 15 % de los recorridos → Atrae
//   · el resto → Mixto
export function lectura(pctPresencia: number, deCadaDiez: number | null, presencia: number): FilaAngulo['lectura'] {
  if (presencia < 2 || deCadaDiez === null) return '—'
  if (deCadaDiez >= 5) return 'Dispara'
  if (deCadaDiez <= 2 && pctPresencia >= 0.15) return 'Atrae'
  return 'Mixto'
}

export function armarReporte(leadsPeriodo: LeadTraz[], angulos: Angulo[], piezas: Piezas): Reporte {
  const muestra = leadsPeriodo.filter((l) => l.cierre.grupo === 'muestra')
  const contraste = leadsPeriodo.filter((l) => l.cierre.grupo === 'contraste')
  const conSetting = muestra.filter((l) => l.setting?.analisis)
  const conLlamada = muestra.filter((l) => l.llamada?.analisis)
  const gatillos = muestra.map((l) => gatilloDe(l, piezas))
  const conGatillo = gatillos.filter((g) => g !== null).length
  const nombre = new Map(angulos.map((a) => [a.id, a]))

  const filas: FilaAngulo[] = angulos.map((a) => {
    const g = gatillos.filter((x) => x?.angulo === a.id).length
    const p = conSetting.filter((l) => angulosDelRecorrido(l, piezas).has(a.id)).length
    const pg = pct(g, conGatillo), pp = pct(p, conSetting.length)
    const dcd = p ? Math.round((g / p) * 10) : null
    return { id: a.id, nombre: a.nombre, bolsa: a.bolsa, descartado: a.descartado, gatillos: g, pctGatillo: pg, presencia: p, pctPresencia: pp, deCadaDiez: dcd, lectura: lectura(pp, dcd, p) }
  }).filter((f) => f.gatillos || f.presencia).sort((x, y) => y.gatillos - x.gatillos || y.presencia - x.presencia)

  const contarPiezas = new Map<string, { angulo: string | null; leads: number }>()
  for (const g of gatillos) if (g) contarPiezas.set(g.etiqueta, { angulo: g.angulo, leads: (contarPiezas.get(g.etiqueta)?.leads ?? 0) + 1 })

  const origenes = new Map<Origen, number>()
  for (const l of conSetting) origenes.set(l.setting!.analisis!.origen, (origenes.get(l.setting!.analisis!.origen) ?? 0) + 1)

  const ciclos = conSetting.map((l) => ({ dias: l.setting!.analisis!.ciclo_dias, angulo: gatilloDe(l, piezas)?.angulo ?? null }))
  const conCiclo = ciclos.filter((c) => c.dias != null)
  const segs = conSetting.map((l) => l.setting!.analisis!.seguimientos).filter((x): x is number => x != null)

  const porBolsa = new Map<Bolsa | 'sin bolsa', number>()
  for (const g of gatillos) if (g) {
    const b = (g.angulo && nombre.get(g.angulo)?.bolsa) || 'sin bolsa'
    porBolsa.set(b, (porBolsa.get(b) ?? 0) + 1)
  }

  // Dolores de las llamadas: agrupados por ángulo del catálogo o, si no tiene, por tema (los ángulos NUEVOS)
  const dolores = new Map<string, { tema: string; angulo: string | null; leads: Set<string>; citas: string[] }>()
  for (const l of conLlamada) for (const d of l.llamada!.analisis!.dolores) {
    const k = d.angulo ? `a:${d.angulo}` : `t:${d.tema.toLowerCase().trim()}`
    const e = dolores.get(k) ?? { tema: d.angulo ? nombre.get(d.angulo)?.nombre ?? d.tema : d.tema, angulo: d.angulo, leads: new Set(), citas: [] }
    e.leads.add(l.cierre.clave)
    if (e.citas.length < 3 && d.cita) e.citas.push(d.cita)
    dolores.set(k, e)
  }
  const arq = new Map<Arquetipo, number>()
  for (const l of conLlamada) arq.set(l.llamada!.analisis!.arquetipo, (arq.get(l.llamada!.analisis!.arquetipo) ?? 0) + 1)

  const gatContraste = contraste.map((l) => gatilloDe(l, piezas)).filter((g) => g !== null)
  const contrasteGatillos = angulos.map((a) => {
    const m = gatillos.filter((x) => x?.angulo === a.id).length, c = gatContraste.filter((x) => x?.angulo === a.id).length
    return { id: a.id, nombre: a.nombre, muestra: m, pctMuestra: pct(m, conGatillo), contraste: c, pctContraste: pct(c, gatContraste.length) }
  }).filter((x) => x.muestra || x.contraste).sort((a, b) => b.muestra - a.muestra)

  return {
    n: muestra.length, meta: META_N, direccional: muestra.length < META_N,
    conSetting: conSetting.length, conGatillo, conLlamada: conLlamada.length, contraste: contraste.length,
    cobradoTotal: muestra.reduce((s, l) => s + l.cierre.cobrado, 0),
    angulos: filas,
    sinAngulo: { gatillos: gatillos.filter((g) => g && !g.angulo).length, presencia: conSetting.filter((l) => (l.setting!.analisis!.piezas ?? []).some((p) => !anguloDePieza(p.etiqueta, p.angulo, piezas))).length },
    piezasGatillo: [...contarPiezas].map(([etiqueta, v]) => ({ etiqueta, ...v })).sort((a, b) => b.leads - a.leads).slice(0, 15),
    origenes: [...origenes].map(([origen, n]) => ({ origen, leads: n, pct: pct(n, conSetting.length) })).sort((a, b) => b.leads - a.leads),
    ciclo: TRAMOS_CICLO.map((t) => {
      const en = conCiclo.filter((c) => tramoCiclo(c.dias)?.id === t.id)
      return { tramo: t.etiqueta, leads: en.length, pct: pct(en.length, conCiclo.length), anguloTipico: moda(en.map((c) => c.angulo)) }
    }),
    cicloMediana: mediana(conCiclo.map((c) => c.dias!)),
    seguimientos: { mediana: mediana(segs), promedio: segs.length ? segs.reduce((a, b) => a + b, 0) / segs.length : null, conDato: segs.length },
    bolsas: [...porBolsa].map(([bolsa, n]) => ({ bolsa, gatillos: n, pct: pct(n, conGatillo) })).sort((a, b) => b.gatillos - a.gatillos),
    dolores: [...dolores.values()].map((d) => ({ tema: d.tema, angulo: d.angulo, leads: d.leads.size, citas: d.citas })).sort((a, b) => b.leads - a.leads),
    arquetipos: [...arq].map(([arquetipo, n]) => ({ arquetipo, leads: n, pct: pct(n, conLlamada.length) })).sort((a, b) => b.leads - a.leads),
    contrasteGatillos,
    individual: muestra.map((l) => {
      const g = gatilloDe(l, piezas), a = l.setting?.analisis
      return {
        clave: l.cierre.clave, nombre: l.cierre.nombre, fecha: l.cierre.fecha, cobrado: l.cierre.cobrado, concepto: l.cierre.concepto,
        pieza: g?.etiqueta ?? null, angulo: g?.angulo ?? null, ciclo: a?.ciclo_dias ?? null, seguimientos: a?.seguimientos ?? null, origen: a?.origen ?? null,
        capas: { setting: !!a, llamada: !!l.llamada?.analisis },
      }
    }),
  }
}
