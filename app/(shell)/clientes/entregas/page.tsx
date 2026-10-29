import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { exigirAcceso } from '@/lib/auth/sesion'
import { SeccionTitulo, Vacio } from '@/components/ui'
import { puedeEntregarGuiones } from '@/lib/bot/guiones/entrega'
import { pendientesEntrega } from '@/lib/bot/guiones/registro'
import { Entrega } from './Entrega'
export const metadata: Metadata = { title: 'Guiones para entregar' }
export const dynamic = 'force-dynamic'
export default async function EntregasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await exigirAcceso('clientes')
  if (!puedeEntregarGuiones(sesion.email) && !(process.env.NODE_ENV !== 'production' && sesion.esDePrueba && sesion.rol === 'socio')) notFound()
  const params = await searchParams
  const cliente = typeof params.cliente === 'string' ? params.cliente.toUpperCase() : ''
  const filas = (await pendientesEntrega()).filter(f => !cliente || f.id_crm?.toUpperCase() === cliente)
  return <div className="cj-pila">
    <SeccionTitulo etiqueta="Clientes" titulo="Guiones para entregar" />
    <p>Estos guiones ya tienen el check final de Tomi o Faus y están cargados en su documento. Aylu o Gero comparten el link con el cliente y confirman la entrega acá.</p>
    {!filas.length && <Vacio frase="No hay guiones pendientes de entrega." />}
    {filas.map(f => <section key={f.id} className="cj-panel" aria-label={`Entrega de ${f.cliente ?? f.id_crm}`}>
      <h2>{f.cliente ?? f.id_crm} · Tanda {f.doc?.tanda ?? f.tanda}</h2>
      <p>{Object.keys(f.guiones).length} guiones · Aprobó {f.aprobacion?.quien ?? 'el revisor'}.</p>
      <Entrega tanda={f.id} previo={f.actualizado} url={`https://docs.google.com/document/d/${f.doc!.id}/edit`} />
    </section>)}
  </div>
}
