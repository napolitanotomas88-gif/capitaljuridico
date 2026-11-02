// ── Alertas por Discord: el ÚNICO lugar que manda una alerta del sistema (2/11/2026) ─────────────────────────────────────
// alertar() nunca tira. En orden:
//   1. Interruptor ALERTAS_DISCORD: real (por defecto) | ensayo (todo va a #🧰-sistema-bot con «🧪 PRUEBA» y sin menciones)
//      | apagado (no sale nada; queda registrada). Un cliente «PRUEBA BOT…» sale a su canal, con «🧪 PRUEBA» y sin menciones.
//   2. Deduplicación por `clave` en Neon (cj_alertas_discord, UNIQUE): la misma clave no sale dos veces. Una que falló seguro
//      (4xx, sin webhook) se puede volver a intentar hasta 5 veces cuando el que avisa la vuelve a pedir; una dudosa (timeout)
//      no se repite sola. Los recordatorios usan su propia clave («…:rec1»).
//   3. Canal: su webhook o el respaldo (canales.ts). Sin ningún webhook queda «sin_webhook» en la base (no se pierde).
//   4. Tope: más de 60 alertas por hora en un canal → el resto va a #🧰-sistema-bot con un solo aviso por hora.
//   5. De 20 a 9 h (Argentina) sale igual pero silenciosa (flag 4096), salvo `urgente`.
//   6. ?wait=true (guarda el id del mensaje), flags 4 (sin vista previa), allowed_mentions solo con los IDs declarados.
// Los logs llevan canal, tipo y estado: nunca la URL del webhook, teléfonos ni textos completos.
import { ErrorEnvio, enviarDiscord } from '@/lib/fathomAnuncios/discord'
import { NOMBRE_CANAL, webhookDe, type Canal } from './canales'
import { armarTexto, flagsDe, linkDespacho } from './formato'
import { resolverMenciones, type Mencion } from './personas'

type Entorno = Record<string, string | undefined>
export type ModoAlertas = 'real' | 'ensayo' | 'apagado'
export const modoAlertas = (env: Entorno = process.env): ModoAlertas => {
  const v = env.ALERTAS_DISCORD?.trim().toLowerCase()
  return v === 'ensayo' || v === 'apagado' ? v : 'real'
}
/** Cliente ficticio de las pruebas punta a punta («PRUEBA BOT Ensayo»): su alerta sale a SU canal, marcada «🧪 PRUEBA» y
 *  sin notificar a nadie (regla de Tomás: en pruebas no se menciona a nadie salvo en mensajes marcados). */
export const esClienteDePrueba = (cliente: string | null | undefined): boolean => /^\s*PRUEBA BOT\b/i.test(String(cliente ?? ''))
export const TOPE_POR_HORA = 60
export const MAX_INTENTOS = 5

export interface Alerta {
  canal: Canal
  /** 'alta_espera', 'para_enviar', 'exito_pedido'… (para contar y filtrar; no es secreto). */
  tipo: string
  /** Idempotencia: la misma clave nunca sale dos veces. */
  clave: string
  titulo: string
  cliente?: string | null
  idCrm?: string | null
  lineas?: readonly string[]
  /** Texto para copiar y pegarle al cliente (bloque de código). */
  copiar?: string | null
  /** Ruta interna del Despacho ('/clientes/aprobaciones#exito-12') o un https absoluto. */
  link?: string | null
  menciones?: readonly Mencion[]
  urgente?: boolean
  emoji?: string | null
}

export type EstadoAlerta = 'enviado' | 'ya_estaba' | 'apagado' | 'sin_webhook' | 'tope' | 'dudoso' | 'error'
export interface ResultadoAlerta { estado: EstadoAlerta; mensajeId?: string | null; sale?: string; motivo?: string }

export interface RegistroAlertas {
  /** true si la reservó (nueva o reintentable). */
  anotar(f: { clave: string; canal: Canal; tipo: string; idCrm: string | null; resumen: string }): Promise<boolean>
  cerrar(clave: string, estado: Exclude<EstadoAlerta, 'ya_estaba'>, mensajeId: string | null, motivo: string | null): Promise<void>
  /** Enviadas (o dudosas) en la última hora por ese canal. */
  enLaHora(canal: Canal): Promise<number>
}

export interface DepsAlerta {
  env: Entorno
  ahora: () => number
  base: string
  registro: RegistroAlertas | null
  enviar: (url: string, texto: string, menciones: string[], flags: number) => Promise<string | null>
  log?: Pick<Console, 'warn' | 'error'>
}

const motivoDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/gi, '[url]').replace(/\d{8,}/g, '[número]').slice(0, 200)
const resumenDe = (a: Alerta) => `${a.titulo}${a.cliente ? ` — ${a.cliente}` : ''}`.replace(/\s+/g, ' ').slice(0, 160)

