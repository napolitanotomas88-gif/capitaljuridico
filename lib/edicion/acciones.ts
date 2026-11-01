// ── API de la pantalla de Edición (POST /api/edicion y POST /api/edicion/pedido): barrera HTTP y decisión ────────────
// Las rutas (app/api/edicion/route.ts y app/api/edicion/pedido/route.ts) solo arman las dependencias reales; TODO lo demás
// está acá, con las dependencias INYECTADAS (acceso, sesión, repositorio, motor, marca, pedidos, avisos, reloj) para
// probarlo sin base ni Next (scripts/test-edicion-acciones.mjs). Mismo orden que el kickoff (lib/bot/kickoff/acciones.ts).
// atenderPost (la barrera, en este orden; nada llega a la base si algo falla):
//   1. sesión de Google con la sección Edición (exigirAccesoApi: 401 sin sesión, 403 sin la sección);
//   2. mismo origen: Origin del mismo host que la petición (anti-CSRF) → si no, 403;
//   3. Content-Type application/json → si no, 415;
//   4. cuerpo de hasta LARGO_MAX_CUERPO caracteres → si no, 413; JSON → si no, 400;
//   5. la sesión (401) y la base configurada (503).
// atenderAccion (la decisión):
//   1. validarPedido (pedido.ts): estricto, sin "quién" en el cuerpo;
//   2. el usuario de prueba de desarrollo (CRM_DEV_ROL) NO escribe: con la DATABASE_URL de .env.local sería la base real;
//   3. el rol sale de la sesión (permisos.ts): un lector recibe 403; René solo lo suyo (listo, corregido, tildar, aceptar el
//      editado, un bloqueo "otro" con motivo);
//   4. los cambios de estado pasan por puede() (estados.ts) ANTES de llamar al repositorio, que vuelve a validar en la misma
//      sentencia con lo que hay en la base; cada escritura lleva la `version` que vio la persona: si cambió → 409;
//   5. modo dry (EDICION_MODO≠real o ?dry=1): valida, lee lo que haga falta y responde { dry: true, habria } SIN escribir;
//   6. los eventos y los AvisoMotor van a los avisos (bloque C) DESPUÉS de responder (after() en la ruta): una falla ahí
//      nunca frena la respuesta.
// Respuestas: 200 ok · 403 usuario de prueba, solo lectura o rol sin permiso · 404 no existe · 409 conflicto (con la versión
// de ahora) o no permitido (con el motivo) · 422 entrada inválida · 503 la base no respondió.
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import { TRANSICIONES, puede, type AccionVideo, type ContextoTransicion } from './estados'
import { LARGO_MAX_CUERPO, validarPedido, validarPropuesta, type PedidoEdicion } from './pedido'
import { personaDeSesion, rolEdicion, tienePermiso, type Permiso } from './permisos'
import {
  ETIQUETA_ESTADO,
  type Actor, type ArchivoGrabacion, type AvisoMotor, type Bloqueo, type EventoVideo, type FichaMarca, type GuionDoc,
  type IdCrm, type NotaPropuesta, type NotaVideo, type PedidoCliente, type Persona, type ResultadoEscritura, type RolEdicion,
  type TipoEvento, type Video,
} from './tipos'

type Entorno = Record<string, string | undefined>
type R<T> = ResultadoEscritura<T>
type ResVideo = R<{ video: Video; evento: EventoVideo }>

// ── Dependencias ──
export interface DetalleLeido {
  video: Video; notas: NotaVideo[]; crudos: ArchivoGrabacion[]; editados: ArchivoGrabacion[]; pedidos?: PedidoCliente[]; eventos?: EventoVideo[]
}
export interface CambiosLeves { prioridad?: Video['prioridad']; bloqueo?: Bloqueo | null; motivo_bloqueo?: string; editado?: Video['editado'] }
export interface NotaNueva { segundo: number | null; hasta: number | null; tipo: NotaVideo['tipo']; texto: string; imagen_url: string | null; origen: NotaVideo['origen'] }

