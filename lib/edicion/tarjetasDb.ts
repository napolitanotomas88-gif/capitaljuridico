// Una transacción guarda tarjeta, historial, respuesta idempotente y outbox. ClickUp es sólo origen de la importación.
import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { EventoTarjetaEdicion, PedidoTarjetaEdicion, TarjetaEdicion } from './tarjetasTipos'
import type { Persona } from './tipos'
import { leer as leerOperativo, type Fila as FilaOperativa } from './db/base'
import { arbolTarjetas, ErrorTarjeta, esEtapaTarjeta, planTarjeta, type AvisoTarjeta, type TarjetaGuardada } from './tarjetas'

export const SQL_TARJETAS = `
CREATE TABLE IF NOT EXISTS cj_edicion_tarjetas (
 id text PRIMARY KEY, parent_id text REFERENCES cj_edicion_tarjetas(id) DEFERRABLE INITIALLY DEFERRED,
 id_crm text, video_id bigint, nombre text NOT NULL, etapa text NOT NULL,
 campos jsonb NOT NULL DEFAULT '{"paleta":"","crudo":"","editado":""}', prioridad text, asignados jsonb NOT NULL DEFAULT '[]', clickup_url text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), ronda_cliente integer NOT NULL DEFAULT 0 CHECK(ronda_cliente>=0), entrega_evento text, video_version integer, motor_bloqueado text,
 creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS cj_edicion_tarjetas_parent ON cj_edicion_tarjetas(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS cj_edicion_tarjetas_video ON cj_edicion_tarjetas(video_id) WHERE video_id IS NOT NULL;
ALTER TABLE cj_edicion_tarjetas ADD COLUMN IF NOT EXISTS video_version integer;
ALTER TABLE cj_edicion_tarjetas ADD COLUMN IF NOT EXISTS motor_bloqueado text;
CREATE TABLE IF NOT EXISTS cj_edicion_tarjetas_historial (
 id text PRIMARY KEY, tarjeta_id text NOT NULL REFERENCES cj_edicion_tarjetas(id), fecha timestamptz NOT NULL DEFAULT now(),
 quien text NOT NULL, actor_email text, tipo text NOT NULL, antes text, despues text, texto text NOT NULL, datos jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS cj_edicion_tarjetas_operaciones (
 actor text NOT NULL, clave text NOT NULL, tarjeta_id text NOT NULL, huella text NOT NULL, respuesta jsonb NOT NULL, creado timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor,clave));
CREATE TABLE IF NOT EXISTS cj_edicion_tarjetas_outbox (
 id text PRIMARY KEY, tarjeta_id text NOT NULL REFERENCES cj_edicion_tarjetas(id), evento_id text NOT NULL REFERENCES cj_edicion_tarjetas_historial(id),
 canal text NOT NULL, destino text NOT NULL, datos jsonb NOT NULL, estado text NOT NULL DEFAULT 'pendiente',
 intentos integer NOT NULL DEFAULT 0, disponible timestamptz NOT NULL DEFAULT now(), tomado timestamptz, enviado timestamptz, mensaje_id text, error text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS cj_edicion_tarjetas_outbox_pendiente ON cj_edicion_tarjetas_outbox(estado,disponible);`
