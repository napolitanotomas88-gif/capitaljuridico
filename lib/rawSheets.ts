import { google } from 'googleapis'

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Faltan credenciales de Google')
  return new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
}

// Los montos se leen con UNFORMATTED_VALUE → los números reales llegan como number.
// Solo las celdas cargadas como TEXTO llegan como string (raro); ahí sí parseamos.
// Un texto suelto casi siempre usa punto decimal estándar ("1417.42"), salvo que
// tenga coma decimal latina al final ("625,00" | "1.212,93").
function amountFromCell(cell: unknown): number {
  if (typeof cell === 'number') return cell
  if (typeof cell !== 'string') return 0
  const cleaned = cell.replace(/[$\s]/g, '').trim()
  if (!cleaned) return 0
  // Latino con coma decimal al final
  if (/,\d{1,2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0
  }
  // Latino entero con puntos de miles sin decimales ("1.325" = 1325, "12.500" = 12500)
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '')) || 0
  }
  // Estándar: punto = decimal, coma = miles
  return parseFloat(cleaned.replace(/,/g, '')) || 0
}

// "Ahora" en hora argentina: el server de Vercel corre en UTC pero las fechas de los
// sheets son naive de Argentina — sin esto, una llamada de las 18:00 figura "ocurrida"
// desde las 15:00 ARG e infla el denominador del show-up intradía.
function nowArgentina(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
}

// Google Sheets serial date → Date local a medianoche (epoch 1899-12-30)
// Serial de Sheets → Date local a medianoche. La parte decimal es la HORA:
// truncar (no redondear) o todo lo posterior al mediodía cae al día siguiente
// — bug real: los leads del 31/07 a la tarde se contaban como agosto.
// El épsilon protege del error de float en seriales enteros (46234.9999999).
function serialToDate(serial: number): Date {
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial + 1e-6) * 86400000)
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate())
}

// Date local → 'YYYY-MM-DD' (nunca toISOString: correría el día por la zona horaria)
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Fecha del Registro de Pagos (col A). Con UNFORMATTED_VALUE es un serial numérico;
// como fallback acepta texto "M/D/YYYY".
function parsePaymentDate(cell: unknown): Date | null {
  if (typeof cell === 'number') return serialToDate(cell)
  if (typeof cell !== 'string' || !cell) return null
  const parts = cell.split('/')
  if (parts.length < 3) return null
  const m = parseInt(parts[0]), d = parseInt(parts[1]), y = parseInt(parts[2])
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null
  return new Date(y, m - 1, d)
}

// Parse "DD/MM/YYYY HH:MM:SS" (hojas de closers, col D)
// Devuelve la fecha a medianoche (para agrupar/filtrar por día) y el
// datetime completo (para saber si la llamada ya ocurrió).
function parseCallDate(raw: string | undefined): { date: Date; dateTime: Date } | null {
  if (!raw) return null
  const [datePart, timePart] = raw.toString().split(' ')
  const parts = datePart.split('/')
  if (parts.length < 3) return null
  const d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2].substring(0, 4))
  if (isNaN(d) || isNaN(m) || isNaN(y) || m < 1 || m > 12) return null
  const [hh = 0, mi = 0] = (timePart ?? '').split(':').map(n => parseInt(n) || 0)
  return { date: new Date(y, m - 1, d), dateTime: new Date(y, m - 1, d, hh, mi) }
}

// ── Umbral de cliente real (regla del usuario, 29/9/2026) ──
// "Hay gente que pagó fee y nunca más avanzó, te das cuenta porque son pagos inferiores a 300-400 USD.
// Eso ni los cuentes como clientes." Quien cobró menos que esto y no está ACTIVO/PAUSADO en el CRM queda
// FUERA de todas las métricas de clientes (stock-flujo, churn, renovación, LTV, cierres, CAC…). La plata
// de esos pagos SÍ sigue contando en cash / FECCU / FECCP / BECC (es plata real).
export const UMBRAL_CLIENTE_USD = 400

export type Canal = 'vsl' | 'ig' | 'uruguay' | 'retargeting' | 'referido' | 'wsp' | 'webinar'

// Clasifica el canal de origen de una fila de closer (definición del usuario,
// consistente con la atribución de cash FECCU por embudo):
//   Uruguay      = campaña Uruguay (va primero: el nombre también dice vsl)
//   Retargeting  = embudo PROPIO, separado del VSL: col H (campaña) o col I (anuncio) contiene
//                  'retarget' o empieza con 'rtg' (campaña "RETARGETING VSL FUNNEL - 13/8/26",
//                  "RETARGETING" genérica de mayo, anuncios "RTG | …")
//   Instagram    = Inbound IG (SETTING) + link en bio (col I = "bio" o "link_in_bio")
//   VSL          = paid + SIN fuente + sin clasificar (bug de tracking)
//   Referido / Enrutamiento(WSP) / Webinar = embudos propios, separados
// Columnas: G[6]=Fuente, H[7]=Campaña, I[8]=Video
// Texto de campaña/anuncio de retargeting: contiene 'retarget' o empieza con 'rtg' (los valores vienen URL-encoded con '+')
const esRetargetingTxt = (s: string) => s.includes('retarget') || s.startsWith('rtg')
function classifyCanal(row: string[]): Canal {
  const g = (row[6] ?? '').toString().toLowerCase().trim()
  const h = (row[7] ?? '').toString().toLowerCase().trim()
  const iv = (row[8] ?? '').toString().toLowerCase().trim()
  const blob = `${g}|${h}|${iv}`
  if (blob.includes('uruguay')) return 'uruguay'   // campaña Uruguay (antes que VSL: el nombre también dice vsl)
  if (esRetargetingTxt(h) || esRetargetingTxt(iv)) return 'retargeting'   // embudo propio (antes que VSL: la campaña dice "vsl funnel")
  // col I = 'bio' o 'link_in_bio' (palabra suelta: el nombre de un video puede decir "…al camBIO")
  if (blob.includes('inbound') || /(^|[^a-z])bio([^a-z]|$)/.test(iv)) return 'ig'
  if (g === 'refe' || blob.includes('referido')) return 'referido'
  if (g === 'enrutamiento' || h === 'wsp') return 'wsp'
  if (blob.includes('webi')) return 'webinar'
  return 'vsl'   // paid_social/paid + vacíos + sin clasificar
}

export type CategoriaPago = 'FECCU' | 'FECCP' | 'BECCU' | 'BECCP' | ''

export interface Transaction {
  date: Date
  dateStr: string    // 'YYYY-MM-DD' (día local)
  amount: number
  closer: string
  category: CategoriaPago   // derivada de N (tipo de venta) + O (tipo de pago) + J (concepto); ver categoriaPago()
  tipoVenta: string  // col N crudo: "Front-end" | "Back-end"
  tipoPago: string   // col O crudo: "Upfront" | "Payment Plan" (vacía en ene–feb)
  concepto: string   // col J crudo: PIF, Fee, 1ra Cuota, 2da Cuota…
  source: string     // col K = Fuente
  month: string      // "2026-mayo" (col M)
  product: string
  client: string
  phone: string      // col D = Número (a veces el Registro solo tiene el teléfono)
  // Embudo atribuido del pago (lo usa LeadSourceChart). FECCU: por la fila de closer del cliente
  // (cerrada, si no la ocurrida más reciente) + prioridad Uruguay; sin fila de closer, por la fuente col K.
  // Resto de categorías: Uruguay + fuente col K.
  embudo?: Embudo
  // true = el pagador NO es cliente real: total pagado en el Registro < UMBRAL_CLIENTE_USD y no matchea un
  // cliente ACTIVO/PAUSADO del CRM (pagó solo el fee). El monto sigue sumando en cash/FECCU, pero el
  // pago no cuenta como cierre/cliente (LeadSourceChart: count) ni entra en el LTV del backend.
  noCliente?: boolean
}

export type Embudo = 'vsl' | 'ig' | 'uruguay' | 'retargeting' | 'referido' | 'webinar' | 'otro'

// Número de cuota del Concepto (col J): "2da Cuota" → 2, "3ra cuota" → 3, "Segunda cuota" → 2.
// 0 = no es una cuota (PIF, Fee, vacío…).
function numeroCuota(concepto: string): number {
  const c = concepto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!c.includes('cuota')) return 0
  const m = c.match(/(\d+)\s*(?:ra|da|ta|ma|va|na|er|do|o|a|°|º)?\.?\s*cuota/)
  if (m) return parseInt(m[1]) || 0
  const palabras: Record<string, number> = { primer: 1, segunda: 2, tercer: 3, cuarta: 4, quinta: 5, sexta: 6 }
  for (const [p, n] of Object.entries(palabras)) if (c.includes(p)) return n
  return 0
}

// Categoría del pago (el Registro cambió de estructura en sept-2026: la col P quedó vacía).
//   N "Tipos de venta" = Front-end | Back-end   ·   O "Tipo de pago" = Upfront | Payment Plan
//   Front-end + Upfront = FECCU · Front-end + Payment Plan = FECCP · Back-end + Upfront = BECCU · Back-end + Payment Plan = BECCP
// Si O está vacía (ene/feb): es plan de pagos solo si el Concepto es la cuota 2 o posterior.
// Si N está vacía se usa el valor legado de la col P (FECCU/FECCP/BECC/BECCU/BECCP).
export function categoriaPago(tipoVenta: string, tipoPago: string, concepto: string, legado = ''): CategoriaPago {
  const n = tipoVenta.toLowerCase().trim(), o = tipoPago.toLowerCase().trim()
  const front = n.startsWith('front'), back = n.startsWith('back')
  const esCuotaPosterior = numeroCuota(concepto) >= 2
  if (front || back) {
    const plan = o.includes('plan') ? true : o.startsWith('upfront') ? false : esCuotaPosterior
    return front ? (plan ? 'FECCP' : 'FECCU') : (plan ? 'BECCP' : 'BECCU')
  }
  const p = legado.toUpperCase().trim()
  if (p === 'FECCU' || p === 'FECCP' || p === 'BECCU' || p === 'BECCP') return p
  if (p === 'BECC') return esCuotaPosterior ? 'BECCP' : 'BECCU'
  return ''
}

// Llamada individual (una fila de las hojas de closers) para poder filtrar por rango de fechas
export interface Call {
  date: Date
  closer: string       // persona dueña de la hoja: Juan | Fer | Ariel | Gero
  occurred: boolean    // la llamada ya ocurrió (fecha+hora <= ahora) — denominador de show up
  qualified: boolean   // Lead Scoring ∈ {A, B, C}
  presented: boolean   // ¿Se presentó Agenda/Call 1? = "Si" O ¿Se presentó REAGENDA CALL 1? = "Si"
  closed: boolean      // Situación = "Cerrado en llamada/seguimiento"
  channel: Canal
  letra: 'A' | 'B' | 'C' | 'D' | 'E' | null   // Lead Scoring de la col Q del CRM de ventas
  cash: number                          // FECCU del cliente (matcheado por nombre, dedup)
  noShow: boolean                       // ocurrida, no presentada y col R = No o S1..S4 (faltó, seguimiento N)
  cashTC: number                        // "Cash Collected Trato Cerrado" de la hoja del closer
  setter: string                        // col K "Setter": mai (Maite) | ig | fb | otro/vacío
  lead: string                          // col A "Nombre del lead" (para cruzar con Calendly)
  telefono: string                      // col B "Número de Contacto" (para el seguimiento de no-shows)
  hora: string                          // "HH:MM" de la call (col D)
  sinRegistro: boolean                  // ocurrió y "¿Se presentó?" quedó vacío (ni en col R ni en la reagenda)
  precall: 'efectiva' | 'no efectiva' | ''   // col AI "Llamada pre-call" (la marca el pre-caller; existe desde el 21/10/2026)
  // true = figuraba cerrada pero el cliente pagó solo el fee (< UMBRAL_CLIENTE_USD en total, TC < umbral y
  // no está ACTIVO/PAUSADO en el CRM) → closed = false (queda como presentada). Ausente si no aplica.
  soloFee?: boolean
}

// Enrutamiento del DÍA ANTERIOR (reporte de Discord de la mañana): entrada IG → setter →
// agendas → llamadas, y los leads que se cayeron identificados por usuario de IG.
export interface LeadIGRow { nombre: string; usuario: string; id: string }
export interface Enrutamiento {
  dia: string                                            // "YYYY-MM-DD" del día reportado (ayer, hora AR)
  leadsIG: { dia: number; previo: number; mes: number }  // filas vivas de "Leads IG" por fecha (col A); previo = antier
  asignados: { dia: number; previo: number; mes: number }  // filas vivas de "Setter IG" por fecha (col A o C)
  // Leads del día SIN fila en Setter IG (cruce por "ID contacto" de ManyChat, cols F/G).
  // Los que entraron antes de que las reglas escribieran el ID no se pueden identificar → solo cuentan.
  noAsignados: { total: number; identificados: LeadIGRow[] }
  agendasSetterDia: number                               // llamadas del día agendadas por Maite (col K = mai)
  agendasSetterMes: number
  tasaAgendaSetterMes: number | null
  agendasMes: number
  llamadas: {                                            // llamadas cuya fecha de call es el día reportado
    total: number
    porCloser: Record<string, { agendadas: number; presentadas: number; noShow: number; cierres: number; pendientes: number; sinRegistro: number }>
    porSetter: Record<string, number>                    // setter | ig | fb | otro
    lista: { lead: string; telefono: string; closer: string; hora: string; setter: string; estado: 'cerrada' | 'presentada' | 'no-show' | 'sin registro' | 'pendiente' }[]
  }
}

// Lead Scoring = la letra que calcula la fórmula del propio CRM de ventas (col Q "Lead Scoring",
// ARRAYFORMULA sobre urgencia col M + facturación col L). Desde oct-2026 la fórmula da 5 letras (A–E):
// se lee tal cual para que el dashboard siempre coincida con lo que ven los closers.
type LetraLead = 'A' | 'B' | 'C' | 'D' | 'E'
function letraLead(scoring: unknown): LetraLead | null {
  const l = (scoring ?? '').toString().trim().toUpperCase()
  return /^[A-E]$/.test(l) ? (l as LetraLead) : null
}

export interface RawData {
  transactions: Transaction[]
  calls: Call[]
  closerNames: string[]
  monthlyLabels: string[]         // Ene, Feb, Mar...
  monthlyCash: number[]           // Cash Collected por mes (Estado de Resultados)
  // Métricas de ventas — agregadas desde las hojas de closers (Closer 1 a 5 + Gero-Xavi)
  monthlyAgendadas: number[]      // Llamadas agendadas por mes (filas con fecha)
  monthlyCerradas: number[]       // Unidades cerradas (Situación = "Cerrado en llamada/seguimiento"), SIN los "solo fee"
  monthlyCierresSoloFee: number[] // cierres descartados por mes: el cliente pagó solo el fee (< UMBRAL_CLIENTE_USD)
  monthlyPresentadas: number[]    // Se presentó Agenda/Call 1 = "Si" o se presentó a la REAGENDA
  monthlySinRegistro: number[]    // agendas ya ocurridas sin nada cargado en "¿Se presentó?" (ni reagenda)
  monthlyCalificadas: number[]    // Lead Scoring ∈ {A, B, C}
  // Agendas por canal de origen (misma fuente: hojas de closers)
  monthlyVSL: number[]            // paid_social / paid (SIN retargeting: es otro embudo)
  monthlyRetargeting: number[]    // agendas del embudo Retargeting (col H/I 'retarget' o 'rtg…')
  monthlyIG: number[]             // Bio IG
  monthlyOtrasFuentes: number[]   // uruguay, referidos, enrutamiento/wsp, webinar (NO incluye retargeting)
  // NFCF automático — calculado desde Estado de Resultados + Registro + closers
  monthlyFECCU: number[]          // FECCU por mes (Registro de Pagos, por fecha)
  monthlyFECCP: number[]          // FECCP por mes (mismo criterio: fecha de pago)
  monthlyBECC: number[]           // BECCU + BECCP por mes (fecha de pago)
  monthlyCashOut: (number | null)[]   // Gastos Totales (ER); null si el mes no tiene gastos cargados (parcial si monthlyGastosCompletos = false)
  // false = el mes tiene cash pero al ER le faltan gastos: staff (Ventas+Producto+Operaciones) = 0,
  // o la fila de Anuncios del ER = 0 con gasto en Meta > 0. En esos meses NFCF/Margen/CAC blended/FECCU:CAC blended = null
  monthlyGastosCompletos: boolean[]
  monthlyNFCF: (number | null)[]      // Beneficios Netos (ER); null si faltan gastos
  monthlyMargen: (number | null)[]    // % Beneficios Netos (ER), en %; null si faltan gastos
  monthlyCAC: (number | null)[]       // (Ads + Ventas + Marketing) / clientes nuevos (blended); null si faltan gastos
  monthlyCACAds: (number | null)[]    // Solo anuncios / clientes nuevos
  monthlyFeccuCac: (number | null)[]  // FECCU / ads; null si ads del mes < $300 (muestra chica)
  monthlyAds: number[]                // Total anuncios del mes (pestaña Gastos) — para costo por lead
  monthlyVentasArea: number[]         // Gasto área Ventas del ER (comisiones)
  monthlyMktArea: number[]            // Gasto área Marketing del ER (sin anuncios)
  monthlyGastoAdq: number[]           // Ads + Ventas + Marketing = gasto de adquisición
  clickup: ClickUpSemaforo            // semáforo de salud de clientes (lista Clientes 2026)
  backend: {                          // Métricas de backend (LTV/LTGP/churn), históricas
    ltv: number | null                // Σ pagos ÷ clientes únicos (todas las categorías), sin los "solo fee"
    clientes: number                  // clientes únicos identificados (nombre/teléfono), sin los "solo fee" (< UMBRAL_CLIENTE_USD y no vigentes)
    margenBruto: number | null        // 1 − (Producto+Operaciones)/Cash, solo meses con Producto+Operaciones > 0
    ltgp: number | null               // LTV cobrado del CRM (crm.ltvCobrado; fallback ltv) × margen bruto
    cacPromedio: number | null        // gasto adquisición ÷ cierres, acumulado del año (solo meses con cierres)
    ltgpCac: number | null            // LTGP ÷ CAC promedio (meta ≥3x, ideal 5x)
    churn: (number | null)[]          // churn mensual aproximado por pagos (%)
    crm: {                            // CRM Clientes 2.0 (null/0 si no está conectado)
      disponible: boolean
      activos: number                 // estado ACTIVO hoy
      pausados: number                // estado PAUSADO hoy
      bajasSinFecha: number           // FINALIZADO/INACTIVO sin "Fecha de baja" y con fin futuro (baja imputada a hoy)
      semVerde: number                // activos al día (fin a +14 días)
      semAmarillo: number             // activos por vencer (≤14 días) → llamada de proyección
      semRojo: number                 // activos con el período vencido sin renovar
      semSinFecha: number             // activos sin fecha de fin cargada
      churnBajas: number[]            // por mes: salidas (= mensual.bajas, modelo stock-flujo)
      churnActivosInicio: number[]    // por mes: activos al empezar el día 1 (= mensual.activosInicio)
      churnRenov: number[]            // por mes: renovaciones arrancadas
      tasaRenovacion: number | null   // renovadores / (renovadores + no renovaron y terminaron)
      tasaExito: number | null        // % promesa alcanzada (de los cargados)
      satisfaccion: number | null     // promedio 1-10 (col "Satisfacción" de Agencia por encabezado; null si no existe)
      ltvContratado: number | null    // LTV promedio contratado según CRM (col L)
      ltvCobrado: number | null       // ⭐ LTV promedio COBRADO según CRM (col M, métrica real)
      // "No clientes": FINALIZADO/INACTIVO con LTV cobrado (col M; si vacía, el Registro) < UMBRAL_CLIENTE_USD.
      // Pagaron solo el fee y no avanzaron: quedan FUERA de todas las métricas de clientes del CRM.
      noClientes: number
      noClientesNombres: string[]
    }
    mensual: BackendMensual           // backend mes a mes (para que el selector de mes lo mueva)
  }
  // FECCU:CAC por embudo (pedido del mentor): FECCU de la fuente ÷ ads de ese embudo
  monthlyAdsVSL: number[]             // campañas VSL (Meta), SIN retargeting
  monthlyAdsRetargeting: number[]     // campañas con 'retarget' en el nombre (embudo propio; incluye la genérica de mayo)
  monthlyAdsFM: number[]              // Gastos tipo "Anuncios FM"
  monthlyAdsWebinar: number[]         // gasto de campañas con 'webinar' en el nombre (Meta; fallback Gastos "Anuncios Webinar")
  monthlyAdsUruguay: number[]         // gasto de campañas VSL Uruguay (Meta)
  monthlyFeccuVSL: number[]           // FECCU con Fuente = VSL Funnel (sin los clientes atribuidos a retargeting)
  monthlyFeccuRetargeting: number[]   // FECCU de clientes cuya fila de closer (cerrada / ocurrida más reciente) es canal retargeting
  monthlyFeccuFM: number[]            // FECCU con Fuente = Inbound IG + BIO Página Web (orgánico+FM)
  // Los FECCU:CAC por embudo y el blended son null cuando el gasto de ese bucket en el mes < $300
  monthlyFeccuCacVSL: (number | null)[]  // feccuVSL / adsVSL (sin retargeting)
  monthlyFeccuCacRetargeting: (number | null)[]  // feccuRetargeting / adsRetargeting
  monthlyFeccuCacFM: (number | null)[]   // feccuFM / adsFM
  monthlyFeccuCacWebinar: (number | null)[]  // feccuWebinar / adsWebinar
  monthlyFeccuCacUruguay: (number | null)[]  // feccuUruguay (fuente o cliente matcheado) / adsUruguay
  monthlyFeccuCacBlended: (number | null)[]  // FECCU / (ads + Ventas + Marketing)
  // Leads crudos
  monthlyLeadsVSL: (number | null)[]  // Visitantes del sitio (GA4); null = sin datos ese mes
  monthlyAgendasWeb: (number | null)[]  // Agendas desde la landing (GA4 /graciasporagendar, funnel de Framer)
  monthlyClicksAgendar: (number | null)[]  // Clicks en "Agendar" (GA4 click_agendar; null hasta instalar el snippet)
  monthlyLeadsIG: number[]            // Leads de IG (pestaña "Leads IG", alimentada por ManyChat)
  // Setter (Maite): asignados por ManyChat (etiqueta ASIGNADO → pestaña "Setter IG") y agendas
  // propias (col K "Setter" = mai en las hojas de closers). % agenda del setter = agendas ÷ asignados
  monthlyAsignadosSetter: number[]
  monthlyAgendasSetter: number[]
  monthlyTasaAgendaSetter: (number | null)[]
  enrutamiento: Enrutamiento
  // Seguidores nuevos de IG (pestaña "Seguidores IG", ManyChat "Nuevo Seguidor")
  monthlySeguidoresIG: number[]
  monthlyCPS: (number | null)[]       // Ads FM ÷ seguidores nuevos (referencia histórica)
  // CPL Instagram = costo por seguidor estimado: gasto FM ÷ (visitas al perfil Meta × tasa seguimiento)
  monthlyCPLMetaFM: (number | null)[]
  // CPL Instagram que muestra el tablero: el REAL (= monthlyCPS, gasto FM ÷ seguimientos cargados)
  // si ese mes tiene seguimientos; si no, el estimado automático (= monthlyCPLMetaFM)
  monthlyCPLInstagram: (number | null)[]
  monthlyCPLInstagramEstimado: boolean[]   // true cuando el valor del mes es el estimado
  igTasaSeguimiento: number           // tasa visita→seguidor usada: calibrada con el último mes con seguidores reales (fallback env IG_TASA_SEGUIMIENTO)
  igTasaFuente: string                // de dónde salió la tasa, ej. "calibrada con agosto (0.86%)"
  // Tracker de grabaciones (sheet "Guiones y Videos", pestaña "Guiones para realizar"), por cliente
  grabaciones: GrabacionCliente[]
  // Fotos diarias del semáforo operativo (pestaña "Historial operativo" del sheet de Ventas,
  // la escribe el cron de /api/resumen-diario). Orden por fecha ascendente; [] si la pestaña no existe.
  historialOperativo: FotoOperativa[]
  recordatorios: { fecha: string; texto: string }[]   // pestaña Recordatorios del CRM, pendientes (col C ≠ SI)
  clientesNombres: string[]        // nombres de TODOS los clientes del CRM (para detectar quién ya es cliente)
  clientesCRM: { nombre: string; estado: string; dia1: string | null }[]   // CRM Agencia: estado y Día 1 'YYYY-MM-DD' (kick-off vs proyección)
  alertas: Alertas                    // sistema de alertas operativas (panel superior)
}

