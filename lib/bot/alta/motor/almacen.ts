// ── Bot "Capital Jurídico": estado persistido de las altas (tipos + almacén en memoria) ─────────────────────────────────
// Diseño del motor, secciones 3.1 y 8, con los cambios de la revisión:
//   · varias esperas por alta, cada una con su id de ronda y TODOS los mensajes que valen para citarla (puntos 9 y 10);
//   · `hay_pendientes`: quien no consigue el candado lo marca y el dueño no suelta hasta procesarlo (punto 11);
//   · los medios solo se suman, con una operación atómica; actualizarAlta nunca los escribe (punto 12);
//   · el modo y las capacidades de cada alta quedan fijos cuando nace; el entorno solo puede bajarlos (punto 27);
//   · columna `entorno` (production / preview / local): el barrido solo toma las del mismo entorno (punto 34).
// La interfaz AlmacenAltas la implementan almacenEnMemoria (tests y la simulación de la ruta) y almacenNeon (tablas
// cj_altas, cj_altas_pasos, cj_altas_mensajes y cj_altas_recursos). Este archivo no tiene red.
import type { AutorWhapi, EventoBot, GrupoBot, PasoId, RefMedio } from './tipos'
import { PASOS } from './tipos'
import type { Capacidad, ModoMotor } from './modo'
import type { ComparacionComprobante, SalidaComprobante } from '../comprobante'

export type EstadoAlta =
  | 'recibida' | 'esperando_comprobante' | 'en_curso' | 'esperando_humano' | 'esperando_reintento'
  | 'fee'          // Fee registrado: espera otro pago (no es final; se vence a los 60 días)
  | 'revisar'      // algo quedó a medias o no se pudo guardar: lo destraba un OK
  | 'lista' | 'rechazada' | 'reemplazada' | 'duplicada' | 'simulada' | 'vencida'   // finales
export const ESTADOS_FINALES: readonly EstadoAlta[] = ['lista', 'rechazada', 'reemplazada', 'duplicada', 'simulada', 'vencida']
export const esFinal = (e: EstadoAlta) => ESTADOS_FINALES.includes(e)

export type EstadoPaso = 'pendiente' | 'corriendo' | 'hecho' | 'simulado' | 'espera' | 'reintento' | 'revisar' | 'omitido'
export const PASO_TERMINADO: readonly EstadoPaso[] = ['hecho', 'simulado', 'omitido']

export type TipoEspera =
  | 'comprobante'     // closer: falta la imagen o el PDF
  | 'datos_closer'    // closer: faltantes del parser + el setter que no estaba en el #ALTA ni en el CRM de ventas
  | 'ok_nombre'       // equipo: el nombre parece traer más de una persona → OK o "OK Nombre Apellido"
  | 'ok_comprobante'  // aprobadores: no coincide / ilegible / formato no soportado / ya usado / pesos vs USD / varios
  | 'ok_cuenta'       // aprobadores: "OK Tomi" | "OK Gero" | "OK Empresa"
  | 'ok_mep'          // aprobadores: sin MEP después de 3 intentos → "OK 1450"
  | 'ok_fuente'       // aprobadores: los UTM no dicen la fuente (ni el closer) → "OK VSL Funnel"
  | 'ok_revision'     // aprobadores: avisos del parser, DFY+R, Fee + pago, corrección tardía, cliente ya en el CRM
  | 'ok_carpeta'      // equipo: carpeta_existente → OK o "OK Nombre nuevo"
  | 'ok_comunidad'    // operaciones: Aylu confirma (frena la bienvenida)
  | 'ok_bienvenida'   // operaciones: la bienvenida trae avisos
  | 'ok_dudoso'       // equipo: pudo haber quedado hecho: OK = ya está · NO = rehacer
  | 'ok_revisar'      // equipo: quedó a medias: OK = "ya lo arreglé, seguí"
  | 'ok_confirmacion' // aprobadores: "¿Esto es un alta?" (formato libre), el Fee o el pago de un cliente existente (26/10/2026)

/** Para qué es la espera (decide qué hace el OK o el NO). */
export type MotivoEspera =
  | 'validar' | 'nombre' | 'datos' | 'comprobante' | 'correccion' | 'fee_suma'
  | 'finanzas_repetido' | 'finanzas_cambio' | 'crm_duplicado' | 'crm_confirmar'
  | 'carpeta' | 'nombre_drive' | 'comunidad' | 'bienvenida' | 'dudoso' | 'revisar'
  | 'confirmacion' // reglas del 26/10/2026 (alta libre y #ALTA): "¿Esto es un alta?", Fee o pago de un cliente existente

export type Quien = 'closer' | 'aprobadores' | 'operaciones' | 'equipo'
export type EstadoEspera = 'abierta' | 'resuelta' | 'rechazada' | 'superada' | 'vencida' | 'simulada'
export type Requisito = 'cuenta' | 'mep' | 'nombre' | 'fuente'

