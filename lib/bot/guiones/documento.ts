// Resolución automática del Doc. El alta se cruza por ID CRM, nunca por semejanza de nombres.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { googleJson, sheetsBase } from '@/lib/auth/googleRest'
import { columnasDeClientes } from '@/lib/clientes/parsear'
import type { Fila } from '@/lib/clientes/tipos'
import { nombresDriveCliente, plantillaGuionesDesdeEntorno, CARPETA_CLIENTES_DRIVE } from '../alta/driveCliente'
import { puenteDriveReal, ErrorPuente } from '../alta/puenteDrive'
import type { FilaTanda } from './registro'
const ID = /^[A-Za-z0-9_-]{20,100}$/
const MIME_DOC = 'application/vnd.google-apps.document', MIME_FOLDER = 'application/vnd.google-apps.folder'
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export interface DocAutomatico { id: string; url: string }
export interface ArchivoDoc { id: string; name: string; mimeType: string; trashed?: boolean; parents?: string[] }
export interface DepsDocumento {
  guardado(idCrm: string): Promise<{ doc: string | null; carpeta: string | null } | null>
  alias?(idCrm: string, nombre: string): Promise<{ doc: ArchivoDoc; carpeta: string } | null>
  metadata(id: string): Promise<ArchivoDoc>
  nombreUnico(idCrm: string, nombre: string): Promise<boolean>
  carpetas(nombre: string): Promise<ArchivoDoc[]>
  documentos(carpeta: string): Promise<ArchivoDoc[]>
  reservar(idCrm: string): Promise<boolean>
  confirmar(idCrm: string, doc: DocAutomatico, carpeta: string | null): Promise<void>
  guardarCarpeta(idCrm: string, carpeta: string): Promise<void>
  dudoso(idCrm: string, seguro?: boolean): Promise<void>
  crearCarpeta(nombre: string): Promise<{ id: string }>
  copiar(plantilla: string, carpeta: string, nombre: string): Promise<DocAutomatico>
  plantilla(): string | null
}
const comoDoc = (a: ArchivoDoc): DocAutomatico => {
  if (!ID.test(a.id) || a.mimeType !== MIME_DOC || a.trashed || !/^Guiones\s*-/i.test(a.name)) throw new Error('El archivo vinculado no es un Doc de guiones vigente del cliente.')
  return { id: a.id, url: `https://docs.google.com/document/d/${a.id}/edit` }
}
export async function resolverDocumento(fila: Pick<FilaTanda, 'id_crm' | 'cliente' | 'doc'>, deps: DepsDocumento): Promise<DocAutomatico> {
  if (fila.doc?.id) return comoDoc(await deps.metadata(fila.doc.id))
  const idCrm = fila.id_crm?.toUpperCase()
  if (!idCrm || !/^[A-Z]\d{1,6}$/.test(idCrm)) throw new Error('Falta el ID CRM para vincular el Doc de forma segura.')
  const guardado = await deps.guardado(idCrm)
  if (guardado?.doc) return comoDoc(await deps.metadata(guardado.doc))
  const alias = await deps.alias?.(idCrm, fila.cliente ?? '')
  if (alias) {
    if (guardado?.carpeta && guardado.carpeta !== alias.carpeta) throw new Error('El Doc del alias y la carpeta vinculada no coinciden. Revisar antes de escribir.')
    const doc = comoDoc(alias.doc)
    await deps.confirmar(idCrm, doc, alias.carpeta)
    return doc
  }
  if (!guardado?.carpeta && !(await deps.nombreUnico(idCrm, fila.cliente ?? ''))) throw new Error('El nombre no identifica un solo cliente del CRM. Revisar el vínculo de Drive antes de escribir.')
  const nombres = nombresDriveCliente(fila.cliente)
  if (!nombres) throw new Error('Falta confirmar el nombre del cliente para crear su Doc.')
  let carpeta = guardado?.carpeta ?? null
  if (!carpeta) {
    const encontradas = await deps.carpetas(nombres.cliente)
    if (encontradas.length > 1) throw new Error('Hay más de una carpeta del cliente: revisar el vínculo antes de escribir.')
    carpeta = encontradas[0]?.id ?? null
  }
  if (carpeta) {
    const docs = (await deps.documentos(carpeta)).filter(d => d.mimeType === MIME_DOC && !d.trashed && /^Guiones\s*-/i.test(d.name))
    if (docs.length > 1) throw new Error('Hay más de un Doc de guiones en la carpeta del cliente: revisar cuál corresponde.')
    if (docs.length === 1) { const doc = comoDoc(docs[0]); await deps.confirmar(idCrm, doc, carpeta); return doc }
  }
  const plantilla = deps.plantilla()
  if (!plantilla || !ID.test(plantilla)) throw new Error('Falta configurar la plantilla de guiones para crear el documento.')
  if (!(await deps.reservar(idCrm))) throw new Error('La creación de este Doc está en curso o quedó por confirmar. No se crea una segunda copia.')
  try {
    if (!carpeta) {
      carpeta = (await deps.crearCarpeta(nombres.carpeta)).id
      if (!ID.test(carpeta)) throw new Error('Drive no confirmó el ID de la carpeta creada.')
      await deps.guardarCarpeta(idCrm, carpeta)
    }
    const doc = await deps.copiar(plantilla, carpeta, nombres.guiones)
    if (!ID.test(doc.id)) throw new Error('Drive no confirmó el ID del documento creado.')
    await deps.confirmar(idCrm, doc, carpeta)
    return { id: doc.id, url: `https://docs.google.com/document/d/${doc.id}/edit` }
  } catch (e) { await deps.dudoso(idCrm, e instanceof ErrorPuente && e.aplicado === false).catch(() => {}); throw e }
}
const sinTabla = (e: unknown) => (e as { code?: string })?.code === '42P01'
const escapeQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const exacto = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
interface DepsAlias {
  filas(): Promise<{ agencia: Fila[]; alias: Fila[] }>
  documentos(titulo: string): Promise<ArchivoDoc[]>
  metadata(id: string): Promise<ArchivoDoc>
  raiz: string
}
/** Respaldo de legados sin índice: sólo alias explícito, nombre único y Doc único dentro de Clientes. */
export async function resolverAliasDocumento(idCrm: string, nombre: string, deps: DepsAlias): Promise<{ doc: ArchivoDoc; carpeta: string } | null> {
  const filas = await deps.filas()
  if (filas.agencia.length >= 2001 || filas.alias.length >= 1001) throw new Error('La lectura de clientes o alias puede estar truncada: revisar antes de crear el Doc.')
  const columnas = columnasDeClientes('Agencia', filas.agencia[0])
  if (['id', 'nombre'].some(k => columnas.idx[k as 'id' | 'nombre'] < 0 || columnas.resumen.duplicadas.includes(k))) throw new Error('El CRM no permite confirmar el ID y el nombre del alias de guiones.')
  const clientes = filas.agencia.slice(1).filter(f => /^[A-Za-z]\d{1,6}$/.test(String(f[columnas.idx.id] ?? '').trim()))
  const mismoId = clientes.filter(f => String(f[columnas.idx.id]).trim().toUpperCase() === idCrm)
  const mismoNombre = clientes.filter(f => exacto(f[columnas.idx.nombre]) === exacto(nombre))
  if (!exacto(nombre) || mismoId.length !== 1 || mismoNombre.length !== 1 || mismoNombre[0] !== mismoId[0]) throw new Error('El alias no corresponde a un ID y nombre únicos del CRM actual.')
  if (!/^alias\b/.test(exacto(filas.alias[0]?.[0])) || !/^cliente\b/.test(exacto(filas.alias[0]?.[1]))) throw new Error('Falta confirmar los encabezados de Alias Guiones antes de crear el Doc.')
  const pares = filas.alias.slice(1).map(f => ({ alias: String(f[0] ?? '').trim(), cliente: String(f[1] ?? '').trim() }))
  const vinculados = pares.filter(f => exacto(f.cliente) === exacto(nombre))
  if (!vinculados.length) return null
  const nombres = [...new Set(vinculados.map(f => f.alias))]
  if (nombres.length !== 1 || !nombres[0] || nombres[0].length > 120 || /[\r\n\x00-\x1f]/.test(nombres[0]) || pares.some(f => exacto(f.alias) === exacto(nombres[0]) && exacto(f.cliente) !== exacto(nombre))) throw new Error('El alias de guiones es ambiguo o inválido: revisar el vínculo antes de crear el Doc.')
  const titulo = `Guiones - ${nombres[0]}`
  const docs = await deps.documentos(titulo)
  if (docs.length !== 1 || docs[0].name !== titulo) throw new Error('El alias configurado no identifica un solo Doc existente: no se crea una copia nueva.')
  const doc = docs[0]
  comoDoc(doc)
  if (doc.parents?.length !== 1 || !ID.test(doc.parents[0])) throw new Error('No se pudo confirmar la carpeta del Doc anterior: no se crea una copia nueva.')
  const carpeta = await deps.metadata(doc.parents[0])
  if (carpeta.id !== doc.parents[0] || carpeta.mimeType !== MIME_FOLDER || carpeta.trashed || carpeta.parents?.length !== 1 || carpeta.parents[0] !== deps.raiz) throw new Error('El Doc del alias no está en una carpeta directa de Clientes: revisar el vínculo antes de escribir.')
  return { doc, carpeta: carpeta.id }
}
export function depsDocumentoReales(hasta: number, consultaParaPruebas?: () => NeonQueryFunction<false, false>): DepsDocumento {
  const q = () => {
    if (consultaParaPruebas) return consultaParaPruebas()
    if (!process.env.DATABASE_URL?.trim()) throw new Error('Falta la base del Despacho.')
    return neon(process.env.DATABASE_URL.trim(), { fetchOptions: { signal: AbortSignal.timeout(10_000) } })
  }
  const tabla = async () => { try { await q()`CREATE TABLE IF NOT EXISTS cj_guiones_documentos (id_crm text PRIMARY KEY, estado text NOT NULL, doc_id text, carpeta_id text, actualizado timestamptz NOT NULL DEFAULT now())` } catch (e) { if (!['23505', '42P07'].includes((e as { code?: string })?.code ?? '')) throw e } }
  async function listar(query: string): Promise<ArchivoDoc[]> {
    const r = await googleJson<{ files?: ArchivoDoc[]; nextPageToken?: string }>(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=100&fields=nextPageToken,files(id,name,mimeType,trashed,parents)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { scopes: SCOPE })
    if (r.nextPageToken) throw new Error('La búsqueda de Drive tiene demasiados resultados: revisar la carpeta del cliente.')
    return r.files ?? []
  }
  const raiz = process.env.DRIVE_CARPETA_CLIENTES?.trim() || CARPETA_CLIENTES_DRIVE
  const puente = () => puenteDriveReal({ hasta })
  const metadata = (id: string) => googleJson<ArchivoDoc>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed,parents&supportsAllDrives=true`, { scopes: SCOPE })
  return {
    async guardado(idCrm) {
      const guardados: { doc: string | null; carpeta: string | null }[] = []
      try {
        const rows = await q()`SELECT doc_id, carpeta_id, estado FROM cj_guiones_documentos WHERE id_crm = ${idCrm}`
        if (rows[0]?.estado === 'listo' && rows[0]?.doc_id) return { doc: String(rows[0].doc_id), carpeta: rows[0].carpeta_id ? String(rows[0].carpeta_id) : null }
        if (rows[0]?.carpeta_id) guardados.push({ doc: null, carpeta: String(rows[0].carpeta_id) })
      } catch (e) { if (!sinTabla(e)) throw e }
      try {
        const rows = await q()`SELECT DISTINCT
            COALESCE(d.parcial->'guardado'->'guiones'->>'id', d.resultado->'guardar'->'guiones'->>'id') AS doc_id,
            COALESCE(d.parcial->'guardado'->'carpeta'->>'id', d.resultado->'guardar'->'carpeta'->>'id') AS carpeta_id
          FROM cj_altas_pasos c JOIN cj_altas_pasos d ON d.alta_id = c.alta_id AND d.paso = 'drive'
          WHERE c.paso = 'crm' AND c.estado = 'hecho' AND upper(COALESCE(c.parcial->>'id', c.resultado->>'id')) = ${idCrm}
            AND d.estado = 'hecho' LIMIT 2`
        guardados.push(...rows.map(r => ({ doc: r.doc_id ? String(r.doc_id) : null, carpeta: r.carpeta_id ? String(r.carpeta_id) : null })).filter(x => x.doc || x.carpeta))
      } catch (e) { if (!sinTabla(e)) throw e }
      // Edición conserva los IDs de Docs/carpetas anteriores, incluso si el nombre del CRM cambió.
      // No usar el "último leído": dos vínculos distintos requieren revisión antes de crear otro Doc.
      try {
        const rows = await q()`SELECT DISTINCT doc_id FROM cj_grab_guiones WHERE upper(id_crm) = ${idCrm} LIMIT 2`
        guardados.push(...rows.filter(r => r.doc_id).map(r => ({ doc: String(r.doc_id), carpeta: null })))
      } catch (e) { if (!sinTabla(e)) throw e }
      try {
        const rows = await q()`SELECT DISTINCT drive_id FROM cj_grab_carpetas WHERE upper(id_crm) = ${idCrm}
          AND tipo = 'cliente' AND borrada IS NULL AND vinculo IN ('alta', 'aylu', 'tomas', 'bot') LIMIT 2`
        guardados.push(...rows.filter(r => r.drive_id).map(r => ({ doc: null, carpeta: String(r.drive_id) })))
      } catch (e) { if (!sinTabla(e)) throw e }
      const docs = [...new Set(guardados.map(x => x.doc).filter((x): x is string => !!x))]
      const carpetas = [...new Set(guardados.map(x => x.carpeta).filter((x): x is string => !!x))]
      if (docs.length > 1 || carpetas.length > 1) throw new Error('Hay vínculos de Drive distintos para este ID CRM: revisar antes de escribir.')
      if ([...docs, ...carpetas].some(x => !ID.test(x))) throw new Error('El vínculo de Drive guardado para este ID CRM es inválido.')
      return docs.length || carpetas.length ? { doc: docs[0] ?? null, carpeta: carpetas[0] ?? null } : null
    },
    alias: (idCrm, nombre) => resolverAliasDocumento(idCrm, nombre, {
      raiz, metadata,
      documentos: titulo => listar(`name = '${escapeQ(titulo)}' and mimeType = '${MIME_DOC}' and trashed=false`),
      async filas() {
        const crm = process.env.SHEET_ID_CLIENTES?.trim()
        if (!crm) throw new Error('Falta el CRM para comprobar los alias anteriores de guiones.')
        const rangos = ["'Agencia'!A1:AD2001", "'Alias Guiones'!A1:B1001"]
        const r = await googleJson<{ valueRanges?: { values?: Fila[] }[] }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(crm)}/values:batchGet?${new URLSearchParams(rangos.map(r => ['ranges', r]))}&valueRenderOption=FORMATTED_VALUE`, { scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' })
        return { agencia: r.valueRanges?.[0]?.values ?? [], alias: r.valueRanges?.[1]?.values ?? [] }
      },
    }),
    async nombreUnico(idCrm, nombre) {
      const { cargarVista } = await import('@/lib/clientes/vista')
      const { datos } = await cargarVista(false)
      const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
      const clientes = datos.clientes.filter(c => c.linea === 'agencia' && normal(c.nombre) === normal(nombre))
      return clientes.length === 1 && clientes[0].id.toUpperCase() === idCrm
    },
    metadata,
    carpetas: nombre => listar(`'${escapeQ(raiz)}' in parents and mimeType = '${MIME_FOLDER}' and trashed=false and (name = '${escapeQ(nombre)} - C.J' or name = '${escapeQ(nombre)} - SKWD')`),
    documentos: carpeta => listar(`'${escapeQ(carpeta)}' in parents and mimeType = '${MIME_DOC}' and trashed=false`),
    async reservar(idCrm) { await tabla(); return (await q()`INSERT INTO cj_guiones_documentos (id_crm, estado) VALUES (${idCrm}, 'creando') ON CONFLICT (id_crm) DO UPDATE SET estado = 'creando', actualizado = now() WHERE cj_guiones_documentos.estado = 'error' RETURNING id_crm`).length === 1 },
    async confirmar(idCrm, doc, carpeta) { await tabla(); const guardado = await q()`INSERT INTO cj_guiones_documentos (id_crm, estado, doc_id, carpeta_id) VALUES (${idCrm}, 'listo', ${doc.id}, ${carpeta}) ON CONFLICT (id_crm) DO UPDATE SET estado = 'listo', doc_id = EXCLUDED.doc_id, carpeta_id = EXCLUDED.carpeta_id, actualizado = now() WHERE cj_guiones_documentos.doc_id IS NULL OR cj_guiones_documentos.doc_id = EXCLUDED.doc_id RETURNING id_crm`; if (!guardado.length) throw new Error('Ya existe otro documento vinculado a este ID CRM: no se reemplazó.') },
    async guardarCarpeta(idCrm, carpeta) { await q()`UPDATE cj_guiones_documentos SET carpeta_id = ${carpeta}, actualizado = now() WHERE id_crm = ${idCrm} AND estado = 'creando'` },
    async dudoso(idCrm, seguro) { await q()`UPDATE cj_guiones_documentos SET estado = ${seguro ? 'error' : 'dudoso'}, actualizado = now() WHERE id_crm = ${idCrm} AND estado = 'creando'` },
    crearCarpeta: nombre => puente().crearCarpeta({ padreId: raiz, nombre }),
    copiar: (plantilla, carpeta, nombre) => puente().copiarArchivo({ archivoId: plantilla, carpetaId: carpeta, nombre }),
    plantilla: plantillaGuionesDesdeEntorno,
  }
}

