// Migración acotada: sólo encabezados nuevos al final de Agencia/Consultora. Nunca datos de clientes.
import { googleJson, sheetsBase } from '@/lib/auth/googleRest'
import { columnasDeClientes } from '../parsear'
import type { Fila } from '../tipos'

export const COLUMNAS_DATOS_CLIENTE = { estudio: 'Estudio', csm: 'CSM', ciudad: 'Ciudad' } as const
export interface HojaDatosCliente { nombre: 'Agencia' | 'Consultora'; id: number; filas: number; columnas: number; encabezado: Fila }
export interface PlanColumnasDatos { hojas: HojaDatosCliente[]; requests: object[]; agregadas: { hoja: string; campo: string; columna: number; titulo: string }[] }

export function planColumnasDatos(hojas: HojaDatosCliente[]): PlanColumnasDatos {
  if (hojas.length !== 2 || new Set(hojas.map(h => h.nombre)).size !== 2 || !hojas.some(h => h.nombre === 'Agencia') || !hojas.some(h => h.nombre === 'Consultora')) throw new Error('Se requieren Agencia y Consultora actuales')
  if (new Set(hojas.map(h => h.id)).size !== 2) throw new Error('Las hojas deben tener IDs distintos')
  const requests: object[] = [], agregadas: PlanColumnasDatos['agregadas'] = []
  for (const hoja of hojas) {
    if (!Number.isSafeInteger(hoja.id) || hoja.id < 0 || !Number.isSafeInteger(hoja.columnas) || hoja.columnas < 1) throw new Error('Metadatos de hoja inválidos')
    const { idx, resumen } = columnasDeClientes(hoja.nombre, hoja.encabezado)
    if (['id', 'nombre', 'estado'].some(k => idx[k as 'id' | 'nombre' | 'estado'] < 0)) throw new Error(`Faltan encabezados base en ${hoja.nombre}`)
    if (resumen.duplicadas.some(k => k in COLUMNAS_DATOS_CLIENTE)) throw new Error(`Encabezados de datos duplicados en ${hoja.nombre}`)
    if (hoja.encabezado.some(v => typeof v === 'string' && v.startsWith('='))) throw new Error(`Encabezado con fórmula en ${hoja.nombre}`)
    let siguiente = hoja.encabezado.reduce<number>((fin, v, i) => String(v ?? '').trim() ? i + 1 : fin, 0)
    const faltantes = Object.entries(COLUMNAS_DATOS_CLIENTE).filter(([campo]) => idx[campo as keyof typeof COLUMNAS_DATOS_CLIENTE] < 0)
    const fin = siguiente + faltantes.length
    // Los lectores actuales alcanzan AF: no crear una columna invisible al Despacho.
    if (fin > 32) throw new Error(`Los nuevos campos excederían AF en ${hoja.nombre}; ampliar lectores antes de migrar`)
    if (fin > hoja.columnas) requests.push({ appendDimension: { sheetId: hoja.id, dimension: 'COLUMNS', length: fin - hoja.columnas } })
    for (const [campo, titulo] of faltantes) {
      const columna = siguiente++
      requests.push({ updateCells: { range: { sheetId: hoja.id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: columna, endColumnIndex: columna + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: titulo } }] }], fields: 'userEnteredValue' } })
      agregadas.push({ hoja: hoja.nombre, campo, columna, titulo })
    }
  }
  return { hojas, requests, agregadas }
}

export interface PlanillaColumnasDatos { leer(): Promise<HojaDatosCliente[]>; batch(requests: object[]): Promise<void> }
export function planillaColumnasDatosReal(): PlanillaColumnasDatos {
  const id = process.env.SHEET_ID_CLIENTES?.trim()
  if (!id) throw new Error('Falta SHEET_ID_CLIENTES')
  const base = `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(id)}`
  return {
    async leer() {
      const [meta, celdas] = await Promise.all([
        googleJson<{ sheets?: { properties: { title: string; sheetId: number; gridProperties: { rowCount: number; columnCount: number } } }[] }>(`${base}?fields=sheets.properties(title,sheetId,gridProperties)`),
        googleJson<{ valueRanges?: { values?: Fila[] }[] }>(`${base}/values:batchGet?ranges=${encodeURIComponent("'Agencia'!1:1")}&ranges=${encodeURIComponent("'Consultora'!1:1")}&valueRenderOption=FORMULA`),
      ])
      return (['Agencia', 'Consultora'] as const).map((nombre, i) => {
        const coincidencias = meta.sheets?.filter(h => h.properties.title === nombre) ?? []
        if (coincidencias.length !== 1) throw new Error(`No se encuentra una hoja única ${nombre}`)
        const p = coincidencias[0].properties
        return { nombre, id: p.sheetId, filas: p.gridProperties.rowCount, columnas: p.gridProperties.columnCount, encabezado: celdas.valueRanges?.[i]?.values?.[0] ?? [] }
      })
    },
    async batch(requests) { await googleJson(`${base}:batchUpdate`, { cuerpo: { requests } }) },
  }
}

/** Ejecutar sólo en la ventana coordinada de migración. Los demás escritores de headers deben estar detenidos. */
export async function asegurarColumnasDatos(planilla: PlanillaColumnasDatos, ejecutar = false, esperado?: PlanColumnasDatos): Promise<{ plan: PlanColumnasDatos; verificado: boolean; escribio: boolean }> {
  const plan = planColumnasDatos(await planilla.leer())
  if (esperado && JSON.stringify(plan) !== JSON.stringify(esperado)) throw new Error('El esquema cambió respecto al plan revisado; volver a revisar')
  if (!ejecutar || !plan.requests.length) return { plan, verificado: !plan.requests.length, escribio: false }
  if (JSON.stringify(await planilla.leer()) !== JSON.stringify(plan.hojas)) throw new Error('El esquema cambió antes de la migración; volver a revisar')
  await planilla.batch(plan.requests)
  const despues = planColumnasDatos(await planilla.leer())
  if (despues.requests.length) throw new Error('No se confirmó la migración de columnas; releer antes de reintentar')
  for (const original of plan.hojas) {
    const actual = despues.hojas.find(h => h.nombre === original.nombre)!
    const finAnterior = original.encabezado.reduce<number>((fin, v, i) => String(v ?? '').trim() ? i + 1 : fin, 0)
    if (original.encabezado.slice(0, finAnterior).some((v, i) => String(v ?? '') !== String(actual.encabezado[i] ?? ''))) throw new Error('Cambió un encabezado previo; revisar el esquema')
  }
  return { plan, verificado: true, escribio: true }
}
