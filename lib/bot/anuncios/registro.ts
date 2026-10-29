// ── Registro de avisos de seguimiento (Neon, tabla cj_anuncios_avisos) ──────────────────────────────
// Una fila por aviso (clave = tipo:campaña:fecha del ciclo, ver seguimiento.ts): se reclama ANTES de mandar
// (INSERT … ON CONFLICT DO NOTHING), así cada aviso sale una sola vez aunque el cron corra dos veces o a la vez.
//   · enviando → enviado (con el id de Discord);
//   · Discord lo rechazó (400/404: el webhook está mal) → se suelta la fila (DELETE): sale en la próxima corrida si
//     todavía está en su ventana;
//   · Discord no confirmó (timeout, 5xx, corte) → "dudoso": puede haber salido, no se repite solo.
// Guarda también el texto para el cliente (cliente_estado = pendiente_whapi): cuando el bot tenga WhatsApp, sale de acá.
// Misma base que el resto del Despacho (DATABASE_URL). La tabla se crea sola. Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

export const TOPE_CONSULTA_MS = 10_000
type Sql = NeonQueryFunction<false, false>

let fabricaSql: ((url: string) => Sql) | null = null
/** Solo para tests: un Neon falso (null vuelve al real). */
export function sqlParaPruebas(f: ((url: string) => Sql) | null): void { fabricaSql = f; tablaLista = null }

async function consulta<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = fabricaSql ? fabricaSql(url) : neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
  let t: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, rechazar) => { t = setTimeout(() => rechazar(new Error(`la base no respondió en ${TOPE_CONSULTA_MS / 1000} s (${que})`)), TOPE_CONSULTA_MS) })
  try {
    return await Promise.race([fn(q), tope])
  } finally {
    clearTimeout(t)
  }
}

let tablaLista: Promise<void> | null = null
function asegurarTabla(): Promise<void> {
  tablaLista ??= consulta('crear tabla', async q => {
    await q`CREATE TABLE IF NOT EXISTS cj_anuncios_avisos (
      clave text PRIMARY KEY,
      tipo text NOT NULL,
      cuenta text,
      campana_id text,
      cliente text,
      estado text NOT NULL,
      mensaje_id text,
      texto_cliente text,
      cliente_estado text,
      creado timestamptz NOT NULL DEFAULT now(),
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
  }).catch(e => { tablaLista = null; throw e })
  return tablaLista
}

export interface DatosAviso { tipo: string; cuenta: string; campana_id: string; cliente: string; texto_cliente: string | null }

/** true si esta corrida se quedó con el aviso (nadie lo había mandado ni lo está mandando). */
export async function reclamarAviso(clave: string, d: DatosAviso): Promise<boolean> {
  await asegurarTabla()
  const filas = await consulta('reclamar aviso', q => q`INSERT INTO cj_anuncios_avisos (clave, tipo, cuenta, campana_id, cliente, estado, texto_cliente, cliente_estado)
    VALUES (${clave}, ${d.tipo}, ${d.cuenta}, ${d.campana_id}, ${d.cliente}, 'enviando', ${d.texto_cliente}, ${d.texto_cliente ? 'pendiente_whapi' : null})
    ON CONFLICT (clave) DO NOTHING RETURNING clave`)
  return filas.length === 1
}

export async function marcarAvisoEnviado(clave: string, mensajeId: string): Promise<void> {
  await consulta('aviso enviado', q => q`UPDATE cj_anuncios_avisos SET estado = 'enviado', mensaje_id = ${mensajeId}, actualizado = now() WHERE clave = ${clave}`)
}

/** El texto le llegó al cliente por WhatsApp (grupo y id del mensaje). */
export async function anotarWhatsapp(clave: string, grupoId: string, mensajeId: string | null): Promise<void> {
  await consulta('aviso whatsapp', q => q`UPDATE cj_anuncios_avisos SET cliente_estado = ${`whatsapp:${grupoId}:${mensajeId ?? ''}`}, actualizado = now() WHERE clave = ${clave}`)
}

export async function marcarAvisoDudoso(clave: string): Promise<void> {
  await consulta('aviso dudoso', q => q`UPDATE cj_anuncios_avisos SET estado = 'dudoso', actualizado = now() WHERE clave = ${clave}`)
}

/** Discord lo rechazó: se suelta para que salga en la próxima corrida. Solo una fila que sigue "enviando". */
export async function soltarAviso(clave: string): Promise<void> {
  await consulta('soltar aviso', q => q`DELETE FROM cj_anuncios_avisos WHERE clave = ${clave} AND estado = 'enviando'`)
}

/** Los que ya salieron (para el modo de prueba: no crea la tabla; si todavía no existe, ninguno). */
export async function avisosRegistrados(claves: string[]): Promise<Set<string>> {
  if (!claves.length) return new Set()
  try {
    const filas = await consulta('leer avisos', q => q`SELECT clave FROM cj_anuncios_avisos WHERE clave = ANY(${claves})`)
    return new Set(filas.map(f => String(f.clave)))
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01' || /relation "cj_anuncios_avisos" does not exist/i.test((e as Error)?.message ?? '')) return new Set()
    throw e
  }
}

/**
 * ¿Ya salió (o se está mandando) un aviso de este tipo para la campaña en los últimos `dias`? Es la segunda llave: la
 * fecha del ciclo de la clave puede correrse (el anuncio más viejo se pausa, o una lanzada se agrupa distinto al día
 * siguiente) y no tiene que salir otro aviso igual. No crea la tabla; si todavía no existe, no salió nada.
 */
export async function avisoReciente(campanaId: string, tipo: string, dias: number): Promise<boolean> {
  try {
    const filas = await consulta('aviso reciente', q => q`SELECT 1 AS ya FROM cj_anuncios_avisos
      WHERE campana_id = ${campanaId} AND tipo = ${tipo} AND creado > now() - make_interval(days => ${Math.max(1, Math.trunc(dias))}::int) LIMIT 1`)
    return filas.length > 0
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01' || /relation "cj_anuncios_avisos" does not exist/i.test((e as Error)?.message ?? '')) return false
    throw e
  }
}

/**
 * g01: por carpeta de Editados, hasta qué video ya se avisó (el createdTime que va al final de la clave
 * `videos:<carpeta>:<hasta>`). No crea la tabla; si todavía no existe, no se avisó nada.
 */
export async function videosAvisadosHasta(carpetas: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!carpetas.length) return out
  try {
    const filas = await consulta('videos avisados', q => q`SELECT campana_id, max(substring(clave from length(campana_id) + 9)) AS hasta FROM cj_anuncios_avisos
      WHERE tipo = 'videos' AND campana_id = ANY(${carpetas}) GROUP BY campana_id`)
    for (const f of filas) if (f.campana_id && f.hasta) out.set(String(f.campana_id), String(f.hasta))
    return out
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01' || /relation "cj_anuncios_avisos" does not exist/i.test((e as Error)?.message ?? '')) return out
    throw e
  }
}
