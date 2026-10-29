// ── Repositorio de videos, eventos y notas (Neon: cj_videos, cj_video_eventos, cj_video_notas) ───────────────────────
// Todo cambio de un video lleva `version` (lo que vio quien escribe) y deja su evento EN LA MISMA SENTENCIA:
//   WITH m AS (UPDATE cj_videos … WHERE id AND version AND estado RETURNING *), [n AS (UPDATE notas …)],
//   e AS (INSERT INTO cj_video_eventos … SELECT … FROM m RETURNING *) SELECT …
// Si no prendió, se distingue `conflicto` (vuelve lo de ahora: el video y su último evento) de `no_existe`.
// moverVideo: lee el contexto (crudos vinculados, notas nuevas, notas sin tildar de la ronda en curso) en una consulta,
// valida con puede() (estados.ts) y escribe. Los efectos que no son de estado están en el encabezado de estados.ts.
// Notas:
//   · nacen con ronda = la próxima (ronda_interna + ronda_cliente + 1) y enviada = false; solo se editan o borran mientras
//     no se enviaron; pedir_correccion / pedido_cliente / autorizar_ronda las marcan enviadas en la misma sentencia;
//   · con el video EN corrección, una nota nueva (de Aylu o del cliente) se suma a la ronda abierta, ya enviada, y no suma
//     ronda (si no, un segundo mensaje del cliente mientras René corrige gastaría una ronda del tope de P6);
//   · tildarNota solo con el video en corrección y sobre notas enviadas.
// Pedidos del cliente (P6) en UNA sentencia cada uno: aplicarPedidoCliente (crea las notas, decide el pedido y mueve o
// bloquea el video), autorizarPedidoCliente (Tomás) y descartarPedidoCliente (saca el bloqueo del tope si esperaba a Tomás).
// Privacidad: el mail del actor se escribe SOLO en cj_video_eventos.actor_email y nunca se lee; `creado_por` y los `quien`
// guardan el nombre. Las lecturas no crean tablas (leer → vacío); las escrituras corren asegurarTablas(). Solo servidor.
import type {
  Actor, ArchivoGrabacion, AvisoMotor, DocGuiones, EstadoVideo, EventoVideo, IdCrm, NotaPropuesta, NotaVideo, OrigenNota, PasoSeguimiento,
  PedidoCliente, Persona, Prioridad, CarpetaGrabacion, ResultadoEscritura, TandaSubida, TipoEvento, TipoNota, Video,
} from '../tipos'
import { BLOQUEOS, ESTADOS_FINALES, ESTADOS_VIDEO, MOTIVOS_REGRABAR, PRIORIDADES, TIPOS_NOTA } from '../tipos'
import { GUARDAN_PREVIO, esAccion, previoAGuardar, puede, type AccionVideo, type ContextoTransicion } from '../estados'
import { ErrorEntradaEdicion, asegurarTablas, consulta, entero, idCrm, idPositivo, leer, type Fila, type Sql } from './base'
import { aArchivo, aCarpeta, aDoc, aEvento, aNota, aPaso, aPedido, aTanda, aVideo, columnasActor, nombreActor, rolActor } from './filas'

const LIMITE_LISTADO = 500
export const LARGO_NOTA = 2_000
export const LARGO_TEXTO_ENVIO = 4_000
export const LARGO_GANCHO = 500

// ── Lecturas ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FiltroVideos { estados?: readonly EstadoVideo[]; id_crm?: IdCrm; ids?: readonly number[]; incluirFinales?: boolean; limite?: number; excluirIds?: readonly string[]; excluirVideos?: readonly number[] }
export interface FilaTablero extends Video { crudos: number; editado_propuesto: boolean; paleta: boolean; notas_abiertas: number }

function aFilaTablero(f: Fila): FilaTablero {
  return { ...aVideo(f), crudos: entero(f.n_crudos), editado_propuesto: f.n_propuestos !== undefined && entero(f.n_propuestos) > 0,
    paleta: f.paleta === true, notas_abiertas: entero(f.n_abiertas) }
}

export async function listarVideos(f: FiltroVideos): Promise<FilaTablero[]> {
  const estados = f.estados?.length ? f.estados.filter(e => (ESTADOS_VIDEO as readonly string[]).includes(e)) : null
  const id = f.id_crm ? idCrm(f.id_crm) : null
  const ids = f.ids?.length ? f.ids.map(Number).filter(n => Number.isSafeInteger(n) && n > 0) : null
  const finales = f.incluirFinales === true || (estados?.some(e => ESTADOS_FINALES.includes(e)) ?? false)
  const excluidos = [...(f.excluirIds ?? [])]
  const limite = Math.max(1, Math.min(LIMITE_LISTADO, Math.trunc(f.limite ?? LIMITE_LISTADO)))
  const filas = await leer('listar videos', [] as Fila[], q => q`SELECT v.*,
      (SELECT count(*) FROM cj_grab_archivos a WHERE a.video_id = v.id AND a.tipo = 'crudo' AND a.borrado IS NULL) AS n_crudos,
      (SELECT count(*) FROM cj_grab_archivos a WHERE a.propuesta_video_id = v.id AND a.video_id IS NULL AND a.borrado IS NULL) AS n_propuestos,
      EXISTS (SELECT 1 FROM cj_marca k WHERE k.id_crm = v.id_crm AND jsonb_array_length(k.colores) > 0) AS paleta,
      (SELECT count(*) FROM cj_video_notas n WHERE n.video_id = v.id AND NOT n.borrada AND n.enviada AND n.tilde IS NULL
        AND n.ronda = v.ronda_interna + v.ronda_cliente) AS n_abiertas
    FROM cj_videos v
    WHERE (${estados}::text[] IS NULL OR v.estado = ANY(${estados}::text[]))
      AND (${id}::text IS NULL OR v.id_crm = ${id})
      AND (${ids}::bigint[] IS NULL OR v.id = ANY(${ids}::bigint[]))
      AND (${finales}::boolean OR v.estado NOT IN ('aprobado', 'descartado'))
      AND NOT (upper(v.id_crm) = ANY(${excluidos}::text[]))
      AND NOT (v.id = ANY(${[...(f.excluirVideos ?? [])]}::bigint[]))
    ORDER BY v.estado_desde, v.id
    LIMIT ${limite}` as Promise<Fila[]>)
  return filas.map(aFilaTablero)
}

export interface DetalleVideo { video: Video; eventos: EventoVideo[]; notas: NotaVideo[]; crudos: ArchivoGrabacion[]; editados: ArchivoGrabacion[]; pedidos: PedidoCliente[] }

async function eventosDe(q: Sql, videoId: number, limite = 200): Promise<EventoVideo[]> {
  const filas = await q`SELECT e.id, e.video_id, e.id_crm, v.cliente, e.tipo, e.de, e.a, e.actor_tipo, e.actor_rol, e.actor_nombre,
      e.nota, e.datos, e.cuando
    FROM cj_video_eventos e JOIN cj_videos v ON v.id = e.video_id
    WHERE e.video_id = ${videoId} ORDER BY e.cuando, e.id LIMIT ${limite}`
  return (filas as Fila[]).map(aEvento)
}

export async function leerVideo(id: number): Promise<DetalleVideo | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return leer('leer video', null as DetalleVideo | null, async q => {
    const [v] = await q`SELECT * FROM cj_videos WHERE id = ${id}` as Fila[]
    if (!v) return null
    const video = aVideo(v)
    const [eventos, notas, archivos, pedidos] = await Promise.all([
      eventosDe(q, id),
      q`SELECT * FROM cj_video_notas WHERE video_id = ${id} AND NOT borrada ORDER BY ronda, segundo NULLS LAST, id` as Promise<Fila[]>,
      q`SELECT a.* FROM cj_grab_archivos a WHERE (a.video_id = ${id} OR a.propuesta_video_id = ${id}) AND a.borrado IS NULL
        ORDER BY a.creado_drive, a.id` as Promise<Fila[]>,
      q`SELECT * FROM cj_video_pedidos WHERE video_id = ${id} ORDER BY creado, id` as Promise<Fila[]>,
    ])
    const arch = archivos.map(aArchivo)
    return {
      video, eventos, notas: notas.map(aNota),
      crudos: arch.filter(a => a.tipo === 'crudo' && a.video_id === id),
      editados: arch.filter(a => a.tipo === 'editado'),
      pedidos: pedidos.map(aPedido),
    }
  })
}

