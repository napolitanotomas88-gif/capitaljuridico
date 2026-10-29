// ── Bot "Capital Jurídico": el orquestador de altas (BLOQUE O) ──────────────────────────────────────────────────────
// Diseño del motor, secciones 3, 6 y 7, con los cambios de la revisión. Encadena los pasos existentes con el estado en el
// almacén (Neon en producción, memoria en los tests y en la simulación):
//   · registrar: guarda los eventos que importan (no la charla de Ventas: punto 35) sin repetir por clave.
//   · procesar: cada evento encuentra su alta (o crea una), y después cada alta tocada avanza. Al final, el barrido
//     oportunista (recordatorios, vencimientos, altas con hora vencida) aunque no haya llegado ningún evento (punto 22).
//   · avanzar: candado por alta → eventos pendientes de esa alta → siguienteAccion() → paso → guarda el resultado → …
//     Quien no consigue el candado marca hay_pendientes y el dueño no suelta hasta procesarlo (punto 11). El candado se
//     suelta ANTES de disparar la continuación (punto 15).
//   · Modo efectivo = el menor entre el del alta y el del entorno (punto 27). En seco y ensayo, una sola pasada: lo que se
//     pediría queda anotado, el resto corre como vista previa y el alta termina 'simulada' (punto 19). En ensayo sale un
//     solo reporte a Verificaciones C.J, con "SIMULACIÓN — no se cargó nada" (punto 36).
//   · Continuaciones y despertador solo en producción (VERCEL_ENV=production: punto 34).
//   · Altas en formato libre (sin #ALTA, Tomás 26/10/2026, lib/bot/alta/altaLibre.ts): nacen con "Closer: X" (del autor) y
//     no hacen nada hasta el OK de Verificaciones (espera 'confirmacion' de pasoValidar). Un NO las descarta sin escribirle al
//     closer. El comprobante aparte del mismo autor se les asocia durante 30 minutos, y el pago siguiente del mismo cliente
//     (por nombre, teléfono o correo) completa su Fee.
// Nunca tira desde procesar/avanzar/barrer: los errores van al resumen y a cj_altas. Los logs llevan ids, no datos
// personales.
import { parsearAlta } from '../parsear'
import { telefonoDelCliente } from '../crm'
import { nombreCliente } from '../nombreCliente'
import { fechaDiaAnterior } from '../finanzas'
import { fuenteAOpcion, setterAOpcion } from '../setterFuente'
import type { AlmacenAltas, CambiosAlta, Espera, FilaAlta, FilaPaso, MotivoEspera, Quien, Validacion } from './almacen'
import { esFinal, mismoAutor, validacionVacia } from './almacen'
import type { Capacidad, ModoMotor } from './modo'
import { menorModo, modoMenorQue } from './modo'
import type { CtxPaso, DepsPasos, EnvioSolicitado, ResultadoEnvio } from './contexto'
import {
  algoEscritoAfuera, esperaReenvio, estadoDeEspera, proximaHora, proximoRecordatorio, siguienteAccion, venceEspera, VENCE_FEE_MS,
  type Accion, type EsperaNueva, type SalidaPaso,
} from './estado'
import { adaptarRespuestaSocios, extrasDeRespuesta, fusionarRespuesta, lineasReconocidas, textoNormalizado } from './fusion'
import { mismaPersona } from '../comprobante'
import {
  TEXTO_CITAR, TEXTO_CITAR_COMPROBANTE, TEXTO_CITAR_DATO_OTRA, TEXTO_CORREO_SOCIO_AMBIGUO, TEXTO_DATOS_NO_ENTENDIDOS, TEXTO_NO_RECONOCIDO,
  TEXTO_NO_VIGENTE, TEXTO_NOMBRE_NO_ENTENDIDO, conPrefijoEnsayo, recortar, textoAvisos,
  textoCorreccionFinal, textoDuplicada, textoFaltaCuenta, textoFaltaFuente, textoFaltaMep, textoPedidoEquipo, textoRechazoCloser, textoRecordatorio,
  textoReporteEnsayo, textoSumado, textoVencida, textoAltaCitandoOtra, textoAvisoAltaCitandoOtra,
} from './mensajes'
import {
  guardadoAprobado, leerRestoOk, nombreDeResto, pasoBienvenida, pasoContrato, pasoCrm, pasoDrive, pasoFinanzas, pasoSkool, pasoValidar, sha256,
  usdAcumuladoDe,
} from './pasos'
import { pasoComunidad, recursoGeneral } from './comunidad'
import { altaParseada } from './pasos'
import { VENTANA_ADJUNTO_LIBRE_MS, closerDeAutor, esAltaLibreFila, esPagoLibre, textoAltaLibre, textoPagoSiguiente } from '../altaLibre'
import type { DepsMotorBase, EventoBot, EventoRespuesta, MotorAltas, PasoId, RefMedio, ResumenProceso, Veredicto } from './tipos'
import { MOTIVO_SIN_NUMERO, PASOS } from './tipos'
import { MOTIVO_CANAL_DESPACHO, PASOS_A_MANO, type CanalAlta } from '../despacho/canal'

export interface LogMotor { info(m: string): void; warn(m: string): void; error(m: string): void }

export interface DepsOrquestador extends DepsMotorBase {
  almacen: AlmacenAltas
  pasos: DepsPasos
  /** VERCEL_ENV o 'local': se guarda en cada alta y el barrido solo toma las del mismo entorno. */
  entorno: string
  /** Continuaciones y despertador solo en producción. */
  produccion: boolean
  dispararContinuacion?: (d: { alta_id: string; cadena: number }) => Promise<void>
  dispararDespertador?: (d: { alta_id: string; no_antes_de: string }) => Promise<void>
  despertador?: boolean
  /** Espera entre reintentos al guardar un resultado (1, 2 y 4 s); se cambia en los tests. */
  dormir?: (ms: number) => Promise<void>
  log?: LogMotor
  /** Altas desde el Despacho (26/10/2026, lib/bot/alta/despacho/canal.ts): por dónde van los pedidos (BOT_ALTA_CANAL). Sin
   *  esto, 'whatsapp' (como antes). Con 'despacho' no sale nada a Ventas ni a Verificaciones: los pedidos se responden en
   *  /clientes/altas y el aviso de Skool queda "a mano". */
  canal?: () => CanalAlta
  /** Aviso (Discord) de un pedido que se responde en el Despacho: porque el canal es 'despacho' o porque WhatsApp no está
   *  disponible (la guardia de salud lo frenó). Uno por espera. Nunca frena al motor. */
  avisarEspera?: (d: { alta: FilaAlta; espera: Espera; motivo: 'despacho' | 'sin_whatsapp' }) => Promise<void>
}

/** Opciones internas de avanzar (la ruta del motor). */
export interface OpcionesAvanzar {
  hasta: number
  invocacion: string
  cadena?: number
  noAntesDe?: string
  forzarPaso?: PasoId
  rehacerEnReal?: boolean
  manual?: { esperaId: string; texto: string; por: string }
  /** Despacho (26/10/2026): comunidad, bienvenida o Skool hechos a mano (con el número del bot caído). */
  aMano?: { paso: PasoId; por: string }
}

export interface MotorAltasO extends MotorAltas {
  avanzar(altaId: string, op: OpcionesAvanzar): Promise<ResumenProceso>
  responder(altaId: string, r: { esperaId: string; texto: string; por: string }, op: { hasta: number; invocacion: string }): Promise<ResumenProceso>
  /** Despacho: cierra a mano la comunidad, la bienvenida o el aviso de Skool (PASOS_A_MANO) y sigue con lo que falte. */
  hechoAMano(altaId: string, paso: PasoId, por: string, op: { hasta: number; invocacion: string }): Promise<ResumenProceso>
}

const CAPACIDAD: Record<PasoId, Capacidad | null> = {
  validar: null, finanzas: 'finanzas', crm: 'crm', drive: 'drive', comunidad: 'comunidad', bienvenida: 'bienvenida', skool: 'mensajes_equipo', contrato: 'contrato',
}
const EJECUTOR: Record<PasoId, (ctx: CtxPaso) => Promise<SalidaPaso>> = {
  validar: pasoValidar, finanzas: pasoFinanzas, crm: pasoCrm, drive: pasoDrive, comunidad: pasoComunidad, bienvenida: pasoBienvenida, skool: pasoSkool, contrato: pasoContrato,
}
const MAX_ESLABONES_HORA = 8
const VENTANA_CORRECCION_RECHAZO_MS = 7 * 86_400_000
/** Una espera vencida (14 días) se puede retomar citando el pedido durante 30 días más (revisión del 24/10). */
const VENTANA_REAPERTURA_VENCIDA_MS = 30 * 86_400_000
/** Un evento que no se pudo aplicar queda 'nuevo' y se reintenta; después de una hora se descarta con aviso. */
const REINTENTO_EVENTO_MS = 3600_000
/** Un comprobante suelto o datos sin citar buscan el alta que los espera hasta 15 días atrás (la espera vence a los 14). */
const BUSQUEDA_ESPERA_MS = 15 * 86_400_000
/** Un adjunto suelto espera este tiempo a que lo reclame el #ALTA que suele llegar enseguida (reclamarAdjuntos). */
const VENTANA_ADJUNTO_MS = 15 * 60_000
/** El recurso 'crm' se toma por la duración máxima de la función: escribirAltaCrm no tiene tope propio y Sheets no tiene
 *  compare-and-set (revisión del 24/10, ronda 2: con 90 s otra instancia podía tomarlo y elegir la misma fila). */
const TTL_RECURSO_CRM_MS = 300_000
/** El barrido purga los mensajes viejos como mucho una vez por día (revisión del 24/10, ronda 2). */
const INTERVALO_PURGA_MS = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const vacio = (): ResumenProceso => ({ altas: [], continuaciones: 0, errores: [], registro: [] })
const sumar = (a: ResumenProceso, b: ResumenProceso) => {
  for (const x of b.altas) if (!a.altas.includes(x)) a.altas.push(x)
  a.continuaciones += b.continuaciones; a.errores.push(...b.errores); a.registro.push(...b.registro)
}
const motivoDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
const tipoErrorWhapi = (e: unknown) => ((e as { name?: string })?.name === 'ErrorWhapi' ? ((e as { tipo?: string }).tipo ?? null) : null)
const huellaTexto = (t: string) => sha256(textoNormalizado(t))
const conSinCitar = (m: RefMedio): RefMedio => ({ ...m, sinCitar: true })

/** Resumen corto para el reporte del ensayo (Tomás, 25/10/2026). */
const NOMBRE_PASO: Partial<Record<string, string>> = { finanzas: 'Finanzas', crm: 'CRM', drive: 'Drive', comunidad: 'comunidad', bienvenida: 'bienvenida', skool: 'Skool', contrato: 'contrato' }
function resumenEnsayo(alta: FilaAlta, pasos: FilaPaso[]) {
  const ex = alta.validacion?.comparacion?.extras ?? {}
  const partes: string[] = []
  if (typeof ex.pesosArs === 'number') partes.push(`$${ex.pesosArs.toLocaleString('es-AR')}`)
  if (ex.fechaPago) partes.push(`del ${ex.fechaPago.split('-').reverse().slice(0, 2).join('/')}`)
  if (ex.destinatario) partes.push(`a ${ex.destinatario}`)
  const leido = alta.validacion?.comparacion && alta.validacion.comparacion.resultado !== 'sin_lectura'
  const comprobante = partes.length ? partes.join(' ') : leido ? 'leído' : null
  const ok = (r: unknown) => !(r && typeof r === 'object' && (r as { ok?: unknown }).ok === false)
  const listos = pasos.filter((p) => NOMBRE_PASO[p.paso] && p.estado === 'simulado' && ok(p.resultado)).map((p) => NOMBRE_PASO[p.paso]!)
  const abiertas = alta.esperas.filter((e) => e.estado === 'abierta' || e.estado === 'simulada')
  const pediriaAlCloser = [...new Set(abiertas.filter((e) => e.quien === 'closer').flatMap((e) => e.pedido))]
  const pediriaOk = [...new Set(abiertas.filter((e) => e.quien !== 'closer').flatMap((e) => e.pedido))]
  let closer: string | null = null
  try { closer = altaParseada(alta).closer ?? null } catch { /* sin closer */ }
  return { nombre: alta.validacion?.nombreConfirmado ?? alta.nombreCliente, closer, comprobante, listos, pediriaAlCloser, pediriaOk }
}

const nombreDeFila = (x: FilaAlta) => x.validacion?.nombreConfirmado ?? x.nombreCliente
/** Un Fee: ya cargado ('fee') o validado como Fee y esperando un OK. */
const esFee = (x: FilaAlta) => x.estado === 'fee' || x.validacion?.estadoPlan === 'fee'
const RE_OK = /^\s*ok\b[\s.!,:-]*([\s\S]*)$/i
const RE_NO = /^\s*no\b[\s.!,:-]*([\s\S]*)$/i
export function veredictoDe(texto: string): Veredicto | null {
  const ok = RE_OK.exec(texto); if (ok) return { tipo: 'ok', resto: ok[1].trim() }
  const no = RE_NO.exec(texto); if (no) return { tipo: 'no', motivo: no[1].trim() }
  return null
}
const soloDigitos = (s: string) => s.replace(/\D/g, '')
/** ¿El autor está en la lista? (teléfono por los últimos 10 dígitos, o el lid exacto). */
export function enLista(autor: { telefono: string | null; lid: string | null }, lista: readonly string[]): boolean {
  return lista.some((x) => {
    const t = x.trim()
    if (!t) return false
    if (t.includes('@')) return !!autor.lid && autor.lid === t
    const d = soloDigitos(t)
    return !!autor.telefono && d.length >= 8 && soloDigitos(autor.telefono).slice(-10) === d.slice(-10)
  })
}

