// ── Bot "Capital Jurídico": CONTRATO entre el webhook de Whapi (BLOQUE W) y el orquestador de altas (BLOQUE O) ─────────
// Contrato del día 0 (diseño del motor, sección 2). Solo tipos y constantes: ninguno de los dos bloques mete lógica acá.
//   · W clasifica cada mensaje de Whapi en un EventoBot (función pura) y llama a MotorAltas.registrar / procesar.
//   · O implementa MotorAltas (lib/bot/alta/motor/index.ts) y usa ClienteWhapi para mandar mensajes y armar la comunidad.
// Cambios pedidos por la revisión del diseño (todos ADITIVOS: lo que W escriba según el diseño original sigue compilando):
//   · EnvioWhapi.id puede venir en null: en la referencia de Whapi, `SentMessage.message` (con el id) es opcional (punto 6).
//   · EventoEco: el eco `from_me: true` con `source: 'api'` de un mensaje del propio bot. Sirve para confirmar un envío
//     dudoso y recuperar su id (mismo chat y mismo texto, dentro de 10 min). W lo emite; O lo usa (punto 6).
//   · EventoEdicion: `mensajeId` es el mensaje EDITADO (action.target / before_update.id) y la clave de repetido es
//     `ed:<target>:<sha256 del texto nuevo>`, así la misma edición que llega por los dos caminos (type 'action' y
//     messages.patch) se procesa una sola vez (punto 8).
//   · GrupoWhapi.generalChat: WhatsApp puede crear el grupo "General" de la comunidad solo (properties.general_chat en
//     GET /communities/{id}/subgroups); O lo usa en vez de crear otro (punto 4).
//   · ClienteWhapi.buscarComunidades: GET /communities filtrado por nombre exacto y creadas después de una hora, para
//     reconocer una comunidad que pudo haberse creado en un intento sin respuesta (GET /groups no filtra, punto 5).
//   · ResultadoRegistro.ignorados y MotorAltas.responder (ruta manual del motor, punto 19): opcionales.
// Cambios de la revisión del 24/10 (también aditivos): EventoEco.grupo puede ser null (eco del grupo General de un cliente)
// y enviarVideo acepta `hasta`.
import type { Capacidad, ModoMotor } from './modo'

export const PASOS = ['validar', 'finanzas', 'crm', 'drive', 'comunidad', 'bienvenida', 'skool', 'contrato'] as const
export type PasoId = (typeof PASOS)[number]
// "saludos" no es un paso del motor: es la checklist de la pantalla del Despacho.

export type GrupoBot = 'ventas' | 'verificaciones'
export interface ConfigGrupos { ventas: string; verificaciones: string }   // chat_id "…@g.us"

export interface AutorWhapi {
  telefono: string | null   // solo dígitos con país; null si Whapi mandó solo un @lid
  lid: string | null        // "…@lid", tal cual
  nombre: string | null     // from_name: lo que se ve en WhatsApp; no sirve para autorizar
}
export interface Citado { id: string; autor: string | null }

export interface RefMedio {
  id: string                       // image.id / document.id (para GET /media/{id})
  tipo: 'image' | 'document'
  mime: string
  tamano: number | null
  sha256Whapi: string | null       // formato no documentado: solo informativo
  nombreArchivo: string | null
  link: string | null              // solo con auto_download (la revisión pide no activarlo: punto 29)
  paginas: number | null
  pie: string | null               // caption
  /** Lo pone el motor (no W): el archivo llegó sin citar y sin #ALTA, y el bot eligió el alta. Con esto el ordenante del
   *  comprobante se compara con el cliente (revisión del 24/10, ronda 2). */
  sinCitar?: boolean
}

