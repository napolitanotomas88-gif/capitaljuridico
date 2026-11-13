// ── Encuesta mensual de satisfacción SIN WhatsApp (4/11/2026): base, planilla y aviso diario. Solo servidor ──────────────
// Tablas (Neon, se crean solas como las otras cj_*):
//   · cj_encuesta_envios (id_crm, dia, por, creado): una fila por cliente y día en que Tomás marcó «encuesta enviada».
//   · cj_encuesta_asignaciones (clave, id_crm, por, creado): las respuestas «sin asignar» corregidas a mano (id_crm NULL = descartada).
// Respuestas: la planilla del Typeform (SHEET_ID_TYPEFORM, solo lectura), con la HORA de cada respuesta (respuestasDeFilas).
// El aviso sale a 🛠️-operaciones por lib/alertas (deduplicado por día). El recordatorio del día 1 va a 🛠️-operaciones y a la
// campanita de Tomás (deduplicado por mes y turno). Nunca se le escribe al cliente.
import { neon } from '@neondatabase/serverless'
import { respuestasDeFilas } from '@/lib/bot/exito/rondas'
import { alertar } from '@/lib/alertas'
import { clientesPrueba } from '@/lib/bot/clientesPrueba'
import { cargarVista } from '../vista'
import { esYmdValido, hoyArgentina, type Ymd } from '../fechas'
import type { Cliente } from '../tipos'
import { avisoPendientes, estadoEncuesta, ORIGEN_RECORDATORIO, trackerEncuesta, type TrackerEncuesta, recordatorioMensual, responsableDe, type AsignacionEncuesta, type EnvioEncuesta, type EstadoEncuesta, type TurnoRecordatorio } from './modelo'

const ID = /^[A-Za-z]\d{1,6}$/
const q = () => neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
const hayBase = () => !!process.env.DATABASE_URL?.trim()
let tablas: Promise<unknown> | null = null
function asegurarTablas(): Promise<unknown> {
  tablas ??= (async () => {
    const s = q()
    await s`CREATE TABLE IF NOT EXISTS cj_encuesta_envios (id_crm text NOT NULL, dia date NOT NULL, por text, creado timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id_crm, dia))`
    await s`CREATE TABLE IF NOT EXISTS cj_encuesta_asignaciones (clave text PRIMARY KEY, id_crm text, por text, creado timestamptz NOT NULL DEFAULT now())`
  })().catch((e) => { tablas = null; throw e })
  return tablas
}

export async function leerEnvios(): Promise<EnvioEncuesta[]> {
  if (!hayBase()) return []
  await asegurarTablas()
  const filas = (await q()`SELECT id_crm, to_char(dia, 'YYYY-MM-DD') AS dia, por FROM cj_encuesta_envios`) as Record<string, unknown>[]
  return filas.map((f) => ({ idCrm: String(f.id_crm), dia: String(f.dia), por: f.por ? String(f.por) : null }))
}

export async function leerAsignaciones(): Promise<AsignacionEncuesta[]> {
  if (!hayBase()) return []
  await asegurarTablas()
  const filas = (await q()`SELECT clave, id_crm FROM cj_encuesta_asignaciones`) as Record<string, unknown>[]
  return filas.map((f) => ({ clave: String(f.clave), idCrm: f.id_crm ? String(f.id_crm) : null }))
}

/** Marca la encuesta como enviada ese día a esos clientes. Devuelve cuántas marcas nuevas quedaron (repetir no duplica). */
export async function marcarEnviada(ids: readonly string[], dia: Ymd, por: string): Promise<number> {
  const validos = [...new Set(ids.map((x) => x.trim().toUpperCase()).filter((x) => ID.test(x)))]
  if (!esYmdValido(dia)) throw new Error('Fecha inválida')
  if (!validos.length) return 0
  await asegurarTablas()
  const r = (await q()`INSERT INTO cj_encuesta_envios (id_crm, dia, por) SELECT x, ${dia}::date, ${por.slice(0, 120)} FROM unnest(${validos}::text[]) AS x
    ON CONFLICT (id_crm, dia) DO NOTHING RETURNING id_crm`) as unknown[]
  return r.length
}

/** Saca la marca de un cliente (se marcó por error o ya no corresponde). */
export async function quitarEnvio(idCrm: string, dia: Ymd): Promise<boolean> {
  if (!ID.test(idCrm) || !esYmdValido(dia)) throw new Error('Datos inválidos')
  await asegurarTablas()
  const r = (await q()`DELETE FROM cj_encuesta_envios WHERE id_crm = ${idCrm.toUpperCase()} AND dia = ${dia}::date RETURNING id_crm`) as unknown[]
  return r.length > 0
}

