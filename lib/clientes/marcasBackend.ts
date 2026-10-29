// ── Marcas que heredó Clientes de la sección Backend (retirada el 10/10/2026): renovación pendiente y proyección ──
// Puro (sin red ni disco): lo usan la página /clientes y GET /api/clientes, así el filtro "renovacion=1" da lo mismo en los
// dos. Se calcula en vivo con las mismas reglas de lib/backend/calculo.ts y sin leer nada más: sin cobros (pasaron a Cobro
// de cuotas) ni toques (la pestaña Acciones backend está vacía).
import { armarTablero } from '../backend/calculo'
import type { Cliente, Ymd } from './tipos'
import type { MarcaBackend } from './listado'

/** Marcas por ID de cliente (solo los de Agencia que tienen alguna). La nota es la "Llamada agendada" del CRM. */
export function marcasBackend(hoy: Ymd, clientes: Cliente[]): Map<string, MarcaBackend> {
  const tablero = armarTablero({ hoy, clientes, cobros: [], acciones: [] })
  const marcas = new Map<string, MarcaBackend>()
  const marca = (id: string) => marcas.get(id) ?? (marcas.set(id, { renovacionDias: null, proyeccion: false, notaCrm: null }), marcas.get(id)!)
  for (const r of tablero.renovaciones) marca(r.idCliente).renovacionDias = r.dias
  for (const p of tablero.proyecciones) marca(p.idCliente).proyeccion = true
  for (const c of clientes) if (c.linea === 'agencia' && c.id && marcas.has(c.id) && c.llamadaAgendada?.trim()) marca(c.id).notaCrm = c.llamadaAgendada.trim()
  return marcas
}

/** La marca de una fila del listado: solo Agencia con ID (Consultora nunca tiene) */
export const marcaDe = (marcas: ReadonlyMap<string, MarcaBackend>, c: Pick<Cliente, 'linea' | 'id'>): MarcaBackend | null =>
  c.linea === 'agencia' && c.id ? marcas.get(c.id) ?? null : null
