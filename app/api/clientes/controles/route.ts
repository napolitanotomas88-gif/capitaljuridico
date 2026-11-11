import { accesoMaquina } from '@/lib/auth/acceso'
import { controlesEncendidos, normalizarConfig, ymdAR } from '@/lib/clientes/controles/reglas'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// Controles de cumplimiento del cliente (11/11/2026, lib/clientes/controles). Solo máquina: Authorization: Bearer <CRON_SECRET>
// (el cron de Vercel lo manda solo; nunca ?key=). Encendido con CONTROLES_CLIENTES=encendido (apagado por defecto).
//   · GET            → corrida diaria (cron "0 13 * * *" = 10:00 AR): Meta, entregas y capturas.
//   · GET ?semanal=1 → resumen de la semana cerrada (cron de los lunes "0 13 * * 1").
//   · ?dry=1         → lo que haría, sin escribir, crear carpetas ni avisar (anda aunque esté apagado).
//   · GET ?config=1  → las configuraciones cargadas.
//   · POST {idCrm, cliente, cuentaMeta, presupuestoDiarioUsd, carpetaCliente?, carpetaCapturas?, desde?, plazos?, clausulas?, activo?}
//     → crea o actualiza la configuración del cliente en Neon (los datos del cliente nunca van al repo).
const headers = { 'cache-control': 'no-store' }
const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 200)

export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return Response.json({ ok: false, mensaje: 'Sin autorización.' }, { status: 401, headers })
  if (!process.env.DATABASE_URL?.trim()) return Response.json({ ok: false, mensaje: 'Base no configurada.' }, { status: 503, headers })
  const p = new URL(req.url).searchParams
  const dry = p.get('dry') === '1'
  try {
    if (p.get('config') === '1') {
      const { leerConfigs } = await import('@/lib/clientes/controles/db')
      return Response.json({ ok: true, encendido: controlesEncendidos(), configs: await leerConfigs(ymdAR(new Date()), false) }, { headers })
    }
    if (!dry && !controlesEncendidos()) return Response.json({ ok: true, apagado: true, mensaje: 'CONTROLES_CLIENTES no está en «encendido»: no se hizo nada.' }, { headers })
    const { depsReales } = await import('@/lib/clientes/controles/reales')
    const { correrControles, correrResumenSemanal } = await import('@/lib/clientes/controles/servidor')
    const r = p.get('semanal') === '1' ? await correrResumenSemanal(depsReales(), { dry }) : await correrControles(depsReales(), { dry })
    return Response.json({ ok: true, dry, ...r }, { headers })
  } catch (e) {
    console.error(`[controles] falló: ${motivo(e)}`)
    return Response.json({ ok: false, mensaje: 'No se pudieron correr los controles.' }, { status: 503, headers })
  }
}

export async function POST(req: Request) {
  if (!accesoMaquina(req.headers)) return Response.json({ ok: false, mensaje: 'Sin autorización.' }, { status: 401, headers })
  if (!process.env.DATABASE_URL?.trim()) return Response.json({ ok: false, mensaje: 'Base no configurada.' }, { status: 503, headers })
  let cuerpo: unknown
  try { cuerpo = await req.json() } catch { return Response.json({ ok: false, mensaje: 'JSON inválido.' }, { status: 400, headers }) }
  const r = normalizarConfig(cuerpo, ymdAR(new Date()))
  if (!r.ok) return Response.json({ ok: false, mensaje: r.motivo }, { status: 400, headers })
  try {
    const { guardarConfig } = await import('@/lib/clientes/controles/db')
    await guardarConfig(r.config, 'api (CRON_SECRET)')
    return Response.json({ ok: true, config: r.config }, { headers })
  } catch (e) {
    console.error(`[controles] no se pudo guardar la configuración: ${motivo(e)}`)
    return Response.json({ ok: false, mensaje: 'No se pudo guardar.' }, { status: 503, headers })
  }
}
