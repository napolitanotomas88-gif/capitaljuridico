// ── Bot "Capital Jurídico": almacén de las altas en Neon (cj_altas, cj_altas_pasos, cj_altas_mensajes, cj_altas_recursos) ─
// Diseño del motor, sección 8, con los cambios de la revisión (varias esperas por alta, hay_pendientes, medios solo por
// suma atómica, entorno, autor por teléfono o lid). Patrón COPIADO (no importado) de lib/bot/kickoff/registro.ts:
//   · consulta(): tope de 10 s por consulta; sin conexión, 5xx o corte → ErrorTransitorio, con la URL tapada;
//   · sqlParaPruebas(): los tests reemplazan el cliente de Neon por uno falso;
//   · asegurarTablas(): una vez por proceso (se reinicia si falla), SOLO la llaman las escrituras. CREATE TABLE/INDEX IF NOT
//     EXISTS y, mirando antes information_schema, ADD COLUMN IF NOT EXISTS de lo que falte. Nunca DROP ni cambios de tipo;
//   · las lecturas no crean nada: una tabla que no existe (42P01) cuenta como vacía.
// En esta tarea NO se ejecuta contra ninguna base (lo prueban los tests con un cliente falso). Misma base que el kickoff y
// Cuotas: DATABASE_URL. Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { ErrorTransitorio } from '../../../fathomAnuncios/errores'
import type { AutorWhapi, EventoBot, PasoId, RefMedio } from './tipos'
import { PASOS } from './tipos'
import {
  ESTADOS_FINALES, MARGEN_LEASE_MS, esFinal, pasoVacio, type AlmacenAltas, type CambiosAlta, type CambiosPaso, type EstadoSaliente, type FilaAlta, type FilaPaso, type MensajeBot,
} from './almacen'

export const TOPE_CONSULTA_MS = 10_000
export const baseConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()

type Sql = NeonQueryFunction<false, false>
const sqlReal = (url: string): Sql => neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
let crearSql: (url: string) => Sql = sqlReal

/** Solo para los tests: reemplaza el cliente de Neon por uno falso (null vuelve al real) y olvida las tablas creadas. */
export function sqlParaPruebas(f: ((url: string) => Sql) | null): void {
  crearSql = f ?? sqlReal
  tablasListas = null
}

const faltaTabla = (e: unknown): boolean => (e as { code?: string })?.code === '42P01' || /relation "cj_altas\w*" does not exist/i.test((e as Error)?.message ?? '')