export interface RepoVideos {
  leerVideo(id: number): Promise<DetalleLeido | null>
  moverVideo(m: { id: number; version: number; accion: AccionVideo; actor: Actor; ctx: { motivo?: ContextoTransicion['motivo']; nota?: string; cita?: string }; nota?: string; cambios?: CambiosLeves; datos?: Record<string, unknown> }): Promise<ResVideo>
  actualizarVideo(p: { id: number; version: number; actor: Actor; cambios: CambiosLeves; tipo: TipoEvento; nota?: string; datos?: Record<string, unknown> }): Promise<ResVideo>
  registrarEnvio(p: { items: { id: number; version: number }[]; tipo: 'regrabar' | 'link_final'; texto: string; actor: Persona }): Promise<ResVideo[]>
  /** Con el video en corrección la nota sale enseguida (enviada) y el repositorio devuelve su evento para avisarle a René. */
  crearNota(p: { video_id: number; actor: Persona; nota: NotaNueva }): Promise<R<NotaVideo> & { evento?: EventoVideo }>
  editarNota(p: { id: number; version: number; actor: Persona; cambios: Partial<NotaNueva> }): Promise<R<NotaVideo>>
  borrarNota(p: { id: number; version: number; actor: Persona }): Promise<R<NotaVideo>>
  tildarNota(p: { id: number; version: number; tildada: boolean; actor: Persona }): Promise<R<NotaVideo>>
}
export interface DepsEdicion {
  repo: {
    videos: RepoVideos
    archivos: { vincularArchivo(p: { archivo_id: number; video_id: number | null; actor: Actor }): Promise<R<ArchivoGrabacion>> }
    seguimientos: {
      marcarPaso(p: { id: number; version: number; actor: Persona; nota: string; texto: string }): Promise<R<unknown>>
      decidirPaso(p: { id: number; version: number; actor: Persona; decision: 'pausar' | 'seguir' }): Promise<R<unknown> & { eventos?: EventoVideo[] }>
    }
    carpetas: { confirmarVinculo(p: { drive_id: string; id_crm: IdCrm; actor: Persona }): Promise<R<unknown>> }
  }
  /** Bloque A: "guiones enviados" arranca el seguimiento e01 de la tanda del guion (crea los videos que falten). */
  motor: { iniciarTanda(p: { id_crm: IdCrm; tanda_guion: number; actor: Persona }): Promise<{ videos: Video[]; eventos: EventoVideo[] }> }
  /** Bloque C: la ficha de marca (validarFicha es pura; guardarMarca escribe con versión). */
  marca: {
    validarFicha(x: unknown): { ok: true; ficha: Omit<FichaMarca, 'version' | 'actualizado'> } | { ok: false; error: string; campo: string }
    guardarMarca(id: IdCrm, ficha: Omit<FichaMarca, 'version' | 'actualizado'>, version: number | null, actor: Persona): Promise<R<FichaMarca>>
  }
  /** Bloque C (sobre aplicarPedidoCliente de A): P6 en una sola sentencia. */
  pedidos: {
    confirmar(p: { pedido_id: number; version: number; elegidas: number[]; actor: Persona }): Promise<R<{ resultado: 'correccion' | 'espera_tomas' | 'nada'; eventos: EventoVideo[]; extra: AvisoMotor[] }>>
    autorizar(p: { pedido_id: number; version: number; actor: Persona }): Promise<R<{ evento?: EventoVideo; eventos?: EventoVideo[] }>>
    descartar(p: { pedido_id: number; version: number; nota: string; actor: Persona }): Promise<R<{ evento?: EventoVideo; eventos?: EventoVideo[] }>>
  }
  /** f05 / f06: cerrar lo que el bot leyó del grupo Contenido (db/lecturas.ts). false = otra persona ya lo cerró o cambió. */
  lecturas?: { resolver(p: { id: number; version: number; quien: string; estado: 'descartada' | 'usada' }): Promise<boolean> }
  modo: 'dry' | 'real'
  ahora?: () => Date
  env?: Entorno
}
export interface SesionEdicion { email: string; nombre: string; esDePrueba?: boolean; rol?: string; admin?: boolean }

export interface ResultadoItem { video_id: number; ok: boolean; mensaje: string; codigo?: string; version?: number }
export interface CuerpoRespuesta {
  ok: boolean; mensaje: string; codigo?: string; campo?: string; version?: number; dry?: boolean; habria?: unknown
  actual?: { version: number; estado: string } | null; resultados?: ResultadoItem[]; pedido_id?: number
}
export interface RespuestaEdicion { status: number; cuerpo: CuerpoRespuesta; eventos?: EventoVideo[]; extra?: AvisoMotor[] }

const responder = (status: number, ok: boolean, mensaje: string, extra: Partial<CuerpoRespuesta> = {}, efectos: Pick<RespuestaEdicion, 'eventos' | 'extra'> = {}): RespuestaEdicion =>
  ({ status, cuerpo: { ok, mensaje, ...extra }, ...efectos })

export const CONFLICTO = 'Otra persona lo cambió mientras tanto: recargá la página para ver lo último.'
const SOLO_LECTURA = 'Estás en modo lectura: los cambios los hacen Aylu, Tomás y René.'

const actorDe = (p: Persona): Actor => ({ tipo: 'persona', ...p })
const resumenVideo = (v: Video | null | undefined) => (v ? { version: v.version, estado: v.estado } : null)

/** De un ResultadoEscritura del repositorio a la respuesta HTTP. */
function deResultado<T>(r: R<T>, siOk: (a: T) => RespuestaEdicion, actualVideo?: (a: T | null) => Video | null | undefined): RespuestaEdicion {
  if (r.ok) return siOk(r.actual)
  if (r.motivo === 'no_existe') return responder(404, false, 'Ya no está: recargá la página.', { codigo: 'no_existe' })
  if (r.motivo === 'conflicto') return responder(409, false, CONFLICTO, { codigo: 'conflicto', actual: resumenVideo(actualVideo?.(r.actual)) })
  return responder(409, false, r.detalle ? `No se puede: ${r.detalle}.` : 'No se puede hacer eso ahora.', { codigo: 'no_permitido' })
}
const videoDe = (a: { video: Video } | null) => a?.video ?? null

/** ¿El rol tiene alguna fila de la tabla de transiciones para esta acción? (si no, 403; si la tiene pero no se puede, 409) */
const rolPuedeAccion = (rol: RolEdicion, accion: AccionVideo) => TRANSICIONES.some(t => t.accion === accion && (t.quien as readonly string[]).includes(rol))

/** El contexto de puede() con lo que se leyó (igual que el repositorio: notas sin tildar = enviadas de la ronda en curso). */
export function contextoDe(d: DetalleLeido, extra: { linkEditado?: boolean } = {}): Omit<ContextoTransicion, 'motivo' | 'nota' | 'cita'> {
  const ronda = d.video.ronda_interna + d.video.ronda_cliente
  return {
    crudos: d.crudos.filter(a => !a.borrado && a.tipo === 'crudo').length,
    notasNuevas: d.notas.filter(n => !n.enviada).length,
    notasSinTildar: d.notas.filter(n => n.enviada && n.ronda === ronda && !n.tilde).length,
    linkEditado: !!d.video.editado?.url || !!extra.linkEditado,
  }
}

