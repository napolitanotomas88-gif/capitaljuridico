// ── Lo que muestra /clientes/edicion (puro: de los datos del repositorio a la pantalla) ─────────────────────────────────────
// Acá se decide qué llega al navegador. Reglas:
//   · ningún mail, teléfono ni monto: el historial dice el NOMBRE de quien hizo cada cosa (nunca actor.email) y, si en un
//     campo de nombre quedó un mail por error, se muestra "(equipo)". El guion sí puede traer el WhatsApp del estudio (lo
//     lleva el CTA): eso no se filtra;
//   · René (y cualquiera que no vea Clientes) nunca recibe un link a /clientes: `puedeVerClientes` lo decide la página;
//   · René ve solo las notas ENVIADAS (las que Aylu está escribiendo todavía no son para él);
//   · el estado del cliente no se guarda: se calcula de sus videos (estadoCliente);
//   · "trabado": los umbrales de config.ts (UMBRALES_TRABADO). En la pantalla las horas cuentan solo los días hábiles (un fin
//     de semana no hace parecer atrasado a René) y los "hábiles", días hábiles después del día en que entró al estado.
// Los textos para el cliente los arma textos.ts (bloque C): acá solo se eligen los datos.
import { esHabil as esHabilAR } from '@/lib/anuncios/feriados'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { HORARIO_VIGIA, UMBRALES_TRABADO } from './config'
import type { DatosCliente, DetalleVideo, FilaTablero } from './db/videos'
import { ACCIONES_CON_FLUJO, TOPE_RONDAS_CLIENTE, accionesPara, type AccionVideo, type ContextoTransicion } from './estados'
import { ETIQUETA_BLOQUEO, ETIQUETA_MOTIVO, ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_NOTA, claveVisible } from './etiquetas'
import { mmss } from './pedido'
import { NOMBRE_ROL, pestanasDe, tienePermiso, type Pestana } from './permisos'
import { fechaSugeridaE01, nombreDeSaludo, textoE01, textoLinkFinal, textoRegrabar, type GuiaInterna, type TextoCliente } from './textos'
import {
  ESTADOS_FINALES, ESTADOS_VIDEO, ETIQUETA_ESTADO,
  type Actor, type Aviso, type ArchivoGrabacion, type Bloqueo, type CarpetaGrabacion, type CoberturaGuion, type Corrida,
  type EstadoGuionDoc, type EstadoVideo, type EventoVideo, type FichaMarca, type IdCrm, type Iso,
  type NotaVideo, type PasoSeguimiento, type PedidoCliente, type Prioridad, type RolEdicion, type Video,
} from './tipos'

// ── Etiquetas ──
export { ETIQUETA_BLOQUEO, ETIQUETA_MOTIVO, ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_NOTA, claveVisible }
export const ETIQUETA_ACCION: Record<AccionVideo, string> = {
  llegaron_crudos: 'Llegaron los crudos', sirve: 'Sirve: a edición', regrabar: 'Regrabar', pausa_devolucion: 'Pausa con devolución',
  regrabar_enviado: 'Pedido de regrabación enviado', devolver: 'Devolver a revisión', listo: 'Listo', pedir_correccion: 'Pedir corrección',
  corregido: 'Corregido', para_cliente: 'Está bien: al cliente', pedido_cliente: 'Pedido del cliente', autorizar_ronda: 'Autorizar la ronda',
  ok_cliente: 'El cliente dio el OK', pausar: 'Pausar', reanudar: 'Reanudar', descartar: 'Descartar', reabrir: 'Reabrir',
}
const ETIQUETA_DOC: Record<EstadoGuionDoc, string> = { no_iniciado: 'No iniciado', para_grabar: 'Para grabar', grabado_completo: 'Grabado completo', otro: 'Otro' }
const ETIQUETA_RESPONSABLE: Record<PasoSeguimiento['responsable'], string> = { aylu: 'Aylu', gero_m: 'Gero M', tomas: 'Tomás' }
const ETIQUETA_SUBIO = { cliente: 'lo subió el cliente', equipo: 'lo subió el equipo', desconocido: 'sin dato de quién lo subió', mixto: 'subieron el cliente y el equipo' } as const
const ORDEN_PRIORIDAD: Record<Prioridad, number> = { urgente: 0, alta: 1, normal: 2 }

export type EstadoCliente = 'grabando' | 'en_revision' | 'en_edicion' | 'con_cliente' | 'al_dia' | 'pausado'
export const ETIQUETA_ESTADO_CLIENTE: Record<EstadoCliente, string> = {
  grabando: 'Grabando', en_revision: 'En revisión', en_edicion: 'En edición', con_cliente: 'Con el cliente', al_dia: 'Al día', pausado: 'Pausado',
}
export type Tono = 'verde' | 'amarillo' | 'rojo' | 'gris'

// ── Datos personales: última barrera ──
const RE_MAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi
const HAY_MAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i
/** Un nombre para mostrar: si quedó un mail, "(equipo)"; recortado. */
export const nombreVisible = (x: string | null | undefined): string => {
  const t = (x ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return HAY_MAIL.test(t) ? '(equipo)' : t.slice(0, 80)
}
/** Un link para el navegador: solo https (lo que venga de la base con otro esquema no se muestra). */
export const soloHttps = (u: string | null | undefined): string | null => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u.trim()) ? u.trim() : null)
/** Texto libre que escribió el equipo (notas, constancias): los mails se tapan. */
export const sinMails = (t: string): string => t.replace(RE_MAIL, '[mail]')

// ── Tiempo ──
type EsHabil = (ymd: string) => boolean
const HORA_MS = 3_600_000
const AR_MS = 3 * HORA_MS   // Argentina, UTC-3 sin horario de verano

/** Horas transcurridas que caen en días hábiles (hora de Argentina), entre `desde` y `hasta`. Hasta 120 días hacia atrás. */
export function horasHabiles(desde: Iso, hasta: Date, esHabil: EsHabil = esHabilAR): number {
  const a = Date.parse(desde)
  const b = hasta.getTime()
  if (!Number.isFinite(a) || b <= a) return 0
  let t = Math.max(a, b - 120 * 24 * HORA_MS)
  let total = 0
  while (t < b) {
    const local = new Date(t - AR_MS)
    const ymd = local.toISOString().slice(0, 10)
    const finDia = Date.parse(`${ymd}T00:00:00.000Z`) + 24 * HORA_MS + AR_MS   // medianoche siguiente, en UTC
    const hastaTramo = Math.min(finDia, b)
    if (esHabil(ymd)) total += hastaTramo - t
    t = hastaTramo
  }
  return total / HORA_MS
}

/** Días hábiles después del día de `desde` (sin contarlo) hasta hoy inclusive, en hora de Argentina. */
export function diasHabilesDesde(desde: Iso, ahora: Date, esHabil: EsHabil = esHabilAR): number {
  const inicio = hoyArgentina(new Date(Date.parse(desde)))
  const hoy = hoyArgentina(ahora)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || inicio >= hoy) return 0
  let d = inicio, n = 0
  for (let i = 0; i < 400 && d < hoy; i++) {
    const sig = new Date(Date.parse(`${d}T12:00:00.000Z`) + 24 * HORA_MS).toISOString().slice(0, 10)
    d = sig
    if (esHabil(d)) n++
  }
  return n
}

