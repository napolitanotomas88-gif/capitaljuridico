// ── Continuidad: dependencias REALES de la corrida de proyección (CRM, Neon, Calendly, 📤, 🛠️ y ✅). Solo servidor ────────
// Interruptor BOT_PROYECCION: por defecto prendida; «no» la apaga (y entonces vuelve el pedido de OK del aviso de fin de Bajas).
// Nada sale al cliente: el texto queda «para enviar» y las tareas son alertas internas de Discord.
// Calendly (cómo se detecta «Agendada»): la llamada de proyección se agenda con el MISMO link de la kickoff de Tomi (si el
// cliente agenda la kickoff por segunda vez, es la proyección). Se leen los eventos activos de los próximos 21 días:
//   · cuenta de Tomi (CALENDLY_TOKEN): KickOff y cualquier evento de proyección / renovación / análisis;
//   · cuenta de ventas (CALENDLY_VENTAS_TOKEN): solo «Análisis y Proyecciones» (nunca las consultivas).
// y se cruzan con el cliente por mail o por 2 palabras del nombre. Google Calendar NO se lee: el Despacho no tiene acceso
// confiable al calendario de Tomi (la cuenta de servicio no tiene delegación); si la llamada se arma por fuera de Calendly,
// se marca «Agendada» a mano en la tarjeta o en el panel.
import { configBajas } from '@/lib/bot/bajas/config'
import { clientesPrueba } from '@/lib/bot/bajas/prueba'
import { clientesSinFin } from '@/lib/clientes/sinFin'
import { correrProyeccion, type ResumenProyeccion } from './nucleo'
import { guardarMarcaProyeccion, leerMarcasProyeccion } from './marcas'
import { esEventoProyeccion, proyeccionPrendida, type EventoCalendly } from './reglas'

export { proyeccionPrendida }

/** Días hacia adelante que se miran en Calendly (el fin está a 14 días como mucho; la llamada, cerca). */
export const DIAS_CALENDLY = 21
const TOPE_MS = 10_000

export const diaAR = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

type EventoApi = { uri: string; name: string; start_time: string }
async function getJson<T>(url: string, token: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TOPE_MS) })
  if (!r.ok) throw new Error(`Calendly respondió ${r.status}`)
  return (await r.json()) as T
}

/** Eventos de proyección de una cuenta de Calendly (filtra por nombre ANTES de pedir los invitados). */
async function eventosDeCuenta(token: string | undefined, cuenta: 'tomi' | 'ventas'): Promise<EventoCalendly[]> {
  if (!token?.trim()) return []
  const me = await getJson<{ resource?: { uri?: string; current_organization?: string } }>('https://api.calendly.com/users/me', token)
  const scope = cuenta === 'ventas' ? `organization=${encodeURIComponent(me.resource?.current_organization ?? '')}` : `user=${encodeURIComponent(me.resource?.uri ?? '')}`
  const desde = new Date(Date.now() - 2 * 86_400_000), hasta = new Date(Date.now() + DIAS_CALENDLY * 86_400_000)
  const out: EventoCalendly[] = []
  let url: string | null = `https://api.calendly.com/scheduled_events?${scope}&status=active&sort=start_time:asc&min_start_time=${desde.toISOString()}&max_start_time=${hasta.toISOString()}&count=100`
  for (let pag = 0; url && pag < 10; pag++) {
    const r: { collection?: EventoApi[]; pagination?: { next_page?: string | null } } = await getJson(url, token)
    for (const e of r.collection ?? []) {
      if (!esEventoProyeccion(e.name, cuenta)) continue
      const inv = await getJson<{ collection?: { name?: string; email?: string }[] }>(`${e.uri}/invitees`, token).catch(() => ({ collection: [] }))
      for (const i of inv.collection ?? []) out.push({ invitado: i.name ?? '', email: i.email ?? '', inicio: diaAR(new Date(e.start_time).getTime()), evento: e.name })
    }
    url = r.pagination?.next_page ?? null
  }
  return out
}

