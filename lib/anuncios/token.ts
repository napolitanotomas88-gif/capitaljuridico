// ── Token de Meta para las cuentas de CLIENTES ("token que no se cae") ───────────────────────
// Orden de uso:
//   1. META_ANUNCIOS_TOKEN  → pensado para un token de SYSTEM USER (no vence). Si existe, va primero.
//   2. META_CLIENTES_TOKEN  → token de usuario de Gero (app "Api"), vence cada ~60 días.
// Si un pedido de una cuenta da error de permisos con el primero, se reintenta con el otro
// (ver meta.ts). META_ACCESS_TOKEN (system user "dashboard-reader") NO se usa: solo ve la cuenta
// propia y en las de clientes da #200.
//
// Salud: /debug_token calcula los días que le quedan al token principal; el tablero lo muestra
// arriba y los reportes de Discord avisan desde 10 días antes del vencimiento.
//
// Renovación (opcional): si existen META_APP_ID y META_APP_SECRET, renovarTokenLargo() cambia un
// token de usuario por uno de larga duración (~60 días) con grant_type=fb_exchange_token. NO se
// llama sola ni guarda nada: devuelve el token nuevo para que una persona lo cargue en Vercel
// (Settings → Environment Variables → META_CLIENTES_TOKEN) y redeploye. La solución definitiva es
// un system user del Business Manager con acceso a las cuentas de clientes → META_ANUNCIOS_TOKEN.

const GRAPH = 'https://graph.facebook.com/v23.0'
export const AVISO_TOKEN_DIAS = 10

export interface TokenMeta { nombre: 'META_ANUNCIOS_TOKEN' | 'META_CLIENTES_TOKEN'; token: string }

export function tokensMeta(): TokenMeta[] {
  const out: TokenMeta[] = []
  const a = process.env.META_ANUNCIOS_TOKEN?.trim()
  const c = process.env.META_CLIENTES_TOKEN?.trim()
  if (a) out.push({ nombre: 'META_ANUNCIOS_TOKEN', token: a })
  if (c && c !== a) out.push({ nombre: 'META_CLIENTES_TOKEN', token: c })
  return out
}

