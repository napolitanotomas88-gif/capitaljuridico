// ── Dependencias REALES del bot de grabación (Neon, Drive, CRM, AssemblyAI, Claude, avisos, reloj) ───────────────────
// Está acá y no en los route.ts (un route.ts de Next solo puede exportar los métodos y la configuración) y así los scripts
// de prueba pueden armar las mismas dependencias con la base o Discord reemplazados.
//   · modo: EDICION_MODO (dry por defecto). En dry el vigía y el diario no escriben y devuelven el plan; Claude no se arma.
//   · Drive: lectorReal (cuenta de servicio, drive.readonly). CRM: leerClientes (solo lectura). Altas: fuenteAltas ([] hoy).
//   · Transcripción: transcriptorReal (null sin ASSEMBLYAI_API_KEY); palabras clave de la ficha del kickoff
//     (listarFichasCliente, lectura). El webhook compara la tanda solo con el cruce simple (alListo, sin Claude).
//   · Avisos: avisarEventos / despacharPendientes del bloque C (nunca lanzan).
// Solo servidor.
import type { ArchivoGrabacion, IdCrm, Ymd } from '@/lib/edicion/tipos'
import { modoEdicion } from '@/lib/edicion/config'
import * as Videos from '@/lib/edicion/operativo'
import * as Archivos from '@/lib/edicion/operativo'
import * as Tandas from '@/lib/edicion/operativo'
import * as Carpetas from '@/lib/edicion/operativo'
import * as Guiones from '@/lib/edicion/operativo'
import * as Seguimientos from '@/lib/edicion/operativo'
import * as Corridas from '@/lib/edicion/db/corridas'
import * as Clientes from '@/lib/edicion/db/clientes'
import { leerMarca } from '@/lib/edicion/operativo'
import * as Propuestas from '@/lib/edicion/db/marcaPropuestas'
import { avisarEventos, despacharPendientes } from '@/lib/edicion/avisos'
import { esHabil } from '@/lib/anuncios/feriados'
import { leerClientes } from '@/lib/clientes/leer'
import { listarFichasCliente } from '@/lib/bot/kickoff/registro'
import { claveClaude, llamarClaude } from '@/lib/bot/kickoff/claude'
import { urlDespacho } from '@/lib/bot/kickoff/entorno'
import { lectorReal } from './drive'
import { transcriptorReal } from './assemblyai'
import { palabrasClave } from './palabrasClave'
import { vinculosDeAltas } from './fuenteAltas'
import { compararTanda, type RepoGrabacion } from './vigia'
import type { RepoMarca } from './marcaVigia'
import type { DepsE01Whatsapp } from './e01Whatsapp'
import { crearClienteWhapi } from '@/lib/bot/whapi/cliente'
import { tokenWhapi } from '@/lib/bot/whapi/config'
import { retomarDiario, type DepsDiario } from './diario'
import type { DepsTranscripcion } from './transcripcion'
import { leerArchivados, excluirArchivados, exigirClienteNoArchivado, ClienteArchivadoError } from '@/lib/clientes/archivados'

export const PLAZO_VIGIA_MS = 280_000         // maxDuration 300 s menos el margen para responder y cerrar la corrida
export const PLAZO_WEBHOOK_MS = 55_000        // maxDuration 60 s
async function clienteOperativoFresco(id: string): Promise<boolean> {
  try { await exigirClienteNoArchivado(id, await leerArchivados({ forzar: true })); return true }
  catch (e) { if (e instanceof ClienteArchivadoError) return false; throw e }
}

// e05: lo que el vigía necesita para leer "Marca - X" (marcaVigia.ts)
export const REPO_MARCA: RepoMarca = {
  fichaConColores: async id => ((await leerMarca(id))?.colores.length ?? 0) > 0,
  yaLeidos: Propuestas.archivosYaLeidos,
  guardar: Propuestas.guardarPropuesta,
  reintento: Propuestas.anotarReintento,
}