interface Efectivo { modo: ModoMotor; capacidades: Set<Capacidad>; pausada: boolean; pausados: Set<PasoId> }

/** Estado de trabajo de un alta durante avanzar (con el candado). */
interface Estado {
  alta: FilaAlta
  dueno: string
  ef: Efectivo
  avisos: string[]
  registro: string[]
  continuar: boolean
  despertar: string | null
  resumen: ResumenProceso
}

export function crearOrquestador(deps: DepsOrquestador): MotorAltasO {
  const { almacen, whapi, grupos } = deps
  const ahora = deps.ahora ?? Date.now
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const log: LogMotor = deps.log ?? { info: (m) => console.info(m), warn: (m) => console.warn(m), error: (m) => console.error(m) }

  // ── Modo efectivo (punto 27) ──
  function efectivo(alta: Pick<FilaAlta, 'modo' | 'capacidades'>): Efectivo {
    const modo = menorModo(alta.modo, deps.modo)
    const deAlta = new Set(alta.capacidades)
    const capacidades = new Set<Capacidad>([...deAlta].filter((c) => deps.capacidades.has(c) && (modo === 'real' || (modo === 'ensayo' && c === 'reporte_verificaciones'))))
    const pausados = new Set<PasoId>(PASOS.filter((p) => { const c = CAPACIDAD[p]; return modo === 'real' && c !== null && deAlta.has(c) && !deps.capacidades.has(c) }))
    return { modo, capacidades, pausada: modoMenorQue(deps.modo, alta.modo), pausados }
  }

  // ── Mensajes salientes (sección 3.8): anotar → mandar → confirmar ──
  async function enviar(st: Pick<Estado, 'alta' | 'ef' | 'registro'>, m: EnvioSolicitado & { reporte?: boolean }): Promise<ResultadoEnvio> {
    const { ef } = st
    const destinoTxt = 'grupo' in m.destino ? (m.destino.grupo === 'ventas' ? 'al closer en Ventas' : 'en Verificaciones') : 'al grupo del cliente'
    const permitido = m.reporte
      ? ef.modo === 'ensayo' && ef.capacidades.has('reporte_verificaciones')
      : ef.modo === 'real' && ('grupo' in m.destino
        ? (m.destino.grupo === 'ventas' ? ef.capacidades.has('mensajes_equipo') : ef.capacidades.has('mensajes_equipo') || ef.capacidades.has('reporte_verificaciones'))
        : ef.capacidades.has('bienvenida'))
    if (!permitido) {
      st.registro.push(`mandaría ${destinoTxt}: ${recortar((m.texto || m.url || '').replace(/\s+/g, ' '), 140)}`)
      return { estado: 'simulado', id: null }
    }
    // Canal Despacho (BOT_ALTA_CANAL=despacho): a Ventas y a Verificaciones no sale nada; los pedidos se responden en
    // /clientes/altas. El aviso de Skool queda en reintento ("a mano" en la pantalla) hasta que alguien lo marque hecho.
    if ('grupo' in m.destino && !m.reporte && canal() === 'despacho') {
      st.registro.push(`no sale ${destinoTxt} (canal Despacho): ${recortar((m.texto || '').replace(/\s+/g, ' '), 100)}`)
      if (m.proposito === 'skool:aviso') return { estado: 'pausado', id: null, motivo: MOTIVO_CANAL_DESPACHO }
      return { estado: 'simulado', id: null }
    }
    const pausa = await almacen.leerRecurso('whapi_pausa')
    if (pausa?.datos && typeof pausa.datos.hasta === 'string' && Date.parse(pausa.datos.hasta) > ahora()) return { estado: 'pausado', id: null }
    const chatId = 'grupo' in m.destino ? grupos[m.destino.grupo] : m.destino.chatId
    const texto = m.reporte ? conPrefijoEnsayo(m.texto) : m.texto
    // Huella del texto (o del pie: un video sin pie tiene huella de texto vacío, igual que su eco, que llega sin texto)
    const huella = huellaTexto(texto)
    const conRepetido = `${texto}\n(repetido)`
    // Si hay que reenviarlo con "(repetido)", el saliente pasa a tener la huella de la copia (si no, su eco nunca empareja y
    // el bot no conoce su id: revisión del 24/10, ronda 2)
    const estado = await almacen.anotarSaliente({
      altaId: st.alta.id, proposito: m.proposito, chatId, esperaId: m.esperaId ?? null, huella, ...(m.dudosoSiCortado ? {} : { huellaSiRepite: huellaTexto(conRepetido) }),
    })
    if (estado === 'enviado') return { estado: 'ya_enviado', id: null }
    if (estado === 'simulado') return { estado: 'simulado', id: null }
    let cuerpo = texto
    if (estado === 'enviando' || estado === 'dudoso') {
      // Un envío anterior se cortó en el medio o quedó sin confirmar (5xx, 524, corte) y su eco no llegó. Al cliente no se le
      // reenvía solo (bienvenida: dudosoSiCortado). A un grupo del equipo sí, marcado (revisión del 24/10: antes un pedido o
      // el aviso de Skool que volvía dudoso no salía nunca más y el alta quedaba trabada sin que nadie se enterara).
      if (m.dudosoSiCortado) return { estado: 'dudoso', id: null, tipo: 'dudoso', motivo: estado === 'dudoso' ? 'un envío anterior quedó sin confirmar' : 'un envío anterior se cortó en el medio' }
      cuerpo = conRepetido
    }
    let r: { id: string | null; simulado: boolean }
    try {
      r = m.tipo === 'video'
        ? await whapi.enviarVideo({ chatId, url: m.url ?? '', pie: cuerpo || null, citar: m.citar ?? null, ...(m.hasta ? { hasta: m.hasta } : {}) })
        : await whapi.enviarTexto({ chatId, texto: cuerpo, citar: m.citar ?? null, menciones: m.menciones ?? [] })
    } catch (e) {
      const t = tipoErrorWhapi(e)
      if (t === 'bloqueado') { await confirmar(st, m.proposito, null, 'simulado'); return { estado: 'simulado', id: null } }
      if (t === 'soft_ban') await almacen.guardarDatosRecurso('whapi_pausa', { hasta: iso(ahora() + 24 * 3600_000), por: st.alta.id }).catch(() => {})
      // WhatsApp seguro: la guardia frenó el envío antes de salir (número caído o suspendido). Queda 'fallido' (así el próximo
      // intento lo manda como nuevo, sin "(repetido)") y el paso que lo pidió pasa a reintento con el motivo
      if (t === 'sin_numero') {
        await confirmar(st, m.proposito, null, 'fallido')
        st.registro.push(`"${m.proposito}" no salió: ${MOTIVO_SIN_NUMERO}`)
        return { estado: 'pausado', id: null, motivo: MOTIVO_SIN_NUMERO }
      }
      const c = await confirmar(st, m.proposito, null, t === 'dudoso' ? 'dudoso' : 'fallido')
      // El eco llegó (y se procesó) antes que el error: el mensaje salió (revisión del 24/10, ronda 2: el error lo pisaba)
      if (c?.estado === 'enviado') { st.registro.push(`"${m.proposito}" volvió con error, pero su eco ya había confirmado el envío`); return { estado: 'enviado', id: c.whapiId } }
      if (t === 'dudoso') return { estado: 'dudoso', id: null, tipo: t, motivo: motivoDe(e) }
      log.warn(`bot-alta: ${st.alta.id} — no salió "${m.proposito}" (${t ?? 'error'})`)
      return { estado: 'error', id: null, tipo: (t as never) ?? null, motivo: motivoDe(e) }
    }
    // Whapi lo mandó: queda 'enviado' aunque falle la escritura en Neon (revisión del 24/10, ronda 2: el catch de antes lo
    // trataba como un error de Whapi, lo marcaba 'fallido' y el mensaje salía dos veces sin "(repetido)")
    await confirmar(st, m.proposito, r.id, r.simulado ? 'simulado' : 'enviado')
    if (r.simulado) { st.registro.push(`mandaría ${destinoTxt} (la compuerta lo frenó): ${recortar(cuerpo.replace(/\s+/g, ' '), 100)}`); return { estado: 'simulado', id: null } }
    return { estado: 'enviado', id: r.id }
  }

  /** confirmarSaliente con reintentos (0, 1 y 2 s). Si Neon sigue sin responder, el saliente queda 'enviando': lo confirma el
   *  eco, o el próximo envío del mismo propósito sale con "(repetido)". Nunca tira. */
  async function confirmar(st: Pick<Estado, 'alta'>, proposito: string, whapiId: string | null, estado: 'enviado' | 'simulado' | 'dudoso' | 'fallido') {
    for (const ms of [0, 1000, 2000]) {
      if (ms) await dormir(ms)
      try { return await almacen.confirmarSaliente({ altaId: st.alta.id, proposito, whapiId, estado }) } catch { /* reintento */ }
    }
    log.error(`bot-alta: ${st.alta.id} — no se pudo guardar el estado "${estado}" del envío "${proposito}": queda 'enviando'`)
    return null
  }

  const canal = (): CanalAlta => { try { return deps.canal?.() ?? 'whatsapp' } catch { return 'whatsapp' } }
  const citaAlta = (alta: FilaAlta) => alta.mensajesAlta[alta.mensajesAlta.length - 1] ?? alta.mensajeAltaId
  const nombreDe = (alta: FilaAlta) => alta.validacion?.nombreConfirmado ?? alta.nombreCliente

  /** Respuesta corta (al closer o en Verificaciones) citando un mensaje. */
  async function contestar(st: Pick<Estado, 'alta' | 'ef' | 'registro'>, grupo: 'ventas' | 'verificaciones', proposito: string, texto: string, citar: string | null) {
    await enviar(st, { proposito, destino: { grupo }, tipo: 'texto', texto, citar })
  }

  // ── Guardar con reintentos (sección 3.4: si Neon falla, 1, 2 y 4 s; después, log con ids y el paso queda corriendo) ──
  async function guardarPaso(alta: FilaAlta, paso: PasoId, iniciado: string, cambios: Parameters<AlmacenAltas['guardarPaso']>[3]): Promise<boolean> {
    const esperas = [0, 1000, 2000, 4000]
    for (const ms of esperas) {
      if (ms) await dormir(ms)
      try {
        if (await almacen.guardarPaso(alta.id, paso, iniciado, cambios)) return true
        return false   // otro guardó (CAS): no se pisa
      } catch { /* reintento */ }
    }
    log.error(`bot-alta: ${alta.id} — no se pudo guardar el resultado del paso ${paso} (iniciado ${iniciado}, estado ${cambios.estado}): queda 'corriendo' y la corrida siguiente lo trata como dudoso`)
    return false
  }

  async function actualizar(st: Estado, cambios: CambiosAlta): Promise<void> {
    const ok = await almacen.actualizarAlta(st.alta.id, st.dueno, cambios)
    if (!ok) throw new Error('se perdió el candado del alta')
    st.alta = { ...st.alta, ...cambios } as FilaAlta
  }

  // ── Esperas (varias por alta, con id de ronda y todos los mensajes citables: puntos 9 y 10) ──
  function abrirEsperas(st: Estado, paso: PasoId, nuevas: EsperaNueva[], simulada: boolean): Espera[] {
    const esperas = st.alta.esperas.map((e) => ({ ...e }))
    const abiertas: Espera[] = []
    for (const n of nuevas) {
      const igual = esperas.find((e) => e.estado === 'abierta' && e.paso === paso && e.motivo === n.motivo && e.grupo === n.grupo && JSON.stringify(e.pedido) === JSON.stringify(n.pedido))
      if (igual && !simulada) { abiertas.push(igual); continue }
      const id = `${paso}-${esperas.filter((e) => e.paso === paso).length + 1}`
      const nueva: Espera = {
        id, paso, motivo: n.motivo, tipos: n.tipos, grupo: n.grupo, quien: n.quien, mensajes: [], pedido: n.pedido, requiere: n.requiere,
        estado: simulada ? 'simulada' : 'abierta', desde: iso(ahora()), recordatorios: 0, ultimoRecordatorio: null, respuesta: null,
        datos: { ...(n.datos ?? {}), texto: n.texto },
      }
      esperas.push(nueva)
      if (!simulada) abiertas.push(nueva)
    }
    // Las abiertas del mismo paso que no volvieron a pedirse quedan superadas
    for (const e of esperas) if (e.paso === paso && e.estado === 'abierta' && !abiertas.includes(e)) e.estado = 'superada'
    return esperas
  }

  /** ¿Hay que (volver a) mandar el pedido de esta espera ahora? */
  const pedidoPendiente = (e: Espera) => e.estado === 'abierta' && !e.mensajes.length && !e.enviado && (!e.proximoEnvio || Date.parse(e.proximoEnvio) <= ahora())

  /** Manda el pedido de una espera. Revisión del 24/10: si salió sin id (Whapi lo deja opcional) queda `enviado` igual, así
   *  corren los recordatorios (el id lo trae el eco); si volvió dudoso, con error o en pausa, se reintenta con espera
   *  creciente (5 min, 30 min, 2 h, 6 h…) en vez de quedar sin pedido hasta que la espera vence. */
  async function enviarPedido(st: Estado, e: Espera): Promise<void> {
    const texto = String(e.datos?.texto ?? e.pedido.join('\n'))
    const r = await enviar(st, { proposito: `espera:${e.id}`, destino: { grupo: e.grupo }, tipo: 'texto', texto, citar: e.grupo === 'ventas' ? citaAlta(st.alta) : null, esperaId: e.id })
    await avisarDespacho(st, e, r)
    const actual = st.alta.esperas.find((x) => x.id === e.id) ?? e
    if (r.estado === 'enviado' || r.estado === 'ya_enviado' || r.estado === 'simulado') {
      const conId = r.estado === 'enviado' && r.id && !actual.mensajes.includes(r.id) ? { mensajes: [...actual.mensajes, r.id] } : {}
      await marcarEspera(st, e.id, { enviado: actual.enviado ?? iso(ahora()), proximoEnvio: null, ...conId })
      return
    }
    const n = (actual.intentosEnvio ?? 0) + 1
    await marcarEspera(st, e.id, { intentosEnvio: n, proximoEnvio: iso(ahora() + esperaReenvio(n)) })
    st.registro.push(`el pedido ${e.id} no salió (${r.estado}): se vuelve a intentar`)
  }

  /** Despacho (26/10/2026): el pedido se responde en /clientes/altas. Aviso a Discord UNA vez por espera, si el canal es
   *  'despacho' o si WhatsApp no está disponible (la guardia de salud lo frenó, o el número no tiene token / se cayó la
   *  sesión). Con el canal 'whatsapp' no se avisa (lo hace la guardia, una vez, a Tomás). */
  async function avisarDespacho(st: Estado, e: Espera, r: ResultadoEnvio): Promise<void> {
    if (!deps.avisarEspera || st.ef.modo !== 'real') return
    const c = canal()
    if (c === 'whatsapp') return
    const sinWhatsapp = (r.estado === 'pausado' && r.motivo === MOTIVO_SIN_NUMERO) || (r.estado === 'error' && ['sin_numero', 'auth', 'config'].includes(r.tipo ?? ''))
    const motivo = c === 'despacho' ? 'despacho' as const : sinWhatsapp ? 'sin_whatsapp' as const : null
    if (!motivo) return
    const actual = st.alta.esperas.find((x) => x.id === e.id) ?? e
    if (actual.avisoDespacho) return
    try {
      await deps.avisarEspera({ alta: st.alta, espera: actual, motivo })
      await marcarEspera(st, e.id, { avisoDespacho: iso(ahora()) })
      st.registro.push(`aviso a Discord: el pedido ${e.id} se responde en el Despacho (${motivo === 'despacho' ? 'canal Despacho' : 'WhatsApp no disponible'})`)
    } catch (x) {
      log.warn(`bot-alta: ${st.alta.id} — no salió el aviso a Discord del pedido ${e.id}: ${motivoDe(x)}`)
    }
  }

  async function fijar(st: Estado, paso: PasoId, cambios: Parameters<AlmacenAltas['fijarPaso']>[3]) {
    if (!(await almacen.fijarPaso(st.alta.id, paso, st.dueno, cambios))) throw new Error('se perdió el candado del alta')
  }

  // ── Correr un paso ──
  async function correrPaso(st: Estado, accion: Extract<Accion, { tipo: 'correr' }>, pasos: Record<PasoId, FilaPaso>): Promise<void> {
    const { paso } = accion
    const cap = CAPACIDAD[paso]
    const real = st.ef.modo === 'real' && (cap === null || st.ef.capacidades.has(cap))
    const previo = pasos[paso]
    const huboCorriendo = previo.estado === 'corriendo' || previo.dudoso
    let recurso: string | null = null
    if (real && (paso === 'finanzas' || paso === 'crm')) {
      if (!(await almacen.tomarRecurso(paso, st.dueno, paso === 'finanzas' ? 200_000 : TTL_RECURSO_CRM_MS))) {
        await fijar(st, paso, { estado: 'reintento', noAntesDe: iso(ahora() + 60_000), error: `${paso} ocupado por otra alta`, dudoso: huboCorriendo })
        return
      }
      recurso = paso
    }
    let salida: SalidaPaso
    const iniciado = await almacen.marcarCorriendo(st.alta.id, paso, st.dueno)
    if (!iniciado) { if (recurso) await almacen.soltarRecurso(recurso, st.dueno); throw new Error('se perdió el candado del alta') }
    try {
      const anterior = st.alta.altaAnterior ? await almacen.leerAlta(st.alta.altaAnterior) : null
      const ctx: CtxPaso = {
        alta: st.alta, paso: { ...previo, estado: 'corriendo', iniciado }, pasos, modo: st.ef.modo, real, capacidades: st.ef.capacidades, huboCorriendo,
        iniciadoAnterior: previo.estado === 'corriendo' ? previo.iniciado : null,
        ahora, hasta: accion.hasta, deps: deps.pasos, whapi, grupos, almacen, dueno: st.dueno, anteriorUsd: anterior ? usdAcumuladoDe(anterior) : null, anterior,
        enviar: (m) => enviar(st, m),
        guardarParcial: (p) => almacen.guardarParcial(st.alta.id, paso, p),
      }
      salida = await EJECUTOR[paso](ctx)
    } catch (e) {
      log.error(`bot-alta: ${st.alta.id} — el paso ${paso} tiró: ${motivoDe(e)}`)
      salida = { estado: 'reintento', noAntesDe: iso(ahora() + 300_000), error: motivoDe(e), dudoso: huboCorriendo || paso !== 'validar' }
    } finally {
      if (recurso) await almacen.soltarRecurso(recurso, st.dueno)
    }
    await aplicarSalida(st, paso, iniciado, salida, huboCorriendo)
  }

  async function aplicarSalida(st: Estado, paso: PasoId, iniciado: string, s: SalidaPaso, huboCorriendo: boolean): Promise<void> {
    const simulada = st.ef.modo !== 'real'
    // 1. Esperas + cambios del alta
    const esperas = abrirEsperas(st, paso, s.esperas ?? [], simulada)
    const cambios: CambiosAlta = { ...(s.cambiosAlta ?? {}), esperas }
    if (s.terminarAlta) cambios.estado = s.terminarAlta
    await actualizar(st, cambios)
    // 2. El resultado del paso (CAS sobre iniciado)
    const terminado = ['hecho', 'omitido', 'simulado'].includes(s.estado)
    await guardarPaso(st.alta, paso, iniciado, {
      estado: s.estado, ...(s.resultado !== undefined ? { resultado: s.resultado } : {}), noAntesDe: s.noAntesDe ?? null, error: s.error ?? null,
      dudoso: s.dudoso ?? (terminado ? false : huboCorriendo), ...(s.parcial !== undefined ? { parcial: s.parcial } : {}),
    })
    // 3. Avisos, registro y mensajes
    st.avisos.push(...(s.avisos ?? []))
    st.registro.push(...(s.registro ?? []).map((x) => `${paso}: ${x}`))
    if (!simulada) for (const e of st.alta.esperas) if (e.paso === paso && pedidoPendiente(e)) await enviarPedido(st, e)
    for (const m of s.mensajes ?? []) {
      if (m.destino === 'general_cliente') continue
      await enviar(st, { proposito: m.proposito, destino: { grupo: m.destino }, tipo: 'texto', texto: m.texto, citar: m.citarAlta ? citaAlta(st.alta) : null, menciones: m.menciones })
    }
    if (s.otraInvocacion) st.continuar = true
    // El segundo pago que completa un Fee arrancó el alta: el Fee queda reemplazado
    if (paso === 'validar' && s.estado === 'hecho' && st.alta.altaAnterior && st.alta.validacion?.estadoPlan === 'lista') {
      await almacen.actualizarSiEstado(st.alta.altaAnterior, ['fee'], { estado: 'reemplazada', reemplazadaPor: st.alta.id })
    }
  }

  // ── Respuestas humanas ──
  function autorizado(autor: EventoRespuesta['autor'], quien: Quien, alta: FilaAlta, citado: boolean): boolean {
    if (quien === 'closer') return citado || mismoAutor(autor, alta.autor)
    const ap = deps.pasos.aprobadores, op = deps.pasos.operaciones
    if (quien === 'aprobadores') return enLista(autor, ap)
    if (quien === 'operaciones') return enLista(autor, op)
    return enLista(autor, [...ap, ...op])
  }

  async function reabrirValidar(st: Estado, v: Validacion) {
    await actualizar(st, { validacion: v })
    await fijar(st, 'validar', { estado: 'pendiente', error: null })
  }

  /** Paso a revisar con su espera ok_revisar (desde una respuesta). */
  async function aRevisar(st: Estado, paso: PasoId, motivo: string) {
    const esperas = abrirEsperas(st, paso, [{
      paso, motivo: 'revisar', tipos: ['ok_revisar'], grupo: 'verificaciones', quien: 'equipo', requiere: [], pedido: [`${paso}: ${motivo}`],
      texto: textoPedidoEquipo({ nombre: nombreDe(st.alta), titulo: `el paso "${paso}" quedó frenado.`, detalle: [motivo], ok: 'seguí (ya está resuelto)', no: 'dejarlo sin hacer' }),
    }], st.ef.modo !== 'real')
    await actualizar(st, { esperas })
    await fijar(st, paso, { estado: 'revisar', error: motivo })
    for (const e of st.alta.esperas) if (e.paso === paso && pedidoPendiente(e) && st.ef.modo === 'real') await enviarPedido(st, e)
  }

  async function marcarEspera(st: Estado, id: string, cambios: Partial<Espera>) {
    await actualizar(st, { esperas: st.alta.esperas.map((e) => (e.id === id ? { ...e, ...cambios } : e)) })
  }

  async function rechazar(st: Estado, e: Espera, motivo: string, por: string, clave: string | null) {
    const pasos = await almacen.leerPasos(st.alta.id)
    const respuesta = { veredicto: 'no' as const, resto: motivo, por, en: iso(ahora()), ...(clave ? { clave } : {}) }
    if (!algoEscritoAfuera(pasos, st.alta.esperas.filter((x) => x.id !== e.id))) {
      await marcarEspera(st, e.id, { estado: 'rechazada', respuesta })
      await actualizar(st, { estado: 'rechazada', proximoIntento: null })
      await contestar(st, 'ventas', `rechazo:${e.id}`, textoRechazoCloser(nombreDe(st.alta), motivo || '(sin motivo)'), citaAlta(st.alta))
      st.registro.push(`rechazada en Verificaciones (${e.id})`)
      return
    }
    // Ya se escribió algo afuera: el paso queda a revisar, nunca el alta rechazada (punto 18)
    await marcarEspera(st, e.id, { estado: 'resuelta', respuesta })
    await aRevisar(st, e.paso, `respondieron NO: ${motivo || '(sin motivo)'}`)
  }

  /** NO a una confirmación (alta libre, Fee o pago de un cliente existente): queda 'rechazada' (un OK citado dentro de los 7 días la retoma, como cualquier rechazo) y
   *  no se le escribe al closer. Si ya se escribió algo afuera (no debería: nada corre sin el OK), el paso queda a revisar. */
  async function descartarAltaLibre(st: Estado, e: Espera, motivo: string, por: string, clave: string | null) {
    const pasos = await almacen.leerPasos(st.alta.id)
    const respuesta = { veredicto: 'no' as const, resto: motivo, por, en: iso(ahora()), ...(clave ? { clave } : {}) }
    if (algoEscritoAfuera(pasos, st.alta.esperas.filter((x) => x.id !== e.id))) {
      await marcarEspera(st, e.id, { estado: 'resuelta', respuesta })
      return aRevisar(st, e.paso, `respondieron NO: ${motivo || '(sin motivo)'}`)
    }
    await marcarEspera(st, e.id, { estado: 'rechazada', respuesta })
    await actualizar(st, { estado: 'rechazada', proximoIntento: null, notas: [...new Set([...st.alta.notas, 'descartada en Verificaciones (NO a la confirmación)'])] })
    st.registro.push(`descartada en Verificaciones: NO a la confirmación (${e.id})`)
  }

  /** `clave`: el evento que responde (queda en la respuesta: si la corrida tira a la mitad, el mismo evento se reaplica). */
  async function resolverEspera(st: Estado, e: Espera, ver: Veredicto, por: string, citado: string | null, clave: string | null): Promise<void> {
    const v: Validacion = JSON.parse(JSON.stringify(st.alta.validacion ?? validacionVacia()))
    const resto = ver.tipo === 'ok' ? ver.resto : ver.motivo
    const respuesta = { veredicto: ver.tipo, resto, por, en: iso(ahora()), ...(clave ? { clave } : {}) }
    const pasos = await almacen.leerPasos(st.alta.id)
    const parcial = (p: PasoId) => pasos[p].parcial ?? {}
    if (ver.tipo === 'no' && ['validar', 'nombre'].includes(e.motivo)) return rechazar(st, e, ver.motivo, por, clave)
    const resuelta = () => marcarEspera(st, e.id, { estado: 'resuelta', respuesta })
    // La aprobación de esta espera reemplaza a una anterior de la misma espera (reaplicar el mismo evento no la duplica)
    const aprobar = (r: string) => { v.aprobaciones = [...v.aprobaciones.filter((x) => x.espera !== e.id), { tipos: e.tipos, por, en: respuesta.en, resto: r, espera: e.id }] }
    const noEntendido = () => contestar(st, 'verificaciones', `nombre?:${e.id}:${clave ?? ahora()}`, TEXTO_NOMBRE_NO_ENTENDIDO, citado)
    switch (e.motivo as MotivoEspera) {
      case 'confirmacion': {
        // Reglas del 26/10/2026 (#ALTA y formato libre): NO = no se hace nada, el alta se descarta y no se vuelve a preguntar
        // por ese mensaje (sin escribirle al closer). OK = sigue: un alta libre como un #ALTA; si la pregunta era la del Fee,
        // aprueba Finanzas y la comunidad (regla B); la de un cliente existente, solo Finanzas (regla A).
        if (ver.tipo === 'no') return descartarAltaLibre(st, e, resto, por, clave)
        v.confirmacion = { ...(v.confirmacion ?? {}), ok: true, ...(e.datos?.fee ? { okFee: true } : {}) }
        aprobar(resto)
        await resuelta()
        st.registro.push(`confirmada en Verificaciones (${e.id})`)
        return reabrirValidar(st, v)
      }
      case 'fee_suma':
        if (ver.tipo === 'no') {
          // NO a la suma con el Fee: este pago sigue como Fee (se carga en Finanzas) y el alta espera otro pago. No se
          // rechaza (revisión del 24/10: el NO rechazaba el alta y un pago ya cobrado no entraba nunca en Finanzas)
          v.noFeeSuma = true; v.okFeeSuma = false
          // El NO ya dice "que siga como Fee": vale como el OK del Fee (Finanzas + comunidad), no se pregunta otra vez
          v.confirmacion = { ...(v.confirmacion ?? {}), ok: true, okFee: true }
          aprobar(`NO: ${resto}`)
          await resuelta()
          st.registro.push('NO a la suma con el Fee: sigue como Fee')
          return reabrirValidar(st, v)
        }
      // falls through
      case 'validar': {
        const r = leerRestoOk(resto)
        if (e.requiere.includes('cuenta') && !r.cuenta) return void contestar(st, 'verificaciones', `faltacuenta:${e.id}:${e.mensajes.length}`, textoFaltaCuenta, citado)
        if (e.requiere.includes('mep') && !r.mep) return void contestar(st, 'verificaciones', `faltamep:${e.id}:${e.mensajes.length}`, textoFaltaMep, citado)
        const fuenteOk = e.requiere.includes('fuente') ? fuenteAOpcion(resto) : null
        if (e.requiere.includes('fuente') && !fuenteOk) return void contestar(st, 'verificaciones', `faltafuente:${e.id}:${e.mensajes.length}`, textoFaltaFuente, citado)
        const d = e.datos ?? {}
        if (d.comprobante) v.okComprobante = true
        if (Array.isArray(d.revision)) v.okRevision = [...new Set([...v.okRevision, ...(d.revision as string[])])]
        if (d.feeSuma) { v.okFeeSuma = true; v.noFeeSuma = false }
        if (d.renovacion) v.okRenovacion = true
        if (e.requiere.includes('cuenta') && r.cuenta) { v.cuenta = r.cuenta; v.origenCuenta = 'aprobadores' }
        if (fuenteOk) { v.fuente = fuenteOk; v.origenFuente = 'aprobadores' }
        if (e.requiere.includes('mep') && r.mep) v.mep = { venta: r.mep, fechaCotizacion: 'manual', diaAnterior: fechaDiaAnterior(st.alta.fechaPago ?? '') ?? '' }
        aprobar(resto)
        await resuelta()
        return reabrirValidar(st, v)
      }
      case 'nombre': {
        // "OK" solo (o con relleno) deja el del #ALTA; "OK Nombre Apellido" lo cambia; otra cosa se pregunta de nuevo
        const n = nombreDeResto(resto)
        if (n.tipo === 'no_entendido') return void noEntendido()
        v.nombreConfirmado = n.tipo === 'nombre' ? n.nombre : parsearAlta(st.alta.textoVigente).nombre
        await resuelta()
        return reabrirValidar(st, v)
      }
      case 'correccion': {
        await resuelta()
        if (ver.tipo === 'ok') {
          const texto = String(e.datos?.textoNuevo ?? st.alta.textoVigente)
          const a = parsearAlta(texto)
          await actualizar(st, { textoVigente: texto, nombreCliente: a.nombre, telefonoCliente: telefonoDelCliente(a)?.numero ?? st.alta.telefonoCliente })
          return reabrirValidar(st, v)
        }
        return aRevisar(st, 'validar', `NO a la corrección: ${resto || '(sin motivo)'}`)
      }
      case 'finanzas_repetido': {
        await resuelta()
        if (ver.tipo === 'ok') return fijar(st, 'finanzas', { estado: 'hecho', resultado: { ...(pasos.finanzas.resultado as object ?? {}), repetidoAceptado: true } })
        return aRevisar(st, 'finanzas', `NO: ${resto || '(sin motivo)'}`)
      }
      case 'finanzas_cambio': {
        await resuelta()
        if (ver.tipo === 'ok') return fijar(st, 'finanzas', { estado: 'pendiente', parcial: { aceptarCongelada: true } })
        return aRevisar(st, 'finanzas', `NO: ${resto || '(sin motivo)'}`)
      }
      case 'crm_duplicado': case 'crm_confirmar': {
        await resuelta()
        if (ver.tipo === 'ok') { st.avisos.push(`CRM de Clientes: ${e.motivo === 'crm_duplicado' ? 'no se creó otro cliente (ya estaba)' : 'quedó para cargar a mano'}.`); return fijar(st, 'crm', { estado: 'omitido' }) }
        return aRevisar(st, 'crm', `NO: ${resto || '(sin motivo)'}`)
      }
      case 'carpeta': case 'nombre_drive': {
        if (ver.tipo === 'no') { await resuelta(); return aRevisar(st, 'drive', `NO: ${resto || '(sin motivo)'}`) }
        // Mismo criterio que el nombre dudoso (revisión del 24/10: "OK, es la de ella" creaba una carpeta "es la de ella")
        const n = nombreDeResto(resto)
        if (n.tipo === 'no_entendido') return void noEntendido()
        await resuelta()
        if (n.tipo === 'nombre') return fijar(st, 'drive', { estado: 'pendiente', parcial: { nombreDrive: n.nombre, intentoCarpeta: null, guardado: {} } })
        if (e.motivo === 'nombre_drive') return fijar(st, 'drive', { estado: 'pendiente', parcial: { nombreDrive: nombreDe(st.alta) ?? parsearAlta(st.alta.textoVigente).nombre } })
        const g = guardadoAprobado(pasos.drive.resultado)
        if (!g) return aRevisar(st, 'drive', 'no se encontró el id de la carpeta que ya existía')
        return fijar(st, 'drive', { estado: 'pendiente', parcial: { guardado: g } })
      }
      case 'comunidad': {
        await resuelta()
        if (ver.tipo === 'ok') return fijar(st, 'comunidad', { estado: 'hecho', resultado: { ...(pasos.comunidad.resultado as object ?? {}), okAylu: { por, en: respuesta.en } } })
        return aRevisar(st, 'comunidad', `Aylu respondió NO: ${resto || '(sin motivo)'} (la bienvenida queda frenada)`)
      }
      case 'bienvenida': {
        await resuelta()
        if (ver.tipo === 'ok') return fijar(st, 'bienvenida', { estado: 'pendiente', parcial: { okAvisos: true } })
        st.avisos.push('La bienvenida no se manda: la manda Aylu a mano.')
        return fijar(st, 'bienvenida', { estado: 'omitido' })
      }
      case 'dudoso': {
        await resuelta()
        if (ver.tipo === 'ok') {
          // Comunidad: OK = "ya existe". El paso vuelve a correr: lo busca y sigue con lo que falte (otros grupos, fotos,
          // links y el OK de Aylu). Revisión del 24/10: antes el paso entero quedaba 'hecho' y se salteaba todo eso.
          if (e.paso === 'comunidad') {
            const g = /grupo (General|Ventas|Contenido)/.exec(String(e.datos?.que ?? ''))?.[1] ?? 'comunidad'
            const existe = { ...((parcial('comunidad').existeConfirmado as Record<string, boolean> | undefined) ?? {}), [g]: true }
            return fijar(st, 'comunidad', { estado: 'pendiente', dudoso: false, error: null, parcial: { existeConfirmado: existe } })
          }
          return fijar(st, e.paso, { estado: 'hecho', dudoso: false, resultado: { ...(pasos[e.paso].resultado as object ?? {}), confirmadoAMano: { por, en: respuesta.en } } })
        }
        // NO = rehacer
        if (e.paso === 'bienvenida') {
          // Solo lo que quedó dudoso (revisión del 24/10: si el video ya había salido, no se reenvía)
          const props = typeof e.datos?.proposito === 'string' ? [e.datos.proposito] : ['bienvenida:video', 'bienvenida:texto']
          for (const p of props) await almacen.confirmarSaliente({ altaId: st.alta.id, proposito: p, whapiId: null, estado: 'fallido', forzar: true })
          return fijar(st, 'bienvenida', { estado: 'pendiente', dudoso: false })
        }
        if (e.paso === 'comunidad') return fijar(st, 'comunidad', { estado: 'pendiente', dudoso: false, parcial: { intentoComunidad: null, intentoGrupo: {} } })
        return fijar(st, e.paso, { estado: 'pendiente', dudoso: false, parcial: { ...parcial(e.paso), documentoId: null } })
      }
      case 'revisar': {
        await resuelta()
        if (ver.tipo === 'ok') return fijar(st, e.paso, { estado: e.paso === 'validar' ? 'pendiente' : 'hecho', dudoso: false, resultado: { ...(pasos[e.paso].resultado as object ?? {}), resueltoAMano: { por, en: respuesta.en } } })
        return fijar(st, e.paso, { estado: 'omitido' })
      }
      default:
        return
    }
  }

  /** Corrección (un #ALTA que cita al anterior, uno con el mismo teléfono, una edición o datos que cambian algo). */
  async function aplicarCorreccion(st: Estado, textoNuevo: string, citar: string | null, clave: string) {
    // Un alta que ya terminó no toma correcciones (revisión del 24/10: se contestaba "Tomé la corrección" y no pasaba nada)
    if (esFinal(st.alta.estado)) {
      // Un alta libre descartada (NO en Verificaciones) no era un alta: su edición no se contesta
      if (esAltaLibreFila(st.alta) && st.alta.estado === 'rechazada') { st.registro.push('edición de un alta libre descartada: no se toma'); return }
      await contestar(st, 'ventas', `correccion:${clave}`, textoCorreccionFinal(nombreDe(st.alta), st.alta.estado), citar)
      st.registro.push(`corrección de un alta ${st.alta.estado}: no se toma`)
      return
    }
    // Sin cambios en el texto (un emoji, espacios, mayúsculas): no frena nada (revisión del 24/10: abría una espera de
    // "cambios de formato" que frenaba todos los pasos hasta un OK)
    if (textoNormalizado(textoNuevo) === textoNormalizado(st.alta.textoVigente)) { st.registro.push('corrección sin cambios en los datos: no se aplica'); return }
    const pasos = await almacen.leerPasos(st.alta.id)
    const anterior = parsearAlta(st.alta.textoVigente), nuevo = parsearAlta(textoNuevo)
    const campos: (keyof typeof nuevo)[] = ['nombre', 'correo', 'direccion', 'dni', 'cuit', 'inicio', 'estePagoUsd', 'pagoEnPesos', 'medioPago', 'totalUsd', 'modalidad', 'programa', 'contrato', 'closer', 'socios']
    const difs = campos.filter((k) => JSON.stringify(anterior[k]) !== JSON.stringify(nuevo[k])).map((k) => `${String(k)}: ${JSON.stringify(anterior[k])} → ${JSON.stringify(nuevo[k])}`)
    if (JSON.stringify(anterior.telefonos) !== JSON.stringify(nuevo.telefonos)) difs.push('teléfonos')
    if (JSON.stringify(anterior.cuotas) !== JSON.stringify(nuevo.cuotas)) difs.push('cuotas')
    if (!algoEscritoAfuera(pasos, st.alta.esperas)) {
      await actualizar(st, { textoVigente: textoNuevo, nombreCliente: nuevo.nombre, telefonoCliente: telefonoDelCliente(nuevo)?.numero ?? null })
      const v: Validacion = JSON.parse(JSON.stringify(st.alta.validacion ?? validacionVacia()))
      v.okRevision = []
      await actualizar(st, { validacion: v, esperas: st.alta.esperas.map((e) => (e.paso === 'validar' && e.estado === 'abierta' ? { ...e, estado: 'superada' as const } : e)) })
      await fijar(st, 'validar', { estado: 'pendiente', error: null })
      await contestar(st, 'ventas', `correccion:${clave}`, `Tomé la corrección del alta de ${nuevo.nombre ?? nombreDe(st.alta) ?? 'este cliente'}.`, citar)
      st.registro.push('corrección aplicada antes de escribir nada')
      return
    }
    // Ya se escribió algo: nada se rehace; un OK decide si lo que falta sigue con los datos nuevos
    const detalle = difs.length ? difs : ['otros cambios en el texto del #ALTA']
    const esperas = abrirEsperas(st, 'validar', [{
      paso: 'validar', motivo: 'correccion', tipos: ['ok_revision'], grupo: 'verificaciones', quien: 'aprobadores', requiere: [],
      pedido: [`Corrección del #ALTA después de cargar datos: ${detalle.join('; ')}`], datos: { textoNuevo },
      texto: textoPedidoEquipo({ nombre: nombreDe(st.alta), titulo: 'el closer corrigió el #ALTA cuando ya se habían cargado datos (lo hecho NO se rehace).', detalle, ok: 'seguir con los datos nuevos en lo que falta', no: 'frenar el alta' }),
    }], st.ef.modo !== 'real')
    await actualizar(st, { esperas })
    await fijar(st, 'validar', { estado: 'espera' })
    for (const e of st.alta.esperas) if (e.motivo === 'correccion' && pedidoPendiente(e) && st.ef.modo === 'real') await enviarPedido(st, e)
  }

  async function aplicarDatosCloser(st: Estado, e: Espera, texto0: string, citar: string, clave: string) {
    // Correos de socios contestados como "Mail: x", "Correo de Ana: x" o "Ana Gómez: x" → "Socios: Ana Gómez · x" (revisión
    // del 24/10, ronda 2: "Mail:" pisaba el correo del cliente y las otras dos formas no se entendían)
    const ad = adaptarRespuestaSocios(st.alta.textoVigente, texto0)
    if (ad.ambiguo) { await contestar(st, 'ventas', `correo?:${clave}`, TEXTO_CORREO_SOCIO_AMBIGUO, citar); st.registro.push('correo de un socio sin decir de cuál: se pregunta'); return }
    const texto = ad.texto
    const f = fusionarRespuesta(st.alta.textoVigente, texto)
    const ex = extrasDeRespuesta(texto)
    if (!f.cambios.length && !ex.setter && !ex.fuente && !ex.cuenta) {
      // Respondió el pedido pero no trae ningún dato que el bot entienda: se le dice cómo (antes no se contestaba nada y el
      // alta seguía esperando hasta el recordatorio)
      await contestar(st, 'ventas', `noentendi:${clave}`, TEXTO_DATOS_NO_ENTENDIDOS, citar)
      st.registro.push('respuesta del closer sin datos reconocibles: se le explica el formato')
      return
    }
    const pasos = await almacen.leerPasos(st.alta.id)
    if (f.cambios.some((c) => c.tipo === 'corrige') && algoEscritoAfuera(pasos, st.alta.esperas)) return aplicarCorreccion(st, f.texto, citar, clave)
    const v: Validacion = JSON.parse(JSON.stringify(st.alta.validacion ?? validacionVacia()))
    // Setter (Tomás, 25/10/2026): solo si se traduce a la lista ("Maite" → "Mai"); si no, se le sigue preguntando.
    const setterOk = ex.setter ? setterAOpcion(ex.setter) : null
    if (setterOk) { v.setter = setterOk; v.origenSetterFuente = 'closer' }
    else if (ex.setter) st.registro.push(`el setter "${recortar(ex.setter, 40)}" no está en la lista de Finanzas: se vuelve a preguntar`)
    // Fuente: lo del closer es respaldo de los UTM. Reemplaza a una fuente que ya era del closer; una de los UTM o de un OK
    // no se toca (pasoValidar decide).
    if (ex.fuente) {
      v.fuenteCloser = recortar(ex.fuente, 60)
      if (v.origenFuente === 'closer') { v.fuente = null; v.origenFuente = null }
    }
    // "Cuenta:" desde Ventas queda como sugerencia: la cuenta (columna R, el reparto) la decide el comprobante o un OK de
    // Tomi o Gero (revisión del 24/10: cualquiera que citara el pedido la fijaba y pisaba la del comprobante)
    if (ex.cuenta) v.cuentaSugerida = recortar(ex.cuenta, 60)
    const a = parsearAlta(f.texto)
    await actualizar(st, { textoVigente: f.texto, nombreCliente: a.nombre, telefonoCliente: telefonoDelCliente(a)?.numero ?? st.alta.telefonoCliente })
    await marcarEspera(st, e.id, { estado: 'resuelta', respuesta: { veredicto: 'ok', resto: recortar(texto, 500), por: 'closer', en: iso(ahora()), clave } })
    await reabrirValidar(st, v)
    await contestar(st, 'ventas', `sumado:${clave}`, textoSumado(a.nombre), citar)
  }

  async function aplicarRespuesta(st: Estado, ev: { clave: string; grupo: 'ventas' | 'verificaciones'; texto: string; veredicto: Veredicto | null; autor: EventoRespuesta['autor']; citado: EventoRespuesta['citado']; mensajeId: string }, manual?: { esperaId: string; por: string }) {
    let espera: Espera | null = null
    if (manual) espera = st.alta.esperas.find((e) => e.id === manual.esperaId) ?? null
    else if (ev.citado) {
      const r = await almacen.altaDeMensaje(ev.citado.id)
      if (r?.esperaId) espera = st.alta.esperas.find((e) => e.id === r.esperaId) ?? null
    }
    if (!espera && !manual && ev.grupo === 'ventas') {
      const deCloser = st.alta.esperas.filter((e) => e.estado === 'abierta' && e.quien === 'closer')
      if (deCloser.length === 1) espera = deCloser[0]
    }
    if (!espera) return
    // Primero QUIÉN responde, antes de tocar nada (revisión del 24/10: un OK de alguien que no aprueba reabría un rechazo)
    const por = manual ? `manual:${manual.por}` : (ev.autor.telefono ?? ev.autor.lid ?? 'desconocido')
    if (!manual && !autorizado(ev.autor, espera.quien, st.alta, !!ev.citado)) {
      if (ev.grupo === 'verificaciones' && ev.autor.lid && !ev.autor.telefono) {
        log.warn(`bot-alta: ${st.alta.id} — respuesta de un lid que no está en las listas: ${ev.autor.lid}`)
        await contestar(st, 'verificaciones', `noreconozco:${ev.autor.lid}`, TEXTO_NO_RECONOCIDO, ev.mensajeId)
      }
      return
    }
    const ver0 = ev.veredicto ?? veredictoDe(ev.texto)
    // Una ronda superada o resuelta no se aplica (punto 10). Excepciones:
    //  · el MISMO evento que la resolvió (la corrida anterior tiró a la mitad y el evento quedó 'nuevo'): se reaplica;
    //  · una rechazada se reabre con un OK citado durante 7 días;
    //  · una vencida (14 días sin respuesta) se retoma respondiéndola durante 30 días más (revisión del 24/10: el aviso
    //    decía "responder el pedido citándolo" y no funcionaba).
    if (espera.estado !== 'abierta') {
      const mismoEvento = !manual && espera.respuesta?.clave === ev.clave
      const rechazoReabrible = espera.estado === 'rechazada' && (!!manual || ver0?.tipo === 'ok') && !!espera.respuesta && ahora() - Date.parse(espera.respuesta.en) < VENTANA_CORRECCION_RECHAZO_MS
      // (del closer, con algún dato "Clave: valor"; del equipo, con un OK o un NO: un "gracias" citado no la revive)
      const vencidaReabrible = espera.estado === 'vencida' && (!!manual || (espera.quien === 'closer' ? lineasReconocidas(ev.texto) > 0 : !!ver0)) && ahora() - venceEspera(espera) < VENTANA_REAPERTURA_VENCIDA_MS
      const enSimulacion = espera.estado === 'simulada' && !!manual
      if (!mismoEvento && !rechazoReabrible && !vencidaReabrible && !enSimulacion) {
        if (!manual && (ev.grupo === 'ventas' || ev.veredicto)) await contestar(st, ev.grupo, `novigente:${ev.clave}`, TEXTO_NO_VIGENTE, ev.mensajeId)
        return
      }
      if (mismoEvento) {
        // Ya se había aplicado entero si el paso siguió (dejó de esperar, o abrió otra espera): no se repite nada
        const pasos = await almacen.leerPasos(st.alta.id)
        const siguio = !['espera', 'revisar'].includes(pasos[espera.paso].estado) || st.alta.esperas.some((x) => x.paso === espera!.paso && x.estado === 'abierta' && x.id !== espera!.id)
        if (siguio) return
      } else if (rechazoReabrible || vencidaReabrible) {
        await actualizar(st, { estado: 'en_curso', proximoIntento: null })
        // Vuelve a contar desde ahora (si no, la espera retomada vencería de nuevo en la misma corrida)
        const cambios = { estado: 'abierta' as const, desde: iso(ahora()), recordatorios: 0, ultimoRecordatorio: null }
        espera = { ...espera, ...cambios }
        await marcarEspera(st, espera.id, cambios)
        st.registro.push(`la espera ${espera.id} se retomó (${rechazoReabrible ? 'rechazada' : 'vencida'})`)
      }
    }
    if (espera.quien === 'closer') return aplicarDatosCloser(st, espera, ev.texto, ev.mensajeId, ev.clave)
    if (!ver0) return
    return resolverEspera(st, espera, ver0, por, manual ? null : ev.mensajeId, manual ? null : ev.clave)
  }

  /** Un comprobante (o un archivo más) para el alta: vuelve a validar si todavía no se validó. */
  async function aplicarAdjunto(st: Estado, medios: RefMedio[]) {
    await almacen.sumarMedios(st.alta.id, medios, iso(ahora()))
    const alta = await almacen.leerAlta(st.alta.id)
    if (alta) st.alta = { ...st.alta, medios: alta.medios }
    const pasos = await almacen.leerPasos(st.alta.id)
    if (['hecho', 'omitido'].includes(pasos.validar.estado)) {
      st.avisos.push(`Llegó otro archivo para el alta de ${nombreDe(st.alta) ?? 'este cliente'} después de validarla: revisarlo a mano.`)
      return
    }
    const v: Validacion = JSON.parse(JSON.stringify(st.alta.validacion ?? validacionVacia()))
    v.okComprobante = false
    // El comprobante que faltaba, citando, retoma un alta que había vencido esperándolo (revisión del 24/10)
    const retomar = st.alta.estado === 'vencida' ? { estado: 'en_curso' as const, proximoIntento: null } : {}
    await actualizar(st, { ...retomar, validacion: v, esperas: st.alta.esperas.map((e) => (e.paso === 'validar' && e.quien === 'closer' && (e.estado === 'abierta' || (e.estado === 'vencida' && st.alta.estado === 'vencida')) ? { ...e, estado: 'resuelta' as const } : e)) })
    if (pasos.validar.estado !== 'corriendo') await fijar(st, 'validar', { estado: 'pendiente', error: null })
  }

  async function aplicarEvento(st: Estado, ev: EventoBot): Promise<void> {
    switch (ev.tipo) {
      case 'eco': {
        // El eco trae el id de un pedido que volvió sin id: se suma a la espera (así se puede citar en los recordatorios)
        const r = await almacen.altaDeMensaje(ev.mensajeId)
        const e = r?.esperaId ? st.alta.esperas.find((x) => x.id === r.esperaId) : null
        if (e && !e.mensajes.includes(ev.mensajeId)) await marcarEspera(st, e.id, { mensajes: [...e.mensajes, ev.mensajeId], enviado: e.enviado ?? iso(ahora()), proximoEnvio: null })
        // Un envío confirmado por su eco: el paso que esperaba un OK por un envío dudoso se vuelve a mirar
        const pasos = await almacen.leerPasos(st.alta.id)
        if (pasos.bienvenida.estado === 'espera' && st.alta.esperas.some((x) => x.paso === 'bienvenida' && x.motivo === 'dudoso' && x.estado === 'abierta')) {
          await fijar(st, 'bienvenida', { estado: 'pendiente', dudoso: false })
        }
        return
      }
      // Sin cita, el bot eligió el alta: el medio queda marcado (validar compara el ordenante con el cliente)
      case 'adjunto': return aplicarAdjunto(st, ev.citado ? ev.medios : ev.medios.map(conSinCitar))
      case 'alta': {
        // Un alta libre asignada a otra alta de la misma persona son los datos que pidió el bot, sin citar (recibirAlta)
        if (ev.libre) return aplicarRespuesta(st, { ...ev, veredicto: null })
        if (!st.alta.mensajesAlta.includes(ev.mensajeId)) await actualizar(st, { mensajesAlta: [...st.alta.mensajesAlta, ev.mensajeId] })
        // El mismo texto otra vez: si trae el comprobante que faltaba, es eso (revisión del 24/10: la imagen quedaba en un
        // alta "duplicada" y la original seguía esperándola); si no, "Ya lo tengo" (no es una corrección)
        const h = huellaTexto(ev.texto)
        if (h === st.alta.huella || h === huellaTexto(st.alta.textoVigente)) {
          if (ev.medios.length && !st.alta.medios.length && !esFinal(st.alta.estado)) return aplicarAdjunto(st, ev.medios)
          return contestar(st, 'ventas', `duplicada:${ev.clave}`, textoDuplicada(nombreDe(st.alta), st.alta.estado), ev.mensajeId)
        }
        if (ev.medios.length && !esFinal(st.alta.estado)) {
          // La copia de trabajo también (revisión del 24/10, ronda 2: validar corría en la misma vuelta con los medios viejos y
          // volvía a pedirle al closer el comprobante que acababa de mandar como pie de la corrección)
          await almacen.sumarMedios(st.alta.id, ev.medios, iso(ahora()))
          const alta = await almacen.leerAlta(st.alta.id)
          if (alta) st.alta = { ...st.alta, medios: alta.medios }
          const pasos = await almacen.leerPasos(st.alta.id)
          if (['hecho', 'omitido'].includes(pasos.validar.estado)) st.avisos.push(`Llegó otro archivo para el alta de ${nombreDe(st.alta) ?? 'este cliente'} después de validarla: revisarlo a mano.`)
        }
        return aplicarCorreccion(st, ev.texto, ev.mensajeId, ev.clave)
      }
      case 'edicion': return aplicarCorreccion(st, ev.texto, ev.mensajeId, ev.clave)
      case 'respuesta': return aplicarRespuesta(st, ev)
      case 'ingreso': {
        // WhatsApp seguro: el cliente entró al General por el link que le pasó el closer. Vale como el OK de Aylu ("el cliente
        // ya está adentro"): la comunidad queda hecha y sale la bienvenida. Sin la espera abierta (ya respondió Aylu, o la
        // comunidad no terminó), no hace nada
        const pasos = await almacen.leerPasos(st.alta.id)
        const e = st.alta.esperas.find((x) => x.paso === 'comunidad' && x.motivo === 'comunidad' && x.estado === 'abierta')
        if (pasos.comunidad.estado !== 'espera' || !e) { st.registro.push('alguien entró al General, pero la comunidad no esperaba al cliente: nada'); return }
        st.avisos.push(`${nombreDe(st.alta) ?? 'El cliente'} entró a su grupo General por el link: sale la bienvenida (no hace falta el OK).`)
        return resolverEspera(st, e, { tipo: 'ok', resto: '' }, 'whatsapp: entró al grupo', null, ev.clave)
      }
    }
  }

  // ── Recordatorios, reenvíos y vencimientos ──
  async function revisarEsperas(st: Estado): Promise<void> {
    if (st.ef.modo !== 'real') return
    const t = ahora()
    for (const e of [...st.alta.esperas]) {
      if (e.estado !== 'abierta') continue
      if (t >= venceEspera(e)) {
        await marcarEspera(st, e.id, { estado: 'vencida' })
        st.avisos.push(textoVencida(e, nombreDe(st.alta)))
        if (e.paso === 'validar') await actualizar(st, { estado: 'vencida', proximoIntento: null })
        else await fijar(st, e.paso, { estado: 'revisar', error: 'espera vencida (14 días)' })
        continue
      }
      // Despacho: un aviso a Discord que no salió la primera vez se reintenta acá (con el canal Despacho el pedido no se reenvía)
      if (!e.avisoDespacho && (e.enviado || e.mensajes.length) && canal() === 'despacho') await avisarDespacho(st, e, { estado: 'simulado', id: null })
      // El pedido no salió todavía (dudoso, error, pausa): se reintenta a su hora. Uno que salió sin id cuenta como enviado.
      if (!e.mensajes.length && !e.enviado) { if (pedidoPendiente(e)) await enviarPedido(st, e); continue }
      const toca = proximoRecordatorio(e)
      if (toca !== null && toca <= t) {
        const r = await enviar(st, { proposito: `espera:${e.id}:rec${e.recordatorios + 1}`, destino: { grupo: e.grupo }, tipo: 'texto', texto: textoRecordatorio(e, nombreDe(st.alta)), citar: e.mensajes[0] ?? null, esperaId: e.id })
        const actual = st.alta.esperas.find((x) => x.id === e.id) ?? e
        await marcarEspera(st, e.id, { recordatorios: e.recordatorios + 1, ultimoRecordatorio: iso(t), mensajes: r.estado === 'enviado' && r.id ? [...actual.mensajes, r.id] : actual.mensajes })
      }
    }
    if (st.alta.estado === 'fee' && t > Date.parse(st.alta.creado) + VENCE_FEE_MS) {
      st.avisos.push(`El Fee de ${nombreDe(st.alta) ?? 'este cliente'} lleva 60 días sin el pago que lo completa: queda vencido.`)
      await actualizar(st, { estado: 'vencida', proximoIntento: null })
    }
  }

  async function enviarAvisos(st: Estado): Promise<void> {
    const avisos = [...new Set(st.avisos)].filter(Boolean)
    if (!avisos.length) return
    const texto = textoAvisos(nombreDe(st.alta), avisos)
    await enviar(st, { proposito: `avisos:${sha256(texto).slice(0, 12)}`, destino: { grupo: 'verificaciones' }, tipo: 'texto', texto })
  }

  // ── avanzar ──
  async function avanzar(altaId: string, op: OpcionesAvanzar): Promise<ResumenProceso> {
    const resumen = vacio()
    resumen.altas.push(altaId)
    const dueno = op.invocacion
    let alta = await almacen.reclamar(altaId, dueno, op.hasta + 45_000).catch(() => null)
    if (!alta) {
      await almacen.marcarPendientes(altaId).catch(() => {})
      alta = await almacen.reclamar(altaId, dueno, op.hasta + 45_000).catch(() => null)   // por si el dueño soltó en el medio
      if (!alta) { resumen.registro.push(`${altaId}: la está trabajando otra invocación (queda marcada)`); return resumen }
    }
    const st: Estado = { alta, dueno, ef: efectivo(alta), avisos: [], registro: [], continuar: false, despertar: null, resumen }
    const finalAntes = esFinal(alta.estado)
    let manual = op.manual
    for (let ronda = 0; ronda < 3; ronda++) {
      try {
        for (let vuelta = 0; vuelta < 40; vuelta++) {
          await almacen.limpiarPendientes(altaId, dueno)
          st.alta = (await almacen.leerAlta(altaId)) as FilaAlta
          st.ef = efectivo(st.alta)
          if (vuelta === 0 && ronda === 0) {
            if (op.rehacerEnReal && deps.modo === 'real' && st.alta.modo !== 'real') {
              // La validación y la fecha se rehacen en real: en seco o ensayo no se congeló nada que valga (revisión del 24/10).
              // Se guarda la caché de lecturas de Claude, así no se vuelve a pagar la misma lectura.
              const v0 = st.alta.validacion
              await actualizar(st, {
                modo: 'real', capacidades: [...deps.capacidades], estado: 'en_curso', esperas: [], proximoIntento: null, fechaPago: null,
                validacion: v0 ? { ...validacionVacia(), descargas: v0.descargas, lecturas: v0.lecturas } : null,
              })
              for (const p of PASOS) await fijar(st, p, { estado: 'pendiente', error: null, dudoso: false, parcial: null, resultado: null })
              st.ef = efectivo(st.alta)
              st.registro.push('rehecha en real (POST manual)')
            }
            if (op.forzarPaso) {
              // Forzar un paso retoma también un alta vencida o rechazada (revisión del 24/10: el aviso de vencida decía
              // "retomarla desde el Despacho" y no se podía); una duplicada, reemplazada o simulada no
              const retomar = !esFinal(st.alta.estado) || ['lista', 'vencida', 'rechazada'].includes(st.alta.estado)
              await actualizar(st, { esperas: st.alta.esperas.map((e) => (e.paso === op.forzarPaso && e.estado === 'abierta' ? { ...e, estado: 'superada' as const } : e)), ...(retomar ? { estado: 'en_curso' as const, proximoIntento: null } : {}) })
              await fijar(st, op.forzarPaso, { estado: 'pendiente', error: null })
              st.registro.push(`paso ${op.forzarPaso} forzado a pendiente`)
            }
            if (op.aMano) {
              // Despacho: comunidad, bienvenida o Skool hechos a mano (con el número caído). El paso queda 'hecho' con quién y
              // cuándo, sus pedidos abiertos quedan superados y el alta sigue con lo que falte.
              const { paso, por } = op.aMano
              const previo = (await almacen.leerPasos(altaId))[paso]
              if (!(PASOS_A_MANO as readonly string[]).includes(paso) || esFinal(st.alta.estado) || ['hecho', 'omitido'].includes(previo.estado)) {
                st.registro.push(`el paso ${paso} no se puede marcar hecho a mano (alta ${st.alta.estado}, paso ${previo.estado})`)
              } else {
                await actualizar(st, {
                  esperas: st.alta.esperas.map((e) => (e.paso === paso && e.estado === 'abierta' ? { ...e, estado: 'superada' as const } : e)),
                  ...(st.alta.estado === 'revisar' ? { estado: 'en_curso' as const } : {}), proximoIntento: null,
                })
                const resultado = previo.resultado && typeof previo.resultado === 'object' ? previo.resultado as object : {}
                await fijar(st, paso, { estado: 'hecho', error: null, dudoso: false, noAntesDe: null, resultado: { ...resultado, hechoAMano: { por, en: iso(ahora()) } } })
                st.registro.push(`paso ${paso} hecho a mano (${por})`)
              }
            }
          }
          // Eventos pendientes de esta alta (llegaron mientras otra invocación la tenía, o recién asignados)
          // Un evento que tira a la mitad NO se marca procesado: queda 'nuevo' y la corrida siguiente lo vuelve a aplicar (las
          // respuestas guardan la clave del evento, así reaplicarlo no contesta "no está vigente"). Revisión del 24/10: antes
          // se marcaba procesado igual y una espera podía quedar resuelta con su paso sin cambiar. Si sigue fallando después de
          // una hora, se descarta con un aviso.
          for (const ev of await almacen.eventosDeAlta(altaId)) {
            try {
              await aplicarEvento(st, ev)
            } catch (e) {
              if (ahora() - Date.parse(ev.recibidoEn) <= REINTENTO_EVENTO_MS) throw e
              resumen.errores.push(`${altaId}: evento ${ev.clave}: ${motivoDe(e)} (se descarta)`)
              await almacen.marcarProcesado([ev.clave], 'ignorado').catch(() => {})
              st.avisos.push(`No pude aplicar un mensaje del alta de ${nombreDe(st.alta) ?? 'este cliente'} después de una hora de reintentos: revisarlo a mano.`)
              continue
            }
            await almacen.marcarProcesado([ev.clave])
          }
          if (manual) {
            const m = manual
            manual = undefined
            const e = st.alta.esperas.find((x) => x.id === m.esperaId)
            if (!e) resumen.errores.push(`${altaId}: no existe la espera ${m.esperaId}`)
            else {
              if (e.estado === 'simulada' && esFinal(st.alta.estado)) {
                // Seco/ensayo: se aplica la respuesta y el alta se vuelve a simular entera
                await actualizar(st, { estado: 'en_curso' })
                for (const p of PASOS) await fijar(st, p, { estado: 'pendiente', error: null })
              }
              await aplicarRespuesta(st, { clave: `manual:${m.esperaId}:${ahora()}`, grupo: e.grupo, texto: m.texto, veredicto: veredictoDe(m.texto), autor: { telefono: null, lid: null, nombre: m.por }, citado: null, mensajeId: citaAlta(st.alta) }, { esperaId: m.esperaId, por: m.por })
              st.alta = (await almacen.leerAlta(altaId)) as FilaAlta
            }
          }
          if (esFinal(st.alta.estado)) break
          if (vuelta === 0) await revisarEsperas(st)
          if (esFinal(st.alta.estado)) break
          if (st.ef.pausada) {
            await actualizar(st, { proximoIntento: iso(ahora() + 3600_000), notas: [...new Set([...st.alta.notas, `pausada: el entorno está en ${deps.modo} y el alta nació en ${st.alta.modo}`])] })
            st.registro.push(`pausada por el entorno (${deps.modo} < ${st.alta.modo})`)
            break
          }
          const pasos = await almacen.leerPasos(altaId)
          const accion = siguienteAccion(st.alta, pasos, ahora(), op.hasta, { simulada: st.ef.modo !== 'real', pausados: st.ef.pausados })
          if (accion.tipo === 'correr') { await correrPaso(st, accion, pasos); continue }
          await cerrar(st, accion, pasos, op)
          break
        }
        await enviarAvisos(st)
        if (st.ef.modo === 'ensayo' && !finalAntes && st.alta.estado === 'simulada') {
          await enviar(st, { proposito: 'ensayo:reporte', destino: { grupo: 'verificaciones' }, tipo: 'texto', texto: textoReporteEnsayo(resumenEnsayo(st.alta, Object.values(await almacen.leerPasos(altaId)))), reporte: true })
        }
      } catch (e) {
        const m = motivoDe(e)
        resumen.errores.push(`${altaId}: ${m}`)
        log.error(`bot-alta: ${altaId} — ${m}`)
        await almacen.actualizarAlta(altaId, dueno, { error: m.slice(0, 300), proximoIntento: iso(ahora() + 300_000) }).catch(() => {})
      }
      const solto = await almacen.soltar(altaId, dueno).catch(() => true)
      if (solto) break
      if (op.hasta - ahora() < 20_000) { await almacen.actualizarAlta(altaId, dueno, { proximoIntento: iso(ahora()) }).catch(() => {}); break }
      // Llegó algo mientras trabajaba: otra vuelta antes de soltar
    }
    resumen.registro.push(...st.registro.map((x) => `${altaId}: ${x}`))
    // El candado ya se soltó: recién ahora la continuación (si no, la invocación nueva no lo conseguiría)
    if (st.continuar) {
      if (deps.produccion && deps.dispararContinuacion) {
        try { await deps.dispararContinuacion({ alta_id: altaId, cadena: (op.cadena ?? 0) + 1 }); resumen.continuaciones++ } catch (e) { resumen.errores.push(`${altaId}: no se pudo disparar la continuación (${motivoDe(e)}): la toma el barrido`) }
      } else resumen.registro.push(`${altaId}: seguiría en otra invocación (fuera de producción lo toma el barrido)`)
    }
    if (st.despertar && deps.produccion && deps.despertador !== false && deps.dispararDespertador) {
      try { await deps.dispararDespertador({ alta_id: altaId, no_antes_de: st.despertar }) } catch (e) { resumen.errores.push(`${altaId}: despertador: ${motivoDe(e)}`) }
    }
    return resumen
  }

  async function cerrar(st: Estado, accion: Accion, pasos: Record<PasoId, FilaPaso>, op: OpcionesAvanzar): Promise<void> {
    if (accion.tipo === 'nada') return
    if (accion.tipo === 'terminar') {
      let estado: FilaAlta['estado'] = accion.estado === 'lista' && st.ef.modo !== 'real' ? 'simulada' : accion.estado
      let reemplazadaPor: string | null = null
      if (st.alta.validacion?.estadoPlan === 'renovacion') {
        for (const p of PASOS) if (pasos[p].estado === 'pendiente') await fijar(st, p, { estado: 'omitido' })
      }
      // El pago siguiente de un Fee reemplaza al Fee anterior, termine como alta o como otro Fee: el más nuevo lleva lo
      // acumulado (revisión del 24/10: en una cadena de 3 o más señas el primer Fee quedaba abierto y vencía a los 60 días)
      if (st.alta.altaAnterior && estado !== 'simulada') await almacen.actualizarSiEstado(st.alta.altaAnterior, ['fee'], { estado: 'reemplazada', reemplazadaPor: st.alta.id })
      // Un Fee que termina cuando ya llegó el pago siguiente (que lo tomó como anterior mientras este esperaba un OK) no
      // queda abierto: queda reemplazado por ese
      if (estado === 'fee' && st.alta.telefonoCliente) {
        const sucesora = (await almacen.buscarAltas({ telefonoCliente: st.alta.telefonoCliente, entorno: deps.entorno }))
          .find((x) => x.altaAnterior === st.alta.id && !['duplicada', 'rechazada', 'simulada'].includes(x.estado))
        if (sucesora) { estado = 'reemplazada'; reemplazadaPor = sucesora.id }
      }
      const simulados = PASOS.filter((p) => pasos[p].estado === 'simulado' && p !== 'validar')
      await actualizar(st, {
        estado, proximoIntento: estado === 'fee' ? iso(Date.parse(st.alta.creado) + VENCE_FEE_MS) : null, error: null, ...(reemplazadaPor ? { reemplazadaPor } : {}),
        notas: simulados.length && st.ef.modo === 'real' ? [...new Set([...st.alta.notas, `pasos simulados (sin la capacidad): ${simulados.join(', ')}`])] : st.alta.notas,
      })
      if (estado === 'lista') st.avisos.push(`Alta de ${nombreDe(st.alta) ?? 'este cliente'} terminada.${simulados.length ? ` Sin hacer (falta la capacidad): ${simulados.join(', ')}.` : ''}`)
      st.registro.push(`terminó: ${estado}`)
      return
    }
    // Cadena de continuaciones: como mucho 8 por hora (después, a revisar)
    if (accion.tipo === 'otra_invocacion') {
      const t = ahora()
      const cadena = st.alta.cadena && t - Date.parse(st.alta.cadena.desde) < 3600_000 ? st.alta.cadena : { desde: iso(t), n: 0 }
      if (cadena.n >= MAX_ESLABONES_HORA) {
        await actualizar(st, { estado: 'revisar', error: `más de ${MAX_ESLABONES_HORA} continuaciones en una hora`, proximoIntento: iso(t + 3600_000) })
        st.avisos.push(`El alta de ${nombreDe(st.alta) ?? 'este cliente'} encadenó más de ${MAX_ESLABONES_HORA} invocaciones en una hora: queda a revisar.`)
        return
      }
      await actualizar(st, { estado: 'en_curso', cadena: { desde: cadena.desde, n: cadena.n + 1 }, proximoIntento: iso(t) })
      st.continuar = true
      st.registro.push(`el paso ${accion.paso} no entra en lo que queda del plazo: sigue en otra invocación`)
      return
    }
    const estado = estadoDeEspera(st.alta, pasos, accion)
    const proximo = proximaHora(st.alta, pasos, ahora())
    await actualizar(st, { estado, proximoIntento: proximo })
    if (accion.tipo === 'esperar_hasta') {
      const falta = Date.parse(accion.cuando) - ahora()
      if (falta > 0 && falta <= 3 * 270_000) st.despertar = accion.cuando
    }
    void op
  }

  // ── Llegada de eventos (sin candado: solo encuentran o crean el alta) ──
  async function recibir(ev: EventoBot, resumen: ResumenProceso): Promise<string | null> {
    const ignorar = async () => { await almacen.marcarProcesado([ev.clave], 'ignorado'); return null }
    switch (ev.tipo) {
      case 'eco': {
        const r = await almacen.salientePorEco({ chatId: ev.chatId, huella: huellaTexto(ev.texto), desde: iso(Date.parse(ev.enviadoEn) - 600_000), whapiId: ev.mensajeId })
        if (!r) return ignorar()
        await almacen.asignarEvento(ev.clave, r.altaId)
        return r.altaId
      }
      case 'alta': return recibirAlta(ev, resumen)
      case 'ingreso': {
        // WhatsApp seguro: ¿es el General de un alta (índice que guarda el paso comunidad) y entró alguien que no es del equipo?
        const r = await almacen.leerRecurso(recursoGeneral(ev.chatId)).catch(() => null)
        const altaId = typeof r?.datos?.altaId === 'string' ? r.datos.altaId : null
        const alta = altaId ? await almacen.leerAlta(altaId) : null
        if (!alta) return ignorar()
        const delCliente = [r?.datos?.cliente, ...(Array.isArray(r?.datos?.socios) ? r.datos.socios : [])].filter((x): x is string => typeof x === 'string')
        const equipo = new Set([...Object.values(deps.pasos.equipo ?? {}), alta.autor?.telefono ?? ''].map((x) => String(x).replace(/\D/g, '')).filter(Boolean))
        // Un @lid no se puede comparar: cuenta como el cliente (al equipo lo sumó el bot al crear el grupo, no entra por el link)
        const esCliente = (x: string) => delCliente.includes(x) || x.endsWith('@lid') || !equipo.has(x)
        if (!ev.participantes.some(esCliente)) return ignorar()
        await almacen.asignarEvento(ev.clave, alta.id)
        return alta.id
      }
      case 'adjunto': {
        if (ev.citado) {
          const r = await almacen.altaDeMensaje(ev.citado.id)
          if (r) { await almacen.asignarEvento(ev.clave, r.altaId); return r.altaId }
        }
        const id = await almacen.adjuntarMedio({ chatId: ev.chatId, autor: ev.autor, desde: iso(ahora() - VENTANA_ADJUNTO_MS), medios: ev.medios.map(conSinCitar), ahora: iso(ahora()) })
        if (id) { await almacen.asignarEvento(ev.clave, id); return id }
        // Alta libre (Tomás, 26/10/2026): el comprobante aparte del mismo autor, sin citar, va al alta libre de los últimos 30
        // minutos que todavía no tiene (en el ejemplo real llegaron 12 y 13 minutos después, como documentos sueltos)
        // (o más de un archivo: el comprobante y el checkout). Mientras no se validó; después, aplicarAdjunto avisa.
        if (ev.medios.length) {
          const libre = (await almacen.buscarAltas({ autor: ev.autor, abiertas: true, desde: iso(ahora() - VENTANA_ADJUNTO_LIBRE_MS), entorno: deps.entorno }))
            .find((a) => a.chatId === ev.chatId && esAltaLibreFila(a))
          if (libre && !['hecho', 'omitido'].includes((await almacen.leerPasos(libre.id)).validar.estado)) { await almacen.asignarEvento(ev.clave, libre.id); return libre.id }
        }
        if (!ev.medios.length) return null
        // Sin citar y sin un alta de los últimos 15 minutos que lo tome. Revisión del 24/10 (ronda 2):
        //  · con más de un alta del closer esperando el comprobante, se le pide citar y el adjunto se descarta (así el barrido
        //    no lo vuelve a evaluar después, cuando quizá quede una sola: la equivocada);
        //  · con una sola, primero tiene 15 minutos para que lo reclame el #ALTA que suele llegar enseguida (reclamarAdjuntos:
        //    el comprobante del cliente siguiente no se lo queda el alta vieja) y recién después va a esa alta, si sigue siendo
        //    la última del closer;
        //  · sin ninguna, se descarta a los 15 minutos.
        const esperan = (await almacen.buscarAltas({ autor: ev.autor, abiertas: true, desde: iso(ahora() - BUSQUEDA_ESPERA_MS), entorno: deps.entorno }))
          .filter((a) => a.chatId === ev.chatId && !a.medios.length && (a.estado === 'esperando_comprobante' || a.esperas.some((e) => e.estado === 'abierta' && e.tipos.includes('comprobante'))))
        if (esperan.length > 1) {
          await contestar({ alta: esperan[0], ef: efectivo(esperan[0]), registro: resumen.registro }, 'ventas', `citar:${ev.clave}`, TEXTO_CITAR_COMPROBANTE, ev.mensajeId)
          return ignorar()
        }
        if (ahora() - Date.parse(ev.recibidoEn) <= VENTANA_ADJUNTO_MS) return null   // queda suelto: lo puede reclamar un #ALTA
        if (esperan.length === 1 && await esLaUltima(ev, esperan[0])) { await almacen.asignarEvento(ev.clave, esperan[0].id); return esperan[0].id }
        if (esperan.length === 1) await contestar({ alta: esperan[0], ef: efectivo(esperan[0]), registro: resumen.registro }, 'ventas', `citar:${ev.clave}`, TEXTO_CITAR_COMPROBANTE, ev.mensajeId)
        return ignorar()
      }
      case 'edicion': {
        const r = await almacen.altaDeMensaje(ev.mensajeId)
        if (r?.entrante) { await almacen.asignarEvento(ev.clave, r.altaId); return r.altaId }
        // El #ALTA todavía no se procesó (p. ej. Whapi lo reintenta después de un 503): la edición queda suelta una hora; la
        // reclama el alta al nacer o la toma el barrido (revisión del 24/10: antes se descartaba)
        if (!r && ahora() - Date.parse(ev.recibidoEn) < REINTENTO_EVENTO_MS) return null
        return ignorar()
      }
      case 'respuesta': {
        if (ev.citado) {
          const r = await almacen.altaDeMensaje(ev.citado.id)
          if (r) { await almacen.asignarEvento(ev.clave, r.altaId); return r.altaId }
          // La cita no es de ningún mensaje que el bot conozca (p. ej. una copia "(repetido)" cuyo id no llegó): en Ventas, con
          // algún dato, se trata como sin cita (revisión del 24/10, ronda 2: antes se descartaba en silencio)
        }
        // Regla D (Tomás, 26/10/2026): el pago siguiente de un cliente con un Fee abierto, en formato libre y sin el contacto
        // ("Pago 1000 USD · Nombre: Nadia Blanco"), es un alta libre que completa ese Fee (si el nombre lo identifica)
        if (!ev.citado && ev.grupo === 'ventas' && esPagoLibre(ev.texto)) {
          const fee = await feeAbiertoDe(parsearAlta(ev.texto))
          if (fee) return recibirAlta({ ...ev, tipo: 'alta', grupo: 'ventas', texto: ev.texto, medios: [], libre: true }, resumen)
        }
        if (ev.grupo !== 'ventas' || lineasReconocidas(ev.texto) === 0) return ignorar()
        // Hasta 15 días atrás (revisión del 24/10: con 48 h, los datos de un alta más vieja que seguía esperando se perdían),
        // pero solo si esa alta es la ÚLTIMA del closer (ronda 2: si mandó otro #ALTA después, el dato puede ser del cliente
        // nuevo y se pide citar)
        const cand = (await almacen.buscarAltas({ autor: ev.autor, abiertas: true, desde: iso(ahora() - BUSQUEDA_ESPERA_MS), entorno: deps.entorno }))
          .filter((a) => a.chatId === ev.chatId && a.esperas.some((e) => e.estado === 'abierta' && e.quien === 'closer'))
        if (cand.length === 1 && await esLaUltima(ev, cand[0])) { await almacen.asignarEvento(ev.clave, cand[0].id); return cand[0].id }
        if (cand.length) await contestar({ alta: cand[0], ef: efectivo(cand[0]), registro: resumen.registro }, 'ventas', `citar:${ev.clave}`, cand.length > 1 ? TEXTO_CITAR : TEXTO_CITAR_DATO_OTRA, ev.mensajeId)
        return ignorar()
      }
    }
  }

  /** Altas abiertas de la misma persona (regla D, alta libre): por teléfono, correo o nombre. Las de los últimos 90 días. */
  type Persona = Pick<ReturnType<typeof parsearAlta>, 'nombre' | 'correo' | 'telefonos' | 'socios'>
  async function abiertasDeLaPersona(a: Persona, excluir: string): Promise<FilaAlta[]> {
    const tel = telefonoDelCliente(a)?.numero ?? null
    const correo = a.correo?.toLowerCase() ?? null
    return (await almacen.buscarAltas({ abiertas: true, desde: iso(ahora() - 90 * 86_400_000), entorno: deps.entorno }))
      .filter((x) => x.id !== excluir && !['duplicada', 'simulada'].includes(x.estado))
      // mismaPersona da true con un nombre vacío: el nombre solo cuenta si están los dos
      .filter((x) => (tel && x.telefonoCliente === tel) || (!!a.nombre && !!nombreDeFila(x) && mismaPersona(nombreDeFila(x), a.nombre))
        || (!!correo && (() => { try { return altaParseada(x).correo === correo } catch { return false } })()))
  }
  /** El Fee abierto más nuevo de esa persona, o null. */
  async function feeAbiertoDe(a: Persona): Promise<FilaAlta | null> {
    if (!a.nombre && !a.correo && !a.telefonos.length) return null
    return (await abiertasDeLaPersona(a, '')).find(esFee) ?? null
  }

  /** ¿`alta` es la última que mandó ese closer en ese chat? (sin contar los reenvíos 'duplicada' ni las simuladas) */
  async function esLaUltima(ev: Pick<EventoBot, 'autor' | 'chatId'>, alta: FilaAlta): Promise<boolean> {
    const despues = (await almacen.buscarAltas({ autor: ev.autor, desde: alta.creado, entorno: deps.entorno }))
      .filter((x) => x.id !== alta.id && x.chatId === ev.chatId && !['duplicada', 'simulada'].includes(x.estado) && Date.parse(x.creado) > Date.parse(alta.creado))
    return despues.length === 0
  }

  async function recibirAlta(ev: Extract<EventoBot, { tipo: 'alta' }>, resumen: ResumenProceso): Promise<string | null> {
    const id = `alta_${ev.mensajeId}`
    const propia = await almacen.leerAlta(id)
    if (propia) { await almacen.marcarProcesado([ev.clave]); return id }
    // Alta libre (26/10/2026): el closer sale del autor (BOT_ALTA_CLOSERS) y queda como "Closer:" arriba del texto
    const textoAlta = ev.libre ? textoAltaLibre(ev.texto, closerDeAutor(ev.autor, deps.pasos.closers ?? {})) : ev.texto
    const a = parsearAlta(textoAlta)
    const tel = telefonoDelCliente(a)?.numero ?? null
    const huella = huellaTexto(ev.texto)
    // 1. Corrección citando un #ALTA o un mensaje del bot de un alta abierta. Revisión de la integración (ronda 3): la cita sola
    //    no alcanza, el nombre tiene que poder ser el mismo. Un #ALTA de otro cliente respondido por error sobre el de una alta
    //    abierta la pisaba entera (nombre, Finanzas con el comprobante de la otra, CRM, Drive, comunidad) y el pago de la
    //    primera desaparecía. Con otro nombre es un alta nueva; se le avisa al closer y a Verificaciones por si era una
    //    corrección del nombre (esa se hace editando el #ALTA o respondiendo el pedido con "Nombre completo: …").
    let citadaDeOtro: FilaAlta | null = null
    if (ev.citado) {
      const r = await almacen.altaDeMensaje(ev.citado.id)
      const vieja = r ? await almacen.leerAlta(r.altaId) : null
      if (vieja && !esFinal(vieja.estado) && vieja.estado !== 'fee') {
        if (mismaPersona(nombreDeFila(vieja), a.nombre)) { await almacen.asignarEvento(ev.clave, vieja.id); return vieja.id }
        citadaDeOtro = vieja
      }
    }
    const base = {
      modo: deps.modo, capacidades: [...deps.capacidades], entorno: deps.entorno, chatId: ev.chatId, autor: ev.autor, mensajeAltaId: ev.mensajeId,
      textoOriginal: textoAlta, huella, telefonoCliente: tel, nombreCliente: a.nombre, medios: ev.medios, altaAnterior: null as string | null,
    }
    // 2. Reenvío del mismo texto (7 días) contra un alta que no terminó. Revisión del 24/10:
    //  · un Fee ya cargado ('fee') no cuenta: espera OTRO pago, y el mismo texto con otro comprobante es ese pago;
    //  · un Fee que todavía espera un OK, con su comprobante, tampoco si este trae otro (ronda 2: quedaba 'duplicada' y el
    //    segundo pago no llegaba nunca a Finanzas);
    //  · la propia tampoco (otra invocación la acaba de crear con este mismo #ALTA: no es un reenvío);
    //  · si la original todavía espera el comprobante y este trae uno, es ese comprobante: va a la original.
    const dup = (await almacen.buscarAltas({ huella, desde: iso(ahora() - 7 * 86_400_000), abiertas: true, entorno: deps.entorno }))
      .find((x) => x.id !== id && x.estado !== 'fee' && !(esFee(x) && x.medios.length > 0 && ev.medios.length > 0))
    // Alta libre: no se toca un alta abierta de esa persona. El mismo texto otra vez, o un resumen de un alta que ya está
    // en curso, se ignora sin contestar (no se sabe si era un alta). Solo un Fee abierto se completa (reglas C y D).
    if (ev.libre) {
      if (dup) { await almacen.marcarProcesado([ev.clave], 'ignorado'); resumen.registro.push(`alta libre ${ev.mensajeId}: mismo texto que ${dup.id} (se ignora)`); return null }
      const deLaPersona = await abiertasDeLaPersona(a, id)
      const otra = deLaPersona.find((x) => !esFee(x))
      // Si esa alta le está pidiendo datos al mismo closer, son los datos sin citar (se aplican como una respuesta, no como
      // una corrección que pise el texto); si no, se ignora
      if (otra && mismoAutor(ev.autor, otra.autor) && otra.esperas.some((e) => e.estado === 'abierta' && e.quien === 'closer')) {
        await almacen.asignarEvento(ev.clave, otra.id)
        return otra.id
      }
      if (otra) { await almacen.marcarProcesado([ev.clave], 'ignorado'); resumen.registro.push(`alta libre ${ev.mensajeId}: ${otra.id} de la misma persona sigue abierta (se ignora)`); return null }
      const fee = deLaPersona.find(esFee)
      if (fee) {
        base.altaAnterior = fee.id
        // El pago siguiente suele traer solo el nombre y el monto: los datos del cliente y el plan salen del Fee
        const conDatos = textoAltaLibre(textoPagoSiguiente(ev.texto, fee.textoVigente), closerDeAutor(ev.autor, deps.pasos.closers ?? {}))
        base.textoOriginal = conDatos
        base.telefonoCliente = telefonoDelCliente(parsearAlta(conDatos))?.numero ?? fee.telefonoCliente
        base.nombreCliente = parsearAlta(conDatos).nombre ?? base.nombreCliente
      }
    }
    if (dup) {
      if (ev.medios.length && !dup.medios.length) { await almacen.asignarEvento(ev.clave, dup.id); return dup.id }
      const { alta, creada } = await almacen.crearAlta({ ...base, id, estado: 'duplicada', reemplazadaPor: dup.id })
      await almacen.marcarProcesado([ev.clave])
      if (!creada) return alta.estado === 'duplicada' ? null : id   // otra invocación ya la creó
      await contestar({ alta, ef: efectivo(alta), registro: resumen.registro }, 'ventas', 'duplicada', textoDuplicada(dup.nombreCliente, dup.estado), ev.mensajeId)
      resumen.registro.push(`${id}: duplicada de ${dup.id}`)
      return null
    }
    // 3. Mismo teléfono de cliente: corrección de un alta abierta, o el pago siguiente de un Fee. Un Fee que todavía espera
    //    un OK (no llegó a 'fee') también cuenta como Fee (revisión del 24/10: el #ALTA del segundo pago se tomaba como
    //    corrección del Fee y el primer pago desaparecía); para corregirlo, el #ALTA se manda citando el anterior.
    //    Ronda 2: el teléfono solo no alcanza, el nombre tiene que poder ser el mismo (un closer que copia el #ALTA anterior y
    //    no cambia el teléfono pisaba el alta de otro cliente, o cerraba su Fee). Con otro nombre es un alta nueva, y validar
    //    pregunta por el teléfono repetido. Y el Fee que se completa es el MÁS NUEVO de la cadena (antes, cualquiera en 'fee'
    //    antes que uno que esperaba un OK: la suma quedaba corta y la cadena se partía).
    if (tel && !ev.libre) {
      const abiertas = (await almacen.buscarAltas({ telefonoCliente: tel, abiertas: true, entorno: deps.entorno }))
        .filter((x) => x.id !== id && mismaPersona(nombreDeFila(x), a.nombre))
      const otra = abiertas.find((x) => !esFee(x))
      if (otra) { await almacen.asignarEvento(ev.clave, otra.id); return otra.id }
      const fee = abiertas.find(esFee)   // buscarAltas ordena del más nuevo al más viejo
      if (fee) base.altaAnterior = fee.id
    }
    // 4. Alta nueva (y los adjuntos sueltos del mismo autor de los últimos 15 minutos y las ediciones que llegaron antes)
    const { creada } = await almacen.crearAlta({ ...base, id })
    if (creada) {
      await almacen.reclamarAdjuntos({ altaId: id, chatId: ev.chatId, autor: ev.autor, desde: iso(ahora() - 15 * 60_000) })
      await almacen.reclamarEdiciones({ altaId: id, mensajeId: ev.mensajeId })
    }
    await almacen.marcarProcesado([ev.clave])
    if (creada) resumen.registro.push(`${id}: alta nueva (${deps.modo})${base.altaAnterior ? ` que completa el Fee ${base.altaAnterior}` : ''}`)
    if (creada && citadaDeOtro) {
      const nueva = await almacen.leerAlta(id)
      if (nueva) {
        const st = { alta: nueva, ef: efectivo(nueva), registro: resumen.registro }
        const otro = nombreDeFila(citadaDeOtro)
        await contestar(st, 'ventas', 'cita_otro_cliente:ventas', textoAltaCitandoOtra(a.nombre, otro), ev.mensajeId)
        await contestar(st, 'verificaciones', 'cita_otro_cliente:verificaciones', textoAvisoAltaCitandoOtra(a.nombre, otro, a.closer), null)
        resumen.registro.push(`${id}: citaba el alta ${citadaDeOtro.id} (otro nombre): alta nueva, no corrección`)
      }
    }
    return id
  }

  // ── Interfaz ──
  const relevante = (ev: EventoBot): boolean => {
    if (ev.tipo !== 'respuesta') return true
    if (ev.grupo === 'verificaciones') return !!ev.citado && !!ev.veredicto
    return !!ev.citado || lineasReconocidas(ev.texto) > 0
  }

  async function procesar(eventos: EventoBot[], op: { hasta: number; invocacion: string }): Promise<ResumenProceso> {
    const resumen = vacio()
    const tocadas: string[] = []
    for (const ev of [...eventos].sort((x, y) => x.enviadoEn.localeCompare(y.enviadoEn))) {
      try {
        const id = await recibir(ev, resumen)
        if (id && !tocadas.includes(id)) tocadas.push(id)
      } catch (e) {
        resumen.errores.push(`${ev.clave}: ${motivoDe(e)}`)
        log.error(`bot-alta: evento ${ev.clave} — ${motivoDe(e)}`)
      }
    }
    for (const id of tocadas) {
      if (op.hasta - ahora() < 20_000) { resumen.registro.push(`${id}: sin tiempo, la toma el barrido`); continue }
      sumar(resumen, await avanzar(id, op))
    }
    if (op.hasta - ahora() > 30_000) sumar(resumen, await barrer({ ...op, limite: 3 }, tocadas))
    return resumen
  }

  /** `excluir`: las altas que esta misma invocación ya avanzó (no se vuelven a tomar en el barrido oportunista). */
  async function barrer(op: { hasta: number; invocacion: string; limite?: number }, excluir: readonly string[] = []): Promise<ResumenProceso> {
    const resumen = vacio()
    let tomado = false
    try {
      tomado = await almacen.tomarRecurso('barrido', op.invocacion, 120_000)
      if (!tomado) { resumen.registro.push('barrido: ya hay otro en curso'); return resumen }
      const tocadas = new Set(await almacen.vencidas(op.limite ?? 3, deps.entorno, iso(ahora())))
      for (const { evento, altaId } of await almacen.eventosSinProcesar(iso(ahora() - 10 * 60_000), 20)) {
        if (altaId) { tocadas.add(altaId); continue }
        try {
          const id = await recibir(evento, resumen)
          if (id) { tocadas.add(id); continue }
          // Un adjunto suelto que ninguna alta reclamó (ni una que espere el comprobante) se descarta a los 15 minutos
          if (evento.tipo === 'adjunto' && ahora() - Date.parse(evento.recibidoEn) > 15 * 60_000) await almacen.marcarProcesado([evento.clave], 'ignorado')
        } catch (e) { resumen.errores.push(`${evento.clave}: ${motivoDe(e)}`) }
      }
      for (const id of tocadas) {
        if (excluir.includes(id)) continue
        if (op.hasta - ahora() < 20_000) break
        sumar(resumen, await avanzar(id, op))
      }
      // Purga (DELETE + UPDATE) como mucho una vez por día: con cada barrido mantenía despierta la base de Neon
      const ultima = await almacen.leerRecurso('purga').catch(() => null)
      const hecha = typeof ultima?.datos?.ultima === 'string' ? Date.parse(ultima.datos.ultima) : NaN
      if (!(ahora() - hecha < INTERVALO_PURGA_MS)) {
        await almacen.purgar(iso(ahora())).catch(() => 0)
        await almacen.guardarDatosRecurso('purga', { ultima: iso(ahora()) }).catch(() => {})
      }
    } catch (e) {
      resumen.errores.push(`barrido: ${motivoDe(e)}`)
    } finally {
      if (tomado) await almacen.soltarRecurso('barrido', op.invocacion).catch(() => {})
    }
    return resumen
  }

  return {
    modo: deps.modo,
    async registrar(eventos) {
      const guardar = eventos.filter(relevante)
      const ignorados = eventos.filter((e) => !relevante(e)).map((e) => e.clave)
      const r = await almacen.registrarEntrantes(guardar)   // si falla, tira: la ruta responde 503
      return { nuevos: r.nuevos, repetidos: r.repetidos, ignorados }
    },
    async procesar(eventos, op) {
      try { return await procesar(eventos, op) } catch (e) { return { ...vacio(), errores: [motivoDe(e)] } }
    },
    async avanzar(altaId, op) {
      try { return await avanzar(altaId, op) } catch (e) { return { ...vacio(), altas: [altaId], errores: [motivoDe(e)] } }
    },
    async barrer(op) { return barrer(op) },
    async responder(altaId, r, op) {
      try { return await avanzar(altaId, { ...op, manual: r }) } catch (e) { return { ...vacio(), altas: [altaId], errores: [motivoDe(e)] } }
    },
    async hechoAMano(altaId, paso, por, op) {
      try { return await avanzar(altaId, { ...op, aMano: { paso, por } }) } catch (e) { return { ...vacio(), altas: [altaId], errores: [motivoDe(e)] } }
    },
  }
}

/** Para la pantalla y el GET de la ruta: el alta sin textos sensibles. */
export function vistaAlta(alta: FilaAlta, pasos?: Record<PasoId, FilaPaso>) {
  return {
    id: alta.id, estado: alta.estado, modo: alta.modo, entorno: alta.entorno, creado: alta.creado, actualizado: alta.actualizado,
    cliente: alta.nombreCliente ? nombreCliente(alta.nombreCliente) : null, proximoIntento: alta.proximoIntento, error: alta.error, notas: alta.notas,
    medios: alta.medios.length, altaAnterior: alta.altaAnterior, reemplazadaPor: alta.reemplazadaPor,
    esperas: alta.esperas.map((e) => ({ id: e.id, paso: e.paso, motivo: e.motivo, estado: e.estado, quien: e.quien, desde: e.desde, recordatorios: e.recordatorios })),
    ...(pasos ? { pasos: Object.fromEntries(PASOS.map((p) => [p, { estado: pasos[p].estado, noAntesDe: pasos[p].noAntesDe, intentos: pasos[p].intentos, error: pasos[p].error, dudoso: pasos[p].dudoso }])) } : {}),
  }
}
