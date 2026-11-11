// ── Controles de cumplimiento: la corrida diaria y el resumen de los lunes (11/11/2026, contrato con garantía v4) ─────────
// correrControles(deps): por cada cliente activo de cj_controles_cliente, a las 10:00 (Argentina):
//   1. Meta del día anterior: error de pago / falta de fondos (aviso); pausa o sin entrega por otra causa y gasto diario bajo
//      (alerta interna).
//   2. Período Mensual recién cerrado: gasto del período por debajo del presupuesto (aviso).
//   3. Entregas (guiones sin revisar, sin crudos) y capturas: «a verificar» (el aviso sale solo con «Es incumplimiento»).
// Cada hallazgo nuevo según su modo (reglas.ts): aviso → fila + «para enviar» (j01) + alerta; a verificar → fila + alerta;
// interna → solo alerta. Todas en #🛠️-operaciones con mención a Gero M. Nada se le manda al cliente.
// correrResumenSemanal(deps): el lunes, una alerta por cliente con la semana cerrada y el acumulado del período en curso.
// Todo entra por DepsControles (los tests usan dependencias de juguete; reales.ts usa Neon, Meta y Drive).
import type { Alerta, ResultadoAlerta } from '@/lib/alertas'
import { sumarDias } from '@/lib/anuncios/formato'
import {
  claveIncumplimiento, diasActivos, dm, esperadoPeriodo, evaluarCapturas, evaluarEntregas, evaluarMeta, evaluarPeriodo, hayCapturas,
  lineasResumen, modoDe, periodoDe, semanaAnterior, sumaEntre, textoAviso, ymdAR,
  type ConfigControles, type CuentaControl, type Hallazgo, type Modo, type TandaControl, type TipoHallazgo, type Ymd,
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
  /** Registra un hallazgo de modo 'aviso' (con su «para enviar») o 'verificar' (sin aviso). nuevo=false si ya estaba. */
  registrar(h: Hallazgo, clave: string, texto: string, modo: Exclude<Modo, 'interna'>): Promise<{ nuevo: boolean; mensajeId: number | null }>
  anotarAlerta(clave: string, estado: string): Promise<void>
  incumplimientos(idCrm: string, desde: Ymd, hasta: Ymd): Promise<{ tipo: TipoHallazgo; fecha: Ymd; estado: string }[]>
  alertar(a: Alerta): Promise<ResultadoAlerta>
  log?: Pick<Console, 'warn' | 'error'>
}

export interface ResultadoCliente {
  idCrm: string
  hallazgos: { clave: string; tipo: string; modo: Modo; fecha: Ymd; nuevo: boolean; alerta?: string }[]
  avisos: string[]
  saltado?: string
}
export interface ResultadoControles { fecha: Ymd; dry: boolean; clientes: ResultadoCliente[] }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 160)

/** Link del historial del cliente en el Despacho (o del aviso, si ya está «para enviar»). */
export const linkHistorial = (idCrm: string, mensajeId: number | null = null) => (mensajeId ? `/clientes/para-enviar#m-${mensajeId}` : `/clientes/controles?cliente=${idCrm}`)

const NOMBRE_CORTO: Record<TipoHallazgo, string> = {
  meta_pago: 'pausa por error de pago o falta de fondos', periodo_gasto: 'presupuesto del período no invertido', guiones_sin_revision: 'guiones sin revisar',
  crudos_sin_subir: 'sin crudos nuevos', capturas_faltantes: 'faltan las capturas del día', meta_pausada: 'campaña en pausa o sin entrega', meta_gasto_bajo: 'gasto diario bajo',
}

function alertaDe(h: Hallazgo, c: ConfigControles, modo: Modo, clave: string, texto: string, mensajeId: number | null): Alerta {
  const cliente = `${c.cliente} (${c.idCrm})`
  const base = { canal: 'operaciones' as const, tipo: `controles_${h.tipo}`, clave: `controles:${clave}`, idCrm: c.idCrm, cliente, menciones: ['gero_m' as const] }
  if (modo === 'aviso') return { ...base, emoji: '⚠️', titulo: `Incumplimiento (cláusula ${h.clausula}): ${NOMBRE_CORTO[h.tipo]}`, lineas: [...h.lineas.slice(0, 4), 'Pegale el aviso en el grupo General y marcá «Enviado» en el Despacho.'], copiar: texto, link: linkHistorial(c.idCrm, mensajeId) }
  if (modo === 'verificar') return { ...base, emoji: '🔎', titulo: `A verificar (cláusula ${h.clausula}): ${NOMBRE_CORTO[h.tipo]}`, lineas: [...h.lineas.slice(0, 4), 'Si es incumplimiento, tocá «Es incumplimiento» en el Despacho y se arma el aviso; si no, «No corresponde».'], link: linkHistorial(c.idCrm) }
  return { ...base, emoji: 'ℹ️', titulo: `Alerta interna: ${NOMBRE_CORTO[h.tipo]} (no es incumplimiento del cliente)`, lineas: h.lineas.slice(0, 5), link: linkHistorial(c.idCrm) }
}

