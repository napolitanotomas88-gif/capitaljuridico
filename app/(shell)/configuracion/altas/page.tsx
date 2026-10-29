import type { Metadata } from 'next'
import { exigirAcceso } from '@/lib/auth/sesion'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { SeccionTitulo } from '@/components/ui'
import { SimuladorAlta } from './SimuladorAlta'
import './altas.css'

export const metadata: Metadata = { title: 'Altas' }

// Bot "Capital Jurídico" en modo simulación (docs/BOT-ALTA-CJ.md): se pega el mensaje del closer y se ve qué haría
// el alta. No escribe nada ni manda nada. Solo administradores, como el resto de /configuracion.
export default async function AltasPage() {
  await exigirAcceso('configuracion')
  return (
    <div className="cj-pila cj-pila--chica">
      <SeccionTitulo etiqueta="Bot Capital Jurídico · simulación" titulo="Altas de clientes" />
      <p className="alta-intro">
        Pegá el mensaje que manda el closer en &quot;Ventas C.J.&quot; y mirá qué haría el bot: qué datos entiende, qué le pediría al
        closer y los pasos del alta. Es una simulación: no se escribe en ninguna planilla ni se manda nada por WhatsApp.
      </p>
      <SimuladorAlta hoy={hoyArgentina()} />
    </div>
  )
}
