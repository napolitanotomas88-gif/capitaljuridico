// ── Dependencias reales del seguimiento de anuncios (Meta, planilla, Neon, Discord) ─────────────────
// Canal: #📣-ads (DISCORD_WEBHOOK_ANUNCIOS), mencionando solo a Valentino (DISCORD_ID_VALENTINO). Interruptor:
// ANUNCIOS_SEGUIMIENTO=0 lo apaga (la alerta diaria sigue igual). Solo servidor.
import type { Tablero } from '@/lib/anuncios/tablero'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import { leerOptimizaciones, registrarOptimizacion } from '@/lib/anuncios/optimizaciones'
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { leerDetalles } from './metaDetalle'
import { elegirGrupoVentas, enviarAlGrupo, grupoFijado, gruposDelBot, permitidaWhatsApp } from './whatsapp'
import { anotarWhatsapp, avisoReciente, avisosRegistrados, marcarAvisoDudoso, marcarAvisoEnviado, reclamarAviso, soltarAviso, videosAvisadosHasta } from './registro'
import { leerEditados } from './editadosDrive'
import { avisarVideosNuevos, type DepsVideos, type ResultadoVideos } from './videos'
import { armarBorrador, borradorPermitido, crearGraph, type Borrador, type DepsBorrador } from './borrador'
import { escribirTextos, gruposConTextos } from './copys'
import { armarLanzamiento } from './lanzamiento'
import { estimarHabitantes } from './habitantes'
import { lectorReal } from '@/lib/bot/grabacion/drive'
import type { ZonaFicha } from '@/lib/bot/kickoff/tipos'
import { seguimientoAnuncios, type DepsSeguimiento, type ResultadoSeguimiento } from './procesar'

export const seguimientoEncendido = (): boolean => process.env.ANUNCIOS_SEGUIMIENTO?.trim() !== '0'

export function depsSeguimiento(): DepsSeguimiento {
  const webhook = process.env.DISCORD_WEBHOOK_ANUNCIOS?.trim() || ''
  const valentino = idDiscord(process.env.DISCORD_ID_VALENTINO)
  return {
    clienteOperativo,
    detalles: leerDetalles,
    optimizaciones: leerOptimizaciones,
    registrarOptimizacion,
    reclamar: reclamarAviso,
    marcarEnviado: marcarAvisoEnviado,
    marcarDudoso: marcarAvisoDudoso,
    soltar: soltarAviso,
    yaSalieron: avisosRegistrados,
    reciente: avisoReciente,
    esperar: ms => new Promise<void>(r => setTimeout(r, ms)),
    enviar: async (texto, deadline) => {
      if (!webhook) throw Object.assign(new Error('falta DISCORD_WEBHOOK_ANUNCIOS'), { transitorio: false })
      const ids = await enviarDiscord(webhook, [texto], valentino ? [valentino] : [], { deadline })
      return ids[0] ?? ''
    },
    whatsapp: { permitida: c => permitidaWhatsApp(c), grupos: () => gruposDelBot(), elegir: (cliente, grupos, cuenta) => {
      // Fijado a mano: tiene que estar entre los grupos del bot (si no, el bot no está adentro y no puede escribir)
      const id = grupoFijado(cuenta)
      const g = id ? grupos.find(x => x.id === id) : null
      return g?.id ? { id: g.id, nombre: g.name ?? g.id } : elegirGrupoVentas(cliente, grupos)
    }, enviar: enviarAlGrupo, anotar: anotarWhatsapp },
    valentino,
    ahora: () => Date.now(),
  }
}

// g01: videos nuevos en «Editados - X» (videos.ts). ANUNCIOS_VIDEOS=0 lo apaga.
export const videosEncendido = (): boolean => process.env.ANUNCIOS_VIDEOS?.trim() !== '0'

