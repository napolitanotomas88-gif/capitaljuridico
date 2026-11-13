import { NOMBRE_NIVEL, textoCompacto, type PuntajeCompacto } from '@/lib/clientes/puntaje'
import './puntaje.css'

// La línea chica de la cartera (tarjeta del Recorrido y lista): «Cliente 80 · Interno 72 +8», con el color del nivel.
// Solo para quien ya lanzó: sin puntaje no dibuja nada. El nivel también va en texto para lectores de pantalla.
export function Calificacion({ p, className }: { p: PuntajeCompacto | null | undefined; className?: string }) {
  if (!p) return null
  const nivel = `${NOMBRE_NIVEL[p.nivel]}${p.estimado ? ' (estimado)' : ''}`
  const brecha = p.brecha === 'peor' ? 'se siente peor que los números' : p.brecha === 'mejor' ? 'se siente mejor que los números' : null
  return (
    <span className={`pz-mini pz--${p.nivel}${className ? ` ${className}` : ''}`} title={`Nivel: ${nivel}${brecha ? ` · ${brecha}` : ''}`}>
      <span className="pz-mini__punto" aria-hidden />
      <span>
        <span className="cj-solo-lectores">Puntaje: </span>
        {textoCompacto(p)}
        <span className="cj-solo-lectores">. Nivel {nivel}</span>
        {brecha && <span className="pz-mini__brecha"> · brecha</span>}
      </span>
    </span>
  )
}