export async function alertarCon(a: Alerta, d: DepsAlerta): Promise<ResultadoAlerta> {
  const log = d.log ?? console
  const modo = modoAlertas(d.env)
  const clave = String(a.clave ?? '').slice(0, 300)
  if (!clave) return { estado: 'error', motivo: 'falta la clave de la alerta' }
  try {
    if (d.registro && !(await d.registro.anotar({ clave, canal: a.canal, tipo: a.tipo.slice(0, 60), idCrm: a.idCrm ?? null, resumen: resumenDe(a) }))) return { estado: 'ya_estaba' }
  } catch (e) {
    // Sin base no hay deduplicación: se manda igual (mejor un aviso repetido que uno perdido)
    log.warn(`[alertas] no se pudo anotar ${a.tipo} (${motivoDe(e)}): sale sin deduplicar`)
  }
  const cerrar = async (estado: Exclude<EstadoAlerta, 'ya_estaba'>, id: string | null, motivo: string | null) => {
    try { await d.registro?.cerrar(clave, estado, id, motivo) } catch (e) { log.warn(`[alertas] no se pudo cerrar ${a.tipo} (${motivoDe(e)})`) }
  }
  if (modo === 'apagado') { await cerrar('apagado', null, 'ALERTAS_DISCORD=apagado'); return { estado: 'apagado' } }

  const prueba = modo === 'ensayo'
  const marcada = prueba || esClienteDePrueba(a.cliente)
  let canal: Canal = prueba ? 'sistema' : a.canal
  // Tope por hora (solo en real): el exceso va al canal del sistema con un único aviso por hora
  if (!prueba && d.registro && canal !== 'sistema') {
    const n = await d.registro.enLaHora(canal).catch(() => 0)
    if (n >= TOPE_POR_HORA) {
      const hora = new Date(d.ahora()).toISOString().slice(0, 13)
      await alertarCon({ canal: 'sistema', tipo: 'tope', clave: `tope:${canal}:${hora}`, titulo: `Tope de ${TOPE_POR_HORA} alertas por hora en ${NOMBRE_CANAL[canal]}`, lineas: ['Las que siguen quedan registradas sin salir hasta la hora que viene.', 'Revisá el Despacho: puede haber un bucle.'], menciones: ['tomas'], urgente: true }, d)
      await cerrar('tope', null, `más de ${TOPE_POR_HORA} en la hora`)
      return { estado: 'tope' }
    }
  }
  const destino = webhookDe(canal, d.env)
  if (!destino.url) {
    await cerrar('sin_webhook', null, `falta el webhook de ${NOMBRE_CANAL[a.canal]} y de los respaldos`)
    log.warn(`[alertas] ${a.tipo}: sin ningún webhook de Discord (queda registrada)`)
    return { estado: 'sin_webhook' }
  }
  canal = destino.sale === 'respaldo' ? canal : destino.sale
  const m = resolverMenciones(a.menciones ?? [], d.env)
  const texto = armarTexto({
    menciones: m.texto, emoji: a.emoji, titulo: a.titulo, cliente: a.cliente, lineas: a.lineas, copiar: a.copiar,
    link: linkDespacho(d.base, a.link), prueba: marcada, ibaA: !prueba && destino.respaldo ? NOMBRE_CANAL[a.canal] : null,
  })
  try {
    const id = await d.enviar(destino.url, texto, marcada ? [] : m.ids, flagsDe(d.ahora(), !!a.urgente))
    await cerrar('enviado', id, destino.respaldo ? `salió por el respaldo (${destino.sale})` : null)
    return { estado: 'enviado', mensajeId: id, sale: destino.sale }
  } catch (e) {
    const transitorio = e instanceof ErrorEnvio ? e.transitorio : true
    const dudoso = transitorio && /no respondió|tiempo/i.test(motivoDe(e))
    await cerrar(dudoso ? 'dudoso' : 'error', null, motivoDe(e))
    log.warn(`[alertas] ${a.tipo} a ${NOMBRE_CANAL[a.canal]}: ${dudoso ? 'dudoso' : 'error'} (${motivoDe(e)})`)
    return { estado: dudoso ? 'dudoso' : 'error', motivo: motivoDe(e) }
  }
}

/** El envío real por webhook: un mensaje, 1 reintento ante 429, timeout de 10 s. */
export async function enviarWebhook(url: string, texto: string, menciones: string[], flags: number): Promise<string | null> {
  const ids = await enviarDiscord(url, [texto], menciones, { reintentos429: 1, esperas5xx: [1_000], timeoutMs: 10_000, deadline: Date.now() + 25_000, flags })
  return ids[0] || null
}
