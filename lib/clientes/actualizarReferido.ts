// ── "Actualizar referido": avanzar un referido ya cargado desde el Despacho (27/10/2026) ──────────────────────────────────
// Pedido de Tomás: marcar Asistió / No asistió / No cerró / Cerró / Descartado, vincular el cliente nuevo, cargar la fecha del
// primer pago y el reembolso, sin tocar la planilla a mano. Escribe SOLO sobre la fila existente del referido (I:L y N:O de la
// pestaña "Referidos"): nunca agrega filas, así que no puede duplicar. Los créditos los sigue calculando creditos.ts desde la fila.
//   · Misma bandera que el alta: CRM_ESCRITURA_REFERIDOS=real escribe; sin ella, simula ("se habría guardado").
//   · Concurrencia optimista: el pedido trae el estado que vio la pantalla (`estadoAnterior`); si la fila ya cambió, 409.
//   · Pedido repetido con los mismos datos = "sin cambios" (idempotente).
// Validación y armado de celdas: PUROS (sin red ni reloj). El escritor real está al final.
import { google } from 'googleapis'
import { ESTADOS_REFERIDO } from './pestanasNuevas'
import { esYmdValido, fechaDeCelda, hoyArgentina, ymdASerial, type Ymd } from './fechas'
import { TIMEOUT_RED_SHEETS_MS } from './coordinadorPostgres'
import type { EstadoReferido } from './tipos'

export interface EntradaActualizar {
  id: unknown                    // 'R001'
  estadoAnterior: unknown        // lo que mostraba la pantalla
  estado: unknown
  fechaLlamada?: unknown         // 'AAAA-MM-DD' o ''
  idClienteNuevo?: unknown       // 'A170' (solo con Cerró)
  fechaPrimerPago?: unknown      // 'AAAA-MM-DD' o '' (solo con Cerró)
  reembolso?: unknown            // true/false (solo con Cerró)
  nota?: unknown                 // se agrega al final de Notas, con fecha y quién
}

export interface ActualizacionLimpia {
  id: string; estadoAnterior: EstadoReferido | ''; estado: EstadoReferido
  fechaLlamada: Ymd | ''; idClienteNuevo: string; fechaPrimerPago: Ymd | ''; reembolso: boolean; nota: string
}
export type ErroresActualizar = Partial<Record<'id' | 'estado' | 'fechaLlamada' | 'idClienteNuevo' | 'fechaPrimerPago' | 'reembolso' | 'nota', string>>

/** Lo que hay hoy en la planilla para ese referido (lectura fresca). */
export interface FilaReferidoActual {
  fila: number; id: string; idReferidor: string; estado: string; fechaPedido: Ymd | null
  fechaLlamada: Ymd | null; idClienteNuevo: string; fechaPrimerPago: Ymd | null; reembolso: boolean; notas: string
}
/** Para validar el cliente nuevo: los IDs del CRM y qué referido ya tiene vinculado cada uno. */
export interface ContextoActualizar { idsClientes: Set<string>; vinculados: Map<string, string> /* idClienteNuevo → R### */ }

const ESTADOS = ESTADOS_REFERIDO as readonly string[]
const CON_LLAMADA: readonly string[] = ['Asistió', 'No asistió', 'No cerró', 'Cerró']
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const fechaOpcional = (v: unknown): Ymd | '' | null => {
  const s = txt(v, 10)
  if (!s) return ''
  return esYmdValido(s) ? s : null
}

