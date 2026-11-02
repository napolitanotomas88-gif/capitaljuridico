import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { baseProyeccionConfigurada, guardarMarcaProyeccion, leerPedidoMarca } from '@/lib/bot/proyeccion/marcas'

// POST /api/clientes/<id>/proyeccion — marcas rápidas de la llamada de proyección desde la tarjeta del cliente o el panel
// «Pendientes de llamada de proyección» de Clientes (lib/bot/proyeccion/marcas.ts, tabla cj_proyeccion):
//   { fin: 'AAAA-MM-DD', campo: 'avisado' | 'agendada' | 'resultado', fecha: 'AAAA-MM-DD' | null, resultado?: 'hecha' | 'no_se_dio' }
// fecha null = quitar ese dato. «Agendada» o «Hecha» cortan los avisos del bot. Misma barrera que la de hitos: sesión con
// Clientes (regla "/api/clientes/*" de lib/auth/rutas.ts, repetida acá), mismo origen, JSON y tamaño.
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'content-type': 'application/json', 'cache-control': 'no-store' }
const ID_CLIENTE = /^[A-Za-z]\d{1,6}$/
const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: SIN_CACHE })

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes')
  if (rechazo) return rechazo
  if (!mismoOrigen(req.headers)) return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return respuesta({ ok: false, mensaje: 'Se espera JSON.' }, 415)
  const { id } = await ctx.params
  if (!ID_CLIENTE.test(id)) return respuesta({ ok: false, mensaje: 'No encontrado.' }, 404)
  const texto = await req.text().catch(() => null)
  if (texto === null || texto.length > 1_000) return respuesta({ ok: false, mensaje: 'Pedido inválido.' }, 400)
  let cuerpo: unknown
  try { cuerpo = JSON.parse(texto) } catch { return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400) }
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401)
  if (!baseProyeccionConfigurada()) return respuesta({ ok: false, mensaje: 'La base del Despacho no está configurada.' }, 503)
  const pedido = leerPedidoMarca(cuerpo, hoyArgentina())
  if (typeof pedido === 'string') return respuesta({ ok: false, mensaje: pedido }, 400)
  try {
    await guardarMarcaProyeccion(id, pedido, sesion.nombre || 'Equipo')
    return respuesta({ ok: true })
  } catch (e) {
    console.error('API proyección: no se pudo guardar —', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
    return respuesta({ ok: false, mensaje: 'No se pudo guardar. Probá de nuevo en un minuto.' }, 500)
  }
}
