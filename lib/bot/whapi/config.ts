// ── Bot "Capital Jurídico": configuración de Whapi desde el entorno (BLOQUE W) ───────────────────────────────────────────
// Lee y valida la FORMA de las variables. Nunca devuelve ni loguea un valor: lo que sale de acá hacia un log o una
// respuesta son NOMBRES de variables.
//   · WHAPI_TOKEN: token del canal (Bearer). Lo usa el cliente real; el webhook no lo necesita.
//   · WHAPI_WEBHOOK_SECRETO: el valor del header `x-cj-bot-secreto` que Whapi manda en cada webhook (se configura con
//     PATCH /settings, scripts/bot-whapi-configurar.mjs). 24 caracteres o más, sin espacios. Whapi no firma los envíos.
//   · WHAPI_CANAL_ID (opcional): channel_id del canal (ej. "MANTIS-M72HC"). Si está, se ignora lo que venga de otro canal.
//   · WHAPI_GRUPO_VENTAS y WHAPI_GRUPO_VERIFICACIONES: chat_id de "Ventas C.J." y de "Verificaciones C.J" ("…@g.us").
// Sin el secreto o sin los dos grupos el webhook falla cerrado (503).
import type { ConfigGrupos } from '@/lib/bot/alta/motor/tipos'
import { PATRON_GRUPO } from './comun'

export const HEADER_SECRETO = 'x-cj-bot-secreto'
export const SECRETO_LARGO_MIN = 24
const SECRETO_DISTINTOS_MIN = 8

export const VARIABLES_WHAPI = ['WHAPI_TOKEN', 'WHAPI_WEBHOOK_SECRETO', 'WHAPI_CANAL_ID', 'WHAPI_GRUPO_VENTAS', 'WHAPI_GRUPO_VERIFICACIONES'] as const
export type VariableWhapi = (typeof VARIABLES_WHAPI)[number]

const valor = (env: NodeJS.ProcessEnv, k: VariableWhapi): string => (env[k] ?? '').trim()

/** Un secreto usable: 24+ caracteres imprimibles sin espacios (va en un header HTTP) y no repetitivo. */
export function secretoValido(s: string): boolean {
  return s.length >= SECRETO_LARGO_MIN && /^[\x21-\x7e]+$/.test(s) && new Set(s).size >= SECRETO_DISTINTOS_MIN
}

/** Un token de Whapi con forma razonable (no se valida contra Whapi). */
export const tokenValido = (t: string): boolean => t.length >= 16 && t.length <= 256 && /^[\x21-\x7e]+$/.test(t)

const canalValido = (c: string): boolean => /^[A-Za-z0-9_-]{3,64}$/.test(c)

export interface ConfigWebhook { secreto: string; grupos: ConfigGrupos; canalId: string | null }
export type LecturaConfig = { ok: true; config: ConfigWebhook } | { ok: false; faltan: VariableWhapi[]; invalidas: VariableWhapi[] }

/** Lo que necesita el webhook. Falla cerrado: con algo faltante o mal escrito, ok: false con los NOMBRES. */
export function configWebhook(env: NodeJS.ProcessEnv = process.env): LecturaConfig {
  const faltan: VariableWhapi[] = [], invalidas: VariableWhapi[] = []
  const secreto = valor(env, 'WHAPI_WEBHOOK_SECRETO')
  if (!secreto) faltan.push('WHAPI_WEBHOOK_SECRETO')
  else if (!secretoValido(secreto)) invalidas.push('WHAPI_WEBHOOK_SECRETO')
  const ventas = valor(env, 'WHAPI_GRUPO_VENTAS'), verificaciones = valor(env, 'WHAPI_GRUPO_VERIFICACIONES')
  for (const [k, v] of [['WHAPI_GRUPO_VENTAS', ventas], ['WHAPI_GRUPO_VERIFICACIONES', verificaciones]] as const) {
    if (!v) faltan.push(k)
    else if (!PATRON_GRUPO.test(v)) invalidas.push(k)
  }
  // Los dos grupos iguales: un OK en Ventas valdría como aprobación. Se rechaza la configuración entera.
  if (ventas && verificaciones && ventas === verificaciones) invalidas.push('WHAPI_GRUPO_VERIFICACIONES')
  const canal = valor(env, 'WHAPI_CANAL_ID')
  if (canal && !canalValido(canal)) invalidas.push('WHAPI_CANAL_ID')
  if (faltan.length || invalidas.length) return { ok: false, faltan, invalidas }
  return { ok: true, config: { secreto, grupos: { ventas, verificaciones }, canalId: canal || null } }
}

/** El token del canal, o null si falta o tiene una forma imposible. */
export function tokenWhapi(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = valor(env, 'WHAPI_TOKEN')
  return t && tokenValido(t) ? t : null
}

/** Para el GET de estado: qué variables faltan o están mal (nombres), sin valores. */
export function estadoConfigWhapi(env: NodeJS.ProcessEnv = process.env): { faltan: VariableWhapi[]; invalidas: VariableWhapi[]; token: boolean; canal: boolean } {
  const c = configWebhook(env)
  const faltan = c.ok ? [] : [...c.faltan]
  const invalidas = c.ok ? [] : [...c.invalidas]
  const t = valor(env, 'WHAPI_TOKEN')
  if (!t) faltan.push('WHAPI_TOKEN')
  else if (!tokenValido(t)) invalidas.push('WHAPI_TOKEN')
  return { faltan, invalidas, token: !!tokenWhapi(env), canal: !!valor(env, 'WHAPI_CANAL_ID') && !invalidas.includes('WHAPI_CANAL_ID') }
}
