// ── Bot "Capital Jurídico": etapa ÉXITO DEL CLIENTE — la lógica (con dependencias inyectables: los tests no tocan red ni base) ──
// Dos puertas:
//   · procesarEventos(candidatos): lo que llega por el webhook de Whapi (ruta.ts, en after()):
//       - ecos del bot en Verificaciones → recupera el id de un pedido que volvió sin id;
//       - respuestas OK / NO citando un pedido, de un aprobador (BOT_ALTA_APROBADORES) → manda (o no) el mensaje de testimonio
//         al General del cliente;
//       - mensajes de un cliente en cualquiera de sus 3 grupos → filtro barato (ya aplicado), bloqueo, tope y Claude → pedido de OK;
//       - videos de un cliente (en cualquiera de sus 3 grupos) dentro de los 30 días del mensaje de testimonio → agradecimiento
//         con el Calendly en el General + aviso en Discord, y queda guardado.
//   · correrDiario(): el cron diario (/api/bot/exito, 10:00 AR): vence los pedidos viejos, vincula cada respuesta del Typeform a
//     SU ronda (rondas.ts), pide el OK por un 8+ de la ronda vigente, consulta las respuestas dudosas, el día EXITO_ENCUESTA_DIA
//     publica la lista de activos para el OK, sigue un lote aprobado y manda el recordatorio a los 3 días.
//   · También por el webhook: el OK / NO a la lista del mes (con "OK sin X") y el "OK A123" / "NO" a una respuesta dudosa.
// Modo: seco = nada sale y nada se escribe (solo el registro); ensayo = lecturas reales y, como mucho, un reporte SIMULACIÓN
// en Verificaciones; real = por capacidad (config.ts). Nunca tira: los errores van al resumen.
import { conPrefijoEnsayo } from '@/lib/bot/whapi/compuerta'
import type { AutorWhapi } from '@/lib/bot/alta/motor/tipos'
import type { AlmacenExito, ClienteLote, Lote, Pedido } from './almacen'
import type { ClasificarExito } from './claude'
import {
  MAX_CLAUDE_CLIENTE_DIA, MAX_PEDIDOS_ENCUESTA_DIA, PUNTAJE_EXITO, RECORDATORIO_ENCUESTA_MS, VENCE_PEDIDO_MS, VENTANA_TESTIMONIO_MS,
  reporteEnsayo, saleReal, type CapacidadExito, type ConfigExito,
} from './config'
import { normNombre, type Directorio, type FichaCliente } from './directorio'
import type { CandidatosExito } from './filtro'
import { rondasVigentes, vinculos, type RespuestaEncuesta } from './rondas'
import {
  diaAR, huellaTexto, textoAgradecimiento, textoListaEncuesta, textoDiscordTestimonio, textoEncuesta, textoPedidoOk, textoRecordatorio, textoTestimonio,
  type GrupoCliente, type MotivoExito,
} from './textos'

export interface RegistroLogExito { info(m: string): void; warn(m: string): void; error(m: string): void }

export interface DepsExito {
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  config: ConfigExito
  almacen: AlmacenExito
  directorio: Directorio
  /** El cliente real de Whapi (solo se llama cuando el modo y la capacidad lo permiten). Tira ErrorWhapi. */
  enviarTexto(p: { chatId: string; texto: string; citar?: string | null }): Promise<{ id: string | null }>
  /** Claude (solo en ensayo y real). */
  clasificar?: ClasificarExito
  /** Discord #🤝-exito-y-bajas: devuelve el id del mensaje. */
  discord?(texto: string, menciones: string[]): Promise<string | null>
  mencionGeroM: string | null
  ahora: () => number
  /** Pausa entre encuesta y encuesta (para no mandar decenas de mensajes de golpe con un número no oficial). */
  esperar?: (ms: number) => Promise<void>
  log: RegistroLogExito
}

export interface ResumenExito {
  modo: string
  detectados: number; pedidos: number; aprobados: number; rechazados: number; testimonios: number; ecos: number
  encuestas: number; recordatorios: number; vencidos: number; ignorados: number; errores: string[]; registro: string[]
}
const vacio = (modo: string): ResumenExito => ({ modo, detectados: 0, pedidos: 0, aprobados: 0, rechazados: 0, testimonios: 0, ecos: 0, encuestas: 0, recordatorios: 0, vencidos: 0, ignorados: 0, errores: [], registro: [] })

const iso = (ms: number) => new Date(ms).toISOString()
const motivoDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)
const soloDigitos = (s: string) => s.replace(/\D/g, '')
const idSeguro = (s: string) => s.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 120)

/** ¿El autor está en la lista? (mismo criterio que enLista del orquestador: lid exacto o los últimos 10 dígitos). */
export function enLista(autor: Pick<AutorWhapi, 'telefono' | 'lid'>, lista: readonly string[]): boolean {
  return lista.some((x) => {
    const t = x.trim()
    if (!t) return false
    if (t.includes('@')) return !!autor.lid && autor.lid === t
    const d = soloDigitos(t)
    return !!autor.telefono && d.length >= 8 && soloDigitos(autor.telefono).slice(-10) === d.slice(-10)
  })
}

type Salida = { estado: 'enviado'; id: string | null } | { estado: 'simulado' } | { estado: 'error'; dudoso: boolean; motivo: string }

