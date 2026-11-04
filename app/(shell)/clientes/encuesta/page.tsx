import type { Metadata } from 'next'
import { SeccionTitulo } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { sumarDias, ymdAFechaAR } from '@/lib/clientes/fechas'
import { cargarEncuesta, type DatosEncuesta } from '@/lib/clientes/encuesta/servidor'
import { PRIMER_AVISO_DIAS, VIGENCIA_DIAS } from '@/lib/clientes/encuesta/modelo'
import { AsignarRespuesta, MarcarEnvio, QuitarEnvio } from './Acciones'
import '../altas/altas.css'
import './encuesta.css'

// Encuesta mensual de satisfacción (4/11/2026): Tomás manda el Typeform a mano, marca acá el envío y ve quién contestó, quién
// no y las respuestas que no cruzaron con un cliente. Los que no contestaron desde el día 3 salen todos los días en 🛠️-operaciones.
export const metadata: Metadata = { title: 'Encuesta mensual' }
export const dynamic = 'force-dynamic'

const dia = (ymd: string) => ymdAFechaAR(ymd).replace(/\/\d{4}$/, '')
const instante = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
const puntaje = (v: number | null) => (v === null ? '—' : String(v).replace('.', ','))

export default async function EncuestaPage() {
  await exigirAcceso('clientes')
  let d: DatosEncuesta | null = null
  try { d = await cargarEncuesta() } catch { /* se avisa abajo */ }
  if (!d) {
    return (
      <div className="cj-pila cj-altas">
        <SeccionTitulo etiqueta="Clientes" titulo="Encuesta mensual" />
        <div className="cj-aviso"><p>No se pudo leer la encuesta. Probá de nuevo en un rato.</p></div>
      </div>
    )
  }
  const { estado: e } = d
  return (
    <div className="cj-pila cj-altas">
      <SeccionTitulo etiqueta="Clientes" titulo="Encuesta mensual" />
      <p className="cj-texto-2">
        {e.total ? `Contestaron ${e.contestaron.length} de ${e.total}${e.promedio !== null ? ` · promedio ${puntaje(e.promedio)}` : ''}` : 'Todavía no hay envíos marcados en los últimos 30 días.'}
        {e.sinAsignar.length ? ` · ${e.sinAsignar.length} sin asignar` : ''}
      </p>
      {(d.aviso || d.crmViejo) && <div className="cj-aviso"><p>{d.aviso ?? 'El CRM no respondió: se muestran los datos guardados.'}</p></div>}

      <MarcarEnvio activos={d.activos.map((a) => ({ ...a, ultimoEnvio: a.ultimoEnvio ? dia(a.ultimoEnvio) : null }))} hoy={d.hoy} minimo={sumarDias(d.hoy, -30)} />

      <section className="cj-pila cj-pila--chica" aria-labelledby="encuesta-no">
        <SeccionTitulo etiqueta="Seguimiento" titulo={`No contestaron (${e.noContestaron.length})`} nivel={2} />
        <p className="cj-texto-2">Desde el día {PRIMER_AVISO_DIAS} sin respuesta salen todos los días en 🛠️-operaciones, hasta {VIGENCIA_DIAS} días después del envío.</p>
        {e.noContestaron.length > 0 && (
          <div className="cj-tabla-scroll" role="region" aria-label="No contestaron" tabIndex={0}>
            <table className="cj-tabla">
              <thead><tr><th>ID</th><th>Cliente</th><th>Responsable</th><th>Enviada</th><th className="cj-num">Días</th><th /></tr></thead>
              <tbody>
                {e.noContestaron.map((f) => (
                  <tr key={f.id}>
                    <td>{f.id}</td><td>{f.nombre}</td><td>{f.responsable}</td><td>{dia(f.enviada)}</td><td className="cj-num">{f.dias}</td>
                    <td><QuitarEnvio id={f.id} dia={f.enviada} nombre={f.nombre} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cj-pila cj-pila--chica" aria-labelledby="encuesta-si">
        <SeccionTitulo etiqueta="Respuestas" titulo={`Contestaron (${e.contestaron.length})`} nivel={2} />
        {e.contestaron.length > 0 && (
          <div className="cj-tabla-scroll" role="region" aria-label="Contestaron" tabIndex={0}>
            <table className="cj-tabla">
              <thead><tr><th>ID</th><th>Cliente</th><th className="cj-num">Puntaje</th><th>Respondió</th><th>Enviada</th></tr></thead>
              <tbody>
                {e.contestaron.map((f) => (
                  <tr key={f.id}><td>{f.id}</td><td>{f.nombre}</td><td className="cj-num">{puntaje(f.valor)}</td><td>{instante(f.respondidaEn)}</td><td>{dia(f.enviada)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cj-pila cj-pila--chica" aria-labelledby="encuesta-sin">
        <SeccionTitulo etiqueta="Para corregir" titulo={`Sin asignar (${e.sinAsignar.length})`} nivel={2} />
        <p className="cj-texto-2">Respuestas que no cruzaron con un único cliente o de alguien sin envío marcado. Asignalas a un ID del CRM o descartalas.</p>
        {e.sinAsignar.map((r) => (
          <div key={r.clave} className="cj-panel cj-altas__tarjeta">
            <div className="cj-altas__cabeza">
              <strong>{r.quien}</strong>
              <span className="cj-texto-2">Puntaje {puntaje(r.valor)} · {instante(r.respondidaEn)}</span>
            </div>
            <p className="cj-texto-2">{r.motivo}</p>
            <AsignarRespuesta clave={r.clave} sugerido={r.sugerido} />
          </div>
        ))}
      </section>
    </div>
  )
}
