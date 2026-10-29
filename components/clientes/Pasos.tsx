import type { PasoReferido } from '@/lib/clientes/programa'

// Paso del programa de un referido: cinco cuadraditos (los cumplidos, rellenos) más la frase.
// El estado nunca depende del relleno solo: el título y el detalle van siempre en texto.
export function Pasos({ paso }: { paso: PasoReferido }) {
  const hecho = paso.numero ?? 0
  return (
    <div>
      <span className="cj-paso">
        <span className="cj-pasos" role="img" aria-label={paso.numero ? `Paso ${paso.numero} de ${paso.total}` : 'Sin paso'}>
          {Array.from({ length: paso.total }, (_, i) => (
            <i key={i} data-on={i < hecho ? '' : undefined} />
          ))}
        </span>
        <span>{paso.titulo}</span>
      </span>
      {paso.detalle && <span className="cj-sub">{paso.detalle}</span>}
    </div>
  )
}
