// ── Caché del tablero de anuncios (2 capas) ──────────────────────────────────────────────────
// La pantalla consulta /api/anuncios cada 15 s, pero a Meta NO se le puede pegar a ese ritmo
// (rate limit por cuenta publicitaria y por app). Por eso todo lo externo pasa por acá:
//
//   1) Data Cache de Next (unstable_cache): compartido entre TODAS las instancias de Vercel.
//      Funciona como stale-while-revalidate: vencido el plazo devuelve el dato anterior al toque y
//      lo refresca en segundo plano (si el refresco falla —ej. Meta limita—, queda el anterior).
//   2) Memoria del proceso (hasta que el dato vence, mínimo 15 s): una misma instancia no vuelve a
//      consultar el Data Cache en cada poll, y los pedidos simultáneos se deduplican (un vuelo por clave).
//
// La clave incluye el id del deploy: un deploy nuevo arranca con caché vacía (evita servir datos
// con una forma vieja). Si la capa 1 no está disponible (scripts sueltos), se usa solo la 2 con
// el plazo completo. Si algo falla y hay un último valor bueno en memoria, se devuelve ese.
import { revalidateTag, unstable_cache } from 'next/cache'

export interface Cacheado<T> { at: number; data: T }
export interface ResultadoCache<T> extends Cacheado<T> { error?: string; viejo?: boolean }

const MEMORIA_SEG = 15
const memoria = new Map<string, { hasta: number; valor: Cacheado<unknown> }>()
const enVuelo = new Map<string, Promise<Cacheado<unknown>>>()
const ultimoBueno = new Map<string, Cacheado<unknown>>()
const DEPLOY = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'local'

async function capaDatos<T>(clave: string, segundos: number, fn: () => Promise<T>): Promise<Cacheado<T>> {
  const envuelta = async (): Promise<Cacheado<T>> => ({ at: Date.now(), data: await fn() })
  try {
    const cacheada = unstable_cache(envuelta, ['anuncios-v1', DEPLOY, clave], { revalidate: segundos, tags: ['anuncios', `anuncios-${clave}`] })
    return await cacheada()
  } catch (e) {
    // Fuera de un request de Next no hay incrementalCache: se sigue sin la capa compartida
    if (/incrementalCache missing|static generation store missing/i.test((e as Error).message ?? '')) return envuelta()
    throw e
  }
}

// segundos = cada cuánto se refresca de verdad la fuente (Meta, Sheets…)
export async function conCache<T>(clave: string, segundos: number, fn: () => Promise<T>): Promise<ResultadoCache<T>> {
  const m = memoria.get(clave)
  if (m && m.hasta > Date.now()) return m.valor as Cacheado<T>
  const vuelo = enVuelo.get(clave)
  if (vuelo) return vuelo as Promise<Cacheado<T>>
  const p = capaDatos(clave, segundos, fn)
    .then(valor => {
      // En memoria hasta que el dato venza (mínimo 15 s): mientras está fresco no hace falta ni
      // consultar la capa compartida; vencido, se vuelve a ella (que devuelve el anterior y refresca).
      memoria.set(clave, { hasta: Math.max(Date.now() + MEMORIA_SEG * 1000, valor.at + segundos * 1000), valor })
      ultimoBueno.set(clave, valor)
      return valor
    })
    .finally(() => enVuelo.delete(clave))
  enVuelo.set(clave, p as Promise<Cacheado<unknown>>)
  try {
    return await p
  } catch (e) {
    const previo = ultimoBueno.get(clave) as Cacheado<T> | undefined
    if (previo) {
      // Se reintenta recién en 60 s para no insistirle a una fuente que está fallando/limitando
      const conAviso: ResultadoCache<T> = { ...previo, error: (e as Error).message, viejo: true }
      memoria.set(clave, { hasta: Date.now() + 60_000, valor: conAviso })
      return conAviso
    }
    throw e
  }
}

// El botón espera los pedidos en curso antes de invalidar ambas capas.
// Las solicitudes simultáneas comparten una sola actualización.
let actualizacionManual: Promise<void> | null = null
export async function invalidarCacheAnuncios(): Promise<void> {
  if (actualizacionManual) return actualizacionManual
  actualizacionManual = (async () => {
    await Promise.allSettled([...enVuelo.values()])
    revalidateTag('anuncios', { expire: 0 })
    memoria.clear()
  })().finally(() => { actualizacionManual = null })
  return actualizacionManual
}

/** Invalida UNA clave en todas las instancias (etiqueta del Data Cache) y en la memoria de esta. La usa Seguimiento al guardar
 *  un puntaje (lib/seguimiento/hojas.ts). Fuera de un pedido de Next (scripts), solo borra la memoria. */
export function invalidarClave(clave: string): void {
  memoria.delete(clave)
  try { revalidateTag(`anuncios-${clave}`, { expire: 0 }) } catch { /* sin incrementalCache (scripts): alcanza con la memoria */ }
}

