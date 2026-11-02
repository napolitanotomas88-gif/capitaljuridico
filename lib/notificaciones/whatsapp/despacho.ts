// ── Salida única de WhatsApp de la bandeja: el despachador (sin red ni base: todo entra por deps; lo prueban los fakes) ──
// Una corrida (la dispara el vigía cada 15 min, de 8 a 22, o la ruta /api/notificaciones/whatsapp a mano):
//   1. apagado → no toca nada.
//   2. Reconcilia la bandeja (así un aviso no depende de que alguien abra la campanita).
//   3. Encola en cj_notif_whatsapp las notificaciones nuevas (una fila por notificación, clave única): pendiente si tiene
//      grupo; omitido con el motivo si es un tipo excluido (ya sale por WhatsApp) o sin grupo.
//   4. Lo que quedó «enviando» más de 10 min pasa a dudoso (no se reintenta solo: puede haber salido).
//   5. Fuera de 9 a 20 h (Argentina) no manda: queda pendiente.
//   6. Antes de mandar, la REGLA DE TOMÁS: cada pendiente se vuelve a verificar (sin hacer en la bandeja, de menos de
//      48 h, cliente vigente y no archivado, el estado de origen sigue igual). Lo que no da pasa a «omitido» con el motivo.
//   7. UN solo mensaje por corrida: el grupo con el aviso más viejo (si ya pasó la ventana de 10 min), todo lo suyo junto.
//   8. /health del número (si no está AUTH no sale: queda pendiente) → turno (5 min entre mensajes y tope diario, candado
//      en Neon) → reclama las filas (pendiente → enviando) → manda → enviado | pendiente (no salió) | dudoso.
import { ENVIANDO_VENCE_MS, MAX_ANTIGUEDAD_MS, VENTANA_MS, armarMensaje, chatGrupo, chatPrueba, chatsPermitidos, enHorario, mapear, modoNotifWa, personasDe, type Destino, type GrupoEquipo, type ItemMensaje } from './modelo'
import type { Seccion } from '../../auth/roles'

type Entorno = Record<string, string | undefined>

export interface NotifCandidata { id: number; clave: string | null; tipo: string; paraEmail: string | null; paraSeccion: Seccion | null }
export interface FilaNueva { clave: string; notificacionId: number; tipo: string; grupo: GrupoEquipo | null; estado: 'pendiente' | 'omitido'; motivo: string | null; destino: Destino | null }
export interface FilaPendiente {
  id: number; notificacionId: number; tipo: string; grupo: GrupoEquipo; destino: Destino
  creadaEn: string; hechaEn: string | null; titulo: string; url: string | null; clave: string | null
}
export type Vigencia = { ok: true; detalle?: string | null } | { ok: false; motivo: string }
export type EstadoCierre = 'enviado' | 'pendiente' | 'dudoso' | 'error'

export interface DepsDespacho {
  env: Entorno
  ahora(): number
  base: string                                            // https://… del Despacho, sin barra final
  reconciliar(): Promise<void>
  candidatas(desdeIso: string): Promise<NotifCandidata[]> // notificaciones sin fila en la cola
  insertar(filas: FilaNueva[]): Promise<void>             // ON CONFLICT (clave) DO NOTHING
  vencerEnviando(antesDeIso: string): Promise<number>
  pendientes(): Promise<FilaPendiente[]>
  vigencia(f: FilaPendiente): Promise<Vigencia>           // tira si no se puede saber (CRM caído): la corrida se corta
  omitir(id: number, motivo: string): Promise<void>
  salud(): Promise<{ ok: boolean; motivo: string }>
  reclamarTurno(): Promise<boolean>
  reclamar(ids: number[], lote: string, modo: string): Promise<number[]>   // pendiente → enviando (devuelve las que tomó)
  enviar(chatId: string, texto: string, menciones: string[]): Promise<string | null>
  cerrar(ids: number[], estado: EstadoCierre, motivo: string | null, mensajeId: string | null): Promise<void>
}

export interface ResultadoDespacho {
  estado: 'apagado' | 'fuera_de_horario' | 'nada' | 'esperando_ventana' | 'sin_destino' | 'sin_numero' | 'sin_turno' | 'enviado' | 'no_salio' | 'dudoso' | 'error'
  modo: string
  encolados: number
  omitidos: number
  vencidos: number
  grupo?: GrupoEquipo
  avisos?: number
  motivo?: string
}

const limpio = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\d{7,}/g, '[número]').slice(0, 200)
export const claveWa = (n: Pick<NotifCandidata, 'id' | 'clave'>, grupo: GrupoEquipo | null): string => `wa:${n.clave ?? `id-${n.id}`}:${grupo ?? 'ninguno'}`.slice(0, 220)

/** Qué fila de la cola le corresponde a cada notificación nueva. */
export function filasNuevas(cands: readonly NotifCandidata[]): FilaNueva[] {
  return cands.map(n => {
    const m = mapear(n)
    return m.ok
      ? { clave: claveWa(n, m.destino.grupo), notificacionId: n.id, tipo: n.tipo, grupo: m.destino.grupo, estado: 'pendiente', motivo: null, destino: m.destino }
      : { clave: claveWa(n, null), notificacionId: n.id, tipo: n.tipo, grupo: null, estado: 'omitido', motivo: m.motivo, destino: null }
  })
}

