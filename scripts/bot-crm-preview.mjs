// cd <APP_DIR> && set -a && source .env.local && set +a && \
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-crm-preview.mjs
//
// Vista previa del paso "Alta en el CRM de Clientes" del bot C.J. con un #ALTA INVENTADO, contra el CRM REAL.
// SOLO LECTURA: previsualizarAltaCrm() lee "2026 - CRM - CLIENTES" con lib/clientes/leer.ts (scope readonly,
// snapshot de 10 min en .cache/, sin reintentos) y arma el plan dry-run de planAlta(). No escribe en ninguna planilla.
// De los clientes que ya están en el CRM solo se imprimen IDs y el motivo de la coincidencia: ni nombres, ni
// teléfonos, ni mails.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(raiz)   // el snapshot vive en .cache/ de la raíz del repo
if (!process.env.SHEET_ID_CLIENTES) {
  // Por si no se cargó .env.local con source: el cargador de Next, sin imprimir nada
  const { default: nextEnv } = await import('@next/env')
  nextEnv.loadEnvConfig(raiz, true, { info: () => {}, error: () => {} })
}

const { parsearAlta } = await import('../lib/bot/alta/parsear.ts')
const { previsualizarAltaCrm } = await import('../lib/bot/alta/crmServidor.ts')
const { lecturasRealizadas } = await import('../lib/clientes/leer.ts')
const { hoyArgentina } = await import('../lib/clientes/fechas.ts')

const hoy = hoyArgentina()
const ddmmaaaa = hoy.split('-').reverse().join('/')
const MENSAJE = `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PIF 3300 USD
Este pago: 3300 USD · Transferencia USD
Nombre completo: Cliente Prueba Bot
Teléfono: +54 9 11 3000-9999
Socios: ninguno
Correo: prueba.bot@example.com
Dirección: Calle Inventada 123, CABA
DNI: 30999999
CUIT: 20-30999999-1
Inicio del servicio: ${ddmmaaaa}`

const alta = parsearAlta(MENSAJE)
let previa
try {
  previa = await previsualizarAltaCrm(alta, { mensaje: MENSAJE, hoy })
} catch (e) {
  console.error('Falló la lectura del CRM:', String(e?.message ?? e).slice(0, 300))
  process.exit(1)
}
const { plan, entrada, faltantes, bloqueos, avisos, parser, lectura, aptoParaEscribir, motivosNoApto } = previa
const lista = (xs) => (xs.length ? xs.map(x => `  - ${x}`).join('\n') : '  (ninguno)')

console.log(`Vista previa del alta en el CRM de Clientes (DRY-RUN, no se escribió nada) · ${new Date().toISOString()}`)
console.log(`Lectura: ${lectura.fuente} · snapshot del ${new Date(lectura.snapshotEn).toISOString()} (hace ${lectura.edadSeg} s) · fórmulas de Agencia: ${lectura.formulas} · llamadas a la API de Sheets en esta corrida: ${lecturasRealizadas()}`)
console.log(` avisos de la lectura:\n${lista(lectura.avisos)}`)
console.log(`\n#ALTA inventado: ${entrada.nombre} · celular ${entrada.celular} · ${entrada.mail ?? '(sin mail)'} · Día 1 ${entrada.dia1} · closer ${entrada.closer ?? '—'} · contrato ${entrada.contrato}`)
console.log(`Parser\n faltantes:\n${lista(parser.faltantes)}\n avisos:\n${lista(parser.avisos)}`)
console.log(`\nMapeo #ALTA → CRM\n faltantes:\n${lista(faltantes)}\n bloqueos:\n${lista(bloqueos.map(b => `[${b.motivo}] ${b.detalle}`))}\n avisos:\n${lista(avisos)}`)
console.log(`\n¿Apta para escribir? ${aptoParaEscribir ? 'SÍ' : 'NO'}\n${lista(motivosNoApto)}`)
console.log(`\nPlan (planAlta): ok=${plan.ok}`)
console.log(`  idNuevo:          ${plan.idNuevo ?? '—'}`)
console.log(`  filaAgencia:      ${plan.filaAgencia ?? '—'}`)
console.log(`  filaRenovaciones: ${plan.filaRenovaciones ?? '—'}`)
console.log(`  precio:           ${plan.precio ? `USD ${plan.precio.precioUSD} · ${plan.precio.meses} meses · clave ${plan.precio.clave} · origen ${plan.precio.origen}${plan.precio.asumido ? ' · ASUMIDO' : ''}` : '—'}`)
console.log(` errores:\n${lista(plan.errores)}`)
console.log(` advertencias:\n${lista(plan.advertencias)}`)
console.log(` duplicados (solo ID y motivo):\n${lista(plan.duplicados.map(d => `${d.id || '(sin ID)'} · por ${d.motivo}`))}`)
if (plan.payload) {
  console.log(' rangos que se escribirían:')
  for (const d of plan.payload.valores.data) console.log(`  - ${d.range}`)
  for (const c of plan.payload.copiarFormulas) console.log(`  - fórmulas ${c.origen} → ${c.destino}`)
  console.log(' pasos:')
  for (const p of plan.pasos) console.log(`  ${p}`)
}
