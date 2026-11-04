// ── Dependencias reales del flujo Publicar (publicar.ts): Neon, tablero de /anuncios, Doc de ADS, Meta, avisos ──────────
// Solo servidor. EDICION_PUBLICAR=real crea en Meta (todo EN PAUSA); cualquier otro valor = seco. Lo llaman el vigía
// (cada 15 min), el after() de un movimiento a Publicar, la sincronización con ClickUp y la prueba en seco.
import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { obtenerTablero, type Tablero } from '@/lib/anuncios/tablero'
import { alertar } from '@/lib/alertas'
import { crearNotificacion } from '@/lib/notificaciones/registro'
import { armarBorrador, borradorPermitido, crearGraph, esErrorPausa, type GrupoBorrador, type Graph } from '@/lib/bot/anuncios/borrador'
import { avisarSiNoQuedoEnPausa } from '@/lib/bot/anuncios/avisoPausa'
import { escribirTextos } from '@/lib/bot/anuncios/copys'
import { parsearDocAds } from '@/lib/bot/anuncios/docAds'
import { filasProcesadas } from '@/lib/bot/anuncios/docAdsBase'
import { marcarHuellas } from '@/lib/bot/anuncios/docAdsBaseNeon'
import { lanzarDesdeDoc, resumirSeco } from '@/lib/bot/anuncios/docAdsLanzar'
import { docAdsId, leerDocAds } from '@/lib/bot/anuncios/docAdsLeer'
import { archivo, depsDocAdsReales, graphSeco } from '@/lib/bot/anuncios/docAdsServidor'
import { escribirVideoEnDoc } from '@/lib/bot/anuncios/docAdsEscribir'
import { reclamarAviso, marcarAvisoEnviado } from '@/lib/bot/anuncios/registro'
import { estructuraRotacion } from '@/lib/bot/anuncios/videos'
import type { GuionDoc } from './tipos'
import { ganchoYGuion } from './importar'
import { clickupReal } from './clickupApi'
import { transaccionTarjetas } from './tarjetasDb'
import { publicarUna, seccionesDeGuion, type DepsPublicar, type PublicacionFila, type ResultadoPublicar, type TarjetaPublicar } from './publicar'

export const modoPublicar = (env: Record<string, string | undefined> = process.env): 'real' | 'seco' => env.EDICION_PUBLICAR?.trim() === 'real' ? 'real' : 'seco'
export const rotarReal = (env: Record<string, string | undefined> = process.env): boolean => env.ANUNCIOS_ROTAR?.trim() === 'real'
const linkDrive = (id: string) => `https://drive.google.com/file/d/${id}/view`
const objeto = <T>(x: unknown, d: T): T => { if (typeof x === 'string') { try { return JSON.parse(x) as T } catch { return d } } return (x ?? d) as T }

async function tarjetaPublicar(c: PoolClient, id: string): Promise<TarjetaPublicar | null> {
  const f = (await c.query('SELECT id,nombre,etapa,id_crm,campos,clickup_id,video_id FROM cj_edicion_tarjetas WHERE id=$1 AND borrada IS NULL', [id])).rows[0]
  return f ? { id: String(f.id), nombre: String(f.nombre), etapa: String(f.etapa), id_crm: f.id_crm ? String(f.id_crm) : null, campos: objeto(f.campos, { editado: '' }), clickup_id: f.clickup_id ? String(f.clickup_id) : null, video_id: f.video_id ? Number(f.video_id) : null } : null
}

