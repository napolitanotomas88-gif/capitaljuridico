// ── SOLO PARA PRUEBAS: borra el pago de prueba del bot de "Registro de Pagos" (y su comprobante) ─────────────────────
// Lo usa scripts/bot-finanzas-prueba-real.mjs para dejar "SKWD | Finanzas 2026" como estaba después de cargar un pago
// inventado con cargarPagoFinanzas(). La app NO lo llama nunca. Candados para la FILA (si alguno falla, la fila no se
// toca):
//   · nunca en Vercel ni con NODE_ENV=production;
//   · los encabezados de "Registro de Pagos" tienen que ser los de siempre (si movieron columnas, no se adivina);
//   · se busca la fila de prueba en las filas 2–10 (si alguien cargó un pago en el medio, ya no está en la 2) y se
//     borra solo si coincide TODA la huella del pago inventado: C e I empiezan con "PRUEBA BOT", A = la fecha que cargó
//     la prueba (serial, obligatorio), D = 54 9 11 3000-9999, E = 1100 y G = Marcos. Si hay más de una, no se borra.
// Borra con deleteDimension SOLO esa fila (la de abajo sube y su fórmula de M se ajusta sola).
// Límite: Sheets no tiene compare-and-set: se verifica por contenido pero se borra por posición, así que si alguien
// inserta una fila entre la relectura y el borrado (unos cientos de ms) se borra la fila equivocada. Por eso:
//   · la prueba --real se coordina con Aylu (que nadie cargue pagos durante el minuto que dura);
//   · después de borrar se relee y se controla: si la de prueba sigue en la planilla, se avisa en mayúsculas "SE BORRÓ
//     UNA FILA QUE NO ERA LA PRUEBA" con la hora, para restaurar desde Archivo → Historial de versiones.
// El comprobante se manda SIEMPRE a la papelera por el Puente Drive (se recupera durante 30 días), aunque la fila no se
// haya podido borrar, solo si su nombre también empieza con "PRUEBA BOT".
import { normTxt } from '../../clientes/texto'
import type { ControlVerificacion, Fila, PlanillaFinanzas } from './finanzasEscribir'
import { PESTANA_REGISTRO, celdaVacia, encabezadosDistintos, planillaFinanzasReal } from './finanzasEscribir'
import { esIdDrive, puenteDriveReal, type PuenteDrive } from './puenteDrive'

export const PREFIJO_PRUEBA = 'PRUEBA BOT'
/** El resto de la huella del #ALTA inventado de scripts/bot-finanzas-prueba-real.mjs (el script controla que coincida). */
export const HUELLA_PRUEBA = { telefono: '54 9 11 3000-9999', usd: 1100, closer: 'Marcos' } as const
const I_A = 0, I_C = 2, I_D = 3, I_E = 4, I_G = 6, I_I = 8
/** Última fila donde se busca la de prueba (desde la 2). */
export const FILA_MAXIMA = 10

export interface DepsLimpieza { planilla?: () => PlanillaFinanzas; puente?: () => PuenteDrive }

export interface OpcionesLimpieza {
  /** Serial de la fecha que cargó la prueba (col A). Obligatorio: sin él no se borra nada. */
  serial: number
  /** Id del comprobante que subió la prueba (cargarPagoFinanzas → comprobanteId). */
  comprobanteId?: string | null
  /** Nombre con que se subió (cargarPagoFinanzas → nombreArchivo): tiene que empezar con "PRUEBA BOT". */
  nombreArchivo?: string | null
  deps?: DepsLimpieza
}

export interface ResultadoLimpieza {
  /** La fila de prueba se borró y se confirmó (o no había ninguna) y, si se pidió, el comprobante fue a la papelera. */
  ok: boolean
  /** No había ninguna fila de prueba en las filas 2–10 (no se borró nada). */
  noEstaba: boolean
  /** Número de fila que se borró (antes de borrar), o null. */
  filaBorrada: number | null
  comprobanteEnPapelera: boolean
  motivo: string | null
  controles: ControlVerificacion[]
}

const empiezaConPrefijo = (c: unknown) => String(c ?? '').trim().startsWith(PREFIJO_PRUEBA)
const horaArgentina = () => new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
const mensajeDe = (e: unknown, largo = 200) => String((e as Error)?.message ?? e).slice(0, largo)

