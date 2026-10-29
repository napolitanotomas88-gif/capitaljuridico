// ── Canje de créditos contra la renovación: validación y decisión, PURAS (sin red, sin reloj, sin Sheets) ──────────
// Contrato:
//   · Sin la bandera CRM_ESCRITURA_CANJE=real el canje es SIMULACIÓN: arma el movimiento que se asentaría en el libro "Créditos" y no escribe.
//   · Monedas SEPARADAS: los meses de servicio y los USD se muestran, validan y asientan cada uno en su unidad. Nunca se suman,
//     ni se convierten uno en el otro. El valor de referencia en USD de los meses es solo para reportes y va rotulado aparte.
//   · Solo contra la renovación de quien refiere (nunca efectivo). Canjea TODO el saldo del ciclo y lo cierra (lo decide planCanje).
//   · Idempotencia: la misma clave de envío con el mismo contenido es la MISMA operación; la misma clave con otro contenido es un
//     conflicto. Además, una vez asentado el canje el saldo del ciclo queda en cero, así que repetirlo se rechaza por falta de saldo.
//   · Escritura: la ruta conecta el escritor (escribirCanje.ts + reservasCanje.ts) SOLO con la bandera Y reservas durables en Postgres
//     (ver estadoEscrituraCanje). La bandera sola nunca alcanza. La migración 002 todavía tiene que correr (sin ella la reserva falla y se bloquea).
//   · La política "se canjea todo el saldo" es una PROPUESTA, no una regla fuente (ver POLITICA_SALDO).
//   · Permisos: solo roles que ven la sección Referidos (socio y csm); lo exige la ruta, acá hay una función pura que lo repite.
//   · Los afiliados externos (IDs E###) no tienen créditos ni canje: ver afiliadosExternos.ts.
import { createHash } from 'node:crypto'
import { esYmdValido, type Ymd } from './fechas'
import { planCanje, puedeCanjear, saldoCanjeable } from './creditos'
import { REGLAS_REFERIDOS, type ReglasReferidos } from './reglasReferidos'
import { esIdAfiliadoExterno } from './afiliadosExternos'
import { esRol, puedeVer, type Rol } from '../auth/roles'
import type { MovimientoCredito, ResumenCredito } from './tipos'

export type ContextoCanje = 'renovacion' | 'efectivo'

export interface EntradaCanje {
  idCliente: unknown
  renovacionAplicada: unknown
  fecha?: unknown                 // 'AAAA-MM-DD'; por defecto, hoy (Argentina)
  contexto?: unknown              // solo 'renovacion'; 'efectivo' se rechaza
  claveEnvio?: unknown            // UUID del formulario: evita el doble envío
}

export interface CanjeLimpio {
  idCliente: string
  renovacionAplicada: string
  fecha: Ymd
  contexto: 'renovacion'
  claveEnvio: string
}

export type ErroresCanje = Partial<Record<'idCliente' | 'renovacionAplicada' | 'fecha' | 'contexto' | 'claveEnvio', string>>

const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Una celda de texto que empiece con estos caracteres se interpretaría como fórmula si alguien la copia a otra planilla */
const sinFormula = (s: string): string => (/^[=+\-@]/.test(s) ? `'${s}` : s)

export function validarCanje(e: EntradaCanje, hoy: Ymd, reglas: ReglasReferidos = REGLAS_REFERIDOS): { ok: true; canje: CanjeLimpio } | { ok: false; errores: ErroresCanje } {
  const errores: ErroresCanje = {}
  const idCliente = txt(e.idCliente, 12).toUpperCase()
  if (!/^[A-Z]\d{3,}$/.test(idCliente)) errores.idCliente = 'Elegí un cliente (ID como A012).'
  else if (esIdAfiliadoExterno(idCliente)) errores.idCliente = 'Los afiliados externos (X###) no tienen créditos ni canje.'

  const renovacionAplicada = txt(e.renovacionAplicada, 120)
  if (renovacionAplicada.length < 3) errores.renovacionAplicada = 'Indicá a qué renovación se aplica (por ejemplo "Renovación 2026-11").'

  const crudaFecha = typeof e.fecha === 'string' && e.fecha.trim() ? e.fecha.trim() : hoy
  if (!esYmdValido(crudaFecha)) errores.fecha = 'La fecha del canje no es válida.'
  else if (crudaFecha > hoy) errores.fecha = 'La fecha del canje no puede ser futura.'
  else if (crudaFecha < hoy) errores.fecha = 'El canje se asienta con la fecha de hoy: no se admite una fecha retroactiva hasta que se defina la regla (el saldo se calcula a hoy y un canje con fecha pasada volvería a dejar disponible lo ganado después).'

  const contexto = e.contexto === undefined || e.contexto === null || e.contexto === '' ? 'renovacion' : e.contexto
  if (contexto !== 'renovacion' && contexto !== 'efectivo') errores.contexto = 'El contexto del canje no es válido.'
  else if (!puedeCanjear(contexto, reglas)) errores.contexto = 'Los créditos nunca se pagan en efectivo: solo se canjean contra la renovación.'

  const claveEnvio = txt(e.claveEnvio, 64)
  if (!claveEnvio) errores.claveEnvio = 'Falta la clave del envío (se genera sola en el formulario).'

  if (Object.keys(errores).length) return { ok: false, errores }
  return { ok: true, canje: { idCliente, renovacionAplicada, fecha: crudaFecha as Ymd, contexto: 'renovacion', claveEnvio } }
}

