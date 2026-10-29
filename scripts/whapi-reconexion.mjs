// Sólo GET de diagnóstico o QR privado. Nunca configura el canal, habilita flags ni envía mensajes.
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/whapi-reconexion.mjs --leer --env=/ruta/.env.local --privado=/ruta/privada
// --qr genera/renueva el QR temporal del canal existente; escanearlo exige el WhatsApp de su dueño.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, lstatSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { leerSalud } from '../lib/bot/whapi/salud.ts'
const BASE = 'https://gate.whapi.cloud'
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export function parsearReconexion(argv) {
  const op = { modo: null, env: null, privado: null }
  for (const x of argv) {
    if (x === '--leer' || x === '--qr') { if (op.modo) throw new Error('Elegí sólo --leer o --qr.'); op.modo = x.slice(2) }
    else if (x.startsWith('--env=')) op.env = x.slice(6)
    else if (x.startsWith('--privado=')) op.privado = x.slice(10)
    else throw new Error('Argumento no reconocido.')
  }
  if (!op.modo || !op.env || !op.privado || !isAbsolute(op.env) || !isAbsolute(op.privado)) throw new Error('Indicá --leer o --qr, --env=/ruta/absoluta y --privado=/ruta/absoluta.')
  return op
}
const seguroWebhook = w => {
  let url = '[inválida]'
  try { const u = new URL(w.url); url = `${u.origin}${/\/api\/bot\/whapi\/?$/.test(u.pathname) ? u.pathname : '/[oculto]'}` } catch { /* no se muestra la entrada */ }
  return { url, mode: w.mode, events: w.events, maxAge: w.webhook_max_age_seconds }
}
export async function inspeccionarReconexion(env, { qr = false, fetch: pedir = globalThis.fetch, ahora = () => new Date(), guardarQr } = {}) {
  const token = env.WHAPI_TOKEN?.trim()
  if (!token) throw new Error('Falta WHAPI_TOKEN en el archivo de entorno indicado.')
  const get = ruta => pedir(`${BASE}${ruta}`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: ruta.startsWith('/users/login/image') ? 'image/png' : 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(25000) })
  const r = await get('/health')
  if (!r.ok) throw new Error(`No se pudo leer la salud del canal: HTTP ${r.status}.`)
  const h = await r.json(), salud = leerSalud(h, ahora().getTime())
  const out = { cuando: ahora().toISOString(), salud: { http: r.status, estado: salud.estado, codigo: salud.codigo, conectado: salud.ok, baneado: salud.baneado, canalCoincide: env.WHAPI_CANAL_ID ? h.channel_id === env.WHAPI_CANAL_ID : null, numeroDisponible: !!h.user }, envios: 0, qrGenerado: false }
  const rs = await get('/settings')
  if (!rs.ok) throw new Error(`No se pudo leer la configuración: HTTP ${rs.status}.`)
  const s = await rs.json()
  out.ajustes = { callback_persist: s.callback_persist, full_history: s.full_history, auto_read_messages: s.auto_read_messages, media_auto_download: s.media?.auto_download, webhooks: Array.isArray(s.webhooks) ? s.webhooks.map(w => ({ ...seguroWebhook(w), secretoCoincide: !!env.WHAPI_WEBHOOK_SECRETO && w.headers?.['x-cj-bot-secreto'] === env.WHAPI_WEBHOOK_SECRETO })) : [] }
  if (!qr) return out
  if (!env.WHAPI_CANAL_ID || out.salud.canalCoincide !== true) throw new Error('No se confirmó el canal esperado. No se pidió un QR.')
  if (salud.baneado) throw new Error('El canal informa suspensión. No se pidió un QR: revisar primero la cuenta del número.')
  if (salud.ok) { out.nota = 'El canal ya está conectado. No se pidió otro QR.'; return out }
  if (!['LAUNCH', 'QR'].includes(salud.estado ?? '') || salud.codigo !== null && ![2, 3].includes(salud.codigo)) throw new Error('No se confirmó el canal en estado de vinculación. No se pidió un QR.')
  if (!guardarQr) throw new Error('Falta un destino privado para el QR.')
  const imagen = await get('/users/login/image?wakeup=true&width=500&height=500')
  if (!imagen.ok) throw new Error(`No se pudo preparar el QR: HTTP ${imagen.status}.`)
  const bytes = Buffer.from(await imagen.arrayBuffer())
  if (!bytes.subarray(0, PNG.length).equals(PNG)) throw new Error('La respuesta del QR no es una imagen PNG; no se guardó.')
  await guardarQr(bytes)
  out.qrGenerado = true
  out.nota = 'QR privado y temporal. Regenerar al escanear. El QR no acredita vinculación; comprobar AUTH luego. Las colas y flags no fueron modificados.'
  return out
}
function guardarPrivado(dir, nombre, bytes) {
  const destino = resolve(dir, nombre)
  try { if (lstatSync(destino).isSymbolicLink()) throw new Error('El destino privado no puede ser un enlace simbólico.') } catch (e) { if (e.code !== 'ENOENT') throw e }
  writeFileSync(destino, bytes, { mode: 0o600 }); chmodSync(destino, 0o600)
}
export async function main(argv, { salida = console.log } = {}) {
  let op
  try {
    op = parsearReconexion(argv)
    // La ruta y sus padres deben ser controlados por el operador; no se guardan tokens ni .env.
    try { if (lstatSync(op.privado).isSymbolicLink()) throw new Error('El directorio privado no puede ser un enlace simbólico.') } catch (e) { if (e.code !== 'ENOENT') throw e }
    mkdirSync(op.privado, { recursive: true, mode: 0o700 }); chmodSync(op.privado, 0o700)
    const env = parseEnv(readFileSync(op.env, 'utf8'))
    const out = await inspeccionarReconexion(env, { qr: op.modo === 'qr', guardarQr: bytes => guardarPrivado(op.privado, 'reconexion-qr.png', bytes) })
    guardarPrivado(op.privado, 'estado.json', JSON.stringify(out, null, 2) + '\n')
    salida(JSON.stringify(out, null, 2))
    return 0
  } catch (e) {
    // Errores externos pueden incluir URLs o credenciales: sólo se publican nuestros mensajes controlados.
    const mensaje = /^(Indicá |Elegí |Argumento |Falta WHAPI_TOKEN|No se pudo leer la salud|No se pudo leer la configuración|No se confirmó el canal|El canal informa suspensión|Falta un destino privado|No se pudo preparar el QR|La respuesta del QR|El destino privado|El directorio privado)/.test(e.message ?? '') ? e.message : `No se pudo completar la inspección (${e.name || 'error'}).`
    salida(mensaje); return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2))
