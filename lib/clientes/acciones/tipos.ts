// ── Acciones sobre un cliente desde su tarjeta (contrato compartido con la pantalla del Hub) ─────────────────────────────
// Pedido de Tomás (27/10/2026, por el orquestador "Hub de Clientes"): manejar dentro del Despacho sumar servicio, pausar y
// reanudar, pagos, archivar, renovaciones y llamadas de proyección, SIN migrar: el CRM sigue siendo la fuente. El Despacho
// registra cada acción en Neon (cj_cliente_acciones) y, según CLIENTES_ESCRITURA, la aplica o no al CRM:
//   · sombra (por defecto): registra y devuelve el plan de celdas ("esto se escribiría"); no toca planillas.
//   · prueba: escribe solo sobre el cliente de prueba (CLIENTES_ID_PRUEBA, Z001) y verifica.
//   · real: escribe en el CRM (con el OK de Tomás, después de la prueba).
// Este archivo no importa nada del servidor: lo puede importar la pantalla.
import type { Ymd } from '../fechas'

export type ModoAcciones = 'sombra' | 'prueba' | 'real'
export type EstadoAccion = 'registrada' | 'aplicada' | 'error' | 'anulada'

/** Acciones disponibles desde la tarjeta. Todos los tipos admiten revisión previa. */
export const TIPOS_ACCION = ['servicio', 'pausa', 'reanudar', 'datos', 'pago', 'archivar', 'restaurar', 'renovacion', 'proyeccion'] as const
export type TipoAccion = (typeof TIPOS_ACCION)[number]
export const TIPOS_ACTIVOS: readonly TipoAccion[] = TIPOS_ACCION

// ── Campos editables (acción 'datos'; la lista blanca está en campos.ts) ──
export type ClaveCampo =
  | 'nombre' | 'estudio' | 'csm' | 'ciudad' | 'celular' | 'mail' | 'closer' | 'fuente' | 'contrato' | 'dia1' | 'promesa' | 'satisfaccion'
  | 'testimonio' | 'gameplan' | 'notasRenov' | 'anotaciones' | 'llamadaAgendada' | 'proximoCobro' | 'fechaBaja'
/** texto = una línea · textoLargo = varias líneas · fecha = 'AAAA-MM-DD' o '' · numero = 1–10 o '' · opcion = uno de `opciones` */
export interface CampoEditable {
  campo: ClaveCampo; etiqueta: string; tipo: 'texto' | 'textoLargo' | 'fecha' | 'numero' | 'opcion'
  valor: string; hoja: string; columna: string; opciones?: string[]; max?: number; soloFinanzas: boolean; aviso?: string
  fuenteOpciones?: { fuente: string; version: string }
}
/** Respuesta de GET /acciones?campos=1. Sin Finanzas no vienen los campos soloFinanzas. */
export interface RespuestaCampos { ok: boolean; modo: ModoAcciones; campos: CampoEditable[]; mensaje?: string }

// ── Cuerpos del POST /api/clientes/<id>/acciones (siempre con `tipo`) ──
/** Sumar servicio: 1 mes, 2 semanas o personalizado (hasta una fecha o una cantidad de días). Fila de precio 0 en Renovaciones. */
export interface CuerpoServicio { tipo: 'servicio'; duracion: '1m' | '2s' | 'personalizado'; hasta?: Ymd; dias?: number; motivo?: string }
/** Pausar: Estado → PAUSADO desde esa fecha (hoy por defecto). El servicio no corre mientras dura. */
export interface CuerpoPausa { tipo: 'pausa'; desde?: Ymd; motivo?: string }
/** Reanudar: Estado → ACTIVO y se suma como extensión el tiempo pausado ("+N días — compensa pausa"). */
export interface CuerpoReanudar { tipo: 'reanudar'; fecha?: Ymd; desdePausa?: Ymd; motivo?: string }
/** Editar datos de la fila del cliente. Solo campos que cambian; `valor` siempre texto ('' = vaciar). Hasta 20 por vez. */
export interface CuerpoDatos { tipo: 'datos'; cambios: { campo: ClaveCampo; valor: string }[]; motivo?: string }
/** Pago a Finanzas → Registro de Pagos. Requiere la sección finanzas. */
export interface CuerpoPago {
  tipo: 'pago'; fecha: Ymd; usd: number; ars?: number
  concepto: 'Fee' | '1ra Cuota' | '2da Cuota' | '3ra Cuota' | '4ta Cuota' | 'PIF' | 'Renovación'
  cuenta: 'Tomi' | 'Gero' | 'Empresa'; comprobanteDriveId?: string; programa?: string; fuente?: string; setter?: string; tipoVenta?: 'Front-end' | 'Back-end'
}
/** Archivar: checkbox y `confirmacion` = nombre exacto del cliente. Conserva historia y documentos. */
export interface CuerpoArchivar { tipo: 'archivar'; motivo: string; confirmacion: string; confirmado: boolean }
export interface CuerpoRestaurar { tipo: 'restaurar'; motivo?: string }
export interface CuerpoRenovacion { tipo: 'renovacion'; inicio: Ymd; meses: number; precio: number; referidosEsperados?: string }
export interface CuerpoProyeccion { tipo: 'proyeccion'; estado: 'link_enviado' | 'agendada' | 'hecha'; fecha?: Ymd }

