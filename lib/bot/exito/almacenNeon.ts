// ── Bot "Capital Jurídico": etapa ÉXITO — almacén en Neon (tablas cj_exito_*) ────────────────────────────────────────────
// Misma base que el motor de altas (DATABASE_URL). Patrón de lib/bot/alta/motor/almacenNeon.ts:
//   · asegurarTablasExito(): CREATE TABLE / INDEX IF NOT EXISTS, una vez por proceso (se reinicia si falla). SOLO lo llaman
//     las escrituras; las lecturas no crean nada (una tabla que no existe cuenta como vacía). Nunca DROP ni cambios de tipo.
//   · cada consulta con tope (TOPE_CONSULTA_MS).
// Tablas:
//   · cj_exito_senales ...... cada mensaje evaluado (o respuesta de la encuesta que contó): dedupe y tope de Claude.
//   · cj_exito_pedidos ...... los pedidos de OK en Verificaciones y lo que pasó después (índice único: un abierto por cliente).
//   · cj_exito_testimonios .. los videos recibidos (id del mensaje y del medio en Whapi, mime, duración, grupo).
//   · cj_exito_encuestas .... la encuesta mensual por cliente (y los reportes de ensayo), con el recordatorio.
// Solo servidor. Los tests usan un cliente SQL falso (sqlExitoParaPruebas).
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { bloqueoDe, type AlmacenExito, type Encuesta, type EstadoLote, type EstadoPedido, type Lote, type Pedido, type Senal, type Testimonio } from './almacen'

export const TOPE_CONSULTA_MS = 10_000
export const TABLAS_EXITO = ['cj_exito_senales', 'cj_exito_pedidos', 'cj_exito_testimonios', 'cj_exito_encuestas', 'cj_exito_lotes'] as const

type Sql = NeonQueryFunction<false, false>
const sqlReal = (url: string): Sql => neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
let crearSql: (url: string) => Sql = sqlReal
let tablasListas: Promise<void> | null = null
let sqlCache: { url: string; q: Sql } | null = null

/** Solo para los tests: reemplaza el cliente de Neon (null vuelve al real) y olvida las tablas creadas. */
export function sqlExitoParaPruebas(f: ((url: string) => Sql) | null): void {
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
/** Lectura: una tabla que todavía no existe cuenta como vacía. */
async function leer<T>(fn: (q: Sql) => Promise<T>, vacio: T): Promise<T> {
  try { return await consulta(fn) } catch (e) { if (faltaTabla(e)) return vacio; throw e }
}

export async function asegurarTablasExito(): Promise<void> {
  tablasListas ??= consulta(async (q) => {
    await q`CREATE TABLE IF NOT EXISTS cj_exito_senales (
      id text PRIMARY KEY, tipo text NOT NULL, clave text NOT NULL, chat_id text, estado text NOT NULL,
      detalle jsonb NOT NULL DEFAULT '{}'::jsonb, creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE INDEX IF NOT EXISTS cj_exito_senales_clave ON cj_exito_senales (clave, creado)`
    await q`CREATE TABLE IF NOT EXISTS cj_exito_pedidos (
      id text PRIMARY KEY, clave text NOT NULL, cliente text NOT NULL, id_crm text, general text NOT NULL, invitacion text,
      motivo jsonb NOT NULL, modo text NOT NULL, estado text NOT NULL, mensaje_pedido_id text, huella text NOT NULL,
      por text, respuesta text, mensaje_cliente_id text, resuelto timestamptz, testimonio_mensaje text, testimonio_en timestamptz,
      error text, creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE UNIQUE INDEX IF NOT EXISTS cj_exito_pedidos_uno_abierto ON cj_exito_pedidos (clave) WHERE estado IN ('abierto', 'aprobado')`
    await q`CREATE INDEX IF NOT EXISTS cj_exito_pedidos_mensaje ON cj_exito_pedidos (mensaje_pedido_id)`
    await q`CREATE INDEX IF NOT EXISTS cj_exito_pedidos_clave ON cj_exito_pedidos (clave, creado)`
    await q`CREATE TABLE IF NOT EXISTS cj_exito_testimonios (
      mensaje_id text PRIMARY KEY, pedido_id text NOT NULL, clave text NOT NULL, chat_id text NOT NULL, grupo text NOT NULL,
      medio jsonb NOT NULL DEFAULT '{}'::jsonb, enviado_en timestamptz, estado text NOT NULL, agradecimiento_id text, discord_id text,
      creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE TABLE IF NOT EXISTS cj_exito_encuestas (
      id text PRIMARY KEY, mes text NOT NULL, clave text NOT NULL, id_crm text, cliente text NOT NULL, general text,
      estado text NOT NULL, enviada_en timestamptz, mensaje_id text, recordatorio_en timestamptz, recordatorio_estado text,
      respondida boolean NOT NULL DEFAULT false, respuesta_id text, puntaje numeric, respondida_en timestamptz,
      creado timestamptz NOT NULL DEFAULT now())`
    await q`CREATE INDEX IF NOT EXISTS cj_exito_encuestas_clave ON cj_exito_encuestas (clave, enviada_en)`
    await q`CREATE INDEX IF NOT EXISTS cj_exito_senales_dudosas ON cj_exito_senales ((detalle ->> 'mensajeId')) WHERE tipo = 'dudosa'`
    await q`CREATE INDEX IF NOT EXISTS cj_exito_encuestas_mes ON cj_exito_encuestas (mes)`
    await q`CREATE TABLE IF NOT EXISTS cj_exito_lotes (
      mes text PRIMARY KEY, estado text NOT NULL, modo text NOT NULL, clientes jsonb NOT NULL DEFAULT '[]'::jsonb,
      excluidos jsonb NOT NULL DEFAULT '[]'::jsonb, sin_grupo jsonb NOT NULL DEFAULT '[]'::jsonb, mensaje_id text, huella text NOT NULL,
      por text, aprobado_en timestamptz, creado timestamptz NOT NULL DEFAULT now())`
  }).catch((e) => { tablasListas = null; throw e })
  return tablasListas
}
async function escribir<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
  await asegurarTablasExito()
  return consulta(fn)
}