/** El alta registra el vínculo exacto apenas copia la plantilla; no espera al kickoff ni a la aprobación. */
export async function vincularDocumentoAlta(p: { idCrm: string; docId: string; carpetaId: string | null }, hasta: number): Promise<DocAutomatico> {
  if (!/^[A-Za-z]\d{1,6}$/.test(p.idCrm) || !ID.test(p.docId)) throw new Error('El alta no confirmó un ID CRM y un Doc válidos.')
  const deps = depsDocumentoReales(hasta)
  const doc = comoDoc(await deps.metadata(p.docId))
  await deps.confirmar(p.idCrm.toUpperCase(), doc, p.carpetaId)
  return doc
}

/** Link visible desde la entrada del cliente aunque todavía no exista una tanda. No crea archivos. */
export async function documentoVinculadoCliente(idCrm: string): Promise<DocAutomatico | null> {
  if (!/^[A-Za-z]\d{1,6}$/.test(idCrm) || !process.env.DATABASE_URL) return null
  const deps = depsDocumentoReales(Date.now() + 15_000)
  const guardado = await deps.guardado(idCrm.toUpperCase())
  return guardado?.doc ? comoDoc(await deps.metadata(guardado.doc)) : null
}

/** Entrada de un cliente anterior sin tanda: confirma la fila CRM actual y vincula su Doc sin generar guiones. */
export async function asegurarDocumentoCliente(idCrm: string, hasta = Date.now() + 60_000): Promise<DocAutomatico> {
  const [{ leerClienteFresco }, { columnasDeClientes }, { exigirClienteNoArchivado }] = await Promise.all([
    import('@/lib/clientes/acciones/escritor'), import('@/lib/clientes/parsear'), import('@/lib/clientes/archivados'),
  ])
  const lectura = await leerClienteFresco(idCrm)
  await exigirClienteNoArchivado(lectura.cliente.id)
  const columnas = columnasDeClientes('Agencia', lectura.agencia[0])
  if (['id', 'nombre'].some(k => columnas.idx[k as 'id' | 'nombre'] < 0 || columnas.resumen.duplicadas.includes(k))) throw new Error('El CRM no permite confirmar un ID y un nombre únicos para vincular Drive.')
  const normal = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const mismoNombre = lectura.agencia.slice(1).filter(f => /^[A-Za-z]\d{1,6}$/.test(String(f[columnas.idx.id] ?? '').trim()) && normal(f[columnas.idx.nombre]) === normal(lectura.cliente.nombre))
  const deps = depsDocumentoReales(hasta)
  return resolverDocumento({ id_crm: lectura.cliente.id, cliente: lectura.cliente.nombre, doc: null }, { ...deps, nombreUnico: async () => mismoNombre.length === 1 })
}
