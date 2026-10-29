import { contarLugares, enZona, nivelDeEvento, nivelDeNombre, TOPES_DIARIOS, type Host, type Ocupado, type Regla } from './agendaLugares'

// ── Calendly: próximas llamadas (proyección, kick-off, etc.) ─────────────
// Requiere CALENDLY_TOKEN (Personal Access Token). Si no está, devuelve [].
export interface LlamadaCalendly {
  evento: string        // nombre del tipo de evento (ej. "Llamada de proyección")
  invitado: string      // nombre del cliente/lead
  inicio: Date
  closer?: string       // miembro del equipo que recibe la llamada (event_memberships) — el "enrutamiento"
  telefono?: string     // del invitado (pregunta de teléfono/WhatsApp o número de recordatorio SMS)
  email?: string
}

// "Enrutamiento perdido" (definición del usuario, 10/9): completó el Routing Form de Calendly
// pero NO agendó. Se lee de routing_form_submissions (submitter = null ⇒ no reservó).
export interface FormularioSinAgendar {
  nombre: string
  telefono: string
  email: string
  formulario: string    // nombre del routing form
  ruta: string          // a qué lo mandó el formulario (tipo de evento / mensaje / URL)
  creada: Date
}
export interface RoutingPerdidos {
  disponible: boolean   // el token ve routing forms de la organización
  formularios: number
  perdidos: FormularioSinAgendar[]
  yaAgendaron?: number   // envíos sin reserva en el momento que luego sí agendaron (se excluyen de `perdidos`)
}

// Agenda creada hoy (fecha de reserva, no de la call): para el reporte de enrutamiento del día
export interface AgendaCalendly extends LlamadaCalendly {
  creada: Date
  cancelada?: { cuando: Date; por: string; motivo: string }   // solo en las canceladas hoy
}

const TZ = 'America/Argentina/Buenos_Aires'
type EventoAPI = {
  uri: string; name: string; start_time: string; status?: string; created_at?: string; updated_at?: string
  event_memberships?: { user_name?: string }[]
  cancellation?: { canceled_by?: string; reason?: string; canceler_type?: string; created_at?: string }
}

// Instante real de las 00:00 de HOY en Argentina (0 de offset en una Mac AR, +3h en Vercel/UTC)
function inicioDiaAR(): Date {
  const ahora = new Date()
  const wallAR = new Date(ahora.toLocaleString('en-US', { timeZone: TZ }))
  const offsetMs = ahora.getTime() - wallAR.getTime()
  wallAR.setHours(0, 0, 0, 0)
  return new Date(wallAR.getTime() + offsetMs)
}

// Con qué cuenta y alcance consultar. Por defecto: CALENDLY_TOKEN (Tomás: kick-offs/proyección) y
// solo sus eventos (user=). Para ventas: CALENDLY_VENTAS_TOKEN + org=true → eventos de TODA la
// organización (Carlos, Gero, Marcos…), que es donde viven las reservas de leads.
export interface CalendlyOpts { token?: string; org?: boolean }
export const CALENDLY_VENTAS: CalendlyOpts = { token: process.env.CALENDLY_VENTAS_TOKEN, org: true }
async function alcance(opts?: CalendlyOpts): Promise<{ h: Record<string, string>; scope: string } | null> {
  const token = opts?.token || process.env.CALENDLY_TOKEN
  if (!token) return null
  const h = { Authorization: `Bearer ${token}` }
  const me = await (await fetch('https://api.calendly.com/users/me', { headers: h })).json() as { resource?: { uri?: string; current_organization?: string } }
  const uri = opts?.org ? me.resource?.current_organization : me.resource?.uri
  if (!uri) return null
  return { h, scope: `${opts?.org ? 'organization' : 'user'}=${encodeURIComponent(uri)}` }
}

type InviteeAPI = { name?: string; email?: string; text_reminder_number?: string | null; questions_and_answers?: { question?: string; answer?: string }[] }
const RX_TEL = /tel[eé]fono|phone|whatsapp|celular|n[úu]mero/i
const respuestaTel = (qa?: { question?: string; answer?: string }[]) =>
  (qa ?? []).find(q => RX_TEL.test(q.question ?? '') && (q.answer ?? '').replace(/\D/g, '').length >= 7)?.answer?.trim() ?? ''

