// ── Controles de cumplimiento: tablas en Neon (migración idempotente). Solo servidor ──────────────────────────────────────
//   · cj_controles_cliente: la configuración de cada cliente con garantía (id_crm PK, cuenta publicitaria, presupuesto
//     diario en USD, carpetas de Drive, desde, plazos y cláusulas). Se carga con POST /api/clientes/controles (Bearer
//     CRON_SECRET): los datos del cliente nunca van al repo.
//   · cj_controles_incumplimientos: una fila por incumplimiento o posible incumplimiento (clave UNIQUE: nunca dos veces).
//     estado: 'aviso' (automático, con su «para enviar») | 'a_verificar' (sin aviso hasta «Es incumplimiento») |
//     'confirmado' (alguien lo confirmó: ya tiene su «para enviar») | 'descartado' («No corresponde», con motivo). El id del
//     mensaje «para enviar» (cj_canal_mensajes, pieza j01) guarda «Enviado», quién y cuándo.
// Todas las sentencias son CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS: correrlas dos veces no cambia nada.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { asegurarTablaCanal, insertarMensaje, baseCanalLista } from '@/lib/bot/canal/registro'
import { normalizarConfig, type ConfigControles, type Incumplimiento, type TipoIncumplimiento, type Ymd } from './reglas'

type Q = NeonQueryFunction<false, false>
type Fila = Record<string, unknown>
const url = () => process.env.DATABASE_URL?.trim() || ''
export const baseControlesLista = (): boolean => !!url()
const q = (): Q => neon(url(), { fetchOptions: { signal: AbortSignal.timeout(10_000) } })

