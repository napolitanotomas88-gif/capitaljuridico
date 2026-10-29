import type { Metadata } from 'next'
import { exigirAcceso } from '@/lib/auth/sesion'
import GuionesDashboard from '@/components/GuionesDashboard'
import { cargarVista } from '@/lib/clientes/vista'
import { campanasMeta, tareasClickUp } from '@/lib/clientes/produccion'
import { carpetasDrive } from '@/lib/clientes/drive'
import { claveNombre, crearCruceCarpetas, crearCruceClickUp, filasDeGuiones, type FilaGuiones, type GuionesPlanilla } from '@/lib/clientes/prioridad'
import { Resumen, SeccionTitulo, type DatoResumen } from '@/components/ui'
import { pedidoDemo } from '@/lib/clientes/demo'
import { sumarDias } from '@/lib/clientes/fechas'
import { TablaGuiones } from './TablaGuiones'
import { leerArchivados, excluirArchivados } from '@/lib/clientes/archivados'

export const metadata: Metadata = { title: 'Guiones' }
export const dynamic = 'force-dynamic'

// Guiones: arriba la tabla por cliente con prioridad (5 onboarding · 3 optimización · 1 variaciones), último guion, último
// lanzamiento en Meta y si se grabó; abajo, el tracker de grabaciones de siempre. Si una fuente falla, la tabla sigue sin ese dato.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

// ?demo=1 (solo en desarrollo, 25/10/2026): clientes ficticios de lib/clientes/demo.ts con fechas de guiones y grabaciones
// inventadas, sin Drive, ClickUp, Meta ni la planilla. Sirve para revisar el diseño.
async function filasDemo(): Promise<FilaGuiones[]> {
  const vista = await cargarVista(true)
  const hoy = vista.datos.hoy
  const clientes = vista.datos.clientes.filter(c => c.linea === 'agencia' && c.id)
  const plan = (i: number): GuionesPlanilla => {
    const hace = [3, 12, 40, 6, 0, 25, 60, 9, 2][i % 9]
    const ultimo = i % 4 === 3 ? null : sumarDias(hoy, -hace)
    return { ultimoGuion: ultimo, fechasGuiones: ultimo ? [ultimo] : [], grabado: i % 3 !== 1, ultimaGrabacion: i % 3 !== 1 && ultimo ? sumarDias(ultimo, 2) : null }
  }
  const porNombre = new Map(clientes.map((c, i) => [claveNombre(c.nombre), plan(i)]))
  return filasDeGuiones(clientes.map(c => ({ id: c.id, nombre: c.nombre, closer: c.closer, estado: c.estado })), () => null, () => null, n => porNombre.get(claveNombre(n)) ?? null, hoy)
}