/** "hace 5 min", "hace 3 h", "hace 2 días" (horas corridas: es la referencia que entiende cualquiera). */
export function haceTexto(desde: Iso | null | undefined, ahora: Date): string {
  const t = desde ? Date.parse(desde) : NaN
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.round((ahora.getTime() - t) / 60_000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 36) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} día${d === 1 ? '' : 's'}`
}

/** "vie 24/10 18:05" en hora de Argentina. */
export function fechaHora(iso: Iso | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const d = new Date(t - AR_MS)
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export interface TiempoEstado { texto: string; trabado: boolean; quien: 'aylu' | 'rene' | 'cliente' | null; detalle: string }

/** Cuánto lleva el video en su estado y si está trabado (UMBRALES_TRABADO, contados en hábiles). */
export function tiempoEnEstado(v: Pick<Video, 'estado' | 'estado_desde'>, ahora: Date, esHabil: EsHabil = esHabilAR): TiempoEstado {
  const texto = haceTexto(v.estado_desde, ahora)
  const u = UMBRALES_TRABADO[v.estado]
  if (!u) return { texto, trabado: false, quien: null, detalle: '' }
  if (u.habiles !== undefined) {
    const d = diasHabilesDesde(v.estado_desde, ahora, esHabil)
    return { texto, trabado: d >= u.habiles && d > 0, quien: u.quien, detalle: `${d} día${d === 1 ? '' : 's'} hábil${d === 1 ? '' : 'es'}` }
  }
  const h = horasHabiles(v.estado_desde, ahora, esHabil)
  return { texto, trabado: u.horas !== undefined && h >= u.horas, quien: u.quien, detalle: `${Math.floor(h)} h hábiles` }
}

// ── Estado del cliente ──
/** El estado del cliente sale de sus videos: la etapa MENOS avanzada que tenga abierta (lo que frena al resto). */
export function estadoCliente(videos: readonly Pick<Video, 'estado'>[]): EstadoCliente {
  const abiertos = videos.filter(v => !ESTADOS_FINALES.includes(v.estado))
  if (!abiertos.length) return 'al_dia'
  const hay = (...e: EstadoVideo[]) => abiertos.some(v => e.includes(v.estado))
  if (abiertos.every(v => v.estado === 'pausado')) return 'pausado'
  if (hay('esperando_crudos', 'regrabar')) return 'grabando'
  if (hay('crudo_a_revisar')) return 'en_revision'
  if (hay('para_editar', 'editado', 'correccion', 'corregido')) return 'en_edicion'
  if (hay('con_cliente')) return 'con_cliente'
  return 'al_dia'
}

// ── Paleta ──
export interface VistaPaleta { colores: { hex: string; nombre: string }[]; tipografias: string[]; logo: string | null; referencia: { url: string; descripcion: string } | null; carpeta: string | null; notas: string; fuentes: string[]; vacia: boolean }
export function vistaPaleta(m: FichaMarca | null | undefined): VistaPaleta {
  if (!m) return { colores: [], tipografias: [], logo: null, referencia: null, carpeta: null, notas: '', fuentes: [], vacia: true }
  const fuentes = Object.entries(m.fuentes ?? {}).filter(([, f]) => f).map(([campo, f]) => `${campo}: ${f!.origen}${f!.quien ? ` (${nombreVisible(f!.quien)})` : ''}`)
  return {
    colores: m.colores.filter(c => /^#[0-9A-F]{6}$/i.test(c.hex)).map(c => ({ hex: c.hex.toUpperCase(), nombre: c.nombre })),
    tipografias: m.tipografias, logo: soloHttps(m.logo?.url), referencia: m.referencia && soloHttps(m.referencia.url) ? { url: soloHttps(m.referencia.url)!, descripcion: m.referencia.descripcion } : null,
    carpeta: soloHttps(m.carpeta_marca?.url),
    notas: sinMails(m.notas ?? ''), fuentes, vacia: !m.colores.length && !m.tipografias.length && !m.logo && !m.referencia,
  }
}

// ── Tarjeta de un video (tablero, colas, cliente) ──
export interface TarjetaVideo {
  id: number; version: number; id_crm: IdCrm; cliente: string; clave: string; gancho: string
  estado: EstadoVideo; etiquetaEstado: string; prioridad: Prioridad
  bloqueo: { clave: Bloqueo; texto: string } | null
  paleta: { hex: string; nombre: string }[] | null       // null = sin paleta
  tiempo: TiempoEstado
  rondas: { texto: string; tope: boolean } | null
  editadoPropuesto: boolean; crudos: number; notasAbiertas: number
  posibleDuplicado: string[]
  href: string
}

const unaLinea = (t: string, max = 140) => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

function textoRondas(v: Pick<Video, 'ronda_cliente' | 'ronda_interna' | 'estado' | 'bloqueo'>): TarjetaVideo['rondas'] {
  if (v.ronda_cliente <= 0 && v.ronda_interna <= 0) return null
  const partes: string[] = []
  if (v.ronda_interna > 0) partes.push(`Aylu ${v.ronda_interna}`)
  if (v.ronda_cliente > 0) partes.push(`cliente ${v.ronda_cliente}/${TOPE_RONDAS_CLIENTE}`)
  return { texto: partes.join(' · '), tope: v.ronda_cliente >= TOPE_RONDAS_CLIENTE || v.bloqueo === 'tope_rondas_cliente' }
}

export function tarjeta(f: FilaTablero, ahora: Date, marcas?: Map<IdCrm, FichaMarca>, esHabil: EsHabil = esHabilAR): TarjetaVideo {
  const m = marcas?.get(f.id_crm)
  const colores = m?.colores?.length ? vistaPaleta(m).colores.slice(0, 6) : null
  return {
    id: f.id, version: f.version, id_crm: f.id_crm, cliente: f.cliente, clave: claveVisible(f), gancho: unaLinea(f.gancho || f.guion_texto || ''),
    estado: f.estado, etiquetaEstado: ETIQUETA_ESTADO[f.estado], prioridad: f.prioridad,
    bloqueo: f.bloqueo ? { clave: f.bloqueo, texto: f.motivo_bloqueo ? `${ETIQUETA_BLOQUEO[f.bloqueo]}: ${unaLinea(sinMails(f.motivo_bloqueo), 90)}` : ETIQUETA_BLOQUEO[f.bloqueo] } : null,
    // Sin la ficha leída, el dato `paleta` del repositorio alcanza para decir "con paleta" sin muestras
    paleta: colores ?? (f.paleta ? [] : null),
    tiempo: tiempoEnEstado(f, ahora, esHabil), rondas: textoRondas(f),
    editadoPropuesto: !!f.editado_propuesto, crudos: f.crudos ?? 0, notasAbiertas: f.notas_abiertas ?? 0,
    posibleDuplicado: f.posible_duplicado ?? [],
    href: `/clientes/edicion/video/${f.id}`,
  }
}

// ── Tablero ──
export interface ColumnaTablero { estado: EstadoVideo; etiqueta: string; tarjetas: TarjetaVideo[] }
export interface GrupoCola { id_crm: IdCrm; cliente: string; tarjetas: TarjetaVideo[]; lote: { transicion: 'listo' | 'sirve'; items: { video_id: number; version: number }[] } | null }
export interface VistaTablero {
  rol: RolEdicion; nombreRol: string
  pestanas: Pestana[]
  cola: { titulo: string; explicacion: string; grupos: GrupoCola[]; total: number } | null
  columnas: ColumnaTablero[]
  filtros: { estado: EstadoVideo | null; cliente: IdCrm | null; clientes: { id_crm: IdCrm; cliente: string; videos: number }[] }
  resumen: { activos: number; trabados: number; bloqueados: number; sinPaleta: number }
}
export interface OpcionesTablero {
  marcas?: Map<IdCrm, FichaMarca>
  filtro?: { estado?: string | null; cliente?: string | null }
  esHabil?: EsHabil
  socio?: boolean
}

/** Qué entra en "Mi cola" de cada rol. */
export function enMiCola(rol: RolEdicion, v: Pick<Video, 'estado' | 'bloqueo' | 'envio_link'>): boolean {
  if (rol === 'rene') return (v.estado === 'para_editar' || v.estado === 'correccion') && v.bloqueo !== 'tope_rondas_cliente'
  if (rol === 'aylu' || rol === 'tomas') {
    if (v.bloqueo === 'tope_rondas_cliente') return rol === 'tomas'
    if (v.bloqueo && !ESTADOS_FINALES.includes(v.estado)) return true
    if (v.estado === 'con_cliente') return !v.envio_link
    return v.estado === 'crudo_a_revisar' || v.estado === 'editado' || v.estado === 'corregido' || v.estado === 'regrabar'
  }
  return false
}

function compararEdad(a: FilaTablero, b: FilaTablero): number {
  return (Date.parse(a.estado_desde) || 0) - (Date.parse(b.estado_desde) || 0)
}

const EXPLICACION_COLA: Record<RolEdicion, string> = {
  rene: 'Para editar y correcciones. Las correcciones van primero; después, por prioridad y lo más viejo arriba.',
  aylu: 'Crudos para revisar, editados y corregidos para controlar, regrabaciones por pedir, links por mandar y bloqueos.',
  tomas: 'Lo de Aylu, más las terceras rondas del cliente que esperan tu OK (arriba de todo).',
  lector: '',
}

export function armarTablero(filas: readonly FilaTablero[], rol: RolEdicion, ahora: Date, op: OpcionesTablero = {}): VistaTablero {
  const esHabil = op.esHabil ?? esHabilAR
  const estadoFiltro = (ESTADOS_VIDEO as readonly string[]).includes(op.filtro?.estado ?? '') ? op.filtro!.estado as EstadoVideo : null
  const clienteFiltro = typeof op.filtro?.cliente === 'string' && /^[A-Za-z]\d{1,6}$/.test(op.filtro.cliente) ? op.filtro.cliente.toUpperCase() : null
  const activas = filas.filter(f => !ESTADOS_FINALES.includes(f.estado) || f.estado === estadoFiltro)

  // Clientes para el filtro (todos los que tienen videos activos, por nombre)
  const porCliente = new Map<IdCrm, { id_crm: IdCrm; cliente: string; videos: number }>()
  for (const f of activas) {
    const c = porCliente.get(f.id_crm) ?? { id_crm: f.id_crm, cliente: f.cliente, videos: 0 }
    c.videos++
    porCliente.set(f.id_crm, c)
  }
  const visibles = activas.filter(f => (!clienteFiltro || f.id_crm === clienteFiltro) && (!estadoFiltro || f.estado === estadoFiltro))
  const tarjetas = new Map<number, TarjetaVideo>(visibles.map(f => [f.id, tarjeta(f, ahora, op.marcas, esHabil)]))

  // Columnas: los estados no finales en el orden del flujo (más el filtrado, si es final)
  const estados = ESTADOS_VIDEO.filter(e => (estadoFiltro ? e === estadoFiltro : !ESTADOS_FINALES.includes(e)))
  const columnas: ColumnaTablero[] = estados.map(e => ({
    estado: e, etiqueta: ETIQUETA_ESTADO[e],
    tarjetas: visibles.filter(f => f.estado === e).sort((a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || compararEdad(a, b)).map(f => tarjetas.get(f.id)!),
  }))

  // Mi cola
  let cola: VistaTablero['cola'] = null
  if (rol !== 'lector') {
    const deCola = visibles.filter(f => enMiCola(rol, f))
    const peso = (f: FilaTablero) => {
      if (rol === 'rene') return f.estado === 'correccion' ? 0 : 1
      if (f.bloqueo === 'tope_rondas_cliente') return 0
      return f.bloqueo ? 1 : tarjetas.get(f.id)!.tiempo.trabado ? 2 : 3
    }
    const ordenadas = [...deCola].sort((a, b) => peso(a) - peso(b) || ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || compararEdad(a, b))
    const grupos: GrupoCola[] = []
    for (const f of ordenadas) {
      let g = grupos.find(x => x.id_crm === f.id_crm)
      if (!g) { g = { id_crm: f.id_crm, cliente: f.cliente, tarjetas: [], lote: null }; grupos.push(g) }
      g.tarjetas.push(tarjetas.get(f.id)!)
    }
    // "Terminé la tanda" (René) o "Sirven todos" (Aylu y Tomás), si hay dos o más del mismo cliente en ese estado
    for (const g of grupos) {
      const delGrupo = ordenadas.filter(f => f.id_crm === g.id_crm)
      const listos = rol === 'rene' ? delGrupo.filter(f => f.estado === 'para_editar') : delGrupo.filter(f => f.estado === 'crudo_a_revisar' && (f.crudos ?? 0) > 0)
      if (listos.length >= 2) g.lote = { transicion: rol === 'rene' ? 'listo' : 'sirve', items: listos.slice(0, 30).map(f => ({ video_id: f.id, version: f.version })) }
    }
    cola = { titulo: rol === 'rene' ? 'Tu cola de edición' : 'Lo que te toca', explicacion: EXPLICACION_COLA[rol], grupos, total: deCola.length }
  }

  const todas = [...tarjetas.values()]
  return {
    rol, nombreRol: NOMBRE_ROL[rol], pestanas: pestanasDe(rol, op.socio ?? false), cola, columnas,
    filtros: { estado: estadoFiltro, cliente: clienteFiltro, clientes: [...porCliente.values()].sort((a, b) => a.cliente.localeCompare(b.cliente, 'es')) },
    resumen: {
      activos: todas.filter(t => !ESTADOS_FINALES.includes(t.estado)).length,
      trabados: todas.filter(t => t.tiempo.trabado).length,
      bloqueados: todas.filter(t => t.bloqueo).length,
      sinPaleta: new Set(todas.filter(t => t.paleta === null && !ESTADOS_FINALES.includes(t.estado)).map(t => t.id_crm)).size,
    },
  }
}

// ── Archivos ──
export interface FilaArchivo {
  id: number; nombre: string; duracion: string; peso: string; subio: string; drive: string
  transcripcion: { texto: string; tono: Tono }
  asignado: { video_id: number; clave: string; por: string } | null
  inferido: string
  propuesta: { video_id: number; clave: string } | null
  borrado: boolean; creado: string
}
const GB = 1_000_000_000
export function peso(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return ''
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace('.', ',')} GB`
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`
}
export function duracion(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return ''
  return mmss(Math.round(ms / 1000))
}
export function estadoTranscripcion(a: Pick<ArchivoGrabacion, 'transcripcion' | 'bytes' | 'mime' | 'tipo'>): { texto: string; tono: Tono } {
  const t = a.transcripcion
  switch (t.estado) {
    case 'no_aplica': return { texto: 'No se transcribe', tono: 'gris' }
    case 'pendiente': return { texto: /ASSEMBLYAI_API_KEY/.test(t.motivo) ? 'Pendiente (falta la key de AssemblyAI)' : 'Pendiente', tono: 'gris' }
    case 'enviando':
    case 'enviada': return { texto: 'Transcribiendo', tono: 'amarillo' }
    case 'lista': return { texto: 'Transcripto', tono: 'verde' }
    case 'grande': return { texto: `Sin transcribir (${peso(a.bytes)}, plan B)`, tono: 'amarillo' }
    case 'vieja': return { texto: 'Anterior al arranque: no se transcribe', tono: 'gris' }
    case 'error': return { texto: /link_privado/.test(t.motivo) ? 'No se pudo bajar de Drive (link privado: plan B)' : 'Error al transcribir', tono: 'rojo' }
  }
}
const urlDrive = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`
const POR: Record<string, string> = { bot: 'el bot', aylu: 'Aylu', tomas: 'Tomás', rene: 'René', lector: '—' }

