// node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/limpiar-cliente-prueba.mjs --id Z001 --nombre "PRUEBA BOT Ensayo"            # simula
// node --env-file=.env.local --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/limpiar-cliente-prueba.mjs --id Z001 --nombre "PRUEBA BOT Ensayo" --real     # borra
// ── LIMPIEZA COMPLETA del cliente ficticio de la prueba punta a punta (docs/PRUEBA-PUNTA-A-PUNTA.md) ─────────────────────
// Pedido de RESPONSABLE_HUB (1/11/2026): «hacer un testeo de un cliente como si hubiéramos hecho todo el caminito … y luego borrar
// todo así no queda rastro». Encadena las limpiezas por etapa en ORDEN INVERSO al recorrido:
//   1. Bajas   → scripts/limpiar-cliente-prueba-bajas.mjs (WhatsApp/Discord anotados, vuelve atrás el CRM, cj_bajas_*).
//   2. Éxito   → scripts/limpiar-cliente-prueba-exito.mjs (WhatsApp/Discord anotados, cj_exito_*).
//   3. Neon de Anuncios, Edición/Grabación, Guiones, Kickoff e hitos de la cartera: filas con ese ID del CRM, en UNA
//      transacción (o se borra todo o nada).
//   4. Alta    → la carpeta de Drive «PRUEBA BOT … - C.J» a la papelera por el Puente Drive (el puente solo acepta
//      carpetas «PRUEBA BOT…»; adentro están Guiones, Crudos, Editados y la bienvenida) y las filas cj_altas* del alta.
//   5. Lista de lo que NO se puede borrar solo (WhatsApp ya enviado sin id, grupos, CRM, planilla de Finanzas, PandaDoc,
//      Skool, Meta, Fathom…): sale al final, para hacerlo a mano.
// Seguros:
//   · --id con forma de ID del CRM de 1 a 5 dígitos (Éxito guarda con otra clave los de 6) y --nombre que empiece con
//     «PRUEBA BOT». Sin los dos, no hace nada.
//   · Si en el CRM (Agencia) hay una fila con ese ID que NO se llama exactamente --nombre, aborta sin tocar nada.
//   · --simular (por defecto) solo lee. --real es explícito.
// Nunca imprime tokens, URLs de webhooks, teléfonos ni textos de mensajes. main() se exporta para
// scripts/test-limpiar-cliente-prueba.mjs (sin red ni base).
import { pathToFileURL } from 'node:url'

const PATRON_ID = /^[A-Za-z]\d{1,5}$/
const PREFIJO = 'PRUEBA BOT'
export const normalizarNombre = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase()

export function parsearArgs(argv, env = process.env) {
  const a = { modo: 'simular', id: null, nombre: null }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === '--simular') a.modo = 'simular'
    else if (x === '--real') a.modo = 'real'
    else if (x === '--id') a.id = argv[++i] ?? ''
    else if (x.startsWith('--id=')) a.id = x.slice(5)
    else if (x === '--nombre') a.nombre = argv[++i] ?? ''
    else if (x.startsWith('--nombre=')) a.nombre = x.slice(9)
    else throw new Error(`argumento desconocido: ${x.split('=')[0].slice(0, 20)}`)
  }
  if (a.id === null) {
    const lista = (env.BOT_CLIENTES_PRUEBA ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    if (lista.length === 1) a.id = lista[0]
  }
  if (!a.id || !PATRON_ID.test(a.id.trim())) throw new Error('falta --id con un ID del CRM de prueba (una letra y de 1 a 5 dígitos, ej. Z001)')
  a.id = a.id.trim().toUpperCase()
  const n = normalizarNombre(a.nombre)
  if (!n.startsWith(`${PREFIJO} `) || n.length <= PREFIJO.length + 1) throw new Error('falta --nombre "PRUEBA BOT <Nombre>" (el nombre exacto de la fila del CRM)')
  a.nombre = n
  return a
}

