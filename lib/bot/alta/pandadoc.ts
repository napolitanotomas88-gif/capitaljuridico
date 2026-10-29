// ── Bot "Capital Jurídico": borrador del contrato en PandaDoc (paso 9 de docs/BOT-ALTA-CJ.md) ─────
// SOLO SERVIDOR: usa la API key de PandaDoc (ver clavePandaDoc):
//   · PANDADOC_API_KEY (producción) si existe.
//   · PANDADOC_API_KEY_SANDBOX solo fuera de producción (VERCEL_ENV distinto de 'production') o con
//     PANDADOC_USAR_SANDBOX=1 (que además la fuerza aunque esté la de producción). En producción sin la clave de
//     producción tira error: un contrato real nunca se crea en la sandbox por descuido.
//   · enviarContrato se niega a mandar nada creado con la clave de sandbox (marca de agua, sin validez).
// El borrador dice cuál usó (BorradorCreado.clave) y textoAvisoBorrador lo pone en el aviso de Verificaciones C.J.
// También llama a Claude (direccionClaude.ts) cuando las reglas no alcanzan para separar ciudad y provincia del cliente.
// No importarlo desde componentes de cliente. No lleva `import 'server-only'` para poder probarlo con node
// (scripts/test-bot-contrato.mjs y scripts/bot-contrato-sandbox.mjs).
//
// Flujo de la API (https://api.pandadoc.com/public/v1, header "Authorization: API-Key <clave>"):
//   1. POST /documents con la plantilla, el destinatario y los tokens → el documento nace en "document.uploaded".
//   2. PandaDoc lo procesa unos segundos y pasa a "document.draft": recién ahí se puede editar o enviar.
//   3. POST /documents/{id}/send lo manda a firmar (enviarContrato). El bot NO lo envía solo: primero el closer
//      completa lo que falte en el editor (link de edición). Igual, enviarContrato relee GET /details y no manda
//      nada si el documento no está en borrador o le queda alguna variable vacía (ej. [Client.City]).
// La sandbox limita a ~10 pedidos por minuto por endpoint: las consultas de estado van con pausas crecientes y
// un 429 se reintenta respetando Retry-After, con techo de RETRY_AFTER_MAX_MS y sin pasarse del plazo.
// Una falla DESPUÉS del POST sale como ErrorBorrador con el id del documento (que ya existe en PandaDoc), y
// `alCrear` avisa el id apenas se crea: así nunca queda un borrador huérfano ni se crea uno duplicado al reintentar.
import type { AltaParseada } from './parsear'
import { PLANTILLAS_CONTRATO, datosContrato, nombreContrato, type DireccionContrato } from './contrato'
import { faltantesDireccion, separarDireccion } from './direccion'
import { hayQueConfirmarCiudad, resolverDireccion, type DireccionResuelta } from './direccionClaude'

export const BASE_PANDADOC = 'https://api.pandadoc.com/public/v1'

/** Link para abrir el documento en el editor de PandaDoc. */
export const linkEdicion = (id: string) => `https://app.pandadoc.com/a/#/documents/${id}`

/** Nombre del documento: "Contrato - <Nombre> - C.J", con el nombre limpio como en Drive (nombreContrato: sin
 *  "Dra.", con mayúscula inicial si vino todo en mayúsculas o minúsculas, "Ma." → "María"). */
export const nombreDocumento = (nombre: string) =>
  `Contrato - ${nombreContrato(nombre) || nombre.trim().replace(/\s+/g, ' ')} - C.J`

/** Esperas entre consultas de estado (ms). Suman ~21 s; en la práctica el borrador queda listo en 2–5 s. */
export const PAUSAS_ESTADO_MS = [1000, 1500, 2000, 3000, 4000, 5000, 5000]
/** Tope de tiempo REAL para crear el borrador y esperar "document.draft": cuenta desde el POST e incluye lo que
 *  tarda cada pedido y las esperas por 429. */
export const TOPE_ESTADO_MS = 30_000
/** Techo de la espera por un 429: aunque PandaDoc pida más con Retry-After, nunca se espera más que esto. */
export const RETRY_AFTER_MAX_MS = 10_000
const ESPERA_429_MS = 6000   // si el 429 no trae un Retry-After en segundos

