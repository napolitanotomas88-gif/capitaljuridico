// Pruebas y cambios de anuncios para revisar en una fecha (tests de público, conjuntos Winners/Charlie…), 8/11/2026.
// Vive en la pestaña «Ads Revisiones» de la planilla de Clientes (no en el repo: el repo es público y lleva nombres de clientes).
// Columnas: A inicio (aaaa-mm-dd) · B revisar (aaaa-mm-dd) · C cliente · D tipo · E qué se hizo · F qué mirar · G conjuntos · H estado (vacío = pendiente; «revisado» = se oculta)
import { diasEntre } from './formato'

export const TAB_REVISIONES = 'Ads Revisiones'

export interface Revision { fila: number; inicio: string; revisar: string; cliente: string; tipo: string; hecho: string; mirar: string; conjuntos: string; estado: string }
export interface LinkRevision { etiqueta: string; id: string; url: string | null }
export interface RevisionVista extends Revision { dia: number; total: number; faltan: number; vencida: boolean; hoyToca: boolean; links?: LinkRevision[] }

// Columna G: «Winners 1202… · Test A 1202… · Campaña 1202…» → etiqueta + ID de Meta (10/11/2026)
export function idsDeConjuntos(texto: string): { etiqueta: string; id: string; campana: boolean }[] {
  const out: { etiqueta: string; id: string; campana: boolean }[] = []
  for (const parte of texto.split(/\s*[·,]\s*/)) {
    const m = parte.match(/^(.*?)(\d{10,})\s*$/)
    if (!m) continue
    const etiqueta = m[1].trim() || 'Conjunto'
    out.push({ etiqueta, id: m[2], campana: /campa/i.test(etiqueta) })
  }
  return out
}

// Link al Administrador de anuncios: hace falta la cuenta (act=), sin ella Meta abre la última cuenta usada
export function linkAdministrador(id: string, cuenta: string | null, campana: boolean): string | null {
  if (!cuenta) return null
  const act = cuenta.replace(/^act_/, '')
  return campana
    ? `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${act}&selected_campaign_ids=${id}`
    : `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${act}&selected_adset_ids=${id}`
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function parsearRevisiones(valores: string[][]): Revision[] {
  return valores
    .map((r, i) => ({ fila: i + 2, inicio: (r[0] ?? '').trim(), revisar: (r[1] ?? '').trim(), cliente: (r[2] ?? '').trim(), tipo: (r[3] ?? '').trim(), hecho: (r[4] ?? '').trim(), mirar: (r[5] ?? '').trim(), conjuntos: (r[6] ?? '').trim(), estado: (r[7] ?? '').trim().toLowerCase() }))
    .filter(r => FECHA.test(r.inicio) && FECHA.test(r.revisar) && r.cliente)
}

// Día 1 = el día del cambio. Faltan = días hasta la fecha de revisión (0 = hoy toca, negativo = vencida).
export function vistaRevisiones(lista: Revision[], hoy: string): RevisionVista[] {
  return lista
    .filter(r => r.estado !== 'revisado')
    .map(r => {
      const total = Math.max(1, diasEntre(r.inicio, r.revisar))
      const faltan = diasEntre(hoy, r.revisar)
      return { ...r, dia: Math.max(1, diasEntre(r.inicio, hoy) + 1), total, faltan, vencida: faltan < 0, hoyToca: faltan === 0 }
    })
    .sort((a, b) => a.faltan - b.faltan || a.cliente.localeCompare(b.cliente))
}

export async function leerRevisiones(): Promise<Revision[]> {
  const { google } = await import('googleapis')
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key || !process.env.SHEET_ID_CLIENTES) throw new Error('Faltan credenciales para leer las revisiones')
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }) })
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID_CLIENTES, range: `'${TAB_REVISIONES}'!A2:H`, valueRenderOption: 'FORMATTED_VALUE' })
    return parsearRevisiones((r.data.values ?? []) as string[][])
  } catch (e) {
    if (/Unable to parse range/i.test((e as Error).message)) return [] // la pestaña todavía no existe
    throw e
  }
}

// Busca la cuenta publicitaria de cada ID (Graph ?ids=…&fields=account_id), con los tokens de clientes. Si falla, sin links.
export async function cuentasDeIds(ids: string[]): Promise<Record<string, string>> {
  const { tokensMeta } = await import('./token')
  const out: Record<string, string> = {}
  const pendientes = [...new Set(ids)]
  for (const { token } of tokensMeta()) {
    for (let i = 0; i < pendientes.length; i += 50) {
      const lote = pendientes.slice(i, i + 50).filter(id => !out[id])
      if (!lote.length) continue
      // de a uno si el lote falla entero (un ID sin permiso tira el pedido completo)
      const pedir = async (grupo: string[]) => {
        const u = new URL('https://graph.facebook.com/v23.0/')
        u.searchParams.set('ids', grupo.join(',')); u.searchParams.set('fields', 'account_id'); u.searchParams.set('access_token', token)
        const r = await fetch(u, { cache: 'no-store' }).catch(() => null)
        const j = r ? ((await r.json().catch(() => null)) as Record<string, unknown> | null) : null
        if (!j || 'error' in j) return false
        for (const [id, v] of Object.entries(j)) { const acc = (v as { account_id?: string } | null)?.account_id; if (acc) out[id] = `act_${acc}` }
        return true
      }
      if (!(await pedir(lote))) for (const id of lote) await pedir([id])
    }
  }
  return out
}

export async function conLinks(lista: RevisionVista[]): Promise<RevisionVista[]> {
  const partes = lista.map(r => idsDeConjuntos(r.conjuntos))
  let cuentas: Record<string, string> = {}
  try { cuentas = await cuentasDeIds(partes.flat().map(p => p.id)) } catch { /* sin links */ }
  return lista.map((r, i) => ({ ...r, links: partes[i].map(p => ({ etiqueta: p.etiqueta, id: p.id, url: linkAdministrador(p.id, cuentas[p.id] ?? null, p.campana) })) }))
}
