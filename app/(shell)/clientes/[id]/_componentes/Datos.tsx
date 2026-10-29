import type { ReactNode } from 'react'
import type { FichaCliente } from '@/lib/clientes/ficha'
import { fechaCorta } from '@/lib/clientes/formato'
import { SeccionFicha } from './SeccionFicha'

// Datos de contacto y de origen. El contacto (teléfonos y mail) solo llega si la sesión puede ver Clientes
// (armarFicha manda null si no): acá, sin contacto, la fila directamente no se dibuja.
function Dato({ etiqueta, children, ancho }: { etiqueta: string; children: ReactNode; ancho?: boolean }) {
  return (
    <div className={ancho ? 'cj-datos__ancho' : undefined}>
      <dt className="cj-etiqueta">{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function Datos({ f }: { f: FichaCliente }) {
  const c = f.contacto
  return (
    <SeccionFicha etiqueta="Datos" titulo="Contacto y contrato">
      <dl className="cj-datos">
        {c && (
          <Dato etiqueta="Celular">
            {c.telefonos.length === 0 && '—'}
            {c.telefonos.map((t, i) => (
              <div key={i}>
                <span className="cj-num">{t.texto}</span>
                {t.wa ? (
                  <>
                    {' '}
                    <a className="cj-enlace" href={t.wa} target="_blank" rel="noopener noreferrer" aria-label={`Abrir WhatsApp con ${t.e164}`}>
                      WhatsApp
                    </a>
                  </>
                ) : (
                  <span className="cj-sub">Sin código de país: no se puede abrir en WhatsApp</span>
                )}
              </div>
            ))}
          </Dato>
        )}
        {c && (
          <Dato etiqueta="Mail">
            {c.mail ? (
              <a className="cj-enlace-fila" href={`mailto:${c.mail}`}>
                {c.mail}
              </a>
            ) : (
              '—'
            )}
          </Dato>
        )}
        <Dato etiqueta="Línea">{f.linea === 'agencia' ? 'Agencia' : 'Consultora'}</Dato>
        <Dato etiqueta="Estudio">{f.estudio || '—'}</Dato>
        <Dato etiqueta="CSM">{f.csm || 'Sin asignar'}</Dato>
        <Dato etiqueta="Ciudad">{f.ciudad || '—'}</Dato>
        <Dato etiqueta="Closer">{f.closer || '—'}</Dato>
        <Dato etiqueta="Fuente">{f.fuente || '—'}</Dato>
        <Dato etiqueta="Contrato">{f.contrato || '—'}</Dato>
        <Dato etiqueta="Día 1">
          <span className="cj-num">{fechaCorta(f.dia1)}</span>
        </Dato>
        {f.renovo && <Dato etiqueta="Renovó">{f.renovo}</Dato>}
        {f.fechaBaja && (
          <Dato etiqueta="Fecha de baja">
            <span className="cj-num">{fechaCorta(f.fechaBaja)}</span>
          </Dato>
        )}
        {f.llamadaAgendada && <Dato etiqueta="Llamada agendada">{f.llamadaAgendada}</Dato>}
        {f.promesa && <Dato etiqueta="Promesa alcanzada">{f.promesa}</Dato>}
        {f.satisfaccion !== null && <Dato etiqueta="Satisfacción">{f.satisfaccion} de 10</Dato>}
        {f.testimonio && <Dato etiqueta="Testimonio" ancho>{f.testimonio}</Dato>}
      </dl>
    </SeccionFicha>
  )
}
