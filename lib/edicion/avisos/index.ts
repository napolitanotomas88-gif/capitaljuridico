// ── Avisos de Edición: la interfaz que usan el motor (A) y la pantalla (B) ────────────────────────────────────────────
//   · avisarEventos(eventos, extra): encola lo que corresponde según las reglas de agrupación y despacha lo vencido.
//     NUNCA lanza (se llama en after(): una falla de los avisos no frena una acción ni una corrida del vigía).
//   · despacharPendientes(): manda lo que ya venció (lo llaman el vigía cada 15 minutos y el diario).
// Por defecto usa la cola real (db/avisos.ts), el lector real (db/videos.ts, db/tandas.ts y metaReciente.ts) y Discord;
// los tests inyectan todo por `op`. Modo dry (EDICION_MODO≠real): no escribe nada y devuelve el plan con los textos.
import { enviarDiscord } from '@/lib/fathomAnuncios/discord'
import { leerArchivados, exigirClienteNoArchivado, ClienteArchivadoError } from '@/lib/clientes/archivados'
import { modoEdicion } from '../config'
import type { AvisoMotor, EventoVideo } from '../tipos'
import { avisar, despachar, type DepsCola, type LectorAvisos, type OpcionesDespacho, type PlanAviso, type RepoAvisos } from './cola'

export type { DepsCola, LectorAvisos, PlanAviso, RepoAvisos } from './cola'
export { planificar, previsualizar, huella } from './cola'
export { armarMensaje, sinDatosPersonales, TIPOS_AVISO, type TipoAviso } from './mensajes'

export interface OpcionesAvisos extends OpcionesDespacho, Partial<Omit<DepsCola, 'repo' | 'lector'>> {
  repo?: RepoAvisos
  lector?: LectorAvisos
  /** avisarEventos: despachar lo vencido al terminar de encolar (por defecto, sí). */
  despachar?: boolean
}

async function repoReal(): Promise<RepoAvisos> {
  const db = await import('../db/avisos')
  return { encolar: db.encolar, reclamarVencidos: db.reclamarVencidos, cerrarAviso: db.cerrarAviso, reprogramar: db.reprogramar, marcarDudosos: db.marcarDudosos }
}

/** El lector real: los videos de db/videos.ts (como FilaTablero), las notas, la tanda y la sugerencia de Meta. */
async function lectorReal(): Promise<LectorAvisos> {
  const [videos, tandas, meta] = await Promise.all([import('../operativo'), import('../operativo'), import('../metaReciente')])
  return {
    videosDeCliente: id_crm => videos.listarVideos({ id_crm, incluirFinales: true }),
    videosPorIds: ids => (ids.length ? videos.listarVideos({ ids, incluirFinales: true }) : Promise.resolve([])),
    notasDe: async id => (await videos.leerVideo(id))?.notas ?? [],
    tanda: id => tandas.leerTanda(id),
    sugerenciaMeta: cliente => meta.sugerenciaMeta(cliente),
  }
}

async function deps(op: OpcionesAvisos): Promise<DepsCola> {
  const { baseConfigurada } = await import('../db/base')
  return {
    repo: op.repo ?? await repoReal(),
    lector: op.lector ?? await lectorReal(),
    enviar: op.enviar ?? enviarDiscord,
    env: op.env,
    ahora: op.ahora,
    baseLista: op.baseLista ?? baseConfigurada,
    esOperativo: op.esOperativo ?? (op.repo || op.lector ? undefined : async datos => {
      const archivados = await leerArchivados({ forzar: true })
      try {
        if (datos.id_crm) await exigirClienteNoArchivado(datos.id_crm, archivados)
        else if (datos.video_id || datos.tanda_id || Array.isArray(datos.videos)) {
          const { exigirReferenciasActivas } = await import('../operativo')
          await exigirReferenciasActivas({ videos: Array.isArray(datos.videos) ? datos.videos.map(Number) : datos.video_id ? [Number(datos.video_id)] : [], tandas: datos.tanda_id ? [Number(datos.tanda_id)] : [] }, archivados)
        }
        return true
      } catch (e) { if (e instanceof ClienteArchivadoError) return false; throw e }
    }),
  }
}

/** Encola los avisos de estos eventos y avisos del motor, y despacha lo vencido. Nunca lanza. */
export async function avisarEventos(eventos: readonly EventoVideo[], extra: readonly AvisoMotor[], op: OpcionesAvisos = {}): Promise<{ encolados: number; enviados: number; plan?: (PlanAviso & { texto: string | null })[] }> {
  if (!op.repo && !op.lector && modoEdicion(op.env) === 'real' && process.env.DATABASE_URL && eventos.length) {
    try {
      const { sincronizarEventosTarjetas } = await import('../tarjetasSincronizar')
      await sincronizarEventosTarjetas(eventos)
    } catch (e) {
      console.error('[edicion/tarjetas] sincronizar eventos:', ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    }
  }
  try {
    return await avisar(eventos, extra, await deps(op), op)
  } catch (e) {
    console.error('[edicion/avisos] avisarEventos:', ((e as Error)?.message ?? String(e)).slice(0, 200))
    return { encolados: 0, enviados: 0 }
  }
}

/** Despacha lo vencido de la cola. Devuelve cuántos salieron, cuántos quedaron en dry y cuántos con error. */
export async function despacharPendientes(op: OpcionesAvisos = {}): Promise<{ enviados: number; dry: number; errores: number }> {
  try {
    const r = await despachar(await deps(op), op)
    return { enviados: r.enviados, dry: r.dry, errores: r.errores }
  } catch (e) {
    console.error('[edicion/avisos] despacharPendientes:', ((e as Error)?.message ?? String(e)).slice(0, 200))
    return { enviados: 0, dry: 0, errores: 1 }
  }
}
