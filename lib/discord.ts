// ── Discord: resumen diario de seguimientos + recordatorios ─────────────
import type { RawData } from './rawSheets'
import type { LlamadaCalendly, AgendaCalendly, RoutingPerdidos } from './calendly'
import { urlSheetEnrutamiento, type RegistroDia, type FilaFormulario, type FilaNoShow, type FilaLeadIG, type FilaResumen } from './enrutamientoSheet'

const TZ = 'America/Argentina/Buenos_Aires'
const fmtUSD = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
// Instante real ("ahora"): todos los formatters de abajo aplican timeZone AR, así que NO hay
// que convertir antes (hacerlo dos veces imprimía 17:30 en Vercel para las 20:30 AR).
const hoyAR = () => new Date()
const fechaLarga = (d: Date) => d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
const hora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const diaCorto = (d: Date) => d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', timeZone: TZ })
const TZ_YMD = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })          // instante → "YYYY-MM-DD" en AR

// ── Campos nuevos de /api/raw que usa el resumen (se leen defensivos: un RawData viejo no los trae) ──
interface ClienteCRMV { nombre: string; estado: string; dia1: string | null }   // Agencia, dia1 'YYYY-MM-DD'
type RawResumen = RawData & { clientesCRM?: ClienteCRMV[] }
type GrabacionV = RawData['grabaciones'][number] & { inactiva?: boolean }
type VencidoV = RawData['alertas']['vencidos'][number] & { llamadaPasada?: boolean }
type CuentaMetaV = RawData['alertas']['metaClientes']['cuentas'][number] & { sinCliente?: boolean }
// Nota de la col E de guiones que saca al cliente del seguimiento (si /api/raw no trae `inactiva`)
const NOTA_INACTIVA = /no\s+mandar|no\s+grabar|pausa|\bbaja\b/i
const normN = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens4 = (x: string) => normN(x).split(' ').filter(t => t.length >= 4)
// Clientes del CRM (Agencia) con estado y Día 1; con un /api/raw viejo, solo los nombres
const clientesDe = (raw: RawData): ClienteCRMV[] =>
  (raw as RawResumen).clientesCRM ?? (raw.clientesNombres ?? []).map(nombre => ({ nombre, estado: '', dia1: null }))
// "Agendada (10/9)" → "10/9"; si no hay fecha, el texto tal cual
const fechaDeTexto = (t: string) => t.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)?.[0] ?? t
// Fecha de un recordatorio ('dd/mm/yyyy', 'd/m/yyyy' o 'YYYY-MM-DD') → 'YYYY-MM-DD'; null si no se entiende
const ymdRecordatorio = (f: string): string | null => {
  const t = f.trim()
  let x = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (x) return `${x[1]}-${x[2]}-${x[3]}`
  x = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (x) return `${x[3].length === 2 ? `20${x[3]}` : x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}`
  return null
}

