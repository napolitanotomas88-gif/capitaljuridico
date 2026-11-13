import GuionesDashboard from '@/components/GuionesDashboard'
import { Resumen, type DatoResumen } from '@/components/ui'
import { EsqueletoCifras, EsqueletoFilas, EsqueletoZona } from '@/components/shell/Esqueleto'
import { baseConfigurada, tandasAbiertas } from '@/lib/bot/guiones/registro'
import { tandasPendientes } from '@/lib/bot/guiones/resumen'
import { excluirArchivados, leerArchivados } from '@/lib/clientes/archivados'
import { carpetasDrive } from '@/lib/clientes/drive'
import { guionesDePlanilla } from '@/lib/guionesPlanilla'
import { claveNombre, crearCruceCarpetas, crearCruceClickUp, filasDeGuiones, type FilaGuiones } from '@/lib/clientes/prioridad'
import { tareasClickUp } from '@/lib/clientes/produccion'
import { campanasMetaCartera } from '@/lib/clientes/recorridoFuentes'
import { cargarVista, type VistaCRM } from '@/lib/clientes/vista'
import { TablaGuiones } from './TablaGuiones'
import { TandasPendientes } from './TandasPendientes'

// Lo de Guiones que depende de fuentes de afuera, separado de la página (13/11/2026, igual que la Cartera): la página
// entrega al toque el título y cada parte llega por streaming con su esqueleto. Antes la página esperaba TODO antes de
// mostrar nada (Meta hasta 9 s, Drive hasta 12 s, el Resumen entero sin tope y, recién después, las tandas del bot).
//   · Tandas pendientes: la base del Despacho (Neon).
//   · Tabla por cliente: CRM + ClickUp + Meta + Drive + planilla de guiones, en paralelo y cada una con tope corto y caché
//     compartida (las de la Cartera: campanasMetaCartera y carpetasDrive(3 s); la planilla, guionesDePlanilla).
//   · Tracker de grabaciones: solo necesita la lista de clientes del CRM; los datos los pide el navegador a /api/raw.
// Ninguna parte rechaza: si una fuente no llega, sale sin ese dato y con el mismo aviso de siempre.

export interface LecturaCrm { vista: VistaCRM; archivados: ReadonlySet<string> }

/** El CRM y los archivados, UNA lectura para la tabla y el tracker. null = no se pudo leer (cada parte avisa). */
export function leerCrmGuiones(): Promise<LecturaCrm | null> {
  return Promise.all([cargarVista(false), leerArchivados()]).then(
    ([vista, archivados]) => ({ vista, archivados }),
    e => {
      console.error('Guiones: no se pudo armar la tabla:', (e as Error).message?.slice(0, 160))
      return null
    },
  )
}

const agenciaSinArchivados = ({ vista, archivados }: LecturaCrm) => excluirArchivados(vista.datos.clientes.filter(c => c.linea === 'agencia' && c.id), archivados, c => c.id)

// ClickUp pagina en serie (hasta 15 s por página en frío) y no tiene tope propio: acá no se lo espera más que esto
const ESPERA_CLICKUP_MS = 6_000
const clickupConTope = () => Promise.race([
  tareasClickUp(),
  new Promise<Awaited<ReturnType<typeof tareasClickUp>>>(res => setTimeout(() => res({ tareas: [], aviso: 'ClickUp tardó en responder: se muestra sin etapas de producción (recargá en un minuto).' }), ESPERA_CLICKUP_MS)),
])

/** Tandas del bot que esperan a alguien (5/11/2026). Si la base falla, el panel lo dice y el resto sigue. */
export async function TandasEnVivo() {
  const tandas = !baseConfigurada() ? [] : await tandasAbiertas().then(f => tandasPendientes(f)).catch(() => null)
  return <TandasPendientes tandas={tandas ?? []} error={tandas === null} />
}

