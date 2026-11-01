// ── Bot "Capital Jurídico": carpeta de Drive del cliente nuevo (paso 4 de docs/BOT-ALTA-CJ.md) ──────────────────────
// Solo de servidor en modo 'real' (llama al Puente Drive). No lleva `import 'server-only'` para poder probarlo con node,
// como finanzasEscribir.ts; no importarlo desde componentes de cliente. Las funciones de nombres (nombreCliente,
// sufijoCliente, motivoNombreDudoso: en nombreCliente.ts; nombresDriveCliente: acá) son puras y tienen tests
// (scripts/test-bot-drive.mjs).
//
// Convención real de Drive (revisada el 24/10/2026 en las carpetas que arma Aylu dentro de "Clientes": Claudia Roldan,
// Mauro Lyonnet, Julio Herrera, Rodrigo Monges, Bárbara B., Marti F.):
//   Clientes / "<Nombre completo> - C.J"
//     · "Guiones - <PrimerNombre><InicialApellido>" (Google Doc): COPIA de la plantilla de guiones (TANDA 1°, 2° y 3°,
//       con cinco "Video: No iniciado" por tanda). Ej.: "Claudia Roldan" → "Guiones - ClaudiaR".
//     · "Crudos - ClaudiaR" y "Editados - ClaudiaR" (carpetas).
//     · "Marca - ClaudiaR" (carpeta, e05 de Grabación: el cliente sube su logo y sus colores; el vigía los lee y le
//       propone la paleta a Aylu). Las altas guardadas antes del 26/10 no tienen la clave 'marca': el reintento la crea
//       adentro de la carpeta del cliente (el puente busca por nombre ahí y devuelve la existente, así que no se duplica).
//   El bot suma "Bienvenida - <Nombre>" (Google Doc) con los bloques de armarBienvenida() (bienvenida.ts).
// Criterios del bot:
//   · Carpeta con el nombre completo del #ALTA (el paso 4 dice "Nombre completo - C.J"), sin título adelante ("Dra.",
//     "Escribana"…). Aylu a veces acorta ("Claudia Gabriela Roldan" → "Claudia Roldan - C.J"); el cruce carpeta ↔ cliente
//     de lib/clientes/drive.ts tolera las dos formas.
//   · Sufijo = primer nombre + inicial de la ÚLTIMA palabra ("Claudia Gabriela Roldan" → "ClaudiaR", como la carpeta
//     real). Aylu a veces usa solo iniciales ("Guiones - RM", "Guiones - RL"): el bot usa siempre la forma larga.
//     Los acentos se respetan ("Guiones - BelénA", como los de Aylu).
//   · Si el nombre parece traer más de una persona ("Juan Pérez y Ana Gómez", "Lucía Benítez (socia: Ana)"), no crea
//     nada: queda esperando que se confirme el nombre en Verificaciones C.J (esperaOk 'nombre_dudoso'; el nombre
//     confirmado vuelve en opciones.nombreConfirmado).
// Pasos (modo 'real'):
//   1) Carpeta "<Nombre> - C.J" en Clientes.
//      · Primera corrida (sin ids guardados en cj_altas): crearCarpeta. Si el puente devuelve una que YA EXISTÍA (un
//        homónimo, una que armó Aylu a mano o un intento anterior que no llegó a responder), no se crea nada adentro:
//        queda pendiente con aviso en Verificaciones C.J (esperaOk 'carpeta_existente'). Con el OK, el webhook guarda
//        el id con aprobarCarpetaExistente() y reintenta.
//      · Intento dudoso (docs/BOT-ALTA-CJ.md, "Puente Drive" → "Reintentos"): si un intento de crearCarpeta dio 5xx o no
//        respondió y después el puente devuelve la carpeta con yaExistia, puede ser la que creó ese intento. Solo se
//        acepta como del bot si la cuenta de servicio lee su fecha de creación y cae en la ventana de alguno de esos
//        intentos (carpetaDeIntentoDudoso); si no, es un homónimo real o la creó otro, y si no se puede leer, espera el
//        OK como siempre. La duda llega en el resultado del puente (reintento en la misma llamada) o en
//        opciones.intentoCarpeta (marca de corridas anteriores que terminaron sin respuesta: resultado.intentoCarpeta,
//        guardada en cj_altas). Las ventanas de cada corrida se guardan por separado: nunca se unen.
//      · Reintentos: se trabaja con el id guardado (opciones.guardado.carpeta) y NO se busca por nombre en Clientes.
//   2) En paralelo, adentro de esa carpeta: crearCarpeta Crudos, Editados y Marca, copiarArchivo de la plantilla de guiones y
//      crearDoc de la bienvenida. Lo que ya tiene id guardado no se vuelve a pedir; lo demás se busca por nombre solo
//      adentro de la carpeta del cliente (el puente devuelve el existente con yaExistia), así que no se duplica.
//   El webhook guarda resultado.guardar en cj_altas después de cada corrida y lo pasa como opciones.guardado.
// Si el puente publicado todavía no tiene copiarArchivo (Tomás tiene que publicar la versión nueva del Apps Script), los
// guiones quedan como pendiente y el resto se hace igual. Sin plantilla (PLANTILLA_GUIONES_ID), lo mismo.
// En modo 'simulacion' no llama al puente: devuelve los nombres y las llamadas que haría.
// Concurrencia: el puente busca-y-crea sin bloqueo, así que dos corridas SIMULTÁNEAS del mismo cliente podrían duplicar
// la carpeta. El webhook tiene que correr cada paso de un alta de a uno (tabla cj_altas). Si algún intento dudoso se cortó
// por tiempo o tardó más de 25 s, el Apps Script pudo seguir corriendo: el webhook no repite el paso antes de
// resultado.noReintentarAntesDe. Y tiene que pasar opciones.hasta (su maxDuration): sin plazo, cada llamada al puente
// tiene su tope (TOPE_LLAMADA_MS), pero el paso entero no.
import { googleConfigurado, googleJson } from '../../auth/googleRest'
import { armarBienvenida } from './bienvenida'
import { nombreCarpetaMarca } from '../../edicion/marca'
import { motivoNombreDudoso, nombreCliente, nombreDocBienvenida, sufijoCliente } from './nombreCliente'
import {
  ErrorPuente, esAccionDesconocida, esIdDrive, noRepetirAntesDe, puenteDriveReal, MAXIMO_APPS_SCRIPT_MS,
  type ArchivoSubido, type IntentoDudoso, type PuenteDriveCliente,
} from './puenteDrive'
import type { AltaParseada } from './parsear'

