// ── API de la pantalla de kickoff (POST /api/clientes/<id>/kickoff): barrera HTTP, validar, decidir y escribir con condición ──
// La ruta (app/api/clientes/[id]/kickoff/route.ts) solo arma las dependencias reales; TODO lo demás está acá, con las
// dependencias INYECTADAS (acceso, sesión, lectura y escrituras de registro.ts, reloj) para probarlo sin base ni Next
// (scripts/test-bot-kickoff-vista.mjs).
// atenderPost (la barrera HTTP, en este orden; nada llega a la base si algo falla):
//   1. sesión de Google con permiso de Clientes (exigirAccesoApi de lib/auth/acceso.ts: 401 sin sesión, 403 sin el rol);
//   2. mismo origen: Origin del mismo host que la petición (los navegadores siempre lo mandan en un POST) → si no, 403;
//   3. Content-Type application/json → si no, 415; ID del cliente con forma de ID del CRM → si no, 404;
//   4. cuerpo de hasta LARGO_MAX_CUERPO caracteres → si no, 413; JSON → si no, 400; la base configurada → si no, 503.
// atenderAccion (la decisión):
//   1. validarPedido (revision.ts): estricto, y sin "quién" en el cuerpo (sale de la sesión);
//   2. el usuario de prueba de desarrollo (CRM_DEV_ROL) NO escribe: con la DATABASE_URL de .env.local sería la base real.
//      Para ver la pantalla en local está ?demo=1, que no llama a esta API;
//   3. la fila tiene que existir y ser de ESTE cliente (id_crm de la URL): el recording_id de otro cliente es un 404. Además
//      cada UPDATE lleva upper(id_crm) = el de la URL (registro.ts): si el bot rehízo la ficha y la cruzó con otro cliente
//      entre la lectura y la escritura, no se escribe en la ficha del otro;
//   4. tildes: solo los ítems tildables de la ficha (los mismos que muestra la pantalla: fuente 'ninguna' de portfolio_final).
//      Faltantes: solo las claves que la ficha tiene, y los dos datos de lanzamiento. Los hace quien puede ver Clientes
//      (socio y csm), lo mismo que el resto de /clientes y /api/clientes (lib/auth/rutas.ts);
//   5. revisión: solo Tomi y Gero M (revisorDeSesion), solo si la ficha es un kickoff con ideas, y con la HUELLA de las ideas
//      que vio quien aprueba (la manda la pantalla): si el bot las rehízo mientras tanto → 409 «ideas_cambiaron», sin
//      escribir. Lo anterior pasa al historial (historialNuevo), así un pedido de cambios no se pierde al aprobar encima;
//   6. escritura con condición sobre `previo`: si otro lo cambió en el medio → 409 con lo de ahora (la pantalla pide recargar);
//   7. avisos de Discord (los manda la ruta en after(), nunca frenan la respuesta): pedir cambios avisa al OTRO revisor en
//      #📝-kickoff (solo lo menciona a él); cuando quedan aprobadas por los dos, un ✅ en #📝-kickoff y, si está
//      configurado el canal de anuncios (DISCORD_WEBHOOK_KICKOFF_ADS), el bloque "para lanzar" mencionando a Valentino.
//      Es OTRO mensaje que el «🚀 Para lanzar» que le llega cuando la ficha queda lista (aviso-ads.ts, que además cae en
//      #📣-ads con DISCORD_WEBHOOK_ANUNCIOS): este sigue saliendo solo con DISCORD_WEBHOOK_KICKOFF_ADS.
//      Desde el 27/10 aprobar ya NO dispara la tanda de guiones: arranca sola cuando la ficha queda lista (procesar.ts,
//      disparo-guiones.ts). La revisión de las ideas queda como comentario y aviso.
// Respuestas: 200 ok · 403 usuario de prueba o no es revisor · 404 no existe o es de otro cliente · 409 conflicto, ideas que
// cambiaron o no se puede (no tildable, sin ideas) · 422 entrada inválida · 503 la base no respondió.
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import { MAX_DISCORD, escaparDiscord } from '@/lib/fathomAnuncios/mensaje'
import type { FilaFichaCliente, guardarCheckPortfolio, guardarMarcaFaltante, guardarRevision } from './registro'
import { ErrorEntradaKickoff, NOMBRE_DATO, NOMBRE_REVISOR, esClaveDato, historialNuevo, leerRevision, revisorDeSesion, validarPedido, type ClaveRevisor, type Revision } from './revision'
import { armarVista, claveMarcable, itemTildable, type VistaKickoff } from './vista'

