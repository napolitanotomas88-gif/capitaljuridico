// ── Resumen de /finanzas: lectura de la APP de Finanzas (Neon, esquema finanzas) ─────────────────────────────────────
// Pedido de Tomás (1/11/2026): «pasa todo a la app». La pestaña Resumen dejaba de reflejar lo que se carga en la app
// (pagos, gastos y pagos al equipo), porque leía la planilla "Finanzas 2026". Desde hoy los lee de la misma base del
// Despacho (DATABASE_URL), de las vistas *_vigentes (ya con las correcciones aplicadas), y arma las MISMAS estructuras
// que salían de la planilla (Pago / Gasto / FilaPayroll de lib/finanzasCalc.ts): el cálculo no cambia.
//   · pagos           ← finanzas.pagos_vigentes + finanzas.pago_quien_recibio (cuenta que recibió):
//                       Tomi / Gero / Financiera tal cual, Empresa → Relay (la cuenta de la empresa en el cálculo),
//                       'Tomi y Gero' = efectivo dividido mitad y mitad (regla de Tomás), sin fila → 'sin dato' (y ahí
//                       los comprobantes de jul–sep, lib/finanzasCuentas.ts, quedan como respaldo).
//   · gastos          ← finanzas.gastos_vigentes (cuenta = "Banco / Cuenta" de la planilla; vacía = Relay, como antes).
//   · payroll (Staff) ← finanzas.pagos_equipo_vigentes, nombre canónico de finanzas.personas.
// Lee como el dueño de la base (sin `set role`): es solo servidor y solo lectura. Caché de 60 s + deduplicación de
// pedidos concurrentes + último valor bueno ante un error, igual que la lectura de la planilla en lib/finanzas.ts.
// La única escritura es la del cierre de mes (cargarEstimadoMetaEnApp): un gasto web firmado como el cierre.
// Solo servidor.
import { neon } from '@neondatabase/serverless'
import { categoriaGasto, categoriaPagoFin, mesDe, normPagador, type Cuenta, type DatosAppCalculo, type FilaPayroll, type Gasto, type Pago } from './finanzasCalc'

// ── Filas tal como salen de las consultas (fechas como texto 'YYYY-MM-DD' para no correr el día por zona horaria) ──
export interface FilaPagoApp {
  id: number; fecha: string; cliente: string | null; monto_usd: number | string | null
  closer: string | null; setter: string | null; concepto: string | null; fuente: string | null
  tipo_venta: string | null; tipo_pago: string | null; cat_cash: string | null
  comision: number | string | null; pesos_ars: number | string | null
  quien: string | null                 // finanzas.pago_quien_recibio.quien (null = sin asignar)
}
export interface FilaGastoApp {
  id: number; fecha: string; concepto: string | null; monto_usd: number | string | null
  tipo: string | null; cuenta: string | null; id_origen: string | null
}
export interface FilaEquipoApp {
  id: number; mes: string; nombre: string | null; puesto: string | null
  honorarios_base: number | string | null; bonuses: number | string | null; comision: number | string | null
  extras?: number | string | null
  total_usd: number | string | null; pagado: boolean | null; pagado_por: string | null
}

const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0 }
const txt = (v: unknown) => (v ?? '').toString().trim()
const r2 = (n: number) => Math.round(n * 100) / 100
const fechaOk = (f: unknown): f is string => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f)

// «Quién recibió» de la app → cuenta del cálculo. Empresa = la cuenta de la empresa (Relay en el cálculo y en la UI).
const CUENTA_APP: Record<string, Cuenta> = { Tomi: 'Tomi', Gero: 'Gero', Financiera: 'Financiera', Empresa: 'Relay' }

export function pagosDesdeApp(filas: FilaPagoApp[]): Pago[] {
  const pagos: Pago[] = []
  for (const r of filas) {
    if (!fechaOk(r.fecha) || r.monto_usd == null) continue
    const monto = num(r.monto_usd)
    const ars = num(r.pesos_ars)
    const quien = txt(r.quien)
    let cuenta: Cuenta = 'sin dato'
    let partes: Pago['partes'] = [{ cuenta, monto }]
    if (quien === 'Tomi y Gero') {
      // Regla de Tomás (1/11/2026): efectivo que recibieron los dos, mitad y mitad
      const mitad = r2(monto / 2)
      partes = [{ cuenta: 'Tomi', monto: mitad }, { cuenta: 'Gero', monto: r2(monto - mitad) }]
      cuenta = 'Tomi'
    } else if (CUENTA_APP[quien]) {
      cuenta = CUENTA_APP[quien]
      partes = [{ cuenta, monto }]
    }
    pagos.push({
      fila: r.id, ref: `Pago #${r.id}`, fecha: r.fecha, mes: mesDe(r.fecha),
      montoCelda: monto, monto, montoEsNumero: true,   // en la base el monto siempre es número
      ars: ars > 0 ? ars : null,
      cliente: txt(r.cliente),
      closerCelda: r.closer ?? '', setterCelda: r.setter ?? '', conceptoCelda: r.concepto ?? '', fuenteCelda: r.fuente ?? '',
      concepto: txt(r.concepto),
      categoria: categoriaPagoFin(txt(r.tipo_venta), txt(r.tipo_pago), txt(r.concepto), txt(r.cat_cash)),
      comisionPlataforma: num(r.comision),
      cuenta, cuentaTexto: quien, partes,
      fuenteCuenta: cuenta === 'sin dato' ? null : 'app',
    })
  }
  return pagos
}