interface EventoBase {
  clave: string          // dedupe: id del mensaje; en una edición, `ed:<target>:<sha256 del texto>`
  mensajeId: string      // id de WhatsApp (el que se cita con `quoted`); en una edición, el mensaje editado
  chatId: string
  grupo: GrupoBot
  autor: AutorWhapi
  enviadoEn: string      // ISO, del `timestamp` de Whapi
  recibidoEn: string     // ISO, al llegar el webhook
  citado: Citado | null  // context.quoted_id / quoted_author
}
/** #ALTA en Ventas C.J. Si vino como pie de una imagen o un PDF, `medios` lo trae.
 *  `libre` (26/10/2026, aditivo): un alta en formato libre, SIN #ALTA, que W reconoció por los datos (nombre, contacto y
 *  pago: lib/bot/alta/altaLibre.ts). O no hace nada sin el OK de Verificaciones C.J. */
export interface EventoAlta extends EventoBase { tipo: 'alta'; grupo: 'ventas'; texto: string; medios: RefMedio[]; libre?: boolean }
/** Imagen o PDF en Ventas sin #ALTA (comprobante suelto, o una foto de un álbum). */
export interface EventoAdjunto extends EventoBase { tipo: 'adjunto'; grupo: 'ventas'; medios: RefMedio[]; albumEsperado: number | null }
export type Veredicto = { tipo: 'ok'; resto: string } | { tipo: 'no'; motivo: string }
/** Texto sin #ALTA en cualquiera de los dos grupos. El veredicto ya viene leído; si importa o no lo decide O. */
export interface EventoRespuesta extends EventoBase { tipo: 'respuesta'; texto: string; veredicto: Veredicto | null }
/** Edición de un mensaje (type 'action' con action.type 'edit' | 'edited', o messages.patch con after_update).
 *  `mensajeId` = el mensaje editado. Si la forma no se reconoce, no se emite. */
export interface EventoEdicion extends EventoBase { tipo: 'edicion'; grupo: 'ventas'; texto: string }
/** Eco de un mensaje que mandó el propio bot por la API (from_me: true, source: 'api'). `texto` = body o caption.
 *  `grupo` es null cuando el eco viene de otro chat (el grupo General de un cliente: la bienvenida). Revisión del 24/10:
 *  antes W solo dejaba pasar los ecos de Ventas y Verificaciones, y una bienvenida dudosa nunca se confirmaba sola. */
export interface EventoEco extends Omit<EventoBase, 'grupo'> { tipo: 'eco'; grupo: GrupoBot | null; texto: string }
/** WhatsApp seguro (26/10/2026, aditivo): alguien entró a un grupo que NO es Ventas ni Verificaciones (webhook
 *  groups_participants, acción add / join). El orquestador lo usa para saber que el cliente entró al General por el link y
 *  mandar la bienvenida sin esperar el OK de Aylu. `participantes`: teléfonos (solo dígitos) o "…@lid" tal cual.
 *  `chatId` es el grupo; `mensajeId` = `clave` (no hay mensaje); autor vacío. */
export interface EventoIngreso extends Omit<EventoBase, 'grupo'> { tipo: 'ingreso'; grupo: null; participantes: string[]; accion: string }
export type EventoBot = EventoAlta | EventoAdjunto | EventoRespuesta | EventoEdicion | EventoEco | EventoIngreso

// ── Cliente de Whapi (lo implementa W; O solo depende de esta interfaz) ──
/** id: null si Whapi respondió `sent: true` sin el mensaje (la referencia lo deja opcional): lo recupera el eco. */
export interface EnvioWhapi { id: string | null; simulado: boolean }
export interface GrupoWhapi {
  id: string
  nombre: string | null
  codigoInvitacion: string | null
  generalChat?: boolean            // properties.general_chat del subgrupo
  creadoEn?: string | null         // ISO, si Whapi lo devuelve (creationTime)
}
export interface ResultadoParticipantes { agregados: string[]; fallidos: string[] }
/** Un participante de un grupo (GET /groups/{id}): teléfono o @lid, y su rango en el grupo. Lo usa la etapa Bajas. */
export interface ParticipanteGrupo { id: string; rango: 'creador' | 'admin' | 'miembro' }
/** Resultado de quitar participantes (DELETE /groups/{id}/participants): mismo criterio que ResultadoParticipantes. */
export interface ResultadoQuitar { quitados: string[]; fallidos: string[] }
export type FotoGrupo = { url: string } | { base64: string; mime: 'image/jpeg' | 'image/png' }
export interface MedioDescargado { base64: string; mime: string; nombre: string; bytes: number; sha256: string }
export interface LlamadaWhapi { metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; ruta: string; resumen: string; simulada: boolean; en: string }

