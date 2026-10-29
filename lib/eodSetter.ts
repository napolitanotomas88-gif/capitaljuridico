// ── EOD de Maite (setter): cierre del día a las 23:59 AR ─────────────────────
// ManyChat escribe una fila por evento en el sheet de Ventas (reglas creadas el 30/9/2026):
//   "EOD Agendas"            ← cambia el campo AGENDA POR DÍA           (A fecha del campo, B contacto, C @, D ID, E última interacción)
//   "EOD Calendarios"        ← cambia el campo CALENDARIOS POR DÍA      (misma forma)
//   "EOD Agendas historias"  ← cambia AGENDA POR DÍA y el contacto tiene "Historias - <mes>" u outbound_historias (etiqueta MENSUAL)
//   "EOD Outbound historias" ← se aplica la etiqueta outbound_historias (muchas filas llegan con A y B vacías: la fecha no es confiable)
//   "EOD Outbound campo"     ← cambia el campo "Recurso OUTBOUND Historias x día" (regla 2967250, 6/10/2026; misma forma que Agendas).
//                              Es la FUENTE de las aperturas outbound (decisión del usuario 6/10: todo se mide por campos de usuario,
//                              no por etiquetas). Filas 1–6/10 cargadas a mano desde ManyChat (col B "(carga inicial 6/10)").
// Reglas del cálculo:
//   • Agendas/calendarios: contactos únicos por (día de la fecha del campo, ID). Un contacto en otro día cuenta en ese día.
//   • Aperturas outbound: si existe "EOD Outbound campo", contactos únicos por día del campo (igual que agendas). Si no (legado),
//     por etiqueta: cada fila es un evento; se cuenta por POSICIÓN de fila (append-only) entre el cierre del día anterior
//     (Resumen col G = filas al cierre) y el cierre de este día, con ID único dentro del día. Un contacto que reabre otro día
//     cuenta otra vez. Sin cierre inmediatamente anterior (hueco) o con día viejo → por fecha de fila; si tampoco hay → null (sin dato).
//   • Snapshot: el cierre de un día queda CONGELADO en "Resumen EOD Maite" (col J = EOD en JSON); reejecutar no lo recalcula.
//   • % agenda setter = agendas de Maite ÷ chats asignados por ManyChat ("Setter IG"); NO es conversión de cohorte.
//   • "Etiqueta de historias" es mensual: NO mide atribución por historia ni D+1 (eso va por "Historias publicadas", ver docs/).
// ManyChat escribe fechas tipo "2026-09-30 21:15:00" y Sheets las guarda como serial → se leen UNFORMATTED.
import { google } from 'googleapis'

export const TZ = 'America/Argentina/Buenos_Aires'
export const PESTANAS = {
  agendas: 'EOD Agendas',
  calendarios: 'EOD Calendarios',
  outbound: 'EOD Outbound historias',
  outboundCampo: 'EOD Outbound campo',
  outboundHistoria: 'EOD Outbound historia',
  agendasHistorias: 'EOD Agendas historias',
  resumen: 'Resumen EOD Maite',
  setter: 'Setter IG',
  historias: 'Historias publicadas',
  config: 'EOD Config',
  locks: 'EOD Locks',
}
const HEADER_RESUMEN = ['Fecha', 'Agendas', 'Calendarios enviados', '% agenda setter (agendas ÷ chats asignados, día)', 'Aperturas historias (outbound)', 'Contactos con etiqueta de historias (mensual, referencial)', 'Filas outbound al cierre', 'Discord (ids de mensaje)', 'Snapshot (UTC)', 'EOD congelado (JSON)']
export const HEADER_HISTORIAS = ['ID historia', 'Fecha publicación (YYYY-MM-DD)', 'Etiqueta ManyChat de la historia', 'Link / descripción', 'Notas', 'Cobertura desde (YYYY-MM-DD)']
export const HEADER_LOCKS = ['Fecha', 'Token', 'Creado (UTC)', 'Estado']
export const HEADER_CONFIG = ['Clave', 'Valor', 'Nota']
export const CLAVE_COBERTURA_ASIGNACION = 'asignacion_cobertura_desde'
// Las reglas EOD de ManyChat se crearon el 30/9 ~18:15 AR y la primera fila de datos es del 1/10: antes de esa fecha NO existe registro
// (un 0 sería falso → "sin dato"). Los eventos outbound por campo (regla 2967250) corren desde el 6/10; del 1 al 5/10 son una carga inicial
// manual de los valores finales del campo, que guarda UNA sola fecha por contacto (si reabrió después, el día anterior queda subcontado).
export const EOD_REGISTRO_DESDE = '2026-10-01'
export const OUTBOUND_EVENTOS_DESDE = '2026-10-06'
// OUTBOUND = campo de usuario "OUTBOUND Historia x Día" (id 15043309; decisión de Tomás 20/10: se mide contando contactos con la fecha del día).
// El campo existe desde el 8/10. Del 8 al 20/10 las filas son carga inicial (el campo guarda UNA sola fecha por contacto: cifra mínima);
// desde el 20/10 las escribe la regla de ManyChat 2976579 → pestaña "EOD Outbound historia". Antes del 8/10: sin dato.
// El campo viejo "Recurso OUTBOUND Historias x día" (EOD Outbound campo) cuenta RECURSOS ENVIADOS (respuestas), no outbounds.
export const OUTBOUND_HISTORIA_CAMPO_DESDE = '2026-10-08'
export const OUTBOUND_HISTORIA_REGLA_DESDE = '2026-10-20'