// ── Filas ↔ objetos ──
type Row = Record<string, unknown>
const txt = (x: unknown): string | null => (typeof x === 'string' ? x : x === null || x === undefined ? null : String(x))
const fecha = (x: unknown): string | null => (x instanceof Date ? x.toISOString() : typeof x === 'string' && x ? new Date(x).toISOString() : null)
const json = <T>(x: unknown, def: T): T => (x === null || x === undefined ? def : (typeof x === 'string' ? JSON.parse(x) : x) as T)

const aPedido = (r: Row): Pedido => ({
  id: String(r.id), clave: String(r.clave), cliente: String(r.cliente), idCrm: txt(r.id_crm), general: String(r.general), invitacion: txt(r.invitacion),
  motivo: json(r.motivo, { tipo: 'encuesta', puntaje: 0, fecha: null }), modo: String(r.modo), estado: String(r.estado) as EstadoPedido,
  mensajePedidoId: txt(r.mensaje_pedido_id), huella: String(r.huella), por: txt(r.por), respuesta: txt(r.respuesta), mensajeClienteId: txt(r.mensaje_cliente_id),
  resuelto: fecha(r.resuelto), testimonioMensaje: txt(r.testimonio_mensaje), testimonioEn: fecha(r.testimonio_en), error: txt(r.error),
  creado: fecha(r.creado) ?? new Date(0).toISOString(), actualizado: fecha(r.actualizado) ?? new Date(0).toISOString(),
})
const aTestimonio = (r: Row): Testimonio => ({
  mensajeId: String(r.mensaje_id), pedidoId: String(r.pedido_id), clave: String(r.clave), chatId: String(r.chat_id), grupo: String(r.grupo) as Testimonio['grupo'],
  medio: json(r.medio, {}), enviadoEn: fecha(r.enviado_en) ?? '', estado: String(r.estado), agradecimientoId: txt(r.agradecimiento_id), discordId: txt(r.discord_id),
  creado: fecha(r.creado) ?? '',
})
const aEncuesta = (r: Row): Encuesta => ({
  id: String(r.id), mes: String(r.mes), clave: String(r.clave), idCrm: txt(r.id_crm), cliente: String(r.cliente), general: txt(r.general),
  estado: String(r.estado), enviadaEn: fecha(r.enviada_en), mensajeId: txt(r.mensaje_id), recordatorioEn: fecha(r.recordatorio_en),
  recordatorioEstado: txt(r.recordatorio_estado), respondida: r.respondida === true, respuestaId: txt(r.respuesta_id),
  puntaje: r.puntaje === null || r.puntaje === undefined ? null : Number(r.puntaje), respondidaEn: fecha(r.respondida_en), creado: fecha(r.creado) ?? '',
})
const aLote = (r: Row): Lote => ({
  mes: String(r.mes), estado: String(r.estado) as EstadoLote, modo: String(r.modo), clientes: json(r.clientes, []), excluidos: json(r.excluidos, []),
  sinGrupo: json(r.sin_grupo, []), mensajeId: txt(r.mensaje_id), huella: String(r.huella), por: txt(r.por), aprobadoEn: fecha(r.aprobado_en), creado: fecha(r.creado) ?? '',
})
const aSenal = (r: Row): Senal => ({
  id: String(r.id), tipo: String(r.tipo) as Senal['tipo'], clave: String(r.clave), chatId: txt(r.chat_id), estado: String(r.estado) as Senal['estado'],
  detalle: json(r.detalle, {}), creado: fecha(r.creado) ?? '',
})

