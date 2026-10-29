// ── Diseño de las pestañas nuevas "Referidos" y "Créditos" del CRM de clientes ─────────────
// SOLO DISEÑO: este módulo es puro y no tiene credenciales ni acceso a Sheets. Describe las columnas, las
// validaciones y las fórmulas, y arma el cuerpo de un spreadsheets.batchUpdate que CREARÍA las pestañas.
// Ese cuerpo se imprime con scripts/crm-referidos-tabs.mjs (que jamás lo envía) y se documenta en
// docs/CRM-CLIENTES-TABS.md. Los encabezados de acá son los que parsear.ts sabe leer (hay un test).
//
// Fórmulas: se escriben con coma y en inglés (la API de Sheets usa siempre ese formato, sea cual sea el
// idioma de la planilla). La planilla muestra; el dashboard manda: creditos.ts recalcula todo y no usa
// las columnas de fórmula, así que un valor mal editado a mano no cambia el saldo.
import { REGLAS_REFERIDOS } from './reglasReferidos'

export type TipoColumna = 'texto' | 'fecha' | 'numero' | 'lista'

export interface ColumnaDef {
  clave: string                 // la misma clave que usa parsear.ts
  encabezado: string
  tipo: TipoColumna
  ancho: number                 // píxeles
  requerida: boolean
  descripcion: string
  lista?: string[]              // valores permitidos (tipo 'lista')
  validacion?: Record<string, unknown>   // regla de la API (si no es una lista simple)
  formula?: (fila: number) => string     // columna calculada: la fórmula de esa fila
}

export interface PestanaDef {
  titulo: string
  sheetId: number               // elegido acá para poder referirse a la pestaña dentro del mismo batchUpdate
  filas: number
  columnas: ColumnaDef[]
  descripcion: string
}

export const ESTADOS_REFERIDO = ['Presentado', 'Asistió', 'No asistió', 'Cerró', 'No cerró', 'Descartado']
export const MOMENTOS_PEDIDO = ['Post-kickoff', 'Primer win', 'Reporte de fin de mes', 'Llamada de proyección']
export const TIPOS_MOVIMIENTO = ['ganado_cierre', 'ganado_llamada', 'canje', 'vencimiento', 'ajuste']

const DIAS = REGLAS_REFERIDOS.liberacion.diasSinReembolso
const MESES = REGLAS_REFERIDOS.vigenciaMeses
const idsAgencia = '=Agencia!$A$2:$A$1000'
const personal = (clave: string, encabezado: string, ancho = 150, descripcion = ''): ColumnaDef =>
  ({ clave, encabezado, tipo: 'texto', ancho, requerida: false, descripcion })

