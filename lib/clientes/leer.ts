// ── Lectura del CRM de clientes (Google Sheets, SOLO LECTURA) ─────────────────────────────
// Una carga en frío = UNA llamada values.batchGet con todas las pestañas (Agencia, Consultora,
// Renovaciones y, si existen, Referidos, Créditos y Config). Scope readonly: aunque alguien lo
// intentara, esta capa no puede escribir en las planillas.
//
// Cuota (60 lecturas/min por service account, COMPARTIDA con producción):
//  · el resultado crudo se guarda en snapshot.ts y se reutiliza 10 min (TTL);
//  · ante un 429 o cualquier error se responde con el último snapshot y no se insiste por 60 s;
//  · ni forzando se lee más seguido que cada 30 s; pedidos simultáneos comparten una sola lectura;
//  · NO hay reintentos automáticos: reintentar contra un 429 solo suma presión sobre la cuota.
// Una pestaña opcional que todavía no existe tumba el batchGet con "Unable to parse range": se saca
// del lote, se recuerda 60 min en el snapshot y se devuelve null para ella (máximo una llamada de más
// por pestaña faltante, solo la primera vez).
//
// Importante: este módulo es solo de servidor (usa googleapis, variables de entorno y disco).
import { google } from 'googleapis'
import type { DatosClientes, FuenteDatos, HojasCrudas, Fila } from './tipos'
import type { Ymd } from './fechas'
import { hoyArgentina } from './fechas'
import { derivarClientes } from './clasificar'
import type { OpcionesNoCliente } from './clasificar'
import { parsearHojas } from './parsear'
import type { Snapshot } from './snapshot'
import {
  ESPERA_TRAS_FALLO_MS, MIN_ENTRE_LECTURAS_MS, TTL_PESTANA_AUSENTE_MS, TTL_SNAPSHOT_MS,
  edadSnapshot, guardarSnapshot, leerSnapshot, snapshotFresco,
} from './snapshot'
import { letraColumna } from './texto'

// Los rangos SIEMPRE arrancan en la fila 1: los encabezados se necesitan para resolver las columnas.
// (rawSheets.ts descarta la fila 1 con slice(1); acá se conserva, por eso nunca se pide desde la fila 2.)
interface RangoCRM { clave: keyof HojasCrudas; pestana: string; rango: string; opcional: boolean }
export const RANGOS_CRM: RangoCRM[] = [
  { clave: 'agencia', pestana: 'Agencia', rango: "'Agencia'!A1:AF", opcional: false },
  { clave: 'consultora', pestana: 'Consultora', rango: "'Consultora'!A1:AF", opcional: false },
  { clave: 'renovaciones', pestana: 'Renovaciones', rango: "'Renovaciones'!A1:L", opcional: false },
  { clave: 'referidos', pestana: 'Referidos', rango: "'Referidos'!A1:T", opcional: true },
  { clave: 'creditos', pestana: 'Créditos', rango: "'Créditos'!A1:N", opcional: true },
  { clave: 'config', pestana: 'Config', rango: "'Config'!A1:L60", opcional: true },
]

let lecturasHechas = 0
// Requests a la API de Sheets hechos por este proceso (para contabilizar la cuota en los scripts)
export const lecturasRealizadas = (): number => lecturasHechas

function clienteSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Faltan credenciales de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)')
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  return google.sheets({ version: 'v4', auth })
}

const idPlanilla = (): string => {
  const id = process.env.SHEET_ID_CLIENTES
  if (!id) throw new Error('Falta SHEET_ID_CLIENTES')
  return id
}

export const esErrorDeCuota = (e: unknown): boolean => {
  const x = e as { code?: number | string; status?: number | string; message?: string }
  return x?.code === 429 || x?.status === 429 || /quota|rate.?limit|too many requests|\b429\b/i.test(x?.message ?? '')
}