export const SENTENCIAS_CONTROLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cj_controles_cliente (
    id_crm text PRIMARY KEY, cliente text NOT NULL, activo boolean NOT NULL DEFAULT true, cuenta_meta text,
    presupuesto_diario_usd numeric NOT NULL DEFAULT 12, carpeta_cliente text, carpeta_capturas text, desde date NOT NULL DEFAULT CURRENT_DATE,
    plazos jsonb NOT NULL DEFAULT '{}'::jsonb, clausulas jsonb NOT NULL DEFAULT '{}'::jsonb,
    creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now(), actualizado_por text)`,
  `CREATE TABLE IF NOT EXISTS cj_controles_incumplimientos (
    id bigserial PRIMARY KEY, clave text NOT NULL UNIQUE, id_crm text NOT NULL, tipo text NOT NULL, fecha date NOT NULL,
    clausula text, falta text NOT NULL, lineas jsonb NOT NULL DEFAULT '[]'::jsonb, texto text NOT NULL, mensaje_id bigint,
    alerta text, estado text NOT NULL DEFAULT 'aviso', resuelto_por text, resuelto_cuando timestamptz, motivo text,
    creado timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE cj_controles_incumplimientos ADD COLUMN IF NOT EXISTS alerta text`,
  `ALTER TABLE cj_controles_incumplimientos ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'aviso'`,
  `ALTER TABLE cj_controles_incumplimientos ADD COLUMN IF NOT EXISTS resuelto_por text`,
  `ALTER TABLE cj_controles_incumplimientos ADD COLUMN IF NOT EXISTS resuelto_cuando timestamptz`,
  `ALTER TABLE cj_controles_incumplimientos ADD COLUMN IF NOT EXISTS motivo text`,
  `CREATE INDEX IF NOT EXISTS cj_controles_incumplimientos_cliente ON cj_controles_incumplimientos (id_crm, fecha)`,
]

let lista = false
export async function asegurarTablasControles(c: Q = q()): Promise<void> {
  if (lista) return
  for (const s of SENTENCIAS_CONTROLES) await c.query(s)
  lista = true
}

const ymd = (x: unknown): string => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x ?? '').slice(0, 10))
const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : x ? String(x) : null)

export function configDeFila(f: Fila, hoy: Ymd): ConfigControles | null {
  const r = normalizarConfig({
    idCrm: f.id_crm, cliente: f.cliente, activo: f.activo, cuentaMeta: f.cuenta_meta, presupuestoDiarioUsd: Number(f.presupuesto_diario_usd),
    carpetaCliente: f.carpeta_cliente, carpetaCapturas: f.carpeta_capturas, desde: ymd(f.desde), plazos: f.plazos, clausulas: f.clausulas,
  }, hoy)
  return r.ok ? r.config : null
}

export async function leerConfigs(hoy: Ymd, soloActivos = true): Promise<ConfigControles[]> {
  if (!url()) return []
  const c = q()
  await asegurarTablasControles(c)
  const filas = (soloActivos
    ? await c`SELECT * FROM cj_controles_cliente WHERE activo ORDER BY id_crm`
    : await c`SELECT * FROM cj_controles_cliente ORDER BY id_crm`) as Fila[]
  return filas.map((f) => configDeFila(f, hoy)).filter((x): x is ConfigControles => !!x)
}

export async function guardarConfig(k: ConfigControles, por: string): Promise<void> {
  const c = q()
  await asegurarTablasControles(c)
  await c`INSERT INTO cj_controles_cliente (id_crm, cliente, activo, cuenta_meta, presupuesto_diario_usd, carpeta_cliente, carpeta_capturas, desde, plazos, clausulas, actualizado_por)
    VALUES (${k.idCrm}, ${k.cliente}, ${k.activo}, ${k.cuentaMeta}, ${k.presupuestoDiarioUsd}, ${k.carpetaCliente}, ${k.carpetaCapturas}, ${k.desde}::date,
      ${JSON.stringify(k.plazos)}::jsonb, ${JSON.stringify(k.clausulas)}::jsonb, ${por.slice(0, 120)})
    ON CONFLICT (id_crm) DO UPDATE SET cliente = EXCLUDED.cliente, activo = EXCLUDED.activo, cuenta_meta = EXCLUDED.cuenta_meta,
      presupuesto_diario_usd = EXCLUDED.presupuesto_diario_usd, carpeta_cliente = EXCLUDED.carpeta_cliente,
      carpeta_capturas = COALESCE(EXCLUDED.carpeta_capturas, cj_controles_cliente.carpeta_capturas), desde = EXCLUDED.desde,
      plazos = EXCLUDED.plazos, clausulas = EXCLUDED.clausulas, actualizado = now(), actualizado_por = EXCLUDED.actualizado_por`
}

export async function guardarCarpetaCapturas(idCrm: string, id: string): Promise<void> {
  await q()`UPDATE cj_controles_cliente SET carpeta_capturas = ${id}, actualizado = now() WHERE id_crm = ${idCrm} AND carpeta_capturas IS NULL`
}

/** La carpeta del cliente vinculada en Grabación (cj_grab_carpetas tipo 'cliente'). null si no hay o no hay tabla. */
export async function carpetaClienteVinculada(idCrm: string): Promise<string | null> {
  try {
    const r = (await q()`SELECT drive_id FROM cj_grab_carpetas WHERE upper(id_crm) = ${idCrm} AND tipo = 'cliente' AND borrada IS NULL ORDER BY visto DESC LIMIT 1`) as Fila[]
    return r.length ? String(r[0].drive_id) : null
  } catch { return null }
}

/** Crudos del cliente creados en Drive desde una fecha (cj_grab_archivos, lo registra el vigía de Grabación). */
export async function crudosDesde(idCrm: string, desdeIso: string): Promise<{ creado: string }[]> {
  try {
    const r = (await q()`SELECT COALESCE(creado_drive, creado) AS creado FROM cj_grab_archivos
      WHERE upper(id_crm) = ${idCrm} AND tipo = 'crudo' AND borrado IS NULL AND COALESCE(creado_drive, creado) > ${desdeIso}::timestamptz
      ORDER BY 1 LIMIT 500`) as Fila[]
    return r.map((f) => ({ creado: iso(f.creado) ?? '' })).filter((x) => x.creado)
  } catch { return [] }
}

/** Tandas de guiones del cliente con la fecha real de envío: entrega manual (doc.entrega), «Enviado» del d02 o WhatsApp. */
export async function tandasConEnvio(idCrm: string): Promise<{ id: number; tanda: number; estado: string; envio: string | null; notas: { cuando: string }[] }[]> {
  try {
    if (baseCanalLista()) await asegurarTablaCanal()
    const r = (await q()`SELECT g.id, g.tanda, g.estado, g.notas,
        COALESCE(
          (SELECT max(m.cuando) FROM cj_canal_mensajes m WHERE m.pieza = 'd02' AND m.estado = 'enviado' AND (m.datos->>'tanda') = g.id::text),
          (g.doc->'entrega'->>'cuando')::timestamptz,
          (g.whatsapp->>'cuando')::timestamptz) AS envio
      FROM cj_guiones g WHERE upper(g.id_crm) = ${idCrm} AND g.estado = 'enviada' ORDER BY g.creado DESC LIMIT 20`) as Fila[]
    return r.map((f) => ({
      id: Number(f.id), tanda: Number(f.tanda), estado: String(f.estado), envio: iso(f.envio),
      notas: (Array.isArray(f.notas) ? f.notas : []).map((n: { cuando?: string }) => ({ cuando: String(n?.cuando ?? '') })).filter((n) => n.cuando),
    }))
  } catch { return [] }
}

async function crearParaEnviar(c: Q, filaId: number, h: Pick<Incumplimiento, 'idCrm' | 'cliente' | 'tipo' | 'fecha' | 'clausula'>, clave: string, texto: string): Promise<number | null> {
  try {
    const id = await insertarMensaje({
      pieza: 'j01', idCrm: h.idCrm, cliente: h.cliente, clave: `controles:${clave}`, claveCompleta: `j01:controles:${clave}`, texto,
      abrir: `/clientes/controles?cliente=${h.idCrm}`, datos: { origen: 'controles', tipo: h.tipo, fecha: h.fecha, clausula: h.clausula },
    })
    if (id) await c`UPDATE cj_controles_incumplimientos SET mensaje_id = ${id} WHERE id = ${filaId}`
    return id
  } catch (e) {
    console.error(`[controles] ${h.tipo}: no se pudo dejar «para enviar» (${String((e as Error)?.name ?? 'error')})`)
    return null
  }
}

/** Registra el hallazgo. 'aviso' deja además el «para enviar» (pieza j01); 'verificar' queda «a_verificar» sin aviso.
 *  nuevo=false si ya estaba (no se repite nada). */
export async function registrarIncumplimiento(i: Incumplimiento, clave: string, texto: string, modo: 'aviso' | 'verificar'): Promise<{ nuevo: boolean; mensajeId: number | null }> {
  const c = q()
  await asegurarTablasControles(c)
  const estado = modo === 'aviso' ? 'aviso' : 'a_verificar'
  const r = (await c`INSERT INTO cj_controles_incumplimientos (clave, id_crm, tipo, fecha, clausula, falta, lineas, texto, estado)
    VALUES (${clave}, ${i.idCrm}, ${i.tipo}, ${i.fecha}::date, ${i.clausula}, ${i.falta.slice(0, 600)}, ${JSON.stringify(i.lineas.slice(0, 6))}::jsonb, ${texto.slice(0, 2000)}, ${estado})
    ON CONFLICT (clave) DO NOTHING RETURNING id`) as Fila[]
  if (!r.length) return { nuevo: false, mensajeId: null }
  const mensajeId = modo === 'aviso' ? await crearParaEnviar(c, Number(r[0].id), i, clave, texto) : null
  return { nuevo: true, mensajeId }
}

/** «Es incumplimiento» / «No corresponde» de un hallazgo a verificar (una sola vez). Con «Es incumplimiento» se arma el
 *  aviso con el plazo desde hoy y queda «para enviar». null = no existe o ya se resolvió. */
export async function resolverVerificacion(id: number, accion: 'confirmar' | 'descartar', por: string, motivo: string | null, armarTexto: (f: { idCrm: string; fecha: Ymd; falta: string; clausula: string }) => Promise<string>):
  Promise<{ estado: 'confirmado' | 'descartado'; mensajeId: number | null } | null> {
  const c = q()
  await asegurarTablasControles(c)
  const r = (await c`UPDATE cj_controles_incumplimientos SET estado = ${accion === 'confirmar' ? 'confirmado' : 'descartado'}, resuelto_por = ${por.slice(0, 120)},
      resuelto_cuando = now(), motivo = ${motivo ? motivo.slice(0, 300) : null}
    WHERE id = ${id} AND estado = 'a_verificar' RETURNING *`) as Fila[]
  if (!r.length) return null
  if (accion === 'descartar') return { estado: 'descartado', mensajeId: null }
  const f = r[0]
  const h = { idCrm: String(f.id_crm), fecha: ymd(f.fecha), falta: String(f.falta ?? ''), clausula: String(f.clausula ?? '') }
  const cfg = (await c`SELECT cliente FROM cj_controles_cliente WHERE id_crm = ${h.idCrm}`) as Fila[]
  const texto = await armarTexto(h)
  await c`UPDATE cj_controles_incumplimientos SET texto = ${texto.slice(0, 2000)} WHERE id = ${id}`
  const mensajeId = await crearParaEnviar(c, id, { ...h, cliente: String(cfg[0]?.cliente ?? h.idCrm), tipo: String(f.tipo) as TipoIncumplimiento }, String(f.clave), texto)
  return { estado: 'confirmado', mensajeId }
}

export async function anotarAlerta(clave: string, estado: string): Promise<void> {
  try { await q()`UPDATE cj_controles_incumplimientos SET alerta = ${estado.slice(0, 40)} WHERE clave = ${clave}` } catch { /* solo registro */ }
}

export interface IncumplimientoGuardado {
  id: number; clave: string; idCrm: string; tipo: TipoIncumplimiento; fecha: Ymd; clausula: string | null; falta: string; texto: string
  lineas: string[]; creado: string; alerta: string | null
  mensajeId: number | null
  /** a_verificar | descartado_verificacion (No corresponde al verificar) | para_enviar | enviado | descartado (en Para enviar) | sin_mensaje */
  estado: 'a_verificar' | 'descartado_verificacion' | 'para_enviar' | 'enviado' | 'descartado' | 'sin_mensaje'
  /** Quién confirmó o descartó la verificación. */
  verificado: { por: string | null; cuando: string | null } | null
  por: string | null; cuando: string | null; motivo: string | null
}

export async function incumplimientosEntre(idCrm: string | null, desde: Ymd, hasta: Ymd, limite = 300): Promise<IncumplimientoGuardado[]> {
  if (!url()) return []
  const c = q()
  await asegurarTablasControles(c)
  if (baseCanalLista()) await asegurarTablaCanal(c)
  const filas = (await c`SELECT i.*, m.estado AS m_estado, m.por AS m_por, m.cuando AS m_cuando, m.motivo AS m_motivo
    FROM cj_controles_incumplimientos i LEFT JOIN cj_canal_mensajes m ON m.id = i.mensaje_id
    WHERE (${idCrm}::text IS NULL OR i.id_crm = ${idCrm}) AND i.fecha BETWEEN ${desde}::date AND ${hasta}::date
    ORDER BY i.fecha DESC, i.id DESC LIMIT ${Math.min(1000, Math.max(1, limite))}`) as Fila[]
  return filas.map((f) => ({
    id: Number(f.id), clave: String(f.clave), idCrm: String(f.id_crm), tipo: String(f.tipo) as TipoIncumplimiento, fecha: ymd(f.fecha),
    clausula: f.clausula ? String(f.clausula) : null, falta: String(f.falta ?? ''), texto: String(f.texto ?? ''),
    lineas: Array.isArray(f.lineas) ? (f.lineas as unknown[]).map(String) : [], creado: iso(f.creado) ?? '', alerta: f.alerta ? String(f.alerta) : null,
    mensajeId: f.mensaje_id ? Number(f.mensaje_id) : null,
    estado: (f.estado === 'a_verificar' ? 'a_verificar' : f.estado === 'descartado' ? 'descartado_verificacion' : f.m_estado ? String(f.m_estado) : 'sin_mensaje') as IncumplimientoGuardado['estado'],
    verificado: f.resuelto_por ? { por: String(f.resuelto_por), cuando: iso(f.resuelto_cuando) } : null,
    por: f.estado === 'descartado' ? (f.resuelto_por ? String(f.resuelto_por) : null) : f.m_por ? String(f.m_por) : null,
    cuando: f.estado === 'descartado' ? iso(f.resuelto_cuando) : iso(f.m_cuando),
    motivo: f.estado === 'descartado' ? (f.motivo ? String(f.motivo) : null) : f.m_motivo ? String(f.m_motivo) : null,
  }))
}
