// ── Salida única de WhatsApp de la bandeja: dependencias reales (Neon, Whapi con guardia de salud, CRM). SOLO servidor ───
// La lógica está en despacho.ts (con tests) y las reglas en modelo.ts. Acá:
//   · cj_notif_whatsapp: el registro de cada aviso (pendiente → enviando → enviado | dudoso | omitido | error), con el
//     motivo, el grupo, el modo y el id del mensaje. Se crea sola (idempotente) como las otras cj_*.
//   · Turno: candado en cj_altas_recursos (fila 'notif_wa_turno'): 5 min entre mensajes y NOTIF_WHATSAPP_MAX_DIA por día,
//     compartido entre instancias de Vercel (el mismo patrón que 'anuncios_wa_equipo').
//   · Whapi: crearClienteWhapi (cliente.ts) trae la guardia de salud (/health en AUTH antes de cada escritura); además se
//     mira /health antes de pedir turno, para no gastar un turno con el número caído.
//   · Vigencia (regla de Tomás): se relee el estado de origen de cada aviso justo antes de mandarlo.
// Nunca se loguea el token, un teléfono ni la URL de la base.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { SECCIONES, type Seccion } from '../../auth/roles'
import { crearClienteWhapi } from '../../bot/whapi/cliente'
import { tokenWhapi } from '../../bot/whapi/config'
import { guardiaWhapi } from '../../bot/whapi/salud'
import { ClienteArchivadoError, exigirClienteNoArchivado, leerArchivados } from '../../clientes/archivados'
import { leerTarjeta } from '../../edicion/tarjetasDb'
import { urlDespacho } from '../../edicion/avisos/entorno'
import { reconciliarNotificaciones } from '../reconciliar'
import { despacharNotifWhatsapp, type DepsDespacho, type FilaPendiente, type ResultadoDespacho, type Vigencia } from './despacho'
import { ESPACIO_MIN_MS, GRUPOS_EQUIPO, chatGrupo, chatPrueba, maxPorDia, modoNotifWa, parsearRecon, sinRespuestaVigente, type Destino, type GrupoEquipo } from './modelo'

export const RECURSO_TURNO = 'notif_wa_turno'
type Fila = Record<string, unknown>
type Q = NeonQueryFunction<false, false>

const url = () => process.env.DATABASE_URL?.trim() || ''
const conexion = (ms = 8_000): Q => neon(url(), { fetchOptions: { signal: AbortSignal.timeout(ms) } })
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01'
const iso = (x: unknown): string | null => (x instanceof Date ? x.toISOString() : x ? String(x) : null)

let tablaLista = false
export async function asegurarTablaNotifWa(q: Q = conexion(10_000)): Promise<void> {
  if (tablaLista) return
  await q`CREATE TABLE IF NOT EXISTS cj_notif_whatsapp (
    id bigserial PRIMARY KEY, clave text NOT NULL UNIQUE, notificacion_id bigint NOT NULL, tipo text NOT NULL, grupo text,
    destino jsonb, estado text NOT NULL, motivo text, modo text, lote text, mensaje_id text,
    creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now(), enviado_en timestamptz)`
  await q`CREATE INDEX IF NOT EXISTS cj_notif_whatsapp_estado ON cj_notif_whatsapp (estado, creado)`
  await q`CREATE INDEX IF NOT EXISTS cj_notif_whatsapp_notif ON cj_notif_whatsapp (notificacion_id)`
  tablaLista = true
}

async function reclamarTurnoNeon(env: Record<string, string | undefined>): Promise<boolean> {
  if (!url()) return false   // sin base no hay cómo espaciar entre instancias: no se manda
  const q = conexion()
  const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const segundos = Math.round(ESPACIO_MIN_MS / 1000), max = maxPorDia(env)
  await q`CREATE TABLE IF NOT EXISTS cj_altas_recursos (nombre text PRIMARY KEY, dueno text, hasta timestamptz, datos jsonb)`
  const r = await q`INSERT INTO cj_altas_recursos (nombre, dueno, hasta, datos)
    VALUES (${RECURSO_TURNO}, 'notificaciones', now() + make_interval(secs => ${segundos}), jsonb_build_object('dia', ${dia}::text, 'n', 1))
    ON CONFLICT (nombre) DO UPDATE SET dueno = EXCLUDED.dueno, hasta = EXCLUDED.hasta,
      datos = CASE WHEN cj_altas_recursos.datos->>'dia' = ${dia} THEN jsonb_build_object('dia', ${dia}::text, 'n', (cj_altas_recursos.datos->>'n')::int + 1) ELSE EXCLUDED.datos END
    WHERE (cj_altas_recursos.hasta IS NULL OR cj_altas_recursos.hasta < now())
      AND (cj_altas_recursos.datos->>'dia' IS DISTINCT FROM ${dia} OR coalesce((cj_altas_recursos.datos->>'n')::int, 0) < ${max})
    RETURNING nombre`
  return r.length > 0
}

