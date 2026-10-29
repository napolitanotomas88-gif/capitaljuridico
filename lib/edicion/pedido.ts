// ── Lo que manda el navegador a POST /api/edicion: validación ESTRICTA (puro, sirve también en el navegador) ──────────
// Un campo de más, un tipo distinto o un texto largo es un rechazo (422), no un arreglo silencioso. Quién lo hace NO viene
// acá: el rol sale de la sesión (permisos.ts). Cada escritura sobre un video, una nota, un paso o un pedido lleva la
// `version` que vio la persona: si otro lo cambió en el medio, el repositorio no escribe y la API responde 409.
// Los límites los usan también los formularios (maxLength), así el navegador no deja escribir lo que la API rechaza.
import { textoLimpio } from '@/lib/bot/kickoff/revision'
import { ACCIONES_VIDEO, type AccionVideo } from './estados'
import { BLOQUEOS, MOTIVOS_REGRABAR, PRIORIDADES, TIPOS_NOTA, type Bloqueo, type IdCrm, type MotivoRegrabar, type Prioridad, type TipoNota } from './tipos'

// ── Límites ──
export const LARGO_MAX_CUERPO = 8000            // la barrera HTTP corta antes (413)
export const LARGO_NOTA_VIDEO = 1000             // una nota de corrección
export const LARGO_NOTA = 1000                   // la nota de una acción (pausar, descartar, forzar corregido, reabrir)
export const LARGO_CITA = 1000                   // la cita del OK del cliente
export const LARGO_TEXTO_ENVIO = 4000            // el texto que se copió al grupo Contenido
export const LARGO_NOTA_PASO = 280               // la nota de "hecho" de un paso de e01
export const LARGO_MOTIVO_BLOQUEO = 280
export const MIN_MOTIVO_BLOQUEO = 3
export const LARGO_URL = 500
export const LARGO_PEDIDO_CLIENTE = 4000         // lo que pega Aylu del grupo Contenido (f05)
export const MAX_LOTE = 30
export const MAX_SEGUNDO = 3600                  // los editados duran un minuto: una hora es de sobra
export const MAX_ELEGIDAS = 50

/** Transiciones que NO van por `mover`: tienen su propio flujo (pedidos del cliente) o su constancia (envío del regrabar). */
export const TRANSICIONES_CON_FLUJO: readonly AccionVideo[] = ['pedido_cliente', 'autorizar_ronda', 'regrabar_enviado']
/** En lote: el check de la tanda (sirve), René (listo) y el cierre de la tanda (al cliente y el OK del cliente con UNA cita:
 *  así cierra Aylu, 253 de 282 cierres fueron en tanda). */
export const TRANSICIONES_LOTE = ['sirve', 'listo', 'para_cliente', 'ok_cliente'] as const

export interface CambiosNota { segundo?: number | null; hasta?: number | null; tipo?: TipoNota; texto?: string; imagen_url?: string | null }

export type PedidoEdicion =
  | { accion: 'mover'; video_id: number; version: number; transicion: AccionVideo; motivo?: MotivoRegrabar; nota?: string; cita?: string; editado_url?: string }
  | { accion: 'mover_lote'; transicion: (typeof TRANSICIONES_LOTE)[number]; items: { video_id: number; version: number }[]; cita?: string }
  | { accion: 'vincular_archivo'; archivo_id: number; video_id: number | null }
  | { accion: 'aceptar_editado'; archivo_id: number; video_id: number; version: number }
  | { accion: 'nota_crear'; video_id: number; segundo: number | null; hasta: number | null; tipo: TipoNota; texto: string; imagen_url: string | null }
  | { accion: 'nota_editar'; nota_id: number; version: number; cambios: CambiosNota }
  | { accion: 'nota_borrar'; nota_id: number; version: number }
  | { accion: 'nota_tildar'; nota_id: number; version: number; tildada: boolean }
  | { accion: 'envio_registrado'; tipo: 'regrabar' | 'link_final'; texto: string; items: { video_id: number; version: number }[] }
  | { accion: 'prioridad'; video_id: number; version: number; prioridad: Prioridad }
  | { accion: 'bloqueo'; video_id: number; version: number; bloqueo: Bloqueo | null; motivo: string }
  | { accion: 'guiones_enviados'; id_crm: IdCrm; tanda_guion: number }
  | { accion: 'paso_hecho'; paso_id: number; version: number; nota: string; texto: string }
  | { accion: 'paso_decision'; paso_id: number; version: number; decision: 'pausar' | 'seguir' }
  | { accion: 'pedido_confirmar'; pedido_id: number; version: number; elegidas: number[] }
  | { accion: 'pedido_descartar'; pedido_id: number; version: number; nota: string }
  | { accion: 'ronda_autorizar'; pedido_id: number; version: number }
  | { accion: 'marca_guardar'; id_crm: IdCrm; version: number | null; ficha: unknown }
  | { accion: 'vinculo_confirmar'; carpeta_id: string; id_crm: IdCrm }

