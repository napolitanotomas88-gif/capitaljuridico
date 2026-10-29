// ── Cola de avisos de Edición: de los eventos del motor y la pantalla a Discord ─────────────────────────────────────────
// Dos pasos, con las dependencias INYECTADAS (los tests usan una cola en memoria, un lector de juguete y un Discord falso):
//   1. planificar() (pura): eventos + AvisoMotor → avisos a encolar, con su base de agrupación y cuándo salen.
//   2. despachar(): toma los vencidos, arma el texto con lo que hay AHORA en la base (la "foto"), y manda, deja en dry o
//      descarta. Un aviso que quedó `enviando` más de 10 minutos pasa a `dudoso` (no se reintenta solo).
// Reglas de agrupación (docs/edicion/AVISOS.md):
//   tanda_crudos (una vez por tanda, enseguida) → Aylu · para_editar (rene_cola:<id_crm>: enseguida si no queda nada en
//   crudo_a_revisar del cliente; si no, a los 30 min) → René · editados (aylu_editados:<id_crm>: lote completo, sin nada en
//   para_editar, o 30 min sin otro) → Aylu · correccion (rene_correccion:<id_crm>: 10 min; también una nota o un pedido que
//   se suma a la ronda abierta) → René · corregidos (aylu_corregidos:<id_crm>: lote completo o 30 min) → Aylu · aprobado
//   (valen:<id_crm>: 30 min sin otro OK) → Valen en #ads · tope_rondas, marca_falta, resumen_daily, error, vigia_callado,
//   crudo_borrado, vinculo_pendiente y el bloqueo que marca René: una vez · transcripcion_fallida: por cliente y día, 20 min.
// Modos: EDICION_MODO=dry (por defecto) → no se escribe nada: devuelve el plan (con el texto que saldría). Real con
// EDICION_AVISOS=dry (modo sombra) → se encola y el texto queda en estado `dry`, sin Discord. Real → sale.
import { ErrorEnvio, enviarDiscord } from '@/lib/fathomAnuncios/discord'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { ESPERA_TRANSCRIPCION_MIN, VENTANA_AGRUPAR_MIN, VENTANA_CORRECCION_MIN } from '../config'
import type { Aviso, AvisoMotor, CanalAviso, EstadoAviso, EventoVideo, Iso, TandaSubida } from '../tipos'
import { DESTINO, armarMensaje, fotoVacia, type FilaAviso, type FotoAviso, type MensajeAviso, type NotaAviso, type TipoAviso } from './mensajes'
import { mencionesEdicion, modoAvisos, urlDespacho, webhookAds, webhookEdicion } from './entorno'

type Entorno = Record<string, string | undefined>
const MIN = 60_000
export const TOPE_DESPACHO = 20
export const REINTENTOS_PASAJEROS = 3
export const ESPERA_REINTENTO_MIN = 5

export interface PlanAviso { base: string; tipo: TipoAviso; canal: CanalAviso; datos: Record<string, unknown>; enviar_despues: Iso; unaVez?: boolean }

/** Lo que el plan necesita saber del estado actual: los videos de cada cliente tocado (para "lote completo"). */
export interface ContextoPlan { filasPorCliente: Map<string, FilaAviso[]> }

