// ── Bot "Capital Jurídico": guardia de salud del número de WhatsApp (WhatsApp seguro, 26/10/2026) ───────────────────────
// El 26/10/2026 WhatsApp suspendió el número del bot pocas horas después de prender la comunidad. Esta guardia hace que
// NINGUNA escritura salga por Whapi (mensajes, videos, comunidades, grupos, fotos, participantes, contactos) si el número no
// está conectado y sano, venga del motor de altas, de Guiones, de Grabación (e01), de Anuncios, de Éxito o de Bajas: todos
// usan crearClienteWhapi (cliente.ts), que llama a `antesDeEscribir` antes de cada pedido que no es un GET.
//   · Antes de escribir: GET /health (con caché de 60 s por token). Si el status no es AUTH (code 4), o algo dice "banned",
//     NO sale nada: ErrorWhapi 'sin_numero' (aplicado: false) con el motivo "número del bot desconectado o suspendido".
//     Quien llama lo deja en reintento (el motor de altas: el paso queda en 'reintento' con ese motivo).
//   · Si /health no responde (red, 5xx, sin JSON) tampoco sale nada (falla cerrado), pero sin aviso: se vuelve a mirar a
//     los 15 s.
//   · Cualquier respuesta de Whapi con 401 o con "banned" marca el número como caído; un 403 obliga a mirar /health en el
//     acto (un 403 también puede ser "el bot no es admin de ese grupo": eso no es una caída y no se avisa).
//   · El webhook de Whapi (channel / users.delete con el número desvinculado) también lo marca caído (ruta.ts).
//   · Caído → UN aviso a Discord #alertas-dashboard (DISCORD_WEBHOOK_URL) mencionando a Tomás (DISCORD_ID_TOMAS, o su id
//     de siempre). No se repite: como mucho uno cada 6 h, con el candado en Neon (cj_altas_recursos, fila
//     'whapi_salud_aviso') para que no avise cada instancia de Vercel; sin base, solo el freno en memoria.
// Nunca se loguea ni se manda el token: la caché lo usa como clave en memoria y nada más.
import { neon } from '@neondatabase/serverless'
import { MOTIVO_SIN_NUMERO } from '@/lib/bot/alta/motor/tipos'
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { BASE_WHAPI } from './comun'
import { ErrorWhapi } from './errores'

export const CACHE_SALUD_MS = 60_000
export const CACHE_SALUD_DESCONOCIDA_MS = 15_000
export const AVISO_CADA_MS = 6 * 3600_000
export const CORTE_SALUD_MS = 10_000
export { MOTIVO_SIN_NUMERO }
/** El mismo id de Tomás que usan fathom-anuncios y el kickoff (lib/fathomAnuncios/procesar.ts: ID_TOMAS). */
export const ID_TOMAS_POR_DEFECTO = ''
export const RECURSO_AVISO = 'whapi_salud_aviso'

export interface EstadoSalud {
  /** true = conectado (AUTH) y sin rastros de ban. */
  ok: boolean
  /** false = no se pudo leer /health (no se sabe): no se manda, pero no se avisa. */
  conocido: boolean
  estado: string | null      // status.text de /health ("AUTH", "QR", "ERROR"…) o lo que lo marcó caído ("HTTP 401")
  codigo: number | null      // status.code
  baneado: boolean
  motivo: string
  en: number
}

type Obj = Record<string, unknown>
const obj = (x: unknown): Obj | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : null)
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
/** ¿Algo de la respuesta dice "banned" (status.text, status.reason, reason, error.message…)? */
export const diceBaneado = (x: unknown): boolean => {
  try { return /\bbanned\b/i.test(typeof x === 'string' ? x : JSON.stringify(x ?? '')) } catch { return false }
}

/** Lee el JSON de GET /health. Sano = status.code 4 y/o status.text "AUTH" (los que vengan) y nada que diga "banned". */
export function leerSalud(json: unknown, en: number): EstadoSalud {
  const o = obj(json) ?? {}
  const s = obj(o.status)
  const texto = str(s?.text) ?? str(o.status)
  const codigo = num(s?.code)
  const baneado = diceBaneado({ status: o.status, reason: o.reason, error: o.error, user: obj(o.user)?.status })
  const auth = (codigo !== null || texto !== null) && (codigo === null || codigo === 4) && (texto === null || texto.toUpperCase() === 'AUTH')
  const ok = auth && !baneado
  const estado = baneado ? 'BANNED' : texto ?? (codigo !== null ? `code ${codigo}` : null)
  return { ok, conocido: true, estado, codigo, baneado, motivo: ok ? 'conectado' : `${MOTIVO_SIN_NUMERO} (Whapi: ${estado ?? 'sin estado'})`, en }
}

export interface DepsAviso {
  /** Manda el texto a #alertas-dashboard. true si salió. */
  avisar(texto: string, menciones: string[]): Promise<boolean>
  /** Candado compartido entre instancias: true = a esta instancia le toca avisar (nadie avisó en `ttlMs`). */
  reclamarAviso(ttlMs: number): Promise<boolean>
  mencionTomas(): string
}

