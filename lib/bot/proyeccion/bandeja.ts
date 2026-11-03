// ── Continuidad: la llamada de proyección en la BANDEJA del Despacho (la campanita). PURO, sin red ni base ────────────────
// Pedido de Tomás (3/11/2026): además de Discord, que la llamada de proyección aparezca en las notificaciones del Despacho,
// en especial el aviso de 7 días antes. Para Tomás, Aylu y Gero M (una por persona, por mail), con link a la tarjeta:
//   · −14 a −8 → «Invitar a X a la llamada de proyección (le quedan N días)».
//   · −7 y −6  → «Agendar la llamada de proyección con X (le quedan N días)».
//   · −5 a 0   → «Sigue sin agendar la llamada de proyección con X (…)» (la de −3 en adelante, urgente).
// Mismas reglas y exclusiones que el cron (reglas.ts: sin fin, pausados, finalizados, no clientes, pruebas, archivados).
// Sin duplicar: la clave es la del paso del cron + destinatario (la misma nunca se crea dos veces).
// Se resuelven solas:
//   · al marcar «Avisado» (cierra la de invitar) o «Agendada» / «Hecha» (cierra todas las del cliente): marcas.ts y la acción
//     «Llamada de proyección» de la tarjeta;
//   · en cada corrida del cron: la de un paso anterior (la reemplaza la del paso nuevo) y la del cliente que ya no corresponde
//     (agendada en Calendly, avisado, archivado, pausado, renovado). Las de un fin ya vencido sin agendar quedan abiertas
//     (el panel lo sigue mostrando como atrasado hasta 30 días).
import type { NuevaNotificacion } from '@/lib/notificaciones/modelo'
import { fechaCorta, textoQuedan, type AccionProyeccion } from './reglas'

export const ORIGEN_BANDEJA = 'bot-proyeccion'
export const TIPO_BANDEJA = 'proyeccion_llamada'

export interface DestinoBandeja { email: string; nombre: string }

/** Las variables que ya identifican a cada uno en el Despacho (las mismas de aprobadores de altas, sin Gero A). */
export const VARIABLES_DESTINO: readonly { variable: string; nombre: string }[] = [
  { variable: 'EDICION_REVISOR_TOMAS', nombre: 'Tomás' },
  { variable: 'KICKOFF_REVISOR_TOMI', nombre: 'Tomás' },
  { variable: 'EDICION_REVISOR_AYLU', nombre: 'Aylu' },
  { variable: 'KICKOFF_REVISOR_GERO_M', nombre: 'Gero M' },
]
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Tomás, Aylu y Gero M por mail (sin repetir). Vacío si no hay ninguna variable: entonces va a la sección Clientes. */
export function destinatariosBandeja(env: Record<string, string | undefined> = process.env): DestinoBandeja[] {
  const out = new Map<string, DestinoBandeja>()
  for (const { variable, nombre } of VARIABLES_DESTINO) {
    for (const crudo of (env[variable] ?? '').split(/[,;\s]+/)) {
      const email = crudo.trim().toLowerCase()
      if (email && /^[\x21-\x7e]+$/.test(email) && email.length <= 254 && RE_EMAIL.test(email) && !out.has(email)) out.set(email, { email, nombre })
    }
  }
  return [...out.values()]
}

// Huella corta del mail para la clave (el mail no queda escrito en la clave). FNV-1a de 32 bits.
const huella = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/** Clave de la notificación: la del paso del cron (`proyeccion:ID:fin:paso`) + destinatario. */
export const claveBandeja = (claveAccion: string, email: string | null): string =>
  `${claveAccion}:bandeja:${email ? huella(email.trim().toLowerCase()) : 'clientes'}`
/** `proyeccion:ID:fin:paso` de una clave de la bandeja. */
export const baseDeClave = (clave: string): string => clave.replace(/:bandeja:.*$/, '')
/** `proyeccion:ID:fin` de una clave (el cliente y el ciclo, sin el paso). */
export const cicloDeClave = (clave: string): string => baseDeClave(clave).split(':').slice(0, 3).join(':')
export const cicloProyeccion = (idCrm: string, fin: string): string => `proyeccion:${idCrm.trim().toUpperCase()}:${fin}`

export const linkProyeccion = (idCrm: string): string => `/clientes?cliente=${encodeURIComponent(idCrm.toUpperCase())}#rc-proyeccion`

