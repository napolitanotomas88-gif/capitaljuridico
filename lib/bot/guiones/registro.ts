// ── Registro de las tandas de guiones (Neon, tabla cj_guiones) ───────────────────────────────────
// Una fila por tanda: (recording_id del kickoff, tanda). La generación corre en varias invocaciones (route de
// /api/bot/guiones, proceso.ts): mercado → plan → «guion n» (escribe) → «revisar n» (revisa y corrige) → cierre. Cada paso
// guarda lo suyo APENAS sale (un reintento no vuelve a pagar Claude) y TODAS las escrituras del bot llevan condición sobre el
// estado, así un paso duplicado o tardío no pisa lo que ya editó o aprobó una persona (revisión del 25/10):
//   · guardarGuion: solo con la tanda en «escribiendo» y sin pisar un guion ya «listo».
//   · marcarError: solo en los estados de trabajo del bot (nunca sobre a_revisar / aprobada / enviada).
//   · reclamar(): para retomar, atómico: desde «error» o desde un estado de trabajo SIN movimiento hace más de VENCIDO_S.
//   · anotarWhatsApp: «enviada» solo si seguía «aprobada»; reservarWhatsApp: un solo envío por aprobación.
// Estados: pendiente (la arma la Mac de Tomás con su plan Max, trabajador local) → mercado → plan → escribiendo → a_revisar → aprobada → enviada. Con la respuesta del cliente: con_notas →
// corrigiendo (el bot corrige solo) → a_revisar (Tomi o Faus aprueban de nuevo) → aprobada → enviada. O error.
// Misma base que el kickoff (DATABASE_URL). La tabla la crean las escrituras la primera vez; las lecturas no crean nada.
// Cada consulta con tope de TOPE_CONSULTA_MS: sin conexión, 5xx o timeout → ErrorTransitorio. Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import type { Guion, Hallazgo } from './tipos'
import { contienePalabras, palabrasDe } from './revisar'
import { leerArchivados, excluirArchivados, exigirClienteNoArchivado } from '@/lib/clientes/archivados'
import type { FilaPlan, RevisionGuion } from './generar'

export const baseConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()
export const TOPE_CONSULTA_MS = 10_000
/** Una tanda en un estado de trabajo sin movimiento hace más que esto se considera colgada (una invocación dura ≤ 300 s). */
export const VENCIDO_S = 330

export const ESTADOS_TANDA = ['pendiente', 'mercado', 'plan', 'escribiendo', 'a_revisar', 'aprobada', 'enviada', 'con_notas', 'corrigiendo', 'error', 'cerrada'] as const
export type EstadoTanda = (typeof ESTADOS_TANDA)[number]
/** «cerrada»: la tanda se resolvió fuera del bot (guiones hechos a mano, el cliente ya grabó o lanzó). Es final: no se
 *  revisa, no se publica en el Doc, no toma notas del grupo ni aparece en pendientes. doc.cierre guarda motivo y estado previo. */
export const ESTADOS_TRABAJO: EstadoTanda[] = ['mercado', 'plan', 'escribiendo', 'con_notas', 'corrigiendo']