export type AccionEdicion = PedidoEdicion['accion']

const CAMPOS: Record<AccionEdicion, readonly string[]> = {
  mover: ['accion', 'video_id', 'version', 'transicion', 'motivo', 'nota', 'cita', 'editado_url'],
  mover_lote: ['accion', 'transicion', 'items', 'cita'],
  vincular_archivo: ['accion', 'archivo_id', 'video_id'],
  aceptar_editado: ['accion', 'archivo_id', 'video_id', 'version'],
  nota_crear: ['accion', 'video_id', 'segundo', 'hasta', 'tipo', 'texto', 'imagen_url'],
  nota_editar: ['accion', 'nota_id', 'version', 'cambios'],
  nota_borrar: ['accion', 'nota_id', 'version'],
  nota_tildar: ['accion', 'nota_id', 'version', 'tildada'],
  envio_registrado: ['accion', 'tipo', 'texto', 'items'],
  prioridad: ['accion', 'video_id', 'version', 'prioridad'],
  bloqueo: ['accion', 'video_id', 'version', 'bloqueo', 'motivo'],
  guiones_enviados: ['accion', 'id_crm', 'tanda_guion'],
  paso_hecho: ['accion', 'paso_id', 'version', 'nota', 'texto'],
  paso_decision: ['accion', 'paso_id', 'version', 'decision'],
  pedido_confirmar: ['accion', 'pedido_id', 'version', 'elegidas'],
  pedido_descartar: ['accion', 'pedido_id', 'version', 'nota'],
  ronda_autorizar: ['accion', 'pedido_id', 'version'],
  marca_guardar: ['accion', 'id_crm', 'version', 'ficha'],
  vinculo_confirmar: ['accion', 'carpeta_id', 'id_crm'],
}
export const ACCIONES_EDICION = Object.keys(CAMPOS) as AccionEdicion[]

export type Validacion<T> = { ok: true; pedido: T } | { ok: false; error: string; campo: string }
const mal = (campo: string, error: string): { ok: false; error: string; campo: string } => ({ ok: false, campo, error })

// ── Piezas ──
const RE_ID_CRM = /^[A-Za-z]\d{1,6}$/
const RE_ID_DRIVE = /^[A-Za-z0-9_-]{10,120}$/
export const esId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0
export const esVersion = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
export const idCrmLimpio = (x: unknown): IdCrm | null => (typeof x === 'string' && RE_ID_CRM.test(x.trim()) ? x.trim().toUpperCase() : null)
export const idDriveLimpio = (x: unknown): string | null => (typeof x === 'string' && RE_ID_DRIVE.test(x) ? x : null)
const enLista = <T extends string>(lista: readonly T[], x: unknown): x is T => typeof x === 'string' && (lista as readonly string[]).includes(x)

