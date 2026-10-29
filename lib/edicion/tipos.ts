// ── Contrato de Grabación (e01–e05) y Edición (f01–f06) en el Despacho ───────────────────────────────────────
// Solo tipos y constantes: sin imports de servidor (lo importan la pantalla, el bot, los avisos y los tests).
// Lo escribe el bloque A el día 0 y después queda CONGELADO: lo que se sume va como campo OPCIONAL (para no romper
// literales de los otros bloques) y nunca se renombra nada. Diseño completo: docs/edicion/MOTOR.md.
// Reglas de datos:
//   · siempre el id del CRM (ID_CLIENTE_VALIDO, en mayúsculas) y el id de Drive, nunca el nombre;
//   · `Iso` es UTC; `Ymd` es la fecha en hora de Argentina (hoyArgentina de lib/clientes/fechas.ts);
//   · ningún mail ni teléfono del CRM o de Drive llega al navegador, a Discord ni a los textos: los mails quedan solo en
//     cj_video_eventos.actor_email (auditoría). Los campos `quien`, `creado_por` y `actualizado_por` guardan el NOMBRE.
//     El guion y la transcripción sí pueden traer el WhatsApp del estudio (el CTA lo lleva): eso no se filtra.
//   · "tanda" son dos cosas: la tanda de SUBIDA (cj_grab_tandas, TandaSubida: un lote de archivos que se cierra a los 45
//     minutos sin archivos nuevos) y la tanda del GUION (tanda_guion: el "TANDA 2°" del doc "Guiones - X").
//   · clave del video: `T{tanda_guion}-V{numero}` (T2-V4) o `CU-<id de ClickUp>` si no se pudo leer; única por cliente.

export type IdCrm = string
export type Iso = string
export type Ymd = string

// ── Video ──────────────────────────────────────────────────────────────────────────────────────────────
export const ESTADOS_VIDEO = ['esperando_crudos', 'crudo_a_revisar', 'regrabar', 'para_editar', 'editado',
  'correccion', 'corregido', 'con_cliente', 'aprobado', 'pausado', 'descartado'] as const
export type EstadoVideo = (typeof ESTADOS_VIDEO)[number]
export const ESTADOS_FINALES: readonly EstadoVideo[] = ['aprobado', 'descartado']
export const ETIQUETA_ESTADO: Record<EstadoVideo, string> = {
  esperando_crudos: 'Esperando crudos',
  crudo_a_revisar: 'Crudo a revisar',
  regrabar: 'Regrabar',
  para_editar: 'Para editar',
  editado: 'Editado',
  correccion: 'Corrección',
  corregido: 'Corregido',
  con_cliente: 'Con el cliente',
  aprobado: 'Aprobado',
  pausado: 'Pausado',
  descartado: 'Descartado',
}

export type RolEdicion = 'aylu' | 'tomas' | 'rene' | 'lector'
export interface Persona { rol: Exclude<RolEdicion, 'lector'>; nombre: string; email: string }
export type ProcesoBot = 'vigia' | 'diario' | 'transcripcion' | 'comparacion' | 'importacion'
export type Actor = ({ tipo: 'persona' } & Persona) | { tipo: 'bot'; proceso: ProcesoBot }

export type Prioridad = 'urgente' | 'alta' | 'normal'
export const PRIORIDADES: readonly Prioridad[] = ['urgente', 'alta', 'normal']
export type MotivoRegrabar = 'duro' | 'audio' | 'encuadre' | 'falta_frase' | 'otro'
export const MOTIVOS_REGRABAR: readonly MotivoRegrabar[] = ['duro', 'audio', 'encuadre', 'falta_frase', 'otro']
export type Bloqueo = 'tope_rondas_cliente' | 'sin_link_editado' | 'crudo_borrado' | 'otro'
export const BLOQUEOS: readonly Bloqueo[] = ['tope_rondas_cliente', 'sin_link_editado', 'crudo_borrado', 'otro']
export type QuienSubio = 'cliente' | 'equipo' | 'desconocido'
export interface Constancia { quien: string; cuando: Iso; texto: string }