/** La tarjeta pasa a Publicado (lo hace el bot): historial, video del motor y outbox a ClickUp, en una transacción. */
export async function cerrarTarjetaPublicada(x: { tarjeta: TarjetaPublicar; anuncios: string[]; link: string | null; campana: string | null }): Promise<void> {
  await transaccionTarjetas(async c => {
    const f = (await c.query('SELECT * FROM cj_edicion_tarjetas WHERE id=$1 FOR UPDATE', [x.tarjeta.id])).rows[0]
    if (!f || f.etapa !== 'publicar') return
    const evento = `evt_pub_${createHash('sha256').update(`${x.tarjeta.id}|${x.anuncios.join(',')}`).digest('hex').slice(0, 24)}`
    let videoVersion: number | null = null
    if (f.video_id) {
      const cita = String((await c.query("SELECT texto FROM cj_edicion_tarjetas_historial WHERE tarjeta_id=$1 AND tipo='movimiento' AND despues='publicar' ORDER BY fecha DESC LIMIT 1", [f.id])).rows[0]?.texto ?? '').replace(/^[^\n]*→[^\n]*\n?/, '')
      const v = (await c.query("UPDATE cj_videos SET estado='aprobado',estado_desde=CASE WHEN estado<>'aprobado' THEN now() ELSE estado_desde END,ok_cliente=COALESCE(ok_cliente,$2::jsonb),version=version+1,actualizado=now() WHERE id=$1 AND estado NOT IN ('pausado','descartado') RETURNING version", [f.video_id, JSON.stringify({ quien: 'Bot C.J', cuando: new Date().toISOString(), texto: cita, cita })])).rows[0]
      if (v) { videoVersion = Number(v.version); await c.query("INSERT INTO cj_video_eventos(video_id,id_crm,tipo,de,a,actor_tipo,actor_nombre,nota,datos) VALUES($1,$2,'estado','con_cliente','aprobado','bot','Bot C.J',$3,$4::jsonb)", [f.video_id, f.id_crm, 'Anuncio creado en pausa: Publicado.', JSON.stringify({ origen: 'tarjetas', tarjeta_id: f.id })]) }
    }
    await c.query("UPDATE cj_edicion_tarjetas SET etapa='publicado',version=version+1,actualizado=now(),video_version=COALESCE($2,video_version) WHERE id=$1", [f.id, videoVersion])
    const texto = `publicar → publicado\nAnuncio creado EN PAUSA y verificado${x.campana ? ` en «${x.campana}»` : ''} (${x.anuncios.length} anuncio${x.anuncios.length === 1 ? '' : 's'}: ${x.anuncios.join(', ')}).${x.link ? `\n${x.link}` : ''}`
    await c.query("INSERT INTO cj_edicion_tarjetas_historial(id,tarjeta_id,quien,tipo,antes,despues,texto,datos) VALUES($1,$2,'Bot C.J','movimiento','publicar','publicado',$3,$4::jsonb) ON CONFLICT(id) DO NOTHING", [evento, f.id, texto, JSON.stringify({ origen: 'publicar', anuncios: x.anuncios })])
    if (f.clickup_id || f.origen === 'despacho') await c.query("INSERT INTO cj_edicion_tarjetas_outbox(id,tarjeta_id,evento_id,canal,destino,datos) VALUES($1,$2,$3,'clickup','clickup',$4::jsonb) ON CONFLICT(id) DO NOTHING", [`${evento}:cu`, f.id, evento, JSON.stringify({ op: 'estado', etapa: 'publicado', comentario: `Bot C.J (Despacho): anuncio creado EN PAUSA (${x.anuncios.join(', ')}). Nada se activó en Meta.`, id_crm: f.id_crm, tarjeta: f.nombre, evento_id: evento, tipo_aviso: 'clickup', texto: '' })])
  })
}