/** `clave`: el evento que la resolvió. Si ese evento se vuelve a aplicar (la corrida anterior tiró a la mitad y quedó
 *  'nuevo'), se reaplica sin contestar "no está vigente" (revisión del 24/10: resolverEspera hace dos escrituras). */
export interface RespuestaEspera { veredicto: 'ok' | 'no'; resto: string; por: string; en: string; clave?: string }

export interface Espera {
  id: string                 // `<paso>-<n>`: id de la ronda (único dentro del alta)
  paso: PasoId
  motivo: MotivoEspera
  tipos: TipoEspera[]        // una ronda puede juntar varias preguntas en un solo mensaje por grupo
  grupo: GrupoBot
  quien: Quien
  mensajes: string[]         // ids de WhatsApp que valen para citarla: el pedido, los recordatorios y los reenvíos
  pedido: string[]           // qué se pidió (para el recordatorio y la pantalla)
  requiere: Requisito[]      // si un "OK" solo no alcanza
  estado: EstadoEspera
  desde: string
  recordatorios: number      // 1 a las 24 h, otro a las 72 h, después nada más
  ultimoRecordatorio: string | null
  respuesta: RespuestaEspera | null
  datos: Record<string, unknown> | null   // lo que hace falta para resolverla (texto nuevo de una corrección, etc.)
  // Envío del pedido (revisión del 24/10): un pedido que volvió dudoso, con error o sin id se reintenta con espera creciente;
  // `enviado` marca que salió (aunque Whapi no haya devuelto el id: lo trae después el eco), así los recordatorios corren.
  enviado?: string | null        // ISO: el pedido salió (o se simuló)
  intentosEnvio?: number         // intentos fallidos de mandar el pedido
  proximoEnvio?: string | null   // ISO: cuándo se vuelve a intentar mandarlo
  /** Despacho (26/10/2026): ISO del aviso a Discord con el link a la espera en /clientes/altas (sale una sola vez). */
  avisoDespacho?: string | null
}

export interface LecturaGuardada {
  modelo: string
  version: number
  sha256: string
  salida: SalidaComprobante | null
  motivo: string | null      // por qué no hay salida (formato no soportado, rechazo, JSON roto…)
  en: string
}

export interface Validacion {
  version: number
  textoParseado: string
  descargas: Record<string, { sha256: string; bytes: number; mime: string }>   // RefMedio.id → lo bajado (sin el archivo)
  lecturas: Record<string, LecturaGuardada>    // caché de Claude por `${sha256}:${version}:${modelo}`
  comparacion: ComparacionComprobante | null
  sha256: string | null                        // del comprobante principal
  numeroOperacion: string | null
  mep: { venta: number; fechaCotizacion: string; diaAnterior: string } | null
  mepIntentos: number
  setter: string | null; fuente: string | null; origenSetterFuente: 'crm_ventas' | 'closer' | null
  setterBuscado: boolean
  /** De dónde salió `fuente` (Tomás, 25/10/2026): de los UTM del lead, del closer (respaldo) o de un OK en Verificaciones.
   *  Sin el campo (altas viejas) y con `fuente`, se toma como firme. */
  origenFuente?: 'utm' | 'closer' | 'aprobadores' | null
  /** Lo que escribió el closer en "Fuente:" (en el #ALTA o en una respuesta), tal cual: solo se usa si los UTM no alcanzan. */
  fuenteCloser?: string | null
  /** Los UTM del lead en el CRM de ventas y la regla que se aplicó (para la pregunta en Verificaciones y el registro). */
  utm?: { source: string; medium: string; campaign: string } | null
  reglaFuente?: string | null
  /** Con qué teléfono se buscó en el CRM de ventas y qué se tomó de ahí: si una corrección cambia el teléfono, eso se suelta y se
   *  vuelve a buscar (revisión de la integración, ronda 3). */
  busquedaSetter?: { telefono: string; setter: string | null; fuente: string | null } | null
  cuenta: string | null; origenCuenta: 'comprobante' | 'medio' | 'aprobadores' | 'closer' | null
  nombreConfirmado: string | null
  /** pago_cliente (26/10/2026): un alta libre de alguien que YA está en el CRM de Clientes: solo se carga el pago en Finanzas. */
  estadoPlan: 'faltan_datos' | 'fee' | 'falta_usd' | 'necesita_ok' | 'lista' | 'renovacion' | 'pago_cliente' | null
  usdAcumulado: number | null                  // Fee + este pago (si hay altaAnterior)
  okComprobante: boolean                       // lo que difería del comprobante se aprobó con OK
  okRevision: string[]                         // avisos ya aprobados (no se vuelven a preguntar)
  okFeeSuma: boolean
  okRenovacion: boolean
  aprobaciones: { tipos: TipoEspera[]; por: string; en: string; resto: string; espera?: string }[]
  avisos: string[]                             // lo que se avisa una vez (lectura no disponible, MEP de otro día…)
  arranqueAvisado: boolean
  /** NO a la suma Fee + este pago: sigue como Fee (se carga en Finanzas igual) y espera otro pago (revisión del 24/10). */
  noFeeSuma?: boolean
  /** "Cuenta: X" que mandó alguien en Ventas: NO se usa sola (la cuenta la decide el comprobante o un OK de Tomi o Gero). */
  cuentaSugerida?: string | null
  /** Lecturas del comprobante seguidas que fallaron por algo pasajero (Claude o la descarga): a la tercera se avisa en
   *  Verificaciones, sin preguntar nada (revisión del 24/10, ronda 2). */
  fallasLectura?: number
  /** Confirmaciones de las reglas del 26/10/2026 (alta libre y #ALTA, lib/bot/alta/altaLibre.ts). `ok`: Verificaciones confirmó
   *  que es un alta (formato libre) o el pago de un cliente existente (un #ALTA sin cliente en el CRM nace con ok); `okFee`:
   *  aprobó el Fee (Finanzas + comunidad); `cliente`: la persona ya está en el CRM de Clientes (regla A); `crmBuscado`: ya se
   *  buscó (no se vuelve a leer el CRM en cada validación). */
  confirmacion?: { ok: boolean; okFee?: boolean; crmBuscado?: boolean; cliente?: { id: string; nombre: string; estado: string; motivo: string } | null; errorCrm?: string | null } | null
  /** Primera cuota del plan (regla C): de este mensaje o del alta del Fee anterior. */
  primeraCuotaUsd?: number | null
  /** Pagos de la cadena de Fee, en orden (300, 1000…), para el mensaje "300 + 1000 = 1300". */
  pagosFee?: number[] | null
}