async function controlarCliente(c: ConfigControles, d: DepsControles, ahora: Date, dry: boolean): Promise<ResultadoCliente> {
  const hoy = ymdAR(ahora)
  const ayer = sumarDias(hoy, -1)
  const res: ResultadoCliente = { idCrm: c.idCrm, hallazgos: [], avisos: [] }
  if (await d.pausado(c.idCrm).catch(() => false)) { res.saltado = 'cliente en pausa en el Despacho'; return res }
  const hs: Hallazgo[] = []

  // 1, 2 y 3 comparten los gastos de Meta (también dicen qué días hubo campaña activa)
  let gastos: Record<Ymd, number> | null = null
  if (c.cuentaMeta) {
    // Si ayer cerró un Período Mensual, se lee el período entero; si no, la ventana de capturas
    const per = periodoDe(c, ayer)
    const cierra = per && per.fin === ayer ? per : null
    const desde = [sumarDias(hoy, -VENTANA_CAPTURAS_DIAS), c.desde].sort().at(-1)!
    const desdeLectura = cierra && cierra.inicio < desde ? cierra.inicio : desde
    const [cuenta, gs] = await Promise.all([d.cuenta(c.cuentaMeta).catch(() => null), desdeLectura <= ayer ? d.gastos(c.cuentaMeta, desdeLectura, ayer).catch(() => null) : Promise.resolve({} as Record<Ymd, number>)])
    gastos = gs
    const usdPor = cuenta ? (cuenta.moneda === 'USD' ? 1 : await d.usdPor(cuenta.moneda).catch(() => null)) : null
    const m = evaluarMeta({ config: c, dia: ayer, cuenta, gasto: gs ? gs[ayer] ?? 0 : null, usdPor, erroresPago: d.erroresPago })
    res.avisos.push(...m.avisos)
    if (m.hallazgo) hs.push(m.hallazgo)
    if (cierra) {
      if (gs && cuenta) {
        const p = evaluarPeriodo({ config: c, periodo: cierra, gastos: gs, moneda: cuenta.moneda, usdPor })
        res.avisos.push(...p.avisos)
        if (p.hallazgo) hs.push(p.hallazgo)
      } else res.avisos.push(`Cerró el período ${cierra.numero} y Meta no respondió: el control de gasto del período queda pendiente (correr ?dry=1 para revisarlo).`)
    }
  } else res.avisos.push('Sin cuenta publicitaria configurada: no se controla Meta ni las capturas.')

  // Entregas
  try {
    const tandas = await d.tandas(c.idCrm)
    const envios = tandas.map((t) => t.envio).filter((x): x is string => !!x).sort()
    const crudos = envios.length ? await d.crudos(c.idCrm, envios[0]) : []
    hs.push(...evaluarEntregas({ config: c, hoy, tandas, crudos }))
  } catch (e) { res.avisos.push(`Entregas: no se pudo leer (${motivo(e)})`) }

  // Capturas
  if (gastos) {
    const ventana = sumarDias(hoy, -VENTANA_CAPTURAS_DIAS)
    const dias = diasActivos(gastos).filter((x) => x <= ayer && x >= ventana)
    try {
      const carpeta = await d.carpetaCapturas(c, !dry)
      if (!carpeta) res.avisos.push('No hay carpeta del cliente en Drive (configurá carpetaCliente o vinculala en Grabación): no se controlan las capturas.')
      else if (dias.length) {
        const archivos = await d.archivos(carpeta, new Date(Date.parse(`${dias[0]}T03:00:00Z`)).toISOString())
        if (!archivos) res.avisos.push('Drive no respondió: el control de capturas queda para mañana.')
        else hs.push(...evaluarCapturas({ config: c, ahora: ahora.getTime(), dias, archivos }))
      }
    } catch (e) { res.avisos.push(`Capturas: ${motivo(e)}`) }
  }

  for (const h of hs) {
    const modo = modoDe(h)
    const clave = claveIncumplimiento(h)
    if (dry) { res.hallazgos.push({ clave, tipo: h.tipo, modo, fecha: h.fecha, nuevo: true }); continue }
    if (modo === 'interna') {
      const a = await d.alertar(alertaDe(h, c, modo, clave, '', null))
      res.hallazgos.push({ clave, tipo: h.tipo, modo, fecha: h.fecha, nuevo: a.estado !== 'ya_estaba', alerta: a.estado })
      continue
    }
    const texto = textoAviso(h, c, hoy)
    const r = await d.registrar(h, clave, texto, modo)
    const fila: ResultadoCliente['hallazgos'][number] = { clave, tipo: h.tipo, modo, fecha: h.fecha, nuevo: r.nuevo }
    if (r.nuevo) {
      const a = await d.alertar(alertaDe(h, c, modo, clave, texto, r.mensajeId))
      fila.alerta = a.estado
      await d.anotarAlerta(clave, a.estado).catch(() => undefined)
    }
    res.hallazgos.push(fila)
  }
  return res
}

