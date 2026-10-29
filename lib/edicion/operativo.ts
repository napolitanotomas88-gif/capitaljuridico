// Adaptador real de Edición: las tablas preservan historial; sólo el trabajo vigente pasa la barrera CRM fresca.
import { leerArchivados, excluirArchivados, exigirClienteNoArchivado } from '../clientes/archivados'
import * as V from './db/videos'
import * as A from './db/archivos'
import * as C from './db/carpetas'
import * as T from './db/tandas'
import * as S from './db/seguimientos'
import * as G from './db/guiones'
import * as M from './db/marca'
import * as P from './db/pedidos'
import * as Avisos from './db/avisos'
import { leer, ErrorEntradaEdicion, type Fila } from './db/base'
import { videosFinalizadosImportados } from './tarjetasDb'
export * from './db/videos'
export * from './db/archivos'
export * from './db/carpetas'
export * from './db/tandas'
export * from './db/seguimientos'
export * from './db/guiones'
export * from './db/marca'
export * from './db/pedidos'

interface Referencias { clientes?: readonly string[]; videos?: readonly number[]; archivos?: readonly number[]; notas?: readonly number[]; pasos?: readonly number[]; pedidos?: readonly number[]; tandas?: readonly number[] }
/** Resuelve referencias del servidor; el navegador no puede sustituir el cliente de una nota, archivo o pedido. */
export async function exigirReferenciasActivas(refs: Referencias, estadoActual?: ReadonlySet<string>): Promise<void> {
  const archivados = estadoActual ?? await leerArchivados()
  const grupos = await Promise.all([
    refs.videos?.length ? leer('cliente de videos', [] as Fila[], q => q`SELECT id_crm,id video_id FROM cj_videos WHERE id = ANY(${[...(refs.videos ?? [])]}::bigint[])` as Promise<Fila[]>) : [],
    refs.archivos?.length ? leer('cliente de archivos', [] as Fila[], q => q`SELECT id_crm,video_id FROM cj_grab_archivos WHERE id = ANY(${[...(refs.archivos ?? [])]}::bigint[])` as Promise<Fila[]>) : [],
    refs.notas?.length ? leer('cliente de notas', [] as Fila[], q => q`SELECT v.id_crm,v.id video_id FROM cj_video_notas n JOIN cj_videos v ON v.id = n.video_id WHERE n.id = ANY(${[...(refs.notas ?? [])]}::bigint[])` as Promise<Fila[]>) : [],
    refs.pasos?.length ? leer('cliente de pasos', [] as Fila[], q => q`SELECT id_crm FROM cj_grab_seguimientos WHERE id = ANY(${[...(refs.pasos ?? [])]}::bigint[])` as Promise<Fila[]>) : [],
    refs.pedidos?.length ? leer('cliente de pedidos', [] as Fila[], q => q`SELECT v.id_crm,v.id video_id FROM cj_video_pedidos p JOIN cj_videos v ON v.id = p.video_id WHERE p.id = ANY(${[...(refs.pedidos ?? [])]}::bigint[])` as Promise<Fila[]>) : [],
    refs.tandas?.length ? leer('cliente de tandas', [] as Fila[], q => q`SELECT id_crm FROM cj_grab_tandas WHERE id = ANY(${[...(refs.tandas ?? [])]}::bigint[])` as Promise<Fila[]>) : [],
  ])
  for (const id of new Set([...(refs.clientes ?? []), ...grupos.flatMap(xs => xs.map(x => String(x.id_crm ?? '')))])) await exigirClienteNoArchivado(id, archivados)
  const cerrados = await videosFinalizadosImportados()
  if ([...(refs.videos ?? []), ...grupos.flatMap(xs => xs.map(x => Number(x.video_id)).filter(Number.isFinite))].some(id => cerrados.has(id))) throw new ErrorEntradaEdicion('video', 'Este video ya figura finalizado en ClickUp. Tomás puede reabrirlo desde su tarjeta con una nota.')
}
function guardar<Args extends unknown[], Resultado>(fn: (...args: Args) => Promise<Resultado>, refs: (...args: Args) => Referencias) {
  return async (...args: Args): Promise<Resultado> => { await exigirReferenciasActivas(refs(...args)); return fn(...args) }
}
async function activos<Resultado extends { id_crm: string | null }>(fn: () => Promise<Resultado[]>): Promise<Resultado[]> {
  const archivados = await leerArchivados()
  return excluirArchivados(await fn(), archivados, x => x.id_crm)
}

