import type { Pool, PoolClient } from 'pg'
import { crearNotificacion } from '../notificaciones/registro'

interface FilaBeneficio {
  estado: 'pendiente' | 'aplicado'
  cerrarAviso(): Promise<void>
  guardar(estado: 'pendiente' | 'aplicado', detalle: string): Promise<void>
}
export interface DepsFinalizarBeneficio {
  conBloqueo<T>(idCrm: string, trabajo: (fila: FilaBeneficio) => Promise<T>): Promise<T>
  avisar: typeof crearNotificacion
}

let pool: Pool | null = null
async function getPool(): Promise<Pool> {
  if (!pool) {
    const { Pool } = await import('pg')
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000 })
  }
  return pool
}

async function cerrarAvisoExacto(c: PoolClient, id: string): Promise<void> {
  // No provoca un error de tabla ausente dentro de la transacción: si todavía no hubo avisos, no hay nada que cerrar.
  const existe = (await c.query("SELECT to_regclass('cj_notificaciones') AS tabla")).rows[0]?.tabla
  if (!existe) return
  await c.query(`UPDATE cj_notificaciones SET hecha_en=COALESCE(hecha_en,now()),
    hecha_por=COALESCE(hecha_por,'Sistema (beneficio incluido)') WHERE clave=$1 AND origen=$2`,
  [`beneficio-referido-pendiente:${id}`, `beneficio-referido:${id}`])
}

async function conBloqueo<T>(idCrm: string, trabajo: (fila: FilaBeneficio) => Promise<T>): Promise<T> {
  const c = await (await getPool()).connect()
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL lock_timeout='8s'")
    await c.query("SET LOCAL statement_timeout='15s'")
    const fila = (await c.query('SELECT estado FROM cj_beneficios_referidos_pendientes WHERE id_crm=$1 FOR UPDATE', [idCrm])).rows[0]
    if (!fila || !['pendiente', 'aplicado'].includes(String(fila.estado))) throw new Error('No se pudo confirmar la reserva del beneficio')
    const r = await trabajo({
      estado: fila.estado,
      cerrarAviso: () => cerrarAvisoExacto(c, idCrm),
      guardar: async (estado, detalle) => {
        await c.query("UPDATE cj_beneficios_referidos_pendientes SET estado=$2,detalle=$3,actualizado=now() WHERE id_crm=$1 AND estado='pendiente'", [idCrm, estado, detalle.slice(0, 500)])
      },
    })
    await c.query('COMMIT')
    return r
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally { c.release() }
}

/** No mantiene bloqueos mientras se escribe el CRM. Sólo serializa la conclusión y su aviso del mismo cliente. */
export async function finalizarBeneficio(idCrm: string, confirmado: boolean, detalle: string, deps: DepsFinalizarBeneficio = { conBloqueo, avisar: crearNotificacion }) {
  const id = idCrm.toUpperCase()
  return deps.conBloqueo(id, async fila => {
    if (fila.estado === 'aplicado') return { ok: true, pendiente: false, mensaje: 'El mes adicional ya quedó confirmado; no se repitió.' }
    if (confirmado) {
      // Si falla el cierre, la transacción conserva el pedido pendiente para que el cron lo retome.
      await fila.cerrarAviso()
      await fila.guardar('aplicado', detalle)
      return { ok: true, pendiente: false, mensaje: detalle }
    }
    await fila.guardar('pendiente', detalle)
    await deps.avisar({ paraSeccion: 'clientes', tipo: 'beneficio_referido', titulo: `Revisar mes adicional · ${id}`, cuerpo: detalle, url: `/clientes/${encodeURIComponent(id)}`, urgente: true, origen: `beneficio-referido:${id}`, clave: `beneficio-referido-pendiente:${id}` })
    return { ok: false, pendiente: true, mensaje: detalle }
  })
}
