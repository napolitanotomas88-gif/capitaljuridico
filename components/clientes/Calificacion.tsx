import { NOMBRE_NIVEL, textoCompacto, type PuntajeCompacto } from '@/lib/clientes/puntaje'
import './puntaje.css'

// La línea chica de la cartera (tarjeta del Recorrido y lista): «Cliente 80 · Interno 72 +8», con el color del nivel.
// Solo para quien ya lanzó: sin puntaje no dibuja nada. El nivel también va en texto para lectores de pantalla.
// Si Meta no respondió no hay interno: «Interno: sin datos de Meta», sin nivel estimado (el del cliente, si respondió, sí).
export function Calificacion({ p, className }: { p: PuntajeCompacto | null | undefined; className?: string }) {
  if (!p) return null
  const nivel = p.nivel ? `${NOMBRE_NIVEL[p.nivel]}${p.estimado ? ' (estimado)' : ''}` : null
  const brecha = p.brecha === 'peor' ? 'se siente peor que los números' : p.brecha === 'mejor' ? 'se siente mejor que los números' : null
  const titulo = [nivel ? `Nivel: ${nivel}` : 'Sin nivel: Meta no respondió y el cliente no contestó la encuesta', brecha].filter(Boolean).join(' · ')
  return (
    <span className={`pz-mini pz--${p.nivel ?? 'sin_dato'}${className ? ` ${className}` : ''}`} title={titulo}>
      <span className="pz-mini__punto" aria-hidden />
      <span>
        <span className="cj-solo-lectores">Puntaje: </span>
        {textoCompacto(p)}
        {nivel && <span className="cj-solo-lectores">. Nivel {nivel}</span>}
        {brecha && <span className="pz-mini__brecha"> · brecha</span>}
      </span>
    </span>
  )
}