// Columnas que se pueden cambiar (todo lo demás se ignora): nombre del objeto → columna
const COL_PEDIDO: Partial<Record<keyof Pedido, string>> = {
  estado: 'estado', mensajePedidoId: 'mensaje_pedido_id', por: 'por', respuesta: 'respuesta', mensajeClienteId: 'mensaje_cliente_id',
  resuelto: 'resuelto', testimonioMensaje: 'testimonio_mensaje', testimonioEn: 'testimonio_en', error: 'error',
}
const COL_TESTIMONIO: Partial<Record<keyof Testimonio, string>> = { estado: 'estado', agradecimientoId: 'agradecimiento_id', discordId: 'discord_id' }
const COL_ENCUESTA: Partial<Record<keyof Encuesta, string>> = {
  estado: 'estado', enviadaEn: 'enviada_en', mensajeId: 'mensaje_id', recordatorioEn: 'recordatorio_en', recordatorioEstado: 'recordatorio_estado', respondida: 'respondida', general: 'general',
}

/** UPDATE con solo las columnas permitidas, una sentencia por columna dentro de la misma llamada (las tagged templates de
 *  Neon no arman listas dinámicas; los valores van siempre como parámetros y el nombre de la columna sale de una tabla fija). */
async function actualizarColumnas(q: Sql, tabla: string, clave: string, id: string, columnas: Partial<Record<string, string>>, cambios: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(cambios)) {
    const col = columnas[k]
    if (!col) continue
    await q`UPDATE ${q.unsafe(tabla)} SET ${q.unsafe(col)} = ${v as string | number | boolean | null} WHERE ${q.unsafe(clave)} = ${id}`
  }
}