export interface GuionGuardado {
  guion: Guion
  hallazgos: Hallazgo[]
  revision: RevisionGuion | null
  /** escrito = falta revisarlo · corrigiendo = revisado, falta corregir · listo */
  estado: 'escrito' | 'corrigiendo' | 'listo'
  editado?: { quien: string; cuando: string } | null
  /** «✓ Verificado» de una persona (27/10): se pierde si alguien lo edita o si el bot lo corrige con una nota del cliente */
  verificado?: { quien: string; email: string; cuando: string } | null
}
export interface NotaCliente { id: string; texto: string; guion: number | null; cuando: string; origen: 'whatsapp' | 'manual'; aplicada: string | null; guiones?: number[] }
export interface FilaTanda {
  id: number; recording_id: number; tanda: number; id_crm: string | null; cliente: string | null; ciudad: string | null
  estado: EstadoTanda; mercado: string | null; plan: FilaPlan[] | null; guiones: Record<string, GuionGuardado>
  aprobacion: { quien: string; email: string; cuando: string } | null
  doc: { id: string; url: string; tanda?: number | null; publicada?: string; entrega?: { quien: string; email: string; cuando: string }; publicacion?: { estado: string; cuando: string; motivo?: string } } | null; whatsapp: { id: string | null; cuando: string; grupo: string; enviando?: boolean } | null
  notas: NotaCliente[]; aviso_discord: string | null; error: string | null; tokens_in: number; tokens_out: number
  version: string | null; creado: string; actualizado: string
  /** Aviso de lectura del vínculo, no altera el estado de generación. */
  documento_pendiente?: string | null
}

type Sql = NeonQueryFunction<false, false>
let sqlCache: Sql | null = null
const sql = (): Sql => (sqlCache ??= neon(process.env.DATABASE_URL!.trim()))

async function correr<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  if (!baseConfigurada()) throw new Error('falta DATABASE_URL')
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(sql()),
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ErrorTransitorio(`Neon no respondió (${que})`)), TOPE_CONSULTA_MS) }),
    ])
  } catch (e) {
    if (e instanceof ErrorTransitorio) throw e
    const m = (e as Error)?.message ?? String(e)
    if (/fetch failed|ECONN|ETIMEDOUT|5\d\d|terminat/i.test(m)) throw new ErrorTransitorio(`Neon falló (${que})`)
    throw new Error(`Neon (${que}): ${m.replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 200)}`)
  } finally { if (t) clearTimeout(t) }
}
const sinTabla = (e: unknown) => /does not exist/i.test(String((e as Error)?.message))

let tablaLista = false
async function asegurarTabla(q: Sql): Promise<void> {
  if (tablaLista) return
  await q`CREATE TABLE IF NOT EXISTS cj_guiones (
    id bigserial PRIMARY KEY, recording_id bigint NOT NULL, tanda int NOT NULL DEFAULT 1, id_crm text, cliente text, ciudad text,
    estado text NOT NULL, mercado text, plan jsonb, guiones jsonb NOT NULL DEFAULT '{}'::jsonb, aprobacion jsonb, doc jsonb, whatsapp jsonb,
    notas jsonb NOT NULL DEFAULT '[]'::jsonb, aviso_discord text, error text, tokens_in int NOT NULL DEFAULT 0, tokens_out int NOT NULL DEFAULT 0,
    version text, creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now(), UNIQUE (recording_id, tanda))`
  await q`CREATE INDEX IF NOT EXISTS cj_guiones_id_crm ON cj_guiones (upper(id_crm))`
  tablaLista = true
}

const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x ?? ''))
function aFila(f: Record<string, unknown>): FilaTanda {
  return {
    ...(f as unknown as FilaTanda), id: Number(f.id), recording_id: Number(f.recording_id), tanda: Number(f.tanda),
    guiones: (f.guiones as Record<string, GuionGuardado>) ?? {}, notas: (f.notas as NotaCliente[]) ?? [],
    tokens_in: Number(f.tokens_in ?? 0), tokens_out: Number(f.tokens_out ?? 0), creado: iso(f.creado), actualizado: iso(f.actualizado),
  }
}
type Uso = { input_tokens: number; output_tokens: number }
const CERO: Uso = { input_tokens: 0, output_tokens: 0 }
/** `previo` (el `actualizado` que vio la pantalla) tiene que ser una fecha; si no, el cast de Postgres fallaría con un 500. */
export const previoValido = (p: string) => typeof p === 'string' && p.length >= 10 && !Number.isNaN(Date.parse(p))

