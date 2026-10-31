// ── Confirmación por WhatsApp al agendar ─────────────────────────────────────
// Calendly (invitee.created) → este módulo arma los datos del lead → webhook de Make → 2Chat manda
// el mensaje de confirmación y después el video de traspaso de autoridad (Gero → closer).
// El texto del mensaje y el video viven en el escenario de Make (se editan ahí sin deployar);
// acá se resuelve lo que en Make es frágil: de dónde sale el teléfono, su formato y la fecha.
// La API key de 2Chat vive SOLO en la conexión de Make; este código nunca la ve.
import { google } from 'googleapis'

const TZ_AR = 'America/Argentina/Buenos_Aires'
const PESTANA = 'Confirmaciones WhatsApp'
const HEADER = ['Fecha', 'Nombre', 'Teléfono', 'Closer', 'Reunión', 'Estado', 'Detalle', 'ID Calendly']

// Payload de invitee.created (webhook v2 de Calendly): trae el evento agendado embebido
type QA = { question?: string; answer?: string }
export interface InviteePayload {
  uri?: string; name?: string; first_name?: string | null; last_name?: string | null; email?: string; timezone?: string | null
  rescheduled?: boolean; old_invitee?: string | null; status?: string
  text_reminder_number?: string | null; questions_and_answers?: QA[]
  routing_form_submission?: string | null; reschedule_url?: string; cancel_url?: string
  scheduled_event?: {
    uri?: string; name?: string; start_time?: string
    location?: { type?: string; join_url?: string; location?: string }
    event_memberships?: { user_name?: string; user_email?: string }[]
  }
}

const RX_TEL = /tel[eé]fono|phone|whatsapp|celular|n[úu]mero/i
const respuestaTel = (qa?: QA[]) =>
  (qa ?? []).find(q => RX_TEL.test(q.question ?? '') && (q.answer ?? '').replace(/\D/g, '').length >= 7)?.answer?.trim() ?? ''

// WhatsApp necesita el número completo con código de país. Sin "+" (o "00") no hay forma segura de
// saber el país → null, y el lead queda anotado para escribirle a mano (mejor que mandarle a un extraño).
// Argentina: WhatsApp usa +54 9 <área> <número>; el selector de Calendly entrega "+54 11 3880-3998"
// (sin el 9), así que se agrega. También se limpian el 0 del área y el 15 si alguien los tipeó.
export function normalizarWhatsApp(crudo: string | null | undefined): string | null {
  let s = (crudo ?? '').trim()
  if (!s) return null
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (!s.startsWith('+')) return null
  let d = s.replace(/\D/g, '')
  if (d.startsWith('54')) {
    let resto = d.slice(2).replace(/^0+/, '')
    if (resto.startsWith('9')) resto = resto.slice(1).replace(/^0+/, '')
    if (resto.length === 12) {                       // área + "15" + abonado → sacar el 15
      for (const area of [2, 3, 4]) if (resto.slice(area, area + 2) === '15') { resto = resto.slice(0, area) + resto.slice(area + 2); break }
    }
    if (resto.length !== 10) return null
    d = `549${resto}`
  }
  return d.length >= 10 && d.length <= 15 ? `+${d}` : null
}

// "horario colombiano" se entiende mejor que "GMT-5". Si la zona no está en la lista se usa la ciudad.
const ZONAS: Record<string, string> = {
  'America/Argentina': 'argentino', 'America/Buenos_Aires': 'argentino', 'America/Montevideo': 'uruguayo',
  'America/Santiago': 'chileno', 'America/Asuncion': 'paraguayo', 'America/La_Paz': 'boliviano', 'America/Lima': 'peruano',
  'America/Bogota': 'colombiano', 'America/Guayaquil': 'ecuatoriano', 'America/Caracas': 'venezolano',
  'America/Mexico_City': 'de Ciudad de México', 'America/Monterrey': 'de Monterrey', 'America/Panama': 'panameño',
  'America/Costa_Rica': 'costarricense', 'America/Guatemala': 'guatemalteco', 'America/El_Salvador': 'salvadoreño',
  'America/Tegucigalpa': 'hondureño', 'America/Managua': 'nicaragüense', 'America/Santo_Domingo': 'dominicano',
  'America/Puerto_Rico': 'de Puerto Rico', 'Europe/Madrid': 'español',
}
const zonaTexto = (tz: string) => {
  const k = Object.keys(ZONAS).find(z => tz === z || tz.startsWith(`${z}/`))
  return `horario ${k ? ZONAS[k] : `de ${(tz.split('/').pop() ?? tz).replace(/_/g, ' ')}`}`
}

