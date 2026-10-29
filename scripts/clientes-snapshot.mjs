// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/clientes-snapshot.mjs [--offline] [--forzar] [--formulas]
//
// Corre la lectura REAL del CRM de clientes UNA vez (respetando la cuota compartida con producción:
// una sola llamada batchGet), guarda el snapshot en .cache/ y imprime SOLO agregados: ni nombres, ni
// teléfonos, ni mails, ni montos individuales.
//   (sin flags)  usa el snapshot si tiene menos de 10 min; si no, lee Sheets (1 llamada).
//   --forzar     lee Sheets aunque el snapshot sea fresco (igual respeta el mínimo de 30 s entre lecturas).
//   --offline    NO toca la red: reagrega desde el snapshot que ya está en .cache/ (para iterar gratis).
//   --formulas   además lee UNA vez la fila 2 de Agencia y de Renovaciones con FORMULA (1 llamada más) y guarda solo las fórmulas,
//                para planificar las altas de clientes (lib/clientes/altas.ts).
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(raiz)
// .env.local → process.env con el cargador de Next (así lo documenta Next para scripts); no se imprime nada de lo que tiene
nextEnv.loadEnvConfig(raiz, true, { info: () => {}, error: () => {} })

const args = new Set(process.argv.slice(2))
const { leerClientes, datosDesdeSnapshot, lecturasRealizadas, sondearFormulas } = await import('../lib/clientes/leer.ts')
const { leerSnapshot, edadSnapshot, rutaSnapshot, TTL_SNAPSHOT_MS } = await import('../lib/clientes/snapshot.ts')
const { resumirCartera } = await import('../lib/clientes/resumen.ts')

let datos
try {
  if (args.has('--offline')) {
    const snap = leerSnapshot()
    if (!snap) { console.error('No hay snapshot en .cache/: corré el script sin --offline una vez.'); process.exit(1) }
    datos = datosDesdeSnapshot(snap, 'snapshot')
  } else {
    datos = await leerClientes({ forzar: args.has('--forzar') })
  }
  if (args.has('--formulas') && !args.has('--offline')) {
    const f = await sondearFormulas()
    const letras = o => Object.keys(o).map(k => k.split(' ')[0]).join(', ') || '(ninguna)'
    console.log(`Fórmulas en Agencia (fila 2): ${letras(f.agencia)} · en Renovaciones (filas 2-3): ${letras(f.renovaciones)}`)
  }
} catch (e) {
  console.error('Falló la lectura:', String(e.message ?? e).slice(0, 300))
  process.exit(1)
}

const snap = leerSnapshot()
const min = snap ? Math.round(edadSnapshot(snap) / 60_000) : null
console.log(`\nFuente: ${datos.fuente} · snapshot de hace ${min} min (TTL ${TTL_SNAPSHOT_MS / 60_000} min) · llamadas a la API de Sheets en esta corrida: ${lecturasRealizadas()}`)
console.log(`Hoy (Argentina): ${datos.hoy} · archivo: ${rutaSnapshot().replace(raiz, '.')}`)
if (datos.avisos.length) console.log('Avisos:', datos.avisos.join(' | '))
console.log('Pestañas opcionales que todavía no existen:', datos.pestanasAusentes.join(', ') || '(ninguna)')

console.log('\n── Filas leídas por pestaña (sin encabezado) ──')
if (snap) for (const [k, h] of Object.entries(snap.hojas)) console.log(`  ${k.padEnd(13)} ${h === null ? 'no existe' : Math.max(0, h.length - 1)}`)

console.log('\n── Columnas resueltas por encabezado (clave → letra) ──')
for (const c of datos.columnas) {
  console.log(`  ${c.hoja}: ${Object.entries(c.resueltas).map(([k, l]) => `${k}=${l}`).join(' ')}`)
  if (c.faltantes.length) console.log(`    SIN encabezado: ${c.faltantes.join(', ')}`)
  if (c.porPosicion.length) console.log(`    encabezado VACÍO en la planilla, tomadas junto a "Estado": ${c.porPosicion.join(', ')}`)
  if (c.duplicadas.length) console.log(`    con más de una candidata: ${c.duplicadas.join(', ')}`)
}