/** FNV-1a de 32 bits en hex: una huella corta y estable para las bases (sin node:crypto, para que sea pura). */
export function huella(t: string): string {
  let h = 0x811c9dc5
  const s = t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

const en = (ahora: Date, min: number): Iso => new Date(ahora.getTime() + min * MIN).toISOString()

/** Eventos + avisos del motor → avisos a encolar (pura). */
export function planificar(eventos: readonly EventoVideo[], extra: readonly AvisoMotor[], ctx: ContextoPlan, ahora: Date): PlanAviso[] {
  const plan: PlanAviso[] = []
  const ymd = hoyArgentina(ahora)
  const ya = new Set<string>()
  const sumar = (p: PlanAviso) => {
    // Dentro de un mismo lote, el segundo aviso de la misma base mezcla sus videos con el primero (igual que la cola)
    const previo = plan.find(x => x.base === p.base)
    if (previo) {
      const vs = [...new Set([...((previo.datos.videos as number[]) ?? []), ...((p.datos.videos as number[]) ?? [])])]
      previo.datos = { ...previo.datos, ...p.datos, ...(vs.length ? { videos: vs } : {}) }
      previo.enviar_despues = p.enviar_despues < previo.enviar_despues ? p.enviar_despues : previo.enviar_despues
      return
    }
    plan.push(p)
  }
  for (const e of eventos) {
    const filas = ctx.filasPorCliente.get(e.id_crm) ?? []
    const fila = filas.find(f => f.id === e.video_id)
    const cliente = e.cliente || fila?.cliente || e.id_crm
    const hay = (estado: FilaAviso['estado']) => filas.some(f => f.estado === estado && f.id !== e.video_id)
    const base = { id_crm: e.id_crm, cliente, videos: [e.video_id] }
    const destino = e.tipo === 'estado' || e.tipo === 'autorizacion' || (e.tipo === 'pedido' && e.a) ? e.a : null
    switch (destino) {
      case 'para_editar':
        sumar({ base: `rene_cola:${e.id_crm}`, tipo: 'para_editar', canal: 'edicion', datos: base, enviar_despues: hay('crudo_a_revisar') ? en(ahora, VENTANA_AGRUPAR_MIN) : ahora.toISOString() })
        if (fila && fila.paleta === false && !ya.has(`marca:${e.id_crm}`)) {
          ya.add(`marca:${e.id_crm}`)
          const n = filas.filter(f => f.estado === 'para_editar').length || 1
          sumar({ base: `marca:${e.id_crm}:${ymd}`, tipo: 'marca_falta', canal: 'edicion', datos: { id_crm: e.id_crm, cliente, videos: n }, enviar_despues: ahora.toISOString(), unaVez: true })
        }
        break
      case 'editado':
        sumar({ base: `aylu_editados:${e.id_crm}`, tipo: 'editados', canal: 'edicion', datos: base, enviar_despues: hay('para_editar') ? en(ahora, VENTANA_AGRUPAR_MIN) : ahora.toISOString() })
        break
      case 'correccion':
        sumar({ base: `rene_correccion:${e.id_crm}`, tipo: 'correccion', canal: 'edicion', datos: base, enviar_despues: en(ahora, VENTANA_CORRECCION_MIN) })
        break
      case 'corregido':
        sumar({ base: `aylu_corregidos:${e.id_crm}`, tipo: 'corregidos', canal: 'edicion', datos: base, enviar_despues: hay('correccion') ? en(ahora, VENTANA_AGRUPAR_MIN) : ahora.toISOString() })
        break
      case 'aprobado':
        sumar({ base: `valen:${e.id_crm}`, tipo: 'aprobado', canal: 'ads', datos: base, enviar_despues: en(ahora, VENTANA_AGRUPAR_MIN) })
        break
      default:
        // Una nota (o un pedido del cliente) que se suma a la ronda ABIERTA: va con la corrección agrupada, sin sumar ronda
        if ((e.tipo === 'nota' || e.tipo === 'pedido') && !e.a && fila?.estado === 'correccion') {
          sumar({ base: `rene_correccion:${e.id_crm}`, tipo: 'correccion', canal: 'edicion', datos: base, enviar_despues: en(ahora, VENTANA_CORRECCION_MIN) })
        }
        // René marcó un bloqueo ("otro", con motivo): se le avisa a Aylu
        if (e.tipo === 'bloqueo' && e.actor.tipo === 'persona' && e.actor.rol === 'rene' && (fila?.bloqueo ?? (e.datos as { bloqueo?: unknown }).bloqueo)) {
          const motivo = e.nota || String((e.datos as { motivo_bloqueo?: unknown }).motivo_bloqueo ?? '') || fila?.motivo_bloqueo || 'sin motivo'
          sumar({ base: `bloqueo:${e.video_id}:${e.id}`, tipo: 'bloqueo', canal: 'edicion', unaVez: true, enviar_despues: ahora.toISOString(),
            datos: { video_id: e.video_id, id_crm: e.id_crm, cliente, clave: fila?.clave ?? String(e.datos.clave ?? ''), numero: fila?.numero ?? null, motivo, quien: e.actor.nombre } })
        }
    }
  }
  for (const x of extra) {
    const ahoraIso = ahora.toISOString()
    switch (x.tipo) {
      case 'tanda_crudos':
        if (x.tanda.tipo !== 'crudos') break
        sumar({ base: `tanda:${x.tanda.id}`, tipo: 'tanda_crudos', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso,
          datos: { tanda_id: x.tanda.id, id_crm: x.tanda.id_crm, cliente: x.cliente, demorada: x.demorada } })
        break
      case 'resumen_daily':
        sumar({ base: `resumen:${x.resumen.fecha}`, tipo: 'resumen_daily', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso, datos: { resumen: x.resumen } })
        break
      case 'marca_falta':
        sumar({ base: `marca:${x.id_crm}:${ymd}`, tipo: 'marca_falta', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso, datos: { id_crm: x.id_crm, cliente: x.cliente, videos: x.videos } })
        break
      case 'marca_propuesta':
        sumar({ base: `marca_prop:${x.id_crm}:${ymd}`, tipo: 'marca_propuesta', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso,
          datos: { id_crm: x.id_crm, cliente: x.cliente, archivos: x.archivos, archivo: x.archivo } })
        break
      case 'tope_rondas':
        sumar({ base: `tope:${x.video_id}:${x.ronda}`, tipo: 'tope_rondas', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso,
          datos: { video_id: x.video_id, id_crm: x.id_crm, cliente: x.cliente, clave: x.clave, numero: x.numero ?? null, ronda: x.ronda, pedido_id: x.pedido_id } })
        break
      case 'error':
        sumar({ base: `error:${x.proceso.replace(/\W+/g, '_').slice(0, 30)}:${huella(x.motivo)}:${ymd}`, tipo: 'error', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso,
          datos: { proceso: x.proceso, motivo: x.motivo.slice(0, 500) } })
        break
      case 'vigia_callado':
        sumar({ base: `callado:${x.desde}`, tipo: 'vigia_callado', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso, datos: { desde: x.desde, horas: x.horas } })
        break
      case 'crudo_borrado':
        sumar({ base: `borrado:${x.video_id}:${huella(x.archivo)}`, tipo: 'crudo_borrado', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso,
          datos: { video_id: x.video_id, id_crm: x.id_crm, cliente: x.cliente, clave: x.clave, numero: x.numero ?? null, archivo: x.archivo } })
        break
      case 'vinculo_pendiente':
        sumar({ base: `vinculo:${x.carpeta_id}`, tipo: 'vinculo_pendiente', canal: 'edicion', unaVez: true, enviar_despues: ahoraIso,
          datos: { carpeta_id: x.carpeta_id, nombre: x.nombre, candidatos: x.candidatos.slice(0, 3) } })
        break
      case 'transcripcion_fallida':
        sumar({ base: `transcripcion:${x.id_crm}:${ymd}`, tipo: 'transcripcion_fallida', canal: 'edicion', enviar_despues: en(ahora, ESPERA_TRANSCRIPCION_MIN),
          datos: { id_crm: x.id_crm, cliente: x.cliente, archivos: [{ archivo_id: x.archivo_id, nombre: x.nombre, motivo: x.motivo }] } })
        break
    }
  }
  return plan
}

// ── Despacho ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface LectorAvisos {
  /** Los videos del cliente como están ahora (todos, también los finales). */
  videosDeCliente(id_crm: string): Promise<FilaAviso[]>
  videosPorIds(ids: number[]): Promise<FilaAviso[]>
  notasDe(video_id: number): Promise<NotaAviso[]>
  tanda(id: number): Promise<TandaSubida | null>
  sugerenciaMeta(cliente: string): Promise<string | null>
}
export interface RepoAvisos {
  encolar(a: PlanAviso): Promise<Aviso>
  reclamarVencidos(ahora: Iso, limite: number): Promise<Aviso[]>
  cerrarAviso(id: number, r: { estado: EstadoAviso; texto: string; menciones: string[]; mensaje_id?: string; error?: string }): Promise<void>
  reprogramar(a: Pick<Aviso, 'id' | 'base' | 'datos'>, enviar_despues: Iso, error: string): Promise<'pendiente' | 'mezclado'>
  marcarDudosos(ahora: Iso): Promise<Aviso[]>
}
export interface DepsCola {
  repo: RepoAvisos
  lector: LectorAvisos
  enviar?: typeof enviarDiscord
  env?: Entorno
  ahora?: () => Date
  /** ¿Hay base? Sin DATABASE_URL no hay cola: no se encola ni se despacha. */
  baseLista?: () => boolean
  /** Adaptador real: revalida el cliente antes de encolar y justo antes de enviar. False = archivado; error = estado incierto. */
  esOperativo?(datos: Record<string, unknown>): Promise<boolean>
}
export interface OpcionesDespacho { deadline?: number; limite?: number; fetch?: typeof fetch }

