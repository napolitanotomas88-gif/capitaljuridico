// ── e01 por WhatsApp: el bot manda al grupo Contenido los pasos de la escalera que son para el cliente ───────────────────
// APAGADO por defecto: solo con E01_WHATSAPP=real, E01_WHATSAPP_DESDE=<aaaa-mm-dd> (la fecha en que se prende: lo que venció
// antes lo sigue mandando Aylu a mano) y Edición en modo real. Se prende cuando el bot esté en los grupos Contenido de los
// clientes, después de una prueba controlada y con el OK de Tomás.
// La cadencia es la de siempre (calcularE01, Tomás 25/10): día 0 hábil, 2, 4 y 9, y recordatorios cada 4 hábiles si Tomás
// decide seguir. El bot SOLO manda los pasos con texto para el cliente (el día 0 y los recordatorios; E01_WHATSAPP_ESCALONES
// los acota): el audio del día 2 y la llamada del día 4 son de Gero M, y el día 9 lo decide Tomás.
// En cada vuelta del diario o del vigía (es idempotente: un paso reclamado o anotado ya no es elegible):
//   · elegibles: abiertos, sin hacer, sin freno, vencidos hoy o hace poco y desde E01_WHATSAPP_DESDE, un paso por cliente,
//     en día hábil y de HORA_DESDE a HORA_HASTA de Argentina;
//   · los grupos del número del bot se leen UNA vez por vuelta; el del cliente es «Contenido - …» con TODAS las palabras del
//     nombre como palabras enteras (no pedazos: «Ana» no es «Mariana»). Si no hay uno solo claro, el paso queda anotado
//     «No salió por WhatsApp: …» y lo manda Aylu a mano (el bot no lo vuelve a intentar);
//   · antes de reclamar se vuelve a mirar que siga vigente (los pasos se calculan a las 7 y el cliente pudo subir crudos
//     después, o pasar a «graba el equipo»);
//   · reclamar el paso (hecho a nombre del bot, «enviando…») → mandar → confirmar con el id del mensaje. Si Whapi lo rechazó
//     seguro (aplicado false), se suelta con «No salió…»; si no se sabe (5xx, corte), queda hecho con «dudoso: revisar el
//     grupo antes de reenviar» y aviso a Tomás. Un «enviando…» de más de MINUTOS_COLGADO se pasa a dudoso con aviso.
//   · MAX_ENVIOS_POR_VUELTA cuenta envíos reales (los sin grupo no tapan a los demás).
//   · WhatsApp seguro (1/11): si hay algo para mandar, primero se mira la salud del número (GET /health de Whapi). Si no
//     está conectado, la vuelta se pausa sin leer grupos ni tocar pasos (sin aviso: la guardia de salud ya avisa una vez a
//     Discord) y se reintenta en la vuelta siguiente. Si se cae en medio de la vuelta (ErrorWhapi 'sin_numero'), el paso se
//     devuelve tal cual (sin «No salió»: lo vuelve a tomar el bot) y la vuelta se corta.
import type { IdCrm, PasoSeguimiento, Ymd } from '@/lib/edicion/tipos'
import { fechaSugeridaE01, nombreDeSaludo, textoE01 } from '@/lib/edicion/textos'
import { linkDoc } from '@/lib/edicion/vista'

export const VARIABLE_E01_WHATSAPP = 'E01_WHATSAPP'
export const VARIABLE_DESDE = 'E01_WHATSAPP_DESDE'
export const VARIABLE_ESCALONES = 'E01_WHATSAPP_ESCALONES'      // 'dia0,recordatorio' (por defecto), 'dia0' o 'recordatorio'
export const HORA_DESDE = 10
export const HORA_HASTA = 19
export const MAX_ENVIOS_POR_VUELTA = 10
export const MAX_DIAS_ATRASO = 4                                  // días corridos (cubre un fin de semana largo)
export const MARGEN_POR_PASO_MS = 50_000
export const MINUTOS_COLGADO = 10
export const PREFIJO_NO_SALIO = 'No salió por WhatsApp'
export const NOTA_ENVIANDO = 'enviando por WhatsApp…'
export const QUIEN_BOT_WHATSAPP = 'Bot (WhatsApp)'

