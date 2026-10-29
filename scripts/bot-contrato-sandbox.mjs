// Prueba de punta a punta del contrato del bot "Capital Jurídico" en la SANDBOX de PandaDoc.
// cd <APP_DIR> && set -a && source .env.local && set +a && \
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-contrato-sandbox.mjs [--simular|--real] [--garantia]
//
// --simular (por defecto): NO crea nada. Separa la dirección (reglas puras), arma el cuerpo del POST /documents y lo
//   compara con los tokens de la plantilla (GET de solo lectura): ningún token del cliente puede quedar vacío,
//   StreetAddress lleva solo la calle y el domicilio de Skyward es DIRECCION_ARGENTINA.
// --real: repite esas revisiones y, solo si pasan, crea UN borrador (plantilla normal, datos inventados), espera a
//   "document.draft", verifica con GET /documents/{id}/details que no quede ninguna variable vacía ([Client.City]…),
//   baja el PDF del borrador y revisa el texto (sin variables sin completar y con "Calle Ficticia 123, Ciudad Ejemplo, Provincia Ejemplo"
//   en el domicilio de Skyward). Al final lo BORRA (aunque algo falle en el medio). Nunca lo envía.
//   El id se guarda apenas PandaDoc lo devuelve (alCrear) y se imprime. Con Ctrl+C (o SIGTERM) el finally no corre:
//   un manejador de la señal borra ese id antes de salir (un segundo Ctrl+C sale sin esperar).
//   Si el POST crea el documento pero la respuesta se corta (el script nunca recibe el id), busca en la sandbox los
//   borradores con el nombre exacto de la prueba creados desde que arrancó y los borra.
// --garantia: lo mismo con la plantilla "con GARANTÍA" (plantilla-ficticia-garantia). Sirve para ver si esa plantilla usa
//   el token "TU DIRECCIÓN EN ARGENTINA" y si el domicilio de Skyward queda duplicado. Crear con --real necesita el OK
//   de Tomás (docs/BOT-ALTA-CJ.md, "Contrato en PandaDoc").
// En los dos modos lista (solo lectura) los borradores de prueba que hayan quedado en la sandbox de corridas viejas.
// Usa SOLO PANDADOC_API_KEY_SANDBOX (explícita: aunque exista la de producción, esta prueba no la toca) y no la imprime.
// No llama a Claude: la dirección de prueba la resuelven las reglas (si no alcanzaran, la prueba falla antes de crear).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  crearBorradorContrato, detallesDocumento, borrarDocumento, estadoDocumento, cuerpoBorrador, verificarTokens,
  revisarParaEnviar, BASE_PANDADOC, ErrorPandaDoc, ErrorBorrador,
} from '../lib/bot/alta/pandadoc.ts'
import { PLANTILLAS_CONTRATO, DIRECCION_ARGENTINA } from '../lib/bot/alta/contrato.ts'
import { separarDireccion, reglasAlcanzan } from '../lib/bot/alta/direccion.ts'

const real = process.argv.includes('--real')
const garantia = process.argv.includes('--garantia')
const apiKey = process.env.PANDADOC_API_KEY_SANDBOX
if (!apiKey) { console.error('Falta PANDADOC_API_KEY_SANDBOX (cargá .env.local)'); process.exit(1) }
const op = { apiKey }
const DOMICILIO_SKYWARD = 'Calle Ficticia 123, Ciudad Ejemplo, Provincia Ejemplo'

console.log(`Modo: ${real ? 'REAL (crea un borrador en la sandbox y lo borra)' : 'SIMULAR (no crea nada)'} · plantilla: ${garantia ? 'con GARANTÍA' : 'normal'} · clave: PANDADOC_API_KEY_SANDBOX`)

const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })   // aaaa-mm-dd
const alta = {
  etiquetaAlta: true, closer: 'Prueba', programa: 'Agencia', modalidad: 'PIF', totalUsd: null, estePagoUsd: null,
  medioPago: null, pagoEnPesos: null,
  nombre: 'Cliente Prueba Bot', telefonos: [{ numero: '5492214000000', etiqueta: '' }], socios: null,
  correo: 'prueba.bot@example.com', direccion: 'Calle Falsa 123, B1900 La Plata, Provincia de Buenos Aires, Argentina',
  dni: '30111222', cuit: null, inicio: hoy, contrato: garantia ? 'garantia' : 'normal', cuotas: [], faltantes: [], avisos: [],
}

const err = e => (e instanceof ErrorPandaDoc ? `HTTP ${e.status} ${e.respuesta}` : String(e?.message ?? e))
let fallo = false
const marca = ok => { if (!ok) fallo = true; return ok ? '✔' : '✖' }