export interface OpcionesPandaDoc {
  apiKey?: string                          // por defecto PANDADOC_API_KEY (producción) y si no, PANDADOC_API_KEY_SANDBOX
  base?: string                            // por defecto BASE_PANDADOC
  fetch?: typeof fetch                     // para tests
  esperar?: (ms: number) => Promise<void>  // para tests (por defecto setTimeout)
  ahora?: () => number                     // para tests (por defecto Date.now)
}

export interface OpcionesBorrador extends OpcionesPandaDoc {
  plantilla?: string                                            // uuid; por defecto la del tipo de contrato del #ALTA
  extra?: DireccionContrato                                     // dirección ya separada: manda sobre la que se resuelve acá
  /** Cómo separar la dirección del cliente. Por defecto resolverDireccion (reglas y, si no alcanzan, Claude); `false` =
   *  solo reglas, sin red. Con ciudad y provincia en `extra` no se llama. Si tira error, siguen las reglas con un aviso. */
  direccion?: false | ((texto: string, telefono?: string) => Promise<DireccionResuelta>)
  metadata?: Record<string, string>                             // ej. { alta_id: '…' } para encontrarlo después
  pausasMs?: number[]
  topeMs?: number                                               // ver TOPE_ESTADO_MS
  /** Se llama apenas PandaDoc devuelve el id, antes de esperar el borrador. El bot lo usa para guardar el id en
   *  cj_altas en ese momento (si la función de Vercel se corta después, el reintento lo retoma en vez de crear otro);
   *  la prueba de sandbox, para poder borrarlo siempre. Si tira error, sale como ErrorBorrador (el documento existe). */
  alCrear?: (id: string) => void | Promise<void>
}

export interface CuerpoBorrador {
  name: string
  template_uuid: string
  recipients: { email: string; first_name: string; last_name: string; role: 'Client' }[]
  tokens: { name: string; value: string }[]
  metadata?: Record<string, string>
}

export interface BorradorCreado {
  id: string
  estado: string        // 'document.draft' si quedó listo; 'document.uploaded' si se llegó al tope esperando
  link: string          // editor de PandaDoc
  nombre: string
  plantilla: string
  faltantes: string[]   // datos que el closer tiene que completar en el editor (de datosContrato)
  clave: OrigenClave    // con qué clave se creó: producción, sandbox o la que vino en opciones.apiKey
  direccion: DireccionResuelta | null   // cómo se separó la dirección del cliente (null: sin dirección o vino en `extra`)
}

/** De dónde salió la API key de PandaDoc. */
export type OrigenClave = 'PANDADOC_API_KEY' | 'PANDADOC_API_KEY_SANDBOX' | 'opciones.apiKey'

/** La clave a usar:
 *  1. La de opciones (si es igual a PANDADOC_API_KEY_SANDBOX, se informa como sandbox: así enviarContrato la frena).
 *  2. Con PANDADOC_USAR_SANDBOX=1, la sandbox (aunque esté la de producción); si falta, error.
 *  3. PANDADOC_API_KEY (producción).
 *  4. PANDADOC_API_KEY_SANDBOX, solo fuera de producción (VERCEL_ENV distinto de 'production').
 *  Si no, error: en producción sin PANDADOC_API_KEY, los contratos de clientes reales NO van a la sandbox. */
export function clavePandaDoc(op: Pick<OpcionesPandaDoc, 'apiKey'> = {}): { clave: string; origen: OrigenClave } {
  const sandbox = process.env.PANDADOC_API_KEY_SANDBOX?.trim()
  if (op.apiKey) return { clave: op.apiKey, origen: sandbox && op.apiKey.trim() === sandbox ? 'PANDADOC_API_KEY_SANDBOX' : 'opciones.apiKey' }
  if (process.env.PANDADOC_USAR_SANDBOX?.trim() === '1') {
    if (sandbox) return { clave: sandbox, origen: 'PANDADOC_API_KEY_SANDBOX' }
    throw new Error('PandaDoc: PANDADOC_USAR_SANDBOX=1 pero falta PANDADOC_API_KEY_SANDBOX')
  }
  const produccion = process.env.PANDADOC_API_KEY?.trim()
  if (produccion) return { clave: produccion, origen: 'PANDADOC_API_KEY' }
  if (sandbox && process.env.VERCEL_ENV !== 'production') return { clave: sandbox, origen: 'PANDADOC_API_KEY_SANDBOX' }
  if (sandbox) {
    throw new Error('PandaDoc: falta PANDADOC_API_KEY (producción). En producción la sandbox (PANDADOC_API_KEY_SANDBOX) solo se usa con PANDADOC_USAR_SANDBOX=1')
  }
  throw new Error('PandaDoc: falta la API key (PANDADOC_API_KEY o PANDADOC_API_KEY_SANDBOX)')
}

