// ── Errores del login ───────────────────────────────────────────────────────────────────────
// Códigos fijos que viajan en /entrar?error=<codigo>. Nunca llevan texto libre ni datos de la persona: la página
// de acceso traduce cada código a un mensaje. El "motivo" es solo para el log del servidor (sin mails ni tokens).

export const CODIGOS_ERROR = ['cuenta_no_autorizada', 'intento_vencido', 'google_rechazo', 'configuracion', 'sin_secciones', 'error'] as const
export type CodigoError = (typeof CODIGOS_ERROR)[number]

export function esCodigoError(valor: unknown): valor is CodigoError {
  return typeof valor === 'string' && (CODIGOS_ERROR as readonly string[]).includes(valor)
}

export class ErrorAuth extends Error {
  readonly codigo: CodigoError
  readonly motivo: string

  constructor(codigo: CodigoError, motivo: string) {
    super(motivo)
    this.name = 'ErrorAuth'
    this.codigo = codigo
    this.motivo = motivo
  }
}
