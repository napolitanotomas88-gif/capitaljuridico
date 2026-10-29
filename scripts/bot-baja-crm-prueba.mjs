// node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-baja-crm-prueba.mjs A123 [--real]
// ── Prueba del paso CRM de la etapa Bajas (lib/bot/bajas/crm.ts) contra el CRM de verdad ─────────────────────────────────
//   · sin --real (por defecto): SOLO LEE. Resuelve las columnas, busca la fila del ID y muestra exactamente lo que escribiría.
//   · --real: escribe, pero SOLO si la fila es de prueba (nombre que empieza con "PRUEBA BOT"): soloPrueba siempre prendido.
//     Después relee y verifica. Para volverla atrás: Estado = ACTIVO, borrar Fecha de baja y la nota agregada.
// Nunca imprime credenciales; los nombres se muestran recortados.
import { marcarBajaCrm, PREFIJO_PRUEBA } from '../lib/bot/bajas/crm.ts'
import { planillaCrmReal } from '../lib/bot/alta/crmEscribir.ts'

const args = process.argv.slice(2)
const id = args.find((a) => /^[A-Za-z]\d{1,5}$/.test(a))
const real = args.includes('--real')
if (!id) { console.log('Uso: … scripts/bot-baja-crm-prueba.mjs <ID del CRM> [--real]'); process.exit(1) }
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
const planilla = planillaCrmReal()
// El nombre esperado sale de la misma fila (la prueba es del paso de escritura, no del cruce)
const [cab, filas] = await planilla.leer(["'Agencia'!1:1", "'Agencia'!A2:C2000"], 'FORMULA')
const iEstado = (cab[0] ?? []).findIndex((h) => String(h).trim().toLowerCase() === 'estado')
const fila = filas.find((f) => String(f[0] ?? '').trim().toUpperCase() === id.toUpperCase())
if (!fila) { console.log(`✖ El ID ${id} no está en Agencia`); process.exit(1) }
const nombre = String(fila[iEstado - 1] ?? '')
if (real && !nombre.toUpperCase().startsWith(PREFIJO_PRUEBA)) { console.log(`✖ --real solo sobre filas "${PREFIJO_PRUEBA}…"`); process.exit(1) }
const r = await marcarBajaCrm(planilla, { id, nombre, fecha: hoy, nota: 'No renueva: prueba del bot (borrar).' }, { modo: real ? 'real' : 'simulacion', soloPrueba: real })
console.log(`${r.estado === 'error' ? '✖' : '✔'} ${r.estado}: ${r.detalle}`)
for (const e of r.escrituras) console.log(`  ${e.range} ← ${JSON.stringify(e.values[0][0]).slice(0, 120)}`)