// ── Neon de las etapas intermedias: [etiqueta, tabla, WHERE]. En el WHERE, $1 es [ID] o, si dice $N, el nombre normalizado
// (Postgres no acepta un parámetro sin usar, así que cada consulta lleva uno solo). Orden = el del borrado
// (hijos antes que padres). Los nombres de tabla son fijos: nada de lo que entra por la línea de comandos va al SQL salvo
// como parámetro.
const VIDEOS = `video_id IN (SELECT id FROM cj_videos WHERE upper(id_crm) = ANY($1::text[]))`
const TARJETAS = `tarjeta_id IN (SELECT id FROM cj_edicion_tarjetas WHERE upper(id_crm) = ANY($1::text[]))`
const POR_ID = `upper(id_crm) = ANY($1::text[])`
export const TABLAS_ETAPAS = [
  ['Anuncios', 'cj_anuncios_notas', POR_ID],
  ['Anuncios', 'cj_anuncios_avisos', `upper(regexp_replace(trim(cliente), '\\s+', ' ', 'g')) = $N`],
  ['Edición', 'cj_video_notas', VIDEOS],
  ['Edición', 'cj_video_pedidos', VIDEOS],
  ['Edición', 'cj_video_eventos', POR_ID],
  ['Edición', 'cj_edicion_lecturas', POR_ID],
  ['Edición', 'cj_edicion_tarjetas_outbox', TARJETAS],
  ['Edición', 'cj_edicion_tarjetas_operaciones', TARJETAS],
  ['Edición', 'cj_edicion_tarjetas_historial', TARJETAS],
  ['Edición', 'cj_edicion_tarjetas', POR_ID],
  ['Grabación', 'cj_grab_transcripciones', `archivo_id IN (SELECT id FROM cj_grab_archivos WHERE upper(id_crm) = ANY($1::text[]))`],
  ['Grabación', 'cj_grab_archivos', POR_ID],
  ['Grabación', 'cj_grab_tandas', POR_ID],
  ['Grabación', 'cj_grab_seguimientos', POR_ID],
  ['Grabación', 'cj_grab_guiones', POR_ID],
  ['Grabación', 'cj_grab_carpetas', POR_ID],
  ['Edición', 'cj_videos', POR_ID],
  ['Edición', 'cj_marca_propuestas', POR_ID],
  ['Edición', 'cj_marca', POR_ID],
  ['Edición', 'cj_edicion_clientes', POR_ID],
  ['Guiones', 'cj_guiones', POR_ID],
  ['Guiones', 'cj_guiones_documentos', POR_ID],
  ['Kickoff', 'cj_kickoffs', POR_ID],
  ['Cartera', 'cj_hitos_historial', POR_ID],
  ['Cartera', 'cj_hitos', POR_ID],
  ['Cartera', 'cj_etapas_manual', POR_ID],
]
const ALTAS = `alta_id IN (SELECT id FROM cj_altas WHERE upper(regexp_replace(trim(nombre_cliente), '\\s+', ' ', 'g')) = $N)`
export const TABLAS_ALTA = [
  ['Alta', 'cj_altas_pasos', ALTAS],
  ['Alta', 'cj_altas_mensajes', ALTAS],
  ['Alta', 'cj_altas', `upper(regexp_replace(trim(nombre_cliente), '\\s+', ' ', 'g')) = $N`],
]

/** Lo que el bot no puede borrar solo: queda a mano (el runbook dice cómo). */
export const A_MANO = [
  'WhatsApp: la comunidad «<nombre> - C.J» y sus 3 grupos, si la baja de prueba no la eliminó (salir y eliminar desde el teléfono del bot o de RESPONSABLE_HUB).',
  'WhatsApp: los mensajes del bot del Alta (Ventas C.J., Verificaciones), de Guiones (grupo de guiones y Contenido) y de Edición, y todo lo que escribió el «cliente»: Alta, Guiones y Edición no anotan rastros (solo Éxito y Bajas).',
  'Discord: los avisos de Kickoff (#📝-kickoff y #📣-ads), Edición (#✂️-edicion, #ads), Anuncios (#📣-ads) y los «🧪 PRUEBA» de Verificaciones que no tengan rastro.',
  'CRM de Clientes: la fila «PRUEBA BOT…» de Agencia y su período 0 en Renovaciones (borrar las filas enteras).',
  'Finanzas: la fila «PRUEBA BOT…» del Registro de Pagos (planilla), su comprobante en «Subidos» (papelera) y el pago copiado en la app /finanzas.',
  'PandaDoc: el borrador «Contrato - PRUEBA BOT … - C.J» (nunca se envía; borrarlo desde PandaDoc).',
  'Skool: la invitación al correo ficticio (si COORDINACION la mandó): revocarla o sacar al miembro.',
  'Meta: si Anuncios armó algo en PAUSA para el cliente de prueba, borrar la campaña/conjunto/anuncio (no debería: el cliente de prueba no tiene cuenta).',
  'Fathom: las grabaciones de la kickoff y de la llamada de baja de prueba.',
  'Typeform: la respuesta de la encuesta de prueba (si se contestó) y su fila en la planilla de respuestas.',
  'Neon: cj_altas_archivos (comprobantes cargados desde el Despacho) y cj_edicion_avisos (avisos por lote: pueden mezclar clientes).',
  'Vercel: borrar BOT_CLIENTES_PRUEBA, EXITO_DIAS_CONTENTO_PRUEBA y EXITO_RECORDATORIO_HORAS_PRUEBA y hacer Redeploy.',
]