export type Celda = string | number | undefined

export function cliente() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!email || !key || !process.env.SHEET_ID_VENTAS) return null
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return google.sheets({ version: 'v4', auth })
}

export const hoyYMD = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })
export const minutosAR = (d = new Date()) => {
  const [h, m] = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).split(':').map(Number)
  return (h % 24) * 60 + m
}
export const sumarDias = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// "YYYY-MM-DD" que existe en el calendario (rechaza 2026-02-30, 2026-13-01…) y es razonable (≥ 2025)
export function fechaReal(ymd: string): boolean {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m || +m[1] < 2025) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

// Celda → "YYYY-MM-DD" (serial de Sheets, ISO, DD/MM/YYYY o texto que Date entienda); null si no es una fecha real
export function ymdDeCelda(v: Celda): string | null {
  let out: string | null = null
  if (typeof v === 'number') {
    if (isFinite(v) && v > 0) out = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-6) * 86_400_000).toISOString().slice(0, 10)
  } else {
    const s = String(v ?? '').trim()
    if (!s) return null
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) out = `${m[1]}-${m[2]}-${m[3]}`
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
      const a = +m[1], b = +m[2]
      const [d, mes] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]   // DD/MM salvo que no pueda ser día
      out = `${m[3]}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    } else { const t = Date.parse(s); out = isNaN(t) ? null : hoyYMD(new Date(t)) }
  }
  return out && fechaReal(out) ? out : null
}

const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
const filasConDatos = (rows: Celda[][]) => rows.filter(r => r.some(c => String(c ?? '').trim() !== ''))
const norm = (s: Celda) => String(s ?? '').trim().toLowerCase()

export interface ContactoEOD { nombre: string; usuario: string; id: string }
export interface DiaEOD { fecha: string; agendas: number; calendarios: number; outbound?: number | null; recursos?: number; sinDato?: boolean }
export interface PctSetter { agendas: number; asignados: number | null; pct: number | null; motivo?: string }
export interface ItemHistoria { id: string; fechaPub: string; etiqueta: string; agendasD1: number | null; motivo?: string }
export interface EOD {
  fecha: string                       // YYYY-MM-DD (AR)
  agendas: ContactoEOD[]
  calendarios: number
  aperturasHistorias: number | null   // null = sin dato (no se inventa un 0)
  aperturasModo: 'campo-outbound' | 'campo' | 'delta' | 'fecha' | 'sin-base'
  aperturasNota?: string
  etiquetaHistorias: ContactoEOD[]    // etiqueta MENSUAL de historias: referencial, no es atribución
  filasOutbound: number               // filas al cierre (posición de corte)
  outboundSinFecha: number
  setterDia: PctSetter
  setterMes: PctSetter
  mes: { desde: string; agendas: number; calendarios: number; etiquetaHistorias: number; outbound?: number; recursos?: number }
  recursosEnviados?: number           // contactos con el campo "Recurso OUTBOUND Historias x día" = fecha (respuestas al outbound)
  serie: DiaEOD[]                     // últimos 7 días hasta `fecha`
  atribucion: { configurado: boolean; items: ItemHistoria[]; nota?: string }
  avisos: string[]
  sinRegistros?: string               // día anterior al inicio de los registros EOD: ninguna métrica es medible
}
export interface DatosEOD {
  agendas: Celda[][]; calendarios: Celda[][]; outbound: Celda[][]; agendasHistorias: Celda[][]; resumen: Celda[][]
  setterIG?: Celda[][]; historias?: Celda[][]; config?: Celda[][]; outboundCampo?: Celda[][]; outboundHistoria?: Celda[][]
}

const claveContacto = (r: Celda[]) => {
  const nombre = String(r[1] ?? '').trim(), usuario = String(r[2] ?? '').trim().replace(/^@/, '')
  const id = String(r[3] ?? '').trim()
  return { nombre, usuario, id, clave: id || nombre.toLowerCase() || usuario.toLowerCase() }
}

// Fecha de un evento outbound: col F "Fecha evento outbound" (campo de ManyChat, confiable) o, si falta, col A (última interacción, poco confiable)
const fechaOutbound = (r: Celda[]) => ymdDeCelda(r[5]) ?? ymdDeCelda(r[0])

// Contactos únicos de una pestaña EOD por fecha (col A): { día → contactos }. Un contacto cuenta una vez por día.
function porDia(rows: Celda[][], hoy: string, tab: string, avisos: string[]): Map<string, ContactoEOD[]> {
  const out = new Map<string, ContactoEOD[]>()
  const vistos = new Set<string>()
  let futuras = 0, ilegibles = 0
  for (const r of filasConDatos(rows)) {
    const f = ymdDeCelda(r[0])
    if (!f) { if (String(r[0] ?? '').trim() !== '') ilegibles++; continue }
    if (f > hoy) { futuras++; continue }
    const { clave, ...c } = claveContacto(r)
    if (!clave || vistos.has(`${f}|${clave}`)) continue
    vistos.add(`${f}|${clave}`)
    out.set(f, [...(out.get(f) ?? []), c])
  }
  if (futuras) avisos.push(`${tab}: ${futuras} fila(s) con fecha futura ignoradas`)
  if (ilegibles) avisos.push(`${tab}: ${ilegibles} fila(s) con fecha ilegible ignoradas`)
  return out
}

interface CierreResumen { fecha: string; filas: number | null; snapshotTs: string }
const cierres = (resumen: Celda[][]): CierreResumen[] => filasConDatos(resumen).flatMap(r => {
  const f = ymdDeCelda(r[0])
  if (!f) return []
  const n = r[6] === '' || r[6] === undefined ? NaN : Number(r[6])
  return [{ fecha: f, filas: isFinite(n) ? n : null, snapshotTs: String(r[8] ?? '') }]
})

// Cuántas horas AR después de f+1 06:00 se tomó el snapshot: si fue tarde, el delta del día siguiente puede perder aperturas
function snapshotTardio(c: CierreResumen): boolean {
  if (!c.snapshotTs) return true   // legado: sin hora registrada
  const t = new Date(c.snapshotTs)
  if (isNaN(+t)) return true
  const ymd = hoyYMD(t), lim = sumarDias(c.fecha, 1)
  return ymd > lim || (ymd === lim && minutosAR(t) >= 6 * 60)
}

// Atribución por historia (esquema "Historias publicadas"): agendas del día D+1 de contactos cuya fila trae en col F la historia de origen (etiqueta o ID de "Historias publicadas")
// Cobertura (col F de "Historias publicadas") = fecha desde la cual el flujo de ESA historia escribe "Historia origen EOD" Y la regla de
// ManyChat registra la col F de "EOD Agendas historias", verificado por una persona. Sin esa fecha, o si es posterior a la publicación, la
// cobertura no está garantizada y la métrica es "sin medir": un 0 sería indistinguible de "no se estaba registrando".
export function atribucionHistorias(historias: Celda[][], agH: Celda[][], fecha: string, hoy: string): EOD['atribucion'] {
  const vistos = new Set<string>(), duplicados: string[] = []
  const hs = filasConDatos(historias).flatMap(r => {
    const fechaPub = ymdDeCelda(r[1]), etiqueta = String(r[2] ?? '').trim()
    if (!fechaPub || !etiqueta) return []
    const id = String(r[0] ?? '').trim() || etiqueta
    if (vistos.has(norm(id))) { duplicados.push(id); return [] }   // ID único: la primera fila manda
    vistos.add(norm(id))
    return [{ id, fechaPub, etiqueta, cobertura: ymdDeCelda(r[5]) }]
  })
  if (!hs.length) return { configurado: false, items: [], nota: 'sin historias cargadas en "Historias publicadas"' }
  const items: ItemHistoria[] = hs.filter(h => sumarDias(h.fechaPub, 1) === fecha && fecha <= hoy).map(({ cobertura, ...h }) => {
    if (!cobertura) return { ...h, agendasD1: null, motivo: 'sin fecha de cobertura verificada' }
    if (cobertura > h.fechaPub) return { ...h, agendasD1: null, motivo: `cobertura desde ${ddmmyyyy(cobertura)}, posterior a la publicación` }
    const ids = new Set<string>()
    for (const r of filasConDatos(agH)) {
      if (ymdDeCelda(r[0]) !== fecha || ![norm(h.etiqueta), norm(h.id)].includes(norm(r[5]))) continue
      ids.add(claveContacto(r).clave)
    }
    return { ...h, agendasD1: ids.size }
  })
  return {
    configurado: hs.some(h => h.cobertura && h.cobertura <= h.fechaPub), items,
    nota: duplicados.length ? `IDs duplicados ignorados en "Historias publicadas": ${duplicados.join(', ')}` : undefined,
  }
}

// Cálculo puro (testeable): recibe las filas de cada pestaña. `hoy` = fecha AR actual.
export function calcularDesdeFilas(d: DatosEOD, fecha: string, hoy = hoyYMD()): EOD {
  if (!fechaReal(fecha)) throw new Error(`fecha inválida: ${fecha}`)
  if (fecha > hoy) throw new Error(`fecha futura: ${fecha}`)
  const avisos: string[] = []
  if (fecha < EOD_REGISTRO_DESDE) {
    const motivo = `sin registros: las reglas EOD de ManyChat empiezan el ${ddmmyyyy(EOD_REGISTRO_DESDE)}`
    const nulo = (a: number): PctSetter => ({ agendas: a, asignados: null, pct: null, motivo })
    return {
      fecha, agendas: [], calendarios: 0, aperturasHistorias: null, aperturasModo: 'sin-base', aperturasNota: motivo, etiquetaHistorias: [],
      filasOutbound: 0, outboundSinFecha: 0, setterDia: nulo(0), setterMes: nulo(0),
      mes: { desde: `${fecha.slice(0, 8)}01`, agendas: 0, calendarios: 0, etiquetaHistorias: 0 }, serie: [],
      atribucion: { configurado: false, items: [] }, avisos, sinRegistros: motivo,
    }
  }
  const ag = porDia(d.agendas, hoy, PESTANAS.agendas, avisos), cal = porDia(d.calendarios, hoy, PESTANAS.calendarios, avisos)
  const agH = porDia(d.agendasHistorias, hoy, PESTANAS.agendasHistorias, avisos)
  const agendas = ag.get(fecha) ?? []
  const calendarios = (cal.get(fecha) ?? []).length
  const etiquetaHistorias = agH.get(fecha) ?? []
  const obC = d.outboundCampo ? porDia(d.outboundCampo, hoy, PESTANAS.outboundCampo, avisos) : null          // recursos enviados
  const obH = d.outboundHistoria ? porDia(d.outboundHistoria, hoy, PESTANAS.outboundHistoria, avisos) : null  // outbound hechos

  // Outbound: por posición de fila. `corte` = filas hasta la primera con fecha posterior al día (no entran en este cierre).
  const filas = filasConDatos(d.outbound)
  const posterior = filas.findIndex(r => { const f = fechaOutbound(r); return !!f && f > fecha })
  const corte = posterior < 0 ? filas.length : posterior
  const hastaCorte = filas.slice(0, corte)
  const outboundSinFecha = hastaCorte.filter(r => !fechaOutbound(r)).length
  const unicos = (rs: Celda[][]) => new Set(rs.map(r => claveContacto(r).clave).filter(Boolean)).size
  const previo = cierres(d.resumen).filter(c => c.fecha === sumarDias(fecha, -1)).pop()
  let aperturasHistorias: number | null, aperturasModo: EOD['aperturasModo'], aperturasNota: string | undefined
  if (obH) {
    aperturasModo = 'campo-outbound'
    if (fecha < OUTBOUND_HISTORIA_CAMPO_DESDE) { aperturasHistorias = null; aperturasNota = `el campo OUTBOUND Historia x Día existe desde el ${ddmmyyyy(OUTBOUND_HISTORIA_CAMPO_DESDE)}` }
    else {
      aperturasHistorias = (obH.get(fecha) ?? []).length
      if (fecha < OUTBOUND_HISTORIA_REGLA_DESDE) aperturasNota = 'cifra mínima: el campo guarda solo la última fecha por contacto'
    }
  } else if (obC) {
    aperturasHistorias = (obC.get(fecha) ?? []).length; aperturasModo = 'campo'
    if (fecha < OUTBOUND_EVENTOS_DESDE) aperturasNota = 'carga inicial manual: el campo guarda solo la última fecha por contacto, cifra mínima'
  } else if (previo && previo.filas !== null && fecha >= sumarDias(hoy, -1) && previo.filas <= corte) {
    aperturasHistorias = unicos(hastaCorte.slice(previo.filas)); aperturasModo = 'delta'
    if (snapshotTardio(previo)) aperturasNota = `la base del cierre del ${ddmmyyyy(previo.fecha)} se tomó tarde o sin hora registrada: puede estar subcontado`
  } else {
    const fechadas = unicos(hastaCorte.filter(r => fechaOutbound(r) === fecha))
    if (fechadas > 0) { aperturasHistorias = fechadas; aperturasModo = 'fecha' } else { aperturasHistorias = null; aperturasModo = 'sin-base' }
    const ult = cierres(d.resumen).filter(c => c.fecha < fecha).pop()
    aperturasNota = previo?.filas !== undefined && previo.filas !== null && previo.filas > corte
      ? 'las filas de outbound disminuyeron respecto del cierre anterior (filas borradas): sin dato'
      : !previo ? (ult ? `hueco: el último cierre es del ${ddmmyyyy(ult.fecha)}, no del día anterior` : 'primer cierre: no hay base del día anterior') : undefined
  }

  // % agenda setter = agendas de Maite ÷ chats asignados, SOLO con la fecha real de asignación (Setter IG col A "Fecha (asignación)").
  // La col C "Suscrito" es la fecha de suscripción al bot, NO la de asignación: no se usa nunca como fallback. Además, como la regla
  // ASIGNADO → Setter IG dejó A vacía en la mayoría de las filas, el conteo por A solo es válido desde la fecha de cobertura verificada
  // ("EOD Config" → asignacion_cobertura_desde). Sin esa fecha, o para períodos anteriores, el dato es null (sin dato), no 0 ni parcial.
  const cobertura = filasConDatos(d.config ?? []).flatMap(r => norm(r[0]) === CLAVE_COBERTURA_ASIGNACION ? [ymdDeCelda(r[1])] : []).find(Boolean) ?? null
  const setter = new Map<string, Set<string>>()
  filasConDatos(d.setterIG ?? []).forEach((r, i) => {
    const f = ymdDeCelda(r[0])
    if (!f || f > hoy) return
    const clave = String(r[6] ?? '').trim() || (norm(r[5]) ? `@${norm(r[5])}` : `fila-${i}`)
    setter.set(f, (setter.get(f) ?? new Set()).add(clave))
  })
  const desde = `${fecha.slice(0, 8)}01`
  const mesSet = (m: Map<string, unknown[] | Set<string>>) => [...m].filter(([f]) => f >= desde && f <= fecha).reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : v.size), 0)
  const sinCobertura = (inicio: string): string | null =>
    !cobertura ? 'fecha de asignación ausente: seguimiento real no iniciado'
      : cobertura > inicio ? `cobertura de fecha de asignación desde ${ddmmyyyy(cobertura)}` : null
  const pct = (a: number, asig: number, motivo: string | null): PctSetter =>
    motivo ? { agendas: a, asignados: null, pct: null, motivo }
      : { agendas: a, asignados: asig, pct: asig > 0 && asig >= a ? a / asig : null, ...(asig > 0 && asig >= a ? {} : { motivo: asig === 0 ? 'sin chats asignados registrados' : 'los asignados no cubren las agendas' }) }
  const setterDia = pct(agendas.length, setter.get(fecha)?.size ?? 0, sinCobertura(fecha))
  const setterMes = pct(mesSet(ag), mesSet(setter), sinCobertura(desde))

  const serie: DiaEOD[] = Array.from({ length: 7 }, (_, i) => {
    const f = sumarDias(fecha, i - 6)
    if (f < EOD_REGISTRO_DESDE) return { fecha: f, agendas: 0, calendarios: 0, sinDato: true }
    const ob = obH ? { outbound: f < OUTBOUND_HISTORIA_CAMPO_DESDE ? null : (obH.get(f) ?? []).length } : obC ? { outbound: (obC.get(f) ?? []).length } : {}
    return { fecha: f, agendas: (ag.get(f) ?? []).length, calendarios: (cal.get(f) ?? []).length, ...ob, ...(obC ? { recursos: (obC.get(f) ?? []).length } : {}) }
  })
  if (obH && serie.some(x => !x.sinDato && x.fecha >= OUTBOUND_HISTORIA_CAMPO_DESDE && x.fecha < OUTBOUND_HISTORIA_REGLA_DESDE))
    avisos.push(`Outbound del ${ddmmyyyy(OUTBOUND_HISTORIA_CAMPO_DESDE)} al ${ddmmyyyy(sumarDias(OUTBOUND_HISTORIA_REGLA_DESDE, -1))}: carga inicial desde ManyChat (el campo guarda solo la última fecha por contacto), cifras mínimas`)
  else if (!obH && obC && serie.some(x => !x.sinDato && x.fecha < OUTBOUND_EVENTOS_DESDE))
    avisos.push(`Outbound del ${ddmmyyyy(EOD_REGISTRO_DESDE)} al ${ddmmyyyy(sumarDias(OUTBOUND_EVENTOS_DESDE, -1))}: carga inicial manual (el campo guarda solo la última fecha por contacto), cifras mínimas`)
  return {
    fecha, agendas, calendarios, aperturasHistorias, aperturasModo, aperturasNota, etiquetaHistorias,
    filasOutbound: corte, outboundSinFecha, setterDia, setterMes,
    ...(obC ? { recursosEnviados: (obC.get(fecha) ?? []).length } : {}),
    mes: { desde, agendas: mesSet(ag), calendarios: mesSet(cal), etiquetaHistorias: mesSet(agH), ...(obH ? { outbound: mesSet(obH) } : obC ? { outbound: mesSet(obC) } : {}), ...(obC && obH ? { recursos: mesSet(obC) } : {}) },
    serie, atribucion: atribucionHistorias(d.historias ?? [], d.agendasHistorias, fecha, hoy), avisos,
  }
}

// Snapshot congelado: si el día ya está cerrado en "Resumen EOD Maite" (col J), se devuelve tal cual, sin recalcular
export function snapshotCongelado(resumen: Celda[][], fecha: string): EOD | null {
  for (const r of filasConDatos(resumen)) {
    if (ymdDeCelda(r[0]) !== fecha || !String(r[9] ?? '').trim()) continue
    try { const e = JSON.parse(String(r[9])) as EOD; if (e.fecha === fecha) return e } catch { /* JSON roto → se trata como no congelado */ }
  }
  return null
}

export async function leerDatos(): Promise<DatosEOD> {
  const sheets = cliente()
  if (!sheets) throw new Error('sin credenciales de Sheets o SHEET_ID_VENTAS')
  const id = process.env.SHEET_ID_VENTAS!
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' })
  const existentes = new Set((meta.data.sheets ?? []).map(s => s.properties?.title))
  const obligatorias = [PESTANAS.agendas, PESTANAS.calendarios, PESTANAS.outbound, PESTANAS.agendasHistorias]
  const faltan = obligatorias.filter(t => !existentes.has(t))
  if (faltan.length) throw new Error(`faltan pestañas en Ventas: ${faltan.join(', ')}`)
  const opcionales: [keyof DatosEOD, string, string][] = [['outboundCampo', PESTANAS.outboundCampo, 'A2:E'], ['outboundHistoria', PESTANAS.outboundHistoria, 'A2:E'], ['resumen', PESTANAS.resumen, 'A2:J'], ['setterIG', PESTANAS.setter, 'A2:G'], ['historias', PESTANAS.historias, 'A2:F'], ['config', PESTANAS.config, 'A2:C']]
  const pedidos: [keyof DatosEOD, string][] = [
    ['agendas', `'${PESTANAS.agendas}'!A2:E`], ['calendarios', `'${PESTANAS.calendarios}'!A2:E`], ['outbound', `'${PESTANAS.outbound}'!A2:F`],
    ['agendasHistorias', `'${PESTANAS.agendasHistorias}'!A2:F`],
    ...opcionales.filter(([, t]) => existentes.has(t)).map(([k, t, r]) => [k, `'${t}'!${r}`] as [keyof DatosEOD, string]),
  ]
  const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: pedidos.map(p => p[1]), valueRenderOption: 'UNFORMATTED_VALUE' })
  const datos: DatosEOD = { agendas: [], calendarios: [], outbound: [], agendasHistorias: [], resumen: [] }
  pedidos.forEach(([k], i) => { datos[k] = (r.data.valueRanges?.[i]?.values ?? []) as Celda[][] })
  return datos
}

// EOD de una fecha: el snapshot congelado si existe; si no, se calcula con los datos actuales
export async function calcularEOD(fecha = hoyYMD()): Promise<{ eod: EOD; congelado: boolean }> {
  const datos = await leerDatos()
  const c = snapshotCongelado(datos.resumen, fecha)
  return c ? { eod: c, congelado: true } : { eod: calcularDesdeFilas(datos, fecha), congelado: false }
}

// Guarda el snapshot del día en "Resumen EOD Maite" (crea pestaña/encabezado si hace falta). Un día ya congelado NO se sobrescribe.
// Fila legada (sin JSON) → se completa A:G/I/J conservando G y H. Lanza si no se pudo guardar (el llamador no debe enviar).
export async function registrarEOD(e: EOD): Promise<{ congelado: boolean; yaEnviadoDiscord?: string }> {
  const sheets = cliente()
  if (!sheets) throw new Error('sin credenciales de Sheets')
  const id = process.env.SHEET_ID_VENTAS!
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' })
  if (!(meta.data.sheets ?? []).some(s => s.properties?.title === PESTANAS.resumen)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: PESTANAS.resumen, gridProperties: { frozenRowCount: 1 } } } }] } })
      .catch(err => { if (!/already exists/i.test(String(err?.message))) throw err })
  }
  const actual = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${PESTANAS.resumen}'!A:J`, valueRenderOption: 'UNFORMATTED_VALUE' })
  const filas = (actual.data.values ?? []) as Celda[][]
  if (String(filas[0]?.[0] ?? '') !== HEADER_RESUMEN[0] || String(filas[0]?.[9] ?? '') !== HEADER_RESUMEN[9])
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `'${PESTANAS.resumen}'!A1:J1`, valueInputOption: 'RAW', requestBody: { values: [HEADER_RESUMEN] } })
  const idx = filas.findIndex((r, i) => i > 0 && ymdDeCelda(r[0]) === e.fecha)
  const previa = idx > 0 ? filas[idx] : []
  if (previa[9] && String(previa[9]).trim()) return { congelado: true, yaEnviadoDiscord: String(previa[7] ?? '') || undefined }
  const json = JSON.stringify(e)
  if (json.length > 45_000) throw new Error('snapshot demasiado grande para una celda')
  const pct = e.setterDia.pct === null || e.setterDia.asignados === null ? `sin dato (${e.setterDia.motivo ?? 'sin fuente'})` : `${pctFmt(e.setterDia.pct)} (${e.setterDia.agendas}/${e.setterDia.asignados})`
  const base = previa[6] !== undefined && previa[6] !== '' ? previa[6] : e.filasOutbound
  const fila = [
    ddmmyyyy(e.fecha), e.agendas.length, e.calendarios, pct,
    e.aperturasHistorias === null ? 'sin dato' : e.aperturasHistorias, e.etiquetaHistorias.length, base, previa[7] ?? '', new Date().toISOString(), json,
  ]
  if (idx > 0) await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `'${PESTANAS.resumen}'!A${idx + 1}:J${idx + 1}`, valueInputOption: 'RAW', requestBody: { values: [fila] } })
  else await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `'${PESTANAS.resumen}'!A:J`, valueInputOption: 'RAW', requestBody: { values: [fila] } })
  return { congelado: false, yaEnviadoDiscord: String(previa[7] ?? '') || undefined }
}