export const validacionVacia = (): Validacion => ({
  version: 1, textoParseado: '', descargas: {}, lecturas: {}, comparacion: null, sha256: null, numeroOperacion: null, mep: null,
  mepIntentos: 0, setter: null, fuente: null, origenSetterFuente: null, setterBuscado: false, cuenta: null, origenCuenta: null,
  nombreConfirmado: null, estadoPlan: null, usdAcumulado: null, okComprobante: false, okRevision: [], okFeeSuma: false,
  okRenovacion: false, aprobaciones: [], avisos: [], arranqueAvisado: false,
})

export interface FilaAlta {
  id: string                    // 'alta_' + mensajeId del #ALTA (determinístico: crear dos veces no duplica)
  estado: EstadoAlta
  modo: ModoMotor               // FIJO desde que nace: un alta seca nunca corre en real sola
  capacidades: Capacidad[]      // FIJAS desde que nace (el entorno solo puede sacar)
  entorno: string               // VERCEL_ENV o 'local'
  chatId: string
  autor: AutorWhapi
  mensajeAltaId: string
  mensajesAlta: string[]        // el #ALTA y los #ALTA de corrección (se pueden citar)
  textoOriginal: string
  textoVigente: string          // después de fusionar respuestas y correcciones
  huella: string                // sha256 del texto normalizado (reenvíos)
  telefonoCliente: string | null
  nombreCliente: string | null
  medios: RefMedio[]
  fechaPago: string | null      // 'aaaa-mm-dd', CONGELADA en la primera validación
  validacion: Validacion | null
  esperas: Espera[]
  proximoIntento: string | null
  altaAnterior: string | null   // el Fee al que completa
  reemplazadaPor: string | null
  intentos: number
  error: string | null
  cadena: { desde: string; n: number } | null   // continuaciones encadenadas en la última hora
  notas: string[]               // pasos simulados, pausas por el entorno… (sin datos personales)
  creado: string
  actualizado: string
}

export interface FilaPaso {
  paso: PasoId
  estado: EstadoPaso
  resultado: unknown
  parcial: Record<string, unknown> | null
  noAntesDe: string | null
  iniciado: string | null
  intentos: number
  error: string | null
  dudoso: boolean               // hubo una corrida que pudo haber escrito sin que se guardara el resultado
}

export const pasoVacio = (paso: PasoId): FilaPaso => ({ paso, estado: 'pendiente', resultado: null, parcial: null, noAntesDe: null, iniciado: null, intentos: 0, error: null, dudoso: false })

export type NuevaAlta = Pick<FilaAlta, 'id' | 'modo' | 'capacidades' | 'entorno' | 'chatId' | 'autor' | 'mensajeAltaId' | 'textoOriginal' | 'huella' | 'telefonoCliente' | 'nombreCliente' | 'medios' | 'altaAnterior'> & { estado?: EstadoAlta; reemplazadaPor?: string | null }

