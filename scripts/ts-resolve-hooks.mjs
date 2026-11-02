// Hook de resolución para correr lib/*.ts con node --experimental-strip-types:
//   · imports relativos sin extensión → .ts (o .js, para las reglas puras de components/finanzas/skwd)
//   · alias "@/..." (tsconfig paths) → raíz del proyecto, para poder importar las rutas de app/ y lib/ que lo usan
//   · "next/server" → next/server.js (el paquete no declara "exports": en ESM hace falta la extensión), para probar proxy.ts
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const RAIZ = new URL('../', import.meta.url)
export async function resolve(spec, ctx, next) {
  if (spec === 'next/server') return next('next/server.js', ctx)
  if (spec.startsWith('@/')) {
    for (const sufijo of ['.ts', '.tsx', '/index.ts']) {
      const u = new URL(spec.slice(2) + sufijo, RAIZ)
      if (existsSync(fileURLToPath(u))) return next(u.href, ctx)
    }
  }
  if (spec.startsWith('.') && !/\.\w+$/.test(spec) && ctx.parentURL) {
    for (const ext of ['.ts', '.js']) {
      const u = new URL(spec + ext, ctx.parentURL)
      if (existsSync(fileURLToPath(u))) return next(u.href, ctx)
    }
  }
  return next(spec, ctx)
}
