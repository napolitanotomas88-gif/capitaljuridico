// ── Programa de referidos: TODA la configuración vive en este archivo ─────────────────────
// Fuente: documento "Sistema de referidos — Capital Jurídico", corregido por Tomás el 6/10/2026 y con las reglas nuevas del
// 7/10/2026 (versión 'final-2026-10-07': escalera de INTENTOS, beneficios del referido y grabación por zona). Para cambiar una regla se edita acá y listo: creditos.ts, metas.ts, programa.ts, los
// tests y los textos de la interfaz leen de este objeto. Si se cambia algo de fondo, subir `version` (queda en
// cada ResumenCredito para auditar con qué reglas se calculó) y actualizar docs/REGLAS-REFERIDOS.md.
//
// Lo que NO está confirmado figura en `dudasAbiertas` (una por cada punto ambiguo del documento) y se calcula
// con el valor que dice cada una; lo ya resuelto no se lista como duda.
import type { EstadoReferido, MomentoPedido, Ymd } from './tipos'
import type { ZonaGrabacion } from './zona'

// Beneficio extra de un escalón (alcance, responsable y plazo todavía por definir, ver textoExtra en programa.ts)
export type ClaveExtra = 'identidad_marca_completa'

// Un escalón de la escalera. El escalón alcanzado REEMPLAZA al anterior (no se suman).
export interface PasoEscalera {
  cierres: number                   // cierres liberados que lo activan
  mesesServicio: number             // meses de servicio que equivale ESTE escalón (ya acumulado)
  renovacionGratis: boolean
  extra: ClaveExtra | null
  etiqueta: string                  // texto para la interfaz
}

export type ClaveDuda =
  | 'dias_liberacion' | 'reembolso_posterior' | 'vigencia_desde' | 'otro_estudio' | 'contador_intentos' | 'credito_150_sin_tope'
  | 'cerro_en_llamada' | 'zona_buenos_aires' | 'credito_usd_en_libro' | 'entregables'

// Premios de la escalera por INTENTOS. Un intento = un referido que entra a la llamada y NO cierra (estado "No cerró").
// La página web y el branding se ganan UNA sola vez por cliente; los créditos en USD se canjean solo contra la renovación
// (se llevan en USD aparte de los meses); el mes del intento 5 comparte con la escalera de cierres el tope de meses.
export type PremioIntento = 'pagina_web' | 'credito_usd' | 'branding' | 'mes_servicio'

export interface PasoIntento {
  intento: number                   // N.º de intento acumulado de quien refiere (1, 2, 3…)
  premio: PremioIntento
  creditoUSD: number                // solo con 'credito_usd'
  mesesServicio: number             // solo con 'mes_servicio'
  etiqueta: string                  // texto para la interfaz
}

/** Los premios que se ganan una sola vez por cliente (entregables), no se canjean contra la renovación */
export const PREMIOS_UNICOS: PremioIntento[] = ['pagina_web', 'branding']

// Una duda abierta: la `clave` sirve para los tests y la documentación (no se muestra); `texto` es lo que ve el usuario
export interface DudaAbierta { clave: ClaveDuda; texto: string }

// Meta del KPI principal: desde el mes `desde` ('AAAA-MM') rige este rango de porcentaje, hasta que llegue el siguiente hito
export interface HitoMeta { desde: string; minPct: number; maxPct: number }

// Indicador de apoyo: ESTIMACIONES sin verificar (no son metas firmes). `valor` y `hasta` en la unidad indicada.
export interface IndicadorApoyo {
  clave: 'pedido_hecho' | 'presentan_a_alguien' | 'cierre_de_referidos' | 'costo_por_cierre'
  etiqueta: string
  comparacion: 'cerca_de' | 'entre' | 'al_menos' | 'menos_de'
  valor: number
  hasta?: number                    // solo con comparacion 'entre'
  unidad: 'porcentaje' | 'usd'
  periodo: string                   // "por mes"… (en palabras); vacío si la etiqueta ya lo dice ("Costo por cierre")
  verificado: boolean               // false = estimación todavía sin comprobar con datos
}

