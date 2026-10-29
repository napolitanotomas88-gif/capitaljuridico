// ── Quién graba las kickoffs: varias cuentas de Fathom (Tomás y Gero M) ─────────────────────────────
// Las kickoffs las hacen Tomás Y Gero M (Gerónimo Mozzi), cada uno con SU cuenta de Fathom (decisión de Tomás, 24/10). Cada
// cuenta tiene su propio webhook hacia /api/bot/kickoff (triggered_for ['my_recordings']) y, por lo tanto, su propio
// secreto de firma; y su propia API key para traer una grabación que el webhook no entregó (fathomApi.ts).
// Variables, por persona (el sufijo sale de GRABADORES):
//   · FATHOM_KICKOFF_WEBHOOK_SECRET_<QUIEN> → secreto whsec_… del webhook de esa cuenta. Lo escribe en .env.local el CLI
//     scripts/fathom-webhook-kickoff.mjs al crear el webhook (sin mostrarlo); en Vercel se carga a mano;
//   · FATHOM_KICKOFF_WEBHOOK_SECRET (sin sufijo) → el de Tomás de antes de esto: se sigue aceptando (compatibilidad);
//   · FATHOM_API_KEY_<QUIEN> → API key de Fathom de esa persona (Settings → API Access). Solo para leer reuniones y crear
//     o borrar SU webhook: nunca se loguea ni se devuelve.
// La firma vale si verifica con ALGUNO de los secretos configurados: se prueban TODOS siempre (sin cortar en el primero
// que coincide), cada uno con la comparación en tiempo constante de lib/fathomAnuncios/firma.ts, así el tiempo de respuesta
// no dice con cuál coincidió. Del resultado sale el NOMBRE de la variable que verificó (para el log), nunca el valor.
// Fallar cerrado: sin ningún secreto, o con todos mal formados → la ruta responde 503 (nunca acepta sin firma). Puro: el
// entorno se inyecta (los tests no tocan process.env).
// Revisión del 24/10:
//   · un secreto cuya clave decodificada tiene menos de MIN_BYTES_SECRETO (24, el mínimo de Standard Webhooks y de los whsec_
//     de Fathom) cuenta como MAL CONFIGURADO: un placeholder como whsec_AA abría la ruta con una clave de 1 byte (256
//     intentos). No se usa para verificar y el GET de estado lo muestra en firmas_invalidas;
//   · lista CERRADA: solo FATHOM_KICKOFF_WEBHOOK_SECRET_<sufijo de GRABADORES> y el de compatibilidad. Otra variable con el
//     mismo prefijo (un secreto viejo renombrado "por las dudas", _TOMAS_VIEJO) NO autentica: va a `ignoradas`, que se
//     loguea y sale en el GET de estado. Con la lista cerrada son 3 como mucho: no hace falta tope.
import { SECRETO_MAL_CONFIGURADO, claveDeSecreto, verificarFirma, type CabecerasFirma } from '@/lib/fathomAnuncios/firma'

export const GRABADORES = {
  tomas: { nombre: 'Tomás', sufijo: 'TOMAS' },
  gero_m: { nombre: 'Gero M', sufijo: 'GERO_M' },
} as const
export type Quien = keyof typeof GRABADORES
export const QUIENES = Object.keys(GRABADORES) as Quien[]

/** El secreto de Tomás de antes de que hubiera varios Fathom: vale igual que FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS. */
export const VAR_SECRETO_COMPAT = 'FATHOM_KICKOFF_WEBHOOK_SECRET'
export const varSecreto = (q: Quien): string => `${VAR_SECRETO_COMPAT}_${GRABADORES[q].sufijo}`
export const varApiKey = (q: Quien): string => `FATHOM_API_KEY_${GRABADORES[q].sufijo}`
const RE_VAR_SECRETO = /^FATHOM_KICKOFF_WEBHOOK_SECRET_[A-Z0-9_]{1,40}$/
/** Standard Webhooks pide secretos de 24 a 64 bytes; los whsec_ de Fathom tienen 32. Menos que esto se adivina. */
export const MIN_BYTES_SECRETO = 24

type Entorno = Record<string, string | undefined>

/** "gero_m", "Gero-M", "GERO M" → 'gero_m'; cualquier otra cosa → null. */
export function quienDe(x: unknown): Quien | null {
  if (typeof x !== 'string') return null
  const k = x.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return (QUIENES as string[]).includes(k) ? (k as Quien) : null
}

