// ── Zona de quien refiere, deducida de su teléfono (puro, sin red) ─────────────────────────
// La grabación con cámara profesional (oficinas de Buenos Aires) es un EXTRA solo para quien refiere desde la zona de
// Buenos Aires. La planilla no tiene un campo "zona": se deduce del celular del cliente (Agencia / Consultora).
// Es solo una PISTA para el closer, que ofrece el extra en la llamada de los referidos y lo confirma:
//   · 'buenos_aires'   = número de Argentina con código de área 11 (AMBA).
//   · 'sin_determinar' = todo lo demás (otro código de área, otro país, número incompleto, vacío). NO es un "no": no se sabe.
//
// Formas que reconoce (código de área 11 + 8 dígitos):
//   "+54 9 11 5555-1234", "+54 11 5555-1234", "54 9 11 5555 1234", "0054 9 11 …", "011 5555-1234", "(011) 15 5555-1234",
//   "11 5555 1234" (10 dígitos) y "11 15 5555 1234" (con el 15 de celular). Una celda con varios teléfonos separados por
//   "/", ";", "," o salto de línea es de Buenos Aires si alguno lo es. Las notas entre paréntesis con letras ("(Mari)") se ignoran.
// No adivina: "11 91234-5678" (11 dígitos: San Pablo, Brasil), "+55 11 …" y "+598 …" quedan sin determinar.

export type ZonaGrabacion = 'buenos_aires' | 'sin_determinar'

const CODIGO_AREA_BA = '11'

// Número nacional argentino SIN el 0 inicial ni el 9 de celular: 11 + 8 dígitos, o 11 + 15 + 8 dígitos
function esNacionalDeBuenosAires(n: string): boolean {
  if (!n.startsWith(CODIGO_AREA_BA)) return false
  if (n.length === 10) return true
  return n.length === 12 && n.startsWith(`${CODIGO_AREA_BA}15`)
}

function parteEsBuenosAires(parte: string): boolean {
  const sinNota = parte.replace(/\([^)]*[A-Za-zÁ-ÿ][^)]*\)/g, '')   // "(Mari)" es una nota; "(011)" es parte del número
  const conMas = /^\s*\+/.test(sinNota)
  let d = sinNota.replace(/\D/g, '')
  if (!d) return false
  let conPais = conMas
  if (d.startsWith('00')) { d = d.slice(2); conPais = true }                 // "0054…" = "+54…"
  else if (!conMas && d.startsWith('54') && d.length >= 12) conPais = true    // "54 11 …" sin el "+"

  if (conPais) {
    if (!d.startsWith('54')) return false                                    // otro país: no se adivina
    let r = d.slice(2)
    if (r.startsWith('0')) r = r.slice(1)                                    // "+54 011 …"
    if (r.startsWith('9') && r.length === 11) r = r.slice(1)                 // el 9 de celular
    return esNacionalDeBuenosAires(r)
  }
  if (d.startsWith('0')) d = d.slice(1)                                      // "011 …"
  return esNacionalDeBuenosAires(d)
}

/** Teléfono (o celda con varios) del cliente que refiere → zona deducida. Cualquier entrada rara da 'sin_determinar', nunca falla. */
export function zonaPorTelefono(telefono: unknown): ZonaGrabacion {
  if (telefono === null || telefono === undefined) return 'sin_determinar'
  if (typeof telefono !== 'string' && typeof telefono !== 'number') return 'sin_determinar'
  const partes = String(telefono).split(/[/;,\n|]+/)
  return partes.some(parteEsBuenosAires) ? 'buenos_aires' : 'sin_determinar'
}
