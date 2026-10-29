// ── Listado de clientes: fila liviana, filtros y orden (puro: lo usan la página, el componente de cliente y la API) ──
// La fila NO lleva teléfono, mail ni notas: la lista solo necesita lo que muestra la tabla.
import type { Cliente, ColorSemaforo, EstadoCliente, Linea, ResumenCredito, Ymd } from './tipos'
import { normTxt } from './texto'
import { mesesRenovacionGratis, saldoCanjeable } from './creditos'
import { mesesTexto, usd } from './formato'
import type { PanelReferidos } from './panelReferidos'
import { textoExtra } from './programa'

// Saldo chico (redondeos, centavos de tipo de cambio) que no se informa como deuda: mismo corte que las
// alertas de cobranza del dashboard de producción (saldo > 50).
export const UMBRAL_SALDO_USD = 50

export interface CreditoListado {
  meses: number
  usd: number                   // crédito en USD disponible (aparte de los meses)
  renovacionGratis: boolean
  mesesSobreRenovacion: number  // meses por encima de la renovación gratis (cierres 4.º en adelante y mes del intento 5); 0 sin renovación gratis
}

export interface ClienteListado {
  clave: string                 // clave de lista (opaca): sirve de key en la interfaz, no es un dato de la planilla
  id: string
  linea: Linea
  nombre: string
  estado: EstadoCliente
  semaforo: ColorSemaforo | null
  dias: number | null           // días para vencer el período (negativo = vencido); null = sin fecha
  closer: string
  fin: Ymd | null
  contratado: number | null
  cobrado: number | null
  cobrosAviso?: string | null
  saldo: number | null          // contratado − cobrado, solo si pasa el umbral
  credito: CreditoListado | null  // null = sin actividad de referidos
  panel: PanelReferidos | null    // null = sin referidos ni libro (o todavía no existe la pestaña): las columnas muestran "—"
  noCliente: boolean            // no cuenta como cliente (se oculta salvo que se pida)
  puntaje: PuntajeListado | null  // último "cómo le va" (1 a 10) de la pestaña Seguimiento o del Typeform
  sinRespuestaMes: boolean      // cliente actual que no respondió el Typeform este mes: hay que puntuarlo a mano
  sinCampana: boolean           // prioridad: en ClickUp sigue antes de la campaña y no tiene anuncios activos en Meta
  backend: MarcaBackend | null  // lo que mostraba Backend (retirado el 10/10/2026): renovación pendiente y llamada de proyección
}

/**
 * Marcas que heredó Clientes de la sección Backend (10/10/2026), con las mismas reglas de lib/backend/calculo.ts:
 * renovación pendiente = ACTIVO de Agencia con el período terminando en 45 días o menos, o ya vencido sin decisión;
 * proyección = desde 35 días antes del fin hasta 3 después. `renovacionDias`: días para el fin (negativo = venció); null = no está.
 */
export interface MarcaBackend { renovacionDias: number | null; proyeccion: boolean; notaCrm: string | null }

export interface PuntajeListado { valor: number; tendencia: 'sube' | 'baja' | 'igual' | null; fuente: 'manual' | 'typeform'; dia: Ymd }
export interface ExtrasListado { puntaje?: PuntajeListado | null; sinRespuestaMes?: boolean; sinCampana?: boolean; backend?: MarcaBackend | null }

export function aListado(c: Cliente, i: number, credito?: ResumenCredito, panel?: PanelReferidos, extras: ExtrasListado = {}): ClienteListado {
  let creditoLista: CreditoListado | null = null
  if (credito) {
    const s = saldoCanjeable(credito)
    creditoLista = {
      meses: s.meses, usd: s.usd, renovacionGratis: s.renovacionGratis,
      mesesSobreRenovacion: s.renovacionGratis ? Math.max(0, s.meses - mesesRenovacionGratis()) : 0,
    }
  }
  const saldo = c.ltvContratado !== null && c.ltvCobrado !== null ? c.ltvContratado - c.ltvCobrado : null
  return {
    clave: `${c.linea === 'agencia' ? 'a' : 'c'}${i}`,
    id: c.id, linea: c.linea, nombre: c.nombre, estado: c.estado,
    semaforo: c.semaforo, dias: c.diasParaVencer, closer: c.closer, fin: c.finPeriodo,
    contratado: c.ltvContratado, cobrado: c.ltvCobrado,
    cobrosAviso: c.cobrosAviso ?? null,
    saldo: saldo !== null && saldo > UMBRAL_SALDO_USD ? saldo : null,
    credito: creditoLista,
    panel: panel ?? null,
    noCliente: c.esNoCliente,
    puntaje: extras.puntaje ?? null,
    sinRespuestaMes: !!extras.sinRespuestaMes,
    sinCampana: !!extras.sinCampana,
    backend: extras.backend ?? null,
  }
}