// Anota en la fila del día los ids de mensaje de Discord (espejo legible del lock)
export async function marcarEnviadoEOD(fecha: string, ids: string[]): Promise<void> {
  const sheets = cliente()
  if (!sheets) return
  const id = process.env.SHEET_ID_VENTAS!
  const actual = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${PESTANAS.resumen}'!A:A`, valueRenderOption: 'UNFORMATTED_VALUE' })
  const idx = (actual.data.values ?? []).findIndex((r, i) => i > 0 && ymdDeCelda(r[0] as Celda) === fecha)
  if (idx > 0) await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `'${PESTANAS.resumen}'!H${idx + 1}`, valueInputOption: 'RAW', requestBody: { values: [[ids.join(',')]] } })
}

// ids de Discord ya registrados para esa fecha en el Resumen (envíos previos / espejo del lock)
export async function enviadoPrevioEOD(fecha: string): Promise<string | undefined> {
  const datos = await leerDatos()
  const fila = datos.resumen.find(r => ymdDeCelda(r[0]) === fecha)
  const h = String(fila?.[7] ?? '').trim()
  return h || undefined
}

// Crea (si no existen) las pestañas auxiliares: "Historias publicadas" (esquema de atribución) y "EOD Locks"
export async function asegurarPestanasAuxiliares(): Promise<string[]> {
  const sheets = cliente()
  if (!sheets) throw new Error('sin credenciales de Sheets')
  const id = process.env.SHEET_ID_VENTAS!
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' })
  const existentes = new Set((meta.data.sheets ?? []).map(s => s.properties?.title))
  const creadas: string[] = []
  for (const [tab, header] of [[PESTANAS.historias, HEADER_HISTORIAS], [PESTANAS.locks, HEADER_LOCKS], [PESTANAS.config, HEADER_CONFIG]] as const) {
    if (existentes.has(tab)) {
      const hdr = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A1:${String.fromCharCode(64 + header.length)}1` })).data.values?.[0] ?? []
      if (header.some((h, i) => hdr[i] !== h)) await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [[...header]] } })
      continue
    }
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] } })
      .catch(err => { if (!/already exists/i.test(String(err?.message))) throw err })
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [[...header]] } })
    creadas.push(tab)
  }
  return creadas
}

const conArroba = (c: ContactoEOD) => c.nombre ? (c.usuario ? `${c.nombre} (@${c.usuario})` : c.nombre) : c.usuario ? `@${c.usuario}` : 'sin nombre'
const corto = (ymd: string) => new Date(`${ymd}T15:00:00Z`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', timeZone: TZ }).replace('.', '')
export const pctFmt = (x: number) => `${(x * 100).toFixed(2).replace('.', ',')}%`   // 2 decimales: 1/41 = 2,44% (no 2%)
const pctTxt = (p: PctSetter, etiqueta: string) => p.pct !== null && p.asignados !== null ? `${etiqueta} ${p.agendas}/${p.asignados} = ${pctFmt(p.pct)}` : `${etiqueta} **sin dato** _(${p.motivo ?? 'sin fuente'})_`

export function textoEOD(e: EOD): string[] {
  const fechaLarga = new Date(`${e.fecha}T15:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
  if (e.sinRegistros) return [`📊 **EOD MAITE — ${fechaLarga}**\n• **Sin dato** _(${e.sinRegistros})_`]
  const aper = e.aperturasHistorias !== null
    ? `**${e.aperturasHistorias}**${e.aperturasModo === 'fecha' ? ' _(por fecha de la fila)_' : ''}${e.aperturasNota ? ` _(${e.aperturasNota})_` : ''}`
    : `**sin dato del día** _(${e.aperturasNota ?? 'sin base'}; ${e.filasOutbound} filas con la etiqueta${e.outboundSinFecha ? `, ${e.outboundSinFecha} sin fecha` : ''})_`
  const lineas = [
    `📊 **EOD MAITE — ${fechaLarga}**`,
    `• Agendas del día (botonera): **${e.agendas.length}**`,
    `• Calendarios enviados: **${e.calendarios}**`,
    `• % agenda setter (agendas Mai ÷ chats asignados ManyChat): ${pctTxt(e.setterDia, 'día')} · ${pctTxt(e.setterMes, 'mes')}`,
    e.aperturasModo === 'campo-outbound'
      ? `• Outbound en historias (contactos con el campo OUTBOUND Historia x Día de hoy): ${aper}`
      : e.aperturasModo === 'campo'
        ? `• Recursos enviados por outbound de historias (campo Recurso OUTBOUND): ${aper}`
        : `• Aperturas de historias (outbound_historias): ${aper}`,
    ...(e.aperturasModo === 'campo-outbound' && e.recursosEnviados !== undefined ? [`• Recursos enviados (respuestas al outbound; campo Recurso OUTBOUND): **${e.recursosEnviados}**`] : []),
    `• Contactos con etiqueta de historias (mensual): **${e.etiquetaHistorias.length}** _(referencial: NO es origen verificado ni mide atribución por historia ni D+1)_`,
  ]
  for (const h of e.atribucion.items)
    lineas.push(`• Historia ${h.id} (${h.etiqueta}, publicada ${ddmmyyyy(h.fechaPub)}) → agendas D+1: ${h.agendasD1 === null ? `**sin medir** (${h.motivo ?? 'cobertura no garantizada'})` : `**${h.agendasD1}**`}`)
  const partes = [lineas.join('\n')]
  if (e.agendas.length) {
    const lista = e.agendas.slice(0, 20).map(c => `• ${conArroba(c)}${e.etiquetaHistorias.some(h => h.id ? h.id === c.id : h.nombre === c.nombre && h.usuario === c.usuario) ? ' · 📲 etiqueta historias' : ''}`)
    if (e.agendas.length > 20) lista.push(`• … y ${e.agendas.length - 20} más`)
    partes.push(`📅 **Agendó hoy**\n${lista.join('\n')}`)
  }
  const conOb = e.serie.some(d => d.outbound !== undefined)
  const dias = e.serie.map(d => d.sinDato ? `${corto(d.fecha)}: s/d` : `${corto(d.fecha)}: ${d.agendas}/${d.calendarios}${conOb ? `/${d.outbound === null ? '–' : (d.outbound ?? 0)}` : ''}`).join(' · ')
  const m = e.mes
  partes.push([
    `📆 **Acumulado del mes (${m.desde.slice(8)}/${m.desde.slice(5, 7)} → ${e.fecha.slice(8)}/${e.fecha.slice(5, 7)})**: ${m.agendas} agendas · ${m.calendarios} calendarios${m.outbound !== undefined ? (e.aperturasModo === 'campo-outbound' ? ` · ${m.outbound} outbound en historias${m.recursos !== undefined ? ` · ${m.recursos} recursos enviados` : ''}` : ` · ${m.outbound} recursos de outbound enviados`) : ''}`,
    `🗓 **Últimos 7 días (agendas/calendarios${conOb ? (e.aperturasModo === 'campo-outbound' ? '/outbound' : '/recursos outbound') : ''})**: ${dias}`,
  ].join('\n'))
  if (e.avisos.length) partes.push(`⚠️ ${e.avisos.join(' · ')}`)
  if (!e.agendas.length && !e.calendarios && e.aperturasHistorias === 0)
    partes.push('⚠️ Hoy no llegó ningún registro de ManyChat: revisar que se estén cargando los campos AGENDA POR DÍA / CALENDARIOS POR DÍA / OUTBOUND Historia x Día.')
  return partes
}