export function filaArchivo(a: ArchivoGrabacion, claves: Map<number, string>): FilaArchivo {
  const inf = a.inferido
  const inferido = inf.por ? `${inf.tanda_guion ? `Tanda ${inf.tanda_guion}` : ''}${inf.tanda_guion && inf.numero ? ' · ' : ''}${inf.numero ? `Video ${inf.numero}` : ''} (por ${inf.por === 'carpeta' ? 'la carpeta' : inf.por === 'nombre' ? 'el nombre' : 'el contenido'})` : ''
  return {
    id: a.id, nombre: a.nombre, duracion: duracion(a.duracion_ms), peso: peso(a.bytes), subio: ETIQUETA_SUBIO[a.subio] ?? '', drive: urlDrive(a.drive_id),
    transcripcion: a.tipo === 'crudo' ? estadoTranscripcion(a) : { texto: '', tono: 'gris' },
    asignado: a.video_id ? { video_id: a.video_id, clave: claves.get(a.video_id) ?? `#${a.video_id}`, por: POR[a.asignado_por ?? ''] ?? '' } : null,
    inferido,
    propuesta: a.propuesta_video_id && !a.video_id ? { video_id: a.propuesta_video_id, clave: claves.get(a.propuesta_video_id) ?? `#${a.propuesta_video_id}` } : null,
    borrado: !!a.borrado, creado: fechaHora(a.creado),
  }
}

