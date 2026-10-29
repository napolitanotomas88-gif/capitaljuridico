import { asegurarUsuarios } from '@/lib/auth/accesos'
import { atenderAcciones } from '@/lib/bot/alta/despacho/acciones'
import { depsAccionesReales } from '@/lib/bot/alta/despacho/servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// POST /api/clientes/altas — «Cargar alta» del Despacho (bot de altas de Capital Jurídico sin WhatsApp, 26/10/2026):
// vista previa, carga del alta con sus comprobantes, OK / NO de Verificaciones, datos del closer, "Hecho a mano" y
// reintentar. Sesión de Google, mismo origen y quién puede qué: lib/bot/alta/despacho/acciones.ts (probada en
// scripts/test-bot-alta-despacho.mjs). El motor trabaja en after(), hasta maxDuration.
export async function POST(req: Request) {
  await asegurarUsuarios()
  return atenderAcciones(req, depsAccionesReales())
}
