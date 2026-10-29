import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
// "@" apunta a la raíz del dashboard (dos carpetas arriba de esta)
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  server: { fs: { strict: false } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