/** Lo que muestra /clientes/edicion/cliente/[id]. Los archivos van sin la transcripción (está en otra tabla). */
export interface DatosCliente {
  videos: FilaTablero[]; tandas: TandaSubida[]; archivos: ArchivoGrabacion[]; doc: DocGuiones | null
  seguimientos: PasoSeguimiento[]; carpetas: CarpetaGrabacion[]
  /** video → el detalle que escribió Aylu al marcar «Regrabar» (la nota del último evento): va al texto para el cliente. */
  detallesRegrabar?: Record<number, string>
}
export async function leerCliente(id_crm: IdCrm): Promise<DatosCliente> {
  const id = idCrm(id_crm)
  const vacio: DatosCliente = { videos: [], tandas: [], archivos: [], doc: null, seguimientos: [], carpetas: [] }
  const [videos, resto] = await Promise.all([
    listarVideos({ id_crm: id, incluirFinales: true }),
    leer('leer cliente', null as Omit<DatosCliente, 'videos'> | null, async q => {
      const [tandas, archivos, docs, pasos, carpetas, regrabar] = await Promise.all([
        q`SELECT * FROM cj_grab_tandas WHERE id_crm = ${id} ORDER BY desde DESC LIMIT 60` as Promise<Fila[]>,
        q`SELECT * FROM cj_grab_archivos WHERE id_crm = ${id} AND borrado IS NULL ORDER BY creado_drive DESC NULLS LAST, id DESC LIMIT 400` as Promise<Fila[]>,
        q`SELECT * FROM cj_grab_guiones WHERE id_crm = ${id} ORDER BY leido DESC LIMIT 1` as Promise<Fila[]>,
        q`SELECT * FROM cj_grab_seguimientos WHERE id_crm = ${id} ORDER BY ciclo DESC, debido, id LIMIT 60` as Promise<Fila[]>,
        q`SELECT * FROM cj_grab_carpetas WHERE id_crm = ${id} AND borrada IS NULL ORDER BY nivel, nombre LIMIT 300` as Promise<Fila[]>,
        // El detalle de la última regrabación de cada video que está en "regrabar" (solo la nota: nunca el mail del actor)
        q`SELECT DISTINCT ON (e.video_id) e.video_id, e.nota FROM cj_video_eventos e JOIN cj_videos v ON v.id = e.video_id
          WHERE v.id_crm = ${id} AND v.estado = 'regrabar' AND e.tipo = 'estado' AND e.datos ->> 'accion' = 'regrabar'
          ORDER BY e.video_id, e.cuando DESC, e.id DESC LIMIT 100` as Promise<Fila[]>,
      ])
      const detallesRegrabar: Record<number, string> = {}
      for (const f of regrabar) { const n = String(f.nota ?? '').trim(); if (n) detallesRegrabar[entero(f.video_id)] = n.slice(0, 200) }
      return {
        tandas: tandas.map(aTanda), archivos: archivos.map(aArchivo), doc: docs[0] ? aDoc(docs[0]) : null,
        seguimientos: pasos.map(aPaso), carpetas: carpetas.map(aCarpeta), detallesRegrabar,
      }
    }),
  ])
  return { ...(resto ?? vacio), videos }
}

// ── Escritura genérica de un video (con su evento, en una sentencia) ───────────────────────────────────────────────
interface EventoNuevo { tipo: TipoEvento; de: EstadoVideo | null; a: EstadoVideo | null; actor: Actor; nota: string; datos: Record<string, unknown> }
interface Escritura { antes: Video; nuevo: Video; evento: EventoNuevo; notas?: { enviar: boolean; ronda: number } }

const jsonONull = (x: unknown): string | null => (x === null || x === undefined ? null : JSON.stringify(x))

async function escribir(q: Sql, e: Escritura): Promise<{ video: Video; evento: EventoVideo } | null> {
  const n = e.nuevo, a = columnasActor(e.evento.actor)
  const cambia = n.estado !== e.antes.estado
  const enviar = e.notas?.enviar === true, ronda = e.notas?.ronda ?? 0
  const filas = await q`WITH m AS (
      UPDATE cj_videos SET
        estado = ${n.estado}, estado_previo = ${n.estado_previo},
        estado_desde = CASE WHEN ${cambia}::boolean THEN now() ELSE estado_desde END,
        prioridad = ${n.prioridad}, bloqueo = ${n.bloqueo}, motivo_bloqueo = ${n.motivo_bloqueo}, motivo_regrabar = ${n.motivo_regrabar},
        ronda_interna = ${n.ronda_interna}, ronda_cliente = ${n.ronda_cliente},
        editado_archivo_id = ${n.editado?.archivo_id ?? null}, editado_url = ${n.editado ? n.editado.url : null},
        envio_link = ${jsonONull(n.envio_link)}::jsonb, ok_cliente = ${jsonONull(n.ok_cliente)}::jsonb,
        gancho = ${n.gancho}, guion_texto = ${n.guion_texto},
        guion_doc_id = ${n.guion?.doc_id ?? null}, guion_ref = ${n.guion?.ref ?? null}, guion_huella = ${n.guion?.huella ?? null},
        clickup_id = ${n.clickup_id}, origen = ${n.origen},
        version = version + 1, actualizado = now()
      WHERE id = ${e.antes.id} AND version = ${e.antes.version} AND estado = ${e.antes.estado}
      RETURNING *
    ), n AS (
      UPDATE cj_video_notas SET enviada = true, ronda = ${ronda}, version = version + 1
      WHERE ${enviar}::boolean AND video_id IN (SELECT id FROM m) AND NOT enviada AND NOT borrada
      RETURNING id
    ), e AS (
      INSERT INTO cj_video_eventos (video_id, id_crm, tipo, de, a, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
      SELECT m.id, m.id_crm, ${e.evento.tipo}::text, ${e.evento.de}::text, ${e.evento.a}::text, ${a.tipo}::text, ${a.rol}::text, ${a.nombre}::text, ${a.email}::text,
        ${e.evento.nota}::text, ${JSON.stringify(e.evento.datos)}::jsonb
      FROM m
      RETURNING *
    )
    SELECT row_to_json(m) AS video, row_to_json(e) AS evento, (SELECT count(*) FROM n) AS notas_enviadas FROM m CROSS JOIN e`
  const f = (filas as Fila[])[0]
  if (!f) return null
  const video = aVideo(f.video as Fila)
  const evento = { ...aEvento(f.evento as Fila), cliente: video.cliente }
  if (enviar) evento.datos = { ...evento.datos, notas_enviadas: entero(f.notas_enviadas) }
  return { video, evento }
}

async function ultimoEvento(q: Sql, videoId: number): Promise<EventoVideo | null> {
  const [f] = await q`SELECT e.id, e.video_id, e.id_crm, v.cliente, e.tipo, e.de, e.a, e.actor_tipo, e.actor_rol, e.actor_nombre, e.nota, e.datos, e.cuando
    FROM cj_video_eventos e JOIN cj_videos v ON v.id = e.video_id WHERE e.video_id = ${videoId} ORDER BY e.cuando DESC, e.id DESC LIMIT 1` as Fila[]
  return f ? aEvento(f) : null
}