export interface ConfigAvisos {
  /** Base del Despacho para el link a la ficha (urlDespacho de servidor.ts). */
  urlBase: string
  /** IDs de Discord (null = sin mención: va el nombre en texto). */
  menciones: { tomi: string | null; gero_m: string | null; valentino: string | null }
  /** ¿Hay webhook del canal de anuncios (#📣-ads) para el aviso a Valentino? */
  ads: boolean
}
export interface DepsAccion {
  leer(recordingId: number): Promise<FilaFichaCliente | undefined>
  guardarCheck: typeof guardarCheckPortfolio
  guardarMarca: typeof guardarMarcaFaltante
  guardarRevision: typeof guardarRevision
  ahora?: () => Date
  /** Sin esto no se arma ningún aviso (los tests de la decisión no lo necesitan). */
  avisos?: ConfigAvisos
}
export interface SesionAccion { email: string; nombre: string; esDePrueba?: boolean }
/** Un aviso para Discord: canal, texto (ya escapado) y los únicos IDs que puede notificar. */
export interface AvisoDiscord { canal: 'kickoff' | 'ads'; texto: string; menciones: string[] }
// `cuando` (solo si salió bien): la marca de lo que se escribió, para que la pantalla mande el `previo` correcto en el próximo cambio
export interface RespuestaAccion {
  status: number; cuerpo: { ok: boolean; mensaje: string; codigo?: string; campo?: string; cuando?: string }; avisos?: AvisoDiscord[]
}

const responder = (status: number, ok: boolean, mensaje: string, extra: Partial<RespuestaAccion['cuerpo']> = {}): RespuestaAccion => ({ status, cuerpo: { ok, mensaje, ...extra } })
const CONFLICTO = 'Otra persona lo cambió mientras tanto: recargá la página para ver lo último.'
const NO_EXISTE = (r: { ok: boolean; motivo?: string }) => r.motivo === 'conflicto' ? responder(409, false, CONFLICTO, { codigo: 'conflicto' }) : responder(404, false, 'La ficha ya no está.', { codigo: 'no_existe' })

