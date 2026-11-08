'use client'

import { useState } from 'react'
import { ChipFiltro, Resumen, type DatoResumen } from '@/components/ui'
import { nombreMes, numero, usd, type Metricas, type Reporte } from '@/lib/clientes/portal/reporte'

// Reporte del cliente filtrable por período (5/11/2026, pedido del equipo para un estudio cliente): las mismas cinco cifras
// (inversión, mensajes, costo por caso, ingresos y profit) para todo lo invertido desde que arrancamos o para un mes puntual,
// con chips de filtro. Un mes sin conteo de casos que lo cierre deja casos, ingresos y profit en «—» (no se inventan).

const usd2 = (n: number | null) => usd(n, 2)
const veces = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}x`)

function cifras(x: Metricas, periodo: string, valor: string, mensual: boolean): DatoResumen[] {
  const sinCasos = mensual ? 'Se calcula con el conteo de casos del mes' : 'Falta cargar los casos'
  return [
    { etiqueta: 'Inversión en anuncios', icono: 'anuncios', valor: usd(x.inversion), contexto: periodo },
    { etiqueta: 'Mensajes recibidos', icono: 'guiones', valor: numero(x.mensajes), contexto: `Cada uno te costó ${usd2(x.costoMensaje)}` },
    { etiqueta: 'Costo por caso', icono: 'tarea', valor: usd(x.costoCaso), contexto: x.casos !== null ? `${numero(x.casos)} casos conseguidos` : sinCasos },
    { etiqueta: 'Ingresos estimados', icono: 'dinero', valor: usd(x.ingresos), contexto: x.casos !== null ? `${numero(x.casos)} casos × ${valor}` : sinCasos },
    { etiqueta: 'Profit estimado', icono: 'ok', destacado: true, valor: usd(x.profit), contexto: x.retorno !== null ? `Retorno: ${veces(x.retorno)} lo invertido` : 'Ingresos estimados menos inversión' },
  ]
}

export function ReportePorPeriodo({ reporte }: { reporte: Reporte }) {
  const [periodo, setPeriodo] = useState<string>('todo')
  const valor = usd(reporte.valorCaso)
  const desde = reporte.desde ? nombreMes(reporte.desde) : null
  const mes = reporte.porMes.find(m => m.mes === periodo) ?? null
  const datos = mes
    ? cifras(mes, nombreMes(mes.mes), valor, true)
    : cifras(reporte.acumulado, desde ? `Desde ${desde}` : 'Todavía sin inversión', valor, false)
  return (
    <div className="cj-pila cj-pila--chica">
      <div className="pc-periodos" role="group" aria-label="Elegí el período">
        <ChipFiltro activo={!mes} onClick={() => setPeriodo('todo')}>Desde que arrancamos</ChipFiltro>
        {reporte.porMes.map(m => (
          <ChipFiltro key={m.mes} activo={periodo === m.mes} onClick={() => setPeriodo(m.mes)}>{nombreMes(m.mes)}</ChipFiltro>
        ))}
      </div>
      <h3 className="pc-subtitulo" aria-live="polite">{mes ? nombreMes(mes.mes) : `Desde que arrancamos${desde ? ` (${desde})` : ''}`}</h3>
      <Resumen titulo={mes ? `Reporte de anuncios de ${nombreMes(mes.mes)}` : 'Reporte acumulado de anuncios'} datos={datos} />
      <p className="cj-parrafo cj-texto-2 pc-nota">
        Los ingresos y el profit son <strong>estimados</strong>: casos
        conseguidos × {valor}, el valor promedio de un caso. El costo por mensaje toma solo las campañas de mensajes.
      </p>
    </div>
  )
}