/** Después de una escritura que no prendió: conflicto (con lo de ahora) o no_existe. */
async function sinEscribir(q: Sql, id: number): Promise<ResultadoEscritura<{ video: Video; evento: EventoVideo }>> {
  const [v] = await q`SELECT * FROM cj_videos WHERE id = ${id}` as Fila[]
  if (!v) return { ok: false, motivo: 'no_existe', actual: null }
  const video = aVideo(v)
  const evento = await ultimoEvento(q, id)
  return { ok: false, motivo: 'conflicto', actual: evento ? { video, evento } : null, detalle: `el video cambió (versión ${video.version}, ${video.estado})` }
}

// ── Mover (cambio de estado) ─────────────────────────────────────────────────────────────────────────────────────
/** `origen`: solo de `doc` a `aylu` («guiones enviados» sobre un video que ya creó la pasada desde el doc: seguimiento.ts). */
export type CambiosVideo = Partial<Pick<Video, 'prioridad' | 'bloqueo' | 'motivo_bloqueo' | 'motivo_regrabar' | 'editado' | 'envio_link' | 'ok_cliente' | 'gancho' | 'guion' | 'guion_texto' | 'clickup_id' | 'origen'>>
export interface Movida {
  id: number; version: number; accion: AccionVideo; actor: Actor
  ctx: Omit<ContextoTransicion, 'crudos' | 'notasNuevas' | 'notasSinTildar' | 'linkEditado'>
  nota?: string; cambios?: CambiosVideo; datos?: Record<string, unknown>
}

interface ContextoLeido { video: Video; crudos: number; notasNuevas: number; notasSinTildar: number }

async function leerContexto(q: Sql, id: number): Promise<ContextoLeido | null> {
  const [f] = await q`SELECT v.*,
      (SELECT count(*) FROM cj_grab_archivos a WHERE a.video_id = v.id AND a.tipo = 'crudo' AND a.borrado IS NULL) AS n_crudos,
      (SELECT count(*) FROM cj_video_notas n WHERE n.video_id = v.id AND NOT n.borrada AND NOT n.enviada) AS n_nuevas,
      (SELECT count(*) FROM cj_video_notas n WHERE n.video_id = v.id AND NOT n.borrada AND n.enviada AND n.tilde IS NULL
        AND n.ronda = v.ronda_interna + v.ronda_cliente) AS n_sin_tildar
    FROM cj_videos v WHERE v.id = ${id}` as Fila[]
  if (!f) return null
  return { video: aVideo(f), crudos: entero(f.n_crudos), notasNuevas: entero(f.n_nuevas), notasSinTildar: entero(f.n_sin_tildar) }
}

function validarCambios(c: CambiosVideo | undefined): void {
  if (!c) return
  if (c.prioridad !== undefined && !PRIORIDADES.includes(c.prioridad)) throw new ErrorEntradaEdicion('prioridad', 'prioridad inválida')
  if (c.bloqueo !== undefined && c.bloqueo !== null && !BLOQUEOS.includes(c.bloqueo)) throw new ErrorEntradaEdicion('bloqueo', 'bloqueo inválido')
  if (c.motivo_regrabar !== undefined && c.motivo_regrabar !== null && !MOTIVOS_REGRABAR.includes(c.motivo_regrabar)) throw new ErrorEntradaEdicion('motivo', 'motivo inválido')
  if (c.motivo_bloqueo !== undefined && (typeof c.motivo_bloqueo !== 'string' || c.motivo_bloqueo.length > 500)) throw new ErrorEntradaEdicion('motivo_bloqueo', 'motivo del bloqueo inválido')
  if (c.gancho !== undefined && (typeof c.gancho !== 'string' || c.gancho.length > LARGO_GANCHO)) throw new ErrorEntradaEdicion('gancho', 'gancho inválido')
  if (c.guion_texto !== undefined && typeof c.guion_texto !== 'string') throw new ErrorEntradaEdicion('guion_texto', 'guion inválido')
  if (c.origen !== undefined && c.origen !== 'aylu') throw new ErrorEntradaEdicion('origen', 'el origen solo puede pasar a aylu')
  if (c.clickup_id !== undefined && c.clickup_id !== null && (typeof c.clickup_id !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(c.clickup_id))) throw new ErrorEntradaEdicion('clickup_id', 'id de ClickUp inválido')
  if (c.editado) {
    if (c.editado.url && !esHttps(c.editado.url)) throw new ErrorEntradaEdicion('editado_url', 'el link al editado tiene que ser https')
    if (c.editado.archivo_id !== null && (!Number.isSafeInteger(c.editado.archivo_id) || c.editado.archivo_id <= 0)) throw new ErrorEntradaEdicion('archivo_id', 'archivo inválido')
  }
}

export const esHttps = (u: unknown): boolean => {
  if (typeof u !== 'string' || u.length > 2_000) return false
  try { return new URL(u).protocol === 'https:' } catch { return false }
}

function aplicarCambios(v: Video, c: CambiosVideo | undefined): Video {
  if (!c) return { ...v }
  const n: Video = { ...v }
  if (c.prioridad !== undefined) n.prioridad = c.prioridad
  if (c.bloqueo !== undefined) { n.bloqueo = c.bloqueo; if (c.bloqueo === null && c.motivo_bloqueo === undefined) n.motivo_bloqueo = '' }
  if (c.motivo_bloqueo !== undefined) n.motivo_bloqueo = c.motivo_bloqueo.trim()
  if (c.motivo_regrabar !== undefined) n.motivo_regrabar = c.motivo_regrabar
  if (c.editado !== undefined) {
    n.editado = c.editado ? { archivo_id: c.editado.archivo_id ?? null, url: c.editado.url ?? '' } : null
    if (n.editado && n.bloqueo === 'sin_link_editado') { n.bloqueo = null; n.motivo_bloqueo = '' }   // se limpia solo al vincular
  }
  if (c.envio_link !== undefined) n.envio_link = c.envio_link
  if (c.ok_cliente !== undefined) n.ok_cliente = c.ok_cliente
  if (c.gancho !== undefined) n.gancho = c.gancho.trim()
  if (c.guion !== undefined) n.guion = c.guion
  if (c.guion_texto !== undefined) n.guion_texto = c.guion_texto.slice(0, 20_000)
  if (c.clickup_id !== undefined) n.clickup_id = c.clickup_id
  if (c.origen !== undefined && v.origen === 'doc') n.origen = c.origen
  return n
}

const rondaTotal = (v: Pick<Video, 'ronda_interna' | 'ronda_cliente'>): number => v.ronda_interna + v.ronda_cliente

/** El video después de la acción (sin escribir). Exportada para el modo dry y los tests. */
export function aplicarAccion(antes: Video, accion: AccionVideo, a: EstadoVideo, m: Pick<Movida, 'actor' | 'ctx' | 'nota' | 'cambios'>, ahora: string, linkEditado: boolean): { nuevo: Video; enviarNotas: boolean } {
  const n = aplicarCambios(antes, m.cambios)
  n.estado = a
  if (GUARDAN_PREVIO.includes(accion)) n.estado_previo = previoAGuardar(antes)
  else if (accion === 'reanudar' || (accion === 'reabrir' && antes.estado === 'descartado')) n.estado_previo = null
  let enviarNotas = false
  // De con_cliente a corrección: el link que se mandó ya no es el último (el corregido se manda de nuevo)
  if (antes.estado === 'con_cliente' && a === 'correccion') n.envio_link = null
  switch (accion) {
    case 'regrabar': n.motivo_regrabar = m.ctx.motivo ?? n.motivo_regrabar; break
    case 'listo':
      if (!linkEditado) { n.bloqueo = 'sin_link_editado'; n.motivo_bloqueo = 'falta el link al editado' }
      else if (n.bloqueo === 'sin_link_editado') { n.bloqueo = null; n.motivo_bloqueo = '' }
      break
    case 'pedir_correccion': n.ronda_interna = antes.ronda_interna + 1; enviarNotas = true; break
    case 'pedido_cliente': n.ronda_cliente = antes.ronda_cliente + 1; enviarNotas = true; break
    case 'autorizar_ronda': n.ronda_cliente = antes.ronda_cliente + 1; n.bloqueo = null; n.motivo_bloqueo = ''; enviarNotas = true; break
    case 'ok_cliente':
      n.ok_cliente = { quien: nombreActor(m.actor), cuando: ahora, texto: (m.nota ?? '').trim().slice(0, LARGO_TEXTO_ENVIO), cita: (m.ctx.cita ?? '').trim().slice(0, LARGO_TEXTO_ENVIO) }
      if (n.bloqueo === 'tope_rondas_cliente') { n.bloqueo = null; n.motivo_bloqueo = '' }
      break
    case 'reabrir': if (antes.estado === 'aprobado') n.ok_cliente = null; break
  }
  return { nuevo: n, enviarNotas }
}