export async function eventosProyeccionCalendly(env: NodeJS.ProcessEnv = process.env): Promise<EventoCalendly[]> {
  const [tomi, ventas] = await Promise.allSettled([eventosDeCuenta(env.CALENDLY_TOKEN, 'tomi'), eventosDeCuenta(env.CALENDLY_VENTAS_TOKEN, 'ventas')])
  if (tomi.status === 'rejected' && ventas.status === 'rejected') throw tomi.reason
  return [...(tomi.status === 'fulfilled' ? tomi.value : []), ...(ventas.status === 'fulfilled' ? ventas.value : [])]
}

/** El link para invitar: BAJA_CALENDLY_URL o, si no está, el link de la KickOff de Tomi (el mismo que agenda la proyección). */
export async function calendlyParaInvitar(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const propio = configBajas(env).calendlyUrl
  if (propio) return propio
  const token = env.CALENDLY_TOKEN?.trim()
  if (!token) return ''
  try {
    const me = await getJson<{ resource?: { uri?: string } }>('https://api.calendly.com/users/me', token)
    const t = await getJson<{ collection?: { name: string; active: boolean; scheduling_url?: string }[] }>(`https://api.calendly.com/event_types?user=${encodeURIComponent(me.resource?.uri ?? '')}&count=100`, token)
    const k = (t.collection ?? []).find((x) => x.active && /kick ?off/i.test(x.name))
    return k?.scheduling_url && /^https:\/\//.test(k.scheduling_url) ? k.scheduling_url : ''
  } catch { return '' }
}

const link = (id: string) => `/clientes?cliente=${encodeURIComponent(id)}#rc-proyeccion`

export async function correrProyeccionReal(op: { dry?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<ResumenProyeccion & { apagada?: boolean }> {
  const env = op.env ?? process.env
  const dry = !!op.dry
  if (!proyeccionPrendida(env)) return { dry, hoy: diaAR(), invitar: [], agendar: [], agendadas: [], cortados: [], errores: [], apagada: true }
  return correrProyeccion({
    hoy: diaAR(),
    dry,
    calendlyUrl: await calendlyParaInvitar(env),
    exclusiones: { sinFin: clientesSinFin(env), prueba: clientesPrueba(env) },
    leerClientes: async () => (await import('@/lib/bot/bajas/servidor')).leerClientesReal(),
    leerMarcas: leerMarcasProyeccion,
    eventosCalendly: () => eventosProyeccionCalendly(env),
    clienteOperativo: async (id, nombre) => (await import('@/lib/clientes/colasOperativas')).clienteOperativo(id, nombre),
    paraEnviar: async (p) => {
      const { paraEnviar } = await import('@/lib/bot/canal/salidaCliente')
      const r = await paraEnviar({ pieza: 'i01', idCrm: p.idCrm, cliente: p.cliente, clave: p.clave, texto: p.texto, abrir: link(p.idCrm), datos: { origen: 'proyeccion', fin: p.fin } })
      if (r.estado === 'error') throw new Error(r.motivo ?? 'no se registró')
      return { estado: r.estado }
    },
    tarea: async (p) => {
      const { alertar } = await import('@/lib/alertas')
      const r = await alertar({
        canal: 'operaciones', tipo: 'proyeccion_agendar', clave: p.clave, idCrm: p.idCrm, emoji: '📅', titulo: p.titulo, cliente: p.cliente,
        lineas: p.lineas, copiar: p.copiar, link: link(p.idCrm), menciones: ['tomas', 'aylu', 'gero_m'],
      })
      if (r.estado === 'error') throw new Error(r.motivo ?? 'Discord no respondió')
      return { estado: r.estado }
    },
    anotarAgendada: (p) => guardarMarcaProyeccion(p.idCrm, { fin: p.fin, campo: 'agendada', fecha: p.fecha, resultado: null }, 'Calendly', 'calendly'),
    verificaciones: async (p) => {
      const { alertar } = await import('@/lib/alertas')
      const r = await alertar({
        canal: 'verificaciones', tipo: 'proyeccion_agendada', clave: p.clave, idCrm: p.idCrm, emoji: '📅', titulo: p.titulo, cliente: p.cliente,
        lineas: p.lineas, link: link(p.idCrm), menciones: ['tomas', 'aylu', 'gero_m'],
      })
      if (r.estado === 'error') throw new Error(r.motivo ?? 'Discord no respondió')
      return { estado: r.estado }
    },
  })
}