/** WHERE con $N → ($1 = nombre); si no, $1 = [ID]. */
export const consulta = (where, id, nombre) => (where.includes('$N') ? { where: where.replaceAll('$N', '$1'), params: [nombre] } : { where, params: [[id]] })

const faltaTabla = (e) => e?.code === '42P01' || /relation "?\w+"? does not exist/i.test(String(e?.message ?? ''))

/** Cuenta filas por tabla (solo lectura). Una tabla que no existe cuenta 0 y no entra al borrado. */
export async function contarNeon(q, tablas, id, nombre) {
  const out = []
  for (const [etapa, tabla, where] of tablas) {
    try {
      const c = consulta(where, id, nombre)
      const r = await q.query(`SELECT count(*)::int AS n FROM ${tabla} WHERE ${c.where}`, c.params)
      out.push({ etapa, tabla, where, n: Number(r[0]?.n ?? 0), existe: true })
    } catch (e) {
      if (faltaTabla(e)) out.push({ etapa, tabla, where, n: 0, existe: false })
      else throw e
    }
  }
  return out
}

/** Borra en UNA transacción solo las tablas con filas. */
export async function borrarNeon(q, conteo, id, nombre) {
  const conFilas = conteo.filter((t) => t.existe && t.n > 0)
  if (!conFilas.length) return 0
  await q.transaction(conFilas.map((t) => { const c = consulta(t.where, id, nombre); return q.query(`DELETE FROM ${t.tabla} WHERE ${c.where}`, c.params) }))
  return conFilas.reduce((s, t) => s + t.n, 0)
}

/** Carpetas de Drive que el alta de prueba guardó (paso drive). Solo las que se llaman «PRUEBA BOT…». */
export async function carpetasDrive(q, nombre) {
  let filas
  try {
    filas = await q.query(`SELECT resultado->'carpeta'->>'id' AS id, coalesce(resultado->'nombres'->>'carpeta', parcial->>'nombreCarpeta') AS nombre
      FROM cj_altas_pasos WHERE paso = 'drive' AND ${ALTAS.replaceAll('$N', '$1')}`, [nombre])
  } catch (e) { if (faltaTabla(e)) return []; throw e }
  const vistas = new Set()
  return filas.map((f) => ({ id: String(f.id ?? ''), nombre: String(f.nombre ?? '') }))
    .filter((c) => /^[A-Za-z0-9_-]{10,}$/.test(c.id) && normalizarNombre(c.nombre).startsWith(nombre) && !vistas.has(c.id) && vistas.add(c.id))
}

async function depsReales(env) {
  const { neon } = await import('@neondatabase/serverless')
  const url = env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = neon(url)
  const bajas = await import('./limpiar-cliente-prueba-bajas.mjs')
  const exito = await import('./limpiar-cliente-prueba-exito.mjs')
  return {
    q,
    filasCrm: async (ids) => (await bajas.depsReales(env)).filasCrm(ids),
    limpiarBajas: (id, modo, log) => bajas.main([id, `--${modo}`], { env, log }),
    limpiarExito: (id, modo, log) => exito.main(['--id', id, `--${modo}`], { env, salida: log }),
    papeleraCarpeta: env.PUENTE_DRIVE_URL && env.PUENTE_DRIVE_SECRETO
      ? async (carpetaId) => { const { puenteDriveReal } = await import('../lib/bot/alta/puenteDrive.ts'); await puenteDriveReal().aPapeleraCarpeta(carpetaId) }
      : undefined,
  }
}

