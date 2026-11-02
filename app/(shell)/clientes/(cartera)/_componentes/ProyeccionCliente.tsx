import type { Cliente } from '@/lib/clientes/tipos'
import { aClienteBaja, cargarProyeccion } from '@/lib/bot/proyeccion/vista'
import { finReal } from '@/lib/bot/bajas/fin'
import { diasEntre } from '@/lib/clientes/fechas'
import { INVITAR_DIAS, textoQuedan } from '@/lib/bot/proyeccion/reglas'
import { MarcasProyeccion } from './MarcasProyeccion'
import './proyeccion.css'

// Bloque «Llamada de proyección» de la tarjeta del cliente (2/11/2026): la marca visible («Proyección: invitar / agendar»
// con la fecha) y las mismas 3 marcas que el panel de Clientes (Avisado · Agendada · Hecha / No se dio).
const corta = (ymd: string) => ymd.split('-').reverse().join('/')
const sumar = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export async function ProyeccionCliente({ cliente, hoy, demo }: { cliente: Cliente | null; hoy: string; demo: boolean }) {
  if (!cliente) return null
  const { items, error } = demo ? { items: [], error: false } : await cargarProyeccion([cliente], hoy)
  const item = items[0]
  if (!item) {
    const fin = finReal(aClienteBaja(cliente))
    const dias = fin ? diasEntre(hoy, fin) : null
    return (
      <p className="cj-parrafo cj-texto-2">
        {cliente.estado !== 'ACTIVO' || !fin ? 'No corre: solo para clientes activos con fecha de fin.'
          : dias !== null && dias > INVITAR_DIAS ? `Fin del programa: ${corta(fin)}. La invitación a la llamada de proyección sale el ${corta(sumar(fin, -INVITAR_DIAS))} (14 días antes).`
          : 'Fuera de la ventana de la llamada de proyección.'}
      </p>
    )
  }
  const marca = item.fase === 'invitar' ? `Proyección: invitar (desde el ${corta(sumar(item.fin, -14))})`
    : item.fase === 'agendar' ? `Proyección: agendar (desde el ${corta(sumar(item.fin, -7))})`
    : item.fase === 'atrasado' ? 'Proyección: fin vencido sin llamada'
    : item.fase === 'agendada' ? `Proyección: agendada${item.agendada ? ` para el ${corta(item.agendada)}` : ''}`
    : 'Proyección: hecha'
  return (
    <div className="py-panel">
      <p className="cj-parrafo"><strong className={item.fase === 'agendar' || item.fase === 'atrasado' ? 'py-fase--rojo' : item.fase === 'invitar' ? 'py-fase--laton' : 'py-fase--ok'}>{marca}</strong> · {textoQuedan(item.dias)} (fin {corta(item.fin)})</p>
      {error && <p className="cj-aviso" role="alert">No se pudieron leer las marcas: lo que se ve puede estar incompleto.</p>}
      <MarcasProyeccion item={item} hoy={hoy} demo={demo} />
    </div>
  )
}