async function invitadosDe(uri: string, h: Record<string, string>): Promise<{ nombre: string; telefono: string; email: string }> {
  try {
    const inv = await (await fetch(`${uri}/invitees`, { headers: h })).json() as { collection?: InviteeAPI[] }
    const c = inv.collection ?? []
    return {
      nombre: c.map(i => i.name).filter(Boolean).join(', ') || '—',
      telefono: c.map(i => i.text_reminder_number || respuestaTel(i.questions_and_answers)).find(Boolean) ?? '',
      email: c.map(i => i.email).find(Boolean) ?? '',
    }
  } catch { return { nombre: '—', telefono: '', email: '' } }
}

const closerDe = (e: EventoAPI) => (e.event_memberships?.[0]?.user_name ?? '').split(' ')[0] || undefined

export async function fetchCalendlyProximas(horas = 48, opts?: CalendlyOpts): Promise<LlamadaCalendly[]> {
  try {
    const a = await alcance(opts)
    if (!a) return []
    const { h, scope } = a
    const desde = new Date(), hasta = new Date(Date.now() + horas * 3_600_000)
    const ev = await (await fetch(
      `https://api.calendly.com/scheduled_events?${scope}&status=active&sort=start_time:asc` +
      `&min_start_time=${desde.toISOString()}&max_start_time=${hasta.toISOString()}&count=100`, { headers: h })).json() as
      { collection?: EventoAPI[] }
    const out: LlamadaCalendly[] = []
    for (const e of ev.collection ?? []) {
      const inv = await invitadosDe(e.uri, h)
      out.push({ evento: e.name, invitado: inv.nombre, telefono: inv.telefono, email: inv.email, inicio: new Date(e.start_time), closer: closerDe(e) })
    }
    return out
  } catch {
    return []
  }
}

// Agendas RESERVADAS (y canceladas) en un día (hora Argentina), para cualquier fecha futura
// de la call. offsetDias = 0 → hoy, -1 → ayer. Calendly solo filtra por start_time, así que se
// listan los eventos que empiezan desde ese día y se filtran por created_at dentro del día.
export async function fetchCalendlyCreadas(offsetDias = 0, opts?: CalendlyOpts): Promise<{ creadas: AgendaCalendly[]; canceladas: AgendaCalendly[] }> {
  try {
    const a = await alcance(opts)
    if (!a) return { creadas: [], canceladas: [] }
    const { h, scope } = a
    const inicioDia = new Date(inicioDiaAR().getTime() + offsetDias * 86_400_000)
    const finDia = new Date(inicioDia.getTime() + 86_400_000)
    const enVentana = (iso?: string) => !!iso && new Date(iso) >= inicioDia && new Date(iso) < finDia
    const hasta = new Date(inicioDia.getTime() + 120 * 86_400_000)
    const listar = async (status: 'active' | 'canceled') => {
      const out: EventoAPI[] = []
      let url: string | null = `https://api.calendly.com/scheduled_events?${scope}&status=${status}&sort=start_time:asc` +
        `&min_start_time=${inicioDia.toISOString()}&max_start_time=${hasta.toISOString()}&count=100`
      for (let page = 0; url && page < 5; page++) {
        const r = await (await fetch(url, { headers: h })).json() as { collection?: EventoAPI[]; pagination?: { next_page?: string | null } }
        out.push(...(r.collection ?? []))
        url = r.pagination?.next_page ?? null
      }
      return out
    }
    const [activos, cancelados] = await Promise.all([listar('active'), listar('canceled')])
    const creadas: AgendaCalendly[] = []
    for (const e of activos) {
      if (!enVentana(e.created_at)) continue
      const inv = await invitadosDe(e.uri, h)
      creadas.push({ evento: e.name, invitado: inv.nombre, telefono: inv.telefono, email: inv.email, inicio: new Date(e.start_time), creada: new Date(e.created_at ?? e.start_time), closer: closerDe(e) })
    }
    const canceladas: AgendaCalendly[] = []
    for (const e of cancelados) {
      const cuando = e.cancellation?.created_at ?? e.updated_at
      if (!cuando || !enVentana(cuando)) continue
      // Una reprogramación figura como cancelación + evento nuevo: no es un enrutamiento perdido
      if (/reprogramad|reschedul/i.test(e.cancellation?.reason ?? '')) continue
      const inv = await invitadosDe(e.uri, h)
      canceladas.push({
        evento: e.name, invitado: inv.nombre, telefono: inv.telefono, email: inv.email, inicio: new Date(e.start_time), creada: new Date(e.created_at ?? e.start_time), closer: closerDe(e),
        cancelada: { cuando: new Date(cuando), por: e.cancellation?.canceler_type === 'host' ? 'el closer' : 'el lead', motivo: (e.cancellation?.reason ?? '').trim() },
      })
    }
    creadas.sort((a, b) => a.creada.getTime() - b.creada.getTime())
    return { creadas, canceladas }
  } catch {
    return { creadas: [], canceladas: [] }
  }
}