/** La corrida diaria. Nunca tira por un cliente: lo que falla queda en sus avisos (y en 🧰). */
export async function correrControles(d: DepsControles, op: { dry?: boolean } = {}): Promise<ResultadoControles> {
  const ahora = d.ahora()
  const dry = !!op.dry
  const out: ResultadoControles = { fecha: ymdAR(ahora), dry, clientes: [] }
  for (const c of await d.configs()) {
    let r: ResultadoCliente
    try { r = await controlarCliente(c, d, ahora, dry) } catch (e) { r = { idCrm: c.idCrm, hallazgos: [], avisos: [`falló el control: ${motivo(e)}`] } }
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

/** El resumen de los lunes (semana cerrada, lunes a domingo, y el Período Mensual en curso). Una alerta por cliente en 🛠️. */
export async function correrResumenSemanal(d: DepsControles, op: { dry?: boolean } = {}): Promise<{ desde: Ymd; hasta: Ymd; clientes: { idCrm: string; lineas: string[]; alerta?: string }[] }> {
  const ahora = d.ahora()
  const { desde, hasta } = semanaAnterior(ymdAR(ahora))
  const out: { idCrm: string; lineas: string[]; alerta?: string }[] = []
  for (const c of await d.configs()) {
    const ini = [desde, c.desde].sort().at(-1)!
    const per = periodoDe(c, hasta)
    let semana: Record<Ymd, number> | null = null, conCapturas: number | null = null
    let periodo: Parameters<typeof lineasResumen>[0]['periodo'] = null
    if (c.cuentaMeta && ini <= hasta) {
      const lectura = per && per.inicio < ini ? per.inicio : ini
      const [cuenta, gs] = await Promise.all([d.cuenta(c.cuentaMeta).catch(() => null), d.gastos(c.cuentaMeta, lectura, hasta).catch(() => null)])
      if (gs) {
        semana = Object.fromEntries(Object.entries(gs).filter(([x]) => x >= ini && x <= hasta))
        try {
          const carpeta = await d.carpetaCapturas(c, false)
          const archivos = carpeta ? await d.archivos(carpeta, new Date(Date.parse(`${ini}T03:00:00Z`)).toISOString()) : null
          if (archivos) conCapturas = diasActivos(semana).filter((x) => hayCapturas(x, archivos, c.plazos.capturasHoras)).length
        } catch { conCapturas = null }
      }
      if (per) {
        let gastoUsd: number | null = null, esperado: number | null = null
        if (gs && cuenta) {
          const por = cuenta.moneda === 'USD' ? 1 : await d.usdPor(cuenta.moneda).catch(() => null)
          const esp = esperadoPeriodo(c, per, hasta, gs)
          esperado = esp?.esperado ?? null
          gastoUsd = por ? sumaEntre(gs, per.inicio, hasta) / por : null
        }
        periodo = { ...per, hasta, gastoUsd, esperado }
      }
    }
    const incs = await d.incumplimientos(c.idCrm, desde, hasta).catch(() => [])
    const lineas = lineasResumen({ config: c, desde: ini <= hasta ? ini : desde, hasta, incumplimientos: incs, gastos: semana, periodo, conCapturas })
    const fila: { idCrm: string; lineas: string[]; alerta?: string } = { idCrm: c.idCrm, lineas }
    if (!op.dry) {
      const a = await d.alertar({
        canal: 'operaciones', tipo: 'controles_semanal', clave: `controles:semanal:${c.idCrm}:${desde}`, idCrm: c.idCrm, emoji: '📋',
        titulo: `Controles de la semana ${dm(desde)} al ${dm(hasta)}`, cliente: `${c.cliente} (${c.idCrm})`, lineas, link: linkHistorial(c.idCrm), menciones: ['gero_m'],
      })
      fila.alerta = a.estado
    }
    out.push(fila)
  }
  return { desde, hasta, clientes: out }
}