export { motivoNombreDudoso, nombreCliente, sufijoCliente } from './nombreCliente'

/** Carpeta "Clientes" de Drive (la misma que recorre lib/clientes/drive.ts). */
export const CARPETA_CLIENTES_DRIVE = process.env.DRIVE_CARPETA_CLIENTES?.trim() ?? ''

/** Variable de entorno con el id de la plantilla de guiones: una copia de un "Guiones - X" vacío llamada "Plantilla
 *  Guiones - C.J" y guardada FUERA de Clientes (docs/BOT-ALTA-CJ.md). No hay plantilla por defecto: el doc de un cliente
 *  real se llena con sus guiones, y copiarlo le daría esos guiones a cada cliente nuevo. Además, el puente solo copia
 *  archivos cuyo nombre empieza con "Plantilla". */
export const VARIABLE_PLANTILLA_GUIONES = 'PLANTILLA_GUIONES_ID'

/** Id de la plantilla de guiones de la variable de entorno; null si no está (los guiones quedan pendientes). */
export function plantillaGuionesDesdeEntorno(): string | null {
  const id = (process.env[VARIABLE_PLANTILLA_GUIONES] ?? '').trim()
  return id || null
}

export const SUFIJO_CARPETA = ' - C.J'
/** La bienvenida sale con la identidad de Capital Jurídico (Tomás, 31/10/2026: "mejorá mucho la identidad visual"). */
export const ESTILO_BIENVENIDA = 'cj' as const

// ── Nombres (puro) ──────────────────────────────────────────────────────────────────────────────────────────────
export interface NombresDrive {
  cliente: string    // "Claudia Roldan"
  carpeta: string    // "Claudia Roldan - C.J"
  sufijo: string     // "ClaudiaR"
  guiones: string    // "Guiones - ClaudiaR"
  crudos: string     // "Crudos - ClaudiaR"
  editados: string   // "Editados - ClaudiaR"
  marca: string      // "Marca - ClaudiaR"
  bienvenida: string // "Bienvenida - Claudia Roldan" (el mismo nombreDoc de armarBienvenida)
}

/** Todos los nombres de la carpeta del cliente. null si el #ALTA no trae un nombre con letras. */
export function nombresDriveCliente(nombre: string | null | undefined): NombresDrive | null {
  const cliente = nombreCliente(nombre)
  const sufijo = sufijoCliente(nombre)
  if (!cliente || !sufijo) return null
  return {
    cliente,
    carpeta: `${cliente}${SUFIJO_CARPETA}`,
    sufijo,
    guiones: `Guiones - ${sufijo}`,
    crudos: `Crudos - ${sufijo}`,
    editados: `Editados - ${sufijo}`,
    marca: nombreCarpetaMarca(sufijo),
    bienvenida: nombreDocBienvenida(cliente),
  }
}

// ── El paso completo ────────────────────────────────────────────────────────────────────────────────────────────
export type ModoDrive = 'real' | 'simulacion'
/** creado / existia (ya estaba y se reutilizó: por el id guardado o, adentro de la carpeta del cliente, por el nombre) /
 *  simulado / pendiente (no se pudo hacer todavía, sin error: falta la plantilla, la versión nueva del puente, la carpeta
 *  o un OK en Verificaciones C.J) / error. */
export type EstadoElementoDrive = 'creado' | 'existia' | 'simulado' | 'pendiente' | 'error'

export type ClaveDrive = 'carpeta' | 'crudos' | 'editados' | 'marca' | 'guiones' | 'bienvenida'
export const CLAVES_DRIVE: readonly ClaveDrive[] = ['carpeta', 'crudos', 'editados', 'marca', 'guiones', 'bienvenida']

export interface IdGuardado { id: string; url: string }
/** Ids de la carpeta y de cada elemento, para guardar en cj_altas (resultado.guardar) y pasar en el reintento
 *  (opciones.guardado). */