/** El id del CRM que trae la ruta del aviso (/clientes/A123, /guiones/A123, ?cliente=A123). */
export const idCrmDeUrl = (u: string | null): string | null =>
  u?.match(/(?:\/clientes\/|\/guiones\/|[?&]cliente=)([A-Za-z]\d{1,6})(?:[/?&#]|$)/)?.[1]?.toUpperCase() ?? null
const tarjetaDeUrl = (u: string | null): string | null => {
  const m = u?.match(/[?&]tarjeta=([^&#]+)/)?.[1]
  try { return m ? decodeURIComponent(m) : null } catch { return null }
}
/** Etapas de la tarjeta en las que el aviso de Edición sigue teniendo sentido (lib/edicion/tarjetas.ts). */
export function etapasVigentesEdicion(tipo: string, titulo: string): readonly string[] {
  if (tipo === 'edicion_entrega_revisar') return ['revisión']
  if (/para editar|corregir/i.test(titulo)) return ['para editar', 'editando']
  if (/OK del cliente/i.test(titulo)) return ['publicado']
  return ['editado', 'corregido', 'revisión']
}

/** Regla de Tomás: el estado que originó el aviso sigue siendo real. */
async function vigenciaReal(f: FilaPendiente, q: Q, archivados: () => Promise<ReadonlySet<string>>): Promise<Vigencia> {
  let idCrm = idCrmDeUrl(f.url)
  let detalle: string | null = null
  // El CRM se lee ANTES y fuera de cualquier try: si no se puede leer, tira y la corrida entera se corta sin omitir nada
  // (antes un CRM caído se tomaba como «el cliente no figura» y el aviso se perdía para siempre).
  const set = await archivados()
  const recon = parsearRecon(f.clave)
  if (f.clave?.startsWith('recon:') && !recon) return { ok: false, motivo: 'no se pudo leer la clave del aviso: no se verifica, no sale' }
  if (recon) {
    const { fuente, id, estado } = recon
    const n = Number(id)
    const filas = (fuente === 'guiones' && Number.isSafeInteger(n) ? await q`SELECT estado, id_crm FROM cj_guiones WHERE id = ${n}`
      : fuente === 'kickoff' && Number.isSafeInteger(n) ? await q`SELECT estado, id_crm FROM cj_kickoffs WHERE recording_id = ${n}`
      : fuente === 'edicion' && Number.isSafeInteger(n) ? await q`SELECT CASE WHEN bloqueo IS NOT NULL THEN 'bloqueado' ELSE estado END AS estado, id_crm FROM cj_videos WHERE id = ${n}`
      : fuente === 'exito' && Number.isSafeInteger(n) ? await q`SELECT estado, id_crm FROM cj_exito_pedidos WHERE id = ${n}`
      : fuente === 'bajas' && Number.isSafeInteger(n) ? await q`SELECT estado, id_crm FROM cj_bajas_pedidos WHERE id = ${n}`
      : fuente === 'anuncios' ? await q`SELECT estado, NULL AS id_crm FROM cj_anuncios_avisos WHERE clave = ${id}`
      : null) as Fila[] | null
    if (!filas) return { ok: false, motivo: 'no se pudo releer el estado de origen' }
    if (!filas.length) return { ok: false, motivo: 'el caso ya no existe' }
    if (String(filas[0].estado) !== estado) return { ok: false, motivo: `el estado cambió (ahora: ${String(filas[0].estado).replaceAll('_', ' ')})` }
    if (filas[0].id_crm) idCrm = String(filas[0].id_crm).toUpperCase()
  } else if (f.tipo === 'edicion_tarjetas' || f.tipo === 'edicion_entrega_revisar') {
    const id = tarjetaDeUrl(f.url)
    const t = id ? await leerTarjeta(id) : null
    if (!t) return { ok: false, motivo: 'la tarjeta de Edición ya no existe' }
    if (t.motor_bloqueado) return { ok: false, motivo: 'la tarjeta está bloqueada' }
    const etapas = etapasVigentesEdicion(f.tipo, f.titulo)
    if (!etapas.includes(t.etapa)) return { ok: false, motivo: `la tarjeta ya está en «${t.etapa}»` }
    idCrm = t.id_crm ? t.id_crm.toUpperCase() : idCrm
    detalle = t.nombre
  } else if (f.tipo === 'guiones_entrega') {
    const tanda = Number(f.clave?.match(/^guiones-entrega:(\d+):/)?.[1])
    if (!Number.isSafeInteger(tanda)) return { ok: false, motivo: 'no se pudo identificar la tanda' }
    const g = (await q`SELECT estado, id_crm, aprobacion FROM cj_guiones WHERE id = ${tanda}`) as Fila[]
    if (!g.length) return { ok: false, motivo: 'la tanda ya no existe' }
    if (g[0].estado !== 'aprobada') return { ok: false, motivo: `la tanda ya está «${String(g[0].estado)}»` }
    idCrm = g[0].id_crm ? String(g[0].id_crm).toUpperCase() : idCrm
    const cuando = (g[0].aprobacion as { cuando?: string } | null)?.cuando
    // La clave es guiones-entrega:<tanda>:<aprobación>:<mail>: si la tanda se volvió a aprobar, el aviso es de otra aprobación
    if (!cuando || !f.clave?.startsWith(`guiones-entrega:${tanda}:${cuando}:`)) return { ok: false, motivo: 'la tanda se volvió a aprobar: el aviso es viejo' }
    if ((g[0].doc as { entrega?: unknown } | null)?.entrega) return { ok: false, motivo: 'la tanda ya se entregó' }
    if (!idCrm) return { ok: false, motivo: 'la tanda no tiene cliente del CRM' }
    // Una tanda más nueva del mismo cliente: esta se resolvió fuera del bot
    const nuevas = (await q`SELECT count(*)::int AS n FROM cj_guiones WHERE upper(id_crm) = ${idCrm} AND id <> ${tanda} AND creado > ${cuando}::timestamptz`) as Fila[]
    if (Number(nuevas[0]?.n) > 0) return { ok: false, motivo: 'el cliente ya tiene una tanda más nueva' }
    // Si el cliente ya grabó después de la aprobación, la entrega se resolvió fuera del bot
    if (idCrm && cuando) {
      const v = (await q`SELECT count(*)::int AS n FROM cj_videos WHERE upper(id_crm) = ${idCrm} AND creado > ${cuando}::timestamptz`) as Fila[]
      if (Number(v[0]?.n) > 0) return { ok: false, motivo: 'el cliente ya grabó después de la aprobación' }
    }
  } else if (f.tipo === 'cliente_sin_respuesta') {
    if (!idCrm) return { ok: false, motivo: 'no se pudo identificar al cliente' }
    let c: Fila[] = []
    try { c = (await q`SELECT ultimo_cliente, ultimo_equipo FROM cj_inactivos_contactos WHERE upper(id_crm) = ${idCrm}`) as Fila[] } catch (e) { if (!faltaTabla(e)) throw e }
    const v = sinRespuestaVigente(f.clave, c.length ? { ultimoCliente: iso(c[0].ultimo_cliente), ultimoEquipo: iso(c[0].ultimo_equipo) } : null)
    if (!v.ok) return v
  } else if (f.tipo !== 'beneficio_referido') {
    // Falla cerrado: un tipo sin forma de releer su estado no sale (beneficio_referido se cierra solo en la bandeja: hecha_en)
    return { ok: false, motivo: 'no hay cómo verificar que la etapa siga siendo real' }
  }
  if (idCrm) {
    try { await exigirClienteNoArchivado(idCrm, set) } catch (e) {
      return { ok: false, motivo: e instanceof ClienteArchivadoError ? 'el cliente está archivado' : 'el cliente no figura en el CRM actual' }
    }
  }
  return { ok: true, detalle }
}

const aDestino = (x: unknown, grupo: GrupoEquipo): Destino => {
  const o = (typeof x === 'string' ? JSON.parse(x) : x) as Partial<Destino> | null
  return { grupo, roles: Array.isArray(o?.roles) ? o!.roles : [], persona: typeof o?.persona === 'string' ? o.persona : null }
}

export function depsReales(env: Record<string, string | undefined> = process.env): DepsDespacho {
  const q = conexion()
  let arch: Promise<ReadonlySet<string>> | null = null
  const archivados = () => (arch ??= leerArchivados({ forzar: true }))   // una lectura fresca del CRM por corrida
  return {
    env,
    ahora: Date.now,
    base: urlDespacho(env),
    async reconciliar() { await reconciliarNotificaciones(SECCIONES as readonly Seccion[], await archivados()) },
    async candidatas(desde) {
      await asegurarTablaNotifWa()
      try {
        const filas = (await q`SELECT n.id, n.clave, n.tipo, n.para_email, n.para_seccion FROM cj_notificaciones n
          WHERE n.creada_en >= ${desde}::timestamptz AND n.hecha_en IS NULL
            AND NOT EXISTS (SELECT 1 FROM cj_notif_whatsapp w WHERE w.notificacion_id = n.id)
          ORDER BY n.id LIMIT 200`) as Fila[]
        return filas.map(f => ({ id: Number(f.id), clave: f.clave ? String(f.clave) : null, tipo: String(f.tipo), paraEmail: f.para_email ? String(f.para_email) : null, paraSeccion: f.para_seccion ? (String(f.para_seccion) as Seccion) : null }))
      } catch (e) { if (faltaTabla(e)) return []; throw e }
    },
    async insertar(filas) {
      await q`INSERT INTO cj_notif_whatsapp (clave, notificacion_id, tipo, grupo, destino, estado, motivo)
        SELECT c, i, t, g, d::jsonb, e, m FROM unnest(${filas.map(f => f.clave)}::text[], ${filas.map(f => f.notificacionId)}::bigint[],
          ${filas.map(f => f.tipo)}::text[], ${filas.map(f => f.grupo)}::text[], ${filas.map(f => (f.destino ? JSON.stringify(f.destino) : null))}::text[],
          ${filas.map(f => f.estado)}::text[], ${filas.map(f => f.motivo)}::text[]) AS x(c, i, t, g, d, e, m)
        ON CONFLICT (clave) DO NOTHING`
    },
    async vencerEnviando(antes) {
      const r = await q`UPDATE cj_notif_whatsapp SET estado = 'dudoso', motivo = 'quedó «enviando» más de 10 min: puede haber salido; revisar el grupo', actualizado = now()
        WHERE estado = 'enviando' AND actualizado < ${antes}::timestamptz RETURNING id`
      return r.length
    },
    async pendientes() {
      const filas = (await q`SELECT w.id, w.notificacion_id, w.tipo, w.grupo, w.destino, n.creada_en, n.hecha_en, n.titulo, n.url, n.clave
        FROM cj_notif_whatsapp w JOIN cj_notificaciones n ON n.id = w.notificacion_id
        WHERE w.estado = 'pendiente' ORDER BY n.creada_en LIMIT 100`) as Fila[]
      return filas.filter(f => (GRUPOS_EQUIPO as readonly string[]).includes(String(f.grupo))).map(f => {
        const grupo = String(f.grupo) as GrupoEquipo
        return {
          id: Number(f.id), notificacionId: Number(f.notificacion_id), tipo: String(f.tipo), grupo, destino: aDestino(f.destino, grupo),
          creadaEn: iso(f.creada_en) ?? '', hechaEn: iso(f.hecha_en), titulo: String(f.titulo ?? ''), url: f.url ? String(f.url) : null, clave: f.clave ? String(f.clave) : null,
        }
      })
    },
    vigencia: (f) => vigenciaReal(f, q, archivados),
    async omitir(id, motivo) {
      await q`UPDATE cj_notif_whatsapp SET estado = 'omitido', motivo = ${motivo.slice(0, 300)}, actualizado = now() WHERE id = ${id} AND estado = 'pendiente'`
    },
    async salud() {
      const token = tokenWhapi()
      if (!token) return { ok: false, motivo: 'falta WHAPI_TOKEN' }
      try {
        await guardiaWhapi().antesDeEscribir({ token, fetch: (a, b) => globalThis.fetch(a, b), ahora: Date.now })
        return { ok: true, motivo: 'conectado' }
      } catch (e) { return { ok: false, motivo: String((e as Error)?.message ?? e).slice(0, 200) } }
    },
    reclamarTurno: () => reclamarTurnoNeon(env),
    async reclamar(ids, lote, modo) {
      const r = (await q`UPDATE cj_notif_whatsapp SET estado = 'enviando', lote = ${lote}, modo = ${modo}, actualizado = now()
        WHERE id = ANY(${ids}::bigint[]) AND estado = 'pendiente' RETURNING id`) as Fila[]
      return r.map(f => Number(f.id))
    },
    async enviar(chatId, texto, menciones) {
      const token = tokenWhapi()
      if (!token) throw Object.assign(new Error('falta WHAPI_TOKEN'), { aplicado: false, tipo: 'config' })
      return (await crearClienteWhapi({ token }).enviarTexto({ chatId, texto, menciones })).id ?? null
    },
    async cerrar(ids, estado, motivo, mensajeId) {
      await q`UPDATE cj_notif_whatsapp SET estado = ${estado}, motivo = ${motivo}, mensaje_id = ${mensajeId},
        enviado_en = CASE WHEN ${estado} = 'enviado' THEN now() ELSE enviado_en END, actualizado = now()
        WHERE id = ANY(${ids}::bigint[]) AND estado = 'enviando'`
    },
  }
}

/** Lo que llaman el vigía y la ruta. Apagado (NOTIF_WHATSAPP sin valor) no toca nada. Nunca tira. */
export async function despacharNotifWhatsappReal(env: Record<string, string | undefined> = process.env): Promise<ResultadoDespacho> {
  if (modoNotifWa(env) === 'apagado') return { estado: 'apagado', modo: 'apagado', encolados: 0, omitidos: 0, vencidos: 0 }
  if (!url()) return { estado: 'error', modo: modoNotifWa(env), encolados: 0, omitidos: 0, vencidos: 0, motivo: 'falta DATABASE_URL' }
  const r = await despacharNotifWhatsapp(depsReales(env))
  if (!['apagado', 'nada', 'fuera_de_horario', 'esperando_ventana'].includes(r.estado)) console.log(`notif-whatsapp: ${r.estado}${r.grupo ? ` (${r.grupo}, ${r.avisos ?? 0} avisos)` : ''}${r.motivo ? ` — ${r.motivo}` : ''}`)
  return r
}

/** Para el GET de estado: variables (sí/no, nunca el valor), cuentas por estado y los últimos registros (sin teléfonos). */
export async function estadoNotifWhatsapp(env: Record<string, string | undefined> = process.env): Promise<Record<string, unknown>> {
  const variables = {
    NOTIF_WHATSAPP: modoNotifWa(env), NOTIF_WHATSAPP_PRUEBA_CHAT: !!chatPrueba(env), NOTIF_WHATSAPP_MAX_DIA: maxPorDia(env),
    NOTIF_PERSONAS_JSON: !!env.NOTIF_PERSONAS_JSON?.trim(), WHAPI_TOKEN: !!tokenWhapi(env as NodeJS.ProcessEnv), DATABASE_URL: !!url(),
    ...Object.fromEntries(GRUPOS_EQUIPO.map(g => [`WHAPI_GRUPO_${g}`, !!chatGrupo(g, env)])),
  }
  if (!url()) return { variables }
  try {
    const q = conexion()
    const cuentas = (await q`SELECT estado, count(*)::int AS n FROM cj_notif_whatsapp WHERE creado > now() - interval '7 days' GROUP BY estado`) as Fila[]
    const ultimos = (await q`SELECT id, notificacion_id, tipo, grupo, estado, motivo, modo, creado, enviado_en FROM cj_notif_whatsapp ORDER BY id DESC LIMIT 30`) as Fila[]
    return { variables, cuentas: Object.fromEntries(cuentas.map(c => [String(c.estado), Number(c.n)])), ultimos }
  } catch (e) {
    if (faltaTabla(e)) return { variables, cuentas: {}, ultimos: [] }
    throw e
  }
}
