import type { ResultadoTypeform } from '@/lib/seguimiento/typeform'

// Estado de la conexión con el Typeform mensual y la bandeja de respuestas que no se pudieron asignar a un cliente.
export function EstadoTypeform({ resultado, error }: { resultado: ResultadoTypeform | null; error: boolean }) {
  if (error) return <p className="pr-aviso" role="status">No se pudo leer la planilla de respuestas del Typeform. Se muestran los puntajes cargados a mano.</p>
  if (!resultado) {
    return (
      <details className="cj-panel tf-panel">
        <summary><span className="cj-etiqueta cj-etiqueta--laton">Typeform</span> todavía no conectado: los puntajes se cargan a mano</summary>
        <ol className="tf-pasos">
          <li>En Typeform, abrí el formulario mensual → <strong>Connect</strong> → <strong>Google Sheets</strong> → conectá tu cuenta de Google y elegí “crear una planilla nueva”.</li>
          <li>En esa planilla tocá <strong>Compartir</strong> y agregá como <strong>Lector</strong> a la cuenta del dashboard (te la paso por el chat).</li>
          <li>Pasame el enlace de la planilla: la conecto y cada respuesta actualiza sola el puntaje del mes (se cruza por mail, teléfono y nombre).</li>
        </ol>
      </details>
    )
  }
  return (
    <details className="cj-panel tf-panel">
      <summary>
        <span className="cj-etiqueta cj-etiqueta--laton">Typeform</span> {resultado.respuestas} respuestas · {resultado.puntajes.length} asignadas a clientes
        {resultado.sinAsignar.length > 0 ? ` · ${resultado.sinAsignar.length} sin asignar` : ''}
      </summary>
      {!resultado.columnaPuntaje && <p>No encontré la pregunta del puntaje (1 a 10) en la planilla: decime cuál es y la fijo.</p>}
      {resultado.sinAsignar.length > 0 && (
        <ul className="tf-sin-asignar">
          {resultado.sinAsignar.slice(0, 50).map((r, i) => (
            <li key={i}>
              <strong>{r.nombre || r.mail || r.telefono || 'Sin datos'}</strong>
              {r.valor !== null && <> · {r.valor}/10</>}
              {r.fecha && <> · {r.fecha.split('-').reverse().join('/')}</>}
              <span className="cj-texto-2"> — {r.motivo}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