/** Nunca fuera de una máquina de desarrollo. */
export function entornoProhibido(env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL || env.VERCEL_ENV) return 'La limpieza de pruebas no corre en Vercel.'
  if (env.NODE_ENV === 'production') return 'La limpieza de pruebas no corre con NODE_ENV=production.'
  return null
}

/** Campos de la huella que NO coinciden (vacío = es la fila del pago de prueba). Lee UNFORMATTED_VALUE. Puro. */
export function diferenciasConPrueba(fila: Fila, serial: number): string[] {
  const out: string[] = []
  if (!empiezaConPrefijo(fila[I_C])) out.push('C')
  if (!(typeof fila[I_A] === 'number' && Math.round(fila[I_A] as number) === Math.round(serial))) out.push('A')
  if (String(fila[I_D] ?? '').trim() !== HUELLA_PRUEBA.telefono) out.push('D')
  if (!(typeof fila[I_E] === 'number' && Math.abs((fila[I_E] as number) - HUELLA_PRUEBA.usd) < 0.01)) out.push('E')
  if (normTxt(fila[I_G]) !== normTxt(HUELLA_PRUEBA.closer)) out.push('G')
  if (!empiezaConPrefijo(fila[I_I])) out.push('I')   // con chip, la col I se lee como el nombre del archivo
  return out
}

/** Filas (2–FILA_MAXIMA) que tienen la huella completa del pago de prueba. `filas` empieza en la fila 2. Puro. */
export function filasDePrueba(filas: Fila[], serial: number): number[] {
  return filas.slice(0, FILA_MAXIMA - 1).flatMap((f, i) => (diferenciasConPrueba(f, serial).length === 0 ? [i + 2] : []))
}

const igualFila = (a: Fila = [], b: Fila = []) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (!(celdaVacia(a[i]) && celdaVacia(b[i])) && a[i] !== b[i]) return false
  return true
}

/** Después de borrar la fila `fila`: ¿se borró la de prueba? `abajo` = la fila de debajo leída ANTES de borrar;
 *  `despues` = las filas desde la 2, releídas. Puro. */
export function controlarBorrado(fila: number, abajo: Fila, despues: Fila[], serial: number, hora: string): ControlVerificacion {
  const que = 'Se borró la fila de prueba (y no otra)'
  const sigue = filasDePrueba(despues, serial)
  if (sigue.length) return { que, ok: false, detalle: `SE BORRÓ UNA FILA QUE NO ERA LA PRUEBA (${hora}): la de prueba sigue en la fila ${sigue[0]}. Restaurar desde Archivo → Historial de versiones` }
  if (igualFila(despues[fila - 2], abajo)) return { que, ok: true, detalle: `la fila de abajo subió a la ${fila}` }
  if (igualFila(despues[fila - 1], abajo)) return { que, ok: true, detalle: `la de prueba ya no está; alguien cargó una fila justo después del borrado (la de abajo quedó en la ${fila + 1})` }
  return { que, ok: false, detalle: `NO SE PUEDE CONFIRMAR QUÉ FILA SE BORRÓ (${hora}): la que estaba debajo de la prueba no está en la fila ${fila} ni en la ${fila + 1}. Revisar Archivo → Historial de versiones` }
}

/** Busca la fila del pago de prueba (filas 2–10), la borra y manda su comprobante a la papelera (siempre). */
export async function limpiarPagoPrueba(opciones: OpcionesLimpieza): Promise<ResultadoLimpieza> {
  const base: ResultadoLimpieza = { ok: false, noEstaba: false, filaBorrada: null, comprobanteEnPapelera: false, motivo: null, controles: [] }
  const prohibido = entornoProhibido()
  if (prohibido) return { ...base, motivo: prohibido }
  const { deps = {}, serial } = opciones ?? ({} as OpcionesLimpieza)
  const fila = typeof serial === 'number' && Number.isFinite(serial)
    ? await limpiarFila(serial, deps)
    : { ...base, motivo: 'Falta el serial de la fecha que cargó la prueba: no se toca la planilla.' }

  // El comprobante va a la papelera aunque la fila no se haya podido borrar (es de la prueba: lo dice su nombre)
  const { comprobanteId, nombreArchivo } = opciones ?? {}
  if (!comprobanteId) return fila
  const p = await comprobantePruebaAPapelera(comprobanteId, String(nombreArchivo ?? ''), deps)
  const controles = [...fila.controles, { que: 'Comprobante a la papelera', ok: p.ok, detalle: p.ok ? `"${nombreArchivo}"` : String(p.motivo) }]
  const motivos = [fila.motivo, p.ok ? null : `Comprobante a la papelera: ${p.motivo}`].filter(Boolean)
  return { ...fila, ok: fila.ok && p.ok, comprobanteEnPapelera: p.ok, controles, motivo: motivos.length ? motivos.join(' · ') : null }
}

