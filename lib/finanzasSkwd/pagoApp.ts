// ── Pago del bot → app de Finanzas (Neon, finanzas.pagos + finanzas.pago_quien_recibio) ────────────────────────────────
// Pedido de Tomás (1/11/2026): «claro así es» — los pagos que carga el bot (y la tarjeta del cliente) van también a la
// app. La planilla sigue siendo la que manda en el Registro de Pagos; esto es una copia: corre DESPUÉS de que la fila
// quedó verificada en la planilla (finanzasEscribir.ts) y, si falla, el pago queda cargado igual y se avisa.
//   · Fila web (id_origen null): editable desde la app, como las que cargó la conciliación del 1/11.
//   · Sin duplicados: si ya hay un pago con la misma fecha, cliente y monto, no se carga otro.
//   · Quién recibió: el que dedujo el bot (filaRegistroPagos → quienRecibio); sin dato, queda "Sin asignar".
//   · Una sola sentencia (CTE) dentro de una transacción con el correo del bot en request.jwt.claims: los disparadores
//     firman creado_por con ese correo.
// Solo servidor.
import { neon } from '@neondatabase/serverless'
import { serialAYmd } from '../clientes/fechas'
import type { FilaRegistroPagos } from '../bot/alta/finanzas'

export const CORREO_BOT = 'bot-alta@finanzas.despacho'

export interface PagoApp {
  fecha: string; cliente: string; telefono: string | null; monto_usd: number; pesos_ars: number | null; moneda_original: 'USD' | 'ARS'
  programa: string | null; closer: string | null; setter: string | null; concepto: string | null; fuente: string | null
  tipo_venta: string | null; tipo_pago: string | null; comprobante: string | null; comision: number
}

const texto = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : texto(v) !== null && Number.isFinite(Number(v)) ? Number(v) : null)

/** La fila del Registro (A..R) como pago de la app. null si falta fecha, cliente o monto. Pura. */
export function pagoDesdeFila(fila: FilaRegistroPagos, nombreArchivo: string | null = null): PagoApp | null {
  const c = fila.celdas
  const fecha = typeof c.A === 'number' ? serialAYmd(c.A) : texto(c.A)
  const cliente = texto(c.C)
  const monto = numero(c.E)
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !cliente || monto === null) return null
  const pesos = numero(c.F)
  return {
    fecha, cliente, telefono: texto(c.D), monto_usd: monto, pesos_ars: pesos, moneda_original: pesos ? 'ARS' : 'USD',
    programa: texto(c.B), closer: texto(c.G), setter: texto(c.H), concepto: texto(c.J), fuente: texto(c.K),
    tipo_venta: texto(c.N), tipo_pago: texto(c.O), comprobante: nombreArchivo ?? texto(c.I), comision: numero(c.L) ?? 0,
  }
}

const COLS = ['fecha', 'cliente', 'telefono', 'monto_usd', 'pesos_ars', 'moneda_original', 'programa', 'closer', 'setter', 'concepto',
  'fuente', 'tipo_venta', 'tipo_pago', 'comprobante', 'comision'] as const

/** Sentencia única: inserta el pago si no está y su "quién recibió". Devuelve { id, nuevo }. Exportada para los tests. */
export function consultaPagoApp(pago: PagoApp, quien: string | null): { texto: string; params: unknown[] } {
  const texto = `with datos as (select * from json_populate_record(null::finanzas.pagos, $1::json)),
ya as (select p.id from finanzas.pagos p, datos d where p.fecha = d.fecha and lower(btrim(p.cliente)) = lower(btrim(d.cliente)) and p.monto_usd = d.monto_usd limit 1),
nuevo as (insert into finanzas.pagos (${COLS.join(', ')}, mes)
  select ${COLS.map((c) => `d.${c}`).join(', ')}, finanzas.mes_en_texto(d.fecha) from datos d where not exists (select 1 from ya) returning id),
q as (insert into finanzas.pago_quien_recibio (pago_id, quien) select id, $2 from nuevo where $2::text is not null returning pago_id)
select coalesce((select id from nuevo), (select id from ya))::text as id, exists (select 1 from nuevo) as nuevo, (select count(*) from q)::int as quien`
  return { texto, params: [JSON.stringify(pago), quien] }
}

export interface ResultadoPagoApp { ok: boolean; id: number | null; nuevo: boolean; motivo: string | null }
type Ejecutar = (consultas: { texto: string; params: unknown[] }[]) => Promise<unknown[][]>

const ejecutarNeon = (url: string): Ejecutar => async (consultas) => {
  const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(15_000) } })
  return (await sql.transaction(consultas.map((c) => sql.query(c.texto, c.params)))) as unknown[][]
}

/** Copia el pago a la app. Sin DATABASE_URL no hace nada (ok: false, motivo). Nunca tira. */
export async function guardarPagoEnApp(fila: FilaRegistroPagos, nombreArchivo: string | null, ejecutar?: Ejecutar): Promise<ResultadoPagoApp> {
  const pago = pagoDesdeFila(fila, nombreArchivo)
  if (!pago) return { ok: false, id: null, nuevo: false, motivo: 'faltan fecha, cliente o monto' }
  const url = process.env.DATABASE_URL?.trim()
  const correr = ejecutar ?? (url ? ejecutarNeon(url) : null)
  if (!correr) return { ok: false, id: null, nuevo: false, motivo: 'falta DATABASE_URL' }
  try {
    const res = await correr([
      { texto: "select set_config('request.jwt.claims', $1, true)", params: [JSON.stringify({ email: CORREO_BOT })] },
      consultaPagoApp(pago, fila.quienRecibio ?? null),
    ])
    const r = res.at(-1)?.[0] as { id: string | null; nuevo: boolean } | undefined
    return { ok: !!r?.id, id: r?.id ? Number(r.id) : null, nuevo: !!r?.nuevo, motivo: r?.id ? null : 'la base no devolvió el pago' }
  } catch (e) {
    return { ok: false, id: null, nuevo: false, motivo: String((e as Error)?.message ?? e).slice(0, 200) }
  }
}