export async function listarVideos(f: V.FiltroVideos): Promise<V.FilaTablero[]> {
  const [archivados, cerrados] = await Promise.all([leerArchivados(), videosFinalizadosImportados()])
  return V.listarVideos({ ...f, excluirIds: [...new Set([...(f.excluirIds ?? []), ...archivados])], excluirVideos: [...new Set([...(f.excluirVideos ?? []), ...cerrados])] })
}
export async function leerVideo(id: number): Promise<V.DetalleVideo | null> {
  const [d, archivados, cerrados] = await Promise.all([V.leerVideo(id), leerArchivados(), videosFinalizadosImportados()])
  return d && !archivados.has(d.video.id_crm.toUpperCase()) && !cerrados.has(id) ? d : null
}
export async function leerCliente(id: string): Promise<V.DatosCliente> { await exigirClienteNoArchivado(id); const [d, cerrados] = await Promise.all([V.leerCliente(id), videosFinalizadosImportados()]); return { ...d, videos: d.videos.filter(v => !cerrados.has(v.id)) } }
export const moverVideo = guardar(V.moverVideo, p => ({ videos: [p.id] }))
export const actualizarVideo = guardar(V.actualizarVideo, p => ({ videos: [p.id] }))
export const registrarEnvio = guardar(V.registrarEnvio, p => ({ videos: p.items.map(x => x.id) }))
export const crearVideoSiFalta = guardar(V.crearVideoSiFalta, p => ({ clientes: [p.id_crm] }))
export const crearNota = guardar(V.crearNota, p => ({ videos: [p.video_id] }))
export const editarNota = guardar(V.editarNota, p => ({ notas: [p.id] }))
export const borrarNota = guardar(V.borrarNota, p => ({ notas: [p.id] }))
export const tildarNota = guardar(V.tildarNota, p => ({ notas: [p.id] }))
export const aplicarPedidoCliente = guardar(V.aplicarPedidoCliente, p => ({ pedidos: [p.pedido_id] }))
export const autorizarPedidoCliente = guardar(V.autorizarPedidoCliente, p => ({ pedidos: [p.pedido_id] }))
export const descartarPedidoCliente = guardar(V.descartarPedidoCliente, p => ({ pedidos: [p.pedido_id] }))
export const vincularArchivo = guardar(A.vincularArchivo, p => ({ archivos: [p.archivo_id], videos: p.video_id ? [p.video_id] : [] }))
export const proponerEditado = guardar(A.proponerEditado, (archivo, video) => ({ archivos: [archivo], videos: [video] }))
export const guardarArchivos = guardar(A.guardarArchivos, id => ({ clientes: [id] }))
export async function guardarArbol(entrada: Parameters<typeof C.guardarArbol>[0], op?: Parameters<typeof C.guardarArbol>[1]) { return C.guardarArbol(await activos(async () => entrada), op) }
export const reclamarTranscripcion = guardar(A.reclamarTranscripcion, id => ({ archivos: [id] }))
export const confirmarVinculo = guardar(C.confirmarVinculo, p => ({ clientes: [p.id_crm] }))
export const vigilarCrudosDe = guardar(C.vigilarCrudosDe, id => ({ clientes: [id] }))
export const asignarATanda = guardar(T.asignarATanda, id => ({ clientes: [id] }))
export const reclamarComparacion = guardar(T.reclamarComparacion, id => ({ tandas: [id] }))
export const cerrarTanda = guardar(T.cerrarTanda, id => ({ tandas: [id] }))
export const guardarDoc = guardar(G.guardarDoc, p => ({ clientes: [p.id_crm] }))
export const guardarMarca = guardar(M.guardarMarca, id => ({ clientes: [id] }))
export const crearPedido = guardar(P.crearPedido, p => ({ videos: [p.video_id] }))
export const marcarPaso = guardar(S.marcarPaso, p => ({ pasos: [p.id] }))
export const decidirPaso = guardar(S.decidirPaso, p => ({ pasos: [p.id] }))
export const actualizarPaso = guardar(S.actualizarPaso, id => ({ pasos: [id] }))
export async function crearPasos(xs: S.PasoNuevo[]) { return S.crearPasos(await activos(async () => xs)) }

export const pasosAbiertos = async () => S.pasosAbiertos([...await leerArchivados()])
export const listarPendientesE01 = pasosAbiertos
export const carpetasAVigilar = async (limite: number) => C.carpetasAVigilar(limite, [...await leerArchivados()])
export const listarVinculos = async () => C.listarVinculos([...await leerArchivados()])
export const todasLasCarpetas = () => activos(C.todasLasCarpetas)
export const vinculosSinAviso = () => activos(C.vinculosSinAviso)
export const pendientesDeTranscribir = async (limite: number) => A.pendientesDeTranscribir(limite, [...await leerArchivados()], [...await videosFinalizadosImportados()])
export async function archivosDeTanda(id: number) { const [xs, cerrados] = await Promise.all([A.archivosDeTanda(id), videosFinalizadosImportados()]); return xs.filter(x => !x.video_id || !cerrados.has(x.video_id)) }
export async function crudosDeCliente(id: string, desde: string | null) { const [xs, cerrados] = await Promise.all([A.crudosDeCliente(id, desde), videosFinalizadosImportados()]); return xs.filter(x => !x.video_id || !cerrados.has(x.video_id)) }
export const tandasParaCerrar = async (ahora: Date) => T.tandasParaCerrar(ahora, [...await leerArchivados()])
export const tandasParaComparar = async (ahora: Date) => T.tandasParaComparar(ahora, [...await leerArchivados()])
export const tandasEditadosCerradas = async () => T.tandasEditadosCerradas([...await leerArchivados()])
export const listarTandas = (f: Parameters<typeof T.listarTandas>[0]) => activos(() => T.listarTandas(f))
export const listarDocs = async () => G.listarDocs([...await leerArchivados()])
export async function listarAvisos(f: Parameters<typeof Avisos.listarAvisos>[0]) {
  const [avisos, archivados] = await Promise.all([Avisos.listarAvisos(f), leerArchivados()])
  return excluirArchivados(avisos, archivados, a => a.datos.id_crm)
}
