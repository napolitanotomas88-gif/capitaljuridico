// ── Llamadas de closers para revisar todos los días ──────────────────────────────────────────────────────────────────
// Trae de la API de Fathom de CADA closer (clavesFathom: FATHOM_API_KEYS + FATHOM_API_KEY_<CLOSER>) sus reuniones con
// gente de afuera, las guarda en cj_closer_llamadas y les arma una revisión en español con Claude (por el puente a la Mac
// si CLAUDE_VIA=mac): qué pasó, precio, objeciones y momentos con el minuto. La revisión DESCRIBE, no califica al closer:
// el análisis lo hace Tomás, que marca cada llamada como revisada y deja su nota. Solo servidor.
import 'server-only'
import { neon } from '@neondatabase/serverless'
import { formatearTranscripcion } from '@/lib/fathomAnuncios/transcripcion'
import type { RenglonFathom } from '@/lib/fathomAnuncios/tipos'
import { claudeJSON } from './analisis'
import { clavesFathom } from './fathom'
import { llamadaDeApi, type InvitadoLlamada, type LlamadaCloser } from './llamadasCloserCalc'

const BASE = 'https://api.fathom.ai/external/v1'
function sql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('La base de datos todavía no está conectada (DATABASE_URL).')
  return neon(url)
}

let lista: Promise<void> | null = null
function asegurarTabla(): Promise<void> {
  lista ??= (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS cj_closer_llamadas (
      recording_id bigint PRIMARY KEY,
      closer text NOT NULL,
      titulo text NOT NULL DEFAULT '',
      inicio timestamptz,
      duracion_s int,
      url text NOT NULL DEFAULT '',
      invitados jsonb NOT NULL DEFAULT '[]',
      externa boolean NOT NULL DEFAULT true,
      resumen_fathom text NOT NULL DEFAULT '',
      revision jsonb,
      revision_error text,
      revisada boolean NOT NULL DEFAULT false,
      nota text NOT NULL DEFAULT '',
      revisada_por text NOT NULL DEFAULT '',
      revisada_en timestamptz,
      creado timestamptz NOT NULL DEFAULT now(),
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await sql()`CREATE INDEX IF NOT EXISTS cj_closer_llamadas_inicio ON cj_closer_llamadas (inicio DESC)`
  })().catch((e) => {
    lista = null
    throw e
  })
  return lista
}

// Fathom limita las consultas por clave (429): se espera lo que pide Retry-After (o 5, 10 y 20 s) y se reintenta 3 veces.
// La misma clave la usa el cruce de cierres de Trazabilidad, así que pueden coincidir.
async function pedir(clave: string, ruta: string): Promise<unknown> {
  for (let intento = 0; ; intento++) {
    const r = await fetch(`${BASE}${ruta}`, { headers: { 'X-Api-Key': clave, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    if (r.status === 429 && intento < 3) {
      const espera = Math.min(30, Number(r.headers.get('retry-after')) || 5 * 2 ** intento)
      await new Promise((ok) => setTimeout(ok, espera * 1000))
      continue
    }
    if (r.status === 429) throw new Error('Fathom: demasiadas consultas (429), probar más tarde')
    if (!r.ok) throw new Error(`Fathom respondió ${r.status}`)
    return r.json()
  }
}

// ── Revisión en español ───────────────────────────────────────────────────────────────────────────────────────────
export interface RevisionLlamada {
  tipo: 'venta' | 'seguimiento' | 'onboarding' | 'interna' | 'otra'
  resultado: 'cerro' | 'sena' | 'seguimiento' | 'no_califica' | 'no_se_presento' | 'reagenda' | 'sin_definir'
  resumen: string
  precio_presentado: boolean
  monto_mencionado: string | null
  lead: { nombre: string | null; situacion: string | null; dolor: string | null; objetivo: string | null }
  objeciones: { minuto: string; objecion: string; cita: string; respuesta: string }[]
  momentos: { minuto: string; que_paso: string; por_que_mirarlo: string }[]
  proximos_pasos: string | null
}
const T = { type: ['string', 'null'] }
const MINUTO = { type: 'string', description: 'HH:MM:SS tal como figura en la transcripción' }
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tipo', 'resultado', 'resumen', 'precio_presentado', 'monto_mencionado', 'lead', 'objeciones', 'momentos', 'proximos_pasos'],
  properties: {
    tipo: { type: 'string', enum: ['venta', 'seguimiento', 'onboarding', 'interna', 'otra'] },
    resultado: { type: 'string', enum: ['cerro', 'sena', 'seguimiento', 'no_califica', 'no_se_presento', 'reagenda', 'sin_definir'] },
    resumen: { type: 'string' }, precio_presentado: { type: 'boolean' }, monto_mencionado: T,
    lead: { type: 'object', additionalProperties: false, required: ['nombre', 'situacion', 'dolor', 'objetivo'], properties: { nombre: T, situacion: T, dolor: T, objetivo: T } },
    objeciones: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['minuto', 'objecion', 'cita', 'respuesta'], properties: { minuto: MINUTO, objecion: { type: 'string' }, cita: { type: 'string' }, respuesta: { type: 'string' } } } },
    momentos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['minuto', 'que_paso', 'por_que_mirarlo'], properties: { minuto: MINUTO, que_paso: { type: 'string' }, por_que_mirarlo: { type: 'string' } } } },
    proximos_pasos: T,
  },
}
const SISTEMA = `Sos asistente de revisión de llamadas de venta de Capital Jurídico (programa para abogados). Recibís la transcripción de una llamada de un closer con un lead (renglones "[HH:MM:SS] Nombre: texto") y el resumen automático de Fathom. Escribí en español rioplatense, con voseo, claro y corto.

Reglas:
- DESCRIBÍ lo que pasó; no califiques al closer ni des puntajes. Tomás hace el análisis.
- "lead.nombre": nombre y apellido del lead como se presenta en la llamada (o como lo llama el closer); null si no se sabe.
- "resumen": 3 a 5 líneas: quién es el lead, qué quiere, cómo terminó la llamada.
- "resultado": cómo terminó según lo que se dice en la llamada (cerro = pagó o confirmó pago; sena = dejó seña o fee; seguimiento = quedó para otra llamada o decisión; no_califica; no_se_presento; reagenda; sin_definir).
- "objeciones": cada objeción del lead con el minuto exacto (copiado de la transcripción), la frase textual corta y qué respondió el closer (descriptivo).
- "momentos": 3 a 6 momentos que conviene mirar en la grabación (presentación del precio, objeción fuerte, silencio, cierre, cambio de tono), con el minuto exacto y por qué conviene mirarlo, en una línea.
- Si no es una llamada de venta (interna, onboarding de cliente), marcá el tipo y dejá listas vacías.`

