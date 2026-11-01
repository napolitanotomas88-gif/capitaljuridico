import * as reg from './registro'
import { resolverDocumento, depsDocumentoReales, type DocAutomatico } from './documento'
import { escribirEnDoc, marcarParaGrabar, type ResultadoChips, type ResultadoDoc } from './envio'
import { notificarEntrega } from './entrega'
import type { FilaTanda } from './registro'
import { exigirClienteNoArchivado } from '@/lib/clientes/archivados'
import type { ResultadoAlta } from '../grabacion/altaDesdeGuiones'
export interface DepsPublicacion {
  reservar(id: number): Promise<boolean>
  leer(id: number): Promise<FilaTanda | undefined>
  resolver(fila: FilaTanda, hasta: number): Promise<DocAutomatico>
  escribir(fila: FilaTanda, doc: string, hasta: number): Promise<ResultadoDoc>
  guardar(id: number, doc: { id: string; url: string; tanda: number | null; publicada: string }): Promise<void>
  notificar(fila: FilaTanda): Promise<void>
  /** Los chips de la tanda a «Para grabar». Si falla, el Doc ya está publicado: se avisa en el log y se cambia a mano. */
  marcarChips?(docId: string, tanda: number, cantidad: number, hasta: number): Promise<ResultadoChips>
  /** d05: con los chips ya en «Para grabar», los videos de la tanda entran a Edición (Esperando crudos) sin esperar al vigía.
   *  Si falla, la pasada diaria del vigía los crea igual al leer el Doc: se avisa en el log. */
  altaEdicion?(fila: FilaTanda, docId: string, tanda: number): Promise<ResultadoAlta>
  error(id: number, motivo: string, dudoso: boolean): Promise<void>
  exigirActivo?(idCrm: string | null): Promise<void>
}
const reales: DepsPublicacion = {
  reservar: reg.reservarPublicacion, leer: reg.leerTanda,
  resolver: (fila, hasta) => resolverDocumento(fila, depsDocumentoReales(hasta)),
  escribir: (fila, id, hasta) => escribirEnDoc(fila, id, { hasta }),
  guardar: reg.anotarDoc, notificar: notificarEntrega, error: reg.errorPublicacion,
  marcarChips: (docId, tanda, cantidad, hasta) => marcarParaGrabar(docId, tanda, cantidad, { hasta }),
  altaEdicion: async (fila, docId, tanda) => (await import('../grabacion/altaDesdeGuiones')).altaDesdeTandaReal({
    id_crm: fila.id_crm ?? '', cliente: fila.cliente ?? '', doc_id: docId, tanda,
    guiones: Object.values(fila.guiones).map(g => g.guion).filter(Boolean),
  }),
  exigirActivo: exigirClienteNoArchivado,
}
/** Una aprobación publica el Doc y deja el link para Aylu/Gero. Nunca manda al cliente. */
export async function publicarParaEntrega(id: number, hasta: number, deps: DepsPublicacion = reales): Promise<void> {
  let dudoso = false, reservada = false
  try {
    if (deps.exigirActivo) { const previa = await deps.leer(id); await deps.exigirActivo(previa?.id_crm ?? null) }
    if (!(await deps.reservar(id))) return
    reservada = true
    const fila = await deps.leer(id)
    if (!fila || fila.estado !== 'aprobada') return
    if (!fila.aprobacion?.cuando) throw new Error('La tanda no tiene un check final vigente.')
    const doc = await deps.resolver(fila, hasta)
    await deps.exigirActivo?.(fila.id_crm)
    const d = await deps.escribir(fila, doc.id, hasta)
    if (d.estado !== 'ok') { dudoso = d.estado === 'dudoso'; throw new Error(d.motivo) }
    if (d.id !== doc.id) { dudoso = true; throw new Error('El puente respondió con otro documento. Revisar antes de entregar.') }
    await deps.guardar(id, { id: d.id, url: `https://docs.google.com/document/d/${d.id}/edit`, tanda: d.tanda, publicada: fila.aprobacion!.cuando })
    const cantidad = Object.keys(fila.guiones).length
    if (deps.marcarChips && d.tanda && cantidad) {
      const c = await deps.marcarChips(d.id, d.tanda, cantidad, hasta).catch((e): ResultadoChips => ({ estado: 'error', motivo: String((e as Error)?.message ?? e) }))
      if (c.estado !== 'ok') console.warn(`Guiones: publicación ${id}, chips sin pasar a «Para grabar» (cambiarlos a mano) — ${c.motivo.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)}`)
      // d05: solo con los chips en «Para grabar» (Edición refleja el Doc; si se cambian a mano, los toma el vigía)
      else if (deps.altaEdicion && fila.id_crm) {
        try {
          const a = await deps.altaEdicion(fila, d.id, d.tanda)
          if (a.frenadas || a.avisos.length) console.warn(`Guiones: publicación ${id}, Edición — ${a.avisos.join(' · ').slice(0, 200)}`)
        } catch (e) { console.warn(`Guiones: publicación ${id}, los videos no entraron a Edición (los crea el vigía al leer el Doc) — ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)}`) }
      }
    }
    const publicada = await deps.leer(id)
    if (publicada?.estado === 'aprobada') { await deps.exigirActivo?.(publicada.id_crm); await deps.notificar(publicada) }
  } catch (e) {
    const motivo = String((e as Error)?.message ?? 'No se pudo publicar el documento').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 180)
    if (reservada) await deps.error(id, motivo, dudoso)
    console.error(`Guiones: publicación ${id} pendiente — ${motivo}`)
  }
}
