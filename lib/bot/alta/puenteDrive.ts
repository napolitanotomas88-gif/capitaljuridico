// ── Bot "Capital Jurídico": cliente del "Puente Drive · Despacho" (docs/BOT-ALTA-CJ.md, sección "Puente Drive") ──────
// Solo de servidor. El puente es un Apps Script publicado como aplicación web con la cuenta administradora configurada: la cuenta
// de servicio no tiene cuota de Drive, así que los archivos del bot (comprobantes, carpetas, docs) los crea el puente.
// Variables de entorno: PUENTE_DRIVE_URL y PUENTE_DRIVE_SECRETO (.env.local / Vercel). NUNCA se imprimen ni se
// devuelven en un error: los mensajes de este módulo no incluyen la URL ni el secreto.
// Desde Node: fetch con redirect: 'follow' (la aplicación web responde con un 302 a googleusercontent).
// Acciones que usa el bot: subirArchivo (si ya hay un archivo con ese nombre en la carpeta, devuelve ese y
// yaExistia: true, sin duplicarlo) y aPapelera (deshacer una carga a medias y limpiar las pruebas; se recupera durante
// 30 días; el puente solo acepta archivos de "Subidos" o de una carpeta "PRUEBA BOT…"). Para la carpeta del cliente
// (driveCliente.ts): crearCarpeta, crearDoc y copiarArchivo (también devuelven el existente con yaExistia: true; el
// puente solo copia archivos cuyo nombre empieza con "Plantilla") y aPapeleraCarpeta (solo pruebas: el puente solo
// acepta carpetas cuyo nombre empieza con "PRUEBA BOT"). ping devuelve la cuenta y la versión del puente.
// copiarArchivo y aPapeleraCarpeta son del 24/10/2026: si Tomás todavía no publicó esa versión del Apps Script, el puente
// responde "acción desconocida" y el error lleva codigo: 'accion_desconocida' (quien llama lo informa como pendiente).
//
// Reintentos (docs/BOT-ALTA-CJ.md, "Puente Drive" → "Reintentos"). El 24/10/2026 un ping devolvió HTTP 500 una vez y los
// siguientes anduvieron: Apps Script da 500 pasajeros. Ese 500 no sale de Codigo.gs (doPost atrapa todo y responde
// { ok: false } con HTTP 200): sale de la infraestructura de Google, en el POST a /exec o en el GET al que lleva el 302,
// y en ese segundo tramo la acción YA SE HIZO. Por eso un 5xx es "dudoso" (aplicado: null) y no un rechazo.
//   · Se reintenta (hasta INTENTOS_PUENTE en total, con esperas crecientes) solo lo pasajero: HTTP 5xx, error de red,
//     corte por tiempo y respuesta que no es JSON. Todas las acciones son idempotentes por nombre (devuelven el existente
//     con yaExistia), así que repetir no duplica.
//   · Nunca se reintenta un rechazo: { ok: false } del puente ni un HTTP 4xx. Un 4xx que llega DESPUÉS del 302
//     (r.redirected: el script ya corrió) tampoco se reintenta, pero queda dudoso. Un { ok: false } con un error pasajero
//     de Drive ("Service error: Drive", "server error… try again") tampoco se reintenta, pero queda como dudoso
//     (aplicado: null): createFolder puede haber creado la carpeta igual.
//   · Un intento dudoso largo (cortado por tiempo o de más de INTENTO_LARGO_MS) solo se reintenta en las acciones que no
//     crean nada (ping, aPapelera, aPapeleraCarpeta): en las otras, el Apps Script puede seguir corriendo y un segundo
//     intento en paralelo podría duplicar (el puente busca y crea sin bloqueo). Un corte por tiempo salta a los 90 s o al
//     llegar al plazo (y entonces no queda tiempo para otro intento): en las acciones que crean algo no se reintenta nunca.
//   · Tope: cada llamada (intentos y esperas) termina en TOPE_LLAMADA_MS como mucho, casi los 90 s de antes de los
//     reintentos. Con plazo (opciones.hasta, lo pasa la ruta según su maxDuration) manda el que llegue primero: cada
//     intento se corta antes y no se reintenta si no queda tiempo.
//   · Si hubo un intento dudoso antes de la respuesta buena, el resultado lo trae en `dudoso` (desde / hasta /
//     puedeSeguir). driveCliente.ts lo usa para que el freno de homónimos no salte por una carpeta que creó el propio bot.