export async function revisarLlamada(recordingId: number): Promise<void> {
  await asegurarTabla()
  const f = (await sql()`SELECT * FROM cj_closer_llamadas WHERE recording_id = ${recordingId}`)[0]
  if (!f) throw new Error('No existe esa llamada')
  const clave = clavesFathom().find((k) => k.nombre === f.closer)?.clave
  try {
    if (!clave) throw new Error(`no hay clave de Fathom para ${f.closer}`)
    const t = (await pedir(clave, `/recordings/${recordingId}/transcript`).catch(() => null)) as { transcript?: RenglonFathom[] } | null
    const texto = formatearTranscripcion(t?.transcript ?? null).texto
    if (!texto && !f.resumen_fathom) throw new Error('Fathom no devolvió transcripción ni resumen')
    const r = await claudeJSON<RevisionLlamada>(SISTEMA, `Closer: ${f.closer}\nTítulo: ${f.titulo}\n\n=== RESUMEN DE FATHOM ===\n${f.resumen_fathom || '(sin resumen)'}\n\n=== TRANSCRIPCIÓN ===\n${texto ? texto.slice(0, 400_000) : '(no disponible)'}`, SCHEMA)
    await sql()`UPDATE cj_closer_llamadas SET revision = ${JSON.stringify(r)}::jsonb, revision_error = NULL, actualizado = now() WHERE recording_id = ${recordingId}`
  } catch (e) {
    await sql()`UPDATE cj_closer_llamadas SET revision_error = ${String((e as Error).message ?? e).slice(0, 300)}, actualizado = now() WHERE recording_id = ${recordingId}`
    throw e
  }
}

