// Respaldo local con la sesión ChatGPT de Codex. Sin claves de API, shell, MCP ni escrituras del agente.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ejecutarMotor, entornoMotor, MotorNoDisponible } from './proceso-cli'
import type { PedidoCli } from './motor-cli'
import type { Uso } from '../kickoff/tipos'

const APP_BIN = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
export const binCodex = () => process.env.GUIONES_CODEX_BIN?.trim() || (existsSync(APP_BIN) ? APP_BIN : 'codex')

export async function llamarCodex(p: PedidoCli): Promise<{ json: unknown; texto: string; modelo: string; usage: Uso }> {
  const bin = binCodex(), env = entornoMotor()
  const sesion = spawnSync(bin, ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 })
  if (sesion.status !== 0 || !/logged in using ChatGPT/i.test(`${sesion.stdout ?? ''} ${sesion.stderr ?? ''}`)) {
    throw new MotorNoDisponible('el respaldo requiere una sesión Codex de ChatGPT; no se usa una clave de API')
  }
  const dir = mkdtempSync(join(tmpdir(), 'cj-guiones-codex-'))
  const resultado = join(dir, 'resultado.txt')
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--color', 'never',
    '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'remote_plugin', '--disable', 'multi_agent',
    '--disable', 'computer_use', '--disable', 'browser_use', '--disable', 'image_generation',
    '-c', `web_search=${JSON.stringify(p.herramientas?.length ? 'live' : 'disabled')}`,
    '--cd', dir, '--output-last-message', resultado]
  // Conserva el modelo/configuración del usuario, pero deshabilita cada MCP para esta generación aislada.
  const config = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  if (existsSync(config)) {
    for (const m of readFileSync(config, 'utf8').matchAll(/^\[mcp_servers\.([\w-]+)\]\s*$/gm)) args.push('-c', `mcp_servers.${m[1]}.enabled=false`)
  }
  if (p.schema) {
    const schema = join(dir, 'schema.json')
    writeFileSync(schema, JSON.stringify(p.schema), { mode: 0o600 })
    args.push('--output-schema', schema)
  }
  args.push('-')
  const entrada = ['Generá únicamente el contenido solicitado. No ejecutes comandos, no leas archivos ni contactes aplicaciones.',
    p.herramientas?.length ? 'Podés usar búsqueda web para verificar fuentes y citarlas.' : 'No uses herramientas.',
    '<instrucciones>', p.sistema, '</instrucciones>', '<pedido>', p.usuario, '</pedido>'].join('\n')
  try {
    const salida = await ejecutarMotor(bin, args, { env, cwd: dir, topeMs: p.topeMs, entrada })
    let completado = false, usage: Uso = { input_tokens: 0, output_tokens: 0 }
    for (const linea of salida.split('\n')) {
      let e: Record<string, unknown>
      try { e = JSON.parse(linea) } catch { continue }
      if (e.type === 'turn.failed') throw new MotorNoDisponible('Codex no pudo completar el respaldo')
      if (e.type === 'turn.completed') {
        completado = true
        const u = (e.usage ?? {}) as Record<string, number>
        usage = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 }
      }
    }
    if (!completado || !existsSync(resultado)) throw new Error('Codex no confirmó una respuesta completa')
    const texto = readFileSync(resultado, 'utf8').trim()
    if (!texto) throw new Error('Codex devolvió una respuesta vacía')
    let json: unknown = null
    if (p.schema) { try { json = JSON.parse(texto) } catch { throw new Error('Codex devolvió JSON inválido') } }
    return { texto, json, modelo: 'codex/chatgpt', usage }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
