import Link from 'next/link'
import { clases } from '@/components/ui/clases'

// Piezas chicas que comparten las pantallas de Trazabilidad.
const PESTANAS = [
  { href: '/trazabilidad', etiqueta: 'Cierres' },
  { href: '/trazabilidad/reporte', etiqueta: 'Reporte mensual' },
  { href: '/trazabilidad/formatos', etiqueta: 'Formatos' },
  { href: '/trazabilidad/semanal', etiqueta: 'Semanal de setting' },
  { href: '/trazabilidad/angulos', etiqueta: 'Ángulos y piezas' },
  { href: '/trazabilidad/botonera', etiqueta: 'Botonera' },
]

export function SubNav({ actual }: { actual: string }) {
  return (
    <nav className="traz-subnav" aria-label="Trazabilidad">
      {PESTANAS.map((p) => (
        <Link key={p.href} href={p.href} className="cj-chip" aria-current={p.href === actual ? 'page' : undefined}>{p.etiqueta}</Link>
      ))}
    </nav>
  )
}

export const usd = (n: number) => `USD ${Math.round(n).toLocaleString('es-AR')}`
export const pctTxt = (x: number) => `${(x * 100).toFixed(0)} %`
export const fechaCorta = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—')
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const nombreMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`
export const rutaLead = (clave: string) => `/trazabilidad/lead/${encodeURIComponent(clave)}`

export function Barra({ valor, texto, laton = false }: { valor: number; texto: string; laton?: boolean }) {
  return (
    <span className="traz-barra">
      <span className="traz-barra__pista" aria-hidden="true">
        <span className={clases('traz-barra__valor', laton && 'traz-barra__valor--laton')} style={{ width: `${Math.max(0, Math.min(1, valor)) * 100}%` }} />
      </span>
      <span className="traz-barra__num">{texto}</span>
    </span>
  )
}

export function Capa({ estado, titulo }: { estado: 'si' | 'no' | 'error'; titulo: string }) {
  return (
    <span className={clases('traz-capa', `traz-capa--${estado}`)} title={titulo} aria-label={titulo}>
      {estado === 'si' ? '●' : estado === 'error' ? '!' : '○'}
    </span>
  )
}

export function Direccional({ n, meta }: { n: number; meta: number }) {
  return (
    <p className="traz-texto traz-direccional">
      <strong>{n} cierres en la muestra.</strong> Con menos de {meta} el análisis es <strong>direccional</strong>: sirve para probar ángulos con
      cautela, no para sacar conclusiones estadísticas ni para cortar contenido de un día para el otro.
    </p>
  )
}