import type { BloqueDoc } from './bienvenida'

/** Carpeta "DFY - SKWD / Subidos": ahí van los comprobantes de pago (como los sube Aylu). */
export const CARPETA_COMPROBANTES = process.env.DRIVE_CARPETA_COMPROBANTES?.trim() ?? ''

/** Tope para no mandarle al puente algo que Apps Script no aguanta (el comprobante comprimido de WhatsApp pesa < 5 MB). */
export const MAXIMO_BYTES_ARCHIVO = 20 * 1024 * 1024

const TIMEOUT_PUENTE_MS = 90_000

// ── Reintentos ──
/** Intentos por llamada: el primero + 2 reintentos. */
export const INTENTOS_PUENTE = 3
/** Espera antes de cada reintento (más hasta AZAR_MS al azar). Más larga que una acción típica (1–3 s): así un intento
 *  anterior que siguió corriendo termina, y la búsqueda por nombre de Drive (que puede tardar unos segundos en ver lo
 *  recién creado) lo encuentra antes de que el reintento busque. */
export const ESPERAS_REINTENTO_MS: readonly number[] = [3_000, 8_000]
const AZAR_MS = 1_000
/** Un intento dudoso que tardó más que esto no se reintenta en las acciones que crean algo (ver arriba). */
export const INTENTO_LARGO_MS = 25_000
/** Lo máximo que dura una llamada entera (todos sus intentos y esperas), aunque no haya plazo: así ninguna pasa los 300 s
 *  de una función de Vercel por los reintentos. Con este tope, una llamada termina a los 95 s como mucho. */
export const TOPE_LLAMADA_MS = 100_000
/** Lo máximo que corre una ejecución de Apps Script: pasado esto desde el último intento, ya no puede crear nada. */
export const MAXIMO_APPS_SCRIPT_MS = 6 * 60_000
/** Margen que queda libre antes del límite (plazo o tope), lo mínimo para hacer el primer intento y lo mínimo para un
 *  reintento. */
const MARGEN_PLAZO_MS = 5_000
const MINIMO_PRIMER_INTENTO_MS = 10_000
const MINIMO_REINTENTO_MS = 20_000
/** Se pueden repetir aunque el intento anterior siga corriendo: ping no cambia nada y mandar a la papelera dos veces no
 *  hace daño. Las demás crean algo. */
const SIN_RIESGO_DE_DUPLICAR = new Set(['ping', 'aPapelera', 'aPapeleraCarpeta', 'quitarAccesoCliente'])
/** { ok: false } que en realidad es un error pasajero de Drive o de Apps Script (no un rechazo): puede haberse hecho.
 *  Angosto a propósito: "No item with the given ID", "Unexpected error while getting the method…" o "Access denied"
 *  son rechazos (el sondeo de la prueba depende de eso). Los cupos diarios ("…too many times for one day") tampoco
 *  son pasajeros. */
const ERROR_PASAJERO_DRIVE = /service error|server error|backend error|try again|temporarily unavailable|service unavailable|rate limit exceeded/i
const esErrorPasajeroDeDrive = (detalle: string) => ERROR_PASAJERO_DRIVE.test(detalle) && !/for one day|per day/i.test(detalle)

/** Intento(s) que no se sabe si el puente llegó a hacer (5xx, sin respuesta, respuesta que no es JSON, 4xx después del
 *  302, error pasajero de Drive). desde = cuándo salió el primero; hasta = cuándo terminó el último; puedeSeguir = alguno
 *  se cortó por tiempo o tardó más de INTENTO_LARGO_MS: el Apps Script pudo seguir corriendo (hasta MAXIMO_APPS_SCRIPT_MS)
 *  después de `hasta`. Fechas ISO: se guardan tal cual en cj_altas. */
export interface IntentoDudoso { desde: string; hasta: string; puedeSeguir: boolean }

/** Une dos ventanas dudosas de la MISMA llamada (intentos seguidos, separados por segundos). Las de corridas distintas NO
 *  se unen: entre una y otra pueden pasar horas (driveCliente.ts las guarda por separado). */
