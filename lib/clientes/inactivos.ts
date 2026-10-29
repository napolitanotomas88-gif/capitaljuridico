// Inactividad = una respuesta pendiente desde una interacción registrada. No usa CRM INACTIVO ni adivina mensajes.
import { neon } from '@neondatabase/serverless'
import { crearNotificacion, cerrarNotificacionesDeOrigen } from '../notificaciones/registro'
import { cargarVista } from './vista'

export const INTERVALO_INACTIVOS_MS = 3 * 24 * 3600_000
export interface ContactoSeguimiento { idCrm: string; ultimoCliente: string | null; ultimoEquipo: string | null; chatId?: string | null }
export interface ClienteSeguimiento { id: string; nombre: string; estado: string; linea?: string; esNoCliente?: boolean }
export interface AlertaInactivo { idCrm: string; cliente: string; desde: string; dias: number; clave: string; chatId: string | null }
const ID = /^[A-Za-z]\d{1,6}$/
const valido = (x: string | null | undefined): number | null => x && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null

/** La fecha de una anotación interna no equivale a la última respuesta del cliente. Sólo usamos interacciones explícitas. */
export function alertasInactivos(clientes: readonly ClienteSeguimiento[], contactos: readonly ContactoSeguimiento[], ahora = Date.now()): AlertaInactivo[] {
  const porId = new Map(clientes.filter(c => c.estado === 'ACTIVO' && !c.esNoCliente).map(c => [c.id.toUpperCase(), c]))
  return contactos.flatMap(c => {
    const cliente = porId.get(c.idCrm.toUpperCase()), equipo = valido(c.ultimoEquipo), entrada = valido(c.ultimoCliente)
    if (!cliente || !ID.test(c.idCrm) || equipo === null || equipo > ahora || (entrada !== null && entrada >= equipo)) return []
    const lapso = ahora - equipo
    if (lapso < INTERVALO_INACTIVOS_MS) return []
    const desde = new Date(equipo).toISOString(), ciclo = Math.floor(lapso / INTERVALO_INACTIVOS_MS)
    return [{ idCrm: cliente.id.toUpperCase(), cliente: cliente.nombre, desde, dias: Math.floor(lapso / 86_400_000), clave: `inactivos:${cliente.id.toUpperCase()}:${desde}:${ciclo}`, chatId: c.chatId ?? null }]
  })
}

const q = () => neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(6_000) } })
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01'
let tabla: Promise<unknown> | null = null
function asegurarTabla(): Promise<unknown> {
  tabla ??= q()`CREATE TABLE IF NOT EXISTS cj_inactivos_contactos (
    id_crm text PRIMARY KEY, ultimo_cliente timestamptz, ultimo_equipo timestamptz, chat_id text,
    origen text NOT NULL DEFAULT '', actualizado timestamptz NOT NULL DEFAULT now())`.catch(e => { tabla = null; throw e })
  return tabla
}
/** Llamar al recibir un mensaje identificado del cliente o entregar un mensaje del equipo. No envía WhatsApp. */
export async function registrarActividadInactivos(p: { idCrm: string; tipo: 'cliente' | 'equipo' | 'resuelta'; cuando?: string; chatId?: string | null; origen?: string }): Promise<void> {
  if (!['cliente', 'equipo', 'resuelta'].includes(p.tipo)) throw new Error('Tipo de interacción inválido')
  if (!ID.test(p.idCrm)) throw new Error('ID del cliente inválido')
  if (!process.env.DATABASE_URL?.trim()) return
  const cuando = p.cuando ?? new Date().toISOString(), ms = valido(cuando)
  if (ms === null || ms < Date.parse('2024-01-01') || ms > Date.now() + 300_000) throw new Error('Fecha de interacción inválida')
  const chat = p.chatId && /^[0-9A-Za-z@._-]{3,100}$/.test(p.chatId) ? p.chatId : null
  await asegurarTabla()
  // GREATEST impide que webhooks tardíos borren una respuesta más reciente.
  const cliente = p.tipo !== 'equipo' ? cuando : null, equipo = p.tipo === 'equipo' ? cuando : null
  await q()`INSERT INTO cj_inactivos_contactos (id_crm, ultimo_cliente, ultimo_equipo, chat_id, origen)
    VALUES (${p.idCrm.toUpperCase()}, ${cliente}, ${equipo}, ${chat}, ${(p.origen ?? 'manual').slice(0, 60)})
    ON CONFLICT (id_crm) DO UPDATE SET
      ultimo_cliente = GREATEST(cj_inactivos_contactos.ultimo_cliente, EXCLUDED.ultimo_cliente),
      ultimo_equipo = GREATEST(cj_inactivos_contactos.ultimo_equipo, EXCLUDED.ultimo_equipo),
      chat_id = COALESCE(EXCLUDED.chat_id, cj_inactivos_contactos.chat_id), origen = EXCLUDED.origen, actualizado = now()`
}

export async function leerContactosInactivos(): Promise<ContactoSeguimiento[]> {
  if (!process.env.DATABASE_URL?.trim()) return []
  try {
    const filas = await q()`SELECT id_crm, ultimo_cliente, ultimo_equipo, chat_id FROM cj_inactivos_contactos WHERE ultimo_equipo IS NOT NULL` as Record<string, unknown>[]
    const iso = (x: unknown) => x instanceof Date ? x.toISOString() : x ? String(x) : null
    return filas.map(f => ({ idCrm: String(f.id_crm), ultimoCliente: iso(f.ultimo_cliente), ultimoEquipo: iso(f.ultimo_equipo), chatId: f.chat_id ? String(f.chat_id) : null }))
  } catch (e) { if (faltaTabla(e)) return []; throw e }
}

/** Alerta INTERNA cada tres días de espera. Las entregas y mensajes reales alimentan el reloj. Nunca escribe al cliente. */
export async function procesarInactivos(op: { dry?: boolean; ahora?: number } = {}): Promise<{ candidatos: AlertaInactivo[]; creadas: number; whatsapp: 'no_habilitado' }> {
  const contactos = await leerContactosInactivos()
  if (!contactos.length) return { candidatos: [], creadas: 0, whatsapp: 'no_habilitado' }
  const { datos } = await cargarVista(false)
  // Un snapshot viejo no debe crear recordatorios de clientes que tal vez ya respondieron o fueron pausados.
  if (datos.fuente === 'snapshot_viejo') throw new Error('No se pudo comprobar el estado actual de los clientes')
  const candidatos = alertasInactivos(datos.clientes, contactos, op.ahora)
  let creadas = 0
  if (!op.dry) {
    for (const a of candidatos.slice(0, 50)) {
      const id = await crearNotificacion({ paraSeccion: 'clientes', tipo: 'cliente_sin_respuesta', titulo: `Respuesta pendiente · ${a.cliente}`, cuerpo: `No hay una respuesta del cliente registrada desde el ${new Date(a.desde).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} (${a.dias} días). Revisá el grupo antes de volver a escribirle.`, url: `/clientes?cliente=${a.idCrm}`, urgente: a.dias >= 6, origen: 'seguimiento-inactivos', clave: a.clave })
      if (id !== null) creadas++
    }
    await cerrarNotificacionesDeOrigen('seguimiento-inactivos', candidatos.map(a => a.clave))
  }
  return { candidatos, creadas, whatsapp: 'no_habilitado' }
}
