import { NextResponse, after } from 'next/server'
import { atenderWebhook } from '@/lib/bot/grabacion/transcripcion'
import { depsReales } from '@/lib/bot/grabacion/servidor'
import { CABECERA_WEBHOOK } from '@/lib/bot/grabacion/assemblyai'
import { avisarEventos } from '@/lib/edicion/avisos'
import { baseConfigurada } from '@/lib/edicion/db/base'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Webhook de AssemblyAI (e03). Se autentica sola (regla `propio` en lib/auth/rutas.ts): cabecera X-Edicion-Secreto =
// ASSEMBLYAI_WEBHOOK_SECRETO (32+ caracteres; sin configurar → 503; distinta → 401). ?archivo=<id> viene en el webhook_url
// que armó el Despacho al mandar el audio. Responde 200 rápido y trabaja en after(): trae la transcripción, la guarda en
// Neon y la BORRA del lado de AssemblyAI. Si la tanda ya cerró, compara solo con el cruce simple (Claude lo hace el vigía).
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })
const MAX_CUERPO = 10_000

export async function POST(req: Request) {
  const t0 = Date.now()
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CUERPO) return json({ error: 'cuerpo demasiado grande' }, 413)
  const texto = await req.text()
  if (texto.length > MAX_CUERPO) return json({ error: 'cuerpo demasiado grande' }, 413)
  let cuerpo: unknown = null
  try { cuerpo = texto ? JSON.parse(texto) : null } catch { cuerpo = null }
  const deps = depsReales({ inicio: t0 })
  const r = atenderWebhook(deps.transcripcion!, { cabecera: req.headers.get(CABECERA_WEBHOOK), archivo: new URL(req.url).searchParams.get('archivo'), cuerpo })
  if (r.status === 200 && cuerpo === null) return json({ error: 'JSON inválido' }, 400)
  if (r.trabajo && baseConfigurada()) {
    const trabajo = r.trabajo
    after(async () => {
      try {
        const x = await trabajo()
        if ('extra' in x && x.extra.length) await avisarEventos([], x.extra)
      } catch (e) {
        console.error('grabacion-transcripcion: falla —', ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
      }
    })
  }
  return json(r.cuerpo, r.status)
}
