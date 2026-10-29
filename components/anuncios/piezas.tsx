'use client'

// Piezas visuales del tablero de anuncios (manual de marca Skyward: filetes finos, sin sombras,
// sin degradados; borgoña = alerta, latón = medio/acento, sala = OK).
import type { FilaAnuncio } from '@/lib/anuncios/tablero'
import { fmtGasto, fmtMonto } from '@/lib/anuncios/formato'

// Error (pago): barra hueso y etiqueta clara con ⚠ para que salte a la vista: hay que solucionarlo primero
export const COLOR: Record<FilaAnuncio['semaforo'], string> = { sin_gasto: 'var(--humo)', error: 'var(--hueso)', rojo: 'var(--borgona)', amarillo: 'var(--laton)', verde: 'var(--sala)' }
const NOMBRE: Record<FilaAnuncio['semaforo'], string> = { sin_gasto: 'Sin gasto', error: '\u26A0\uFE0E Error', rojo: 'Rojo', amarillo: 'Amarillo', verde: 'Verde' }

// Color de la barra de la fila: un error de pago NUEVO (menos de 3 días) va en azul
export const colorDe = (f: FilaAnuncio) => (f.semaforo === 'error' && f.pago.nuevo ? 'var(--azul)' : COLOR[f.semaforo])

export function Estado({ s, nuevo }: { s: FilaAnuncio['semaforo']; nuevo?: { desde: string; dia: number } | null }) {
  if (s === 'error' && nuevo) return (
    <span title={`Entró en error de pago el ${nuevo.desde.slice(8, 10)}/${nuevo.desde.slice(5, 7)}; pasa a error normal al día 4`} style={{ display: 'inline-block', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, padding: '4px 9px', whiteSpace: 'nowrap', background: 'var(--azul)', color: 'var(--tinta)', border: '1px solid var(--azul)' }}>
      {'\u26A0\uFE0E'} Error nuevo · día {nuevo.dia}/3
    </span>
  )
  const relleno = s !== 'amarillo' && s !== 'sin_gasto'
  if (s === 'error') return (
    <span style={{ display: 'inline-block', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, padding: '4px 9px', whiteSpace: 'nowrap', background: 'var(--hueso)', color: 'var(--borgona)', border: '1px solid var(--hueso)' }}>
      {NOMBRE[s]}
    </span>
  )
  return (
    <span
      style={{
        display: 'inline-block', fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600,
        padding: '4px 9px', whiteSpace: 'nowrap',
        background: relleno ? COLOR[s] : 'transparent', color: relleno ? 'var(--hueso)' : s === 'sin_gasto' ? 'var(--humo)' : 'var(--laton)',
        border: `1px solid ${s === 'verde' ? 'rgba(239,233,220,0.18)' : COLOR[s]}`,
      }}
    >
      {NOMBRE[s]}
    </span>
  )
}

const NIVEL: Record<FilaAnuncio['cpl']['nivel'], { txt: string; color: string }> = {
  ok: { txt: 'OK', color: 'var(--sala)' },
  medio: { txt: 'Medio', color: 'var(--laton)' },
  alto: { txt: 'Alto', color: 'var(--borgona)' },
  sin_ref: { txt: 'Sin referencia', color: 'var(--humo)' },
  sin_datos: { txt: 'Sin datos', color: 'transparent' },
}

export function NivelCPL({ f }: { f: FilaAnuncio }) {
  if (f.semaforo === 'sin_gasto' || f.semaforo === 'error') return <span className="etq" style={{ color: 'var(--humo)' }}>Sin evaluar</span>
  const n = NIVEL[f.cpl.nivel]
  return (
    <span className="etq" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
      <span style={{ width: 7, height: 7, background: n.color, border: f.cpl.nivel === 'sin_datos' ? '1px solid var(--humo)' : 'none', display: 'inline-block' }} />
      {n.txt}
    </span>
  )
}

export const cpl = (v: number | null, f: FilaAnuncio, gasto: number) =>
  v != null ? fmtMonto(v, f.moneda, { sinMoneda: true }) : gasto > 0 ? 'sin msj' : '—'

