import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Rama } from './anuncios/ramas'
import type { AliasCliente } from './fathomAnuncios/tipos'
import type { PagoComprobante } from './finanzasCuentas'

type NombreConfig = 'finanzas-cuentas' | 'anuncios-cuentas' | 'anuncios-presupuestos' | 'fathom-alias'
const variables: Record<NombreConfig, string> = {
  'finanzas-cuentas': 'HUB_CONFIG_FINANZAS_CUENTAS_JSON',
  'anuncios-cuentas': 'HUB_CONFIG_ANUNCIOS_CUENTAS_JSON',
  'anuncios-presupuestos': 'HUB_CONFIG_ANUNCIOS_PRESUPUESTOS_JSON',
  'fathom-alias': 'HUB_CONFIG_FATHOM_ALIAS_JSON',
}

/** Datos de operación fuera del repositorio. Nunca devuelve datos parciales ni un vacío implícito. */
export function leerConfigPrivada<T>(nombre: NombreConfig, validar: (valor: unknown) => valor is T): T {
  const variable = variables[nombre]
  const configurado = process.env[variable]
  let texto: string
  if (configurado !== undefined) {
    texto = configurado
  } else {
    const directorio = resolve(process.env.HUB_CONFIG_PRIVADA_DIR?.trim() || join(process.cwd(), '.private-config'))
    try { texto = readFileSync(join(directorio, `${nombre}.json`), 'utf8') }
    catch { throw new Error(`Falta la configuración privada ${nombre}. Configurá ${variable} o HUB_CONFIG_PRIVADA_DIR.`) }
  }
  let valor: unknown
  try { valor = JSON.parse(texto) }
  catch { throw new Error(`La configuración privada ${nombre} no contiene JSON válido.`) }
  if (!validar(valor)) throw new Error(`La configuración privada ${nombre} no cumple el formato requerido.`)
  return valor
}

const objeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const texto = (x: unknown): x is string => typeof x === 'string' && !!x.trim()
const listaTexto = (x: unknown): x is string[] => Array.isArray(x) && x.every(texto)
const monto = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0
const cuenta = (x: unknown) => ['Tomi', 'Gero', 'Relay', 'Financiera', 'Otro'].includes(String(x))
const fecha = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && !Number.isNaN(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x
const idCuenta = (x: string) => /^act_\d+$/.test(x)

export interface FinanzasPrivadas { meses: string[]; comprobantes: PagoComprobante[] }
export function esFinanzasPrivadas(x: unknown): x is FinanzasPrivadas {
  if (!objeto(x) || !listaTexto(x.meses) || !x.meses.every(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) || !Array.isArray(x.comprobantes)) return false
  const meses = x.meses
  return x.comprobantes.every(p => Array.isArray(p) && p.length === 5 && fecha(p[0]) && texto(p[1]) && monto(p[2])
    && (cuenta(p[3]) || (Array.isArray(p[3]) && p[3].length > 0 && p[3].every(c => Array.isArray(c) && c.length === 2 && cuenta(c[0]) && monto(c[1]))))
    && ['alta', 'media', 'baja'].includes(p[4]) && meses.includes(p[0].slice(0, 7)))
}
export const leerFinanzasPrivadas = () => leerConfigPrivada('finanzas-cuentas', esFinanzasPrivadas)

export interface AjusteCuenta { cliente?: string; aliasGuiones?: string; rama?: Rama }
export interface CuentasPrivadas { base: string[]; excluidas: string[]; ajustes: Record<string, AjusteCuenta> }
const ramas = new Set(['laboral', 'art', 'transito', 'geriatrico', 'salud', 'previsional', 'familia', 'sucesiones', 'penal', 'consumidor', 'internacional', 'empresas'])
export function esCuentasPrivadas(x: unknown): x is CuentasPrivadas {
  return objeto(x) && listaTexto(x.base) && x.base.every(idCuenta) && listaTexto(x.excluidas) && x.excluidas.every(idCuenta)
    && objeto(x.ajustes) && Object.entries(x.ajustes).every(([id, a]) => idCuenta(id) && objeto(a)
      && Object.keys(a).every(k => ['cliente', 'aliasGuiones', 'rama'].includes(k))
      && (a.cliente === undefined || texto(a.cliente)) && (a.aliasGuiones === undefined || texto(a.aliasGuiones))
      && (a.rama === undefined || (typeof a.rama === 'string' && ramas.has(a.rama))))
}
export const leerCuentasPrivadas = () => leerConfigPrivada('anuncios-cuentas', esCuentasPrivadas)

export interface PresupuestoPrivado { taskIds: string[]; planillaUSD: number | null }
export function esPresupuestosPrivados(x: unknown): x is Record<string, PresupuestoPrivado> {
  return objeto(x) && Object.entries(x).every(([id, a]) => idCuenta(id) && objeto(a) && listaTexto(a.taskIds)
    && (a.planillaUSD === null || monto(a.planillaUSD)))
}
export const leerPresupuestosPrivados = () => leerConfigPrivada('anuncios-presupuestos', esPresupuestosPrivados)

export function esAliasPrivados(x: unknown): x is AliasCliente[] {
  return Array.isArray(x) && x.every(a => objeto(a) && texto(a.cliente) && listaTexto(a.escrito) && a.escrito.length > 0
    && Object.keys(a).every(k => ['cliente', 'escrito'].includes(k)))
}
export const leerAliasPrivados = () => leerConfigPrivada('fathom-alias', esAliasPrivados)