export interface ReglasReferidos {
  version: string
  estado: 'borrador' | 'vigente'
  // El programa arranca ese día: los referidos presentados antes NO generan crédito (ver fechaDePresentacion)
  vigenteDesde: Ymd
  // Cuándo y cuánto se pide. El máximo de nombres por pedido es un SUPUESTO del documento (no figura como duda).
  pedido: { momentos: MomentoPedido[]; maxNombresPorPedido: number }
  // Beneficios del REFERIDO (el lead que viene recomendado): al cerrar recibe automáticamente 1 mes extra.
  // El descuento sigue sujeto al cierre en la llamada y a la confirmación del closer (soloEnLlamada).
  referido: { descuentoUSD: number; soloEnLlamada: boolean; mesesServicioExtra: number }
  // Escalera por CIERRES liberados (ordenada por cantidad de cierres)
  escalera: PasoEscalera[]
  // Del último escalón en adelante: +N meses por cada cierre extra
  masAllaDeLaEscalera: { mesesPorCierreExtra: number }
  // Tope de meses acumulados EN TOTAL: los meses de la escalera de cierres (la renovación gratis incluida) y el mes del intento 5, juntos
  topeMesesAcumulados: number | null   // null = SIN TOPE (decisión del 8/10/2026); un número vuelve a limitar el total de meses
  // Escalera por INTENTOS (un referido que entra a la llamada y no cierra). Se mide con la cantidad acumulada de intentos de quien refiere.
  // El contador sigue de largo toda la vida del cliente (duda contador_intentos) y la web y el branding se dan una sola vez.
  intentos: {
    estado: EstadoReferido          // el estado que cuenta como intento: "No cerró" (entró a la llamada y no cerró; un cierre NO es un intento)
    escalera: PasoIntento[]         // intentos 1 a 5
    // Del intento siguiente al último escalón en adelante: crédito en USD por cada intento adicional, SIN tope.
    // TENTATIVO ("podríamos ver"): duda credito_150_sin_tope.
    masAllaDeLaEscalera: { creditoUSD: number; sinTope: boolean; tentativo: boolean }
  }
  // Grabación con cámara profesional en las oficinas de Buenos Aires: EXTRA para quien refiere solo si está en la zona de Buenos Aires.
  // La zona se deduce del teléfono (zona.ts) y es solo una pista: el closer lo ofrece en la llamada de los referidos y confirma.
  grabacion: { camaraProfesional: boolean; lugar: string; zona: ZonaGrabacion; ofreceElCloser: boolean }
  // El crédito de un cierre se libera cuando entra el primer pago del referido y pasaron N días sin reembolso (DUDA ABIERTA: dias_liberacion)
  liberacion: { diasSinReembolso: number }
  vigenciaMeses: number             // 12, confirmada
  vigenciaDesde: 'liberacion'       // DUDA ABIERTA (vigencia_desde): la alternativa es desde el primer pago
  // Solo se canjea contra la renovación de quien refiere, nunca en efectivo, y vence si no renueva dentro de la vigencia.
  // Al confirmar una nueva renovación en el Despacho se aplican los meses liberados y vigentes; los USD requieren canje manual.
  canje: { soloContraRenovacion: boolean; enEfectivo: boolean; venceSiNoRenueva: boolean }
  // Estados del referido que cuentan como "asistió a la llamada" (haya cerrado o no)
  estadosAsistio: EstadoReferido[]
  // Un referido válido: lead nuevo, de otro estudio, que asiste a la llamada
  referidoValido: { leadNuevo: boolean; otroEstudio: boolean; debeAsistir: boolean }
  // Valores de referencia SOLO para reportes: el crédito se lleva en meses.
  valorMesUSD: number               // 1 mes = USD 650
  // La renovación gratis (los meses del escalón con renovacionGratis) se valoriza distinto según cómo se pague
  renovacionGratis: { valorPagoUnicoUSD: number; valorPlanDePagosUSD: number }
  // Metas: el KPI principal es el % de clientes nuevos del mes que entran por referido
  metas: { kpiPrincipal: { etiqueta: string; hitos: HitoMeta[] }; apoyo: IndicadorApoyo[] }
  dudasAbiertas: DudaAbierta[]
}

