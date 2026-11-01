// ── f05 / f06 en pantalla: lo que el bot leyó del grupo Contenido, listo para el check de Aylu (puro) ─────────────────────
// Cada lectura se muestra con la cita, cómo la entendió el bot y lo que queda por hacer:
//   · OK propuesto con videos todavía «Con el cliente» → botón «Confirmar el OK» (mover / mover_lote ok_cliente, con la
//     cita del mensaje). Si los videos ya salieron de «Con el cliente», figura como resuelto: no hay nada que confirmar.
//   · Pedido → link al video, donde está el pedido `propuesto` con las notas para tildar.
//   · Sin video claro → Aylu elige el video y pega el pedido (o confirma el OK desde el video).
// Nada se decide acá: solo se arma lo que se ve. Sin mails ni teléfonos (la lectura no los guarda).
import type { LecturaGuardada } from './db/lecturas'
import { nombreVideo } from './avisos/mensajes'
import { LARGO_CITA } from './pedido'
import type { EstadoVideo, Video } from './tipos'

export type EstadoVistaLectura = 'ok_pendiente' | 'pedido' | 'sin_video' | 'resuelta' | 'descartada'
export interface VistaLectura {
  id: number; version: number; cuando: string; texto: string; resumen: string
  etiqueta: string; sentido: 'razonable' | 'revisar' | null; motivo: string
  estado: EstadoVistaLectura
  videos: { id: number; nombre: string; href: string }[]
  /** Para «Confirmar el OK»: los videos que siguen «Con el cliente», con la versión que se ve. */
  okItems: { video_id: number; version: number }[]
  cita: string
  pedidoHref: string | null
  resueltaPor: string | null
}

const ETIQUETA: Record<string, string> = { ok: 'OK del cliente', correccion: 'Pide cambios', ok_con_cambios: 'OK con cambios', otro: 'Otra cosa' }
const fecha = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function armarLecturas(lecturas: readonly LecturaGuardada[], videos: readonly Pick<Video, 'id' | 'clave' | 'numero' | 'estado' | 'version'>[], enlace: (href: string) => string = h => h): VistaLectura[] {
  const porId = new Map(videos.map(v => [v.id, v]))
  const href = (id: number) => enlace(`/clientes/edicion/video/${id}`)
  return lecturas.map(l => {
    const vs = l.video_ids.map(id => porId.get(id)).filter((v): v is NonNullable<typeof v> => !!v)
    const conCliente = vs.filter(v => v.estado === ('con_cliente' satisfies EstadoVideo))
    let estado: EstadoVistaLectura
    if (l.estado === 'descartada') estado = 'descartada'
    else if (l.resuelta) estado = 'resuelta'
    else if (l.estado === 'propuesta_ok') estado = conCliente.length ? 'ok_pendiente' : 'resuelta'
    else if (l.estado === 'pedido') estado = 'pedido'
    else estado = 'sin_video'
    const nombre = (v: (typeof vs)[number]) => { const n = nombreVideo(v.clave, true, v.numero); return n.charAt(0).toUpperCase() + n.slice(1) }
    return {
      id: l.id, version: l.version, cuando: fecha(l.enviado), texto: l.texto, resumen: l.resumen,
      etiqueta: ETIQUETA[l.tipo ?? ''] ?? 'Sin leer', sentido: l.sentido, motivo: l.motivo, estado,
      videos: vs.map(v => ({ id: v.id, nombre: nombre(v), href: href(v.id) })),
      okItems: estado === 'ok_pendiente' ? conCliente.map(v => ({ video_id: v.id, version: v.version })) : [],
      cita: l.texto.slice(0, LARGO_CITA),
      pedidoHref: estado === 'pedido' && vs[0] ? `${href(vs[0].id)}#ed-pedido` : null,
      resueltaPor: l.resuelta_por,
    }
  })
}

/** Lo que espera a Aylu (para el contador). */
export const lecturasAbiertas = (xs: readonly VistaLectura[]) => xs.filter(x => x.estado === 'ok_pendiente' || x.estado === 'pedido' || x.estado === 'sin_video')