/** Error de la API de PandaDoc. El mensaje trae el estado HTTP y la respuesta, nunca la clave. */
export class ErrorPandaDoc extends Error {
  status: number
  respuesta: string
  constructor(status: number, respuesta: string, contexto: string) {
    super(`PandaDoc ${contexto}: HTTP ${status} ${respuesta}`.trim())
    this.name = 'ErrorPandaDoc'
    this.status = status
    this.respuesta = respuesta
  }
}

/** Falla DESPUÉS de crear el documento: el borrador ya existe en PandaDoc. Trae el id para borrarlo (prueba) o
 *  retomarlo (bot) sin crear otro. `causa` es el error original (ej. un ErrorPandaDoc 500 o un error de red). */
export class ErrorBorrador extends Error {
  idDocumento: string
  causa: unknown
  constructor(idDocumento: string, causa: unknown) {
    const detalle = causa instanceof Error ? causa.message : String(causa)
    super(`PandaDoc: el documento ${idDocumento} quedó creado, pero después falló: ${detalle}`)
    this.name = 'ErrorBorrador'
    this.idDocumento = idDocumento
    this.causa = causa
  }
}

/** enviarContrato se negó a mandar el documento: no está en borrador o le quedan variables vacías. */
export class ContratoIncompleto extends Error {
  estado: string
  vacios: string[]
  constructor(id: string, estado: string, vacios: string[]) {
    const motivos = [
      estado !== 'document.draft' ? `está en "${estado || 'sin estado'}" (tiene que estar en document.draft)` : '',
      vacios.length ? `le faltan completar: ${vacios.join(', ')}` : '',
    ].filter(Boolean)
    super(`El contrato ${id} no se manda a firmar: ${motivos.join(' y ')}`)
    this.name = 'ContratoIncompleto'
    this.estado = estado
    this.vacios = vacios
  }
}

/** enviarContrato se negó a mandar el documento: la clave es la de sandbox (borrador de prueba con marca de agua). */
export class ContratoEnSandbox extends Error {
  constructor(id: string) {
    super(`El contrato ${id} no se manda a firmar: se usa la clave de sandbox (PANDADOC_API_KEY_SANDBOX), que crea borradores de prueba con marca de agua`)
    this.name = 'ContratoEnSandbox'
  }
}

/** Arma el cuerpo del POST /documents a partir del #ALTA. Puro y sin red.
 *  Sin nombre o sin correo no se puede crear (PandaDoc necesita el correo del destinatario): tira un Error.
 *  Los tokens vacíos NO se mandan: así el editor muestra la variable sin completar (ej. [Client.City]) y el closer
 *  ve qué falta, en vez de un hueco en blanco que pasa desapercibido. */
export function cuerpoBorrador(a: AltaParseada, opciones: Pick<OpcionesBorrador, 'plantilla' | 'extra' | 'metadata'> = {}): { cuerpo: CuerpoBorrador; faltantes: string[] } {
  const nombre = nombreContrato(a.nombre)   // limpio como en Drive: "DRA. MARIA PEREZ" → "Maria Perez"
  if (!nombre) throw new Error('Contrato: falta el nombre completo del cliente')
  if (!a.correo?.trim()) throw new Error(`Contrato: falta el correo de ${nombre} (PandaDoc lo necesita para el firmante)`)
  const plantilla = opciones.plantilla ?? PLANTILLAS_CONTRATO[a.contrato ?? 'normal']
  if (!plantilla?.trim()) throw new Error('Contrato: falta la plantilla PandaDoc configurada')
  const d = datosContrato(a, opciones.extra)
  const cuerpo: CuerpoBorrador = {
    name: nombreDocumento(nombre),
    template_uuid: plantilla,
    recipients: [d.destinatario],
    tokens: d.tokens.filter(t => t.value.trim() !== ''),
  }
  if (opciones.metadata && Object.keys(opciones.metadata).length) cuerpo.metadata = opciones.metadata
  return { cuerpo, faltantes: d.faltantes }
}

