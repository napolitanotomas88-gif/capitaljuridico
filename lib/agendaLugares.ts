// ── Lugares de agenda por closer (pedido de Tomás, 26/10/2026) ───────────────────────────────────────────────
// El aviso de espacios contaba los horarios que ofrece Calendly (event_type_available_times). En un evento round robin un
// horario sale UNA vez aunque haya dos closers libres, y un closer libre de 9 a 11 suma 9:00, 9:30 y 10:00 aunque solo le
// entren dos reuniones. Acá se cuentan LUGARES: cuántas reuniones más entran, closer por closer y día por día.
//
// Para cada horario que ofrece Calendly se mira qué hosts del evento están libres:
//   · dentro de SU horario para ese evento (event_type_availability_schedules, availability_setting "host");
//   · sin una reserva que lo ocupe (user_busy_times). Hay doble booking por nivel de lead en los eventos de anuncios
//     (26/10, ampliado el 11/11/2026): A+ pisa a A/B, C, D y E; A/B a C, D y E; C a D y E; D a E; nunca dos del mismo nivel.
//     El nivel de una reserva sale del NOMBRE con que se reservó (ver nivelDeNombre). Lo ocupado en el calendario externo (Google)
//     y las reservas de otros eventos (reagendas, análisis) siempre ocupan;
//   · sin pasar su tope de reuniones por día (TOPES_DIARIOS: Calendly no lo expone por API).
// Después, por closer y por día, se toman en orden los horarios libres que no se pisan entre sí (una reunión empieza cuando
// termina la anterior): esa es la cantidad de reuniones que todavía le entran.
// Funciones puras (se prueban sin red); la lectura de Calendly está en lib/calendly.ts (fetchEspaciosAgenda).

/**
 * Nivel del lead (11/11/2026, Gero: «que cada lead de anuncios pise a las agendas que están debajo»):
 * 1 = A+, 2 = A y B, 3 = C, 4 = D, 5 = E. 0 = otra cosa (orgánico, referidos, reagenda, análisis…): no se pisa nunca.
 * Un evento pisa a las reservas de nivel MAYOR (más abajo en la escalera), nunca al mismo nivel.
 */
export type Nivel = 0 | 1 | 2 | 3 | 4 | 5

/** Topes de reuniones por día que Calendly aplica por usuario (no salen por API): nombre del closer → máximo. */
export const TOPES_DIARIOS: Readonly<Record<string, number>> = { 'Yamila Coutoune': 3 }

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Nivel de una reserva por el nombre con que se reservó. Es la misma llave que usan las reglas de doble reserva de
 * Calendly («Normas de libre/ocupado» de cada closer en cada evento de anuncios, 11/11/2026):
 * "Reunión Consultiva" = A+ (y las orgánicas y todas las viejas: nadie las pisa) · "Reunión Consultiva Estratégica" = A y B ·
 * "Reunión Consultiva - Capital Jurídico" o "… con el equipo de …" = C · "Reunión Consultiva con Capital Jurídico" = D ·
 * "Reunión Consultiva Inicial" = E. Cualquier otro nombre (Reagenda, WEBINAR, Análisis…) = 0.
 */
export function nivelDeNombre(nombre: string): Nivel {
  const n = normalizar(nombre)
  if (n === 'reunion consultiva') return 1
  if (n.startsWith('reunion consultiva estrategica')) return 2
  if (n.startsWith('reunion consultiva - capital juridico') || n.startsWith('reunion consultiva con el equipo de')) return 3
  if (n === 'reunion consultiva con capital juridico') return 4
  if (n.startsWith('reunion consultiva inicial')) return 5
  return 0
}

/**
 * Nivel de un evento a partir de su nota interna ("Leads A", "Leads B", "Leads C", "Leads D", "Leads E" desde el 12/11/2026;
 * las viejas "Leads A+" = A, "Leads A y B" = B y "Leads D+E" = D siguen valiendo); si no, por el nombre. Nota con "sin doble reserva" (eventos orgánicos y Referidos, 5/11/2026)
 * = 0: Calendly no les deja pisar ninguna reserva.
 */
export function nivelDeEvento(nota: string, nombre: string): Nivel {
  const n = normalizar(nota)
  if (/sin doble reserva/.test(n)) return 0
  if (/leads? a\s*\+/.test(n)) return 1
  if (/leads? a y b/.test(n)) return 2
  if (/leads? a\b/.test(n)) return 1
  if (/leads? b\b/.test(n)) return 2
  if (/leads? c\b/.test(n)) return 3
  if (/leads? d\b/.test(n)) return 4
  if (/leads? e\b/.test(n)) return 5
  return nivelDeNombre(nombre)
}

