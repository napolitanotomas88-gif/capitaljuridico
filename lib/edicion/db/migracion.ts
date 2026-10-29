// ── Esquema de Grabación y Edición en Neon (migración versionada e idempotente) ────────────────────────────────────
// migrar(q):
//   1. lee `SELECT max(version) FROM cj_edicion_esquema` (si la tabla no existe, 42P01, sigue adelante);
//   2. si ya está en VERSION_ESQUEMA no corre NINGÚN DDL (un arranque en frío no pide locks);
//   3. si no, corre todas las SENTENCIAS_ESQUEMA en una transacción (CREATE … IF NOT EXISTS) e inserta la versión;
//   4. la carrera entre dos arranques en frío (23505 o 42P07 de las tablas del catálogo) se reintenta una vez.
// Migraciones futuras: SOLO aditivas (ADD COLUMN IF NOT EXISTS sin default que reescriba filas, mirando antes
// information_schema en current_schema(), como el kickoff), con VERSION_ESQUEMA + 1 y sus sentencias al final.
// Incluye las tablas del bloque C (cj_video_pedidos, cj_marca, cj_edicion_avisos): el SQL sobre ellas lo escribe C.
// scripts/edicion-esquema.mjs --imprimir muestra este DDL sin conectarse a nada.
import type { NeonQueryFunction } from '@neondatabase/serverless'

type Sql = NeonQueryFunction<false, false>

export const VERSION_ESQUEMA = 2

