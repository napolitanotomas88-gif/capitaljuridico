import { Cifra, Etiqueta, Vacio } from '@/components/ui'
import type { FichaCliente } from '@/lib/clientes/ficha'
import { fechaCorta, mesesTexto, numeroAR, usd } from '@/lib/clientes/formato'
import { textoIntentos } from '@/lib/clientes/listado'
import { SeccionFicha } from './SeccionFicha'

// Panel del programa de referidos de este cliente, de un vistazo: cuántos presentó, asistieron y cerraron; créditos
// disponibles, usados y por liberar; y el detalle del beneficio con las reglas verificadas (lib/clientes/panelReferidos.ts).
// Debajo van las dudas abiertas del programa, tal como están en lib/clientes/reglasReferidos.ts: mientras no se confirmen,
// el cálculo usa el valor que dice cada una. Solo lectura. Si falta una pestaña del CRM, lo dice en vez de mostrar ceros.
export function PanelReferidosFicha({ f }: { f: FichaCliente }) {
  const p = f.panel
  const faltaReferidos = p.pestanasAusentes.includes('Referidos')
  const faltaCreditos = p.pestanasAusentes.includes('Créditos')
  const { referidos, creditos, beneficios } = p

  return (
    <SeccionFicha etiqueta="Referidos y beneficios" titulo="Panel del programa">
      {faltaReferidos ? (
        <Vacio frase="Todavía no existe la pestaña “Referidos” en la planilla del CRM: no hay referidos para contar. Cuando se cree y se cargue el primero, los números de este cliente van a aparecer acá." />
      ) : (
        <>
          {referidos.presentados === 0 && creditos.disponibles === 0 && creditos.usados === 0 && creditos.pendientesDeLiberar === 0 && (
            <p className="cj-parrafo cj-texto-2">
              Sin registros todavía: este cliente no tiene referidos ni movimientos de crédito cargados. Los ceros de abajo quieren decir que no hay filas, no que haya un saldo confirmado.
            </p>
          )}
          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Referidos</Etiqueta>
            <div className="cj-rejilla">
              <Cifra tamano="media" etiqueta="Presentados" valor={numeroAR(referidos.presentados)} contexto={referidos.anterioresAlPrograma > 0 ? `${referidos.anterioresAlPrograma} antes del ${fechaCorta(f.creditos.programaDesde)}: no generan crédito` : 'Los que este cliente presentó'} />
              <Cifra tamano="media" etiqueta="Asistieron" valor={numeroAR(referidos.asistieron)} contexto="Fueron a la llamada, hayan cerrado o no" />
              <Cifra tamano="media" etiqueta="Intentos" valor={numeroAR(beneficios.intentos)} contexto="Entraron a la llamada y no cerraron" />
              <Cifra tamano="media" etiqueta="Cerraron" valor={numeroAR(referidos.cerraron)} contexto="El crédito se libera con el primer pago y los días sin reembolso" />
            </div>
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Créditos (meses de servicio y USD)</Etiqueta>
            <div className="cj-rejilla">
              <Cifra tamano="media" etiqueta="Disponibles (meses)" valor={numeroAR(creditos.disponibles)} contexto="Para canjear contra la renovación" />
              <Cifra tamano="media" etiqueta="Disponibles (USD)" valor={numeroAR(beneficios.usd.disponible)} contexto="De los intentos: también contra la renovación" />
              <Cifra
                tamano="media"
                etiqueta="Usados (meses)"
                valor={faltaCreditos ? '—' : numeroAR(creditos.usados)}
                contexto={faltaCreditos ? 'Falta la pestaña “Créditos” (el libro de movimientos)' : 'Canjeados contra renovaciones'}
              />
              <Cifra
                tamano="media"
                etiqueta="Pendientes de liberar"
                valor={numeroAR(creditos.pendientesDeLiberar)}
                contexto={creditos.pendientesDeLiberar === 1 ? '1 cierre, todavía sin liberar' : 'Cierres que todavía no se liberan'}
              />
            </div>
          </div>

          <dl className="cj-datos">
            <div>
              <dt className="cj-etiqueta">Intentos</dt>
              <dd>{textoIntentos(p) === '—' ? 'Sin intentos' : textoIntentos(p)}</dd>
            </div>
            <div>
              <dt className="cj-etiqueta">Saldo en USD</dt>
              <dd>{beneficios.usd.disponible > 0 ? usd(beneficios.usd.disponible) : 'Sin crédito en USD'}</dd>
            </div>
            <div>
              <dt className="cj-etiqueta">Meses por cierres</dt>
              <dd>{mesesTexto(beneficios.mesesPorCierres)}</dd>
            </div>
          </dl>
        </>
      )}

      <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
        <Etiqueta como="h3">Detalle del beneficio</Etiqueta>
        <dl className="cj-datos">
          {p.detalle.map(l => (
            <div key={l.clave}>
              <dt className="cj-etiqueta">{l.titulo}</dt>
              <dd>{l.texto}</dd>
            </div>
          ))}
        </dl>
        <p className="cj-texto-2 cj-parrafo">Reglas {f.reglas.version} ({f.reglas.estado}).</p>
      </div>

      <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
        <Etiqueta como="h3">
          {p.dudasAbiertas.length === 1 ? '1 duda abierta' : `${p.dudasAbiertas.length} dudas abiertas`} del programa
        </Etiqueta>
        {p.dudasAbiertas.length === 0 ? (
          <p className="cj-parrafo">No hay dudas abiertas.</p>
        ) : (
          <>
            <p className="cj-parrafo cj-texto-2">Mientras no se confirmen, el cálculo usa el valor que dice cada una.</p>
            <ol className="cj-lista" aria-label="Dudas abiertas del programa de referidos">
              {p.dudasAbiertas.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ol>
          </>
        )}
      </div>
    </SeccionFicha>
  )
}