// ── Lectura real: un batchGet (y, solo si falta alguna pestaña opcional, unos pocos más) ──
async function leerDeSheets(previo: Snapshot | null): Promise<Snapshot> {
  const sheets = clienteSheets()
  const spreadsheetId = idPlanilla()
  const ahora = Date.now()
  const ausentes: Record<string, number> = {}
  for (const [k, t] of Object.entries(previo?.ausentes ?? {})) if (ahora - t < TTL_PESTANA_AUSENTE_MS) ausentes[k] = t
  let pedidos = RANGOS_CRM.filter(r => !(r.opcional && ausentes[r.pestana]))

  for (let intento = 0; intento <= RANGOS_CRM.length; intento++) {
    try {
      lecturasHechas++
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: pedidos.map(r => r.rango),
        valueRenderOption: 'UNFORMATTED_VALUE',   // números y fechas reales (la planilla usa formato latino)
      })
      const vrs = res.data.valueRanges ?? []
      const hojas: Record<string, Fila[] | null> = {}
      for (const r of RANGOS_CRM) hojas[r.clave] = null
      pedidos.forEach((r, i) => { hojas[r.clave] = (vrs[i]?.values ?? []) as Fila[] })
      return {
        version: 1, guardadoEn: Date.now(), invalidado: false,
        hojas: hojas as unknown as HojasCrudas, ausentes,
        formulasAgencia: previo?.formulasAgencia ?? null, formulasRenovaciones: previo?.formulasRenovaciones ?? null, reintentarDesde: 0,
      }
    } catch (e) {
      const msg = (e as Error).message ?? ''
      if (!/unable to parse range/i.test(msg)) throw e
      // Pestaña inexistente: solo una opcional puede faltar sin que sea un error
      const mala = pedidos.find(r => msg.includes(r.pestana) || msg.includes(r.rango))
      if (mala && !mala.opcional) throw new Error(`Falta la pestaña obligatoria "${mala.pestana}" en el CRM de clientes`)
      if (mala) { ausentes[mala.pestana] = Date.now(); pedidos = pedidos.filter(r => r !== mala); continue }
      // El error no dice cuál: se prueba sin las opcionales SOLO esta vez (no se recuerda como ausente)
      if (pedidos.some(r => r.opcional)) { pedidos = pedidos.filter(r => !r.opcional); continue }
      throw e
    }
  }
  throw new Error('No se pudo leer el CRM de clientes: demasiadas pestañas faltantes')
}

// ── Qué hojas usar: snapshot fresco → Sheets → snapshot viejo como respaldo ──
export interface OpcionesLectura {
  forzar?: boolean      // saltea el TTL (no el mínimo entre lecturas ni la espera tras un error)
  ttlMs?: number
}
export interface ResultadoHojas { snap: Snapshot; fuente: FuenteDatos; aviso?: string }

let enVuelo: Promise<ResultadoHojas> | null = null
let falloReciente: { hasta: number; mensaje: string } | null = null

// Solo para los tests: olvida el último fallo y el pedido en vuelo del proceso
export function reiniciarEstadoDeLectura(): void { enVuelo = null; falloReciente = null; lecturasHechas = 0 }

export function obtenerHojas(op: OpcionesLectura = {}): Promise<ResultadoHojas> {
  if (enVuelo) return enVuelo   // pedidos simultáneos comparten una sola lectura
  enVuelo = obtener(op).finally(() => { enVuelo = null })
  return enVuelo
}

