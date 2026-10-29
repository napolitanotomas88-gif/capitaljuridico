// ── Google Sheets para el tablero de anuncios (solo lectura, service account) ───────────────
//   · CRM (SHEET_ID_CLIENTES): Agencia (A id, B nombre, C estado), "Cuentas Meta" (A cuenta o id,
//     B cliente actual SI/NO, C nombre en el CRM) y "Alias Guiones" (A alias, B nombre en el CRM).
//   · Guiones (sheet "Guiones y Videos"), pestaña "Guiones para realizar": A cliente ("Guiones - X"),
//     D día realizado, E grabación hecha (X / fecha / nota), F fecha de grabación.
// Ojo: los rangos arrancan en la fila 1 y se descarta el encabezado acá (slice(1)).
import { google } from 'googleapis'

export const SHEET_GUIONES = process.env.SHEET_ID_GUIONES?.trim() ?? ''

type Celda = string | number | boolean | null | undefined
type Fila = Celda[]

export interface ClienteCRM { nombre: string; estado: string }              // estado: ACTIVO | PAUSADO | FINALIZADO | INACTIVO
export interface FilaCuentaMeta { cuenta: string; actual: boolean; clienteCRM: string }
export interface FilaAlias { alias: string; cliente: string }
export interface FilaGuion { alias: string; diaRealizado: string | null; grabado: boolean; fechaGrabacion: string | null; nota: string | null }

export interface DatosSheets {
  clientes: ClienteCRM[]
  cuentasMeta: FilaCuentaMeta[]
  alias: FilaAlias[]
  guiones: FilaGuion[]
  errores: string[]
}

function auth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Faltan credenciales de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)')
  return new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
}

const txt = (c: Celda) => (c ?? '').toString().trim()

// Serial de Sheets (días desde 1899-12-30) → 'AAAA-MM-DD'
function serialAYmd(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000)
  return d.toISOString().slice(0, 10)
}

// Fecha de una celda del sheet de guiones: serial, "24/09", "31/8/2026", "18/09/26" o ISO
function fechaCelda(c: Celda, hoy: string): string | null {
  if (typeof c === 'number') return c > 40000 && c < 60000 ? serialAYmd(c) : null
  const t = txt(c)
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const m = t.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/)
  if (!m) return null
  const d = +m[1], mes = +m[2]
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null
  let y = m[3] ? +m[3] : +hoy.slice(0, 4)
  if (y < 100) y += 2000
  let f = `${y}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (!m[3] && f > hoy && (Date.parse(f) - Date.parse(hoy)) > 31 * 86_400_000) f = `${y - 1}${f.slice(4)}`   // sin año y muy en el futuro → año pasado
  return f
}

const MARCA_GRABADO = /^(x+|✓|✔|✔️|si|sí|ok|listo|hecho|grabado)\b/i

async function leerLote(sheets: ReturnType<typeof google.sheets>, id: string, rangos: string[], sinFormato: boolean): Promise<Fila[][]> {
  if (!id) throw new Error('Falta el ID del Sheet configurado');
  let ultimo: unknown
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: rangos, valueRenderOption: sinFormato ? 'UNFORMATTED_VALUE' : 'FORMATTED_VALUE' })
      return rangos.map((_, i) => ((r.data.valueRanges?.[i]?.values ?? []) as Fila[]).slice(1))
    } catch (e) {
      ultimo = e
      await new Promise(res => setTimeout(res, 1500))
    }
  }
  throw ultimo
}

export async function leerSheets(hoy: string): Promise<DatosSheets> {
  const sheets = google.sheets({ version: 'v4', auth: auth() })
  const CRM = process.env.SHEET_ID_CLIENTES ?? ''
  const errores: string[] = []
  const [crm, guiones] = await Promise.all([
    CRM
      ? leerLote(sheets, CRM, ['Agencia!A1:C400', "'Cuentas Meta'!A1:C300", "'Alias Guiones'!A1:B300"], false)
        .catch(e => { errores.push(`CRM: ${(e as Error).message}`); return [[], [], []] as Fila[][] })
      : Promise.resolve((errores.push('Falta SHEET_ID_CLIENTES'), [[], [], []] as Fila[][])),
    leerLote(sheets, SHEET_GUIONES, ["'Guiones para realizar'!A1:F1500"], true)
      .catch(e => { errores.push(`Guiones: ${(e as Error).message}`); return [[]] as Fila[][] }),
  ])
  const [agencia, cuentasMeta, alias] = crm
  return {
    clientes: agencia.filter(r => txt(r[0]) && txt(r[1])).map(r => ({ nombre: txt(r[1]), estado: txt(r[2]).toUpperCase() })),
    cuentasMeta: cuentasMeta.filter(r => txt(r[0])).map(r => ({ cuenta: txt(r[0]), actual: !txt(r[1]).toUpperCase().startsWith('N'), clienteCRM: txt(r[2]) })),
    alias: alias.filter(r => txt(r[0]) && txt(r[1])).map(r => ({ alias: txt(r[0]), cliente: txt(r[1]) })),
    guiones: guiones[0].map(r => {
      const a = txt(r[0]).replace(/^\s*guiones\s*-\s*/i, '').trim()
      if (!a) return null
      const e = typeof r[4] === 'number' ? '' : txt(r[4])
      const fechaE = typeof r[4] === 'number' ? fechaCelda(r[4], hoy) : (MARCA_GRABADO.test(e) || /^\d/.test(e) ? fechaCelda(e, hoy) : null)
      const fechaF = fechaCelda(r[5], hoy)
      // Fecha futura en E o F = grabación AGENDADA (todavía no grabado)
      const agendada = [fechaE, fechaF].find(f => f && f > hoy) ?? null
      const grabado = !agendada && (MARCA_GRABADO.test(e) || !!fechaE || !!fechaF)
      return {
        alias: a,
        diaRealizado: fechaCelda(r[3], hoy),
        grabado,
        fechaGrabacion: grabado ? (fechaF ?? fechaE) : null,
        nota: agendada ? `grabación agendada ${+agendada.slice(8, 10)}/${+agendada.slice(5, 7)}` : (!grabado && e ? e : null),
      }
    }).filter((g): g is FilaGuion => !!g),
    errores,
  }
}
