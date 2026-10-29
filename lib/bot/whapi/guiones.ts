// ── Bot "Capital Jurídico": reenvío a Guiones de lo que el cliente escribe en su grupo «Contenido - <cliente>» ─────────────
// La ruta de Whapi (ruta.ts) sigue procesando solo Ventas C.J. y Verificaciones C.J para el motor de altas. Además, los
// mensajes de TEXTO de los grupos Contenido de los clientes se reenvían, EN SEGUNDO PLANO (after), a la ruta de Guiones
// (app/api/bot/guiones/respuesta/route.ts), que los guarda como nota sin revisar si en ese grupo se avisó una tanda.
//
// Contrato del reenvío: POST `${DESPACHO_URL (https) o el origen del propio pedido}/api/bot/guiones/respuesta`, con
// `authorization: Bearer ${CRON_SECRET}` y JSON { grupo: "…@g.us", texto, mensaje_id, autor, citado?, fecha? }:
//   · autor: el nombre que se ve en WhatsApp (from_name) o, si no hay, el teléfono / lid. Solo informativo.
//   · citado: el id del mensaje que el cliente citó (por ejemplo, el aviso de la tanda). Solo si citó algo.
//   · fecha: cuándo lo mandó el cliente (ISO).
// Qué se reenvía (candidatosGuiones, PURO):
//   · mensajes de un grupo (…@g.us) que no sea Ventas C.J., Verificaciones C.J ni el grupo de guiones del equipo
//     (WHAPI_GRUPO_COPYWRITING, si está), con 48 h de atraso como mucho;
//   · texto (text / link_preview) y la imagen SOLO con su pie como texto (sin pie, nada). Audios, stickers, documentos,
//     videos, reacciones, ediciones y encuestas no;
//   · nunca lo del propio número del bot (from_me) ni lo de una persona del equipo (teléfonos o lid de
//     BOT_ALTA_EQUIPO_TELEFONOS, BOT_ALTA_APROBADORES y BOT_ALTA_OPERACIONES).
// Cómo se sabe que el grupo es un Contenido, sin adivinar (esGrupoContenido):
//   1. los chat_id que guardó el paso 'comunidad' del motor (cj_altas_pasos.resultado.grupos.contenido.id, o el parcial
//      mientras el paso corre), leídos en una sola consulta y guardados GRUPOS_CACHE_MS por instancia;
//   2. si no está ahí: el nombre del grupo por Whapi (GET /groups/{id}), que tiene que empezar con «Contenido - ». Con caché
//      por instancia (sí: NOMBRE_SI_MS; no: NOMBRE_NO_MS; si Whapi falló: NOMBRE_ERROR_MS).
//   Un mensaje de cualquier otro grupo se ignora (no sale nada).
// Sin repetir: cada mensaje_id se reclama en Neon (cj_guiones_reenvios, INSERT … ON CONFLICT DO NOTHING) antes de mandarlo;
// si ya estaba (Whapi reintentó el webhook o mandó el mismo mensaje dos veces), no se manda de nuevo. Además, un recuerdo
// por instancia evita ir a la base por un id que ya se vio. El reenvío no se reintenta: si la ruta de Guiones falla, queda
// el estado en cj_guiones_reenvios y la nota se puede cargar a mano en la pantalla de la tanda.
// Apagado: BOT_GUIONES_REENVIO=no (o 0 / apagado). Sin CRON_SECRET o sin DATABASE_URL no se reenvía nada (log con los NOMBRES).
// El log lleva conteos: nunca textos, teléfonos, nombres ni secretos. Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { ConfigGrupos } from '@/lib/bot/alta/motor/tipos'
import { BASE_WHAPI, PATRON_GRUPO } from './comun'
import { tokenWhapi } from './config'
import { ANTIGUEDAD_MAX_MS, cortar, leerEnvoltura, normalizarMensaje, type MensajeWhapi } from './webhook'