async function consulta<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = crearSql(url)
  let t: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, rechazar) => {
    t = setTimeout(() => rechazar(new ErrorTransitorio(`la base no respondió en ${TOPE_CONSULTA_MS / 1000} s (${que})`)), TOPE_CONSULTA_MS)
  })
  try {
    return await Promise.race([fn(q), tope])
  } catch (e) {
    if (e instanceof ErrorTransitorio) throw e
    const m = (e as Error)?.message ?? ''
    if (/^Error connecting to database|^Server error \(HTTP status 5\d\d|TimeoutError|AbortError|aborted|fetch failed/i.test(m)) {
      throw new ErrorTransitorio(`la base no respondió (${que}): ${m.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 120)}`)
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

/** Lectura: si la tabla no existe todavía, `vacio`. */
async function leer<T>(que: string, vacio: T, fn: (q: Sql) => Promise<T>): Promise<T> {
  try { return await consulta(que, fn) } catch (e) { if (faltaTabla(e)) return vacio; throw e }
}

// Columnas que se pueden sumar a una tabla vieja (solo aditivas). Las que van en el CREATE están todas acá.
export const COLUMNAS_AGREGABLES: Record<string, [string, string][]> = {
  cj_altas: [
    ['capacidades', "jsonb NOT NULL DEFAULT '[]'::jsonb"], ['entorno', "text NOT NULL DEFAULT 'local'"], ['mensajes_alta', "jsonb NOT NULL DEFAULT '[]'::jsonb"],
    ['medios_actualizado', 'timestamptz'], ['esperas', "jsonb NOT NULL DEFAULT '[]'::jsonb"], ['hay_pendientes', 'boolean NOT NULL DEFAULT false'],
    ['cadena', 'jsonb'], ['notas', "jsonb NOT NULL DEFAULT '[]'::jsonb"],
  ],
  cj_altas_pasos: [['dudoso', 'boolean NOT NULL DEFAULT false']],
  cj_altas_mensajes: [['autor_telefono', 'text'], ['autor_lid', 'text'], ['proposito', 'text'], ['huella', 'text']],
}

let tablasListas: Promise<void> | null = null
export function asegurarTablas(): Promise<void> {
  tablasListas ??= consulta('crear tablas', async (q) => {
    await q`CREATE TABLE IF NOT EXISTS cj_altas (
      id text PRIMARY KEY, estado text NOT NULL, modo text NOT NULL, capacidades jsonb NOT NULL DEFAULT '[]'::jsonb,
      entorno text NOT NULL DEFAULT 'local', chat_id text NOT NULL, autor_telefono text, autor_lid text, autor_nombre text,
      mensaje_alta_id text NOT NULL UNIQUE, mensajes_alta jsonb NOT NULL DEFAULT '[]'::jsonb,
      texto_original text, texto_vigente text, huella text NOT NULL, telefono_cliente text, nombre_cliente text,
      medios jsonb NOT NULL DEFAULT '[]'::jsonb, medios_actualizado timestamptz, fecha_pago date, validacion jsonb,
      esperas jsonb NOT NULL DEFAULT '[]'::jsonb, proximo_intento timestamptz, candado_dueno text, candado_hasta timestamptz,
      hay_pendientes boolean NOT NULL DEFAULT false, alta_anterior text, reemplazada_por text, intentos int NOT NULL DEFAULT 0,
      error text, cadena jsonb, notas jsonb NOT NULL DEFAULT '[]'::jsonb,
      creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE INDEX IF NOT EXISTS cj_altas_telefono ON cj_altas (telefono_cliente)`
    await q`CREATE INDEX IF NOT EXISTS cj_altas_huella ON cj_altas (huella)`
    await q`CREATE INDEX IF NOT EXISTS cj_altas_vencidas ON cj_altas (proximo_intento) WHERE estado NOT IN ('lista','rechazada','reemplazada','duplicada','simulada','vencida')`
    await q`CREATE INDEX IF NOT EXISTS cj_altas_sha ON cj_altas ((validacion->>'sha256'))`
    await q`CREATE TABLE IF NOT EXISTS cj_altas_pasos (
      alta_id text NOT NULL REFERENCES cj_altas(id), paso text NOT NULL, estado text NOT NULL, resultado jsonb, parcial jsonb,
      no_antes_de timestamptz, iniciado timestamptz, terminado timestamptz, intentos int NOT NULL DEFAULT 0, error text,
      dudoso boolean NOT NULL DEFAULT false, actualizado timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (alta_id, paso)
    )`
    await q`CREATE TABLE IF NOT EXISTS cj_altas_mensajes (
      clave text PRIMARY KEY, direccion text NOT NULL, whapi_id text, alta_id text, chat_id text NOT NULL,
      autor_telefono text, autor_lid text, tipo text, espera text, proposito text, huella text, evento jsonb,
      estado text NOT NULL, creado timestamptz NOT NULL DEFAULT now(), procesado timestamptz
    )`
    await q`CREATE UNIQUE INDEX IF NOT EXISTS cj_altas_mensajes_saliente ON cj_altas_mensajes (whapi_id) WHERE direccion = 'saliente' AND whapi_id IS NOT NULL`
    await q`CREATE INDEX IF NOT EXISTS cj_altas_mensajes_sueltos ON cj_altas_mensajes (chat_id, creado) WHERE alta_id IS NULL`
    await q`CREATE INDEX IF NOT EXISTS cj_altas_mensajes_nuevos ON cj_altas_mensajes (alta_id) WHERE estado = 'nuevo'`
    await q`CREATE TABLE IF NOT EXISTS cj_altas_recursos (nombre text PRIMARY KEY, dueno text, hasta timestamptz, datos jsonb)`
    // Tablas creadas antes de una columna nueva: solo ADD COLUMN IF NOT EXISTS de lo que falta (se mira antes, para no pedir
    // el lock del ALTER en cada arranque en frío)
    const hay = new Set((await q`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('cj_altas', 'cj_altas_pasos', 'cj_altas_mensajes')`)
      .map((c) => `${String(c.table_name)}.${String(c.column_name)}`))
    for (const [tabla, columnas] of Object.entries(COLUMNAS_AGREGABLES)) {
      for (const [col, tipo] of columnas) {
        if (!hay.has(`${tabla}.${col}`)) await q`ALTER TABLE ${q.unsafe(tabla)} ADD COLUMN IF NOT EXISTS ${q.unsafe(col)} ${q.unsafe(tipo)}`
      }
    }
  }).catch((e) => { tablasListas = null; throw e })
  return tablasListas
}

async function escribir<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  await asegurarTablas()
  return consulta(que, fn)
}

// ── Filas ↔ objetos ──
type Row = Record<string, unknown>
const txt = (x: unknown): string | null => (typeof x === 'string' ? x : null)
const fecha = (x: unknown): string | null => (x instanceof Date ? x.toISOString() : typeof x === 'string' ? new Date(x).toISOString() : null)
const ymd = (x: unknown): string | null => (x instanceof Date ? x.toISOString().slice(0, 10) : typeof x === 'string' ? x.slice(0, 10) : null)
const json = <T>(x: unknown, def: T): T => (x === null || x === undefined ? def : (typeof x === 'string' ? JSON.parse(x) : x) as T)

export function filaAlta(r: Row): FilaAlta {
  return {
    id: String(r.id), estado: String(r.estado) as FilaAlta['estado'], modo: String(r.modo) as FilaAlta['modo'], capacidades: json(r.capacidades, []),
    entorno: txt(r.entorno) ?? 'local', chatId: String(r.chat_id),
    autor: { telefono: txt(r.autor_telefono), lid: txt(r.autor_lid), nombre: txt(r.autor_nombre) },
    mensajeAltaId: String(r.mensaje_alta_id), mensajesAlta: json(r.mensajes_alta, [String(r.mensaje_alta_id)]),
    textoOriginal: txt(r.texto_original) ?? '', textoVigente: txt(r.texto_vigente) ?? '', huella: String(r.huella),
    telefonoCliente: txt(r.telefono_cliente), nombreCliente: txt(r.nombre_cliente), medios: json<RefMedio[]>(r.medios, []),
    fechaPago: ymd(r.fecha_pago), validacion: json(r.validacion, null), esperas: json(r.esperas, []), proximoIntento: fecha(r.proximo_intento),
    altaAnterior: txt(r.alta_anterior), reemplazadaPor: txt(r.reemplazada_por), intentos: Number(r.intentos ?? 0), error: txt(r.error),
    cadena: json(r.cadena, null), notas: json(r.notas, []), creado: fecha(r.creado) ?? new Date(0).toISOString(), actualizado: fecha(r.actualizado) ?? new Date(0).toISOString(),
  }
}

function filaPaso(r: Row): FilaPaso {
  return {
    paso: String(r.paso) as PasoId, estado: String(r.estado) as FilaPaso['estado'], resultado: json(r.resultado, null), parcial: json(r.parcial, null),
    noAntesDe: fecha(r.no_antes_de), iniciado: txt(r.iniciado_txt) ?? fecha(r.iniciado), intentos: Number(r.intentos ?? 0), error: txt(r.error), dudoso: r.dudoso === true,
  }
}

const FINALES = [...ESTADOS_FINALES]
const ISO_US = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

/** Un texto con un surrogate suelto (un emoji partido por un recorte) como U+FFFD: Postgres rechaza ese jsonb ("Unicode low
 *  surrogate must follow a high surrogate", 22P02) y el error es permanente (revisión del 24/10, ronda 2). */
export const bienFormado = (t: string) => t.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
/** JSON para una columna jsonb, con todos los textos bien formados. */
export const jsonSeguro = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'string' ? bienFormado(v) : v))

