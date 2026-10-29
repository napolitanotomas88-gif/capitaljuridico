// ── Bot "Capital Jurídico": lógica de /api/bot/alta/motor (diseño del motor, sección 9) ──────────────────────────────
// Está acá y no en route.ts para poder probarla sin Next (un route.ts solo puede exportar GET/POST/dynamic/maxDuration…).
// Solo con "Authorization: Bearer <CRON_SECRET>" (accesoMaquina, tiempo constante; nunca ?key=). Falla cerrado.
// POST (JSON):
//   · { alta_id, cadena? }                       → 202 y avanzar en after() (continuación de otra invocación)
//   · { alta_id, no_antes_de, salto? }           → 202 y DESPERTADOR: duerme hasta esa hora (como mucho 270 s por salto, 3
//                                                  saltos) y dispara una invocación NUEVA con los 300 s completos (punto 15)
//   · { barrer: true }                           → 202 y barrido (red de seguridad, a mano o con un cron diario)
//   · { alta_id, forzar_paso }                   → 202: saca un paso de 'revisar' cuando ya se arregló a mano
//   · { alta_id, rehacer_en_real: true }         → 202 solo si el entorno está en real (un alta seca no pasa a real sola)
//   · { alta_id, responder: { espera_id, texto, por } } → 202: responde una espera sin cita (probar en seco / destrabar)
//   · { simular: { texto, autor? } }             → 200 sincrónico, almacén en memoria y TODO en seco: el plan y lo que haría,
//                                                  sin persistir nada (sirve para probar antes de tener el chip)
// GET ?alta_id= → estado y pasos, sin textos sensibles; sin alta_id, las últimas 20.
import { randomUUID } from 'node:crypto'
import { parsearAlta } from '../parsear'
import { planDeAlta } from '../plan'
import { hoyArgentina } from '../../../clientes/fechas'
import type { AlmacenAltas } from './almacen'
import type { MotorAltasO } from './orquestador'
import { vistaAlta } from './orquestador'
import type { EventoAlta, PasoId, ResumenProceso } from './tipos'
import { PASOS, PLAZO_INVOCACION_MS } from './tipos'
import type { ModoMotor } from './modo'

export const DESPERTADOR_MAX_SALTO_MS = 270_000
export const DESPERTADOR_MAX_SALTOS = 3

export interface DepsRutaMotor {
  autorizado: (req: Request) => boolean
  baseConfigurada: () => boolean
  /** El motor de verdad (Neon + dependencias del entorno). */
  motor: () => MotorAltasO
  almacen: () => AlmacenAltas
  /** Motor de simulación: almacén en memoria y modo seco (nada sale). */
  motorSimulacion: () => { motor: MotorAltasO; almacen: AlmacenAltas }
  modoEntorno: ModoMotor
  enSegundoPlano: (fn: () => Promise<void>) => void
  dispararMotor: (cuerpo: Record<string, unknown>) => Promise<void>
  despertador: boolean
  dormir: (ms: number) => Promise<void>
  ahora: () => number
  log?: (m: string) => void
}

const SIN_CACHE = { 'Cache-Control': 'no-store' }
const responder = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { ...SIN_CACHE, 'Content-Type': 'application/json' } })
const esId = (x: unknown): x is string => typeof x === 'string' && /^alta_[\w.@:-]{3,200}$/.test(x)
const esPaso = (x: unknown): x is PasoId => typeof x === 'string' && (PASOS as readonly string[]).includes(x)
const resumenCorto = (r: ResumenProceso) => ({ altas: r.altas, continuaciones: r.continuaciones, errores: r.errores.length })