export function crearNucleo(d: DepsExito) {
  const { config: c, almacen } = d
  const real = (cap: CapacidadExito) => saleReal(cap, c.modo, c.capacidades)
  const ensayo = (cap: CapacidadExito) => reporteEnsayo(cap, c.modo, c.capacidades)

  /** Manda un texto si `permitido`; en ensayo, con el prefijo SIMULACIÓN. Nunca tira. */
  async function salir(permitido: boolean, chatId: string | null, texto: string, citar: string | null = null): Promise<Salida & { texto: string }> {
    const final = c.modo === 'ensayo' ? conPrefijoEnsayo(texto) : texto
    if (!permitido || !chatId) return { estado: 'simulado', texto: final }
    try {
      const r = await d.enviarTexto({ chatId, texto: final, citar })
      return { estado: 'enviado', id: r.id, texto: final }
    } catch (e) {
      const ap = (e as { aplicado?: boolean | null })?.aplicado
      return { estado: 'error', dudoso: ap === null || ap === undefined ? (e as { tipo?: string })?.tipo === 'dudoso' : false, motivo: motivoDe(e), texto: final }
    }
  }

  /** Abre un pedido de OK en Verificaciones (o el reporte SIMULACIÓN en ensayo). Respeta el bloqueo (abierto / 60 días). */
  async function abrirPedido(r: ResumenExito, ficha: FichaCliente, motivo: MotivoExito, origen: string, idCrm: string | null = ficha.idCrm): Promise<boolean> {
    if (d.clienteOperativo && !await d.clienteOperativo(idCrm, ficha.cliente)) { r.ignorados++; return false }
    const general = ficha.grupos.general
    if (!general) { r.registro.push(`${ficha.cliente}: éxito detectado, pero no se conoce su grupo General: no se pide el OK`); return false }
    const b = await almacen.bloqueo(ficha.clave, d.ahora())
    if (b) { r.registro.push(`${ficha.cliente}: éxito detectado, sin pedir (${b.motivo})`); r.ignorados++; return false }
    const permitido = real('exito_pedido_ok') || ensayo('exito_pedido_ok')
    const texto = textoPedidoOk(ficha.cliente, motivo)
    if (!permitido) { r.registro.push(`haría: pedir el OK del testimonio de ${ficha.cliente} en Verificaciones (sin la capacidad exito_pedido_ok)`); return false }
    if (!c.verificaciones) { r.errores.push('falta WHAPI_GRUPO_VERIFICACIONES: no se puede pedir el OK'); return false }
    const final = c.modo === 'ensayo' ? conPrefijoEnsayo(texto) : texto
    const id = `p_${idSeguro(origen)}`
    const creado = await almacen.crearPedido({ id, clave: ficha.clave, cliente: ficha.cliente, idCrm, general, invitacion: ficha.invitacionGeneral, motivo, modo: c.modo, mensajePedidoId: null, huella: huellaTexto(final), creado: iso(d.ahora()) })
    if (!creado) { r.ignorados++; return false }
    const s = await salir(true, c.verificaciones, texto)
    if (s.estado === 'enviado') {
      if (s.id) await almacen.actualizarPedido(id, { mensajePedidoId: s.id })
      r.pedidos++
      r.registro.push(`pedido de OK por ${ficha.cliente} en Verificaciones${c.modo === 'ensayo' ? ' (SIMULACIÓN)' : ''}`)
      return true
    }
    if (s.estado === 'error' && s.dudoso) { r.pedidos++; r.registro.push(`pedido de OK por ${ficha.cliente}: Whapi no confirmó (lo confirma el eco)`); return true }
    await almacen.actualizarPedido(id, { estado: 'vencido', error: s.estado === 'error' ? s.motivo : 'no salió', resuelto: iso(d.ahora()) })
    r.errores.push(`${ficha.cliente}: no salió el pedido de OK (${s.estado === 'error' ? s.motivo : 'simulado'})`)
    return false
  }

  // ── Webhook ──
  async function aplicarEco(r: ResumenExito, e: CandidatosExito['ecos'][number]) {
    const p = await almacen.pedidoSinIdPorHuella(huellaTexto(e.texto), iso(Date.parse(e.enviadoEn) - 3600_000))
    if (!p) {
      const lote = await almacen.loteSinIdPorHuella(huellaTexto(e.texto))
      if (lote) { await almacen.actualizarLote(lote.mes, { mensajeId: e.mensajeId }, ['pedido']); r.ecos++; return }
      const dud = await almacen.dudosaSinIdPorHuella(huellaTexto(e.texto))
      if (dud) { await almacen.marcarSenal(dud.id, 'consultada', { mensajeId: e.mensajeId }); r.ecos++ }
      return
    }
    if (await almacen.actualizarPedido(p.id, { mensajePedidoId: e.mensajeId }, ['abierto'])) { r.ecos++; r.registro.push(`eco: pedido de ${p.cliente} con su id`) }
  }

  async function aplicarRespuesta(r: ResumenExito, x: CandidatosExito['respuestas'][number]) {
    const p = await almacen.pedidoPorMensaje(x.citado)
    if (!p) {
      const lote = await almacen.lotePorMensaje(x.citado)
      if (lote) return aplicarRespuestaLote(r, x, lote)
      return aplicarRespuestaDudosa(r, x)   // o cita otra cosa (un pedido del motor de altas): no es de esta etapa
    }
    if (!enLista(x.autor, c.aprobadores)) { r.ignorados++; r.registro.push(`respuesta a ${p.cliente} de alguien que no es aprobador: se ignora`); return }
    if (p.estado !== 'abierto') { r.ignorados++; return }
    if (d.clienteOperativo && !await d.clienteOperativo(p.idCrm, p.cliente)) { r.ignorados++; return }
    const por = x.autor.nombre ?? x.autor.telefono ?? x.autor.lid ?? 'aprobador'
    const ahora = iso(d.ahora())
    if (x.veredicto === 'no') {
      if (await almacen.actualizarPedido(p.id, { estado: 'rechazado', por, respuesta: `NO ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) { r.rechazados++; r.registro.push(`NO al testimonio de ${p.cliente}`) }
      return
    }
    if (!real('exito_mensaje_cliente')) {
      if (await almacen.actualizarPedido(p.id, { estado: 'aprobado_simulado', por, respuesta: `OK ${x.resto}`.trim(), resuelto: ahora }, ['abierto'])) {
        r.aprobados++
        r.registro.push(`haría: mandar el mensaje de testimonio a ${p.cliente} (modo ${c.modo}${c.modo === 'real' ? ', sin exito_mensaje_cliente' : ''})`)
      }
      return
    }
    if (!(await almacen.actualizarPedido(p.id, { estado: 'aprobado', por, respuesta: `OK ${x.resto}`.trim() }, ['abierto']))) return
    r.aprobados++
    const s = await salir(true, p.general, textoTestimonio(p.cliente, d.ahora()))
    if (s.estado === 'enviado') {
      await almacen.actualizarPedido(p.id, { estado: 'enviado', mensajeClienteId: s.id, resuelto: iso(d.ahora()) })
      r.registro.push(`mensaje de testimonio enviado a ${p.cliente}`)
      if (real('exito_pedido_ok')) await salir(true, c.verificaciones, `Listo: le mandé el mensaje de testimonio a ${p.cliente}.`, x.mensajeId)
    } else if (s.estado === 'error' && s.dudoso) {
      await almacen.actualizarPedido(p.id, { estado: 'dudoso', error: s.motivo, resuelto: iso(d.ahora()) })
      r.errores.push(`${p.cliente}: Whapi no confirmó el mensaje de testimonio (puede haber salido: revisar el General)`)
      if (real('exito_pedido_ok')) await salir(true, c.verificaciones, `No sé si le llegó el mensaje de testimonio a ${p.cliente} (WhatsApp no confirmó). Revisen el grupo General antes de mandarlo a mano.`, x.mensajeId)
    } else {
      await almacen.actualizarPedido(p.id, { estado: 'error', error: s.estado === 'error' ? s.motivo : 'no salió', resuelto: iso(d.ahora()) })
      r.errores.push(`${p.cliente}: no salió el mensaje de testimonio (${s.estado === 'error' ? s.motivo : 'simulado'})`)
      if (real('exito_pedido_ok')) await salir(true, c.verificaciones, `No pude mandarle el mensaje de testimonio a ${p.cliente}. Se puede mandar a mano.`, x.mensajeId)
    }
  }

  /** "OK A123" / "NO" a una respuesta dudosa de la encuesta. La vincula a su ronda el próximo cron. */
  async function aplicarRespuestaDudosa(r: ResumenExito, x: CandidatosExito['respuestas'][number]) {
    const dud = await almacen.dudosaPorMensaje(x.citado)
    if (!dud || dud.estado !== 'consultada') return
    if (!enLista(x.autor, c.aprobadores)) { r.ignorados++; return }
    const por = x.autor.nombre ?? x.autor.telefono ?? x.autor.lid ?? 'aprobador'
    const puedeResponder = real('encuesta_mensual') || real('exito_pedido_ok')
    if (x.veredicto === 'no') { await almacen.marcarSenal(dud.id, 'descartada', { por }); r.registro.push('respuesta dudosa de la encuesta descartada'); return }
    const id = /(?:^|\s)([A-Za-z]\d{1,5})(?=\s|$|[.,;!])/.exec(x.resto)?.[1]?.toUpperCase()
    if (!id) {
      if (puedeResponder) await salir(true, c.verificaciones, 'Para asignarla necesito el ID del CRM: respondé citando la consulta con, por ejemplo, "OK A123".', x.mensajeId)
      return
    }
    await almacen.marcarSenal(dud.id, 'asignada', { idCliente: id, por })
    r.registro.push(`respuesta dudosa de la encuesta asignada a ${id}`)
    if (puedeResponder) await salir(true, c.verificaciones, `Listo: la respuesta queda asignada a ${id}.`, x.mensajeId)
  }

  async function aplicarMensaje(r: ResumenExito, m: CandidatosExito['mensajes'][number]) {
    const e = await d.directorio.deChat(m.chatId)
    if (!e) return   // no es un grupo de cliente
    const { ficha, grupo } = e
    if (d.clienteOperativo && !await d.clienteOperativo(ficha.idCrm, ficha.cliente)) { r.ignorados++; return }
    if (!d.clasificar) { r.registro.push(`haría: evaluar con Claude un mensaje de ${ficha.cliente} (grupo ${grupo})`); return }
    if (await almacen.bloqueo(ficha.clave, d.ahora())) { r.ignorados++; return }
    const inicioDia = iso(Date.parse(`${diaAR(d.ahora())}T00:00:00-03:00`))
    if ((await almacen.evaluadasDesde(ficha.clave, inicioDia)) >= MAX_CLAUDE_CLIENTE_DIA) { r.ignorados++; r.registro.push(`${ficha.cliente}: tope de ${MAX_CLAUDE_CLIENTE_DIA} evaluaciones por día`); return }
    const sid = `m:${idSeguro(m.mensajeId)}`
    if (!(await almacen.reclamarSenal({ id: sid, tipo: 'mensaje', clave: ficha.clave, chatId: m.chatId, detalle: { grupo } }, iso(d.ahora())))) { r.ignorados++; return }
    let l
    try {
      l = await d.clasificar(m.texto)
    } catch (err) {
      await almacen.marcarSenal(sid, 'error', { motivo: motivoDe(err) })
      r.errores.push(`${ficha.cliente}: no se pudo evaluar el mensaje (${motivoDe(err)})`)
      return
    }
    await almacen.marcarSenal(sid, l.exito ? 'exito' : 'no', { confianza: l.confianza, motivo: l.motivo, habla: l.hablaDeResultados, buenos: l.buenos })
    if (!l.exito) return
    r.detectados++
    await abrirPedido(r, ficha, { tipo: 'mensaje', cita: l.cita, grupo }, `m_${m.mensajeId}`)
  }

  async function aplicarVideo(r: ResumenExito, v: CandidatosExito['videos'][number]) {
    const e = await d.directorio.deChat(v.chatId)
    if (!e) return
    const { ficha, grupo } = e
    if (d.clienteOperativo && !await d.clienteOperativo(ficha.idCrm, ficha.cliente)) { r.ignorados++; return }
    const p = await almacen.pedidoParaTestimonio(ficha.clave, iso(d.ahora() - VENTANA_TESTIMONIO_MS))
    if (!p || Date.parse(v.enviadoEn) < Date.parse(p.resuelto ?? p.creado)) return
    if (!(await almacen.reclamarTestimonio(p.id, v.mensajeId, iso(d.ahora())))) return
    r.testimonios++
    await almacen.guardarTestimonio({
      mensajeId: v.mensajeId, pedidoId: p.id, clave: ficha.clave, chatId: v.chatId, grupo, medio: { ...v.medio }, enviadoEn: v.enviadoEn,
      estado: 'recibido', agradecimientoId: null, discordId: null, creado: iso(d.ahora()),
    })
    await agradecer(r, p, v.mensajeId, v.chatId, grupo, v.enviadoEn)
  }

  async function agradecer(r: ResumenExito, p: Pedido, mensajeId: string, chatId: string, grupo: GrupoCliente, enviadoEn: string) {
    if (real('exito_testimonio')) {
      const citar = chatId === p.general ? mensajeId : null
      const s = await salir(true, p.general, textoAgradecimiento(p.cliente, c.calendlyUrl), citar)
      let discordId: string | null = null
      if (d.discord) {
        try {
          discordId = await d.discord(textoDiscordTestimonio({ cliente: p.cliente, mencion: d.mencionGeroM, grupo, link: p.invitacion, mensajeId, fecha: diaAR(Date.parse(enviadoEn)).split('-').reverse().join('/') }), d.mencionGeroM ? [d.mencionGeroM] : [])
        } catch (e) {
          r.errores.push(`${p.cliente}: no salió el aviso de Discord (${motivoDe(e)})`)
        }
      } else r.errores.push('falta DISCORD_WEBHOOK_CLIENTES: no se avisó del testimonio en Discord')
      await almacen.actualizarTestimonio(mensajeId, { estado: s.estado === 'enviado' ? 'agradecido' : s.estado === 'error' && s.dudoso ? 'dudoso' : 'error_agradecimiento', agradecimientoId: s.estado === 'enviado' ? s.id : null, discordId })
      if (s.estado !== 'enviado') r.errores.push(`${p.cliente}: no salió el agradecimiento con el Calendly${s.estado === 'error' ? ` (${s.motivo})` : ''}`)
      r.registro.push(`testimonio de ${p.cliente}: agradecimiento ${s.estado}, Discord ${discordId ? 'enviado' : 'no'}`)
      return
    }
    if (ensayo('exito_testimonio')) {
      await salir(true, c.verificaciones, `${p.cliente} mandó un video después del pedido de testimonio. Se le respondería con el link de la reunión de Análisis y Proyecciones y se avisaría a Gero M en Discord.`)
      await almacen.actualizarTestimonio(mensajeId, { estado: 'simulado' })
    }
    r.registro.push(`haría: agradecer el testimonio de ${p.cliente} con el Calendly y avisar en Discord`)
  }

  async function procesarEventos(cands: CandidatosExito): Promise<ResumenExito> {
    const r = vacio(c.modo)
    if (c.modo === 'seco') {
      r.registro.push(`seco: ${cands.mensajes.length} mensaje(s), ${cands.videos.length} video(s), ${cands.respuestas.length} respuesta(s) en Verificaciones: no se evalúa nada`)
      return r
    }
    const pasos: [string, () => Promise<void>][] = [
      ...cands.ecos.map((x) => [`eco ${x.mensajeId}`, () => aplicarEco(r, x)] as [string, () => Promise<void>]),
      ...cands.respuestas.map((x) => [`respuesta ${x.mensajeId}`, () => aplicarRespuesta(r, x)] as [string, () => Promise<void>]),
      ...cands.mensajes.map((x) => [`mensaje ${x.mensajeId}`, () => aplicarMensaje(r, x)] as [string, () => Promise<void>]),
      ...cands.videos.map((x) => [`video ${x.mensajeId}`, () => aplicarVideo(r, x)] as [string, () => Promise<void>]),
    ]
    for (const [que, f] of pasos) {
      try { await f() } catch (e) { r.errores.push(`${que}: ${motivoDe(e)}`) }
    }
    return r
  }

  // ── Cron diario ──
  async function vencerPedidos(r: ResumenExito) {
    for (const p of await almacen.pedidosAbiertosAntesDe(iso(d.ahora() - VENCE_PEDIDO_MS))) {
      if (await almacen.actualizarPedido(p.id, { estado: 'vencido', resuelto: iso(d.ahora()) }, ['abierto'])) { r.vencidos++; r.registro.push(`venció el pedido de ${p.cliente} (14 días sin respuesta)`) }
    }
  }

  async function correrDiario(l: LectoresDiario, op: { forzarLista?: boolean } = {}): Promise<ResumenExito> {
    const r = vacio(c.modo)
    const ahora = d.ahora()
    if (c.modo === 'seco') { r.registro.push('seco: no se lee el CRM ni la encuesta y no sale nada'); return r }
    const pasos: [string, () => Promise<void>][] = [
      ['vencer pedidos', () => vencerPedidos(r)],
      ['encuesta', async () => {
        const candidatos = await l.clientesActivos()
        const controles = await Promise.all(candidatos.map(k => d.clienteOperativo ? d.clienteOperativo(k.id, k.nombre) : true))
        const clientes = candidatos.filter((_, i) => controles[i])
        const fichas = await d.directorio.todas()
        const respuestas = await l.respuestasTypeform(clientes).catch((e) => { r.errores.push(`no se pudo leer la planilla del Typeform (${motivoDe(e)})`); return null })
        if (respuestas) {
          const asignadas = await almacen.asignaciones()
          const conAsignacion = respuestas.map((x) => (x.idCliente || !asignadas.has(x.clave) ? x : { ...x, idCliente: asignadas.get(x.clave)!.toUpperCase() }))
          await vincularRondas(r, conAsignacion)
          await senalesDeEncuesta(r, clientes, fichas)
          await consultarDudosas(r, conAsignacion)
        }
        await encuestaMensual(r, clientes, fichas, !!respuestas, ahora, !!op.forzarLista)
      }],
    ]
    for (const [que, f] of pasos) {
      try { await f() } catch (e) { r.errores.push(`${que}: ${motivoDe(e)}`) }
    }
    return r
  }

  const desdeRondas = () => iso(d.ahora() - 400 * DIA_MS)

  /** Vincula cada respuesta a SU ronda (envío ≤ submitted_at < envío de la siguiente). Las viejas no tocan la ronda vigente. */
  async function vincularRondas(r: ResumenExito, respuestas: RespuestaEncuesta[]) {
    for (const v of vinculos(await almacen.rondasDesde(desdeRondas()), respuestas)) {
      if (await almacen.vincularRespuesta(v.ronda.id, { respuestaId: v.respuesta.clave, puntaje: v.respuesta.valor, respondidaEn: v.respuesta.enviadaEn })) {
        r.registro.push(`encuesta ${v.ronda.mes} de ${v.ronda.cliente}: respondió ${v.respuesta.valor ?? '?'}/10`)
      }
    }
  }

  /** Éxito por la encuesta: SOLO el puntaje de la ronda vigente (la última enviada a cada cliente), 8 o más. */
  async function senalesDeEncuesta(r: ResumenExito, clientes: ClienteActivo[], fichas: FichaCliente[]) {
    let abiertos = 0
    for (const ronda of rondasVigentes(await almacen.rondasDesde(desdeRondas()))) {
      if (ronda.puntaje === null || ronda.puntaje < PUNTAJE_EXITO || !ronda.respuestaId) continue
      if (abiertos >= MAX_PEDIDOS_ENCUESTA_DIA) { r.registro.push(`tope de ${MAX_PEDIDOS_ENCUESTA_DIA} pedidos por la encuesta en el día: el resto sigue mañana`); break }
      const id = ronda.idCrm ?? ronda.clave
      const cli = clientes.find((k) => k.id.toUpperCase() === id.toUpperCase()) ?? { id, nombre: ronda.cliente, mail: '', celular: '' }
      const ficha = fichaDeCliente(cli, fichas)
      if (!ficha) { r.registro.push(`${cli.nombre}: encuesta ${ronda.puntaje}/10, pero no se conoce su grupo General`); continue }
      if (await almacen.bloqueo(ficha.clave, d.ahora())) continue
      const sid = `ronda:${idSeguro(ronda.id)}`
      if (!(await almacen.reclamarSenal({ id: sid, tipo: 'encuesta', clave: ficha.clave, chatId: ficha.grupos.general ?? null, detalle: { ronda: ronda.id, valor: ronda.puntaje } }, iso(d.ahora())))) continue
      await almacen.marcarSenal(sid, 'exito')
      r.detectados++
      const fecha = ronda.respondidaEn ? diaAR(Date.parse(ronda.respondidaEn)).split('-').reverse().join('/') : null
      if (await abrirPedido(r, { ...ficha, idCrm: ficha.idCrm ?? cli.id }, { tipo: 'encuesta', puntaje: ronda.puntaje, fecha }, `ronda_${ronda.id}`, cli.id)) abiertos++
    }
  }

  /** Respuestas que no cruzan con un único cliente y pueden ser de la ronda vigente: se pregunta en Verificaciones. */
  async function consultarDudosas(r: ResumenExito, respuestas: RespuestaEncuesta[]) {
    const vigentes = rondasVigentes(await almacen.rondasDesde(desdeRondas()))
    if (!vigentes.length) return
    const ultimoMes = vigentes.map((x) => x.mes).sort().at(-1)!
    const desde = vigentes.filter((x) => x.mes === ultimoMes).map((x) => x.enviadaEn!).sort()[0]
    const permitido = real('encuesta_mensual') || real('exito_pedido_ok') || ensayo('encuesta_mensual') || ensayo('exito_pedido_ok')
    let consultadas = 0
    for (const x of respuestas) {
      if (x.idCliente || x.enviadaEn < desde) continue
      if (consultadas >= MAX_PEDIDOS_ENCUESTA_DIA) break
      if (!permitido || !c.verificaciones) { r.registro.push(`haría: preguntar en Verificaciones de qué cliente es una respuesta de la encuesta (${x.quien})`); continue }
      const texto = textoDudosa(x)
      const final = c.modo === 'ensayo' ? conPrefijoEnsayo(texto) : texto
      const sid = `dud:${idSeguro(x.clave)}`
      if (!(await almacen.reclamarSenal({ id: sid, tipo: 'dudosa', clave: '__dudosa', chatId: null, detalle: { respuesta: x.clave, quien: x.quien, valor: x.valor, fecha: x.enviadaEn, huella: huellaTexto(final) } }, iso(d.ahora())))) continue
      consultadas++
      const s = await salir(true, c.verificaciones, texto)
      if (s.estado === 'enviado' || (s.estado === 'error' && s.dudoso)) await almacen.marcarSenal(sid, 'consultada', s.estado === 'enviado' && s.id ? { mensajeId: s.id } : {})
      else await almacen.marcarSenal(sid, 'error', { motivo: s.estado === 'error' ? s.motivo : 'no salió' })
      r.registro.push(`consulta en Verificaciones: respuesta dudosa de la encuesta (${x.quien})`)
    }
  }

  /** La encuesta del mes: (1) el día EXITO_ENCUESTA_DIA publica la lista de ACTIVOS en Verificaciones y espera el OK;
   *  (2) con el lote aprobado manda (o sigue mandando) la encuesta; (3) el recordatorio a los 3 días, sin pedir OK de nuevo. */
  async function encuestaMensual(r: ResumenExito, clientes: ClienteActivo[], fichas: FichaCliente[], conPlanilla: boolean, ahora: number, forzarLista: boolean) {
    const hoy = diaAR(ahora)
    const mes = hoy.slice(0, 7)
    const dia = Number(hoy.slice(8, 10))
    // 1. La lista para el OK
    if ((dia === c.diaEncuesta || forzarLista) && !(await almacen.lote(mes))) {
      const conGrupo = clientes.map((k) => ({ k, f: fichaDeCliente(k, fichas) }))
      const van = conGrupo.filter((x) => x.f?.grupos.general).map((x) => ({ id: x.k.id.toUpperCase(), nombre: x.k.nombre, general: x.f!.grupos.general! }))
      const sinGrupo = conGrupo.filter((x) => !x.f?.grupos.general).map((x) => x.k.nombre)
      const permitido = real('encuesta_mensual') || ensayo('encuesta_mensual')
      if (!permitido || !c.verificaciones) r.registro.push(`haría: pedir el OK para mandar la encuesta de ${mes} a ${van.length} cliente(s) activo(s) (sin la capacidad encuesta_mensual)`)
      else {
        const texto = textoListaEncuesta(mes, van.map((x) => x.nombre), sinGrupo)
        const final = c.modo === 'ensayo' ? conPrefijoEnsayo(texto) : texto
        if (await almacen.crearLote({ mes, modo: c.modo, clientes: van, sinGrupo, mensajeId: null, huella: huellaTexto(final), creado: iso(ahora) })) {
          const s = await salir(true, c.verificaciones, texto)
          if (s.estado === 'enviado' && s.id) await almacen.actualizarLote(mes, { mensajeId: s.id })
          if (s.estado === 'error' && !s.dudoso) { await almacen.actualizarLote(mes, { estado: 'rechazado', por: 'error' }); r.errores.push(`no salió la lista de la encuesta de ${mes} (${s.motivo})`) }
          else r.registro.push(`lista de la encuesta de ${mes} en Verificaciones (${van.length} cliente(s))${c.modo === 'ensayo' ? ' (SIMULACIÓN)' : ''}`)
        }
      }
    }
    // 2. Lote aprobado: mandar lo que falte
    const lote = await almacen.lote(mes)
    if (lote?.estado === 'aprobado') await enviarLote(r, lote)
    // 3. Recordatorio a los 3 días, solo de la ronda de este mes y si esa ronda no tiene respuesta vinculada
    const pendientes = (await almacen.encuestasDelMes(mes)).filter((e) => e.clave !== '__reporte' && e.estado === 'enviada' && !e.recordatorioEn && !e.respuestaId && e.enviadaEn && Date.parse(e.enviadaEn) <= ahora - RECORDATORIO_ENCUESTA_MS)
    if (!pendientes.length) return
    if (!conPlanilla) { r.registro.push('recordatorio de la encuesta: sin la planilla del Typeform no se sabe quién respondió, no se manda'); return }
    for (const e of pendientes) {
      if (d.clienteOperativo && !await d.clienteOperativo(e.idCrm, e.cliente)) { r.ignorados++; continue }
      if (!real('encuesta_mensual')) { r.registro.push(`haría: recordarle la encuesta a ${e.cliente}`); continue }
      await almacen.actualizarEncuesta(e.id, { recordatorioEn: iso(ahora), recordatorioEstado: 'enviando' })
      const s = await salir(true, e.general, textoRecordatorio(e.cliente, c.typeformUrl))
      await almacen.actualizarEncuesta(e.id, { recordatorioEstado: s.estado === 'enviado' ? 'enviado' : s.estado === 'error' && s.dudoso ? 'dudoso' : 'error' })
      if (s.estado === 'enviado') r.recordatorios++
      else r.errores.push(`${e.cliente}: no salió el recordatorio de la encuesta`)
    }
  }

  /** Manda la encuesta del lote aprobado a los clientes que faltan (una ronda por cliente). Si se acaba el tiempo, sigue el
   *  próximo cron. */
  async function enviarLote(r: ResumenExito, lote: Lote) {
    if (!real('encuesta_mensual') || lote.modo !== 'real') { r.registro.push(`haría: mandar la encuesta de ${lote.mes} a ${lote.clientes.length - lote.excluidos.length} cliente(s)`); return }
    const inicio = d.ahora()
    let pendientes = 0
    for (const k of lote.clientes) {
      if (lote.excluidos.includes(k.id)) continue
      if (d.clienteOperativo && !await d.clienteOperativo(k.id, k.nombre)) { r.ignorados++; continue }
      if (d.ahora() - inicio > TIEMPO_LOTE_MS) { pendientes++; continue }
      const id = `${lote.mes}:${k.id}`
      if (!(await almacen.reclamarEncuesta({ id, mes: lote.mes, clave: k.id, idCrm: k.id, cliente: k.nombre, general: k.general, estado: 'enviando', enviadaEn: null, mensajeId: null, recordatorioEn: null, recordatorioEstado: null, respondida: false }, iso(d.ahora())))) continue
      // La fecha de envío se fija ANTES de mandar: una respuesta no puede quedar antes del envío de su propia ronda
      const enviada = iso(d.ahora())
      const s = await salir(true, k.general, textoEncuesta(k.nombre, c.typeformUrl))
      await almacen.actualizarEncuesta(id, { estado: s.estado === 'enviado' ? 'enviada' : s.estado === 'error' && s.dudoso ? 'dudosa' : 'error', enviadaEn: s.estado === 'enviado' || (s.estado === 'error' && s.dudoso) ? enviada : null, mensajeId: s.estado === 'enviado' ? s.id : null })
      if (s.estado === 'enviado') r.encuestas++
      else r.errores.push(`${k.nombre}: no salió la encuesta${s.estado === 'error' ? ` (${s.motivo})` : ''}`)
      if (d.esperar) await d.esperar(ESPERA_ENTRE_ENCUESTAS_MS)
    }
    if (!pendientes) await almacen.actualizarLote(lote.mes, { estado: 'completo' }, ['aprobado'])
    else r.registro.push(`encuesta de ${lote.mes}: quedan ${pendientes} por mandar (siguen en el próximo cron)`)
  }

  /** OK / NO a la lista de la encuesta del mes. "OK sin X" / "OK menos X, Y" deja afuera a esos clientes. */
  async function aplicarRespuestaLote(r: ResumenExito, x: CandidatosExito['respuestas'][number], lote: Lote) {
    if (!enLista(x.autor, c.aprobadores)) { r.ignorados++; return }
    if (lote.estado !== 'pedido') { r.ignorados++; return }
    const por = x.autor.nombre ?? x.autor.telefono ?? x.autor.lid ?? 'aprobador'
    const puedeResponder = real('encuesta_mensual')
    if (x.veredicto === 'no') {
      if (await almacen.actualizarLote(lote.mes, { estado: 'rechazado', por }, ['pedido'])) r.registro.push(`NO a la encuesta de ${lote.mes}: no se manda`)
      return
    }
    const ex = exclusionesDe(x.resto, lote.clientes)
    if (ex.noEncontrados.length) {
      if (puedeResponder) await salir(true, c.verificaciones, `No encontré a ${ex.noEncontrados.join(', ')} en la lista (o hay más de uno con ese nombre). Respondé de nuevo citando la lista, por ejemplo "OK sin Nombre Apellido".`, x.mensajeId)
      r.registro.push(`OK a la encuesta de ${lote.mes} con exclusiones que no se entienden: no se manda todavía`)
      return
    }
    if (!(await almacen.actualizarLote(lote.mes, { estado: 'aprobado', excluidos: ex.ids, por, aprobadoEn: iso(d.ahora()) }, ['pedido']))) return
    const n = lote.clientes.length - ex.ids.length
    r.registro.push(`OK a la encuesta de ${lote.mes}: ${n} cliente(s)${ex.ids.length ? `, sin ${ex.ids.length}` : ''}`)
    if (puedeResponder) {
      const sin = lote.clientes.filter((k) => ex.ids.includes(k.id)).map((k) => k.nombre)
      await salir(true, c.verificaciones, `Listo: mando la encuesta a ${n} cliente(s)${sin.length ? ` (sin ${sin.join(', ')})` : ''}.`, x.mensajeId)
    }
    await enviarLote(r, { ...lote, estado: 'aprobado', excluidos: ex.ids })
  }

  return { procesarEventos, correrDiario, abrirPedido }
}

export interface ClienteActivo { id: string; nombre: string; mail: string; celular: string }
export type { RespuestaEncuesta }
export interface LectoresDiario {
  /** Clientes de Agencia en estado ACTIVO, con ID (CRM). */
  clientesActivos(): Promise<ClienteActivo[]>
  /** Respuestas del Typeform con su instante (submitted_at) y el cliente cruzado (rondas.ts). null = la planilla no está conectada. */
  respuestasTypeform(clientes: ClienteActivo[]): Promise<RespuestaEncuesta[] | null>
}

const DIA_MS = 86_400_000
export const ESPERA_ENTRE_ENCUESTAS_MS = 2_000
export const TIEMPO_LOTE_MS = 200_000   // de los 300 s de la función: lo que falte sigue en el próximo cron

/** "sin Ana Pérez, Luis" / "menos A123 y Juan" → los IDs del lote. Cada nombre tiene que calzar con UN solo cliente de la
 *  lista (por ID, nombre igual o todas sus palabras dentro del nombre); si no, va a noEncontrados. PURO. */
export function exclusionesDe(resto: string, clientes: readonly ClienteLote[]): { ids: string[]; noEncontrados: string[] } {
  const m = /^\s*[,.;:-]?\s*(?:sin|menos|excepto|salvo)\s+(.+)$/i.exec(resto)
  if (!m) return { ids: [], noEncontrados: [] }
  const ids: string[] = [], noEncontrados: string[] = []
  for (const parte of m[1].split(/\s*(?:,|;|\s+y\s+|\s+e\s+)\s*/i).map((x) => x.trim()).filter(Boolean)) {
    const porId = clientes.filter((k) => k.id.toUpperCase() === parte.toUpperCase())
    const n = normNombre(parte)
    const iguales = clientes.filter((k) => normNombre(k.nombre) === n)
    const ws = n.split(' ').filter((w) => w.length >= 2)
    const parecidos = clientes.filter((k) => { const kw = new Set(normNombre(k.nombre).split(' ')); return ws.length > 0 && ws.every((w) => kw.has(w)) })
    const hit = porId.length === 1 ? porId[0] : iguales.length === 1 ? iguales[0] : parecidos.length === 1 ? parecidos[0] : null
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id) } else noEncontrados.push(parte)
  }
  return { ids, noEncontrados }
}

/** La consulta por una respuesta dudosa de la encuesta (corta). */
export function textoDudosa(x: Pick<RespuestaEncuesta, 'quien' | 'valor' | 'enviadaEn'>): string {
  const fecha = diaAR(Date.parse(x.enviadaEn)).split('-').reverse().join('/')
  return `📋 Encuesta: no sé de qué cliente es esta respuesta.\n${x.quien} · ${x.valor ?? '?'}/10 · ${fecha}\n\nRespondé citando: OK <ID del CRM> (por ejemplo, OK A123) / NO si no es de un cliente`
}

const palabras = (s: string) => new Set(normNombre(s).split(' ').filter((w) => w.length >= 3))

/** La ficha (grupos) de un cliente del CRM: por ID, por nombre igual o, si es la ÚNICA, por todas las palabras del nombre del
 *  grupo dentro del nombre del CRM (o al revés). Nunca adivina entre dos. PURO. */
export function fichaDeCliente(cli: Pick<ClienteActivo, 'id' | 'nombre'>, fichas: readonly FichaCliente[]): FichaCliente | null {
  const porId = fichas.find((f) => f.idCrm && f.idCrm.toUpperCase() === cli.id.toUpperCase())
  if (porId) return porId
  const n = normNombre(cli.nombre)
  const iguales = fichas.filter((f) => normNombre(f.cliente) === n)
  if (iguales.length === 1) return iguales[0]
  if (iguales.length > 1) return null
  const pc = palabras(cli.nombre)
  const parecidas = fichas.filter((f) => {
    const pf = palabras(f.cliente)
    if (!pf.size || !pc.size) return false
    const dentro = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w))
    return (pf.size >= 2 && dentro(pf, pc)) || (pc.size >= 2 && dentro(pc, pf))
  })
  return parecidas.length === 1 ? parecidas[0] : null
}