/** La foto de la base que necesita cada tipo de aviso para armar su texto. */
export async function armarFoto(a: Pick<Aviso, 'tipo' | 'datos' | 'canal'>, lector: LectorAvisos, env: Entorno): Promise<FotoAviso> {
  const foto = fotoVacia()
  const d = a.datos as { id_crm?: string; cliente?: string; videos?: number[]; tanda_id?: number }
  switch (a.tipo as TipoAviso) {
    case 'tanda_crudos':
      if (d.tanda_id) foto.tanda = await lector.tanda(d.tanda_id)
      break
    case 'para_editar': case 'editados': case 'corregidos':
      if (d.id_crm) foto.filas = await lector.videosDeCliente(d.id_crm)
      break
    case 'correccion': {
      if (d.id_crm) foto.filas = await lector.videosDeCliente(d.id_crm)
      const ids = new Set(d.videos ?? [])
      for (const f of foto.filas.filter(x => x.estado === 'correccion' && (!ids.size || ids.has(x.id)))) foto.notas.set(f.id, await lector.notasDe(f.id))
      break
    }
    case 'aprobado':
      foto.filas = d.videos?.length ? await lector.videosPorIds(d.videos) : []
      foto.sugerenciaMeta = d.cliente ? await lector.sugerenciaMeta(d.cliente) : null
      foto.canalAds = !!webhookAds(env)
      break
  }
  return foto
}