export function validarActualizacion(e: EntradaActualizar, hoy: Ymd): { ok: true; act: ActualizacionLimpia } | { ok: false; errores: ErroresActualizar } {
  const errores: ErroresActualizar = {}
  const id = txt(e.id, 12).toUpperCase()
  if (!/^R\d{3,}$/.test(id)) errores.id = 'Referido inválido.'
  const estado = txt(e.estado, 20)
  if (!ESTADOS.includes(estado)) errores.estado = 'Elegí un estado.'
  const anterior = txt(e.estadoAnterior, 20)
  const fechaLlamada = fechaOpcional(e.fechaLlamada)
  const fechaPrimerPago = fechaOpcional(e.fechaPrimerPago)
  const idClienteNuevo = txt(e.idClienteNuevo, 12).toUpperCase()
  const reembolso = e.reembolso === true
  const nota = txt(e.nota, 300)

  if (fechaLlamada === null) errores.fechaLlamada = 'La fecha de la llamada no es válida.'
  else if (fechaLlamada && fechaLlamada > hoy) errores.fechaLlamada = 'La fecha de la llamada no puede ser futura.'
  else if (CON_LLAMADA.includes(estado) && !fechaLlamada) errores.fechaLlamada = `Para "${estado}" cargá la fecha de la llamada.`

  if (fechaPrimerPago === null) errores.fechaPrimerPago = 'La fecha del primer pago no es válida.'
  else if (fechaPrimerPago && fechaPrimerPago > hoy) errores.fechaPrimerPago = 'La fecha del primer pago no puede ser futura.'
  else if (fechaPrimerPago && fechaLlamada && fechaPrimerPago < fechaLlamada) errores.fechaPrimerPago = 'El primer pago no puede ser anterior a la llamada.'

  if (estado === 'Cerró') {
    if (!/^[AC]\d{3,}$/.test(idClienteNuevo)) errores.idClienteNuevo = 'Para "Cerró" elegí el cliente nuevo (su ID del CRM).'
  } else {
    if (idClienteNuevo) errores.idClienteNuevo = 'El cliente nuevo solo se vincula con "Cerró".'
    if (fechaPrimerPago) errores.fechaPrimerPago = 'La fecha del primer pago solo va con "Cerró".'
    if (reembolso) errores.reembolso = 'El reembolso solo va con "Cerró".'
  }
  if (Object.keys(errores).length) return { ok: false, errores }
  return {
    ok: true,
    act: {
      id, estadoAnterior: (ESTADOS.includes(anterior) ? anterior : '') as EstadoReferido | '', estado: estado as EstadoReferido,
      fechaLlamada: fechaLlamada as Ymd | '', idClienteNuevo: estado === 'Cerró' ? idClienteNuevo : '',
      fechaPrimerPago: (estado === 'Cerró' ? fechaPrimerPago : '') as Ymd | '', reembolso: estado === 'Cerró' && reembolso, nota,
    },
  }
}

export type DecisionActualizar =
  | { tipo: 'cambiar'; celdasIL: (string | number)[]; celdasNO: (string | number)[]; resumen: string; avisos: string[] }
  | { tipo: 'sin_cambios' }
  | { tipo: 'rechazado'; codigo: 'no_existe' | 'cambio_concurrente' | 'cliente_inexistente' | 'cliente_es_referidor' | 'cliente_ya_vinculado' | 'llamada_antes_del_pedido'; mensaje: string }

const ddmm = (f: Ymd) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const sinFormula = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s)

