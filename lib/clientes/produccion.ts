// ── Producción: ClickUp "Clientes 2026" y campañas de Meta por cliente (SOLO servidor) ─────────────────────────────
// Lee lo que necesitan el bloque "sin campaña lanzada" de Clientes y la tabla de Guiones. Con caché compartida (la misma de
// /anuncios) y sin frenar la página: si Meta tarda, se muestra sin ese dato y se avisa.
import { conCache } from '../anuncios/cache'
import { claveNombre, type CampanaMeta, type TareaClickUp } from './prioridad'
import { hoyArgentina, sumarDias, type Ymd } from './fechas'

const LISTA = () => { const id = process.env.CLICKUP_LIST_ID?.trim(); if (!id) throw new Error('Falta CLICKUP_LIST_ID'); return id }
const ymd = (ms: unknown): Ymd | null => {
  const n = Number(ms)
  return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) : null
}

async function leerDeClickUp(): Promise<TareaClickUp[]> {
  const token = process.env.CLICKUP_TOKEN
  if (!token) throw new Error('Falta CLICKUP_TOKEN')
  type T = { id: string; name: string; url: string; parent: string | null; status: { status: string }; date_created?: string; date_updated?: string; date_done?: string | null }
  const todas: T[] = []
  for (let p = 0; p < 12; p++) {
    const r = await fetch(`https://api.clickup.com/api/v2/list/${LISTA()}/task?include_closed=true&subtasks=true&page=${p}`, { headers: { Authorization: token }, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!r.ok) throw new Error(`ClickUp respondió ${r.status}`)
    const j = (await r.json()) as { tasks?: T[]; last_page?: boolean }
    todas.push(...(j.tasks ?? []))
    if (j.last_page || !(j.tasks ?? []).length) break
  }
  const hechosPorPadre = new Map<string, Ymd[]>()
  for (const t of todas) {
    if (!t.parent || !/^gui[oó]n\b/i.test(t.name) || !t.date_done) continue
    const f = ymd(t.date_done)
    if (f) hechosPorPadre.set(t.parent, [...(hechosPorPadre.get(t.parent) ?? []), f])
  }
  return todas.filter(t => !t.parent).map(t => ({
    id: t.id, nombre: t.name.trim(), estado: t.status.status.toLowerCase().trim(), url: t.url,
    creada: ymd(t.date_created), actualizada: ymd(t.date_updated), guionesHechos: hechosPorPadre.get(t.id) ?? [],
  }))
}

/** Tareas de "Clientes 2026" (caché de 10 min). null = no se pudo leer. */
export async function tareasClickUp(): Promise<{ tareas: TareaClickUp[]; aviso: string | null }> {
  try {
    const r = await conCache('clickup-clientes-2026-v1', 600, leerDeClickUp)
    return { tareas: r.data, aviso: r.viejo ? 'ClickUp no respondió: se muestran los datos de la última lectura.' : null }
  } catch (e) {
    console.error('[produccion] ClickUp:', (e as Error).message?.slice(0, 120))
    return { tareas: [], aviso: 'No se pudo leer ClickUp: sin etapas de producción.' }
  }
}

/** Campañas de Meta por cliente del CRM, tomadas del tablero de /anuncios. Espera hasta `esperaMs`; si no llega, sigue sin ellas. */
export async function campanasMeta(esperaMs = 4000): Promise<{ porCliente: Map<string, CampanaMeta>; aviso: string | null }> {
  const vacio = new Map<string, CampanaMeta>()
  try {
    const { obtenerTablero } = await import('../anuncios/tablero')
    const tablero = await Promise.race([obtenerTablero(), new Promise<null>(r => setTimeout(() => r(null), esperaMs))])
    if (!tablero) return { porCliente: vacio, aviso: 'Meta tardó en responder: se muestra sin el dato de campañas (recargá en un minuto).' }
    const porCliente = new Map<string, CampanaMeta>()
    const hoy = hoyArgentina()
    for (const f of tablero.filas) {
      const nombre = f.clienteCRM || f.cliente
      if (!nombre) continue
      const k = claveNombre(nombre)
      const activa = !f.pausado && f.gasto.d7 > 0 && !f.corriendo.sinAnunciosActivos
      const detectado = f.lanzamientos.map(l => l.fecha).filter(Boolean).sort().pop() ?? null
      // Meta solo informa lanzamientos recientes: si no hay, se usa desde cuándo viene corriendo la campaña (aproximado)
      const corriendoDesde = activa && f.corriendo.dias > 0 ? sumarDias(hoy, -f.corriendo.dias) : null
      const lanz = detectado ?? corriendoDesde
      const previo = porCliente.get(k)
      const primero = [...f.lanzamientos.map(l => l.fecha).filter(Boolean), corriendoDesde, previo?.primerLanzamiento ?? null].filter((x): x is string => !!x).sort()[0] ?? null
      porCliente.set(k, {
        primerLanzamiento: primero,
        activa: activa || !!previo?.activa,
        ultimoLanzamiento: [lanz, previo?.ultimoLanzamiento ?? null].filter((x): x is string => !!x).sort().pop() ?? null,
        lanzamientoAprox: !detectado && !!corriendoDesde && !(previo && !previo.lanzamientoAprox && previo.ultimoLanzamiento),
        semaforo: previo?.semaforo === 'rojo' ? 'rojo' : f.semaforo ?? previo?.semaforo ?? null,
        aGrabar: f.aGrabar === 'no_rinde' || previo?.aGrabar === 'no_rinde' ? 'no_rinde' : f.aGrabar ?? previo?.aGrabar ?? null,
      })
    }
    return { porCliente, aviso: null }
  } catch (e) {
    console.error('[produccion] Meta:', (e as Error).message?.slice(0, 120))
    return { porCliente: vacio, aviso: 'No se pudo leer Meta: se muestra sin el dato de campañas.' }
  }
}
