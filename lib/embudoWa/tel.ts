// Teléfono del lead en formato internacional (solo dígitos, sin +). Si escribió un número argentino sin código de país
// (10 dígitos: área + número) se le agrega 549; si puso 54 sin el 9 de celular, se le agrega el 9.
export function normalizarTel(entrada: string): string {
  let d = entrada.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && !d.startsWith('0')) d = '549' + d
  else if (d.length === 11 && d.startsWith('0')) d = '549' + d.slice(1)
  if (d.startsWith('54') && !d.startsWith('549') && d.length === 12) d = '549' + d.slice(2)
  return d
}