// Routing Forms de Calendly: envíos del día (hora AR) que NO terminaron en reserva.
// Usa CALENDLY_VENTAS_TOKEN (cuenta de ventas, donde vive el formulario) y si no está, CALENDLY_TOKEN.
// Un envío con `submitter` vacío es alguien que completó el formulario y no agendó.
export async function fetchRoutingPerdidos(offsetDias = 0): Promise<RoutingPerdidos> {
  const token = process.env.CALENDLY_VENTAS_TOKEN || process.env.CALENDLY_TOKEN
  if (!token) return { disponible: false, formularios: 0, perdidos: [] }
  const h = { Authorization: `Bearer ${token}` }
  try {
    const me = await (await fetch('https://api.calendly.com/users/me', { headers: h })).json() as { resource?: { current_organization?: string } }
    const org = me.resource?.current_organization
    if (!org) return { disponible: false, formularios: 0, perdidos: [] }
    const resForms = await fetch(`https://api.calendly.com/routing_forms?organization=${encodeURIComponent(org)}&count=50`, { headers: h })
    if (!resForms.ok) return { disponible: false, formularios: 0, perdidos: [] }   // 403 = el token no es admin de la org
    const forms = await resForms.json() as { collection?: { uri: string; name: string; status?: string }[] }
    const lista = forms.collection ?? []
    if (!lista.length) return { disponible: true, formularios: 0, perdidos: [] }   // 200 vacío: esta cuenta no tiene routing forms
    const inicioDia = new Date(inicioDiaAR().getTime() + offsetDias * 86_400_000)
    const finDia = new Date(inicioDia.getTime() + 86_400_000)
    type Sub = { created_at: string; submitter?: string | null; result?: { type?: string; value?: string }; questions_and_answers?: { question?: string; answer?: string }[] }
    const perdidos: FormularioSinAgendar[] = []
    for (const f of lista) {
      let url: string | null = `https://api.calendly.com/routing_form_submissions?form=${encodeURIComponent(f.uri)}&sort=created_at:desc&count=100`
      for (let page = 0; url && page < 5; page++) {
        const res = await fetch(url, { headers: h })
        if (!res.ok) throw new Error(`routing_form_submissions ${res.status}`)   // un 403/429 no puede pasar por "0 perdidos"
        const r = await res.json() as { collection?: Sub[]; pagination?: { next_page?: string | null } }
        let masViejo = false
        for (const s of r.collection ?? []) {
          const c = new Date(s.created_at)
          if (c < inicioDia) { masViejo = true; continue }
          if (c >= finDia || s.submitter) continue
          const qa = s.questions_and_answers ?? []
          const resp = (rx: RegExp) => qa.find(q => rx.test(q.question ?? ''))?.answer?.trim() ?? ''
          perdidos.push({
            nombre: resp(/nombre y apellido|nombre completo|full name|^\s*name\s*$/i) || resp(/^(?!.*(empresa|negocio|company|marca|estudio)).*(nombre|name)/i) || '—',
            telefono: respuestaTel(qa),
            email: resp(/mail|correo/i),
            formulario: f.name,
            ruta: s.result?.type === 'event_type' ? 'a un calendario' : s.result?.type === 'custom_message' ? 'mensaje (no calificó)' : s.result?.type === 'external_url' ? 'a una URL' : (s.result?.type ?? '—'),
            creada: c,
          })
        }
        url = masViejo ? null : (r.pagination?.next_page ?? null)   // ordenado desc: al pasar el inicio del día, cortar
      }
    }
    // La misma persona suele mandar el formulario 2 veces seguidas: se deja una sola (por email o teléfono)
    const vistos = new Set<string>()
    const unicos = perdidos.sort((a, b) => a.creada.getTime() - b.creada.getTime()).filter(p => {
      const k = (p.email || p.telefono.replace(/\D/g, '') || p.nombre).toLowerCase()
      if (vistos.has(k)) return false
      vistos.add(k); return true
    })
    // `submitter` vacío solo dice que NO reservó en ese flujo del formulario: mucha gente agenda después (otro link, otro
    // envío, más tarde). Esos NO son perdidos: se cruzan por mail o teléfono contra los invitados con reunión activa
    // desde el día anterior al envío. Si el cruce falla, se informa de más (nunca se oculta un perdido por error).
    const reservaron = await invitadosConReunion(h, org, new Date(inicioDia.getTime() - 86_400_000)).catch(() => null)
    const sinReserva = reservaron ? unicos.filter(p => !yaReservo(p, reservaron)) : unicos
    return { disponible: true, formularios: lista.length, perdidos: sinReserva, yaAgendaron: unicos.length - sinReserva.length }
  } catch {
    return { disponible: false, formularios: 0, perdidos: [] }
  }
}