type ContenidoAccion =
  | CuerpoServicio | CuerpoPausa | CuerpoReanudar | CuerpoDatos | CuerpoPago
  | CuerpoArchivar | CuerpoRestaurar | CuerpoRenovacion | CuerpoProyeccion

export type CuerpoAccion = ContenidoAccion & { clave?: string; revisar?: boolean }

// ── Respuestas ──
/** Una celda que la acción escribe (o escribiría, en sombra). `celda` va en palabras: "Estado (fila 23)", "fila nueva · Precio". */
export interface CambioPlan { hoja: string; celda: string; antes: string; despues: string }

export interface Accion {
  id: string                 // 'ac_…' (también va en la nota de la fila de Renovaciones, para poder deshacer)
  idCrm: string
  tipo: TipoAccion
  estado: EstadoAccion
  modo: ModoAcciones
  datos: CuerpoAccion
  plan: CambioPlan[]
  resumen: string            // "Sumar 1 mes: el fin pasa de 2026-11-20 a 2026-12-20"
  quien: string
  creada: string             // ISO
  aplicada: string | null    // ISO, cuando se escribió en el CRM
  anulada: string | null     // ISO, cuando se deshizo
  error: string | null
  esDeshacible?: boolean
  resultado?: ResultadoEscritura | null
  renovacionReferidos?: RenovacionReferidosPublica
}

export interface RenovacionReferidos {
  mesesContratados: number; mesesReferidos: number; mesesTotales: number
  finContrato: Ymd; finServicio: Ymd; usdPendiente: number; huella: string
}
export type RenovacionReferidosPublica = Omit<RenovacionReferidos, 'usdPendiente' | 'huella'> & { canjeId?: string }

/** Respuesta de POST /acciones y de DELETE /acciones/<accionId>. En sombra, mostrar `plan` como "esto se escribiría". */
export interface RespuestaAccion { ok: boolean; accion?: Accion; plan?: CambioPlan[]; mensaje?: string; codigo?: string; pago?: { programa: string; fuente: string; setter: string; tipoVenta: string; tipoPago: string }; beneficioAplicado?: true; renovacionReferidos?: RenovacionReferidos }

/** Pausa vigente según lo registrado en el Despacho (en sombra el CRM puede seguir diciendo ACTIVO). */
export interface PausaVigente { desde: Ymd; dias: number; accionId: string; modo: ModoAcciones }

/** Respuesta de GET /acciones: historial de la tarjeta, de la más nueva a la más vieja. */
export interface RespuestaHistorial { ok: boolean; modo: ModoAcciones; acciones: Accion[]; pausa: PausaVigente | null; archivado?: boolean; mensaje?: string }

export interface CeldaAccion { range: string; antes: string | number | boolean | null; despues: string | number | boolean | null }
export interface ResultadoEscritura { version: 1; celdas: CeldaAccion[]; identidad: { range: string; valor: string }; encabezados?: { range: string; valor: string }[]; pago?: CuerpoPago; pagoPreparado?: unknown; deshaciendo?: boolean; beneficioReferido?: string; finBase?: string; finRango?: string; renovacionReferidos?: RenovacionReferidos; canje?: import('../reservasCanje').ReservaCanje }