export type TipoEnvio = 'dia0' | 'recordatorio'
export interface GrupoWhatsapp { id: string; nombre: string }
export interface DepsE01Whatsapp {
  pasosAbiertos(): Promise<PasoSeguimiento[]>
  docs(): Promise<Map<IdCrm, string | null>>
  /** Los grupos del número del bot (una lectura por vuelta). Tira si Whapi falla o falta el token. */
  grupos(): Promise<GrupoWhatsapp[]>
  /** ¿El paso sigue vigente? (sus videos siguen esperando crudos, sin crudos nuevos sin ubicar, no lo graba el equipo) */
  vigente(p: PasoSeguimiento): Promise<boolean>
  /** Tira un error con `aplicado` (false = seguro que no salió; null = no se sabe). */
  enviar(chatId: string, texto: string): Promise<{ id: string | null }>
  reclamar(id: number, version: number, texto: string): Promise<boolean>
  confirmar(id: number, nota: string): Promise<void>
  soltar(id: number, motivo: string): Promise<void>
  anotarNoSalio(id: number, version: number, motivo: string): Promise<void>
  colgados(minutos: number): Promise<{ id: number; cliente: string }[]>
  /** ¿El número del bot está conectado? (WhatsApp seguro). Sin esto no se mira y decide la guardia de cada envío. */
  salud?(): Promise<{ ok: boolean; motivo: string }>
  /** Devuelve un paso reclamado a «sin hacer» sin anotarlo (el número se cayó: lo vuelve a tomar el bot). */
  devolver?(id: number): Promise<void>
  env: Record<string, string | undefined>
  esHabil(d: Ymd): boolean
}
export interface ResultadoE01Whatsapp {
  apagado: string | null
  /** Por qué se pausó la vuelta (número del bot desconectado): se reintenta sola en la vuelta siguiente. */
  pausado: string | null
  elegibles: number; enviados: number; sin_grupo: string[]; errores: string[]
  /** Lo que merece un aviso a Tomás (pasa una sola vez por paso). Leer los grupos puede fallar en cada vuelta: solo errores. */
  avisar: string[]
}

const ymdAR = (d: Date): Ymd => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
const horaAR = (d: Date): number => Number(new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(11, 13))
const motivo = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)
const sinNumero = (e: unknown): boolean => (e as { tipo?: unknown })?.tipo === 'sin_numero' && (e as { aplicado?: unknown })?.aplicado === false
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const palabras = (s: string) => normal(s).split(/[^a-z0-9ñ]+/).filter(Boolean)

export const tipoDe = (p: Pick<PasoSeguimiento, 'escalon'>): TipoEnvio | null =>
  p.escalon === 'dia0' ? 'dia0' : /^r\d+$/.test(p.escalon) ? 'recordatorio' : null

export function escalonesActivos(env: Record<string, string | undefined>): Set<TipoEnvio> {
  const crudo = (env[VARIABLE_ESCALONES] ?? '').trim().toLowerCase()
  const xs = (crudo ? crudo.split(/[\s,]+/) : ['dia0', 'recordatorio']).filter((x): x is TipoEnvio => x === 'dia0' || x === 'recordatorio')
  return new Set(xs)
}

/** La configuración si está prendido (para el motor y para la pantalla de pendientes), o null. */
export function configE01Whatsapp(env: Record<string, string | undefined>): { desde: Ymd; tipos: Set<TipoEnvio> } | null {
  if (env[VARIABLE_E01_WHATSAPP]?.trim() !== 'real') return null
  const desde = env[VARIABLE_DESDE]?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return null
  return { desde, tipos: escalonesActivos(env) }
}

