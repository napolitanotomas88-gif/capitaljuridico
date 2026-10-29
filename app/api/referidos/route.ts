import { correspondeBeneficio, encolarBeneficio, procesarBeneficio } from '@/lib/clientes/beneficiosPendientes'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { registrarReferido } from '@/lib/clientes/escribirReferido'
import { actualizarReferido, type EntradaActualizar } from '@/lib/clientes/actualizarReferido'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { invalidarSnapshot } from '@/lib/clientes/snapshot'

// POST /api/referidos — "Registrar referido": agrega UNA fila "Presentado" en la pestaña Referidos del CRM.
// Solo roles que ya ven la sección Referidos (socio y csm), con sesión de Google. Valida y decide en el servidor.
// Sin acceso por máquina. En modo de revisión (por defecto) no escribe nada: ver lib/clientes/escribirReferido.ts.
export const dynamic = 'force-dynamic'

const CABECERAS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const responder = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: CABECERAS })

export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'referidos') // 401 sin sesión, 403 sin permiso (segunda barrera, además del proxy)
  if (rechazo) return rechazo

  // Anti-CSRF: la petición tiene que venir de esta misma página (los navegadores siempre mandan Origin en un POST).
  const origen = req.headers.get('origin')
  let mismoOrigen = false
  try {
    mismoOrigen = !!origen && new URL(origen).host === req.headers.get('host')
  } catch {
    mismoOrigen = false
  }
  if (!mismoOrigen) return responder({ error: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return responder({ error: 'Se espera JSON.' }, 415)

  let cuerpo: unknown
  try {
    const texto = await req.text()
    if (texto.length > 8000) return responder({ error: 'El pedido es demasiado grande.' }, 413)
    cuerpo = JSON.parse(texto)
  } catch {
    return responder({ error: 'JSON inválido.' }, 400)
  }
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return responder({ error: 'JSON inválido.' }, 400)

  const sesion = sesionDePeticion(req.headers)
  const cargadoPor = sesion?.email ?? ''
  const r = await registrarReferido(cuerpo as Record<string, unknown> as never, cargadoPor)
  if (r.ok) {
    if (r.estado === 'guardado') invalidarSnapshot() // que el tablero lo muestre ya, sin esperar los 10 min del snapshot (27/10/2026)
    return responder(r, r.estado === 'guardado' ? 201 : 200)
  }
  if (r.codigo === 'pendiente_confirmacion') return responder(r, 202) // reservado, NO confirmado: no es un guardado
  const status = r.codigo === 'validacion' ? 422 : r.codigo === 'rechazado' || r.codigo === 'clave_reutilizada' ? 409 : r.codigo === 'sin_actor' ? 401 : r.codigo === 'sin_permiso_planilla' ? 502 : 503
  return responder(r, status)
}

// PATCH /api/referidos — "Actualizar referido" (27/10/2026): avanza un referido ya cargado (estado, fecha de la llamada, cliente
// nuevo, primer pago, reembolso, nota) escribiendo SOLO sobre su fila: lib/clientes/actualizarReferido.ts. Misma bandera que el alta
// (CRM_ESCRITURA_REFERIDOS=real; sin ella simula). Pueden hacerlo solo Tomás, Gero A, Gero M y Aylu (lib/clientes/acciones/permisos.ts).
export async function PATCH(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'referidos')
  if (rechazo) return rechazo
  const origen = req.headers.get('origin')
  let mismoOrigen = false
  try { mismoOrigen = !!origen && new URL(origen).host === req.headers.get('host') } catch { mismoOrigen = false }
  if (!mismoOrigen) return responder({ error: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return responder({ error: 'Se espera JSON.' }, 415)
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return responder({ error: 'No autorizado.' }, 401)
  if (!puedeHacerAcciones(sesion.email)) return responder({ ok: false, codigo: 'sin_permiso', mensaje: 'Solo Tomás, Gero A, Gero M y Aylu pueden actualizar referidos.' }, 403)
  let cuerpo: unknown
  try {
    const texto = await req.text()
    if (texto.length > 4000) return responder({ error: 'El pedido es demasiado grande.' }, 413)
    cuerpo = JSON.parse(texto)
  } catch {
    return responder({ error: 'JSON inválido.' }, 400)
  }
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return responder({ error: 'JSON inválido.' }, 400)
  const entrada = cuerpo as EntradaActualizar
  const quien = sesion.nombre?.split(/\s+/)[0] || sesion.email
  const elegible = correspondeBeneficio(entrada, process.env.CRM_ESCRITURA_REFERIDOS === 'real')
  const beneficio = elegible ? { idCrm: String(entrada.idClienteNuevo).toUpperCase(), idReferido: String(entrada.id).toUpperCase(), origen: 'referido' as const, quien } : null
  if (beneficio) {
    try { await encolarBeneficio(beneficio) }
    catch { return responder({ ok: false, mensaje: 'No se pudo reservar el mes adicional del referido. No se cambió el cierre; reintentá.' }, 503) }
  }
  const r = await actualizarReferido(entrada, quien)
  if (r.ok) {
    if (r.estado === 'guardado') invalidarSnapshot()
    if (beneficio && r.estado !== 'simulado') {
      try {
        const b = await procesarBeneficio(beneficio)
        return responder({ ...r, beneficio: b, avisos: [...r.avisos, ...(b.pendiente ? [b.mensaje] : [])] }, 200)
      } catch {
        return responder({ ...r, beneficio: { pendiente: true }, avisos: [...r.avisos, 'Cierre guardado. El mes adicional quedó en cola para verificar y aplicar.'] }, 200)
      }
    }
    return responder(r, 200)
  }
  const status = r.codigo === 'validacion' ? 422 : r.codigo === 'rechazado' ? 409 : r.codigo === 'sin_permiso_planilla' ? 502 : 503
  return responder(r, status)
}
