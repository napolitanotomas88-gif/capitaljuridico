// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings --test scripts/test-alertas-discord.mjs
// Migración de las alertas de WhatsApp a Discord (2/11/2026): lib/alertas (canales, personas, formato, alertarCon), el corte
// global del WhatsApp del bot (lib/bot/whapi/corte.ts), la bandeja → Discord (lib/notificaciones/discord/modelo.ts), el
// «para enviar» (lib/bot/sinWhatsapp.ts: sinCitar, generalVirtual) y el canal de las altas. SIN red ni base: el fetch global
// está bloqueado y el registro de alertas es uno en memoria. Las URLs e IDs de acá son inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const k of Object.keys(process.env)) if (/^(DISCORD_|ALERTAS_|NOTIF_|WHATSAPP_BOT|BOT_ALTA_|WHAPI_)/.test(k) || k === 'DATABASE_URL') delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const C = await import('../lib/alertas/canales.ts')
const P = await import('../lib/alertas/personas.ts')
const F = await import('../lib/alertas/formato.ts')
const A = await import('../lib/alertas/alerta.ts')
const CORTE = await import('../lib/bot/whapi/corte.ts')
const N = await import('../lib/notificaciones/discord/modelo.ts')
const CANAL = await import('../lib/bot/alta/despacho/canal.ts')
const SW = await import('../lib/bot/sinWhatsapp.ts')

const wh = (n) => `https://discord.com/api/webhooks/1234567890123456${n}/abcdefghijklmnopqrstuvwxyz_${n}`
const ID = { tomas: '100000000000000001', gero_a: '100000000000000002', gero_m: '100000000000000003', aylu: '100000000000000004', valentino: '100000000000000005' }
const envIds = { DISCORD_ID_TOMAS: ID.tomas, DISCORD_ID_GERO_A: ID.gero_a, DISCORD_ID_GERO_M: ID.gero_m, DISCORD_ID_AYLU: ID.aylu, DISCORD_ID_VALENTINO: ID.valentino }

test('canales: cada canal con su webhook; sin la variable cae a SISTEMA y después a DISCORD_WEBHOOK_URL', () => {
  const env = { DISCORD_WEBHOOK_VERIFICACIONES: wh(1), DISCORD_WEBHOOK_SISTEMA: wh(2), DISCORD_WEBHOOK_URL: wh(3) }
  assert.deepEqual(C.webhookDe('verificaciones', env), { url: wh(1), canal: 'verificaciones', sale: 'verificaciones', respaldo: false })
  assert.deepEqual(C.webhookDe('operaciones', env), { url: wh(2), canal: 'operaciones', sale: 'sistema', respaldo: true })
  assert.deepEqual(C.webhookDe('para_enviar', { DISCORD_WEBHOOK_URL: wh(3) }), { url: wh(3), canal: 'para_enviar', sale: 'respaldo', respaldo: true })
  assert.equal(C.webhookDe('ads', {}).url, null)
  // Ads acepta el alias viejo; una URL que no es de Discord no cuenta
  assert.equal(C.webhookDe('ads', { DISCORD_WEBHOOK_KICKOFF_ADS: wh(4) }).url, wh(4))
  assert.equal(C.webhookDe('finanzas', { DISCORD_WEBHOOK_FINANZAS: 'https://evil.example.com/x', DISCORD_WEBHOOK_URL: wh(3) }).url, wh(3))
  // NO hay canal de Ventas/altas para closers (Tomás, 2/11/2026)
  assert.ok(!C.CANALES.includes('altas'))
  assert.ok(!Object.values(C.VARIABLES_CANAL).flat().includes('DISCORD_WEBHOOK_ALTAS'))
  // El estado no muestra URLs
  assert.ok(!JSON.stringify(C.estadoCanales(env)).includes('discord.com'))
})

test('personas: menciones por ID; sin ID va el nombre; aprobadores = Tomás, Gero A, Gero M y Aylu (sin closers)', () => {
  const m = P.resolverMenciones(['aprobadores'], envIds)
  assert.deepEqual(m.ids, [ID.tomas, ID.gero_a, ID.gero_m, ID.aylu])
  assert.equal(P.resolverMenciones(['faus'], envIds).texto, 'Faus')
  assert.deepEqual(P.resolverMenciones(['tomas', 'aprobadores'], envIds).ids.length, 4)
  assert.deepEqual(P.idsAprobadores({ ...envIds, BOT_ALTA_APROBADORES_DISCORD: `${ID.tomas},x,${ID.aylu}` }), [ID.tomas, ID.aylu])
  assert.deepEqual(P.responsablesDe('f04', {}), ['aylu'])
  assert.deepEqual(P.responsablesDe('f04', { ALERTAS_RESPONSABLES_JSON: '{"f04":["gero_m","nadie"]}' }), ['gero_m'])
  assert.deepEqual(P.responsablesDe('f04', { ALERTAS_RESPONSABLES_JSON: 'roto' }), ['aylu'])
})