/** Lo que actualizarAlta puede cambiar. Los medios NO (solo sumarMedios, atómico). */
export type CambiosAlta = Partial<Pick<FilaAlta, 'estado' | 'textoVigente' | 'telefonoCliente' | 'nombreCliente' | 'fechaPago' | 'validacion' | 'esperas' | 'proximoIntento' | 'reemplazadaPor' | 'intentos' | 'error' | 'cadena' | 'notas' | 'mensajesAlta'>>
  /** Solo el POST manual { alta_id, rehacer_en_real: true }: un alta seca no pasa a real sola. */
  & Partial<Pick<FilaAlta, 'modo' | 'capacidades'>>

export interface CambiosPaso { estado: EstadoPaso; resultado?: unknown; noAntesDe?: string | null; error?: string | null; dudoso?: boolean; parcial?: Record<string, unknown> | null; intentos?: number }

export type EstadoSaliente = 'nuevo' | 'enviado' | 'enviando' | 'simulado' | 'dudoso' | 'fallido'
export interface MensajeBot { altaId: string; esperaId: string | null; proposito: string | null; entrante: boolean }

export interface FiltroAltas {
  telefonoCliente?: string; huella?: string; sha256?: string; numeroOperacion?: string; autor?: AutorWhapi
  desde?: string; abiertas?: boolean; entorno?: string
}

export interface AlmacenAltas {
  /** Inserta los eventos sin repetir por clave. nuevos = los insertados + los que ya estaban y siguen 'nuevo'. */
  registrarEntrantes(evs: EventoBot[]): Promise<{ nuevos: EventoBot[]; repetidos: string[] }>
  crearAlta(a: NuevaAlta): Promise<{ alta: FilaAlta; creada: boolean }>
  leerAlta(id: string): Promise<FilaAlta | null>
  buscarAltas(f: FiltroAltas): Promise<FilaAlta[]>
  ultimas(n: number): Promise<FilaAlta[]>
  /** El alta (y la espera) de un mensaje: un mensaje del bot (saliente) o un #ALTA (entrante). */
  altaDeMensaje(whapiId: string): Promise<MensajeBot | null>
  /** Asigna un evento entrante a un alta (sin candado: solo la columna alta_id del evento). */
  asignarEvento(clave: string, altaId: string): Promise<void>
  /** Eventos 'nuevo' de un alta, en orden de llegada. */
  eventosDeAlta(altaId: string): Promise<EventoBot[]>
  /** Eventos 'nuevo' anteriores a `antesDe` (los de un after() que murió). */
  eventosSinProcesar(antesDe: string, limite: number): Promise<{ evento: EventoBot; altaId: string | null }[]>
  marcarProcesado(claves: string[], estado?: 'procesado' | 'ignorado'): Promise<void>
  /** Adjuntos sueltos del mismo autor (teléfono o lid) desde `desde`: se asignan al alta en una sola sentencia. */
  reclamarAdjuntos(p: { altaId: string; chatId: string; autor: AutorWhapi; desde: string }): Promise<string[]>
  /** Ediciones de un #ALTA que llegaron ANTES que el #ALTA (quedaron sueltas): se asignan al alta recién creada. */
  reclamarEdiciones(p: { altaId: string; mensajeId: string }): Promise<string[]>
  /** Un adjunto suelto reclama el alta más nueva del mismo autor creada desde `desde` que todavía no tiene comprobante, o
   *  que recibió otro medio hace menos de 60 s Y todavía no se validó (un álbum: revisión del 24/10, así un comprobante
   *  mandado antes del #ALTA siguiente no se lo queda la anterior). Suma los medios en la misma sentencia. */
  adjuntarMedio(p: { chatId: string; autor: AutorWhapi; desde: string; medios: RefMedio[]; ahora: string }): Promise<string | null>
  /** Suma medios (sin repetir por id) en una sentencia atómica. */
  sumarMedios(altaId: string, medios: RefMedio[], ahora: string): Promise<void>
  /** Toma el candado hasta `hastaMs`. Revisión del 24/10 (ronda 2): también deja proximo_intento como mucho en `hastaMs` +
   *  MARGEN_LEASE_MS (un lease), así un alta cuya invocación muere a la mitad (Vercel la corta, Neon se cae) la retoma el
   *  barrido cuando el candado vence. Una corrida normal lo reemplaza al cerrar. */
  reclamar(id: string, dueno: string, hastaMs: number): Promise<FilaAlta | null>
  /** Suelta el candado solo si es de `dueno` y no hay pendientes. false = hay pendientes: el dueño sigue. */
  soltar(id: string, dueno: string): Promise<boolean>
  marcarPendientes(id: string): Promise<void>
  limpiarPendientes(id: string, dueno: string): Promise<void>
  actualizarAlta(id: string, dueno: string, cambios: CambiosAlta): Promise<boolean>
  /** Cambio sin candado, solo si el estado actual está en `si` (p. ej. el Fee que queda reemplazado). */
  actualizarSiEstado(id: string, si: EstadoAlta[], cambios: CambiosAlta): Promise<boolean>
  leerPasos(id: string): Promise<Record<PasoId, FilaPaso>>
  /** Marca el paso 'corriendo' (con el candado) y devuelve `iniciado` (para el CAS de guardarPaso). */
  marcarCorriendo(id: string, paso: PasoId, dueno: string): Promise<string | null>
  /** Guarda el resultado con compare-and-set sobre `iniciado`. NO exige el candado. */
  guardarPaso(id: string, paso: PasoId, iniciado: string, r: CambiosPaso): Promise<boolean>
  /** Cambia un paso sin correrlo (resolver una espera): exige el candado. */
  fijarPaso(id: string, paso: PasoId, dueno: string, r: CambiosPaso): Promise<boolean>
  guardarParcial(id: string, paso: PasoId, parcial: Record<string, unknown>): Promise<void>
  /** `huellaSiRepite`: si el saliente quedó 'enviando' o 'dudoso' (y quien llama lo va a reenviar con "(repetido)"), pasa a
   *  tener esa huella, así el eco de la copia empareja (revisión del 24/10, ronda 2). */
  anotarSaliente(p: { altaId: string; proposito: string; chatId: string; esperaId?: string | null; huella: string; huellaSiRepite?: string }): Promise<EstadoSaliente>
  /** Deja el estado final de un envío y devuelve cómo quedó. Un saliente que su eco ya dejó 'enviado' no baja a 'dudoso' ni
   *  a 'fallido' (el eco llegó antes que el error: revisión del 24/10, ronda 2), salvo con `forzar` (un NO de una persona). */
  confirmarSaliente(p: { altaId: string; proposito: string; whapiId: string | null; estado: Exclude<EstadoSaliente, 'nuevo' | 'enviando'>; forzar?: boolean }): Promise<{ estado: EstadoSaliente; whapiId: string | null } | null>
  /** Eco de un mensaje del bot: el saliente del mismo chat y huella (desde `desde`) queda 'enviado' con ese id. */
  salientePorEco(p: { chatId: string; huella: string; desde: string; whapiId: string }): Promise<{ altaId: string; proposito: string } | null>
  /** Altas con proximo_intento vencido, sin candado, no finales y del entorno. */
  vencidas(limite: number, entorno: string, ahora: string): Promise<string[]>
  tomarRecurso(nombre: string, dueno: string, ttlMs: number): Promise<boolean>
  soltarRecurso(nombre: string, dueno: string): Promise<void>
  leerRecurso(nombre: string): Promise<{ dueno: string | null; hasta: string | null; datos: Record<string, unknown> | null } | null>
  guardarDatosRecurso(nombre: string, datos: Record<string, unknown>): Promise<void>
  purgar(ahora: string): Promise<number>
}