/** El copy del video: el del Doc de ADS; si no, el directo escrito desde su guion (tarjeta, motor o ClickUp). */
async function copyDe(t: TarjetaPublicar, drive: string): Promise<{ copy: string | null; textos?: string[]; titulos?: string[]; fuente: string }> {
  try {
    for (const b of parsearDocAds(await leerDocAds())) { const v = b.videos.find(x => x.drive === drive && x.copy.trim()); if (v) return { copy: v.copy.trim(), fuente: `Doc de ADS («${b.titulo}»)` } }
  } catch { /* sin Doc: se sigue con el guion */ }
  let guion = '', gancho = '', fuente = ''
  await transaccionTarjetas(async c => {
    const h = (await c.query("SELECT texto FROM cj_edicion_tarjetas_historial WHERE tarjeta_id=$1 AND tipo='comentario' AND texto ILIKE 'guion:%' ORDER BY fecha DESC LIMIT 1", [t.id])).rows[0]
    if (h) { guion = String(h.texto); fuente = 'guion de la tarjeta'; return }
    if (t.video_id) { const v = (await c.query('SELECT guion_texto,gancho FROM cj_videos WHERE id=$1', [t.video_id])).rows[0]; if (v?.guion_texto || v?.gancho) { guion = String(v.guion_texto ?? ''); gancho = String(v.gancho ?? ''); fuente = 'guion del video (motor)' } }
  })
  if (!guion && !gancho && t.clickup_id) {
    const api = clickupReal()
    if (api) { const cs = await api.comentarios(t.clickup_id).catch(() => []); const g = ganchoYGuion(cs.map(x => ({ fecha: x.fecha, texto: x.texto, imagenes: 0 }))); guion = g.guion; gancho = g.gancho; if (guion || gancho) fuente = 'guion de ClickUp' }
  }
  const s = seccionesDeGuion(guion, gancho)
  if (!s) return { copy: null, fuente: 'sin guion' }
  const r = await escribirTextos([{ ref: t.nombre, tanda: 0, numero: 1, estado_doc: 'ok', titulo: t.nombre, secciones: s, frases: [], huella: '' } as unknown as GuionDoc]).catch(() => null)
  return r ? { copy: r.textos[1], textos: r.textos, titulos: r.titulos, fuente: `escrito desde el ${fuente}` } : { copy: null, fuente: `${fuente}: no se pudo escribir el copy` }
}

