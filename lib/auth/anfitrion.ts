// ── Dos direcciones, una sola casa (8/10/2026) ───────────────────────────────────────────────────
// El sistema se llama "Despacho" y vive en una dirección nueva (AUTH_BASE_URL: despacho-capital-juridico.vercel.app). La vieja
// (dashboard-metricas-eight.vercel.app) tiene que seguir viva porque Make, los crons, el webhook de Calendly y los enlaces de
// Discord le pegan: las rutas de máquina NO se tocan, solo las PÁGINAS que abre una persona se mandan a la dirección nueva.
// Por qué hace falta: la cookie de sesión y el estado del login viven en UNA dirección. Si alguien empieza a entrar por la
// vieja mientras el retorno de Google apunta a la nueva, el ingreso falla. Mientras AUTH_BASE_URL siga siendo la vieja, esto no hace nada.
// Sin imports de Next: se prueba con node:test.

export const HOST_ANTIGUO = 'dashboard-metricas-eight.vercel.app'

// Lo que sigue funcionando en la dirección vieja aunque haya una nueva: archivos que no llevan datos y el video que descarga 2Chat.
const SIN_REDIRIGIR = ['/v/', '/manifest.webmanifest', '/pwa/', '/marca/', '/favicon.ico', '/_next/']

const sinPuerto = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, '')

export function destinoCanonico(e: { host: string | null; pathname: string; search?: string; method: string; baseUrl?: string; antiguo?: string }): string | null {
  const antiguo = (e.antiguo ?? HOST_ANTIGUO).toLowerCase()
  if (!e.host || sinPuerto(e.host) !== antiguo) return null
  if (e.method !== 'GET' && e.method !== 'HEAD') return null   // un POST (Make, formularios, salir) nunca se redirige
  let base: URL
  try { base = new URL((e.baseUrl ?? '').trim()) } catch { return null }
  if (base.protocol !== 'https:' || base.host.toLowerCase() === antiguo) return null
  const ruta = e.pathname.startsWith('/') ? e.pathname : `/${e.pathname}`
  // Rutas de máquina (crons, webhooks, datos, Make): quedan en la dirección vieja. Del login solo se redirige el inicio y el retorno.
  if (ruta === '/api' || ruta.startsWith('/api/')) {
    if (!(ruta === '/api/auth/google' || ruta.startsWith('/api/auth/google/'))) return null
  }
  if (SIN_REDIRIGIR.some((p) => ruta === p || ruta.startsWith(p.endsWith('/') ? p : `${p}/`) || (p.endsWith('/') && ruta === p.slice(0, -1)))) return null
  return `${base.origin}${ruta}${e.search ?? ''}`
}