export async function atenderMotor(req: Request, deps: DepsRutaMotor): Promise<Response> {
  if (!deps.autorizado(req)) return responder({ error: 'no autorizado' }, 401)
  const t0 = deps.ahora()
  const largo = Number(req.headers.get('content-length') ?? 0)
  if (largo > 200_000) return responder({ error: 'cuerpo demasiado grande' }, 413)
  let b: Record<string, unknown>
  try {
    const texto = await req.text()
    if (texto.length > 200_000) return responder({ error: 'cuerpo demasiado grande' }, 413)
    b = JSON.parse(texto)
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('no es un objeto')
  } catch {
    return responder({ error: 'JSON inválido' }, 400)
  }
  const invocacion = `motor-${randomUUID().slice(0, 8)}`
  const hasta = t0 + PLAZO_INVOCACION_MS
  const log = deps.log ?? ((m: string) => console.info(m))
  const enFondo = (que: string, fn: () => Promise<ResumenProceso | void>) => deps.enSegundoPlano(async () => {
    try {
      const r = await fn()
      if (r) log(`bot-alta-motor: ${invocacion} ${que} — ${JSON.stringify(resumenCorto(r))}`)
    } catch (e) {
      log(`bot-alta-motor: ${invocacion} ${que} falló: ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)}`)
    }
  })

  // Simulación: sincrónica, en memoria y en seco
  if (b.simular !== undefined) {
    const s = b.simular as { texto?: unknown; autor?: unknown }
    if (!s || typeof s.texto !== 'string' || !/#\s*alta\b/i.test(s.texto) || s.texto.length > 20_000) return responder({ error: 'simular.texto tiene que ser un #ALTA' }, 400)
    const { motor, almacen } = deps.motorSimulacion()
    const id = `sim${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const ahoraIso = new Date(deps.ahora()).toISOString()
    const ev: EventoAlta = {
      tipo: 'alta', grupo: 'ventas', clave: id, mensajeId: id, chatId: 'simulacion@g.us', texto: s.texto, medios: [],
      autor: { telefono: typeof s.autor === 'string' ? s.autor.replace(/\D/g, '') || null : '5490000000000', lid: null, nombre: 'simulación' },
      enviadoEn: ahoraIso, recibidoEn: ahoraIso, citado: null,
    }
    await motor.registrar([ev])
    const r = await motor.procesar([ev], { hasta: deps.ahora() + PLAZO_INVOCACION_MS, invocacion })
    const alta = await almacen.leerAlta(`alta_${id}`)
    const pasos = alta ? await almacen.leerPasos(alta.id) : undefined
    const a = parsearAlta(s.texto)
    return responder({
      modo: 'seco', alta: alta ? vistaAlta(alta, pasos) : null, haria: r.registro, errores: r.errores,
      plan: planDeAlta(a, hoyArgentina(new Date(deps.ahora()))).map((p) => ({ id: p.id, titulo: p.titulo, enEspera: p.enEspera, humano: p.humano })),
      faltantes: a.faltantes, avisos: a.avisos,
    })
  }

  if (!deps.baseConfigurada()) return responder({ error: 'falta DATABASE_URL' }, 503)

  if (b.barrer === true) {
    enFondo('barrido', () => deps.motor().barrer({ hasta, invocacion, limite: 10 }))
    return responder({ aceptado: true, que: 'barrido' }, 202)
  }
  if (!esId(b.alta_id)) return responder({ error: 'falta alta_id' }, 400)
  const altaId = b.alta_id

  if (b.responder !== undefined) {
    const r = b.responder as { espera_id?: unknown; texto?: unknown; por?: unknown }
    if (!r || typeof r.espera_id !== 'string' || typeof r.texto !== 'string' || typeof r.por !== 'string' || !r.por.trim() || r.texto.length > 5_000) return responder({ error: 'responder necesita espera_id, texto y por' }, 400)
    enFondo('responder', () => deps.motor().responder(altaId, { esperaId: r.espera_id as string, texto: r.texto as string, por: (r.por as string).trim().slice(0, 60) }, { hasta, invocacion }))
    return responder({ aceptado: true, que: 'responder' }, 202)
  }
  if (b.forzar_paso !== undefined) {
    if (!esPaso(b.forzar_paso)) return responder({ error: 'forzar_paso no es un paso' }, 400)
    const paso = b.forzar_paso
    enFondo('forzar paso', () => deps.motor().avanzar(altaId, { hasta, invocacion, forzarPaso: paso }))
    return responder({ aceptado: true, que: 'forzar_paso' }, 202)
  }
  if (b.rehacer_en_real === true) {
    if (deps.modoEntorno !== 'real') return responder({ error: 'el entorno no está en modo real (BOT_ALTA_MODO)' }, 409)
    enFondo('rehacer en real', () => deps.motor().avanzar(altaId, { hasta, invocacion, rehacerEnReal: true }))
    return responder({ aceptado: true, que: 'rehacer_en_real' }, 202)
  }
  if (b.no_antes_de !== undefined) {
    const cuando = typeof b.no_antes_de === 'string' ? Date.parse(b.no_antes_de) : NaN
    const salto = Number.isInteger(b.salto) ? Number(b.salto) : 0
    if (!Number.isFinite(cuando)) return responder({ error: 'no_antes_de inválido' }, 400)
    if (!deps.despertador) return responder({ aceptado: false, que: 'despertador apagado (BOT_ALTA_DESPERTADOR=0)' }, 200)
    enFondo('despertador', async () => {
      const falta = cuando - deps.ahora()
      if (falta <= DESPERTADOR_MAX_SALTO_MS) {
        if (falta > 0) await deps.dormir(falta)
        // Invocación nueva con los 300 s completos (avanzar acá dejaría ~15 s)
        await deps.dispararMotor({ alta_id: altaId })
      } else if (salto + 1 < DESPERTADOR_MAX_SALTOS) {
        await deps.dormir(DESPERTADOR_MAX_SALTO_MS)
        await deps.dispararMotor({ alta_id: altaId, no_antes_de: new Date(cuando).toISOString(), salto: salto + 1 })
      }
    })
    return responder({ aceptado: true, que: 'despertador' }, 202)
  }
  const cadena = Number.isInteger(b.cadena) ? Number(b.cadena) : 0
  enFondo('avanzar', () => deps.motor().avanzar(altaId, { hasta, invocacion, cadena }))
  return responder({ aceptado: true, que: 'avanzar' }, 202)
}

export async function estadoMotor(req: Request, deps: Pick<DepsRutaMotor, 'autorizado' | 'baseConfigurada' | 'almacen' | 'modoEntorno'>): Promise<Response> {
  if (!deps.autorizado(req)) return responder({ error: 'no autorizado' }, 401)
  if (!deps.baseConfigurada()) return responder({ modo: deps.modoEntorno, error: 'falta DATABASE_URL' }, 503)
  const id = new URL(req.url).searchParams.get('alta_id')
  const almacen = deps.almacen()
  if (id) {
    if (!esId(id)) return responder({ error: 'alta_id inválido' }, 400)
    const alta = await almacen.leerAlta(id)
    if (!alta) return responder({ error: 'no existe' }, 404)
    return responder({ modo: deps.modoEntorno, alta: vistaAlta(alta, await almacen.leerPasos(id)) })
  }
  return responder({ modo: deps.modoEntorno, altas: (await almacen.ultimas(20)).map((a) => vistaAlta(a)) })
}
