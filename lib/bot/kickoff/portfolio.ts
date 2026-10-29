// ── Portfolio del cliente en Meta (solo lectura) para la ficha de kickoff ─────────────────────────────
// Los 7 ítems fijos de tipos.ts (ITEMS_PORTFOLIO) se chequean contra la cuenta publicitaria real del cliente, para no
// depender solo de lo que se dijo en la llamada. Sale de la investigación del 24/10 (.cache/kickoff-prueba/addons:
// chequeo-portfolio.mjs, sonda-meta*.mjs, portfolio-laura.json) y se probó con Laura Oliver Masiá, Mones Ruiz, Estefi & Lean
// y una cuenta ajena (#200).
//   · Lectura: 1 llamada a la Batch API de Graph v23.0 con 9 subpedidos GET encadenados por {result=cta:$.business.id}
//     (el pedido con nombre necesita omit_response_on_success:false, si no Graph devuelve su cuerpo vacío). Una 2.ª
//     llamada SOLO si al equipo no se lo ve en el portfolio dueño y la cuenta tiene agencias confirmadas (act/agencies):
//     ahí se leen los asignados a través de cada agencia (caso Estefi & Lean). Entre 2 y 4 s; tope total TIMEOUT_TOTAL_MS.
//     El cuerpo de la Batch API va por POST (así es la API), pero cada subpedido es un GET: no se escribe nada.
//   · Tokens: tokensMeta() de lib/anuncios/token.ts (META_ANUNCIOS_TOKEN = system user, y después META_CLIENTES_TOKEN =
//     usuario de responsable de la cuenta), como batchConRespaldo de lib/anuncios/meta.ts (cuyas funciones de batch son privadas: misma
//     solución que ganadores.ts, una llamada propia acá). NUNCA META_ADS_WRITE_TOKEN. Se separan dos errores, y con los dos
//     se prueba el token siguiente: el del TOKEN (#190/#102 en cualquier nivel o error de permisos de TODA la llamada:
//     vencido, revocado, inválido), que no dice nada de la cuenta → motivo 'token_invalido' con el aviso de renovarlo; y el
//     de la CUENTA (#200, #10, #100/33, #100 «missing permission» sin subcode, como lo da Graph en la sonda) → 'sin_acceso'.
//   · Límite de Meta (#4, #17, #32, #613, 80000+): no se insiste, todo 'sin_dato' con aviso de reintentar.
// Qué se puede saber con el token actual (scopes ads_management, ads_read, business_management):
//   · portfolio_comercial: act?fields=business{id,name,verification_status},owner.
//   · pagina_facebook: {biz}/owned_pages + client_pages; si no se ven (token que no es miembro del portfolio), la página que
//     usan los conjuntos / creatividades.
//   · instagram: {biz}/instagram_accounts, act/instagram_accounts y adcreatives.instagram_user_id. Vacío NO es 'falta': el
//     token no tiene instagram_basic ni pages_read_engagement (el IG vinculado solo a la página no se ve) → 'sin_dato'. Un id
//     que sale SOLO de las creatividades puede ser la cuenta de IG «usando la página» (sin IG real): 'ok' débil (ver fusión).
//   · whatsapp_business: no se puede leer directo (page.whatsapp_number da #100, los WABA del portfolio #200); solo se deduce
//     de conjuntos con destination_type que contenga WHATSAPP → 'ok' débil (no prueba que sea Business); si no hay, 'sin_dato'.
//   · tarjeta: funding_source_details{id,type} + account_status. Deuda = account_status 3/8/9 → 'problema'; deshabilitada
//     por riesgo en los pagos (disable_reason 3) → 'problema'; sin medio de pago (sin funding_source_details o tipo 0 UNSET,
//     14 FS_NULL, 18 DUMMY del enum de Meta) → 'falta'; tipo que no es un medio de pago o desconocido (9 FEE, 10 FX,
//     11 DISCOUNT, 15 EXTERNAL_DEPOSIT, 16 TAX…) → 'sin_dato' a revisar a mano. balance > 0 en pospago es lo gastado sin
//     facturar, NO deuda (balance ni se pide). Nunca sale el número ni la marca de la tarjeta: solo "hay medio de pago
//     sí/no" y el tipo (display_string ni se pide).
//   · verificacion: account_status, disable_reason y business.verification_status. Cuenta deshabilitada → 'problema' con el
//     motivo. Cuenta activa con portfolio not_verified → ESTADO_PORTFOLIO_SIN_VERIFICAR ('ok' con la nota "sin verificar",
//     también en el ítem portfolio_comercial). CONFIRMADO por Tomás el 24/10: no frena nada (Mones Ruiz anuncia así).
//   · accesos_equipo: act/assigned_users?business={biz} (+ por agencia). Graph no da el mail de otros usuarios del portfolio
//     ({biz}/business_users solo devuelve al dueño del token): se cruza POR NOMBRE (coincidenciaNombre: exacta → cuenta;
//     parcial como «Persona A.» → 'sin_dato' a confirmar; otro apellido → no es él) y con permiso de anunciar (ADVERTISE
//     o MANAGE). Con META_CLIENTES_TOKEN, además, los user_tasks de la cuenta SON los de responsable de la cuenta: ADVERTISE/MANAGE →
//     tiene acceso aunque no figure por nombre (con el system user nunca: esos permisos no son de Gero). Los dos → 'ok';
//     falta alguno → 'falta' diciendo quién, pero SOLO si se pudo leer todo: el portfolio dueño con un token miembro (si no
//     es miembro, assigned_users devuelve [] sin error: es "no se ve", no "nadie"), /agencies y cada agencia confirmada (con
//     alguien adentro). Si una parte no se leyó, 'sin_dato' diciendo cuál.
//   · Cuenta ilegible: seis ítems 'sin_dato'; accesos_equipo 'falta' SOLO si el "no" de la cuenta lo recibió
//     META_CLIENTES_TOKEN (es de responsable de la cuenta: si no ve la cuenta, le falta el acceso); si fue solo el system user,
//     'sin_dato'. Un #100 también puede ser un id mal cargado en "Cuentas Meta": se avisa.
// Cuál es la cuenta del cliente nuevo (buscarCuentaCliente): 1) las que trae el contexto del cliente (ClienteFicha.cuentas:
// "Cuentas Meta" del CRM y AJUSTES_CUENTA, ids o nombres de cuenta; si son varias, se cruzan con el descubrimiento para
// revisar primero la activa, y se avisa); 2) si no hay, el descubrimiento del tablero (descubrirCuentas: /me/adaccounts +
// /me/businesses) cruzado con el CRM (crearCruce().resolverCliente) y filtrado por el cliente del CRM, leyendo las MISMAS
// claves de caché del tablero ('descubrir' y 'sheets': casi siempre calientes, no suman llamadas). Todo eso ya es público en
// lib/anuncios: no hizo falta un descubrimiento propio. 3) Si no aparece, todo 'sin_dato' con el aviso de cargar la cuenta
// en "Cuentas Meta" (caso Laura, A157: hoy aparece solo por el descubrimiento).
// Fusión con la llamada (combinarPortfolio, pura): manda Meta salvo que diga 'sin_dato'; ahí queda lo de la llamada. Excepción:
// un 'ok' débil de Meta (instagram / whatsapp_business deducidos de los anuncios) no le gana a un 'falta' o 'problema' de la
// llamada: queda lo de la llamada con la nota de Meta. Un 'sin_verificar' de la llamada (se mencionó, no se comprobó) no es
// una opinión: no le discute a Meta, y si Meta no vio nada queda 'sin_dato' (tildar a mano) con la mención anotada. Cada
// ítem dice de dónde salió y, si la llamada dijo otra cosa que Meta, queda anotado. Es la ÚNICA fusión: armarFicha la usa
// para portfolio_final (tipos.ts) y de ahí leen los faltantes, el markdown y el aviso. paraFicha() pasa la salida de
// portfolioDelCliente a lo que guarda la ficha (sin lo crudo de Graph: ni datos, ni negocio, ni tokens).
// Revisión del 24/10: los textos de cada ítem van sin nombres de permisos ni de tokens (los lee Tomi en la pantalla); el
// porqué técnico (código de Graph, permiso que falta) va en ItemMeta.tecnico, que procesar.ts pasa a los ajustes. La cuenta
// trae además currency y timezone_name (moneda y zona horaria en portfolio_meta).
// Diseño: lo PURO (pedidos, lectura del lote, interpretación, fusión, elección de cuenta) está separado de lo que hace red
// (fetch inyectable, fuentes inyectables) para probarlo sin red (scripts/test-bot-kickoff-portfolio.mjs). lib/anuncios se
// importa dinámico (cache.ts arrastra next/cache y sheets.ts googleapis); token.ts no tiene dependencias y va estático.
import type { CuentaDescubierta } from '@/lib/anuncios/meta'
import { esErrorPermisos, tokensMeta, type TokenMeta } from '@/lib/anuncios/token'
import {
  EQUIPO_ACCESOS_BASE, ITEMS_PORTFOLIO,
  type ClaveEquipo, type EstadoPortfolioFinal, type FuentePortfolio, type ItemPortfolio, type ItemPortfolioFinal, type LecturaPortfolioMeta,
  type MotivoSinLecturaMeta,
} from './tipos'