export function depsPublicarReales(op: { modo?: 'real' | 'seco'; deadline: number }): DepsPublicar {
  let tablero: Promise<Tablero> | null = null
  const t = () => (tablero ??= obtenerTablero())
  const buscar = async (idCrm: string) => { const tb = await t(); return { tb, fila: tb.filas.find(f => f.idCrm === idCrm) ?? null, pl: [...tb.porLanzar, ...(tb.porLanzarEsperando ?? [])].find(p => p.idCrm === idCrm) ?? null } }
  return {
    modo: op.modo ?? modoPublicar(),
    tarjeta: id => transaccionTarjetas(c => tarjetaPublicar(c, id)),
    cliente: async idCrm => { const { fila, pl } = await buscar(idCrm); return fila ? { nombre: fila.clienteCRM ?? fila.cliente, tipo: 'campana', cuenta: fila.id } : pl ? { nombre: pl.cliente, tipo: 'por_lanzar', cuenta: pl.kickoff?.cuenta?.id ?? null } : { nombre: idCrm, tipo: null, cuenta: null } },
    video: async drive => { const a = await archivo(drive); return a ? { nombre: a.nombre, legible: a.video && a.publico !== false } : null },
    copy: copyDe,
    escribirDoc: x => escribirVideoEnDoc(x, { docId: docAdsId() }),
    lanzar: async x => {
      const tb = await t(), base = depsDocAdsReales(tb)
      const sintetico = `${x.cliente} - LISTO\nvideo 1: ${linkDrive(x.drive)}\n${x.copy}\n\n`
      // Solo este cliente y solo este video (sin sumar «Editados»); el aviso lo manda publicar.ts (uno solo, con el resultado).
      const deps = { ...base, leerDoc: async () => sintetico + await base.leerDoc().catch(() => ''), editados: async () => [], enviar: async () => 'despacho-publicar' }
      const r = await lanzarDesdeDoc(tb, deps, { seco: x.seco, solo: x.idCrm, deadline: op.deadline })
      return { r: r.clientes.find(c => c.idCrm === x.idCrm) ?? r.clientes.find(c => c.cliente === x.cliente) ?? null, errores: r.errores }
    },
    rotar: async x => {
      const { tb, fila } = await buscar(x.idCrm)
      if (!fila) throw new Error('no tiene campaña corriendo en el tablero')
      const token = process.env.META_ANUNCIOS_TOKEN?.trim()
      if (!token) throw new Error('falta META_ANUNCIOS_TOKEN')
      const real = crearGraph(token), puede = rotarReal() && borradorPermitido(fila.id)
      const enSeco = puede ? null : 'la rotación automática está en seco (ANUNCIOS_ROTAR o ANUNCIOS_BORRADOR_SOLO): no se creó nada en Meta'
      const s = x.seco || !puede ? graphSeco(real) : null
      const graph: Graph = s ? s.graph : real
      const ahora = new Date().toISOString()
      const usdPor = fila.usdPor ?? tb.filas.find(f => f.moneda === fila.moneda && f.usdPor)?.usdPor ?? null
      const filaOk = { ...fila, usdPor }
      const grupo: GrupoBorrador = { videos: [{ nombre: x.nombre, drive: x.drive }], textos: x.textos?.length ? x.textos : [x.copy], titulos: x.titulos ?? [], guiones: [], copyPorVideo: { [x.drive]: x.copy } }
      const sub = { clave: `publicar:${x.drive}`, carpetaId: 'despacho', carpetaCliente: fila.clienteCRM ?? fila.cliente, cliente: fila.clienteCRM ?? fila.cliente, tanda: 'Despacho', numero: null, videos: [{ id: x.drive, nombre: x.nombre, creado: ahora }], hasta: ahora }
      const armar = () => armarBorrador(sub, filaOk, [grupo], estructuraRotacion(fila, 1), { graph, esperar: ms => new Promise<void>(r => setTimeout(r, ms)), ahora: () => Date.now() }, op.deadline)
      if (s) { const b = await armar(); return { borrador: b, seco: resumirSeco(s.pedidos, b, fila.moneda), enSeco } }
      const clave = `publicar-rotar:${x.drive}`
      if (!await reclamarAviso(clave, { tipo: 'docads', cuenta: fila.id, campana_id: 'publicar', cliente: sub.cliente, texto_cliente: null })) throw new Error('esta rotación ya se armó o se avisó antes: verificá en Meta y pasala a Publicado con el ID')
      const b = await avisarSiNoQuedoEnPausa(armar, { cliente: sub.cliente, cuenta: fila.id }, { alertar, esErrorPausa })
      await marcarAvisoEnviado(clave, b.anuncios.join(',')).catch(() => {})
      const bloque = parsearDocAds(`${sub.cliente} - LISTO\nvideo 1: ${linkDrive(x.drive)}\n${x.copy}`)[0]
      if (bloque) await marcarHuellas(filasProcesadas(bloque, [{ drive: x.drive, numero: 1 }])).catch(() => {})
      return { borrador: b, seco: null, enSeco: null }
    },
    cerrarTarjeta: cerrarTarjetaPublicada,
    avisar: async x => {
      const titulo = x.ok ? '📣 Anuncio armado EN PAUSA desde Publicar' : '⚠️ No pude armar el anuncio de un video en Publicar'
      await crearNotificacion({ paraSeccion: 'anuncios', tipo: 'edicion_publicar', titulo, cuerpo: `${x.cliente}${x.tarjeta.id_crm ? ` (${x.tarjeta.id_crm})` : ''} · ${x.lineas.join('\n')}`.slice(0, 1000), url: x.link ?? `/clientes/edicion?tarjeta=${encodeURIComponent(x.tarjeta.id)}`, urgente: !x.ok, origen: 'edicion-publicar', clave: x.clave })
      await alertar({ canal: 'ads', tipo: 'edicion_publicar', clave: `ads:${x.clave}`, titulo, cliente: x.cliente, idCrm: x.tarjeta.id_crm, lineas: x.lineas, link: x.link ?? `/clientes/edicion?tarjeta=${encodeURIComponent(x.tarjeta.id)}`, menciones: ['valentino'], urgente: !x.ok })
      if (!x.ok) await alertar({ canal: 'sistema', tipo: 'edicion_publicar_error', clave: `sistema:${x.clave}`, titulo, cliente: x.cliente, idCrm: x.tarjeta.id_crm, lineas: x.lineas, link: `/clientes/edicion?tarjeta=${encodeURIComponent(x.tarjeta.id)}`, menciones: ['tomas'] })
    },
  }
}

