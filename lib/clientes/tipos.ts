// ── Tipos del CRM de clientes y del programa de referidos ─────────────────────────────────
// Fuente: Google Sheet "2026 - CRM - CLIENTES" (SHEET_ID_CLIENTES). Las columnas se resuelven por
// ENCABEZADO (parsear.ts): las posiciones cambiaron varias veces, nunca se fijan por letra.
// Todas las fechas son 'AAAA-MM-DD' (día argentino, ver fechas.ts); null = vacía o ilegible.
import type { Ymd } from './fechas'
import type { PremioIntento, ReglasReferidos } from './reglasReferidos'
import type { ZonaGrabacion } from './zona'

export type { Ymd }

// ── Lectura cruda (lo que guarda el snapshot) ──
export type Celda = string | number | boolean | null
export type Fila = Celda[]
// Cada hoja incluye la FILA 1 (encabezados) en el índice 0; null = la pestaña no existe todavía
export interface HojasCrudas {
  agencia: Fila[]
  consultora: Fila[]
  renovaciones: Fila[]
  referidos: Fila[] | null
  creditos: Fila[] | null
  config: Fila[] | null
}

// ── Clientes ──
export type Linea = 'agencia' | 'consultora'
export type EstadoCliente = 'ACTIVO' | 'FINALIZADO' | 'INACTIVO' | 'PAUSADO' | ''
// Semáforo por vencimiento: verde = fin a más de 14 días · amarillo = vence en 14 días o menos ·
// rojo = vencido sin renovar · gris = sin fecha de fin
export type ColorSemaforo = 'verde' | 'amarillo' | 'rojo' | 'gris'

export interface Cliente {
  id: string                    // 'A012' | 'C003' | '' (fila cargada sin ID: ver sinId)
  linea: Linea
  fila: number                  // fila en la planilla (1 = encabezados), para editar después
  nombre: string
  estado: EstadoCliente
  estudio?: string              // estudio del cliente, independiente del referido
  csm?: string                  // responsable del roster CSM; vacío = sin asignar
  ciudad?: string               // localidad confirmada, no inferida del teléfono
  celular: string
  mail: string
  closer: string
  fuente: string
  contrato: string
  dia1: Ymd | null
  finPeriodo: Ymd | null        // fin del período actual (fórmula de la planilla, depende del ID)
  renovo: string                // texto crudo: 'R1', 'NO', 'NO +1 mes', 'R1 +2 meses'
  ltvContratado: number | null
  ltvCobrado: number | null
  cobrosAviso?: string | null       // cruce directo con Finanzas: null = verificado, texto = no publicar una cifra incierta
  duracionDias: number | null
  promesa: string               // 'Sí' | 'Parcial' | 'No' | ''
  satisfaccion: number | null   // 1-10
  testimonio: string
  gameplan: string
  notasRenov: string
  anotaciones: string
  proximoCobro: Ymd | null
  llamadaAgendada: string | null  // texto libre o fecha 'd/m' ("Agendada (10/9)")
  fechaBaja: Ymd | null
  periodos: Periodo[]           // filas de Renovaciones de este ID (ordenadas por período)

  // ── Derivados (clasificar.ts, a la fecha "hoy" de la lectura) ──
  sinId: boolean                // la trampa conocida: el equipo carga clientes sin ID ni fórmulas
  faltantes: string[]           // datos que deberían estar y no están ('id', 'fin_periodo', 'ltv', 'duracion')
  semaforo: ColorSemaforo | null  // solo ACTIVO tiene semáforo; el resto null
  diasParaVencer: number | null // negativo = ya venció; null = sin fecha de fin
  esNoCliente: boolean          // FINALIZADO/INACTIVO con cobrado < UMBRAL_CLIENTE_USD: fuera de las métricas
  cuentaEnMetricas: boolean     // Agencia + con ID + no es "no cliente"
  renovacionesPagas: number     // períodos > 0 que no son extensión ni precio 0
  extensiones: number           // períodos de extensión de servicio (precio 0)
  precioInicial: number | null  // precio del período 0 en Renovaciones
}