// ── Utilidades compartidas por las dos implementaciones ──

/** ¿Es el mismo autor? Por teléfono o por lid (con data_mode replace el mismo closer llega a veces con uno y a veces con
 *  el otro: punto 31 de la revisión). */
export function mismoAutor(a: AutorWhapi | null | undefined, b: AutorWhapi | null | undefined): boolean {
  if (!a || !b) return false
  return (!!a.telefono && a.telefono === b.telefono) || (!!a.lid && a.lid === b.lid)
}

export const iso = (ms: number) => new Date(ms).toISOString()

/** Margen del lease de reclamar(): después de `hasta` + esto, el barrido puede retomar un alta cuya invocación murió. */
export const MARGEN_LEASE_MS = 60_000

// ── Almacén en memoria (tests y simulación de la ruta) ───────────────────────────────────────────────────────────────

interface Entrante { evento: EventoBot; altaId: string | null; estado: 'nuevo' | 'procesado' | 'ignorado'; creado: number }
interface Saliente { altaId: string; proposito: string; chatId: string; esperaId: string | null; huella: string; whapiId: string | null; estado: EstadoSaliente; creado: number }
interface Candado { dueno: string | null; hasta: number; pendientes: boolean }

const clonar = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)))

export interface OpcionesMemoria { ahora?: () => number }

