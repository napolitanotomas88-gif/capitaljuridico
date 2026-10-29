'use client'

import { useState } from 'react'
import { esGrabacionInactiva } from './tablero'

// ── Tracker de grabaciones por cliente (para el asistente de operaciones) ──
// Fuente: sheet "Guiones y Videos" → pestaña "Guiones para realizar":
// col A cliente ("Guiones - X"), col D día en que se hicieron los guiones,
// col E "Grabación hecha?" (X o fecha), col F "Fecha de grabación".
// Muestra hace cuántos días grabó cada cliente, quién tiene guiones listos
// esperando y quién nunca grabó; los más urgentes arriba.

export interface GrabacionCliente {
  cliente: string
  ultimaGrabacion: string | null   // 'YYYY-MM-DD' última grabación con fecha
  fechaAproximada: boolean         // true si salió de la col D (no de la col F / fecha en E)
  diasDesdeGrabacion: number | null
  grabado: boolean                 // alguna fila con E marcada (X o fecha)
  guionesListos: string | null     // 'YYYY-MM-DD' guiones más recientes todavía sin grabar
  diasEsperando: number | null
  nota: string | null              // texto libre de col E ("mañana", "desp del 23 se graba")
  estadoClickUp: string | null
  aliasSinResolver: boolean
  inactiva?: boolean               // nota tipo "no mandar"/"no grabar"/"pausa"/"baja": fuera del ranking de urgencia
}

type Filtro = 'todos' | 'atrasados' | 'listos' | 'sinFecha' | 'nunca' | 'inactivas'

type Chip = { texto: string; color: string; bg: string }

// Etapas de ClickUp previas a grabar (el cliente todavía no tiene guiones para grabar)
const PREPRODUCCION = /espera.*t[oó]pico|guionizar|opt.*gui|onboarding|nuevo cliente/i

const dm = (ymd: string) => `${Number(ymd.slice(8, 10))}/${Number(ymd.slice(5, 7))}`

const nuncaGrabo = (g: GrabacionCliente) => !g.grabado && g.ultimaGrabacion == null
const sinFecha = (g: GrabacionCliente) => g.grabado && g.ultimaGrabacion == null
const enPreparacion = (g: GrabacionCliente) => nuncaGrabo(g) && !g.guionesListos && !!g.estadoClickUp && PREPRODUCCION.test(g.estadoClickUp)

// Orden: lo que hay que mover primero (atrasados, guiones esperando, nunca grabó); inactivas al final
function rango(g: GrabacionCliente): number {
  if (esGrabacionInactiva(g)) return 7
  const d = g.diasDesdeGrabacion
  if (d != null && d > 30) return 0
  if (g.guionesListos) return 1
  if (nuncaGrabo(g) && !enPreparacion(g)) return 2
  if (sinFecha(g)) return 3
  if (d != null && d > 14) return 4
  if (enPreparacion(g)) return 5
  return 6
}

// Chip del estado de grabación (null si el cliente nunca grabó: ahí manda el chip de guiones)
function chipGrabacion(g: GrabacionCliente): Chip | null {
  const d = g.diasDesdeGrabacion
  if (g.ultimaGrabacion && d != null) {
    const fecha = `${g.fechaAproximada ? '≈' : ''}${dm(g.ultimaGrabacion)}`
    if (d > 30) return { texto: `grabó hace ${d}d (${fecha})`, color: '#fff', bg: '#7f202c' }
    if (d > 14) return { texto: `grabó hace ${d}d (${fecha})`, color: '#fff', bg: '#805c29' }
    return { texto: `grabó hace ${d}d (${fecha})`, color: '#fff', bg: '#1f6b52' }
  }
  if (g.grabado) return { texto: '✓ grabó · falta la fecha (col F)', color: 'var(--text)', bg: 'color-mix(in srgb, var(--border) 60%, transparent)' }
  return null
}

const CHIP_GRIS = 'color-mix(in srgb, var(--border) 60%, transparent)'

