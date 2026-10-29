import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { fetchRawData } from '@/lib/rawSheets'
import { serializeRaw } from '@/lib/serializeRaw'
import { analizarNegocio, type Hallazgo } from '@/lib/analista'
import { sendDiscord } from '@/lib/discord'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Agente Analista → Discord (cron 8:20 AR) ────────────────────────────
// Revisa el negocio de arriba a abajo (lib/analista.ts, lo mismo que muestra el panel 🧠 Analista).
// · Todos los días: solo hallazgos de prioridad 1 que NO se mandaron en los últimos 7 días.
// · Los LUNES: revisión completa (prioridad 1 y 2), corta y agrupada por área.
// · Un día normal sin nada nuevo no manda nada (responde enviado:false).
// · El DÍA 1 del mes se agrega el cierre del mes anterior ("Septiembre cerró en $X, N% de la meta"):
//   sin esto, el mes que termina nunca llega a Discord con su número final.
// El dedupe se guarda en la pestaña "Estado notificador" del sheet de Ventas (clave 'analista_enviados',
// valor JSON {id: {fecha, hash}}). Si el estado no se puede leer/escribir se manda igual
// (mejor duplicado que perdido) y se informa en la respuesta.
// Sin datos mínimos (Registro vacío, sin agendas o cash del año en 0) responde 503 sin enviar ni guardar.
// ?preview=1 devuelve el texto sin enviar ni guardar · ?completo=1 fuerza la revisión completa.
// Protegido con CRON_SECRET (Bearer o ?key=). Falla CERRADO: el texto trae números del negocio.

const TZ = 'America/Argentina/Buenos_Aires'
const META_MENSUAL = 100_000
const PESTANA = 'Estado notificador'
const CLAVE = 'analista_enviados'
const DIAS_DEDUPE = 7
const DIAS_RETENCION = 35          // el JSON vive en una celda (máx 50K chars): se poda lo viejo
const DASHBOARD = 'https://dashboard-metricas-eight.vercel.app'

type Estado = Record<string, { fecha: string; hash: string }>

// Hora argentina "naive": getDate()/getMonth()/getDay() devuelven el día de Argentina aunque Vercel corra en UTC
const nowArgentina = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
const ymdAR = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

// Firma del diagnóstico: el título sin números. Cambia si cambia la conclusión ("mantener" → "escalar"),
// no porque el monto se movió unos dólares (si no, el mismo hallazgo saldría todos los días).
function firma(h: Hallazgo): string {
  const base = h.titulo.replace(/[$\d.,%Kx+\-–]+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()
  let x = 5381
  for (let i = 0; i < base.length; i++) x = ((x << 5) + x + base.charCodeAt(i)) | 0
  return (x >>> 0).toString(36)
}

function sheetsEscritura() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!email || !key || !process.env.SHEET_ID_VENTAS) return null
  return google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
}

// Fila de estado: A clave · B JSON · C (vacío) · D actualizado · E (vacío) — mismo formato que agendaSlots
async function leerEstado(): Promise<{ fila: number | null; estado: Estado }> {
  const sheets = sheetsEscritura()
  if (!sheets) throw new Error('sin credenciales de Sheets')
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID_VENTAS!, range: `'${PESTANA}'!A:B` })
  const filas = r.data.values ?? []
  const i = filas.findIndex(f => (f[0] ?? '').toString().trim() === CLAVE)
  if (i < 0) return { fila: null, estado: {} }
  let estado: Estado = {}
  try { estado = JSON.parse((filas[i][1] ?? '').toString() || '{}') } catch { estado = {} }
  return { fila: i + 1, estado }
}

async function guardarEstado(fila: number | null, estado: Estado) {
  const sheets = sheetsEscritura()
  if (!sheets) throw new Error('sin credenciales de Sheets')
  const valores = [[CLAVE, JSON.stringify(estado), '', new Date().toLocaleString('es-AR', { timeZone: TZ }), '']]
  if (fila) await sheets.spreadsheets.values.update({ spreadsheetId: process.env.SHEET_ID_VENTAS!, range: `'${PESTANA}'!A${fila}:E${fila}`, valueInputOption: 'RAW', requestBody: { values: valores } })
  else await sheets.spreadsheets.values.append({ spreadsheetId: process.env.SHEET_ID_VENTAS!, range: `'${PESTANA}'!A:E`, valueInputOption: 'RAW', requestBody: { values: valores } })
}

const AREAS: { key: Hallazgo['area']; titulo: string }[] = [
  { key: 'caja', titulo: '💰 **Caja**' },
  { key: 'embudos', titulo: '📣 **Embudos**' },
  { key: 'ventas', titulo: '📞 **Ventas**' },
  { key: 'backend', titulo: '🔁 **Backend**' },
  { key: 'clientes', titulo: '👥 **Clientes**' },
  { key: 'operaciones', titulo: '🎬 **Operaciones**' },
]

const bullet = (h: Hallazgo) => `• ${h.icono} **${h.titulo}** — ${h.texto}${h.accion ? ` → ${h.accion}` : ''}`