export const PREFIJO_GRUPO_CONTENIDO = 'Contenido - '
export const RUTA_RESPUESTA_GUIONES = '/api/bot/guiones/respuesta'
export const MAX_TEXTO_REENVIO = 4_000
export const MAX_REENVIOS_POR_ENVIO = 50
export const TOPE_REENVIO_MS = 15_000
export const TOPE_WHAPI_GRUPO_MS = 8_000
export const TOPE_CONSULTA_MS = 10_000
export const GRUPOS_CACHE_MS = 10 * 60_000
export const NOMBRE_SI_MS = 12 * 3600_000
export const NOMBRE_NO_MS = 3600_000
export const NOMBRE_ERROR_MS = 5 * 60_000
const RECUERDO_MAX = 2_000

export interface MensajeParaGuiones {
  grupo: string
  texto: string
  mensaje_id: string
  autor: string | null
  citado?: string
  fecha?: string
}

export type MotivoNoGuiones = 'propio' | 'equipo' | 'no_grupo' | 'grupo_bot' | 'viejo' | 'tipo' | 'sin_texto' | 'repetido' | 'exceso'

export interface CandidatosGuiones { candidatos: MensajeParaGuiones[]; descartes: Partial<Record<MotivoNoGuiones, number>> }

// ── Equipo (mismo criterio que listaPersonas / equipoDesdeEntorno de lib/bot/alta/motor/servidor.ts: copiado para no traer
// al webhook las dependencias del motor; scripts/test-bot-whapi.mjs controla que den lo mismo) ──
const persona = (x: string): string | null => {
  const t = x.trim()
  if (!t) return null
  const v = t.includes('@') ? t : t.replace(/\D/g, '')
  return v.length >= 8 || v.includes('@') ? v : null
}

/** Teléfonos (solo dígitos) y lid de BOT_ALTA_EQUIPO_TELEFONOS (JSON { nombre: teléfono }), BOT_ALTA_APROBADORES y
 *  BOT_ALTA_OPERACIONES (listas separadas por coma). Un JSON roto no tira: se usan las otras dos. */
export function personasDelEquipo(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const s = new Set<string>()
  const json = env.BOT_ALTA_EQUIPO_TELEFONOS?.trim()
  if (json) {
    try {
      for (const t of Object.values(JSON.parse(json) as Record<string, unknown>)) {
        const d = String(t ?? '').replace(/\D/g, '')
        if (d.length >= 8) s.add(d)
      }
    } catch { /* JSON roto: el motor ya lo avisa en su log */ }
  }
  for (const v of [env.BOT_ALTA_APROBADORES, env.BOT_ALTA_OPERACIONES]) {
    for (const x of (v ?? '').split(/[,;\n]+/)) { const p = persona(x); if (p) s.add(p) }
  }
  return s
}

/** Grupos internos que nunca son de un cliente, además de Ventas y Verificaciones: el de guiones del equipo
 *  (WHAPI_GRUPO_COPYWRITING, donde Guiones avisa «lista para revisar»). */
export function gruposDelEquipo(env: NodeJS.ProcessEnv = process.env): string[] {
  const g = env.WHAPI_GRUPO_COPYWRITING?.trim() ?? ''
  return PATRON_GRUPO.test(g) ? [g] : []
}

const esDelEquipo = (m: MensajeWhapi, equipo: ReadonlySet<string>): boolean =>
  (!!m.autor.telefono && equipo.has(m.autor.telefono)) || (!!m.autor.lid && equipo.has(m.autor.lid))

const TIPOS_TEXTO = new Set(['text', 'link_preview'])

