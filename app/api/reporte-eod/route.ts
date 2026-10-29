import { NextResponse } from 'next/server'
import { asegurarPestanasAuxiliares, calcularEOD, enviadoPrevioEOD, fechaReal, hoyYMD, marcarEnviadoEOD, minutosAR, registrarEOD, sumarDias, textoEOD } from '@/lib/eodSetter'
import { ejecutarEOD } from '@/lib/eodRun'
import { storeLockSheets } from '@/lib/eodLockSheets'
import { sendDiscord } from '@/lib/discord'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// EOD de Maite (setter). Disparador: escenario de Make 6463821, activo, Daily 23:59 America/Argentina/Buenos_Aires (verificado por UI
// el 4/10; manda HOY, que es válido desde las 23:30 AR). Una prueba manual con ?preview=1&fecha=2026-10-03 dio Success sin enviar;
// la PRIMERA EJECUCIÓN PROGRAMADA todavía está pendiente. No hay cron de Vercel para esta ruta (se quitó el 4/10). Si hubiera dos
// disparadores, el lock "EOD Locks" deja pasar un solo envío por fecha (ver lib/eodLock.ts para las garantías exactas).
// Sin ?fecha y antes de las 06:00 AR se toma AYER (por si se dispara pasada la medianoche).
// Envía al canal de enrutamientos (DISCORD_WEBHOOK_ENRUTAMIENTO; si falta, DISCORD_WEBHOOK_URL). El día cerrado queda
// congelado en "Resumen EOD Maite" (col J). Reglas: fecha real y no futura; HOY solo desde las 23:30 AR.
// ?preview=1 devuelve el texto sin escribir ni enviar (usa el snapshot congelado si existe) · ?fecha=YYYY-MM-DD otro día ·
// ?forzar=1 reintenta tras un envío incierto/ya enviado (revisar el canal antes) · ?esquema=1 crea pestañas auxiliares.
// Protegido con CRON_SECRET o EOD_KEY (Bearer o ?key=). EOD_KEY es la que tiene Make: si se filtra, solo dispara este reporte.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const claves = [process.env.CRON_SECRET, process.env.EOD_KEY].filter((k): k is string => !!k)
  const auth = req.headers.get('authorization') ?? ''
  const key = url.searchParams.get('key')
  if (!claves.some(k => auth === `Bearer ${k}` || key === k))
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  try {
    if (url.searchParams.get('esquema')) return NextResponse.json({ creadas: await asegurarPestanasAuxiliares() })
    let fecha = url.searchParams.get('fecha') ?? undefined
    if (fecha && !fechaReal(fecha)) return NextResponse.json({ error: 'fecha inválida (YYYY-MM-DD real)' }, { status: 400 })
    if (fecha && fecha > hoyYMD()) return NextResponse.json({ error: 'fecha futura' }, { status: 400 })
    if (!fecha) fecha = minutosAR() < 6 * 60 ? sumarDias(hoyYMD(), -1) : hoyYMD()
    if (url.searchParams.get('preview')) {
      const { eod, congelado } = await calcularEOD(fecha)
      return NextResponse.json({ preview: textoEOD(eod).join('\n\n'), congelado, eod })
    }
    const r = await ejecutarEOD({
      ahora: () => Date.now(), hoyYMD, minutosAR, lock: storeLockSheets(),
      enviadoPrevio: enviadoPrevioEOD,
      snapshot: async f => { const { eod } = await calcularEOD(f); await registrarEOD(eod); return eod },
      enviar: partes => sendDiscord(partes, process.env.DISCORD_WEBHOOK_ENRUTAMIENTO),
      espejo: marcarEnviadoEOD,
    }, fecha, !!url.searchParams.get('forzar'))
    const { status, ...cuerpo } = r
    return NextResponse.json(cuerpo, { status })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