/**
 * Alerta "sin respuesta este mes": solo con el Typeform conectado y solo Agencia (el Typeform se cruza con Agencia: en
 * Consultora la alerta roja salía siempre). Es el cliente actual (activo o pausado) que no respondió el Typeform este mes
 * y que tampoco se puntuó a mano este mes. `seguimiento` es lo de estadoPorCliente (lib/seguimiento/modelo.ts).
 */
export function sinRespuestaDelMes(
  c: Pick<Cliente, 'linea' | 'estado'>,
  seguimiento: { respondioTypeformEsteMes: boolean; ultimo: { mes: string } | null },
  hoy: Ymd,
  typeformConectado: boolean,
): boolean {
  if (c.linea !== 'agencia' || !typeformConectado) return false
  if (c.estado !== 'ACTIVO' && c.estado !== 'PAUSADO') return false
  return !seguimiento.respondioTypeformEsteMes && !(seguimiento.ultimo && seguimiento.ultimo.mes === hoy.slice(0, 7))
}

/** Texto corto de los créditos de una fila: "2 meses", "Renovación gratis", "Renovación gratis + 2 meses", "USD 300", "2 meses + USD 300" o "—" */
export function textoCredito(c: CreditoListado | null): string {
  if (!c) return '—'
  const partes: string[] = []
  if (c.renovacionGratis) partes.push(c.mesesSobreRenovacion > 0 ? `Renovación gratis + ${mesesTexto(c.mesesSobreRenovacion)}` : 'Renovación gratis')
  else if (c.meses > 0) partes.push(mesesTexto(c.meses))
  if (c.usd > 0) partes.push(usd(c.usd))
  return partes.join(' + ') || '0'
}

// Columnas del panel por cliente. "—" = no hay nada que contar (sin referidos ni libro, o todavía no existe la pestaña Referidos).
/** "3 / 2 / 1" = presentó 3, asistieron 2, cerró 1 */
export function textoReferidos(p: PanelReferidos | null): string {
  if (!p || (p.referidos.presentados === 0 && p.creditos.usados === 0)) return '—'
  return `${p.referidos.presentados} / ${p.referidos.asistieron} / ${p.referidos.cerraron}`
}

/** "Usados 2 · Por liberar 1" (meses canjeados y cierres que todavía no se liberaron) */
export function textoUsadosPendientes(p: PanelReferidos | null): string {
  if (!p || (p.creditos.usados === 0 && p.creditos.pendientesDeLiberar === 0)) return '—'
  return `${mesesTexto(p.creditos.usados)} usados · ${p.creditos.pendientesDeLiberar} por liberar`
}

/** Intentos acumulados con los premios únicos ya ganados ("3 intentos · página web, branding"); "—" si no hubo intentos */
export function textoIntentos(p: PanelReferidos | null): string {
  if (!p || p.beneficios.intentos === 0) return '—'
  const b = p.beneficios
  const unicos = [b.paginaWeb ? 'página web' : '', b.branding ? 'branding' : ''].filter(Boolean)
  return `${b.intentos} ${b.intentos === 1 ? 'intento' : 'intentos'}${unicos.length ? ` · ${unicos.join(', ')}` : ''}`
}

/** Grabación en las oficinas: extra solo para la zona de Buenos Aires (pista por teléfono: la confirma el closer); "—" si la zona no se pudo deducir */
export function textoGrabacion(p: PanelReferidos | null): string {
  if (!p || p.beneficios.zona !== 'buenos_aires') return '—'
  return 'Extra para esta zona (a confirmar)'
}

/** Extra del nivel alcanzado en palabras cortas ("Identidad de marca completa"); "—" si no tiene */
export function textoExtraCorto(p: PanelReferidos | null): string {
  if (!p || p.beneficios.extras.length === 0) return '—'
  return p.beneficios.extras.map(e => textoExtra(e).replace(/\s*\(.*\)\s*$/, '')).join(', ')
}

// ── Filtros ──
// 'actuales' (lo que se ve al entrar) = los que hoy son clientes: ACTIVO y PAUSADO (los de onboarding figuran ACTIVO en el CRM)
export type EstadoFiltro = EstadoCliente | 'todos' | 'actuales'
export type VencenFiltro = 0 | 15 | 30
export type SemaforoFiltro = ColorSemaforo | 'todos'
export type Orden = 'vencimiento' | 'nombre' | 'id' | 'cobrado'

export const SIN_CLOSER = '(sin closer)'

