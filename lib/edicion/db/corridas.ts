// ── Corridas del bot (Neon: cj_grab_corridas) ─────────────────────────────────────────────────────────────────────
// El índice parcial único sobre `candado` (WHERE estado = 'corriendo') hace de candado: una sola corrida (vigía, pasada
// completa o diario) a la vez. Antes de abrir se dan por colgadas las "corriendo" de más de CORRIDA_COLGADA_MIN.
// Las fases del diario quedan en resumen.fases (diario:<ymd>:<fase>): si el cron de Hobby falla o lo corta el tiempo, el
// vigía retoma la fase pendiente (lib/bot/grabacion/diario.ts).
import type { Corrida } from '../tipos'
import { CORRIDA_COLGADA_MIN } from '../config'
import { asegurarTablas, consulta, entero, iso, isoONull, json, leer, txt, type Fila } from './base'

function aCorrida(f: Fila): Corrida {
  return {
    id: entero(f.id), tipo: txt(f.tipo) as Corrida['tipo'], origen: txt(f.origen) as Corrida['origen'], estado: txt(f.estado) as Corrida['estado'],
    inicio: iso(f.inicio), fin: isoONull(f.fin), consultas: entero(f.consultas), archivos_nuevos: entero(f.archivos_nuevos),
    tandas_cerradas: entero(f.tandas_cerradas), error: txt(f.error), resumen: json(f.resumen, {}),
  }
}

/** Abre una corrida o devuelve null si hay otra en curso. */
export async function abrirCorrida(tipo: Corrida['tipo'], origen: Corrida['origen']): Promise<Corrida | null> {
  await asegurarTablas()
  return consulta('abrir corrida', async q => {
    await q`UPDATE cj_grab_corridas SET estado = 'colgada', fin = now(), error = 'se dio por colgada'
      WHERE estado = 'corriendo' AND inicio < now() - make_interval(mins => ${CORRIDA_COLGADA_MIN}::int)`
    const [f] = await q`INSERT INTO cj_grab_corridas (tipo, origen) VALUES (${tipo}, ${origen})
      ON CONFLICT (candado) WHERE estado = 'corriendo' DO NOTHING RETURNING *` as Fila[]
    return f ? aCorrida(f) : null
  })
}

export interface CierreCorrida {
  estado: 'ok' | 'error'; consultas: number; archivos_nuevos: number; tandas_cerradas: number; error?: string; resumen: Record<string, unknown>
}
export async function cerrarCorrida(id: number, r: CierreCorrida): Promise<void> {
  await asegurarTablas()
  await consulta('cerrar corrida', q => q`UPDATE cj_grab_corridas SET estado = ${r.estado}, fin = now(), consultas = ${r.consultas},
      archivos_nuevos = ${r.archivos_nuevos}, tandas_cerradas = ${r.tandas_cerradas}, error = ${(r.error ?? '').slice(0, 500)},
      resumen = ${JSON.stringify(r.resumen)}::jsonb
    WHERE id = ${id} AND estado = 'corriendo'`)
}

export async function ultimaCorrida(tipo?: Corrida['tipo']): Promise<Corrida | null> {
  const t = tipo ?? null
  const [f] = await leer('última corrida', [] as Fila[], q => q`SELECT * FROM cj_grab_corridas
    WHERE (${t}::text IS NULL OR tipo = ${t}) AND estado IN ('ok', 'corriendo', 'error') ORDER BY inicio DESC LIMIT 1` as Promise<Fila[]>)
  return f ? aCorrida(f) : null
}

export async function corridasDesde(desde: string): Promise<Corrida[]> {
  const filas = await leer('corridas desde', [] as Fila[], q => q`SELECT * FROM cj_grab_corridas WHERE inicio >= ${desde}::timestamptz ORDER BY inicio LIMIT 500` as Promise<Fila[]>)
  return filas.map(aCorrida)
}

/** Las fases del diario hechas hoy (resumen.fases de las corridas desde `desde`). */
export async function fasesHechas(desde: string): Promise<Set<string>> {
  const filas = await leer('fases del diario', [] as Fila[], q => q`SELECT resumen -> 'fases' AS fases FROM cj_grab_corridas
    WHERE inicio >= ${desde}::timestamptz AND resumen ? 'fases'` as Promise<Fila[]>)
  const s = new Set<string>()
  for (const f of filas) for (const x of json<unknown[]>(f.fases, [])) if (typeof x === 'string') s.add(x)
  return s
}
