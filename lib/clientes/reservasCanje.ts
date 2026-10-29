// ── Reservas durables del canje de créditos con Postgres (conectado a POST /api/referidos/canje con CRM_ESCRITURA_CANJE=real) ──
// La migración 002 todavía NO corrió en producción: hasta que corra (y se valide con scripts/validar-canjes-postgres.mjs contra una base de
// PRUEBA), una reserva real falla (la tabla no existe) y el canje responde "escritura_bloqueada" sin tocar el libro.
// SOLO servidor. Mismo protocolo que coordinadorPostgres.ts (alta de referidos), aplicado al libro "Créditos":
//   1. reservar(): transacción CORTA (con pg_advisory_xact_lock solo para serializar la asignación de fila e ID) que elige la fila y el ID de
//      movimiento (máximo entre el piso leído del libro y lo ya reservado, +1), congela meses y USD y hace COMMIT. La escritura HTTP al libro
//      NUNCA ocurre dentro de una transacción ni depende de que la conexión siga viva.
//   2. El lock NO es la garantía: es solo orden. Si se corta la conexión (o el proceso) el lock se suelta solo, pero la reserva ya está
//      commiteada; lo que impide el doble gasto y las filas repetidas son los ÍNDICES ÚNICOS de la migración 002 (cliente+ciclo, actor+clave, fila).
//   3. Un reintento (misma clave y mismo pedido) recibe LA MISMA reserva con su saldo congelado, aunque el libro ya haya cambiado.
//   4. confirmar(): 'confirmada' cuando la fila del libro quedó escrita. 'pendiente' ≠ guardado.
// Monedas: meses y USD son columnas distintas; nunca se suman.
import { createHmac } from 'node:crypto'
import { TIMEOUTS, urlDeBaseValida, type ClienteDb } from './coordinadorPostgres'

export const CLAVE_LOCK_CANJE = '7261900102' // distinto del de altas de referidos (7261900101)
export const idMovimiento = (n: number): string => `M${String(n).padStart(3, '0')}`

export type EstadoReservaCanje = 'pendiente' | 'confirmada'
export interface ResultadoCanjeGuardado { estado: 'guardado'; id: string; fila: number; meses: number; usd: number; avisos: string[]; mensaje: string }
export interface ReservaCanje {
  idNumero: number; id: string; fila: number; estado: EstadoReservaCanje
  cliente: string; cicloClave: string; meses: number; usd: number; extra: string
  resultado: ResultadoCanjeGuardado | null
}
export interface PedidoReservaCanje {
  actor: string; clave: string
  huellaPedido: string           // cliente | fecha | renovación (sin saldo)
  huella: string                 // pedido + saldo congelado + versión de reglas
  cliente: string
  cicloClave: string             // fecha del último canje asentado, o ''
  meses: number; usd: number; extra: string
  pisoFila: number               // primera fila libre del libro (lectura fresca)
  pisoIdNumero: number           // mayor número de ID M### que ya tiene el libro
}
export type SalidaReservaCanje =
  | { tipo: 'nueva'; reserva: ReservaCanje }
  | { tipo: 'misma_clave'; reserva: ReservaCanje }           // reintento: se conserva fila, ID y saldo congelado
  | { tipo: 'mismo_canje_en_ciclo'; reserva: ReservaCanje }  // otra clave/actor, mismo canje exacto del mismo ciclo: no se reserva dos veces
  | { tipo: 'conflicto_clave' }                              // misma (actor, clave) con otro pedido
  | { tipo: 'conflicto_ciclo' }                              // ya hay un canje vivo de ese cliente en ese ciclo con otro contenido

export interface ReservasCanjeDurables {
  durable: true
  /** Reintento por clave SIN recalcular nada: la reserva existente (saldo congelado), conflicto si el pedido cambió, o null si no existe. */
  buscarPorClave(actor: string, clave: string, huellaPedido: string): Promise<{ tipo: 'misma_clave'; reserva: ReservaCanje } | { tipo: 'conflicto_clave' } | null>
  reservar(p: PedidoReservaCanje): Promise<SalidaReservaCanje>
  confirmar(idNumero: number, resultado: ResultadoCanjeGuardado): Promise<boolean>
  /** Borra una reserva pendiente cuya escritura se rechazó SIN escribir (403): libera fila, ID y ciclo. */
  liberar(idNumero: number): Promise<boolean>
  /** La fila reservada apareció ocupada por otra cosa: se descarta (su fila e ID no se reusan) y se libera el ciclo. */
  descartar(idNumero: number): Promise<boolean>
}

