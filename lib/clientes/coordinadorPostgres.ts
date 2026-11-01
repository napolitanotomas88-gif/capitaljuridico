// ── Reservas durables del alta de referidos con Postgres (adapter listo para conectar; hoy SIN base provisionada) ──
// SOLO servidor. Protocolo "reservar y COMMITear ANTES de escribir en el Sheet":
//   1. reservar(): en una transacción CORTA (con pg_advisory_xact_lock solo para serializar la asignación) se elige la fila y el ID
//      (máximo entre el piso leído del Sheet y lo ya reservado, +1) y se hace COMMIT. Después se suelta la conexión: la escritura
//      HTTP al Sheet NO ocurre dentro de ninguna transacción ni depende de que la conexión siga viva.
//   2. El que llama escribe en ESA fila. Un corte (de la base, del proceso o de la red) mientras escribe deja la reserva 'pendiente':
//      otra instancia no puede elegir esa fila ni ese ID, y el reintento (misma clave y contenido) recibe LA MISMA reserva.
//   3. confirmar(): marca 'confirmada' cuando la escritura terminó bien. 'pendiente' ≠ guardado.
//   · Exclusividad por persona: una sola reserva viva por teléfono canónico (HMAC de los últimos 8 dígitos). Dos claves o dos actores
//     con el mismo teléfono no reservan dos filas: misma persona y mismo referidor → se devuelve la reserva existente; otro
//     referidor → conflicto explícito. Índices únicos parciales de la migración son la red de seguridad.
//   · Misma (actor, clave) con otro contenido → conflicto de clave.
//   · Privacidad: solo HMACs y el resultado sin datos de la persona. La llave es REFERIDOS_HMAC_SECRET (≥ 32 caracteres, propia);
//     sin ella no hay coordinador (no hay llave pública por defecto).
//   · Límites: coordina las altas hechas POR ESTA APP; no controla ediciones manuales en el Sheet (el escritor comprueba que la fila
//     reservada siga vacía justo antes de escribir, pero entre esa lectura y la escritura no hay atomicidad posible con Sheets).
//     Nada de esto se probó contra un Postgres real.
import { createHmac } from 'node:crypto'

export interface ClienteDb {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  release(destruir?: boolean): void
}
export type EstadoReserva = 'pendiente' | 'confirmada'
export interface ResultadoGuardado { estado: 'guardado'; id: string; fila: number | null; avisos: string[]; mensaje: string }
export interface Reserva { idNumero: number; id: string; fila: number; estado: EstadoReserva; referidor: string; resultado: ResultadoGuardado | null }
export interface PedidoReserva {
  actor: string; clave: string; huella: string
  telefonoClave: string          // últimos 8 dígitos del teléfono (claveTelefono)
  referidor: string              // ID del cliente que refiere
  pisoFila: number               // primera fila libre según el Sheet (lectura fresca)
  pisoIdNumero: number           // mayor número de ID R### que ya tiene el Sheet
}
export type SalidaReserva =
  | { tipo: 'nueva'; reserva: Reserva }
  | { tipo: 'misma_clave'; reserva: Reserva }          // reintento: se conserva fila + ID, nunca se recalcula
  | { tipo: 'misma_persona'; reserva: Reserva }        // otra clave u otro actor, mismo teléfono y mismo referidor
  | { tipo: 'conflicto_clave' }                        // misma (actor, clave) con otro contenido
  | { tipo: 'conflicto_telefono' }                     // ese teléfono ya está reservado para OTRO referidor

export interface ReservasDurables {
  durable: true
  reservar(p: PedidoReserva): Promise<SalidaReserva>
  /** true si pasó de pendiente a confirmada (o ya lo estaba) */
  confirmar(idNumero: number, resultado: ResultadoGuardado): Promise<boolean>
  /** Borra una reserva pendiente cuya escritura se rechazó SIN escribir (p. ej. 403): libera fila, ID y teléfono. */
  liberar(idNumero: number): Promise<boolean>
  /** La fila reservada apareció ocupada por otra cosa: se descarta la reserva (su fila e ID no se reusan). */
  descartar(idNumero: number): Promise<boolean>
}

