// ── d05: con el check final, los videos de la tanda entran solos a Edición («Para grabar» → Esperando crudos) ──────────
// Antes (31/10) el check final solo pasaba los chips «Video:» del Doc a «Para grabar» y Edición se enteraba en la pasada
// diaria del vigía, que lee el Doc. Dos huecos:
//   · un día de demora entre el check y el video en Edición;
//   · si el vigía leía el Doc por PRIMERA vez con los chips ya en «Para grabar» (cliente nuevo), esa lectura es la línea de
//     base y no crea videos: la primera tanda del bot no entraba nunca.
// Ahora, apenas los chips quedan en «Para grabar», se arma el mismo Doc que va a leer el vigía (el texto que escribe
// cargarEnChips: «TANDA N°», «* Video: Para grabar», HOOK / Velocidad / (indicación) / texto) y se le pasa a planDoc, con el
// mismo freno (10 por cliente), la misma fecha de corte y la misma búsqueda de videos (huella o clave T-V). Así:
//   · el video nace con la clave T<tanda>-V<n> y la huella que después va a calcular el vigía: su pasada lo reconoce y no
//     crea otro (si el texto exportado cambiara en algo, la clave T-V lo encuentra igual);
//   · es idempotente: crearVideoSiFalta no duplica (id_crm, clave) y una reaprobación con correcciones solo actualiza el
//     guion de los videos que todavía esperan crudos (como el vigía con un guion cambiado);
//   · NO toca lo que guardó el vigía del Doc (cj_grab_guiones): su línea de base y sus lecturas siguen siendo suyas.
// Respeta EDICION_MODO (en dry no escribe y devuelve el plan). No manda mensajes: el ciclo de e01 lo abre el diario como
// con cualquier video que nace desde el Doc (origen `doc`, motivo para_grabar).
import type { DocGuiones, EventoVideo, IdCrm, Video, Ymd } from '../../edicion/tipos'
import { parsearDocGuiones, planDoc, textoGuion, ganchoGuion } from './guiones'

/** Lo mínimo de un guion del bot (lib/bot/guiones/tipos.ts) para armar su texto en el Doc. */
export interface GuionDeTanda {
  numero: number
  secciones: { seccion: string; velocidad: number; indicacion: string; texto: string }[]
}

const NOMBRE: Record<string, string> = { HOOK: 'HOOK', PROBLEMA: 'PROBLEMA', SOLUCION: 'SOLUCIÓN', CTA: 'CTA' }

/** El texto plano que deja cargarEnChips debajo de cada chip, como lo exporta Drive (lo mismo que lee el vigía). */
export function textoDocDeTanda(tanda: number, guiones: readonly GuionDeTanda[]): string {
  const lineas = [`TANDA ${tanda}°`, '']
  for (const g of [...guiones].sort((a, b) => a.numero - b.numero)) {
    lineas.push('* Video: Para grabar')
    for (const s of g.secciones) lineas.push(NOMBRE[s.seccion] ?? s.seccion, `Velocidad ${s.velocidad}`, `(${s.indicacion})`, s.texto, '')
  }
  return lineas.join('\n')
}

/** El Doc «como lo va a leer el vigía», solo con la tanda del bot. */
export function docDeTanda(p: { id_crm: IdCrm; doc_id: string; tanda: number; guiones: readonly GuionDeTanda[]; ahora: string }): DocGuiones {
  return parsearDocGuiones(textoDocDeTanda(p.tanda, p.guiones), p.doc_id, p.id_crm, p.ahora, p.ahora)
}

export interface RepoAltaGuiones {
  listarVideos(f: { id_crm: IdCrm; incluirFinales: true }): Promise<Video[]>
  crearVideoSiFalta(v: {
    id_crm: IdCrm; cliente: string; clave: string; tanda_guion: number | null; numero: number | null; guion: Video['guion']
    guion_texto: string; gancho: string; estado: 'esperando_crudos'; prioridad: 'normal'; origen: 'doc'; clickup_id: null; posible_duplicado?: string[]
  }, actor: { tipo: 'bot'; proceso: 'guiones' }): Promise<{ creado: boolean; evento: EventoVideo | null }>
  actualizarVideo(p: {
    id: number; version: number; actor: { tipo: 'bot'; proceso: 'guiones' }; tipo: 'creado'; nota: string
    cambios: { guion: Video['guion']; guion_texto: string; gancho?: string }; datos: Record<string, unknown>
  }): Promise<{ ok: boolean }>
  vigilarCrudosDe(id_crm: IdCrm): Promise<unknown>
}

export interface ResultadoAlta { modo: 'dry' | 'real'; altas: string[]; actualizados: string[]; frenadas: number; pospuestos: string[]; avisos: string[] }