const tzValida = (tz?: string | null): string => {
  if (!tz) return TZ_AR
  try { new Intl.DateTimeFormat('es', { timeZone: tz }); return tz } catch { return TZ_AR }
}

const primerNombre = (s: string) => {
  const p = s.trim().split(/\s+/)[0] ?? ''
  return p ? p[0].toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : ''
}

// "JUAN DE LA CRUZ" / "juan de la cruz" → "Juan de la Cruz"; "ana-maría o'neill" → "Ana-María O'Neill"
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'das', 'do', 'dos', 'di', 'van', 'von'])
const mayus = (w: string) => w ? w[0].toLocaleUpperCase('es') + w.slice(1) : ''
const nombreYApellido = (s: string) => s.trim().split(/\s+/).filter(Boolean).map((w, i) => {
  const min = w.toLocaleLowerCase('es')
  return i > 0 && PARTICULAS.has(min) ? min : min.split(/([-'’])/).map(mayus).join('')
}).join(' ')

export interface DatosConfirmacion {
  tipo: 'agenda_nueva'
  telefono: string              // E.164 con "+", listo para el campo "To Number" de 2Chat
  nombre: string; nombre_completo: string; email: string
  saludo_nombre: string         // "Juan Pérez" para "Hola {{1}}, cómo estás?"; vacío si no dejó nombre (Make manda la plantilla sin nombre)
  closer: string; closer_completo: string
  fecha_texto: string; hora_texto: string; zona_texto: string
  cuando_texto: string          // "martes 22 de septiembre a las 15:00 (horario colombiano)"
  inicio_iso: string; link_reunion: string; link_reprogramar: string
  evento: string; id_calendly: string
}

// Tira error si Calendly falla: "no pude leer el formulario" NO es lo mismo que "no dejó teléfono"
async function telefonoDelRoutingForm(uri: string): Promise<string> {
  // Solo se le manda el token a Calendly: la URI viene en el payload y podría apuntar a otro host
  if (!/^https:\/\/api\.calendly\.com\/routing_form_submissions\/[\w-]+$/.test(uri)) return ''
  const token = process.env.CALENDLY_VENTAS_TOKEN
  if (!token) throw new Error('falta CALENDLY_VENTAS_TOKEN')
  const r = await fetch(uri, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`routing_form_submissions HTTP ${r.status}`)
  const j = await r.json() as { resource?: { questions_and_answers?: QA[] } }
  return respuestaTel(j.resource?.questions_and_answers)
}

// El selector de país de Calendly arranca en +1 (EE.UU.): si el lead no lo cambia, su celular latino se
// vuelve un número válido de un desconocido. Solo se frena ese caso (+1 con zona horaria de un país que
// no usa +1); un colombiano de viaje por México con su +57 sigue pasando.
const PAIS_SIN_MAS_UNO = /^(America\/(Argentina|Buenos_Aires|Montevideo|Santiago|Asuncion|La_Paz|Lima|Bogota|Guayaquil|Caracas|Mexico_City|Monterrey|Panama|Costa_Rica|Guatemala|El_Salvador|Tegucigalpa|Managua|Sao_Paulo)|Europe\/)/
const masUnoSospechoso = (telefono: string, tzCruda?: string | null) => telefono.startsWith('+1') && !!tzCruda && PAIS_SIN_MAS_UNO.test(tzCruda)

// Lo que viaja a una plantilla de WhatsApp no admite saltos de línea, tabs ni 5+ espacios, y el nombre lo
// escribe un desconocido en un formulario público: solo letras, espacios, apóstrofo y guion.
const limpio = (s: string, max = 60) => s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max)
const soloNombre = (s: string) => limpio(s.replace(/[^\p{L}\p{M}\s'’-]/gu, ''), 30)

// Solo los leads de estos closers reciben el WhatsApp: el mensaje sale del número del closer y lo firma él
// ("Soy Marcos Carlomagno…"). Cada closer tiene SU escenario de Make (su número de 2Chat y sus plantillas aprobadas en Meta) y
// su variable de entorno con el webhook. Marcos desde el 20/9/2026; Carlos Roletto desde el 9/10/2026; Yamila Coutoune desde el 18/10/2026.
// Para sumar un closer nuevo: conectar su número en 2Chat, aprobar SUS plantillas en Meta, crear SU escenario en Make (copia del de
// Marcos), cargar el webhook en una variable nueva de Vercel y agregar acá "nombre en Calendly (sin tildes, minúsculas)" → variable.
const WEBHOOK_POR_CLOSER: Record<string, string> = {
  'marcos carlomagno': 'MAKE_WEBHOOK_CONFIRMACION',        // Make 6333195 (número de Marcos, con video)
  'carlos roletto': 'MAKE_WEBHOOK_CONFIRMACION_CARLOS',    // Make 6578279 (número de Carlos, sin video por ahora)
  'yamila coutoune': 'MAKE_WEBHOOK_CONFIRMACION_YAMILA',   // Make 6682112 (número configurado del closer, sin video)
  // Nahuel (Closer 4, 27/10/2026): escenario configurado y número privado. El escenario arranca APAGADO hasta que Meta apruebe
  // las plantillas: Make guarda en cola lo que llega mientras tanto (vaciarla antes de prenderlo).
  'nahuel milena': 'MAKE_WEBHOOK_CONFIRMACION_NAHUEL',
  // Brenda (Closer 5, 27/10/2026): Make 6801121, número chileno +56900000001. También arranca APAGADO hasta que Meta apruebe
  // las plantillas (vaciar la cola del hook 2990585 antes de prenderlo).
  'brenda amado': 'MAKE_WEBHOOK_CONFIRMACION_BRENDA',
}
const CLOSERS_CON_WHATSAPP = Object.keys(WEBHOOK_POR_CLOSER)
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Variable de entorno con el webhook de Make del closer de la reunión (la de Marcos si el closer no está en el mapa: igual se omite después) */
export const variableWebhookDe = (closerDeLaReunion: string): string => WEBHOOK_POR_CLOSER[sinTildes(closerDeLaReunion)] ?? 'MAKE_WEBHOOK_CONFIRMACION'

// Devuelve los datos listos para Make, o el motivo por el que NO corresponde / no se puede mandar
export async function datosConfirmacion(p: InviteePayload): Promise<{ datos?: DatosConfirmacion; omitir?: string; sinTelefono?: string }> {
  const ev = p.scheduled_event
  if (!ev?.start_time) return { omitir: 'payload sin evento agendado' }
  // Solo las llamadas de venta: en la misma cuenta están las reuniones con clientes (Análisis y Proyecciones…)
  if (!/consultiva/i.test(ev.name ?? '')) return { omitir: `evento "${ev.name ?? ''}" no es Reunión Consultiva` }
  const closerDeLaReunion = ev.event_memberships?.[0]?.user_name ?? ''
  if (!CLOSERS_CON_WHATSAPP.includes(sinTildes(closerDeLaReunion))) return { omitir: `la reunión es con "${closerDeLaReunion || 'sin closer'}", que todavía no tiene WhatsApp automático` }
  // Reprogramación: ya recibió la bienvenida y el video cuando agendó la primera vez
  if (p.old_invitee || p.rescheduled) return { omitir: 'reprogramación' }
  // Reserva de reagenda (evento "… Reagenda …" de un closer, para un lead cuya reunión ya pasó): tampoco se le escribe de nuevo
  // al lead (pedido de Tomás, 19/10/2026: en ninguna reagenda se manda WhatsApp)
  if (/reagenda/i.test(ev.name ?? '')) return { omitir: 'reagenda' }
  if (new Date(ev.start_time).getTime() < Date.now()) return { omitir: 'la reunión ya pasó' }

  // El teléfono confiable es el del formulario de calificación (tiene selector de país);
  // la reserva casi nunca lo trae y cuando lo trae suele venir sin código de país.
  let falloCalendly = ''
  const delFormulario = p.routing_form_submission
    ? await telefonoDelRoutingForm(p.routing_form_submission).catch(e => { falloCalendly = (e as Error).message; return '' })
    : ''
  const candidatos = [delFormulario, p.text_reminder_number ?? '', respuestaTel(p.questions_and_answers)].filter(Boolean)
  const telefono = candidatos.map(normalizarWhatsApp).find(Boolean)
  if (!telefono) return {
    sinTelefono: falloCalendly ? `no se pudo leer el formulario de Calendly (${falloCalendly}) — buscar el teléfono a mano`
      : candidatos.length ? `teléfono sin código de país: ${limpio(candidatos[0], 40)}` : 'no dejó teléfono',
  }
  if (masUnoSospechoso(telefono, p.timezone))
    return { sinTelefono: `el teléfono ${telefono} es +1 (EE.UU.) pero el lead está en ${p.timezone}: probablemente no cambió el país en el formulario — verificar` }

  const tz = tzValida(p.timezone)
  const inicio = new Date(ev.start_time)
  const fecha = new Intl.DateTimeFormat('es', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(inicio).replace(',', '')
  const hora = new Intl.DateTimeFormat('es', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(inicio)
  const nombreCompleto = soloNombre(p.name ?? '')
  const closerCompleto = soloNombre(ev.event_memberships?.[0]?.user_name ?? '')
  const joinUrl = ev.location?.join_url ?? ''
  return {
    datos: {
      tipo: 'agenda_nueva', telefono,
      // Sin nombre usable el saludo queda "Hola 👋": mejor que un "Hola ," o un nombre inventado
      nombre: primerNombre(soloNombre(p.first_name ?? '') || nombreCompleto), nombre_completo: nombreCompleto, email: limpio(p.email ?? '', 120),
      saludo_nombre: nombreYApellido(nombreCompleto || soloNombre(`${p.first_name ?? ''} ${p.last_name ?? ''}`)),
      closer: primerNombre(closerCompleto) || 'nuestro equipo', closer_completo: closerCompleto,
      fecha_texto: fecha, hora_texto: hora, zona_texto: zonaTexto(tz),
      cuando_texto: `${fecha} a las ${hora} (${zonaTexto(tz)})`,     // sin "hs": es rioplatense y los leads son de toda LatAm
      inicio_iso: inicio.toISOString(),
      link_reunion: /^https:\/\//.test(joinUrl) ? joinUrl : '', link_reprogramar: /^https:\/\/calendly\.com\//.test(p.reschedule_url ?? '') ? p.reschedule_url! : '',
      evento: limpio(ev.name ?? ''), id_calendly: p.uri ?? '',
    },
  }
}

function sheetsEscritura() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!email || !key || !process.env.SHEET_ID_VENTAS) return null
  return google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
}

// La pestaña es auditoría ("¿le llegó el mensaje a X?") y candado a la vez. Una sola lectura responde:
//   duplicado  → esta misma reserva ya se procesó (Calendly reintentó el webhook)
//   yaRecibio  → ese teléfono ya recibió la bienvenida hace poco (canceló y volvió a agendar, o agendó dos veces)
//   enviadosHoy → freno ante un bucle. Tomás (27/10/2026): "que no tenga límite… no puede volver a pasar eso" (con 40 se
//                 cortaron confirmaciones el día del webinar). Queda en 1000 solo para que un webhook en bucle no mande miles;
//                 los candados de arriba (reserva duplicada y mismo teléfono en 30 días) siguen igual.
const DIAS_SIN_REPETIR = 30
const TOPE_DIARIO = 1000
const fechaFila = (v: unknown): Date | null => {
  const m = String(v ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null
}
async function estadoPrevio(id: string, telefono: string): Promise<{ duplicado: boolean; yaRecibio: boolean; enviadosHoy: number }> {
  const sheets = sheetsEscritura()
  if (!sheets) return { duplicado: false, yaRecibio: false, enviadosHoy: 0 }
  let filas: unknown[][] = []
  try {
    filas = (await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID_VENTAS!, range: `'${PESTANA}'!A:H` })).data.values ?? []
  } catch (e) {
    if (!/Unable to parse range/i.test((e as Error).message ?? '')) throw e     // error real de Sheets: no seguir a ciegas
  }                                                                              // si es "no existe la pestaña" → primer uso
  const hoyAR = new Date().toLocaleDateString('es-AR', { timeZone: TZ_AR })
  const [d, m, a] = hoyAR.split('/').map(Number)
  const hoy = new Date(a, m - 1, d)
  const enviado = (f: unknown[]) => String(f[5] ?? '') === 'enviado a Make'
  return {
    duplicado: !!id && filas.some(f => String(f[7] ?? '').trim() === id),
    yaRecibio: filas.some(f => {
      if (!enviado(f) || String(f[2] ?? '').trim() !== telefono) return false
      const cuando = fechaFila(f[0])
      return !!cuando && (hoy.getTime() - cuando.getTime()) / 86_400_000 <= DIAS_SIN_REPETIR
    }),
    enviadosHoy: filas.filter(f => enviado(f) && fechaFila(f[0])?.getTime() === hoy.getTime()).length,
  }
}

async function registrar(fila: (string | number)[]) {
  const sheets = sheetsEscritura()
  if (!sheets) return
  const id = process.env.SHEET_ID_VENTAS!
  const anexar = (filas: (string | number)[][]) =>
    sheets.spreadsheets.values.append({ spreadsheetId: id, range: `'${PESTANA}'!A:H`, valueInputOption: 'RAW', requestBody: { values: filas } })
  try { await anexar([fila]) } catch (e) {
    // Solo "no existe la pestaña" justifica crearla; un 429/5xx de Sheets tiene que salir tal cual
    if (!/Unable to parse range/i.test((e as Error).message ?? '')) throw e
    let creada = true
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: PESTANA } } }] } })
    } catch (e2) {
      if (!/already exists/i.test((e2 as Error).message ?? '')) throw e2        // otra reserva simultánea la creó recién
      creada = false
    }
    await anexar(creada ? [HEADER, fila] : [fila])
  }
}