export const REGLAS_REFERIDOS: ReglasReferidos = {
  version: 'final-2026-10-08',
  estado: 'vigente',
  vigenteDesde: '2026-10-01',

  pedido: {
    momentos: ['post_kickoff', 'primer_win', 'reporte_fin_de_mes', 'llamada_proyeccion'],
    maxNombresPorPedido: 3,
  },

  referido: { descuentoUSD: 300, soloEnLlamada: true, mesesServicioExtra: 1 },

  escalera: [
    { cierres: 1, mesesServicio: 1, renovacionGratis: false, extra: null, etiqueta: '1 mes de servicio' },
    { cierres: 2, mesesServicio: 2, renovacionGratis: false, extra: 'identidad_marca_completa', etiqueta: '2 meses de servicio + identidad de marca completa' },
    { cierres: 3, mesesServicio: 4, renovacionGratis: true, extra: null, etiqueta: 'Renovación gratis (4 meses)' },
  ],
  masAllaDeLaEscalera: { mesesPorCierreExtra: 1 },
  topeMesesAcumulados: null,   // 8/10/2026: Tomás quitó el tope de 8 meses; los meses de cierres (del 4.º en adelante +1) y el del intento 5 se suman sin límite

  intentos: {
    estado: 'No cerró',
    escalera: [
      { intento: 1, premio: 'pagina_web', creditoUSD: 0, mesesServicio: 0, etiqueta: 'Página web completa con los servicios específicos del abogado (le queda para siempre; se entrega el proyecto y se le enseña a editarla)' },
      { intento: 2, premio: 'credito_usd', creditoUSD: 300, mesesServicio: 0, etiqueta: 'Crédito de USD 300 (se canjea solo contra la renovación)' },
      { intento: 3, premio: 'branding', creditoUSD: 0, mesesServicio: 0, etiqueta: 'Branding completo: historias, foto de perfil, logo, colorimetría, usos y banner, más 1 carrusel explicativo de lo que hace el estudio' },
      { intento: 4, premio: 'credito_usd', creditoUSD: 300, mesesServicio: 0, etiqueta: 'Otros USD 300 de crédito (se canjea solo contra la renovación)' },
      { intento: 5, premio: 'mes_servicio', creditoUSD: 0, mesesServicio: 1, etiqueta: '+1 mes de servicio' },
    ],
    masAllaDeLaEscalera: { creditoUSD: 150, sinTope: true, tentativo: true },
  },

  grabacion: { camaraProfesional: true, lugar: 'oficinas de Buenos Aires', zona: 'buenos_aires', ofreceElCloser: true },

  liberacion: { diasSinReembolso: 14 },
  vigenciaMeses: 12,
  vigenciaDesde: 'liberacion',

  canje: { soloContraRenovacion: true, enEfectivo: false, venceSiNoRenueva: true },

  estadosAsistio: ['Asistió', 'Cerró', 'No cerró'],
  referidoValido: { leadNuevo: true, otroEstudio: true, debeAsistir: true },

  valorMesUSD: 650,
  renovacionGratis: { valorPagoUnicoUSD: 2600, valorPlanDePagosUSD: 3800 },

  metas: {
    kpiPrincipal: {
      etiqueta: 'Clientes nuevos del mes que entran por referido',
      hitos: [
        { desde: '2026-10', minPct: 5, maxPct: 5 },
        { desde: '2026-12', minPct: 10, maxPct: 10 },
        { desde: '2027-03', minPct: 15, maxPct: 20 },
      ],
    },
    apoyo: [
      { clave: 'pedido_hecho', etiqueta: 'Clientes activos a los que se les hizo el pedido', comparacion: 'cerca_de', valor: 60, unidad: 'porcentaje', periodo: 'por mes', verificado: false },
      { clave: 'presentan_a_alguien', etiqueta: 'Clientes activos que presentan a alguien', comparacion: 'entre', valor: 8, hasta: 10, unidad: 'porcentaje', periodo: 'por mes', verificado: false },
      { clave: 'cierre_de_referidos', etiqueta: 'Cierre de los referidos', comparacion: 'al_menos', valor: 30, unidad: 'porcentaje', periodo: '', verificado: false },
      { clave: 'costo_por_cierre', etiqueta: 'Costo por cierre', comparacion: 'menos_de', valor: 446, unidad: 'usd', periodo: '', verificado: false },
    ],
  },

  // Una por cada punto AMBIGUO (y solo esos), en lenguaje claro: se muestran tal cual en /clientes/referidos y en la ficha. Lo resuelto (tope de 8
  // meses en total, extra del nivel 2, el mes vale USD 650, descuento del referido de USD 300 solo si se suma en la llamada) no va acá.
  dudasAbiertas: [
    {
      clave: 'dias_liberacion',
      texto: 'Días de espera para liberar un crédito: se mantienen 14 días desde que entra el primer pago, sin reembolso, pero una sección del documento perdió el número y hay que confirmarlo.',
    },
    {
      clave: 'reembolso_posterior',
      texto: 'Reembolso después de liberado el crédito: la planilla no tiene fecha de reembolso. Hoy el cierre marcado como reembolsado no suma, pero si el crédito ya se canjeó contra una renovación no se revierte, y se corrige a mano con un ajuste. Falta definir qué corresponde en ese caso.',
    },
    {
      clave: 'vigencia_desde',
      texto: 'Vigencia de 12 meses (confirmada): falta definir desde cuándo corre. Hoy se cuenta desde que el crédito se libera (o desde la llamada del intento, en los premios por intentos); la alternativa es desde el primer pago.',
    },
    {
      clave: 'otro_estudio',
      texto: 'Referido de otro estudio: todavía no hay dato para validarlo, porque la planilla no tiene el estudio de quien refiere para compararlo. Mientras tanto es un control manual: el referido del mismo estudio se marca como Descartado.',
    },
    {
      clave: 'contador_intentos',
      texto: 'Contador de intentos: falta definir si vuelve a cero en cada ciclo del cliente. Hoy sigue de largo, sin reiniciarse, y cuenta todos los intentos desde el inicio del programa; los premios únicos (la página web y el branding) se dan una sola vez por cliente.',
    },
    {
      clave: 'credito_150_sin_tope',
      texto: 'Crédito por intento desde el sexto: los USD 150 por cada intento adicional, sin tope, son tentativos (se dijo que "podríamos ver"). Hoy se calculan y se suman al saldo en USD, sin límite.',
    },
    {
      clave: 'cerro_en_llamada',
      texto: 'El cliente nuevo que viene por referido recibe automáticamente 1 mes más de servicio al cerrar. Los USD 300 de descuento siguen sujetos al cierre en la llamada y a la confirmación del closer: la planilla de Referidos no tiene un dato para verificar esa condición.',
    },
    {
      clave: 'zona_buenos_aires',
      texto: 'Zona de Buenos Aires para la grabación en las oficinas: se deduce del teléfono del cliente que refiere (celular con código de área 11), pero es solo una pista. Si el número no sirve para deducirlo queda "sin determinar" (no es un no), y el closer lo ofrece en la llamada y lo confirma.',
    },
    {
      clave: 'credito_usd_en_libro',
      texto: 'Créditos en USD y el libro de Créditos: el libro no tiene una columna de USD, así que los canjes en USD se leen del texto del campo Extra (por ejemplo "USD 300"). Se recomienda sumar una columna "Crédito USD (+/-)"; mientras tanto, un canje sin ese texto no descuenta USD.',
    },
    {
      clave: 'entregables',
      texto: 'Página web y branding: falta definir el alcance fino de cada entregable, quién lo hace y en qué plazo. Hoy se muestra solo que se ganó y hasta cuándo vale, sin seguimiento de la entrega.',
    },
  ],
}