export async function moverVideo(m: Movida): Promise<ResultadoEscritura<{ video: Video; evento: EventoVideo }>> {
  const id = idPositivo(m.id, 'video_id')
  if (!esAccion(m.accion)) throw new ErrorEntradaEdicion('transicion', 'acción desconocida')
  validarCambios(m.cambios)
  await asegurarTablas()
  return consulta('mover video', async q => {
    const c = await leerContexto(q, id)
    if (!c) return { ok: false, motivo: 'no_existe', actual: null }
    if (c.video.version !== m.version) return sinEscribir(q, id)
    const linkEditado = !!(c.video.editado || m.cambios?.editado)
    const ctx: ContextoTransicion = { crudos: c.crudos, notasNuevas: c.notasNuevas, notasSinTildar: c.notasSinTildar, linkEditado, ...m.ctx }
    const p = puede(rolActor(m.actor), m.accion, c.video, ctx)
    if (!p.ok) return { ok: false, motivo: 'no_permitido', actual: null, detalle: p.motivo }
    const { nuevo, enviarNotas } = aplicarAccion(c.video, m.accion, p.a, m, new Date().toISOString(), linkEditado)
    const r = await escribir(q, {
      antes: c.video, nuevo,
      evento: { tipo: 'estado', de: c.video.estado, a: nuevo.estado, actor: m.actor, nota: (m.nota ?? '').trim().slice(0, LARGO_TEXTO_ENVIO),
        datos: { accion: m.accion, ...(m.ctx.motivo ? { motivo: m.ctx.motivo } : {}), ...(m.datos ?? {}) } },
      notas: enviarNotas ? { enviar: true, ronda: rondaTotal(nuevo) } : undefined,
    })
    return r ? { ok: true, actual: r } : sinEscribir(q, id)
  })
}

/** Cambios que no son de estado (prioridad, bloqueo, vínculo del editado, constancias, gancho, guion). */
export async function actualizarVideo(p: { id: number; version: number; actor: Actor; cambios: CambiosVideo; tipo: TipoEvento; nota?: string; datos?: Record<string, unknown> }): Promise<ResultadoEscritura<{ video: Video; evento: EventoVideo }>> {
  const id = idPositivo(p.id, 'video_id')
  validarCambios(p.cambios)
  // René solo puede poner un bloqueo "otro" con motivo (le avisa a Aylu); los vínculos los hace por vincularArchivo
  if (p.actor.tipo === 'persona' && p.actor.rol === 'rene') {
    const claves = Object.keys(p.cambios)
    const soloBloqueo = claves.every(k => k === 'bloqueo' || k === 'motivo_bloqueo') && p.cambios.bloqueo === 'otro' && !!p.cambios.motivo_bloqueo?.trim()
    const soloEditado = claves.every(k => k === 'editado')
    if (!soloBloqueo && !soloEditado) return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'René solo puede marcar un bloqueo "otro" con motivo' }
  }
  await asegurarTablas()
  return consulta('actualizar video', async q => {
    const [f] = await q`SELECT * FROM cj_videos WHERE id = ${id}` as Fila[]
    if (!f) return { ok: false, motivo: 'no_existe', actual: null }
    const antes = aVideo(f)
    if (antes.version !== p.version) return sinEscribir(q, id)
    const nuevo = aplicarCambios(antes, p.cambios)
    const r = await escribir(q, { antes, nuevo, evento: { tipo: p.tipo, de: null, a: null, actor: p.actor, nota: (p.nota ?? '').trim().slice(0, LARGO_TEXTO_ENVIO), datos: { ...(p.datos ?? {}), cambios: Object.keys(p.cambios) } } })
    return r ? { ok: true, actual: r } : sinEscribir(q, id)
  })
}

/**
 * Constancia de lo que Aylu copió en el grupo Contenido. `regrabar`: cada video pasa de regrabar a esperando_crudos
 * (regrabar_enviado) con el texto en el evento (abre o suma al ciclo de e01). `link_final`: envio_link en videos con_cliente.
 */
export async function registrarEnvio(p: { items: { id: number; version: number }[]; tipo: 'regrabar' | 'link_final'; texto: string; actor: Persona }): Promise<ResultadoEscritura<{ video: Video; evento: EventoVideo }>[]> {
  const texto = (p.texto ?? '').trim()
  if (!texto || texto.length > LARGO_TEXTO_ENVIO) throw new ErrorEntradaEdicion('texto', `el texto tiene que tener entre 1 y ${LARGO_TEXTO_ENVIO} caracteres`)
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 30) throw new ErrorEntradaEdicion('items', 'entre 1 y 30 videos')
  const actor: Actor = { tipo: 'persona', ...p.actor }
  const res: ResultadoEscritura<{ video: Video; evento: EventoVideo }>[] = []
  for (const it of p.items) {
    if (p.tipo === 'regrabar') {
      res.push(await moverVideo({ id: it.id, version: it.version, accion: 'regrabar_enviado', actor, ctx: {}, nota: texto, datos: { envio: 'regrabar' } }))
      continue
    }
    const [actual] = await leer('leer video', [] as Fila[], q => q`SELECT * FROM cj_videos WHERE id = ${idPositivo(it.id, 'video_id')}` as Promise<Fila[]>)
    if (!actual) { res.push({ ok: false, motivo: 'no_existe', actual: null }); continue }
    if (String(actual.estado) !== 'con_cliente') { res.push({ ok: false, motivo: 'no_permitido', actual: null, detalle: 'el link final se manda con el video "Con el cliente"' }); continue }
    res.push(await actualizarVideo({ id: it.id, version: it.version, actor, tipo: 'envio_cliente', nota: texto,
      cambios: { envio_link: { quien: p.actor.nombre, cuando: new Date().toISOString(), texto } }, datos: { envio: 'link_final' } }))
  }
  return res
}

// ── Alta ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface NuevoVideo {
  id_crm: IdCrm; cliente: string; clave: string; tanda_guion: number | null; numero: number | null
  guion: Video['guion']; guion_texto: string; gancho: string; estado: EstadoVideo; prioridad: Prioridad; origen: Video['origen']; clickup_id: string | null
  posible_duplicado?: string[]
}
export const CLAVE_VIDEO = /^(T\d{1,3}-V\d{1,3}|CU-[A-Za-z0-9]{1,40}|A-[A-Za-z0-9-]{1,40})$/