/** Compara los tokens mandados con los que devuelve GET /documents/{id}/details. Puro. */
export function verificarTokens(enviados: { name: string; value: string }[], recibidos: { name: string; value?: string | null }[]) {
  const porNombre = new Map(recibidos.map(t => [t.name, t.value ?? '']))
  const distintos = enviados
    .filter(t => porNombre.get(t.name) !== t.value)
    .map(t => ({ name: t.name, esperado: t.value, recibido: porNombre.has(t.name) ? porNombre.get(t.name)! : null }))
  return { ok: distintos.length === 0, distintos }
}

/** ¿Se puede mandar a firmar? Tiene que estar en "document.draft" y sin variables vacías (ej. [Client.City] que nadie
 *  completó). Las "Document.*" las maneja PandaDoc y no cuentan. `permitirVacios` acepta a propósito las que pueden
 *  quedar vacías (ej. DNI de un cliente del exterior). Puro: recibe lo que devuelve GET /documents/{id}/details. */
export function revisarParaEnviar(d: { status?: string | null; tokens?: { name: string; value?: unknown }[] }, permitirVacios: string[] = []) {
  const permitidos = new Set(permitirVacios)
  const vacios = (d.tokens ?? [])
    .filter(t => !t.name.startsWith('Document.') && !permitidos.has(t.name) && String(t.value ?? '').trim() === '')
    .map(t => t.name)
  const estado = d.status ?? ''
  return { listo: estado === 'document.draft' && vacios.length === 0, estado, vacios }
}

/** Cómo se informa la clave en el aviso (la de sandbox, bien a la vista). */
const CLAVE_LEGIBLE: Record<OrigenClave, string> = {
  PANDADOC_API_KEY: 'Clave: producción.',
  PANDADOC_API_KEY_SANDBOX: '⚠ Clave: SANDBOX. Es un borrador de prueba con marca de agua: no se puede mandar a firmar.',
  'opciones.apiKey': 'Clave: la que se pasó al crearlo (no es la de producción del entorno).',
}

/** Aviso del borrador para Verificaciones C.J (y para arrobar al closer). Puro. Siempre dice con qué clave se creó,
 *  lo que falta completar o confirmar y los avisos de la dirección. El bot nunca lo manda a firmar solo. */
export function textoAvisoBorrador(b: Pick<BorradorCreado, 'nombre' | 'link' | 'estado' | 'faltantes' | 'clave' | 'direccion'>): string {
  const lineas = [
    `${b.nombre}: borrador en PandaDoc. El closer lo revisa y confirma antes de mandarlo a firmar.`,
    b.link,
    CLAVE_LEGIBLE[b.clave],
  ]
  if (b.estado !== 'document.draft') lineas.push(`PandaDoc todavía lo está procesando (${b.estado || 'sin estado'}): abrirlo en unos segundos.`)
  if (b.faltantes.length) lineas.push(`Falta: ${b.faltantes.join('; ')}.`)
  for (const a of b.direccion?.avisos ?? []) lineas.push(`Dirección: ${a.replace(/[.\s]+$/, '')}.`)
  return lineas.join('\n')
}

// ── Red ────────────────────────────────────────────────────────────────────────────────────────────

const esperarReal = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Mide el tiempo de un paso: lo que pasó en el reloj o lo ya esperado, lo que sea mayor. En producción manda el
 *  reloj (incluye lo que tarda cada pedido); con el `esperar` falso de los tests el reloj casi no avanza y cuentan
 *  las esperas. */
interface Reloj { transcurrido: () => number; esperar: (ms: number) => Promise<void> }