// ── Backend mes a mes (CRM Agencia + Registro de Pagos) ──
export interface BackendMensual {
  // Modelo stock-flujo (SOLO Agencia): entrada = Día 1 (o inicio del período 0); salida = "Fecha de baja" (col V)
  // o, si FINALIZADO/INACTIVO sin fecha de baja, el fin (col J) si ya pasó o HOY. ACTIVO/PAUSADO no salen.
  // Cumple activosFin[m] = activosInicio[m] + nuevos[m] − bajas[m] y activosInicio[m+1] = activosFin[m].
  activosInicio: number[]            // activos al empezar el día 1 (= activosFin del mes anterior)
  activosFin: (number | null)[]      // activos al cierre del último día del mes; mes en curso = hoy; meses futuros = null
  nuevos: number[]                   // entradas dentro del mes (mes en curso: hasta hoy)
  bajas: number[]                    // salidas dentro del mes (mes en curso: hasta hoy)
  renovaciones: number[]             // = crm.churnRenov (pagas, sin extensiones)
  churn: (number | null)[]           // bajas/activosInicio*100; null si activosInicio<3 o mes futuro
  tasaRenovacion: (number | null)[]  // renovaciones/(renovaciones+bajas)*100; null si no hubo decisiones
  ltvAcumulado: (number | null)[]    // Σ pagos con fecha ≤ fin de mes ÷ clientes únicos con pago ≤ fin de mes; null meses futuros
  ltgpCac: (number | null)[]         // ltvAcumulado[m] × margenBruto ÷ monthlyCAC[m] (CAC blended del mes); null si falta alguno
  beccPct: (number | null)[]         // monthlyBECC[m] / monthlyCash[m] * 100; null si cash 0
}

// ── Foto diaria del semáforo operativo (ClickUp + CRM) ──
export interface FotoOperativa {
  fecha: string          // 'YYYY-MM-DD' (día Argentina de la foto)
  rojo: number; amarillo: number; verde: number; pausa: number; produccion: number; finalizados: number   // ClickUp
  activosCRM: number     // backend.crm.activos
}

// ── Grabaciones por cliente (pestaña "Guiones para realizar") ──
export interface GrabacionCliente {
  cliente: string                  // nombre del CRM si se resolvió el alias; si no, el alias
  ultimaGrabacion: string | null   // 'YYYY-MM-DD' última grabación con fecha
  fechaAproximada: boolean         // true si ultimaGrabacion salió de la col D (no de la col F / fecha en E)
  diasDesdeGrabacion: number | null
  grabado: boolean                 // alguna fila del cliente con E marcada (X o fecha ya pasada; fecha futura = agendada, no grabado)
  guionesListos: string | null     // 'YYYY-MM-DD' col D de la fila más reciente TODAVÍA sin grabar
  diasEsperando: number | null     // días desde guionesListos
  nota: string | null              // texto libre de col E si no es X ni fecha ("mañana", "desp del 23 se graba")
  estadoClickUp: string | null     // status ClickUp del cliente si matchea por nombre
  aliasSinResolver: boolean
  inactiva?: boolean               // nota tipo "no mandar" / "no grabar" / "pausa" / "baja": fuera del ranking y de "guiones esperando"
  ultimoGuion?: string | null      // 'YYYY-MM-DD' col D más reciente (con o sin grabar): la última entrega de guiones
  fechasGuiones?: string[]         // col D de cada fila (entrega de guiones), para contar las entregas posteriores a un lanzamiento
}

// ── Sistema de alertas operativas: cobranzas, vencimientos, onboarding, Meta ──
export interface Alertas {
  // Cobros a pedir DEL MES: saldo > $50 con fecha de próximo cobro (col T del CRM) hasta fin
  // del mes actual, orden cronológico; dias < 0 = vencido. Sin fecha → resumen pagosSinFecha.
  pagosPendientes: { nombre: string; saldo: number; fecha: string; dias: number }[]
  pagosSinFecha: { cantidad: number; total: number }
  // Histórico completo: TODOS los que deben plata (con o sin fecha, este mes o próximos)
  pagosTodos: { nombre: string; saldo: number; fecha: string | null; dias: number | null }[]
  // llamada = fecha de la llamada de proyección agendada (col U del CRM, manual); null = SIN llamada
  // llamadaPasada = la col U trae una fecha anterior a hoy → "llamada del X sin resultado cargado"
  vencidos: { nombre: string; dias: number; llamada: string | null; llamadaPasada?: boolean }[]
  porVencer: { nombre: string; fecha: string; dias: number; llamada: string | null }[]
  // Finalizados de los últimos 90 días: ¿tuvieron/tienen llamada de proyección? (col U)
  finalizados: { nombre: string; fin: string; dias: number; llamada: string | null }[]
  onboarding: ClickUpProduccion[]                               // ClickUp en producción, ordenados por prioridad/días
  metaClientes: MetaClientes                                    // cuentas de clientes con errores de pago / frenadas
}

// ── ClickUp: semáforo de salud de clientes (lista "Clientes 2026", caché 10 min) ──
// El semáforo ES el estado de la tarea: rojo / amarillo / verde / pausa, más los estados
// del pipeline de producción (onboarding → … → campañas activas) y "final del servicio".
// Solo tareas principales (las subtareas tipo "Guion 1" se excluyen por parent != null).
export interface ClickUpProduccion {
  nombre: string
  dias: number                  // días desde que se creó la tarea (≈ días en onboarding)
  prioridad: string | null      // priority de ClickUp: urgent / high / normal / low
  status: string                // etapa actual del pipeline (onboarding, guionizar, …)
}
export interface ClickUpSemaforo {
  disponible: boolean
  rojo: number; amarillo: number; verde: number; pausa: number
  produccion: number            // onboarding + guionizar + grabación + edición + campañas activas + …
  finalizados: number
  nombresRojo: string[]
  nombresAmarillo: string[]
  produccionDetalle: ClickUpProduccion[]   // en onboarding, ordenados por prioridad y días
  tareas: { nombre: string; status: string }[]   // todas las tareas principales con su status (para cruzar por nombre)
  actualizado: string
}
let clickupCache: { at: number; data: ClickUpSemaforo } | null = null
async function fetchClickUpSemaforo(): Promise<ClickUpSemaforo> {
  const vacio: ClickUpSemaforo = { disponible: false, rojo: 0, amarillo: 0, verde: 0, pausa: 0, produccion: 0, finalizados: 0, nombresRojo: [], nombresAmarillo: [], produccionDetalle: [], tareas: [], actualizado: '' }
  const token = process.env.CLICKUP_TOKEN, list = process.env.CLICKUP_LIST_ID
  if (!token || !list) return vacio
  if (clickupCache && Date.now() - clickupCache.at < 10 * 60 * 1000) return clickupCache.data
  try {
    const tareas: { name: string; parent: string | null; status?: { status: string }; date_created?: string; priority?: { priority?: string } | null }[] = []
    for (let page = 0; page < 10; page++) {
      const r = await fetch(`https://api.clickup.com/api/v2/list/${list}/task?include_closed=true&subtasks=false&page=${page}`, { headers: { Authorization: token } })
      if (!r.ok) throw new Error(`ClickUp ${r.status}`)
      const d = await r.json()
      tareas.push(...(d.tasks ?? []))
      if (d.last_page || !(d.tasks ?? []).length) break
    }
    const out: ClickUpSemaforo = { ...vacio, disponible: true, nombresRojo: [], nombresAmarillo: [], produccionDetalle: [], tareas: [], actualizado: new Date().toISOString() }
    for (const t of tareas) {
      if (t.parent) continue
      const st = (t.status?.status ?? '').toLowerCase().trim()
      out.tareas.push({ nombre: t.name, status: st })
      if (st === 'rojo') { out.rojo++; out.nombresRojo.push(t.name) }
      else if (st === 'amarillo') { out.amarillo++; out.nombresAmarillo.push(t.name) }
      else if (st === 'verde') out.verde++
      else if (st === 'pausa') out.pausa++
      else if (st === 'final del servicio') out.finalizados++
      else {
        out.produccion++
        const creada = parseInt(t.date_created ?? '0') || 0
        out.produccionDetalle.push({
          nombre: t.name,
          dias: creada ? Math.floor((Date.now() - creada) / 86_400_000) : 0,
          prioridad: t.priority?.priority ?? null,
          status: st,
        })
      }
    }
    // Prioridad arriba: urgent > high > normal > low > sin prioridad; a igual prioridad, más días esperando primero
    const rango: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
    out.produccionDetalle.sort((a, b) =>
      (rango[a.prioridad ?? ''] ?? 4) - (rango[b.prioridad ?? ''] ?? 4) || b.dias - a.dias)
    clickupCache = { at: Date.now(), data: out }
    return out
  } catch (e) {
    console.error('ClickUp:', (e as Error).message)
    return clickupCache?.data ?? vacio
  }
}

// ── Meta Marketing API: gasto mensual por embudo (caché 10 min) ─────
// Clasifica cada campaña por su NOMBRE: uruguay → aparte; 'retarget' → Retargeting (embudo
// PROPIO, separado del VSL, con sus agendas y su FECCU); webinar; 'Hammer Them' (pre-call de
// todos los embudos, no es webinar) → otros; vsl; fm / posts de IG ("Comentá...") → FM.
// ⚠️ Misma regla en app/api/ads/route.ts (classifyCampaign) — mantener sincronizadas.
export interface MetaAds {
  vsl: number[]; fm: number[]; webinar: number[]; uruguay: number[]; retargeting: number[]; otros: number[]
  fmResultados: number[]   // "results" de Meta para campañas FM (visitas al perfil) → CPL = fm/fmResultados
}
let metaCache: { ts: number; data: MetaAds } | null = null

function classifyCampaign(name: string): 'vsl' | 'fm' | 'webinar' | 'uruguay' | 'retargeting' | 'otros' {
  const n = name.toLowerCase()
  if (n.includes('uruguay')) return 'uruguay'
  if (n.includes('retarget')) return 'retargeting'   // antes que vsl: "RETARGETING VSL FUNNEL" es retargeting
  if (n.includes('webinar')) return 'webinar'
  if (n.includes('vsl')) return 'vsl'
  if (n.includes('fm')) return 'fm'
  if (n.includes('publicación de instagram') || n.includes('coment')) return 'fm'  // posts IG boosteados
  return 'otros'   // incluye 'Hammer Them' (pre-call)
}

async function fetchMetaAdsMonthly(): Promise<MetaAds | null> {
  const token = process.env.META_ACCESS_TOKEN
  const acct = process.env.META_AD_ACCOUNT_ID
  if (!token || !acct) return null
  if (metaCache && Date.now() - metaCache.ts < 10 * 60_000) return metaCache.data
  try {
    const z12 = () => Array.from({ length: 12 }, () => 0)
    const data: MetaAds = { vsl: z12(), fm: z12(), webinar: z12(), uruguay: z12(), retargeting: z12(), otros: z12(), fmResultados: z12() }
    const timeRange = encodeURIComponent(JSON.stringify({ since: '2026-01-01', until: ymdLocal(nowArgentina()) }))   // hoy en hora AR (nunca toISOString)
    let url: string | null =
      `https://graph.facebook.com/v23.0/act_${acct}/insights?level=campaign&fields=campaign_name,spend,results` +
      `&time_increment=monthly&time_range=${timeRange}&limit=500&access_token=${token}`
    // Paginación por las dudas (limit 500 alcanza, pero por si crece)
    for (let page = 0; url && page < 5; page++) {
      const res: Response = await fetch(url)
      const json = await res.json() as {
        error?: { message: string }
        data?: { campaign_name?: string; spend?: string; date_start?: string; results?: { values?: { value?: string }[] }[] }[]
        paging?: { next?: string }
      }
      if (json.error) return metaCache?.data ?? null
      for (const row of json.data ?? []) {
        const m = parseInt((row.date_start ?? '').slice(5, 7)) - 1
        if (m < 0 || m > 11) continue
        const bucket = classifyCampaign(row.campaign_name ?? '')
        const spend = parseFloat(row.spend ?? '0') || 0
        data[bucket][m] += spend
        // CPL de IG = lo que reporta Meta: para FM el resultado es "visita al perfil"
        if (bucket === 'fm') data.fmResultados[m] += parseInt(row.results?.[0]?.values?.[0]?.value ?? '0') || 0
      }
      url = json.paging?.next ?? null
    }
    metaCache = { ts: Date.now(), data }
    return data
  } catch {
    return metaCache?.data ?? null
  }
}

// ── Meta: estado de las cuentas publicitarias de los CLIENTES (Business Manager) ──
// Requiere que el token tenga el permiso business_management; si no lo tiene,
// devuelve disponible:false y el panel de alertas muestra cómo habilitarlo.
export interface MetaClienteCuenta {
  id?: string                    // id de la cuenta publicitaria ("act_…"): la col A de "Cuentas Meta" puede ser el id
  nombre: string
  estado: 'activa' | 'error_pago' | 'deshabilitada' | 'cerrada'
  diasSinCorrer: number | null   // días desde el último día con gasto (null = corrió ayer/hoy)
  racha: number                  // días seguidos corriendo hasta ayer (0 si está frenada)
  pausadoCRM?: boolean           // el cliente figura PAUSADO en el CRM (para CUALQUIER estado de cuenta)
  enOnboarding?: boolean         // el cliente (del CRM, con apellido en común) está en producción en ClickUp → no es "frenada"
  sinDatos?: boolean             // no se pudieron leer insights de gasto (no afirmar que está frenada)
  enGracia?: boolean             // account_status 9 = período de gracia: Meta todavía entrega pero va a cortar por deuda → "por dar error"
  sinMedioPago?: boolean         // la cuenta no tiene tarjeta/medio de pago cargado (funding_source_details vacío)
  clienteCRM?: string            // nombre del cliente en el CRM (col C de "Cuentas Meta" o match por nombre)
  sinCliente?: boolean           // no se pudo asociar a ningún cliente del CRM (cargar col C en "Cuentas Meta")
  telefono?: string              // CRM Agencia col D (primer número si hay varios)
  email?: string                 // CRM Agencia col E
  negocio?: string               // nombre del Business Manager dueño de la cuenta (ayuda a identificar al cliente)
}
export interface MetaClientes {
  disponible: boolean
  cuentas: MetaClienteCuenta[]
  total: number
}
// Cuenta tal como la lista /me/businesses (antes de pedir insights)
export interface CuentaMetaBase { id: string; nombre: string; negocio: string }
type CtaMeta = { id: string; name: string; account_status: number; funding_source_details?: { id?: string; display_string?: string }; negocio: string }
type InsightsCuenta = { diasSinCorrer: number | null; racha: number; sinDatos: boolean }
// Cachés de 60 min (la app de Meta tiene rate limit bajo, #4): el LISTADO de cuentas y los insights
// de CADA cuenta por separado → el filtro de ex-clientes se re-aplica en cada carga sin volver a llamar,
// y una cuenta que se reactiva solo cuesta su propia llamada de insights.
const META_CLI_TTL = 60 * 60_000
let metaCliListaCache: { ts: number; cuentas: CtaMeta[] } | null = null
const metaCliInsCache = new Map<string, { ts: number; r: InsightsCuenta }>()
let metaCliUltimo: MetaClientes | null = null   // último resultado bueno (fallback ante error inesperado)
// Tope de cuentas a las que se les piden insights (1 llamada c/u). Se aplica DESPUÉS de sacar
// cerradas y ex-clientes: si se corta, se avisa (se estarían perdiendo cuentas de clientes vigentes).
const META_CLI_TOPE = 150

async function insightsCuentaMeta(id: string, token: string): Promise<InsightsCuenta> {
  let diasSinCorrer: number | null = 90, racha = 0   // 90 = "90 o más" (mirada de 90 días)
  try {
    const ins = await (await fetch(`https://graph.facebook.com/v23.0/${id}/insights?fields=spend&time_increment=1&date_preset=last_90d&level=account&limit=100&access_token=${token}`)).json() as
      { data?: { spend?: string; date_start?: string }[]; error?: unknown }
    if (ins.error || !ins.data) throw new Error('sin insights')
    const porDia = new Map((ins.data ?? []).map(d => [d.date_start ?? '', parseFloat(d.spend ?? '0') || 0]))
    // gastos[0] = ayer, gastos[1] = anteayer, ...
    const hoy = nowArgentina()
    const gastos = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(hoy); d.setDate(d.getDate() - (i + 1))
      return porDia.get(ymdLocal(d)) ?? 0   // día local (nunca toISOString)
    })
    const primerDiaConGasto = gastos.findIndex(g => g > 0)   // -1 = no corrió en 90 días
    if (primerDiaConGasto === 0) {
      diasSinCorrer = null                                   // corrió ayer → está corriendo
      while (racha < gastos.length && gastos[racha] > 0) racha++
    } else if (primerDiaConGasto > 0) {
      diasSinCorrer = primerDiaConGasto
    }
    return { diasSinCorrer, racha, sinDatos: false }
  } catch {
    return { diasSinCorrer: null, racha: 0, sinDatos: true }   // sin insights accesibles: no afirmar "frenada"
  }
}

// La cuenta publicitaria PROPIA de la agencia (META_AD_ACCOUNT_ID, "GERO 1ra USD") aparece en los
// Business Manager pero no es de un cliente: nunca entra en las alertas de cuentas de clientes.
function esCuentaPropia(id: string | undefined): boolean {
  const propia = (process.env.META_AD_ACCOUNT_ID ?? '').replace(/^act_/, '').trim()
  return !!propia && (id ?? '').replace(/^act_/, '') === propia
}

