// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/limpiar-cliente-prueba-exito.mjs [--simular] [--id Z001]
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/limpiar-cliente-prueba-exito.mjs --real [--id Z001]
// ── Borra TODO rastro de la corrida de prueba de la etapa ÉXITO (clientes de BOT_CLIENTES_PRUEBA) ───────────────────────────
// Pedido de Tomás (1/11/2026): probar el caminito con un cliente ficticio "y luego borrar todo así no queda rastro".
//   · --simular (por defecto): solo LEE (Neon) y dice qué borraría. No borra nada, no toca WhatsApp ni Discord.
//   · --real: borra, en este orden:
//       1. los mensajes que mandó el bot por el cliente de prueba (cj_prueba_rastros, etapa 'exito'): WhatsApp con
//          DELETE /messages/{id} de Whapi (solo si GET /health dice AUTH; de a uno, con pausa) y Discord con
//          DELETE <webhook>/messages/{id}. Solo ids que el bot anotó: nunca un mensaje de otra persona;
//       2. las filas de Neon de esos clientes: cj_exito_pedidos, cj_exito_testimonios, cj_exito_senales (también las
//          respuestas dudosas asignadas a ellos), cj_exito_encuestas y los lotes de prueba (cj_exito_lotes, mes "-prueba");
//       3. los rastros ya borrados. Un rastro que no se pudo borrar (WhatsApp caído, sin id) queda y se lista para hacerlo a mano.
// IDs: --id Z001[,Z002] o, si no, BOT_CLIENTES_PRUEBA del entorno. Sin IDs no hace nada. Lee DATABASE_URL, WHAPI_TOKEN y
// DISCORD_WEBHOOK_CLIENTES SOLO del entorno y nunca los imprime. main() se exporta para scripts/test-bot-exito-prueba.mjs.
// Lo que el bot NO puede borrar (queda a mano): el grupo de WhatsApp de prueba y los mensajes que escribió el "cliente".
import { pathToFileURL } from 'node:url'
import { neon } from '@neondatabase/serverless'

const BASE_WHAPI = 'https://gate.whapi.cloud'
const PATRON_ID = /^[A-Za-z]\d{1,6}$/
const ETAPA = 'exito'

export function parsearArgs(argv, env = process.env) {
  const a = { modo: 'simular', ids: [] }
  let idsArg = null
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === '--simular') a.modo = 'simular'
    else if (x === '--real') a.modo = 'real'
    else if (x === '--id') idsArg = argv[++i] ?? ''
    else if (x.startsWith('--id=')) idsArg = x.slice(5)
    else throw new Error(`argumento desconocido: ${x.split('=')[0]}`)
  }
  const crudos = (idsArg ?? env.BOT_CLIENTES_PRUEBA ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
  const malos = crudos.filter((x) => !PATRON_ID.test(x))
  if (malos.length) throw new Error(`ID(s) que no son del CRM: ${malos.length}`)
  a.ids = [...new Set(crudos.map((x) => x.toUpperCase()))]
  return a
}

const faltaTabla = (e) => e?.code === '42P01' || /relation "\w+" does not exist/i.test(e?.message ?? '')
async function filas(p) { try { return await p } catch (e) { if (faltaTabla(e)) return []; throw e } }

/** Lo que hay para borrar (solo lectura). */
export async function inventario(q, ids) {
  const conteo = async (p) => Number((await filas(p))[0]?.n ?? 0)
  return {
    rastros: (await filas(q`SELECT id, tipo, destino, ref FROM cj_prueba_rastros WHERE etapa = ${ETAPA} AND borrado IS NULL AND string_to_array(id_crm, ',') && ${ids}::text[] ORDER BY id`)).map((r) => ({ id: String(r.id), tipo: String(r.tipo), destino: String(r.destino), ref: r.ref ? String(r.ref) : null })),
    pedidos: await conteo(q`SELECT count(*) AS n FROM cj_exito_pedidos WHERE clave = ANY(${ids}::text[]) OR upper(id_crm) = ANY(${ids}::text[])`),
    testimonios: await conteo(q`SELECT count(*) AS n FROM cj_exito_testimonios WHERE clave = ANY(${ids}::text[])`),
    senales: await conteo(q`SELECT count(*) AS n FROM cj_exito_senales WHERE clave = ANY(${ids}::text[]) OR (tipo = 'dudosa' AND upper(detalle ->> 'idCliente') = ANY(${ids}::text[]))`),
    encuestas: await conteo(q`SELECT count(*) AS n FROM cj_exito_encuestas WHERE clave = ANY(${ids}::text[]) OR upper(id_crm) = ANY(${ids}::text[])`),
    lotes: await conteo(q`SELECT count(*) AS n FROM cj_exito_lotes WHERE mes LIKE '%-prueba'`),
  }
}

async function borrarFilas(q, ids) {
  await filas(q`DELETE FROM cj_exito_testimonios WHERE clave = ANY(${ids}::text[])`)
  await filas(q`DELETE FROM cj_exito_pedidos WHERE clave = ANY(${ids}::text[]) OR upper(id_crm) = ANY(${ids}::text[])`)
  await filas(q`DELETE FROM cj_exito_senales WHERE clave = ANY(${ids}::text[]) OR (tipo = 'dudosa' AND upper(detalle ->> 'idCliente') = ANY(${ids}::text[]))`)
  await filas(q`DELETE FROM cj_exito_encuestas WHERE clave = ANY(${ids}::text[]) OR upper(id_crm) = ANY(${ids}::text[])`)
  await filas(q`DELETE FROM cj_exito_lotes WHERE mes LIKE '%-prueba'`)
}