/** Patch de un alta como jsonb (cada clave presente se escribe; las ausentes quedan como estaban). */
const patchAlta = (c: CambiosAlta) => jsonSeguro(c)
const patchPaso = (c: CambiosPaso) => jsonSeguro(c)

export function almacenNeon(): AlmacenAltas {
  return {
    async registrarEntrantes(evs) {
      const nuevos: EventoBot[] = [], repetidos: string[] = []
      if (!evs.length) return { nuevos, repetidos }
      await escribir('registrar eventos', async (q) => {
        for (const e of evs) {
          const r = await q`INSERT INTO cj_altas_mensajes (clave, direccion, whapi_id, chat_id, autor_telefono, autor_lid, tipo, evento, estado)
            VALUES (${e.clave}, 'entrante', ${e.mensajeId}, ${e.chatId}, ${e.autor.telefono}, ${e.autor.lid}, ${e.tipo}, ${jsonSeguro(e)}::jsonb, 'nuevo')
            ON CONFLICT (clave) DO NOTHING RETURNING clave`
          if (r.length) nuevos.push(e)
          else repetidos.push(e.clave)
        }
        if (repetidos.length) {
          // Un envío anterior a medias: los que siguen 'nuevo' se procesan de nuevo (revisión, punto 13)
          const sigue = await q`SELECT evento FROM cj_altas_mensajes WHERE clave = ANY(${repetidos}) AND estado = 'nuevo'`
          for (const s of sigue) nuevos.push(json<EventoBot>(s.evento, null as never))
        }
      })
      return { nuevos, repetidos }
    },
    async crearAlta(a) {
      return escribir('crear alta', async (q) => {
        // medios_actualizado se llena si el alta nace con medios (el #ALTA como pie de la imagen): sin eso quedaba NULL y la
        // ventana del álbum de adjuntarMedio no se comportaba como la del almacén en memoria (revisión del 24/10)
        // Nace con proximo_intento = now() (revisión del 24/10, ronda 2): si ninguna invocación llega a avanzarla (sin tiempo,
        // Vercel la corta, Neon se cae a la mitad), el barrido la ve. Antes quedaba NULL y nadie la volvía a tocar.
        const r = await q`INSERT INTO cj_altas (id, estado, modo, capacidades, entorno, chat_id, autor_telefono, autor_lid, autor_nombre, mensaje_alta_id,
            mensajes_alta, texto_original, texto_vigente, huella, telefono_cliente, nombre_cliente, medios, medios_actualizado, alta_anterior, reemplazada_por,
            proximo_intento)
          VALUES (${a.id}, ${a.estado ?? 'recibida'}, ${a.modo}, ${JSON.stringify(a.capacidades)}::jsonb, ${a.entorno}, ${a.chatId}, ${a.autor.telefono}, ${a.autor.lid},
            ${a.autor.nombre}, ${a.mensajeAltaId}, ${JSON.stringify([a.mensajeAltaId])}::jsonb, ${a.textoOriginal}, ${a.textoOriginal}, ${a.huella},
            ${a.telefonoCliente}, ${a.nombreCliente}, ${jsonSeguro(a.medios)}::jsonb, CASE WHEN ${a.medios.length > 0}::boolean THEN now() ELSE NULL END,
            ${a.altaAnterior}, ${a.reemplazadaPor ?? null}, CASE WHEN ${esFinal(a.estado ?? 'recibida')}::boolean THEN NULL ELSE now() END)
          ON CONFLICT (id) DO NOTHING RETURNING *`
        if (r.length) return { alta: filaAlta(r[0]), creada: true }
        const ya = await q`SELECT * FROM cj_altas WHERE id = ${a.id}`
        return { alta: filaAlta(ya[0]), creada: false }
      })
    },
    async leerAlta(id) {
      return leer('leer alta', null, async (q) => { const r = await q`SELECT * FROM cj_altas WHERE id = ${id}`; return r.length ? filaAlta(r[0]) : null })
    },
    async buscarAltas(f) {
      const tel = f.telefonoCliente ?? null, huella = f.huella ?? null, sha = f.sha256 ?? null, op = f.numeroOperacion ?? null
      const at = f.autor?.telefono ?? null, al = f.autor?.lid ?? null, conAutor = !!f.autor, desde = f.desde ?? null, abiertas = !!f.abiertas, ent = f.entorno ?? null
      return leer('buscar altas', [], async (q) => (await q`SELECT * FROM cj_altas WHERE
          (${tel}::text IS NULL OR telefono_cliente = ${tel}) AND (${huella}::text IS NULL OR huella = ${huella})
          AND (${sha}::text IS NULL OR validacion->>'sha256' = ${sha}) AND (${op}::text IS NULL OR validacion->>'numeroOperacion' = ${op})
          AND (NOT ${conAutor} OR (${at}::text IS NOT NULL AND autor_telefono = ${at}) OR (${al}::text IS NOT NULL AND autor_lid = ${al}))
          AND (${desde}::timestamptz IS NULL OR creado >= ${desde}::timestamptz) AND (NOT ${abiertas} OR estado <> ALL(${FINALES}))
          AND (${ent}::text IS NULL OR entorno = ${ent})
          ORDER BY creado DESC LIMIT 50`).map(filaAlta))
    },
    async ultimas(n) {
      return leer('últimas altas', [], async (q) => (await q`SELECT * FROM cj_altas ORDER BY creado DESC LIMIT ${n}`).map(filaAlta))
    },
    async altaDeMensaje(whapiId) {
      return leer<MensajeBot | null>('alta de un mensaje', null, async (q) => {
        const s = await q`SELECT alta_id, espera, proposito FROM cj_altas_mensajes WHERE direccion = 'saliente' AND whapi_id = ${whapiId} AND alta_id IS NOT NULL LIMIT 1`
        if (s.length) return { altaId: String(s[0].alta_id), esperaId: txt(s[0].espera), proposito: txt(s[0].proposito), entrante: false }
        const a = await q`SELECT id FROM cj_altas WHERE mensajes_alta ? ${whapiId} LIMIT 1`
        return a.length ? { altaId: String(a[0].id), esperaId: null, proposito: null, entrante: true } : null
      })
    },
    async asignarEvento(clave, altaId) {
      await escribir('asignar evento', (q) => q`UPDATE cj_altas_mensajes SET alta_id = ${altaId} WHERE clave = ${clave} AND direccion = 'entrante'`)
    },
    async eventosDeAlta(altaId) {
      return leer('eventos del alta', [], async (q) => (await q`SELECT evento FROM cj_altas_mensajes WHERE alta_id = ${altaId} AND direccion = 'entrante' AND estado = 'nuevo'
        ORDER BY evento->>'enviadoEn', creado`).map((r) => json<EventoBot>(r.evento, null as never)).filter(Boolean))
    },
    async eventosSinProcesar(antesDe, limite) {
      return leer('eventos sin procesar', [], async (q) => (await q`SELECT evento, alta_id FROM cj_altas_mensajes WHERE direccion = 'entrante' AND estado = 'nuevo'
        AND creado < ${antesDe}::timestamptz ORDER BY creado LIMIT ${limite}`).map((r) => ({ evento: json<EventoBot>(r.evento, null as never), altaId: txt(r.alta_id) })).filter((x) => x.evento))
    },
    async marcarProcesado(claves, estado = 'procesado') {
      if (!claves.length) return
      await escribir('marcar procesado', (q) => q`UPDATE cj_altas_mensajes SET estado = ${estado}, procesado = now() WHERE clave = ANY(${claves}) AND direccion = 'entrante'`)
    },
    async reclamarAdjuntos({ altaId, chatId, autor, desde }) {
      return escribir('reclamar adjuntos', async (q) => (await q`UPDATE cj_altas_mensajes SET alta_id = ${altaId}
        WHERE direccion = 'entrante' AND alta_id IS NULL AND estado = 'nuevo' AND tipo = 'adjunto' AND chat_id = ${chatId} AND creado >= ${desde}::timestamptz
          AND ((${autor.telefono}::text IS NOT NULL AND autor_telefono = ${autor.telefono}) OR (${autor.lid}::text IS NOT NULL AND autor_lid = ${autor.lid}))
        RETURNING clave`).map((r) => String(r.clave)))
    },
    async reclamarEdiciones({ altaId, mensajeId }) {
      return escribir('reclamar ediciones', async (q) => (await q`UPDATE cj_altas_mensajes SET alta_id = ${altaId}
        WHERE direccion = 'entrante' AND alta_id IS NULL AND estado = 'nuevo' AND tipo = 'edicion' AND whapi_id = ${mensajeId}
        RETURNING clave`).map((r) => String(r.clave)))
    },
    async adjuntarMedio({ chatId, autor, desde, medios, ahora }) {
      return escribir('adjuntar medio', async (q) => {
        const r = await q`UPDATE cj_altas a SET medios = a.medios || (SELECT COALESCE(jsonb_agg(m), '[]'::jsonb) FROM jsonb_array_elements(${jsonSeguro(medios)}::jsonb) m
            WHERE NOT a.medios @> jsonb_build_array(jsonb_build_object('id', m->>'id'))),
            medios_actualizado = ${ahora}::timestamptz, actualizado = now()
          WHERE a.id = (SELECT id FROM cj_altas WHERE chat_id = ${chatId}
              AND ((${autor.telefono}::text IS NOT NULL AND autor_telefono = ${autor.telefono}) OR (${autor.lid}::text IS NOT NULL AND autor_lid = ${autor.lid}))
              AND estado IN ('recibida', 'esperando_comprobante', 'esperando_humano', 'en_curso') AND creado > ${desde}::timestamptz
              AND (medios = '[]'::jsonb OR (validacion IS NULL AND medios_actualizado > ${ahora}::timestamptz - interval '60 seconds'))
            ORDER BY creado DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING a.id`
        return r.length ? String(r[0].id) : null
      })
    },
    async sumarMedios(altaId, medios, ahora) {
      await escribir('sumar medios', (q) => q`UPDATE cj_altas a SET medios = a.medios || (SELECT COALESCE(jsonb_agg(m), '[]'::jsonb) FROM jsonb_array_elements(${jsonSeguro(medios)}::jsonb) m
          WHERE NOT a.medios @> jsonb_build_array(jsonb_build_object('id', m->>'id'))), medios_actualizado = ${ahora}::timestamptz, actualizado = now()
        WHERE a.id = ${altaId}`)
    },
    async reclamar(id, dueno, hastaMs) {
      const hasta = new Date(hastaMs).toISOString()
      const lease = new Date(hastaMs + MARGEN_LEASE_MS).toISOString()
      return escribir('reclamar alta', async (q) => {
        // Lease: proximo_intento queda como mucho en hasta + margen (las finales no lo necesitan: vencidas() no las toma)
        const r = await q`UPDATE cj_altas SET candado_dueno = ${dueno}, candado_hasta = ${hasta}::timestamptz, actualizado = now(),
            proximo_intento = CASE WHEN estado = ANY(${FINALES}) THEN proximo_intento ELSE LEAST(COALESCE(proximo_intento, ${lease}::timestamptz), ${lease}::timestamptz) END
          WHERE id = ${id} AND (candado_hasta IS NULL OR candado_hasta < now() OR candado_dueno = ${dueno}) RETURNING *`
        return r.length ? filaAlta(r[0]) : null
      })
    },
    async soltar(id, dueno) {
      return escribir('soltar alta', async (q) => {
        const r = await q`UPDATE cj_altas SET candado_dueno = NULL, candado_hasta = NULL WHERE id = ${id} AND candado_dueno = ${dueno} AND NOT hay_pendientes RETURNING id`
        if (r.length) return true
        const s = await q`SELECT candado_dueno, hay_pendientes FROM cj_altas WHERE id = ${id}`
        return !(s.length && s[0].candado_dueno === dueno && s[0].hay_pendientes === true)
      })
    },
    async marcarPendientes(id) {
      await escribir('marcar pendientes', (q) => q`UPDATE cj_altas SET hay_pendientes = true WHERE id = ${id}`)
    },
    async limpiarPendientes(id, dueno) {
      await escribir('limpiar pendientes', (q) => q`UPDATE cj_altas SET hay_pendientes = false WHERE id = ${id} AND candado_dueno = ${dueno}`)
    },
    async actualizarAlta(id, dueno, cambios) {
      const p = patchAlta(cambios)
      return escribir('actualizar alta', async (q) => (await q`UPDATE cj_altas a SET
          estado = CASE WHEN p.j ? 'estado' THEN p.j->>'estado' ELSE a.estado END,
          modo = CASE WHEN p.j ? 'modo' THEN p.j->>'modo' ELSE a.modo END,
          capacidades = CASE WHEN p.j ? 'capacidades' THEN p.j->'capacidades' ELSE a.capacidades END,
          texto_vigente = CASE WHEN p.j ? 'textoVigente' THEN p.j->>'textoVigente' ELSE a.texto_vigente END,
          telefono_cliente = CASE WHEN p.j ? 'telefonoCliente' THEN p.j->>'telefonoCliente' ELSE a.telefono_cliente END,
          nombre_cliente = CASE WHEN p.j ? 'nombreCliente' THEN p.j->>'nombreCliente' ELSE a.nombre_cliente END,
          fecha_pago = CASE WHEN p.j ? 'fechaPago' THEN (p.j->>'fechaPago')::date ELSE a.fecha_pago END,
          validacion = CASE WHEN p.j ? 'validacion' THEN NULLIF(p.j->'validacion', 'null'::jsonb) ELSE a.validacion END,
          esperas = CASE WHEN p.j ? 'esperas' THEN p.j->'esperas' ELSE a.esperas END,
          proximo_intento = CASE WHEN p.j ? 'proximoIntento' THEN (p.j->>'proximoIntento')::timestamptz ELSE a.proximo_intento END,
          reemplazada_por = CASE WHEN p.j ? 'reemplazadaPor' THEN p.j->>'reemplazadaPor' ELSE a.reemplazada_por END,
          intentos = CASE WHEN p.j ? 'intentos' THEN (p.j->>'intentos')::int ELSE a.intentos END,
          error = CASE WHEN p.j ? 'error' THEN p.j->>'error' ELSE a.error END,
          cadena = CASE WHEN p.j ? 'cadena' THEN NULLIF(p.j->'cadena', 'null'::jsonb) ELSE a.cadena END,
          notas = CASE WHEN p.j ? 'notas' THEN p.j->'notas' ELSE a.notas END,
          mensajes_alta = CASE WHEN p.j ? 'mensajesAlta' THEN p.j->'mensajesAlta' ELSE a.mensajes_alta END,
          actualizado = now()
        FROM (SELECT ${p}::jsonb AS j) p
        WHERE a.id = ${id} AND a.candado_dueno = ${dueno} AND a.candado_hasta > now() RETURNING a.id`).length > 0)
    },
    async actualizarSiEstado(id, si, cambios) {
      const p = patchAlta(cambios)
      return escribir('actualizar alta (sin candado)', async (q) => (await q`UPDATE cj_altas a SET
          estado = CASE WHEN p.j ? 'estado' THEN p.j->>'estado' ELSE a.estado END,
          reemplazada_por = CASE WHEN p.j ? 'reemplazadaPor' THEN p.j->>'reemplazadaPor' ELSE a.reemplazada_por END,
          proximo_intento = CASE WHEN p.j ? 'proximoIntento' THEN (p.j->>'proximoIntento')::timestamptz ELSE a.proximo_intento END,
          actualizado = now()
        FROM (SELECT ${p}::jsonb AS j) p WHERE a.id = ${id} AND a.estado = ANY(${si}) RETURNING a.id`).length > 0)
    },
    async leerPasos(id) {
      const filas = await leer('leer pasos', [] as Row[], async (q) => q`SELECT *, to_char(iniciado AT TIME ZONE 'UTC', ${ISO_US}) AS iniciado_txt FROM cj_altas_pasos WHERE alta_id = ${id}` as Promise<Row[]>)
      const por = new Map(filas.map((r) => [String(r.paso), filaPaso(r)]))
      return Object.fromEntries(PASOS.map((p) => [p, por.get(p) ?? pasoVacio(p)])) as Record<PasoId, FilaPaso>
    },
    async marcarCorriendo(id, paso, dueno) {
      return escribir('marcar corriendo', async (q) => {
        const r = await q`INSERT INTO cj_altas_pasos (alta_id, paso, estado, iniciado, intentos)
          SELECT ${id}, ${paso}, 'corriendo', clock_timestamp(), 1 WHERE EXISTS (SELECT 1 FROM cj_altas WHERE id = ${id} AND candado_dueno = ${dueno} AND candado_hasta > now())
          ON CONFLICT (alta_id, paso) DO UPDATE SET estado = 'corriendo', iniciado = clock_timestamp(), intentos = cj_altas_pasos.intentos + 1, actualizado = now()
          RETURNING to_char(iniciado AT TIME ZONE 'UTC', ${ISO_US}) AS iniciado`
        return r.length ? String(r[0].iniciado) : null
      })
    },
    async guardarPaso(id, paso, iniciado, c) {
      const p = patchPaso(c)
      // Compare-and-set sobre `iniciado`, SIN exigir el candado: si se venció después de escribir afuera, igual se guarda
      return escribir('guardar paso', async (q) => (await q`UPDATE cj_altas_pasos s SET
          estado = p.j->>'estado',
          resultado = CASE WHEN p.j ? 'resultado' THEN NULLIF(p.j->'resultado', 'null'::jsonb) ELSE s.resultado END,
          no_antes_de = CASE WHEN p.j ? 'noAntesDe' THEN (p.j->>'noAntesDe')::timestamptz ELSE s.no_antes_de END,
          error = CASE WHEN p.j ? 'error' THEN p.j->>'error' ELSE s.error END,
          dudoso = CASE WHEN p.j ? 'dudoso' THEN (p.j->>'dudoso')::boolean ELSE s.dudoso END,
          parcial = CASE WHEN NOT (p.j ? 'parcial') THEN s.parcial WHEN p.j->'parcial' = 'null'::jsonb THEN NULL ELSE COALESCE(s.parcial, '{}'::jsonb) || (p.j->'parcial') END,
          terminado = CASE WHEN p.j->>'estado' IN ('hecho', 'simulado', 'omitido') THEN now() ELSE s.terminado END,
          actualizado = now()
        FROM (SELECT ${p}::jsonb AS j) p
        WHERE s.alta_id = ${id} AND s.paso = ${paso} AND s.iniciado = ${iniciado}::timestamptz RETURNING s.paso`).length > 0)
    },
    async fijarPaso(id, paso, dueno, c) {
      const p = patchPaso(c)
      return escribir('fijar paso', async (q) => {
        await q`INSERT INTO cj_altas_pasos (alta_id, paso, estado) SELECT ${id}, ${paso}, 'pendiente'
          WHERE EXISTS (SELECT 1 FROM cj_altas WHERE id = ${id} AND candado_dueno = ${dueno} AND candado_hasta > now()) ON CONFLICT (alta_id, paso) DO NOTHING`
        return (await q`UPDATE cj_altas_pasos s SET
            estado = p.j->>'estado',
            resultado = CASE WHEN p.j ? 'resultado' THEN NULLIF(p.j->'resultado', 'null'::jsonb) ELSE s.resultado END,
            no_antes_de = CASE WHEN p.j ? 'noAntesDe' THEN (p.j->>'noAntesDe')::timestamptz ELSE s.no_antes_de END,
            error = CASE WHEN p.j ? 'error' THEN p.j->>'error' ELSE s.error END,
            dudoso = CASE WHEN p.j ? 'dudoso' THEN (p.j->>'dudoso')::boolean ELSE s.dudoso END,
            parcial = CASE WHEN NOT (p.j ? 'parcial') THEN s.parcial WHEN p.j->'parcial' = 'null'::jsonb THEN NULL ELSE COALESCE(s.parcial, '{}'::jsonb) || (p.j->'parcial') END,
            actualizado = now()
          FROM (SELECT ${p}::jsonb AS j) p
          WHERE s.alta_id = ${id} AND s.paso = ${paso}
            AND EXISTS (SELECT 1 FROM cj_altas WHERE id = ${id} AND candado_dueno = ${dueno} AND candado_hasta > now())
          RETURNING s.paso`).length > 0
      })
    },
    async guardarParcial(id, paso, parcial) {
      await escribir('guardar parcial', async (q) => {
        await q`INSERT INTO cj_altas_pasos (alta_id, paso, estado, parcial) VALUES (${id}, ${paso}, 'pendiente', ${jsonSeguro(parcial)}::jsonb)
          ON CONFLICT (alta_id, paso) DO UPDATE SET parcial = COALESCE(cj_altas_pasos.parcial, '{}'::jsonb) || EXCLUDED.parcial, actualizado = now()`
      })
    },
    async anotarSaliente({ altaId, proposito, chatId, esperaId, huella, huellaSiRepite }) {
      const clave = `${altaId}:${proposito}`
      return escribir('anotar saliente', async (q): Promise<EstadoSaliente> => {
        const r = await q`INSERT INTO cj_altas_mensajes (clave, direccion, alta_id, chat_id, espera, proposito, huella, estado)
          VALUES (${clave}, 'saliente', ${altaId}, ${chatId}, ${esperaId ?? null}, ${proposito}, ${huella}, 'enviando') ON CONFLICT (clave) DO NOTHING RETURNING clave`
        if (r.length) return 'nuevo'
        const otra = await q`UPDATE cj_altas_mensajes SET estado = 'enviando', huella = ${huella} WHERE clave = ${clave} AND estado = 'fallido' RETURNING clave`
        if (otra.length) return 'nuevo'
        // Se va a reenviar con "(repetido)": la huella pasa a ser la de la copia (si no, su eco nunca empareja)
        if (huellaSiRepite) {
          const rep = await q`UPDATE cj_altas_mensajes SET huella = ${huellaSiRepite} WHERE clave = ${clave} AND estado IN ('enviando', 'dudoso') RETURNING estado`
          if (rep.length) return rep[0].estado as EstadoSaliente
        }
        const s = await q`SELECT estado FROM cj_altas_mensajes WHERE clave = ${clave}`
        return (s[0]?.estado as EstadoSaliente) ?? 'nuevo'
      })
    },
    async confirmarSaliente({ altaId, proposito, whapiId, estado, forzar }) {
      // Un saliente que su eco ya dejó 'enviado' no baja a 'dudoso' ni a 'fallido' (salvo con forzar: un NO de una persona)
      const bajaSiNo = !forzar && (estado === 'dudoso' || estado === 'fallido')
      return escribir('confirmar saliente', async (q) => {
        const r = await q`UPDATE cj_altas_mensajes SET
            estado = CASE WHEN ${bajaSiNo}::boolean AND estado = 'enviado' THEN estado ELSE ${estado} END,
            whapi_id = CASE WHEN ${bajaSiNo}::boolean AND estado = 'enviado' THEN whapi_id ELSE COALESCE(${whapiId}, whapi_id) END,
            procesado = now()
          WHERE clave = ${`${altaId}:${proposito}`} RETURNING estado, whapi_id`
        return r.length ? { estado: String(r[0].estado) as EstadoSaliente, whapiId: txt(r[0].whapi_id) } : null
      })
    },
    async salientePorEco({ chatId, huella, desde, whapiId }) {
      return escribir('eco de un saliente', async (q) => {
        const r = await q`UPDATE cj_altas_mensajes SET whapi_id = ${whapiId}, estado = 'enviado', procesado = now()
          WHERE clave = (SELECT clave FROM cj_altas_mensajes WHERE direccion = 'saliente' AND chat_id = ${chatId} AND huella = ${huella}
            AND creado >= ${desde}::timestamptz AND (whapi_id IS NULL OR whapi_id = ${whapiId}) AND estado <> 'simulado' ORDER BY creado DESC LIMIT 1)
          RETURNING alta_id, proposito`
        return r.length ? { altaId: String(r[0].alta_id), proposito: String(r[0].proposito) } : null
      })
    },
    async vencidas(limite, entorno, ahora) {
      return leer('altas vencidas', [], async (q) => (await q`SELECT id FROM cj_altas WHERE entorno = ${entorno} AND estado <> ALL(${FINALES})
        AND proximo_intento <= ${ahora}::timestamptz AND (candado_hasta IS NULL OR candado_hasta < now()) ORDER BY proximo_intento LIMIT ${limite}`).map((r) => String(r.id)))
    },
    async tomarRecurso(nombre, dueno, ttlMs) {
      const segundos = Math.max(1, Math.round(ttlMs / 1000))
      return escribir('tomar recurso', async (q) => (await q`INSERT INTO cj_altas_recursos (nombre, dueno, hasta) VALUES (${nombre}, ${dueno}, now() + make_interval(secs => ${segundos}))
        ON CONFLICT (nombre) DO UPDATE SET dueno = EXCLUDED.dueno, hasta = EXCLUDED.hasta
          WHERE cj_altas_recursos.hasta IS NULL OR cj_altas_recursos.hasta < now() OR cj_altas_recursos.dueno = EXCLUDED.dueno
        RETURNING nombre`).length > 0)
    },
    async soltarRecurso(nombre, dueno) {
      await escribir('soltar recurso', (q) => q`UPDATE cj_altas_recursos SET dueno = NULL, hasta = NULL WHERE nombre = ${nombre} AND dueno = ${dueno}`)
    },
    async leerRecurso(nombre) {
      return leer('leer recurso', null, async (q) => {
        const r = await q`SELECT dueno, hasta, datos FROM cj_altas_recursos WHERE nombre = ${nombre}`
        return r.length ? { dueno: txt(r[0].dueno), hasta: fecha(r[0].hasta), datos: json(r[0].datos, null) } : null
      })
    },
    async guardarDatosRecurso(nombre, datos) {
      await escribir('guardar datos de un recurso', (q) => q`INSERT INTO cj_altas_recursos (nombre, datos) VALUES (${nombre}, ${jsonSeguro(datos)}::jsonb)
        ON CONFLICT (nombre) DO UPDATE SET datos = EXCLUDED.datos`)
    },
    async purgar(ahora) {
      return escribir('purgar', async (q) => {
        const a = await q`DELETE FROM cj_altas_mensajes WHERE direccion = 'entrante' AND creado < ${ahora}::timestamptz - interval '14 days' RETURNING clave`
        const b = await q`UPDATE cj_altas SET texto_original = '', texto_vigente = '',
            medios = (SELECT COALESCE(jsonb_agg(m - 'link'), '[]'::jsonb) FROM jsonb_array_elements(medios) m),
            validacion = CASE WHEN validacion IS NULL THEN NULL ELSE jsonb_set(validacion, '{lecturas}', '{}'::jsonb) END
          WHERE estado = ANY(${FINALES}) AND actualizado < ${ahora}::timestamptz - interval '60 days' AND texto_original <> '' RETURNING id`
        return a.length + b.length
      })
    },
  }
}

/** Para los tests de autor: la condición de "mismo autor" del SQL (teléfono o lid). */
export const autorParaSql = (a: AutorWhapi) => ({ telefono: a.telefono, lid: a.lid })
