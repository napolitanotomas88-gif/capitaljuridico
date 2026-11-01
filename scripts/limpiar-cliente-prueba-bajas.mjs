// node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/limpiar-cliente-prueba-bajas.mjs Z001 [Z002…] [--simular | --real]
// ── Limpieza del cliente de PRUEBA en la etapa Bajas (lib/bot/bajas/limpieza.ts) ────────────────────────────────────────
// Borra todo rastro que dejó la corrida de prueba (BOT_CLIENTES_PRUEBA) de esos IDs del CRM:
//   · --simular (por defecto): SOLO LEE. Muestra cuántos mensajes, avisos, cambios del CRM y filas de Neon borraría.
//   · --real: borra los mensajes del bot en WhatsApp (con /health antes), los avisos de Discord, vuelve atrás el CRM y borra
//     las filas de Neon (cj_bajas_*). Si alguna fila de esos IDs en el CRM NO es "PRUEBA BOT…", no toca nada.
// Sin IDs en la línea de comandos usa BOT_CLIENTES_PRUEBA. Nunca imprime tokens, teléfonos ni textos.
// main() se exporta para scripts/test-bot-bajas-prueba.mjs.
import { pathToFileURL } from 'node:url'

export function parsearArgs(argv, env = process.env) {
  const a = { modo: 'simular', ids: [] }
  for (const x of argv) {
    if (x === '--simular') a.modo = 'simular'
    else if (x === '--real') a.modo = 'real'
    else if (/^[A-Za-z]\d{1,6}$/.test(x)) a.ids.push(x.toUpperCase())
    else throw new Error(`argumento desconocido: ${x.slice(0, 20)}`)
  }
  if (!a.ids.length) a.ids = (env.BOT_CLIENTES_PRUEBA ?? '').split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]\d{1,6}$/.test(s))
  return a
}