// ── 1. Dirección separada (reglas puras) ──────────────────────────────────────────────────────────────
const dir = separarDireccion(alta.direccion, alta.telefonos[0].numero)
console.log(`${marca(reglasAlcanzan(dir))} Dirección "${alta.direccion}"`)
console.log(`  calle "${dir.calle}" · ciudad "${dir.ciudad}" · provincia "${dir.provincia}" · país "${dir.pais}" · confianza ${dir.confianza}`)

// ── 2. Cuerpo del POST (lo mismo que arma crearBorradorContrato con las reglas) ──────────────────────
const { cuerpo, faltantes } = cuerpoBorrador(alta, { extra: { calle: dir.calle, ciudad: dir.ciudad, provincia: dir.provincia, pais: dir.pais } })
const tok = Object.fromEntries(cuerpo.tokens.map(t => [t.name, t.value]))
console.log(`${marca(faltantes.length === 0)} Faltantes: ${faltantes.join(', ') || 'ninguno'}`)
console.log(`${marca(tok['Client.StreetAddress'] === dir.calle && !tok['Client.StreetAddress'].includes(dir.ciudad))} StreetAddress solo la calle: ${JSON.stringify(tok['Client.StreetAddress'])}`)
for (const n of ['Client.City', 'Client.State', 'Client.Country']) console.log(`${marca(!!tok[n]?.trim())} ${n} = ${JSON.stringify(tok[n] ?? '')}`)
console.log(`${marca(DIRECCION_ARGENTINA === DOMICILIO_SKYWARD && tok['TU DIRECCIÓN EN ARGENTINA'] === DOMICILIO_SKYWARD)} Domicilio de Skyward (token): ${JSON.stringify(tok['TU DIRECCIÓN EN ARGENTINA'])}`)

// ── 3. Tokens de la plantilla (GET de solo lectura) ──────────────────────────────────────────────────
const plantilla = PLANTILLAS_CONTRATO[alta.contrato]
const rp = await fetch(`${BASE_PANDADOC}/templates/${plantilla}/details`, { headers: { Authorization: `API-Key ${apiKey}` } })
const tp = await rp.text()
if (!rp.ok) {
  console.error(`✖ La plantilla ${alta.contrato} (${plantilla}) no está accesible con la clave sandbox: HTTP ${rp.status} ${tp.slice(0, 500)}`)
  process.exit(1)
}
const det = JSON.parse(tp)
const delCliente = (det.tokens ?? []).map(t => t.name).filter(n => !n.startsWith('Document.'))
const sinValor = delCliente.filter(n => !tok[n]?.trim())
const deMas = cuerpo.tokens.map(t => t.name).filter(n => !delCliente.includes(n))
console.log(`✔ Plantilla: "${det.name}" · roles: ${(det.roles ?? []).map(r => r.name).join(', ') || '—'}`)
console.log(`${marca(sinValor.length === 0)} Tokens de la plantilla con valor: ${delCliente.length - sinValor.length}/${delCliente.length}${sinValor.length ? ` · vacíos: ${sinValor.join(', ')}` : ''}`)
if (deMas.length) console.log(`  ⚠ tokens que mandamos y la plantilla no tiene: ${deMas.join(', ')}`)
console.log(`  ${delCliente.includes('TU DIRECCIÓN EN ARGENTINA') ? '⚠ la plantilla declara' : '✔ la plantilla no declara'} el token "TU DIRECCIÓN EN ARGENTINA"${delCliente.includes('TU DIRECCIÓN EN ARGENTINA') ? ': revisar con --real que el domicilio de Skyward no quede duplicado' : ''}`)

// ── 3b. Borradores de prueba que quedaron de corridas viejas (solo lectura) ─────────────────────────
/** Documentos de la sandbox con el nombre EXACTO de la prueba ("Contrato - Cliente Prueba Bot - C.J"); con `desde`,
 *  solo los creados desde ese momento (con un minuto de margen por relojes distintos). [] si la búsqueda falla. */
async function borradoresDePrueba(desde = 0) {
  try {
    const q = new URLSearchParams({ q: cuerpo.name, count: '50' })
    const r = await fetch(`${BASE_PANDADOC}/documents?${q}`, { headers: { Authorization: `API-Key ${apiKey}` } })
    if (!r.ok) { console.error(`  ⚠ no se pudo buscar borradores de prueba: HTTP ${r.status}`); return [] }
    const { results = [] } = JSON.parse(await r.text())
    return results.filter(d => d.name === cuerpo.name && (!desde || Date.parse(d.date_created) >= desde - 60_000))
  } catch (e) {
    console.error(`  ⚠ no se pudo buscar borradores de prueba: ${err(e)}`)
    return []
  }
}
const viejos = await borradoresDePrueba()
console.log(`${viejos.length ? '⚠' : '✔'} Borradores de prueba de corridas anteriores en la sandbox: ${viejos.length ? viejos.map(d => `${d.id} (${d.status}, ${d.date_created})`).join(', ') + ' → borrarlos a mano en PandaDoc' : 'ninguno'}`)

