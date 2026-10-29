// ── Alta de cliente nuevo: constructor DRY-RUN (no escribe nada, no importa googleapis) ─────
// Devuelve el PLAN completo de lo que habría que cargar en la planilla "2026 - CRM - CLIENTES":
//   1. la fila de Agencia (ID correlativo, estado, contacto, closer, contrato, Día 1…);
//   2. la fila del período 0 en Renovaciones (Día 1, Finalización = Día 1 + 120 días de contrato, precio inicial);
//   3. las fórmulas de la fila 2 de Agencia que hay que copiar a la fila nueva (hoy J:N: fin de período,
//      Renovó, LTV contratado, LTV cobrado y duración).
// El payload que arma tiene la forma de values.batchUpdate + spreadsheets.batchUpdate/copyPaste, pero este
// módulo NO lo envía: quien lo use tendría que decidirlo aparte (por ahora no hay ningún camino de escritura).
//
// ── LA TRAMPA CONOCIDA: clientes cargados sin ID y sin fórmulas ──────────────────────────────
// Todas las fórmulas de Agencia (J:N) arrancan con =IF($A2="","",…): sin ID no calculan nada. Y las filas
// que el equipo agrega a mano al final suelen quedar SIN las fórmulas copiadas. Resultado: sin fin de
// período, sin LTV ni duración, el semáforo en gris y el cliente fuera de las métricas (las métricas del
// CRM solo toman filas con ID). Además "LTV cobrado" se calcula por los últimos 7 dígitos del celular o por
// el nombre normalizado (minúsculas, sin acentos): sin celular ni nombre bien cargados queda en 0.
// Y sin la fila del período 0 en Renovaciones, "LTV contratado" da 0 y el cliente no tiene fin de período
// real (la columna cae al valor por defecto Día 1 + 120 días).
// Al 6/10/2026 pasa con A131 a A140: tienen ID y Día 1 pero les faltan las fórmulas L:N y el período 0.
// planReparacionFormulas() arma el plan (también dry-run) para completarlos.
import type { Celda, Cliente, Fila, HojasCrudas, Ymd } from './tipos'
import { esYmdValido, ymdASerial } from './fechas'
import { columnasDeClientes, columnasDeRenovaciones } from './parsear'
import { MESES_POR_DEFECTO, TABLA_PRECIOS, finDelPeriodo } from './precios'
import type { TablaPrecios } from './precios'
import { clavesTelefono, letraColumna, normTxt } from './texto'

const PESTANA_AGENCIA = 'Agencia'
const PESTANA_RENOVACIONES = 'Renovaciones'
const FILA_FORMULAS_ORIGEN = 2   // la fila 2 de Agencia tiene todas las fórmulas bien armadas

export const NOTA_PERIODO_INICIAL = 'período inicial cargado por el dashboard'   // el texto que ya usa el equipo

export interface EntradaAlta {
  nombre: string
  celular: string               // obligatorio: el LTV cobrado se calcula con sus últimos 7 dígitos
  dia1: Ymd                     // inicio del programa
  mail?: string
  closer?: string
  fuente?: string
  contrato?: string             // lista de Config: Firmado / Enviado / Hacer / Pendiente / No hay
  anotaciones?: string
  producto?: string             // clave de TABLA_PRECIOS (por defecto, la de porDefecto)
  precioUSD?: number            // pisa el precio de la tabla
  meses?: number                // pisa los meses del producto (vacío en la planilla = 4)
}

export interface ContextoAlta {
  hojas: Pick<HojasCrudas, 'agencia' | 'consultora' | 'renovaciones'>   // crudas, con la fila 1
  clientes: Pick<Cliente, 'id' | 'linea' | 'nombre' | 'celular' | 'mail' | 'estado'>[]
  formulasAgencia?: Record<string, string> | null   // del sondeo (letra + encabezado → fórmula); si falta se deduce
  precios?: TablaPrecios
}

export interface EscrituraValores { range: string; values: Celda[][] }

export interface CopiaDeFormulas {
  descripcion: string
  origen: string                // "'Agencia'!J2:N2"
  destino: string               // "'Agencia'!J142:N142"
  request: {
    copyPaste: {
      source: GridRango; destination: GridRango
      pasteType: 'PASTE_FORMULA'; pasteOrientation: 'NORMAL'
    }
  }
}
export interface GridRango { sheetId: string; startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }
const SHEET_ID_PENDIENTE = '<gid de la pestaña: leerlo con spreadsheets.get>'

export interface Duplicado { id: string; linea: string; motivo: 'celular' | 'mail' | 'nombre'; estado: string }