async function whapiSano(f, token) {
  try {
    const r = await f(`${BASE_WHAPI}/health`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return false
    const j = await r.json().catch(() => null)
    const t = String(j?.status?.text ?? j?.status ?? '').toUpperCase()
    return (j?.status?.code === 4 || t === 'AUTH') && !/banned/i.test(JSON.stringify(j ?? ''))
  } catch { return false }
}

export async function main(argv, entorno = {}) {
  const salida = entorno.salida ?? ((t) => console.log(t))
  const env = entorno.env ?? process.env
  const f = entorno.fetch ?? fetch
  const esperar = entorno.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  let a
  try { a = parsearArgs(argv, env) } catch (e) { salida(`✖ ${e.message}`); return 1 }
  if (!a.ids.length) { salida('✖ No hay clientes de prueba: pasá --id Z001 o cargá BOT_CLIENTES_PRUEBA en el entorno.'); return 1 }
  const url = env.DATABASE_URL?.trim()
  if (!url && !entorno.sql) { salida('✖ Falta DATABASE_URL en el entorno.'); return 1 }
  const q = entorno.sql ?? neon(url, { fetchOptions: { signal: AbortSignal.timeout(20_000) } })

  const inv = await inventario(q, a.ids)
  const wa = inv.rastros.filter((r) => r.tipo === 'whatsapp'), dc = inv.rastros.filter((r) => r.tipo === 'discord')
  salida(`Clientes de prueba: ${a.ids.join(', ')} · etapa Éxito`)
  salida(`  Mensajes del bot: ${wa.length} de WhatsApp (${wa.filter((r) => !r.ref).length} sin id), ${dc.length} de Discord`)
  salida(`  Neon: ${inv.pedidos} pedido(s), ${inv.testimonios} testimonio(s), ${inv.senales} señal(es), ${inv.encuestas} ronda(s) de encuesta, ${inv.lotes} lote(s) de prueba`)
  if (a.modo === 'simular') { salida('Simulación: no se borró nada. Para borrar: --real'); return 0 }

  const borrados = [], quedan = []
  // 1a. WhatsApp: solo con el número sano, de a uno y con pausa (WhatsApp seguro)
  const token = env.WHAPI_TOKEN?.trim()
  const conId = wa.filter((r) => r.ref)
  quedan.push(...wa.filter((r) => !r.ref).map((r) => ({ ...r, motivo: 'sin id (envío dudoso): revisar el chat a mano' })))
  if (conId.length) {
    if (!token) quedan.push(...conId.map((r) => ({ ...r, motivo: 'falta WHAPI_TOKEN' })))
    else if (!(await whapiSano(f, token))) quedan.push(...conId.map((r) => ({ ...r, motivo: 'el número del bot no está conectado (health)' })))
    else {
      for (const r of conId) {
        try {
          const res = await f(`${BASE_WHAPI}/messages/${encodeURIComponent(r.ref)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
          await res.body?.cancel?.().catch?.(() => {})
          if (res.ok || res.status === 404) borrados.push(r)
          else quedan.push({ ...r, motivo: `Whapi respondió ${res.status}` })
        } catch { quedan.push({ ...r, motivo: 'Whapi no respondió' }) }
        await esperar(1_500)
      }
    }
  }
  // 1b. Discord
  const webhook = env.DISCORD_WEBHOOK_CLIENTES?.trim()
  for (const r of dc) {
    if (!r.ref) { quedan.push({ ...r, motivo: 'sin id' }); continue }
    if (!webhook) { quedan.push({ ...r, motivo: 'falta DISCORD_WEBHOOK_CLIENTES' }); continue }
    try {
      const res = await f(`${webhook}/messages/${encodeURIComponent(r.ref)}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
      if (res.ok || res.status === 404) borrados.push(r)
      else quedan.push({ ...r, motivo: `Discord respondió ${res.status}` })
    } catch { quedan.push({ ...r, motivo: 'Discord no respondió' }) }
  }
  // 2. Neon
  await borrarFilas(q, a.ids)
  // 3. Rastros borrados
  const idsBorrados = borrados.map((r) => r.id)
  if (idsBorrados.length) await filas(q`DELETE FROM cj_prueba_rastros WHERE id = ANY(${idsBorrados}::bigint[])`)
  salida(`Borrado: ${borrados.filter((r) => r.tipo === 'whatsapp').length} mensaje(s) de WhatsApp, ${borrados.filter((r) => r.tipo === 'discord').length} de Discord y las filas de Neon de la etapa.`)
  if (quedan.length) {
    salida(`Quedan ${quedan.length} rastro(s) para hacer a mano (siguen anotados en cj_prueba_rastros; volvé a correr --real cuando se pueda):`)
    for (const r of quedan) salida(`  · ${r.tipo} #${r.id}: ${r.motivo}`)
  }
  salida('A mano: el grupo de WhatsApp de prueba y los mensajes que escribió el "cliente" (el bot no los puede borrar).')
  return quedan.length ? 2 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`✖ ${String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 200)}`); process.exit(1) })
}