export const CLAVE_LOCK = '7261900101' // bigint fijo y propio de esta app para pg_advisory_xact_lock
export const TIMEOUTS = { lockMs: 8000, statementMs: 15000 } as const
export const TIMEOUT_RED_SHEETS_MS = 20000 // cada llamada a Sheets (lectura / escritura)
export const idDeNumero = (n: number): string => `R${String(n).padStart(3, '0')}`

const hmac = (secreto: string, etiqueta: string, valor: string) => createHmac('sha256', secreto).update(`${etiqueta}\u0000${valor}`).digest('hex')

const COLS = 'id_numero, fila, estado, huella, referidor, resultado'
const SQL = {
  lock: 'SELECT pg_advisory_xact_lock($1::bigint)',
  porClave: `SELECT ${COLS} FROM referidos_reservas WHERE actor_hash = $1 AND clave_hash = $2 AND estado <> 'descartada'`,
  porTelefono: `SELECT ${COLS} FROM referidos_reservas WHERE telefono_hash = $1 AND estado <> 'descartada'`,
  maximos: 'SELECT COALESCE(MAX(fila), 0) AS max_fila, COALESCE(MAX(id_numero), 0) AS max_id FROM referidos_reservas',
  insertar: "INSERT INTO referidos_reservas (id_numero, fila, telefono_hash, actor_hash, clave_hash, huella, referidor, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')",
  confirmar: "UPDATE referidos_reservas SET estado = 'confirmada', resultado = $2::jsonb, confirmado_en = now() WHERE id_numero = $1 AND estado = 'pendiente'",
  liberar: "DELETE FROM referidos_reservas WHERE id_numero = $1 AND estado = 'pendiente'",
  descartar: "UPDATE referidos_reservas SET estado = 'descartada' WHERE id_numero = $1 AND estado = 'pendiente'",
  estado: 'SELECT estado FROM referidos_reservas WHERE id_numero = $1',
} as const

const aReserva = (r: Record<string, unknown>): Reserva => ({
  idNumero: Number(r.id_numero), id: idDeNumero(Number(r.id_numero)), fila: Number(r.fila), estado: r.estado as EstadoReserva,
  referidor: String(r.referidor), resultado: (r.resultado as ResultadoGuardado | null) ?? null,
})