// excluirP: filtro de ex-clientes (col B = NO exacta en "Cuentas Meta" o cliente FINALIZADO / INACTIVO
// en el CRM). Llega cuando terminan de leerse las hojas (en paralelo con el listado de Meta) y se
// aplica ANTES de pedir insights, para que el tope no se gaste en cuentas que después se descartan.
async function fetchMetaClientesEstado(excluirP?: Promise<((c: CuentaMetaBase) => boolean) | null>): Promise<MetaClientes> {
  const vacio: MetaClientes = { disponible: false, cuentas: [], total: 0 }
  // Si el filtro no llega (falló la lectura de hojas) se sigue sin él: construirRawData vuelve a filtrar después
  const excluirListo = (excluirP ?? Promise.resolve(null)).catch(e => { console.error('MetaClientes: sin filtro de ex-clientes:', (e as Error).message); return null })
  // Token con business_management (el de las cuentas de clientes). Es de USUARIO y
  // vence (~60 días); el principal de system user no lo tiene todavía, por eso va aparte.
  const token = process.env.META_CLIENTES_TOKEN || process.env.META_ACCESS_TOKEN
  if (!token) return vacio
  try {
    let listado = metaCliListaCache && Date.now() - metaCliListaCache.ts < META_CLI_TTL ? metaCliListaCache.cuentas : null
    let degradado = false   // no se pudo releer el listado → se usa el anterior y sus insights aunque estén vencidos
    if (!listado) {
      // UNA sola llamada con field expansion: businesses + sus cuentas (own y client) + medio de pago.
      // Hay más de 50 businesses → se sigue paging.next (1 llamada extra por página, máx 4).
      type Cta = Omit<CtaMeta, 'negocio'>
      type Biz = { id: string; name?: string; owned_ad_accounts?: { data?: Cta[] }; client_ad_accounts?: { data?: Cta[] } }
      const campos = 'name,account_status,funding_source_details'
      let url: string | null = `https://graph.facebook.com/v23.0/me/businesses?fields=id,name,owned_ad_accounts{${campos}},client_ad_accounts{${campos}}&limit=50&access_token=${token}`
      const negocios: Biz[] = []
      try {
        for (let pag = 0; url && pag < 4; pag++) {
          const biz = await (await fetch(url)).json() as { error?: { message?: string }; data?: Biz[]; paging?: { next?: string } }
          if (biz.error) {
            console.error('MetaClientes /me/businesses:', biz.error.message)
            break   // con lo que ya se leyó alcanza (mejor parcial que nada)
          }
          negocios.push(...(biz.data ?? []))
          url = biz.paging?.next ?? null
        }
      } catch (e) {
        console.error('MetaClientes /me/businesses:', (e as Error).message)
      }
      const cuentasRaw = new Map<string, CtaMeta>()
      for (const b of negocios)
        for (const c of [...(b.owned_ad_accounts?.data ?? []), ...(b.client_ad_accounts?.data ?? [])])
          cuentasRaw.set(c.id, { ...c, negocio: b.name ?? '' })
      if (cuentasRaw.size) {
        listado = [...cuentasRaw.values()]
        metaCliListaCache = { ts: Date.now(), cuentas: listado }
      } else if (metaCliListaCache) {
        listado = metaCliListaCache.cuentas
        degradado = true
      } else {
        console.error('MetaClientes /me/businesses: sin cuentas')
        return metaCliUltimo ?? vacio
      }
    }
    // Cuentas cerradas (100/101) fuera: son históricas, no accionables. Después, los ex-clientes.
    const excluir = await excluirListo
    const abiertas = listado.filter(c => ![100, 101].includes(c.account_status) && !esCuentaPropia(c.id))
    const vigentes = excluir ? abiertas.filter(c => !excluir({ id: c.id, nombre: c.name, negocio: c.negocio })) : abiertas
    if (vigentes.length > META_CLI_TOPE)
      console.error(`MetaClientes: ${vigentes.length} cuentas de clientes vigentes, se leen solo ${META_CLI_TOPE} — quedan ${vigentes.length - META_CLI_TOPE} afuera (subir META_CLI_TOPE)`)
    const lista = vigentes.slice(0, META_CLI_TOPE)
    const cuentas: MetaClienteCuenta[] = await Promise.all(lista.map(async c => {
      const estado: MetaClienteCuenta['estado'] =
        c.account_status === 1 ? 'activa'
        : [3, 7, 8, 9].includes(c.account_status) ? 'error_pago'
        : [100, 101].includes(c.account_status) ? 'cerrada' : 'deshabilitada'
      // Insights: 1 llamada por cuenta y por hora (también se cachea el "sin datos" para no insistir)
      const enCache = metaCliInsCache.get(c.id)
      let ins: InsightsCuenta
      if (enCache && (degradado || Date.now() - enCache.ts < META_CLI_TTL)) ins = enCache.r
      else {
        ins = await insightsCuentaMeta(c.id, token)
        metaCliInsCache.set(c.id, { ts: Date.now(), r: ins })
      }
      const { diasSinCorrer, racha, sinDatos } = ins
      const extra = {
        ...(c.account_status === 9 ? { enGracia: true } : {}),
        ...(!c.funding_source_details?.id ? { sinMedioPago: true } : {}),
        ...(c.negocio ? { negocio: c.negocio } : {}),
      }
      return sinDatos ? { id: c.id, nombre: c.name, estado, diasSinCorrer, racha, sinDatos, ...extra } : { id: c.id, nombre: c.name, estado, diasSinCorrer, racha, ...extra }
    }))
    const out: MetaClientes = { disponible: true, cuentas, total: lista.length }
    metaCliUltimo = out
    return out
  } catch (e) {
    console.error('MetaClientes:', (e as Error).message)
    return metaCliUltimo ?? vacio
  }
}

// Fecha de la pestaña Gastos (col A): serial de Sheets o texto "D/M/YYYY" | "DD/MM/YY"
function parseGastoDate(cell: unknown): Date | null {
  if (typeof cell === 'number') return serialToDate(cell)
  if (typeof cell !== 'string' || !cell.trim()) return null
  const p = cell.trim().split('/')
  if (p.length < 3) return null
  const d = parseInt(p[0]), m = parseInt(p[1])
  let y = parseInt(p[2])
  if (y < 100) y += 2000
  if (isNaN(d) || isNaN(m) || isNaN(y) || m < 1 || m > 12) return null
  return new Date(y, m - 1, d)
}

// ── GA4: visitantes por mes (leads VSL) con caché de 10 min ─────────
let gaCache: { ts: number; data: (number | null)[] } | null = null

async function fetchGA4MonthlyUsers(): Promise<(number | null)[]> {
  const empty = Array.from({ length: 12 }, () => null as number | null)
  const email = process.env.GA_CLIENT_EMAIL
  const key = process.env.GA_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const property = process.env.GA_PROPERTY_ID
  if (!email || !key || !property) return empty
  if (gaCache && Date.now() - gaCache.ts < 10 * 60_000) return gaCache.data
  try {
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] })
    const ga = google.analyticsdata({ version: 'v1beta', auth })
    const res = await ga.properties.runReport({
      property: `properties/${property}`,
      requestBody: {
        dateRanges: [{ startDate: '2026-01-01', endDate: 'today' }],
        dimensions: [{ name: 'yearMonth' }],
        metrics: [{ name: 'totalUsers' }],
        // Solo la home de la VSL ("/") — excluye /webi (webinar) y demás páginas
        dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: '/' } } },
      },
    })
    const out = empty.slice()
    for (const row of res.data.rows ?? []) {
      const ym = row.dimensionValues?.[0]?.value ?? ''
      const m = parseInt(ym.slice(4)) - 1
      if (m >= 0 && m < 12) out[m] = parseInt(row.metricValues?.[0]?.value ?? '0') || 0
    }
    gaCache = { ts: Date.now(), data: out }
    return out
  } catch {
    return gaCache?.data ?? empty
  }
}

// ── GA4: agendas desde la landing (thank-you /graciasporagendar de Framer) ──
let gaAgendasCache: { ts: number; data: (number | null)[] } | null = null
async function fetchGA4MonthlyAgendasWeb(): Promise<(number | null)[]> {
  const empty = Array.from({ length: 12 }, () => null as number | null)
  const email = process.env.GA_CLIENT_EMAIL
  const key = process.env.GA_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const property = process.env.GA_PROPERTY_ID
  if (!email || !key || !property) return empty
  if (gaAgendasCache && Date.now() - gaAgendasCache.ts < 10 * 60_000) return gaAgendasCache.data
  try {
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] })
    const ga = google.analyticsdata({ version: 'v1beta', auth })
    const res = await ga.properties.runReport({
      property: `properties/${property}`,
      requestBody: {
        dateRanges: [{ startDate: '2026-01-01', endDate: 'today' }],
        dimensions: [{ name: 'yearMonth' }],
        metrics: [{ name: 'totalUsers' }],
        dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/graciasporagendar' } } },
      },
    })
    const out = empty.slice()
    for (const row of res.data.rows ?? []) {
      const ym = row.dimensionValues?.[0]?.value ?? ''
      const m = parseInt(ym.slice(4)) - 1
      if (m >= 0 && m < 12) out[m] = parseInt(row.metricValues?.[0]?.value ?? '0') || 0
    }
    gaAgendasCache = { ts: Date.now(), data: out }
    return out
  } catch {
    return gaAgendasCache?.data ?? empty
  }
}

// ── GA4: clicks en el botón Agendar (evento custom click_agendar del snippet en Framer) ──
let gaClicksCache: { ts: number; data: (number | null)[] } | null = null
async function fetchGA4MonthlyClicksAgendar(): Promise<(number | null)[]> {
  const empty = Array.from({ length: 12 }, () => null as number | null)
  const email = process.env.GA_CLIENT_EMAIL
  const key = process.env.GA_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const property = process.env.GA_PROPERTY_ID
  if (!email || !key || !property) return empty
  if (gaClicksCache && Date.now() - gaClicksCache.ts < 10 * 60_000) return gaClicksCache.data
  try {
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] })
    const ga = google.analyticsdata({ version: 'v1beta', auth })
    const res = await ga.properties.runReport({
      property: `properties/${property}`,
      requestBody: {
        dateRanges: [{ startDate: '2026-01-01', endDate: 'today' }],
        dimensions: [{ name: 'yearMonth' }],
        metrics: [{ name: 'totalUsers' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'click_agendar' } } },
      },
    })
    const out = empty.slice()
    for (const row of res.data.rows ?? []) {
      const ym = row.dimensionValues?.[0]?.value ?? ''
      const m = parseInt(ym.slice(4)) - 1
      if (m >= 0 && m < 12) out[m] = parseInt(row.metricValues?.[0]?.value ?? '0') || 0
    }
    gaClicksCache = { ts: Date.now(), data: out }
    return out
  } catch {
    return gaClicksCache?.data ?? empty
  }
}

// Fecha flexible para "Leads IG" (serial de Sheets, ISO o DD/MM/YYYY)
function parseLeadDate(cell: unknown): Date | null {
  if (typeof cell === 'number') return serialToDate(cell)
  if (typeof cell !== 'string' || !cell.trim()) return null
  const s = cell.trim()
  // ISO parseado como LOCAL (new Date("YYYY-MM-DD") asume UTC y corre un día en TZ negativas)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s.slice(0, 10) + 'T00:00:00'); return isNaN(+d) ? null : d }
  const p = s.split(' ')[0].split('/')
  if (p.length === 3) {
    const a = parseInt(p[0]), b = parseInt(p[1]), y = parseInt(p[2].substring(0, 4))
    if (isNaN(a) || isNaN(b) || isNaN(y)) return null
    // DD/MM/YYYY salvo que el primer número no pueda ser día
    const [d, m] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]
    return new Date(y, m - 1, d)
  }
  return null
}

type Cell = string | number
type Row = Cell[]

// ── Lectura de Sheets agrupada (cuota: 60 lecturas/min para la service account) ──
// Antes cada rango era un values.get suelto (~20 por request) y ante un 429 devolvía [] en
// silencio → métricas en 0 al azar. Ahora:
//   · un values.batchGet por (spreadsheet, valueRenderOption) → 6 lecturas por carga en frío
//   · ante error: 1 reintento corto; si vuelve a fallar, el ÚLTIMO VALOR BUENO de ese rango
//   · una pestaña inexistente (400 "Unable to parse range") no tumba el lote: se saca y se
//     devuelve [] solo para ella (se vuelve a probar a los 10 min)
interface Lectura {
  id: string             // spreadsheetId
  range: string
  unformatted?: boolean  // UNFORMATTED_VALUE (números/seriales reales) vs FORMATTED_VALUE
  conHeader?: boolean    // true (default) = se descarta la fila 1 (por eso esos rangos empiezan en la fila 1)
}
const ultimoBueno = new Map<string, Row[]>()          // último valor bueno por rango
const rangosInexistentes = new Map<string, number>()  // rango → momento en que Sheets dijo que no existe
let lecturasSheets = 0                                 // requests a Sheets desde que arrancó el proceso (diagnóstico)
export const contadorLecturasSheets = () => lecturasSheets

const claveLectura = (l: Lectura) => `${l.id}|${l.unformatted ? 'U' : 'F'}|${l.range}`
const esperar = (ms: number) => new Promise(res => setTimeout(res, ms))

async function leerLote(sheets: ReturnType<typeof google.sheets>, lote: Lectura[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>()
  let pendientes = lote.filter(l => {
    const t = rangosInexistentes.get(claveLectura(l))
    if (t && Date.now() - t < 10 * 60_000) { out.set(claveLectura(l), []); return false }
    return true
  })
  let fallos = 0
  while (pendientes.length) {
    try {
      lecturasSheets++
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: pendientes[0].id,
        ranges: pendientes.map(l => l.range),
        valueRenderOption: pendientes[0].unformatted ? 'UNFORMATTED_VALUE' : 'FORMATTED_VALUE',
      })
      const vrs = res.data.valueRanges ?? []
      pendientes.forEach((l, i) => {
        const filas = (vrs[i]?.values ?? []) as Row[]
        const datos = l.conHeader === false ? filas : filas.slice(1)
        ultimoBueno.set(claveLectura(l), datos)
        rangosInexistentes.delete(claveLectura(l))
        out.set(claveLectura(l), datos)
      })
      return out
    } catch (e) {
      const msg = (e as Error).message ?? ''
      // Pestaña inexistente: se saca del lote y se reintenta el resto sin gastar el reintento
      if (/unable to parse range/i.test(msg)) {
        const malo = pendientes.find(l => msg.includes(l.range))
        if (malo || pendientes.length === 1) {
          const m = malo ?? pendientes[0]
          rangosInexistentes.set(claveLectura(m), Date.now())
          out.set(claveLectura(m), [])
          pendientes = pendientes.filter(l => l !== m)
          continue
        }
        // No se pudo identificar cuál: se leen de a uno (cada uno se resuelve solo)
        const sueltos = await Promise.all(pendientes.map(l => leerLote(sheets, [l])))
        for (const r of sueltos) for (const [k, v] of r) out.set(k, v)
        return out
      }
      if (++fallos <= 1) { await esperar(1500); continue }   // 1 reintento corto (429 / red)
      for (const l of pendientes) {
        const previo = ultimoBueno.get(claveLectura(l))
        console.error(`Sheets: falló la lectura de ${l.range} (${msg.slice(0, 120)}) → ${previo ? 'uso el último valor bueno' : 'sin valor previo, queda vacío'}`)
        out.set(claveLectura(l), previo ?? [])
      }
      return out
    }
  }
  return out
}

// Lee todas las lecturas agrupando por (spreadsheet, render) y devuelve las filas en el mismo orden
async function leerSheets(sheets: ReturnType<typeof google.sheets>, lecturas: Lectura[]): Promise<Row[][]> {
  const grupos = new Map<string, Lectura[]>()
  for (const l of lecturas) {
    if (!l.id) continue   // sheet no configurado → []
    const k = `${l.id}|${l.unformatted ? 'U' : 'F'}`
    grupos.set(k, [...(grupos.get(k) ?? []), l])
  }
  const resultados = await Promise.all([...grupos.values()].map(g => leerLote(sheets, g)))
  const todo = new Map<string, Row[]>()
  for (const r of resultados) for (const [k, v] of r) todo.set(k, v)
  return lecturas.map(l => (l.id ? todo.get(claveLectura(l)) ?? [] : []))
}

// ── Índice de clientes del CRM (Agencia) + pestaña "Cuentas Meta" ──
// Se arma apenas llegan las hojas: lo usa el filtro de ex-clientes de las cuentas Meta ANTES de
// pedir insights (fetchMetaClientesEstado) y después las grabaciones y las alertas.
// Nombres normalizados (sin acentos ni puntuación). Ante nombres duplicados (ej. un cliente que
// volvió: una fila INACTIVO y otra ACTIVO) gana la fila vigente (ACTIVO/PAUSADO).
interface ClienteCRM { nombre: string; estado: string; telefono: string; email: string; tokens: string[] }
const normTxt = (x: unknown) => (x ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const esVigente = (estado: string) => estado === 'ACTIVO' || estado === 'PAUSADO'
// Palabras genéricas de nombres de cuentas/estudios que no identifican a nadie
const PALABRAS_GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'juridicos', 'abogado', 'abogada', 'abogados', 'abogadas',
  'asociados', 'asociadas', 'legal', 'legales', 'consultora', 'publicidad', 'campanas', 'finanzas', 'firma', 'dolares', 'notarial', 'penal'])
// Nombres de pila frecuentes: NUNCA cuentan como "apellido único" (en 'Pujol Alejandra Maria Jose'
// las 2 últimas palabras son nombres, no apellidos → 'maria' no puede identificar a nadie)
const NOMBRES_DE_PILA = new Set(['maria', 'jose', 'josefina', 'laura', 'paula', 'paola', 'ana', 'juan', 'pablo', 'carlos', 'jorge',
  'luis', 'lucia', 'lucas', 'luciana', 'andrea', 'andres', 'alejandra', 'alejandro', 'daniel', 'daniela', 'gabriel', 'gabriela',
  'natalia', 'carolina', 'sofia', 'marcela', 'marcelo', 'martin', 'martina', 'javier', 'diego', 'fernando', 'fernanda', 'florencia',
  'agustin', 'agustina', 'sebastian', 'nicolas', 'cecilia', 'veronica', 'silvina', 'claudia', 'claudio', 'mariana', 'mariano',
  'marina', 'romina', 'valeria', 'victoria', 'elizabeth', 'eugenia', 'cristina', 'lorena', 'gisela', 'julieta', 'yanina', 'ignacio',
  'matias', 'federico', 'francisco', 'gustavo', 'ricardo', 'roberto', 'miguel', 'manuel', 'antonio', 'eduardo', 'sergio', 'mauricio',
  'leandro', 'noemi', 'beatriz', 'susana', 'patricia', 'monica', 'silvia', 'graciela', 'adriana', 'rodolfo', 'alfredo', 'alberto',
  'gonzalo', 'santiago', 'tomas', 'emiliano', 'facundo', 'ezequiel', 'hernan', 'marcos', 'carmen', 'leticia', 'dario', 'constanza',
  'soledad', 'mercedes', 'elena', 'julio', 'cesar', 'oscar', 'hector', 'enrique', 'guillermo', 'horacio', 'ariel', 'marta', 'liliana',
  'viviana', 'sandra', 'alicia', 'belen', 'camila', 'micaela', 'melina', 'vanesa', 'vanina', 'noelia', 'pamela', 'rosario', 'sabrina',
  'tamara', 'celeste', 'milagros', 'guadalupe', 'magdalena', 'macarena', 'emilia', 'emilio', 'esteban', 'franco', 'german', 'gaston',
  'joaquin', 'julian', 'leonardo', 'maximiliano', 'octavio', 'patricio', 'ramiro', 'rodrigo', 'valentin', 'victor', 'teresa', 'rocio',
  'ines', 'pilar', 'raquel', 'irene', 'lujan', 'dolores', 'isabel', 'paz'])

