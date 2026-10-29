import { cerrarSesion, salirSoloPost } from '@/lib/auth/flujo'

export const dynamic = 'force-dynamic'

// Cerrar sesión solo con POST: un GET (enlace, imagen o prefetch de otro sitio) no puede desloguear a nadie.
export function POST(req: Request) {
  return cerrarSesion(req)
}

export function GET() {
  return salirSoloPost()
}