/** Decide qué celdas escribir sobre la fila actual. `quien` = nombre corto para la nota. */
export function decidirActualizacion(a: ActualizacionLimpia, actual: FilaReferidoActual | null, ctx: ContextoActualizar, hoy: Ymd, quien: string): DecisionActualizar {
  if (!actual) return { tipo: 'rechazado', codigo: 'no_existe', mensaje: `No encuentro el referido ${a.id} en la planilla.` }
  const iguales = actual.estado === a.estado && (actual.fechaLlamada ?? '') === a.fechaLlamada && actual.idClienteNuevo === a.idClienteNuevo
    && (actual.fechaPrimerPago ?? '') === a.fechaPrimerPago && actual.reembolso === a.reembolso
  if (iguales && !a.nota) return { tipo: 'sin_cambios' }
  if ((actual.estado || '') !== (a.estadoAnterior || '')) {
    return { tipo: 'rechazado', codigo: 'cambio_concurrente', mensaje: `Alguien ya cambió este referido (ahora está "${actual.estado || 'sin estado'}"). Actualizá la pantalla y volvé a intentar.` }
  }
  if (a.fechaLlamada && actual.fechaPedido && a.fechaLlamada < actual.fechaPedido) {
    return { tipo: 'rechazado', codigo: 'llamada_antes_del_pedido', mensaje: `La llamada no puede ser anterior al pedido (${actual.fechaPedido}).` }
  }
  if (a.idClienteNuevo) {
    if (!ctx.idsClientes.has(a.idClienteNuevo)) return { tipo: 'rechazado', codigo: 'cliente_inexistente', mensaje: `El cliente ${a.idClienteNuevo} no está en el CRM. Cargá primero el alta.` }
    if (a.idClienteNuevo === actual.idReferidor) return { tipo: 'rechazado', codigo: 'cliente_es_referidor', mensaje: 'El cliente nuevo no puede ser el mismo que refirió.' }
    const otro = ctx.vinculados.get(a.idClienteNuevo)
    if (otro && otro !== a.id) return { tipo: 'rechazado', codigo: 'cliente_ya_vinculado', mensaje: `${a.idClienteNuevo} ya está vinculado al referido ${otro}. Un cliente nuevo cuenta para un solo referido.` }
  }
  const avisos: string[] = []
  if (a.estado === 'Cerró' && !a.fechaPrimerPago) avisos.push('Sin fecha del primer pago el crédito queda esperando: cargala cuando entre el pago.')
  const notas = a.nota ? [actual.notas, `[${ddmm(hoy)}] ${a.nota} (${quien})`].filter(Boolean).join(' · ') : actual.notas
  const partes = [a.estado, a.idClienteNuevo && `→ ${a.idClienteNuevo}`, a.fechaPrimerPago && `primer pago ${a.fechaPrimerPago}`, a.reembolso && 'con reembolso'].filter(Boolean)
  return {
    tipo: 'cambiar', avisos, resumen: `${a.id}: ${partes.join(' · ')}`,
    celdasIL: [a.estado, a.fechaLlamada ? ymdASerial(a.fechaLlamada) : '', a.idClienteNuevo, a.fechaPrimerPago ? ymdASerial(a.fechaPrimerPago) : ''],
    celdasNO: [a.estado === 'Cerró' ? (a.reembolso ? 'SI' : 'NO') : '', sinFormula(notas).slice(0, 5000)],
  }
}

// ── Escritor ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PlanillaActualizar {
  leerFila(id: string): Promise<FilaReferidoActual | null>
  leerContexto(): Promise<ContextoActualizar>
  escribir(fila: number, il: (string | number)[], no: (string | number)[]): Promise<void>
}

export type ResultadoActualizar =
  | { ok: true; estado: 'guardado' | 'simulado' | 'sin_cambios'; id: string; resumen?: string; avisos: string[]; mensaje: string }
  | { ok: false; codigo: 'validacion'; errores: ErroresActualizar }
  | { ok: false; codigo: 'rechazado'; motivo: string; mensaje: string }
  | { ok: false; codigo: 'sin_permiso_planilla' | 'planilla_no_disponible' | 'sin_confirmar'; mensaje: string }

const digitos = (v: unknown) => String(v ?? '').trim()
const esSi = (v: unknown) => /^s[ií]$/i.test(String(v ?? '').trim())

export function planillaActualizarReal(): PlanillaActualizar {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const spreadsheetId = process.env.SHEET_ID_CLIENTES
  if (!email || !key || !spreadsheetId) throw new Error('config')
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
  const leerTodo = async () => (await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Referidos'!A2:O", valueRenderOption: 'UNFORMATTED_VALUE' }, { timeout: TIMEOUT_RED_SHEETS_MS })).data.values ?? []
  return {
    async leerFila(id) {
      const filas = (await leerTodo()).map((f, i) => ({ f, fila: i + 2 })).filter(x => digitos(x.f[0]).toUpperCase() === id)
      if (filas.length !== 1) return null   // ninguna o repetida a mano: no se adivina cuál
      const { f, fila } = filas[0]
      return {
        fila, id, idReferidor: digitos(f[3]).toUpperCase(), estado: digitos(f[8]), fechaPedido: fechaDeCelda(f[1]),
        fechaLlamada: fechaDeCelda(f[9]), idClienteNuevo: digitos(f[10]).toUpperCase(), fechaPrimerPago: fechaDeCelda(f[11]),
        reembolso: esSi(f[13]), notas: String(f[14] ?? ''),
      }
    },
    async leerContexto() {
      const [refs, cli] = await Promise.all([
        leerTodo(),
        sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Agencia'!A2:A", "'Consultora'!A2:A"], valueRenderOption: 'UNFORMATTED_VALUE' }, { timeout: TIMEOUT_RED_SHEETS_MS }),
      ])
      const idsClientes = new Set<string>()
      for (const v of cli.data.valueRanges ?? []) for (const f of v.values ?? []) { const x = digitos(f[0]).toUpperCase(); if (x) idsClientes.add(x) }
      const vinculados = new Map<string, string>()
      for (const f of refs) { const nuevo = digitos(f[10]).toUpperCase(), r = digitos(f[0]).toUpperCase(); if (nuevo && r && !vinculados.has(nuevo)) vinculados.set(nuevo, r) }
      return { idsClientes, vinculados }
    },
    async escribir(fila, il, no) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: [{ range: `'Referidos'!I${fila}:L${fila}`, values: [il] }, { range: `'Referidos'!N${fila}:O${fila}`, values: [no] }] },
      }, { timeout: TIMEOUT_RED_SHEETS_MS })
    },
  }
}