// Una fila de Renovaciones: un período contratado (0 = inicial)
export interface Periodo {
  idCliente: string
  fila: number
  nombre: string
  periodo: number
  dia1: Ymd | null
  fin: Ymd | null
  precio: number | null         // null = vacío (precio pendiente de cargar)
  notas: string
  meses: number | null
  esExtension: boolean          // Notas que empiezan con "Extensión": no es renovación paga
  esRenovacionPaga: boolean     // período > 0, no extensión y precio distinto de 0
}

// ── Programa de referidos ──
export type EstadoReferido = 'Presentado' | 'Asistió' | 'No asistió' | 'Cerró' | 'No cerró' | 'Descartado'
export type MomentoPedido = 'post_kickoff' | 'primer_win' | 'reporte_fin_de_mes' | 'llamada_proyeccion'

// Una fila de la pestaña "Referidos": un referido presentado por un cliente
export interface Referido {
  id: string                    // 'R001'
  fila: number
  fechaPedido: Ymd | null
  momento: MomentoPedido | ''
  idReferidor: string           // ID del cliente que refiere (A0xx)
  nombre: string
  telefono: string
  mail: string
  estudio: string
  estado: EstadoReferido | ''   // '' = vacío o valor no reconocido
  fechaLlamada: Ymd | null
  idClienteNuevo: string        // ID que recibió al cerrar (A1xx)
  fechaPrimerPago: Ymd | null
  fechaLiberacion: Ymd | null   // la que muestra la planilla (fórmula); creditos.ts recalcula la suya
  reembolso: boolean
  notas: string
  cargadoPor: string
}

// Lo que parsear.ts lee de la planilla; clasificar.ts agrega los campos derivados para armar el Cliente
export type CamposDerivados = 'sinId' | 'faltantes' | 'semaforo' | 'diasParaVencer' | 'esNoCliente'
  | 'cuentaEnMetricas' | 'renovacionesPagas' | 'extensiones' | 'precioInicial'
export type ClienteBase = Omit<Cliente, CamposDerivados>

// 'ganado_llamada' = premio ganado por un intento (el nombre se conserva porque es el valor de la lista desplegable de la planilla)
export type TipoMovimiento = 'ganado_cierre' | 'ganado_llamada' | 'canje' | 'vencimiento' | 'ajuste'

// Una fila de la pestaña "Créditos": libro de movimientos de créditos de un cliente
export interface MovimientoCredito {
  id: string
  fila: number
  fecha: Ymd | null
  idCliente: string
  tipo: TipoMovimiento | ''
  idReferido: string
  meses: number                 // + gana, − consume o vence
  extra: string                 // 'identidad de marca completa'…; en un canje, el texto con los USD canjeados ("USD 300")
  vence: Ymd | null
  renovacionAplicada: string    // período/renovación contra la que se canjeó
  nota: string
  cargadoPor: string
}

// Premio de un intento, ya ganado (la fecha es la de la llamada del intento; vence a los vigenciaMeses de ganado)
export interface PremioGanado {
  intento: number                     // N.º de intento acumulado que lo dio
  premio: PremioIntento
  fecha: Ymd                          // cuándo se ganó
  vence: Ymd
  creditoUSD: number                  // solo 'credito_usd'
  meses: number                       // solo 'mes_servicio'
  // vigente = se puede usar · vencido = pasaron los 12 meses · canjeado = ya se consumió en un canje contra una renovación (solo USD y meses;
  // la página web y el branding no se canjean)
  estado: 'vigente' | 'vencido' | 'canjeado'
}

// Un entregable de la escalera de intentos (página web o branding): se gana UNA sola vez por cliente
export interface EntregableGanado { fecha: Ymd; vence: Ymd; vigente: boolean }