/** Solo los roles que ven Referidos pueden canjear (socio y csm). Misma matriz que usa la ruta. */
export const rolPuedeCanjear = (rol: Rol | string | null | undefined): boolean => esRol(rol) && puedeVer(rol, 'referidos')

// ── Saldo a canjear, SIEMPRE por moneda ───────────────────────────────────────────────────────────────────────────
export interface SaldoPorMoneda {
  meses: number                   // meses de servicio (cierres + mes del intento 5 con el tope, + ajustes vigentes)
  usd: number                     // créditos en USD vigentes del ciclo (intentos 2, 4 y 6 en adelante), aparte de los meses
  renovacionGratis: boolean
  extras: string[]                // beneficios que no se consumen en el canje (identidad de marca): se informan, no se canjean acá
}

/** Referencia para reportes: NO es plata a pagar ni se suma con los USD del saldo */
export interface ReferenciaMeses { pagoUnicoUSD: number; planDePagosUSD: number }

/**
 * POLÍTICA DE SALDO: hoy el canje consume TODO el saldo del ciclo (meses y USD) y cierra el ciclo. Eso NO figura en las reglas fuente
 * (reglasReferidos.ts solo dice "contra la renovación, nunca en efectivo, vence si no renueva"): es una PROPUESTA de implementación que hay
 * que confirmar (por ejemplo, si se puede canjear solo una parte o dejar USD para otra renovación). CONFIRMADA por Tomás el 27/10/2026
 * («Opción A»: se usa todo junto, el saldo queda en cero y la escalera vuelve a empezar).
 */
export const POLITICA_SALDO = Object.freeze({
  tipo: 'saldo_completo',
  estado: 'confirmada',
  texto: 'Regla confirmada por Tomás (27/10/2026): el canje usa todo el saldo del ciclo, en meses y en USD por separado, y la escalera vuelve a empezar.',
} as const)

export type MotivoRechazoCanje = 'sin_saldo' | 'cliente_inexistente' | 'afiliado_externo' | 'canje_en_fecha_anterior' | 'fecha_retroactiva'

export type DecisionCanje =
  | {
      tipo: 'simulable'
      saldo: SaldoPorMoneda
      referenciaMeses: ReferenciaMeses
      movimiento: Omit<MovimientoCredito, 'id' | 'fila'>
      politicaSaldo: typeof POLITICA_SALDO
      huella: string
      avisos: string[]
    }
  | { tipo: 'rechazado'; codigo: MotivoRechazoCanje; mensaje: string }

/** Huella del PEDIDO solo (cliente, fecha, renovación): no depende del saldo, así un reintento por clave se reconoce aunque el libro ya cambió */
export const huellaPedidoCanje = (c: CanjeLimpio, actor = ''): string => createHash('sha256').update(['pedido', actor.trim().toLowerCase(), c.idCliente, c.fecha, c.renovacionAplicada.toLowerCase()].join('|')).digest('hex').slice(0, 32)

/** Huella del contenido (actor + pedido + fecha + renovación + saldo): la misma operación sobre el mismo saldo da la misma huella (idempotencia) */
export function huellaCanje(c: CanjeLimpio, saldo: SaldoPorMoneda, reglasVersion: string, cicloDesde: Ymd | null, actor = ''): string {
  return createHash('sha256').update(['canje', actor.trim().toLowerCase(), c.idCliente, c.fecha, c.renovacionAplicada.toLowerCase(), saldo.meses, saldo.usd, saldo.renovacionGratis ? 1 : 0, reglasVersion, cicloDesde ?? ''].join('|')).digest('hex').slice(0, 32)
}

