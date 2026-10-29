// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/crm-referidos-tabs.mjs [--json]
//
// DRY-RUN: imprime el spreadsheets.batchUpdate que CREARÍA las pestañas "Referidos" y "Créditos" en
// "2026 - CRM - CLIENTES". NO lo envía y NO tiene forma de enviarlo: no importa googleapis, no lee
// credenciales ni .env.local y no hace ninguna llamada de red. Las columnas, validaciones y fórmulas
// salen de lib/clientes/pestanasNuevas.ts (el mismo diseño documentado en docs/CRM-CLIENTES-TABS.md).
//   (sin flags)  resumen: pestañas, columnas, qué es fórmula y cuántos pedidos tiene el batchUpdate.
//   --json       el cuerpo completo del batchUpdate por stdout (para revisarlo o guardarlo).
import { PESTANAS_NUEVAS, construirBatchUpdateNuevasPestanas, resumirBatch } from '../lib/clientes/pestanasNuevas.ts'

const args = process.argv.slice(2)
const desconocidos = args.filter(a => a !== '--json')
const batch = construirBatchUpdateNuevasPestanas()

if (desconocidos.length) {
  console.error(`Opción no reconocida: ${desconocidos.join(' ')}. Este script SOLO imprime el batchUpdate (opción --json); no envía nada.`)
  process.exitCode = 1
} else if (args.includes('--json')) {
  // Sin process.exit(): con la salida redirigida a un pipe cortaría el JSON grande a la mitad
  console.log(JSON.stringify(batch, null, 2))
} else {
  console.log('DRY-RUN: no se envía nada a Google Sheets (este script no tiene credenciales ni red).\n')
  for (const p of PESTANAS_NUEVAS) {
    console.log(`Pestaña "${p.titulo}" (sheetId elegido ${p.sheetId}, ${p.filas} filas, ${p.columnas.length} columnas) — ${p.descripcion}`)
    p.columnas.forEach((c, i) => {
      const letra = String.fromCharCode(65 + i)
      const marca = c.formula ? 'FÓRMULA' : c.requerida ? 'requerida' : 'opcional'
      console.log(`  ${letra}  ${c.encabezado.padEnd(24)} ${c.tipo.padEnd(7)} ${marca.padEnd(9)} ${c.descripcion}`)
    })
    console.log('')
  }
  const r = resumirBatch(batch)
  console.log(`batchUpdate: ${batch.requests.length} pedidos → ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  console.log(`Tamaño del cuerpo: ${(JSON.stringify(batch).length / 1024).toFixed(0)} KB. Usá --json para imprimirlo completo.`)
}
