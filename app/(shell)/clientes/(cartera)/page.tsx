import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Resumen, SeccionTitulo, type DatoResumen } from '@/components/ui'
import { pedidoDemo } from '@/lib/clientes/demo'
import { AvisoLectura } from '@/components/clientes/AvisoLectura'
import { ErrorLectura } from '@/components/clientes/ErrorLectura'
import { puedeVer } from '@/lib/auth/roles'
import { exigirAcceso } from '@/lib/auth/sesion'
import { fechaCorta, numeroAR } from '@/lib/clientes/formato'
import { indicadoresDeCartera } from '@/lib/clientes/indicadores'
import { parsearFiltros } from '@/lib/clientes/listado'
import { cargarVista, estadoDeLectura, type VistaCRM } from '@/lib/clientes/vista'
import { BotonMontos } from '@/components/clientes/BotonMontos'
import { Monto } from '@/components/clientes/Monto'
import { CalidadDatos } from './_componentes/CalidadDatos'
import { EsperaBloque, ListaEnVivo, RecorridoEnVivo } from './_componentes/EnVivo'

// Cartera de clientes (CRM): cifras al día de hoy, la línea de tiempo, filtros, búsqueda y la lista. Solo lectura.
// La lectura de la planilla (una sola, con snapshot de 10 min) se hace acá en el servidor; el navegador solo recibe
// filas livianas, sin teléfonos, mails ni notas.
// Streaming (25/10/2026): el título y las cifras salen apenas está el CRM; la línea de tiempo y la lista, que esperan a
// Seguimiento, Typeform, ClickUp, Meta y el Despacho, llegan después cada una con su esqueleto (_componentes/EnVivo.tsx).

