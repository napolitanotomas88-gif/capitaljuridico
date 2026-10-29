// ── Clientes del CRM para la ficha de kickoff (best effort, solo lectura) ─────────────────────────
// Igual que lib/fathomAnuncios/contexto.ts, pero con el ID del CRM (A0xx / C0xx): la ficha se guarda por cliente y el
// link del aviso va a /clientes/<id>/kickoff. Fuentes, todas de solo lectura:
//   · CRM Clientes (Agencia y Consultora) con lib/clientes/leer.ts (snapshot de 10 min: casi nunca le pega a Sheets);
//   · las cuentas publicitarias de cada cliente con contextoCRM() de fathomAnuncios ("Cuentas Meta" por la caché del tablero
//     y AJUSTES_CUENTA): sirven para sacar de los ganadores las cuentas del propio cliente. Las dos lecturas comparten el
//     mismo snapshot del CRM (obtenerHojas deduplica los pedidos simultáneos).
// Tope de TOPE_MS: si el CRM falla o tarda se sigue con la lista vacía (estado 'sin_crm', queda en el registro) y el cliente
// sale "sin verificar". Si solo fallan las cuentas, van los clientes sin cuentas. Imports dinámicos: las partes puras se
// prueban sin googleapis. Los motivos de error pasan por motivoDe (sin URLs ni claves): el del CRM termina en los ajustes
// de la ficha (Neon) y en la respuesta del modo manual, y un error de googleapis puede traer la URL con el id de la planilla.
import { normNombre } from '@/lib/fathomAnuncios/contexto'
import { motivoDe } from '@/lib/fathomAnuncios/procesar'
import type { ClienteCRMKickoff, ContextoKickoff } from './tipos'
import { leerArchivados, excluirArchivados } from '@/lib/clientes/archivados'

export const TOPE_MS = 8_000
const MAX_CLIENTES = 400
const ORDEN_ESTADO: Record<string, number> = { ACTIVO: 0, PAUSADO: 1 }

export interface FuentesKickoff {
  clientes: { id: string; nombre: string; estado: string; mail: string }[]
  cuentasPorNombre: { nombre: string; cuentas: string[] }[]
}

/** Arma la lista (pura): un cliente por ID (o por nombre si no tiene), con sus cuentas; vigentes primero. */
export function armarClientesKickoff(f: FuentesKickoff): ClienteCRMKickoff[] {
  const cuentas = new Map(f.cuentasPorNombre.map(c => [normNombre(c.nombre), c.cuentas]))
  const vistos = new Map<string, ClienteCRMKickoff>()
  for (const c of f.clientes) {
    const nombre = c.nombre.replace(/\s+/g, ' ').trim()
    if (!nombre) continue
    const id = c.id.trim().toUpperCase()
    const k = id || `sin-id:${normNombre(nombre)}`
    const estado = (c.estado || '').toUpperCase()
    const prev = vistos.get(k)
    if (prev && (ORDEN_ESTADO[prev.estado] ?? 2) <= (ORDEN_ESTADO[estado] ?? 2)) continue
    vistos.set(k, { id, nombre, estado, email: (c.mail || '').trim(), cuentas: cuentas.get(normNombre(nombre)) ?? [] })
  }
  return [...vistos.values()]
    .sort((a, b) => (ORDEN_ESTADO[a.estado] ?? 2) - (ORDEN_ESTADO[b.estado] ?? 2) || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, MAX_CLIENTES)
}

const conTope = <T,>(p: Promise<T>, ms: number, que: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${que}: tardó más de ${ms / 1000} s`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })

/** Lee el CRM con tope de tiempo. Nunca lanza. */
export async function contextoKickoff(topeMs: number = TOPE_MS): Promise<ContextoKickoff> {
  const [crm, cuentas, archivados] = await Promise.allSettled([
    conTope(import('@/lib/clientes/leer').then(m => m.leerClientes()), topeMs, 'CRM Clientes'),
    conTope(import('@/lib/fathomAnuncios/contexto').then(m => m.contextoCRM(topeMs)), topeMs, 'Cuentas Meta'),
    conTope(leerArchivados(), topeMs, 'Estado actual del CRM'),
  ])
  if (crm.status === 'rejected') {
    const aviso = motivoDe(crm.reason).slice(0, 200)
    console.error('bot-kickoff: sin lista de clientes del CRM —', aviso)
    return { clientes: [], estado: 'sin_crm', aviso }
  }
  if (archivados.status === 'rejected') return { clientes: [], estado: 'sin_crm', aviso: 'No se pudo confirmar qué clientes siguen en el Hub.' }
  const cuentasPorNombre = cuentas.status === 'fulfilled' ? cuentas.value.clientes.map(c => ({ nombre: c.nombre, cuentas: c.cuentas })) : []
  if (cuentas.status === 'rejected') console.error('bot-kickoff: sin cuentas publicitarias —', motivoDe(cuentas.reason))
  const clientes = armarClientesKickoff({
    clientes: excluirArchivados(crm.value.clientes, archivados.value, c => c.id).map(c => ({ id: c.id, nombre: c.nombre, estado: c.estado, mail: c.mail })),
    cuentasPorNombre,
  })
  return clientes.length ? { clientes, estado: 'ok' } : { clientes: [], estado: 'sin_crm', aviso: 'el CRM no devolvió clientes' }
}