type Fila = Record<string, unknown>
let pool: Pool | null = null
async function conectar(): Promise<PoolClient> {
  if (!process.env.DATABASE_URL) throw new ErrorTarjeta('Falta configurar la base de Edición.', 503, 'sin_base')
  if (!pool) { const { Pool } = await import('pg'); pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000 }) }
  return pool.connect()
}
const objeto = <T>(x: unknown, defecto: T): T => { if (typeof x === 'string') { try { return JSON.parse(x) as T } catch { return defecto } }; return (x ?? defecto) as T }
const iso = (x: unknown) => new Date(String(x)).toISOString()
export function tarjetaDesdeFila(f: Fila): TarjetaGuardada {
  if (!esEtapaTarjeta(f.etapa)) throw new ErrorTarjeta('La base contiene una etapa desconocida.', 503)
  return { id: String(f.id), parent_id: f.parent_id ? String(f.parent_id) : null, id_crm: f.id_crm ? String(f.id_crm) : null, video_id: f.video_id ? Number(f.video_id) : null,
    nombre: String(f.nombre), etapa: f.etapa, version: Number(f.version), campos: objeto(f.campos, { paleta: '', crudo: '', editado: '' }), prioridad: f.prioridad ? String(f.prioridad) : null,
    asignados: objeto(f.asignados, []), clickup_url: f.clickup_url ? String(f.clickup_url) : null, ronda_cliente: Number(f.ronda_cliente ?? 0), actualizado: iso(f.actualizado ?? new Date()),
    entrega_evento: f.entrega_evento ? String(f.entrega_evento) : null, video_version: f.video_version ? Number(f.video_version) : null, motor_bloqueado: f.motor_bloqueado ? String(f.motor_bloqueado) : null, avisos: [...(f.motor_bloqueado ? [`Video ${f.motor_bloqueado}: requiere revisión en su ficha.`] : []), ...(f.revision_entrega === true ? ['La entrega anterior requiere una nueva revisión de Aylu o Tomás antes de enviarse.'] : [])], espera_whatsapp: f.espera_whatsapp === true }
}
const eventoDesde = (f: Fila): EventoTarjetaEdicion => ({ id: String(f.id), fecha: iso(f.fecha), quien: String(f.quien), tipo: f.tipo as EventoTarjetaEdicion['tipo'], ...(esEtapaTarjeta(f.antes) ? { antes: f.antes } : {}), ...(esEtapaTarjeta(f.despues) ? { despues: f.despues } : {}), texto: String(f.texto) })
async function leer<T>(fn: (c: PoolClient) => Promise<T>, vacio: T): Promise<T> { const c = await conectar(); try { return await fn(c) } catch (e) { if ((e as { code?: string }).code === '42P01') return vacio; throw e } finally { c.release() } }
export async function listarTarjetas(): Promise<TarjetaGuardada[]> { return leer(async c => {
  const r = await c.query(`SELECT t.*,EXISTS(SELECT 1 FROM cj_edicion_tarjetas_outbox o WHERE o.tarjeta_id=t.id AND o.canal='cliente' AND o.evento_id=t.entrega_evento AND o.estado IN ('pendiente','espera_conexion','espera_revision','enviando','dudoso')) espera_whatsapp,EXISTS(SELECT 1 FROM cj_edicion_tarjetas_outbox o WHERE o.tarjeta_id=t.id AND o.canal='cliente' AND o.evento_id=t.entrega_evento AND o.estado='espera_revision') revision_entrega FROM cj_edicion_tarjetas t ORDER BY creado,id LIMIT 10001`)
  if (r.rows.length > 10000) throw new ErrorTarjeta('La lista de Edición excede el límite de lectura.', 503)
  return r.rows.map(tarjetaDesdeFila)
}, []) }
export async function leerTarjeta(id: string): Promise<TarjetaGuardada | null> { return leer(async c => { const r = await c.query('SELECT * FROM cj_edicion_tarjetas WHERE id=$1', [id]); return r.rows[0] ? tarjetaDesdeFila(r.rows[0]) : null }, null) }
export async function historialTarjeta(id: string): Promise<EventoTarjetaEdicion[]> { return leer(async c => (await c.query('SELECT id,fecha,quien,tipo,antes,despues,texto FROM cj_edicion_tarjetas_historial WHERE tarjeta_id=$1 ORDER BY fecha DESC,id DESC LIMIT 500', [id])).rows.map(eventoDesde), []) }
export async function transaccionTarjetas<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await conectar()
  try { await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('cj_edicion_tarjetas'))"); await c.query(SQL_TARJETAS); const r = await fn(c); await c.query('COMMIT'); return r } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
}
async function actualizarVideoTarjeta(c: PoolClient, v: Fila, antes: TarjetaGuardada, t: TarjetaGuardada, p: PedidoTarjetaEdicion, actor: Persona, texto: string, evento: string): Promise<number> {
  const anterior = String(v.estado)
  if (['pausado', 'descartado'].includes(anterior)) throw new ErrorTarjeta('El video está pausado o descartado. Tomás debe reabrirlo en su ficha antes de continuar.', 409, 'motor_bloqueado')
  const retroceso = p.accion === 'mover' && ['para editar', 'editando'].includes(p.etapa) && ['editado', 'corregido', 'revisión', 'publicar', 'publicado'].includes(antes.etapa)
  const mapa: Record<string, string> = { 'en espera de datos': 'esperando_crudos', 'para editar': retroceso || anterior === 'correccion' ? 'correccion' : 'para_editar', editando: retroceso || anterior === 'correccion' ? 'correccion' : 'para_editar', editado: 'editado', corregido: 'corregido', 'revisión': 'con_cliente', publicar: 'con_cliente', publicado: 'aprobado' }
  const estado = p.accion === 'mover' ? mapa[p.etapa] : anterior
  let interna = Number(v.ronda_interna), bloqueo = v.bloqueo, motivo = v.motivo_bloqueo
  if (p.accion === 'mover' && ['editado', 'corregido', 'revisión'].includes(p.etapa)) {
    const notas = (await c.query('SELECT count(*)::int n FROM cj_video_notas WHERE video_id=$1 AND NOT borrada AND enviada AND tilde IS NULL AND ronda=$2', [v.id, Number(v.ronda_interna) + Number(v.ronda_cliente)])).rows[0]
    if (Number(notas.n)) throw new ErrorTarjeta('Falta tildar las notas de corrección en la ficha del video antes de marcarlo listo.', 409, 'notas_pendientes')
    if (bloqueo && bloqueo !== 'sin_link_editado') throw new ErrorTarjeta('El video tiene un bloqueo pendiente. Revisalo en su ficha.', 409, 'motor_bloqueado')
  }
  if (p.accion === 'mover' && estado === 'correccion' && anterior !== 'correccion' && p.origen !== 'cliente') interna++
  if (bloqueo === 'sin_link_editado' && t.campos.editado || p.accion === 'mover' && p.autorizarTercera && actor.rol === 'tomas' && bloqueo === 'tope_rondas_cliente') { bloqueo = null; motivo = '' }
  const okCliente = p.accion === 'mover' && p.etapa === 'publicado' ? { quien: actor.nombre, cuando: new Date().toISOString(), texto: p.comentario, cita: p.comentario } : estado !== 'aprobado' && p.accion === 'mover' ? null : v.ok_cliente
  const envio = p.accion === 'mover' && ['correccion', 'esperando_crudos'].includes(estado) || p.accion === 'campos' && p.campos.editado !== antes.campos.editado ? null : v.envio_link
  const link = p.accion === 'campos' ? t.campos.editado || null : t.campos.editado || v.editado_url || null
  const r = await c.query(`UPDATE cj_videos SET estado=$2,estado_desde=CASE WHEN estado<>$2 THEN now() ELSE estado_desde END,ronda_interna=$3,ronda_cliente=$4,editado_url=$5,editado_archivo_id=CASE WHEN editado_url IS DISTINCT FROM $5 THEN NULL ELSE editado_archivo_id END,ok_cliente=$6::jsonb,envio_link=$7::jsonb,bloqueo=$8,motivo_bloqueo=$9,version=version+1,actualizado=now() WHERE id=$1 AND version=$10 RETURNING version`, [v.id, estado, interna, t.ronda_cliente, link, JSON.stringify(okCliente ?? null), JSON.stringify(envio ?? null), bloqueo, motivo, v.version])
  if (!r.rows[0]) throw new ErrorTarjeta('El motor cambió este video mientras se guardaba.', 409, 'conflicto_motor')
  const nota = p.accion === 'mover' && estado === 'correccion' ? p.comentario : p.accion === 'comentar' && estado === 'correccion' && actor.rol !== 'rene' ? p.texto : null
  if (nota) await c.query("INSERT INTO cj_video_notas(video_id,ronda,origen,enviada,tipo,texto,creado_por) VALUES($1,$2,$3,true,'otro',$4,$5)", [v.id, interna + t.ronda_cliente, p.accion === 'mover' && p.origen === 'cliente' ? 'cliente' : 'aylu', nota, actor.nombre])
  await c.query("INSERT INTO cj_video_eventos(video_id,id_crm,tipo,de,a,actor_tipo,actor_rol,actor_nombre,actor_email,nota,datos) VALUES($1,$2,$3,$4,$5,'persona',$6,$7,$8,$9,$10::jsonb)", [v.id, t.id_crm, p.accion === 'mover' ? 'estado' : 'nota', p.accion === 'mover' ? anterior : null, p.accion === 'mover' ? estado : null, actor.rol, actor.nombre, actor.email, texto, JSON.stringify({ origen: 'tarjetas', tarjeta_id: t.id, evento_tarjeta: evento })])
  return Number(r.rows[0].version)
}
export async function cambiarTarjeta(p: PedidoTarjetaEdicion, actor: Persona): Promise<TarjetaEdicion> {
  const huella = createHash('sha256').update(JSON.stringify(p)).digest('hex')
  return transaccionTarjetas(async c => {
    const ya = (await c.query('SELECT huella,respuesta FROM cj_edicion_tarjetas_operaciones WHERE actor=$1 AND clave=$2', [actor.email, p.clave])).rows[0]
    if (ya) { if (ya.huella !== huella) throw new ErrorTarjeta('La clave corresponde a otro contenido; no se repitió ni modificó el intento.', 409, 'clave_reutilizada'); return objeto<TarjetaEdicion>(ya.respuesta, {} as TarjetaEdicion) }
    const fila = (await c.query('SELECT * FROM cj_edicion_tarjetas WHERE id=$1 FOR UPDATE', [p.id])).rows[0]
    if (!fila) throw new ErrorTarjeta('La tarjeta ya no existe.', 404, 'no_existe')
    const antes = tarjetaDesdeFila(fila)
    const video = antes.video_id ? (await c.query('SELECT * FROM cj_videos WHERE id=$1 FOR UPDATE', [antes.video_id])).rows[0] : null
    if (antes.video_id && (!video || video.id_crm !== antes.id_crm || video.clickup_id && video.clickup_id !== antes.id && `cu_${video.clickup_id}` !== antes.id)) throw new ErrorTarjeta('El vínculo entre tarjeta, video y cliente es incierto.', 409, 'vinculo_incierto')
    if (video && (!antes.video_version || Number(video.version) !== antes.video_version)) throw new ErrorTarjeta('El motor actualizó este video o falta confirmar su versión. Recargá su estado antes de continuar.', 409, 'conflicto_motor')
    if (video) antes.ronda_cliente = Math.max(antes.ronda_cliente, Number(video.ronda_cliente))
    const plan = planTarjeta(antes, p, actor), t = plan.tarjeta, evento = `evt_${randomUUID()}`
    const videoVersion = video ? await actualizarVideoTarjeta(c, video, antes, t, p, actor, plan.texto, evento) : null
    const entrega = p.accion === 'mover' ? p.etapa === 'revisión' ? evento : null : p.accion === 'campos' && p.campos.editado !== antes.campos.editado ? null : antes.entrega_evento
    const actual = (await c.query(`UPDATE cj_edicion_tarjetas SET etapa=$2,campos=$3::jsonb,version=version+1,ronda_cliente=$4,entrega_evento=$5,actualizado=now(),video_version=$7,motor_bloqueado=$8 WHERE id=$1 AND version=$6 RETURNING *`, [t.id, t.etapa, JSON.stringify(t.campos), t.ronda_cliente, entrega, p.version, videoVersion, t.motor_bloqueado ?? null])).rows[0]
    if (!actual) throw new ErrorTarjeta('Otra persona cambió esta tarjeta.', 409, 'conflicto')
    await c.query('INSERT INTO cj_edicion_tarjetas_historial(id,tarjeta_id,quien,actor_email,tipo,antes,despues,texto,datos) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)', [evento, t.id, actor.nombre, actor.email, p.accion === 'mover' ? 'movimiento' : p.accion === 'campos' ? 'campos' : 'comentario', p.accion === 'mover' ? antes.etapa : null, p.accion === 'mover' ? t.etapa : null, plan.texto, JSON.stringify({ version: t.version, ...(p.accion === 'mover' ? { origen: p.origen, autorizacion: p.autorizarTercera === true } : {}) })])
    for (const [i, a] of plan.avisos.entries()) {
      let minutos = a.tipo_aviso === 'correccion' ? 10 : 0
      if (['editado', 'corregido'].includes(a.tipo_aviso ?? '')) {
        const otros = (await c.query("SELECT 1 FROM cj_edicion_tarjetas WHERE id_crm=$1 AND id<>$2 AND parent_id IS NOT NULL AND etapa IN ('para editar','editando') LIMIT 1", [t.id_crm, t.id])).rows.length; minutos = otros ? 30 : 0
        if (!otros) await c.query("UPDATE cj_edicion_tarjetas_outbox SET disponible=now() WHERE estado='pendiente' AND destino=$1 AND datos->>'id_crm'=$2 AND datos->>'tipo_aviso'=$3", [a.destino, t.id_crm, a.tipo_aviso])
      }
      await c.query("INSERT INTO cj_edicion_tarjetas_outbox(id,tarjeta_id,evento_id,canal,destino,datos,disponible) VALUES($1,$2,$3,$4,$5,$6::jsonb,now()+$7::int*interval '1 minute')", [`${evento}:${i}`, t.id, evento, a.canal, a.destino, JSON.stringify({ ...a, id_crm: t.id_crm, tarjeta: t.nombre, evento_id: evento }), minutos])
    }
    const respuesta = { ...tarjetaDesdeFila(actual), hijos: [], espera_whatsapp: p.accion === 'mover' && p.etapa === 'revisión' }
    await c.query('INSERT INTO cj_edicion_tarjetas_operaciones(actor,clave,tarjeta_id,huella,respuesta) VALUES($1,$2,$3,$4,$5::jsonb)', [actor.email, p.clave, t.id, huella, JSON.stringify(respuesta)])
    return respuesta
  })
}
export interface TarjetaInicial extends Omit<TarjetaGuardada, 'version' | 'actualizado' | 'ronda_cliente'> { ronda_cliente?: number; snapshot_fecha?: string }
export interface ComentarioInicial { id: string; tarjeta_id: string; fecha: string; quien: string; texto: string }
/** Sólo baseline autorizado: no actualiza tarjetas existentes ni produce avisos. La jerarquía completa se valida al commit. */
export async function importarTarjetasIniciales(filas: TarjetaInicial[], comentarios: ComentarioInicial[] = []): Promise<{ tarjetas: number; comentarios: number }> {
  if (filas.length > 10000 || new Set(filas.map(f => f.id)).size !== filas.length) throw new ErrorTarjeta('El baseline tiene IDs duplicados o demasiadas tarjetas.', 422)
  return transaccionTarjetas(async c => {
    let tarjetas = 0, eventos = 0
    for (const f of filas) {
      if (!/^[A-Za-z0-9_-]{5,80}$/.test(f.id) || !esEtapaTarjeta(f.etapa) || !f.nombre?.trim() || f.id_crm && !/^[A-Z]\d{1,6}$/.test(f.id_crm)) throw new ErrorTarjeta('Tarjeta de importación inválida.', 422)
      // Un replay de baseline nunca vuelve a alinear el motor ni pisa una tarjeta ya trabajada.
      if ((await c.query('SELECT id FROM cj_edicion_tarjetas WHERE id=$1', [f.id])).rows.length) continue
      const v = f.video_id ? (await c.query('SELECT id_crm,clickup_id,estado,version,ronda_cliente,editado_url FROM cj_videos WHERE id=$1 FOR UPDATE', [f.video_id])).rows[0] : null
      if (f.video_id && (!v || v.id_crm !== f.id_crm || v.clickup_id && f.id !== v.clickup_id && f.id !== `cu_${v.clickup_id}`)) throw new ErrorTarjeta('El video del baseline no coincide con su ID CRM o ClickUp.', 422, 'vinculo_incierto')
      if (v && f.video_version && f.video_version !== Number(v.version)) throw new ErrorTarjeta('El motor cambió desde que se preparó el baseline; revisar antes de importar.', 409, 'conflicto_motor')
      const bloqueo = v && f.etapa === 'publicado' && v.estado !== 'aprobado' ? 'finalizado_en_clickup' : v && ['pausado', 'descartado'].includes(String(v.estado)) ? String(v.estado) : f.motor_bloqueado ?? null
      const r = await c.query(`INSERT INTO cj_edicion_tarjetas(id,parent_id,id_crm,video_id,nombre,etapa,campos,prioridad,asignados,clickup_url,ronda_cliente,video_version,motor_bloqueado) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`, [f.id, f.parent_id, f.id_crm, f.video_id, f.nombre, f.etapa, JSON.stringify(f.campos), f.prioridad ?? null, JSON.stringify(f.asignados ?? []), f.clickup_url ?? null, Math.max(f.ronda_cliente ?? 0, Number(v?.ronda_cliente ?? 0)), f.video_version ?? (v ? Number(v.version) : null), bloqueo]); tarjetas += r.rowCount ?? 0
      if (r.rowCount && bloqueo === 'finalizado_en_clickup') await c.query("INSERT INTO cj_edicion_tarjetas_historial(id,tarjeta_id,quien,tipo,texto,datos) VALUES($1,$2,'ClickUp (baseline)','comentario',$3,'{\"origen\":\"clickup_baseline\"}') ON CONFLICT(id) DO NOTHING", [`baseline_final:${f.id}`, f.id, 'El baseline de ClickUp muestra Publicado. Se conserva como finalizado histórico y se excluye del trabajo automático; no se inventó una cita del OK del cliente.'])
      if (r.rowCount && v && !bloqueo && f.etapa !== 'publicado' && /^https:\/\/app\.clickup\.com\/t\/[A-Za-z0-9]+$/.test(f.clickup_url ?? '')) {
        const mapa: Record<string, string> = { 'en espera de datos': 'esperando_crudos', 'para editar': 'para_editar', editando: 'para_editar', editado: 'editado', corregido: 'corregido', 'revisión': 'con_cliente', publicar: 'con_cliente' }
        const destino = mapa[f.etapa], link = f.campos.editado || v.editado_url || null
        const nuevo = (await c.query('UPDATE cj_videos SET estado=$2,estado_desde=CASE WHEN estado<>$2 THEN now() ELSE estado_desde END,editado_url=$3,editado_archivo_id=CASE WHEN editado_url IS DISTINCT FROM $3 THEN NULL ELSE editado_archivo_id END,version=version+1,actualizado=now() WHERE id=$1 AND version=$4 RETURNING version', [f.video_id, destino, link, v.version])).rows[0]
        if (!nuevo) throw new ErrorTarjeta('El motor cambió durante el baseline.', 409, 'conflicto_motor')
        await c.query('UPDATE cj_edicion_tarjetas SET video_version=$2 WHERE id=$1', [f.id, nuevo.version])
        await c.query("INSERT INTO cj_video_eventos(video_id,id_crm,tipo,de,a,actor_tipo,actor_nombre,nota,datos) VALUES($1,$2,'importado',$3,$4,'bot','ClickUp (baseline)',$5,$6::jsonb)", [f.video_id, f.id_crm, v.estado, destino, 'Alineación del motor con la etapa literal verificada de ClickUp; sin avisos ni constancias de envío.', JSON.stringify({ origen: 'tarjetas_baseline', tarjeta_id: f.id, etapa_literal: f.etapa, snapshot_fecha: f.snapshot_fecha ?? null })])
      }
    }
    for (const e of comentarios) {
      if (!e.id || e.id.length > 150 || !e.texto?.trim() || !Number.isFinite(Date.parse(e.fecha))) throw new ErrorTarjeta('Comentario de importación inválido.', 422)
      const r = await c.query("INSERT INTO cj_edicion_tarjetas_historial(id,tarjeta_id,fecha,quien,tipo,texto,datos) VALUES($1,$2,$3::timestamptz,$4,'comentario',$5,'{\"origen\":\"clickup_baseline\"}') ON CONFLICT(id) DO NOTHING", [e.id, e.tarjeta_id, e.fecha, e.quien, e.texto]); eventos += r.rowCount ?? 0
    }
    const actuales = (await c.query('SELECT * FROM cj_edicion_tarjetas')).rows.map(tarjetaDesdeFila)
    arbolTarjetas(actuales)
    const porId = new Map(actuales.map(f => [f.id, f]))
    for (const f of actuales) { let padre = f.parent_id; while (padre) { const p = porId.get(padre); if (p?.id_crm && f.id_crm && p.id_crm !== f.id_crm) throw new ErrorTarjeta('Un padre y un descendiente apuntan a clientes distintos.', 422, 'vinculo_incierto'); padre = p?.parent_id ?? null } }
    return { tarjetas, comentarios: eventos }
  })
}
export async function videosFinalizadosImportados(): Promise<Set<number>> {
  const filas = await leerOperativo('videos finalizados en ClickUp', [] as FilaOperativa[], q => q`SELECT video_id FROM cj_edicion_tarjetas WHERE video_id IS NOT NULL AND motor_bloqueado='finalizado_en_clickup'` as Promise<FilaOperativa[]>)
  return new Set(filas.map(f => Number(f.video_id)).filter(Number.isSafeInteger))
}
export interface SalidaTarjeta { id: string; tarjeta_id: string; evento_id: string; evento_fecha?: string; requiere_revision?: boolean; canal: AvisoTarjeta['canal']; destino: AvisoTarjeta['destino']; datos: AvisoTarjeta & { id_crm: string; tarjeta: string; evento_id: string; lote_id?: string } }
/** Consulta separada: un aviso antiguo no ocupa el LIMIT de la cola habilitada. */
export const SQL_APARCAR_ENTREGAS_ANTIGUAS = `UPDATE cj_edicion_tarjetas_outbox o SET estado='espera_revision',error='Entrega anterior: requiere una nueva revisión antes de enviar.' FROM cj_edicion_tarjetas_historial h WHERE h.id=o.evento_id AND o.canal='cliente' AND o.estado IN ('pendiente','espera_conexion') AND (h.fecha<now()-interval '24 hours' OR ($1::timestamptz IS NOT NULL AND h.fecha<$1::timestamptz))`
export const SQL_TOMAR_SALIDAS_TARJETAS = `WITH grupos AS (SELECT canal,destino,datos->>'id_crm' cliente,datos->>'tipo_aviso' tipo,COALESCE(datos->>'lote_id','') previo,COALESCE(datos->>'lote_id','lote_'||md5(min(id))) lote,min(disponible) vence FROM cj_edicion_tarjetas_outbox WHERE estado IN ('pendiente','espera_conexion') AND disponible<=now() GROUP BY canal,destino,datos->>'id_crm',datos->>'tipo_aviso',datos->>'lote_id' ORDER BY vence LIMIT $1), tomados AS (SELECT o.id,g.lote FROM cj_edicion_tarjetas_outbox o JOIN grupos g ON o.canal=g.canal AND o.destino=g.destino AND o.datos->>'id_crm'=g.cliente AND o.datos->>'tipo_aviso'=g.tipo AND COALESCE(o.datos->>'lote_id','')=g.previo WHERE o.estado IN ('pendiente','espera_conexion') AND o.disponible<=now() FOR UPDATE OF o SKIP LOCKED) UPDATE cj_edicion_tarjetas_outbox o SET estado='enviando',tomado=now(),intentos=intentos+1,datos=o.datos||jsonb_build_object('lote_id',t.lote) FROM tomados t WHERE o.id=t.id RETURNING o.*`
export async function tomarSalidasTarjetas(limite = 12): Promise<SalidaTarjeta[]> { return leer(async c => {
  await c.query("UPDATE cj_edicion_tarjetas_outbox SET estado=CASE WHEN canal='hub' THEN 'pendiente' ELSE 'dudoso' END,error='Se interrumpió el envío: verificar su resultado antes de repetir' WHERE estado='enviando' AND tomado < now()-interval '10 minutes'")
  const desde = process.env.EDICION_WHATSAPP_DESDE?.trim() ?? '', fecha = Date.parse(desde)
  const corte = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(desde) && Number.isFinite(fecha) && fecha <= Date.now() && new Date(fecha).toISOString().replace('.000Z', 'Z') === desde.replace('.000Z', 'Z') ? desde : null
  await c.query(SQL_APARCAR_ENTREGAS_ANTIGUAS, [corte])
  const revisiones = (await c.query("SELECT o.* FROM cj_edicion_tarjetas_outbox o JOIN cj_edicion_tarjetas_historial h ON h.id=o.evento_id WHERE o.estado='espera_revision' AND COALESCE(o.datos->>'revision_notificada','false')<>'true' ORDER BY h.fecha,o.id LIMIT 20")).rows.map(f => ({ ...f, requiere_revision: true }))
  const r = await c.query(SQL_TOMAR_SALIDAS_TARJETAS, [Math.min(30, Math.max(1, limite))])
  r.rows.push(...revisiones)
  // La antigüedad de una entrega es la del evento original, nunca la del último reintento.
  const fechas = r.rows.length ? new Map((await c.query('SELECT id,fecha FROM cj_edicion_tarjetas_historial WHERE id=ANY($1::text[])', [r.rows.map(f => f.evento_id)])).rows.map(f => [String(f.id), iso(f.fecha)])) : new Map<string, string>()
  return r.rows.map(f => ({ ...f, evento_fecha: fechas.get(String(f.evento_id)), datos: objeto(f.datos, {}) })) as SalidaTarjeta[]
}, []) }
export async function cerrarSalidaTarjeta(id: string, estado: 'enviado' | 'pendiente' | 'espera_conexion' | 'espera_revision' | 'dudoso' | 'descartado', error = '', mensajeId: string | null = null): Promise<void> { await leer(async c => { await c.query("UPDATE cj_edicion_tarjetas_outbox SET estado=$2,error=$3,mensaje_id=$4,enviado=CASE WHEN $2='enviado' THEN now() ELSE enviado END,datos=CASE WHEN $2='espera_revision' THEN datos||'{\"revision_notificada\":true}'::jsonb ELSE datos END,disponible=now()+interval '5 minutes' WHERE id=$1 AND (estado='enviando' OR estado='espera_revision' AND $2 IN ('espera_revision','descartado'))", [id, estado, error.slice(0, 250), mensajeId]); return undefined }, undefined) }