export function unirDudosos(a: IntentoDudoso | null | undefined, b: IntentoDudoso | null | undefined): IntentoDudoso | null {
  if (!a) return b ? { desde: b.desde, hasta: b.hasta, puedeSeguir: b.puedeSeguir } : null
  if (!b) return { desde: a.desde, hasta: a.hasta, puedeSeguir: a.puedeSeguir }
  return { desde: a.desde < b.desde ? a.desde : b.desde, hasta: a.hasta > b.hasta ? a.hasta : b.hasta, puedeSeguir: a.puedeSeguir || b.puedeSeguir }
}

/** Hasta cuándo pudo seguir corriendo el Apps Script de esas ventanas (ISO): antes de esa hora no se repite el paso,
 *  porque correría en paralelo con él y podría duplicar. null si ninguna quedó con puedeSeguir (se puede repetir ya). */
export function noRepetirAntesDe(dudosos: readonly (IntentoDudoso | null | undefined)[]): string | null {
  const ultimo = dudosos.reduce((m, d) => (d?.puedeSeguir ? Math.max(m, Date.parse(d.hasta)) : m), -Infinity)
  return Number.isFinite(ultimo) ? new Date(ultimo + MAXIMO_APPS_SCRIPT_MS).toISOString() : null
}

/** dudoso: solo si antes de la respuesta buena hubo un intento dudoso (no aparece en una llamada que salió bien de una). */
export interface ArchivoSubido { id: string; url: string; yaExistia: boolean; dudoso?: IntentoDudoso }

/** Lo mínimo del puente que usa el bot (el real o uno de juguete en los tests). */
export interface PuenteDrive {
  subirArchivo(p: { carpetaId: string; nombre: string; mimeType: string; base64: string }): Promise<ArchivoSubido>
  aPapelera(id: string): Promise<void>
}

/** Lo que usa además la carpeta del cliente (driveCliente.ts). Todas devuelven el existente si ya hay uno con ese
 *  nombre en la carpeta (yaExistia: true), así que se pueden repetir sin duplicar. */
export interface PuenteDriveCliente extends PuenteDrive {
  /** Cuenta que corre el puente y versión del Codigo.gs (null en las versiones anteriores al 24/10/2026). No cambia nada. */
  ping(): Promise<{ cuenta: string | null; version: string | null }>
  crearCarpeta(p: { padreId: string; nombre: string }): Promise<ArchivoSubido>
  crearDoc(p: { carpetaId: string; nombre: string; bloques: BloqueDoc[] }): Promise<ArchivoSubido>
  /** El puente solo copia archivos cuyo nombre empieza con PREFIJO_PLANTILLA (si no, ErrorPuente codigo 'no_es_plantilla'). */
  copiarArchivo(p: { archivoId: string; carpetaId: string; nombre: string }): Promise<ArchivoSubido>
  /** Solo para las pruebas: el puente rechaza carpetas cuyo nombre no empieza con "PRUEBA BOT". */
  aPapeleraCarpeta(id: string): Promise<void>
  /** Etapa Bajas (Codigo.gs 2026-10-26a): le saca a esos correos el acceso (editor o lector) a la carpeta "<Nombre> - C.J".
   *  No borra nada, nunca saca al dueño, al correo de organización configurado ni a una cuenta de servicio, y NO cambia el acceso general
   *  ("cualquiera con el enlace" se informa en enlacePublico). Idempotente. Con un puente viejo: ErrorPuente
   *  codigo 'accion_desconocida' (falta publicar la versión nueva). */
  quitarAccesoCliente?(p: { carpetaId: string; correos: string[] }): Promise<ResultadoQuitarAcceso>
}

export interface ResultadoQuitarAcceso {
  carpeta: string | null
  quitados: { correo: string; como: 'editor' | 'lector' }[]
  noTenian: string[]
  protegidos: string[]
  acceso: string | null
  enlacePublico: boolean
}

/** Las únicas carpetas que aPapeleraCarpeta acepta: el nombre tiene que empezar así (el mismo PREFIJO_PRUEBA de
 *  Codigo.gs y de finanzasLimpiar.ts). */
export const PREFIJO_CARPETA_PRUEBA = 'PRUEBA BOT'

/** copiarArchivo solo copia archivos cuyo nombre empieza así (el mismo PREFIJO_PLANTILLA de Codigo.gs): frena que se
 *  copie como plantilla el "Guiones - X" de un cliente, con sus guiones adentro. */
export const PREFIJO_PLANTILLA = 'Plantilla'

/** accion_desconocida = el puente publicado todavía no tiene esa acción (falta publicar la versión nueva del script).
 *  no_es_plantilla = copiarArchivo rechazó el archivo porque su nombre no empieza con PREFIJO_PLANTILLA. */
