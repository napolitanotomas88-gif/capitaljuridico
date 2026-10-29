// ── Bot "Capital Jurídico": paso "Alta en el CRM de Clientes" (docs/BOT-ALTA-CJ.md, paso 3) ─────────
// Puro y sin red: traduce el #ALTA ya leído (parsearAlta) a la EntradaAlta que espera planAlta() de
// lib/clientes/altas.ts. La lectura del CRM real y el plan van en crmServidor.ts; acá no se lee ni se escribe nada.
//   · faltantes = datos que faltan o están mal: se le piden al closer (igual que los del parser). Frenan el alta.
//   · bloqueos  = el alta no se escribe aunque no falte ningún dato: un Fee, un pago en pesos todavía sin convertir,
//                 una renovación, otro programa o algo que tiene que confirmar un humano (ver MotivoBloqueo).
//   · avisos    = lo que conviene que mire un humano, pero no frena el alta.
// Celular: el bot lo escribe como "+5491130009999" (texto con "+" y código de país). Al 24/10/2026 así están 105 de
// las 166 filas de Agencia, pero las cargas a mano desde la fila 108 están sin "+" y con espacios ("54 9 11 …"):
// las filas del bot van a quedar distintas a las recientes. FALTA decidir con el equipo un formato único.
// Para el CRM da igual: altas.ts compara celulares por los últimos 7 dígitos (clavesTelefono) y el LTV cobrado también.
import type { EntradaAlta } from '../../clientes/altas'
import { diasEntre, esYmdValido, hoyArgentina } from '../../clientes/fechas'
import type { Ymd } from '../../clientes/fechas'
import { TABLA_PRECIOS } from '../../clientes/precios'
import type { AltaParseada, Telefono } from './parsear'
import { MINIMO_USD, esMontoFee, telefonos } from './parsear'
import { telefonoSinPais } from './telefono'

/** Opciones de la lista "CONTRATO" de la pestaña Config del CRM (24/10/2026). */
export const OPCIONES_CONTRATO = ['Firmado', 'Enviado', 'Hacer', 'Pendiente', 'No hay'] as const
/** Sin el estado real del paso de PandaDoc, el contrato queda en "Hacer": el contrato es el último paso del alta
 *  (fase 1b) y, mientras no se mande, en el CRM no puede decir "Enviado". */
export const CONTRATO_SIN_ENVIAR = 'Hacer'

/** Total razonable de un programa, en USD: en la lista de Finanzas el más barato es USD 2.400 y el más caro USD 8.000.
 *  Menos que un pago mínimo o más de USD 10.000 es un error de carga (pesos, la cuota en lugar del total…). */
export const TOTAL_MIN_USD = MINIMO_USD
export const TOTAL_MAX_USD = 10_000
/** Un Día 1 a más de estos días de hoy (para atrás o para adelante) lo confirma un humano: ¿año mal escrito? */
export const DIAS_INICIO_LEJANO = 30

export interface ExtrasCrm {
  fuente?: string               // del CRM de ventas (se busca por el teléfono del lead)
  closersConocidos?: string[]   // los closers que ya figuran en Agencia ("Gero", "Fer", "Marcos"…), para escribirlo igual
  contrato?: string             // estado real que devuelve el paso de PandaDoc ("Enviado" si se mandó); sin él, "Hacer"
  estePagoUsdMep?: number       // USD de este pago con los pesos convertidos al MEP (la col. E de Finanzas: usdDelPago()
                                // con pesosArs y mepDiaAnterior). Solo se usa si hubo pesos, y solo si de verdad se convirtió.
  mensaje?: string              // el #ALTA tal como llegó: el parser no guarda el texto de "Tipo de pago" (renovaciones, pesos)
  hoy?: Ymd                     // hoy en Argentina (por defecto, hoyArgentina()): para el control del Día 1
}