/** Crea la tanda (o devuelve la que ya hay: el disparo puede llegar dos veces). nueva = la creó este pedido. */
export async function crearTanda(p: { recording_id: number; tanda?: number; id_crm: string | null; cliente: string | null; ciudad: string; version: string; estado?: 'pendiente' | 'mercado' }): Promise<{ fila: FilaTanda; nueva: boolean }> {
  await exigirClienteNoArchivado(p.id_crm)
  const creada = await correr('crear tanda', async q => {
    await asegurarTabla(q)
    const tanda = p.tanda ?? 1
    const ins = await q`INSERT INTO cj_guiones (recording_id, tanda, id_crm, cliente, ciudad, estado, version)
      VALUES (${p.recording_id}, ${tanda}, ${p.id_crm}, ${p.cliente}, ${p.ciudad}, ${p.estado ?? 'mercado'}, ${p.version})
      ON CONFLICT (recording_id, tanda) DO NOTHING RETURNING *`
    if (ins.length) return { fila: aFila(ins[0] as Record<string, unknown>), nueva: true }
    const ya = await q`SELECT * FROM cj_guiones WHERE recording_id = ${p.recording_id} AND tanda = ${tanda}`
    return { fila: aFila(ya[0] as Record<string, unknown>), nueva: false }
  })
  if (!creada.fila.doc?.id && process.env.DATABASE_URL) {
    const { asegurarVinculoTanda } = await import('./vinculo')
    creada.fila = await asegurarVinculoTanda(creada.fila)
  }
  return creada
}

export async function leerTanda(id: number): Promise<FilaTanda | undefined> {
  return correr('leer tanda', async q => {
    try { const f = await q`SELECT * FROM cj_guiones WHERE id = ${id}`; return f.length ? aFila(f[0] as Record<string, unknown>) : undefined } catch (e) { if (sinTabla(e)) return undefined; throw e }
  })
}

export async function tandasDelCliente(idCrm: string): Promise<FilaTanda[]> {
  return correr('tandas del cliente', async q => {
    try { return (await q`SELECT * FROM cj_guiones WHERE upper(id_crm) = ${idCrm.toUpperCase()} ORDER BY creado DESC LIMIT 20`).map(x => aFila(x as Record<string, unknown>)) } catch (e) { if (sinTabla(e)) return []; throw e }
  })
}

/** La última tanda avisada en ese grupo de WhatsApp (respuesta del cliente que trae el webhook de Whapi). */
export async function tandaPorGrupo(grupo: string): Promise<FilaTanda | undefined> {
  return correr('tanda por grupo', async q => {
    try { const f = await q`SELECT * FROM cj_guiones WHERE whatsapp ->> 'grupo' = ${grupo} ORDER BY creado DESC LIMIT 1`; return f.length ? aFila(f[0] as Record<string, unknown>) : undefined } catch (e) { if (sinTabla(e)) return undefined; throw e }
  })
}

/** Guarda el resultado de un paso y pasa de estado SOLO si la tanda sigue en el estado esperado. */
export async function avanzar(id: number, desde: EstadoTanda, hasta: EstadoTanda, datos: { mercado?: string; plan?: FilaPlan[]; uso?: Uso } = {}): Promise<boolean> {
  return correr('avanzar tanda', async q => (await q`UPDATE cj_guiones SET estado = ${hasta}, mercado = COALESCE(${datos.mercado ?? null}, mercado),
      plan = COALESCE(${datos.plan ? JSON.stringify(datos.plan) : null}::jsonb, plan),
      tokens_in = tokens_in + ${datos.uso?.input_tokens ?? 0}, tokens_out = tokens_out + ${datos.uso?.output_tokens ?? 0}, error = NULL, actualizado = now()
    WHERE id = ${id} AND estado = ${desde} RETURNING id`).length > 0)
}

