// Outbox durable: avisos por lote, sin repetir un envío externo de resultado ambiguo.
import { createHash } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { crearNotificacion } from '@/lib/notificaciones/registro'
import { leerArchivados, exigirClienteNoArchivado } from '@/lib/clientes/archivados'
import { leerClienteFresco } from '@/lib/clientes/acciones/escritor'
import { registrarActividadInactivos } from '@/lib/clientes/inactivos'
import { buscarGrupoContenido } from '@/lib/bot/guiones/envio'
import { crearClienteWhapi } from '@/lib/bot/whapi/cliente'
import { tokenWhapi } from '@/lib/bot/whapi/config'
import { guardiaWhapi } from '@/lib/bot/whapi/salud'
import { enviarDiscord } from '@/lib/fathomAnuncios/discord'
import { mencionesEdicion, urlDespacho, webhookAds, webhookEdicion } from './avisos/entorno'
import { mailsDelRol } from './permisos'
import { modoEdicion, avisosReales } from './config'
import { cerrarSalidaTarjeta, leerTarjeta, tomarSalidasTarjetas, transaccionTarjetas, type SalidaTarjeta } from './tarjetasDb'
import type { TarjetaGuardada } from './tarjetas'

type EstadoCierre = Parameters<typeof cerrarSalidaTarjeta>[1]
export interface DepsAvisosTarjetas {
  tomar: typeof tomarSalidasTarjetas; leer: typeof leerTarjeta; cerrar: typeof cerrarSalidaTarjeta
  activo(id: string, forzar?: boolean): Promise<void>
  hub(grupo: SalidaTarjeta[], texto: string, clave: string): Promise<void>
  discord(grupo: SalidaTarjeta[], texto: string): Promise<string | null>
  cliente(grupo: SalidaTarjeta[], texto: string): Promise<string | null>
  validarCliente?(grupo: SalidaTarjeta[]): void
  revision?(grupo: SalidaTarjeta[], motivo: string): Promise<void>
  modo: 'dry' | 'real'
}
export const MAX_ANTIGUEDAD_ENTREGA_MS = 24 * 60 * 60 * 1000
export const MAX_LOTES_CLIENTE_POR_PASADA = 1
export function salidaTarjetaVigente(s: SalidaTarjeta, t: TarjetaGuardada | null): boolean {
  if (!t || !t.id_crm || t.motor_bloqueado || t.id_crm !== s.datos.id_crm) return false
  if (s.canal === 'cliente') return t.etapa === 'revisión' && t.entrega_evento === s.evento_id && t.campos.editado === s.datos.link
  const tipo = s.datos.tipo_aviso
  if (tipo === 'correccion' || tipo === 'para_editar' || tipo === 'comentario') return ['para editar', 'editando'].includes(t.etapa)
  if (tipo === 'editado' || tipo === 'corregido' || tipo === 'publicado') return t.etapa === tipo
  if (tipo === 'revisión') return t.etapa === 'revisión' && t.entrega_evento === s.evento_id
  return true
}
const seguro = (s: unknown) => String(s ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
const antesEnvio = (mensaje: string) => Object.assign(new Error(mensaje), { antesEnvio: true })
/** Reconectar el número nunca habilita entregas anteriores al corte aprobado. No altera ni descarta la cola. */
export function exigirEntregaTarjetasHabilitada(grupo: SalidaTarjeta[], env: Record<string, string | undefined> = process.env, ahora = Date.now()): void {
  if (env.EDICION_WHATSAPP?.trim() !== 'real') throw antesEnvio('Entrega en espera: WhatsApp de Edición está apagado.')
  const desde = env.EDICION_WHATSAPP_DESDE?.trim() ?? ''
  const corte = Date.parse(desde)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(desde) || !Number.isFinite(corte) || new Date(corte).toISOString().replace('.000Z', 'Z') !== desde.replace('.000Z', 'Z') || corte > ahora) throw antesEnvio('Entrega en espera: falta una fecha de habilitación válida de WhatsApp de Edición.')
  if (!grupo.length || grupo.some(s => s.canal !== 'cliente' || !s.datos.id_crm || s.datos.id_crm !== grupo[0].datos.id_crm)) throw antesEnvio('Entrega en espera: el lote no corresponde a un único cliente.')
  for (const s of grupo) {
    const fecha = Date.parse(s.evento_fecha ?? '')
    if (!Number.isFinite(fecha) || fecha < corte || fecha > ahora || ahora - fecha > MAX_ANTIGUEDAD_ENTREGA_MS) throw Object.assign(antesEnvio('Entrega anterior a la habilitación o de más de 24 horas: requiere una nueva revisión de Aylu o Tomás. El aviso se conserva en espera.'), { requiereRevision: true })
  }
}
async function notificarRevisionEntrega(grupo: SalidaTarjeta[], motivo: string): Promise<void> {
  const destinatarios = [...new Set([...mailsDelRol('tomas'), ...mailsDelRol('aylu')])]
  if (!destinatarios.length) throw antesEnvio('Falta el destinatario interno de la revisión de entrega.')
  for (const s of grupo) for (const email of destinatarios) {
    const clave = `edicion-entrega-revisar:${s.id}:${createHash('sha256').update(email).digest('hex').slice(0, 12)}`
    const id = await crearNotificacion({ paraEmail: email, tipo: 'edicion_entrega_revisar', titulo: 'Edición: revisar una entrega anterior', cuerpo: `${s.datos.tarjeta}: ${motivo}`.slice(0, 1000), url: `/clientes/edicion?tarjeta=${encodeURIComponent(s.tarjeta_id)}`, urgente: true, origen: 'edicion-tarjetas', clave })
    if (!id) {
      const q = neon(process.env.DATABASE_URL!, { fetchOptions: { signal: AbortSignal.timeout(8000) } })
      if (!(await q`SELECT id FROM cj_notificaciones WHERE clave=${clave}`).length) throw antesEnvio('El aviso de revisión de entrega sigue pendiente de confirmación.')
    }
  }
}
async function notificarHub(grupo: SalidaTarjeta[], texto: string, clave: string): Promise<void> {
  const destino = grupo[0].destino, destinatarios = destino === 'rene' || destino === 'aylu' ? mailsDelRol(destino) : []
  if (destino !== 'valen' && !destinatarios.length) throw antesEnvio('Falta el destinatario de Edición en la configuración.')
  for (const email of destino === 'valen' ? [null] : destinatarios) {
    const propia = `${clave}:${email ? createHash('sha256').update(email).digest('hex').slice(0, 12) : 'ads'}`
    const id = await crearNotificacion({ paraEmail: email, paraSeccion: destino === 'valen' ? 'anuncios' : null, tipo: 'edicion_tarjetas', titulo: destino === 'rene' ? 'Edición: para editar o corregir' : destino === 'valen' ? 'Edición: OK del cliente para Ads' : 'Edición: videos listos para revisar', cuerpo: texto.slice(0, 1000), url: `/clientes/edicion?tarjeta=${encodeURIComponent(grupo[0].tarjeta_id)}`, urgente: true, origen: 'edicion-tarjetas', clave: propia })
    if (!id) {
      // crearNotificacion devuelve null tanto ante duplicado como ante error: sólo confirmar si el registro existe.
      const q = neon(process.env.DATABASE_URL!, { fetchOptions: { signal: AbortSignal.timeout(8000) } })
      const existentes = await q`SELECT id FROM cj_notificaciones WHERE clave=${propia}`
      if (!existentes.length) throw antesEnvio('La notificación interna sigue pendiente de confirmación.')
    }
  }
}
async function discordReal(grupo: SalidaTarjeta[], texto: string): Promise<string | null> {
  if (!avisosReales()) throw antesEnvio('Los avisos de Discord están en modo silencioso.')
  const destino = grupo[0].destino, webhook = destino === 'valen' ? webhookAds() : webhookEdicion()
  if (!webhook) throw antesEnvio('Falta el webhook del aviso de Edición.')
  const id = mencionesEdicion()[destino as 'rene' | 'aylu' | 'valen'], nombre = destino === 'rene' ? 'René' : destino === 'aylu' ? 'Aylu' : 'Valen'
  const contenido = `${id ? `<@${id}>` : nombre}\n${texto}\n${urlDespacho()}/clientes/edicion?tarjeta=${encodeURIComponent(grupo[0].tarjeta_id)}`.slice(0, 1990)
  const ids = await enviarDiscord(webhook, [contenido], id ? [id] : [], { esperas5xx: [], reintentos429: 0, timeoutMs: 12000 })
  return ids[0] || null
}
async function clienteReal(grupo: SalidaTarjeta[], texto: string): Promise<string | null> {
  exigirEntregaTarjetasHabilitada(grupo)
  const token = tokenWhapi()
  if (!token) throw antesEnvio('Entrega en espera: falta la conexión de WhatsApp.')
  await guardiaWhapi().antesDeEscribir({ token, fetch, ahora: Date.now })
  const idCrm = grupo[0].datos.id_crm, cliente = (await leerClienteFresco(idCrm)).cliente
  const chat = await buscarGrupoContenido(cliente.nombre)
  if (!chat) throw antesEnvio('Entrega en espera: no hay un grupo Contenido único para el cliente.')
  // Se vuelve a comprobar después de resolver el grupo y justo antes del efecto externo.
  await exigirClienteNoArchivado(idCrm, await leerArchivados({ forzar: true }))
  for (const s of grupo) if (!salidaTarjetaVigente(s, await leerTarjeta(s.tarjeta_id))) throw antesEnvio('La revisión cambió antes del envío; se volverá a evaluar la cola.')
  exigirEntregaTarjetasHabilitada(grupo)
  const r = await crearClienteWhapi({ token }).enviarTexto({ chatId: chat.id, texto })
  // Evidencia de envío y constancia del motor, sin modificar la aprobación ni enviar eventos antiguos otra vez.
  await transaccionTarjetas(async c => {
    for (const s of grupo) {
      await c.query("UPDATE cj_edicion_tarjetas_outbox SET estado='enviado',enviado=now(),mensaje_id=$2 WHERE id=$1 AND estado='enviando'", [s.id, r.id])
      const t = (await c.query('SELECT * FROM cj_edicion_tarjetas WHERE id=$1 FOR UPDATE', [s.tarjeta_id])).rows[0]
      if (t?.video_id && t.entrega_evento === s.evento_id) {
        const v = (await c.query("UPDATE cj_videos SET envio_link=$2::jsonb,version=version+1,actualizado=now() WHERE id=$1 AND estado='con_cliente' AND editado_url=$3 RETURNING version", [t.video_id, JSON.stringify({ quien: 'Bot C.J', cuando: new Date().toISOString(), texto }), s.datos.link])).rows[0]
        if (v) await c.query('UPDATE cj_edicion_tarjetas SET video_version=$2 WHERE id=$1', [t.id, v.version])
      }
    }
  })
  await registrarActividadInactivos({ idCrm, tipo: 'equipo', chatId: chat.id, origen: 'entrega-edicion' }).catch(() => {})
  return r.id
}
const reales = (): DepsAvisosTarjetas => {
  let inicial: Promise<Set<string>> | null = null
  return { tomar: tomarSalidasTarjetas, leer: leerTarjeta, cerrar: cerrarSalidaTarjeta, activo: async (id, forzar = false) => { if (forzar || !inicial) inicial = leerArchivados({ forzar: true }); await exigirClienteNoArchivado(id, await inicial) }, hub: notificarHub, discord: discordReal, cliente: clienteReal, validarCliente: exigirEntregaTarjetasHabilitada, revision: notificarRevisionEntrega, modo: modoEdicion() }
}
/** after() y vigía llaman al mismo dispatcher. No se reclaman filas en modo dry. */
export async function despacharTarjetasPendientes(op: { deps?: DepsAvisosTarjetas; hasta?: number; incluirCliente?: boolean } = {}): Promise<{ enviados: number; pendientes: number; dudosos: number; descartados: number }> {
  const d = op.deps ?? reales(), salida = { enviados: 0, pendientes: 0, dudosos: 0, descartados: 0 }
  const hasta = op.hasta ?? Date.now() + 240000
  if (d.modo !== 'real') return salida
  const grupos = new Map<string, SalidaTarjeta[]>()
  let lotesCliente = 0
  for (const s of await d.tomar()) {
    try {
      if (!salidaTarjetaVigente(s, await d.leer(s.tarjeta_id))) { await d.cerrar(s.id, 'descartado', 'La tarjeta ya no coincide con el aviso o la revisión original.'); salida.descartados++; continue }
      await d.activo(s.datos.id_crm)
      if (s.requiere_revision) {
        const motivo = 'La entrega anterior requiere una nueva revisión de Aylu o Tomás antes de enviarse.'
        await d.revision?.([s], motivo)
        await d.cerrar(s.id, 'espera_revision', motivo)
        salida.pendientes++; continue
      }
      const key = [s.canal, s.destino, s.datos.id_crm, s.datos.tipo_aviso, s.datos.lote_id ?? ''].join(':')
      grupos.set(key, [...(grupos.get(key) ?? []), s])
    } catch (e) { const archivado = (e as { code?: string }).code === 'CLIENTE_ARCHIVADO'; await d.cerrar(s.id, archivado ? 'descartado' : 'pendiente', archivado ? 'Cliente archivado.' : 'No se pudo verificar el CRM actual.'); if (archivado) salida.descartados++; else salida.pendientes++ }
  }
  for (const grupo of grupos.values()) {
    const primero = grupo[0], lista = [...new Map(grupo.map(s => [s.tarjeta_id, s])).values()]
    const texto = primero.canal === 'cliente' ? `Ya revisamos ${lista.length === 1 ? 'tu video y está listo' : 'tus videos y están listos'}. Te ${lista.length === 1 ? 'lo' : 'los'} dejamos acá:\n${lista.map(s => `${s.datos.tarjeta}: ${s.datos.link}`).join('\n')}` : `${lista.length} ${lista.length === 1 ? 'tarjeta' : 'tarjetas'} · ${primero.datos.tipo_aviso}\n${lista.slice(0, 8).map(s => `${s.datos.tarjeta}: ${s.datos.texto.replace(/@/g, '＠').slice(0, 160)}`).join('\n')}${lista.length > 8 ? `\nY ${lista.length - 8} más en el Hub.` : ''}`
    const clave = `edicion-tarjetas:${createHash('sha256').update(primero.datos.lote_id || grupo.map(s => s.id).sort().join('|')).digest('hex').slice(0, 32)}`
    try {
      if (primero.canal === 'cliente' && op.incluirCliente === false || hasta - Date.now() < (primero.canal === 'cliente' ? 90000 : 25000)) throw antesEnvio('El lote queda pendiente para el vigía con tiempo suficiente; no se inició ningún envío.')
      if (primero.canal === 'cliente') {
        d.validarCliente?.(grupo)
        if (lotesCliente >= MAX_LOTES_CLIENTE_POR_PASADA) throw antesEnvio('Entrega en espera: se alcanzó el límite de un lote por pasada.')
        // También cuenta el intento dudoso: no habilita otro envío durante esta pasada.
        lotesCliente++
      }
      let id: string | null = null
      // Guarda fresca otra vez por lote: un archivado no recibe un aviso externo.
      await d.activo(primero.datos.id_crm, true)
      if (primero.canal === 'hub') await d.hub(grupo, texto, clave)
      else if (primero.canal === 'discord') id = await d.discord(grupo, texto)
      else id = await d.cliente(grupo, texto)
      for (const s of grupo) await d.cerrar(s.id, 'enviado', '', id)
      salida.enviados += grupo.length
    } catch (e) {
      const x = e as { antesEnvio?: boolean; aplicado?: boolean | null; code?: string; message?: string; requiereRevision?: boolean }
      let estado: EstadoCierre = x.code === 'CLIENTE_ARCHIVADO' ? 'descartado' : primero.canal === 'hub' || x.antesEnvio || x.aplicado === false || /Discord respondió (?:400|401|403|404|429)/.test(x.message ?? '') ? primero.canal === 'cliente' ? 'espera_conexion' : 'pendiente' : 'dudoso'
      if (x.requiereRevision) {
        try { await d.revision?.(grupo, x.message ?? 'Revisar la entrega anterior.'); estado = 'espera_revision' }
        catch { /* Se conserva sin marcar el aviso como confirmado; la próxima pasada vuelve a avisar. */ }
      }
      for (const s of grupo) await d.cerrar(s.id, estado, seguro(e instanceof Error ? e.message : e))
      if (estado === 'dudoso') salida.dudosos += grupo.length; else if (estado === 'descartado') salida.descartados += grupo.length; else salida.pendientes += grupo.length
    }
  }
  return salida
}
