import type { CoberturaVista } from '@/lib/edicion/vista'

// e03: cuánto del guion aparece en los crudos (cada frase al menos una vez), lo que falta, lo dudoso y la mejor toma. Es
// una ayuda: el check de Aylu (e04) sigue siendo la puerta.
export function Cobertura({ c }: { c: CoberturaVista | null }) {
  if (!c) return <p className="ed-sub">Sin comparación todavía (llega cuando se cierra la tanda y hay transcripción).</p>
  return (
    <div className="ed-cobertura">
      <span className={c.estado === 'completo' ? 'ed-marca ed-marca--ok' : c.estado === 'incompleto' ? 'ed-marca ed-marca--alerta' : 'ed-marca'} style={{ alignSelf: 'flex-start' }}>
        {c.texto}
      </span>
      {c.faltan.length > 0 && (
        <>
          <span className="ed-sub">Faltan:</span>
          <ul className="ed-faltan">{c.faltan.map(f => <li key={f}>«{f}»</li>)}</ul>
        </>
      )}
      {c.dudosas.length > 0 && (
        <>
          <span className="ed-sub">Dudosas (revisar al oído):</span>
          <ul>{c.dudosas.map(f => <li key={f}>«{f}»</li>)}</ul>
        </>
      )}
      {c.mejorToma && <span className="ed-sub">Mejor toma: {c.mejorToma}</span>}
      <span className="ed-sub">{c.por}</span>
    </div>
  )
}