/** ¿Este paso lo manda el bot? (la pantalla de pendientes no ofrece copiarlo, así Aylu no lo manda también) */
export function loMandaElBot(p: Pick<PasoSeguimiento, 'escalon' | 'debido' | 'texto' | 'hecho'>, cfg: { desde: Ymd; tipos: ReadonlySet<TipoEnvio> } | null): boolean {
  const t = tipoDe(p)
  return !!cfg && !!t && cfg.tipos.has(t) && p.debido >= cfg.desde && !p.hecho && !(p.texto ?? '').startsWith(PREFIJO_NO_SALIO)
}

/** Por qué no corre (null = prendido). */
export function motivoApagado(env: Record<string, string | undefined>, modo: 'dry' | 'real', ahora: Date, esHabil: (d: Ymd) => boolean): string | null {
  if (env[VARIABLE_E01_WHATSAPP]?.trim() !== 'real') return `${VARIABLE_E01_WHATSAPP} no está en «real»`
  if (!configE01Whatsapp(env)) return `falta ${VARIABLE_DESDE} (aaaa-mm-dd, el día en que se prende)`
  if (modo !== 'real') return 'Edición no está en modo real'
  if (!esHabil(ymdAR(ahora))) return 'hoy no es día hábil'
  const h = horaAR(ahora)
  if (h < HORA_DESDE || h >= HORA_HASTA) return `fuera de horario (${HORA_DESDE} a ${HORA_HASTA} h)`
  return null
}

/** Los pasos que el bot manda hoy (puro). Uno por cliente, el más viejo primero. */
export function elegibles(pasos: readonly PasoSeguimiento[], hoy: Ymd, cfg: { desde: Ymd; tipos: ReadonlySet<TipoEnvio> }): PasoSeguimiento[] {
  const atraso = new Date(Date.parse(`${hoy}T12:00:00Z`) - MAX_DIAS_ATRASO * 86_400_000).toISOString().slice(0, 10)
  const desde = atraso > cfg.desde ? atraso : cfg.desde
  const vistos = new Set<string>()
  const out: PasoSeguimiento[] = []
  for (const p of [...pasos].sort((a, b) => a.debido.localeCompare(b.debido) || a.id - b.id)) {
    if (!loMandaElBot(p, cfg) || p.estado !== 'abierto' || p.frenado) continue
    if (p.debido > hoy || p.debido < desde) continue
    const k = p.id_crm.toUpperCase()
    if (vistos.has(k)) continue
    vistos.add(k)
    out.push(p)
  }
  return out
}

/** El grupo «Contenido - …» del cliente: todas las palabras del nombre (3+ letras) como palabras ENTERAS. null si no hay uno solo. */
export function grupoDe(cliente: string, grupos: readonly GrupoWhatsapp[]): GrupoWhatsapp | null {
  const buscadas = palabras(cliente).filter(w => w.length >= 3)
  if (!buscadas.length) return null
  const xs = grupos.filter(g => /@g\.us$/.test(g.id) && /^contenido\s*-/.test(normal(g.nombre).trim()) && (ws => buscadas.every(w => ws.has(w)))(new Set(palabras(g.nombre))))
  return xs.length === 1 ? xs[0] : null
}

