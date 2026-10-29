// ── Arma el tablero de anuncios: junta Meta + CRM + guiones y aplica las reglas ──────────────
// Plazos de refresco de cada fuente (la pantalla consulta cada 15 s, pero esto manda):
//   · estado / pago / saldo de las cuentas (Meta) ........ cada 2,5 min
//   · insights diarios (gasto y mensajes, 35 días) ........ cada 12 min
//   · CRM y sheet de guiones (Google Sheets) .............. cada 5 min
//   · qué cuentas existen (descubrimiento) ................ cada 30 min
//   · salud del token (/debug_token) ...................... cada 1 h
//   · fichas de kickoff (Neon, "Por lanzar") .............. cada 5 min, se espera hasta 3 s; tras una falla, 1 min sin consultar (kickoffs.ts)
// Todo pasa por conCache (cache.ts): Data Cache compartido de Vercel + memoria de 15 s.
import { createHash } from 'node:crypto'
import { conCache } from './cache'
import { cargarCuentas, esCuentaPropia, sinAct } from './cuentas'
import { crearCruce, normTxt, type Guiones } from './cruce'
import { diasEntre, hoyAR, haceTiempo, sumarDias } from './formato'
import { descubrirCuentas, leerCuentas, leerEntradasErrorPago, leerInsights, leerLanzamientos, type Lanzamiento, type CuentaDescubierta, type CuentaMeta, type InsightsCuentas, type ResultadoCuentas } from './meta'
import { analizarCuenta, DIAS_VENTANA, MOTIVOS_RENDIMIENTO, type Analisis, type Semaforo, type TipoMotivo } from './reglas'
import { leerSheets, type DatosSheets } from './sheets'
import { detectarDiasMeta, type DiaMeta } from './diasMalos'
import { dolarHoy, monedasPorUSD, type DolarHoy } from './dolar'
import { clasificarRama, crearCruceRamas, leerTareasClickUp, NOMBRE_RAMA, umbralDe, type Rama } from './ramas'
import { leerPresupuestosPrivados } from '../configPrivada'
import { evaluarPresupuesto, type Presupuesto } from './presupuestos'
import { leerOptimizaciones, etapaOptimizacion, fechaUltimaRevision, requiereRevision } from './optimizaciones'
import { saludTokens, type EstadoToken } from './token'
import { avisoLecturaFichas, crearLecturaConPausa, ESPERA_KICKOFFS_MS, leerFichasKickoff, PAUSA_KICKOFFS_MS, QUE_KICKOFFS } from './kickoffs'
import { carpetasDrive } from '@/lib/clientes/drive'
import { filtrarConEditados, type EditadosPorLanzar } from './editadosPorLanzar'
import { avisosFichasSueltas, cruzarKickoffs, cuentasDelCliente, opcionesCruceTablero, tokensNombre, type ConKickoff, type CuentaPorLanzar } from './porLanzar'

export const DIAS_LANZAMIENTO = 10
export const REFRESCO = { lanzamientosSeg: 900, clickupSeg: 3600, cuentasSeg: 150, insightsSeg: 720, sheetsSeg: 300, descubrimientoSeg: 1800, tokenSeg: 3600, dolarSeg: 1800, monedasSeg: 21600, kickoffsSeg: 300, pantallaSeg: 15 }

export interface FilaAnuncio extends Analisis {
  presupuesto: Presupuesto
  id: string
  idNum: string
  cliente: string
  clienteCRM: string | null
  cuenta: string
  negocio: { id: string; nombre: string } | null
  moneda: string
  links: { ads: string; portfolio: string | null }
  extra: boolean                 // no estaba en la lista base: la sumó el CRM
  pausado: boolean
  guiones: Guiones
  sinDatosCuenta: boolean        // Meta no devolvió la cuenta (permisos / límite)
  estadoSemanal: Pick<Analisis, 'semaforo' | 'motivos' | 'frase' | 'prioridad'> & { nivel: Analisis['cpl']['nivel'] }
  previo: { semaforo: Semaforo; rendimiento: TipoMotivo[]; aGrabar: boolean }   // evaluación "como si fuera ayer" (alerta diaria)
  rama: { id: Rama; nombre: string; fuente: 'clickup' | 'manual' | 'cuenta'; tarea: string | null; umbral: { ok: number; medio: number } } | null
  clickup: { nombre: string; url: string; sinTopicos: boolean } | null
  // Campañas con anuncios nuevos de los últimos 10 días (azul). dia 1 = el día del lanzamiento; al día 4 toca revisión
  lanzamientos: (Lanzamiento & { dia: number; cplUSD: number | null; link: string; fechaOptimizacion: string | null; etapa: 'competencia' | 'ganador' | null; diasCompetencia: number; pendienteRevision: boolean; diasDesdeRevision: number; fechaRevision: string | null })[]
  revisarDia4: boolean           // alguna campaña está en el día 4 o 5 (revisión pendiente)   // tarea de "Seguimiento de Anuncios"
  usdPor: number | null          // unidades de su moneda por 1 USD (USD = 1 · ARS = dólar MEP venta · otras = cotización del día)
}

