// ── ClickUp (lista «Sistema de Edición»): lectura y escritura mínimas para la sincronización con el tablero (4/11/2026) ──
// Pedido de Tomás: «mantenelo sincronizado con ambas» (ClickUp y el tablero del Despacho). El token (CLICKUP_TOKEN), la
// lista (CLICKUP_LISTA_EDICION), el equipo (CLICKUP_EQUIPO) y los IDs de usuario van por entorno: el repo es público.
// Fetch inyectable: los tests nunca llaman a ClickUp. Los campos personalizados se ubican por NOMBRE («1 - Paleta…»,
// «2 - Crudo», «3 - Editado»), nunca por ID fijo.
import { tareaDesdeClickUp, type TareaCruda, type TareaClickUpEdicion } from './importar'

export const API_CLICKUP = 'https://api.clickup.com/api/v2'
export const PRIORIDAD_CLICKUP: Record<string, number> = { urgent: 1, urgente: 1, high: 2, alta: 2, normal: 3, low: 4, baja: 4 }

export interface TareaSync extends TareaClickUpEdicion {
  asignados: string[]
  descripcion: string
  lista: string | null
}
export interface ClickUp {
  tarea(id: string): Promise<TareaSync | null>
  /** Las tareas de la lista (con subtareas y cerradas) modificadas después de `desdeMs` (0 = todas). */
  modificadas(desdeMs: number, tope?: number): Promise<TareaSync[]>
  comentarios(id: string): Promise<{ texto: string; fecha: string }[]>
  crear(t: { nombre: string; estado: string; padre: string | null; descripcion: string; prioridad: string | null; asignados: number[]; campos: { paleta: string; crudo: string; editado: string } }): Promise<TareaSync>
  estado(id: string, estado: string): Promise<void>
  campo(id: string, campo: 'paleta' | 'crudo' | 'editado', valor: string): Promise<void>
  comentar(id: string, texto: string): Promise<void>
  /** Las tareas creadas desde `desdeMs` cuya descripción tiene la marca (para no duplicar un alta de resultado dudoso). */
  buscarMarca(marca: string, desdeMs: number): Promise<TareaSync | null>
}

export const tokenClickUp = (env: Record<string, string | undefined> = process.env): string | null => env.CLICKUP_TOKEN?.trim() || null
export const listaClickUp = (env: Record<string, string | undefined> = process.env): string | null => { const l = env.CLICKUP_LISTA_EDICION?.trim() ?? ''; return /^\d{3,20}$/.test(l) ? l : null }
/** ID de usuario de ClickUp de una persona (CLICKUP_ID_RENE, CLICKUP_ID_AYLU…). */
export const idUsuarioClickUp = (quien: string, env: Record<string, string | undefined> = process.env): number | null => { const n = Number(env[`CLICKUP_ID_${quien.toUpperCase()}`]); return Number.isSafeInteger(n) && n > 0 ? n : null }

interface Cruda extends TareaCruda { assignees?: { username?: unknown; email?: unknown }[]; description?: unknown; text_content?: unknown; list?: { id?: unknown } }
export function tareaSync(t: Cruda): TareaSync {
  return { ...tareaDesdeClickUp(t), asignados: (t.assignees ?? []).map(a => String(a.username ?? '').trim()).filter(Boolean), descripcion: String(t.text_content ?? t.description ?? ''), lista: t.list?.id ? String(t.list.id) : null }
}

const CAMPO_NOMBRE: Record<'paleta' | 'crudo' | 'editado', RegExp> = { paleta: /^1\s*-\s*paleta/i, crudo: /^2\s*-\s*crudo/i, editado: /^3\s*-\s*editado/i }
const idSeguro = (id: string) => { if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) throw new Error('ID de ClickUp inválido'); return id }