const GRAPH = 'https://graph.facebook.com/v23.0'
export const TIMEOUT_TOTAL_MS = 12_000
export const TOPE_BUSQUEDA_MS = 12_000   // el descubrimiento en frío tardó 9,3 s el 24/10 (con la caché caliente, ~0)
const ESPERA_TRANSITORIO_MS = 1_500
const MAX_AGENCIAS = 5
const MAX_NOMBRES = 3

// ── Tipos (los de la ficha viven en tipos.ts: acá son alias, una sola definición) ──
export type EstadoItemMeta = EstadoPortfolioFinal
export type FuenteItem = FuentePortfolio
type NombreToken = TokenMeta['nombre']

export interface ItemMeta {
  estado: EstadoItemMeta
  detalle: string                 // corto, en castellano, para la ficha
  fuente: 'meta'
  campo: string                   // de qué parte de la Graph API salió (para revisar; no es para el cliente)
  debil?: boolean                 // 'ok' deducido de los anuncios: no le gana a un 'falta'/'problema' de la llamada
  tecnico?: string                // el porqué técnico (código de Graph, permiso que falta): va a los ajustes, no a la pantalla
}

export type MotivoSinLectura = MotivoSinLecturaMeta

export interface PortfolioMeta {
  cuenta: string | null           // act_…; null = no se encontró la cuenta del cliente
  nombre: string | null           // nombre de la cuenta publicitaria
  negocio: { id: string; nombre: string } | null
  items: Record<ItemPortfolio, ItemMeta>
  leido: boolean                  // se pudo leer la cuenta
  motivo: MotivoSinLectura | null // por qué no (null si se leyó)
  aviso: string | null            // qué hacer: reintentar, cargar la cuenta, dar acceso, renovar el token
  datos: DatosCuenta | null       // lo crudo que importa (sin datos de tarjeta)
  llamadas: number                // llamadas HTTP a Graph
  ms: number
  token: NombreToken | null       // con el que se leyó (sin lectura: con el que Meta dijo que no)
  generado: string                // ISO
}

export interface DatosCuenta {
  estado_cuenta: number | null    // account_status
  motivo_baja: number | null      // disable_reason
  prepago: boolean | null
  hay_medio_pago: boolean | null  // null = Meta informa un tipo que no es un medio de pago reconocido (revisar a mano)
  tipo_medio_pago: string | null  // "tarjeta de crédito/débito"… (nunca el número ni la marca)
  verificacion_portfolio: string | null   // verified | not_verified | … (null = no visible)
  token_miembro_portfolio: boolean        // verification_status visible = el token es miembro del portfolio dueño
  agencias: string[]              // negocios con acceso CONFIRMED a la cuenta
  moneda: string | null           // currency de la cuenta (USD, ARS…): en qué moneda se carga el presupuesto
  zona_horaria: string | null     // timezone_name (America/Argentina/San_Juan…): a qué hora cortan los presupuestos diarios
}