export type CodigoErrorPuente = 'accion_desconocida' | 'no_es_plantilla'

const codigoDelError = (detalle: string): CodigoErrorPuente | null =>
  /^acci[oó]n desconocida/i.test(detalle) ? 'accion_desconocida' : /solo se copian plantillas/i.test(detalle) ? 'no_es_plantilla' : null

/** Error del puente sin datos sensibles. `aplicado` = false si seguro no hizo nada (rechazo explícito del puente);
 *  null si no se sabe (con `dudoso`: cuándo fueron los intentos y si el Apps Script pudo seguir corriendo, cuando se
 *  sabe). `rechazo` = el último intento llegó al script y este respondió { ok: false } (no un error pasajero de Drive):
 *  la acción existe aunque `aplicado` quede en null por un intento dudoso anterior (el sondeo de la prueba lo usa). */
export class ErrorPuente extends Error {
  aplicado: boolean | null
  codigo: CodigoErrorPuente | null
  dudoso: IntentoDudoso | null
  rechazo: boolean
  constructor(mensaje: string, aplicado: boolean | null, codigo: CodigoErrorPuente | null = null, dudoso: IntentoDudoso | null = null, rechazo = false) {
    super(mensaje)
    this.name = 'ErrorPuente'
    this.aplicado = aplicado
    this.codigo = codigo
    this.dudoso = dudoso
    this.rechazo = rechazo
  }
}

/** ¿El puente publicado todavía no tiene esa acción? */
export const esAccionDesconocida = (e: unknown): boolean => e instanceof ErrorPuente && e.codigo === 'accion_desconocida'

/** Bytes reales de un base64 (sin decodificarlo). */
export function bytesDeBase64(b64: string): number {
  const limpio = b64.replace(/\s/g, '')
  const relleno = limpio.endsWith('==') ? 2 : limpio.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((limpio.length * 3) / 4) - relleno)
}

/** ¿Es un id de Drive con forma válida? (evita mandar cualquier cosa a aPapelera) */
export const esIdDrive = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(id)

export interface OpcionesPuente {
  /** Plazo para terminar cada llamada (epoch ms). Lo pasa la ruta según su maxDuration (por ejemplo, inicio + 285 s de
   *  300). Cada llamada usa como límite min(plazo, su inicio + TOPE_LLAMADA_MS): cada intento se corta a
   *  min(90 s, límite − 5 s), sin 10 s libres no se llama y sin 20 s no se reintenta. */
  hasta?: number
  /** Para los tests (que no esperen de verdad): la espera entre intentos, el reloj, el azar de la espera y la señal que
   *  corta cada intento (por defecto AbortSignal.timeout). */
  esperar?: (ms: number) => Promise<void>
  ahora?: () => number
  azar?: () => number
  senal?: (ms: number) => AbortSignal
}

type Intento =
  | { j: Record<string, unknown> }
  | { error: ErrorPuente; pasajero: boolean; timeout: boolean }

const esCortePorTiempo = (e: unknown) => (e as Error)?.name === 'TimeoutError'

