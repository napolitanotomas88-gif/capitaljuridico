'use client'

import { useMemo, useState } from 'react'
import { leerSocios, parsearAlta, type AltaParseada } from '@/lib/bot/alta/parsear'
import { estadoAlta, planDeAlta, respuestaAlCloser, type EstadoAlta } from '@/lib/bot/alta/plan'
import { COLUMNAS_REGISTRO, filaRegistroPagos, type CeldaRegistro, type ColumnaRegistro } from '@/lib/bot/alta/finanzas'

// Ejemplos con el FORMATO de mensajes reales de "Ventas C.J." y datos inventados
const EJEMPLOS: { id: string; nombre: string; texto: string }[] = [
  {
    id: 'alta',
    nombre: 'Formato #ALTA',
    texto: `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: Juan Pérez
Teléfono: +54 9 11 3000-1111
Correo: juan.perez@example.test
Socios:
Ana Gómez · +54 9 11 3000-2222 · ana.gomez@example.test
Dirección: Calle 1 123, Mar del Plata
DNI: 30.111.222
CUIT: 20-30111222-3
Inicio del servicio: 19/10/2026
Contrato: normal
Cuotas:
19/11/2026 1100
19/12/2026 1100`,
  },
  {
    id: 'viejo',
    nombre: 'Formato de antes',
    texto: `Tipo de pago:  PP $3300
Nombre completo del lead: María López
Teléfono y de los socios: +54 9 11 3000-3333
Correo principal: maria.lopez@example.test
Dirección: Calle 2 456, Mar del Plata
DNI :  31.222.333
CUIT :  27 31.222.333 4
Fecha de inicio del servicio: 19/10/2026

19/10/2026: inicio $1100 ✅
19/11/2026 cuota $1100⏳
19/12/2026 finaliza pago $1100⏳`,
  },
  {
    id: 'falta',
    nombre: 'Pago bajo y sin cuotas',
    texto: `Tipo de pago: PP $3300
Nombre completo del lead: Pedro Ruiz
Teléfono y de los socios: +54 9 2215 00-1111 pedro  +54 9 2214 00 2222 estudio
Correo principal: pedro.ruiz@example.test
Dirección: Calle 3 789, La Plata
DNI: 36.000.111
CUIT: 20  36.000.111 4
Fecha de inicio del servicio: 21/10/2026`,
  },
  {
    id: 'libre',
    nombre: 'Formato libre',
    texto: `Ingresa pago PIF 2400 usd efectivo + 200 usd en transferencia en pesos
Lucía Fernández
Tel:+54 9 11 3000-4444
mail: lucia.fernandez@example.test
DNI: 32333444
CUIT: 27-32333444-5
Domicilio: Calle 4 1000 2B, CABA`,
  },
  {
    id: 'fee',
    nombre: 'Fee (seña)',
    texto: `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 300 USD · Transferencia a Napolitano Tomás (Santander)
Nombre completo: Sofía Romero
Teléfono: +54 9 11 3000-5555
Socios: ninguno
Correo: sofia.romero@example.test
Dirección: Calle 5 321, Rosario
DNI: 33.444.555
CUIT: 27-33444555-6
Inicio del servicio: 26/10/2026
Cuotas:
26/11/2026 1500
26/12/2026 1500`,
  },
]

const ESTADO: Record<EstadoAlta, { texto: string; clase: string }> = {
  faltan_datos: { texto: 'Faltan datos: el bot se los pide al closer', clase: 'alta-estado--falta' },
  fee: { texto: 'Fee (seña): solo se registra en Finanzas. El alta arranca cuando el pago llegue a USD 500', clase: 'alta-estado--fee' },
  falta_usd: { texto: 'Pago en pesos: falta el dólar MEP del día anterior para saber si es un Fee (menos de USD 500). El alta espera', clase: 'alta-estado--fee' },
  necesita_ok: { texto: 'Necesita el OK de Tomi o Gero', clase: 'alta-estado--ok' },
  lista: { texto: 'Lista para arrancar el alta', clase: 'alta-estado--lista' },
}

