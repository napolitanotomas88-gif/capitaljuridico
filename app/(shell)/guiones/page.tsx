import type { Metadata } from 'next'
import { Suspense } from 'react'
import { exigirAcceso } from '@/lib/auth/sesion'
import { cargarVista } from '@/lib/clientes/vista'
import { claveNombre, filasDeGuiones, type FilaGuiones, type GuionesPlanilla } from '@/lib/clientes/prioridad'
import { SeccionTitulo } from '@/components/ui'
import { pedidoDemo } from '@/lib/clientes/demo'
import { sumarDias } from '@/lib/clientes/fechas'
import { TablaGuiones } from './TablaGuiones'
import { EsqueletoTabla, EsqueletoTandas, EsqueletoTracker, ResumenGuiones, TablaEnVivo, TandasEnVivo, TrackerEnVivo, leerCrmGuiones } from './EnVivo'

export const metadata: Metadata = { title: 'Guiones' }
export const dynamic = 'force-dynamic'

// Guiones: arriba la tabla por cliente con prioridad (5 onboarding · 3 optimización · 1 variaciones), último guion, último
// lanzamiento en Meta y si se grabó; abajo, el tracker de grabaciones de siempre. Si una fuente falla, la tabla sigue sin ese dato.
// Las lecturas están en EnVivo.tsx: cada parte llega por streaming, sin frenar el título.
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
  if (demo) {
    const filas = await filasDemo()
    return (
      <div className="cj-pila">
        <SeccionTitulo etiqueta="Guiones" titulo="Guiones y grabaciones" />
        <div className="cj-panel">
          <p><span className="cj-etiqueta cj-etiqueta--laton">Datos de ejemplo</span></p>
          <p>Estos clientes y fechas son ficticios y solo existen en desarrollo (?demo=1): sirven para revisar el diseño.</p>
        </div>
        <ResumenGuiones filas={filas} />
        <TablaGuiones filas={filas} avisos={[]} />
      </div>
    )
  }
  // El tracker de grabaciones lee /api/raw, que pide Resumen. Quien entra solo con Guiones (Faus, 25/10) no lo ve: un aviso en
  // lugar de un error. Su tanda la abre desde el link del aviso (/guiones/<ID>).
  const veResumen = sesion.admin || sesion.secciones.includes('resumen')
  // La página no espera ninguna fuente (13/11/2026): sale el título y cada parte llega con su esqueleto (ver EnVivo.tsx).
  // El CRM se empieza a leer acá, una sola vez, para la tabla y el tracker.
  const crm = leerCrmGuiones()
  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Guiones" titulo="Guiones y grabaciones" />
      <Suspense fallback={<EsqueletoTandas />}><TandasEnVivo /></Suspense>
      <Suspense fallback={<EsqueletoTabla />}><TablaEnVivo crm={crm} /></Suspense>
      {veResumen
        ? <Suspense fallback={<EsqueletoTracker />}><TrackerEnVivo crm={crm} /></Suspense>
        : <div className="cj-aviso"><p>Para revisar una tanda de guiones entrá desde el link del aviso en el grupo de guiones de WhatsApp.</p></div>}
    </div>
  )
}