// ── Identidades del equipo: configuración privada explícita ──
export interface MiembroEquipo {
  quien: string
  mail: string
  pila: readonly string[]         // nombres de pila normalizados: pila + apellido = coincidencia exacta
  apellidos: readonly string[]
  token: NombreToken | null
}
const aliasesEquipo = (rol: string, campo: 'NOMBRES' | 'APELLIDOS') =>
  (process.env[`KICKOFF_EQUIPO_${rol}_${campo}`] ?? '').split(',').map(s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')).filter(Boolean)
const COMO_RECONOCERLO: Record<ClaveEquipo, Pick<MiembroEquipo, 'pila' | 'apellidos' | 'token'>> = {
  gero_a: { pila: aliasesEquipo('GERO_A', 'NOMBRES'), apellidos: aliasesEquipo('GERO_A', 'APELLIDOS'), token: 'META_CLIENTES_TOKEN' },
  valentino: { pila: aliasesEquipo('VALENTINO', 'NOMBRES'), apellidos: aliasesEquipo('VALENTINO', 'APELLIDOS'), token: null },
}
export const EQUIPO_ACCESOS: readonly MiembroEquipo[] = EQUIPO_ACCESOS_BASE.map(m => ({ quien: m.quien, mail: m.mail, ...COMO_RECONOCERLO[m.clave] }))
const equipoConfigurado = () => EQUIPO_ACCESOS.every(m => m.mail.includes('@') && m.pila.length > 0 && m.apellidos.length > 0)
const TAREAS_ANUNCIAR = new Set(['ADVERTISE', 'MANAGE'])

/** Decisión de Tomás (24/10/2026, confirmada): cuenta activa con el portfolio sin verificar cuenta como 'ok' con la nota; no frena nada. */
export const ESTADO_PORTFOLIO_SIN_VERIFICAR: EstadoItemMeta = 'ok'

// ── Textos de Meta ──
const ESTADO_CUENTA: Record<number, string> = {
  1: 'activa', 2: 'deshabilitada', 3: 'con pago pendiente (deuda)', 7: 'en revisión de riesgo', 8: 'con liquidación pendiente',
  9: 'en período de gracia por un pago', 100: 'por cerrarse', 101: 'cerrada', 201: 'activa', 202: 'cerrada',
}
const ESTADOS_ACTIVA = new Set([1, 201])
const ESTADOS_DEUDA = new Set([3, 8, 9])
const MOTIVO_BAJA: Record<number, string> = {
  1: 'políticas de integridad de anuncios', 2: 'revisión de propiedad intelectual', 3: 'riesgo en los pagos', 4: 'cuenta cerrada por Meta',
  5: 'revisión de anuncios (AFC)', 6: 'integridad del negocio', 7: 'cierre permanente', 8: 'cuenta de revendedor sin uso', 9: 'cuenta sin uso',
  10: 'cuenta paraguas', 11: 'políticas del administrador comercial', 12: 'cuenta mal representada', 13: 'separación de entidad legal',
  14: 'revisión de contexto', 15: 'cuenta comprometida (hackeo)',
}
const BAJA_RIESGO_PAGOS = 3
// funding_source_details.type (enum de Meta): los que son un medio de pago; 0 UNSET, 14 FS_NULL y 18 DUMMY = NO hay medio de
// pago. El resto (9 FEE, 10 FX, 11 DISCOUNT, 15 EXTERNAL_DEPOSIT, 16 TAX o uno nuevo) no es un medio de pago: 'sin_dato'.
const TIPO_PAGO: Record<number, string> = {
  1: 'tarjeta de crédito/débito', 2: 'saldo de Facebook', 3: 'crédito pago de Facebook', 4: 'línea de crédito extendida', 5: 'orden de compra',
  6: 'factura', 7: 'token de Facebook', 8: 'financiación externa', 12: 'PayPal', 13: 'PayPal (acuerdo)', 17: 'débito directo',
  19: 'pago alternativo', 20: 'saldo prepago',
}
const SIN_MEDIO = new Set([0, 14, 18])
const VERIF: Record<string, string> = {
  verified: 'verificado', not_verified: 'sin verificar', pending: 'verificación en revisión', pending_submission: 'verificación sin enviar',
  pending_need_more_info: 'Meta pidió más información', failed: 'verificación rechazada', rejected: 'verificación rechazada',
  revoked: 'verificación revocada', expired: 'verificación vencida', ineligible: 'no elegible para verificar',
}
const VERIF_MAL = new Set(['failed', 'rejected', 'revoked', 'expired', 'pending_need_more_info'])

// ── Errores de Graph (mismas reglas que lib/anuncios/meta.ts, donde son privadas) ──
export interface ErrorGraph { code?: number; subcode?: number; message: string }
export const esLimite = (code?: number) => code === 4 || code === 17 || code === 32 || code === 613 || (!!code && code >= 80000 && code <= 80014)
const esTransitorio = (code?: number) => code === 1 || code === 2
const codigo = (e: ErrorGraph | null | undefined) => (e?.code ? `#${e.code}${e.subcode ? `/${e.subcode}` : ''}` : 'sin código')
/** Token roto (vencido, revocado, inválido): #190 OAuthException, #102 sesión inválida. No dice nada de la cuenta. */
export const esErrorToken = (e: ErrorGraph | null | undefined) => e?.code === 190 || e?.code === 102
/**
 * La cuenta no deja entrar con este token: esErrorPermisos de token.ts (sin el #190, que es del token) + el #100 SIN subcode
 * «missing permission» (así lo da Graph para objetos que el token no ve, 16 veces en la sonda del 24/10) y el #100 «does not
 * exist» (también es lo que da un id mal cargado). Se resuelve acá para no tocar token.ts, que comparte meta.ts.
 */
export const esSinAccesoCuenta = (e: ErrorGraph | null | undefined) =>
  !!e && !esErrorToken(e) && (esErrorPermisos(e.code, e.subcode) || (e.code === 100 && /missing permission|does not exist/i.test(e.message)))

/** Saca los tokens de un texto (como sinTokens de token.ts, pero con los tokens que se usaron de verdad). */
export function sinTokensDe(texto: string, tokens: TokenMeta[]): string {
  let t = String(texto)
  for (const { token } of tokens) if (token) t = t.split(token).join('***')
  return t.replace(/access_token=[^&\s"]+/g, 'access_token=***')
}

// ── Normalización ──
/** "Gerónimo  ACTIS" → "geronimo actis" (sin tildes, minúsculas, sin puntuación). */
export const normNombre = (x: unknown): string =>
  String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const palabras = (x: unknown) => new Set(normNombre(x).split(' ').filter(Boolean))

/** "2625067321346624" / "act_2625067321346624" → "act_2625067321346624"; cualquier otra cosa → null. */
export function idCuenta(x: unknown): string | null {
  const s = String(x ?? '').trim()
  const m = s.match(/^(?:act_)?(\d{6,20})$/)
  return m ? `act_${m[1]}` : null
}

export type Coincidencia = 'exacta' | 'parcial' | 'no'
/**
 * Cruce de un nombre de Meta con un miembro del equipo, en tres niveles. Exacta = un nombre de pila + un apellido («Geronimo
 * Actis», «Persona Ficticia Uno»). Parcial = solo el pila, un diminutivo (4+ letras del pila: «Valen») o solo el apellido,
 * sin otra palabra completa («Persona A.», «Valen Zalazar», «Actis») → a confirmar. Con otra palabra completa («Valentino
 * Pérez», «Persona Ficticia Dos») → no es él. Las palabras de 1–2 letras (iniciales, «de», «la») no cuentan.
 */
export function coincidenciaNombre(nombre: unknown, m: Pick<MiembroEquipo, 'pila' | 'apellidos'>): Coincidencia {
  const ps = [...palabras(nombre)].filter(p => p.length > 2)
  const esPila = (p: string) => m.pila.includes(p)
  const esDiminutivo = (p: string) => p.length >= 4 && m.pila.some(x => x.startsWith(p))
  const esApellido = (p: string) => m.apellidos.includes(p)
  if (ps.some(esPila) && ps.some(esApellido)) return 'exacta'
  if (ps.some(p => !esPila(p) && !esDiminutivo(p) && !esApellido(p))) return 'no'
  return ps.length ? 'parcial' : 'no'
}

// ── 1. Pedidos (puro) ──
export interface PedidoBatch { method: 'GET'; relative_url: string; name?: string; omit_response_on_success?: boolean }

/** Posición de cada subpedido en el lote (y en la respuesta). */
export const IDX = { cuenta: 0, agencias: 1, asignados: 2, paginasPropias: 3, paginasCliente: 4, igNegocio: 5, igCuenta: 6, conjuntos: 7, creatividades: 8 } as const
const BIZ = '{result=cta:$.business.id}'
// currency y timezone_name (24/10): en qué moneda factura la cuenta y en qué hora corta el día, para que Valentino cargue el
// presupuesto bien (en una cuenta en ARS los USD por día hay que pasarlos a pesos). Mismo subpedido GET, sin índice nuevo
export const CAMPOS_CUENTA = 'id,name,account_status,disable_reason,is_prepay_account,funding_source_details{id,type},business{id,name,verification_status},owner,user_tasks,currency,timezone_name'

export function pedidosPortfolio(act: string): PedidoBatch[] {
  return [
    { method: 'GET', name: 'cta', omit_response_on_success: false, relative_url: `${act}?fields=${CAMPOS_CUENTA}` },
    { method: 'GET', relative_url: `${act}/agencies?fields=id,name,access_status,permitted_tasks&limit=50` },
    { method: 'GET', relative_url: `${act}/assigned_users?business=${BIZ}&fields=id,name,tasks&limit=100` },
    { method: 'GET', relative_url: `${BIZ}/owned_pages?fields=id,name&limit=25` },
    { method: 'GET', relative_url: `${BIZ}/client_pages?fields=id,name&limit=25` },
    { method: 'GET', relative_url: `${BIZ}/instagram_accounts?fields=id,username&limit=25` },
    { method: 'GET', relative_url: `${act}/instagram_accounts?fields=id,username&limit=25` },
    { method: 'GET', relative_url: `${act}/adsets?fields=destination_type,effective_status,promoted_object&limit=100` },
    { method: 'GET', relative_url: `${act}/adcreatives?fields=actor_id,instagram_user_id,object_story_spec{page_id,instagram_user_id}&limit=50` },
  ]
}

/** 2.ª llamada: los asignados a la cuenta a través de cada agencia (negocio con acceso confirmado). */
export function pedidosAgencias(act: string, agencias: string[]): PedidoBatch[] {
  return agencias.slice(0, MAX_AGENCIAS).map(id => ({ method: 'GET', relative_url: `${act}/assigned_users?business=${id}&fields=id,name,tasks&limit=100` }))
}

// ── 2. Lectura de la respuesta del lote (puro) ──
type Obj = Record<string, unknown>
export type RespSub = { ok: true; body: Obj } | { ok: false; error: ErrorGraph }
export type RespLote = { ok: true; resp: RespSub[] } | { ok: false; error: ErrorGraph }

const esObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const errorDe = (x: unknown, porDefecto: string, limpiar: (s: string) => string): ErrorGraph => {
  const e = esObj(x) ? x : {}
  return {
    code: typeof e.code === 'number' ? e.code : undefined,
    subcode: typeof e.error_subcode === 'number' ? e.error_subcode : undefined,
    message: limpiar(typeof e.message === 'string' ? e.message.slice(0, 300) : porDefecto),
  }
}

/** JSON de la Batch API → una respuesta por pedido (en el mismo orden), o el error general del lote. */
export function leerLote(j: unknown, n: number, limpiar: (s: string) => string = s => s, httpStatus = 200): RespLote {
  if (!Array.isArray(j)) return { ok: false, error: errorDe(esObj(j) ? j.error : null, `HTTP ${httpStatus}`, limpiar) }
  const resp: RespSub[] = []
  for (let i = 0; i < n; i++) {
    const x = j[i] as { code?: number; body?: string } | null | undefined
    if (!x) { resp.push({ ok: false, error: { code: 2, message: 'Meta no respondió este pedido (timeout del lote)' } }); continue }
    let b: unknown = null
    try { b = typeof x.body === 'string' ? JSON.parse(x.body) : null } catch { /* cuerpo vacío o roto */ }
    if (x.code === 200 && esObj(b) && !b.error) resp.push({ ok: true, body: b })
    else resp.push({ ok: false, error: errorDe(esObj(b) ? b.error : null, `HTTP ${x.code ?? '?'}`, limpiar) })
  }
  return { ok: true, resp }
}

// ── 3. Interpretación (puro): respuestas → 7 ítems ──
interface CuentaGraph {
  id?: string; name?: string; account_status?: number; disable_reason?: number; is_prepay_account?: boolean; currency?: string; timezone_name?: string
  funding_source_details?: { id?: string; type?: number }
  business?: { id?: string; name?: string; verification_status?: string }
  owner?: string; user_tasks?: string[]
}
interface Agencia { id: string; nombre: string }
export interface LecturaAgencias { agencias: Agencia[]; respuestas: RespSub[] | null }

const datosDe = (x: RespSub | undefined): Obj[] | null => (x?.ok ? (Array.isArray(x.body.data) ? (x.body.data as Obj[]).filter(esObj) : []) : null)
const errorDeSub = (x: RespSub | undefined): ErrorGraph | null => (x && !x.ok ? x.error : null)
const txt = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const lista = (xs: string[]) => {
  const v = xs.slice(0, MAX_NOMBRES)
  return `${v.join(', ')}${xs.length > v.length ? ` y ${xs.length - v.length} más` : ''}`
}
const item = (estado: EstadoItemMeta, detalle: string, campo: string, debil = false, tecnico = ''): ItemMeta =>
  ({ estado, detalle, fuente: 'meta', campo, ...(debil ? { debil: true } : {}), ...(tecnico ? { tecnico } : {}) })

/** Agencias con acceso CONFIRMED a la cuenta (si /agencies falló, [] acá; itemAccesos lo trata como "no se leyó"). */
export function agenciasConfirmadas(r: RespSub[]): Agencia[] {
  return (datosDe(r[IDX.agencias]) ?? [])
    .filter(a => a.access_status === 'CONFIRMED' && txt(a.id))
    .map(a => ({ id: txt(a.id), nombre: txt(a.name) || txt(a.id) }))
}

// ── Accesos: quién del equipo puede anunciar, y por dónde ──
interface Persona { nombre: string; tareas: string[]; via: string }
const VIA_PORTFOLIO = '(portfolio)', VIA_TOKEN = '(token)'
function personasDe(x: RespSub | undefined, via: string): Persona[] {
  return (datosDe(x) ?? []).map(p => ({ nombre: txt(p.name), tareas: Array.isArray(p.tasks) ? (p.tasks as unknown[]).map(String) : [], via }))
}
const puedeAnunciar = (tareas: string[]) => tareas.some(t => TAREAS_ANUNCIAR.has(t))

interface EstadoMiembro { estado: 'anuncia' | 'dudoso' | 'solo_ver' | 'no'; vias: string[]; dudosos: string[] }
function estadoMiembro(personas: Persona[], m: MiembroEquipo, porToken: boolean): EstadoMiembro {
  const exactas = personas.filter(p => coincidenciaNombre(p.nombre, m) === 'exacta')
  const vias = [...new Set(exactas.filter(p => puedeAnunciar(p.tareas)).map(p => p.via)), ...(porToken ? [VIA_TOKEN] : [])]
  if (vias.length) return { estado: 'anuncia', vias, dudosos: [] }
  const dudosos = [...new Set(personas.filter(p => puedeAnunciar(p.tareas) && coincidenciaNombre(p.nombre, m) === 'parcial').map(p => p.nombre))]
  if (dudosos.length) return { estado: 'dudoso', vias: [], dudosos }
  return { estado: exactas.length ? 'solo_ver' : 'no', vias: [], dudosos: [] }
}

/** Con qué token se leyó la cuenta y sus user_tasks en ella (con META_CLIENTES_TOKEN, los de responsable de la cuenta). */
interface CtxToken { token: NombreToken | null; tareas: string[] }
const ctxToken = (r: RespSub[], token: NombreToken | null): CtxToken => {
  const c = r[IDX.cuenta]
  const ut = c?.ok ? c.body.user_tasks : null
  return { token, tareas: Array.isArray(ut) ? ut.map(String) : [] }
}
const estadosEquipo = (personas: Persona[], ctx: CtxToken) =>
  EQUIPO_ACCESOS.map(m => ({ m, r: estadoMiembro(personas, m, !!m.token && m.token === ctx.token && puedeAnunciar(ctx.tareas)) }))

/** Las agencias a leer en la 2.ª llamada: solo si en el portfolio dueño (o por el token) no aparece todo el equipo con permiso de anunciar. */
export function agenciasParaLeer(r: RespSub[], token: NombreToken | null = null): Agencia[] {
  if (!equipoConfigurado()) return []
  if (!r[IDX.cuenta]?.ok) return []
  const ags = agenciasConfirmadas(r)
  if (!ags.length) return []
  return estadosEquipo(personasDe(r[IDX.asignados], VIA_PORTFOLIO), ctxToken(r, token)).some(x => x.r.estado !== 'anuncia') ? ags.slice(0, MAX_AGENCIAS) : []
}

function itemAccesos(r: RespSub[], extra: LecturaAgencias | null, cuenta: { conPortfolio: boolean; miembro: boolean }, ctx: CtxToken): ItemMeta {
  if (!equipoConfigurado()) return item('sin_dato', 'Falta configurar las identidades y alias del equipo para verificar sus accesos.', 'configuración privada del equipo')
  const asignados = r[IDX.asignados], respAgencias = r[IDX.agencias]
  const personas = personasDe(asignados, VIA_PORTFOLIO)
  const leidas = new Set<string>(), sinLeer: string[] = [], vacias: string[] = []
  if (extra) {
    extra.agencias.forEach((a, i) => {
      const x = extra.respuestas?.[i]
      if (!x?.ok) return
      leidas.add(a.id)
      const ps = personasDe(x, a.nombre)
      if (!ps.length) vacias.push(a.nombre)
      personas.push(...ps)
    })
  }
  for (const a of agenciasConfirmadas(r)) if (!leidas.has(a.id)) sinLeer.push(a.nombre)   // sin 2.ª llamada, con error o más de MAX_AGENCIAS
  const estados = estadosEquipo(personas, ctx)
  const faltan = estados.filter(x => x.r.estado !== 'anuncia')
  const campo = extra ? 'act/assigned_users (portfolio dueño + agencias, por nombre) + user_tasks' : 'act/assigned_users (por nombre) + user_tasks'
  if (!faltan.length) {
    const agencias = [...new Set(estados.flatMap(x => x.r.vias))].filter(v => v !== VIA_PORTFOLIO && v !== VIA_TOKEN)
    const soloToken = estados.filter(x => x.r.vias.length === 1 && x.r.vias[0] === VIA_TOKEN).map(x => x.m.quien)
    const notas = [agencias.length ? `a través de la agencia «${lista(agencias)}»` : '', soloToken.length ? `${lista(soloToken)} según los permisos de su token` : ''].filter(Boolean)
    return item('ok', `Con acceso para anunciar: ${EQUIPO_ACCESOS.map(m => m.quien).join(' y ')}${notas.length ? ` (${notas.join('; ')})` : ''}`, campo)
  }
  // Lo que no se pudo leer: con eso no se puede afirmar que alguien NO tiene acceso ('falta' solo si se leyó todo)
  const noLeido = [
    !cuenta.conPortfolio ? 'los asignados (la cuenta no está en un portfolio comercial)'
      : !asignados?.ok ? `el portfolio dueño (${codigo(errorDeSub(asignados))})`
        : !cuenta.miembro ? 'el portfolio dueño (el token no es miembro: Meta devuelve la lista vacía)' : '',
    !respAgencias?.ok ? `las agencias de la cuenta (/agencies, ${codigo(errorDeSub(respAgencias))})` : '',
    sinLeer.length ? `la agencia «${lista(sinLeer)}»` : '',
    vacias.length ? `la agencia «${lista(vacias)}» (no muestra a nadie: el token puede no ser miembro)` : '',
  ].filter(Boolean)
  const dudas = faltan.filter(x => x.r.estado === 'dudoso'), resto = faltan.filter(x => x.r.estado !== 'dudoso')
  const quien = resto.map(({ m, r: e }) => (e.estado === 'solo_ver' ? `${m.quien} (tiene acceso pero sin permiso para anunciar)` : `${m.quien} (${m.mail})`)).join(' y ')
  const txtDudas = dudas.map(({ m, r: e }) => `aparece ${e.dudosos.map(n => `«${n}»`).join(' y ')} con permiso de anunciar: confirmar que sea ${m.quien} (${m.mail})`).join('; ')
  const conAcceso = estados.filter(x => x.r.estado === 'anuncia').map(x => x.m.quien)
  const yaEsta = conAcceso.length ? ` (${lista(conAcceso)} sí tiene acceso para anunciar)` : ''
  if (!noLeido.length) {
    if (!resto.length) return item('sin_dato', `${mayus(txtDudas)}${yaEsta}`, campo)
    return item('falta', `Falta darle acceso a ${quien}${dudas.length ? ` · ${txtDudas}` : ''}`, campo)
  }
  if (!personas.length && !conAcceso.length) return item('sin_dato', `No se pudo leer quién tiene acceso a la cuenta: ${noLeido.join('; ')}`, campo)
  const visto = [resto.length ? `No se ve a ${quien}` : '', txtDudas].filter(Boolean).join('; ')
  return item('sin_dato', `${mayus(visto)}, pero no se pudo leer el acceso por ${noLeido.join(' ni por ')}${yaEsta}`, campo)
}

/**
 * Las respuestas de la 1.ª llamada (y, si hubo, la de agencias) → los 7 ítems. Supone r[IDX.cuenta].ok. `token`: con cuál se
 * leyó (con META_CLIENTES_TOKEN los user_tasks de la cuenta cuentan como los de responsable de la cuenta; null = no se usan).
 */
export function interpretarPortfolio(r: RespSub[], extra: LecturaAgencias | null = null, token: NombreToken | null = null): Pick<PortfolioMeta, 'nombre' | 'negocio' | 'items' | 'datos'> {
  const cta = r[IDX.cuenta]
  const c = (cta?.ok ? cta.body : {}) as CuentaGraph
  const biz = c.business?.id ? c.business : null
  const nombreBiz = txt(biz?.name) || biz?.id || ''
  const verif = biz?.verification_status ?? null
  const miembro = !!verif                      // el token ve verification_status solo si es miembro del portfolio dueño
  const st = typeof c.account_status === 'number' ? c.account_status : null
  const conjuntos = datosDe(r[IDX.conjuntos])
  const creatividades = datosDe(r[IDX.creatividades])
  const items = {} as Record<ItemPortfolio, ItemMeta>

  // portfolio_comercial
  if (biz) {
    const otroDueno = c.owner && c.owner !== biz.id
    const notaVerif = verif === 'not_verified' ? ' · sin verificar (no frena nada)' : ''
    items.portfolio_comercial = item('ok', `Portfolio «${nombreBiz}»${otroDueno ? ' (la cuenta figura a nombre de otro dueño: revisar)' : ', dueño de la cuenta'}${notaVerif}`, 'act.business + owner + business.verification_status')
  } else items.portfolio_comercial = item('falta', 'La cuenta publicitaria no está en ningún portfolio comercial (es una cuenta personal)', 'act.business')

  // pagina_facebook
  const propias = datosDe(r[IDX.paginasPropias]), compartidas = datosDe(r[IDX.paginasCliente])
  const paginas = [...(propias ?? []), ...(compartidas ?? [])].map(p => txt(p.name) || txt(p.id)).filter(Boolean)
  const usadas = new Set([
    ...(conjuntos ?? []).map(s => txt((s.promoted_object as Obj | undefined)?.page_id)),
    ...(creatividades ?? []).map(k => txt((k.object_story_spec as Obj | undefined)?.page_id) || txt(k.actor_id)),
  ].filter(Boolean))
  if (paginas.length) items.pagina_facebook = item('ok', `${paginas.length === 1 ? 'Página' : 'Páginas'} en el portfolio: ${lista(paginas.map(p => `«${p}»`))}`, '{biz}/owned_pages + client_pages')
  else if (usadas.size) items.pagina_facebook = item('ok', `Los anuncios usan ${plural(usadas.size, 'página')}${biz ? ' (no se ve en el portfolio con nuestro acceso)' : ''}`, 'adsets.promoted_object + adcreatives')
  else if (!biz) items.pagina_facebook = item('sin_dato', 'La cuenta no está en un portfolio y no tiene anuncios: no se puede ver qué página usa', 'act.business')
  else if (propias && compartidas && miembro) items.pagina_facebook = item('falta', `El portfolio «${nombreBiz}» no tiene páginas (ni propias ni compartidas) y la cuenta no tiene anuncios`, '{biz}/owned_pages + client_pages')
  else {
    const e = [r[IDX.paginasPropias], r[IDX.paginasCliente]].find(x => x && !x.ok) as { error: ErrorGraph } | undefined
    items.pagina_facebook = item('sin_dato', 'No se ven las páginas del portfolio con nuestro acceso y la cuenta no tiene anuncios: revisalo en el portfolio del cliente (Configuración del negocio → Páginas)', '{biz}/owned_pages + client_pages', false,
      `páginas del portfolio: ${e ? codigo(e.error) : 'el token no es miembro del portfolio'}`)
  }

  // instagram (vacío NO es 'falta': el IG vinculado solo a la página no se ve con este token). Seguro = listado por el
  // portfolio o la cuenta; si solo sale de las creatividades puede ser la cuenta «usando la página» → 'ok' débil.
  const igs = new Map<string, { usuario: string | null; seguro: boolean }>()
  for (const x of [...(datosDe(r[IDX.igNegocio]) ?? []), ...(datosDe(r[IDX.igCuenta]) ?? [])]) if (txt(x.id)) igs.set(txt(x.id), { usuario: txt(x.username) || null, seguro: true })
  for (const k of creatividades ?? []) {
    const id = txt(k.instagram_user_id) || txt((k.object_story_spec as Obj | undefined)?.instagram_user_id)
    if (id && !igs.has(id)) igs.set(id, { usuario: null, seguro: false })
  }
  if (igs.size) {
    const nombres = [...igs.values()].filter(v => !!v.usuario).map(v => `@${v.usuario}`)
    const sinNombre = igs.size - nombres.length
    const debil = ![...igs.values()].some(v => v.seguro)
    items.instagram = item('ok', `Instagram: ${[...nombres, ...(sinNombre ? [sinNombre === 1 ? 'una cuenta usada en los anuncios' : `${sinNombre} cuentas usadas en los anuncios`] : [])].join(', ')}`, '{biz}/instagram_accounts + act/instagram_accounts + adcreatives', debil)
  } else items.instagram = item('sin_dato', 'No se ve Instagram en el portfolio, la cuenta ni los anuncios. Meta no nos deja ver el Instagram vinculado solo a la página: revisalo en el portfolio del cliente (Configuración del negocio → Cuentas de Instagram)', '{biz}/instagram_accounts + act/instagram_accounts + adcreatives', false,
    'Instagram: el token no tiene instagram_basic / pages_read_engagement (el vinculado solo a la página no se ve)')

  // whatsapp_business (solo se puede deducir de los anuncios: 'ok' débil, un destino WhatsApp no prueba que sea Business)
  const wa = (conjuntos ?? []).filter(s => /WHATSAPP/i.test(txt(s.destination_type)))
  if (wa.length) {
    const activos = wa.filter(s => s.effective_status === 'ACTIVE').length
    items.whatsapp_business = item('ok', `Deducido de los anuncios: ${plural(wa.length, 'conjunto')} con destino WhatsApp (${plural(activos, 'activo')})`, 'adsets.destination_type', true)
  } else items.whatsapp_business = item('sin_dato', conjuntos
    ? 'Todavía no hay anuncios a WhatsApp y Meta no nos deja leer el número de la página: revisalo en la página (Configuración → WhatsApp)'
    : 'No se pudieron leer los anuncios de la cuenta y Meta no nos deja leer el número de la página: revisalo en la página (Configuración → WhatsApp)', 'adsets.destination_type', false,
    `WhatsApp: page.whatsapp_number no se puede leer con el token (#100)${conjuntos ? '' : `; adsets: ${codigo(errorDeSub(r[IDX.conjuntos]))}`}`)

  // tarjeta (solo "hay medio de pago sí/no" y el tipo; deuda = account_status 3/8/9, no el balance)
  const fsd = c.funding_source_details
  const tipo = typeof fsd?.type === 'number' ? fsd.type : null
  const tipoPago = tipo !== null && !SIN_MEDIO.has(tipo) ? tipo : null
  const tipoRaro = tipoPago !== null && !TIPO_PAGO[tipoPago]
  const hayMedio: boolean | null = tipoRaro ? null : tipoPago !== null || (!!fsd && fsd.type === undefined && !!fsd.id)
  const nombrePago = tipoPago !== null ? TIPO_PAGO[tipoPago] ?? `tipo ${tipoPago}` : hayMedio ? 'tipo no informado' : null
  const puedeVerPago = !Array.isArray(c.user_tasks) || c.user_tasks.includes('MANAGE')
  if (st !== null && ESTADOS_DEUDA.has(st)) items.tarjeta = item('problema', `Cuenta ${ESTADO_CUENTA[st]}: hay que regularizar el pago${hayMedio === false ? ' (y no tiene medio de pago cargado)' : ''}`, 'act.account_status')
  else if (st === 2 && c.disable_reason === BAJA_RIESGO_PAGOS) items.tarjeta = item('problema', 'Cuenta deshabilitada por riesgo en los pagos: revisar el medio de pago', 'act.account_status + disable_reason')
  else if (tipoRaro) items.tarjeta = item('sin_dato', `Meta informa un medio de pago de tipo ${tipoPago}, que no es uno reconocido: revisar a mano`, 'act.funding_source_details')
  else if (hayMedio) items.tarjeta = item('ok', `Hay medio de pago: sí (${nombrePago}${c.is_prepay_account ? ', cuenta prepaga' : ''}); sin deuda`, 'act.funding_source_details + account_status')
  else if (!puedeVerPago) items.tarjeta = item('sin_dato', 'Nuestro acceso a la cuenta no deja ver el medio de pago (hace falta permiso para administrarla): revisalo en la cuenta (Configuración de pagos)', 'act.user_tasks', false,
    'Tarjeta: el token no tiene MANAGE en la cuenta (user_tasks)')
  else items.tarjeta = item('falta', 'Hay medio de pago: no (la cuenta no tiene tarjeta cargada)', 'act.funding_source_details')

  // verificacion (estado de la cuenta + verificación del portfolio)
  const txtVerif = verif ? VERIF[verif] ?? verif : biz ? 'verificación no visible con este token' : 'sin portfolio'
  const motivo = typeof c.disable_reason === 'number' && c.disable_reason > 0 ? ` (motivo: ${MOTIVO_BAJA[c.disable_reason] ?? `código ${c.disable_reason}`})` : ''
  if (st === null) items.verificacion = item('sin_dato', 'Meta no devolvió el estado de la cuenta', 'act.account_status')
  else if (ESTADOS_DEUDA.has(st)) items.verificacion = item('problema', `Cuenta ${ESTADO_CUENTA[st]} (ver Tarjeta); portfolio: ${txtVerif}`, 'act.account_status + business.verification_status')
  else if (!ESTADOS_ACTIVA.has(st)) items.verificacion = item('problema', `Cuenta ${ESTADO_CUENTA[st] ?? `en estado ${st}`}${motivo}; portfolio: ${txtVerif}`, 'act.account_status + disable_reason')
  else if (verif && VERIF_MAL.has(verif)) items.verificacion = item('problema', `Cuenta activa; portfolio: ${txtVerif}`, 'business.verification_status')
  else if (verif === 'not_verified') items.verificacion = item(ESTADO_PORTFOLIO_SIN_VERIFICAR, 'Cuenta publicitaria activa, sin restricciones · el portfolio no está verificado por Meta (no frena nada)', 'act.account_status + business.verification_status')
  else items.verificacion = item('ok', `Cuenta activa; portfolio: ${txtVerif}`, 'act.account_status + business.verification_status')

  // accesos_equipo
  items.accesos_equipo = itemAccesos(r, extra, { conPortfolio: !!biz, miembro }, ctxToken(r, token))

  return {
    nombre: txt(c.name) || null,
    negocio: biz ? { id: biz.id!, nombre: txt(biz.name) } : null,
    items,
    datos: {
      estado_cuenta: st,
      motivo_baja: typeof c.disable_reason === 'number' ? c.disable_reason : null,
      prepago: typeof c.is_prepay_account === 'boolean' ? c.is_prepay_account : null,
      hay_medio_pago: hayMedio,
      tipo_medio_pago: nombrePago,
      verificacion_portfolio: verif,
      token_miembro_portfolio: miembro,
      agencias: agenciasConfirmadas(r).map(a => a.nombre),
      moneda: /^[A-Z]{3}$/.test(txt(c.currency)) ? txt(c.currency) : null,
      zona_horaria: /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,3}$/.test(txt(c.timezone_name)) ? txt(c.timezone_name) : null,
    },
  }
}

// ── 4. Sin lectura (puro): cuenta no encontrada, sin acceso, token roto, límite, timeout… ──
export interface ExtraSinLectura extends Partial<Pick<PortfolioMeta, 'llamadas' | 'ms' | 'token' | 'generado'>> {
  topeMs?: number                 // el tope real del chequeo (para el texto del timeout); por defecto TIMEOUT_TOTAL_MS
  tokensInvalidos?: NombreToken[] // los que dieron #190/#102 o error de toda la llamada (para el aviso de renovarlos)
}
const segundos = (ms: number) => (ms / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })

/**
 * Los 7 ítems cuando no se pudo leer la cuenta. En 'sin_acceso', `extra.token` es el token con el que la cuenta dijo que no:
 * accesos_equipo queda 'falta' (para responsable de la cuenta) SOLO si fue el suyo (META_CLIENTES_TOKEN); si no, 'sin_dato'.
 */
export function portfolioSinLectura(cuenta: string | null, motivo: MotivoSinLectura, error?: ErrorGraph | string | null, extra: ExtraSinLectura = {}): PortfolioMeta {
  const det = typeof error === 'string' ? error : error?.message ?? ''
  const err = typeof error === 'object' && error ? error : null
  const cod = err ? codigo(err) : ''
  const equipo = EQUIPO_ACCESOS.map(m => `${m.quien} (${m.mail})`).join(' y ')
  const [gero, valen] = EQUIPO_ACCESOS
  const deGero = equipoConfigurado() && !!gero.token && extra.token === gero.token          // el "no" de la cuenta lo recibió el token de Gerónimo Actis
  const deSystemUser = extra.token === 'META_ANUNCIOS_TOKEN'
  const idDudoso = err?.code === 100 ? ' (o el id de la cuenta está mal: revisar Cuentas Meta)' : ''
  const invalidos = [...new Set(extra.tokensInvalidos ?? [])]
  const renovar = invalidos.length ? `renovar ${invalidos.join(' y ')} (vencido o inválido)` : ''
  const rotos = invalidos.length ? invalidos.join(' y ') : extra.token ?? 'META_CLIENTES_TOKEN'
  const textos: Record<MotivoSinLectura, { detalle: string; aviso: string }> = {
    sin_cuenta: { detalle: det || 'No se encontró la cuenta publicitaria del cliente', aviso: 'Cargar la cuenta publicitaria en Cuentas Meta (CRM) y volver a chequear' },
    sin_acceso: {
      detalle: `Meta no deja leer la cuenta ${cuenta ?? ''} con nuestro acceso${cod ? ` (${cod})` : ''}${idDudoso}`.replace('  ', ' '),
      aviso: deGero
        ? `Pedirle al cliente que le dé acceso a la cuenta a ${equipo}${idDudoso}${renovar ? `; además, ${renovar}` : ''}`
        : `Revisar a mano los accesos: ${deSystemUser ? 'el system user (META_ANUNCIOS_TOKEN)' : 'el token del tablero'} no ve la cuenta${idDudoso} y con el token de ${gero.quien} no se pudo probar${renovar ? `; ${renovar}` : ''}`,
    },
    token_invalido: {
      detalle: `El token de Meta ${rotos} está vencido o es inválido${cod ? ` (${cod})` : ''}: no se pudo leer la cuenta`,
      aviso: `Renovar ${rotos} y volver a chequear (no es un problema de la cuenta del cliente)`,
    },
    limite: { detalle: `Meta limitó las consultas${cod ? ` (${cod})` : ''}`, aviso: 'Reintentar el chequeo en unos minutos' },
    timeout: { detalle: `Meta no respondió en ${segundos(extra.topeMs ?? TIMEOUT_TOTAL_MS)} s`, aviso: 'Reintentar el chequeo en unos minutos' },
    sin_token: { detalle: 'Falta configurar META_CLIENTES_TOKEN (o META_ANUNCIOS_TOKEN)', aviso: 'Configurar el token de lectura de Meta' },
    error: { detalle: `No se pudo leer la cuenta${det ? `: ${det}` : ''}${cod && !det.includes(cod) ? ` (${cod})` : ''}`, aviso: 'Reintentar el chequeo; si sigue, revisar la cuenta a mano' },
  }
  const { detalle, aviso } = textos[motivo]
  const items = {} as Record<ItemPortfolio, ItemMeta>
  for (const k of ITEMS_PORTFOLIO) items[k] = item('sin_dato', detalle, motivo === 'sin_cuenta' ? 'búsqueda de cuenta' : 'act')
  // Solo el token de responsable de la cuenta dice algo de su acceso: si ÉL no ve la cuenta, le falta (lo de Valentino no se puede ver)
  if (motivo === 'sin_acceso') items.accesos_equipo = deGero
    ? item('falta', `${detalle}: falta darle acceso a ${gero.quien} (${gero.mail}); lo de ${valen.quien} no se puede ver`, 'act')
    : item('sin_dato', `${detalle}: así no se sabe si ${gero.quien} y ${valen.quien} tienen acceso`, 'act', false,
      `accesos: el "no" de la cuenta lo dio ${deSystemUser ? 'el system user (META_ANUNCIOS_TOKEN)' : extra.token ?? 'un token'}, no el de ${gero.quien}`)
  return {
    cuenta, nombre: null, negocio: null, items, leido: false, motivo, aviso, datos: null,
    llamadas: extra.llamadas ?? 0, ms: extra.ms ?? 0, token: extra.token ?? null, generado: extra.generado ?? new Date().toISOString(),
  }
}

// ── 5. Red: chequearPortfolio(cuentaId) ──
export interface DepsPortfolio {
  fetch?: typeof fetch
  tokens?: TokenMeta[]            // por defecto tokensMeta() (META_ANUNCIOS_TOKEN y META_CLIENTES_TOKEN)
  timeoutMs?: number              // tope TOTAL del chequeo (por defecto TIMEOUT_TOTAL_MS)
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
}

type Llamada = RespLote & { timeout?: boolean }
async function llamarLote(f: typeof fetch, token: string, pedidos: PedidoBatch[], restanteMs: number, limpiar: (s: string) => string): Promise<Llamada> {
  try {
    const body = new URLSearchParams({ access_token: token, include_headers: 'false', batch: JSON.stringify(pedidos) })
    const r = await f(`${GRAPH}/`, { method: 'POST', body, cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, restanteMs)) })
    const j: unknown = await r.json()
    return leerLote(j, pedidos.length, limpiar, r.status)
  } catch (e) {
    const nombre = (e as Error)?.name ?? ''
    const timeout = nombre === 'TimeoutError' || nombre === 'AbortError'
    return { ok: false, timeout, error: { code: timeout ? undefined : 2, message: limpiar(timeout ? 'Meta no respondió a tiempo' : `error de red (${(e as Error)?.message ?? nombre})`).slice(0, 200) } }
  }
}

