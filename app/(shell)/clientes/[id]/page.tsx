import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChipSemaforo, Resumen, SeccionTitulo, type DatoResumen, type Tono } from '@/components/ui'
import { numeroAR } from '@/lib/clientes/formato'
import { AvisoLectura } from '@/components/clientes/AvisoLectura'
import { ErrorLectura } from '@/components/clientes/ErrorLectura'
import { puedeVer } from '@/lib/auth/roles'
import { exigirAcceso } from '@/lib/auth/sesion'
import { rolPuedeCanjear } from '@/lib/clientes/canje'
import { pedidoDemo } from '@/lib/clientes/demo'
import { ID_CLIENTE_VALIDO, armarFicha, sinMontos } from '@/lib/clientes/ficha'
import { ETIQUETA_ESTADO, fechaCorta, textoDias } from '@/lib/clientes/formato'
import { cargarVista, estadoDeLectura, type VistaCRM } from '@/lib/clientes/vista'
import { Cobros } from './_componentes/Cobros'
import { Creditos } from './_componentes/Creditos'
import { Datos } from './_componentes/Datos'
import { Notas } from './_componentes/Notas'
import { PanelReferidosFicha } from './_componentes/PanelReferidos'
import { Periodos } from './_componentes/Periodos'
import { ComoLeVa } from './_componentes/ComoLeVa'
import { AccionesCliente } from '../(cartera)/_componentes/AccionesCliente'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { AccesosCliente } from './_componentes/AccesosCliente'
import { BotonMontos } from '@/components/clientes/BotonMontos'
import { Monto } from '@/components/clientes/Monto'
import { leerSeguimiento, leerTypeform } from '@/lib/seguimiento/hojas'
import { ESTADO_VACIO, estadoPorCliente } from '@/lib/seguimiento/modelo'
import { asegurarDocumentoCliente, documentoVinculadoCliente } from '@/lib/bot/guiones/documento'
import { HistorialOperativo } from '@/components/clientes/HistorialOperativo'

// Ficha de un cliente (solo lectura): datos, períodos, cobros, créditos y referidos, y notas.
// Se arma con la misma función que usa /api/clientes/[id] (lib/clientes/ficha.ts), así que no hay dos versiones.

const ETIQUETA_FALTANTE: Record<string, string> = {
  id: 'el ID',
  fin_periodo: 'el fin del período',
  ltv: 'el LTV (contratado y cobrado)',
  duracion: 'la duración',
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// El título lleva solo el ID (no el nombre): queda en el historial del navegador
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: ID_CLIENTE_VALIDO.test(id) ? `Cliente ${id.toUpperCase()}` : 'Cliente' }
}