// Arma secciones de ≤1900 chars (sendDiscord junta secciones pero corta si una sola se pasa)
function seccion(titulo: string | null, lineas: string[]): string[] {
  const out: string[] = []
  let actual = titulo ?? ''
  for (const l of lineas) {
    const linea = l.length > 1850 ? l.slice(0, 1850) + '…' : l
    if (actual && (actual + '\n' + linea).length > 1900) { out.push(actual); actual = linea }
    else actual = actual ? actual + '\n' + linea : linea
  }
  if (actual) out.push(actual)
  return out
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get('key') !== secret))
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const preview = !!url.searchParams.get('preview')
  try {
    const hoy = nowArgentina()
    const hoyYmd = ymdAR(hoy)
    const completo = hoy.getDay() === 1 || !!url.searchParams.get('completo')   // lunes = revisión completa
    const raw = serializeRaw(await fetchRawData())

    // Datos mínimos antes de opinar: en arranque en frío o con Sheets en cuota getRange() devuelve []
    // en silencio y el analista diría "faltan $100K" o "embudo sin ventas". Sin datos → 503, no se
    // manda nada y no se toca el estado de dedupe (el próximo intento lo vuelve a evaluar).
    const cashAnio = (raw.monthlyCash ?? []).slice(0, hoy.getMonth() + 1).reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0)
    const faltan = [
      !raw.transactions?.length && 'Registro de Pagos sin filas',
      !raw.calls?.length && 'sin agendas',
      !(cashAnio > 0) && 'cash del año en 0',
    ].filter(Boolean) as string[]
    if (faltan.length)
      return NextResponse.json({ ok: false, enviado: false, motivo: `datos incompletos: ${faltan.join(', ')}` }, { status: 503 })

    const { resumen, hallazgos } = analizarNegocio(raw, { monthIdx: hoy.getMonth(), hoy, metaMensual: META_MENSUAL })
    // Día 1: el cierre del mes anterior (caja: "cerró en $X" o, si el Registro vino a medias, el aviso de
    // datos incompletos). Va como prioridad 1 para que salga aunque no sea lunes. En enero no hay mes
    // anterior en los datos (las series son del año en curso).
    const cierrePrev: Hallazgo[] = hoy.getDate() === 1 && hoy.getMonth() > 0
      ? analizarNegocio(raw, { monthIdx: hoy.getMonth() - 1, hoy, metaMensual: META_MENSUAL }).hallazgos
        .filter(h => h.id.startsWith('cierre-mes-') || h.id.startsWith('datos-incompletos-'))
        .map(h => ({ ...h, prioridad: 1 as const }))
      : []

    // Estado de dedupe (si falla, se sigue sin él y se reporta)
    let fila: number | null = null
    let estado: Estado = {}
    let errorEstado: string | undefined
    try { ({ fila, estado } = await leerEstado()) } catch (e) { errorEstado = `no se pudo leer el estado: ${(e as Error).message}` }

    const yaEnviado = (h: Hallazgo) => {
      const prev = estado[h.id]
      return !!prev && prev.hash === firma(h) && diasEntre(prev.fecha, hoyYmd) < DIAS_DEDUPE
    }
    const aEnviar = [
      ...cierrePrev.filter(h => !yaEnviado(h)),
      ...(completo
        ? hallazgos.filter(h => h.prioridad <= 2)
        : hallazgos.filter(h => h.prioridad === 1 && !yaEnviado(h))),
    ]

    const fechaTxt = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
    if (!aEnviar.length) {
      const r = { ok: true, enviado: false, motivo: 'nada nuevo de prioridad 1', completo, resumen, hallazgos: hallazgos.length + cierrePrev.length, errorEstado }
      return NextResponse.json(preview ? { ...r, preview: '' } : r)
    }

    const partes: string[] = [`🧠 **ANALISTA SKWD — ${fechaTxt}**${completo ? ' · _revisión semanal completa_' : ''}\n_${resumen}_`]
    if (completo) {
      for (const a of AREAS) {
        const del = aEnviar.filter(h => h.area === a.key)
        if (del.length) partes.push(...seccion(a.titulo, del.map(bullet)))
      }
    } else {
      partes.push(...seccion(null, aEnviar.map(bullet)))
    }
    partes.push(`🔗 Dashboard: ${DASHBOARD}`)

    if (preview) return NextResponse.json({ ok: true, completo, enviados: aEnviar.map(h => h.id), errorEstado, preview: partes.join('\n\n') })

    const r = await sendDiscord(partes, process.env.DISCORD_WEBHOOK_ANALISTA || process.env.DISCORD_WEBHOOK_URL)
    // Si Discord falló (aunque sea a mitad de los mensajes) NO se guarda ninguna firma: mañana se reintenta
    if (!r.enviado) return NextResponse.json({ ok: false, ...r, errorEstado }, { status: 500 })

    // Registrar lo enviado (solo con envío confirmado) y podar lo viejo
    for (const h of aEnviar) estado[h.id] = { fecha: hoyYmd, hash: firma(h) }
    for (const [id, e] of Object.entries(estado)) if (!e?.fecha || diasEntre(e.fecha, hoyYmd) > DIAS_RETENCION) delete estado[id]
    if (!errorEstado) {
      try { await guardarEstado(fila, estado) } catch (e) { errorEstado = `se envió pero no se pudo guardar el estado: ${(e as Error).message}` }
    }
    return NextResponse.json({ ok: true, ...r, completo, enviados: aEnviar.map(h => h.id), errorEstado })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
