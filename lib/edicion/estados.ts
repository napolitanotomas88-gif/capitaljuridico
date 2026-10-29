// ── Máquina de estados del video (pura: la usan el repositorio, la API de la pantalla, los pedidos y los tests) ─────────
// Una sola tabla de transiciones (TRANSICIONES) con quién puede mover cada una y qué hace falta. Una acción puede tener
// más de una fila (reabrir: desde aprobado va a con_cliente; desde descartado, al estado previo; corregido: René con todas
// las notas tildadas, Aylu y Tomás pueden forzar con una nota). `lector` no mueve nada; el bot solo `llegaron_crudos` y
// `descartar` un video que espera crudos (lo usa únicamente procesarDoc cuando el vínculo de la carpeta se corrigió).
// Efectos que NO son de estado y aplica el repositorio (db/videos.ts → moverVideo):
//   · listo sin link al editado → el video pasa igual a editado con el bloqueo `sin_link_editado` (se limpia solo al
//     vincular un editado);
//   · pedir_correccion → ronda_interna + 1 y las notas nuevas pasan a enviadas (desde con_cliente también: un error de Aylu
//     no gasta una ronda del cliente);
//   · salir de con_cliente a corrección (pedir_correccion, pedido_cliente, autorizar_ronda) borra la constancia del link
//     final: el cliente tiene que recibir el link de la versión corregida (la constancia vieja queda en el historial);
//   · pedido_cliente / autorizar_ronda → ronda_cliente + 1 y las notas nuevas pasan a enviadas; autorizar saca el bloqueo;
//   · pausar, pausa_devolucion y descartar guardan estado_previo (reanudar y reabrir desde descartado vuelven ahí).
// P6 (tope de 2 rondas del cliente, INTERNO): si la ronda pasaría de TOPE_RONDAS_CLIENTE y quien confirma no es Tomás,
// pedido_cliente NO tiene transición (motivo `tope`): el pedido queda en espera_tomas con el bloqueo tope_rondas_cliente
// (lo hace aplicarPedidoCliente). Al cliente nunca se le dice que no en automático.
import type { EstadoVideo, MotivoRegrabar, RolEdicion, Video } from './tipos'
import { ESTADOS_FINALES, MOTIVOS_REGRABAR } from './tipos'

export const ACCIONES_VIDEO = ['llegaron_crudos', 'sirve', 'regrabar', 'pausa_devolucion', 'regrabar_enviado', 'devolver', 'listo',
  'pedir_correccion', 'corregido', 'para_cliente', 'pedido_cliente', 'autorizar_ronda', 'ok_cliente',
  'pausar', 'reanudar', 'descartar', 'reabrir'] as const
export type AccionVideo = (typeof ACCIONES_VIDEO)[number]
export type Requisito = 'crudo_vinculado' | 'motivo' | 'nota' | 'notas_nuevas' | 'notas_tildadas' | 'link_editado' | 'cita' | 'bajo_tope'
export interface Transicion {
  accion: AccionVideo; de: readonly EstadoVideo[]; a: EstadoVideo | 'previo'
  quien: readonly (Exclude<RolEdicion, 'lector'> | 'bot')[]; requiere: readonly Requisito[]
}
export interface ContextoTransicion {
  crudos: number; notasNuevas: number; notasSinTildar: number; linkEditado: boolean
  motivo?: MotivoRegrabar; nota?: string; cita?: string
}
export const TOPE_RONDAS_CLIENTE = 2

const NO_FINALES_NI_PAUSA: readonly EstadoVideo[] = ['esperando_crudos', 'crudo_a_revisar', 'regrabar', 'para_editar', 'editado',
  'correccion', 'corregido', 'con_cliente']
const NO_FINALES: readonly EstadoVideo[] = [...NO_FINALES_NI_PAUSA, 'pausado']
const EQUIPO = ['aylu', 'tomas'] as const

