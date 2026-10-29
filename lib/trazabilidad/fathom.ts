// ── Llamadas de venta desde la API de Fathom ─────────────────────────────────────────────────
// Las grabaciones son de la cuenta de Fathom de CADA closer (la cuenta de Tomás no las ve: no hay equipo en Fathom).
// Por eso se aceptan varias claves: FATHOM_API_KEYS = {"Carlos":"…","Marcos":"…"} (JSON) o FATHOM_API_KEY suelta.
// Cómo se encuentra la llamada de un cierre: el link de la planilla (Grabación 1–3, share_url o url de Fathom); si no
// coincide, una reunión con el mail del lead entre los invitados, ±2 días de la fecha de la llamada.
// API: https://api.fathom.ai/external/v1 con X-Api-Key. /meetings pagina con cursor; summary y transcript por grabación.
import 'server-only'
import { formatearTranscripcion } from '@/lib/fathomAnuncios/transcripcion'
import type { RenglonFathom } from '@/lib/fathomAnuncios/tipos'
import { normEmail, type Cierre } from './modelo'

const BASE = 'https://api.fathom.ai/external/v1'

export function clavesFathom(): { nombre: string; clave: string }[] {
  const crudo = process.env.FATHOM_API_KEYS?.trim()
  const lista: { nombre: string; clave: string }[] = []
  if (crudo) {
    try {
      for (const [nombre, clave] of Object.entries(JSON.parse(crudo) as Record<string, string>)) if (clave?.trim()) lista.push({ nombre, clave: clave.trim() })
    } catch {
      throw new Error('FATHOM_API_KEYS no es un JSON válido ({"Closer":"clave"})')
    }
  }
  const suelta = process.env.FATHOM_API_KEY?.trim()
  if (suelta && !lista.some((k) => k.clave === suelta)) lista.push({ nombre: 'principal', clave: suelta })
  return lista
}

interface Reunion { recording_id: number; url: string; share_url: string | null; created_at: string | null; title: string; invitados: string[]; clave: string }

async function pedir(clave: string, ruta: string): Promise<unknown> {
  const r = await fetch(`${BASE}${ruta}`, { headers: { 'X-Api-Key': clave, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  if (r.status === 429) throw new Error('Fathom: demasiadas consultas (429), probar más tarde')
  if (!r.ok) throw new Error(`Fathom respondió ${r.status} en ${ruta.split('?')[0]}`)
  return r.json()
}

/** Todas las reuniones desde una fecha, de todas las cuentas (sin resumen ni transcripción: solo para encontrarlas) */
async function reunionesDesde(desde: string): Promise<Reunion[]> {
  const todas: Reunion[] = []
  for (const k of clavesFathom()) {
    let cursor: string | null = null
    for (let pagina = 0; pagina < 60; pagina++) {
      const q = new URLSearchParams({ created_after: `${desde}T00:00:00Z` })
      if (cursor) q.set('cursor', cursor)
      const d = (await pedir(k.clave, `/meetings?${q}`)) as { items?: Record<string, unknown>[]; next_cursor?: string | null }
      for (const m of d.items ?? []) {
        todas.push({
          recording_id: Number(m.recording_id), url: String(m.url ?? ''), share_url: (m.share_url as string | null) ?? null,
          created_at: (m.created_at as string | null) ?? null, title: String(m.title ?? m.meeting_title ?? ''),
          invitados: ((m.calendar_invitees as { email?: string }[] | undefined) ?? []).map((i) => normEmail(i.email ?? '')).filter(Boolean),
          clave: k.clave,
        })
      }
      cursor = d.next_cursor ?? null
      if (!cursor) break
    }
  }
  return todas
}

const token = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? ''

export function reunionDeCierre(c: Cierre, reuniones: Reunion[]): Reunion | null {
  const tokens = new Set(c.grabaciones.map(token).filter(Boolean))
  // La última grabación de la planilla suele ser la del cierre (Grabación 2 = segunda llamada)
  const porLink = reuniones.filter((r) => tokens.has(token(r.share_url ?? '')) || tokens.has(token(r.url)))
  if (porLink.length) return porLink.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
  const mail = normEmail(c.email)
  if (!mail || !c.fecha) return null
  const dia = Date.parse(`${c.fecha}T12:00:00Z`)
  return reuniones.find((r) => r.invitados.includes(mail) && r.created_at && Math.abs(Date.parse(r.created_at) - dia) <= 2.5 * 86_400_000) ?? null
}

export interface LlamadaFathom { url: string; resumen: string; transcript: string }

async function detalle(r: Reunion): Promise<LlamadaFathom> {
  const [s, t] = await Promise.all([
    pedir(r.clave, `/recordings/${r.recording_id}/summary`).catch(() => null) as Promise<{ summary?: { markdown_formatted?: string | null } } | null>,
    pedir(r.clave, `/recordings/${r.recording_id}/transcript`).catch(() => null) as Promise<{ transcript?: RenglonFathom[] } | null>,
  ])
  const resumen = s?.summary?.markdown_formatted ?? ''
  const transcript = formatearTranscripcion(t?.transcript ?? null).texto
  if (!resumen && !transcript) throw new Error('Fathom no devolvió resumen ni transcripción')
  return { url: r.share_url || r.url, resumen, transcript }
}

/** Busca las llamadas de varios cierres de una vez (una sola recorrida de /meetings por cuenta) */
export async function llamadasDeCierres(cierres: Cierre[]): Promise<Map<string, LlamadaFathom | Error>> {
  const salida = new Map<string, LlamadaFathom | Error>()
  if (!cierres.length) return salida
  if (!clavesFathom().length) throw new Error('Falta la clave de la API de Fathom (FATHOM_API_KEYS)')
  const fechas = cierres.map((c) => c.fecha).filter((f): f is string => !!f).sort()
  const desde = new Date(Date.parse(`${fechas[0] ?? '2026-01-01'}T00:00:00Z`) - 21 * 86_400_000).toISOString().slice(0, 10)
  const reuniones = await reunionesDesde(desde)
  for (const c of cierres) {
    const r = reunionDeCierre(c, reuniones)
    if (!r) {
      salida.set(c.clave, new Error(c.grabaciones.length ? 'el link de Fathom de la planilla no está en las cuentas conectadas' : 'sin link de Fathom en la planilla'))
      continue
    }
    try {
      salida.set(c.clave, await detalle(r))
    } catch (e) {
      salida.set(c.clave, e as Error)
    }
  }
  return salida
}