export function puenteDriveReal(opciones: OpcionesPuente = {}): PuenteDriveCliente {
  const url = process.env.PUENTE_DRIVE_URL
  const secreto = process.env.PUENTE_DRIVE_SECRETO
  if (!url || !secreto) throw new Error('Faltan PUENTE_DRIVE_URL / PUENTE_DRIVE_SECRETO')
  // Una URL mal escrita haría fallar cada fetch como si fuera la red (3 intentos y "dudoso"): se frena acá, sin mostrarla
  try { new URL(url) } catch { throw new Error('PUENTE_DRIVE_URL no es una URL válida') }
  const plazo = typeof opciones.hasta === 'number' && Number.isFinite(opciones.hasta) ? opciones.hasta : Infinity
  const ahora = opciones.ahora ?? Date.now
  const azar = opciones.azar ?? Math.random
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((listo) => setTimeout(listo, ms)))
  const senal = opciones.senal ?? ((ms: number) => AbortSignal.timeout(ms))
  const iso = (ms: number) => new Date(ms).toISOString()

  /** Un intento: el POST a /exec (fetch sigue el 302 a googleusercontent). No tira excepciones. */
  async function intentar(accion: string, datos: Record<string, unknown>, timeoutMs: number): Promise<Intento> {
    // El cuerpo y la señal se arman ANTES del pedido: si fallan (por ejemplo, un timeout con decimales, que
    // AbortSignal.timeout rechaza), no salió nada: seguro no se hizo y no es un error de red
    let cuerpo: string
    let signal: AbortSignal
    try {
      cuerpo = JSON.stringify({ secreto, accion, ...datos })
      signal = senal(Math.max(1, Math.floor(timeoutMs)))
    } catch (e) {
      return { error: new ErrorPuente(`No se pudo armar el pedido al puente (${accion}): ${String((e as Error)?.name ?? 'error')}`, false), pasajero: false, timeout: false }
    }
    let r: Response
    try {
      r = await fetch(url as string, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, redirect: 'follow', signal })
    } catch (e) {
      // Sin respuesta (corte por tiempo, red): no se sabe si el puente llegó a hacerlo
      return { error: new ErrorPuente(`El puente no respondió (${accion}): ${String((e as Error)?.name ?? 'error')}`, null), pasajero: true, timeout: esCortePorTiempo(e) }
    }
    let cortado = false
    const texto = await r.text().catch((e) => { cortado = esCortePorTiempo(e); return '' })
    let j: unknown = null
    try { j = JSON.parse(texto) } catch { /* el puente devolvió HTML (error de Apps Script o de permisos) */ }
    // 4xx: no se reintenta nunca. En el POST a /exec, Google lo rechazó sin correr el script: seguro no se hizo. Después del
    // 302 (r.redirected: el GET a googleusercontent), el script YA corrió: no se sabe si se hizo (dudoso, sin reintento)
    if (r.status >= 400 && r.status < 500) {
      if (r.redirected) return { error: new ErrorPuente(`Respuesta inválida del puente (${accion}): HTTP ${r.status} después de correr el script (puede haberse hecho)`, null), pasajero: false, timeout: false }
      return { error: new ErrorPuente(`Respuesta inválida del puente (${accion}): HTTP ${r.status}`, false), pasajero: false, timeout: false }
    }
    if (!r.ok || !j || typeof j !== 'object') {
      const pasajero = r.ok || r.status >= 500
      return { error: new ErrorPuente(`Respuesta inválida del puente (${accion}): HTTP ${r.status}${r.ok ? ' (no es JSON)' : ''}`, null), pasajero, timeout: cortado }
    }
    const o = j as Record<string, unknown>
    if (o.ok !== true) {
      const detalle = String(o.error ?? 'sin detalle').slice(0, 160)
      // Error pasajero de Drive adentro del script: no es un rechazo (puede haberse hecho), pero tampoco se reintenta
      if (esErrorPasajeroDeDrive(detalle)) return { error: new ErrorPuente(`El puente respondió un error pasajero de Drive (${accion}): ${detalle}`, null), pasajero: false, timeout: false }
      return { error: new ErrorPuente(`El puente rechazó ${accion}: ${detalle}`, false, codigoDelError(detalle), null, true), pasajero: false, timeout: false }
    }
    return { j: o }
  }

  /** La llamada con sus reintentos. `dudoso` = hubo un intento dudoso antes de la respuesta buena. */
  async function llamar(accion: string, datos: Record<string, unknown>): Promise<{ j: Record<string, unknown>; dudoso: IntentoDudoso | null }> {
    let dudoso: IntentoDudoso | null = null
    // Límite de la llamada entera (intentos y esperas): el plazo de la ruta o el tope, el que llegue primero
    const limite = Math.min(plazo, ahora() + TOPE_LLAMADA_MS)
    for (let n = 1; ; n++) {
      const inicio = ahora()
      const resto = limite - inicio - MARGEN_PLAZO_MS
      if (n === 1 && resto < MINIMO_PRIMER_INTENTO_MS) throw new ErrorPuente(`No queda tiempo para llamar al puente (${accion}): no se llamó`, false)
      const r = await intentar(accion, datos, Math.min(TIMEOUT_PUENTE_MS, resto))
      const fin = ahora()
      if ('j' in r) return { j: r.j, dudoso }
      const e = r.error
      // Largo (cortado por tiempo o de más de INTENTO_LARGO_MS): el Apps Script puede seguir corriendo
      const largo = r.timeout || fin - inicio > INTENTO_LARGO_MS
      if (e.aplicado !== false) dudoso = unirDudosos(dudoso, { desde: iso(inicio), hasta: iso(fin), puedeSeguir: largo })
      const espera = (ESPERAS_REINTENTO_MS[n - 1] ?? 0) + Math.round(azar() * AZAR_MS)
      const otro = r.pasajero && n < INTENTOS_PUENTE
        && (SIN_RIESGO_DE_DUPLICAR.has(accion) || !largo)
        && limite - fin - espera - MARGEN_PLAZO_MS >= MINIMO_REINTENTO_MS
      if (!otro) {
        // Si un intento anterior quedó dudoso, el resultado también (aunque el último sea un rechazo: `rechazo` lo dice)
        const aplicado = dudoso ? null : e.aplicado
        throw new ErrorPuente(n > 1 ? `${e.message} · ${n} intentos` : e.message, aplicado, e.codigo, aplicado === null ? dudoso : null, e.rechazo)
      }
      await esperar(espera)
    }
  }

  /** id + url + yaExistia (+ dudoso) de la respuesta (subirArchivo, crearCarpeta, crearDoc, copiarArchivo). */
  const elemento = ({ j, dudoso }: { j: Record<string, unknown>; dudoso: IntentoDudoso | null }, accion: string): ArchivoSubido => {
    if (!esIdDrive(j.id) || typeof j.url !== 'string') throw new ErrorPuente(`El puente no devolvió el id (${accion})`, null, null, dudoso)
    return { id: j.id, url: j.url, yaExistia: j.yaExistia === true, ...(dudoso ? { dudoso } : {}) }
  }
  const exigirId = (id: unknown, que: string) => {
    if (!esIdDrive(id)) throw new ErrorPuente(`Id de Drive inválido (${que}): no se llama al puente`, false)
  }

  return {
    async ping() {
      const { j } = await llamar('ping', {})
      return { cuenta: typeof j.cuenta === 'string' ? j.cuenta : null, version: typeof j.version === 'string' ? j.version : null }
    },
    async subirArchivo({ carpetaId, nombre, mimeType, base64 }) {
      return elemento(await llamar('subirArchivo', { carpetaId, nombre, mimeType, base64 }), 'subirArchivo')
    },
    async aPapelera(id) {
      if (!esIdDrive(id)) throw new ErrorPuente('Id de Drive inválido: no se manda a la papelera', false)
      await llamar('aPapelera', { id })
    },
    async crearCarpeta({ padreId, nombre }) {
      exigirId(padreId, 'carpeta padre')
      return elemento(await llamar('crearCarpeta', { padreId, nombre }), 'crearCarpeta')
    },
    async crearDoc({ carpetaId, nombre, bloques }) {
      exigirId(carpetaId, 'carpeta del doc')
      return elemento(await llamar('crearDoc', { carpetaId, nombre, bloques }), 'crearDoc')
    },
    async copiarArchivo({ archivoId, carpetaId, nombre }) {
      exigirId(archivoId, 'archivo a copiar')
      exigirId(carpetaId, 'carpeta de la copia')
      return elemento(await llamar('copiarArchivo', { archivoId, carpetaId, nombre }), 'copiarArchivo')
    },
    async aPapeleraCarpeta(id) {
      if (!esIdDrive(id)) throw new ErrorPuente('Id de Drive inválido: no se manda la carpeta a la papelera', false)
      await llamar('aPapeleraCarpeta', { id })
    },
    async quitarAccesoCliente({ carpetaId, correos }) {
      exigirId(carpetaId, 'carpeta del cliente')
      const lista = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter((c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)))]
      if (!lista.length) throw new ErrorPuente('No hay correos válidos para quitar: no se llama al puente', false)
      const { j } = await llamar('quitarAccesoCliente', { carpetaId, correos: lista })
      const txts = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [])
      return {
        carpeta: typeof j.carpeta === 'string' ? j.carpeta : null,
        quitados: (Array.isArray(j.quitados) ? j.quitados : []).filter((q): q is { correo: string; como: 'editor' | 'lector' } => !!q && typeof (q as { correo?: unknown }).correo === 'string')
          .map((q) => ({ correo: q.correo, como: q.como === 'lector' ? 'lector' : 'editor' })),
        noTenian: txts(j.noTenian), protegidos: txts(j.protegidos),
        acceso: typeof j.acceso === 'string' ? j.acceso : null, enlacePublico: j.enlacePublico === true,
      }
    },
  }
}
