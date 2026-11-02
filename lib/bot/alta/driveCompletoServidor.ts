// ── Revisión diaria «Drive completo»: dependencias reales (SOLO servidor) ───────────────────────────────────────────────
// El núcleo y las reglas están en driveCompleto.ts (docs/BOT-ALTA-CJ.md, «Drive completo»). Acá: CRM (lib/clientes/leer),
// Drive con la cuenta de servicio (solo lectura) y el Puente Drive (escritura), Neon (registro del vigía y Doc de guiones) y
// las alertas de Discord. También carpetaEsDelCliente(): la usa el paso Drive del alta para seguir en una carpeta que ya
// existía (armada a mano) sin esperar el OK.
import { neon } from '@neondatabase/serverless'
import { googleConfigurado, googleJson } from '@/lib/auth/googleRest'
import { claveNombre } from '@/lib/clientes/prioridad'
import { hoyArgentina } from '@/lib/clientes/fechas'
import {
  CARPETA_CLIENTES_DRIVE, MIME_CARPETA_DRIVE, listarHijosDriveReal, plantillaGuionesDesdeEntorno, prepararDriveCliente,
} from './driveCliente'
import { esIdDrive } from './puenteDrive'
import { correrDriveCompleto, esPrueba, type ClienteActivo, type DepsDriveCompleto, type EntradaPlan, type OpcionesCorrida, type ResultadoCorrida, type VinculoCarpeta } from './driveCompleto'

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const VINCULOS_QUE_PROCESAN = ['alta', 'aylu', 'tomas', 'bot']
const base = () => {
  const u = process.env.DATABASE_URL?.trim()
  if (!u) throw new Error('falta DATABASE_URL')
  return neon(u, { fetchOptions: { signal: AbortSignal.timeout(15_000) } })
}
const sinTabla = (e: unknown) => (e as { code?: string })?.code === '42P01'

/** Carpetas directas de la raíz Clientes (cuenta de servicio). */
async function carpetasRaiz(raiz: string): Promise<{ id: string; nombre: string }[]> {
  if (!googleConfigurado()) throw new Error('la cuenta de servicio de Google no está configurada')
  const out: { id: string; nombre: string }[] = []
  let token = ''
  do {
    const q = encodeURIComponent(`'${raiz}' in parents and mimeType='${MIME_CARPETA_DRIVE}' and trashed=false`)
    const r = await googleJson<{ files?: { id: string; name: string }[]; nextPageToken?: string }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
      { scopes: SCOPE })
    out.push(...(r.files ?? []).map((f) => ({ id: f.id, nombre: f.name })))
    token = r.nextPageToken ?? ''
  } while (token)
  // "Ex clientes" y similares no son carpetas de un cliente
  return out.filter((c) => !/^\s*(\d+\s*-\s*)?ex\s*clientes?\s*$/i.test(c.nombre))
}

/** Vínculos carpeta ↔ cliente registrados en el Despacho. */
async function vinculosRegistrados(): Promise<VinculoCarpeta[]> {
  const q = base()
  const out: VinculoCarpeta[] = []
  const intentar = async (f: () => Promise<VinculoCarpeta[]>) => { try { out.push(...(await f())) } catch (e) { if (!sinTabla(e)) throw e } }
  await intentar(async () => (await q`SELECT drive_id, upper(id_crm) AS id_crm, vinculo FROM cj_grab_carpetas
      WHERE tipo = 'cliente' AND borrada IS NULL AND id_crm IS NOT NULL AND vinculo = ANY(${VINCULOS_QUE_PROCESAN}::text[])`)
    .map((r) => ({ drive_id: String(r.drive_id), id_crm: String(r.id_crm), origen: 'vigia' as const, vinculo: String(r.vinculo) })))
  await intentar(async () => (await q`SELECT carpeta_id, upper(id_crm) AS id_crm FROM cj_guiones_documentos WHERE carpeta_id IS NOT NULL AND estado = 'listo'`)
    .map((r) => ({ drive_id: String(r.carpeta_id), id_crm: String(r.id_crm), origen: 'doc' as const })))
  await intentar(async () => (await q`SELECT DISTINCT upper(COALESCE(c.parcial->>'id', c.resultado->>'id')) AS id_crm,
        COALESCE(d.parcial->'guardado'->'carpeta'->>'id', d.resultado->'guardar'->'carpeta'->>'id') AS carpeta_id
      FROM cj_altas_pasos c JOIN cj_altas_pasos d ON d.alta_id = c.alta_id AND d.paso = 'drive'
      WHERE c.paso = 'crm' AND c.estado = 'hecho' AND d.estado = 'hecho'`)
    .filter((r) => r.id_crm && r.carpeta_id).map((r) => ({ drive_id: String(r.carpeta_id), id_crm: String(r.id_crm), origen: 'alta' as const })))
  return out.filter((v) => esIdDrive(v.drive_id) && /^[A-Z]\d{1,6}$/.test(v.id_crm))
}

/** Altas del motor sin terminar (incluidas las en Fee) con el paso Drive sin hacer. */
async function altasEnCurso(): Promise<{ id_crm: string | null; nombre: string }[]> {
  try {
    const filas = await base()`SELECT a.nombre_cliente AS nombre,
        (SELECT upper(COALESCE(c.parcial->>'id', c.resultado->>'id')) FROM cj_altas_pasos c WHERE c.alta_id = a.id AND c.paso = 'crm' LIMIT 1) AS id_crm
      FROM cj_altas a
      WHERE a.estado NOT IN ('lista', 'rechazada', 'reemplazada', 'duplicada', 'simulada', 'vencida')
        AND NOT EXISTS (SELECT 1 FROM cj_altas_pasos d WHERE d.alta_id = a.id AND d.paso = 'drive' AND d.estado IN ('hecho', 'omitido'))`
    return filas.map((r) => ({ id_crm: r.id_crm ? String(r.id_crm) : null, nombre: String(r.nombre ?? '') }))
  } catch (e) { if (sinTabla(e)) return []; throw e }
}

