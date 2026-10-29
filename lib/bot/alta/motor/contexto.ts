// ── Bot "Capital Jurídico": lo que cada paso recibe del orquestador ─────────────────────────────────────────────────
// Solo tipos (y dos ayudas puras). Las dependencias externas van detrás de interfaces: servidor.ts arma las reales según el
// modo y las capacidades; los tests pasan versiones de juguete. Ningún paso sale a la red por su cuenta.
import type { AltaParseada } from '../parsear'
import type { ComprobantePago, ResultadoCargaFinanzas } from '../finanzasEscribir'
import type { FilaRegistroPagos } from '../finanzas'
import type { ExtrasCrm } from '../crm'
import type { ResultadoEscrituraCrm } from '../crmEscribir'
import type { OpcionesDrive, ResultadoDriveCliente } from '../driveCliente'
import type { BorradorCreado } from '../pandadoc'
import type { MepDiaAnterior } from '../mep'
import type { LecturaClaude } from '../comprobanteClaude'
import type { SetterFuente } from '../setterFuente'
import type { ClienteEncontrado } from '../altaLibre'
import type { AlmacenAltas, FilaAlta, FilaPaso } from './almacen'
import type { Capacidad, ModoMotor } from './modo'
import type { ClienteWhapi, ConfigGrupos, FotoGrupo, MedioDescargado, PasoId, TipoErrorWhapi } from './tipos'

export interface DepsContrato {
  /** ¿Hay una clave de PandaDoc utilizable en este entorno? (clavePandaDoc no tira) */
  hayClave(): boolean
  crear(a: AltaParseada, op: { alCrear: (id: string) => Promise<void>; metadata: Record<string, string> }): Promise<BorradorCreado>
  estado(id: string): Promise<string>
  /** GET /documents?q=<nombre exacto> creados desde `desdeMs` (para un POST que se cortó sin id). */
  buscar(nombre: string, desdeMs: number): Promise<{ id: string; estado: string }[]>
}

export interface DepsPasos {
  /** `archivoNuevo`: primer intento (un archivo con el mismo nombre en Subidos es de otro pago); `nombreArchivo`: el que
   *  eligió un intento anterior. Ver OpcionesCargaPago en finanzasEscribir.ts. */
  finanzas?: (fila: FilaRegistroPagos, comprobante: ComprobantePago | null, op: { modo: 'real' | 'simulacion'; hasta?: number; archivoNuevo?: boolean; nombreArchivo?: string | null }) => Promise<ResultadoCargaFinanzas>
  crm?: (a: AltaParseada, extras: Omit<ExtrasCrm, 'closersConocidos'>, op: { modo: 'real' | 'simulacion' }) => Promise<ResultadoEscrituraCrm>
  drive?: (a: AltaParseada, op: OpcionesDrive) => Promise<ResultadoDriveCliente>
  contrato?: DepsContrato
  mep?: (fechaPago: string) => Promise<MepDiaAnterior | null>
  vision?: (m: MedioDescargado) => Promise<LecturaClaude>
  /** Setter y UTM del lead en el CRM de ventas: por teléfono y, si no aparece, por el correo del #ALTA. */
  setterFuente?: (telefono: string, correo?: string | null) => Promise<SetterFuente | null>
  plantillaGuionesId?: () => string | null
  /** Alta en formato libre (26/10/2026, regla A): ¿la persona ya está en el CRM de Clientes? Solo lectura. */
  clienteCrm?: (p: { nombre: string | null; telefono: string | null; correo: string | null }) => Promise<ClienteEncontrado | null>
  /** Nombre del closer → teléfono o lid (BOT_ALTA_CLOSERS): el closer de un alta libre sale del autor del mensaje. */
  closers?: Record<string, string>
  /** Pago de un cliente existente (26/10/2026): cuántas cuotas suyas ya hay en "Registro de Pagos" (solo lectura). */
  cuotasAnteriores?: (p: { nombre: string | null; telefono: string | null }) => Promise<number>
  /** Modelo con el que se lee el comprobante (para la clave de la caché). */
  modeloVision: string
  /** Nombre (como en GRUPOS_COMUNIDAD) → teléfono. "Capital Jurídico" es el propio bot y no va. */
  equipo: Record<string, string>
  /** Teléfonos o lids de quienes aprueban (Tomi y Gero A) y de operaciones (Aylu). */
  aprobadores: string[]
  operaciones: string[]
  fotos: Partial<Record<'comunidad' | 'General' | 'Ventas' | 'Contenido', FotoGrupo>>
  maxComunidadesDia: number
  /** WhatsApp seguro (26/10/2026): true SOLO con BOT_COMUNIDAD_AGREGAR_DIRECTO=si (el modo viejo, que suma al cliente y a
   *  los socios a los grupos). Por defecto (false/ausente) la comunidad se arma solo con el equipo y el cliente entra por el
   *  link de invitación que el bot le pasa al closer. */
  agregarDirecto?: boolean
  esperar: (ms: number) => Promise<void>
  azar: () => number
}