export type GuardadoDrive = Partial<Record<ClaveDrive, IdGuardado>>

/** nombre_dudoso = el nombre parece traer más de una persona: se confirma el nombre (opciones.nombreConfirmado).
 *  carpeta_existente = en la primera corrida ya había una carpeta con ese nombre en Clientes: con el OK se sigue en esa
 *  (aprobarCarpetaExistente); si es de otro cliente, se responde con otro nombre (opciones.nombreConfirmado). */
export type EsperaOkDrive = 'nombre_dudoso' | 'carpeta_existente'

export interface ElementoDrive {
  nombre: string
  estado: EstadoElementoDrive
  id: string | null
  url: string | null
  motivo: string | null
}

export interface LlamadaPuente { accion: 'crearCarpeta' | 'copiarArchivo' | 'crearDoc'; datos: Record<string, unknown> }

/** Marca de los intentos de crear la carpeta principal que no se sabe si se hicieron (5xx, sin respuesta, corte por
 *  tiempo): el webhook la guarda en cj_altas junto a `guardar` y la pasa en la corrida siguiente
 *  (opciones.intentoCarpeta). Solo vale para la misma carpeta (nombre y padre). Una ventana por llamada dudosa (las
 *  últimas MAXIMO_VENTANAS), nunca unidas: entre dos corridas pueden pasar horas y cualquiera pudo crear la carpeta. */
export interface IntentoCarpeta { nombre: string; padreId: string; ventanas: IntentoDudoso[] }
/** Ventanas que guarda la marca (las más nuevas). Perder una vieja solo hace más prudente al freno. */
export const MAXIMO_VENTANAS = 10

/** Lo que se lee de una carpeta con la cuenta de servicio (drive.readonly). creada = createdTime (ISO, reloj de Google). */
export interface DatosCarpetaDrive { creada: string | null; padres: string[]; papelera: boolean }
/** null = la cuenta de servicio no está configurada. Puede tirar excepción (sin permiso, 404, red). */
export type LeerCarpetaDrive = (id: string) => Promise<DatosCarpetaDrive | null>

export interface DepsDrive {
  puente?: () => PuenteDriveCliente
  /** Por defecto leerCarpetaDriveReal (la cuenta de servicio). Solo se usa ante un intento dudoso. */
  leerCarpeta?: LeerCarpetaDrive
}

export interface OpcionesDrive {
  modo: ModoDrive
  /** Id del doc que se copia como "Guiones - X" (plantillaGuionesDesdeEntorno()). null = los guiones quedan pendientes. */
  plantillaGuionesId: string | null
  /** Ids guardados en cj_altas por una corrida anterior (el resultado.guardar de esa corrida). Con la carpeta guardada no
   *  se busca por nombre en Clientes; lo que ya tiene id no se vuelve a pedir. */
  guardado?: GuardadoDrive | null
  /** Nombre confirmado en Verificaciones C.J (si el del #ALTA era dudoso o chocaba con la carpeta de otro cliente).
   *  Manda sobre a.nombre para la carpeta, los sufijos y la bienvenida, y no se vuelve a revisar. */
  nombreConfirmado?: string | null
  /** Por defecto CARPETA_CLIENTES_DRIVE. */
  carpetaClientesId?: string
  /** resultado.intentoCarpeta de la corrida anterior (guardado en cj_altas): la carpeta principal quedó dudosa. */
  intentoCarpeta?: IntentoCarpeta | null
  /** Plazo (epoch ms) para el puente real: ver OpcionesPuente.hasta en puenteDrive.ts. */
  hasta?: number
  deps?: DepsDrive
}

export interface ResultadoDriveCliente {
  modo: ModoDrive
  ok: boolean          // sin errores (los pendientes no cuentan como error)
  completo: boolean    // ok y sin pendientes: la carpeta quedó entera
  esperaOk: EsperaOkDrive | null   // no se creó (todo o parte) hasta que respondan en Verificaciones C.J
  nombres: NombresDrive | null
  carpeta: ElementoDrive
  crudos: ElementoDrive
  editados: ElementoDrive
  marca: ElementoDrive
  guiones: ElementoDrive
  bienvenida: ElementoDrive
  /** Para guardar en cj_altas: lo guardado antes más lo que esta corrida creó o reutilizó. No incluye una carpeta que
   *  espera el OK (esa se suma con aprobarCarpetaExistente). */
  guardar: GuardadoDrive
  /** Para guardar en cj_altas junto a `guardar` (y pasar como opciones.intentoCarpeta): la carpeta principal quedó sin
   *  confirmar después de un intento dudoso. null cuando ya no hay duda (se creó, se guardó o se aclaró). */
  intentoCarpeta: IntentoCarpeta | null
  /** Si algún intento dudoso se cortó por tiempo o tardó más de 25 s, el Apps Script pudo seguir corriendo hasta 6 min:
   *  el webhook no repite el paso antes de esta hora (ISO), para no correr en paralelo con él y duplicar. null = se puede
   *  repetir ya. */
  noReintentarAntesDe: string | null
  pendientes: string[]   // para avisar en Verificaciones C.J (qué hacer a mano, qué falta o qué confirmar)
  errores: string[]
  llamadas: LlamadaPuente[]   // las que hizo (real) o haría (simulación); sin la URL ni el secreto del puente
}

