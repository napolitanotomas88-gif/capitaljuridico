// ── Bot "Capital Jurídico": etapa BAJA — almacén en Neon (tablas cj_bajas_*) ─────────────────────────────────────────────
// Misma base que el motor de altas (DATABASE_URL). Mismo patrón que lib/bot/alta/motor/almacenNeon.ts y la etapa Éxito:
//   · asegurarTablasBajas(): CREATE TABLE / INDEX IF NOT EXISTS, una vez por proceso (se reinicia si falla). SOLO lo llaman
//     las escrituras; las lecturas no crean nada (una tabla que no existe cuenta como vacía). Nunca DROP ni cambios de tipo.
//   · cada consulta con tope (TOPE_CONSULTA_MS).
// Tablas:
//   · cj_bajas_pedidos ...... los pedidos de OK en Verificaciones (aviso de fin, confirmación de baja, despedida).
//   · cj_bajas_bajas ........ las bajas CONFIRMADAS y qué pasó con cada paso (CRM, Skool, despedida, grupos).
//   · cj_bajas_llamadas ..... las grabaciones de Fathom que se miraron (dedupe) y lo que decidió el cliente.
//   · cj_bajas_recontactos .. la lista mensual de históricos (una por mes; las de prueba con mes "prueba:AAAA-MM").
//   · cj_bajas_rastros ...... modo prueba (BOT_CLIENTES_PRUEBA): cada acción externa sobre un cliente de prueba, para borrarla.
// Solo servidor. Los tests usan un cliente SQL falso (sqlBajasParaPruebas).
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { AlmacenBajas, Baja, EstadoPedido, Llamada, Pedido, Rastro } from './almacen'

export const TOPE_CONSULTA_MS = 10_000
export const TABLAS_BAJAS = ['cj_bajas_pedidos', 'cj_bajas_bajas', 'cj_bajas_llamadas', 'cj_bajas_recontactos', 'cj_bajas_rastros'] as const

type Sql = NeonQueryFunction<false, false>
const sqlReal = (url: string): Sql => neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
let crearSql: (url: string) => Sql = sqlReal
let tablasListas: Promise<void> | null = null
let sqlCache: { url: string; q: Sql } | null = null

/** Solo para los tests: reemplaza el cliente de Neon (null vuelve al real) y olvida las tablas creadas. */
export function sqlBajasParaPruebas(f: ((url: string) => Sql) | null): void {
  crearSql = f ?? sqlReal
  tablasListas = null
  sqlCache = null
}

function sql(): Sql {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  if (!sqlCache || sqlCache.url !== url) sqlCache = { url, q: crearSql(url) }
  return sqlCache.q
}

const faltaTabla = (e: unknown): boolean => (e as { code?: string })?.code === '42P01' || /relation "\w+" does not exist/i.test((e as Error)?.message ?? '')

async function consulta<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([fn(sql()), new Promise<never>((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('la base no respondió'), { name: 'TimeoutError' })), TOPE_CONSULTA_MS) })])
  } finally { if (t) clearTimeout(t) }
}
async function leer<T>(fn: (q: Sql) => Promise<T>, vacio: T): Promise<T> {
  try { return await consulta(fn) } catch (e) { if (faltaTabla(e)) return vacio; throw e }
}

