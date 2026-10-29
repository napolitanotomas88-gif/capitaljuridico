import Link from 'next/link'
import { Cifra, Etiqueta, SeccionTitulo, Tabla, Vacio, type Columna } from '@/components/ui'
import { fechaCorta, numeroAR } from '@/lib/clientes/formato'
import { mesLargo, porcentajeTexto, rangoMetaTexto } from '@/lib/clientes/metas'
import { etiquetaNivel, type CercaDelNivel, type FilaRanking, type ResumenPrograma } from '@/lib/clientes/programa'

// Resultados del programa: embudo, créditos, ranking de referidores y quién está cerca del próximo nivel.
// Estados vacíos honestos mientras las pestañas "Referidos" y "Créditos" no existan o no tengan filas.
type Props = { resumen: ResumenPrograma; pestanasAusentes: string[]; sufijo: string }

const porcentaje = (parte: number, total: number) => (total > 0 ? `${Math.round((parte / total) * 100)} %` : '—')

// Meta del KPI principal (clientes nuevos del mes que entran por referido) frente a lo real, con estados vacíos honestos
function MetaDelMes({ kpi, resumen }: { kpi: ResumenPrograma['kpi']; resumen: ResumenPrograma }) {
  const { meta } = kpi
  if (!meta)
    return <Vacio frase={`Todavía no hay meta para ${mesLargo(kpi.mes)}: las metas empiezan con el programa, en octubre de 2026.`} />
  const sinRegistros = resumen.embudo.presentados === 0 && kpi.porReferido === 0 && kpi.estado === 'ok'
  const real =
    sinRegistros
      ? { valor: '—', contexto: `Sin registros todavía: la pestaña “Referidos” existe pero está vacía. Hay ${kpi.clientesNuevos} ${kpi.clientesNuevos === 1 ? 'cliente nuevo' : 'clientes nuevos'} este mes y ninguno cargado como referido, no un 0 % confirmado` }
      : kpi.estado === 'sin_pestana'
      ? { valor: '—', contexto: 'Todavía no existe la pestaña “Referidos” en la planilla: no hay de dónde calcularlo' }
      : kpi.estado === 'sin_clientes_nuevos'
        ? { valor: '—', contexto: `Todavía no hay clientes nuevos con Día 1 en ${mesLargo(kpi.mes)}` }
        : {
            valor: porcentajeTexto(Math.round((kpi.porcentaje ?? 0) * 10) / 10),
            contexto: `${kpi.porReferido} de ${kpi.clientesNuevos} ${kpi.clientesNuevos === 1 ? 'cliente nuevo' : 'clientes nuevos'} · ${kpi.cumpleMeta ? 'alcanza la meta' : 'por debajo de la meta'}`,
          }
  return (
    <>
      <div className="cj-franja">
        <Cifra
          tamano="media"
          etiqueta="Meta del mes"
          valor={rangoMetaTexto(meta)}
          contexto={
            <>
              {meta.esHito ? `Fijada para ${mesLargo(meta.hitoDesde)}` : `Sigue la meta fijada para ${mesLargo(meta.hitoDesde)}`}
              {meta.siguiente && <span className="cj-sub">Próxima: {rangoMetaTexto(meta.siguiente)} desde {mesLargo(meta.siguiente.desde)}</span>}
            </>
          }
        />
        <Cifra tamano="media" etiqueta="Real hasta hoy" valor={real.valor} contexto={real.contexto} />
      </div>
      {kpi.cierresSinCliente > 0 && (
        <p className="cj-parrafo cj-texto-2">
          {kpi.cierresSinCliente} {kpi.cierresSinCliente === 1 ? 'cierre de referidos no tiene' : 'cierres de referidos no tienen'} cargado el “ID cliente nuevo”: no se puede ubicar en ningún cliente y no entra en este cálculo.
        </p>
      )}
    </>
  )
}