export async function despacharNotifWhatsapp(d: DepsDespacho): Promise<ResultadoDespacho> {
  const modo = modoNotifWa(d.env)
  const r: ResultadoDespacho = { estado: 'nada', modo, encolados: 0, omitidos: 0, vencidos: 0 }
  if (modo === 'apagado') return { ...r, estado: 'apagado' }
  const ahora = d.ahora()
  try {
    try { await d.reconciliar() } catch (e) { console.error('[notif-whatsapp] no se pudo reconciliar:', limpio(e)) }
    const nuevas = filasNuevas(await d.candidatas(new Date(ahora - MAX_ANTIGUEDAD_MS).toISOString()))
    if (nuevas.length) await d.insertar(nuevas)
    r.encolados = nuevas.filter(f => f.estado === 'pendiente').length
    r.vencidos = await d.vencerEnviando(new Date(ahora - ENVIANDO_VENCE_MS).toISOString())
    if (!enHorario(ahora)) return { ...r, estado: 'fuera_de_horario' }

    // Regla de Tomás: la etapa tiene que ser real justo antes de avisar
    const vigentes: { f: FilaPendiente; detalle: string | null }[] = []
    for (const f of await d.pendientes()) {
      const creada = Date.parse(f.creadaEn)
      const motivo = f.hechaEn ? 'ya está hecha en el Despacho'
        : !Number.isFinite(creada) || ahora - creada > MAX_ANTIGUEDAD_MS ? 'tiene más de 48 h: no sale por WhatsApp'
        : null
      if (motivo) { await d.omitir(f.id, motivo); r.omitidos++; continue }
      const v = await d.vigencia(f)
      if (!v.ok) { await d.omitir(f.id, v.motivo); r.omitidos++; continue }
      vigentes.push({ f, detalle: v.detalle ?? null })
    }
    if (!vigentes.length) return { ...r, estado: 'nada' }

    // Un solo mensaje: el grupo que más espera
    const porGrupo = new Map<GrupoEquipo, typeof vigentes>()
    for (const v of vigentes) porGrupo.set(v.f.grupo, [...(porGrupo.get(v.f.grupo) ?? []), v])
    const masViejo = (l: typeof vigentes) => Math.min(...l.map(v => Date.parse(v.f.creadaEn)))
    const [grupo, lista] = [...porGrupo.entries()].sort((a, b) => masViejo(a[1]) - masViejo(b[1]))[0]
    r.grupo = grupo
    if (ahora - masViejo(lista) < VENTANA_MS) return { ...r, estado: 'esperando_ventana' }

    const chat = modo === 'prueba' ? chatPrueba(d.env) : chatGrupo(grupo, d.env)
    if (!chat || !chatsPermitidos(modo, d.env).has(chat)) {
      return { ...r, estado: 'sin_destino', motivo: modo === 'prueba' ? 'falta NOTIF_WHATSAPP_PRUEBA_CHAT' : `falta WHAPI_GRUPO_${grupo}` }
    }
    const salud = await d.salud()
    if (!salud.ok) return { ...r, estado: 'sin_numero', motivo: salud.motivo }
    if (!(await d.reclamarTurno())) return { ...r, estado: 'sin_turno' }
    const lote = `${grupo}-${ahora}`
    const tomadas = new Set(await d.reclamar(lista.map(v => v.f.id), lote, modo))
    const salen = lista.filter(v => tomadas.has(v.f.id))
    if (!salen.length) return { ...r, estado: 'nada' }
    r.avisos = salen.length
    const items: ItemMensaje[] = salen.map(v => ({ titulo: v.f.titulo, url: v.f.url, detalle: v.detalle, personas: personasDe(v.f.destino, d.env) }))
    const { texto, menciones } = armarMensaje({ modo, grupo, items, base: d.base })
    const ids = salen.map(v => v.f.id)
    try {
      const id = await d.enviar(chat, texto, menciones)
      await d.cerrar(ids, 'enviado', null, id)
      return { ...r, estado: 'enviado' }
    } catch (e) {
      const { aplicado, tipo } = (e ?? {}) as { aplicado?: boolean | null; tipo?: string }
      // Número caído: Whapi no recibió nada → vuelve a pendiente. Otro error que seguro no salió (config, 4xx) → error, sin
      // reintento automático (no gastar turnos en lo mismo). Si no se sabe si salió → dudoso.
      if (aplicado === false && tipo === 'sin_numero') { await d.cerrar(ids, 'pendiente', limpio(e), null); return { ...r, estado: 'no_salio', motivo: limpio(e) } }
      if (aplicado === false) { await d.cerrar(ids, 'error', limpio(e), null); return { ...r, estado: 'no_salio', motivo: limpio(e) } }
      await d.cerrar(ids, 'dudoso', limpio(e), null)
      return { ...r, estado: 'dudoso', motivo: limpio(e) }
    }
  } catch (e) {
    return { ...r, estado: 'error', motivo: limpio(e) }
  }
}