export function depsVideos(t?: Pick<Tablero, 'filas'>): DepsVideos {
  const s = depsSeguimiento()
  const token = process.env.META_ANUNCIOS_TOKEN?.trim()
  // g03: todo en pausa (borrador.ts / lanzamiento.ts), apagado salvo ANUNCIOS_BORRADOR=real. Sin token, no se intenta.
  const base = (nombre: string): DepsBorrador => {
    const graph = crearGraph(token!)
    return {
      graph: { ...graph, post: async (ruta, cuerpo) => {
        if (!await clienteOperativo(null, nombre)) throw Object.assign(new Error('Cliente archivado: no se crean anuncios nuevos'), { transitorio: false })
        return graph.post(ruta, cuerpo)
      } },
      esperar: ms => new Promise<void>(r => setTimeout(r, ms)), ahora: () => Date.now(),
    }
  }
  const copys = { exportarTexto: (id: string) => lectorReal().exportarTexto(id), escribir: escribirTextos }
  const conAviso = (b: Borrador, aviso: string | null) => { if (aviso) b.faltan.push(aviso); return b }
  // La cotización de cada moneda: la que el tablero ya usa en las filas de esa moneda
  const usdPor = (m: string) => m.toUpperCase() === 'USD' ? 1 : t?.filas.find(f => f.moneda?.toUpperCase() === m.toUpperCase() && f.usdPor)?.usdPor ?? null
  const borrador: DepsVideos['borrador'] = token ? {
    permitido: c => borradorPermitido(c),
    armar: async (sub, fila, estructura, deadline) => {
      const { grupos, aviso } = await gruposConTextos(sub, sub.guionesDoc ?? null, copys)
      return conAviso(await armarBorrador(sub, fila, grupos, estructura, base(fila.clienteCRM ?? fila.cliente), deadline), aviso)
    },
  } : undefined
  const lanzar: DepsVideos['lanzar'] = token ? {
    armar: async (sub, pl, deadline) => {
      const { grupos, aviso } = await gruposConTextos(sub, sub.guionesDoc ?? null, copys)
      const z = pl.kickoff!.zona
      const habitantes = async () => (await estimarHabitantes({ descripcion: z.descripcion, lugares: z.lugares, radio_km: z.radioKm, pais: z.pais ?? null } as ZonaFicha, 40_000)).habitantes
      return conAviso(await armarLanzamiento(sub, pl, grupos, { ...base(pl.cliente), usdPor, habitantes }, deadline), aviso)
    },
  } : undefined
  return { clienteOperativo, borrador, lanzar, editados: leerEditados, avisadoHasta: videosAvisadosHasta, reclamar: reclamarAviso, marcarEnviado: marcarAvisoEnviado, marcarDudoso: marcarAvisoDudoso, soltar: soltarAviso, enviar: s.enviar, valentino: s.valentino, ahora: () => Date.now() }
}

/** Lo que llama la ruta de la alerta diaria, después del seguimiento. Nunca tira. */
export async function correrVideos(t: Tablero, op: { dry?: boolean; deadline?: number } = {}): Promise<ResultadoVideos | { apagado: true }> {
  if (!videosEncendido()) return { apagado: true }
  try {
    return await avisarVideosNuevos(t, depsVideos(t), op)
  } catch (e) {
    return { carpetas: 0, avisos: [], errores: [String((e as Error)?.message ?? e).slice(0, 200)] }
  }
}

/** Lo que llama la ruta de la alerta diaria. Nunca tira. */
export async function correrSeguimiento(t: Tablero, op: { dry?: boolean; deadline?: number } = {}): Promise<ResultadoSeguimiento | { apagado: true }> {
  if (!seguimientoEncendido()) return { apagado: true }
  try {
    return await seguimientoAnuncios(t, depsSeguimiento(), op)
  } catch (e) {
    return { candidatos: 0, avisos: [], registradas: [], omitidos: [], errores: [String((e as Error)?.message ?? e).slice(0, 200)] }
  }
}
