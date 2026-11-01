// ── Bot "Capital Jurídico": etapa BAJA — pasar al cliente a Históricos en el CRM (i04) ─────────────────────────────────────
// Escribir en el CRM es delicado: mismo criterio que lib/bot/alta/crmEscribir.ts (misma interfaz PlanillaCrm, misma cuenta de
// servicio con scope de escritura). Relevado en el CRM real el 25/10/2026:
//   · NO existe una pestaña "Históricos": un histórico es una fila de Agencia en FINALIZADO (o INACTIVO). La cartera los
//     muestra en la etapa Baja (lib/clientes/recorrido.ts) y el tablero de anuncios los saca solo (lib/anuncios/cruce.ts:
//     FINALIZADO / INACTIVO → "ex-cliente" → excluida, tablero.ts).
//   · "Estado" tiene validación (Config!A2:A5: ACTIVO, FINALIZADO, INACTIVO, PAUSADO). "Fecha de baja" tiene formato
//     dd/mm/yyyy: se escribe el serial (como las fechas del alta). "Notas renovación" es lo que el Despacho muestra como
//     "Notas de renovación" en la ficha del cliente: la nota de la baja va ahí (no se pisa lo que había: se agrega al final).
// Pasos:
//   1. UNA lectura directa (sin snapshot, con fórmulas) de los encabezados y las filas de Agencia. Las columnas se resuelven
//      por encabezado (lib/clientes/parsear.ts: columnasDeClientes); si falta una, no se escribe nada.
//   2. Exige: UNA sola fila con ese ID, el nombre que calza, Estado ACTIVO o PAUSADO (FINALIZADO / INACTIVO = ya estaba: no
//      se toca), y que Estado, Fecha de baja y Notas renovación NO sean fórmulas. Con `soloPrueba` exige además que el nombre
//      empiece con "PRUEBA BOT" (las pruebas reales se hacen solo sobre filas de prueba).
//   3. 'simulacion': devuelve exactamente lo que escribiría, sin escribir. 'real': values.batchUpdate (USER_ENTERED, como el
//      equipo; la nota va con apóstrofo adelante para que quede literal) y RELEE para verificar.
// Sheets no tiene compare-and-set: entre la lectura y la escritura queda una ventana mínima (igual que el alta).
import { columnasDeClientes } from '@/lib/clientes/parsear'
import { serialAYmd, ymdASerial, type Ymd } from '@/lib/clientes/fechas'
import { letraColumna } from '@/lib/clientes/texto'
import type { Celda, Fila } from '@/lib/clientes/tipos'
import type { PlanillaCrm, RangoValores } from '@/lib/bot/alta/crmEscribir'
import { normNombre } from './fin'
import { fechaCorta } from './textos'

export const PESTANA_AGENCIA = 'Agencia'
export const PREFIJO_PRUEBA = 'PRUEBA BOT'
const MAX_FILAS = 2000

export interface PedidoBajaCrm { id: string; nombre: string; fecha: Ymd; nota: string; /** Ronda 2: FINALIZADO (por defecto) o INACTIVO. */ estado?: 'FINALIZADO' | 'INACTIVO' }
export interface ResultadoBajaCrm {
  estado: 'hecho' | 'simulado' | 'ya_estaba' | 'error'
  fila: number | null
  detalle: string
  escrituras: RangoValores[]
  /** Lo que había antes en esas celdas (Estado, Fecha de baja y Notas renovación), para poder volver atrás una prueba. */
  anterior?: { estado: string; fechaBaja: Celda | null; notas: string; celdas: { estado: string; fechaBaja: string; notas: string } }
}

const esFormula = (c: Celda | undefined): boolean => typeof c === 'string' && c.startsWith('=')
const vacia = (c: Celda | undefined): boolean => c === undefined || c === null || (typeof c === 'string' && c.trim() === '')
const texto = (c: Celda | undefined): string => (c === undefined || c === null ? '' : String(c)).trim()
const palabras = (s: string) => new Set(normNombre(s).split(' ').filter((w) => w.length >= 3))

/** ¿El nombre de la fila es el del cliente? Igual, o todas las palabras de uno dentro del otro (2 o más). */
export function nombreCalza(enFila: string, esperado: string): boolean {
  if (normNombre(enFila) === normNombre(esperado)) return true
  const a = palabras(enFila), b = palabras(esperado)
  const dentro = (x: Set<string>, y: Set<string>) => x.size >= 2 && [...x].every((w) => y.has(w))
  return dentro(a, b) || dentro(b, a)
}