/** Título de la notificación (el pedido de Tomás, palabra por palabra en −14 y −7). */
export function tituloBandeja(a: Pick<AccionProyeccion, 'paso' | 'cliente' | 'dias'>): string {
  const quedan = textoQuedan(a.dias)
  if (a.paso === 'invitar') return `Invitar a ${a.cliente.nombre} a la llamada de proyección (${quedan})`
  if (a.paso === 'agendar') return `Agendar la llamada de proyección con ${a.cliente.nombre} (${quedan})`
  return `Sigue sin agendar la llamada de proyección con ${a.cliente.nombre} (${quedan})`
}

export function cuerpoBandeja(a: Pick<AccionProyeccion, 'paso' | 'fin' | 'avisado'>): string {
  const marca = a.paso === 'invitar'
    ? 'El texto para pegarle está en Discord (📤 para enviar al cliente). Cuando se lo mandes, marcá «Avisado» en su tarjeta o en Clientes → Pendientes de llamada de proyección y esta notificación se resuelve sola.'
    : `${a.avisado ? 'Ya se le avisó de la llamada.' : 'Todavía no figura avisado.'} Cuando quede agendada, marcá «Agendada» en su tarjeta o en Clientes → Pendientes de llamada de proyección y esta notificación se resuelve sola.`
  return `Fin del programa: ${fechaCorta(a.fin)}. Es para que tenga continuidad y no piense que se tiene que bajar. ${marca}`
}

/** Las notificaciones de una acción del cron: una por destinatario (o una a la sección Clientes si no hay mails). */
export function avisosBandeja(a: Pick<AccionProyeccion, 'paso' | 'cliente' | 'fin' | 'dias' | 'avisado' | 'clave'>, destinos: readonly DestinoBandeja[]): NuevaNotificacion[] {
  const base = {
    tipo: TIPO_BANDEJA, titulo: tituloBandeja(a), cuerpo: cuerpoBandeja(a), url: linkProyeccion(a.cliente.id),
    urgente: a.paso === 'rec3', origen: ORIGEN_BANDEJA,
  }
  if (!destinos.length) return [{ ...base, paraSeccion: 'clientes', paraEmail: null, clave: claveBandeja(a.clave, null) }]
  return destinos.map((d) => ({ ...base, paraEmail: d.email, paraSeccion: null, clave: claveBandeja(a.clave, d.email) }))
}

/** Cuáles de las abiertas cerrar en la corrida: las que no son del paso de hoy de un cliente vigente, salvo las de un
 *  ciclo en `mantener` (fin vencido sin agendar). */
export function aCerrarEnCorrida(abiertas: readonly { id: number; clave: string }[], vigentes: ReadonlySet<string>, mantener: ReadonlySet<string>): number[] {
  return abiertas.filter((n) => !vigentes.has(baseDeClave(n.clave)) && !mantener.has(cicloDeClave(n.clave))).map((n) => n.id)
}

/** Patrón (LIKE) de las notificaciones que resuelve una marca. null si esa marca no resuelve nada (quitar, «No se dio»). */
export function patronCierre(idCrm: string, m: { campo: 'avisado' | 'agendada' | 'resultado'; fecha: string | null; resultado?: string | null }): string | null {
  if (!/^[A-Za-z]\d{1,6}$/.test(idCrm) || !m.fecha) return null
  const id = idCrm.toUpperCase()
  if (m.campo === 'avisado') return `proyeccion:${id}:%:invitar:bandeja:%`
  if (m.campo === 'agendada') return `proyeccion:${id}:%`
  return m.resultado === 'hecha' ? `proyeccion:${id}:%` : null
}

/** Lo mismo para la acción «Llamada de proyección» de la tarjeta (link enviado = avisado). */
export const patronCierreAccion = (idCrm: string, estado: string): string | null =>
  estado === 'link_enviado' ? patronCierre(idCrm, { campo: 'avisado', fecha: 'x' })
    : estado === 'agendada' ? patronCierre(idCrm, { campo: 'agendada', fecha: 'x' })
    : estado === 'hecha' ? patronCierre(idCrm, { campo: 'resultado', fecha: 'x', resultado: 'hecha' })
    : null

/** Cierra (nunca tira) lo que resuelve una marca. SOLO servidor: carga el registro de notificaciones al usarse. */
export async function cerrarPorMarca(patron: string | null, por: string): Promise<void> {
  if (!patron) return
  try {
    const { cerrarNotificacionesPorPatron } = await import('@/lib/notificaciones/registro')
    await cerrarNotificacionesPorPatron(ORIGEN_BANDEJA, patron, por)
  } catch (e) {
    console.error('[proyección] no se pudieron resolver las notificaciones:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
  }
}