function chips(g: GrabacionCliente): Chip[] {
  // Inactiva ("no mandar", pausa, baja): un solo chip gris, sin alertas de urgencia
  if (esGrabacionInactiva(g)) return [{ texto: 'no mandar/pausa', color: 'var(--text)', bg: CHIP_GRIS }]
  const out: Chip[] = []
  const grab = chipGrabacion(g)
  if (grab) out.push(grab)
  if (g.guionesListos) {
    out.push({
      texto: `guiones listos hace ${g.diasEsperando ?? 0}d — falta grabar`,
      color: '#fff', bg: (g.diasEsperando ?? 0) > 7 ? '#7f202c' : '#805c29',
    })
  } else if (!grab) {
    out.push(enPreparacion(g)
      ? { texto: '✍️ guiones en preparación', color: 'var(--text)', bg: 'color-mix(in srgb, var(--border) 60%, transparent)' }
      : { texto: 'nunca grabó', color: '#fff', bg: '#805c29' })
  }
  return out
}

export function GrabacionesPanel({ grabaciones }: { grabaciones: GrabacionCliente[] }) {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  if (!grabaciones.length) return null

  // Las inactivas no cuentan en los filtros de urgencia (solo en Todos, al final, y en su filtro)
  const activas = grabaciones.filter(g => !esGrabacionInactiva(g))
  const inactivas = grabaciones.filter(esGrabacionInactiva)
  const atrasados = activas.filter(g => g.diasDesdeGrabacion != null && g.diasDesdeGrabacion > 30)
  const listos = activas.filter(g => g.guionesListos != null)
  const faltaFecha = activas.filter(sinFecha)
  const nunca = activas.filter(nuncaGrabo)
  const FILTROS: { id: Filtro; label: string; n: number }[] = [
    { id: 'todos', label: 'Todos', n: grabaciones.length },
    { id: 'atrasados', label: '+30 días', n: atrasados.length },
    { id: 'listos', label: 'Listos para grabar', n: listos.length },
    { id: 'sinFecha', label: '✓ Sin fecha cargada', n: faltaFecha.length },
    { id: 'nunca', label: 'Nunca grabó', n: nunca.length },
    ...(inactivas.length ? [{ id: 'inactivas' as Filtro, label: 'No mandar/pausa', n: inactivas.length }] : []),
  ]
  const base = filtro === 'atrasados' ? atrasados
    : filtro === 'listos' ? listos
    : filtro === 'sinFecha' ? faltaFecha
    : filtro === 'nunca' ? nunca
    : filtro === 'inactivas' ? inactivas
    : grabaciones
  const visibles = base.slice().sort((a, b) =>
    rango(a) - rango(b) ||
    (b.diasDesdeGrabacion ?? -1) - (a.diasDesdeGrabacion ?? -1) ||
    (b.diasEsperando ?? -1) - (a.diasEsperando ?? -1) ||
    a.cliente.localeCompare(b.cliente))

  return (
    <section className="mb-6">
      <div className="glass-board" style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            Grabaciones — clientes
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTROS.map(f => (
              <button key={f.id} onClick={() => setFiltro(f.id)}
                style={{
                  padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: '1.5px solid ' + (filtro === f.id ? 'var(--brand-orange)' : 'var(--border)'),
                  background: filtro === f.id ? 'var(--brand-orange)' : 'transparent',
                  color: filtro === f.id ? 'var(--on-brand)' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}>
                {f.label} · {f.n}
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 14 }}>Nada para mostrar con este filtro </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {visibles.map((g, i) => {
              const cs = chips(g)
              return (
                <div key={g.cliente + i} className="glass-alert" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, borderLeft: `3px solid ${cs[0]?.bg ?? 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{g.cliente}</p>
                    {g.estadoClickUp && (
                      <span style={{ fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                        {g.estadoClickUp}
                      </span>
                    )}
                  </div>
                  {cs.map(ch => (
                    <span key={ch.texto} style={{
                      alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 8,
                      fontSize: 11.5, fontWeight: 800, letterSpacing: '0.02em',
                      color: ch.color, background: ch.bg, fontVariantNumeric: 'tabular-nums',
                    }}>
                      {ch.texto}
                    </span>
                  ))}
                  {g.nota && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>&quot;{g.nota}&quot;</p>
                  )}
                  {g.aliasSinResolver && (
                    <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>alias del sheet sin cliente del CRM</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12 }}>
          Cuando graben: poner la fecha en la col F &quot;Fecha de grabación&quot; del sheet de Guiones (o la fecha en vez de la X en la col E) ·
          ≈ = fecha aproximada (día de los guiones, col D)
        </p>
      </div>
    </section>
  )
}
