// ── /api/clientes/wins: listar, crear, borrar y ver la captura (sin imports de Next: se prueba con node:test) ──────────────
// Permisos (especificación v1, 13/11/2026): ver los wins = quien ve la Cartera (sección 'clientes'); cargar o borrar = quien
// puede usar las acciones de la tarjeta (puedeHacerAcciones: los aprobadores por mail). Barreras, en orden: la regla de
// lib/auth/rutas.ts repetida (sesión de Google con Clientes), sesión, mismo origen en las escrituras, JSON chico, el cliente
// tiene que existir en el CRM de Agencia, datos validados (modelo.ts). La captura se sirve con el mismo permiso que la lista,
// sin caché compartida y con el tipo verificado por su firma.
import type { Ymd } from '../fechas'
import { filtrarWins, TOPE_CAPTURA_BYTES, validarWin, type TipoCaptura, type Win, type WinNuevo } from './modelo'

export interface DepsApiWins {
  exigirAcceso: (req: Request) => Response | null
  sesion: (req: Request) => { nombre: string; email: string } | null
  puedeEscribir: (email: string) => boolean
  mismoOrigen: (h: { get(n: string): string | null }) => boolean
  baseConfigurada: () => boolean
  hoy: () => Ymd
  /** El cliente existe en Agencia. null = no se pudo leer el CRM. */
  clienteExiste: (idCrm: string) => Promise<boolean | null>
  listar: (idCrm: string | null) => Promise<Win[]>
  crear: (w: WinNuevo, quien: string) => Promise<{ id: number; nuevo: boolean }>
  borrar: (id: number, quien: string) => Promise<boolean>
  captura: (id: number) => Promise<{ tipo: TipoCaptura; bytes: Uint8Array } | null>
}

const TOPE_BYTES = Math.ceil(TOPE_CAPTURA_BYTES / 3) * 4 + 20_000
const ID_CRM = /^[A-Za-z]\d{1,6}$/
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })
const quienDe = (s: { nombre: string; email: string }) => (s.nombre || s.email.split('@')[0] || 'Equipo').slice(0, 80)
const idWin = (x: string | null | undefined): number | null => (x && /^\d{1,15}$/.test(x) ? Number(x) : null)

/** GET ?cliente=A001&autorizado=si|no → { wins } (sin los bytes de las capturas). */
export async function atenderGetWins(req: Request, d: DepsApiWins): Promise<Response> {
  const rechazo = d.exigirAcceso(req)
  if (rechazo) return rechazo
  if (!d.sesion(req)) return json({ error: 'No autorizado' }, 401)
  if (!d.baseConfigurada()) return json({ error: 'Falta DATABASE_URL' }, 503)
  const p = new URL(req.url).searchParams
  const cliente = p.get('cliente')?.trim().toUpperCase() || null
  if (cliente && !ID_CRM.test(cliente)) return json({ error: 'Cliente inválido' }, 400)
  const a = p.get('autorizado')
  const autorizado = a === 'si' ? true : a === 'no' ? false : null
  try {
    return json({ wins: filtrarWins(await d.listar(cliente), { idCrm: cliente, autorizado }) })
  } catch {
    return json({ error: 'No se pudieron leer los wins. Probá de nuevo en un minuto.' }, 502)
  }
}

/** POST { clave, idCrm, fecha, texto, fuente, autorizado, captura?: { base64 } } → { ok, id }. */
export async function atenderPostWins(req: Request, d: DepsApiWins): Promise<Response> {
  const rechazo = d.exigirAcceso(req)
  if (rechazo) return rechazo
  const sesion = d.sesion(req)
  if (!sesion) return json({ error: 'No autorizado' }, 401)
  if (!d.mismoOrigen(req.headers)) return json({ error: 'Origen no permitido' }, 403)
  if (!d.puedeEscribir(sesion.email)) return json({ error: 'Cargar wins es de quienes usan las acciones de la tarjeta.' }, 403)
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'Se espera JSON' }, 415)
  const texto = await req.text()
  if (texto.length > TOPE_BYTES) return json({ error: 'La captura pesa demasiado (máximo 600 KB).' }, 413)
  let cuerpo: unknown
  try { cuerpo = JSON.parse(texto) } catch { return json({ error: 'JSON inválido' }, 400) }
  const v = validarWin(cuerpo, d.hoy())
  if (!v.ok) return json({ error: v.error }, 422)
  if (!d.baseConfigurada()) return json({ error: 'Falta DATABASE_URL' }, 503)
  const existe = await d.clienteExiste(v.win.idCrm).catch(() => null)
  if (existe === null) return json({ error: 'No se pudo leer el CRM para validar el cliente. Probá de nuevo en un minuto.' }, 503)
  if (!existe) return json({ error: 'Ese cliente no está en el CRM de Agencia.' }, 404)
  try {
    const r = await d.crear(v.win, quienDe(sesion))
    return json({ ok: true, id: r.id, nuevo: r.nuevo })
  } catch {
    return json({ error: 'No se pudo guardar el win. Probá de nuevo en un minuto.' }, 502)
  }
}

/** DELETE /api/clientes/wins/<id> → { ok }. */
export async function atenderDeleteWin(req: Request, id: string, d: DepsApiWins): Promise<Response> {
  const rechazo = d.exigirAcceso(req)
  if (rechazo) return rechazo
  const sesion = d.sesion(req)
  if (!sesion) return json({ error: 'No autorizado' }, 401)
  if (!d.mismoOrigen(req.headers)) return json({ error: 'Origen no permitido' }, 403)
  if (!d.puedeEscribir(sesion.email)) return json({ error: 'Borrar wins es de quienes usan las acciones de la tarjeta.' }, 403)
  const n = idWin(id)
  if (n === null) return json({ error: 'No encontrado' }, 404)
  if (!d.baseConfigurada()) return json({ error: 'Falta DATABASE_URL' }, 503)
  try {
    return (await d.borrar(n, quienDe(sesion))) ? json({ ok: true }) : json({ error: 'Ese win ya no existe.' }, 404)
  } catch {
    return json({ error: 'No se pudo borrar. Probá de nuevo en un minuto.' }, 502)
  }
}

/** GET /api/clientes/wins/<id>/captura → la imagen (solo con sesión de la Cartera; nunca pública ni en caché compartida). */
export async function atenderGetCaptura(req: Request, id: string, d: DepsApiWins): Promise<Response> {
  const rechazo = d.exigirAcceso(req)
  if (rechazo) return rechazo
  if (!d.sesion(req)) return json({ error: 'No autorizado' }, 401)
  const n = idWin(id)
  if (n === null || !d.baseConfigurada()) return json({ error: 'No encontrado' }, 404)
  try {
    const c = await d.captura(n)
    if (!c) return json({ error: 'No encontrado' }, 404)
    return new Response(new Uint8Array(c.bytes), {
      status: 200,
      headers: {
        'Content-Type': c.tipo, 'Content-Length': String(c.bytes.length), 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="win-${n}.${c.tipo.split('/')[1]}"`,
        'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
      },
    })
  } catch {
    return json({ error: 'No se pudo leer la captura.' }, 502)
  }
}