export const TRANSICIONES: readonly Transicion[] = [
  { accion: 'llegaron_crudos', de: ['esperando_crudos', 'regrabar'], a: 'crudo_a_revisar', quien: ['bot', ...EQUIPO], requiere: ['crudo_vinculado'] },
  { accion: 'sirve', de: ['crudo_a_revisar'], a: 'para_editar', quien: EQUIPO, requiere: ['crudo_vinculado'] },
  { accion: 'regrabar', de: ['crudo_a_revisar'], a: 'regrabar', quien: EQUIPO, requiere: ['motivo'] },
  { accion: 'pausa_devolucion', de: ['crudo_a_revisar'], a: 'pausado', quien: EQUIPO, requiere: ['nota'] },
  { accion: 'regrabar_enviado', de: ['regrabar'], a: 'esperando_crudos', quien: EQUIPO, requiere: [] },
  { accion: 'devolver', de: ['para_editar'], a: 'crudo_a_revisar', quien: EQUIPO, requiere: [] },
  { accion: 'listo', de: ['para_editar'], a: 'editado', quien: ['rene', ...EQUIPO], requiere: [] },
  // También con el video ya mandado al cliente: si Aylu encuentra un error propio, no lo carga como pedido del cliente (le
  // gastaría una ronda del tope de P6)
  { accion: 'pedir_correccion', de: ['editado', 'corregido', 'con_cliente'], a: 'correccion', quien: EQUIPO, requiere: ['notas_nuevas'] },
  { accion: 'corregido', de: ['correccion'], a: 'corregido', quien: ['rene'], requiere: ['notas_tildadas'] },
  { accion: 'corregido', de: ['correccion'], a: 'corregido', quien: EQUIPO, requiere: ['notas_tildadas'] },   // forzar: con nota
  { accion: 'para_cliente', de: ['editado', 'corregido'], a: 'con_cliente', quien: EQUIPO, requiere: ['link_editado'] },
  { accion: 'pedido_cliente', de: ['con_cliente'], a: 'correccion', quien: EQUIPO, requiere: ['notas_nuevas', 'bajo_tope'] },
  { accion: 'autorizar_ronda', de: ['con_cliente'], a: 'correccion', quien: ['tomas'], requiere: [] },
  { accion: 'ok_cliente', de: ['con_cliente'], a: 'aprobado', quien: EQUIPO, requiere: ['cita'] },
  { accion: 'pausar', de: NO_FINALES_NI_PAUSA, a: 'pausado', quien: EQUIPO, requiere: ['nota'] },
  { accion: 'reanudar', de: ['pausado'], a: 'previo', quien: EQUIPO, requiere: [] },
  { accion: 'descartar', de: NO_FINALES, a: 'descartado', quien: EQUIPO, requiere: ['nota'] },
  // El bot solo descarta lo que espera crudos y salió del doc de una carpeta que se corrigió a otro cliente (procesarDoc)
  { accion: 'descartar', de: ['esperando_crudos'], a: 'descartado', quien: ['bot'], requiere: ['nota'] },
  { accion: 'reabrir', de: ['aprobado'], a: 'con_cliente', quien: ['tomas'], requiere: ['nota'] },
  { accion: 'reabrir', de: ['descartado'], a: 'previo', quien: ['tomas'], requiere: ['nota'] },
]

/** Acciones que guardan el estado de antes en estado_previo. */
export const GUARDAN_PREVIO: readonly AccionVideo[] = ['pausar', 'pausa_devolucion', 'descartar']
/** Acciones que tienen su propio flujo (pedidos del cliente): no salen como botón en accionesPara. */
export const ACCIONES_CON_FLUJO: readonly AccionVideo[] = ['pedido_cliente', 'autorizar_ronda']

export const esAccion = (x: unknown): x is AccionVideo => typeof x === 'string' && (ACCIONES_VIDEO as readonly string[]).includes(x)
const conTexto = (s: string | undefined): boolean => typeof s === 'string' && s.trim().length > 0

/** A dónde vuelve un `previo`: el guardado, si es un estado al que se puede volver; si no, esperando_crudos. */
export function destinoPrevio(previo: EstadoVideo | null): EstadoVideo {
  return previo && previo !== 'pausado' && previo !== 'descartado' && !ESTADOS_FINALES.includes(previo) ? previo : 'esperando_crudos'
}

/** El estado_previo que guarda una acción de GUARDAN_PREVIO (descartar un pausado conserva el de antes de la pausa). */
export function previoAGuardar(v: Pick<Video, 'estado' | 'estado_previo'>): EstadoVideo {
  return v.estado === 'pausado' ? destinoPrevio(v.estado_previo) : v.estado
}

/** ¿La próxima ronda del cliente pasaría el tope? (P6: solo Tomás la puede confirmar). */
export const pasaTope = (rondaCliente: number): boolean => rondaCliente + 1 > TOPE_RONDAS_CLIENTE