// Mails y últimos 8 dígitos de teléfono de quienes tienen una reunión ACTIVA que empieza desde `desde` (hasta +30 días)
async function invitadosConReunion(h: Record<string, string>, org: string, desde: Date): Promise<{ emails: Set<string>; tels: Set<string> }> {
  const hasta = new Date(Date.now() + 30 * 86_400_000)
  const eventos: string[] = []
  let url: string | null = `https://api.calendly.com/scheduled_events?organization=${encodeURIComponent(org)}&status=active&min_start_time=${desde.toISOString()}&max_start_time=${hasta.toISOString()}&count=100`
  for (let p = 0; url && p < 8; p++) {
    const r = await fetch(url, { headers: h })
    if (!r.ok) throw new Error(`scheduled_events ${r.status}`)
    const j = await r.json() as { collection?: { uri: string }[]; pagination?: { next_page?: string | null } }
    eventos.push(...(j.collection ?? []).map(e => e.uri))
    url = j.pagination?.next_page ?? null
  }
  const emails = new Set<string>(), tels = new Set<string>()
  const ult8 = (t: string) => { const d = t.replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : '' }
  for (let i = 0; i < eventos.length; i += 8) {
    const lote = await Promise.all(eventos.slice(i, i + 8).map(async uri => {
      const r = await fetch(`${uri}/invitees?count=20`, { headers: h })
      if (!r.ok) throw new Error(`invitees ${r.status}`)
      return (await r.json() as { collection?: { email?: string; text_reminder_number?: string | null; questions_and_answers?: { answer?: string }[] }[] }).collection ?? []
    }))
    for (const inv of lote.flat()) {
      if (inv.email) emails.add(inv.email.trim().toLowerCase())
      for (const t of [inv.text_reminder_number ?? '', ...(inv.questions_and_answers ?? []).map(q => q.answer ?? '')]) { const k = ult8(t); if (k) tels.add(k) }
    }
  }
  return { emails, tels }
}
function yaReservo(p: FormularioSinAgendar, r: { emails: Set<string>; tels: Set<string> }): boolean {
  const d = p.telefono.replace(/\D/g, '')
  return (!!p.email && r.emails.has(p.email.trim().toLowerCase())) || (d.length >= 8 && r.tels.has(d.slice(-8)))
}

// ── Espacios de agenda disponibles (notificador de Discord) ──────────────
// Los eventos de venta son round-robin ("Reunión Consultiva") y NO salen listando por
// organización: hay que listarlos por cada miembro (Carlos, Marcos, owner). available_times
// solo devuelve lo que un lead puede reservar hoy (respeta la ventana de "2 días de agenda").
export interface EspaciosAgenda {
  uri: string; nombre: string; nota: string; url: string
  /** Horarios que ofrece Calendly (round robin: uno por horario aunque haya varios closers libres) */
  slots: number; porDia: Record<string, number>
  /** Lugares por closer (lib/agendaLugares.ts): reuniones que todavía entran. Sin él (falló el cálculo), vale `slots`. */
  lugares?: number; lugaresPorDia?: Record<string, Record<string, number>>; sinCloser?: number; notaCalculo?: string
}
type CacheLugares = { nombres?: Map<string, string>; reservas?: Map<string, Record<string, number>>; ocupado?: Map<string, Ocupado[]> }

