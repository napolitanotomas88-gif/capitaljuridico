// Teléfono del lead en formato internacional (solo dígitos, sin +). Arreglos para números argentinos mal escritos:
//  · 10 dígitos (área + número, sin 54 ni 9)            → 549 + número
//  · 11 dígitos que empiezan con 0 (011 / 0351 …)        → 549 + número sin el 0
//  · 11 dígitos que empiezan con 9 (9 + área + número)   → 54 + número
//  · 12 dígitos que empiezan con 54 sin el 9 de celular  → 549 + resto
//  · el «15» del celular viejo después del área no se puede detectar con seguridad: se deja como está.
export function normalizarTel(entrada: string): string {
  let d = entrada.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && !d.startsWith('0')) d = '549' + d
  else if (d.length === 11 && d.startsWith('0')) d = '549' + d.slice(1)
  else if (d.length === 11 && d.startsWith('9')) d = '54' + d
  if (d.startsWith('54') && !d.startsWith('549') && d.length === 12) d = '549' + d.slice(2)
  return d
}
