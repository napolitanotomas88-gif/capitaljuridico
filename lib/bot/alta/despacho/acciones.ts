// ── Bot "Capital Jurídico": POST /api/clientes/altas — lo que se hace en «Cargar alta» del Despacho (26/10/2026) ────────
// Un solo pedido multipart (FormData), con `accion`:
//   · previsualizar { texto, closer, archivos[] } → 200 sincrónico: qué entendió el bot. Motor en SECO y almacén en memoria
//     (la misma simulación que POST /api/bot/alta/motor { simular }): no escribe nada, no lee planillas ni comprobantes.
//   · cargar { id, texto, closer, archivos[] } → guarda los comprobantes, registra el EventoAlta (mismo que el webhook de
//     Whapi, origen "despacho") y el motor lo procesa en after(). 202. Repetir el mismo id no crea otra alta.
//   · responder { alta_id, espera_id, texto } → OK / NO / "OK Tomi"…: el MISMO camino que la ruta manual del motor
//     ({ alta_id, responder: { espera_id, texto, por } }), a nombre de quien aprueba. Solo aprobadores.
//   · datos { id, alta_id, espera_id, texto, archivos[] } → lo que falta del closer ("Inicio del servicio: 26/10/2026") y, si
//     lo pide, el comprobante. Un aprobador o el closer de esa alta.
//   · a_mano { alta_id, paso } → comunidad, bienvenida o Skool hechos a mano. Solo aprobadores.
//   · reintentar { alta_id } → el motor vuelve a mirar el alta ahora (sin cron, con el WhatsApp caído nada la despierta).
// Barreras: sesión de Google (401), mismo origen (403), quién puede qué (aprobadores.ts, 403), tamaño (413). La lógica es
// pura con dependencias inyectadas (se prueba sin Next en scripts/test-bot-alta-despacho.mjs); la ruta pasa las reales.
import { randomUUID } from 'node:crypto'
import { parsearAlta } from '../parsear'
import { planDeAlta } from '../plan'
import { hoyArgentina } from '../../../clientes/fechas'
import type { AlmacenAltas, Espera, FilaAlta } from '../motor/almacen'
import type { MotorAltasO } from '../motor/orquestador'
import { PLAZO_INVOCACION_MS, type EventoBot } from '../motor/tipos'
import { aprobadorDe, closerDeSesion, firma, puedeCargar, puedeMarcarAMano, puedeResponder, veAlta, type QuienPide } from './aprobadores'
import type { AlmacenArchivos } from './archivos'
import { esPasoAMano } from './canal'
import { closerValido, eventoAltaDespacho, eventosDatosDespacho, idDespacho, prepararArchivos, type ArchivoSubido } from './evento'
import { QUIEN_TEXTO, TITULO_PASO } from './vista'

export interface DepsAcciones {
  sesion(req: Request): QuienPide | null
  baseLista(): boolean
  almacen(): AlmacenAltas
  archivos(): AlmacenArchivos
  motor(): MotorAltasO
  /** Motor en seco con almacén en memoria (vista previa). */
  simulacion(): { motor: MotorAltasO; almacen: AlmacenAltas }
  enSegundoPlano(fn: () => Promise<void>): void
  closers: Record<string, string>
  ahora(): number
  env?: NodeJS.ProcessEnv
  log?: (m: string) => void
}

export const MAX_CUERPO_BYTES = 4_500_000
const CABECERAS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const res = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: CABECERAS })
const error = (mensaje: string, status: number) => res({ ok: false, mensaje }, status)
const esAltaId = (x: unknown): x is string => typeof x === 'string' && /^alta_[\w.@:-]{3,200}$/.test(x)
const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === 'string' ? v : '' }
const motivoDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

/** ¿El Origin es del mismo host que la petición? (copia de lib/bot/kickoff/acciones.ts: mismoOrigen) */
export function mismoOrigen(h: { get(n: string): string | null }): boolean {
  const origen = h.get('origin'), host = h.get('host')
  if (!origen || !host) return false
  try { return new URL(origen).host === host } catch { return false }
}

async function archivosDe(f: FormData): Promise<ArchivoSubido[]> {
  const out: ArchivoSubido[] = []
  for (const v of f.getAll('archivos')) {
    if (typeof v === 'string' || !v || typeof (v as Blob).arrayBuffer !== 'function') continue
    const b = v as File
    if (!b.size) continue
    out.push({ nombre: b.name ?? 'comprobante', mime: b.type ?? '', bytes: new Uint8Array(await b.arrayBuffer()) })
  }
  return out
}

