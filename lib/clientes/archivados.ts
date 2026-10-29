// Barrera compartida de colas operativas. Lee Agencia y Consultora actuales; nunca toma el snapshot de respaldo.
// Archivar conserva CRM, Finanzas, documentos e historial: sólo excluye trabajo y envíos nuevos.
import { googleJson, sheetsBase } from '../auth/googleRest'
import { columnasDeClientes, parsearEstadoCliente } from './parsear'
import { estaArchivado } from './acciones/planesNuevos'
import type { Fila } from './tipos'
import { normTxt } from './texto'
import { AsyncLocalStorage } from 'node:async_hooks'

export class ClienteArchivadoError extends Error {
  readonly status = 409
  readonly code = 'CLIENTE_ARCHIVADO'
  constructor() { super('El cliente está archivado. Restauralo antes de generar trabajo o hacer envíos.'); this.name = 'ClienteArchivadoError' }
}
export class EstadoCrmInciertoError extends Error {
  readonly status = 503
  readonly code = 'ESTADO_CRM_INCIERTO'
  constructor() { super('No se pudo verificar el estado actual del cliente en el CRM. No se inició ningún envío.'); this.name = 'EstadoCrmInciertoError' }
}
const idNormal = (id: unknown) => typeof id === 'string' && /^[A-Za-z]\d{1,6}$/.test(id.trim()) ? id.trim().toUpperCase() : null
const nombresPorSet = new WeakMap<ReadonlySet<string>, Map<string, string[]>>()
const idsPorSet = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>()

interface HojasArchivo { agencia: Fila[]; consultora: Fila[] }
type EntradaArchivo = Fila[] | HojasArchivo
function indiceArchivados(grupos: { hoja: 'Agencia' | 'Consultora'; filas: readonly Fila[] }[]): Set<string> {
  const salida = new Set<string>(), vistos = new Set<string>(), nombres = new Map<string, string[]>()
  for (const { hoja, filas } of grupos) {
    const { idx, resumen } = columnasDeClientes(hoja, filas[0])
    const esenciales = ['id', 'nombre', 'estado', 'anotaciones'] as const
    if (esenciales.some(k => idx[k] < 0 || resumen.duplicadas.includes(k)) || filas.length >= 2000) throw new EstadoCrmInciertoError()
    for (const fila of filas.slice(1)) {
      const id = idNormal(fila[idx.id])
      if (!id) continue
      if (vistos.has(id)) throw new EstadoCrmInciertoError()
      vistos.add(id)
      const nombre = normTxt(fila[idx.nombre]).replace(/\s+/g, ' ').trim()
      if (nombre) nombres.set(nombre, [...(nombres.get(nombre) ?? []), id])
      if (estaArchivado({ estado: parsearEstadoCliente(fila[idx.estado]), anotaciones: String(fila[idx.anotaciones] ?? '') })) salida.add(id)
    }
  }
  nombresPorSet.set(salida, nombres)
  idsPorSet.set(salida, vistos)
  return salida
}
export const archivadosDeAgencia = (filas: readonly Fila[]): Set<string> => indiceArchivados([{ hoja: 'Agencia', filas }])
export const archivadosDeHojas = (hojas: HojasArchivo): Set<string> => indiceArchivados([{ hoja: 'Agencia', filas: hojas.agencia }, { hoja: 'Consultora', filas: hojas.consultora }])

async function leerHojas(): Promise<HojasArchivo> {
  const sheet = process.env.SHEET_ID_CLIENTES?.trim()
  if (!sheet) throw new EstadoCrmInciertoError()
  const rangos = ["'Agencia'!A1:AF2000", "'Consultora'!A1:AF2000"].map(r => `ranges=${encodeURIComponent(r)}`).join('&')
  const r = await googleJson<{ valueRanges?: { values?: Fila[] }[] }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(sheet)}/values:batchGet?${rangos}&valueRenderOption=UNFORMATTED_VALUE`)
  return { agencia: r.valueRanges?.[0]?.values ?? [], consultora: r.valueRanges?.[1]?.values ?? [] }
}
let enVuelo: Promise<Set<string>> | null = null
const contexto = new AsyncLocalStorage<Set<string>>()
/** Fresco en cada operación. Sólo comparte lecturas que están ocurriendo al mismo tiempo; jamás cachea un resultado viejo. */
export async function leerArchivados(op: { leer?: () => Promise<EntradaArchivo>; forzar?: boolean } = {}): Promise<Set<string>> {
  const actual = contexto.getStore()
  if (actual && !op.leer && !op.forzar) return actual
  const leer = async () => { try { const hojas = await (op.leer ?? leerHojas)(); return Array.isArray(hojas) ? archivadosDeAgencia(hojas) : archivadosDeHojas(hojas) } catch { throw new EstadoCrmInciertoError() } }
  if (op.leer) return leer()
  if (!enVuelo) enVuelo = leer().finally(() => { enVuelo = null })
  return enVuelo
}
/** Un lote comparte UNA lectura inicial; los efectos externos pueden forzar una nueva sin usar TTL ni disco. */
export async function conArchivadosActuales<T>(trabajo: () => Promise<T>, op: { leer?: () => Promise<EntradaArchivo> } = {}): Promise<T> {
  const actual = await leerArchivados({ ...op, forzar: true })
  return contexto.run(actual, trabajo)
}
export function excluirArchivados<T>(filas: readonly T[], archivados: ReadonlySet<string>, idDeFila: (fila: T) => unknown): T[] {
  return filas.filter(f => { const id = idNormal(idDeFila(f)); return !id || !archivados.has(id) })
}
export async function exigirClienteNoArchivado(idCrm: unknown, archivados?: ReadonlySet<string>): Promise<void> {
  const id = idNormal(idCrm)
  if (!id) throw new EstadoCrmInciertoError()
  const set = archivados ?? await leerArchivados()
  if (idsPorSet.has(set) && !idsPorSet.get(set)!.has(id)) throw new EstadoCrmInciertoError()
  if (set.has(id)) throw new ClienteArchivadoError()
}
/** Para integraciones históricas que sólo tienen nombre: coincidencia exacta normalizada y única en CRM actual. */
export async function exigirClienteNoArchivadoPorNombre(nombre: unknown, archivados?: ReadonlySet<string>): Promise<void> {
  const set = archivados ?? await leerArchivados()
  const clave = typeof nombre === 'string' ? normTxt(nombre).replace(/\s+/g, ' ').trim() : ''
  const ids = nombresPorSet.get(set)?.get(clave)
  if (!ids || ids.length !== 1) throw new EstadoCrmInciertoError()
  await exigirClienteNoArchivado(ids[0], set)
}
