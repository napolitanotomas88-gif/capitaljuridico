// ── Avisos de Anuncios al grupo ADS por WhatsApp: dependencias reales (Whapi con guardia de salud, candado en Neon) ─────
// Ver whatsappEquipo.ts. Solo servidor.
import { neon } from '@neondatabase/serverless'
import { crearClienteWhapi } from '../whapi/cliente'
import { tokenWhapi } from '../whapi/config'
import { urlDespacho } from '@/lib/edicion/avisos/entorno'
import type { ResultadoSeguimiento } from './procesar'
import type { ResultadoVideos } from './videos'
import { ESPACIO_MIN_MS, avisarEquipo, equipoEncendido, maxPorDia, telValentino, textoResumen, textoSuelto, type DepsEquipo, type EstadoEquipo, type ItemResumen } from './whatsappEquipo'

export const RECURSO_TURNO = 'anuncios_wa_equipo'

/** Candado en cj_altas_recursos (la misma tabla que la guardia de salud): una fila con el próximo turno y la cuenta del día. */
async function reclamarTurnoNeon(env: NodeJS.ProcessEnv): Promise<boolean> {
  const url = env.DATABASE_URL?.trim()
  if (!url) return false   // sin base no hay cómo espaciar entre instancias: no se manda (Discord ya lo tiene)
  const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
  const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const segundos = Math.round(ESPACIO_MIN_MS / 1000), max = maxPorDia(env)
  await q`CREATE TABLE IF NOT EXISTS cj_altas_recursos (nombre text PRIMARY KEY, dueno text, hasta timestamptz, datos jsonb)`
  const r = await q`INSERT INTO cj_altas_recursos (nombre, dueno, hasta, datos)
    VALUES (${RECURSO_TURNO}, 'anuncios', now() + make_interval(secs => ${segundos}), jsonb_build_object('dia', ${dia}::text, 'n', 1))
    ON CONFLICT (nombre) DO UPDATE SET dueno = EXCLUDED.dueno, hasta = EXCLUDED.hasta,
      datos = CASE WHEN cj_altas_recursos.datos->>'dia' = ${dia} THEN jsonb_build_object('dia', ${dia}::text, 'n', (cj_altas_recursos.datos->>'n')::int + 1) ELSE EXCLUDED.datos END
    WHERE (cj_altas_recursos.hasta IS NULL OR cj_altas_recursos.hasta < now())
      AND (cj_altas_recursos.datos->>'dia' IS DISTINCT FROM ${dia} OR coalesce((cj_altas_recursos.datos->>'n')::int, 0) < ${max})
    RETURNING nombre`
  return r.length > 0
}

export function depsEquipo(env: NodeJS.ProcessEnv = process.env): DepsEquipo {
  const grupo = env.WHAPI_GRUPO_ADS?.trim() || ''
  return {
    encendido: equipoEncendido(env),
    tel: telValentino(env),
    reclamarTurno: () => reclamarTurnoNeon(env),
    async enviar(texto, menciones) {
      const token = tokenWhapi()
      if (!token) throw new Error('falta WHAPI_TOKEN')
      if (!/@g\.us$/.test(grupo)) throw new Error('falta WHAPI_GRUPO_ADS')
      return (await crearClienteWhapi({ token }).enviarTexto({ chatId: grupo, texto, menciones })).id ?? null
    },
  }
}

/** Lo que salió hoy por Discord en la alerta diaria (seguimiento + videos nuevos), en un solo mensaje. */
export function itemsDelDia(seg: ResultadoSeguimiento | { apagado: true }, vid: ResultadoVideos | { apagado: true }): ItemResumen[] {
  const a = 'avisos' in seg ? seg.avisos.filter(x => x.estado === 'enviado').map(x => ({ tipo: x.tipo as string, cliente: x.cliente })) : []
  const b = 'avisos' in vid ? vid.avisos.filter(x => x.estado === 'enviado').map(x => ({ tipo: 'videos', cliente: x.cliente })) : []
  return [...a, ...b]
}

/** Lo que llama la ruta de la alerta diaria al final. Nunca tira. */
export async function resumenEquipoWhatsapp(seg: ResultadoSeguimiento | { apagado: true }, vid: ResultadoVideos | { apagado: true }, env: NodeJS.ProcessEnv = process.env): Promise<{ estado: EstadoEquipo; motivo?: string }> {
  const d = depsEquipo(env)
  return avisarEquipo(textoResumen(itemsDelDia(seg, vid), `${urlDespacho(env)}/anuncios`, d.tel), d)
}

/** Un aviso suelto que ya salió por Discord (las notas del cliente). Nunca tira. */
export async function avisoSueltoWhatsapp(textoDiscord: string, env: NodeJS.ProcessEnv = process.env): Promise<{ estado: EstadoEquipo; motivo?: string }> {
  const d = depsEquipo(env)
  return avisarEquipo(textoSuelto(textoDiscord, d.tel), d)
}