export function crearReservasPostgres(opciones: { conectar: () => Promise<ClienteDb>; secreto: string }): ReservasDurables {
  if (!opciones.secreto || opciones.secreto.length < 32) throw new Error('REFERIDOS_HMAC_SECRET inválido (mínimo 32 caracteres)')
  const secreto = opciones.secreto

  // Transacción CORTA en una conexión reservada; la escritura al Sheet nunca ocurre acá adentro.
  async function enTransaccion<T>(conLock: boolean, fn: (q: ClienteDb['query']) => Promise<T>): Promise<T> {
    const c = await opciones.conectar()
    let destruir = false
    try {
      await c.query('BEGIN')
      await c.query(`SET LOCAL lock_timeout = '${TIMEOUTS.lockMs}ms'`)
      await c.query(`SET LOCAL statement_timeout = '${TIMEOUTS.statementMs}ms'`)
      if (conLock) await c.query(SQL.lock, [CLAVE_LOCK])
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

  return {
    durable: true,
    reservar: p =>
      enTransaccion(true, async q => {
        const a = hmac(secreto, 'actor', p.actor.trim().toLowerCase())
        const k = hmac(secreto, 'clave', p.clave)
        const h = hmac(secreto, 'huella', p.huella)
        // Sin teléfono (o de relleno) no hay persona que proteger por número: un hash propio de este envío, que no choca con ningún otro
        const t = p.telefonoClave ? hmac(secreto, 'tel', p.telefonoClave) : hmac(secreto, 'sin-tel', `${p.actor.trim().toLowerCase()}|${p.clave}`)

        const porClave = (await q(SQL.porClave, [a, k])).rows[0]
        if (porClave) return porClave.huella === h ? ({ tipo: 'misma_clave', reserva: aReserva(porClave) } as SalidaReserva) : ({ tipo: 'conflicto_clave' } as SalidaReserva)

        const porTel = p.telefonoClave ? (await q(SQL.porTelefono, [t])).rows[0] : undefined
        if (porTel) return porTel.referidor === p.referidor ? ({ tipo: 'misma_persona', reserva: aReserva(porTel) } as SalidaReserva) : ({ tipo: 'conflicto_telefono' } as SalidaReserva)

        const m = (await q(SQL.maximos)).rows[0]
        const fila = Math.max(p.pisoFila, Number(m.max_fila) + 1)
        const idNumero = Math.max(p.pisoIdNumero + 1, Number(m.max_id) + 1)
        await q(SQL.insertar, [idNumero, fila, t, a, k, h, p.referidor])
        return { tipo: 'nueva', reserva: { idNumero, id: idDeNumero(idNumero), fila, estado: 'pendiente', referidor: p.referidor, resultado: null } } as SalidaReserva
      }),
    confirmar: (idNumero, resultado) =>
      enTransaccion(false, async q => {
        const r = await q(SQL.confirmar, [idNumero, JSON.stringify(resultado)])
        if ((r.rows as unknown[]).length || (r as { rowCount?: number }).rowCount) return true
        return (await q(SQL.estado, [idNumero])).rows[0]?.estado === 'confirmada'
      }),
    liberar: idNumero => enTransaccion(false, async q => ((await q(SQL.liberar, [idNumero])) as { rowCount?: number }).rowCount === 1),
    descartar: idNumero => enTransaccion(false, async q => ((await q(SQL.descartar, [idNumero])) as { rowCount?: number }).rowCount === 1),
  }
}

// ── Conexión desde el entorno (falla cerrado) ─────────────────────────────────────────────────────
export function urlDeBaseValida(url: string | undefined, entorno: { vercel: boolean; produccion: boolean }): string | null {
  if (!url) return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null
  if (!u.hostname || !u.pathname || u.pathname === '/') return null
  if ((entorno.vercel || entorno.produccion) && /^(localhost|127\.|\[?::1\]?$)/.test(u.hostname)) return null // una base local no coordina nada entre instancias
  return url
}

type PoolLike = { connect(): Promise<ClienteDb>; on(ev: string, f: () => void): unknown }
const g = globalThis as unknown as { __cjPoolReferidos?: PoolLike }

/** null si falta una DATABASE_URL apropiada o la llave REFERIDOS_HMAC_SECRET: sin eso no hay escritura real (queda la simulación). */
export function coordinadorDesdeEntorno(env: Record<string, string | undefined>, entorno: { vercel: boolean; produccion: boolean }): ReservasDurables | null {
  const url = urlDeBaseValida(env.DATABASE_URL, entorno)
  const secreto = env.REFERIDOS_HMAC_SECRET
  if (!url || !secreto || secreto.length < 32) return null
  return crearReservasPostgres({
    secreto,
    conectar: async () => {
      if (!g.__cjPoolReferidos) {
        const { Pool } = await import('pg') // cliente oficial node-postgres; pool chico (cada paso reserva 1 conexión por muy poco tiempo)
        const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true, application_name: 'cj-referidos' })
        pool.on('error', () => undefined) // un error de una conexión ociosa no tiene que tirar el proceso
        g.__cjPoolReferidos = pool as unknown as PoolLike
      }
      return g.__cjPoolReferidos.connect()
    },
  })
}
