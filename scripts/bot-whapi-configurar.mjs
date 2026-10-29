// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-whapi-configurar.mjs [--simular] [--actual=<settings.json>] [--url=<https://…/api/bot/whapi>]
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-whapi-configurar.mjs --leer
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-whapi-configurar.mjs --real [--confirmar] [--url=…]
// ── Configura el webhook del canal de Whapi del bot "Capital Jurídico" (PATCH /settings) ───────────────────────────────
// Lee WHAPI_TOKEN y WHAPI_WEBHOOK_SECRETO SOLO del entorno (cargá .env.local antes en la terminal; este script no abre
// archivos .env). Nunca imprime el token ni el secreto: el header se muestra como "•••(oculto)".
//   · --simular (por defecto): NO sale a la red. Arma el cuerpo del PATCH a partir de --actual=<archivo> (lo que devolvió
//     GET /settings, guardado a mano) o, sin archivo, de una configuración vacía. Muestra el cuerpo tapado y los avisos.
//   · --leer: GET /settings (solo lectura) y lo muestra tapado. Necesita WHAPI_TOKEN.
//   · --real: GET /settings → arma el cuerpo con TODO lo leído más nuestros cambios (lib/bot/whapi/ajustes.ts: la trampa de
//     que lo omitido vuelve a su valor por defecto) → muestra la diferencia tapada. Sin --confirmar no cambia nada. Con
//     --confirmar: PATCH /settings y después POST /settings/webhook_test { type, url, mode }.
//     callback_persist pide REINICIAR el canal en el panel de whapi.cloud: el script lo avisa.
// --url: por defecto https://despacho-capital-juridico.vercel.app/api/bot/whapi (tiene que ser https y terminar en
// /api/bot/whapi). main() se exporta para scripts/test-bot-whapi.mjs.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { URL_WEBHOOK_POR_DEFECTO, armarAjustes, diferencias, taparSecretos, urlWebhookValida } from '../lib/bot/whapi/ajustes.ts'
import { HEADER_SECRETO, secretoValido, tokenValido } from '../lib/bot/whapi/config.ts'

export const BASE = 'https://gate.whapi.cloud'
const MARCADOR_SECRETO = '<WHAPI_WEBHOOK_SECRETO>'

export function parsearArgs(argv) {
  const a = { modo: 'simular', confirmar: false, url: null, actual: null }
  for (const x of argv) {
    if (x === '--simular') a.modo = 'simular'
    else if (x === '--real') a.modo = 'real'
    else if (x === '--leer') a.modo = 'leer'
    else if (x === '--confirmar') a.confirmar = true
    else if (x.startsWith('--url=')) a.url = x.slice(6)
    else if (x.startsWith('--actual=')) a.actual = x.slice(9)
    else throw new Error(`argumento desconocido: ${x.split('=')[0]}`)
  }
  return a
}

const mostrar = (x) => JSON.stringify(taparSecretos(x), null, 2)