function faltaRequisito(r: Requisito, rol: RolEdicion | 'bot', v: Pick<Video, 'ronda_cliente'>, ctx: ContextoTransicion): string | null {
  switch (r) {
    case 'crudo_vinculado': return ctx.crudos > 0 ? null : 'el video no tiene crudos vinculados'
    case 'motivo': return ctx.motivo && MOTIVOS_REGRABAR.includes(ctx.motivo) ? null : 'falta el motivo (duro, audio, encuadre, falta_frase u otro)'
    case 'nota': return conTexto(ctx.nota) ? null : 'falta la nota'
    case 'notas_nuevas': return ctx.notasNuevas > 0 ? null : 'no hay notas nuevas para mandar'
    case 'notas_tildadas':
      if (ctx.notasSinTildar === 0) return null
      if ((rol === 'aylu' || rol === 'tomas') && conTexto(ctx.nota)) return null     // forzar con nota
      return rol === 'rene' ? `quedan ${ctx.notasSinTildar} notas sin tildar` : `quedan ${ctx.notasSinTildar} notas sin tildar (para forzar, dejá una nota)`
    case 'link_editado': return ctx.linkEditado ? null : 'falta el link al editado'
    case 'cita': return conTexto(ctx.cita) ? null : 'falta la cita del mensaje del cliente'
    case 'bajo_tope': return rol === 'tomas' || !pasaTope(v.ronda_cliente) ? null : 'tope'
  }
}

/**
 * ¿Puede `rol` hacer `accion` sobre el video, con este contexto? Devuelve el estado de destino (con `previo` ya resuelto)
 * o el motivo. Motivo `tope` = pedido_cliente que pasaría el tope de rondas (lo maneja aplicarPedidoCliente).
 */
export function puede(rol: RolEdicion | 'bot', accion: AccionVideo, video: Pick<Video, 'estado' | 'estado_previo' | 'bloqueo' | 'ronda_cliente'>,
  ctx: ContextoTransicion): { ok: true; a: EstadoVideo } | { ok: false; motivo: string } {
  if (rol === 'lector') return { ok: false, motivo: 'solo lectura' }
  if (!esAccion(accion)) return { ok: false, motivo: 'acción desconocida' }
  const filas = TRANSICIONES.filter(t => t.accion === accion)
  const porEstado = filas.filter(t => t.de.includes(video.estado))
  if (!porEstado.length) return { ok: false, motivo: `no se puede "${accion}" con el video en ${video.estado}` }
  const mias = porEstado.filter(t => (t.quien as readonly string[]).includes(rol))
  if (!mias.length) return { ok: false, motivo: `"${accion}" no lo puede hacer ${rol === 'bot' ? 'el bot' : rol}` }
  if (accion === 'autorizar_ronda' && video.bloqueo !== 'tope_rondas_cliente') return { ok: false, motivo: 'el video no espera la autorización de una ronda' }
  // P6: con el pedido del cliente esperando a Tomás, las notas sin enviar son las de ESE pedido. Pedir una corrección las
  // mandaba a René y salteaba la decisión de Tomás (revisión de la integración, ronda 3). Primero decide Tomás (autorizar la
  // ronda) o Aylu marca el OK del cliente.
  if (accion === 'pedir_correccion' && video.bloqueo === 'tope_rondas_cliente') return { ok: false, motivo: 'el pedido del cliente espera que Tomás autorice la ronda: primero tiene que decidir él' }
  let ultimo = ''
  for (const t of mias) {
    const falta = t.requiere.map(r => faltaRequisito(r, rol, video, ctx)).find(m => m !== null)
    if (!falta) return { ok: true, a: t.a === 'previo' ? destinoPrevio(video.estado_previo) : t.a }
    ultimo = falta
  }
  return { ok: false, motivo: ultimo }
}

/**
 * Los botones de la pantalla: las acciones que `rol` puede hacer con el video en este estado. Los datos que la persona
 * escribe al tocar el botón (motivo, nota, cita) no cuentan acá; lo que depende del video (crudos, notas, link) sí.
 * pedido_cliente y autorizar_ronda no salen: van por el flujo de los pedidos.
 */
export function accionesPara(rol: RolEdicion, video: Video, ctx: ContextoTransicion): AccionVideo[] {
  if (rol === 'lector') return []
  const conDatos: ContextoTransicion = { ...ctx, motivo: ctx.motivo ?? 'otro', cita: ctx.cita || '·', nota: rol === 'rene' ? ctx.nota : (ctx.nota || '·') }
  const vistas = new Set<AccionVideo>()
  for (const t of TRANSICIONES) {
    if (vistas.has(t.accion) || ACCIONES_CON_FLUJO.includes(t.accion)) continue
    if (puede(rol, t.accion, video, conDatos).ok) vistas.add(t.accion)
  }
  return ACCIONES_VIDEO.filter(a => vistas.has(a))
}
