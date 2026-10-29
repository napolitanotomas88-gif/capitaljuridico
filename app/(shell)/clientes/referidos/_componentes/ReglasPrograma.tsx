import { Etiqueta, SeccionTitulo, Tabla, type Columna } from '@/components/ui'
import { cierresParaElTope, esPremioUnico, mesesRenovacionGratis, premioDelIntento, valorizarMeses } from '@/lib/clientes/creditos'
import { fechaCorta, mesesTexto, numeroAR, usd } from '@/lib/clientes/formato'
import { mesDe, mesLargo, objetivoApoyoTexto, rangoMetaTexto } from '@/lib/clientes/metas'
import { ETIQUETA_MOMENTO, textoExtra, valorDelPaso } from '@/lib/clientes/programa'
import { REGLAS_REFERIDOS as R } from '@/lib/clientes/reglasReferidos'

// Reglas vigentes del programa en lenguaje claro. NO tiene números propios: todo sale de
// lib/clientes/reglasReferidos.ts, así que al editar ese archivo cambia esta pantalla y el cálculo a la vez.
interface FilaPremio { clave: string; cuando: string; premio: string; valor: string }

const textoCierres = (n: number) => (n === 1 ? '1 cierre' : `${n} cierres`)
const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

function filasEscalera(): FilaPremio[] {
  const escalera = [...R.escalera].sort((a, b) => a.cierres - b.cierres)
  const filas: FilaPremio[] = escalera.map(p => {
    const v = valorDelPaso(p, R)
    return {
      clave: `n${p.cierres}`,
      cuando: textoCierres(p.cierres),
      premio: p.etiqueta,
      valor: p.renovacionGratis
        ? `${numeroAR(v.pagoUnicoUSD)} en pago único · ${numeroAR(v.planDePagosUSD)} en plan de pagos`
        : p.extra ? `${numeroAR(v.pagoUnicoUSD)} + extra` : numeroAR(v.pagoUnicoUSD),
    }
  })
  const ultimo = escalera[escalera.length - 1]
  const ren = mesesRenovacionGratis(R)
  const T = R.topeMesesAcumulados
  const tope = T === null ? null : valorizarMeses(T, true, R)
  filas.push({
    clave: 'mas',
    cuando: `${ultimo.cierres + 1} o más`,
    premio: T === null
      ? `+${mesesTexto(R.masAllaDeLaEscalera.mesesPorCierreExtra)} de servicio por cada cierre extra, sin tope de meses`
      : `+${mesesTexto(R.masAllaDeLaEscalera.mesesPorCierreExtra)} de servicio por cada cierre extra, hasta ${T} meses acumulados en total (los ${ren} de la renovación gratis más ${T - ren} extra; se llega con ${cierresParaElTope(R)} cierres)`,
    valor: tope === null
      ? `${numeroAR(R.valorMesUSD)} por cada mes extra`
      : `hasta ${numeroAR(tope.pagoUnicoUSD)} en pago único · ${numeroAR(tope.planDePagosUSD)} en plan de pagos`,
  })
  return filas
}

interface FilaIntento { clave: string; cuando: string; premio: string; veces: string }

// Escalera por intentos: los premios salen de la configuración. La web y el branding se ganan una sola vez por cliente.
function filasIntentos(): FilaIntento[] {
  const escalera = [...R.intentos.escalera].sort((a, b) => a.intento - b.intento)
  const filas: FilaIntento[] = escalera.map(p => ({
    clave: `i${p.intento}`,
    cuando: `Intento ${p.intento}`,
    premio: p.etiqueta,
    veces: esPremioUnico(p.premio) ? 'Una sola vez por cliente' : 'Cada vez que se llega',
  }))
  const siguiente = premioDelIntento(escalera[escalera.length - 1].intento + 1, R)
  filas.push({
    clave: 'mas',
    cuando: `Del intento ${siguiente.intento} en adelante`,
    premio: `${siguiente.etiqueta}${R.intentos.masAllaDeLaEscalera.tentativo ? ' (tentativo: ver las dudas abiertas)' : ''}`,
    veces: R.intentos.masAllaDeLaEscalera.sinTope ? 'Por cada intento, sin tope' : 'Por cada intento',
  })
  return filas
}