export const PESTANA_REFERIDOS: PestanaDef = {
  titulo: 'Referidos',
  sheetId: 7100001,
  filas: 500,
  descripcion: 'Una fila por referido presentado por un cliente. Hasta 3 nombres por pedido (una fila cada uno).',
  columnas: [
    { clave: 'id', encabezado: 'ID', tipo: 'texto', ancho: 70, requerida: true, descripcion: 'R001, R002… correlativo. Lo asigna el dashboard; a mano, el siguiente libre.',
      validacion: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND(REGEXMATCH($A2,"^R[0-9]{3,}$"),COUNTIF($A$2:$A,$A2)=1)' }] }, strict: true, inputMessage: 'Formato R001 y sin repetir' } },
    { clave: 'fechaPedido', encabezado: 'Fecha del pedido', tipo: 'fecha', ancho: 110, requerida: true, descripcion: 'Cuándo se le pidió el referido al cliente.' },
    { clave: 'momento', encabezado: 'Momento', tipo: 'lista', ancho: 170, requerida: true, descripcion: 'En cuál de los 4 momentos se pidió.', lista: MOMENTOS_PEDIDO },
    { clave: 'idReferidor', encabezado: 'ID referidor', tipo: 'texto', ancho: 100, requerida: true, descripcion: 'ID del cliente activo que refiere (A0xx / A1xx).',
      validacion: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: idsAgencia }] }, strict: false, showCustomUi: true, inputMessage: 'Elegí un ID que exista en Agencia' } },
    personal('nombre', 'Nombre', 190, 'Nombre del referido (lead).'),
    { ...personal('telefono', 'Teléfono', 150, 'Con código de país. Sirve para verificar que sea un lead nuevo.'), requerida: true },
    { ...personal('mail', 'Mail', 190, 'Opcional.'),
      validacion: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=OR($G2="",REGEXMATCH($G2,"^[^@ ]+@[^@ ]+\\.[^@ ]+$"))' }] }, strict: false, inputMessage: 'Tiene que parecer un mail' } },
    { ...personal('estudio', 'Estudio', 190, 'Estudio del referido: tiene que ser distinto al del cliente que refiere.'), requerida: true },
    { clave: 'estado', encabezado: 'Estado', tipo: 'lista', ancho: 110, requerida: true, descripcion: 'Presentado → Asistió / No asistió → Cerró / No cerró. Descartado si no es válido.', lista: ESTADOS_REFERIDO },
    { clave: 'fechaLlamada', encabezado: 'Fecha de llamada', tipo: 'fecha', ancho: 120, requerida: false, descripcion: 'Obligatoria si el estado es Asistió, Cerró o No cerró (queda marcada en rojo si falta).' },
    { clave: 'idClienteNuevo', encabezado: 'ID cliente nuevo', tipo: 'texto', ancho: 120, requerida: false, descripcion: 'ID que recibió al cerrar (A1xx). Solo si Cerró.',
      validacion: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=OR($K2="",COUNTIF(Agencia!$A$2:$A$1000,$K2)>0)' }] }, strict: false, inputMessage: 'Tiene que existir en Agencia' } },
    { clave: 'fechaPrimerPago', encabezado: 'Fecha del primer pago', tipo: 'fecha', ancho: 130, requerida: false, descripcion: 'Cuándo entró el primer pago del referido. Obligatoria si Cerró.' },
    { clave: 'fechaLiberacion', encabezado: 'Fecha de liberación', tipo: 'fecha', ancho: 130, requerida: false, descripcion: `FÓRMULA: primer pago + ${DIAS} días, vacía si hay reembolso. Informativa: el dashboard la recalcula.`,
      formula: n => `=IF(OR($L${n}="",$N${n}="SI"),"",$L${n}+${DIAS})` },
    { clave: 'reembolso', encabezado: 'Reembolso', tipo: 'lista', ancho: 90, requerida: false, descripcion: 'SI si el referido pidió reembolso: el crédito de ese cierre no se libera.', lista: ['SI', 'NO'] },
    personal('notas', 'Notas', 260, 'Libre.'),
    personal('cargadoPor', 'Cargado por', 110, 'Quién cargó la fila (el dashboard lo completa solo).'),
    { clave: 'referidorNombre', encabezado: 'Referidor (nombre)', tipo: 'texto', ancho: 190, requerida: false, descripcion: 'FÓRMULA de ayuda: nombre del cliente según su ID. No la lee el dashboard.',
      formula: n => `=IF($D${n}="","",IFERROR(INDEX(Agencia!$B:$B,MATCH($D${n},Agencia!$A:$A,0)),"no existe en Agencia"))` },
  ],
}