/** Chequea los 7 ítems en la cuenta publicitaria `cuentaId` (solo GET). Nunca lanza: lo que falla queda 'sin_dato' con el motivo. */
export async function chequearPortfolio(cuentaId: string, deps: DepsPortfolio = {}): Promise<PortfolioMeta> {
  const ahora = deps.ahora ?? Date.now
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>(res => setTimeout(res, ms)))
  const t0 = ahora()
  const generado = new Date(t0).toISOString()
  const topeMs = deps.timeoutMs ?? TIMEOUT_TOTAL_MS
  const hasta = t0 + topeMs
  const restante = () => hasta - ahora()
  const act = idCuenta(cuentaId)
  let llamadas = 0
  const fin = (motivo: MotivoSinLectura, error?: ErrorGraph | string | null, token: NombreToken | null = null, tokensInvalidos: NombreToken[] = []) =>
    portfolioSinLectura(act ?? (String(cuentaId).slice(0, 40) || null), motivo, error, { llamadas, ms: ahora() - t0, token, generado, topeMs, tokensInvalidos })
  if (!act) return fin('error', `id de cuenta inválido «${String(cuentaId).slice(0, 40)}»`)
  const tokens = deps.tokens ?? tokensMeta()
  if (!tokens.length) return fin('sin_token')
  const f = deps.fetch ?? globalThis.fetch
  const limpiar = (s: string) => sinTokensDe(s, tokens)
  const pedidos = pedidosPortfolio(act)

  // 1.ª llamada: con cada token en orden hasta que uno lea la cuenta. Token roto (#190/#102, o error de permisos de toda la
  // llamada) y "no" de la cuenta (#200, #10, #100…) pasan al siguiente, pero se guardan aparte: solo el "no" de la cuenta
  // con META_CLIENTES_TOKEN dice algo de los accesos. Límite → se corta. Transitorio → una vez más con el mismo token.
  let r: RespSub[] | null = null, usado: TokenMeta | null = null
  let noCuenta: { error: ErrorGraph; token: NombreToken } | null = null
  const rotos: { error: ErrorGraph; token: NombreToken }[] = []
  porToken: for (const t of tokens) {
    for (let intento = 0; intento < 2; intento++) {
      if (restante() < 300) return fin('timeout', null, t.nombre)
      llamadas++
      const x = await llamarLote(f, t.token, pedidos, restante(), limpiar)
      const err = x.ok ? errorDeSub(x.resp[IDX.cuenta]) : x.error
      if (!err && x.ok) { r = x.resp; usado = t; break porToken }
      if (!x.ok && x.timeout) return fin('timeout', null, t.nombre)
      if (esLimite(err?.code)) return fin('limite', err, t.nombre)
      if (err && (esErrorToken(err) || (!x.ok && esErrorPermisos(err.code, err.subcode)))) { rotos.push({ error: err, token: t.nombre }); continue porToken }
      if (err && esSinAccesoCuenta(err)) {
        if (!noCuenta || t.nombre === 'META_CLIENTES_TOKEN') noCuenta = { error: err, token: t.nombre }
        continue porToken
      }
      if (esTransitorio(err?.code) && intento === 0 && restante() > 4_000) { await esperar(ESPERA_TRANSITORIO_MS); continue }
      return fin('error', err, t.nombre)
    }
  }
  if (!r || !usado) {
    const invalidos = rotos.map(x => x.token)
    if (noCuenta) return fin('sin_acceso', noCuenta.error, noCuenta.token, invalidos)
    const ultimo = rotos[rotos.length - 1]
    return fin(ultimo ? 'token_invalido' : 'error', ultimo?.error ?? null, ultimo?.token ?? null, invalidos)
  }

  // 2.ª llamada (solo si hace falta): los asignados a través de cada agencia confirmada
  let extra: LecturaAgencias | null = null
  const agencias = agenciasParaLeer(r, usado.nombre)
  if (agencias.length) {
    let respuestas: RespSub[] | null = null
    if (restante() > 500) {
      llamadas++
      const x = await llamarLote(f, usado.token, pedidosAgencias(act, agencias.map(a => a.id)), restante(), limpiar)
      respuestas = x.ok ? x.resp : null
    }
    extra = { agencias, respuestas }
  }
  const leido = interpretarPortfolio(r, extra, usado.nombre)
  const accesoFalta = leido.items.accesos_equipo.estado === 'falta'
  return {
    cuenta: act, ...leido, leido: true, motivo: null,
    aviso: accesoFalta ? `Pedirle al cliente: ${leido.items.accesos_equipo.detalle.split(' · ')[0].replace(/^Falta darle/, 'darle')}` : null,
    llamadas, ms: ahora() - t0, token: usado.nombre, generado,
  }
}

