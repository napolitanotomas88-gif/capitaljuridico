'use client'

// ── Analista: el negocio de arriba a abajo en frases cortas ──────────
// Va arriba de "Objetivos". Una línea de resumen + las 5 cosas más importantes
// (prioridad 1 primero); el resto detrás de "Ver todo". La lógica vive en
// lib/analista.ts, la misma que usa el cron que avisa por Discord.
import { useMemo, useState } from 'react'
import type { RawSerializada } from '@/lib/serializeRaw'
import { analizarNegocio, type Hallazgo } from '@/lib/analista'

const TOPE = 5

const COLOR: Record<Hallazgo['tipo'], string> = {
  oportunidad: 'var(--tono-bueno)', riesgo: 'var(--tono-malo)', dato: 'var(--text-muted)',
}
const ETIQUETA: Record<Hallazgo['prioridad'], string> = { 1: 'Importante', 2: 'A mirar', 3: 'Dato' }

function Tarjeta({ h }: { h: Hallazgo }) {
  const color = h.prioridad === 3 ? 'var(--text-muted)' : COLOR[h.tipo]
  return (
    <div className="glass-alert" style={{ padding: '12px 14px', borderLeft: `3px solid ${color}`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>
          <span style={{ marginRight: 6 }}>{h.icono}</span>{h.titulo}
        </p>
        <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {ETIQUETA[h.prioridad]}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{h.texto}</p>
      {h.accion && (
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5 }}>→ {h.accion}</p>
      )}
    </div>
  )
}

export function AnalystPanel({ raw, monthIdx, metaMensual }: { raw: RawSerializada; monthIdx: number; metaMensual: number }) {
  const [verTodo, setVerTodo] = useState(false)
  // "Hoy" = fecha local del navegador (el equipo está en Argentina); se recalcula cuando llegan datos nuevos
  const { resumen, hallazgos } = useMemo(
    () => analizarNegocio(raw, { monthIdx, hoy: new Date(), metaMensual }),
    [raw, monthIdx, metaMensual],
  )
  const visibles = verTodo ? hallazgos : hallazgos.slice(0, TOPE)

  return (
    <div className="glass-board" style={{ padding: '20px 22px' }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 8 }}>
        Analista
      </p>
      <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.45, marginBottom: 14 }}>
        {resumen}
      </p>

      {hallazgos.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {visibles.map(h => <Tarjeta key={h.id} h={h} />)}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin novedades para este mes.</p>
      )}

      {hallazgos.length > TOPE && (
        <button type="button" onClick={() => setVerTodo(x => !x)}
          style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--brand-texto)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          {verTodo ? 'Ver menos' : `Ver todo (${hallazgos.length})`}
        </button>
      )}
    </div>
  )
}