/** Mini panel (25/10/2026): los números que ordenan el día de guiones. Los filtros finos siguen en la lista de abajo. */
export function ResumenGuiones({ filas }: { filas: FilaGuiones[] }) {
  if (filas.length === 0) return null
  const onboarding = filas.filter(f => f.prioridad === 5).length
  const sinGrabar = filas.filter(f => f.guionSinGrabar).length
  const sinGuionReciente = filas.filter(f => f.diasDesdeGuion === null || f.diasDesdeGuion > 30).length
  const resumen: DatoResumen[] = [
    { etiqueta: 'Clientes activos', icono: 'clientes', destacado: true, valor: filas.length, contexto: 'Agencia, con su prioridad de guiones', href: '#h-tabla-guiones', accion: 'Ver la lista' },
    { etiqueta: 'Onboarding', icono: 'guiones', valor: onboarding, contexto: 'Prioridad 5: guiones desde cero', estado: onboarding ? { tono: 'alerta', texto: 'Escribir primero' } : { tono: 'ok', texto: 'Ninguno' } },
    { etiqueta: 'Guiones sin grabar', icono: 'camara', valor: sinGrabar, contexto: 'Tienen guion nuevo y no grabaron', estado: sinGrabar ? { tono: 'atencion', texto: 'Seguir' } : { tono: 'ok', texto: 'Al día' } },
    { etiqueta: 'Sin guion en 30 días', icono: 'calendario', valor: sinGuionReciente, contexto: 'O nunca tuvieron uno', estado: sinGuionReciente ? { tono: 'atencion', texto: 'Revisar' } : { tono: 'ok', texto: 'Al día' } },
  ]
  return <Resumen titulo="Resumen de guiones" datos={resumen} />
}

/** La tabla por cliente con prioridad, último guion, último lanzamiento en Meta y si se grabó, más su mini panel. */
export async function TablaEnVivo({ crm }: { crm: Promise<LecturaCrm | null> }) {
  // Todo en paralelo: ninguna de estas lecturas rechaza y cada una corta sola en su tope
  const [lectura, clickup, meta, planilla, drive] = await Promise.all([crm, clickupConTope(), campanasMetaCartera(), guionesDePlanilla(), carpetasDrive(3_000)])
  if (!lectura) return <TablaGuiones filas={[]} avisos={['No se pudo leer el CRM de clientes: la tabla de guiones no está disponible ahora.']} />
  const clientes = agenciaSinArchivados(lectura)
  const avisos = [drive.aviso, clickup.aviso, meta.aviso, planilla.aviso].filter((a): a is string => !!a)
  const driveDe = crearCruceCarpetas(drive.carpetas, c => c.nombre, clientes.filter(c => c.estado === 'ACTIVO' || c.estado === 'PAUSADO').map(c => c.nombre))
  const tareaDe = crearCruceClickUp(clickup.tareas)
  const filas = filasDeGuiones(
    clientes.map(c => ({ id: c.id, nombre: c.nombre, closer: c.closer, estado: c.estado })),
    tareaDe, n => meta.porCliente.get(claveNombre(n)) ?? null, n => planilla.porNombre.get(claveNombre(n)) ?? null, lectura.vista.datos.hoy, driveDe,
  )
  return (
    <>
      <ResumenGuiones filas={filas} />
      <TablaGuiones filas={filas} avisos={avisos} />
    </>
  )
}

/** El tracker de grabaciones de siempre: muestra solo los clientes vigentes del CRM cuyo nombre no se repite. */
export async function TrackerEnVivo({ crm }: { crm: Promise<LecturaCrm | null> }) {
  const lectura = await crm
  let clientesPermitidos: string[] = []
  if (lectura) {
    const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
    const conteos = new Map<string, number>()
    for (const c of lectura.vista.datos.clientes.filter(c => c.linea === 'agencia')) conteos.set(normal(c.nombre), (conteos.get(normal(c.nombre)) ?? 0) + 1)
    clientesPermitidos = agenciaSinArchivados(lectura).filter(c => (c.estado === 'ACTIVO' || c.estado === 'PAUSADO') && conteos.get(normal(c.nombre)) === 1).map(c => c.nombre)
  }
  return <GuionesDashboard clientesPermitidos={clientesPermitidos} />
}

// ── Esqueletos: la forma de cada parte mientras llega ──
export const EsqueletoTandas = () => <EsqueletoZona etiqueta="Leyendo las tandas pendientes…" chica><EsqueletoFilas filas={3} /></EsqueletoZona>
export const EsqueletoTabla = () => <EsqueletoZona etiqueta="Leyendo los guiones por cliente…"><EsqueletoCifras cantidad={4} /><EsqueletoFilas filas={8} /></EsqueletoZona>
export const EsqueletoTracker = () => <EsqueletoZona etiqueta="Leyendo el tracker de grabaciones…" chica><EsqueletoFilas filas={4} /></EsqueletoZona>