// ── 6. Cuál es la cuenta del cliente: buscarCuentaCliente(cliente) ──
export interface ClienteParaCuenta {
  cliente_crm: string | null      // nombre canónico del CRM (ClienteFicha.cliente_crm); null = sin verificar
  cuentas?: string[]              // ClienteFicha.cuentas: ids (act_…) o nombres de cuenta de "Cuentas Meta" / AJUSTES_CUENTA
}
export interface CuentaEncontrada {
  id: string
  nombre: string | null
  estado: number | null           // account_status del descubrimiento (null = vino del CRM sin pasar por Meta)
  negocio: string | null
  origen: 'crm' | 'descubrimiento'
}
export interface BusquedaCuenta { cuentas: CuentaEncontrada[]; origen: 'crm' | 'descubrimiento' | null; aviso: string | null; avisos: string[] }

/** Lo que hace falta del tablero para el paso 2 (inyectable en los tests). */
export interface FuentesCuenta {
  descubiertas: CuentaDescubierta[]
  resolver: (c: { id: string; nombre: string; negocio?: string | null }) => { cliente: { nombre: string } | null; nombreColC: string }
  excluidas: string[]             // CUENTAS_EXCLUIDAS
  esPropia: (id: string) => boolean
  avisos: string[]                // lo que no se pudo leer (CRM, descubrimiento)
}
export interface DepsBuscarCuenta { fuentes?: () => Promise<FuentesCuenta>; topeMs?: number }

