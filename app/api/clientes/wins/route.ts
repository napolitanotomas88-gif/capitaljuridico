import { asegurarUsuarios } from '@/lib/auth/accesos'
import { atenderGetWins, atenderPostWins } from '@/lib/clientes/wins/api'
import { depsWins } from './deps'

// /api/clientes/wins — GET: wins vigentes (?cliente=A001&autorizado=si|no), sin los bytes de las capturas.
// POST: cargar un win desde la tarjeta del cliente (solo quienes pueden usar las acciones de la tarjeta). La cubre la regla
// "/api/clientes/*" de lib/auth/rutas.ts; acá se repite la barrera por si el proxy no corre (lib/clientes/wins/api.ts).
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await asegurarUsuarios()
  return atenderGetWins(req, depsWins)
}

export async function POST(req: Request) {
  await asegurarUsuarios()
  return atenderPostWins(req, depsWins)
}