async function limpiarFila(serial: number, deps: DepsLimpieza): Promise<ResultadoLimpieza> {
  const base: ResultadoLimpieza = { ok: false, noEstaba: false, filaBorrada: null, comprobanteEnPapelera: false, motivo: null, controles: [] }
  const rango = `'${PESTANA_REGISTRO}'!A1:R${FILA_MAXIMA + 1}`   // encabezados + filas 2..11 (la 11 = la de abajo de la 10)

  // 1. Relectura inmediatamente antes de borrar
  let planilla: PlanillaFinanzas, encabezados: Fila, filas: Fila[], sheetId: number
  try {
    planilla = (deps.planilla ?? (() => planillaFinanzasReal('real')))()
    const [[bloque = []], estructura] = await Promise.all([planilla.leer([rango], 'UNFORMATTED_VALUE'), planilla.estructura(2)])
    encabezados = bloque[0] ?? []
    filas = bloque.slice(1)
    sheetId = estructura.sheetId
  } catch (e) {
    return { ...base, motivo: `No se pudo leer "${PESTANA_REGISTRO}": ${mensajeDe(e)}. No se tocó la planilla.` }
  }
  const distintos = encabezadosDistintos(encabezados)
  if (distintos.length) return { ...base, motivo: `Los encabezados cambiaron (${distintos.join('; ')}): no se toca la planilla.` }
  const posiciones = filasDePrueba(filas, serial)
  if (!posiciones.length) {
    const parecida = filas.slice(0, FILA_MAXIMA - 1).findIndex(f => empiezaConPrefijo(f[I_C]))
    return {
      ...base, ok: parecida < 0, noEstaba: true,
      motivo: parecida < 0 ? null : `La fila ${parecida + 2} se llama "${PREFIJO_PRUEBA}…" pero no coincide en ${diferenciasConPrueba(filas[parecida], serial).join(', ')}: no se borra; revisarla a mano.`,
    }
  }
  if (posiciones.length > 1) return { ...base, motivo: `Hay ${posiciones.length} filas de prueba iguales (filas ${posiciones.join(', ')}): no se borra ninguna; revisar a mano.` }
  const n = posiciones[0]
  const abajo = filas[n - 1] ?? []   // filas[0] es la fila 2: la de abajo de la n es filas[n - 1]

  // 2. Borrar esa sola fila
  try {
    await planilla.batchUpdate([{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }])
  } catch (e) {
    return { ...base, motivo: `No se pudo borrar la fila ${n} (${mensajeDe(e)}): sigue en la planilla; borrarla a mano.` }
  }
  const hora = horaArgentina()

  // 3. Control: la de prueba ya no está y la de abajo subió
  let control: ControlVerificacion
  try {
    const [bloque = []] = await planilla.leer([rango], 'UNFORMATTED_VALUE')
    control = controlarBorrado(n, abajo, bloque.slice(1), serial, hora)
  } catch (e) {
    control = { que: 'Se borró la fila de prueba (y no otra)', ok: false, detalle: `no se pudo releer para confirmarlo (${hora}): ${mensajeDe(e, 160)}. Revisar a mano` }
  }
  return { ...base, ok: control.ok, filaBorrada: n, controles: [control], motivo: control.ok ? null : `${control.que}: ${control.detalle}` }
}

/** Solo el comprobante de una prueba. El nombre tiene que empezar con "PRUEBA BOT". */
export async function comprobantePruebaAPapelera(comprobanteId: string, nombreArchivo: string, deps: DepsLimpieza = {}): Promise<{ ok: boolean; motivo: string | null }> {
  const prohibido = entornoProhibido()
  if (prohibido) return { ok: false, motivo: prohibido }
  if (!esIdDrive(comprobanteId)) return { ok: false, motivo: 'Id de Drive inválido.' }
  if (!empiezaConPrefijo(nombreArchivo)) return { ok: false, motivo: `El archivo no es de una prueba (no empieza con "${PREFIJO_PRUEBA}"): no se toca.` }
  try {
    await (deps.puente ?? puenteDriveReal)().aPapelera(comprobanteId)
    return { ok: true, motivo: null }
  } catch (e) {
    return { ok: false, motivo: mensajeDe(e) }
  }
}
