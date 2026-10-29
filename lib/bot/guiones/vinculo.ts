import { resolverDocumento, depsDocumentoReales } from './documento'
import { anotarVinculoInicial, leerTanda, type FilaTanda } from './registro'
import { exigirClienteNoArchivado } from '@/lib/clientes/archivados'
/** Vincula el documento al iniciar la tanda, antes de la revisión; también recupera tandas anteriores sin vínculo. */
export async function asegurarVinculoTanda(fila: FilaTanda, hasta = Date.now() + 100_000): Promise<FilaTanda> {
  if (fila.doc?.id || fila.estado === 'aprobada' || fila.estado === 'enviada' || !fila.id_crm || !process.env.DATABASE_URL) return fila
  try {
    await exigirClienteNoArchivado(fila.id_crm)
    const doc = await resolverDocumento(fila, depsDocumentoReales(hasta))
    const vinculo = { id: doc.id, url: doc.url }
    if (await anotarVinculoInicial(fila.id, vinculo)) return (await leerTanda(fila.id)) ?? { ...fila, doc: vinculo }
    return (await leerTanda(fila.id)) ?? fila
  } catch (e) {
    // La generación puede seguir. La pantalla explica que el documento no se vinculó; jamás se elige un Doc ambiguo.
    const motivo = String((e as Error)?.message ?? 'No se pudo vincular el documento').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 180)
    console.error(`Guiones: vínculo automático ${fila.id} pendiente — ${motivo}`)
    return { ...fila, doc: null, documento_pendiente: motivo }
  }
}
