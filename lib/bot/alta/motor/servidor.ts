// ── Bot "Capital Jurídico": dependencias REALES del motor de altas, según el modo y las capacidades ───────────────────
// El ÚNICO lugar donde se decide qué es real (diseño del motor, sección 6, primera barrera; la segunda es la compuerta de
// Whapi y la tercera, el cliente real que rechaza ids "seco-"/"jg-"):
//   · seco: sin lecturas externas (ni Claude, ni MEP, ni CRM de ventas, ni planillas): los pasos arman vistas previas puras.
//   · ensayo: lecturas reales (comprobante, Claude, MEP, CRM de ventas, Finanzas y CRM en modo 'simulacion', de solo lectura).
//   · real: escribe solo lo que dice BOT_ALTA_PASOS_REALES; lo demás corre como en ensayo.
// Además: el almacén (Neon), el entorno (VERCEL_ENV), las listas de personas (aprobadores, operaciones, teléfonos del equipo),
// las fotos de la comunidad (por URL pública del Despacho, /bot/*.jpg) y la continuación (POST a /api/bot/alta/motor con
// Bearer CRON_SECRET, esperando solo el 202, como dispararMapaReal del kickoff: patrón copiado). Solo servidor.
// Variables (solo nombres): BOT_ALTA_APROBADORES, BOT_ALTA_OPERACIONES, BOT_ALTA_EQUIPO_TELEFONOS, BOT_ALTA_CLOSERS, BOT_ALTA_MAX_COMUNIDADES_DIA, BOT_COMUNIDAD_AGREGAR_DIRECTO,
// BOT_ALTA_DESPERTADOR, BOT_ALTA_MODELO_COMPROBANTE, DESPACHO_URL, CRON_SECRET, VERCEL_ENV, DATABASE_URL.
import { cargarPagoFinanzas, cuotasAnterioresFinanzas } from '../finanzasEscribir'
import { escribirAltaCrm } from '../crmEscribir'
import { plantillaGuionesDesdeEntorno, prepararDriveCliente } from '../driveCliente'
import { BASE_PANDADOC, clavePandaDoc, crearBorradorContrato, estadoDocumento } from '../pandadoc'
import { buscarMepDiaAnterior } from '../mep'
import { leerComprobanteConClaude, modeloComprobante } from '../comprobanteClaude'
import { buscarSetterFuente } from '../setterFuente'
import { buscarPersonaEnCrm } from '../crmServidor'
import { almacenNeon } from './almacenNeon'
import type { DepsContrato, DepsPasos } from './contexto'
import type { DepsOrquestador } from './orquestador'
import type { DepsMotorBase } from './tipos'
import { archivosNeon, clienteConArchivosDespacho } from '../despacho/archivos'
import { canalDesdeEntorno, type CanalAlta } from '../despacho/canal'
import { mencionesDe, textoAvisoEspera, webhookAvisos } from '../despacho/aviso'
import { enviarDiscord } from '../../../fathomAnuncios/discord'
import { guardiaWhapi } from '../../whapi/salud'
import { tokenWhapi } from '../../whapi/config'
import type { DepsOrquestador as DepsO } from './orquestador'

/** Dominio del Despacho (mismo criterio que lib/bot/kickoff/entorno.ts, copiado). */
export const URL_DESPACHO = 'https://despacho-capital-juridico.vercel.app'
export function urlDespacho(env: NodeJS.ProcessEnv = process.env): string {
  const b = env.DESPACHO_URL?.trim() ?? ''
  try { if (new URL(b).protocol === 'https:') return b.replace(/\/+$/, '') } catch { /* sin DESPACHO_URL o mal formada */ }
  return URL_DESPACHO
}

/** "5491130009999, 123@lid" → lista (teléfonos con solo dígitos; los lid tal cual). */
export function listaPersonas(v: string | undefined): string[] {
  return (v ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => (x.includes('@') ? x : x.replace(/\D/g, ''))).filter((x) => x.length >= 8 || x.includes('@'))
}