// Arma el resumen del día. Devuelve secciones (cada una cabe en un mensaje de Discord).
// `ahora` es opcional (por defecto el instante real) para poder probarlo con una fecha fija.
export function buildResumenDiario(raw: RawData, llamadas: LlamadaCalendly[], ahora: Date = hoyAR()): string[] {
  const a = raw.alertas
  const hoy = ahora
  const hoyYmd = TZ_YMD(hoy)
  const partes: string[] = []
  const sec = (titulo: string, lineas: string[], vacio?: string) => {
    if (!lineas.length) { if (vacio) partes.push(`${titulo}\n${vacio}`); return }
    partes.push(`${titulo}\n${lineas.join('\n')}`)
  }

  partes.push(`📋 **RESUMEN DIARIO SKWD — ${fechaLarga(hoy)}**`)

  // 1) Cobros de hoy + vencidos
  const cobrosHoy = a.pagosPendientes.filter(p => p.dias <= 0)
  sec(`💰 **Cobrar HOY / vencidos** (${cobrosHoy.length})`,
    cobrosHoy.map(p => `• ${p.nombre} — ${fmtUSD(p.saldo)}${p.dias < 0 ? ` · venció ${p.fecha}` : ' · HOY'}`),
    '• Nada para cobrar hoy ✅')
  const proximos = a.pagosPendientes.filter(p => p.dias > 0 && p.dias <= 3)
  if (proximos.length) sec(`💵 **Cobros en los próximos 3 días** (${proximos.length})`,
    proximos.map(p => `• ${p.nombre} — ${fmtUSD(p.saldo)} · ${p.fecha}`))

  // 2) Vencimientos. La col U con una fecha ya pasada no es "llamada agendada": la llamada fue y
  // falta cargar el resultado (renovó / se da de baja).
  const vencidos = a.vencidos as VencidoV[]
  const vencSin = vencidos.filter(v => !v.llamada)
  const vencPasada = vencidos.filter(v => v.llamada && v.llamadaPasada)
  const vencCon = vencidos.filter(v => v.llamada && !v.llamadaPasada)
  sec(`🔴 **Programa vencido SIN llamada** (${vencSin.length})`,
    vencSin.map(v => `• ${v.nombre} — hace ${v.dias}d`), '• Ninguno ✅')
  if (vencPasada.length) sec(`🟠 **Vencidos con llamada hecha, sin resultado cargado** (${vencPasada.length})`,
    vencPasada.map(v => `• ${v.nombre} — hace ${v.dias}d · 📞 llamada del ${fechaDeTexto(v.llamada!)} sin resultado`))
  if (vencCon.length) sec(`🟠 **Vencidos con llamada agendada** (${vencCon.length})`,
    vencCon.map(v => `• ${v.nombre} — 📞 ${v.llamada}`))
  sec(`🟡 **Por vencer ≤14 días** (${a.porVencer.length}) — agendar proyección`,
    a.porVencer.map(v => `• ${v.nombre} — vence ${v.fecha} (${v.dias}d)${v.llamada ? ` · 📞 ${v.llamada}` : ''}`),
    '• Nadie vence en 2 semanas ✅')
  const finSin = a.finalizados.filter(f => !f.llamada)
  if (finSin.length) sec(`📞 **Finalizados sin llamada de proyección** (${finSin.length})`,
    finSin.map(f => `• ${f.nombre} — finalizó ${f.fin}`))

  // 3) Calendly — separado: kick-offs (clientes nuevos) vs proyección/renovación vs otras
  const conCal = !!process.env.CALENDLY_TOKEN
  // Regla del usuario (7-sep): un "KickOff" agendado por alguien que YA es cliente es una llamada de
  // proyección. Pero el equipo carga al cliente nuevo en el CRM ANTES del kickoff, así que "ya es
  // cliente" = está en el CRM y NO es nuevo: su Día 1 tiene más de 30 días (o no tiene Día 1) y no
  // está en producción en ClickUp (onboarding, en espera de tópicos, …).
  const idxClientes = clientesDe(raw).map(c => ({ c, t: tokens4(c.nombre) }))
  const clienteDe = (nombre: string): ClienteCRMV | null => {
    const t = tokens4(nombre)
    if (t.length < 2) return null
    const hits = idxClientes.filter(x => t.filter(y => x.t.includes(y)).length >= 2).map(x => x.c)   // nombre + apellido en común
    return hits.sort((x, y) => (y.dia1 ?? '').localeCompare(x.dia1 ?? ''))[0] ?? null               // el período más reciente
  }
  const tokensProduccion = a.onboarding.map(o => tokens4(o.nombre))
  const enProduccion = (nombre: string) => { const t = tokens4(nombre); return t.length >= 2 && tokensProduccion.some(pt => t.filter(x => pt.includes(x)).length >= 2) }
  const hace30 = TZ_YMD(new Date(hoy.getTime() - 30 * 86_400_000))
  const yaEsCliente = (l: LlamadaCalendly) => {
    const c = clienteDe(l.invitado)
    if (!c) return false
    const nuevo = (c.dia1 != null && c.dia1 >= hace30) || enProduccion(l.invitado) || enProduccion(c.nombre)
    return !nuevo
  }
  // Si la llamada coincide en día y hora con una llamada anotada en el CRM (col U de un cliente que vence),
  // es la proyección/renovación de ESE cliente aunque en Calendly haya agendado con otro nombre o mail
  // (ej.: "Nati y Cin Vais" con otro correo = "Natalia Magali Daniel & Cinthia", 29-sep).
  const conLlamadaCRM = [...(a.porVencer as { nombre: string; llamada: string | null }[]), ...(a.vencidos as VencidoV[])]
    .filter(v => v.llamada)
  const clienteCRMdeLlamada = (l: LlamadaCalendly): string | null => {
    const [d, m] = l.inicio.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: TZ }).split('/')
    const hh = hora(l.inicio)
    const fecha = new RegExp(`(^|\\D)0?${d}/0?${m}(\\D|$)`)
    const hit = conLlamadaCRM.find(v => fecha.test(v.llamada!) && v.llamada!.includes(hh))
    return hit ? hit.nombre : null
  }
  const esKick = (l: LlamadaCalendly) => /kick/i.test(l.evento) && !yaEsCliente(l) && !clienteCRMdeLlamada(l)
  const esProy = (l: LlamadaCalendly) => /proyecci|renovaci/i.test(l.evento) || (/kick/i.test(l.evento) && (yaEsCliente(l) || !!clienteCRMdeLlamada(l)))
  const kicks = llamadas.filter(esKick), proys = llamadas.filter(esProy), otras = llamadas.filter(l => !esKick(l) && !esProy(l))
  const linea = (l: LlamadaCalendly) => {
    const crm = clienteCRMdeLlamada(l)
    return `• ${diaCorto(l.inicio)} ${hora(l.inicio)} — ${crm ?? l.invitado}` +
      (esKick(l) || esProy(l) ? (/kick/i.test(l.evento) && (crm || yaEsCliente(l)) ? ' _(agendada como KickOff, pero ya es cliente)_' : '') : ` (${l.evento})`)
  }
  if (!conCal) sec('📅 **Llamadas próximas (Calendly, 48h)**', [], '• (Calendly no conectado todavía)')
  else if (!llamadas.length) sec('📅 **Llamadas próximas (Calendly, 48h)**', [], '• Sin llamadas agendadas en 48h')
  else {
    if (kicks.length) sec(`🚀 **Kick-offs — clientes nuevos (48h)** (${kicks.length})`, kicks.map(linea))
    if (proys.length) sec(`📞 **Llamadas de proyección / renovación (48h)** (${proys.length})`, proys.map(linea))
    if (otras.length) sec(`📅 **Otras llamadas (48h)** (${otras.length})`, otras.map(linea))
  }

  // 4) Meta — errores de pago / deshabilitadas, más viejas primero
  const m = a.metaClientes
  if (m.disponible) {
    const cuentas = m.cuentas as CuentaMetaV[]
    const prob = cuentas
      .filter(c => (c.estado === 'error_pago' && !c.pausadoCRM) || c.estado === 'deshabilitada')
      .sort((x, y) => (y.diasSinCorrer ?? -1) - (x.diasSinCorrer ?? -1))
    sec(`💳 **Meta — errores de pago / deshabilitadas** (${prob.length})`,
      prob.map(c => `• ${c.nombre} — ${c.estado === 'deshabilitada' ? '🚫 deshabilitada' : '💳 error de pago'}${c.diasSinCorrer == null ? ' · ⚠️ sigue corriendo' : ` · ${c.diasSinCorrer >= 90 ? '90+' : c.diasSinCorrer}d sin correr`}`),
      '• Todas las cuentas al día ✅')
    // Mismo criterio que el panel: fuera los clientes en pausa (CRM) y las cuentas sin cliente asociado.
    // El total se cuenta ANTES de recortar la lista ("8 de 19").
    const frenadasTodas = cuentas.filter(c => c.estado === 'activa' && !c.sinDatos && !c.enOnboarding && !c.pausadoCRM && !c.sinCliente && c.diasSinCorrer != null && c.diasSinCorrer >= 7)
      .sort((x, y) => (y.diasSinCorrer ?? 0) - (x.diasSinCorrer ?? 0))
    const frenadas = frenadasTodas.slice(0, 8)
    if (frenadas.length) sec(`⏸ **Cuentas frenadas ≥7 días** (${frenadasTodas.length > frenadas.length ? `${frenadas.length} de ${frenadasTodas.length}` : frenadas.length})`,
      frenadas.map(c => `• ${c.nombre} — ${c.diasSinCorrer! >= 90 ? '90+' : c.diasSinCorrer}d sin correr`))
  }

  // 5) Grabaciones / onboarding. Las filas "inactivas" (nota "no mandar", "pausa", "baja"…) no se siguen.
  const grab = (raw.grabaciones as GrabacionV[]).filter(g => !(g.inactiva ?? NOTA_INACTIVA.test(g.nota ?? '')))
  const atrasTodas = grab.filter(g => g.diasDesdeGrabacion != null && g.diasDesdeGrabacion > 30)
    .sort((x, y) => (y.diasDesdeGrabacion ?? 0) - (x.diasDesdeGrabacion ?? 0))
  // Guiones listos hace más de 14 días sin grabar (con la grabación ya agendada no hay nada que coordinar)
  const esperandoTodos = grab.filter(g => g.guionesListos && (g.diasEsperando ?? 0) > 14 && !/^agendada/i.test(g.nota ?? ''))
    .sort((x, y) => (y.diasEsperando ?? 0) - (x.diasEsperando ?? 0))
  const nunca = grab.filter(g => !g.grabado && g.diasDesdeGrabacion == null).length
  const hasta = (n: number, total: number) => total > n ? `${n} de ${total}` : `${total}`
  sec(`🎥 **Grabaciones** — ${hasta(Math.min(10, atrasTodas.length), atrasTodas.length)} atrasadas +30d · ${hasta(Math.min(10, esperandoTodos.length), esperandoTodos.length)} con guiones listos +14d${nunca ? ` · ${nunca} sin grabación registrada` : ''}`,
    [
      ...atrasTodas.slice(0, 10).map(g => `• ${g.cliente} — ${g.diasDesdeGrabacion}d sin grabar${g.fechaAproximada ? ' (aprox.)' : ''}`),
      ...esperandoTodos.slice(0, 10).map(g => `• ${g.cliente} — 📝 guiones listos hace ${g.diasEsperando}d, falta grabar${g.aliasSinResolver ? ' _(alias sin resolver en "Alias Guiones")_' : ''}`),
    ],
    '• Nada atrasado ✅')
  const onb = a.onboarding.slice(0, 6)
  sec(`🎬 **Onboarding — más demorados** (${a.onboarding.length} en producción)`,
    onb.map(c => `• ${c.nombre} — ${c.dias}d · ${c.status}`), '• Nadie en producción')

  // 6) Recordatorios manuales (pestaña "Recordatorios" del CRM, hasta marcarlos HECHO): solo los que ya
  // tocan (fecha ≤ hoy o sin fecha). Los de fecha futura aparecen el día que corresponde.
  const recFecha = raw.recordatorios.map(r => ({ r, ymd: r.fecha ? ymdRecordatorio(r.fecha) : null }))
  const recHoy = recFecha.filter(x => x.ymd == null || x.ymd <= hoyYmd).map(x => x.r)
  const recFuturos = recFecha.length - recHoy.length
  if (recHoy.length) sec(`📌 **Recordatorios pendientes** (${recHoy.length})${recFuturos ? ` · ${recFuturos} programado${recFuturos > 1 ? 's' : ''} para más adelante` : ''}`,
    recHoy.map(r => `• ${r.texto}${r.fecha ? ` _(${r.fecha})_` : ''}`))

  partes.push(`🔗 Dashboard: https://dashboard-metricas-eight.vercel.app`)
  return partes
}

