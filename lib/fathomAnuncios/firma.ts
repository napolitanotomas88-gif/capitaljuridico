// ── Firma del webhook de Fathom (Standard Webhooks) ──────────────────────────────────────────
// Fathom firma cada envío con el esquema de https://www.standardwebhooks.com:
//   · cabeceras webhook-id, webhook-timestamp (segundos unix) y webhook-signature;
//   · contenido firmado = `${webhook-id}.${webhook-timestamp}.${cuerpo CRUDO}` (el texto tal cual llegó: si se
//     parsea y se vuelve a serializar, la firma ya no coincide);
//   · clave = base64-decode del secreto sin el prefijo "whsec_" (FATHOM_WEBHOOK_SECRET); HMAC-SHA256 → base64;
//   · webhook-signature trae una o varias firmas separadas por espacio, "v1,<base64>" (varias cuando Fathom rota el
//     secreto): alcanza con que UNA coincida. Las de otra versión se ignoran.
// El timestamp no puede estar a más de 5 minutos (para atrás o para adelante): un envío viejo capturado no se puede
// reenviar después. Función pura con "ahora" inyectable para los tests. Falla cerrado ante cualquier cosa rara.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const TOLERANCIA_S = 5 * 60
export const SECRETO_MAL_CONFIGURADO = 'secreto mal configurado'

export interface CabecerasFirma { id: string | null; timestamp: string | null; firma: string | null }
export type ResultadoFirma = { ok: true } | { ok: false; motivo: string }

/** Clave HMAC del secreto "whsec_<base64>" (o el base64 solo). null si no se puede decodificar. */
export function claveDeSecreto(secreto: string): Buffer | null {
  const b64 = secreto.trim().replace(/^whsec_/, '')
  // base64 estándar (también se acepta la variante para URLs, por las dudas)
  if (!b64 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) return null
  const clave = Buffer.from(b64, 'base64')
  return clave.length ? clave : null
}

/** Firma "v1,<base64>" de un envío. La usan los tests y sirve para probar a mano con curl. */
export function firmar(secreto: string, id: string, timestamp: string | number, cuerpo: string): string {
  const clave = claveDeSecreto(secreto)
  if (!clave) throw new Error('secreto de Fathom inválido')
  return `v1,${createHmac('sha256', clave).update(`${id}.${timestamp}.${cuerpo}`).digest('base64')}`
}

export function verificarFirma(secreto: string, cab: CabecerasFirma, cuerpo: string, ahoraMs: number = Date.now()): ResultadoFirma {
  const clave = claveDeSecreto(secreto)
  if (!clave) return { ok: false, motivo: SECRETO_MAL_CONFIGURADO }
  const id = (cab.id ?? '').trim(), ts = (cab.timestamp ?? '').trim(), firmas = (cab.firma ?? '').trim()
  if (!id || id.length > 256 || !ts || !firmas) return { ok: false, motivo: 'faltan cabeceras de firma' }
  // Numérico: con NaN la comparación de abajo daría false y se saltearía la ventana anti-reenvío
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, motivo: 'timestamp inválido' }
  if (Math.abs(ahoraMs / 1000 - Number(ts)) > TOLERANCIA_S) return { ok: false, motivo: 'timestamp fuera de la ventana de 5 minutos' }

  const esperada = Buffer.from(createHmac('sha256', clave).update(`${id}.${ts}.${cuerpo}`).digest('base64'))
  let coincide = false
  for (const parte of firmas.split(' ').slice(0, 10)) {
    const coma = parte.indexOf(',')
    if (coma < 0 || parte.slice(0, coma) !== 'v1') continue
    const candidata = Buffer.from(parte.slice(coma + 1))
    // timingSafeEqual exige el mismo largo: uno distinto ya es una firma inválida (el largo de la esperada es fijo, no filtra nada)
    if (candidata.length === esperada.length && timingSafeEqual(candidata, esperada)) coincide = true
  }
  return coincide ? { ok: true } : { ok: false, motivo: 'firma inválida' }
}
