// ── Bot "Capital Jurídico": etapa BAJA — fin real del programa, avisos, históricos y cruce de una llamada (PURO) ──────────
// Fin real del programa (relevado en el CRM real el 25/10/2026):
//   · El programa dura Día 1 + 120 días corridos (lib/clientes/precios.ts, finDelPeriodo) o los meses de la columna Meses.
//   · Las PAUSAS y los DÍAS EXTRA se cargan hoy como filas de "Extensión …" en Renovaciones (precio 0) con su Finalización
//     explícita ("Extensión +3 semanas — compensa pausa", "Extensión +2 meses — PAUSADO por problemas familiares…").
//   · "Fin período actual" de Agencia es una fórmula: MAXIFS(Renovaciones!E, ID) o, sin filas, Día 1 + 120. Ya incluye
//     las pausas y extensiones. Acá se toma el MAYOR entre esa columna y las Finalizaciones de Renovaciones (por si la
//     fórmula falta en una fila: la trampa de las filas sin fórmulas de lib/clientes/altas.ts) y, sin nada, finDelPeriodo.
// Históricos = Agencia en FINALIZADO o INACTIVO (no existe una pestaña "Históricos": la cartera los muestra como Baja).
import { diasEntre, type Ymd } from '@/lib/clientes/fechas'
import { finDelPeriodo } from '@/lib/clientes/precios'
import type { PropuestaEstado } from './textos'
import { AVISO_FIN_DIAS, RECONTACTO_MAX_DIAS, RECONTACTO_MIN_DIAS, VENTANA_LLAMADA_ANTES_DIAS, VENTANA_LLAMADA_DESPUES_DIAS } from './config'

/** Lo mínimo del CRM que usa la etapa (sale de lib/clientes/leer.ts → Cliente). */
export interface ClienteBaja {
  id: string; nombre: string; estado: string; linea: string; mail: string; celular: string
  dia1: Ymd | null; finPeriodo: Ymd | null; periodos: { fin: Ymd | null; meses: number | null; periodo: number }[]
  fechaBaja: Ymd | null; satisfaccion: number | null; esNoCliente?: boolean
}

/** El fin real del programa (con pausas y extensiones). null si no hay con qué calcularlo. */
export function finReal(c: Pick<ClienteBaja, 'dia1' | 'finPeriodo' | 'periodos'>): Ymd | null {
  const fechas = [c.finPeriodo, ...c.periodos.map((p) => p.fin)].filter((x): x is Ymd => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort()
  if (fechas.length) return fechas[fechas.length - 1]
  return c.dia1 ? finDelPeriodo(c.dia1) : null
}

export interface CandidatoAviso { cliente: ClienteBaja; fin: Ymd; dias: number }

/** i01: los ACTIVOS de Agencia con ID cuyo fin real cae dentro de los próximos AVISO_FIN_DIAS días (hoy incluido). */
export function candidatosAvisoFin(clientes: readonly ClienteBaja[], hoy: Ymd): CandidatoAviso[] {
  const out: CandidatoAviso[] = []
  for (const c of clientes) {
    if (c.linea !== 'agencia' || c.estado !== 'ACTIVO' || !c.id) continue
    const fin = finReal(c)
    if (!fin) continue
    const dias = diasEntre(hoy, fin)
    if (dias >= 0 && dias <= AVISO_FIN_DIAS) out.push({ cliente: c, fin, dias })
  }
  return out.sort((a, b) => a.dias - b.dias || a.cliente.id.localeCompare(b.cliente.id))
}

export const esHistorico = (c: Pick<ClienteBaja, 'linea' | 'estado' | 'id'>): boolean => c.linea === 'agencia' && !!c.id && (c.estado === 'FINALIZADO' || c.estado === 'INACTIVO')

export interface HistoricoCandidato { cliente: ClienteBaja; seFue: Ymd; dias: number }

/** i05: históricos que se fueron hace entre RECONTACTO_MIN_DIAS y RECONTACTO_MAX_DIAS. Se fue = Fecha de baja, o el fin real. */
/** `minDias`: el modo prueba lo baja a 0 para ver la lista el mismo día de la baja de prueba. */
export function historicosParaRecontacto(clientes: readonly ClienteBaja[], hoy: Ymd, minDias: number = RECONTACTO_MIN_DIAS): HistoricoCandidato[] {
  const out: HistoricoCandidato[] = []
  for (const c of clientes) {
    if (!esHistorico(c) || c.esNoCliente) continue
    const seFue = c.fechaBaja ?? finReal(c)
    if (!seFue) continue
    const dias = diasEntre(seFue, hoy)
    if (dias >= minDias && dias <= RECONTACTO_MAX_DIAS) out.push({ cliente: c, seFue, dias })
  }
  return out
}

// ── Cruce de una llamada de Fathom con un cliente (sin Claude: barato) ──
export const normNombre = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'abogado', 'abogada', 'abogados', 'dra', 'dr', 'del', 'los', 'las', 'con', 'and', 'de', 'la', 'el', 'tomas', 'napolitano', 'capital', 'skyward', 'reunion', 'llamada', 'renovacion', 'meet', 'zoom'])
const palabras = (s: string) => new Set(normNombre(s).split(' ').filter((w) => w.length >= 3 && !GENERICAS.has(w)))

