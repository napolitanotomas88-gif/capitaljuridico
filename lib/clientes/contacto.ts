// ── Teléfonos de contacto y enlace de WhatsApp (puro) ─────────────────────────────────────
// La planilla trae los celulares como los tipeó el equipo: "+54 9 11 5555-1234", "54 9 11 5555 1234",
// "+54 9 11 ... (Mari) / +54 9 11 ... (Sil)" (varios en una celda) o "11 5555 1234" (sin país).
// El enlace wa.me exige E.164 sin "+" ni espacios. Solo se arma el enlace cuando el número es
// INEQUÍVOCO (trae "+" o arranca con el 54 argentino): un "11 5555 1234" sin código de país no se adivina,
// porque abrir el chat de otra persona es peor que no tener enlace.

export interface Telefono {
  /** Como está cargado en la planilla (recortado) */
  texto: string
  /** E.164 con "+" ('+5491155551234'); null si no se pudo normalizar sin adivinar */
  e164: string | null
  /** Enlace https://wa.me/<E.164 sin "+">; null si no hay e164 */
  wa: string | null
}

// Argentina: WhatsApp espera 54 + 9 + código de área + número (13 dígitos). Si vino sin el 9 (12 dígitos), se agrega.
function normalizarAR(digitos: string): string | null {
  if (digitos.length === 12) return `54${'9'}${digitos.slice(2)}`
  if (digitos.length === 13 && digitos[2] === '9') return digitos
  return null
}

/** Una celda de teléfono → E.164 ('+5491155551234') o null si hay que adivinar el país */
export function normalizarE164(parte: string): string | null {
  const sinNota = parte.replace(/\(.*?\)/g, '')            // "(Mari)" no es parte del número
  const conMas = /^\s*\+/.test(sinNota)
  let digitos = sinNota.replace(/\D/g, '')
  if (!conMas && digitos.startsWith('00')) digitos = digitos.slice(2)   // "0054…" = "+54…"
  else if (!conMas && !digitos.startsWith('54')) return null            // sin "+" y sin el 54: no se adivina
  if (digitos.length < 8 || digitos.length > 15 || digitos.startsWith('0')) return null
  if (digitos.startsWith('54')) {
    const ar = normalizarAR(digitos)
    return ar ? `+${ar}` : null
  }
  return `+${digitos}`
}

/** Una celda con uno o varios teléfonos ("a / b") → lista con su enlace de WhatsApp cuando se puede */
export function telefonosDe(celular: string): Telefono[] {
  return (celular ?? '').toString().split('/').map(p => p.trim()).filter(p => /\d/.test(p)).map(texto => {
    const e164 = normalizarE164(texto)
    return { texto, e164, wa: e164 ? `https://wa.me/${e164.slice(1)}` : null }
  })
}