const ORDEN_ESTADO = (e: number | null) => (e === 1 || e === 201 ? 0 : e === 100 || e === 101 || e === 202 ? 2 : 1)
const ordenar = (xs: CuentaEncontrada[]) => [...xs].sort((a, b) => ORDEN_ESTADO(a.estado) - ORDEN_ESTADO(b.estado))   // estable: a igual estado, el orden del CRM

/** Paso 2 (puro): las cuentas descubiertas que el cruce del tablero asigna a `clienteCrm`. Activas primero; cerradas al final. */
export function elegirCuentasCliente(clienteCrm: string, f: FuentesCuenta): CuentaEncontrada[] {
  const objetivo = normNombre(clienteCrm)
  if (!objetivo) return []
  const fuera = new Set(f.excluidas.map(x => idCuenta(x) ?? x))
  const out: CuentaEncontrada[] = []
  for (const d of f.descubiertas) {
    const id = idCuenta(d.id)
    if (!id || fuera.has(id) || f.esPropia(id)) continue
    const res = f.resolver({ id, nombre: d.nombre, negocio: d.negocio?.nombre ?? null })
    if (normNombre(res.cliente?.nombre) === objetivo || normNombre(res.nombreColC) === objetivo)
      out.push({ id, nombre: d.nombre, estado: d.estado, negocio: d.negocio?.nombre ?? null, origen: 'descubrimiento' })
  }
  return ordenar(out)
}

