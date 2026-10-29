// ── Orquestación del envío del EOD (testeable con dependencias inyectadas) ────
// Orden: validar → ¿ya enviado? → reclamar lock → snapshot guardado (si falla NO se envía) → "enviando" → Discord → "enviado:<ids>".
import { abandonarEnviando, reclamar, type StoreLock } from './eodLock'
import { fechaReal, textoEOD, type EOD } from './eodSetter'

export interface DepsEOD {
  ahora: () => number                                     // ms epoch
  hoyYMD: () => string
  minutosAR: () => number
  lock: StoreLock
  enviadoPrevio: (fecha: string) => Promise<string | undefined>   // ids ya registrados en el Resumen (envíos legados / espejo)
  snapshot: (fecha: string) => Promise<EOD>               // calcula o recupera el congelado Y lo guarda; lanza si no pudo guardar
  enviar: (partes: string[]) => Promise<{ enviado: boolean; ids?: string[]; error?: string; rechazo?: boolean; ambiguo?: boolean }>
  espejo: (fecha: string, ids: string[]) => Promise<void>
}
export interface ResultadoEOD { status: number; enviado: boolean; [k: string]: unknown }

const CIERRE_MIN = 23 * 60 + 30   // un día de HOY recién se puede cerrar desde las 23:30 AR (el snapshot queda congelado)

export async function ejecutarEOD(d: DepsEOD, fecha: string, forzar = false): Promise<ResultadoEOD> {
  const hoy = d.hoyYMD()
  if (!fechaReal(fecha)) return { status: 400, enviado: false, error: `fecha inválida: ${fecha}` }
  if (fecha > hoy) return { status: 400, enviado: false, error: `fecha futura: ${fecha}` }
  if (fecha === hoy && d.minutosAR() < CIERRE_MIN) return { status: 409, enviado: false, error: 'el día todavía no cerró (desde las 23:30 AR); no se congela un snapshot parcial' }
  const previo = await d.enviadoPrevio(fecha)
  if (previo && !forzar) return { status: 200, enviado: false, yaEnviado: true, ids: previo.split(','), fecha }
  if (forzar) await abandonarEnviando(d.lock, fecha)
  const token = `${d.ahora()}-${Math.random().toString(36).slice(2, 8)}`
  const c = await reclamar(d.lock, fecha, token, d.ahora())
  if (!c.gano) return {
    status: c.motivo === 'yaEnviado' ? 200 : 409, enviado: false, fecha, motivo: c.motivo, estado: c.estado,
    ...(c.motivo === 'incierto' ? { error: 'envío anterior en estado incierto (¿se mandó?): revisar el canal; ?forzar=1 reintenta' } : {}),
  }
  let eod: EOD
  try {
    eod = await d.snapshot(fecha)
    await d.lock.update(c.idx, 'snapshot-ok')
  } catch (e) {
    await d.lock.update(c.idx, `fallo:${(e as Error).message}`.slice(0, 200)).catch(() => {})
    return { status: 500, enviado: false, fecha, error: `no se pudo guardar el snapshot, no se envió: ${(e as Error).message}` }
  }
  try { await d.lock.update(c.idx, 'enviando') } catch (e) { return { status: 500, enviado: false, fecha, error: `no se pudo marcar el envío, no se envió: ${(e as Error).message}` } }
  // Transporte sin respuesta / excepción = incierto: queda "enviando" (no se reintenta solo)
  let r: Awaited<ReturnType<DepsEOD['enviar']>>
  try { r = await d.enviar(textoEOD(eod)) } catch (e) { return { status: 502, enviado: false, fecha, incierto: true, error: `sin respuesta al enviar (¿se publicó?): ${(e as Error).message}` } }
  const ids = r.ids ?? []
  if (!r.enviado) {
    if (ids.length) {
      await d.lock.update(c.idx, `enviado-parcial:${ids.join(',')}`).catch(() => {})
      await d.espejo(fecha, ids).catch(() => {})
      return { status: 500, enviado: false, parcial: true, ids, fecha, error: r.error }
    }
    // Solo un rechazo inequívoco (4xx) permite reintentar. 5xx / 2xx sin id / sin respuesta → incierto: revisar el canal, ?forzar=1
    if (r.rechazo === true && !r.ambiguo) { await d.lock.update(c.idx, `fallo-envio:${r.error ?? ''}`.slice(0, 200)).catch(() => {}); return { status: 500, enviado: false, fecha, error: r.error } }
    return { status: 502, enviado: false, fecha, incierto: true, error: `${r.error ?? 'respuesta ambigua'}: revisar el canal; ?forzar=1 reintenta` }
  }
  let aviso: string | undefined
  await d.lock.update(c.idx, `enviado:${ids.join(',')}`).catch(e => { aviso = `enviado pero no se pudo marcar el lock (queda "enviando", no se reenviará solo): ${(e as Error).message}` })
  await d.espejo(fecha, ids).catch(e => { aviso = `${aviso ?? ''} espejo en Resumen falló: ${(e as Error).message}`.trim() })
  return { status: 200, enviado: true, ids, fecha, ...(aviso ? { aviso } : {}) }
}