export interface FiltrosListado {
  q: string
  estado: EstadoFiltro
  semaforo: SemaforoFiltro
  closer: string                // 'todos' | nombre del closer | SIN_CLOSER
  vencen: VencenFiltro          // "Por vencer": ACTIVO con el período terminando en los próximos 15 o 30 días (hoy incluido); 0 = sin filtro
  sinCampana: boolean           // prioridad: todavía sin campaña lanzada
  renovacion: boolean           // renovación pendiente (lo que era la lista de Backend)
  sinRespuesta: boolean         // sin respuesta del Typeform este mes
  linea: Linea
  conNoClientes: boolean
  orden: Orden
}

export const FILTROS_INICIALES: FiltrosListado = {
  q: '', estado: 'actuales', semaforo: 'todos', closer: 'todos', vencen: 0, sinCampana: false, renovacion: false, sinRespuesta: false, linea: 'agencia', conNoClientes: false, orden: 'vencimiento',
}

export const ESTADOS_FILTRO: EstadoFiltro[] = ['actuales', 'todos', 'ACTIVO', 'PAUSADO', 'FINALIZADO', 'INACTIVO']
export const SEMAFOROS_FILTRO: SemaforoFiltro[] = ['todos', 'verde', 'amarillo', 'rojo', 'gris']
export const ORDENES: Orden[] = ['vencimiento', 'nombre', 'id', 'cobrado']

type Params = Record<string, string | string[] | undefined>
const uno = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? ''

// De los parámetros de la URL a filtros: lo desconocido cae en el valor por defecto (nunca rompe la página)
export function parsearFiltros(params: Params): FiltrosListado {
  const f = { ...FILTROS_INICIALES }
  f.q = uno(params.q).slice(0, 80)
  const estadoCrudo = uno(params.estado)
  const estado = ['todos', 'actuales'].includes(estadoCrudo.toLowerCase()) ? estadoCrudo.toLowerCase() : estadoCrudo.toUpperCase()
  if ((ESTADOS_FILTRO as string[]).includes(estado)) f.estado = estado as EstadoFiltro
  const sem = uno(params.semaforo)
  if ((SEMAFOROS_FILTRO as string[]).includes(sem)) f.semaforo = sem as SemaforoFiltro
  f.closer = uno(params.closer).slice(0, 40) || 'todos'
  // vencen30=1 (enlaces viejos) = 30 días
  const vencen = uno(params.vencen)
  f.vencen = vencen === '15' ? 15 : vencen === '30' || uno(params.vencen30) === '1' ? 30 : 0
  f.sinCampana = uno(params.sincampana) === '1'
  f.renovacion = uno(params.renovacion) === '1'
  f.sinRespuesta = uno(params.sinrespuesta) === '1'
  f.linea = uno(params.linea) === 'consultora' ? 'consultora' : 'agencia'
  f.conNoClientes = uno(params.noclientes) === '1'
  const orden = uno(params.orden)
  if ((ORDENES as string[]).includes(orden)) f.orden = orden as Orden
  return f
}

// De los filtros a la URL: solo viaja lo que se aparta de lo inicial
export function filtrosAParams(f: FiltrosListado): URLSearchParams {
  const p = new URLSearchParams()
  const I = FILTROS_INICIALES
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.estado !== I.estado) p.set('estado', f.estado === 'todos' || f.estado === 'actuales' ? f.estado : f.estado.toLowerCase())
  if (f.semaforo !== I.semaforo) p.set('semaforo', f.semaforo)
  if (f.closer !== I.closer) p.set('closer', f.closer)
  if (f.vencen) p.set('vencen', String(f.vencen))
  if (f.sinCampana) p.set('sincampana', '1')
  if (f.renovacion) p.set('renovacion', '1')
  if (f.sinRespuesta) p.set('sinrespuesta', '1')
  if (f.linea !== I.linea) p.set('linea', f.linea)
  if (f.conNoClientes) p.set('noclientes', '1')
  if (f.orden !== I.orden) p.set('orden', f.orden)
  return p
}

/** ¿Viaja algo en la URL? Sin `URLSearchParams.size`: no existe antes de Safari 17 / Chrome 113 / Firefox 112 (Next 16 todavía
 *  soporta Safari 16.4) y ahí daba undefined, con lo que el cliente dibujaba distinto que el servidor al hidratar */
export const hayParams = (p: URLSearchParams): boolean => p.toString() !== ''

