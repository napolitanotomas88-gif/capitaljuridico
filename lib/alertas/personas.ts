// ── Alertas por Discord: quién es quién (2/11/2026). Puro, sin red ───────────────────────────────────────────────────────
// Los IDs de Discord del equipo van SOLO en variables de entorno (el repo es público): DISCORD_ID_TOMAS, DISCORD_ID_GERO_A,
// DISCORD_ID_GERO_M, DISCORD_ID_AYLU, DISCORD_ID_FAUS, DISCORD_ID_RENE y DISCORD_ID_VALENTINO. Sin el ID, la alerta lleva
// el NOMBRE en texto (sin notificar a nadie).
// 'aprobadores' = quienes confirman en ✅-verificaciones (Tomás, Gero A, Gero M y Aylu): BOT_ALTA_APROBADORES_DISCORD (ids
// separados por coma) o, sin esa variable, los cuatro IDs de arriba. Tomás (2/11/2026): los closers NO se mencionan; lo
// que les faltaba confirmar va a Verificaciones y lo confirman los aprobadores.
type Entorno = Record<string, string | undefined>

export const ROLES = ['tomas', 'gero_a', 'gero_m', 'aylu', 'faus', 'rene', 'valentino'] as const
export type Rol = (typeof ROLES)[number]
export type Mencion = Rol | 'aprobadores'

export const NOMBRE_ROL: Record<Rol, string> = { tomas: 'Tomás', gero_a: 'Gero A', gero_m: 'Gero M', aylu: 'Aylu', faus: 'Faus', rene: 'René', valentino: 'Valen' }
export const VARIABLE_ROL: Record<Rol, string> = {
  tomas: 'DISCORD_ID_TOMAS', gero_a: 'DISCORD_ID_GERO_A', gero_m: 'DISCORD_ID_GERO_M', aylu: 'DISCORD_ID_AYLU', faus: 'DISCORD_ID_FAUS',
  rene: 'DISCORD_ID_RENE', valentino: 'DISCORD_ID_VALENTINO',
}

export const idValido = (x: string | undefined | null): string | null => { const t = (x ?? '').trim(); return /^\d{15,25}$/.test(t) ? t : null }

export const idDeRol = (r: Rol, env: Entorno = process.env): string | null => idValido(env[VARIABLE_ROL[r]])

const APROBADORES: readonly Rol[] = ['tomas', 'gero_a', 'gero_m', 'aylu']

/** Los IDs de los aprobadores: BOT_ALTA_APROBADORES_DISCORD o los de Tomás, Gero A, Gero M y Aylu. */
export function idsAprobadores(env: Entorno = process.env): string[] {
  const propios = (env.BOT_ALTA_APROBADORES_DISCORD ?? '').split(/[,;\s]+/).map(idValido).filter((x): x is string => !!x)
  if (propios.length) return [...new Set(propios)]
  return [...new Set(APROBADORES.map((r) => idDeRol(r, env)).filter((x): x is string => !!x))]
}

export interface Mencionados { ids: string[]; texto: string }

/** «<@id> <@id> Aylu»: IDs para notificar y, sin ID, el nombre. Sin duplicados. */
export function resolverMenciones(ms: readonly Mencion[], env: Entorno = process.env): Mencionados {
  const ids: string[] = []
  const nombres: string[] = []
  for (const m of ms) {
    if (m === 'aprobadores') {
      const xs = idsAprobadores(env)
      if (xs.length) { for (const x of xs) if (!ids.includes(x)) ids.push(x) } else if (!nombres.includes('Verificaciones')) nombres.push('Verificaciones')
      continue
    }
    const id = idDeRol(m, env)
    if (id) { if (!ids.includes(id)) ids.push(id) } else if (!nombres.includes(NOMBRE_ROL[m])) nombres.push(NOMBRE_ROL[m])
  }
  return { ids, texto: [...ids.map((i) => `<@${i}>`), ...nombres].join(' ') }
}

// ── Responsable de cada pieza que hay que mandarle al cliente a mano («para enviar») ────────────────────────────────────
export const PIEZAS_CLIENTE = ['b07', 'd02', 'e01', 'f04', 'g04', 'g05', 'g06', 'h01', 'h02', 'h03', 'i01', 'i03'] as const
export type PiezaCliente = (typeof PIEZAS_CLIENTE)[number]
export const esPiezaCliente = (x: unknown): x is PiezaCliente => typeof x === 'string' && (PIEZAS_CLIENTE as readonly string[]).includes(x)

export const NOMBRE_PIEZA: Record<PiezaCliente, string> = {
  b07: 'Bienvenida', d02: 'Guiones listos y pedido de grabación', e01: 'Recordatorio de grabación', f04: 'Videos listos', g04: 'Campaña al aire', g05: 'Optimización',
  g06: 'Ganadores', h01: 'Pedido de testimonio', h02: 'Agradecimiento del testimonio', h03: 'Encuesta mensual', i01: 'Invitación a la llamada de proyección', i03: 'Despedida',
}
/** El grupo de WhatsApp del cliente donde va cada pieza. */
export const GRUPO_PIEZA: Record<PiezaCliente, 'General' | 'Contenido' | 'Ventas'> = {
  b07: 'General', d02: 'Contenido', e01: 'Contenido', f04: 'Contenido', g04: 'Ventas', g05: 'Ventas', g06: 'Ventas',
  h01: 'General', h02: 'General', h03: 'General', i01: 'General', i03: 'General',
}

export const RESPONSABLE_POR_DEFECTO: Record<PiezaCliente, Rol[]> = {
  b07: ['aylu'], d02: ['aylu', 'gero_m'], e01: ['gero_m'], f04: ['aylu'], g04: ['valentino'], g05: ['valentino'], g06: ['valentino'],
  h01: ['gero_m'], h02: ['gero_m'], h03: ['gero_m'], i01: ['aylu', 'gero_m', 'tomas'], i03: ['aylu'],
}

/** Responsables de una pieza: ALERTAS_RESPONSABLES_JSON ({"f04":["aylu"],…}) pisa la tabla; lo roto se ignora. */
export function responsablesDe(p: PiezaCliente, env: Entorno = process.env): Rol[] {
  try {
    const o = JSON.parse(env.ALERTAS_RESPONSABLES_JSON || '{}') as Record<string, unknown>
    const v = o?.[p]
    if (Array.isArray(v)) { const xs = v.filter((x): x is Rol => typeof x === 'string' && (ROLES as readonly string[]).includes(x)); if (xs.length) return xs }
  } catch { /* la tabla por defecto */ }
  return RESPONSABLE_POR_DEFECTO[p]
}