export function buildRecordatorioFormularios(): string[] {
  const hoy = hoyAR()
  return [
    `📝 **RECORDATORIO — ${fechaLarga(hoy)}**\n` +
    `Hoy toca el **seguimiento de envío de formularios** a los clientes (se hace los días 1 y 15 de cada mes).\n` +
    `• Enviar los formularios a los clientes activos\n` +
    `• Registrar quién respondió y quién no, y hacer FUP a los que no\n` +
    process.env.SHEET_ID_CLIENTES ? `🔗 CRM: https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID_CLIENTES}` : 'CRM sin configurar',
  ]
}

// ── Reporte "Enrutamientos perdidos" (20:30 AR, canal aparte) ───────────
// Lo que se cayó del embudo HOY: leads que no llegaron al setter, agendas canceladas,
// reservas de Calendly que no aparecen en la hoja del closer, reservas sin closer,
// no-shows y llamadas ocurridas sin registrar. Arriba, una línea de contexto.
const NAIVE_YMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`  // fecha naive de los sheets
const tokensNombre = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t.length >= 3)

// Devuelve el texto para Discord + las filas para el sheet "Enrutamientos perdidos" / "Resumen enrutamiento".
// El reporte es del DÍA ANTERIOR (raw.enrutamiento.dia); `cal` son las reservas/cancelaciones de ese día
// y `proximas` las llamadas de Calendly de hoy (para cruzar con lo cargado en hojas).
export function armarEnrutamientosPerdidos(
  raw: RawData, cal: { creadas: AgendaCalendly[]; canceladas: AgendaCalendly[] }, proximas: LlamadaCalendly[], routing: RoutingPerdidos,
): { partes: string[]; registro: RegistroDia } {
  const e = raw.enrutamiento
  const hoy = hoyAR()
  const [dy, dm, dd] = e.dia.split('-').map(Number)
  const diaDate = new Date(dy, dm - 1, dd, 12)                       // mediodía naive para formatear sin cruzar de día
  const fechaDia = `${String(dd).padStart(2, '0')}/${String(dm).padStart(2, '0')}/${dy}`
  const diaLargo = diaDate.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const partes: string[] = []
  const formularios: FilaFormulario[] = []
  const noShowsSheet: FilaNoShow[] = []
  const leadsIGSheet: FilaLeadIG[] = []
  const tel = (t?: string) => t ? ` · 📱 ${t}` : ''
  const n = (v: number) => v.toLocaleString('es-AR')
  const pctDe = (a: number, b: number) => b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
  const cuenta = (arr: { closer?: string }[]) => {
    const m: Record<string, number> = {}
    for (const x of arr) { const k = x.closer || 'sin closer'; m[k] = (m[k] ?? 0) + 1 }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')
  }
  // Calendly tiene un solo usuario (el dueño del token), así que el closer NO sale de Calendly:
  // el enrutamiento real es en qué hoja de closer quedó cargada la reserva (mismo día + nombre en común).
  const linea = (c: AgendaCalendly) => `• ${diaCorto(c.inicio)} ${hora(c.inicio)} — ${c.invitado} _(${c.evento})_`
  const quienAgendo = (s: string) => s === 'setter' ? 'Maite' : s === 'ig' ? 'IG auto' : s === 'fb' ? 'FB' : 'sin setter'
  const closerDeReserva = (a: AgendaCalendly): string | null => {
    const dia = TZ_YMD(a.inicio), t = tokensNombre(a.invitado)
    if (!t.length) return '?'
    const c = raw.calls.find(x => NAIVE_YMD(x.date) === dia && tokensNombre(x.lead).filter(y => t.includes(y)).length >= Math.min(2, t.length))
    return c ? c.closer : null
  }
  // Solo llamadas de VENTA: las de proyección/renovación/kick-off y las de clientes que ya están
  // en el CRM no van a la hoja de ningún closer, así que no cuentan como "sin cargar".
  const tokensClientes = clientesDe(raw).map(c => tokensNombre(c.nombre).filter(t => t.length >= 4))
  const esCliente = (nombre: string) => { const t = tokensNombre(nombre).filter(x => x.length >= 4); return t.length >= 2 && tokensClientes.some(ct => t.filter(x => ct.includes(x)).length >= 2) }
  const esVenta = (l: LlamadaCalendly) => !/proyecci|renovaci|kick/i.test(l.evento) && !esCliente(l.invitado)
  const conCal = !!process.env.CALENDLY_TOKEN
  const total = e.llamadas.total
  const ruteo = conCal ? cal.creadas.filter(esVenta).map(a => ({ a, closer: closerDeReserva(a) })) : []
  const noCargadas = ruteo.filter(r => r.closer === null).map(r => r.a)
  const porHoja = cuenta(ruteo.map(r => ({ closer: r.closer ?? 'sin cargar' })))
  const noShows = e.llamadas.lista.filter(l => l.estado === 'no-show')
  const sinRegistro = e.llamadas.lista.filter(l => l.estado === 'sin registro')
  const presentadas = e.llamadas.lista.filter(l => l.estado === 'presentada' || l.estado === 'cerrada')
  const cierres = e.llamadas.lista.filter(l => l.estado === 'cerrada')
  const noAsig = e.noAsignados
  const perdidas = noAsig.total + routing.perdidos.length + cal.canceladas.length + noCargadas.length + noShows.length + sinRegistro.length
  const pctSetterMes = e.tasaAgendaSetterMes == null ? '—' : (e.tasaAgendaSetterMes * 100).toFixed(1) + '%'

  partes.push(`🕳 **ENRUTAMIENTOS PERDIDOS — ${diaLargo}** _(reporte de la mañana del ${diaCorto(hoy)})_\n` +
    `• Leads IG: **${n(e.leadsIG.dia)}** (día anterior ${n(e.leadsIG.previo)} · mes ${n(e.leadsIG.mes)})\n` +
    `• Asignados a Maite: **${n(e.asignados.dia)}** (${pctDe(e.asignados.dia, e.leadsIG.dia)} de los leads · mes ${n(e.asignados.mes)})\n` +
    `• Agendas de Maite: **${n(e.agendasSetterDia)}** llamadas del día agendadas por ella · **% agenda del setter (mes): ${pctSetterMes}** (${n(e.agendasSetterMes)} / ${n(e.asignados.mes)})\n` +
    (conCal ? `• Reservas en Calendly: **${cal.creadas.length}**${ruteo.length ? ` → ${porHoja}` : ''}\n` : '') +
    `• Llamadas del día: **${total}**${total ? ` (${Object.entries(e.llamadas.porCloser).map(([c, p]) => `${c} ${p.agendadas}`).join(' · ')}) · ${presentadas.length} presentadas · ${noShows.length} no-show` : ''}` +
    (cierres.length ? ` · **${cierres.length} cierre${cierres.length > 1 ? 's' : ''}** 🎉` : ''))

  if (!perdidas) partes.push(`✅ **Nada perdido** — todo lo que entró está asignado, cargado y registrado.`)

  // 1) ENRUTAMIENTOS PERDIDOS (definición del usuario): completó el formulario de Calendly y no agendó
  if (!routing.disponible)
    partes.push(`🧭 **Formularios completados sin agendar (Calendly)**: sin acceso — Calendly devolvió error o el token no es admin de la organización`)
  else if (!routing.formularios)
    partes.push(`🧭 **Formularios completados sin agendar (Calendly)**: la cuenta conectada no tiene formularios (Routing Forms) — falta el token de la cuenta de ventas (CALENDLY_VENTAS_TOKEN)`)
  else if (!routing.perdidos.length)
    partes.push(`🧭 **Formularios completados sin agendar (Calendly): 0** ✅`)
  else {
    partes.push(`🧭 **Formularios completados sin agendar (Calendly): ${routing.perdidos.length}** — llenaron el formulario y no reservaron\n` +
      routing.perdidos.slice(0, 30).map(f => `• ${hora(f.creada)} ${f.nombre}${tel(f.telefono)}${f.email ? ` · ${f.email}` : ''} · ${f.ruta}`).join('\n') +
      (routing.perdidos.length > 30 ? `\n• … y ${routing.perdidos.length - 30} más en el sheet` : '') + `\n• Contactarlos hoy (están en el sheet con teléfono)` +
      (routing.yaAgendaron ? `\n• _(se excluyeron ${routing.yaAgendaron} que completaron el formulario y después sí agendaron)_` : ''))
  }
  for (const f of routing.perdidos) formularios.push({ fecha: fechaDia, nombre: f.nombre, telefono: f.telefono, email: f.email, formulario: f.formulario, detalle: `Completó el formulario ${hora(f.creada)} y no agendó · ${f.ruta}` })

  // 2) NO-SHOWS y 3) leads de IG sin asignar: por pedido del usuario (10/9) NO van en el mensaje de
  // Discord (ni las canceladas); los no-shows y los leads con @ sí quedan en sus pestañas del sheet
  // para el seguimiento.
  for (const l of noShows) noShowsSheet.push({ fecha: fechaDia, hora: l.hora, nombre: l.lead, telefono: l.telefono, closer: l.closer, agendo: quienAgendo(l.setter), detalle: 'No se presentó a la llamada' })
  for (const l of noAsig.identificados) leadsIGSheet.push({ fecha: fechaDia, nombre: l.nombre, usuario: l.usuario })

  // 4) Cosas de operación de los closers (solo Discord)
  if (noCargadas.length)
    partes.push(`📋 **Reservadas y NO cargadas en ninguna hoja de closer: ${noCargadas.length}**\n` +
      noCargadas.map(c => `${linea(c)}${tel(c.telefono)}${c.closer ? ` → ${c.closer} (según Calendly)` : ''}`).join('\n') + `\n• Sin cargar no cuentan en el dashboard ni en el seguimiento`)

  if (sinRegistro.length)
    partes.push(`📝 **Llamadas sin registrar (¿se presentó? vacío): ${sinRegistro.length}**\n` +
      sinRegistro.map(l => `• ${l.hora} ${l.lead} (${l.closer})`).join('\n') + `\n• Completar "¿Se presentó Agenda 1?" y "Situación del Lead"`)

  // HOY: reservas en Calendly vs lo que ya está cargado en las hojas de closers (por closer)
  const ymdHoy = TZ_YMD(hoy)
  const cargadasHoy = raw.calls.filter(c => NAIVE_YMD(c.date) === ymdHoy)
  const porCloserHoy = cuenta(cargadasHoy.map(c => ({ closer: c.closer })))
  if (conCal) {
    const deHoy = proximas.filter(l => TZ_YMD(l.inicio) === ymdHoy)
    const faltan = deHoy.filter(esVenta).filter(l => !cargadasHoy.some(c => { const t = tokensNombre(l.invitado); return t.length && tokensNombre(c.lead).filter(y => t.includes(y)).length >= Math.min(2, t.length) }))
    partes.push(`📆 **Hoy: ${deHoy.length} en Calendly · ${cargadasHoy.length} en hojas${cargadasHoy.length ? ` (${porCloserHoy})` : ''}**` +
      (faltan.length ? `\n⚠️ En Calendly pero sin hoja: ${faltan.map(l => `${hora(l.inicio)} ${l.invitado}`).join(' · ')}` : ''))
  } else if (cargadasHoy.length) {
    partes.push(`📆 **Hoy: ${cargadasHoy.length} llamadas en hojas** (${porCloserHoy})`)
  }

  const sheet = urlSheetEnrutamiento()
  partes.push(`🔗 Dashboard: https://dashboard-metricas-eight.vercel.app` + (sheet ? `\n📄 Sheet (pestañas "Enrutamientos perdidos", "No-shows", "Leads IG sin asignar"): ${sheet}` : ''))

  const resumen: FilaResumen = {
    fecha: fechaDia, leadsIG: e.leadsIG.dia, asignados: e.asignados.dia, pctAsignados: pctDe(e.asignados.dia, e.leadsIG.dia), noAsignados: noAsig.total,
    formulariosSinAgendar: routing.perdidos.length,
    agendasMaite: e.agendasSetterDia, reservasCalendly: conCal ? cal.creadas.length : 0, llamadas: total, presentadas: presentadas.length,
    noShows: noShows.length, sinRegistrar: sinRegistro.length, cierres: cierres.length, pctAgendaSetterMes: pctSetterMes,
  }
  return { partes, registro: { formularios, noShows: noShowsSheet, leadsIG: leadsIGSheet, resumen } }
}