async function obtener(op: OpcionesLectura): Promise<ResultadoHojas> {
  const ahora = Date.now()
  const snap = leerSnapshot()
  const ttl = op.ttlMs ?? TTL_SNAPSHOT_MS
  if (snap && snapshotFresco(snap, ttl, ahora) && !op.forzar) return { snap, fuente: 'snapshot' }

  // No insistir: tras un error, o si la última lectura real fue hace menos de 30 s
  const espera = Math.max(snap?.reintentarDesde ?? 0, falloReciente?.hasta ?? 0)
  const muyReciente = snap ? edadSnapshot(snap, ahora) < MIN_ENTRE_LECTURAS_MS : false
  if (snap && ahora < espera) return { snap, fuente: 'snapshot_viejo', aviso: 'Se espera antes de volver a leer Sheets tras un error reciente.' }
  if (snap && muyReciente) return { snap, fuente: 'snapshot', aviso: 'Lectura reciente: se reutiliza para no pasar la cuota.' }
  if (!snap && falloReciente && ahora < falloReciente.hasta) throw new Error(`Sheets falló hace instantes (${falloReciente.mensaje}) y no hay snapshot: se reintenta en un rato.`)

  try {
    const nuevo = await leerDeSheets(snap)
    falloReciente = null
    guardarSnapshot(nuevo)
    return { snap: nuevo, fuente: 'sheets' }
  } catch (e) {
    const mensaje = ((e as Error).message ?? 'error desconocido').slice(0, 160)
    falloReciente = { hasta: Date.now() + ESPERA_TRAS_FALLO_MS, mensaje }
    if (snap) {
      guardarSnapshot({ ...snap, reintentarDesde: Date.now() + ESPERA_TRAS_FALLO_MS })
      console.error(`Clientes: falló la lectura de Sheets (${esErrorDeCuota(e) ? 'cuota 429' : mensaje}) → uso el snapshot de hace ${Math.round(edadSnapshot(snap) / 60_000)} min`)
      return { snap, fuente: 'snapshot_viejo', aviso: esErrorDeCuota(e) ? 'Google limitó las lecturas (429): se muestran datos guardados.' : `Falló la lectura de Sheets: se muestran datos guardados (${mensaje}).` }
    }
    throw e
  }
}

// ── De hojas crudas a datos listos para la interfaz ──
export interface OpcionesDatos extends OpcionesNoCliente { hoy?: Ymd }

export function datosDesdeSnapshot(snap: Snapshot, fuente: FuenteDatos, op: OpcionesDatos = {}, aviso?: string): DatosClientes {
  const hoy = op.hoy ?? hoyArgentina()
  const p = parsearHojas(snap.hojas)
  const pestanasAusentes = RANGOS_CRM.filter(r => r.opcional && r.clave !== 'config' && snap.hojas[r.clave] === null).map(r => r.pestana)
  return {
    hoy,
    clientes: derivarClientes(p.base, hoy, op),
    periodos: p.periodos,
    referidos: p.referidos,
    movimientos: p.movimientos,
    pestanasAusentes,
    columnas: p.columnas,
    fuente,
    snapshotEn: snap.guardadoEn,
    avisos: [...p.avisos, ...(aviso ? [aviso] : [])],
  }
}

// Punto de entrada para el servidor del dashboard
export async function leerClientes(op: OpcionesLectura & OpcionesDatos = {}): Promise<DatosClientes> {
  const { snap, fuente, aviso } = await obtenerHojas(op)
  return datosDesdeSnapshot(snap, fuente, op, aviso)
}

// ── Sondeo de fórmulas (una sola vez, solo para planificar altas) ─────────────────────────
// Lee la fila 2 de Agencia y de Renovaciones con FORMULA (UN batchGet, y solo si el snapshot todavía no
// las tiene) y guarda SOLO las celdas que son fórmulas (letra + encabezado → fórmula); los datos
// constantes de esas filas (nombre, teléfono…) se descartan.
export interface FormulasCRM { agencia: Record<string, string>; renovaciones: Record<string, string> }

export async function sondearFormulas(): Promise<FormulasCRM> {
  const snap = leerSnapshot()
  if (snap?.formulasAgencia && snap.formulasRenovaciones) return { agencia: snap.formulasAgencia, renovaciones: snap.formulasRenovaciones }
  const sheets = clienteSheets()
  lecturasHechas++
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: idPlanilla(), ranges: ["'Agencia'!A1:AF2", "'Renovaciones'!A1:L3"], valueRenderOption: 'FORMULA',
  })
  const soloFormulas = (filas: Fila[]): Record<string, string> => {
    const [header = [], ...datos] = filas
    const out: Record<string, string> = {}
    for (const f of datos) f.forEach((c, i) => {
      const k = `${letraColumna(i)} ${String(header[i] ?? '').trim()}`
      if (typeof c === 'string' && c.startsWith('=') && !(k in out)) out[k] = c
    })
    return out
  }
  const agencia = soloFormulas((res.data.valueRanges?.[0]?.values ?? []) as Fila[])
  const renovaciones = soloFormulas((res.data.valueRanges?.[1]?.values ?? []) as Fila[])
  if (snap) guardarSnapshot({ ...snap, formulasAgencia: agencia, formulasRenovaciones: renovaciones })
  return { agencia, renovaciones }
}
