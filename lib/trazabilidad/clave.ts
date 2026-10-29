// Comparación de "Authorization: Bearer <secreto>" en tiempo constante. Sin el secreto configurado, nadie entra.
import { createHash, timingSafeEqual } from 'node:crypto'

export function bearerValido(req: Request, secreto: string | undefined): boolean {
  const s = secreto?.trim()
  if (!s) return false
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)
  if (!m) return false
  const a = createHash('sha256').update(m[1].trim()).digest(), b = createHash('sha256').update(s).digest()
  return timingSafeEqual(a, b)
}