// e01 por WhatsApp (e01Whatsapp.ts): apagado salvo E01_WHATSAPP=real. El token de Whapi solo se lee al mandar.
export function e01WhatsappReal(env: Record<string, string | undefined>): DepsE01Whatsapp {
  return {
    pasosAbiertos: Seguimientos.pasosAbiertos,
    docs: async () => new Map((await Guiones.listarDocs()).map(d => [d.id_crm.toUpperCase(), d.doc_id] as const)),
    grupos: async () => {
      const token = tokenWhapi()
      if (!token) throw new Error('falta WHAPI_TOKEN')
      const r = await fetch('https://gate.whapi.cloud/groups?count=500', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
      if (!r.ok) throw new Error(`Whapi respondió ${r.status} al listar los grupos`)
      const j = (await r.json().catch(() => null)) as { groups?: { id?: string; name?: string }[] } | null
      return (j?.groups ?? []).filter(g => g.id && g.name).map(g => ({ id: g.id!, nombre: g.name! }))
    },
    // Se vuelve a mirar justo antes de mandar: los pasos son de las 7 y el cliente pudo subir crudos después
    vigente: async p => {
      try { await exigirClienteNoArchivado(p.id_crm, await leerArchivados({ forzar: true })) } catch (e) { if (e instanceof ClienteArchivadoError) return false; throw e }
      if (!p.videos.length) return false                       // listarVideos sin ids traería todos
      const desde = `${p.ciclo}T03:00:00.000Z`
      const [videos, archivos, equipo] = await Promise.all([
        Videos.listarVideos({ ids: p.videos }), Archivos.estadoArchivos(desde), Clientes.clientesGrabaEquipo(env),
      ])
      if (equipo.has(p.id_crm.toUpperCase())) return false
      if (!videos.some(v => v.estado === 'esperando_crudos' || v.estado === 'regrabar')) return false
      return !archivos.sinUbicar.some(a => a.id_crm.toUpperCase() === p.id_crm.toUpperCase() && a.creado >= desde)
    },
    enviar: async (chatId, texto) => {
      const token = tokenWhapi()
      if (!token) throw Object.assign(new Error('falta WHAPI_TOKEN'), { aplicado: false })
      const r = await crearClienteWhapi({ token }).enviarTexto({ chatId, texto })
      return { id: (r as { id?: string | null }).id ?? null }
    },
    reclamar: Seguimientos.reclamarPasoBot, confirmar: Seguimientos.confirmarPasoBot, soltar: Seguimientos.soltarPasoBot,
    anotarNoSalio: Seguimientos.anotarNoSalioBot, colgados: Seguimientos.pasosBotColgados,
    env, esHabil: (d: Ymd) => esHabil(d),
  }
}

export const REPO: RepoGrabacion = {
  abrirCorrida: Corridas.abrirCorrida, cerrarCorrida: Corridas.cerrarCorrida, ultimaCorrida: Corridas.ultimaCorrida,
  corridasDesde: Corridas.corridasDesde, fasesHechas: Corridas.fasesHechas,
  carpetasAVigilar: Carpetas.carpetasAVigilar, guardarArbol: Carpetas.guardarArbol, anotarConsultas: Carpetas.anotarConsultas,
  ajustarVigilancia: Carpetas.ajustarVigilancia, vigilarCrudosDe: Carpetas.vigilarCrudosDe, vinculosSinAviso: Carpetas.vinculosSinAviso,
  marcarCarpetasBorradas: Carpetas.marcarCarpetasBorradas, todasLasCarpetas: Carpetas.todasLasCarpetas, listarVinculos: Carpetas.listarVinculos,
  guardarArchivos: Archivos.guardarArchivos, marcarBorrados: Archivos.marcarBorrados, vincularArchivo: Archivos.vincularArchivo,
  proponerEditado: Archivos.proponerEditado, crudosDeCliente: Archivos.crudosDeCliente, archivosDeTanda: Archivos.archivosDeTanda,
  transcripcionesDe: Archivos.transcripcionesDe, estadoArchivos: Archivos.estadoArchivos,
  asignarATanda: Tandas.asignarATanda, tandasParaCerrar: Tandas.tandasParaCerrar, cerrarTanda: Tandas.cerrarTanda,
  reclamarComparacion: Tandas.reclamarComparacion, guardarResultado: Tandas.guardarResultado, marcarAvisada: Tandas.marcarAvisada,
  soltarComparacion: Tandas.soltarComparacion,
  tandasParaComparar: Tandas.tandasParaComparar, tandasEditadosCerradas: Tandas.tandasEditadosCerradas, leerTanda: Tandas.leerTanda,
  listarVideos: Videos.listarVideos, moverVideo: Videos.moverVideo, actualizarVideo: Videos.actualizarVideo, crearVideoSiFalta: Videos.crearVideoSiFalta,
  leerDoc: Guiones.leerDoc, leerDocPorId: Guiones.leerDocPorId, docsLeidos: Guiones.docsLeidos, guardarDoc: Guiones.guardarDoc,
  pasosAbiertos: Seguimientos.pasosAbiertos, crearPasos: Seguimientos.crearPasos, actualizarPaso: Seguimientos.actualizarPaso,
  cerrarCiclo: Seguimientos.cerrarCiclo,
  clientesGrabaEquipo: Clientes.clientesGrabaEquipo,
}

async function crmSoloLectura(): Promise<{ id: IdCrm; nombre: string; estado: string }[]> {
  const [d, archivados] = await Promise.all([leerClientes(), leerArchivados()])
  // Conserva la identidad para cruzar carpetas históricas: un archivado no reaparece como «carpeta sin cliente».
  return d.clientes.filter(c => /^[A-Za-z]\d{1,6}$/.test(c.id)).map(c => ({ id: c.id.toUpperCase(), nombre: c.nombre, estado: archivados.has(c.id.toUpperCase()) ? 'FINALIZADO' : c.estado }))
}

/** inicio: cuándo llegó el pedido (el plazo cuenta desde ahí). `dry` fuerza el modo prueba (?dry=1). */
export function depsReales(op: { inicio?: number; dry?: boolean; env?: Record<string, string | undefined> } = {}): DepsDiario {
  const env = op.env ?? process.env
  const inicio = op.inicio ?? Date.now()
  const modo = op.dry ? 'dry' : modoEdicion(env)
  const ahora = () => new Date()
  const transcripcion: DepsTranscripcion = {
    transcriptor: transcriptorReal(env),
    repo: {
      pendientesDeTranscribir: Archivos.pendientesDeTranscribir, reclamarTranscripcion: Archivos.reclamarTranscripcion,
      anotarTranscripcion: Archivos.anotarTranscripcion, guardarTranscripcion: Archivos.guardarTranscripcion,
      anotarBorradaProveedor: Archivos.anotarBorradaProveedor, porProveedorId: Archivos.porProveedorId, leerArchivo: Archivos.leerArchivo,
      colgadas: Archivos.colgadas, segundosEnviadosDesde: Archivos.segundosEnviadosDesde, buscarGemelo: Archivos.buscarGemelo,
    },
    palabras: id => palabrasClave(id, listarFichasCliente),
    esOperativo: clienteOperativoFresco,
    env, ahora, modo, urlBase: urlDespacho(),
  }
  const deps: DepsDiario = {
    drive: lectorReal(env),
    repo: REPO,
    transcripcion,
    claude: modo === 'real' && claveClaude() ? llamarClaude : null,
    crm: crmSoloLectura,
    altas: async () => excluirArchivados(await vinculosDeAltas(), await leerArchivados(), x => x.id_crm),
    avisar: (eventos, extra) => avisarEventos(eventos, extra),
    despachar: async () => {
      const anterior = await despacharPendientes()
      if (modo === 'real') {
        try {
          const { despacharTarjetasPendientes } = await import('@/lib/edicion/tarjetasAvisos')
          await despacharTarjetasPendientes({ hasta: inicio + PLAZO_VIGIA_MS })
        } catch (e) {
          console.error('[edicion/tarjetas] despacho pendiente:', ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
        }
      }
      return anterior
    },
    ahora, modo, esHabil: (d: Ymd) => esHabil(d), env,
    esOperativo: clienteOperativoFresco,
    listarDocs: Guiones.listarDocs,
    marca: REPO_MARCA,
    e01Whatsapp: e01WhatsappReal(env),
  }
  deps.retomar = o => retomarDiario(deps, o)
  // Webhook: con la transcripción guardada, si la tanda ya cerró y no espera otra, cruce simple (Claude lo hace el vigía)
  transcripcion.alListo = async (a: ArchivoGrabacion) => {
    try { await exigirClienteNoArchivado(a.id_crm) } catch (e) { if (e instanceof ClienteArchivadoError) return; throw e }
    if (!a.tanda_id) return
    const t = await Tandas.leerTanda(a.tanda_id)
    if (!t || t.estado !== 'cerrada') return
    const faltan = (await Archivos.archivosDeTanda(t.id)).some(x => ['pendiente', 'enviando', 'enviada'].includes(x.transcripcion.estado) && x.id !== a.id)
    if (faltan) return
    const r = await compararTanda(deps, t.id, { deadline: inicio + PLAZO_WEBHOOK_MS, ahora: new Date(), sinClaude: true })
    await avisarEventos(r.eventos, r.extra)
  }
  return deps
}
