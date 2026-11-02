// ── Continuidad: lo que muestran el panel «Pendientes de llamada de proyección» y la tarjeta del cliente ─────────────────
// Misma regla y mismas marcas que el cron (reglas.ts + marcas.ts): una sola fuente. Lee el CRM que ya cargó la página
// (sin otra lectura de la planilla) y las marcas de Neon. No lee Calendly en cada carga: lo agendado en Calendly lo anota
// el cron (10:40 y 18:00) y desde ahí se ve acá. SOLO servidor.
import type { ClienteBaja } from '@/lib/bot/bajas/fin'
import { clientesPrueba } from '@/lib/bot/bajas/prueba'
import { clientesSinFin } from '@/lib/clientes/sinFin'
import type { Cliente } from '@/lib/clientes/tipos'
import type { Ymd } from '@/lib/clientes/fechas'
import { leerMarcasProyeccion } from './marcas'
import { ATRASO_MAX_DIAS, candidatosProyeccion, estadoProyeccion, marcaVigente, type Fase, type FuenteAgenda, type MarcaProyeccion, type Resultado } from './reglas'

export interface ItemProyeccion {
  id: string; nombre: string; fin: Ymd; dias: number; fase: Fase
  avisado: Ymd | null
  agendada: Ymd | null; agendadaFuente: FuenteAgenda | null
  resultado: Resultado | null; resultadoFecha: Ymd | null
}

export const aClienteBaja = (k: Pick<Cliente, 'id' | 'nombre' | 'estado' | 'linea' | 'mail' | 'celular' | 'dia1' | 'finPeriodo' | 'periodos' | 'fechaBaja' | 'satisfaccion' | 'esNoCliente'>): ClienteBaja => ({
  id: k.id, nombre: k.nombre, estado: k.estado, linea: k.linea, mail: k.mail, celular: k.celular, dia1: k.dia1, finPeriodo: k.finPeriodo,
  periodos: k.periodos.map((p) => ({ fin: p.fin, meses: p.meses, periodo: p.periodo })), fechaBaja: k.fechaBaja, satisfaccion: k.satisfaccion, esNoCliente: k.esNoCliente,
})

/** PURO: los clientes en la ventana (−30 a +14 días) con su estado, los pendientes primero y lo hecho al final. */
export function itemsProyeccion(clientes: readonly ClienteBaja[], marcas: readonly MarcaProyeccion[], hoy: Ymd, env: Record<string, string | undefined> = process.env): ItemProyeccion[] {
  const cands = candidatosProyeccion(clientes, hoy, { sinFin: clientesSinFin(env), prueba: clientesPrueba(env as NodeJS.ProcessEnv) }, ATRASO_MAX_DIAS)
  const orden: Record<Fase, number> = { atrasado: 0, agendar: 1, invitar: 2, agendada: 3, hecha: 4 }
  return cands.map((c) => {
    const s = estadoProyeccion(c, marcaVigente(marcas, c.cliente.id, c.fin), null)
    return {
      id: c.cliente.id.toUpperCase(), nombre: c.cliente.nombre, fin: c.fin, dias: c.dias, fase: s.fase, avisado: s.avisado,
      agendada: s.agendada?.fecha ?? null, agendadaFuente: s.agendada?.fuente ?? null, resultado: s.resultado, resultadoFecha: s.resultadoFecha,
    }
  }).sort((a, b) => orden[a.fase] - orden[b.fase] || a.dias - b.dias)
}

/** Para la página: nunca tira (sin base o con la base caída, `error` y la lista con lo que se pueda). */
export async function cargarProyeccion(clientes: readonly Cliente[], hoy: Ymd): Promise<{ items: ItemProyeccion[]; error: boolean }> {
  let marcas: MarcaProyeccion[] = []
  let error = false
  try { marcas = await leerMarcasProyeccion() } catch (e) {
    error = true
    console.error('[proyección] no se pudieron leer las marcas:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
  }
  return { items: itemsProyeccion(clientes.map(aClienteBaja), marcas, hoy), error }
}