/** Almacén en memoria con la misma semántica que el de Neon (cada operación es atómica: no hay await adentro). */
export function almacenEnMemoria(op: OpcionesMemoria = {}): AlmacenAltas & { volcado(): { altas: FilaAlta[]; pasos: Record<string, Record<string, FilaPaso>>; entrantes: Entrante[]; salientes: Saliente[] } } {
  const ahora = op.ahora ?? Date.now
  const altas = new Map<string, FilaAlta>()
  const candados = new Map<string, Candado>()
  const pasos = new Map<string, Map<PasoId, FilaPaso>>()
  const entrantes = new Map<string, Entrante>()
  const salientes = new Map<string, Saliente>()
  const recursos = new Map<string, { dueno: string | null; hasta: number; datos: Record<string, unknown> | null }>()
  let reloj = 0
  /** iniciado único y creciente aunque el reloj de los tests no avance. */
  const marcaUnica = () => { reloj = Math.max(reloj + 1, ahora()); return iso(reloj) }
  const conCandado = (id: string, dueno: string) => { const c = candados.get(id); return !!c && c.dueno === dueno && c.hasta > ahora() }
  const pasosDe = (id: string) => { let m = pasos.get(id); if (!m) { m = new Map(); pasos.set(id, m) } return m }
  const autorDeEvento = (e: EventoBot): AutorWhapi => e.autor

  return {
    async registrarEntrantes(evs) {
      const nuevos: EventoBot[] = [], repetidos: string[] = []
      for (const e of evs) {
        const ya = entrantes.get(e.clave)
        if (!ya) { entrantes.set(e.clave, { evento: clonar(e), altaId: null, estado: 'nuevo', creado: ahora() }); nuevos.push(e) }
        else { repetidos.push(e.clave); if (ya.estado === 'nuevo') nuevos.push(clonar(ya.evento)) }
      }
      return { nuevos, repetidos }
    },
    async crearAlta(a) {
      const ya = altas.get(a.id)
      if (ya) return { alta: clonar(ya), creada: false }
      const t = iso(ahora())
      const fila: FilaAlta = {
        id: a.id, estado: a.estado ?? 'recibida', modo: a.modo, capacidades: [...a.capacidades], entorno: a.entorno, chatId: a.chatId,
        autor: clonar(a.autor), mensajeAltaId: a.mensajeAltaId, mensajesAlta: [a.mensajeAltaId], textoOriginal: a.textoOriginal,
        textoVigente: a.textoOriginal, huella: a.huella, telefonoCliente: a.telefonoCliente, nombreCliente: a.nombreCliente,
        // Nace con proximo_intento = ahora (revisión del 24/10, ronda 2): si nadie llega a avanzarla (sin tiempo en la
        // invocación, Vercel la corta, Neon se cae), el barrido la ve. Una final (duplicada) no lo necesita.
        medios: clonar(a.medios), fechaPago: null, validacion: null, esperas: [], proximoIntento: esFinal(a.estado ?? 'recibida') ? null : t, altaAnterior: a.altaAnterior,
        reemplazadaPor: a.reemplazadaPor ?? null, intentos: 0, error: null, cadena: null, notas: [], creado: t, actualizado: t,
      }
      altas.set(a.id, fila)
      candados.set(a.id, { dueno: null, hasta: 0, pendientes: false })
      return { alta: clonar(fila), creada: true }
    },
    async leerAlta(id) { const a = altas.get(id); return a ? clonar(a) : null },
    async buscarAltas(f) {
      const desde = f.desde ? Date.parse(f.desde) : -Infinity
      return [...altas.values()].filter((a) =>
        (f.telefonoCliente === undefined || a.telefonoCliente === f.telefonoCliente)
        && (f.huella === undefined || a.huella === f.huella)
        && (f.sha256 === undefined || a.validacion?.sha256 === f.sha256)
        && (f.numeroOperacion === undefined || a.validacion?.numeroOperacion === f.numeroOperacion)
        && (f.autor === undefined || mismoAutor(a.autor, f.autor))
        && Date.parse(a.creado) >= desde
        && (!f.abiertas || !esFinal(a.estado))
        && (f.entorno === undefined || a.entorno === f.entorno),
      ).sort((x, y) => y.creado.localeCompare(x.creado)).map(clonar)
    },
    async ultimas(n) { return [...altas.values()].sort((x, y) => y.creado.localeCompare(x.creado)).slice(0, n).map(clonar) },
    async altaDeMensaje(whapiId) {
      for (const s of salientes.values()) if (s.whapiId === whapiId) return { altaId: s.altaId, esperaId: s.esperaId, proposito: s.proposito, entrante: false }
      for (const a of altas.values()) if (a.mensajesAlta.includes(whapiId)) return { altaId: a.id, esperaId: null, proposito: null, entrante: true }
      return null
    },
    async asignarEvento(clave, altaId) { const e = entrantes.get(clave); if (e) e.altaId = altaId },
    async eventosDeAlta(altaId) {
      return [...entrantes.values()].filter((e) => e.altaId === altaId && e.estado === 'nuevo')
        .sort((x, y) => x.evento.enviadoEn.localeCompare(y.evento.enviadoEn) || x.creado - y.creado).map((e) => clonar(e.evento))
    },
    async eventosSinProcesar(antesDe, limite) {
      const t = Date.parse(antesDe)
      return [...entrantes.values()].filter((e) => e.estado === 'nuevo' && e.creado < t).slice(0, limite).map((e) => ({ evento: clonar(e.evento), altaId: e.altaId }))
    },
    async marcarProcesado(claves, estado = 'procesado') { for (const c of claves) { const e = entrantes.get(c); if (e) e.estado = estado } },
    async reclamarAdjuntos({ altaId, chatId, autor, desde }) {
      const t = Date.parse(desde), out: string[] = []
      for (const e of entrantes.values()) {
        if (e.altaId === null && e.estado === 'nuevo' && e.evento.tipo === 'adjunto' && e.evento.chatId === chatId && mismoAutor(autorDeEvento(e.evento), autor) && e.creado >= t) {
          e.altaId = altaId; out.push(e.evento.clave)
        }
      }
      return out
    },
    async reclamarEdiciones({ altaId, mensajeId }) {
      const out: string[] = []
      for (const e of entrantes.values()) {
        if (e.altaId === null && e.estado === 'nuevo' && e.evento.tipo === 'edicion' && e.evento.mensajeId === mensajeId) { e.altaId = altaId; out.push(e.evento.clave) }
      }
      return out
    },
    async adjuntarMedio({ chatId, autor, desde, medios, ahora: t }) {
      const d = Date.parse(desde), tAhora = Date.parse(t)
      const candidatas = [...altas.values()].filter((a) => a.chatId === chatId && mismoAutor(a.autor, autor)
        && ['recibida', 'esperando_comprobante', 'esperando_humano', 'en_curso'].includes(a.estado) && Date.parse(a.creado) > d
        && (a.medios.length === 0 || (a.validacion === null && tAhora - Date.parse((a as FilaAlta & { mediosEn?: string }).mediosEn ?? a.creado) < 60_000)))
        .sort((x, y) => y.creado.localeCompare(x.creado))
      const a = candidatas[0]
      if (!a) return null
      for (const m of medios) if (!a.medios.some((x) => x.id === m.id)) a.medios.push(clonar(m));
      (a as FilaAlta & { mediosEn?: string }).mediosEn = t
      return a.id
    },
    async sumarMedios(altaId, medios, t) {
      const a = altas.get(altaId)
      if (!a) return
      for (const m of medios) if (!a.medios.some((x) => x.id === m.id)) a.medios.push(clonar(m));
      (a as FilaAlta & { mediosEn?: string }).mediosEn = t
    },
    async reclamar(id, dueno, hastaMs) {
      const a = altas.get(id), c = candados.get(id)
      if (!a || !c) return null
      if (c.dueno && c.dueno !== dueno && c.hasta > ahora()) return null
      c.dueno = dueno; c.hasta = hastaMs
      if (!esFinal(a.estado)) {
        const lease = hastaMs + MARGEN_LEASE_MS
        if (!a.proximoIntento || Date.parse(a.proximoIntento) > lease) a.proximoIntento = iso(lease)
      }
      return clonar(a)
    },
    async soltar(id, dueno) {
      const c = candados.get(id)
      if (!c || c.dueno !== dueno) return true
      if (c.pendientes) return false
      c.dueno = null; c.hasta = 0
      return true
    },
    async marcarPendientes(id) { const c = candados.get(id); if (c) c.pendientes = true },
    async limpiarPendientes(id, dueno) { const c = candados.get(id); if (c && c.dueno === dueno) c.pendientes = false },
    async actualizarAlta(id, dueno, cambios) {
      if (!conCandado(id, dueno)) return false
      const a = altas.get(id)!
      Object.assign(a, clonar(cambios), { actualizado: iso(ahora()) })
      return true
    },
    async actualizarSiEstado(id, si, cambios) {
      const a = altas.get(id)
      if (!a || !si.includes(a.estado)) return false
      Object.assign(a, clonar(cambios), { actualizado: iso(ahora()) })
      return true
    },
    async leerPasos(id) {
      const m = pasosDe(id)
      return Object.fromEntries(PASOS.map((p) => [p, clonar(m.get(p) ?? pasoVacio(p))])) as Record<PasoId, FilaPaso>
    },
    async marcarCorriendo(id, paso, dueno) {
      if (!conCandado(id, dueno)) return null
      const m = pasosDe(id)
      const p = m.get(paso) ?? pasoVacio(paso)
      const iniciado = marcaUnica()
      m.set(paso, { ...p, estado: 'corriendo', iniciado, intentos: p.intentos + 1 })
      return iniciado
    },
    async guardarPaso(id, paso, iniciado, r) {
      const m = pasosDe(id)
      const p = m.get(paso)
      if (!p || p.iniciado !== iniciado) return false
      m.set(paso, aplicarCambiosPaso(p, r))
      return true
    },
    async fijarPaso(id, paso, dueno, r) {
      if (!conCandado(id, dueno)) return false
      const m = pasosDe(id)
      m.set(paso, aplicarCambiosPaso(m.get(paso) ?? pasoVacio(paso), r))
      return true
    },
    async guardarParcial(id, paso, parcial) {
      const m = pasosDe(id)
      const p = m.get(paso) ?? pasoVacio(paso)
      m.set(paso, { ...p, parcial: { ...(p.parcial ?? {}), ...clonar(parcial) } })
    },
    async anotarSaliente({ altaId, proposito, chatId, esperaId, huella, huellaSiRepite }) {
      const k = `${altaId}:${proposito}`
      const ya = salientes.get(k)
      if (ya) {
        if (ya.estado === 'fallido') { ya.estado = 'enviando'; ya.huella = huella; return 'nuevo' }
        if (huellaSiRepite && (ya.estado === 'enviando' || ya.estado === 'dudoso')) ya.huella = huellaSiRepite
        return ya.estado
      }
      salientes.set(k, { altaId, proposito, chatId, esperaId: esperaId ?? null, huella, whapiId: null, estado: 'enviando', creado: ahora() })
      return 'nuevo'
    },
    async confirmarSaliente({ altaId, proposito, whapiId, estado, forzar }) {
      const s = salientes.get(`${altaId}:${proposito}`)
      if (!s) return null
      const confirmadoPorEco = s.estado === 'enviado' && (estado === 'dudoso' || estado === 'fallido') && !forzar
      if (!confirmadoPorEco) {
        s.estado = estado
        if (whapiId) s.whapiId = whapiId
      }
      return { estado: s.estado, whapiId: s.whapiId }
    },
    async salientePorEco({ chatId, huella, desde, whapiId }) {
      const t = Date.parse(desde)
      for (const s of salientes.values()) {
        if (s.chatId === chatId && s.huella === huella && s.creado >= t && (!s.whapiId || s.whapiId === whapiId) && s.estado !== 'simulado') {
          s.whapiId = whapiId; s.estado = 'enviado'
          return { altaId: s.altaId, proposito: s.proposito }
        }
      }
      return null
    },
    async vencidas(limite, entorno, t) {
      const tt = Date.parse(t)
      return [...altas.values()].filter((a) => a.entorno === entorno && !esFinal(a.estado) && a.proximoIntento && Date.parse(a.proximoIntento) <= tt
        && !((candados.get(a.id)?.dueno) && (candados.get(a.id)!.hasta > ahora()))).slice(0, limite).map((a) => a.id)
    },
    async tomarRecurso(nombre, dueno, ttlMs) {
      const r = recursos.get(nombre)
      if (r && r.dueno && r.dueno !== dueno && r.hasta > ahora()) return false
      recursos.set(nombre, { dueno, hasta: ahora() + ttlMs, datos: r?.datos ?? null })
      return true
    },
    async soltarRecurso(nombre, dueno) { const r = recursos.get(nombre); if (r && r.dueno === dueno) { r.dueno = null; r.hasta = 0 } },
    async leerRecurso(nombre) { const r = recursos.get(nombre); return r ? { dueno: r.dueno, hasta: r.hasta ? iso(r.hasta) : null, datos: clonar(r.datos) } : null },
    async guardarDatosRecurso(nombre, datos) { const r = recursos.get(nombre) ?? { dueno: null, hasta: 0, datos: null }; r.datos = clonar(datos); recursos.set(nombre, r) },
    async purgar(t) {
      const tt = Date.parse(t)
      let n = 0
      for (const [k, e] of entrantes) if (tt - e.creado > 14 * 86_400_000) { entrantes.delete(k); n++ }
      for (const a of altas.values()) {
        if (esFinal(a.estado) && tt - Date.parse(a.actualizado) > 60 * 86_400_000 && a.textoOriginal) {
          a.textoOriginal = ''; a.textoVigente = ''; a.medios = a.medios.map((m) => ({ ...m, link: null }))
          if (a.validacion) for (const l of Object.values(a.validacion.lecturas)) l.salida = null
          n++
        }
      }
      return n
    },
    volcado() {
      return {
        altas: [...altas.values()].map(clonar),
        pasos: Object.fromEntries([...pasos].map(([k, m]) => [k, Object.fromEntries(m)])),
        entrantes: [...entrantes.values()].map(clonar),
        salientes: [...salientes.values()].map(clonar),
      }
    },
  }
}

export function aplicarCambiosPaso(p: FilaPaso, r: CambiosPaso): FilaPaso {
  return {
    ...p,
    estado: r.estado,
    ...(r.resultado !== undefined ? { resultado: clonar(r.resultado) } : {}),
    ...(r.noAntesDe !== undefined ? { noAntesDe: r.noAntesDe } : {}),
    ...(r.error !== undefined ? { error: r.error } : {}),
    ...(r.dudoso !== undefined ? { dudoso: r.dudoso } : {}),
    ...(r.parcial !== undefined ? { parcial: r.parcial === null ? null : { ...(p.parcial ?? {}), ...clonar(r.parcial) } } : {}),
    ...(r.intentos !== undefined ? { intentos: r.intentos } : {}),
  }
}