/**
 * Las fuentes reales: las MISMAS cachés del tablero ('descubrir' y 'sheets', mismos plazos) + crearCruce. Solo lectura. Si
 * Sheets o Meta fallan, sigue con lo que haya y lo anota en avisos. Conviene arrancarla temprano (en paralelo con Claude, como los ganadores) y pasarla
 * como deps.fuentes = () => promesa: en frío el descubrimiento tarda ~9 s; con la caché caliente, nada.
 */
export async function fuentesCuentaTablero(): Promise<FuentesCuenta> {
  const [{ conCache }, { REFRESCO }, meta, { leerSheets }, { crearCruce }, cuentas, { hoyAR }] = await Promise.all([
    import('@/lib/anuncios/cache'), import('@/lib/anuncios/tablero'), import('@/lib/anuncios/meta'), import('@/lib/anuncios/sheets'),
    import('@/lib/anuncios/cruce'), import('@/lib/anuncios/cuentas'), import('@/lib/anuncios/formato'),
  ])
  const hoy = hoyAR()
  const seguro = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p } catch { return null } }
  const [sheetsR, descR] = await Promise.all([
    seguro(conCache('sheets', REFRESCO.sheetsSeg, async () => {
      const s = await leerSheets(hoy)
      if (s.errores.length) throw new Error(s.errores.join(' · '))   // no cachear una lectura incompleta (igual que el tablero)
      return s
    })),
    seguro(conCache('descubrir', REFRESCO.descubrimientoSeg, async () => {
      const d = await meta.descubrirCuentas()
      if (!d.cuentas.length) throw new Error(d.errores[0] ?? 'Meta no devolvió cuentas')
      return d
    })),
  ])
  const avisos: string[] = []
  if (!sheetsR) avisos.push('sin CRM: no se pudo cruzar las cuentas con el cliente')
  if (!descR) avisos.push('sin descubrimiento de cuentas de Meta')
  const cruce = crearCruce(sheetsR?.data ?? { clientes: [], cuentasMeta: [], alias: [], guiones: [], errores: [] })
  return {
    descubiertas: descR?.data.cuentas ?? [],
    resolver: c => cruce.resolverCliente(c),
    excluidas: cuentas.cargarCuentas().excluidas,
    esPropia: cuentas.esCuentaPropia,
    avisos,
  }
}

