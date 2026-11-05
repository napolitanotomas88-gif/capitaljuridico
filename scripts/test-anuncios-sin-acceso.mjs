// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-anuncios-sin-acceso.mjs
// Cuentas sin acceso (Meta #200): se detectan y el aviso dice quién y qué hacer, sin el error crudo (5/11/2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
const T = await import('../lib/anuncios/sinAcceso.ts')

test('detecta el #200 de permisos', () => {
  assert.equal(T.esSinPermiso('(#200) Ad account owner has NOT grant ads_management or ads_read permission, refer to …'), true)
  assert.equal(T.esSinPermiso('No se pudo completar anuncios: (#200) Ad account owner has NOT grant ads_management or ads_read permission'), true)
  assert.equal(T.esSinPermiso('(#17) User request limit reached'), false)
})

test('aviso por nombre de cliente y con qué hacer', () => {
  const uno = T.avisoSinAcceso(['Melissa Santillo'])
  assert.match(uno, /^Sin acceso a la cuenta publicitaria de Melissa Santillo\. El cliente tiene que volver a darle acceso/)
  assert.match(uno, /Gerónimo Actis/)
  assert.doesNotMatch(uno, /#200|ads_read/)
  assert.match(T.avisoSinAcceso(['A', 'B', 'C']), /de A, B y C\. Cada cliente tiene/)
})