/** El envío de Whapi → los mensajes que pueden ir a Guiones (todavía sin saber si el grupo es un Contenido). PURO. */
export function candidatosGuiones(json: unknown, grupos: ConfigGrupos, ahora: number, equipo: ReadonlySet<string>, otrosGruposBot: readonly string[] = []): CandidatosGuiones {
  const descartes: Partial<Record<MotivoNoGuiones, number>> = {}
  const descartar = (k: MotivoNoGuiones) => { descartes[k] = (descartes[k] ?? 0) + 1 }
  const candidatos: MensajeParaGuiones[] = []
  const env = leerEnvoltura(json)
  if (!env) return { candidatos, descartes }
  const vistos = new Set<string>()
  for (const x of env.mensajes) {
    const m = normalizarMensaje(x)
    if (!m) continue
    if (!PATRON_GRUPO.test(m.chatId)) { descartar('no_grupo'); continue }
    if (m.chatId === grupos.ventas || m.chatId === grupos.verificaciones || otrosGruposBot.includes(m.chatId)) { descartar('grupo_bot'); continue }
    if (m.deMi) { descartar('propio'); continue }
    if (ahora - Date.parse(m.enviadoEn) > ANTIGUEDAD_MAX_MS) { descartar('viejo'); continue }
    const texto = TIPOS_TEXTO.has(m.tipo) ? m.texto : m.tipo === 'image' ? m.medio?.pie ?? null : undefined
    if (texto === undefined) { descartar('tipo'); continue }
    if (!texto || !texto.trim()) { descartar('sin_texto'); continue }
    if (esDelEquipo(m, equipo)) { descartar('equipo'); continue }
    if (vistos.has(m.id)) { descartar('repetido'); continue }
    if (candidatos.length >= MAX_REENVIOS_POR_ENVIO) { descartar('exceso'); continue }
    vistos.add(m.id)
    candidatos.push({
      grupo: m.chatId,
      texto: cortar(texto.trim(), MAX_TEXTO_REENVIO),
      mensaje_id: m.id,
      autor: m.autor.nombre ?? m.autor.telefono ?? m.autor.lid,
      ...(m.citado ? { citado: m.citado.id } : {}),
      fecha: m.enviadoEn,
    })
  }
  return { candidatos, descartes }
}

// ── Reenvío (con dependencias inyectables: los tests no tocan red ni base) ──
export interface RegistroLogGuiones { info(m: string): void; warn(m: string): void; error(m: string): void }

export interface DepsReenvio {
  esGrupoContenido(chatId: string): Promise<boolean>
  /** true = primera vez que se ve ese mensaje_id (se puede mandar); false = ya se reclamó antes. */
  reclamar(mensajeId: string, grupo: string): Promise<boolean>
  marcar(mensajeId: string, estado: string): Promise<void>
  enviar(m: MensajeParaGuiones): Promise<{ status: number; cuerpo: Record<string, unknown> | null }>
  log: RegistroLogGuiones
  /** Recuerdo por instancia de los mensaje_id ya reclamados (por defecto, el del módulo). */
  recuerdo?: Set<string>
}

export interface ResumenReenvio { enviados: number; notas: number; ignorados: number; otroGrupo: number; repetidos: number; errores: number }

const RECUERDO: Set<string> = new Set()
const recordar = (r: Set<string>, id: string) => {
  r.add(id)
  if (r.size > RECUERDO_MAX) { const primero = r.values().next().value; if (primero !== undefined) r.delete(primero) }
}
const nombreError = (e: unknown) => String((e as Error)?.name ?? 'error').slice(0, 40)

/** Manda a Guiones los candidatos de grupos Contenido, sin repetir. Nunca tira. */
export async function reenviarAGuiones(candidatos: readonly MensajeParaGuiones[], deps: DepsReenvio): Promise<ResumenReenvio> {
  const r: ResumenReenvio = { enviados: 0, notas: 0, ignorados: 0, otroGrupo: 0, repetidos: 0, errores: 0 }
  const recuerdo = deps.recuerdo ?? RECUERDO
  for (const m of candidatos) {
    try {
      if (recuerdo.has(m.mensaje_id)) { r.repetidos++; continue }
      if (!(await deps.esGrupoContenido(m.grupo))) { r.otroGrupo++; continue }
      if (!(await deps.reclamar(m.mensaje_id, m.grupo))) { recordar(recuerdo, m.mensaje_id); r.repetidos++; continue }
      recordar(recuerdo, m.mensaje_id)
      let estado: string
      try {
        const res = await deps.enviar(m)
        if (res.status >= 200 && res.status < 300 && res.cuerpo?.ok === true) {
          r.enviados++
          if (res.cuerpo.ignorado) { r.ignorados++; estado = 'ignorado' } else { r.notas++; estado = 'nota' }
        } else {
          r.errores++
          estado = `error_http_${res.status}`
        }
      } catch (e) {
        r.errores++
        estado = `error_${nombreError(e)}`
      }
      await deps.marcar(m.mensaje_id, estado).catch(() => {})
    } catch (e) {
      r.errores++
      deps.log.error(`bot-whapi: guiones — no se pudo reenviar un mensaje (${nombreError(e)})`)
    }
  }
  const total = r.enviados + r.errores
  if (total || r.repetidos) {
    const linea = `bot-whapi: guiones → ${r.enviados} reenviado(s) (${r.notas} nota(s), ${r.ignorados} sin tanda), ${r.repetidos} repetido(s), ${r.otroGrupo} de otro grupo, ${r.errores} error(es)`
    if (r.errores) deps.log.warn(linea)
    else deps.log.info(linea)
  }
  return r
}

