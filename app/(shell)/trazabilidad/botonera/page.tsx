import type { Metadata } from 'next'
import { viaMac } from '@/lib/ia/cliente'
import { exigirAcceso } from '@/lib/auth/sesion'
import { Cifra, SeccionTitulo } from '@/components/ui'
import { clavesFathom } from '@/lib/trazabilidad/fathom'
import { configurada } from '@/lib/trazabilidad/db'
import { manychatConfigurado } from '@/lib/trazabilidad/manychat'
import { umbral } from '@/lib/trazabilidad/modelo'
import { SubNav, usd } from '../_componentes/comunes'

export const metadata: Metadata = { title: 'Botonera · Trazabilidad' }
export const dynamic = 'force-dynamic'

// Cómo se cargan los datos: la botonera (setting), Fathom (llamadas) y el CRM (closing). Muestra qué falta configurar.
export default async function BotoneraPage() {
  await exigirAcceso('trazabilidad')
  let fathom: string[] = []
  let errorFathom = ''
  try {
    fathom = clavesFathom().map((k) => k.nombre)
  } catch (e) {
    errorFathom = (e as Error).message
  }
  const ok = (b: boolean) => (b ? 'Configurado' : 'Falta')
  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Trazabilidad · Cómo se carga" titulo="Botonera, Fathom y CRM" />
      <SubNav actual="/trazabilidad/botonera" />

      <div className="cj-rejilla">
        <Cifra tamano="media" etiqueta="Clave de la botonera" valor={ok(!!process.env.TRAZABILIDAD_KEY?.trim())} contexto="TRAZABILIDAD_KEY en Vercel" />
        <Cifra tamano="media" etiqueta="Fathom" valor={fathom.length ? `${fathom.length} cuenta${fathom.length > 1 ? 's' : ''}` : 'Falta'} contexto={errorFathom || (fathom.length ? fathom.join(', ') : 'FATHOM_API_KEYS (una clave por closer)')} />
        <Cifra tamano="media" etiqueta="ManyChat" valor={ok(manychatConfigurado())} contexto="MANYCHAT_API_KEY (etiquetas de cada cierre)" />
        <Cifra tamano="media" etiqueta="Claude" valor={ok(viaMac() || !!process.env.ANTHROPIC_API_KEY?.trim())} contexto={viaMac() ? "en la Mac (plan)" : "ANTHROPIC_API_KEY"} />
        <Cifra tamano="media" etiqueta="Base de datos" valor={ok(configurada())} contexto="Neon (DATABASE_URL)" />
      </div>

      <section className="cj-panel cj-pila cj-pila--chica">
        <h2 className="cj-titulo cj-titulo--seccion">1 · Setting: la botonera de ManyChat</h2>
        <p className="traz-texto">Es la botonera de la clase con un botón más, <strong>Enviar al Despacho</strong>. Se usa en cada agenda (para el semanal) y en cada cierre (para el mensual), también en los que entraron por landing: casi todos tienen chat.</p>
        <ol className="traz-ol">
          <li>En Chrome: <code>chrome://extensions</code> → activar <strong>Modo desarrollador</strong> → <strong>Cargar descomprimida</strong> → elegir la carpeta <code>botonera-despacho</code> (la pasa Tomás).</li>
          <li>Tocar el ícono ⚡ de la extensión y cargar la API key de ManyChat, la de Claude, la <strong>clave del Despacho</strong> y tu nombre. Guardar y recargar ManyChat.</li>
          <li>Abrir el chat del lead → pestaña Resumen → <strong>Scroll + Resumen automático</strong>.</li>
          <li>Revisar el resumen y tocar <strong>📤 Enviar al Despacho</strong>. En un minuto aparece analizado en su ficha.</li>
        </ol>
        <p className="traz-nota">El envío se vincula solo con el cierre por teléfono, mail o nombre. Si no coincide, se elige a mano en la ficha del lead.</p>
      </section>

      <section className="cj-panel cj-pila cj-pila--chica">
        <h2 className="cj-titulo cj-titulo--seccion">2 · Llamada: Fathom</h2>
        <p className="traz-texto">Todos los días a las 7:00 el Despacho busca la llamada de cada cierre nuevo con el link de Fathom de la planilla (Grabación 1 a 3) y la analiza. Las grabaciones están en la cuenta de Fathom de cada closer: hace falta una clave de API por closer (Fathom → Settings → API Access), cargadas en Vercel como <code>FATHOM_API_KEYS</code> = {'{"Carlos":"…","Marcos":"…"}'}. Sin clave, en la ficha se puede pegar el resumen a mano.</p>
      </section>

      <section className="cj-panel cj-pila cj-pila--chica">
        <h2 className="cj-titulo cj-titulo--seccion">3 · Closing: el CRM de ventas</h2>
        <p className="traz-texto">No hay que cargar nada: se leen los «Cerrado en llamada» y «Cerrado en seguimiento» de las pestañas de closers. Entra a la muestra quien cobró {usd(umbral())} o más (Cash Collected Día 1 o Trato Cerrado, el mayor).</p>
      </section>
    </div>
  )
}