export interface SecretoWebhook { variable: string; quien: Quien; valor: string }

/** ¿La clave del secreto sirve? (whsec_<base64> que decodifica a MIN_BYTES_SECRETO bytes o más) */
export const secretoUsable = (valor: string): boolean => (claveDeSecreto(valor)?.length ?? 0) >= MIN_BYTES_SECRETO

/**
 * Los secretos de webhook configurados (no vacíos), de la lista cerrada: primero los de cada persona (por nombre de la
 * variable), al final el de compatibilidad (es de Tomás): si FATHOM_KICKOFF_WEBHOOK_SECRET y _TOMAS tienen el mismo valor, el
 * log dice _TOMAS. Los mal formados o cortos también vienen: verificarFirmaVarios los anota como mal configurados.
 */
export function secretosWebhook(env: Entorno = process.env): SecretoWebhook[] {
  const lista: SecretoWebhook[] = []
  for (const q of [...QUIENES].sort((a, b) => varSecreto(a).localeCompare(varSecreto(b)))) {
    const valor = env[varSecreto(q)]?.trim()
    if (valor) lista.push({ variable: varSecreto(q), quien: q, valor })
  }
  const compat = env[VAR_SECRETO_COMPAT]?.trim()
  if (compat) lista.push({ variable: VAR_SECRETO_COMPAT, quien: 'tomas', valor: compat })
  return lista
}

/** Variables con el prefijo de los secretos que NO son de la lista cerrada (no autentican): solo los nombres, para el log y el estado. */
export function variablesIgnoradas(env: Entorno = process.env): string[] {
  const validas = new Set([...QUIENES.map(varSecreto), VAR_SECRETO_COMPAT])
  return Object.keys(env).filter(k => RE_VAR_SECRETO.test(k) && !validas.has(k) && !!env[k]?.trim()).sort()
}

export type ResultadoFirmaVarios =
  | { ok: true; variable: string; quien: Quien; malConfigurados: string[] }
  /** configurado false → no hay ningún secreto usable (503); true → hay, pero la firma no verificó con ninguno (401). */
  | { ok: false; configurado: boolean; motivo: string; malConfigurados: string[] }

/**
 * Verifica la firma contra TODOS los secretos usables (sin cortar en el primero que coincide). Uno mal formado o corto
 * (secretoUsable) no se usa: queda en malConfigurados. Devuelve nombres, nunca valores.
 */
export function verificarFirmaVarios(secretos: SecretoWebhook[], cab: CabecerasFirma, cuerpo: string, ahoraMs: number = Date.now()): ResultadoFirmaVarios {
  const malConfigurados: string[] = []
  let elegido: SecretoWebhook | null = null
  let motivo: string | null = null
  for (const s of secretos) {
    if (!secretoUsable(s.valor)) { malConfigurados.push(s.variable); continue }
    const r = verificarFirma(s.valor, cab, cuerpo, ahoraMs)
    if (r.ok) elegido ??= s
    else if (r.motivo === SECRETO_MAL_CONFIGURADO) malConfigurados.push(s.variable)
    else motivo ??= r.motivo
  }
  if (elegido) return { ok: true, variable: elegido.variable, quien: elegido.quien, malConfigurados }
  if (malConfigurados.length === secretos.length) {
    return { ok: false, configurado: false, motivo: secretos.length ? SECRETO_MAL_CONFIGURADO : 'sin secretos configurados', malConfigurados }
  }
  return { ok: false, configurado: true, motivo: motivo ?? 'firma inválida', malConfigurados }
}

/**
 * Para el GET de estado: NOMBRES de lo que está configurado (secretos usables; mal formados o cortos; variables con el
 * prefijo que no autentican; API keys), nunca valores.
 */
export function estadoGrabadores(env: Entorno = process.env): { firmas: string[]; firmas_invalidas: string[]; ignoradas: string[]; api: Quien[] } {
  const secretos = secretosWebhook(env)
  return {
    firmas: secretos.filter(s => secretoUsable(s.valor)).map(s => s.variable),
    firmas_invalidas: secretos.filter(s => !secretoUsable(s.valor)).map(s => s.variable),
    ignoradas: variablesIgnoradas(env),
    api: QUIENES.filter(q => !!env[varApiKey(q)]?.trim()),
  }
}
