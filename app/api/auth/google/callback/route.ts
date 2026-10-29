import { completarLogin } from '@/lib/auth/flujo'

export const dynamic = 'force-dynamic'

// Retorno de Google (hay que registrar esta URL en las credenciales OAuth: AUTH_BASE_URL + /api/auth/google/callback).
export async function GET(req: Request) {
  return completarLogin(req)
}