/** Vista previa: lo que entendió el bot del alta, sin escribir nada. */
export async function vistaPrevia(p: { texto: string; closer: string; archivos: ArchivoSubido[]; deps: Pick<DepsAcciones, 'simulacion' | 'closers' | 'ahora'> }) {
  const pa = prepararArchivos(p.archivos)
  if (!pa.ok) return { ok: false as const, mensaje: pa.error }
  const id = `despacho-sim${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const r = eventoAltaDespacho({ id, texto: p.texto, closer: p.closer, archivos: pa.archivos, ahora: p.deps.ahora(), closers: p.deps.closers })
  if (!r.ok) return { ok: false as const, mensaje: r.error }
  const { motor, almacen } = p.deps.simulacion()
  await motor.registrar([r.evento])
  const proc = await motor.procesar([r.evento], { hasta: p.deps.ahora() + PLAZO_INVOCACION_MS, invocacion: 'vista-previa' })
  const alta = await almacen.leerAlta(`alta_${id}`)
  const a = parsearAlta(r.evento.texto)
  return {
    ok: true as const,
    tipo: r.tipo,
    datos: {
      nombre: a.nombre, closer: a.closer, programa: a.programa, telefono: a.telefonos[0]?.numero ?? null,
      correo: a.correo, modalidad: a.modalidad, totalUsd: a.totalUsd, estePagoUsd: a.estePagoUsd, pagoEnPesos: a.pagoEnPesos, inicio: a.inicio, socios: a.socios,
    },
    comprobantes: pa.archivos.map((x) => ({ nombre: x.nombre, mime: x.mime, bytes: x.bytes })),
    faltantes: a.faltantes, avisos: a.avisos,
    preguntas: (alta?.esperas ?? []).map((e: Espera) => ({ quien: QUIEN_TEXTO[e.quien], paso: TITULO_PASO[e.paso], texto: String(e.datos?.texto ?? e.pedido.join('\n')) })),
    haria: proc.registro.map((x) => x.replace(/^alta_\S+: /, '')),
    plan: planDeAlta(a, hoyArgentina(new Date(p.deps.ahora()))).map((x) => ({ titulo: x.titulo, enEspera: x.enEspera })),
  }
}

export async function atenderAcciones(req: Request, deps: DepsAcciones): Promise<Response> {
  const env = deps.env ?? process.env
  const log = deps.log ?? ((m: string) => console.info(m))
  const s = deps.sesion(req)
  if (!s) return error('Tu sesión venció. Recargá la página y entrá de nuevo.', 401)
  if (!mismoOrigen(req.headers)) return error('Origen no permitido.', 403)
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CUERPO_BYTES) return error('Los archivos pesan demasiado (como mucho 4,4 MB entre todos).', 413)
  if (!/^multipart\/form-data\b/i.test(req.headers.get('content-type') ?? '')) return error('Se espera un formulario.', 415)
  let f: FormData
  try { f = await req.formData() } catch { return error('No se pudo leer el formulario.', 400) }
  const accion = str(f, 'accion')
  const t0 = deps.ahora()
  const op = { hasta: t0 + PLAZO_INVOCACION_MS, invocacion: `despacho-${randomUUID().slice(0, 8)}` }
  const fondo = (que: string, fn: () => Promise<{ errores: string[] } | void>) => deps.enSegundoPlano(async () => {
    try { const r = await fn(); if (r?.errores.length) log(`bot-alta-despacho: ${op.invocacion} ${que} — ${r.errores.length} error(es): ${r.errores.slice(0, 3).join(' | ').slice(0, 300)}`) }
    catch (e) { log(`bot-alta-despacho: ${op.invocacion} ${que} falló: ${motivoDe(e)}`) }
  })

  // ── Cargar y vista previa ──
  if (accion === 'previsualizar' || accion === 'cargar') {
    if (!puedeCargar(s, env)) return error('Cargan altas los closers, Aylu, Gero A, Tomás y Gero M.', 403)
    // Un closer carga solo a su nombre; un aprobador elige el closer
    const propio = aprobadorDe(s, env) ? null : closerDeSesion(s)
    const closer = propio ?? closerValido(str(f, 'closer'))
    if (!closer) return error('Elegí el closer.', 422)
    if (propio && closerValido(str(f, 'closer')) && closerValido(str(f, 'closer')) !== propio) return error(`Solo podés cargar altas tuyas (${propio}).`, 403)
    const archivos = await archivosDe(f)
    if (accion === 'previsualizar') {
      const v = await vistaPrevia({ texto: str(f, 'texto'), closer, archivos, deps })
      return res(v, v.ok ? 200 : 422)
    }
    if (!deps.baseLista()) return error('Falta DATABASE_URL: el motor no tiene dónde guardar el alta.', 503)
    const id = idDespacho(str(f, 'id'))
    if (!id) return error('Falta el id del envío: recargá la página.', 400)
    if (!archivos.length) return error('Subí el comprobante (imagen o PDF).', 422)
    const pa = prepararArchivos(archivos)
    if (!pa.ok) return error(pa.error, 422)
    const r = eventoAltaDespacho({ id, texto: str(f, 'texto'), closer, archivos: pa.archivos, ahora: t0, closers: deps.closers })
    if (!r.ok) return error(r.error, 422)
    try {
      await deps.archivos().guardar(pa.archivos)
      const reg = await deps.motor().registrar([r.evento])
      if (reg.repetidos.includes(r.evento.clave) && !reg.nuevos.some((e) => e.clave === r.evento.clave)) {
        return res({ ok: true, repetida: true, altaId: `alta_${id}`, mensaje: 'Esta alta ya estaba cargada.' })
      }
    } catch (e) {
      log(`bot-alta-despacho: no se pudo registrar el alta ${id}: ${motivoDe(e)}`)
      return error('No se pudo guardar el alta (la base no respondió). No se cargó nada: probá de nuevo.', 503)
    }
    fondo('cargar', () => deps.motor().procesar([r.evento], op))
    log(`bot-alta-despacho: alta ${id} cargada (${r.tipo}, ${pa.archivos.length} comprobante(s)) por ${firma(s, aprobadorDe(s, env))}`)
    return res({ ok: true, altaId: `alta_${id}`, tipo: r.tipo, mensaje: r.tipo === 'libre' ? 'Alta cargada. Como no trae #ALTA, primero se confirma en Verificaciones ("¿Esto es un alta?").' : 'Alta cargada: el bot la está procesando.' }, 202)
  }

  // ── Acciones sobre un alta ──
  if (!['responder', 'datos', 'a_mano', 'reintentar'].includes(accion)) return error('Acción desconocida.', 400)
  if (!deps.baseLista()) return error('Falta DATABASE_URL.', 503)
  const altaId = str(f, 'alta_id')
  if (!esAltaId(altaId)) return error('Falta el alta.', 400)
  let alta: FilaAlta | null
  try { alta = await deps.almacen().leerAlta(altaId) } catch { return error('La base no respondió: probá de nuevo.', 503) }
  if (!alta || !veAlta(s, alta, env)) return error('No encontré esa alta.', 404)

  if (accion === 'reintentar') {
    fondo('reintentar', () => deps.motor().avanzar(altaId, op))
    return res({ ok: true, mensaje: 'El bot vuelve a mirar el alta.' }, 202)
  }
  if (accion === 'a_mano') {
    const paso = str(f, 'paso')
    if (!esPasoAMano(paso)) return error('Ese paso no se hace a mano.', 400)
    if (!puedeMarcarAMano(s, env)) return error('Solo Tomás, Gero A, Aylu y Gero M marcan pasos hechos a mano.', 403)
    const por = firma(s, aprobadorDe(s, env))
    fondo('a mano', () => deps.motor().hechoAMano(altaId, paso, por, op))
    return res({ ok: true, mensaje: `${TITULO_PASO[paso]}: marcado hecho a mano.` }, 202)
  }

  const esperaId = str(f, 'espera_id')
  const e = alta.esperas.find((x) => x.id === esperaId)
  if (!e || e.estado !== 'abierta') return error('Ese pedido ya no está abierto (se respondió o hubo uno más nuevo): recargá la página.', 409)
  if (!puedeResponder(s, e, alta, env)) {
    return error(e.quien === 'closer' ? 'Estos datos los completa el closer de esta alta o un aprobador.' : 'Solo Tomás, Gero A, Aylu y Gero M pueden aprobar.', 403)
  }
  const texto = str(f, 'texto').replace(/\r\n?/g, '\n').trim()
  const por = firma(s, aprobadorDe(s, env))

  if (accion === 'responder') {
    if (e.quien === 'closer') return error('Ese pedido es de datos del closer: usá el formulario de datos.', 400)
    if (!/^(ok|no)\b/i.test(texto) || texto.length > 500) return error('La respuesta tiene que empezar con OK o NO.', 422)
    fondo('responder', () => deps.motor().responder(altaId, { esperaId, texto, por }, op))
    return res({ ok: true, mensaje: `Respuesta "${texto.slice(0, 60)}" enviada a nombre de ${por}.` }, 202)
  }

  // datos del closer
  if (e.quien !== 'closer') return error('Ese pedido es un OK / NO, no un dato.', 400)
  if (texto.length > 5_000) return error('El texto es demasiado largo.', 413)
  const archivos = await archivosDe(f)
  if (!texto && !archivos.length) return error('Escribí el dato que falta ("Clave: valor") o subí el comprobante.', 422)
  if (!archivos.length) {
    fondo('datos', () => deps.motor().responder(altaId, { esperaId, texto, por }, op))
    return res({ ok: true, mensaje: 'Datos enviados: el bot los suma al alta.' }, 202)
  }
  const pa = prepararArchivos(archivos)
  if (!pa.ok) return error(pa.error, 422)
  const id = idDespacho(str(f, 'id')) ?? `despacho-${randomUUID().replace(/-/g, '')}`
  const eventos: EventoBot[] = eventosDatosDespacho({ id, alta, texto, archivos: pa.archivos, ahora: t0 })
  try {
    await deps.archivos().guardar(pa.archivos)
    await deps.motor().registrar(eventos)
  } catch (x) {
    log(`bot-alta-despacho: no se pudieron registrar los datos de ${altaId}: ${motivoDe(x)}`)
    return error('No se pudo guardar (la base no respondió). Probá de nuevo.', 503)
  }
  fondo('datos con archivos', () => deps.motor().procesar(eventos, op))
  return res({ ok: true, mensaje: 'Datos y comprobante enviados: el bot los suma al alta.' }, 202)
}