async function pedir(f, token, metodo, ruta, cuerpo) {
  const res = await f(`${BASE}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  const texto = await res.text()
  let json = null
  try { json = texto ? JSON.parse(texto) : {} } catch { json = null }
  if (!res.ok) throw new Error(`Whapi ${metodo} ${ruta}: HTTP ${res.status}`)
  if (json === null) throw new Error(`Whapi ${metodo} ${ruta}: la respuesta no es JSON`)
  return json
}

/** Devuelve el código de salida. `entorno`: { env, fetch, salida } para los tests. */
export async function main(argv, entorno = {}) {
  const env = entorno.env ?? process.env
  const f = entorno.fetch ?? ((u, i) => globalThis.fetch(u, i))
  const salida = entorno.salida ?? ((t) => console.log(t))
  let a
  try {
    a = parsearArgs(argv)
  } catch (e) {
    salida(`✖ ${e.message}`)
    return 1
  }
  const url = urlWebhookValida(a.url ?? URL_WEBHOOK_POR_DEFECTO)
  if (!url) {
    salida('✖ --url tiene que ser https, sin usuario, clave ni query, y terminar en /api/bot/whapi')
    return 1
  }
  const secretoEnv = (env.WHAPI_WEBHOOK_SECRETO ?? '').trim()
  const token = (env.WHAPI_TOKEN ?? '').trim()

  if (a.modo === 'simular') {
    let actual = {}
    if (a.actual) {
      try {
        actual = JSON.parse(readFileSync(a.actual, 'utf8'))
      } catch {
        salida('✖ --actual: no se pudo leer el archivo como JSON')
        return 1
      }
    }
    const secreto = secretoValido(secretoEnv) ? secretoEnv : MARCADOR_SECRETO
    const { cuerpo, avisos } = armarAjustes(actual, { url, secreto })
    salida('SIMULACIÓN: no se llamó a Whapi. Este es el PATCH /settings que se mandaría (valores secretos tapados):')
    salida(mostrar(cuerpo))
    if (!a.actual) salida('Nota: sin --actual se parte de una configuración vacía. Con --real se parte de lo que devuelve GET /settings.')
    if (secreto === MARCADOR_SECRETO) salida('Nota: WHAPI_WEBHOOK_SECRETO no está (o es corto): en real hace falta uno de 24+ caracteres.')
    for (const x of avisos) salida(`⚠ ${x}`)
    return 0
  }

  if (!tokenValido(token)) {
    salida('✖ Falta WHAPI_TOKEN en el entorno (o tiene una forma imposible). Cargá .env.local en la terminal y repetí.')
    return 1
  }
  if (a.modo === 'leer') {
    try {
      salida(mostrar(await pedir(f, token, 'GET', '/settings')))
      return 0
    } catch (e) {
      salida(`✖ ${e.message}`)
      return 1
    }
  }

  // --real
  if (!secretoValido(secretoEnv)) {
    salida('✖ Falta WHAPI_WEBHOOK_SECRETO (24+ caracteres imprimibles, sin espacios). Generalo, cargalo en .env.local y en Vercel, y repetí.')
    return 1
  }
  let actual
  try {
    actual = await pedir(f, token, 'GET', '/settings')
  } catch (e) {
    salida(`✖ No se pudo leer la configuración actual: ${e.message}. No se cambió nada.`)
    return 1
  }
  const { cuerpo, avisos } = armarAjustes(actual, { url, secreto: secretoEnv })
  const cambios = diferencias(actual, cuerpo)
  salida(cambios.length ? `Cambios (tapados):\n${cambios.map((c) => `  · ${c}`).join('\n')}` : 'No hay nada para cambiar.')
  for (const x of avisos) salida(`⚠ ${x}`)
  if (!a.confirmar) {
    salida('No se cambió nada: repetí con --confirmar para mandar el PATCH /settings.')
    return 0
  }
  try {
    const r = await pedir(f, token, 'PATCH', '/settings', cuerpo)
    const cambiados = Array.isArray(r?.changes) ? r.changes.join(', ') : '(Whapi no dijo qué cambió)'
    salida(`✔ PATCH /settings: cambió ${cambiados}`)
  } catch (e) {
    salida(`✖ ${e.message}. Revisá con --leer qué quedó.`)
    return 1
  }
  try {
    // Con el header del secreto (webhook_test tiene su propio campo headers y no usa los del webhook guardado: sin esto la
    // prueba llegaba sin x-cj-bot-secreto y la ruta respondía 401, igual que si el secreto de Vercel fuera otro)
    const t = await pedir(f, token, 'POST', '/settings/webhook_test', cuerpoPrueba(url, secretoEnv))
    salida(t?.success === true
      ? '✔ Webhook de prueba enviado. En el log de /api/bot/whapi en Vercel tiene que aparecer una línea "bot-whapi: …" SIN "(401)" ni "(503)" (la prueba no trae mensajes de los grupos: 200 con 0 eventos). Un 401 ahí = el WHAPI_WEBHOOK_SECRETO de Vercel no es el de .env.local.'
      : '⚠ El webhook de prueba no confirmó success: revisá el panel de whapi.cloud.')
  } catch (e) {
    salida(`⚠ El webhook de prueba falló: ${e.message}`)
  }
  if (avisos.some((x) => x.includes('REINICIAR'))) salida('⚠ Falta reiniciar el canal en whapi.cloud para que tome callback_persist.')
  return 0
}

/** Cuerpo de POST /settings/webhook_test: con el header del secreto (puro; lo prueba scripts/test-bot-whapi.mjs). */
export function cuerpoPrueba(url, secreto) {
  return { type: 'messages', url, mode: 'body', headers: { [HEADER_SECRETO]: secreto } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