function crearReloj(op: OpcionesPandaDoc): Reloj {
  const ahora = op.ahora ?? Date.now
  const esperarBase = op.esperar ?? esperarReal
  const inicio = ahora()
  let esperado = 0
  return {
    transcurrido: () => Math.max(ahora() - inicio, esperado),
    esperar: async ms => { await esperarBase(ms); esperado += ms },
  }
}

/** Un pedido a la API. Si PandaDoc responde 429 (límite de pedidos) reintenta hasta 2 veces, respetando Retry-After
 *  con techo de RETRY_AFTER_MAX_MS. Con `plazoMs`, si la espera pasaría el plazo no espera: tira el 429 ahí mismo. */
async function pedir<T>(
  metodo: string, ruta: string, op: OpcionesPandaDoc, cuerpo?: unknown,
  control: { reloj: Reloj; plazoMs?: number } = { reloj: crearReloj(op) },
): Promise<T | null> {
  const { clave } = clavePandaDoc(op)
  const f = op.fetch ?? fetch
  for (let intento = 0; ; intento++) {
    const r = await f(`${op.base ?? BASE_PANDADOC}${ruta}`, {
      method: metodo,
      headers: { Authorization: `API-Key ${clave}`, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    if (r.status === 429 && intento < 2) {
      const seg = Number(r.headers.get('retry-after'))
      const ms = Math.min(Number.isFinite(seg) && seg > 0 ? seg * 1000 : ESPERA_429_MS, RETRY_AFTER_MAX_MS)
      if (control.plazoMs === undefined || control.reloj.transcurrido() + ms <= control.plazoMs) {
        await r.body?.cancel().catch(() => {})   // cuerpo sin leer: se cancela para liberar la conexión
        await control.reloj.esperar(ms)
        continue
      }
    }
    const texto = await r.text()
    if (!r.ok) throw new ErrorPandaDoc(r.status, texto.slice(0, 500), `${metodo} ${ruta}`)
    return texto ? (JSON.parse(texto) as T) : null
  }
}

/** Estado del documento ('document.uploaded', 'document.draft', 'document.sent', …). */
export async function estadoDocumento(id: string, op: OpcionesPandaDoc = {}): Promise<string> {
  const r = await pedir<{ status: string }>('GET', `/documents/${id}`, op)
  return r?.status ?? ''
}

export interface DetallesDocumento {
  id: string
  name: string
  status: string
  tokens?: { name: string; value?: string | null }[]
  recipients?: { email: string; first_name?: string; last_name?: string; role?: string }[]
  template?: { id: string; name?: string } | null
  [k: string]: unknown
}

export const detallesDocumento = (id: string, op: OpcionesPandaDoc = {}) =>
  pedir<DetallesDocumento>('GET', `/documents/${id}/details`, op) as Promise<DetallesDocumento>

/** Borra un documento (lo usa la prueba de sandbox para no dejar basura). */
export async function borrarDocumento(id: string, op: OpcionesPandaDoc = {}): Promise<void> {
  await pedir('DELETE', `/documents/${id}`, op)
}

/** Separa la dirección del cliente para el contrato (antes del POST, así no cuenta para el tope de PandaDoc). */
async function direccionParaContrato(a: AltaParseada, opciones: OpcionesBorrador): Promise<DireccionResuelta | null> {
  if (!a.direccion?.trim() || (opciones.extra?.ciudad && opciones.extra?.provincia)) return null
  const telefono = a.telefonos[0]?.numero
  const soloReglas = (avisos: string[]): DireccionResuelta => {
    const d = separarDireccion(a.direccion, telefono)
    return { ...d, fuente: 'reglas', avisos, faltantes: faltantesDireccion(d, hayQueConfirmarCiudad({ fuente: 'reglas', confianza: d.confianza })) }
  }
  if (opciones.direccion === false) return soloReglas([])
  try {
    return await (opciones.direccion ?? resolverDireccion)(a.direccion, telefono)
  } catch (e) {
    return soloReglas([`No se pudo separar la dirección: ${e instanceof Error ? e.message : String(e)}`])
  }
}

/** Crea el borrador del contrato y espera a que pase de "document.uploaded" a "document.draft".
 *  Antes separa la dirección (reglas y, si no alcanzan, Claude): StreetAddress lleva solo la calle y City, State y
 *  Country van llenos; si ciudad o provincia no se saben, quedan sin mandar y en `faltantes`.
 *  Si se llega al tope (tiempo real, ver TOPE_ESTADO_MS) o PandaDoc limita las consultas (429), devuelve el estado
 *  que tenga: el documento existe igual. Una falla antes del POST o en el POST sale como Error/ErrorPandaDoc (no se
 *  creó nada); cualquier falla posterior, como ErrorBorrador con el id. */
export async function crearBorradorContrato(a: AltaParseada, opciones: OpcionesBorrador = {}): Promise<BorradorCreado> {
  const { origen } = clavePandaDoc(opciones)   // sin clave no se llama ni a Claude ni a PandaDoc
  cuerpoBorrador(a, opciones)                   // valida nombre y correo antes de gastar una llamada a Claude
  const direccion = await direccionParaContrato(a, opciones)
  const extra: DireccionContrato = {
    ...(direccion ? {
      calle: direccion.calle, ciudad: direccion.ciudad, provincia: direccion.provincia, pais: direccion.pais,
      confirmar: hayQueConfirmarCiudad(direccion),   // conjetura de las reglas sin verificar → el closer la confirma
    } : {}),
    ...Object.fromEntries(Object.entries(opciones.extra ?? {}).filter(([, v]) => v !== undefined)),
  }
  const { cuerpo, faltantes } = cuerpoBorrador(a, { ...opciones, extra })
  const tope = opciones.topeMs ?? TOPE_ESTADO_MS
  const control = { reloj: crearReloj(opciones), plazoMs: tope }
  const creado = await pedir<{ id: string; status: string }>('POST', '/documents', opciones, cuerpo, control)
  if (!creado?.id) throw new Error('PandaDoc: POST /documents no devolvió el id del documento')
  const id = creado.id
  // Desde acá el documento YA existe en PandaDoc: todo lo que falle sale con su id
  try {
    await opciones.alCrear?.(id)
    const pausas = opciones.pausasMs ?? PAUSAS_ESTADO_MS
    let estado = creado.status
    for (const ms of pausas) {
      if (estado !== 'document.uploaded' || control.reloj.transcurrido() + ms > tope) break
      await control.reloj.esperar(ms)
      try {
        estado = (await pedir<{ status: string }>('GET', `/documents/${id}`, opciones, undefined, control))?.status ?? ''
      } catch (e) {
        // 429 sin reintentos o sin tiempo para esperar: se deja de consultar y se devuelve el estado que tenga
        if (e instanceof ErrorPandaDoc && e.status === 429) break
        throw e
      }
    }
    if (estado === 'document.error') throw new Error('PandaDoc no pudo armar el documento (document.error)')
    return { id, estado, link: linkEdicion(id), nombre: cuerpo.name, plantilla: cuerpo.template_uuid, faltantes, clave: origen, direccion }
  } catch (e) {
    throw new ErrorBorrador(id, e)
  }
}

/** Manda el contrato a firmar. El bot lo llama solo después de que el closer confirme que el borrador está completo.
 *  Con la clave de sandbox tira ContratoEnSandbox sin ningún pedido (el cliente recibiría un contrato de prueba con
 *  marca de agua). Después relee GET /documents/{id}/details y, si no está en "document.draft" o le queda una variable
 *  vacía, tira ContratoIncompleto sin mandar nada (silent:false le manda un email al cliente: no puede salir con
 *  [Client.City]). */
export async function enviarContrato(
  id: string, mensaje: string, opciones: OpcionesPandaDoc & { asunto?: string; permitirVacios?: string[] } = {},
) {
  if (clavePandaDoc(opciones).origen === 'PANDADOC_API_KEY_SANDBOX') throw new ContratoEnSandbox(id)
  const revision = revisarParaEnviar((await detallesDocumento(id, opciones)) ?? {}, opciones.permitirVacios)
  if (!revision.listo) throw new ContratoIncompleto(id, revision.estado, revision.vacios)
  const cuerpo: { message: string; silent: false; subject?: string } = { message: mensaje, silent: false }
  if (opciones.asunto) cuerpo.subject = opciones.asunto
  return pedir<{ id: string; status: string }>('POST', `/documents/${id}/send`, opciones, cuerpo)
}