test('formato: cabecera, hasta 6 viñetas, bloque para copiar, link sin vista previa y nunca más de 1.900 caracteres', () => {
  const t = F.armarTexto({ menciones: `<@${ID.aylu}>`, emoji: '📤', titulo: 'Bienvenida', cliente: 'Ana Pérez', lineas: Array.from({ length: 9 }, (_, i) => `línea ${i}`), copiar: 'Hola Ana!\n```x```', link: 'https://despacho.example/clientes/para-enviar#m-1' })
  assert.match(t, /^<@100000000000000004> 📤 \*\*Bienvenida — Ana Pérez\*\*/)
  assert.equal((t.match(/^• /gm) ?? []).length, 6)
  assert.ok(t.includes('```\nHola Ana!'))
  assert.ok(!t.includes('```x```'))
  assert.ok(t.endsWith('➡️ <https://despacho.example/clientes/para-enviar#m-1>'))
  const largo = F.armarTexto({ menciones: '', titulo: 'x', lineas: ['a'.repeat(300)], copiar: 'b'.repeat(5000) })
  assert.ok(largo.length <= F.MAX_CARACTERES)
  assert.ok(F.armarTexto({ menciones: '', titulo: '@everyone hola' }).includes('＠everyone'))
  assert.equal(F.linkDespacho('https://d.example', '/clientes'), 'https://d.example/clientes')
  assert.equal(F.linkDespacho('https://d.example', '//evil.example'), null)
})

test('horario: de 20 a 9 h (Argentina) sale silenciosa (4096) salvo urgente', () => {
  const dia = Date.parse('2026-11-02T15:00:00Z')    // 12 h AR
  const noche = Date.parse('2026-11-03T02:00:00Z')  // 23 h AR
  assert.equal(F.flagsDe(dia, false), 4)
  assert.equal(F.flagsDe(noche, false), 4 | 4096)
  assert.equal(F.flagsDe(noche, true), 4)
})

function registroMemoria() {
  const filas = new Map()
  return {
    filas,
    async anotar(f) {
      const x = filas.get(f.clave)
      if (x && !(['error', 'sin_webhook', 'apagado'].includes(x.estado) && x.intentos < 5)) return false
      filas.set(f.clave, { ...f, estado: 'anotado', intentos: (x?.intentos ?? 0) + 1 })
      return true
    },
    async cerrar(clave, estado, mensajeId) { filas.set(clave, { ...filas.get(clave), estado, mensajeId }) },
    async enLaHora(canal) { return [...filas.values()].filter((f) => f.canal === canal && f.estado === 'enviado').length },
  }
}
const deps = (env, enviados, registro = registroMemoria()) => ({
  env, ahora: () => Date.parse('2026-11-02T15:00:00Z'), base: 'https://despacho.example', registro,
  enviar: async (url, texto, menciones, flags) => { enviados.push({ url, texto, menciones, flags }); return `msg${enviados.length}` },
  log: { warn() {}, error() {} },
})

test('alertarCon: sale una vez por clave, con las menciones declaradas, y cae al sistema sin su webhook', async () => {
  const env = { ...envIds, DISCORD_WEBHOOK_VERIFICACIONES: wh(1), DISCORD_WEBHOOK_SISTEMA: wh(2) }
  const enviados = []
  const d = deps(env, enviados)
  const a = { canal: 'verificaciones', tipo: 'alta_falta_dato', clave: 'alta:1:espera:e1', titulo: 'Alta: falta un dato', cliente: 'Ana', lineas: ['Falta el DNI'], link: '/clientes/altas?alta=alta_1#espera-e1', menciones: ['aprobadores'] }
  assert.equal((await A.alertarCon(a, d)).estado, 'enviado')
  assert.equal((await A.alertarCon(a, d)).estado, 'ya_estaba')
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].url, wh(1))
  assert.deepEqual(enviados[0].menciones, [ID.tomas, ID.gero_a, ID.gero_m, ID.aylu])
  assert.ok(enviados[0].texto.includes('https://despacho.example/clientes/altas?alta=alta_1#espera-e1'))
  // Operaciones sin webhook → sistema, con la línea «iba a»
  const r = await A.alertarCon({ canal: 'operaciones', tipo: 'tarea_manual', clave: 't1', titulo: 'Crear los 3 grupos', menciones: ['aylu'] }, d)
  assert.equal(r.estado, 'enviado')
  assert.equal(enviados[1].url, wh(2))
  assert.ok(enviados[1].texto.includes('iba a 🛠️-operaciones'))
})