export async function asegurarTablasBajas(): Promise<void> {
  tablasListas ??= consulta(async (q) => {
    await q`CREATE TABLE IF NOT EXISTS cj_bajas_pedidos (
      id text PRIMARY KEY, tipo text NOT NULL, clave text NOT NULL, cliente text NOT NULL, id_crm text NOT NULL, general text, fin date,
      modo text NOT NULL, estado text NOT NULL, mensaje_pedido_id text, huella text NOT NULL, por text, respuesta text,
      mensaje_cliente_id text, detalle jsonb NOT NULL DEFAULT '{}'::jsonb, resuelto timestamptz, error text,
      creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE UNIQUE INDEX IF NOT EXISTS cj_bajas_pedidos_uno_abierto ON cj_bajas_pedidos (clave, tipo) WHERE estado IN ('abierto', 'aprobado')`
    await q`CREATE INDEX IF NOT EXISTS cj_bajas_pedidos_mensaje ON cj_bajas_pedidos (mensaje_pedido_id)`
    await q`CREATE INDEX IF NOT EXISTS cj_bajas_pedidos_clave ON cj_bajas_pedidos (clave, creado)`
    await q`CREATE TABLE IF NOT EXISTS cj_bajas_bajas (
      id text PRIMARY KEY, clave text NOT NULL, id_crm text NOT NULL, cliente text NOT NULL, general text, mail text NOT NULL DEFAULT '',
      motivo text NOT NULL DEFAULT '', origen jsonb NOT NULL DEFAULT '{}'::jsonb, por text NOT NULL, modo text NOT NULL,
      confirmada timestamptz NOT NULL, pasos jsonb NOT NULL DEFAULT '{}'::jsonb, creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE INDEX IF NOT EXISTS cj_bajas_bajas_clave ON cj_bajas_bajas (clave, creado)`
    await q`CREATE TABLE IF NOT EXISTS cj_bajas_llamadas (
      recording_id bigint PRIMARY KEY, clave text, cliente text, fecha date, estado text NOT NULL, decision text, confianza text,
      cita text, motivo text, motivo_baja text, url text, pedido_id text, creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE TABLE IF NOT EXISTS cj_bajas_recontactos (
      mes text PRIMARY KEY, estado text NOT NULL, modo text NOT NULL, cantidad integer NOT NULL DEFAULT 0,
      discord_ids jsonb NOT NULL DEFAULT '[]'::jsonb, creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE TABLE IF NOT EXISTS cj_bajas_rastros (
      id bigserial PRIMARY KEY, id_crm text NOT NULL, tipo text NOT NULL, datos jsonb NOT NULL DEFAULT '{}'::jsonb,
      creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE INDEX IF NOT EXISTS cj_bajas_rastros_id_crm ON cj_bajas_rastros (id_crm, creado)`
  }).catch((e) => { tablasListas = null; throw e })
  return tablasListas
}
async function escribir<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
  await asegurarTablasBajas()
  return consulta(fn)
}

type Row = Record<string, unknown>
const txt = (x: unknown): string | null => (typeof x === 'string' ? x : x === null || x === undefined ? null : String(x))
const fecha = (x: unknown): string | null => (x instanceof Date ? x.toISOString() : typeof x === 'string' && x ? new Date(x).toISOString() : null)
const dia = (x: unknown): string | null => (x instanceof Date ? x.toISOString().slice(0, 10) : typeof x === 'string' && x ? x.slice(0, 10) : null)
const json = <T>(x: unknown, def: T): T => (x === null || x === undefined ? def : (typeof x === 'string' ? JSON.parse(x) : x) as T)

const aPedido = (r: Row): Pedido => ({
  id: String(r.id), tipo: String(r.tipo) as Pedido['tipo'], clave: String(r.clave), cliente: String(r.cliente), idCrm: String(r.id_crm),
  general: txt(r.general), fin: dia(r.fin), modo: String(r.modo), estado: String(r.estado) as EstadoPedido,
  mensajePedidoId: txt(r.mensaje_pedido_id), huella: String(r.huella), por: txt(r.por), respuesta: txt(r.respuesta),
  mensajeClienteId: txt(r.mensaje_cliente_id), detalle: json(r.detalle, {}), resuelto: fecha(r.resuelto), error: txt(r.error),
  creado: fecha(r.creado) ?? new Date(0).toISOString(), actualizado: fecha(r.actualizado) ?? new Date(0).toISOString(),
})
const aBaja = (r: Row): Baja => ({
  id: String(r.id), clave: String(r.clave), idCrm: String(r.id_crm), cliente: String(r.cliente), general: txt(r.general), mail: String(r.mail ?? ''),
  motivo: String(r.motivo ?? ''), origen: json(r.origen, { tipo: 'manual', por: '', motivo: '' }), por: String(r.por), modo: String(r.modo),
  confirmada: fecha(r.confirmada) ?? '', pasos: json(r.pasos, {}), creado: fecha(r.creado) ?? '',
})

const COL_PEDIDO: Partial<Record<keyof Pedido, string>> = {
  mensajePedidoId: 'mensaje_pedido_id', por: 'por', respuesta: 'respuesta', mensajeClienteId: 'mensaje_cliente_id', resuelto: 'resuelto', error: 'error', general: 'general',
}
const COL_LLAMADA: Partial<Record<keyof Llamada, string>> = {
  clave: 'clave', cliente: 'cliente', fecha: 'fecha', estado: 'estado', decision: 'decision', confianza: 'confianza', cita: 'cita',
  motivo: 'motivo', motivoBaja: 'motivo_baja', url: 'url', pedidoId: 'pedido_id',
}

