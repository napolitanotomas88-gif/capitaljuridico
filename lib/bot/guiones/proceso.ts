// ── Orquestación de una tanda en el Despacho: un paso por invocación de /api/bot/guiones ──────────
// Vercel corta cada invocación a los 300 s y cada llamada a Claude tiene 240 s de tope: la tanda se arma por pasos,
// encadenados con un POST a la misma ruta (Bearer CRON_SECRET, se espera solo el 202; el trabajo va en after()). Cada
// llamada a Claude recibe como tope lo que le queda a la invocación (nunca dos de 230 s seguidas: revisión del 25/10).
//   iniciar    → crea la fila (o devuelve la que hay) y dispara «mercado».
//   mercado    → análisis de mercado con búsqueda web (mercado.ts) → «plan».
//   plan       → plan de la tanda → un «guion» por número, en paralelo.
//   guion n    → escribe y guarda (escrito) → «revisar n».
//   revisar n  → reglas + jefe creativo; si hay que corregir y alcanza el tiempo, corrige acá; si no, guarda «corrigiendo» y
//                dispara «corregir n». Al quedar listo, si es el último, cierra.
//   corregir n → corrige con los hallazgos guardados y, si es el último, cierra.
//   notas      → la respuesta del cliente: el bot decide a qué guiones va cada nota, los corrige en paralelo y la tanda vuelve
//                a revisión (pedido de Tomás del 25/10: corrige solo el bot y después da el check Faus o Tomi).
// Cerrar = la tanda pasa a a_revisar una sola vez (con condición) y sale el aviso al equipo (grupo de guiones de WhatsApp).
// Si algo falla, la tanda queda en «error» con el motivo; reanudar() la retoma desde lo que falta (también una colgada).
import type { ExtraccionKickoff, IdeaGuion } from '../kickoff/tipos'
import { CATALOGO, catalogoEnTexto } from './formatos'
import { clasificarNotas, corregir, escribir, hayQueCorregir, planificar, revisar, VERSION_TANDA, type EntradaTanda } from './generar'
import type { FilaTanda, GuionGuardado } from './registro'
import * as reg from './registro'
import { VERSION_PREFERENCIAS } from './preferencias'
import type { Guion } from './tipos'

export const CANTIDAD_GUIONES = 6
export const PASOS = ['mercado', 'plan', 'guion', 'revisar', 'corregir', 'notas'] as const
export type Paso = (typeof PASOS)[number]
export const FIN_INVOCACION_MS = 255_000
const TOPE_CLAUDE = 230_000
const MINIMO_LLAMADA_MS = 60_000
const MINIMO_PARA_CORREGIR_MS = 140_000

export interface KickoffParaGuiones { recording_id: number; id_crm: string | null; cliente: string | null; ficha: ExtraccionKickoff; ideas: IdeaGuion[] }
export type TipoAviso = 'revisar' | 'corregida'

export interface DepsProceso {
  /** local = la arma la Mac de Tomás con su plan Max (GUIONES_MOTOR, por defecto); api = la arma el Despacho con la API. */
  motor: 'local' | 'api'
  leerKickoff(recordingId: number): Promise<KickoffParaGuiones | null>
  registro: Pick<typeof reg, 'crearTanda' | 'leerTanda' | 'avanzar' | 'reclamar' | 'guardarGuion' | 'marcarError' | 'anotarAviso' | 'marcarEstado' | 'aplicarCorrecciones'>
  analizarMercado(ficha: ExtraccionKickoff, topeMs: number): Promise<{ texto: string; usage: { input_tokens: number; output_tokens: number } }>
  kb(ficha: ExtraccionKickoff): string | null
  disparar(paso: Paso, datos: { id: number; numero?: number }): Promise<void>
  avisar(fila: FilaTanda, tipo: TipoAviso): Promise<string | null>
  exigirActivo?(idCrm: string | null): Promise<void>
  ahora(): number
}

/** La provincia que nombra cada gancho (preferencia 2 de Tomás: provincia, nunca ciudad chica). */
export function ciudadDeFicha(f: ExtraccionKickoff): string {
  const d = `${f.zona.descripcion ?? ''} ${f.zona.presentarse_como?.texto ?? ''}`
  const m = d.match(/provincia de ([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?: (?:del |de )?[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)*)/i)
  if (m) return m[1].trim()
  const p = f.zona.presentarse_como?.texto?.replace(/\b(capital|centro|ciudad de)\b/gi, '').trim()
  return p || f.zona.lugares[0] || ''
}

export function entradaDe(k: KickoffParaGuiones, fila: FilaTanda, kb: string | null): EntradaTanda {
  return { ficha: k.ficha, ideas: k.ideas, cantidad: CANTIDAD_GUIONES, ciudad: fila.ciudad || ciudadDeFicha(k.ficha), catalogo: catalogoEnTexto(), mercado: fila.mercado, kb }
}

const motivoDe = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 300)

