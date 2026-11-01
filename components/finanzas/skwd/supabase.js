// Base de Finanzas SKWD: desde el 1/11/2026 vive en Neon (decisión de Tomás: «no lo vamos a usar más [Supabase]»).
// Las pantallas son las de la app original y siguen escribiendo `supabase.from(...).select(...)...` como con supabase-js:
// este módulo arma el mismo pedido y lo manda a /api/finanzas/db, que lo traduce a SQL con el correo de la sesión del
// Despacho (lib/finanzasSkwd/baseNeon.ts). Solo lo que usan las pantallas: select/insert/update/upsert/delete, filtros
// eq/neq/gt/gte/lt/lte/in/is/match, order, limit, single/maybeSingle. Devuelve { data, error } como supabase-js.

class Consulta {
  constructor(tabla) { this.p = { tabla, accion: 'select', columnas: '*', filtros: [], orden: [], limite: null, uno: null } }
  select(columnas = '*') { this.p.columnas = columnas; return this }   // después de una escritura: lo que devuelve (returning)
  insert(datos) { return this.#escritura('insert', datos) }
  update(datos) { return this.#escritura('update', datos) }
  upsert(datos, opciones = {}) { this.p.enConflicto = opciones.onConflict ?? null; return this.#escritura('upsert', datos) }
  delete() { return this.#escritura('delete') }
  #escritura(accion, datos) { Object.assign(this.p, { accion, datos, columnas: null }); return this }
  #filtro(op, columna, valor) { this.p.filtros.push([op, columna, valor]); return this }
  eq(c, v) { return this.#filtro('eq', c, v) }
  neq(c, v) { return this.#filtro('neq', c, v) }
  gt(c, v) { return this.#filtro('gt', c, v) }
  gte(c, v) { return this.#filtro('gte', c, v) }
  lt(c, v) { return this.#filtro('lt', c, v) }
  lte(c, v) { return this.#filtro('lte', c, v) }
  in(c, v) { return this.#filtro('in', c, v) }
  is(c, v) { return this.#filtro('is', c, v) }
  match(obj) { for (const [c, v] of Object.entries(obj)) this.#filtro('eq', c, v); return this }
  order(columna, { ascending = true } = {}) { this.p.orden.push([columna, ascending]); return this }
  limit(n) { this.p.limite = n; return this }
  single() { this.p.uno = 'single'; return this }
  maybeSingle() { this.p.uno = 'maybeSingle'; return this }
  async #correr() {
    try {
      const r = await fetch('/api/finanzas/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.p) })
      const j = await r.json().catch(() => null)
      if (!j) return { data: null, error: { message: `La base no respondió (${r.status})`, code: String(r.status) } }
      return { data: j.data ?? null, error: j.error ?? null }
    } catch (e) {
      return { data: null, error: { message: `Sin conexión con la base: ${e.message}`, code: 'RED' } }
    }
  }
  then(ok, mal) { return this.#correr().then(ok, mal) }
}

export const supabase = { from: (tabla) => new Consulta(tabla) }

/**
 * Pregunta al Despacho con qué correo se firma (y si la base está configurada).
 * @returns {Promise<{ modo: 'token' | 'sin_config' | 'sin_acceso', correo: string | null }>}
 */
export async function prepararBase() {
  try {
    const r = await fetch('/api/finanzas/db', { cache: 'no-store' })
    if (r.status === 503) return { modo: 'sin_config', correo: null }
    if (!r.ok) return { modo: 'sin_acceso', correo: null }
    return { modo: 'token', correo: (await r.json()).correo ?? null }
  } catch {
    return { modo: 'sin_acceso', correo: null }
  }
}