// Saca cualquier token de un texto (mensajes de error, URLs) antes de mostrarlo o loguearlo
export function sinTokens(texto: string): string {
  let t = texto
  for (const { token } of tokensMeta()) if (token) t = t.split(token).join('***')
  return t.replace(/access_token=[^&\s"]+/g, 'access_token=***')
}

// Error de permisos de Graph: se reintenta con el otro token
export function esErrorPermisos(code?: number, subcode?: number): boolean {
  return code === 200 || code === 10 || code === 190 || code === 803 || (code === 100 && subcode === 33) || (!!code && code >= 200 && code < 300)
}

export interface SaludToken {
  nombre: string
  valido: boolean
  tipo: string | null              // USER | SYSTEM_USER | PAGE …
  app: string | null
  vence: string | null             // ISO; null = no vence
  diasRestantes: number | null     // null = no vence (o no se pudo leer)
  accesoDatosVence: string | null  // data_access_expires_at (ISO)
  permisos: string[]
  error?: string
}

export interface EstadoToken {
  principal: SaludToken | null      // el que se usa primero
  respaldo: SaludToken | null       // el de fallback (si hay dos)
  aviso: string | null              // texto para mostrar/mandar (desde 10 días antes, o si es inválido)
  nivel: 'ok' | 'aviso' | 'critico'
  renovable: boolean                // hay META_APP_ID + META_APP_SECRET para renovarTokenLargo()
}

async function debugToken(t: TokenMeta): Promise<SaludToken> {
  try {
    const r = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(t.token)}&access_token=${encodeURIComponent(t.token)}`, { cache: 'no-store' })
    const j = await r.json() as {
      data?: { is_valid?: boolean; type?: string; application?: string; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; error?: { message?: string } }
      error?: { message?: string }
    }
    if (j.error || !j.data) return { nombre: t.nombre, valido: false, tipo: null, app: null, vence: null, diasRestantes: null, accesoDatosVence: null, permisos: [], error: sinTokens(j.error?.message ?? 'sin datos') }
    const d = j.data
    const vence = d.expires_at ? new Date(d.expires_at * 1000) : null
    return {
      nombre: t.nombre,
      valido: !!d.is_valid,
      tipo: d.type ?? null,
      app: d.application ?? null,
      vence: vence ? vence.toISOString() : null,
      diasRestantes: vence ? Math.floor((+vence - Date.now()) / 86_400_000) : null,
      accesoDatosVence: d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : null,
      permisos: d.scopes ?? [],
      ...(d.error?.message ? { error: sinTokens(d.error.message) } : {}),
    }
  } catch (e) {
    return { nombre: t.nombre, valido: false, tipo: null, app: null, vence: null, diasRestantes: null, accesoDatosVence: null, permisos: [], error: sinTokens((e as Error).message) }
  }
}

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })

export async function saludTokens(): Promise<EstadoToken> {
  const ts = tokensMeta()
  const renovable = !!(process.env.META_APP_ID && process.env.META_APP_SECRET)
  if (!ts.length) return { principal: null, respaldo: null, aviso: 'Falta configurar META_CLIENTES_TOKEN (o META_ANUNCIOS_TOKEN): el tablero no puede leer Meta.', nivel: 'critico', renovable }
  const [principal, respaldo] = await Promise.all([debugToken(ts[0]), ts[1] ? debugToken(ts[1]) : Promise.resolve(null)])
  let aviso: string | null = null
  let nivel: EstadoToken['nivel'] = 'ok'
  if (!principal.valido) {
    nivel = 'critico'
    aviso = `El token ${principal.nombre} no es válido${principal.error ? ` (${principal.error})` : ''}${respaldo?.valido ? `: se está usando ${respaldo.nombre}` : ''}. Hay que generar uno nuevo.`
  } else if (principal.diasRestantes != null && principal.diasRestantes <= AVISO_TOKEN_DIAS) {
    nivel = principal.diasRestantes <= 3 ? 'critico' : 'aviso'
    aviso = `El token de Meta (${principal.nombre}) vence en ${principal.diasRestantes} día${principal.diasRestantes === 1 ? '' : 's'} (${fechaCorta(principal.vence!)}). ` +
      `Renovarlo antes o el tablero deja de ver las cuentas. Ideal: token de system user en META_ANUNCIOS_TOKEN (no vence).`
  }
  // El de respaldo también importa: se usa para las cuentas que el principal no ve
  if (!aviso && respaldo?.valido && respaldo.diasRestantes != null && respaldo.diasRestantes <= AVISO_TOKEN_DIAS) {
    nivel = 'aviso'
    aviso = `El token de respaldo (${respaldo.nombre}) vence en ${respaldo.diasRestantes} día${respaldo.diasRestantes === 1 ? '' : 's'} (${fechaCorta(respaldo.vence!)}): ` +
      `se usa para las cuentas que ${principal.nombre} no ve. Renovarlo o darle acceso a esas cuentas al principal.`
  }
  return { principal, respaldo, aviso, nivel, renovable }
}

// Texto corto del estado del token (para el reporte semanal)
export function textoToken(e: EstadoToken): string {
  const p = e.principal
  if (!p) return 'sin token configurado'
  if (!p.valido) return `${p.nombre} INVÁLIDO${p.error ? ` (${p.error})` : ''}`
  if (p.diasRestantes == null) return `${p.nombre} (${p.tipo ?? 'token'}) sin vencimiento`
  return `${p.nombre} vence en ${p.diasRestantes} días (${fechaCorta(p.vence!)})`
}

// Cambia un token de usuario por uno de larga duración (~60 días). Requiere META_APP_ID y
// META_APP_SECRET (de la app "Api" en developers.facebook.com → Configuración → Básica).
// Devuelve el token nuevo: NO lo guarda (hay que cargarlo a mano en Vercel y redeployar).
// Uso manual, por ejemplo desde un script: await renovarTokenLargo(process.env.META_CLIENTES_TOKEN!)
export async function renovarTokenLargo(tokenActual: string): Promise<{ ok: true; token: string; venceEnDias: number | null } | { ok: false; error: string }> {
  const appId = process.env.META_APP_ID, secret = process.env.META_APP_SECRET
  if (!appId || !secret) return { ok: false, error: 'Faltan META_APP_ID y/o META_APP_SECRET: no se puede renovar automáticamente.' }
  try {
    const q = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: tokenActual })
    const r = await fetch(`${GRAPH}/oauth/access_token?${q}`, { cache: 'no-store' })
    const j = await r.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
    if (!j.access_token) return { ok: false, error: sinTokens(j.error?.message ?? `respuesta sin token (HTTP ${r.status})`) }
    return { ok: true, token: j.access_token, venceEnDias: j.expires_in ? Math.floor(j.expires_in / 86_400) : null }
  } catch (e) {
    return { ok: false, error: sinTokens((e as Error).message) }
  }
}