if (fallo) { console.error('✖ La simulación no pasó: no se crea nada.'); process.exit(1) }
if (!real) { console.log('✔ Simulación OK. Para crear el borrador de prueba (y borrarlo): --real'); process.exit(0) }

// ── 4. REAL: crear, verificar, bajar el PDF y borrar ─────────────────────────────────────────────────

/** Texto del PDF con pypdf (Python del sistema, sin red; -I = aislado). '' si no se pudo. */
function textoPdf(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'contrato-sandbox-'))
  try {
    const archivo = join(dir, 'borrador.pdf')
    writeFileSync(archivo, bytes)
    return execFileSync('python3', ['-I', '-c',
      'import sys, pypdf\nr = pypdf.PdfReader(sys.argv[1])\nprint("\\n".join((p.extract_text() or "") for p in r.pages))', archivo],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let id = null
let inicioPost = 0   // Date.now() justo antes del POST: para buscar el borrador si la respuesta se corta

// Ctrl+C / SIGTERM: el finally no corre, así que se borra acá el borrador que ya tenga id
let saliendo = false
function alCortar(senal) {
  if (saliendo) process.exit(130)   // segundo Ctrl+C: sale sin esperar
  saliendo = true
  if (!id) {
    console.error(`\n✖ ${senal} antes de tener el id: si el POST llegó a PandaDoc, buscar "${cuerpo.name}" en la sandbox y borrarlo a mano`)
    process.exit(130)
  }
  console.error(`\n… ${senal}: borrando el borrador ${id} antes de salir (otro Ctrl+C sale sin esperar)`)
  borrarDocumento(id, op).then(
    () => { console.error(`✔ Borrado: ${id}`); process.exit(130) },
    e => { console.error(`✖ No se pudo borrar ${id}: ${err(e)} → borrarlo a mano en PandaDoc`); process.exit(130) },
  )
}
process.on('SIGINT', () => alCortar('Ctrl+C'))
process.on('SIGTERM', () => alCortar('SIGTERM'))

try {
  const t0 = Date.now()
  inicioPost = t0
  const r = await crearBorradorContrato(alta, {
    ...op,
    direccion: false,   // la prueba no llama a Claude (las reglas ya alcanzan, ver paso 1)
    metadata: { origen: 'prueba-bot-sandbox' },
    alCrear: x => { id = x; console.log(`  creado ${x} (si cortás con Ctrl+C, borralo a mano en PandaDoc)`) },
  })
  console.log(`${marca(r.estado === 'document.draft')} Creado: ${r.nombre} · id ${r.id} · estado ${r.estado} (${((Date.now() - t0) / 1000).toFixed(1)} s) · clave usada: ${r.clave}`)
  console.log(`  link de edición: ${r.link}`)
  console.log(`  dirección: fuente ${r.direccion?.fuente ?? '—'} · ${r.direccion ? `${r.direccion.calle} | ${r.direccion.ciudad} | ${r.direccion.provincia} | ${r.direccion.pais}` : '—'}`)
  console.log(`${marca(r.faltantes.length === 0)} Faltantes: ${r.faltantes.join(', ') || 'ninguno'}`)

  // 5. Tokens, variables vacías y destinatario
  const d = await detallesDocumento(r.id, op)
  const v = verificarTokens(cuerpo.tokens, d.tokens ?? [])
  const ausentes = v.distintos.filter(x => x.recibido === null)
  const distintos = v.distintos.filter(x => x.recibido !== null)
  console.log(`${marca(distintos.length === 0)} Tokens verificados: ${cuerpo.tokens.length - v.distintos.length}/${cuerpo.tokens.length} iguales` +
    (ausentes.length ? ` · ${ausentes.length} descartado(s) por PandaDoc` : ''))
  for (const t of cuerpo.tokens) {
    const x = v.distintos.find(y => y.name === t.name)
    const m = !x ? '✔' : x.recibido === null ? '⚠' : '✖'
    const nota = !x ? '' : x.recibido === null ? ' (no está en el documento: el texto de la plantilla no usa esta variable)' : ` (PandaDoc: ${JSON.stringify(x.recibido)})`
    console.log(`  ${m} ${t.name} = ${JSON.stringify(t.value)}${nota}`)
  }
  const revision = revisarParaEnviar(d)
  console.log(`${marca(revision.vacios.length === 0)} Variables vacías en el borrador: ${revision.vacios.join(', ') || 'ninguna'} · listo para enviar: ${revision.listo ? 'sí' : 'no'}`)
  const dest = (d.recipients ?? [])[0]
  const destOk = dest && dest.email === cuerpo.recipients[0].email && dest.role === 'Client'
  console.log(`${marca(destOk)} Destinatario: ${dest ? `${dest.first_name ?? ''} ${dest.last_name ?? ''} <${dest.email}> · rol ${dest.role}` : '—'}`)

  // 6. Texto del borrador (PDF)
  const rd = await fetch(`${BASE_PANDADOC}/documents/${r.id}/download`, { headers: { Authorization: `API-Key ${apiKey}` } })
  if (!rd.ok) {
    fallo = true
    console.error(`✖ No se pudo bajar el PDF del borrador: HTTP ${rd.status} ${(await rd.text()).slice(0, 300)}`)
  } else {
    const texto = textoPdf(Buffer.from(await rd.arrayBuffer())).replace(/\s+/g, ' ')
    console.log(`  PDF: ${texto.length} caracteres de texto`)
    const sinCompletar = [...new Set(texto.match(/\[[^\]]{2,60}\]/g) ?? [])]
    const delClienteSinCompletar = sinCompletar.filter(x => !/^\[Document\./.test(x))
    console.log(`${marca(delClienteSinCompletar.length === 0)} Variables sin completar en el texto: ${sinCompletar.join(', ') || 'ninguna'}`)
    const re = /Uruguay\s*627\s*,\s*San\s*Pedro\s*,\s*Buenos\s*Aires/gi
    const veces = (texto.match(re) ?? []).length
    const duplicado = /San\s*Pedro\s*,\s*Buenos\s*Aires\s*,\s*San\s*Pedro/i.test(texto)
    const i = texto.search(/Uruguay\s*627/i)
    console.log(`${marca(veces >= 1 && !duplicado)} Domicilio de Skyward en el texto: "${DOMICILIO_SKYWARD}" ${veces} vez/veces${duplicado ? ' (DUPLICADO: la plantilla ya trae ciudad y provincia)' : ''}`)
    console.log(`  contexto: «${i >= 0 ? texto.slice(Math.max(0, i - 90), i + 110) : '(no aparece el domicilio configurado)'}»`)
    for (const [n, val] of Object.entries({ 'Client.StreetAddress': tok['Client.StreetAddress'], 'Client.City': tok['Client.City'], 'Client.State': tok['Client.State'] })) {
      console.log(`  ${texto.includes(val) ? '✔' : '⚠'} ${n} aparece en el texto: ${JSON.stringify(val)}`)
    }
  }
} catch (e) {
  fallo = true
  if (!id && e instanceof ErrorBorrador) id = e.idDocumento   // por si falló antes de alCrear (no debería)
  console.error(`✖ ${err(e)}`)
} finally {
  // 7a. Sin id: si el POST pudo llegar a crearlo (error de red, 5xx o respuesta cortada), se busca por el nombre exacto
  //     de la prueba entre los creados desde el POST y se borra. Con un 4xx no se creó nada y la búsqueda vuelve vacía.
  if (!id && inicioPost && !saliendo) {
    console.error('  … sin id del borrador: buscando en la sandbox si el POST llegó a crearlo')
    await new Promise(r => setTimeout(r, 3000))   // la búsqueda de PandaDoc tarda unos segundos en ver lo nuevo
    for (const d of await borradoresDePrueba(inicioPost)) {
      try { await borrarDocumento(d.id, op); console.log(`✔ Borrado huérfano: ${d.id}`) } catch (e2) { fallo = true; console.error(`✖ No se pudo borrar el huérfano ${d.id}: ${err(e2)} → borrarlo a mano`) }
    }
  }
  // 7b. Borrar el borrador de prueba (nunca se envió)
  if (id) {
    try {
      await borrarDocumento(id, op)
      let despues
      try { despues = `estado ${await estadoDocumento(id, op)}` } catch (e) { despues = e instanceof ErrorPandaDoc && (e.status === 404 || e.status === 403) ? `ya no se puede abrir (HTTP ${e.status})` : err(e) }
      console.log(`✔ Borrado: ${id} · después de borrar: ${despues}`)
    } catch (e) {
      fallo = true
      console.error(`✖ No se pudo borrar ${id}: ${err(e)} → borrarlo a mano en PandaDoc`)
    }
  }
}
console.log(fallo ? '✖ La prueba real tuvo fallas (ver arriba).' : '✔ Prueba real OK.')
process.exit(fallo ? 1 : 0)
