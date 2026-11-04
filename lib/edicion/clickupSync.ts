// ── Sincronización ClickUp ↔ tablero de Edición del Despacho (4/11/2026) ─────────────────────────────────────────────
// Pedido de Tomás: «cuando le doy a actualizar no se actualiza… necesito poder crear tarjetas y que esté todo
// sincronizado… mantenelo sincronizado con ambas» (ClickUp y el tablero). Antes, ClickUp se importó UNA vez (1/11) y
// nada lo volvía a mirar: el botón Actualizar releía la misma base.
// De ClickUp al Despacho: el webhook (/api/edicion/clickup) avisa qué tarea cambió; el vigía (cada 15 min) y el botón
// Actualizar piden las tareas modificadas desde la última lectura (con 2 minutos de margen). Cada tarea se vuelve a pedir
// entera y se aplica a su tarjeta (cu_<id>): crear, mover de etapa, campos (paleta, crudo, editado), nombre, prioridad y
// asignados. Idempotente: una tarea con la misma fecha de modificación que la última aplicada no se vuelve a aplicar.
// Del Despacho a ClickUp: la outbox de las tarjetas (canal «clickup», en la misma transacción que el cambio) replica
// estados, campos, comentarios y altas. Solo con EDICION_CLICKUP_ESCRIBIR=real; si no, queda en cola.
// Conflictos: lo que llega de ClickUp igual a lo último que escribió el Despacho (clickup_eco) es nuestro rebote y no
// pisa nada; si no, gana el cambio más reciente (fecha de la tarea en ClickUp contra la de la tarjeta). Un «publicado» que
// llega de ClickUp en un video sin OK del motor queda como finalizado_en_clickup (el criterio del baseline).
// Un movimiento a «publicar» desde ClickUp (después de EDICION_PUBLICAR_DESDE) deja el anuncio pendiente (publicar.ts).
import type { PoolClient } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { crearCruceCarpetas } from '@/lib/clientes/prioridad'
import { ETAPAS_TARJETAS, type CamposTarjetaEdicion, type EtapaTarjeta } from './tarjetasTipos'
import type { ClickUp, TareaSync } from './clickupApi'
import { idUsuarioClickUp } from './clickupApi'
import { disparaPublicacion, registrarPublicacion } from './publicacionesDb'

