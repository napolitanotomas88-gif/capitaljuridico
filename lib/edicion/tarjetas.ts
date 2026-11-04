// Modelo literal de ClickUp: la etapa de un padre nunca mueve ni aprueba sus hijos.
import { ETAPAS_TARJETAS, type CamposTarjetaEdicion, type EtapaTarjeta, type PedidoNuevaTarjeta, type PedidoTarjetaEdicion, type TarjetaEdicion, type VideoNuevoEdicion } from './tarjetasTipos'
import type { Persona, RolEdicion } from './tipos'
export class ErrorTarjeta extends Error {
  readonly status: number; readonly codigo: string
  constructor(message: string, status = 409, codigo = 'no_permitido') { super(message); this.name = 'ErrorTarjeta'; this.status = status; this.codigo = codigo }
}
export interface TarjetaGuardada extends Omit<TarjetaEdicion, 'hijos'> { ronda_cliente: number; actualizado: string; entrega_evento?: string | null; video_version?: number | null; motor_bloqueado?: string | null }
export interface AvisoTarjeta { canal: 'hub' | 'discord' | 'cliente'; destino: 'rene' | 'aylu' | 'valen' | 'cliente'; texto: string; link?: string; tipo_aviso?: string }
/** Un ID de anuncio de Meta (números largos) dentro del comentario de un «publicado» a mano. */
export const ID_ANUNCIO = /\b\d{10,20}\b/
export const esEtapaTarjeta = (x: unknown): x is EtapaTarjeta => (ETAPAS_TARJETAS as readonly unknown[]).includes(x)
export const urlCampo = (x: string): boolean => { try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password } catch { return false } }
const limpia = (x: unknown, max: number) => typeof x === 'string' && x.length <= max && !x.includes('\u0000') ? x.trim() : null
export function validarPedidoTarjeta(x: unknown): PedidoTarjetaEdicion {
  const p = x as Record<string, unknown> | null
  if (!p || typeof p !== 'object' || !/^[A-Za-z0-9_-]{5,80}$/.test(String(p.id ?? '')) || !Number.isSafeInteger(p.version) || Number(p.version) < 1 || !/^[A-Za-z0-9_.:-]{8,100}$/.test(String(p.clave ?? ''))) throw new ErrorTarjeta('Falta ID, versión o clave estable del intento.', 422, 'entrada_invalida')
  const base = { id: String(p.id), version: Number(p.version), clave: String(p.clave) }
  if (p.accion === 'mover' && esEtapaTarjeta(p.etapa)) {
    if (p.comentario !== undefined && limpia(p.comentario, 2000) === null || p.origen !== undefined && !['interno', 'cliente'].includes(String(p.origen)) || p.autorizarTercera !== undefined && typeof p.autorizarTercera !== 'boolean') throw new ErrorTarjeta('Comentario u origen inválido.', 422, 'entrada_invalida')
    return { ...base, accion: 'mover', etapa: p.etapa, comentario: limpia(p.comentario, 2000) || undefined, origen: p.origen === 'cliente' ? 'cliente' : 'interno', autorizarTercera: p.autorizarTercera === true }
  }
  if (p.accion === 'campos' && p.campos && typeof p.campos === 'object') {
    const campos = p.campos as Record<string, unknown>, limpio = {} as CamposTarjetaEdicion
    for (const k of ['paleta', 'crudo', 'editado'] as const) { const t = limpia(campos[k], 4000); if (t === null || k !== 'paleta' && !!t && !urlCampo(t)) throw new ErrorTarjeta('Los links deben ser HTTPS y la paleta debe ser texto válido.', 422, 'entrada_invalida'); limpio[k] = t }
    return { ...base, accion: 'campos', campos: limpio }
  }
  if (p.accion === 'comentar') { const t = limpia(p.texto, 2000); if (t) return { ...base, accion: 'comentar', texto: t } }
  throw new ErrorTarjeta('Acción o contenido inválido.', 422, 'entrada_invalida')
}
export function etapasPermitidasTarjeta(t: TarjetaGuardada, rol: RolEdicion): EtapaTarjeta[] {
  if (t.motor_bloqueado && !(t.motor_bloqueado === 'finalizado_en_clickup' && rol === 'tomas' && t.etapa === 'publicado')) return []
  if (rol === 'rene') return ['para editar', 'editando', 'editado', 'corregido'].includes(t.etapa) ? ['para editar', 'editando', 'editado', 'corregido'].filter(e => e !== t.etapa) as EtapaTarjeta[] : []
  return rol === 'aylu' || rol === 'tomas' ? ETAPAS_TARJETAS.filter(e => e !== t.etapa && (e !== 'revisión' || ['editado', 'corregido'].includes(t.etapa)) && (e !== 'publicar' || ['revisión', 'publicado'].includes(t.etapa)) && (e !== 'publicado' || t.etapa === 'publicar') && (t.etapa !== 'publicado' || rol === 'tomas')) : []
}
export function planTarjeta(t: TarjetaGuardada, p: PedidoTarjetaEdicion, actor: Persona): { tarjeta: TarjetaGuardada; texto: string; avisos: AvisoTarjeta[] } {
  if (!t.id_crm) throw new ErrorTarjeta('Falta vincular esta tarjeta a un cliente CRM único.', 409, 'sin_vinculo_crm')
  const reabreFinalImportado = t.motor_bloqueado === 'finalizado_en_clickup' && actor.rol === 'tomas' && p.accion === 'mover' && t.etapa === 'publicado' && p.etapa !== 'publicado' && !!p.comentario
  if (t.motor_bloqueado && !reabreFinalImportado) throw new ErrorTarjeta(`El motor tiene el video ${t.motor_bloqueado}. Sólo Tomás puede reabrir un finalizado importado con una nota.`, 409, 'motor_bloqueado')
  if (t.version !== p.version) throw new ErrorTarjeta('Otra persona cambió esta tarjeta. Recargá antes de continuar.', 409, 'conflicto')
  if (!['rene', 'aylu', 'tomas'].includes(actor.rol)) throw new ErrorTarjeta('Esta cuenta sólo puede leer Edición.', 403)
  const tarjeta = { ...t, campos: { ...t.campos }, version: t.version + 1 }, avisos: AvisoTarjeta[] = []
  if (reabreFinalImportado) tarjeta.motor_bloqueado = null
  const avisar = (destino: 'rene' | 'aylu' | 'valen', texto: string) => { avisos.push({ canal: 'hub', destino, texto }, { canal: 'discord', destino, texto }) }
  let texto = ''
  if (p.accion === 'campos') {
    if (actor.rol === 'rene' && (p.campos.paleta !== t.campos.paleta || p.campos.crudo !== t.campos.crudo)) throw new ErrorTarjeta('René puede actualizar el link editado; los crudos y la paleta los revisan Aylu y Tomás.', 403)
    tarjeta.campos = p.campos; texto = 'Actualizó los campos de paleta, crudo y editado.'
  } else if (p.accion === 'comentar') {
    texto = p.texto
    if (actor.rol !== 'rene' && ['para editar', 'editando'].includes(t.etapa)) avisar('rene', `Nueva nota de ${actor.nombre}: ${texto}`)
  } else {
    if (p.etapa === t.etapa) throw new ErrorTarjeta('La tarjeta ya está en esa etapa.', 409, 'sin_cambio')
    if (t.etapa === 'publicado' && actor.rol !== 'tomas') throw new ErrorTarjeta('Sólo Tomás puede reabrir una tarjeta con OK del cliente.', 403)
    if (actor.rol === 'rene' && !['para editar', 'editando', 'editado', 'corregido'].includes(p.etapa)) throw new ErrorTarjeta('No tenés permiso para mover a esa etapa.', 403)
    if (actor.rol === 'rene' && !['para editar', 'editando', 'editado', 'corregido'].includes(t.etapa)) throw new ErrorTarjeta('Esta tarjeta necesita revisión de Aylu antes de que René la continúe.', 409)
    const retroceso = ETAPAS_TARJETAS.indexOf(p.etapa) < ETAPAS_TARJETAS.indexOf(t.etapa)
    if (retroceso && !p.comentario) throw new ErrorTarjeta('Al devolver una tarjeta, dejá la corrección o el motivo.', 422, 'falta_comentario')
    if (p.etapa === 'revisión' && (!['editado', 'corregido'].includes(t.etapa) || !urlCampo(t.campos.editado))) throw new ErrorTarjeta('Aylu o Tomás deben revisar un editado/corregido con link antes de pasarlo al cliente.', 409, 'falta_revision')
    if (p.etapa === 'publicar' && !['revisión', 'publicado'].includes(t.etapa)) throw new ErrorTarjeta('Antes de Publicar, el video debe pasar por Revisión.', 409, 'falta_revision')
    if (['editado', 'corregido', 'publicar', 'publicado'].includes(p.etapa) && !urlCampo(t.campos.editado)) throw new ErrorTarjeta('Falta el link HTTPS del editado.', 422, 'falta_editado')
    // Regla de Tomás (4/11): en PUBLICAR el bot arma el anuncio y, cuando quedó creado y verificado en pausa, la pasa a PUBLICADO.
    // La cita del OK del cliente se pega al pasar a Publicar; Publicado a mano solo con el ID del anuncio de Meta.
    if (p.etapa === 'publicar' && t.etapa === 'revisión' && (!p.comentario || p.comentario.length < 5)) throw new ErrorTarjeta('Para pasar a Publicar hace falta la cita del OK del cliente.', 422, 'falta_ok_cliente')
    if (p.etapa === 'publicado' && (t.etapa !== 'publicar' || !ID_ANUNCIO.test(p.comentario ?? ''))) throw new ErrorTarjeta('Publicado lo pone el bot cuando verificó el anuncio en pausa. A mano, solo desde Publicar y con el ID del anuncio de Meta.', 422, 'falta_id_anuncio')
    if (p.autorizarTercera && actor.rol !== 'tomas') throw new ErrorTarjeta('Sólo Tomás autoriza la tercera ronda del cliente.', 403, 'tope_rondas')
    if (retroceso && p.origen === 'cliente' && ['revisión', 'publicar', 'publicado'].includes(t.etapa)) {
      if (t.ronda_cliente >= 2 && !(actor.rol === 'tomas' && p.autorizarTercera)) throw new ErrorTarjeta('La tercera ronda del cliente espera autorización de Tomás. René todavía no recibe el pedido.', 409, 'tope_rondas')
      tarjeta.ronda_cliente++
    }
    tarjeta.etapa = p.etapa
    texto = `${t.etapa} → ${p.etapa}${p.comentario ? `\n${p.comentario}` : ''}${p.origen === 'cliente' ? '\nPedido del cliente.' : ''}${p.autorizarTercera ? '\nTomás autorizó la ronda adicional.' : ''}`
    if (p.etapa === 'para editar' || retroceso) { avisar('rene', `Para editar / corrección: ${texto}`); for (const a of avisos) a.tipo_aviso = retroceso ? 'correccion' : 'para_editar' }
    if (p.etapa === 'editado' || p.etapa === 'corregido') avisar('aylu', `${p.etapa}: revisar el video antes de enviarlo al cliente.`)
    if (p.etapa === 'revisión') { avisos.push({ canal: 'cliente', destino: 'cliente', texto: 'Ya revisamos tu video y está listo. Te lo dejamos acá:', link: t.campos.editado }); avisar('aylu', 'Revisión aprobada: la entrega queda en «Para enviar» (📤) para pegarla en el grupo Contenido.') }
  }
  for (const a of avisos) if (!a.tipo_aviso) a.tipo_aviso = p.accion === 'mover' ? p.etapa : 'comentario'
  return { tarjeta, texto, avisos }
}
export function arbolTarjetas(filas: readonly TarjetaGuardada[]): TarjetaEdicion[] {
  const porId = new Map<string, TarjetaEdicion>(filas.map(t => [t.id, { ...t, hijos: [] }]))
  if (porId.size !== filas.length) throw new ErrorTarjeta('Hay tarjetas duplicadas en la base.', 503)
  const raices: TarjetaEdicion[] = []
  for (const t of porId.values()) {
    const vistos = new Set([t.id]); let padre = t.parent_id
    while (padre) { if (vistos.has(padre)) throw new ErrorTarjeta('La jerarquía de tarjetas contiene un ciclo.', 503); vistos.add(padre); padre = porId.get(padre)?.parent_id ?? null }
    if (t.parent_id && porId.has(t.parent_id)) porId.get(t.parent_id)!.hijos.push(t); else raices.push(t)
  }
  return raices
}
// ── Alta desde el tablero (4/11/2026): Aylu y Tomás crean la tarjeta del cliente y sus videos; viaja a ClickUp por la outbox ──
export const MAX_VIDEOS_ALTA = 12
export const PRIORIDADES_ALTA = ['urgent', 'high', 'normal', 'low'] as const
export function validarNuevaTarjeta(x: unknown): PedidoNuevaTarjeta {
  const p = x as Record<string, unknown> | null
  if (!p || typeof p !== 'object' || p.accion !== 'crear' || !/^[A-Za-z0-9_.:-]{8,100}$/.test(String(p.clave ?? ''))) throw new ErrorTarjeta('Falta la clave estable del alta.', 422, 'entrada_invalida')
  const idCrm = String(p.id_crm ?? '').trim().toUpperCase(), cliente = limpia(p.cliente, 120)
  if (!/^[A-Z]\d{1,6}$/.test(idCrm) || !cliente) throw new ErrorTarjeta('Elegí un cliente del CRM.', 422, 'entrada_invalida')
  const padre = p.padre_id === null || p.padre_id === undefined || p.padre_id === '' ? null : String(p.padre_id)
  if (padre !== null && !/^[A-Za-z0-9_-]{5,80}$/.test(padre)) throw new ErrorTarjeta('Tarjeta del cliente inválida.', 422, 'entrada_invalida')
  if (!Array.isArray(p.videos) || p.videos.length < 1 || p.videos.length > MAX_VIDEOS_ALTA) throw new ErrorTarjeta(`Cargá entre 1 y ${MAX_VIDEOS_ALTA} videos.`, 422, 'entrada_invalida')
  const videos = p.videos.map((v, i) => {
    const o = (v ?? {}) as Record<string, unknown>
    const nombre = limpia(o.nombre, 120) || `Video ${i + 1}`, crudo = limpia(o.crudo ?? '', 2000), editado = limpia(o.editado ?? '', 2000), guion = limpia(o.guion ?? '', 6000)
    if (crudo === null || editado === null || guion === null || crudo && !urlCampo(crudo) || editado && !urlCampo(editado)) throw new ErrorTarjeta(`Video ${i + 1}: los links deben ser HTTPS.`, 422, 'entrada_invalida')
    const prioridad = o.prioridad ? String(o.prioridad) : null, asignado = o.asignado ? String(o.asignado) : null
    if (prioridad && !(PRIORIDADES_ALTA as readonly string[]).includes(prioridad) || asignado && !['rene', 'aylu', 'tomas'].includes(asignado)) throw new ErrorTarjeta(`Video ${i + 1}: prioridad o asignado inválido.`, 422, 'entrada_invalida')
    return { nombre, crudo, editado, guion, prioridad, asignado }
  })
  return { accion: 'crear', clave: String(p.clave), id_crm: idCrm, cliente, padre_id: padre, videos }
}
/** La etapa con la que entra un video nuevo: con editado → editado; con crudo → para editar; sin nada → en espera de datos. */
export const etapaInicial = (v: Pick<VideoNuevoEdicion, 'crudo' | 'editado'>): EtapaTarjeta => v.editado ? 'editado' : v.crudo ? 'para editar' : 'en espera de datos'