export interface Video {
  id: number; id_crm: IdCrm; cliente: string; clave: string
  tanda_guion: number | null; numero: number | null
  guion: { doc_id: string; ref: string; huella: string } | null
  guion_texto: string; gancho: string
  estado: EstadoVideo; estado_previo: EstadoVideo | null; estado_desde: Iso
  prioridad: Prioridad; bloqueo: Bloqueo | null; motivo_bloqueo: string; motivo_regrabar: MotivoRegrabar | null
  ronda_interna: number; ronda_cliente: number
  editado: { archivo_id: number | null; url: string } | null
  envio_link: Constancia | null; ok_cliente: (Constancia & { cita: string }) | null
  origen: 'doc' | 'aylu' | 'clickup'; clickup_id: string | null
  version: number; creado: Iso; actualizado: Iso
  /** Claves CU-… del mismo cliente que pueden ser este mismo video (alta desde el doc con importados sin ubicar). */
  posible_duplicado?: string[]
}

// ── Archivos de Drive ─────────────────────────────────────────────────────────────────────────────────
export type TipoArchivo = 'crudo' | 'editado' | 'marca'
export type EstadoTranscripcion = 'no_aplica' | 'pendiente' | 'enviando' | 'enviada' | 'lista' | 'error' | 'grande' | 'vieja'
export interface ArchivoDrive {           // lo que devuelve el lector de Drive, sin mails
  drive_id: string; nombre: string; mime: string; carpeta_id: string
  ruta: string[]                           // desde "Crudos - X" sin incluirla: ['Tanda 1','Video 4']
  bytes: number | null; duracion_ms: number | null; ancho: number | null; alto: number | null
  creado: Iso; modificado: Iso; subio: QuienSubio
}
export interface ArchivoGrabacion extends ArchivoDrive {
  id: number; id_crm: IdCrm; tipo: TipoArchivo; tanda_id: number | null
  inferido: { tanda_guion: number | null; numero: number | null; por: 'carpeta' | 'nombre' | 'contenido' | null }
  video_id: number | null; asignado_por: 'bot' | RolEdicion | null; propuesta_video_id: number | null
  transcripcion: { estado: EstadoTranscripcion; proveedor_id: string | null; intentos: number; motivo: string }
  borrado: Iso | null; visto: Iso
}
export interface Transcripcion {
  archivo_id: number; proveedor: 'assemblyai'; modelo: string; idioma: string
  texto: string; palabras: [number, number, string][]; duracion_ms: number | null; creado: Iso
}

// ── Carpetas ──────────────────────────────────────────────────────────────────────────────────────────
export type TipoCarpeta = 'cliente' | 'crudos' | 'editados' | 'marca' | 'sub'
export type Vinculo = 'alta' | 'bot' | 'aylu' | 'tomas' | 'a_confirmar'
export interface CarpetaGrabacion {
  drive_id: string; nombre: string; padre_id: string | null; nivel: number; ruta: string[]
  id_crm: IdCrm | null; tipo: TipoCarpeta; raiz: 'crudos' | 'editados' | 'marca' | null; raiz_id: string | null
  vinculo: Vinculo; candidatos: { id_crm: IdCrm; nombre: string; puntaje: number }[]
  vigilar: boolean; creada: Iso | null; ultimo_archivo: Iso | null; consultada: Iso | null; borrada: Iso | null
}

// ── Tandas de subida y comparación con los guiones ─────────────────────────────────────────────────────
export type EstadoTanda = 'abierta' | 'cerrada' | 'comparando' | 'comparada' | 'avisada'
export interface CoberturaGuion {
  guion_ref: string; video_id: number | null; frases: number; presentes: number
  faltan: string[]; dudosas: string[]; mejor_toma: { archivo_id: number; segundo: number } | null
  por: 'cruce' | 'claude'; estado: 'completo' | 'incompleto' | 'sin_transcripcion'
}
export interface ResultadoComparacion {
  version: string; generado: Iso; guiones: CoberturaGuion[]
  sin_ubicar: number[]; sin_transcribir: number[]; tokens: { in: number; out: number } | null
  /** La comparación necesita a Claude y se dejó para el vigía (el webhook no tiene tiempo). */
  pendiente_claude?: string[]
}
export interface TandaSubida {
  id: number; id_crm: IdCrm; tipo: 'crudos' | 'editados'; desde: Iso; hasta: Iso
  archivos: number; subio: QuienSubio | 'mixto'; estado: EstadoTanda; cerrada: Iso | null
  resultado: ResultadoComparacion | null; version: number
}