export interface DatosLlamada { titulo: string; mails: string[]; fecha: Ymd }

/** El ÚNICO cliente (ACTIVO o PAUSADO de Agencia, con ID) que calza con la llamada y cuyo fin está cerca de la fecha:
 *  por mail de un invitado igual al del CRM o, si no, porque 2 o más palabras de su nombre están en el título.
 *  `conAviso`: IDs a los que ya se les mandó el mensaje de renovación (cuentan aunque el fin esté más lejos). Nunca elige
 *  entre dos. */
export function clienteDeLlamada(clientes: readonly ClienteBaja[], l: DatosLlamada, conAviso: ReadonlySet<string> = new Set()): ClienteBaja | null {
  const cerca = clientes.filter((c) => {
    if (c.linea !== 'agencia' || !c.id || (c.estado !== 'ACTIVO' && c.estado !== 'PAUSADO')) return false
    if (conAviso.has(c.id.toUpperCase())) return true
    const fin = finReal(c)
    if (!fin) return false
    const d = diasEntre(l.fecha, fin)
    return d <= VENTANA_LLAMADA_ANTES_DIAS && d >= -VENTANA_LLAMADA_DESPUES_DIAS
  })
  const mails = new Set(l.mails.map((m) => m.trim().toLowerCase()).filter((m) => m.includes('@')))
  const porMail = cerca.filter((c) => c.mail && mails.has(c.mail.trim().toLowerCase()))
  if (porMail.length === 1) return porMail[0]
  if (porMail.length > 1) return null
  const t = palabras(l.titulo)
  const porNombre = cerca.filter((c) => [...palabras(c.nombre)].filter((w) => t.has(w)).length >= 2)
  return porNombre.length === 1 ? porNombre[0] : null
}

/** Ronda 2 (Tomás, 25/10/2026): ¿FINALIZADO o INACTIVO? Regla de "dudas":
 *   · ACTIVO y su fin real ya pasó o cae en los próximos AVISO_FIN_DIAS (14) días → terminó su período: FINALIZADO, sin dudas
 *     (va propuesto dentro del mismo OK de la baja; igual se puede responder "OK INACTIVO").
 *   · PAUSADO → dudoso (estaba en pausa: puede ser INACTIVO).
 *   · Se va ANTES del fin (faltan más de 14 días) → dudoso (cortó antes de terminar).
 *   · Sin fecha de fin, o un estado raro → dudoso.
 *  Con dudas no se propone nada: se pregunta "OK FINALIZADO / OK INACTIVO". PURO. */
export function estadoParaBaja(c: Pick<ClienteBaja, 'estado' | 'dia1' | 'finPeriodo' | 'periodos'>, hoy: Ymd): PropuestaEstado {
  if (c.estado === 'PAUSADO') return { dudoso: true, motivo: 'estaba en pausa' }
  if (c.estado !== 'ACTIVO') return { dudoso: true, motivo: `figura ${c.estado || 'sin estado'} en el CRM` }
  const fin = finReal(c)
  if (!fin) return { dudoso: true, motivo: 'no tiene fecha de fin' }
  const dias = diasEntre(hoy, fin)
  if (dias <= AVISO_FIN_DIAS) return { dudoso: false, estado: 'FINALIZADO', motivo: dias < 0 ? `terminó su período el ${fin.split('-').reverse().join('/')}` : `su período termina el ${fin.split('-').reverse().join('/')}` }
  return { dudoso: true, motivo: `se va ${dias} días antes del fin (${fin.split('-').reverse().join('/')})` }
}