// ── Cliente ──
export type { DatosCliente }
export interface CoberturaVista { texto: string; estado: 'completo' | 'incompleto' | 'sin_transcripcion'; faltan: string[]; dudosas: string[]; mejorToma: string | null; por: string }
export interface FilaGuion {
  ref: string; numero: number | null; titulo: string; estadoDoc: string
  video: { id: number; version: number; clave: string; estado: EstadoVideo; etiqueta: string; href: string; crudos: number; acciones: AccionBoton[]; motivo: string | null; bloqueo: string | null } | null
  cobertura: CoberturaVista | null
}
export interface ItemLote { video_id: number; version: number }
/** El cierre de la tanda (así cierra Aylu: 253 de 282 cierres fueron en tanda): al cliente en lote, UN mensaje con todos los
 *  links (f04) y el OK del cliente en lote con una sola cita (f06). */
export interface CierreTandaVista {
  alCliente: ItemLote[]                                   // editados o corregidos con link al editado
  linkFinal: { texto: string; items: ItemLote[] } | null   // con el cliente, con link y sin constancia de envío
  ok: ItemLote[]                                          // con el cliente (sin el bloqueo del tope)
}
export interface TandaGuionVista {
  tanda: number | null; titulo: string; guiones: FilaGuion[]; lote: ItemLote[]; ofrecerGuionesEnviados: boolean
  cierre: CierreTandaVista | null
}
export interface VistaCliente {
  id_crm: IdCrm; cliente: string; estado: EstadoCliente; etiquetaEstado: string; linkClientes: string | null
  tandas: TandaGuionVista[]
  crudos: FilaArchivo[]; editados: FilaArchivo[]
  subidas: { id: number; tipo: string; desde: string; archivos: number; subio: string; estado: string; resumen: string }[]
  regrabar: { texto: string; items: { video_id: number; version: number }[] } | null
  marca: VistaPaleta; marcaFicha: FichaMarca | null
  doc: { link: string | null; leido: string; avisos: string[] } | null
  seguimiento: { escalon: string; responsable: string; debido: string; frenado: boolean } | null
  carpetas: { nombre: string; tipo: string; vinculo: string; link: string }[]
  videosAsignables: { id: number; clave: string }[]
  permisos: { e04: boolean; marca: boolean; vincular: boolean; guiones: boolean; envio: boolean }
}

const coberturaVista = (c: CoberturaGuion, nombres: Map<number, string>): CoberturaVista => ({
  texto: c.estado === 'sin_transcripcion' ? 'Sin transcripción todavía' : `${c.presentes} de ${c.frases} frases`,
  estado: c.estado, faltan: c.faltan.slice(0, 12), dudosas: c.dudosas.slice(0, 12),
  mejorToma: c.mejor_toma ? `${nombres.get(c.mejor_toma.archivo_id) ?? `archivo ${c.mejor_toma.archivo_id}`} · ${mmss(c.mejor_toma.segundo)}` : null,
  por: c.por === 'claude' ? 'comparado con Claude' : 'cruce de frases',
})