const MENSAJE_MOVIDA: Partial<Record<AccionVideo, string>> = {
  sirve: 'Listo: pasó a Para editar.',
  regrabar: 'Marcado para regrabar: copiá el texto para el cliente y tocá «enviado».',
  listo: 'Listo: pasó a Editado.',
  pedir_correccion: 'Listo: pasó a Corrección con las notas.',
  corregido: 'Listo: pasó a Corregido.',
  para_cliente: 'Listo: pasó a Con el cliente. Copiá el link para el cliente y tocá «enviado».',
  ok_cliente: 'Listo: Aprobado. Le avisamos a Valen.',
}

async function moverUno(deps: DepsEdicion, persona: Persona, p: { video_id: number; version: number; transicion: AccionVideo; motivo?: ContextoTransicion['motivo']; nota?: string; cita?: string; editado_url?: string }): Promise<RespuestaEdicion> {
  const rol = persona.rol
  if (!rolPuedeAccion(rol, p.transicion)) return responder(403, false, 'Ese movimiento no lo podés hacer vos.', { codigo: 'no_permitido_rol' })
  const d = await deps.repo.videos.leerVideo(p.video_id)
  if (!d) return responder(404, false, 'Ese video ya no está.', { codigo: 'no_existe' })
  if (d.video.version !== p.version) return responder(409, false, CONFLICTO, { codigo: 'conflicto', actual: resumenVideo(d.video) })
  const conLink = !!p.editado_url && (p.transicion === 'listo' || p.transicion === 'para_cliente')
  const ctx: ContextoTransicion = { ...contextoDe(d, { linkEditado: conLink }), motivo: p.motivo, nota: p.nota, cita: p.cita }
  const r = puede(rol, p.transicion, d.video, ctx)
  if (!r.ok) return responder(409, false, `No se puede: ${r.motivo === 'tope' ? 'es la 3.ª ronda del cliente y la autoriza Tomás' : r.motivo}.`, { codigo: 'no_permitido' })
  if (deps.modo === 'dry') {
    return responder(200, true, `Modo prueba: pasaría de ${ETIQUETA_ESTADO[d.video.estado]} a ${ETIQUETA_ESTADO[r.a]} (no se guardó).`, { dry: true, habria: { video_id: p.video_id, accion: p.transicion, de: d.video.estado, a: r.a } })
  }
  const res = await deps.repo.videos.moverVideo({
    id: p.video_id, version: p.version, accion: p.transicion, actor: actorDe(persona),
    ctx: { motivo: p.motivo, nota: p.nota, cita: p.cita }, nota: p.nota,
    cambios: conLink ? { editado: { archivo_id: null, url: p.editado_url! } } : undefined,
  })
  return deResultado(res, a => {
    const sinLink = p.transicion === 'listo' && a.video.bloqueo === 'sin_link_editado'
    const mensaje = sinLink ? 'Listo: pasó a Editado. Falta el link al editado: vinculalo cuando esté en Drive.' : MENSAJE_MOVIDA[p.transicion] ?? `Listo: ${ETIQUETA_ESTADO[a.video.estado]}.`
    return responder(200, true, mensaje, { version: a.video.version }, { eventos: [a.evento] })
  }, videoDe)
}

const NO_ROL: Record<Permiso, string> = {
  vincular: 'Los archivos los vinculan Aylu y Tomás.', aceptar_editado: 'El editado lo aceptan René, Aylu y Tomás.', nota: 'Las notas las escriben Aylu y Tomás.',
  tildar: 'Las notas las tildan René, Aylu y Tomás.', envio: 'Las constancias de envío las dejan Aylu y Tomás.', prioridad: 'La prioridad la cambian Aylu y Tomás.',
  bloqueo: 'Ese bloqueo lo manejan Aylu y Tomás.', bloqueo_otro: 'Los bloqueos los marcan Aylu, Tomás y René.', guiones_enviados: '«Guiones enviados» lo marcan Aylu y Tomás.',
  paso: 'Los pasos del seguimiento los marcan Aylu y Tomás.', decidir_paso: 'La decisión del día 9 es de Tomás.', pedido: 'Los pedidos del cliente los cargan Aylu y Tomás.',
  autorizar_ronda: 'La 3.ª ronda del cliente la autoriza Tomás.', marca: 'La ficha de marca la cargan Aylu y Tomás.', vinculo_carpeta: 'Los vínculos de carpetas los confirman Aylu y Tomás.',
  tope: 'El bloqueo del tope de rondas lo maneja Tomás.',
}
const sinPermiso = (p: Permiso) => responder(403, false, NO_ROL[p], { codigo: 'no_permitido_rol' })
const dry = (mensaje: string, habria: unknown) => responder(200, true, `Modo prueba: ${mensaje} (no se guardó).`, { dry: true, habria })

