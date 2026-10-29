// ── Notificador de espacios de agenda (Discord, con @ a Tomás y Gero) ─────────
// Mira los LUGARES que quedan en "Reunión Consultiva" (2 días de agenda): desde el 26/10/2026, reuniones que todavía
// entran closer por closer (lib/agendaLugares.ts), no horarios de Calendly. Si no se pueden calcular, cae al conteo por
// horarios con una nota. Avisa cuando BAJA a un umbral nuevo: 20, 15, 10, 5, 3, 2, 1 y 0. El último umbral avisado se
// guarda en la pestaña "Estado notificador" del sheet de Ventas para no repetir el aviso en
// cada corrida. Si los espacios vuelven a subir se resetea solo (con un aviso sin @ si venía de ≤3).
import crypto from 'node:crypto'
import { google } from 'googleapis'
import { fetchEspaciosAgenda, type EspaciosAgenda } from './calendly'

const TZ = 'America/Argentina/Buenos_Aires'
const PESTANA = 'Estado notificador'
const CLAVE = 'agenda_bucket'
const TOPE = 20                       // por encima de esto no se avisa (hay agenda de sobra)
const HORA_SILENCIO = { desde: 23, hasta: 8 }   // de noche los espacios caen solos al vencer el día: no arrobar

// Umbral en el que cae una cantidad: 0,1,2,3 exactos; después múltiplos de 5 hacia arriba (4→5, 7→10, 14→15…)
export const umbralDe = (n: number): number => n <= 0 ? 0 : n <= 3 ? n : Math.ceil(n / 5) * 5

function sheetsEscritura() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!email || !key || !process.env.SHEET_ID_VENTAS) return null
  return google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
}

// Fila de estado: A clave · B último umbral avisado · C espacios · D actualizado · E marca de "reclamo"
async function leerEstado(): Promise<{ fila: number | null; umbral: number | null; marca: string }> {
  const sheets = sheetsEscritura()
  if (!sheets) return { fila: null, umbral: null, marca: '' }
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID_VENTAS!, range: `'${PESTANA}'!A:E`, valueRenderOption: 'UNFORMATTED_VALUE' })
  const filas = r.data.values ?? []
  const i = filas.findIndex(f => (f[0] ?? '').toString().trim() === CLAVE)
  if (i < 0) return { fila: null, umbral: null, marca: '' }
  const crudo = filas[i][1]
  const v = typeof crudo === 'number' ? crudo : Number(String(crudo ?? '').trim() || NaN)   // ' ' o '' → sin estado (no 0)
  return { fila: i + 1, umbral: Number.isFinite(v) ? v : null, marca: (filas[i][4] ?? '').toString() }
}

async function guardarEstado(fila: number | null, umbral: number | '', slots: number, marca = '') {
  const sheets = sheetsEscritura()
  if (!sheets) throw new Error('sin credenciales de Sheets')
  const valores = [[CLAVE, umbral, slots, new Date().toLocaleString('es-AR', { timeZone: TZ }), marca]]
  if (fila) await sheets.spreadsheets.values.update({ spreadsheetId: process.env.SHEET_ID_VENTAS!, range: `'${PESTANA}'!A${fila}:E${fila}`, valueInputOption: 'RAW', requestBody: { values: valores } })
  else await sheets.spreadsheets.values.append({ spreadsheetId: process.env.SHEET_ID_VENTAS!, range: `'${PESTANA}'!A:E`, valueInputOption: 'RAW', requestBody: { values: valores } })
}

/** Lo que cuenta para el aviso: lugares por closer o, si no se pudieron calcular, horarios de Calendly. */
export const cuentaDe = (e: EspaciosAgenda): number => e.lugares ?? e.slots

const fechaCorta = (d: string) => { const [, m, dd] = d.split('-'); return `${Number(dd)}/${Number(m)}` }
const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || n