export interface PlanAlta {
  dryRun: true                  // este módulo nunca escribe
  ok: boolean
  errores: string[]             // si hay errores no se arma el payload
  advertencias: string[]
  idNuevo: string | null
  filaAgencia: number | null
  filaRenovaciones: number | null
  precio: { clave: string; precioUSD: number | null; meses: number; origen: 'entrada' | 'tabla' | 'sin_precio'; asumido: boolean } | null
  duplicados: Duplicado[]
  payload: { valores: { valueInputOption: 'RAW'; data: EscrituraValores[] }; copiarFormulas: CopiaDeFormulas[] } | null
  pasos: string[]               // el plan en palabras, para mostrar en pantalla
}

// ── Utilidades de rango ──
const rango = (pestana: string, desde: string, hasta?: string) => `'${pestana}'!${desde}${hasta ? `:${hasta}` : ''}`

// Agrupa índices de columna consecutivos: [9,10,11,12,13] → [[9,13]]
function agruparConsecutivos(indices: number[]): [number, number][] {
  const orden = [...new Set(indices)].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const i of orden) {
    const ultimo = out[out.length - 1]
    if (ultimo && i === ultimo[1] + 1) ultimo[1] = i
    else out.push([i, i])
  }
  return out
}

const vacia = (c: Celda | undefined) => c === undefined || c === null || (typeof c === 'string' && c.trim() === '')

// Última fila (1-based) con ID o nombre: ahí termina el CRM aunque haya fórmulas precargadas más abajo
function ultimaFilaConDatos(hoja: Fila[], iId: number, iNombre: number): number {
  let ultima = 1
  hoja.forEach((r, i) => { if (i > 0 && (!vacia(r[iId]) || !vacia(r[iNombre]))) ultima = i + 1 })
  return ultima
}

// Columnas de Agencia con fórmula: las del sondeo si hay; si no, las 5 que se sabe que dependen del ID
function columnasConFormula(formulas: Record<string, string> | null | undefined, idx: Record<string, number>): number[] {
  if (formulas && Object.keys(formulas).length) {
    const letras = Object.keys(formulas).map(k => k.split(' ')[0])
    const todas = Array.from({ length: 40 }, (_, i) => letraColumna(i))
    return letras.map(l => todas.indexOf(l)).filter(i => i >= 0)
  }
  return ['finPeriodo', 'renovo', 'ltvContratado', 'ltvCobrado', 'duracion'].map(k => idx[k]).filter(i => i >= 0)
}

// ── Próximo ID ──
export function proximoId(ids: string[], prefijo: 'A' | 'C' = 'A'): string {
  let max = 0, ancho = 3
  for (const id of ids) {
    const m = new RegExp(`^${prefijo}(\\d+)$`).exec((id ?? '').toString().trim())
    if (m) { max = Math.max(max, +m[1]); ancho = Math.max(ancho, m[1].length) }
  }
  return `${prefijo}${String(max + 1).padStart(ancho, '0')}`
}