/** BOT_ALTA_EQUIPO_TELEFONOS: JSON { "Gero M": "549…", "Aylu": "549…", … }. Lo que no tenga forma de teléfono se ignora. */
export function equipoDesdeEntorno(v: string | undefined): Record<string, string> {
  if (!v?.trim()) return {}
  try {
    const o = JSON.parse(v) as Record<string, unknown>
    return Object.fromEntries(Object.entries(o).map(([k, t]) => [k.trim(), String(t ?? '').replace(/\D/g, '')]).filter(([, t]) => t.length >= 8))
  } catch {
    console.error('bot-alta: BOT_ALTA_EQUIPO_TELEFONOS no es un JSON válido: los grupos se arman sin el equipo')
    return {}
  }
}

/** fetch con corte: pandadoc.ts no le pone señal a sus pedidos (revisión, punto 7: el corte es obligatorio). */
export const fetchConCorte = (ms: number): typeof fetch => (input, init) => fetch(input, { ...(init ?? {}), signal: AbortSignal.timeout(ms) })

function contratoReal(): DepsContrato {
  return {
    hayClave: () => { try { clavePandaDoc(); return true } catch { return false } },
    crear: (a, op) => crearBorradorContrato(a, { alCrear: op.alCrear, metadata: op.metadata, fetch: fetchConCorte(25_000) }),
    estado: (id) => estadoDocumento(id, { fetch: fetchConCorte(15_000) }),
    async buscar(nombre, desdeMs) {
      const { clave } = clavePandaDoc()
      const q = new URLSearchParams({ q: nombre, count: '50' })
      const r = await fetchConCorte(15_000)(`${BASE_PANDADOC}/documents?${q}`, { headers: { Authorization: `API-Key ${clave}` } })
      if (!r.ok) throw new Error(`PandaDoc respondió ${r.status} al buscar`)
      const { results = [] } = JSON.parse(await r.text()) as { results?: { id: string; name: string; status: string; date_created: string }[] }
      return results.filter((d) => d.name === nombre && Date.parse(d.date_created) >= desdeMs).map((d) => ({ id: d.id, estado: d.status }))
    },
  }
}

export interface OpcionesServidor { env?: NodeJS.ProcessEnv; fetch?: typeof fetch }