/** La cola: pendientes (y reintentos espaciados) → publicarUna. Nunca tira. */
export async function procesarPublicaciones(op: { hasta: number; limite?: number; deps?: DepsPublicar } = { hasta: Date.now() + 240_000 }): Promise<{ procesadas: ResultadoPublicar[]; errores: string[] }> {
  const out = { procesadas: [] as ResultadoPublicar[], errores: [] as string[] }
  try {
    const d = op.deps ?? depsPublicarReales({ deadline: op.hasta - 15_000 })
    const filas = await transaccionTarjetas(async c => {
      await c.query("UPDATE cj_edicion_publicaciones SET estado='dudoso',detalle='Se cortó mientras se armaba: verificá en Meta antes de reintentar (pasala a Publicado con el ID si quedó creado).' WHERE estado='armando' AND tomado<now()-interval '15 minutes'")
      const estados = d.modo === 'real' ? ['pendiente', 'falta_copy', 'error', 'seco'] : ['pendiente']
      const r = await c.query("SELECT p.* FROM cj_edicion_publicaciones p JOIN cj_edicion_tarjetas t ON t.id=p.tarjeta_id WHERE t.etapa='publicar' AND t.borrada IS NULL AND p.estado=ANY($1::text[]) AND p.disponible<=now() AND p.intentos<8 ORDER BY p.disponible LIMIT $2 FOR UPDATE OF p SKIP LOCKED", [estados, op.limite ?? 2])
      if (r.rows.length) await c.query("UPDATE cj_edicion_publicaciones SET estado='armando',tomado=now(),intentos=intentos+1,actualizado=now() WHERE id=ANY($1::text[])", [r.rows.map(f => f.id)])
      return r.rows as PublicacionFila[]
    })
    for (const p of filas) {
      if (Date.now() > op.hasta - 90_000) { await transaccionTarjetas(c => c.query("UPDATE cj_edicion_publicaciones SET estado='pendiente' WHERE id=$1", [p.id])); continue }
      let r: Awaited<ReturnType<typeof publicarUna>>
      try { r = await publicarUna(p, d) } catch (e) { r = { publicacion: p.id, tarjeta: p.tarjeta_id, cliente: null, estado: 'error', detalle: String((e as Error)?.message ?? e).slice(0, 200), camino: null, anuncios: [], link: null, campana: null, copy: null, doc: null, seco: null, despues: [] } }
      const espera = r.reintentar ? 10 : r.estado === 'falta_copy' ? 60 : r.estado === 'error' ? 360 : 0
      await transaccionTarjetas(c => c.query("UPDATE cj_edicion_publicaciones SET estado=$2,detalle=$3,resultado=$4::jsonb,actualizado=now(),disponible=now()+$5::int*interval '1 minute' WHERE id=$1", [p.id, r.estado, r.detalle.slice(0, 500), JSON.stringify({ camino: r.camino, anuncios: r.anuncios, link: r.link, campana: r.campana, copy: r.copy, doc: r.doc }), espera]))
      out.procesadas.push(r)
    }
  } catch (e) { out.errores.push(String((e as Error)?.message ?? e).slice(0, 200)) }
  return out
}

/** Prueba en seco en producción: «¿qué pasaría si esta tarjeta entra a Publicar?». No escribe Neon, ClickUp, el Doc ni Meta. */
export async function simularPublicar(tarjetaId: string, deadline: number): Promise<ResultadoPublicar & { tarjeta_nombre?: string; etapa_actual?: string }> {
  const d = depsPublicarReales({ modo: 'seco', deadline })
  const t = await d.tarjeta(tarjetaId)
  const { archivoEditado } = await import('./publicacionesDb')
  const a = archivoEditado(t?.campos.editado ?? '')
  const r = await publicarUna({ id: 'simulacion', tarjeta_id: tarjetaId, archivo: a.archivo, id_crm: t?.id_crm ?? null, estado: 'pendiente', intentos: 0, detalle: '' }, { ...d, cerrarTarjeta: async () => {}, avisar: async () => {}, escribirDoc: async () => 'seco: no se escribe' })
  return { ...r, tarjeta_nombre: t?.nombre, etapa_actual: t?.etapa }
}