export const PESTANA_CREDITOS: PestanaDef = {
  titulo: 'Créditos',
  sheetId: 7100002,
  filas: 1000,
  descripcion: 'Libro de movimientos de créditos: se agrega una fila por cada ganado, canje, vencimiento o ajuste. No se edita ni se borra lo anterior.',
  columnas: [
    { clave: 'id', encabezado: 'ID', tipo: 'texto', ancho: 70, requerida: true, descripcion: 'M001, M002… correlativo.',
      validacion: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND(REGEXMATCH($A2,"^M[0-9]{3,}$"),COUNTIF($A$2:$A,$A2)=1)' }] }, strict: true, inputMessage: 'Formato M001 y sin repetir' } },
    { clave: 'fecha', encabezado: 'Fecha', tipo: 'fecha', ancho: 110, requerida: true, descripcion: 'Del ganado_cierre: la fecha de LIBERACIÓN. Del canje: el día que se aplicó a la renovación (corta el ciclo).' },
    { clave: 'idCliente', encabezado: 'ID cliente', tipo: 'texto', ancho: 100, requerida: true, descripcion: 'Cliente dueño del crédito (el que refiere).',
      validacion: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: idsAgencia }] }, strict: false, showCustomUi: true, inputMessage: 'Elegí un ID que exista en Agencia' } },
    { clave: 'tipo', encabezado: 'Tipo', tipo: 'lista', ancho: 130, requerida: true, descripcion: 'ganado_cierre · ganado_llamada · canje · vencimiento · ajuste.', lista: TIPOS_MOVIMIENTO },
    { clave: 'idReferido', encabezado: 'Referido', tipo: 'texto', ancho: 90, requerida: false, descripcion: 'ID del referido que originó el movimiento (R001).',
      validacion: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=OR($E2="",COUNTIF(Referidos!$A$2:$A,$E2)>0)' }] }, strict: false, inputMessage: 'Tiene que existir en Referidos' } },
    { clave: 'meses', encabezado: 'Meses (+/-)', tipo: 'numero', ancho: 90, requerida: true, descripcion: 'Positivo al ganar, negativo al canjear o vencer (ganado_llamada = premio de un intento: 1 con el intento 5 y 0 con los demás premios).',
      validacion: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND(ISNUMBER($F2),OR($D2="ajuste",AND(OR($D2="ganado_cierre",$D2="ganado_llamada"),$F2>=0),AND(OR($D2="canje",$D2="vencimiento"),$F2<=0)))' }] }, strict: true, inputMessage: 'ganado ≥ 0 · canje/vencimiento ≤ 0 · ajuste libre' } },
    { clave: 'extra', encabezado: 'Extra', tipo: 'texto', ancho: 150, requerida: false, descripcion: 'Beneficio que no es meses: "identidad de marca completa", "página web", "branding"… En un canje, los USD canjeados ("USD 300"): el libro no tiene columna de USD. El canje de una grabación, de la página web o del branding va con ese Extra y 0 meses (no corta el ciclo).' },
    { clave: 'vence', encabezado: 'Vence', tipo: 'fecha', ancho: 110, requerida: false, descripcion: `FÓRMULA en ganado_cierre / ganado_llamada: fecha + ${MESES} meses. En un ajuste con vencimiento se escribe a mano encima.`,
      formula: n => `=IF(OR($D${n}="ganado_cierre",$D${n}="ganado_llamada"),IF($B${n}="","",EDATE($B${n},${MESES})),"")` },
    { clave: 'renovacionAplicada', encabezado: 'Renovación aplicada', tipo: 'texto', ancho: 150, requerida: false, descripcion: 'En un canje: a qué renovación se aplicó (R2, R3…). Obligatoria si Tipo = canje.' },
    personal('nota', 'Nota', 260, 'Libre.'),
    personal('cargadoPor', 'Cargado por', 110, 'Quién cargó la fila.'),
  ],
}

export const PESTANAS_NUEVAS: PestanaDef[] = [PESTANA_REFERIDOS, PESTANA_CREDITOS]

// ── Armado del batchUpdate (solo datos; nadie lo envía desde acá) ───────────────────────────
// Estilo de encabezado: el mismo de las demás pestañas del CRM (scripts/build-crm.mjs).
const DARK = { red: 0.102, green: 0.102, blue: 0.102 }, NARANJA = { red: 0.953, green: 0.573, blue: 0 }
const ROJO_SUAVE = { red: 0.99, green: 0.89, blue: 0.85 }, VERDE_SUAVE = { red: 0.85, green: 0.94, blue: 0.85 }, GRIS_SUAVE = { red: 0.93, green: 0.93, blue: 0.93 }
type Req = Record<string, unknown>

const rangoCol = (p: PestanaDef, col: number, desde = 1, hasta = p.filas) =>
  ({ sheetId: p.sheetId, startRowIndex: desde, endRowIndex: hasta, startColumnIndex: col, endColumnIndex: col + 1 })