export default async function GuionesPage({ searchParams }: Props) {
  const sesion = await exigirAcceso('guiones')
  const demo = pedidoDemo((await searchParams).demo)
  // El tracker de grabaciones lee /api/raw, que pide Resumen. Quien entra solo con Guiones (Faus, 25/10) no lo ve: un aviso en
  // lugar de un error. Su tanda la abre desde el link del aviso (/guiones/<ID>).
  const veResumen = sesion.admin || sesion.secciones.includes('resumen')
  let filas: FilaGuiones[] = []
  let clientesPermitidos: string[] = []
  const avisos: string[] = []
  if (demo) filas = await filasDemo()
  else try {
    const { fetchRawData } = await import('@/lib/rawSheets')
    const [vista, clickup, meta, raw, drive, archivados] = await Promise.all([
      cargarVista(false), tareasClickUp(), campanasMeta(9000),
      fetchRawData({ ligero: true }).catch(() => null),
      carpetasDrive(12000),
      leerArchivados(),
    ])
    const clientes = excluirArchivados(vista.datos.clientes.filter(c => c.linea === 'agencia' && c.id), archivados, c => c.id)
    const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
    const conteos = new Map<string, number>()
    for (const c of vista.datos.clientes.filter(c => c.linea === 'agencia')) conteos.set(normal(c.nombre), (conteos.get(normal(c.nombre)) ?? 0) + 1)
    clientesPermitidos = clientes.filter(c => (c.estado === 'ACTIVO' || c.estado === 'PAUSADO') && conteos.get(normal(c.nombre)) === 1).map(c => c.nombre)
    if (drive.aviso) avisos.push(drive.aviso)
    const driveDe = crearCruceCarpetas(drive.carpetas, c => c.nombre, clientes.filter(c => c.estado === 'ACTIVO' || c.estado === 'PAUSADO').map(c => c.nombre))
    if (clickup.aviso) avisos.push(clickup.aviso)
    if (meta.aviso) avisos.push(meta.aviso)
    if (!raw) avisos.push('No se pudo leer la planilla de guiones: sin fechas de guiones ni grabaciones.')
    const porNombre = new Map<string, GuionesPlanilla>()
    for (const g of raw?.grabaciones ?? []) {
      porNombre.set(claveNombre(g.cliente), { ultimoGuion: g.ultimoGuion ?? null, fechasGuiones: g.fechasGuiones ?? [], grabado: g.grabado, ultimaGrabacion: g.ultimaGrabacion })
    }
    const tareaDe = crearCruceClickUp(clickup.tareas)
    filas = filasDeGuiones(
      clientes.map(c => ({ id: c.id, nombre: c.nombre, closer: c.closer, estado: c.estado })),
      tareaDe, n => meta.porCliente.get(claveNombre(n)) ?? null, n => porNombre.get(claveNombre(n)) ?? null, vista.datos.hoy, driveDe,
    )
  } catch (e) {
    console.error('Guiones: no se pudo armar la tabla:', (e as Error).message?.slice(0, 160))
    avisos.push('No se pudo leer el CRM de clientes: la tabla de guiones no está disponible ahora.')
  }
  // Mini panel (25/10/2026): los números que ordenan el día de guiones. Los filtros finos siguen en la lista de abajo.
  const onboarding = filas.filter(f => f.prioridad === 5).length
  const sinGrabar = filas.filter(f => f.guionSinGrabar).length
  const sinGuionReciente = filas.filter(f => f.diasDesdeGuion === null || f.diasDesdeGuion > 30).length
  const resumen: DatoResumen[] = [
    { etiqueta: 'Clientes activos', icono: 'clientes', destacado: true, valor: filas.length, contexto: 'Agencia, con su prioridad de guiones', href: '#h-tabla-guiones', accion: 'Ver la lista' },
    { etiqueta: 'Onboarding', icono: 'guiones', valor: onboarding, contexto: 'Prioridad 5: guiones desde cero', estado: onboarding ? { tono: 'alerta', texto: 'Escribir primero' } : { tono: 'ok', texto: 'Ninguno' } },
    { etiqueta: 'Guiones sin grabar', icono: 'camara', valor: sinGrabar, contexto: 'Tienen guion nuevo y no grabaron', estado: sinGrabar ? { tono: 'atencion', texto: 'Seguir' } : { tono: 'ok', texto: 'Al día' } },
    { etiqueta: 'Sin guion en 30 días', icono: 'calendario', valor: sinGuionReciente, contexto: 'O nunca tuvieron uno', estado: sinGuionReciente ? { tono: 'atencion', texto: 'Revisar' } : { tono: 'ok', texto: 'Al día' } },
  ]
  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Guiones" titulo="Guiones y grabaciones" />
      {demo && (
        <div className="cj-panel">
          <p><span className="cj-etiqueta cj-etiqueta--laton">Datos de ejemplo</span></p>
          <p>Estos clientes y fechas son ficticios y solo existen en desarrollo (?demo=1): sirven para revisar el diseño.</p>
        </div>
      )}
      {filas.length > 0 && <Resumen titulo="Resumen de guiones" datos={resumen} />}
      <TablaGuiones filas={filas} avisos={avisos} />
      {demo ? null : veResumen ? <GuionesDashboard clientesPermitidos={clientesPermitidos} /> : <div className="cj-aviso"><p>Para revisar una tanda de guiones entrá desde el link del aviso en el grupo de guiones de WhatsApp.</p></div>}
    </div>
  )
}