export interface PorLanzar extends ConKickoff {
  cliente: string                // nombre en el CRM
  etapa: string | null           // estado de la tarea en ClickUp (Seguimiento de Anuncios): coming soon, creada, aprobada… (dato secundario mientras conviva con la ficha)
  clickup: { nombre: string; url: string } | null
  editados?: EditadosPorLanzar | null   // su carpeta «Editados - X» (editadosPorLanzar.ts); null = no se encontró o Drive no respondió
  acceso: 'si' | 'no'            // sí = el token ve su cuenta de Meta: la de su ficha de kickoff si la trae (o ya gasta con otro nombre); si no, una que se parece por el nombre
  cuentas: CuentaPorLanzar[]     // las visibles, con cómo llegó cada una (la de la ficha, primera)
  // kickoff: la última ficha de kickoff "lista" del cliente · sinFicha: se leyó la base y no tiene · cuentaFicha, confirmar y
  // grupo: lo que pasa con la cuenta de la ficha, si hay que confirmar que es de este cliente y en qué grupo va (porLanzar.ts)
}

export interface Tablero {
  generado: string
  hoy: string
  actualizado: { cuentas: string | null; insights: string | null; sheets: string | null }
  refresco: typeof REFRESCO
  token: EstadoToken | null
  avisos: string[]
  diasMeta: DiaMeta[]            // días completos de las últimas 3 semanas, con "malo" = día malo de Meta
  resumen: { porLanzar: number; sinAccesoPorLanzar: number; porLanzarConFicha: number; listosParaArmar: number; erroresNuevos: number; periodoGracia: number; revisarPresupuesto: number; sinGasto: number; total: number; errores: number; aGrabar: number; lanzadas: number; revisarDia4: number; rojos: number; amarillos: number; verdes: number; erroresPago: number; saldosPorAgotarse: number; sinGuiones: number; sinGuionesNecesarios: number; frenadas: number; sinMensajes: number; enAumento: number }
  filas: FilaAnuncio[]
  excluidas: { id: string; cuenta: string; motivo: string; moneda: string }[]
  porLanzarSinEditados?: string[]   // por lanzar con la carpeta de editados vacía: no se muestran (regla del 26/10)
  porLanzar: PorLanzar[]         // clientes ACTIVO del CRM que todavía no tienen fila (no lanzaron): acceso a Meta y ficha de kickoff (lo que hace falta para lanzar)
  avisosPorLanzar: string[]      // los de las fichas de kickoff (lectura de la base, fichas sueltas): van en el panel, no en `avisos` (el reporte de Discord no los arrastra)
  dolar: DolarHoy | null         // venta de hoy por casa (oficial, blue, MEP, tarjeta) para pasar ARS a USD
  optimizacionesLeidas?: boolean // se pudo leer «Ads Optimizaciones»: sin eso, el seguimiento del bot (lib/bot/anuncios) no corre
}

const hash = (xs: string[]) => createHash('sha1').update(xs.join(',')).digest('hex').slice(0, 10)
const iso = (t: number | undefined) => (t ? new Date(t).toISOString() : null)
const SHEETS_VACIO: DatosSheets = { clientes: [], cuentasMeta: [], alias: [], guiones: [], errores: [] }

async function seguro<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; error: string }> {
  try { return { ok: true, v: await p } } catch (e) { return { ok: false, error: (e as Error).message } }
}