export function crearClickUp(op: { token: string; lista: string; fetch?: typeof fetch; timeoutMs?: number }): ClickUp {
  const f = op.fetch ?? fetch
  let campos: Promise<Record<string, string>> | null = null
  async function pedir<T>(ruta: string, init: { method?: string; cuerpo?: unknown } = {}): Promise<T> {
    const r = await f(`${API_CLICKUP}${ruta}`, { method: init.method ?? 'GET', headers: { authorization: op.token, 'content-type': 'application/json' }, body: init.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo), signal: AbortSignal.timeout(op.timeoutMs ?? 15_000), cache: 'no-store' })
    const texto = await r.text()
    if (!r.ok) throw Object.assign(new Error(`ClickUp respondió ${r.status}: ${texto.replace(/pk_[A-Za-z0-9_]+/g, '[token]').slice(0, 160)}`), { status: r.status })
    return (texto ? JSON.parse(texto) : {}) as T
  }
  const idsCampos = () => (campos ??= pedir<{ fields?: { id: string; name: string }[] }>(`/list/${op.lista}/field`).then(r => {
    const out: Record<string, string> = {}
    for (const [k, re] of Object.entries(CAMPO_NOMBRE)) { const c = (r.fields ?? []).find(x => re.test(x.name)); if (c) out[k] = c.id }
    return out
  }).catch(e => { campos = null; throw e }))
  async function pagina(q: string): Promise<TareaSync[]> {
    const out: TareaSync[] = []
    for (let p = 0; p < 40; p++) {
      const r = await pedir<{ tasks?: Cruda[]; last_page?: boolean }>(`/list/${op.lista}/task?subtasks=true&include_closed=true&archived=false&order_by=updated&reverse=true&page=${p}${q}`)
      const ts = r.tasks ?? []
      out.push(...ts.map(tareaSync))
      if (r.last_page !== false || !ts.length) break
    }
    return out
  }
  return {
    async tarea(id) {
      try { return tareaSync(await pedir<Cruda>(`/task/${idSeguro(id)}?include_subtasks=false`)) } catch (e) { if ([401, 404].includes(Number((e as { status?: number }).status)) && /ITEM_015|not found|Task not found/i.test((e as Error).message)) return null; if ((e as { status?: number }).status === 404) return null; throw e }
    },
    async modificadas(desdeMs, tope = 2000) { return (await pagina(desdeMs > 0 ? `&date_updated_gt=${Math.floor(desdeMs)}` : '')).slice(0, tope) },
    async comentarios(id) { const r = await pedir<{ comments?: { comment_text?: string; date?: string }[] }>(`/task/${idSeguro(id)}/comment`); return (r.comments ?? []).map(c => ({ texto: String(c.comment_text ?? ''), fecha: new Date(Number(c.date ?? 0)).toISOString() })) },
    async crear(t) {
      const ids = await idsCampos()
      const custom = (['paleta', 'crudo', 'editado'] as const).filter(k => t.campos[k] && ids[k]).map(k => ({ id: ids[k], value: t.campos[k] }))
      const cuerpo = { name: t.nombre.slice(0, 200), description: t.descripcion, status: t.estado, ...(t.padre ? { parent: idSeguro(t.padre) } : {}), ...(t.prioridad && PRIORIDAD_CLICKUP[t.prioridad] ? { priority: PRIORIDAD_CLICKUP[t.prioridad] } : {}), ...(t.asignados.length ? { assignees: t.asignados } : {}), ...(custom.length ? { custom_fields: custom } : {}) }
      return tareaSync(await pedir<Cruda>(`/list/${op.lista}/task`, { method: 'POST', cuerpo }))
    },
    async estado(id, estado) { await pedir(`/task/${idSeguro(id)}`, { method: 'PUT', cuerpo: { status: estado } }) },
    async campo(id, campo, valor) {
      const ids = await idsCampos()
      if (!ids[campo]) throw new Error(`La lista de ClickUp no tiene el campo «${campo}»`)
      if (valor) await pedir(`/task/${idSeguro(id)}/field/${ids[campo]}`, { method: 'POST', cuerpo: { value: valor } })
      else await pedir(`/task/${idSeguro(id)}/field/${ids[campo]}`, { method: 'DELETE' })
    },
    async comentar(id, texto) { await pedir(`/task/${idSeguro(id)}/comment`, { method: 'POST', cuerpo: { comment_text: texto.slice(0, 4000), notify_all: false } }) },
    async buscarMarca(marca, desdeMs) {
      const r = await pagina(`&date_created_gt=${Math.floor(desdeMs)}`)
      return r.find(t => t.descripcion.includes(marca)) ?? null
    },
  }
}

export function clickupReal(env: Record<string, string | undefined> = process.env): ClickUp | null {
  const token = tokenClickUp(env), lista = listaClickUp(env)
  return token && lista ? crearClickUp({ token, lista }) : null
}
