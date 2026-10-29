// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/guiones-local.mjs [--una]
// Trabajador LOCAL de la etapa Guiones (decisión de Tomás del 25/10/2026): arma las tandas en su Mac con su plan Max
// (`claude -p`, Opus 5.5, esfuerzo medio) en vez de la API. Lo corre launchd cada 10 minutos
// (~/Library/LaunchAgents/com.skyward.guiones-local.plist). Toma de Neon (tandasParaLocal):
//   · pendiente   → mercado → plan → guiones → revisión → corrección → a_revisar + aviso al grupo de guiones (WhatsApp);
//   · con_notas   → la corrección automática con lo que respondió el cliente → a_revisar + aviso;
//   · una colgada (estado de trabajo sin moverse > 330 s) → sigue desde lo que falta.
// Corre los mismos pasos que el Despacho (proceso.ts), pero en este proceso: «disparar» encola y una cola los va corriendo de
// a 3. Escribe en la misma base y avisa por el mismo grupo. Un candado (archivo) evita dos corridas a la vez.
// Necesita: .env.local con DATABASE_URL y WHAPI (para el aviso) y CLAUDE_CODE_OAUTH_TOKEN (lo genera Tomás con
// `claude setup-token`) o el `claude` de la Mac con sesión iniciada. NUNCA usa la API: GUIONES_LLM=cli y motor-cli.ts saca
// las claves de la API del entorno de `claude -p`. No imprime claves.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { tomarCandado } from './lib/guiones-candado.mjs'

const RAIZ = new URL('../', import.meta.url).pathname
const UNA = process.argv.includes('--una')
const DIR = join(homedir(), 'Library/Logs/guiones-local'); mkdirSync(DIR, { recursive: true })
const LOG = join(DIR, 'guiones-local.log')
const CANDADO = join(DIR, 'corriendo.lock')
const log = m => { const l = `${new Date().toISOString()} ${m}`; console.log(l); appendFileSync(LOG, l + '\n') }

for (const linea of readFileSync(join(RAIZ, '.env.local'), 'utf8').split('\n')) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m || process.env[m[1]]) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  process.env[m[1]] = v
}
process.env.GUIONES_LLM = 'cli'
// Autorizado por Tomás el 28/10: Claude principal; Codex con su sesión ChatGPT como respaldo.
// Para deshabilitar solo el relevo: GUIONES_CLI_RESPALDO=off en .env.local.
process.env.GUIONES_CLI_RESPALDO ??= 'codex'

if (process.argv.includes('--diagnostico')) {
  const { binCodex } = await import('../lib/bot/guiones/motor-codex.ts')
  const { entornoMotor } = await import('../lib/bot/guiones/proceso-cli.ts')
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(binCodex(), ['login', 'status'], { env: entornoMotor(), encoding: 'utf8', timeout: 10_000 })
  const listo = r.status === 0 && /logged in using ChatGPT/i.test(`${r.stdout ?? ''} ${r.stderr ?? ''}`)
  console.log(JSON.stringify({ principal: 'claude', respaldo: process.env.GUIONES_CLI_RESPALDO, codex_chatgpt_listo: listo, cadencia_segundos: 600 }))
  process.exit(listo ? 0 : 1)
}

const soltar = tomarCandado(CANDADO)
if (!soltar) process.exit(0)
process.on('exit', soltar); process.on('SIGTERM', () => process.exit(0)); process.on('SIGINT', () => process.exit(0))
writeFileSync(join(DIR, 'runtime.json'), JSON.stringify({ version: 'respaldo-codex-20261028', pid: process.pid,
  iniciado: new Date().toISOString(), principal: 'claude', respaldo: process.env.GUIONES_CLI_RESPALDO }), { mode: 0o600 })

const reg = await import('../lib/bot/guiones/registro.ts')
const { correrPaso } = await import('../lib/bot/guiones/proceso.ts')
const { depsReales } = await import('../lib/bot/guiones/servidor.ts')

const tandas = await reg.tandasParaLocal().catch(e => { log(`no se pudo leer la base: ${e?.message}`); return [] })
if (!tandas.length) process.exit(0)

for (const t of tandas) {
  log(`tanda ${t.id} (${t.cliente ?? 's/n'}) en ${t.estado}`)
  // Los motores pueden tardar más que VENCIDO_S: avisar que el trabajador sigue vivo.
  const pulso = setInterval(() => { void reg.tocar(t.id).catch(() => log(`no se pudo renovar el pulso de tanda ${t.id}`)) }, 60_000)
  pulso.unref()
  try {
  const cola = []
  const deps = { ...depsReales('local'), disparar: async (paso, d) => { cola.push({ paso, ...d }) }, ahora: () => Date.now() }
  // Por dónde arrancar
  if (t.estado === 'pendiente') { if (await reg.avanzar(t.id, 'pendiente', 'mercado')) cola.push({ paso: 'mercado', id: t.id }) }
  else if (t.estado === 'con_notas') cola.push({ paso: 'notas', id: t.id })
  else if (t.estado === 'mercado' || t.estado === 'plan') { await reg.tocar(t.id); cola.push({ paso: t.estado, id: t.id }) }
  else if (t.estado === 'escribiendo') {
    await reg.tocar(t.id)
    for (const f of t.plan ?? []) {
      const est = t.guiones[String(f.numero)]?.estado
      if (est !== 'listo') cola.push({ paso: est === 'escrito' ? 'revisar' : est === 'corrigiendo' ? 'corregir' : 'guion', id: t.id, numero: f.numero })
    }
  } else if (t.estado === 'corrigiendo') { if (await reg.marcarEstado(t.id, ['corrigiendo'], 'con_notas')) cola.push({ paso: 'notas', id: t.id }) }
  // La cola, de a 3 en paralelo (cada paso puede encolar los siguientes)
  const corriendo = new Set()
  while (cola.length || corriendo.size) {
    while (cola.length && corriendo.size < 3) {
      const p = cola.shift()
      const tarea = correrPaso(p.paso, { id: p.id, numero: p.numero }, Date.now(), deps)
        .then(r => log(`  ${p.paso}${p.numero ? ` ${p.numero}` : ''} → ${r}`))
        .catch(e => log(`  ${p.paso}${p.numero ? ` ${p.numero}` : ''} falló: ${String(e?.message ?? e).slice(0, 200)}`))
        .finally(() => corriendo.delete(tarea))
      corriendo.add(tarea)
    }
    if (corriendo.size) await Promise.race(corriendo)
  }
  const fin = await reg.leerTanda(t.id)
  log(`tanda ${t.id} quedó en ${fin?.estado}${fin?.error ? ` (${fin.error})` : ''}`)
  } finally { clearInterval(pulso) }
  if (UNA) break
}