// ── Avisos de la revisión ──
const OTRO: Record<ClaveRevisor, ClaveRevisor> = { tomi: 'gero_m', gero_m: 'tomi' }
const corto = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`)
const linkDe = (c: ConfigAvisos, idCliente: string) => `${c.urlBase.replace(/\/+$/, '')}/clientes/${encodeURIComponent(idCliente.toUpperCase())}/kickoff`

/** El bloque "para lanzar" en una línea (para el aviso a Valentino): todo lo que necesita sin abrir la ficha. */
export function textoParaLanzar(v: VistaKickoff): string {
  const l = v.lanzar
  const datos = l.datos.filter(d => d.marca).map(d => `${NOMBRE_DATO[d.clave]}: ${d.marca!.nota}`)
  return [
    l.cuenta ? `cuenta ${l.cuenta}${l.monedaHora ? ` (${l.monedaHora})` : ''}` : 'cuenta sin identificar',
    `💵 ${l.presupuesto}`,
    // El recorte: la nota anotada (con un "ojo" si el video dice otra cosa y nadie lo revisó), el leído del video (con un pin de
    // Meta, la ubicación con su radio) o el ▶ al mapa
    `📍 ${l.zona.texto}${l.zona.nota ? ` · recorte: ${l.zona.nota}${l.zona.revisar ? ' (ojo: el mapa del video dice otra cosa: confirmarlo con Tomi)' : ''}`
      : l.zona.video ? ` · recorte según el video: ${l.zona.video}`
        : l.zona.momento ? ` · recorte en el mapa (▶ ${l.zona.momento.etiqueta}${l.zona.leyendo ? ', lo está leyendo el bot' : ''})` : ''}`,
    `👤 ${l.avatar}`,
    l.lanzamiento,
    ...datos,
  ].join(' · ')
}

/** ¿Quedaron aprobadas por los dos ESTAS ideas? (lo que devolvió la base después de escribir, no lo que se leyó antes) */
function dosAprobadas(v: VistaKickoff, revisor: ClaveRevisor, estado: string, actual: Revision): boolean {
  if (estado !== 'aprobada') return false
  const otra = actual[OTRO[revisor]]
  return !!otra && otra.estado === 'aprobada' && otra.huella === v.ideas.huella
}

function avisosRevision(v: VistaKickoff, idCliente: string, revisor: ClaveRevisor, estado: string, comentario: string, actual: Revision, c: ConfigAvisos): AvisoDiscord[] {
  const cliente = escaparDiscord(v.encabezado.cliente)
  const link = linkDe(c, idCliente)
  if (estado === 'cambios') {
    const otro = OTRO[revisor], id = c.menciones[otro]
    const texto = `${id ? `<@${id}> ` : `${NOMBRE_REVISOR[otro]}: `}✏️ ${NOMBRE_REVISOR[revisor]} pidió cambios en las ideas de ${cliente}: «${escaparDiscord(corto(comentario.replace(/\s+/g, ' '), 600))}» · [Ficha](<${link}>)`
    return [{ canal: 'kickoff', texto: texto.slice(0, MAX_DISCORD), menciones: id ? [id] : [] }]
  }
  if (!dosAprobadas(v, revisor, estado, actual)) return []
  const out: AvisoDiscord[] = [{ canal: 'kickoff', texto: `✅ Ideas de ${cliente} aprobadas por Tomi y Gero M · [Ficha](<${link}>)`, menciones: [] }]
  if (c.ads) {
    const val = c.menciones.valentino
    const texto = `${val ? `<@${val}> ` : 'Valentino: '}✅ Kickoff de ${cliente}: ideas aprobadas por Tomi y Gero M · ${escaparDiscord(textoParaLanzar(v))} · [Ficha](<${link}>)`
    out.push({ canal: 'ads', texto: texto.length > MAX_DISCORD ? `${texto.slice(0, MAX_DISCORD - 1)}…` : texto, menciones: val ? [val] : [] })
  }
  return out
}

export async function atenderAccion(deps: DepsAccion, idCliente: string, cuerpo: unknown, sesion: SesionAccion, env: Record<string, string | undefined> = process.env): Promise<RespuestaAccion> {
  const v = validarPedido(cuerpo)
  if (!v.ok) return responder(422, false, v.error, { codigo: 'validacion', campo: v.campo })
  if (sesion.esDePrueba) return responder(403, false, 'El usuario de prueba de desarrollo no escribe en la base. Para ver la pantalla en local usá ?demo=1.', { codigo: 'usuario_de_prueba' })
  const p = v.pedido
  const cuando = (deps.ahora?.() ?? new Date()).toISOString()
  const idCrm = idCliente.toUpperCase()
  const quien = { nombre: sesion.nombre, email: sesion.email }
  try {
    const fila = await deps.leer(p.recording_id)
    if (!fila || !fila.id_crm || fila.id_crm.toUpperCase() !== idCrm) return responder(404, false, 'No hay una ficha de kickoff con esa grabación para este cliente.', { codigo: 'no_existe' })
    const vista = armarVista(fila)
    if (!vista) return responder(409, false, 'La ficha guardada no se puede leer.', { codigo: 'ficha_ilegible' })

    if (p.accion === 'check') {
      if (!itemTildable(vista, p.item)) return responder(409, false, 'Ese ítem ya lo resolvió Meta o la llamada: no se tilda a mano.', { codigo: 'no_tildable' })
      const r = await deps.guardarCheck(p.recording_id, p.item, p.valor, quien, { previo: p.previo, nota: p.nota, cuando, idCrm })
      if (r.ok) return responder(200, true, p.valor ? 'Tilde guardado.' : 'Tilde quitado.', p.valor ? { cuando } : {})
      return NO_EXISTE(r)
    }

    if (p.accion === 'faltante') {
      if (!claveMarcable(vista, p.clave)) return responder(409, false, 'Esa ficha no tiene ese faltante.', { codigo: 'no_marcable' })
      const r = await deps.guardarMarca(p.recording_id, p.clave, p.hecho, quien, { previo: p.previo, nota: p.nota, cuando, idCrm })
      const dato = esClaveDato(p.clave)
      if (r.ok) return responder(200, true, dato ? (p.hecho ? 'Dato guardado.' : 'Dato borrado.') : p.hecho ? 'Marcado como hecho.' : 'Desmarcado.', p.hecho ? { cuando } : {})
      return NO_EXISTE(r)
    }

    const revisor = revisorDeSesion(sesion, env)
    if (!revisor) return responder(403, false, 'Las ideas las aprueban Tomi y Gero M.', { codigo: 'no_revisor' })
    if (!vista.encabezado.esKickoff || !vista.ideas.lista.length) return responder(409, false, 'Esta ficha no tiene ideas para revisar.', { codigo: 'sin_ideas' })
    // Las ideas que vio quien aprueba tienen que ser las de ahora (el bot pudo rehacerlas con forzar mientras tanto)
    if (p.estado !== 'pendiente' && p.huella !== vista.ideas.huella) return responder(409, false, 'Las ideas cambiaron: recargá para ver las nuevas.', { codigo: 'ideas_cambiaron' })
    const historial = historialNuevo(leerRevision(fila.revision)[revisor])
    const r = await deps.guardarRevision(p.recording_id, revisor, p.estado, p.comentario, { previo: p.previo, idCrm, email: sesion.email, huella: p.huella, cuando, historial })
    if (!r.ok) return NO_EXISTE(r)
    const que = p.estado === 'aprobada' ? 'aprobó las ideas' : p.estado === 'cambios' ? 'pidió cambios' : 'deshizo su revisión'
    const avisos = deps.avisos ? avisosRevision(vista, idCliente, revisor, p.estado, p.comentario, r.actual, deps.avisos) : []
    const avisado = p.estado === 'cambios' && avisos.length ? ` Le avisé a ${NOMBRE_REVISOR[OTRO[revisor]]} en Discord.` : ''
    return { ...responder(200, true, `Listo: ${NOMBRE_REVISOR[revisor]} ${que}.${avisado}`, { cuando }), ...(avisos.length ? { avisos } : {}) }
  } catch (e) {
    if (e instanceof ErrorEntradaKickoff) return responder(422, false, 'Dato inválido.', { codigo: 'validacion', campo: e.campo })
    if (e instanceof ErrorTransitorio) return responder(503, false, 'La base no respondió. Probá de nuevo en un minuto.', { codigo: 'base' })
    throw e
  }
}

// ── La barrera HTTP (el POST de la ruta, entero) ──
/** Misma forma que ID_CLIENTE_VALIDO de lib/clientes/ficha.ts (y ID_CRM_VALIDO de registro.ts). */
const ID_CLIENTE = /^[A-Za-z]\d{1,6}$/
export const LARGO_MAX_CUERPO = 4000

export interface DepsPost {
  /** 401 sin sesión, 403 sin el rol (exigirAccesoApi de lib/auth/acceso.ts); null = puede seguir. */
  exigirAcceso(req: Request): Response | null
  sesion(req: Request): SesionAccion | null
  baseLista(): boolean
  accion: DepsAccion
  /** Los avisos de Discord, después de responder (after() en la ruta). Nunca lanza. */
  enviarAvisos?(avisos: AvisoDiscord[]): void
  env?: Record<string, string | undefined>
}

const CABECERAS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const respuesta = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: CABECERAS })

/** ¿El Origin es del mismo host que la petición? (comparación exacta del host con puerto; ni prefijos ni x-forwarded-host) */
export function mismoOrigen(h: { get(n: string): string | null }): boolean {
  const origen = h.get('origin'), host = h.get('host')
  if (!origen || !host) return false
  try {
    return new URL(origen).host === host
  } catch {
    return false
  }
}

export async function atenderPost(req: Request, idCliente: string, deps: DepsPost): Promise<Response> {
  const rechazo = deps.exigirAcceso(req)
  if (rechazo) return rechazo
  // Anti-CSRF: la petición tiene que venir de esta misma página
  if (!mismoOrigen(req.headers)) return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return respuesta({ ok: false, mensaje: 'Se espera JSON.' }, 415)
  if (!ID_CLIENTE.test(idCliente)) return respuesta({ ok: false, mensaje: 'No encontrado.' }, 404)

  let cuerpo: unknown
  const texto = await req.text().catch(() => null)
  if (texto === null) return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400)
  if (texto.length > LARGO_MAX_CUERPO) return respuesta({ ok: false, mensaje: 'El pedido es demasiado grande.' }, 413)
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400)
  }

  const sesion = deps.sesion(req)
  if (!sesion) return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401)
  if (!deps.baseLista()) return respuesta({ ok: false, mensaje: 'La base del Despacho no está configurada.' }, 503)

  try {
    const r = await atenderAccion(deps.accion, idCliente, cuerpo, sesion, deps.env)
    if (r.avisos?.length && deps.enviarAvisos) {
      try { deps.enviarAvisos(r.avisos) } catch (e) { console.error('API kickoff: no se pudieron programar los avisos —', (e as Error)?.message ?? e) }
    }
    return respuesta(r.cuerpo, r.status)
  } catch (e) {
    console.error('API kickoff: no se pudo guardar —', ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
    return respuesta({ ok: false, mensaje: 'No se pudo guardar. Probá de nuevo en un minuto.' }, 500)
  }
}