export function almacenExitoNeon(): AlmacenExito {
  return {
    async reclamarSenal(s, ahora) {
      return escribir(async (q) => (await q`INSERT INTO cj_exito_senales (id, tipo, clave, chat_id, estado, detalle, creado)
        VALUES (${s.id}, ${s.tipo}, ${s.clave}, ${s.chatId}, 'reclamada', ${JSON.stringify(s.detalle)}::jsonb, ${ahora}) ON CONFLICT (id) DO NOTHING RETURNING id`).length > 0)
    },
    async marcarSenal(id, estado, detalle) {
      await escribir((q) => q`UPDATE cj_exito_senales SET estado = ${estado}, detalle = detalle || ${JSON.stringify(detalle ?? {})}::jsonb WHERE id = ${id}`)
    },
    async evaluadasDesde(clave, desde) {
      return leer(async (q) => Number((await q`SELECT count(*) AS n FROM cj_exito_senales WHERE clave = ${clave} AND tipo = 'mensaje' AND estado IN ('exito', 'no', 'error') AND creado >= ${desde}`)[0]?.n ?? 0), 0)
    },
    async bloqueo(clave, ahora) {
      const filas = await leer((q) => q`SELECT * FROM cj_exito_pedidos WHERE clave = ${clave} AND (estado IN ('abierto', 'aprobado') OR COALESCE(resuelto, actualizado) > now() - interval '61 days') ORDER BY creado DESC LIMIT 20` as Promise<Row[]>, [])
      return bloqueoDe(filas.map(aPedido), ahora)
    },
    async crearPedido(p) {
      try {
        return await escribir(async (q) => (await q`INSERT INTO cj_exito_pedidos (id, clave, cliente, id_crm, general, invitacion, motivo, modo, estado, mensaje_pedido_id, huella, creado, actualizado)
          VALUES (${p.id}, ${p.clave}, ${p.cliente}, ${p.idCrm}, ${p.general}, ${p.invitacion}, ${JSON.stringify(p.motivo)}::jsonb, ${p.modo}, 'abierto', ${p.mensajePedidoId}, ${p.huella}, ${p.creado}, ${p.creado})
          ON CONFLICT DO NOTHING RETURNING id`).length > 0)
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') return false   // el índice único: ya hay uno abierto
        throw e
      }
    },
    async actualizarPedido(id, cambios, siEstado) {
      return escribir(async (q) => {
        // Reclamo atómico del estado primero (si se pide), así dos invocaciones no resuelven el mismo pedido
        if (siEstado) {
          const nuevo = cambios.estado ?? null
          const r = await q`UPDATE cj_exito_pedidos SET estado = COALESCE(${nuevo}, estado), actualizado = now() WHERE id = ${id} AND estado = ANY(${[...siEstado]}::text[]) RETURNING id`
          if (!r.length) return false
        } else {
          const r = await q`UPDATE cj_exito_pedidos SET actualizado = now() WHERE id = ${id} RETURNING id`
          if (!r.length) return false
        }
        const { estado: _e, ...resto } = cambios
        void _e
        await actualizarColumnas(q, 'cj_exito_pedidos', 'id', id, COL_PEDIDO, siEstado ? resto : cambios)
        return true
      })
    },
    async pedido(id) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_pedidos WHERE id = ${id}` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async pedidoPorMensaje(mensajeId) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_pedidos WHERE mensaje_pedido_id = ${mensajeId} ORDER BY creado DESC LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async pedidoSinIdPorHuella(huella, desde) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_pedidos WHERE mensaje_pedido_id IS NULL AND huella = ${huella} AND estado = 'abierto' AND creado >= ${desde} ORDER BY creado DESC LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async pedidosAbiertosAntesDe(antes) {
      return (await leer((q) => q`SELECT * FROM cj_exito_pedidos WHERE estado = 'abierto' AND creado < ${antes} LIMIT 200` as Promise<Row[]>, [])).map(aPedido)
    },
    async pedidoParaTestimonio(clave, desde) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_pedidos WHERE clave = ${clave} AND estado IN ('enviado', 'dudoso', 'aprobado_simulado') AND resuelto >= ${desde} AND testimonio_mensaje IS NULL ORDER BY resuelto DESC LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aPedido(f[0]) : null
    },
    async reclamarTestimonio(pedidoId, mensajeId, ahora) {
      return escribir(async (q) => (await q`UPDATE cj_exito_pedidos SET testimonio_mensaje = ${mensajeId}, testimonio_en = ${ahora}, actualizado = now() WHERE id = ${pedidoId} AND testimonio_mensaje IS NULL RETURNING id`).length > 0)
    },
    async guardarTestimonio(t) {
      await escribir((q) => q`INSERT INTO cj_exito_testimonios (mensaje_id, pedido_id, clave, chat_id, grupo, medio, enviado_en, estado, agradecimiento_id, discord_id, creado)
        VALUES (${t.mensajeId}, ${t.pedidoId}, ${t.clave}, ${t.chatId}, ${t.grupo}, ${JSON.stringify(t.medio)}::jsonb, ${t.enviadoEn || null}, ${t.estado}, ${t.agradecimientoId}, ${t.discordId}, ${t.creado})
        ON CONFLICT (mensaje_id) DO NOTHING`)
    },
    async actualizarTestimonio(mensajeId, cambios) {
      await escribir((q) => actualizarColumnas(q, 'cj_exito_testimonios', 'mensaje_id', mensajeId, COL_TESTIMONIO, cambios))
    },
    async reclamarEncuesta(e, ahora) {
      return escribir(async (q) => (await q`INSERT INTO cj_exito_encuestas (id, mes, clave, id_crm, cliente, general, estado, enviada_en, mensaje_id, recordatorio_en, recordatorio_estado, respondida, creado)
        VALUES (${e.id}, ${e.mes}, ${e.clave}, ${e.idCrm}, ${e.cliente}, ${e.general}, ${e.estado}, ${e.enviadaEn}, ${e.mensajeId}, ${e.recordatorioEn}, ${e.recordatorioEstado}, ${e.respondida}, ${ahora})
        ON CONFLICT (id) DO NOTHING RETURNING id`).length > 0)
    },
    async actualizarEncuesta(id, cambios) {
      await escribir((q) => actualizarColumnas(q, 'cj_exito_encuestas', 'id', id, COL_ENCUESTA, cambios))
    },
    async lote(mes) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_lotes WHERE mes = ${mes}` as Promise<Row[]>, [])
      return f[0] ? aLote(f[0]) : null
    },
    async crearLote(l) {
      return escribir(async (q) => (await q`INSERT INTO cj_exito_lotes (mes, estado, modo, clientes, sin_grupo, mensaje_id, huella, creado)
        VALUES (${l.mes}, 'pedido', ${l.modo}, ${JSON.stringify(l.clientes)}::jsonb, ${JSON.stringify(l.sinGrupo)}::jsonb, ${l.mensajeId}, ${l.huella}, ${l.creado})
        ON CONFLICT (mes) DO NOTHING RETURNING mes`).length > 0)
    },
    async actualizarLote(mes, cambios, siEstado) {
      return escribir(async (q) => {
        const nuevo = cambios.estado ?? null
        const r = siEstado
          ? await q`UPDATE cj_exito_lotes SET estado = COALESCE(${nuevo}, estado) WHERE mes = ${mes} AND estado = ANY(${[...siEstado]}::text[]) RETURNING mes`
          : await q`UPDATE cj_exito_lotes SET estado = COALESCE(${nuevo}, estado) WHERE mes = ${mes} RETURNING mes`
        if (!r.length) return false
        if (cambios.mensajeId !== undefined) await q`UPDATE cj_exito_lotes SET mensaje_id = ${cambios.mensajeId} WHERE mes = ${mes}`
        if (cambios.excluidos !== undefined) await q`UPDATE cj_exito_lotes SET excluidos = ${JSON.stringify(cambios.excluidos)}::jsonb WHERE mes = ${mes}`
        if (cambios.por !== undefined) await q`UPDATE cj_exito_lotes SET por = ${cambios.por} WHERE mes = ${mes}`
        if (cambios.aprobadoEn !== undefined) await q`UPDATE cj_exito_lotes SET aprobado_en = ${cambios.aprobadoEn} WHERE mes = ${mes}`
        return true
      })
    },
    async lotePorMensaje(mensajeId) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_lotes WHERE mensaje_id = ${mensajeId} LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aLote(f[0]) : null
    },
    async loteSinIdPorHuella(huella) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_lotes WHERE mensaje_id IS NULL AND huella = ${huella} AND estado = 'pedido' LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aLote(f[0]) : null
    },
    async rondasDesde(desde) {
      return (await leer((q) => q`SELECT * FROM cj_exito_encuestas WHERE clave <> '__reporte' AND enviada_en IS NOT NULL AND enviada_en >= ${desde} ORDER BY enviada_en LIMIT 5000` as Promise<Row[]>, [])).map(aEncuesta)
    },
    async vincularRespuesta(rondaId, r) {
      return escribir(async (q) => (await q`UPDATE cj_exito_encuestas SET respuesta_id = ${r.respuestaId}, puntaje = ${r.puntaje}, respondida_en = ${r.respondidaEn}, respondida = true
        WHERE id = ${rondaId} AND respuesta_id IS NULL RETURNING id`).length > 0)
    },
    async dudosaPorMensaje(mensajeId) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_senales WHERE tipo = 'dudosa' AND detalle ->> 'mensajeId' = ${mensajeId} LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aSenal(f[0]) : null
    },
    async dudosaSinIdPorHuella(huella) {
      const f = await leer((q) => q`SELECT * FROM cj_exito_senales WHERE tipo = 'dudosa' AND estado = 'consultada' AND detalle ->> 'mensajeId' IS NULL AND detalle ->> 'huella' = ${huella} ORDER BY creado DESC LIMIT 1` as Promise<Row[]>, [])
      return f[0] ? aSenal(f[0]) : null
    },
    async asignaciones() {
      const f = await leer((q) => q`SELECT detalle ->> 'respuesta' AS respuesta, detalle ->> 'idCliente' AS id FROM cj_exito_senales WHERE tipo = 'dudosa' AND estado = 'asignada'` as Promise<Row[]>, [])
      return new Map(f.filter((x) => x.respuesta && x.id).map((x) => [String(x.respuesta), String(x.id)]))
    },
    async encuestasDelMes(mes) {
      return (await leer((q) => q`SELECT * FROM cj_exito_encuestas WHERE mes = ${mes}` as Promise<Row[]>, [])).map(aEncuesta)
    },
    async listarPedidos(limite) {
      return (await leer((q) => q`SELECT * FROM cj_exito_pedidos ORDER BY creado DESC LIMIT ${limite}` as Promise<Row[]>, [])).map(aPedido)
    },
    async listarTestimonios(limite) {
      return (await leer((q) => q`SELECT * FROM cj_exito_testimonios ORDER BY creado DESC LIMIT ${limite}` as Promise<Row[]>, [])).map(aTestimonio)
    },
  }
}

export type { Senal }
