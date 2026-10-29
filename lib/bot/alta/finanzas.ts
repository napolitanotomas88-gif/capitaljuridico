// ── Bot "Capital Jurídico": fila de "Registro de Pagos" a partir del #ALTA (docs/BOT-ALTA-CJ.md) ─────────
// Puro y sin red: NO escribe en la planilla. Devuelve la fila tal como la cargaría Aylu con el "Formulario de
// Pagos" + lo que falta averiguar (pendientes) + lo que tiene que mirar un humano (avisos).
// Planilla "SKWD | Finanzas 2026", pestaña "Registro de Pagos", leída el 24/10/2026: cada pago entra como fila
// NUEVA EN LA FILA 2 (arriba de todo, las más nuevas primero). Columnas A–R; P y Q no se tocan.
// Reglas: "Decisiones de Tomás para Finanzas (24/10/2026)" en docs/BOT-ALTA-CJ.md. Lo marcado PROPUESTA no está
// confirmado por Tomás.
// La escritura (finanzasEscribir.ts) manda la fila con updateCells en un solo batchUpdate:
//   · la planilla está en español: la fecha va como SERIAL de Sheets (días desde 1899-12-30, como lib/finanzasCierre.ts),
//     nunca como texto (un "11/5/2026" se leería 11 de mayo);
//   · los teléfonos extranjeros llevan apóstrofo adelante (para quien los pegue o los escriba con USER_ENTERED: un "+"
//     al principio se toma como fórmula); finanzasEscribir.ts los manda como texto literal y le saca el apóstrofo;
//   · null = no tocar esa celda (la API la saltea); '' = vacía.
import { MINIMO_USD, esMontoFee, prefijoPrograma, type AltaParseada } from './parsear'
import { largoAreaAr, largoCodigoPais, telefonoSinPais } from './telefono'
import { esYmdValido, sumarDias, ymdASerial } from '../../clientes/fechas'

// Opciones exactas de las listas desplegables de la planilla (24/10/2026)
export const OPCIONES_PROGRAMA = [
  'DFY | PP | $3000', 'DFY | PIF | $2400', 'DFY | PIF | $2600', 'DFY | PP | $3300', 'DWY | PIF | $447', 'DWY | PP | $600',
  'DFY+R | PIF | $3400', 'DFY+R | PP | $3400', 'DFY+R++ | PIF | $3800', 'DFY+R++ | PP | $3800', 'DFY | PIF | $6.000',
  'DFY | PP | $8.000', 'Fee',
] as const
export const OPCIONES_SETTER = ['Tomi / Gero', 'Mai', 'ENRU / Mai'] as const
export const OPCIONES_CONCEPTO = ['Fee', '1ra Cuota', '2da Cuota', 'PIF'] as const

// ── Pago de un cliente que ya existe (Tomás, 26/10/2026) ──
// Va como "2da Cuota", "3ra Cuota", etc., según cuántas cuotas (o PIF) de ese cliente ya hay en "Registro de Pagos". Los Fee
// no cuentan. OJO: hoy la lista desplegable de la columna J solo tiene hasta "2da Cuota": "3ra Cuota" y las siguientes hay
// que sumarlas a la lista (si es estricta, Finanzas no carga la fila y queda a revisar).
const ORDINALES = ['', '1ra', '2da', '3ra', '4ta', '5ta', '6ta', '7ma', '8va', '9na', '10ma', '11va', '12va']
/** "2da Cuota", "3ra Cuota"… (n ≥ 1; más de 12, "Cuota 13"). */
export const conceptoCuota = (n: number): string => (ORDINALES[n] ? `${ORDINALES[n]} Cuota` : `Cuota ${n}`)
const sinAcentosMin = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
/** Cuántas cuotas (o PIF) de ese cliente ya hay en las filas del Registro (C = nombre, D = teléfono, J = concepto). Mismo
 *  cliente = el mismo nombre (sin acentos) o los mismos últimos 8 dígitos del teléfono. */
