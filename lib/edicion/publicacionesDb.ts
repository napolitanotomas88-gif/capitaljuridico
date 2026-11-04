// ── «Publicar» → anuncio EN PAUSA → «Publicado»: la cola durable de publicaciones (4/11/2026) ─────────────────────────
// Regla exacta de Tomás: «cuando está en PUBLICAR ahí se hace el anuncio, y cuando lo terminás de crear lo pasás a
// PUBLICADO». Una fila por tarjeta y por archivo de Drive del editado: esa combinación es única y es lo que impide armar dos
// veces el mismo anuncio (un reintento, un rebote de ClickUp o una tarjeta que vuelve a «publicar» con el mismo archivo).
// Solo cuentan los movimientos a «publicar» desde EDICION_PUBLICAR_DESDE (ISO UTC): lo que ya estaba antes (y las ~380
// tarjetas en «publicado») no dispara nada. Sin esa variable, la cola no se llena (el flujo está apagado).
import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { idDeDrive } from './marca'

export const SQL_PUBLICACIONES = `
CREATE TABLE IF NOT EXISTS cj_edicion_publicaciones (
 id text PRIMARY KEY, tarjeta_id text NOT NULL REFERENCES cj_edicion_tarjetas(id), archivo text NOT NULL, id_crm text,
 estado text NOT NULL DEFAULT 'pendiente', intentos integer NOT NULL DEFAULT 0, detalle text NOT NULL DEFAULT '',
 resultado jsonb NOT NULL DEFAULT '{}', origen text NOT NULL DEFAULT 'despacho', movido timestamptz NOT NULL DEFAULT now(),
 creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now(), disponible timestamptz NOT NULL DEFAULT now(), tomado timestamptz,
 UNIQUE(tarjeta_id, archivo));
CREATE INDEX IF NOT EXISTS cj_edicion_publicaciones_cola ON cj_edicion_publicaciones(estado, disponible);`

export type EstadoPublicacion = 'pendiente' | 'armando' | 'creado' | 'falta_copy' | 'error' | 'dudoso' | 'seco'
/** Estados en los que la tarjeta todavía espera su anuncio (el vigía y el botón los retoman). */
export const PUBLICACION_REINTENTABLE: readonly EstadoPublicacion[] = ['pendiente', 'falta_copy', 'error', 'seco']

/** El corte desde el que un movimiento a «publicar» arma el anuncio. null = apagado. */
export function publicarDesde(env: Record<string, string | undefined> = process.env): number | null {
  const v = env.EDICION_PUBLICAR_DESDE?.trim() ?? ''
  const t = Date.parse(v)
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/.test(v) && Number.isFinite(t) ? t : null
}

/** ¿Este movimiento a «publicar» dispara el anuncio? Solo la ENTRADA (no estar), y solo desde el corte. Puro. */
export function disparaPublicacion(x: { antes: string | null; despues: string; cuandoMs: number; desdeMs: number | null }): boolean {
  return x.despues === 'publicar' && x.antes !== 'publicar' && x.desdeMs !== null && Number.isFinite(x.cuandoMs) && x.cuandoMs >= x.desdeMs
}

/** El archivo del editado: el id de Drive del link; si no es de Drive, una huella del link (y la fila queda en error). */
export function archivoEditado(editado: string): { archivo: string; drive: string | null } {
  const drive = editado ? idDeDrive(editado) : null
  return drive ? { archivo: drive, drive } : { archivo: `sin_drive:${createHash('sha256').update(editado || '-').digest('hex').slice(0, 16)}`, drive: null }
}

/**
 * Anota la publicación dentro de la MISMA transacción del movimiento (la tarjeta y su anuncio pendiente quedan juntos).
 * Si ya existe para ese archivo: si quedó creada no se toca (nunca un segundo anuncio); si falló, vuelve a pendiente.
 */
export async function registrarPublicacion(c: PoolClient, t: { id: string; id_crm: string | null; editado: string }, origen: 'despacho' | 'clickup' | 'prueba'): Promise<{ id: string; estado: string; nuevo: boolean }> {
  await c.query(SQL_PUBLICACIONES)
  const { archivo, drive } = archivoEditado(t.editado)
  const id = `pub_${createHash('sha256').update(`${t.id}|${archivo}`).digest('hex').slice(0, 24)}`
  const estado = drive ? 'pendiente' : 'error', detalle = drive ? '' : 'El link del editado no es un archivo de Drive: cargá el link del video (drive.google.com/file/d/…) y volvé a moverla a Publicar.'
  const r = (await c.query(`INSERT INTO cj_edicion_publicaciones(id,tarjeta_id,archivo,id_crm,estado,detalle,origen) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(tarjeta_id,archivo) DO UPDATE SET estado=CASE WHEN cj_edicion_publicaciones.estado IN ('creado','armando','dudoso') THEN cj_edicion_publicaciones.estado ELSE EXCLUDED.estado END,
      detalle=CASE WHEN cj_edicion_publicaciones.estado IN ('creado','armando','dudoso') THEN cj_edicion_publicaciones.detalle ELSE EXCLUDED.detalle END,
      movido=now(), disponible=now(), actualizado=now()
    RETURNING id,estado,(xmax=0) nuevo`, [id, t.id, archivo, t.id_crm, estado, detalle, origen])).rows[0]
  return { id: String(r.id), estado: String(r.estado), nuevo: r.nuevo === true }
}