export async function crearVideoSiFalta(v: NuevoVideo, actor: Actor): Promise<{ video: Video; creado: boolean; evento: EventoVideo | null }> {
  const id = idCrm(v.id_crm)
  if (typeof v.clave !== 'string' || !CLAVE_VIDEO.test(v.clave)) throw new ErrorEntradaEdicion('clave', 'clave de video inválida (T2-V4 o CU-…)')
  if (!(ESTADOS_VIDEO as readonly string[]).includes(v.estado) || ESTADOS_FINALES.includes(v.estado)) throw new ErrorEntradaEdicion('estado', 'estado inicial inválido')
  if (!PRIORIDADES.includes(v.prioridad)) throw new ErrorEntradaEdicion('prioridad', 'prioridad inválida')
  const a = columnasActor(actor)
  const tipoEvento: TipoEvento = v.origen === 'clickup' ? 'importado' : 'creado'
  await asegurarTablas()
  return consulta('crear video', async q => {
    const filas = await q`WITH v AS (
        INSERT INTO cj_videos (id_crm, cliente, clave, tanda_guion, numero, guion_doc_id, guion_ref, guion_huella, guion_texto, gancho,
          estado, prioridad, origen, clickup_id, posible_duplicado)
        VALUES (${id}, ${v.cliente.slice(0, 200)}, ${v.clave}, ${v.tanda_guion}, ${v.numero}, ${v.guion?.doc_id ?? null}, ${v.guion?.ref ?? null},
          ${v.guion?.huella ?? null}, ${v.guion_texto ?? ''}, ${(v.gancho ?? '').slice(0, LARGO_GANCHO)}, ${v.estado}, ${v.prioridad}, ${v.origen},
          ${v.clickup_id}, ${v.posible_duplicado ?? []}::text[])
        ON CONFLICT DO NOTHING
        RETURNING *
      ), e AS (
        INSERT INTO cj_video_eventos (video_id, id_crm, tipo, de, a, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
        SELECT v.id, v.id_crm, ${tipoEvento}, NULL, v.estado, ${a.tipo}, ${a.rol}, ${a.nombre}, ${a.email}, '',
          ${JSON.stringify({ origen: v.origen, ...(v.posible_duplicado?.length ? { posible_duplicado: v.posible_duplicado } : {}) })}::jsonb
        FROM v RETURNING *
      )
      SELECT row_to_json(v) AS video, row_to_json(e) AS evento FROM v CROSS JOIN e`
    const f = (filas as Fila[])[0]
    if (f) {
      const video = aVideo(f.video as Fila)
      return { video, creado: true, evento: { ...aEvento(f.evento as Fila), cliente: video.cliente } }
    }
    const [ya] = await q`SELECT * FROM cj_videos WHERE (id_crm = ${id} AND clave = ${v.clave}) OR (${v.clickup_id}::text IS NOT NULL AND clickup_id = ${v.clickup_id})
      ORDER BY id LIMIT 1` as Fila[]
    if (!ya) throw new Error('no se pudo crear ni leer el video')
    return { video: aVideo(ya), creado: false, evento: null }
  })
}

// ── Notas ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface NuevaNota {
  segundo: number | null; hasta: number | null; tipo: TipoNota; texto: string; imagen_url: string | null; origen: OrigenNota
  pedido_id?: number | null; evaluacion?: NotaVideo['evaluacion']
}

function validarNota(n: Partial<NuevaNota>, completa: boolean): void {
  if (completa || n.texto !== undefined) {
    if (typeof n.texto !== 'string' || !n.texto.trim() || n.texto.length > LARGO_NOTA) throw new ErrorEntradaEdicion('texto', `la nota tiene que tener entre 1 y ${LARGO_NOTA} caracteres`)
  }
  if (completa || n.tipo !== undefined) if (!TIPOS_NOTA.includes(n.tipo as TipoNota)) throw new ErrorEntradaEdicion('tipo', 'tipo de nota inválido')
  if (completa || n.origen !== undefined) if (n.origen !== 'aylu' && n.origen !== 'cliente') throw new ErrorEntradaEdicion('origen', 'origen inválido')
  for (const k of ['segundo', 'hasta'] as const) {
    const x = n[k]
    if (x !== undefined && x !== null && (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 36_000)) throw new ErrorEntradaEdicion(k, `${k} inválido`)
  }
  if (typeof n.segundo === 'number' && typeof n.hasta === 'number' && n.hasta < n.segundo) throw new ErrorEntradaEdicion('hasta', '"hasta" no puede ser antes que "segundo"')
  if (n.imagen_url !== undefined && n.imagen_url !== null && n.imagen_url !== '' && !esHttps(n.imagen_url)) throw new ErrorEntradaEdicion('imagen_url', 'la imagen tiene que ser un link https')
}

const puedeEscribirNotas = (a: Actor): boolean => a.tipo === 'bot' || a.rol === 'aylu' || a.rol === 'tomas'

async function eventoNota(q: Sql, videoId: number, actor: Actor, tipo: TipoEvento, nota: string, datos: Record<string, unknown>): Promise<EventoVideo | null> {
  const a = columnasActor(actor)
  const filas = await q`INSERT INTO cj_video_eventos (video_id, id_crm, tipo, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
    SELECT v.id, v.id_crm, ${tipo}, ${a.tipo}, ${a.rol}, ${a.nombre}, ${a.email}, ${nota}, ${JSON.stringify(datos)}::jsonb FROM cj_videos v WHERE v.id = ${videoId}
    RETURNING *` as Fila[]
  return Array.isArray(filas) && filas[0] ? aEvento(filas[0]) : null
}

const aActor = (x: Persona | Actor): Actor => ('tipo' in x ? x : { tipo: 'persona', ...x })

/** Crea una nota. Con el video en corrección se suma a la ronda abierta y devuelve también su evento (para avisarle a René). */
export async function crearNota(p: { video_id: number; actor: Persona | Actor; nota: NuevaNota }): Promise<ResultadoEscritura<NotaVideo> & { evento?: EventoVideo }> {
  const videoId = idPositivo(p.video_id, 'video_id')
  validarNota(p.nota, true)
  const actor = aActor(p.actor)
  if (!puedeEscribirNotas(actor)) return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'las notas las cargan Aylu o Tomás' }
  await asegurarTablas()
  return consulta('crear nota', async q => {
    const [f] = await q`SELECT * FROM cj_videos WHERE id = ${videoId}` as Fila[]
    if (!f) return { ok: false, motivo: 'no_existe', actual: null }
    const v = aVideo(f)
    if (ESTADOS_FINALES.includes(v.estado)) return { ok: false, motivo: 'no_permitido', actual: null, detalle: `el video está ${v.estado}` }
    // En corrección: se suma a la ronda abierta, ya enviada (no suma ronda)
    const abierta = v.estado === 'correccion'
    const ronda = abierta ? rondaTotal(v) : rondaTotal(v) + 1
    const n = p.nota
    const [fila] = await q`INSERT INTO cj_video_notas (video_id, ronda, origen, enviada, segundo, hasta, tipo, texto, imagen_url, evaluacion, pedido_id, creado_por)
      VALUES (${videoId}, ${ronda}, ${n.origen}, ${abierta}, ${n.segundo}, ${n.hasta}, ${n.tipo}, ${n.texto.trim()}, ${n.imagen_url || null},
        ${jsonONull(n.evaluacion ?? null)}::jsonb, ${n.pedido_id ?? null}, ${nombreActor(actor)})
      RETURNING *` as Fila[]
    const nota = aNota(fila)
    const ev = await eventoNota(q, videoId, actor, 'nota', '', { nota_id: nota.id, ronda, origen: n.origen, ...(abierta ? { ronda_abierta: true } : {}) })
    return { ok: true, actual: nota, ...(abierta && ev ? { evento: { ...ev, cliente: v.cliente } } : {}) }
  })
}

async function notaSinEscribir(q: Sql, id: number): Promise<ResultadoEscritura<NotaVideo>> {
  const [f] = await q`SELECT * FROM cj_video_notas WHERE id = ${id} AND NOT borrada` as Fila[]
  return f ? { ok: false, motivo: 'conflicto', actual: aNota(f) } : { ok: false, motivo: 'no_existe', actual: null }
}

