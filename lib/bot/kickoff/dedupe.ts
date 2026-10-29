// ── La misma kickoff grabada por los dos (Tomás y Gero M): reconocer la segunda ANTES de pagar Claude ───────────
// Cada uno graba con su Fathom y su webhook, así que la misma llamada llega dos veces, con dos recording_id distintos (y
// saldrían dos fichas y dos avisos). Gana la PRIMERA que se registró en cj_kickoffs (por `creado`, y si empatan, por
// recording_id): la segunda queda "duplicada" con referencia a la primera, sin Claude y sin aviso. No se elige "la más
// completa": la primera alcanza (decisión de Tomás, 24/10).
// Cómo se reconoce la misma reunión (claveDeReunion arma la clave al llegar; mismaReunion compara dos):
//   1. el mismo HORARIO: el mismo evento agendado (scheduled_start_time, ±2 min) o, si alguna no lo trae, grabaciones que
//      empiezan a menos de 20 min y se pisan en el tiempo. Dos grabaciones que no se pisan nunca son la misma llamada;
//   2. el mismo INVITADO EXTERNO por mail. No cuentan los mails del equipo (EQUIPO_ACCESOS_BASE) ni los de quienes grabaron:
//      en la grabación de Gero M, Tomás puede figurar como externo (y al revés), y si los dos hacen kickoffs distintos a la
//      misma hora con Tomás invitado a las dos, ese mail no las tiene que juntar;
//   3. si alguna no tiene invitados externos para comparar: el mismo TÍTULO de evento (meeting_title, el del calendario) y el
//      mismo horario agendado. Si las dos tienen invitados y no comparten ninguno, NO es la misma (aunque el título coincida).
// Privacidad: la clave guarda HUELLAS de los mails (sha256 truncado, con un prefijo fijo), no los mails: el payload (que sí
// los trae) se borra al terminar, y la clave queda en la fila (columna dedupe) para comparar con las que lleguen después.
// La búsqueda en la base (buscarGemela) está en registro.ts; acá, lo puro.
import { createHash } from 'node:crypto'
import type { ReunionFathom } from '@/lib/fathomAnuncios/tipos'
import { MAILS_ACCESOS_EQUIPO } from './tipos'

export interface ClaveReunion {
  hora: string | null             // la referencia para buscar (agendado → inicio de la grabación → created_at): columna agendado
  agendado: string | null         // scheduled_start_time (ISO)
  inicio: string | null           // recording_start_time
  fin: string | null              // recording_end_time
  evento: string | null           // título del evento del calendario, normalizado (sin acentos, minúsculas)
  invitados: string[]             // huellas de los mails de los invitados externos (sin el equipo ni quien grabó)
  grabo: string | null            // huella del mail de quien grabó (recorded_by)
  // Desde el 24/10 (tarde); en una clave guardada antes faltan: [] / null / true
  hablantes?: string[]            // huellas de los nombres de quienes hablan en la transcripción, sin el de quien grabó
  grabo_nombre?: string | null    // huella del nombre de quien grabó (para ver si habla en la otra grabación)
  procesable?: boolean            // trae transcripción y no es una prueba cortada (la pone procesar.ts)
}

export const VENTANA_AGENDADO_MS = 2 * 60_000
export const VENTANA_GRABACION_MS = 20 * 60_000
/** Sin calendario para comparar, las dos grabaciones tienen que empezar a menos de esto (además de pisarse y compartir quien habla). */
export const VENTANA_SIN_CALENDARIO_MS = 5 * 60_000
const MAX_HABLANTES = 30
const TOLERANCIA_SOLAPE_MS = 60_000
/** Lo que se busca en la base alrededor de `hora` (después mismaReunion afina). */
export const VENTANA_BUSQUEDA_MS = VENTANA_GRABACION_MS