// Lo que recibe la persona referida (el lead): todo sale de R.referido
interface FilaReferido { clave: string; cuando: string; recibe: string; valor: string }
function filasReferido(): FilaReferido[] {
  const { descuentoUSD, mesesServicioExtra, soloEnLlamada } = R.referido
  const cuando = soloEnLlamada ? 'Se suma en la llamada (cierra)' : 'Cierra'
  return [
    { clave: 'mes', cuando: 'Cierra como cliente referido', recibe: `${mesesTexto(mesesServicioExtra)} más de servicio, gratis y automático`, valor: `${numeroAR(mesesServicioExtra * R.valorMesUSD)} de referencia` },
    { clave: 'desc', cuando, recibe: `USD ${numeroAR(descuentoUSD)} de descuento sobre su primer pago`, valor: numeroAR(descuentoUSD) },
    { clave: 'no', cuando: soloEnLlamada ? 'No se suma en la llamada' : 'No cierra', recibe: soloEnLlamada ? 'No obtiene el descuento; el mes extra se aplica si cierra después' : 'Sin beneficios mientras no cierre', valor: '—' },
  ]
}
const COLUMNAS_REFERIDO: Columna<FilaReferido>[] = [
  { clave: 'cuando', titulo: 'Cuándo' },
  { clave: 'recibe', titulo: 'Lo que recibe la persona referida', largo: true },
  { clave: 'valor', titulo: 'Valor (USD)' },
]

const COLUMNAS_ESCALERA: Columna<FilaPremio>[] = [
  { clave: 'cuando', titulo: 'Cierres liberados' },
  { clave: 'premio', titulo: 'Lo que gana quien refiere', largo: true },
  { clave: 'valor', titulo: 'Valor de referencia (USD)', largo: true },
]

const COLUMNAS_INTENTOS: Columna<FilaIntento>[] = [
  { clave: 'cuando', titulo: 'Intentos acumulados' },
  { clave: 'premio', titulo: 'Lo que gana quien refiere', largo: true },
  { clave: 'veces', titulo: 'Cuántas veces' },
]

interface FilaMeta { clave: string; mes: string; meta: string }
const COLUMNAS_META: Columna<FilaMeta>[] = [
  { clave: 'mes', titulo: 'Desde' },
  { clave: 'meta', titulo: 'Meta: clientes nuevos del mes que entran por referido' },
]

interface FilaApoyo { clave: string; indicador: string; objetivo: string; estado: string }
const COLUMNAS_APOYO: Columna<FilaApoyo>[] = [
  { clave: 'indicador', titulo: 'Indicador de apoyo', largo: true },
  { clave: 'objetivo', titulo: 'Objetivo' },
  { clave: 'estado', titulo: 'Estado' },
]

// "final-2026-10-07" → 7/10/2026
const fechaDeVersion = (v: string) => {
  const m = /(\d{4}-\d{2}-\d{2})$/.exec(v)
  return m ? fechaCorta(m[1]) : v
}