// Resultado de creditos.ts → calcularCreditos
export interface ResumenCredito {
  cicloUsdDesde?: Ymd | null          // sólo lo cierra un canje manual completo; el automático conserva los USD
  idCliente: string
  hoy: Ymd
  reglasVersion: string
  cicloDesde: Ymd | null              // fecha del último canje: lo anterior ya se consumió
  // ── Escalera por cierres ──
  nivel: number                       // escalón alcanzado de la escalera por cierres (0 a 3)
  cierresLiberados: number            // vigentes, del ciclo actual
  cierresPendientes: CierrePendiente[]  // cerraron pero todavía no se liberan
  cierresVencidos: number             // liberados cuyo crédito (12 meses) ya venció
  cierresReembolsados: number
  anterioresAlPrograma: number        // presentados antes del inicio del programa: no generan nada
  // ── Escalera por intentos (referido que entra a la llamada y NO cierra: estado "No cerró") ──
  intentos: number                    // cantidad acumulada (sigue de largo: no se reinicia por ciclo)
  premiosIntentos: PremioGanado[]     // todo lo ganado, en orden de intento
  paginaWeb: EntregableGanado | null  // se gana una sola vez (intento 1)
  branding: EntregableGanado | null   // se gana una sola vez (intento 3)
  proximoIntento: { intento: number; premio: PremioIntento; etiqueta: string; creditoUSD: number } | null   // qué da el próximo intento (nunca null: la escalera no tiene tope)
  mesesPorIntentos: number            // el mes del intento 5, si es vigente y del ciclo actual (antes del tope)
  // ── Meses (cierres + mes del intento 5, bajo un único tope) ──
  mesesPorCierres: number             // de la escalera de cierres (el escalón alcanzado reemplaza al anterior)
  mesesSobreTope: number              // meses de cierres + intento 5 que ya no suman porque se llegó al tope
  mesesGanados: number                // con el tope de meses acumulados ya aplicado
  topeMeses: number | null            // el tope de meses; null = sin tope
  ajusteMeses: number                 // movimientos 'ajuste' manuales vigentes del libro
  renovacionGratis: boolean
  mesesExtraSobreRenovacion: number   // meses por encima de la renovación gratis (cierres 4.º en adelante y mes del intento 5)
  topeAlcanzado: boolean
  extras: string[]                    // beneficio extra del nivel de cierres ('identidad_marca_completa')
  // ── Créditos en USD (se canjean solo contra la renovación; aparte de los meses) ──
  usd: {
    ganado: number                    // todo lo ganado por intentos desde el inicio del programa (histórico, sin importar canjes ni vencimientos)
    usado: number                     // canjes en USD leídos del campo Extra del libro (historial completo)
    vencido: number                   // ganado en el ciclo actual y vencido sin canjear
    disponible: number                // del ciclo actual y vigente: lo que se puede canjear hoy
  }
  // Grabación con cámara profesional: extra a ofrecer solo si la zona es Buenos Aires (pista por teléfono; lo confirma el closer)
  zona: ZonaGrabacion
  valorUSD: number                    // mesesGanados valorizados en pago único: solo para reportes
  valorPlanDePagosUSD: number         // ídem, con la renovación gratis en plan de pagos
  proximoNivel: { cierresFaltantes: number; descripcion: string } | null
  // próximos vencimientos de créditos vigentes: cierres liberados, mes del intento 5, USD y entregables (web / branding)
  vencimientos: { fecha: Ymd; cierres: number; mesesIntentos: number; usd: number; entregables: number }[]
  advertencias: string[]
}

export interface CierrePendiente {
  idReferido: string
  motivo: 'esperando_dias' | 'sin_primer_pago'
  fechaLiberacion: Ymd | null         // cuándo se libera (null si todavía no hay primer pago)
  diasParaLiberar: number | null
}

// ── Lectura completa ──
export type FuenteDatos = 'sheets' | 'snapshot' | 'snapshot_viejo'

export interface ColumnasHoja {
  hoja: string
  resueltas: Record<string, string>   // clave → letra de columna ('ltvCobrado' → 'M')
  faltantes: string[]                 // claves sin encabezado reconocible
  duplicadas: string[]                // claves con más de una columna candidata (se usa la primera)
  porPosicion: string[]               // claves cuyo encabezado está VACÍO: se tomaron relativas a otra columna (ver parsear.ts)
}

export interface DatosClientes {
  hoy: Ymd
  clientes: Cliente[]                 // Agencia + Consultora (también las filas sin ID)
  periodos: Periodo[]
  referidos: Referido[]
  movimientos: MovimientoCredito[]
  pestanasAusentes: string[]          // pestañas opcionales que todavía no existen ('Referidos', 'Créditos')
  columnas: ColumnasHoja[]            // diagnóstico: qué encabezado cayó en qué columna
  fuente: FuenteDatos
  snapshotEn: number                  // epoch ms de la lectura real a Sheets
  avisos: string[]
  // Reglas con las que se calculan los créditos. Solo la demo (?demo=1) las pisa; en datos reales falta y rige REGLAS_REFERIDOS.
  reglas?: ReglasReferidos
}