// ── Lo real: Neon, Whapi y la ruta de Guiones ──
type Sql = NeonQueryFunction<false, false>

export interface OpcionesReenvioReal {
  env?: NodeJS.ProcessEnv
  /** Origen del pedido de Whapi (https://…): la base de la URL si no hay DESPACHO_URL. */
  origen: string
  log?: RegistroLogGuiones
  /** Para los tests. */
  fetch?: typeof fetch
  sql?: Sql
  ahora?: () => number
}

const apagado = (v: string | undefined) => /^(no|0|false|apagado|off)$/i.test((v ?? '').trim())

/** Base de la URL de la ruta de Guiones: DESPACHO_URL si es https válida; si no, el origen del pedido (https o localhost). */
export function baseDespacho(env: NodeJS.ProcessEnv, origen: string): string | null {
  for (const b of [env.DESPACHO_URL?.trim() ?? '', origen]) {
    try {
      const u = new URL(b)
      if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.origin
    } catch { /* la siguiente */ }
  }
  return null
}

const faltaTabla = (e: unknown): boolean => (e as { code?: string })?.code === '42P01' || /relation "\w+" does not exist/i.test((e as Error)?.message ?? '')

// Cachés por instancia (las comparten las invocaciones de la misma función)
const CACHE_GRUPOS: { ids: Set<string>; hasta: number } = { ids: new Set(), hasta: 0 }
const CACHE_NOMBRES = new Map<string, { contenido: boolean; hasta: number }>()
let tablaLista = false

/** Solo para los tests: vacía las cachés y el recuerdo del módulo. */
export function olvidarCachesGuiones(): void {
  CACHE_GRUPOS.ids = new Set(); CACHE_GRUPOS.hasta = 0
  CACHE_NOMBRES.clear(); RECUERDO.clear(); tablaLista = false
}