export type MotivoBloqueo =
  | 'fee'            // pago de menos de USD 500: se registra en Finanzas y el alta espera a que el pago llegue al mínimo
  | 'espera_mep'     // pago en pesos: falta el USD convertido con el MEP para saber si llega al mínimo
  | 'renovacion'     // DFY+R: va como período nuevo en Renovaciones del cliente que ya existe, no como alta
  | 'otro_programa'  // no es Agencia: planAlta solo da de alta en Agencia, otro programa se carga a mano
  | 'confirmar'      // lo destraba un OK de Tomi o Gero en Verificaciones C.J (fecha lejana, posible cliente repetido…)
  | 'lectura'        // la lectura del CRM no alcanza para escribir (crmServidor.ts: columnas que no se encontraron)
export interface Bloqueo { motivo: MotivoBloqueo; detalle: string }

export interface MapeoCrm { entrada: EntradaAlta; faltantes: string[]; bloqueos: Bloqueo[]; avisos: string[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const fechaAr = (ymd: string) => ymd.split('-').reverse().join('/')

const RE_RENOVACION = /\+\s*r\b|\brenov/i               // "DFY+R", "DFY+R++", "PP 3400 +R", "renovación"
const RE_PESOS = /\b(ars|pesos?)\b|ar\$/i
const RE_MODALIDAD = /\b(PIF|PP)\b/i

/** Dígitos con país (como los deja el parser) → como está en Agencia: "+5491130009999". Sin país quedan los dígitos. */
export function celularCrm(numero: string): string {
  const d = numero.replace(/\D/g, '')
  if (!d) return ''
  return telefonoSinPais(d) ? d : `+${d}`
}

/** "marcos" o "Marcos Pérez" → "Marcos" si ese closer ya está en el CRM (por nombre completo o por el primer nombre). */
export function closerCanonico(closer: string, conocidos: string[] = []): string | null {
  const c = norm(closer)
  if (!c) return null
  const primero = c.split(' ')[0]
  return conocidos.find(k => norm(k) === c) ?? conocidos.find(k => norm(k) === primero) ?? null
}

/** Teléfono del cliente: el primero que NO vino en la línea "Socios:". El parser guarda los números en el orden en que
 *  aparecen, así que si el closer escribe "Socios:" antes que "Teléfono:", el primero de la lista es el del socio.
 *  (Lo ideal es que el parser marque el origen de cada número; mientras tanto se reconocen releyendo `socios`.) */
export function telefonoDelCliente(a: Pick<AltaParseada, 'telefonos' | 'socios'>): Telefono | null {
  const deSocios = new Set(a.socios ? telefonos(a.socios).map(t => t.numero) : [])
  return a.telefonos.find(t => !deSocios.has(t.numero)) ?? null
}

/** Valor de una línea "Clave: valor" del mensaje original (clave ya normalizada, ej. 'tipo de pago'). */
function valorDeClave(mensaje: string | undefined, clave: string): string | null {
  for (const l of (mensaje ?? '').split(/\r?\n/)) {
    const i = l.indexOf(':')
    if (i > 0 && norm(l.slice(0, i)) === clave) return l.slice(i + 1).trim()
  }
  return null
}

/** En PP: ¿las cuotas cierran con el total? Se aceptan las dos formas en que escriben los closers: la lista con todas
 *  las cuotas (formato de antes con ✅, o "Este pago" incluido como primera) o solo las que faltan más "Este pago".
 *  Devuelve el faltante, o null si cierra o no se puede saber (sin cuotas, o "Este pago" en pesos sin USD). */
function cuotasQueNoCierran(a: AltaParseada): string | null {
  if (a.modalidad !== 'PP' || !a.cuotas.length || a.totalUsd === null) return null
  const total = a.totalUsd
  const cuotas = a.cuotas.reduce((s, c) => s + c.montoUsd, 0)
  const cerca = (x: number) => Math.abs(x - total) <= 1
  if (cerca(cuotas)) return null
  const pago = a.estePagoUsd   // el USD nominal del closer: las cuotas también son nominales (el MEP lo correría)
  if (pago === null) return null
  if (cerca(cuotas + pago)) return null
  return `Total en USD: las cuotas (${cuotas}) más este pago (${pago}) dan ${cuotas + pago} y el total dice ${total}; confirmar el total y las cuotas`
}

export function entradaCrmDesdeAlta(a: AltaParseada, extras: ExtrasCrm = {}): MapeoCrm {
  const faltantes: string[] = [], bloqueos: Bloqueo[] = [], avisos: string[] = []
  const hoy = esYmdValido(extras.hoy) ? extras.hoy : hoyArgentina()

  const nombre = (a.nombre ?? '').trim()
  if (!nombre) faltantes.push('Nombre completo')

  // Celular: solo el del cliente. Los socios no van: el LTV cobrado se cruza con el teléfono del pago.
  const delCliente = telefonoDelCliente(a)
  const tel = delCliente?.numero ?? ''
  const celular = celularCrm(tel)
  if (!celular) faltantes.push(a.telefonos.length ? 'Teléfono del cliente (solo vinieron los de los socios)' : 'Teléfono')
  else if (telefonoSinPais(tel.replace(/\D/g, ''))) faltantes.push('Teléfono con código de país (ej. +54 9 11 …)')   // mismo texto que el parser
  if (delCliente && a.telefonos.length > 1) avisos.push(`El #ALTA trae ${a.telefonos.length - 1} teléfono(s) más (socios o estudio): en el CRM va solo el del cliente.`)

  // Día 1: fecha real del calendario (el parser acepta "31/02/2026") y no muy lejos de hoy
  const dia1 = a.inicio ?? ''
  if (!dia1) faltantes.push('Inicio del servicio')
  else if (!esYmdValido(dia1)) faltantes.push(`Inicio del servicio: ${fechaAr(dia1)} no es una fecha válida (dd/mm/aaaa)`)
  else {
    const dias = diasEntre(hoy, dia1)
    if (Math.abs(dias) > DIAS_INICIO_LEJANO) {
      bloqueos.push({ motivo: 'confirmar', detalle: `El Día 1 (${fechaAr(dia1)}) está ${dias > 0 ? `${dias} días después` : `${-dias} días antes`} de hoy (${fechaAr(hoy)}): confirmar la fecha (¿año mal escrito?) antes de cargarlo.` })
    }
  }

  if (!a.correo) avisos.push('Sin correo: el CRM queda sin mail y no se puede buscar un duplicado por mail.')

  // Closer: se escribe como ya figura en el CRM (las métricas agrupan por ese texto)
  const closerCrudo = (a.closer ?? '').trim()
  let closer = closerCrudo
  if (closerCrudo && extras.closersConocidos?.length) {
    const canon = closerCanonico(closerCrudo, extras.closersConocidos)
    if (canon) closer = canon
    else avisos.push(`El closer "${closerCrudo}" no figura en Agencia (${extras.closersConocidos.join(', ')}): se carga como vino.`)
  }
  if (!closerCrudo) avisos.push('Sin closer: la fila queda con el closer vacío.')

  // Precio del período 0 = el total del #ALTA (pisa la tabla, que es un borrador). Antes de usarlo se controla que sea
  // un total en USD razonable y que, en PP, cierre con las cuotas: si no, NO va a la entrada y se le pide al closer.
  const tipoPago = valorDeClave(extras.mensaje, 'tipo de pago')
  let producto: string | undefined
  let precioUSD: number | undefined
  if (a.totalUsd === null) faltantes.push('Total en USD (Tipo de pago: PP o PIF y el monto)')
  else if (tipoPago && RE_PESOS.test(tipoPago)) faltantes.push(`Total en USD: "Tipo de pago" parece estar en pesos (${tipoPago}); el total del programa va en USD`)
  else if (a.totalUsd < TOTAL_MIN_USD || a.totalUsd > TOTAL_MAX_USD) {
    faltantes.push(`Total en USD: ${a.totalUsd} está fuera de lo razonable para un programa (USD ${TOTAL_MIN_USD} a ${TOTAL_MAX_USD.toLocaleString('es-AR')}); ¿está en pesos o es la cuota en lugar del total?`)
  } else {
    const noCierra = cuotasQueNoCierran(a)
    if (noCierra) faltantes.push(noCierra)
    else {
      precioUSD = a.totalUsd
      // Si coincide con un producto de la tabla se usa esa clave; si no, va igual (2.400 y 3.000 son precios comunes
      // que la tabla no tiene, así que no se avisa: el precio sale del #ALTA, no de la tabla)
      producto = Object.entries(TABLA_PRECIOS.productos).find(([, p]) => p.precioUSD === a.totalUsd)?.[0]
    }
  }

  // Programa: una renovación no es un alta nueva, y planAlta solo da de alta en Agencia
  const textosPrograma = [a.programa ?? '', tipoPago ?? '', ...(extras.mensaje ?? '').split(/\r?\n/).filter(l => RE_MODALIDAD.test(l))]
  if (textosPrograma.some(t => RE_RENOVACION.test(t))) {
    bloqueos.push({ motivo: 'renovacion', detalle: 'Es una renovación (DFY+R): va como período nuevo en Renovaciones del cliente que ya existe, no como alta nueva con ID nuevo.' })
  } else if (a.programa && !/agencia|dfy|done for you/.test(norm(a.programa))) {
    bloqueos.push({ motivo: 'otro_programa', detalle: `Programa "${a.programa}": el bot solo da de alta en Agencia; otro programa se carga a mano.` })
  }

  // Pago mínimo (docs/BOT-ALTA-CJ.md: con menos de USD 500 el alta no arranca). Si hubo pesos, el USD que cuenta es el
  // convertido con el MEP (el que escribió el closer nunca va a Finanzas): hasta tenerlo, el alta espera.
  const hayPesos = a.pagoEnPesos !== null
  const mep = extras.estePagoUsdMep
  const usdPago = hayPesos ? (typeof mep === 'number' && Number.isFinite(mep) && mep >= 0 ? mep : null) : a.estePagoUsd
  if (hayPesos && usdPago === null) {
    bloqueos.push({ motivo: 'espera_mep', detalle: `El pago fue (todo o en parte) en pesos: el alta espera el USD convertido con el dólar MEP del día anterior (paso de Finanzas) para saber si llega a USD ${MINIMO_USD}.` })
  } else if (usdPago === null) faltantes.push('Este pago (monto en USD y medio)')
  else if (esMontoFee(usdPago)) {
    bloqueos.push({ motivo: 'fee', detalle: `El pago es de USD ${usdPago}: es un Fee (menos de USD ${MINIMO_USD}). Se registra en Finanzas y el alta en el CRM espera a que el pago llegue a USD ${MINIMO_USD}.` })
  }

  // Contrato: el estado real del paso de PandaDoc; sin él, "Hacer"
  const contratoDado = (extras.contrato ?? '').trim()
  const contrato = OPCIONES_CONTRATO.find(o => norm(o) === norm(contratoDado)) ?? CONTRATO_SIN_ENVIAR
  if (contratoDado && norm(contrato) !== norm(contratoDado)) {
    avisos.push(`Estado de contrato "${contratoDado}" fuera de la lista de Config (${OPCIONES_CONTRATO.join(', ')}): se carga "${CONTRATO_SIN_ENVIAR}".`)
  }

  const fuente = (extras.fuente ?? '').trim()
  const anotaciones = `Alta automática del bot C.J. (#ALTA ${closer ? `de ${closer}` : 'sin closer'})`
    + (a.contrato === 'garantia' ? ' · contrato con GARANTÍA' : '')

  const entrada: EntradaAlta = {
    nombre,
    celular,
    dia1,
    contrato,
    anotaciones,
    ...(a.correo ? { mail: a.correo } : {}),
    ...(closer ? { closer } : {}),
    ...(fuente ? { fuente } : {}),
    ...(producto ? { producto } : {}),
    ...(precioUSD !== undefined ? { precioUSD } : {}),
    // meses: sin pisar → los del producto (4 = programa estándar: 120 días corridos desde el Día 1; Meses queda vacío)
  }
  return { entrada, faltantes, bloqueos, avisos }
}
