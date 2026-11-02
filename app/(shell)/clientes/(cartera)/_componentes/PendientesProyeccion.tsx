import Link from 'next/link'
import type { Cliente } from '@/lib/clientes/tipos'
import { cargarProyeccion, type ItemProyeccion } from '@/lib/bot/proyeccion/vista'
import { textoQuedan } from '@/lib/bot/proyeccion/reglas'
import { MarcasProyeccion } from './MarcasProyeccion'
import './proyeccion.css'

// «Pendientes de llamada de proyección» (Tomás, 2/11/2026: «marcalo arriba, abajo de Cargar alta, para marcarlos rápido: si
// ya se le avisó, si ya agendamos y si se dio o no»). Cada cliente ACTIVO a 14 días o menos de su fin (o con el fin vencido
// hace menos de 30 días): cuántos días le quedan y las 3 marcas. Lo mismo que la tarjeta y el bot (lib/bot/proyeccion).

const FASE: Record<ItemProyeccion['fase'], { texto: string; clase: string }> = {
  atrasado: { texto: 'Fin vencido', clase: 'py-fase--rojo' },
  agendar: { texto: 'Agendar', clase: 'py-fase--rojo' },
  invitar: { texto: 'Invitar', clase: 'py-fase--laton' },
  agendada: { texto: 'Agendada', clase: 'py-fase--ok' },
  hecha: { texto: 'Hecha', clase: 'py-fase--ok' },
}
const corta = (ymd: string) => ymd.split('-').reverse().join('/')

export async function PendientesProyeccion({ clientes, hoy, demo }: { clientes: readonly Cliente[]; hoy: string; demo: boolean }) {
  const { items, error } = demo ? { items: [] as ItemProyeccion[], error: false } : await cargarProyeccion(clientes, hoy)
  if (!items.length && !error) return null
  const pendientes = items.filter((i) => i.fase !== 'hecha' && i.fase !== 'agendada').length
  return (
    <section className="cj-panel py-panel" aria-labelledby="py-titulo">
      <div className="py-cabeza">
        <h2 id="py-titulo" className="py-titulo">Pendientes de llamada de proyección</h2>
        <p className="cj-etiqueta">{pendientes ? `${pendientes} sin agendar` : 'Todas agendadas'} · {items.length} con el fin a 14 días o menos</p>
      </div>
      <p className="py-ayuda">A 14 días del fin se le avisa que en una semana hacemos la llamada; a 7 días tiene que quedar agendada. «Agendada» o «Hecha» cortan los avisos del bot.</p>
      {error && <p className="cj-aviso" role="alert">No se pudieron leer las marcas: lo que se ve puede estar incompleto.</p>}
      <ul className="py-lista">
        {items.map((i) => (
          <li key={`${i.id}:${i.fin}`} className={`py-item${i.fase === 'hecha' ? ' py-item--hecho' : ''}`}>
            <div className="py-quien">
              <Link className="py-nombre" href={`/clientes?cliente=${encodeURIComponent(i.id)}#rc-proyeccion`}>{i.nombre}</Link>
              <span className={`py-fase ${FASE[i.fase].clase}`}>{FASE[i.fase].texto}</span>
              <span className="py-dias">{textoQuedan(i.dias).replace(/^le /, '')} · fin {corta(i.fin)}</span>
            </div>
            <MarcasProyeccion item={i} hoy={hoy} />
          </li>
        ))}
      </ul>
    </section>
  )
}
