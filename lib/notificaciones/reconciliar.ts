// Adaptador de estados actuales: repara avisos perdidos sin ejecutar bots ni enviar mensajes.
import { createHash } from 'node:crypto'
import { aprobadoresDesdeEntorno } from '../bot/alta/despacho/aprobadores'
import { neon } from '@neondatabase/serverless'
import type { Seccion } from '../auth/roles'
import type { NuevaNotificacion } from './modelo'
import { crearNotificacion, cerrarNotificacionesDeOrigen, clavesNotificadas } from './registro'
import { leerArchivados, excluirArchivados } from '../clientes/archivados'
import { videosFinalizadosImportados } from '../edicion/tarjetasDb'

export type EstadoPendiente = { fuente: 'guiones' | 'kickoff' | 'altas' | 'edicion' | 'anuncios' | 'exito' | 'bajas'; id: string; cliente: string; idCrm?: string | null; estado: string; actualizado?: string | null; titulo?: string | null }
const seccion: Record<EstadoPendiente['fuente'], Seccion> = { guiones: 'guiones', kickoff: 'clientes', altas: 'altas', edicion: 'edicion', anuncios: 'anuncios', exito: 'clientes', bajas: 'clientes' }
const estados: Record<EstadoPendiente['fuente'], readonly string[]> = {
  guiones: ['a_revisar', 'error', 'con_notas'], kickoff: ['error'], altas: ['esperando_humano', 'revisar'],
  edicion: ['crudo_a_revisar', 'editado', 'corregido', 'correccion', 'bloqueado'], anuncios: ['dudoso'], exito: ['abierto', 'error', 'dudoso'], bajas: ['abierto', 'error', 'dudoso'],
}
/** Sólo estados que implican una acción humana conocida; no convertir cualquier fila en una alerta. */
export function avisosDeEstados(filas: readonly EstadoPendiente[], permitidas: readonly Seccion[], destinosAltas: readonly string[] = []): NuevaNotificacion[] {
  return filas.filter(f => permitidas.includes(seccion[f.fuente]) && estados[f.fuente].includes(f.estado)).flatMap(f => {
    const revision = f.actualizado && !Number.isNaN(Date.parse(f.actualizado)) ? new Date(f.actualizado).toISOString() : 'actual'
    const cliente = f.cliente?.trim() || 'Cliente por identificar'
    const id = f.idCrm && /^[A-Za-z]\d{1,6}$/.test(f.idCrm) ? f.idCrm.toUpperCase() : null
    const url = f.fuente === 'kickoff' ? id ? `/clientes/${id}/kickoff` : '/clientes' : f.fuente === 'guiones' ? id ? `/guiones/${id}` : '/guiones' : f.fuente === 'altas' ? '/clientes/altas' : f.fuente === 'edicion' ? '/clientes/edicion' : f.fuente === 'anuncios' ? '/anuncios' : id ? `/clientes?cliente=${id}` : '/clientes'
    const accion = f.fuente === 'kickoff' ? 'Retomar kickoff con error' : f.fuente === 'guiones' ? f.estado === 'a_revisar' ? 'Revisar guiones' : f.estado === 'con_notas' ? 'Revisar correcciones de guiones' : 'Retomar guiones con error' : f.fuente === 'altas' ? 'Revisar alta' : f.fuente === 'edicion' ? 'Revisar edición' : f.fuente === 'anuncios' ? 'Revisar aviso de anuncios dudoso' : f.fuente === 'bajas' ? 'Revisar baja' : 'Revisar seguimiento'
    const aviso: NuevaNotificacion = { paraSeccion: seccion[f.fuente], tipo: `${f.fuente}_${f.estado}`, titulo: `${accion} · ${cliente}`, cuerpo: f.titulo || `Estado: ${f.estado.replaceAll('_', ' ')}. Abrí el caso para resolverlo.`, url, urgente: f.estado === 'error' || f.estado === 'bloqueado' || f.estado === 'dudoso', origen: `reconciliar-${f.fuente}`, clave: `recon:${f.fuente}:${f.id}:${f.estado}:${revision}` }
    // Un closer con Altas sólo ve SUS altas. Los avisos generales de aprobación se dirigen a aprobadores por mail.
    if (f.fuente === 'altas') return [...new Set(destinosAltas)].filter(m => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)).map(email => ({ ...aviso, paraSeccion: null, paraEmail: email.toLowerCase(), clave: `${aviso.clave}:${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12)}` }))
    return [aviso]
  })
}