function indiceClientes(crmAgencia: Row[], cuentasMetaRows: Row[]) {
  const crmPorNombre = new Map<string, ClienteCRM>()
  for (const r of crmAgencia) {
    if (!(r[0] ?? '').toString().trim()) continue
    const nombre = (r[1] ?? '').toString().trim()
    if (!nombre) continue
    const cli: ClienteCRM = {
      nombre,
      estado: (r[2] ?? '').toString().trim().toUpperCase(),
      telefono: (r[3] ?? '').toString().split('/')[0].replace(/\(.*?\)/g, '').trim(),   // col D: primer número
      email: (r[4] ?? '').toString().trim(),                                            // col E
      tokens: normTxt(nombre).split(' ').filter(Boolean),
    }
    const k = normTxt(nombre), prev = crmPorNombre.get(k)
    if (!prev || (!esVigente(prev.estado) && esVigente(cli.estado))) crmPorNombre.set(k, cli)
  }
  const clientesCRMIdx = [...crmPorNombre.values()]
  // Match difuso por nombre: ≥2 palabras de 4+ letras en común con UN solo cliente del CRM (si no, null)
  const matchClientePorNombre = (texto: string, soloVigentes = false): ClienteCRM | null => {
    const t = normTxt(texto).split(' ').filter(x => x.length >= 4 && !PALABRAS_GENERICAS.has(x))
    if (t.length < 2) return null
    const hits = clientesCRMIdx.filter(c => (!soloVigentes || esVigente(c.estado)) && t.filter(x => c.tokens.includes(x)).length >= 2)
    return hits.length === 1 ? hits[0] : null
  }
  // Match por APELLIDO ÚNICO: el apellido (última palabra; las 2 últimas si el nombre tiene 4+) de 5+
  // letras de un solo cliente de todo el CRM ("Luly Ponzio" → Maria Lujan Ponzio). Es más débil: solo
  // se usa para EXCLUIR finalizados/inactivos y marcar pausados, nunca para asociar teléfono/mail
  // (un falso positivo le escribiría a otra persona). Los nombres de pila frecuentes no se indexan.
  const clientesPorPalabra = new Map<string, Set<ClienteCRM>>()
  for (const c of clientesCRMIdx)
    for (const tk of c.tokens.slice(c.tokens.length >= 4 ? -2 : -1))
      if (tk.length >= 5 && !NOMBRES_DE_PILA.has(tk)) clientesPorPalabra.set(tk, (clientesPorPalabra.get(tk) ?? new Set()).add(c))
  const matchApellidoUnico = (texto: string): ClienteCRM | null => {
    const hits = new Set<ClienteCRM>()
    for (const x of normTxt(texto).split(' ')) {
      if (x.length < 5 || PALABRAS_GENERICAS.has(x) || NOMBRES_DE_PILA.has(x)) continue
      const cs = clientesPorPalabra.get(x)
      if (cs?.size === 1) hits.add([...cs][0])
    }
    return hits.size === 1 ? [...hits][0] : null
  }
  const buscarClienteCRM = (nombre: string): ClienteCRM | null =>
    nombre ? crmPorNombre.get(normTxt(nombre)) ?? matchClientePorNombre(nombre) : null

  // ── Pestaña "Cuentas Meta": A cuenta (nombre o id), B cliente actual SI/NO, C nombre en el CRM ──
  const norm = (x: unknown) => (x ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  const cuentaInfo = new Map<string, { actual: boolean; clienteCRM: string }>()
  for (const r of cuentasMetaRows) {
    const cuenta = norm(r[0])
    if (!cuenta) continue
    cuentaInfo.set(cuenta, { actual: !(r[1] ?? '').toString().trim().toUpperCase().startsWith('N'), clienteCRM: (r[2] ?? '').toString().trim() })
  }
  // Fila de "Cuentas Meta" para una cuenta: nombre (o id) EXACTO; si no, la ÚNICA fila con col B = SI
  // cuyas palabras (≥2, sin "usd"/"cp"/conectores) están todas en el nombre de la cuenta.
  // Ej: "Estudio Juridico TVR" → cuenta real "USD - Agus & Paula - TVR Estudio Jurídico".
  // El match difuso SOLO asocia el cliente (col C); nunca excluye: las filas NO quedan fuera de él
  // (filas NO "USD Laura María" / "USD Maria Paula" no pueden tapar una cuenta nueva "Dra María Laura Trangoni").
  const IGNORAR_TOKEN = new Set(['usd', 'cp', 'ads', 'y', 'de', 'la', 'del'])
  const tokensCuenta = (x: string) => norm(x).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !IGNORAR_TOKEN.has(t))
  const filasCuentasSI = [...cuentaInfo.entries()].filter(([, v]) => v.actual).map(([k, v]) => ({ t: tokensCuenta(k), v })).filter(f => f.t.length >= 2)
  const infoCuenta = (nombre: string, id?: string): { actual: boolean; clienteCRM: string; exacta: boolean } | undefined => {
    const exacta = cuentaInfo.get(norm(nombre)) ?? (id ? cuentaInfo.get(norm(id)) ?? cuentaInfo.get(norm(id.replace(/^act_/, ''))) : undefined)
    if (exacta) return { ...exacta, exacta: true }
    const tn = new Set(tokensCuenta(nombre))
    const m = filasCuentasSI.filter(f => f.t.every(x => tn.has(x)))
    return m.length === 1 ? { ...m[0].v, exacta: false } : undefined
  }
  // Cliente del CRM de una cuenta Meta: col C de "Cuentas Meta"; si no, match por nombre de la cuenta / del Business Manager
  const clienteDeCuenta = (c: { nombre: string; negocio?: string; id?: string }): { colC: string; crm: ClienteCRM | null; estado: string } => {
    const info = infoCuenta(c.nombre, c.id)
    let colC = info?.clienteCRM ?? ''
    let crmColC = colC ? buscarClienteCRM(colC) : null
    // Col C que vino por match DIFUSO y apunta a un ex-cliente: no se usa (sería excluir por difuso)
    if (info && !info.exacta && crmColC && !esVigente(crmColC.estado)) { colC = ''; crmColC = null }
    const crm = colC ? crmColC : matchClientePorNombre(c.nombre) ?? (c.negocio ? matchClientePorNombre(c.negocio) : null)
    // Estado del cliente: el del match fuerte; si no hubo, el del apellido único (solo para excluir/pausar)
    const debil = crm || colC ? null : matchApellidoUnico(c.nombre) ?? (c.negocio ? matchApellidoUnico(c.negocio) : null)
    return { colC, crm, estado: crm?.estado ?? debil?.estado ?? '' }
  }
  // Ex-cliente: col B = NO con match EXACTO en "Cuentas Meta", o cliente del CRM FINALIZADO / INACTIVO
  const cuentaExcluida = (c: { nombre: string; negocio?: string; id?: string }): boolean => {
    const info = infoCuenta(c.nombre, c.id)
    if (info?.exacta && !info.actual) return true
    const { estado } = clienteDeCuenta(c)
    return estado === 'FINALIZADO' || estado === 'INACTIVO'
  }
  return { crmPorNombre, clientesCRMIdx, matchClientePorNombre, buscarClienteCRM, clienteDeCuenta, cuentaExcluida }
}

// ── Caché del resultado completo (60 s) + deduplicación de requests concurrentes ──
// La página refresca cada 30 s y puede haber varias pestañas abiertas: sin esto cada una
// dispara su propia carga completa y se come la cuota de Sheets.
let rawCache: { at: number; data: RawData } | null = null
let rawEnVuelo: Promise<RawData> | null = null
// Versión "ligera" (la que pide el navegador): sin el estado de las cuentas Meta de los clientes, que la pantalla ya no
// muestra y es lo más lento de armar (decenas de llamadas a la API de Meta). Los cron y el Analista usan la completa.
let rawLigeroCache: { at: number; data: RawData } | null = null
let rawLigeroEnVuelo: Promise<RawData> | null = null
const FRESCO_MS = 60_000
const VIEJO_MAX_MS = 10 * 60_000   // pasado este tiempo no se sirve el dato viejo: se espera la carga nueva

export async function fetchRawData(opciones?: { ligero?: boolean }): Promise<RawData> {
  const ligero = !!opciones?.ligero
  const ahora = Date.now()
  // La completa sirve también para pedidos ligeros (tiene todo lo que tiene la ligera)
  const cache = ligero ? [rawCache, rawLigeroCache].filter(Boolean).sort((a, b) => b!.at - a!.at)[0] ?? null : rawCache
  if (cache && ahora - cache.at < FRESCO_MS) return cache.data
  const enVuelo = ligero ? (rawLigeroEnVuelo ?? rawEnVuelo) : rawEnVuelo
  if (enVuelo && !(cache && ahora - cache.at < VIEJO_MAX_MS)) return enVuelo
  const lanzar = () => {
    if (ligero) {
      if (rawLigeroEnVuelo) return rawLigeroEnVuelo
      rawLigeroEnVuelo = construirRawData(true)
        .then(data => { rawLigeroCache = { at: Date.now(), data }; return data })
        .finally(() => { rawLigeroEnVuelo = null })
      return rawLigeroEnVuelo
    }
    if (rawEnVuelo) return rawEnVuelo
    rawEnVuelo = construirRawData(false)
      .then(data => { rawCache = { at: Date.now(), data }; return data })
      .finally(() => { rawEnVuelo = null })
    return rawEnVuelo
  }
  // Dato viejo pero reciente (hasta 10 min): se responde YA con él y se renueva en segundo plano (la pantalla refresca sola cada 2 min)
  if (cache && ahora - cache.at < VIEJO_MAX_MS) {
    lanzar().catch(() => { /* si falla la renovación, el próximo pedido reintenta */ })
    return cache.data
  }
  return lanzar()
}

// Después de escribir en un sheet que lee este módulo (ej. la foto del Historial operativo):
// descarta la caché de 60 s y el "no existe" de las pestañas para que la próxima carga la vea.
export function invalidarCacheRaw() {
  rawCache = null
  rawLigeroCache = null
  rangosInexistentes.clear()
}

