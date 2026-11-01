import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'

export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'Cache-Control': 'private, no-store' }

// GET /api/finanzas/sops: dónde está el SOP de cada puesto, para mostrarlo al cargar un pago del equipo (Pagos del equipo).
// Pedido de Tomás (1/11/2026). Los enlaces viven en la variable FINANZAS_SOPS_PUESTOS (no en el repo, que es público):
// JSON { "puestos": [{ "claves": ["coach"], "nombre": "Coach de ventas", "url": "https://docs.google.com/..." }], "carpeta": "https://drive..." }
// Mismo acceso que /api/finanzas/base. Sin la variable devuelve una lista vacía y el desplegable no aparece.
export async function GET(req: NextRequest) {
  if (!tokenValido(req.cookies.get(COOKIE_FINANZAS)?.value) && !(await adminPorCabeceras(req.headers)))
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SIN_CACHE })
  const crudo = process.env.FINANZAS_SOPS_PUESTOS?.trim()
  if (!crudo) return NextResponse.json({ puestos: [], carpeta: null }, { headers: SIN_CACHE })
  try {
    const j = JSON.parse(crudo)
    const esUrl = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u)
    const puestos = (Array.isArray(j.puestos) ? j.puestos : [])
      .filter((p: { claves?: unknown; nombre?: unknown; url?: unknown }) => Array.isArray(p.claves) && typeof p.nombre === 'string' && esUrl(p.url))
      .map((p: { claves: unknown[]; nombre: string; url: string }) => ({ claves: p.claves.map(String), nombre: p.nombre, url: p.url }))
    return NextResponse.json({ puestos, carpeta: esUrl(j.carpeta) ? j.carpeta : null }, { headers: SIN_CACHE })
  } catch {
    return NextResponse.json({ error: 'FINANZAS_SOPS_PUESTOS no es un JSON válido', puestos: [], carpeta: null }, { status: 500, headers: SIN_CACHE })
  }
}