async function leerEntradaReal(): Promise<EntradaPlan & { carpetaClientesId: string }> {
  const raiz = CARPETA_CLIENTES_DRIVE
  if (!esIdDrive(raiz)) throw new Error('falta DRIVE_CARPETA_CLIENTES válido')
  const [{ leerClientes }, { leerArchivados }] = await Promise.all([import('@/lib/clientes/leer'), import('@/lib/clientes/archivados')])
  const [d, archivados, carpetas, vinculos, enCurso] = await Promise.all([leerClientes(), leerArchivados(), carpetasRaiz(raiz), vinculosRegistrados(), altasEnCurso()])
  const conId = d.clientes.filter((c) => /^[A-Za-z]\d{1,6}$/.test(c.id) && !c.sinId)
  const clientes: ClienteActivo[] = conId
    .filter((c) => c.estado.toUpperCase() === 'ACTIVO' && !archivados.has(c.id.toUpperCase()) && !esPrueba(c.nombre) && !c.esNoCliente && c.linea === 'agencia')
    .map((c) => ({ id: c.id.toUpperCase(), nombre: c.nombre.trim(), dia1: c.dia1 ?? null, correo: c.mail || null }))
  return { clientes, todosCrm: conId.map((c) => ({ id: c.id.toUpperCase(), nombre: c.nombre })), carpetas, vinculos, altasEnCurso: enCurso, hoy: hoyArgentina(), carpetaClientesId: raiz }
}

export function depsDriveCompletoReales(hasta: number): DepsDriveCompleto {
  return {
    leerEntrada: leerEntradaReal,
    listarHijos: listarHijosDriveReal,
    preparar: (a, op) => prepararDriveCliente(a, { ...op, hasta }),
    plantillaGuionesId: plantillaGuionesDesdeEntorno,
    async registradasVigia() {
      try { return new Set((await base()`SELECT drive_id FROM cj_grab_carpetas WHERE borrada IS NULL`).map((r) => String(r.drive_id))) } catch (e) { if (sinTabla(e)) return new Set(); throw e }
    },
    async docsListos() {
      // Los que ya tienen un Doc vinculado en algún lado (Guiones o Edición): no se les registra otro
      const ids = new Set<string>()
      for (const leer of [
        () => base()`SELECT upper(id_crm) AS id FROM cj_guiones_documentos WHERE doc_id IS NOT NULL`,
        () => base()`SELECT DISTINCT upper(id_crm) AS id FROM cj_grab_guiones WHERE doc_id IS NOT NULL`,
      ]) { try { for (const r of await leer()) ids.add(String(r.id)) } catch (e) { if (!sinTabla(e)) throw e } }
      return ids
    },
    async guardarVigia(filas) {
      const { guardarArbol } = await import('@/lib/edicion/operativo')
      await guardarArbol(filas.map((f) => ({
        drive_id: f.drive_id, nombre: f.nombre, padre_id: f.padre_id, nivel: 0, ruta: [], id_crm: f.id_crm, tipo: f.tipo,
        raiz: f.tipo === 'cliente' ? null : f.tipo, raiz_id: f.tipo === 'cliente' ? null : f.drive_id, vinculo: f.vinculo as 'bot', candidatos: [],
        vigilar: f.vigilar, creada: null, ultimo_archivo: null, consultada: null, borrada: null,
      })))
    },
    async vincularDoc(p) {
      const { vincularDocumentoAlta } = await import('@/lib/bot/guiones/documento')
      await vincularDocumentoAlta(p, hasta)
    },
    async avisar(a) {
      const { alertar } = await import('@/lib/alertas')
      const r = await alertar({ canal: a.canal, tipo: a.tipo, clave: a.clave, titulo: a.titulo, cliente: a.cliente ?? null, idCrm: a.idCrm ?? null, lineas: a.lineas, menciones: a.menciones ?? [], emoji: a.canal === 'operaciones' ? '📁' : '🗂️' })
      return r.estado
    },
    ahora: Date.now,
  }
}

export async function correrDriveCompletoReal(op: OpcionesCorrida & { inicio?: number }): Promise<ResultadoCorrida> {
  const inicio = op.inicio ?? Date.now()
  const deadline = op.deadline ?? inicio + 240_000
  return correrDriveCompleto(depsDriveCompletoReales(deadline), { ...op, deadline })
}

/** ¿La carpeta que ya estaba en Clientes es de este cliente? (paso Drive del alta). Sí solo si: el ID es válido, la
 *  carpeta no está registrada a OTRO ID en el Despacho y en el CRM no hay otro cliente (de cualquier estado) con el mismo
 *  nombre. Ante cualquier duda (o un error de lectura) devuelve false y el alta espera el OK como siempre. */
export async function carpetaEsDelCliente(idCrm: string | null | undefined, nombre: string | null | undefined, carpetaId: string): Promise<boolean> {
  const id = (idCrm ?? '').trim().toUpperCase()
  if (!/^[A-Z]\d{1,6}$/.test(id) || !nombre?.trim() || !esIdDrive(carpetaId)) return false
  const vinculos = await vinculosRegistrados()
  if (vinculos.some((v) => v.drive_id === carpetaId && v.id_crm !== id)) return false
  const { leerClientes } = await import('@/lib/clientes/leer')
  const d = await leerClientes()
  const k = claveNombre(nombre)
  return !d.clientes.some((c) => c.id && c.id.toUpperCase() !== id && claveNombre(c.nombre) === k)
}
