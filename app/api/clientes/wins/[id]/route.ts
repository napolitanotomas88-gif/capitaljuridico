import { asegurarUsuarios } from '@/lib/auth/accesos'
import { atenderDeleteWin } from '@/lib/clientes/wins/api'
import { depsWins } from '../deps'

// DELETE /api/clientes/wins/<id> — borra (lógico) un win y libera su captura. Solo quienes usan las acciones de la tarjeta.
export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await asegurarUsuarios()
  const { id } = await ctx.params
  return atenderDeleteWin(req, id, depsWins)
}
