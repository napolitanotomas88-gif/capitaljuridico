// ── Prioridades de producción: clientes trabados sin campaña y tabla de guiones (puro: sin red; lo prueban los tests) ──
// Pedido de Tomás (8/10/2026). Fuentes (las arma lib/clientes/produccion.ts):
//   · ClickUp "Clientes 2026": la etapa de cada cliente (onboarding, guionizar, opt. guiones, grabación…). Ese plan de ClickUp no
//     informa el tiempo en cada estado y las tareas no tienen responsable asignado: los días son desde el último cambio de la tarea
//     y el responsable es el closer del CRM.
//   · Meta (tablero de /anuncios): si la cuenta del cliente tiene campaña activa y cuándo fue el último lanzamiento.
//   · Planilla "Guiones y Videos": cada fila es una entrega de guiones (fecha) y si se grabó. Las subtareas "Guion 1..5" de ClickUp
//     son una plantilla que casi nunca se completa (23 de 600 hechas al 8/10): solo suman si tienen fecha de hecho.
import { diasEntre, type Ymd } from './fechas'
import type { CarpetaCliente } from './drive'

export const ETAPAS_SIN_CAMPANA = ['nuevo cliente', 'onboarding', 'en espera de tópicos', 'guionizar', 'opt. guiones', 'grabación', 'edición', 'creación de campaña'] as const
export const ETIQUETA_ETAPA: Record<string, string> = {
  'nuevo cliente': 'Nuevo cliente', onboarding: 'Onboarding', 'en espera de tópicos': 'Esperando tópicos', guionizar: 'Guionizar',
  'opt. guiones': 'Optimizando guiones', 'grabación': 'Grabación', 'edición': 'Edición', 'creación de campaña': 'Creando campaña',
  'campañas activas': 'Campañas activas', rojo: 'Rojo', amarillo: 'Amarillo', verde: 'Verde', pausa: 'Pausa', 'final del servicio': 'Final del servicio',
}

export interface TareaClickUp {
  id: string
  nombre: string
  estado: string            // en minúscula, como en ClickUp
  url: string
  creada: Ymd | null
  actualizada: Ymd | null
  guionesHechos: Ymd[]      // fechas de "hecho" de las subtareas Guion N
}
export interface CampanaMeta {
  activa: boolean           // cuenta no pausada, con gasto en los últimos 7 días y anuncios activos
  ultimoLanzamiento: Ymd | null
  primerLanzamiento?: Ymd | null   // el más viejo que se conoce (lanzamientos detectados o desde cuándo corre): registro de hitos
  lanzamientoAprox: boolean // true = Meta no lo detectó como lanzamiento reciente: es desde cuándo viene corriendo la campaña
  semaforo: string | null   // verde / amarillo / rojo del tablero de anuncios
  aGrabar: 'quema' | 'no_rinde' | null   // el tablero pide guiones nuevos: se están quemando o no rinden
}
export interface ClienteBase { id: string; nombre: string; closer: string; estado: string }
export interface GuionesPlanilla { ultimoGuion: Ymd | null; fechasGuiones: Ymd[]; grabado: boolean; ultimaGrabacion: Ymd | null }

// ── Cruce por nombre (CRM ↔ ClickUp / Meta) ──
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'del', 'los', 'las', 'con', 'dm', 'fm', 'usd', 'ars'])
const palabras = (s: string) => norm(s).split(' ').filter(w => w.length >= 3 && !GENERICAS.has(w))
export const claveNombre = (s: string) => norm(s)

/** Busca la tarea de ClickUp de un cliente. Una tarea puede ser una dupla ("Barbara & Diego"): cada parte se compara sola.
 *  Hace falta que TODAS las palabras de la parte (2 o más) estén en el nombre del CRM, o nombre + apellido del CRM en la parte. */
export function crearCruceClickUp(tareas: TareaClickUp[]) {
  return crearCruce(tareas, t => t.nombre, t => (t.estado === 'final del servicio' ? -0.5 : 0))
}

