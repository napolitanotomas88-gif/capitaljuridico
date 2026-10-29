import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolverDocumento, depsDocumentoReales, resolverAliasDocumento } from '../lib/bot/guiones/documento.ts'
import { avisosEntrega, destinatariosEntrega, puedeEntregarGuiones } from '../lib/bot/guiones/entrega.ts'
import { publicarParaEntrega } from '../lib/bot/guiones/publicacion.ts'
import { iniciar, correrPaso, reanudar } from '../lib/bot/guiones/proceso.ts'
const ID = 'documento_guiones_cliente_1234', FOLDER = 'carpeta_cliente_1234567890123', TEMPLATE = 'plantilla_guiones_1234567890123'
const archivo = { id: ID, name: 'Guiones - AnaP', mimeType: 'application/vnd.google-apps.document' }
const fila = { id: 7, id_crm: 'A149', cliente: 'Ana Pérez', estado: 'aprobada', tanda: 1, doc: null, guiones: {}, aprobacion: { quien: 'Faus', cuando: '2026-10-28T12:00:00Z' }, actualizado: '2026-10-28T12:01:00Z' }
const base = (o = {}) => {
  const log = [], deps = {
    guardado: async () => null, nombreUnico: async () => true, metadata: async id => ({ ...archivo, id }), carpetas: async () => [{ id: FOLDER }], documentos: async () => [archivo],
    reservar: async () => { log.push('reserva'); return true }, confirmar: async () => { log.push('guardado') }, guardarCarpeta: async () => { log.push('carpeta guardada') }, dudoso: async () => { log.push('dudoso') },
    crearCarpeta: async () => { log.push('carpeta'); return { id: FOLDER } }, copiar: async () => { log.push('copia'); return { id: ID, url: 'ignorada' } }, plantilla: () => TEMPLATE, ...o,
  }; return { log, deps }
}
test('resuelve el ID guardado del alta sin buscar por nombre ni crear archivos', async () => {
  const a = base({ guardado: async () => ({ doc: ID, carpeta: FOLDER }), carpetas: async () => { throw new Error('No debe buscar') } })
  assert.equal((await resolverDocumento(fila, a.deps)).id, ID); assert.deepEqual(a.log, [])
})
test('un vínculo anterior de Edición por ID CRM prevalece sobre el nombre actual y evita crear otro Doc', async () => {
  const consultas = []
  const q = async (partes, ...valores) => {
    const sql = partes.join('?'); consultas.push(sql); assert.equal(valores[0], 'A078')
    if (sql.includes('FROM cj_grab_guiones')) return [{ doc_id: ID }]
    if (sql.includes('FROM cj_grab_carpetas')) return [{ drive_id: FOLDER }]
    throw Object.assign(new Error('relation does not exist'), { code: '42P01' })
  }
  const real = depsDocumentoReales(1000, () => q)
  const a = base({ guardado: real.guardado, nombreUnico: async () => { throw new Error('No debe cruzar el nombre') }, carpetas: async () => { throw new Error('No debe buscar otra carpeta') } })
  assert.equal((await resolverDocumento({ ...fila, id_crm: 'A078', cliente: 'Nombre completo actual del CRM' }, a.deps)).id, ID)
  assert.equal(consultas.length, 4); assert.deepEqual(a.log, [])
})
test('vínculos de Edición ambiguos o fallas que no son 42P01 bloquean sin crear ni escribir', async () => {
  for (const variante of ['docs', 'carpetas', 'error']) {
    const q = async partes => {
      const sql = partes.join('?')
      if (sql.includes('FROM cj_grab_guiones')) {
        if (variante === 'error') throw Object.assign(new Error('column does not exist'), { code: '42703' })
        return [{ doc_id: ID }, ...(variante === 'docs' ? [{ doc_id: 'otro_documento_cliente_123456789' }] : [])]
      }
      if (sql.includes('FROM cj_grab_carpetas')) return [{ drive_id: FOLDER }, ...(variante === 'carpetas' ? [{ drive_id: 'otra_carpeta_cliente_123456789' }] : [])]
      return []
    }
    const a = base({ guardado: depsDocumentoReales(1000, () => q).guardado })
    await assert.rejects(resolverDocumento(fila, a.deps), variante === 'error' ? /column does not exist/ : /vínculos de Drive distintos/)
    assert.deepEqual(a.log, [])
  }
})
const raiz = 'raiz_clientes_drive_1234567890'
const aliasLegado = (o = {}) => ({
  raiz,
  filas: async () => ({ agencia: [['', '', 'Estado'], ['A078', 'Maria de la Paz Robles', 'ACTIVO']], alias: [['Alias en sheet de Guiones', 'Cliente en CRM'], ['PazR', 'Maria de la Paz Robles']] }),
  documentos: async titulo => [{ ...archivo, name: titulo, parents: [FOLDER] }],
  metadata: async id => ({ id, name: 'Paz Robles - SKWD', mimeType: 'application/vnd.google-apps.folder', parents: [raiz] }), ...o,
})
test('legado no indexado: alias explícito y Doc exacto dentro de Clientes vinculan el manual sin crear archivos', async () => {
  const consultas = []
  const legado = aliasLegado({ documentos: async titulo => { consultas.push(titulo); return [{ ...archivo, name: titulo, parents: [FOLDER] }] } })
  let guardado = null
  const a = base({
    guardado: async () => guardado,
    alias: (id, nombre) => resolverAliasDocumento(id, nombre, legado),
    nombreUnico: async () => { throw new Error('No debe buscar por el nombre actual') },
    confirmar: async (id, doc, carpeta) => { assert.equal(id, 'A078'); assert.equal(carpeta, FOLDER); guardado = { doc: doc.id, carpeta }; a.log.push('guardado') },
  })
  const entrada = { ...fila, id_crm: 'A078', cliente: 'Maria de la Paz Robles' }
  assert.equal((await resolverDocumento(entrada, a.deps)).id, ID)
  assert.equal((await resolverDocumento(entrada, a.deps)).id, ID)
  assert.deepEqual(consultas, ['Guiones - PazR']); assert.deepEqual(a.log, ['guardado'])
})
test('alias dudoso, Doc ausente o ajeno a Clientes bloquean sin reservar, copiar ni confirmar', async () => {
  const normales = await aliasLegado().filas()
  for (const cambios of [
    { filas: async () => ({ ...normales, agencia: [...normales.agencia, ['A079', 'Maria de la Paz Robles', 'ACTIVO']] }) },
    { filas: async () => ({ ...normales, alias: [...normales.alias, ['PazR', 'Otro cliente']] }) },
    { filas: async () => ({ ...normales, alias: [...normales.alias, ['OtraPaz', 'Maria de la Paz Robles']] }) },
    { filas: async () => ({ ...normales, alias: [['Encabezado cambiado', 'Cliente'], ...normales.alias.slice(1)] }) },
    { documentos: async () => [] },
    { documentos: async titulo => [1, 2].map((_, i) => ({ ...archivo, id: `${ID}${i}`, name: titulo, parents: [FOLDER] })) },
    { documentos: async () => [{ ...archivo, name: 'Guiones - Otro', parents: [FOLDER] }] },
    { documentos: async titulo => [{ ...archivo, name: titulo }] },
    { metadata: async id => ({ id, name: 'Ajena', mimeType: 'application/vnd.google-apps.folder', parents: ['otra_raiz_clientes_1234567890'] }) },
    { metadata: async id => ({ id, name: 'Papelera', mimeType: 'application/vnd.google-apps.folder', parents: [raiz], trashed: true }) },
    { filas: async () => { throw new Error('No se pudo leer Alias Guiones') } },
  ]) {
    const a = base({ alias: (id, nombre) => resolverAliasDocumento(id, nombre, aliasLegado(cambios)) })
    await assert.rejects(resolverDocumento({ ...fila, id_crm: 'A078', cliente: 'Maria de la Paz Robles' }, a.deps))
    assert.deepEqual(a.log, [])
  }
})
test('sin alias configurado sigue la carpeta exacta; un Doc ya vinculado nunca necesita leer Alias Guiones', async () => {
  const legado = aliasLegado({ filas: async () => ({ agencia: [['ID', 'Nombre', 'Estado'], ['A149', 'Ana Pérez', 'ACTIVO']], alias: [['Alias', 'Cliente']] }), documentos: async () => { throw new Error('No debe consultar Drive por alias') } })
  const a = base({ alias: (id, nombre) => resolverAliasDocumento(id, nombre, legado) })
  assert.equal((await resolverDocumento(fila, a.deps)).id, ID)
  assert.deepEqual(a.log, ['guardado'])
  const b = base({ guardado: async () => ({ doc: ID, carpeta: FOLDER }), alias: async () => { throw new Error('No debe leer alias') } })
  assert.equal((await resolverDocumento(fila, b.deps)).id, ID); assert.deepEqual(b.log, [])
})
test('un documento de otra clase o en papelera no se utiliza aunque haya un ID guardado', async () => {
  for (const extra of [{ mimeType: 'text/plain' }, { trashed: true }, { name: 'Documento de otro tipo' }]) {
    const a = base({ metadata: async () => ({ ...archivo, ...extra }) })
    await assert.rejects(resolverDocumento({ ...fila, doc: { id: ID } }, a.deps), /no es un Doc/)
    assert.equal(a.log.length, 0)
  }
})
test('un nombre compartido por clientes distintos no permite elegir un Doc por semejanza', async () => {
  const a = base({ nombreUnico: async () => false }); await assert.rejects(resolverDocumento(fila, a.deps), /no identifica un solo cliente/); assert.equal(a.log.length, 0)
})
test('ambigüedad de carpeta o Doc frena sin crear ni escribir', async () => {
  for (const extra of [{ carpetas: async () => [{ id: 'a' }, { id: 'b' }] }, { documentos: async () => [archivo, { ...archivo, id: 'otro_documento_12345678901234' }] }]) {
    const a = base(extra); await assert.rejects(resolverDocumento(fila, a.deps), /más de/); assert.equal(a.log.length, 0)
  }
})
test('crea desde plantilla dentro de la carpeta, y otra corrida no crea una segunda copia', async () => {
  let reservado = false
  const a = base({ documentos: async () => [], reservar: async () => { if (reservado) return false; reservado = true; return true } })
  const resultados = await Promise.allSettled([resolverDocumento(fila, a.deps), resolverDocumento(fila, a.deps)])
  assert.equal(resultados.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(a.log.filter(x => x === 'copia').length, 1)
})
test('sin carpeta crea carpeta y plantilla; si el puente no confirma no anuncia éxito', async () => {
  const a = base({ carpetas: async () => [] }); await resolverDocumento(fila, a.deps)
  assert.deepEqual(a.log, ['reserva', 'carpeta', 'carpeta guardada', 'copia', 'guardado'])
  const b = base({ documentos: async () => [], copiar: async () => { throw new Error('timeout del puente') } })
  await assert.rejects(resolverDocumento(fila, b.deps), /timeout/); assert.ok(b.log.includes('dudoso')); assert.ok(!b.log.includes('guardado'))
})
test('destinatarios de entrega son explícitos, sin abrir permisos a Faus ni al equipo entero', () => {
  const env = { EDICION_REVISOR_AYLU: 'A@X.com', KICKOFF_REVISOR_GERO_M: 'g@x.com', KICKOFF_REVISOR_TOMI: 't@x.com', GUIONES_REVISOR_FAUS: 'f@x.com' }
  assert.deepEqual(destinatariosEntrega(env), ['a@x.com', 'g@x.com', 't@x.com'])
  assert.equal(puedeEntregarGuiones('f@x.com', env), false)
  const avisos = avisosEntrega({ ...fila, doc: { id: ID, url: `https://docs.google.com/document/d/${ID}/edit` } }, env)
  assert.equal(avisos.length, 3); assert.ok(avisos.every(x => x.url.startsWith('/clientes/entregas?cliente=A149')))
  assert.equal(new Set(avisos.map(x => x.clave)).size, 3)
})
const publicador = (o = {}) => {
  const log = []; let actual = { ...fila }
  return { log, deps: {
    reservar: async () => true, leer: async () => actual,
    resolver: async () => { log.push('resolver'); return { id: ID, url: 'ignorada' } },
    escribir: async () => { log.push('escribir'); return { estado: 'ok', id: ID, url: 'https://otro.invalid', tanda: 2 } },
    guardar: async (_id, doc) => { log.push('guardar'); actual = { ...actual, doc }; assert.equal(doc.url, `https://docs.google.com/document/d/${ID}/edit`) },
    notificar: async f => { log.push('notificar'); assert.equal(f.doc.tanda, 2) }, error: async (_id, _msg, dudoso) => log.push(dudoso ? 'dudoso' : 'error'), ...o,
  } }
}
test('la aprobación escribe el Doc antes de avisar al equipo, sin enviar al cliente', async () => {
  const a = publicador(); await publicarParaEntrega(7, Date.now() + 1000, a.deps); assert.deepEqual(a.log, ['resolver', 'escribir', 'guardar', 'notificar'])
})
test('sin reserva o con respuesta dudosa no publica ni entrega el link', async () => {
  const a = publicador({ reservar: async () => false }); await publicarParaEntrega(7, 1, a.deps); assert.equal(a.log.length, 0)
  const b = publicador({ escribir: async () => ({ estado: 'dudoso', motivo: 'timeout' }) }); await publicarParaEntrega(7, 1, b.deps); assert.deepEqual(b.log, ['resolver', 'dudoso'])
})
test('cliente archivado: no reserva publicación ni escribe Doc ni notifica entrega', async () => {
  const a = publicador({ exigirActivo: async () => { throw new Error('Cliente archivado') }, reservar: async () => { throw new Error('No debe reservar') } })
  await publicarParaEntrega(7, 1, a.deps)
  assert.deepEqual(a.log, [])
})
test('cliente archivado: no inicia, no corre un paso y no reanuda trabajo', async () => {
  const log = [], deps = {
    exigirActivo: async () => { throw new Error('Cliente archivado') },
    leerKickoff: async () => ({ id_crm: 'A149', ideas: [{}] }),
    registro: { leerTanda: async () => ({ ...fila, estado: 'mercado' }), crearTanda: async () => { log.push('crear') }, avanzar: async () => { log.push('avanzar') } },
    analizarMercado: async () => { log.push('claude') },
  }
  await assert.rejects(iniciar(1, deps), /archivado/)
  await assert.rejects(correrPaso('mercado', { id: 7 }, 0, deps), /archivado/)
  await assert.rejects(reanudar(7, deps), /archivado/)
  assert.deepEqual(log, [])
})