export async function editarNota(p: { id: number; version: number; actor: Persona; cambios: Partial<NuevaNota> }): Promise<ResultadoEscritura<NotaVideo>> {
  const id = idPositivo(p.id, 'nota_id')
  validarNota(p.cambios, false)
  const actor = aActor(p.actor)
  if (!puedeEscribirNotas(actor)) return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'las notas las editan Aylu o Tomás' }
  await asegurarTablas()
  return consulta('editar nota', async q => {
    const [f] = await q`SELECT * FROM cj_video_notas WHERE id = ${id} AND NOT borrada` as Fila[]
    if (!f) return { ok: false, motivo: 'no_existe', actual: null }
    const antes = aNota(f)
    if (antes.enviada) return { ok: false, motivo: 'no_permitido', actual: antes, detalle: 'la nota ya se mandó: no se edita' }
    const c = p.cambios
    const nueva = {
      segundo: c.segundo !== undefined ? c.segundo : antes.segundo, hasta: c.hasta !== undefined ? c.hasta : antes.hasta,
      tipo: c.tipo ?? antes.tipo, texto: c.texto !== undefined ? c.texto.trim() : antes.texto,
      imagen_url: c.imagen_url !== undefined ? (c.imagen_url || null) : antes.imagen_url,
    }
    validarNota({ segundo: nueva.segundo, hasta: nueva.hasta }, false)
    const [fila] = await q`UPDATE cj_video_notas SET segundo = ${nueva.segundo}, hasta = ${nueva.hasta}, tipo = ${nueva.tipo}, texto = ${nueva.texto},
        imagen_url = ${nueva.imagen_url}, version = version + 1
      WHERE id = ${id} AND version = ${p.version} AND NOT enviada AND NOT borrada RETURNING *` as Fila[]
    if (!fila) return notaSinEscribir(q, id)
    await eventoNota(q, antes.video_id, actor, 'nota', '', { nota_id: id, accion: 'editada' })
    return { ok: true, actual: aNota(fila) }
  })
}

export async function borrarNota(p: { id: number; version: number; actor: Persona }): Promise<ResultadoEscritura<NotaVideo>> {
  const id = idPositivo(p.id, 'nota_id')
  const actor = aActor(p.actor)
  if (!puedeEscribirNotas(actor)) return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'las notas las borran Aylu o Tomás' }
  await asegurarTablas()
  return consulta('borrar nota', async q => {
    const [fila] = await q`UPDATE cj_video_notas SET borrada = true, version = version + 1
      WHERE id = ${id} AND version = ${p.version} AND NOT enviada AND NOT borrada RETURNING *` as Fila[]
    if (!fila) {
      const r = await notaSinEscribir(q, id)
      if (!r.ok && r.actual?.enviada) return { ok: false, motivo: 'no_permitido', actual: r.actual, detalle: 'la nota ya se mandó: no se borra' }
      return r
    }
    const nota = aNota(fila)
    await eventoNota(q, nota.video_id, actor, 'nota', '', { nota_id: id, accion: 'borrada' })
    return { ok: true, actual: nota }
  })
}

export async function tildarNota(p: { id: number; version: number; tildada: boolean; actor: Persona }): Promise<ResultadoEscritura<NotaVideo>> {
  const id = idPositivo(p.id, 'nota_id')
  if (!['rene', 'aylu', 'tomas'].includes(p.actor.rol)) return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'solo René, Aylu o Tomás' }
  const tilde = p.tildada ? JSON.stringify({ quien: p.actor.nombre, cuando: new Date().toISOString() }) : null
  await asegurarTablas()
  return consulta('tildar nota', async q => {
    const [fila] = await q`UPDATE cj_video_notas n SET tilde = ${tilde}::jsonb, version = n.version + 1
      FROM cj_videos v
      WHERE n.id = ${id} AND n.version = ${p.version} AND n.enviada AND NOT n.borrada AND v.id = n.video_id AND v.estado = 'correccion'
      RETURNING n.*` as Fila[]
    if (!fila) {
      const [f] = await q`SELECT n.*, v.estado AS estado_video FROM cj_video_notas n JOIN cj_videos v ON v.id = n.video_id WHERE n.id = ${id} AND NOT n.borrada` as Fila[]
      if (!f) return { ok: false, motivo: 'no_existe', actual: null }
      const nota = aNota(f)
      if (String(f.estado_video) !== 'correccion') return { ok: false, motivo: 'no_permitido', actual: nota, detalle: 'solo se tilda con el video en corrección' }
      if (!nota.enviada) return { ok: false, motivo: 'no_permitido', actual: nota, detalle: 'la nota todavía no se mandó' }
      return { ok: false, motivo: 'conflicto', actual: nota }
    }
    const nota = aNota(fila)
    await eventoNota(q, nota.video_id, { tipo: 'persona', ...p.actor }, 'tilde', '', { nota_id: id, tildada: p.tildada })
    return { ok: true, actual: nota }
  })
}

// ── Pedidos del cliente (f05 / P6), cada uno en una sentencia ─────────────────────────────────────────────────────
export interface AplicarPedido { pedido_id: number; version: number; elegidas: number[]; actor: Persona }
export interface PedidoAplicado {
  resultado: 'correccion' | 'espera_tomas' | 'nada'; video: Video; pedido: PedidoCliente; notas: NotaVideo[]
  eventos: EventoVideo[]; extra: AvisoMotor[]
}

const notasDePropuesta = (prop: NotaPropuesta[], elegidas: number[]) => elegidas.map(i => {
  const n = prop[i]
  const seg = typeof n.segundo === 'number' && n.segundo >= 0 ? n.segundo : null
  const hasta = typeof n.hasta === 'number' && n.hasta >= 0 && (seg === null || n.hasta >= seg) ? n.hasta : null
  return {
    segundo: seg, hasta, tipo: TIPOS_NOTA.includes(n.tipo) ? n.tipo : 'otro', texto: String(n.texto ?? '').trim().slice(0, LARGO_NOTA) || '(sin texto)',
    evaluacion: { afecta_rendimiento: n.afecta_rendimiento === true, motivo: String(n.motivo ?? '').slice(0, 500) },
  }
})

/** P6 sin reescribir la regla: ¿la ronda que sigue necesita a Tomás? (usa puede() y TOPE_RONDAS_CLIENTE). */
export function decidirRondaCliente(video: Pick<Video, 'estado' | 'estado_previo' | 'bloqueo' | 'ronda_cliente'>, actor: Persona): { ronda: number; requiereTomas: boolean } {
  const r = puede(actor.rol, 'pedido_cliente', video, { crudos: 0, notasNuevas: 1, notasSinTildar: 0, linkEditado: true })
  return { ronda: video.ronda_cliente + 1, requiereTomas: !r.ok && r.motivo === 'tope' }
}