/** Dispara varios pasos sin cortar en el primero que falla; si alguno falló, error con el detalle. */
async function dispararTodos(deps: DepsProceso, pedidos: { paso: Paso; numero?: number }[], id: number): Promise<void> {
  const r = await Promise.allSettled(pedidos.map(p => deps.disparar(p.paso, { id, numero: p.numero })))
  const malos = r.map((x, k) => (x.status === 'rejected' ? `${pedidos[k].paso}${pedidos[k].numero ? ` ${pedidos[k].numero}` : ''} (${motivoDe(x.reason)})` : null)).filter(Boolean)
  if (malos.length) throw new Error(`no arrancaron: ${malos.join(', ')}`)
}

async function avisarYAnotar(fila: FilaTanda, tipo: TipoAviso, deps: DepsProceso): Promise<void> {
  try {
    await deps.exigirActivo?.(fila.id_crm)
    const msg = await deps.avisar(fila, tipo)
    if (msg) await deps.registro.anotarAviso(fila.id, msg)
  } catch (e) { console.error('bot-guiones: aviso al equipo falló —', motivoDe(e)) }
}

/** Pasa la tanda a a_revisar (una sola vez) y avisa al equipo. */
export async function cerrar(id: number, deps: DepsProceso): Promise<boolean> {
  if (deps.exigirActivo) { const fila = await deps.registro.leerTanda(id); await deps.exigirActivo(fila?.id_crm ?? null) }
  if (!(await deps.registro.avanzar(id, 'escribiendo', 'a_revisar'))) return false
  const lista = await deps.registro.leerTanda(id)
  if (lista) await avisarYAnotar(lista, 'revisar', deps)
  return true
}

export async function iniciar(recordingId: number, deps: DepsProceso): Promise<{ id: number; nueva: boolean; estado: string }> {
  const k = await deps.leerKickoff(recordingId)
  if (!k) throw new Error(`no hay ficha de kickoff para la grabación ${recordingId}`)
  await deps.exigirActivo?.(k.id_crm)
  if (!k.ideas.length) throw new Error('la ficha no tiene ideas')
  const { fila, nueva } = await deps.registro.crearTanda({ recording_id: recordingId, id_crm: k.id_crm, cliente: k.cliente, ciudad: ciudadDeFicha(k.ficha), version: `${VERSION_TANDA}/${VERSION_PREFERENCIAS}`, estado: deps.motor === 'local' ? 'pendiente' : 'mercado' })
  if (nueva && deps.motor === 'api') {
    try { await deps.disparar('mercado', { id: fila.id }) } catch (e) { await deps.registro.marcarError(fila.id, `mercado: no arrancó (${motivoDe(e)})`); throw e }
  }
  return { id: fila.id, nueva, estado: fila.estado }
}