// Fichas de kickoff (Neon) para "Por lanzar": caché, tope y pausa tras una falla (kickoffs.ts). La pausa vive en la
// memoria de la instancia: con la base caída y sin último dato bueno, ni la pantalla ni los crons la esperan de nuevo.
const leerKickoffs = crearLecturaConPausa(() => conCache('kickoffs-lanzar-v2', REFRESCO.kickoffsSeg, () => leerFichasKickoff()),
  { esperaMs: ESPERA_KICKOFFS_MS, pausaMs: PAUSA_KICKOFFS_MS, que: QUE_KICKOFFS })

export async function obtenerTablero(): Promise<Tablero> {
  const { ajustes: AJUSTES_CUENTA, base: CUENTAS_BASE, excluidas: CUENTAS_EXCLUIDAS } = cargarCuentas()
  const presupuestosCuentas = leerPresupuestosPrivados()
  const hoy = hoyAR()
  const avisos: string[] = []
  // Fichas de kickoff (Neon) para "Por lanzar": arranca ya y se espera recién al armar "Por lanzar", con tope (no suma
  // latencia: corre mientras se lee Meta). Si falla o tarda, "Por lanzar" sale como antes, sin la ficha.
  const kickoffsP = seguro(leerKickoffs())
  const driveP = carpetasDrive(45_000)   // corre en paralelo con Meta, que tarda más · «Por lanzar» solo con videos editados (editadosPorLanzar.ts)
  const [sheetsR, descR, tokenR, dolarR, fxR, clickupR, optR] = await Promise.all([
    seguro(conCache('sheets', REFRESCO.sheetsSeg, async () => {
      const s = await leerSheets(hoy)
      if (s.errores.length) throw new Error(s.errores.join(' · '))   // no cachear una lectura incompleta
      return s
    })),
    seguro(conCache('descubrir', REFRESCO.descubrimientoSeg, async () => {
      const d = await descubrirCuentas()
      if (!d.cuentas.length) throw new Error(d.errores[0] ?? 'Meta no devolvió cuentas')
      return d
    })),
    seguro(conCache('token', REFRESCO.tokenSeg, saludTokens)),
    seguro(conCache('dolar', REFRESCO.dolarSeg, dolarHoy)),
    seguro(conCache('monedas', REFRESCO.monedasSeg, () => monedasPorUSD())),
    seguro(conCache('clickup-presupuestos-v1', REFRESCO.clickupSeg, leerTareasClickUp)),
    seguro(leerOptimizaciones()),
  ])
  const registros = optR.ok ? optR.v : []
  const optimizaciones = new Map(registros.filter(o => o.accion !== 'revision_competencia').map(o => [o.campanaId, o]))
  const revisiones = new Map(registros.filter(o => o.accion === 'revision_competencia').map(o => [o.campanaId, o]))
  // Una campaña pausada y reactivada empieza de nuevo: las confirmaciones anteriores a la reactivación no cuentan. Lo
  // mismo con una tanda de videos nueva (24/10): l.fecha pasa a ser la de la tanda y una optimización anterior ya no la cubre
  const vigente = <T extends { fecha: string }>(o: T | undefined, l: { fecha: string; reactivada?: string }) => (o && o.fecha >= l.fecha && (!l.reactivada || o.fecha >= l.reactivada) ? o : undefined)
  const optDe = (l: { campanaId: string; fecha: string; reactivada?: string }) => vigente(optimizaciones.get(l.campanaId), l)
  const revDe = (l: { campanaId: string; fecha: string; reactivada?: string }) => vigente(revisiones.get(l.campanaId), l)
  if (!optR.ok) avisos.push(`No se pudo leer el registro de optimizaciones: ${optR.error}`)
  const buscarTarea = crearCruceRamas(clickupR.ok ? clickupR.v.data : [])
  if (clickupR.ok && clickupR.v.viejo) avisos.push(`ClickUp no respondió: presupuestos del último dato disponible (${haceTiempo(clickupR.v.at)}), revisar antes de ajustar gasto.`)
  if (!clickupR.ok) avisos.push(`No se pudo leer ClickUp (${clickupR.error}): sin rama del derecho, se usan los umbrales generales.`)
  const fx = fxR.ok ? fxR.v.data : null
  const dolar = dolarR.ok ? dolarR.v.data : null
  if (!dolarR.ok) avisos.push(`No se pudo leer el dólar de hoy (${dolarR.error}): los montos en pesos no se pasan a USD.`)
  const sheets = sheetsR.ok ? sheetsR.v.data : SHEETS_VACIO
  if (!sheetsR.ok) avisos.push(`No se pudo leer el CRM / sheet de guiones (${sheetsR.error}): sin nombres del CRM ni estado de guiones.`)
  else if (sheetsR.v.viejo) avisos.push(`Google Sheets falló: se usan datos del CRM/guiones de ${haceTiempo(sheetsR.v.at)}.`)
  const descubiertas: CuentaDescubierta[] = descR.ok ? descR.v.data.cuentas : []
  if (!descR.ok) avisos.push(`No se pudo listar las cuentas de Meta (${descR.error}): se muestran solo las de la lista base.`)
  const token = tokenR.ok ? tokenR.v.data : null
  if (token?.aviso) avisos.push(token.aviso)

  // ── Qué cuentas seguir: lista base + cuentas de clientes ACTIVOS que aparezcan en Meta ──
  const cruce = crearCruce(sheets)
  const porIdDesc = new Map(descubiertas.map(c => [c.id, c]))
  const excluidasIds = new Set(CUENTAS_EXCLUIDAS)
  const base = CUENTAS_BASE.filter(id => !excluidasIds.has(id) && !esCuentaPropia(id))
  const enBase = new Set(base)
  const extras = descubiertas.filter(c => !enBase.has(c.id) && !excluidasIds.has(c.id) && !esCuentaPropia(c.id) && ![100, 101].includes(c.estado)
    && cruce.resolverCliente({ id: c.id, nombre: c.nombre, negocio: c.negocio?.nombre }).activo).map(c => c.id)
  const ids = [...base, ...extras.sort()]
  const clave = hash(ids)

  const desde = sumarDias(hoy, -(DIAS_VENTANA - 1))
  const [cuentasR, insightsR, lanzR] = await Promise.all([
    seguro(conCache(`cuentas-presupuesto-v2:${clave}`, REFRESCO.cuentasSeg, () => leerCuentas(ids))),
    seguro(conCache(`insights:${clave}:${hoy}`, REFRESCO.insightsSeg, () => leerInsights(ids, desde, hoy))),
    seguro(conCache(`lanzamientos-ciclo-v4:${clave}:${hoy}`, REFRESCO.lanzamientosSeg, () => leerLanzamientos(ids, sumarDias(hoy, -(DIAS_LANZAMIENTO - 1)), hoy))),
  ])
  const lanzPorCuenta = new Map<string, Lanzamiento[]>()
  for (const l of lanzR.ok ? lanzR.v.data.lanzamientos : []) lanzPorCuenta.set(l.cuenta, [...(lanzPorCuenta.get(l.cuenta) ?? []), l])
  // Las optimizaciones siguen visibles aunque la creación del anuncio quede fuera de los 10 días.
  for (const o of optimizaciones.values()) {
    const actuales = lanzPorCuenta.get(o.cuenta) ?? []
    if (!actuales.some(l => l.campanaId === o.campanaId)) lanzPorCuenta.set(o.cuenta, [...actuales, { cuenta: o.cuenta, campanaId: o.campanaId, campana: o.campana, fecha: o.fechaLanzada, anuncios: 0, gasto: null, mensajes: null }])
  }
  if (lanzR.ok && Object.keys(lanzR.v.data.errores).length) avisos.push(`No se pudieron completar los anuncios activos de ${Object.keys(lanzR.v.data.errores).length} cuentas; no se infieren revisiones de una lectura incompleta.`)
  if (lanzR.ok && Object.keys(lanzR.v.data.erroresPausas ?? {}).length) avisos.push(`No se pudo leer el historial de pausas de ${Object.keys(lanzR.v.data.erroresPausas).length} cuentas: una campaña reactivada podría no reiniciar su espera de 3 días.`)
  if (!lanzR.ok) avisos.push(`No se pudieron leer los lanzamientos de Meta (${lanzR.error}).`)
  const cuentasMeta: ResultadoCuentas = cuentasR.ok ? cuentasR.v.data : { cuentas: {}, errores: {}, limitado: false }
  const insights: InsightsCuentas | null = insightsR.ok ? insightsR.v.data : null
  // Cuentas en error de pago: desde cuándo (historial de Meta). Las que entraron hace menos de 3 días se marcan "nuevas" (azul)
  const enErrorIds = ids.filter(id => [2, 3, 7, 8].includes(cuentasMeta.cuentas[id]?.estado ?? 0))
  const entradasR = await seguro(conCache(`error-pago-v1:${hash(enErrorIds)}:${hoy}`, REFRESCO.cuentasSeg * 2, () => leerEntradasErrorPago(enErrorIds, sumarDias(hoy, -13))))
  const errorPagoDesde = entradasR.ok ? entradasR.v.data.desde : {}
  if (!entradasR.ok) avisos.push(`No se pudo leer desde cuándo están en error de pago (${entradasR.error}): no se marcan los nuevos.`)
  else if (Object.keys(entradasR.v.data.errores).length) avisos.push(`No se pudo leer el historial de error de pago de ${Object.keys(entradasR.v.data.errores).length} cuentas: no se marcan como nuevas.`)
  if (!cuentasR.ok) avisos.push(`Meta no devolvió el estado de las cuentas (${cuentasR.error}).`)
  else if (cuentasR.v.viejo) avisos.push(`Meta no respondió al refrescar las cuentas (${cuentasR.v.error}): estado de pagos de ${haceTiempo(cuentasR.v.at)}.`)
  if (!insightsR.ok) avisos.push(`Meta no devolvió gasto ni mensajes (${insightsR.error}).`)
  else if (insightsR.v.viejo) avisos.push(`Meta no respondió al refrescar el gasto (${insightsR.v.error}): datos de ${haceTiempo(insightsR.v.at)}.`)
  if (cuentasMeta.limitado || insights?.limitado) avisos.push('Meta está limitando pedidos (rate limit): algunas cuentas muestran el último dato bueno. Se reintenta solo, no hace falta recargar.')
  const fallidas = new Set([...Object.keys(cuentasMeta.errores), ...Object.keys(insights?.errores ?? {})])
  if (fallidas.size) {
    const ej = cuentasMeta.errores[[...fallidas][0]] ?? insights?.errores[[...fallidas][0]] ?? ''
    avisos.push(`${fallidas.size} cuenta${fallidas.size > 1 ? 's' : ''} no se pudo leer en el último refresco (ej.: ${ej}).`)
  }

  // ── Días malos de Meta: se miran todas las cuentas juntas antes de analizar cada una ──
  const monedas: Record<string, string> = {}
  for (const id of ids) monedas[id] = cuentasMeta.cuentas[id]?.moneda ?? 'USD'
  const diasMeta = insights ? detectarDiasMeta(insights.porCuenta, monedas, hoy) : []
  const diasMalos = new Set(diasMeta.filter(x => x.malo).map(x => x.d))

  // ── Filas ──
  const filas: FilaAnuncio[] = []
  const excluidas: Tablero['excluidas'] = []
  for (const id of ids) {
    const cuenta: CuentaMeta | undefined = cuentasMeta.cuentas[id]
    const desc = porIdDesc.get(id)
    const nombre = cuenta?.nombre ?? desc?.nombre ?? id
    const negocio = cuenta?.negocio ?? desc?.negocio ?? null
    const esExtra = !enBase.has(id)
    const res = cruce.resolverCliente({ id, nombre, negocio: negocio?.nombre })
    if (res.exCliente) { excluidas.push({ id, cuenta: nombre, motivo: `ex-cliente: ${res.exCliente}`, moneda: cuenta?.moneda ?? 'USD' }); continue }
    const estado = cuenta?.estado ?? desc?.estado ?? 0
    if ([100, 101].includes(estado)) { excluidas.push({ id, cuenta: nombre, motivo: 'cuenta cerrada en Meta', moneda: cuenta?.moneda ?? 'USD' }); continue }
    const dias = insights?.porCuenta[id] ?? null
    if (esExtra && dias && !dias.some(d => d.g > 0)) continue   // cuenta extra del cliente sin gasto en 5 semanas: ruido
    const guiones = cruce.guionesDe(res.cliente, res.nombreColC, nombre, AJUSTES_CUENTA[id]?.aliasGuiones)
    const moneda = cuenta?.moneda ?? 'USD'
    const usdPor = moneda === 'USD' ? 1 : moneda === 'ARS' ? dolar?.bolsa?.venta ?? dolar?.oficial?.venta ?? null : fx?.[moneda] ?? null
    // Rama: a mano (cuentas.ts) → ClickUp "Seguimiento de Anuncios" → nombre de la cuenta
    const tarea = buscarTarea([res.cliente?.nombre ?? '', res.nombreColC, nombre, negocio?.nombre ?? ''])
    const ramaManual = AJUSTES_CUENTA[id]?.rama ?? null
    const ramaCuenta = clasificarRama(`${nombre} ${negocio?.nombre ?? ''}`)
    const ramaId: Rama | null = ramaManual ?? tarea?.rama ?? ramaCuenta
    const rama: FilaAnuncio['rama'] = ramaId ? {
      id: ramaId, nombre: NOMBRE_RAMA[ramaId], fuente: ramaManual ? 'manual' : tarea?.rama ? 'clickup' : 'cuenta', tarea: tarea?.nombre ?? null, umbral: umbralDe(ramaId),
    } : null
    const lanzamientosCuenta = lanzPorCuenta.get(id) ?? []
    const fechaLanzamiento = lanzamientosCuenta.filter(l => !!!optDe(l)).map(l => l.fecha).sort().at(-1) ?? null
    const enCompetencia = lanzamientosCuenta.some(l => etapaOptimizacion(optDe(l)?.fecha ?? null, hoy) === 'competencia')
    const ctx = { pausado: res.pausado, guiones, moneda, diasMalos, usdPor, umbral: umbralDe(ramaId), fechaLanzamiento, enCompetencia, errorPagoDesde: errorPagoDesde[id] ?? null }
    const vinculacion = (presupuestosCuentas as Record<string, { taskIds: string[]; planillaUSD: number | null }>)[id]
    const fuentes = vinculacion?.taskIds.map(taskId => (clickupR.ok ? clickupR.v.data : []).find(t => t.id === taskId)?.presupuestoUSD ?? null) ?? []
    const desdeClickUp = fuentes.length > 0 && fuentes.every(v => v != null)
    const mensualUSD = desdeClickUp ? fuentes.reduce<number>((s, v) => s + v!, 0) : vinculacion?.planillaUSD ?? null
    const presupuesto = evaluarPresupuesto(mensualUSD, dias, hoy, usdPor, res.pausado, desdeClickUp ? clickupR.ok && clickupR.v.viejo ? `ClickUp · último dato disponible (${haceTiempo(clickupR.v.at)})` : 'ClickUp' : vinculacion?.planillaUSD != null ? 'Planilla entregada 05/10' : 'Sin presupuesto confirmado')
    presupuesto.configuradoDiarioUSD = cuenta?.presupuestoDiario != null && usdPor ? cuenta.presupuestoDiario / usdPor : null
    presupuesto.configuradoNota = cuenta?.presupuestoDiarioNota ?? 'Sin configuración disponible'
    const a = analizarCuenta(cuenta ?? null, dias, hoy, ctx)
    const semanal = analizarCuenta(cuenta ?? null, dias, hoy, { ...ctx, periodoCPL: 'd7' })
    const fechaPrevia = sumarDias(hoy, -1)
    const ayer = analizarCuenta(cuenta ?? null, dias, fechaPrevia, { ...ctx, enCompetencia: lanzamientosCuenta.some(l => etapaOptimizacion(optDe(l)?.fecha ?? null, fechaPrevia) === 'competencia') })
    const idNum = sinAct(id)
    filas.push({
      ...a,
      presupuesto,
      estadoSemanal: { semaforo: semanal.semaforo, motivos: semanal.motivos, frase: semanal.frase, prioridad: semanal.prioridad, nivel: semanal.cpl.nivel },
      id, idNum,
      cliente: res.cliente?.nombre || res.nombreColC || nombre,
      clienteCRM: res.cliente?.nombre ?? (res.nombreColC || null),
      cuenta: nombre,
      negocio,
      moneda,
      links: {
        ads: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${idNum}${negocio ? `&business_id=${negocio.id}` : ''}`,
        portfolio: negocio ? `https://business.facebook.com/latest/settings/ad_accounts?business_id=${negocio.id}&selected_asset_id=${idNum}` : null,
      },
      extra: esExtra,
      pausado: res.pausado,
      guiones,
      sinDatosCuenta: !cuenta,
      usdPor,
      rama,
      lanzamientos: (lanzPorCuenta.get(id) ?? []).map(l => ({
        pendienteRevision: !res.pausado && cuenta?.entrega !== 'sin_activos' && requiereRevision(l, optDe(l)?.fecha ?? null, revDe(l)?.fecha ?? null, hoy),
        diasDesdeRevision: diasEntre(fechaUltimaRevision(optDe(l)?.fecha ?? null, revDe(l)?.fecha ?? null, l.fecha), hoy),
        fechaRevision: revDe(l)?.fecha ?? null,
        ...l,
        fechaOptimizacion: optDe(l)?.fecha ?? null,
        etapa: !!optDe(l) && !!revDe(l) && diasEntre(optDe(l)!.fecha, revDe(l)!.fecha) >= 7 ? null : etapaOptimizacion(optDe(l)?.fecha ?? null, hoy),
        diasCompetencia: !!optDe(l) ? diasEntre(optDe(l)!.fecha, hoy) : 0,
        dia: diasEntre(l.fecha, hoy) + 1,
        cplUSD: l.gasto != null && l.mensajes ? (usdPor ? l.gasto / usdPor : l.gasto) / l.mensajes : null,
        link: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${idNum}${negocio ? `&business_id=${negocio.id}` : ''}&selected_campaign_ids=${l.campanaId}`,
      })),
      revisarDia4: !res.pausado && cuenta?.entrega !== 'sin_activos' && lanzamientosCuenta.some(l => requiereRevision(l, optDe(l)?.fecha ?? null, revDe(l)?.fecha ?? null, hoy)),
      clickup: tarea ? { nombre: tarea.nombre, url: tarea.url, sinTopicos: !tarea.texto } : null,
      previo: { semaforo: ayer.semaforo, rendimiento: ayer.motivos.filter(x => x.color === 'rojo' && MOTIVOS_RENDIMIENTO.includes(x.tipo)).map(x => x.tipo), aGrabar: !!ayer.aGrabar },
    })
  }
  filas.sort((x, y) => y.prioridad - x.prioridad || y.gasto.d7 - x.gasto.d7 || x.cliente.localeCompare(y.cliente))

  // ── Por lanzar: clientes ACTIVO del CRM sin fila. Se cruzan con las cuentas de Meta visibles (¿hay acceso?), con su ficha
  //    de kickoff del Despacho (lo que hace falta para armar la campaña) y con ClickUp (la etapa, mientras convivan) ──
  const conFila = new Set(filas.map(f => normTxt(f.clienteCRM ?? '')))
  const idsFila = new Set(filas.map(f => f.id))
  const tokFilas = new Set(filas.flatMap(f => tokensNombre(`${f.cliente} ${f.cuenta}`)))   // palabras que ya pertenecen a clientes con fila: no sirven para cruzar a otro
  const idPorCliente = new Map(Object.entries(AJUSTES_CUENTA).filter(([, a]) => a.cliente).map(([id, a]) => [normTxt(a.cliente!), id]))
  const candidatas = descubiertas.filter(c => !idsFila.has(c.id) && !excluidasIds.has(c.id) && !esCuentaPropia(c.id) && ![100, 101].includes(c.estado))
  const sinLanzar: Omit<PorLanzar, keyof ConKickoff>[] = sheets.clientes.filter(c => c.estado === 'ACTIVO' && !conFila.has(normTxt(c.nombre))).map(c => {
    // Las cuentas que se parecen por el nombre (a mano, dos palabras en común o un apellido distintivo): porLanzar.ts
    const cuentas = cuentasDelCliente(c.nombre, candidatas, { manual: idPorCliente.get(normTxt(c.nombre)) ?? null, tokFilas })
    const tarea = buscarTarea([c.nombre])
    return { cliente: c.nombre, etapa: tarea?.estado ?? null, clickup: tarea ? { nombre: tarea.nombre, url: tarea.url } : null, acceso: cuentas.length ? 'si' as const : 'no' as const, cuentas }
  })
  // La ficha de kickoff de cada uno (porLanzar.ts): por el nombre del CRM que guardó la ficha, con el mismo cruce del
  // tablero, o por la cuenta que revisó (solo si el tablero se la asoció con algo firme). Con cuenta en la ficha, el
  // acceso es el de esa cuenta: la ve el token, ya gasta en otra fila, el tablero no la sigue (y por qué) o no la ve.
  const kickoffsR = await kickoffsP
  const avisosPorLanzar: string[] = []
  const avisoFichas = avisoLecturaFichas(kickoffsR, haceTiempo)
  if (avisoFichas) avisosPorLanzar.push(avisoFichas)
  const motivoExcluida = new Map(excluidas.map(e => [e.id, e.motivo]))
  const { porLanzar: todosPorLanzar, sueltas } = cruzarKickoffs(sinLanzar, kickoffsR.ok ? kickoffsR.v.data : null, opcionesCruceTablero({
    buscarCliente: cruce.buscarCliente,
    visibles: candidatas,
    filas,
    excluida: id => motivoExcluida.get(id)
      ?? (excluidasIds.has(id) ? 'la quitaron a mano del tablero' : esCuentaPropia(id) ? 'es la cuenta propia de Skyward'
        : [100, 101].includes(porIdDesc.get(id)?.estado ?? 0) ? 'cuenta cerrada en Meta' : null),
    descubrimientoOk: descR.ok,
  }))
  // Las fichas que no cruzaron con nadie (cliente fuera del CRM de Agencia o sin cliente del CRM): sin el CRM no se sabe
  if (sheetsR.ok) avisosPorLanzar.push(...avisosFichasSueltas(sueltas))
  // Regla del 26/10: «Por lanzar» = los que ya tienen videos editados. Sin Drive, se muestran todos y se avisa
  const drive = await driveP
  const { porLanzar, sinEditados } = filtrarConEditados(todosPorLanzar, drive.carpetas, drive.carpetas.length > 0)
  if (!drive.carpetas.length) avisosPorLanzar.push('Drive no respondió: «Por lanzar» muestra a todos, también a los que todavía no tienen videos editados.')

  const tiene = (f: FilaAnuncio, ...t: TipoMotivo[]) => f.motivos.some(x => t.includes(x.tipo))
  return {
    generado: new Date().toISOString(),
    hoy,
    actualizado: {
      cuentas: cuentasR.ok ? iso(cuentasR.v.at) : null,
      insights: insightsR.ok ? iso(insightsR.v.at) : null,
      sheets: sheetsR.ok ? iso(sheetsR.v.at) : null,
    },
    refresco: REFRESCO,
    token,
    avisos,
    diasMeta,
    resumen: {
      porLanzar: porLanzar.length,
      sinAccesoPorLanzar: porLanzar.filter(p => p.acceso === 'no').length,
      porLanzarConFicha: porLanzar.filter(p => p.kickoff).length,
      listosParaArmar: porLanzar.filter(p => p.grupo === 'listo').length,   // ficha + acceso a su cuenta + nada que frene ni que confirmar
      periodoGracia: filas.filter(f => f.pago.periodoGracia).length,
      revisarPresupuesto: filas.filter(f => ['exceso', 'corto'].includes(f.presupuesto.estado)).length,
      sinGasto: filas.filter(f => f.semaforo === 'sin_gasto').length,
      total: filas.length,
      rojos: filas.filter(f => f.semaforo === 'rojo').length,
      amarillos: filas.filter(f => f.semaforo === 'amarillo').length,
      verdes: filas.filter(f => f.semaforo === 'verde').length,
      erroresPago: filas.filter(f => f.pago.errorPago).length,
      erroresNuevos: filas.filter(f => f.pago.nuevo).length,
      saldosPorAgotarse: filas.filter(f => tiene(f, 'saldo')).length,
      sinGuiones: filas.filter(f => f.guiones.estado === 'sin_guiones').length,
      sinGuionesNecesarios: filas.filter(f => f.aGrabar && f.guiones.estado === 'sin_guiones').length,   // demanda real: quemadas o primera tanda mala
      frenadas: filas.filter(f => f.pausado || f.corriendo.sinAnunciosActivos || f.corriendo.frenadaHace != null).length,
      sinMensajes: filas.filter(f => tiene(f, 'sin_mensajes')).length,
      enAumento: filas.filter(f => f.aumento).length,
      errores: filas.filter(f => f.semaforo === 'error').length,
      aGrabar: filas.filter(f => f.aGrabar).length,
      lanzadas: filas.filter(f => f.lanzamientos.some(l => !l.etapa && l.dia <= DIAS_LANZAMIENTO)).length,
      revisarDia4: filas.filter(f => f.revisarDia4).length,
    },
    filas,
    excluidas,
    porLanzar,
    porLanzarSinEditados: sinEditados,
    avisosPorLanzar,
    dolar,
    optimizacionesLeidas: optR.ok,
  }
}