/** aplicado: true = se hizo · false = seguro que no se hizo · null = no se sabe (5xx, corte, 524). Igual que en ErrorPuente. */
export type TipoErrorWhapi =
  | 'config'      // falta el token, chat inválido, id "seco-…" en real
  | 'bloqueado'   // la compuerta lo frenó por el modo (nunca salió)
  | 'auth'        // 401: la sesión del número se cayó
  | 'limite'      // 402: límite del sandbox
  | 'soft_ban'    // 429: dejar descansar el número
  | 'prohibido'   // 403
  | 'ya_existe'   // 409 (participante ya agregado)
  | 'no_encontrado' // 404
  | 'rechazo'     // 400/413
  | 'pasajero'    // 5xx o red, en una lectura
  | 'dudoso'      // 5xx, red, corte o 524 en una ESCRITURA (pudo haberse hecho)
  | 'sin_numero'  // WhatsApp seguro (26/10/2026): la guardia de salud frenó la escritura (número desconectado o suspendido, o
                  // /health sin respuesta). Nunca salió (aplicado: false): se reintenta cuando el número vuelva a AUTH
/** WhatsApp seguro (26/10/2026): el motivo con que queda en reintento todo lo que la guardia de salud frenó. */
export const MOTIVO_SIN_NUMERO = 'número del bot desconectado o suspendido'
export interface ErrorWhapiForma extends Error { name: 'ErrorWhapi'; tipo: TipoErrorWhapi; status: number | null; aplicado: boolean | null }

export interface ClienteWhapi {
  readonly modo: 'real' | 'seco' | 'juguete'
  /** Las menciones exigen además "@<número>" en el texto (lo arma quien llama). */
  enviarTexto(p: { chatId: string; texto: string; citar?: string | null; menciones?: string[] }): Promise<EnvioWhapi>
  /** Video por URL directa con pie (no_encode: true). Hasta 110 s; un 524 sale como 'dudoso'. `hasta` (ms): plazo de la
   *  invocación para la subida y el envío juntos (revisión del 24/10: sin plazo podían sumar 230 s). */
  enviarVideo(p: { chatId: string; url: string; pie?: string | null; citar?: string | null; hasta?: number }): Promise<EnvioWhapi>
  descargarMedio(m: RefMedio, op?: { maxBytes?: number; hasta?: number }): Promise<MedioDescargado>
  crearComunidad(p: { nombre: string; descripcion: string }): Promise<GrupoWhapi>
  subgruposComunidad(comunidadId: string): Promise<{ avisos: GrupoWhapi | null; otros: GrupoWhapi[] }>
  /** Los fallidos se calculan comparando los pedidos con los participants que devuelve Whapi (Group no trae `failed`). */
  crearGrupoEnComunidad(p: { comunidadId: string; nombre: string; participantes: string[] }): Promise<GrupoWhapi & ResultadoParticipantes>
  agregarParticipantes(p: { grupoId: string; participantes: string[]; esComunidad?: boolean }): Promise<ResultadoParticipantes>
  ponerFoto(p: { grupoId: string; foto: FotoGrupo }): Promise<void>
  cambiarInfoGrupo(p: { grupoId: string; nombre?: string; descripcion?: string }): Promise<void>
  /** https://chat.whatsapp.com/<invite_code> (el formato se deduce; la ficha no lo documenta). */
  linkInvitacion(grupoId: string): Promise<string>
  verificarNumeros(numeros: string[]): Promise<Record<string, 'valido' | 'invalido'>>
  agendarContacto(p: { telefono: string; nombre: string }): Promise<void>
  /** Opcional: GET /groups filtrado por nombre exacto (sin documentar en la ficha; se prueba en el sandbox). */
  buscarGrupoPorNombre?(nombre: string): Promise<GrupoWhapi[]>
  /** Opcional: GET /communities (paginado) con subject exacto y creadas después de `desde` (ISO). */
  buscarComunidades?(p: { nombre: string; desde: string }): Promise<GrupoWhapi[]>
  /** Opcional (etapa Bajas, solo el cliente real): GET /groups/{id} → los participantes con su rango. */
  participantesGrupo?(grupoId: string): Promise<ParticipanteGrupo[]>
  /** Opcional (etapa Bajas, solo el cliente real): DELETE /groups/{id}/participants. Escritura: nunca se reintenta. */
  quitarParticipantes?(p: { grupoId: string; participantes: string[] }): Promise<ResultadoQuitar>
  /** Opcional (etapa Bajas, solo el cliente real): DELETE /communities/{id} ("Deactivate community"). Escritura: nunca se reintenta. */
  eliminarComunidad?(comunidadId: string): Promise<void>
  /** Lo que hizo (real) o haría (seco/juguete). Sin token y sin cuerpos completos (los textos, recortados a 120 caracteres). */
  registro(): readonly LlamadaWhapi[]
}
export type ClienteWhapiDesdeEntorno = (op: { modo: ModoMotor; capacidades: ReadonlySet<Capacidad>; grupos: ConfigGrupos }) => ClienteWhapi

