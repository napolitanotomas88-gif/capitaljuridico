import { PuntajeRapido } from '@/components/clientes/PuntajeRapido'
import type { EstadoSeguimiento } from '@/lib/seguimiento/modelo'
import { SeccionFicha } from './SeccionFicha'

// "Cómo le va": puntaje de 1 a 10 de un toque (con nota) e historial (a mano y del Typeform). Pestaña Seguimiento del CRM.
const TENDENCIA = { sube: 'Sube frente al mes anterior', baja: 'Baja frente al mes anterior', igual: 'Igual que el mes anterior' } as const

export function ComoLeVa({ idCliente, nombre, estado }: { idCliente: string; nombre: string; estado: EstadoSeguimiento }) {
  const u = estado.ultimo
  return (
    <SeccionFicha id="como-le-va" etiqueta="Seguimiento" titulo="Cómo le va">
      <div className="clv">
        <PuntajeRapido idCliente={idCliente} nombre={nombre} actual={u ? { valor: u.valor, tendencia: estado.tendencia, fuente: u.fuente, dia: u.dia } : null} />
        {estado.tendencia && <p className="cj-texto-2">{TENDENCIA[estado.tendencia]}{estado.anterior ? ` (${estado.anterior.valor}/10 en ${estado.anterior.mes.split('-').reverse().join('/')})` : ''}.</p>}
        {estado.historial.length > 0 ? (
          <ol className="clv-historial">
            {estado.historial.slice(0, 12).map((p, i) => (
              <li key={`${p.fecha}-${i}`}>
                <strong className="cj-num">{p.valor}/10</strong> · {p.dia.split('-').reverse().join('/')} · {p.fuente === 'typeform' ? 'Typeform' : p.quien || 'a mano'}
                {p.nota && p.fuente === 'manual' && <span className="cj-texto-2"> — {p.nota}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="cj-texto-2">Todavía sin puntaje. Tocá “Puntuar” para cargar el primero.</p>
        )}
      </div>
    </SeccionFicha>
  )
}