export function decidirCanje(
  canje: CanjeLimpio,
  resumen: ResumenCredito | undefined,
  cargadoPor: string,
  reglas: ReglasReferidos = REGLAS_REFERIDOS,
): DecisionCanje {
  if (esIdAfiliadoExterno(canje.idCliente)) return { tipo: 'rechazado', codigo: 'afiliado_externo', mensaje: 'Los afiliados externos no tienen créditos ni canje.' }
  if (!resumen) return { tipo: 'rechazado', codigo: 'cliente_inexistente', mensaje: 'Ese cliente no tiene referidos ni movimientos: no hay nada para canjear.' }
  // El saldo del resumen es el de HOY: con otra fecha se consumiría lo que se ganó después (el ciclo cortaría antes de esos premios y
  // volverían a quedar disponibles → doble gasto). Sin una regla definida para calcular "a la fecha", se rechaza.
  if (canje.fecha !== resumen.hoy) return { tipo: 'rechazado', codigo: 'fecha_retroactiva', mensaje: 'El canje solo se asienta con la fecha de hoy: todavía no hay una regla para canjear con fecha pasada.' }
  if (resumen.cicloDesde && canje.fecha < resumen.cicloDesde) {
    return { tipo: 'rechazado', codigo: 'canje_en_fecha_anterior', mensaje: 'Ya hay un canje posterior a esa fecha: el ciclo se cerró. Elegí una fecha igual o posterior.' }
  }
  const s = saldoCanjeable(resumen, reglas)
  if (s.meses <= 0 && s.usd <= 0) return { tipo: 'rechazado', codigo: 'sin_saldo', mensaje: 'No hay meses ni USD para canjear en el ciclo actual (si ya se asentó un canje, el saldo quedó en cero).' }
  const saldo: SaldoPorMoneda = { meses: s.meses, usd: s.usd, renovacionGratis: s.renovacionGratis, extras: s.extras }
  const plan = planCanje(resumen, { fecha: canje.fecha, renovacionAplicada: sinFormula(canje.renovacionAplicada), cargadoPor: sinFormula(cargadoPor) }, reglas)
  const avisos = [...resumen.advertencias]
  if (saldo.extras.length) avisos.push('El extra de la escalera (identidad de marca) no se consume en el canje: se entrega aparte.')
  return {
    tipo: 'simulable', saldo, referenciaMeses: { pagoUnicoUSD: s.valorUSD, planDePagosUSD: s.valorPlanDePagosUSD }, movimiento: plan, politicaSaldo: POLITICA_SALDO,
    huella: huellaCanje(canje, saldo, resumen.reglasVersion, resumen.cicloDesde, cargadoPor), avisos,
  }
}

// ── Idempotencia sobre el contenido ────────────────────────────────────────────────────────────────────────────────
export type RelacionConPrevia = 'nueva' | 'misma_operacion' | 'clave_reutilizada'

/** Compara con una operación ya vista con la misma clave: mismo contenido = misma operación; otro contenido = conflicto */
export function relacionConPrevia(previa: { clave: string; huella: string } | null | undefined, actual: { clave: string; huella: string }): RelacionConPrevia {
  if (!previa || previa.clave !== actual.clave) return 'nueva'
  return previa.huella === actual.huella ? 'misma_operacion' : 'clave_reutilizada'
}

// ── Estado de la escritura ────────────────────────────────────────────────────────────────────────────────────────
export type EstadoEscrituraCanje =
  | { modo: 'simulacion'; motivo: string }
  | { modo: 'real'; motivo: string }
  | { modo: 'bloqueada'; codigo: 'sin_base_de_datos'; motivo: string }

/**
 * Qué hace la RUTA con un canje. Escribir de verdad exige la bandera CRM_ESCRITURA_CANJE=real (decisión humana, a propósito) Y reservas
 * durables en Postgres. Sin la bandera: simulación. Con la bandera y sin base: bloqueada. Con las dos: 'real' (la ruta llama a registrarCanje,
 * que reserva en Postgres antes de tocar el libro). Conectado con el OK de Tomás (27/10/2026). Nunca se declara "guardado" sin escribir.
 */
export function estadoEscrituraCanje(bandera: boolean, hayReservasDurables: boolean): EstadoEscrituraCanje {
  if (!bandera) return { modo: 'simulacion', motivo: 'Modo de revisión: se calcula y se muestra el movimiento, pero no se guarda nada en la planilla.' }
  if (!hayReservasDurables) return { modo: 'bloqueada', codigo: 'sin_base_de_datos', motivo: 'Escritura bloqueada: falta la base de datos (Postgres) que reserva cada canje antes de escribirlo. Sin ella no se puede garantizar que un canje no se asiente dos veces.' }
  return { modo: 'real', motivo: 'Escritura real: el canje se reserva en la base y se asienta en el libro "Créditos".' }
}