// ── Motor (lo implementa O; la ruta de W lo usa) ──
/** nuevos: los eventos insertados ahora MÁS los que ya estaban y siguen sin procesar (un envío de Whapi a medias que se
 *  reintenta, punto 13). ignorados: claves que no se guardan (charla de Ventas, respuestas sin cita en Verificaciones…). */
export interface ResultadoRegistro { nuevos: EventoBot[]; repetidos: string[]; ignorados?: string[] }
export interface ResumenProceso { altas: string[]; continuaciones: number; errores: string[]; registro: string[] }
export interface MotorAltas {
  readonly modo: ModoMotor
  /** Solo Neon, sin repetir por `clave`. Tiene que tardar menos de 8 s; si falla, TIRA y la ruta responde 503. */
  registrar(eventos: EventoBot[]): Promise<ResultadoRegistro>
  /** Trabajo largo (en after()). Nunca tira: los errores van en el resumen y en cj_altas. Con una lista vacía hace igual
   *  el barrido oportunista (recordatorios, vencimientos, altas con hora vencida): la ruta de W lo llama aunque el
   *  webhook no traiga eventos (punto 22). */
  procesar(eventos: EventoBot[], op: { hasta: number; invocacion: string }): Promise<ResumenProceso>
  avanzar(altaId: string, op: { hasta: number; invocacion: string; cadena?: number; noAntesDe?: string; forzarPaso?: PasoId }): Promise<ResumenProceso>
  barrer(op: { hasta: number; invocacion: string; limite?: number }): Promise<ResumenProceso>
  /** Ruta manual (Bearer CRON_SECRET): responde una espera sin cita. Para probar los pasos humanos en seco y para
   *  destrabar en real si se perdió la cita. */
  responder?(altaId: string, r: { esperaId: string; texto: string; por: string }, op: { hasta: number; invocacion: string }): Promise<ResumenProceso>
}
export interface DepsMotorBase { whapi: ClienteWhapi; modo: ModoMotor; capacidades: ReadonlySet<Capacidad>; grupos: ConfigGrupos; ahora?: () => number }
export type CrearMotorAltas = (deps: DepsMotorBase) => MotorAltas

export const PLAZO_INVOCACION_MS = 285_000   // de los 300 s de maxDuration
