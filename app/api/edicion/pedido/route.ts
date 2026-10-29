import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { claveClaude, llamarClaude } from '@/lib/bot/kickoff/claude'
import { atenderPostPropuesta } from '@/lib/edicion/acciones'
import { modoEdicion } from '@/lib/edicion/config'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { leerDoc, leerDocPorId } from '@/lib/edicion/operativo'
import { crearPedido } from '@/lib/edicion/operativo'
import { leerVideo } from '@/lib/edicion/operativo'
import { proponerNotas } from '@/lib/edicion/pedidos'
import type { GuionDoc, Video } from '@/lib/edicion/tipos'

// POST /api/edicion/pedido — f05: Aylu (o Tomás) pega el pedido del cliente { video_id, texto } y Claude lo separa en notas
// (proponerNotas del bloque C: esfuerzo bajo, citas textuales, sin campos null). El pedido queda `propuesto`: las notas
// recién pasan a René cuando Aylu confirma cuáles van (POST /api/edicion, accion 'pedido_confirmar'), con el tope interno
// de P6. Misma barrera que /api/edicion (lib/edicion/acciones.ts → atenderPostPropuesta). maxDuration 120: Claude tiene
// un tope de 90 s. Sin key de Claude o en modo prueba no se llama a Claude: la propuesta sale vacía ("cargá las notas a
// mano"); en modo prueba tampoco se guarda el pedido.
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function leerGuion(v: Video): Promise<GuionDoc | null> {
  const doc = (v.guion?.doc_id ? await leerDocPorId(v.guion.doc_id) : null) ?? await leerDoc(v.id_crm)
  const ref = v.guion?.ref ?? v.clave
  return doc?.guiones.find(g => g.ref === ref) ?? null
}

export async function POST(req: Request) {
  await asegurarUsuarios()
  const modo = modoEdicion()
  return atenderPostPropuesta(req, {
    exigirAcceso: r => exigirAccesoApi(r, 'edicion'),
    sesion: r => sesionDePeticion(r.headers),
    baseLista: baseConfigurada,
    accion: {
      leerVideo,
      leerGuion,
      proponer: p => proponerNotas(p, { claude: modo === 'real' && claveClaude() ? llamarClaude : null }),
      guardar: crearPedido,
      modo,
    },
  })
}