export function cuotasAnterioresEn(filas: readonly (readonly unknown[])[], p: { nombre: string | null; telefono: string | null }): number {
  const nom = sinAcentosMin(p.nombre)
  const tel = (p.telefono ?? '').replace(/\D/g, '').slice(-8)
  return filas.filter((f) => {
    const concepto = sinAcentosMin(f[9])
    if (!/cuota|pif/.test(concepto)) return false
    const mismoNombre = nom.length >= 5 && sinAcentosMin(f[2]) === nom
    const t = String(f[3] ?? '').replace(/\D/g, '')
    return mismoNombre || (tel.length === 8 && t.length >= 8 && t.slice(-8) === tel)
  }).length
}
/** Concepto del pago siguiente de un cliente existente: la cuota que sigue a las que ya están (como mínimo, la 2da). */
export const conceptoPagoCliente = (anteriores: number): string => conceptoCuota(Math.max(2, anteriores + 1))
/** Lista desplegable completa de la columna K (leída el 25/10/2026). */
export const OPCIONES_FUENTE = ['Inbound IG', 'Inbound Tiktok', 'VSL Funnel', 'BIO Página Web', 'Referido', 'Outbound', 'Webinar', 'Enrutamiento'] as const
/** @deprecated nombre viejo (eran solo las primeras 4): usar OPCIONES_FUENTE. */
export const OPCIONES_FUENTE_CONOCIDAS = OPCIONES_FUENTE
export const OPCIONES_TIPO_VENTA = ['Front-end', 'Back-end'] as const
export const OPCIONES_TIPO_PAGO = ['Upfront', 'Payment Plan'] as const
/** Columna R (Tomás, 24/10/2026): solo 3 opciones. "Empresa" todavía no está en la lista desplegable: hay que sumarla. */
export const OPCIONES_CUENTA = ['Tomi', 'Gero', 'Empresa'] as const
export type CuentaRecibio = (typeof OPCIONES_CUENTA)[number]
/** Valores de las filas viejas: se aceptan con aviso, pero ya no se proponen. */
export const CUENTAS_VIEJAS = ['Relay', 'Financiera', 'Otra'] as const

export type ColumnaRegistro = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R'
/** '' = vacía · null = no se escribe (la API la saltea) · las fórmulas van como texto que empieza con '=' */
export type CeldaRegistro = string | number | null

/** Encabezados de "Registro de Pagos" en orden. P es la categoría vieja (FECCU/FECCP/BECC, la lee lib/rawSheets.ts
 *  como valor legado; Q dice "← CAT - CASH"): no se escribe, por si tiene fórmula. */
export const COLUMNAS_REGISTRO: { col: ColumnaRegistro; titulo: string }[] = [
  { col: 'A', titulo: 'Fecha' },
  { col: 'B', titulo: 'Programa' },
  { col: 'C', titulo: 'Nombre del Cliente' },
  { col: 'D', titulo: 'Telefono' },
  { col: 'E', titulo: 'Efectivo Recaudado' },
  { col: 'F', titulo: 'Pesos ARS' },
  { col: 'G', titulo: 'Closer' },
  { col: 'H', titulo: 'Setter' },
  { col: 'I', titulo: 'Comprobante' },
  { col: 'J', titulo: 'Concepto' },
  { col: 'K', titulo: 'Fuente' },
  { col: 'L', titulo: 'Comisión' },
  { col: 'M', titulo: 'Mes' },
  { col: 'N', titulo: 'Tipos de venta' },
  { col: 'O', titulo: 'Tipo de pago' },
  { col: 'P', titulo: 'Categoría (vieja, no se escribe)' },
  { col: 'Q', titulo: '← CAT - CASH' },
  { col: 'R', titulo: 'Cuenta que recibió' },
]