const hmac = (secreto: string, etiqueta: string, valor: string) => createHmac('sha256', secreto).update(`${etiqueta}\u0000${valor}`).digest('hex')

const COLS = 'id_numero, fila, estado, cliente, ciclo_clave, meses, usd, extra, huella, huella_pedido, resultado'
export const SQL_CANJE = {
  lock: 'SELECT pg_advisory_xact_lock($1::bigint)',
  porClave: `SELECT ${COLS} FROM canjes_reservas WHERE actor_hash = $1 AND clave_hash = $2 AND estado <> 'descartada'`,
  porCiclo: `SELECT ${COLS} FROM canjes_reservas WHERE cliente = $1 AND ciclo_clave = $2 AND estado <> 'descartada'`,
  maximos: 'SELECT COALESCE(MAX(fila), 0) AS max_fila, COALESCE(MAX(id_numero), 0) AS max_id FROM canjes_reservas',
  insertar: "INSERT INTO canjes_reservas (id_numero, fila, cliente, ciclo_clave, actor_hash, clave_hash, huella_pedido, huella, meses, usd, extra, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente')",
  confirmar: "UPDATE canjes_reservas SET estado = 'confirmada', resultado = $2::jsonb, confirmado_en = now() WHERE id_numero = $1 AND estado = 'pendiente'",
  liberar: "DELETE FROM canjes_reservas WHERE id_numero = $1 AND estado = 'pendiente'",
  descartar: "UPDATE canjes_reservas SET estado = 'descartada' WHERE id_numero = $1 AND estado = 'pendiente'",
  estado: 'SELECT estado FROM canjes_reservas WHERE id_numero = $1',
} as const

const aReserva = (r: Record<string, unknown>): ReservaCanje => ({
  idNumero: Number(r.id_numero), id: idMovimiento(Number(r.id_numero)), fila: Number(r.fila), estado: r.estado as EstadoReservaCanje,
  cliente: String(r.cliente), cicloClave: String(r.ciclo_clave ?? ''), meses: Number(r.meses), usd: Number(r.usd), extra: String(r.extra ?? ''),
  resultado: (r.resultado as ResultadoCanjeGuardado | null) ?? null,
})

/** El llamador ya abrió una transacción. Permite reservar canje y renovación de forma indivisible. */
export async function reservarCanjeConConsulta(q: ClienteDb['query'], p: PedidoReservaCanje, secreto: string): Promise<SalidaReservaCanje> {
  if (!secreto || secreto.length < 32) throw new Error('REFERIDOS_HMAC_SECRET inválido (mínimo 32 caracteres)')
  await q(SQL_CANJE.lock, [CLAVE_LOCK_CANJE])
  const a = hmac(secreto, 'actor', p.actor.trim().toLowerCase()), k = hmac(secreto, 'clave', p.clave)
  const hp = hmac(secreto, 'pedido', p.huellaPedido), h = hmac(secreto, 'huella', p.huella)
  const porClave = (await q(SQL_CANJE.porClave, [a, k])).rows[0]
  if (porClave) return porClave.huella_pedido === hp ? { tipo: 'misma_clave', reserva: aReserva(porClave) } : { tipo: 'conflicto_clave' }
  const porCiclo = (await q(SQL_CANJE.porCiclo, [p.cliente, p.cicloClave])).rows[0]
  if (porCiclo) return porCiclo.huella === h ? { tipo: 'mismo_canje_en_ciclo', reserva: aReserva(porCiclo) } : { tipo: 'conflicto_ciclo' }
  const m = (await q(SQL_CANJE.maximos)).rows[0]
  const fila = Math.max(p.pisoFila, Number(m.max_fila) + 1), idNumero = Math.max(p.pisoIdNumero + 1, Number(m.max_id) + 1)
  await q(SQL_CANJE.insertar, [idNumero, fila, p.cliente, p.cicloClave, a, k, hp, h, p.meses, p.usd, p.extra])
  return { tipo: 'nueva', reserva: { idNumero, id: idMovimiento(idNumero), fila, estado: 'pendiente', cliente: p.cliente, cicloClave: p.cicloClave, meses: p.meses, usd: p.usd, extra: p.extra, resultado: null } }
}

