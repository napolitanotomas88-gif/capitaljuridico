import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SeccionTitulo } from '@/components/ui'
import { rutaInicial } from '@/lib/auth/roles'
import { obtenerSesion } from '@/lib/auth/sesion'
import { aprobadorDe, closerDeSesion, faltantesAprobadores, puedeCargar, puedeMarcarAMano } from '@/lib/bot/alta/despacho/aprobadores'
import { canalDelEntorno } from '@/lib/bot/alta/motor/servidor'
import { modoDesdeEntorno } from '@/lib/bot/alta/motor/modo'
import { CLOSERS_DESPACHO } from '@/lib/bot/alta/despacho/evento'
import { altasParaPantalla } from '@/lib/bot/alta/despacho/servidor'
import { FormCargar } from './_componentes/FormCargar'
import { TarjetaAlta } from './_componentes/TarjetaAlta'
import './altas.css'

// «Cargar alta» (Despacho → Clientes, 26/10/2026): el bot del alta de Capital Jurídico sin WhatsApp. Todo en una pantalla:
//   · el formulario (texto del closer, closer y comprobantes) con la vista previa de lo que entendió el bot;
//   · las altas abiertas, cada una con sus pedidos (el mismo texto de Verificaciones C.J) y sus botones OK / NO, los datos que
//     faltan del closer y lo que queda a mano (grupos, bienvenida y Skool) con "Hecho a mano".
// El aviso de Discord trae ?alta=<id>#espera-<id>: esa alta va primero y el navegador baja hasta la espera.
export const metadata: Metadata = { title: 'Cargar alta' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function AltasPage({ searchParams }: Props) {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/entrar?next=/clientes/altas')
  if (!puedeCargar(sesion)) redirect(rutaInicial(sesion))
  const params = await searchParams
  const pedida = typeof params.alta === 'string' && /^alta_[\w.@:-]{3,200}$/.test(params.alta) ? params.alta : null
  const aprobador = aprobadorDe(sesion)
  const closerPropio = aprobador ? null : closerDeSesion(sesion)
  const { abiertas, terminadas, error } = await altasParaPantalla(sesion, { soloId: pedida })
  const ordenadas = pedida ? [...abiertas.filter((a) => a.id === pedida), ...abiertas.filter((a) => a.id !== pedida)] : abiertas
  const canal = canalDelEntorno()
  const modo = modoDesdeEntorno()
  const faltan = aprobador ? faltantesAprobadores() : []

  return (
    <div className="cj-pila cj-altas">
      <SeccionTitulo etiqueta="Clientes" titulo="Cargar alta" />

      {(modo !== 'real' || canal !== 'ambos' || faltan.length > 0) && (
        <div className="cj-panel cj-altas__estado">
          {modo !== 'real' && <p>El bot está en modo <strong>{modo}</strong>: las altas se procesan como vista previa, sin escribir en Finanzas, CRM ni Drive.</p>}
          {canal === 'despacho' && <p>Los pedidos del bot se responden acá (el WhatsApp del bot no está disponible o el canal es Despacho). Cada pedido avisa en Discord con el link.</p>}
          {canal === 'whatsapp' && <p>Los pedidos salen por WhatsApp (BOT_ALTA_CANAL=whatsapp). También se pueden responder acá.</p>}
          {faltan.length > 0 && <p className="cj-texto-2">Falta configurar el mail de: {faltan.join(', ')} (variables de aprobadores; ver docs/BOT-ALTA-CJ.md).</p>}
        </div>
      )}

      <section aria-labelledby="altas-nueva" className="cj-pila cj-pila--chica">
        <SeccionTitulo etiqueta="Nueva" titulo="Pegar el alta" nivel={2} />
        <FormCargar closers={[...CLOSERS_DESPACHO]} closerFijo={closerPropio} />
      </section>

      <section aria-labelledby="altas-abiertas" className="cj-pila cj-pila--chica">
        <SeccionTitulo etiqueta="En curso" titulo={`Altas abiertas (${ordenadas.length})`} nivel={2} />
        {error && <div className="cj-aviso"><p>{error}</p></div>}
        {!error && ordenadas.length === 0 && <p className="cj-texto-2">No hay altas abiertas{closerPropio ? ' tuyas' : ''}.</p>}
        {ordenadas.map((a) => (
          <TarjetaAlta key={a.id} alta={a} foco={a.id === pedida} aprobador={!!aprobador} aMano={puedeMarcarAMano(sesion)} closerPropio={closerPropio} />
        ))}
      </section>

      {terminadas.length > 0 && (
        <section className="cj-pila cj-pila--chica">
          <SeccionTitulo etiqueta="Historial" titulo="Últimas terminadas" nivel={2} />
          <ul className="cj-altas__historial">
            {terminadas.map((a) => (
              <li key={a.id}><strong>{a.cliente}</strong>{a.closer ? ` · ${a.closer}` : ''} · {a.estadoTexto} · {a.origen === 'despacho' ? 'Despacho' : 'WhatsApp'}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