// ── Chips de "Mostrar" ──
// Renovación pendiente (marcas de Backend), sin campaña (ClickUp y Meta), sin respuesta (Typeform) y "no clientes" solo
// existen en Agencia. Al pasar a Consultora se apagan: si no, la lista quedaba vacía con un chip que prometía n filas.
export const cambioDeLinea = (linea: Linea): Partial<FiltrosListado> =>
  linea === 'agencia' ? { linea, closer: 'todos' } : { linea, closer: 'todos', renovacion: false, sinCampana: false, sinRespuesta: false, conNoClientes: false }

/** Los filtros de "Mostrar" prendidos, en palabras (van en el renglón de resultados, que lee el lector de pantalla) */
export function textoMostrar(f: FiltrosListado): string[] {
  const partes = [
    f.renovacion && 'renovación pendiente',
    f.sinCampana && 'sin campaña',
    f.sinRespuesta && 'sin respuesta este mes',
    f.vencen > 0 && `vencen en ${f.vencen} días`,
    f.conNoClientes && 'con los no clientes',
  ]
  return partes.filter((p): p is string => typeof p === 'string')
}

/** Solo está prendido "Renovación pendiente" (lo que abre /backend): si no hay filas, no hay renovaciones pendientes */
export const soloRenovacion = (f: FiltrosListado): boolean =>
  f.renovacion && !hayParams(filtrosAParams({ ...f, renovacion: false, orden: FILTROS_INICIALES.orden }))

export function filtrarListado(filas: ClienteListado[], f: FiltrosListado): ClienteListado[] {
  const q = normTxt(f.q)
  return filas.filter(c => {
    if (c.linea !== f.linea) return false
    if (c.noCliente && !f.conNoClientes) return false
    if (f.estado === 'actuales' ? c.estado !== 'ACTIVO' && c.estado !== 'PAUSADO' : f.estado !== 'todos' && c.estado !== f.estado) return false
    if (f.semaforo !== 'todos' && c.semaforo !== f.semaforo) return false
    if (f.closer !== 'todos' && (f.closer === SIN_CLOSER ? c.closer !== '' : c.closer !== f.closer)) return false
    if (f.vencen && !(c.estado === 'ACTIVO' && c.dias !== null && c.dias >= 0 && c.dias <= f.vencen)) return false
    if (f.sinCampana && !c.sinCampana) return false
    if (f.renovacion && c.backend?.renovacionDias == null) return false
    if (f.sinRespuesta && !c.sinRespuestaMes) return false
    if (q && !normTxt(c.nombre).includes(q) && !normTxt(c.id).includes(q)) return false
    return true
  })
}

// Orden "vencimiento más próximo": primero lo que hay que atender. ACTIVO y PAUSADO por días para vencer
// (los vencidos, que son los más urgentes, arriba) y al final los FINALIZADO/INACTIVO, del más reciente al más viejo.
// Sin fecha de fin, al final de su grupo.
const grupoDe = (c: ClienteListado): number => (c.estado === 'ACTIVO' ? 0 : c.estado === 'PAUSADO' ? 1 : 2)
const porNombre = (a: ClienteListado, b: ClienteListado) => a.nombre.localeCompare(b.nombre, 'es')

export function ordenarListado(filas: ClienteListado[], orden: Orden): ClienteListado[] {
  const copia = [...filas]
  switch (orden) {
    case 'nombre':
      return copia.sort(porNombre)
    case 'id':
      return copia.sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }) || porNombre(a, b))
    case 'cobrado':
      return copia.sort((a, b) => (b.cobrado ?? -1) - (a.cobrado ?? -1) || porNombre(a, b))
    default:
      return copia.sort((a, b) => {
        const ga = grupoDe(a), gb = grupoDe(b)
        if (ga !== gb) return ga - gb
        if (ga < 2) {
          if (a.dias === null || b.dias === null) return (a.dias === null ? 1 : 0) - (b.dias === null ? 1 : 0) || porNombre(a, b)
          return a.dias - b.dias || porNombre(a, b)
        }
        if (!a.fin || !b.fin) return (a.fin ? 0 : 1) - (b.fin ? 0 : 1) || porNombre(a, b)
        return b.fin.localeCompare(a.fin) || porNombre(a, b)
      })
  }
}

/** Closers de la lista con su cantidad (para los chips): del que más tiene al que menos; "(sin closer)" al final si hace falta */
export function closersDe(filas: ClienteListado[]): { nombre: string; n: number }[] {
  const m = new Map<string, number>()
  for (const f of filas) m.set(f.closer || SIN_CLOSER, (m.get(f.closer || SIN_CLOSER) ?? 0) + 1)
  return [...m.entries()].map(([nombre, n]) => ({ nombre, n }))
    .sort((a, b) => (a.nombre === SIN_CLOSER ? 1 : 0) - (b.nombre === SIN_CLOSER ? 1 : 0) || b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'))
}