export type CampoEco = 'etapa' | 'paleta' | 'crudo' | 'editado'
export interface TarjetaSync {
  id: string; parent_id: string | null; id_crm: string | null; video_id: number | null; nombre: string; etapa: EtapaTarjeta
  campos: CamposTarjetaEdicion; prioridad: string | null; asignados: string[]; clickup_id: string | null
  clickup_actualizado: string | null; clickup_eco: Partial<Record<CampoEco, string>>; actualizado: string; borrada: string | null
  motor_bloqueado: string | null; origen: string | null
}
export interface CambiosSync { etapa?: EtapaTarjeta; campos?: CamposTarjetaEdicion; nombre?: string; prioridad?: string | null; asignados?: string[] }
export type PlanSync =
  | { tipo: 'nada'; motivo: string }
  | { tipo: 'borrar' }
  | { tipo: 'crear'; etapa: EtapaTarjeta; campos: CamposTarjetaEdicion; nombre: string; prioridad: string | null; asignados: string[]; publicar: boolean }
  | { tipo: 'actualizar'; cambios: CambiosSync; publicar: boolean; ignorados: string[] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
/** El estado de ClickUp → la etapa del tablero (son las mismas 8 columnas). null = desconocido. Puro. */
export function etapaDeClickUp(estado: string): EtapaTarjeta | null {
  const n = norm(estado)
  return ETAPAS_TARJETAS.find(e => norm(e) === n) ?? null
}
const camposDe = (t: TareaSync): CamposTarjetaEdicion => ({ paleta: t.campos.paleta ?? '', crudo: t.campos.crudo ?? '', editado: t.campos.editado ?? '' })
const ms = (x: string | null | undefined) => { const n = Date.parse(String(x ?? '')); return Number.isFinite(n) ? n : 0 }
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Qué hacer con una tarea de ClickUp frente a su tarjeta. Puro (lo prueba scripts/test-edicion-sync.mjs).
 * · misma fecha de modificación que la última aplicada → nada (idempotente);
 * · por campo: igual → nada; igual a lo último que escribió el Despacho (eco) → nuestro rebote, se ignora; distinto → gana
 *   el más reciente (la tarea si se modificó después que la tarjeta; si no, la tarjeta, y su outbox lo lleva a ClickUp).
 */
export function planSync(t: TareaSync, actual: TarjetaSync | null, op: { lista: string; publicarDesdeMs: number | null }): PlanSync {
  if (t.lista && t.lista !== op.lista) return actual && !actual.borrada ? { tipo: 'borrar' } : { tipo: 'nada', motivo: 'la tarea no es de la lista de Edición' }
  const etapa = etapaDeClickUp(t.estado)
  if (!etapa) return { tipo: 'nada', motivo: `estado de ClickUp desconocido: ${t.estado}` }
  const cuMs = ms(t.actualizada), campos = camposDe(t), prioridad = t.prioridad ?? null
  if (!actual) return { tipo: 'crear', etapa, campos, nombre: t.nombre || 'Sin nombre', prioridad, asignados: t.asignados, publicar: disparaPublicacion({ antes: null, despues: etapa, cuandoMs: cuMs, desdeMs: op.publicarDesdeMs }) }
  if (actual.clickup_actualizado && cuMs && cuMs <= ms(actual.clickup_actualizado)) return { tipo: 'nada', motivo: 'ya aplicada' }
  const cambios: CambiosSync = {}, ignorados: string[] = []
  const gana = (k: CampoEco, cu: string, ne: string): boolean => {
    if (cu === ne) return false
    if (actual.clickup_eco[k] !== undefined && cu === actual.clickup_eco[k]) { ignorados.push(`${k}: rebote del Despacho`); return false }
    if (ms(actual.actualizado) > cuMs) { ignorados.push(`${k}: el Despacho es más reciente`); return false }
    return true
  }
  if (gana('etapa', etapa, actual.etapa)) cambios.etapa = etapa
  const nuevos = { ...actual.campos }
  let tocados = false
  for (const k of ['paleta', 'crudo', 'editado'] as const) if (gana(k, campos[k], actual.campos[k] ?? '')) { nuevos[k] = campos[k]; tocados = true }
  if (tocados) cambios.campos = nuevos
  if (t.nombre && t.nombre !== actual.nombre) cambios.nombre = t.nombre
  if (prioridad !== (actual.prioridad ?? null)) cambios.prioridad = prioridad
  if (!igual(t.asignados, actual.asignados ?? [])) cambios.asignados = t.asignados
  const publicar = !!cambios.etapa && disparaPublicacion({ antes: actual.etapa, despues: cambios.etapa, cuandoMs: cuMs, desdeMs: op.publicarDesdeMs })
  return Object.keys(cambios).length ? { tipo: 'actualizar', cambios, publicar, ignorados } : { tipo: 'nada', motivo: ignorados.length ? ignorados.join(' · ') : 'sin cambios' }
}

/**
 * El eco (lo último que el Despacho escribió en ClickUp) se consume: si ClickUp ya muestra otro valor (una persona lo cambió
 * después) o ya coincide con la tarjeta (convergieron), deja de valer. Sin esto, un cambio real en ClickUp que vuelve al valor
 * que alguna vez escribió el Despacho (p. ej. «para editar» otra vez, por una corrección) se ignoraba para siempre. Puro.
 */
export function ecoTras(t: TareaSync, actual: TarjetaSync, aplicados: CambiosSync = {}): Partial<Record<CampoEco, string>> {
  const etapa = etapaDeClickUp(t.estado), campos = camposDe(t)
  const tarjeta: Record<CampoEco, string> = { etapa: aplicados.etapa ?? actual.etapa, ...{ paleta: actual.campos.paleta ?? '', crudo: actual.campos.crudo ?? '', editado: actual.campos.editado ?? '' }, ...(aplicados.campos ?? {}) }
  const cu: Record<CampoEco, string> = { etapa: etapa ?? '', paleta: campos.paleta, crudo: campos.crudo, editado: campos.editado }
  const out: Partial<Record<CampoEco, string>> = {}
  for (const [k, v] of Object.entries(actual.clickup_eco ?? {}) as [CampoEco, string][]) if (v !== undefined && cu[k] === v && tarjeta[k] !== v) out[k] = v
  return out
}

/** La marca «despacho:<id>» de una tarea dada de alta desde el tablero (va en su descripción). Puro. */
export const marcaDespacho = (descripcion: string): string | null => /despacho:(dsp_[a-f0-9]{24})\b/.exec(descripcion ?? '')?.[1] ?? null

/** Tareas raíz nuevas → cliente del CRM (el mismo cruce del import: un solo cliente por tarjeta, si no, sin cruzar). Puro. */
export function cruzarRaices(raices: readonly { id: string; nombre: string }[], crm: readonly { id: string; nombre: string; estado?: string }[]): Map<string, string> {
  const out = new Map<string, string>(), dobles = new Set<string>()
  if (!raices.length) return out
  const buscar = crearCruceCarpetas([...raices], x => x.nombre, crm.map(c => c.nombre))
  for (const c of crm) {
    const r = buscar(c.nombre)
    if (!r) continue
    if (out.has(r.id) && out.get(r.id) !== c.id.toUpperCase()) dobles.add(r.id)
    else out.set(r.id, c.id.toUpperCase())
  }
  for (const id of dobles) out.delete(id)
  return out
}

/** Padres antes que hijos (una subtarea nueva necesita la tarjeta de su cliente). Puro. */
export function ordenarTareas(ts: readonly TareaSync[]): TareaSync[] {
  const porId = new Map(ts.map(t => [t.id, t])), out: TareaSync[] = [], vistos = new Set<string>()
  const visitar = (t: TareaSync, pila = new Set<string>()) => { if (vistos.has(t.id) || pila.has(t.id)) return; pila.add(t.id); const p = t.padre ? porId.get(t.padre) : null; if (p) visitar(p, pila); vistos.add(t.id); out.push(t) }
  for (const t of ts) visitar(t)
  return out
}

// ── Base (Neon) ──────────────────────────────────────────────────────────────────────────────────────────────────────
const objeto = <T>(x: unknown, d: T): T => { if (typeof x === 'string') { try { return JSON.parse(x) as T } catch { return d } } return (x ?? d) as T }
const iso = (x: unknown) => x ? new Date(String(x)).toISOString() : null
export function tarjetaSyncDesdeFila(f: Record<string, unknown>): TarjetaSync {
  return { id: String(f.id), parent_id: f.parent_id ? String(f.parent_id) : null, id_crm: f.id_crm ? String(f.id_crm) : null, video_id: f.video_id ? Number(f.video_id) : null, nombre: String(f.nombre), etapa: f.etapa as EtapaTarjeta,
    campos: objeto(f.campos, { paleta: '', crudo: '', editado: '' }), prioridad: f.prioridad ? String(f.prioridad) : null, asignados: objeto(f.asignados, []), clickup_id: f.clickup_id ? String(f.clickup_id) : null,
    clickup_actualizado: iso(f.clickup_actualizado), clickup_eco: objeto(f.clickup_eco, {}), actualizado: iso(f.actualizado) ?? new Date(0).toISOString(), borrada: iso(f.borrada), motor_bloqueado: f.motor_bloqueado ? String(f.motor_bloqueado) : null, origen: f.origen ? String(f.origen) : null }
}
const MAPA_MOTOR: Record<string, string> = { 'en espera de datos': 'esperando_crudos', 'para editar': 'para_editar', editando: 'para_editar', editado: 'editado', corregido: 'corregido', 'revisión': 'con_cliente', publicar: 'con_cliente' }

export interface ResultadoAplicar { creadas: number; actualizadas: number; borradas: number; iguales: number; publicar: string[]; omitidas: { tarea: string; motivo: string }[] }

/** Aplica las tareas (ya ordenadas) dentro de UNA transacción. idCrmRaices: el cruce de las raíces nuevas. */
export async function aplicarTareas(c: PoolClient, tareas: readonly TareaSync[], op: { lista: string; publicarDesdeMs: number | null; idCrmRaices: Map<string, string>; borradas?: readonly string[] }): Promise<ResultadoAplicar> {
  const r: ResultadoAplicar = { creadas: 0, actualizadas: 0, borradas: 0, iguales: 0, publicar: [], omitidas: [] }
  const historial = async (tarjeta: string, tipo: string, antes: string | null, despues: string | null, texto: string, datos: Record<string, unknown>) =>
    c.query("INSERT INTO cj_edicion_tarjetas_historial(id,tarjeta_id,quien,tipo,antes,despues,texto,datos) VALUES($1,$2,'ClickUp',$3,$4,$5,$6,$7::jsonb) ON CONFLICT(id) DO NOTHING", [`cu_${createHash('sha256').update(`${tarjeta}|${JSON.stringify(datos)}`).digest('hex').slice(0, 28)}`, tarjeta, tipo, antes, despues, texto, JSON.stringify({ origen: 'clickup_sync', ...datos })])
  for (const id of op.borradas ?? []) {
    const b = await c.query("UPDATE cj_edicion_tarjetas SET borrada=now(),version=version+1,actualizado=now() WHERE (clickup_id=$1 OR id='cu_'||$1) AND borrada IS NULL RETURNING id", [id])
    for (const f of b.rows) { r.borradas++; await historial(String(f.id), 'comentario', null, null, 'La tarea se borró (o salió de la lista) en ClickUp: la tarjeta deja de mostrarse.', { tarea: id, borrada: true }) }
  }
  for (const t of tareas) {
    let fila = (await c.query("SELECT * FROM cj_edicion_tarjetas WHERE clickup_id=$1 OR id='cu_'||$1 ORDER BY (clickup_id=$1) DESC LIMIT 1 FOR UPDATE", [t.id])).rows[0]
    // Una tarea que dio de alta el Despacho puede llegar (webhook o sondeo) antes de que la outbox anote su clickup_id:
    // se reconoce por la marca de la descripción y se vincula a SU tarjeta, nunca se crea una segunda.
    const marca = !fila ? marcaDespacho(t.descripcion) : null
    if (marca) {
      fila = (await c.query("UPDATE cj_edicion_tarjetas SET clickup_id=$2,clickup_url=COALESCE(clickup_url,$3) WHERE id=$1 AND origen='despacho' AND (clickup_id IS NULL OR clickup_id=$2) RETURNING *", [marca, t.id, t.url || null])).rows[0]
      if (fila) await c.query("UPDATE cj_edicion_tarjetas_outbox SET estado='enviado',enviado=now(),error='vinculada por la marca al llegar de ClickUp' WHERE tarjeta_id=$1 AND canal='clickup' AND estado='pendiente' AND datos->>'op'='crear'", [marca])
    }
    const actual = fila ? tarjetaSyncDesdeFila(fila) : null
    const plan = planSync(t, actual, op)
    if (plan.tipo === 'nada') {
      r.iguales++
      if (actual) {
        const eco = ecoTras(t, actual)
        if (ms(t.actualizada) > ms(actual.clickup_actualizado) || !igual(eco, actual.clickup_eco)) await c.query('UPDATE cj_edicion_tarjetas SET clickup_actualizado=GREATEST(clickup_actualizado,$2::timestamptz),clickup_eco=$3::jsonb WHERE id=$1', [actual.id, t.actualizada, JSON.stringify(eco)])
      }
      continue
    }
    if (plan.tipo === 'borrar') { await c.query('UPDATE cj_edicion_tarjetas SET borrada=now(),version=version+1,actualizado=now() WHERE id=$1', [actual!.id]); r.borradas++; await historial(actual!.id, 'comentario', null, null, 'La tarea salió de la lista de Edición en ClickUp: la tarjeta deja de mostrarse.', { tarea: t.id, borrada: true }); continue }
    if (plan.tipo === 'crear') {
      let parent: string | null = null, idCrm: string | null = null
      if (t.padre) {
        const p = (await c.query("SELECT id,id_crm FROM cj_edicion_tarjetas WHERE clickup_id=$1 OR id='cu_'||$1 LIMIT 1", [t.padre])).rows[0]
        if (!p) { r.omitidas.push({ tarea: t.id, motivo: 'la tarea del cliente todavía no está en el tablero' }); continue }
        parent = String(p.id); idCrm = p.id_crm ? String(p.id_crm) : null
      } else idCrm = op.idCrmRaices.get(t.id) ?? null
      const id = `cu_${t.id}`
      const ins = await c.query(`INSERT INTO cj_edicion_tarjetas(id,parent_id,id_crm,nombre,etapa,campos,prioridad,asignados,clickup_url,clickup_id,clickup_actualizado,origen)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,'clickup') ON CONFLICT(id) DO NOTHING RETURNING id`, [id, parent, idCrm, plan.nombre, plan.etapa, JSON.stringify(plan.campos), plan.prioridad, JSON.stringify(plan.asignados), t.url || null, t.id, t.actualizada])
      if (!ins.rows.length) { r.omitidas.push({ tarea: t.id, motivo: 'ya existía con otro vínculo' }); continue }
      r.creadas++
      await historial(id, 'movimiento', null, plan.etapa, `Tarjeta creada en ClickUp${idCrm ? '' : ' (cliente por vincular: queda de solo lectura)'}.`, { tarea: t.id, alta: true })
      if (plan.publicar && idCrm) { await registrarPublicacion(c, { id, id_crm: idCrm, editado: plan.campos.editado }, 'clickup'); r.publicar.push(id) }
      continue
    }
    const a = actual!, k = plan.cambios
    let bloqueo = a.motor_bloqueado, videoVersion: number | null = null
    // El video del motor sigue a la etapa literal de ClickUp (como en el baseline), salvo pausado o descartado.
    if (k.etapa && a.video_id) {
      const v = (await c.query('SELECT id,estado,version,editado_url FROM cj_videos WHERE id=$1 FOR UPDATE', [a.video_id])).rows[0]
      if (v && !['pausado', 'descartado'].includes(String(v.estado))) {
        if (k.etapa === 'publicado') { if (v.estado !== 'aprobado') bloqueo = 'finalizado_en_clickup' }
        else {
          if (bloqueo === 'finalizado_en_clickup') bloqueo = null
          const destino = MAPA_MOTOR[k.etapa], link = (k.campos ?? a.campos).editado || v.editado_url || null
          if (destino && destino !== v.estado) {
            const nuevo = (await c.query('UPDATE cj_videos SET estado=$2,estado_desde=now(),editado_url=$3,editado_archivo_id=CASE WHEN editado_url IS DISTINCT FROM $3 THEN NULL ELSE editado_archivo_id END,version=version+1,actualizado=now() WHERE id=$1 AND version=$4 RETURNING version', [v.id, destino, link, v.version])).rows[0]
            if (nuevo) {
              videoVersion = Number(nuevo.version)
              await c.query("INSERT INTO cj_video_eventos(video_id,id_crm,tipo,de,a,actor_tipo,actor_nombre,nota,datos) VALUES($1,$2,'estado',$3,$4,'bot','ClickUp',$5,$6::jsonb)", [v.id, a.id_crm, v.estado, destino, `Movido en ClickUp a «${k.etapa}».`, JSON.stringify({ origen: 'tarjetas', via: 'clickup_sync', tarjeta_id: a.id })])
            }
          }
        }
      }
    }
    // actualizado = la hora del cambio en ClickUp (no la de esta escritura): si no, un cambio hecho en ClickUp mientras se
    // aplicaba el anterior parecía «más viejo que el Despacho» y se perdía.
    await c.query(`UPDATE cj_edicion_tarjetas SET etapa=$2,campos=$3::jsonb,nombre=$4,prioridad=$5,asignados=$6::jsonb,clickup_actualizado=$7,motor_bloqueado=$8,video_version=COALESCE($9,video_version),
      entrega_evento=CASE WHEN $10 THEN NULL ELSE entrega_evento END,clickup_id=COALESCE(clickup_id,$11),clickup_eco=$12::jsonb,version=version+1,actualizado=GREATEST(actualizado,COALESCE($7::timestamptz,actualizado)) WHERE id=$1`,
      [a.id, k.etapa ?? a.etapa, JSON.stringify(k.campos ?? a.campos), k.nombre ?? a.nombre, k.prioridad === undefined ? a.prioridad : k.prioridad, JSON.stringify(k.asignados ?? a.asignados), t.actualizada, bloqueo, videoVersion, !!k.etapa || !!k.campos, t.id, JSON.stringify(ecoTras(t, a, k))])
    r.actualizadas++
    if (k.etapa) await historial(a.id, 'movimiento', a.etapa, k.etapa, `${a.etapa} → ${k.etapa} (en ClickUp)`, { tarea: t.id, cuando: t.actualizada, etapa: k.etapa })
    if (k.campos) await historial(a.id, 'campos', null, null, 'Se actualizaron los campos en ClickUp.', { tarea: t.id, cuando: t.actualizada, campos: k.campos })
    if (plan.publicar && a.id_crm) { await registrarPublicacion(c, { id: a.id, id_crm: a.id_crm, editado: (k.campos ?? a.campos).editado }, 'clickup'); r.publicar.push(a.id) }
  }
  return r
}

// ── Orquestación: leer ClickUp → aplicar en una transacción → guardar hasta dónde se leyó ─────────────────────────────
export interface DepsSync {
  api: ClickUp; lista: string
  crm(): Promise<{ id: string; nombre: string; estado?: string }[]>
  transaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T>
  ahora(): number; publicarDesdeMs: number | null
}
export interface ResultadoSync extends ResultadoAplicar { leidas: number; desde: string | null; sincronizado: string; saltada?: string }
export const MARGEN_SYNC_MS = 120_000
export const PAUSA_MINIMA_SYNC_MS = 15_000

export async function sincronizarClickUp(d: DepsSync, op: { tareas?: readonly string[]; borradas?: readonly string[]; forzar?: boolean } = {}): Promise<ResultadoSync> {
  const inicio = d.ahora()
  const estado = await d.transaccion(async c => objeto<{ desde_ms?: number; ultima?: string }>((await c.query("SELECT valor FROM cj_edicion_sync WHERE clave='clickup'")).rows[0]?.valor, {}))
  const vacio = { creadas: 0, actualizadas: 0, borradas: 0, iguales: 0, publicar: [], omitidas: [], leidas: 0, desde: estado.desde_ms ? new Date(estado.desde_ms).toISOString() : null }
  if (!op.tareas && !op.borradas && !op.forzar && estado.ultima && inicio - ms(estado.ultima) < PAUSA_MINIMA_SYNC_MS) return { ...vacio, sincronizado: estado.ultima, saltada: 'recién sincronizado' }
  const desde = estado.desde_ms ? Math.max(0, estado.desde_ms - MARGEN_SYNC_MS) : 0
  let tareas: TareaSync[] = []
  if (op.tareas) { for (const id of op.tareas) { const t = await d.api.tarea(id); if (t) tareas.push(t) } }
  else tareas = await d.api.modificadas(desde)
  // Una subtarea nueva cuyo cliente no está en el tablero: se trae también la tarea del cliente
  const enLote = new Set(tareas.map(t => t.id))
  const padres = [...new Set(tareas.map(t => t.padre).filter((p): p is string => !!p && !enLote.has(p)))]
  if (padres.length) {
    const existentes = await d.transaccion(async c => new Set((await c.query("SELECT clickup_id FROM cj_edicion_tarjetas WHERE clickup_id=ANY($1::text[])", [padres])).rows.map(f => String(f.clickup_id))))
    for (const p of padres.filter(x => !existentes.has(x)).slice(0, 30)) { const t = await d.api.tarea(p); if (t) tareas.push(t) }
  }
  const ordenadas = ordenarTareas(tareas)
  const raicesNuevas = await d.transaccion(async c => { const ids = ordenadas.filter(t => !t.padre).map(t => t.id); if (!ids.length) return [] as TareaSync[]; const ya = new Set((await c.query("SELECT clickup_id FROM cj_edicion_tarjetas WHERE clickup_id=ANY($1::text[])", [ids])).rows.map(f => String(f.clickup_id))); return ordenadas.filter(t => !t.padre && !ya.has(t.id)) })
  const idCrmRaices = raicesNuevas.length ? cruzarRaices(raicesNuevas.map(t => ({ id: t.id, nombre: t.nombre })), await d.crm()) : new Map<string, string>()
  const maxMs = Math.max(estado.desde_ms ?? 0, ...tareas.map(t => ms(t.actualizada)))
  const r = await d.transaccion(async c => {
    const res = await aplicarTareas(c, ordenadas, { lista: d.lista, publicarDesdeMs: d.publicarDesdeMs, idCrmRaices, borradas: op.borradas })
    const sincronizado = new Date(d.ahora()).toISOString()
    // Un pedido puntual (webhook) no adelanta la marca de la lectura completa: el sondeo sigue leyendo desde donde iba.
    const valor = op.tareas || op.borradas ? { ...estado, ultima_puntual: sincronizado } : { desde_ms: maxMs || inicio, ultima: sincronizado, leidas: tareas.length }
    await c.query("INSERT INTO cj_edicion_sync(clave,valor) VALUES('clickup',$1::jsonb) ON CONFLICT(clave) DO UPDATE SET valor=cj_edicion_sync.valor||EXCLUDED.valor,actualizado=now()", [JSON.stringify(valor)])
    return { ...res, sincronizado }
  })
  return { ...r, leidas: tareas.length, desde: desde ? new Date(desde).toISOString() : null }
}

// ── Del Despacho a ClickUp: la outbox «clickup» ─────────────────────────────────────────────────────────────────────
export interface SalidaClickUp { id: string; tarjeta_id: string; evento_fecha: string; intentos: number; datos: Record<string, unknown> & { op: 'crear' | 'estado' | 'campos' | 'comentario' } }
export interface ResultadoPush { enviados: number; pendientes: number; descartados: number; dudosos: number; errores: string[] }
export const escrituraClickUp = (env: Record<string, string | undefined> = process.env): 'real' | 'apagado' => env.EDICION_CLICKUP_ESCRIBIR?.trim() === 'real' ? 'real' : 'apagado'
const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
const transitorio = (e: unknown) => { const s = Number((e as { status?: number }).status); return !s || s === 429 || s >= 500 }

export async function despacharClickUp(d: { api: ClickUp; transaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T>; ahora(): number; hasta: number; env?: Record<string, string | undefined> }): Promise<ResultadoPush> {
  const out: ResultadoPush = { enviados: 0, pendientes: 0, descartados: 0, dudosos: 0, errores: [] }
  if (escrituraClickUp(d.env) !== 'real') return out
  const salidas = await d.transaccion(async c => {
    // Un envío que quedó «enviando» (se cortó la función): estado y campos se pueden repetir; un alta se busca por su marca; un comentario queda dudoso.
    await c.query("UPDATE cj_edicion_tarjetas_outbox SET estado=CASE WHEN datos->>'op'='comentario' THEN 'dudoso' ELSE 'pendiente' END,datos=datos||'{\"dudoso\":true}'::jsonb,error='Se interrumpió el envío a ClickUp' WHERE canal='clickup' AND estado='enviando' AND tomado<now()-interval '10 minutes'")
    const r = await c.query("SELECT o.id,o.tarjeta_id,o.intentos,o.datos,h.fecha evento_fecha FROM cj_edicion_tarjetas_outbox o JOIN cj_edicion_tarjetas_historial h ON h.id=o.evento_id WHERE o.canal='clickup' AND o.estado='pendiente' AND o.disponible<=now() ORDER BY h.fecha,o.id LIMIT 40 FOR UPDATE OF o SKIP LOCKED")
    if (r.rows.length) await c.query("UPDATE cj_edicion_tarjetas_outbox SET estado='enviando',tomado=now(),intentos=intentos+1 WHERE id=ANY($1::text[])", [r.rows.map(f => f.id)])
    return r.rows.map(f => ({ id: String(f.id), tarjeta_id: String(f.tarjeta_id), evento_fecha: new Date(f.evento_fecha).toISOString(), intentos: Number(f.intentos) + 1, datos: objeto(f.datos, {}) })) as SalidaClickUp[]
  })
  const cerrar = (id: string, estado: 'enviado' | 'pendiente' | 'descartado' | 'dudoso', error = '', espera = 1) => d.transaccion(c => c.query("UPDATE cj_edicion_tarjetas_outbox SET estado=$2,error=$3,enviado=CASE WHEN $2='enviado' THEN now() ELSE enviado END,disponible=now()+$4::int*interval '1 minute' WHERE id=$1", [id, estado, error.slice(0, 250), espera]))
  const tarjeta = (id: string) => d.transaccion(async c => { const f = (await c.query('SELECT * FROM cj_edicion_tarjetas WHERE id=$1', [id])).rows[0]; return f ? tarjetaSyncDesdeFila(f) : null })
  const eco = (id: string, x: Partial<Record<CampoEco, string>>, extra: { clickup_id?: string; url?: string; actualizado?: string | null } = {}) => d.transaccion(c => c.query("UPDATE cj_edicion_tarjetas SET clickup_eco=clickup_eco||$2::jsonb,clickup_id=COALESCE(clickup_id,$3),clickup_url=COALESCE(clickup_url,$4),clickup_actualizado=GREATEST(clickup_actualizado,$5::timestamptz) WHERE id=$1", [id, JSON.stringify(x), extra.clickup_id ?? null, extra.url ?? null, extra.actualizado ?? null]))
  for (const s of salidas) {
    if (d.ahora() > d.hasta - 8_000) { await cerrar(s.id, 'pendiente', 'sin tiempo en esta pasada', 0); out.pendientes++; continue }
    try {
      const t = await tarjeta(s.tarjeta_id)
      if (!t || t.borrada) { await cerrar(s.id, 'descartado', 'la tarjeta ya no existe'); out.descartados++; continue }
      const x = s.datos
      if (x.op === 'crear') {
        if (t.clickup_id) { await cerrar(s.id, 'enviado'); out.enviados++; continue }
        let padre: string | null = null
        if (x.padre) { const p = await tarjeta(String(x.padre)); if (!p?.clickup_id) { await cerrar(s.id, 'pendiente', 'espera la tarea del cliente en ClickUp', 1); out.pendientes++; continue } padre = p.clickup_id }
        const marca = String(x.marca)
        let tarea = x.dudoso || s.intentos > 1 ? await d.api.buscarMarca(marca, ms(s.evento_fecha) - 10 * 60_000) : null
        if (!tarea) {
          const asignado = x.asignado ? idUsuarioClickUp(String(x.asignado), d.env) : null
          tarea = await d.api.crear({ nombre: t.nombre, estado: t.etapa, padre, descripcion: `Creada desde el Despacho. ${marca}`, prioridad: (x.prioridad as string | null) ?? null, asignados: asignado ? [asignado] : [], campos: t.campos })
          if (x.guion) await d.api.comentar(tarea.id, `Guion:\n${String(x.guion)}`).catch(() => {})
        }
        await eco(t.id, { etapa: t.etapa, ...t.campos }, { clickup_id: tarea.id, url: tarea.url, actualizado: tarea.actualizada })
        await cerrar(s.id, 'enviado'); out.enviados++; continue
      }
      if (!t.clickup_id) {
        if (t.origen === 'despacho') { await cerrar(s.id, 'pendiente', 'espera el alta de la tarea en ClickUp', 1); out.pendientes++ } else { await cerrar(s.id, 'descartado', 'la tarjeta no tiene tarea en ClickUp'); out.descartados++ }
        continue
      }
      if (x.op === 'comentario') { await d.api.comentar(t.clickup_id, String(x.comentario ?? '')); await cerrar(s.id, 'enviado'); out.enviados++; continue }
      const cu = await d.api.tarea(t.clickup_id)
      if (!cu) { await cerrar(s.id, 'descartado', 'la tarea ya no existe en ClickUp'); out.descartados++; continue }
      // Más reciente gana: si ClickUp cambió (una persona, no nuestro rebote) después de este cambio del Despacho, no se pisa.
      const posterior = ms(cu.actualizada) > ms(s.evento_fecha)
      if (x.op === 'estado') {
        const etapa = String(x.etapa), etapaCu = etapaDeClickUp(cu.estado)
        if (etapaCu === etapa) { await eco(t.id, { etapa }); await cerrar(s.id, 'enviado'); out.enviados++; continue }
        if (posterior && etapaCu !== (t.clickup_eco.etapa ?? null)) { await cerrar(s.id, 'descartado', `ClickUp la movió a «${cu.estado}» después: gana el cambio más reciente`); out.descartados++; continue }
        await d.api.estado(t.clickup_id, etapa)
        await eco(t.id, { etapa })
        if (x.comentario) await d.api.comentar(t.clickup_id, String(x.comentario)).catch(() => {})
      } else if (x.op === 'campos') {
        const campos = (x.campos ?? {}) as Partial<CamposTarjetaEdicion>
        for (const k of ['paleta', 'crudo', 'editado'] as const) {
          const v = String(campos[k] ?? ''), actualCu = cu.campos[k] ?? ''
          if (v === actualCu) continue
          if (posterior && actualCu !== (t.clickup_eco[k] ?? '')) continue
          await d.api.campo(t.clickup_id, k, v)
          await eco(t.id, { [k]: v })
        }
      }
      await cerrar(s.id, 'enviado'); out.enviados++
    } catch (e) {
      const m = motivo(e)
      out.errores.push(`${s.tarjeta_id}: ${m}`)
      if (s.datos.op === 'comentario' && !Number((e as { status?: number }).status)) { await cerrar(s.id, 'dudoso', m); out.dudosos++ }
      else if (transitorio(e) && s.intentos < 8) { await cerrar(s.id, 'pendiente', m, Math.min(60, 2 ** s.intentos)); out.pendientes++ }
      else { await cerrar(s.id, 'descartado', m); out.descartados++ }
    }
  }
  return out
}

/** Para la prueba en seco: lo que la outbox le escribiría a ClickUp (sin tocar nada). */
export async function pendientesClickUp(transaccion: DepsSync['transaccion']): Promise<{ tarjeta: string; op: string; detalle: string }[]> {
  return transaccion(async c => (await c.query("SELECT o.tarjeta_id,o.datos FROM cj_edicion_tarjetas_outbox o WHERE o.canal='clickup' AND o.estado='pendiente' ORDER BY o.disponible LIMIT 50")).rows.map(f => { const x = objeto<Record<string, unknown>>(f.datos, {}); return { tarjeta: String(f.tarjeta_id), op: String(x.op), detalle: x.op === 'estado' ? `→ ${x.etapa}` : x.op === 'crear' ? `alta «${x.nombre}» en ${x.etapa}` : x.op === 'campos' ? 'campos' : 'comentario' } }))
}
export const idEntradaWebhook = (cuerpo: string, x: { webhook_id?: unknown; history_items?: { id?: unknown }[] }) => `${String(x.webhook_id ?? 'wh')}:${String(x.history_items?.[0]?.id ?? createHash('sha256').update(cuerpo).digest('hex').slice(0, 24))}`
export const nuevoId = () => randomUUID()
