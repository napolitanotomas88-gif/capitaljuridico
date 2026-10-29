// ── Bot "Capital Jurídico": etapa BAJA — pausar las campañas activas del cliente en Meta (ronda 2, Tomás 25/10/2026) ──────
// SOLO PAUSA (status PAUSED): nunca borra, nunca cambia presupuestos ni anuncios. Y solo con la baja confirmada Y un OK aparte
// en Verificaciones C.J con la lista de campañas (nucleo.ts). Después de pausar, RELEE cada campaña y verifica que quedó PAUSED.
// Qué cuentas son del cliente: el MISMO cruce del tablero de anuncios, con sus helpers de LECTURA (no se toca lib/anuncios,
// acordado con la sesión "Bot C.J. · Anuncios" el 25/10): descubrirCuentas() + leerSheets() + crearCruce().resolverCliente().
// Token (dato de la sesión Anuncios, 25/10): META_ANUNCIOS_TOKEN, el token de usuario de Gero A en la app dashboard-skwd (ve
// las 124 cuentas, tiene ads_management, vence el 24/12/2026). El usuario del sistema de META_ADS_WRITE_TOKEN NO ve cuentas de
// clientes: no se usa. Sin token, o si Meta dice que venció (código 190) o que no hay permiso, FALLA CERRADO: no pausa nada y
// lo avisa en Verificaciones. El token va en la cabecera Authorization, nunca en la URL ni en un log.
// Fetch inyectable: los tests nunca llaman a Meta.
import type { CampanaPausable } from './textos'

export const GRAPH_BAJAS = 'https://graph.facebook.com/v23.0'
export const TOPE_META_MS = 15_000
const MAX_CAMPANAS = 50

export interface CuentaCliente { id: string; nombre: string }
export interface LecturaCampanas { campanas: CampanaPausable[]; errores: string[]; tokenCaido: boolean }
export interface ResultadoPausa { pausadas: string[]; fallidas: { id: string; motivo: string }[]; tokenCaido: boolean }

export interface MetaBajas {
  /** Campañas con effective_status ACTIVE de las cuentas del cliente (solo lectura). */
  campanasActivas(cliente: string): Promise<LecturaCampanas>
  /** Pausa esas campañas (status PAUSED) y verifica cada una. Si el token cae, corta y no sigue. */
  pausar(ids: string[]): Promise<ResultadoPausa>
}

type Resp = { ok: true; json: Record<string, unknown> } | { ok: false; motivo: string; tokenCaido: boolean }

/** Error de Meta → motivo corto y si es del token (190 = vencido o inválido; 200/10 = sin permiso para esa cuenta). */
export function leerErrorMeta(json: unknown, status: number): { motivo: string; tokenCaido: boolean } {
  const e = (json as { error?: { code?: number; error_subcode?: number; message?: string } } | null)?.error
  const code = e?.code
  const tokenCaido = code === 190 || code === 102 || code === 200 || code === 10 || (code === 100 && e?.error_subcode === 33)
  const msg = String(e?.message ?? `HTTP ${status}`).replace(/access_token=[^&\s]+/gi, 'access_token=[oculto]').slice(0, 160)
  return { motivo: `${code ? `#${code} ` : ''}${msg}`, tokenCaido }
}

export interface OpcionesMetaBajas {
  token: string | null
  cuentasDelCliente: (cliente: string) => Promise<CuentaCliente[]>
  fetch?: typeof fetch
}

export function crearMetaBajas(op: OpcionesMetaBajas): MetaBajas {
  const f = op.fetch ?? ((u, i) => fetch(u, i))
  async function pedir(ruta: string, init: { metodo?: 'GET' | 'POST'; cuerpo?: Record<string, string> } = {}): Promise<Resp> {
    if (!op.token) return { ok: false, motivo: 'falta META_ANUNCIOS_TOKEN', tokenCaido: true }
    let r: Response
    try {
      r = await f(`${GRAPH_BAJAS}${ruta}`, {
        method: init.metodo ?? 'GET',
        headers: { authorization: `Bearer ${op.token}`, ...(init.cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: init.cuerpo ? new URLSearchParams(init.cuerpo).toString() : undefined,
        signal: AbortSignal.timeout(TOPE_META_MS), cache: 'no-store',
      })
    } catch (e) {
      return { ok: false, motivo: `Meta no respondió (${String((e as Error)?.name ?? 'error')})`, tokenCaido: false }
    }
    const json = (await r.json().catch(() => null)) as Record<string, unknown> | null
    if (!r.ok || !json || json.error) return { ok: false, ...leerErrorMeta(json, r.status) }
    return { ok: true, json }
  }

  return {
    async campanasActivas(cliente) {
      const out: LecturaCampanas = { campanas: [], errores: [], tokenCaido: false }
      if (!op.token) return { ...out, errores: ['falta META_ANUNCIOS_TOKEN'], tokenCaido: true }
      let cuentas: CuentaCliente[]
      try { cuentas = await op.cuentasDelCliente(cliente) } catch (e) { return { ...out, errores: [`no se pudieron cruzar las cuentas (${String((e as Error)?.message ?? e).slice(0, 120)})`] } }
      for (const c of cuentas) {
        const filtro = encodeURIComponent(JSON.stringify(['ACTIVE']))
        const r = await pedir(`/${encodeURIComponent(c.id)}/campaigns?fields=id,name,status,effective_status&effective_status=${filtro}&limit=${MAX_CAMPANAS}`)
        if (!r.ok) { out.errores.push(`${c.nombre}: ${r.motivo}`); if (r.tokenCaido) { out.tokenCaido = true; break } continue }
        for (const x of (r.json.data as { id?: string; name?: string; effective_status?: string }[] | undefined) ?? []) {
          if (typeof x.id === 'string' && x.effective_status === 'ACTIVE') out.campanas.push({ id: x.id, nombre: x.name ?? x.id, cuenta: c.id, cuentaNombre: c.nombre })
        }
      }
      return out
    },
    async pausar(ids) {
      const res: ResultadoPausa = { pausadas: [], fallidas: [], tokenCaido: false }
      for (const id of [...new Set(ids)].filter((x) => /^\d{5,25}$/.test(x))) {
        if (res.tokenCaido) { res.fallidas.push({ id, motivo: 'no se intentó (el token cayó)' }); continue }
        const w = await pedir(`/${id}`, { metodo: 'POST', cuerpo: { status: 'PAUSED' } })
        if (!w.ok) { res.fallidas.push({ id, motivo: w.motivo }); if (w.tokenCaido) res.tokenCaido = true; continue }
        // Verificación: se relee el estado (status es lo que pidió el bot; effective_status puede tardar)
        const v = await pedir(`/${id}?fields=status,effective_status`)
        if (v.ok && v.json.status === 'PAUSED') res.pausadas.push(id)
        else res.fallidas.push({ id, motivo: v.ok ? `quedó ${String(v.json.status)}` : `no se pudo verificar (${v.motivo})` })
      }
      return res
    },
  }
}