/** Lo mismo para cualquier lista con nombre (carpetas de Drive, tareas…): devuelve el único que calza mejor, o null */
export function crearCruce<T extends { id: string }>(items: T[], nombreDe: (t: T) => string, ajuste: (t: T) => number = () => 0) {
  const partes = items.flatMap(t => nombreDe(t).split(/\s*(?:&|\by\b|\+|\/|,)\s*/i).map(p => ({ t, ws: palabras(p) })).filter(x => x.ws.length > 0))
  return (nombreCRM: string): T | null => {
    const crm = palabras(nombreCRM)
    if (crm.length === 0) return null
    const set = new Set(crm)
    let mejor: { t: T; p: number } | null = null, empate = false
    for (const { t, ws } of partes) {
      const comunes = ws.filter(w => set.has(w)).length
      const todasLasDeClickUp = ws.length >= 2 && comunes === ws.length
      const nombreYApellido = crm.length >= 2 && ws.includes(crm[0]) && crm.slice(1).some(w => ws.includes(w))
      if (!todasLasDeClickUp && !nombreYApellido) continue
      const p = comunes + ajuste(t)
      if (!mejor || p > mejor.p) { mejor = { t, p }; empate = false } else if (p === mejor.p && t.id !== mejor.t.id) empate = true
    }
    return mejor && !empate ? mejor.t : null
  }
}

/** Cruce para las carpetas de Drive, que usan apodos y nombres cortos ("Flor Toledo", "Noe Benitez", "Tatiana", "Estudio Romero",
 *  duplas "Agus & Pau"). En orden: (1) el cruce estricto de siempre; (2) mismo apellido (o que uno empiece con el otro, por tipeos como
 *  Figueroa/Figueroag) y nombre que empieza igual ("Flor" → "Florencia"); (3) una sola palabra (5+ letras) que aparece en UN solo
 *  cliente del CRM. Nunca adivina: si dos carpetas o dos clientes calzan igual, no cruza. */
export function crearCruceCarpetas<T extends { id: string }>(items: T[], nombreDe: (t: T) => string, nombresCRM: string[]) {
  const estricto = crearCruce(items, nombreDe)
  const tokensCRM = nombresCRM.map(n => palabras(n))
  const cuantos = new Map<string, number>()
  for (const ts of tokensCRM) for (const w of new Set(ts)) cuantos.set(w, (cuantos.get(w) ?? 0) + 1)
  const partes = items.flatMap(t => nombreDe(t).split(/\s*(?:&|\by\b|\+|\/|,)\s*/i).map(p => ({ t, ws: palabras(p) })).filter(x => x.ws.length > 0))
  const parecido = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && (a.startsWith(b) || b.startsWith(a)))
  const prefijo = (corto: string, largo: string) => corto.length >= 3 && largo.startsWith(corto)
  const buscar = (nombreCRM: string): T | null => {
    const e = estricto(nombreCRM)
    if (e) return e
    const crm = palabras(nombreCRM)
    if (!crm.length) return null
    const hits = new Map<string, { t: T; p: number }>()
    for (const { t, ws } of partes) {
      let p = 0
      const apellido = ws.slice(1).find(w => w.length >= 4 && crm.slice(1).some(c => parecido(w, c)))
      // el nombre de la carpeta puede ser el primero o el segundo nombre del cliente ("Gabriel Figueroa" = Claudio Gabriel Figueroag)
      if (apellido && ws.length >= 2 && crm.some(c => !parecido(c, apellido) && (prefijo(ws[0], c) || prefijo(c, ws[0])))) p = 2
      else if (ws.length === 1 && ws[0].length >= 5 && crm.includes(ws[0]) && cuantos.get(ws[0]) === 1) p = 1
      if (p && (!hits.get(t.id) || hits.get(t.id)!.p < p)) hits.set(t.id, { t, p })
    }
    const orden = [...hits.values()].sort((a, b) => b.p - a.p)
    return orden.length && (orden.length === 1 || orden[0].p > orden[1].p) ? orden[0].t : null
  }
  // Si una carpeta calza con varios clientes, gana el que comparte más palabras (y el mismo primer nombre: "José Maria" →
  // José Maria Gallardo y no Maria José Molina). Si empatan ("Juan Pablo" con dos Juan Pablo), no se le asigna a ninguno.
  const puntaje = (nombreCRM: string, t: T) => {
    const crm = palabras(nombreCRM)
    return Math.max(0, ...partes.filter(x => x.t.id === t.id).map(x => x.ws.filter(w => crm.includes(w)).length + (x.ws[0] === crm[0] ? 0.5 : 0)))
  }
  const asignada = new Map(nombresCRM.map(n => [n, buscar(n)]))
  const ganador = new Map<string, string | null>()
  for (const [, t] of asignada) {
    if (!t) continue
    const rivales = [...asignada].filter(([, u]) => u?.id === t.id).map(([m]) => ({ m, p: puntaje(m, t) })).sort((a, b) => b.p - a.p)
    ganador.set(t.id, rivales.length === 1 || rivales[0].p > rivales[1].p ? rivales[0].m : null)
  }
  return (nombreCRM: string): T | null => {
    const t = asignada.has(nombreCRM) ? asignada.get(nombreCRM)! : buscar(nombreCRM)
    return t && (!ganador.has(t.id) || ganador.get(t.id) === nombreCRM) ? t : null
  }
}

