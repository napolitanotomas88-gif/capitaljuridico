import type { Metadata } from 'next'
import Link from 'next/link'
import { SeccionTitulo } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { aprobadorDe } from '@/lib/bot/alta/despacho/aprobadores'
import { listarAprobaciones } from '@/lib/clientes/aprobaciones'
import { ItemAprobacion } from './ItemAprobacion'
import '../altas/altas.css'

// Aprobaciones (2/11/2026): lo que antes se respondía citando en «Verificaciones C.J.» de WhatsApp (Éxito y Bajas) se aprueba
// acá con OK / NO / «Hecho a mano». El aviso de ✅-verificaciones en Discord trae el link. Las altas siguen en «Cargar alta».
export const metadata: Metadata = { title: 'Aprobaciones' }
export const dynamic = 'force-dynamic'

const hora = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default async function AprobacionesPage() {
  const sesion = await exigirAcceso('clientes')
  const aprobador = !!aprobadorDe(sesion)
  const { items, errores } = await listarAprobaciones()
  return (
    <div className="cj-pila cj-altas">
      <SeccionTitulo etiqueta="Clientes" titulo={`Aprobaciones (${items.length})`} />
      <p className="cj-texto-2">OK y NO de Éxito y Bajas (antes se respondían citando en Verificaciones C.J.). Las altas se aprueban en <Link href="/clientes/altas" className="cj-enlace">Cargar alta</Link>.</p>
      {!aprobador && <div className="cj-aviso"><p>Solo Tomás, Gero A, Gero M y Aylu pueden aprobar.</p></div>}
      {errores.map((e) => <div key={e} className="cj-aviso"><p>{e}</p></div>)}
      {items.length === 0 && errores.length === 0 && <p className="cj-texto-2">No hay nada para aprobar.</p>}
      {items.map((i) => <ItemAprobacion key={`${i.fuente}-${i.id}`} item={{ ...i, desde: hora(i.desde) }} puede={aprobador} />)}
    </div>
  )
}
