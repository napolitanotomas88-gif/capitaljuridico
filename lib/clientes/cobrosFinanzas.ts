// Lectura autoritativa del cobro: Registro de Pagos 2026 + Pagos 2025 del CRM.
// Reemplaza el valor derivado; jamás suma un delta a M ni escribe las fuentes/formulas.
import { googleJson, sheetsBase } from '../auth/googleRest'
import type { Cliente, DatosClientes, Fila } from './tipos'
import { normTxt } from './texto'
import { columnasDeClientes } from './parsear'

export const TTL_COBROS_MS = 45_000
export const normalizarNombreCobro = (v: unknown): string => String(v ?? '').toLowerCase()
  .replace(/[áéíóú]/g, c => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' })[c]!)
  .replace(/^ +| +$/g, '').replace(/ +/g, ' ')
/** Igual a RIGHT(REGEXREPLACE(TO_TEXT(celda),"\D",""),7) de la fórmula M. */
export const telefonoCobro = (v: unknown): string => {
  const digitos = String(v ?? '').replace(/\D/g, '')
  return digitos.length >= 7 ? digitos.slice(-7) : ''
}

export interface IdentidadCobro { id: string; nombre: string; celular: string }
export interface FuentesCobros { finanzas: Fila[]; pagos2025: Fila[]; identidades?: IdentidadCobro[] }
export type LecturaCobros = { ok: true; fuentes: FuentesCobros; leidoEn: number } | { ok: false; aviso: string; leidoEn: null }
interface Pago { nombre: string; telefono: string; monto: number | null }
const AVISO_FALLO = 'No se pudieron verificar los cobros actuales en Finanzas y Pagos 2025. El cobrado y el saldo quedan sin informar hasta recuperar la lectura.'
const AVISO_AMBIGUO = 'El cobro requiere revisión: hay más de un cliente compatible por ID, nombre o teléfono. No se asignó ningún monto por suposición.'
const AVISO_MONTO = 'El cobro requiere revisión: una fila compatible contiene un monto no numérico. No se muestra un total incompleto.'

function pagosDe(f: FuentesCobros): Pago[] {
  if (f.finanzas.length >= 5000 || f.pagos2025.length >= 5000) throw new Error('La lectura de cobros alcanzó el límite de filas')
  const actual = f.finanzas[0] ?? []
  if (normTxt(actual[2]) !== 'nombre del cliente' || normTxt(actual[3]) !== 'telefono' || normTxt(actual[4]) !== 'efectivo recaudado') throw new Error('Encabezados de Finanzas no verificados')
  const historico = f.pagos2025[0] ?? []
  // Una hoja existente sin filas está vacía; una hoja ausente falla en el lector y nunca equivale a cero.
  if (f.pagos2025.length && (normTxt(historico[0]) !== 'cliente' || normTxt(historico[1]) !== 'telefono' || normTxt(historico[2]) !== 'monto')) throw new Error('Encabezados de Pagos 2025 no verificados')
  const pago = (nombre: unknown, telefono: unknown, monto: unknown): Pago => ({
    nombre: normalizarNombreCobro(nombre), telefono: telefonoCobro(telefono),
    monto: monto === '' || monto === null || monto === undefined ? 0 : typeof monto === 'number' && Number.isFinite(monto) ? monto : null,
  })
  return [
    ...f.finanzas.slice(1).map(r => pago(r[2], r[3], r[4])),
    ...f.pagos2025.slice(1).map(r => pago(r[0], r[1], r[2])),
  ].filter(p => p.nombre || p.telefono)
}

/** Puro: una fila candidata se suma una vez aunque coincidan el teléfono Y el nombre. */
export function cruzarCobrosFinanzas(clientes: readonly Cliente[], fuentes: FuentesCobros): Cliente[] {
  const pagos = pagosDe(fuentes)
  // La identidad se verifica en el mismo batch que Pagos2025: el snapshot puede conservar un nombre/teléfono editado.
  const identidades = fuentes.identidades ?? clientes
  const porNombre = new Map<string, number[]>(), porTelefono = new Map<string, number[]>(), porId = new Map<string, number[]>()
  const agregar = (mapa: Map<string, number[]>, clave: string, indice: number) => { if (clave) mapa.set(clave, [...(mapa.get(clave) ?? []), indice]) }
  const avisos = new Map<number, string>(), totales = identidades.map(() => 0)
  identidades.forEach((c, i) => {
    const id = c.id.trim().toUpperCase()
    if (!/^[A-Z]\d{1,6}$/.test(id)) avisos.set(i, 'El cobro requiere un ID de cliente válido para resolver su identidad.')
    agregar(porId, id, i)
    agregar(porNombre, normalizarNombreCobro(c.nombre), i)
    agregar(porTelefono, telefonoCobro(c.celular), i)
    if (!normalizarNombreCobro(c.nombre) && !telefonoCobro(c.celular)) avisos.set(i, 'No hay nombre ni teléfono suficientes para verificar los cobros.')
  })
  for (const mapa of [porId, porNombre, porTelefono]) for (const indices of mapa.values()) if (indices.length > 1) for (const i of indices) avisos.set(i, AVISO_AMBIGUO)
  for (const p of pagos) {
    const candidatos = [...new Set([...(porNombre.get(p.nombre) ?? []), ...(porTelefono.get(p.telefono) ?? [])])]
    if (candidatos.length > 1) {
      for (const i of candidatos) avisos.set(i, AVISO_AMBIGUO)
    } else if (candidatos.length === 1) {
      const i = candidatos[0]
      if (p.monto === null) avisos.set(i, AVISO_MONTO)
      else totales[i] += p.monto
    }
  }
  const idsMostrados = new Map<string, number>()
  for (const c of clientes) { const id = c.id.trim().toUpperCase(); idsMostrados.set(id, (idsMostrados.get(id) ?? 0) + 1) }
  return clientes.map(c => {
    const id = c.id.trim().toUpperCase(), indices = porId.get(id) ?? []
    let aviso = indices.length !== 1 || idsMostrados.get(id) !== 1 ? AVISO_AMBIGUO : avisos.get(indices[0]) ?? null
    if (!indices.length) aviso = 'No se pudo verificar un ID único de este cliente en el CRM actual. El cobro queda pendiente de revisión.'
    const total = aviso ? null : Math.round((totales[indices[0]] + Number.EPSILON) * 100) / 100
    return { ...c, ltvCobrado: total, cobrosAviso: aviso }
  })
}

export function identidadesDeHojasCobros(agencia: Fila[], consultora: Fila[]): IdentidadCobro[] {
  const salida: IdentidadCobro[] = []
  for (const [hoja, filas] of [['Agencia', agencia], ['Consultora', consultora]] as const) {
    const { idx, resumen } = columnasDeClientes(hoja, filas[0])
    if (filas.length >= 2000 || (['id', 'nombre', 'celular'] as const).some(k => idx[k] < 0 || resumen.duplicadas.includes(k))) throw new Error('Identidades del CRM no verificadas')
    for (const f of filas.slice(1)) {
      const id = String(f[idx.id] ?? '').trim().toUpperCase(), nombre = String(f[idx.nombre] ?? ''), celular = String(f[idx.celular] ?? '')
      if (id || nombre || celular) salida.push({ id, nombre, celular })
    }
  }
  return salida
}

/** Cache de lectura por proceso, con invalidación que no deja volver a poblar datos de un pedido anterior al pago. */
export function crearLectorCobrosFinanzas(lector: () => Promise<FuentesCobros>, op: { ahora?: () => number; clave?: () => string } = {}) {
  const ahora = op.ahora ?? Date.now, claveActual = op.clave ?? (() => '')
  let version = 0
  let cache: { clave: string; vence: number; valor: LecturaCobros } | null = null
  let enVuelo: { clave: string; version: number; promesa: Promise<LecturaCobros> } | null = null
  const leer = (): Promise<LecturaCobros> => {
    const clave = claveActual()
    if (cache?.clave === clave && ahora() < cache.vence) return Promise.resolve(cache.valor)
    if (enVuelo?.clave === clave && enVuelo.version === version) return enVuelo.promesa
    const actual = version
    const promesa = (async (): Promise<LecturaCobros> => {
      let valor: LecturaCobros
      try {
        const fuentes = await lector()
        pagosDe(fuentes) // valida estructura antes de cachear una lectura como actual
        valor = { ok: true, fuentes, leidoEn: ahora() }
      } catch { valor = { ok: false, aviso: AVISO_FALLO, leidoEn: null } }
      if (actual !== version || clave !== claveActual()) return leer()
      cache = { clave, vence: ahora() + TTL_COBROS_MS, valor }
      return valor
    })().finally(() => { if (enVuelo?.promesa === promesa) enVuelo = null })
    enVuelo = { clave, version: actual, promesa }
    return promesa
  }
  return { leer, invalidar: () => { version++; cache = null; enVuelo = null } }
}

async function leerFuentesReales(): Promise<FuentesCobros> {
  const crm = process.env.SHEET_ID_CLIENTES?.trim(), finanzas = process.env.SHEET_ID_FINANZAS?.trim()
  if (!crm || !finanzas) throw new Error('Faltan planillas de cobros')
  const base = `${sheetsBase()}/v4/spreadsheets`
  const rangos = ["'Pagos 2025'!A1:F5000", "'Agencia'!A1:AF2000", "'Consultora'!A1:AF2000"].map(r => `ranges=${encodeURIComponent(r)}`).join('&')
  const [actual, crmActual] = await Promise.all([
    googleJson<{ values?: Fila[] }>(`${base}/${encodeURIComponent(finanzas)}/values/${encodeURIComponent("'Registro de Pagos'!A1:R5000")}?valueRenderOption=UNFORMATTED_VALUE`),
    googleJson<{ valueRanges?: { values?: Fila[] }[] }>(`${base}/${encodeURIComponent(crm)}/values:batchGet?${rangos}&valueRenderOption=UNFORMATTED_VALUE`),
  ])
  const hojas = crmActual.valueRanges ?? []
  if (hojas.length !== 3) throw new Error('La lectura de cobros del CRM está incompleta')
  return { finanzas: actual.values ?? [], pagos2025: hojas[0].values ?? [], identidades: identidadesDeHojasCobros(hojas[1].values ?? [], hojas[2].values ?? []) }
}
const lectorReal = crearLectorCobrosFinanzas(leerFuentesReales, { clave: () => `${process.env.SHEET_ID_CLIENTES}|${process.env.SHEET_ID_FINANZAS}|${sheetsBase()}` })
export const invalidarCobrosFinanzas = lectorReal.invalidar

/** Overlay exclusivo de cobrado y su aviso: el resto de los datos del CRM conserva su fuente y reglas actuales. */
export async function aplicarCobrosFinanzas(datos: DatosClientes, op: { leer?: () => Promise<LecturaCobros>; forzar?: boolean } = {}): Promise<DatosClientes> {
  if (op.forzar && !op.leer) lectorReal.invalidar()
  const lectura = await (op.leer ?? lectorReal.leer)()
  const clientes = lectura.ok ? cruzarCobrosFinanzas(datos.clientes, lectura.fuentes) : datos.clientes.map(c => ({ ...c, ltvCobrado: null, cobrosAviso: lectura.aviso }))
  const pendientes = clientes.filter(c => c.cobrosAviso).length
  const aviso = lectura.ok ? pendientes ? `Cobros: hay ${pendientes} clientes con cruce o monto a revisar. Se informa la advertencia en cada ficha.` : null : lectura.aviso
  return { ...datos, clientes, avisos: aviso ? [...datos.avisos, aviso] : datos.avisos }
}
