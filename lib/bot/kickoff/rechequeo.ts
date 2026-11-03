// ── Volver a chequear la cuenta de Meta de una ficha de kickoff YA LISTA (sin rehacer la ficha ni avisar de nuevo) ──────
// Pedido de Tomás (3/11/2026, caso de una ficha que se armó sin cuenta porque el nombre de la cuenta en Meta no coincidía
// con el del CRM): el aviso de la ficha dice «Cargar la cuenta publicitaria en Cuentas Meta (CRM) y volver a chequear», pero
// hasta hoy «volver a chequear» solo se podía con &forzar=1, que vuelve a pagar Claude y duplica el aviso. Esto rehace SOLO
// el chequeo del portfolio (solo GET a Meta, portfolio.ts) y guarda la ficha con la cabecera nueva, el portfolio final y los
// faltantes recalculados. Lo de la llamada, las ideas, los tildes a mano y los avisos quedan como estaban.
//   · Cuenta: la que se pasa (act_…) o, si no, las del cliente en «Cuentas Meta» / AJUSTES_CUENTA (contexto del CRM fresco).
//   · Entradas: POST /api/bot/kickoff?recording_id=…&cuenta=1 (o &cuenta=act_…), con Bearer CRON_SECRET. &dry=1 no guarda.
//   · fichaConPortfolio es pura (la prueba scripts/test-bot-kickoff-rechequeo.mjs).
import { calcularFaltantes, cabeceraMeta } from './ficha'
import { combinarPortfolio, idCuenta } from './portfolio'
import type { FichaKickoff, LecturaPortfolioMeta } from './tipos'

/** La ficha con el chequeo nuevo de Meta: cabecera, portfolio final y faltantes recalculados. Puro. */
export function fichaConPortfolio(ficha: FichaKickoff, lectura: LecturaPortfolioMeta, cuentas: string[]): FichaKickoff {
  const base = {
    ...ficha,
    cliente: { ...ficha.cliente, cuentas: cuentas.length ? cuentas : ficha.cliente.cuentas ?? [] },
    portfolio_meta: cabeceraMeta(lectura),
    portfolio_final: combinarPortfolio(lectura, ficha.portfolio),
  }
  return { ...base, faltantes: calcularFaltantes(base) }
}

export interface ResultadoRechequeo {
  recording_id: number
  estado: 'ok' | 'sin_cuenta' | 'no_es_kickoff' | 'no_existe' | 'error'
  cuenta: string | null
  nombre: string | null
  leido: boolean
  aviso: string | null
  guardado: boolean
  motivo?: string
}

export interface DepsRechequeo {
  leer(id: number): Promise<{ estado: string; ficha: unknown; cliente_crm: string | null; id_crm: string | null } | undefined>
  cuentasCRM(idCrm: string | null, nombre: string | null): Promise<string[]>
  portfolio(cliente: { cliente_crm: string | null; cuentas: string[] }): Promise<LecturaPortfolioMeta>
  guardar(id: number, ficha: FichaKickoff): Promise<void>
}

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

export async function rechequearCuenta(id: number, deps: DepsRechequeo, op: { cuenta?: string | null; dry?: boolean } = {}): Promise<ResultadoRechequeo> {
  const vacio = { recording_id: id, cuenta: null, nombre: null, leido: false, aviso: null, guardado: false }
  try {
    const fila = await deps.leer(id)
    if (!fila) return { ...vacio, estado: 'no_existe', motivo: 'la grabación no está en el registro' }
    const ficha = fila.ficha as FichaKickoff | null
    if (fila.estado !== 'lista' || !ficha || ficha.tipo_reunion !== 'kickoff' || !ficha.cliente)
      return { ...vacio, estado: 'no_es_kickoff', motivo: `la fila está ${fila.estado} o no es una ficha de kickoff` }
    const forzada = op.cuenta ? idCuenta(op.cuenta) : null
    if (op.cuenta && !forzada) return { ...vacio, estado: 'error', motivo: 'cuenta inválida (act_ y números)' }
    const cuentas = forzada ? [forzada] : await deps.cuentasCRM(ficha.cliente.id_crm ?? fila.id_crm, ficha.cliente.cliente_crm ?? fila.cliente_crm)
    const lectura = await deps.portfolio({ cliente_crm: ficha.cliente.cliente_crm ?? fila.cliente_crm, cuentas })
    const nueva = fichaConPortfolio(ficha, lectura, cuentas)
    if (!op.dry) await deps.guardar(id, nueva)
    return {
      recording_id: id, estado: lectura.cuenta ? 'ok' : 'sin_cuenta', cuenta: lectura.cuenta, nombre: lectura.nombre ?? null,
      leido: lectura.leido, aviso: lectura.aviso, guardado: !op.dry,
    }
  } catch (e) {
    return { ...vacio, estado: 'error', motivo: motivo(e) }
  }
}

/** Las dependencias reales (Neon, CRM y Meta, solo lectura en Meta). Solo servidor. */
export async function depsRechequeoReales(): Promise<DepsRechequeo> {
  const [registro, portfolio, contexto] = await Promise.all([import('./registro'), import('./portfolio'), import('./contexto')])
  return {
    leer: async id => registro.leerKickoff(id),
    cuentasCRM: async (idCrm, nombre) => {
      const c = await contexto.contextoKickoff()
      const n = (nombre ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
      const x = c.clientes.find(k => (idCrm && k.id === idCrm.toUpperCase()) || (!!n && k.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim() === n))
      return x?.cuentas ?? []
    },
    portfolio: async cliente => portfolio.paraFicha(await portfolio.portfolioDelCliente(cliente)),
    guardar: async (id, ficha) => registro.actualizarFicha(id, ficha),
  }
}
