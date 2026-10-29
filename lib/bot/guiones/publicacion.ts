import * as reg from './registro'
import { resolverDocumento, depsDocumentoReales, type DocAutomatico } from './documento'
import { escribirEnDoc, type ResultadoDoc } from './envio'
import { notificarEntrega } from './entrega'
import type { FilaTanda } from './registro'
import { exigirClienteNoArchivado } from '@/lib/clientes/archivados'
export interface DepsPublicacion {
  reservar(id: number): Promise<boolean>
  leer(id: number): Promise<FilaTanda | undefined>
  resolver(fila: FilaTanda, hasta: number): Promise<DocAutomatico>
  escribir(fila: FilaTanda, doc: string, hasta: number): Promise<ResultadoDoc>
  guardar(id: number, doc: { id: string; url: string; tanda: number | null; publicada: string }): Promise<void>
  notificar(fila: FilaTanda): Promise<void>
  error(id: number, motivo: string, dudoso: boolean): Promise<void>
  exigirActivo?(idCrm: string | null): Promise<void>
}
const reales: DepsPublicacion = {
  reservar: reg.reservarPublicacion, leer: reg.leerTanda,
  resolver: (fila, hasta) => resolverDocumento(fila, depsDocumentoReales(hasta)),
  escribir: (fila, id, hasta) => escribirEnDoc(fila, id, { hasta }),
  guardar: reg.anotarDoc, notificar: notificarEntrega, error: reg.errorPublicacion,
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
    const publicada = await deps.leer(id)
    if (publicada?.estado === 'aprobada') { await deps.exigirActivo?.(publicada.id_crm); await deps.notificar(publicada) }
  } catch (e) {
    const motivo = String((e as Error)?.message ?? 'No se pudo publicar el documento').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 180)
    if (reservada) await deps.error(id, motivo, dudoso)
    console.error(`Guiones: publicación ${id} pendiente — ${motivo}`)
  }
}