export async function atenderAccion(deps: DepsEdicion, cuerpo: unknown, sesion: SesionEdicion): Promise<RespuestaEdicion> {
  const v = validarPedido(cuerpo)
  if (!v.ok) return responder(422, false, v.error, { codigo: 'validacion', campo: v.campo })
  if (sesion.esDePrueba) return responder(403, false, 'El usuario de prueba de desarrollo no escribe en la base. Para ver la pantalla en local usá ?demo=1.', { codigo: 'usuario_de_prueba' })
  const env = deps.env ?? process.env
  const rol = rolEdicion(sesion, env)
  const persona = personaDeSesion(sesion, env)
  if (rol === 'lector' || !persona) return responder(403, false, SOLO_LECTURA, { codigo: 'solo_lectura' })
  const p: PedidoEdicion = v.pedido
  const actor = actorDe(persona)
  const enDry = deps.modo === 'dry'
  try {
    switch (p.accion) {
      case 'mover':
        return await moverUno(deps, persona, p)

      case 'mover_lote': {
        if (!rolPuedeAccion(rol, p.transicion)) return responder(403, false, 'Ese movimiento no lo podés hacer vos.', { codigo: 'no_permitido_rol' })
        const resultados: ResultadoItem[] = []
        const eventos: EventoVideo[] = []
        for (const it of p.items) {
          const r = await moverUno(deps, persona, { video_id: it.video_id, version: it.version, transicion: p.transicion, ...(p.cita ? { cita: p.cita } : {}) })
          resultados.push({ video_id: it.video_id, ok: r.cuerpo.ok, mensaje: r.cuerpo.mensaje, codigo: r.cuerpo.codigo, version: r.cuerpo.version })
          if (r.eventos) eventos.push(...r.eventos)
        }
        const bien = resultados.filter(x => x.ok).length
        const mensaje = enDry ? `Modo prueba: se moverían ${bien} de ${resultados.length} (no se guardó).`
          : bien === resultados.length ? `Listo: ${bien === 1 ? 'se movió el video' : `se movieron los ${bien} videos`}.` : `Se movieron ${bien} de ${resultados.length}: los demás cambiaron o no se podían mover (recargá).`
        return responder(200, bien === resultados.length, mensaje, { resultados, ...(enDry ? { dry: true } : {}) }, { eventos })
      }

      case 'vincular_archivo': {
        if (!tienePermiso(rol, 'vincular')) return sinPermiso('vincular')
        if (enDry) return dry(p.video_id ? 'el archivo quedaría vinculado al video' : 'el archivo quedaría sin video', { archivo_id: p.archivo_id, video_id: p.video_id })
        const r = await deps.repo.archivos.vincularArchivo({ archivo_id: p.archivo_id, video_id: p.video_id, actor })
        return deResultado(r, () => responder(200, true, p.video_id ? 'Listo: archivo vinculado.' : 'Listo: archivo desvinculado.'))
      }

      case 'aceptar_editado': {
        if (!tienePermiso(rol, 'aceptar_editado')) return sinPermiso('aceptar_editado')
        const d = await deps.repo.videos.leerVideo(p.video_id)
        if (!d) return responder(404, false, 'Ese video ya no está.', { codigo: 'no_existe' })
        if (d.video.version !== p.version) return responder(409, false, CONFLICTO, { codigo: 'conflicto', actual: resumenVideo(d.video) })
        const archivo = d.editados.find(a => a.id === p.archivo_id && a.tipo === 'editado' && !a.borrado)
        if (!archivo) return responder(404, false, 'Ese archivo no es un editado propuesto para este video.', { codigo: 'no_existe' })
        if (archivo.video_id && archivo.video_id !== p.video_id) return responder(409, false, 'Ese editado ya está vinculado a otro video.', { codigo: 'no_permitido' })
        const conListo = d.video.estado === 'para_editar'
        if (!conListo && d.video.estado !== 'correccion' && rol === 'rene') return responder(409, false, 'El editado se acepta con el video en Para editar o en Corrección.', { codigo: 'no_permitido' })
        if (enDry) return dry(conListo ? 'el editado quedaría vinculado y el video pasaría a Editado' : 'el editado quedaría vinculado', { archivo_id: p.archivo_id, video_id: p.video_id, listo: conListo })
        const r = await deps.repo.archivos.vincularArchivo({ archivo_id: p.archivo_id, video_id: p.video_id, actor })
        if (!r.ok) return deResultado(r, () => responder(200, true, ''))
        // El link del editado en el video (si el repositorio no lo dejó puesto al vincular)
        let actual = (await deps.repo.videos.leerVideo(p.video_id))?.video ?? null
        if (!actual) return responder(404, false, 'Ese video ya no está.', { codigo: 'no_existe' })
        const eventos: EventoVideo[] = []
        if (!actual.editado?.url) {
          const url = `https://drive.google.com/file/d/${encodeURIComponent(archivo.drive_id)}/view`
          const u = await deps.repo.videos.actualizarVideo({ id: actual.id, version: actual.version, actor, cambios: { editado: { archivo_id: archivo.id, url } }, tipo: 'editado_vinculado' })
          if (!u.ok) return deResultado(u, () => responder(200, true, ''), videoDe)
          actual = u.actual.video
          eventos.push(u.actual.evento)
        }
        if (!conListo) return responder(200, true, 'Listo: editado vinculado.', { version: actual.version }, { eventos })
        const m = await moverUno(deps, persona, { video_id: actual.id, version: actual.version, transicion: 'listo' })
        if (!m.cuerpo.ok) return { ...m, cuerpo: { ...m.cuerpo, mensaje: `El editado quedó vinculado, pero no se pudo marcar listo: ${m.cuerpo.mensaje}` }, eventos: [...eventos, ...(m.eventos ?? [])] }
        return { ...m, cuerpo: { ...m.cuerpo, mensaje: 'Listo: editado vinculado y video en Editado.' }, eventos: [...eventos, ...(m.eventos ?? [])] }
      }

      case 'nota_crear': {
        if (!tienePermiso(rol, 'nota')) return sinPermiso('nota')
        if (enDry) return dry('la nota quedaría guardada', { video_id: p.video_id, tipo: p.tipo })
        const r = await deps.repo.videos.crearNota({ video_id: p.video_id, actor: persona, nota: { segundo: p.segundo, hasta: p.hasta, tipo: p.tipo, texto: p.texto, imagen_url: p.imagen_url, origen: 'aylu' } })
        if (!r.ok) return deResultado(r, () => responder(200, true, ''))
        const n = r.actual
        if (!n.enviada) return responder(200, true, 'Nota guardada: sale con «Pedir corrección».', { version: n.version })
        // Sumada a la corrección en curso: el evento va a los avisos (rene_correccion, agrupado a los 10 minutos)
        let evento = r.evento ?? null
        if (!evento) {
          // La nota ya quedó guardada: si leer el video falla, se responde igual (sin el aviso)
          let d: DetalleLeido | null = null
          try { d = await deps.repo.videos.leerVideo(p.video_id) } catch { d = null }
          if (d) evento = { id: 0, video_id: d.video.id, id_crm: d.video.id_crm, cliente: d.video.cliente, tipo: 'nota', de: null, a: null, actor, nota: '', datos: { nota_id: n.id, ronda_abierta: true }, cuando: (deps.ahora?.() ?? new Date()).toISOString() }
        }
        return responder(200, true, evento ? 'Nota sumada a la corrección en curso (le avisamos a René).' : 'Nota sumada a la corrección en curso.', { version: n.version }, { eventos: evento ? [evento] : [] })
      }
      case 'nota_editar': {
        if (!tienePermiso(rol, 'nota')) return sinPermiso('nota')
        if (enDry) return dry('la nota quedaría cambiada', { nota_id: p.nota_id })
        const r = await deps.repo.videos.editarNota({ id: p.nota_id, version: p.version, actor: persona, cambios: p.cambios })
        return deResultado(r, n => responder(200, true, 'Nota cambiada.', { version: n.version }))
      }
      case 'nota_borrar': {
        if (!tienePermiso(rol, 'nota')) return sinPermiso('nota')
        if (enDry) return dry('la nota quedaría borrada', { nota_id: p.nota_id })
        const r = await deps.repo.videos.borrarNota({ id: p.nota_id, version: p.version, actor: persona })
        return deResultado(r, () => responder(200, true, 'Nota borrada.'))
      }
      case 'nota_tildar': {
        if (!tienePermiso(rol, 'tildar')) return sinPermiso('tildar')
        if (enDry) return dry(p.tildada ? 'la nota quedaría tildada' : 'la nota quedaría sin tilde', { nota_id: p.nota_id, tildada: p.tildada })
        const r = await deps.repo.videos.tildarNota({ id: p.nota_id, version: p.version, tildada: p.tildada, actor: persona })
        return deResultado(r, n => responder(200, true, p.tildada ? 'Tildada.' : 'Tilde quitado.', { version: n.version }))
      }

      case 'envio_registrado': {
        if (!tienePermiso(rol, 'envio')) return sinPermiso('envio')
        if (enDry) return dry(p.tipo === 'regrabar' ? 'quedaría la constancia y los videos volverían a Esperando crudos' : 'quedaría la constancia del link final', { tipo: p.tipo, videos: p.items.map(i => i.video_id) })
        const rs = await deps.repo.videos.registrarEnvio({ items: p.items.map(i => ({ id: i.video_id, version: i.version })), tipo: p.tipo, texto: p.texto, actor: persona })
        const resultados: ResultadoItem[] = rs.map((r, i) => r.ok
          ? { video_id: p.items[i].video_id, ok: true, mensaje: 'ok', version: r.actual.video.version }
          : { video_id: p.items[i].video_id, ok: false, mensaje: r.motivo === 'conflicto' ? CONFLICTO : r.detalle ?? r.motivo, codigo: r.motivo })
        const eventos = rs.flatMap(r => (r.ok ? [r.actual.evento] : []))
        const bien = resultados.filter(x => x.ok).length
        const ok = bien === resultados.length
        return responder(ok ? 200 : bien ? 200 : 409, ok, ok ? `Constancia guardada${p.tipo === 'regrabar' ? ': vuelven a Esperando crudos y sigue el seguimiento' : ''}.` : `Se guardó ${bien} de ${resultados.length}: recargá para ver lo último.`,
          { resultados, version: resultados.length === 1 ? resultados[0].version : undefined, ...(ok || bien ? {} : { codigo: resultados[0]?.codigo === 'conflicto' ? 'conflicto' : 'no_permitido' }) }, { eventos })
      }

      case 'prioridad': {
        if (!tienePermiso(rol, 'prioridad')) return sinPermiso('prioridad')
        if (enDry) return dry(`la prioridad quedaría en ${p.prioridad}`, { video_id: p.video_id, prioridad: p.prioridad })
        const r = await deps.repo.videos.actualizarVideo({ id: p.video_id, version: p.version, actor, cambios: { prioridad: p.prioridad }, tipo: 'prioridad', datos: { prioridad: p.prioridad } })
        return deResultado(r, a => responder(200, true, 'Prioridad cambiada.', { version: a.video.version }, { eventos: [a.evento] }), videoDe)
      }

      case 'bloqueo': {
        // René solo marca "otro" con motivo (le avisa a Aylu); el del tope de rondas lo maneja Tomás
        if (rol === 'rene' && p.bloqueo !== 'otro') return sinPermiso('bloqueo')
        if (!tienePermiso(rol, 'bloqueo_otro')) return sinPermiso('bloqueo_otro')
        const d = await deps.repo.videos.leerVideo(p.video_id)
        if (!d) return responder(404, false, 'Ese video ya no está.', { codigo: 'no_existe' })
        if (d.video.version !== p.version) return responder(409, false, CONFLICTO, { codigo: 'conflicto', actual: resumenVideo(d.video) })
        const tocaTope = p.bloqueo === 'tope_rondas_cliente' || d.video.bloqueo === 'tope_rondas_cliente'
        if (tocaTope && !tienePermiso(rol, 'tope')) return sinPermiso('tope')
        if (rol === 'rene' && d.video.bloqueo && d.video.bloqueo !== 'otro') return responder(409, false, 'El video ya tiene otro bloqueo: avisale a Aylu.', { codigo: 'no_permitido' })
        if (p.bloqueo === null && !d.video.bloqueo) return responder(409, false, 'El video no tiene bloqueo.', { codigo: 'no_permitido' })
        if (enDry) return dry(p.bloqueo ? 'el video quedaría bloqueado' : 'se sacaría el bloqueo', { video_id: p.video_id, bloqueo: p.bloqueo })
        const r = await deps.repo.videos.actualizarVideo({ id: p.video_id, version: p.version, actor, cambios: { bloqueo: p.bloqueo, motivo_bloqueo: p.motivo }, tipo: 'bloqueo', nota: p.motivo, datos: { bloqueo: p.bloqueo, de: d.video.bloqueo } })
        return deResultado(r, a => responder(200, true, p.bloqueo ? (rol === 'rene' ? 'Bloqueo marcado: le avisamos a Aylu.' : 'Bloqueo marcado.') : 'Bloqueo quitado.', { version: a.video.version }, { eventos: [a.evento] }), videoDe)
      }

      case 'guiones_enviados': {
        if (!tienePermiso(rol, 'guiones_enviados')) return sinPermiso('guiones_enviados')
        if (enDry) return dry(`arrancaría el seguimiento de la tanda ${p.tanda_guion}`, { id_crm: p.id_crm, tanda_guion: p.tanda_guion })
        const r = await deps.motor.iniciarTanda({ id_crm: p.id_crm, tanda_guion: p.tanda_guion, actor: persona })
        const n = r.videos.length
        return responder(200, true, n ? `Listo: arrancó el seguimiento de la tanda ${p.tanda_guion} (${n} video${n === 1 ? '' : 's'} esperando crudos).` : `No hay guiones de la tanda ${p.tanda_guion} esperando grabación.`, {}, { eventos: r.eventos })
      }

      case 'paso_hecho': {
        if (!tienePermiso(rol, 'paso')) return sinPermiso('paso')
        if (enDry) return dry('el paso quedaría hecho', { paso_id: p.paso_id })
        const r = await deps.repo.seguimientos.marcarPaso({ id: p.paso_id, version: p.version, actor: persona, nota: p.nota, texto: p.texto })
        return deResultado(r, () => responder(200, true, 'Listo: paso marcado como hecho.'))
      }
      case 'paso_decision': {
        if (!tienePermiso(rol, 'decidir_paso')) return sinPermiso('decidir_paso')
        if (enDry) return dry(p.decision === 'pausar' ? 'se pausarían los videos que esperan crudos y se cerraría el ciclo' : 'seguirían los recordatorios cada 4 días hábiles', { paso_id: p.paso_id, decision: p.decision })
        const r = await deps.repo.seguimientos.decidirPaso({ id: p.paso_id, version: p.version, actor: persona, decision: p.decision })
        return deResultado(r, () => responder(200, true, p.decision === 'pausar' ? 'Listo: pausado. Los videos que esperaban crudos quedaron en pausa.' : 'Listo: siguen los recordatorios cada 4 días hábiles.', {}, { eventos: r.eventos ?? [] }))
      }

      case 'pedido_confirmar': {
        if (!tienePermiso(rol, 'pedido')) return sinPermiso('pedido')
        if (enDry) return dry(p.elegidas.length ? `se cargarían ${p.elegidas.length} notas del cliente` : 'no se cargaría nada (no cuenta como ronda)', { pedido_id: p.pedido_id, elegidas: p.elegidas })
        const r = await deps.pedidos.confirmar({ pedido_id: p.pedido_id, version: p.version, elegidas: p.elegidas, actor: persona })
        return deResultado(r, a => {
          const mensaje = a.resultado === 'correccion' ? `Listo: pasó a Corrección con ${p.elegidas.length} nota${p.elegidas.length === 1 ? '' : 's'} del cliente.`
            : a.resultado === 'espera_tomas' ? 'Es la 3.ª ronda del cliente: queda esperando el OK de Tomás (le avisamos). Al cliente no se le dice nada.'
              : 'No había nada para corregir: no cuenta como ronda.'
          return responder(200, true, mensaje, {}, { eventos: a.eventos, extra: a.extra })
        })
      }
      case 'pedido_descartar': {
        if (!tienePermiso(rol, 'pedido')) return sinPermiso('pedido')
        if (enDry) return dry('el pedido quedaría descartado', { pedido_id: p.pedido_id })
        const r = await deps.pedidos.descartar({ pedido_id: p.pedido_id, version: p.version, nota: p.nota, actor: persona })
        return deResultado(r, a => responder(200, true, 'Pedido descartado.', {}, { eventos: a.eventos ?? (a.evento ? [a.evento] : []) }))
      }
      case 'ronda_autorizar': {
        if (!tienePermiso(rol, 'autorizar_ronda')) return sinPermiso('autorizar_ronda')
        if (enDry) return dry('el video pasaría a Corrección con las notas del cliente', { pedido_id: p.pedido_id })
        const r = await deps.pedidos.autorizar({ pedido_id: p.pedido_id, version: p.version, actor: persona })
        return deResultado(r, a => responder(200, true, 'Listo: autorizaste la ronda y el video pasó a Corrección.', {}, { eventos: a.eventos ?? (a.evento ? [a.evento] : []) }))
      }

      case 'marca_guardar': {
        if (!tienePermiso(rol, 'marca')) return sinPermiso('marca')
        const f = deps.marca.validarFicha({ ...(p.ficha as Record<string, unknown>), id_crm: p.id_crm })
        if (!f.ok) return responder(422, false, f.error, { codigo: 'validacion', campo: `ficha.${f.campo}` })
        if (enDry) return dry('la ficha de marca quedaría guardada', { id_crm: p.id_crm, colores: f.ficha.colores.length })
        const r = await deps.marca.guardarMarca(p.id_crm, f.ficha, p.version, persona)
        return deResultado(r, m => responder(200, true, 'Ficha de marca guardada.', { version: m.version }))
      }

      case 'vinculo_confirmar': {
        if (!tienePermiso(rol, 'vinculo_carpeta')) return sinPermiso('vinculo_carpeta')
        if (enDry) return dry('la carpeta quedaría vinculada al cliente', { carpeta_id: p.carpeta_id, id_crm: p.id_crm })
        const r = await deps.repo.carpetas.confirmarVinculo({ drive_id: p.carpeta_id, id_crm: p.id_crm, actor: persona })
        return deResultado(r, () => responder(200, true, `Listo: la carpeta quedó vinculada a ${p.id_crm}.`))
      }

      case 'lectura_resolver': {
        if (!tienePermiso(rol, 'pedido')) return sinPermiso('pedido')
        if (enDry) return dry(p.estado === 'descartada' ? 'el mensaje del cliente quedaría descartado' : 'el mensaje del cliente quedaría resuelto', { lectura_id: p.lectura_id })
        if (!deps.lecturas) return responder(503, false, 'La lectura del grupo Contenido no está disponible.', { codigo: 'base' })
        const ok = await deps.lecturas.resolver({ id: p.lectura_id, version: p.version, quien: persona.nombre, estado: p.estado })
        return ok ? responder(200, true, p.estado === 'descartada' ? 'Listo: mensaje descartado.' : 'Listo: mensaje resuelto.') : responder(409, false, CONFLICTO, { codigo: 'conflicto' })
      }
    }
  } catch (e) {
    const r = errorConocido(e)
    if (r) return r
    throw e
  }
}