test('alertarCon: ensayo va al sistema con 🧪 PRUEBA y sin notificar; apagado no sale; sin ningún webhook queda registrada', async () => {
  const enviados = []
  const env = { ...envIds, ALERTAS_DISCORD: 'ensayo', DISCORD_WEBHOOK_VERIFICACIONES: wh(1), DISCORD_WEBHOOK_SISTEMA: wh(2) }
  await A.alertarCon({ canal: 'verificaciones', tipo: 'x', clave: 'k1', titulo: 'Hola', menciones: ['tomas'] }, deps(env, enviados))
  assert.equal(enviados[0].url, wh(2))
  assert.deepEqual(enviados[0].menciones, [])
  assert.match(enviados[0].texto, /^🧪 PRUEBA/)
  const reg = registroMemoria()
  assert.equal((await A.alertarCon({ canal: 'verificaciones', tipo: 'x', clave: 'k2', titulo: 'Hola' }, deps({ ALERTAS_DISCORD: 'apagado', DISCORD_WEBHOOK_VERIFICACIONES: wh(1) }, enviados, reg))).estado, 'apagado')
  assert.equal((await A.alertarCon({ canal: 'verificaciones', tipo: 'x', clave: 'k3', titulo: 'Hola' }, deps({}, enviados, reg))).estado, 'sin_webhook')
  assert.equal(reg.filas.get('k3').estado, 'sin_webhook')
  assert.equal(enviados.length, 1)
  // Cuando aparece el webhook, la misma clave se puede volver a intentar
  assert.equal((await A.alertarCon({ canal: 'verificaciones', tipo: 'x', clave: 'k3', titulo: 'Hola' }, deps({ DISCORD_WEBHOOK_VERIFICACIONES: wh(1) }, enviados, reg))).estado, 'enviado')
})

test('alertarCon: el cliente «PRUEBA BOT…» sale a su canal con 🧪 PRUEBA y sin notificar a nadie', async () => {
  const enviados = []
  const env = { ...envIds, DISCORD_WEBHOOK_VERIFICACIONES: wh(1), DISCORD_WEBHOOK_SISTEMA: wh(2) }
  await A.alertarCon({ canal: 'verificaciones', tipo: 'alta_ok', clave: 'pb1', titulo: 'Alta: hace falta un OK', cliente: 'PRUEBA BOT Ensayo', menciones: ['aprobadores'] }, deps(env, enviados))
  assert.equal(enviados[0].url, wh(1))
  assert.deepEqual(enviados[0].menciones, [])
  assert.match(enviados[0].texto, /^🧪 PRUEBA/)
  assert.ok(!/<@\d+>/.test(enviados[0].texto))
  // Un cliente real sigue notificando
  await A.alertarCon({ canal: 'verificaciones', tipo: 'alta_ok', clave: 'pb2', titulo: 'Alta: hace falta un OK', cliente: 'Ana Prueba', menciones: ['aprobadores'] }, deps(env, enviados))
  assert.equal(enviados[1].menciones.length, 4)
  assert.ok(!enviados[1].texto.startsWith('🧪'))
})

test('alertarCon: tope de 60 por hora y canal; el exceso avisa una sola vez en el sistema', async () => {
  const enviados = []
  const env = { DISCORD_WEBHOOK_PARA_ENVIAR: wh(5), DISCORD_WEBHOOK_SISTEMA: wh(2) }
  const d = deps(env, enviados)
  for (let i = 0; i < 62; i++) await A.alertarCon({ canal: 'para_enviar', tipo: 'p', clave: `p${i}`, titulo: 'x' }, d)
  assert.equal(enviados.filter((e) => e.url === wh(5)).length, 60)
  assert.equal(enviados.filter((e) => e.url === wh(2)).length, 1)
})

const { ErrorEnvio } = await import('../lib/fathomAnuncios/discord.ts')