async function reclamarEnNeon(ttlMs: number): Promise<boolean> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) return true   // sin base: decide el freno en memoria
  try {
    const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
    await q`CREATE TABLE IF NOT EXISTS cj_altas_recursos (nombre text PRIMARY KEY, dueno text, hasta timestamptz, datos jsonb)`
    const segundos = Math.max(1, Math.round(ttlMs / 1000))
    const r = await q`INSERT INTO cj_altas_recursos (nombre, dueno, hasta) VALUES (${RECURSO_AVISO}, 'salud', now() + make_interval(secs => ${segundos}))
      ON CONFLICT (nombre) DO UPDATE SET dueno = EXCLUDED.dueno, hasta = EXCLUDED.hasta
        WHERE cj_altas_recursos.hasta IS NULL OR cj_altas_recursos.hasta < now()
      RETURNING nombre`
    return r.length > 0
  } catch {
    return true   // la base no respondió: mejor un aviso de más que ninguno (el freno en memoria sigue)
  }
}

export const depsAvisoReales: DepsAviso = {
  async avisar(texto, menciones) {
    const wh = process.env.DISCORD_WEBHOOK_URL?.trim()
    if (!wh) { console.error('bot-whapi: el número del bot está caído y falta DISCORD_WEBHOOK_URL para avisar'); return false }
    try { return (await enviarDiscord(wh, [texto], menciones, { deadline: Date.now() + 15_000, reintentos429: 1 })).length > 0 } catch { return false }
  },
  reclamarAviso: reclamarEnNeon,
  mencionTomas: () => idDiscord(process.env.DISCORD_ID_TOMAS) ?? ID_TOMAS_POR_DEFECTO,
}

/** El aviso de Discord (uno solo: no se repite cada minuto). */
export function textoAlerta(s: Pick<EstadoSalud, 'estado' | 'motivo'>, mencion: string): string {
  return [
    `<@${mencion}> 🚨 **WhatsApp del bot C.J: ${MOTIVO_SIN_NUMERO}** (${s.estado ?? 'sin estado'}).`,
    'El bot frenó TODOS los envíos por Whapi (altas, comunidades, bienvenidas, guiones, grabación, anuncios, éxito y bajas): los pasos pendientes quedan en reintento.',
    '• Mirá el canal en whapi.cloud (Health / QR) y el WhatsApp del número.',
    '• Si está suspendido: NO lo vuelvas a vincular hasta resolverlo con WhatsApp.',
    '• Cuando vuelva a AUTH, sólo podrán salir los flujos habilitados. Edición exige fecha de habilitación y revisión vigente; las entregas anteriores requieren revisión. Este aviso no se repite por 6 h.',
  ].join('\n')
}

export interface CtxSalud { token: string; fetch: typeof fetch; ahora: () => number }

export interface GuardiaSalud {
  /** Antes de cada escritura: tira ErrorWhapi 'sin_numero' si el número no está sano. */
  antesDeEscribir(ctx: CtxSalud): Promise<void>
  /** Después de una respuesta no-2xx de Whapi (lectura o escritura): 401 / "banned" → caído; 403 → mirar /health ya. */
  alResponder(ctx: CtxSalud, status: number, cuerpo: unknown): Promise<void>
  /** Una caída que avisó otro (el webhook de Whapi): marca caído (sin token: todos) y avisa una vez. */
  reportarCaida(motivo: string, op?: { token?: string | null; ahora?: () => number; estado?: string | null }): Promise<void>
  /** Lo que se sabe del número (para los tests y el GET de estado). */
  estado(token: string): EstadoSalud | null
}