const r = resumirCartera(datos.clientes, datos.referidos, datos.hoy)
const e = o => `ACTIVO ${o.ACTIVO} · FINALIZADO ${o.FINALIZADO} · PAUSADO ${o.PAUSADO} · INACTIVO ${o.INACTIVO} · sin estado ${o.SIN_ESTADO}`
console.log('\n── Agregados (hoy) ──')
console.log(`  Filas del CRM: ${r.filas.total} (Agencia ${r.filas.agencia} + Consultora ${r.filas.consultora}); con ID ${r.filas.conId}, sin ID ${r.filas.sinId}`)
console.log(`  Crudo con ID (así cuenta la bóveda): ${r.crudo.total} = Agencia ${r.crudo.agencia} + Consultora ${r.crudo.consultora}`)
console.log(`    ${e(r.crudo.porEstado)}`)
console.log(`  Métricas (solo Agencia, con ID, sin "no clientes"): ${r.metricas.clientes} clientes`)
console.log(`    ${e(r.metricas.porEstado)}`)
console.log(`    Semáforo (solo ACTIVO): verde ${r.metricas.semaforo.verde} · amarillo ${r.metricas.semaforo.amarillo} · rojo ${r.metricas.semaforo.rojo} · gris ${r.metricas.semaforo.gris}`)
console.log(`    Vencen en los próximos 30 días (ACTIVO): ${r.metricas.vencenEn30Dias}`)
console.log(`    Con LTV cobrado cargado: ${r.metricas.conLtvCobrado} de ${r.metricas.clientes} (total USD ${Math.round(r.metricas.ltvCobradoTotal)})`)
console.log(`    Renovaciones pagas: ${r.metricas.renovacionesPagas} · extensiones de servicio: ${r.metricas.extensiones}`)
console.log(`  "No clientes" excluidos (FINALIZADO/INACTIVO con cobrado < USD ${400}): ${r.noClientesExcluidos}`)
console.log(`  Consultora (línea aparte): ${r.consultora.total} · ${e(r.consultora.porEstado)}`)
console.log(`  Calidad de datos: sin ID ${r.calidadDeDatos.sinId} · ACTIVO/PAUSADO sin fin de período ${r.calidadDeDatos.activosSinFin} · Agencia sin LTV ${r.calidadDeDatos.sinLtv}`)
console.log(`  Referidos cargados: ${r.referidos.total}`)

// Referencia de la bóveda (negocio/CRM Clientes, 19/9/2026, SIN verificar contra la planilla de hoy)
const ref = { total: 127, activos: 64, finalizados: 43, pausados: 4, inactivos: 16, venc30: 18 }
const fila = (n, boveda, hoy) => `  ${n.padEnd(28)} bóveda ${String(boveda).padStart(4)} · hoy ${String(hoy).padStart(4)} · diferencia ${hoy - boveda >= 0 ? '+' : ''}${hoy - boveda}`
console.log('\n── Comparación con la bóveda (19/9/2026; no se asume que ninguno esté mal) ──')
console.log(fila('Total (Agencia+Consultora)', ref.total, r.crudo.total))
console.log(fila('Activos', ref.activos, r.crudo.porEstado.ACTIVO))
console.log(fila('Finalizados', ref.finalizados, r.crudo.porEstado.FINALIZADO))
console.log(fila('Pausados', ref.pausados, r.crudo.porEstado.PAUSADO))
console.log(fila('Inactivos', ref.inactivos, r.crudo.porEstado.INACTIVO))
console.log(fila('Vencen en 30 días (ACTIVO)', ref.venc30, datos.clientes.filter(c => c.estado === 'ACTIVO' && c.diasParaVencer !== null && c.diasParaVencer >= 0 && c.diasParaVencer <= 30).length) + '   (conteo crudo, ambas líneas)')