// ── 3. Clientes trabados: siguen en una etapa previa a la campaña y no tienen ningún anuncio activo en Meta ──
export interface Trabado {
  idCliente: string
  nombre: string
  etapa: string             // etiqueta legible
  dias: number | null       // desde el último cambio de la tarea en ClickUp
  diasCliente: number | null  // desde que se creó la tarea (≈ desde el alta)
  responsable: string       // closer del CRM (ClickUp no tiene responsables asignados)
  url: string
}

export function clientesTrabados(clientes: ClienteBase[], tareaDe: (nombre: string) => TareaClickUp | null, campanaDe: (nombre: string) => CampanaMeta | null, hoy: Ymd): Trabado[] {
  const out: Trabado[] = []
  for (const c of clientes) {
    if (c.estado !== 'ACTIVO') continue
    const t = tareaDe(c.nombre)
    if (!t || !(ETAPAS_SIN_CAMPANA as readonly string[]).includes(t.estado)) continue
    if (campanaDe(c.nombre)?.activa) continue
    out.push({
      idCliente: c.id, nombre: c.nombre, etapa: ETIQUETA_ETAPA[t.estado] ?? t.estado,
      dias: t.actualizada ? Math.max(0, diasEntre(t.actualizada, hoy)) : null,
      diasCliente: t.creada ? Math.max(0, diasEntre(t.creada, hoy)) : null,
      responsable: c.closer, url: t.url,
    })
  }
  // Primero los que más tiempo llevan en el sistema sin campaña (más urgentes), después por días en la etapa
  return out.sort((a, b) => (b.diasCliente ?? -1) - (a.diasCliente ?? -1) || (b.dias ?? -1) - (a.dias ?? -1))
}

// ── 2. Tabla de guiones ──
// Prioridad 5 = onboarding: nunca lanzó, hay que escribir los guiones desde cero.
// Prioridad 4 = optimización URGENTE (pedido de Tomás, 9/10/2026): la campaña fue mal o no hay nada rindiendo (semáforo rojo,
//   "no rinde", ya lanzó pero hoy no tiene nada corriendo, o ClickUp en rojo).
// Prioridad 3 = optimización con variables: amarillo, anuncios que se queman o ClickUp "opt. guiones".
// Prioridad 1 = variaciones de lo que funciona, para que no se queme (lanzó y está en verde).
const ESTADOS_CON_CAMPANA = ['campañas activas', 'verde', 'amarillo', 'rojo']
export type Prioridad = 5 | 4 | 3 | 1
export const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = { 5: 'Onboarding: guiones desde cero', 4: 'Optimización urgente: fue mal o nada rinde', 3: 'Optimización con variables', 1: 'Variaciones de lo que funciona' }

export interface FilaGuiones {
  idCliente: string
  nombre: string
  closer: string
  etapa: string | null
  prioridad: Prioridad
  ultimoGuion: Ymd | null
  diasDesdeGuion: number | null
  ultimoLanzamiento: Ymd | null
  lanzamientoAprox: boolean
  guionesDesdeLanzamiento: number | null   // entregas de guiones posteriores al último lanzamiento (null = nunca lanzó)
  grabado: boolean
  ultimaGrabacion: Ymd | null
  campanaActiva: boolean
  urlClickUp: string | null
  // Drive (lo que realmente se hizo): documento de guiones, videos crudos (grabó) y editados
  guionPor: string | null
  guionUrl: string | null
  crudos: number | null          // null = sin carpeta de crudos en Drive
  editados: number | null
  carpetaUrl: string | null
  guionDespuesDelLanzamiento: boolean | null   // el documento de guiones cambió después del último lanzamiento (null = nunca lanzó o sin doc)
  guionSinGrabar: boolean        // el documento cambió después de la última grabación (hay guiones nuevos esperando)
  fuenteGuion: 'drive' | 'planilla' | null
}

