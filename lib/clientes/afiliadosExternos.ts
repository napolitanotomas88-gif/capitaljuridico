// ── Contrato de AFILIADOS EXTERNOS (personas que no son clientes y presentan a alguien), PREPARADO, sin recompensa ────
// Todavía NO hay decisión de negocio sobre qué gana un afiliado externo, ni hay pestaña, ruta ni pantalla. Este archivo solo fija la
// forma de los datos y las barreras para que, cuando se decida, no se mezcle con los créditos de los clientes:
//   · IDs propios (X###, distintos de los clientes A### / C###): un afiliado externo NUNCA entra al cálculo de créditos ni al canje.
//   · La recompensa es "por definir": no hay moneda, monto ni unidad. Cualquier campo de recompensa, comisión o descuento en una alta
//     se RECHAZA (no se ignora en silencio), para que nadie asuma un premio que nadie decidió.
//   · Idempotencia: una persona presentada (últimos 8 dígitos del teléfono) = un solo registro vivo por afiliado; otro afiliado con
//     el mismo teléfono es un conflicto explícito.
//   · Permisos: solo el socio gestiona afiliados externos (propuesta conservadora, a confirmar).
//   · Monedas: si algún día hay recompensa, cada moneda va aparte (meses, USD, otra); este contrato no define ninguna.
import type { Rol } from '../auth/roles'
import type { EstadoReferido, Ymd } from './tipos'

/** X### = afiliado externo (X de "externo"). Los clientes son A### (agencia) o C### (consultora); E### son los ejemplos de ?demo=1 */
export const ID_AFILIADO_EXTERNO = /^X\d{3,}$/
export const esIdAfiliadoExterno = (id: unknown): boolean => typeof id === 'string' && ID_AFILIADO_EXTERNO.test(id.trim().toUpperCase())

export type EstadoAfiliado = 'activo' | 'pausado' | 'baja'

export interface AfiliadoExterno {
  id: string                    // X###
  nombre: string
  contacto: string              // mail o teléfono, como lo cargue una persona
  estado: EstadoAfiliado
  alta: Ymd
}

export interface ReferidoDeAfiliado {
  id: string                    // propio de este registro (lo asigna el escritor, con reserva durable)
  idAfiliado: string            // X###
  nombre: string
  telefonoClave: string         // últimos 8 dígitos: reconoce a la misma persona con o sin código de país
  fechaPedido: Ymd
  estado: EstadoReferido
  idClienteNuevo: string        // si cerró, el cliente A### que quedó (vacío mientras tanto)
  // sin ningún campo de recompensa: no está decidida
}

/** Lo que gana un afiliado externo: por definir. No se calcula nada con esto. */
export const RECOMPENSA_AFILIADO_EXTERNO = Object.freeze({ definida: false, moneda: null, monto: null, estado: 'por_definir' } as const)

/** Palabras de campo que indican que alguien está intentando fijar una recompensa que no existe */
const CAMPOS_DE_RECOMPENSA = /^(recompensa|premio|comision|comisión|descuento|credito|crédito|creditos|créditos|monto|meses|usd|bono|pago|valor)/i

export type ErroresAfiliadoExterno = Partial<Record<'idAfiliado' | 'nombre' | 'telefono' | 'fechaPedido' | 'recompensa', string>>

const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

export interface EntradaReferidoExterno { idAfiliado: unknown; nombre: unknown; telefono: unknown; fechaPedido?: unknown; [campo: string]: unknown }

export function validarReferidoExterno(e: EntradaReferidoExterno): { ok: true; idAfiliado: string; nombre: string; telefonoClave: string } | { ok: false; errores: ErroresAfiliadoExterno } {
  const errores: ErroresAfiliadoExterno = {}
  const idAfiliado = txt(e.idAfiliado, 12).toUpperCase()
  if (!ID_AFILIADO_EXTERNO.test(idAfiliado)) errores.idAfiliado = 'Elegí un afiliado externo (ID X###). Los clientes no se cargan acá.'
  const nombre = txt(e.nombre, 120)
  if (nombre.length < 3) errores.nombre = 'Escribí el nombre del referido (al menos 3 letras).'
  const digitos = (typeof e.telefono === 'string' ? e.telefono : '').replace(/\D/g, '')
  if (digitos.length < 8 || digitos.length > 15) errores.telefono = 'El teléfono tiene que tener entre 8 y 15 dígitos.'
  if (Object.keys(e).some(k => CAMPOS_DE_RECOMPENSA.test(k))) errores.recompensa = 'La recompensa de los afiliados externos todavía no está definida: no se carga ningún premio, descuento ni monto.'
  if (Object.keys(errores).length) return { ok: false, errores }
  return { ok: true, idAfiliado, nombre, telefonoClave: digitos.slice(-8) }
}

/** Un afiliado externo nunca acredita: ni meses ni USD ni otra cosa, hasta que se defina la recompensa */
export const puedeAcreditarAfiliadoExterno = (): false => false

/** Solo el socio gestiona afiliados externos (propuesta conservadora, a confirmar) */
export const rolGestionaAfiliados = (rol: Rol | null | undefined): boolean => rol === 'socio'

/** Deja afuera del cálculo de créditos de clientes todo lo que venga de un afiliado externo */
export function soloDeClientes<T extends { idReferidor: string }>(filas: readonly T[]): T[] {
  return filas.filter(f => !esIdAfiliadoExterno(f.idReferidor))
}

export type DecisionExterno =
  | { tipo: 'nuevo' }
  | { tipo: 'duplicado'; idExistente: string }
  | { tipo: 'rechazado'; codigo: 'otro_afiliado' | 'afiliado_inactivo' | 'afiliado_inexistente'; mensaje: string }

/** Idempotencia por persona: el mismo teléfono con el mismo afiliado es el mismo registro; con otro afiliado, conflicto */
export function decidirReferidoExterno(
  e: { idAfiliado: string; telefonoClave: string },
  afiliados: readonly AfiliadoExterno[],
  existentes: readonly Pick<ReferidoDeAfiliado, 'id' | 'idAfiliado' | 'telefonoClave'>[],
): DecisionExterno {
  const af = afiliados.find(a => a.id === e.idAfiliado)
  if (!af) return { tipo: 'rechazado', codigo: 'afiliado_inexistente', mensaje: 'Ese afiliado externo no existe.' }
  if (af.estado !== 'activo') return { tipo: 'rechazado', codigo: 'afiliado_inactivo', mensaje: 'Ese afiliado externo no está activo.' }
  const mismos = existentes.filter(r => r.telefonoClave === e.telefonoClave)
  const propio = mismos.find(r => r.idAfiliado === e.idAfiliado)
  if (propio) return { tipo: 'duplicado', idExistente: propio.id }
  if (mismos.length) return { tipo: 'rechazado', codigo: 'otro_afiliado', mensaje: `Ese teléfono ya fue presentado por otro afiliado (${mismos[0].idAfiliado}).` }
  return { tipo: 'nuevo' }
}