test('alertarCon: un 429 o un 5xx no queda «dudoso»; sale por #🧰-sistema-bot con «iba a …» y las mismas menciones (revisión 2/11)', async () => {
  const enviados = []
  const env = { ...envIds, DISCORD_WEBHOOK_VERIFICACIONES: wh(1), DISCORD_WEBHOOK_SISTEMA: wh(2) }
  const reg = registroMemoria()
  const d = { ...deps(env, enviados, reg), enviar: async (url, texto, menciones) => {
    if (url === wh(1)) throw new ErrorEnvio('Discord pidió esperar 30 s (429) y no alcanza el tiempo', [], true)
    enviados.push({ url, texto, menciones }); return 'm1'
  } }
  const r = await A.alertarCon({ canal: 'verificaciones', tipo: 'alta_ok', clave: 'r429', titulo: 'Alta: hace falta un OK', cliente: 'Ana', menciones: ['aprobadores'] }, d)
  assert.equal(r.estado, 'enviado')
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].url, wh(2))
  assert.match(enviados[0].texto, /iba a ✅-verificaciones: Discord falló/)
  assert.deepEqual(enviados[0].menciones, [ID.tomas, ID.gero_a, ID.gero_m, ID.aylu])
  // Sin respaldo: queda «error» (reintentable), no «dudoso»
  const reg2 = registroMemoria()
  const d2 = { ...deps({ DISCORD_WEBHOOK_VERIFICACIONES: wh(1) }, [], reg2), enviar: async () => { throw new ErrorEnvio('Discord respondió 429 (demasiados mensajes seguidos)', [], true) } }
  assert.equal((await A.alertarCon({ canal: 'verificaciones', tipo: 'x', clave: 'r2', titulo: 'x' }, d2)).estado, 'error')
  assert.equal(reg2.filas.get('r2').estado, 'error')
  // Un timeout esperando la respuesta SÍ es dudoso (pudo haber salido) y no se duplica por el respaldo
  const otros = []
  const d3 = { ...deps({ DISCORD_WEBHOOK_VERIFICACIONES: wh(1), DISCORD_WEBHOOK_SISTEMA: wh(2) }, otros), enviar: async (url) => { if (url === wh(1)) throw new ErrorEnvio('Discord no respondió en 10 s', [], true); otros.push(url); return 'x' } }
  assert.equal((await A.alertarCon({ canal: 'verificaciones', tipo: 'x', clave: 'r3', titulo: 'x' }, d3)).estado, 'dudoso')
  assert.equal(otros.length, 0)
  // Un 400/404 (no transitorio) tampoco va al respaldo
  const d4 = { ...deps({ DISCORD_WEBHOOK_VERIFICACIONES: wh(1), DISCORD_WEBHOOK_SISTEMA: wh(2) }, otros), enviar: async (url) => { if (url === wh(1)) throw new ErrorEnvio('Discord respondió 404', [], false); otros.push(url); return 'x' } }
  assert.equal((await A.alertarCon({ canal: 'verificaciones', tipo: 'x', clave: 'r4', titulo: 'x' }, d4)).estado, 'error')
  assert.equal(otros.length, 0)
})

test('sinCitar: los pedidos del alta no dicen «Respondé citando» en Discord', () => {
  assert.equal(SW.sinCitar('Respondé citando este mensaje, con una línea por dato.'), 'Respondelo en el Despacho: una línea por dato.')
  assert.equal(SW.sinCitar('Respondé citando este mensaje: OK para seguir'), 'Respondelo en el Despacho: OK para seguir')
})

test('corte global: sin WHATSAPP_BOT=encendido el bot no puede escribir por WhatsApp y el alta va por el Despacho', () => {
  assert.equal(CORTE.whatsappBotEncendido({}), false)
  assert.equal(CORTE.whatsappBotEncendido({ WHATSAPP_BOT: 'real' }), false)
  assert.equal(CORTE.whatsappBotEncendido({ WHATSAPP_BOT: 'encendido' }), true)
  assert.equal(CANAL.canalDesdeEntorno({ BOT_ALTA_CANAL: 'whatsapp' }), 'despacho')
  assert.equal(CANAL.canalDesdeEntorno({ BOT_ALTA_CANAL: 'whatsapp', WHATSAPP_BOT: 'encendido' }), 'whatsapp')
})