export async function aplicarPedidoCliente(p: AplicarPedido): Promise<ResultadoEscritura<PedidoAplicado>> {
  const pid = idPositivo(p.pedido_id, 'pedido_id')
  if (p.actor.rol !== 'aylu' && p.actor.rol !== 'tomas') return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'los pedidos los confirman Aylu o Tomás' }
  await asegurarTablas()
  return consulta('aplicar pedido', async q => {
    const [f] = await q`SELECT p.*, row_to_json(v) AS video FROM cj_video_pedidos p JOIN cj_videos v ON v.id = p.video_id WHERE p.id = ${pid}` as Fila[]
    if (!f) return { ok: false, motivo: 'no_existe', actual: null }
    const pedido = aPedido(f), video = aVideo(f.video as Fila)
    const actual = (): PedidoAplicado => ({ resultado: 'nada', video, pedido, notas: [], eventos: [], extra: [] })
    if (pedido.version !== p.version) return { ok: false, motivo: 'conflicto', actual: actual() }
    if (pedido.estado !== 'propuesto') return { ok: false, motivo: 'no_permitido', actual: actual(), detalle: `el pedido ya está ${pedido.estado}` }
    const elegidas = [...new Set((Array.isArray(p.elegidas) ? p.elegidas : []).map(Number))]
    if (elegidas.some(i => !Number.isInteger(i) || i < 0 || i >= pedido.propuesta.length)) throw new ErrorEntradaEdicion('elegidas', 'notas elegidas inválidas')
    const actor: Actor = { tipo: 'persona', ...p.actor }
    const a = columnasActor(actor)
    const decidido = JSON.stringify({ quien: p.actor.nombre, cuando: new Date().toISOString() })

    // Nada que corregir: el pedido queda confirmado sin notas y no cuenta como ronda
    if (!elegidas.length) {
      const filas = await q`WITH p AS (
          UPDATE cj_video_pedidos SET estado = 'confirmado', elegidas = '{}'::int[], decidido = ${decidido}::jsonb, version = version + 1
          WHERE id = ${pid} AND version = ${p.version} AND estado = 'propuesto' RETURNING *
        ), e AS (
          INSERT INTO cj_video_eventos (video_id, id_crm, tipo, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
          SELECT v.id, v.id_crm, 'pedido', ${a.tipo}, ${a.rol}, ${a.nombre}, ${a.email}, 'nada que corregir', ${JSON.stringify({ pedido_id: pid, nada: true })}::jsonb
          FROM cj_videos v JOIN p ON p.video_id = v.id RETURNING *
        )
        SELECT row_to_json(p) AS pedido, row_to_json(e) AS evento FROM p CROSS JOIN e`
      const r = (filas as Fila[])[0]
      if (!r) return { ok: false, motivo: 'conflicto', actual: actual() }
      return { ok: true, actual: { resultado: 'nada', video, pedido: aPedido(r.pedido as Fila), notas: [], eventos: [{ ...aEvento(r.evento as Fila), cliente: video.cliente }], extra: [] } }
    }

    if (video.estado !== 'con_cliente' && video.estado !== 'correccion') {
      return { ok: false, motivo: 'no_permitido', actual: actual(), detalle: 'el pedido del cliente va con el video "Con el cliente" (o en corrección)' }
    }
    // Ya hay un pedido de la 3.ª ronda esperando a Tomás: otro pedido quedaría colgado (al autorizar uno salen las notas de
    // los dos y el otro queda "esperando tu OK" para siempre). Primero se autoriza o se descarta el que espera.
    if (video.bloqueo === 'tope_rondas_cliente') {
      return { ok: false, motivo: 'no_permitido', actual: actual(), detalle: 'ya hay un pedido del cliente esperando el OK de Tomás: que lo autorice o descartalo antes de confirmar otro' }
    }
    const notas = JSON.stringify(notasDePropuesta(pedido.propuesta, elegidas))
    let resultado: PedidoAplicado['resultado']
    let estadoPedido: string, estadoVideo: EstadoVideo, rondaCliente = video.ronda_cliente, bloqueo: Video['bloqueo'] = video.bloqueo, motivoBloqueo = video.motivo_bloqueo
    let enviada: boolean, rondaNotas: number, enviarViejas = false, tipoEv: TipoEvento
    const extra: AvisoMotor[] = []
    if (video.estado === 'correccion') {
      // Se suma a la ronda abierta (ya enviada), sin sumar ronda
      resultado = 'correccion'; estadoPedido = 'confirmado'; estadoVideo = 'correccion'
      enviada = true; rondaNotas = rondaTotal(video); tipoEv = 'pedido'
    } else if (decidirRondaCliente(video, p.actor).requiereTomas) {
      resultado = 'espera_tomas'; estadoPedido = 'espera_tomas'; estadoVideo = 'con_cliente'
      bloqueo = 'tope_rondas_cliente'; motivoBloqueo = `ronda ${video.ronda_cliente + 1} del cliente: espera el OK de Tomás`
      enviada = false; rondaNotas = rondaTotal(video) + 1; tipoEv = 'bloqueo'
      extra.push({ tipo: 'tope_rondas', video_id: video.id, id_crm: video.id_crm, cliente: video.cliente, clave: video.clave, numero: video.numero, ronda: video.ronda_cliente + 1, pedido_id: pid })
    } else {
      resultado = 'correccion'; estadoPedido = 'confirmado'; estadoVideo = 'correccion'
      rondaCliente = video.ronda_cliente + 1; enviada = true; enviarViejas = true; rondaNotas = rondaTotal(video) + 1; tipoEv = 'estado'
      // (con el bloqueo del tope puesto no se llega acá: se rechazó arriba)
    }
    const cambia = estadoVideo !== video.estado
    const decididoAhora = estadoPedido === 'confirmado' ? decidido : null
    const datos = JSON.stringify({ accion: resultado === 'espera_tomas' ? 'tope_rondas' : 'pedido_cliente', pedido_id: pid, ronda_cliente: rondaCliente,
      ...(video.estado === 'correccion' ? { ronda_abierta: true } : {}) })
    const filas = await q`WITH g AS (
        SELECT pp.id AS pid, vv.id AS vid FROM cj_video_pedidos pp JOIN cj_videos vv ON vv.id = pp.video_id
        WHERE pp.id = ${pid} AND pp.version = ${p.version} AND pp.estado = 'propuesto' AND vv.version = ${video.version} AND vv.estado = ${video.estado}
        FOR UPDATE OF pp, vv
      ), p AS (
        UPDATE cj_video_pedidos SET estado = ${estadoPedido}, elegidas = ${elegidas}::int[], ronda = ${rondaCliente},
          decidido = ${decididoAhora}::jsonb, version = version + 1
        WHERE id IN (SELECT pid FROM g) RETURNING *
      ), m AS (
        UPDATE cj_videos SET estado = ${estadoVideo}, estado_desde = CASE WHEN ${cambia}::boolean THEN now() ELSE estado_desde END,
          envio_link = CASE WHEN ${cambia}::boolean THEN NULL ELSE envio_link END,
          ronda_cliente = ${rondaCliente}, bloqueo = ${bloqueo}, motivo_bloqueo = ${motivoBloqueo}, version = version + 1, actualizado = now()
        WHERE id IN (SELECT vid FROM g) RETURNING *
      ), viejas AS (
        UPDATE cj_video_notas SET enviada = true, ronda = ${rondaNotas}, version = version + 1
        WHERE ${enviarViejas}::boolean AND video_id IN (SELECT vid FROM g) AND NOT enviada AND NOT borrada RETURNING id
      ), n AS (
        INSERT INTO cj_video_notas (video_id, ronda, origen, enviada, segundo, hasta, tipo, texto, evaluacion, pedido_id, creado_por)
        SELECT g.vid, ${rondaNotas}::int, 'cliente', ${enviada}::boolean, x.segundo, x.hasta, x.tipo, x.texto, x.evaluacion, g.pid, ${p.actor.nombre}::text
        FROM g CROSS JOIN jsonb_to_recordset(${notas}::jsonb) AS x(segundo numeric, hasta numeric, tipo text, texto text, evaluacion jsonb)
        RETURNING *
      ), e AS (
        INSERT INTO cj_video_eventos (video_id, id_crm, tipo, de, a, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
        SELECT m.id, m.id_crm, ${tipoEv}::text, ${cambia ? video.estado : null}::text, ${cambia ? estadoVideo : null}::text, ${a.tipo}::text, ${a.rol}::text, ${a.nombre}::text, ${a.email}::text, '', ${datos}::jsonb
        FROM m RETURNING *
      )
      SELECT row_to_json(m) AS video, row_to_json(p) AS pedido, row_to_json(e) AS evento,
        (SELECT coalesce(json_agg(n ORDER BY n.id), '[]'::json) FROM n) AS notas, (SELECT count(*) FROM viejas) AS viejas
      FROM m CROSS JOIN p CROSS JOIN e`
    const r = (filas as Fila[])[0]
    if (!r) return { ok: false, motivo: 'conflicto', actual: actual(), detalle: 'el pedido o el video cambiaron' }
    const vNuevo = aVideo(r.video as Fila)
    return { ok: true, actual: {
      resultado, video: vNuevo, pedido: aPedido(r.pedido as Fila), notas: (r.notas as Fila[]).map(aNota),
      eventos: [{ ...aEvento(r.evento as Fila), cliente: vNuevo.cliente }], extra,
    } }
  })
}

