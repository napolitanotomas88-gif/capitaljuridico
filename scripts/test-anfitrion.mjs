// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-anfitrion.mjs
// Dos direcciones (vieja y nueva): qué se redirige y qué NO (Make, crons, webhooks, Discord, el video de 2Chat).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destinoCanonico, HOST_ANTIGUO } from '../lib/auth/anfitrion.ts'

const NUEVA = 'https://despacho-capital-juridico.vercel.app'
const d = (o) => destinoCanonico({ host: HOST_ANTIGUO, pathname: '/', search: '', method: 'GET', baseUrl: NUEVA, ...o })

test('las páginas que abre una persona por la dirección vieja pasan a la nueva, con ruta y consulta', () => {
  assert.equal(d({}), `${NUEVA}/`)
  assert.equal(d({ pathname: '/backend', search: '?x=1' }), `${NUEVA}/backend?x=1`)
  assert.equal(d({ pathname: '/ventas/lead/abc' }), `${NUEVA}/ventas/lead/abc`)
  assert.equal(d({ pathname: '/anuncios/login' }), `${NUEVA}/anuncios/login`)
  assert.equal(d({ pathname: '/finanzas' }), `${NUEVA}/finanzas`)
  assert.equal(d({ pathname: '/entrar', search: '?next=/backend' }), `${NUEVA}/entrar?next=/backend`)
  assert.equal(d({ method: 'HEAD' }), `${NUEVA}/`)
})
test('el inicio y el retorno del login también (si no, el ingreso quedaría partido entre dos direcciones)', () => {
  assert.equal(d({ pathname: '/api/auth/google', search: '?next=/backend' }), `${NUEVA}/api/auth/google?next=/backend`)
  assert.equal(d({ pathname: '/api/auth/google/callback', search: '?code=1&state=2' }), `${NUEVA}/api/auth/google/callback?code=1&state=2`)
})
test('nada de máquina se redirige: crons, webhooks, Make, datos, video y archivos', () => {
  for (const p of ['/api/analista', '/api/resumen-diario', '/api/calendly-webhook', '/api/reporte-eod', '/api/raw', '/api/metrics', '/api/anuncios/datos',
    '/api/agenda-slots', '/api/auth/salir', '/api/referidos', '/api', '/v/video.mp4', '/manifest.webmanifest', '/pwa/icon-192.png', '/marca/logo-claro.svg', '/favicon.ico', '/_next/static/x.js']) {
    assert.equal(d({ pathname: p }), null, p)
  }
})
test('un POST o cualquier método que no sea de lectura nunca se redirige', () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal(d({ method: m, pathname: '/backend' }), null)
})
test('no hace nada si el host no es el viejo, si AUTH_BASE_URL sigue siendo el viejo o si está mal', () => {
  assert.equal(d({ host: 'despacho-capital-juridico.vercel.app' }), null)
  assert.equal(d({ host: 'dashboard-metricas-abc123.vercel.app' }), null)   // previews: no se tocan
  assert.equal(d({ host: null }), null)
  assert.equal(d({ baseUrl: `https://${HOST_ANTIGUO}` }), null)
  assert.equal(d({ baseUrl: '' }), null); assert.equal(d({ baseUrl: undefined }), null); assert.equal(d({ baseUrl: 'no es url' }), null)
  assert.equal(d({ baseUrl: 'http://despacho.example' }), null)             // solo https
  assert.equal(destinoCanonico({ host: HOST_ANTIGUO.toUpperCase() + ':443', pathname: '/x', method: 'GET', baseUrl: NUEVA }), `${NUEVA}/x`)
})
test('el destino sale siempre de AUTH_BASE_URL: una ruta rara no lleva a otro sitio', () => {
  assert.equal(d({ pathname: '//evil.example/x' }), `${NUEVA}//evil.example/x`)
  assert.ok(d({ pathname: '/\\evil.example' }).startsWith(NUEVA))
})