const conTope = <T,>(p: Promise<T>, ms: number, que: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${que}: tardó más de ${Math.round(ms / 1000)} s`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })

const AVISO_CARGAR = 'cargar la cuenta publicitaria en Cuentas Meta'

/** Las cuentas publicitarias del cliente: 1) las del contexto; 2) descubrimiento + cruce del tablero; 3) ninguna, con aviso. Nunca lanza. */
export async function buscarCuentaCliente(cliente: ClienteParaCuenta, deps: DepsBuscarCuenta = {}): Promise<BusquedaCuenta> {
  const delContexto = (cliente.cuentas ?? []).map(x => String(x ?? '').trim()).filter(Boolean)
  const ids = [...new Set(delContexto.map(idCuenta).filter((x): x is string => !!x))]
  const desdeCrm = (id: string): CuentaEncontrada => ({ id, nombre: null, estado: null, negocio: null, origen: 'crm' })
  if (ids.length === 1) return { cuentas: [desdeCrm(ids[0])], origen: 'crm', aviso: null, avisos: [] }
  const fuentes = () => conTope((deps.fuentes ?? fuentesCuentaTablero)(), deps.topeMs ?? TOPE_BUSQUEDA_MS, 'búsqueda de la cuenta')
  const motivoDe = (e: unknown) => ((e as Error)?.message ?? 'error').slice(0, 160)
  // 1. Varias en el CRM ("Cuentas Meta" con la ARS vieja y la USD nueva, p. ej.): se cruzan con lo descubierto (misma caché
  //    del tablero) para revisar primero la activa; si el descubrimiento falla, el orden del CRM. Siempre con aviso.
  if (ids.length > 1) {
    let f: FuentesCuenta | null = null, avisos: string[] = []
    try { f = await fuentes(); avisos = f.avisos } catch (e) { avisos = [motivoDe(e)] }
    const porId = new Map((f?.descubiertas ?? []).map(d => [idCuenta(d.id), d] as const))
    const cuentas = ordenar(ids.map(id => {
      const d = porId.get(id)
      return d ? { id, nombre: d.nombre, estado: d.estado, negocio: d.negocio?.nombre ?? null, origen: 'crm' as const } : desdeCrm(id)
    }))
    const sinEstado = !cuentas.some(c => c.estado !== null)
    return { cuentas, origen: 'crm', aviso: `el cliente tiene ${ids.length} cuentas en el CRM: se revisa «${cuentas[0].nombre ?? cuentas[0].id}»${sinEstado ? ' (sin saber cuál está activa)' : ''}`, avisos }
  }
  const nombres = new Set(delContexto.filter(x => !idCuenta(x)).map(normNombre).filter(Boolean))
  if (!cliente.cliente_crm && !nombres.size)
    return { cuentas: [], origen: null, aviso: `El cliente no está verificado en el CRM: no se puede buscar su cuenta; ${AVISO_CARGAR}`, avisos: [] }

  let f: FuentesCuenta
  try {
    f = await fuentes()
  } catch (e) {
    const motivo = motivoDe(e)
    return { cuentas: [], origen: null, aviso: `No se pudo buscar la cuenta (${motivo}); ${AVISO_CARGAR}`, avisos: [motivo] }
  }
  // 1b. "Cuentas Meta" a veces tiene el NOMBRE de la cuenta (col A "cuenta o id"): se resuelve contra lo descubierto
  if (nombres.size) {
    const porNombre = ordenar(f.descubiertas.filter(d => nombres.has(normNombre(d.nombre)) && idCuenta(d.id))
      .map(d => ({ id: idCuenta(d.id)!, nombre: d.nombre, estado: d.estado, negocio: d.negocio?.nombre ?? null, origen: 'crm' as const })))
    if (porNombre.length) return { cuentas: porNombre, origen: 'crm', aviso: null, avisos: f.avisos }
  }
  // 2. Descubrimiento + cruce, filtrado por el cliente del CRM
  const encontradas = cliente.cliente_crm ? elegirCuentasCliente(cliente.cliente_crm, f) : []
  if (encontradas.length) {
    const varias = encontradas.length > 1 ? `el cliente tiene ${encontradas.length} cuentas en Meta: se revisa «${encontradas[0].nombre ?? encontradas[0].id}»` : null
    return { cuentas: encontradas, origen: 'descubrimiento', aviso: varias, avisos: f.avisos }
  }
  const nombre = cliente.cliente_crm ?? [...nombres][0]
  return { cuentas: [], origen: null, aviso: `No apareció ninguna cuenta publicitaria de ${nombre} en Meta${f.avisos.length ? ` (${f.avisos.join('; ')})` : ''}: ${AVISO_CARGAR}`, avisos: f.avisos }
}

/** Atajo: busca la cuenta del cliente y la chequea (la primera: activas primero). Sin cuenta → todo 'sin_dato' con el aviso. */
export async function portfolioDelCliente(cliente: ClienteParaCuenta, deps: DepsPortfolio & DepsBuscarCuenta = {}): Promise<PortfolioMeta & { busqueda: BusquedaCuenta }> {
  const busqueda = await buscarCuentaCliente(cliente, deps)
  // El detalle de cada ítem dice por qué no hay cuenta; el aviso, qué hacer (cargarla en "Cuentas Meta")
  if (!busqueda.cuentas.length) return { ...portfolioSinLectura(null, 'sin_cuenta', busqueda.aviso?.replace(/[:;] cargar la cuenta publicitaria en Cuentas Meta$/, '') ?? null), busqueda }
  const p = await chequearPortfolio(busqueda.cuentas[0].id, deps)
  return { ...p, aviso: [p.aviso, busqueda.aviso].filter(Boolean).join(' · ') || null, busqueda }
}

// ── 7. Fusión con lo que se dijo en la llamada (puro) ──
/** Lo que trae la ficha de la llamada (ChequeoPortfolio de tipos.ts encaja): 'ok' | 'falta' | 'problema' | 'sin_verificar' | 'no_se_hablo'. */
export interface ItemLlamada { estado: string; detalle?: string; cita?: string; timestamp?: string | null; textual?: boolean }
/** Un ítem del portfolio final (es ItemPortfolioFinal de tipos.ts: la ficha guarda esto en portfolio_final). */
export type ItemCombinado = ItemPortfolioFinal

const ESTADOS_LLAMADA = new Set(['ok', 'falta', 'problema', 'sin_verificar'])
const OPINA = (l: ItemCombinado['llamada']): l is NonNullable<ItemCombinado['llamada']> & { estado: 'ok' | 'falta' | 'problema' } =>
  !!l && l.estado !== 'sin_verificar'

/**
 * Manda Meta salvo que diga 'sin_dato' (o no se haya consultado); ahí queda lo de la llamada. En tarjeta, portfolio_comercial,
 * pagina_facebook, accesos_equipo y verificacion Meta es la fuente fuerte. En instagram y whatsapp_business Meta solo dice
 * 'sin_dato' o un 'ok' débil (deducido de los anuncios): ese 'ok' no le gana a un 'falta'/'problema' de la llamada, que queda
 * con la nota de Meta para revisar.
 */
/** Lo mínimo que necesita la fusión de Meta: sirve la salida de chequearPortfolio y la LecturaPortfolioMeta de la ficha. */
export interface ItemsMeta { items?: Partial<Record<ItemPortfolio, { estado: EstadoItemMeta; detalle: string; debil?: boolean }>> }

export function combinarPortfolio(meta: ItemsMeta | null | undefined, llamada: Partial<Record<ItemPortfolio, ItemLlamada>> | null | undefined): Record<ItemPortfolio, ItemCombinado> {
  const out = {} as Record<ItemPortfolio, ItemCombinado>
  for (const k of ITEMS_PORTFOLIO) {
    const mi = meta?.items?.[k]
    const m = mi ? { estado: mi.estado, detalle: mi.detalle } : null
    const l0 = llamada?.[k]
    const l: ItemCombinado['llamada'] = l0 && ESTADOS_LLAMADA.has(l0.estado)
      ? { estado: l0.estado as 'ok' | 'falta' | 'problema' | 'sin_verificar', detalle: (l0.detalle ?? '').trim(), cita: l0.cita ?? '', timestamp: l0.timestamp ?? null, textual: !!l0.textual }
      : null
    // Solo un 'falta'/'problema' de la llamada le gana a un 'ok' débil de Meta (un "sin verificar" no es una opinión)
    const ganaLlamada = !!(mi?.debil && m?.estado === 'ok' && OPINA(l) && l.estado !== 'ok')
    if (m && m.estado !== 'sin_dato' && !ganaLlamada) {
      const discrepancia = OPINA(l) && l.estado !== m.estado ? `en la llamada se dijo «${l.estado}»${l.detalle ? ` (${l.detalle})` : ''}` : null
      out[k] = { estado: m.estado, detalle: discrepancia ? `${m.detalle} · ojo: ${discrepancia}` : m.detalle, fuente: 'meta', meta: m, llamada: l, discrepancia }
    } else if (OPINA(l)) {
      const base = l.detalle || (l.estado === 'ok' ? 'Confirmado en la llamada' : `En la llamada: ${l.estado}`)
      const discrepancia = ganaLlamada && m ? `Meta dice «ok» (${m.detalle}), pero lo deduce de los anuncios` : null
      out[k] = { estado: l.estado, detalle: discrepancia ? `${base} · ojo: ${discrepancia}: revisar` : base, fuente: 'llamada', meta: m, llamada: l, discrepancia }
    } else {
      const enLlamada = l ? `en la llamada se mencionó sin verificar${l.detalle ? ` (${l.detalle})` : ''}` : 'en la llamada no se habló'
      out[k] = { estado: 'sin_dato', detalle: `${m?.detalle ?? 'Meta no se consultó'} · ${enLlamada}`, fuente: 'ninguna', meta: m, llamada: l, discrepancia: null }
    }
  }
  return out
}

// ── 8. Lo que guarda la ficha (puro) ──
/**
 * La salida de portfolioDelCliente (o de portfolioSinLectura) → LecturaPortfolioMeta de tipos.ts: la cabecera y los 7 ítems,
 * sin lo crudo de Graph (datos, negocio, llamadas, token). origen_cuenta: de dónde salió la cuenta revisada.
 */
export function paraFicha(p: PortfolioMeta & { busqueda?: BusquedaCuenta | null }): LecturaPortfolioMeta {
  const items = {} as LecturaPortfolioMeta['items']
  for (const k of ITEMS_PORTFOLIO) {
    const x = p.items[k]
    items[k] = { estado: x.estado, detalle: x.detalle, ...(x.debil ? { debil: true } : {}) }
  }
  const revisada = p.cuenta ? p.busqueda?.cuentas.find(c => c.id === p.cuenta) : null
  return {
    cuenta: p.cuenta, nombre: p.nombre ?? revisada?.nombre ?? null, leido: p.leido, motivo: p.motivo, aviso: p.aviso, generado: p.generado,
    origen_cuenta: revisada?.origen ?? (p.cuenta ? p.busqueda?.origen ?? null : null),
    moneda: p.datos?.moneda ?? null, zona_horaria: p.datos?.zona_horaria ?? null,
    items,
  }
}
