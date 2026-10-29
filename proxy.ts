// Proxy (ex-middleware en Next 16): primera barrera de acceso de TODO el dashboard.
// Quién entra a cada URL se decide en lib/auth/rutas.ts (tabla REGLAS); acá solo se aplica la decisión:
//   · sesión de Google: "/", Ventas, Clientes, Referidos y las rutas /api de datos (el rol manda: puedeVer);
//   · Bearer CRON_SECRET además de la sesión: solo /api/raw, /api/metrics y /api/ads (verificaciones y scripts);
//   · contraseña de Finanzas: /finanzas y /api/finanzas, con el bloque original sin cambios;
//   · todo lo que usan los crons, los webhooks y Make (más el video de /v/) queda FUERA del proxy en el matcher.
//     Además la tabla los marca como abiertos, por si alguna vez el matcher cambia.
// Cada página y cada ruta de datos vuelve a verificar por su cuenta: el proxy no es la única barrera.
import { NextResponse, type NextRequest } from 'next/server'
import { contextoDePeticion } from '@/lib/auth/acceso'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { destinoCanonico } from '@/lib/auth/anfitrion'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { decidir, resolverRegla } from '@/lib/auth/rutas'
import { COOKIE_FINANZAS, passwordConfigurada, tokenValido } from '@/lib/finanzasAuth'

const SIN_CACHE = { 'Cache-Control': 'no-store' }

// Contraseña de Finanzas: mismo comportamiento que antes de agregar el login de Google, salvo que un ADMINISTRADOR con sesión de
// Google entra sin contraseña (lib/auth/llaveAdmin.ts, 8/10/2026).
async function accesoFinanzas(req: NextRequest, esApi: boolean): Promise<NextResponse> {
  if (await adminPorCabeceras(req.headers)) return NextResponse.next()
  if (!passwordConfigurada()) {
    // Sin FINANZAS_PASSWORD no se abre nada
    if (esApi) return NextResponse.json({ error: 'Finanzas bloqueado: falta configurar FINANZAS_PASSWORD' }, { status: 503 })
    return NextResponse.redirect(new URL('/finanzas/login', req.url))
  }
  if (tokenValido(req.cookies.get(COOKIE_FINANZAS)?.value)) return NextResponse.next()
  if (esApi) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  return NextResponse.redirect(new URL('/finanzas/login', req.url))
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  // Despacho: las páginas que abre una persona por la dirección vieja pasan a la nueva (las rutas de máquina no: lib/auth/anfitrion.ts)
  const canonica = destinoCanonico({ host: req.headers.get('host'), pathname, search, method: req.method, baseUrl: process.env.AUTH_BASE_URL })
  if (canonica) return NextResponse.redirect(canonica, 307)
  // La lista de accesos de la planilla se renueva (caché de 60 s) solo en las rutas que miran la sesión de Google
  const { regla } = resolverRegla(pathname)
  if (regla.quien === 'google' || regla.quien === 'google_o_maquina') await asegurarUsuarios()
  const decision = decidir({ pathname, search, contexto: () => contextoDePeticion(req.headers) })
  switch (decision.accion) {
    case 'pasar':
      return NextResponse.next()
    case 'finanzas':
      return await accesoFinanzas(req, decision.esApi)
    case 'json':
      return NextResponse.json({ error: decision.error }, { status: decision.estado, headers: SIN_CACHE })
    case 'redirigir': {
      // 307 conserva el método; un POST sin sesión se manda con 303 para que el navegador siga con GET
      const estado = req.method === 'GET' || req.method === 'HEAD' ? 307 : 303
      const res = NextResponse.redirect(new URL(decision.destino, req.url), estado)
      res.headers.set('Cache-Control', 'no-store')
      return res
    }
  }
}

// Corre en todo menos en: archivos compilados y favicon, el video de /v/ y lo que usan los crons y los webhooks
// (los de vercel.json, el EOD de Make, los webhooks de Calendly, de Fathom, de Whapi y de AssemblyAI, el motor del bot de altas y el vigía de Edición que dispara el Puente Drive). Las exclusiones son exactas: "api/analista" solo deja
// afuera /api/analista (con o sin barra final), no /api/analista-algo ni /api/analista/otra-cosa, y el video es un
// archivo suelto de /v/ sin "%" (un "..%2F" disfrazado sí pasa por el proxy). Si agregás una ruta de automatización,
// sumala acá Y en lib/auth/rutas.ts: scripts/test-rutas.mjs avisa si una de las dos listas queda desfasada.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico$|v/[^/%]+$|api/(?:analista|resumen-diario|recordatorio-formularios|reporte-enrutamiento|agenda-slots|finanzas-cierre|reporte-anuncios|alerta-anuncios|reporte-eod|calendly-webhook|fathom-anuncios|fathom-anuncios/reintentar|bot/kickoff|bot/kickoff/mapa|bot/guiones|bot/guiones/respuesta|bot/whapi|bot/alta/motor|bot/exito|bot/bajas|bot/grabacion/vigia|bot/grabacion/transcripcion|bot/grabacion/diario|clientes/sincronizar|clientes/inactivos/cron|trazabilidad/botonera|trazabilidad/procesar|trazabilidad/semanal|trazabilidad/manychat)/?$).*)',
  ],
}
