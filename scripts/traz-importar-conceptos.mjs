// node scripts/traz-importar-conceptos.mjs  — carga en Neon la clasificación de anuncios (formato × ángulo) y el cruce
// anuncio → concepto que usa /trazabilidad/formatos. Fuentes: motor-contenido/data/formatos_conceptos.json (clasificación,
// 3 clasificadores con voto por mayoría) y data/scoreboard.json (anuncios de cada concepto, ids y gasto en Meta).
// Idempotente: reemplaza las dos tablas. Volver a correrlo después de clasificar videos nuevos o de regenerar el marcador.
import fs from 'node:fs'
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { neon } = req('@neondatabase/serverless')
const MOTOR = process.env.TRAZ_MOTOR_DATA_DIR?.trim()
if (!MOTOR) throw new Error('Falta TRAZ_MOTOR_DATA_DIR (fuente local privada explícita)')
const url = process.env.DATABASE_URL?.trim()
if (!url) throw new Error('Falta DATABASE_URL; cargar el entorno autorizado antes de importar')
const q = neon(url)
// Misma normalización que claveAnuncio() de lib/trazabilidad/modelo.ts
const claveAnuncio = (s) => { let t = String(s ?? ''); try { t = decodeURIComponent(t.replace(/\+/g, ' ')) } catch { t = t.replace(/\+/g, ' ') } return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
const { conceptos } = JSON.parse(fs.readFileSync(`${MOTOR}/formatos_conceptos.json`, 'utf8'))
const sb = JSON.parse(fs.readFileSync(`${MOTOR}/scoreboard.json`, 'utf8'))
// Gasto que se puede comparar con agendas: solo las campañas que dejan el anuncio en la columna Video (VSL, RTG, UY).
// Follow Me Ads lleva al perfil (sus agendas llegan por DM, sin video), así que su gasto no entra en el cash por dólar.
const LIGAS_CON_AGENDA = new Set(['VSL', 'RTG', 'UY'])
const gasto = new Map(), ligas = new Map(), anuncios = new Map()
for (const [liga, L] of Object.entries(sb.ligas)) for (const c of L.conceptos ?? []) {
  if (LIGAS_CON_AGENDA.has(liga)) gasto.set(c.clave, (gasto.get(c.clave) ?? 0) + (c.meta?.historico?.gasto ?? 0))
  ligas.set(c.clave, [...new Set([...(ligas.get(c.clave) ?? []), liga])])
  for (const a of c.ads ?? []) { anuncios.set(claveAnuncio(a.nombre), c.clave); if (a.id) anuncios.set(String(a.id), c.clave) }
}
await q`CREATE TABLE IF NOT EXISTS cj_traz_conceptos (clave text PRIMARY KEY, formato text NOT NULL, angulo text, angulo_secundario text, caso_nombrado boolean NOT NULL DEFAULT false, quien_habla text, gancho text NOT NULL DEFAULT '', certeza text NOT NULL DEFAULT 'solo_nombre', acuerdo int NOT NULL DEFAULT 0, ligas text[] NOT NULL DEFAULT '{}', gasto numeric NOT NULL DEFAULT 0, gasto_al date, actualizado timestamptz NOT NULL DEFAULT now())`
await q`CREATE TABLE IF NOT EXISTS cj_traz_anuncios (clave_anuncio text PRIMARY KEY, concepto text NOT NULL)`
const gastoAl = String(sb.hoy ?? sb.generado ?? '').slice(0, 10) || null
await q`DELETE FROM cj_traz_conceptos`
for (const c of conceptos) {
  await q`INSERT INTO cj_traz_conceptos (clave, formato, angulo, angulo_secundario, caso_nombrado, quien_habla, gancho, certeza, acuerdo, ligas, gasto, gasto_al)
    VALUES (${c.clave}, ${c.formato}, ${c.angulo}, ${c.angulo_secundario}, ${!!c.caso_nombrado}, ${c.quien_habla}, ${c.gancho ?? ''}, ${c.certeza}, ${Math.min(c.acuerdo_formato, c.acuerdo_angulo)}, ${ligas.get(c.clave) ?? []}, ${Math.round((gasto.get(c.clave) ?? 0) * 100) / 100}, ${gastoAl})`
}
await q`DELETE FROM cj_traz_anuncios`
const filas = [...anuncios]
for (let i = 0; i < filas.length; i += 200) {
  const lote = filas.slice(i, i + 200)
  await q.query(`INSERT INTO cj_traz_anuncios (clave_anuncio, concepto) VALUES ${lote.map((_, j) => `($${2 * j + 1}, $${2 * j + 2})`).join(',')} ON CONFLICT (clave_anuncio) DO NOTHING`, lote.flat())
}
console.log(`conceptos ${conceptos.length} · anuncios ${filas.length} · gasto al ${gastoAl}`)