/** Un link https (sin espacios, sin credenciales en la URL). null = no sirve. */
export function urlHttps(x: unknown, max = LARGO_URL): string | null {
  if (typeof x !== 'string') return null
  const t = x.trim()
  if (!t || t.length > max || /\s/.test(t)) return null
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/** Un segundo del video (mm:ss ya pasado a segundos en el navegador): número de 0 a MAX_SEGUNDO, a la décima. */
function segundoLimpio(x: unknown): number | null | undefined {
  if (x === null) return null
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > MAX_SEGUNDO) return undefined
  return Math.round(x * 10) / 10
}

function itemsLimpios(x: unknown, max: number): { video_id: number; version: number }[] | string {
  if (!Array.isArray(x) || !x.length) return 'Falta la lista de videos.'
  if (x.length > max) return `Son demasiados videos juntos (hasta ${max}).`
  const out: { video_id: number; version: number }[] = []
  const vistos = new Set<number>()
  for (const it of x) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return 'Cada video va como { video_id, version }.'
    const o = it as Record<string, unknown>
    if (Object.keys(o).some(k => k !== 'video_id' && k !== 'version')) return 'Cada video va como { video_id, version }.'
    if (!esId(o.video_id) || !esVersion(o.version)) return 'Hay un video sin id o sin versión.'
    if (vistos.has(o.video_id)) return 'Hay un video repetido.'
    vistos.add(o.video_id)
    out.push({ video_id: o.video_id, version: o.version })
  }
  return out
}

/** Los campos de una nota (crear o editar). `parcial` = editar: solo los que vienen. */
function camposNota(c: Record<string, unknown>, parcial: boolean): CambiosNota | { error: string; campo: string } {
  const out: CambiosNota = {}
  if (!parcial || 'segundo' in c) {
    const s = segundoLimpio(c.segundo ?? null)
    if (s === undefined) return { campo: 'segundo', error: `El segundo tiene que ser un número entre 0 y ${MAX_SEGUNDO} (o vacío).` }
    out.segundo = s
  }
  if (!parcial || 'hasta' in c) {
    const h = segundoLimpio(c.hasta ?? null)
    if (h === undefined) return { campo: 'hasta', error: `"Hasta" tiene que ser un número entre 0 y ${MAX_SEGUNDO} (o vacío).` }
    out.hasta = h
  }
  if (out.hasta != null && (out.segundo == null || out.hasta < out.segundo)) return { campo: 'hasta', error: '"Hasta" va después del segundo de inicio.' }
  if (!parcial || 'tipo' in c) {
    if (!enLista(TIPOS_NOTA, c.tipo)) return { campo: 'tipo', error: 'El tipo de nota no existe.' }
    out.tipo = c.tipo
  }
  if (!parcial || 'texto' in c) {
    const t = textoLimpio(c.texto, LARGO_NOTA_VIDEO, true)
    if (!t) return { campo: 'texto', error: `La nota tiene que tener texto (hasta ${LARGO_NOTA_VIDEO} caracteres).` }
    out.texto = t
  }
  if (!parcial || 'imagen_url' in c) {
    if (c.imagen_url === null || c.imagen_url === undefined || c.imagen_url === '') out.imagen_url = null
    else {
      const u = urlHttps(c.imagen_url)
      if (!u) return { campo: 'imagen_url', error: 'La imagen tiene que ser un link https (o vacío).' }
      out.imagen_url = u
    }
  }
  return out
}

const opcional = (c: Record<string, unknown>, k: string, max: number, multilinea = true): string | undefined | null => {
  if (c[k] === undefined || c[k] === null || c[k] === '') return undefined
  return textoLimpio(c[k], max, multilinea)
}

/**
 * Valida el cuerpo tal cual llega (JSON ya parseado). Estricto: un campo de más, un tipo distinto o un texto largo es un
 * rechazo, no un arreglo silencioso.
 */
