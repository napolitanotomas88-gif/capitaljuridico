import type { Metadata } from 'next'
import { SeccionTitulo } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { GRUPO_PIEZA, NOMBRE_PIEZA, NOMBRE_ROL, responsablesDe } from '@/lib/alertas/personas'
import { listarMensajes, type MensajeGuardado } from '@/lib/bot/canal/registro'
import { ItemParaEnviar } from './ItemParaEnviar'
import '../altas/altas.css'

// «Para enviar» (2/11/2026): el bot ya no le escribe al cliente por WhatsApp. Cada mensaje que antes mandaba (bienvenida,
// guiones, recordatorio de grabación, videos listos, testimonio, encuesta, fin de servicio, despedida) queda acá con el texto
// listo. La persona responsable lo pega en el grupo del cliente y toca «Enviado» (eso hace lo mismo que hacía el envío
// automático). «No corresponde» lo saca de la lista con un motivo. El aviso de Discord (📤) trae #m-<id>.
export const metadata: Metadata = { title: 'Para enviar' }
export const dynamic = 'force-dynamic'

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

function vista(m: MensajeGuardado) {
  return {
    id: m.id, pieza: m.pieza, titulo: NOMBRE_PIEZA[m.pieza] ?? m.pieza, grupo: GRUPO_PIEZA[m.pieza] ?? 'General', cliente: m.cliente, idCrm: m.idCrm,
    texto: m.texto, abrir: m.abrir, adjuntos: m.adjuntos, desde: hora(m.creado), responsables: (responsablesDe(m.pieza) ?? []).map((r) => NOMBRE_ROL[r]).join(', '),
  }
}

export default async function ParaEnviarPage() {
  await exigirAcceso('clientes')
  let datos: Awaited<ReturnType<typeof listarMensajes>> = { pendientes: [], resueltos: [] }
  let error: string | null = null
  try { datos = await listarMensajes() } catch { error = 'No se pudo leer la lista. Probá de nuevo en un rato.' }
  return (
    <div className="cj-pila cj-altas">
      <SeccionTitulo etiqueta="Clientes" titulo={`Para enviar (${datos.pendientes.length})`} />
      <p className="cj-texto-2">El bot ya no escribe por WhatsApp: estos mensajes se pegan a mano en el grupo del cliente. Después tocá «Enviado».</p>
      {error && <div className="cj-aviso"><p>{error}</p></div>}
      {!error && datos.pendientes.length === 0 && <p className="cj-texto-2">No hay nada para enviar.</p>}
      {datos.pendientes.map((m) => <ItemParaEnviar key={m.id} m={vista(m)} />)}
      {datos.resueltos.length > 0 && (
        <section className="cj-pila cj-pila--chica">
          <SeccionTitulo etiqueta="Historial" titulo="Últimos resueltos" nivel={2} />
          <ul className="cj-altas__historial">
            {datos.resueltos.map((m) => (
              <li key={m.id}><strong>{m.cliente}</strong> · {NOMBRE_PIEZA[m.pieza] ?? m.pieza} · {m.estado === 'enviado' ? 'Enviado' : `No corresponde${m.motivo ? ` (${m.motivo})` : ''}`} · {m.por ?? ''} {hora(m.cuando)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
