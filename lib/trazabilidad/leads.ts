// ── Une las tres capas por lead y procesa lo pendiente ───────────────────────────────────────
// Closing = CRM (cierres.ts) · Setting = envío de la botonera (vinculado a mano o por teléfono/mail/nombre) · Llamada = Fathom.
import 'server-only'
import { analizarLlamada, analizarSetting } from './analisis'
import { leerCierres } from './cierres'
import * as db from './db'
import { llamadasDeCierres } from './fathom'
import { mejorVinculo, type Cierre, type FilaSetting, type LeadTraz } from './modelo'

export interface DatosTraz {
  leads: LeadTraz[]
  envios: FilaSetting[]
  angulos: Awaited<ReturnType<typeof db.listarAngulos>>
  piezas: Awaited<ReturnType<typeof db.listarPiezas>>
  leidoEn: string
}

export async function cargarDatos(): Promise<DatosTraz> {
  const [{ cierres, leidoEn }, envios, llamadas, vinculos, angulos, piezas] = await Promise.all([
    leerCierres(), db.listarSetting(), db.listarLlamadas(), db.listarVinculos(), db.listarAngulos(), db.listarPiezas(),
  ])
  const porId = new Map(envios.map((e) => [e.subscriberId, e]))
  const porClave = new Map(llamadas.map((l) => [l.clave, l]))
  const leads = cierres.map((cierre): LeadTraz => {
    const manual = vinculos.get(cierre.clave)
    const setting = manual !== undefined ? (manual ? porId.get(manual) ?? null : null) : mejorVinculo(cierre, envios)
    return { cierre, setting, vinculoManual: manual !== undefined, llamada: porClave.get(cierre.clave) ?? null }
  })
  return { leads, envios, angulos, piezas, leidoEn }
}

export async function procesarSetting(id: string): Promise<void> {
  const s = await db.obtenerSetting(id)
  if (!s) throw new Error('No existe ese envío de la botonera')
  const [angulos, piezas] = await Promise.all([db.listarAngulos(), db.listarPiezas()])
  try {
    const a = await analizarSetting(
      { resumen: s.resumen, etiquetas: s.etiquetas, campos: s.campos, transcript: s.transcript, nombre: s.nombre || s.igUsuario },
      angulos, new Map([...piezas].map(([k, p]) => [k, p.angulo])),
    )
    await db.guardarAnalisisSetting(id, a, null)
    for (const p of a.piezas) await db.proponerPieza({ etiqueta: p.etiqueta, angulo: p.angulo, tipo: p.tipo })
  } catch (e) {
    await db.guardarAnalisisSetting(id, null, String((e as Error).message ?? e).slice(0, 300))
    throw e
  }
}

/** Trae de Fathom y analiza las llamadas de estos cierres (pisa lo que hubiera) */
export async function procesarLlamadas(cierres: Cierre[]): Promise<{ ok: number; errores: { nombre: string; motivo: string }[] }> {
  const angulos = await db.listarAngulos()
  const encontradas = await llamadasDeCierres(cierres)
  let ok = 0
  const errores: { nombre: string; motivo: string }[] = []
  for (const c of cierres) {
    const f = encontradas.get(c.clave)
    if (!f || f instanceof Error) {
      const motivo = f?.message ?? 'no encontrada'
      errores.push({ nombre: c.nombre, motivo })
      await db.guardarLlamada(c.clave, { url: c.grabaciones.at(-1) ?? '', resumen: '', transcript: '', analisis: null, error: motivo })
      continue
    }
    try {
      const a = await analizarLlamada({ nombre: c.nombre, resumen: f.resumen, transcript: f.transcript }, angulos)
      await db.guardarLlamada(c.clave, { ...f, analisis: a, error: null })
      ok++
    } catch (e) {
      const motivo = String((e as Error).message ?? e).slice(0, 300)
      errores.push({ nombre: c.nombre, motivo })
      await db.guardarLlamada(c.clave, { ...f, analisis: null, error: motivo })
    }
  }
  return { ok, errores }
}

/** Analiza un resumen de llamada pegado a mano (sin Fathom) */
export async function procesarLlamadaManual(c: Cierre, resumen: string): Promise<void> {
  const angulos = await db.listarAngulos()
  const a = await analizarLlamada({ nombre: c.nombre, resumen, transcript: '' }, angulos)
  await db.guardarLlamada(c.clave, { url: c.grabaciones.at(-1) ?? '', resumen, transcript: '', analisis: a, error: null })
}

/**
 * Lo que hace el cron diario y el botón "Procesar pendientes": analiza los envíos de la botonera sin análisis y trae las
 * llamadas de los cierres que todavía no la tienen (los que ya fallaron por "no encontrada" se reintentan una vez por día).
 * Con topes para no pasar el tiempo de la función.
 */
export async function procesarPendientes(topes = { setting: 12, llamadas: 8 }): Promise<{ setting: number; llamadas: number; errores: string[] }> {
  const datos = await cargarDatos()
  const errores: string[] = []
  let setting = 0
  for (const e of datos.envios.filter((x) => !x.analisis && !x.error).slice(0, topes.setting)) {
    try {
      await procesarSetting(e.subscriberId)
      setting++
    } catch (err) {
      errores.push(`Setting ${e.nombre || e.subscriberId}: ${(err as Error).message}`)
    }
  }
  const sinLlamada = datos.leads.filter((l) => !l.llamada?.analisis && !(l.llamada?.error && Date.now() - Date.parse(l.llamada.actualizado) < 20 * 3_600_000)).map((l) => l.cierre)
  let llamadas = 0
  if (sinLlamada.length) {
    try {
      const r = await procesarLlamadas(sinLlamada.slice(0, topes.llamadas))
      llamadas = r.ok
      errores.push(...r.errores.map((x) => `Llamada ${x.nombre}: ${x.motivo}`))
    } catch (err) {
      errores.push(`Llamadas: ${(err as Error).message}`)
    }
  }
  return { setting, llamadas, errores }
}