async function construirRawData(ligero = false): Promise<RawData> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const FINANZAS = process.env.SHEET_ID_FINANZAS ?? ''
  const VENTAS   = process.env.SHEET_ID_VENTAS   ?? ''
  const CLIENTES = process.env.SHEET_ID_CLIENTES ?? ''   // CRM Clientes 2.0 (churn real, renovación, éxito)

  const MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const YEAR = 2026

  // Hojas individuales de closers — fuente cruda de las métricas de ventas.
  // El "Dashboard General" del sheet omite Closer 3, por eso agregamos acá directo.
  // El nombre de persona coincide con la columna Closer del Registro de Pagos.
  const CLOSER_TABS = [
    { tab: 'Closer 1',          person: 'Juan' },   // hasta el 16/07/2026 14:00; después Carlos (ver abajo)
    { tab: 'Closer 2',          person: 'Fer' },
    { tab: 'Closer 3',          person: 'Ariel' },
    // Closers nuevos (pedido de Tomás, 26/10/2026): Nahuel Milena toma "Closer 4" y Brenda Amado "Closer 5". Las hojas estaban
    // vacías hasta entonces, así que todas sus filas son de ellos. En el Registro de Pagos (columna Closer) tienen que figurar
    // EXACTAMENTE "Nahuel" y "Brenda": si no, el filtro de persona del Resumen no junta sus pagos con sus llamadas.
    { tab: 'Closer 4',          person: 'Nahuel' },
    { tab: 'Closer 5',          person: 'Brenda' },
    { tab: 'Gero-Xavi Rejunte', person: 'Gero' },
  ]
  // Cambio de closer: Carlos tomó la hoja "Closer 1" desde la llamada de
  // Pablo Intili (16/07/2026 14:00). Las llamadas anteriores siguen siendo de Juan.
  const CARLOS_DESDE = new Date(2026, 6, 16, 14, 0)
  // Fer dejó de tomar llamadas (sept 2026); el closer nuevo Marcos hereda la hoja "Closer 2":
  // las llamadas de esa hoja desde el 10/09/2026 son de Marcos (inferido de las filas nuevas
  // del 10 y 11/9 — confirmar con el usuario si la fecha de corte es otra).
  const MARCOS_DESDE = new Date(2026, 8, 10, 0, 0)
  // Yamila Coutoune (agendas descalificadas, Lead Scoring D–E) toma "Closer 3" (pedido de Tomás, 18/10/2026; acceso desde
  // el 17/10). Las filas viejas de esa hoja (hasta la 46, julio) siguen siendo de Ariel. En el Registro de Pagos figura como
  // "Yami" (26/10/2026): las llamadas llevan ese mismo nombre para que el filtro de persona junte pagos y llamadas.
  const YAMILA_DESDE = new Date(2026, 9, 17, 0, 0)

  const GUIONES = process.env.SHEET_ID_GUIONES ?? ''   // sheet "Guiones y Videos"
  // Todas las lecturas de Sheets: se agrupan en un batchGet por (sheet, render) → 6 lecturas.
  // conHeader:false = se usa la fila 1 (ER por etiqueta, hojas de closers resuelven columnas por header).
  const LECTURAS: Lectura[] = [
    // Registro de Pagos (Finanzas) — UNFORMATTED para leer montos/fechas como números reales.
    // J concepto, K fuente, M mes, N tipo de venta, O tipo de pago, P categoría legada
    { id: FINANZAS, range: 'Registro de Pagos!A:Q', unformatted: true },
    // Estado de Resultados completo (Finanzas) — UNFORMATTED = números directos; SIN cortar la fila 1
    { id: FINANZAS, range: 'Estado de Resultados!A1:X50', unformatted: true, conHeader: false },
    // Leads de IG: A=Fecha,B=Contacto (filas en vivo de ManyChat) + D=Mes,E=Cantidad (histórico manual)
    { id: VENTAS, range: 'Leads IG!A:F', unformatted: true },        // + C usuario IG, F ID contacto (ManyChat, desde 10/9)
    // Seguidores nuevos de IG (mismo esquema; la pestaña puede no existir aún → [])
    { id: VENTAS, range: 'Seguidores IG!A:E', unformatted: true },
    // Asignados al setter: A=Fecha (filas en vivo: regla ManyChat "ASIGNADO → Sheets") + D=Mes,E=Cantidad (histórico)
    { id: VENTAS, range: 'Setter IG!A:G', unformatted: true },       // + F usuario IG, G ID contacto
    // Gastos (Finanzas): A=Fecha, C=Monto, D=Tipo — para separar anuncios por embudo
    { id: FINANZAS, range: 'Gastos!A:E', unformatted: true },
    // CRM Clientes 2.0: Agencia + Consultora + Renovaciones (UNFORMATTED: fechas serial, LTV number)
    // A ID, B nombre, C estado, D celular, E mail, I día1, J fin, K renovó, L LTV contratado, M LTV cobrado, O promesa, T próximo cobro,
    // U llamada agendada, V fecha de baja. SIN cortar la fila 1: "Fecha de baja" y "Satisfacción" se buscan por encabezado.
    { id: CLIENTES, range: 'Agencia!A1:Z', unformatted: true, conHeader: false },
    { id: CLIENTES, range: 'Consultora!A1:P', unformatted: true },
    { id: CLIENTES, range: 'Renovaciones!A1:G', unformatted: true },
    // Tracker de grabaciones: A cliente ("Guiones - X"), D día realizado, E grabación hecha, F fecha de grabación
    { id: GUIONES, range: "'Guiones para realizar'!A1:F1023", unformatted: true },
    // Pestaña "Cuentas Meta" del CRM: A cuenta, B cliente actual SI/NO, C nombre en el CRM
    { id: CLIENTES, range: "'Cuentas Meta'!A1:C120" },
    // Pestaña "Alias Guiones" del CRM: A alias del sheet de guiones, B nombre en el CRM
    { id: CLIENTES, range: "'Alias Guiones'!A1:B200" },
    // Pestaña "Recordatorios" del CRM: A fecha, B texto, C hecho (SI) — salen en el resumen de Discord
    { id: CLIENTES, range: "'Recordatorios'!A1:C300" },
    // Fotos diarias del semáforo operativo (las escribe el cron; ver lib/historialOperativo.ts)
    { id: VENTAS, range: "'Historial operativo'!A1:H", unformatted: true },
    // Las 4 hojas de closers (hasta col AB: situación, cash y reagendas) — FORMATTED (fecha como texto), SIN cortar la fila 1
    // ⚠️ El layout difiere entre pestañas (Closer 1/2 tienen "FUPs Show Up" extra que corre
    // "Situación del Lead" de la T a la U) — por eso las columnas volátiles se resuelven por header.
    // Hasta AI: "Llamada pre-call" (Efectiva / No efectiva) para la tasa del pre-call del Resumen
    ...CLOSER_TABS.map(({ tab }) => ({ id: VENTAS, range: `${tab}!A:AI`, conHeader: false })),
  ]

  // Fetch all data in parallel (Sheets agrupado + APIs externas con su propia caché)
  const hojasP = leerSheets(sheets, LECTURAS)
  // Índice CRM + "Cuentas Meta" apenas llegan las hojas: el filtro de ex-clientes se le pasa a
  // fetchMetaClientesEstado para que descarte cuentas ANTES de pedir insights (tope + rate limit)
  const iAgencia = LECTURAS.findIndex(l => l.range.startsWith('Agencia!'))
  const iCuentasMeta = LECTURAS.findIndex(l => l.range.startsWith("'Cuentas Meta'!"))
  const indiceP = hojasP.then(h => indiceClientes(h[iAgencia].slice(1), h[iCuentasMeta]))
  const [hojas, gaUsers, gaAgendasWeb, gaClicksAgendar, metaAds, clickup, metaClientes] = await Promise.all([
    hojasP,
    fetchGA4MonthlyUsers(),          // Visitantes del sitio (GA4) — leads VSL
    fetchGA4MonthlyAgendasWeb(),     // Agendas desde la web (GA4: /graciasporagendar)
    fetchGA4MonthlyClicksAgendar(),  // Clicks en el botón Agendar (GA4: evento click_agendar)
    fetchMetaAdsMonthly(),           // Gasto publicitario por embudo (Meta Marketing API)
    fetchClickUpSemaforo(),          // Semáforo de clientes (ClickUp)
    ligero
      ? Promise.resolve<MetaClientes>({ disponible: false, cuentas: [], total: 0 })   // versión ligera: no se pide (ver fetchRawData)
      : fetchMetaClientesEstado(indiceP.then(idx => idx.cuentaExcluida)),   // Estado de las cuentas Meta de los clientes (errores de pago / frenadas)
  ])
  const [pagoRows, erAll, leadsIGRows, seguidoresRows, setterRows, gastosRows, crmAgenciaTodo, crmConsultora, crmRenov,
    grabacionesRows, cuentasMetaRows, aliasGuionesRows, recordatoriosRows, historialRows, ...closerRows] = hojas
  // Agencia viene con la fila 1 (encabezados) para resolver columnas agregadas después (Fecha de baja, Satisfacción)
  const agenciaHeader = (crmAgenciaTodo[0] ?? []).map(h => normTxt(h))
  const crmAgencia = crmAgenciaTodo.slice(1)
  const closerSheets = closerRows.map(rows => rows.map(r => r.map(c => (c ?? '').toString())))

  const str = (c: Cell | undefined) => (c ?? '').toString()

  // Parse transactions
  const transactions: Transaction[] = pagoRows
    .filter(r => r[0] != null && r[4] != null)
    .map(r => {
      const date = parsePaymentDate(r[0])
      if (!date) return null
      return {
        date,
        dateStr: ymdLocal(date),   // día local 'YYYY-MM-DD' (nunca toISOString: corre el día según la zona)
        amount: amountFromCell(r[4]),
        closer: str(r[6]),
        category: categoriaPago(str(r[13]), str(r[14]), str(r[9]), str(r[15])),
        tipoVenta: str(r[13]).trim(),       // col N
        tipoPago: str(r[14]).trim(),        // col O
        concepto: str(r[9]).trim(),         // col J
        source: str(r[10]).trim(),          // col K = Fuente
        month: str(r[12]).trim().toLowerCase(),  // col M = Mes ("2026-mayo")
        product: str(r[1]),
        client: str(r[2]),
        phone: str(r[3]),
      }
    })
    .filter(Boolean) as Transaction[]

  // Unique closer names from transactions (Registro de Pagos col G)
  const closerNames = [...new Set(transactions.map(t => t.closer).filter(Boolean))].sort()

  // ── Estado de Resultados: cash, gastos y NFCF por mes ─────────────
  // Los valores de cada mes están en columnas pares (B=Ene, D=Feb...).
  // Buscamos cada fila por su etiqueta exacta en la columna A (primera ocurrencia).
  const normA = (v: unknown) => (v ?? '').toString().trim().toLowerCase()
  const erRowByLabel = (label: string) => erAll.find(r => normA(r[0]) === label.toLowerCase())
  const monthsOf = (row: Row | undefined) =>
    Array.from({ length: 12 }, (_, i) => (typeof row?.[2 * i + 1] === 'number' ? (row[2 * i + 1] as number) : 0))

  // Cash mensual = suma del Registro de Pagos por FECHA (misma fórmula que la fila "Cash Collected" del ER,
  // que dio idéntico ene–sep). No se lee del ER porque sus fórmulas usan "día 31" en meses de 30 días
  // (desde el 1/10 duplicaría esos pagos en septiembre y octubre). Si el Registro no se pudo leer, se usa el ER.
  const cashRegistro = Array.from({ length: 12 }, () => 0)
  for (const t of transactions) if (t.date.getFullYear() === YEAR) cashRegistro[t.date.getMonth()] += t.amount
  const monthlyCash = transactions.length > 0
    ? cashRegistro.map(v => Math.round(v * 100) / 100)
    : monthsOf(erRowByLabel('Cash Collected'))
  const monthlyCashOutRaw = monthsOf(erRowByLabel('Gastos Totales'))
  const monthlyNFCFRaw = monthsOf(erRowByLabel('Beneficios Netos'))
  const monthlyMargenRaw = monthsOf(erRowByLabel('% Beneficios Netos')).map(v => v * 100)
  // Gasto de adquisición = Anuncios + área Ventas + área Marketing (definición del usuario)
  const ventasArea = monthsOf(erRowByLabel('Ventas'))
  const mktArea    = monthsOf(erRowByLabel('Marketing'))
  // Costos de entrega del servicio (COGS) para el margen bruto del LTGP:
  // área Producto (entrega/fulfillment) + área Operaciones
  const productoArea    = monthsOf(erRowByLabel('Producto'))
  const operacionesArea = monthsOf(erRowByLabel('Operaciones'))
  // ── Anuncios por embudo ─────────────────────────────────────────────
  // FUENTE PRINCIPAL: Meta Marketing API (gasto real por campaña, clasificado
  // por nombre: VSL / FM / Webinar / Uruguay / Retargeting). Si Meta no
  // responde, fallback a la pestaña Gastos + split manual histórico.
  const zerosArr = () => Array.from({ length: 12 }, () => 0)
  let monthlyAdsVSL = zerosArr()
  let monthlyAdsRetargeting = zerosArr()   // embudo propio (NO está dentro de monthlyAdsVSL)
  let monthlyAdsFM = zerosArr()
  let monthlyAdsSinSeparar = zerosArr()
  let monthlyAdsWebinar = zerosArr()
  let monthlyAdsUruguay = zerosArr()

  const meta = metaAds as MetaAds | null
  if (meta) {
    monthlyAdsVSL = meta.vsl                      // solo VSL (sin retargeting)
    monthlyAdsRetargeting = meta.retargeting      // campañas con 'retarget' en el nombre
    monthlyAdsFM = meta.fm
    monthlyAdsWebinar = meta.webinar
    monthlyAdsUruguay = meta.uruguay
    monthlyAdsSinSeparar = meta.otros   // Hammer Them (pre-call) y campañas sin mapear
  } else {
    // Fallback: pestaña Gastos ("Anuncios VSL" | "Anuncios FM" | "Anuncios")
    for (const r of (gastosRows as Row[])) {
      const tipo = (r[3] ?? '').toString().toLowerCase()
      if (!tipo.includes('anuncio') && !tipo.includes('ads')) continue
      const d = parseGastoDate(r[0])
      if (!d || d.getFullYear() !== 2026) continue
      const m = d.getMonth()
      const monto = amountFromCell(r[2])
      if (tipo.includes('vsl')) monthlyAdsVSL[m] += monto
      else if (tipo.includes('fm')) monthlyAdsFM[m] += monto
      else if (tipo.includes('webi')) monthlyAdsWebinar[m] += monto
      else monthlyAdsSinSeparar[m] += monto
    }
    // Split manual histórico (provisto por el usuario el 12-jul-2026)
    // otros = Webinar; rtg = campaña "RETARGETING" (embudo propio). En mayo los $334,09
    // son la campaña genérica "RETARGETING" (no hubo gasto de Webinar ese mes).
    const ADS_SPLIT_OVERRIDES: Record<number, { fm: number; otros: number; rtg?: number }> = {
      2: { fm: 0, otros: 0 },
      4: { fm: 2012.46, otros: 0, rtg: 334.09 },
      5: { fm: 1925, otros: 1373 },
    }
    for (const [mStr, ov] of Object.entries(ADS_SPLIT_OVERRIDES)) {
      const m = parseInt(mStr)
      const pool = monthlyAdsSinSeparar[m]
      const rtg = ov.rtg ?? 0
      if (pool >= ov.fm + ov.otros + rtg) {
        monthlyAdsFM[m] += ov.fm
        monthlyAdsWebinar[m] += ov.otros
        monthlyAdsRetargeting[m] += rtg
        monthlyAdsVSL[m] += pool - ov.fm - ov.otros - rtg
        monthlyAdsSinSeparar[m] = 0
      }
    }
  }
  const monthlyAds = Array.from({ length: 12 }, (_, i) =>
    monthlyAdsVSL[i] + monthlyAdsFM[i] + monthlyAdsWebinar[i] + monthlyAdsUruguay[i] + monthlyAdsRetargeting[i] + monthlyAdsSinSeparar[i])
  const monthlyGastoAdq = Array.from({ length: 12 }, (_, i) => monthlyAds[i] + ventasArea[i] + mktArea[i])

  // ── ¿El ER del mes tiene los gastos completos? ──
  // Un mes con cash pero sin staff cargado (Ventas+Producto+Operaciones = 0), o con la fila de Anuncios
  // del ER en 0 mientras Meta sí gastó, da un NFCF/margen/CAC blended engañoso (sep-2026: margen 99,6%).
  // Anuncios del ER = el SUBTOTAL que sigue al bloque "GASTOS EN MARKETING" (si no se encuentra, no se chequea).
  const iBloqueMkt = erAll.findIndex(r => normA(r[0]) === 'gastos en marketing')
  const iAdsER = iBloqueMkt >= 0 ? erAll.findIndex((r, i) => i > iBloqueMkt && normA(r[0]) === 'subtotal') : -1
  const anunciosER = iAdsER >= 0 ? monthsOf(erAll[iAdsER]) : null
  const monthlyGastosCompletos: boolean[] = Array.from({ length: 12 }, (_, i) => {
    if (!(monthlyCash[i] > 0)) return true   // sin cash no hay nada que completar
    if (ventasArea[i] + productoArea[i] + operacionesArea[i] <= 0) return false
    if (meta && anunciosER && anunciosER[i] <= 0 && monthlyAds[i] > 0) return false
    return true
  })
  // Gasto mínimo para mostrar un FECCU:CAC: con $30 de ads el ratio da 900x y no dice nada
  const GASTO_MIN_RATIO = 300

  // FECCU por mes desde el Registro (por fecha real), total y por fuente/embudo
  const monthlyFECCU = zerosArr()
  // Clientes cuya agenda vino de la campaña Uruguay (col A de las hojas de
  // closers): sirve para clasificar sus pagos aunque la fuente del Registro
  // diga "VSL Funnel" (el Registro no distingue país, el closer sheet sí).
  // Normaliza nombres para matchear: minúsculas, sin acentos ni puntuación, espacios simples
  const normName = (s: unknown) => (s ?? '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  // Teléfono → clave de 7 dígitos (sufijo, robusto a prefijos de país/área); con varios números "a / b" toma el primero válido
  const digitsOf = (s: string) => s.replace(/\D/g, '')
  const telKeyOf = (s: unknown) => {
    const part = (s ?? '').toString().split('/').map(digitsOf).find(p => p.length >= 7)
    return part ? part.slice(-7) : ''
  }
  // Teléfono uruguayo: +598 y al menos 8 dígitos de abonado (el Registro a veces lo tiene sin el 598)
  const esTelUruguay = (s: unknown) => (s ?? '').toString().split('/').map(digitsOf).some(p => p.startsWith('598') && p.length >= 11)
  // Uruguay = agenda de la campaña Uruguay O lead con teléfono +598 (col B de closers): por nombre y por teléfono
  const uruguayClients = new Set<string>()
  const uruguayTels = new Set<string>()
  for (const rows of closerSheets) {
    for (const row of rows) {
      const campañaUY = classifyCanal(row) === 'uruguay', telUY = esTelUruguay(row[1])
      if (!campañaUY && !telUY) continue
      const n = normName(row[0])
      // por nombre: siempre para la campaña; para +598 solo nombre completo (≥2 palabras: "Gabriel" solo es ambiguo)
      if (n.length >= 5 && (campañaUY || n.includes(' '))) uruguayClients.add(n)
      if (telUY) { const k = telKeyOf(row[1]); if (k) uruguayTels.add(k) }
    }
  }
  const esClienteUruguay = (cliente: string, telefono = '') => {
    if (esTelUruguay(telefono)) return true               // Registro col D con +598
    const k = telKeyOf(telefono)
    if (k && uruguayTels.has(k)) return true              // mismo teléfono que una agenda +598
    const n = normName(cliente)
    if (n.length < 5) return false
    if (uruguayClients.has(n)) return true
    for (const u of uruguayClients) {
      if (u.length >= 8 && n.length >= 8 && (u.includes(n) || n.includes(u))) return true
    }
    return false
  }

  // ── Pagadores del Registro (todas las categorías) unificados por nombre + teléfono ──
  // Misma técnica que el matcheo de FECCU. Base del LTV del backend y de la regla "cliente real".
  interface LtvRec { total: number; months: Set<number>; pagos: { date: Date; amount: number }[]; noms: Set<string>; tels: Set<string>; txs: Transaction[] }
  const ltvRecs: LtvRec[] = []
  const ltvByNom = new Map<string, LtvRec>()
  const ltvByTel = new Map<string, LtvRec>()
  for (const t of transactions) {
    if (!(t.amount > 0)) continue
    const nom = normName(t.client)
    const tel = telKeyOf(t.phone)
    if (nom.length < 5 && !tel) continue   // sin forma de identificar al cliente
    let rec = (nom.length >= 5 ? ltvByNom.get(nom) : undefined) ?? (tel ? ltvByTel.get(tel) : undefined)
    if (!rec) { rec = { total: 0, months: new Set(), pagos: [], noms: new Set(), tels: new Set(), txs: [] }; ltvRecs.push(rec) }
    rec.total += t.amount
    rec.months.add(t.date.getMonth())
    rec.pagos.push({ date: t.date, amount: t.amount })
    rec.txs.push(t)
    if (nom.length >= 5) { ltvByNom.set(nom, rec); rec.noms.add(nom) }
    if (tel) { ltvByTel.set(tel, rec); rec.tels.add(tel) }
  }
  // Pagador del Registro de una persona (hoja de closer o CRM): teléfono (7 dígitos) → nombre exacto →
  // nombre contenido (≥8 letras), igual que buscarFeccuCliente
  const buscarPagador = (nombre: unknown, telefono: unknown): LtvRec | null => {
    for (const parte of (telefono ?? '').toString().split('/')) {
      const tel = telKeyOf(parte)
      const rec = tel ? ltvByTel.get(tel) : undefined
      if (rec) return rec
    }
    const n = normName(nombre)
    if (n.length < 5) return null
    const exacto = ltvByNom.get(n)
    if (exacto) return exacto
    if (n.length >= 8) for (const [cn, rec] of ltvByNom) if (cn.length >= 8 && (cn.includes(n) || n.includes(cn))) return rec
    return null
  }

  // ── Clientes reales vs "solo fee" (regla del usuario, 29/9/2026; umbral UMBRAL_CLIENTE_USD) ──
  // Vigentes del CRM (Agencia ACTIVO/PAUSADO) por teléfono y nombre: un vigente SIEMPRE es cliente real,
  // aunque todavía haya pagado poco (está arrancando).
  const indice = await indiceP
  const estadoFila = (r: Row) => (r[2] ?? '').toString().trim().toUpperCase()
  const telsDeCelda = (c: unknown) => (c ?? '').toString().split('/').map(p => telKeyOf(p)).filter(Boolean)
  const vigTels = new Set<string>(), vigNoms = new Set<string>()
  for (const r of crmAgencia) {
    if (!esVigente(estadoFila(r))) continue
    const n = normName(r[1]); if (n.length >= 5) vigNoms.add(n)
    for (const k of telsDeCelda(r[3])) vigTels.add(k)
  }
  // Match difuso contra un vigente (≥2 palabras en común con UN solo ACTIVO/PAUSADO) exigiendo además un
  // APELLIDO en común: palabra que no sea nombre de pila ni la primera del nombre del CRM. Sin esto,
  // "Gabriel Angel Delgado" (pagó $100 de fee) calzaba con el activo "Ángel Gabriel Díaz" por los nombres de pila.
  const vigentePorNombreDifuso = (nombre: unknown): boolean => {
    const c = indice.matchClientePorNombre((nombre ?? '').toString(), true)
    if (!c) return false
    const t = normTxt(nombre).split(' ')
    return c.tokens.some((tk, i) => i > 0 && tk.length >= 4 && !NOMBRES_DE_PILA.has(tk) && t.includes(tk))
  }
  const esClienteVigente = (nombre: unknown, telefono: unknown) =>
    telsDeCelda(telefono).some(k => vigTels.has(k)) || vigNoms.has(normName(nombre)) || vigentePorNombreDifuso(nombre)
  const pagadorVigente = (rec: LtvRec) =>
    [...rec.tels].some(k => vigTels.has(k)) || [...rec.noms].some(n => vigNoms.has(n) || vigentePorNombreDifuso(n))
  // Total de la PERSONA: el Registro a veces parte a un cliente en 2 nombres ("Maria Lujan Ponzio" fee $100 +
  // "Lujan Ponzio" PIF $2000; "Mariela Cabrera" fee + "Mariela Silvana Cabrera" cuota). Se agrupan los pagadores
  // cuyo nombre más corto (≥2 palabras) está contenido palabra por palabra en el otro, y el umbral se mide
  // sobre la suma del grupo (si no, el fee suelto de un cliente real quedaba como "solo fee").
  const grupoRec = new Map<LtvRec, LtvRec>(ltvRecs.map(r => [r, r]))
  const raiz = (r: LtvRec): LtvRec => { let x = r; while (grupoRec.get(x) !== x) x = grupoRec.get(x)!; return x }
  const palabrasRec = ltvRecs.map(r => [...r.noms].map(n => n.split(' ').filter(w => w.length >= 3)).filter(ws => ws.length >= 2))
  for (let i = 0; i < ltvRecs.length; i++)
    for (let j = i + 1; j < ltvRecs.length; j++)
      if (palabrasRec[i].some(a => palabrasRec[j].some(b => {
        const [corto, largo] = a.length <= b.length ? [a, b] : [b, a]
        return corto.every(w => largo.includes(w))
      }))) grupoRec.set(raiz(ltvRecs[i]), raiz(ltvRecs[j]))
  const totalGrupo = new Map<LtvRec, number>()
  for (const r of ltvRecs) totalGrupo.set(raiz(r), (totalGrupo.get(raiz(r)) ?? 0) + r.total)
  const totalPersona = (rec: LtvRec) => totalGrupo.get(raiz(rec)) ?? rec.total
  const grupoVigente = new Set<LtvRec>()
  for (const r of ltvRecs) if (pagadorVigente(r)) grupoVigente.add(raiz(r))
  // Pagador real = la persona pagó ≥ umbral en total (todas las categorías) o es cliente vigente del CRM
  const pagadorReal = (rec: LtvRec) => totalPersona(rec) >= UMBRAL_CLIENTE_USD || grupoVigente.has(raiz(rec))
  const ltvRecsReales = ltvRecs.filter(pagadorReal)
  for (const rec of ltvRecs) if (!pagadorReal(rec)) for (const t of rec.txs) t.noCliente = true

  // "No cliente" del CRM (Agencia): FINALIZADO/INACTIVO con LTV cobrado < umbral. Cobrado = col M
  // (numérica); si está vacía, el total del Registro matcheado por teléfono/nombre. Si el Registro muestra
  // MÁS que la col M se usa el Registro: la col M quedó vieja en clientes de enero (Ponzio: M = $100 con
  // $2.100 pagados). Una fila vieja de alguien que volvió (otra fila ACTIVO/PAUSADO con el mismo nombre o
  // teléfono) no es "no cliente".
  const cobradoFilaCRM = (r: Row): number => {
    const m = r[12]
    const colM = typeof m === 'number' ? m : m != null && m.toString().trim() !== '' ? amountFromCell(m) : 0
    const pagador = buscarPagador(r[1], r[3])
    return Math.max(colM, pagador ? totalPersona(pagador) : 0)
  }
  const esNoClienteCRM = (r: Row): boolean => {
    const estado = estadoFila(r)
    if (estado !== 'FINALIZADO' && estado !== 'INACTIVO') return false
    if (vigNoms.has(normName(r[1])) || telsDeCelda(r[3]).some(k => vigTels.has(k))) return false
    return cobradoFilaCRM(r) < UMBRAL_CLIENTE_USD
  }
  // Índice de los "no clientes" del CRM para las hojas de closers: teléfono, nombre exacto o ≥2 palabras
  // de 4+ letras en común (el lead "ivana Rodriguez Custiel" cargó otro teléfono que el del CRM)
  const noCliTels = new Set<string>(), noCliNoms = new Set<string>(), noCliTokens: string[][] = []
  for (const r of crmAgencia) {
    if (!(r[0] ?? '').toString().trim() || !esNoClienteCRM(r)) continue
    for (const k of telsDeCelda(r[3])) noCliTels.add(k)
    const n = normName(r[1]); if (n.length >= 5) noCliNoms.add(n)
    noCliTokens.push(n.split(' ').filter(w => w.length >= 4))
  }
  const esNoClienteLead = (nombre: unknown, telefono: unknown) => {
    if (telsDeCelda(telefono).some(k => noCliTels.has(k))) return true
    const n = normName(nombre)
    if (noCliNoms.has(n)) return true
    // ≥2 palabras en común y al menos una que no sea nombre de pila: un lead nuevo "Sergio Javier Gómez"
    // no puede quedar como "no cliente" por compartir los nombres con Sergio Javier Hernandez
    const t = n.split(' ').filter(w => w.length >= 4)
    return t.length >= 2 && noCliTokens.some(ct => {
      const comunes = t.filter(w => ct.includes(w))
      return comunes.length >= 2 && comunes.some(w => !NOMBRES_DE_PILA.has(w))
    })
  }

  // Atribución de FECCU por embudo — ESPEJO de classifyCanal (agendas). Se calcula MÁS ABAJO, después
  // de recorrer las hojas de closers (hace falta la fila de closer de cada cliente para el retargeting):
  //   Uruguay     = fuente dice "uruguay" O el cliente matchea una agenda Uruguay (prioridad)
  //   Retargeting = la fila de closer del cliente (cerrada; si no, la ocurrida más reciente) es canal retargeting
  //   Sin fila de closer (o fila de otro canal) → regla por fuente col K:
  //   FM/IG  = Inbound IG + BIO (link en bio)
  //   Webinar = fuente webinar (embudo propio, con sus propios ads)
  //   Fuera  = referidos, enrutamiento/wsp, outbound (embudos sin pauta)
  //   VSL    = VSL Funnel + sin fuente + sin clasificar (bug de tracking)
  const embudoPorFuente = (t: Transaction): Embudo => {
    const fuente = t.source.toLowerCase().trim()
    if (fuente.includes('uruguay') || esClienteUruguay(t.client, t.phone)) return 'uruguay'
    if (fuente.includes('inbound') || fuente.includes('bio')) return 'ig'
    if (fuente.includes('webi')) return 'webinar'
    if (fuente.includes('refe') || fuente.includes('referral')) return 'referido'
    if (fuente.includes('enrutamiento') || fuente.includes('wsp') || fuente.includes('outbound')) return 'otro'
    return 'vsl'
  }
  // FECCP y BECC (BECCU + BECCP) por fecha de pago — mismo criterio que monthlyFECCU
  const monthlyFECCP = zerosArr()
  const monthlyBECC = zerosArr()
  for (const t of transactions) {
    if (t.category === 'FECCP') monthlyFECCP[t.date.getMonth()] += t.amount
    else if (t.category === 'BECCU' || t.category === 'BECCP') monthlyBECC[t.date.getMonth()] += t.amount
  }
  for (const t of transactions) {
    // Embudo por fuente para todos los pagos; los FECCU se refinan con la fila de closer más abajo
    t.embudo = embudoPorFuente(t)
    if (t.category === 'FECCU') monthlyFECCU[t.date.getMonth()] += t.amount
  }

  // FECCU:CAC por embudo = FECCU del embudo ÷ ads de ese embudo (solo anuncios).
  // null cuando el gasto del embudo en el mes es < GASTO_MIN_RATIO (muestra chica o sin ads separados).
  const ratioSiGasto = (num: number, gasto: number) => (gasto >= GASTO_MIN_RATIO ? num / gasto : null)

  // Mes de ESCRITURA de una fila viva de ManyChat (Leads IG / Setter IG): máximo acumulado de la fecha en
  // orden de fila, con piso en el alta de la regla y techo en hoy. Devuelve un contador con estado: hay que
  // llamarlo UNA vez por fila, en orden. null = fila sin fecha o fuera de 2026.
  function mesDeEscritura(piso: Date) {
    const techo = nowArgentina()
    let max: Date = piso
    return (d: Date | null): number | null => {
      if (!d) return null
      if (d > max) max = d > techo ? techo : d
      return max.getFullYear() === YEAR ? max.getMonth() : null
    }
  }

  // ── Leads crudos ───────────────────────────────────────────────────
  // VSL: visitantes del sitio por mes (GA4).
  // IG: histórico manual (cols D/E: "2026-05" | cantidad) + filas en vivo de ManyChat
  //     (cols A/B, una por lead; la fecha es la de SUSCRIPCIÓN, no la del etiquetado).
  //
  // ⚠️ Sin corte, histórico y vivas se SOLAPAN: la regla de ManyChat empezó a escribir
  // el 11/07/2026 y el histórico ya cubría hasta esa fecha, así que sumar todo contaba
  // dos veces (y las filas con fecha anterior son re-etiquetados de contactos viejos,
  // ya incluidos en el histórico de su mes).
  //
  // Convención: el bloque histórico (D/E) es siempre el COMPLEMENTO — los leads que las
  // filas vivas NO cubren (porque la regla todavía no existía, o porque se cayó, como
  // pasó del 2 al 11 de agosto).
  //
  // Cada fila viva se cuenta en el mes en que se ESCRIBIÓ, no en el de su fecha (que es la
  // de SUSCRIPCIÓN del contacto: un contacto viejo re-etiquetado trae una fecha vieja y es un
  // lead nuevo del mes en que se etiquetó). ManyChat no escribe la fecha de escritura, así que
  // se aproxima con el MÁXIMO ACUMULADO de la fecha en orden de fila (las filas se agregan al
  // final), con piso en el alta de la regla (una fila no pudo escribirse antes de que existiera)
  // y techo en hoy. Ver mesDeEscritura().
  const REGLA_MANYCHAT_DESDE = new Date(2026, 6, 11)   // 11-jul-2026, alta de la regla de Leads IG
  const monthlyLeadsVSL = gaUsers as (number | null)[]
  const monthlyLeadsIG = Array.from({ length: 12 }, () => 0)
  const escrituraLeadsIG = mesDeEscritura(REGLA_MANYCHAT_DESDE)
  for (const r of (leadsIGRows as Row[])) {
    // Bloque histórico: D = mes ("2026-05" como texto, o fecha real si Sheets
    // la convirtió), E = cantidad
    let histMonth = -1
    if (typeof r[3] === 'number') {
      const d = serialToDate(r[3])
      if (d.getFullYear() === 2026) histMonth = d.getMonth()
    } else {
      const match = (r[3] ?? '').toString().trim().match(/^2026-(\d{1,2})/)
      if (match) histMonth = parseInt(match[1]) - 1
    }
    if (histMonth >= 0 && histMonth < 12) {
      const qty = typeof r[4] === 'number' ? r[4] : parseInt((r[4] ?? '0').toString()) || 0
      monthlyLeadsIG[histMonth] += qty
    }
    // Filas en vivo: A = fecha de suscripción → se cuentan en el mes de escritura
    const m = escrituraLeadsIG(parseLeadDate(r[0]))
    if (m != null) monthlyLeadsIG[m]++
  }

  // Seguidores nuevos de IG — mismo esquema que Leads IG (histórico D/E + filas en vivo)
  const monthlySeguidoresIG = Array.from({ length: 12 }, () => 0)
  for (const r of (seguidoresRows as Row[])) {
    let histMonth = -1
    if (typeof r[3] === 'number') {
      const d = serialToDate(r[3])
      if (d.getFullYear() === 2026) histMonth = d.getMonth()
    } else {
      const match = (r[3] ?? '').toString().trim().match(/^2026-(\d{1,2})/)
      if (match) histMonth = parseInt(match[1]) - 1
    }
    if (histMonth >= 0 && histMonth < 12) {
      const qty = typeof r[4] === 'number' ? r[4] : parseInt((r[4] ?? '0').toString()) || 0
      monthlySeguidoresIG[histMonth] += qty
    }
    const d = parseLeadDate(r[0])
    if (d && d.getFullYear() === 2026) monthlySeguidoresIG[d.getMonth()]++
  }

  // Asignados al setter (Maite) — mismo esquema: histórico D/E (agosto cargado a mano desde el
  // filtro ASIGNADO ∧ Lead - Agosto 26 de ManyChat) + filas en vivo de la regla "ASIGNADO → Sheets".
  // ⚠️ ManyChat deja la col A vacía y escribe la fecha en la col C ("Suscrito" = fecha de SUSCRIPCIÓN
  // del contacto, no de la asignación) → la fecha de la fila es la primera no vacía entre A y C, y la
  // fila se cuenta en su mes de ESCRITURA (máximo acumulado con piso en el alta de la regla, 8-sep-2026).
  const fechaFilaSetter = (r: Row) => (r[0] !== '' && r[0] != null ? r[0] : r[2])
  const REGLA_SETTER_DESDE = new Date(2026, 8, 8)   // 8-sep-2026, alta de la regla ASIGNADO → Sheets
  const escrituraSetter = mesDeEscritura(REGLA_SETTER_DESDE)
  const monthlyAsignadosSetter = Array.from({ length: 12 }, () => 0)
  const asignadosReales = Array.from({ length: 12 }, () => false)   // el mes tiene histórico D/E o filas vivas
  for (const r of (setterRows as Row[])) {
    let histMonth = -1
    if (typeof r[3] === 'number') {
      const d = serialToDate(r[3])
      if (d.getFullYear() === 2026) histMonth = d.getMonth()
    } else {
      const match = (r[3] ?? '').toString().trim().match(/^2026-(\d{1,2})/)
      if (match) histMonth = parseInt(match[1]) - 1
    }
    if (histMonth >= 0 && histMonth < 12) {
      const qty = typeof r[4] === 'number' ? r[4] : parseInt((r[4] ?? '0').toString()) || 0
      monthlyAsignadosSetter[histMonth] += qty
      if (qty > 0) asignadosReales[histMonth] = true
    }
    const m = escrituraSetter(parseLeadDate(fechaFilaSetter(r)))
    if (m != null) { monthlyAsignadosSetter[m]++; asignadosReales[m] = true }
  }

  // CPS (costo por seguidor) = Ads FM ÷ seguidores nuevos del mes (referencia histórica)
  const monthlyCPS: (number | null)[] = Array.from({ length: 12 }, (_, i) =>
    monthlyAdsFM[i] > 0 && monthlySeguidoresIG[i] > 0 ? monthlyAdsFM[i] / monthlySeguidoresIG[i] : null)

  // CPL Instagram OFICIAL (definición del usuario, 30-ago): COSTO POR SEGUIDOR estimado
  // = gasto FM ÷ (visitas al perfil que reporta Meta × tasa de seguimiento de IG).
  // La tasa (seguimientos ÷ visitas) se CALIBRA con el último mes que tenga seguidores reales
  // cargados (Seguidores IG D/E) y visitas de Meta: cambia mucho mes a mes (may 3%, jul 1,7%,
  // ago 0,86%) y una tasa fija vieja pinta el semáforo de verde sin motivo. Sin mes calibrable:
  // env IG_TASA_SEGUIMIENTO (default 1.7%, julio 2026).
  const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const { igTasaSeguimiento, igTasaFuente } = (() => {
    const pct = (t: number) => `${(t * 100).toFixed(2)}%`
    for (let i = 11; i >= 0; i--) {
      const visitas = metaAds?.fmResultados[i] ?? 0
      if (monthlySeguidoresIG[i] > 0 && visitas > 0) {
        const t = monthlySeguidoresIG[i] / visitas
        if (t > 0 && t < 1) return { igTasaSeguimiento: t, igTasaFuente: `calibrada con ${MESES_LARGOS[i]} (${pct(t)})` }
      }
    }
    const t = parseFloat(process.env.IG_TASA_SEGUIMIENTO ?? '')
    const env = isFinite(t) && t > 0 && t < 1
    const tasa = env ? t : 0.017
    return { igTasaSeguimiento: tasa, igTasaFuente: `${env ? 'fija (IG_TASA_SEGUIMIENTO)' : 'fija por defecto'} (${pct(tasa)})` }
  })()
  const monthlyCPLMetaFM: (number | null)[] = Array.from({ length: 12 }, (_, i) => {
    const gasto = metaAds?.fm[i] ?? 0, visitas = metaAds?.fmResultados[i] ?? 0
    return gasto > 0 && visitas > 0 ? gasto / (visitas * igTasaSeguimiento) : null
  })
  // CPL Instagram del tablero: real (seguimientos cargados a mano en "Seguidores IG") si existe;
  // si no, el estimado automático — así durante el mes nunca queda en "—" si hubo gasto FM.
  const monthlyCPLInstagram: (number | null)[] = monthlyCPS.map((real, i) => real ?? monthlyCPLMetaFM[i])
  const monthlyCPLInstagramEstimado: boolean[] = monthlyCPS.map((real, i) => real == null && monthlyCPLMetaFM[i] != null)

  // ── Métricas de ventas agregadas desde las hojas de closers ───────
  // Recorremos cada fila (llamada) de las 4 hojas, la ubicamos en su mes
  // por la columna D, y la clasificamos según las mismas reglas que usa el
  // Dashboard Ventas — pero incluyendo Closer 3 (que el sheet olvida sumar).
  // Filtramos solo llamadas con fecha válida, así descartamos filas de
  // encabezado/basura sin importar cuántas tenga cada hoja.
  const zeros = () => Array.from({ length: 12 }, () => 0)
  const monthlyAgendadas   = zeros()
  const monthlyAgendasSetter = zeros()   // agendas con col K "Setter" = mai (Maite)
  const monthlyCalificadas = zeros()
  const monthlyPresentadas = zeros()
  const monthlySinRegistro = zeros()   // ocurridas sin nada en "¿Se presentó?" (ni reagenda)
  const monthlyCerradas    = zeros()
  const monthlyCierresSoloFee = zeros()   // "cerradas" descartadas: el cliente pagó solo el fee (< UMBRAL_CLIENTE_USD)
  const monthlyVSL         = zeros()
  const monthlyRetargeting = zeros()   // agendas del embudo Retargeting (no suman en VSL ni en otras fuentes)
  const monthlyIG          = zeros()
  const monthlyOtrasFuentes = zeros()

  // FECCU total por cliente, indexado por NOMBRE (col C del Registro) y por TELÉFONO
  // (col D, sufijo de 7 dígitos — robusto a prefijos de país/área). Ambos índices apuntan
  // al mismo registro, así el FECCU de un cliente se atribuye a UNA sola llamada aunque
  // matchee por nombre en una fila y por teléfono en otra. La hoja del closer tiene
  // nombre en col A y número en col B.
  interface FeccuRec { cash: number; id: string }
  const recByNom = new Map<string, FeccuRec>()
  const recByTel = new Map<string, FeccuRec>()
  let recSeq = 0
  const recDeTx = new Map<Transaction, FeccuRec>()   // pago FECCU → registro del cliente (para atribuir su embudo)
  for (const t of transactions) {
    if (t.category !== 'FECCU') continue
    const nom = normName(t.client)
    const tel = telKeyOf(t.phone)
    let rec = (nom.length >= 5 ? recByNom.get(nom) : undefined) ?? (tel ? recByTel.get(tel) : undefined)
    if (!rec) rec = { cash: 0, id: 'rec' + recSeq++ }
    rec.cash += t.amount
    recDeTx.set(t, rec)
    if (nom.length >= 5) recByNom.set(nom, rec)
    if (tel) recByTel.set(tel, rec)
  }
  const buscarFeccuCliente = (nombre: unknown, telefono: unknown): FeccuRec | null => {
    const tel = telKeyOf(telefono)
    if (tel) {
      const rec = recByTel.get(tel)
      if (rec) return rec
    }
    const n = normName(nombre)
    if (n.length >= 5) {
      const exacto = recByNom.get(n)
      if (exacto) return exacto
      for (const [cn, rec] of recByNom) {
        if (cn.length >= 8 && n.length >= 8 && (cn.includes(n) || n.includes(cn))) return rec
      }
    }
    return null
  }
  // El FECCU de cada cliente se atribuye a UNA sola llamada, en dos pasadas: primero se recorren todas
  // las filas (hitDeLlamada[i] = registro FECCU que matchea la llamada i) y al final el cash va a la fila
  // CERRADA más reciente de ese cliente o, si no hay, a la más reciente ya ocurrida (no a la primera que
  // matchea en orden de pestañas: el cierre de abril en Gero quedaba en una agenda de marzo de Closer 1).
  const hitDeLlamada: (FeccuRec | null)[] = []
  const momentoLlamada: number[] = []

  const calls: Call[] = []
  const now = nowArgentina()
  for (let tabIdx = 0; tabIdx < closerSheets.length; tabIdx++) {
    const rows = closerSheets[tabIdx]
    const basePerson = CLOSER_TABS[tabIdx].person
    // Columnas volátiles resueltas por header (difieren entre pestañas)
    const header = (rows[0] ?? []).map(h => (h ?? '').toString().toLowerCase())
    const hFind = (needle: string, fallback: number) => {
      const i = header.findIndex(h => h.includes(needle))
      return i >= 0 ? i : fallback
    }
    // "¿Se presentó Agenda 1?" (Closer 1/2, Gero) | "¿Se presentó Call 1?" (Closer 3) — sin la de REAGENDA ni la Call 2
    const presIdx = header.findIndex(h => h.includes('se present') && !h.includes('reagenda') && (h.includes('agenda 1') || h.includes('call 1')))
    const presCol = presIdx >= 0 ? presIdx : 17        // R en todas hoy
    const reagCol = header.findIndex(h => h.includes('se present') && h.includes('reagenda'))   // T "¿Se presentó REAGENDA CALL 1?" (desde ago)
    const situCol = hFind('situaci', 19)              // T en Closer 3/Gero, U en Closer 1/2
    const tcCol   = hFind('cash collected trato cerrado', -1)  // Y en Closer 1/2, X en Closer 3/Gero
    const d1Col   = hFind('cash collected d', -1)               // "Cash Collected Día 1"
    const precallCol = hFind('llamada pre-call', 34)            // AI en las 6 pestañas
    for (const row of rows) {
      const parsed = parseCallDate(row[3])          // col D = Día y Fecha de la Call
      if (!parsed || parsed.date.getFullYear() !== YEAR) continue
      const { date, dateTime } = parsed
      const m = date.getMonth()
      const occurred = dateTime <= now
      // Closer 1 cambió de dueño a mitad de julio
      const person = CLOSER_TABS[tabIdx].tab === 'Closer 1' && dateTime >= CARLOS_DESDE ? 'Carlos'
        : CLOSER_TABS[tabIdx].tab === 'Closer 2' && dateTime >= MARCOS_DESDE ? 'Marcos'
        : CLOSER_TABS[tabIdx].tab === 'Closer 3' && dateTime >= YAMILA_DESDE ? 'Yami' : basePerson

      const scoring = (row[16] ?? '').toString().trim().toUpperCase()  // col Q = Lead Scoring
      const qualified = scoring === 'A' || scoring === 'B' || scoring === 'C'
      const presentoRaw = (row[presCol] ?? '').toString().trim().toLowerCase()  // ¿Se presentó Agenda/Call 1?
      const reagendaRaw = reagCol >= 0 ? (row[reagCol] ?? '').toString().trim().toLowerCase() : ''
      const esSi = (x: string) => x === 'si' || x === 'sí'
      // Presentada = se presentó a la agenda 1 o, si faltó, a la REAGENDA de la call 1
      const presented = esSi(presentoRaw) || esSi(reagendaRaw)
      // No-show = ocurrida, no presentada y col R = No o S1..S4 (faltó; los closers cargan el seguimiento ahí)
      const noShow = occurred && !presented && (presentoRaw === 'no' || /^s\d/.test(presentoRaw))
      const sinRegistro = occurred && presentoRaw === '' && reagendaRaw === ''
      const situacion = (row[situCol] ?? '').toString().trim().toLowerCase()   // Situación del Lead
      const situacionCerrada = situacion === 'cerrado en llamada' || situacion === 'cerrado en seguimiento'
      const channel = classifyCanal(row)
      const precallRaw = (row[precallCol] ?? '').toString().trim().toLowerCase()
      const precall = precallRaw === 'efectiva' || precallRaw === 'no efectiva' ? precallRaw : ''

      // Cash FECCU del cliente matcheado contra el Registro de Pagos (nombre o teléfono),
      // deduplicado para que el FECCU de cada cliente cuente una sola vez.
      const letra = letraLead(row[16])   // col Q = Lead Scoring (fórmula del CRM)
      const hit = buscarFeccuCliente(row[0], row[1])

      // "Cash Collected Trato Cerrado" y "Día 1" — los carga el closer en su hoja
      const tcRaw = tcCol >= 0 ? amountFromCell(row[tcCol]) : 0
      const cashTC = Number.isFinite(tcRaw) && tcRaw > 0 ? tcRaw : 0
      const d1Raw = d1Col >= 0 ? amountFromCell(row[d1Col]) : 0

      // CIERRE REAL = hubo plata del trato. Un "Cerrado" sin ningún cobro (ni TC, ni Día 1,
      // ni pago en el Registro) es un "sí" de palabra, no un cierre. Y un TC cargado cuenta
      // como cierre aunque la Situación diga otra cosa (ej. "Fee").
      const plataTrato = cashTC > 0 || d1Raw > 0 || (hit != null && hit.cash > 0)
      const cerradoBruto = (situacionCerrada && plataTrato) || cashTC > 0
      // SOLO FEE (regla del usuario, 29/9): el cierre cuenta solo si el cliente es REAL:
      //   · cliente ACTIVO/PAUSADO del CRM → siempre real (está arrancando)
      //   · "no cliente" del CRM (FINALIZADO/INACTIVO con < umbral cobrado) → NUNCA, aunque el closer haya
      //     cargado un TC: en esas filas el TC es el valor del contrato, no plata cobrada (Neumann TC $2.600, $0 cobrado)
      //   · si no está en el CRM (cierre reciente): cobrado total en el Registro ≥ umbral, o TC ≥ umbral
      // Si no es real, pagó el fee y no avanzó: no es un cierre (queda como presentada).
      let soloFee = false
      if (cerradoBruto) {
        const pagador = buscarPagador(row[0], row[1])
        const vigente = esClienteVigente(row[0], row[1]) || (pagador != null && grupoVigente.has(raiz(pagador)))
        const real = vigente || (!esNoClienteLead(row[0], row[1]) &&
          ((pagador ? totalPersona(pagador) : 0) >= UMBRAL_CLIENTE_USD || cashTC >= UMBRAL_CLIENTE_USD))
        soloFee = !real
      }
      const closed = cerradoBruto && !soloFee

      // Agregados mensuales (autoritativos para el modo "mes")
      monthlyAgendadas[m]++
      if ((row[10] ?? '').toString().trim().toLowerCase() === 'mai') monthlyAgendasSetter[m]++   // col K = Setter
      if (qualified) monthlyCalificadas[m]++
      if (presented) monthlyPresentadas[m]++
      if (sinRegistro) monthlySinRegistro[m]++
      if (closed) monthlyCerradas[m]++
      if (soloFee) monthlyCierresSoloFee[m]++
      if (channel === 'vsl') monthlyVSL[m]++
      else if (channel === 'retargeting') monthlyRetargeting[m]++
      else if (channel === 'ig') monthlyIG[m]++
      else monthlyOtrasFuentes[m]++

      // Llamada individual (para filtrar por fecha y por persona)
      hitDeLlamada.push(hit && hit.cash > 0 ? hit : null)
      momentoLlamada.push(+dateTime)
      calls.push({ date, closer: person, occurred, qualified, presented, closed, channel, letra, cash: 0, noShow, cashTC,
        setter: (row[10] ?? '').toString().trim().toLowerCase(),
        lead: (row[0] ?? '').toString().trim(),
        telefono: (row[1] ?? '').toString().trim(),
        hora: `${String(dateTime.getHours()).padStart(2, '0')}:${String(dateTime.getMinutes()).padStart(2, '0')}`,
        sinRegistro, precall, ...(soloFee ? { soloFee } : {}) })
    }
  }
  // Segunda pasada del cash FECCU: fila cerrada más reciente > ocurrida más reciente > la más reciente
  const destinoFeccu = new Map<string, number>()   // id del registro FECCU del cliente → índice de su llamada
  const prioridadLlamada = (i: number) => (calls[i].closed ? 2 : calls[i].occurred ? 1 : 0)
  hitDeLlamada.forEach((hit, i) => {
    if (!hit) return
    const j = destinoFeccu.get(hit.id)
    if (j == null || prioridadLlamada(i) > prioridadLlamada(j) ||
        (prioridadLlamada(i) === prioridadLlamada(j) && momentoLlamada[i] > momentoLlamada[j])) destinoFeccu.set(hit.id, i)
  })
  for (const i of destinoFeccu.values()) calls[i].cash = hitDeLlamada[i]!.cash

  // ── FECCU por embudo (ver la regla arriba, en embudoPorFuente) ──
  // El cliente se atribuye por su fila de closer CERRADA (si no hay, la más reciente ya ocurrida; una
  // agenda futura no cuenta) — la misma que recibe el cash por llamada. Uruguay conserva la prioridad.
  const monthlyFeccuVSL = zerosArr()
  const monthlyFeccuFM = zerosArr()
  const monthlyFeccuWebinar = zerosArr()
  const monthlyFeccuUruguay = zerosArr()
  const monthlyFeccuRetargeting = zerosArr()
  for (const t of transactions) {
    if (t.category !== 'FECCU') continue
    const m = t.date.getMonth()
    if (t.embudo !== 'uruguay') {
      const rec = recDeTx.get(t)
      const i = rec ? destinoFeccu.get(rec.id) : undefined
      if (i != null && prioridadLlamada(i) >= 1 && calls[i].channel === 'retargeting') t.embudo = 'retargeting'
    }
    if (t.embudo === 'uruguay') monthlyFeccuUruguay[m] += t.amount
    else if (t.embudo === 'retargeting') monthlyFeccuRetargeting[m] += t.amount
    else if (t.embudo === 'ig') monthlyFeccuFM[m] += t.amount
    else if (t.embudo === 'webinar') monthlyFeccuWebinar[m] += t.amount
    else if (t.embudo === 'vsl') monthlyFeccuVSL[m] += t.amount
    // referido / otro: embudos sin pauta, sin atribuir
  }
  const monthlyFeccuCacVSL: (number | null)[] = Array.from({ length: 12 }, (_, i) => ratioSiGasto(monthlyFeccuVSL[i], monthlyAdsVSL[i]))
  const monthlyFeccuCacRetargeting: (number | null)[] = Array.from({ length: 12 }, (_, i) => ratioSiGasto(monthlyFeccuRetargeting[i], monthlyAdsRetargeting[i]))
  const monthlyFeccuCacFM: (number | null)[] = Array.from({ length: 12 }, (_, i) => ratioSiGasto(monthlyFeccuFM[i], monthlyAdsFM[i]))
  const monthlyFeccuCacWebinar: (number | null)[] = Array.from({ length: 12 }, (_, i) => ratioSiGasto(monthlyFeccuWebinar[i], monthlyAdsWebinar[i]))
  const monthlyFeccuCacUruguay: (number | null)[] = Array.from({ length: 12 }, (_, i) => ratioSiGasto(monthlyFeccuUruguay[i], monthlyAdsUruguay[i]))

  // % de agenda del setter = agendas de Maite ÷ asignados por ManyChat (definición del usuario, 8-sep).
  // null si el mes no tiene asignados reales (ni histórico D/E ni filas vivas: antes de agosto no se
  // medía) o si hay menos asignados que agendas (el denominador no cubre el mes).
  const monthlyTasaAgendaSetter: (number | null)[] = Array.from({ length: 12 }, (_, i) =>
    asignadosReales[i] && monthlyAsignadosSetter[i] > 0 && monthlyAsignadosSetter[i] >= monthlyAgendasSetter[i]
      ? monthlyAgendasSetter[i] / monthlyAsignadosSetter[i] : null)

  // ── Enrutamiento del DÍA ANTERIOR (reporte Discord de las 8:05) ──────
  // Entrada: filas vivas de Leads IG / Setter IG por fecha (los históricos D/E no tienen
  // día). Llamadas: filas de closers cuya fecha de call es AYER, con el setter que la
  // agendó (col K). Leads no asignados: cruce por "ID contacto" (Leads IG col F vs Setter IG col G).
  const hoyE = nowArgentina(); hoyE.setHours(0, 0, 0, 0)
  const diaE = new Date(hoyE); diaE.setDate(diaE.getDate() - 1)      // ayer
  const previoE = new Date(hoyE); previoE.setDate(previoE.getDate() - 2)   // antier
  const mismoDia = (d: Date | null, ref: Date) =>
    !!d && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
  const cuentaDia = (rows: Row[], fechaDe: (r: Row) => unknown) => {
    let dia = 0, previo = 0
    for (const r of rows) { const d = parseLeadDate(fechaDe(r)); if (mismoDia(d, diaE)) dia++; else if (mismoDia(d, previoE)) previo++ }
    return { dia, previo }
  }
  const mesE = diaE.getMonth()
  const leadsDia = cuentaDia(leadsIGRows as Row[], r => r[0]), asigDia = cuentaDia(setterRows as Row[], fechaFilaSetter)
  const idsAsignados = new Set((setterRows as Row[]).map(r => (r[6] ?? '').toString().trim()).filter(Boolean))
  // Solo se puede cruzar desde el momento en que Setter IG empezó a guardar IDs (10/9/2026):
  // un lead anterior a eso no tiene contra qué compararse y quedaría como "no asignado" por error.
  let desdeIds: number | null = null
  for (const r of (setterRows as Row[])) {
    if (!(r[6] ?? '').toString().trim()) continue
    const s = fechaFilaSetter(r)
    if (typeof s === 'number' && (desdeIds == null || s < desdeIds)) desdeIds = s
  }
  const identificados: LeadIGRow[] = []
  for (const r of (leadsIGRows as Row[])) {
    if (!mismoDia(parseLeadDate(r[0]), diaE)) continue
    const id = (r[5] ?? '').toString().trim()
    if (!id || idsAsignados.has(id)) continue
    if (desdeIds == null || typeof r[0] !== 'number' || r[0] < desdeIds) continue
    identificados.push({ nombre: (r[1] ?? '').toString().trim(), usuario: (r[2] ?? '').toString().trim().replace(/^@/, ''), id })
  }
  const llamadasDia = calls.filter(c => mismoDia(c.date, diaE))
  const porCloser: Enrutamiento['llamadas']['porCloser'] = {}
  const porSetter: Record<string, number> = {}
  const lista: Enrutamiento['llamadas']['lista'] = []
  for (const c of llamadasDia) {
    if (!porCloser[c.closer]) porCloser[c.closer] = { agendadas: 0, presentadas: 0, noShow: 0, cierres: 0, pendientes: 0, sinRegistro: 0 }
    const p = porCloser[c.closer]
    p.agendadas++
    if (c.presented) p.presentadas++
    if (c.noShow) p.noShow++
    if (c.closed) p.cierres++
    if (!c.occurred) p.pendientes++
    if (c.sinRegistro) p.sinRegistro++
    const s = c.setter === 'mai' ? 'setter' : c.setter === 'ig' ? 'ig' : c.setter.startsWith('fb') ? 'fb' : 'otro'   // "fb-sitelink" cuenta como fb
    porSetter[s] = (porSetter[s] ?? 0) + 1
    lista.push({ lead: c.lead, telefono: c.telefono, closer: c.closer, hora: c.hora, setter: s,
      estado: c.closed ? 'cerrada' : c.presented ? 'presentada' : c.noShow ? 'no-show' : c.sinRegistro ? 'sin registro' : 'pendiente' })
  }
  lista.sort((a, b) => a.hora.localeCompare(b.hora))
  const enrutamiento: Enrutamiento = {
    dia: `${diaE.getFullYear()}-${String(diaE.getMonth() + 1).padStart(2, '0')}-${String(diaE.getDate()).padStart(2, '0')}`,
    leadsIG: { dia: leadsDia.dia, previo: leadsDia.previo, mes: monthlyLeadsIG[mesE] },
    asignados: { dia: asigDia.dia, previo: asigDia.previo, mes: monthlyAsignadosSetter[mesE] },
    noAsignados: { total: Math.max(leadsDia.dia - asigDia.dia, identificados.length), identificados },
    agendasSetterDia: llamadasDia.filter(c => c.setter === 'mai').length,
    agendasSetterMes: monthlyAgendasSetter[mesE],
    tasaAgendaSetterMes: monthlyTasaAgendaSetter[mesE],
    agendasMes: monthlyAgendadas[mesE],
    llamadas: { total: llamadasDia.length, porCloser, porSetter, lista },
  }

  // ── NFCF automático por mes (null = dato no cargado, se muestra "—") ──
  // Un mes "sin gastos cargados" (Gastos Totales = 0) o con gastos INCOMPLETOS (monthlyGastosCompletos)
  // no tiene NFCF/Margen/CAC blended confiables. El Cash Out conserva el valor parcial (la UI lo rotula).
  const monthlyCashOut: (number | null)[] = monthlyCashOutRaw.map(v => (v > 0 ? v : null))
  const monthlyNFCF: (number | null)[] = monthlyCashOutRaw.map((out, i) => (out > 0 && monthlyGastosCompletos[i] ? monthlyNFCFRaw[i] : null))
  const monthlyMargen: (number | null)[] = monthlyCashOutRaw.map((out, i) => (out > 0 && monthlyGastosCompletos[i] ? monthlyMargenRaw[i] : null))
  const monthlyCAC: (number | null)[] = Array.from({ length: 12 }, (_, i) =>
    monthlyGastosCompletos[i] && monthlyGastoAdq[i] > 0 && monthlyCerradas[i] > 0 ? monthlyGastoAdq[i] / monthlyCerradas[i] : null)
  const monthlyCACAds: (number | null)[] = Array.from({ length: 12 }, (_, i) =>
    monthlyAds[i] > 0 && monthlyCerradas[i] > 0 ? monthlyAds[i] / monthlyCerradas[i] : null)
  // FECCU:CAC general = FECCU total ÷ SOLO anuncios (sin sueldos de equipos).
  // Pedido del mentor: sobre primer pago (FECCU) y sobre inversión publicitaria.
  // Con ads ≥ $300 y FECCU 0, el ratio es 0.00x (dato real), no "—" (consistente con los por-embudo)
  const monthlyFeccuCac: (number | null)[] = Array.from({ length: 12 }, (_, i) => ratioSiGasto(monthlyFECCU[i], monthlyAds[i]))
  // FECCU:CAC blended = FECCU total ÷ TODO el gasto de adquisición (ads + Ventas + Marketing); null si faltan gastos del ER
  const monthlyFeccuCacBlended: (number | null)[] = Array.from({ length: 12 }, (_, i) =>
    monthlyGastosCompletos[i] ? ratioSiGasto(monthlyFECCU[i], monthlyGastoAdq[i]) : null)

  // ── BACKEND: LTV / LTGP / Churn ────────────────────────────────────
  // LTV = total pagado por cliente (todas las categorías), cliente unificado por
  // nombre + teléfono con la misma técnica que el matcheo de FECCU.
  // (ltvRecs se arma arriba, junto con la regla de cliente real: acá solo cuentan los pagadores reales)
  const clientesUnicos = ltvRecsReales.length
  const ingresosClientes = ltvRecsReales.reduce((s, r) => s + r.total, 0)
  const ltv = clientesUnicos > 0 ? ingresosClientes / clientesUnicos : null

  // Margen bruto = 1 − COGS/Cash, solo meses con COGS cargado (Producto + Operaciones > 0): un mes
  // con el staff sin cargar (sep-2026) entraba con costo de entrega 0 e inflaba el margen.
  let cogsSum = 0, cashConGastos = 0
  for (let i = 0; i < 12; i++) {
    if (productoArea[i] + operacionesArea[i] > 0 && monthlyCash[i] > 0) {
      cogsSum += productoArea[i] + operacionesArea[i]
      cashConGastos += monthlyCash[i]
    }
  }
  const margenBruto = cashConGastos > 0 ? 1 - cogsSum / cashConGastos : null

  // CAC blended promedio del año (Σ gasto adquisición ÷ Σ cierres), solo meses con cierres (ene–feb
  // no tienen hojas de closers: su gasto sin cierres inflaba el promedio)
  let adqSum = 0, cierresAdq = 0
  for (let i = 0; i < 12; i++) {
    if (monthlyGastoAdq[i] > 0 && monthlyCerradas[i] > 0) { adqSum += monthlyGastoAdq[i]; cierresAdq += monthlyCerradas[i] }
  }
  const cacPromedio = cierresAdq > 0 ? adqSum / cierresAdq : null
  // (LTGP y LTGP:CAC se calculan más abajo, con el LTV cobrado del CRM)

  // Churn mensual APROXIMADO por pagos: % de clientes que pagaron en el mes m-1
  // y no pagaron en m. Incluye clientes que terminaron su plan de cuotas (limitación
  // conocida: sin fechas de fin de programa no se distingue "terminó" de "se fue").
  const nowMonth = nowArgentina().getMonth()
  const monthlyChurn: (number | null)[] = Array.from({ length: 12 }, (_, m) => {
    if (m === 0 || m >= nowMonth) return null   // mes en curso: transición incompleta
    const activosPrev = ltvRecsReales.filter(r => r.months.has(m - 1))
    if (activosPrev.length < 3) return null     // muestra demasiado chica
    const perdidos = activosPrev.filter(r => !r.months.has(m)).length
    return (perdidos / activosPrev.length) * 100
  })

  // ── CRM Clientes 2.0 (si está conectado): churn REAL, semáforo, renovación, éxito ──
  // SOLO AGENCIA (pedido del usuario): los clientes de Consultora quedan fuera de todas las métricas.
  const crmClientesTodos = crmAgencia.filter(r => (r[0] ?? '').toString().trim())
  void crmConsultora
  const crmDisponible = crmClientesTodos.length > 0
  // "No clientes" (pagaron solo el fee, ver esNoClienteCRM) FUERA de todo: activos/pausados, semáforo,
  // alertas, renovación, éxito, LTV contratado/cobrado y el modelo stock-flujo (nuevos, bajas, churn).
  const crmNoClientes = crmClientesTodos.filter(esNoClienteCRM)
  const idsNoClientes = new Set(crmNoClientes.map(r => (r[0] ?? '').toString().trim()))
  const crmClientes = crmClientesTodos.filter(r => !esNoClienteCRM(r))
  // Churn real = bajas del mes ÷ clientes activos al inicio del mes (definición clásica)
  const crmChurnRenov = zeros()          // renovaciones PAGAS arrancadas en el mes
  let crmActivos = 0, crmPausados = 0, crmRenovadores = 0, crmNoRenovaron = 0
  let semVerde = 0, semAmarillo = 0, semRojo = 0, semSinFecha = 0
  let exitoSi = 0, exitoTotal = 0, satisfSum = 0, satisfN = 0, ltvCrmSum = 0, ltvCrmN = 0, ltvCobSum = 0, ltvCobN = 0
  const hoy = nowArgentina(); hoy.setHours(0, 0, 0, 0)
  const en14dias = new Date(hoy); en14dias.setDate(en14dias.getDate() + 14)
  // ── Índice de clientes del CRM (Agencia) para cruzar grabaciones y cuentas Meta (ver indiceClientes) ──
  // (los "no clientes" siguen en el índice a propósito: son FINALIZADO/INACTIVO, así que sus cuentas Meta
  // quedan excluidas como de ex-cliente y sus grabaciones se saltean; sacarlos del índice las dejaría "sin cliente")
  const { crmPorNombre, clientesCRMIdx, matchClientePorNombre, clienteDeCuenta, cuentaExcluida } = indice
  void cuentasMetaRows   // "Cuentas Meta" se procesa en indiceClientes

  // Estado de ClickUp por nombre (≥2 palabras de 4+ letras en común, como enProduccion).
  // Si hay varias tareas (ej. una vieja "final del servicio" y una nueva), gana la de más
  // palabras en común y, a igualdad, la que NO está finalizada.
  const tareasCU = (clickup as ClickUpSemaforo).tareas.map(t => ({ ...t, tokens: normTxt(t.nombre).split(' ').filter(x => x.length >= 4) }))
  const estadoClickUpDe = (nombre: string): string | null => {
    const t = normTxt(nombre).split(' ').filter(x => x.length >= 4)
    if (t.length < 2) return null
    let mejor: { status: string; n: number } | null = null
    for (const tc of tareasCU) {
      const n = t.filter(x => tc.tokens.includes(x)).length
      if (n < 2) continue
      if (!mejor || n > mejor.n || (n === mejor.n && mejor.status === 'final del servicio' && tc.status !== 'final del servicio'))
        mejor = { status: tc.status, n }
    }
    return mejor?.status ?? null
  }

  // ── Tracker de grabaciones por cliente (pestaña "Guiones para realizar") ──
  //   A "Guiones - Alias" · D "Día realizado" (en la práctica: guiones listos; en filas grabadas a veces
  //   el equipo cargó ahí la fecha de grabación) · E "Grabación hecha?": X/✓ = grabado, una fecha =
  //   grabado ESE día, otro texto = nota (no grabado) · F "Fecha de grabación" explícita.
  //   Una fecha FUTURA (en E o F) = grabación agendada: no cuenta como grabada (nota "agendada D/M").
  const hoyGrab = nowArgentina(); hoyGrab.setHours(0, 0, 0, 0)
  const diasDesde = (d: Date) => Math.max(0, Math.round((+hoyGrab - +d) / 86_400_000))
  // Fecha de celda del sheet de guiones: serial, "24/09" (año actual), "31/8/2026", "18/09/26" o ISO
  const fechaGuion = (cell: unknown): Date | null => {
    if (typeof cell === 'number') return cell > 40000 && cell < 60000 ? serialToDate(cell) : null
    const t = (cell ?? '').toString().trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return parseLeadDate(t)
    const m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/)
    if (!m) return null
    const d = parseInt(m[1]), mes = parseInt(m[2])
    if (d < 1 || d > 31 || mes < 1 || mes > 12) return null
    let y = m[3] ? parseInt(m[3]) : hoyGrab.getFullYear()
    if (y < 100) y += 2000
    const f = new Date(y, mes - 1, d)
    // sin año y más de un mes en el futuro → es del año pasado
    if (!m[3] && +f - +hoyGrab > 31 * 86_400_000) f.setFullYear(y - 1)
    return f
  }
  const MARCA_GRABADO = /^(x+|✓|✔|✔️|si|sí|ok|listo|hecho|grabado)$/i
  const NOTA_INACTIVA = /\bno\s+(mandar|enviar|grabar)\b|\bpausa|\bbaja\b/i
  // Alias del sheet de guiones → nombre del CRM: 1) pestaña "Alias Guiones"; 2) match difuso SOLO si
  // hay un único cliente ACTIVO/PAUSADO que calza: "CarlosE" = nombre Carlos + algún apellido con E,
  // "GiseV" = nombre que empieza con Gise + apellido con V, "Enzo" = único cliente llamado Enzo.
  const aliasMap = new Map<string, string>()
  for (const r of (aliasGuionesRows as Row[])) if ((r[0] ?? '').toString().trim() && (r[1] ?? '').toString().trim()) aliasMap.set(normTxt(r[0]), (r[1] ?? '').toString().trim())
  const resolverAlias = (alias: string): ClienteCRM | null => {
    const porTabla = aliasMap.get(normTxt(alias))
    if (porTabla) return crmPorNombre.get(normTxt(porTabla)) ?? matchClientePorNombre(porTabla)
    const m = alias.replace(/\s+/g, '').match(/^([A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]{2,})([A-ZÁÉÍÓÚÑ]{0,2})$/)
    if (!m || (!m[2] && m[1].length < 4)) return null
    const nom = normTxt(m[1]), iniciales = normTxt(m[2]).split('')
    const hits = clientesCRMIdx.filter(c => {
      if (!esVigente(c.estado)) return false
      const i = c.tokens.findIndex(tk => tk.startsWith(nom))
      if (i < 0) return false
      let desde = i + 1   // cada inicial = un apellido posterior al nombre, en orden
      for (const ini of iniciales) {
        const j = c.tokens.findIndex((tk, k) => k >= desde && tk.startsWith(ini))
        if (j < 0) return false
        desde = j + 1
      }
      return true
    })
    return hits.length === 1 ? hits[0] : null
  }
  interface FilaGuion { d: Date | null; grabado: boolean; exacta: Date | null; nota: string | null }
  const filasPorCliente = new Map<string, { cliente: string; aliasSinResolver: boolean; filas: FilaGuion[] }>()
  for (const r of (grabacionesRows as Row[])) {
    const alias = (r[0] ?? '').toString().replace(/^\s*guiones\s*-\s*/i, '').trim()
    if (!alias) continue
    const cli = resolverAlias(alias)
    if (cli && !esVigente(cli.estado)) continue   // FINALIZADO / INACTIVO: ya no es cliente
    const cliente = cli?.nombre ?? alias
    const eTxt = typeof r[4] === 'number' ? '' : (r[4] ?? '').toString().trim()
    // "X 24/09", "✓ 18/9", "grabado 3/9": marca + fecha en el mismo texto
    const marca = MARCA_GRABADO.test(eTxt) || /^(x|✓|✔)(\s|$|[-:,(])/i.test(eTxt) || /^grabad/i.test(eTxt)
    const fechaEnTexto = marca ? eTxt.match(/\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?/)?.[0] : undefined
    const eFecha = fechaGuion(r[4]) ?? (fechaEnTexto ? fechaGuion(fechaEnTexto) : null)
    const fFecha = fechaGuion(r[5])
    // Fecha FUTURA en E o F = grabación AGENDADA, todavía no hecha: la fila sigue sin grabar
    // (sus guiones quedan pendientes) y se muestra como nota "agendada 30/9"
    const agendada = [eFecha, fFecha].filter((f): f is Date => !!f && f > hoyGrab).sort((a, b) => +a - +b)[0] ?? null
    const exacta = agendada ? null : fFecha && eFecha ? (fFecha > eFecha ? fFecha : eFecha) : fFecha ?? eFecha
    const grabado = !agendada && (marca || !!eFecha || !!fFecha)
    const nota = agendada ? `agendada ${agendada.getDate()}/${agendada.getMonth() + 1}` : !grabado && eTxt ? eTxt : null
    const fila: FilaGuion = { d: fechaGuion(r[3]), grabado, exacta, nota }
    const k = normTxt(cliente)
    const acc = filasPorCliente.get(k) ?? { cliente, aliasSinResolver: !cli, filas: [] }
    acc.filas.push(fila)
    filasPorCliente.set(k, acc)
  }
  const maxFecha = (fs: (Date | null)[]) => fs.reduce<Date | null>((mx, f) => (f && (!mx || f > mx) ? f : mx), null)
  const grabaciones: GrabacionCliente[] = [...filasPorCliente.values()].map(({ cliente, aliasSinResolver, filas }) => {
    const grabado = filas.some(f => f.grabado)
    const exacta = maxFecha(filas.map(f => f.exacta))
    const aprox = exacta ? null : maxFecha(filas.filter(f => f.grabado).map(f => f.d))
    const ultima = exacta ?? aprox
    // Guiones listos todavía sin grabar: col D de la fila sin grabar más reciente, posterior a la última grabación
    const pendientes = filas.filter(f => !f.grabado && f.d && (!ultima || f.d > ultima))
    const listos = maxFecha(pendientes.map(f => f.d))
    const conNota = [...pendientes, ...filas.filter(f => !f.grabado)].find(f => f.nota)
    // Nota de "no mandar / no grabar / pausa / baja" en una fila sin grabar = cliente frenado a propósito:
    // no es urgencia ni "guiones esperando" (Dario Cova: programa vencido, E = "no mandar")
    const inactiva = filas.some(f => !f.grabado && !!f.nota && NOTA_INACTIVA.test(f.nota))
    return {
      cliente,
      ultimaGrabacion: ultima ? ymdLocal(ultima) : null,
      fechaAproximada: !exacta && !!aprox,
      diasDesdeGrabacion: ultima ? diasDesde(ultima) : null,
      grabado,
      guionesListos: listos ? ymdLocal(listos) : null,
      diasEsperando: listos ? diasDesde(listos) : null,
      nota: conNota?.nota ?? null,
      estadoClickUp: estadoClickUpDe(cliente),
      aliasSinResolver,
      ultimoGuion: (() => { const u = maxFecha(filas.map(f => f.d)); return u ? ymdLocal(u) : null })(),
      fechasGuiones: filas.filter(f => f.d).map(f => ymdLocal(f.d as Date)).sort(),
      ...(inactiva ? { inactiva } : {}),
    }
  })
  // Más urgente primero: lo que más días lleva esperando (guiones listos sin grabar) o sin grabar;
  // después los que nunca grabaron ni tienen guiones listos, y al final los grabados sin fecha.
  // Las inactivas (nota "no mandar"/"pausa"…) van al final, fuera del ranking.
  const urgencia = (g: GrabacionCliente) => Math.max(g.diasEsperando ?? -1, g.diasDesdeGrabacion ?? -1)
  grabaciones.sort((a, b) => Number(!!a.inactiva) - Number(!!b.inactiva) || urgencia(b) - urgencia(a) || Number(a.grabado) - Number(b.grabado) || a.cliente.localeCompare(b.cliente))

  // ── Cuentas Meta: filtrar ex-clientes y cruzar con el CRM ──
  //   · fuera: col B = NO en la pestaña "Cuentas Meta" (solo match EXACTO de nombre o id) o cliente del CRM FINALIZADO / INACTIVO
  //   · cliente del CRM = col C de "Cuentas Meta" (exacta o difusa contra filas SI) o match por nombre de la cuenta / del Business Manager
  //   · error de pago + cliente PAUSADO = pausa a propósito, no alarma (pausadoCRM)
  const norm = (x: unknown) => (x ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  const mc = metaClientes as MetaClientes
  // Clientes en producción en ClickUp (onboarding → creación de campaña): su cuenta sin gasto
  // NO está "frenada", todavía no lanzó. Se cruza el nombre del CLIENTE del CRM (o, si la cuenta no
  // tiene cliente, el de la cuenta) contra las tareas en producción y se exige un APELLIDO en común
  // (palabra de 4+ letras que no sea nombre de pila ni genérica): "José María Gallardo" NO calza con
  // "María José Molina". Con 2+ palabras en común alcanza un apellido; con UNA sola, tiene que ser un
  // apellido de 5+ letras que esté en una única tarea en producción ("Geraldine Frezza" ↔ "Andrea Frezza").
  const tokensProd = (clickup as ClickUpSemaforo).produccionDetalle.map(p => normTxt(p.nombre).split(' ').filter(t => t.length >= 4))
  const esApellido = (x: string) => !NOMBRES_DE_PILA.has(x) && !PALABRAS_GENERICAS.has(x)
  const enProduccion = (nombre: string) => {
    const t = [...new Set(normTxt(nombre).split(' ').filter(x => x.length >= 4))]
    return tokensProd.some(pt => {
      const comunes = t.filter(x => pt.includes(x))
      const apellidos = comunes.filter(esApellido)
      if (!apellidos.length) return false
      if (comunes.length >= 2) return true
      return apellidos[0].length >= 5 && tokensProd.filter(o => o.includes(apellidos[0])).length === 1
    })
  }
  // (fetchMetaClientesEstado ya sacó los ex-clientes antes de pedir insights; se re-aplica por si el
  // filtro no le llegó —falló la lectura de hojas— o devolvió el último resultado bueno ante un error)
  const cuentasFiltradas = mc.cuentas
    .filter(c => !esCuentaPropia(c.id) && !cuentaExcluida(c))
    .map(c => ({ c, ...clienteDeCuenta(c) }))
    .map(({ c, colC, crm, estado }) => {
      const pausadoCRM = estado === 'PAUSADO'
      const enOnboarding = enProduccion(crm?.nombre || colC || c.nombre)
      const sinCliente = !crm && !colC
      return {
        ...c,
        ...(pausadoCRM ? { pausadoCRM } : {}),
        ...(enOnboarding ? { enOnboarding } : {}),
        ...(crm || colC ? { clienteCRM: crm?.nombre ?? colC } : {}),
        ...(sinCliente ? { sinCliente } : {}),
        ...(crm?.telefono ? { telefono: crm.telefono } : {}),
        ...(crm?.email ? { email: crm.email } : {}),
      }
    })
  // Clientes con varias cuentas (una vieja + una activa): si alguna corre, las hermanas frenadas ≥90d son ruido
  const clienteDe = (c: MetaClienteCuenta) => c.clienteCRM || norm(c.nombre)
  const corriendoPorCliente = new Set(cuentasFiltradas.filter(c => c.estado === 'activa' && c.diasSinCorrer === null && !c.sinDatos).map(clienteDe))
  const cuentasDedup = cuentasFiltradas.filter(c => !(c.estado === 'activa' && (c.diasSinCorrer ?? 0) >= 90 && corriendoPorCliente.has(clienteDe(c))))
  const metaClientesFiltrado: MetaClientes = { ...mc, cuentas: cuentasDedup, total: cuentasDedup.length }

  const alPagos: { nombre: string; saldo: number; fecha: string; dias: number }[] = []
  const alPagosTodos: { nombre: string; saldo: number; fecha: string | null; dias: number | null }[] = []
  const finMesActual = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)
  let pagosSinFechaN = 0, pagosSinFechaTotal = 0
  const alVencidos: { nombre: string; dias: number; llamada: string | null }[] = []
  const alFinalizados: { nombre: string; fin: string; dias: number; llamada: string | null }[] = []
  const alPorVencer: { nombre: string; fecha: string; dias: number; llamada: string | null }[] = []
  // Col U = fecha de llamada de proyección agendada (para saber si un vencido ya tiene llamada)
  // Col U "Llamada agendada": fecha (serial) o texto libre ("Agendada (10/9)", "Proyección 11/9"…)
  const llamadaAgendada = (r: Row): string | null => {
    if (typeof r[20] === 'number') { if (r[20] <= 0) return null; const d = serialToDate(r[20]); return `${d.getDate()}/${d.getMonth() + 1}` }
    const t = (r[20] ?? '').toString().trim()
    return t ? t.slice(0, 40) : null
  }
  // ¿La llamada de la col U ya pasó? Serial o primera fecha "d/m[/aa]" del texto ("Agendada (10/9)",
  // "Proyección agendada (conf. 14/9)"). Anterior a hoy = llamada hecha sin resultado cargado.
  const llamadaYaPaso = (r: Row): boolean => {
    let d: Date | null = null
    if (typeof r[20] === 'number') d = r[20] > 0 ? serialToDate(r[20]) : null
    else {
      const m = (r[20] ?? '').toString().match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
      if (m) {
        const dia = parseInt(m[1]), mes = parseInt(m[2])
        let y = m[3] ? parseInt(m[3]) : hoy.getFullYear()
        if (y < 100) y += 2000
        if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
          d = new Date(y, mes - 1, dia)
          if (!m[3] && +d - +hoy > 183 * 86_400_000) d.setFullYear(y - 1)   // sin año y muy en el futuro → año pasado
        }
      }
    }
    return !!d && d < hoy
  }
  // Columnas agregadas a mano en Agencia: por ENCABEZADO (si no existen, -1)
  const colAgencia = (pred: (h: string) => boolean) => agenciaHeader.findIndex(h => !!h && pred(h))
  const iFechaBaja = colAgencia(h => h.includes('fecha de baja'))
  const iSatisf = colAgencia(h => h.includes('satisfaccion'))
  const iPromesaH = colAgencia(h => h.includes('promesa'))
  const iPromesa = iPromesaH >= 0 ? iPromesaH : 14   // col O "Promesa alcanzada"
  // Fecha de celda del CRM: serial o texto "d/m/aaaa"
  const fechaCRM = (c: Cell | undefined): Date | null => {
    if (typeof c === 'number') return c > 0 ? serialToDate(c) : null
    const m = (c ?? '').toString().trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
    if (!m) return null
    let y = parseInt(m[3]); if (y < 100) y += 2000
    return new Date(y, parseInt(m[2]) - 1, parseInt(m[1]))
  }
  for (const r of crmClientes) {
    const estado = (r[2] ?? '').toString().trim().toUpperCase()
    const nombre = (r[1] ?? '').toString().trim()
    const fin = typeof r[9] === 'number' ? serialToDate(r[9]) : null
    // Finalizados → ¿llamada de proyección hecha/agendada? (col U). Solo desde el
    // 26/9/2026: los anteriores el usuario los dio por cerrados definitivos (30-ago y 28-sep: Weber, di Salvo, Travaglini).
    const PROYECCION_CORTE = new Date(2026, 8, 26)
    if (estado === 'FINALIZADO' && fin && fin >= PROYECCION_CORTE) {
      const dias = Math.round((+hoy - +fin) / 86_400_000)
      if (dias >= 0 && dias <= 90)
        alFinalizados.push({ nombre, fin: `${fin.getDate()}/${fin.getMonth() + 1}`, dias, llamada: llamadaAgendada(r) })
    }
    // Alertas de cobranza: vigentes que deben plata Y tienen fecha de próximo cobro (col T).
    // Sin fecha (acuerdo abierto, FUP, desaparecido) → solo cuentan en el resumen.
    if (estado === 'ACTIVO' || estado === 'PAUSADO') {
      const saldo = (Number(r[11]) || 0) - (Number(r[12]) || 0)
      if (saldo > 50) {
        const cobro = typeof r[19] === 'number' && r[19] > 0 ? serialToDate(r[19]) : null
        const fecha = cobro ? `${cobro.getDate()}/${cobro.getMonth() + 1}` : null
        const dias = cobro ? Math.round((+cobro - +hoy) / 86_400_000) : null
        alPagosTodos.push({ nombre, saldo, fecha, dias })
        // La tarjeta principal muestra solo los cobros del MES ACTUAL (vencidos incluidos)
        if (cobro && cobro <= finMesActual) alPagos.push({ nombre, saldo, fecha: fecha!, dias: dias! })
        else if (!cobro) { pagosSinFechaN++; pagosSinFechaTotal += saldo }
      }
    }
    if (estado === 'PAUSADO') crmPausados++
    if (estado === 'ACTIVO') {
      crmActivos++
      // Semáforo del PDF del mentor: verde al día, amarillo ≤14 días del fin
      // (mandar llamada de proyección), rojo ya venció sin renovar.
      if (!fin) semSinFecha++
      else if (fin < hoy) {
        semRojo++
        const llamada = llamadaAgendada(r)
        alVencidos.push({ nombre, dias: Math.round((+hoy - +fin) / 86_400_000), llamada, ...(llamada && llamadaYaPaso(r) ? { llamadaPasada: true } : {}) })
      } else if (fin <= en14dias) {
        semAmarillo++
        alPorVencer.push({ nombre, fecha: `${fin.getDate()}/${fin.getMonth() + 1}`, dias: Math.round((+fin - +hoy) / 86_400_000), llamada: llamadaAgendada(r) })
      } else semVerde++
    }
    const renovo = (r[10] ?? '').toString().trim().toUpperCase().startsWith('R')
    if (renovo) crmRenovadores++
    else if (estado && estado !== 'ACTIVO') crmNoRenovaron++
    const promesa = (r[iPromesa] ?? '').toString().trim()   // col O "Promesa alcanzada" (Parcial cuenta como no)
    if (promesa) { exitoTotal++; if (promesa.toLowerCase().startsWith('s')) exitoSi++ }
    // Satisfacción (1-10): solo si Agencia tiene la columna (por encabezado). La col P hoy es "Semaforo de Clientes".
    const sat = iSatisf >= 0 ? Number(r[iSatisf]) : NaN
    if (isFinite(sat) && sat > 0 && sat <= 10) { satisfSum += sat; satisfN++ }
    const ltvC = Number(r[11])                         // col L = LTV contratado
    if (isFinite(ltvC) && ltvC > 0) { ltvCrmSum += ltvC; ltvCrmN++ }
    const ltvCob = Number(r[12])                       // col M = LTV COBRADO (métrica real)
    if (isFinite(ltvCob) && ltvCob > 0) { ltvCobSum += ltvCob; ltvCobN++ }
  }
  // Renovaciones (A ID, C período, D día 1, F precio, G notas). Renovación PAGA = período > 0, nota que no
  // empieza con "Extensión" y precio ≠ 0 (vacío = precio pendiente de cargar, cuenta; $0 = no se cobró:
  // renovación cancelada o extensión sin rotular). Además: inicio del período 0 por ID (fallback del Día 1).
  const inicioP0 = new Map<string, Date>()
  for (const r of crmRenov) {
    const id = (r[0] ?? '').toString().trim()
    if (!id.startsWith('A')) continue   // solo Agencia
    if (idsNoClientes.has(id)) continue  // "no cliente" (solo fee): sus renovaciones tampoco cuentan
    const periodo = Number(r[2])
    const d = typeof r[3] === 'number' && r[3] > 0 ? serialToDate(r[3]) : null
    if (periodo === 0 && d && (!inicioP0.has(id) || d < inicioP0.get(id)!)) inicioP0.set(id, d)
    const esExtension = (r[6] ?? '').toString().trim().toLowerCase().startsWith('extensi')
    const precioCelda = r[5]
    const precioCero = precioCelda != null && precioCelda.toString().trim() !== '' && amountFromCell(precioCelda) === 0
    if (periodo > 0 && !esExtension && !precioCero && d && d.getFullYear() === YEAR) crmChurnRenov[d.getMonth()]++
  }

  // ── Modelo stock-flujo de clientes (SOLO Agencia) ──
  // entrada = Día 1 (col I) o, si falta, inicio del período 0 en Renovaciones.
  // salida  = "Fecha de baja" (col V, por encabezado) si está cargada; si no, FINALIZADO/INACTIVO sale en
  //           su fin (col J) si ya pasó, o HOY si el fin es futuro o falta (una baja no puede estar en el
  //           futuro: bajas anticipadas con contrato vigente, devoluciones del 24/8…). ACTIVO y PAUSADO no
  //           salen aunque el fin haya pasado (vencidos sin renovar siguen siendo clientes).
  // activos(t) = entrada ≤ t < salida. Así cierra: activosFin = activosInicio + nuevos − bajas, y
  // activosInicio[m+1] = activosFin[m] (activosInicio = al empezar el día 1 = activos del día anterior).
  let crmBajasSinFecha = 0
  const flujoCRM: { entrada: Date; salida: Date | null }[] = []
  for (const r of crmClientes) {
    const estado = (r[2] ?? '').toString().trim().toUpperCase()
    const id = (r[0] ?? '').toString().trim()
    const entrada = (typeof r[8] === 'number' && r[8] > 0 ? serialToDate(r[8]) : null) ?? inicioP0.get(id) ?? null
    if (!entrada) continue   // sin fecha de inicio: no se puede ubicar en el tiempo
    const fin = typeof r[9] === 'number' && r[9] > 0 ? serialToDate(r[9]) : null
    const baja = iFechaBaja >= 0 ? fechaCRM(r[iFechaBaja]) : null
    let salida: Date | null = null
    if (baja) salida = baja
    else if (estado === 'FINALIZADO' || estado === 'INACTIVO') {
      if (fin && fin <= hoy) salida = fin
      else { salida = new Date(hoy); if (fin) crmBajasSinFecha++ }
    }
    if (salida && salida < entrada) salida = entrada   // dato inconsistente: entra y sale el mismo día (neto 0)
    flujoCRM.push({ entrada, salida })
  }
  const activosEn = (t: Date) => flujoCRM.filter(c => c.entrada <= t && (!c.salida || c.salida > t)).length
  const enRango = (d: Date | null, desde: Date, hasta: Date) => !!d && d >= desde && d <= hasta

  // ── Backend mes a mes (para que el selector de mes lo mueva) ──
  // Stock-flujo de arriba (flujoCRM). Mes en curso: hasta hoy; meses futuros: activosFin/churn null.
  const mesActual = hoy.getFullYear() === YEAR ? hoy.getMonth() : hoy.getFullYear() > YEAR ? 11 : -1
  const esFuturo = (m: number) => m > mesActual
  const finDeMes = (m: number) => (m === mesActual ? hoy : new Date(YEAR, m + 1, 0))   // mes en curso = hoy
  const activosInicio = Array.from({ length: 12 }, (_, m) => activosEn(new Date(YEAR, m, 0)))   // día anterior al 1
  const nuevosMes = Array.from({ length: 12 }, (_, m) => flujoCRM.filter(c => enRango(c.entrada, new Date(YEAR, m, 1), finDeMes(m))).length)
  const bajasMes = Array.from({ length: 12 }, (_, m) => flujoCRM.filter(c => enRango(c.salida, new Date(YEAR, m, 1), finDeMes(m))).length)
  const crmChurnActivosInicio = activosInicio
  const crmChurnBajas = bajasMes
  // LTGP = LTV COBRADO del CRM (la métrica "real" del tablero) × margen bruto; fallback LTV del Registro
  const ltvCobradoCRM = ltvCobN > 0 ? ltvCobSum / ltvCobN : null
  const ltgp = (ltvCobradoCRM ?? ltv) != null && margenBruto != null ? (ltvCobradoCRM ?? ltv)! * margenBruto : null
  const ltgpCac = ltgp != null && cacPromedio != null && cacPromedio > 0 ? ltgp / cacPromedio : null
  const backendMensual: BackendMensual = {
    activosInicio,
    activosFin: Array.from({ length: 12 }, (_, m) => (esFuturo(m) ? null : activosEn(finDeMes(m)))),
    nuevos: nuevosMes,
    bajas: bajasMes,
    renovaciones: crmChurnRenov,
    churn: Array.from({ length: 12 }, (_, m) =>
      esFuturo(m) || activosInicio[m] < 3 ? null : (bajasMes[m] / activosInicio[m]) * 100),
    tasaRenovacion: Array.from({ length: 12 }, (_, m) => {
      const decisiones = crmChurnRenov[m] + bajasMes[m]
      return esFuturo(m) || decisiones === 0 ? null : (crmChurnRenov[m] / decisiones) * 100
    }),
    ltvAcumulado: Array.from({ length: 12 }, (_, m) => {
      if (esFuturo(m)) return null
      const finMes = new Date(YEAR, m + 1, 0)
      let total = 0, clientes = 0
      for (const rec of ltvRecsReales) {
        const hasta = rec.pagos.filter(p => p.date <= finMes)
        if (!hasta.length) continue
        clientes++
        total += hasta.reduce((acc, p) => acc + p.amount, 0)
      }
      return clientes > 0 ? total / clientes : null
    }),
    ltgpCac: [] as (number | null)[],   // se completa abajo con ltvAcumulado (LTGP de ESE mes, no el de hoy)
    beccPct: Array.from({ length: 12 }, (_, m) => (monthlyCash[m] > 0 ? (monthlyBECC[m] / monthlyCash[m]) * 100 : null)),
  }

  // LTGP:CAC del mes = LTV acumulado a fin de ese mes × margen bruto ÷ CAC blended del mes (null si falta algo)
  backendMensual.ltgpCac = backendMensual.ltvAcumulado.map((ltvM, m) => {
    const cac = monthlyCAC[m]
    return ltvM != null && margenBruto != null && cac != null && cac > 0 ? (ltvM * margenBruto) / cac : null
  })

  // ── Historial operativo (fotos diarias del semáforo, pestaña del sheet de Ventas) ──
  const numCelda = (c: Cell | undefined) => (typeof c === 'number' ? c : parseFloat((c ?? '').toString()) || 0)
  const fotosPorFecha = new Map<string, FotoOperativa>()
  for (const r of historialRows) {
    const fecha = typeof r[0] === 'number' ? ymdLocal(serialToDate(r[0])) : (r[0] ?? '').toString().trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue
    fotosPorFecha.set(fecha, {
      fecha, rojo: numCelda(r[1]), amarillo: numCelda(r[2]), verde: numCelda(r[3]), pausa: numCelda(r[4]),
      produccion: numCelda(r[5]), finalizados: numCelda(r[6]), activosCRM: numCelda(r[7]),
    })
  }
  const historialOperativo = [...fotosPorFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))

  return {
    transactions,
    calls,
    // También los closers de las hojas de llamadas: uno nuevo sin cobros todavía (Nahuel, Brenda) tiene que poder filtrarse
    closerNames: [...new Set([...closerNames, ...calls.map(c => c.closer)])].sort(),
    monthlyLabels: MONTH_LABELS,
    monthlyCash,
    monthlyAgendadas,
    monthlyCerradas,
    monthlyCierresSoloFee,
    monthlyPresentadas,
    monthlySinRegistro,
    monthlyCalificadas,
    monthlyVSL,
    monthlyRetargeting,
    monthlyIG,
    monthlyOtrasFuentes,
    monthlyFECCU,
    monthlyFECCP,
    monthlyBECC,
    monthlyCashOut,
    monthlyGastosCompletos,
    monthlyNFCF,
    monthlyMargen,
    monthlyCAC,
    monthlyCACAds,
    monthlyFeccuCac,
    monthlyAds,
    monthlyVentasArea: ventasArea,
    monthlyMktArea: mktArea,
    monthlyGastoAdq,
    clickup: clickup as ClickUpSemaforo,
    backend: {
      ltv, clientes: clientesUnicos, margenBruto, ltgp, cacPromedio, ltgpCac, churn: monthlyChurn,
      crm: {
        disponible: crmDisponible,
        activos: crmActivos,
        pausados: crmPausados,
        bajasSinFecha: crmBajasSinFecha,
        semVerde, semAmarillo, semRojo, semSinFecha,
        churnBajas: crmChurnBajas,
        churnActivosInicio: crmChurnActivosInicio,
        churnRenov: crmChurnRenov,
        tasaRenovacion: crmRenovadores + crmNoRenovaron > 0 ? (crmRenovadores / (crmRenovadores + crmNoRenovaron)) * 100 : null,
        tasaExito: exitoTotal > 0 ? (exitoSi / exitoTotal) * 100 : null,
        satisfaccion: satisfN > 0 ? satisfSum / satisfN : null,
        ltvContratado: ltvCrmN > 0 ? ltvCrmSum / ltvCrmN : null,
        ltvCobrado: ltvCobradoCRM,
        noClientes: crmNoClientes.length,
        noClientesNombres: crmNoClientes.map(r => (r[1] ?? '').toString().trim()).filter(Boolean),
      },
      mensual: backendMensual,
    },
    monthlyAdsVSL,
    monthlyAdsRetargeting,
    monthlyAdsFM,
    monthlyAdsWebinar,
    monthlyAdsUruguay,
    monthlyFeccuVSL,
    monthlyFeccuRetargeting,
    monthlyFeccuFM,
    monthlyFeccuCacVSL,
    monthlyFeccuCacRetargeting,
    monthlyFeccuCacFM,
    monthlyFeccuCacWebinar,
    monthlyFeccuCacUruguay,
    monthlyFeccuCacBlended,
    monthlyLeadsVSL,
    monthlyAgendasWeb: gaAgendasWeb as (number | null)[],
    monthlyClicksAgendar: gaClicksAgendar as (number | null)[],
    monthlyLeadsIG,
    monthlyAsignadosSetter,
    monthlyAgendasSetter,
    monthlyTasaAgendaSetter,
    enrutamiento,
    monthlySeguidoresIG,
    monthlyCPS,
    monthlyCPLMetaFM,
    monthlyCPLInstagram,
    monthlyCPLInstagramEstimado,
    igTasaSeguimiento,
    igTasaFuente,
    grabaciones,
    historialOperativo,
    clientesNombres: crmClientes.map(r => (r[1] ?? '').toString().trim()).filter(Boolean),
    // Todas las filas de Agencia con nombre (también las nuevas sin ID): estado y Día 1 para kick-off vs proyección.
    // Sin los "no clientes" (solo fee): para el resumen de Discord no son clientes.
    clientesCRM: crmAgencia.filter(r => (r[1] ?? '').toString().trim() && !esNoClienteCRM(r)).map(r => ({
      nombre: (r[1] ?? '').toString().trim(),
      estado: (r[2] ?? '').toString().trim().toUpperCase(),
      dia1: typeof r[8] === 'number' && r[8] > 0 ? ymdLocal(serialToDate(r[8])) : null,
    })),
    recordatorios: (recordatoriosRows as Row[])
      .filter(r => (r[1] ?? '').toString().trim() && !(r[2] ?? '').toString().trim().toUpperCase().startsWith('S'))
      .map(r => {
        // Si la fecha se cargó como número serial de Sheets ("46309") se pasa a dd/mm/aaaa: si no, el resumen
        // la mostraba cruda y como "sin fecha" (salía antes de tiempo)
        const f0 = (r[0] ?? '').toString().trim()
        const d = /^\d{5}(\.\d+)?$/.test(f0) ? serialToDate(Number(f0)) : null
        const fecha = d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : f0
        return { fecha, texto: (r[1] ?? '').toString().trim() }
      }),
    alertas: {
      pagosPendientes: alPagos.sort((a, b) => a.dias - b.dias),
      pagosSinFecha: { cantidad: pagosSinFechaN, total: pagosSinFechaTotal },
      pagosTodos: alPagosTodos.sort((a, b) => b.saldo - a.saldo),
      vencidos: alVencidos.sort((a, b) => b.dias - a.dias),
      finalizados: alFinalizados.sort((a, b) => (a.llamada ? 1 : 0) - (b.llamada ? 1 : 0) || a.dias - b.dias),
      porVencer: alPorVencer.sort((a, b) => a.dias - b.dias),
      onboarding: (clickup as ClickUpSemaforo).produccionDetalle,
      metaClientes: metaClientesFiltrado,
    },
  }
}
