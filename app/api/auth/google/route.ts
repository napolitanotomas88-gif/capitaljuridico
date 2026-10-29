import { iniciarLogin } from '@/lib/auth/flujo'

export const dynamic = 'force-dynamic'

// Inicia el login con Google. ?next=<ruta interna> es opcional: solo se acepta una ruta relativa del propio sitio.
export function GET(req: Request) {
  return iniciarLogin(req)
}
