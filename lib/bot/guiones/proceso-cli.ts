// Ejecuta un motor hasta su cierre real: nunca arranca el respaldo con el principal todavía vivo.
import { spawn } from 'node:child_process'

export class MotorNoDisponible extends Error {
  readonly transitorio = true
}

export function entornoMotor(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV }
  for (const k of ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'CODEX_HOME']) {
    if (process.env[k]) env[k] = process.env[k]
  }
  return env
}

export async function ejecutarMotor(bin: string, args: string[], op: {
  env: NodeJS.ProcessEnv; topeMs: number; cwd?: string; entrada?: string; errorEstructurado?: boolean
}): Promise<string> {
  if (!Number.isFinite(op.topeMs) || op.topeMs <= 0) throw new Error('tope de motor inválido')
  return new Promise((resolve, reject) => {
    const h = spawn(bin, args, { env: op.env, cwd: op.cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', vencido = false, demasiado = false
    let forzar: ReturnType<typeof setTimeout> | undefined
    const matar = (signal: NodeJS.Signals) => {
      if (!h.pid) return
      try {
        if (process.platform === 'win32') h.kill(signal)
        else process.kill(-h.pid, signal)
      } catch { /* ya cerró */ }
    }
    const salir = () => matar('SIGKILL')
    process.once('exit', salir)
    const detener = () => { matar('SIGTERM'); forzar ??= setTimeout(() => matar('SIGKILL'), 1_000) }
    const timer = setTimeout(() => { vencido = true; detener() }, op.topeMs)
    const limpiar = () => { clearTimeout(timer); clearTimeout(forzar); process.removeListener('exit', salir) }
    h.stdout.on('data', d => { out += d; if (out.length > 8_000_000) { demasiado = true; detener() } })
    h.stderr.on('data', d => { err = (err + d).slice(-8_000) })
    h.stdin.on('error', () => { /* EPIPE: el motivo se procesa al cerrar */ })
    h.on('error', () => { limpiar(); reject(new MotorNoDisponible('no se pudo iniciar el motor local')) })
    h.on('close', code => {
      limpiar()
      if (vencido) return reject(new MotorNoDisponible('el motor local agotó su tiempo'))
      if (demasiado) return reject(new Error('salida del motor local demasiado grande'))
      if (code !== 0) {
        // Solo se acepta el sobre de ERROR de Claude para clasificar la indisponibilidad.
        if (op.errorEstructurado) {
          try { if (JSON.parse(out).is_error === true) return resolve(out) } catch { /* salida inválida */ }
        }
        if (/429|5\d\d|rate.?limit|usage.?limit|hit your limit|overloaded|unauthorized|not logged|authentication|expired|ECONN|ENOTFOUND|network|connection|temporarily unavailable/i.test(err)) {
          return reject(new MotorNoDisponible('el proveedor local está sin cuota, sesión o conexión'))
        }
        return reject(new Error(`el motor local salió con código ${code}`))
      }
      if (!out.trim()) return reject(new Error('el motor local no devolvió respuesta'))
      resolve(out)
    })
    h.stdin.end(op.entrada ?? '')
  })
}