// Una actualización a la vez por proceso (dos clics seguidos no se pisan). Entre instancias la protege `estadoAnterior`.
let cola: Promise<unknown> = Promise.resolve()

export async function actualizarReferido(
  entrada: EntradaActualizar, quien: string,
  op: { planilla?: PlanillaActualizar; real?: boolean; hoy?: Ymd } = {},
): Promise<ResultadoActualizar> {
  const hoy = op.hoy ?? hoyArgentina()
  const v = validarActualizacion(entrada, hoy)
  if (!v.ok) return { ok: false, codigo: 'validacion', errores: v.errores }
  const real = op.real ?? process.env.CRM_ESCRITURA_REFERIDOS === 'real'
  let planilla: PlanillaActualizar
  try { planilla = op.planilla ?? planillaActualizarReal() } catch { return { ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo conectar con la planilla del CRM.' } }

  const trabajo = async (): Promise<ResultadoActualizar> => {
    let actual: FilaReferidoActual | null, ctx: ContextoActualizar
    try { [actual, ctx] = await Promise.all([planilla.leerFila(v.act.id), planilla.leerContexto()]) } catch (e) {
      console.error('Actualizar referido: lectura fallida:', String((e as Error).message).slice(0, 160))
      return { ok: false, codigo: 'planilla_no_disponible', mensaje: 'No se pudo leer la planilla del CRM. No se cambió nada.' }
    }
    const d = decidirActualizacion(v.act, actual, ctx, hoy, quien || 'Equipo')
    if (d.tipo === 'rechazado') return { ok: false, codigo: 'rechazado', motivo: d.codigo, mensaje: d.mensaje }
    if (d.tipo === 'sin_cambios') return { ok: true, estado: 'sin_cambios', id: v.act.id, avisos: [], mensaje: 'Ya estaba así: no se cambió nada.' }
    if (!real) return { ok: true, estado: 'simulado', id: v.act.id, resumen: d.resumen, avisos: d.avisos, mensaje: `Modo de revisión: no se guardó nada. Se habría guardado ${d.resumen}.` }
    try {
      await planilla.escribir(actual!.fila, d.celdasIL, d.celdasNO)
    } catch (e) {
      const x = e as { code?: number | string; status?: number | string }
      if (x?.code === 403 || x?.status === 403) return { ok: false, codigo: 'sin_permiso_planilla', mensaje: 'La cuenta del dashboard no tiene permiso de edición en la planilla del CRM. No se guardó nada.' }
      console.error('Actualizar referido: escritura sin confirmar:', String((e as Error).message).slice(0, 160))
      return { ok: false, codigo: 'sin_confirmar', mensaje: 'La escritura no está confirmada (corte o espera agotada). Actualizá la pantalla: si quedó guardado lo vas a ver; si no, reintentá.' }
    }
    // Verificación: releer la fila y comprobar el estado y el cliente nuevo
    try {
      const despues = await planilla.leerFila(v.act.id)
      if (!despues || despues.estado !== v.act.estado || despues.idClienteNuevo !== v.act.idClienteNuevo) {
        return { ok: false, codigo: 'sin_confirmar', mensaje: 'Se escribió, pero al releer la fila no coincide (¿alguien la editó a la vez?). Revisá la planilla.' }
      }
    } catch { d.avisos.push('Se guardó, pero no se pudo releer para verificar.') }
    return { ok: true, estado: 'guardado', id: v.act.id, resumen: d.resumen, avisos: d.avisos, mensaje: `Guardado: ${d.resumen}.` }
  }
  const tarea = cola.then(trabajo)
  cola = tarea.catch(() => undefined)
  return tarea
}