/** "27/10: 4 (Carlos 2 · Marcos 2)" por día; sin el cálculo por closer, los horarios del día y la nota de por qué. */
export const porDiaTxt = (e: EspaciosAgenda): string => {
  if (e.lugaresPorDia) {
    const dias = Object.entries(e.lugaresPorDia).sort().map(([d, porCloser]) => {
      const total = Object.values(porCloser).reduce((a, b) => a + b, 0)
      const detalle = Object.entries(porCloser).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${primerNombre(c)} ${n}`).join(' · ')
      return `${fechaCorta(d)}: ${total} (${detalle})`
    })
    return dias.join('\n') || 'ningún día con lugar'
  }
  const txt = Object.entries(e.porDia).sort().map(([d, n]) => `${fechaCorta(d)}: ${n}`).join(' · ') || 'ningún día con lugar'
  return e.notaCalculo ? `${txt}\n_(${e.notaCalculo})_` : txt
}

export interface ResultadoAgenda {
  ok: boolean; motivo?: string
  slots?: number; umbral?: number; umbralAnterior?: number | null
  accion?: 'aviso con @' | 'aviso sin @' | 'sin cambios' | 'silencio nocturno' | 'estado inicial'
  mensaje?: string; eventos?: EspaciosAgenda[]
}

// preview = calcula y arma el mensaje pero no manda ni guarda · forzar = manda el estado actual aunque no haya cambio
export async function revisarEspaciosAgenda(opts: { preview?: boolean; forzar?: boolean } = {}): Promise<ResultadoAgenda> {
  // Sin dónde guardar el estado, cada corrida creería ser la primera y mandaría el aviso de nuevo
  if (!opts.preview && !sheetsEscritura()) return { ok: false, motivo: 'faltan credenciales de Sheets para guardar el estado' }
  const { disponible, eventos } = await fetchEspaciosAgenda()
  if (!disponible) return { ok: false, motivo: 'Calendly no respondió o falta CALENDLY_VENTAS_TOKEN' }
  // El evento que llenan los leads es el de "2 DÍAS DE AGENDA" (Leads A y B+C+D+E comparten el pool de closers).
  // Si nadie tiene esa nota NO se cae a otro evento: vigilar en silencio el equivocado es peor que avisar el error.
  const principales = eventos.filter(e => /2\s*d[ií]as/i.test(e.nota))
  if (!principales.length) return { ok: false, motivo: 'ningún evento "Reunión Consultiva" tiene la nota interna "2 DÍAS DE AGENDA"', eventos }
  const ev = principales.reduce((a, b) => (cuentaDe(b) < cuentaDe(a) ? b : a))
  const slots = cuentaDe(ev), umbral = umbralDe(slots)
  const unidad = ev.lugares != null ? 'lugares' : 'espacios'
  const { fila, umbral: anterior } = await leerEstado()

  const ids = (process.env.DISCORD_MENTION_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const arrobas = ids.map(i => `<@${i}>`).join(' ')
  const detalle = `\n📅 ${porDiaTxt(ev)}\n🔗 Disponibilidad: https://calendly.com/app/availability/schedules`
  const titulo = slots <= 0
    ? `🚨 **NO QUEDAN ${unidad.toUpperCase()} DE AGENDA** — "${ev.nombre}" (${ev.nota || '2 días de agenda'}) está en 0. Los leads que llenen el formulario no van a poder reservar: abrir disponibilidad YA.`
    : slots <= 3
      ? `🔴 **${slots === 1 ? `Queda 1 ${unidad === 'lugares' ? 'lugar' : 'espacio'}` : `Quedan ${slots} ${unidad}`} de agenda** — "${ev.nombre}" (${ev.nota || '2 días de agenda'})`
      : `🟡 **Quedan ${slots} ${unidad} de agenda** — "${ev.nombre}" (${ev.nota || '2 días de agenda'})`

  const hora = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })) % 24
  const deNoche = hora >= HORA_SILENCIO.desde || hora < HORA_SILENCIO.hasta

  // Histéresis: una cancelación que sube 1 espacio justo por encima de un umbral NO resetea el estado
  // (si no, la siguiente reserva volvería a arrobar: 5→6→5). Desde 0 cualquier suba cuenta.
  const subaReal = anterior != null && umbral > anterior && (anterior <= 0 || slots >= anterior + 2)
  const umbralAGuardar = anterior != null && umbral > anterior && !subaReal ? anterior : umbral

  let accion: ResultadoAgenda['accion'] = 'sin cambios'
  let mensaje = ''
  if (opts.forzar) { accion = 'aviso con @'; mensaje = `${arrobas} ${titulo}${detalle}`.trim() }
  else if (anterior == null) { accion = 'estado inicial'; mensaje = `📟 **Notificador de agendas activado** — hoy hay ${slots} ${unidad} en "${ev.nombre}" (${ev.nota || '2 días de agenda'}). Aviso con @ cuando baje a 20, 15, 10, 5, 3, 2, 1 y 0.${detalle}` }
  else if (umbral < anterior && umbral <= TOPE) {
    if (deNoche) accion = 'silencio nocturno'          // no se guarda el estado → avisa en la primera corrida después de las 8:00
    else { accion = 'aviso con @'; mensaje = `${arrobas} ${titulo}${detalle}`.trim() }
  } else if (subaReal && anterior != null && anterior <= 3) {
    if (deNoche) accion = 'silencio nocturno'          // igual: que el "se reabrió" salga a la mañana y no se pierda
    else { accion = 'aviso sin @'; mensaje = `🟢 **Se reabrió la agenda**: ${slots} ${unidad} disponibles en "${ev.nombre}".${detalle}` }
  }

  const res: ResultadoAgenda = { ok: true, slots, umbral, umbralAnterior: anterior, accion, mensaje: mensaje || undefined, eventos }
  if (opts.preview) return res

  const persiste = accion !== 'silencio nocturno' && !opts.forzar
  let filaActual = fila
  if (mensaje && persiste) {
    // "Reclamo antes de enviar": dos webhooks casi simultáneos leen el mismo estado. Cada uno escribe su
    // marca, espera un instante y relee — solo el último que escribió manda el aviso; el otro se calla.
    const marca = crypto.randomUUID()
    await guardarEstado(fila, umbralAGuardar, slots, marca)
    await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 700)))
    const despues = await leerEstado()
    filaActual = despues.fila
    if (despues.marca !== marca) return { ...res, accion: 'sin cambios', mensaje: undefined, motivo: 'otro chequeo simultáneo ya avisó este umbral' }
  }

  if (mensaje) {
    const url = process.env.DISCORD_WEBHOOK_AGENDAS || process.env.DISCORD_WEBHOOK_URL
    const r = url ? await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: mensaje.slice(0, 1900), allowed_mentions: { users: accion === 'aviso con @' ? ids : [] } }),
    }) : null
    if (!r || !r.ok) {
      // No salió el aviso: devolver el estado a como estaba para que el próximo chequeo lo reintente
      if (persiste) await guardarEstado(filaActual, anterior ?? '', slots, '')
      return { ...res, ok: false, motivo: r ? `Discord ${r.status}` : 'sin webhook de Discord' }
    }
  } else if (persiste && umbralAGuardar !== anterior) {
    await guardarEstado(fila, umbralAGuardar, slots, '')      // sin aviso: solo se mueve el estado (p. ej. subió la agenda)
  }
  return res
}