const usd = (n: number | null) => (n === null ? '—' : `USD ${n.toLocaleString('es-AR')}`)
const fecha = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '—')

/** Valor de una celda tal como se vería en la planilla (la col A va como serial; los teléfonos extranjeros con "'"). */
function textoCelda(col: ColumnaRegistro, valor: CeldaRegistro, fechaLegible: string): string {
  if (valor === null) return 'no se escribe'
  if (valor === '') return 'vacía'
  if (col === 'A') return `${fechaLegible} (serial ${valor})`
  if (typeof valor === 'number') return valor.toLocaleString('es-AR')
  return valor.startsWith("'") ? valor.slice(1) : valor
}

function filasDatos(a: AltaParseada): [string, string][] {
  return [
    ['Closer', a.closer ?? '—'],
    ['Programa', a.programa ?? '—'],
    ['Tipo de pago', a.modalidad ? `${a.modalidad} · ${usd(a.totalUsd)}` : '—'],
    ['Este pago', `${a.pagoEnPesos?.ars != null ? `$${a.pagoEnPesos.ars.toLocaleString('es-AR')} en pesos` : usd(a.estePagoUsd)}${a.medioPago ? ` · ${a.medioPago}` : ''}`],
    ['Nombre', a.nombre ?? '—'],
    ['Teléfonos', a.telefonos.map((t) => `+${t.numero}${t.etiqueta ? ` (${t.etiqueta})` : ''}`).join(' · ') || '—'],
    ['Correo', a.correo ?? '—'],
    // Un socio por renglón del #ALTA (24/10/2026: cada socio con su correo, para invitarlo a Skool)
    ['Socios', leerSocios(a.socios).map((s) => [s.nombre ?? '(sin nombre)', s.telefono ? `+${s.telefono}` : null, s.correo ?? 'sin correo'].filter(Boolean).join(' · ')).join(' | ') || '—'],
    ['Dirección', a.direccion ?? '—'],
    ['DNI', a.dni ?? '—'],
    ['CUIT', a.cuit ?? '—'],
    ['Inicio', fecha(a.inicio)],
    ['Contrato', a.contrato === 'garantia' ? 'Con garantía' : 'Normal'],
    ['Cuotas', a.cuotas.map((c) => `${fecha(c.fecha)} ${usd(c.montoUsd)} ${c.pagada ? '(pagada)' : '(pendiente)'}`).join(' · ') || '—'],
  ]
}