/** Reclama una tanda para retomarla: desde «error» o desde un estado de trabajo sin movimiento hace más de VENCIDO_S. */
export async function reclamar(id: number, hasta: EstadoTanda): Promise<boolean> {
  return correr('reclamar tanda', async q => (await q`UPDATE cj_guiones SET estado = ${hasta}, error = NULL, actualizado = now()
    WHERE id = ${id} AND (estado = 'error' OR (estado = ANY(${ESTADOS_TRABAJO}::text[]) AND actualizado < now() - make_interval(secs => ${VENCIDO_S})))
    RETURNING id`).length > 0)
}

/** Guarda un guion (atómico) solo con la tanda escribiendo y sin pisar uno listo. null = no correspondía (paso duplicado o tardío). */
export async function guardarGuion(id: number, numero: number, g: GuionGuardado, uso: Uso = CERO): Promise<{ listos: number; total: number } | null> {
  return correr('guardar guion', async q => {
    const n = String(numero)
    const r = await q`UPDATE cj_guiones SET guiones = jsonb_set(guiones, ${[n]}::text[], ${JSON.stringify(g)}::jsonb, true),
        tokens_in = tokens_in + ${uso.input_tokens}, tokens_out = tokens_out + ${uso.output_tokens}, actualizado = now()
      WHERE id = ${id} AND estado = 'escribiendo' AND COALESCE(guiones -> ${n} ->> 'estado', '') <> 'listo'
      RETURNING (SELECT count(*) FROM jsonb_each(guiones) e WHERE e.value ->> 'estado' = 'listo') AS listos, jsonb_array_length(COALESCE(plan, '[]'::jsonb)) AS total`
    if (!r.length) return null
    const x = r[0] as Record<string, unknown>
    return { listos: Number(x.listos), total: Number(x.total) }
  })
}

export async function marcarError(id: number, motivo: string): Promise<void> {
  await correr('marcar error', q => q`UPDATE cj_guiones SET estado = 'error', error = ${motivo.slice(0, 500)}, actualizado = now()
    WHERE id = ${id} AND estado = ANY(${ESTADOS_TRABAJO}::text[])`)
}

export async function anotarAviso(id: number, mensaje: string): Promise<void> {
  await correr('anotar aviso', q => q`UPDATE cj_guiones SET aviso_discord = ${mensaje}, actualizado = now() WHERE id = ${id}`)
}

/** Lo que hace una persona en la pantalla. Con condición sobre `actualizado` (no pisar el cambio de otro). */
export async function editarGuion(id: number, numero: number, guion: Guion, quien: string, previo: string): Promise<boolean> {
  if (!previoValido(previo)) return false
  return correr('editar guion', async q => (await q`UPDATE cj_guiones SET guiones = jsonb_set(guiones, ${[String(numero)]}::text[],
        (guiones -> ${String(numero)}) || jsonb_build_object('guion', ${JSON.stringify(guion)}::jsonb, 'editado', jsonb_build_object('quien', ${quien}::text, 'cuando', now()), 'verificado', NULL), false),
      actualizado = now()
    WHERE id = ${id} AND date_trunc('milliseconds', actualizado) = ${previo}::timestamptz AND estado = 'a_revisar' RETURNING id`).length > 0)
}

/** «✓ Verificado» de un guion (o null para sacarlo). Solo con la tanda para revisar y sin pisar el cambio de otro. */
export async function verificarGuion(id: number, numero: number, v: { quien: string; email: string } | null, previo: string): Promise<boolean> {
  if (!previoValido(previo)) return false
  const valor = v ? JSON.stringify({ ...v, cuando: new Date().toISOString() }) : 'null'
  return correr('verificar guion', async q => (await q`UPDATE cj_guiones SET guiones = jsonb_set(guiones, ${[String(numero), 'verificado']}::text[], ${valor}::jsonb, true),
      actualizado = now()
    WHERE id = ${id} AND guiones ? ${String(numero)} AND estado = 'a_revisar' AND date_trunc('milliseconds', actualizado) = ${previo}::timestamptz RETURNING id`).length > 0)
}