// CPL diario de las últimas 3 semanas (línea fina). Días hábiles: punto lleno; fin de semana / feriado: hueco.
// Días con gasto y sin mensajes: marca borgoña arriba.
export function Sparkline({ f, ancho = 112, alto = 26 }: { f: FilaAnuncio; ancho?: number; alto?: number }) {
  const s = f.serie.slice(0, -1)   // sin hoy (parcial)
  const vals = s.map(x => (x.m > 0 ? x.g / x.m : null))
  const conValor = vals.filter((v): v is number => v != null)
  if (conValor.length < 2) return <span className="etq" style={{ fontSize: 10 }}>sin serie</span>
  const orden = [...conValor].sort((a, b) => a - b)
  const max = orden[Math.floor(orden.length * 0.9)] * 1.15 || 1   // recorta picos para que no aplasten el resto
  const paso = ancho / (s.length - 1)
  const y = (v: number) => alto - 3 - Math.min(1, v / max) * (alto - 6)
  let d = ''
  vals.forEach((v, i) => { if (v != null) d += `${d && vals[i - 1] != null ? 'L' : 'M'}${(i * paso).toFixed(1)},${y(v).toFixed(1)}` })
  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} aria-label="CPL diario, últimas 3 semanas" role="img" style={{ display: 'block', overflow: 'visible' }}>
      <path d={d} fill="none" stroke="var(--humo)" strokeWidth={1} />
      {s.map((x, i) => x.x ? <rect key={`x${i}`} x={i * paso - 2} y={alto - 1} width={4} height={1.5} fill="var(--laton)" /> : null)}
      {vals.map((v, i) => v != null
        ? <circle key={i} cx={i * paso} cy={y(v)} r={1.6} fill={s[i].h ? 'var(--hueso)' : 'var(--tinta)'} stroke="var(--hueso)" strokeWidth={s[i].h ? 0 : 0.8} />
        : s[i].g > 0 ? <rect key={i} x={i * paso - 1} y={0} width={2} height={4} fill="var(--borgona)" /> : null)}
    </svg>
  )
}

export function Corriendo({ f }: { f: FilaAnuncio }) {
  if (f.pausado) return <span style={{ color: 'var(--humo)' }}>En pausa (CRM)</span>
  const c = f.corriendo
  if (c.sinAnunciosActivos) return <span style={{ color: 'var(--humo)' }}>Sin anuncios activos (Meta)</span>
  if (c.frenadaHace == null) return <span className="num">{c.dias}{c.desdeVentana ? '+' : ''} <span style={{ color: 'var(--humo)' }}>días</span></span>
  return <span style={{ color: 'var(--laton)' }}>{c.sinGastoEnVentana ? 'sin gasto en 35+ días' : `frenada hace ${c.frenadaHace} d`}</span>
}

export function Saldo({ f }: { f: FilaAnuncio }) {
  const s = f.saldo
  if (s.restante == null)
    return <span style={{ color: 'var(--humo)', fontSize: 12.5 }}>{f.pago.medio ? `sin límite · ${f.pago.medio}` : 'sin medio de pago'}</span>
  const urgente = s.restante <= 0 || (s.dias != null && s.dias <= 3)
  const dias = s.restante <= 0 ? 'sin saldo' : s.dias == null ? 'sin gasto reciente' : `~${Math.floor(s.dias)} días`
  return (
    <span className="num" style={{ display: 'inline-block', fontSize: 13.5, color: urgente ? 'var(--hueso)' : 'var(--humo)', borderLeft: urgente ? '2px solid var(--borgona)' : undefined, paddingLeft: urgente ? 6 : 0 }}>
      {s.fuente === 'limite' ? 'Límite' : 'Saldo'} {fmtGasto(Math.max(0, s.restante), f.moneda, { sinMoneda: true })} · {dias}
    </span>
  )
}

const GUION: Record<FilaAnuncio['guiones']['estado'], string> = { grabado: 'Grabado', pendiente: 'Pendiente de grabar', sin_guiones: 'Sin guiones', inactivo: 'En pausa' }
export const GUION_CORTO: Record<FilaAnuncio['guiones']['estado'], string> = { grabado: 'Grabados', pendiente: 'Falta grabar', sin_guiones: 'Sin guiones', inactivo: 'En pausa' }
export function GuionEstado({ f }: { f: FilaAnuncio }) {
  const e = f.guiones.estado
  return (
    <span title={f.guiones.detalle}>
      <span style={{ color: e === 'sin_guiones' ? 'var(--laton)' : e === 'grabado' ? 'var(--hueso)' : 'var(--humo)' }}>{GUION[e]}</span>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--humo)' }}>{f.guiones.detalle}</span>
    </span>
  )
}

export function Enlaces({ f }: { f: FilaAnuncio }) {
  return (
    <span style={{ display: 'inline-flex', gap: 14, flexWrap: 'wrap' }}>
      <a className="enlace" href={f.links.ads} target="_blank" rel="noopener noreferrer">Administrador de anuncios</a>
      {f.links.portfolio && <a className="enlace" href={f.links.portfolio} target="_blank" rel="noopener noreferrer">Portfolio</a>}
    </span>
  )
}