export const ACTOR_GUIONES = { tipo: 'bot', proceso: 'guiones' } as const

/** Los videos de la tanda recién aprobada entran a Edición en Esperando crudos (o actualizan su guion si ya estaban). */
export async function altaDesdeTanda(repo: RepoAltaGuiones, p: {
  id_crm: IdCrm; cliente: string; doc_id: string; tanda: number; guiones: readonly GuionDeTanda[]
  ahora: Date; corte: Ymd | null; maxAltas: number; modo: 'dry' | 'real'
}): Promise<ResultadoAlta> {
  const out: ResultadoAlta = { modo: p.modo, altas: [], actualizados: [], frenadas: 0, pospuestos: [], avisos: [] }
  if (!p.guiones.length || !Number.isInteger(p.tanda) || p.tanda < 1) return out
  const doc = docDeTanda({ id_crm: p.id_crm, doc_id: p.doc_id, tanda: p.tanda, guiones: p.guiones, ahora: p.ahora.toISOString() })
  const videos = await repo.listarVideos({ id_crm: p.id_crm, incluirFinales: true })
  // «anterior» vacío (no null): no es línea de base, así cada guion en «Para grabar» sin video es un alta
  const hoy = new Date(p.ahora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
  const plan = planDoc(doc, { ...doc, guiones: [] }, videos, { hoy, corte: p.corte, maxAltas: p.maxAltas })
  out.frenadas = plan.frenadas; out.pospuestos = plan.pospuestos; out.avisos = [...doc.avisos, ...plan.avisos]
  // Lo mismo que vincula el vigía: un video sin guion (importado de ClickUp) o que todavía espera crudos con el guion cambiado
  const actualizar = plan.vincular
  if (p.modo === 'dry') {
    out.altas = plan.altas.map(a => a.guion.ref); out.actualizados = actualizar.map(x => x.clave)
    return out
  }
  const cliente = p.cliente.trim() || videos[0]?.cliente || p.id_crm.toUpperCase()
  for (const x of actualizar) {
    const v = videos.find(y => y.id === x.video_id)
    const r = await repo.actualizarVideo({ id: x.video_id, version: x.version, actor: ACTOR_GUIONES, tipo: 'creado', nota: 'guion actualizado con el check final',
      cambios: { guion: { doc_id: doc.doc_id, ref: x.guion.ref, huella: x.guion.huella }, guion_texto: textoGuion(x.guion), ...(v && !v.gancho ? { gancho: ganchoGuion(x.guion) } : {}) },
      datos: { guion_vinculado: x.motivo, ref: x.guion.ref, check_final: true } })
    if (r.ok) out.actualizados.push(x.clave)
  }
  for (const a of plan.altas) {
    const r = await repo.crearVideoSiFalta({
      id_crm: p.id_crm, cliente, clave: a.guion.ref, tanda_guion: a.guion.tanda, numero: a.guion.numero,
      guion: { doc_id: doc.doc_id, ref: a.guion.ref, huella: a.guion.huella }, guion_texto: textoGuion(a.guion), gancho: ganchoGuion(a.guion),
      estado: 'esperando_crudos', prioridad: 'normal', origen: 'doc', clickup_id: null, posible_duplicado: a.posible_duplicado,
    }, ACTOR_GUIONES)
    if (r.creado) out.altas.push(a.guion.ref)
  }
  if (out.altas.length) await repo.vigilarCrudosDe(p.id_crm)
  return out
}

/** Con las dependencias reales (Neon de Edición, con la barrera de clientes archivados de operativo.ts). Solo servidor. */
export async function altaDesdeTandaReal(p: { id_crm: IdCrm; cliente: string; doc_id: string; tanda: number; guiones: readonly GuionDeTanda[] }): Promise<ResultadoAlta> {
  const [Ed, config] = await Promise.all([import('../../edicion/operativo'), import('../../edicion/config')])
  const env = process.env
  const corte = /^\d{4}-\d{2}-\d{2}$/.test(env.EDICION_FECHA_CORTE?.trim() ?? '') ? env.EDICION_FECHA_CORTE!.trim() : null
  const repo: RepoAltaGuiones = {
    listarVideos: f => Ed.listarVideos(f),
    crearVideoSiFalta: (v, actor) => Ed.crearVideoSiFalta(v, actor),
    actualizarVideo: x => Ed.actualizarVideo(x),
    vigilarCrudosDe: id => Ed.vigilarCrudosDe(id),
  }
  return altaDesdeTanda(repo, { ...p, ahora: new Date(), corte, maxAltas: config.MAX_ALTAS_POR_PASADA, modo: config.modoEdicion(env) })
}