/** El check final: UNA persona (Tomi o Faus) y solo con TODOS los guiones verificados (la base lo vuelve a exigir). */
export async function aprobarTanda(id: number, aprobacion: { quien: string; email: string }, previo: string): Promise<boolean> {
  if (!previoValido(previo)) return false
  return correr('aprobar tanda', async q => (await q`UPDATE cj_guiones SET estado = 'aprobada', aprobacion = ${JSON.stringify({ ...aprobacion, cuando: new Date().toISOString() })}::jsonb, actualizado = now()
    WHERE id = ${id} AND estado = 'a_revisar' AND date_trunc('milliseconds', actualizado) = ${previo}::timestamptz
      AND guiones <> '{}'::jsonb AND NOT EXISTS (SELECT 1 FROM jsonb_each(guiones) e WHERE jsonb_typeof(e.value -> 'verificado') IS DISTINCT FROM 'object')
    RETURNING id`).length > 0)
}

export async function anotarDoc(id: number, doc: NonNullable<FilaTanda['doc']>): Promise<void> {
  await correr('anotar doc', q => q`UPDATE cj_guiones SET doc = ${JSON.stringify(doc)}::jsonb, actualizado = now() WHERE id = ${id}`)
}

/** Reserva el envío del WhatsApp de ESTA aprobación (dos pedidos a la vez: sale uno solo). */
export async function reservarWhatsApp(id: number): Promise<boolean> {
  return correr('reservar whatsapp', async q => (await q`UPDATE cj_guiones SET whatsapp = '{"enviando": true}'::jsonb, actualizado = now()
    WHERE id = ${id} AND estado = 'aprobada' AND (whatsapp IS NULL OR (whatsapp ->> 'enviando' = 'true' AND actualizado < now() - make_interval(secs => ${VENCIDO_S}))) RETURNING id`).length > 0)
}

/** Resultado del WhatsApp: con id → «enviada» (si seguía aprobada); sin enviar → se libera la reserva. */
export async function anotarWhatsApp(id: number, w: { id: string | null; grupo: string } | null): Promise<void> {
  if (w) await correr('anotar whatsapp', q => q`UPDATE cj_guiones SET whatsapp = ${JSON.stringify({ ...w, cuando: new Date().toISOString() })}::jsonb,
      estado = CASE WHEN estado = 'aprobada' THEN 'enviada' ELSE estado END, actualizado = now() WHERE id = ${id}`)
  else await correr('liberar whatsapp', q => q`UPDATE cj_guiones SET whatsapp = NULL WHERE id = ${id} AND whatsapp ->> 'enviando' = 'true'`)
}

/** La respuesta del cliente: nota sin aplicar; la tanda (si ya se le mandó o estaba para revisar) pasa a con_notas.
 *  Devuelve si quedó en con_notas (entonces hay que disparar la corrección automática). */
export async function agregarNota(id: number, nota: Pick<NotaCliente, 'texto' | 'guion' | 'cuando' | 'origen'>): Promise<boolean> {
  const n: NotaCliente = { ...nota, id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, aplicada: null }
  return correr('agregar nota', async q => {
    const r = await q`UPDATE cj_guiones SET notas = notas || ${JSON.stringify([n])}::jsonb,
        estado = CASE WHEN estado IN ('enviada', 'aprobada', 'a_revisar') THEN 'con_notas' ELSE estado END, actualizado = now()
      WHERE id = ${id} RETURNING estado`
    return r.length > 0 && (r[0] as Record<string, unknown>).estado === 'con_notas'
  })
}

/** Corrección automática con las notas: guarda los guiones corregidos (SOLO esos pierden el «✓ Verificado»), marca las notas
 *  aplicadas (y a qué guiones) y vuelve a revisión (verificar los corregidos y un check final de Tomi o Faus). Se borran aprobación y WhatsApp de la vuelta anterior; el Doc se reusa. */