/** Corre un paso. Un error deja la tanda en «error» con el motivo (la pantalla lo muestra y se puede retomar). */
export async function correrPaso(paso: Paso, datos: { id: number; numero?: number }, t0: number, deps: DepsProceso): Promise<string> {
  const fila = await deps.registro.leerTanda(datos.id)
  if (!fila) throw new Error(`no existe la tanda ${datos.id}`)
  await deps.exigirActivo?.(fila.id_crm)
  const k = await deps.leerKickoff(fila.recording_id)
  if (!k) throw new Error(`no hay ficha de kickoff para la grabación ${fila.recording_id}`)
  const quedan = () => t0 + FIN_INVOCACION_MS - deps.ahora()
  const tope = () => {
    const t = Math.min(TOPE_CLAUDE, quedan() - 15_000)
    if (t < MINIMO_LLAMADA_MS) throw new Error('no alcanzó el tiempo de la invocación')
    return t
  }
  const e = entradaDe(k, fila, deps.kb(k.ficha))
  try {
    if (paso === 'mercado') {
      if (fila.estado !== 'mercado') return `ya pasó del mercado (${fila.estado})`
      const m = await deps.analizarMercado(k.ficha, tope())
      if (await deps.registro.avanzar(fila.id, 'mercado', 'plan', { mercado: m.texto, uso: m.usage })) await dispararTodos(deps, [{ paso: 'plan' }], fila.id)
      return 'mercado listo'
    }
    if (paso === 'plan') {
      if (fila.estado !== 'plan') return `ya pasó del plan (${fila.estado})`
      const p = await planificar(e, CATALOGO, { topeMs: tope() })
      if (!p.plan.length) throw new Error('el plan vino vacío')
      if (await deps.registro.avanzar(fila.id, 'plan', 'escribiendo', { plan: p.plan, uso: p.usage })) await dispararTodos(deps, p.plan.map(f => ({ paso: 'guion' as const, numero: f.numero })), fila.id)
      return `plan listo (${p.plan.length})`
    }
    if (paso === 'notas') return await corregirConNotas(fila, e, deps, tope)

    const n = datos.numero
    if (!n || !fila.plan?.some(f => f.numero === n)) throw new Error(`guion ${n} fuera del plan`)
    if (fila.estado !== 'escribiendo') return `la tanda ya no está escribiendo (${fila.estado})`
    const previo = fila.guiones[String(n)]
    if (paso === 'guion') {
      if (previo) return `el guion ${n} ya estaba escrito`
      const w = await escribir(e, fila.plan, n, { topeMs: tope() })
      if (!(await deps.registro.guardarGuion(fila.id, n, { guion: w.guion, hallazgos: [], revision: null, estado: 'escrito' }, w.usage))) return `guion ${n}: no correspondía guardarlo`
      await dispararTodos(deps, [{ paso: 'revisar', numero: n }], fila.id)
      return `guion ${n} escrito`
    }
    if (paso === 'revisar') {
      if (previo?.estado !== 'escrito') return `el guion ${n} no espera revisión`
      const r = await revisar(e, fila.plan, previo.guion, CATALOGO, { topeMs: tope() })
      let g: GuionGuardado = { ...previo, hallazgos: r.hallazgos, revision: r.revision, estado: 'listo' }
      let uso = r.usage
      if (hayQueCorregir(r.hallazgos, r.revision)) {
        // Se guarda revisado ANTES de corregir: si la corrección falla, no se pierde lo pagado
        if (!(await deps.registro.guardarGuion(fila.id, n, { ...g, estado: 'corrigiendo' }, uso))) return `guion ${n}: no correspondía guardarlo`
        uso = { input_tokens: 0, output_tokens: 0 }
        if (quedan() < MINIMO_PARA_CORREGIR_MS) { await dispararTodos(deps, [{ paso: 'corregir', numero: n }], fila.id); return `guion ${n} revisado, corrige en otra invocación` }
        const c = await corregir(e, fila.plan, previo.guion, r.hallazgos, r.revision, { topeMs: tope() })
        g = { ...g, guion: c.guion }
        uso = c.usage
      }
      return await terminarGuion(fila.id, n, g, uso, deps)
    }
    // corregir
    if (previo?.estado !== 'corrigiendo') return `el guion ${n} no espera corrección`
    const c = await corregir(e, fila.plan, previo.guion, previo.hallazgos, previo.revision, { topeMs: tope() })
    return await terminarGuion(fila.id, n, { ...previo, guion: c.guion, estado: 'listo' }, c.usage, deps)
  } catch (err) {
    await deps.registro.marcarError(fila.id, `${paso}${datos.numero ? ` ${datos.numero}` : ''}: ${motivoDe(err)}`).catch(() => {})
    throw err
  }
}

async function terminarGuion(id: number, n: number, g: GuionGuardado, uso: { input_tokens: number; output_tokens: number }, deps: DepsProceso): Promise<string> {
  const r = await deps.registro.guardarGuion(id, n, g, uso)
  if (!r) return `guion ${n}: no correspondía guardarlo`
  if (r.listos >= r.total && (await cerrar(id, deps))) return `guion ${n} listo · tanda lista para revisar`
  return `guion ${n} listo (${r.listos}/${r.total})`
}

