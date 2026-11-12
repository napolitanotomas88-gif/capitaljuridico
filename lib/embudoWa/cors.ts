// Solo la landing (capitaljuridico.com.ar, o lo que diga EMBUDO_WA_ORIGENES separado por comas) puede llamar a la API.
const ORIGENES = () => (process.env.EMBUDO_WA_ORIGENES || 'https://capitaljuridico.com.ar,https://www.capitaljuridico.com.ar')
  .split(',').map((s) => s.trim()).filter(Boolean)

export function cabecerasCors(origen: string | null): Record<string, string> {
  const ok = origen && ORIGENES().includes(origen)
  return ok ? {
    'Access-Control-Allow-Origin': origen, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400', Vary: 'Origin',
  } : { Vary: 'Origin' }
}
export const origenPermitido = (origen: string | null) => !!origen && ORIGENES().includes(origen)
