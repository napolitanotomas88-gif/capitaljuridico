// ── Texto del semanal de setting para Discord (puro: se prueba sin red) ───────────────────────
// Solo cifras y nombres: qué pasó cada día y qué falta cargar. Nada de conclusiones (regla de la clase).
import type { DiaSemana } from './semanal'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
const pct = (a: number | null, b: number | null) => (a != null && b ? `${Math.round((a / b) * 100)} %` : '—')
const n = (x: number | null) => (x == null ? '—' : String(x))
const suma = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null)

export interface DatosSemanalTexto {
  domingo: string
  dias: DiaSemana[]
  botonera: { total: number; origenes: [string, number][] }
  cierres: { nombre: string; muestra: boolean; setting: boolean; llamada: boolean }[]
  url: string
}

export function textoSemanal(d: DatosSemanalTexto): string[] {
  const sabado = d.dias[6]?.fecha ?? d.domingo
  const ag = suma(d.dias.map((x) => x.agendas)), cal = suma(d.dias.map((x) => x.calendarios))
  const out = suma(d.dias.map((x) => x.outbound)), rec = suma(d.dias.map((x) => x.recursos))
  const partes = [
    `📊 **Semanal de setting · ${dm(d.domingo)} al ${dm(sabado)}**`,
    `Agendas **${n(ag)}** · calendarios ${n(cal)} (${pct(ag, cal)})\nOutbound a historias ${n(out)} · recursos enviados ${n(rec)} · respuesta ${pct(rec, out)}`,
    d.dias.map((x) => `\`${DIAS[new Date(`${x.fecha}T12:00:00Z`).getUTCDay()]} ${dm(x.fecha)}\` ${n(x.agendas)} ag · ${n(x.calendarios)} cal · ${n(x.outbound)} out · ${n(x.recursos)} rec`).join('\n'),
  ]
  partes.push(d.botonera.total
    ? `Agendas que pasaron por la botonera: **${d.botonera.total}**${d.botonera.origenes.length ? ` (${d.botonera.origenes.map(([o, k]) => `${o} ${k}`).join(' · ')})` : ''}`
    : 'Agendas que pasaron por la botonera: **0** — nadie tocó «Enviar al Despacho» esta semana.')
  const muestra = d.cierres.filter((c) => c.muestra)
  if (d.cierres.length) {
    const sinSet = muestra.filter((c) => !c.setting).map((c) => c.nombre)
    const sinLl = muestra.filter((c) => !c.llamada).length
    partes.push(`Cierres de la semana: **${d.cierres.length}** (${muestra.length} en la muestra)` +
      (sinSet.length ? `\nFalta el setting de: ${sinSet.join(', ')}` : muestra.length ? '\nTodos los de la muestra tienen setting.' : '') +
      (sinLl ? `\nSin llamada analizada: ${sinLl}` : ''))
  } else partes.push('Cierres de la semana: 0')
  partes.push(`Detalle: ${d.url}`)
  return partes
}
