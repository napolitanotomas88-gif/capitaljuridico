// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-llave-admin.mjs
// Llave de administrador (8/10/2026): quién entra a Finanzas y Anuncios sin su contraseña.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { esAdministrador } from '../lib/auth/llaveAdmin.ts'

test('solo el administrador (socio o admin de la planilla) se saltea la contraseña', () => {
  assert.equal(esAdministrador({ rol: 'socio', admin: true }), true)
  assert.equal(esAdministrador({ rol: 'acceso', admin: true }), true)       // "Administrador" cargado en Configuración
  assert.equal(esAdministrador({ rol: 'socio', admin: false }), true)
  for (const rol of ['closer', 'csm', 'setter', 'acceso']) assert.equal(esAdministrador({ rol, admin: false }), false, rol)
  assert.equal(esAdministrador(null), false)
  assert.equal(esAdministrador(undefined), false)
})
test('todas las puertas de Finanzas y Anuncios consultan la llave (y siguen aceptando la contraseña)', () => {
  const puertas = {
    'proxy.ts': 'adminPorCabeceras', 'app/finanzas/page.tsx': 'adminEnPagina', 'app/finanzas/login/page.tsx': 'adminEnPagina',
    'app/api/finanzas/route.ts': 'adminPorCabeceras', 'app/anuncios/page.tsx': 'adminEnPagina', 'app/anuncios/login/page.tsx': 'adminEnPagina',
    'app/api/anuncios/route.ts': 'adminPorCabeceras', 'app/api/anuncios/recuento/route.ts': 'adminPorCabeceras',
    'app/api/anuncios/reporte-pdf/route.ts': 'adminPorCabeceras', 'app/api/anuncios/optimizar/route.ts': 'adminPorCabeceras',
  }
  for (const [archivo, llave] of Object.entries(puertas)) {
    const codigo = readFileSync(new URL(`../${archivo}`, import.meta.url), 'utf8')
    assert.ok(codigo.includes(llave), `${archivo} no consulta ${llave}`)
    assert.ok(/tokenValido|sesionValida|accesoFinanzas/.test(codigo), `${archivo} dejó de verificar la contraseña`)
  }
})