/** Errores que la API traduce: entrada inválida del repositorio (422), pedidos de C (409/404/403) y la base caída (503). */
function errorConocido(e: unknown): RespuestaEdicion | null {
  const x = e as { name?: string; campo?: unknown; motivo?: unknown; detalle?: unknown; message?: unknown }
  if (x?.name === 'ClienteArchivadoError' || x?.name === 'EstadoCrmInciertoError') return responder(x.name === 'ClienteArchivadoError' ? 409 : 503, false, String(x.message), { codigo: x.name === 'ClienteArchivadoError' ? 'cliente_archivado' : 'crm_incierto' })
  if (x?.name === 'ErrorEntradaEdicion') {
    // Los mensajes de validación del repositorio los escribe el código (no traen datos de la base): se muestran, sin mails
    const m = typeof x.message === 'string' ? x.message.replace(/[^\s@]+@[^\s@]+/g, '[mail]').slice(0, 200) : ''
    return responder(422, false, m ? `No se puede: ${m}.` : 'Dato inválido.', { codigo: 'validacion', campo: String(x.campo ?? '') })
  }
  if (x?.name === 'ErrorPedido') {
    if (x.motivo === 'no_existe') return responder(404, false, 'Ese pedido ya no está.', { codigo: 'no_existe' })
    if (x.motivo === 'conflicto') return responder(409, false, CONFLICTO, { codigo: 'conflicto' })
    return responder(409, false, x.detalle ? `No se puede: ${String(x.detalle)}.` : 'No se puede hacer eso ahora.', { codigo: 'no_permitido' })
  }
  if (e instanceof ErrorTransitorio) return responder(503, false, 'La base no respondió. Probá de nuevo en un minuto.', { codigo: 'base' })
  return null
}