/** Una reserva de nivel `reserva` deja libre al closer para un evento de nivel `evento` si el evento la puede pisar. */
export const puedePisar = (evento: Nivel, reserva: Nivel): boolean => evento >= 1 && reserva >= 1 && reserva > evento

export type Regla = { type: 'wday' | 'date'; wday?: string; date?: string; intervals: { from: string; to: string }[] }
export type Ocupado = { inicio: Date; fin: Date; nivel: Nivel; externo?: boolean }
export type Host = {
  nombre: string
  reglas: readonly Regla[]
  tz: string
  ocupado: readonly Ocupado[]
  /** Reuniones que ya tiene cada día (AAAA-MM-DD en la zona del host), para el tope diario. */
  reservasPorDia?: Readonly<Record<string, number>>
  tope?: number
}

const DIAS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Fecha (AAAA-MM-DD), día de la semana y minutos desde la medianoche, en la zona `tz`. */
export function enZona(f: Date, tz: string): { dia: string; wday: string; minutos: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' }).formatToParts(f)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return { dia: `${v('year')}-${v('month')}-${v('day')}`, wday: v('weekday').toLowerCase(), minutos: Number(v('hour')) * 60 + Number(v('minute')) }
}

const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** La reunión [inicio, inicio + duración) entra entera en un intervalo del horario del host para ese día. */
export function dentroDeHorario(reglas: readonly Regla[], tz: string, inicio: Date, duracionMin: number): boolean {
  const { dia, wday, minutos } = enZona(inicio, tz)
  if (!DIAS.includes(wday)) return false
  const delDia = reglas.find((r) => r.type === 'date' && r.date === dia) ?? reglas.find((r) => r.type === 'wday' && r.wday === wday)
  if (!delDia) return false
  const fin = minutos + duracionMin
  return delDia.intervals.some((i) => minutos >= aMinutos(i.from) && fin <= (i.to === '00:00' ? 1440 : aMinutos(i.to)))
}

/** El host está libre para un evento de nivel `nivel` en [inicio, inicio + duración). */
export function hostLibre(h: Host, inicio: Date, duracionMin: number, nivel: Nivel): boolean {
  if (!dentroDeHorario(h.reglas, h.tz, inicio, duracionMin)) return false
  const ini = inicio.getTime(), fin = ini + duracionMin * 60_000
  return !h.ocupado.some((o) => o.inicio.getTime() < fin && o.fin.getTime() > ini && (o.externo || !puedePisar(nivel, o.nivel)))
}

export type Lugares = {
  total: number
  /** Día (AAAA-MM-DD) → closer → reuniones que todavía le entran. */
  porDia: Record<string, Record<string, number>>
  /** Horarios que Calendly ofrece pero donde no se encontró ningún closer libre (si hay muchos, el cálculo no coincide). */
  sinCloser: number
}

/**
 * Lugares de un evento: por closer y por día, los horarios libres en orden, sin pisarse entre sí (una reunión arranca cuando
 * terminó la anterior), hasta el tope diario.
 */
export function contarLugares(p: { horarios: readonly Date[]; hosts: readonly Host[]; duracionMin: number; nivel: Nivel }): Lugares {
  const ordenados = [...p.horarios].sort((a, b) => a.getTime() - b.getTime())
  const porDia: Record<string, Record<string, number>> = {}
  let total = 0
  let sinCloser = 0
  const libresPorHost = p.hosts.map((h) => ordenados.filter((s) => hostLibre(h, s, p.duracionMin, p.nivel)))
  for (const s of ordenados) if (!libresPorHost.some((l) => l.includes(s))) sinCloser++
  p.hosts.forEach((h, i) => {
    const finPorDia: Record<string, number> = {}
    const tomados: Record<string, number> = {}
    for (const s of libresPorHost[i]) {
      const dia = enZona(s, h.tz).dia
      const tope = h.tope ?? Infinity
      if ((h.reservasPorDia?.[dia] ?? 0) + (tomados[dia] ?? 0) >= tope) continue
      if (s.getTime() < (finPorDia[dia] ?? -Infinity)) continue
      finPorDia[dia] = s.getTime() + p.duracionMin * 60_000
      tomados[dia] = (tomados[dia] ?? 0) + 1
      ;(porDia[dia] ??= {})[h.nombre] = (porDia[dia][h.nombre] ?? 0) + 1
      total++
    }
  })
  return { total, porDia, sinCloser }
}