export async function enviarE01(deps: DepsE01Whatsapp, op: { ahora: Date; modo: 'dry' | 'real'; deadline: number }): Promise<ResultadoE01Whatsapp> {
  const out: ResultadoE01Whatsapp = { apagado: null, pausado: null, elegibles: 0, enviados: 0, sin_grupo: [], errores: [], avisar: [] }
  out.apagado = motivoApagado(deps.env, op.modo, op.ahora, deps.esHabil)
  if (out.apagado) return out
  const cfg = configE01Whatsapp(deps.env)!
  // Los «enviando…» colgados (el proceso se cortó entre reclamar y confirmar): a dudoso, con aviso (una sola vez)
  for (const c of await deps.colgados(MINUTOS_COLGADO)) {
    await deps.confirmar(c.id, 'dudoso: el bot no confirmó el envío. Revisar el grupo antes de reenviar')
    out.avisar.push(`e01 por WhatsApp: no se sabe si salió el mensaje a ${c.cliente}. Revisar el grupo Contenido antes de reenviar`)
  }
  const hoy = ymdAR(op.ahora)
  const xs = elegibles(await deps.pasosAbiertos(), hoy, cfg)
  out.elegibles = xs.length
  if (!xs.length) return out
  if (deps.salud) {
    const s = await deps.salud().catch(e => ({ ok: false, motivo: motivo(e) }))
    if (!s.ok) { out.pausado = s.motivo.slice(0, 200); return out }
  }
  let grupos: GrupoWhatsapp[]
  try { grupos = await deps.grupos() } catch (e) { out.errores.push(`no se pudieron leer los grupos de WhatsApp (${motivo(e)})`); return out }
  const docs = await deps.docs()
  for (const p of xs) {
    if (out.enviados >= MAX_ENVIOS_POR_VUELTA || Date.now() > op.deadline - MARGEN_POR_PASO_MS) break
    const t = textoE01({ paso: p, nombre: nombreDeSaludo(p.cliente), linkGuiones: linkDoc(docs.get(p.id_crm.toUpperCase()) ?? null), fechaSugerida: fechaSugeridaE01(hoy), videos: p.videos.length })
    if (t.para !== 'grupo_contenido') continue
    const g = grupoDe(p.cliente, grupos)
    if (!g) {
      out.sin_grupo.push(p.cliente)
      await deps.anotarNoSalio(p.id, p.version, 'el bot no encontró un solo grupo «Contenido» de este cliente. Mandalo a mano')
      continue
    }
    if (!(await deps.vigente(p))) continue                       // ya subió crudos o lo graba el equipo: el diario lo cierra
    if (!(await deps.reclamar(p.id, p.version, t.texto))) continue   // alguien lo marcó recién
    let r: { id: string | null }
    try {
      r = await deps.enviar(g.id, t.texto)
    } catch (e) {
      if (sinNumero(e) && deps.devolver) {
        // El número se cayó en medio de la vuelta: no salió nada; el paso vuelve a estar disponible y se corta acá
        out.pausado = motivo(e)
        await deps.devolver(p.id).catch(() => undefined)
        break
      }
      out.errores.push(`${p.cliente}: ${motivo(e)}`)
      if ((e as { aplicado?: unknown })?.aplicado === false) {
        out.avisar.push(`e01 por WhatsApp: no salió el mensaje a ${p.cliente} (${motivo(e)}). Quedó para mandarlo a mano`)
        await deps.soltar(p.id, `${motivo(e)}. Mandalo a mano`).catch(() => undefined)
      } else {
        // No se sabe si salió: NO se suelta (un reenvío podría duplicarlo)
        out.avisar.push(`e01 por WhatsApp: no se sabe si salió el mensaje a ${p.cliente} (${motivo(e)}). Revisar el grupo antes de reenviar`)
        await deps.confirmar(p.id, `dudoso: ${motivo(e)}. Revisar el grupo antes de reenviar`).catch(() => undefined)
      }
      continue
    }
    out.enviados++
    // Ya salió: si la confirmación falla, queda «enviando…» y la vuelta siguiente lo pasa a dudoso (nunca se suelta)
    try { await deps.confirmar(p.id, `enviado por WhatsApp a «${g.nombre.slice(0, 80)}»${r.id ? ` (mensaje ${r.id.slice(0, 40)})` : ''}`) }
    catch (e) { out.errores.push(`${p.cliente}: salió pero no se pudo confirmar el paso (${motivo(e)})`) }
  }
  return out
}