export const SENTENCIAS_ESQUEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cj_edicion_esquema (
    version int PRIMARY KEY,
    aplicada timestamptz NOT NULL DEFAULT now()
  )`,

  // Árbol de Crudos / Editados / Marca de cada cliente (y las carpetas de cliente, para vincularlas al CRM)
  `CREATE TABLE IF NOT EXISTS cj_grab_carpetas (
    drive_id text PRIMARY KEY,
    id_crm text,
    tipo text NOT NULL,
    raiz text,
    raiz_id text,
    padre_id text,
    nombre text NOT NULL DEFAULT '',
    ruta text[] NOT NULL DEFAULT '{}',
    nivel int NOT NULL DEFAULT 0,
    vinculo text NOT NULL DEFAULT 'a_confirmar',
    candidatos jsonb NOT NULL DEFAULT '[]'::jsonb,
    vigilar boolean NOT NULL DEFAULT false,
    creada timestamptz,
    ultimo_archivo timestamptz,
    consultada timestamptz,
    visto timestamptz NOT NULL DEFAULT now(),
    borrada timestamptz,
    avisado_vinculo timestamptz,
    actualizado_por text
  )`,
  `CREATE INDEX IF NOT EXISTS cj_grab_carpetas_id_crm ON cj_grab_carpetas (id_crm)`,
  `CREATE INDEX IF NOT EXISTS cj_grab_carpetas_vigilar ON cj_grab_carpetas (vigilar, consultada)`,

  // Un registro por crudo, editado o archivo de marca. Sin mails: el dueño se reduce a `subio`.
  `CREATE TABLE IF NOT EXISTS cj_grab_archivos (
    id bigserial PRIMARY KEY,
    drive_id text NOT NULL UNIQUE,
    id_crm text NOT NULL,
    tipo text NOT NULL,
    carpeta_id text NOT NULL,
    ruta text[] NOT NULL DEFAULT '{}',
    nombre text NOT NULL DEFAULT '',
    mime text NOT NULL DEFAULT '',
    bytes bigint,
    duracion_ms bigint,
    ancho int,
    alto int,
    subio text NOT NULL DEFAULT 'desconocido',
    creado_drive timestamptz,
    modificado_drive timestamptz,
    tanda_id bigint,
    inf_tanda int,
    inf_numero int,
    inf_por text,
    video_id bigint,
    asignado_por text,
    propuesta_video_id bigint,
    tr_estado text NOT NULL DEFAULT 'pendiente',
    tr_id text UNIQUE,
    tr_intentos int NOT NULL DEFAULT 0,
    tr_motivo text NOT NULL DEFAULT '',
    tr_enviado timestamptz,
    tr_listo timestamptz,
    tr_borrada_proveedor boolean NOT NULL DEFAULT false,
    tr_segundos int,
    borrado timestamptz,
    visto timestamptz NOT NULL DEFAULT now(),
    creado timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS cj_grab_archivos_cliente ON cj_grab_archivos (id_crm, creado_drive)`,
  `CREATE INDEX IF NOT EXISTS cj_grab_archivos_tanda ON cj_grab_archivos (tanda_id)`,
  `CREATE INDEX IF NOT EXISTS cj_grab_archivos_video ON cj_grab_archivos (video_id)`,
  `CREATE INDEX IF NOT EXISTS cj_grab_archivos_tr ON cj_grab_archivos (tr_estado)`,

  // La transcripción va aparte: los listados no arrastran ~100 KB por crudo
  `CREATE TABLE IF NOT EXISTS cj_grab_transcripciones (
    archivo_id bigint PRIMARY KEY REFERENCES cj_grab_archivos (id) ON DELETE CASCADE,
    proveedor text NOT NULL,
    proveedor_id text,
    modelo text NOT NULL DEFAULT '',
    idioma text NOT NULL DEFAULT '',
    texto text NOT NULL DEFAULT '',
    palabras jsonb NOT NULL DEFAULT '[]'::jsonb,
    duracion_ms bigint,
    creado timestamptz NOT NULL DEFAULT now()
  )`,

  // Tandas de subida (lote de archivos de un cliente que se cierra a los 45 minutos sin archivos nuevos)
  `CREATE TABLE IF NOT EXISTS cj_grab_tandas (
    id bigserial PRIMARY KEY,
    id_crm text NOT NULL,
    tipo text NOT NULL,
    desde timestamptz NOT NULL,
    hasta timestamptz NOT NULL,
    archivos int NOT NULL DEFAULT 0,
    subio text NOT NULL DEFAULT 'desconocido',
    estado text NOT NULL DEFAULT 'abierta',
    cerrada timestamptz,
    comparando_desde timestamptz,
    resultado jsonb,
    version_comparacion text,
    tokens_in int,
    tokens_out int,
    version int NOT NULL DEFAULT 1,
    creado timestamptz NOT NULL DEFAULT now(),
    actualizado timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cj_grab_tandas_abierta ON cj_grab_tandas (id_crm, tipo) WHERE estado = 'abierta'`,
  `CREATE INDEX IF NOT EXISTS cj_grab_tandas_estado ON cj_grab_tandas (estado, hasta)`,

  // Docs "Guiones - X" ya leídos (la línea de base evita altas fantasma la primera vez)
  `CREATE TABLE IF NOT EXISTS cj_grab_guiones (
    doc_id text PRIMARY KEY,
    id_crm text NOT NULL,
    nombre text NOT NULL DEFAULT '',
    modificado timestamptz,
    leido timestamptz NOT NULL DEFAULT now(),
    guiones jsonb NOT NULL DEFAULT '[]'::jsonb,
    huella text NOT NULL DEFAULT '',
    avisos jsonb NOT NULL DEFAULT '[]'::jsonb,
    linea_base timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS cj_grab_guiones_id_crm ON cj_grab_guiones (id_crm)`,

  // Corridas del bot; el índice parcial sobre `candado` hace de candado (una sola corrida a la vez)
  `CREATE TABLE IF NOT EXISTS cj_grab_corridas (
    id bigserial PRIMARY KEY,
    tipo text NOT NULL,
    origen text NOT NULL,
    estado text NOT NULL DEFAULT 'corriendo',
    candado text NOT NULL DEFAULT 'grabacion',
    inicio timestamptz NOT NULL DEFAULT now(),
    fin timestamptz,
    consultas int NOT NULL DEFAULT 0,
    archivos_nuevos int NOT NULL DEFAULT 0,
    tandas_cerradas int NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT '',
    resumen jsonb NOT NULL DEFAULT '{}'::jsonb
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cj_grab_corridas_candado ON cj_grab_corridas (candado) WHERE estado = 'corriendo'`,
  `CREATE INDEX IF NOT EXISTS cj_grab_corridas_inicio ON cj_grab_corridas (inicio)`,

  // Escalones de e01
  `CREATE TABLE IF NOT EXISTS cj_grab_seguimientos (
    id bigserial PRIMARY KEY,
    id_crm text NOT NULL,
    cliente text NOT NULL DEFAULT '',
    ciclo date NOT NULL,
    motivo text NOT NULL,
    escalon text NOT NULL,
    debido date NOT NULL,
    dias_habiles int NOT NULL DEFAULT 0,
    videos bigint[] NOT NULL DEFAULT '{}',
    responsable text NOT NULL,
    texto text NOT NULL DEFAULT '',
    hecho jsonb,
    decision text,
    decidido jsonb,
    frenado text,
    estado text NOT NULL DEFAULT 'abierto',
    version int NOT NULL DEFAULT 1,
    creado timestamptz NOT NULL DEFAULT now(),
    actualizado timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_crm, ciclo, escalon)
  )`,
  `CREATE INDEX IF NOT EXISTS cj_grab_seguimientos_estado ON cj_grab_seguimientos (estado, id_crm)`,

  // Videos (reemplazan la lista "Sistema de Edición" de ClickUp)
  `CREATE TABLE IF NOT EXISTS cj_videos (
    id bigserial PRIMARY KEY,
    id_crm text NOT NULL,
    cliente text NOT NULL DEFAULT '',
    clave text NOT NULL,
    tanda_guion int,
    numero int,
    guion_doc_id text,
    guion_ref text,
    guion_huella text,
    guion_texto text NOT NULL DEFAULT '',
    gancho text NOT NULL DEFAULT '',
    estado text NOT NULL,
    estado_previo text,
    estado_desde timestamptz NOT NULL DEFAULT now(),
    prioridad text NOT NULL DEFAULT 'normal',
    bloqueo text,
    motivo_bloqueo text NOT NULL DEFAULT '',
    motivo_regrabar text,
    ronda_interna int NOT NULL DEFAULT 0,
    ronda_cliente int NOT NULL DEFAULT 0,
    editado_archivo_id bigint,
    editado_url text,
    envio_link jsonb,
    ok_cliente jsonb,
    origen text NOT NULL,
    clickup_id text UNIQUE,
    posible_duplicado text[] NOT NULL DEFAULT '{}',
    version int NOT NULL DEFAULT 1,
    creado timestamptz NOT NULL DEFAULT now(),
    actualizado timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_crm, clave)
  )`,
  `CREATE INDEX IF NOT EXISTS cj_videos_estado ON cj_videos (estado)`,
  `CREATE INDEX IF NOT EXISTS cj_videos_id_crm ON cj_videos (id_crm)`,

  // Historial (el mail queda SOLO acá, para auditar)
  `CREATE TABLE IF NOT EXISTS cj_video_eventos (
    id bigserial PRIMARY KEY,
    video_id bigint NOT NULL,
    id_crm text NOT NULL,
    tipo text NOT NULL,
    de text,
    a text,
    actor_tipo text NOT NULL,
    actor_rol text,
    actor_nombre text NOT NULL DEFAULT '',
    actor_email text,
    nota text NOT NULL DEFAULT '',
    datos jsonb NOT NULL DEFAULT '{}'::jsonb,
    cuando timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS cj_video_eventos_video ON cj_video_eventos (video_id, cuando)`,
  `CREATE INDEX IF NOT EXISTS cj_video_eventos_cuando ON cj_video_eventos (cuando)`,

  // Notas de corrección
  `CREATE TABLE IF NOT EXISTS cj_video_notas (
    id bigserial PRIMARY KEY,
    video_id bigint NOT NULL,
    ronda int NOT NULL,
    origen text NOT NULL,
    enviada boolean NOT NULL DEFAULT false,
    segundo numeric,
    hasta numeric,
    tipo text NOT NULL DEFAULT 'otro',
    texto text NOT NULL DEFAULT '',
    imagen_url text,
    tilde jsonb,
    evaluacion jsonb,
    pedido_id bigint,
    creado_por text NOT NULL DEFAULT '',
    creado timestamptz NOT NULL DEFAULT now(),
    borrada boolean NOT NULL DEFAULT false,
    version int NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS cj_video_notas_video ON cj_video_notas (video_id, ronda)`,

  // Pedidos del cliente (f05) — SQL del bloque C
  `CREATE TABLE IF NOT EXISTS cj_video_pedidos (
    id bigserial PRIMARY KEY,
    video_id bigint NOT NULL,
    ronda int NOT NULL DEFAULT 0,
    texto text NOT NULL DEFAULT '',
    propuesta jsonb NOT NULL DEFAULT '[]'::jsonb,
    elegidas int[] NOT NULL DEFAULT '{}',
    estado text NOT NULL DEFAULT 'propuesto',
    modelo text,
    version_prompt text,
    creado_por text NOT NULL DEFAULT '',
    creado timestamptz NOT NULL DEFAULT now(),
    decidido jsonb,
    version int NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS cj_video_pedidos_video ON cj_video_pedidos (video_id)`,

  // Ficha de marca (e05) — SQL del bloque C
  `CREATE TABLE IF NOT EXISTS cj_marca (
    id_crm text PRIMARY KEY,
    colores jsonb NOT NULL DEFAULT '[]'::jsonb,
    tipografias jsonb NOT NULL DEFAULT '[]'::jsonb,
    logo jsonb,
    referencia jsonb,
    carpeta_marca jsonb,
    fuentes jsonb NOT NULL DEFAULT '{}'::jsonb,
    notas text NOT NULL DEFAULT '',
    version int NOT NULL DEFAULT 1,
    actualizado timestamptz NOT NULL DEFAULT now(),
    actualizado_por text
  )`,

  // Cola de avisos de Discord — SQL del bloque C. `clave` solo para los avisos de una vez (NULL en los agrupados)
  `CREATE TABLE IF NOT EXISTS cj_edicion_avisos (
    id bigserial PRIMARY KEY,
    clave text UNIQUE,
    base text NOT NULL,
    tipo text NOT NULL,
    canal text NOT NULL DEFAULT 'edicion',
    datos jsonb NOT NULL DEFAULT '{}'::jsonb,
    texto text,
    menciones text[] NOT NULL DEFAULT '{}',
    estado text NOT NULL DEFAULT 'pendiente',
    enviar_despues timestamptz NOT NULL DEFAULT now(),
    mensaje_id text,
    intentos int NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT '',
    creado timestamptz NOT NULL DEFAULT now(),
    enviado timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cj_edicion_avisos_pendiente ON cj_edicion_avisos (base) WHERE estado = 'pendiente'`,
  `CREATE INDEX IF NOT EXISTS cj_edicion_avisos_estado ON cj_edicion_avisos (estado, enviar_despues)`,

  // Marcas por cliente: los que graba el equipo quedan afuera de e01
  `CREATE TABLE IF NOT EXISTS cj_edicion_clientes (
    id_crm text PRIMARY KEY,
    cliente text NOT NULL DEFAULT '',
    graba_equipo boolean NOT NULL DEFAULT false,
    nota text NOT NULL DEFAULT '',
    actualizado timestamptz NOT NULL DEFAULT now(),
    actualizado_por text
  )`,

  // v2 (26/10/2026) — Propuestas de paleta (e05): lo que Claude leyó de cada archivo que el cliente subió a "Marca - X".
  // Una fila por archivo (drive_id único). 'reintentar' (falla pasajera) se relee hasta 3 veces; lo demás, nunca más.
  // Nunca pisa cj_marca: Aylu la usa desde la ficha.
  `CREATE TABLE IF NOT EXISTS cj_marca_propuestas (
    id bigserial PRIMARY KEY,
    id_crm text NOT NULL,
    drive_id text NOT NULL UNIQUE,
    nombre text NOT NULL DEFAULT '',
    estado text NOT NULL,
    colores jsonb NOT NULL DEFAULT '[]'::jsonb,
    tipografias jsonb NOT NULL DEFAULT '[]'::jsonb,
    nota text NOT NULL DEFAULT '',
    modelo text NOT NULL DEFAULT '',
    intentos int NOT NULL DEFAULT 1,
    creado timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS cj_marca_propuestas_cliente ON cj_marca_propuestas (id_crm, creado DESC)`,
]

/** Tablas que crea esta migración (para el GET de estado y los tests). */
export const TABLAS_EDICION: readonly string[] = SENTENCIAS_ESQUEMA
  .map(s => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(s)?.[1])
  .filter((x): x is string => !!x)

const codigo = (e: unknown): string => String((e as { code?: unknown })?.code ?? '')
const esFaltaTabla = (e: unknown): boolean => codigo(e) === '42P01' || /relation "cj_edicion_esquema" does not exist/i.test((e as Error)?.message ?? '')
const esCarrera = (e: unknown): boolean => ['23505', '42P07', '42710'].includes(codigo(e))

async function versionActual(q: Sql): Promise<number> {
  try {
    const filas = await q.query('SELECT max(version) AS version FROM cj_edicion_esquema')
    return Number((filas[0] as { version?: unknown } | undefined)?.version ?? 0) || 0
  } catch (e) {
    if (esFaltaTabla(e)) return 0
    throw e
  }
}

async function aplicar(q: Sql): Promise<void> {
  await q.transaction([
    ...SENTENCIAS_ESQUEMA.map(s => q.query(s)),
    q.query('INSERT INTO cj_edicion_esquema (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [VERSION_ESQUEMA]),
  ])
}

/** Pone el esquema en VERSION_ESQUEMA. Devuelve true si corrió DDL. */
export async function migrar(q: Sql): Promise<boolean> {
  if ((await versionActual(q)) >= VERSION_ESQUEMA) return false
  try {
    await aplicar(q)
  } catch (e) {
    if (!esCarrera(e)) throw e
    // Otro arranque en frío creó lo mismo en paralelo: si ya quedó la versión, listo; si no, una vez más
    if ((await versionActual(q)) >= VERSION_ESQUEMA) return false
    await aplicar(q)
  }
  return true
}