export async function main(argv = process.argv.slice(2), op = {}) {
  const env = op.env ?? process.env
  const log = op.log ?? ((t) => console.log(t))
  let a
  try { a = parsearArgs(argv, env) } catch (e) { log(`✖ ${e.message}`); return 1 }
  const d = op.deps ?? await depsReales(env)
  const informe = { modo: a.modo, id: a.id, pendientes: [], hecho: [] }
  log(`Cliente de prueba ${a.id} · «${a.nombre}» · ${a.modo === 'real' ? 'BORRANDO' : 'simulación (no borra nada)'}`)
  if (!(env.BOT_CLIENTES_PRUEBA ?? '').toUpperCase().split(/[,;\s]+/).includes(a.id)) log(`  (aviso: ${a.id} no está en BOT_CLIENTES_PRUEBA de este entorno)`)

  // 0. Seguro del CRM: si hay una fila con ese ID, tiene que ser exactamente la de prueba.
  let filas
  try { filas = await d.filasCrm([a.id]) } catch (e) { log(`✖ No se pudo leer el CRM (${String(e?.message ?? e).slice(0, 80)}): no se toca nada.`); return 1 }
  const ajenas = filas.filter((f) => normalizarNombre(f.nombre) !== a.nombre)
  if (ajenas.length) { log(`✖ En el CRM hay ${ajenas.length} fila(s) con el ID ${a.id} que NO se llaman «${a.nombre}». No se toca nada.`); return 1 }
  log(filas.length ? `  CRM: fila ${filas.map((f) => f.fila).join(', ')} (${filas.map((f) => f.estado || 'sin estado').join(', ')})` : '  CRM: no hay fila con ese ID (ya se borró o nunca se cargó)')

  // 1 y 2. Bajas y Éxito (cada una con su propio informe y sus seguros).
  for (const [etapa, f] of [['Bajas', d.limpiarBajas], ['Éxito', d.limpiarExito]]) {
    log(`\n── ${etapa}`)
    try {
      const r = await f(a.id, a.modo, (t) => log(`  ${t}`))
      if (r === 1 || r?.abortado) informe.pendientes.push(`${etapa}: la limpieza abortó (ver arriba)`)
      else if (r === 2) informe.pendientes.push(`${etapa}: quedaron rastros sin borrar (ver arriba); volver a correr --real`)
      else informe.hecho.push(etapa)
    } catch (e) { informe.pendientes.push(`${etapa}: falló (${String(e?.message ?? e).slice(0, 80)})`) }
  }

  // 3. Neon de las etapas intermedias.
  log('\n── Anuncios, Edición, Grabación, Guiones, Kickoff y cartera (Neon)')
  try {
    const conteo = await contarNeon(d.q, TABLAS_ETAPAS, a.id, a.nombre)
    const con = conteo.filter((t) => t.n > 0)
    log(con.length ? con.map((t) => `  ${t.etapa}: ${t.tabla} ${t.n}`).join('\n') : '  Nada que borrar.')
    if (a.modo === 'real' && con.length) { const n = await borrarNeon(d.q, conteo, a.id, a.nombre); log(`  Borradas ${n} fila(s).`) }
    informe.hecho.push('Neon de etapas')
  } catch (e) { informe.pendientes.push(`Neon de etapas: falló, no se borró nada (${String(e?.message ?? e).slice(0, 80)})`) }

  // 4. Alta: carpeta de Drive y filas cj_altas*.
  log('\n── Alta (Drive y Neon)')
  try {
    const carpetas = await carpetasDrive(d.q, a.nombre)
    log(carpetas.length ? `  Drive: ${carpetas.length} carpeta(s) «PRUEBA BOT…» a la papelera` : '  Drive: el alta no guardó carpeta de prueba')
    let carpetasOk = true
    if (a.modo === 'real') {
      for (const c of carpetas) {
        if (!d.papeleraCarpeta) { carpetasOk = false; informe.pendientes.push('Drive: falta PUENTE_DRIVE_URL/PUENTE_DRIVE_SECRETO; mandar la carpeta «PRUEBA BOT … - C.J» a la papelera a mano'); break }
        try { await d.papeleraCarpeta(c.id); log('  Carpeta a la papelera.') } catch (e) { carpetasOk = false; informe.pendientes.push(`Drive: el puente no la mandó a la papelera (${String(e?.message ?? e).slice(0, 80)})`) }
      }
    }
    const conteo = await contarNeon(d.q, TABLAS_ALTA, a.id, a.nombre)
    const con = conteo.filter((t) => t.n > 0)
    log(con.length ? con.map((t) => `  ${t.tabla} ${t.n}`).join('\n') : '  Neon: sin filas del alta')
    // Las filas del alta guardan el id de la carpeta: si Drive falló, se conservan para reintentar.
    if (a.modo === 'real' && con.length) {
      if (carpetasOk) { const n = await borrarNeon(d.q, conteo, a.id, a.nombre); log(`  Borradas ${n} fila(s) del alta.`) }
      else log('  Las filas del alta se conservan hasta que la carpeta vaya a la papelera (tienen su id).')
    }
    if (carpetasOk) informe.hecho.push('Alta')
  } catch (e) { informe.pendientes.push(`Alta: falló (${String(e?.message ?? e).slice(0, 80)})`) }

  // 5. Lo que queda a mano.
  log('\n── A mano (el bot no lo puede borrar solo)')
  for (const t of A_MANO) log(`  · ${t.replace('<nombre>', a.nombre)}`)
  if (informe.pendientes.length) {
    log(`\n⚠ Pendiente (${informe.pendientes.length}):`)
    for (const p of informe.pendientes) log(`  · ${p}`)
  }
  if (a.modo === 'simular') log('\nSimulación: no se borró nada. Para borrar: --real')
  op.informe?.(informe)
  return informe.pendientes.length ? 2 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((c) => { process.exitCode = c }, (e) => { console.error(`✖ ${String(e?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)}`); process.exitCode = 1 })
}