export function gastosDesdeApp(filas: FilaGastoApp[]): Gasto[] {
  const lista: Gasto[] = []
  for (const r of filas) {
    if (!fechaOk(r.fecha)) continue
    const monto = num(r.monto_usd)
    if (!monto) continue
    const { cat, inferida } = categoriaGasto(r.tipo, r.concepto)
    const pagadoPorTexto = txt(r.cuenta)
    lista.push({
      fila: r.id, ref: `Gasto #${r.id}`, id: r.id, web: r.id_origen == null,
      fecha: r.fecha, mes: mesDe(r.fecha), concepto: txt(r.concepto), monto, montoOrigen: 'USD',
      tipoTexto: txt(r.tipo), cat, inferida,
      // Cuenta vacía = Relay: mismo criterio que la col F vacía de la planilla
      pagadoPorTexto, pagador: pagadoPorTexto ? normPagador(pagadoPorTexto) : 'Empresa',
    })
  }
  return lista
}

export function payrollDesdeApp(filas: FilaEquipoApp[]): Map<string, FilaPayroll[]> {
  const out = new Map<string, FilaPayroll[]>()
  for (const r of filas) {
    if (!/^\d{4}-\d{2}$/.test(r.mes ?? '')) continue
    const nombre = txt(r.nombre)
    if (!nombre) continue
    // Extras (lo que se paga aparte por hacer de más, 1/11/2026) cuentan como bonus: son sueldo, no comisión
    const base = num(r.honorarios_base), bonus = num(r.bonuses) + num(r.extras), comision = num(r.comision)
    let total = base + bonus + comision
    if (!total) total = num(r.total_usd)
    const pagadoPorTexto = txt(r.pagado_por)   // Financiera / Tomi / Gero / Otro (Financiera = empresa, regla del 3/10)
    const fila: FilaPayroll = {
      fila: r.id, ref: `Pago al equipo #${r.id}`, nombre, puesto: txt(r.puesto), base, bonus, comision, total,
      pagado: r.pagado === true, pagadoPorTexto, pagador: normPagador(pagadoPorTexto),
    }
    const lista = out.get(r.mes) ?? []
    lista.push(fila)
    out.set(r.mes, lista)
  }
  return out
}

// ── Lectura ──
export type EjecutarApp = (consultas: { texto: string; params: unknown[] }[]) => Promise<unknown[][]>

export const CONSULTAS_APP = {
  pagos: `select p.id, p.fecha::text as fecha, p.cliente, p.monto_usd::float8 as monto_usd, p.closer, p.setter, p.concepto, p.fuente,
      p.tipo_venta, p.tipo_pago, p.cat_cash, p.comision::float8 as comision, p.pesos_ars::float8 as pesos_ars, q.quien
    from finanzas.pagos_vigentes p left join finanzas.pago_quien_recibio q on q.pago_id = p.id order by p.fecha, p.id`,
  gastos: `select id, fecha::text as fecha, concepto, monto_usd::float8 as monto_usd, tipo, cuenta, id_origen
    from finanzas.gastos_vigentes order by fecha, id`,
  equipo: `select e.id, to_char(e.mes, 'YYYY-MM') as mes, coalesce(nullif(btrim(pe.nombre), ''), e.nombre_original) as nombre, e.puesto,
      e.honorarios_base::float8 as honorarios_base, e.bonuses::float8 as bonuses, e.comision::float8 as comision, e.extras::float8 as extras,
      e.total_usd::float8 as total_usd, e.pagado, e.pagado_por
    from finanzas.pagos_equipo_vigentes e left join finanzas.personas pe on pe.id = e.persona_id order by e.mes, e.id`,
}

const ejecutarNeon: EjecutarApp = async (consultas) => {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('Falta DATABASE_URL')
  const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(20_000) } })
  return (await sql.transaction(consultas.map(c => sql.query(c.texto, c.params)))) as unknown[][]
}

