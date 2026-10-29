// ── De fila de Neon a tipo del contrato (y del actor a columnas) ─────────────────────────────────────────────────
// Lo comparten todos los db/*.ts. Reglas: el mail del actor NUNCA se lee (solo se escribe en cj_video_eventos.actor_email);
// las fechas salen en ISO UTC; los bigint de Neon llegan como texto y se pasan a número.
import type {
  Actor, ArchivoGrabacion, CarpetaGrabacion, DocGuiones, EstadoVideo, EventoVideo, NotaVideo, PasoSeguimiento, PedidoCliente,
  ProcesoBot, RolEdicion, TandaSubida, Video,
} from '../tipos'
import { entero, iso, isoONull, json, lista, num, numeros, txt, txtONull, ymd, type Fila } from './base'

export function aVideo(f: Fila): Video {
  const guionDoc = txtONull(f.guion_doc_id)
  const editadoId = num(f.editado_archivo_id)
  const editadoUrl = txt(f.editado_url)
  const dup = lista(f.posible_duplicado)
  return {
    id: entero(f.id), id_crm: txt(f.id_crm), cliente: txt(f.cliente), clave: txt(f.clave),
    tanda_guion: num(f.tanda_guion), numero: num(f.numero),
    guion: guionDoc ? { doc_id: guionDoc, ref: txt(f.guion_ref), huella: txt(f.guion_huella) } : null,
    guion_texto: txt(f.guion_texto), gancho: txt(f.gancho),
    estado: txt(f.estado) as EstadoVideo, estado_previo: (txtONull(f.estado_previo) as EstadoVideo | null), estado_desde: iso(f.estado_desde),
    prioridad: (txt(f.prioridad) || 'normal') as Video['prioridad'],
    bloqueo: (txtONull(f.bloqueo) as Video['bloqueo']), motivo_bloqueo: txt(f.motivo_bloqueo),
    motivo_regrabar: (txtONull(f.motivo_regrabar) as Video['motivo_regrabar']),
    ronda_interna: entero(f.ronda_interna), ronda_cliente: entero(f.ronda_cliente),
    editado: editadoId !== null || editadoUrl ? { archivo_id: editadoId, url: editadoUrl } : null,
    envio_link: json(f.envio_link, null), ok_cliente: json(f.ok_cliente, null),
    origen: (txt(f.origen) || 'aylu') as Video['origen'], clickup_id: txtONull(f.clickup_id),
    version: entero(f.version, 1), creado: iso(f.creado), actualizado: iso(f.actualizado),
    ...(dup.length ? { posible_duplicado: dup } : {}),
  }
}

/** Columnas del actor para cj_video_eventos (el mail solo acá). */
export function columnasActor(a: Actor): { tipo: string; rol: string; nombre: string; email: string | null } {
  return a.tipo === 'bot'
    ? { tipo: 'bot', rol: a.proceso, nombre: 'bot', email: null }
    : { tipo: 'persona', rol: a.rol, nombre: a.nombre, email: a.email || null }
}
/** Nombre para los campos `quien`, `creado_por`, `actualizado_por` (nunca el mail). */
export const nombreActor = (a: Actor): string => (a.tipo === 'bot' ? `bot (${a.proceso})` : a.nombre)
export const rolActor = (a: Actor): RolEdicion | 'bot' => (a.tipo === 'bot' ? 'bot' : a.rol)

export function aEvento(f: Fila): EventoVideo {
  const tipoActor = txt(f.actor_tipo)
  const actor: Actor = tipoActor === 'bot'
    ? { tipo: 'bot', proceso: (txt(f.actor_rol) || 'vigia') as ProcesoBot }
    : { tipo: 'persona', rol: (txt(f.actor_rol) || 'aylu') as Exclude<RolEdicion, 'lector'>, nombre: txt(f.actor_nombre), email: '' }
  return {
    id: entero(f.id), video_id: entero(f.video_id), id_crm: txt(f.id_crm), cliente: txt(f.cliente), tipo: txt(f.tipo) as EventoVideo['tipo'],
    de: txtONull(f.de) as EstadoVideo | null, a: txtONull(f.a) as EstadoVideo | null, actor,
    nota: txt(f.nota), datos: json(f.datos, {}), cuando: iso(f.cuando),
  }
}

export function aNota(f: Fila): NotaVideo {
  return {
    id: entero(f.id), video_id: entero(f.video_id), ronda: entero(f.ronda), origen: (txt(f.origen) || 'aylu') as NotaVideo['origen'],
    enviada: f.enviada === true, segundo: num(f.segundo), hasta: num(f.hasta), tipo: (txt(f.tipo) || 'otro') as NotaVideo['tipo'],
    texto: txt(f.texto), imagen_url: txtONull(f.imagen_url), tilde: json(f.tilde, null), evaluacion: json(f.evaluacion, null),
    pedido_id: num(f.pedido_id), creado_por: txt(f.creado_por), creado: iso(f.creado), version: entero(f.version, 1),
  }
}

