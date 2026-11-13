import type { Metadata } from 'next'
import { SeccionTitulo } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { pedidoDemo } from '@/lib/clientes/demo'
import { cargarVista } from '@/lib/clientes/vista'
import { baseWinsConfigurada, listarWins } from '@/lib/clientes/wins/db'
import { filtrarWins, type Win } from '@/lib/clientes/wins/modelo'
import { ListaWins } from './ListaWins'

// Wins (especificación v1, 13/11/2026): todo lo bueno que dijo cada cliente, textual y con su captura, del más nuevo al más
// viejo, con filtro por cliente y por «autorizado para usar». Lo ve quien ve la Cartera; borrar es de quienes usan las
// acciones de la tarjeta. Los wins se cargan desde la tarjeta de cada cliente («Agregar win»).
export const metadata: Metadata = { title: 'Wins' }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function WinsPage({ searchParams }: Props) {
  const sesion = await exigirAcceso('clientes')
  const params = await searchParams
  const demo = pedidoDemo(params.demo)
  let wins: Win[] = []
  let error = ''
  const [vista] = await Promise.all([
    cargarVista(demo, 'omitir').catch(() => null),
    demo || !baseWinsConfigurada() ? null : listarWins().then(w => { wins = filtrarWins(w, { idCrm: null, autorizado: null }) }, () => { error = 'No se pudieron leer los wins. Recargá en un minuto.' }),
  ])
  if (!demo && !baseWinsConfigurada()) error = 'Falta conectar la base (DATABASE_URL).'
  // Solo id y nombre (nada de teléfonos ni mails): para el filtro y para mostrar el nombre de cada win
  const clientes = (vista?.datos.clientes ?? []).filter(c => c.linea === 'agencia' && c.id).map(c => ({ id: c.id.toUpperCase(), nombre: c.nombre }))
  return (
    <div className="cj-pila">
      <SeccionTitulo titulo="Wins de clientes" />
      <p className="cj-texto-2">Lo que dijeron los clientes, textual. Se cargan desde la tarjeta de cada cliente en la Cartera, con «Agregar win».</p>
      {demo && <p className="cj-texto-2">Datos de ejemplo: no se leen wins reales.</p>}
      {error ? <p className="cj-aviso" role="alert">{error}</p> : <ListaWins wins={wins} clientes={clientes} puedeBorrar={puedeHacerAcciones(sesion.email)} />}
    </div>
  )
}