/** Asigna una respuesta a un cliente (idCrm) o la descarta (null). La última corrección manda. */
export async function asignarRespuesta(clave: string, idCrm: string | null, por: string): Promise<void> {
  if (!clave || clave.length > 200) throw new Error('Respuesta inválida')
  if (idCrm !== null && !ID.test(idCrm)) throw new Error('ID inválido')
  await asegurarTablas()
  const id = idCrm?.toUpperCase() ?? null
  await q()`INSERT INTO cj_encuesta_asignaciones (clave, id_crm, por) VALUES (${clave}, ${id}, ${por.slice(0, 120)})
    ON CONFLICT (clave) DO UPDATE SET id_crm = EXCLUDED.id_crm, por = EXCLUDED.por, creado = now()`
}

async function filasTypeform(): Promise<unknown[][] | null> {
  const id = process.env.SHEET_ID_TYPEFORM?.trim()
  const { googleConfigurado, googleJson, sheetsBase } = await import('@/lib/auth/googleRest')
  if (!id || !googleConfigurado()) return null
  const r = await googleJson<{ values?: unknown[][] }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent('A1:Z5000')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)
  return r.values ?? []
}

export interface ClienteParaMarcar { id: string; nombre: string; linea: string; responsable: string; ultimoEnvio: Ymd | null }
export interface DatosEncuesta {
  estado: EstadoEncuesta
  /** Una fila por cliente activo y una columna por mes (desde octubre de 2026). */
  tracker: TrackerEncuesta
  /** Clientes ACTIVOS con ID (los de prueba no), para marcar el envío. */
  activos: ClienteParaMarcar[]
  hoy: Ymd
  /** null = todo leído; texto = qué no se pudo leer (la pantalla lo avisa). */
  aviso: string | null
  crmViejo: boolean
}

/** Todo lo de la encuesta: envíos, respuestas cruzadas con el CRM y correcciones a mano. */
export async function cargarEncuesta(op: { ahora?: Date } = {}): Promise<DatosEncuesta> {
  const hoy = hoyArgentina(op.ahora)
  const [{ datos }, envios, asignaciones, filas] = await Promise.all([
    cargarVista(false, 'omitir', true), leerEnvios(), leerAsignaciones(), filasTypeform().catch(() => null),
  ])
  const prueba = clientesPrueba()
  const conId = datos.clientes.filter((c: Cliente) => c.id && !prueba.has(c.id.toUpperCase()))
  const enviados = new Set(envios.map((e) => e.idCrm.toUpperCase()))
  // El cruce por nombre se hace contra los que pueden estar contestando: activos, pausados y los que tienen envío marcado
  // (con todos los finalizados aparecen tocayos y el cruce, que nunca adivina, mandaría más respuestas a «sin asignar»).
  const paraCruce = conId.filter((c) => c.estado === 'ACTIVO' || c.estado === 'PAUSADO' || enviados.has(c.id.toUpperCase()))
  const respuestas = filas ? respuestasDeFilas(filas, paraCruce.map((c) => ({ id: c.id, nombre: c.nombre, mail: c.mail, celular: c.celular }))) : []
  const clientes = conId.map((c) => ({ id: c.id, nombre: c.nombre, estado: c.estado, responsable: responsableDe(c) }))
  const estado = estadoEncuesta({ envios, respuestas, asignaciones, hoy, clientes })
  const tracker = trackerEncuesta({ envios, respuestas, asignaciones, hoy, clientes })
  const ultimo = new Map<string, Ymd>()
  for (const e of envios) { const k = e.idCrm.toUpperCase(); if (!ultimo.has(k) || e.dia > ultimo.get(k)!) ultimo.set(k, e.dia) }
  const activos = conId.filter((c) => c.estado === 'ACTIVO')
    .map((c) => ({ id: c.id.toUpperCase(), nombre: c.nombre, linea: c.linea, responsable: responsableDe(c), ultimoEnvio: ultimo.get(c.id.toUpperCase()) ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }))
  return {
    estado, tracker, activos, hoy, crmViejo: datos.fuente === 'snapshot_viejo',
    aviso: filas === null ? 'No se pudo leer la planilla del Typeform: las respuestas pueden estar incompletas.' : null,
  }
}