export type DestinoEnvio = { grupo: 'ventas' | 'verificaciones' } | { chatId: string; cliente: true }

export interface EnvioSolicitado {
  proposito: string
  destino: DestinoEnvio
  tipo: 'texto' | 'video'
  texto: string                  // en un video, el pie ('' = sin pie)
  url?: string
  citar?: string | null
  menciones?: string[]
  esperaId?: string | null
  /** Un mensaje que quedó a medias (corte entre anotar y confirmar) NO se reenvía solo: queda dudoso (bienvenida). Sin
   *  esto, un envío dudoso o cortado a un grupo del equipo se reenvía con "(repetido)" (revisión del 24/10). */
  dudosoSiCortado?: boolean
  /** Plazo (ms) para el video (subida + envío). */
  hasta?: number
}

export type ResultadoEnvio =
  | { estado: 'enviado'; id: string | null }
  | { estado: 'ya_enviado' | 'simulado'; id: null }
  /** Whapi en pausa por un 429, o la guardia de salud frenó el envío (WhatsApp seguro: número caído o suspendido). */
  | { estado: 'pausado'; id: null; motivo?: string }
  | { estado: 'dudoso' | 'error'; id: null; tipo: TipoErrorWhapi | null; motivo: string }

export interface CtxPaso {
  alta: FilaAlta
  paso: FilaPaso
  pasos: Record<PasoId, FilaPaso>
  /** Modo efectivo del alta (el menor entre el del alta y el del entorno). */
  modo: ModoMotor
  /** ¿Este paso escribe de verdad? (modo real y la capacidad del alta y del entorno) */
  real: boolean
  /** Capacidades efectivas (para los mensajes). */
  capacidades: ReadonlySet<Capacidad>
  huboCorriendo: boolean
  /** Cuándo empezó la corrida anterior que quedó 'corriendo' (su ventana dudosa), o null. `paso.iniciado` es la de ahora. */
  iniciadoAnterior: string | null
  ahora: () => number
  hasta: number
  deps: DepsPasos
  whapi: ClienteWhapi
  grupos: ConfigGrupos
  almacen: AlmacenAltas
  dueno: string
  /** USD del Fee al que completa esta alta (si tiene altaAnterior). */
  anteriorUsd: number | null
  /** El alta del Fee al que completa (si tiene altaAnterior): su primera cuota y sus pagos (regla C, 26/10/2026). */
  anterior?: FilaAlta | null
  enviar(m: EnvioSolicitado): Promise<ResultadoEnvio>
  guardarParcial(parcial: Record<string, unknown>): Promise<void>
}

export const restante = (ctx: Pick<CtxPaso, 'hasta' | 'ahora'>) => ctx.hasta - ctx.ahora()