// ── f05: la propuesta de notas a partir del pedido del cliente (POST /api/edicion/pedido) ──
export interface Propuesta { propuesta: NotaPropuesta[]; modelo: string | null; version: string; tokens: { in: number; out: number } | null; aviso?: string | null }
export interface DepsPropuesta {
  leerVideo(id: number): Promise<DetalleLeido | null>
  /** El guion del doc que corresponde al video (null si no hay doc o no se ubica). */
  leerGuion(v: Video): Promise<GuionDoc | null>
  /** proponerNotas del bloque C, con Claude o sin él (dry o sin key: propuesta vacía). */
  proponer(p: { texto: string; video: Video; guion: GuionDoc | null }): Promise<Propuesta>
  /** Guarda el pedido como `propuesto`. */
  guardar(p: { video_id: number; ronda: number; texto: string; propuesta: NotaPropuesta[]; modelo: string | null; version_prompt: string | null; actor: Persona }): Promise<R<PedidoCliente> | PedidoCliente>
  modo: 'dry' | 'real'
  env?: Entorno
}

export async function atenderPropuesta(deps: DepsPropuesta, cuerpo: unknown, sesion: SesionEdicion): Promise<RespuestaEdicion> {
  const v = validarPropuesta(cuerpo)
  if (!v.ok) return responder(422, false, v.error, { codigo: 'validacion', campo: v.campo })
  if (sesion.esDePrueba) return responder(403, false, 'El usuario de prueba de desarrollo no escribe en la base. Para ver la pantalla en local usá ?demo=1.', { codigo: 'usuario_de_prueba' })
  const env = deps.env ?? process.env
  const persona = personaDeSesion(sesion, env)
  if (!persona) return responder(403, false, SOLO_LECTURA, { codigo: 'solo_lectura' })
  if (!tienePermiso(persona.rol, 'pedido')) return sinPermiso('pedido')
  try {
    const d = await deps.leerVideo(v.pedido.video_id)
    if (!d) return responder(404, false, 'Ese video ya no está.', { codigo: 'no_existe' })
    if (d.video.estado !== 'con_cliente') return responder(409, false, 'El pedido del cliente se carga con el video «Con el cliente».', { codigo: 'no_permitido' })
    if (d.video.bloqueo === 'tope_rondas_cliente') return responder(409, false, 'Este video ya tiene un pedido esperando el OK de Tomás.', { codigo: 'no_permitido' })
    // Notas a mano: no se llama a Claude; la propuesta son esas (sin cita: las escribió Aylu)
    const aMano = v.pedido.notas
    // Modo prueba (EDICION_MODO≠real o ?dry=1): nunca se llama a Claude ni se guarda
    if (deps.modo === 'dry') {
      return dry(aMano ? `quedaría el pedido con ${aMano.length} nota${aMano.length === 1 ? '' : 's'} cargada${aMano.length === 1 ? '' : 's'} a mano` : 'quedaría el pedido para separar en notas (en modo prueba no se llama a Claude)', { video_id: v.pedido.video_id, notas: aMano?.length ?? 0 })
    }
    const prop: Propuesta = aMano
      ? { propuesta: aMano.map(n => ({ texto: n.texto, tipo: n.tipo, segundo: n.segundo, hasta: n.hasta, afecta_rendimiento: n.afecta_rendimiento, motivo: 'cargada a mano', cita: '' })), modelo: null, version: 'a_mano', tokens: null, aviso: null }
      : await deps.proponer({ texto: v.pedido.texto, video: d.video, guion: await deps.leerGuion(d.video).catch(() => null) })
    const n = prop.propuesta.length
    const g = await deps.guardar({ video_id: d.video.id, ronda: d.video.ronda_cliente + 1, texto: v.pedido.texto, propuesta: prop.propuesta, modelo: prop.modelo, version_prompt: prop.version, actor: persona })
    const pedido = 'ok' in g ? (g.ok ? g.actual : null) : g
    if (!pedido) return deResultado(g as R<PedidoCliente>, () => responder(200, true, ''))
    const sinPropuesta = prop.aviso ? `No salió una propuesta automática (${prop.aviso}).` : 'No salió una propuesta automática: cargá las notas a mano.'
    const conNotas = aMano ? `Pedido guardado con ${n} nota${n === 1 ? '' : 's'} cargada${n === 1 ? '' : 's'} a mano: revisalas y confirmá.` : `Claude separó el pedido en ${n} nota${n === 1 ? '' : 's'}: revisalas, destildá lo que no va y confirmá.`
    return responder(200, true, n ? conNotas : sinPropuesta, { pedido_id: pedido.id, version: pedido.version })
  } catch (e) {
    const r = errorConocido(e)
    if (r) return r
    throw e
  }
}