export async function aplicarCorrecciones(id: number, guiones: Record<string, Guion>, notas: { id: string; guiones: number[] }[], uso: Uso): Promise<boolean> {
  return correr('aplicar correcciones', async q => {
    const f = (await q`SELECT guiones FROM cj_guiones WHERE id = ${id} AND estado = 'corrigiendo'`)[0] as Record<string, unknown> | undefined
    if (!f) return false
    const actuales = { ...(f.guiones as Record<string, GuionGuardado>) }
    for (const [n, guion] of Object.entries(guiones)) if (actuales[n]) actuales[n] = { ...actuales[n], guion, estado: 'listo', editado: null, verificado: null }
    const mapa = JSON.stringify(Object.fromEntries(notas.map(x => [x.id, x.guiones])))
    const r = await q`UPDATE cj_guiones SET guiones = ${JSON.stringify(actuales)}::jsonb,
        notas = (SELECT COALESCE(jsonb_agg(CASE WHEN ${mapa}::jsonb ? (n ->> 'id')
          THEN n || jsonb_build_object('aplicada', now(), 'guiones', ${mapa}::jsonb -> (n ->> 'id')) ELSE n END), '[]'::jsonb) FROM jsonb_array_elements(notas) n),
        estado = 'a_revisar', aprobacion = NULL, whatsapp = NULL, tokens_in = tokens_in + ${uso.input_tokens}, tokens_out = tokens_out + ${uso.output_tokens}, actualizado = now()
      WHERE id = ${id} AND estado = 'corrigiendo' RETURNING id`
    return r.length > 0
  })
}

export async function marcarEstado(id: number, desde: EstadoTanda[], hasta: EstadoTanda): Promise<boolean> {
  return correr('marcar estado', async q => (await q`UPDATE cj_guiones SET estado = ${hasta}, actualizado = now() WHERE id = ${id} AND estado = ANY(${desde}::text[]) RETURNING id`).length > 0)
}

/** Para el trabajador local: tandas pendientes, con notas sin aplicar o colgadas en un estado de trabajo (más viejas que
 *  VENCIDO_S sin moverse). Las más viejas primero. */
export async function tandasParaLocal(): Promise<FilaTanda[]> {
  const archivados = await leerArchivados()
  const filas = await correr('tandas para local', async q => {
    try {
      return (await q`SELECT * FROM cj_guiones WHERE estado IN ('pendiente', 'con_notas')
          OR (estado IN ('mercado', 'plan', 'escribiendo', 'corrigiendo') AND actualizado < now() - make_interval(secs => ${VENCIDO_S}))
        ORDER BY actualizado ASC LIMIT 100`).map(x => aFila(x as Record<string, unknown>))
    } catch (e) { if (sinTabla(e)) return []; throw e }
  })
  return excluirArchivados(filas.filter(f => !!f.id_crm), archivados, f => f.id_crm).slice(0, 5)
}

/** Toca `actualizado` (el trabajador local avisa que la sigue: así no la toma como colgada otro). */
export async function tocar(id: number): Promise<void> {
  await correr('tocar tanda', q => q`UPDATE cj_guiones SET actualizado = now() WHERE id = ${id}`)
}


/** La última tanda YA APROBADA (aprobada, enviada o con notas) del cliente cuyo nombre trae TODAS las palabras de `nombre` (el que va
 *  después de «Contenido - » en el grupo). Sirve cuando el aviso al cliente lo mandó una persona (WhatsApp del bot apagado) y
 *  la tanda no tiene grupo guardado. Una tanda que todavía no se aprobó (a_revisar) no cuenta: lo que el cliente escriba en
 *  su grupo antes de recibirla no es una corrección. null si no hay una sola clara. */
