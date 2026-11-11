// ── Controles de cumplimiento: la corrida diaria y el resumen de los lunes (11/11/2026). Solo servidor ────────────────────
// correrControles(deps): por cada cliente activo de cj_controles_cliente, a las 10:00 (Argentina):
//   1. Meta del día anterior (cuenta, entrega, pago y gasto convertido a USD).
//   2. Entregas: guiones sin revisar y guiones sin crudos nuevos.
//   3. Capturas: días con campaña activa (gasto > 0) sin archivos nuevos en «Capturas» (la crea si no existe).
// Cada incumplimiento nuevo: fila en cj_controles_incumplimientos + aviso «para enviar» (j01, cj_canal_mensajes) + UNA alerta
// en #🛠️-operaciones (mención a Gero M) con el texto para pegar y el link al Despacho. Nada se le manda al cliente.
// correrResumenSemanal(deps): el lunes, una alerta por cliente con la semana cerrada (lunes a domingo).
// Todo entra por DepsControles (los tests usan dependencias de juguete; depsReales() usa Neon, Meta y Drive).
import type { Alerta, ResultadoAlerta } from '@/lib/alertas'
import { sumarDias } from '@/lib/anuncios/formato'
import {
  claveIncumplimiento, diasActivos, evaluarCapturas, evaluarEntregas, evaluarMeta, hayCapturas, lineasResumen, semanaAnterior, textoAviso, ymdAR,
  type ConfigControles, type CuentaControl, type Incumplimiento, type TandaControl, type Ymd,
} from './reglas'

export const NOMBRE_CARPETA_CAPTURAS = 'Capturas'
/** Días hacia atrás que revisa el control de capturas (se repite sin duplicar: si un cron falla, el siguiente lo recupera). */
export const VENTANA_CAPTURAS_DIAS = 7

export interface DepsControles {
  ahora: () => Date
  configs(): Promise<ConfigControles[]>
  pausado(idCrm: string): Promise<boolean>
  cuenta(cuentaMeta: string): Promise<CuentaControl | null>
  /** Gasto por día (en la moneda de la cuenta) entre dos fechas. null = Meta no respondió. */
  gastos(cuentaMeta: string, desde: Ymd, hasta: Ymd): Promise<Record<Ymd, number> | null>
  /** Unidades de la moneda por 1 USD (USD = 1). null = sin cotización. */
  usdPor(moneda: string): Promise<number | null>
  erroresPago: readonly number[]
  tandas(idCrm: string): Promise<TandaControl[]>
  crudos(idCrm: string, desdeIso: string): Promise<{ creado: string }[]>
  /** La carpeta «Capturas» del cliente (la busca o la crea y la guarda). null = no hay carpeta del cliente. */
  carpetaCapturas(c: ConfigControles, crear: boolean): Promise<string | null>
  /** Archivos de la carpeta (y de sus subcarpetas directas) creados desde una fecha. null = Drive no respondió. */
  archivos(carpeta: string, desdeIso: string): Promise<{ creado: string }[] | null>
  registrar(i: Incumplimiento, clave: string, texto: string): Promise<{ nuevo: boolean; mensajeId: number | null }>
  anotarAlerta(clave: string, estado: string): Promise<void>
  incumplimientos(idCrm: string, desde: Ymd, hasta: Ymd): Promise<{ tipo: Incumplimiento['tipo']; fecha: Ymd; estado: string }[]>
  alertar(a: Alerta): Promise<ResultadoAlerta>
  log?: Pick<Console, 'warn' | 'error'>
}

export interface ResultadoCliente {
  idCrm: string
  incumplimientos: { clave: string; tipo: string; fecha: Ymd; nuevo: boolean; alerta?: string }[]
  avisos: string[]
  saltado?: string
}
export interface ResultadoControles { fecha: Ymd; dry: boolean; clientes: ResultadoCliente[] }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 160)

/** Link del historial del cliente en el Despacho. */
export const linkHistorial = (idCrm: string, mensajeId: number | null = null) => (mensajeId ? `/clientes/para-enviar#m-${mensajeId}` : `/clientes/controles?cliente=${idCrm}`)