export const buildReporteEnrutamientosPerdidos = (
  raw: RawData, cal: { creadas: AgendaCalendly[]; canceladas: AgendaCalendly[] }, proximas: LlamadaCalendly[], routing: RoutingPerdidos,
): string[] => armarEnrutamientosPerdidos(raw, cal, proximas, routing).partes

// Envía a Discord por webhook. Junta secciones hasta ~1900 chars por mensaje (límite 2000).
// webhookUrl opcional para mandar a otro canal (por defecto DISCORD_WEBHOOK_URL = #alertas-dashboard).
export async function sendDiscord(partes: string[], webhookUrl?: string): Promise<{ enviado: boolean; mensajes: number; error?: string; ids?: string[]; rechazo?: boolean; ambiguo?: boolean }> {
  const url = webhookUrl || process.env.DISCORD_WEBHOOK_URL
  if (!url) return { enviado: false, mensajes: 0, error: 'DISCORD_WEBHOOK_URL no configurado' }
  const mensajes: string[] = []
  let actual = ''
  for (const p of partes) {
    if ((actual + '\n\n' + p).length > 1900) { if (actual) mensajes.push(actual); actual = p.slice(0, 1900) }
    else actual = actual ? actual + '\n\n' + p : p
  }
  if (actual) mensajes.push(actual)
  const ids: string[] = []
  // rechazo = Discord dijo NO de forma inequívoca (4xx salvo 408): nada se publicó. ambiguo = 5xx, 408, 2xx sin id o sin respuesta:
  // pudo publicarse; quien llama NO debe reintentar a ciegas.
  for (const content of mensajes) {
    let r: Response
    try { r = await fetch(`${url}${url.includes('?') ? '&' : '?'}wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }) }
    catch (e) { return { enviado: false, mensajes: ids.length, ids, ambiguo: true, error: `sin respuesta de Discord: ${(e as Error).message}` } }
    if (!r.ok) {
      const rechazo = r.status >= 400 && r.status < 500 && r.status !== 408
      return { enviado: false, mensajes: ids.length, ids, rechazo, ambiguo: !rechazo, error: `Discord ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}` }
    }
    const j = await r.json().catch(() => null) as { id?: string } | null
    if (!j?.id) return { enviado: false, mensajes: ids.length, ids, ambiguo: true, error: `Discord ${r.status} sin id de mensaje (no se sabe si se publicó)` }
    ids.push(j.id)
    await new Promise(res => setTimeout(res, 400))   // rate limit amable
  }
  return { enviado: true, mensajes: mensajes.length, ids }
}
