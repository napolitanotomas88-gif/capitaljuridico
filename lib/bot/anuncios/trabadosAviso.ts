// ── Aviso de CLIENTES TRABADOS en #📣-ads (corre con la alerta diaria de las 9:05, /api/alerta-anuncios) ─────────────
// Pedido de Tomás (3/11/2026): los clientes de «Por lanzar» (activos, sin campaña) con la kickoff de hace más de 7 días, con la
// etapa donde están trabados, el motivo y quién lo destraba (la regla es pura: lib/anuncios/trabados.ts). Sin spam: una vez
// por cliente por etapa (clave trabado:<cliente>:<etapa> en cj_anuncios_avisos, la misma tabla de los avisos del bot); si
// cambia de etapa y sigue trabado, sale de nuevo. UN mensaje por corrida con los nuevos y una línea con los que siguen igual.
// Menciona a Valen y a Tomás siempre, y a Faus / René / Gero M si alguno de los nuevos es suyo (si su ID está configurado).
// ANUNCIOS_TRABADOS=0 lo apaga. Con dry (la vista previa de la alerta) no escribe ni manda nada. Nunca tira.
import type { Tablero } from '@/lib/anuncios/tablero'
import { clientesTrabados, partirMensaje, textoTrabados, type ClienteTrabado, type EntradaTraba, type TandaTraba } from '@/lib/anuncios/trabados'

export interface DepsTrabados {
  hoy(): string
  dia1(): Promise<Map<string, string>>           // id del CRM → Día 1 (YYYY-MM-DD), para los que no tienen ficha
  tandas(): Promise<Map<string, TandaTraba> | null>
  entrada(p: Tablero['porLanzar'][number], tandas: Map<string, TandaTraba> | null): EntradaTraba
  sinFin(): string[]
  /** ¿Tiene campaña en su cuenta de Meta en los últimos 120 días (activa o pausada)? null = no se sabe (no frena el aviso). */
  conCampana(p: Tablero['porLanzar'][number]): Promise<boolean | null>
  reclamar(clave: string, d: { tipo: string; cuenta: string; campana_id: string; cliente: string; texto_cliente: null }): Promise<boolean>
  marcarEnviado(clave: string, id: string): Promise<void>
  soltar(clave: string): Promise<void>
  enviar(texto: string, menciones: string[]): Promise<string>
  menciones: { valen: string | null; tomas: string | null; faus: string | null; rene: string | null; gero_m: string | null }
}
export interface ResultadoTrabados { trabados: { cliente: string; idCrm: string | null; etapa: string; motivo: string; responsable: string; dias: number; desde: string; por: string; ademas: string[] }[]; nuevos: string[]; texto: string; enviado: boolean; errores: string[] }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 200)
const resumir = (t: ClienteTrabado) => ({ cliente: t.cliente, idCrm: t.idCrm, etapa: t.etapa, motivo: t.motivo, responsable: t.responsable, dias: t.dias, desde: t.desde, por: t.por, ademas: t.ademas })

/** A quién mencionar: Valen y Tomás siempre; los dueños de las etapas de los nuevos, si tienen ID. */
export function mencionesPara(nuevos: ClienteTrabado[], m: DepsTrabados['menciones']): string[] {
  const out = [m.valen, m.tomas]
  if (nuevos.some(t => t.etapa === 'guiones')) out.push(m.faus)
  if (nuevos.some(t => t.etapa === 'edicion')) out.push(m.rene)
  if (nuevos.some(t => t.etapa === 'kickoff')) out.push(m.gero_m)
  return [...new Set(out.filter((x): x is string => !!x))]
}