const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const iso = (x: unknown): string | null => {
  if (typeof x !== 'string' || x.length > 40) return null
  const t = Date.parse(x)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
const RE_HUELLA = /^[0-9a-f]{16}$/

/** La huella de un mail (no se puede volver al mail sin adivinarlo): sha256 de "cj-kickoff:<mail en minúsculas>", 16 hex. */
export const huellaMail = (mail: string): string => createHash('sha256').update(`cj-kickoff:${mail.trim().toLowerCase()}`).digest('hex').slice(0, 16)

const normEvento = (x: string | null | undefined): string | null => {
  const n = (x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return n ? n.slice(0, 200) : null
}
/** La huella de un nombre de quien habla (normalizado: sin acentos, minúsculas, solo letras y números), o null. */
export const huellaNombre = (nombre: string | null | undefined): string | null => {
  const n = normEvento(nombre)
  return n && n !== 'sin nombre' ? createHash('sha256').update(`cj-kickoff-nombre:${n}`).digest('hex').slice(0, 16) : null
}

/** La clave de una reunión de Fathom (la validada más el payload crudo: validarReunion no conserva scheduled_start_time). */
export function claveDeReunion(
  r: Pick<ReunionFathom, 'meeting_title' | 'recording_start_time' | 'recording_end_time' | 'created_at' | 'calendar_invitees' | 'recorded_by'> & Partial<Pick<ReunionFathom, 'transcript'>>,
  crudo: unknown,
): ClaveReunion {
  const c = esObj(crudo) ? crudo : {}
  const agendado = iso(c.scheduled_start_time)
  const inicio = iso(r.recording_start_time), fin = iso(r.recording_end_time)
  const grabo = r.recorded_by?.email ? huellaMail(r.recorded_by.email) : null
  const equipo = new Set(MAILS_ACCESOS_EQUIPO.map(huellaMail))
  const invitados = [...new Set(r.calendar_invitees.filter(i => i.is_external && i.email).map(i => huellaMail(i.email!)))]
    .filter(h => h !== grabo && !equipo.has(h)).sort()
  // Quienes hablan, sin el que grabó (su nombre va aparte: si habla en la otra grabación, es la misma)
  const grabo_nombre = huellaNombre(r.recorded_by?.name)
  const hablantes = [...new Set((r.transcript ?? []).map(x => huellaNombre(x.speaker?.display_name)).filter((h): h is string => !!h && h !== grabo_nombre))]
    .sort().slice(0, MAX_HABLANTES)
  return { hora: agendado ?? inicio ?? iso(r.created_at), agendado, inicio, fin, evento: normEvento(r.meeting_title), invitados, grabo, hablantes, grabo_nombre }
}

/** La clave guardada (columna dedupe, jsonb), leída con cuidado; null si no tiene la forma. */
export function leerClave(x: unknown): ClaveReunion | null {
  if (!esObj(x)) return null
  const huellas = (y: unknown, max: number) => (Array.isArray(y) ? y.filter((h): h is string => typeof h === 'string' && RE_HUELLA.test(h)).slice(0, max) : [])
  const huella = (y: unknown) => (typeof y === 'string' && RE_HUELLA.test(y) ? y : null)
  const k: ClaveReunion = {
    hora: iso(x.hora), agendado: iso(x.agendado), inicio: iso(x.inicio), fin: iso(x.fin),
    evento: typeof x.evento === 'string' ? normEvento(x.evento) : null,
    invitados: huellas(x.invitados, 200),
    grabo: huella(x.grabo),
    hablantes: huellas(x.hablantes, MAX_HABLANTES),
    grabo_nombre: huella(x.grabo_nombre),
    procesable: x.procesable !== false,
  }
  return k.hora || k.agendado || k.inicio ? k : null
}

export type PorQueMisma = 'invitado' | 'evento' | 'hablantes'

/**
 * ¿Es la misma reunión? 'invitado' (mismo horario y un invitado externo en común), 'evento' (sin invitados para comparar:
 * mismo título y mismo horario agendado), 'hablantes' (sin calendario para comparar: empiezan casi juntas, se pisan y
 * comparten a alguien que habla) o null. Nunca la misma si las grabó la misma cuenta.
 */
export function mismaReunion(a: ClaveReunion, b: ClaveReunion): PorQueMisma | null {
  const t = (x: string) => Date.parse(x)
  // El mismo Fathom: dos partes de la misma llamada (cortada y retomada), no la grabación del otro
  if ((a.grabo && b.grabo && a.grabo === b.grabo) || (a.grabo_nombre && b.grabo_nombre && a.grabo_nombre === b.grabo_nombre)) return null
  const ambosAgendados = !!(a.agendado && b.agendado)
  if (ambosAgendados) {
    if (Math.abs(t(a.agendado!) - t(b.agendado!)) > VENTANA_AGENDADO_MS) return null
  } else if (a.inicio && b.inicio) {
    if (Math.abs(t(a.inicio) - t(b.inicio)) > VENTANA_GRABACION_MS) return null
  } else return null
  // Dos grabaciones que no se pisan en el tiempo no son la misma llamada (con 1 minuto de tolerancia)
  if (a.inicio && a.fin && b.inicio && b.fin && (t(a.inicio) > t(b.fin) + TOLERANCIA_SOLAPE_MS || t(b.inicio) > t(a.fin) + TOLERANCIA_SOLAPE_MS)) return null
  const quienes = new Set([a.grabo, b.grabo].filter((h): h is string => !!h))
  const ia = a.invitados.filter(h => !quienes.has(h)), ib = new Set(b.invitados.filter(h => !quienes.has(h)))
  if (ia.length && ib.size) return ia.some(h => ib.has(h)) ? 'invitado' : null
  if (ambosAgendados && a.evento && a.evento === b.evento) return 'evento'
  // Sin calendario para comparar (el que se sumó entró por el link): casi juntas, pisándose y con alguien que habla en las dos
  if (!a.inicio || !b.inicio || !a.fin || !b.fin || Math.abs(t(a.inicio) - t(b.inicio)) > VENTANA_SIN_CALENDARIO_MS) return null
  const ha = new Set(a.hablantes ?? []), hb = new Set(b.hablantes ?? [])
  const comparten = [...ha].some(h => hb.has(h))
  const seCruzan = (!!a.grabo_nombre && hb.has(a.grabo_nombre)) || (!!b.grabo_nombre && ha.has(b.grabo_nombre))
  return comparten || seCruzan ? 'hablantes' : null
}
