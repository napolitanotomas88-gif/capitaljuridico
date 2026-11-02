import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { atenderGuardado } from '@/lib/clientes/portal/api'
import { basePortalConfigurada, guardarPortal } from '@/lib/clientes/portal/base'

// POST /api/clientes/portal/<ID> { version, datos } — el equipo guarda el portal del cliente (objetivo, etapas, seguimiento,
// próximos pasos). Regla en lib/auth/rutas.ts ('/api/clientes/portal/*': equipo con la Cartera; el cliente, 403). La barrera
// completa y la decisión están en lib/clientes/portal/api.ts (probada en scripts/test-portal-cliente.mjs).
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return atenderGuardado(req, id, {
    exigirAcceso: r => exigirAccesoApi(r, 'clientes'),
    sesion: r => sesionDePeticion(r.headers),
    mismoOrigen,
    guardar: guardarPortal,
    baseConfigurada: basePortalConfigurada,
  })
}