export async function avisarTrabados(t: Pick<Tablero, 'porLanzar' | 'porLanzarEsperando'>, deps: DepsTrabados, op: { dry?: boolean } = {}): Promise<ResultadoTrabados> {
  const errores: string[] = []
  const [dia1, tandas] = await Promise.all([
    deps.dia1().catch(e => { errores.push(`CRM (Día 1): ${motivo(e)}`); return new Map<string, string>() }),
    deps.tandas().catch(() => null),
  ])
  const entradas = [...t.porLanzar, ...(t.porLanzarEsperando ?? [])].map(p => {
    const e = deps.entrada(p, tandas)
    return { ...e, dia1: e.idCrm ? dia1.get(e.idCrm.toUpperCase()) ?? null : null }
  })
  const candidatos = clientesTrabados(entradas, { hoy: deps.hoy(), sinFin: deps.sinFin() })
  // Los que tienen campaña en su cuenta (ya lanzados, aunque no gasten hoy): fuera
  const porCliente = new Map([...t.porLanzar, ...(t.porLanzarEsperando ?? [])].map(p => [p.cliente, p]))
  const trabados: ClienteTrabado[] = []
  for (const x of candidatos) {
    const p = porCliente.get(x.cliente)
    let con: boolean | null = null
    if (p) { try { con = await deps.conCampana(p) } catch (e) { errores.push(`campañas de «${x.cliente}»: ${motivo(e)}`) } }
    if (con !== true) trabados.push(x)
  }
  if (op.dry) return { trabados: trabados.map(resumir), nuevos: trabados.map(x => x.cliente), texto: textoTrabados(trabados, [], mencionesPara(trabados, deps.menciones)), enviado: false, errores }
  const nuevos: ClienteTrabado[] = [], siguen: ClienteTrabado[] = []
  for (const x of trabados) {
    try {
      if (await deps.reclamar(x.clave, { tipo: 'trabado', cuenta: '', campana_id: x.etapa, cliente: x.cliente, texto_cliente: null })) nuevos.push(x)
      else siguen.push(x)
    } catch (e) { errores.push(`reclamar ${x.clave}: ${motivo(e)}`) }
  }
  const menciones = mencionesPara(nuevos, deps.menciones)
  const texto = textoTrabados(nuevos, siguen, menciones)
  if (!texto) return { trabados: trabados.map(resumir), nuevos: [], texto: '', enviado: false, errores }
  try {
    const id = await deps.enviar(texto, menciones)
    for (const x of nuevos) await deps.marcarEnviado(x.clave, id).catch(e => errores.push(`anotar ${x.clave}: ${motivo(e)}`))
    return { trabados: trabados.map(resumir), nuevos: nuevos.map(x => x.cliente), texto, enviado: true, errores }
  } catch (e) {
    errores.push(`discord: ${motivo(e)}`)
    for (const x of nuevos) await deps.soltar(x.clave).catch(() => {})   // sale en la próxima corrida
    return { trabados: trabados.map(resumir), nuevos: nuevos.map(x => x.cliente), texto, enviado: false, errores }
  }
}

/** Las dependencias reales. Solo servidor. */
export async function depsTrabadosReales(): Promise<DepsTrabados> {
  const [{ hoyAR }, { tandasPorCliente }, { entradaTraba }, { clientesSinFin }, reg, { enviarDiscord, idDiscord }] = await Promise.all([
    import('@/lib/anuncios/formato'), import('@/lib/anuncios/tandas'), import('@/lib/anuncios/tablero'), import('@/lib/clientes/sinFin'),
    import('./registro'), import('@/lib/fathomAnuncios/discord'),
  ])
  const { mencionesKickoff } = await import('@/lib/bot/kickoff/entorno')
  const mk = mencionesKickoff()
  const webhook = process.env.DISCORD_WEBHOOK_ANUNCIOS?.trim() || ''
  return {
    hoy: () => hoyAR(),
    dia1: async () => {
      const { leerClientes } = await import('@/lib/clientes/leer')
      const d = await leerClientes()
      return new Map(d.clientes.filter(c => c.id && c.dia1).map(c => [c.id.toUpperCase(), String(c.dia1)]))
    },
    tandas: tandasPorCliente,
    entrada: entradaTraba,
    sinFin: () => clientesSinFin(),
    conCampana: async p => {
      const { tieneCampanaReciente } = await import('./docAdsServidor')
      return tieneCampanaReciente(p)
    },
    reclamar: reg.reclamarAviso,
    marcarEnviado: reg.marcarAvisoEnviado,
    soltar: reg.soltarAviso,
    enviar: async (texto, menciones) => {
      if (!webhook) throw new Error('falta DISCORD_WEBHOOK_ANUNCIOS')
      return (await enviarDiscord(webhook, partirMensaje(texto), menciones))[0] ?? ''   // en varios mensajes si es largo
    },
    menciones: {
      valen: idDiscord(process.env.DISCORD_ID_VALENTINO), tomas: mk.tomi, faus: idDiscord(process.env.DISCORD_ID_FAUS),
      rene: idDiscord(process.env.DISCORD_ID_RENE), gero_m: mk.gero_m,
    },
  }
}

export const trabadosEncendido = (): boolean => process.env.ANUNCIOS_TRABADOS?.trim() !== '0'

/** Lo que llama la alerta diaria. Nunca tira. */
export async function correrTrabados(t: Tablero, op: { dry?: boolean } = {}): Promise<ResultadoTrabados | { apagado: true }> {
  if (!trabadosEncendido()) return { apagado: true }
  try {
    return await avisarTrabados(t, await depsTrabadosReales(), op)
  } catch (e) {
    return { trabados: [], nuevos: [], texto: '', enviado: false, errores: [motivo(e)] }
  }
}