/** El cron diario: publica en 🛠️-operaciones la lista de los que no contestaron (desde el día 3). `dry`: no manda nada. */
export async function avisarEncuesta(op: { dry?: boolean; ahora?: Date } = {}): Promise<{ pendientes: number; contestaron: number; total: number; mensajes: string[]; estados: string[] }> {
  const d = await cargarEncuesta(op)
  // Un CRM viejo (Sheets caído) puede listar como pendiente a alguien que ya se dio de baja: mejor no avisar ese día
  if (d.crmViejo) throw new Error('No se pudo leer el CRM al día')
  if (d.aviso) throw new Error('No se pudo leer la planilla del Typeform')
  const a = avisoPendientes(d.estado)
  const base = { pendientes: 0, contestaron: d.estado.contestaron.length, total: d.estado.total, mensajes: [] as string[], estados: [] as string[] }
  if (!a) return base
  const partes = a.bloques.map((bloque, i) => ({
    canal: 'operaciones' as const, tipo: 'encuesta_pendientes', clave: `encuesta:pendientes:${d.hoy}:${i + 1}`, emoji: '📋',
    titulo: a.bloques.length > 1 ? `${a.titulo} (${i + 1} de ${a.bloques.length})` : a.titulo,
    lineas: i === 0 ? a.lineas : [], copiar: bloque, link: '/clientes/encuesta',
  }))
  const estados: string[] = []
  if (!op.dry) for (const p of partes) estados.push((await alertar(p)).estado)
  return { ...base, pendientes: a.bloques.join('\n').split('\n').length, mensajes: partes.map((p) => [p.titulo, ...p.lineas, p.copiar].join('\n')), estados }
}

/**
 * Recordatorio del día 1 (9:30 y, si no se marcó la ronda del mes, 18:00): mensaje en 🛠️-operaciones con mención a Tomás y
 * campanita del Despacho para él (por mail; sin mail configurado, a la sección Clientes). Fuera del día 1 no hace nada.
 */
export async function recordarEncuesta(op: { turno: TurnoRecordatorio; dry?: boolean; ahora?: Date }): Promise<{ hoy: Ymd; recordatorio: string | null; estado: string | null; campanita: number }> {
  const hoy = hoyArgentina(op.ahora)
  // Sin base no se puede saber si la ronda ya se marcó: la tarde no avisa a ciegas
  if (op.turno === 'tarde' && !hayBase()) throw new Error('Base no configurada')
  const r = recordatorioMensual(op.turno, hoy, op.turno === 'tarde' ? await leerEnvios() : [])
  if (!r) return { hoy, recordatorio: null, estado: null, campanita: 0 }
  if (op.dry) return { hoy, recordatorio: `${r.titulo}\n${r.texto}`, estado: 'seco', campanita: 0 }
  const { estado } = await alertar({ canal: 'operaciones', tipo: 'encuesta_recordatorio', clave: r.clave, emoji: '📋', titulo: r.titulo, lineas: [r.texto], link: '/clientes/encuesta', menciones: ['tomas'], urgente: r.urgente })
  const { destinatariosBandeja } = await import('@/lib/bot/proyeccion/bandeja')
  const { crearNotificacion } = await import('@/lib/notificaciones/registro')
  const tomas = destinatariosBandeja().filter((d) => d.nombre === 'Tomás')
  const base = { tipo: 'encuesta_recordatorio', titulo: r.titulo, cuerpo: r.texto, url: '/clientes/encuesta', urgente: r.urgente, origen: ORIGEN_RECORDATORIO }
  const notas = tomas.length
    ? tomas.map((d, i) => ({ ...base, paraEmail: d.email, clave: `${r.clave}:${i + 1}` }))
    : [{ ...base, paraSeccion: 'clientes' as const, clave: r.clave }]
  let campanita = 0
  for (const n of notas) if (await crearNotificacion(n)) campanita++
  return { hoy, recordatorio: r.titulo, estado, campanita }
}

/** Al marcar la ronda del mes, el recordatorio de la campanita queda resuelto. */
export async function cerrarRecordatorio(dia: Ymd, por: string): Promise<void> {
  const { cerrarNotificacionesPorPatron } = await import('@/lib/notificaciones/registro')
  await cerrarNotificacionesPorPatron(ORIGEN_RECORDATORIO, `${ORIGEN_RECORDATORIO}:${dia.slice(0, 7)}:%`, por).catch(() => 0)
}