// ── Doc "Guiones - X" ─────────────────────────────────────────────────────────────────────────────────
export type EstadoGuionDoc = 'no_iniciado' | 'para_grabar' | 'grabado_completo' | 'otro'
export interface GuionDoc {
  ref: string; tanda: number; numero: number; estado_doc: EstadoGuionDoc; titulo: string
  secciones: { hook: string; problema: string; solucion: string; cta: string }; frases: string[]; huella: string
}
export interface DocGuiones { id_crm: IdCrm; doc_id: string; modificado: Iso; leido: Iso; guiones: GuionDoc[]; avisos: string[] }

// ── Notas de corrección ───────────────────────────────────────────────────────────────────────────────
export type OrigenNota = 'aylu' | 'cliente'
export type TipoNota = 'texto' | 'corte' | 'velocidad' | 'broll' | 'titulo' | 'guion' | 'audio' | 'otro'
export const TIPOS_NOTA: readonly TipoNota[] = ['texto', 'corte', 'velocidad', 'broll', 'titulo', 'guion', 'audio', 'otro']
export interface NotaVideo {
  id: number; video_id: number; ronda: number; origen: OrigenNota; enviada: boolean
  segundo: number | null; hasta: number | null; tipo: TipoNota; texto: string; imagen_url: string | null
  tilde: { quien: string; cuando: Iso } | null; evaluacion: { afecta_rendimiento: boolean; motivo: string } | null
  pedido_id: number | null; creado_por: string; creado: Iso; version: number
}

// ── Historial ─────────────────────────────────────────────────────────────────────────────────────────
export type TipoEvento = 'estado' | 'crudo_vinculado' | 'editado_vinculado' | 'editado_propuesto' | 'nota' | 'tilde'
  | 'envio_cliente' | 'prioridad' | 'bloqueo' | 'importado' | 'pedido' | 'autorizacion' | 'creado'
export interface EventoVideo {
  id: number; video_id: number; id_crm: IdCrm; cliente: string; tipo: TipoEvento
  de: EstadoVideo | null; a: EstadoVideo | null; actor: Actor; nota: string; datos: Record<string, unknown>; cuando: Iso
}

// ── Seguimiento e01 (el cliente no graba) ─────────────────────────────────────────────────────────────
export type Escalon = 'dia0' | 'dia2' | 'dia4' | 'dia9' | `r${number}`
export interface PasoSeguimiento {
  id: number; id_crm: IdCrm; cliente: string; ciclo: Ymd
  motivo: 'para_grabar' | 'guiones_enviados' | 'regrabar'; escalon: Escalon; debido: Ymd; dias_habiles: number
  videos: number[]; responsable: 'aylu' | 'gero_m' | 'tomas'; texto: string
  hecho: { quien: string; cuando: Iso; nota: string } | null; decision: 'pausar' | 'seguir' | null
  estado: 'abierto' | 'resuelto' | 'cancelado'; version: number
  /** El escalón no avanza: después del inicio del ciclo llegaron crudos del cliente que siguen sin ubicar (Aylu los ubica). */
  frenado?: 'crudos_sin_ubicar' | null
  /** Quién decidió y cuándo (día 9): los recordatorios cuentan desde esta hora. */
  decidido?: { quien: string; cuando: Iso } | null
}

// ── Ficha de marca (e05) ──────────────────────────────────────────────────────────────────────────────
export type OrigenDato = 'clickup' | 'kickoff' | 'aylu' | 'tomas' | 'cliente'
export interface FichaMarca {
  id_crm: IdCrm; colores: { hex: string; nombre: string }[]; tipografias: string[]
  logo: { url: string; drive_id: string | null } | null; referencia: { url: string; descripcion: string } | null
  carpeta_marca: { id: string; url: string } | null
  fuentes: Partial<Record<'colores' | 'tipografias' | 'logo' | 'referencia', { origen: OrigenDato; quien: string; cuando: Iso }>>
  notas: string; version: number; actualizado: Iso
}

// ── Pedidos del cliente (f05) ─────────────────────────────────────────────────────────────────────────
export type EstadoPedido = 'propuesto' | 'confirmado' | 'espera_tomas' | 'autorizado' | 'descartado'
export interface NotaPropuesta {
  texto: string; tipo: TipoNota; segundo: number | null; hasta: number | null
  afecta_rendimiento: boolean; motivo: string; cita: string
}
export interface PedidoCliente {
  id: number; video_id: number; ronda: number; texto: string; propuesta: NotaPropuesta[]
  elegidas: number[]; estado: EstadoPedido; modelo: string | null; version_prompt: string | null
  creado_por: string; creado: Iso; decidido: { quien: string; cuando: Iso } | null; version: number
}