/** El texto de un aviso como saldría ahora (para el plan del modo dry y para la pantalla de avisos). */
export async function previsualizar(a: Pick<Aviso, 'tipo' | 'datos' | 'canal'>, lector: LectorAvisos, env: Entorno): Promise<MensajeAviso | null> {
  const foto = await armarFoto(a, lector, env)
  return armarMensaje(a, foto, mencionesEdicion(env), urlDespacho(env))
}

const motivoEnvio = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/https?:\/\/\S+/g, '[url]').slice(0, 300)

/** Despacha los avisos vencidos. Nunca lanza por un aviso: cada uno queda cerrado con su estado. */
export async function despachar(deps: DepsCola, op: OpcionesDespacho = {}): Promise<{ enviados: number; dry: number; errores: number; descartados: number; dudosos: number }> {
  const env = deps.env ?? process.env
  const ahora = deps.ahora ?? (() => new Date())
  const r = { enviados: 0, dry: 0, errores: 0, descartados: 0, dudosos: 0 }
  const modo = modoAvisos(env)
  if (modo.modo === 'dry' || !(deps.baseLista?.() ?? true)) return r
  const enviar = deps.enviar ?? enviarDiscord
  const deadline = op.deadline ?? ahora().getTime() + 25_000
  const menciones = mencionesEdicion(env), base = urlDespacho(env)
  r.dudosos = (await deps.repo.marcarDudosos(ahora().toISOString())).length
  const avisos = await deps.repo.reclamarVencidos(ahora().toISOString(), op.limite ?? TOPE_DESPACHO)
  for (const a of avisos) {
    if (ahora().getTime() > deadline - 2_000) {
      // Sin tiempo: vuelve a la cola para el próximo despacho (no se pierde ni queda colgado)
      await deps.repo.reprogramar(a, ahora().toISOString(), 'sin tiempo en este despacho').catch(() => {})
      continue
    }
    let msg: MensajeAviso | null = null
    try {
      if (deps.esOperativo && !await deps.esOperativo(a.datos)) {
        await deps.repo.cerrarAviso(a.id, { estado: 'descartado', texto: '', menciones: [], error: 'cliente archivado: se conserva el historial y se cancela el aviso operativo' })
        r.descartados++
        continue
      }
      const foto = await armarFoto(a, deps.lector, env)
      msg = armarMensaje(a, foto, menciones, base)
      if (!msg) {
        await deps.repo.cerrarAviso(a.id, { estado: 'descartado', texto: '', menciones: [], error: 'ya no había nada que avisar (los videos cambiaron de estado)' })
        r.descartados++
        continue
      }
      const aAds = a.canal === 'ads' && foto.canalAds
      if (a.tipo === 'aprobado' && !foto.canalAds) {
        // Sin el webhook de #ads: el aviso va a #✂️-edicion para que Aylu se lo reenvíe a Valen, y un error a Tomás (una vez por día)
        await deps.repo.encolar({ base: `error:avisos_ads:${hoyArgentina(ahora())}`, tipo: 'error', canal: 'edicion', unaVez: true, enviar_despues: ahora().toISOString(),
          datos: { proceso: 'avisos', motivo: 'falta DISCORD_WEBHOOK_KICKOFF_ADS (o dio error): los avisos de "aprobado" van a #✂️-edicion para que Aylu se los reenvíe a Valen' } }).catch(() => {})
      }
      if (!modo.discord) {
        await deps.repo.cerrarAviso(a.id, { estado: 'dry', texto: msg.texto, menciones: msg.menciones })
        r.dry++
        continue
      }
      const webhook = aAds ? webhookAds(env) : webhookEdicion(env)
      if (!webhook) {
        await deps.repo.cerrarAviso(a.id, { estado: 'error', texto: msg.texto, menciones: msg.menciones, error: 'falta DISCORD_WEBHOOK_EDICION' })
        r.errores++
        continue
      }
      const [id] = await enviar(webhook, [msg.texto], msg.menciones, { deadline, fetch: op.fetch })
      await deps.repo.cerrarAviso(a.id, { estado: 'enviado', texto: msg.texto, menciones: msg.menciones, mensaje_id: id || undefined })
      r.enviados++
    } catch (e) {
      const motivo = motivoEnvio(e)
      const texto = msg?.texto ?? '', mencionados = msg?.menciones ?? []
      try {
        if (e instanceof ErrorEnvio && e.transitorio && /no respondió/i.test(e.message)) {
          // Un timeout pudo haber publicado igual: dudoso, no se reintenta solo
          await deps.repo.cerrarAviso(a.id, { estado: 'dudoso', texto, menciones: mencionados, error: `${motivo}: puede haber salido; mirá el canal antes de reenviarlo` })
          r.dudosos++
        } else if (((e instanceof ErrorEnvio && e.transitorio) || (e as { transitorio?: unknown })?.transitorio === true) && a.intentos < REINTENTOS_PASAJEROS) {
          await deps.repo.reprogramar(a, new Date(ahora().getTime() + ESPERA_REINTENTO_MIN * MIN).toISOString(), motivo)
          r.errores++
        } else {
          await deps.repo.cerrarAviso(a.id, { estado: 'error', texto, menciones: mencionados, error: motivo })
          r.errores++
        }
      } catch (e2) {
        console.error('[edicion/avisos] no pude cerrar el aviso', a.id, motivoEnvio(e2))
      }
    }
  }
  return r
}