/** Mensaje de un error sin datos sensibles (los de ErrorPuente ya vienen limpios; el resto se recorta). */
const mensajeError = (e: unknown) => (e instanceof ErrorPuente ? e.message : String((e as Error)?.message ?? e).slice(0, 200))

const elemento = (nombre: string, estado: EstadoElementoDrive, motivo: string | null = null, r: Pick<ArchivoSubido, 'id' | 'url'> | null = null): ElementoDrive =>
  ({ nombre, estado, id: r?.id ?? null, url: r?.url ?? null, motivo })

const desdePuente = (nombre: string, r: ArchivoSubido): ElementoDrive => elemento(nombre, r.yaExistia ? 'existia' : 'creado', null, r)

/** Solo los ids con forma de id de Drive y con link (lo que venga roto de cj_altas se ignora y se vuelve a pedir). */
function guardadoValido(g: GuardadoDrive | null | undefined): GuardadoDrive {
  const limpio: GuardadoDrive = {}
  for (const k of CLAVES_DRIVE) {
    const x = g?.[k]
    if (x && esIdDrive(x.id) && typeof x.url === 'string' && x.url) limpio[k] = { id: x.id, url: x.url }
  }
  return limpio
}

export const PENDIENTE_COPIAR = 'El Puente Drive publicado todavía no sabe copiar archivos (copiarArchivo): Tomás tiene que publicar la versión nueva del Apps Script (docs/BOT-ALTA-CJ.md, "Puente Drive").'
export const PENDIENTE_PLANTILLA = `Falta el id de la plantilla de guiones (variable ${VARIABLE_PLANTILLA_GUIONES}: la copia "Plantilla Guiones - C.J", fuera de Clientes).`
export const PENDIENTE_NO_ES_PLANTILLA = `El puente no copió la plantilla de guiones porque su nombre no empieza con "Plantilla" (frena copiar el doc de un cliente): revisar ${VARIABLE_PLANTILLA_GUIONES}.`
export const MOTIVO_CARPETA_EXISTENTE = 'ya había una carpeta con ese nombre en Clientes: espera el OK en Verificaciones C.J'
export const MOTIVO_CARPETA_DE_INTENTO_DUDOSO = 'la creó el bot en un intento que no llegó a responder (lo confirma la fecha de creación en Drive)'
const MOTIVO_ESPERA_CARPETA = 'esperando el OK por la carpeta que ya existía'
const MOTIVO_ESPERA_NOMBRE = 'esperando que se confirme el nombre del cliente'
const RESPONDER_OK = 'Si es la de este cliente, responder OK y el bot sigue en esa carpeta; si es de otro, responder con el nombre que tiene que llevar la carpeta nueva.'

// ── Intento dudoso de la carpeta principal ─────────────────────────────────────────────────────────────────────
/** Tolerancia entre el reloj del servidor y el de Drive (createdTime lo pone Google). */
export const TOLERANCIA_RELOJ_MS = 3_000
const SCOPE_LECTURA_DRIVE = 'https://www.googleapis.com/auth/drive.readonly'

/** files.get por id con la cuenta de servicio (la misma lectura de solo lectura que lib/clientes/drive.ts hace sobre
 *  Clientes). Por id, no por nombre: no tiene la demora de las búsquedas. */