// ── El plan ──
export function planAlta(entrada: EntradaAlta, ctx: ContextoAlta): PlanAlta {
  const errores: string[] = [], advertencias: string[] = []
  const nombre = (entrada.nombre ?? '').trim(), celular = (entrada.celular ?? '').trim()
  if (!nombre) errores.push('Falta el nombre.')
  if (!celular) errores.push('Falta el celular: sin él (o sin el nombre bien escrito) el LTV cobrado no se calcula.')
  else if (!clavesTelefono(celular).length) advertencias.push('El celular tiene menos de 7 dígitos: el LTV cobrado se calcula con los últimos 7, así que quedaría en 0.')
  if (!esYmdValido(entrada.dia1)) errores.push('El Día 1 no es una fecha válida (AAAA-MM-DD).')
  const tabla = ctx.precios ?? TABLA_PRECIOS
  const claveProducto = entrada.producto ?? tabla.porDefecto
  const producto = tabla.productos[claveProducto]
  if (!producto) errores.push(`El producto "${claveProducto}" no está en la tabla de precios.`)
  if (entrada.precioUSD !== undefined && !(Number.isFinite(entrada.precioUSD) && entrada.precioUSD >= 0)) errores.push('El precio tiene que ser un número mayor o igual a 0.')
  if (entrada.meses !== undefined && !(Number.isInteger(entrada.meses) && entrada.meses > 0 && entrada.meses <= 24)) errores.push('Los meses tienen que ser un entero entre 1 y 24.')

  // Columnas por encabezado
  const colA = columnasDeClientes(PESTANA_AGENCIA, ctx.hojas.agencia[0])
  const colR = columnasDeRenovaciones(ctx.hojas.renovaciones[0])
  for (const k of ['id', 'nombre', 'estado', 'dia1']) if (colA.idx[k as keyof typeof colA.idx] < 0) errores.push(`No se encontró la columna "${k}" en Agencia.`)
  for (const k of ['id', 'nombre', 'periodo', 'dia1', 'fin', 'precio', 'notas']) if (colR.idx[k as keyof typeof colR.idx] < 0) errores.push(`No se encontró la columna "${k}" en Renovaciones.`)

  // Duplicados: mismo celular (7 dígitos), mismo mail o mismo nombre
  const claves = new Set(clavesTelefono(celular)), mail = (entrada.mail ?? '').trim().toLowerCase(), nom = normTxt(nombre)
  const duplicados: Duplicado[] = []
  for (const c of ctx.clientes) {
    const motivo = clavesTelefono(c.celular).some(k => claves.has(k)) ? 'celular'
      : mail && c.mail.trim().toLowerCase() === mail ? 'mail'
      : nom.length >= 5 && normTxt(c.nombre) === nom ? 'nombre' : null
    if (motivo) duplicados.push({ id: c.id, linea: c.linea, motivo, estado: c.estado })
  }
  const vigente = duplicados.find(d => d.estado === 'ACTIVO' || d.estado === 'PAUSADO')
  if (vigente) errores.push(`Ya hay un cliente vigente con ese ${vigente.motivo} (${vigente.id}): no se da de alta de nuevo.`)
  else if (duplicados.length) advertencias.push(`Coincide con ${duplicados.map(d => `${d.id} (${d.estado || 'sin estado'}, por ${d.motivo})`).join(', ')}: si vuelve como cliente nuevo igual lleva un ID nuevo y la fila vieja queda como está.`)

  const vacio = (): PlanAlta => ({ dryRun: true, ok: false, errores, advertencias, idNuevo: null, filaAgencia: null, filaRenovaciones: null, precio: null, duplicados, payload: null, pasos: [] })
  if (errores.length || !producto) return vacio()

  // ID correlativo: el mayor entre Agencia, Renovaciones y los clientes ya leídos (nunca se reutiliza uno)
  const ids = [
    ...ctx.clientes.map(c => c.id),
    ...ctx.hojas.agencia.slice(1).map(r => String(r[colA.idx.id] ?? '')),
    ...ctx.hojas.renovaciones.slice(1).map(r => String(r[colR.idx.id] ?? '')),
  ]
  const idNuevo = proximoId(ids, 'A')

  // Dónde cae cada fila
  const filaAgencia = ultimaFilaConDatos(ctx.hojas.agencia, colA.idx.id, colA.idx.nombre) + 1
  const filaRenov = ultimaFilaConDatos(ctx.hojas.renovaciones, colR.idx.id, colR.idx.nombre) + 1

  // Precio y duración: el programa estándar termina a los 120 días corridos del Día 1 (la fecha del contrato, igual que la
  // fórmula de Renovaciones E); con otra cantidad de meses se suman meses de calendario y se escribe la columna Meses
  const meses = entrada.meses ?? producto.meses
  const precioUSD = entrada.precioUSD ?? producto.precioUSD
  const origen: 'entrada' | 'tabla' = entrada.precioUSD !== undefined ? 'entrada' : 'tabla'
  const asumido = origen === 'tabla' && producto.asumido
  if (origen === 'tabla') advertencias.push(`Precio inicial USD ${precioUSD} tomado de la tabla de precios (${tabla.verificada ? 'verificada' : 'borrador SIN verificar'}): confirmarlo antes de cargar.`)
  const fin = finDelPeriodo(entrada.dia1, meses)

  // Valores de Agencia por encabezado (las columnas con fórmula NO se escriben)
  const porColumna = new Map<number, Celda>()
  const poner = (k: keyof typeof colA.idx, v: Celda) => { if (colA.idx[k] >= 0) porColumna.set(colA.idx[k], v) }
  poner('id', idNuevo); poner('nombre', nombre); poner('estado', 'ACTIVO'); poner('celular', celular)
  poner('mail', (entrada.mail ?? '').trim()); poner('closer', (entrada.closer ?? '').trim()); poner('fuente', (entrada.fuente ?? '').trim())
  poner('contrato', (entrada.contrato ?? '').trim()); poner('dia1', ymdASerial(entrada.dia1)); poner('anotaciones', (entrada.anotaciones ?? '').trim())
  const formulaIdx = new Set(columnasConFormula(ctx.formulasAgencia, colA.idx))
  for (const i of formulaIdx) porColumna.delete(i)
  const escrituras: EscrituraValores[] = agruparConsecutivos([...porColumna.keys()]).map(([a, b]) => ({
    range: rango(PESTANA_AGENCIA, `${letraColumna(a)}${filaAgencia}`, `${letraColumna(b)}${filaAgencia}`),
    values: [Array.from({ length: b - a + 1 }, (_, j) => porColumna.get(a + j) ?? '')],   // columnas consecutivas: no hay huecos que pisar
  }))

  // Período 0 en Renovaciones
  const ancho = Math.max(...Object.values(colR.idx)) + 1
  const filaR: Celda[] = Array.from({ length: ancho }, () => '')
  filaR[colR.idx.id] = idNuevo; filaR[colR.idx.nombre] = nombre; filaR[colR.idx.periodo] = 0
  filaR[colR.idx.dia1] = ymdASerial(entrada.dia1); filaR[colR.idx.fin] = ymdASerial(fin); filaR[colR.idx.precio] = precioUSD
  filaR[colR.idx.notas] = asumido ? `${NOTA_PERIODO_INICIAL} · ${producto.nota}` : NOTA_PERIODO_INICIAL
  if (colR.idx.meses >= 0 && meses !== MESES_POR_DEFECTO) filaR[colR.idx.meses] = meses
  escrituras.push({ range: rango(PESTANA_RENOVACIONES, `A${filaRenov}`, `${letraColumna(ancho - 1)}${filaRenov}`), values: [filaR] })

  // Fórmulas: copiar la fila 2 de Agencia a la fila nueva
  const copiarFormulas: CopiaDeFormulas[] = agruparConsecutivos([...formulaIdx]).map(([a, b]) => ({
    descripcion: `Copiar las fórmulas de ${letraColumna(a)}:${letraColumna(b)} de la fila ${FILA_FORMULAS_ORIGEN} a la fila ${filaAgencia} (sin esto quedan vacíos fin de período, LTV y duración)`,
    origen: rango(PESTANA_AGENCIA, `${letraColumna(a)}${FILA_FORMULAS_ORIGEN}`, `${letraColumna(b)}${FILA_FORMULAS_ORIGEN}`),
    destino: rango(PESTANA_AGENCIA, `${letraColumna(a)}${filaAgencia}`, `${letraColumna(b)}${filaAgencia}`),
    request: {
      copyPaste: {
        source: { sheetId: SHEET_ID_PENDIENTE, startRowIndex: FILA_FORMULAS_ORIGEN - 1, endRowIndex: FILA_FORMULAS_ORIGEN, startColumnIndex: a, endColumnIndex: b + 1 },
        destination: { sheetId: SHEET_ID_PENDIENTE, startRowIndex: filaAgencia - 1, endRowIndex: filaAgencia, startColumnIndex: a, endColumnIndex: b + 1 },
        pasteType: 'PASTE_FORMULA', pasteOrientation: 'NORMAL',
      },
    },
  }))
  if (!copiarFormulas.length) advertencias.push('No se pudo determinar qué columnas de Agencia tienen fórmulas: revisar a mano que fin de período, LTV y duración queden calculados.')
  if (ctx.hojas.agencia.length >= filaAgencia) advertencias.push(`La lectura ya trae la fila ${filaAgencia} de Agencia (¿fórmulas precargadas debajo de la última con ID?): verificar que esté libre antes de cargar.`)

  const pasos = [
    `1. Agencia, fila ${filaAgencia}: ID ${idNuevo}, ${nombre}, ACTIVO, celular, mail, closer, contrato y Día 1 (${entrada.dia1}).`,
    ...copiarFormulas.map((c, i) => `${i + 2}. ${c.descripcion}.`),
    `${copiarFormulas.length + 2}. Renovaciones, fila ${filaRenov}: período 0 de ${idNuevo}, Día 1 ${entrada.dia1}, Finalización ${fin}, precio USD ${precioUSD}${asumido ? ' (asumido)' : ''}.`,
  ]
  return {
    dryRun: true, ok: true, errores, advertencias, idNuevo, filaAgencia, filaRenovaciones: filaRenov,
    precio: { clave: claveProducto, precioUSD, meses, origen, asumido }, duplicados,
    payload: { valores: { valueInputOption: 'RAW', data: escrituras }, copiarFormulas }, pasos,
  }
}