/** La respuesta del cliente: decide a qué guiones va cada nota, los corrige en paralelo y vuelve a revisión con aviso. */
async function corregirConNotas(fila: FilaTanda, e: EntradaTanda, deps: DepsProceso, tope: () => number): Promise<string> {
  const notas = fila.notas.filter(x => !x.aplicada)
  if (!notas.length) { await deps.registro.marcarEstado(fila.id, ['con_notas'], 'a_revisar'); return 'no hay notas para aplicar' }
  if (!(await deps.registro.marcarEstado(fila.id, ['con_notas'], 'corrigiendo'))) return `la tanda no está con notas (${fila.estado})`
  const guiones = Object.values(fila.guiones).map(g => g.guion).sort((a, b) => a.numero - b.numero)
  const cl = await clasificarNotas(guiones, notas, { topeMs: Math.min(60_000, tope()) })
  const porGuion = new Map<number, string[]>()
  for (const nota of notas) for (const n of cl.mapa[nota.id] ?? []) porGuion.set(n, [...(porGuion.get(n) ?? []), nota.texto])
  const t = tope()
  const hechos = await Promise.all([...porGuion].map(async ([n, textos]) => {
    const g = guiones.find(x => x.numero === n)!
    const c = await corregir(e, fila.plan ?? [], g, [], null, { notasCliente: textos, topeMs: t })
    return [String(n), c.guion, c.usage] as const
  }))
  const uso = hechos.reduce((a, [, , u]) => ({ input_tokens: a.input_tokens + u.input_tokens, output_tokens: a.output_tokens + u.output_tokens }), cl.usage)
  const nuevos: Record<string, Guion> = Object.fromEntries(hechos.map(([n, g]) => [n, g]))
  if (!(await deps.registro.aplicarCorrecciones(fila.id, nuevos, notas.map(x => ({ id: x.id, guiones: cl.mapa[x.id] ?? [] })), uso))) return 'la tanda cambió mientras se corregía'
  const lista = await deps.registro.leerTanda(fila.id)
  if (lista) await avisarYAnotar(lista, 'corregida', deps)
  return `corregidos ${hechos.length} guion(es) con ${notas.length} nota(s)`
}

/** Retoma una tanda en error o colgada desde lo que falta; una lista para revisar sin aviso, reenvía el aviso. */
export async function reanudar(id: number, deps: DepsProceso): Promise<string> {
  const fila = await deps.registro.leerTanda(id)
  if (!fila) throw new Error(`no existe la tanda ${id}`)
  await deps.exigirActivo?.(fila.id_crm)
  // Pendiente de la Mac: con el motor de la API (el respaldo, «Armar con la API»), arranca acá
  if (fila.estado === 'pendiente') {
    if (deps.motor === 'local') return 'está esperando a la Mac'
    if (!(await deps.registro.avanzar(id, 'pendiente', 'mercado'))) return 'otro la está armando'
    await dispararTodos(deps, [{ paso: 'mercado' }], id)
    return 'armándose con la API'
  }
  if (fila.estado === 'a_revisar' && !fila.aviso_discord) { await avisarYAnotar(fila, 'revisar', deps); return 'aviso reenviado' }
  const pendientes = fila.notas.some(x => !x.aplicada)
  const todosListos = !!fila.plan?.length && fila.plan.every(f => fila.guiones[String(f.numero)]?.estado === 'listo')
  const destino: reg.EstadoTanda = !fila.mercado ? 'mercado' : !fila.plan?.length ? 'plan' : todosListos && pendientes ? 'con_notas' : 'escribiendo'
  if (!(await deps.registro.reclamar(id, destino))) return fila.estado === 'error' ? 'otro la está retomando' : `la tanda está en ${fila.estado} y se movió hace poco: no hace falta retomarla`
  // Motor local: la Mac toma las tandas en estado de trabajo que no se movieron (tandasParaLocal); acá no se dispara nada
  if (deps.motor === 'local') return 'la retoma la Mac en los próximos minutos'
  try {
    if (destino === 'mercado' || destino === 'plan') { await dispararTodos(deps, [{ paso: destino }], id); return `retomada desde ${destino}` }
    if (destino === 'con_notas') { await dispararTodos(deps, [{ paso: 'notas' }], id); return 'retomada: corrigiendo con las notas' }
    if (todosListos) { await cerrar(id, deps); return 'retomada: tanda lista para revisar' }
    const pedidos = fila.plan!.flatMap(f => {
      const est = fila.guiones[String(f.numero)]?.estado
      return est === 'listo' ? [] : [{ paso: (est === 'escrito' ? 'revisar' : est === 'corrigiendo' ? 'corregir' : 'guion') as Paso, numero: f.numero }]
    })
    await dispararTodos(deps, pedidos, id)
    return `retomada: ${pedidos.length} guion(es)`
  } catch (e) {
    await deps.registro.marcarError(id, `retomar: ${motivoDe(e)}`).catch(() => {})
    throw e
  }
}