function requestsDePestana(p: PestanaDef): Req[] {
  const n = p.columnas.length
  const reqs: Req[] = [
    { addSheet: { properties: { sheetId: p.sheetId, title: p.titulo, gridProperties: { rowCount: p.filas, columnCount: n, frozenRowCount: 1, frozenColumnCount: 1 } } } },
    { updateCells: { range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      rows: [{ values: p.columnas.map(c => ({ userEnteredValue: { stringValue: c.encabezado } })) }], fields: 'userEnteredValue' } },
    { repeatCell: { range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      cell: { userEnteredFormat: { backgroundColor: DARK, textFormat: { foregroundColor: NARANJA, bold: true, fontSize: 9 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)' } },
    { setBasicFilter: { filter: { range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: p.filas, startColumnIndex: 0, endColumnIndex: n } } } },
  ]
  p.columnas.forEach((c, i) => {
    reqs.push({ updateDimensionProperties: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: c.ancho }, fields: 'pixelSize' } })
    if (c.tipo === 'fecha') reqs.push({ repeatCell: { range: rangoCol(p, i), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } })
    // Validación de datos
    let regla: Record<string, unknown> | null = null
    if (c.validacion) regla = c.validacion
    else if (c.tipo === 'lista' && c.lista) regla = { condition: { type: 'ONE_OF_LIST', values: c.lista.map(v => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true }
    else if (c.tipo === 'fecha') regla = { condition: { type: 'DATE_IS_VALID' }, strict: true, inputMessage: 'Una fecha (dd/mm/aaaa)' }
    else if (c.tipo === 'numero') regla = { condition: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '-24' }, { userEnteredValue: '24' }] }, strict: true }
    if (regla && !c.formula) reqs.push({ setDataValidation: { range: rangoCol(p, i), rule: regla } })
    // Columnas calculadas: una fórmula por fila (con la fila bien escrita) y protegidas con aviso
    if (c.formula) {
      reqs.push({ updateCells: { range: rangoCol(p, i), rows: Array.from({ length: p.filas - 1 }, (_, k) => ({ values: [{ userEnteredValue: { formulaValue: c.formula!(k + 2) } }] })), fields: 'userEnteredValue' } })
      reqs.push({ addProtectedRange: { protectedRange: { range: rangoCol(p, i), description: `Columna calculada: ${c.encabezado}`, warningOnly: true } } })
    }
  })
  return reqs
}

// Marcas de calidad de datos (formato condicional)
function reglasCondicionalesReferidos(): Req[] {
  const p = PESTANA_REFERIDOS
  const col = (clave: string) => p.columnas.findIndex(c => c.clave === clave)
  const regla = (clave: string, formula: string, color: Record<string, number>): Req => ({
    addConditionalFormatRule: { index: 0, rule: { ranges: [rangoCol(p, col(clave))], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format: { backgroundColor: color } } } },
  })
  return [
    regla('fechaLlamada', '=AND(OR($I2="Asistió",$I2="Cerró",$I2="No cerró"),$J2="")', ROJO_SUAVE),
    regla('idClienteNuevo', '=AND($I2="Cerró",$K2="")', ROJO_SUAVE),
    regla('fechaPrimerPago', '=AND($I2="Cerró",$L2="")', ROJO_SUAVE),
    regla('estado', '=$I2="Cerró"', VERDE_SUAVE),
    regla('estado', '=OR($I2="No asistió",$I2="Descartado")', GRIS_SUAVE),
  ]
}
function reglasCondicionalesCreditos(): Req[] {
  const p = PESTANA_CREDITOS
  const col = (clave: string) => p.columnas.findIndex(c => c.clave === clave)
  return [{
    addConditionalFormatRule: { index: 0, rule: { ranges: [rangoCol(p, col('renovacionAplicada'))], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($D2="canje",$I2="",$G2<>"grabación",$G2<>"página web",$G2<>"branding")' }] }, format: { backgroundColor: ROJO_SUAVE } } } },
  }]
}

export interface BatchUpdateDryRun { requests: Req[] }

export function construirBatchUpdateNuevasPestanas(): BatchUpdateDryRun {
  return { requests: [...PESTANAS_NUEVAS.flatMap(requestsDePestana), ...reglasCondicionalesReferidos(), ...reglasCondicionalesCreditos()] }
}

// Resumen legible (qué tipo de pedido y cuántos) para mostrar sin imprimir el cuerpo completo
export function resumirBatch(b: BatchUpdateDryRun): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of b.requests) { const k = Object.keys(r)[0]; out[k] = (out[k] ?? 0) + 1 }
  return out
}
