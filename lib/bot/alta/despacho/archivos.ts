// ── Bot "Capital Jurídico": comprobantes subidos en el Despacho (26/10/2026) ────────────────────────────────────────────
// En WhatsApp el comprobante lo guarda Whapi y el motor lo baja con GET /media/{id}. Desde el Despacho no hay Whapi: el
// archivo se guarda en Neon (tabla cj_altas_archivos, misma base que cj_altas) y el motor lo lee con el MISMO
// ClienteWhapi.descargarMedio, envuelto (clienteConArchivosDespacho): un id "despacho-arch-…" sale de la tabla y nunca va a
// Whapi. El resto pasa igual al cliente de adentro. Además, una cita a un mensaje del Despacho ("despacho-…") no existe en
// WhatsApp: si el canal es 'ambos' y el pedido sale por Ventas, sale sin citar.
// La tabla se crea sola en la primera escritura (CREATE TABLE IF NOT EXISTS, nunca DROP). Los archivos se purgan a los 90
// días junto con el texto del alta (no hay purga propia: queda anotado en docs/BOT-ALTA-CJ.md). Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { ErrorWhapi } from '../../whapi/errores'
import type { ClienteWhapi, MedioDescargado, RefMedio } from '../motor/tipos'
import { PREFIJO_ID, esIdArchivoDespacho, type ArchivoGuardable } from './evento'

export interface AlmacenArchivos {
  guardar(archivos: readonly ArchivoGuardable[]): Promise<void>
  leer(id: string): Promise<MedioDescargado | null>
}

/** En memoria (tests y vista previa). */
export function archivosEnMemoria(): AlmacenArchivos & { lista(): string[] } {
  const m = new Map<string, ArchivoGuardable>()
  return {
    async guardar(xs) { for (const a of xs) if (!m.has(a.id)) m.set(a.id, a) },
    async leer(id) { const a = m.get(id); return a ? { base64: a.base64, mime: a.mime, nombre: a.nombre, bytes: a.bytes, sha256: a.sha256 } : null },
    lista: () => [...m.keys()],
  }
}

type Sql = NeonQueryFunction<false, false>
let crearSql: (url: string) => Sql = (url) => neon(url, { fetchOptions: { signal: AbortSignal.timeout(15_000) } })
/** Solo para los tests. */
export function sqlArchivosParaPruebas(f: ((url: string) => Sql) | null): void {
  crearSql = f ?? ((url) => neon(url, { fetchOptions: { signal: AbortSignal.timeout(15_000) } }))
  tabla = null
}
let tabla: Promise<unknown> | null = null

/** cj_altas_archivos en Neon (DATABASE_URL). */
export function archivosNeon(env: NodeJS.ProcessEnv = process.env): AlmacenArchivos {
  const sql = () => {
    const url = env.DATABASE_URL?.trim()
    if (!url) throw new Error('falta DATABASE_URL')
    return crearSql(url)
  }
  return {
    async guardar(xs) {
      if (!xs.length) return
      const q = sql()
      tabla ??= q`CREATE TABLE IF NOT EXISTS cj_altas_archivos (
        id text PRIMARY KEY, sha256 text NOT NULL, mime text NOT NULL, nombre text NOT NULL, bytes integer NOT NULL,
        datos text NOT NULL, creado timestamptz NOT NULL DEFAULT now())`.catch((e) => { tabla = null; throw e })
      await tabla
      for (const a of xs) {
        await q`INSERT INTO cj_altas_archivos (id, sha256, mime, nombre, bytes, datos) VALUES (${a.id}, ${a.sha256}, ${a.mime}, ${a.nombre}, ${a.bytes}, ${a.base64})
          ON CONFLICT (id) DO NOTHING`
      }
    },
    async leer(id) {
      try {
        const r = await sql()`SELECT sha256, mime, nombre, bytes, datos FROM cj_altas_archivos WHERE id = ${id}`
        if (!r.length) return null
        const f = r[0] as { sha256: string; mime: string; nombre: string; bytes: number; datos: string }
        return { base64: f.datos, mime: f.mime, nombre: f.nombre, bytes: Number(f.bytes), sha256: f.sha256 }
      } catch (e) {
        if ((e as { code?: string })?.code === '42P01') return null
        throw e
      }
    },
  }
}

/** El ClienteWhapi del motor, con los comprobantes del Despacho y sin citas a mensajes del Despacho. */
export function clienteConArchivosDespacho(interno: ClienteWhapi, archivos: () => AlmacenArchivos): ClienteWhapi {
  const sinCitaDespacho = (c: string | null | undefined) => (c && c.startsWith(PREFIJO_ID) ? null : c ?? null)
  return {
    ...interno,
    get modo() { return interno.modo },
    enviarTexto: (p) => interno.enviarTexto({ ...p, citar: sinCitaDespacho(p.citar) }),
    enviarVideo: (p) => interno.enviarVideo({ ...p, citar: sinCitaDespacho(p.citar) }),
    async descargarMedio(m: RefMedio, op?: { maxBytes?: number; hasta?: number }): Promise<MedioDescargado> {
      if (!esIdArchivoDespacho(m?.id)) return interno.descargarMedio(m, op)
      // Mismo criterio que la compuerta: en seco no se lee nada (tampoco lo propio)
      if (interno.modo === 'seco') throw new ErrorWhapi('bloqueado', 'Despacho: en modo seco no se lee el comprobante', null, false)
      let a: MedioDescargado | null
      try { a = await archivos().leer(m.id) } catch (e) { throw new ErrorWhapi('pasajero', `Despacho: no se pudo leer el comprobante (${String((e as Error)?.message ?? e).slice(0, 80)})`, null, false) }
      if (!a) throw new ErrorWhapi('no_encontrado', 'Despacho: el comprobante ya no está guardado', 404, false)
      if (op?.maxBytes && a.bytes > op.maxBytes) throw new ErrorWhapi('rechazo', 'Despacho: el comprobante pesa más de lo permitido', 413, false)
      return a
    },
    registro: () => interno.registro(),
  }
}