/** Encola los avisos de los eventos (y despacha los vencidos). Nunca lanza. En modo dry devuelve el plan con los textos. */
export async function avisar(eventos: readonly EventoVideo[], extra: readonly AvisoMotor[], deps: DepsCola, op: OpcionesDespacho & { despachar?: boolean } = {}):
  Promise<{ encolados: number; enviados: number; plan?: (PlanAviso & { texto: string | null })[] }> {
  const env = deps.env ?? process.env
  const ahora = (deps.ahora ?? (() => new Date()))()
  let encolados = 0
  try {
    const modo = modoAvisos(env)
    const baseLista = deps.baseLista?.() ?? true
    const clientes = [...new Set(eventos.map(e => e.id_crm).filter(Boolean))]
    const filasPorCliente = new Map<string, FilaAviso[]>()
    if (baseLista) {
      for (const c of clientes) filasPorCliente.set(c, await deps.lector.videosDeCliente(c).catch(() => []))
    }
    const plan = planificar(eventos, extra, { filasPorCliente }, ahora)
    if (modo.modo === 'dry' || !baseLista) {
      const conTexto = []
      for (const p of plan) conTexto.push({ ...p, texto: (await previsualizar(p, deps.lector, env).catch(() => null))?.texto ?? null })
      return { encolados: 0, enviados: 0, plan: conTexto }
    }
    for (const p of plan) {
      try { if (deps.esOperativo && !await deps.esOperativo(p.datos)) continue; await deps.repo.encolar(p); encolados++ } catch (e) { console.error('[edicion/avisos] no pude encolar', p.base, motivoEnvio(e)) }
    }
    if (op.despachar === false) return { encolados, enviados: 0 }
    // Desde la pantalla corre en after() de una ruta de 30 s: por defecto, 15 s para mandar (el vigía pasa su deadline)
    const d = await despachar(deps, { ...op, deadline: op.deadline ?? ahora.getTime() + 15_000 })
    return { encolados, enviados: d.enviados }
  } catch (e) {
    console.error('[edicion/avisos] avisar:', motivoEnvio(e))
    return { encolados, enviados: 0 }
  }
}

export { DESTINO }
