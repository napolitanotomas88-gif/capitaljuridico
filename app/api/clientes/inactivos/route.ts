import { asegurarUsuarios } from '@/lib/auth/accesos'
import { accesoMaquina, exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import { cargarVista } from '@/lib/clientes/vista'
import { procesarInactivos, registrarActividadInactivos } from '@/lib/clientes/inactivos'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const json = (cuerpo: unknown, status = 200) => Response.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })

/** Cron autenticado: sólo alertas internas; ?dry=1 permite revisar sin escribir. */
export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes', { maquina: true })
  if (rechazo) return rechazo
  if (!process.env.DATABASE_URL?.trim()) return json({ ok: false, mensaje: 'La base de seguimiento no está configurada.' }, 503)
  try {
    const resultado = await procesarInactivos({ dry: new URL(req.url).searchParams.get('dry') === '1' })
    // El chat_id es necesario sólo del lado servidor; no se expone al navegador.
    return json({ ok: true, ...resultado, candidatos: resultado.candidatos.map(a => ({ idCrm: a.idCrm, cliente: a.cliente, desde: a.desde, dias: a.dias, clave: a.clave })) })
  } catch { return json({ ok: false, mensaje: 'No se pudo comprobar el seguimiento. No se enviaron recordatorios.' }, 503) }
}

/** Registro manual de una interacción/espera, siempre con cliente comprobado y mismo origen. */
export async function POST(req: Request) {
  await asegurarUsuarios()
  const rechazo = exigirAccesoApi(req, 'clientes')
  if (rechazo) return rechazo
  const sesion = sesionDePeticion(req.headers)
  if (!sesion || !puedeHacerAcciones(sesion.email)) return json({ ok: false, mensaje: 'Sin permiso para registrar seguimiento.' }, 403)
  if (!mismoOrigen(req.headers)) return json({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return json({ ok: false, mensaje: 'Se espera JSON.' }, 415)
  if (!process.env.DATABASE_URL?.trim()) return json({ ok: false, mensaje: 'La base de seguimiento no está configurada.' }, 503)
  const texto = await req.text()
  if (texto.length > 1200) return json({ ok: false, mensaje: 'Pedido demasiado largo.' }, 413)
  let b: Record<string, unknown>
  try { b = JSON.parse(texto) as Record<string, unknown> } catch { return json({ ok: false, mensaje: 'JSON inválido.' }, 400) }
  if (!b || Array.isArray(b) || typeof b !== 'object' || typeof b.idCrm !== 'string' || !/^[A-Za-z]\d{1,6}$/.test(b.idCrm) || !['cliente', 'equipo', 'resuelta'].includes(String(b.tipo))) return json({ ok: false, mensaje: 'Cliente o interacción inválidos.' }, 400)
  try {
    const { datos } = await cargarVista(false)
    if (!datos.clientes.some(c => c.id.toUpperCase() === String(b.idCrm).toUpperCase())) return json({ ok: false, mensaje: 'Cliente no encontrado.' }, 404)
    await registrarActividadInactivos({ idCrm: b.idCrm, tipo: b.tipo as 'cliente' | 'equipo' | 'resuelta', cuando: typeof b.cuando === 'string' ? b.cuando : undefined, origen: 'manual' })
    return json({ ok: true })
  } catch (e) {
    const invalida = /Fecha de interacción inválida|ID del cliente inválido/.test(String((e as Error)?.message))
    return json({ ok: false, mensaje: invalida ? 'Revisá la fecha de la interacción.' : 'No se pudo registrar la interacción. Probá nuevamente.' }, invalida ? 400 : 503)
  }
}
