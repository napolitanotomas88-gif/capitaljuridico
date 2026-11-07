import { Bloque, Estado, Tabla, VacioGuiado, type Columna } from '@/components/ui'
import { barraCasos, fechaLarga, type ProgresoCasos } from '@/lib/clientes/portal/modelo'
import { nombreMes, numero, usd, type MesReporte, type Reporte } from '@/lib/clientes/portal/reporte'
import { ReportePorPeriodo } from './ReportePorPeriodo'
import './portal.css'

// Portal del cliente (2/11/2026, pedido de Tomás para un estudio cliente): la barra de casos conseguidos (con la marca intermedia) y el
// reporte de anuncios (inversión, costo por mensaje y por caso, ingresos estimados, profit y retorno). Pautas de la skill dataviz:
// un medidor de una sola serie con su marca, el número escrito al lado (nunca solo color), cifras como tarjetas y una tabla por
// mes como vista de datos. Colores: solo tokens del Despacho (oro mate para el avance; sin brillos).

/** Barra de progreso de casos: avance hasta el objetivo final, con la marca intermedia (ej.: 200 para noviembre). */
export function ProgresoCasosVista({ progreso }: { progreso: ProgresoCasos }) {
  const b = barraCasos(progreso)
  if (!b) return <VacioGuiado titulo="Lo estamos contando" texto="Cuando carguemos los casos conseguidos, vas a ver acá cuánto falta para el objetivo." />
  const texto = `${numero(b.casos)} de ${numero(b.meta)} casos conseguidos (${Math.floor(b.porcentaje)} %)${b.hito ? `. Meta intermedia: ${numero(b.hito.casos)}${b.hito.fecha ? ` para el ${fechaLarga(b.hito.fecha)}` : ''}${b.hito.logrado ? ', lograda' : `, faltan ${numero(b.hito.faltan)}`}` : ''}.`
  return (
    <div className="pc-progreso">
      <p className="pc-progreso__cifra">
        <span className="pc-progreso__n cj-num">{numero(b.casos)}</span>
        <span className="pc-progreso__de">de {numero(b.meta)} casos conseguidos</span>
      </p>
      <div className="pc-barra" role="progressbar" aria-label="Casos conseguidos" aria-valuemin={0} aria-valuemax={b.meta} aria-valuenow={b.casos} aria-valuetext={texto}>
        <div className="pc-barra__pista">
          <div className="pc-barra__relleno" style={{ width: `${b.porcentaje}%` }} />
          {b.hito && <div className="pc-barra__marca" data-logrado={b.hito.logrado} style={{ left: `${b.hito.porcentaje}%` }} aria-hidden="true" />}
        </div>
        {b.hito && (
          <div className="pc-barra__rotulos" aria-hidden="true">
            <span className="pc-barra__rotulo" style={{ left: `${b.hito.porcentaje}%` }} data-borde={b.hito.porcentaje > 78 ? 'fin' : b.hito.porcentaje < 22 ? 'inicio' : undefined}>
              <strong>{numero(b.hito.casos)}</strong> {b.hito.fecha ? `· ${mesCorto(b.hito.fecha)}` : '· meta'}
            </span>
          </div>
        )}
        <div className="pc-barra__escala" aria-hidden="true"><span>0</span><span>{numero(b.meta)}</span></div>
      </div>
      <dl className="pc-progreso__datos">
        {b.hito && (
          <div>
            <dt className="cj-etiqueta">Próxima meta</dt>
            <dd>
              {numero(b.hito.casos)} casos{b.hito.fecha ? ` al ${fechaLarga(b.hito.fecha)}` : ''}{' '}
              {b.hito.logrado ? <Estado tono="ok">Lograda</Estado> : <span className="cj-texto-2">· faltan {numero(b.hito.faltan)}</span>}
            </dd>
          </div>
        )}
        <div>
          <dt className="cj-etiqueta">Objetivo final</dt>
          <dd>{numero(b.meta)} casos <span className="cj-texto-2">· faltan {numero(b.faltan)}</span></dd>
        </div>
        {progreso.actualizado && (
          <div>
            <dt className="cj-etiqueta">Último conteo</dt>
            <dd>{fechaLarga(progreso.actualizado)}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

const mesCorto = (f: string) => ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(f.slice(5, 7)) - 1] ?? ''
const usd2 = (n: number | null) => usd(n, 2)
const veces = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}x`)

/** Reporte de anuncios del cliente. `reporte` ya viene armado del servidor y solo con SUS cuentas. */
export function ReporteAnunciosVista({ reporte, leido }: { reporte: Reporte; leido: string }) {
  const a = reporte.acumulado
  const columnas: Columna<MesReporte>[] = [
    { clave: 'mes', titulo: 'Mes', celda: f => nombreMes(f.mes) },
    { clave: 'inversion', titulo: 'Inversión', numerica: true, celda: f => usd(f.inversion) },
    { clave: 'mensajes', titulo: 'Mensajes', numerica: true, celda: f => numero(f.mensajes) },
    { clave: 'costoMensaje', titulo: 'Costo por mensaje', numerica: true, celda: f => usd2(f.costoMensaje) },
    { clave: 'casos', titulo: 'Casos', numerica: true, celda: f => numero(f.casos) },
    { clave: 'costoCaso', titulo: 'Costo por caso', numerica: true, celda: f => usd(f.costoCaso) },
    { clave: 'ingresos', titulo: 'Ingresos estimados', numerica: true, celda: f => usd(f.ingresos) },
    { clave: 'profit', titulo: 'Profit estimado', numerica: true, celda: f => usd(f.profit) },
    { clave: 'retorno', titulo: 'Retorno', numerica: true, celda: f => veces(f.retorno) },
  ]
  const fm = reporte.porcentajeSeguidores
  return (
    <div className="cj-pila">
      <ReportePorPeriodo reporte={reporte} />
      <p className="cj-parrafo pc-nota">
        {fm === null || fm === 0
          ? <>Follow Me Ads (campañas para sumar seguidores): <strong>todavía sin inversión</strong>. El plan es destinarle entre el 20 y el 25 % del presupuesto.</>
          : <>Follow Me Ads (campañas para sumar seguidores): <strong className="cj-num">{fm} %</strong> de la inversión ({usd(a.inversionSeguidores)}). El plan es entre el 20 y el 25 %.</>}
      </p>
      {reporte.porMes.length > 0 && (
        <details className="cj-detalles" open>
          <summary><strong>Histórico mes por mes</strong><span className="cj-texto-2">&nbsp;· {reporte.porMes.length} {reporte.porMes.length === 1 ? 'mes' : 'meses'}</span></summary>
          <div style={{ marginTop: 16 }}>
            <Tabla descripcion="Inversión, mensajes, casos, ingresos, profit y retorno estimados de cada mes" columnas={columnas} filas={reporte.porMes} claveFila={f => f.mes} />
            <p className="cj-parrafo cj-texto-2 pc-nota" style={{ marginTop: 12 }}>Los casos de cada mes salen de los conteos que vamos registrando; si falta el conteo de un cierre, ese mes queda «—».</p>
          </div>
        </details>
      )}
      <p className="cj-texto-2 pc-pie">Datos de Meta (tus cuentas publicitarias), en dólares. Se actualizan cada hora · última lectura: {horaLectura(leido)}.</p>
    </div>
  )
}

const horaLectura = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(+d)) return '—'
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })
}

/** Sección completa del reporte con sus estados vacíos (sin cuentas / Meta no respondió). */
export function BloqueReporte({ reporte }: { reporte: { datos: Reporte; leido: string } | 'error' | null }) {
  return (
    <Bloque titulo="Tus anuncios en números" etiqueta="Cuánto invertís y cuánto vuelve" id="reporte">
      {reporte === null
        ? <VacioGuiado titulo="Todavía no conectamos tus anuncios" texto="Cuando conectemos tus cuentas publicitarias, vas a ver acá cuánto te cuesta cada mensaje y cada caso." />
        : reporte === 'error'
          ? <VacioGuiado titulo="Lo estamos actualizando" texto="No pudimos leer tus anuncios en este momento. Probá de nuevo en un rato." />
          : <ReporteAnunciosVista reporte={reporte.datos} leido={reporte.leido} />}
    </Bloque>
  )
}