export function crearGuardiaSalud(op: { deps?: DepsAviso; cacheMs?: number; avisoCadaMs?: number } = {}): GuardiaSalud {
  const deps = op.deps ?? depsAvisoReales
  const cacheMs = op.cacheMs ?? CACHE_SALUD_MS
  const avisoCadaMs = op.avisoCadaMs ?? AVISO_CADA_MS
  const cache = new Map<string, EstadoSalud>()
  let caidaGlobal: EstadoSalud | null = null   // del webhook: vale para cualquier token hasta que /health diga AUTH
  let avisadoHasta = 0
  const enCurso = new Map<string, Promise<EstadoSalud>>()

  async function avisarUnaVez(s: EstadoSalud, ahora: number): Promise<void> {
    if (ahora < avisadoHasta) return
    avisadoHasta = ahora + avisoCadaMs
    try {
      if (!(await deps.reclamarAviso(avisoCadaMs))) return
      await deps.avisar(textoAlerta(s, deps.mencionTomas()), [deps.mencionTomas()])
    } catch { /* el aviso nunca frena al bot */ }
  }

  async function leer(ctx: CtxSalud): Promise<EstadoSalud> {
    const en = ctx.ahora()
    let res: Response
    try {
      res = await ctx.fetch(`${BASE_WHAPI}/health`, { method: 'GET', headers: { Authorization: `Bearer ${ctx.token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(CORTE_SALUD_MS), redirect: 'error' })
    } catch {
      return { ok: false, conocido: false, estado: null, codigo: null, baneado: false, motivo: 'no se pudo confirmar que el número del bot esté conectado (Whapi /health no respondió)', en }
    }
    let json: unknown = null
    try { json = JSON.parse(await res.text()) } catch { json = null }
    if (res.status === 401 || res.status === 403 || diceBaneado(json)) {
      const baneado = diceBaneado(json)
      return { ok: false, conocido: true, estado: baneado ? 'BANNED' : `HTTP ${res.status}`, codigo: null, baneado, motivo: `${MOTIVO_SIN_NUMERO} (Whapi /health: ${baneado ? 'banned' : `HTTP ${res.status}`})`, en }
    }
    if (!res.ok || !obj(json)) return { ok: false, conocido: false, estado: null, codigo: null, baneado: false, motivo: `no se pudo confirmar que el número del bot esté conectado (Whapi /health respondió ${res.status})`, en }
    return leerSalud(json, en)
  }

  async function mirar(ctx: CtxSalud, forzar = false): Promise<EstadoSalud> {
    const ahora = ctx.ahora()
    const previo = cache.get(ctx.token)
    const vigencia = previo?.conocido ? cacheMs : CACHE_SALUD_DESCONOCIDA_MS
    if (!forzar && previo && ahora - previo.en < vigencia) return previo
    let p = enCurso.get(ctx.token)
    if (!p) {
      p = leer(ctx).finally(() => enCurso.delete(ctx.token))
      enCurso.set(ctx.token, p)
    }
    const s = await p
    cache.set(ctx.token, s)
    caidaGlobal = null   // lo que dice /health ahora manda sobre la caída que avisó el webhook
    if (!s.ok && s.conocido) await avisarUnaVez(s, ahora)
    return s
  }

  const bloquear = (s: EstadoSalud): never => {
    throw new ErrorWhapi('sin_numero', `Whapi: ${s.motivo}. No se mandó nada.`, null, false)
  }

  return {
    async antesDeEscribir(ctx) {
      // Una caída avisada por el webhook se respeta hasta que /health (sin caché) diga AUTH
      const s = await mirar(ctx, !!caidaGlobal && (cache.get(ctx.token)?.en ?? -Infinity) <= caidaGlobal.en)
      if (!s.ok) bloquear(s)
    },
    async alResponder(ctx, status, cuerpo) {
      const ahora = ctx.ahora()
      if (status === 401 || diceBaneado(cuerpo)) {
        const baneado = diceBaneado(cuerpo)
        const s: EstadoSalud = { ok: false, conocido: true, estado: baneado ? 'BANNED' : 'HTTP 401', codigo: null, baneado, motivo: `${MOTIVO_SIN_NUMERO} (Whapi respondió ${baneado ? '"banned"' : '401'})`, en: ahora }
        cache.set(ctx.token, s)
        await avisarUnaVez(s, ahora)
        return
      }
      if (status === 403) await mirar(ctx, true)
    },
    async reportarCaida(motivo, o = {}) {
      const ahora = (o.ahora ?? Date.now)()
      const s: EstadoSalud = { ok: false, conocido: true, estado: o.estado ?? null, codigo: null, baneado: diceBaneado(motivo), motivo: `${MOTIVO_SIN_NUMERO} (${motivo})`, en: ahora }
      if (o.token) cache.set(o.token, s)
      else caidaGlobal = s
      await avisarUnaVez(s, ahora)
    },
    estado: (token) => cache.get(token) ?? caidaGlobal,
  }
}

/** La guardia de todo el proceso (la comparten todos los clientes de Whapi de la instancia). */
let guardiaGlobal: GuardiaSalud = crearGuardiaSalud()
export const guardiaWhapi = (): GuardiaSalud => guardiaGlobal
/** Solo para los tests: una guardia nueva (con avisos falsos) o la real. */
export function reiniciarGuardiaParaPruebas(op?: Parameters<typeof crearGuardiaSalud>[0]): GuardiaSalud {
  guardiaGlobal = crearGuardiaSalud(op)
  return guardiaGlobal
}
/** Solo para los tests que prueban otra cosa (el mapeo HTTP del cliente, la compuerta, Bajas): una guardia que deja pasar
 *  todo. La guardia de verdad tiene sus propios tests (scripts/test-whatsapp-seguro.mjs). */
export const GUARDIA_ABIERTA: GuardiaSalud = { antesDeEscribir: async () => {}, alResponder: async () => {}, reportarCaida: async () => {}, estado: () => null }
export function fijarGuardiaParaPruebas(g: GuardiaSalud): void {
  guardiaGlobal = g
}