export const leerCarpetaDriveReal: LeerCarpetaDrive = async (id) => {
  if (!googleConfigurado()) return null
  const r = await googleJson<{ createdTime?: string; parents?: string[]; trashed?: boolean }>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=createdTime,parents,trashed&supportsAllDrives=true`,
    { scopes: SCOPE_LECTURA_DRIVE },
  )
  return { creada: r.createdTime ?? null, padres: Array.isArray(r.parents) ? r.parents : [], papelera: r.trashed === true }
}

export type OrigenCarpeta =
  | { nuestra: true; creada: string }
  | { nuestra: false; cuando: 'antes' | 'despues' | null; creada: string | null; motivo: string }

/** ¿La carpeta que devolvió crearCarpeta con yaExistia la creó un intento dudoso del bot? Solo si la cuenta de servicio
 *  lee que está en Clientes, fuera de la papelera, y que se creó dentro de la ventana de ALGUNA de las llamadas dudosas:
 *  desde TOLERANCIA_RELOJ_MS antes de que saliera hasta MAXIMO_APPS_SCRIPT_MS después de que terminó (después de un 5xx o
 *  de un corte por tiempo el Apps Script pudo seguir corriendo y crearla un rato más tarde). Cada ventana se mira por
 *  separado: las de dos corridas no se unen, porque entre una y otra pueden pasar horas.
 *  · Anterior a la primera ventana ('antes'): es un homónimo real. Ese intento la encontró al buscar y no creó nada.
 *  · Fuera de toda ventana pero posterior a la primera ('despues'): la creó otro (por ejemplo Aylu a mano, entre dos
 *    corridas).
 *  · Sin lectura o sin ventanas (cuando: null): no se acepta nunca. */
export async function carpetaDeIntentoDudoso(id: string, ventanas: readonly IntentoDudoso[], carpetaClientesId: string, leer: LeerCarpetaDrive): Promise<OrigenCarpeta> {
  const no = (motivo: string, creada: string | null = null, cuando: 'antes' | 'despues' | null = null): OrigenCarpeta => ({ nuestra: false, cuando, creada, motivo })
  if (!ventanas.length) return no('no hay intentos dudosos con qué comparar')
  let d: DatosCarpetaDrive | null
  try {
    d = await leer(id)
  } catch (e) {
    return no(`no se pudo leer la carpeta con la cuenta de servicio: ${mensajeError(e)}`)
  }
  if (!d) return no('la cuenta de servicio no está configurada')
  if (d.papelera) return no('la carpeta está en la papelera')
  if (!d.padres.includes(carpetaClientesId)) return no('la cuenta de servicio no la ve directamente adentro de Clientes')
  const creada = Date.parse(d.creada ?? '')
  if (!Number.isFinite(creada)) return no('Drive no devolvió la fecha de creación')
  const desde = (v: IntentoDudoso) => Date.parse(v.desde) - TOLERANCIA_RELOJ_MS
  if (ventanas.some((v) => creada >= desde(v) && creada <= Date.parse(v.hasta) + MAXIMO_APPS_SCRIPT_MS)) return { nuestra: true, creada: d.creada as string }
  if (creada < Math.min(...ventanas.map(desde))) return no('se creó antes del primer intento del bot', d.creada, 'antes')
  return no('se creó fuera de la ventana de los intentos del bot que no respondieron', d.creada, 'despues')
}

/** Una ventana con forma válida (normalizada a ISO) o null. */
function ventanaValida(v: IntentoDudoso | null | undefined): IntentoDudoso | null {
  if (!v || typeof v !== 'object') return null
  const desde = Date.parse(v.desde), hasta = Date.parse(v.hasta)
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde > hasta) return null
  return { desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString(), puedeSeguir: v.puedeSeguir === true }
}

/** Una marca de cj_altas con forma válida (las ventanas rotas se ignoran; sin ninguna sana, no hay marca). */
function intentoValido(x: IntentoCarpeta | null | undefined): IntentoCarpeta | null {
  if (!x || typeof x.nombre !== 'string' || !x.nombre || !esIdDrive(x.padreId) || !Array.isArray(x.ventanas)) return null
  const ventanas = x.ventanas.map(ventanaValida).filter((v): v is IntentoDudoso => v !== null).slice(-MAXIMO_VENTANAS)
  return ventanas.length ? { nombre: x.nombre, padreId: x.padreId, ventanas } : null
}

/** Ventana dudosa de un error del puente. null si fue un rechazo (seguro no se hizo). Si el error no trae la ventana (no
 *  es un ErrorPuente, o es uno sin `dudoso`), la del llamado entero y como si el Apps Script pudiera seguir (lo prudente). */
function dudosoDe(e: unknown, t0: number, t1: number): IntentoDudoso | null {
  if (e instanceof ErrorPuente) {
    if (e.aplicado === false) return null
    if (e.dudoso) return e.dudoso
  }
  return { desde: new Date(t0).toISOString(), hasta: new Date(t1).toISOString(), puedeSeguir: true }
}

const fechaAR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'medium' }) : '—'

/** Después del OK en Verificaciones C.J a una carpeta que ya existía (esperaOk 'carpeta_existente'): lo que el webhook
 *  guarda en cj_altas para que el reintento siga en esa carpeta. null si el resultado no espera ese OK. */
export function aprobarCarpetaExistente(res: ResultadoDriveCliente): GuardadoDrive | null {
  if (res.esperaOk !== 'carpeta_existente' || !esIdDrive(res.carpeta.id) || !res.carpeta.url) return null
  return { ...res.guardar, carpeta: { id: res.carpeta.id, url: res.carpeta.url } }
}

/** Arma (o reutiliza) la carpeta de Drive del cliente. No tira excepciones: los errores van en el resultado. */
export async function prepararDriveCliente(a: AltaParseada, opciones: OpcionesDrive): Promise<ResultadoDriveCliente> {
  const { modo } = opciones
  const carpetaClientesId = opciones.carpetaClientesId ?? CARPETA_CLIENTES_DRIVE
  const nombreConfirmado = opciones.nombreConfirmado?.trim() || null
  const alta: AltaParseada = nombreConfirmado ? { ...a, nombre: nombreConfirmado } : a
  const nombres = nombresDriveCliente(alta.nombre)
  const previo = guardadoValido(opciones.guardado)
  const llamadas: LlamadaPuente[] = []
  const pendientes: string[] = []
  const errores: string[] = []
  let esperaOk: EsperaOkDrive | null = null
  // Marca de una corrida anterior: viaja tal cual hasta que se aclare (con la carpeta guardada ya no hace falta)
  const marcaPrevia = previo.carpeta ? null : intentoValido(opciones.intentoCarpeta)
  let intentoCarpeta: IntentoCarpeta | null = marcaPrevia
  /** Ventanas dudosas de esta corrida (para noReintentarAntesDe). */
  const dudosos: IntentoDudoso[] = []

  const resultado = (els: Pick<ResultadoDriveCliente, ClaveDrive>): ResultadoDriveCliente => {
    const todos = CLAVES_DRIVE.map((k) => els[k])
    const ok = errores.length === 0 && !todos.some((x) => x.estado === 'error')
    const guardar: GuardadoDrive = { ...previo }
    for (const k of CLAVES_DRIVE) {
      const e = els[k]
      if ((e.estado === 'creado' || e.estado === 'existia') && e.id && e.url) guardar[k] = { id: e.id, url: e.url }
    }
    const noReintentarAntesDe = noRepetirAntesDe(dudosos)
    return { modo, ok, completo: ok && !todos.some((x) => x.estado === 'pendiente'), esperaOk, nombres, ...els, guardar, intentoCarpeta, noReintentarAntesDe, pendientes, errores, llamadas }
  }

  if (modo === 'real' && !esIdDrive(carpetaClientesId)) {
    errores.push('Falta DRIVE_CARPETA_CLIENTES válido: no se accede a Drive.');
    const nada = elemento('', 'pendiente', 'falta la carpeta raíz configurada');
    return resultado({ carpeta: nada, crudos: nada, editados: nada, marca: nada, guiones: nada, bienvenida: nada });
  }

  if (!nombres) {
    errores.push('Falta el nombre del cliente en el #ALTA: no se crea la carpeta de Drive.')
    const nada = elemento('', 'pendiente', 'falta el nombre del cliente')
    return resultado({ carpeta: nada, crudos: nada, editados: nada, marca: nada, guiones: nada, bienvenida: nada })
  }
  if (!esIdDrive(carpetaClientesId)) {
    errores.push('El id de la carpeta Clientes no es un id de Drive válido.')
    const nada = elemento('', 'pendiente', 'id de Clientes inválido')
    return resultado({ carpeta: elemento(nombres.carpeta, 'error', 'id de Clientes inválido'), crudos: nada, editados: nada, marca: nada, guiones: nada, bienvenida: nada })
  }

  const todosPendientes = (motivo: string, carpeta: ElementoDrive = elemento(nombres.carpeta, 'pendiente', motivo)) => resultado({
    carpeta,
    crudos: elemento(nombres.crudos, 'pendiente', motivo),
    editados: elemento(nombres.editados, 'pendiente', motivo),
    marca: elemento(nombres.marca, 'pendiente', motivo),
    guiones: elemento(nombres.guiones, 'pendiente', motivo),
    bienvenida: elemento(nombres.bienvenida, 'pendiente', motivo),
  })

  // Nombre que parece traer a más de una persona: nada hasta que se confirme (con la carpeta ya guardada, el nombre ya se
  // aceptó en una corrida anterior)
  const dudoso = nombreConfirmado || previo.carpeta ? null : motivoNombreDudoso(a.nombre)
  if (dudoso) {
    esperaOk = 'nombre_dudoso'
    pendientes.push(`El nombre del #ALTA ("${(a.nombre ?? '').trim()}") ${dudoso}: puede traer a más de una persona (los socios van en "Socios:"). No se crea nada en Drive hasta confirmar en Verificaciones C.J con qué nombre va la carpeta. Con este nombre sería "${nombres.carpeta}" con "${nombres.guiones}".`)
    return todosPendientes(MOTIVO_ESPERA_NOMBRE)
  }

  const bienvenida = armarBienvenida(alta)

  // Plantilla de guiones: sin id válido, los guiones quedan pendientes (no es un error del alta)
  const plantilla = opciones.plantillaGuionesId ?? null
  const motivoSinPlantilla = !plantilla ? PENDIENTE_PLANTILLA : !esIdDrive(plantilla) ? `El id de la plantilla de guiones no es un id de Drive válido (${VARIABLE_PLANTILLA_GUIONES}).` : null
  if (motivoSinPlantilla && !previo.guiones) pendientes.push(`${nombres.guiones}: ${motivoSinPlantilla} Copiar la plantilla a mano en la carpeta.`)

  /** Elemento que ya tiene id guardado en cj_altas: no se vuelve a pedir al puente. */
  const deGuardado = (nombre: string, g: IdGuardado) => elemento(nombre, 'existia', null, g)

  // ── Simulación: solo las llamadas que haría ──
  if (modo === 'simulacion') {
    const nueva = previo.carpeta?.id ?? '(id de la carpeta nueva)'
    if (!previo.carpeta) llamadas.push({ accion: 'crearCarpeta', datos: { padreId: carpetaClientesId, nombre: nombres.carpeta } })
    if (!previo.crudos) llamadas.push({ accion: 'crearCarpeta', datos: { padreId: nueva, nombre: nombres.crudos } })
    if (!previo.editados) llamadas.push({ accion: 'crearCarpeta', datos: { padreId: nueva, nombre: nombres.editados } })
    if (!previo.marca) llamadas.push({ accion: 'crearCarpeta', datos: { padreId: nueva, nombre: nombres.marca } })
    if (!previo.guiones && !motivoSinPlantilla) llamadas.push({ accion: 'copiarArchivo', datos: { archivoId: plantilla, carpetaId: nueva, nombre: nombres.guiones } })
    if (!previo.bienvenida) llamadas.push({ accion: 'crearDoc', datos: { carpetaId: nueva, nombre: nombres.bienvenida, bloques: bienvenida.bloquesDoc, estilo: ESTILO_BIENVENIDA } })
    const sim = (k: Exclude<ClaveDrive, 'guiones'>) => (previo[k] ? deGuardado(nombres[k], previo[k]) : elemento(nombres[k], 'simulado'))
    return resultado({
      carpeta: sim('carpeta'),
      crudos: sim('crudos'),
      editados: sim('editados'),
      marca: sim('marca'),
      guiones: previo.guiones ? deGuardado(nombres.guiones, previo.guiones) : elemento(nombres.guiones, motivoSinPlantilla ? 'pendiente' : 'simulado', motivoSinPlantilla),
      bienvenida: sim('bienvenida'),
    })
  }

  // ── Real ──
  let puente: PuenteDriveCliente
  try {
    puente = (opciones.deps?.puente ?? (() => puenteDriveReal({ hasta: opciones.hasta })))()
  } catch (e) {
    errores.push(`No se pudo usar el Puente Drive: ${mensajeError(e)}`)
    return todosPendientes('sin el Puente Drive', elemento(nombres.carpeta, 'error', mensajeError(e)))
  }
  const leerCarpeta = opciones.deps?.leerCarpeta ?? leerCarpetaDriveReal

  /** El reintento creó el elemento después de un intento dudoso: si ese intento también lo había creado y la búsqueda
   *  por nombre de Drive todavía no lo veía, puede haber quedado dos veces (docs/BOT-ALTA-CJ.md, "Riesgos que quedan"). */
  const avisarSiDuplicado = (nombre: string, r: ArchivoSubido, donde: string) => {
    if (r.dudoso && !r.yaExistia) pendientes.push(`${nombre}: el primer intento no respondió y el reintento lo creó. Si ese intento también lo había creado, puede haber quedado dos veces ${donde}: revisar (el que usa el bot es ${r.url}).`)
  }

  /** Llama al puente y anota las ventanas dudosas (de un error o de un reintento que terminó bien). */
  const conDudas = async (hacer: () => Promise<ArchivoSubido>): Promise<ArchivoSubido> => {
    const t0 = Date.now()
    try {
      const r = await hacer()
      if (r.dudoso) dudosos.push(r.dudoso)
      return r
    } catch (e) {
      const d = dudosoDe(e, t0, Date.now())
      if (d) dudosos.push(d)
      throw e
    }
  }

  // 1) Carpeta del cliente (sin ella no se puede seguir)
  let carpeta: ElementoDrive
  if (previo.carpeta) {
    // Reintento: el id guardado manda; no se busca por nombre en Clientes (podría devolver la de un homónimo)
    carpeta = deGuardado(nombres.carpeta, previo.carpeta)
  } else {
    // La marca de las corridas anteriores solo vale para esta misma carpeta (con otro nombre confirmado, no)
    const previas = marcaPrevia && marcaPrevia.nombre === nombres.carpeta && marcaPrevia.padreId === carpetaClientesId ? marcaPrevia.ventanas : []
    // Cada ventana por separado (nunca unidas) y solo las más nuevas
    const comoMarca = (vs: IntentoDudoso[]): IntentoCarpeta | null => (vs.length ? { nombre: nombres.carpeta, padreId: carpetaClientesId, ventanas: vs.slice(-MAXIMO_VENTANAS) } : null)
    llamadas.push({ accion: 'crearCarpeta', datos: { padreId: carpetaClientesId, nombre: nombres.carpeta } })
    let r: ArchivoSubido
    const t0 = Date.now()
    try {
      r = await conDudas(() => puente.crearCarpeta({ padreId: carpetaClientesId, nombre: nombres.carpeta }))
    } catch (e) {
      // Sin respuesta (o con una dudosa): queda la marca para que la corrida siguiente no confunda esta carpeta con un homónimo
      const d = dudosoDe(e, t0, Date.now())
      intentoCarpeta = comoMarca(d ? [...previas, d] : previas)
      errores.push(`${nombres.carpeta}: ${mensajeError(e)}`)
      return todosPendientes('sin la carpeta del cliente', elemento(nombres.carpeta, 'error', mensajeError(e)))
    }
    const ventanas = r.dudoso ? [...previas, r.dudoso] : previas
    intentoCarpeta = null
    if (r.yaExistia) {
      // Primera corrida y la carpeta ya estaba: puede ser de OTRO cliente. Si antes hubo un intento dudoso, puede ser la que
      // creó ese intento: solo se sigue si la fecha de creación lo confirma
      const origen = ventanas.length ? await carpetaDeIntentoDudoso(r.id, ventanas, carpetaClientesId, leerCarpeta) : null
      if (origen?.nuestra) {
        carpeta = elemento(nombres.carpeta, 'creado', MOTIVO_CARPETA_DE_INTENTO_DUDOSO, r)
      } else {
        // No se toca nada adentro hasta el OK
        esperaOk = 'carpeta_existente'
        const ya = `Ya había una carpeta "${nombres.carpeta}" en Clientes (${r.url})`
        if (!origen) {
          pendientes.push(`${ya} y es la primera vez que el bot arma esta alta: puede ser de otro cliente con el mismo nombre, una que armó Aylu a mano o la de un intento anterior que no llegó a responder. No se creó nada adentro. ${RESPONDER_OK}`)
        } else if (origen.cuando === 'antes') {
          pendientes.push(`${ya}, creada el ${fechaAR(origen.creada)}: es anterior al primer intento del bot, así que no es de esta alta (puede ser de otro cliente con el mismo nombre o una que armó Aylu a mano). No se creó nada adentro. ${RESPONDER_OK}`)
        } else if (origen.cuando === 'despues') {
          pendientes.push(`${ya}, creada el ${fechaAR(origen.creada)}: es posterior a los intentos del bot que no respondieron (fuera de su ventana), así que no la creó el bot (puede ser una que armó Aylu a mano). No se creó nada adentro. ${RESPONDER_OK}`)
        } else {
          // No se pudo leer: casi seguro es del bot, pero sin prueba no se abre el freno. La marca sigue para la próxima
          intentoCarpeta = comoMarca(ventanas)
          pendientes.push(`${ya}. Casi seguro la creó el bot: un intento del ${fechaAR(ventanas[ventanas.length - 1]?.desde ?? null)} no llegó a responder y después la carpeta ya estaba. No se pudo confirmar con la fecha de creación (${origen.motivo}), así que no se creó nada adentro. ${RESPONDER_OK}`)
        }
        return todosPendientes(MOTIVO_ESPERA_CARPETA, elemento(nombres.carpeta, 'pendiente', MOTIVO_CARPETA_EXISTENTE, r))
      }
    } else {
      avisarSiDuplicado(nombres.carpeta, r, 'en Clientes')
      carpeta = desdePuente(nombres.carpeta, r)
    }
  }
  const carpetaId = carpeta.id as string

  // 2) Lo de adentro, en paralelo (nombres distintos: no se pisan). Lo que ya tiene id guardado no se pide. Un reintento
  //    que encuentra lo que creó un intento dudoso lo marca 'existia' (adentro de la carpeta del cliente no hay homónimos).
  const adentroDe = `en "${nombres.carpeta}"`
  const intentar = async (nombre: string, hacer: () => Promise<ArchivoSubido>): Promise<ElementoDrive> => {
    try {
      const r = await conDudas(hacer)
      avisarSiDuplicado(nombre, r, adentroDe)
      return desdePuente(nombre, r)
    } catch (e) {
      errores.push(`${nombre}: ${mensajeError(e)}`)
      return elemento(nombre, 'error', mensajeError(e))
    }
  }
  const subcarpeta = async (k: 'crudos' | 'editados' | 'marca') => {
    const nombre = nombres[k]
    const g = previo[k]
    if (g) return deGuardado(nombre, g)
    llamadas.push({ accion: 'crearCarpeta', datos: { padreId: carpetaId, nombre } })
    return intentar(nombre, () => puente.crearCarpeta({ padreId: carpetaId, nombre }))
  }
  const copiarGuiones = async (): Promise<ElementoDrive> => {
    if (previo.guiones) return deGuardado(nombres.guiones, previo.guiones)
    if (motivoSinPlantilla) return elemento(nombres.guiones, 'pendiente', motivoSinPlantilla)
    llamadas.push({ accion: 'copiarArchivo', datos: { archivoId: plantilla, carpetaId, nombre: nombres.guiones } })
    try {
      const r = await conDudas(() => puente.copiarArchivo({ archivoId: plantilla as string, carpetaId, nombre: nombres.guiones }))
      avisarSiDuplicado(nombres.guiones, r, adentroDe)
      return desdePuente(nombres.guiones, r)
    } catch (e) {
      if (esAccionDesconocida(e)) {
        pendientes.push(`${nombres.guiones}: ${PENDIENTE_COPIAR} Mientras tanto, copiar la plantilla a mano en la carpeta.`)
        return elemento(nombres.guiones, 'pendiente', PENDIENTE_COPIAR)
      }
      if (e instanceof ErrorPuente && e.codigo === 'no_es_plantilla') {
        pendientes.push(`${nombres.guiones}: ${PENDIENTE_NO_ES_PLANTILLA} Mientras tanto, copiar la plantilla a mano en la carpeta.`)
        return elemento(nombres.guiones, 'pendiente', PENDIENTE_NO_ES_PLANTILLA)
      }
      errores.push(`${nombres.guiones}: ${mensajeError(e)}`)
      return elemento(nombres.guiones, 'error', mensajeError(e))
    }
  }
  const docBienvenida = async () => {
    if (previo.bienvenida) return deGuardado(nombres.bienvenida, previo.bienvenida)
    llamadas.push({ accion: 'crearDoc', datos: { carpetaId, nombre: nombres.bienvenida, bloques: bienvenida.bloquesDoc, estilo: ESTILO_BIENVENIDA } })
    return intentar(nombres.bienvenida, () => puente.crearDoc({ carpetaId, nombre: nombres.bienvenida, bloques: bienvenida.bloquesDoc, estilo: ESTILO_BIENVENIDA }))
  }

  const [crudos, editados, marca, guiones, docB] = await Promise.all([subcarpeta('crudos'), subcarpeta('editados'), subcarpeta('marca'), copiarGuiones(), docBienvenida()])
  return resultado({ carpeta, crudos, editados, marca, guiones, bienvenida: docB })
}