async function controlarCliente(c: ConfigControles, d: DepsControles, ahora: Date, dry: boolean): Promise<ResultadoCliente> {
  const hoy = ymdAR(ahora)
  const ayer = sumarDias(hoy, -1)
  const res: ResultadoCliente = { idCrm: c.idCrm, incumplimientos: [], avisos: [] }
  if (await d.pausado(c.idCrm).catch(() => false)) { res.saltado = 'cliente en pausa en el Despacho'; return res }
  const incs: Incumplimiento[] = []

  // 1 y 3 comparten los gastos de Meta (también dicen qué días hubo campaña activa)
  let gastos: Record<Ymd, number> | null = null
  if (c.cuentaMeta) {
    const desde = [sumarDias(hoy, -VENTANA_CAPTURAS_DIAS), c.desde].sort().at(-1)!
    const [cuenta, gs] = await Promise.all([d.cuenta(c.cuentaMeta).catch(() => null), desde <= ayer ? d.gastos(c.cuentaMeta, desde, ayer).catch(() => null) : Promise.resolve({} as Record<Ymd, number>)])
    gastos = gs
    const usdPor = cuenta ? (cuenta.moneda === 'USD' ? 1 : await d.usdPor(cuenta.moneda).catch(() => null)) : null
    const m = evaluarMeta({ config: c, dia: ayer, cuenta, gasto: gs ? gs[ayer] ?? 0 : null, usdPor, erroresPago: d.erroresPago })
    res.avisos.push(...m.avisos)
    if (m.incumplimiento) incs.push(m.incumplimiento)
  } else res.avisos.push('Sin cuenta publicitaria configurada: no se controla Meta ni las capturas.')

  // 2. Entregas
  try {
    const tandas = await d.tandas(c.idCrm)
    const envios = tandas.map((t) => t.envio).filter((x): x is string => !!x).sort()
    const crudos = envios.length ? await d.crudos(c.idCrm, envios[0]) : []
    incs.push(...evaluarEntregas({ config: c, hoy, tandas, crudos }))
  } catch (e) { res.avisos.push(`Entregas: no se pudo leer (${motivo(e)})`) }

  // 3. Capturas
  if (gastos) {
    const dias = diasActivos(gastos).filter((x) => x <= ayer)
    try {
      const carpeta = await d.carpetaCapturas(c, !dry)
      if (!carpeta) res.avisos.push('No hay carpeta del cliente en Drive (configurá carpetaCliente o vinculala en Grabación): no se controlan las capturas.')
      else if (dias.length) {
        const archivos = await d.archivos(carpeta, new Date(Date.parse(`${dias[0]}T03:00:00Z`)).toISOString())
        if (!archivos) res.avisos.push('Drive no respondió: el control de capturas queda para mañana.')
        else incs.push(...evaluarCapturas({ config: c, ahora: ahora.getTime(), dias, archivos }))
      }
    } catch (e) { res.avisos.push(`Capturas: ${motivo(e)}`) }
  }

  for (const i of incs) {
    const clave = claveIncumplimiento(i)
    const texto = textoAviso(i, c, hoy)
    if (dry) { res.incumplimientos.push({ clave, tipo: i.tipo, fecha: i.fecha, nuevo: true }); continue }
    const r = await d.registrar(i, clave, texto)
    const fila: ResultadoCliente['incumplimientos'][number] = { clave, tipo: i.tipo, fecha: i.fecha, nuevo: r.nuevo }
    if (r.nuevo) {
      const a = await d.alertar({
        canal: 'operaciones', tipo: `controles_${i.tipo}`, clave: `controles:${clave}`, idCrm: c.idCrm, emoji: '⚠️',
        titulo: `Incumplimiento (cláusula ${i.clausula}): ${nombreCorto(i)}`, cliente: `${c.cliente} (${c.idCrm})`,
        lineas: [...i.lineas.slice(0, 4), 'Pegale el aviso en el grupo General y marcá «Enviado» en el Despacho.'],
        copiar: texto, link: linkHistorial(c.idCrm, r.mensajeId), menciones: ['gero_m'],
      })
      fila.alerta = a.estado
      await d.anotarAlerta(clave, a.estado).catch(() => undefined)
    }
    res.incumplimientos.push(fila)
  }
  return res
}

