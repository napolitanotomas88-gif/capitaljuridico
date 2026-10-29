// ── Registro diario en el sheet de Ventas (para hacer seguimiento) ──────────
// Pestañas:
//   "Enrutamientos perdidos"  → completó el formulario de Calendly y NO agendó (+ canceladas)
//   "No-shows"                → tenía llamada y no se presentó
//   "Leads IG sin asignar"    → entró al DM y no llegó al setter (con @ de Instagram)
//   "Resumen enrutamiento"    → una fila por día con los números
// Cada día se escribe con una fila separadora "📅 DD/MM/YYYY" arriba de sus filas para que
// sea fácil separar por día. Idempotente por fecha (la marca es la fila del resumen).
import { google } from 'googleapis'

export interface FilaFormulario { fecha: string; nombre: string; telefono: string; email: string; formulario: string; detalle: string }
export interface FilaNoShow { fecha: string; hora: string; nombre: string; telefono: string; closer: string; agendo: string; detalle: string }
export interface FilaLeadIG { fecha: string; nombre: string; usuario: string }
export interface FilaResumen {
  fecha: string
  leadsIG: number; asignados: number; pctAsignados: string; noAsignados: number; formulariosSinAgendar: number
  agendasMaite: number; reservasCalendly: number; llamadas: number; presentadas: number
  noShows: number; sinRegistrar: number; cierres: number; pctAgendaSetterMes: string
}
export interface RegistroDia { formularios: FilaFormulario[]; noShows: FilaNoShow[]; leadsIG: FilaLeadIG[]; resumen: FilaResumen }

export const PESTANAS = {
  formularios: { nombre: 'Enrutamientos perdidos', header: ['Fecha', 'Nombre', 'Teléfono', 'Email', 'Formulario / ruta', 'Detalle', 'Seguimiento hecho', 'Notas'] },
  noShows: { nombre: 'No-shows', header: ['Fecha', 'Hora', 'Nombre', 'Teléfono', 'Closer', 'Quién agendó', 'Detalle', 'Seguimiento hecho', 'Notas'] },
  leadsIG: { nombre: 'Leads IG sin asignar', header: ['Fecha', 'Nombre', '@usuario', 'Link', 'Seguimiento hecho', 'Notas'] },
  resumen: { nombre: 'Resumen enrutamiento', header: ['Fecha', 'Leads IG', 'Asignados a Maite', '% asignados', 'No llegaron al setter', 'Formularios sin agendar', 'Agendas Maite (llamadas del día)', 'Reservas Calendly', 'Llamadas', 'Presentadas', 'No-shows', 'Sin registrar', 'Cierres', '% agenda setter (mes)'] },
}

function clienteEscritura() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!email || !key) return null
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return google.sheets({ version: 'v4', auth })
}

export const urlSheetEnrutamiento = () =>
  process.env.SHEET_ID_VENTAS ? `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID_VENTAS}` : ''

// La fecha puede volver como texto "DD/MM/YYYY", como "9/9/2026" (si alguien la convirtió a
// fecha) o como serial de Sheets → se normaliza antes de comparar.
const normFecha = (v: unknown): string => {
  if (typeof v === 'number') {
    const u = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-6) * 86_400_000)
    return `${String(u.getUTCDate()).padStart(2, '0')}/${String(u.getUTCMonth() + 1).padStart(2, '0')}/${u.getUTCFullYear()}`
  }
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : String(v ?? '').trim()
}

export async function registrarEnrutamiento(reg: RegistroDia): Promise<{ ok: boolean; filas: number; motivo?: string }> {
  const sheets = clienteEscritura()
  const id = process.env.SHEET_ID_VENTAS
  if (!sheets || !id) return { ok: false, filas: 0, motivo: 'sin credenciales de Sheets' }
  const r = reg.resumen
  const marca = `📅 ${r.fecha}`
  const sep = (n: number, que: string) => [marca, n ? `${n} ${que}` : `sin ${que}`]
  const anexar = async (pestana: string, rango: string, filas: unknown[][]) =>
    sheets.spreadsheets.values.append({ spreadsheetId: id, range: `'${pestana}'!${rango}`, valueInputOption: 'RAW', requestBody: { values: filas } })
  try {
    // Idempotencia POR PESTAÑA: la fila separadora "📅 fecha" es la marca en las listas y la fila de
    // datos en el resumen; si una corrida falló a mitad, la siguiente completa solo lo que falta.
    const colsA = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: id, valueRenderOption: 'UNFORMATTED_VALUE',
      ranges: [PESTANAS.formularios, PESTANAS.noShows, PESTANAS.leadsIG, PESTANAS.resumen].map(p => `'${p.nombre}'!A:A`),
    })
    const [aForm, aNoShow, aLeads, aRes] = (colsA.data.valueRanges ?? []).map(v => (v.values ?? []).map(x => String(x[0] ?? '').trim()))
    const yaEsta = (col: string[] | undefined) => (col ?? []).includes(marca)
    if ((aRes ?? []).some(v => normFecha(v) === r.fecha) && yaEsta(aForm) && yaEsta(aNoShow) && yaEsta(aLeads))
      return { ok: true, filas: 0, motivo: `el ${r.fecha} ya estaba registrado` }
    let filas = 0
    if (!yaEsta(aForm)) {
      await anexar(PESTANAS.formularios.nombre, 'A:H', [sep(reg.formularios.length, 'formularios sin agendar'),
        ...reg.formularios.map(f => [f.fecha, f.nombre, f.telefono, f.email, f.formulario, f.detalle, '', ''])])
      filas += reg.formularios.length
    }
    if (!yaEsta(aNoShow)) {
      await anexar(PESTANAS.noShows.nombre, 'A:I', [sep(reg.noShows.length, 'no-shows'),
        ...reg.noShows.map(n => [n.fecha, n.hora, n.nombre, n.telefono, n.closer, n.agendo, n.detalle, '', ''])])
      filas += reg.noShows.length
    }
    if (!yaEsta(aLeads)) {
      const sinId = r.noAsignados - reg.leadsIG.length
      await anexar(PESTANAS.leadsIG.nombre, 'A:F', [sep(r.noAsignados, 'leads sin asignar'),
        ...reg.leadsIG.map(l => [l.fecha, l.nombre, l.usuario ? `@${l.usuario}` : '', l.usuario ? `https://instagram.com/${l.usuario}` : '', '', '']),
        ...(sinId > 0 ? [[r.fecha, `${sinId} sin usuario de IG identificable (entraron antes de que ManyChat guardara el ID)`, '', '', '', '']] : [])])
      filas += reg.leadsIG.length
    }
    if (!(aRes ?? []).some(v => normFecha(v) === r.fecha)) {
      await anexar(PESTANAS.resumen.nombre, 'A:N', [[r.fecha, r.leadsIG, r.asignados, r.pctAsignados, r.noAsignados, r.formulariosSinAgendar, r.agendasMaite,
        r.reservasCalendly, r.llamadas, r.presentadas, r.noShows, r.sinRegistrar, r.cierres, r.pctAgendaSetterMes]])
      filas += 1
    }
    return { ok: true, filas }
  } catch (e) {
    return { ok: false, filas: 0, motivo: (e as Error).message }
  }
}
