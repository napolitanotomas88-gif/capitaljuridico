// ── Vínculos cuenta de Meta ↔ cliente: lo que falta cargar (puro: sin red ni base; lo prueba scripts/test-anuncios-vinculos.mjs) ──
// Pedido de Tomás (13/11/2026), con el inventario de portfolios del día: clientes que lanzaron y no se veían porque su cuenta
// no estaba unida al cliente. Acá se arma lo que muestra el bloque «Vínculos de cuentas» de Anuncios:
//   · Clientes sin cuenta vinculada: ACTIVO del CRM sin fila en el tablero y sin ninguna cuenta firme (a mano, «Cuentas Meta»,
//     la ficha de kickoff o dos palabras del nombre). Si el tablero ve una que se parece por el apellido, va como sugerencia.
//   · Cuentas con gasto sin cliente: filas del tablero con gasto en los últimos 7 días que no se pudieron unir a nadie del CRM.
//     Solo las que el tablero ya lee (lista base + las que cruzan): las demás cuentas visibles no tienen gasto leído y leerlo
//     serían pedidos nuevos a Meta por cada una.
//   · Vinculadas, sin gasto todavía: cuentas unidas a mano (o por la ficha) a un cliente activo, sin gasto en 5 semanas. Antes
//     se descartaban como ruido; ahora se muestran acá (no entran a la tabla ni a las alertas: no tienen nada que medir).
// La vinculación se sigue cargando en la planilla: para cada uno se dice qué fila agregar en «Cuentas Meta» (A cuenta, B SI,
// C nombre exacto del cliente en Agencia).
import type { VinculoCuenta } from './cruce'
import type { CuentaFicha, CuentaPorLanzar } from './porLanzar'

export interface ClienteSinCuenta {
  cliente: string
  idCrm: string | null
  sugerida: { id: string; nombre: string } | null   // la que se parece por el apellido (débil: confirmar antes de cargarla)
  nota: string | null                               // por qué no alcanza lo que hay (la cuenta de la ficha no se ve, etc.)
}
export interface CuentaSinCliente { id: string; cuenta: string; negocio: string | null; gastoD7: number; moneda: string }
export interface CuentaVinculadaSinGasto { id: string; cuenta: string; cliente: string; vinculo: VinculoCuenta }
export interface Vinculos {
  clientesSinCuenta: ClienteSinCuenta[]
  cuentasSinCliente: CuentaSinCliente[]
  vinculadasSinGasto: CuentaVinculadaSinGasto[]
}

/** La fila que hay que agregar en la pestaña «Cuentas Meta» del CRM. */
export const filaCuentasMeta = (cuenta: string | null, cliente: string): string =>
  `«Cuentas Meta»: A = ${cuenta ? cuenta.replace(/^act_/, '') : 'id de la cuenta'} · B = SI · C = ${cliente}`

const FIRMES_POR_LANZAR: readonly CuentaPorLanzar['por'][] = ['manual', 'nombre', 'ficha']

/** De los clientes de «Por lanzar» (ACTIVO sin fila), los que no tienen ninguna cuenta firme. */
export function clientesSinCuenta(items: { cliente: string; idCrm?: string | null; cuentas: CuentaPorLanzar[]; cuentaFicha?: CuentaFicha | null }[]): ClienteSinCuenta[] {
  const out: ClienteSinCuenta[] = []
  for (const it of items) {
    if (it.cuentas.some(c => FIRMES_POR_LANZAR.includes(c.por))) continue
    // La cuenta de su ficha ya gasta en otra fila: está vinculada (a nombre de otro), no falta cargarla
    if (it.cuentaFicha?.estado === 'con_fila' || it.cuentaFicha?.estado === 'visible') continue
    const apellido = it.cuentas.filter(c => c.por === 'apellido')
    const nota = it.cuentaFicha?.estado === 'no_visible' ? 'La cuenta que anotó la ficha de kickoff no se ve con el token: falta el acceso.'
      : it.cuentaFicha?.estado === 'excluida' ? `La cuenta de la ficha está fuera del tablero (${it.cuentaFicha.motivo}).`
      : apellido.length > 1 ? `${apellido.length} cuentas se parecen por el apellido: confirmar cuál es.` : null
    out.push({ cliente: it.cliente, idCrm: it.idCrm ?? null, sugerida: apellido.length === 1 ? { id: apellido[0].id, nombre: apellido[0].nombre } : null, nota })
  }
  return out.sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'))
}

/** Filas del tablero con gasto en 7 días y sin cliente del CRM (ni nombre cargado en «Cuentas Meta»). */
export function cuentasSinCliente(filas: { id: string; cuenta: string; clienteCRM: string | null; negocio: { nombre: string } | null; moneda: string; gasto: { d7: number } }[]): CuentaSinCliente[] {
  return filas.filter(f => !f.clienteCRM && f.gasto.d7 > 0)
    .map(f => ({ id: f.id, cuenta: f.cuenta, negocio: f.negocio?.nombre || null, gastoD7: f.gasto.d7, moneda: f.moneda }))
    .sort((a, b) => b.gastoD7 - a.gastoD7 || a.cuenta.localeCompare(b.cuenta, 'es'))
}

/**
 * Cuenta → nombre del cliente en el CRM, según la última ficha de kickoff de cada cliente. Con el id del CRM de la ficha manda
 * el nombre de Agencia; si no, el nombre del CRM que guardó la ficha. Una cuenta que dos fichas dan a clientes distintos no se
 * usa (no se adivina).
 */
export function cuentasDeFichas(fichas: { idCrm: string | null; clienteCRM: string | null; cuenta: { id: string } | null }[] | null, clientes: { id?: string; nombre: string }[]): Map<string, string> {
  const porId = new Map(clientes.filter(c => c.id).map(c => [c.id!.toUpperCase(), c.nombre]))
  const out = new Map<string, string>(), dudosas = new Set<string>()
  for (const k of fichas ?? []) {
    if (!k.cuenta) continue
    const nombre = (k.idCrm && porId.get(k.idCrm.toUpperCase())) || k.clienteCRM
    if (!nombre) continue
    const previo = out.get(k.cuenta.id)
    if (previo && previo !== nombre) dudosas.add(k.cuenta.id)
    else out.set(k.cuenta.id, nombre)
  }
  for (const id of dudosas) out.delete(id)
  return out
}