export interface ResultadoConfirmacion { ok: boolean; accion: 'enviado a Make' | 'omitido' | 'sin teléfono' | 'apagado' | 'error'; motivo?: string }

export async function enviarConfirmacionAgenda(p: InviteePayload): Promise<ResultadoConfirmacion> {
  // Cada closer manda desde SU escenario de Make (su número y sus plantillas)
  const variable = variableWebhookDe(p.scheduled_event?.event_memberships?.[0]?.user_name ?? '')
  const url = process.env[variable]
  if (!url) return { ok: true, accion: 'apagado', motivo: `falta ${variable}` }
  const { datos, omitir, sinTelefono } = await datosConfirmacion(p)
  if (omitir) return { ok: true, accion: 'omitido', motivo: omitir }
  const id = p.uri ?? ''
  const previo = await estadoPrevio(id, datos?.telefono ?? '')
  if (previo.duplicado) return { ok: true, accion: 'omitido', motivo: 'ya se había procesado esta reserva' }

  const ahora = new Date().toLocaleString('es-AR', { timeZone: TZ_AR })
  const closer = soloNombre(p.scheduled_event?.event_memberships?.[0]?.user_name ?? '').split(' ')[0]
  if (!datos) {
    await registrar([ahora, soloNombre(p.name ?? ''), '', closer, '', 'SIN TELÉFONO — escribirle a mano', sinTelefono ?? '', id])
    return { ok: true, accion: 'sin teléfono', motivo: sinTelefono }
  }
  const base = [ahora, datos.nombre_completo, datos.telefono, datos.closer, datos.cuando_texto]
  if (previo.yaRecibio) {
    await registrar([...base, 'NO enviado — ya recibió la bienvenida', `mismo teléfono en los últimos ${DIAS_SIN_REPETIR} días (volvió a agendar)`, id])
    return { ok: true, accion: 'omitido', motivo: 'ese teléfono ya recibió la bienvenida' }
  }
  if (previo.enviadosHoy >= TOPE_DIARIO) {
    await registrar([...base, 'NO enviado — tope diario', `ya salieron ${previo.enviadosHoy} hoy (tope ${TOPE_DIARIO}): revisar si es normal y escribirle a mano`, id])
    return { ok: false, accion: 'error', motivo: `tope diario de ${TOPE_DIARIO} confirmaciones alcanzado` }
  }

  // Se anota ANTES de mandar: si dos entregas del mismo webhook se pisan, la segunda ya ve la fila
  await registrar([...base, 'enviado a Make', '', id])
  const apiKey = process.env.MAKE_WEBHOOK_APIKEY       // opcional: si el webhook de Make tiene API key, va en este header
  let falla = ''
  try {
    const r = await fetch(url, {
      method: 'POST', body: JSON.stringify(datos), signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-make-apikey': apiKey } : {}) },
    })
    if (!r.ok) falla = `Make respondió ${r.status}`
  } catch (e) {
    // Con timeout Make pudo haber recibido igual: por eso "verificar" (peor caso, doble contacto; no ninguno)
    falla = (e as Error).name === 'TimeoutError' ? 'Make no respondió en 15 s' : `no se pudo llamar a Make (${(e as Error).message})`
  }
  if (falla) {
    await registrar([...base, 'ERROR — verificar y escribirle a mano', falla, `${id}#error`])
    return { ok: false, accion: 'error', motivo: falla }
  }
  return { ok: true, accion: 'enviado a Make' }
}