/**
 * Lugares por closer de un evento round robin (lib/agendaLugares.ts): hosts y su horario PARA ESTE EVENTO, lo ocupado de cada
 * uno en el rango (con el nivel de cada reserva por su nombre) y las reuniones que ya tiene por día (tope diario). Lo que es
 * de la organización y no del evento (nombres de las reservas, ocupado por host) se lee una vez y se reusa en `cache`.
 */
async function lugaresDelEvento(
  h: Record<string, string>, org: string,
  e: { uri: string; name: string; internal_note?: string | null; duration?: number },
  horarios: Date[], desde: Date, hasta: Date, cache: CacheLugares,
) {
  const api = async <T,>(url: string): Promise<T> => {
    const r = await fetch(url, { headers: h })
    if (!r.ok) throw new Error(`${url.split('?')[0].split('/').pop()} ${r.status}`)
    return r.json() as Promise<T>
  }
  // Reservas activas de la organización en el rango: nombre (→ nivel) y reuniones por host y día
  if (!cache.nombres || !cache.reservas) {
    const nombres = new Map<string, string>(), reservas = new Map<string, Record<string, number>>()
    let url: string | null = `https://api.calendly.com/scheduled_events?organization=${encodeURIComponent(org)}&status=active&count=100` +
      `&min_start_time=${new Date(desde.getTime() - 86_400_000).toISOString()}&max_start_time=${new Date(hasta.getTime() + 86_400_000).toISOString()}`
    while (url) {
      const j: { collection?: { uri: string; name: string; start_time: string; event_memberships?: { user?: string }[] }[]; pagination?: { next_page?: string | null } } = await api(url)
      for (const ev of j.collection ?? []) {
        nombres.set(ev.uri, ev.name)
        for (const m of ev.event_memberships ?? []) {
          if (!m.user) continue
          const dia = enZona(new Date(ev.start_time), TZ).dia
          const porDia = reservas.get(m.user) ?? {}
          porDia[dia] = (porDia[dia] ?? 0) + 1
          reservas.set(m.user, porDia)
        }
      }
      url = j.pagination?.next_page ?? null
    }
    cache.nombres = nombres
    cache.reservas = reservas
  }
  cache.ocupado ??= new Map()
  const hostsAPI: { collection?: { member?: { uri?: string; name?: string } }[] } = await api(`https://api.calendly.com/event_type_memberships?event_type=${encodeURIComponent(e.uri)}&count=100`)
  const horariosAPI: { collection?: { availability_rule?: { user?: string; timezone?: string; rules?: Regla[] } }[] } =
    await api(`https://api.calendly.com/event_type_availability_schedules?event_type=${encodeURIComponent(e.uri)}`)
  const hosts: Host[] = []
  for (const m of hostsAPI.collection ?? []) {
    const uri = m.member?.uri, nombre = m.member?.name ?? ''
    if (!uri) continue
    const regla = (horariosAPI.collection ?? []).find((x) => x.availability_rule?.user === uri)?.availability_rule
    if (!regla?.rules) throw new Error(`sin horario de ${nombre} para el evento`)
    if (!cache.ocupado.has(uri)) {
      const j: { collection?: { type: string; start_time: string; end_time: string; buffered_start_time?: string; buffered_end_time?: string; event?: { uri?: string } }[] } =
        await api(`https://api.calendly.com/user_busy_times?user=${encodeURIComponent(uri)}&start_time=${desde.toISOString()}&end_time=${hasta.toISOString()}`)
      cache.ocupado.set(uri, (j.collection ?? []).map((b) => ({
        inicio: new Date(b.buffered_start_time ?? b.start_time),
        fin: new Date(b.buffered_end_time ?? b.end_time),
        externo: b.type !== 'calendly',
        nivel: b.type === 'calendly' ? nivelDeNombre(cache.nombres!.get(b.event?.uri ?? '') ?? '') : 0,
      })))
    }
    hosts.push({ nombre, reglas: regla.rules, tz: regla.timezone ?? TZ, ocupado: cache.ocupado.get(uri)!, reservasPorDia: cache.reservas.get(uri), tope: TOPES_DIARIOS[nombre] })
  }
  if (!hosts.length) throw new Error('el evento no tiene hosts')
  return contarLugares({ horarios, hosts, duracionMin: e.duration ?? 60, nivel: nivelDeEvento(e.internal_note ?? '', e.name) })
}

