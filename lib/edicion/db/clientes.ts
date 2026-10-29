// ── Marcas por cliente (Neon: cj_edicion_clientes) ────────────────────────────────────────────────────────────────
// graba_equipo: los clientes que graba el equipo (no el cliente) quedan afuera de e01. Además de la tabla, la variable
// EDICION_GRABA_EQUIPO (ids separados por coma) sirve mientras no haya pantalla para marcarlo.
import type { Actor, IdCrm } from '../tipos'
import { asegurarTablas, consulta, idCrm, leer, type Fila } from './base'
import { nombreActor } from './filas'

export async function clientesGrabaEquipo(env: Record<string, string | undefined> = process.env): Promise<Set<IdCrm>> {
  const s = new Set((env.EDICION_GRABA_EQUIPO ?? '').split(',').map(x => x.trim().toUpperCase()).filter(x => /^[A-Z]\d{1,6}$/.test(x)))
  const filas = await leer('clientes que graba el equipo', [] as Fila[], q => q`SELECT id_crm FROM cj_edicion_clientes WHERE graba_equipo` as Promise<Fila[]>)
  for (const f of filas) s.add(String(f.id_crm))
  return s
}

export async function marcarGrabaEquipo(p: { id_crm: IdCrm; cliente: string; graba_equipo: boolean; actor: Actor }): Promise<void> {
  const id = idCrm(p.id_crm)
  await asegurarTablas()
  await consulta('marcar graba equipo', q => q`INSERT INTO cj_edicion_clientes (id_crm, cliente, graba_equipo, actualizado_por)
    VALUES (${id}, ${p.cliente.slice(0, 200)}, ${p.graba_equipo}, ${nombreActor(p.actor)})
    ON CONFLICT (id_crm) DO UPDATE SET graba_equipo = EXCLUDED.graba_equipo, cliente = EXCLUDED.cliente, actualizado = now(),
      actualizado_por = EXCLUDED.actualizado_por`)
}