export function ReglasPrograma() {
  const dudas = R.dudasAbiertas.length
  const intentoDelMes = R.intentos.escalera.find(p => p.premio === 'mes_servicio')?.intento
  const filasMeta: FilaMeta[] = [...R.metas.kpiPrincipal.hitos].sort((a, b) => a.desde.localeCompare(b.desde))
    .map(h => ({ clave: h.desde, mes: mesLargo(h.desde), meta: rangoMetaTexto(h) }))
  const filasApoyo: FilaApoyo[] = R.metas.apoyo.map(i => ({
    clave: i.clave,
    indicador: i.periodo ? `${i.etiqueta} (${i.periodo})` : i.etiqueta,
    objetivo: objetivoApoyoTexto(i),
    estado: i.verificado ? 'Verificado' : 'Estimación sin verificar',
  }))

  return (
    <section className="cj-pila cj-pila--chica" style={{ gap: 40 }} aria-label="Reglas del programa">
      <SeccionTitulo etiqueta="Reglas" titulo="Cómo funciona el programa" nivel={2} />

      <div className="cj-panel">
        <p>
          <span className="cj-etiqueta cj-etiqueta--laton">
            Reglas {R.estado === 'borrador' ? 'en borrador' : 'vigentes'} · versión del {fechaDeVersion(R.version)}
          </span>
        </p>
        <p>
          El programa arranca en {mesLargo(mesDe(R.vigenteDesde))} (desde el {fechaCorta(R.vigenteDesde)}): los referidos presentados antes no generan crédito.
        </p>
        {dudas > 0 && (
          <p>
            Hay {dudas} {dudas === 1 ? 'duda abierta' : 'dudas abiertas'}, al final de esta sección. Mientras no se confirmen, el cálculo usa el valor que dice cada una.
          </p>
        )}
      </div>

      <dl className="cj-datos">
        <div>
          <dt className="cj-etiqueta">Quién refiere</dt>
          <dd>Un cliente activo.</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Cuándo se pide</dt>
          <dd>{R.pedido.momentos.map(m => ETIQUETA_MOMENTO[m]).join(', ')}.</dd>
          <dd className="cj-texto-2">Hasta {R.pedido.maxNombresPorPedido} nombres por pedido (es un supuesto).</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Qué gana el referido</dt>
          <dd>
            {mesesTexto(R.referido.mesesServicioExtra)} más de servicio al cerrar, aplicado automáticamente.
            {' '}USD {numeroAR(R.referido.descuentoUSD)} de descuento{R.referido.soloEnLlamada && ' solo si se suma en la llamada y el closer lo confirma'}.
          </dd>
          {R.referido.soloEnLlamada && <dd className="cj-texto-2">La planilla no tiene un dato de que haya cerrado en la llamada: el closer lo confirma (ver las dudas abiertas).</dd>}
        </div>
        <div>
          <dt className="cj-etiqueta">Quién cuenta como referido válido</dt>
          <dd>Un lead nuevo, de otro estudio, que asiste a la llamada.</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Intentos</dt>
          <dd>Un intento es un referido que entra a la llamada y no cierra. Los cierres no cuentan como intentos.</dd>
          <dd className="cj-texto-2">Cada premio se gana en la fecha de la llamada del intento (o la del pedido, si falta la llamada). Los premios por intentos están en la segunda tabla.</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Cuándo se libera un crédito</dt>
          <dd>Cuando entra el primer pago del referido y pasaron {R.liberacion.diasSinReembolso} días sin reembolso.</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Vigencia</dt>
          <dd>{R.vigenciaMeses} meses desde que se libera el crédito de un cierre o desde la llamada del intento que dio el premio.</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Cómo se canjea</dt>
          <dd>
            Solo contra la renovación de quien refiere{R.canje.enEfectivo ? ' o en efectivo.' : '; nunca en efectivo.'}
            {R.canje.venceSiNoRenueva && ' Si no renueva dentro de la vigencia, el crédito vence.'}
          </dd>
          <dd className="cj-texto-2">Los meses liberados y vigentes se aplican automáticamente al confirmar una nueva renovación en el Despacho. La vista previa muestra el beneficio y el fin del servicio.</dd>
          <dd className="cj-texto-2">Los créditos en USD se llevan aparte de los meses (no se convierten) y requieren un canje manual: no se descuentan automáticamente.</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Tope</dt>
          <dd>
            {R.topeMesesAcumulados === null
              ? `Sin tope: los meses de la escalera de cierres${intentoDelMes ? ` y el mes del intento ${intentoDelMes}` : ''} se suman sin límite.`
              : `${R.topeMesesAcumulados} meses acumulados en total: los de la escalera de cierres${intentoDelMes ? ` y el mes del intento ${intentoDelMes}` : ''}, juntos.`}
          </dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Grabación con cámara profesional</dt>
          <dd>
            Extra para quien refiere solo si está en la zona de Buenos Aires: grabación en las {R.grabacion.lugar}. No es un crédito que se gane solo: el closer lo ofrece
            en la llamada de los referidos y lo confirma.
          </dd>
          <dd className="cj-texto-2">La zona se deduce del teléfono del cliente (código de área 11) y es solo una pista; si no se puede deducir queda sin determinar.</dd>
        </div>
        <div>
          <dt className="cj-etiqueta">Valor de referencia</dt>
          <dd>1 mes = {usd(R.valorMesUSD)}. La renovación gratis ({mesesTexto(mesesRenovacionGratis(R))}) = {usd(R.renovacionGratis.valorPagoUnicoUSD)} en pago único o {usd(R.renovacionGratis.valorPlanDePagosUSD)} en plan de pagos.</dd>
          <dd className="cj-texto-2">Solo para reportes: el crédito se lleva en meses.</dd>
        </div>
      </dl>

      <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
        <Etiqueta como="h3">Lo que recibe la persona referida</Etiqueta>
        <Tabla descripcion="Beneficios de la persona referida si cierra" columnas={COLUMNAS_REFERIDO} filas={filasReferido()} claveFila={f => f.clave} />
        <p className="cj-parrafo cj-texto-2">
          Vale solo si se suma en la llamada. La planilla no tiene ese dato, así que lo confirma el closer (ver las dudas abiertas).
        </p>
      </div>

      <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
        <Etiqueta como="h3">Escalera por cierres liberados</Etiqueta>
        <Tabla descripcion="Escalera de premios por cierres liberados" columnas={COLUMNAS_ESCALERA} filas={filasEscalera()} claveFila={f => f.clave} />
        <p className="cj-parrafo cj-texto-2">
          El nivel alcanzado reemplaza al anterior: no se suman. La escalera se cuenta dentro de un ciclo, que termina cuando se canjea contra una renovación.
        </p>
        {R.escalera.filter(p => p.extra).map(p => (
          <p key={p.cierres} className="cj-parrafo cj-texto-2">
            Extra de {textoCierres(p.cierres)}: {minuscula(textoExtra(p.extra ?? ''))}.
          </p>
        ))}
      </div>

      <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
        <Etiqueta como="h3">Escalera por intentos</Etiqueta>
        <Tabla descripcion="Escalera de premios por intentos" columnas={COLUMNAS_INTENTOS} filas={filasIntentos()} claveFila={f => f.clave} />
        <p className="cj-parrafo cj-texto-2">
          Se mide con la cantidad acumulada de intentos de quien refiere. El contador sigue de largo (no vuelve a cero en cada ciclo) y la página web y el branding se ganan una sola vez por cliente.
        </p>
      </div>

      <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
        <Etiqueta como="h3">Metas</Etiqueta>
        <Tabla descripcion="Meta del indicador principal, por mes" columnas={COLUMNAS_META} filas={filasMeta} claveFila={f => f.clave} />
        <p className="cj-parrafo cj-texto-2">
          Entre una meta y la siguiente rige la última fijada. Los indicadores de apoyo son estimaciones todavía sin verificar: orientan, pero no son metas firmes.
        </p>
        <Tabla descripcion="Indicadores de apoyo (estimaciones sin verificar)" columnas={COLUMNAS_APOYO} filas={filasApoyo} claveFila={f => f.clave} />
      </div>

      <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
        <Etiqueta como="h3">Dudas abiertas</Etiqueta>
        {dudas === 0 ? (
          <p className="cj-parrafo">No hay dudas abiertas.</p>
        ) : (
          <ul className="cj-lista">
            {R.dudasAbiertas.map(d => (
              <li key={d.clave}>{d.texto}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