// ── La barrera HTTP (el POST de las dos rutas, entero) ──
export interface DepsPost<D> {
  /** 401 sin sesión, 403 sin la sección (exigirAccesoApi de lib/auth/acceso.ts); null = puede seguir. */
  exigirAcceso(req: Request): Response | null
  sesion(req: Request): SesionEdicion | null
  baseLista(): boolean
  accion: D
  /** Los avisos de Discord (bloque C), después de responder (after() en la ruta). Nunca lanza. */
  avisar?(eventos: EventoVideo[], extra: AvisoMotor[]): void
}

const CABECERAS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const respuesta = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: CABECERAS })

/** ¿El Origin es del mismo host que la petición? (host exacto con puerto; ni prefijos ni x-forwarded-host) */
export function mismoOrigen(h: { get(n: string): string | null }): boolean {
  const origen = h.get('origin'), host = h.get('host')
  if (!origen || !host) return false
  try {
    return new URL(origen).host === host
  } catch {
    return false
  }
}

/** ?dry=1 en la URL fuerza el modo prueba en cualquier ruta. */
export const pidioDry = (req: Request): boolean => {
  try { return new URL(req.url).searchParams.get('dry') === '1' } catch { return false }
}

async function barrera<D extends { modo: 'dry' | 'real' }>(req: Request, deps: DepsPost<D>, atender: (d: D, cuerpo: unknown, s: SesionEdicion) => Promise<RespuestaEdicion>, nombre: string): Promise<Response> {
  const rechazo = deps.exigirAcceso(req)
  if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return respuesta({ ok: false, mensaje: 'Se espera JSON.' }, 415)
  const texto = await req.text().catch(() => null)
  if (texto === null) return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400)
  if (texto.length > LARGO_MAX_CUERPO) return respuesta({ ok: false, mensaje: 'El pedido es demasiado grande.' }, 413)
  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400)
  }
  const sesion = deps.sesion(req)
  if (!sesion) return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401)
  if (!deps.baseLista()) return respuesta({ ok: false, mensaje: 'La base del Despacho no está configurada.' }, 503)
  const d: D = pidioDry(req) ? { ...deps.accion, modo: 'dry' } : deps.accion
  try {
    const r = await atender(d, cuerpo, sesion)
    if (deps.avisar && (r.eventos?.length || r.extra?.length)) {
      try { deps.avisar(r.eventos ?? [], r.extra ?? []) } catch (e) { console.error(`${nombre}: no se pudieron programar los avisos —`, ((e as Error)?.message ?? '').slice(0, 200)) }
    }
    return respuesta(r.cuerpo, r.status)
  } catch (e) {
    console.error(`${nombre}: no se pudo guardar —`, ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/[^\s@]+@[^\s@]+/g, '[mail]').slice(0, 200))
    return respuesta({ ok: false, mensaje: 'No se pudo guardar. Probá de nuevo en un minuto.' }, 500)
  }
}

export const atenderPost = (req: Request, deps: DepsPost<DepsEdicion>): Promise<Response> => barrera(req, deps, atenderAccion, 'API edición')
export const atenderPostPropuesta = (req: Request, deps: DepsPost<DepsPropuesta>): Promise<Response> => barrera(req, deps, atenderPropuesta, 'API edición (pedido)')
