// ── Motor local: las llamadas de la etapa Guiones con `claude -p` (Claude Code, plan Max de Tomás) ──
// Decisión de Tomás (25/10/2026, después de quemar crédito de la API en las pruebas): las tandas se arman en su Mac con su
// plan Max, no con la API. El trabajador local (scripts/guiones-local.mjs) pone GUIONES_LLM=cli y las mismas funciones de
// generar.ts y mercado.ts llaman a Claude Code sin pantalla:
//   claude -p <usuario> --model claude-opus-5-5 --effort medium --system-prompt <contexto + instrucciones>
//          --output-format json [--json-schema <schema>] --tools "" (o WebSearch,WebFetch para el mercado)
// Autenticación: CLAUDE_CODE_OAUTH_TOKEN (lo genera Tomás con `claude setup-token`). A la llamada NO se le pasa
// ANTHROPIC_API_KEY ni BOT_ANTHROPIC_API_KEY: si estuvieran, Claude Code cobraría a la API en vez de usar el plan.
// Solo para el trabajador local (usa child_process): no importarlo desde rutas de Next.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ejecutarMotor, entornoMotor, MotorNoDisponible } from './proceso-cli'
import type { Uso } from '../kickoff/tipos'

export const MODELO_CLI = 'claude-opus-5-5'
export const usarCli = (): boolean => process.env.GUIONES_LLM?.trim() === 'cli'

export interface PedidoCli {
  que: string
  sistema: string
  usuario: string
  schema?: Record<string, unknown>
  esfuerzo: string
  topeMs: number
  herramientas?: string[]          // [] = ninguna
}

/** Claude principal; Codex solo ante indisponibilidad y con el respaldo habilitado. */
export async function llamarCli(p: PedidoCli): Promise<{ json: unknown; texto: string; modelo: string; usage: Uso }> {
  const respaldo = process.env.GUIONES_CLI_RESPALDO === 'codex'
  const archivo = process.env.GUIONES_RESPALDO_ESTADO || join(homedir(), 'Library/Logs/guiones-local/respaldo-estado.json')
  let estado: { claude_retry_after?: number; ultimo_motor?: string } = {}
  if (respaldo && existsSync(archivo)) { try { estado = JSON.parse(readFileSync(archivo, 'utf8')) } catch { /* probar principal */ } }
  const guardar = (motor: string, retry: number) => {
    mkdirSync(join(archivo, '..'), { recursive: true })
    const tmp = `${archivo}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ ultimo_motor: motor, claude_retry_after: retry, actualizado: new Date().toISOString() }), { mode: 0o600 })
    renameSync(tmp, archivo)
  }
  const codex = async () => {
    const { llamarCodex } = await import('./motor-codex')
    const r = await llamarCodex(p)
    guardar('codex', estado.claude_retry_after ?? 0)
    return r
  }
  if (respaldo && (estado.claude_retry_after ?? 0) > Date.now()) return codex()
  try {
    const r = await llamarClaudeCli(p)
    if (respaldo) guardar('claude', 0)
    return r
  } catch (e) {
    // Un rechazo de contenido, error de esquema o error del programa no se elude con otro proveedor.
    if (!respaldo || !(e instanceof MotorNoDisponible)) throw e
    estado.claude_retry_after = Date.now() + 15 * 60_000
    guardar('codex_pendiente', estado.claude_retry_after)
    console.warn('[guiones-local] Claude no disponible; relevo automático a Codex (próxima prueba de Claude en 15 min)')
    return codex()
  }
}

async function llamarClaudeCli(p: PedidoCli): Promise<{ json: unknown; texto: string; modelo: string; usage: Uso }> {
  const env = entornoMotor()
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN
  const args = ['-p', p.usuario, '--model', MODELO_CLI, '--effort', p.esfuerzo, '--output-format', 'json',
    '--system-prompt', p.sistema, '--tools', (p.herramientas ?? []).join(','), '--no-session-persistence']
  if (p.schema) args.push('--json-schema', JSON.stringify(p.schema))
  if (p.herramientas?.length) args.push('--allowedTools', p.herramientas.join(','))
  const salida = await ejecutarMotor(process.env.GUIONES_CLAUDE_BIN?.trim() || 'claude', args, { env, topeMs: p.topeMs, errorEstructurado: true })
  let r: Record<string, unknown>
  try { r = JSON.parse(salida) as Record<string, unknown> } catch { throw new Error(`claude -p (${p.que}) no devolvió JSON`) }
  const resultado = typeof r.result === 'string' ? r.result : ''
  if (r.is_error) {
    const status = Number(r.api_error_status)
    if (status === 401 || status === 429 || status >= 500 && status <= 599 || /rate.?limit|usage.?limit|hit your limit|limit reached|overloaded|unauthorized|not logged|authentication|expired|ECONN|network|connection/i.test(resultado)) throw new MotorNoDisponible('Claude sin cuota, sesión o conexión')
    throw new Error(`Claude no completó ${p.que}; requiere revisión (sin relevo automático)`)
  }
  let json: unknown = r.structured_output ?? null
  if (p.schema && json === null) {
    const m = resultado.match(/\{[\s\S]*\}/)
    try { json = m ? JSON.parse(m[0]) : null } catch { json = null }
    if (json === null) throw new Error(`claude -p (${p.que}): la salida no trae el JSON pedido`)
  }
  const u = (r.usage ?? {}) as Record<string, number>
  return { json, texto: resultado, modelo: MODELO_CLI, usage: { input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens ?? 0 } }
}