/** UPDATE con solo las columnas permitidas (el nombre de la columna sale de una tabla fija; los valores van como parámetros). */
async function actualizarColumnas(q: Sql, tabla: string, clave: string, id: string | number, columnas: Partial<Record<string, string>>, cambios: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(cambios)) {
    const col = columnas[k]
    if (!col) continue
    await q`UPDATE ${q.unsafe(tabla)} SET ${q.unsafe(col)} = ${v as string | number | boolean | null} WHERE ${q.unsafe(clave)} = ${id}`
  }
}

export function almacenBajasNeon(): AlmacenBajas {
  return {
    async crearPedido(p) {
      try {
        return await escribir(async (q) => (await q`INSERT INTO cj_bajas_pedidos (id, tipo, clave, cliente, id_crm, general, fin, modo, estado, mensaje_pedido_id, huella, detalle, creado, actualizado)
          VALUES (${p.id}, ${p.tipo}, ${p.clave}, ${p.cliente}, ${p.idCrm}, ${p.general}, ${p.fin}, ${p.modo}, 'abierto', ${p.mensajePedidoId}, ${p.huella}, ${JSON.stringify(p.detalle)}::jsonb, ${p.creado}, ${p.creado})
          ON CONFLICT DO NOTHING RETURNING id`).length > 0)
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') return false
        throw e
      }
    },
    async actualizarPedido(id, cambios, siEstado) {
      return escribir(async (q) => {
        const nuevo = cambios.estado ?? null
        const r = siEstado
          ? await q`UPDATE cj_bajas_pedidos SET estado = COALESCE(${nuevo}, estado), actualizado = now() WHERE id = ${id} AND estado = ANY(${[...siEstado]}::text[]) RETURNING id`
          : await q`UPDATE cj_bajas_pedidos SET estado = COALESCE(${nuevo}, estado), actualizado = now() WHERE id = ${id} RETURNING id`
        if (!r.length) return false
        const { estado: _e, detalle, ...resto } = cambios
        void _e
        if (detalle) await q`UPDATE cj_bajas_pedidos SET detalle = detalle || ${JSON.stringify(detalle)}::jsonb WHERE id = ${id}`
        await actualizarColumnas(q, 'cj_bajas_pedidos', 'id', id, COL_PEDIDO, resto)
        return true
      })
    },
    async pedido(id) {
      const f = await leer((q) => q`SELECT * FROM cj_bajas_pedidos WHERE id = ${id}` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async pedidoPorMensaje(m) {
      const f = await leer((q) => q`SELECT * FROM cj_bajas_pedidos WHERE mensaje_pedido_id = ${m} ORDER BY creado DESC LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async pedidoSinIdPorHuella(huella, desde) {
      const f = await leer((q) => q`SELECT * FROM cj_bajas_pedidos WHERE mensaje_pedido_id IS NULL AND huella = ${huella} AND estado = 'abierto' AND creado >= ${desde} ORDER BY creado DESC LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async pedidosAbiertosAntesDe(antes) {
      return (await leer((q) => q`SELECT * FROM cj_bajas_pedidos WHERE estado = 'abierto' AND creado < ${antes} LIMIT 200` as Promise<Row[]>, [])).map(aPedido)
    },
    async abiertoDe(clave, tipo) {
      const f = await leer((q) => q`SELECT * FROM cj_bajas_pedidos WHERE clave = ${clave} AND tipo = ${tipo} AND estado IN ('abierto', 'aprobado') LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async conAvisoDesde(desde) {
      const f = await leer((q) => q`SELECT DISTINCT upper(id_crm) AS id FROM cj_bajas_pedidos WHERE tipo = 'aviso_fin' AND estado IN ('enviado', 'dudoso', 'aprobado_simulado') AND resuelto >= ${desde}` as Promise<Row[]>, [])
      return new Set(f.map((x) => String(x.id)))
    },
    async crearBaja(b) {
      return escribir(async (q) => (await q`INSERT INTO cj_bajas_bajas (id, clave, id_crm, cliente, general, mail, motivo, origen, por, modo, confirmada, creado)
        VALUES (${b.id}, ${b.clave}, ${b.idCrm}, ${b.cliente}, ${b.general}, ${b.mail}, ${b.motivo}, ${JSON.stringify(b.origen)}::jsonb, ${b.por}, ${b.modo}, ${b.confirmada}, ${b.creado})
        ON CONFLICT (id) DO NOTHING RETURNING id`).length > 0)
    },
    async marcarPaso(id, paso, valor) {
      await escribir((q) => q`UPDATE cj_bajas_bajas SET pasos = pasos || ${JSON.stringify({ [paso]: valor })}::jsonb WHERE id = ${id}`)
    },
    async baja(id) {
      const f = await leer((q) => q`SELECT * FROM cj_bajas_bajas WHERE id = ${id}` as Promise<Row[]>, [])
      return f[0] ? aBaja(f[0]) : null
    },
    async bajaDe(clave) {
      const f = await leer((q) => q`SELECT * FROM cj_bajas_bajas WHERE clave = ${clave} ORDER BY creado DESC LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aBaja(f[0]) : null
    },
    async reclamarLlamada(l, ahora) {
      return escribir(async (q) => (await q`INSERT INTO cj_bajas_llamadas (recording_id, fecha, url, estado, creado)
        VALUES (${l.recordingId}, ${l.fecha}, ${l.url}, 'reclamada', ${ahora})
        ON CONFLICT (recording_id) DO UPDATE SET estado = 'reclamada', creado = EXCLUDED.creado WHERE cj_bajas_llamadas.estado IN ('cortada', 'error')
        RETURNING recording_id`).length > 0)
    },
    async actualizarLlamada(id, cambios) {
      await escribir((q) => actualizarColumnas(q, 'cj_bajas_llamadas', 'recording_id', id, COL_LLAMADA, cambios))
    },
    async motivosDeBaja() {
      const ll = await leer((q) => q`SELECT clave, motivo_baja FROM cj_bajas_llamadas WHERE clave IS NOT NULL AND motivo_baja <> '' AND decision IN ('no_renueva', 'dudoso') ORDER BY creado` as Promise<Row[]>, [])
      const bb = await leer((q) => q`SELECT clave, motivo FROM cj_bajas_bajas WHERE motivo <> '' ORDER BY creado` as Promise<Row[]>, [])
      const m = new Map<string, string>()
      for (const x of ll) m.set(String(x.clave), String(x.motivo_baja))
      for (const x of bb) m.set(String(x.clave), String(x.motivo))
      return m
    },
    async reclamarRecontacto(r) {
      return escribir(async (q) => (await q`INSERT INTO cj_bajas_recontactos (mes, estado, modo, cantidad, creado)
        VALUES (${r.mes}, 'reclamado', ${r.modo}, ${r.cantidad}, ${r.creado}) ON CONFLICT (mes) DO NOTHING RETURNING mes`).length > 0)
    },
    async actualizarRecontacto(mes, cambios) {
      await escribir(async (q) => {
        if (cambios.estado !== undefined) await q`UPDATE cj_bajas_recontactos SET estado = ${cambios.estado} WHERE mes = ${mes}`
        if (cambios.cantidad !== undefined) await q`UPDATE cj_bajas_recontactos SET cantidad = ${cambios.cantidad} WHERE mes = ${mes}`
        if (cambios.discordIds !== undefined) await q`UPDATE cj_bajas_recontactos SET discord_ids = ${JSON.stringify(cambios.discordIds)}::jsonb WHERE mes = ${mes}`
      })
    },
    async listarPedidos(limite) {
      return (await leer((q) => q`SELECT * FROM cj_bajas_pedidos ORDER BY creado DESC LIMIT ${limite}` as Promise<Row[]>, [])).map(aPedido)
    },
    async listarBajas(limite) {
      return (await leer((q) => q`SELECT * FROM cj_bajas_bajas ORDER BY creado DESC LIMIT ${limite}` as Promise<Row[]>, [])).map(aBaja)
    },
    async registrarRastro(r) {
      await escribir((q) => q`INSERT INTO cj_bajas_rastros (id_crm, tipo, datos, creado) VALUES (${r.idCrm.toUpperCase()}, ${r.tipo}, ${JSON.stringify(r.datos)}::jsonb, ${r.creado})`)
    },
    async rastrosDe(ids) {
      const lista = ids.map((x) => x.toUpperCase())
      if (!lista.length) return []
      const f = await leer((q) => q`SELECT * FROM cj_bajas_rastros WHERE id_crm = ANY(${lista}::text[]) ORDER BY creado, id` as Promise<Row[]>, [])
      return f.map((r): Rastro => ({ idCrm: String(r.id_crm), tipo: String(r.tipo) as Rastro['tipo'], datos: json(r.datos, {}), creado: fecha(r.creado) ?? '' }))
    },
  }
}
