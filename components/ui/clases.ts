// Une nombres de clase ignorando valores vacíos
export function clases(...partes: Array<string | false | null | undefined>): string {
  return partes.filter(Boolean).join(' ')
}