export function aPedido(f: Fila): PedidoCliente {
  return {
    id: entero(f.id), video_id: entero(f.video_id), ronda: entero(f.ronda), texto: txt(f.texto), propuesta: json(f.propuesta, []),
    elegidas: numeros(f.elegidas), estado: (txt(f.estado) || 'propuesto') as PedidoCliente['estado'], modelo: txtONull(f.modelo),
    version_prompt: txtONull(f.version_prompt), creado_por: txt(f.creado_por), creado: iso(f.creado),
    decidido: json(f.decidido, null), version: entero(f.version, 1),
  }
}

export function aArchivo(f: Fila): ArchivoGrabacion {
  return {
    id: entero(f.id), drive_id: txt(f.drive_id), nombre: txt(f.nombre), mime: txt(f.mime), carpeta_id: txt(f.carpeta_id),
    ruta: lista(f.ruta), bytes: num(f.bytes), duracion_ms: num(f.duracion_ms), ancho: num(f.ancho), alto: num(f.alto),
    creado: iso(f.creado_drive), modificado: iso(f.modificado_drive), subio: (txt(f.subio) || 'desconocido') as ArchivoGrabacion['subio'],
    id_crm: txt(f.id_crm), tipo: (txt(f.tipo) || 'crudo') as ArchivoGrabacion['tipo'], tanda_id: num(f.tanda_id),
    inferido: { tanda_guion: num(f.inf_tanda), numero: num(f.inf_numero), por: (txtONull(f.inf_por) as ArchivoGrabacion['inferido']['por']) },
    video_id: num(f.video_id), asignado_por: (txtONull(f.asignado_por) as ArchivoGrabacion['asignado_por']),
    propuesta_video_id: num(f.propuesta_video_id),
    transcripcion: {
      estado: (txt(f.tr_estado) || 'pendiente') as ArchivoGrabacion['transcripcion']['estado'], proveedor_id: txtONull(f.tr_id),
      intentos: entero(f.tr_intentos), motivo: txt(f.tr_motivo),
    },
    borrado: isoONull(f.borrado), visto: iso(f.visto),
  }
}

export function aTanda(f: Fila): TandaSubida {
  return {
    id: entero(f.id), id_crm: txt(f.id_crm), tipo: (txt(f.tipo) || 'crudos') as TandaSubida['tipo'], desde: iso(f.desde), hasta: iso(f.hasta),
    archivos: entero(f.archivos), subio: (txt(f.subio) || 'desconocido') as TandaSubida['subio'], estado: (txt(f.estado) || 'abierta') as TandaSubida['estado'],
    cerrada: isoONull(f.cerrada), resultado: json(f.resultado, null), version: entero(f.version, 1),
  }
}

export function aCarpeta(f: Fila): CarpetaGrabacion {
  return {
    drive_id: txt(f.drive_id), nombre: txt(f.nombre), padre_id: txtONull(f.padre_id), nivel: entero(f.nivel), ruta: lista(f.ruta),
    id_crm: txtONull(f.id_crm), tipo: (txt(f.tipo) || 'sub') as CarpetaGrabacion['tipo'], raiz: (txtONull(f.raiz) as CarpetaGrabacion['raiz']),
    raiz_id: txtONull(f.raiz_id), vinculo: (txt(f.vinculo) || 'a_confirmar') as CarpetaGrabacion['vinculo'], candidatos: json(f.candidatos, []),
    vigilar: f.vigilar === true, creada: isoONull(f.creada), ultimo_archivo: isoONull(f.ultimo_archivo), consultada: isoONull(f.consultada),
    borrada: isoONull(f.borrada),
  }
}

export function aPaso(f: Fila): PasoSeguimiento {
  const frenado = txtONull(f.frenado)
  return {
    id: entero(f.id), id_crm: txt(f.id_crm), cliente: txt(f.cliente), ciclo: ymd(f.ciclo), motivo: txt(f.motivo) as PasoSeguimiento['motivo'],
    escalon: txt(f.escalon) as PasoSeguimiento['escalon'], debido: ymd(f.debido), dias_habiles: entero(f.dias_habiles),
    videos: numeros(f.videos), responsable: txt(f.responsable) as PasoSeguimiento['responsable'], texto: txt(f.texto),
    hecho: json(f.hecho, null), decision: (txtONull(f.decision) as PasoSeguimiento['decision']),
    estado: (txt(f.estado) || 'abierto') as PasoSeguimiento['estado'], version: entero(f.version, 1),
    ...(frenado ? { frenado: frenado as 'crudos_sin_ubicar' } : {}),
    ...(f.decidido ? { decidido: json(f.decidido, null) } : {}),
  }
}

export function aDoc(f: Fila): DocGuiones {
  return {
    id_crm: txt(f.id_crm), doc_id: txt(f.doc_id), modificado: iso(f.modificado), leido: iso(f.leido),
    guiones: json(f.guiones, []), avisos: json(f.avisos, []),
  }
}