export interface ExtrasRegistro {
  fecha: string | Date      // día del pago y de la carga: 'aaaa-mm-dd' o Date (se toma el día en Argentina)
  setter?: string           // del "Setter:" del closer (si setterAOpcion lo traduce) o del CRM de ventas; si no, al closer
  fuente?: string           // de los UTM del lead (setterFuente.ts); respaldo: el closer; si no, se pregunta en Verificaciones
  cuenta?: string           // cuenta ya decidida (Tomi, Gero o Empresa): manda sobre lo que se deduce
  destinatario?: string     // destinatario del comprobante, tal cual lo lee Claude: de ahí se deduce la cuenta (col R)
  pesosArs?: number         // monto real en pesos, leído del comprobante (col F)
  mepDiaAnterior?: number   // dólar MEP (venta) del día anterior al pago: lo busca el servidor con lib/bot/alta/mep.ts
  fechaMep?: string         // 'aaaa-mm-dd' de esa cotización (fechaCotizacion de mep.ts: si el día anterior fue domingo o
                            // feriado, la del último día hábil). Sin ella, el aviso cita el día anterior al pago.
}

export interface FilaRegistroPagos {
  celdas: Record<ColumnaRegistro, CeldaRegistro>
  fila: CeldaRegistro[]   // A..R en orden
  fechaTexto: string      // la fecha como se ve en la col A ('M/D/YYYY'), para mostrar; '' si no sirve
  fechaLegible: string    // la misma fecha como 'dd/mm/aaaa', para la vista previa; '' si no sirve
  pendientes: string[]    // datos que el bot tiene que conseguir antes de cargar
  avisos: string[]        // los mira un humano
}

const TZ = 'America/Argentina/Buenos_Aires'

/** Fila donde entra el pago nuevo (arriba de todo). */
export const FILA_NUEVA = 2

/** Columna M: fórmula de la planilla, tal cual se leyó (con ";" de separador, como en una planilla en español).
 *  Nota: normalmente se COPIA de la fila de abajo; solo si esa fila no la tiene, finanzasEscribir.ts la escribe con
 *  formulaValue. Que Sheets la acepte con ";" se valida la primera vez que haga falta escribirla (si la rechaza, el
 *  lote entero se rechaza sin aplicar nada y va con ","). */
export const formulaMes = (fila = FILA_NUEVA) => `=IF(A${fila}="";""; TEXT(A${fila}; "yyyy-mmmm"))`

/** 'aaaa-mm-dd' o Date → 'aaaa-mm-dd' (día en Argentina). null si no es una fecha real ('2026-02-31' no lo es). */
function ymdCarga(f: string | Date): string | null {
  const ymd = f instanceof Date
    ? (Number.isNaN(f.getTime()) ? '' : f.toLocaleDateString('en-CA', { timeZone: TZ }))
    : f.trim()
  return esYmdValido(ymd) ? ymd : null
}

/** Fecha como se VE en la columna A ('M/D/YYYY'): solo para mostrar. null si la fecha no sirve. */
export function fechaPlanilla(f: string | Date): string | null {
  const ymd = ymdCarga(f)
  if (!ymd) return null
  const [a, mes, d] = ymd.split('-').map(Number)
  return `${mes}/${d}/${a}`
}

/** Fecha para ESCRIBIR en la columna A: serial de Sheets (no depende del idioma de la planilla). null si no sirve. */
export function serialPlanilla(f: string | Date): number | null {
  const ymd = ymdCarga(f)
  return ymd ? ymdASerial(ymd) : null
}

/** 'aaaa-mm-dd' → 'dd/mm/aaaa' (para la vista previa). */
const ddmmaaaa = (ymd: string) => ymd.split('-').reverse().join('/')

/** Día anterior a 'aaaa-mm-dd' (cruza meses y años: '2027-01-01' → '2026-12-31'). null si la fecha no es real. */
export function fechaDiaAnterior(ymd: string): string | null {
  return esYmdValido(ymd) ? sumarDias(ymd, -1) : null
}

/** Pesos → USD con el dólar MEP (venta) del día anterior al pago, redondeado a 2 decimales (Tomás, 24/10/2026).
 *  null si el monto o la cotización no sirven. */
export function usdDesdePesos(pesos: number, mepVentaDiaAnterior: number): number | null {
  if (!Number.isFinite(pesos) || pesos < 0 || !Number.isFinite(mepVentaDiaAnterior) || mepVentaDiaAnterior <= 0) return null
  return Math.round((pesos / mepVentaDiaAnterior) * 100) / 100
}