// ── Reparación de filas ya cargadas sin fórmulas (dry-run) ──────────────────────────────────
// Con ID, las fórmulas de Renovó (K) y LTV contratado / cobrado (L, M) devuelven SIEMPRE un valor ("NO", 0…):
// si la celda está vacía, la fórmula no está. En cambio Fin de período (J) y Duración (N) pueden quedar
// legítimamente en blanco (cliente sin Día 1 ni Finalización), así que solo se copian en las filas que ya
// delataron falta de fórmulas por las otras tres. `sinPeriodo0` marca a quien no tiene su período 0 en
// Renovaciones (sin él, LTV contratado da 0 y el fin de período cae al valor por defecto).
export interface PlanReparacion {
  dryRun: true
  filas: { id: string; fila: number; faltan: string[]; sinPeriodo0: boolean }[]
  copiarFormulas: CopiaDeFormulas[]
}

export function planReparacionFormulas(
  hojas: Pick<HojasCrudas, 'agencia' | 'renovaciones'>,
  formulasAgencia?: Record<string, string> | null,
): PlanReparacion {
  const colA = columnasDeClientes(PESTANA_AGENCIA, hojas.agencia[0])
  const colR = columnasDeRenovaciones(hojas.renovaciones[0])
  const cols = columnasConFormula(formulasAgencia, colA.idx)
  const conPeriodo0 = new Set<string>()
  for (const r of hojas.renovaciones.slice(1)) if (Number(r[colR.idx.periodo]) === 0 && !vacia(r[colR.idx.id])) conPeriodo0.add(String(r[colR.idx.id]).trim())
  const filas: PlanReparacion['filas'] = []
  const porColumna = new Map<number, number[]>()
  const seguras = ['renovo', 'ltvContratado', 'ltvCobrado'].map(k => colA.idx[k as keyof typeof colA.idx]).filter(i => i >= 0 && cols.includes(i))
  hojas.agencia.forEach((r, i) => {
    if (i === 0 || vacia(r[colA.idx.id])) return
    const fila = i + 1, id = String(r[colA.idx.id]).trim()
    const sinFormulas = seguras.some(c => vacia(r[c]))
    const faltan = sinFormulas ? cols.filter(c => vacia(r[c])) : []
    const sinPeriodo0 = !conPeriodo0.has(id)
    if (!faltan.length && !sinPeriodo0) return
    filas.push({ id, fila, faltan: faltan.map(c => letraColumna(c)), sinPeriodo0 })
    for (const c of faltan) porColumna.set(c, [...(porColumna.get(c) ?? []), fila])
  })
  // Rangos de filas consecutivas por columna; columnas con las mismas filas se juntan en un solo pedido
  const grupos = new Map<string, { filas: [number, number]; cols: number[] }>()
  for (const [c, fs] of porColumna) for (const [a, b] of agruparConsecutivos(fs)) {
    const k = `${a}-${b}`
    grupos.set(k, { filas: [a, b], cols: [...(grupos.get(k)?.cols ?? []), c] })
  }
  const copiarFormulas: CopiaDeFormulas[] = []
  for (const g of grupos.values()) for (const [ca, cb] of agruparConsecutivos(g.cols)) {
    const [fa, fb] = g.filas
    copiarFormulas.push({
      descripcion: `Copiar las fórmulas de ${letraColumna(ca)}:${letraColumna(cb)} de la fila ${FILA_FORMULAS_ORIGEN} a las filas ${fa}${fb > fa ? ` a ${fb}` : ''}`,
      origen: rango(PESTANA_AGENCIA, `${letraColumna(ca)}${FILA_FORMULAS_ORIGEN}`, `${letraColumna(cb)}${FILA_FORMULAS_ORIGEN}`),
      destino: rango(PESTANA_AGENCIA, `${letraColumna(ca)}${fa}`, `${letraColumna(cb)}${fb}`),
      request: { copyPaste: {
        source: { sheetId: SHEET_ID_PENDIENTE, startRowIndex: FILA_FORMULAS_ORIGEN - 1, endRowIndex: FILA_FORMULAS_ORIGEN, startColumnIndex: ca, endColumnIndex: cb + 1 },
        destination: { sheetId: SHEET_ID_PENDIENTE, startRowIndex: fa - 1, endRowIndex: fb, startColumnIndex: ca, endColumnIndex: cb + 1 },
        pasteType: 'PASTE_FORMULA', pasteOrientation: 'NORMAL',
      } },
    })
  }
  return { dryRun: true, filas, copiarFormulas }
}