/** Las dependencias reales, o los NOMBRES de lo que falta para reenviar. */
export function depsReenvioReal(op: OpcionesReenvioReal): { deps: DepsReenvio } | { falta: string[] } {
  const env = op.env ?? process.env
  const log = op.log ?? console
  const ahora = op.ahora ?? Date.now
  const falta: string[] = []
  const cron = env.CRON_SECRET?.trim()
  const dbUrl = env.DATABASE_URL?.trim()
  const base = baseDespacho(env, op.origen)
  if (!cron) falta.push('CRON_SECRET')
  if (!dbUrl && !op.sql) falta.push('DATABASE_URL')
  if (!base) falta.push('DESPACHO_URL')
  if (falta.length) return { falta }
  const f = op.fetch ?? fetch
  let sqlCache: Sql | null = op.sql ?? null
  const sql = (): Sql => (sqlCache ??= neon(dbUrl as string, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } }))
  const consulta = async <T>(fn: (q: Sql) => Promise<T>): Promise<T> => {
    let t: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([fn(sql()), new Promise<never>((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('la base no respondió'), { name: 'TimeoutError' })), TOPE_CONSULTA_MS) })])
    } finally { if (t) clearTimeout(t) }
  }

  async function gruposConocidos(): Promise<Set<string>> {
    if (ahora() < CACHE_GRUPOS.hasta) return CACHE_GRUPOS.ids
    let filas: Record<string, unknown>[] = []
    try {
      filas = await consulta((q) => q`SELECT DISTINCT COALESCE(resultado -> 'grupos' -> 'contenido' ->> 'id', parcial -> 'grupos' -> 'contenido' ->> 'id') AS id
        FROM cj_altas_pasos WHERE paso = 'comunidad'` as Promise<Record<string, unknown>[]>)
    } catch (e) {
      if (!faltaTabla(e)) {
        log.warn(`bot-whapi: guiones — no se pudieron leer los grupos Contenido del motor (${nombreError(e)}): se pregunta a Whapi`)
        return CACHE_GRUPOS.ids
      }
    }
    CACHE_GRUPOS.ids = new Set(filas.map((x) => String(x.id ?? '')).filter((id) => PATRON_GRUPO.test(id)))
    CACHE_GRUPOS.hasta = ahora() + GRUPOS_CACHE_MS
    return CACHE_GRUPOS.ids
  }

  async function nombreEsContenido(chatId: string): Promise<boolean> {
    const c = CACHE_NOMBRES.get(chatId)
    if (c && ahora() < c.hasta) return c.contenido
    const guardar = (contenido: boolean, ms: number) => { CACHE_NOMBRES.set(chatId, { contenido, hasta: ahora() + ms }); return contenido }
    const token = tokenWhapi(env)
    if (!token) return guardar(false, NOMBRE_ERROR_MS)
    try {
      const res = await f(`${BASE_WHAPI}/groups/${encodeURIComponent(chatId)}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(TOPE_WHAPI_GRUPO_MS), cache: 'no-store',
      })
      if (res.status === 404) { await res.body?.cancel().catch(() => {}); return guardar(false, NOMBRE_NO_MS) }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return guardar(false, NOMBRE_ERROR_MS) }
      const j = (await res.json().catch(() => null)) as { name?: unknown; subject?: unknown } | null
      const nombre = typeof j?.name === 'string' ? j.name : typeof j?.subject === 'string' ? j.subject : ''
      const es = nombre.trimStart().startsWith(PREFIJO_GRUPO_CONTENIDO)
      return guardar(es, es ? NOMBRE_SI_MS : NOMBRE_NO_MS)
    } catch {
      return guardar(false, NOMBRE_ERROR_MS)
    }
  }

  async function asegurarTabla(q: Sql) {
    if (tablaLista) return
    await q`CREATE TABLE IF NOT EXISTS cj_guiones_reenvios (
      mensaje_id text PRIMARY KEY, grupo text NOT NULL, estado text NOT NULL DEFAULT 'reclamado',
      creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now())`
    tablaLista = true
  }

  const deps: DepsReenvio = {
    log,
    async esGrupoContenido(chatId) {
      if ((await gruposConocidos()).has(chatId)) return true
      return nombreEsContenido(chatId)
    },
    async reclamar(mensajeId, grupo) {
      return consulta(async (q) => {
        await asegurarTabla(q)
        const filas = await q`INSERT INTO cj_guiones_reenvios (mensaje_id, grupo) VALUES (${mensajeId}, ${grupo}) ON CONFLICT (mensaje_id) DO NOTHING RETURNING mensaje_id`
        return filas.length > 0
      })
    },
    async marcar(mensajeId, estado) {
      await consulta((q) => q`UPDATE cj_guiones_reenvios SET estado = ${estado.slice(0, 60)}, actualizado = now() WHERE mensaje_id = ${mensajeId}`)
    },
    async enviar(m) {
      const res = await f(`${base}${RUTA_RESPUESTA_GUIONES}`, {
        method: 'POST', headers: { authorization: `Bearer ${cron}`, 'content-type': 'application/json' }, body: JSON.stringify(m),
        signal: AbortSignal.timeout(TOPE_REENVIO_MS), cache: 'no-store',
      })
      const cuerpo = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { status: res.status, cuerpo: cuerpo && typeof cuerpo === 'object' ? cuerpo : null }
    },
  }
  return { deps }
}

let avisoFalta = ''

/** Lo que llama la ruta en after(): arma las dependencias reales y reenvía. Nunca tira. */
export async function reenviarGuionesReal(candidatos: readonly MensajeParaGuiones[], op: OpcionesReenvioReal): Promise<ResumenReenvio | null> {
  const env = op.env ?? process.env
  const log = op.log ?? console
  if (!candidatos.length || apagado(env.BOT_GUIONES_REENVIO)) return null
  const d = depsReenvioReal(op)
  if ('falta' in d) {
    const que = d.falta.join(', ')
    if (avisoFalta !== que) { avisoFalta = que; log.warn(`bot-whapi: guiones — sin ${que}: no se reenvían los mensajes de los grupos Contenido`) }
    return null
  }
  return reenviarAGuiones(candidatos, d.deps)
}

export type ReenviarGuiones = typeof reenviarGuionesReal