export default async function FichaClientePage({ params, searchParams }: Props) {
  const sesion = await exigirAcceso('clientes')
  const { id } = await params
  const paramsBusqueda = await searchParams
  const demo = pedidoDemo(paramsBusqueda.demo)
  const verMontos = puedeVer(sesion, 'finanzas')
  if (!ID_CLIENTE_VALIDO.test(id)) notFound()

  let vista: VistaCRM
  try {
    vista = await cargarVista(demo, verMontos ? 'fresco' : 'omitir')
  } catch (e) {
    console.error('Ficha de cliente: no se pudo leer el CRM:', (e as Error).message?.slice(0, 200))
    return <ErrorLectura etiqueta="Clientes" titulo="Ficha del cliente" volver={`/clientes/${encodeURIComponent(id)}`} />
  }

  // Los teléfonos y mails solo se arman para roles que pueden ver Clientes
  const fichaCompleta = armarFicha(vista.datos, vista.creditos, id, { conContacto: puedeVer(sesion, 'clientes') })
  if (!fichaCompleta) notFound()
  // Sin Finanzas, sin montos (26/10/2026): ni el cobrado del resumen, ni los períodos con precio, ni los cobros
  // Sin Referidos, sin el panel de referidos ni los créditos (sus formularios y reglas exigen 'referidos', como en la tarjeta)
  const verReferidos = puedeVer(sesion, 'referidos')
  const ficha = verMontos ? fichaCompleta : sinMontos(fichaCompleta)

  const sufijo = vista.esDemo ? '?demo=1' : ''
  // Puntajes de seguimiento (a mano + Typeform) de este cliente; si la planilla falla, la ficha sigue sin ellos
  const cli = vista.datos.clientes.find(c => c.id === ficha.id)
  const [seg, tf, documento] = vista.esDemo ? [{ puntajes: [] }, null, null] : await Promise.all([
    leerSeguimiento().catch(() => ({ puntajes: [] })),
    cli ? leerTypeform([{ id: cli.id, nombre: cli.nombre, mail: cli.mail, celular: cli.celular }]).catch(() => null) : Promise.resolve(null),
    (cli?.linea === 'agencia' && puedeHacerAcciones(sesion.email) ? asegurarDocumentoCliente(ficha.id) : documentoVinculadoCliente(ficha.id)).catch(() => null),
  ])
  const seguimiento = estadoPorCliente([...seg.puntajes, ...(tf?.puntajes ?? [])], vista.datos.hoy).get(ficha.id) ?? ESTADO_VACIO
  const lectura = estadoDeLectura(vista.datos)

  // Mini panel de la ficha (25/10/2026): estado del período, cobros, créditos y cómo le va, con estado en ícono y texto
  const TONO_SEMAFORO: Record<string, { tono: Tono; texto: string }> = {
    verde: { tono: 'ok', texto: 'Al día' }, amarillo: { tono: 'atencion', texto: 'Por vencer' }, rojo: { tono: 'alerta', texto: 'Vencido' }, gris: { tono: 'neutro', texto: 'Sin fecha' },
  }
  const { cobros, creditos } = ficha
  const resumenFicha: DatoResumen[] = [
    {
      etiqueta: 'Fin del período', icono: 'calendario', destacado: true,
      valor: ficha.fin ? fechaCorta(ficha.fin) : '—',
      contexto: ficha.estado === 'ACTIVO' && ficha.dias !== null ? textoDias(ficha.dias) : ETIQUETA_ESTADO[ficha.estado],
      estado: ficha.semaforo ? TONO_SEMAFORO[ficha.semaforo] : undefined,
    },
    ...(!verMontos ? [] : [{
      etiqueta: 'Cobrado (USD)', icono: 'dinero',
      valor: cobros.cobrado === null ? '—' : <Monto>{numeroAR(cobros.cobrado)}</Monto>,
      // El saldo va en el contexto (no en el estado, que es texto plano) para que el botón de montos también lo tape
      contexto: cobros.contratado === null ? 'Sin contrato cargado' : <>De <Monto>{numeroAR(cobros.contratado)}</Monto> contratados{cobros.saldoRelevante && cobros.saldo !== null ? <> · saldo <Monto>{numeroAR(cobros.saldo)}</Monto></> : null}</>,
      estado: cobros.aviso || cobros.cobrado === null ? { tono: 'atencion', texto: 'Cobros por verificar' } : cobros.saldoRelevante && cobros.saldo !== null ? { tono: 'alerta', texto: 'Saldo pendiente' } : cobros.contratado !== null ? { tono: 'ok', texto: 'Sin saldo' } : undefined,
      href: '#cobros', accion: 'Ver cobros',
    } satisfies DatoResumen]),
    {
      etiqueta: 'Créditos disponibles', icono: 'credito',
      valor: <>{creditos.mesesDisponibles}<span className="cj-dato__unidad">{creditos.mesesDisponibles === 1 ? 'mes' : 'meses'}</span></>,
      contexto: `Nivel ${creditos.nivel} de ${creditos.nivelesTotal}`,
      estado: creditos.renovacionGratis ? { tono: 'ok', texto: 'Renovación gratis' } : undefined,
      ...(verReferidos ? { href: '#creditos', accion: 'Ver créditos' } : {}),
    },
    ...(seguimiento.ultimo ? [{
      etiqueta: 'Cómo le va', icono: 'ok', valor: <>{seguimiento.ultimo.valor}<span className="cj-dato__unidad">/ 10</span></>,
      contexto: 'Último puntaje de seguimiento (1 a 10)', href: '#como-le-va', accion: 'Ver seguimiento',
    }] : []),
  ]

  return (
    <div className="cj-pila">
      <div className="cj-ficha-cabecera">
        <Link href="/clientes" className="cj-enlace" style={{ alignSelf: 'flex-start' }}>
          Volver a la cartera
        </Link>
        <SeccionTitulo etiqueta={`Cliente ${ficha.id}`} titulo={ficha.nombre} />
        <div className="cj-fila">
          {ficha.semaforo && <ChipSemaforo estado={ficha.semaforo} />}
          <p className="cj-ficha-estado">{ETIQUETA_ESTADO[ficha.estado]}</p>
          {ficha.fin && (
            <p className="cj-ficha-estado cj-texto-2">
              Fin del período: <span className="cj-num">{fechaCorta(ficha.fin)}</span>
              {ficha.estado === 'ACTIVO' && ficha.dias !== null ? ` (${textoDias(ficha.dias)})` : ''}
            </p>
          )}
          {!vista.esDemo && <p className="cj-ficha-estado cj-texto-2">Datos de las {lectura.hora}</p>}
          {verMontos && <BotonMontos />}
        </div>
        <AccesosCliente quien={sesion} id={ficha.id} />
        {documento && <p><a className="cj-enlace" href={documento.url} target="_blank" rel="noreferrer">Documento de guiones del cliente</a></p>}
      </div>

      <Resumen titulo="Resumen del cliente" datos={resumenFicha} />

      {vista.esDemo && (
        <div className="cj-panel">
          <p>
            <span className="cj-etiqueta cj-etiqueta--laton">Datos de ejemplo</span>
          </p>
          <p>Esta ficha es ficticia y solo existe en desarrollo (?demo=1): sirve para revisar el diseño. No sale de la planilla.</p>
        </div>
      )}

      <AvisoLectura lectura={lectura} />

      {(ficha.faltantes.length > 0 || ficha.esNoCliente) && (
        <div className="cj-aviso" role="status">
          {ficha.faltantes.length > 0 && (
            <p>
              A esta fila le faltan datos en la planilla: {ficha.faltantes.map(k => ETIQUETA_FALTANTE[k] ?? k).join(', ')}. Suele pasar con los clientes recién cargados, a
              los que todavía no se les copiaron las fórmulas.
            </p>
          )}
          {ficha.esNoCliente && <p>No cuenta como cliente en las métricas: finalizó o quedó inactiva con menos de USD 400 cobrados.</p>}
        </div>
      )}

      <section id="rc-acciones" className="cj-panel" aria-label="Acciones del cliente">
        <h2>Acciones del cliente</h2>
        <AccionesCliente key={`${ficha.id}:${typeof paramsBusqueda.accion === 'string' ? paramsBusqueda.accion : ''}`} idCrm={ficha.id} nombre={ficha.nombre} hoy={vista.datos.hoy} demo={vista.esDemo} puedeEditar={vista.esDemo || puedeHacerAcciones(sesion.email)} puedeFinanzas={verMontos} estado={ficha.estado} accionInicial={typeof paramsBusqueda.accion === 'string' ? paramsBusqueda.accion : undefined} />
      </section>

      <div id="historial-servicio" className="cj-panel">
        <Suspense fallback={<p className="cj-texto-2" role="status">Leyendo el historial de servicio…</p>}>
          <HistorialOperativo idCrm={ficha.id} periodos={cli?.periodos ?? []} estado={ficha.estado} fin={ficha.fin} hoy={vista.datos.hoy} conFinanzas={verMontos} demo={vista.esDemo} nivel={2} />
        </Suspense>
      </div>

      {!vista.esDemo && <ComoLeVa idCliente={ficha.id} nombre={ficha.nombre} estado={seguimiento} />}
      <Datos f={ficha} />
      {verMontos && <Periodos f={ficha} accionHref={vista.esDemo || puedeHacerAcciones(sesion.email) ? `/clientes/${encodeURIComponent(ficha.id)}?${vista.esDemo ? 'demo=1&' : ''}accion=renovacion#rc-acciones` : undefined} />}
      {verMontos && <Cobros f={ficha} accionHref={vista.esDemo || puedeHacerAcciones(sesion.email) ? `/clientes/${encodeURIComponent(ficha.id)}?${vista.esDemo ? 'demo=1&' : ''}accion=pago#rc-acciones` : undefined} />}
      {verReferidos && <PanelReferidosFicha f={ficha} />}
      {verReferidos && <Creditos f={ficha} sufijo={sufijo} puedeCanjear={rolPuedeCanjear(sesion.rol)} demo={vista.esDemo} />}
      <Notas f={ficha} puedeEditarCliente={puedeHacerAcciones(sesion.email)} />
    </div>
  )
}