export function filasDeGuiones(
  clientes: ClienteBase[], tareaDe: (n: string) => TareaClickUp | null, campanaDe: (n: string) => CampanaMeta | null,
  guionesDe: (n: string) => GuionesPlanilla | null, hoy: Ymd, driveDe: (n: string) => CarpetaCliente | null = () => null,
): FilaGuiones[] {
  const filas: FilaGuiones[] = []
  for (const c of clientes) {
    if (c.estado !== 'ACTIVO') continue
    const t = tareaDe(c.nombre), m = campanaDe(c.nombre), g = guionesDe(c.nombre), d = driveDe(c.nombre)
    const fechas = [...(g?.fechasGuiones ?? []), ...(t?.guionesHechos ?? [])].sort()
    // Último guion: el documento de Drive manda (es lo que realmente se escribió); si no hay, la planilla o ClickUp
    const ultimoGuion = [d?.guion?.modificado ?? null, fechas.length ? fechas[fechas.length - 1] : null].filter((x): x is string => !!x).sort().pop() ?? null
    // Se grabó: videos en "Crudos" o en "Editados" de Drive (a veces los crudos se borran después de editar), o la marca de la planilla
    const grabadoDrive = (d?.crudos?.cantidad ?? 0) > 0 || (d?.editados?.cantidad ?? 0) > 0
    const ultimaGrabacion = [d?.crudos?.ultimo ?? null, d?.editados?.ultimo ?? null, g?.ultimaGrabacion ?? null].filter((x): x is string => !!x).sort().pop() ?? null
    // ¿Ya lanzó? Meta manda; si Meta no respondió (caché fría tras un deploy), el estado de ClickUp: verde / amarillo / rojo /
    // campañas activas = ya tiene campaña. Así una demora de Meta no pasa a todos a prioridad 5.
    const lanzoSegunClickUp = !!t && ESTADOS_CON_CAMPANA.includes(t.estado)
    const lanzo = !!m?.ultimoLanzamiento || !!m?.activa || lanzoSegunClickUp
    const enOnboarding = !!t && ['nuevo cliente', 'onboarding', 'en espera de tópicos', 'guionizar'].includes(t.estado)
    // Urgente: rojo / "no rinde" en Meta, ya lanzó pero hoy no corre nada (dato de Meta presente y sin campaña activa), o ClickUp en rojo
    const urgente = m?.semaforo === 'rojo' || m?.aGrabar === 'no_rinde' || (!!m && !m.activa) || t?.estado === 'rojo'
    const optimizar = t?.estado === 'opt. guiones' || m?.aGrabar === 'quema' || m?.semaforo === 'amarillo' || (!m && t?.estado === 'amarillo')
    const prioridad: Prioridad = !lanzo || enOnboarding ? 5 : urgente ? 4 : optimizar ? 3 : 1
    filas.push({
      idCliente: c.id, nombre: c.nombre, closer: c.closer, etapa: t ? ETIQUETA_ETAPA[t.estado] ?? t.estado : null, prioridad,
      ultimoGuion, diasDesdeGuion: ultimoGuion ? Math.max(0, diasEntre(ultimoGuion, hoy)) : null,
      ultimoLanzamiento: m?.ultimoLanzamiento ?? null, lanzamientoAprox: !!m?.lanzamientoAprox,
      guionesDesdeLanzamiento: m?.ultimoLanzamiento ? fechas.filter(f => f > m.ultimoLanzamiento!).length : null,
      grabado: grabadoDrive || !!g?.grabado, ultimaGrabacion, campanaActiva: !!m?.activa, urlClickUp: t?.url ?? null,
      guionPor: d?.guion?.por ?? null, guionUrl: d?.guion?.url ?? null, crudos: d?.crudos?.cantidad ?? null, editados: d?.editados?.cantidad ?? null, carpetaUrl: d?.url ?? null,
      guionDespuesDelLanzamiento: d?.guion && m?.ultimoLanzamiento ? d.guion.modificado > m.ultimoLanzamiento : null,
      guionSinGrabar: !!d?.guion && (!ultimaGrabacion || d.guion.modificado > ultimaGrabacion),
      fuenteGuion: d?.guion ? 'drive' : fechas.length ? 'planilla' : null,
    })
  }
  // Orden por defecto: prioridad (5 primero), después los que más días esperan (sin guion = esperando desde siempre)
  return filas.sort((a, b) => b.prioridad - a.prioridad || (b.diasDesdeGuion ?? 9999) - (a.diasDesdeGuion ?? 9999) || a.nombre.localeCompare(b.nombre, 'es'))
}