test('bandeja → Discord: lo que su bot ya avisa no se duplica; el resto va al canal de su área', () => {
  for (const t of ['altas_esperando_humano', 'guiones_a_revisar', 'guiones_entrega', 'edicion_tarjetas', 'exito_abierto', 'bajas_abierto']) assert.equal(N.mapearDiscord(t).ok, false, t)
  assert.deepEqual(N.mapearDiscord('cliente_sin_respuesta'), { ok: true, canal: 'csm', menciones: ['gero_m'], emoji: '⏳' })
  assert.equal(N.mapearDiscord('kickoff_error').canal, 'operaciones')
  assert.equal(N.mapearDiscord('anuncios_dudoso').canal, 'ads')
  assert.equal(N.modoNotifDiscord({}), 'real')
  assert.equal(N.modoNotifDiscord({ NOTIF_DISCORD: 'apagado' }), 'apagado')
})

test('sin WhatsApp: «Respondé citando» se cambia por el Despacho y el General virtual sale del ID del CRM', async () => {
  const S = await import('../lib/bot/sinWhatsapp.ts')
  assert.equal(S.sinCitar('¿Le mando el mensaje de testimonio? Respondé citando: OK / NO'), '¿Le mando el mensaje de testimonio? Respondelo en el Despacho: OK / NO')
  assert.ok(!/citando/i.test(S.sinCitar('Aylu: ¿la mando? Respondé citando: OK / NO ("OK sin mensaje" lo saca de los grupos sin despedida)')))
  assert.equal(S.generalVirtual('a123'), 'cliente:A123:general')
  assert.equal(S.generalVirtual('nombre'), null)
  // Un mensaje al cliente sin pieza nunca sale
  await assert.rejects(S.enviarTextoSinWhatsapp('exito', { chatId: 'cliente:A123:general', texto: 'hola' }), /sin pieza/)
})

test('las alertas no llevan teléfonos ni documentos (sí montos y fechas)', () => {
  const t = F.armarTexto({ menciones: '', titulo: 'Alta recibida', lineas: ['@5491155550099 Recibí el alta: USD 1.100 · tel +54 9 11 5555-0099 · DNI 30.123.456 · 2/11/2026 · fin 2026-11-30'] })
  assert.ok(!/5555|30\.123/.test(t))
  assert.ok(t.includes('USD 1.100') && t.includes('2/11/2026') && t.includes('2026-11-30') && t.includes('@closer'))
})

test('e01 y Anuncios: con el corte global no salen por WhatsApp aunque su variable siga en «real»', async () => {
  const W = await import('../lib/bot/grabacion/e01Whatsapp.ts')
  const EQ = await import('../lib/bot/anuncios/whatsappEquipo.ts')
  assert.equal(W.configE01Whatsapp({ E01_WHATSAPP: 'real', E01_WHATSAPP_DESDE: '2026-11-02' }), null)
  assert.match(W.motivoApagado({ E01_WHATSAPP: 'real', E01_WHATSAPP_DESDE: '2026-11-02' }, 'real', new Date('2026-11-03T15:00:00Z'), () => true), /WHATSAPP_BOT/)
  assert.equal(EQ.equipoEncendido({ ANUNCIOS_WHATSAPP_EQUIPO: 'real' }), false)
})

test('e01 «para enviar»: el día 0 vencido queda registrado una vez por paso, en horario y día hábil', async () => {
  const W = await import('../lib/bot/grabacion/e01Whatsapp.ts')
  const paso = { id: 7, id_crm: 'A1', cliente: 'Ana Pérez', escalon: 'dia0', debido: '2026-11-03', estado: 'abierto', hecho: null, frenado: null, texto: null, videos: [1, 2], version: 1, ciclo: '2026-11-03' }
  const registrados = []
  const deps = { pasosAbiertos: async () => [paso], docs: async () => new Map([['A1', 'doc123']]), vigente: async () => true, paraEnviar: async (p, t) => { registrados.push({ p: p.id, t }); return true }, env: {}, esHabil: () => true }
  const r = await W.paraEnviarE01(deps, { ahora: new Date('2026-11-03T15:00:00Z'), modo: 'real', deadline: Date.now() + 60_000 })
  assert.equal(r.registrados, 1)
  assert.equal(registrados[0].p, 7)
  assert.ok(registrados[0].t.length > 20)
  // de noche no
  assert.equal((await W.paraEnviarE01(deps, { ahora: new Date('2026-11-04T02:00:00Z'), modo: 'real', deadline: Date.now() + 60_000 })).apagado, 'fuera de horario (9 a 20 h)')
})