const sinTabla = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '')
// Cada fuente falla de forma independiente: si un módulo no está instalado no oculta los avisos de los demás.
export async function leerEstadosPendientes(permitidas: readonly Seccion[]): Promise<{ filas: EstadoPendiente[]; completas: EstadoPendiente['fuente'][] }> {
  if (!process.env.DATABASE_URL?.trim()) return { filas: [], completas: [] }
  const q = neon(process.env.DATABASE_URL.trim(), { fetchOptions: { signal: AbortSignal.timeout(4_000) } })
  const filas: EstadoPendiente[] = [], completas: EstadoPendiente['fuente'][] = []
  const leer = async (fuente: EstadoPendiente['fuente'], fn: () => Promise<unknown>) => {
    if (!permitidas.includes(seccion[fuente])) return
    try {
      const datos = await fn() as Record<string, unknown>[]
      filas.push(...datos.map(f => ({ fuente, id: String(f.id), cliente: String(f.cliente ?? ''), idCrm: f.id_crm ? String(f.id_crm) : null, estado: String(f.estado), actualizado: f.actualizado instanceof Date ? f.actualizado.toISOString() : String(f.actualizado ?? ''), titulo: f.titulo ? String(f.titulo) : null })))
      // Se permite cerrar avisos ausentes sólo cuando el listado estuvo completo (nunca por un corte de 100 filas).
      if (datos.length < 100) completas.push(fuente)
    } catch (e) { if (!sinTabla(e)) console.error(`[notificaciones] no se pudo conciliar ${fuente}`) }
  }
  await Promise.all([
    leer('kickoff', () => q`SELECT recording_id AS id, cliente_crm AS cliente, id_crm, estado, actualizado FROM cj_kickoffs WHERE estado = 'error' ORDER BY actualizado DESC LIMIT 100`),
    leer('guiones', () => q`SELECT id, cliente, id_crm, estado, actualizado FROM cj_guiones WHERE estado IN ('a_revisar','error','con_notas') ORDER BY actualizado DESC LIMIT 100`),
    leer('altas', () => q`SELECT id, nombre_cliente AS cliente, NULL AS id_crm, estado, actualizado FROM cj_altas WHERE estado IN ('esperando_humano','revisar') ORDER BY actualizado DESC LIMIT 100`),
    leer('edicion', async () => {
      const cerrados = [...await videosFinalizadosImportados()]
      return q`SELECT id, cliente, id_crm, CASE WHEN bloqueo IS NOT NULL THEN 'bloqueado' ELSE estado END AS estado, actualizado FROM cj_videos
        WHERE (estado IN ('crudo_a_revisar','editado','corregido','correccion') OR (bloqueo IS NOT NULL AND estado NOT IN ('aprobado','descartado','pausado')))
          AND NOT (id = ANY(${cerrados}::bigint[])) ORDER BY actualizado DESC LIMIT 100`
    }),
    leer('exito', () => q`SELECT id, cliente, id_crm, estado, actualizado FROM cj_exito_pedidos WHERE estado IN ('abierto','error','dudoso') ORDER BY actualizado DESC LIMIT 100`),
    leer('bajas', () => q`SELECT id, cliente, id_crm, estado, actualizado FROM cj_bajas_pedidos WHERE estado IN ('abierto','error','dudoso') ORDER BY actualizado DESC LIMIT 100`),
    leer('anuncios', () => q`SELECT clave AS id, cliente, NULL AS id_crm, estado, actualizado FROM cj_anuncios_avisos WHERE estado = 'dudoso' ORDER BY actualizado DESC LIMIT 100`),
  ])
  return { filas, completas }
}

const corridas = new Map<string, number>()
const enVuelo = new Map<string, Promise<void>>()
export function avisosSinRegistrar(avisos: readonly NuevaNotificacion[], existentes: ReadonlySet<string>, limite = 40): NuevaNotificacion[] {
  return avisos.filter(a => !a.clave || !existentes.has(a.clave)).sort((a, b) => Number(!!b.urgente) - Number(!!a.urgente)).slice(0, limite)
}
/** Máximo una reconciliación por conjunto de permisos/minuto y por proceso; nunca amplía lo que lee la persona. */
export async function reconciliarNotificaciones(permitidas: readonly Seccion[], estadoActual?: ReadonlySet<string>): Promise<void> {
  const archivados = estadoActual ?? await leerArchivados()
  const clave = `${[...permitidas].sort().join(',')}:${[...archivados].sort().join(',')}`
  const pendiente = enVuelo.get(clave)
  if (pendiente) return pendiente
  if (Date.now() - (corridas.get(clave) ?? 0) < 60_000) return
  const trabajo = (async () => {
    const { filas: originales, completas } = await leerEstadosPendientes(permitidas)
    const filas = excluirArchivados(originales, archivados, f => f.idCrm)
    const avisos = avisosDeEstados(filas, permitidas, aprobadoresDesdeEntorno().map(a => a.email))
    const existentes = await clavesNotificadas(avisos.flatMap(a => a.clave ? [a.clave] : []))
    const nuevos = avisosSinRegistrar(avisos, existentes)
    for (let i = 0; i < nuevos.length; i += 8) await Promise.all(nuevos.slice(i, i + 8).map(a => crearNotificacion(a)))
    await Promise.all(completas.map(fuente => cerrarNotificacionesDeOrigen(`reconciliar-${fuente}`, avisos.filter(a => a.origen === `reconciliar-${fuente}`).map(a => a.clave!))))
    corridas.set(clave, Date.now())
    if (corridas.size > 100) corridas.delete(corridas.keys().next().value!)
  })().finally(() => enVuelo.delete(clave))
  enVuelo.set(clave, trabajo)
  return trabajo
}