export async function fetchEspaciosAgenda(): Promise<{ disponible: boolean; eventos: EspaciosAgenda[] }> {
  const token = process.env.CALENDLY_VENTAS_TOKEN
  if (!token) return { disponible: false, eventos: [] }
  const h = { Authorization: `Bearer ${token}` }
  try {
    const me = await (await fetch('https://api.calendly.com/users/me', { headers: h })).json() as { resource?: { current_organization?: string } }
    const org = me.resource?.current_organization
    if (!org) return { disponible: false, eventos: [] }
    const resMem = await fetch(`https://api.calendly.com/organization_memberships?organization=${encodeURIComponent(org)}&count=100`, { headers: h })
    if (!resMem.ok) return { disponible: false, eventos: [] }
    const mem = await resMem.json() as { collection?: { user?: { uri?: string } }[] }
    type TipoAPI = { uri: string; name: string; active?: boolean; pooling_type?: string | null; internal_note?: string | null; scheduling_url?: string; duration?: number }
    const tipos = new Map<string, TipoAPI>()
    for (const m of mem.collection ?? []) {
      if (!m.user?.uri) continue
      const r = await fetch(`https://api.calendly.com/event_types?user=${encodeURIComponent(m.user.uri)}&active=true&count=100`, { headers: h })
      if (!r.ok) { if (r.status === 429 || r.status >= 500) throw new Error(`event_types ${r.status}`); continue }   // un 429/5xx no puede pasar por "sin eventos"
      const j = await r.json() as { collection?: TipoAPI[] }
      for (const e of j.collection ?? []) if (e.pooling_type === 'round_robin' && /consultiva/i.test(e.name)) tipos.set(e.uri, e)
    }
    // El API acepta como máximo 7 días de rango y el inicio tiene que ser futuro
    const desde = new Date(Date.now() + 2 * 60_000), hasta = new Date(Date.now() + 7 * 86_400_000 - 5 * 60_000)
    const eventos: EspaciosAgenda[] = []
    const cacheLugares: CacheLugares = {}
    for (const e of tipos.values()) {
      const r = await fetch(`https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(e.uri)}` +
        `&start_time=${desde.toISOString()}&end_time=${hasta.toISOString()}`, { headers: h })
      if (!r.ok) throw new Error(`event_type_available_times ${r.status}`)   // un error no puede pasar por "0 espacios"
      const j = await r.json() as { collection?: { start_time: string; status?: string }[] }
      const porDia: Record<string, number> = {}
      const libres = (j.collection ?? []).filter(s => !s.status || s.status === 'available')
      for (const s of libres) { const d = new Date(s.start_time).toLocaleDateString('en-CA', { timeZone: TZ }); porDia[d] = (porDia[d] ?? 0) + 1 }
      const base: EspaciosAgenda = { uri: e.uri, nombre: e.name, nota: (e.internal_note ?? '').trim(), url: e.scheduling_url ?? '', slots: libres.length, porDia }
      // Lugares por closer (26/10/2026). Si algo de esto falla, queda el conteo por horarios con una nota: nunca un 0 por error.
      try {
        const l = await lugaresDelEvento(h, org, e, libres.map((x) => new Date(x.start_time)), desde, hasta, cacheLugares)
        eventos.push({ ...base, lugares: l.total, lugaresPorDia: l.porDia, sinCloser: l.sinCloser })
      } catch (err) {
        eventos.push({ ...base, notaCalculo: `conteo por horarios: no pude calcular por closer (${String((err as Error)?.message ?? err).slice(0, 80)})` })
      }
    }
    return { disponible: true, eventos }
  } catch {
    return { disponible: false, eventos: [] }
  }
}