export function validarPedido(x: unknown): Validacion<PedidoEdicion> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return mal('cuerpo', 'Se espera un objeto JSON.')
  const c = x as Record<string, unknown>
  if (!enLista(ACCIONES_EDICION, c.accion)) return mal('accion', 'La acción no existe.')
  const accion = c.accion
  const sobra = Object.keys(c).find(k => !CAMPOS[accion].includes(k))
  if (sobra) return mal(sobra.slice(0, 40), `Campo no permitido: ${sobra.slice(0, 40)}.`)

  switch (accion) {
    case 'mover': {
      if (!esId(c.video_id)) return mal('video_id', 'Falta el video.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      if (!enLista(ACCIONES_VIDEO, c.transicion)) return mal('transicion', 'Ese movimiento no existe.')
      if (TRANSICIONES_CON_FLUJO.includes(c.transicion)) return mal('transicion', 'Ese movimiento va por su propio botón (pedido del cliente, autorización o envío del regrabar).')
      const p: Extract<PedidoEdicion, { accion: 'mover' }> = { accion, video_id: c.video_id, version: c.version, transicion: c.transicion }
      if (c.motivo !== undefined && c.motivo !== null) {
        if (!enLista(MOTIVOS_REGRABAR, c.motivo)) return mal('motivo', 'El motivo tiene que ser duro, audio, encuadre, falta_frase u otro.')
        p.motivo = c.motivo
      }
      const nota = opcional(c, 'nota', LARGO_NOTA)
      if (nota === null) return mal('nota', `La nota tiene que ser texto de hasta ${LARGO_NOTA} caracteres.`)
      if (nota) p.nota = nota
      const cita = opcional(c, 'cita', LARGO_CITA)
      if (cita === null) return mal('cita', `La cita tiene que ser texto de hasta ${LARGO_CITA} caracteres.`)
      if (cita) p.cita = cita
      if (c.editado_url !== undefined && c.editado_url !== null && c.editado_url !== '') {
        const u = urlHttps(c.editado_url)
        if (!u) return mal('editado_url', 'El link al editado tiene que ser https (el de Drive).')
        p.editado_url = u
      }
      return { ok: true, pedido: p }
    }
    case 'mover_lote': {
      if (!enLista(TRANSICIONES_LOTE, c.transicion)) return mal('transicion', 'En lote se puede "sirve", "listo", "al cliente" o "el cliente dio el OK".')
      const items = itemsLimpios(c.items, MAX_LOTE)
      if (typeof items === 'string') return mal('items', items)
      const cita = opcional(c, 'cita', LARGO_CITA)
      if (cita === null) return mal('cita', `La cita tiene que ser texto de hasta ${LARGO_CITA} caracteres.`)
      if (c.transicion === 'ok_cliente' && !cita) return mal('cita', 'Pegá el mensaje del cliente con el OK.')
      if (c.transicion !== 'ok_cliente' && cita) return mal('cita', 'La cita va solo con el OK del cliente.')
      return { ok: true, pedido: { accion, transicion: c.transicion, items, ...(cita ? { cita } : {}) } }
    }
    case 'vincular_archivo': {
      if (!esId(c.archivo_id)) return mal('archivo_id', 'Falta el archivo.')
      if (c.video_id !== null && !esId(c.video_id)) return mal('video_id', 'El video no es válido (null = desvincular).')
      return { ok: true, pedido: { accion, archivo_id: c.archivo_id, video_id: c.video_id as number | null } }
    }
    case 'aceptar_editado': {
      if (!esId(c.archivo_id)) return mal('archivo_id', 'Falta el archivo.')
      if (!esId(c.video_id)) return mal('video_id', 'Falta el video.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      return { ok: true, pedido: { accion, archivo_id: c.archivo_id, video_id: c.video_id, version: c.version } }
    }
    case 'nota_crear': {
      if (!esId(c.video_id)) return mal('video_id', 'Falta el video.')
      const n = camposNota(c, false)
      if ('error' in n) return mal(n.campo, n.error)
      return { ok: true, pedido: { accion, video_id: c.video_id, segundo: n.segundo ?? null, hasta: n.hasta ?? null, tipo: n.tipo!, texto: n.texto!, imagen_url: n.imagen_url ?? null } }
    }
    case 'nota_editar': {
      if (!esId(c.nota_id)) return mal('nota_id', 'Falta la nota.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      if (!c.cambios || typeof c.cambios !== 'object' || Array.isArray(c.cambios)) return mal('cambios', 'Faltan los cambios.')
      const cc = c.cambios as Record<string, unknown>
      const extra = Object.keys(cc).find(k => !['segundo', 'hasta', 'tipo', 'texto', 'imagen_url'].includes(k))
      if (extra) return mal(`cambios.${extra.slice(0, 30)}`, `Campo no permitido: ${extra.slice(0, 30)}.`)
      if (!Object.keys(cc).length) return mal('cambios', 'No hay nada para cambiar.')
      const n = camposNota(cc, true)
      if ('error' in n) return mal(`cambios.${n.campo}`, n.error)
      return { ok: true, pedido: { accion, nota_id: c.nota_id, version: c.version, cambios: n } }
    }
    case 'nota_borrar': {
      if (!esId(c.nota_id)) return mal('nota_id', 'Falta la nota.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      return { ok: true, pedido: { accion, nota_id: c.nota_id, version: c.version } }
    }
    case 'nota_tildar': {
      if (!esId(c.nota_id)) return mal('nota_id', 'Falta la nota.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      if (typeof c.tildada !== 'boolean') return mal('tildada', 'Falta decir si queda tildada (true) o no (false).')
      return { ok: true, pedido: { accion, nota_id: c.nota_id, version: c.version, tildada: c.tildada } }
    }
    case 'envio_registrado': {
      if (c.tipo !== 'regrabar' && c.tipo !== 'link_final') return mal('tipo', 'El envío es "regrabar" o "link_final".')
      const texto = textoLimpio(c.texto, LARGO_TEXTO_ENVIO, true)
      if (!texto) return mal('texto', `Falta el texto que se mandó (hasta ${LARGO_TEXTO_ENVIO} caracteres).`)
      const items = itemsLimpios(c.items, MAX_LOTE)
      if (typeof items === 'string') return mal('items', items)
      return { ok: true, pedido: { accion, tipo: c.tipo, texto, items } }
    }
    case 'prioridad': {
      if (!esId(c.video_id)) return mal('video_id', 'Falta el video.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      if (!enLista(PRIORIDADES, c.prioridad)) return mal('prioridad', 'La prioridad es urgente, alta o normal.')
      return { ok: true, pedido: { accion, video_id: c.video_id, version: c.version, prioridad: c.prioridad } }
    }
    case 'bloqueo': {
      if (!esId(c.video_id)) return mal('video_id', 'Falta el video.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      const bloqueo = c.bloqueo ?? null
      if (bloqueo !== null && !enLista(BLOQUEOS, bloqueo)) return mal('bloqueo', 'Ese bloqueo no existe (null = quitarlo).')
      const motivo = textoLimpio(c.motivo ?? '', LARGO_MOTIVO_BLOQUEO)
      if (motivo === null) return mal('motivo', `El motivo tiene que ser texto de hasta ${LARGO_MOTIVO_BLOQUEO} caracteres.`)
      if (bloqueo !== null && motivo.length < MIN_MOTIVO_BLOQUEO) return mal('motivo', 'Escribí el motivo del bloqueo.')
      return { ok: true, pedido: { accion, video_id: c.video_id, version: c.version, bloqueo: bloqueo as Bloqueo | null, motivo } }
    }
    case 'guiones_enviados': {
      const id = idCrmLimpio(c.id_crm)
      if (!id) return mal('id_crm', 'Falta el cliente (id del CRM).')
      if (typeof c.tanda_guion !== 'number' || !Number.isSafeInteger(c.tanda_guion) || c.tanda_guion < 1 || c.tanda_guion > 99) return mal('tanda_guion', 'La tanda del guion es un número de 1 a 99.')
      return { ok: true, pedido: { accion, id_crm: id, tanda_guion: c.tanda_guion } }
    }
    case 'paso_hecho': {
      if (!esId(c.paso_id)) return mal('paso_id', 'Falta el paso.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      const nota = textoLimpio(c.nota ?? '', LARGO_NOTA_PASO)
      if (nota === null) return mal('nota', `La nota tiene que ser texto de hasta ${LARGO_NOTA_PASO} caracteres.`)
      const texto = textoLimpio(c.texto ?? '', LARGO_TEXTO_ENVIO, true)
      if (texto === null) return mal('texto', `El texto tiene que tener hasta ${LARGO_TEXTO_ENVIO} caracteres.`)
      return { ok: true, pedido: { accion, paso_id: c.paso_id, version: c.version, nota, texto } }
    }
    case 'paso_decision': {
      if (!esId(c.paso_id)) return mal('paso_id', 'Falta el paso.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      if (c.decision !== 'pausar' && c.decision !== 'seguir') return mal('decision', 'La decisión es "pausar" o "seguir".')
      return { ok: true, pedido: { accion, paso_id: c.paso_id, version: c.version, decision: c.decision } }
    }
    case 'pedido_confirmar': {
      if (!esId(c.pedido_id)) return mal('pedido_id', 'Falta el pedido.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      if (!Array.isArray(c.elegidas) || c.elegidas.length > MAX_ELEGIDAS) return mal('elegidas', 'Las notas elegidas van como una lista de números.')
      const vistos = new Set<number>()
      for (const n of c.elegidas) {
        if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n >= MAX_ELEGIDAS || vistos.has(n)) return mal('elegidas', 'Hay una nota elegida que no es válida o está repetida.')
        vistos.add(n)
      }
      return { ok: true, pedido: { accion, pedido_id: c.pedido_id, version: c.version, elegidas: [...vistos].sort((a, b) => a - b) } }
    }
    case 'pedido_descartar': {
      if (!esId(c.pedido_id)) return mal('pedido_id', 'Falta el pedido.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      const nota = textoLimpio(c.nota ?? '', LARGO_NOTA)
      if (nota === null) return mal('nota', `La nota tiene que ser texto de hasta ${LARGO_NOTA} caracteres.`)
      return { ok: true, pedido: { accion, pedido_id: c.pedido_id, version: c.version, nota } }
    }
    case 'ronda_autorizar': {
      if (!esId(c.pedido_id)) return mal('pedido_id', 'Falta el pedido.')
      if (!esVersion(c.version)) return mal('version', 'Falta la versión que se vio: recargá la página.')
      return { ok: true, pedido: { accion, pedido_id: c.pedido_id, version: c.version } }
    }
    case 'marca_guardar': {
      const id = idCrmLimpio(c.id_crm)
      if (!id) return mal('id_crm', 'Falta el cliente (id del CRM).')
      const version = c.version ?? null
      if (version !== null && !esVersion(version)) return mal('version', 'La versión de la ficha no es válida (null = crearla).')
      if (!c.ficha || typeof c.ficha !== 'object' || Array.isArray(c.ficha)) return mal('ficha', 'Falta la ficha de marca.')
      return { ok: true, pedido: { accion, id_crm: id, version: version as number | null, ficha: c.ficha } }
    }
    case 'vinculo_confirmar': {
      const carpeta = idDriveLimpio(c.carpeta_id)
      if (!carpeta) return mal('carpeta_id', 'Falta la carpeta de Drive.')
      const id = idCrmLimpio(c.id_crm)
      if (!id) return mal('id_crm', 'Falta el cliente (id del CRM).')
      return { ok: true, pedido: { accion, carpeta_id: carpeta, id_crm: id } }
    }
  }
}

// ── POST /api/edicion/pedido: { video_id, texto, notas? } (lo que pegó Aylu del grupo Contenido) ──
// `notas` (opcional) = las notas cargadas A MANO: si vienen, no se llama a Claude y la propuesta son esas (sin cita: las
// escribió Aylu). Sirve cuando Claude no propuso nada (modo prueba, sin key o el pedido no se entendió).
export const MAX_NOTAS_A_MANO = 30
export interface NotaAMano { texto: string; tipo: TipoNota; segundo: number | null; hasta: number | null; afecta_rendimiento: boolean }
export interface PedidoPropuesta { video_id: number; texto: string; notas?: NotaAMano[] }
export function validarPropuesta(x: unknown): Validacion<PedidoPropuesta> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return mal('cuerpo', 'Se espera un objeto JSON.')
  const c = x as Record<string, unknown>
  const sobra = Object.keys(c).find(k => k !== 'video_id' && k !== 'texto' && k !== 'notas')
  if (sobra) return mal(sobra.slice(0, 40), `Campo no permitido: ${sobra.slice(0, 40)}.`)
  if (!esId(c.video_id)) return mal('video_id', 'Falta el video.')
  const texto = textoLimpio(c.texto, LARGO_PEDIDO_CLIENTE, true)
  if (!texto || texto.length < 3) return mal('texto', `Pegá el pedido del cliente (hasta ${LARGO_PEDIDO_CLIENTE} caracteres).`)
  if (c.notas === undefined || c.notas === null) return { ok: true, pedido: { video_id: c.video_id, texto } }
  if (!Array.isArray(c.notas) || !c.notas.length || c.notas.length > MAX_NOTAS_A_MANO) return mal('notas', `Las notas a mano van como una lista (de 1 a ${MAX_NOTAS_A_MANO}).`)
  const notas: NotaAMano[] = []
  for (const [i, n] of c.notas.entries()) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return mal(`notas.${i}`, 'Cada nota va como un objeto.')
    const o = n as Record<string, unknown>
    const extra = Object.keys(o).find(k => !['texto', 'tipo', 'segundo', 'hasta', 'afecta_rendimiento'].includes(k))
    if (extra) return mal(`notas.${i}.${extra.slice(0, 30)}`, `Campo no permitido: ${extra.slice(0, 30)}.`)
    const campos = camposNota({ texto: o.texto, tipo: o.tipo, segundo: o.segundo ?? null, hasta: o.hasta ?? null, imagen_url: null }, false)
    if ('error' in campos) return mal(`notas.${i}.${campos.campo}`, campos.error)
    if (o.afecta_rendimiento !== undefined && typeof o.afecta_rendimiento !== 'boolean') return mal(`notas.${i}.afecta_rendimiento`, '«Afecta el rendimiento» es sí o no.')
    notas.push({ texto: campos.texto!, tipo: campos.tipo!, segundo: campos.segundo ?? null, hasta: campos.hasta ?? null, afecta_rendimiento: o.afecta_rendimiento === true })
  }
  return { ok: true, pedido: { video_id: c.video_id, texto, notas } }
}

/**
 * "65" → 65 (segundos); "1:05", "1,05" o "1.05" → 65 (minutos y segundos: el teclado numérico del celular no tiene «:»);
 * "1:05.5" → 65,5; "" → null; algo que no se entiende ("1,5", "1:75") → undefined. Lo usan los formularios de notas.
 */
export function leerTiempo(t: string): number | null | undefined {
  const s = t.trim()
  if (!s) return null
  let total: number
  const ms = /^(\d{1,2})[:.,](\d{2})(?:[.,](\d))?$/.exec(s)
  if (ms) {
    const seg = Number(ms[2])
    if (seg >= 60) return undefined
    total = Number(ms[1]) * 60 + seg + (ms[3] ? Number(ms[3]) / 10 : 0)
  } else if (/^\d{1,4}$/.test(s)) total = Number(s)
  else return undefined
  return total <= MAX_SEGUNDO ? total : undefined
}

/** 65 → "1:05"; 65.5 → "1:05.5". */
export function mmss(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return ''
  const entero = Math.floor(s)
  const dec = Math.round((s - entero) * 10)
  return `${Math.floor(entero / 60)}:${String(entero % 60).padStart(2, '0')}${dec ? `.${dec}` : ''}`
}