/** `hoy` ('aaaa-mm-dd' en Argentina) lo calcula el servidor: así el HTML del servidor y el del navegador coinciden. */
export function SimuladorAlta({ hoy }: { hoy: string }) {
  const [texto, setTexto] = useState(EJEMPLOS[0].texto)
  const alta = useMemo(() => parsearAlta(texto), [texto])
  const estado = estadoAlta(alta)
  const pasos = planDeAlta(alta, hoy)
  // Sin setter, fuente ni cuenta: en el bot real salen del CRM de ventas y del comprobante
  const registro = filaRegistroPagos(alta, { fecha: hoy })

  return (
    <div className="alta-grilla">
      <div className="alta-columna">
        <div className="alta-ejemplos" role="group" aria-label="Cargar un ejemplo">
          <span className="cj-etiqueta">Ejemplos</span>
          {EJEMPLOS.map((e) => (
            <button key={e.id} type="button" className="cj-chip" aria-pressed={texto === e.texto} onClick={() => setTexto(e.texto)}>
              {e.nombre}
            </button>
          ))}
        </div>
        <label className="cj-etiqueta" htmlFor="alta-mensaje">Mensaje del closer</label>
        <textarea
          id="alta-mensaje"
          className="alta-mensaje"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          spellCheck={false}
          rows={18}
        />
        <p className="alta-nota">Con el formato de antes y el libre también funciona, pero el #ALTA evita errores.</p>
      </div>

      <div className="alta-columna">
        <div className={`alta-estado ${ESTADO[estado].clase}`} role="status">{ESTADO[estado].texto}</div>

        <div className="alta-burbuja">
          <span className="cj-etiqueta">El bot respondería en Ventas C.J.</span>
          <p>{respuestaAlCloser(alta)}</p>
        </div>

        {alta.avisos.length > 0 && (
          <ul className="alta-avisos">
            {alta.avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}

        <div className="cj-panel alta-panel">
          <span className="cj-etiqueta">Lo que entendió</span>
          <dl className="alta-datos">
            {filasDatos(alta).map(([k, v]) => (
              <div key={k} className={v === '—' ? 'alta-dato alta-dato--vacio' : 'alta-dato'}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="cj-panel alta-panel">
          <span className="cj-etiqueta" id="alta-registro-titulo">Fila que se cargaría en Registro de Pagos (modo prueba)</span>
          {/* Contenedor con foco: en el celular la tabla se desborda y así también se desplaza con el teclado */}
          <div className="cj-tabla-scroll" role="region" aria-labelledby="alta-registro-titulo" tabIndex={0}>
            <table className="cj-tabla alta-registro" aria-labelledby="alta-registro-titulo">
              <thead>
                <tr><th scope="col">Columna de la planilla</th><th scope="col">Valor</th></tr>
              </thead>
              <tbody>
                {COLUMNAS_REGISTRO.map(({ col, titulo }) => {
                  const valor = registro.celdas[col]
                  const vacio = valor === '' || valor === null
                  return (
                    <tr key={col} className={vacio ? 'alta-registro--vacio' : undefined}>
                      <th scope="row">{col} · {titulo}</th>
                      <td className="cj-largo">{textoCelda(col, valor, registro.fechaLegible)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {registro.pendientes.length > 0 && (
            <>
              <span className="cj-etiqueta">Pendientes antes de cargar</span>
              <ul className="alta-pendientes">
                {registro.pendientes.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </>
          )}
          {registro.avisos.length > 0 && (
            <ul className="alta-avisos">
              {registro.avisos.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
          <p className="alta-nota">Entra como fila nueva arriba de todo (fila 2). No se escribe nada: es una vista previa con la fecha de hoy. Un pago en pesos queda sin USD: en el bot real, el servidor busca el dólar MEP del día anterior.</p>
        </div>
      </div>

      <section className="alta-pasos" aria-label="Pasos del alta">
        <span className="cj-etiqueta cj-etiqueta--laton">Pasos que haría el bot</span>
        <ol>
          {pasos.map((p) => (
            <li key={p.id} className={p.enEspera ? 'alta-paso--espera' : undefined}>
              <div className="alta-paso__titulo">
                <strong>{p.titulo}</strong>
                {p.enEspera && <span className="alta-espera">En espera</span>}
                {p.humano && <span className="alta-humano">{p.humano}</span>}
              </div>
              <ul>{p.detalle.map((d) => <li key={d}>{d}</li>)}</ul>
            </li>
          ))}
        </ol>
        {estado === 'fee' && <p className="alta-nota">Los pasos marcados «En espera» esperan a que el pago llegue a USD 500: por ahora solo se registra el Fee en Finanzas y se avisa en Verificaciones C.J.</p>}
        {estado === 'falta_usd' && <p className="alta-nota">Los pasos marcados «En espera» esperan el dólar MEP del día anterior: con menos de USD 500 el pago es un Fee y el alta no arranca. En el bot real, el servidor busca la cotización; acá no se sale a internet.</p>}
        {(estado === 'faltan_datos' || estado === 'necesita_ok') && <p className="alta-nota">Los pasos marcados «En espera» esperan a que el closer complete los datos o a que Tomi o Gero den el OK.</p>}
      </section>
    </div>
  )
}