export async function confirmarCanjeConConsulta(q: ClienteDb['query'], idNumero: number, resultado: ResultadoCanjeGuardado): Promise<boolean> {
  const r = await q(SQL_CANJE.confirmar, [idNumero, JSON.stringify(resultado)])
  if ((r as { rowCount?: number }).rowCount === 1) return true
  return (await q(SQL_CANJE.estado, [idNumero])).rows[0]?.estado === 'confirmada'
}

export function crearReservasCanjePostgres(opciones: { conectar: () => Promise<ClienteDb>; secreto: string }): ReservasCanjeDurables {
  if (!opciones.secreto || opciones.secreto.length < 32) throw new Error('REFERIDOS_HMAC_SECRET inválido (mínimo 32 caracteres)')
  const secreto = opciones.secreto

  async function enTransaccion<T>(conLock: boolean, fn: (q: ClienteDb['query']) => Promise<T>): Promise<T> {
    const c = await opciones.conectar()
    let destruir = false
    try {
      await c.query('BEGIN')
      await c.query(`SET LOCAL lock_timeout = '${TIMEOUTS.lockMs}ms'`)
      await c.query(`SET LOCAL statement_timeout = '${TIMEOUTS.statementMs}ms'`)
      if (conLock) await c.query(SQL_CANJE.lock, [CLAVE_LOCK_CANJE])
      const r = await fn(c.query.bind(c))
      await c.query('COMMIT')
      return r
    } catch (e) {
      try { await c.query('ROLLBACK') } catch { destruir = true }
      throw e
    } finally {
      c.release(destruir)
    }
  }
  const claves = (actor: string, clave: string) => [hmac(secreto, 'actor', actor.trim().toLowerCase()), hmac(secreto, 'clave', clave)] as const

  return {
    durable: true,
    buscarPorClave: async (actor, clave, huellaPedido) => {
      const [a, k] = claves(actor, clave)
      const h = hmac(secreto, 'pedido', huellaPedido)
      return enTransaccion(false, async q => {
        const fila = (await q(SQL_CANJE.porClave, [a, k])).rows[0]
        if (!fila) return null
        return fila.huella_pedido === h ? { tipo: 'misma_clave' as const, reserva: aReserva(fila) } : { tipo: 'conflicto_clave' as const }
      })
    },
    reservar: p => enTransaccion(false, q => reservarCanjeConConsulta(q, p, secreto)),
    confirmar: (idNumero, resultado) =>
      enTransaccion(false, q => confirmarCanjeConConsulta(q, idNumero, resultado)),
    liberar: idNumero => enTransaccion(false, async q => ((await q(SQL_CANJE.liberar, [idNumero])) as { rowCount?: number }).rowCount === 1),
    descartar: idNumero => enTransaccion(false, async q => ((await q(SQL_CANJE.descartar, [idNumero])) as { rowCount?: number }).rowCount === 1),
  }
}

// ── Conexión desde el entorno (falla cerrado; mismo criterio que coordinadorDesdeEntorno) ─────────────────────────────
type PoolLike = { connect(): Promise<ClienteDb>; on(ev: string, f: () => void): unknown }
const g = globalThis as unknown as { __cjPoolCanjes?: PoolLike }

/** null si falta una DATABASE_URL apropiada o la llave REFERIDOS_HMAC_SECRET (≥ 32): sin eso el canje real queda bloqueado. */
export function reservasCanjeDesdeEntorno(env: Record<string, string | undefined>, entorno: { vercel: boolean; produccion: boolean }): ReservasCanjeDurables | null {
  const url = urlDeBaseValida(env.DATABASE_URL, entorno)
  const secreto = env.REFERIDOS_HMAC_SECRET
  if (!url || !secreto || secreto.length < 32) return null
  return crearReservasCanjePostgres({
    secreto,
    conectar: async () => {
      if (!g.__cjPoolCanjes) {
        const { Pool } = await import('pg') // pool propio y chico: los canjes son pocos y cada paso usa 1 conexión por muy poco tiempo
        const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true, application_name: 'cj-canjes' })
        pool.on('error', () => undefined) // un error de una conexión ociosa no tiene que tirar el proceso
        g.__cjPoolCanjes = pool as unknown as PoolLike
      }
      return g.__cjPoolCanjes.connect()
    },
  })
}