export async function marcarBajaCrm(planilla: PlanillaCrm, p: PedidoBajaCrm, op: { modo: 'real' | 'simulacion'; soloPrueba?: boolean }): Promise<ResultadoBajaCrm> {
  const error = (detalle: string, fila: number | null = null): ResultadoBajaCrm => ({ estado: 'error', fila, detalle, escrituras: [] })
  if (!/^[A-Za-z]\d{1,5}$/.test(p.id)) return error(`ID del CRM inválido (${p.id.slice(0, 12)})`)
  const [cabeza, filas] = await planilla.leer([`'${PESTANA_AGENCIA}'!1:1`, `'${PESTANA_AGENCIA}'!A2:AF${MAX_FILAS}`], 'FORMULA')
  const { idx, resumen } = columnasDeClientes(PESTANA_AGENCIA, cabeza[0] as Fila | undefined)
  const necesarias = ['id', 'nombre', 'estado', 'fechaBaja', 'notasRenov'] as const
  const faltan = necesarias.filter((k) => idx[k] === undefined || idx[k] < 0)
  if (faltan.length) return error(`no encuentro en Agencia las columnas ${faltan.join(', ')} (encabezados cambiados): no escribo nada`)
  const hits = filas.map((f, i) => ({ f, fila: i + 2 })).filter((x) => texto(x.f[idx.id]).toUpperCase() === p.id.toUpperCase())
  if (hits.length !== 1) return error(hits.length ? `el ID ${p.id} está en ${hits.length} filas de Agencia: no escribo nada` : `el ID ${p.id} no está en Agencia`)
  const { f, fila } = hits[0]
  const nombre = texto(f[idx.nombre])
  if (op.soloPrueba && !nombre.toUpperCase().startsWith(PREFIJO_PRUEBA)) return error(`modo prueba: la fila ${fila} no es una fila "${PREFIJO_PRUEBA}…"`, fila)
  if (!nombreCalza(nombre, p.nombre)) return error(`la fila ${fila} tiene otro nombre ("${nombre.slice(0, 40)}"): no escribo nada`, fila)
  for (const k of ['estado', 'fechaBaja', 'notasRenov'] as const) if (esFormula(f[idx[k]])) return error(`la columna ${resumen.resueltas[k] ?? k} de la fila ${fila} es una fórmula: no la piso`, fila)
  const estado = texto(f[idx.estado]).toUpperCase()
  if (estado === 'FINALIZADO' || estado === 'INACTIVO') return { estado: 'ya_estaba', fila, detalle: `ya figuraba ${estado} en la fila ${fila}: no se tocó`, escrituras: [] }
  if (estado !== 'ACTIVO' && estado !== 'PAUSADO') return error(`la fila ${fila} tiene un estado raro ("${estado.slice(0, 20)}"): no escribo nada`, fila)

  const destino = p.estado ?? 'FINALIZADO'
  const notaNueva = `[${fechaCorta(p.fecha)}] ${p.nota.replace(/\s+/g, ' ').trim()}`
  const previa = texto(f[idx.notasRenov])
  const notas = previa ? `${previa} | ${notaNueva}` : notaNueva
  const celda = (k: keyof typeof idx) => `'${PESTANA_AGENCIA}'!${letraColumna(idx[k])}${fila}`
  const escrituras: RangoValores[] = [
    { range: celda('estado'), values: [[destino]] },
    ...(vacia(f[idx.fechaBaja]) ? [{ range: celda('fechaBaja'), values: [[ymdASerial(p.fecha)]] }] : []),
    { range: celda('notasRenov'), values: [[`'${notas}`]] },
  ]
  const anterior = { estado, fechaBaja: vacia(f[idx.fechaBaja]) ? null : (f[idx.fechaBaja] ?? null), notas: previa, celdas: { estado: celda('estado'), fechaBaja: celda('fechaBaja'), notas: celda('notasRenov') } }
  if (op.modo === 'simulacion') return { estado: 'simulado', anterior, fila, detalle: `pasaría la fila ${fila} (${nombre}) a ${destino}${vacia(f[idx.fechaBaja]) ? ` con fecha de baja ${fechaCorta(p.fecha)}` : ''} y sumaría la nota`, escrituras }

  await planilla.escribirValores(escrituras)
  // Relee y verifica (los valores calculados)
  const [vuelta] = await planilla.leer([`'${PESTANA_AGENCIA}'!A${fila}:AF${fila}`], 'UNFORMATTED_VALUE')
  const v = (vuelta[0] ?? []) as Fila
  const problemas: string[] = []
  if (texto(v[idx.id]).toUpperCase() !== p.id.toUpperCase()) problemas.push('el ID cambió de fila')
  if (texto(v[idx.estado]).toUpperCase() !== destino) problemas.push(`Estado no quedó ${destino}`)
  const fb = v[idx.fechaBaja]
  if (typeof fb !== 'number' || !serialAYmd(fb)) problemas.push('Fecha de baja no quedó como fecha')
  if (!texto(v[idx.notasRenov]).includes(notaNueva)) problemas.push('la nota no quedó')
  if (problemas.length) return { estado: 'error', anterior, fila, detalle: `escribí la fila ${fila} pero al releer: ${problemas.join(', ')}. Revisar a mano.`, escrituras }
  return { estado: 'hecho', anterior, fila, detalle: `fila ${fila} (${nombre}) en ${destino}, con fecha de baja y nota`, escrituras }
}