/** Lee pagos, gastos y payroll de la app en UNA transacción (foto consistente). Sin caché: la usa leerApp. */
export async function leerAppSinCache(ejecutar: EjecutarApp = ejecutarNeon): Promise<DatosAppCalculo> {
  const [pagos, gastos, equipo] = await ejecutar([
    { texto: CONSULTAS_APP.pagos, params: [] },
    { texto: CONSULTAS_APP.gastos, params: [] },
    { texto: CONSULTAS_APP.equipo, params: [] },
  ])
  return {
    pagos: pagosDesdeApp(pagos as FilaPagoApp[]),
    gastos: gastosDesdeApp(gastos as FilaGastoApp[]),
    payroll: payrollDesdeApp(equipo as FilaEquipoApp[]),
  }
}

let appCache: { at: number; data: DatosAppCalculo; avisos: string[] } | null = null
let appEnVuelo: Promise<{ data: DatosAppCalculo; avisos: string[] }> | null = null
let appUltimoBueno: DatosAppCalculo | null = null

/** Con caché de 60 s, deduplicación y último valor bueno. Tira error solo si nunca se pudo leer (→ respaldo planilla). */
export async function leerApp(ejecutar: EjecutarApp = ejecutarNeon): Promise<{ data: DatosAppCalculo; avisos: string[] }> {
  if (appCache && Date.now() - appCache.at < 60_000) return appCache
  if (appEnVuelo) return appEnVuelo
  appEnVuelo = (async () => {
    try {
      const data = await leerAppSinCache(ejecutar)
      appUltimoBueno = data
      return { data, avisos: [] }
    } catch (e) {
      const msg = ((e as Error).message ?? 'error').slice(0, 120)
      if (!appUltimoBueno) throw e
      console.error(`Finanzas: falló la lectura de la app (${msg}) → uso el último valor bueno`)
      return { data: appUltimoBueno, avisos: ['No se pudo leer la app de Finanzas: se muestran los últimos datos leídos.'] }
    }
  })()
    .then(r => { appCache = { at: Date.now(), ...r }; return r })
    .finally(() => { appEnVuelo = null })
  return appEnVuelo
}

/** Descarta el caché (después de escribir, para que /finanzas lo vea enseguida). También para las pruebas. */
export function olvidarCacheApp(todo = false) {
  appCache = null
  if (todo) appUltimoBueno = null
}

// ── Escritura del cierre de mes (solo /api/finanzas-cierre) ──
// Pedido de Tomás (1/11/2026): el estimado de Meta que el cierre carga en la planilla también va a la app, como gasto
// web (id_origen null), sin duplicar (misma fecha + concepto + monto) y firmado como el cierre en request.jwt.claims
// (en la misma transacción: set_config(..., true) vale solo para ella).
export const FIRMA_CIERRE = { email: 'cierre@finanzas.despacho' }

export type CambioEstimadoApp =
  | { accion: 'agregar'; fecha: string; concepto: string; monto: number }
  | { accion: 'actualizar'; id: number; monto: number }

export function consultasEstimadoApp(c: CambioEstimadoApp): { texto: string; params: unknown[] }[] {
  const firma = { texto: "select set_config('request.jwt.claims', $1, true)", params: [JSON.stringify(FIRMA_CIERRE)] }
  if (c.accion === 'agregar') return [firma, {
    texto: `insert into finanzas.gastos (fecha, concepto, monto_usd, tipo)
      select $1::date, $2::text, $3::numeric, 'Anuncios'
      where not exists (select 1 from finanzas.gastos where fecha = $1::date and concepto = $2::text and monto_usd = $3::numeric)
      returning id`,
    params: [c.fecha, c.concepto, c.monto],
  }]
  // Solo filas web (las importadas no se pueden modificar: el trigger proteger_importadas lo impediría igual)
  return [firma, {
    texto: 'update finanzas.gastos set monto_usd = $2::numeric where id = $1 and id_origen is null returning id',
    params: [c.id, c.monto],
  }]
}

export async function cargarEstimadoMetaEnApp(c: CambioEstimadoApp, ejecutar: EjecutarApp = ejecutarNeon): Promise<{ id: number | null; duplicado: boolean }> {
  const res = await ejecutar(consultasEstimadoApp(c))
  const fila = (res.at(-1) as { id?: number | string }[] | undefined)?.[0]
  olvidarCacheApp()
  if (!fila?.id) {
    if (c.accion === 'actualizar') throw new Error(`no se encontró el gasto web #${c.id} para actualizar`)
    return { id: null, duplicado: true }
  }
  return { id: Number(fila.id), duplicado: false }
}