const nombreCorto = (i: Incumplimiento) => ({
  meta_pago: 'error de pago en Meta', meta_pausada: 'campaña sin entrega', meta_gasto_bajo: 'gasto por debajo del presupuesto',
  guiones_sin_revision: 'guiones sin revisar', crudos_sin_subir: 'sin crudos nuevos', capturas_faltantes: 'faltan las capturas',
} as const)[i.tipo]

/** La corrida diaria. Nunca tira por un cliente: lo que falla queda en sus avisos (y en 🧰 si hay avisos técnicos). */
export async function correrControles(d: DepsControles, op: { dry?: boolean } = {}): Promise<ResultadoControles> {
  const ahora = d.ahora()
  const dry = !!op.dry
  const out: ResultadoControles = { fecha: ymdAR(ahora), dry, clientes: [] }
  for (const c of await d.configs()) {
    let r: ResultadoCliente
    try { r = await controlarCliente(c, d, ahora, dry) } catch (e) { r = { idCrm: c.idCrm, incumplimientos: [], avisos: [`falló el control: ${motivo(e)}`] } }
    out.clientes.push(r)
    if (!dry && r.avisos.length) {
      await d.alertar({
        canal: 'sistema', tipo: 'controles_aviso', clave: `controles:aviso:${c.idCrm}:${out.fecha}`, idCrm: c.idCrm, emoji: '🧰',
        titulo: 'Controles de cumplimiento: algo no se pudo revisar', cliente: `${c.cliente} (${c.idCrm})`, lineas: r.avisos.slice(0, 6), link: linkHistorial(c.idCrm),
      }).catch(() => undefined)
    }
  }
  return out
}

/** El resumen de los lunes (semana cerrada, lunes a domingo). Una alerta por cliente en 🛠️. */
export async function correrResumenSemanal(d: DepsControles, op: { dry?: boolean } = {}): Promise<{ desde: Ymd; hasta: Ymd; clientes: { idCrm: string; lineas: string[]; alerta?: string }[] }> {
  const ahora = d.ahora()
  const { desde, hasta } = semanaAnterior(ymdAR(ahora))
  const out: { idCrm: string; lineas: string[]; alerta?: string }[] = []
  for (const c of await d.configs()) {
    const ini = [desde, c.desde].sort().at(-1)!
    let gastos: Record<Ymd, number> | null = null, gastoUsd: number | null = null, conCapturas: number | null = null
    if (c.cuentaMeta && ini <= hasta) {
      const [cuenta, gs] = await Promise.all([d.cuenta(c.cuentaMeta).catch(() => null), d.gastos(c.cuentaMeta, ini, hasta).catch(() => null)])
      gastos = gs
      if (gs && cuenta) {
        const total = Object.values(gs).reduce((a, b) => a + b, 0)
        const por = cuenta.moneda === 'USD' ? 1 : await d.usdPor(cuenta.moneda).catch(() => null)
        gastoUsd = por ? total / por : null
      }
      if (gs) {
        try {
          const carpeta = await d.carpetaCapturas(c, false)
          const archivos = carpeta ? await d.archivos(carpeta, new Date(Date.parse(`${ini}T03:00:00Z`)).toISOString()) : null
          if (archivos) conCapturas = diasActivos(gs).filter((x) => hayCapturas(x, archivos, c.plazos.capturasHoras)).length
        } catch { conCapturas = null }
      }
    }
    const incs = await d.incumplimientos(c.idCrm, desde, hasta).catch(() => [])
    const lineas = lineasResumen({ config: c, desde: ini <= hasta ? ini : desde, hasta, incumplimientos: incs, gastos, gastoUsd, conCapturas })
    const fila: { idCrm: string; lineas: string[]; alerta?: string } = { idCrm: c.idCrm, lineas }
    if (!op.dry) {
      const a = await d.alertar({
        canal: 'operaciones', tipo: 'controles_semanal', clave: `controles:semanal:${c.idCrm}:${desde}`, idCrm: c.idCrm, emoji: '📋',
        titulo: `Controles de la semana ${desde.slice(8, 10)}/${desde.slice(5, 7)} al ${hasta.slice(8, 10)}/${hasta.slice(5, 7)}`, cliente: `${c.cliente} (${c.idCrm})`,
        lineas, link: linkHistorial(c.idCrm), menciones: ['gero_m'],
      })
      fila.alerta = a.estado
    }
    out.push(fila)
  }
  return { desde, hasta, clientes: out }
}