export const linkDoc = (docId: string | null | undefined): string | null => (docId && /^[A-Za-z0-9_-]{10,200}$/.test(docId) ? `https://docs.google.com/document/d/${docId}/edit` : null)
export const linkCarpeta = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`

/**
 * El detalle que Aylu escribió al marcar «Regrabar» («la frase del CTA», «se escucha el ventilador»): la nota del último
 * evento de regrabar de cada video (sin mails). Es lo que hace que el cliente sepa QUÉ volver a grabar.
 */
export function detallesRegrabar(eventos: readonly Pick<EventoVideo, 'video_id' | 'tipo' | 'datos' | 'nota' | 'cuando'>[]): Record<number, string> {
  const out: Record<number, { nota: string; cuando: string }> = {}
  for (const e of eventos) {
    if (e.tipo !== 'estado' || (e.datos as { accion?: unknown })?.accion !== 'regrabar') continue
    const ya = out[e.video_id]
    if (!ya || e.cuando > ya.cuando) out[e.video_id] = { nota: sinMails(e.nota ?? '').trim(), cuando: e.cuando }
  }
  return Object.fromEntries(Object.entries(out).filter(([, x]) => x.nota).map(([k, x]) => [Number(k), x.nota.slice(0, 200)]))
}

/** El texto de regrabación para copiar (videos en "regrabar"), con el motivo y el detalle que escribió Aylu. */
export function textoRegrabarDe(cliente: string, videos: readonly Video[], detalles: Record<number, string> = {}): string | null {
  const xs = videos.filter(v => v.estado === 'regrabar')
  if (!xs.length) return null
  const tandas = new Set(xs.map(v => v.tanda_guion))
  return textoRegrabar({
    nombre: nombreDeSaludo(cliente), tanda: tandas.size === 1 ? xs[0].tanda_guion : null,
    videos: xs.map(v => ({ clave: v.clave, numero: v.numero, motivo: v.motivo_regrabar ?? 'otro', detalle: sinMails(detalles[v.id] ?? '') })),
  }).texto
}
/** El link final para copiar (f04): videos con el cliente y con link al editado (de a uno o la tanda entera). */
export function textoLinkFinalDe(cliente: string, videos: readonly Video[]): string | null {
  const xs = videos.filter(v => v.estado === 'con_cliente' && soloHttps(v.editado?.url))
  if (!xs.length) return null
  const tandas = new Set(xs.map(v => v.tanda_guion))
  return textoLinkFinal({
    nombre: nombreDeSaludo(cliente), tanda: tandas.size === 1 ? xs[0].tanda_guion : null,
    videos: [...xs].sort((a, b) => (a.numero ?? 999) - (b.numero ?? 999)).map(v => ({ clave: v.clave, numero: v.numero, titulo: unaLinea(v.gancho, 80), url: v.editado!.url })),
  }).texto
}

function ctxDe(v: Video, crudos: number, notas: readonly NotaVideo[]): ContextoTransicion {
  // Igual que el repositorio (leerContexto): las notas sin tildar son las enviadas de la ronda en curso
  const enviadas = notas.filter(n => n.enviada)
  const rondaActual = v.ronda_interna + v.ronda_cliente
  return {
    crudos, notasNuevas: notas.filter(n => !n.enviada).length,
    notasSinTildar: enviadas.filter(n => n.ronda === rondaActual && !n.tilde).length,
    linkEditado: !!v.editado?.url,
  }
}

const E04: readonly AccionVideo[] = ['sirve', 'regrabar', 'pausa_devolucion', 'llegaron_crudos', 'devolver']

export function armarCliente(datos: DatosCliente, marca: FichaMarca | null, rol: RolEdicion, puedeVerClientes: boolean): VistaCliente {
  const { videos, archivos, tandas, doc } = datos
  const cliente = videos[0]?.cliente ?? datos.seguimientos[0]?.cliente ?? ''
  const id_crm = (videos[0]?.id_crm ?? datos.seguimientos[0]?.id_crm ?? doc?.id_crm ?? '').toUpperCase()
  const claves = new Map(videos.map(v => [v.id, claveVisible(v)]))
  const nombres = new Map(archivos.map(a => [a.id, a.nombre]))
  const crudosDe = (id: number) => archivos.filter(a => a.tipo === 'crudo' && a.video_id === id && !a.borrado).length

  // La última cobertura de cada guion (la tanda de subida comparada más reciente que lo nombra)
  const coberturas = new Map<string, CoberturaVista>()
  for (const t of [...tandas].sort((a, b) => (Date.parse(b.desde) || 0) - (Date.parse(a.desde) || 0))) {
    for (const g of t.resultado?.guiones ?? []) if (!coberturas.has(g.guion_ref)) coberturas.set(g.guion_ref, coberturaVista(g, nombres))
  }

  const filaVideo = (v: Video): NonNullable<FilaGuion['video']> => ({
    id: v.id, version: v.version, clave: claveVisible(v), estado: v.estado, etiqueta: ETIQUETA_ESTADO[v.estado], href: `/clientes/edicion/video/${v.id}`,
    crudos: crudosDe(v.id),
    acciones: accionesPara(rol, v, ctxDe(v, crudosDe(v.id), [])).filter(a => E04.includes(a)).map(a => ({ accion: a, etiqueta: ETIQUETA_ACCION[a], pide: PIDE[a] ?? null, tono: TONO[a] ?? 'secundario' })),
    motivo: v.motivo_regrabar ? ETIQUETA_MOTIVO[v.motivo_regrabar] : null,
    bloqueo: v.bloqueo ? ETIQUETA_BLOQUEO[v.bloqueo] : null,
  })

  // Por tanda del guion: los guiones del doc (con su video, si lo hay) y los videos sin guion del doc
  const porTanda = new Map<number | null, TandaGuionVista>()
  const tandaDe = (n: number | null) => {
    let t = porTanda.get(n)
    if (!t) { t = { tanda: n, titulo: n ? `Tanda ${n}` : 'Sin tanda del guion', guiones: [], lote: [], ofrecerGuionesEnviados: false, cierre: null }; porTanda.set(n, t) }
    return t
  }
  const usados = new Set<number>()
  for (const g of doc?.guiones ?? []) {
    const v = videos.find(x => x.guion?.ref === g.ref) ?? videos.find(x => x.tanda_guion === g.tanda && x.numero === g.numero)
    if (v) usados.add(v.id)
    tandaDe(g.tanda).guiones.push({ ref: g.ref, numero: g.numero, titulo: unaLinea(g.titulo || g.secciones.hook, 110), estadoDoc: ETIQUETA_DOC[g.estado_doc], video: v ? filaVideo(v) : null, cobertura: coberturas.get(g.ref) ?? null })
  }
  for (const v of videos) {
    if (usados.has(v.id)) continue
    tandaDe(v.tanda_guion).guiones.push({ ref: v.guion?.ref ?? v.clave, numero: v.numero, titulo: unaLinea(v.gancho || v.guion_texto, 110), estadoDoc: v.origen === 'clickup' ? 'Importado de ClickUp' : '—', video: filaVideo(v), cobertura: v.guion ? coberturas.get(v.guion.ref) ?? null : null })
  }
  const puedeE04 = rol === 'aylu' || rol === 'tomas'
  const porId = new Map(videos.map(v => [v.id, v]))
  const enCiclo = new Set(datos.seguimientos.filter(p => p.estado === 'abierto').flatMap(p => p.videos))
  for (const t of porTanda.values()) {
    t.guiones.sort((a, b) => (a.numero ?? 999) - (b.numero ?? 999))
    t.lote = t.guiones.filter(g => g.video && g.video.estado === 'crudo_a_revisar' && g.video.crudos > 0 && g.video.acciones.some(x => x.accion === 'sirve')).map(g => ({ video_id: g.video!.id, version: g.video!.version }))
    // "Guiones enviados" (arranca el seguimiento e01) POR TANDA: se ofrece si a la tanda le falta algún video (el guion
    // todavía no pasó a "Para grabar") o tiene videos esperando crudos que no están en ningún ciclo abierto. Un ciclo abierto
    // de OTRA tanda no la tapa (antes se miraba por cliente y la tanda nueva no entraba al tablero).
    t.ofrecerGuionesEnviados = t.tanda !== null && (t.guiones.some(g => !g.video) || t.guiones.some(g => g.video?.estado === 'esperando_crudos' && !enCiclo.has(g.video.id)))
    // El cierre de la tanda (f04 y f06 en lote)
    const deTanda = t.guiones.map(g => (g.video ? porId.get(g.video.id) : undefined)).filter((v): v is NonNullable<typeof v> => !!v)
    const item = (v: Video): ItemLote => ({ video_id: v.id, version: v.version })
    const alCliente = deTanda.filter(v => (v.estado === 'editado' || v.estado === 'corregido') && !!soloHttps(v.editado?.url) && v.bloqueo !== 'sin_link_editado').map(item)
    const sinEnvio = deTanda.filter(v => v.estado === 'con_cliente' && !!soloHttps(v.editado?.url) && !v.envio_link)
    const ok = deTanda.filter(v => v.estado === 'con_cliente' && v.bloqueo !== 'tope_rondas_cliente').map(item)
    t.cierre = puedeE04 && (alCliente.length || sinEnvio.length || ok.length)
      ? { alCliente, linkFinal: sinEnvio.length ? { texto: textoLinkFinalDe(cliente, sinEnvio) ?? '', items: sinEnvio.map(item) } : null, ok }
      : null
  }
  const tandasGuion = [...porTanda.values()].sort((a, b) => (b.tanda ?? -1) - (a.tanda ?? -1))

  const paso = datos.seguimientos.filter(p => p.estado === 'abierto').sort((a, b) => b.debido.localeCompare(a.debido))[0]
  const enRegrabar = videos.filter(v => v.estado === 'regrabar')

  return {
    id_crm, cliente, estado: estadoCliente(videos), etiquetaEstado: ETIQUETA_ESTADO_CLIENTE[estadoCliente(videos)],
    linkClientes: puedeVerClientes && /^[A-Z]\d{1,6}$/.test(id_crm) ? `/clientes/${id_crm}` : null,
    tandas: tandasGuion,
    crudos: archivos.filter(a => a.tipo === 'crudo').sort((a, b) => b.creado.localeCompare(a.creado)).map(a => filaArchivo(a, claves)),
    editados: archivos.filter(a => a.tipo === 'editado').sort((a, b) => b.creado.localeCompare(a.creado)).map(a => filaArchivo(a, claves)),
    subidas: [...tandas].sort((a, b) => b.desde.localeCompare(a.desde)).slice(0, 20).map(t => ({
      id: t.id, tipo: t.tipo === 'crudos' ? 'Crudos' : 'Editados', desde: fechaHora(t.desde), archivos: t.archivos, subio: ETIQUETA_SUBIO[t.subio] ?? '',
      estado: { abierta: 'Abierta (llegan archivos)', cerrada: 'Cerrada', comparando: 'Comparando con los guiones', comparada: 'Comparada', avisada: 'Avisada' }[t.estado],
      resumen: t.resultado ? `${t.resultado.guiones.filter(g => g.estado === 'completo').length} de ${t.resultado.guiones.length} guiones completos${t.resultado.sin_ubicar.length ? ` · ${t.resultado.sin_ubicar.length} sin ubicar` : ''}` : '',
    })),
    regrabar: enRegrabar.length && puedeE04 ? { texto: textoRegrabarDe(cliente, enRegrabar, datos.detallesRegrabar ?? {})!, items: enRegrabar.map(v => ({ video_id: v.id, version: v.version })) } : null,
    marca: vistaPaleta(marca), marcaFicha: marca,
    doc: doc ? { link: linkDoc(doc.doc_id), leido: fechaHora(doc.leido), avisos: doc.avisos.slice(0, 10) } : null,
    seguimiento: paso ? { escalon: etiquetaEscalon(paso.escalon), responsable: ETIQUETA_RESPONSABLE[paso.responsable], debido: paso.debido, frenado: paso.frenado === 'crudos_sin_ubicar' } : null,
    carpetas: datos.carpetas.filter(c => c.tipo !== 'sub' && !c.borrada).map(c => ({ nombre: c.nombre, tipo: c.tipo, vinculo: c.vinculo === 'a_confirmar' ? 'a confirmar' : `por ${c.vinculo}`, link: linkCarpeta(c.drive_id) })),
    videosAsignables: videos.filter(v => !ESTADOS_FINALES.includes(v.estado)).map(v => ({ id: v.id, clave: claveVisible(v) })),
    permisos: { e04: puedeE04, marca: tienePermiso(rol, 'marca'), vincular: tienePermiso(rol, 'vincular'), guiones: tienePermiso(rol, 'guiones_enviados'), envio: tienePermiso(rol, 'envio') },
  }
}

// ── Video ──
export interface FilaNota {
  id: number; version: number; ronda: number; origen: string; enviada: boolean; tiempo: string; tipo: string; texto: string
  imagen: string | null; tilde: { quien: string; cuando: string } | null; afecta: string | null; creadoPor: string; puedeEditar: boolean; puedeTildar: boolean
}
export interface FilaHistorial { id: number; cuando: string; quien: string; texto: string; nota: string }
export interface AccionBoton { accion: AccionVideo; etiqueta: string; pide: 'motivo' | 'nota' | 'nota_opcional' | 'cita' | 'link' | 'link_opcional' | null; tono: 'primario' | 'secundario' | 'peligro' }
export interface VistaPedido { id: number; version: number; ronda: number; estado: string; claveEstado: PedidoCliente['estado']; texto: string; creadoPor: string; creado: string; propuesta: (PedidoCliente['propuesta'][number] & { tiempo: string; etiquetaTipo: string })[]; elegidas: number[]; modelo: string | null }
export interface VistaVideo {
  id: number; version: number; id_crm: IdCrm; cliente: string; clave: string; hrefCliente: string
  estado: EstadoVideo; etiquetaEstado: string; tiempo: TiempoEstado; prioridad: Prioridad
  bloqueo: { clave: Bloqueo; texto: string; motivo: string } | null
  rondas: { interna: number; cliente: number; tope: number; texto: string | null }
  gancho: string; guion: string; guionRef: string | null; posibleDuplicado: string[]
  crudos: FilaArchivo[]; editado: { url: string; nombre: string | null } | null; propuestas: FilaArchivo[]
  notasNuevas: FilaNota[]; rondasNotas: { ronda: number; origen: string; notas: FilaNota[] }[]
  ctx: { crudos: number; notasNuevas: number; notasSinTildar: number; linkEditado: boolean }
  acciones: AccionBoton[]
  /** Qué decir en «Qué sigue» cuando no hay botones (a René en corrección: tildar las notas para que aparezca «Corregido»). */
  queSigue: string | null
  pedidos: VistaPedido[]; esperaTomas: VistaPedido | null
  envio: { tipo: 'regrabar' | 'link_final'; texto: string; constancia: string | null } | null
  okCliente: { quien: string; cuando: string; cita: string } | null
  historial: FilaHistorial[]
  marca: VistaPaleta
  permisos: { notas: boolean; tildar: boolean; pedido: boolean; prioridad: boolean; bloqueo: 'todo' | 'otro' | null; aceptarEditado: boolean; autorizar: boolean; tope: boolean }
}

const PIDE: Partial<Record<AccionVideo, AccionBoton['pide']>> = {
  regrabar: 'motivo', pausa_devolucion: 'nota', pausar: 'nota', descartar: 'nota', reabrir: 'nota', ok_cliente: 'cita', listo: 'link_opcional', para_cliente: 'link',
}
const TONO: Partial<Record<AccionVideo, AccionBoton['tono']>> = {
  sirve: 'primario', listo: 'primario', corregido: 'primario', para_cliente: 'primario', ok_cliente: 'primario', llegaron_crudos: 'primario', pedir_correccion: 'primario',
  descartar: 'peligro', pausar: 'secundario',
}

function textoEvento(e: EventoVideo): string {
  switch (e.tipo) {
    case 'estado': return e.de && e.a ? `${ETIQUETA_ESTADO[e.de]} → ${ETIQUETA_ESTADO[e.a]}` : e.a ? `→ ${ETIQUETA_ESTADO[e.a]}` : 'Cambio de estado'
    case 'crudo_vinculado': return 'Vinculó un crudo'
    case 'editado_vinculado': return 'Vinculó el editado'
    case 'editado_propuesto': return 'El bot propuso un editado'
    case 'nota': return 'Nota de corrección'
    case 'tilde': return 'Tildó una nota'
    case 'envio_cliente': return 'Constancia de envío al cliente'
    case 'prioridad': return 'Cambió la prioridad'
    case 'bloqueo': return 'Bloqueo'
    case 'importado': return 'Importado de ClickUp'
    case 'pedido': return 'Pedido del cliente'
    case 'autorizacion': return 'Tomás autorizó otra ronda'
    case 'creado': return 'Se creó el video'
  }
}
export const quienActor = (a: Actor): string => (a.tipo === 'bot' ? `Bot (${a.proceso})` : nombreVisible(a.nombre) || NOMBRE_ROL[a.rol])

function filaNota(n: NotaVideo, rol: RolEdicion, enCorreccion: boolean): FilaNota {
  return {
    id: n.id, version: n.version, ronda: n.ronda, origen: n.origen === 'cliente' ? 'del cliente' : 'de Aylu', enviada: n.enviada,
    tiempo: n.segundo != null ? `${mmss(n.segundo)}${n.hasta != null ? `–${mmss(n.hasta)}` : ''}` : '', tipo: ETIQUETA_TIPO_NOTA[n.tipo] ?? n.tipo,
    texto: sinMails(n.texto), imagen: soloHttps(n.imagen_url),
    tilde: n.tilde ? { quien: nombreVisible(n.tilde.quien), cuando: fechaHora(n.tilde.cuando) } : null,
    afecta: n.evaluacion ? `${n.evaluacion.afecta_rendimiento ? 'Afecta el rendimiento' : 'No afecta el rendimiento'}${n.evaluacion.motivo ? `: ${n.evaluacion.motivo}` : ''}` : null,
    creadoPor: nombreVisible(n.creado_por),
    puedeEditar: !n.enviada && tienePermiso(rol, 'nota'),
    puedeTildar: n.enviada && enCorreccion && tienePermiso(rol, 'tildar'),
  }
}

const ESTADO_PEDIDO: Record<PedidoCliente['estado'], string> = { propuesto: 'Para confirmar', confirmado: 'Confirmado', espera_tomas: 'Espera el OK de Tomás', autorizado: 'Autorizado por Tomás', descartado: 'Descartado' }
function vistaPedido(p: PedidoCliente): VistaPedido {
  return {
    id: p.id, version: p.version, ronda: p.ronda, estado: ESTADO_PEDIDO[p.estado], claveEstado: p.estado, texto: sinMails(p.texto), creadoPor: nombreVisible(p.creado_por), creado: fechaHora(p.creado),
    propuesta: p.propuesta.map(n => ({ ...n, texto: sinMails(n.texto), cita: sinMails(n.cita), tiempo: n.segundo != null && n.segundo >= 0 ? `${mmss(n.segundo)}${n.hasta != null && n.hasta >= 0 ? `–${mmss(n.hasta)}` : ''}` : '', etiquetaTipo: ETIQUETA_TIPO_NOTA[n.tipo] ?? n.tipo })),
    elegidas: p.elegidas, modelo: p.modelo,
  }
}

export function armarVideo(d: DetalleVideo, marca: FichaMarca | null, textos: { regrabar: string | null; linkFinal: string | null } | null, rol: RolEdicion, ahora: Date = new Date()): VistaVideo {
  const v = d.video
  const claves = new Map([[v.id, claveVisible(v)]])
  const crudosVivos = d.crudos.filter(a => !a.borrado)
  // René ve solo las notas enviadas
  const notas = rol === 'rene' ? d.notas.filter(n => n.enviada) : d.notas
  const ctx = ctxDe(v, crudosVivos.length, d.notas)
  const enCorreccion = v.estado === 'correccion'
  const rondas = new Map<number, FilaNota[]>()
  for (const n of notas.filter(x => x.enviada).sort((a, b) => a.ronda - b.ronda || (a.segundo ?? 0) - (b.segundo ?? 0))) {
    const xs = rondas.get(n.ronda) ?? []
    xs.push(filaNota(n, rol, enCorreccion))
    rondas.set(n.ronda, xs)
  }
  const acciones = accionesPara(rol, v, ctx).filter(a => !ACCIONES_CON_FLUJO.includes(a) && a !== 'regrabar_enviado').map(a => {
    let pide = PIDE[a] ?? null
    if (a === 'corregido' && rol !== 'rene' && ctx.notasSinTildar > 0) pide = 'nota'
    if (a === 'para_cliente' && ctx.linkEditado) pide = null
    if (a === 'listo' && ctx.linkEditado) pide = null
    return { accion: a, etiqueta: a === 'corregido' && rol !== 'rene' && ctx.notasSinTildar > 0 ? 'Corregido (forzar)' : ETIQUETA_ACCION[a], pide, tono: TONO[a] ?? 'secundario' }
  })
  // René no recibe los pedidos del cliente (P6): ni la 3.ª ronda que espera a Tomás, ni los propuestos que Aylu todavía no
  // confirmó, ni los descartados. Lo que le toca le llega como notas enviadas.
  const queSigue = acciones.length ? null
    : rol === 'rene' && v.estado === 'correccion' && ctx.notasSinTildar > 0
      ? `Corregí cada nota y tildala abajo, en «Notas de corrección» (${ctx.notasSinTildar === 1 ? 'queda 1 sin tildar' : `quedan ${ctx.notasSinTildar} sin tildar`}). Con todas tildadas aparece «Corregido».`
      : rol === 'rene' && v.estado === 'para_editar' ? 'Cuando lo termines, marcalo «Listo» (si ya lo subiste a Editados, aceptá el editado que propone el bot).'
        : null
  const pedidos = rol === 'rene' ? [] : [...d.pedidos].sort((a, b) => b.creado.localeCompare(a.creado)).map(vistaPedido)
  const espera = pedidos.find(p => p.claveEstado === 'espera_tomas') ?? null

  // El texto para el cliente: regrabación (en "regrabar") o link final (con el cliente)
  let envio: VistaVideo['envio'] = null
  if (tienePermiso(rol, 'envio')) {
    if (v.estado === 'regrabar') envio = { tipo: 'regrabar', texto: textos?.regrabar ?? textoRegrabarDe(v.cliente, [v], detallesRegrabar(d.eventos)) ?? '', constancia: null }
    else if (v.estado === 'con_cliente' && soloHttps(v.editado?.url)) {
      envio = { tipo: 'link_final', texto: textos?.linkFinal ?? textoLinkFinalDe(v.cliente, [v]) ?? '', constancia: v.envio_link ? `Enviado por ${nombreVisible(v.envio_link.quien)} · ${fechaHora(v.envio_link.cuando)}` : null }
    }
  }
  const editadoArchivo = v.editado?.archivo_id ? d.editados.find(a => a.id === v.editado!.archivo_id) : null

  return {
    id: v.id, version: v.version, id_crm: v.id_crm, cliente: v.cliente, clave: claveVisible(v), hrefCliente: `/clientes/edicion/cliente/${encodeURIComponent(v.id_crm)}`,
    estado: v.estado, etiquetaEstado: ETIQUETA_ESTADO[v.estado], tiempo: tiempoEnEstado(v, ahora), prioridad: v.prioridad,
    bloqueo: v.bloqueo ? { clave: v.bloqueo, texto: ETIQUETA_BLOQUEO[v.bloqueo], motivo: sinMails(v.motivo_bloqueo) } : null,
    rondas: { interna: v.ronda_interna, cliente: v.ronda_cliente, tope: TOPE_RONDAS_CLIENTE, texto: textoRondas(v)?.texto ?? null },
    gancho: v.gancho, guion: v.guion_texto, guionRef: v.guion?.ref ?? null, posibleDuplicado: v.posible_duplicado ?? [],
    crudos: d.crudos.map(a => filaArchivo(a, claves)),
    editado: soloHttps(v.editado?.url) ? { url: soloHttps(v.editado!.url)!, nombre: editadoArchivo?.nombre ?? null } : null,
    propuestas: d.editados.filter(a => !a.video_id && a.propuesta_video_id === v.id && !a.borrado).map(a => filaArchivo(a, claves)),
    notasNuevas: rol === 'rene' ? [] : notas.filter(n => !n.enviada).map(n => filaNota(n, rol, enCorreccion)),
    rondasNotas: [...rondas.entries()].map(([ronda, xs]) => ({ ronda, origen: [...new Set(xs.map(x => x.origen))].join(' y '), notas: xs })),
    ctx, acciones, queSigue, pedidos, esperaTomas: espera, envio,
    okCliente: v.ok_cliente ? { quien: nombreVisible(v.ok_cliente.quien), cuando: fechaHora(v.ok_cliente.cuando), cita: sinMails(v.ok_cliente.cita) } : null,
    historial: [...d.eventos].sort((a, b) => b.cuando.localeCompare(a.cuando)).slice(0, 60).map(e => ({ id: e.id, cuando: fechaHora(e.cuando), quien: quienActor(e.actor), texto: textoEvento(e), nota: sinMails(e.nota ?? '') })),
    marca: vistaPaleta(marca),
    permisos: {
      notas: tienePermiso(rol, 'nota') && !ESTADOS_FINALES.includes(v.estado), tildar: tienePermiso(rol, 'tildar') && enCorreccion,
      pedido: tienePermiso(rol, 'pedido') && v.estado === 'con_cliente', prioridad: tienePermiso(rol, 'prioridad'),
      bloqueo: tienePermiso(rol, 'bloqueo') ? 'todo' : tienePermiso(rol, 'bloqueo_otro') ? 'otro' : null,
      aceptarEditado: tienePermiso(rol, 'aceptar_editado') && (v.estado === 'para_editar' || v.estado === 'correccion'),
      autorizar: tienePermiso(rol, 'autorizar_ronda'), tope: tienePermiso(rol, 'tope'),
    },
  }
}

// ── Grabaciones pendientes (e01) ──
export function etiquetaEscalon(e: PasoSeguimiento['escalon']): string {
  if (e === 'dia0') return 'Día 0 · mensaje con el guion'
  if (e === 'dia2') return 'Día 2 · audio de Gero M'
  if (e === 'dia4') return 'Día 4 · llamada citando el contrato'
  if (e === 'dia9') return 'Día 9 · decide Tomás'
  const n = /^r(\d+)$/.exec(e)?.[1]
  return n ? `Recordatorio ${n}` : e
}
export interface FilaPaso {
  id: number; version: number; escalon: string; claveEscalon: PasoSeguimiento['escalon']; debido: string; vencido: boolean; diasHabiles: number
  videos: number; responsable: string; motivo: string
  texto: TextoCliente | GuiaInterna; textoGuardado: string
  hecho: { quien: string; cuando: string; nota: string } | null
  decision: string | null; frenado: boolean; esDia9: boolean
  /** e01 por WhatsApp: lo manda el bot (la pantalla no ofrece copiarlo) y, si no salió, por qué (para mandarlo a mano). */
  bot: boolean; noSalio: string | null
}
export interface VistaPendientes {
  clientes: { id_crm: IdCrm; cliente: string; href: string; ciclo: string; pasos: FilaPaso[] }[]
  puedeMarcar: boolean; puedeDecidir: boolean; total: number
}
/** Lo que de verdad queda por hacer en Grabaciones pendientes: los pasos abiertos SIN hacer (los hechos se muestran, no cuentan). */
export const pasosPorHacer = (pasos: readonly Pick<PasoSeguimiento, 'estado' | 'hecho'>[]): number => pasos.filter(p => p.estado === 'abierto' && !p.hecho).length

const MOTIVO_CICLO: Record<PasoSeguimiento['motivo'], string> = { para_grabar: 'guiones en «Para grabar»', guiones_enviados: 'guiones enviados', regrabar: 'pedido de regrabación' }

export function armarPendientes(pasos: readonly PasoSeguimiento[], rol: RolEdicion, op: { ahora?: Date; docs?: Map<IdCrm, string | null>; loMandaElBot?: (p: PasoSeguimiento) => boolean } = {}): VistaPendientes {
  const hoy = hoyArgentina(op.ahora ?? new Date())
  const abiertos = pasos.filter(p => p.estado === 'abierto')
  const porCliente = new Map<IdCrm, VistaPendientes['clientes'][number]>()
  for (const p of [...abiertos].sort((a, b) => a.debido.localeCompare(b.debido))) {
    const id = p.id_crm.toUpperCase()
    let c = porCliente.get(id)
    if (!c) { c = { id_crm: id, cliente: p.cliente, href: `/clientes/edicion/cliente/${encodeURIComponent(id)}`, ciclo: p.ciclo, pasos: [] }; porCliente.set(id, c) }
    const texto = textoE01({ paso: p, nombre: nombreDeSaludo(p.cliente), linkGuiones: linkDoc(op.docs?.get(id) ?? null), fechaSugerida: fechaSugeridaE01(hoy), videos: p.videos.length })
    c.pasos.push({
      id: p.id, version: p.version, escalon: etiquetaEscalon(p.escalon), claveEscalon: p.escalon, debido: p.debido, vencido: !p.hecho && p.debido < hoy, diasHabiles: p.dias_habiles,
      videos: p.videos.length, responsable: ETIQUETA_RESPONSABLE[p.responsable], motivo: MOTIVO_CICLO[p.motivo],
      texto, textoGuardado: sinMails(p.texto ?? ''),
      hecho: p.hecho ? { quien: nombreVisible(p.hecho.quien), cuando: fechaHora(p.hecho.cuando), nota: sinMails(p.hecho.nota) } : null,
      decision: p.decision === 'pausar' ? 'Pausar' : p.decision === 'seguir' ? 'Seguir con recordatorios' : null,
      frenado: p.frenado === 'crudos_sin_ubicar', esDia9: p.escalon === 'dia9',
      bot: !!op.loMandaElBot?.(p), noSalio: !p.hecho && (p.texto ?? '').startsWith('No salió por WhatsApp') ? sinMails(p.texto) : null,
    })
  }
  const clientes = [...porCliente.values()].sort((a, b) => a.pasos[0].debido.localeCompare(b.pasos[0].debido) || a.cliente.localeCompare(b.cliente, 'es'))
  return { clientes, puedeMarcar: tienePermiso(rol, 'paso'), puedeDecidir: tienePermiso(rol, 'decidir_paso'), total: pasosPorHacer(abiertos) }
}

// ── Vínculos carpeta ↔ cliente ──
export interface VistaVinculos {
  pendientes: { drive_id: string; nombre: string; link: string; ruta: string; candidatos: { id_crm: IdCrm; nombre: string; puntaje: string }[] }[]
  /** Las ya vinculadas (las del bot primero, para revisar): se pueden corregir desde la pantalla. */
  vinculadas: { drive_id: string; nombre: string; link: string; id_crm: IdCrm; por: string; revisar: boolean }[]
  confirmados: number
  puedeConfirmar: boolean
}
const POR_VINCULO: Record<CarpetaGrabacion['vinculo'], string> = { alta: 'el alta', bot: 'el bot (nombre exacto)', aylu: 'Aylu', tomas: 'Tomás', a_confirmar: '' }
export function armarVinculos(carpetas: readonly CarpetaGrabacion[], rol: RolEdicion): VistaVinculos {
  const raices = carpetas.filter(c => c.tipo !== 'sub' && !c.borrada)
  const vinculadas = raices.filter(c => c.vinculo !== 'a_confirmar' && c.id_crm)
  return {
    pendientes: raices.filter(c => c.vinculo === 'a_confirmar').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(c => ({
      drive_id: c.drive_id, nombre: c.nombre, link: linkCarpeta(c.drive_id), ruta: c.ruta.join(' / '),
      candidatos: [...c.candidatos].sort((a, b) => b.puntaje - a.puntaje).slice(0, 5).map(k => ({ id_crm: k.id_crm.toUpperCase(), nombre: k.nombre, puntaje: `${Math.round(k.puntaje * 100)} %` })),
    })),
    vinculadas: [...vinculadas].sort((a, b) => Number(b.vinculo === 'bot') - Number(a.vinculo === 'bot') || a.nombre.localeCompare(b.nombre, 'es')).map(c => ({
      drive_id: c.drive_id, nombre: c.nombre, link: linkCarpeta(c.drive_id), id_crm: c.id_crm!.toUpperCase(), por: POR_VINCULO[c.vinculo], revisar: c.vinculo === 'bot',
    })),
    confirmados: vinculadas.length,
    puedeConfirmar: tienePermiso(rol, 'vinculo_carpeta'),
  }
}

// ── Avisos (los que no salieron: modo prueba, dudosos y errores) ──
export interface FilaAviso { id: number; tipo: string; canal: string; estado: string; tono: Tono; texto: string; creado: string; error: string }
const ESTADO_AVISO: Record<Aviso['estado'], { texto: string; tono: Tono }> = {
  pendiente: { texto: 'En espera (se agrupa)', tono: 'gris' }, enviando: { texto: 'Saliendo', tono: 'amarillo' }, enviado: { texto: 'Enviado', tono: 'verde' },
  dry: { texto: 'Modo prueba (no salió)', tono: 'gris' }, error: { texto: 'Error', tono: 'rojo' }, dudoso: { texto: 'Dudoso: revisar en Discord', tono: 'amarillo' },
  descartado: { texto: 'Descartado', tono: 'gris' },
}
export function armarAvisos(avisos: readonly Aviso[]): FilaAviso[] {
  return [...avisos].sort((a, b) => b.creado.localeCompare(a.creado)).map(a => ({
    id: a.id, tipo: a.tipo, canal: a.canal === 'ads' ? '#ads' : '#✂️-edicion', estado: ESTADO_AVISO[a.estado].texto, tono: ESTADO_AVISO[a.estado].tono,
    texto: sinMails(a.texto ?? '(se arma al despachar)').replace(/<@!?\d{15,20}>/g, '@…'), creado: fechaHora(a.creado), error: sinMails(a.error ?? '').slice(0, 300),
  }))
}

// ── Último vigía ──
export interface VistaVigia { texto: string; tono: Tono; detalle: string }
/** Verde con menos de 30 minutos; latón con menos de 2 horas; bordó desde 2 horas dentro del horario del vigía (8 a 22). */
export function estadoVigia(c: Corrida | null, ahora: Date): VistaVigia {
  if (!c) return { texto: 'El vigía todavía no corrió', tono: 'gris', detalle: 'Sin corridas registradas: falta el disparador del Puente Drive o el cron diario.' }
  const cuando = c.fin ?? c.inicio
  const min = (ahora.getTime() - Date.parse(cuando)) / 60_000
  const hora = new Date(ahora.getTime() - AR_MS).getUTCHours()
  const enHorario = hora >= HORARIO_VIGIA.desde && hora < HORARIO_VIGIA.hasta
  const tono: Tono = c.estado === 'error' || c.estado === 'colgada' ? 'rojo' : min < 30 ? 'verde' : min < 120 ? 'amarillo' : enHorario ? 'rojo' : 'gris'
  const estado = c.estado === 'corriendo' ? 'corriendo ahora' : c.estado === 'error' ? 'terminó con error' : c.estado === 'colgada' ? 'quedó colgada' : 'ok'
  return {
    texto: `Último vigía ${haceTexto(cuando, ahora)}`, tono,
    detalle: `${c.tipo === 'completa' ? 'Pasada completa' : c.tipo === 'diario' ? 'Diario' : 'Vigía'} (${c.origen}) · ${estado} · ${c.archivos_nuevos} archivo${c.archivos_nuevos === 1 ? '' : 's'} nuevo${c.archivos_nuevos === 1 ? '' : 's'}`,
  }
}

/** ¿El paso de e01 lo puede marcar esta persona? (Aylu y Tomás; Gero M lo hace y Aylu lo anota). */
export const puedeMarcarPaso = (rol: RolEdicion): boolean => tienePermiso(rol, 'paso')