export const metadata: Metadata = { title: 'Clientes' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ClientesPage({ searchParams }: Props) {
  const sesion = await exigirAcceso('clientes')
  const params = await searchParams
  const filtrosUrl = parsearFiltros(params)
  // ?demo=1 (solo en desarrollo): datos ficticios de lib/clientes/demo.ts, sin leer planillas, ClickUp, Meta ni Typeform
  const demo = pedidoDemo(params.demo)
  const verCobros = puedeVer(sesion, 'finanzas')

  let vista: VistaCRM
  try {
    vista = await cargarVista(demo, !verCobros ? 'omitir' : typeof params.cliente === 'string' ? 'fresco' : 'cache')
  } catch (e) {
    console.error('Clientes: no se pudo leer el CRM:', (e as Error).message?.slice(0, 200))
    return <ErrorLectura etiqueta="Clientes" titulo="Cartera de clientes" volver="/clientes" />
  }

  const { datos } = vista
  const cobrosPorVerificar = datos.clientes.filter(c => c.linea === 'agencia' && ['ACTIVO', 'PAUSADO'].includes(c.estado) && c.cobrosAviso).length
  // Sin Finanzas no hay orden por cobrado (los montos no llegan): ?orden=cobrado pasa al orden por vencimiento
  const filtros = !verCobros && filtrosUrl.orden === 'cobrado' ? { ...filtrosUrl, orden: 'vencimiento' as const } : filtrosUrl
  const ind = indicadoresDeCartera(datos.clientes, datos.referidos, datos.hoy)
  const lectura = estadoDeLectura(datos)
  // Avisos de parseo de la planilla (no los de lectura: esos van arriba en AvisoLectura)
  const avisosPlanilla = datos.avisos.filter(a => !/guardados|espera antes|reciente/i.test(a))

  const vencenTono = ind.vencen30 > 0 ? { tono: 'atencion' as const, texto: 'Revisar renovación' } : { tono: 'ok' as const, texto: 'Nada por vencer' }
  const resumen: DatoResumen[] = [
    { etiqueta: 'Activos', icono: 'clientes', destacado: true, valor: numeroAR(ind.activos), contexto: `Agencia, al ${fechaCorta(datos.hoy)}`, href: '/clientes?estado=activo', accion: 'Ver activos' },
    { etiqueta: 'Vencen en 30 días', icono: 'calendario', valor: numeroAR(ind.vencen30), contexto: `Hasta el ${fechaCorta(ind.corte30)}`, estado: vencenTono, href: '/clientes?vencen=30', accion: 'Ver quiénes' },
    { etiqueta: 'En pausa', icono: 'pausa', valor: numeroAR(ind.pausados), contexto: "Agencia, sin los no clientes", estado: ind.pausados > 0 ? { tono: 'pausa', texto: 'Pausados' } : undefined, href: '/clientes?estado=pausado', accion: 'Ver pausados' },
    // Montos solo con Finanzas (regla del hub: un CSM ve la cartera pero no los cobros)
    ...(!verCobros ? [] : [{ etiqueta: 'A cobrar (USD)', icono: 'dinero' as const, valor: cobrosPorVerificar ? '—' : <Monto>{numeroAR(ind.aCobrarUSD)}</Monto>, contexto: cobrosPorVerificar ? `${cobrosPorVerificar} clientes con cobros por verificar` : `${ind.conSaldo} ${ind.conSaldo === 1 ? 'cliente' : 'clientes'} con saldo`, estado: cobrosPorVerificar ? { tono: 'atencion' as const, texto: 'Cobros por verificar' } : ind.conSaldo > 0 ? { tono: 'alerta' as const, texto: 'Hay saldo' } : { tono: 'ok' as const, texto: 'Sin saldo' } }]),
    {
      etiqueta: 'Tasa de renovación', icono: 'renovar',
      valor: ind.tasaRenovacion === null ? '—' : <>{Math.round(ind.tasaRenovacion)}<span className="cj-dato__unidad">%</span></>,
      contexto: ind.tasaRenovacion === null ? 'Todavía no hubo decisiones' : `${ind.renovadores} de ${ind.renovadores + ind.noRenovaron} renovaron`,
    },
  ]

  return (
    <div className="cj-pila">
      <SeccionTitulo
        etiqueta="Clientes"
        titulo="Cartera de clientes"
        acciones={
          <div className="cj-fila">
            {/* Ocultar o mostrar los montos en pantalla (solo con Finanzas; sin Finanzas ni llegan) */}
            {verCobros && <BotonMontos />}
            <p className="cj-etiqueta cj-seccion__meta">
              Datos de las {lectura.hora}
              <br />
              {lectura.dia} · hora argentina
            </p>
          </div>
        }
      />

      <AvisoLectura lectura={lectura} />
      {typeof params.accion === 'string' && <p className="cj-panel" role="status">Elegí un cliente en el recorrido para abrir la acción solicitada. También podés buscarlo por nombre o ID.</p>}

      <Suspense fallback={<EsperaBloque titulo="Recorrido" alto={560} />}>
        <RecorridoEnVivo vista={vista} pedido={typeof params.cliente === 'string' ? params.cliente : null} sesion={sesion} accion={typeof params.accion === 'string' ? params.accion : undefined} />
      </Suspense>

      {vista.esDemo && (
        <div className="cj-panel">
          <p><span className="cj-etiqueta cj-etiqueta--laton">Datos de ejemplo</span></p>
          <p>Esta cartera es ficticia y solo existe en desarrollo (?demo=1): sirve para revisar el diseño. No sale de la planilla.</p>
        </div>
      )}

      <div className="cj-pila cj-pila--chica">
        <Resumen titulo="Cifras de la cartera" datos={resumen} />
        <p className="cj-texto-2 cj-nota-resumen">
          Solo Agencia, sin las {ind.noClientesExcluidos} filas que no cuentan como clientes. Consultora va aparte.
        </p>
      </div>

      <Suspense fallback={<EsperaBloque titulo="Clientes" alto={720} />}>
        <ListaEnVivo vista={vista} filtros={filtros} noClientes={ind.noClientesExcluidos} verCobros={verCobros} />
      </Suspense>

      <CalidadDatos calidad={ind.calidad} noClientes={ind.noClientesExcluidos} avisos={avisosPlanilla} />
    </div>
  )
}