export function ResumenReferidos({ resumen, pestanasAusentes, sufijo }: Props) {
  const sinReferidos = pestanasAusentes.includes('Referidos')
  const sinCreditos = pestanasAusentes.includes('Créditos')
  const { embudo, creditos, kpi } = resumen

  const enlace = (id: string, nombre: string, enCrm: boolean) =>
    enCrm ? (
      <Link href={`/clientes/${encodeURIComponent(id)}${sufijo}`} prefetch={false} className="cj-enlace-fila">
        {nombre}
      </Link>
    ) : (
      nombre
    )

  const columnasRanking: Columna<FilaRanking>[] = [
    { clave: 'cliente', titulo: 'Referidor', largo: true, celda: f => (<>{enlace(f.idCliente, f.nombre, f.enCrm)}<span className="cj-sub">{f.idCliente}</span></>) },
    { clave: 'presentados', titulo: 'Presentados', numerica: true, celda: f => f.presentados },
    { clave: 'asistieron', titulo: 'Asistieron', numerica: true, celda: f => f.asistieron },
    { clave: 'cerraron', titulo: 'Cerraron', numerica: true, celda: f => f.cerraron },
    { clave: 'liberados', titulo: 'Liberados', numerica: true, celda: f => f.liberados },
    { clave: 'intentos', titulo: 'Intentos', numerica: true, celda: f => f.intentos },
    { clave: 'meses', titulo: 'Saldo (meses)', numerica: true, celda: f => f.meses },
    { clave: 'usd', titulo: 'Saldo (USD)', numerica: true, celda: f => numeroAR(f.usd) },
    { clave: 'nivel', titulo: 'Nivel', celda: f => (f.renovacionGratis ? `${etiquetaNivel(f.nivel)} · renovación gratis` : etiquetaNivel(f.nivel)) },
  ]

  const columnasCerca: Columna<CercaDelNivel>[] = [
    { clave: 'cliente', titulo: 'Cliente', largo: true, celda: f => (<>{enlace(f.idCliente, f.nombre, f.enCrm)}<span className="cj-sub">{f.idCliente}</span></>) },
    { clave: 'nivel', titulo: 'Nivel actual', celda: f => etiquetaNivel(f.nivel) },
    {
      clave: 'cierres', titulo: 'Cierres', numerica: true,
      celda: f => (<>{f.cierresLiberados} {f.cierresLiberados === 1 ? 'liberado' : 'liberados'}{f.cierresPendientes > 0 && <span className="cj-sub">{f.cierresPendientes} por liberarse</span>}</>),
    },
    {
      clave: 'falta', titulo: 'Para el próximo nivel',
      celda: f => (f.faltan === 0 ? 'Alcanza cuando se liberen los pendientes' : `Falta ${f.faltan} cierre`),
    },
    { clave: 'premio', titulo: 'Lo que gana', largo: true, celda: f => f.premio },
  ]

  return (
    <section className="cj-pila cj-pila--chica" style={{ gap: 40 }} aria-label="Resultados del programa">
      <SeccionTitulo etiqueta="Resultados" titulo="Cómo viene el programa" nivel={2} />

      <div className="cj-pila cj-pila--chica" style={{ gap: 24 }}>
        <Etiqueta como="h3">Indicador principal · {mesLargo(kpi.mes)}</Etiqueta>
        <p className="cj-parrafo cj-texto-2">
          De los clientes nuevos del mes (Agencia, con Día 1 en el mes), cuántos entraron por un referido que cerró.
        </p>
        <MetaDelMes kpi={kpi} resumen={resumen} />
      </div>

      {sinReferidos ? (
        <Vacio frase="Todavía no existe la pestaña “Referidos” en la planilla del CRM. Cuando se cree y se carguen los primeros pedidos, acá aparecen el embudo, los créditos y el ranking de referidores." />
      ) : embudo.presentados === 0 ? (
        <Vacio
          frase={
            resumen.anterioresAlPrograma > 0
              ? `Los ${resumen.anterioresAlPrograma} referidos cargados se presentaron antes del ${fechaCorta(resumen.programaDesde)}, así que no cuentan para el programa. Cuando haya pedidos nuevos, acá aparecen el embudo, los créditos y el ranking de referidores.`
              : 'Sin registros todavía: la pestaña “Referidos” existe pero está vacía, así que no hay nada que contar (no son ceros confirmados). Cuando haya pedidos, acá aparecen el embudo, los créditos y el ranking de referidores.'
          }
        />
      ) : (
        <>
          <div className="cj-pila cj-pila--chica" style={{ gap: 24 }}>
            <Etiqueta como="h3">Embudo · al {fechaCorta(resumen.hoy)}</Etiqueta>
            <div className="cj-franja">
              <Cifra tamano="media" etiqueta="Presentados" valor={numeroAR(embudo.presentados)} contexto={`${resumen.referidoresActivos} ${resumen.referidoresActivos === 1 ? 'cliente refirió' : 'clientes refirieron'}`} />
              <Cifra tamano="media" etiqueta="Asistieron" valor={numeroAR(embudo.asistieron)} contexto={`${porcentaje(embudo.asistieron, embudo.presentados)} de los presentados`} />
              <Cifra tamano="media" etiqueta="Cerraron" valor={numeroAR(embudo.cerraron)} contexto={`${porcentaje(embudo.cerraron, embudo.asistieron)} de los que asistieron`} />
              <Cifra tamano="media" etiqueta="Liberados" valor={numeroAR(embudo.liberados)} contexto="Pasaron los días sin reembolso" />
              <Cifra tamano="media" etiqueta="Intentos" valor={numeroAR(resumen.intentos)} contexto="Entraron a la llamada y no cerraron" />
            </div>
            {resumen.anterioresAlPrograma > 0 && (
              <p className="cj-parrafo cj-texto-2">
                {resumen.anterioresAlPrograma} {resumen.anterioresAlPrograma === 1 ? 'referido presentado' : 'referidos presentados'} antes del {fechaCorta(resumen.programaDesde)} no se cuenta{resumen.anterioresAlPrograma === 1 ? '' : 'n'}: no genera{resumen.anterioresAlPrograma === 1 ? '' : 'n'} crédito.
              </p>
            )}
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 24 }}>
            <Etiqueta como="h3">Créditos en meses de servicio · al {fechaCorta(resumen.hoy)}</Etiqueta>
            <div className="cj-franja">
              <Cifra
                tamano="media"
                etiqueta="Otorgados"
                valor={numeroAR(creditos.otorgadosMeses)}
                contexto={`${numeroAR(creditos.disponiblesMeses)} disponibles hoy · referencia USD ${numeroAR(creditos.otorgadosMeses * creditos.valorMesUSD)}`}
              />
              <Cifra
                tamano="media"
                etiqueta="Canjeados"
                valor={numeroAR(creditos.canjeadosMeses)}
                contexto={sinCreditos ? 'Se leen de la pestaña Créditos, que todavía no existe' : `Referencia USD ${numeroAR(creditos.canjeadosMeses * creditos.valorMesUSD)}`}
              />
              <Cifra
                tamano="media"
                etiqueta="Por vencer"
                valor={numeroAR(creditos.porVencerMeses)}
                contexto={`Vencen en los próximos ${creditos.diasAviso} días · referencia USD ${numeroAR(creditos.porVencerMeses * creditos.valorMesUSD)}`}
              />
            </div>
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 24 }}>
            <Etiqueta como="h3">Créditos en USD · al {fechaCorta(resumen.hoy)}</Etiqueta>
            <div className="cj-franja">
              <Cifra tamano="media" etiqueta="Disponibles" valor={`USD ${numeroAR(creditos.usdDisponible)}`} contexto="De los intentos: se canjean solo contra la renovación" />
              <Cifra
                tamano="media"
                etiqueta="Canjeados"
                valor={`USD ${numeroAR(creditos.usdCanjeado)}`}
                contexto={sinCreditos ? 'Se leen del texto del campo Extra de la pestaña Créditos, que todavía no existe' : 'Se leen del texto del campo Extra de los canjes: el libro no tiene columna de USD'}
              />
              <Cifra tamano="media" etiqueta="Por vencer" valor={`USD ${numeroAR(creditos.usdPorVencer)}`} contexto={`Vencen en los próximos ${creditos.diasAviso} días`} />
            </div>
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Ranking de referidores</Etiqueta>
            <Tabla descripcion="Ranking de referidores" columnas={columnasRanking} filas={resumen.ranking} claveFila={f => f.idCliente} className="cj-tabla-compacta" />
          </div>

          <div className="cj-pila cj-pila--chica" style={{ gap: 16 }}>
            <Etiqueta como="h3">Cerca del próximo nivel</Etiqueta>
            <Tabla
              descripcion="Clientes cerca del próximo nivel de la escalera"
              columnas={columnasCerca}
              filas={resumen.cerca}
              claveFila={f => f.idCliente}
              vacio={<Vacio frase="Nadie está a un paso del próximo nivel por ahora." />}
            />
          </div>
        </>
      )}
    </section>
  )
}