// ── Sincronizar y procesar ───────────────────────────────────────────────────────────────────────────────────────
/** Trae de cada cuenta las reuniones de los últimos `dias` días. No pisa la marca de revisada, la nota ni la revisión. */
export async function sincronizar(dias = 3): Promise<{ cuentas: string[]; nuevas: number; total: number; errores: string[] }> {
  await asegurarTabla()
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const errores: string[] = []
  let nuevas = 0, total = 0
  const cuentas = clavesFathom()
  for (const k of cuentas) {
    try {
      let cursor: string | null = null
      for (let pagina = 0; pagina < 20; pagina++) {
        const q = new URLSearchParams({ created_after: desde, include_summary: 'true' })
        if (cursor) q.set('cursor', cursor)
        const d = (await pedir(k.clave, `/meetings?${q}`)) as { items?: Record<string, unknown>[]; next_cursor?: string | null }
        for (const m of d.items ?? []) {
          const l = llamadaDeApi(m, k.nombre)
          if (!Number.isFinite(l.recordingId)) continue
          if (!l.resumenFathom) {
            const s = (await pedir(k.clave, `/recordings/${l.recordingId}/summary`).catch(() => null)) as { summary?: { markdown_formatted?: string | null } } | null
            l.resumenFathom = s?.summary?.markdown_formatted ?? ''
          }
          const r = await sql()`INSERT INTO cj_closer_llamadas (recording_id, closer, titulo, inicio, duracion_s, url, invitados, externa, resumen_fathom)
            VALUES (${l.recordingId}, ${l.closer}, ${l.titulo}, ${l.inicio}, ${l.duracionS}, ${l.url}, ${JSON.stringify(l.invitados)}::jsonb, ${l.externa}, ${l.resumenFathom})
            ON CONFLICT (recording_id) DO UPDATE SET titulo = EXCLUDED.titulo, inicio = EXCLUDED.inicio, duracion_s = EXCLUDED.duracion_s, url = EXCLUDED.url,
              invitados = EXCLUDED.invitados, externa = EXCLUDED.externa,
              resumen_fathom = CASE WHEN EXCLUDED.resumen_fathom <> '' THEN EXCLUDED.resumen_fathom ELSE cj_closer_llamadas.resumen_fathom END, actualizado = now()
            RETURNING (xmax = 0) AS nueva`
          total++
          if (r[0]?.nueva) nuevas++
        }
        cursor = d.next_cursor ?? null
        if (!cursor) break
      }
    } catch (e) {
      errores.push(`${k.nombre}: ${(e as Error).message}`)
    }
  }
  return { cuentas: cuentas.map((k) => k.nombre), nuevas, total, errores }
}

/** Arma la revisión de las llamadas externas que todavía no la tienen (las que fallaron se reintentan a las 20 h) */
export async function revisarPendientes(tope = 6): Promise<{ revisadas: number; errores: string[] }> {
  await asegurarTabla()
  const pend = await sql()`SELECT recording_id FROM cj_closer_llamadas WHERE externa AND revision IS NULL
    AND (revision_error IS NULL OR actualizado < now() - interval '20 hours') AND coalesce(duracion_s, 0) >= 120
    ORDER BY inicio DESC NULLS LAST LIMIT ${tope}`
  let revisadas = 0
  const errores: string[] = []
  for (const p of pend) {
    try {
      await revisarLlamada(Number(p.recording_id))
      revisadas++
    } catch (e) {
      errores.push(`${p.recording_id}: ${(e as Error).message}`)
    }
  }
  return { revisadas, errores }
}

// ── Lectura y marcas ────────────────────────────────────────────────────────────────────────────────────────────
export interface FilaLlamadaCloser extends LlamadaCloser { revision: RevisionLlamada | null; revisionError: string | null; revisada: boolean; nota: string; revisadaPor: string; revisadaEn: string | null }
const isoDe = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

export async function listarLlamadas(desdeISO: string): Promise<FilaLlamadaCloser[]> {
  await asegurarTabla()
  const filas = await sql()`SELECT * FROM cj_closer_llamadas WHERE inicio >= ${desdeISO} ORDER BY inicio DESC LIMIT 400`
  return filas.map((r) => ({
    recordingId: Number(r.recording_id), closer: String(r.closer), titulo: String(r.titulo ?? ''), inicio: isoDe(r.inicio), duracionS: r.duracion_s == null ? null : Number(r.duracion_s),
    url: String(r.url ?? ''), invitados: (r.invitados as InvitadoLlamada[]) ?? [], externa: !!r.externa, resumenFathom: String(r.resumen_fathom ?? ''),
    revision: (r.revision as RevisionLlamada | null) ?? null, revisionError: (r.revision_error as string | null) ?? null,
    revisada: !!r.revisada, nota: String(r.nota ?? ''), revisadaPor: String(r.revisada_por ?? ''), revisadaEn: isoDe(r.revisada_en),
  }))
}

export async function marcarLlamada(recordingId: number, revisada: boolean, nota: string, por: string): Promise<void> {
  await asegurarTabla()
  await sql()`UPDATE cj_closer_llamadas SET revisada = ${revisada}, nota = ${nota.slice(0, 4000)}, revisada_por = ${revisada ? por : ''},
    revisada_en = ${revisada ? new Date().toISOString() : null}, actualizado = now() WHERE recording_id = ${recordingId}`
}
