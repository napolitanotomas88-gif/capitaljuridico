import { leerArchivados, exigirClienteNoArchivado } from '@/lib/clientes/archivados'
import { modoEdicion } from './config'
import { personaDeSesion, rolEdicion, type SesionRol } from './permisos'
import { arbolTarjetas, etapasPermitidasTarjeta, planTarjeta, validarPedidoTarjeta, ErrorTarjeta, type TarjetaGuardada } from './tarjetas'
import * as db from './tarjetasDb'
import type { RespuestaTarjetasEdicion } from './tarjetasTipos'
export interface DepsTarjetas {
  listar: typeof db.listarTarjetas; leer: typeof db.leerTarjeta; historial: typeof db.historialTarjeta; cambiar: typeof db.cambiarTarjeta
  archivados: () => Promise<Set<string>>; exigirActivo: typeof exigirClienteNoArchivado; modo: 'real' | 'dry'; env?: Record<string, string | undefined>
}
const reales = (): DepsTarjetas => ({ listar: db.listarTarjetas, leer: db.leerTarjeta, historial: db.historialTarjeta, cambiar: db.cambiarTarjeta, archivados: () => leerArchivados({ forzar: true }), exigirActivo: exigirClienteNoArchivado, modo: modoEdicion() })
const error = (e: unknown): { status: number; cuerpo: RespuestaTarjetasEdicion } => {
  const x = e as { status?: number; codigo?: string; code?: string }
  const status = Number(x?.status) || 503
  return { status, cuerpo: { ok: false, codigo: x.codigo || x.code || 'no_disponible', mensaje: status === 503 ? 'No se pudo verificar Edición y el CRM actuales. Recargá para continuar.' : (e as Error).message } }
}
export async function cargarTarjetasEdicion(sesion: SesionRol | null, id?: string, op: { deps?: DepsTarjetas } = {}): Promise<RespuestaTarjetasEdicion> {
  const d = op.deps ?? reales(), rol = rolEdicion(sesion, d.env), permisos = { mover: rol !== 'lector', campos: rol !== 'lector', comentar: rol !== 'lector' }
  try {
    const [filas, archivados] = await Promise.all([d.listar(), d.archivados()])
    const porId = new Map(filas.map(t => [t.id, t]))
    const visibles = filas.filter(t => {
      const vistos = new Set<string>(); let actual: TarjetaGuardada | undefined = t
      while (actual) { if (vistos.has(actual.id)) throw new ErrorTarjeta('La jerarquía tiene un ciclo.', 503); vistos.add(actual.id); if (actual.id_crm && archivados.has(actual.id_crm)) return false; actual = actual.parent_id ? porId.get(actual.parent_id) : undefined }
      return true
    })
    for (const t of visibles) {
      let activo = false
      if (t.id_crm) { try { await d.exigirActivo(t.id_crm, archivados); activo = true } catch (e) { if ((e as { code?: string }).code !== 'ESTADO_CRM_INCIERTO') throw e } }
      t.puede_editar = activo && rol !== 'lector' && (!t.motor_bloqueado || t.motor_bloqueado === 'finalizado_en_clickup' && rol === 'tomas'); t.etapas_permitidas = t.puede_editar ? etapasPermitidasTarjeta(t, rol) : []
    }
    const tarjetas = arbolTarjetas(visibles)
    if (id) {
      const tarjeta = visibles.find(t => t.id === id)
      if (!tarjeta) return { ok: false, codigo: 'no_existe', mensaje: 'La tarjeta no está en la cola activa.' }
      const buscar = (ts: typeof tarjetas): (typeof tarjetas)[number] | undefined => { for (const t of ts) { if (t.id === id) return t; const r = buscar(t.hijos); if (r) return r } }
      return { ok: true, tarjeta: buscar(tarjetas), historial: await d.historial(id), modo: d.modo, permisos }
    }
    return { ok: true, tarjetas, modo: d.modo, permisos }
  } catch (e) { return { ...error(e).cuerpo, modo: d.modo, permisos } }
}
export async function ejecutarTarjetaEdicion(sesion: SesionRol | null, cuerpo: unknown, op: { deps?: DepsTarjetas; dry?: boolean } = {}): Promise<{ status: number; cuerpo: RespuestaTarjetasEdicion }> {
  const d = op.deps ?? reales()
  try {
    const actor = personaDeSesion(sesion, d.env)
    if (!actor) throw new ErrorTarjeta('Esta cuenta sólo tiene acceso de lectura.', 403)
    const p = validarPedidoTarjeta(cuerpo), t = await d.leer(p.id)
    if (!t) throw new ErrorTarjeta('La tarjeta ya no existe.', 404, 'no_existe')
    const archivados = await d.archivados(), filas = await d.listar(), indice = new Map(filas.map(f => [f.id, f])), vistos = new Set<string>()
    let actual: TarjetaGuardada | undefined = t
    while (actual) { if (vistos.has(actual.id)) throw new ErrorTarjeta('La jerarquía es incierta.', 409); vistos.add(actual.id); if (actual.id_crm) await d.exigirActivo(actual.id_crm, archivados); if (actual.id_crm && t.id_crm && actual.id_crm !== t.id_crm) throw new ErrorTarjeta('El padre y el video no corresponden al mismo cliente.', 409, 'vinculo_incierto'); actual = actual.parent_id ? indice.get(actual.parent_id) : undefined }
    await d.exigirActivo(t.id_crm, archivados)
    if (d.modo !== 'real' || op.dry) { planTarjeta(t, p, actor); return { status: 200, cuerpo: { ok: true, dry: true, modo: 'dry', mensaje: 'Revisión válida. El modo de prueba no cambia tarjetas ni envía avisos.' } } }
    const tarjeta = await d.cambiar(p, actor)
    tarjeta.puede_editar = true; tarjeta.etapas_permitidas = etapasPermitidasTarjeta({ ...tarjeta, actualizado: '', ronda_cliente: tarjeta.ronda_cliente ?? 0 }, actor.rol)
    return { status: 200, cuerpo: { ok: true, modo: 'real', tarjeta, mensaje: 'Guardado con historial y avisos en cola.' } }
  } catch (e) { return error(e) }
}
