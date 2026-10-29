import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { hoyArgentina } from '@/lib/clientes/fechas'
import { baseHitosConfigurada, guardarEtapa, guardarHito, leerPedidoEtapa, leerPedidoHito, reiniciarPausaAnotaciones } from '@/lib/clientes/hitosRegistro'
import { cargarVista } from '@/lib/clientes/vista'

// POST /api/clientes/<id>/hitos — anotar, corregir o borrar un hito del registro del cliente desde su tarjeta en la cartera
// (lib/clientes/hitos.ts y hitosRegistro.ts): { hito, fecha: 'AAAA-MM-DD' | null, nota } o { hito, borrar: true }.
// También "Corregir etapa": { etapa: 'lanzado', nota } fija la etapa a mano y { etapa: null } vuelve a la automática.
// La cubre la regla "/api/clientes/*" de lib/auth/rutas.ts (sesión de Google con un rol que ve Clientes); acá se repite la
// barrera por si el proxy no corre, más mismo origen (anti-CSRF), JSON y tamaño, como la de la ficha de kickoff.
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'content-type': 'application/json', 'cache-control': 'no-store' }
const ID_CLIENTE = /^[A-Za-z]\d{1,6}$/
const LARGO_MAX = 2_000
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
  if (texto === null || texto.length > LARGO_MAX) return respuesta({ ok: false, mensaje: 'Pedido inválido.' }, 400)
  let cuerpo: unknown
  try { cuerpo = JSON.parse(texto) } catch { return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400) }
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401)
  if (!baseHitosConfigurada()) return respuesta({ ok: false, mensaje: 'La base del Despacho no está configurada.' }, 503)
  const esEtapa = !!cuerpo && typeof cuerpo === 'object' && 'etapa' in cuerpo
  if (esEtapa && 'hito' in (cuerpo as object)) return respuesta({ ok: false, mensaje: 'Mandá un hito o una etapa, no los dos.' }, 400)
  const pedido = esEtapa ? leerPedidoEtapa(cuerpo) : leerPedidoHito(cuerpo, hoyArgentina())
  if (typeof pedido === 'string') return respuesta({ ok: false, mensaje: pedido }, 400)
  // El cliente tiene que existir en el CRM de Agencia (si no, quedaban filas huérfanas con cualquier ID; revisión del Hub)
  try {
    const { datos } = await cargarVista(false)
    if (!datos.clientes.some(c => c.linea === 'agencia' && c.id.toUpperCase() === id.toUpperCase())) return respuesta({ ok: false, mensaje: 'Ese cliente no está en el CRM de Agencia.' }, 404)
  } catch {
    return respuesta({ ok: false, mensaje: 'No se pudo leer el CRM para validar el cliente. Probá de nuevo en un minuto.' }, 503)
  }
  try {
    if ('hito' in pedido) await guardarHito(id, pedido, sesion.nombre || 'Equipo')
    else await guardarEtapa(id, pedido, sesion.nombre || 'Equipo')
    reiniciarPausaAnotaciones()   // la base respondió: la cartera vuelve a leer lo anotado en la próxima carga
    return respuesta({ ok: true })
  } catch (e) {
    console.error('API hitos: no se pudo guardar —', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
    return respuesta({ ok: false, mensaje: 'No se pudo guardar. Probá de nuevo en un minuto.' }, 500)
  }
}
