'use server'
// Server actions de Trazabilidad. Cada una vuelve a verificar la sesión y el permiso de la sección.
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { obtenerSesion } from '@/lib/auth/sesion'
import { puedeVer } from '@/lib/auth/roles'
import { BOLSAS, type Bolsa } from '@/lib/trazabilidad/catalogo'
import { leerCierres } from '@/lib/trazabilidad/cierres'
import * as db from '@/lib/trazabilidad/db'
import { procesarLlamadaManual, procesarLlamadas, procesarPendientes, procesarSetting } from '@/lib/trazabilidad/leads'
import { normNombre, type TipoPieza } from '@/lib/trazabilidad/modelo'

export type Estado = { ok?: string; error?: string }

async function quien(): Promise<string> {
  const s = await obtenerSesion()
  if (!s || !puedeVer(s, 'trazabilidad')) throw new Error('Tu sesión venció o no tenés acceso a Trazabilidad.')
  return s.email
}
async function cierre(clave: string) {
  const c = (await leerCierres()).cierres.find((x) => x.clave === clave)
  if (!c) throw new Error('No encontré ese cierre en el CRM (¿cambió el nombre o la fecha?).')
  return c
}
const ruta = (clave: string) => `/trazabilidad/lead/${encodeURIComponent(clave)}`
const fallo = (e: unknown): Estado => ({ error: String((e as Error)?.message ?? e).slice(0, 300) })

export async function vincular(_: Estado, f: FormData): Promise<Estado> {
  try {
    const por = await quien()
    const clave = String(f.get('clave') ?? ''), id = String(f.get('subscriber') ?? '')
    await db.guardarVinculo(clave, id === '__auto' ? null : id === '__ninguno' ? '' : id, por)
    revalidatePath(ruta(clave))
    return { ok: 'Vínculo guardado.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function pegarSetting(_: Estado, f: FormData): Promise<Estado> {
  try {
    const por = await quien()
    const c = await cierre(String(f.get('clave') ?? ''))
    const resumen = String(f.get('resumen') ?? '').trim().slice(0, 40_000)
    const etiquetas = String(f.get('etiquetas') ?? '').split(/\n|,/).map((x) => x.trim()).filter(Boolean).slice(0, 300)
    if (!resumen) return { error: 'Pegá el resumen de la botonera.' }
    const id = `manual:${createHash('sha1').update(c.clave).digest('hex').slice(0, 16)}`
    await db.guardarSetting({ subscriberId: id, nombre: c.nombre, igUsuario: '', telefono: c.telefono, email: c.email, etiquetas, campos: {}, resumen, transcript: '', enviadoPor: por })
    await db.guardarVinculo(c.clave, id, por)
    await procesarSetting(id)
    revalidatePath(ruta(c.clave))
    return { ok: 'Setting guardado y analizado.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function reanalizarSetting(_: Estado, f: FormData): Promise<Estado> {
  try {
    await quien()
    await procesarSetting(String(f.get('subscriber') ?? ''))
    revalidatePath('/trazabilidad', 'layout')
    return { ok: 'Análisis actualizado.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function traerLlamada(_: Estado, f: FormData): Promise<Estado> {
  try {
    await quien()
    const c = await cierre(String(f.get('clave') ?? ''))
    const r = await procesarLlamadas([c])
    revalidatePath(ruta(c.clave))
    return r.ok ? { ok: 'Llamada traída de Fathom y analizada.' } : { error: r.errores[0]?.motivo ?? 'No se pudo traer la llamada.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function pegarLlamada(_: Estado, f: FormData): Promise<Estado> {
  try {
    await quien()
    const c = await cierre(String(f.get('clave') ?? ''))
    const resumen = String(f.get('resumen') ?? '').trim().slice(0, 200_000)
    if (!resumen) return { error: 'Pegá el resumen o la transcripción de la llamada.' }
    await procesarLlamadaManual(c, resumen)
    revalidatePath(ruta(c.clave))
    return { ok: 'Llamada guardada y analizada.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function procesarAhora(): Promise<Estado> {
  try {
    await quien()
    const r = await procesarPendientes({ setting: 8, llamadas: 5 })
    revalidatePath('/trazabilidad', 'layout')
    const partes = [`${r.setting} setting analizados`, `${r.llamadas} llamadas traídas`]
    return r.errores.length ? { ok: partes.join(' · '), error: `${r.errores.length} con problemas: ${r.errores.slice(0, 3).join(' | ')}` } : { ok: partes.join(' · ') }
  } catch (e) {
    return fallo(e)
  }
}

const TIPOS: TipoPieza[] = ['reel', 'carrusel', 'historia', 'anuncio', 'otro']
export async function asignarPieza(_: Estado, f: FormData): Promise<Estado> {
  try {
    await quien()
    const etiqueta = String(f.get('etiqueta') ?? '').trim()
    const angulo = String(f.get('angulo') ?? '') || null
    const tipo = String(f.get('tipo') ?? 'otro') as TipoPieza
    if (!etiqueta) return { error: 'Falta la pieza.' }
    const ids = new Set((await db.listarAngulos()).map((a) => a.id))
    if (angulo && !ids.has(angulo)) return { error: 'Ese ángulo no existe.' }
    await db.asignarPieza(etiqueta, angulo, TIPOS.includes(tipo) ? tipo : 'otro')
    revalidatePath('/trazabilidad', 'layout')
    return { ok: 'Guardado.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function guardarAngulo(_: Estado, f: FormData): Promise<Estado> {
  try {
    await quien()
    const nombre = String(f.get('nombre') ?? '').trim().slice(0, 120)
    if (!nombre) return { error: 'Falta el nombre del ángulo.' }
    const id = String(f.get('id') ?? '').trim() || normNombre(nombre).replace(/ /g, '-').slice(0, 40)
    const bolsa = String(f.get('bolsa') ?? '')
    await db.guardarAngulo({
      id, nombre, descripcion: String(f.get('descripcion') ?? '').trim().slice(0, 400),
      bolsa: (BOLSAS as readonly string[]).includes(bolsa) ? (bolsa as Bolsa) : null, descartado: f.get('descartado') === 'si',
    })
    revalidatePath('/trazabilidad', 'layout')
    return { ok: 'Ángulo guardado.' }
  } catch (e) {
    return fallo(e)
  }
}