/** POST a la ruta del motor esperando solo el 202 (8 s). */
export async function dispararMotor(cuerpo: Record<string, unknown>, op: OpcionesServidor = {}): Promise<void> {
  const env = op.env ?? process.env
  const cron = env.CRON_SECRET?.trim()
  if (!cron) throw new Error('falta CRON_SECRET')
  let res: Response
  try {
    res = await (op.fetch ?? fetch)(`${urlDespacho(env)}/api/bot/alta/motor`, {
      method: 'POST', headers: { authorization: `Bearer ${cron}`, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(8_000), cache: 'no-store',
    })
  } catch (e) {
    const n = (e as Error)?.name
    throw new Error(n === 'TimeoutError' || n === 'AbortError' ? 'la ruta del motor no respondió en 8 s' : 'no se pudo conectar con la ruta del motor')
  }
  await res.body?.cancel().catch(() => {})
  if (res.status !== 202 && res.status !== 200) throw new Error(`la ruta del motor respondió ${res.status}`)
}

/** Las dependencias de los pasos según el modo del entorno. En seco no hay ninguna lectura externa. */
export function depsPasosServidor(base: Pick<DepsMotorBase, 'modo'>, env: NodeJS.ProcessEnv = process.env): DepsPasos {
  const despacho = urlDespacho(env)
  const lecturas = base.modo !== 'seco'
  const max = Number(env.BOT_ALTA_MAX_COMUNIDADES_DIA)
  return {
    ...(lecturas ? {
      finanzas: (fila, comprobante, op) => cargarPagoFinanzas(fila, comprobante, { modo: op.modo, hasta: op.hasta, archivoNuevo: op.archivoNuevo, nombreArchivo: op.nombreArchivo }),
      crm: (a, extras, op) => escribirAltaCrm(a, extras, { modo: op.modo }),
      mep: (fecha) => buscarMepDiaAnterior(fecha),
      vision: (m) => leerComprobanteConClaude(m),
      setterFuente: (tel, correo) => buscarSetterFuente(tel, { correo }),
      clienteCrm: (p) => buscarPersonaEnCrm(p),   // ¿ya es cliente? (solo lectura)
      cuotasAnteriores: (p) => cuotasAnterioresFinanzas(p),   // pago de un cliente existente: qué cuota es (solo lectura)
      contrato: contratoReal(),
    } satisfies Partial<DepsPasos> : {}),
    drive: (a, op) => prepararDriveCliente(a, op),   // en 'simulacion' no llama al puente
    plantillaGuionesId: plantillaGuionesDesdeEntorno,
    modeloVision: modeloComprobante(),
    equipo: equipoDesdeEntorno(env.BOT_ALTA_EQUIPO_TELEFONOS),
    // Alta libre (26/10/2026): { "Yamila": "595…", "Marcos": "549…" }, el mismo formato que BOT_ALTA_EQUIPO_TELEFONOS
    closers: equipoDesdeEntorno(env.BOT_ALTA_CLOSERS),
    aprobadores: listaPersonas(env.BOT_ALTA_APROBADORES),
    operaciones: listaPersonas(env.BOT_ALTA_OPERACIONES),
    fotos: {
      comunidad: { url: `${despacho}/bot/foto-grupo-cj-640.jpg` },
      General: { url: `${despacho}/bot/grupo-general.jpg` },
      Ventas: { url: `${despacho}/bot/grupo-ventas.jpg` },
      Contenido: { url: `${despacho}/bot/grupo-contenido.jpg` },
    },
    maxComunidadesDia: Number.isInteger(max) && max > 0 ? max : 2,
    // WhatsApp seguro: el modo viejo (sumar al cliente directo) solo con la variable explícita
    agregarDirecto: env.BOT_COMUNIDAD_AGREGAR_DIRECTO?.trim().toLowerCase() === 'si',
    esperar: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    azar: Math.random,
  }
}

/** Todo lo que el orquestador necesita en producción, a partir de lo que arma la ruta (modo, capacidades, grupos, Whapi). */
export function depsServidor(base: DepsMotorBase, op: OpcionesServidor = {}): DepsOrquestador {
  const env = op.env ?? process.env
  const entorno = env.VERCEL_ENV?.trim() || 'local'
  return {
    ...base,
    // Altas desde el Despacho (26/10/2026): los comprobantes subidos ahí se leen de cj_altas_archivos, no de Whapi
    whapi: clienteConArchivosDespacho(base.whapi, () => archivosNeon(env)),
    canal: () => canalDelEntorno(env),
    avisarEspera: (d) => avisarEsperaDiscord(d, env, op.fetch),
    almacen: almacenNeon(),
    pasos: depsPasosServidor(base, env),
    entorno,
    produccion: entorno === 'production',
    despertador: env.BOT_ALTA_DESPERTADOR?.trim() !== '0',
    dispararContinuacion: (d) => dispararMotor({ alta_id: d.alta_id, cadena: d.cadena }, op),
    dispararDespertador: (d) => dispararMotor({ alta_id: d.alta_id, no_antes_de: d.no_antes_de }, op),
  }
}

/** BOT_ALTA_CANAL o, sin la variable, según lo que la guardia de salud ya sabe del número (despacho si está caído). */
export function canalDelEntorno(env: NodeJS.ProcessEnv = process.env): CanalAlta {
  let salud = null
  try { const t = tokenWhapi(env); salud = t ? guardiaWhapi().estado(t) : null } catch { salud = null }
  return canalDesdeEntorno(env, salud)
}

/** Aviso a Discord de un pedido que se responde en el Despacho (DISCORD_WEBHOOK_VERIFICACIONES o DISCORD_WEBHOOK_URL). Tira si
 *  no salió: el orquestador lo anota y lo vuelve a intentar con el próximo envío del pedido. */
export async function avisarEsperaDiscord(d: Parameters<NonNullable<DepsO['avisarEspera']>>[0], env: NodeJS.ProcessEnv = process.env, f?: typeof fetch): Promise<void> {
  const wh = webhookAvisos(env)
  if (!wh) throw new Error('falta DISCORD_WEBHOOK_VERIFICACIONES y DISCORD_WEBHOOK_URL')
  const menciones = mencionesDe(d.espera.quien, env)
  const texto = textoAvisoEspera({ alta: d.alta, espera: d.espera, motivo: d.motivo, base: urlDespacho(env), menciones })
  const ids = await enviarDiscord(wh, [texto], menciones, { deadline: Date.now() + 15_000, reintentos429: 1, ...(f ? { fetch: f } : {}) })
  if (!ids.length) throw new Error('Discord no confirmó el aviso')
}