/** Tomás autoriza la ronda que pasó el tope: el video va a corrección con esas notas y se saca el bloqueo. */
export async function autorizarPedidoCliente(p: { pedido_id: number; version: number; actor: Persona }): Promise<ResultadoEscritura<{ video: Video; pedido: PedidoCliente; evento: EventoVideo }>> {
  const pid = idPositivo(p.pedido_id, 'pedido_id')
  if (p.actor.rol !== 'tomas') return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'la ronda extra la autoriza Tomás' }
  await asegurarTablas()
  return consulta('autorizar pedido', async q => {
    const [f] = await q`SELECT p.*, row_to_json(v) AS video FROM cj_video_pedidos p JOIN cj_videos v ON v.id = p.video_id WHERE p.id = ${pid}` as Fila[]
    if (!f) return { ok: false, motivo: 'no_existe', actual: null }
    const pedido = aPedido(f), video = aVideo(f.video as Fila)
    if (pedido.version !== p.version) return { ok: false, motivo: 'conflicto', actual: null }
    if (pedido.estado !== 'espera_tomas') return { ok: false, motivo: 'no_permitido', actual: null, detalle: `el pedido está ${pedido.estado}` }
    const ok = puede('tomas', 'autorizar_ronda', video, { crudos: 0, notasNuevas: 0, notasSinTildar: 0, linkEditado: true })
    if (!ok.ok) return { ok: false, motivo: 'no_permitido', actual: null, detalle: ok.motivo }
    const a = columnasActor({ tipo: 'persona', ...p.actor })
    const rondaCliente = video.ronda_cliente + 1, rondaNotas = rondaTotal(video) + 1
    const decidido = JSON.stringify({ quien: p.actor.nombre, cuando: new Date().toISOString() })
    const filas = await q`WITH g AS (
        SELECT pp.id AS pid, vv.id AS vid FROM cj_video_pedidos pp JOIN cj_videos vv ON vv.id = pp.video_id
        WHERE pp.id = ${pid} AND pp.version = ${p.version} AND pp.estado = 'espera_tomas' AND vv.version = ${video.version}
          AND vv.estado = 'con_cliente' AND vv.bloqueo = 'tope_rondas_cliente'
        FOR UPDATE OF pp, vv
      ), p AS (
        UPDATE cj_video_pedidos SET estado = 'autorizado', ronda = ${rondaCliente}, decidido = ${decidido}::jsonb, version = version + 1
        WHERE id IN (SELECT pid FROM g) RETURNING *
      ), m AS (
        UPDATE cj_videos SET estado = 'correccion', estado_desde = now(), ronda_cliente = ${rondaCliente}, bloqueo = NULL, motivo_bloqueo = '',
          envio_link = NULL, version = version + 1, actualizado = now()
        WHERE id IN (SELECT vid FROM g) RETURNING *
      ), n AS (
        UPDATE cj_video_notas SET enviada = true, ronda = ${rondaNotas}, version = version + 1
        WHERE video_id IN (SELECT vid FROM g) AND NOT enviada AND NOT borrada RETURNING id
      ), e AS (
        INSERT INTO cj_video_eventos (video_id, id_crm, tipo, de, a, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
        SELECT m.id, m.id_crm, 'autorizacion', 'con_cliente', 'correccion', ${a.tipo}, ${a.rol}, ${a.nombre}, ${a.email}, '',
          ${JSON.stringify({ accion: 'autorizar_ronda', pedido_id: pid, ronda_cliente: rondaCliente })}::jsonb
        FROM m RETURNING *
      )
      SELECT row_to_json(m) AS video, row_to_json(p) AS pedido, row_to_json(e) AS evento, (SELECT count(*) FROM n) AS notas FROM m CROSS JOIN p CROSS JOIN e`
    const r = (filas as Fila[])[0]
    if (!r) return { ok: false, motivo: 'conflicto', actual: null }
    const v = aVideo(r.video as Fila)
    return { ok: true, actual: { video: v, pedido: aPedido(r.pedido as Fila), evento: { ...aEvento(r.evento as Fila), cliente: v.cliente } } }
  })
}

/** Descartar un pedido (propuesto o esperando a Tomás): sus notas sin mandar se borran y, si esperaba a Tomás, se saca el bloqueo. */
export async function descartarPedidoCliente(p: { pedido_id: number; version: number; nota: string; actor: Persona }): Promise<ResultadoEscritura<{ pedido: PedidoCliente; video: Video; evento: EventoVideo }>> {
  const pid = idPositivo(p.pedido_id, 'pedido_id')
  if (p.actor.rol !== 'aylu' && p.actor.rol !== 'tomas') return { ok: false, motivo: 'no_permitido', actual: null, detalle: 'solo Aylu o Tomás' }
  const nota = (p.nota ?? '').trim().slice(0, LARGO_NOTA)
  const a = columnasActor({ tipo: 'persona', ...p.actor })
  const decidido = JSON.stringify({ quien: p.actor.nombre, cuando: new Date().toISOString() })
  await asegurarTablas()
  return consulta('descartar pedido', async q => {
    const filas = await q`WITH p0 AS (
        SELECT id, video_id, estado FROM cj_video_pedidos WHERE id = ${pid} AND version = ${p.version} AND estado IN ('propuesto', 'espera_tomas') FOR UPDATE
      ), p AS (
        UPDATE cj_video_pedidos SET estado = 'descartado', decidido = ${decidido}::jsonb, version = version + 1
        WHERE id IN (SELECT id FROM p0) RETURNING *
      ), n AS (
        UPDATE cj_video_notas SET borrada = true, version = version + 1
        WHERE pedido_id IN (SELECT id FROM p0) AND NOT enviada AND NOT borrada RETURNING id
      ), m AS (
        UPDATE cj_videos SET bloqueo = NULL, motivo_bloqueo = '', version = version + 1, actualizado = now()
        WHERE id IN (SELECT video_id FROM p0 WHERE estado = 'espera_tomas') AND bloqueo = 'tope_rondas_cliente'
        RETURNING *
      ), e AS (
        INSERT INTO cj_video_eventos (video_id, id_crm, tipo, actor_tipo, actor_rol, actor_nombre, actor_email, nota, datos)
        SELECT v.id, v.id_crm, 'pedido', ${a.tipo}, ${a.rol}, ${a.nombre}, ${a.email}, ${nota},
          ${JSON.stringify({ pedido_id: pid, descartado: true })}::jsonb || jsonb_build_object('saca_bloqueo', EXISTS (SELECT 1 FROM m))
        FROM cj_videos v JOIN p0 ON p0.video_id = v.id RETURNING *
      )
      SELECT row_to_json(p) AS pedido, row_to_json(e) AS evento, (SELECT row_to_json(m) FROM m LIMIT 1) AS video_nuevo,
        (SELECT row_to_json(v) FROM cj_videos v JOIN p0 ON p0.video_id = v.id LIMIT 1) AS video_antes
      FROM p CROSS JOIN e`
    const r = (filas as Fila[])[0]
    if (!r) {
      const [f] = await q`SELECT * FROM cj_video_pedidos WHERE id = ${pid}` as Fila[]
      return f ? { ok: false, motivo: aPedido(f).estado === 'propuesto' || aPedido(f).estado === 'espera_tomas' ? 'conflicto' : 'no_permitido', actual: null, detalle: `el pedido está ${aPedido(f).estado}` }
        : { ok: false, motivo: 'no_existe', actual: null }
    }
    const v = aVideo((r.video_nuevo ?? r.video_antes) as Fila)
    return { ok: true, actual: { pedido: aPedido(r.pedido as Fila), video: v, evento: { ...aEvento(r.evento as Fila), cliente: v.cliente } } }
  })
}
