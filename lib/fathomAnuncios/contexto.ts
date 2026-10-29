// ── Clientes conocidos para el extractor (best effort) ──────────────────────────────────────────
// Fathom puede transcribir mal un nombre: el CRM permite devolver el nombre canónico
// y su cuenta publicitaria. Fuentes de solo lectura, sin consultar Meta:
//   · CRM Clientes (SHEET_ID_CLIENTES), pestañas Agencia y Consultora, con el lector de lib/clientes/leer.ts
//     (snapshot de 10 min: casi nunca le pega a Sheets);
//   · pestaña "Cuentas Meta" del mismo CRM (col A cuenta, B cliente actual SI/NO, C nombre en el CRM) con el lector
//     del tablero de anuncios (lib/anuncios/sheets.ts) y por la MISMA caché del tablero: conCache('sheets',
//     REFRESCO.sheetsSeg) de lib/anuncios/cache.ts, igual que lib/anuncios/tablero.ts. Por qué esa y no un lector
//     propio de una sola pestaña: la caché es compartida entre instancias (Data Cache de Next) y el tablero la mantiene
//     caliente mientras Valentino lo tiene abierto, así que la mayoría de los webhooks no le piden NADA a Sheets; si
//     está vencida devuelve la anterior y refresca en segundo plano (una lectura que el tablero iba a hacer igual). Un
//     lector propio gastaría 1 lectura por webhook siempre. Una lectura incompleta no se cachea (se tira el error,
//     como en el tablero) y, si falla, se sigue sin cuentas;
//   · AJUSTES_CUENTA de lib/anuncios/cuentas.ts (cuenta → cliente cargado a mano).
// Tope de TOPE_MS en total: si el CRM falla o tarda se sigue con la lista vacía (estado 'sin_crm', queda en el
// registro) y los nombres salen como "(nombre sin verificar)". Si solo fallan las cuentas, van los clientes sin cuentas.
// Los lectores de Sheets se importan adentro de contextoCRM (import dinámico): así las funciones puras de acá se
// pueden usar y probar sin cargar googleapis.
import { cargarCuentas } from '@/lib/anuncios/cuentas'
import type { ClienteConocido, ContextoCRM } from './tipos'

export const TOPE_MS = 8_000
const MAX_CLIENTES = 400

/** Nombre comparable: minúsculas, sin acentos ni puntuación, espacios simples. */
export const normNombre = (x: string): string =>
  x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const ORDEN_ESTADO: Record<string, number> = { ACTIVO: 0, PAUSADO: 1 }
const vigente = (estado: string) => estado === 'ACTIVO' || estado === 'PAUSADO'

export interface FuentesContexto {
  clientes: { nombre: string; estado: string; mail: string }[]
  cuentasMeta: { cuenta: string; actual: boolean; clienteCRM: string }[]
  ajustes: Record<string, { cliente?: string }>
}

/** Arma la lista (pura): un cliente por nombre (gana la fila vigente), con sus cuentas; vigentes primero. */
export function armarClientesConocidos(f: FuentesContexto): ClienteConocido[] {
  const porNombre = new Map<string, ClienteConocido>()
  for (const c of f.clientes) {
    const nombre = c.nombre.replace(/\s+/g, ' ').trim()
    if (!nombre) continue
    const k = normNombre(nombre), estado = (c.estado || '').toUpperCase(), prev = porNombre.get(k)
    if (prev && !(vigente(estado) && !vigente(prev.estado))) {
      if (!prev.email && c.mail) prev.email = c.mail.trim()
      continue
    }
    porNombre.set(k, { nombre, estado, email: (c.mail || prev?.email || '').trim(), cuentas: prev?.cuentas ?? [] })
  }
  const sumarCuenta = (cliente: string, cuenta: string) => {
    const c = porNombre.get(normNombre(cliente)), cu = cuenta.replace(/\s+/g, ' ').trim()
    if (c && cu && !c.cuentas.includes(cu)) c.cuentas.push(cu)
  }
  for (const [cuenta, a] of Object.entries(f.ajustes)) if (a.cliente) sumarCuenta(a.cliente, cuenta)
  for (const fila of f.cuentasMeta) if (fila.actual && fila.clienteCRM) sumarCuenta(fila.clienteCRM, fila.cuenta)
  return [...porNombre.values()]
    .sort((a, b) => (ORDEN_ESTADO[a.estado] ?? 2) - (ORDEN_ESTADO[b.estado] ?? 2) || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, MAX_CLIENTES)
}

/** Una línea por cliente para el bloque <clientes_conocidos>: "Nombre | estado | email | cuentas act_…". */
export function lineasClientes(clientes: ClienteConocido[]): string {
  if (!clientes.length) return '(no disponible)'
  const limpio = (x: string) => x.replace(/[|\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
  return clientes
    .map(c => [limpio(c.nombre), c.estado || 'sin estado', limpio(c.email) || 'sin email', c.cuentas.length ? `cuentas ${c.cuentas.map(limpio).join(', ')}` : 'sin cuentas'].join(' | '))
    .join('\n')
}

const conTope = <T,>(p: Promise<T>, ms: number, que: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${que}: tardó más de ${ms / 1000} s`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })

/** "Cuentas Meta" desde la caché compartida del tablero de anuncios (misma clave y plazo que lib/anuncios/tablero.ts). */
async function cuentasMetaCacheadas(hoy: string): Promise<FuentesContexto['cuentasMeta']> {
  const [{ conCache }, { REFRESCO }, { leerSheets }] = await Promise.all([
    import('@/lib/anuncios/cache'), import('@/lib/anuncios/tablero'), import('@/lib/anuncios/sheets'),
  ])
  const r = await conCache('sheets', REFRESCO.sheetsSeg, async () => {
    const s = await leerSheets(hoy)
    if (s.errores.length) throw new Error(s.errores.join(' · '))   // no cachear una lectura incompleta
    return s
  })
  return r.data.cuentasMeta
}

/** Lee el CRM con tope de tiempo. Nunca lanza. */
export async function contextoCRM(topeMs: number = TOPE_MS): Promise<ContextoCRM> {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [crm, cuentas] = await Promise.allSettled([
    conTope(import('@/lib/clientes/leer').then(m => m.leerClientes()), topeMs, 'CRM Clientes'),
    conTope(cuentasMetaCacheadas(hoy), topeMs, 'Cuentas Meta'),
  ])
  if (crm.status === 'rejected') {
    const aviso = ((crm.reason as Error)?.message ?? 'error desconocido').slice(0, 200)
    console.error('fathom-anuncios: sin lista de clientes del CRM —', aviso)
    return { clientes: [], estado: 'sin_crm', aviso }
  }
  const cuentasMeta = cuentas.status === 'fulfilled' ? cuentas.value : []
  if (cuentas.status === 'rejected') console.error('fathom-anuncios: sin "Cuentas Meta" —', (cuentas.reason as Error)?.message)
  const clientes = armarClientesConocidos({ clientes: crm.value.clientes, cuentasMeta, ajustes: cargarCuentas().ajustes })
  return clientes.length ? { clientes, estado: 'ok' } : { clientes: [], estado: 'sin_crm', aviso: 'el CRM no devolvió clientes' }
}
