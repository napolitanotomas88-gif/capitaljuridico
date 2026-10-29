// ── Lo que comparten las rutas /api/fathom-anuncios y /api/fathom-anuncios/reintentar ───────────
// Las dependencias REALES del orquestador (Neon, CRM, Claude, Discord, reloj) y el cron de reintentos. Está acá y no en
// los route.ts porque un route.ts de Next solo puede exportar GET/POST/dynamic/maxDuration…, y las dos rutas lo usan.
//   · Tiempo: cada invocación tiene maxDuration 300 s. procesar.ts trabaja con un deadline de t0 + 280 s; además, acá se
//     fija un tope duro (FIN_INVOCACION_MS desde que se arman las dependencias) que ningún envío a Discord pasa, ni
//     siquiera el aviso de error a Tomás: así un Discord lento no deja la fila sin marcar porque Vercel cortó la función.
//   · El aviso a Tomás reintenta un 429 UNA vez (el retry_after completo, si entra en el tope).
//   · Los alias de nombres salen de alias.json (generado de la bóveda con scripts/fathom-alias-desde-boveda.mjs).
// Solo servidor.
import { NextResponse } from 'next/server'
import { ID_TOMAS, PREFIJO_SIN_PAYLOAD, motivoDe, reintentarPendientes, type Deps, type DepsCron } from './procesar'
import { anotarEnviados, baseConfigurada, guardarExtraccion, leerKickoff, leerPayload, marcar, marcarAgotada, marcarSinPayload, pendientes, purgarPayloadsViejos, reclamar } from './registro'
import { contextoCRM } from './contexto'
import { extraerCambios } from './extraer'
import { enviarDiscord, idDiscord } from './discord'
import type { AliasCliente } from './tipos'
import { leerAliasPrivados } from '../configPrivada'

export const FIN_INVOCACION_MS = 295_000        // maxDuration (300 s) menos un margen para responder y loguear

export const webhookDiscord = (): string =>
  process.env.DISCORD_WEBHOOK_CAMBIOS_ANUNCIOS?.trim() || process.env.DISCORD_WEBHOOK_ANUNCIOS?.trim() || ''

/** alias.json con la forma esperada (si alguien lo edita a mano y lo rompe, se descarta lo que no sirve). */
export function aliasValidos(x: unknown): AliasCliente[] {
  if (!Array.isArray(x)) return []
  return x.flatMap(a => {
    if (typeof a !== 'object' || a === null) return []
    const { escrito, cliente } = a as { escrito?: unknown; cliente?: unknown }
    if (typeof cliente !== 'string' || !cliente.trim() || !Array.isArray(escrito)) return []
    const formas = escrito.filter((e): e is string => typeof e === 'string' && !!e.trim())
    return formas.length ? [{ escrito: formas, cliente }] : []
  })
}

const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)))

export function depsReales(): Deps {
  const ALIAS = leerAliasPrivados()
  const inicio = Date.now(), fin = inicio + FIN_INVOCACION_MS
  const webhook = webhookDiscord()
  const valentino = idDiscord(process.env.DISCORD_ID_VALENTINO)
  if (!valentino) console.warn('fathom-anuncios: falta DISCORD_ID_VALENTINO (o no es un ID de Discord): los mensajes salen sin mención')
  return {
    reclamar,
    guardarExtraccion,
    anotarEnviados,
    marcar,
    contexto: () => contextoCRM(),
    extraer: extraerCambios,
    enviar: (mensajes, deadline) => enviarDiscord(webhook, mensajes, valentino ? [valentino] : [], { deadline: Math.min(deadline, fin) }),
    avisar: async texto => {
      if (!webhook) throw new Error('no hay webhook de Discord configurado')
      await enviarDiscord(webhook, [texto], [ID_TOMAS], { deadline: fin, reintentos429: 1 })
    },
    esperar: dormir,
    // Las kickoffs se saltean SIEMPRE (26/10): lo de lanzar le llega a Valentino con los videos editados (g01), no de acá
    kickoff: leerKickoff,
    alias: ALIAS,
    valentino,
    discordListo: !!webhook,
    ahora: () => Date.now(),
  }
}

export function depsCron(): DepsCron {
  return {
    ...depsReales(),
    pendientes,
    leerPayload,
    marcarSinPayload: (id, error) => marcarSinPayload(id, error, PREFIJO_SIN_PAYLOAD),
    marcarAgotada,
  }
}

/**
 * El cron diario de reintentos (GET /api/fathom-anuncios/reintentar, y GET /api/fathom-anuncios?reintentar=1 a mano).
 * Quien llama ya verificó el Bearer CRON_SECRET.
 */
export async function cronReintentos(): Promise<NextResponse> {
  const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store' } })
  if (!baseConfigurada()) return json({ error: 'falta DATABASE_URL' }, 503)
  try {
    const r = await reintentarPendientes(depsCron())
    try {
      const purgadas = await purgarPayloadsViejos()
      if (purgadas) console.log(`fathom-anuncios: se borró el payload de ${purgadas} fila(s) en error de más de 14 días`)
    } catch (e) {
      console.error('fathom-anuncios: no se pudieron purgar payloads viejos —', motivoDe(e))
    }
    if (r.revisadas) console.log(`fathom-anuncios: cron de reintentos — ${r.procesadas.map(p => `${p.recording_id} → ${p.estado}`).join(', ')}`)
    return json(r)
  } catch (e) {
    const motivo = motivoDe(e)
    console.error('fathom-anuncios: cron de reintentos falló —', motivo)
    return json({ error: motivo }, 500)
  }
}
