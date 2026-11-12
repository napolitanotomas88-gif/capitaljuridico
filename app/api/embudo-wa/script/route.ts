import { scriptLanding } from '@/lib/embudoWa/landing'
import { NOMBRE_EVENTO } from '@/lib/embudoWa/capi'

export const dynamic = 'force-dynamic'

// JS de la landing del embudo (lo carga Framer con <script src>). Público y sin datos: solo arma el formulario.
export function GET(req: Request) {
  const base = (process.env.AUTH_BASE_URL || new URL(req.url).origin).replace(/\/$/, '')
  const wa = (process.env.EMBUDO_WA_WHATSAPP || '').replace(/\D/g, '')
  if (!wa) return new Response('/* Falta EMBUDO_WA_WHATSAPP */', { status: 503, headers: { 'content-type': 'text/javascript' } })
  return new Response(scriptLanding(`${base}/api/embudo-wa`, wa, NOMBRE_EVENTO), {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=60' },
  })
}