export async function tandaPorCliente(nombre: string): Promise<FilaTanda | undefined> {
  if (!palabrasDe(nombre).size) return undefined
  return correr('tanda por cliente', async q => {
    try {
      const filas = (await q`SELECT * FROM cj_guiones WHERE estado IN ('aprobada', 'enviada', 'con_notas', 'corrigiendo') ORDER BY creado DESC LIMIT 200`).map(x => aFila(x as Record<string, unknown>))
      const de = filas.filter(f => f.cliente && contienePalabras(f.cliente, nombre))
      const clientes = new Set(de.map(f => f.id_crm ?? f.cliente))
      return clientes.size === 1 ? de[0] : undefined
    } catch (e) { if (sinTabla(e)) return undefined; throw e }
  })
}

/** Reserva la escritura del Doc para esta aprobación. Las reservas dudosas esperan más que el máximo de Apps Script. */
export async function reservarPublicacion(id: number): Promise<boolean> {
  return correr('reservar publicación', async q => (await q`UPDATE cj_guiones SET doc = COALESCE(doc, '{}'::jsonb) || jsonb_build_object('publicacion', jsonb_build_object('estado', 'trabajando', 'cuando', now())), actualizado = now()
    WHERE id = ${id} AND estado = 'aprobada' AND (doc->'publicacion' IS NULL OR doc->'publicacion'->>'estado' = 'error' OR actualizado < now() - interval '7 minutes') RETURNING id`).length === 1)
}
export async function errorPublicacion(id: number, motivo: string, dudoso = false): Promise<void> {
  await correr('anotar publicación', q => q`UPDATE cj_guiones SET doc = COALESCE(doc, '{}'::jsonb) || ${JSON.stringify({ publicacion: { estado: dudoso ? 'dudoso' : 'error', cuando: new Date().toISOString(), motivo: motivo.slice(0, 200) } })}::jsonb, actualizado = now() WHERE id = ${id} AND estado = 'aprobada'`)
}
export async function pendientesEntrega(): Promise<FilaTanda[]> {
  const archivados = await leerArchivados()
  const filas = await correr('cola de entrega', async q => { try { return (await q`SELECT * FROM cj_guiones WHERE estado = 'aprobada' AND doc->>'id' IS NOT NULL AND doc->'publicacion' IS NULL AND doc->>'publicada' = aprobacion->>'cuando' ORDER BY actualizado ASC LIMIT 100`).map(x => aFila(x as Record<string, unknown>)) } catch (e) { if (sinTabla(e)) return []; throw e } })
  return excluirArchivados(filas.filter(f => !!f.id_crm), archivados, f => f.id_crm)
}
export async function marcarEntregaManual(id: number, quien: { email: string; nombre: string }, previo: string): Promise<boolean> {
  if (!previoValido(previo)) return false
  return correr('entrega manual', async q => (await q`UPDATE cj_guiones SET estado = 'enviada', doc = doc || ${JSON.stringify({ entrega: { quien: quien.nombre, email: quien.email, cuando: new Date().toISOString() } })}::jsonb, actualizado = now()
    WHERE id = ${id} AND estado = 'aprobada' AND doc->>'id' IS NOT NULL AND doc->'publicacion' IS NULL AND doc->>'publicada' = aprobacion->>'cuando' AND date_trunc('milliseconds', actualizado) = ${previo}::timestamptz RETURNING id`).length === 1)
}

/** Vínculo temprano: no pisa una publicación, una entrega ni un vínculo que apareció mientras se buscaba en Drive. */
export async function anotarVinculoInicial(id: number, doc: { id: string; url: string }): Promise<boolean> {
  return correr('vincular doc inicial', async q => (await q`UPDATE cj_guiones SET doc = ${JSON.stringify(doc)}::jsonb, actualizado = now()
    WHERE id = ${id} AND doc->>'id' IS NULL AND doc->'publicacion' IS NULL AND estado <> ALL(${['aprobada', 'enviada']}) RETURNING id`).length === 1)
}
