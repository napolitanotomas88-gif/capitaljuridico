// ── Lectura del Doc «Organización de ADS - Orgánico» (cuenta de servicio, export a texto). Liviano: lo usa el tablero ──
// El id va por entorno (ANUNCIOS_DOC_ADS_ID): el repo es público y el Doc tiene los copys de los clientes. La cuenta de
// servicio lo lee como cualquier Doc compartido por enlace. ANUNCIOS_DOC_ADS=0 apaga la corrida (no la lectura). Solo servidor.
import { conCache } from '@/lib/anuncios/cache'
import { lectorReal } from '@/lib/bot/grabacion/drive'

const idValido = (id: string) => /^[A-Za-z0-9_-]{10,80}$/.test(id)
export const docAdsId = (): string | null => { const id = process.env.ANUNCIOS_DOC_ADS_ID?.trim() ?? ''; return idValido(id) ? id : null }
export const docAdsEncendido = (): boolean => process.env.ANUNCIOS_DOC_ADS?.trim() !== '0'

/** El texto del Doc (sin caché: la corrida y el botón leen lo último). */
export async function leerDocAds(): Promise<string> {
  const id = docAdsId()
  if (!id) throw new Error('falta ANUNCIOS_DOC_ADS_ID (el id del Doc «Organización de ADS - Orgánico»)')
  return lectorReal().exportarTexto(id)
}

/** El texto del Doc con caché de 5 min (para el tablero). null = sin configurar o no se pudo leer. */
export async function leerDocAdsCache(): Promise<string | null> {
  if (!docAdsId()) return null
  try { return (await conCache('doc-ads-v1', 300, leerDocAds)).data } catch { return null }
}
