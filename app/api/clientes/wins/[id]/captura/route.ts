import { asegurarUsuarios } from '@/lib/auth/accesos'
import { atenderGetCaptura } from '@/lib/clientes/wins/api'
import { depsWins } from '../../deps'

// GET /api/clientes/wins/<id>/captura — la imagen del chat, solo con sesión de la Cartera (nunca pública ni en caché compartida).
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await asegurarUsuarios()
  const { id } = await ctx.params
  return atenderGetCaptura(req, id, depsWins)
}
