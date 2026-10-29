// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/edicion-esquema.mjs --imprimir
// Imprime el DDL de Grabación y Edición (lib/edicion/db/migracion.ts) SIN conectarse a ninguna base. Las tablas las crea
// la primera escritura del Despacho (asegurarTablas → migrar), en una transacción, con la versión en cj_edicion_esquema.
const { SENTENCIAS_ESQUEMA, VERSION_ESQUEMA, TABLAS_EDICION } = await import('../lib/edicion/db/migracion.ts')

if (!process.argv.includes('--imprimir')) {
  console.log('Uso: … scripts/edicion-esquema.mjs --imprimir   (solo imprime: no se conecta a nada)')
  process.exit(0)
}
console.log(`-- Esquema de Grabación y Edición, versión ${VERSION_ESQUEMA} (${TABLAS_EDICION.length} tablas: ${TABLAS_EDICION.join(', ')})`)
console.log('BEGIN;')
for (const s of SENTENCIAS_ESQUEMA) console.log(`${s.replace(/\n  /g, '\n')};\n`)
console.log(`INSERT INTO cj_edicion_esquema (version) VALUES (${VERSION_ESQUEMA}) ON CONFLICT (version) DO NOTHING;`)
console.log('COMMIT;')