/** Las dependencias reales (Neon, CRM, Whapi, Discord). */
export async function depsReales(env = process.env) {
  const { neon } = await import('@neondatabase/serverless')
  const { almacenBajasNeon } = await import('../lib/bot/bajas/almacenNeon.ts')
  const { nombreDePrueba } = await import('../lib/bot/bajas/prueba.ts')
  const { columnasDeClientes } = await import('../lib/clientes/parsear.ts')
  const url = env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(15_000) } })
  const almacen = almacenBajasNeon()
  const sinTabla = (e) => e?.code === '42P01'
  const contarUna = async (f) => { try { return Number((await f())[0]?.n ?? 0) } catch (e) { if (sinTabla(e)) return 0; throw e } }
  const borrarUna = async (f) => { try { return (await f()).length } catch (e) { if (sinTabla(e)) return 0; throw e } }
  let planilla = null
  const crm = async () => (planilla ??= (await import('../lib/bot/alta/crmEscribir.ts')).planillaCrmReal())
  const token = env.WHAPI_TOKEN?.trim()
  const webhook = env.DISCORD_WEBHOOK_CLIENTES?.trim()
  const fallo = async (res, que) => { await res.body?.cancel().catch(() => {}); throw Object.assign(new Error(`${que} respondió ${res.status}`), { status: res.status }) }
  return {
    esPrueba: nombreDePrueba,
    rastros: (ids) => almacen.rastrosDe(ids),
    async contar(ids) {
      return {
        pedidos: await contarUna(() => q`SELECT count(*)::int AS n FROM cj_bajas_pedidos WHERE upper(id_crm) = ANY(${ids}::text[])`),
        bajas: await contarUna(() => q`SELECT count(*)::int AS n FROM cj_bajas_bajas WHERE upper(id_crm) = ANY(${ids}::text[])`),
        llamadas: await contarUna(() => q`SELECT count(*)::int AS n FROM cj_bajas_llamadas WHERE upper(clave) = ANY(${ids}::text[])`),
        recontactos_prueba: await contarUna(() => q`SELECT count(*)::int AS n FROM cj_bajas_recontactos WHERE mes LIKE 'prueba:%'`),
        rastros: await contarUna(() => q`SELECT count(*)::int AS n FROM cj_bajas_rastros WHERE upper(id_crm) = ANY(${ids}::text[])`),
      }
    },
    async borrar(ids, conRastros) {
      return {
        pedidos: await borrarUna(() => q`DELETE FROM cj_bajas_pedidos WHERE upper(id_crm) = ANY(${ids}::text[]) RETURNING id`),
        bajas: await borrarUna(() => q`DELETE FROM cj_bajas_bajas WHERE upper(id_crm) = ANY(${ids}::text[]) RETURNING id`),
        llamadas: await borrarUna(() => q`DELETE FROM cj_bajas_llamadas WHERE upper(clave) = ANY(${ids}::text[]) RETURNING recording_id`),
        recontactos_prueba: await borrarUna(() => q`DELETE FROM cj_bajas_recontactos WHERE mes LIKE 'prueba:%' RETURNING mes`),
        rastros: conRastros ? await borrarUna(() => q`DELETE FROM cj_bajas_rastros WHERE upper(id_crm) = ANY(${ids}::text[]) RETURNING id`) : 0,
      }
    },
    async filasCrm(ids) {
      const p = await crm()
      const [cab, filas] = await p.leer(["'Agencia'!1:1", "'Agencia'!A2:AF2000"], 'FORMULA')
      const { idx } = columnasDeClientes('Agencia', cab[0])
      const txt = (c) => (c === undefined || c === null ? '' : String(c)).trim()
      return filas.map((f, i) => ({ fila: i + 2, id: txt(f[idx.id]).toUpperCase(), nombre: txt(f[idx.nombre]), estado: txt(f[idx.estado]) }))
        .filter((f) => ids.includes(f.id))
    },
    async escribirCrm(datos) { await (await crm()).escribirValores(datos) },
    whatsappSano: token ? async () => {
      const { BASE_WHAPI } = await import('../lib/bot/whapi/comun.ts')
      const { leerSalud } = await import('../lib/bot/whapi/salud.ts')
      const res = await fetch(`${BASE_WHAPI}/health`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return false }
      return leerSalud(await res.json().catch(() => null), Date.now()).ok
    } : undefined,
    borrarWhatsapp: token ? async (id) => {
      const { BASE_WHAPI } = await import('../lib/bot/whapi/comun.ts')
      const res = await fetch(`${BASE_WHAPI}/messages/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) await fallo(res, 'Whapi')
      await res.body?.cancel().catch(() => {})
    } : undefined,
    borrarDiscord: webhook ? async (id) => {
      if (!/^\d{5,25}$/.test(id)) throw new Error('id de Discord inválido')
      const res = await fetch(`${webhook.replace(/\/+$/, '').split('?')[0]}/messages/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
      if (!res.ok) await fallo(res, 'Discord')
      await res.body?.cancel().catch(() => {})
    } : undefined,
  }
}

export async function main(argv = process.argv.slice(2), op = {}) {
  const { limpiarPruebaBajas, textoInforme } = await import('../lib/bot/bajas/limpieza.ts')
  const env = op.env ?? process.env
  const a = parsearArgs(argv, env)
  if (!a.ids.length) { (op.log ?? console.log)('Uso: … scripts/limpiar-cliente-prueba-bajas.mjs Z001 [--simular | --real] (o BOT_CLIENTES_PRUEBA)'); return null }
  const deps = op.deps ?? await depsReales(env)
  const inf = await limpiarPruebaBajas(a.ids, a.modo, deps)
  ;(op.log ?? console.log)(textoInforme(inf))
  return inf
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((inf) => { if (inf?.abortado) process.exitCode = 1 }, (e) => { console.error(`✖ ${String(e?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)}`); process.exitCode = 1 })
}