// ── Avisos de Discord (la cola la maneja el bloque C) ────────────────────────────────────────────────
export type CanalAviso = 'edicion' | 'ads'
export type EstadoAviso = 'pendiente' | 'enviando' | 'enviado' | 'dry' | 'error' | 'dudoso' | 'descartado'
export interface Aviso {
  id: number; clave: string; base: string; tipo: string; canal: CanalAviso; datos: Record<string, unknown>
  texto: string | null; menciones: string[]; estado: EstadoAviso; enviar_despues: Iso; mensaje_id: string | null
  intentos: number; error: string; creado: Iso; enviado: Iso | null
}

// ── Corridas del bot ──────────────────────────────────────────────────────────────────────────────────
export interface Corrida {
  id: number; tipo: 'vigia' | 'completa' | 'diario'; origen: 'puente' | 'cron' | 'manual'
  estado: 'corriendo' | 'ok' | 'error' | 'colgada'; inicio: Iso; fin: Iso | null
  consultas: number; archivos_nuevos: number; tandas_cerradas: number; error: string; resumen: Record<string, unknown>
}

// ── Resumen para la daily ─────────────────────────────────────────────────────────────────────────────
export interface VideoTrabado {
  video_id: number; id_crm: IdCrm; cliente: string; clave: string; estado: EstadoVideo
  desde: Iso; horas: number; habiles: number; quien: 'aylu' | 'rene' | 'cliente'
}
export interface ResumenDaily {
  fecha: Ymd
  escalones: { escalon: Escalon; clientes: { id_crm: IdCrm; cliente: string; dias: number; responsable: PasoSeguimiento['responsable'] }[] }[]
  colas: Partial<Record<EstadoVideo, number>>; trabados: VideoTrabado[]
  cola_rene: { id_crm: IdCrm; cliente: string; videos: number; urgente: boolean }[]
  grabado_sin_crudos: { id_crm: IdCrm; cliente: string; refs: string[] }[]; editados_por_vincular: number
  /** Carpetas con vínculo "a_confirmar" (no procesan nada hasta que Aylu o Tomás las confirmen). */
  vinculos_por_confirmar: number
  /** Crudos que no se van a transcribir solos (plan B), por cliente. */
  sin_transcribir: { id_crm: IdCrm; cliente: string; archivos: number; motivo: 'grande' | 'link_privado' | 'error' }[]
  /** Avisos de los docs de guiones para Aylu: altas frenadas (más de 10 en una pasada), guion cambiado después de grabarse,
   *  posible duplicado de un importado de ClickUp. */
  avisos_guiones?: { id_crm: IdCrm; cliente: string; avisos: string[] }[]
}

// ── Lo que el motor (A) le pasa a los avisos (C), además de los eventos ─────────────────────────────────
export type AvisoMotor =
  | { tipo: 'tanda_crudos'; tanda: TandaSubida; cliente: string; demorada: boolean }
  | { tipo: 'resumen_daily'; resumen: ResumenDaily }
  | { tipo: 'marca_falta'; id_crm: IdCrm; cliente: string; videos: number }
  | { tipo: 'marca_propuesta'; id_crm: IdCrm; cliente: string; archivos: number; archivo: string }
  | { tipo: 'tope_rondas'; video_id: number; id_crm: IdCrm; cliente: string; clave: string; ronda: number; pedido_id: number; numero?: number | null }
  | { tipo: 'error'; proceso: string; motivo: string }
  | { tipo: 'vigia_callado'; desde: Iso; horas: number }
  | { tipo: 'crudo_borrado'; video_id: number; id_crm: IdCrm; cliente: string; clave: string; archivo: string; numero?: number | null }
  | { tipo: 'vinculo_pendiente'; carpeta_id: string; nombre: string; candidatos: { id_crm: IdCrm; nombre: string; puntaje: number }[] }
  | { tipo: 'transcripcion_fallida'; archivo_id: number; id_crm: IdCrm; cliente: string; nombre: string; motivo: 'link_privado' | 'grande' }

export type ResultadoEscritura<T> = { ok: true; actual: T }
  | { ok: false; motivo: 'conflicto' | 'no_existe' | 'no_permitido'; actual: T | null; detalle?: string }
