// ── Setting desde la API pública de ManyChat (sin la botonera) ───────────────────────────────
// ManyChat etiqueta a cada contacto con el nombre de cada reel, carrusel e historia con el que interactuó: eso es el
// "contenido consumido". Esta capa busca a cada cierre del CRM en ManyChat (mail → teléfono → nombre único) y guarda sus
// etiquetas y campos como un envío más de cj_traz_setting (sin el chat: el chat solo lo trae la botonera).
// Clave: MANYCHAT_API_KEY en Vercel (ManyChat → Configuración → API). Nunca se loguea ni se devuelve.
import 'server-only'
import * as db from './db'
import { cargarDatos } from './leads'
import { nombreCoincide, normEmail, variantesTelefono, type Cierre } from './modelo'

const BASE = 'https://api.manychat.com/fb'

export const manychatConfigurado = () => !!process.env.MANYCHAT_API_KEY?.trim()

async function mc<T>(ruta: string): Promise<T | null> {
  const r = await fetch(`${BASE}${ruta}`, { headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_KEY?.trim()}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  if (r.status === 429) throw new Error('ManyChat: demasiadas consultas (429)')
  if (r.status === 401 || r.status === 403) throw new Error('ManyChat rechazó la clave (MANYCHAT_API_KEY)')
  const j = (await r.json().catch(() => null)) as { status?: string; data?: T } | null
  if (!j || j.status !== 'success') return null
  return (j.data ?? null) as T | null
}

export interface SuscriptorMC {
  id: string | number; name?: string; first_name?: string; last_name?: string; ig_username?: string; phone?: string; email?: string
  subscribed?: string; last_interaction?: string; tags?: { name: string }[]; custom_fields?: { name: string; value: unknown }[]
}

type Via = 'email' | 'telefono' | 'nombre'
export async function buscarEnManyChat(c: Cierre): Promise<{ s: SuscriptorMC; via: Via } | { ambiguo: true } | null> {
  if (normEmail(c.email).includes('@')) {
    const s = await mc<SuscriptorMC>(`/subscriber/findBySystemField?email=${encodeURIComponent(normEmail(c.email))}`)
    if (s?.id) return { s, via: 'email' }
  }
  for (const tel of variantesTelefono(c.telefono)) {
    const s = await mc<SuscriptorMC>(`/subscriber/findBySystemField?phone=${encodeURIComponent(tel)}`)
    if (s?.id) return { s, via: 'telefono' }
  }
  const lista = (await mc<SuscriptorMC[]>(`/subscriber/findByName?name=${encodeURIComponent(c.nombre.trim())}`)) ?? []
  const iguales = lista.filter((s) => nombreCoincide(c.nombre, s))
  if (iguales.length === 1) return { s: iguales[0], via: 'nombre' }
  if (iguales.length > 1) return { ambiguo: true }
  return null
}

export interface ResultadoImportacion {
  revisados: number
  encontrados: Record<Via, number>
  ambiguos: string[]
  sinMatch: string[]
  importados: number
  errores: string[]
}

/** Guarda las etiquetas y campos del contacto como envío "ManyChat API" (salvo que ya haya uno de la botonera) y vincula el cierre */
async function guardarContacto(c: Cierre, id: string, via: string, previoInfo?: SuscriptorMC): Promise<SuscriptorMC> {
  const info = (await mc<SuscriptorMC>(`/subscriber/getInfo?subscriber_id=${encodeURIComponent(id)}`)) ?? previoInfo
  if (!info) throw new Error(`ManyChat no devolvió el contacto ${id}`)
  const previo = await db.obtenerSetting(id)
  if (!previo || previo.enviadoPor === 'ManyChat API') {
    const etiquetas = (info.tags ?? []).map((t) => t.name).filter(Boolean)
    const campos = Object.fromEntries((info.custom_fields ?? []).filter((f) => f?.name && f.value !== null && f.value !== '').map((f) => [f.name, String(f.value).slice(0, 500)]))
    const nombre = info.name || [info.first_name, info.last_name].filter(Boolean).join(' ')
    await db.guardarSetting({
      subscriberId: id, nombre, igUsuario: info.ig_username ?? '', telefono: info.phone ?? '', email: info.email ?? '', etiquetas, campos,
      resumen: [
        'Importado de la API de ManyChat: etiquetas y campos del contacto, SIN la conversación (el chat solo lo trae la botonera).',
        `Contacto: ${nombre}${info.ig_username ? ` (@${info.ig_username})` : ''}. Encontrado por ${via}.`,
        `Suscripto a ManyChat: ${info.subscribed ?? 'sin dato'} (tomalo como primera interacción). Última interacción: ${info.last_interaction ?? 'sin dato'}.`,
        `Llamada de venta en el CRM: ${c.fecha ?? 'sin fecha'} (la agenda suele ser 1 a 7 días antes; usala como referencia de fecha_agenda si no hay otra).`,
        `Etiquetas: ${etiquetas.length}.`,
      ].join('\n'),
      transcript: '', enviadoPor: 'ManyChat API',
    })
  }
  await db.guardarVinculo(c.clave, id, `manychat-api:${via}`)
  return info
}

export interface RevisionPar { clave: string; nombreCRM: string; id: string; mcNombre: string | null; ig: string | null; etiquetas: number; guardado: boolean; error?: string }

/**
 * Pares cierre → contacto de ManyChat ya cruzados afuera (p. ej. por el Instagram de Calendly). Con escribir=false solo
 * devuelve nombre e Instagram de ManyChat para revisar que sea la misma persona; con escribir=true además guarda y vincula.
 */
export async function importarPares(pares: { clave: string; subscriber_id: string; via?: string }[], escribir: boolean): Promise<RevisionPar[]> {
  if (!manychatConfigurado()) throw new Error('Falta MANYCHAT_API_KEY en Vercel')
  const { leads } = await cargarDatos()
  const porClave = new Map(leads.map((l) => [l.cierre.clave, l.cierre]))
  const out: RevisionPar[] = []
  for (const p of pares.slice(0, 200)) {
    const c = porClave.get(p.clave)
    const id = String(p.subscriber_id).replace(/\D/g, '')
    if (!c || !id) { out.push({ clave: p.clave, nombreCRM: c?.nombre ?? '', id, mcNombre: null, ig: null, etiquetas: 0, guardado: false, error: c ? 'id inválido' : 'cierre no encontrado' }); continue }
    try {
      const info = escribir ? await guardarContacto(c, id, p.via ?? 'cruce') : await mc<SuscriptorMC>(`/subscriber/getInfo?subscriber_id=${encodeURIComponent(id)}`)
      out.push({ clave: p.clave, nombreCRM: c.nombre, id, mcNombre: info ? info.name || [info.first_name, info.last_name].filter(Boolean).join(' ') : null, ig: info?.ig_username ?? null, etiquetas: info?.tags?.length ?? 0, guardado: escribir && !!info })
    } catch (e) {
      out.push({ clave: p.clave, nombreCRM: c.nombre, id, mcNombre: null, ig: null, etiquetas: 0, guardado: false, error: (e as Error).message })
      if (/clave|429/.test((e as Error).message)) break
    }
  }
  return out
}

/**
 * Busca en ManyChat los cierres sin setting (y sin vínculo manual) y, si escribir=true, guarda sus etiquetas y campos y los
 * vincula. Un envío de la botonera ya existente para ese contacto no se pisa (la botonera trae el chat): solo se vincula.
 */
export async function importarDesdeManyChat({ escribir, tope }: { escribir: boolean; tope: number }): Promise<ResultadoImportacion> {
  if (!manychatConfigurado()) throw new Error('Falta MANYCHAT_API_KEY en Vercel')
  const datos = await cargarDatos()
  const pendientes = datos.leads.filter((l) => !l.setting && !l.vinculoManual).slice(0, tope)
  const r: ResultadoImportacion = { revisados: 0, encontrados: { email: 0, telefono: 0, nombre: 0 }, ambiguos: [], sinMatch: [], importados: 0, errores: [] }
  for (const l of pendientes) {
    r.revisados++
    try {
      const m = await buscarEnManyChat(l.cierre)
      if (!m) { r.sinMatch.push(l.cierre.nombre); continue }
      if ('ambiguo' in m) { r.ambiguos.push(l.cierre.nombre); continue }
      r.encontrados[m.via]++
      if (!escribir) continue
      await guardarContacto(l.cierre, String(m.s.id), m.via, m.s)
      r.importados++
    } catch (e) {
      r.errores.push(`${l.cierre.nombre}: ${(e as Error).message}`)
      if (/clave|429/.test((e as Error).message)) break
    }
  }
  return r
}