/** Dígitos con país → como en la planilla: "54 9 11 3000-5555" (Argentina) o "'+34 600111222" (otros países, con
 *  apóstrofo para que Sheets lo guarde como texto). Si un número argentino no tiene 10 dígitos después del 54 (y el 9),
 *  quedan los dígitos con espacios simples. Un número sin código de país queda tal cual (lo confirma el closer). */
export function telefonoPlanilla(numero: string): string {
  const d = numero.replace(/\D/g, '')
  if (!d) return ''
  if (telefonoSinPais(d)) return `'${d}`
  if (!d.startsWith('54')) {
    const pais = largoCodigoPais(d)
    return `'+${d.slice(0, pais)} ${d.slice(pais)}`
  }
  const movil = d[2] === '9'
  const pre = movil ? '54 9' : '54'
  const nacional = d.slice(movil ? 3 : 2)
  if (nacional.length !== 10) return `${pre} ${nacional}`.trim()
  const largoArea = largoAreaAr(nacional)
  const area = nacional.slice(0, largoArea)
  const abonado = nacional.slice(largoArea)
  return `${pre} ${area} ${abonado.slice(0, -4)}-${abonado.slice(-4)}`
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

// Columna R (Tomás, 24/10/2026), sobre el texto en minúsculas y sin acentos:
//   · Tomi: el destinatario es Napolitano Tomás, en cualquier banco o billetera (Santander, Galicia, Mercado Pago…).
//   · Gero: Gerónimo Actis, en cualquier lado, y la cripto (la recibe él). Se pide "Actis": en el equipo hay otro Gero
//     (Mozzi), así que un "Gerónimo" solo no alcanza y se pregunta.
//   · Empresa: Stripe, dLocal Go (también "dLocalGo"), PayPal (también "Pay-Pal"), Relay y la Financiera (Asociación
//     Mutual de Escribanos o algo parecido a "Tecnos Ross": tecno/tecnos + ross/cross/ros, con o sin espacio o guion).
//     De la Financiera se piden frases ("asociación mutual", "mutual de escribanos"): los clientes son abogados y
//     escribanos, y un "transferencia del escribano Gómez" no es la Financiera.
const REGLAS_CUENTA: { cuenta: CuentaRecibio; re: RegExp }[] = [
  { cuenta: 'Tomi', re: /\bnapolitano\b/ },
  { cuenta: 'Gero', re: /\bactis\b/ },
  { cuenta: 'Gero', re: /\bcripto|\bcrypto|\busdt\b|\busdc\b|\bbinance\b|\bbitcoin\b|\bbtc\b|\btether\b/ },
  { cuenta: 'Empresa', re: /\bstripe\b|\brelay\b|\bpay\s*-?\s*pal\b|\bd\s*-?\s*local(?:\s*-?\s*go)?\b|\bfinanciera\b|\basociacion mutual\b|\bmutual de escribanos\b|\btecnos?[\s.-]*c?ros{1,2}\b/ },
]

/** Cuenta que recibió (col R) a partir de un texto: el destinatario del comprobante o el medio de pago del #ALTA.
 *  Devuelve Tomi, Gero o Empresa solo si es claro; null si no dice nada o si apunta a dos cuentas distintas
 *  (ej. "PayPal de Napolitano"): en ese caso se pregunta en Verificaciones C.J. */
export function cuentaPorMedio(texto: string | null | undefined): CuentaRecibio | null {
  if (!texto) return null
  const t = normal(texto)
  const halladas = new Set(REGLAS_CUENTA.filter((r) => r.re.test(t)).map((r) => r.cuenta))
  return halladas.size === 1 ? [...halladas][0] : null
}

/** Monto como en la lista de programas: "$3300" sin separador de miles, "$6.000" con punto; decimales con coma. */
const montoLista = (n: number, conPunto: boolean) => `$${n.toLocaleString('de-DE', { useGrouping: conPunto, maximumFractionDigits: 2 })}`

// El prefijo de la col B (DFY, DFY+R, DFY+R++, DWY) lo deduce prefijoPrograma() de parsear.ts, que también avisa en el
// #ALTA si es una renovación.

/** Columna B: "DFY | PP | $3300". Si no está en la lista se devuelve igual, con aviso. */
export function programaPlanilla(a: Pick<AltaParseada, 'programa' | 'modalidad' | 'totalUsd'>): { valor: string; enLista: boolean } | null {
  if (!a.modalidad || a.totalUsd === null) return null
  const base = `${prefijoPrograma(a.programa)} | ${a.modalidad} | `
  const lista = OPCIONES_PROGRAMA as readonly string[]
  const sinPunto = base + montoLista(a.totalUsd, false)
  const conPunto = base + montoLista(a.totalUsd, true)
  if (lista.includes(sinPunto)) return { valor: sinPunto, enLista: true }
  if (lista.includes(conPunto)) return { valor: conPunto, enLista: true }
  // Fuera de la lista: misma convención que la lista ($3300 sin punto, $6.000 con punto)
  return { valor: a.totalUsd >= 6000 ? conPunto : sinPunto, enLista: false }
}

type ExtrasEfectivo = Partial<Pick<ExtrasRegistro, 'fecha' | 'pesosArs' | 'mepDiaAnterior' | 'fechaMep'>>

/** E (USD) y F (pesos) del pago, con lo que falta y lo que hay que mirar. Pago en pesos (Tomás, 24/10/2026):
 *  F = pesos del comprobante (o, mientras no está, los que escribió el closer) y E = pesos ÷ dólar MEP (venta) del día
 *  anterior al pago, más lo que se pagó aparte en USD si fue mixto. El USD que escribió el closer nunca va a E si hubo pesos. */
function efectivoRecaudado(a: AltaParseada, extras: ExtrasEfectivo): { E: number | ''; F: number | ''; pendientes: string[]; avisos: string[] } {
  const pendientes: string[] = []
  const avisos: string[] = []
  // El comprobante en pesos manda aunque el closer no lo haya dicho: todo el pago se toma en pesos
  const pesos = a.pagoEnPesos ?? (extras.pesosArs !== undefined ? { ars: null, usdDelCloser: a.estePagoUsd, usdAparte: 0 } : null)
  if (!pesos) {
    if (a.estePagoUsd === null) pendientes.push('Efectivo recaudado: monto de este pago en USD')
    return { E: a.estePagoUsd ?? '', F: '', pendientes, avisos }
  }
  if (!a.pagoEnPesos) avisos.push('El comprobante es en pesos y "Este pago" no lo dice: revisar')

  const montoArs = extras.pesosArs ?? pesos.ars
  if (extras.pesosArs === undefined) {
    pendientes.push(pesos.ars === null ? 'Monto en pesos del comprobante' : `Monto en pesos del comprobante: confirmar los $${num(pesos.ars)} que escribió el closer`)
  } else if (pesos.ars !== null && Math.abs(pesos.ars - extras.pesosArs) > 1) {
    avisos.push(`El closer escribió $${num(pesos.ars)} y el comprobante dice $${num(extras.pesosArs)}: revisar`)
  }

  const dado = extras.mepDiaAnterior
  const mep = dado !== undefined && Number.isFinite(dado) && dado > 0 ? dado : null
  if (dado !== undefined && mep === null) avisos.push(`Cotización MEP inválida: ${dado}`)
  if (mep === null) pendientes.push('Dólar MEP del día anterior al pago (venta, casa "bolsa" de argentinadatos; si ese día no hubo cotización, la última anterior)')

  let E: number | '' = ''
  const usdDePesos = montoArs !== null && mep !== null ? usdDesdePesos(montoArs, mep) : null
  if (usdDePesos !== null && mep !== null) {
    E = r2(pesos.usdAparte + usdDePesos)
    // Fecha de la cotización usada (si el servidor la pasó); si no, el día anterior al pago
    const ymd = extras.fecha !== undefined ? ymdCarga(extras.fecha) : null
    const diaMep = extras.fechaMep && esYmdValido(extras.fechaMep) ? extras.fechaMep : ymd ? fechaDiaAnterior(ymd) : null
    avisos.push(`USD calculado con MEP ${num(mep)}${diaMep ? ` del ${ddmmaaaa(diaMep).slice(0, 5)}` : ''}`)
    // Criterio: más de 3 % de diferencia con lo que dijo el closer lo mira un humano
    if (pesos.usdDelCloser !== null && Math.abs(usdDePesos - pesos.usdDelCloser) > Math.max(1, pesos.usdDelCloser * 0.03)) {
      avisos.push(`Con el MEP de ${num(mep)}, los $${num(montoArs!)} son ${num(usdDePesos)} USD y el closer puso ${num(pesos.usdDelCloser)} USD: revisar`)
    }
  }
  return { E, F: montoArs ?? '', pendientes, avisos }
}

/** USD de este pago: E si se pudo calcular; si no, lo que dijo el closer (null si no se sabe). */
export function usdDelPago(a: AltaParseada, extras: ExtrasEfectivo = {}): number | null {
  const { E } = efectivoRecaudado(a, extras)
  return typeof E === 'number' ? E : a.estePagoUsd
}

/** ¿Este pago es un Fee (menos de USD 500)? Entonces se registra en Finanzas y el resto del alta espera. */
export const esPagoFee = (a: AltaParseada, extras: ExtrasEfectivo = {}): boolean => esMontoFee(usdDelPago(a, extras))

/** Pago en pesos del que todavía no se sabe cuántos USD son (y, por lo tanto, si es un Fee): devuelve lo que falta
 *  ("el dólar MEP del día anterior" o "el monto en pesos del comprobante"). null si no es en pesos o si el USD ya se sabe
 *  (calculado con el MEP o dicho por el closer). Con esto el alta espera en vez de arrancar (regla del Fee). */
export function faltaParaUsd(a: AltaParseada, extras: ExtrasEfectivo = {}): string | null {
  const enPesos = a.pagoEnPesos !== null || extras.pesosArs !== undefined
  if (!enPesos || usdDelPago(a, extras) !== null) return null
  const mep = extras.mepDiaAnterior
  const hayMep = mep !== undefined && Number.isFinite(mep) && mep > 0
  return hayMep ? 'el monto en pesos del comprobante' : 'el dólar MEP del día anterior'
}

/** ¿Pago en pesos (lo dice el #ALTA o el comprobante) sin el dólar MEP? Finanzas lo necesita SIEMPRE para la columna E,
 *  aunque el closer haya escrito los USD al lado ("$1.650.000 ARS (1100 USD)"): el USD del closer nunca va a E y el Fee se
 *  decide con el del MEP (revisión del 24/10, ronda 2: faltaParaUsd daba null con el USD del closer y el MEP no se buscaba). */
export function faltaMep(a: AltaParseada, extras: ExtrasEfectivo = {}): boolean {
  const enPesos = a.pagoEnPesos !== null || extras.pesosArs !== undefined
  const mep = extras.mepDiaAnterior
  return enPesos && !(mep !== undefined && Number.isFinite(mep) && mep > 0)
}

/** Arma la fila de "Registro de Pagos" para el primer pago de un alta nueva. No escribe nada. */
export function filaRegistroPagos(a: AltaParseada, extras: ExtrasRegistro): FilaRegistroPagos {
  const pendientes: string[] = []
  const avisos: string[] = []
  const tel = a.telefonos[0]?.numero ?? null
  const porTelefono = tel && !telefonoSinPais(tel) ? `por teléfono (+${tel})` : 'por teléfono'
  const delCrm = (campo: string) => `${campo}: el bot lo busca en el CRM de ventas ${porTelefono}; si no está, se lo pregunta al closer`

  // A · Fecha: serial de Sheets (+ la fecha legible para la vista previa)
  const ymd = ymdCarga(extras.fecha)
  const serial = ymd ? ymdASerial(ymd) : null
  if (serial === null) avisos.push(`Fecha de carga inválida: ${String(extras.fecha)}`)

  // B · Programa (DFY+R es renovación: no es un alta nueva)
  const prefijo = prefijoPrograma(a.programa)
  const renovacion = prefijo === 'DFY+R' || prefijo === 'DFY+R++'
  const programa = programaPlanilla(a)
  if (!programa) pendientes.push('Programa: falta el tipo de pago (PP o PIF) y el total en USD')
  else if (!programa.enLista) avisos.push(`El programa "${programa.valor}" no está en la lista de la planilla`)
  if (renovacion) {
    avisos.push(`${prefijo} es una renovación, no un alta nueva: revisar antes de cargarlo`)
    pendientes.push('Tipos de venta: una renovación no va como "Front-end"; falta que Tomás confirme si va "Back-end"')
  }

  // C · Nombre · D · Teléfono
  if (!a.nombre) pendientes.push('Nombre del cliente')
  else if (a.nombre.trim().split(/\s+/).length < 2) pendientes.push('Nombre completo con una sola palabra: pedir el apellido')
  if (!tel) pendientes.push('Teléfono del cliente')
  else if (telefonoSinPais(tel)) pendientes.push('Teléfono con código de país: lo confirma el closer')

  // E · Efectivo recaudado (USD) · F · Pesos ARS
  const ef = efectivoRecaudado(a, extras)
  pendientes.push(...ef.pendientes)
  avisos.push(...ef.avisos)

  // G · Closer · H · Setter · K · Fuente (no se inventan: los resuelve el motor, lib/bot/alta/setterFuente.ts)
  if (!a.closer) pendientes.push('Closer')
  const setter = extras.setter?.trim() ?? ''
  if (!setter) pendientes.push(delCrm('Setter'))
  else if (!(OPCIONES_SETTER as readonly string[]).includes(setter)) avisos.push(`El setter "${setter}" no está en la lista de la planilla`)
  const fuente = extras.fuente?.trim() ?? ''
  if (!fuente) pendientes.push('Fuente: el bot la saca de los UTM del lead (CRM de ventas); si no alcanzan, la que dijo el closer; si no, se pregunta en Verificaciones C.J')
  else if (!(OPCIONES_FUENTE as readonly string[]).includes(fuente)) avisos.push(`La fuente "${fuente}" no está en la lista de la planilla`)

  // J · Concepto (Tomás, 24/10/2026): PIF → "PIF"; primer pago de un PP → "1ra Cuota"; menos de USD 500 → "Fee"
  // (una seña que no completa la primera cuota: se registra y el alta no arranca hasta llegar a USD 500).
  // PROPUESTA: con un Fee, la col B sigue con el programa; falta preguntarle a Tomás si va "Fee" (está en la lista).
  const usd = typeof ef.E === 'number' ? ef.E : a.estePagoUsd
  const esFee = esMontoFee(usd)
  const concepto = esFee ? 'Fee' : a.modalidad === 'PIF' ? 'PIF' : a.modalidad === 'PP' ? '1ra Cuota' : ''
  if (esFee && usd !== null) avisos.push(`Fee: el pago es de ${num(usd)} USD. El alta no arranca hasta llegar a USD ${MINIMO_USD}: se registra el Fee y se avisa en Verificaciones C.J`)

  // I · Comprobante: "<Nombre> - PP 1/<n>" (n = este pago + cuotas pendientes), "<Nombre> - PIF" o, si es Fee,
  // "<Nombre> - Fee" (PROPUESTA: falta que Tomás confirme cómo se nombra el comprobante del Fee).
  const cuotasPendientes = a.cuotas.filter((c) => !c.pagada)
  let comprobante = ''
  if (a.nombre && esFee) comprobante = `${a.nombre} - Fee`
  else if (a.nombre && a.modalidad === 'PIF') comprobante = `${a.nombre} - PIF`
  else if (a.nombre && a.modalidad === 'PP') {
    const n = cuotasPendientes.length
    comprobante = `${a.nombre} - PP 1/${n ? n + 1 : '?'}`
    if (!n) pendientes.push('Cuotas del plan: sin ellas no se sabe el total de pagos del comprobante (PP 1/?)')
    else if (a.estePagoUsd !== null && a.totalUsd !== null) {
      const suma = a.estePagoUsd + cuotasPendientes.reduce((s, c) => s + c.montoUsd, 0)
      if (Math.abs(suma - a.totalUsd) > 1) {
        avisos.push(`El comprobante dice PP 1/${n + 1}, pero este pago + las cuotas pendientes suman ${num(suma)} USD y el total es ${num(a.totalUsd)} USD: revisar si el pago de hoy está repetido en "Cuotas"`)
      }
    }
  }

  // O · Tipo de pago
  const tipoPago = a.modalidad === 'PIF' ? 'Upfront' : a.modalidad === 'PP' ? 'Payment Plan' : ''

  // R · Cuenta que recibió (Tomi, Gero o Empresa): la dada manda; si no, se deduce del destinatario del comprobante
  // y, si ese no alcanza, del medio de pago del #ALTA. Si es clara se escribe; si no, se pregunta.
  let cuenta = extras.cuenta?.trim() ?? ''
  if (cuenta) {
    if ((CUENTAS_VIEJAS as readonly string[]).includes(cuenta)) avisos.push(`La cuenta "${cuenta}" es de las filas viejas: ahora va Tomi, Gero o Empresa`)
    else if (!(OPCIONES_CUENTA as readonly string[]).includes(cuenta)) avisos.push(`La cuenta "${cuenta}" no está en la lista (Tomi, Gero o Empresa)`)
    // La cuenta dada (un OK en Verificaciones) contra el destinatario del comprobante: si no coinciden, que se vea (la columna
    // R define el reparto; revisión del 24/10, ronda 2)
    const porComprobante = cuentaPorMedio(extras.destinatario)
    if (porComprobante && porComprobante !== cuenta) avisos.push(`La cuenta que se cargó (${cuenta}) no coincide con el destinatario del comprobante (${porComprobante}): revisar la columna R`)
  } else {
    const porComprobante = cuentaPorMedio(extras.destinatario)
    const porMedio = cuentaPorMedio(a.medioPago)
    cuenta = porComprobante ?? porMedio ?? ''
    if (porComprobante && porMedio && porComprobante !== porMedio) {
      avisos.push(`El comprobante dice ${porComprobante} y el medio de pago del #ALTA dice ${porMedio}: se toma ${porComprobante}, revisar`)
    }
    // El medio del #ALTA es texto libre del closer (puede nombrar a quien paga): se escribe, pero se confirma
    if (!porComprobante && porMedio) avisos.push(`Cuenta ${porMedio} deducida del medio de pago del #ALTA: confirmar con el destinatario del comprobante`)
    if (!cuenta) pendientes.push('Cuenta: se deduce del comprobante (si no está claro, pregunta en Verificaciones C.J)')
  }

  const celdas: Record<ColumnaRegistro, CeldaRegistro> = {
    A: serial ?? '',
    B: programa?.valor ?? '',
    C: a.nombre ?? '',
    D: tel ? telefonoPlanilla(tel) : '',
    E: ef.E,
    F: ef.F,
    G: a.closer ?? '',
    H: setter,
    I: comprobante,
    J: concepto,
    K: fuente,
    L: '',                           // comisión de la pasarela: normalmente vacía
    M: formulaMes(FILA_NUEVA),       // no se escribe el valor: la fórmula lo calcula
    N: renovacion ? '' : 'Front-end', // un alta nueva es front-end; una renovación queda pendiente
    O: tipoPago,
    P: null,                         // categoría vieja: no se toca
    Q: null,
    R: cuenta,
  }
  return {
    celdas,
    fila: COLUMNAS_REGISTRO.map(({ col }) => celdas[col]),
    fechaTexto: fechaPlanilla(extras.fecha) ?? '',
    fechaLegible: ymd ? ddmmaaaa(ymd) : '',
    pendientes,
    avisos,
  }
}
