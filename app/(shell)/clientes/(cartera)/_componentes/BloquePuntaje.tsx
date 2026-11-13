import { fechaCorta } from '@/lib/clientes/formato'
import { NOMBRE_BLOQUE, NOMBRE_NIVEL, sugerencia, type Bloque, type EstadoRenglon, type ResultadoPuntaje } from '@/lib/clientes/puntaje'
import { NOMBRE_FUENTE_RAMA } from '@/lib/anuncios/ramas'
import '@/components/clientes/puntaje.css'

// Bloque «Puntaje» de la tarjeta del cliente (especificación v1, 13/11/2026): los dos números (el del cliente y el interno),
// el nivel, la brecha, la rama con su calidad (informativa) y de dónde sale cada punto. Solo lectura: el puntaje no mueve la etapa ni escribe en el CRM.

const ESTADO: Record<EstadoRenglon, string> = { suma: 'Suma', parcial: 'Suma una parte', no_suma: 'No suma', sin_dato: 'Sin dato', resta: 'Resta', no_aplica: 'No resta' }
const BLOQUES: Bloque[] = ['anuncios', 'resultados', 'equipo', 'bonus', 'resta']
const puntos = (n: number, maximo: number) => (maximo < 0 ? (n ? `${n}` : '0') : `${n} de ${maximo}`)

export function BloquePuntaje({ p, etapa }: { p: ResultadoPuntaje | null; etapa: string }) {
  if (!p) return <p className="cj-parrafo cj-texto-2">Sin puntaje: el cliente todavía no lanzó (en producción). El puntaje empieza con la primera campaña.</p>
  const s = sugerencia(p, etapa)
  return (
    <div className="pz">
      <dl className="pz-cifras">
        <div className="pz-cifra">
          <dt className="cj-etiqueta">Puntaje del cliente</dt>
          <dd className="pz-cifra__n">{p.cliente ?? '—'}{p.cliente !== null && <small> / 100</small>}</dd>
          <dd className="pz-nota">{p.cliente === null ? 'Sin respuesta a la encuesta' : `Su última encuesta${p.clienteDia ? `, ${fechaCorta(p.clienteDia)}` : ''}`}</dd>
        </div>
        <div className="pz-cifra">
          <dt className="cj-etiqueta">Puntaje interno</dt>
          {p.interno === null
            ? <>
                <dd className="pz-cifra__sin">Sin datos de Meta</dd>
                <dd className="pz-nota">Meta no respondió en esta lectura: sin el bloque Anuncios (50 puntos) el interno no se calcula. Recargá en un minuto.</dd>
              </>
            : <>
                <dd className="pz-cifra__n">{p.interno}{p.bonus > 0 && <small> +{p.bonus} bonus</small>}</dd>
                <dd className="pz-nota">{p.restas > 0 ? `${p.base} puntos menos ${p.restas} de restas` : `${p.base} de 100 puntos`}</dd>
              </>}
        </div>
        <div className="pz-cifra">
          <dt className="cj-etiqueta">Nivel</dt>
          {p.nivel
            ? <>
                <dd><span className={`pz-nivel pz--${p.nivel}`}>{NOMBRE_NIVEL[p.nivel]}</span></dd>
                <dd className="pz-nota">{p.estimado ? 'Estimado con el interno: el cliente no respondió' : 'Sale del puntaje del cliente'}</dd>
              </>
            : <>
                <dd className="pz-cifra__sin">Sin nivel</dd>
                <dd className="pz-nota">El cliente no respondió y sin Meta no hay interno para estimarlo.</dd>
              </>}
        </div>
        {p.rama && (
          <div className="pz-cifra">
            <dt className="cj-etiqueta">Rama</dt>
            <dd className="pz-rama">{p.rama.nombre}</dd>
            <dd className="pz-nota">Calidad {p.rama.calidad} de 5{p.rama.fuente ? ` · según ${NOMBRE_FUENTE_RAMA[p.rama.fuente]}` : ''}. Dato informativo: no suma ni resta.</dd>
          </div>
        )}
      </dl>
      {p.brecha && <p className="pz-brecha" role="note"><strong>Brecha de {p.brecha.diferencia} puntos.</strong> {p.brecha.texto}</p>}
      {s && <p className="pz-nota">{s}</p>}
      {p.sinDato > 0 && <p className="pz-nota">{p.sinDato === 1 ? '1 señal quedó sin dato' : `${p.sinDato} señales quedaron sin dato`}: suman 0 hasta que haya con qué medirlas.</p>}
      <details>
        <summary className="pz-boton-texto">De dónde sale cada punto</summary>
        <table className="pz-detalle">
          <caption className="cj-solo-lectores">Detalle del puntaje interno</caption>
          <thead><tr><th scope="col">Señal</th><th scope="col">Puntos</th><th scope="col">Estado</th><th scope="col">Por qué</th></tr></thead>
          {BLOQUES.map(b => {
            const filas = p.detalle.filter(r => r.bloque === b)
            return (
              <tbody key={b}>
                <tr className="pz-bloque"><th scope="rowgroup" colSpan={4}>{NOMBRE_BLOQUE[b]}</th></tr>
                {filas.map(r => (
                  <tr key={r.clave}>
                    <td>{r.senal}</td>
                    <td className="pz-detalle__n">{puntos(r.puntos, r.maximo)}</td>
                    <td><span className={`pz-estado pz-estado--${r.estado}`}>{ESTADO[r.estado]}</span></td>
                    <td className="pz-detalle__motivo">{r.motivo}</td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </details>
    </div>
  )
}
