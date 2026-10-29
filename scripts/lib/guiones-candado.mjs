import { openSync, writeFileSync, readFileSync, unlinkSync, closeSync } from 'node:fs'

/** Exclusión atómica. Un PID vivo nunca se reemplaza por antigüedad. */
export function tomarCandado(archivo) {
  const crear = () => {
    const fd = openSync(archivo, 'wx', 0o600)
    try { writeFileSync(fd, `${process.pid} ${Date.now()}`) } finally { closeSync(fd) }
    return () => {
      try { if (Number(readFileSync(archivo, 'utf8').split(' ')[0]) === process.pid) unlinkSync(archivo) } catch { /* ya no existe */ }
    }
  }
  try { return crear() } catch (e) { if (e.code !== 'EEXIST') throw e }
  // Serializar también la recuperación: dos procesos no pueden borrar el candado nuevo del otro.
  let recuperacion
  const mutex = `${archivo}.recuperando`
  try { recuperacion = openSync(mutex, 'wx', 0o600) } catch (e) { if (e.code === 'EEXIST') return null; throw e }
  try {
    let pid
    try { pid = Number(readFileSync(archivo, 'utf8').split(' ')[0]) } catch { return null }
    if (!Number.isInteger(pid) || pid <= 0) return null
    try { process.kill(pid, 0); return null } catch (err) { if (err.code !== 'ESRCH') return null }
    try { unlinkSync(archivo) } catch { return null }
    try { return crear() } catch (e) { if (e.code === 'EEXIST') return null; throw e }
  } finally {
    closeSync(recuperacion)
    try { unlinkSync(mutex) } catch { /* ya no existe */ }
  }
}
